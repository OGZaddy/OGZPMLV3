# PHASE 11: BreakEvenManager Extraction
## INSTRUCTIONS FOR CLAUDE CODE

**Branch:** `refactor/modular-architecture`
**Pipeline:** `node ogz-meta/pipeline.js "refactor: Phase 11 - Extract BreakEvenManager"`
**Risk:** MEDIUM
**Commit:** `"refactor(phase11): Extract BreakEvenManager state machine"`

---

## WHAT YOU ARE DOING

Extracting break-even stop logic into an explicit state machine at `core/exit/BreakEvenManager.js`. Break-even logic currently lives in **TWO places** and this module consolidates ownership:

1. **StopLossChecker** (Phase 10) — lines that compute `breakEvenTriggered` and `effectiveStop`
2. **TrailingStopChecker** (Phase 10) — lines that check `breakEvenTriggered` to adjust trail baseline
3. **MaxProfitManager** — `updateBreakevenStop()` method (lines 740-771) which moves stop to entry price + fee buffer

BreakEvenManager becomes the **single source of truth** for whether break-even is active and what the effective stop level is. StopLossChecker and TrailingStopChecker will QUERY it instead of computing it themselves.

---

## THE STATE MACHINE

```
INITIAL_STOP ──(maxProfit >= risk)──> BREAK_EVEN ──(trailing activates)──> TRAILING
     │                                     │                                   │
     │  Stop = contract.stopLossPercent    │  Stop = -0.05% (entry - buffer)  │  Stop = peak - trail%
     │                                     │                                   │
```

**Transition rules:**
- `INITIAL_STOP → BREAK_EVEN`: When `maxProfitPercent >= |stopLossPercent|` (trade "paid for itself")
- `BREAK_EVEN → TRAILING`: When trailing stop activates (handled by TrailingStopChecker, not this module)
- Break-even is a ONE-WAY transition — once triggered, it never goes back to INITIAL_STOP

---

## STEP 1: Create `core/exit/BreakEvenManager.js`

```javascript
/**
 * BreakEvenManager.js - Break-Even Stop State Machine
 * ====================================================
 * Single source of truth for break-even state.
 * When trade profits exceed initial risk (1:1 move), stop moves to entry.
 *
 * STATE MACHINE:
 *   INITIAL_STOP → (maxProfit >= risk) → BREAK_EVEN → (trailing takes over)
 *
 * USED BY:
 *   - StopLossChecker: queries getEffectiveStop() instead of computing BE inline
 *   - TrailingStopChecker: queries isBreakEven() to adjust trail baseline
 *   - ExitContractManager: calls evaluate() each tick
 *
 * @module core/exit/BreakEvenManager
 */

'use strict';

// Fee buffer: stop moves to entry minus this, so a BE exit still covers fees
const BE_FEE_BUFFER_PERCENT = 0.05; // -0.05% below entry

class BreakEvenManager {
  /**
   * Evaluate break-even state for a trade
   * Call this BEFORE StopLossChecker and TrailingStopChecker each tick.
   *
   * @param {Object} trade - Trade object with exitContract, maxProfitPercent, entryPrice
   * @returns {Object} {
   *   isBreakEven: boolean,        - Whether BE is currently active
   *   effectiveStopPercent: number, - The stop to use (-0.05 if BE, else contract SL)
   *   reason: string               - Why this state
   * }
   */
  evaluate(trade) {
    const contract = trade.exitContract || {};
    const stopLossPercent = contract.stopLossPercent;

    // No contract or no SL defined — can't compute BE
    if (stopLossPercent === undefined || stopLossPercent === null) {
      return {
        isBreakEven: false,
        effectiveStopPercent: null,
        reason: 'no_contract'
      };
    }

    const riskAmount = Math.abs(stopLossPercent);
    const maxProfit = trade.maxProfitPercent || 0;

    // Break-even triggers when maxProfit >= initial risk (1:1 payoff)
    if (maxProfit >= riskAmount) {
      return {
        isBreakEven: true,
        effectiveStopPercent: -BE_FEE_BUFFER_PERCENT,
        reason: `BE active: peak ${maxProfit.toFixed(2)}% >= risk ${riskAmount.toFixed(2)}%`
      };
    }

    return {
      isBreakEven: false,
      effectiveStopPercent: stopLossPercent,
      reason: `Needs ${(riskAmount - maxProfit).toFixed(2)}% more to trigger BE`
    };
  }

  /**
   * Check if break-even threshold has been reached
   * @param {Object} trade
   * @returns {boolean}
   */
  isTriggered(trade) {
    const contract = trade.exitContract || {};
    const riskAmount = Math.abs(contract.stopLossPercent || 1.0);
    return (trade.maxProfitPercent || 0) >= riskAmount;
  }

  /**
   * Get effective stop loss percent (accounts for break-even)
   * @param {Object} trade
   * @returns {number} Stop loss percent to use
   */
  getEffectiveStop(trade) {
    const result = this.evaluate(trade);
    return result.effectiveStopPercent;
  }

  /**
   * Get break-even price in dollars (for dashboard display)
   * @param {Object} trade - Trade with entryPrice
   * @param {number} [feeBufferPercent=0.05] - Buffer above entry for fees
   * @returns {number|null} Break-even price or null if not applicable
   */
  getBreakEvenPrice(trade, feeBufferPercent = BE_FEE_BUFFER_PERCENT) {
    if (!trade || !trade.entryPrice) return null;
    // BE price = entry price minus tiny buffer (long position)
    return trade.entryPrice * (1 - feeBufferPercent / 100);
  }
}

module.exports = BreakEvenManager;
```

---

## STEP 2: Update `core/exit/StopLossChecker.js` to use BreakEvenManager

**Replace** the inline break-even computation with a BreakEvenManager query.

Add import at top:
```javascript
const BreakEvenManager = require('./BreakEvenManager');
```

Update constructor:
```javascript
constructor(universalLimits) {
  this.universalLimits = universalLimits;
  this.breakEvenManager = new BreakEvenManager();
}
```

In the `check()` method, **replace** the inline break-even block:
```javascript
// OLD (remove this):
// const riskAmount = Math.abs(contract.stopLossPercent);
// const breakEvenTriggered = trade.maxProfitPercent && trade.maxProfitPercent >= riskAmount;
// const effectiveStop = breakEvenTriggered ? -0.05 : contract.stopLossPercent;

// NEW (replace with):
const beState = this.breakEvenManager.evaluate(trade);
const effectiveStop = beState.effectiveStopPercent;
const breakEvenTriggered = beState.isBreakEven;
```

The rest of the method stays the same — `effectiveStop` and `breakEvenTriggered` variables are still used identically downstream.

Also update `getEffectiveStop()`:
```javascript
getEffectiveStop(trade) {
  return this.breakEvenManager.getEffectiveStop(trade);
}
```

---

## STEP 3: Update `core/exit/TrailingStopChecker.js` to use BreakEvenManager

Add import at top:
```javascript
const BreakEvenManager = require('./BreakEvenManager');
```

Add to constructor (or add a constructor if there isn't one):
```javascript
constructor() {
  this.breakEvenManager = new BreakEvenManager();
}
```

In the `check()` method, **replace** the inline break-even computation:
```javascript
// OLD (remove this):
// const riskAmount = Math.abs(contract.stopLossPercent || 1.0);
// const breakEvenTriggered = trade.maxProfitPercent >= riskAmount;
// const effectiveStop = breakEvenTriggered ? -0.05 : contract.stopLossPercent;

// NEW (replace with):
const beState = this.breakEvenManager.evaluate(trade);
const breakEvenTriggered = beState.isBreakEven;
const effectiveStop = beState.effectiveStopPercent;
```

The rest stays identical — `trailTrigger` and the `trailStop > effectiveStop` comparison still use the same variable names.

---

## STEP 4: Update `ExitContractManager.js` to expose BreakEvenManager

Add import:
```javascript
const BreakEvenManager = require('./exit/BreakEvenManager');
```

Add to constructor:
```javascript
this.breakEvenManager = new BreakEvenManager();
```

This lets the runner or dashboard query break-even state if needed:
```javascript
// Example future use:
// const beState = exitContractManager.breakEvenManager.evaluate(trade);
// dashboard.update({ breakEven: beState.isBreakEven });
```

**DO NOT** change `checkExitConditions()` — the checkers already handle break-even via their own BreakEvenManager instances. ECM just holds a reference for external access.

---

## STEP 5: DO NOT touch MaxProfitManager

MaxProfitManager has its own `updateBreakevenStop()` that works on dollar-based stop prices (not percentages). It runs on a SEPARATE exit system flag (`activeExitSystem === 'maxprofit'`). These two break-even systems serve different code paths:

- **BreakEvenManager** (Phase 11): Percentage-based, used by ExitContract checkers
- **MaxProfitManager.updateBreakevenStop**: Dollar-based, used by MPM's tiered exit system

They don't conflict because only ONE exit system is active at a time (controlled by `EXIT_SYSTEM` env var). Consolidating them is a Phase 12+ concern if we deprecate MPM. **Do not modify MaxProfitManager.**

---

## STEP 6: DO NOT touch run-empire-v2.js

The runner still calls:
- `exitContractManager.checkExitConditions()` — unchanged
- `exitContractManager.updateMaxProfit()` — unchanged

Break-even is entirely encapsulated inside the checker modules now.

---

## STEP 7: Golden Test

```bash
BACKTEST_MODE=true node run-empire-v2.js --candles 500 2>&1 | tail -30
```

**MUST SEE:**
- No crashes
- `break_even` exit reasons still appearing in logs
- Same trade count and P&L as Phase 10

**Unit validation:**
```bash
node -e "
const BreakEvenManager = require('./core/exit/BreakEvenManager');
const be = new BreakEvenManager();

// Trade with 1% SL risk, hasn't hit 1:1 yet
const trade1 = {
  exitContract: { stopLossPercent: -1.0 },
  maxProfitPercent: 0.5
};
const r1 = be.evaluate(trade1);
console.log('Not triggered:', !r1.isBreakEven ? 'PASS' : 'FAIL');
console.log('SL unchanged:', r1.effectiveStopPercent === -1.0 ? 'PASS' : 'FAIL');

// Trade with 1% SL risk, hit 1:1 (maxProfit >= 1.0)
const trade2 = {
  exitContract: { stopLossPercent: -1.0 },
  maxProfitPercent: 1.2
};
const r2 = be.evaluate(trade2);
console.log('BE triggered:', r2.isBreakEven ? 'PASS' : 'FAIL');
console.log('Stop at -0.05:', r2.effectiveStopPercent === -0.05 ? 'PASS' : 'FAIL');

// No contract
const trade3 = { exitContract: {} };
const r3 = be.evaluate(trade3);
console.log('No contract:', !r3.isBreakEven ? 'PASS' : 'FAIL');
console.log('Null stop:', r3.effectiveStopPercent === null ? 'PASS' : 'FAIL');

// isTriggered convenience
console.log('isTriggered false:', !be.isTriggered(trade1) ? 'PASS' : 'FAIL');
console.log('isTriggered true:', be.isTriggered(trade2) ? 'PASS' : 'FAIL');

// Dollar price
const trade4 = { entryPrice: 100000, exitContract: { stopLossPercent: -1.0 }, maxProfitPercent: 1.5 };
const bePrice = be.getBreakEvenPrice(trade4);
console.log('BE price ~99950:', Math.abs(bePrice - 99950) < 1 ? 'PASS' : 'FAIL');

// Now test that StopLossChecker integrates correctly
const StopLossChecker = require('./core/exit/StopLossChecker');
const sl = new StopLossChecker({ hardStopLossPercent: -2.0, accountDrawdownPercent: -10.0 });

// Trade at break-even — SL should be at -0.05%, not -1.0%
const trade5 = {
  entryPrice: 100000,
  exitContract: { stopLossPercent: -1.0 },
  maxProfitPercent: 1.5,
  entryStrategy: 'EMASMACrossover'
};
const slResult = sl.check(trade5, 99940, -0.06, {});
console.log('BE exit triggers:', slResult.shouldExit ? 'PASS' : 'FAIL');
console.log('BE reason:', slResult.exitReason === 'break_even' ? 'PASS' : 'FAIL');

// Same trade but P&L at -0.03% (above -0.05) — should NOT exit
const slResult2 = sl.check(trade5, 99970, -0.03, {});
console.log('BE holds:', !slResult2.shouldExit ? 'PASS' : 'FAIL');

console.log('\\nBreakEvenManager integration verified.');
"
```

---

## STEP 8: Commit

```bash
git add core/exit/BreakEvenManager.js core/exit/StopLossChecker.js core/exit/TrailingStopChecker.js core/ExitContractManager.js
git commit -m "refactor(phase11): Extract BreakEvenManager state machine

- BreakEvenManager: single source of truth for BE activation
- State machine: INITIAL_STOP → BREAK_EVEN → TRAILING
- StopLossChecker: queries BreakEvenManager instead of inline BE calc
- TrailingStopChecker: queries BreakEvenManager for trail baseline
- MaxProfitManager: UNTOUCHED (separate exit system, dollar-based)
- run-empire-v2.js: UNCHANGED
- Golden test: same exits, break_even reasons still fire"
```

---

## WHAT NOT TO DO

1. **DO NOT** create ExitDecider — that's Phase 12
2. **DO NOT** modify MaxProfitManager — its break-even is dollar-based and runs on a separate exit system flag
3. **DO NOT** modify run-empire-v2.js — zero runner changes
4. **DO NOT** add state tracking to BreakEvenManager (no `this.state` per trade) — it's stateless, evaluates from trade data each call. State lives on the trade object (`maxProfitPercent`).
5. **DO NOT** skip the unit test that verifies StopLossChecker integrates with BreakEvenManager correctly
6. **DO NOT** proceed to Phase 12 without approval
