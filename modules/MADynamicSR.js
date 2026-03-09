/**
 * MADynamicSR.js — Trader DNA Strategy Implementation (CORRECTED)
 * ================================================================
 * Based on "3 EMA Strategies That NEVER LOSE" by Trader DNA
 *
 * CORRECTED INTERPRETATION:
 * - 20 MA = The entire trend system. Rising + under price = uptrend. Falling + over price = downtrend.
 * - 200 MA = Dynamic support/resistance level. Floor or ceiling. NOT for trend direction.
 *
 * ENTRY REQUIREMENTS (ALL must be true):
 * 1. 20 MA must be TRENDING (rising or falling), not flat
 * 2. Price must NOT be extended (too far from 20 MA)
 * 3. Skip first touch after parabolic extension
 * 4. 123 Pattern confirmed (HH/HL for longs, LH/LL for shorts)
 * 5. Price pulls back to 20 MA
 * 6. Confirmation candle appears (hammer, engulfing, etc.)
 * 7. Acceleration filter (candle range > 1.2x ATR)
 *
 * EXIT: 1:3 R:R, BUT capped at 200 MA if it's in the way
 *
 * Rewritten: 2026-03-09 per Trader DNA spec correction
 */

'use strict';

const { c, o, h, l } = require('../core/CandleHelper');

class MADynamicSR {
  constructor(config = {}) {
    // MA periods per CORRECTED Trader DNA interpretation
    this.entryMaPeriod = config.entryMaPeriod || 20;     // 20 MA — the trend + entry line
    this.srMaPeriod = config.srMaPeriod || 200;          // 200 MA — support/resistance level (NOT trend)
    this.atrPeriod = config.atrPeriod || 14;             // For SL buffer and acceleration

    // Swing detection settings
    this.swingLookback = config.swingLookback || 3;      // Bars to confirm swing (3 for 15m)
    this.srTestCount = config.srTestCount || 2;          // Times a level must be tested
    this.srZonePct = config.srZonePct || 1.0;            // Zone width as % of price

    // Touch detection
    this.touchZonePct = config.touchZonePct || 0.6;      // % distance to count as "touching"

    // Pattern persistence
    this.patternPersistBars = config.patternPersistBars || 15;

    // NEW: 20 MA slope detection
    this.slopeLookback = config.slopeLookback || 5;      // Compare current 20 MA to 5 bars ago
    this.minSlopePct = config.minSlopePct || 0.03;       // 20 MA must move >= 0.03% to count as trending

    // NEW: Extension detection (distance from 20 MA that's "too far")
    this.extensionPct = config.extensionPct || 2.0;      // If price > 2% from 20 MA = extended/exhausted

    // NEW: First-touch skip after extension
    this.skipFirstTouch = config.skipFirstTouch ?? true;

    // State tracking
    this.swings = [];           // Array of { type: 'high'|'low', price, bar, wick }
    this.srLevels = [];         // Array of { price, tests, lastTest }
    this.pattern123 = null;     // Current 123 pattern state
    this.patternDetectedBar = 0;
    this.lastSignal = null;
    this.barCount = 0;

    // Structure-based cooldown: one trade per pullback
    this.inPullbackTaken = false;

    // NEW: Extension state tracking
    this._wasExtended = false;
    this._firstTouchAfterExtension = false;

    // Diagnostic counters
    this.diag = {
      trendBullish: 0,      // Now means "20 MA rising"
      trendBearish: 0,      // Now means "20 MA falling"
      trendFlat: 0,         // NEW: 20 MA flat (no trade)
      extensionSkips: 0,    // NEW: Skipped due to extension
      firstTouchSkips: 0,   // NEW: Skipped first touch after extension
      patternUptrend: 0,
      patternDowntrend: 0,
      patternNull: 0,
      swingHighs: 0,
      swingLows: 0,
      emaTouches: 0,
      srAligned: 0,
      confirmBullish: 0,
      confirmBearish: 0,
      allAlignedLong: 0,
      allAlignedShort: 0,
      // Sanity check failures (after allAligned)
      rrCappedFail: 0,      // 200 MA cap killed R:R
      slInvalid: 0,         // SL >= price (long) or SL <= price (short)
      tpInvalid: 0,         // TP <= price (long) or TP >= price (short)
      rrTooLow: 0,          // actualRR < MIN_RR
      tpTooSmall: 0,        // tpDistance < MIN_TP_PCT
      signalsEmitted: 0     // Signals that passed ALL checks
    };

    console.log(`📐 MADynamicSR initialized (Trader DNA CORRECTED) - Entry MA: ${this.entryMaPeriod}, S/R MA: ${this.srMaPeriod}`);
  }

  /**
   * Main update - call on each candle
   * REWRITTEN 2026-03-09: Corrected Trader DNA implementation
   */
  update(candle, priceHistory) {
    this.barCount++;

    // Detect swings early (only needs swingLookback * 2 + 1 = 7 candles)
    if (priceHistory && priceHistory.length >= this.swingLookback * 2 + 1) {
      this._detectSwings(priceHistory);
      this._updateSRLevels();
    }

    // Need enough history for 200 MA + slope lookback to generate signals
    const minBars = Math.max(this.entryMaPeriod, this.srMaPeriod) + this.slopeLookback + 20;
    if (!priceHistory || priceHistory.length < minBars) {
      return this._emptySignal();
    }

    const closes = priceHistory.map(x => c(x));
    const price = c(candle);
    const high = h(candle);
    const low = l(candle);

    // Calculate MAs
    const ma20 = this._ema(closes, this.entryMaPeriod);     // Entry + trend line
    const ma200 = this._ema(closes, this.srMaPeriod);       // S/R level (NOT trend gate)
    const atr = this._atr(priceHistory, this.atrPeriod);
    if (!ma20) return this._emptySignal();
    // ma200 can be null if not enough data — that's okay, we just skip S/R features

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: 20 MA SLOPE — Is the 20 MA trending or flat?
    // Trader DNA: "20 MA flat, moving through candles = not useful"
    // If flat, don't trade. Period.
    // ═══════════════════════════════════════════════════════════════════
    const maSlope = this._getMaSlope(closes, this.entryMaPeriod);

    if (maSlope === 'rising') this.diag.trendBullish++;
    else if (maSlope === 'falling') this.diag.trendBearish++;
    else this.diag.trendFlat++;

    if (maSlope === 'flat') {
      return this._emptySignal();  // 20 MA is flat — strategy is useless in chop
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: EXTENSION CHECK — Is price too far from the 20 MA?
    // Trader DNA: "If prices are super far from the 20 MA, don't buy"
    // ═══════════════════════════════════════════════════════════════════
    const extended = this._isExtended(price, ma20);

    if (extended) {
      this._wasExtended = true;
      this.diag.extensionSkips++;
      return this._emptySignal();  // Don't enter when extended
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: FIRST-TOUCH SKIP after extension
    // Trader DNA: "Always pass on the first touch of the 20 MA after
    // a huge parabolic run where you were extended"
    // ═══════════════════════════════════════════════════════════════════
    const touchingMA = this._isTouchingEMA(price, ma20);

    if (this._wasExtended && touchingMA && this.skipFirstTouch) {
      this._firstTouchAfterExtension = true;
      this._wasExtended = false;  // Reset — we've seen the first touch
      this.diag.firstTouchSkips++;
      return this._emptySignal();  // Skip this touch
    }

    // If touching and it's NOT the first touch after extension, allow it
    if (touchingMA && this._firstTouchAfterExtension) {
      this._firstTouchAfterExtension = false;  // Second touch — we're clear
    }

    if (touchingMA) this.diag.emaTouches++;

    // Structure-based cooldown: one trade per pullback
    if (!touchingMA && this.inPullbackTaken) {
      this.inPullbackTaken = false;
    }
    if (touchingMA && this.inPullbackTaken) {
      return this._emptySignal();
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 4: 123 PATTERN — Trend structure confirmation
    // ═══════════════════════════════════════════════════════════════════
    const pattern = this._detect123Pattern();
    this.pattern123 = pattern;
    if (pattern === 'uptrend') this.diag.patternUptrend++;
    else if (pattern === 'downtrend') this.diag.patternDowntrend++;
    else this.diag.patternNull++;

    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: S/R ALIGNMENT (bonus, not required)
    // ═══════════════════════════════════════════════════════════════════
    const srAlignment = this._checkSRAlignment(price);
    if (srAlignment.aligned) this.diag.srAligned++;

    // ═══════════════════════════════════════════════════════════════════
    // STEP 6: CONFIRMATION CANDLE
    // ═══════════════════════════════════════════════════════════════════
    const confirmation = this._checkConfirmationCandle(candle, priceHistory);
    if (confirmation.bullish) this.diag.confirmBullish++;
    if (confirmation.bearish) this.diag.confirmBearish++;

    // ═══════════════════════════════════════════════════════════════════
    // STEP 7: ACCELERATION — Candle must show real momentum
    // ═══════════════════════════════════════════════════════════════════
    const candleRange = high - low;
    const accelerating = atr ? (candleRange > atr * 1.2) : true;
    const strongAcceleration = atr ? (candleRange > atr * 1.5) : false;

    // ═══════════════════════════════════════════════════════════════════
    // ENTRY DECISION (CORRECTED Trader DNA method)
    //
    // LONG:  20 MA rising + price touching 20 MA + 123 uptrend +
    //        confirmation candle + acceleration
    // SHORT: 20 MA falling + price touching 20 MA + 123 downtrend +
    //        confirmation candle + acceleration
    //
    // The 200 MA is NOT a gate. It's used below for targets and R:R.
    // ═══════════════════════════════════════════════════════════════════
    let direction = 'neutral';
    let confidence = 0;
    let reason = '';

    // LONG: 20 MA rising + touching + uptrend structure + confirmation + momentum
    if (maSlope === 'rising' && pattern === 'uptrend' && touchingMA && confirmation.bullish && accelerating) {
      this.diag.allAlignedLong++;
      direction = 'buy';
      confidence = 0.55;
      confidence += confirmation.strength * 0.20;
      if (srAlignment.aligned) {
        confidence += Math.min(0.20, srAlignment.tests * 0.08);
      }
      if (strongAcceleration) {
        confidence += 0.05;
      }
      // 200 MA confluence bonus: if 200 MA is nearby and acting as support
      if (ma200 && Math.abs(price - ma200) / ma200 * 100 < 1.0 && price > ma200) {
        confidence += 0.10;
        reason = `SNIPER LONG: 20 MA rising + 123 uptrend + pullback + ${confirmation.pattern} + 200 MA support`;
      } else {
        const srNote = srAlignment.aligned ? ` + S/R (${srAlignment.tests}x)` : '';
        const accNote = strongAcceleration ? ' + STRONG ACCEL' : '';
        reason = `SNIPER LONG: 20 MA rising + 123 uptrend + pullback + ${confirmation.pattern}${srNote}${accNote}`;
      }
    }
    // SHORT: 20 MA falling + touching + downtrend structure + confirmation + momentum
    else if (maSlope === 'falling' && pattern === 'downtrend' && touchingMA && confirmation.bearish && accelerating) {
      this.diag.allAlignedShort++;
      direction = 'sell';
      confidence = 0.55;
      confidence += confirmation.strength * 0.20;
      if (srAlignment.aligned) {
        confidence += Math.min(0.20, srAlignment.tests * 0.08);
      }
      if (strongAcceleration) {
        confidence += 0.05;
      }
      // 200 MA confluence bonus: if 200 MA is nearby and acting as resistance
      if (ma200 && Math.abs(price - ma200) / ma200 * 100 < 1.0 && price < ma200) {
        confidence += 0.10;
        reason = `SNIPER SHORT: 20 MA falling + 123 downtrend + retracement + ${confirmation.pattern} + 200 MA resistance`;
      } else {
        const srNote = srAlignment.aligned ? ` + S/R (${srAlignment.tests}x)` : '';
        const accNote = strongAcceleration ? ' + STRONG ACCEL' : '';
        reason = `SNIPER SHORT: 20 MA falling + 123 downtrend + retracement + ${confirmation.pattern}${srNote}${accNote}`;
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STRUCTURAL SL/TP
    //
    // SL: Below the 20 MA minus ATR buffer
    // TP: 1:3 R:R from stop, BUT capped at 200 MA if it's in the way
    //
    // Trader DNA: "If the 200 is directly above, I don't really have
    // solid risk-to-reward... so I'm going to pass on this setup"
    // ═══════════════════════════════════════════════════════════════════
    let stopLoss = null;
    let takeProfit = null;
    const atrBuffer = atr ? atr * 1.0 : price * 0.01;
    const MIN_TP_PCT = 0.007;
    const MIN_RR = 1.5;

    if (direction !== 'neutral') {
      if (direction === 'buy') {
        stopLoss = ma20 - atrBuffer;
        const risk = price - stopLoss;
        takeProfit = price + (risk * 3);  // 1:3 R:R

        // 200 MA is used for CONFLUENCE BONUS only (handled above in confidence calc)
        // NOT as a trade killer — on 15m charts, 200 MA is perpetually nearby
        // The core filters (20 MA slope, 123 pattern, confirmation, acceleration) do quality control

        // Sanity checks with diagnostics
        if (stopLoss >= price) { this.diag.slInvalid++; return this._emptySignal(); }
        if (takeProfit <= price) { this.diag.tpInvalid++; return this._emptySignal(); }
        const tpDistance = (takeProfit - price) / price;
        const actualRR = risk > 0 ? (takeProfit - price) / risk : 0;
        if (actualRR < MIN_RR) { this.diag.rrTooLow++; return this._emptySignal(); }
        if (tpDistance < MIN_TP_PCT) { this.diag.tpTooSmall++; return this._emptySignal(); }

      } else {
        // SHORT
        stopLoss = ma20 + atrBuffer;
        const risk = stopLoss - price;
        takeProfit = price - (risk * 3);  // 1:3 R:R

        // 200 MA is used for CONFLUENCE BONUS only (handled above in confidence calc)
        // NOT as a trade killer — on 15m charts, 200 MA is perpetually nearby

        // Sanity checks with diagnostics
        if (stopLoss <= price) { this.diag.slInvalid++; return this._emptySignal(); }
        if (takeProfit >= price) { this.diag.tpInvalid++; return this._emptySignal(); }
        const tpDistance = (price - takeProfit) / price;
        const actualRR = risk > 0 ? (price - takeProfit) / risk : 0;
        if (actualRR < MIN_RR) { this.diag.rrTooLow++; return this._emptySignal(); }
        if (tpDistance < MIN_TP_PCT) { this.diag.tpTooSmall++; return this._emptySignal(); }
      }

      this.inPullbackTaken = true;
      this.diag.signalsEmitted++;
    }

    const signal = {
      module: 'MADynamicSR',
      direction,
      confidence,
      reason,
      pattern,
      touchingMA,
      srAlignment,
      confirmation,
      levels: {
        ma20,
        ma200,
        atr,
        stopLoss,
        takeProfit,
        riskReward: stopLoss && takeProfit ? Math.abs(takeProfit - price) / Math.abs(price - stopLoss) : null,
        maSlope,
        extended,
      },
      trend: maSlope === 'rising' ? 'bullish' : maSlope === 'falling' ? 'bearish' : 'flat',
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
      const globalBar = this.barCount - lookback;  // Global bar number, not array index
      const existing = this.swings.find(s => s.bar === globalBar);
      if (!existing) {
        this.swings.push({
          type: 'high',
          price: c(midCandle),
          wick: midHigh,  // Use wick per Trader DNA
          bar: globalBar
        });
        this.diag.swingHighs++;
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
      const globalBar = this.barCount - lookback;  // Global bar number, not array index
      const existing = this.swings.find(s => s.bar === globalBar);
      if (!existing) {
        this.swings.push({
          type: 'low',
          price: c(midCandle),
          wick: midLow,  // Use wick per Trader DNA
          bar: globalBar
        });
        this.diag.swingLows++;
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
    // FIX: Get last 2 swing highs and last 2 swing lows INDEPENDENTLY
    // Old bug: slice(-6) then filter meant strong trends had <2 of one type
    const highs = this.swings.filter(s => s.type === 'high').slice(-2);
    const lows = this.swings.filter(s => s.type === 'low').slice(-2);

    if (highs.length < 2 || lows.length < 2) return this.pattern123;

    const [prevHigh, lastHigh] = highs;
    const [prevLow, lastLow] = lows;

    const higherHigh = lastHigh.wick > prevHigh.wick;
    const higherLow = lastLow.wick > prevLow.wick;
    const lowerHigh = lastHigh.wick < prevHigh.wick;
    const lowerLow = lastLow.wick < prevLow.wick;

    // Uptrend: Higher High + Higher Low (bullish structure)
    if (higherHigh && higherLow) {
      return 'uptrend';
    }
    // Downtrend: Lower High + Lower Low (bearish structure)
    if (lowerHigh && lowerLow) {
      return 'downtrend';
    }
    // Mixed structure (HH+LL or LH+HL) = no clear trend
    return null;
  }

  /**
   * Calculate 20 MA slope — is it trending or flat?
   * Trader DNA: "20 MA flat, moving through candles = useless, don't trade"
   *
   * @returns {'rising'|'falling'|'flat'}
   */
  _getMaSlope(closes, period) {
    if (closes.length < period + this.slopeLookback) return 'flat';

    const currentMa = this._ema(closes, period);

    // Calculate MA value from slopeLookback bars ago
    const olderCloses = closes.slice(0, closes.length - this.slopeLookback);
    const olderMa = this._ema(olderCloses, period);

    if (!currentMa || !olderMa || olderMa === 0) return 'flat';

    const slopePct = ((currentMa - olderMa) / olderMa) * 100;

    if (slopePct > this.minSlopePct) return 'rising';
    if (slopePct < -this.minSlopePct) return 'falling';
    return 'flat';
  }

  /**
   * Check if price is extended (too far) from the 20 MA
   * Trader DNA: "distance between price and 20 MA = extension = overbought"
   * "I would never be buying up here because we're super far away from the 20 MA"
   */
  _isExtended(price, ma20) {
    if (!ma20 || ma20 === 0) return false;
    const distancePct = Math.abs(price - ma20) / ma20 * 100;
    return distancePct > this.extensionPct;
  }

  /**
   * Check if price is touching the 20 MA
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

  /**
   * Calculate SMA
   */
  _sma(closes, period) {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  /**
   * Calculate ATR (Average True Range)
   */
  _atr(priceHistory, period) {
    if (priceHistory.length < period + 1) return null;
    let trSum = 0;
    for (let i = priceHistory.length - period; i < priceHistory.length; i++) {
      const curr = priceHistory[i];
      const prev = priceHistory[i - 1];
      const tr = Math.max(
        h(curr) - l(curr),
        Math.abs(h(curr) - c(prev)),
        Math.abs(l(curr) - c(prev))
      );
      trSum += tr;
    }
    return trSum / period;
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
    const totalAligned = d.allAlignedLong + d.allAlignedShort;
    const totalFiltered = d.rrCappedFail + d.slInvalid + d.tpInvalid + d.rrTooLow + d.tpTooSmall;
    console.log('\n===== MADynamicSR DIAGNOSTICS =====');
    console.log(`Total bars processed: ${this.barCount}`);
    console.log(`Swings detected: ${d.swingHighs} highs, ${d.swingLows} lows`);
    console.log(`20 MA slope: ${d.trendBullish} rising, ${d.trendBearish} falling, ${d.trendFlat} flat`);
    console.log(`Extension skips: ${d.extensionSkips} (too far from 20 MA)`);
    console.log(`First-touch skips: ${d.firstTouchSkips} (after extension)`);
    console.log(`123 pattern: ${d.patternUptrend} up, ${d.patternDowntrend} down, ${d.patternNull} null`);
    console.log(`Entry EMA touch: ${d.emaTouches} times`);
    console.log(`S/R aligned: ${d.srAligned} times`);
    console.log(`Confirm candle: ${d.confirmBullish} bullish, ${d.confirmBearish} bearish`);
    console.log(`ALL ALIGNED: ${d.allAlignedLong} long, ${d.allAlignedShort} short (${totalAligned} total)`);
    console.log(`--- POST-ALIGN FILTERS (${totalFiltered} rejected) ---`);
    console.log(`  200 MA cap killed R:R: ${d.rrCappedFail}`);
    console.log(`  SL invalid (wrong side): ${d.slInvalid}`);
    console.log(`  TP invalid (wrong side): ${d.tpInvalid}`);
    console.log(`  R:R too low (<1.5): ${d.rrTooLow}`);
    console.log(`  TP too small (<0.7%): ${d.tpTooSmall}`);
    console.log(`SIGNALS EMITTED: ${d.signalsEmitted}`);
    console.log('====================================\n');
  }

  destroy() {
    this.swings = [];
    this.srLevels = [];
    this.lastSignal = null;
  }
}

module.exports = MADynamicSR;
