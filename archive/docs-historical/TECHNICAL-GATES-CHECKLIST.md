# 🔐 TECHNICAL GATES CHECKLIST
## Ultimate Verification for Crypto Bot Go-Live

**YOU DON'T PASS A GATE, YOU DON'T GO LIVE. PERIOD.**

---

## Gate 0 — Freeze and Reproducibility ✅

- [ ] One "launch exchange" only (Kraken - everything else OFF)
- [ ] One "launch strategy mode" only (no experimental branches)
- [ ] Config is immutable for the run: config hash printed at startup
- [ ] Lockfile committed (package-lock.json exists ✅)
- [ ] Version stamped: git commit SHA + build timestamp in logs
- [ ] Feature flags default SAFE (missing flags = NO TRADE mode)

**Current Status:**
```
✅ package-lock.json: 47KB (exists)
✅ Version: 14.0.0
⚠️ Need: Config hash logging
⚠️ Need: Git SHA in startup logs
```

---

## Gate 1 — Process Safety and Single Instance 🔒

### Single Instance Lock ⚠️ CRITICAL
- [ ] PID file or port lock implemented
- [ ] Cannot start two instances on same account
- [ ] Lock file location: `/tmp/ogzprime.lock` or similar
- [ ] Lock released on clean shutdown
- [ ] Lock auto-expires after 5 minutes (zombie protection)

**Verification:**
```bash
# Try to start second instance (should fail)
node run-empire-v2.js &
sleep 2
node run-empire-v2.js  # Should error: "Instance already running"

# Check lock mechanism
ls -la /tmp/*.lock
lsof -i :3010  # Check port lock
ps aux | grep node | grep empire
```

### Process Monitoring
- [ ] Event loop lag monitoring (<100ms warning, <500ms critical)
- [ ] Memory usage tracking (alert at 80% heap)
- [ ] Graceful shutdown handler (SIGTERM, SIGINT)
- [ ] State saved before exit
- [ ] Open orders cancelled on shutdown

**Event Loop Guard:**
```javascript
// Must have this pattern
setInterval(() => {
  const lag = Date.now() - lastCheck;
  if (lag > 500) {
    console.error('EVENT LOOP LAG:', lag);
    pauseTrading();
  }
}, 1000);
```

---

## Gate 2 — Keys, Permissions, and Security 🔐

- [ ] API keys are trade-only (NO withdraw permissions)
- [ ] IP whitelist enabled on exchange
- [ ] Keys loaded from env, never hardcoded
- [ ] Separate keys for paper vs live
- [ ] Rate-limit handling doesn't cause auth loops
- [ ] Log redaction working (test with intentional log)

**Verification Commands:**
```bash
# Check for hardcoded keys
grep -r "api.*key\|secret" --include="*.js" | grep -v ".env"

# Verify env loading
grep "process.env.KRAKEN" run-empire-v2.js
```

---

## Gate 3 — Time, Connectivity, and Data Integrity 🕐

### System Time
- [ ] System clock synced (NTP check):
  ```bash
  timedatectl status | grep synchronized
  # Should show: "System clock synchronized: yes"
  ```
- [ ] Timezone set to UTC
- [ ] Time drift < 1 second

### WebSocket Health ⚠️ CRITICAL
- [ ] Reconnect with exponential backoff (1s, 2s, 4s, 8s, 16s, 30s max)
- [ ] Resubscribe to all channels after reconnect
- [ ] Sequence gap detection (missing messages)
- [ ] Heartbeat/ping every 30s
- [ ] Dead connection detection (no data for 60s)

### Stale Feed Detection ⚠️ CRITICAL
- [ ] Candle age check (reject if > 5 seconds old)
- [ ] Last update timestamp tracking per symbol
- [ ] Auto-pause if no data for 30 seconds:
  ```javascript
  if (Date.now() - lastDataTime > 30000) {
    console.error('STALE_FEED detected');
    pauseNewEntries();
    sendAlert('Feed stale for 30s');
  }
  ```
- [ ] Duplicate candle detection (same timestamp)
- [ ] Frozen price detection (10 candles with same close)
- [ ] Volume validation (0 volume = suspicious)
- [ ] Timestamp validation (no future times)

### Recovery Procedures
- [ ] After feed recovery: wait 2 candles before trading
- [ ] Clear stale data from buffers
- [ ] Re-sync with exchange state
- [ ] Log feed interruption duration

**Current Code Locations:**
- WebSocket: `ogzprime-ssl-server.js`
- Reconnect: `core/MessageQueue.js`
- Candle validation: `run-empire-v2.js:handleCandleData()`
- Stale detection: Should be in `run-empire-v2.js`

---

## Gate 4 — Execution Correctness ⚡

### Idempotency and De-dupe ⚠️ CRITICAL
- [ ] Every trade has unique intentId generated
- [ ] clientOrderId = hash(intentId + leg + venue) implemented
- [ ] De-dupe store exists and persists (StateManager)
- [ ] Duplicate prevention actually tested:
  ```bash
  # Test duplicate prevention
  grep -n "intentId\|clientOrderId" core/AdvancedExecutionLayer*.js
  grep -n "deduplication\|duplicate" core/StateManager.js
  ```
- [ ] Timeout → check exchange orders before retry
- [ ] Max one inflight submit per symbol (mutex verified)
- [ ] Order status cache with TTL

### Retry Rules
- [ ] Bounded retries (max 3 attempts in 5 min window)
- [ ] Retry only on safe errors (network, 503, 504)
- [ ] Unknown status → PAUSE + alert, never spam
- [ ] Circuit breaker pattern implemented and tested
- [ ] Exponential backoff (1s, 2s, 4s, 8s)

### Order Lifecycle
- [ ] Partial fills aggregated correctly
- [ ] Cancel/replace atomic (no duplicate risk)
- [ ] Reject updates state immediately
- [ ] No phantom orders possible
- [ ] Orders tracked by both internal ID and exchange ID

**Verification Test:**
```bash
# Simulate duplicate submit (should be blocked)
# Force network timeout (should check before retry)
# Submit during high load (should queue properly)
```

**Key Files:**
- `core/AdvancedExecutionLayer-439-MERGED.js`
- `core/StateManager.js`
- `core/ExecutionRateLimiter.js`

---

## Gate 5 — Truth Source and Reconciliation 🎯

### Truth Hierarchy
1. Exchange = absolute truth
2. StateManager = working cache
3. Logs = forensics only

### Reconciliation Requirements ⚠️ CRITICAL
- [ ] Reconciler runs every 30 seconds minimum
- [ ] Startup reconciliation BLOCKS trading:
  ```javascript
  // Must see this pattern
  await reconcileWithExchange();
  console.log("Reconciliation complete");
  setTradingEnabled(true);
  ```
- [ ] Drift detection thresholds:
  - [ ] Position size drift > 0.001 BTC → log warning
  - [ ] Position size drift > 0.01 BTC → PAUSE trading
  - [ ] Balance drift > $10 → PAUSE trading
  - [ ] Unknown position on exchange → HARD STOP
- [ ] Auto-correction for small drift (<$1)
- [ ] Manual intervention required for large drift
- [ ] Shutdown saves timestamped state snapshot

### Reconciliation Logs Must Show
- [ ] "Starting reconciliation..."
- [ ] "Exchange positions: [...]"
- [ ] "Internal positions: [...]"
- [ ] "Drift detected: none" or specific drift
- [ ] "Reconciliation complete"

**StateManager Verification:**
```bash
# Check state file exists and is recent
ls -lh data/state.json
stat data/state.json | grep Modify

# Verify reconciliation implementation
grep -n "reconcile\|sync" core/StateManager.js
grep -n "exchangeTruth\|drift" core/StateManager.js

# Test reconciliation
node -e "require('./core/StateManager').reconcileWithExchange()"
```

---

## Gate 6 — Risk System That Doesn't "Break Shit" 🛡️

- [ ] Risk gate is centralized (can't bypass)
- [ ] Max daily loss → hard pause
- [ ] Max orders per minute → rate limiter
- [ ] Max consecutive losses → soft pause
- [ ] Max exposure caps implemented
- [ ] Reduce-only mode supported

### State Transitions:
```
RUNNING → SOFT_PAUSE (no new entries)
SOFT_PAUSE → HARD_PAUSE (no submits)
HARD_PAUSE → KILLED (emergency only)
```

**Risk Components:**
- `core/RiskManager.js`
- `core/KillSwitch.js`
- `core/ExecutionRateLimiter.js`

---

## Gate 7 — Observability and Forensics 📊

### Every Trade Has:
- [ ] traceId across all components
- [ ] Decision log entry
- [ ] Risk approval log
- [ ] Order submit log
- [ ] Ack/reject log
- [ ] Fill log
- [ ] Reconcile result

### Metrics Captured:
- [ ] p95/p99 order latency
- [ ] WebSocket reconnect count
- [ ] Stale feed events
- [ ] Rejects by reason
- [ ] Rate-limit hits
- [ ] Event loop lag

### Alerts Configured:
- [ ] Stale feed alert
- [ ] Drift alert
- [ ] Duplicate prevention triggered
- [ ] Reject storm alert
- [ ] Crash/restart loop

**Telemetry Check:**
```bash
node scripts/telemetry-report.js
```

---

## Gate 8 — Paper Trading Validation ✅

**Run 4-12 hours minimum. MUST HAVE:**
- [ ] 0 duplicate orders
- [ ] 0 trades on stale feed
- [ ] Reconcile drift = 0 (or auto-corrects)
- [ ] No rate limit spirals
- [ ] Survives WebSocket disconnects
- [ ] Forced breaker tests pass

### Forced Tests:
```bash
# Simulate stale feed
# (Should pause entries)

# Simulate reject storm
# (Should pause)

# Simulate unknown submit
# (Should go safe, no spam)
```

---

## Gate 9 — Micro-Live Trial 🔬

- [ ] Smallest size possible ($10-20)
- [ ] Only 1-3 symbols
- [ ] Timeboxed (1-2 hours)
- [ ] You watching entire time

### Must Verify:
- [ ] Clean lifecycle (submit→ack→fill→reconcile)
- [ ] Partial fills handled
- [ ] Cancel works when forced
- [ ] Kill switch instant

---

## Gate 10 — Ramp Plan 📈

### Size Steps:
1. $10 → $25 → $50 → $100 → $250
2. Wait 24h between steps
3. Any alert = freeze at current level

### Symbol Steps:
1. BTC only → BTC+ETH → Top 5
2. Wait 48h between additions

### Keep Stable:
- [ ] Go-live config pinned 24h+
- [ ] No strategy changes week 1
- [ ] No parameter tuning week 1

---

## Gate 11 — Rollback and Recovery 🔄

### One-Command Operations:
```bash
# Rollback code
git checkout <previous-sha>
pm2 restart run-empire-v2

# Rollback config
cp config/features.json.backup config/features.json
pm2 restart run-empire-v2

# Emergency stop
pm2 stop all
```

### Backups Exist:
- [ ] Config snapshots
- [ ] State snapshots
- [ ] Log archives
- [ ] Database dumps

### Runbook Written:
- [ ] "Bot paused - checklist"
- [ ] "Position drift - steps"
- [ ] "Exchange down - procedure"
- [ ] "Memory leak - response"

---

## The "Ultimate Proof" Artifacts 📋

**Before go-live, you MUST produce:**

1. **Trade Reconstruction Log**
   - Single log bundle showing last 50 trades
   - Complete traceId flow for each

2. **Metrics Screenshot**
   - Stable latency graph
   - Zero drift over 24h
   - Zero duplicates

3. **Failure Mode Document**
   - List of known failures
   - State transition for each
   - Recovery procedure

---

## CRITICAL CODE LOCATIONS

### Core Safety:
- `core/StateManager.js` - Single source of truth
- `core/RiskManager.js` - Risk gates
- `core/KillSwitch.js` - Emergency stop
- `core/ExecutionRateLimiter.js` - Rate limiting

### Execution:
- `core/AdvancedExecutionLayer-439-MERGED.js` - Trade execution
- `run-empire-v2.js` - Main orchestrator

### Monitoring:
- `core/Telemetry.js` - Metrics
- `utils/discordNotifier.js` - Alerts
- `scripts/telemetry-report.js` - Health check

---

## Gate 12 — Two-Key Turn Safety 🔑🔑

### Production Activation Requirements
**NEVER go live with a single switch. Require TWO deliberate actions:**

### Key 1: Configuration Enable
```bash
# In .env file
LIVE_TRADING=true           # First key
CONFIRM_LIVE_TRADING=true   # Second key (must match)
```

### Key 2: Launch Confirmation
```bash
# Launch script must require confirmation
echo "WARNING: About to start LIVE TRADING"
echo "Current balance will be at risk"
echo "Type 'YES_START_LIVE_TRADING' to confirm:"
read confirmation
if [ "$confirmation" != "YES_START_LIVE_TRADING" ]; then
  echo "Aborted. Starting in PAPER mode instead."
  exit 1
fi
```

### Additional Safety Checks
- [ ] Both env variables must be true
- [ ] Startup shows BIG warning banner
- [ ] 10-second countdown before first trade
- [ ] Initial position size reduced by 50% for first hour
- [ ] Buddy system: Have someone else verify settings

**Code Pattern:**
```javascript
const isLiveMode = process.env.LIVE_TRADING === 'true' &&
                   process.env.CONFIRM_LIVE_TRADING === 'true';

if (isLiveMode) {
  console.log('╔════════════════════════════════╗');
  console.log('║  ⚠️  LIVE TRADING MODE ACTIVE  ⚠️  ║');
  console.log('║  Real money at risk!           ║');
  console.log('║  Starting in 10 seconds...     ║');
  console.log('╚════════════════════════════════╝');
  await sleep(10000);
}
```

---

## FINAL GATE: SIGN-OFF

**I verify that:**
- [ ] All 12 gates passed
- [ ] Paper trading 48h+ stable
- [ ] Micro-live test successful
- [ ] Emergency procedures tested
- [ ] Rollback tested
- [ ] Starting with <$250

**Signature:** _________________
**Date:** _________________
**Git SHA:** _________________

---

**IF ANY GATE FAILS, STOP. FIX. RE-TEST.**

**NO EXCEPTIONS. NO RUSH. DO IT RIGHT.**