/**
 * DynamicPositionSizer - Intelligent Position Sizing
 * ===================================================
 *
 * Formula:
 *   size = baseSize × patternMultiplier × confidenceMultiplier × volatilityMultiplier
 *
 * Where:
 *   - baseSize = account × BASE_POSITION_SIZE (default 1%)
 *   - patternMultiplier = from UnifiedPatternMemory win rate
 *     (unknown = 1.0x, promoted = 1.5x, quarantined = 0x)
 *   - confidenceMultiplier = from orchResult.confidence
 *     (50% = 0.5x, 75% = 1.5x, 90%+ = 2.5x)
 *   - volatilityMultiplier = ATR-based
 *     (low vol = 1.5x, normal = 1.0x, high vol = 0.6x)
 *   - Cap at MAX_POSITION_SIZE (default 5%)
 *
 * All multiplier ranges configurable via .env
 */

const TradingConfig = require('./TradingConfig');

// ═══════════════════════════════════════════════════════════════
// ENV CONFIG WITH DEFAULTS
// ═══════════════════════════════════════════════════════════════

const env = (key, defaultVal) => {
  const val = process.env[key];
  if (val === undefined) return defaultVal;
  return parseFloat(val);
};

const CONFIG = {
  // Base sizing
  BASE_POSITION_SIZE: env('BASE_POSITION_SIZE', 0.01),      // 1% of account
  MAX_POSITION_SIZE: env('MAX_POSITION_SIZE', 0.05),        // 5% max cap
  MIN_POSITION_SIZE: env('MIN_POSITION_SIZE', 0.001),       // 0.1% min

  // Pattern multipliers
  PATTERN_UNKNOWN_MULT: env('PATTERN_UNKNOWN_MULT', 1.0),   // Unknown pattern
  PATTERN_PROMOTED_MULT: env('PATTERN_PROMOTED_MULT', 1.5), // Promoted (high WR)
  PATTERN_QUARANTINED_MULT: env('PATTERN_QUARANTINED_MULT', 0), // Quarantined = no trade

  // Confidence multipliers (linear interpolation)
  CONF_MIN_MULT: env('CONF_MIN_MULT', 0.5),                 // At 50% confidence
  CONF_MID_MULT: env('CONF_MID_MULT', 1.5),                 // At 75% confidence
  CONF_MAX_MULT: env('CONF_MAX_MULT', 2.5),                 // At 90%+ confidence
  CONF_MIN_THRESHOLD: env('CONF_MIN_THRESHOLD', 0.50),      // 50%
  CONF_MID_THRESHOLD: env('CONF_MID_THRESHOLD', 0.75),      // 75%
  CONF_MAX_THRESHOLD: env('CONF_MAX_THRESHOLD', 0.90),      // 90%

  // Volatility multipliers (ATR-based)
  VOL_LOW_MULT: env('VOL_LOW_MULT', 1.5),                   // Low vol = bigger size
  VOL_NORMAL_MULT: env('VOL_NORMAL_MULT', 1.0),             // Normal vol
  VOL_HIGH_MULT: env('VOL_HIGH_MULT', 0.6),                 // High vol = smaller size
  VOL_LOW_THRESHOLD: env('VOL_LOW_THRESHOLD', 1.0),         // ATR% below this = low vol
  VOL_HIGH_THRESHOLD: env('VOL_HIGH_THRESHOLD', 3.0),       // ATR% above this = high vol
};

class DynamicPositionSizer {
  constructor(patternMemory = null) {
    this.patternMemory = patternMemory;
    this.config = { ...CONFIG };
    this.lastCalculation = null;
  }

  /**
   * Calculate position size with all multipliers
   *
   * @param {Object} params
   * @param {number} params.accountBalance - Current account balance in USD
   * @param {number} params.confidence - Signal confidence (0-1 or 0-100)
   * @param {number} params.atrPercent - Current ATR as percentage of price
   * @param {Object} params.pattern - Pattern data from signal (optional)
   * @param {number} params.price - Current price (for BTC conversion)
   * @returns {Object} { sizePercent, sizeUSD, sizeBTC, multipliers, capped }
   */
  calculate({
    accountBalance,
    confidence,
    atrPercent = null,
    pattern = null,
    price = null,
  }) {
    // Normalize confidence to 0-1
    const conf = confidence > 1 ? confidence / 100 : confidence;

    // Calculate multipliers
    const patternMult = this._getPatternMultiplier(pattern);
    const confMult = this._getConfidenceMultiplier(conf);
    const volMult = this._getVolatilityMultiplier(atrPercent);

    // Base size
    const baseSize = this.config.BASE_POSITION_SIZE;

    // Combined size (uncapped)
    let sizePercent = baseSize * patternMult * confMult * volMult;

    // Check if capped
    const wasCapped = sizePercent > this.config.MAX_POSITION_SIZE;
    if (wasCapped) {
      sizePercent = this.config.MAX_POSITION_SIZE;
    }

    // Enforce minimum
    if (sizePercent < this.config.MIN_POSITION_SIZE && sizePercent > 0) {
      sizePercent = this.config.MIN_POSITION_SIZE;
    }

    // Calculate USD and BTC amounts
    const sizeUSD = accountBalance * sizePercent;
    const sizeBTC = price ? sizeUSD / price : null;

    // Store for debugging
    this.lastCalculation = {
      accountBalance,
      confidence: conf,
      atrPercent,
      pattern: pattern?.name || pattern?.signature || null,
      multipliers: {
        base: baseSize,
        pattern: patternMult,
        confidence: confMult,
        volatility: volMult,
        combined: patternMult * confMult * volMult,
      },
      sizePercent,
      sizeUSD,
      sizeBTC,
      capped: wasCapped,
    };

    return this.lastCalculation;
  }

  /**
   * Get pattern-based multiplier from UnifiedPatternMemory
   */
  _getPatternMultiplier(pattern) {
    if (!pattern) return this.config.PATTERN_UNKNOWN_MULT;

    // If pattern memory is available, check pattern status
    if (this.patternMemory) {
      const status = this.patternMemory.getPatternStatus?.(pattern);
      if (status === 'promoted') return this.config.PATTERN_PROMOTED_MULT;
      if (status === 'quarantined') return this.config.PATTERN_QUARANTINED_MULT;
    }

    // Check pattern object for status flags
    if (pattern.promoted === true) return this.config.PATTERN_PROMOTED_MULT;
    if (pattern.quarantined === true) return this.config.PATTERN_QUARANTINED_MULT;

    // Check win rate if available
    if (pattern.winRate != null) {
      if (pattern.winRate >= 0.65) return this.config.PATTERN_PROMOTED_MULT;
      if (pattern.winRate < 0.35) return this.config.PATTERN_QUARANTINED_MULT;
    }

    return this.config.PATTERN_UNKNOWN_MULT;
  }

  /**
   * Get confidence-based multiplier with linear interpolation
   */
  _getConfidenceMultiplier(confidence) {
    const { CONF_MIN_THRESHOLD, CONF_MID_THRESHOLD, CONF_MAX_THRESHOLD,
            CONF_MIN_MULT, CONF_MID_MULT, CONF_MAX_MULT } = this.config;

    // Below minimum threshold
    if (confidence < CONF_MIN_THRESHOLD) {
      return CONF_MIN_MULT * (confidence / CONF_MIN_THRESHOLD);
    }

    // Between min and mid
    if (confidence < CONF_MID_THRESHOLD) {
      const range = CONF_MID_THRESHOLD - CONF_MIN_THRESHOLD;
      const progress = (confidence - CONF_MIN_THRESHOLD) / range;
      return CONF_MIN_MULT + (CONF_MID_MULT - CONF_MIN_MULT) * progress;
    }

    // Between mid and max
    if (confidence < CONF_MAX_THRESHOLD) {
      const range = CONF_MAX_THRESHOLD - CONF_MID_THRESHOLD;
      const progress = (confidence - CONF_MID_THRESHOLD) / range;
      return CONF_MID_MULT + (CONF_MAX_MULT - CONF_MID_MULT) * progress;
    }

    // Above max threshold
    return CONF_MAX_MULT;
  }

  /**
   * Get volatility-based multiplier from ATR%
   */
  _getVolatilityMultiplier(atrPercent) {
    if (atrPercent == null) return this.config.VOL_NORMAL_MULT;

    const { VOL_LOW_THRESHOLD, VOL_HIGH_THRESHOLD,
            VOL_LOW_MULT, VOL_NORMAL_MULT, VOL_HIGH_MULT } = this.config;

    // Low volatility - increase size
    if (atrPercent < VOL_LOW_THRESHOLD) {
      return VOL_LOW_MULT;
    }

    // High volatility - decrease size
    if (atrPercent > VOL_HIGH_THRESHOLD) {
      return VOL_HIGH_MULT;
    }

    // Normal volatility - linear interpolation
    const range = VOL_HIGH_THRESHOLD - VOL_LOW_THRESHOLD;
    const progress = (atrPercent - VOL_LOW_THRESHOLD) / range;
    return VOL_LOW_MULT + (VOL_NORMAL_MULT - VOL_LOW_MULT) * progress;
  }

  /**
   * Log the last calculation for debugging
   */
  logLastCalculation() {
    const c = this.lastCalculation;
    if (!c) {
      console.log('[DynamicPositionSizer] No calculation yet');
      return;
    }

    console.log('\n📊 [DynamicPositionSizer] Position Size Calculation:');
    console.log(`   Account:     $${c.accountBalance.toLocaleString()}`);
    console.log(`   Confidence:  ${(c.confidence * 100).toFixed(1)}%`);
    console.log(`   ATR%:        ${c.atrPercent?.toFixed(2) || 'N/A'}%`);
    console.log(`   Pattern:     ${c.pattern || 'none'}`);
    console.log('   ─────────────────────────────────────');
    console.log(`   Base:        ${(c.multipliers.base * 100).toFixed(2)}%`);
    console.log(`   × Pattern:   ${c.multipliers.pattern.toFixed(2)}x`);
    console.log(`   × Confidence:${c.multipliers.confidence.toFixed(2)}x`);
    console.log(`   × Volatility:${c.multipliers.volatility.toFixed(2)}x`);
    console.log(`   = Combined:  ${c.multipliers.combined.toFixed(2)}x`);
    console.log('   ─────────────────────────────────────');
    console.log(`   Size:        ${(c.sizePercent * 100).toFixed(2)}% ${c.capped ? '(CAPPED)' : ''}`);
    console.log(`   USD:         $${c.sizeUSD.toFixed(2)}`);
    if (c.sizeBTC) console.log(`   BTC:         ${c.sizeBTC.toFixed(6)}`);
  }

  /**
   * Update config at runtime
   */
  updateConfig(updates) {
    Object.assign(this.config, updates);
  }

  /**
   * Get current config
   */
  getConfig() {
    return { ...this.config };
  }
}

module.exports = DynamicPositionSizer;
