# PHASE 10: Exit Checker Extraction
## INSTRUCTIONS FOR CLAUDE CODE

**Branch:** `refactor/modular-architecture`
**Pipeline:** `node ogz-meta/pipeline.js "refactor: Phase 10 - Extract Exit Checkers"`
**Risk:** MEDIUM
**Commit:** `"refactor(phase10): Extract exit checkers from ExitContractManager"`

---

## WHAT YOU ARE DOING

Breaking `ExitContractManager.checkExitConditions()` (lines 188-326) into **4 individual checker modules** in `core/exit/`. ExitContractManager stays as the **orchestrator** that calls these checkers. Same behavior, same outputs, just separated so each exit condition is independently testable.

**DO NOT** touch:
- `getDefaultContract()` — stays in ExitContractManager
- `createExitContract()` — stays in ExitContractManager
- `DEFAULT_CONTRACTS` — stays in ExitContractManager
- `UNIVERSAL_LIMITS` — stays in ExitContractManager
- `updateMaxProfit()` — **MOVES to TrailingStopChecker** (see below)
- `checkInvalidationConditions()` — stays in ExitContractManager (strategy-specific, not a generic checker)

**DO NOT** touch `run-empire-v2.js`. The runner calls `exitContractManager.checkExitConditions()` at line 2273. That call stays identical. The refactor is INSIDE ExitContractManager — it delegates to checkers instead of having inline logic.

---

## STEP 1: Create directory

```bash
mkdir -p core/exit
```

---

## STEP 2: Create `core/exit/StopLossChecker.js`

**Source:** ExitContractManager.checkExitConditions lines 16-24 (hard stop) and lines 50-67 (strategy stop + break-even)

```javascript
/**
 * StopLossChecker.js - Stop Loss Exit Condition
 * ==============================================
 * Checks universal hard stop AND strategy-specific stop loss.
 * Break-even logic: if maxProfit >= risk (1:1 move), stop moves to entry.
 *
 * @module core/exit/StopLossChecker
 */

'use strict';

class StopLossChecker {
  /**
   * @param {Object} universalLimits - { hardStopLossPercent, accountDrawdownPercent }
   */
  constructor(universalLimits) {
    this.universalLimits = universalLimits;
  }

  /**
   * Check stop loss conditions
   * @param {Object} trade - Trade object with entryPrice, exitContract, maxProfitPercent
   * @param {number} currentPrice - Current market price
   * @param {number} pnlPercent - Current P&L as percentage
   * @param {Object} context - { accountBalance, initialBalance }
   * @returns {Object} { shouldExit, exitReason, details, confidence } or { shouldExit: false }
   */
  check(trade, currentPrice, pnlPercent, context = {}) {
    const contract = trade.exitContract || {};

    // === UNIVERSAL HARD STOP (always first) ===
    if (pnlPercent <= this.universalLimits.hardStopLossPercent) {
      return {
        shouldExit: true,
        exitReason: 'hard_stop',
        details: `Universal hard stop: ${pnlPercent.toFixed(2)}% <= ${this.universalLimits.hardStopLossPercent}%`,
        confidence: 100
      };
    }

    // === ACCOUNT DRAWDOWN ===
    if (context.accountBalance && context.initialBalance) {
      const accountDrawdown = ((context.accountBalance - context.initialBalance) / context.initialBalance) * 100;
      if (accountDrawdown <= this.universalLimits.accountDrawdownPercent) {
        return {
          shouldExit: true,
          exitReason: 'account_drawdown',
          details: `Account drawdown: ${accountDrawdown.toFixed(2)}% <= ${this.universalLimits.accountDrawdownPercent}%`,
          confidence: 100
        };
      }
    }

    // === STRATEGY STOP LOSS (with break-even) ===
    if (contract.stopLossPercent !== undefined) {
      const riskAmount = Math.abs(contract.stopLossPercent);
      const breakEvenTriggered = trade.maxProfitPercent && trade.maxProfitPercent >= riskAmount;
      const effectiveStop = breakEvenTriggered ? -0.05 : contract.stopLossPercent;

      if (pnlPercent <= effectiveStop) {
        const exitReason = breakEvenTriggered ? 'break_even' : 'stop_loss';
        const stopType = breakEvenTriggered ? 'BE' : 'SL';
        return {
          shouldExit: true,
          exitReason,
          details: `${trade.entryStrategy || 'Strategy'} ${stopType}: ${pnlPercent.toFixed(2)}% <= ${effectiveStop.toFixed(2)}%`,
          confidence: 100
        };
      }
    }

    return { shouldExit: false };
  }

  /**
   * Get the effective stop loss level (accounts for break-even)
   * Useful for dashboard display
   * @param {Object} trade
   * @returns {number} Effective stop loss percent
   */
  getEffectiveStop(trade) {
    const contract = trade.exitContract || {};
    if (contract.stopLossPercent === undefined) return null;
    const riskAmount = Math.abs(contract.stopLossPercent);
    const breakEvenTriggered = trade.maxProfitPercent && trade.maxProfitPercent >= riskAmount;
    return breakEvenTriggered ? -0.05 : contract.stopLossPercent;
  }
}

module.exports = StopLossChecker;
```

---

## STEP 3: Create `core/exit/TakeProfitChecker.js`

**Source:** ExitContractManager.checkExitConditions lines 69-77

```javascript
/**
 * TakeProfitChecker.js - Take Profit Exit Condition
 * ==================================================
 * Checks if P&L has reached the strategy's take profit target.
 *
 * @module core/exit/TakeProfitChecker
 */

'use strict';

class TakeProfitChecker {
  /**
   * Check take profit condition
   * @param {Object} trade - Trade object with exitContract
   * @param {number} pnlPercent - Current P&L as percentage
   * @returns {Object} { shouldExit, exitReason, details, confidence } or { shouldExit: false }
   */
  check(trade, pnlPercent) {
    const contract = trade.exitContract || {};

    if (contract.takeProfitPercent !== undefined && pnlPercent >= contract.takeProfitPercent) {
      return {
        shouldExit: true,
        exitReason: 'take_profit',
        details: `${trade.entryStrategy || 'Strategy'} TP: ${pnlPercent.toFixed(2)}% >= ${contract.takeProfitPercent}%`,
        confidence: 100
      };
    }

    return { shouldExit: false };
  }
}

module.exports = TakeProfitChecker;
```

---

## STEP 4: Create `core/exit/TrailingStopChecker.js`

**Source:** ExitContractManager.checkExitConditions lines 79-98 AND `updateMaxProfit()` lines 337-344

**CRITICAL:** This module OWNS `maxProfitPercent` updates. It both updates the high water mark AND checks the trail distance. Single owner — no split responsibility.

```javascript
/**
 * TrailingStopChecker.js - Trailing Stop Exit Condition
 * =====================================================
 * Checks trailing stop AND owns maxProfitPercent updates.
 * Single owner of high water mark — prevents split responsibility bugs.
 *
 * OWNS: trade.maxProfitPercent mutation
 *
 * @module core/exit/TrailingStopChecker
 */

'use strict';

class TrailingStopChecker {
  /**
   * Update max profit tracking (call BEFORE check)
   * @param {Object} trade - Trade object (MUTATED: maxProfitPercent updated)
   * @param {number} currentPrice - Current market price
   * @returns {number} Updated maxProfitPercent
   */
  updateMaxProfit(trade, currentPrice) {
    if (!trade || !trade.entryPrice) return 0;
    const pnlPercent = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
    trade.maxProfitPercent = Math.max(trade.maxProfitPercent || 0, pnlPercent);
    return trade.maxProfitPercent;
  }

  /**
   * Check trailing stop condition
   * @param {Object} trade - Trade object with exitContract, maxProfitPercent
   * @param {number} pnlPercent - Current P&L as percentage
   * @returns {Object} { shouldExit, exitReason, details, confidence } or { shouldExit: false }
   */
  check(trade, pnlPercent) {
    const contract = trade.exitContract || {};

    if (!contract.trailingStopPercent || !trade.maxProfitPercent) {
      return { shouldExit: false };
    }

    const activationThreshold = contract.trailingActivation || 0;

    // Only activate trailing once we've reached the activation threshold
    if (trade.maxProfitPercent < activationThreshold) {
      return { shouldExit: false };
    }

    // Break-even check for trail baseline
    const riskAmount = Math.abs(contract.stopLossPercent || 1.0);
    const breakEvenTriggered = trade.maxProfitPercent >= riskAmount;
    const effectiveStop = breakEvenTriggered ? -0.05 : contract.stopLossPercent;

    const trailTrigger = breakEvenTriggered ? 0 : contract.trailingStopPercent;
    if (trade.maxProfitPercent >= trailTrigger) {
      const trailStop = trade.maxProfitPercent - contract.trailingStopPercent;
      if (pnlPercent <= trailStop && trailStop > effectiveStop) {
        return {
          shouldExit: true,
          exitReason: 'trailing_stop',
          details: `Trailing stop: P&L ${pnlPercent.toFixed(2)}% fell from peak ${trade.maxProfitPercent.toFixed(2)}% (activated at ${activationThreshold}%)`,
          confidence: 100
        };
      }
    }

    return { shouldExit: false };
  }
}

module.exports = TrailingStopChecker;
```

---

## STEP 5: Create `core/exit/MaxHoldChecker.js`

**Source:** ExitContractManager.checkExitConditions lines 101-113 (strategy) and lines 39-47 (universal)

**BUG FIX:** max_hold winner tagging uses net PnL (after 0.52% round-trip fees). This was already fixed on 2026-02-28 in ECM — preserve it exactly.

```javascript
/**
 * MaxHoldChecker.js - Maximum Hold Time Exit Condition
 * ====================================================
 * Checks both universal and strategy-specific max hold times.
 * Tags exits as winner/loser based on NET P&L (after fees).
 *
 * FIX 2026-02-28: Use net PnL (after 0.52% round-trip fees) not raw PnL
 *
 * @module core/exit/MaxHoldChecker
 */

'use strict';

const ROUND_TRIP_FEE = 0.52; // 0.26% × 2 sides (Kraken)

class MaxHoldChecker {
  /**
   * @param {Object} universalLimits - { maxHoldTimeMinutes }
   */
  constructor(universalLimits) {
    this.universalLimits = universalLimits;
  }

  /**
   * Check max hold time conditions
   * @param {Object} trade - Trade object with entryTime, exitContract
   * @param {number} holdTimeMinutes - Minutes since entry
   * @param {number} pnlPercent - Current P&L as percentage
   * @returns {Object} { shouldExit, exitReason, details, confidence } or { shouldExit: false }
   */
  check(trade, holdTimeMinutes, pnlPercent) {
    const contract = trade.exitContract || {};

    // === UNIVERSAL MAX HOLD (always checked first) ===
    if (holdTimeMinutes >= this.universalLimits.maxHoldTimeMinutes) {
      return {
        shouldExit: true,
        exitReason: 'max_hold_universal',
        details: `Universal max hold: ${holdTimeMinutes.toFixed(0)} min >= ${this.universalLimits.maxHoldTimeMinutes} min`,
        confidence: 100
      };
    }

    // === STRATEGY-SPECIFIC MAX HOLD ===
    if (contract.maxHoldTimeMinutes && holdTimeMinutes >= contract.maxHoldTimeMinutes) {
      // Tag as winner only if P&L exceeds round-trip fees
      const holdExitType = pnlPercent > ROUND_TRIP_FEE ? 'max_hold_winner' : 'max_hold_loser';
      return {
        shouldExit: true,
        exitReason: holdExitType,
        details: `${trade.entryStrategy || 'Strategy'} max hold: ${holdTimeMinutes.toFixed(0)} min >= ${contract.maxHoldTimeMinutes} min (P&L ${pnlPercent.toFixed(2)}%)`,
        confidence: 80
      };
    }

    return { shouldExit: false };
  }
}

module.exports = MaxHoldChecker;
```

---

## STEP 6: Refactor `ExitContractManager.checkExitConditions()` to delegate

**Replace** the entire `checkExitConditions` method body with delegation to the checkers. The method signature and return format stay IDENTICAL.

```javascript
// ADD at top of ExitContractManager.js (after 'use strict';):
const StopLossChecker = require('./exit/StopLossChecker');
const TakeProfitChecker = require('./exit/TakeProfitChecker');
const TrailingStopChecker = require('./exit/TrailingStopChecker');
const MaxHoldChecker = require('./exit/MaxHoldChecker');
```

**In the constructor, instantiate checkers:**
```javascript
constructor() {
  this.universalLimits = UNIVERSAL_LIMITS;
  this.defaultContracts = DEFAULT_CONTRACTS;

  // Phase 10: Delegate to individual checkers
  this.stopLossChecker = new StopLossChecker(UNIVERSAL_LIMITS);
  this.takeProfitChecker = new TakeProfitChecker();
  this.trailingStopChecker = new TrailingStopChecker();
  this.maxHoldChecker = new MaxHoldChecker(UNIVERSAL_LIMITS);
}
```

**Replace `checkExitConditions` method:**
```javascript
checkExitConditions(trade, currentPrice, context = {}) {
  if (!trade || !trade.entryPrice) {
    return { shouldExit: false, exitReason: null, details: 'No valid trade' };
  }

  const entryPrice = trade.entryPrice;
  const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
  const holdTimeMinutes = context.currentTime
    ? (context.currentTime - trade.entryTime) / 60000
    : (Date.now() - trade.entryTime) / 60000;

  const contract = trade.exitContract || this.getDefaultContract(trade.entryStrategy || 'default');
  // Ensure trade has contract for checkers
  if (!trade.exitContract) trade.exitContract = contract;

  // PRIORITY ORDER: StopLoss > TakeProfit > TrailingStop > MaxHold > Invalidation

  // 1. Stop loss + universal circuit breakers
  const slResult = this.stopLossChecker.check(trade, currentPrice, pnlPercent, context);
  if (slResult.shouldExit) return slResult;

  // 2. Take profit
  const tpResult = this.takeProfitChecker.check(trade, pnlPercent);
  if (tpResult.shouldExit) return tpResult;

  // 3. Trailing stop
  const tsResult = this.trailingStopChecker.check(trade, pnlPercent);
  if (tsResult.shouldExit) return tsResult;

  // 4. Max hold time
  const mhResult = this.maxHoldChecker.check(trade, holdTimeMinutes, pnlPercent);
  if (mhResult.shouldExit) return mhResult;

  // 5. Invalidation conditions (stays in ECM — strategy-specific)
  if (contract.invalidationConditions && contract.invalidationConditions.length > 0 && context.indicators) {
    const invalidation = this.checkInvalidationConditions(
      contract.invalidationConditions,
      trade,
      context.indicators
    );
    if (invalidation.triggered) {
      return {
        shouldExit: true,
        exitReason: 'invalidation',
        details: `${trade.entryStrategy || 'Strategy'} invalidated: ${invalidation.reason}`,
        confidence: 90
      };
    }
  }

  // No exit condition met
  return {
    shouldExit: false,
    exitReason: null,
    details: `Holding: P&L ${pnlPercent.toFixed(2)}%, hold ${holdTimeMinutes.toFixed(0)} min`
  };
}
```

**Replace `updateMaxProfit` method** to delegate to TrailingStopChecker:
```javascript
updateMaxProfit(trade, currentPrice) {
  return this.trailingStopChecker.updateMaxProfit(trade, currentPrice);
}
```

---

## STEP 7: Verify — NOTHING in run-empire-v2.js changes

Run this to confirm no runner edits needed:
```bash
# The runner still calls these same methods:
grep -n "exitContractManager.checkExitConditions\|exitContractManager.updateMaxProfit\|exitContractManager.createExitContract\|exitContractManager.getDefaultContract" run-empire-v2.js
```

You should see the same lines as before. The runner's interface to ExitContractManager is unchanged.

---

## STEP 8: Golden Test

```bash
BACKTEST_MODE=true node run-empire-v2.js --candles 500 2>&1 | tail -30
```

**MUST SEE:**
- No crashes, no `Cannot find module` errors
- Exit reasons in logs: `stop_loss`, `take_profit`, `trailing_stop`, `max_hold_winner`, `max_hold_loser`, `break_even`, `hard_stop`
- Same trade count, same P&L as before Phase 10

**Quick unit validation:**
```bash
node -e "
const SLC = require('./core/exit/StopLossChecker');
const TPC = require('./core/exit/TakeProfitChecker');
const TSC = require('./core/exit/TrailingStopChecker');
const MHC = require('./core/exit/MaxHoldChecker');

const sl = new SLC({ hardStopLossPercent: -2.0, accountDrawdownPercent: -10.0 });
const tp = new TPC();
const ts = new TSC();
const mh = new MHC({ maxHoldTimeMinutes: 360 });

// Test stop loss
const trade1 = { entryPrice: 100000, exitContract: { stopLossPercent: -1.0 }, maxProfitPercent: 0 };
console.log('SL hit:', sl.check(trade1, 99000, -1.0).shouldExit === true ? 'PASS' : 'FAIL');
console.log('SL miss:', sl.check(trade1, 99500, -0.5).shouldExit === false ? 'PASS' : 'FAIL');

// Test break-even
const trade2 = { entryPrice: 100000, exitContract: { stopLossPercent: -1.0 }, maxProfitPercent: 1.5 };
console.log('BE triggered:', sl.check(trade2, 99950, -0.05).shouldExit === true ? 'PASS' : 'FAIL');
console.log('BE reason:', sl.check(trade2, 99950, -0.05).exitReason === 'break_even' ? 'PASS' : 'FAIL');

// Test take profit
const trade3 = { exitContract: { takeProfitPercent: 2.0 } };
console.log('TP hit:', tp.check(trade3, 2.5).shouldExit === true ? 'PASS' : 'FAIL');
console.log('TP miss:', tp.check(trade3, 1.5).shouldExit === false ? 'PASS' : 'FAIL');

// Test trailing stop
const trade4 = { entryPrice: 100000, exitContract: { trailingStopPercent: 0.5, trailingActivation: 0.8, stopLossPercent: -1.0 }, maxProfitPercent: 1.5 };
console.log('Trail hit:', ts.check(trade4, 0.8).shouldExit === true ? 'PASS' : 'FAIL');
console.log('Trail miss:', ts.check(trade4, 1.2).shouldExit === false ? 'PASS' : 'FAIL');

// Test max hold - winner (above fees)
const trade5 = { entryStrategy: 'EMASMACrossover', exitContract: { maxHoldTimeMinutes: 300 } };
console.log('MH winner:', mh.check(trade5, 301, 1.0).exitReason === 'max_hold_winner' ? 'PASS' : 'FAIL');
console.log('MH loser:', mh.check(trade5, 301, 0.3).exitReason === 'max_hold_loser' ? 'PASS' : 'FAIL');
console.log('MH not yet:', mh.check(trade5, 200, 0.5).shouldExit === false ? 'PASS' : 'FAIL');

// Test updateMaxProfit
const trade6 = { entryPrice: 100000, maxProfitPercent: 0 };
ts.updateMaxProfit(trade6, 101000);
console.log('MaxProfit update:', trade6.maxProfitPercent === 1.0 ? 'PASS' : 'FAIL');
ts.updateMaxProfit(trade6, 100500);
console.log('MaxProfit no decrease:', trade6.maxProfitPercent === 1.0 ? 'PASS' : 'FAIL');

console.log('\\nAll exit checkers loaded and tested.');
"
```

---

## STEP 9: Commit

```bash
git add core/exit/StopLossChecker.js core/exit/TakeProfitChecker.js core/exit/TrailingStopChecker.js core/exit/MaxHoldChecker.js core/ExitContractManager.js
git commit -m "refactor(phase10): Extract exit checkers from ExitContractManager

- StopLossChecker: universal hard stop + strategy SL + break-even logic
- TakeProfitChecker: strategy TP target check
- TrailingStopChecker: trailing stop + OWNS maxProfitPercent updates
- MaxHoldChecker: universal + strategy max hold, net PnL winner tagging
- ExitContractManager: now thin orchestrator delegating to checkers
- run-empire-v2.js: UNCHANGED (same interface)
- Golden test: same exits, same P&L"
```

---

## WHAT NOT TO DO

1. **DO NOT** create an ExitDecider yet — that's Phase 12
2. **DO NOT** create a BreakEvenManager yet — that's Phase 11
3. **DO NOT** modify run-empire-v2.js — the runner's interface to ECM is unchanged
4. **DO NOT** touch MaxProfitManager — it stays as-is, the legacy exit system flag still routes to it
5. **DO NOT** touch the `activeExitSystem` flag logic in the runner — that's separate from exit contract checking
6. **DO NOT** remove `checkInvalidationConditions` from ECM — it's strategy-specific logic that stays in the orchestrator
7. **DO NOT** skip the unit test — run the node -e validation before committing
8. **DO NOT** proceed to Phase 11 without approval
