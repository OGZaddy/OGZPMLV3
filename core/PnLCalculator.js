/**
 * PnLCalculator - Direction-aware P&L Math
 *
 * Phase 13: Extracted from run-empire-v2.js
 *
 * SINGLE RESPONSIBILITY: Calculate profit/loss for trades
 * with proper direction handling and fee deduction.
 *
 * Longs: (current - entry) / entry
 * Shorts: (entry - current) / entry
 *
 * @module core/PnLCalculator
 */

'use strict';

const TradingConfig = require('./TradingConfig');

class PnLCalculator {
  constructor(options = {}) {
    // Round-trip fee from TradingConfig (maker + taker)
    this.feePercent = options.feePercent || TradingConfig.get('fees.totalRoundTrip');
    this.feeBuffer = options.feeBuffer || 0.35; // % profit needed to cover fees

    console.log('[PnLCalculator] Initialized (Phase 13)');
  }

  /**
   * Calculate P&L percentage for a trade
   *
   * @param {number} entryPrice - Entry price
   * @param {number} currentPrice - Current/exit price
   * @param {string} side - 'long' or 'short'
   * @returns {number} P&L as percentage (e.g., 1.5 = 1.5%)
   */
  calculatePnLPercent(entryPrice, currentPrice, side = 'long') {
    if (!entryPrice || entryPrice <= 0) {
      console.warn('[PnLCalculator] Invalid entry price:', entryPrice);
      return 0;
    }

    if (side === 'short') {
      // Shorts profit when price goes DOWN
      return ((entryPrice - currentPrice) / entryPrice) * 100;
    }

    // Longs profit when price goes UP (default)
    return ((currentPrice - entryPrice) / entryPrice) * 100;
  }

  /**
   * Calculate P&L in dollars
   *
   * @param {number} entryPrice - Entry price
   * @param {number} currentPrice - Current/exit price
   * @param {number} size - Position size in base currency (e.g., BTC)
   * @param {string} side - 'long' or 'short'
   * @returns {number} P&L in dollars
   */
  calculatePnLDollars(entryPrice, currentPrice, size, side = 'long') {
    if (side === 'short') {
      // Shorts: profit = size * (entry - current)
      return size * (entryPrice - currentPrice);
    }

    // Longs: profit = size * (current - entry)
    return size * (currentPrice - entryPrice);
  }

  /**
   * Calculate P&L after fees
   *
   * @param {number} entryPrice - Entry price
   * @param {number} currentPrice - Current/exit price
   * @param {number} size - Position size in base currency
   * @param {string} side - 'long' or 'short'
   * @returns {Object} { grossPnL, fees, netPnL, netPnLPercent }
   */
  calculateNetPnL(entryPrice, currentPrice, size, side = 'long') {
    const grossPnL = this.calculatePnLDollars(entryPrice, currentPrice, size, side);
    const entryValue = size * entryPrice;
    const exitValue = size * currentPrice;
    const totalValue = entryValue + exitValue;

    // Fees on both entry and exit
    const fees = totalValue * (this.feePercent / 2); // Split fee across both legs

    const netPnL = grossPnL - fees;
    const netPnLPercent = entryValue > 0 ? (netPnL / entryValue) * 100 : 0;

    return {
      grossPnL,
      fees,
      netPnL,
      netPnLPercent,
      grossPnLPercent: this.calculatePnLPercent(entryPrice, currentPrice, side)
    };
  }

  /**
   * Check if trade is profitable after fees
   *
   * @param {number} pnlPercent - Gross P&L percentage
   * @returns {boolean} True if profit covers fees
   */
  isProfitableAfterFees(pnlPercent) {
    return pnlPercent > this.feeBuffer;
  }

  /**
   * Calculate break-even price (price needed to cover fees)
   *
   * @param {number} entryPrice - Entry price
   * @param {string} side - 'long' or 'short'
   * @returns {number} Break-even price
   */
  calculateBreakEven(entryPrice, side = 'long') {
    const feeMultiplier = 1 + (this.feePercent / 100);

    if (side === 'short') {
      // Shorts need price to go DOWN to break even
      return entryPrice / feeMultiplier;
    }

    // Longs need price to go UP to break even
    return entryPrice * feeMultiplier;
  }

  /**
   * Get fee configuration
   */
  getFeeConfig() {
    return {
      feePercent: this.feePercent,
      feeBuffer: this.feeBuffer,
      roundTripFee: this.feePercent * 100 + '%'
    };
  }
}

module.exports = PnLCalculator;
