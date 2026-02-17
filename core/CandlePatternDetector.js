/**
 * CandlePatternDetector.js — Real Candlestick Pattern Recognition
 * 
 * 2026-02-12: Built from scratch to replace the fake "Learning Pattern" system.
 * Scans actual OHLCV candle data and identifies named chart patterns.
 * Returns pattern names that match the dashboard's SVG visualizations.
 * 
 * Detected patterns:
 *   Single candle:  hammer, shooting_star, doji, bullish_engulfing, bearish_engulfing
 *   Multi candle:   morning_star, evening_star, double_bottom, double_top
 *   Structure:      ascending_triangle, descending_triangle, head_shoulders, 
 *                   inverse_head_shoulders, flag, pennant, wedge
 */

'use strict';

const { c, o, h, l, v } = require('./CandleHelper');

class CandlePatternDetector {
  constructor() {
    this.detectedPatterns = [];
    this.lastDetection = null;
  }

  /**
   * Main entry: scan candles and return all detected patterns
   * @param {Array} candles - OHLCV candles [{o, h, l, c, v, t}, ...]
   * @param {Object} indicators - {rsi, trend, macd, volume}
   * @returns {Array} detected patterns [{name, confidence, direction, description}, ...]
   */
  detect(candles, indicators = {}) {
    if (!candles || candles.length < 5) return [];

    // Normalize candle format (handle both {o,h,l,c} and {open,high,low,close})
    const c = candles.map(candle => ({
      o: candle.o ?? candle.open ?? 0,
      h: candle.h ?? candle.high ?? 0,
      l: candle.l ?? candle.low ?? 0,
      c: candle.c ?? candle.close ?? 0,
      v: candle.v ?? candle.volume ?? 0,
      t: candle.t ?? candle.time ?? candle.timestamp ?? 0
    }));

    const patterns = [];

    // === SINGLE CANDLE PATTERNS (last 1-2 candles) ===
    if (c.length >= 2) {
      const curr = c[c.length - 1];
      const prev = c[c.length - 2];

      // Hammer (bullish reversal)
      const hammerResult = this._detectHammer(curr, prev, indicators);
      if (hammerResult) patterns.push(hammerResult);

      // Shooting Star (bearish reversal)
      const starResult = this._detectShootingStar(curr, prev, indicators);
      if (starResult) patterns.push(starResult);

      // Doji
      const dojiResult = this._detectDoji(curr);
      if (dojiResult) patterns.push(dojiResult);

      // Bullish Engulfing
      const bullEngulf = this._detectBullishEngulfing(curr, prev, indicators);
      if (bullEngulf) patterns.push(bullEngulf);

      // Bearish Engulfing
      const bearEngulf = this._detectBearishEngulfing(curr, prev, indicators);
      if (bearEngulf) patterns.push(bearEngulf);
    }

    // === THREE-CANDLE PATTERNS ===
    if (c.length >= 3) {
      const [a, b, curr] = c.slice(-3);

      const morningStar = this._detectMorningStar(a, b, curr);
      if (morningStar) patterns.push(morningStar);

      const eveningStar = this._detectEveningStar(a, b, curr);
      if (eveningStar) patterns.push(eveningStar);
    }

    // === MULTI-CANDLE STRUCTURE PATTERNS (need 20+ candles) ===
    if (c.length >= 20) {
      const recent = c.slice(-30); // Use last 30 candles for structure

      const dblBottom = this._detectDoubleBottom(recent);
      if (dblBottom) patterns.push(dblBottom);

      const dblTop = this._detectDoubleTop(recent);
      if (dblTop) patterns.push(dblTop);

      const ascTri = this._detectAscendingTriangle(recent);
      if (ascTri) patterns.push(ascTri);

      const descTri = this._detectDescendingTriangle(recent);
      if (descTri) patterns.push(descTri);

      const hs = this._detectHeadShoulders(recent);
      if (hs) patterns.push(hs);

      const ihs = this._detectInverseHeadShoulders(recent);
      if (ihs) patterns.push(ihs);
    }

    if (c.length >= 15) {
      const recent = c.slice(-20);

      const flag = this._detectFlag(recent);
      if (flag) patterns.push(flag);

      const wedge = this._detectWedge(recent);
      if (wedge) patterns.push(wedge);
    }

    // Sort by confidence descending
    patterns.sort((a, b) => b.confidence - a.confidence);

    this.detectedPatterns = patterns;
    this.lastDetection = Date.now();

    return patterns;
  }

  // ─── HELPERS ────────────────────────────────────────
  _bodySize(candle) { return Math.abs(c(candle) - o(candle)); }
  _range(candle) { return h(candle) - l(candle) || 0.001; }
  _isBullish(candle) { return c(candle) > o(candle); }
  _isBearish(candle) { return c(candle) < o(candle); }
  _upperWick(candle) { return h(candle) - Math.max(o(candle), c(candle)); }
  _lowerWick(candle) { return Math.min(o(candle), c(candle)) - l(candle); }
  _bodyRatio(candle) { return this._bodySize(candle) / this._range(candle); }
  _midpoint(candle) { return (o(candle) + c(candle)) / 2; }

  // ─── SINGLE CANDLE ─────────────────────────────────

  _detectHammer(curr, prev, indicators) {
    const body = this._bodySize(curr);
    const range = this._range(curr);
    const lowerWick = this._lowerWick(curr);
    const upperWick = this._upperWick(curr);

    // Hammer: small body at top, long lower wick (2x+ body), tiny upper wick
    if (lowerWick >= body * 2 && upperWick < body * 0.5 && body > range * 0.05) {
      // More confident if in downtrend
      const trendBonus = (indicators.trend === 'downtrend' || indicators.trend === 'bearish') ? 0.15 : 0;
      const rsiBonus = (indicators.rsi && indicators.rsi < 35) ? 0.1 : 0;
      const conf = Math.min(0.55 + trendBonus + rsiBonus + (lowerWick / range) * 0.2, 0.95);

      return {
        name: 'hammer',
        confidence: conf,
        direction: 'buy',
        description: `Hammer at $${c(curr).toFixed(2)} — lower wick ${(lowerWick/body).toFixed(1)}x body`
      };
    }
    return null;
  }

  _detectShootingStar(curr, prev, indicators) {
    const body = this._bodySize(curr);
    const range = this._range(curr);
    const upperWick = this._upperWick(curr);
    const lowerWick = this._lowerWick(curr);

    // Shooting star: small body at bottom, long upper wick, tiny lower wick
    if (upperWick >= body * 2 && lowerWick < body * 0.5 && body > range * 0.05) {
      const trendBonus = (indicators.trend === 'uptrend' || indicators.trend === 'bullish') ? 0.15 : 0;
      const rsiBonus = (indicators.rsi && indicators.rsi > 65) ? 0.1 : 0;
      const conf = Math.min(0.55 + trendBonus + rsiBonus + (upperWick / range) * 0.2, 0.95);

      return {
        name: 'shooting_star',
        confidence: conf,
        direction: 'sell',
        description: `Shooting star at $${c(curr).toFixed(2)} — upper wick ${(upperWick/body).toFixed(1)}x body`
      };
    }
    return null;
  }

  _detectDoji(curr) {
    const body = this._bodySize(curr);
    const range = this._range(curr);

    // Doji: body is less than 10% of range
    if (range > 0 && body / range < 0.1) {
      return {
        name: 'doji',
        confidence: 0.4,
        direction: 'neutral',
        description: `Doji at $${c(curr).toFixed(2)} — indecision, watch for breakout`
      };
    }
    return null;
  }

  _detectBullishEngulfing(curr, prev, indicators) {
    if (!this._isBullish(curr) || !this._isBearish(prev)) return null;

    const currBody = this._bodySize(curr);
    const prevBody = this._bodySize(prev);

    // Current green candle completely covers previous red candle
    if (o(curr) <= c(prev) && c(curr) >= o(prev) && currBody > prevBody * 1.2) {
      const ratio = currBody / prevBody;
      const trendBonus = (indicators.trend === 'downtrend' || indicators.trend === 'bearish') ? 0.15 : 0;
      const conf = Math.min(0.5 + Math.min(ratio * 0.1, 0.25) + trendBonus, 0.92);

      return {
        name: 'bullish_engulfing',
        confidence: conf,
        direction: 'buy',
        description: `Bullish engulfing — green candle ${ratio.toFixed(1)}x previous red`
      };
    }
    return null;
  }

  _detectBearishEngulfing(curr, prev, indicators) {
    if (!this._isBearish(curr) || !this._isBullish(prev)) return null;

    const currBody = this._bodySize(curr);
    const prevBody = this._bodySize(prev);

    if (o(curr) >= c(prev) && c(curr) <= o(prev) && currBody > prevBody * 1.2) {
      const ratio = currBody / prevBody;
      const trendBonus = (indicators.trend === 'uptrend' || indicators.trend === 'bullish') ? 0.15 : 0;
      const conf = Math.min(0.5 + Math.min(ratio * 0.1, 0.25) + trendBonus, 0.92);

      return {
        name: 'bearish_engulfing',
        confidence: conf,
        direction: 'sell',
        description: `Bearish engulfing — red candle ${ratio.toFixed(1)}x previous green`
      };
    }
    return null;
  }

  // ─── THREE-CANDLE ──────────────────────────────────

  _detectMorningStar(a, b, curr) {
    // Day 1: large red, Day 2: small body (gap down ideal), Day 3: large green
    if (!this._isBearish(a)) return null;
    
    const aBody = this._bodySize(a);
    const bBody = this._bodySize(b);
    const cBody = this._bodySize(curr);

    if (bBody < aBody * 0.4 && this._isBullish(curr) && cBody > aBody * 0.5) {
      const conf = Math.min(0.6 + (cBody / aBody) * 0.15, 0.88);
      return {
        name: 'morning_star',
        confidence: conf,
        direction: 'buy',
        description: 'Morning star — 3-candle bullish reversal forming'
      };
    }
    return null;
  }

  _detectEveningStar(a, b, curr) {
    if (!this._isBullish(a)) return null;

    const aBody = this._bodySize(a);
    const bBody = this._bodySize(b);
    const cBody = this._bodySize(curr);

    if (bBody < aBody * 0.4 && this._isBearish(curr) && cBody > aBody * 0.5) {
      const conf = Math.min(0.6 + (cBody / aBody) * 0.15, 0.88);
      return {
        name: 'evening_star',
        confidence: conf,
        direction: 'sell',
        description: 'Evening star — 3-candle bearish reversal forming'
      };
    }
    return null;
  }

  // ─── STRUCTURE PATTERNS ────────────────────────────

  _detectDoubleBottom(candles) {
    const lows = candles.map(candle => l(candle));
    const highs = candles.map(candle => h(candle));
    const avgRange = (Math.max(...highs) - Math.min(...lows)) || 1;
    const tolerance = avgRange * 0.02; // 2% of range

    // Find two lowest points that are near each other in price but separated in time
    let minIdx1 = -1, minIdx2 = -1;
    let minVal = Infinity;
    
    // First trough
    for (let i = 2; i < candles.length - 5; i++) {
      if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
        if (lows[i] < minVal) { minVal = lows[i]; minIdx1 = i; }
      }
    }
    if (minIdx1 < 0) return null;

    // Second trough (at least 5 candles apart)
    let min2Val = Infinity;
    for (let i = minIdx1 + 5; i < candles.length - 2; i++) {
      if (lows[i] < lows[i-1] && lows[i] < lows[i+1]) {
        if (Math.abs(lows[i] - minVal) < tolerance && lows[i] < min2Val) {
          min2Val = lows[i]; minIdx2 = i;
        }
      }
    }
    if (minIdx2 < 0) return null;

    // Check there's a peak between them
    const midHigh = Math.max(...highs.slice(minIdx1, minIdx2 + 1));
    const necklineDistance = midHigh - minVal;
    if (necklineDistance < avgRange * 0.03) return null;

    // Last candle should be recovering (above midpoint)
    const lastClose = c(candles[candles.length - 1]);
    if (lastClose < minVal + necklineDistance * 0.3) return null;

    const conf = Math.min(0.55 + (necklineDistance / avgRange) * 0.3, 0.85);
    return {
      name: 'double_bottom',
      confidence: conf,
      direction: 'buy',
      description: `Double bottom at $${minVal.toFixed(2)} — support tested twice, recovery underway`
    };
  }

  _detectDoubleTop(candles) {
    const highs = candles.map(candle => h(candle));
    const lows = candles.map(candle => l(candle));
    const avgRange = (Math.max(...highs) - Math.min(...lows)) || 1;
    const tolerance = avgRange * 0.02;

    let maxIdx1 = -1, maxIdx2 = -1;
    let maxVal = -Infinity;

    for (let i = 2; i < candles.length - 5; i++) {
      if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
        if (highs[i] > maxVal) { maxVal = highs[i]; maxIdx1 = i; }
      }
    }
    if (maxIdx1 < 0) return null;

    let max2Val = -Infinity;
    for (let i = maxIdx1 + 5; i < candles.length - 2; i++) {
      if (highs[i] > highs[i-1] && highs[i] > highs[i+1]) {
        if (Math.abs(highs[i] - maxVal) < tolerance && highs[i] > max2Val) {
          max2Val = highs[i]; maxIdx2 = i;
        }
      }
    }
    if (maxIdx2 < 0) return null;

    const midLow = Math.min(...lows.slice(maxIdx1, maxIdx2 + 1));
    const necklineDistance = maxVal - midLow;
    if (necklineDistance < avgRange * 0.03) return null;

    const lastClose = c(candles[candles.length - 1]);
    if (lastClose > maxVal - necklineDistance * 0.3) return null;

    const conf = Math.min(0.55 + (necklineDistance / avgRange) * 0.3, 0.85);
    return {
      name: 'double_top',
      confidence: conf,
      direction: 'sell',
      description: `Double top at $${maxVal.toFixed(2)} — resistance rejected twice, decline likely`
    };
  }

  _detectAscendingTriangle(candles) {
    const highs = candles.map(candle => h(candle));
    const lows = candles.map(candle => l(candle));

    // Flat resistance (highs are consistent)
    const recentHighs = highs.slice(-10);
    const highRange = Math.max(...recentHighs) - Math.min(...recentHighs);
    const avgPrice = c(candles[candles.length-1]);
    const relHighRange = highRange / avgPrice;

    // Rising lows
    const q1Lows = lows.slice(0, Math.floor(candles.length / 2));
    const q2Lows = lows.slice(Math.floor(candles.length / 2));
    const avgQ1Low = q1Lows.reduce((a,b) => a+b, 0) / q1Lows.length;
    const avgQ2Low = q2Lows.reduce((a,b) => a+b, 0) / q2Lows.length;

    // Flat top (< 1% range) + rising bottom
    if (relHighRange < 0.01 && avgQ2Low > avgQ1Low * 1.005) {
      const slopeStrength = (avgQ2Low - avgQ1Low) / avgQ1Low;
      const conf = Math.min(0.5 + slopeStrength * 10 + (0.01 - relHighRange) * 20, 0.85);
      return {
        name: 'ascending_triangle',
        confidence: conf,
        direction: 'buy',
        description: `Ascending triangle — flat resistance, higher lows building pressure`
      };
    }
    return null;
  }

  _detectDescendingTriangle(candles) {
    const highs = candles.map(candle => h(candle));
    const lows = candles.map(candle => l(candle));

    const recentLows = lows.slice(-10);
    const lowRange = Math.max(...recentLows) - Math.min(...recentLows);
    const avgPrice = c(candles[candles.length-1]);
    const relLowRange = lowRange / avgPrice;

    const q1Highs = highs.slice(0, Math.floor(candles.length / 2));
    const q2Highs = highs.slice(Math.floor(candles.length / 2));
    const avgQ1High = q1Highs.reduce((a,b) => a+b, 0) / q1Highs.length;
    const avgQ2High = q2Highs.reduce((a,b) => a+b, 0) / q2Highs.length;

    if (relLowRange < 0.01 && avgQ2High < avgQ1High * 0.995) {
      const slopeStrength = (avgQ1High - avgQ2High) / avgQ1High;
      const conf = Math.min(0.5 + slopeStrength * 10 + (0.01 - relLowRange) * 20, 0.85);
      return {
        name: 'descending_triangle',
        confidence: conf,
        direction: 'sell',
        description: `Descending triangle — flat support, lower highs increasing sell pressure`
      };
    }
    return null;
  }

  _detectHeadShoulders(candles) {
    // Find 3 peaks: left shoulder, head (highest), right shoulder
    const highs = candles.map(candle => h(candle));
    const peaks = this._findPeaks(highs, 3);
    
    if (peaks.length < 3) return null;

    // Head must be highest, shoulders roughly equal
    const sorted = [...peaks].sort((a, b) => highs[b] - highs[a]);
    const headIdx = sorted[0];
    const shoulders = sorted.slice(1, 3).sort((a, b) => a - b);
    
    // Head in middle, shoulders on sides
    if (headIdx <= shoulders[0] || headIdx >= shoulders[1]) return null;

    const headHeight = highs[headIdx];
    const lShoulder = highs[shoulders[0]];
    const rShoulder = highs[shoulders[1]];
    
    // Shoulders within 3% of each other
    const shoulderDiff = Math.abs(lShoulder - rShoulder) / ((lShoulder + rShoulder) / 2);
    if (shoulderDiff > 0.03) return null;

    // Head meaningfully higher than shoulders
    const headProminence = (headHeight - (lShoulder + rShoulder) / 2) / headHeight;
    if (headProminence < 0.005) return null;

    const conf = Math.min(0.55 + (1 - shoulderDiff) * 0.15 + headProminence * 5, 0.88);
    return {
      name: 'head_shoulders',
      confidence: conf,
      direction: 'sell',
      description: `Head & Shoulders top at $${headHeight.toFixed(2)} — classic reversal forming`
    };
  }

  _detectInverseHeadShoulders(candles) {
    const lows = candles.map(candle => l(candle));
    const troughs = this._findTroughs(lows, 3);
    
    if (troughs.length < 3) return null;

    const sorted = [...troughs].sort((a, b) => lows[a] - lows[b]);
    const headIdx = sorted[0]; // Lowest
    const shoulders = sorted.slice(1, 3).sort((a, b) => a - b);

    if (headIdx <= shoulders[0] || headIdx >= shoulders[1]) return null;

    const headLow = lows[headIdx];
    const lShoulder = lows[shoulders[0]];
    const rShoulder = lows[shoulders[1]];

    const shoulderDiff = Math.abs(lShoulder - rShoulder) / ((lShoulder + rShoulder) / 2);
    if (shoulderDiff > 0.03) return null;

    const headProminence = ((lShoulder + rShoulder) / 2 - headLow) / headLow;
    if (headProminence < 0.005) return null;

    const conf = Math.min(0.55 + (1 - shoulderDiff) * 0.15 + headProminence * 5, 0.88);
    return {
      name: 'inverse_head_shoulders',
      confidence: conf,
      direction: 'buy',
      description: `Inverse H&S bottom at $${headLow.toFixed(2)} — bullish reversal forming`
    };
  }

  _detectFlag(candles) {
    // Strong move (pole) followed by small counter-trend consolidation (flag)
    const pole = candles.slice(0, Math.floor(candles.length * 0.4));
    const flag = candles.slice(Math.floor(candles.length * 0.4));

    const poleMove = c(pole[pole.length-1]) - c(pole[0]);
    const poleRange = Math.abs(poleMove);
    const avgPrice = c(candles[candles.length-1]);
    const relPole = poleRange / avgPrice;
    
    if (relPole < 0.01) return null; // Need meaningful pole

    // Flag should be tight consolidation
    const flagHighs = flag.map(candle => h(candle));
    const flagLows = flag.map(candle => l(candle));
    const flagRange = Math.max(...flagHighs) - Math.min(...flagLows);
    const relFlag = flagRange / avgPrice;

    // Flag range should be < 50% of pole
    if (flagRange > poleRange * 0.5) return null;
    // Flag should be at least somewhat tight
    if (relFlag > 0.015) return null;

    const direction = poleMove > 0 ? 'buy' : 'sell';
    const conf = Math.min(0.5 + (1 - flagRange / poleRange) * 0.25, 0.82);

    return {
      name: 'flag',
      confidence: conf,
      direction,
      description: `${direction === 'buy' ? 'Bull' : 'Bear'} flag — consolidation after ${(relPole*100).toFixed(1)}% move`
    };
  }

  _detectWedge(candles) {
    const highs = candles.map(candle => h(candle));
    const lows = candles.map(candle => l(candle));

    // Linear regression on highs and lows
    const n = candles.length;
    const highSlope = this._linearSlope(highs);
    const lowSlope = this._linearSlope(lows);

    // Converging: slopes have opposite signs or both pointing same way but converging
    const converging = (highSlope < 0 && lowSlope > 0) || 
                       (Math.abs(highSlope) + Math.abs(lowSlope) > 0 && 
                        Math.abs(highSlope - lowSlope) < Math.abs(highSlope) + Math.abs(lowSlope));

    // Range is narrowing over time
    const earlyRange = highs.slice(0, 5).reduce((a,b)=>a+b,0)/5 - lows.slice(0, 5).reduce((a,b)=>a+b,0)/5;
    const lateRange = highs.slice(-5).reduce((a,b)=>a+b,0)/5 - lows.slice(-5).reduce((a,b)=>a+b,0)/5;

    if (lateRange < earlyRange * 0.7 && converging) {
      const compression = 1 - (lateRange / earlyRange);
      const direction = lowSlope > 0 ? 'buy' : highSlope < 0 ? 'sell' : 'neutral';
      const conf = Math.min(0.45 + compression * 0.4, 0.8);

      return {
        name: 'wedge',
        confidence: conf,
        direction,
        description: `Wedge compression ${(compression*100).toFixed(0)}% — breakout imminent`
      };
    }
    return null;
  }

  // ─── UTILITIES ─────────────────────────────────────

  _findPeaks(data, minPeaks = 3) {
    const peaks = [];
    for (let i = 2; i < data.length - 2; i++) {
      if (data[i] > data[i-1] && data[i] > data[i-2] && data[i] > data[i+1] && data[i] > data[i+2]) {
        peaks.push(i);
      }
    }
    return peaks.slice(-minPeaks - 2); // Return recent peaks
  }

  _findTroughs(data, minTroughs = 3) {
    const troughs = [];
    for (let i = 2; i < data.length - 2; i++) {
      if (data[i] < data[i-1] && data[i] < data[i-2] && data[i] < data[i+1] && data[i] < data[i+2]) {
        troughs.push(i);
      }
    }
    return troughs.slice(-minTroughs - 2);
  }

  _linearSlope(data) {
    const n = data.length;
    if (n < 2) return 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i; sumY += data[i]; sumXY += i * data[i]; sumXX += i * i;
    }
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }
}

module.exports = CandlePatternDetector;
