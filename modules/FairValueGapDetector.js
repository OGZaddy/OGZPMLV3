// modules/FairValueGapDetector.js
'use strict';

const { c: _c, o: _o, h: _h, l: _l, v: _v, t: _t } = require('../core/CandleHelper');

/**
 * FairValueGapDetector
 *
 * Detects Fair Value Gaps (FVGs) in candle data.
 * An FVG is a 3-candle pattern where candle 1's wick and candle 3's wick
 * don't overlap, leaving an imbalance zone.
 *
 * BULLISH FVG: c3.low > c1.high (gap above)
 * BEARISH FVG: c3.high < c1.low (gap below)
 *
 * Source: opening-range-fvg-spec.md (Trey's ICT-style approach)
 *
 * @module modules/FairValueGapDetector
 */
class FairValueGapDetector {
  constructor(config = {}) {
    this.minFVGPercent = config.minFVGPercent || 0.05; // 0.05% minimum gap size
    this.maxFVGPercent = config.maxFVGPercent || 2.0;  // 2% max (filter extreme gaps)
  }

  /**
   * Detect FVGs in a candle array.
   * Returns the most recent FVG if found.
   *
   * @param {Array} candles - Array of candles (minimum 3)
   * @param {string} [directionFilter] - 'bullish', 'bearish', or null for both
   * @returns {Object|null} FVG details or null if none found
   */
  detect(candles, directionFilter = null) {
    if (!candles || candles.length < 3) {
      return null;
    }

    // Scan from most recent backwards to find latest FVG
    for (let i = candles.length - 1; i >= 2; i--) {
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];

      const fvg = this._checkFVG(c1, c2, c3);

      if (fvg && (!directionFilter || fvg.direction === directionFilter)) {
        return fvg;
      }
    }

    return null;
  }

  /**
   * Detect ALL FVGs in a candle array (not just the most recent).
   * Useful for visualization or analysis.
   *
   * @param {Array} candles - Array of candles
   * @param {string} [directionFilter] - 'bullish', 'bearish', or null
   * @returns {Array} Array of FVG objects
   */
  detectAll(candles, directionFilter = null) {
    if (!candles || candles.length < 3) {
      return [];
    }

    const fvgs = [];

    for (let i = 2; i < candles.length; i++) {
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];

      const fvg = this._checkFVG(c1, c2, c3);

      if (fvg && (!directionFilter || fvg.direction === directionFilter)) {
        fvg.index = i; // Track position in array
        fvgs.push(fvg);
      }
    }

    return fvgs;
  }

  /**
   * Check if 3 consecutive candles form an FVG.
   * @private
   */
  _checkFVG(c1, c2, c3) {
    const c1High = _h(c1);
    const c1Low = _l(c1);
    const c3High = _h(c3);
    const c3Low = _l(c3);

    // Use c2 close as reference price for percentage calculation
    const refPrice = _c(c2);
    if (!refPrice || refPrice <= 0) return null;

    // BULLISH FVG: candle 3 low is above candle 1 high
    // Gap zone: c1.high to c3.low
    if (c3Low > c1High) {
      const gapLow = c1High;
      const gapHigh = c3Low;
      const gapSize = gapHigh - gapLow;
      const gapPercent = (gapSize / refPrice) * 100;

      // Filter by minimum/maximum size
      if (gapPercent >= this.minFVGPercent && gapPercent <= this.maxFVGPercent) {
        return {
          hasFVG: true,
          direction: 'bullish',
          gapHigh: gapHigh,
          gapLow: gapLow,
          midpoint: (gapHigh + gapLow) / 2,
          gapSize: gapSize,
          gapPercent: gapPercent,
          firstCandleHigh: c1High,
          firstCandleLow: c1Low,  // Stop goes here for bullish
          timestamp: _t(c3),
        };
      }
    }

    // BEARISH FVG: candle 3 high is below candle 1 low
    // Gap zone: c3.high to c1.low
    if (c3High < c1Low) {
      const gapLow = c3High;
      const gapHigh = c1Low;
      const gapSize = gapHigh - gapLow;
      const gapPercent = (gapSize / refPrice) * 100;

      // Filter by minimum/maximum size
      if (gapPercent >= this.minFVGPercent && gapPercent <= this.maxFVGPercent) {
        return {
          hasFVG: true,
          direction: 'bearish',
          gapHigh: gapHigh,
          gapLow: gapLow,
          midpoint: (gapHigh + gapLow) / 2,
          gapSize: gapSize,
          gapPercent: gapPercent,
          firstCandleHigh: c1High,  // Stop goes here for bearish
          firstCandleLow: c1Low,
          timestamp: _t(c3),
        };
      }
    }

    return null;
  }

  /**
   * Check if price has filled (entered) an FVG zone.
   *
   * @param {Object} fvg - FVG object from detect()
   * @param {Object} candle - Current candle to check
   * @returns {boolean} True if candle's range touched the FVG zone
   */
  isFilled(fvg, candle) {
    if (!fvg || !candle) return false;

    const candleHigh = _h(candle);
    const candleLow = _l(candle);

    // FVG is filled if candle's range overlaps the gap
    return candleLow <= fvg.gapHigh && candleHigh >= fvg.gapLow;
  }

  /**
   * Calculate entry, stop, and target for a trade based on FVG.
   *
   * @param {Object} fvg - FVG object
   * @param {string} entryLevel - 'top', 'middle', or 'bottom'
   * @param {number} stopBufferPct - Buffer to add beyond stop level
   * @param {number} targetRR - Risk:Reward ratio for target
   * @returns {Object} { entry, stop, target, risk }
   */
  calculateLevels(fvg, entryLevel = 'top', stopBufferPct = 0.05, targetRR = 2.0) {
    if (!fvg) return null;

    let entry;
    if (entryLevel === 'top') {
      entry = fvg.direction === 'bullish' ? fvg.gapHigh : fvg.gapLow;
    } else if (entryLevel === 'bottom') {
      entry = fvg.direction === 'bullish' ? fvg.gapLow : fvg.gapHigh;
    } else {
      entry = fvg.midpoint;
    }

    let stop;
    if (fvg.direction === 'bullish') {
      // Stop below first candle low
      stop = fvg.firstCandleLow * (1 - stopBufferPct / 100);
    } else {
      // Stop above first candle high
      stop = fvg.firstCandleHigh * (1 + stopBufferPct / 100);
    }

    const risk = Math.abs(entry - stop);

    let target;
    if (fvg.direction === 'bullish') {
      target = entry + (risk * targetRR);
    } else {
      target = entry - (risk * targetRR);
    }

    return {
      entry: entry,
      stop: stop,
      target: target,
      risk: risk,
      riskPercent: (risk / entry) * 100,
      direction: fvg.direction,
    };
  }
}

module.exports = FairValueGapDetector;
