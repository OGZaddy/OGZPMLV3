/**
 * LiquiditySweepDetector.js — Timeframe-Agnostic
 * ==================================================
 * Detects institutional liquidity grabs.
 * 7-step system: ATR filter → manip candle → box → exit → reversal → entry → SL/TP
 *
 * FIX 2026-03-10: TIMEFRAME AGNOSTIC
 *   • Accepts ANY candle interval — 1m, 5m, 15m, 1h, whatever
 *   • Auto-detects candle interval from timestamps
 *   • All time-based config is in MINUTES, converted to bars at runtime
 *   • No hardcoded timeframe assumptions anywhere
 *
 * Integration:
 *   const sweep = new LiquiditySweepDetector({ disableSessionCheck: true });
 *   // In your candle loop (any timeframe):
 *   const signal = sweep.feedCandle(candle);
 */

'use strict';

const { c, o, h, l, v, t } = require('../core/CandleHelper');

class LiquiditySweepDetector {
  constructor(config = {}) {
    this.config = {
      atrMultiplier: config.atrMultiplier || 0.25,
      atrPeriod: config.atrPeriod || 14,
      entryWindowMinutes: config.entryWindowMinutes || 90,
      openingRangeMinutes: config.openingRangeMinutes || 15,
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
      sessionOpenHour: config.sessionOpenHour ?? 14,
      sessionOpenMinute: config.sessionOpenMinute ?? 30,
      disableSessionCheck: config.disableSessionCheck || false,
    };

    this._candleIntervalMs = null;
    this._candleIntervalMin = null;
    this._lastCandleTs = null;
    this._entryWindowBars = null;
    this._openingRangeBars = null;
    this._dailyCandle = null;
    this._currentDay = null;
    this._openingCandleFed = false;
    this._openingBuffer = [];

    this.reset();

    this.stats = {
      totalSessionsAnalyzed: 0,
      manipCandlesDetected: 0,
      manipCandlesValidated: 0,
      signalsGenerated: 0,
      hammersDetected: 0,
      engulfingsDetected: 0,
      lastSignalTime: null,
      detectedIntervalMin: null,
    };
  }

  reset() {
    const initialPhase = this.config?.disableSessionCheck ? 'building_box' : 'waiting_for_open';
    this.state = {
      phase: initialPhase,
      sessionDate: null,
      dailyCandles: this.state?.dailyCandles || [],
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
    this._openingCandleFed = false;
    this._openingBuffer = [];
  }

  _detectInterval(candle) {
    const ts = t(candle);
    if (!ts) return;
    if (this._lastCandleTs && !this._candleIntervalMs) {
      const diff = ts - this._lastCandleTs;
      if (diff > 0) {
        this._candleIntervalMs = diff;
        this._candleIntervalMin = Math.round(diff / 60000);
        this._entryWindowBars = Math.max(1, Math.round(this.config.entryWindowMinutes / this._candleIntervalMin));
        this._openingRangeBars = Math.max(1, Math.round(this.config.openingRangeMinutes / this._candleIntervalMin));
        this.stats.detectedIntervalMin = this._candleIntervalMin;
        console.log(`[LiquiditySweep] Auto-detected ${this._candleIntervalMin}m candles → entryWindow: ${this._entryWindowBars} bars, openingRange: ${this._openingRangeBars} bars`);
      }
    }
    this._lastCandleTs = ts;
  }

  feedCandle(candle) {
    if (!candle || c(candle) == null) return this._emptySignal();
    this._detectInterval(candle);

    const ts = t(candle);
    const date = new Date(ts);
    const dayStr = date.toISOString().split('T')[0];
    const utcHour = date.getUTCHours();
    const utcMinute = date.getUTCMinutes();

    if (this._currentDay && this._currentDay !== dayStr) {
      this._finalizeDailyCandle();
      this._newSession(dayStr);
    }
    this._currentDay = dayStr;
    this._updateDailyCandle(candle);

    if (!this.config.disableSessionCheck) {
      const isSessionOpen = (utcHour === this.config.sessionOpenHour && utcMinute === this.config.sessionOpenMinute);
      if (isSessionOpen && this.state.phase === 'waiting_for_open') {
        this.state.phase = 'building_box';
        this._openingCandleFed = false;
        this._openingBuffer = [];
      }
    }

    if (this.state.phase === 'building_box' && !this._openingCandleFed) {
      this._openingBuffer.push(candle);
      const barsNeeded = this._openingRangeBars || 1;
      if (this._openingBuffer.length >= barsNeeded) {
        const openingCandle = this._aggregateCandles(this._openingBuffer);
        this._processOpeningCandle(openingCandle);
        this._openingCandleFed = true;
        this._openingBuffer = [];
      }
      return this.getSignal();
    }

    if (this.state.phase === 'watching_for_exit' || this.state.phase === 'watching_for_pattern') {
      this._processCandle(candle);
    }

    if (process.env.BACKTEST_VERBOSE) {
      const candleTs = ts ? new Date(ts).toISOString() : 'unknown';
      if ((this.stats?.totalSessionsAnalyzed || 0) % 10 === 0 || this.state.phase !== 'waiting_for_open') {
        console.log(`[DEEP-LIQSWEEP] time=${candleTs} phase=${this.state.phase} interval=${this._candleIntervalMin||'?'}m ATR=${this.state.dailyATR?.toFixed(4)||'null'}`);
      }
    }

    return this.getSignal();
  }

  _aggregateCandles(candles) {
    if (!candles.length) return null;
    if (candles.length === 1) return candles[0];
    return {
      o: o(candles[0]),
      h: Math.max(...candles.map(bar => h(bar))),
      l: Math.min(...candles.map(bar => l(bar))),
      c: c(candles[candles.length - 1]),
      v: candles.reduce((s, bar) => s + (v(bar) || 0), 0),
      t: t(candles[candles.length - 1]),
    };
  }

  _updateDailyCandle(candle) {
    if (!this._dailyCandle) {
      this._dailyCandle = { o: o(candle), h: h(candle), l: l(candle), c: c(candle), v: v(candle) || 0, t: t(candle) };
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
    if (this.state.dailyCandles.length > maxBars) this.state.dailyCandles = this.state.dailyCandles.slice(-maxBars);
    this._computeDailyATR();
    this.state.priorHighs.push(dc.h);
    this.state.priorLows.push(dc.l);
    if (this.state.priorHighs.length > this.config.sweepLookbackBars) this.state.priorHighs = this.state.priorHighs.slice(-this.config.sweepLookbackBars);
    if (this.state.priorLows.length > this.config.sweepLookbackBars) this.state.priorLows = this.state.priorLows.slice(-this.config.sweepLookbackBars);
    this._dailyCandle = null;
  }

  _newSession(dayStr) {
    const initialPhase = this.config?.disableSessionCheck ? 'building_box' : 'waiting_for_open';
    this.state.phase = initialPhase;
    this.state.sessionDate = dayStr;
    this.state.box = null;
    this.state.exitSide = null;
    this.state.exitBar = null;
    this.state.prevBar = null;
    this.state.barsAfterOpen = 0;
    this.state.signal = null;
    this._openingCandleFed = false;
    this._openingBuffer = [];
  }

  _processOpeningCandle(openingCandle) {
    if (!openingCandle) { this.state.phase = 'done'; return; }
    const candleHigh = h(openingCandle);
    const candleLow = l(openingCandle);
    const candleOpen = o(openingCandle);
    const candleClose = c(openingCandle);
    const range = candleHigh - candleLow;
    const threshold = this.state.dailyATR ? this.config.atrMultiplier * this.state.dailyATR : null;
    const isManipCandle = threshold === null ? true : range >= threshold;
    this.stats.totalSessionsAnalyzed++;
    this.state.box = {
      high: candleHigh, low: candleLow, range, open: candleOpen, close: candleClose,
      isManipCandle, atrThreshold: threshold,
      atrPct: (range / this.state.dailyATR * 100).toFixed(1),
      validations: { passesATR: isManipCandle, sweepsHighs: false, sweepsLows: false, closesInsideRange: false },
      timestamp: t(openingCandle),
    };
    if (!isManipCandle) { this.state.phase = 'done'; return; }
    this.stats.manipCandlesDetected++;
    const upperWick = candleHigh - Math.max(candleOpen, candleClose);
    const lowerWick = Math.min(candleOpen, candleClose) - candleLow;
    const sweepExt = candleHigh * (this.config.sweepMinExtensionPct / 100);
    const sweepsHighs = this.state.priorHighs.some(ph => candleHigh > ph && candleHigh <= ph + sweepExt * 5 && upperWick > 0);
    const sweepsLows = this.state.priorLows.some(pl => candleLow < pl && candleLow >= pl - sweepExt * 5 && lowerWick > 0);
    this.state.box.validations.sweepsHighs = sweepsHighs;
    this.state.box.validations.sweepsLows = sweepsLows;
    const bodyMid = (candleOpen + candleClose) / 2;
    const rangeMid = (candleHigh + candleLow) / 2;
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

  _processCandle(bar) {
    if (!bar || !this.state.box || this.state.phase === 'done' || this.state.phase === 'waiting_for_open') return;
    this.state.barsAfterOpen++;
    const box = this.state.box;
    const maxBars = this._entryWindowBars || 6;
    if (this.state.barsAfterOpen > maxBars) {
      if (this.state.phase !== 'signal_active') this.state.phase = 'done';
      return;
    }
    if (this.state.phase === 'watching_for_exit') {
      if (c(bar) > box.high) {
        this.state.exitSide = 'above';
        this.state.exitBar = { o: o(bar), h: h(bar), l: l(bar), c: c(bar), v: v(bar), t: t(bar) };
        this.state.phase = 'watching_for_pattern';
      } else if (c(bar) < box.low) {
        this.state.exitSide = 'below';
        this.state.exitBar = { o: o(bar), h: h(bar), l: l(bar), c: c(bar), v: v(bar), t: t(bar) };
        this.state.phase = 'watching_for_pattern';
      }
      this.state.prevBar = { o: o(bar), h: h(bar), l: l(bar), c: c(bar), v: v(bar), t: t(bar) };
      return;
    }
    if (this.state.phase === 'watching_for_pattern') {
      const isOutsideBox = (this.state.exitSide === 'above' && c(bar) > box.high) || (this.state.exitSide === 'below' && c(bar) < box.low);
      if (!isOutsideBox) {
        this.state.phase = 'watching_for_exit';
        this.state.prevBar = { o: o(bar), h: h(bar), l: l(bar), c: c(bar), v: v(bar), t: t(bar) };
        return;
      }
      const pattern = this._detectReversalPattern(bar, this.state.prevBar, this.state.exitSide);
      if (pattern) this._generateSignal(pattern, bar, this.state.prevBar);
      this.state.prevBar = { o: o(bar), h: h(bar), l: l(bar), c: c(bar), v: v(bar), t: t(bar) };
    }
  }

  _detectReversalPattern(candle, prev, exitSide) {
    if (!candle || !prev) return null;
    const body = Math.abs(c(candle) - o(candle));
    const range = h(candle) - l(candle);
    const upperWick = h(candle) - Math.max(o(candle), c(candle));
    const lowerWick = Math.min(o(candle), c(candle)) - l(candle);
    const isBullish = c(candle) > o(candle);
    if (range === 0 || body === 0) return null;
    const bodyRatio = body / range;
    if (exitSide === 'below') {
      if (bodyRatio <= this.config.hammerBodyMaxPct && lowerWick / body >= this.config.hammerWickMinRatio && lowerWick > upperWick * 1.5) {
        this.stats.hammersDetected++;
        return { type: 'hammer', direction: 'bullish', wickExtreme: l(candle) };
      }
      if (isBullish && c(prev) < o(prev)) {
        const prevBody = Math.abs(c(prev) - o(prev));
        if (prevBody > 0 && body / prevBody >= this.config.engulfMinRatio && c(candle) >= o(prev) && o(candle) <= c(prev)) {
          this.stats.engulfingsDetected++;
          return { type: 'bullish_engulfing', direction: 'bullish', entryLevel: h(prev), stopLevel: l(candle) };
        }
      }
    }
    if (exitSide === 'above') {
      if (bodyRatio <= this.config.hammerBodyMaxPct && upperWick / body >= this.config.hammerWickMinRatio && upperWick > lowerWick * 1.5) {
        this.stats.hammersDetected++;
        return { type: 'inverted_hammer', direction: 'bearish', wickExtreme: h(candle) };
      }
      if (!isBullish && c(prev) > o(prev)) {
        const prevBody = Math.abs(c(prev) - o(prev));
        if (prevBody > 0 && body / prevBody >= this.config.engulfMinRatio && o(candle) >= c(prev) && c(candle) <= o(prev)) {
          this.stats.engulfingsDetected++;
          return { type: 'bearish_engulfing', direction: 'bearish', entryLevel: l(prev), stopLevel: h(candle) };
        }
      }
    }
    return null;
  }

  _generateSignal(pattern, signalCandle, prevCandle) {
    const box = this.state.box;
    const bufUp = 1 + (this.config.stopBufferPct / 100);
    const bufDn = 1 - (this.config.stopBufferPct / 100);
    let entry, stopLoss, takeProfit, direction;
    if (pattern.type === 'hammer') { direction = 'bullish'; entry = null; stopLoss = pattern.wickExtreme * bufDn; takeProfit = box.high; }
    else if (pattern.type === 'inverted_hammer') { direction = 'bearish'; entry = null; stopLoss = pattern.wickExtreme * bufUp; takeProfit = box.low; }
    else if (pattern.type === 'bullish_engulfing') { direction = 'bullish'; entry = pattern.entryLevel; stopLoss = pattern.stopLevel * bufDn; takeProfit = box.high; }
    else if (pattern.type === 'bearish_engulfing') { direction = 'bearish'; entry = pattern.entryLevel; stopLoss = pattern.stopLevel * bufUp; takeProfit = box.low; }
    let confidence = this.config.weights.manipCandle;
    if (box.validations.sweepsHighs || box.validations.sweepsLows) confidence += this.config.weights.wickSweep;
    if (box.validations.closesInsideRange) confidence += this.config.weights.sweepReject;
    if (pattern.type.includes('hammer')) confidence += this.config.weights.hammerPattern;
    else confidence += this.config.weights.engulfPattern;
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
      hasSignal: true, direction: direction === 'bullish' ? 'buy' : 'sell', confidence,
      pattern: pattern.type, entry,
      entryType: pattern.type.includes('hammer') ? 'next_candle_open' : 'limit_order',
      stopLoss, takeProfit,
      box: { high: box.high, low: box.low, range: box.range, atrPct: box.atrPct },
      validations: { ...box.validations }, exitSide: this.state.exitSide,
      barsSinceOpen: this.state.barsAfterOpen, timestamp: Date.now(),
    };
    this.state.phase = 'signal_active';
    this.stats.signalsGenerated++;
    this.stats.lastSignalTime = Date.now();
    console.log(`🎯 LIQUIDITY SWEEP: ${direction.toUpperCase()} via ${pattern.type} | Conf: ${(confidence * 100).toFixed(1)}% | Interval: ${this._candleIntervalMin||'?'}m`);
  }

  _computeDailyATR() {
    const candles = this.state.dailyCandles;
    if (candles.length < this.config.atrPeriod + 1) { this.state.dailyATR = null; return; }
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const curr = candles[i];
      const prevClose = candles[i - 1].close;
      trs.push(Math.max(curr.high - curr.low, Math.abs(curr.high - prevClose), Math.abs(curr.low - prevClose)));
    }
    const recent = trs.slice(-this.config.atrPeriod);
    this.state.dailyATR = recent.reduce((s, tr) => s + tr, 0) / recent.length;
    this.state.manipThreshold = this.config.atrMultiplier * this.state.dailyATR;
  }

  getSignal() {
    const maxBars = this._entryWindowBars || 6;
    if (!this.state.signal) {
      return {
        module: 'LiquiditySweep', hasSignal: false, direction: 'neutral', confidence: 0,
        phase: this.state.phase,
        box: this.state.box ? {
          high: this.state.box.high, low: this.state.box.low,
          range: this.state.box.range, isManipCandle: this.state.box.isManipCandle,
          atrPct: this.state.box.atrPct, validations: this.state.box.validations,
        } : null,
        dailyATR: this.state.dailyATR,
        barsRemaining: Math.max(0, maxBars - this.state.barsAfterOpen),
        candleIntervalMin: this._candleIntervalMin,
      };
    }
    return { module: 'LiquiditySweep', ...this.state.signal, candleIntervalMin: this._candleIntervalMin };
  }

  _emptySignal() { return { module: 'LiquiditySweep', hasSignal: false, direction: 'neutral', confidence: 0, phase: 'waiting' }; }

  getStatus() {
    const maxBars = this._entryWindowBars || 6;
    return {
      phase: this.state.phase, dailyATR: this.state.dailyATR?.toFixed(2) || 'N/A',
      box: this.state.box, exitSide: this.state.exitSide,
      barsAfterOpen: this.state.barsAfterOpen,
      barsRemaining: Math.max(0, maxBars - this.state.barsAfterOpen),
      signal: this.state.signal, stats: { ...this.stats },
      candleIntervalMin: this._candleIntervalMin,
      entryWindowBars: this._entryWindowBars, openingRangeBars: this._openingRangeBars,
    };
  }

  destroy() { this.state = {}; this._dailyCandle = null; this._openingBuffer = []; }
}

module.exports = LiquiditySweepDetector;
