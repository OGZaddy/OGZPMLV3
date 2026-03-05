# CLAUDE CODE: Fix Backtester for 15-Minute Candles

## PROBLEM

The backtest in `run-empire-v2.js` `loadHistoricalDataAndBacktest()` feeds candles one-by-one
through `handleMarketData()`. But `handleMarketData()` now only processes candles tagged as
`timeframe === '15m'` (from Patch 3b).

The historical data files (`polygon-btc-1y.json`, `polygon-btc-5sec.json`) contain 1-minute
or 5-second candles. These get fed as raw OHLC arrays through `handleMarketData()` which
builds `priceHistory` directly — they bypass the `subscribeToMarketData()` timeframe filter.

**Two approaches — pick one:**

---

## APPROACH A: Aggregate 1m candles into 15m in the backtest loop (RECOMMENDED)

This keeps existing data files working. The backtest loop groups every 15 candles (1m × 15 = 15m)
into one 15m candle before feeding it to the trading pipeline.

### In `loadHistoricalDataAndBacktest()` (around line 3330), replace the candle processing loop:

**Before:**
```javascript
      for (const polygonCandle of historicalCandles) {
        try {
          const ohlcvCandle = {
            o: polygonCandle.open || polygonCandle.o,
            h: polygonCandle.high || polygonCandle.h,
            l: polygonCandle.low || polygonCandle.l,
            c: polygonCandle.close || polygonCandle.c,
            v: polygonCandle.volume || polygonCandle.v,
            t: polygonCandle.timestamp || polygonCandle.t
          };

          this.handleMarketData([
            ohlcvCandle.t / 1000,
            (ohlcvCandle.t / 1000) + 60,
            ohlcvCandle.o,
            ohlcvCandle.h,
            ohlcvCandle.l,
            ohlcvCandle.c,
            0,
            ohlcvCandle.v,
            1
          ]);

          if (this.priceHistory.length >= 15) {
            await this.analyzeAndTrade();
          }
```

**After:**
```javascript
      // ════════════════════════════════════════════════════════════════
      // BACKTEST: Aggregate raw candles into 15m candles before trading
      // 15 × 1m candles = 1 × 15m candle
      // This matches live mode where Kraken sends 15m OHLC directly
      // ════════════════════════════════════════════════════════════════
      const aggregationSize = 15; // Number of raw candles per trading candle
      let candleBuffer = [];

      for (const polygonCandle of historicalCandles) {
        try {
          const ohlcvCandle = {
            o: polygonCandle.open || polygonCandle.o,
            h: polygonCandle.high || polygonCandle.h,
            l: polygonCandle.low || polygonCandle.l,
            c: polygonCandle.close || polygonCandle.c,
            v: polygonCandle.volume || polygonCandle.v,
            t: polygonCandle.timestamp || polygonCandle.t
          };

          candleBuffer.push(ohlcvCandle);

          // When we have enough candles, aggregate into one 15m candle
          if (candleBuffer.length >= aggregationSize) {
            const agg = {
              t: candleBuffer[0].t,                                           // Open time of first candle
              o: candleBuffer[0].o,                                            // Open of first candle
              h: Math.max(...candleBuffer.map(c => c.h)),                     // Highest high
              l: Math.min(...candleBuffer.map(c => c.l)),                     // Lowest low
              c: candleBuffer[candleBuffer.length - 1].c,                     // Close of last candle
              v: candleBuffer.reduce((sum, c) => sum + (c.v || 0), 0),       // Sum volume
            };

            // Feed aggregated 15m candle through the pipeline
            this.handleMarketData([
              agg.t / 1000,                          // time (seconds)
              (agg.t / 1000) + (aggregationSize * 60), // etime (15 min later)
              agg.o,
              agg.h,
              agg.l,
              agg.c,
              0,                                     // vwap
              agg.v,
              aggregationSize                        // count
            ]);

            // Run trading analysis
            if (this.priceHistory.length >= 15) {
              await this.analyzeAndTrade();
            }

            // Clear buffer for next aggregation
            candleBuffer = [];
          }

          processedCount++;

          // Progress reporting every 5,000 raw candles
          if (processedCount % 5000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const rate = (processedCount / (elapsed || 1)).toFixed(0);
            const tradingCandles = Math.floor(processedCount / aggregationSize);
            console.log(`📊 Progress: ${processedCount.toLocaleString()}/${historicalCandles.length.toLocaleString()} raw candles (${tradingCandles} 15m candles) | ${rate}/sec | Errors: ${errorCount}`);
          }
```

### Key details:
- 60,000 × 1m candles → 4,000 × 15m candles (about 42 days of BTC data)
- If using 5-second candles: 60,000 × 5s candles → 333 × 15m candles (about 3.5 days)
- For meaningful backtest results on 15m, you want at least 2,000 15m candles (~21 days)
- The `polygon-btc-1y.json` file at 60k 1m candles gives ~42 days on 15m which is solid

### Also update the warmup log:
```javascript
console.log(`⏳ Warming up... ${this.priceHistory.length}/15 candles (15m aggregated from ${aggregationSize}×1m)`);
```

---

## APPROACH B: Pre-convert data file to 15m candles (alternative)

Create a script that converts the 1m JSON to 15m JSON. Run it once, then point backtester at the new file.

```javascript
// scripts/aggregate-candles.js
const fs = require('fs');
const inputFile = process.argv[2] || 'data/polygon-btc-1y.json';
const outputFile = process.argv[3] || 'data/polygon-btc-15m.json';
const interval = parseInt(process.argv[4]) || 15;

const raw = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const candles = raw.candles || raw;

const aggregated = [];
for (let i = 0; i < candles.length; i += interval) {
  const chunk = candles.slice(i, i + interval);
  if (chunk.length < interval) break; // Skip incomplete last chunk
  aggregated.push({
    timestamp: chunk[0].timestamp || chunk[0].t,
    open: chunk[0].open || chunk[0].o,
    high: Math.max(...chunk.map(c => c.high || c.h)),
    low: Math.min(...chunk.map(c => c.low || c.l)),
    close: chunk[chunk.length - 1].close || chunk[chunk.length - 1].c,
    volume: chunk.reduce((s, c) => s + (c.volume || c.v || 0), 0),
  });
}

fs.writeFileSync(outputFile, JSON.stringify({ candles: aggregated }, null, 2));
console.log(`✅ Aggregated ${candles.length} × 1m → ${aggregated.length} × ${interval}m candles`);
console.log(`📁 Saved to ${outputFile}`);
```

Then in .env or command line:
```bash
CANDLE_DATA_FILE=data/polygon-btc-15m.json node run-empire-v2.js
```

---

## BACKTEST METRICS TO TRACK

After running the backtest with the orchestrator on 15m candles, the key numbers to verify:

| Metric | Target | Why |
|--------|--------|-----|
| Total trades | 100-400 (over 42 days) | 3-8 per day on 15m |
| Win rate | > 50% | Must clear fees |
| Avg win % | > 1.5% | After 0.52% fees = ~1% net |
| Avg loss % | < -2.0% | SL should catch these |
| Profit factor | > 1.3 | Total wins / total losses |
| Max drawdown | < 15% | Risk management working |
| Avg hold time | 30-120 min | Not timing out at max hold |

If trades are timing out at max hold instead of hitting TP/SL, the exit contract values
need adjustment. If win rate is below 45%, the minStrategyConfidence threshold may be too low.

---

## RUNNING THE BACKTEST

On VPS:
```bash
# Standard backtest with 1m data aggregated to 15m
BACKTEST_MODE=true SILENT_MODE=true node run-empire-v2.js

# Fast backtest with 5-second data (fewer resulting candles)
BACKTEST_MODE=true FAST_BACKTEST=true SILENT_MODE=true node run-empire-v2.js

# Custom data file
BACKTEST_MODE=true CANDLE_DATA_FILE=data/polygon-btc-15m.json node run-empire-v2.js
```
