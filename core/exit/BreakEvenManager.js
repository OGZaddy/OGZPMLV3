/**
 * BreakEvenManager.js - Break-Even Stop State Machine
 * ====================================================
 * Single source of truth for break-even state.
 * When trade profits exceed initial risk (1:1 move), stop moves to entry.
 *
 * STATE MACHINE:
 *   INITIAL_STOP → (maxProfit >= risk) → BREAK_EVEN → (trailing takes over)
 *
 * USED BY:
 *   - StopLossChecker: queries getEffectiveStop() instead of computing BE inline
 *   - TrailingStopChecker: queries isBreakEven() to adjust trail baseline
 *   - ExitContractManager: calls evaluate() each tick
 *
 * @module core/exit/BreakEvenManager
 */

'use strict';

// Fee buffer: stop moves to entry minus this, so a BE exit still covers fees
const BE_FEE_BUFFER_PERCENT = 0.05; // -0.05% below entry

class BreakEvenManager {
  /**
   * Evaluate break-even state for a trade
   * Call this BEFORE StopLossChecker and TrailingStopChecker each tick.
   *
   * @param {Object} trade - Trade object with exitContract, maxProfitPercent, entryPrice
   * @returns {Object} {
   *   isBreakEven: boolean,        - Whether BE is currently active
   *   effectiveStopPercent: number, - The stop to use (-0.05 if BE, else contract SL)
   *   reason: string               - Why this state
   * }
   */
  evaluate(trade) {
    const contract = trade.exitContract || {};
    const stopLossPercent = contract.stopLossPercent;

    // No contract or no SL defined — can't compute BE
    if (stopLossPercent === undefined || stopLossPercent === null) {
      return {
        isBreakEven: false,
        effectiveStopPercent: null,
        reason: 'no_contract'
      };
    }

    const riskAmount = Math.abs(stopLossPercent);
    const maxProfit = trade.maxProfitPercent || 0;

    // Break-even triggers when maxProfit >= initial risk (1:1 payoff)
    if (maxProfit >= riskAmount) {
      return {
        isBreakEven: true,
        effectiveStopPercent: -BE_FEE_BUFFER_PERCENT,
        reason: `BE active: peak ${maxProfit.toFixed(2)}% >= risk ${riskAmount.toFixed(2)}%`
      };
    }

    return {
      isBreakEven: false,
      effectiveStopPercent: stopLossPercent,
      reason: `Needs ${(riskAmount - maxProfit).toFixed(2)}% more to trigger BE`
    };
  }

  /**
   * Check if break-even threshold has been reached
   * @param {Object} trade
   * @returns {boolean}
   */
  isTriggered(trade) {
    const contract = trade.exitContract || {};
    const riskAmount = Math.abs(contract.stopLossPercent || 1.0);
    return (trade.maxProfitPercent || 0) >= riskAmount;
  }

  /**
   * Get effective stop loss percent (accounts for break-even)
   * @param {Object} trade
   * @returns {number} Stop loss percent to use
   */
  getEffectiveStop(trade) {
    const result = this.evaluate(trade);
    return result.effectiveStopPercent;
  }

  /**
   * Get break-even price in dollars (for dashboard display)
   * @param {Object} trade - Trade with entryPrice
   * @param {number} [feeBufferPercent=0.05] - Buffer above entry for fees
   * @returns {number|null} Break-even price or null if not applicable
   */
  getBreakEvenPrice(trade, feeBufferPercent = BE_FEE_BUFFER_PERCENT) {
    if (!trade || !trade.entryPrice) return null;
    // BE price = entry price minus tiny buffer (long position)
    return trade.entryPrice * (1 - feeBufferPercent / 100);
  }
}

module.exports = BreakEvenManager;
