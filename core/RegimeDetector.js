/**
 * RegimeDetector - Phase 3 of Modular Architecture Refactor
 *
 * PURPOSE: Detects market regime (trending, ranging, volatile). Pure function.
 *
 * Self-contained: Yes - takes indicators, returns regime string.
 * Hot-swap: Yes - can swap detection algorithm.
 *
 * REGIMES:
 * - trending_up: Strong directional upward movement
 * - trending_down: Strong directional downward movement
 * - ranging: Sideways consolidation
 * - volatile: High volatility, unclear direction
 *
 * @see ogz-meta/REFACTOR-PLAN-2026-02-27.md
 */

const { c: _c, h: _h, l: _l } = require('./CandleHelper');

class RegimeDetector {
  constructor(config = {}) {
    this.config = {
      // Trend strength threshold (total movement over lookback as % of price)
      trendThreshold: config.trendThreshold || 0.005,     // 0.5% movement = trending
      strongTrendThreshold: config.strongTrendThreshold || 0.015, // 1.5% = strong trend

      // Volatility thresholds (ATR as % of price)
      volatilityThreshold: config.volatilityThreshold || 0.012,  // 1.2% ATR = high volatility

      // Lookback periods
      trendLookback: config.trendLookback || 20,    // Candles to analyze for trend
      volatilityLookback: config.volatilityLookback || 14,  // Candles for volatility

      ...config
    };
  }

  /**
   * Detect market regime from indicators and candles
   *
   * @param {Object} indicators - Canonical indicators from IndicatorSnapshot
   * @param {Array} candles - Recent candles for analysis
   * @returns {Object} { regime, confidence, details }
   */
  detect(indicators, candles) {
    if (!candles || candles.length < 10) {
      return {
        regime: 'ranging',
        confidence: 0,
        details: {
          adx: 0,
          trendStrength: 0,
          volatility: 0,
          reason: 'insufficient_data'
        }
      };
    }

    // === CALCULATE METRICS ===
    const trendMetrics = this._calculateTrend(candles);
    const volatility = this._calculateVolatility(candles, indicators);
    const adx = this._calculateADX(candles);

    // === DETECT REGIME ===
    const { regime, confidence } = this._detectRegime(
      trendMetrics.slope,
      trendMetrics.consistency,
      volatility,
      adx
    );

    return {
      regime,
      confidence,
      details: {
        adx,
        trendStrength: Math.abs(trendMetrics.slope),
        trendDirection: trendMetrics.slope > 0 ? 1 : trendMetrics.slope < 0 ? -1 : 0,
        trendConsistency: trendMetrics.consistency,
        volatility,
        reason: this._getReasonString(regime, trendMetrics.slope, volatility, adx)
      }
    };
  }

  /**
   * Calculate trend metrics from candles
   * @private
   */
  _calculateTrend(candles) {
    const lookback = Math.min(this.config.trendLookback, candles.length);
    const recent = candles.slice(-lookback);

    // Linear regression slope of closes
    const closes = recent.map(c => _c(c));
    const slope = this._linearRegressionSlope(closes);

    // Normalize slope as TOTAL movement over lookback period (percentage of price)
    // slope is per-candle, multiply by lookback to get total movement
    const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
    const normalizedSlope = avgPrice > 0 ? (slope * lookback) / avgPrice : 0;

    // Trend consistency: how many candles moved in same direction as slope
    let consistent = 0;
    for (let i = 1; i < closes.length; i++) {
      const move = closes[i] - closes[i - 1];
      if ((slope > 0 && move > 0) || (slope < 0 && move < 0)) {
        consistent++;
      }
    }
    const consistency = closes.length > 1 ? consistent / (closes.length - 1) : 0;

    return {
      slope: normalizedSlope,
      consistency
    };
  }

  /**
   * Calculate volatility (ATR as % of price)
   * @private
   */
  _calculateVolatility(candles, indicators) {
    // Use indicators if available
    if (indicators && typeof indicators.atrPercent === 'number') {
      return indicators.atrPercent / 100; // Convert from 0-100 to 0-1
    }

    // Calculate manually
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
   * Calculate simplified ADX (Average Directional Index)
   * @private
   */
  _calculateADX(candles) {
    const lookback = Math.min(14, candles.length);
    const recent = candles.slice(-lookback);

    if (recent.length < 3) return 0;

    // Simplified: Count how many candles are "directional"
    let upMoves = 0;
    let downMoves = 0;
    let totalMoves = 0;

    for (let i = 1; i < recent.length; i++) {
      const high = _h(recent[i]);
      const low = _l(recent[i]);
      const prevHigh = _h(recent[i - 1]);
      const prevLow = _l(recent[i - 1]);

      const upMove = high - prevHigh;
      const downMove = prevLow - low;

      if (upMove > downMove && upMove > 0) {
        upMoves++;
      } else if (downMove > upMove && downMove > 0) {
        downMoves++;
      }
      totalMoves++;
    }

    // ADX-like: how dominant is the main direction?
    const dominance = totalMoves > 0
      ? Math.abs(upMoves - downMoves) / totalMoves
      : 0;

    // Scale to 0-100
    return dominance * 100;
  }

  /**
   * Linear regression slope
   * @private
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

    const denominator = (n * sumX2 - sumX * sumX);
    if (denominator === 0) return 0;

    return (n * sumXY - sumX * sumY) / denominator;
  }

  /**
   * Detect regime from metrics
   * @private
   */
  _detectRegime(slope, consistency, volatility, adx) {
    const absSlope = Math.abs(slope);

    // High volatility overrides trend detection
    if (volatility > this.config.volatilityThreshold) {
      return {
        regime: 'volatile',
        confidence: Math.min(1, volatility / (this.config.volatilityThreshold * 2))
      };
    }

    // Strong trend with consistency
    if (absSlope > this.config.strongTrendThreshold && consistency > 0.6) {
      return {
        regime: slope > 0 ? 'trending_up' : 'trending_down',
        confidence: Math.min(1, (consistency + adx / 100) / 2)
      };
    }

    // Moderate trend
    if (absSlope > this.config.trendThreshold && consistency > 0.5) {
      return {
        regime: slope > 0 ? 'trending_up' : 'trending_down',
        confidence: Math.min(1, (consistency + adx / 100) / 2) * 0.8
      };
    }

    // Default: ranging
    return {
      regime: 'ranging',
      confidence: 1 - Math.min(1, absSlope / this.config.trendThreshold)
    };
  }

  /**
   * Get human-readable reason
   * @private
   */
  _getReasonString(regime, slope, volatility, adx) {
    const parts = [];

    if (regime === 'volatile') {
      parts.push(`high_volatility_${(volatility * 100).toFixed(1)}pct`);
    } else if (regime.startsWith('trending')) {
      parts.push(`slope_${(slope * 100).toFixed(2)}pct`);
      parts.push(`adx_${adx.toFixed(0)}`);
    } else {
      parts.push('no_clear_direction');
    }

    return parts.join('_');
  }

  /**
   * Get simple regime string (for backward compatibility)
   *
   * Maps to: 'uptrend' | 'downtrend' | 'neutral'
   * @param {Object} indicators - Canonical indicators
   * @param {Array} candles - Recent candles
   * @returns {string} Simple regime string
   */
  detectSimple(indicators, candles) {
    const result = this.detect(indicators, candles);

    switch (result.regime) {
      case 'trending_up':
        return 'uptrend';
      case 'trending_down':
        return 'downtrend';
      default:
        return 'neutral';
    }
  }
}

module.exports = { RegimeDetector };
