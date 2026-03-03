/**
 * StopLossChecker.js - Stop Loss Exit Condition
 * ==============================================
 * Checks universal hard stop AND strategy-specific stop loss.
 * Break-even logic: if maxProfit >= risk (1:1 move), stop moves to entry.
 *
 * @module core/exit/StopLossChecker
 */

'use strict';

class StopLossChecker {
  /**
   * @param {Object} universalLimits - { hardStopLossPercent, accountDrawdownPercent }
   */
  constructor(universalLimits) {
    this.universalLimits = universalLimits;
  }

  /**
   * Check stop loss conditions
   * @param {Object} trade - Trade object with entryPrice, exitContract, maxProfitPercent
   * @param {number} currentPrice - Current market price
   * @param {number} pnlPercent - Current P&L as percentage
   * @param {Object} context - { accountBalance, initialBalance }
   * @returns {Object} { shouldExit, exitReason, details, confidence } or { shouldExit: false }
   */
  check(trade, currentPrice, pnlPercent, context = {}) {
    const contract = trade.exitContract || {};

    // === UNIVERSAL HARD STOP (always first) ===
    if (pnlPercent <= this.universalLimits.hardStopLossPercent) {
      return {
        shouldExit: true,
        exitReason: 'hard_stop',
        details: `Universal hard stop: ${pnlPercent.toFixed(2)}% <= ${this.universalLimits.hardStopLossPercent}%`,
        confidence: 100
      };
    }

    // === ACCOUNT DRAWDOWN ===
    if (context.accountBalance && context.initialBalance) {
      const accountDrawdown = ((context.accountBalance - context.initialBalance) / context.initialBalance) * 100;
      if (accountDrawdown <= this.universalLimits.accountDrawdownPercent) {
        return {
          shouldExit: true,
          exitReason: 'account_drawdown',
          details: `Account drawdown: ${accountDrawdown.toFixed(2)}% <= ${this.universalLimits.accountDrawdownPercent}%`,
          confidence: 100
        };
      }
    }

    // === STRATEGY STOP LOSS (with break-even) ===
    if (contract.stopLossPercent !== undefined) {
      const riskAmount = Math.abs(contract.stopLossPercent);
      const breakEvenTriggered = trade.maxProfitPercent && trade.maxProfitPercent >= riskAmount;
      const effectiveStop = breakEvenTriggered ? -0.05 : contract.stopLossPercent;

      if (pnlPercent <= effectiveStop) {
        const exitReason = breakEvenTriggered ? 'break_even' : 'stop_loss';
        const stopType = breakEvenTriggered ? 'BE' : 'SL';
        return {
          shouldExit: true,
          exitReason,
          details: `${trade.entryStrategy || 'Strategy'} ${stopType}: ${pnlPercent.toFixed(2)}% <= ${effectiveStop.toFixed(2)}%`,
          confidence: 100
        };
      }
    }

    return { shouldExit: false };
  }

  /**
   * Get the effective stop loss level (accounts for break-even)
   * Useful for dashboard display
   * @param {Object} trade
   * @returns {number} Effective stop loss percent
   */
  getEffectiveStop(trade) {
    const contract = trade.exitContract || {};
    if (contract.stopLossPercent === undefined) return null;
    const riskAmount = Math.abs(contract.stopLossPercent);
    const breakEvenTriggered = trade.maxProfitPercent && trade.maxProfitPercent >= riskAmount;
    return breakEvenTriggered ? -0.05 : contract.stopLossPercent;
  }
}

module.exports = StopLossChecker;
