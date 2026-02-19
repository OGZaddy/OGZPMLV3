# OGZPrime Entry Pipeline Refactor
## Problem: 6 Hardcoded Gates Killing 99.997% of Trade Signals

### Current Kill Chain (a trade must survive ALL of these)

```
Candle arrives
    │
    ▼
calculateRealConfidence()
    │── RSI 30-70? → 0% contribution (most candles)
    │── MACD near zero? → 0% or 15-20%
    │── EMA alignment? → 15-20%
    │── Trend sideways? → 0%
    │── No volume data? → 0%
    │── EMACrossover signal? → 3-5%
    │── MADynamicSR signal? → 5-10%
    │
    ├── GATE 1: bullishConfidence > 0.40? ──NO──→ direction = 'neutral'
    │   (Typical bull score: 0.20-0.35... DEAD HERE)
    │
    ├── GATE 2: Regime filter: trending_down + bull < 0.60? ──→ BLOCKED
    │
    ▼
    Sets marketData.direction = 'buy'|'sell'|'neutral'
    │
    ▼
getDecision()
    │
    ├── GATE 3: Pattern Dominance (if enabled): conf < 0.65? ──→ HOLD
    │
    ▼
determineTradingDirection()
    │
    ├── GATE 4: confidence < minConfidenceThreshold (0.08)? ──→ HOLD
    │   (Almost never triggers - too low)
    │
    ├── GATE 5: marketData.direction === 'neutral'? ──→ HOLD
    │   (This is where 99% die - set by GATE 1)
    │
    ▼
    Returns direction to getDecision()
    │
    ├── GATE 6: confidence < 0.15? ──→ force HOLD
    │
    ▼
makeTradeDecision() in run-empire-v2.js
    │
    ├── GATE 7: Desync guard (pos=0 + activeTrades)? ──→ HOLD
    │
    ├── GATE 8: totalConfidence >= minTradeConfidence (35%)
    │           AND brainDirection === 'buy'? ──→ HOLD if either fails
    │
    ▼
    🎉 BUY (happens ~2 times in 60,000 candles)
```

### The Core Problem
**GATE 1 (line 2999) is the primary killer.** It requires `bullishConfidence > 0.40` which means 40% of directional weight must come from bullish signals ALONE. On 1-minute BTC candles where RSI hovers 40-60, trend is sideways, and volume data is missing... the modules simply cannot stack enough points to clear 40%.

The EMACrossover (your 71% win rate champion) only contributes 3-5% when it fires. That drowns in the 40% requirement.

### What It SHOULD Be: One Threshold, Dynamic Adaptation

```
Candle arrives
    │
    ▼
calculateRealConfidence()
    │── All modules contribute weighted scores
    │── bullishConfidence / bearishConfidence tallied
    │── Winner becomes direction
    │── Net confidence = base + |bull - bear| (directional strength)
    │
    ├── Direction: whoever wins (bull vs bear), even by a little
    │   NO minimum directional threshold
    │   The STRENGTH of the signal matters, not an arbitrary gate
    │
    ▼
    confidence = base(10%) + directional_strength
    direction = 'buy' if bull > bear, 'sell' if bear > bull, 'hold' if both < 0.05
    │
    ▼
getDecision() 
    │── NO pattern dominance gate (disabled anyway)
    │── NO 0.15 floor (redundant with main threshold)
    │
    ▼
makeTradeDecision()
    │
    ├── ONE GATE: totalConfidence >= MIN_TRADE_CONFIDENCE (.env tunable)
    │             AND direction === 'buy' (brain agrees)
    │
    ├── SAFETY ONLY: RSI > 85 blocks buy (extreme only, not 80)
    │                 Desync guard (legitimate safety check)
    │
    ▼
    BUY or HOLD
```

### The Refactor (Surgical Cuts)

#### CUT 1: Remove the 0.40 directional gate (THE BIG ONE)
**File:** `core/OptimizedTradingBrain.js` line 2999
**Current:**
```javascript
if (bullishConfidence > bearishConfidence && bullishConfidence > 0.40) {
    direction = 'buy';
} else if (bearishConfidence > bullishConfidence && bearishConfidence > 0.40) {
    direction = 'sell';
} else {
    // direction stays 'neutral' ← THIS KILLS EVERYTHING
}
```
**New:**
```javascript
// Direction = whoever wins. MIN_TRADE_CONFIDENCE handles the "is it strong enough" question.
// We just need a small minimum edge (5%) to avoid coin-flip entries.
const minEdge = 0.05; // 5% minimum directional advantage
const directionalSpread = Math.abs(bullishConfidence - bearishConfidence);

if (bullishConfidence > bearishConfidence && directionalSpread >= minEdge) {
    direction = 'buy';
    finalConfidence = confidence + bullishConfidence;
} else if (bearishConfidence > bullishConfidence && directionalSpread >= minEdge) {
    direction = 'sell';
    finalConfidence = confidence + bearishConfidence;
} else {
    direction = 'neutral'; // Genuinely no directional signal
    // finalConfidence stays at base — will fail MIN_TRADE_CONFIDENCE naturally
}
```
**Why:** A 5% edge means bull must beat bear by at least 5 points. If EMACrossover fires bullish (+5%) with no bearish signals, that's enough to set direction='buy'. The CONFIDENCE NUMBER still has to clear MIN_TRADE_CONFIDENCE to actually trade.

#### CUT 2: Remove regime filter hardcoded gate
**File:** `core/OptimizedTradingBrain.js` line 2978-2991
**Current:** Hardcoded block if trending_down + bull < 0.60
**New:** Regime detector CONTRIBUTES bearish confidence instead of blocking
```javascript
// Regime adds its opinion to the directional tally, doesn't independently veto
// (already happening at line 2548-2562 — the regime filter at 2978 is DOUBLE PUNISHMENT)
// DELETE lines 2978-2991 entirely
```

#### CUT 3: Remove 0.15 confidence floor in getDecision
**File:** `core/OptimizedTradingBrain.js` line 3500
**Current:** `if (direction !== 'hold' && confidence < 0.15)` → force hold
**New:** DELETE. MIN_TRADE_CONFIDENCE in run-empire-v2.js already handles this.

#### CUT 4: Simplify determineTradingDirection
**File:** `core/OptimizedTradingBrain.js` line 3107-3224
**Current:** Re-checks direction, applies its OWN minConfidenceThreshold, has its OWN pattern strength analysis
**New:** Just return `marketData.direction` that calculateRealConfidence already set.
```javascript
determineTradingDirection(marketData, patterns, confidence) {
    // calculateRealConfidence already determined direction — just validate and return
    if (marketData.direction && ['buy', 'sell'].includes(marketData.direction)) {
        return marketData.direction;
    }
    return 'hold';
}
```
**Why:** This method was doing DUPLICATE work. calculateRealConfidence already analyzed all patterns, indicators, and directional scores. determineTradingDirection was re-analyzing the same data with different thresholds, creating inconsistency.

#### CUT 5: RSI safety → only at extremes
**File:** `core/OptimizedTradingBrain.js` line 3015-3025
**Current:** Blocks buy at RSI > 80, sell at RSI < 20
**New:** RSI > 88 blocks buy, RSI < 12 blocks sell (truly extreme only)

#### KEEP: Desync guard (line 2087) — legitimate safety check
#### KEEP: MIN_TRADE_CONFIDENCE gate (line 2098) — THE one tunable threshold
#### KEEP: brainDirection === 'buy' requirement (line 2098) — prevents directionless trades

### Summary of Changes

| Gate | Current | After Refactor |
|------|---------|----------------|
| 0.40 directional gate | Blocks if bull < 40% | Removed. 5% edge minimum instead |
| Regime filter | Blocks independently | Removed. Regime already contributes bearish score |
| 0.15 confidence floor | Redundant block | Removed |
| determineTradingDirection | Re-analyzes everything | Passthrough — trusts calculateRealConfidence |
| Pattern dominance | Disabled but code exists | No change (already off) |
| RSI safety | 80/20 | 88/12 (extreme only) |
| MIN_TRADE_CONFIDENCE | THE threshold | **Unchanged — this is the ONE knob** |
| Desync guard | Safety check | **Unchanged** |
| brainDirection check | Requires 'buy' | **Unchanged** |

### Expected Impact
- Trade count: 2 → estimated 50-300+ on 60k candles
- Grid search on 7800X3D can now find optimal MIN_TRADE_CONFIDENCE
- Modules (EMACrossover, MADynamicSR) can actually trigger trades
- MarketRegimeDetector adapts confidence dynamically (not binary block)
- One number to tune, everything else flows through it
