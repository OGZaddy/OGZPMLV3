/**
 * ============================================================================
 * CandleHelper.js - Universal Candle Property Accessor
 * ============================================================================
 *
 * PURPOSE: Handle both Kraken format (.c/.o/.h/.l/.v) and standard format
 *          (.close/.open/.high/.low/.volume) seamlessly across the codebase.
 *
 * WHY THIS EXISTS:
 * - Kraken WebSocket sends: { c: 95000, o: 94800, h: 95100, l: 94700, v: 123 }
 * - Backtest/historical data uses: { close: 95000, open: 94800, high: 95100, low: 94700, volume: 123 }
 * - Without this helper, backtest fails with "Cannot read properties of undefined"
 *
 * USAGE:
 *   const { c, o, h, l, v } = require('./CandleHelper');
 *   const price = c(candle);  // Works with either format
 *
 * FIX DATE: 2026-02-16
 * ROOT CAUSE: Months of backtest failures due to format mismatch
 * ============================================================================
 */

module.exports = {
  /**
   * Get close price from candle (handles both formats)
   * @param {Object} candle - Candle object with .c or .close
   * @returns {number} Close price
   */
  c: (candle) => candle?.close ?? candle?.c,

  /**
   * Get open price from candle (handles both formats)
   * @param {Object} candle - Candle object with .o or .open
   * @returns {number} Open price
   */
  o: (candle) => candle?.open ?? candle?.o,

  /**
   * Get high price from candle (handles both formats)
   * @param {Object} candle - Candle object with .h or .high
   * @returns {number} High price
   */
  h: (candle) => candle?.high ?? candle?.h,

  /**
   * Get low price from candle (handles both formats)
   * @param {Object} candle - Candle object with .l or .low
   * @returns {number} Low price
   */
  l: (candle) => candle?.low ?? candle?.l,

  /**
   * Get volume from candle (handles both formats, defaults to 0)
   * @param {Object} candle - Candle object with .v or .volume
   * @returns {number} Volume (0 if not present)
   */
  v: (candle) => candle?.volume ?? candle?.v ?? 0,

  /**
   * Get timestamp from candle (handles both formats)
   * @param {Object} candle - Candle object with .t or .timestamp or .time
   * @returns {number} Timestamp
   */
  t: (candle) => candle?.timestamp ?? candle?.time ?? candle?.t,

  /**
   * Normalize candle to standard format (useful for storage/logging)
   * @param {Object} candle - Any format candle
   * @returns {Object} Normalized candle with all standard properties
   */
  normalize: (candle) => ({
    open: candle?.open ?? candle?.o,
    high: candle?.high ?? candle?.h,
    low: candle?.low ?? candle?.l,
    close: candle?.close ?? candle?.c,
    volume: candle?.volume ?? candle?.v ?? 0,
    timestamp: candle?.timestamp ?? candle?.time ?? candle?.t
  })
};
