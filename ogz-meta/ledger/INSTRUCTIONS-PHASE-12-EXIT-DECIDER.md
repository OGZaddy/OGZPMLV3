# PHASE 12: ExitDecider Orchestrator
## INSTRUCTIONS FOR CLAUDE CODE

**Branch:** `refactor/modular-architecture`
**Pipeline:** `node ogz-meta/pipeline.js "refactor: Phase 12 - Extract ExitDecider orchestrator"`
**Risk:** HIGH — Orchestrates ALL exit paths. Critical path.
**Commit:** `"refactor(phase12): Extract ExitDecider orchestrator from runner exit block"`

---

## WHAT YOU ARE DOING

Extracting the **311-line exit decision block** (run-empire-v2.js lines ~2250-2560) into `core/exit/ExitDecider.js`. This block currently has 12 separate SELL return points across 5 different exit systems. ExitDecider becomes the single entry point for ALL exit evaluation.

**The runner's exit block currently runs this cascade:**
1. ExitContract checkers (SL/TP/Trail/MaxHold) — via `exitContractManager.checkExitConditions()`
2. TradeIntelligenceEngine — 13-dimension evaluator (shadow or active mode)
3. MaxProfitManager — tiered exits, trailing stops (dollar-based)
4. PatternExitModel — pattern-based exit recommendations
5. Hard stop loss (-1.5%) — safety fallback
6. Legacy fallback exits — profitable above fees
7. Brain aggregate sell signals — with exitContract override
8. Confidence drop extreme reversal (50%+ drop)

After Phase 12, the runner calls `exitDecider.evaluate()` and gets back one answer.

---

## IMPORTANT: This is an EXTRACTION, not a rewrite

Copy the logic exactly. Do not reorganize the cascade order. Do not optimize conditions. Do not remove any exit path. The goal is to move 311 lines out of the runner into a testable module with **zero behavior change**.

---

## STEP 1: Create `core/exit/ExitDecider.js`

```javascript
/**
 * ExitDecider.js - Exit Decision Orchestrator
 * ============================================
 * Single entry point for ALL exit evaluation.
 * Runs exit checks in priority order, returns first match.
 *
 * PRIORITY ORDER:
 *   1. ExitContract checkers (SL > TP > Trail > MaxHold > Invalidation)
 *   2. TradeIntelligenceEngine (if active)
 *   3. MaxProfitManager (if active)
 *   4. PatternExitModel (if active)
 *   5. Hard stop loss safety (-1.5%)
 *   6. Legacy fallbacks
 *   7. Brain aggregate sell signals
 *   8. Extreme confidence reversal (50%+ drop)
 *
 * EXIT SYSTEM FLAG:
 *   Only ONE system active at a time (controlled by EXIT_SYSTEM env).
 *   ExitContract (Phase 10 checkers) ALWAYS runs first regardless of flag.
 *   The flag controls which ADDITIONAL system runs after.
 *
 * @module core/exit/ExitDecider
 */

'use strict';

class ExitDecider {
  /**
   * @param {Object} deps - Dependencies injected from runner
   * @param {Object} deps.exitContractManager - ExitContractManager instance
   * @param {string} deps.activeExitSystem - 'maxprofit'|'intelligence'|'pattern'|'brain'|'legacy'
   */
  constructor(deps = {}) {
    this.exitContractManager = deps.exitContractManager;
    this.activeExitSystem = deps.activeExitSystem || 'maxprofit';
  }

  /**
   * Evaluate all exit conditions for an active trade.
   *
   * @param {Object} params
   * @param {Object} params.trade - Active trade object (oldest BUY)
   * @param {number} params.currentPrice - Current market price
   * @param {Object} params.indicators - Current indicator snapshot
   * @param {number} params.totalConfidence - Aggregate confidence (0-100)
   * @param {string} params.brainDirection - 'buy'|'sell'|'hold' from TradingBrain
   * @param {Object} params.stateManager - StateManager instance
   * @param {Object} params.marketData - { timestamp, volume, avgVolume, high24h, low24h, ... }
   * @param {Object} [params.tradeIntelligence] - TradeIntelligenceEngine instance (optional)
   * @param {boolean} [params.tradeIntelligenceShadowMode] - Shadow mode flag
   * @param {Object} [params.tradingBrain] - TradingBrain instance (for MPM + fib/SR)
   * @param {Object} [params.patternExitModel] - PatternExitModel instance (optional)
   * @param {boolean} [params.patternExitShadowMode] - Shadow mode flag
   * @param {Object} [params.patterns] - Current patterns
   * @param {Array}  [params.priceHistory] - Candle history
   * @param {Array}  [params.confidenceHistory] - Recent confidence values
   * @param {Object} [params.decisionContext] - Chain-of-thought context
   *
   * @returns {Object|null} SELL decision or null if HOLD
   *   { action: 'SELL', direction: 'close', confidence, exitReason, decisionContext, ... }
   */
  evaluate(params) {
    const {
      trade,
      currentPrice,
      indicators,
      totalConfidence,
      brainDirection,
      stateManager,
      marketData,
      tradeIntelligence,
      tradeIntelligenceShadowMode,
      tradingBrain,
      patternExitModel,
      patternExitShadowMode,
      patterns,
      priceHistory,
      confidenceHistory,
      decisionContext
    } = params;

    const entryPrice = trade.entryPrice;

    // =====================================================================
    // 1. EXIT CONTRACT CHECKERS (always first, regardless of activeExitSystem)
    // =====================================================================
    if (trade.exitContract) {
      this.exitContractManager.updateMaxProfit(trade, currentPrice);

      const exitCheck = this.exitContractManager.checkExitConditions(trade, currentPrice, {
        indicators: indicators,
        currentTime: marketData?.timestamp || Date.now(),
        accountBalance: stateManager.get('balance'),
        initialBalance: stateManager.get('initialBalance') || 10000
      });

      if (exitCheck.shouldExit) {
        console.log(`[EXIT-CONTRACT] ${exitCheck.details}`);
        return {
          action: 'SELL',
          direction: 'close',
          confidence: exitCheck.confidence || 100,
          exitReason: exitCheck.exitReason,
          decisionContext: {
            source: 'ExitContract',
            strategy: trade.entryStrategy,
            ...decisionContext
          }
        };
      }

      // If exitContract exists but doesn't say exit, DON'T let aggregate confidence trigger exit
      // Only universal circuit breakers and exitContract conditions can close this trade
      // EXCEPTION: Legacy exit systems below still run for their respective flags
    }

    // =====================================================================
    // 2. TRADE INTELLIGENCE ENGINE (if active)
    // =====================================================================
    if (tradeIntelligence) {
      const intelligenceResult = this._evaluateTradeIntelligence(
        trade, currentPrice, indicators, totalConfidence, stateManager, marketData, tradingBrain, tradeIntelligenceShadowMode
      );
      if (intelligenceResult) return intelligenceResult;
    }

    // =====================================================================
    // 3. FIB/SR LEVEL ANALYSIS + MAXPROFITMANAGER (if active)
    // =====================================================================
    let profitResult = null;
    if (this.activeExitSystem === 'maxprofit' || this.activeExitSystem === 'legacy') {
      // Fib/SR trailing stop adjustment
      const levelAnalysis = tradingBrain?.analyzeFibSRLevels?.(priceHistory, currentPrice) || { trailMultiplier: 1.0 };

      if (!tradingBrain?.maxProfitManager?.state?.active) {
        console.log('⚠️ MaxProfitManager not active for position, will check other exit conditions');
      } else {
        profitResult = tradingBrain.maxProfitManager.update(currentPrice, {
          volatility: indicators.volatility || 0,
          trend: indicators.trend || 'sideways',
          volume: marketData?.volume || 0,
          trailMultiplier: levelAnalysis.trailMultiplier || 1.0
        });
      }
    }

    // =====================================================================
    // 4. PATTERN EXIT MODEL (if active)
    // =====================================================================
    if (patternExitModel && (this.activeExitSystem === 'pattern' || this.activeExitSystem === 'legacy')) {
      const patternResult = this._evaluatePatternExit(
        trade, currentPrice, entryPrice, indicators, patterns, patternExitShadowMode, profitResult, totalConfidence, patternExitModel
      );
      if (patternResult) return patternResult;
    }

    // =====================================================================
    // 5. MAXPROFITMANAGER EXIT SIGNAL
    // =====================================================================
    if (profitResult && (profitResult.action === 'exit_full' || profitResult.action === 'exit_partial') && (this.activeExitSystem === 'maxprofit' || this.activeExitSystem === 'legacy')) {
      console.log(`📉 SELL Signal: ${profitResult.reason || 'MaxProfitManager exit'} (${profitResult.action})`);
      return { action: 'SELL', direction: 'close', confidence: totalConfidence, exitSize: profitResult.exitSize, exitReason: profitResult.reason };
    }

    // =====================================================================
    // 6. HARD STOP LOSS SAFETY — ALWAYS ENFORCED
    // =====================================================================
    const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;
    const currentTime = marketData?.timestamp || Date.now();
    const holdTime = (currentTime - (trade.entryTime || currentTime)) / 60000;

    if (pnl < -1.5) {
      console.log(`🛑 HARD STOP LOSS: Exiting at ${pnl.toFixed(2)}% loss`);
      return { action: 'SELL', direction: 'close', confidence: totalConfidence };
    }

    // =====================================================================
    // 7. LEGACY FALLBACK EXITS
    // =====================================================================
    const feeBuffer = 0.35;
    if (this.activeExitSystem === 'legacy' && !tradingBrain?.maxProfitManager?.state?.active) {
      if (pnl > feeBuffer) {
        console.log(`✅ EXIT: Taking profit at ${pnl.toFixed(2)}% (covers ${feeBuffer}% fees)`);
        return { action: 'SELL', direction: 'close', confidence: totalConfidence };
      }
      if (brainDirection === 'sell' && holdTime > 0.5 && pnl > feeBuffer) {
        console.log(`🧠 Brain SELL signal: Exiting after ${holdTime.toFixed(1)} min hold (P&L: ${pnl.toFixed(2)}%)`);
        return { action: 'SELL', direction: 'close', confidence: totalConfidence };
      }
    }

    // =====================================================================
    // 8. BRAIN AGGREGATE SELL SIGNALS
    // =====================================================================
    if (brainDirection === 'sell' && (this.activeExitSystem === 'brain' || this.activeExitSystem === 'legacy')) {
      // If trade has exitContract, skip brain aggregate exit
      if (trade.exitContract) {
        console.log(`[EXIT-CONTRACT] Brain says SELL but trade has exitContract - IGNORING aggregate`);
      } else {
        const brainResult = this._evaluateBrainSell(trade, currentPrice, entryPrice, holdTime, totalConfidence, marketData);
        if (brainResult) return brainResult;
      }
    }

    // =====================================================================
    // 9. EXTREME CONFIDENCE REVERSAL
    // =====================================================================
    if (confidenceHistory && confidenceHistory.length > 0) {
      const peakConfidence = Math.max(...confidenceHistory.slice(-5));
      const confidenceDrop = peakConfidence - totalConfidence;
      if (confidenceDrop > 50) {
        console.log(`📉 SELL Signal: EXTREME reversal (${confidenceDrop.toFixed(1)}% confidence drop)`);
        return { action: 'SELL', direction: 'close', confidence: totalConfidence };
      }
    }

    // =====================================================================
    // NO EXIT — HOLD
    // =====================================================================
    console.log(`📊 [EXIT-DEBUG] No exit condition matched. pnl=${pnl?.toFixed(3) || 'N/A'}%, conf=${totalConfidence}, brainDir=${brainDirection}`);
    return null;
  }

  /**
   * TradeIntelligence evaluation (extracted for readability)
   * @private
   */
  _evaluateTradeIntelligence(trade, currentPrice, indicators, totalConfidence, stateManager, marketData, tradingBrain, shadowMode) {
    const intelligenceContext = {
      patternBank: tradingBrain?.patternMemory,
      tradeHistory: stateManager.getAllTrades().filter(t => t.pnl !== undefined),
      currentConfidence: totalConfidence / 100,
      traiAnalysis: null,
      currentDrawdown: stateManager.get('maxDrawdown') || 0,
      consecutiveLosses: stateManager.get('consecutiveLosses') || 0,
      dailyPnL: stateManager.get('dailyPnL') || 0,
      fearGreedIndex: marketData?.fearGreed,
      whaleActivity: marketData?.whaleActivity || null
    };

    const marketDataForIntelligence = {
      price: currentPrice,
      volume: marketData?.volume,
      avgVolume: marketData?.avgVolume,
      high24h: marketData?.high24h,
      low24h: marketData?.low24h,
      priceChange: marketData?.priceChange,
      currentCandle: null // was this.priceHistory last candle
    };

    const indicatorsForIntelligence = {
      rsi: indicators.rsi,
      macd: indicators.macd,
      ema9: indicators.ema9 || indicators.ema12,
      ema20: indicators.ema20 || indicators.ema26,
      ema50: indicators.ema50,
      sma200: indicators.sma200,
      atr: indicators.atr,
      avgAtr: indicators.avgAtr,
      trend: indicators.trend,
      adx: indicators.adx,
      volume: marketData?.volume,
      avgVolume: marketData?.avgVolume
    };

    const intelligenceResult = this._callTradeIntelligence(trade, marketDataForIntelligence, indicatorsForIntelligence, intelligenceContext);
    if (!intelligenceResult) return null;

    if (shadowMode) {
      if (intelligenceResult.action !== 'HOLD_CAUTIOUS' && intelligenceResult.action !== 'HOLD_STRONG') {
        console.log(`🧠 [INTELLIGENCE-SHADOW] Would recommend: ${intelligenceResult.action}`);
        console.log(`   Confidence: ${(intelligenceResult.confidence * 100).toFixed(0)}%`);
        console.log(`   Reasoning: ${intelligenceResult.reasoning.slice(0, 3).join(' | ')}`);
      }
      return null; // Shadow mode — don't act
    }

    if (this.activeExitSystem === 'intelligence' || this.activeExitSystem === 'legacy') {
      if (intelligenceResult.action === 'EXIT_LOSS' && intelligenceResult.confidence > 0.7) {
        console.log(`🧠 [INTELLIGENCE] EXIT_LOSS: ${intelligenceResult.reasoning.join(' | ')}`);
        return { action: 'SELL', direction: 'close', confidence: totalConfidence, source: 'TradeIntelligence' };
      }
      if (intelligenceResult.action === 'EXIT_PROFIT' && intelligenceResult.confidence > 0.7) {
        console.log(`🧠 [INTELLIGENCE] EXIT_PROFIT: ${intelligenceResult.reasoning.join(' | ')}`);
        return { action: 'SELL', direction: 'close', confidence: totalConfidence, source: 'TradeIntelligence' };
      }
    }

    return null;
  }

  /**
   * Safely call TradeIntelligence.evaluate
   * @private
   */
  _callTradeIntelligence(trade, marketData, indicators, context) {
    try {
      // tradeIntelligence is passed via evaluate() params, need to access from closure
      // This will be wired during integration
      return null; // Placeholder — see STEP 2 integration note
    } catch (e) {
      console.error('[ExitDecider] TradeIntelligence error:', e.message);
      return null;
    }
  }

  /**
   * PatternExitModel evaluation (extracted for readability)
   * @private
   */
  _evaluatePatternExit(trade, currentPrice, entryPrice, indicators, patterns, shadowMode, profitResult, totalConfidence, patternExitModel) {
    const profitPercent = (currentPrice - entryPrice) / entryPrice;
    const exitDecision = patternExitModel.evaluateExit({
      currentPrice,
      currentPatterns: patterns || [],
      indicators: { rsi: indicators.rsi, macd: indicators.macd },
      regime: 'unknown',
      profitPercent,
      maxProfitManagerState: profitResult
    });

    if (shadowMode) {
      if (exitDecision.exitRecommended) {
        console.log(`🕵️ [SHADOW] Pattern Exit would trigger:`);
        console.log(`   Action: ${exitDecision.action}`);
        console.log(`   Urgency: ${exitDecision.exitUrgency}`);
        console.log(`   Exit %: ${(exitDecision.exitPercent * 100).toFixed(0)}%`);
        console.log(`   Reasons: ${exitDecision.reasons.join(', ')}`);
      }
      if (exitDecision.adjustments &&
          (exitDecision.adjustments.targetMultiplier !== 1.0 ||
           exitDecision.adjustments.stopMultiplier !== 1.0 ||
           exitDecision.adjustments.trailMultiplier !== 1.0)) {
        console.log(`🕵️ [SHADOW] Pattern adjustments would apply:`);
        console.log(`   Target: ${exitDecision.adjustments.targetMultiplier.toFixed(2)}x`);
        console.log(`   Stop: ${exitDecision.adjustments.stopMultiplier.toFixed(2)}x`);
        console.log(`   Trail: ${exitDecision.adjustments.trailMultiplier.toFixed(2)}x`);
      }
      return null; // Shadow mode
    }

    if (exitDecision.exitRecommended &&
        (exitDecision.exitUrgency === 'high' || exitDecision.exitUrgency === 'critical')) {
      console.log(`🎯 Pattern Exit ACTIVE: ${exitDecision.reasons.join(', ')}`);
      return { action: 'SELL', direction: 'close', confidence: totalConfidence * 1.2 };
    }

    return null;
  }

  /**
   * Brain aggregate sell evaluation (extracted for readability)
   * @private
   */
  _evaluateBrainSell(trade, currentPrice, entryPrice, holdTime, totalConfidence, marketData) {
    const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;
    const minHoldTime = 0.05;

    if (holdTime >= minHoldTime && pnl > 0.35) {
      console.log(`🧠 Brain bearish & profitable - allowing SELL (held ${holdTime.toFixed(2)} min, PnL: ${pnl.toFixed(2)}%)`);
      return { action: 'SELL', direction: 'close', confidence: totalConfidence };
    }
    if (holdTime >= minHoldTime && pnl < -2) {
      console.log(`🚨 Brain emergency sell - cutting losses (PnL: ${pnl.toFixed(2)}%)`);
      return { action: 'SELL', direction: 'close', confidence: totalConfidence };
    }
    if (holdTime >= 5 && pnl < 0 && pnl >= -2) {
      console.log(`📉 Gradual exit - held ${holdTime.toFixed(1)} min at ${pnl.toFixed(2)}% loss, cutting loose`);
      return { action: 'SELL', direction: 'close', confidence: totalConfidence };
    }

    console.log(`🧠 Brain wants sell but conditions not met (hold: ${holdTime.toFixed(3)} min, PnL: ${pnl.toFixed(2)}%)`);
    return null;
  }
}

module.exports = ExitDecider;
```

---

## STEP 2: Wire ExitDecider into run-empire-v2.js

### 2a. Add require at top (near other exit imports):
```javascript
const ExitDecider = require('./core/exit/ExitDecider');
```

### 2b. Instantiate in constructor (after exitContractManager and activeExitSystem are set):
```javascript
this.exitDecider = new ExitDecider({
  exitContractManager: exitContractManager,
  activeExitSystem: this.activeExitSystem
});
```

### 2c. Replace the 311-line exit block

Find the block that starts with:
```javascript
// Change 603: Integrate MaxProfitManager for dynamic exits
if (pos > 0) {
```

And ends just before:
```javascript
// 🚫 CRYPTO: NO SHORTING/MARGIN
```

**Replace the INNER content** (keep the `if (pos > 0)` and `if (buyTrades.length > 0)` guards). The new code inside those guards:

```javascript
        // =====================================================================
        // PHASE 12: All exit decisions delegated to ExitDecider
        // =====================================================================
        const exitResult = this.exitDecider.evaluate({
          trade: activeTrade,
          currentPrice,
          indicators,
          totalConfidence,
          brainDirection,
          stateManager,
          marketData: this.marketData,
          tradeIntelligence: this.tradeIntelligence,
          tradeIntelligenceShadowMode: this.tradeIntelligenceShadowMode,
          tradingBrain: this.tradingBrain,
          patternExitModel: this.patternExitModel,
          patternExitShadowMode: this.patternExitShadowMode,
          patterns,
          priceHistory: this.priceHistory,
          confidenceHistory: this.confidenceHistory,
          decisionContext
        });

        // Update confidence history (was inline before)
        this.confidenceHistory = this.confidenceHistory || [];
        this.confidenceHistory.push(totalConfidence);
        if (this.confidenceHistory.length > 10) this.confidenceHistory.shift();

        if (exitResult) {
          return exitResult;
        }
```

### 2d. Fix _callTradeIntelligence

The `_callTradeIntelligence` method in ExitDecider has a placeholder. Since `tradeIntelligence` is passed as a param to `evaluate()`, update `_evaluateTradeIntelligence` to use it directly:

In `_evaluateTradeIntelligence`, replace the call to `this._callTradeIntelligence(...)` with:
```javascript
    let intelligenceResult;
    try {
      intelligenceResult = tradeIntelligence.evaluate(
        trade,
        marketDataForIntelligence,
        indicatorsForIntelligence,
        intelligenceContext
      );
    } catch (e) {
      console.error('[ExitDecider] TradeIntelligence error:', e.message);
      return null;
    }
    if (!intelligenceResult) return null;
```

Where `tradeIntelligence` is the parameter passed into `_evaluateTradeIntelligence`. Update the method signature:
```javascript
_evaluateTradeIntelligence(trade, currentPrice, indicators, totalConfidence, stateManager, marketData, tradingBrain, shadowMode, tradeIntelligence) {
```

And the call in `evaluate()`:
```javascript
const intelligenceResult = this._evaluateTradeIntelligence(
  trade, currentPrice, indicators, totalConfidence, stateManager, marketData, tradingBrain, tradeIntelligenceShadowMode, tradeIntelligence
);
```

Then **delete** the `_callTradeIntelligence` placeholder method entirely.

---

## STEP 3: Verify runner line count dropped

```bash
wc -l run-empire-v2.js
```

Should be ~4200-4250 (down from 4525). About 280 lines removed from the runner.

---

## STEP 4: Golden Test

```bash
BACKTEST_MODE=true node run-empire-v2.js --candles 500 2>&1 | tail -30
```

**MUST SEE:**
- No crashes
- Exit reasons in logs: `[EXIT-CONTRACT]`, `HARD STOP LOSS`, `EXIT-DEBUG`
- Same trade count and P&L as Phase 11

**Quick sanity check:**
```bash
node -e "
const ExitDecider = require('./core/exit/ExitDecider');
console.log('ExitDecider loaded:', typeof ExitDecider === 'function' ? 'PASS' : 'FAIL');

// Verify it can be instantiated with mock deps
const ed = new ExitDecider({
  exitContractManager: {
    updateMaxProfit: () => 0,
    checkExitConditions: () => ({ shouldExit: false })
  },
  activeExitSystem: 'maxprofit'
});
console.log('Instantiated:', ed ? 'PASS' : 'FAIL');

// Verify evaluate returns null on hold
const result = ed.evaluate({
  trade: { entryPrice: 100000, exitContract: null, entryTime: Date.now() - 60000 },
  currentPrice: 100100,
  indicators: { rsi: 55 },
  totalConfidence: 60,
  brainDirection: 'hold',
  stateManager: { get: () => 10000, getAllTrades: () => [] },
  marketData: { timestamp: Date.now() }
});
console.log('Hold returns null:', result === null ? 'PASS' : 'FAIL');

console.log('\\nExitDecider basic checks passed.');
"
```

---

## STEP 5: Commit

```bash
git add core/exit/ExitDecider.js run-empire-v2.js
git commit -m "refactor(phase12): Extract ExitDecider orchestrator from runner exit block

- ExitDecider: single entry point for ALL exit evaluation
- Orchestrates: ExitContract > TradeIntelligence > MPM > PatternExit > Safety > Brain
- Runner exit block: ~311 lines → ~20 lines (delegate to ExitDecider)
- run-empire-v2.js: 4525 → ~4250 lines
- All exit systems preserved with same priority order
- activeExitSystem flag routing unchanged
- Golden test: same exits, same P&L"
```

---

## WHAT NOT TO DO

1. **DO NOT** change the exit priority order — it's been battle-tested
2. **DO NOT** remove any legacy exit system — they're controlled by the feature flag
3. **DO NOT** remove the `confidenceHistory` tracking — it moves to the runner's call site
4. **DO NOT** modify ExitContractManager, StopLossChecker, TakeProfitChecker, TrailingStopChecker, MaxHoldChecker, or BreakEvenManager — they're done
5. **DO NOT** modify MaxProfitManager — it stays as-is
6. **DO NOT** skip the golden test — this is HIGH risk, exit logic is money-critical
7. **DO NOT** proceed to Phase 13 without approval
