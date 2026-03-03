/**
 * PositionSizer - Position Size Calculator
 *
 * Phase 13: Extracted from run-empire-v2.js executeTrade BUY path
 *
 * SINGLE RESPONSIBILITY: Calculate optimal position size based on:
 * - Account balance
 * - Risk parameters
 * - Confidence level
 * - Kelly criterion (optional)
 *
 * @module core/PositionSizer
 */

'use strict';

const TradingConfig = require('./TradingConfig');
const FeatureFlagManager = require('./FeatureFlagManager');

const flagManager = FeatureFlagManager.getInstance();

class PositionSizer {
  constructor(options = {}) {
    this.maxPositionPercent = options.maxPositionPercent || TradingConfig.get('positionSizing.maxPositionSize');
    this.minPositionPercent = options.minPositionPercent || 0.01; // 1% minimum
    this.useKelly = options.useKelly || false;

    console.log('[PositionSizer] Initialized (Phase 13)');
  }

  /**
   * Calculate position size in base currency (e.g., BTC)
   *
   * @param {Object} params
   * @param {number} params.balance - Account balance in USD
   * @param {number} params.price - Current asset price
   * @param {number} params.confidence - Trade confidence (0-100 or 0-1)
   * @param {Object} [params.flags] - Feature flags context
   * @returns {Object} { sizeUSD, sizeBase, percentOfBalance, multiplier }
   */
  calculate(params) {
    const { balance, price, confidence, flags = {} } = params;

    if (!balance || balance <= 0) {
      console.warn('[PositionSizer] Invalid balance:', balance);
      return this._zeroResult();
    }

    if (!price || price <= 0) {
      console.warn('[PositionSizer] Invalid price:', price);
      return this._zeroResult();
    }

    // Start with base position size
    let positionPercent = this.maxPositionPercent;

    // Apply confidence-based scaling
    const confidenceMultiplier = this._calculateConfidenceMultiplier(confidence);
    positionPercent *= confidenceMultiplier;

    // Apply aggressive learning mode if enabled
    if (flagManager.isEnabled('AGGRESSIVE_LEARNING_MODE')) {
      const learningMultiplier = flagManager.getSetting('AGGRESSIVE_LEARNING_MODE', 'positionSizeMultiplier', 2.0);
      positionPercent *= learningMultiplier;
      console.log(`[PositionSizer] Aggressive learning: ${learningMultiplier}x`);
    }

    // Clamp to min/max bounds
    positionPercent = Math.max(this.minPositionPercent, Math.min(positionPercent, this.maxPositionPercent * 3)); // Allow up to 3x max for high confidence

    // Calculate sizes
    const sizeUSD = balance * positionPercent;
    const sizeBase = sizeUSD / price;

    return {
      sizeUSD,
      sizeBase,
      percentOfBalance: positionPercent,
      multiplier: confidenceMultiplier,
      breakdown: {
        basePercent: this.maxPositionPercent,
        confidenceMultiplier,
        finalPercent: positionPercent
      }
    };
  }

  /**
   * Calculate confidence-based position multiplier
   * 50% confidence = 0.5x, 75% = 1.5x, 90%+ = 2.5x (cap)
   *
   * @param {number} confidence - Confidence (0-100 or 0-1)
   * @returns {number} Multiplier (0.5 to 2.5)
   */
  _calculateConfidenceMultiplier(confidence) {
    // Normalize confidence to 0-1 range
    const normalizedConfidence = confidence > 1 ? confidence / 100 : confidence;

    // Linear scale: confidence 0.5 -> multiplier 0.5, confidence 1.0 -> multiplier 2.5
    const multiplier = 0.5 + (normalizedConfidence - 0.5) * 4.0;

    return Math.max(0.5, Math.min(2.5, multiplier));
  }

  /**
   * Apply pattern-based adjustment (wrapper for tradingOptimizations)
   *
   * @param {number} baseSize - Base position size
   * @param {Array} patterns - Active patterns
   * @param {Object} tradingOptimizations - TradingOptimizations instance
   * @param {Object} decisionContext - Decision context
   * @returns {number} Adjusted position size
   */
  applyPatternAdjustment(baseSize, patterns, tradingOptimizations, decisionContext) {
    if (!tradingOptimizations || !patterns?.length) {
      return baseSize;
    }

    const patternIds = patterns.map(p => p.id || p.signature || p.name || 'unknown');
    return tradingOptimizations.calculatePositionSize(baseSize, patternIds, decisionContext);
  }

  /**
   * Calculate Kelly criterion position size (optional)
   *
   * @param {number} winRate - Historical win rate (0-1)
   * @param {number} avgWin - Average win amount
   * @param {number} avgLoss - Average loss amount
   * @returns {number} Kelly fraction (0-1)
   */
  calculateKelly(winRate, avgWin, avgLoss) {
    if (!this.useKelly || avgLoss === 0) {
      return this.maxPositionPercent;
    }

    // Kelly formula: f = (p * b - q) / b
    // where p = win probability, q = lose probability, b = win/loss ratio
    const p = winRate;
    const q = 1 - winRate;
    const b = Math.abs(avgWin / avgLoss);

    const kelly = (p * b - q) / b;

    // Use half-Kelly for safety
    const halfKelly = kelly / 2;

    // Clamp to reasonable bounds
    return Math.max(0, Math.min(halfKelly, this.maxPositionPercent));
  }

  /**
   * Return zero result for invalid inputs
   */
  _zeroResult() {
    return {
      sizeUSD: 0,
      sizeBase: 0,
      percentOfBalance: 0,
      multiplier: 0,
      breakdown: { basePercent: 0, confidenceMultiplier: 0, finalPercent: 0 }
    };
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return {
      maxPositionPercent: this.maxPositionPercent,
      minPositionPercent: this.minPositionPercent,
      useKelly: this.useKelly
    };
  }
}

module.exports = PositionSizer;
