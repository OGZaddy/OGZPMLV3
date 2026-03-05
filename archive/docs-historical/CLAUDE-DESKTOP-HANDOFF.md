# Claude Desktop Handoff - Tiered Exit Fix

## Status: One Bug Remaining

We fixed 6 bugs, tiered exits ARE firing now, but Bug #7 blocks them.

## The Problem

`run-empire-v2.js:2436` returns a SELL decision but forgets to include `exitReason`:

```javascript
// Current (BROKEN)
return { action: 'SELL', direction: 'close', confidence: totalConfidence, exitSize: profitResult.exitSize };

// Fixed (ADD exitReason)
return { action: 'SELL', direction: 'close', confidence: totalConfidence, exitSize: profitResult.exitSize, exitReason: profitResult.reason };
```

## Why This Matters

1. MaxProfitManager fires `profit_tier_1` with `exit_partial`
2. run-empire-v2.js:2434-2436 catches it and returns SELL
3. BUT it doesn't include `exitReason: profitResult.reason`
4. So at line 2572, `isProfitExit` is false (no exitReason to check)
5. Exit gets blocked by `MIN_SELL_CONFIDENCE` at line 2574-2577

## Evidence from Backtest

```
📉 SELL Signal: profit_tier_1 (exit_partial)
[EXIT BLOCKED] Confidence 10.0% < 30% minimum
```

Tiered exit fired but got blocked because `isProfitExit` was false.

## The Fix

File: `run-empire-v2.js`
Line: 2436

```javascript
// OLD:
return { action: 'SELL', direction: 'close', confidence: totalConfidence, exitSize: profitResult.exitSize };

// NEW:
return { action: 'SELL', direction: 'close', confidence: totalConfidence, exitSize: profitResult.exitSize, exitReason: profitResult.reason };
```

## After Fix

1. Apply the one-line fix
2. Run backtest: `BACKTEST_FAST=1 EXIT_SYSTEM=legacy BACKTEST_LIMIT=5000 node run-empire-v2.js`
3. Grep for `profit_tier` in exit reasons to confirm they're working
4. Commit and push

## Already Fixed (6 bugs)

1. Tier targets in .env (2% → 0.5%)
2. Partial close wiring in run-empire-v2.js
3. Action name mismatch (exit_partial)
4. Exit reason string match (.startsWith)
5. Duplicate TRAILING_STOP_PERCENT
6. Config key typo (enableTieredExits)

All committed to `fix/candle-helper-wip` and pushed.

## Command to Pull

```bash
git pull origin fix/candle-helper-wip
```
