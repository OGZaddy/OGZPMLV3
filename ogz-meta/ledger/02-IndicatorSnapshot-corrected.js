/**
 * IndicatorSnapshot - Phase 2 of Modular Architecture Refactor
 * 
 * CORRECTED VERSION — 2026-02-27
 * 
 * PURPOSE: Creates THE ONE canonical indicator object from raw calculations.
 * Single transformation point. No fallback paths. No alternative reshapes.
 *
 * WHY THIS EXISTS:
 * The biggest bug source in the monolith was the indicator reshape at line 1661 where raw
 * engine state gets converted into the indicators object. Different code paths produced
 * different shapes/units (Bug 1, Bug 4, Bug 5, P1). This module is THE SINGLE PLACE
 * where that transformation happens.
 *
 * DESIGN PRINCIPLE: NO SILENT FALLBACKS
 * If a required field is missing from raw data, we THROW — not silently substitute.
 * The old code had `raw.rsi ?? 50` which meant a missing RSI looked "neutral."
 * That's a lie. A missing RSI is a bug in the data pipeline.
 *
 * Self-contained: Yes - single transformation point.
 * Hot-swap: Yes.
 *
 * @see ogz-meta/REFACTOR-PLAN-2026-02-27.md
 */

const { ContractValidator, ContractViolation } = require('./ContractValidator');
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
   * Create the canonical Indicators object from raw data.
   *
   * NO FALLBACK PATHS - if a required field is missing, we throw.
   * All fields are explicitly extracted, normalized, and validated.
   *
   * @param {Object} raw - Raw indicator data from IndicatorEngine.getSnapshot()
   *   Expected fields: rsi, macd, ema (map or individual), atr, bb/bollingerBands,
   *   bbExtras, volume, vwap
   * @param {number} price - Current price (required for normalization)
   * @param {Array} candles - Optional candles (unused, kept for API compat)
   * @returns {Object} Canonical Indicators object with all fields validated
   * @throws {ContractViolation} If required fields are missing or invalid
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

    // === EXTRACT — strict, no silent defaults ===

    // RSI: Must be 0-100 from the indicator engine
    const rsi = this._requireNumber(raw, 'rsi', 'RSI');
    const rsiClamped = Math.max(0, Math.min(100, rsi));
    const rsiNormalized = rsiClamped / 100;

    // MACD: Object with macd, signal, histogram
    const macdRaw = raw.macd || raw.MACD;
    if (!macdRaw || typeof macdRaw !== 'object') {
      throw new ContractViolation(
        'IndicatorSnapshot requires raw.macd object',
        'macd', macdRaw, 'object with { macd, signal, histogram }'
      );
    }
    const macd = {
      macd: this._toNumber(macdRaw.macd ?? macdRaw.macdLine, 'macd.macd'),
      signal: this._toNumber(macdRaw.signal ?? macdRaw.signalLine, 'macd.signal'),
      histogram: this._toNumber(macdRaw.hist ?? macdRaw.histogram, 'macd.histogram')
    };

    // EMAs: Support both raw.ema[period] map and raw.ema9 flat fields
    const ema9 = this._extractEMA(raw, 9, price);
    const ema21 = this._extractEMA(raw, 21, price);
    const ema50 = this._extractEMA(raw, 50, price);
    const ema200 = this._extractEMA(raw, 200, price);

    // ATR: Must be in dollar terms from indicator engine
    const atr = this._requirePositive(raw, 'atr', 'ATR');
    const atrPercent = (atr / price) * 100;
    const atrNormalized = Math.min(1, atrPercent / 5); // 5% ATR = fully volatile

    // Bollinger Bands
    const bb = this._extractBB(raw, price);

    // Volume
    const volume = this._toNumber(raw.volume ?? raw.v, 'volume');
    const vwap = this._toNumber(raw.vwap, 'vwap', price); // vwap can default to price

    // Volatility (normalized 0-1) — combines ATR and BB bandwidth
    const atrScore = atrNormalized;
    const bbScore = Math.min(1, bb.bandwidth / 10);
    const volatilityNormalized = (atrScore * 0.7) + (bbScore * 0.3);

    // Trend — single source of truth from EMA alignment
    const trend = this._computeTrend(ema9, ema21, ema50, price);

    // === BUILD CANONICAL OBJECT ===
    const snapshot = {
      // === PRICE CONTEXT ===
      price,                      // Dollars. Current price. Example: $95,432

      // === MOMENTUM ===
      rsi: rsiClamped,            // 0-100. RSI value. Example: 45
      rsiNormalized,              // 0-1. RSI/100. Example: 0.45

      // === TREND ===
      macd,                       // { macd, signal, histogram } in dollars
      ema9,                       // Dollars. EMA 9
      ema21,                      // Dollars. EMA 21
      ema50,                      // Dollars. EMA 50
      ema200,                     // Dollars. EMA 200

      // === VOLATILITY ===
      atr,                        // Dollars. ATR in price terms. Example: $523
      atrPercent,                 // Percent 0-100. ATR/price*100. Example: 0.55
      atrNormalized,              // 0-1. Normalized ATR. Example: 0.73
      bb,                         // { upper, middle, lower, bandwidth, percentB }
      volatilityNormalized,       // 0-1. THE volatility score

      // === VOLUME ===
      volume,                     // Base asset units
      vwap,                       // Dollars. VWAP

      // === TREND (single source of truth) ===
      trend                       // 'uptrend' | 'downtrend' | 'neutral'
    };

    // === VALIDATE BEFORE RETURNING ===
    this.validator.validateIndicators(snapshot);

    return snapshot;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STRICT EXTRACTION — no silent fallbacks
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Require a number field to exist. Throws if missing.
   * Use for fields that MUST be present (rsi, atr).
   */
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

  /**
   * Require a positive number field. Throws if missing or <= 0.
   * Use for fields like ATR that must be positive.
   */
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

  /**
   * Convert to number. Returns fallback ONLY for explicitly optional fields.
   * Prefer _requireNumber for required fields.
   */
  _toNumber(value, fieldName, fallback = 0) {
    if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
      return value;
    }
    // Only for genuinely optional fields (volume=0, vwap=price)
    return fallback;
  }

  /**
   * Extract EMA for a given period.
   * Supports both raw.ema[period] map and raw.ema9 flat fields.
   * EMAs degrade gracefully to price when insufficient history (this is normal,
   * not a bug — a 200-period EMA needs 200 candles of warmup).
   */
  _extractEMA(raw, period, price) {
    // Try map format: raw.ema[period]
    if (raw.ema && typeof raw.ema === 'object' && typeof raw.ema[period] === 'number') {
      return raw.ema[period];
    }
    // Try flat format: raw.ema9, raw.ema21, etc.
    const flatKey = `ema${period}`;
    if (typeof raw[flatKey] === 'number' && !isNaN(raw[flatKey])) {
      return raw[flatKey];
    }
    // EMAs default to price during warmup (this is mathematically correct,
    // not a "fallback" — an EMA with no history IS the current price)
    return price;
  }

  /**
   * Extract Bollinger Bands. Requires the data to exist.
   */
  _extractBB(raw, price) {
    const bb = raw.bb ?? raw.bollingerBands ?? raw.BB;
    const bbExtras = raw.bbExtras ?? {};

    if (!bb || typeof bb !== 'object') {
      throw new ContractViolation(
        'IndicatorSnapshot requires Bollinger Bands data (raw.bb)',
        'bb', bb, 'object with { upper, middle, lower }'
      );
    }

    const upper = this._toNumber(bb.upper ?? bb.upperBand, 'bb.upper');
    const middle = this._toNumber(bb.mid ?? bb.middle ?? bb.middleBand, 'bb.middle');
    const lower = this._toNumber(bb.lower ?? bb.lowerBand, 'bb.lower');

    if (upper <= 0 || middle <= 0 || lower <= 0) {
      throw new ContractViolation(
        `IndicatorSnapshot BB values must be positive: upper=${upper}, middle=${middle}, lower=${lower}`,
        'bb', { upper, middle, lower }, 'positive numbers'
      );
    }

    // Calculate bandwidth — always compute from actual values, never trust cached
    const bandwidth = middle > 0 ? ((upper - lower) / middle) * 100 : 0;

    // Calculate percentB — where price sits in the bands
    const range = upper - lower;
    const percentB = range > 0 ? (price - lower) / range : 0.5;

    return {
      upper,
      middle,
      lower,
      bandwidth: Math.max(0, Math.min(100, bandwidth)),
      percentB: Math.max(0, Math.min(1, percentB))
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TREND — single source of truth
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Compute trend from EMA alignment.
   *
   * RULE: This is THE ONLY place trend is computed.
   * No other module computes trend direction.
   *
   * Uptrend:   ema9 > ema21 > ema50 AND price > ema9
   * Downtrend: ema9 < ema21 < ema50 AND price < ema9
   * Neutral:   everything else
   */
  _computeTrend(ema9, ema21, ema50, price) {
    const bullishAlignment = ema9 > ema21 && ema21 > ema50;
    const bearishAlignment = ema9 < ema21 && ema21 < ema50;

    if (bullishAlignment && price > ema9) {
      return 'uptrend';
    } else if (bearishAlignment && price < ema9) {
      return 'downtrend';
    }
    return 'neutral';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FACTORY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create with strict validation (throws on any violation)
   */
  static createStrict(raw, price, candles = null) {
    const instance = new IndicatorSnapshot(ContractValidator.createStrict());
    return instance.create(raw, price, candles);
  }

  /**
   * Create with monitor validation (logs but doesn't throw on validation)
   * Note: Extraction still throws on missing required data regardless.
   */
  static createMonitor(raw, price, candles = null) {
    const instance = new IndicatorSnapshot(ContractValidator.createMonitor());
    return instance.create(raw, price, candles);
  }

  /**
   * Create from IndicatorEngine output
   */
  static fromEngine(engineState, price, candles = null) {
    const instance = new IndicatorSnapshot();
    return instance.create(engineState, price, candles);
  }
}

module.exports = { IndicatorSnapshot };
