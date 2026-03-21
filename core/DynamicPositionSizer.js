/**
 * DynamicPositionSizer.js — Intelligent Position Sizing Engine
 * =============================================================
 *
 * REPLACES the inline confidence multiplier hack in OrderExecutor.
 *
 * Formula:
 *   size = baseSize × patternMultiplier × confidenceMultiplier × volatilityMultiplier
 *
 * Where:
 *   baseSize           = account × BASE_POSITION_SIZE (default 1%)
 *   patternMultiplier  = from UnifiedPatternMemory win rate
 *                        unknown=1.0, promoted=1.5, quarantined=0
 *   confidenceMultiplier = from signal confidence (0-1 scale)
 *                        50%=0.5x, 75%=1.5x, 90%=2.5x
 *   volatilityMultiplier = ATR-based
 *                        low vol=1.5x, normal=1.0x, high vol=0.6x
 *
 * Cap: MAX_POSITION_SIZE (default 5%)
 * All thresholds configurable via TradingConfig / .env
 *
 * USAGE:
 *   const sizer = new DynamicPositionSizer();
 *   const result = sizer.calculate({
 *     balance: 10000,
 *     confidence: 0.72,        // 0-1 scale (NOT percentage)
 *     features: [0.25, ...],   // 9-element vector for pattern lookup
 *     atrPercent: 0.35,        // ATR as % of price
 *     confluenceMultiplier: 1.5 // from StrategyOrchestrator (optional)
 *   });
 *   // result = { sizeUSD, sizePercent, multipliers: {...}, capped, reason }
 *
 * WIRING:
 *   In OrderExecutor, replace the confidence multiplier block with:
 *     const sizing = this.ctx.dynamicPositionSizer.calculate({ ... });
 *     const positionSizeUSD = sizing.sizeUSD;
 *
 * @module core/DynamicPositionSizer
 * @author Claude Opus (Architect) for Trey / OGZPrime
 * @date 2026-03-20
 */

'use strict';

const TradingConfig = require('./TradingConfig');

class DynamicPositionSizer {
  constructor(config = {}) {
    // ═══════════════════════════════════════════════════════════════
    // BASE SIZING — from TradingConfig, overridable via .env
    // ═══════════════════════════════════════════════════════════════
    this.basePositionPercent = config.basePositionPercent
      ?? TradingConfig.get('positionSizing.basePositionSize')
      ?? 0.01; // 1%

    this.maxPositionPercent = config.maxPositionPercent
      ?? TradingConfig.get('positionSizing.maxPositionSize')
      ?? 0.05; // 5%

    // ═══════════════════════════════════════════════════════════════
    // CONFIDENCE MULTIPLIER — piecewise linear curve
    // Maps confidence (0-1) to sizing multiplier
    // ═══════════════════════════════════════════════════════════════
    // Default curve: 0.50→0.5x, 0.60→1.0x, 0.75→1.5x, 0.90→2.5x
    this.confidenceCurve = config.confidenceCurve ?? [
      { confidence: 0.00, multiplier: 0.25 },  // Very low = quarter size
      { confidence: 0.50, multiplier: 0.50 },  // Minimum viable
      { confidence: 0.60, multiplier: 1.00 },  // Standard
      { confidence: 0.75, multiplier: 1.50 },  // Good signal
      { confidence: 0.90, multiplier: 2.50 },  // Excellent signal (cap)
      { confidence: 1.00, multiplier: 2.50 },  // Perfect (same cap)
    ];

    // ═══════════════════════════════════════════════════════════════
    // VOLATILITY MULTIPLIER — ATR-based position scaling
    // Low vol = bigger positions, high vol = smaller positions
    // ═══════════════════════════════════════════════════════════════
    // atrPercent = (ATR / price) * 100
    this.volatilityCurve = config.volatilityCurve ?? [
      { atrPercent: 0.00, multiplier: 1.50 },  // Dead market — bigger size
      { atrPercent: 0.15, multiplier: 1.20 },  // Low vol
      { atrPercent: 0.30, multiplier: 1.00 },  // Normal
      { atrPercent: 0.60, multiplier: 0.80 },  // Elevated
      { atrPercent: 1.00, multiplier: 0.60 },  // High vol
      { atrPercent: 2.00, multiplier: 0.40 },  // Extreme — cut size
    ];

    // ═══════════════════════════════════════════════════════════════
    // PATTERN MULTIPLIER — from UnifiedPatternMemory status
    // ═══════════════════════════════════════════════════════════════
    this.patternMultipliers = config.patternMultipliers ?? {
      promoted:    1.50,   // Proven winner — trust it more
      neutral:     1.00,   // Unknown track record — standard size
      learning:    1.00,   // Still collecting data — standard size
      quarantined: 0.25,   // Proven loser — quarter size, still trade to collect data
      unknown:     1.00,   // No pattern match — standard size
    };

    // ═══════════════════════════════════════════════════════════════
    // HALF-KELLY OPTION — use pattern win rate for optimal sizing
    // Kelly criterion: f* = (bp - q) / b where b=win/loss ratio
    // Half-Kelly = 50% of full Kelly = 75% of growth, way less drawdown
    // ═══════════════════════════════════════════════════════════════
    this.useHalfKelly = config.useHalfKelly ?? false;
    this.kellyMinSamples = config.kellyMinSamples ?? 20; // Need 20+ trades for Kelly

    // Reference to pattern memory — injected after construction
    this._patternMemory = null;

    // Stats
    this.calculations = 0;
    this.cappedCount = 0;

    console.log(`[DynamicPositionSizer] Initialized — base=${(this.basePositionPercent * 100).toFixed(1)}%, max=${(this.maxPositionPercent * 100).toFixed(1)}%`);
  }

  /**
   * Inject the UnifiedPatternMemory reference.
   * Called once during module initialization (avoids circular deps).
   *
   * @param {Object} patternMemory - Instance of UnifiedPatternMemory
   */
  setPatternMemory(patternMemory) {
    this._patternMemory = patternMemory;
    console.log('[DynamicPositionSizer] Pattern memory connected');
  }

  /**
   * MAIN ENTRY POINT — Calculate position size for a trade.
   *
   * @param {Object} params
   * @param {number} params.balance        - Current account balance in USD
   * @param {number} params.confidence     - Signal confidence 0-1 (NOT percentage)
   * @param {number[]} [params.features]   - 9-element feature vector for pattern lookup
   * @param {number} [params.atrPercent]   - ATR as percentage of price (0.35 = 0.35%)
   * @param {number} [params.confluenceMultiplier] - From StrategyOrchestrator (1.0-2.5)
   * @param {number} [params.price]        - Current price (for USD→asset conversion)
   * @returns {Object} { sizeUSD, sizePercent, multipliers, capped, blocked, reason }
   */
  calculate(params) {
    this.calculations++;

    const {
      balance = 10000,
      confidence = 0.5,
      features = null,
      atrPercent = 0.30,
      confluenceMultiplier = 1.0,
      price = 0,
    } = params;

    // ── 1. Confidence multiplier ──
    const confMultiplier = this._interpolateCurve(
      this.confidenceCurve, 'confidence', confidence
    );

    // ── 2. Volatility multiplier ──
    const volMultiplier = this._interpolateCurve(
      this.volatilityCurve, 'atrPercent', atrPercent
    );

    // ── 3. Pattern multiplier ──
    let patternMultiplier = this.patternMultipliers.unknown;
    let patternStatus = 'unknown';
    let patternWinRate = null;

    if (features && this._patternMemory) {
      const patternResult = this._patternMemory.getConfidence(features);
      if (patternResult) {
        patternStatus = patternResult.status || 'neutral';
        patternMultiplier = this.patternMultipliers[patternStatus]
          ?? this.patternMultipliers.unknown;
        patternWinRate = patternResult.confidence;

        // Half-Kelly override: if enabled and enough samples, use it
        if (this.useHalfKelly && patternResult.stats) {
          const totalTrades = (patternResult.stats.wins || 0) + (patternResult.stats.losses || 0);
          if (totalTrades >= this.kellyMinSamples) {
            const kellyMultiplier = this._halfKelly(patternResult.stats);
            if (kellyMultiplier !== null) {
              patternMultiplier = kellyMultiplier;
              patternStatus += '_kelly';
            }
          }
        }
      }
    }

    // ── 4. Combined multiplier ──
    const combinedMultiplier = confMultiplier * volMultiplier * patternMultiplier * confluenceMultiplier;

    // ── 5. Raw position size ──
    const rawPercent = this.basePositionPercent * combinedMultiplier;

    // ── 6. Cap at max ──
    const capped = rawPercent > this.maxPositionPercent;
    const finalPercent = Math.min(rawPercent, this.maxPositionPercent);
    if (capped) this.cappedCount++;

    const sizeUSD = balance * finalPercent;
    const sizeAsset = price > 0 ? sizeUSD / price : 0;

    // ── Build reason string ──
    const parts = [];
    parts.push(`conf=${(confidence * 100).toFixed(0)}%→${confMultiplier.toFixed(2)}x`);
    parts.push(`vol=${atrPercent.toFixed(2)}%→${volMultiplier.toFixed(2)}x`);
    parts.push(`pattern=${patternStatus}→${patternMultiplier.toFixed(2)}x`);
    if (confluenceMultiplier !== 1.0) {
      parts.push(`confluence=${confluenceMultiplier.toFixed(1)}x`);
    }
    if (capped) {
      parts.push(`CAPPED ${(rawPercent * 100).toFixed(2)}%→${(finalPercent * 100).toFixed(2)}%`);
    }

    return {
      sizeUSD,
      sizePercent: finalPercent,
      sizeAsset,
      multipliers: {
        confidence: confMultiplier,
        volatility: volMultiplier,
        pattern: patternMultiplier,
        confluence: confluenceMultiplier,
        combined: combinedMultiplier,
      },
      patternStatus,
      patternWinRate,
      capped,
      reason: parts.join(' | '),
    };
  }

  /**
   * Piecewise linear interpolation on a sorted curve.
   * Given a curve like [{confidence: 0.5, multiplier: 0.5}, ...],
   * find the multiplier for any input value.
   *
   * @param {Array} curve - Sorted array of {key: value, multiplier: value}
   * @param {string} key  - Property name to interpolate on ('confidence' or 'atrPercent')
   * @param {number} value - Input value to look up
   * @returns {number} Interpolated multiplier
   */
  _interpolateCurve(curve, key, value) {
    if (!curve || curve.length === 0) return 1.0;

    // Clamp to bounds
    if (value <= curve[0][key]) return curve[0].multiplier;
    if (value >= curve[curve.length - 1][key]) return curve[curve.length - 1].multiplier;

    // Find surrounding points
    for (let i = 0; i < curve.length - 1; i++) {
      const lo = curve[i];
      const hi = curve[i + 1];
      if (value >= lo[key] && value <= hi[key]) {
        // Linear interpolation
        const t = (value - lo[key]) / (hi[key] - lo[key]);
        return lo.multiplier + t * (hi.multiplier - lo.multiplier);
      }
    }

    return 1.0; // Fallback (should never reach)
  }

  /**
   * Half-Kelly criterion — optimal fraction to bet.
   * Full Kelly: f = (W × B - L) / B
   * Where W = win rate, L = loss rate, B = avg_win / avg_loss
   * Half-Kelly = f / 2  (75% of growth, dramatically less drawdown)
   *
   * Returns a multiplier relative to base size, not an absolute fraction.
   *
   * @param {Object} stats - { wins, losses, avgWin, avgLoss }
   * @returns {number|null} Multiplier (0-3) or null if insufficient data
   */
  _halfKelly(stats) {
    const { wins = 0, losses = 0, avgWin = 0, avgLoss = 0 } = stats;
    const total = wins + losses;
    if (total < this.kellyMinSamples) return null;
    if (avgLoss === 0 || avgWin === 0) return null;

    const W = wins / total;                // Win rate
    const L = 1 - W;                       // Loss rate
    const B = Math.abs(avgWin / avgLoss);  // Payoff ratio

    const fullKelly = (W * B - L) / B;

    // Negative Kelly = losing strategy = don't trade
    if (fullKelly <= 0) return 0;

    // Half-Kelly, expressed as multiplier (1.0 = normal base size)
    // Cap at 3.0x to prevent insane sizing even with great stats
    const halfK = fullKelly / 2;
    const multiplier = Math.min(3.0, halfK / this.basePositionPercent);

    return Math.max(0, multiplier);
  }

  /**
   * Get sizing stats for monitoring / dashboard.
   */
  getStats() {
    return {
      calculations: this.calculations,
      cappedCount: this.cappedCount,
      cappedRate: this.calculations > 0
        ? (this.cappedCount / this.calculations * 100).toFixed(1) + '%'
        : '0%',
      config: {
        basePercent: this.basePositionPercent,
        maxPercent: this.maxPositionPercent,
        halfKelly: this.useHalfKelly,
      },
    };
  }

  /**
   * Print stats summary (for end-of-backtest reporting).
   */
  printStats() {
    const s = this.getStats();
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  DYNAMIC POSITION SIZER — Summary');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Total calculations:  ${s.calculations}`);
    console.log(`  Capped at max:       ${s.cappedCount} (${s.cappedRate})`);
    console.log(`  Base size:           ${(s.config.basePercent * 100).toFixed(1)}%`);
    console.log(`  Max size:            ${(s.config.maxPercent * 100).toFixed(1)}%`);
    console.log(`  Half-Kelly:          ${s.config.halfKelly ? 'ENABLED' : 'disabled'}`);
    console.log('═══════════════════════════════════════════════════════════════\n');
  }
}

module.exports = DynamicPositionSizer;
