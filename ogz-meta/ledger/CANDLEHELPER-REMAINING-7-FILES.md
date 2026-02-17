# CANDLEHELPER MIGRATION — REMAINING 7 FILES
# Date: 2026-02-16
# These files use raw candle.c / candle.h / candle.l but DON'T import CandleHelper
# This is causing 59,990 errors in backtest and will crash live bot on first trade

## FILES ALREADY DONE (have CandleHelper import):
# ✅ core/MarketRegimeDetector.js
# ✅ core/OgzTpoIntegration.js  
# ✅ core/TradeIntelligenceEngine.js
# ✅ core/indicators/IndicatorEngine.js
# ✅ core/indicators/TwoPoleOscillator.js
# ✅ core/FibonacciDetector.js
# ✅ core/SupportResistanceDetector.js
# ✅ modules/LiquiditySweepDetector.js
# ✅ modules/MultiTimeframeAdapter.js
# ✅ modules/MADynamicSR.js
# ✅ modules/EMASMACrossoverSignal.js
# ✅ run-empire-v2.js

## FILES STILL NEED FIXING (7 files, 46 raw accesses):

### 1. core/CandlePatternDetector.js (21 raw accesses — BIGGEST)

Add import at top (after any existing requires):
```javascript
const { c, o, h, l, v } = require('./CandleHelper');
```

Replace helper methods (lines 124-131):
```javascript
_bodySize(candle) { return Math.abs(c(candle) - o(candle)); }
_isBullish(candle) { return c(candle) > o(candle); }
_isBearish(candle) { return c(candle) < o(candle); }
_upperWick(candle) { return h(candle) - Math.max(o(candle), c(candle)); }
_lowerWick(candle) { return Math.min(o(candle), c(candle)) - l(candle); }
_midpoint(candle) { return (o(candle) + c(candle)) / 2; }
```

Replace all `.map(c =>` with `.map(candle =>` to avoid shadowing:
- Line 283: `candles.map(c => c.l)` → `candles.map(candle => l(candle))`
- Line 284: `candles.map(c => c.h)` → `candles.map(candle => h(candle))`
- Line 330-331, 372-373, 402-403, 430-431: same pattern
- Line 317, 359, 378, 407: `candles[...].c` → `c(candles[...])`
- Line 500: `pole[...].c - pole[0].c` → `c(pole[...]) - c(pole[0])`
- Lines 152, 174, 190: `curr.c.toFixed(2)` → `c(curr).toFixed(2)`
- Lines 203-224: `curr.o`, `prev.c`, `curr.c`, `prev.o` → use helpers

### 2. core/EnhancedPatternRecognition.js (7 raw accesses)

Add import at top:
```javascript
const { c, o, h, l } = require('./CandleHelper');
```

Fix lines 86-93:
```javascript
const bodySize = Math.abs(c(latestCandle) - o(latestCandle)) / c(latestCandle);
const wickRatio = h(latestCandle) !== l(latestCandle)
  ? (Math.abs(c(latestCandle) - o(latestCandle)) / (h(latestCandle) - l(latestCandle)))
  : 0;
const priceChange = previousCandle && c(previousCandle) > 0
  ? (c(latestCandle) - c(previousCandle)) / c(previousCandle)
  : 0;
```

### 3. core/OptimizedTradingBrain.js (1 raw access)

Add import at top:
```javascript
const { c: _c } = require('./CandleHelper');
```

Fix line 2694:
```javascript
const price = marketData.price || _c(this.priceData[this.priceData.length - 1]);
```

### 4. core/SignalGenerator.js (4 raw accesses)

Add import at top:
```javascript
const { c } = require('./CandleHelper');
```

Fix lines 61-62:
```javascript
const price = indicators?.lastCandle ? c(indicators.lastCandle)
  : priceHistory[priceHistory.length - 1] ? c(priceHistory[priceHistory.length - 1])
  : 0;
```

Fix lines 381-382:
```javascript
const current = priceHistory[priceHistory.length - 1] ? c(priceHistory[priceHistory.length - 1]) : null;
const past = priceHistory[priceHistory.length - lookback] ? c(priceHistory[priceHistory.length - lookback]) : null;
```

### 5. core/TimeFrameManager.js (10 raw accesses)

Add import at top:
```javascript
const { c, o, h, l, v, t } = require('./CandleHelper');
```

Fix lines 364-366 (these use `.map(c =>` which shadows the import!):
```javascript
result = result.map(candle => [t(candle), o(candle), h(candle), l(candle), c(candle), v(candle)]);
// line 366:
result = result.map(candle => [o(candle), h(candle), l(candle), c(candle), v(candle)]);
```

Fix lines 460-464:
```javascript
const opens = candles.map(candle => o(candle));
const highs = candles.map(candle => h(candle));
const lows = candles.map(candle => l(candle));
const closes = candles.map(candle => c(candle));
const volumes = candles.map(candle => v(candle));
```

Fix lines 497-498:
```javascript
high: Math.max(...candles.map(candle => h(candle))),
low: Math.min(...candles.map(candle => l(candle))),
```

### 6. core/TradeReplayCapture.js (2 raw accesses)

Add import at top:
```javascript
const { c, o, h, l, v, t } = require('./CandleHelper');
```

Fix lines 60 and 103 — both are `.map(c => ({...}))` which shadows import:
```javascript
// Line 60:
const candleSnapshot = priceHistory.slice(-this.candlesBefore).map(candle => ({
  o: o(candle), h: h(candle), l: l(candle), c: c(candle), v: v(candle), t: t(candle)
}));
// Line 103: same pattern
const currentCandles = (priceHistory || []).slice(-this.candlesBefore).map(candle => ({
  o: o(candle), h: h(candle), l: l(candle), c: c(candle), v: v(candle), t: t(candle)
}));
```

### 7. core/PipelineSnapshot.js (1 raw access)

Add import at top:
```javascript
const { c } = require('./CandleHelper');
```

Find the `.c` access and replace with `c(candle)`.

---

## CRITICAL VARIABLE SHADOWING WARNING

When importing `{ c, h, l }` from CandleHelper, you CANNOT use `c` as a loop variable:

```javascript
// ❌ BROKEN — c in .map(c => ...) shadows the imported c function
candles.map(c => c.c)

// ✅ FIXED — use 'candle' as the loop variable
candles.map(candle => c(candle))
```

This is the #1 cause of the 59,990 errors. Every `.map(c =>` pattern must become `.map(candle =>`.

---

## VERIFICATION

After fixing all 7 files:
```bash
# Syntax check all fixed files
for f in core/CandlePatternDetector.js core/EnhancedPatternRecognition.js core/OptimizedTradingBrain.js core/SignalGenerator.js core/TimeFrameManager.js core/TradeReplayCapture.js core/PipelineSnapshot.js; do
  node --check "$f" 2>&1 && echo "✅ $f" || echo "❌ $f"
done

# Run backtest
BACKTEST_MODE=true BACKTEST_SILENT=true timeout 120 node run-empire-v2.js 2>&1 | tail -20
```

Expected: 0 errors, trades executing, P&L non-zero.
