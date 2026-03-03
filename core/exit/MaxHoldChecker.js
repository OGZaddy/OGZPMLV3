/**
 * MaxHoldChecker.js - Maximum Hold Time Exit Condition
 * ====================================================
 * Checks both universal and strategy-specific max hold times.
 * Tags exits as winner/loser based on NET P&L (after fees).
 *
 * FIX 2026-02-28: Use net PnL (after 0.52% round-trip fees) not raw PnL
 *
 * @module core/exit/MaxHoldChecker
 */

'use strict';

const ROUND_TRIP_FEE = 0.52; // 0.26% × 2 sides (Kraken)

class MaxHoldChecker {
  /**
   * @param {Object} universalLimits - { maxHoldTimeMinutes }
   */
  constructor(universalLimits) {
    this.universalLimits = universalLimits;
  }

  /**
   * Check max hold time conditions
   * @param {Object} trade - Trade object with entryTime, exitContract
   * @param {number} holdTimeMinutes - Minutes since entry
   * @param {number} pnlPercent - Current P&L as percentage
   * @returns {Object} { shouldExit, exitReason, details, confidence } or { shouldExit: false }
   */
  check(trade, holdTimeMinutes, pnlPercent) {
    const contract = trade.exitContract || {};

    // === UNIVERSAL MAX HOLD (always checked first) ===
    if (holdTimeMinutes >= this.universalLimits.maxHoldTimeMinutes) {
      return {
        shouldExit: true,
        exitReason: 'max_hold_universal',
        details: `Universal max hold: ${holdTimeMinutes.toFixed(0)} min >= ${this.universalLimits.maxHoldTimeMinutes} min`,
        confidence: 100
      };
    }

    // === STRATEGY-SPECIFIC MAX HOLD ===
    if (contract.maxHoldTimeMinutes && holdTimeMinutes >= contract.maxHoldTimeMinutes) {
      // Tag as winner only if P&L exceeds round-trip fees
      const holdExitType = pnlPercent > ROUND_TRIP_FEE ? 'max_hold_winner' : 'max_hold_loser';
      return {
        shouldExit: true,
        exitReason: holdExitType,
        details: `${trade.entryStrategy || 'Strategy'} max hold: ${holdTimeMinutes.toFixed(0)} min >= ${contract.maxHoldTimeMinutes} min (P&L ${pnlPercent.toFixed(2)}%)`,
        confidence: 80
      };
    }

    return { shouldExit: false };
  }
}

module.exports = MaxHoldChecker;
