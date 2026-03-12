# STRATEGY REWRITE SPEC — All Four Strategies
## Correct Definitions → Correct Code

**Date:** 2026-03-06
**Purpose:** Each strategy's code must match its trading methodology definition. No more hardcoded defaults that don't match the chart. No more parameters buried in constructors.

---

## STRATEGY 1: MADynamicSR (Trader DNA)

### The Definition
Source: "3 EMA Strategies That NEVER LOSE" — Trader DNA

**Entry Rules (ALL must be true):**
1. Trend established: price above TREND EMA (bullish) or below (bearish)
2. 123 pattern confirmed: HH+HL for uptrend, LH+LL for downtrend
3. Price pulls back to ENTRY EMA (the "dynamic support/resistance")
4. Entry EMA aligns with a tested S/R zone (multiple touches)
5. Confirmation candle appears (hammer, engulfing, strong close)
6. Acceleration: candle range > 1.2x ATR (the "rubber band snapping")

**Exit:** 1:3 Risk/Reward from structural stop

### What's Wrong in the Code

| Issue | Current | Should Be |
|-------|---------|-----------|
| Entry EMA | 50 (hardcoded constructor) | 20 (from TradingConfig) |
| Trend EMA | 200 (hardcoded constructor) | 50 (from TradingConfig) |
| Config source | `new MADynamicSR()` — no config passed | Read from TradingConfig.strategies.MADynamicSR |
| Minimum candles | 220 (max(50,200)+20) blocks all processing | Swing detection separated, runs from 7 candles |
| Swing detection | Was blocked by minBars check | FIXED 2026-03-06 — moved before minBars check |

### Exact Changes

**File: run-empire-v2.js (line ~483)**
```javascript
// BEFORE:
this.maDynamicSR = new MADynamicSR();

// AFTER:
const TradingConfig = require('./core/TradingConfig');
const masrConfig = TradingConfig.get('strategies.MADynamicSR') || {};
this.maDynamicSR = new MADynamicSR({
  emaPeriod: masrConfig.entryEma || 20,         // Entry EMA (was 50)
  trendEmaPeriod: masrConfig.trendEma || 50,     // Trend EMA (was 200)
  touchZonePct: masrConfig.touchZonePct || 0.6,
  srTestCount: masrConfig.srTestCount || 2,
  atrAcceleration: masrConfig.atrAcceleration || 1.2,
  swingLookback: masrConfig.swingLookback || 3,
});
```

**File: core/TradingConfig.js — strategies section**
```javascript
MADynamicSR: {
  entryEma: env('MASR_ENTRY_EMA', 20),          // EMA for pullback entries
  trendEma: env('MASR_TREND_EMA', 50),           // EMA for trend direction
  touchZonePct: env('MASR_TOUCH_ZONE', 0.6),     // % distance to count as "touching"
  srTestCount: env('MASR_SR_TESTS', 2),           // Min S/R zone touches
  atrAcceleration: env('MASR_ATR_ACCEL', 1.2),   // Candle range must exceed this × ATR
  swingLookback: env('MASR_SWING_LOOKBACK', 3),   // Bars to confirm a swing
},
```

### Regime Role
- TRENDING markets only
- VP chop filter should block this in balanced markets
- When trending UP: only LONG signals
- When trending DOWN: only SHORT signals (when shorts enabled)

---

## STRATEGY 2: RSI Mean Reversion

### The Definition
Classic mean reversion on oversold/overbought extremes. Designed for CHOPPY markets where price bounces between support and resistance.

**Entry Rules:**
1. RSI drops below oversold threshold → BUY (catching the bounce)
2. RSI rises above overbought threshold → SELL (catching the rejection)
3. Confidence scales with how extreme the reading is
4. Should ONLY fire in ranging/balanced markets (not during trends)

### What's Wrong in the Code

| Issue | Current | Should Be |
|-------|---------|-----------|
| Buy threshold | RSI < 25 | RSI < 25 (keep — proven in backtest) |
| Sell threshold | RSI > 75 | RSI > 75 (keep — proven in backtest) |
| Regime filter | None — fires in all market conditions | Only fire when VP says balanced/ranging |
| Config source | Hardcoded in StrategyOrchestrator | Read from TradingConfig.strategies.RSI |

### Exact Changes

**File: core/StrategyOrchestrator.js (RSI strategy, line ~231)**
```javascript
// BEFORE:
if (rsi < 25) {

// AFTER:
const rsiConfig = TradingConfig.get('strategies.RSI') || {};
const oversold = rsiConfig.oversoldLevel || 25;
const overbought = rsiConfig.overboughtLevel || 75;

if (rsi < oversold) {
  const strength = Math.min(1.0, (oversold - rsi) / 15);
  return {
    direction: 'buy',
    confidence: 0.3 + (strength * 0.5),
    reason: `RSI Oversold (${rsi.toFixed(1)} < ${oversold})`,
    signalData: { rsi }
  };
}
if (rsi > overbought) {
  const strength = Math.min(1.0, (rsi - overbought) / 15);
  return {
    direction: 'sell',
    confidence: 0.3 + (strength * 0.5),
    reason: `RSI Overbought (${rsi.toFixed(1)} > ${overbought})`,
    signalData: { rsi }
  };
}
```

**File: core/TradingConfig.js**
```javascript
RSI: {
  oversoldLevel: env('RSI_OVERSOLD', 25),
  overboughtLevel: env('RSI_OVERBOUGHT', 75),
  period: 14,  // Standard, matches IndicatorEngine
},
```

### Regime Role
- CHOPPY/RANGING markets only
- Should be blocked by regime filter when market is trending
- Exception: RSI < 25 in an uptrend = dip buy (allow with direction alignment)
- Exception: RSI > 75 in a downtrend = relief rally short (allow with direction alignment)

---

## STRATEGY 3: EMASMACrossover

### The Definition
Trend confirmation via moving average crossovers. When fast MA crosses above slow MA, trend is turning bullish. When it crosses below, bearish.

**Entry Rules:**
1. Golden cross (fast above slow) → BUY signal
2. Death cross (fast below slow) → SELL signal
3. Confidence based on: how many MA pairs agree (confluence), how recent the cross, whether heavyweight pairs (50/200) confirm
4. Snapback detection: when MAs are overextended and decelerating → mean reversion signal
5. Blowoff detection: when MAs are accelerating apart → reduce confidence (don't chase)

### What's in the Code
This is actually the best-built strategy module. It tracks 5 MA pairs, handles signal decay, has snapback and blowoff detection built in.

| Issue | Current | Should Be |
|-------|---------|-----------|
| MA pairs | Hardcoded 5 pairs in constructor | Keep — these are standard |
| Decay bars | 10 (hardcoded) | Read from TradingConfig |
| Snapback threshold | 2.5% (hardcoded) | Read from TradingConfig |
| Config source | Constructor defaults | Read from TradingConfig.strategies.EMACrossover |

### Exact Changes

**File: run-empire-v2.js (line ~482)**
```javascript
// BEFORE:
this.emaCrossover = new EMASMACrossoverSignal();

// AFTER:
const emaConfig = TradingConfig.get('strategies.EMACrossover') || {};
this.emaCrossover = new EMASMACrossoverSignal({
  decayBars: emaConfig.decayBars || 10,
  snapbackThresholdPct: emaConfig.snapbackThreshold || 2.5,
  blowoffAccelThreshold: emaConfig.blowoffThreshold || 0.15,
});
```

**File: core/TradingConfig.js**
```javascript
EMACrossover: {
  decayBars: env('EMA_DECAY_BARS', 10),
  snapbackThreshold: env('EMA_SNAPBACK_PCT', 2.5),
  blowoffThreshold: env('EMA_BLOWOFF_ACCEL', 0.15),
},
```

### Regime Role
- TRENDING markets primarily (golden/death crosses confirm trends)
- Snapback feature works in BOTH regimes (overextension is regime-independent)
- VP chop filter should block crossover signals in balanced markets
- Snapback signals should be ALLOWED in balanced markets (it's a mean reversion signal)

### Note
The snapback detection is your "rubber band" concept already coded. When MAs are stretched 2.5%+ apart and decelerating, it fires a reversal signal. This is Fabio's Model 2 in code.

---

## STRATEGY 4: LiquiditySweep (Marco)

### The Definition
Source: Marco — institutional liquidity grabs

**Entry Rules:**
1. Identify where liquidity is resting (below recent lows, above recent highs)
2. Wait for price to sweep through that level (take the stops)
3. Watch for reversal: price comes back inside, confirmation candle
4. Enter AFTER the sweep, targeting the other side of the range

**The Key Insight:** Don't buy breakouts. Buy the FAILURE of breakdowns. The sweep IS the entry signal.

### What's Wrong in the Code

| Issue | Current | Should Be |
|-------|---------|-----------|
| Session dependency | Designed for equity market open (14:30 UTC) | Crypto is 24/7 — needs continuous scanning |
| disableSessionCheck | Flag exists but puts module in permanent building_box state | Needs proper 24/7 mode with rolling lookback |
| Opening range | Builds from first 15m candle after session open | Should build from rolling high/low of recent N candles |
| Entry signal | Hammer/engulfing at box exit | Should detect sweep (wick beyond level) + close back inside |

### Recommended Rewrite

LiquiditySweep needs the most work. The session-based architecture doesn't work for 24/7 crypto. The rewrite should:

1. **Rolling liquidity levels:** Track recent swing lows and swing highs (last 50 candles). These are where stops accumulate.
2. **Sweep detection:** Price wicks below a swing low (or above a swing high) but closes back inside = sweep
3. **Confirmation:** Next candle confirms reversal (strong close in the opposite direction of the sweep)
4. **Entry:** After confirmation, with stop below the sweep wick
5. **Target:** Opposite side of the recent range (or POC from VolumeProfile)

```javascript
// Simplified 24/7 liquidity sweep logic:
// 1. Find recent swing lows where stops likely rest
// 2. If price wicks below swing low but closes above it = sweep
// 3. If next candle is bullish with strong body = confirmation
// 4. BUY with stop below the sweep wick
```

**File: core/TradingConfig.js**
```javascript
LiquiditySweep: {
  lookbackCandles: env('LIQSWEEP_LOOKBACK', 50),
  sweepWickMinPct: env('LIQSWEEP_WICK_MIN', 0.1),   // Min wick beyond level
  confirmBodyMinPct: env('LIQSWEEP_CONFIRM_BODY', 0.3), // Min body on confirmation
  enabled: true,
},
```

### Regime Role
- CHOPPY/RANGING markets primarily (sweeps happen at range boundaries)
- Can also fire during trend pullbacks (sweep of a higher low in uptrend = dip buy)
- Complements RSI: RSI catches the oversold condition, LiquiditySweep catches the structural trap

---

## VOLUME PROFILE INTEGRATION

### The Filter That Makes Everything Better
Source: Fabio Valentino — Auction Market Theory

VolumeProfile.js already exists and is wired into CandleProcessor. The problem identified during tuning: `outOfBalancePct` is 0.1% which is too tight — everything reads as "balanced."

**Fix: core/TradingConfig.js**
```javascript
VolumeProfile: {
  sessionLookback: env('VP_SESSION_LOOKBACK', 96),  // 24h of 15m candles
  numBins: env('VP_NUM_BINS', 50),
  valueAreaPct: env('VP_VALUE_AREA_PCT', 0.70),
  outOfBalancePct: env('VP_OUT_OF_BALANCE_PCT', 0.5), // Was 0.1%, needs 0.5%
  recalcInterval: env('VP_RECALC_INTERVAL', 5),
},
```

**Fix: core/VolumeProfile.js constructor**
```javascript
// BEFORE:
this.outOfBalancePct = config.outOfBalancePct || 0.1;

// AFTER:
this.outOfBalancePct = config.outOfBalancePct || 0.5;
```

**Fix: Pass config from TradingConfig**
```javascript
// In run-empire-v2.js:
const vpConfig = TradingConfig.get('strategies.VolumeProfile') || {};
this.volumeProfile = new VolumeProfile({
  sessionLookback: vpConfig.sessionLookback || 96,
  numBins: vpConfig.numBins || 50,
  valueAreaPct: vpConfig.valueAreaPct || 0.70,
  outOfBalancePct: vpConfig.outOfBalancePct || 0.5,
  recalcInterval: vpConfig.recalcInterval || 5,
});
```

### Regime Detection for Strategy Filtering
Once VP is producing real balanced/imbalanced readings:

```javascript
// In StrategyOrchestrator.evaluate():
const vpState = extras.volumeProfile?.getMarketState(extras.price);

if (vpState?.state === 'balanced') {
  // Block trend strategies (MADynamicSR, EMACrossover trend signals)
  // Allow chop strategies (RSI, LiquiditySweep)
} else if (vpState?.state === 'imbalanced_high') {
  // Allow LONG trend strategies
  // Block SHORT trend strategies
  // Allow RSI oversold (dip buy in uptrend)
  // Block RSI overbought (fighting the trend)
} else if (vpState?.state === 'imbalanced_low') {
  // Allow SHORT trend strategies
  // Block LONG trend strategies
  // Allow RSI overbought (relief short in downtrend)
  // Block RSI oversold (catching falling knife)
}
```

---

## EXECUTION ORDER

1. **Wire TradingConfig** — Add all strategy parameters to TradingConfig.strategies section
2. **Pass config to constructors** — MADynamicSR, EMACrossover, LiquiditySweep, VolumeProfile
3. **Fix VolumeProfile outOfBalancePct** — 0.1% → 0.5%
4. **Verify MADynamicSR fires with 20/50 EMAs** — should see signals immediately
5. **Test each strategy individually** — one at a time, 45K candles, with fees
6. **Wire regime filter** — VP balanced/imbalanced drives which strategies can fire
7. **Test all four together** — 45K candles, with fees, compare against baseline (-0.11%)

### Rules
1. Do NOT change exit tiers or ExitContractManager
2. Do NOT change IndicatorEngine
3. Every parameter in TradingConfig — no hardcoded values in constructors
4. Test after EACH change, not all at once
5. The ATR pre-entry filter stays active (it cut max_hold by 76%)
6. Commit after each passing test
