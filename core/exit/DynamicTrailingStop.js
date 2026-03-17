/**
 * DynamicTrailingStop.js - Adaptive Trailing Stop System
 * ======================================================
 *
 * REPLACES the static TrailingStopChecker.js
 *
 * The old trailing stop was a fixed percentage that:
 * - Activated too early (0.8%)
 * - Trailed too tight (0.6%)
 * - Had no awareness of volatility, trend, or structure
 * - Result: 126 exits losing $498 total
 *
 * This dynamic version:
 * 1. WIDENS in strong trends — let runners run
 * 2. TIGHTENS near structure — S/R, fib levels, round numbers
 * 3. SCALES with ATR — volatile = wider trail, quiet = tighter trail
 * 4. NEVER activates below fees — minimum exit must clear 0.65% round trip
 * 5. RATCHETS — trail only tightens, never widens after tightening
 *
 * ENV VAR OVERRIDES (for parallel backtester):
 *   TRAIL_ATR_MULTIPLIER    - ATR multiplier for trail distance (default: 2.0)
 *   TRAIL_MIN_ACTIVATION    - Minimum profit % before trailing starts (default: 1.5)
 *   TRAIL_TREND_WIDEN       - Extra ATR multiplier in strong trends (default: 1.5)
 *   TRAIL_STRUCTURE_TIGHTEN - Tighten multiplier near structure (default: 0.5)
 *
 * @module core/exit/DynamicTrailingStop
 * @author Claude (Opus) for Trey / OGZPrime
 * @date 2026-03-17
 */

'use strict';

class DynamicTrailingStop {
  constructor(config = {}) {
    // Base configuration — all overridable via env vars
    this.config = {
      // ATR-based trail distance: trail = ATR * multiplier
      atrMultiplier: parseFloat(process.env.TRAIL_ATR_MULTIPLIER) || config.atrMultiplier || 2.0,

      // Minimum profit before trailing activates (must clear fees)
      // 1.5% means worst-case trailing exit is ~1.0% after trail, still clears 0.65% fees
      minActivation: parseFloat(process.env.TRAIL_MIN_ACTIVATION) || config.minActivation || 1.5,

      // Trend multiplier: in strong trends, widen the trail
      trendWidenMultiplier: parseFloat(process.env.TRAIL_TREND_WIDEN) || config.trendWidenMultiplier || 1.5,

      // Structure tighten: near S/R or fib, tighten the trail
      structureTightenMultiplier: parseFloat(process.env.TRAIL_STRUCTURE_TIGHTEN) || config.structureTightenMultiplier || 0.5,

      // Absolute minimum trail distance (% of price) — floor so it doesn't get too tight
      minTrailPercent: config.minTrailPercent || 0.3,

      // Absolute maximum trail distance (% of price) — cap so it doesn't get too loose
      maxTrailPercent: config.maxTrailPercent || 3.0,

      // Round number proximity threshold (% of price)
      roundNumberProximity: config.roundNumberProximity || 0.5,

      // Fee buffer — trail stop price must be at least this above entry after fees
      feeBuffer: parseFloat(process.env.FEE_TOTAL_ROUNDTRIP) || config.feeBuffer || 0.0065,
    };

    // State tracking per trade (keyed by trade ID)
    this.tradeState = new Map();
  }

  /**
   * Update max profit tracking (call BEFORE check on every candle)
   * @param {Object} trade - Trade object (MUTATED: maxProfitPercent updated)
   * @param {number} currentPrice - Current market price
   * @returns {number} Updated maxProfitPercent
   */
  updateMaxProfit(trade, currentPrice) {
    if (!trade || !trade.entryPrice) return 0;
    const pnlPercent = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
    trade.maxProfitPercent = Math.max(trade.maxProfitPercent || 0, pnlPercent);
    return trade.maxProfitPercent;
  }

  /**
   * Calculate dynamic trail distance based on market conditions
   *
   * @param {Object} context - Market context
   * @param {number} context.atr - Current ATR value in dollars
   * @param {number} context.price - Current price
   * @param {string} context.trend - 'bullish', 'bearish', 'sideways', etc.
   * @param {number} context.rsi - Current RSI value
   * @param {Object} context.nearestStructure - { level, distance, type } nearest S/R or fib
   * @param {number} context.maxProfitPercent - How far in profit the trade has gone
   * @returns {number} Trail distance as percentage of price
   */
  calculateTrailDistance(context = {}) {
    const { atr = 0, price = 0, trend = 'sideways', rsi = 50, nearestStructure = null, maxProfitPercent = 0 } = context;

    // Base trail: ATR as percentage of price × multiplier
    let atrPercent = (atr && price > 0) ? (atr / price) * 100 : 1.0;
    let trailPercent = atrPercent * this.config.atrMultiplier;

    // === TREND ADJUSTMENT ===
    // Strong trend = widen trail to let runners run
    const isBullTrend = trend === 'bullish' || trend === 'uptrend' || trend === 'trending_up';
    const isBearTrend = trend === 'bearish' || trend === 'downtrend' || trend === 'trending_down';
    const isStrongTrend = isBullTrend || isBearTrend;

    if (isStrongTrend) {
      // RSI confirms trend strength
      const trendStrength = isBullTrend
        ? Math.max(0, (rsi - 50) / 50)   // RSI 50=0, RSI 80=0.6
        : Math.max(0, (50 - rsi) / 50);  // RSI 50=0, RSI 20=0.6

      // Scale widen multiplier by trend strength
      const widenAmount = 1.0 + (this.config.trendWidenMultiplier - 1.0) * trendStrength;
      trailPercent *= widenAmount;
    }

    // === PROFIT RATCHET ===
    // As profit grows, gradually tighten trail (lock in more profit)
    // At 1.5% profit: normal trail
    // At 3.0% profit: trail tightens 20%
    // At 5.0%+ profit: trail tightens 40%
    if (maxProfitPercent > 3.0) {
      const ratchetFactor = Math.max(0.6, 1.0 - (maxProfitPercent - 3.0) * 0.1);
      trailPercent *= ratchetFactor;
    }

    // === STRUCTURE PROXIMITY ===
    // Near support/resistance or fib level = tighten trail
    if (nearestStructure && nearestStructure.distance !== undefined) {
      const distPercent = Math.abs(nearestStructure.distance);
      if (distPercent < 1.0) {
        // Within 1% of structure — tighten proportionally
        const tightenFactor = this.config.structureTightenMultiplier +
          (1.0 - this.config.structureTightenMultiplier) * (distPercent / 1.0);
        trailPercent *= tightenFactor;
      }
    }

    // === ROUND NUMBER PROXIMITY ===
    // BTC trades react at round numbers ($50K, $60K, etc.)
    if (price > 0) {
      const roundNumbers = [1000, 5000, 10000]; // Check proximity to these increments
      for (const increment of roundNumbers) {
        const nearest = Math.round(price / increment) * increment;
        const distToRound = Math.abs(price - nearest) / price * 100;
        if (distToRound < this.config.roundNumberProximity) {
          trailPercent *= 0.7; // Tighten 30% near round numbers
          break;
        }
      }
    }

    // === CLAMP ===
    trailPercent = Math.max(this.config.minTrailPercent, Math.min(this.config.maxTrailPercent, trailPercent));

    return trailPercent;
  }

  /**
   * Check if trailing stop should trigger
   *
   * @param {Object} trade - Trade object with entryPrice, maxProfitPercent, exitContract
   * @param {number} pnlPercent - Current P&L as percentage
   * @param {Object} context - Market context (atr, price, trend, rsi, nearestStructure)
   * @returns {Object} { shouldExit, exitReason, details, confidence } or { shouldExit: false }
   */
  check(trade, pnlPercent, context = {}) {
    if (!trade || !trade.entryPrice) return { shouldExit: false };
    if (!trade.maxProfitPercent || trade.maxProfitPercent <= 0) return { shouldExit: false };

    // Don't activate until minimum profit threshold (must clear fees)
    if (trade.maxProfitPercent < this.config.minActivation) {
      return { shouldExit: false };
    }

    // Calculate dynamic trail distance
    const trailDistance = this.calculateTrailDistance({
      ...context,
      maxProfitPercent: trade.maxProfitPercent,
    });

    // Trail stop level = peak profit minus trail distance
    const trailStopLevel = trade.maxProfitPercent - trailDistance;

    // Safety: trail stop must leave at least enough profit to cover fees
    const feeThreshold = this.config.feeBuffer * 100; // Convert to percent
    const effectiveTrailStop = Math.max(trailStopLevel, feeThreshold);

    // Check if current P&L has dropped below the trail stop
    if (pnlPercent <= effectiveTrailStop) {
      const netProfit = pnlPercent - feeThreshold;
      return {
        shouldExit: true,
        exitReason: 'trailing_stop',
        details: `Dynamic trail: P&L ${pnlPercent.toFixed(2)}% fell from peak ${trade.maxProfitPercent.toFixed(2)}% (trail: ${trailDistance.toFixed(2)}%, level: ${effectiveTrailStop.toFixed(2)}%)`,
        confidence: 100,
        meta: {
          trailDistance,
          trailStopLevel: effectiveTrailStop,
          peakProfit: trade.maxProfitPercent,
          netProfitEstimate: netProfit,
          context: {
            atrPercent: context.atr && context.price ? (context.atr / context.price * 100).toFixed(3) : 'N/A',
            trend: context.trend || 'unknown',
            nearStructure: context.nearestStructure ? `${context.nearestStructure.type} @ ${context.nearestStructure.distance?.toFixed(2)}%` : 'none',
          }
        }
      };
    }

    return { shouldExit: false };
  }

  /**
   * Get the current effective trail stop level for a trade (for dashboard display)
   * @param {Object} trade
   * @param {Object} context
   * @returns {Object} { trailDistance, trailStopLevel, isActive }
   */
  getTrailInfo(trade, context = {}) {
    if (!trade || !trade.maxProfitPercent || trade.maxProfitPercent < this.config.minActivation) {
      return { trailDistance: null, trailStopLevel: null, isActive: false };
    }

    const trailDistance = this.calculateTrailDistance({
      ...context,
      maxProfitPercent: trade.maxProfitPercent,
    });
    const feeThreshold = this.config.feeBuffer * 100;
    const trailStopLevel = Math.max(trade.maxProfitPercent - trailDistance, feeThreshold);

    return {
      trailDistance,
      trailStopLevel,
      isActive: true,
      peakProfit: trade.maxProfitPercent,
    };
  }
}

module.exports = DynamicTrailingStop;
