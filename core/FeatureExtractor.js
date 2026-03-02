/**
 * FeatureExtractor - Phase 4 of Modular Architecture Refactor
 *
 * PURPOSE: Pure function that extracts normalized feature vectors from indicators.
 * All features normalized to 0-1 range for consistent pattern matching.
 *
 * FEATURE VECTOR (9 elements):
 * [rsiNormalized, trendStrength, volatilityLevel, bbPosition, volumeProfile,
 *  priceAction, structureType, momentumScore, directionBias]
 *
 * @see ogz-meta/ledger/PHASES-4-14-EXTRACTION-ROADMAP.md
 */

const { c, o, h, l, v } = require('./CandleHelper');
const { ContractValidator } = require('./ContractValidator');

const validator = new ContractValidator({ throwOnViolation: false, logViolations: true });

/**
 * FeatureExtractor - Pure stateless feature extraction
 */
class FeatureExtractor {
  /**
   * Extract normalized feature vector from market data
   *
   * @param {Object} params - Input parameters
   * @param {Object} params.indicators - Canonical indicators from IndicatorSnapshot
   * @param {Array} params.candles - Price history candles
   * @param {Object} [params.lastTrade] - Previous trade for context
   * @returns {Object} { features: number[], labels: string[], raw: Object }
   */
  static extract({ indicators, candles, lastTrade = null }) {
    // CONTRACT: Validate inputs
    if (!indicators || typeof indicators !== 'object') {
      console.warn('[FeatureExtractor] Invalid indicators, using defaults');
      return this._defaultFeatures();
    }

    if (!candles || candles.length === 0) {
      console.warn('[FeatureExtractor] No candles provided, using defaults');
      return this._defaultFeatures();
    }

    const latestCandle = candles[candles.length - 1];
    const previousCandle = candles.length > 1 ? candles[candles.length - 2] : latestCandle;

    // ═══════════════════════════════════════════════════════════════════
    // FEATURE EXTRACTION — All normalized to 0-1
    // ═══════════════════════════════════════════════════════════════════

    // [0] RSI Zone: 0-1 (already normalized in IndicatorSnapshot)
    const rsiNormalized = indicators.rsiNormalized ?? (indicators.rsi / 100) ?? 0.5;

    // [1] Trend Strength: 0-1 (1 = strong uptrend, 0 = strong downtrend, 0.5 = neutral)
    const trendStrength = this._normalizeTrend(indicators.trend);

    // [2] Volatility Level: 0-1 (uses atrNormalized)
    const volatilityLevel = indicators.atrNormalized ?? indicators.volatilityNormalized ?? 0.5;

    // [3] BB Position: 0-1 (percentB from IndicatorSnapshot)
    const bbPosition = indicators.bb?.percentB ?? 0.5;

    // [4] Volume Profile: 0-1 (relative volume compared to average)
    const volumeProfile = this._normalizeVolume(candles);

    // [5] Price Action: 0-1 (wick ratio — body size relative to range)
    const priceAction = this._calculateWickRatio(latestCandle);

    // [6] Structure Type: 0-1 (price change momentum)
    const structureType = this._normalizeChange(latestCandle, previousCandle);

    // [7] Momentum Score: 0-1 (MACD delta normalized)
    const momentumScore = this._normalizeMacd(indicators.macd);

    // [8] Direction Bias: 0-1 (0.5 = neutral, 1 = long bias, 0 = short bias)
    const directionBias = this._normalizeDirection(lastTrade);

    const features = [
      rsiNormalized,
      trendStrength,
      volatilityLevel,
      bbPosition,
      volumeProfile,
      priceAction,
      structureType,
      momentumScore,
      directionBias
    ];

    // CONTRACT: Validate all features are 0-1
    const clampedFeatures = features.map((f, i) => {
      if (typeof f !== 'number' || isNaN(f)) {
        console.warn(`[FeatureExtractor] Feature ${i} is invalid: ${f}, using 0.5`);
        return 0.5;
      }
      return Math.max(0, Math.min(1, f));
    });

    return {
      features: clampedFeatures,
      labels: [
        'rsiNormalized',
        'trendStrength',
        'volatilityLevel',
        'bbPosition',
        'volumeProfile',
        'priceAction',
        'structureType',
        'momentumScore',
        'directionBias'
      ],
      raw: {
        rsi: indicators.rsi,
        trend: indicators.trend,
        atr: indicators.atr,
        bb: indicators.bb,
        macd: indicators.macd
      }
    };
  }

  /**
   * Extract features for pattern matching (backwards compatible)
   * Returns just the array for existing code compatibility
   */
  static extractArray({ indicators, candles, lastTrade = null }) {
    const result = this.extract({ indicators, candles, lastTrade });
    return result.features;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NORMALIZATION HELPERS — All outputs 0-1
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Normalize trend to 0-1 (0=strong down, 0.5=neutral, 1=strong up)
   */
  static _normalizeTrend(trend) {
    if (!trend || typeof trend !== 'string') return 0.5;

    const lower = trend.toLowerCase();
    if (lower === 'uptrend' || lower === 'bullish') return 0.85;
    if (lower === 'downtrend' || lower === 'bearish') return 0.15;
    return 0.5; // neutral/sideways
  }

  /**
   * Normalize volume relative to recent average
   */
  static _normalizeVolume(candles) {
    if (!candles || candles.length < 10) return 0.5;

    const volumes = candles.slice(-20).map(c => v(c) || 0).filter(vol => vol > 0);
    if (volumes.length === 0) return 0.5;

    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const latestVolume = v(candles[candles.length - 1]) || avgVolume;

    // Normalize: 0.5 = average, 0 = very low, 1 = very high (2x average)
    const ratio = latestVolume / avgVolume;
    return Math.min(1, Math.max(0, ratio / 2));
  }

  /**
   * Calculate wick ratio (body size vs total range)
   */
  static _calculateWickRatio(candle) {
    const high = h(candle);
    const low = l(candle);
    const open = o(candle);
    const close = c(candle);

    const range = high - low;
    if (range <= 0) return 0.5;

    const bodySize = Math.abs(close - open);
    return bodySize / range;
  }

  /**
   * Normalize price change to 0-1
   */
  static _normalizeChange(currentCandle, previousCandle) {
    const prevClose = c(previousCandle);
    const currClose = c(currentCandle);

    if (!prevClose || prevClose <= 0) return 0.5;

    const changePercent = (currClose - prevClose) / prevClose;
    // Map -5% to +5% range to 0-1 (0.5 = no change)
    return Math.min(1, Math.max(0, 0.5 + (changePercent * 10)));
  }

  /**
   * Normalize MACD delta to 0-1
   */
  static _normalizeMacd(macd) {
    if (!macd) return 0.5;

    const macdLine = macd.macd ?? macd.macdLine ?? 0;
    const signalLine = macd.signal ?? macd.signalLine ?? 0;
    const delta = macdLine - signalLine;

    // Typical MACD delta range is -500 to +500 for BTC
    // Normalize to 0-1 (0.5 = neutral)
    const normalized = 0.5 + (delta / 1000);
    return Math.min(1, Math.max(0, normalized));
  }

  /**
   * Normalize last trade direction to 0-1
   */
  static _normalizeDirection(lastTrade) {
    if (!lastTrade?.direction) return 0.5;

    const dir = lastTrade.direction.toLowerCase();
    if (dir === 'buy' || dir === 'long') return 0.75;
    if (dir === 'sell' || dir === 'short') return 0.25;
    return 0.5;
  }

  /**
   * Return default features when input is invalid
   */
  static _defaultFeatures() {
    return {
      features: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      labels: [
        'rsiNormalized',
        'trendStrength',
        'volatilityLevel',
        'bbPosition',
        'volumeProfile',
        'priceAction',
        'structureType',
        'momentumScore',
        'directionBias'
      ],
      raw: {}
    };
  }

  /**
   * Compute feature signature hash for pattern matching
   * Quantizes features to reduce noise
   */
  static computeSignature(features) {
    if (!Array.isArray(features) || features.length !== 9) {
      console.warn('[FeatureExtractor] Invalid features for signature');
      return 'INVALID';
    }

    // Quantize each feature to reduce noise (10 levels = 0.0 - 0.9)
    const quantized = features.map(f => Math.floor(f * 10) / 10);
    return quantized.join('-');
  }
}

module.exports = FeatureExtractor;
