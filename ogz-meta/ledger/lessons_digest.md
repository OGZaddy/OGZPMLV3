# Lessons Digest

*Generated: 2026-02-20T03:37:51.279Z*

## Key Lessons

- ✅ Preserving features array through pipeline
- ❌ Never: String signature truncation
- ✅ StateManager is now the ONLY source of truth
- ✅ No more phantom trades or balance mismatches
- ✅ All modules read/write to same centralized state
- ✅ Bot never waits for TRAI decisions
- ✅ Can react instantly to market moves
- ✅ TRAI does post-trade learning only
- ✅ Mathematical logic drives real-time decisions
- ✅ Active trades persist across restarts
- ✅ Bot remembers exact position after crash
- ✅ No more lost trades on reboot
- ✅ Automatic save after every state update
- ✅ Full IBrokerAdapter compliance
- ✅ Position tracking via StateManager
- ✅ Account polling (compensates for no private WebSocket)
- ✅ Working solution now, native rewrite later
- ✅ No more stack overflow on rate limits
- ✅ No more promise accumulation/memory leak
- ✅ Clean queue-based retry mechanism

## Common Patterns

### pattern-memory
- Fixed feature data conversion in pattern pipeline
- Fixed feature data conversion in pattern pipeline
- Fix 1: FeatureExtractor returns default features [0.5,0,0,0.02,0.01,0.5,0,0,0] instead of [] when candles empty. Fix 2: recordPattern() only updates wins/losses/totalPnL when typeof result.pnl === 'number', observations (pnl:null) only increment timesSeen. Fix 3: Re-enabled entry recording with pnl:null for observation-only mode.

### recording
- Fixed feature data conversion in pattern pipeline
- Fixed feature data conversion in pattern pipeline

### state
- - **File**: `run-empire-v2.js` (multiple locations)
- - **File**: `run-empire-v2.js` (multiple locations)
- - **File**: `run-empire-v2.js` (multiple locations)

### trai
- - **File**: `run-empire-v2.js` lines 931-954
- - **File**: `core/StateManager.js` lines 326-385
- - **File**: `run-empire-v2.js` lines 931-954

### performance
- - **File**: `run-empire-v2.js` lines 931-954
- - **File**: `run-empire-v2.js` lines 931-954
- - **File**: `run-empire-v2.js` lines 931-954

### rate-limit
- - **File**: `kraken_adapter_simple.js` lines 109-204
- - **File**: `kraken_adapter_simple.js` lines 109-204
- - **File**: `kraken_adapter_simple.js` lines 109-204

### signals
- Added `&& brainDirection === 'buy'` to BUY condition at run-empire-v2.js:1908
- (1) Replaced 0.40 gate with 5% edge minimum (2) Removed regime filter double-punishment (3) Narrowed RSI safety from 80/20 to 88/12 (4) Simplified determineTradingDirection to passthrough (5) Changed minimumMatches to 1 (6) Changed confidenceThreshold to 0.2

### execution
- Added `&& brainDirection === 'buy'` to BUY condition at run-empire-v2.js:1908

### profitability
- Added `&& brainDirection === 'buy'` to BUY condition at run-empire-v2.js:1908
- Added `|| profitResult.action === 'exit_partial'` to the exit check at run-empire-v2.js:2082. Also passes exitSize in return for partial position closing.
- Added 0.26% fee deduction on both entry (openPosition line 316) and exit (closePosition line 400) in StateManager.js

### exits
- Added `|| profitResult.action === 'exit_partial'` to the exit check at run-empire-v2.js:2082. Also passes exitSize in return for partial position closing.
- Replaced Date.now() with `this.marketData?.timestamp || Date.now()` at lines 2090, 2134, 2320, 2432, 2522, 2528. Passed candle timestamp via context to StateManager.openPosition().
- Changed feeBuffer from 0.001 to 0.0035 at MaxProfitManager.js:730

