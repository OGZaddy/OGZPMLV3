# OGZPrime Pipeline Rewrite Spec — FINAL
## Three-Audit Merged Blueprint

**Date:** 2026-03-04
**Audited by:** Claude Opus 4.6, Claude Deep Search, Grok (2 versions)
**Verified against:** refactor/modular-architecture branch, post-swing-fix commit
**Rule:** If it's not in this spec, it doesn't get built. Period.

---

## 1. CURRENT STATE (Verified Facts)

### What Works
- Exit contracts: per-strategy owned exits, validated across 45K candles
- StrategyOrchestrator: winner-takes-all design, strategies compete independently
- IndicatorEngine: RSI/MACD/EMA/BB/ATR battle-tested
- Signal modules: EMACrossover, MADynamicSR (post-swing-fix), LiquiditySweep all producing signals
- CandleProcessor.processNewCandle(): canonical ingestion path exists and works

### What's Broken
- 12+ independent blocking gates between signal and execution
- Fee values wrong in 3 places (0.32%, 0.35%, 0.52% — actual Kraken = 0.25% maker)
- Two hard stop losses at different levels (-1.5% and -2.0%)
- Confidence thresholds in 4+ locations
- EntryDecider has 120+ lines of legacy exit logic that runs parallel to ExitContractManager
- Variable named `brainDecision` creates confusion but brain is NOT actually called (confirmed)
- EMACrossover max theoretical confidence ~0.80, practical max ~0.45 (base 0.45 × confluenceRatio)
- Position sizing uses `maxPositionSize` (5%) as base, not `basePositionSize` (1%)

### Three-Audit Agreement
All three audits independently confirmed:
1. OptimizedTradingBrain imported + instantiated but getDecision() never called (orchestrator replaced it)
2. 12+ entry gates with scattered thresholds
3. Exit side clean when using exitContract path
4. Fee values wrong and inconsistent across modules
5. Confidence thresholds defined in 4+ places
6. Dead modules present but not called

### Audit Disagreements (Resolved)
- **Grok said brain is in live path** → WRONG. Verified: `brainDecision` variable is mapped FROM orchestrator output, not from brain.getDecision(). Brain is instantiated but never queried for decisions.
- **Deep Search said 21 gates** → CORRECT but includes exit gates. Entry has ~8, exit has ~13. Spec separates them.
- **Grok 2nd version said TradeIntelligenceEngine is active** → PARTIALLY RIGHT. It runs in shadow mode (`tradeIntelligenceShadowMode`), logs but doesn't block.

---

## 2. THE SINGLE CONFIG FILE

**`TradingConfig.js` is the ONLY source of truth.**

### Violations Found (all three audits combined):

| Module | What's Wrong | Fix |
|--------|-------------|-----|
| ExitContractManager.js:42-122 | Full duplicate exit contracts hardcoded | Read TradingConfig.getExitContract() |
| ExitContractManager.js:138 | Hard SL -2.0% hardcoded | Read TradingConfig.universalLimits |
| EntryDecider.js:422 | Hard SL -1.5% hardcoded (CONFLICTS with ECM -2.0%) | KILL — use only ECM universal limit |
| EntryDecider.js:416,475 | Fee buffer 0.35% hardcoded (wrong value) | Read TradingConfig.fees |
| OrderExecutor.js:48 | MIN_BUY_CONFIDENCE reads config but duplicates gate | KILL — orchestrator + TradingLoop gate is enough |
| OrderExecutor.js:61 | MIN_SELL_CONFIDENCE = 30% hardcoded | Read TradingConfig or KILL |
| OrderExecutor.js:78 | Uses maxPositionSize as base (semantic mismatch) | Fix: use basePositionSize, cap at maxPositionSize |
| OrderExecutor.js:87-88 | Confidence scaling 0.5-2.5 with slope 4.0 hardcoded | Move to TradingConfig.positionSizing |
| OrderExecutor.js:667 | Fee calc 0.52% hardcoded | Read TradingConfig.fees |
| StrategyOrchestrator.js:39 | minStrategyConfidence 0.35 with ?? fallback | Read TradingConfig only |
| StrategyOrchestrator.js:82,112,172,206,274 | Per-strategy `conf < 0.05` / `conf < 0.10` hardcoded | Read TradingConfig per-strategy minimum |
| RiskManager.js:23 | baseConfidenceThreshold 0.3 hardcoded | Read TradingConfig |
| TradingLoop.js:84-99 | RSI smoothing weights 0.5/0.3/0.2 hardcoded | Read TradingConfig or KILL |
| TradingLoop.js:269 | TEST_CONFIDENCE from process.env | KILL |
| AdaptiveTimeframeSelector | feePercent: 0.26 hardcoded | Read TradingConfig.fees |
| MADynamicSR.js | emaPeriod=20/50, touchZonePct=0.6, atrAccel=1.2 | Read TradingConfig.strategies |
| TradingConfig.js:231-234 | Fee values WRONG (0.10%/0.15%/0.35%) | Fix to 0.25%/0.40%/0.50% (actual Kraken) |

### Add to TradingConfig.js:

```javascript
strategies: {
  MADynamicSR: {
    emaPeriod: env('MASR_EMA_PERIOD', 20),
    trendEmaPeriod: env('MASR_TREND_EMA', 50),
    touchZonePct: env('MASR_TOUCH_ZONE', 0.6),
    srTestCount: env('MASR_SR_TESTS', 2),
    atrAcceleration: env('MASR_ATR_ACCEL', 1.2),
    enableExtensionFilter: envBool('MASR_EXTENSION_FILTER', true),
  },
  EMACrossover: { /* periods, thresholds */ },
  LiquiditySweep: { /* sweep params */ },
  RSI: {
    oversoldLevel: env('RSI_OVERSOLD', 30),
    overboughtLevel: env('RSI_OVERBOUGHT', 70),
  },
},

// FIX FEES TO ACTUAL KRAKEN VALUES
fees: {
  makerFee: env('FEE_MAKER', 0.0025),       // 0.25% maker (Kraken Pro)
  takerFee: env('FEE_TAKER', 0.0040),        // 0.40% taker
  slippage: env('FEE_SLIPPAGE', 0.0005),      // 0.05% slippage
  totalRoundTrip: env('FEE_TOTAL_ROUNDTRIP', 0.0050), // 0.50% (maker both sides)
},
```

---

## 3. MODULE AUDIT — KEEP / KILL / REWRITE

### KEEP (don't touch)

| Module | Lines | Why |
|--------|-------|-----|
| TradingConfig.js | 350 | Add strategy section + fix fees, otherwise solid |
| IndicatorEngine.js | 1505 | Battle-tested, computes everything |
| StrategyOrchestrator.js | 617 | Design is sound. Remove hardcoded minimums, read config |
| ExitContractManager.js | ~200 | Remove hardcoded contracts, read TradingConfig |
| CandleHelper.js | ~50 | Utility |
| CandleStore.js | ~200 | Storage |
| CandleAggregator.js | ~200 | 1m→15m aggregation |
| StateManager.js | ~300 | Singleton, position/balance truth |
| KrakenAdapterV2.js | ~500 | Exchange API |
| WebSocketManager.js | ~300 | Dashboard WS |
| RiskManager.js | ~300 | KEEP but remove hardcoded values |
| OrderRouter.js | ~200 | Routing layer |
| MaxProfitManager.js | ~300 | Profit tracking, validated |
| VolumeProfile.js | ~400 | VP chop filter works |
| FibonacciDetector.js | ~200 | Fib levels for strategy boosting |
| MAExtensionFilter.js | ~200 | Extension filtering for MASR |
| DashboardBroadcaster.js | ~300 | Dashboard |
| PatternMemoryStore.js | ~200 | Pattern storage |
| EnhancedPatternRecognition.js | ~400 | Pattern detection |
| RegimeDetector.js | ~200 | Market regime |
| FeatureFlagManager.js | ~200 | Feature flags |

### KILL (remove from codebase)

| Module | Lines | Why |
|--------|-------|-----|
| OptimizedTradingBrain.js | 3532 | Instantiated but getDecision() never called. Dead weight. Contains duplicate SL/TP/trail values, duplicate indicator calcs. Variable named `brainDecision` in TradingLoop just maps from orchestrator — rename variable, delete module. |
| SignalGenerator.js | ~400 | Old middleman replaced by orchestrator |
| ScalpSignalManager.js | ~200 | Not instantiated, not called |
| GridTradingStrategy.js | ~300 | Feature-flagged off, different trading style |
| TradingOptimizations.js | ~400 | PatternStatsManager wrapper, barely used |
| TradingProfileManager.js | ~200 | Profiles in TradingConfig now |
| AdvancedExecutionLayer-439-MERGED.js | ~700 | Legacy, replaced by OrderRouter+OrderExecutor |
| EventLoopMonitor | — | Explicitly disabled (line 639: null) |
| ExchangeReconciler | — | Removed (comment: "causing more problems") |
| PersistentPatternMap.js | ~200 | Replaced by PatternMemoryStore |

### REWRITE

| Module | Lines | What's Wrong | Target |
|--------|-------|-------------|--------|
| MADynamicSR.js | 634 | Swing bug fixed but 123 pattern still 52/47 not 50/50. Acceleration filter may be too tight. All params hardcoded. | 200 lines. Clean EMA bounce + confirmation + trend. Params from TradingConfig. |
| TradingLoop.js | 473 | Maps orchResult to `brainDecision` variable. Spot conversion. RSI smoothing. TEST_CONFIDENCE. | 250 lines. Clean variable names. Inline gates. Backtest flag. |
| EntryDecider.js | ~500 | 120 lines of legacy exit logic (hard SL -1.5%, brain sell, gradual exit, confidence drop). Runs parallel to ExitContractManager. | SPLIT: Entry logic → TradingLoop inline (20 lines). Exit logic → ExitContractManager only. Delete file. |
| EntryGateChecker.js | ~100 | 4 checks in a separate file | Inline into TradingLoop |
| OrderExecutor.js | ~700 | Duplicate confidence gates, wrong position sizing base, hardcoded fee calc, aggressive learning mode | 300 lines. Remove duplicate gates. Fix sizing. Read config. |
| CandleProcessor.js | ~350 | handleMarketData has duplicate indicator feeding logic | 200 lines. One function: processNewCandle. Kill duplication. |

---

## 4. THE CLEAN PIPELINE

```
WebSocket/File
      │
      ▼
CandleProcessor.processNewCandle(candle)
      │
      ├── IndicatorEngine.updateCandle()
      ├── emaCrossover.update(candle, history)
      ├── maDynamicSR.update(candle, history)
      ├── liquiditySweep.feedCandle(candle)
      ├── breakAndRetest.update(candle, history)
      ├── mtfAdapter.ingestCandle(candle)
      ├── volumeProfile.update(candle, history)
      │
      ▼
TradingLoop.evaluate(indicators, extras, history)
      │
      ├── orchResult = StrategyOrchestrator.evaluate(...)
      │     ├── 9 strategies compete independently
      │     ├── Winner = highest confidence above threshold
      │     ├── VP chop filter (trend strategies only)
      │     └── Returns: { action, direction, confidence, winnerStrategy, exitContract }
      │
      ├── if orchResult.action === 'HOLD' → done
      │
      ├── GATE 1: confidence >= TradingConfig.confidence.minTradeConfidence
      ├── GATE 2: RiskManager.assess() — drawdown, daily loss, position limits
      ├── GATE 3: shorts check — if direction=sell && !enableShorts && position=0 → hold
      │
      ├── if BACKTEST_MODE → record trade, skip broker
      ├── else → OrderExecutor.execute() → Kraken
      │
      ▼
Position Open → ExitContractManager.assign(exitContract)
      │
      ├── Every candle: ExitContractManager.checkExit(position, price)
      │     ├── Stop loss (per-strategy from contract)
      │     ├── Take profit
      │     ├── Tiered exits (T1/T2/T3)
      │     ├── Trailing stop
      │     ├── Max hold time
      │     └── Universal hard stop (-2.0%)
      │
      ▼
Position Close → StateManager → PnLTracker → TradeJournal
```

### What's different from current:
- No OptimizedTradingBrain anywhere
- No SignalGenerator
- No EntryDecider / EntryGateChecker (merged inline)
- No `brainDecision` variable (renamed to `orchResult`)
- No duplicate confidence gate in OrderExecutor
- No legacy exit logic in EntryDecider (-1.5% hard stop, brain sell, gradual exit, confidence drop — all GONE, ExitContractManager handles everything)
- BACKTEST_MODE is a flag in the same pipeline, not a separate script
- Three entry gates total, all reading from TradingConfig

---

## 5. COMPLETE GATE INVENTORY

### Entry Gates (only these exist)

| # | Gate | Location | Config Key | Default | Source |
|---|------|----------|-----------|---------|--------|
| 1 | Strategy confidence minimum | StrategyOrchestrator | confidence.minStrategyConfidence | 0.35 | Per strategy |
| 2 | Confluence count | StrategyOrchestrator | confidence.minConfluenceCount | 1 | — |
| 3 | VP Chop filter | StrategyOrchestrator | features.enableVPChopFilter | true | Trend strategies only |
| 4 | MAExtension filter | StrategyOrchestrator | strategies.MADynamicSR.enableExtensionFilter | true | MASR only |
| 5 | Trade confidence minimum | TradingLoop | confidence.minTradeConfidence | 0.50 | Global |
| 6 | Risk assessment | TradingLoop | risk.* | — | Drawdown/daily/weekly |
| 7 | Shorts check | TradingLoop | features.enableShorts | false | Spot market |

### Exit Gates (ExitContractManager only)

| # | Gate | Source | Notes |
|---|------|--------|-------|
| 1 | Strategy stop loss | Per-strategy contract | From TradingConfig.exitContracts |
| 2 | Strategy take profit | Per-strategy contract | From TradingConfig.exitContracts |
| 3 | Tier 1 profit | MaxProfitManager | 0.7% |
| 4 | Tier 2 profit | MaxProfitManager | 1.0% |
| 5 | Tier 3 profit | MaxProfitManager | 1.5% |
| 6 | Trailing stop | Per-strategy contract | After activation threshold |
| 7 | Max hold time | Per-strategy contract | Strategy-specific |
| 8 | Universal hard stop | ExitContractManager | -2.0% (one value, one place) |
| 9 | Account drawdown | ExitContractManager | -10% force close all |

### KILLED GATES (do not recreate)

| Gate | Was In | Why Kill |
|------|--------|----------|
| Brain direction === 'buy' | TradingLoop:258 | Brain is dead, orchestrator provides direction |
| Hard SL -1.5% | EntryDecider:422 | Conflicts with ECM -2.0%. One hard stop, one place. |
| Brain sell signal exit | EntryDecider:443 | Brain is dead |
| Emergency sell -2% | EntryDecider:479 | Duplicate of ECM universal |
| Gradual loss exit (5min) | EntryDecider:482 | Arbitrary, not validated |
| Confidence drop 50% | EntryDecider:509 | Not validated, causes premature exits |
| Legacy profit exit 0.35% | EntryDecider:437 | Replaced by tiered exits |
| BUY confidence floor | OrderExecutor:48 | Duplicate of TradingLoop gate 5 |
| SELL confidence minimum 30% | OrderExecutor:61 | ExitContractManager handles exits |
| TEST_CONFIDENCE override | TradingLoop:269 | Use TradingConfig, not env hacks |
| TRAI veto | run-empire-v2.js | Feature-flagged, never validated |
| Pattern dominance gate | TradingLoop | Never validated |
| Aggressive learning threshold | TradingLoop | Hack, not a real gate |
| RSI smoothing weights | TradingLoop:84-99 | Modifying indicator values before orchestrator sees them |
| Desync guard | EntryGateChecker | Good concept but move to StateManager validation |
| Position limit (tier-based) | EntryGateChecker | Move to RiskManager |

---

## 6. PARAMETER REGISTRY

### Exit Parameters (VALIDATED — do NOT change)

| Parameter | Config Key | Value | Validated |
|-----------|-----------|-------|-----------|
| Stop Loss | exits.stopLossPercent | 2.0% | ✅ Round 1, 15 runs |
| Take Profit | exits.takeProfitPercent | 2.5% | ✅ Round 1 |
| Tier 1 | exits.profitTiers.tier1 | 0.7% | ✅ Round 1 |
| Tier 2 | exits.profitTiers.tier2 | 1.0% | ✅ Round 1 |
| Tier 3 | exits.profitTiers.tier3 | 1.5% | ✅ Round 1 |
| Universal hard SL | universalLimits.hardStopLossPercent | -2.0% | Set |

### Confidence Parameters

| Parameter | Config Key | Value | Status |
|-----------|-----------|-------|--------|
| Min trade confidence | confidence.minTradeConfidence | 0.50 | ✅ Round 2 |
| Min strategy confidence | confidence.minStrategyConfidence | 0.35 | Set, not tuned |
| Min confluence | confidence.minConfluenceCount | 1 | Set |

### Fee Parameters (CORRECTED)

| Parameter | Config Key | Value | Notes |
|-----------|-----------|-------|-------|
| Maker fee | fees.makerFee | 0.0025 (0.25%) | Kraken Pro actual |
| Taker fee | fees.takerFee | 0.0040 (0.40%) | Kraken Pro actual |
| Slippage | fees.slippage | 0.0005 (0.05%) | Estimate |
| Round trip | fees.totalRoundTrip | 0.0050 (0.50%) | Maker both sides |

### Strategy Parameters

| Parameter | Config Key | Current | Notes |
|-----------|-----------|---------|-------|
| MASR entry EMA | strategies.MADynamicSR.emaPeriod | 20 | Tuned from 50 |
| MASR trend EMA | strategies.MADynamicSR.trendEmaPeriod | 50 | Tuned from 200 |
| MASR touch zone | strategies.MADynamicSR.touchZonePct | 0.6% | Not tuned |
| MASR ATR accel | strategies.MADynamicSR.atrAcceleration | 1.2x | Not tuned |
| RSI oversold | strategies.RSI.oversoldLevel | 30 | Standard |
| RSI overbought | strategies.RSI.overboughtLevel | 70 | Standard |

---

## 7. REWRITE ORDER (6 Phases)

### Phase 1: Config + Fees Fix (1 hour)
1. Fix fee values in TradingConfig.js to actual Kraken rates
2. Add `strategies` section to TradingConfig.js
3. ExitContractManager: delete hardcoded contracts, read TradingConfig.getExitContract()
4. Remove all process.env reads for trading params from modules
5. **Test:** `TradingConfig.printSummary()` correct. ExitContractManager returns TradingConfig values.

### Phase 2: Kill Dead Modules (30 min)
1. Delete OptimizedTradingBrain.js (3,532 lines gone)
2. Delete SignalGenerator.js
3. Delete ScalpSignalManager, GridTradingStrategy, TradingProfileManager, AdvancedExecutionLayer, PersistentPatternMap, TradingOptimizations
4. Remove all require() statements for killed modules in run-empire-v2.js
5. Remove brain instantiation from bot constructor (lines 428-435)
6. Remove brain references from ctx objects (lines 467, 597, 763, 786)
7. **Test:** Bot starts without errors. No missing module crashes.

### Phase 3: Clean TradingLoop + Kill EntryDecider (2 hours)
1. Rename `brainDecision` → `orchResult` everywhere in TradingLoop
2. Remove RSI smoothing (lines 84-99)
3. Remove TEST_CONFIDENCE override (line 269)
4. Remove AGGRESSIVE_LEARNING_MODE threshold hack
5. Inline gate checks from EntryGateChecker (desync → StateManager, drawdown + risk → RiskManager)
6. Delete EntryDecider.js — move ONLY the maxProfitManager exit check to ExitContractManager
7. Delete EntryGateChecker.js
8. Remove all legacy exit logic (brain sell, gradual exit, confidence drop, legacy profit)
9. Add BACKTEST_MODE flag: if true, skip OrderExecutor, record trade to journal
10. **Test:** 45K candle backtest through production pipeline with BACKTEST_MODE=true

### Phase 4: Clean OrderExecutor (1 hour)
1. Remove duplicate BUY confidence gate (line 48) — TradingLoop handles this
2. Remove SELL confidence minimum (line 61) — ExitContractManager handles exits
3. Fix position sizing: use basePositionSize, cap at maxPositionSize
4. Move confidence scaling params to TradingConfig.positionSizing
5. Fix fee calculation to read TradingConfig.fees
6. Remove aggressive learning position boost
7. **Test:** Verify position sizes match expected values for given confidence levels

### Phase 5: Clean CandleProcessor (1 hour)
1. processNewCandle() is the ONE entry point
2. Delete handleMarketData() duplicate indicator feeding
3. handleMarketData() only does: validate → normalize → dedup → gap check → call processNewCandle()
4. processNewCandle() returns { indicators, extras, priceHistory } for TradingLoop
5. **Test:** Feed 100 candles, all signal modules produce output

### Phase 6: Validate (1 hour)
1. Run full 45K with BACKTEST_MODE through production pipeline
2. Compare against known baseline (+0.76% gross with shorts, 728 trades)
3. Run with FEES_PCT=0.25
4. Run on validation-2023.json (out of sample)
5. Per-strategy breakdown: RSI, MADynamicSR, EMACrossover, LiquiditySweep
6. **Acceptance:** Numbers within 10% of standalone tuning backtest. If not, trace discrepancy.

---

## 8. FILES CHANGED

| File | Action | Lines Before → After |
|------|--------|---------------------|
| core/TradingConfig.js | EDIT: add strategies, fix fees | 350 → 400 |
| core/ExitContractManager.js | EDIT: read TradingConfig | 200 → 100 |
| core/TradingLoop.js | REWRITE | 473 → 250 |
| core/OrderExecutor.js | REWRITE | 700 → 300 |
| core/CandleProcessor.js | CLEAN | 350 → 200 |
| core/EntryDecider.js | DELETE | 500 → 0 |
| core/EntryGateChecker.js | DELETE | 100 → 0 |
| core/OptimizedTradingBrain.js | DELETE | 3532 → 0 |
| core/SignalGenerator.js | DELETE | 400 → 0 |
| core/ScalpSignalManager.js | DELETE | 200 → 0 |
| core/GridTradingStrategy.js | DELETE | 300 → 0 |
| core/TradingProfileManager.js | DELETE | 200 → 0 |
| core/AdvancedExecutionLayer-439-MERGED.js | DELETE | 700 → 0 |
| core/TradingOptimizations.js | DELETE | 400 → 0 |
| core/PersistentPatternMap.js | DELETE | 200 → 0 |
| run-empire-v2.js | EDIT: remove dead imports | 2035 → ~1800 |

**Lines removed:** ~7,000+
**Lines after:** ~3,250 cleaner lines

---

## 9. KNOWN BUGS FIXED BY THIS REWRITE

| Bug | Root Cause | Fixed By |
|-----|-----------|----------|
| Two hard stops (-1.5% and -2.0%) | EntryDecider + ECM both have hard stops | Kill EntryDecider, one hard stop in ECM |
| Fees wrong (0.32/0.35/0.52 vs actual 0.25) | Scattered hardcoded values | One fee config in TradingConfig |
| RSI smoothing distorts indicator values | TradingLoop modifies RSI before orchestrator | Kill smoothing |
| Position sizing uses max as base | OrderExecutor:78 reads maxPositionSize | Fix to basePositionSize |
| Legacy exits run parallel to exitContract | EntryDecider brain sell/gradual/confidence exits | Kill EntryDecider |
| brainDecision variable confusion | Misleading name suggests brain is active | Rename to orchResult |
| Confidence gate checked 3 times | Orchestrator + TradingLoop + OrderExecutor | One gate in TradingLoop |
| SELL blocked at 30% confidence | OrderExecutor:61 hardcoded minimum | ExitContractManager handles all exits |
| Pattern P&L never recorded | PatternMemoryBank exit recording missing | Wire in Phase 6 if time |
| TEST_CONFIDENCE bypasses real config | process.env hack in TradingLoop | Kill, use TradingConfig |

---

## 10. GOLDEN RULES FOR CLAUDE CODE

1. **Every parameter in TradingConfig.js or it doesn't exist.** Zero process.env reads in modules.
2. **One code path.** BACKTEST_MODE is a flag. Same pipeline, skip broker.
3. **No caching patterns.** Compute fresh. No ratchets.
4. **Every gate logs.** `[GATE:name] BLOCKED: reason (value vs threshold)`
5. **Modules have clean interfaces.** In: candle/indicators/config. Out: signal. No side effects.
6. **Test after every phase.** One phase, verify, commit, next.
7. **Don't touch exit tiers.** SL=2.0%, Tiers 0.7/1.0/1.5% are validated across 45K candles.
8. **Don't touch IndicatorEngine.** It works. Leave it alone.
9. **Read this spec before writing any code.** If it's not in the spec, ask.
10. **Three entry gates. Nine exit conditions. That's it.** Anything else is a bug.
