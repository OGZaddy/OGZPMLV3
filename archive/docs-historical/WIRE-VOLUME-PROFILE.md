# WIRE-VOLUME-PROFILE.md — Integration Instructions
## Source: Fabio Valentino / Auction Market Theory (Chart Fanatics)

### WHAT THIS IS
Volume Profile builds a histogram of where volume was traded across price levels.
It identifies POC (most-traded price), Value Area (70% of volume), and Low/High
Volume Nodes. This is NOT a standalone strategy — it's a FILTER that makes every
other strategy smarter.

### Fabio's Core Rules
1. **Only trend follow when OUT OF BALANCE** (price outside value area)
2. **Mean revert when IN BALANCE** (price inside value area, target = POC)
3. **Low Volume Nodes = fast zones** (price moves through quickly — tight stops)
4. **POC = target** for mean reversion trades (70% probability of reaching it)
5. **Previous session POC/VAH/VAL** = key levels for the next session

---

### STEP 1: Place the file
Copy `VolumeProfile.js` to: `core/VolumeProfile.js`

### STEP 2: Instantiate in run-empire-v2.js

In the constructor (where other modules are instantiated):
```javascript
// Volume Profile (Fabio Valentino / Auction Market Theory)
const VolumeProfile = require('./core/VolumeProfile');
this.volumeProfile = new VolumeProfile({
  sessionLookback: 96,  // 96 x 15min = 24 hours
  numBins: 50,
  valueAreaPct: 0.70,
  recalcInterval: 5,
});
```

### STEP 3: Feed data in the trading loop

In the main candle processing loop (where priceHistory is available):
```javascript
// Update Volume Profile
this.volumeProfile.update(currentCandle, this.priceHistory);

// Log summary periodically
if (this.candle_count % 10 === 0) {
  console.log(`[VP] ${this.volumeProfile.getSummary()}`);
}
```

### STEP 4: Use as filter in StrategyOrchestrator

In StrategyOrchestrator.js where strategies are evaluated, add VP filtering:

```javascript
// Before accepting any strategy signal:
const vpProfile = this.volumeProfile?.getProfile();
if (vpProfile && vpProfile.poc) {
  const vpState = this.volumeProfile.getMarketState(currentPrice);
  
  // Pass VP data to strategies via extras
  extras.volumeProfile = vpProfile;
  extras.vpMarketState = vpState;
  
  // Optional: Log VP state with every orchestrator decision
  console.log(`[VP-ORCH] State=${vpState.state} | POC=${vpProfile.poc.toFixed(0)} | VAH=${vpProfile.vah.toFixed(0)} | VAL=${vpProfile.val.toFixed(0)}`);
}
```

### STEP 5: Strategy-level integration (optional enhancement)

Each strategy can use VP data to boost/reduce confidence:

**MADynamicSR.js:**
```javascript
// If we're entering a buy and price is at a Low Volume Node, boost confidence
// (price will move through fast = tighter stop, better R:R)
if (extras.vpMarketState?.nearestLvn?.distancePct < 0.3) {
  confidence += 5;  // Near an LVN — Fabio's entry zone
}

// If trend strategy fires but we're inside the Value Area, reduce confidence
if (extras.vpMarketState?.state === 'balanced') {
  confidence -= 10;  // Inside VA — Fabio says don't trend follow here
}
```

**BreakAndRetest.js:**
```javascript
// Use VP targets instead of generic R:R
if (extras.volumeProfile?.poc) {
  // Mean reversion target = POC (70% probability per Fabio)
  const pocTarget = extras.volumeProfile.poc;
  // Only use if POC is in the direction of our trade
  if (direction === 'buy' && pocTarget > entryPrice) {
    takeProfit1 = pocTarget;
  }
}
```

### STEP 6: Add to StartupHealthCheck

```javascript
// CHECK 14: Volume Profile
{
  name: 'VolumeProfile',
  check: () => {
    if (!this.volumeProfile) return { pass: false, msg: 'Not instantiated' };
    return { pass: true, msg: 'VolumeProfile ready' };
  }
}
```

### STEP 7: ExitContractManager defaults

No special exit contract needed — VP modifies targets/stops in existing strategies.
Strategies that use VP data will pass adjusted SL/TP to the exit contract.

---

### WHAT YOU'LL SEE IN LOGS
```
[VP] VP: POC=95234 | VAH=95891 | VAL=94102 | State=imbalanced_high | LVNs=3 | HVNs=8 | Price=96012 | VA=70.2%
[VP-ORCH] State=imbalanced_high | POC=95234 | VAH=95891 | VAL=94102
```

### FUTURE ENHANCEMENTS
- CVD (Cumulative Volume Delta) — leading indicator Fabio uses for divergence
- Delta per bin — shows which side is dominating at each price level
- Session-based profiles (auto-reset at session boundaries)
- Multi-timeframe profiles (daily + weekly overlay)
