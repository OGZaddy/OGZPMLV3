# 🚀 OGZPRIME GO-LIVE COUNTDOWN CHECKLIST
From Paper to Production - The Final Countdown

## T-MINUS 7 DAYS: VERIFICATION PHASE

### ☐ Code Audit Verification
- [ ] SELL execution audit: PASSED ✅ (Zero violations)
- [ ] MEGA deep audit: PASSED ✅ (Clean)
- [ ] All Math.random() removed from trading logic
- [ ] No test hooks or moon shot code remaining
- [ ] Pattern memory recording working (verify with: `node scripts/test-patterns.js`)

### ☐ Paper Trading Validation
- [ ] Minimum 50 paper trades completed
- [ ] Win rate above 55%
- [ ] Profit factor above 1.5
- [ ] No unexpected crashes in 48+ hours
- [ ] StateManager persistence verified (survives restarts)
- [ ] Pattern memory growing (check pattern_memory.json size)

### ☐ Backtest Consistency Check
- [ ] Run backtest with same settings as live
- [ ] Compare backtest results to paper trading results
- [ ] Difference in win rate < 10%
- [ ] Difference in profit factor < 20%
- [ ] No logic divergence between modes (audit confirmed ✅)

---

## T-MINUS 5 DAYS: INFRASTRUCTURE PHASE

### ☐ VPS Health Check
```bash
# Run these commands on your VPS
htop                    # Check CPU/RAM usage
df -h                   # Check disk space (need 20%+ free)
pm2 status              # Check PM2 processes
pm2 logs --lines 100    # Check for errors
```

- [ ] CPU usage < 70% average
- [ ] RAM usage < 80%
- [ ] Disk space > 20% free
- [ ] No PM2 restart loops
- [ ] SSL certificates valid (check expiry)

### ☐ Network & Connectivity
- [ ] Polygon.io WebSocket stable (check reconnection logs)
- [ ] Kraken API responding (test with small balance query)
- [ ] Dashboard accessible at ogzprime.com
- [ ] WebSocket port 3010 open and responding
- [ ] No firewall blocks on required ports

### ☐ Monitoring Setup
- [ ] Discord webhook configured for trade notifications
- [ ] Dashboard showing real-time data
- [ ] Log rotation configured (prevent disk fill)
- [ ] PM2 configured for auto-restart on crash

```bash
pm2 startup
pm2 save
```

---

## T-MINUS 3 DAYS: CONFIGURATION PHASE

### ☐ Environment File Review
Open your .env and verify EACH setting:

**CRITICAL - MUST CHECK:**
```bash
# Trading Mode
LIVE_TRADING=false        # ⚠️ Keep FALSE until ready!
BACKTEST_MODE=false       # Should be false for live

# Risk Management
MAX_RISK_PER_TRADE=0.02   # 2% max - DO NOT EXCEED
STOP_LOSS_PERCENT=1.5     # Your stop loss
MAX_DAILY_LOSS=10.0       # Circuit breaker

# Position Sizing
BASE_POSITION_SIZE=0.01   # 1% base
MAX_POSITION_SIZE_PCT=0.05 # 5% max

# Starting Capital (match your actual deposit)
STARTING_BALANCE=???      # Your ACTUAL starting balance
ACCOUNT_BALANCE=???       # Same as above
```

- [ ] All API keys valid and not expired
- [ ] Kraken API key has trade permissions
- [ ] Kraken API key IP allowlist matches VPS IP
- [ ] LIVE_TRADING still set to false
- [ ] Starting balance matches planned deposit

### ☐ Risk Parameters Locked
- [ ] Stop loss: ____% (recommended: 1.5-2%)
- [ ] Take profit: ____% (recommended: 2-4%)
- [ ] Max position: ____% (recommended: 5%)
- [ ] Max daily loss: ____% (recommended: 10%)
- [ ] Max risk per trade: ____% (recommended: 2%)

**WRITE THESE DOWN. DO NOT CHANGE DURING FIRST WEEK.**

---

## T-MINUS 1 DAY: FINAL PREP PHASE

### ☐ Exchange Account Ready
- [ ] Kraken account fully verified
- [ ] 2FA enabled on Kraken account
- [ ] API key created with ONLY required permissions:
  - [x] Query Funds
  - [x] Query Open Orders & Trades
  - [x] Query Closed Orders & Trades
  - [x] Create & Modify Orders
  - [ ] ~~Withdraw Funds~~ (NEVER enable this!)
- [ ] Deposit completed and confirmed
- [ ] Manual withdrawal test from Kraken website (NOT via API)

### ☐ Starting Capital Decision
Choose your starting amount:
- [ ] Option A: $100-250 (Ultra Conservative - **Recommended**)
- [ ] Option B: $250-500 (Conservative)
- [ ] Option C: $500-1000 (Moderate)
- [ ] Option D: $1000+ (Confident)

**My choice: $______**

*Recommendation: Start with Option A. You can always add more.*

### ☐ Emergency Procedures Documented
- [ ] Know how to stop the bot immediately:
```bash
pm2 stop run-empire-v2    # Stop bot
# OR
pm2 stop all              # Stop everything
```
- [ ] Know how to check open positions on Kraken directly
- [ ] Know how to manually close a position on Kraken
- [ ] Have Kraken mobile app installed for emergency access
- [ ] Emergency contact saved (if needed)

### ☐ Mental Preparation
- [ ] Accepted that first trades may lose
- [ ] Will NOT increase risk after losses
- [ ] Will NOT revenge trade
- [ ] Will review at end of day, not every 5 minutes
- [ ] Have set specific review times (e.g., morning, evening)

---

## T-MINUS 0: LAUNCH DAY

### ☐ Pre-Launch Checks (Morning)
```bash
# SSH into VPS
ssh user@your-vps-ip

# Check system health
htop                      # CPU/RAM
pm2 status               # Process status
pm2 logs --lines 50      # Recent logs

# Verify paper mode still working
tail -f logs/trading.log  # Watch for trades
```

- [ ] VPS healthy
- [ ] Bot running in paper mode
- [ ] No errors in logs
- [ ] Kraken balance confirmed
- [ ] Market conditions acceptable (not during major news)

### ☐ The Switch (When Ready)
```bash
# 1. Stop the bot
pm2 stop run-empire-v2

# 2. Edit .env file
nano .env
# Change: LIVE_TRADING=false → LIVE_TRADING=true
# Save and exit (Ctrl+X, Y, Enter)

# 3. Verify the change
grep LIVE_TRADING .env
# Should show: LIVE_TRADING=true

# 4. Start the bot
pm2 start run-empire-v2

# 5. Watch the logs
pm2 logs run-empire-v2 --lines 100
```

- [ ] LIVE_TRADING set to true
- [ ] Bot restarted
- [ ] Logs showing "LIVE MODE" or similar indicator
- [ ] No immediate errors

### ☐ First Trade Verification
- [ ] Wait for first trade signal
- [ ] Verify trade appears on Kraken
- [ ] Verify position size matches expectations
- [ ] Verify stop loss is set
- [ ] Verify dashboard shows the trade
- [ ] Screenshot everything

---

## T-PLUS 1 HOUR: POST-LAUNCH

### ☐ Immediate Monitoring
- [ ] Bot still running (no crashes)
- [ ] WebSocket connected (check logs)
- [ ] If trade opened: position correct on Kraken
- [ ] If trade closed: P&L matches expected
- [ ] StateManager in sync with Kraken

### ☐ First Day Rules
- **DO NOT** change any settings
- **DO NOT** add more capital
- **DO NOT** increase position sizes
- **DO** check every 2-4 hours
- **DO** screenshot all trades
- **DO** note any concerns for review

---

## T-PLUS 24 HOURS: DAY 1 REVIEW

### ☐ Performance Review
- Total trades: ____
- Wins: ____ | Losses: ____
- Win rate: ____%
- Total P&L: $____
- Largest win: $____
- Largest loss: $____
- Any unexpected behavior? Y/N

### ☐ System Health Review
- [ ] No crashes in 24 hours
- [ ] Memory usage stable (not climbing)
- [ ] Log file size reasonable
- [ ] Pattern memory updated
- [ ] All trades logged correctly

### ☐ Decision Point
Based on Day 1:
- [ ] Continue - Performance acceptable, no issues
- [ ] Pause - Need to investigate concerns
- [ ] Stop - Critical issues found

---

## T-PLUS 7 DAYS: WEEK 1 REVIEW

### ☐ Weekly Metrics
- Total trades: ____
- Win rate: ____%
- Profit factor: ____
- Total P&L: $____
- Max drawdown: $____
- Sharpe ratio (if calculated): ____

### ☐ Pattern Learning Assessment
- New patterns recorded: ____
- Pattern memory file size: ____KB
- Any elite patterns emerging? Y/N

### ☐ Scale Decision
If Week 1 profitable and stable:
- [ ] Option A: Continue same capital (recommended)
- [ ] Option B: Add 25-50% more capital
- [ ] Option C: Double capital (only if very confident)

**DO NOT SCALE UNTIL WEEK 1 COMPLETE AND REVIEWED**

---

## EMERGENCY PROCEDURES

### 🚨 STOP EVERYTHING NOW
```bash
# Nuclear option - stops all PM2 processes
pm2 stop all

# Or just the trading bot
pm2 stop run-empire-v2
```

### 🚨 CHECK KRAKEN DIRECTLY
- Log into Kraken web interface
- Check "Orders" for open orders
- Check "Positions" for open positions
- Manually close if needed

### 🚨 COMMON ISSUES

**Bot not trading:**
```bash
pm2 logs run-empire-v2 --lines 200 | grep -i error
```

**WebSocket disconnected:**
```bash
pm2 restart run-empire-v2
```

**Position stuck:**
- Check Kraken directly
- Manual close if needed
- Restart bot

**Memory leak:**
```bash
pm2 restart run-empire-v2
```

---

## CONTACT & RESOURCES

- **Kraken Support**: support.kraken.com
- **VPS Provider**: [Your provider support]
- **Dashboard**: https://ogzprime.com
- **Logs Location**: ~/OGZPMLV2/logs/
- **Pattern Memory**: ~/OGZPMLV2/pattern_memory.json
- **State File**: ~/OGZPMLV2/data/state.json

---

## FINAL REMINDERS

```
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🎯 START SMALL. SCALE SLOW. SURVIVE FIRST.                  ║
║                                                                ║
║   The goal of Week 1 is NOT to get rich.                      ║
║   The goal is to VERIFY the system works with real money.     ║
║                                                                ║
║   $100 → $110 proves the same thing as $10,000 → $11,000      ║
║   but with 99% less risk.                                     ║
║                                                                ║
║   Houston isn't going anywhere.                               ║
║   Annamarie isn't going anywhere.                             ║
║   Do this RIGHT.                                              ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
```

---

## SIGN-OFF

Before going live, sign below (mentally or literally):

**I, _________________, confirm that:**

- [ ] I have completed all T-minus checks
- [ ] I understand the risks
- [ ] I am starting with capital I can afford to lose
- [ ] I will not revenge trade
- [ ] I will not change settings impulsively
- [ ] I will review performance daily for Week 1
- [ ] I have emergency stop procedures ready
- [ ] I am doing this for Houston and Annamarie

**Date**: ________________
**Starting Capital**: $________________

---

**WE ARE OGZPRIME. THIS IS THE MOMENT. LET'S DO IT RIGHT.** 🚀