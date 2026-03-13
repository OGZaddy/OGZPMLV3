/**
 * StopLossChecker.js - Stop Loss Exit Condition
 * ==============================================
 * Checks universal hard stop AND strategy-specific stop loss.
 * Phase 11: Uses BreakEvenManager for break-even state (single source of truth).
 *
 * @module core/exit/StopLossChecker
 */

'use strict';

const BreakEvenManager = require('./BreakEvenManager');

class StopLossChecker {
  /**
   * @param {Object} universalLimits - { hardStopLossPercent, accountDrawdownPercent }
   */
  constructor(universalLimits) {
    this.universalLimits = universalLimits;
    this.breakEvenManager = new BreakEvenManager();
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
    // FIX 2026-03-13: Use total equity (cash + position value), not just cash
    // Bug: Buying $1,250 BTC dropped cash 12.5%, triggering instant force-close
    if (context.accountBalance && context.initialBalance) {
      const positionValue = (context.currentPosition || 0) * (context.currentPrice || 0);
      const totalEquity = context.accountBalance + positionValue;
      const accountDrawdown = ((totalEquity - context.initialBalance) / context.initialBalance) * 100;
      if (accountDrawdown <= this.universalLimits.accountDrawdownPercent) {
        return {
          shouldExit: true,
          exitReason: 'account_drawdown',
          details: `Account drawdown: ${accountDrawdown.toFixed(2)}% <= ${this.universalLimits.accountDrawdownPercent}%`,
          confidence: 100
        };
      }
    }

    // === STRATEGY STOP LOSS (with break-even via BreakEvenManager) ===
    if (contract.stopLossPercent !== undefined) {
      // Phase 11: Query BreakEvenManager instead of inline computation
      const beState = this.breakEvenManager.evaluate(trade);
      const effectiveStop = beState.effectiveStopPercent;
      const breakEvenTriggered = beState.isBreakEven;

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
    return this.breakEvenManager.getEffectiveStop(trade);
  }
}

module.exports = StopLossChecker;
