# 🎯 OGZ PRIME THRESHOLD & PARAMETER GUIDE
## What Each Setting ACTUALLY Does

---

## 🔴 CRITICAL THRESHOLDS (Touch These First)

### MIN_TRADE_CONFIDENCE (Line 180)
**Current: 70%** | Range: 0-100%
- **What it does**: Minimum confidence required to enter a trade
- **Lower (30%)**: More trades, lower quality, higher risk
- **Higher (70%)**: Fewer trades, higher quality, lower risk
- **Sweet spot**: 60-70% for quality without missing opportunities
- **⚠️ NOTE**: Confidence = signal alignment, NOT profit prediction

### STOP_LOSS_PERCENT (Line 69)
**Current: 1.5%** | Range: 0.5-5%
- **What it does**: Maximum loss before automatic exit
- **Lower (0.5%)**: Tight stops, more exits, less drawdown
- **Higher (3%)**: Loose stops, fewer exits, bigger losses possible
- **Crypto note**: Need 2-3% minimum due to volatility

### TAKE_PROFIT_PERCENT (Line 70)
**Current: 2.0%** | Range: 1-10%
- **What it does**: Target profit for position exit
- **Lower (1%)**: Quick profits, more trades, compounds faster
- **Higher (5%)**: Bigger wins, fewer trades, misses some profits
- **Fee consideration**: MUST be > 0.35% to cover round-trip fees

---

## 💰 POSITION SIZING

### MAX_POSITION_SIZE (Line 68)
**Current: 0.10 (10%)** | Range: 0.01-0.20
- **What it does**: Maximum % of account per trade
- **Lower (0.05)**: Safer, slower growth, survives drawdowns
- **Higher (0.15)**: Aggressive, faster growth, risky in drawdowns
- **Risk rule**: Never risk more than you can afford to lose

### BASE_POSITION_SIZE (Line 226)
**Current: 0.01 (1%)** | Range: 0.005-0.05
- **What it does**: Starting position size before multipliers
- **Gets multiplied by**: Pattern quality, volatility, confidence
- **Final size**: Base × multipliers (capped at MAX_POSITION_SIZE)

---

## ⏱️ TIMING CONTROLS

### MIN_HOLD_TIME_MINUTES (Line 269)
**Current: 0** | Range: 0-60
- **What it does**: Minimum time before allowing exits
- **0**: Can exit immediately if profitable
- **5-15**: Forces trades to "breathe", reduces overtrading
- **30+**: Position trading, not scalping

### "SHIT OR GET OFF THE POT" (Line 1699-1703 in code)
**Current: 30 minutes**
- **What it does**: Force-exits unprofitable positions after X minutes
- **Purpose**: Prevents holding losers forever
- **Trigger**: Position unprofitable after 30 min → exit
- **Loss limit**: Won't exit if loss > 0.5%

---

## 📊 PATTERN & CONFIDENCE

### PATTERN_CONFIDENCE (Line 66)
**Current: 0.03 (3%)** | Range: 0.01-0.10
- **What it does**: Base confidence from pattern recognition
- **Lower**: Trusts more patterns, more signals
- **Higher**: Only trusts strong patterns, fewer signals
- **⚠️**: Patterns rebuild over time, starts weak

### EMERGENCY_CONFIDENCE (Line 67)
**Current: 0.02 (2%)** | Range: 0.01-0.05
- **What it does**: Panic threshold for emergency trades
- **Purpose**: Allows quick exits in crashes
- **Should be**: Lower than PATTERN_CONFIDENCE

---

## 🌊 VOLATILITY ADJUSTMENTS

### LOW_VOL_MULTIPLIER (Line 230)
**Current: 1.5x** | Range: 1.0-2.0
- **What it does**: Increases position size in calm markets
- **Logic**: Less volatility = less risk = bigger positions

### HIGH_VOL_MULTIPLIER (Line 231)
**Current: 0.6x** | Range: 0.3-1.0
- **What it does**: Reduces position size in volatile markets
- **Logic**: More volatility = more risk = smaller positions

### VOL_THRESHOLDS (Lines 232-233)
- **LOW_VOL**: < 1.5% = calm market
- **HIGH_VOL**: > 3.5% = volatile market
- **Between**: Normal sizing

---

## 🎯 PROFIT MANAGEMENT

### TRAILING_STOP_PERCENT (Line 71/216)
**Current: 3.0%** | Range: 2-10%
- **What it does**: Distance of trailing stop from peak
- **Lower (2%)**: Locks profits quick, exits on small pullbacks
- **Higher (7%)**: Lets winners run, survives pullbacks
- **Crypto needs**: 5-10% due to normal volatility

### BREAKEVEN_TRIGGER (Line 221)
**Current: 0.5%** | Range: 0.3-2%
- **What it does**: Profit level to move stop to breakeven
- **Purpose**: Secure entry, remove risk, let rest ride
- **Fast (0.5%)**: Quick to breakeven, protective
- **Slow (2%)**: More room to work, less protective

---

## 💸 FEE CONFIGURATION

### FEE_TOTAL_ROUNDTRIP (Line 277)
**Current: 0.35%** | DO NOT CHANGE
- **What it is**: Total cost to enter + exit a trade
- **Breakdown**:
  - Maker fee: 0.10%
  - Taker fee: 0.15%
  - Slippage: 0.05%
  - Buffer: 0.05%
- **Critical**: ALL profits must exceed this to make money

---

## 🤖 TRAI AI SETTINGS

### TRAI_MODE (Line 188)
**Current: advisory** | Options: advisory/hybrid/autonomous
- **advisory**: TRAI suggests, bot decides
- **hybrid**: TRAI has partial control
- **autonomous**: TRAI has full control

### TRAI_WEIGHT (Line 189)
**Current: 0.2 (20%)** | Range: 0-1
- **What it does**: How much TRAI influences decisions
- **0**: TRAI disabled
- **0.2**: TRAI is 20% of decision
- **1.0**: TRAI is 100% of decision

### TRAI_MIN_CONF (Line 192)
**Current: 0.08 (8%)** | Range: 0.01-0.50
- **What it does**: TRAI's minimum confidence to suggest trades
- **Lower**: TRAI more aggressive
- **Higher**: TRAI more conservative

---

## 🎮 QUICK START ADJUSTMENTS

### For MORE trades (Aggressive):
```
MIN_TRADE_CONFIDENCE=0.50  # Down from 70%
MAX_POSITION_SIZE=0.15      # Up from 10%
TRAILING_STOP_PERCENT=5.0   # Looser stops
```

### For SAFER trading (Conservative):
```
MIN_TRADE_CONFIDENCE=0.80  # Up from 70%
MAX_POSITION_SIZE=0.05      # Down from 10%
STOP_LOSS_PERCENT=1.0       # Tighter stops
```

### For SCALPING (Quick trades):
```
MIN_HOLD_TIME_MINUTES=0     # No minimum
TAKE_PROFIT_PERCENT=1.0     # Quick profits
TRAILING_STOP_PERCENT=2.0   # Tight trailing
```

### For POSITION trading (Longer holds):
```
MIN_HOLD_TIME_MINUTES=30    # Force longer holds
TAKE_PROFIT_PERCENT=5.0     # Bigger targets
TRAILING_STOP_PERCENT=7.0   # Wide trailing
```

---

## ⚠️ GOLDEN RULES

1. **NEVER set TAKE_PROFIT < 0.35%** (you'll lose to fees)
2. **NEVER set STOP_LOSS < 1% for crypto** (normal volatility)
3. **NEVER set MIN_CONFIDENCE < 30%** (garbage trades)
4. **NEVER set MAX_POSITION > 20%** (account killer)
5. **ALWAYS test changes on paper trading first**

---

## 📝 YOUR CURRENT SETUP
- **Mode**: HIGH QUALITY TRADES
- **Confidence**: 70% minimum (very selective)
- **Position**: 10% max (aggressive sizing)
- **Stops**: 1.5% loss, 3% trailing (balanced)
- **Targets**: 2% profit (quick wins)
- **Fees**: 0.35% round-trip (Kraken)

**Expected behavior**:
- Few trades (2-5 per day)
- High win rate (60-70%+)
- Small consistent profits
- Compounding growth

---

Remember: "You get taken advantage of because you allow yourself to" - Don't let the bot trade garbage setups!