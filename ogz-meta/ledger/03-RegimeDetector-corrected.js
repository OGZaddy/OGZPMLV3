/**
 * RegimeDetector - Phase 3 of Modular Architecture Refactor
 * 
 * CORRECTED VERSION — 2026-02-27
 *
 * PURPOSE: Detects market regime (trending, ranging, volatile). Pure function.
 *
 * Self-contained: Yes - takes indicators + candles, returns regime.
 * Hot-swap: Yes - can swap detection algorithm.
 *
 * REGIMES:
 * - trending_up:   Strong directional upward movement
 * - trending_down:  Strong directional downward movement
 * - ranging:        Sideways consolidation, low directional movement
 * - volatile:       High volatility WITHOUT clear trend direction
 *
 * DESIGN DECISIONS:
 * 1. Trend takes priority over volatility. BTC regularly trends WITH high volatility.
 *    A market trending up 5% with 3% ATR is "trending_up", not "volatile."
 *    "Volatile" means high ATR but NO clear direction — choppy, whipsawing.
 *
 * 2. No fake ADX. The directional metric is called "directionalDominance" — 
 *    it measures what fraction of candles move in the dominant direction.
 *    It is NOT ADX and doesn't pretend to be.
 *
 * 3. Thresholds are configurable. The defaults are reasonable for BTC 15-minute
 *    candles but should be tuned per asset class.
 *
 * @see ogz-meta/REFACTOR-PLAN-2026-02-27.md
 */

const { c: _c, h: _h, l: _l } = require('./CandleHelper');

class RegimeDetector {
  constructor(config = {}) {
    this.config = {
      // Trend: total price movement over lookback as fraction of price
      // 0.5% over 20 candles (5 hours on 15m) = trending
      trendThreshold: config.trendThreshold || 0.005,
      strongTrendThreshold: config.strongTrendThreshold || 0.015,

      // Volatility: ATR as fraction of price
      // 1.2% ATR on 15m candles = elevated volatility for BTC
      volatilityThreshold: config.volatilityThreshold || 0.012,

      // Lookback periods (in candles)
      trendLookback: config.trendLookback || 20,
      volatilityLookback: config.volatilityLookback || 14,

      // Minimum consistency to classify as trending (fraction of candles in same direction)
      minTrendConsistency: config.minTrendConsistency || 0.5
    };
  }

  /**
   * Detect market regime from indicators and candles.
   *
   * @param {Object} indicators - Canonical indicators from IndicatorSnapshot
   *   Used for: atrPercent (if available, avoids recomputation)
   * @param {Array} candles - Recent candles for slope/consistency analysis
   * @returns {Object} { regime, confidence, details }
   */
  detect(indicators, candles) {
    if (!candles || candles.length < 10) {
      return {
        regime: 'ranging',
        confidence: 0,
        details: {
          directionalDominance: 0,
          trendStrength: 0,
          volatility: 0,
          reason: 'insufficient_data'
        }
      };
    }

    // === CALCULATE METRICS ===
    const trend = this._measureTrend(candles);
    const volatility = this._measureVolatility(candles, indicators);
    const directionalDominance = this._measureDirectionalDominance(candles);

    // === CLASSIFY REGIME ===
    // PRIORITY: trend first, then volatile (no-direction + high-vol), then ranging
    const { regime, confidence } = this._classify(
      trend.slope,
      trend.consistency,
      volatility,
      directionalDominance
    );

    return {
      regime,
      confidence,
      details: {
        directionalDominance,           // 0-1. How dominant is the main direction
        trendStrength: Math.abs(trend.slope),  // 0+. Absolute slope as fraction of price
        trendDirection: trend.slope > 0 ? 1 : trend.slope < 0 ? -1 : 0,
        trendConsistency: trend.consistency,   // 0-1. Fraction of candles in slope direction
        volatility,                     // 0+. ATR as fraction of price
        reason: this._reason(regime, trend.slope, volatility, directionalDominance)
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // METRICS — each measures one thing
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Measure trend: slope of price movement and directional consistency.
   * Returns slope as fraction of price (positive = up, negative = down)
   * and consistency as fraction of candles moving with the slope.
   */
  _measureTrend(candles) {
    const lookback = Math.min(this.config.trendLookback, candles.length);
    const recent = candles.slice(-lookback);
    const closes = recent.map(c => _c(c));

    // Linear regression slope (dollars per candle)
    const slope = this._linearRegressionSlope(closes);

    // Normalize: total movement over lookback as fraction of average price
    const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
    const normalizedSlope = avgPrice > 0 ? (slope * lookback) / avgPrice : 0;

    // Consistency: what fraction of candles moved in the slope's direction?
    let consistent = 0;
    for (let i = 1; i < closes.length; i++) {
      const move = closes[i] - closes[i - 1];
      if ((slope > 0 && move > 0) || (slope < 0 && move < 0)) {
        consistent++;
      }
    }
    const consistency = closes.length > 1 ? consistent / (closes.length - 1) : 0;

    return { slope: normalizedSlope, consistency };
  }

  /**
   * Measure volatility: ATR as fraction of price.
   * Uses IndicatorSnapshot's atrPercent if available (already computed correctly).
   * Falls back to manual computation from candles.
   */
  _measureVolatility(candles, indicators) {
    // Prefer IndicatorSnapshot's already-validated value
    if (indicators && typeof indicators.atrPercent === 'number' && indicators.atrPercent > 0) {
      return indicators.atrPercent / 100; // Convert percent (0-100) to fraction (0-1)
    }

    // Manual computation
    const lookback = Math.min(this.config.volatilityLookback, candles.length);
    const recent = candles.slice(-lookback);

    if (recent.length < 2) return 0;

    let atrSum = 0;
    for (let i = 1; i < recent.length; i++) {
      const high = _h(recent[i]);
      const low = _l(recent[i]);
      const prevClose = _c(recent[i - 1]);

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      atrSum += tr;
    }

    const atr = atrSum / (recent.length - 1);
    const avgPrice = recent.reduce((sum, c) => sum + _c(c), 0) / recent.length;

    return avgPrice > 0 ? atr / avgPrice : 0;
  }

  /**
   * Measure directional dominance: how one-sided is the movement?
   * NOT ADX. This counts what fraction of candles expand in the dominant direction.
   * Returns 0-1 where 1 = all candles move one way, 0 = perfectly balanced.
   */
  _measureDirectionalDominance(candles) {
    const lookback = Math.min(14, candles.length);
    const recent = candles.slice(-lookback);

    if (recent.length < 3) return 0;

    let upMoves = 0;
    let downMoves = 0;

    for (let i = 1; i < recent.length; i++) {
      const high = _h(recent[i]);
      const low = _l(recent[i]);
      const prevHigh = _h(recent[i - 1]);
      const prevLow = _l(recent[i - 1]);

      const upExpansion = high - prevHigh;
      const downExpansion = prevLow - low;

      if (upExpansion > downExpansion && upExpansion > 0) {
        upMoves++;
      } else if (downExpansion > upExpansion && downExpansion > 0) {
        downMoves++;
      }
    }

    const total = recent.length - 1;
    return total > 0 ? Math.abs(upMoves - downMoves) / total : 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLASSIFICATION — trend takes priority over volatility
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Classify regime from metrics.
   * 
   * PRIORITY ORDER:
   * 1. Strong trend + consistency → trending (even if volatile)
   * 2. Moderate trend + consistency → trending
   * 3. High volatility + NO trend → volatile (choppy/whipsaw)
   * 4. Default → ranging
   * 
   * This is different from Claude Code's version which let volatile override trend.
   * BTC regularly trends UP with high volatility. That's "trending_up", not "volatile."
   */
  _classify(slope, consistency, volatility, dominance) {
    const absSlope = Math.abs(slope);

    // 1. Strong trend with consistency — always wins
    if (absSlope > this.config.strongTrendThreshold && consistency > 0.6) {
      return {
        regime: slope > 0 ? 'trending_up' : 'trending_down',
        confidence: Math.min(1, (consistency * 0.6 + dominance * 0.4))
      };
    }

    // 2. Moderate trend with consistency
    if (absSlope > this.config.trendThreshold && consistency > this.config.minTrendConsistency) {
      return {
        regime: slope > 0 ? 'trending_up' : 'trending_down',
        confidence: Math.min(1, (consistency * 0.6 + dominance * 0.4)) * 0.8
      };
    }

    // 3. High volatility WITHOUT trend = choppy/whipsaw
    if (volatility > this.config.volatilityThreshold && absSlope < this.config.trendThreshold) {
      return {
        regime: 'volatile',
        confidence: Math.min(1, volatility / (this.config.volatilityThreshold * 2))
      };
    }

    // 4. Default: ranging
    return {
      regime: 'ranging',
      confidence: 1 - Math.min(1, absSlope / this.config.trendThreshold)
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MATH
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Linear regression slope of a value series.
   * Returns dollars-per-index (multiply by count to get total movement).
   */
  _linearRegressionSlope(values) {
    const n = values.length;
    if (n < 2) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }

    const denom = (n * sumX2 - sumX * sumX);
    if (denom === 0) return 0;

    return (n * sumXY - sumX * sumY) / denom;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REASON STRING
  // ═══════════════════════════════════════════════════════════════════════════

  _reason(regime, slope, volatility, dominance) {
    if (regime === 'volatile') {
      return `high_vol_${(volatility * 100).toFixed(1)}pct_no_direction`;
    }
    if (regime.startsWith('trending')) {
      return `slope_${(slope * 100).toFixed(2)}pct_dom_${(dominance * 100).toFixed(0)}pct`;
    }
    return 'no_clear_direction';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BACKWARD COMPATIBILITY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Simple regime detection returning 'uptrend' | 'downtrend' | 'neutral'
   * For backward compatibility with code expecting the old trend strings.
   */
  detectSimple(indicators, candles) {
    const result = this.detect(indicators, candles);
    switch (result.regime) {
      case 'trending_up': return 'uptrend';
      case 'trending_down': return 'downtrend';
      default: return 'neutral';
    }
  }
}

module.exports = { RegimeDetector };
