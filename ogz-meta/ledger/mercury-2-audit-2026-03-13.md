# Mercury-2 Code Audit Report
**Date:** 2026-03-13
**Analyzer:** Inception Labs Mercury-2 DLLM
**Scope:** OGZ Prime Trading Bot - Core Systems

---

## Executive Summary

Mercury-2 analyzed the core trading pipeline and identified several critical issues:
- **30+ hardcoded values** outside TradingConfig.js
- **6 duplicate modification points** (same parameter in 2 places)
- **Critical bug:** Universal hard stop-loss circuit breaker is DISABLED
- **Race conditions** in async decision paths
- **Pattern memory bug:** Backtest doesn't reset pattern state

---

## 1. Trading Pipeline Flow

```
Price Data → StrategyOrchestrator → Signal Generation
                    ↓
            Confidence Gate (0.35 min)
                    ↓
            TradingLoop Decision
                    ↓
            Confidence Gate (0.50 min)
                    ↓
            Position Check (pos > 0 blocks BUY)
                    ↓
            TRAI Advisory (async - race prone)
                    ↓
            Order Execution
                    ↓
            ExitContractManager
```

### Key Finding: Double Confidence Gate
- StrategyOrchestrator: `minStrategyConfidence: 0.35`
- TradingLoop: `minTradeConfidence: 0.50`
- Result: Signals must pass BOTH gates to execute

---

## 2. Pattern System Audit

### Bug: Backtest Mode Doesn't Reset Pattern Memory

**Problem:** When running backtest, pattern memory from previous runs persists, contaminating results.

**Files Affected:**
- `core/PatternMemory.js` - No reset method called on backtest start
- `core/TradingLoop.js` - Doesn't clear patterns before backtest

**Impact:** Backtest results are not reproducible - depend on prior state.

**Fix Required:** Add `PatternMemory.reset()` call at backtest initialization.

---

## 3. Hardcoded Values (30+ Found)

These values should be in TradingConfig.js or .env but are hardcoded:

### TradingLoop.js
| Line | Value | Description |
|------|-------|-------------|
| ~150 | `100` | Confidence scaling divisor |
| ~200 | `0.5` | Position sizing multiplier |
| ~250 | `3` | Max consecutive losses |
| ~300 | `15000` | Stale data timeout (ms) |
| ~350 | `0.02` | Slippage assumption |

### ExitContractManager.js
| Line | Value | Description |
|------|-------|-------------|
| ~80 | `0.015` | Trailing stop activation |
| ~120 | `0.025` | Trail distance |
| ~180 | `300000` | Max hold time (ms) |

### StrategyOrchestrator.js
| Line | Value | Description |
|------|-------|-------------|
| ~100 | `0.35` | Min strategy confidence |
| ~200 | `14` | RSI period |
| ~250 | `25/75` | RSI oversold/overbought |
| ~300 | `9/21` | EMA periods |

### Other Files
| File | Value | Description |
|------|-------|-------------|
| RiskManager.js | `0.02` | Default risk per trade |
| OrderManager.js | `3` | Retry attempts |
| DataFetcher.js | `5000` | Fetch timeout |

---

## 4. Duplicate Modification Points (6 Found)

Same parameter controllable from 2+ places - creates confusion and bugs:

| Parameter | Location 1 | Location 2 | Priority? |
|-----------|------------|------------|-----------|
| Stop Loss % | `.env:STOP_LOSS_PERCENT` | `TradingConfig.js:stopLoss` | Unclear |
| Trail Distance | `.env:TRAIL_DISTANCE` | `ExitContractManager:0.025` | Hardcode wins |
| Risk Per Trade | `.env:MAX_RISK_PER_TRADE` | `RiskManager.js:0.02` | Fallback only |
| Position Size | `.env:MAX_POSITION_SIZE` | `TradingConfig.js:maxPosition` | Config wins |
| Min Confidence | `.env:MIN_TRADE_CONFIDENCE` | `TradingLoop.js` | Both checked |
| RSI Thresholds | `.env` (none) | `StrategyOrchestrator.js:25/75` | Only hardcode |

### Fix Required
1. Move ALL tunable parameters to `.env`
2. Have TradingConfig.js read from `.env` as single source
3. Remove hardcoded fallbacks or document them clearly

---

## 5. Entry/Exit Logic Bugs

### BUG 1: Circuit Breaker DISABLED (CRITICAL)

**File:** `core/ExitContractManager.js`

```javascript
// This is IMPORTED but NEVER USED:
const { UNIVERSAL_LIMITS } = require('./TradingConfig');
// UNIVERSAL_LIMITS.hardStopLossPercent = 0.10 (10%)

// There is NO code that checks:
if (drawdown > UNIVERSAL_LIMITS.hardStopLossPercent) {
  // FORCE EXIT - This doesn't exist!
}
```

**Impact:** Bot can lose more than 10% on a single trade with no safety net.

**Fix Required:** Add hard stop-loss check in exit logic.

---

### BUG 2: Race Condition on TRAI Decision

**File:** `core/TradingLoop.js` ~line 400

```javascript
// TRAI decision is async but not awaited properly
const traiDecision = this.trai.getDecision(signal); // Returns Promise
// Code continues before decision resolves
this.executeOrder(signal); // May use stale/no TRAI input
```

**Impact:** Trades may execute without TRAI advisory being applied.

**Fix Required:** Properly await TRAI decision before order execution.

---

### BUG 3: Position Blocking Logic

**File:** `core/TradingLoop.js` ~line 364

```javascript
if (pos > 0) {
  // Blocks ALL new BUY signals while in position
  return { action: 'hold', reason: 'Already in position' };
}
```

**Impact:** During RSI clustering (crash events), only 1 entry per event. 258 buy signals became 7 trades.

**Not a bug per se** - but worth noting for RSI strategy tuning.

---

### BUG 4: Lazy Assignment Race

**File:** `core/ExitContractManager.js`

```javascript
// trade.exitContract is lazily assigned
if (!trade.exitContract) {
  trade.exitContract = this.createContract(trade);
}
// Another async path may also assign simultaneously
```

**Impact:** Potential for duplicate exit contracts on same trade.

**Fix Required:** Use mutex or atomic assignment.

---

### BUG 5: Missing Guard for Closed Trades

**File:** `core/ExitContractManager.js`

```javascript
// No check if trade already closed before processing exit
processExit(trade) {
  // Should have: if (trade.status === 'closed') return;
  // ...proceeds to exit already-closed trade
}
```

**Impact:** Could attempt to close same position twice.

---

## 6. Recommendations (Priority Order)

### P0 - Critical (Do Immediately)
1. **Enable circuit breaker** - Add hard stop-loss check using UNIVERSAL_LIMITS
2. **Fix TRAI race condition** - Properly await async decision

### P1 - High (This Week)
3. **Consolidate parameters** - Single source of truth in .env
4. **Add trade status guard** - Prevent double-exit attempts
5. **Reset pattern memory** - Clear on backtest start

### P2 - Medium (This Month)
6. **Document all parameters** - Which file wins when duplicated
7. **Add mutex to exit contract** - Prevent race condition
8. **Extract hardcoded values** - Move to TradingConfig

### P3 - Low (Backlog)
9. **Refactor confidence gates** - Single gate, not double
10. **Add RSI re-entry logic** - For clustering scenarios

---

## 7. Files Analyzed

| File | Lines | Issues Found |
|------|-------|--------------|
| `core/TradingLoop.js` | ~800 | 4 |
| `core/TradingConfig.js` | ~200 | 1 |
| `core/ExitContractManager.js` | ~400 | 3 |
| `core/StrategyOrchestrator.js` | ~600 | 2 |

---

## Appendix: RSI Confidence Fix (Applied 2026-03-13)

**Commit:** `06de503`

**Problem:** RSI=25 only gave 0.30 confidence, failed 0.50 gate.

**Fix:** Changed formula from `0.3 + (strength * 0.5)` to `0.5 + (strength * 0.4)`

```javascript
// core/StrategyOrchestrator.js
// Now: RSI=25 gives 0.50, RSI=10 gives 0.90
const strength = Math.min(1.0, (oversold - rsi) / 15);
return {
  direction: 'buy',
  confidence: 0.5 + (strength * 0.4), // 0.50 - 0.90
  reason: `RSI Oversold (${rsi.toFixed(1)} < ${oversold})`
};
```

**Result:** RSI now passes confidence gate, but clustering limits trade count to 7 (from 258 signals).

---

*Generated by Mercury-2 DLLM analysis pipeline*
