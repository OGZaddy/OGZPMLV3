═══════════════════════════════════════════════════════════════════════════════
  PHASES 4-14 EXTRACTION ROADMAP — Completing the Monolith Breakup
  
  For: Claude Code (executor) + Claude Desktop (architect)
  From: Claude Desktop analysis of codebase + refactor plan
  Date: 2026-02-28
  
  BASELINE: run-empire-v2.js = 4,583 lines
  TARGET:   run-empire-v2.js = ~500 lines (orchestrator only)
  
  STATUS OF PRIOR WORK:
  ✅ Phase 0: ContractValidator (created, corrected, wired)
  ✅ Phase 1: CandleStore + IndicatorCalculator (created, wired)
  ✅ Phase 2: IndicatorSnapshot (created, corrected, wired at line 1660)
  ✅ Phase 3: CandleAggregator + RegimeDetector (created, corrected, wired at line 1840)
  ✅ Dead code removal: MarketRegimeDetector + OptimizedIndicators imports removed
  🅿️ TradingConfig.js: Committed standalone, NOT wired (format bugs to fix later)
  
  RULES (SAME AS PHASES 0-3):
  1. ONE phase at a time
  2. Golden test after EACH phase
  3. If golden test fails → REVERT and STOP
  4. Commit after each passing phase
  5. No "improvements" — extract EXACTLY what's there
  6. Run pipeline-audit.js when instructed
═══════════════════════════════════════════════════════════════════════════════


══════════════════════════════════════════════════════════════════════════
  RUNNER ANATOMY — Where Everything Lives Right Now
══════════════════════════════════════════════════════════════════════════

  Lines 1-257:      Imports + module loading (~257 lines)
  Lines 338-1157:   Constructor + setup (~819 lines)
  Lines 1157-1528:  start() + WebSocket connection (~371 lines)
  Lines 1528-1648:  Historical data loading (~120 lines)
  Lines 1648-2630:  analyzeAndTrade() — THE MAIN LOOP (~982 lines)
  Lines 2630-3517:  executeTrade() + exit handling (~887 lines)
  Lines 3517-3752:  loadHistoricalDataAndBacktest() (~235 lines)
  Lines 3752-4196:  TRAI/web search/misc (~444 lines)
  Lines 4196-4583:  shutdown() + main() (~387 lines)

  BIGGEST EXTRACTION TARGETS:
  1. analyzeAndTrade() = 982 lines → becomes ~50 lines calling modules
  2. executeTrade() + exits = 887 lines → becomes ~30 lines
  3. Constructor = 819 lines → becomes ~100 lines (just wiring modules)


══════════════════════════════════════════════════════════════════════════
  PHASE 4: FeatureExtractor + PatternMemoryStore
  Risk: LOW — Pure data layer, no side effects
══════════════════════════════════════════════════════════════════════════

WHAT: Extract pattern feature extraction and pattern storage.
WHERE IN RUNNER: Pattern analysis block in analyzeAndTrade() (~lines 1780-1835)
EXISTING FILES: core/EnhancedPatternRecognition.js (43K), trai_brain/PatternMemoryBank.js (20K)

EXTRACT:
  1. core/FeatureExtractor.js — Pure function that takes indicators → returns 
     normalized feature vector {rsiZone, trendStrength, volatilityLevel, bbPosition, 
     volumeProfile, priceAction, structureType}. All features 0-1.
  2. core/PatternMemoryStore.js — Stores patterns, tracks win rates, returns 
     similar historical patterns. Wraps PatternMemoryBank with contract validation.

WHY INSTRUMENT-AGNOSTIC: Features are computed from normalized indicators.
RSI zone is RSI zone whether it's BTC or AAPL. Pattern storage is symbol-tagged
so multi-instrument is automatic.

GOLDEN TEST: Pattern analysis still runs. Same patterns detected.
COMMIT: "refactor(phase4): Extract FeatureExtractor + PatternMemoryStore"


══════════════════════════════════════════════════════════════════════════
  PHASE 5: OrderRouter + KrakenBroker abstraction
  Risk: LOW — Isolated I/O, can mock for testing
══════════════════════════════════════════════════════════════════════════

WHAT: Create broker abstraction layer. THIS IS THE MULTI-INSTRUMENT KEY.
WHERE IN RUNNER: WebSocket connection (~lines 700-1157), order execution in 
  executeTrade() (~lines 2730-2770), kraken_adapter references throughout
EXISTING FILES: core/KrakenAdapterV2.js (11K), brokers/ directory (already exists!)

EXTRACT:
  1. core/OrderRouter.js — Routes orders to correct broker by symbol.
     registerBroker(adapter, symbols), sendOrder(order), getAllPositions()
  2. Formalize brokers/IBrokerAdapter.js interface (already exists at 9.5K)
  3. Wire KrakenAdapterV2 to implement IBrokerAdapter properly

WHY THIS MATTERS: After this phase, adding Alpaca (stocks) means:
  - Create brokers/AlpacaAdapter.js implementing IBrokerAdapter
  - Register: orderRouter.registerBroker(alpaca, ['AAPL', 'SPY', 'TSLA'])
  - Signal engine already works on any price series
  - ZERO changes to run-empire-v2.js

GOLDEN TEST: Orders still execute through Kraken. No behavior change.
COMMIT: "refactor(phase5): Extract OrderRouter + broker abstraction"


══════════════════════════════════════════════════════════════════════════
  PHASE 6: SignalGenerator + SignalRanker
  Risk: MEDIUM — Core trading logic
══════════════════════════════════════════════════════════════════════════

WHAT: Extract the strategy evaluation pipeline.
WHERE IN RUNNER: StrategyOrchestrator usage in analyzeAndTrade() (~lines 1855-2100)
EXISTING FILES: core/StrategyOrchestrator.js (already handles per-strategy eval)

EXTRACT:
  1. core/SignalGenerator.js — Wraps StrategyOrchestrator. Takes indicators + 
     regime + candles → returns array of Signal objects. Each signal has 
     {strategy, action, confidence(0-100), entryPrice, stopLoss, takeProfit, reason}
  2. core/SignalRanker.js — Takes Signal[] → returns best signal (or null).
     Handles confidence threshold filtering, confluence detection, signal ranking.

WHY: Currently analyzeAndTrade() has ~250 lines of signal evaluation, 
confidence adjustment, TRAI integration, and signal selection scattered through it.
This collapses to: signals = signalGenerator.generate(indicators, regime, candles);
                    bestSignal = signalRanker.rank(signals);

GOLDEN TEST: Same trades taken. Signal confidence values identical.
COMMIT: "refactor(phase6): Extract SignalGenerator + SignalRanker"


══════════════════════════════════════════════════════════════════════════
  PHASE 7: PatternRecognitionStrategy
  Risk: MEDIUM — Uses PatternMemoryStore from Phase 4
══════════════════════════════════════════════════════════════════════════

WHAT: Extract pattern-based strategy into standalone module.
WHERE IN RUNNER: Pattern matching + confidence adjustment in analyzeAndTrade()
EXISTING FILES: core/EnhancedPatternRecognition.js (43K — this is huge)

EXTRACT:
  1. core/strategies/PatternRecognitionStrategy.js — Implements StrategyBase.
     Takes indicators + patterns → returns Signal with pattern-based confidence.
  2. Integrate with FeatureExtractor (Phase 4) for consistent feature computation.

GOLDEN TEST: Pattern-based signals match baseline.
COMMIT: "refactor(phase7): Extract PatternRecognitionStrategy"


══════════════════════════════════════════════════════════════════════════
  PHASE 8: DrawdownTracker + PnLTracker + RiskAssessor
  Risk: MEDIUM — Independent risk calculations
══════════════════════════════════════════════════════════════════════════

WHAT: Extract risk management into standalone modules.
WHERE IN RUNNER: Risk checks scattered through constructor, analyzeAndTrade(),
  and executeTrade(). MaxDrawdown gates, daily loss limits, etc.
EXISTING FILES: Some in StateManager, some hardcoded in runner

EXTRACT:
  1. core/DrawdownTracker.js — Tracks peak balance, current drawdown, max drawdown.
     Pure math: trackBalance(newBalance) → {currentDrawdown, maxDrawdown, isLiquidating}
  2. core/PnLTracker.js — Track P&L by hour/day/week. Daily loss limit enforcement.
     trackTrade(closedTrade) → updates running P&L. getDailyPnL() → number.
  3. core/RiskAssessor.js — Combines DrawdownTracker + PnLTracker.
     assessRisk() → {riskLevel: 'low'|'medium'|'high'|'critical', canTrade: boolean}

GOLDEN TEST: Same risk gates fire. Same trades blocked/allowed.
COMMIT: "refactor(phase8): Extract DrawdownTracker + PnLTracker + RiskAssessor"


══════════════════════════════════════════════════════════════════════════
  PHASE 9: EntryDecider + EntryGateChecker
  Risk: MEDIUM — FIXES BUG: Gates must run BEFORE order execution
══════════════════════════════════════════════════════════════════════════

WHAT: Extract entry decision logic with CORRECT gate ordering.
WHERE IN RUNNER: Entry logic in analyzeAndTrade() (~lines 2100-2220)

EXTRACT:
  1. core/EntryGateChecker.js — Runs ALL pre-entry checks:
     - Confidence above threshold?
     - Not in max drawdown?
     - Daily loss limit not hit?
     - Not too many positions open?
     - Cool-down period respected?
     Returns: {pass: boolean, failedGates: string[]}
  
  2. core/EntryDecider.js — Orchestrates entry decision:
     Takes bestSignal + riskAssessment → calls EntryGateChecker → returns 
     {enter: boolean, signal, reason, positionSize}

BUG FIX: Current code checks gates AFTER ExecutionLayer.executeTrade() in some paths.
Refactored: EntryDecider MUST call EntryGateChecker BEFORE returning enter=true.

GOLDEN TEST: Same entries. But verify gate ordering is correct now.
COMMIT: "refactor(phase9): Extract EntryDecider + EntryGateChecker (fix gate ordering)"


══════════════════════════════════════════════════════════════════════════
  PHASE 10: Exit Checkers (StopLoss, TakeProfit, TrailingStop, MaxHold)
  Risk: MEDIUM — Individual exit conditions, easy to unit test
══════════════════════════════════════════════════════════════════════════

WHAT: Break ExitContractManager into individual checkers.
WHERE IN RUNNER: Exit handling block (~lines 2316-2440)
EXISTING FILES: core/ExitContractManager.js (18K)

EXTRACT:
  1. core/exit/StopLossChecker.js — check(trade, currentPrice) → {exit, reason}
  2. core/exit/TakeProfitChecker.js — check(trade, currentPrice) → {exit, reason}
  3. core/exit/TrailingStopChecker.js — check(trade, currentPrice) → {exit, reason}
     Includes: update maxProfitPercent, check trail distance
  4. core/exit/MaxHoldChecker.js — check(trade, currentTime) → {exit, reason}
     THIS IS WHERE BUG #1 (max_hold tagging) GETS FIXED:
     Tag "winner" only if pnlPercent > roundTripFee (0.52%), not > 0

NOTE: ExitContractManager stays as the orchestrator that calls these checkers.
The checkers are the extracted logic.

GOLDEN TEST: Same exits. Same P&L. max_hold tagging now correct.
COMMIT: "refactor(phase10): Extract exit checkers + fix max_hold winner tagging"


══════════════════════════════════════════════════════════════════════════
  PHASE 11: BreakEvenManager
  Risk: MEDIUM — Owns break-even state transitions
══════════════════════════════════════════════════════════════════════════

WHAT: Extract break-even logic into explicit state machine.
WHERE IN RUNNER: Inside ExitContractManager and MaxProfitManager
EXISTING FILES: core/MaxProfitManager.js (48K — this is the biggest file!)

EXTRACT:
  1. core/exit/BreakEvenManager.js — Manages BE state:
     States: NOT_TRIGGERED → TRIGGERED → PARTIALLY_EXITED → TRAILING
     checkBreakEven(trade, currentPrice) → {action: 'none'|'move_sl'|'partial_exit', newSL}

GOLDEN TEST: Break-even behavior identical.
COMMIT: "refactor(phase11): Extract BreakEvenManager state machine"


══════════════════════════════════════════════════════════════════════════
  PHASE 12: ExitDecider
  Risk: HIGH — Orchestrates all exit checkers. Critical path.
══════════════════════════════════════════════════════════════════════════

WHAT: Extract exit orchestration.
WHERE IN RUNNER: The exit decision block (~lines 2316-2440)

EXTRACT:
  1. core/ExitDecider.js — Orchestrates Phase 10 + 11 checkers:
     evaluate(trade, currentPrice, currentTime, indicators) → 
     {exit: boolean, reason: string, action: 'close'|'partial'|'hold'}
     
     Priority: StopLoss > BreakEven > TakeProfit > TrailingStop > MaxHold

GOLDEN TEST: Same exits. Same sequence.
COMMIT: "refactor(phase12): Extract ExitDecider orchestrator"


══════════════════════════════════════════════════════════════════════════
  PHASE 13: PositionTracker + PnLCalculator + PositionSizer
  Risk: HIGH — PositionTracker is SOLE WRITER to Trade objects
══════════════════════════════════════════════════════════════════════════

WHAT: Extract position management. This is the BIG one for shorts readiness.
WHERE IN RUNNER: Position tracking in StateManager usage, executeTrade(), 
  exit handling, P&L calculations scattered everywhere.
EXISTING FILES: core/StateManager.js

EXTRACT:
  1. core/PositionTracker.js — SOLE WRITER to Trade objects.
     openPosition(signal, size) → Trade
     closePosition(tradeId, exitPrice, reason) → ClosedTrade
     updateTradeField(tradeId, field, value) — controlled mutation
     getActiveTrades() → Trade[]
     **DIRECTION-AWARE from day one: Trade has side='long'|'short'**
  
  2. core/PnLCalculator.js — Pure math, direction-aware:
     calculatePnL(entryPrice, currentPrice, side) → {pnlDollars, pnlPercent}
     For longs: (current - entry) / entry
     For shorts: (entry - current) / entry
     **This fixes the PnL inversion problem from the multi-instrument doc.**
  
  3. core/PositionSizer.js — Pure math:
     calculateSize(balance, confidence, riskAssessment, exitContract) → {size, usdAmount}
     Confidence-scaled: 0.5x at 50%, 2.5x at 95% (battle plan values)

WHY THIS IS CRITICAL FOR MULTI-INSTRUMENT:
- PositionTracker stores positions PER SYMBOL, not globally
- PnLCalculator handles direction (long/short) from birth
- PositionSizer can factor in different fee structures per broker
- When stocks come: same modules, different symbol, different broker

GOLDEN TEST: Same positions opened/closed. Same P&L values.
COMMIT: "refactor(phase13): Extract PositionTracker + PnLCalculator + PositionSizer (direction-aware)"


══════════════════════════════════════════════════════════════════════════
  PHASE 14: OrderExecutor
  Risk: HIGH — Actually sends orders. Final integration.
══════════════════════════════════════════════════════════════════════════

WHAT: Extract order execution into standalone module.
WHERE IN RUNNER: executeTrade() implementation (~lines 2630-2810)
EXISTING FILES: core/AdvancedExecutionLayer-439-MERGED.js (24K)

EXTRACT:
  1. core/OrderExecutor.js — Takes validated order → sends through OrderRouter:
     executeEntry(signal, positionSize) → OrderResult
     executeExit(trade, reason) → OrderResult
     
     Handles: Order construction, slippage tracking, fill confirmation,
     partial fill handling, order timeout

     Uses OrderRouter (Phase 5) for actual broker communication.

GOLDEN TEST: Same orders sent. Same fills. Bot operates normally.
COMMIT: "refactor(phase14): Extract OrderExecutor — final module extraction"


══════════════════════════════════════════════════════════════════════════
  POST-EXTRACTION: Runner Collapse
══════════════════════════════════════════════════════════════════════════

After Phase 14, run-empire-v2.js should be approximately:

  - Imports + module wiring: ~100 lines
  - Constructor (initialize modules): ~80 lines  
  - start() (connect + subscribe): ~80 lines
  - tradingLoop() (call modules in sequence): ~50 lines
  - WebSocket message handling: ~80 lines
  - shutdown(): ~30 lines
  - TRAI integration: ~80 lines (this stays, it's runner-level)
  
  TOTAL: ~500 lines (down from 4,583)

The other ~4,000 lines now live in:
  - 20+ focused modules, each 30-150 lines
  - Each independently testable
  - Each with contract validation at boundaries
  - Each instrument-agnostic (except KrakenBroker which is by design)


══════════════════════════════════════════════════════════════════════════
  MULTI-INSTRUMENT READINESS CHECK
══════════════════════════════════════════════════════════════════════════

After all 14 phases, adding a new instrument type requires:

  ADD STOCK TRADING:
  1. Create brokers/AlpacaAdapter.js (implements IBrokerAdapter)
  2. Register: orderRouter.registerBroker(alpaca, ['AAPL', 'SPY'])
  3. Add market hours check to EntryGateChecker
  4. Done. Same signals, same exits, same risk management.

  ADD SHORTS:
  1. PnLCalculator already handles direction (Phase 13)
  2. PositionTracker already stores side='long'|'short' (Phase 13)
  3. Remove SELL→HOLD gate in SignalGenerator
  4. Add short-specific risk limits to RiskAssessor
  5. Done. Architecture supports it from birth.

  ADD OPTIONS:
  1. Create brokers/TastyworksAdapter.js
  2. Create core/instruments/OptionsContract.js (greeks, expiry, strike)
  3. PositionSizer gets options-aware sizing (premium vs margin)
  4. Signal engine works on underlying price series — same signals
  5. ExitDecider gets options-specific exits (expiry, assignment risk)

  NO REWRITES. Just new modules slotting into existing architecture.


══════════════════════════════════════════════════════════════════════════
  EXECUTION PROTOCOL (SAME AS PHASES 0-3)
══════════════════════════════════════════════════════════════════════════

For EACH phase, Claude Code follows:

  1. Read the phase description above
  2. Identify exact line ranges in run-empire-v2.js being extracted
  3. Write the new module file(s) with ContractValidator at boundaries
  4. Test module loads: node -e "require('./core/NewModule')"
  5. Wire module into run-empire-v2.js (replace inline code with module call)
  6. Golden test: BACKTEST_MODE=true node run-empire-v2.js
  7. Verify output matches baseline
  8. Run pipeline-audit.js
  9. Commit with phase-specific message
  10. Push

  IF GOLDEN TEST FAILS AT ANY STEP → git checkout run-empire-v2.js → STOP → REPORT

  DO NOT proceed to next phase without Trey's confirmation.
