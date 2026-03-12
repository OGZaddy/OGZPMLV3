# CLAUDE-CODE-STARTUP-HEALTHCHECK.md

## PURPOSE

Build `core/StartupHealthCheck.js` — a module that runs BEFORE the bot trades a single candle. It verifies every critical module is imported, instantiated, and responding. If ANY check fails, the bot REFUSES TO START and prints exactly what's broken.

This exists because modules keep getting disconnected silently. No more "it was never wired" discoveries weeks later.

---

## WHERE IT RUNS

In `run-empire-v2.js`, AFTER all modules are loaded but BEFORE the main trading loop starts. It should be one of the last things called in the constructor/init, right before the bot begins processing candles.

```javascript
// In run-empire-v2.js constructor or init:
const StartupHealthCheck = require('./core/StartupHealthCheck');
const healthCheck = new StartupHealthCheck();
const result = healthCheck.run({
  strategyOrchestrator: this.strategyOrchestrator,
  maDynamicSRSignal: this.maDynamicSRSignal,
  emaCrossoverSignal: this.emaCrossoverSignal,
  liquiditySweepSignal: this.liquiditySweepSignal,
  fibonacciDetector: this.fibonacciDetector,
  exitContractManager: getExitContractManager(),
  riskManager: this.riskManager,
  regimeDetector: this.regimeDetector,
  indicatorEngine: this.indicatorEngine,
  tradeLogger: tradeLogger,
  maExtensionFilter: this.strategyOrchestrator?.maExtensionFilter,
});

if (!result.passed) {
  console.error('❌ STARTUP HEALTH CHECK FAILED — REFUSING TO START');
  console.error(result.failures.join('\n'));
  process.exit(1);
}
console.log('✅ STARTUP HEALTH CHECK PASSED — All modules wired');
```

---

## CHECKS TO IMPLEMENT

Each check follows the same pattern:
1. Does the module exist (not null/undefined)?
2. Does it have the expected methods?
3. Can it respond to a basic call without crashing?

### CHECK 1: StrategyOrchestrator
```
- EXISTS: strategyOrchestrator is not null
- HAS METHOD: strategyOrchestrator.evaluate is a function
- HAS STRATEGIES: strategyOrchestrator.strategies.length >= 4
- LOG EACH: Print every strategy name registered
- FAIL MESSAGE: "StrategyOrchestrator missing or has < 4 strategies"
```

### CHECK 2: MADynamicSR (Strategy Module)
```
- EXISTS: maDynamicSRSignal is not null
- HAS METHOD: maDynamicSRSignal.update is a function
- FAIL MESSAGE: "MADynamicSR module not loaded"
```

### CHECK 3: EMASMACrossover (Strategy Module)
```
- EXISTS: emaCrossoverSignal is not null
- HAS METHOD: emaCrossoverSignal.update is a function
- FAIL MESSAGE: "EMASMACrossover module not loaded"
```

### CHECK 4: LiquiditySweep (Strategy Module)
```
- EXISTS: liquiditySweepSignal is not null
- HAS METHOD: liquiditySweepSignal.update is a function
- FAIL MESSAGE: "LiquiditySweep module not loaded"
```

### CHECK 5: MAExtensionFilter
```
- EXISTS: maExtensionFilter is not null
- HAS METHOD: maExtensionFilter.shouldTakeLong is a function
- HAS METHOD: maExtensionFilter.shouldTakeShort is a function
- HAS METHOD: maExtensionFilter.updateWithCandle is a function
- FAIL MESSAGE: "MAExtensionFilter not wired into orchestrator"
```

### CHECK 6: FibonacciDetector
```
- EXISTS: fibonacciDetector is not null
- HAS METHOD: fibonacciDetector.update is a function
- HAS METHOD: fibonacciDetector.getNearestLevel is a function
- FAIL MESSAGE: "FibonacciDetector not loaded"
```

### CHECK 7: ExitContractManager
```
- EXISTS: exitContractManager is not null
- HAS METHOD: exitContractManager.getContract is a function OR exitContractManager.createExitContract is a function
- FAIL MESSAGE: "ExitContractManager not loaded"
```

### CHECK 8: RiskManager
```
- EXISTS: riskManager is not null
- FAIL MESSAGE: "RiskManager not loaded"
```

### CHECK 9: MarketRegimeDetector
```
- EXISTS: regimeDetector is not null
- HAS METHOD: regimeDetector.getRegime is a function OR regimeDetector.detectRegime is a function
- FAIL MESSAGE: "MarketRegimeDetector not loaded"
```

### CHECK 10: IndicatorEngine
```
- EXISTS: indicatorEngine is not null
- FAIL MESSAGE: "IndicatorEngine not loaded"
```

### CHECK 11: TradeLogger
```
- EXISTS: tradeLogger is not null
- HAS METHOD: tradeLogger.logTrade is a function OR typeof tradeLogger === 'object'
- FAIL MESSAGE: "TradeLogger not loaded — trades will not be recorded"
```

### CHECK 12: Strategy Count Matches Orchestrator
```
- The number of strategies in orchestrator.strategies should match expected count
- Print each strategy name and its index
- WARN if any strategy name is 'undefined' or empty
```

---

## OUTPUT FORMAT

```
════════════════════════════════════════════════
  OGZPrime STARTUP HEALTH CHECK
════════════════════════════════════════════════
  ✅ StrategyOrchestrator: LOADED (4 strategies)
     → Strategy 0: CandlePattern
     → Strategy 1: MADynamicSR
     → Strategy 2: EMASMACrossover
     → Strategy 3: LiquiditySweep
  ✅ MADynamicSR: LOADED (has update method)
  ✅ EMASMACrossover: LOADED (has update method)
  ✅ LiquiditySweep: LOADED (has update method)
  ✅ MAExtensionFilter: LOADED (has shouldTakeLong/Short)
  ✅ FibonacciDetector: LOADED (has update + getNearestLevel)
  ✅ ExitContractManager: LOADED
  ✅ RiskManager: LOADED
  ✅ MarketRegimeDetector: LOADED
  ✅ IndicatorEngine: LOADED
  ✅ TradeLogger: LOADED
  ✅ Strategy count: 4/4 expected
════════════════════════════════════════════════
  RESULT: ALL CHECKS PASSED ✅
════════════════════════════════════════════════
```

If anything fails:
```
════════════════════════════════════════════════
  OGZPrime STARTUP HEALTH CHECK
════════════════════════════════════════════════
  ✅ StrategyOrchestrator: LOADED (3 strategies)  ⚠️ EXPECTED 4
     → Strategy 0: CandlePattern
     → Strategy 1: MADynamicSR
     → Strategy 2: LiquiditySweep
  ❌ EMASMACrossover: NOT LOADED
  ✅ MAExtensionFilter: LOADED
  ...
════════════════════════════════════════════════
  RESULT: FAILED ❌ — 2 issues found
  1. EMASMACrossover module not loaded
  2. StrategyOrchestrator has 3 strategies, expected 4
  
  BOT WILL NOT START. Fix wiring and restart.
════════════════════════════════════════════════
```

---

## RETURN VALUE

```javascript
// The run() method returns:
{
  passed: true/false,
  checks: 12,
  passed_count: 12,
  failed_count: 0,
  failures: [],        // Array of failure message strings
  warnings: [],        // Array of warning message strings
  timestamp: Date.now()
}
```

---

## RULES

1. **NEVER remove or weaken a check.** Only ADD new ones.
2. **If a new module gets wired into the bot, ADD a check for it here.**
3. **FAIL = bot does not start. No exceptions. No "we'll fix it later."**
4. **Every check must have a clear, specific failure message that tells you exactly what to fix.**
5. **This file runs in < 100ms. No network calls, no disk I/O, no heavy computation. Just existence and method checks.**
6. **Do NOT put KillSwitch in this checklist. It is intentionally removed.**

---

## FUTURE CHECKS TO ADD

When these modules get wired, add checks for them:
- SupportResistanceDetector (when wired into orchestrator)
- CandlePatternDetector (when wired into orchestrator)
- PatternQualityScoring (when wired as sizing filter)
- EMACalibrator (when wired into MADynamicSR startup)
