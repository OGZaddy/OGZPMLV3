# INSTRUCTIONS FOR CLAUDE CODE — Apply Corrections

**STATUS: MANDATORY. Do not skip or modify these steps.**
**SOURCE: Claude Desktop audit of Phases 0-3**

---

## PROBLEM SUMMARY

Phases 0-3 committed modules that are `require()`'d but NEVER INSTANTIATED or CALLED.
The golden test passed because the old monolith is still doing 100% of the work.
Additionally, IndicatorSnapshot has silent fallback paths and RegimeDetector has
incorrect classification priority.

---

## STEP 1: Apply ContractValidator Fix

In `core/ContractValidator.js`, find the `validateIndicators()` method.

FIND AND REPLACE this section:

```javascript
    // === BOLLINGER BANDS ===
    if (indicators.bb) {
```

REPLACE the entire BB + DERIVED + TREND section with:

```javascript
    // === BOLLINGER BANDS (REQUIRED — IndicatorSnapshot always produces these) ===
    valid = this.assertDefined('bb', indicators.bb) && valid;
    if (indicators.bb) {
      valid = this.assertPositive('bb.upper', indicators.bb.upper) && valid;
      valid = this.assertPositive('bb.middle', indicators.bb.middle) && valid;
      valid = this.assertPositive('bb.lower', indicators.bb.lower) && valid;
      valid = this.assertRange('bb.percentB', indicators.bb.percentB, 0, 1) && valid;
      valid = this.assertRange('bb.bandwidth', indicators.bb.bandwidth, 0, 100) && valid;
    }

    // === DERIVED ===
    valid = this.assertRange('volatilityNormalized', indicators.volatilityNormalized, 0, 1) && valid;

    // === TREND (REQUIRED — IndicatorSnapshot is THE single source of trend) ===
    valid = this.assertEnum('trend', indicators.trend, ['uptrend', 'downtrend', 'neutral']) && valid;
```

The key change: `trend` validation is no longer wrapped in `if (indicators.trend !== undefined)`.
It's always required. If trend is missing, that's the bug we want to catch.

---

## STEP 2: Replace IndicatorSnapshot

Replace the ENTIRE contents of `core/IndicatorSnapshot.js` with the corrected version
from `/home/claude/corrections/02-IndicatorSnapshot-corrected.js`.

Key changes:
- `_requireNumber()` THROWS on missing required fields (rsi, atr)
- `_requirePositive()` THROWS on zero/negative (atr)
- BB extraction THROWS if bb object missing
- No more `raw.rsi ?? 50` silent defaults
- EMA defaults to price during warmup (mathematically correct, not a "fallback")
- `_extractATR()` heuristic removed — ATR must be in dollars from indicator engine

---

## STEP 3: Replace RegimeDetector

Replace the ENTIRE contents of `core/RegimeDetector.js` with the corrected version
from `/home/claude/corrections/03-RegimeDetector-corrected.js`.

Key changes:
- Trend takes PRIORITY over volatility (BTC trends UP with high volatility)
- "volatile" only fires when high ATR AND no clear trend direction
- Metric renamed from fake "ADX" to honest "directionalDominance"
- Classification priority: strong trend → moderate trend → volatile → ranging

---

## STEP 4: Verify Modules Load

```bash
node -e "
  const { ContractValidator } = require('./core/ContractValidator');
  const { CandleStore } = require('./core/CandleStore');
  const { IndicatorCalculator } = require('./core/IndicatorCalculator');
  const { IndicatorSnapshot } = require('./core/IndicatorSnapshot');
  const { CandleAggregator } = require('./core/CandleAggregator');
  const { RegimeDetector } = require('./core/RegimeDetector');
  
  // Verify instantiation
  const v = ContractValidator.createMonitor();
  const cs = new CandleStore();
  const is = new IndicatorSnapshot(v);
  const ca = new CandleAggregator();
  const rd = new RegimeDetector();
  
  console.log('✅ All Phase 0-3 modules load and instantiate');
  
  // Verify IndicatorSnapshot throws on missing data
  try {
    is.create({}, 95000);
    console.log('❌ IndicatorSnapshot should have thrown on missing RSI');
  } catch (e) {
    console.log('✅ IndicatorSnapshot throws on missing RSI:', e.message.substring(0, 60));
  }
  
  // Verify IndicatorSnapshot works with valid data
  try {
    const snap = is.create({
      rsi: 45,
      macd: { macd: 100, signal: 80, histogram: 20 },
      ema: { 9: 95100, 21: 94800, 50: 93500, 200: 88000 },
      atr: 523,
      bb: { upper: 96500, middle: 95000, lower: 93500 },
      volume: 1500,
      vwap: 95200
    }, 95000);
    console.log('✅ IndicatorSnapshot creates valid snapshot:', 
      'rsi=' + snap.rsi, 'trend=' + snap.trend, 'atr=' + snap.atr);
  } catch (e) {
    console.log('❌ IndicatorSnapshot failed with valid data:', e.message);
  }
"
```

ALL THREE checks must pass before proceeding.

---

## STEP 5: Run Golden Test

```bash
BACKTEST_MODE=true BACKTEST_FAST=true BACKTEST_VERBOSE=true \
  CANDLE_DATA_FILE=data/polygon-btc-1y.json \
  timeout 15 node run-empire-v2.js 2>&1 | head -80
```

Bot must start without errors. Trade decisions must still fire.

NOTE: The modules are still only imported, not wired into the trading loop.
That's Phase 5+ work. Right now we're making sure the corrected modules
don't break the import chain.

---

## STEP 6: Run Pipeline Audit

**THIS IS MANDATORY. Trey asked for this 4+ times and it was never done.**

```bash
node ogz-meta/pipeline-audit.js
```

Document the output. This validates the trading pipeline integrity.

---

## STEP 7: Commit

```bash
git add core/ContractValidator.js core/IndicatorSnapshot.js core/RegimeDetector.js
git commit -m "fix(refactor): Correct Phase 0-3 modules per desktop audit

- ContractValidator: trend and bb validation now mandatory (not optional)
- IndicatorSnapshot: strict extraction, throws on missing required data
  - Removes silent fallbacks (rsi??50, atr<1 heuristic, fake BB values)
  - _requireNumber/_requirePositive throw on missing fields
- RegimeDetector: trend priority over volatility
  - BTC trends UP with high volatility — that's trending, not volatile
  - Renamed fake 'ADX' to honest 'directionalDominance'
  - 'volatile' only fires on high ATR + no clear direction

Audit: /home/claude/refactor-audit-and-corrections.md"
```

---

## STEP 8: Push

```bash
git push origin HEAD
```

---

## DO NOT PROCEED TO PHASE 4 until Trey confirms these corrections are applied.
