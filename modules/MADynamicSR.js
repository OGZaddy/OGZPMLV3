/**
 * MADynamicSR.js — Trader DNA Strategy Implementation
 * =====================================================
 * Based on "3 EMA Strategies That NEVER LOSE" by Trader DNA
 *
 * ENTRY REQUIREMENTS (ALL must be true):
 * 1. 123 Pattern confirmed (HH/HL for longs, LH/LL for shorts)
 * 2. Price pulls back to 50 EMA
 * 3. 50 EMA aligns with previous S/R zone (tested multiple times)
 * 4. Confirmation candle appears (hammer, engulfing, shooting star)
 *
 * EXIT: 1:3 Risk/Reward ratio
 */

'use strict';

const { c, o, h, l } = require('../core/CandleHelper');

class MADynamicSR {
  constructor(config = {}) {
    // EMA periods per Trader DNA / EMACalibrator results
    // 50 EMA for entries (pullback trigger)
    // 200 EMA for trend direction (big picture)
    this.emaPeriod = config.emaPeriod || 50;
    this.trendEmaPeriod = config.trendEmaPeriod || 200;

    // Swing detection settings
    this.swingLookback = config.swingLookback || 3;   // Bars to confirm swing (3 for 15m)
    this.srTestCount = config.srTestCount || 2;       // Times a level must be tested
    this.srZonePct = config.srZonePct || 1.0;         // Zone width as % of price (FIX: widened)

    // Touch detection - FIX: 0.6% allows more touches without threading needle
    this.touchZonePct = config.touchZonePct || 0.6;

    // Pattern persistence
    this.patternPersistBars = config.patternPersistBars || 15;  // Pattern stays valid for N bars

    // State tracking
    this.swings = [];           // Array of { type: 'high'|'low', price, bar, wick }
    this.srLevels = [];         // Array of { price, tests, lastTest }
    this.pattern123 = null;     // Current 123 pattern state
    this.patternDetectedBar = 0; // When pattern was detected
    this.lastSignal = null;
    this.barCount = 0;

    // Diagnostic counters
    this.diag = {
      trendBullish: 0,
      trendBearish: 0,
      patternUptrend: 0,
      patternDowntrend: 0,
      emaTouches: 0,
      srAligned: 0,
      confirmBullish: 0,
      confirmBearish: 0,
      allAlignedLong: 0,
      allAlignedShort: 0
    };

    console.log(`📐 MADynamicSR initialized (Trader DNA strategy) - Entry EMA: ${this.emaPeriod}, Trend EMA: ${this.trendEmaPeriod}`);
  }

  /**
   * Main update - call on each candle
   */
  update(candle, priceHistory) {
    // Need enough history for 200 EMA + swing detection
    const minBars = Math.max(this.emaPeriod, this.trendEmaPeriod) + 20;
    if (!priceHistory || priceHistory.length < minBars) {
      return this._emptySignal();
    }

    this.barCount++;
    const closes = priceHistory.map(x => c(x));
    const price = c(candle);
    const high = h(candle);
    const low = l(candle);
    const open = o(candle);

    // Calculate EMAs
    const ema50 = this._ema(closes, this.emaPeriod);
    const ema200 = this._ema(closes, this.trendEmaPeriod);
    if (!ema50 || !ema200) return this._emptySignal();

    // 200 EMA determines overall trend direction
    const trendBullish = price > ema200;
    const trendBearish = price < ema200;

    // Track diagnostics
    if (trendBullish) this.diag.trendBullish++;
    if (trendBearish) this.diag.trendBearish++;

    // Step 1: Detect swing highs and lows
    this._detectSwings(priceHistory);

    // Step 2: Build S/R levels from swings
    this._updateSRLevels();

    // Step 3: Check for 123 pattern (now cached in _detect123Pattern)
    const pattern = this._detect123Pattern();
    this.pattern123 = pattern;  // Cache for next call
    if (pattern === 'uptrend') this.diag.patternUptrend++;
    if (pattern === 'downtrend') this.diag.patternDowntrend++;

    // Step 4: Check if price is touching 50 EMA
    const touchingEMA = this._isTouchingEMA(price, ema50);
    if (touchingEMA) this.diag.emaTouches++;

    // Step 5: Check if current price aligns with S/R zone
    const srAlignment = this._checkSRAlignment(price);
    if (srAlignment.aligned) this.diag.srAligned++;

    // Step 6: Check for confirmation candle
    const confirmation = this._checkConfirmationCandle(candle, priceHistory);
    if (confirmation.bullish) this.diag.confirmBullish++;
    if (confirmation.bearish) this.diag.confirmBearish++;

    // Build signal
    let direction = 'neutral';
    let confidence = 0;
    let reason = '';

    // Per Trader DNA: 200 EMA = trend, 50 EMA = entries
    // "uptrend above 200 EMA, wait for pullback to 50 EMA,
    // if the 50 EMA is on support/resistance zone and you get bullish engulfing = money"
    //
    // FILTER STACK:
    // 1. 200 EMA trend filter (price above = bullish, below = bearish)
    // 2. 123 pattern confirmed (HH/HL or LH/LL)
    // 3. Price touching 50 EMA (the "pullback")
    // 4. Confirmation candle
    // BONUS: S/R zone alignment

    // LONG SETUP - must be in bullish trend (above 200 EMA)
    if (trendBullish && pattern === 'uptrend' && touchingEMA && confirmation.bullish) {
      this.diag.allAlignedLong++;
      direction = 'buy';
      confidence = 0.55;  // Base confidence for core setup
      confidence += confirmation.strength * 0.20;
      if (srAlignment.aligned) {
        confidence += Math.min(0.20, srAlignment.tests * 0.08);
      }
      const srNote = srAlignment.aligned ? ` + S/R (${srAlignment.tests}x)` : '';
      reason = `SNIPER LONG: 200 EMA bullish + 123 uptrend + 50 EMA pullback + ${confirmation.pattern}${srNote}`;
    }
    // SHORT SETUP - must be in bearish trend (below 200 EMA)
    else if (trendBearish && pattern === 'downtrend' && touchingEMA && confirmation.bearish) {
      this.diag.allAlignedShort++;
      direction = 'sell';
      confidence = 0.55;
      confidence += confirmation.strength * 0.20;
      if (srAlignment.aligned) {
        confidence += Math.min(0.20, srAlignment.tests * 0.08);
      }
      const srNote = srAlignment.aligned ? ` + S/R (${srAlignment.tests}x)` : '';
      reason = `SNIPER SHORT: 200 EMA bearish + 123 downtrend + 50 EMA pullback + ${confirmation.pattern}${srNote}`;
    }

    // Calculate 1:2 R:R levels if we have a signal
    // FIX 2026-02-23: Cap structural stops to reasonable range (max 1.5% from entry)
    // Old code used Math.min/max which picked extreme swings from weeks ago
    let stopLoss = null;
    let takeProfit = null;
    const MAX_STOP_PCT = 0.015; // 1.5% max stop distance

    if (direction !== 'neutral') {
      const recentSwings = this.swings.slice(-5);  // Only very recent swings
      if (direction === 'buy') {
        // Find nearest swing low BELOW current price (not the absolute minimum)
        const lows = recentSwings
          .filter(s => s.type === 'low' && s.wick < price)
          .map(s => s.wick)
          .sort((a, b) => b - a);  // Sort descending (nearest to price first)

        const nearestLow = lows.length > 0 ? lows[0] : null;
        const defaultStop = price * (1 - MAX_STOP_PCT);

        // Use nearest swing low if within reasonable range, else use default
        if (nearestLow && (price - nearestLow) / price <= MAX_STOP_PCT) {
          stopLoss = nearestLow * 0.998;  // Tiny buffer below swing low
        } else {
          stopLoss = defaultStop;
        }

        const risk = price - stopLoss;
        if (risk > 0) {
          takeProfit = price + (risk * 2); // 1:2 R:R
        }
      } else {
        // Find nearest swing high ABOVE current price
        const highs = recentSwings
          .filter(s => s.type === 'high' && s.wick > price)
          .map(s => s.wick)
          .sort((a, b) => a - b);  // Sort ascending (nearest to price first)

        const nearestHigh = highs.length > 0 ? highs[0] : null;
        const defaultStop = price * (1 + MAX_STOP_PCT);

        if (nearestHigh && (nearestHigh - price) / price <= MAX_STOP_PCT) {
          stopLoss = nearestHigh * 1.002;  // Tiny buffer above swing high
        } else {
          stopLoss = defaultStop;
        }

        const risk = stopLoss - price;
        if (risk > 0) {
          takeProfit = price - (risk * 2); // 1:2 R:R
        }
      }
    }

    const signal = {
      module: 'MADynamicSR',
      direction,
      confidence,
      reason,
      pattern,
      touchingEMA,
      srAlignment,
      confirmation,
      levels: {
        ema50,
        ema200,
        stopLoss,
        takeProfit,
        riskReward: stopLoss && takeProfit ? 2 : null
      },
      trend: trendBullish ? 'bullish' : trendBearish ? 'bearish' : 'neutral',
      swingCount: this.swings.length,
      srLevelCount: this.srLevels.length
    };

    this.lastSignal = signal;
    return signal;
  }

  /**
   * Detect swing highs and lows from price history
   */
  _detectSwings(priceHistory) {
    if (priceHistory.length < this.swingLookback * 2 + 1) return;

    const len = priceHistory.length;
    const lookback = this.swingLookback;

    // Check if we have a new swing high
    const midBar = len - 1 - lookback;
    if (midBar < lookback) return;

    const midCandle = priceHistory[midBar];
    const midHigh = h(midCandle);
    const midLow = l(midCandle);

    // Check for swing high
    let isSwingHigh = true;
    for (let i = midBar - lookback; i <= midBar + lookback; i++) {
      if (i === midBar) continue;
      if (h(priceHistory[i]) >= midHigh) {
        isSwingHigh = false;
        break;
      }
    }

    if (isSwingHigh) {
      const existing = this.swings.find(s => s.bar === midBar);
      if (!existing) {
        this.swings.push({
          type: 'high',
          price: c(midCandle),
          wick: midHigh,  // Use wick per Trader DNA
          bar: midBar
        });
      }
    }

    // Check for swing low
    let isSwingLow = true;
    for (let i = midBar - lookback; i <= midBar + lookback; i++) {
      if (i === midBar) continue;
      if (l(priceHistory[i]) <= midLow) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingLow) {
      const existing = this.swings.find(s => s.bar === midBar);
      if (!existing) {
        this.swings.push({
          type: 'low',
          price: c(midCandle),
          wick: midLow,  // Use wick per Trader DNA
          bar: midBar
        });
      }
    }

    // Keep only last 50 swings
    if (this.swings.length > 50) {
      this.swings = this.swings.slice(-50);
    }
  }

  /**
   * Build S/R levels from swings - levels tested multiple times are stronger
   */
  _updateSRLevels() {
    if (this.swings.length < 2) return;

    // Group swings into zones
    const zonePct = this.srZonePct / 100;

    for (const swing of this.swings) {
      const price = swing.wick;  // Use wick

      // Check if this swing is near an existing level
      let foundLevel = null;
      for (const level of this.srLevels) {
        const diff = Math.abs(price - level.price) / level.price;
        if (diff <= zonePct) {
          foundLevel = level;
          break;
        }
      }

      if (foundLevel) {
        // Update existing level
        if (swing.bar > foundLevel.lastTest) {
          foundLevel.tests++;
          foundLevel.lastTest = swing.bar;
          // Adjust level to average (per Trader DNA - adjust to wicks)
          foundLevel.price = (foundLevel.price + price) / 2;
        }
      } else {
        // New level
        this.srLevels.push({
          price,
          tests: 1,
          lastTest: swing.bar,
          type: swing.type === 'high' ? 'resistance' : 'support'
        });
      }
    }

    // Keep only recent levels (last 20)
    this.srLevels = this.srLevels
      .sort((a, b) => b.lastTest - a.lastTest)
      .slice(0, 20);
  }

  /**
   * Detect 123 pattern - the core trend confirmation
   * Uptrend: Higher High AND Higher Low
   * Downtrend: Lower High AND Lower Low
   *
   * FIX: Pattern is CACHED - once confirmed, stays true until structure breaks
   * Uptrend stays until we get a Lower Low
   * Downtrend stays until we get a Higher High
   */
  _detect123Pattern() {
    if (this.swings.length < 4) return this.pattern123;  // Return cached

    const recent = this.swings.slice(-6);
    const highs = recent.filter(s => s.type === 'high').slice(-3);
    const lows = recent.filter(s => s.type === 'low').slice(-3);

    if (highs.length < 2 || lows.length < 2) return this.pattern123;

    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];

    const higherHigh = lastHigh.wick > prevHigh.wick;
    const higherLow = lastLow.wick > prevLow.wick;
    const lowerHigh = lastHigh.wick < prevHigh.wick;
    const lowerLow = lastLow.wick < prevLow.wick;

    // New uptrend confirmation
    if (higherHigh && higherLow) {
      return 'uptrend';
    }
    // New downtrend confirmation
    if (lowerHigh && lowerLow) {
      return 'downtrend';
    }

    // FIX: Pattern PERSISTS until broken
    // Uptrend breaks on Lower Low
    if (this.pattern123 === 'uptrend' && lowerLow) {
      return null;  // Structure broken
    }
    // Downtrend breaks on Higher High
    if (this.pattern123 === 'downtrend' && higherHigh) {
      return null;  // Structure broken
    }

    // Keep existing pattern if not broken
    return this.pattern123;
  }

  /**
   * Check if price is touching the 50 EMA
   */
  _isTouchingEMA(price, ema) {
    const distance = Math.abs(price - ema) / ema * 100;
    return distance <= this.touchZonePct;
  }

  /**
   * Check if EMA aligns with a previously tested S/R level
   */
  _checkSRAlignment(ema) {
    const zonePct = this.srZonePct / 100;

    for (const level of this.srLevels) {
      if (level.tests < this.srTestCount) continue;  // Must be tested multiple times

      const diff = Math.abs(ema - level.price) / level.price;
      if (diff <= zonePct) {
        return {
          aligned: true,
          type: level.type,
          price: level.price,
          tests: level.tests
        };
      }
    }

    return { aligned: false, type: null, price: null, tests: 0 };
  }

  /**
   * Check for confirmation candlestick patterns
   */
  _checkConfirmationCandle(candle, priceHistory) {
    const open = o(candle);
    const close = c(candle);
    const high = h(candle);
    const low = l(candle);

    const body = Math.abs(close - open);
    const range = high - low;
    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;

    const result = {
      bullish: false,
      bearish: false,
      pattern: 'none',
      strength: 0
    };

    if (range === 0) return result;

    // Hammer (bullish) - small body, long lower wick, little upper wick
    if (close > open && lowerWick >= body * 2 && upperWick <= body * 0.5) {
      result.bullish = true;
      result.pattern = 'hammer';
      result.strength = Math.min(1, lowerWick / range);
    }
    // Inverted Hammer / Shooting Star (bearish) - small body, long upper wick
    else if (close < open && upperWick >= body * 2 && lowerWick <= body * 0.5) {
      result.bearish = true;
      result.pattern = 'shooting_star';
      result.strength = Math.min(1, upperWick / range);
    }
    // Bullish Engulfing
    else if (priceHistory.length >= 2) {
      const prev = priceHistory[priceHistory.length - 2];
      const prevOpen = o(prev);
      const prevClose = c(prev);

      if (prevClose < prevOpen && close > open &&
          close > prevOpen && open < prevClose) {
        result.bullish = true;
        result.pattern = 'bullish_engulfing';
        result.strength = body / range;
      }
      // Bearish Engulfing
      else if (prevClose > prevOpen && close < open &&
               close < prevOpen && open > prevClose) {
        result.bearish = true;
        result.pattern = 'bearish_engulfing';
        result.strength = body / range;
      }
    }

    // Strong bullish candle (big green body)
    if (!result.bullish && close > open && body / range > 0.6) {
      result.bullish = true;
      result.pattern = 'strong_bullish';
      result.strength = body / range * 0.8;
    }
    // Strong bearish candle (big red body)
    if (!result.bearish && close < open && body / range > 0.6) {
      result.bearish = true;
      result.pattern = 'strong_bearish';
      result.strength = body / range * 0.8;
    }

    return result;
  }

  /**
   * Calculate EMA
   */
  _ema(closes, period) {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
  }

  _emptySignal() {
    return {
      module: 'MADynamicSR',
      direction: 'neutral',
      confidence: 0,
      reason: 'insufficient_data',
      pattern: null,
      touchingEMA: false,
      srAlignment: { aligned: false },
      confirmation: { bullish: false, bearish: false },
      levels: {},
      trend: null
    };
  }

  getSnapshot() {
    return {
      swings: this.swings.slice(-10),
      srLevels: this.srLevels,
      lastSignal: this.lastSignal,
      diagnostics: this.diag
    };
  }

  printDiagnostics() {
    const d = this.diag;
    console.log('\n===== MADynamicSR DIAGNOSTICS =====');
    console.log(`Total bars processed: ${this.barCount}`);
    console.log(`200 EMA trend: ${d.trendBullish} bullish, ${d.trendBearish} bearish`);
    console.log(`123 pattern:   ${d.patternUptrend} uptrend, ${d.patternDowntrend} downtrend`);
    console.log(`50 EMA touch:  ${d.emaTouches} times`);
    console.log(`S/R aligned:   ${d.srAligned} times`);
    console.log(`Confirm candle: ${d.confirmBullish} bullish, ${d.confirmBearish} bearish`);
    console.log(`ALL ALIGNED:   ${d.allAlignedLong} long, ${d.allAlignedShort} short`);
    console.log('====================================\n');
  }

  destroy() {
    this.swings = [];
    this.srLevels = [];
    this.lastSignal = null;
  }
}

module.exports = MADynamicSR;
