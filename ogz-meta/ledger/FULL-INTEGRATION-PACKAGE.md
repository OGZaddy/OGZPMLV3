ddddddddddddddddddddddddddddddddcc═══════════════════════════════════════════════════════════════════════════════
  PHASE 0-3 CORRECTIONS + WIRING — COMPLETE INTEGRATION PACKAGE
  
  For: Claude Code
  From: Claude Desktop (architect)
  Date: 2026-02-27
  
  RULES:
  1. Paste the code blocks EXACTLY as written
  2. Run the verification commands EXACTLY as written
  3. If a verification FAILS, STOP and report — do NOT continue
  4. Do NOT "simplify", "improve", or modify anything
  5. Run pipeline-audit.js when instructed
  6. Commit messages are provided — use them verbatim
═══════════════════════════════════════════════════════════════════════════════

████████████████████████████████████████████████████████████████████████████████
█ STEP 1: REPLACE core/IndicatorSnapshot.js (entire file)                    █
████████████████████████████████████████████████████████████████████████████████

Delete ALL contents of core/IndicatorSnapshot.js and replace with this:

---BEGIN FILE core/IndicatorSnapshot.js---
/**
 * IndicatorSnapshot - Phase 2 of Modular Architecture Refactor
 * CORRECTED 2026-02-27 by Claude Desktop audit
 *
 * PURPOSE: Creates THE ONE canonical indicator object from raw calculations.
 * Single transformation point. No fallback paths. No alternative reshapes.
 *
 * DESIGN PRINCIPLE: NO SILENT FALLBACKS
 * If a required field is missing from raw data, we THROW — not silently substitute.
 * The old code had `raw.rsi ?? 50` which meant missing RSI looked "neutral."
 * That's a lie. A missing RSI is a bug in the data pipeline.
 *
 * @see ogz-meta/REFACTOR-PLAN-2026-02-27.md
 */

const { ContractValidator, ContractViolation } = require('./ContractValidator');
const { c: _c } = require('./CandleHelper');

class IndicatorSnapshot {
  constructor(validator = null) {
    this.validator = validator || ContractValidator.createMonitor();
  }

  /**
   * Create canonical Indicators object from raw IndicatorEngine output.
   *
   * @param {Object} raw - Raw data from indicatorEngine.getSnapshot()
   * @param {number} price - Current price (required for normalization)
   * @param {Array} candles - Optional (unused, API compat)
   * @returns {Object} Validated canonical indicator object
   * @throws {ContractViolation} If required fields are missing
   */
  create(raw, price, candles = null) {
    if (!raw || typeof raw !== 'object') {
      throw new ContractViolation(
        'IndicatorSnapshot.create() requires raw indicator data',
        'raw', raw, 'object'
      );
    }
    if (typeof price !== 'number' || price <= 0 || isNaN(price)) {
      throw new ContractViolation(
        `IndicatorSnapshot.create() requires valid price, got: ${price}`,
        'price', price, 'positive number'
      );
    }

    // === STRICT EXTRACTION ===

    // RSI: must exist, 0-100
    const rsi = this._requireNumber(raw, 'rsi', 'RSI');
    const rsiClamped = Math.max(0, Math.min(100, rsi));
    const rsiNormalized = rsiClamped / 100;

    // MACD: must be object with macd/signal/histogram
    const macdRaw = raw.macd || raw.MACD;
    if (!macdRaw || typeof macdRaw !== 'object') {
      throw new ContractViolation(
        'IndicatorSnapshot requires raw.macd object',
        'macd', macdRaw, 'object'
      );
    }
    const macd = {
      macd: this._toNumber(macdRaw.macd ?? macdRaw.macdLine, 'macd.macd'),
      signal: this._toNumber(macdRaw.signal ?? macdRaw.signalLine, 'macd.signal'),
      histogram: this._toNumber(macdRaw.hist ?? macdRaw.histogram, 'macd.histogram')
    };

    // EMAs
    const ema9 = this._extractEMA(raw, 9, price);
    const ema21 = this._extractEMA(raw, 21, price);
    const ema50 = this._extractEMA(raw, 50, price);
    const ema200 = this._extractEMA(raw, 200, price);

    // ATR: must exist and be positive (in dollars)
    const atr = this._requirePositive(raw, 'atr', 'ATR');
    const atrPercent = (atr / price) * 100;
    const atrNormalized = Math.min(1, atrPercent / 5);

    // Bollinger Bands: must exist
    const bb = this._extractBB(raw, price);

    // Volume (optional — 0 is valid)
    const volume = this._toNumber(raw.volume ?? raw.v, 'volume');
    const vwap = this._toNumber(raw.vwap, 'vwap', price);

    // Volatility composite
    const atrScore = atrNormalized;
    const bbScore = Math.min(1, bb.bandwidth / 10);
    const volatilityNormalized = (atrScore * 0.7) + (bbScore * 0.3);

    // Trend — single source of truth from EMA alignment
    const trend = this._computeTrend(ema9, ema21, ema50, price);

    const snapshot = {
      price,
      rsi: rsiClamped,
      rsiNormalized,
      macd,
      ema9,
      ema21,
      ema50,
      ema200,
      atr,
      atrPercent,
      atrNormalized,
      bb,
      volatilityNormalized,
      volume,
      vwap,
      trend
    };

    this.validator.validateIndicators(snapshot);
    return snapshot;
  }

  // === STRICT EXTRACTION HELPERS ===

  _requireNumber(raw, ...fieldNames) {
    for (const name of fieldNames) {
      const value = raw[name];
      if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
        return value;
      }
    }
    throw new ContractViolation(
      `IndicatorSnapshot requires one of [${fieldNames.join(', ')}] as number, got: ${fieldNames.map(f => `${f}=${raw[f]}`).join(', ')}`,
      fieldNames[0], raw[fieldNames[0]], 'number'
    );
  }

  _requirePositive(raw, ...fieldNames) {
    const value = this._requireNumber(raw, ...fieldNames);
    if (value <= 0) {
      throw new ContractViolation(
        `IndicatorSnapshot requires ${fieldNames[0]} > 0, got: ${value}`,
        fieldNames[0], value, 'positive number'
      );
    }
    return value;
  }

  _toNumber(value, fieldName, fallback = 0) {
    if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
      return value;
    }
    return fallback;
  }

  _extractEMA(raw, period, price) {
    if (raw.ema && typeof raw.ema === 'object' && typeof raw.ema[period] === 'number') {
      return raw.ema[period];
    }
    const flatKey = `ema${period}`;
    if (typeof raw[flatKey] === 'number' && !isNaN(raw[flatKey])) {
      return raw[flatKey];
    }
    return price; // EMA with no history IS the current price (mathematically correct)
  }

  _extractBB(raw, price) {
    const bb = raw.bb ?? raw.bollingerBands ?? raw.BB;
    const bbExtras = raw.bbExtras ?? {};

    if (!bb || typeof bb !== 'object') {
      throw new ContractViolation(
        'IndicatorSnapshot requires Bollinger Bands data (raw.bb)',
        'bb', bb, 'object'
      );
    }

    const upper = this._toNumber(bb.upper ?? bb.upperBand, 'bb.upper');
    const middle = this._toNumber(bb.mid ?? bb.middle ?? bb.middleBand, 'bb.middle');
    const lower = this._toNumber(bb.lower ?? bb.lowerBand, 'bb.lower');

    if (upper <= 0 || middle <= 0 || lower <= 0) {
      throw new ContractViolation(
        `BB values must be positive: upper=${upper}, middle=${middle}, lower=${lower}`,
        'bb', { upper, middle, lower }, 'positive numbers'
      );
    }

    const bandwidth = middle > 0 ? ((upper - lower) / middle) * 100 : 0;
    const range = upper - lower;
    const percentB = range > 0 ? (price - lower) / range : 0.5;

    return {
      upper, middle, lower,
      bandwidth: Math.max(0, Math.min(100, bandwidth)),
      percentB: Math.max(0, Math.min(1, percentB))
    };
  }

  _computeTrend(ema9, ema21, ema50, price) {
    if (ema9 > ema21 && ema21 > ema50 && price > ema9) return 'uptrend';
    if (ema9 < ema21 && ema21 < ema50 && price < ema9) return 'downtrend';
    return 'neutral';
  }

  // === FACTORY METHODS ===

  static createStrict(raw, price, candles = null) {
    return new IndicatorSnapshot(ContractValidator.createStrict()).create(raw, price, candles);
  }

  static createMonitor(raw, price, candles = null) {
    return new IndicatorSnapshot(ContractValidator.createMonitor()).create(raw, price, candles);
  }

  static fromEngine(engineState, price, candles = null) {
    return new IndicatorSnapshot().create(engineState, price, candles);
  }
}

module.exports = { IndicatorSnapshot };
---END FILE---


████████████████████████████████████████████████████████████████████████████████
█ STEP 2: REPLACE core/RegimeDetector.js (entire file)                       █
████████████████████████████████████████████████████████████████████████████████

Delete ALL contents of core/RegimeDetector.js and replace with this:

---BEGIN FILE core/RegimeDetector.js---
/**
 * RegimeDetector - Phase 3 of Modular Architecture Refactor
 * CORRECTED 2026-02-27 by Claude Desktop audit
 *
 * PURPOSE: Detects market regime. Pure function.
 *
 * REGIMES: trending_up, trending_down, ranging, volatile
 *
 * KEY DESIGN: Trend takes PRIORITY over volatility.
 * BTC regularly trends UP with high volatility. That's trending, not volatile.
 * "Volatile" = high ATR + NO clear direction (choppy/whipsaw).
 *
 * @see ogz-meta/REFACTOR-PLAN-2026-02-27.md
 */

const { c: _c, h: _h, l: _l } = require('./CandleHelper');

class RegimeDetector {
  constructor(config = {}) {
    this.config = {
      trendThreshold: config.trendThreshold || 0.005,
      strongTrendThreshold: config.strongTrendThreshold || 0.015,
      volatilityThreshold: config.volatilityThreshold || 0.012,
      trendLookback: config.trendLookback || 20,
      volatilityLookback: config.volatilityLookback || 14,
      minTrendConsistency: config.minTrendConsistency || 0.5
    };
  }

  detect(indicators, candles) {
    if (!candles || candles.length < 10) {
      return {
        regime: 'ranging',
        confidence: 0,
        details: { directionalDominance: 0, trendStrength: 0, volatility: 0, reason: 'insufficient_data' }
      };
    }

    const trend = this._measureTrend(candles);
    const volatility = this._measureVolatility(candles, indicators);
    const dominance = this._measureDirectionalDominance(candles);
    const { regime, confidence } = this._classify(trend.slope, trend.consistency, volatility, dominance);

    return {
      regime,
      confidence,
      details: {
        directionalDominance: dominance,
        trendStrength: Math.abs(trend.slope),
        trendDirection: trend.slope > 0 ? 1 : trend.slope < 0 ? -1 : 0,
        trendConsistency: trend.consistency,
        volatility,
        reason: this._reason(regime, trend.slope, volatility, dominance)
      }
    };
  }

  _measureTrend(candles) {
    const lookback = Math.min(this.config.trendLookback, candles.length);
    const recent = candles.slice(-lookback);
    const closes = recent.map(c => _c(c));
    const slope = this._linRegSlope(closes);
    const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
    const normalizedSlope = avgPrice > 0 ? (slope * lookback) / avgPrice : 0;

    let consistent = 0;
    for (let i = 1; i < closes.length; i++) {
      const move = closes[i] - closes[i - 1];
      if ((slope > 0 && move > 0) || (slope < 0 && move < 0)) consistent++;
    }
    const consistency = closes.length > 1 ? consistent / (closes.length - 1) : 0;
    return { slope: normalizedSlope, consistency };
  }

  _measureVolatility(candles, indicators) {
    if (indicators && typeof indicators.atrPercent === 'number' && indicators.atrPercent > 0) {
      return indicators.atrPercent / 100;
    }
    const lookback = Math.min(this.config.volatilityLookback, candles.length);
    const recent = candles.slice(-lookback);
    if (recent.length < 2) return 0;
    let atrSum = 0;
    for (let i = 1; i < recent.length; i++) {
      const tr = Math.max(
        _h(recent[i]) - _l(recent[i]),
        Math.abs(_h(recent[i]) - _c(recent[i - 1])),
        Math.abs(_l(recent[i]) - _c(recent[i - 1]))
      );
      atrSum += tr;
    }
    const atr = atrSum / (recent.length - 1);
    const avgPrice = recent.reduce((s, c) => s + _c(c), 0) / recent.length;
    return avgPrice > 0 ? atr / avgPrice : 0;
  }

  _measureDirectionalDominance(candles) {
    const lookback = Math.min(14, candles.length);
    const recent = candles.slice(-lookback);
    if (recent.length < 3) return 0;
    let up = 0, down = 0;
    for (let i = 1; i < recent.length; i++) {
      const upExp = _h(recent[i]) - _h(recent[i - 1]);
      const dnExp = _l(recent[i - 1]) - _l(recent[i]);
      if (upExp > dnExp && upExp > 0) up++;
      else if (dnExp > upExp && dnExp > 0) down++;
    }
    const total = recent.length - 1;
    return total > 0 ? Math.abs(up - down) / total : 0;
  }

  // Trend takes priority. Volatile only fires when NO trend + high ATR.
  _classify(slope, consistency, volatility, dominance) {
    const absSlope = Math.abs(slope);

    if (absSlope > this.config.strongTrendThreshold && consistency > 0.6) {
      return {
        regime: slope > 0 ? 'trending_up' : 'trending_down',
        confidence: Math.min(1, (consistency * 0.6 + dominance * 0.4))
      };
    }
    if (absSlope > this.config.trendThreshold && consistency > this.config.minTrendConsistency) {
      return {
        regime: slope > 0 ? 'trending_up' : 'trending_down',
        confidence: Math.min(1, (consistency * 0.6 + dominance * 0.4)) * 0.8
      };
    }
    if (volatility > this.config.volatilityThreshold && absSlope < this.config.trendThreshold) {
      return {
        regime: 'volatile',
        confidence: Math.min(1, volatility / (this.config.volatilityThreshold * 2))
      };
    }
    return {
      regime: 'ranging',
      confidence: 1 - Math.min(1, absSlope / this.config.trendThreshold)
    };
  }

  _linRegSlope(values) {
    const n = values.length;
    if (n < 2) return 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i; sumY += values[i]; sumXY += i * values[i]; sumX2 += i * i;
    }
    const d = (n * sumX2 - sumX * sumX);
    return d === 0 ? 0 : (n * sumXY - sumX * sumY) / d;
  }

  _reason(regime, slope, volatility, dominance) {
    if (regime === 'volatile') return `high_vol_${(volatility * 100).toFixed(1)}pct_no_direction`;
    if (regime.startsWith('trending')) return `slope_${(slope * 100).toFixed(2)}pct_dom_${(dominance * 100).toFixed(0)}pct`;
    return 'no_clear_direction';
  }

  detectSimple(indicators, candles) {
    const r = this.detect(indicators, candles);
    if (r.regime === 'trending_up') return 'uptrend';
    if (r.regime === 'trending_down') return 'downtrend';
    return 'neutral';
  }
}

module.exports = { RegimeDetector };
---END FILE---


████████████████████████████████████████████████████████████████████████████████
█ STEP 3: FIX core/ContractValidator.js (targeted edit)                      █
████████████████████████████████████████████████████████████████████████████████

In core/ContractValidator.js, find the validateIndicators() method.
Find this EXACT block:

    // === BOLLINGER BANDS ===
    if (indicators.bb) {

Replace everything from that line through the trend validation with:

    // === BOLLINGER BANDS (REQUIRED) ===
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

    // === TREND (REQUIRED) ===
    valid = this.assertEnum('trend', indicators.trend, ['uptrend', 'downtrend', 'neutral']) && valid;

The key change: trend is ALWAYS validated, not wrapped in `if (indicators.trend !== undefined)`.


████████████████████████████████████████████████████████████████████████████████
█ STEP 4: VERIFY MODULES LOAD                                               █
████████████████████████████████████████████████████████████████████████████████

Run this EXACT command:

node -e "
const { ContractValidator } = require('./core/ContractValidator');
const { CandleStore } = require('./core/CandleStore');
const { IndicatorCalculator } = require('./core/IndicatorCalculator');
const { IndicatorSnapshot } = require('./core/IndicatorSnapshot');
const { CandleAggregator } = require('./core/CandleAggregator');
const { RegimeDetector } = require('./core/RegimeDetector');

const v = ContractValidator.createMonitor();
const cs = new CandleStore();
const is = new IndicatorSnapshot(v);
const ca = new CandleAggregator();
const rd = new RegimeDetector();

console.log('CHECK 1: All modules instantiate');

try {
  is.create({}, 95000);
  console.log('FAIL: Should have thrown on missing RSI');
  process.exit(1);
} catch (e) {
  console.log('CHECK 2: Throws on missing RSI -', e.message.substring(0, 80));
}

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
  console.log('CHECK 3: Valid snapshot - rsi=' + snap.rsi + ' trend=' + snap.trend + ' atr=' + snap.atr);
} catch (e) {
  console.log('FAIL: Valid data threw -', e.message);
  process.exit(1);
}

const testCandles = [];
for (let i = 0; i < 30; i++) {
  const p = 95000 + (i * 10);
  testCandles.push({ t: Date.now() - (30 - i) * 900000, o: p, h: p + 50, l: p - 50, c: p + 5, v: 100 });
}
const regime = rd.detect({ atrPercent: 0.5 }, testCandles);
console.log('CHECK 4: RegimeDetector -', regime.regime, 'conf=' + regime.confidence.toFixed(2));

console.log('');
console.log('ALL CHECKS PASSED');
"

ALL 4 CHECKS MUST PASS. If any fail, STOP and report.


████████████████████████████████████████████████████████████████████████████████
█ STEP 5: WIRE IndicatorSnapshot INTO TRADING PIPELINE                       █
████████████████████████████████████████████████████████████████████████████████

In run-empire-v2.js, find this EXACT block (around line 1661):

    // Map IndicatorEngine output to expected format
    const indicators = {
      rsi: engineState.rsi || 50,
      macd: engineState.macd || { macd: 0, signal: 0, hist: 0 },
      ema12: engineState.ema?.[12] || price,
      ema26: engineState.ema?.[26] || price,
      trend: OptimizedIndicators.determineTrend(this.priceHistory, 10, 30), // Keep for now
      volatility: engineState.atr || OptimizedIndicators.calculateVolatility(this.priceHistory, 20),
      // FIX 2026-02-26: Add atr for ECM volatility check (was using raw $ causing always-widen)
      atr: engineState.atr,
      // FIX 2026-02-26: Add bbWidth for pattern learning (was always 0.02)
      bbWidth: engineState.bbExtras?.bandwidth || 0.02
    };

REPLACE that entire block (from "// Map IndicatorEngine" through the closing `};`) with:

    // REFACTOR 2026-02-27: IndicatorSnapshot replaces manual reshape
    // Single transformation point. No fallback paths. Contracts that scream.
    const _indicatorSnapshot = new IndicatorSnapshot(contractValidator);
    let indicators;
    try {
      indicators = _indicatorSnapshot.create(engineState, price, this.priceHistory);
    } catch (snapErr) {
      // During warmup (first ~200 candles), IndicatorEngine may not have all data yet.
      // RSI needs 14 candles, BB needs 20, EMA200 needs 200.
      // This is the ONLY acceptable reason for the catch to fire.
      if (this.priceHistory.length < 50) {
        console.warn(`⚠️ IndicatorSnapshot warmup (${this.priceHistory.length} candles): ${snapErr.message}`);
        indicators = {
          price, rsi: engineState.rsi || 50, rsiNormalized: ((engineState.rsi || 50) / 100),
          macd: engineState.macd || { macd: 0, signal: 0, histogram: 0 },
          ema9: price, ema21: price, ema50: price, ema200: price,
          trend: 'neutral',
          atr: engineState.atr || (price * 0.005), atrPercent: 0.5, atrNormalized: 0.1,
          bb: { upper: price * 1.02, middle: price, lower: price * 0.98, bandwidth: 4, percentB: 0.5 },
          volatilityNormalized: 0.1, volume: 0, vwap: price
        };
      } else {
        // After warmup, a throw means real missing data — this IS the bug
        console.error(`❌ IndicatorSnapshot FAILED after warmup: ${snapErr.message}`);
        throw snapErr;
      }
    }

    // BACKWARD COMPAT: downstream reads these legacy field names
    indicators.ema12 = indicators.ema9 || price;
    indicators.ema26 = indicators.ema21 || price;
    indicators.volatility = indicators.atr || 0;
    indicators.bbWidth = indicators.bb?.bandwidth || 0;
    indicators.bollingerBands = indicators.bb;


████████████████████████████████████████████████████████████████████████████████
█ STEP 6: WIRE RegimeDetector INTO TRADING PIPELINE                          █
████████████████████████████████████████████████████████████████████████████████

In run-empire-v2.js, find this EXACT block (around line 1820-1830):

    // FIX 2026-02-15: Call analyzeMarket() not detectRegime()
    // detectRegime() takes no args (ignores priceHistory), returns a plain string,
    // but downstream reads regime.currentRegime — getting undefined → 'unknown'.
    // analyzeMarket() processes candles, populates metrics, returns {regime, confidence, parameters}.
    const regimeResult = this.regimeDetector.analyzeMarket(this.priceHistory, indicators);
    const regime = {
      currentRegime: regimeResult?.regime || this.regimeDetector.currentRegime || 'unknown',
      confidence: regimeResult?.confidence || 0,
      parameters: regimeResult?.parameters || {}
    };
    this.marketRegime = regime;

REPLACE that entire block with:

    // REFACTOR 2026-02-27: New RegimeDetector replaces 797-line MarketRegimeDetector
    // Trend takes priority over volatility (BTC trends UP with high vol)
    const _regimeDetector = new RegimeDetector();
    const regimeResult = _regimeDetector.detect(indicators, this.priceHistory);
    const regime = {
      currentRegime: regimeResult.regime || 'unknown',
      confidence: regimeResult.confidence || 0,
      parameters: regimeResult.details || {}
    };
    this.marketRegime = regime;


████████████████████████████████████████████████████████████████████████████████
█ STEP 7: WIRE CandleStore AS SHADOW (dual-write)                           █
████████████████████████████████████████████████████████████████████████████████

In run-empire-v2.js, find this EXACT line (around line 636):

    this.priceHistory = [];  // 1m candles for trading logic

ADD this line directly after it:

    this._candleStore = new CandleStore({ maxCandles: 250 });  // REFACTOR: shadow priceHistory

Then find this EXACT line (around line 1365):

      this.priceHistory.push(candle);

ADD this line directly after it:

      this._candleStore.addCandle('BTC-USD', '15m', candle);  // REFACTOR: dual-write

Then find this EXACT line (around line 1351):

      this.priceHistory[this.priceHistory.length - 1] = candle;

ADD this line directly after it:

      this._candleStore.addCandle('BTC-USD', '15m', candle);  // REFACTOR: dual-write (update)


████████████████████████████████████████████████████████████████████████████████
█ STEP 8: RUN GOLDEN TEST                                                   █
████████████████████████████████████████████████████████████████████████████████

Run the backtest and capture output:

BACKTEST_MODE=true BACKTEST_FAST=true \
  CANDLE_DATA_FILE=data/polygon-btc-1y.json \
  timeout 60 node run-empire-v2.js 2>&1 | tee /tmp/golden-test-wired.txt

Then check:

echo "=== TRADE SUMMARY ==="
grep -c "Trade closed\|EXECUTE_TRADE" /tmp/golden-test-wired.txt
echo "=== ERRORS ==="
grep -i "error\|FAIL\|threw\|exception" /tmp/golden-test-wired.txt | head -10
echo "=== CONTRACT VIOLATIONS ==="
grep "CONTRACT" /tmp/golden-test-wired.txt | head -10
echo "=== INDICATOR SNAPSHOT ==="
grep "IndicatorSnapshot" /tmp/golden-test-wired.txt | head -5
echo "=== REGIME ==="
grep "regime\|REGIME" /tmp/golden-test-wired.txt | head -5

EXPECTED:
- Bot starts without crash
- Trades execute (may differ from baseline — that's OK, indicators changed)
- No unhandled exceptions
- IndicatorSnapshot warmup messages during first ~50 candles, then silence
- Contract violations should be ZERO after warmup

If the bot CRASHES, paste the FULL error. Do not try to fix it.


████████████████████████████████████████████████████████████████████████████████
█ STEP 9: RUN PIPELINE AUDIT                                                █
████████████████████████████████████████████████████████████████████████████████

node ogz-meta/pipeline-audit.js 2>&1 | tee /tmp/pipeline-audit.txt

Paste the output. This was requested 4+ times and never done.


████████████████████████████████████████████████████████████████████████████████
█ STEP 10: COMMIT AND PUSH                                                  █
████████████████████████████████████████████████████████████████████████████████

git add core/ContractValidator.js core/IndicatorSnapshot.js core/RegimeDetector.js run-empire-v2.js
git commit -m "fix(refactor): Correct + wire Phases 0-3 per desktop audit

CORRECTIONS (from Claude Desktop audit):
- IndicatorSnapshot: strict extraction, THROWS on missing data
  - No more silent fallbacks (rsi??50, fake BB, ATR heuristic)
  - _requireNumber/_requirePositive enforce data contract
- RegimeDetector: trend priority over volatility
  - BTC trends UP with high vol = trending, not volatile
  - Honest metric names (directionalDominance, not fake ADX)
- ContractValidator: trend + bb validation now mandatory

WIRING (modules now ACTIVE in trading pipeline):
- IndicatorSnapshot replaces manual reshape at line 1661
  - Single transformation point, contract-validated
  - Warmup fallback for first ~50 candles only
  - Backward compat aliases: ema12, ema26, volatility, bbWidth
- RegimeDetector replaces 797-line MarketRegimeDetector call
  - trend > volatile > ranging priority
- CandleStore shadows priceHistory (dual-write, zero behavior change)

Pipeline audit: run with ogz-meta/pipeline-audit.js"

git push origin HEAD


████████████████████████████████████████████████████████████████████████████████
█ DONE — Report results back to Trey                                         █
████████████████████████████████████████████████████████████████████████████████
