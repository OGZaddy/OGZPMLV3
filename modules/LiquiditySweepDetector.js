/**
 * LiquiditySweepDetector.js — V2-Compatible Rebuild
 * ==================================================
 * Detects institutional liquidity grabs at session open.
 * 7-step system: ATR filter → manip candle → box → exit → reversal → entry → SL/TP
 *
 * V2 FIXES (2026-03-10):
 *   • Single entry point: feedCandle(candle) takes 15m candles directly
 *   • NO internal aggregation - accepts 15m candles as-is (production timeframe)
 *   • Opening candle = first 15m candle of session (immediate processing)
 *   • Box exit detection on each 15m candle directly
 *   • Entry window: 6 bars (6 × 15m = 90min real time)
 *   • Auto-builds daily candles from 15m data for ATR calculation
 *   • Auto-detects session boundaries (configurable UTC hour/minute)
 *   • Bounded arrays throughout
 *   • Returns unified signal compatible with calculateRealConfidence()
 *
 * Integration:
 *   const sweep = new LiquiditySweepDetector({ sessionOpenHour: 14, sessionOpenMinute: 30 });
 *   // In your 15m candle loop:
 *   const signal = sweep.feedCandle(candle);
 *   // signal = { module, hasSignal, direction, confidence, ... }
 */

'use strict';

// FIX 2026-02-16: Use centralized candle helper for format compatibility
const { c, o, h, l, v, t } = require('../core/CandleHelper');

class LiquiditySweepDetector {
  constructor(config = {}) {
    this.config = {
      atrMultiplier: config.atrMultiplier || 0.25,
      atrPeriod: config.atrPeriod || 14,
      entryWindowBars: config.entryWindowBars || 6,        // 6 × 15min = 90min (FIX 2026-03-10)
      hammerBodyMaxPct: config.hammerBodyMaxPct || 0.35,
      hammerWickMinRatio: config.hammerWickMinRatio || 2.0,
      engulfMinRatio: config.engulfMinRatio || 1.0,
      stopBufferPct: config.stopBufferPct || 0.05,
      sweepMinExtensionPct: config.sweepMinExtensionPct || 0.05,
      sweepLookbackBars: config.sweepLookbackBars || 20,
      weights: {
        manipCandle:   config.weights?.manipCandle   || 0.20,
        wickSweep:     config.weights?.wickSweep     || 0.15,
        sweepReject:   config.weights?.sweepReject   || 0.15,
        hammerPattern: config.weights?.hammerPattern  || 0.25,
        engulfPattern: config.weights?.engulfPattern  || 0.25,
      },
      // Session open in UTC — default 14:30 = 9:30 AM ET
      sessionOpenHour: config.sessionOpenHour ?? 14,
      sessionOpenMinute: config.sessionOpenMinute ?? 30,
      // FIX 2026-02-18: For 24/7 crypto, disable session check to scan anytime
      disableSessionCheck: config.disableSessionCheck || false,
    };

    // FIX 2026-03-10: Removed 1m aggregation buffers - now accepts 15m candles directly
    this._dailyCandle = null;     // current day's running OHLCV
    this._currentDay = null;      // 'YYYY-MM-DD'
    this._openingCandleFed = false;

    this.reset();

    this.stats = {
      totalSessionsAnalyzed: 0,
      manipCandlesDetected: 0,
      manipCandlesValidated: 0,
      signalsGenerated: 0,
      hammersDetected: 0,
      engulfingsDetected: 0,
      lastSignalTime: null,
    };
  }

  // ─── RESET ──────────────────────────────────────────────────
  reset() {
    // FIX 2026-02-18: If disableSessionCheck, start in building_box phase for 24/7 scanning
    const initialPhase = this.config?.disableSessionCheck ? 'building_box' : 'waiting_for_open';
    this.state = {
      phase: initialPhase,
      sessionDate: null,
      dailyCandles: this.state?.dailyCandles || [],  // preserve across resets
      dailyATR: this.state?.dailyATR || null,
      manipThreshold: this.state?.manipThreshold || null,
      box: null,
      priorHighs: this.state?.priorHighs || [],
      priorLows: this.state?.priorLows || [],
      barsAfterOpen: 0,
      exitSide: null,
      exitBar: null,
      prevBar: null,
      signal: null,
    };
    this._minuteBuffer5m = [];
    this._minuteBuffer15m = [];
    this._openingCandleFed = false;
    this._minutesSinceOpen = 0;
  }

  // ─── UNIFIED ENTRY POINT ────────────────────────────────────
  /**
   * Feed a 15-minute candle directly.
   * FIX 2026-03-10: Removed internal 1m→15m aggregation. Production sends 15m candles.
   *
   * @param {Object} candle — { c, o, h, l, v, t } (V2 Kraken 15m)
   * @returns {Object} signal
   */
  feedCandle(candle) {
    if (!candle || c(candle) == null) return this._emptySignal();

    const ts = candle.t;  // milliseconds
    const date = new Date(ts);
    const dayStr = date.toISOString().split('T')[0];
    const utcHour = date.getUTCHours();
    const utcMinute = date.getUTCMinutes();

    // ── Day rollover: finalize yesterday's daily candle ──
    if (this._currentDay && this._currentDay !== dayStr) {
      this._finalizeDailyCandle();
      this._newSession(dayStr);
    }
    this._currentDay = dayStr;

    // ── Build running daily candle (works with any timeframe) ──
    this._updateDailyCandle(candle);

    // ── Detect session open (check if this 15m candle IS the session open) ──
    // For 15m candles, session open candle contains the open minute
    const isSessionOpenCandle = (utcHour === this.config.sessionOpenHour &&
                                  utcMinute <= this.config.sessionOpenMinute &&
                                  utcMinute + 15 > this.config.sessionOpenMinute);

    if (isSessionOpenCandle && this.state.phase === 'waiting_for_open') {
      // This 15m candle IS the opening candle - process immediately
      this.state.phase = 'building_box';
      this._openingCandleFed = false;
    }

    // ── Opening candle: process immediately (no aggregation needed) ──
    if (this.state.phase === 'building_box' && !this._openingCandleFed) {
      this._processOpeningCandle(candle);  // Direct 15m candle
      this._openingCandleFed = true;
      return this.getSignal();
    }

    // ── Box exit + pattern detection: each 15m candle directly ──
    // FIX 2026-03-10: No 5m aggregation - process each 15m candle directly
    if (this.state.phase === 'watching_for_exit' || this.state.phase === 'watching_for_pattern') {
      this._process5mCandle(candle);  // Method name kept for compatibility, now processes 15m directly
    }

    // DEEP DIAGNOSTIC: Trace LiquiditySweep internals
    if (process.env.BACKTEST_VERBOSE) {
      const candleTs = candle?.t ? new Date(candle.t).toISOString() : 'unknown';
      if ((this.stats?.totalSessionsAnalyzed || 0) % 10 === 0 || this.state.phase !== 'waiting_for_open') {
        console.log(`[LIQSWEEP-15M] candle=${candleTs} phase=${this.state.phase} dailyATR=${this.state.dailyATR?.toFixed(2)||'null'}`);
      }
    }

    return this.getSignal();
  }



  // ─── AGGREGATION ────────────────────────────────────────────
  _aggregate(candles) {
    if (!candles.length) return null;
    return {
      o: o(candles[0]),
      h: Math.max(...candles.map(candle => h(candle))),
      l: Math.min(...candles.map(candle => l(candle))),
      c: c(candles[candles.length - 1]),
      v: candles.reduce((s, candle) => s + (v(candle) || 0), 0),
      t: t(candles[candles.length - 1]),
    };
  }

  // ─── DAILY CANDLE TRACKING ──────────────────────────────────
  _updateDailyCandle(candle) {
    if (!this._dailyCandle) {
      this._dailyCandle = {
        o: o(candle), h: h(candle), l: l(candle), c: c(candle),
        v: v(candle) || 0, t: t(candle)
      };
    } else {
      this._dailyCandle.h = Math.max(this._dailyCandle.h, h(candle));
      this._dailyCandle.l = Math.min(this._dailyCandle.l, l(candle));
      this._dailyCandle.c = c(candle);
      this._dailyCandle.v += (v(candle) || 0);
    }
  }

  _finalizeDailyCandle() {
    if (!this._dailyCandle) return;

    const dc = this._dailyCandle;
    this.state.dailyCandles.push({ high: dc.h, low: dc.l, close: dc.c });

    const maxBars = this.config.atrPeriod + 1;
    if (this.state.dailyCandles.length > maxBars) {
      this.state.dailyCandles = this.state.dailyCandles.slice(-maxBars);
    }

    // Update ATR
    this._computeDailyATR();

    // Track prior highs/lows for sweep validation
    this.state.priorHighs.push(dc.h);
    this.state.priorLows.push(dc.l);
    if (this.state.priorHighs.length > this.config.sweepLookbackBars) {
      this.state.priorHighs = this.state.priorHighs.slice(-this.config.sweepLookbackBars);
    }
    if (this.state.priorLows.length > this.config.sweepLookbackBars) {
      this.state.priorLows = this.state.priorLows.slice(-this.config.sweepLookbackBars);
    }

    this._dailyCandle = null;
  }

  _newSession(dayStr) {
    this.state.phase = 'waiting_for_open';
    this.state.sessionDate = dayStr;
    this.state.box = null;
    this.state.exitSide = null;
    this.state.exitBar = null;
    this.state.prevBar = null;
    this.state.barsAfterOpen = 0;
    this.state.signal = null;
    this._openingCandleFed = false;
    this._minutesSinceOpen = 0;
    this._minuteBuffer5m = [];
    this._minuteBuffer15m = [];
  }

  // ─── OPENING CANDLE PROCESSING (Step 1-3) ──────────────────
  _processOpeningCandle(candle15m) {
    if (!candle15m || !this.state.dailyATR) {
      this.state.phase = 'done';
      return;
    }

    const range = candle15m.h - candle15m.l;
    const threshold = this.config.atrMultiplier * this.state.dailyATR;
    const isManipCandle = range >= threshold;

    this.stats.totalSessionsAnalyzed++;

    this.state.box = {
      high: candle15m.h,
      low: candle15m.l,
      range,
      open: candle15m.o,
      close: candle15m.c,
      isManipCandle,
      atrThreshold: threshold,
      atrPct: (range / this.state.dailyATR * 100).toFixed(1),
      validations: { passesATR: isManipCandle, sweepsHighs: false, sweepsLows: false, closesInsideRange: false },
      timestamp: candle15m.t,
    };

    if (!isManipCandle) {
      this.state.phase = 'done';
      return;
    }

    this.stats.manipCandlesDetected++;

    // Wick sweep validation
    const upperWick = candle15m.h - Math.max(candle15m.o, candle15m.c);
    const lowerWick = Math.min(candle15m.o, candle15m.c) - candle15m.l;
    const sweepExt = candle15m.h * (this.config.sweepMinExtensionPct / 100);

    const sweepsHighs = this.state.priorHighs.some(h =>
      candle15m.h > h && candle15m.h <= h + sweepExt * 5 && upperWick > 0
    );
    const sweepsLows = this.state.priorLows.some(l =>
      candle15m.l < l && candle15m.l >= l - sweepExt * 5 && lowerWick > 0
    );

    this.state.box.validations.sweepsHighs = sweepsHighs;
    this.state.box.validations.sweepsLows = sweepsLows;

    // Close inside range check
    const bodyMid = (candle15m.o + candle15m.c) / 2;
    const rangeMid = (candle15m.h + candle15m.l) / 2;
    const closeFromExtreme = Math.abs(bodyMid - rangeMid) / range;
    this.state.box.validations.closesInsideRange = closeFromExtreme < 0.35;

    const validationsPassed = [sweepsHighs || sweepsLows, this.state.box.validations.closesInsideRange].filter(Boolean).length;
    this.state.box.validationScore = validationsPassed;

    if (validationsPassed > 0) {
      this.stats.manipCandlesValidated++;
      console.log(`🔴 MANIPULATION CANDLE CONFIRMED (${validationsPassed}/2) — ${this.state.box.atrPct}% of daily ATR`);
    }

    this.state.phase = 'watching_for_exit';
    this.state.barsAfterOpen = 0;
  }

  // ─── 5-MIN CANDLE PROCESSING (Steps 4-7) ───────────────────
  _process5mCandle(c5m) {
    if (!c5m || !this.state.box || this.state.phase === 'done' || this.state.phase === 'waiting_for_open') return;

    this.state.barsAfterOpen++;
    const box = this.state.box;

    // Time gate
    if (this.state.barsAfterOpen > this.config.entryWindowBars) {
      if (this.state.phase !== 'signal_active') this.state.phase = 'done';
      return;
    }

    // Step 4: Watch for box exit
    if (this.state.phase === 'watching_for_exit') {
      if (c(c5m) > box.high) {
        this.state.exitSide = 'above';
        this.state.exitBar = { ...c5m };
        this.state.phase = 'watching_for_pattern';
      } else if (c(c5m) < box.low) {
        this.state.exitSide = 'below';
        this.state.exitBar = { ...c5m };
        this.state.phase = 'watching_for_pattern';
      }
      this.state.prevBar = { ...c5m };
      return;
    }

    // Steps 5-7: Watch for reversal pattern
    if (this.state.phase === 'watching_for_pattern') {
      const isOutsideBox = (this.state.exitSide === 'above' && c(c5m) > box.high) ||
                           (this.state.exitSide === 'below' && c(c5m) < box.low);

      if (!isOutsideBox) {
        this.state.phase = 'watching_for_exit';
        this.state.prevBar = { ...c5m };
        return;
      }

      const pattern = this._detectReversalPattern(c5m, this.state.prevBar, this.state.exitSide);
      if (pattern) this._generateSignal(pattern, c5m, this.state.prevBar);
      this.state.prevBar = { ...c5m };
    }
  }

  // ─── REVERSAL PATTERNS ──────────────────────────────────────
  _detectReversalPattern(candle, prev, exitSide) {
    if (!candle || !prev) return null;

    // FIX 2026-02-25: Use CandleHelper for format compatibility (was using direct .c/.o/.h/.l)
    const body = Math.abs(c(candle) - o(candle));
    const range = h(candle) - l(candle);
    const upperWick = h(candle) - Math.max(o(candle), c(candle));
    const lowerWick = Math.min(o(candle), c(candle)) - l(candle);
    const isBullish = c(candle) > o(candle);

    if (range === 0 || body === 0) return null;
    const bodyRatio = body / range;

    // Hammer (bullish, below box)
    // FIX 2026-02-25: Use CandleHelper for all candle property access
    if (exitSide === 'below') {
      if (bodyRatio <= this.config.hammerBodyMaxPct &&
          lowerWick / body >= this.config.hammerWickMinRatio &&
          lowerWick > upperWick * 1.5) {
        this.stats.hammersDetected++;
        return { type: 'hammer', direction: 'bullish', wickExtreme: l(candle) };
      }
      // Bullish engulfing
      if (isBullish && c(prev) < o(prev)) {
        const prevBody = Math.abs(c(prev) - o(prev));
        if (prevBody > 0 && body / prevBody >= this.config.engulfMinRatio &&
            c(candle) >= o(prev) && o(candle) <= c(prev)) {
          this.stats.engulfingsDetected++;
          return { type: 'bullish_engulfing', direction: 'bullish', entryLevel: h(prev), stopLevel: l(candle) };
        }
      }
    }

    // Inverted hammer (bearish, above box)
    if (exitSide === 'above') {
      if (bodyRatio <= this.config.hammerBodyMaxPct &&
          upperWick / body >= this.config.hammerWickMinRatio &&
          upperWick > lowerWick * 1.5) {
        this.stats.hammersDetected++;
        return { type: 'inverted_hammer', direction: 'bearish', wickExtreme: h(candle) };
      }
      // Bearish engulfing
      if (!isBullish && c(prev) > o(prev)) {
        const prevBody = Math.abs(c(prev) - o(prev));
        if (prevBody > 0 && body / prevBody >= this.config.engulfMinRatio &&
            o(candle) >= c(prev) && c(candle) <= o(prev)) {
          this.stats.engulfingsDetected++;
          return { type: 'bearish_engulfing', direction: 'bearish', entryLevel: l(prev), stopLevel: h(candle) };
        }
      }
    }

    return null;
  }

  // ─── SIGNAL GENERATION ──────────────────────────────────────
  _generateSignal(pattern, signalCandle, prevCandle) {
    const box = this.state.box;
    const bufUp = 1 + (this.config.stopBufferPct / 100);
    const bufDn = 1 - (this.config.stopBufferPct / 100);

    let entry, stopLoss, takeProfit, direction;

    if (pattern.type === 'hammer') {
      direction = 'bullish'; entry = null;
      stopLoss = pattern.wickExtreme * bufDn;
      takeProfit = box.high;
    } else if (pattern.type === 'inverted_hammer') {
      direction = 'bearish'; entry = null;
      stopLoss = pattern.wickExtreme * bufUp;
      takeProfit = box.low;
    } else if (pattern.type === 'bullish_engulfing') {
      direction = 'bullish';
      entry = pattern.entryLevel;
      stopLoss = pattern.stopLevel * bufDn;
      takeProfit = box.high;
    } else if (pattern.type === 'bearish_engulfing') {
      direction = 'bearish';
      entry = pattern.entryLevel;
      stopLoss = pattern.stopLevel * bufUp;
      takeProfit = box.low;
    }

    // Confidence scoring
    let confidence = this.config.weights.manipCandle;
    if (box.validations.sweepsHighs || box.validations.sweepsLows) confidence += this.config.weights.wickSweep;
    if (box.validations.closesInsideRange) confidence += this.config.weights.sweepReject;
    if (pattern.type.includes('hammer')) confidence += this.config.weights.hammerPattern;
    else confidence += this.config.weights.engulfPattern;

    // R:R bonus
    if (entry != null && stopLoss != null && takeProfit != null) {
      const risk = Math.abs(entry - stopLoss);
      const reward = Math.abs(takeProfit - entry);
      if (risk > 0) {
        const rr = reward / risk;
        if (rr >= 2.0) confidence += 0.10;
        else if (rr >= 1.5) confidence += 0.05;
        else if (rr < 1.0) confidence -= 0.10;
      }
    }

    confidence = Math.min(1.0, Math.max(0, confidence));

    this.state.signal = {
      hasSignal: true,
      direction: direction === 'bullish' ? 'buy' : 'sell',  // V2 convention
      confidence,
      pattern: pattern.type,
      entry,
      entryType: pattern.type.includes('hammer') ? 'next_candle_open' : 'limit_order',
      stopLoss,
      takeProfit,
      box: { high: box.high, low: box.low, range: box.range, atrPct: box.atrPct },
      validations: { ...box.validations },
      exitSide: this.state.exitSide,
      barsSinceOpen: this.state.barsAfterOpen,
      timestamp: Date.now(),
    };

    this.state.phase = 'signal_active';
    this.stats.signalsGenerated++;
    this.stats.lastSignalTime = Date.now();

    console.log(`🎯 LIQUIDITY SWEEP: ${direction.toUpperCase()} via ${pattern.type} | Conf: ${(confidence * 100).toFixed(1)}%`);
  }

  // ─── ATR ────────────────────────────────────────────────────
  _computeDailyATR() {
    const candles = this.state.dailyCandles;
    if (candles.length < this.config.atrPeriod + 1) {
      this.state.dailyATR = null;
      return;
    }
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const curr = candles[i];
      const prevClose = c(candles[i - 1]);
      trs.push(Math.max(h(curr) - l(curr), Math.abs(h(curr) - prevClose), Math.abs(l(curr) - prevClose)));
    }
    const recent = trs.slice(-this.config.atrPeriod);
    this.state.dailyATR = recent.reduce((s, t) => s + t, 0) / recent.length;
    this.state.manipThreshold = this.config.atrMultiplier * this.state.dailyATR;
  }

  // ─── GETTERS ────────────────────────────────────────────────
  getSignal() {
    if (!this.state.signal) {
      return {
        module: 'LiquiditySweep',
        hasSignal: false,
        direction: 'neutral',
        confidence: 0,
        phase: this.state.phase,
        box: this.state.box ? {
          high: this.state.box.high, low: this.state.box.low,
          range: this.state.box.range, isManipCandle: this.state.box.isManipCandle,
          atrPct: this.state.box.atrPct, validations: this.state.box.validations,
        } : null,
        dailyATR: this.state.dailyATR,
        barsRemaining: Math.max(0, this.config.entryWindowBars - this.state.barsAfterOpen),
      };
    }
    return { module: 'LiquiditySweep', ...this.state.signal };
  }

  _emptySignal() {
    return { module: 'LiquiditySweep', hasSignal: false, direction: 'neutral', confidence: 0, phase: 'waiting' };
  }

  getStatus() {
    return {
      phase: this.state.phase,
      dailyATR: this.state.dailyATR?.toFixed(2) || 'N/A',
      box: this.state.box,
      exitSide: this.state.exitSide,
      barsAfterOpen: this.state.barsAfterOpen,
      barsRemaining: Math.max(0, this.config.entryWindowBars - this.state.barsAfterOpen),
      signal: this.state.signal,
      stats: { ...this.stats },
    };
  }

  destroy() {
    this.state = {};
    this._minuteBuffer5m = [];
    this._minuteBuffer15m = [];
    this._dailyCandle = null;
  }
}

module.exports = LiquiditySweepDetector;
