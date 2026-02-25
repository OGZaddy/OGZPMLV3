# HANDOFF FROM OPUS SESSION — 2026-02-21
# Priority: HIGH — Exit contracts are trapping every trade

## WHAT HAPPENED THIS SESSION

We ran grid search → discovered catastrophic execution failure (60k candles, only 4-10 trades). Found and fixed THREE execution blockers:

1. **ExecutionRateLimiter** (already removed from run-empire-v2.js line ~250 area) — 5-second cooldown blocked 95%+ trades in backtest
2. **Duplicate Intent Check** in AdvancedExecutionLayer (~line 170) — SHA256(Date.now()) creates identical hashes in backtest since Date.now() doesn't advance with candle timestamps. Added `BACKTEST_MODE` guard.
3. **RiskManager.assessTradeRisk** in AdvancedExecutionLayer (~line 199) — Daily loss limits breached on first trade. Added `BACKTEST_MODE` guard.

Then fixed **EMFILE errors** (too many open files on Windows during backtest) by adding `BACKTEST_MODE` guards to skip file I/O in:
- `core/EnhancedPatternRecognition.js` — saveToDisk() method
- `core/tradeLogger.js` — saveTrades() method  
- `core/AdvancedExecutionLayer-439-MERGED.js` — logTradeToFile() method
- `run-empire-v2.js` — candle history save

These changes are already in the files on disk. Verify they're there.

## THE REMAINING BUG: EXIT CONTRACT PRISON

Trades open but **never close on TP or SL**. Every single exit is a max hold timeout. This bleeds fees and kills P&L.

### Root cause (two parts):

**Part 1: ExitContractManager.js defaults were scaled for swing trading**
- ALREADY FIXED in the file. Defaults are now 0.3-0.5% SL, 0.5-1.0% TP, realistic for 1-minute candles.

**Part 2: run-empire-v2.js lines 2664-2703 OVERRIDE the defaults**
- Four strategy blocks hardcode OLD swing values (-1.5% to -2.0% SL, 2.0% to 4.0% TP)
- These get passed as `exitContractSignal` to `createExitContract()` which uses them INSTEAD of the defaults
- THIS IS NOT FIXED YET

### The fix:

**In run-empire-v2.js, lines 2664-2703:** Remove the hardcoded `stopLossPercent`, `takeProfitPercent`, and `trailingStopPercent` from ALL four exitContractSignal blocks. Keep ONLY the `invalidationConditions` array. This lets ExitContractManager.getDefaultContract() provide the correctly scaled values.

See the included patch file `PATCH-run-empire-v2-exitcontracts.patch` for exact find/replace.

**In ExitContractManager.js, inside createExitContract():** Change the volatility threshold from 2.0 to 5.0 and reduce the multipliers. On 1-minute data, volatility of 2.0 is normal — the current code inflates SL/TP on almost every trade.

### Validation:

After applying patches, run:
```
node quick-val.js
```

Check the output for `[EXIT-CONTRACT]` lines. You should see:
- EMASMACrossover: SL around -0.4%, TP around 0.8%
- RSI: SL around -0.35%, TP around 0.6%
- CandlePattern: SL around -0.3%, TP around 0.5%
- LiquiditySweep: SL around -0.3%, TP around 0.5%

And critically — you should see exits that say `stop_loss` or `take_profit` or `trailing_stop`, NOT just `max hold`.

## FILES ALREADY MODIFIED (verify these are correct):

1. `run-empire-v2.js` — ExecutionRateLimiter removed (~line 250), BACKTEST_MODE guard on candle save
2. `core/AdvancedExecutionLayer-439-MERGED.js` — BACKTEST_MODE guards on duplicate check, risk assessment, logTradeToFile
3. `core/EnhancedPatternRecognition.js` — BACKTEST_MODE guard on saveToDisk
4. `core/tradeLogger.js` — BACKTEST_MODE guard on saveTrades
5. `core/ExitContractManager.js` — Defaults already scaled for 1-minute (0.3-0.5% SL, 0.5-1.0% TP)
6. `quick-val.js` — V3 rewrite with verbose output capture

## FILES STILL NEED PATCHING:

1. `run-empire-v2.js` lines 2664-2703 — Remove hardcoded SL/TP from exitContractSignal blocks
2. `core/ExitContractManager.js` — Raise volatility threshold in createExitContract from 2.0 to 5.0
