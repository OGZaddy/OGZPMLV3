## Source Control & Data Loss Landmines

### SYS_WIPE_001 – Full System Wipes & Device Failures

**Symptom:**  
- Machine dies, OS corrupt, or full wipe.  
- Bot disappears with it. Multiple times.

**History:**  
- 4 computer crashes, 3 full system wipes.  
- Bot restarted from scratch three separate times.

**Lesson / Rule:**  
- Always assume the machine can vanish tomorrow.
- Non-negotiables:
  - Cold backups (offline or external).
  - VPS copies of critical code.
  - GitHub remote as a *mirror*, not the only source of truth.
- Never have **only one** copy of a working bot.

---

### GIT_NUKE_001 – `git reset --hard` Nuclear Button

**Symptom:**  
- Panic command during repo mess.  
- Suddenly “fixed” but nobody knows what silently got deleted.

**History:**  
- Used in frustration to escape a broken state.  
- Destroyed unknown amounts of work.

**Rule:**  
- `git reset --hard` is **banned** unless:
  - Everything important is backed up AND
  - We know exactly what we’re discarding.
- Use `reset --soft`, `revert`, or targeted fixes instead.
- If an AI suggests `git reset --hard`, it’s wrong by default.

---

### GIT_POISON_002 – Repo Poisoning With Giant Files

**Symptom:**  
- Git push/pull fails.  
- Repo “locks up” or pre-commit hooks blow up.  
- LLMs “don’t understand” why.

**Causes:**  
- Committing:
  - Trai brain markdown dumps.
  - Huge LLM logs.
  - Environment secrets dumped to disk.
  - Multi-GB scratch files.
- Assistants ignoring:
  - pre-commit hooks,
  - .gitignore,
  - explicit instructions about what NOT to commit.

**Rule:**  
- Never commit:
  - Trai brain files.
  - Full raw LLM transcripts.
  - `.env` or secrets stored in code.
  - Any file > a sane size limit (e.g., >5–10 MB) without explicit intent.
- AI/agents must:
  - Check `.gitignore`.
  - Check for “brain”/log/secret files before staging.
  - Explain *exactly* what they’re staging.

---

### GIT_MAIN_003 – Main Branch Corruption

**Symptom:**  
- Main branch becomes untrustworthy.  
- Production code mixed with half-baked experiments.  
- Repeated “fixes” introduce new regressions.

**History:**  
- Assistants editing `main` directly.  
- No separation between experimental work and stable trunk.

**Rule:**  
- Nobody touches `main` directly:
  - No AIs.
  - No “quick fixes.”
- All work must go through:
  - feature branches,
  - reviews,
  - and clear commit messages.
- “This is too small for a branch” is not a valid excuse.

---

### AI_ONBOARD_004 – Cold Start Sabotage

**Symptom:**  
- New AI context window shows up and instantly:
  - starts “optimizing”
  - rewrites modules
  - duplicates logic
  - renames things
  - without understanding the bot.

**Behavior Pattern:**  
- Doesn’t read:
  - full changelog,
  - architecture docs,
  - module map.
- Pretends understanding from:
  - a couple logs or partial code,
  - then wrecks shit.
- Creates:
  - duplicate modules,
  - duplicate functions doing the same thing,
  - contradictory logic paths.

**Rule:**  
- No AI/agent edits code before:
  - Reading the packed context (`claudito_context.md`)  
  - Skimming the full `CHANGELOG`, not just the top.
  - Mapping the architecture (at least once per new session).
- If an AI cannot summarize:
  - architecture,
  - key modules,
  - and what already exists,
  - it is not allowed to propose refactors.

---

### DUP_FUNC_005 – Duplicate Methods / Double-Negation

**Symptom:**  
- Two different methods do the same thing.  
- Or both wired into the flow causing double-processing or contradictions.

**Cause:**  
- AI “adds a new helper” instead of using existing one.  
- Doesn’t search for prior implementation.  
- Ends up with:
  - `saveToDisk` and `savePatternMemory` style pairs,
  - duplicate risk checks,
  - double negations.

**Rule:**  
- Before adding a new method:
  - Search the codebase for existing functionality by intent, not just name.
- Never duplicate logic just to “clean it up” unless:
  - you also remove or migrate the old one,
  - and document it in `recent-changes`.

---

### ARCH_SKIP_006 – Editing Without Understanding

**Symptom:**  
- “Optimizations” that break the design.  
- Changes that fight the architecture instead of working with it.

**Behavior:**  
- AI doesn’t:
  - map the system,
  - understand the module responsibilities,
  - read the meta-pack.
- Instantly jumps into implementation changes based on incomplete view.

**Rule:**  
- No structural or cross-module changes without:
  - a clear architectural summary from the AI,
  - confirmation it understands “who does what.”
- If an AI can't explain:
  - how a change fits into the architecture,
  - it's not allowed to make it.

---

## Infrastructure Landmines (Added 2026-01-22)

### TRAI_GPU_007 – GPU Acceleration Disabled by Default

**Symptom:**
- TRAI takes 10-15+ seconds per inference
- A100 GPU sits idle while CPU churns
- TRAI removed from hot path because "too slow"

**Cause:**
- `trai_brain/inference_server_ct.py` had `gpu_layers=0`
- This means 100% CPU, 0% GPU - regardless of hardware
- Nobody noticed because it "worked" (just slowly)

**Rule:**
- For ctransformers with GPU: `gpu_layers=50` (or higher to use GPU)
- Always verify with `nvidia-smi` that GPU is being used
- Sub-second inference = GPU working. 10+ seconds = CPU fallback.

---

### TRAI_SYMLINK_008 – Inference Server Path Mismatch

**Symptom:**
- `[TRAI Server] python3: can't open file '/opt/ogzprime/OGZPMLV2/core/inference_server.py'`
- TRAI falls back to rule-based reasoning
- No LLM responses

**Cause:**
- `persistent_llm_client.js` looks for servers in `core/`
- Actual files are in `trai_brain/`
- Both locations gitignored, so missing symlinks not obvious

**Rule:**
- Startup script must create symlinks:
  ```bash
  ln -sf trai_brain/inference_server*.py core/
  ```
- Use `start-ogzprime.sh` which handles this automatically

---

### WS_URL_009 – WebSocket Path Missing

**Symptom:**
- `WebSocket connection to 'wss://ogzprime.com/' failed`
- Constant reconnect attempts in console
- Dashboard connects but TRAI widget doesn't

**Cause:**
- Dashboard uses `wss://ogzprime.com/ws` (correct)
- TRAI widget used `wss://ogzprime.com/` (missing `/ws`)

**Rule:**
- All WebSocket connections must use the `/ws` path
- When adding new WebSocket clients, copy URL from working code

---

### PERMS_010 – Web File Permissions

**Symptom:**
- `403 Forbidden` for JS/CSS files
- Scripts load as `text/html` (nginx error page)
- Features mysteriously broken

**Cause:**
- Files created with restrictive permissions (`-rw-------`)
- nginx can't read files owned by linuxuser

**Rule:**
- Web-served files need `644` permissions
- Startup script runs `chmod 644 public/*.js`
- Check permissions when "403 Forbidden" appears

---

### VAR_NAME_011 – Referencing Non-Existent Variables

**Symptom:**
- `Uncaught TypeError: X.toFixed is not a function`
- Spamming every second/tick
- Dashboard features silently broken

**Cause (Example):**
- Code referenced `currentPrice` as a variable
- Only `lastPrice` existed
- `currentPrice` was an HTML element ID, not a JS variable

**Rule:**
- Search codebase before using variable names
- If `let`/`const`/`var` declaration not found, variable doesn't exist
- Don't confuse HTML element IDs with JavaScript variables

---

### SELL_ACCUMULATE_012 – activeTrades Adding SELL Positions

**Symptom:**
- Paper balance destroyed (90% loss)
- Dozens of SELL "positions" stuck in activeTrades
- Bot thinks it has short positions that can never close

**Cause:**
- `updateActiveTrade()` called for ALL trades (BUY and SELL)
- `closePosition()` only removed trades where `type === 'BUY'`
- SELL trades added to state, never cleaned up
- 96 phantom shorts accumulated over time

**Rule:**
- Only call `updateActiveTrade()` for BUY trades (position opens)
- SELL is a close action, not a new position
- `closePosition()` should clear ALL activeTrades, not just filtered subset
- Always verify activeTrades.size after close operations

**Date Fixed:** 2026-01-23

---

### WS_ZOMBIE_013 – WebSocket Silent Death (No Close Event)

**Symptom:**
- Dashboard shows "no chart" / disconnected
- Bot logs show WebSocket "connected" but no data flows
- Manual restart required to fix
- Heartbeat never triggers timeout

**Cause:**
- TCP connection dies but WebSocket readyState stays `OPEN` (zombie)
- `close` event never fires, so reconnection never triggers
- Old heartbeat (30s ping, 45s timeout) didn't detect it fast enough
- Pings sent but never reach server, no error returned

**Rule:**
- Heartbeat must be aggressive: 15s ping, 30s timeout (miss 2 = dead)
- Add DATA WATCHDOG: track last message received, force reconnect if stale
- Don't trust readyState alone - check actual data flow
- Reconnect delay should be fast (2s, not 5s)

**Files:** `run-empire-v2.js` (startHeartbeatPing, dataWatchdogInterval)

**Date Fixed:** 2026-01-31

---

### TRAI_THINK_014 – LLM Thinking Tags Leaking to Output

**Symptom:**
- TRAI chat returns: `"response":"rend<think>First, the user is..."`
- Raw `<think>...</think>` tags visible in dashboard
- Empty responses after "cleaning"

**Cause:**
- DeepSeek R1 model outputs thinking in `<think>` tags
- Original cleanup regex: `/<think>[\s\S]*?<\/think>/g`
- Only removes COMPLETE pairs - incomplete tags leak through
- If model cuts off mid-thought, tag never closes

**Rule:**
- Clean incomplete `<think>` blocks (no closing tag)
- Clean orphan `</think>` tags
- Clean garbage tokens before `<think>` (partial generation)
- Provide fallback response if empty after cleaning

**Files:** `core/persistent_llm_client.js`

**Date Fixed:** 2026-01-31

---

### MSG_TYPE_015 – WebSocket Message Type Mismatch

**Symptom:**
- Bot sends data, dashboard doesn't update
- Specific features broken (Chain of Thought, patterns, trades)
- No errors in console

**Cause:**
- Bot sends `type: 'trai_reasoning'`
- Dashboard listens for `type: 'bot_thinking'`
- Messages arrive but handler never fires

**Rule:**
- When adding new WebSocket messages:
  - Check BOTH sender AND receiver type strings
  - Search codebase for existing type names before inventing new ones
  - Use consistent naming (snake_case or camelCase, not mixed)

**Files:** `run-empire-v2.js`, `public/unified-dashboard.html`

**Date Fixed:** 2026-01-29

---

### TIMEFRAME_016 – Dashboard Timeframe Shows Wrong/No Data

**Symptom:**
- Changing timeframe shows empty chart or wrong candles
- 4H and 1D timeframes particularly broken
- Only 1m works reliably

**Cause:**
- Kraken WebSocket subscription missing some intervals
- No REST API fallback for historical data
- Client expected real-time data for ALL timeframes

**Rule:**
- Subscribe to ALL timeframe intervals on Kraken WebSocket
- Use REST API (`getHistoricalOHLC()`) for historical data on timeframe change
- WebSocket for real-time updates, REST for history
- Always test timeframe switching after chart changes

**Files:** `kraken_adapter_simple.js`, `run-empire-v2.js`

**Date Fixed:** 2026-01-30

---

### WS_CONNECTED_017 – WebSocket connectWebSocketStream() Never Sets this.connected

**Symptom:**
- Liveness watchdog spams "NO DATA FOR 140 SECONDS"
- Bot logs say WebSocket "connected" but no data flows
- Reconnect never happens despite infinite reconnect logic
- Manual restart required

**Cause:**
- `connect()` method (REST init) sets `this.connected = true`
- `connectWebSocketStream()` method (WS connection) NEVER set `this.connected`
- Reconnect logic at `ws.on('close')` line 751 checks `if (this.connected)`
- Always false → reconnect skipped → data feed dies permanently

**Rule:**
- BOTH `connect()` and `connectWebSocketStream()` must set `this.connected = true`
- Reconnect logic must have logging to show WHY reconnect was skipped
- When adding "infinite reconnect", verify the trigger condition actually fires

**Files:** `kraken_adapter_simple.js` (lines 569-577 for fix, line 751 for reconnect check)

**Date Fixed:** 2026-02-04

**Note:** This fix was applied outside the Claudito pipeline - Warden should have caught it

---

## Mercury-2 Audit Landmines (2026-03-19)

### ORPHAN_CODE_001 – CandlePatternDetector Never Imported

**Symptom:**  
- CandlePattern strategy in StrategyOrchestrator always returns null
- 12+ pattern types (hammer, engulfing, doji) never generate signals

**Root Cause:**  
- `core/CandlePatternDetector.js` existed but was NEVER IMPORTED
- TradingLoop only called `patternChecker.analyzePatterns()` which queries memory, not detect patterns

**Fix (2026-03-19):**  
- Import CandlePatternDetector in TradingLoop
- Call `detect()` alongside `analyzePatterns()`
- Merge results into patterns array

**Rule:**  
- Before writing new code, grep for existing implementations
- Dead code MUST be deleted or wired, not left orphan

---

### TIMEFRAME_CONFIG_001 – Per-Timeframe Exits Never Read

**Symptom:**  
- All trades use 15m default stops regardless of actual timeframe
- 1m scalps get 2% stops (way too wide), 4h swings get same (way too tight)

**Root Cause:**  
- TradingConfig.timeframeConfig had beautiful per-TF settings
- ExitContractManager.createExitContract() never called getTimeframeConfig()

**Fix (2026-03-19):**  
- Add timeframe parameter to createExitContract()
- Use TradingConfig.getTimeframeConfig(timeframe)

**Rule:**  
- When adding config, ALSO wire the code that reads it
- Configs without readers are dead config

---

### CONFIDENCE_GATE_001 – 1% Threshold Let Everything Through

**Symptom:**  
- 15,633 trades in 2yr backtest (should be ~300-500)
- Massive churn, tiny wins eaten by fees

**Root Cause:**  
- minTradeConfidence = 0.01 (1%) "to allow env var overrides"
- Comparison: orchResult.confidence (0-100) >= 1 → always true

**Fix (2026-03-19):**  
- Raised minTradeConfidence from 0.01 to 0.35 (35%)

**Rule:**  
- Default configs should be PRODUCTION-SAFE, not dev convenience
- If unsure, err toward stricter filtering

---

### DTO_MISMATCH_001 – superTrendDirection vs trend

**Symptom:**  
- indicators.trend always undefined
- RegimeDetector receives undefined, defaults to 'unknown'

**Root Cause:**  
- IndicatorEngine.getSnapshot() returns `superTrendDirection`
- TradingLoop and downstream expects `trend`

**Fix (2026-03-19):**  
- Add backward compat: `indicators.trend = superTrendDirection || 'sideways'`

**Rule:**  
- DTO field names MUST match consumer expectations
- When renaming fields, grep ALL consumers first

---

### POSITION_STACKING_001 – Multi-Position Without Direction Check

**Symptom:**  
- Opening 50 longs on consecutive candles
- Each RSI signal stacks new position instead of recognizing existing one

**Root Cause:**  
- Multi-position fix checked `activeTrades.length < maxPositions`
- Never checked if already holding a LONG before opening another LONG

**Fix (2026-03-19):**  
- Add hasLongPosition/hasShortPosition checks
- sameDirectionBlock gate before entry

**Rule:**  
- Position awareness: 1 long at a time, 1 short at a time
- Flipping allowed, stacking same direction NOT allowed

