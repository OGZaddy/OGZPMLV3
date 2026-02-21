# CLAUDE CODE: Wire StrategyOrchestrator + Switch to 15-Minute Candles

## CONTEXT

OGZPrime trading bot on branch `fix/candle-helper-wip` at https://github.com/CGP-ME/OGZPMLV2

The bot has a **soupy pooled confidence** problem: all signals blend into one number via
`OptimizedTradingBrain.getDecision()` → `calculateRealConfidence()`. Eight weak signals = high
confidence = bad trade. Trades never close on TP/SL because exit contract values were designed for
swing trading (2-5%) but the bot runs on 1-minute candles where moves are 0.05-0.5%.

**Two changes fix this:**
1. Replace the entry decision with `StrategyOrchestrator.js` (isolated per-strategy evaluation)
2. Switch from 1-minute to 15-minute candles as the trading timeframe

The bot already receives 15m candles from Kraken WebSocket (see `kraken_adapter_simple.js` line 609).
It just doesn't use them for trading decisions.

---

## FILE TO ADD

### `core/StrategyOrchestrator.js` — Already created, in the repo

480 lines. Self-contained. No new dependencies. Evaluated and tested.

**What it does:**
- Runs each strategy independently (EMA Crossover, MA Dynamic S/R, Liquidity Sweep, RSI Extreme, Pattern Recognition, Market Regime, Multi-Timeframe, OGZ TPO)
- Picks the highest-confidence strategy as the WINNER
- Winner OWNS the trade — its exit contract, its SL/TP, its invalidation
- Confluence (how many strategies agree on direction) only affects POSITION SIZING:
  - 1 strategy agrees = 1.0x base size
  - 2 agree = 1.5x
  - 3 agree = 2.0x
  - 4+ agree = 2.5x
- Creates an ExitContract from the winning strategy's defaults in ExitContractManager

**Returns:**
```javascript
{
  action: 'BUY' | 'SELL' | 'HOLD',
  direction: 'buy' | 'sell' | 'hold',
  confidence: 72.0,              // Percentage (winner's confidence * 100)
  winnerStrategy: 'EMASMACrossover',
  exitContract: { ... },         // From ExitContractManager
  sizingMultiplier: 1.5,         // From confluence count
  confluence: { count: 2, strategies: [...] },
  signalBreakdown: { ... },      // For trade logging
  reasons: ['🏆 Winner: ...', '🤝 Confluence: ...']
}
```

---

## SURGERY ON `run-empire-v2.js` (4 patches)

### PATCH 1: Add import (near line 20, with other requires)

Find the block of `require()` statements near the top. Add this line:

```javascript
const { StrategyOrchestrator } = require('./core/StrategyOrchestrator');
```

### PATCH 2: Instantiate in constructor (after TradingBrain init, around line ~430)

Find where `this.tradingBrain` is created in the constructor. After it, add:

```javascript
    // CHANGE: Isolated strategy entry pipeline (replaces soupy pooled confidence)
    this.strategyOrchestrator = new StrategyOrchestrator({
      minStrategyConfidence: 0.25,   // Single strategy must be 25%+ to fire
      minConfluenceCount: 1,         // 1 = winner alone can trade. Set to 2 for safety.
    });
```

### PATCH 3: Switch trading timeframe from 1m to 15m

#### 3a: In `subscribeToMarketData()` (around line 1150)

Find this block:
```javascript
          // Only process 1m candles through trading logic
          if (timeframe === '1m') {
            console.log('📊 V2: Received 1m OHLC from broker');
            this.handleMarketData(ohlcData);
          }
```

Replace with:
```javascript
          // CHANGE: Process 15m candles through trading logic (not 1m)
          // 15m candles give meaningful price moves that exceed Kraken's 0.52% round-trip fees
          // 1m candle moves (0.05-0.5%) were net-negative after fees on every trade
          if (timeframe === '15m') {
            console.log('📊 V2: Received 15m OHLC from broker');
            this.handleMarketData(ohlcData);
          }
```

#### 3b: Update `getHistoricalOHLC` call in `loadHistoricalDataAndBacktest()` (around line 3298)

Search for where `getHistoricalOHLC` is called. Change the interval parameter from `1` to `15`:

```javascript
// Before:
const ohlcData = await this.kraken.getHistoricalOHLC(pair, 1, 200);
// After:
const ohlcData = await this.kraken.getHistoricalOHLC(pair, 15, 200);
```

#### 3c: Update the `CANDLE_TIMEFRAME` env var default (around line 1132)

```javascript
// Before:
const timeframe = process.env.CANDLE_TIMEFRAME || '1m';
// After:
const timeframe = process.env.CANDLE_TIMEFRAME || '15m';
```

#### 3d: Update warmup message (around line 1478)

```javascript
// Before:
console.log(`⏳ Warming up... ${this.priceHistory.length}/3 candles`);
// After:
console.log(`⏳ Warming up... ${this.priceHistory.length}/3 candles (15m timeframe)`);
```

### PATCH 4: Replace TradingBrain entry decision with Orchestrator (in `analyzeAndTrade()`)

This is the big one. In `analyzeAndTrade()`, find this section (around lines 1708-1750):

```javascript
    const marketDataForConfidence = {
      trend: indicators.trend,
      macd: indicators.macd?.macd || indicators.macd?.macdLine || 0,
      macdSignal: indicators.macd?.signal || indicators.macd?.signalLine || 0,
      rsi: indicators.rsi,
      volume: this.marketData.volume || 0,
      // CHANGE 2026-02-10: Modular entry system signals
      emaCrossoverSignal: this.emaCrossoverSignal,
      maDynamicSRSignal: this.maDynamicSRSignal,
      liquiditySweepSignal: this.liquiditySweepSignal,
      mtfAdapter: this.mtfAdapter
    };

    // 🔧 FIX: Pass priceData to TradingBrain for MarketRegimeDetector
    this.tradingBrain.priceData = this.priceHistory;

    // FIX BRAIN_001: Apply AGGRESSIVE_LEARNING_MODE threshold BEFORE TradingBrain decides
    if (flagManager.isEnabled('AGGRESSIVE_LEARNING_MODE')) {
      const aggressiveThreshold = flagManager.getSetting('AGGRESSIVE_LEARNING_MODE', 'minConfidenceThreshold', 55) / 100;
      if (!this.tradingBrain.config) this.tradingBrain.config = {};
      this.tradingBrain.config.minConfidenceThreshold = aggressiveThreshold;
      if (!this._lastAggLog || Date.now() - this._lastAggLog > 60000) {
        console.log(`🔥 AGGRESSIVE LEARNING: TradingBrain threshold set to ${(aggressiveThreshold * 100).toFixed(0)}%`);
        this._lastAggLog = Date.now();
      }
    }

    // Get full decision from TradingBrain (direction + confidence + reasoning)
    const brainDecision = await this.tradingBrain.getDecision(
      marketDataForConfidence,
      patterns,
      this.priceHistory
    );
```

**Replace that entire block with:**

```javascript
    // ════════════════════════════════════════════════════════════════
    // STRATEGY ORCHESTRATOR — Isolated per-strategy entry pipeline
    // Each strategy evaluates independently. Highest confidence wins.
    // Confluence only affects position sizing, not the entry decision.
    // ════════════════════════════════════════════════════════════════
    const orchResult = this.strategyOrchestrator.evaluate(
      indicators,
      patterns,
      regime,
      this.priceHistory,
      {
        emaCrossoverSignal: this.emaCrossoverSignal,
        maDynamicSRSignal: this.maDynamicSRSignal,
        liquiditySweepSignal: this.liquiditySweepSignal,
        mtfAdapter: this.mtfAdapter,
        tpoResult: tpoResult,
        price: price
      }
    );

    // Map orchestrator output to existing variable names so downstream code doesn't break
    const brainDecision = {
      direction: orchResult.direction,
      confidence: orchResult.confidence / 100,  // Downstream expects 0-1 decimal
      reasons: orchResult.reasons,
      signalBreakdown: orchResult.signalBreakdown,
      action: orchResult.action,
      // Pass through for exit contract creation at trade execution
      exitContract: orchResult.exitContract,
      sizingMultiplier: orchResult.sizingMultiplier,
      winnerStrategy: orchResult.winnerStrategy,
    };

    // AGGRESSIVE_LEARNING_MODE: Lower the orchestrator threshold if enabled
    if (flagManager.isEnabled('AGGRESSIVE_LEARNING_MODE')) {
      const aggressiveThreshold = flagManager.getSetting('AGGRESSIVE_LEARNING_MODE', 'minConfidenceThreshold', 55) / 100;
      this.strategyOrchestrator.minStrategyConfidence = aggressiveThreshold;
      if (!this._lastAggLog || Date.now() - this._lastAggLog > 60000) {
        console.log(`🔥 AGGRESSIVE LEARNING: Orchestrator threshold set to ${(aggressiveThreshold * 100).toFixed(0)}%`);
        this._lastAggLog = Date.now();
      }
    }
```

**IMPORTANT:** The code BELOW this block (starting with the `tradingDirection` variable, the
position check, the spot market guard, the `makeTradeDecision()` call, the `executeTrade()`) should
all remain EXACTLY as-is. The `brainDecision` variable shape is compatible.

---

## SURGERY ON `executeTrade()` — Use orchestrator's exit contract

In `executeTrade()` (around line 2445+), find where the exit contract is created at entry time.
Search for `exitContract` or `ExitContractManager` inside executeTrade.

If there's a section that creates a new exit contract at trade execution, update it to PREFER
the one from the orchestrator:

```javascript
// Use the exit contract from the orchestrator (frozen at decision time)
// Only fall back to creating a new one if orchestrator didn't provide one
const exitContract = brainDecision.exitContract
  || exitContractManager.createExitContract(
      brainDecision.winnerStrategy || 'default',
      { confidence: brainDecision.confidence },
      { volatility: indicators?.volatility || 0 }
    );
```

Also store the winning strategy name on the trade object:
```javascript
trade.entryStrategy = brainDecision.winnerStrategy || 'unknown';
trade.sizingMultiplier = brainDecision.sizingMultiplier || 1.0;
```

---

## POSITION SIZING — Apply confluence multiplier

In the section where position size is calculated (inside `executeTrade()` or wherever
`calculatePositionSize` is called), multiply the base size by the confluence multiplier:

```javascript
// Apply confluence-based position sizing
const baseSize = /* existing position size calculation */;
const confluenceMultiplier = brainDecision.sizingMultiplier || 1.0;
const adjustedSize = baseSize * confluenceMultiplier;
```

---

## WHAT NOT TO TOUCH

- `makeTradeDecision()` — exit logic stays as-is (ExitContractManager already handles exits)
- `OptimizedTradingBrain.js` — leave it. The orchestrator replaces its entry role but it still exists for anything else that references it
- `SignalGenerator.js` — leave it. It exists but was never wired in. The orchestrator does what it was supposed to do.
- All exit logic, dashboard broadcasting, TRAI, pattern recording — untouched
- `kraken_adapter_simple.js` — already subscribes to all timeframes including 15m. No changes needed.

---

## TESTING

After applying patches:

```bash
# 1. Syntax check
node -e "require('./core/StrategyOrchestrator'); console.log('✅ Orchestrator loads')"

# 2. Full startup test (will fail at WebSocket but should get past module loading)
node run-empire-v2.js

# 3. Verify 15m candles are being received
# In logs, look for: "📊 V2: Received 15m OHLC from broker"
# Should appear every ~15 minutes, NOT every minute

# 4. Verify orchestrator is making decisions
# In logs, look for: "🎯 [ORCHESTRATOR] BUY | EMASMACrossover @ 65% | Confluence: 2x"
# Should NOT see: "TradingBrain" making entry decisions
```

---

## ROLLBACK

If anything breaks:
1. Remove the `require('./core/StrategyOrchestrator')` import
2. Remove `this.strategyOrchestrator = new StrategyOrchestrator(...)` from constructor
3. Restore the original `tradingBrain.getDecision()` block in `analyzeAndTrade()`
4. Change `timeframe === '15m'` back to `timeframe === '1m'`

The `core/StrategyOrchestrator.js` file can stay — it doesn't affect anything if not imported.

---

## THE TRADING THESIS

Two clean edges, no soup:

1. **Liquidity Sweep** — Institutional stop hunt on 15m candle. One good setup. Entry on reversal
   after the sweep. ExitContract: SL -1.5%, TP +2.5%, max hold 90 min.

2. **EMA/SMA Crossover + MA Dynamic S/R** — Buy retrace to support (EMA bounce), ride the trend
   until momentum reversal (crossover flip) or rubberband extension (trailing stop). ExitContract:
   SL -2.0%, TP +4.0%, trailing 1.5%, max hold 240 min.

Both strategies are already registered in the StrategyOrchestrator. Both have matching exit
contracts in ExitContractManager. Both modules exist (`modules/LiquiditySweepDetector.js`,
`modules/EMASMACrossoverSignal.js`, `modules/MADynamicSR.js`).

The other strategies (RSI extreme, pattern, regime, MTF, TPO) act as supporting confluence for
position sizing, not as primary entry triggers — they're unlikely to fire above 25% confidence
on their own unless conditions are extreme.
