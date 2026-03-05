# 06 – Recent Changes

Rolling summary of important changes so an AI/dev knows what reality looks like **now**, not 6 months ago.

---

## 2026-02-04 – Critical Trading Bug Fixes (The "$0 P&L / 200 Trades" Investigation)

### WebSocket Never Reconnected (WS_CONNECTED_017) - CRITICAL
- **Problem**: Liveness watchdog spammed "NO DATA FOR 140 SECONDS" but WebSocket never reconnected
- **Root Cause**: `connectWebSocketStream()` in `kraken_adapter_simple.js` never set `this.connected = true`
- Reconnect logic at `ws.on('close')` checked `if (this.connected)` - always false!
- **Fix**: Added `this.connected = true` in `ws.on('open')` handler (lines 569-577)
- **Result**: WebSocket auto-recovery actually works now
- **Note**: Fix applied outside pipeline - Warden failed to catch this

### TradeIntelligenceEngine Now ACTIVE
- **Problem**: Built 13-dimension intelligent trade management system to solve exit problems... left in SHADOW MODE
- **Why it matters**: Shadow mode logged decisions but never acted - trades still exited immediately with $0 P&L
- **Fix**: Changed default from shadow to active in `run-empire-v2.js` line 416
- **Result**: Trade intelligence (regime, momentum, structure, volume, etc.) now actually controls exits

### REVERTED: PAUSE_001 Was A Band-Aid
- **Original "Fix"**: Added isTrading check at start of `analyzeAndTrade()`
- **Why Reverted**: This was a band-aid masking the real problem
- **Real Root Cause**: WebSocket never reconnected (`this.connected` not set)
- **Real Fix**: `kraken_adapter_simple.js` ws.on('open') → `this.connected = true`
- **Lesson**: Don't add checks that mask symptoms - find and fix the actual cause

### AGGRESSIVE_LEARNING_MODE Works (BRAIN_001)
- **Problem**: TradingBrain rejected at 70% BEFORE run-empire could lower to 55%
- **Fix**: Set `tradingBrain.config.minConfidenceThreshold` BEFORE calling `getDecision()` (lines 1632-1644)
- **Result**: Pattern learning can now happen with 55% confidence trades

### Backtest Stale Data Check (BACKTEST_001)
- **Problem**: Stale data detection treated historical data as "old" and paused
- **Fix**: Skip stale check when `BACKTEST_MODE=true` (lines 1119-1126)
- **Result**: Backtesting no longer blocked by 2023 timestamps

### EventLoopMonitor DISABLED
- **Problem**: Paused trading on transient CPU spikes and never auto-resumed
- **Root Cause**: Someone added this "stability" feature without user request (commit 98fc6e9)
- **Why removed**: Liveness Watchdog already covers "no data" scenario; this was redundant and harmful
- **Fix**: Commented out initialization and start() call in `run-empire-v2.js` (lines 486-495, 1037-1044)
- **Result**: Bot no longer pauses forever on CPU spikes
- **File NOT deleted**: `core/EventLoopMonitor.js` kept for potential future use

### Backtest Trades Not Recording (BACKTEST_REPORT_001)
- **Problem**: Backtest showed `totalTrades: 0` and `trades: []` despite balance changing from $10k → $9.5k
- **Root Cause**: `AdvancedExecutionLayer` never initialized `this.trades = []` array
- Trade recording code checked `if(this.executionLayer.trades)` which was undefined
- **Fix**: Added `this.trades = [];` to constructor in `core/AdvancedExecutionLayer-439-MERGED.js`
- **Result**: Backtest now reports actual trade history (totalTrades: 15, winRate, etc.)

---

## 2026-01-31 – Dashboard Polish & Stability Hardening

### WebSocket Auto-Recovery (CRITICAL)
- **Problem**: Dashboard WebSocket died silently (no close event), required manual restart
- **Root Cause**: TCP connection died but readyState stayed "OPEN" (zombie socket)
- **Fix**: Aggressive heartbeat + data watchdog in `run-empire-v2.js`
  - Ping every 15s (was 30s)
  - Pong timeout 30s (was 45s)
  - Data watchdog: force reconnect if no messages for 60s
  - Reconnect delay 2s (was 5s)
- **Result**: Auto-recovery within 60s max, no more manual restarts

### TRAI Response Cleaning
- **Problem**: TRAI chat returned raw `<think>...</think>` tags from DeepSeek model
- **Root Cause**: Regex only removed complete tag pairs, not incomplete/orphaned
- **Fix**: `core/persistent_llm_client.js` now handles:
  - Incomplete `<think>` blocks (no closing tag)
  - Orphan `</think>` tags
  - Garbage tokens before `<think>`
  - Fallback response if empty after cleaning

### Dashboard UI Fixes
- Trade log max-height: 200px → 400px (no more cutoff)
- Page scroll enabled (overflow-y: auto)
- Theme customization: 5 presets (Default, Ocean, Sunset, Royal, Hacker)
- Chain of Thought: gradient backgrounds, glowing decision badges

### V2 Architecture: BrokerFactory Single Source of Truth (CRITICAL)
- **Problem**: AI assistants added fallback that bypassed BrokerFactory
- **Root Cause**: When BrokerFactory failed for any reason, code fell back to creating KrakenAdapterSimple directly
- **Why it matters**: When multiple brokers (Kraken, Coinbase, Alpaca, Gemini, etc.) are added, bypasses create unmaintainable spaghetti
- **Fix**: Removed fallback from `run-empire-v2.js`
  - If BrokerFactory fails, bot fails (no silent bypasses)
  - ALL broker connections go through BrokerFactory
  - Data flow: `Market → Broker Adapter → BrokerFactory → Bot → Dashboard`
- **Result**: V2 architecture enforced, scalable for multi-broker future

---

## 2026-01-30 – Dashboard Overhaul for Proof Display

### Multi-Timeframe OHLC (CRITICAL)
- **Problem**: Changing timeframes showed wrong/empty candles
- **Fix**: `kraken_adapter_simple.js` + `run-empire-v2.js`
  - All timeframes now subscribed (1m, 5m, 15m, 30m, 1h, 4h, 1d)
  - `getHistoricalOHLC()` REST API for historical data
  - WebSocket for real-time, REST for history
- **Result**: 4H and 1D timeframes now show proper historical bars

### Indicators from Historical Data
- **Problem**: Indicators (EMA, BB, VWAP) were flat lines / jagged steps
- **Fix**: `public/unified-dashboard.html`
  - Client-side calculateEMA(), calculateBollingerBands(), calculateVWAP()
  - Indicators populated with setData() on historical load
- **Result**: Smooth indicator curves

### Pattern SVG Visualizations
- Added 17 pattern SVG diagrams (double bottom/top, triangles, H&S, etc.)
- Pattern Analysis box shows graphical diagram, not just text
- `getPatternSVG()` function for pattern → SVG lookup

### Trade Log BUY/SELL Priority
- **Problem**: Trade log showed LONG/SHORT (confusing for spot trading)
- **Fix**: Priority `action || direction` instead of `direction || action`
- Spot trading now shows BUY/SELL consistently

### Real-time Proof Publishing
- `publishLiveProof()` auto-updates `public/proof/live-trades.json`
- Shows last 20 trades with prices, reasons, confidence
- Accessible at https://ogzprime.com/proof/live-trades.json

---

## 2026-01-29 – Architecture: Dashboard Server Consolidation

### Redundant Dashboard Server Removed
- **Old**: Separate `dashboard-server.js` on port 3008
- **New**: `ogzprime-ssl-server.js` on port 3010 handles everything
- nginx routes all traffic to 3010
- Simpler architecture, fewer moving parts

### TRAI Chain of Thought Fix
- **Problem**: Chain of Thought not updating on dashboard
- **Root Cause**: Bot sent `type: 'trai_reasoning'`, dashboard expected `type: 'bot_thinking'`
- **Fix**: Changed message type to match dashboard handler
- **Result**: Chain of Thought updates every trading cycle

---

## 2026-01-27 – Dashboard Message Forwarding

### Trade/Pattern/Thinking Messages
- **Problem**: dashboard-server.js only forwarded 5 message types
- **Fix**: Added handlers for `trade`, `bot_thinking`, `pattern_analysis`
- **Result**: P&L display, chart markers, Chain of Thought all work

### 8 Missing Indicator Overlays
- SMA, ATR, Fibonacci, Trendlines, RSI, MACD, Ichimoku, S/R
- All indicator checkboxes now functional (data permitting from backend)

---

## 2026-01-26 – Feature Flag Unification

### FeatureFlagManager Singleton
- **Problem**: Two independent feature flag systems not communicating
- **Fix**: `core/FeatureFlagManager.js` as single source of truth
- All feature checks go through one manager

### Dead Code Cleanup
- Removed 10 dead/duplicate files
- Removed 2 unused npm packages
- Deleted `backtest/BacktestEngine.js` (dangerous divergent logic)

---

## 2026-01-23 – Critical Trading Bug Fixes

### SELL Trade Accumulation Bug (CRITICAL)
- **Problem**: Paper trading lost 90% of balance ($9k of $10k)
- **Root Cause**: `updateActiveTrade()` at run-empire-v2.js:2071 was called for ALL trades (BUY and SELL)
- **Why it broke**: SELL trades added to `activeTrades`, but `closePosition()` only removed `type === 'BUY'`
- **Result**: 96 phantom SELL positions accumulated, never cleaned up
- **Fix 1**: Only call `updateActiveTrade()` for BUY trades
- **Fix 2**: `closePosition()` now clears ALL trades on full close (defense in depth)

### P&L Calculation Bug
- **Problem**: Dashboard showed -$250 P&L when $250 was in open position
- **Root Cause**: `totalPnL = balance - 10000` didn't include position value
- **Fix**: `totalPnL = (balance + positionValue) - 10000`

### Fresh Start Architecture
- **Problem**: Paper trading loaded stale state (old balances, stuck trades)
- **Why band-aids suck**: Required manual reset scripts every time
- **Fix**: Added `FRESH_START=true` env var to StateManager.load()
- **Usage**: `FRESH_START=true pm2 start ogz-prime-v2 --update-env`

### Kraken Data Watchdog
- **Problem**: WebSocket stayed "open" (ping/pong worked) but Kraken stopped sending data
- **Symptom**: "NO DATA FOR 145 SECONDS" but no reconnect
- **Fix**: Added `lastDataReceived` tracking, force `ws.terminate()` if no data for 60s

### nginx API Routing
- **Problem**: `/api/` routes went to port 3008 (nothing runs there)
- **Fix**: Changed to port 3010 (unified server), added `/api/ollama/` with 5-min timeout

---

## 2026-01-22 – TRAI GPU Acceleration + Stability Fixes

### TRAI GPU Acceleration (CRITICAL)
- **Problem**: TRAI inference took 10-15+ seconds per call (why it was removed from hot path)
- **Root Cause**: `gpu_layers=0` in `inference_server_ct.py` meant CPU-only despite A100 GPU
- **Fix**: Changed to `gpu_layers=50` – model now loads to GPU VRAM
- **Result**: Sub-second inference. TRAI can return to hot path.

### TRAI Infrastructure Fixes
- **Symlinks**: `core/inference_server*.py` now symlinks to `trai_brain/` (was missing)
- **Widget URL**: Fixed `wss://ogzprime.com/` → `wss://ogzprime.com/ws`
- **Permissions**: `public/trai-widget.js` now 644 (was 600, caused 403)

### Kraken WebSocket Stability
- **Heartbeat**: Added ping/pong every 30 seconds (Kraken kills idle connections at 60s)
- **Reconnect**: Never gives up (was max 10 attempts then death)
- **Result**: No more "data feed going dark" issues

### Dashboard Fixes
- **`currentPrice.toFixed` crash**: Variable didn't exist – changed to `lastPrice`
- **Chart timezone**: Now shows local time, not UTC
- **Scroll zoom**: Enabled (was disabled)

### New Startup Script
- `start-ogzprime.sh` – unified launcher with setup, start, stop, status
- Auto-creates symlinks, fixes permissions, loads env, starts PM2 apps

---

## 2026-01-12 – MAExtensionFilter (Feature Flagged, Disabled)

- **New Module**: `core/MAExtensionFilter.js`
- **Purpose**: Mean-reversion filter that skips first touch after price accelerates away from 20MA
- **Logic**:
  - Tracks extension = (close - sma20) / ATR
  - Tracks acceleration = rate of change of extension
  - After "accelerating away" event, skips first MA touch, allows second
  - Timeout reset after N bars if no second touch
- **Feature Flag**: `MA_EXTENSION_FILTER` in `config/features.json` (disabled by default)
- **Verification**: `test/verify-ma-extension-filter.js` - passed against 60k candles
- **Status**: NOT integrated into live bot yet - awaiting decision to enable

---

## 2026-01-09 – TRAI Local-First Architecture

- **Architectural Shift**: No cloud LLM/embeddings by default
- **Files Created**:
  - `trai_brain/memory_store.js` – Journal-based memory (keyword+recency, NO embeddings)
  - `trai_brain/research_mode.js` – Web search via SearXNG (OFF by default)
  - `trai_brain/prompt_schemas.js` – Structured output schemas
  - `trai_brain/read_only_tools.js` – Safe read-only toolbox
- **Files Modified**:
  - `trai_brain/trai_core.js` – Returns TRAI_OFFLINE when local LLM down (no cloud fallback)
  - `trai_brain/inference_server.py` – Embeddings disabled by default
- **Key Principle**: Local persistent LLM only, explicit flags to enable cloud features
- **Env Flags**:
  - `TRAI_ENABLE_EMBEDDINGS=1` to enable embedding server
  - `TRAI_RESEARCH_ENABLED=1` to enable web search

---

## 2026-01-10 – Decision & Trade Outcome Telemetry (Gate 7 Compliance)

- Added JSONL telemetry for PatternMemoryBank learning evaluation
- **Files Modified**:
  - `core/TRAIDecisionModule.js` – Enhanced `logDecision()` with sanitized input, version hash, mode detection
  - `core/PatternMemoryBank.js` – Added trade outcome JSONL append in `recordTradeOutcome()`
  - `core/AdvancedExecutionLayer-439-MERGED.js` – Thread `decisionId` through position object
  - `run-empire-v2.js` – Generate `decisionId` at trade execution for pattern attribution
- **New Log Files**:
  - `logs/trai-decisions.log` – JSONL decision telemetry
  - `logs/trade-outcomes.log` – JSONL trade outcome ground truth
- **Key Feature**: `decisionId` joins decisions to outcomes for pattern evaluation
- **Protocol**: Async fire-and-forget, no trading behavior changes, silent failure
- **Gate 7 Compliance**: traceId threading, decision logs, fill logs, reconcile results

---

## 2025-12-07 – Pattern Memory Investigation (Claudito Chain)

- Ran full Claudito chain (Orchestrator → Forensics → Fixer → Debugger → Committer) on PatternMemorySystem.
- Confirmed:
  - `this.memory` init now conditional:
    - `if (!this.memory) { this.memory = {}; }`
  - Actual persistence path:
    - `data/pattern-memory.json`
  - Root `pattern_memory.json` is legacy/decoy.
- Outcome:
  - Pattern saving working.
  - Landmine documented as `PATTERN_PATH_003`.
  - Pattern memory smoke test protocol established.

---

## 2025-12-07 – OGZ Meta-Pack Bootstrap

- Created `ogz-meta/` meta pack:
  - `00_intent.md` – why this pack exists.
  - `01_purpose-and-vision.md` – what OGZPrime is and where it’s going.
  - `02_architecture-overview.md` – high-level lanes and runtime flow.
  - `03_modules-overview.md` – map of major modules.
- Added builder:
  - `build-claudito-context.js` → outputs `claudito_context.md`.
- Usage:
  - First message paste for new AI/Claudito sessions touching OGZ code.

---

## How to Use This File

- When you make a **meaningful** change:
  - new module,
  - major fix,
  - new brain,
  - new broker integration,
  - big risk behavior change,
- Add a short entry here:
  - date
  - what changed
  - why it matters.
- This is NOT a full changelog. It’s a **high-signal summary** for AI + future Trey.
