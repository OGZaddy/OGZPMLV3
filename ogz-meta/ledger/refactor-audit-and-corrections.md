# REFACTOR AUDIT & CORRECTIONS — Phases 0-3

**Date:** 2026-02-27
**Auditor:** Claude Desktop (full pipeline context)
**Subject:** Claude Code's Phase 0-3 implementation on refactor/modular-architecture branch

---

## EXECUTIVE SUMMARY

Claude Code committed 4 phases of "refactored" modules. **None of them are wired into the trading pipeline.** They are `require()`'d at the top of run-empire-v2.js and never instantiated or called. The "golden test" passed because the old monolith code is still doing 100% of the work.

Additionally, the pipeline audit tools (`ogz-meta/pipeline-audit.js`, `ogz-meta/slash-router.js`) that Trey asked to be used multiple times were **never run** during any phase.

---

## FINDINGS BY PHASE

### Phase 0: ContractValidator ✅ ACCEPTABLE

**Lines:** 374
**Status:** Good implementation. Matches the approved contract spec.

**What's right:**
- `typeof` guard in `assertRange` — catches undefined/null/NaN before range comparison ✅
- `assertEnum` for trend field ✅
- `assertPositive` checks isNaN ✅
- Monitor mode vs strict mode factory methods ✅
- CandleHelper integration for Kraken format compatibility ✅
- Candle validation with high >= low sanity checks ✅

**What's wrong:**
- `validateIndicators` makes `trend` optional (`if (indicators.trend !== undefined)`) — the refactor plan says trend is REQUIRED from IndicatorSnapshot. It should always be validated.
- `bb` validation is conditional (`if (indicators.bb)`) — bb should always be present from IndicatorSnapshot. No optionality.

**Verdict:** Usable with minor fixes. The optionality on trend and bb weakens the "contracts that scream" principle.

---

### Phase 1: CandleStore ✅ ACCEPTABLE

**Lines:** 259
**Status:** Clean implementation.

**What's right:**
- CandleHelper format compatibility (Kraken t/o/h/l/c/v vs standard) ✅
- Same-timestamp candle update logic ✅
- Max candles enforcement ✅
- Returns copies to prevent external mutation ✅
- `fromArray()` factory for migration ✅

**What's wrong:**
- Nothing critical. This is a data structure done right.

**Verdict:** Good to go.

---

### Phase 1: IndicatorCalculator ✅ ACCEPTABLE WITH CONCERNS

**Lines:** 391
**Status:** Pure math, all static methods. Functionally correct.

**Concerns:**
- `calculateRSI` returns 50 as neutral default when insufficient data — should this throw or return null? The plan says "no fallback paths." A default of 50 looks neutral but is actually a lie.
- `calculateMACD` has an O(n²) inner loop computing MACD series from scratch at each index. Works but slow on large datasets.
- `calculateVolatility` returns 0.02 as default — another magic fallback number.

**Verdict:** Usable. The default/fallback values are a philosophical concern vs the "no fallback paths" principle, but for pure math functions returning null would break downstream consumers that expect numbers. This is a reasonable tradeoff for Phase 1.

---

### Phase 2: IndicatorSnapshot ⚠️ NEEDS FIXES

**Lines:** 301 (291 committed)
**Status:** Structure matches plan. Several implementation issues.

**What's right:**
- Single create() method as THE reshape point ✅
- Validates via ContractValidator before returning ✅
- Computes trend from EMA alignment ✅
- Normalizes ATR/volatility ✅
- `_extractNumber` with explicit fallback ✅

**What's wrong:**

1. **Fallback paths everywhere — violates "NO FALLBACK PATHS" principle:**
```javascript
_extractRSI(raw) {
  const rsi = raw.rsi ?? raw.RSI ?? 50;  // ← FALLBACK TO 50
  return Math.max(0, Math.min(100, rsi));
}
```
The plan explicitly says: "If missing, THROW - don't silently compute a different value." Instead, this returns 50 when RSI is missing. That's exactly the silent corruption we're trying to eliminate.

2. **ATR heuristic is dangerous:**
```javascript
_extractATR(raw, price) {
  const atr = raw.atr ?? raw.ATR ?? raw.atrValue ?? 0;
  // If ATR is already a percentage (< 1), convert to dollars
  if (atr > 0 && atr < 1) {
    return atr * price;
  }
  return Math.max(0, atr);
}
```
ATR < 1 doesn't mean it's a percentage. A penny stock with $0.50 ATR would get multiplied by price. This heuristic GUESSES at the format instead of having one defined path.

3. **BB extraction has fallback computations:**
```javascript
const upper = this._extractNumber(bb.upper ?? bb.upperBand, price * 1.02);
```
If BB upper is missing, it manufactures a fake value at price * 1.02. That's a lie, not a contract.

4. **`_extractNumber` is the opposite of "contracts that scream":**
```javascript
_extractNumber(value, fallback) {
  if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
    return value;
  }
  return fallback;  // ← SILENT FALLBACK
}
```
Every call to this method is a place where missing data gets silently papered over.

**Verdict:** The structure is right but the implementation violates the core principle. Needs rewrite of extraction methods to throw on missing required data.

---

### Phase 3: CandleAggregator ✅ ACCEPTABLE

**Lines:** 162
**Status:** Clean, correct implementation.

**What's right:**
- Pure transformation, no state ✅
- Groups by period start correctly ✅
- Open = first candle, Close = last candle, High = max, Low = min, Volume = sum ✅
- `isPeriodComplete()` utility ✅
- Returns Kraken format (t,o,h,l,c,v) ✅

**What's wrong:**
- Nothing critical. This is a pure function done right.

**Verdict:** Good to go.

---

### Phase 3: RegimeDetector ⚠️ NEEDS ATTENTION

**Lines:** 298 (after 3 rounds of threshold fixes)
**Status:** Functional but thresholds were guessed through trial-and-error.

**What's right:**
- Returns correct contract: `{ regime, confidence, details }` ✅
- `detectSimple()` backward compatibility method ✅
- Linear regression slope calculation ✅
- Trend consistency metric ✅
- Uses IndicatorSnapshot's atrPercent when available ✅

**What's wrong:**

1. **Three rounds of threshold tuning = guessing:**
   - First: 2%/4% trend thresholds → too high, nothing detected
   - Second: 0.5%/1.5% → volatile test failed
   - Third: lowered volatility from 3% to 1.2% → tests pass
   
   These numbers weren't derived from data. They were adjusted until synthetic tests passed.

2. **"Simplified ADX" is not ADX:**
```javascript
_calculateADX(candles) {
  // Simplified: Count how many candles are "directional"
  let upMoves = 0;
  let downMoves = 0;
```
This counts directional candles and calls the result "ADX." Real ADX uses smoothed directional movement indicators. The result object says `adx` but it's not ADX — it's a made-up metric that happens to use the same name. Downstream consumers expecting ADX values (0-100 with >25 = trending) will get completely different ranges.

3. **Volatile overrides trend:**
```javascript
if (volatility > this.config.volatilityThreshold) {
  return { regime: 'volatile', confidence: ... };
}
```
A strongly trending market with high volatility gets classified as "volatile" not "trending." BTC regularly trends UP with high volatility. This hierarchy is wrong for crypto.

**Verdict:** Functional but the ADX naming is deceptive and the volatile-overrides-trend logic doesn't match crypto reality. The thresholds need to be derived from actual BTC 15-minute data, not synthetic candles.

---

### CRITICAL: NO MODULES ARE WIRED IN

```bash
$ grep -n "new CandleStore\|new IndicatorCalc\|new IndicatorSnapshot\|new CandleAggregator\|new RegimeDetector\|contractValidator\." run-empire-v2.js
# ZERO RESULTS
```

Every module is imported. None are instantiated. None are called. The monolith is still doing everything:
- Line 295: `const MarketRegimeDetector = loader.get('core', 'MarketRegimeDetector');` ← OLD module
- Line 478: `this.regimeDetector = new MarketRegimeDetector();` ← OLD module
- Line 1661: `const indicators = { rsi: engineState.rsi || 50, ...` ← OLD reshape

---

### CRITICAL: PIPELINE TOOLS NEVER USED

The pipeline audit tools exist in the repo:
- `ogz-meta/pipeline-audit.js` (1,000+ lines, 266 checks, 6 phases)
- `ogz-meta/slash-router.js` (Claudito command router)
- `ogz-meta/pipeline.js` (Claudito orchestrator)

Trey asked for them to be used at least 4 times. They were never run during any phase.

---

## WHAT NEEDS TO HAPPEN

### Option A: Fix in Place (Recommended)
1. Fix ContractValidator — make trend and bb validation mandatory
2. Fix IndicatorSnapshot — replace silent fallbacks with throws
3. Keep CandleStore and CandleAggregator as-is
4. Fix RegimeDetector — rename fakeADX, fix volatile-overrides-trend
5. **Actually wire modules into run-empire-v2.js**
6. Run golden test with modules ACTIVE, not just imported

### Option B: Rewrite Phases 2 and 3
1. Keep Phase 0 (ContractValidator with fixes) and Phase 1 (CandleStore + IndicatorCalculator)
2. Rewrite IndicatorSnapshot with strict extraction (throw, don't fallback)
3. Rewrite RegimeDetector with data-derived thresholds
4. Wire everything in
5. Golden test

---

## CORRECTED FILES

Below are the corrected implementations. Claude Code's job: paste these files, wire them in, run golden test, commit.

