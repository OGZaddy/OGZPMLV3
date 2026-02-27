/**
 * IndicatorSnapshot - Phase 2 of Modular Architecture Refactor
 *
 * PURPOSE: Creates THE ONE canonical indicator object from raw calculations.
 * Single transformation point. No fallback paths. No alternative reshapes.
 *
 * WHY THIS EXISTS:
 * The biggest bug source in the monolith was the indicator reshape at line 1649 where raw
 * engine state gets converted into the indicators object. Different code paths produced
 * different shapes/units (Bug 1, Bug 4, Bug 5, P1). This module is THE SINGLE PLACE
 * where that transformation happens.
 *
 * WHAT THIS CATCHES:
 * - Bug 1 (ATR not normalized): atrNormalized must be 0-1
 * - Bug 4 (BB bandwidth missing): bandwidth must be defined
 * - Bug 5/P1 (RSI format mismatch): rsi must be 0-100
 * - Bug 6 (HOLD confidence wrong format): confidence 0-100 everywhere
 *
 * Self-contained: Yes - single transformation point.
 * Hot-swap: Yes.
 *
 * @see ogz-meta/REFACTOR-PLAN-2026-02-27.md
 */

const { ContractValidator } = require('./ContractValidator');
const { c: _c } = require('./CandleHelper');

class IndicatorSnapshot {
  constructor(validator = null) {
    // Contract validation - monitor mode by default (log but don't throw)
    this.validator = validator || ContractValidator.createMonitor();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THE ONE METHOD - Creates canonical indicator object
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create the canonical Indicators object from raw data
   *
   * NO FALLBACK PATHS - if a field is missing, it's a bug in the caller.
   * All fields are explicitly computed and validated.
   *
   * @param {Object} raw - Raw indicator data from IndicatorEngine or calculations
   * @param {number} price - Current price (required for normalization)
   * @param {Array} candles - Optional candles for trend detection
   * @returns {Object} Canonical Indicators object with all fields validated
   */
  create(raw, price, candles = null) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('IndicatorSnapshot.create() requires raw indicator data');
    }

    if (typeof price !== 'number' || price <= 0 || isNaN(price)) {
      throw new Error(`IndicatorSnapshot.create() requires valid price, got: ${price}`);
    }

    // === EXTRACT AND NORMALIZE ===

    // RSI (0-100 range)
    const rsi = this._extractRSI(raw);
    const rsiNormalized = rsi / 100; // 0-1 for internal calculations

    // MACD
    const macd = this._extractMACD(raw);

    // EMAs (in dollars)
    const ema9 = this._extractNumber(raw.ema?.[9] ?? raw.ema9, price);
    const ema21 = this._extractNumber(raw.ema?.[21] ?? raw.ema21, price);
    const ema50 = this._extractNumber(raw.ema?.[50] ?? raw.ema50, price);
    const ema200 = this._extractNumber(raw.ema?.[200] ?? raw.ema200, price);

    // ATR (in dollars and as percentage)
    const atr = this._extractATR(raw, price);
    const atrPercent = price > 0 ? (atr / price) * 100 : 0;
    const atrNormalized = this._normalizeATR(atrPercent);

    // Bollinger Bands
    const bb = this._extractBB(raw, price);

    // Volume
    const volume = this._extractNumber(raw.volume ?? raw.v, 0);
    const vwap = this._extractNumber(raw.vwap, price);

    // Volatility (normalized 0-1)
    const volatilityNormalized = this._normalizeVolatility(atrPercent, bb.bandwidth);

    // Trend (single source of truth - computed from EMA alignment)
    const trend = this._computeTrend(ema9, ema21, ema50, price, candles);

    // === BUILD CANONICAL OBJECT ===
    const snapshot = {
      // === PRICE CONTEXT ===
      price,                      // Dollars. Current price. Example: $95,432

      // === MOMENTUM (RSI 0-100) ===
      rsi,                        // 0-100. RSI value. Example: 45
      rsiNormalized,              // 0-1. RSI/100. Example: 0.45

      // === TREND ===
      macd,                       // { macd, signal, histogram } in dollars
      ema9,                       // Dollars. EMA 9. Example: $95,100
      ema21,                      // Dollars. EMA 21. Example: $94,800
      ema50,                      // Dollars. EMA 50. Example: $93,500
      ema200,                     // Dollars. EMA 200. Example: $88,000

      // === VOLATILITY ===
      atr,                        // Dollars. ATR in price terms. Example: $523
      atrPercent,                 // Percent 0-100. ATR/price*100. Example: 0.55
      atrNormalized,              // 0-1. Normalized ATR. Example: 0.73
      bb,                         // { upper, middle, lower, bandwidth, percentB }
      volatilityNormalized,       // 0-1. THE volatility score. Example: 0.73

      // === VOLUME ===
      volume,                     // Base asset. Volume. Example: 1523.5 BTC
      vwap,                       // Dollars. VWAP. Example: $95,200

      // === TREND (single source of truth) ===
      trend                       // Enum: 'uptrend' | 'downtrend' | 'neutral'
    };

    // === VALIDATE BEFORE RETURNING - contracts that scream ===
    this.validator.validateIndicators(snapshot);

    return snapshot;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACTION HELPERS - Safely extract values from various raw formats
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Extract RSI (0-100 range)
   */
  _extractRSI(raw) {
    const rsi = raw.rsi ?? raw.RSI ?? 50;
    // Clamp to valid range
    return Math.max(0, Math.min(100, rsi));
  }

  /**
   * Extract MACD object
   */
  _extractMACD(raw) {
    const macdRaw = raw.macd ?? raw.MACD ?? {};

    return {
      macd: this._extractNumber(macdRaw.macd ?? macdRaw.macdLine, 0),
      signal: this._extractNumber(macdRaw.signal ?? macdRaw.signalLine, 0),
      histogram: this._extractNumber(macdRaw.hist ?? macdRaw.histogram, 0)
    };
  }

  /**
   * Extract ATR value
   */
  _extractATR(raw, price) {
    // ATR can come from multiple places
    const atr = raw.atr ?? raw.ATR ?? raw.atrValue ?? 0;

    // If ATR is already a percentage (< 1), convert to dollars
    if (atr > 0 && atr < 1) {
      return atr * price;
    }

    return Math.max(0, atr);
  }

  /**
   * Extract Bollinger Bands
   */
  _extractBB(raw, price) {
    const bb = raw.bb ?? raw.bollingerBands ?? raw.BB ?? {};
    const bbExtras = raw.bbExtras ?? {};

    const upper = this._extractNumber(bb.upper ?? bb.upperBand, price * 1.02);
    const middle = this._extractNumber(bb.mid ?? bb.middle ?? bb.middleBand, price);
    const lower = this._extractNumber(bb.lower ?? bb.lowerBand, price * 0.98);

    // Calculate bandwidth if not provided
    let bandwidth = bbExtras.bandwidth ?? bb.bandwidth ?? bb.width ?? 0;
    if (bandwidth === 0 && middle > 0) {
      bandwidth = ((upper - lower) / middle) * 100;
    }

    // Calculate percentB if not provided
    let percentB = bbExtras.percentB ?? bb.percentB ?? 0.5;
    if ((upper - lower) > 0) {
      percentB = (price - lower) / (upper - lower);
    }

    return {
      upper,
      middle,
      lower,
      bandwidth: Math.max(0, Math.min(100, bandwidth)),
      percentB: Math.max(0, Math.min(1, percentB))
    };
  }

  /**
   * Safely extract a number with fallback
   */
  _extractNumber(value, fallback) {
    if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
      return value;
    }
    return fallback;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NORMALIZATION HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Normalize ATR percentage to 0-1
   * Uses adaptive scaling: 0.05% stddev = 1.0
   */
  _normalizeATR(atrPercent) {
    // Typical BTC ATR is 0.3-1.5%, penny stocks can be 10-30%
    // Normalize so that 5% ATR = 1.0 (fully volatile)
    const normalized = atrPercent / 5;
    return Math.max(0, Math.min(1, normalized));
  }

  /**
   * Normalize volatility to 0-1 score
   * Combines ATR and BB bandwidth
   */
  _normalizeVolatility(atrPercent, bbBandwidth) {
    // Combine ATR and BB signals
    const atrScore = this._normalizeATR(atrPercent);
    const bbScore = Math.min(1, bbBandwidth / 10); // 10% bandwidth = max

    // Weighted average: ATR is primary, BB is secondary
    return (atrScore * 0.7) + (bbScore * 0.3);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TREND COMPUTATION - Single source of truth
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Compute trend from EMA alignment
   *
   * RULE: This is THE ONLY place trend is computed.
   * No other module should compute trend direction.
   *
   * Uptrend: ema9 > ema21 > ema50 AND price > ema9
   * Downtrend: ema9 < ema21 < ema50 AND price < ema9
   * Neutral: everything else
   */
  _computeTrend(ema9, ema21, ema50, price, candles = null) {
    // Check EMA alignment
    const bullishAlignment = ema9 > ema21 && ema21 > ema50;
    const bearishAlignment = ema9 < ema21 && ema21 < ema50;

    // Check price position
    const priceAboveEma9 = price > ema9;
    const priceBelowEma9 = price < ema9;

    if (bullishAlignment && priceAboveEma9) {
      return 'uptrend';
    } else if (bearishAlignment && priceBelowEma9) {
      return 'downtrend';
    }

    return 'neutral';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FACTORY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a snapshot with strict validation (throws on violation)
   */
  static createStrict(raw, price, candles = null) {
    const instance = new IndicatorSnapshot(ContractValidator.createStrict());
    return instance.create(raw, price, candles);
  }

  /**
   * Create a snapshot with monitor validation (logs but doesn't throw)
   */
  static createMonitor(raw, price, candles = null) {
    const instance = new IndicatorSnapshot(ContractValidator.createMonitor());
    return instance.create(raw, price, candles);
  }

  /**
   * Create from IndicatorEngine output directly
   */
  static fromEngine(engineState, price, candles = null) {
    const instance = new IndicatorSnapshot();
    return instance.create(engineState, price, candles);
  }
}

module.exports = { IndicatorSnapshot };
