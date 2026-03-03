/**
 * TakeProfitChecker.js - Take Profit Exit Condition
 * ==================================================
 * Checks if P&L has reached the strategy's take profit target.
 *
 * @module core/exit/TakeProfitChecker
 */

'use strict';

class TakeProfitChecker {
  /**
   * Check take profit condition
   * @param {Object} trade - Trade object with exitContract
   * @param {number} pnlPercent - Current P&L as percentage
   * @returns {Object} { shouldExit, exitReason, details, confidence } or { shouldExit: false }
   */
  check(trade, pnlPercent) {
    const contract = trade.exitContract || {};

    if (contract.takeProfitPercent !== undefined && pnlPercent >= contract.takeProfitPercent) {
      return {
        shouldExit: true,
        exitReason: 'take_profit',
        details: `${trade.entryStrategy || 'Strategy'} TP: ${pnlPercent.toFixed(2)}% >= ${contract.takeProfitPercent}%`,
        confidence: 100
      };
    }

    return { shouldExit: false };
  }
}

module.exports = TakeProfitChecker;
