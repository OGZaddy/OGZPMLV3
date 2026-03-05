# WIRE-BREAK-AND-RETEST.md

## PURPOSE

Wire `modules/BreakAndRetest.js` as Strategy #5 in StrategyOrchestrator.

## SOURCE

Desi Trades / Vincent Desano — Chart Fanatics podcast.
"Break & Retest" strategy. $400K+ year. ~$1M in 24 months.

## FILES

- `modules/BreakAndRetest.js` — The strategy module (ALREADY WRITTEN)
- `core/StrategyOrchestrator.js` — Register as strategy #5
- `run-empire-v2.js` — Instantiate and pass signal to orchestrator

## STEP 1: Instantiate in run-empire-v2.js

```javascript
// Near the top with other requires:
const BreakAndRetest = require('./modules/BreakAndRetest');

// In constructor or init:
this.breakRetestSignal = new BreakAndRetest();
```

## STEP 2: Call update() in the trading loop

Wherever the other strategy signals get updated (near maDynamicSRSignal.update, emaCrossoverSignal.update, etc.):

```javascript
// Update Break & Retest
const breakRetestResult = this.breakRetestSignal.update(candle, this.priceHistory);
```

## STEP 3: Pass signal to orchestrator extras

In the orchestrator.evaluate() call, add to extras:

```javascript
const orchResult = this.strategyOrchestrator.evaluate(
  indicators, patterns, regime, this.priceHistory,
  {
    emaCrossoverSignal: emaCrossoverResult,
    maDynamicSRSignal: maDynamicSRResult,
    liquiditySweepSignal: liquiditySweepResult,
    breakRetestSignal: breakRetestResult,   // ← ADD THIS
    nearestFibLevel: fibLevel,
    price: currentPrice,
  }
);
```

## STEP 4: Register strategy in StrategyOrchestrator._registerBuiltinStrategies()

Add after the LiquiditySweep strategy (strategy #3):

```javascript
// ─── 5. Break & Retest Strategy (Desi Trades) ───
this.strategies.push({
  name: 'BreakRetest',
  evaluate: (ctx) => {
    const sig = ctx.extras?.breakRetestSignal;
    if (!sig || sig.direction === 'neutral' || !sig.direction) return null;
    let conf = sig.confidence || 0;
    if (conf < 0.05) return null;

    // Fib level boost: retest at a fib level = extra confluence
    const fib = ctx.extras?.nearestFibLevel;
    let fibBoost = '';
    if (fib && fib.distance < 0.5) {
      const boost = fib.isGoldenZone ? 0.12 : 0.08;
      conf = Math.min(1.0, conf + boost);
      fibBoost = ` + Fib ${(fib.level * 100).toFixed(1)}%${fib.isGoldenZone ? ' GOLDEN' : ''}`;
    }

    // This strategy provides its own stop/TP from structure
    const overrideLevels = {};
    if (sig.stopLoss) overrideLevels.stopLoss = sig.stopLoss;
    if (sig.takeProfit) overrideLevels.takeProfit = sig.takeProfit;

    return {
      direction: sig.direction,
      confidence: conf,
      reason: sig.reason || `Break & Retest ${sig.direction}`,
      signalData: sig,
      overrideLevels,
    };
  }
});
```

## STEP 5: Add ExitContractManager defaults

In `core/ExitContractManager.js`, add a default contract for 'BreakRetest':

```javascript
BreakRetest: {
  stopLossPercent: -1.2,      // Tight — stop is at the level
  takeProfitPercent: 1.8,     // 1.5:1 R:R
  trailingStopPercent: -0.8,
  maxHoldBars: 30,            // Scalp to swing
  timeDecayStart: 20,
  scaleOutLevels: [
    { percent: 1.0, portion: 0.5 },  // Scale 50% at PT1 (1:1)
    { percent: 1.8, portion: 0.3 },  // Scale 30% at PT2
    // Let 20% run
  ]
},
```

## STEP 6: Add to StartupHealthCheck

```
CHECK 13: BreakAndRetest
  - EXISTS: breakRetestSignal is not null
  - HAS METHOD: breakRetestSignal.update is a function
  - FAIL MESSAGE: "BreakAndRetest module not loaded"
```

## VERIFICATION

After wiring, run backtest and look for these log lines:

```
🔄 [BreakRetest] Bar XXX: BREAK_BULLISH — Broke above XXXXX.XX (Xx tested)
🔄 [BreakRetest] Bar XXX: RETEST_BULLISH — Price returned to XXXXX.XX — entering Battle Zone
🔄 [BreakRetest] Bar XXX: ENTRY_LONG — BREAK_RETEST LONG: ...
🔄 [BreakRetest] Bar XXX: NTZ_SUPPRESSED — Signal suppressed — inside No Trade Zone
```

If you see BREAK_ but never ENTRY_, the battle zone conditions are too strict.
If you see zero BREAK_ lines, the breakConfirmPct or minBreakerBodyRatio is too tight.
If you see zero NTZ_SUPPRESSED, the NTZ might not be forming (check ntzMaxRangePct).

## KEY DIFFERENCES FROM OTHER STRATEGIES

| Feature | MADynamicSR | BreakAndRetest |
|---------|-------------|----------------|
| Market condition | Trending (pullback in trend) | Breakout (level break + retest) |
| Entry trigger | EMA touch + confirmation candle | Flag breakout after retest |
| Stop placement | Below 50 EMA | Below the broken level |
| Key filter | 123 pattern + S/R alignment | NTZ (No Trade Zone) |
| Best environment | Smooth trends | Level breaks with momentum |

They are COMPLEMENTARY — one catches trends, the other catches breakouts.
