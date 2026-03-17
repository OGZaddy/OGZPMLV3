/**
 * TrailingStopChecker.js - Trailing Stop Exit Condition
 * =====================================================
 * Checks trailing stop AND owns maxProfitPercent updates.
 * Single owner of high water mark — prevents split responsibility bugs.
 * Phase 11: Uses BreakEvenManager for break-even state (single source of truth).
 *
 * OWNS: trade.maxProfitPercent mutation
 *
 * @module core/exit/TrailingStopChecker
 */

'use strict';

const BreakEvenManager = require('./BreakEvenManager');

class TrailingStopChecker {
  constructor() {
    this.breakEvenManager = new BreakEvenManager();
  }

  /**
   * Update max profit tracking (call BEFORE check)
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
   * Check trailing stop condition
   * @param {Object} trade - Trade object with exitContract, maxProfitPercent
   * @param {number} pnlPercent - Current P&L as percentage
   * @returns {Object} { shouldExit, exitReason, details, confidence } or { shouldExit: false }
   */
  check(trade, pnlPercent) {
    const contract = trade.exitContract || {};

    if (!contract.trailingStopPercent || !trade.maxProfitPercent) {
      return { shouldExit: false };
    }

    const activationThreshold = contract.trailingActivation || 0;

    // Only activate trailing once we've reached the activation threshold
    if (trade.maxProfitPercent < activationThreshold) {
      return { shouldExit: false };
    }

    // Phase 11: Query BreakEvenManager instead of inline computation
    const beState = this.breakEvenManager.evaluate(trade);
    const breakEvenTriggered = beState.isBreakEven;
    const effectiveStop = beState.effectiveStopPercent;

    const trailTrigger = breakEvenTriggered ? 0 : contract.trailingStopPercent;
    if (trade.maxProfitPercent >= trailTrigger) {
      const trailStop = trade.maxProfitPercent - contract.trailingStopPercent;
      if (pnlPercent <= trailStop && trailStop > effectiveStop) {
        return {
          shouldExit: true,
          exitReason: 'trailing_stop',
          details: `Trailing stop: P&L ${pnlPercent.toFixed(2)}% fell from peak ${trade.maxProfitPercent.toFixed(2)}% (activated at ${activationThreshold}%)`,
          confidence: 100
        };
      }
    }

    return { shouldExit: false };
  }
}

module.exports = TrailingStopChecker;
