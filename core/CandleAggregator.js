/**
 * CandleAggregator - Phase 3 of Modular Architecture Refactor
 *
 * PURPOSE: Builds higher timeframe candles from lower timeframe. Pure transformation.
 *
 * Self-contained: Yes - pure math, no external deps.
 * Hot-swap: Yes - can swap aggregation backend.
 *
 * @see ogz-meta/REFACTOR-PLAN-2026-02-27.md
 */

const { c: _c, o: _o, h: _h, l: _l, v: _v, t: _t } = require('./CandleHelper');

class CandleAggregator {
  constructor() {
    // Timeframe configs in milliseconds
    this.TIMEFRAME_MS = {
      '1m':  60000,
      '5m':  300000,
      '15m': 900000,
      '30m': 1800000,
      '1h':  3600000,
      '4h':  14400000,
      '1d':  86400000
    };
  }

  /**
   * Aggregate 1m candles into higher timeframe candles
   *
   * @param {Array} candles1m - Array of 1-minute candles
   * @param {string} targetTimeframe - Target timeframe ('5m', '15m', '1h', etc.)
   * @returns {Array} Aggregated candles
   */
  aggregate(candles1m, targetTimeframe) {
    if (!candles1m || candles1m.length === 0) {
      return [];
    }

    const intervalMs = this.TIMEFRAME_MS[targetTimeframe];
    if (!intervalMs) {
      throw new Error(`Unknown timeframe: ${targetTimeframe}`);
    }

    // Group candles by period
    const groups = new Map();

    for (const candle of candles1m) {
      const timestamp = _t(candle);
      const periodStart = Math.floor(timestamp / intervalMs) * intervalMs;

      if (!groups.has(periodStart)) {
        groups.set(periodStart, []);
      }
      groups.get(periodStart).push(candle);
    }

    // Build aggregated candles from groups
    const aggregated = [];
    for (const [periodStart, candlesInPeriod] of groups) {
      aggregated.push(this.buildCandle(candlesInPeriod, periodStart));
    }

    // Sort by timestamp
    aggregated.sort((a, b) => a.t - b.t);

    return aggregated;
  }

  /**
   * Build a single candle from array of candles
   *
   * @param {Array} candles - Array of candles to combine
   * @param {number} timestamp - Optional timestamp override for aggregated candle
   * @returns {Object} Single aggregated candle in Kraken format (t,o,h,l,c,v)
   */
  buildCandle(candles, timestamp = null) {
    if (!candles || candles.length === 0) {
      return null;
    }

    // First candle's open, last candle's close
    const open = _o(candles[0]);
    const close = _c(candles[candles.length - 1]);

    // High is max of all highs, low is min of all lows
    let high = _h(candles[0]);
    let low = _l(candles[0]);
    let volume = 0;

    for (const candle of candles) {
      high = Math.max(high, _h(candle));
      low = Math.min(low, _l(candle));
      volume += _v(candle) || 0;
    }

    return {
      t: timestamp !== null ? timestamp : _t(candles[0]),
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume
    };
  }

  /**
   * Check if a candle period is complete based on current timestamp
   *
   * @param {number} candleTimestamp - The candle's period start timestamp
   * @param {string} timeframe - The timeframe of the candle
   * @param {number} currentTimestamp - Current time (optional, defaults to now)
   * @returns {boolean} True if the period is complete
   */
  isPeriodComplete(candleTimestamp, timeframe, currentTimestamp = Date.now()) {
    const intervalMs = this.TIMEFRAME_MS[timeframe];
    if (!intervalMs) {
      return false;
    }

    const periodEnd = candleTimestamp + intervalMs;
    return currentTimestamp >= periodEnd;
  }

  /**
   * Get the period start timestamp for a given timestamp and timeframe
   *
   * @param {number} timestamp - Any timestamp within the period
   * @param {string} timeframe - The timeframe
   * @returns {number} The period start timestamp
   */
  getPeriodStart(timestamp, timeframe) {
    const intervalMs = this.TIMEFRAME_MS[timeframe];
    if (!intervalMs) {
      return timestamp;
    }

    return Math.floor(timestamp / intervalMs) * intervalMs;
  }

  /**
   * Get supported timeframes
   *
   * @returns {string[]} Array of supported timeframe strings
   */
  getSupportedTimeframes() {
    return Object.keys(this.TIMEFRAME_MS);
  }

  /**
   * Get interval in milliseconds for a timeframe
   *
   * @param {string} timeframe - The timeframe
   * @returns {number} Interval in milliseconds
   */
  getIntervalMs(timeframe) {
    return this.TIMEFRAME_MS[timeframe] || 0;
  }
}

module.exports = { CandleAggregator };
