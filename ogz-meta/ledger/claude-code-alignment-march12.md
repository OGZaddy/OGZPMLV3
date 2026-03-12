# CLAUDE CODE ALIGNMENT — March 12, 2026 Afternoon Session

## YOUR ROLE
You are executing code changes on the OGZPrime VPS at `/opt/ogzprime/OGZPMLV2` branch `main`.
Opus (Claude in browser) is the architect. Trey relays between us. Do NOT freelance — follow the spec.

## WHAT WAS ACCOMPLISHED TODAY (Batch A + E)

### Batch A (Data Contract) — 95% done
- Created `core/dto/IndicatorSnapshotDTO.js` — Zod schema with validateSnapshot() and validateSnapshotSafe()
- Refactored `IndicatorEngine.getSnapshot()` to return flat validated DTO (no nested indicators.indicators)
- Fixed RSI c.c bug (lines 488, 500) — was using `c.c` instead of `_c(c)`
- Fixed OBV c.c bug (lines 785, 790, 791)
- Ran AST transformer on 15 files — 42 replacements of direct property access to helper functions
- Removed all `rsi || 50` silent fallbacks (7 files) — RSI is now real value or null, never faked
- Killed fake indicator construction in TradingLoop warmup — returns early instead of fabricating RSI=50
- Changed BacktestRunner warmup threshold from 15 → 200 candles (EMA200 needs 200 to produce valid data)

### Batch E (CI Scaffolding) — 100% done
- Installed zod, recast, @babel/parser, jest as devDependencies
- Created `ogz-meta/ast/property-to-function.js` — AST transformer
- Created `ogz-meta/ast/scan-dto-violations.js` — AST scanner for nested indicators
- Created `scripts/lint-dto.js` — regex DTO violation scanner
- Created `test/rsi-deterministic.test.js` — 5 Jest tests all passing
- Added npm scripts: lint:dto, scan:dto, fix:props, test, baseline, regression, ci
- `npm run ci` passes (lint + scan + tests)

### Additional fixes applied today
- Added CandleHelper underscore aliases (_c, _o, _h, _l, _v, _t) so both import styles work
- Fixed `validateEnvironment()` in run-empire-v2.js to recognize EXECUTION_MODE=backtest
- Fixed BacktestRunner to read CANDLE_FILE env var (was only reading CANDLE_DATA_FILE)
- Added PreToolUse hooks to enforce pipeline usage
- Pipeline toggles fully wired in TradingConfig

### First real backtest results
- 5,000 candles, RSI-only, long-only, 0.65% fees
- 28 trades fired, 1 win (3.6% win rate), balance $10,000 → $9,925 from trade P&L
- BUT final balance reported as $8,012 — there is a $1,912 unexplained gap (BUG — investigate)
- RSI fires real oversold signals and produces real trades through production pipeline

## VERIFICATION SCORECARD — 8/12 PASSING

| #  | Criterion | Status | Notes |
|----|-----------|--------|-------|
| 1  | npm test passes | ✅ PASS | 5/5 tests |
| 2  | scan:dto zero violations | ✅ PASS | |
| 3  | lint:dto zero violations | ✅ PASS | |
| 4  | BacktestRunner validates snapshots | ❌ PARTIAL | Volume NaN on every candle, state file not isolated |
| 5  | RSI oversold signals in 45K dataset | ❌ PARTIAL | Signals fire but not validated against known analytical values |
| 6  | Trade validator confirms entries | ❌ NOT DONE | Waterfall harness not deployed |
| 7  | Regression baseline saved | ❌ NOT DONE | No baseline JSON exists |
| 8  | No indicators.indicators pattern | ✅ PASS | |
| 9  | No c.c in IndicatorEngine | ✅ PASS | |
| 10 | Fee 0.65% everywhere | ✅ PASS | |
| 11 | Long-only on spot | ✅ PASS | |
| 12 | Singleton double-gate | ✅ PASS | |

## WHAT YOU NEED TO DO NOW — in this exact order

### FIX 1: Isolate backtest state from production (CRITICAL)
The backtest overwrote the live bot's state file today. This must never happen again.

In `core/BacktestRunner.js`, at the start of `loadHistoricalDataAndBacktest()`, add:
```javascript
// Isolate backtest state from production
const originalStateFile = process.env.STATE_FILE;
process.env.STATE_FILE = 'data/state-backtest.json';
```
And at the end of the method (in finally block):
```javascript
process.env.STATE_FILE = originalStateFile;
```

Also check `core/StateManager.js` — find where it reads STATE_FILE or defaults to `data/state.json` and make sure backtest mode uses the isolated file.

### FIX 2: Fix volume NaN everywhere
The `volume: NaN` error comes from candles where volume is undefined or the helper function isn't imported.

Files that still need the CandleHelper aliased import `const { c: _c, o: _o, h: _h, l: _l, v: _v, t: _t } = require('./CandleHelper')`:
- `core/TradingLoop.js` — check if import exists
- `core/TimeFrameManager.js` — check if import exists  
- `core/DashboardBroadcaster.js` — check if import exists
- `modules/MultiTimeframeAdapter.js` — needs `require('../core/CandleHelper')` (different path)

Also fix MultiTimeframeAdapter.js lines 146-149 — the AST transformer incorrectly converted property WRITES to function calls:
```javascript
// WRONG (AST transformer broke these):
_h(pending) = Math.max(_h(pending), _h(minuteCandle));
// CORRECT:
pending.h = Math.max(_h(pending), _h(minuteCandle));
pending.l = Math.min(_l(pending), _l(minuteCandle));
pending.c = _c(minuteCandle);
pending.v += (_v(minuteCandle) || 0);
```
Property READS use the helper: `_h(pending)`. Property WRITES use direct access: `pending.h = ...`

### FIX 3: Deploy waterfall regression harness
Create these files from the Mercury 2 Code Reference document (already provided to you):
- `test/regression/waterfall.js`
- `test/fixtures/rsi-candle-set.json` (use the Wilder textbook candle set from the deterministic test)

### FIX 4: Save regression baseline
After fixes 1-3:
```bash
ENABLE_RSI=true ENABLE_MASR=false ENABLE_EMA=false ENABLE_LIQSWEEP=false \
CANDLE_SOURCE=file CANDLE_FILE=/tmp/small-5k.json \
EXECUTION_MODE=backtest DIRECTION_FILTER=long_only \
node test/regression/waterfall.js baseline
```

### FIX 5: Investigate the $1,987 balance gap
The backtest showed 28 trades that lost a total of ~$75. But the final balance was $8,012 (down $1,987).
Where did the other $1,912 go? Possible causes:
- DrawdownTracker applying penalties
- RiskManager reducing balance
- Position left open at backtest end (forced close at bad price)
- Multiple position tracking bug (opening new position before closing old one)

Search for all places that modify balance:
```bash
grep -n "balance" core/StateManager.js core/RiskManager.js core/DrawdownTracker.js core/PnLTracker.js | grep -i "update\|set\|subtract\|reduce\|modify"
```

### FIX 6: Update AST transformer to skip assignment targets
The transformer that converts `obj.c` → `_c(obj)` must NOT convert when `obj.c` is on the LEFT side of an assignment. Add this check in `ogz-meta/ast/property-to-function.js` before replacing:
```javascript
// Skip assignment targets — can't write to function call result
if (p.parentPath && p.parentPath.node.type === 'AssignmentExpression' 
    && p.parentPath.node.left === node) {
  this.traverse(p);
  return;
}
// Also skip UpdateExpression (+=, -=)
if (p.parentPath && p.parentPath.node.type === 'UpdateExpression') {
  this.traverse(p);
  return;
}
```

## REFERENCE DOCUMENTS
You should have these files already:
- `OGZPrime-Master-Engineering-Spec.md` — full architecture spec
- `Mercury2-Code-Reference.md` — every code snippet ready to drop in
- `opening-range-fvg-spec.md` — next strategy to build (AFTER refactor is done)

## RULES
1. Use the pipeline for ALL code changes to production files
2. `git commit` after each fix — not in bulk
3. Run `npm run ci` after each fix to verify nothing broke
4. Show me (Trey) the exact changes before applying
5. Do NOT touch the live bot process (PID 3417117) — it's running since March 6
6. Do NOT write to `data/state.json` — that's production state

## WHEN ALL 6 FIXES ARE DONE
Run the full verification:
```bash
npm run ci
npm run regression -- verify
```
Then produce an updated scorecard showing all 12 criteria.
