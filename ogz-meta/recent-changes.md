
---

## 2026-03-26: Long-Only Pipeline Fix (17 Bugs)

**Impact:** CRITICAL - Shorts were completely broken

**Summary:** Complete audit of pipeline revealed 17 locations where code assumed long-only trading. All fixed:

- TradingLoop: Added SELL_SHORT decision branch
- OrderExecutor: Added SELL_SHORT entry + COVER exit handlers
- StateManager: Direction storage, negative position support, balance accounting
- Exit system: Direction-aware PnL in all checkers
- RiskManager: Bypass now defaults to false

**Files Changed:**
- core/TradingLoop.js
- core/OrderExecutor.js
- core/StateManager.js
- core/ExitContractManager.js
- core/exit/DynamicTrailingStop.js
- core/exit/TrailingStopChecker.js
- core/RiskManager.js

**Status:** Pushed, awaiting backtest verification

