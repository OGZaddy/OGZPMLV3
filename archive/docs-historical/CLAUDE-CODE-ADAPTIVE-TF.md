# CLAUDE CODE: Wire AdaptiveTimeframeSelector — Dynamic Timeframe Trading

## WHAT THIS IS

`core/AdaptiveTimeframeSelector.js` replaces the hardcoded "always trade 15m" with dynamic
timeframe selection. It reads per-timeframe indicators from the MTF adapter (which already
calculates RSI, MACD, trend, Bollinger per timeframe) and scores each timeframe on:

1. **Fee viability** — Can moves on this TF clear Kraken's 0.52% round-trip fees?
2. **Trend clarity** — Is there a clear bullish/bearish direction?
3. **Signal strength** — Are RSI/MACD/EMA showing actionable levels?
4. **Noise level** — Clean candles or choppy mess?
5. **Timeframe preference** — Slight bias toward 15m/30m (sweet spot)

It also provides **adaptive exit parameters** — SL/TP/trailing that match the selected
timeframe's typical move range. A 5m trade gets tighter stops than a 1h trade.

### Hysteresis built in:
- Won't switch unless the new timeframe scores 15%+ better than current
- Minimum 5 minutes between switches (no ping-ponging)
- Defaults to 15m if nothing scores well

---

## FILE ALREADY CREATED

`core/AdaptiveTimeframeSelector.js` — drop it in, it's ready.

---

## WIRING INTO THE PIPELINE

### 1. Import in run-empire-v2.js (with other requires)

```javascript
const { AdaptiveTimeframeSelector } = require('./core/AdaptiveTimeframeSelector');
```

### 2. Instantiate in constructor (after MTF adapter init)

```javascript
    // Dynamic timeframe selection — picks the best timeframe based on current conditions
    this.timeframeSelector = new AdaptiveTimeframeSelector({
      mtfAdapter: this.mtfAdapter,
      feePercent: 0.26,                           // Kraken maker/taker fee per side
      allowedTimeframes: ['5m', '15m', '30m', '1h'], // Don't scalp 1m, don't swing 4h+
      defaultTimeframe: '15m',
      minSwitchIntervalMs: 5 * 60 * 1000,         // 5 min minimum between switches
    });
```

### 3. Update the trading trigger in subscribeToMarketData()

Instead of only triggering analyzeAndTrade on 15m candle closes, trigger on ANY
candle close that matches the currently selected timeframe:

```javascript
        this.kraken.on('ohlc', (eventData) => {
          const timeframe = eventData.timeframe || '1m';
          const ohlcData = eventData.data || eventData;

          // Store ALL timeframes for dashboard
          this.storeTimeframeCandle(timeframe, ohlcData);

          // Feed 1m candles to indicators + MTF adapter (they need granular data)
          if (timeframe === '1m') {
            this.handleMarketData(ohlcData);
          }

          // Re-evaluate best timeframe periodically (on every 5m candle close)
          if (timeframe === '5m' && this.timeframeSelector) {
            const tfResult = this.timeframeSelector.evaluate();
            if (tfResult.switched) {
              console.log(`🔄 Active trading timeframe: ${tfResult.timeframe} (score: ${tfResult.score.toFixed(2)})`);
            }
          }

          // Trigger trading analysis when the ACTIVE timeframe's candle closes
          const activeTf = this.timeframeSelector?.currentTimeframe || '15m';
          if (timeframe === activeTf) {
            console.log(`📊 V2: ${activeTf} candle closed — running trading analysis`);
            this.run15mTradingCycle(); // Name is legacy but works for any TF
          }
        });
```

### 4. Pass adaptive exit params to the orchestrator

In `analyzeAndTrade()` or wherever the orchestrator is called, get the timeframe's exit params:

```javascript
    // Get adaptive exit parameters for current timeframe
    const tfState = this.timeframeSelector?.lastEvaluation;
    const adaptiveExitParams = tfState?.exitParams || null;
```

Then in the orchestrator result handling, if the adaptive exit params exist, use them
to override the strategy's default exit contract:

```javascript
    // If adaptive timeframe selector provided exit params, merge them
    if (adaptiveExitParams && orchResult.exitContract) {
      orchResult.exitContract.stopLossPercent = adaptiveExitParams.stopLossPercent;
      orchResult.exitContract.takeProfitPercent = adaptiveExitParams.takeProfitPercent;
      orchResult.exitContract.trailingStopPercent = adaptiveExitParams.trailingStopPercent;
      orchResult.exitContract.maxHoldTimeMinutes = adaptiveExitParams.maxHoldTimeMinutes;
      orchResult.exitContract.adaptedTimeframe = tfState.timeframe;
      console.log(`📐 Exit contract adapted for ${tfState.timeframe}: SL ${adaptiveExitParams.stopLossPercent}%, TP +${adaptiveExitParams.takeProfitPercent}%, trail ${adaptiveExitParams.trailingStopPercent}%`);
    }
```

### 5. Dashboard visibility (optional)

If the dashboard WebSocket broadcasts exist, add timeframe selector state:

```javascript
    // In dashboard broadcast section:
    timeframeSelector: this.timeframeSelector?.getState(),
```

---

## HOW IT WORKS IN PRACTICE

**Scenario 1: Normal conditions (15m wins)**
- 15m has clear uptrend, RSI pulling back from 60, ATR = 0.8%
- Score: 0.72
- 5m is choppy, no trend. Score: 0.35
- 1h is bullish but slow. Score: 0.58
- Result: Stay on 15m. Exit params: SL -1.5%, TP +2.5%, trail 1.0%

**Scenario 2: Volatile breakout (5m wins)**
- BTC just broke a major level, 5m candles moving 0.5%+ with clear direction
- 5m score: 0.78 (strong trend + high signal + clears fees)
- 15m score: 0.55 (candle hasn't closed yet, lagging)
- Result: Switch to 5m. Exit params: SL -1.0%, TP +1.8%, trail 0.6%, max hold 60min

**Scenario 3: Slow grind (1h wins)**
- Market is in a slow steady trend, 15m is noisy with lots of wicks
- 1h has clean candles, clear EMA alignment, RSI at 42 (room to run)
- 1h score: 0.71
- 15m score: 0.48 (noisy)
- Result: Switch to 1h. Exit params: SL -2.5%, TP +4.5%, trail 2.0%, max hold 480min

**Scenario 4: Dead market (stays on default)**
- All timeframes are ranging, low volume, tight Bollingers
- Everything scores below 0.40
- Result: Stay on 15m (default), orchestrator likely returns HOLD anyway

---

## TESTING

```bash
# Verify it loads
node -e "const { AdaptiveTimeframeSelector } = require('./core/AdaptiveTimeframeSelector'); console.log('✅')"

# In live logs, look for:
# "🔄 Active trading timeframe: 5m (score: 0.78)"  — switched
# "📊 V2: 15m candle closed — running trading analysis"  — trading on active TF
# "📐 Exit contract adapted for 5m: SL -1.0%, TP +1.8%"  — adaptive exits
```

---

## CONFIGURATION

```javascript
// Conservative (fewer switches, medium timeframes only)
{
  allowedTimeframes: ['15m', '30m'],
  minSwitchIntervalMs: 15 * 60 * 1000,  // 15 min minimum
}

// Aggressive (includes faster timeframes, switches more)
{
  allowedTimeframes: ['5m', '15m', '30m', '1h'],
  minSwitchIntervalMs: 5 * 60 * 1000,
}

// Scalp mode (if you ever want it back)
{
  allowedTimeframes: ['1m', '5m', '15m'],
  minSwitchIntervalMs: 2 * 60 * 1000,
  // WARNING: 1m may not clear fees on Kraken
}
```
