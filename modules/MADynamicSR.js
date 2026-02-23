/**
 * MADynamicSR.js — V2-Compatible Rebuild
 * =======================================
 * Treats EMAs/SMAs as living support/resistance levels.
 * Detects: MA bounce, MA break, MA retest, MA compression zones.
 *
 * V2 FIXES:
 *   • Candle format: uses .c/.o/.h/.l/.v/.t (Kraken OHLCV)
 *   • Self-contained EMA/SMA — no dependency on OptimizedIndicators
 *   • Bounded arrays (touchHistory, signalLog)
 *   • Clean integration API: update(candle, priceHistory) → signal
 *
 * Integration:
 *   const maSR = new MADynamicSR();
 *   const signal = maSR.update(candle, this.priceHistory);
 *   // signal = { direction, confidence, events[], compression, levels }
 */

'use strict';

// FIX 2026-02-16: Use centralized candle helper for format compatibility
const { c, h, l } = require('../core/CandleHelper');

class MADynamicSR {
  constructor(config = {}) {
    // MA levels to track as dynamic S/R
    this.maDefinitions = [
      { id: 'ema9',   period: 9,   type: 'ema', importance: 0.6 },
      { id: 'sma20',  period: 20,  type: 'sma', importance: 0.8 },
      { id: 'ema50',  period: 50,  type: 'ema', importance: 1.0 },
      { id: 'sma200', period: 200, type: 'sma', importance: 1.5 },
    ];

    // Touch zone: ±1.5% of price counts as "near" the MA
    // FIX 2026-02-18: Loosened from 0.3% - was too tight, never fired
    this.touchZonePct = config.touchZonePct || 1.5;

    // Bounce confirmation: 0.15% move away from MA
    // FIX 2026-02-18: Loosened from 0.5% - low volatility data never hit this
    this.bounceConfirmPct = config.bounceConfirmPct || 0.15;

    // Break confirmation: 0.4% through MA
    this.breakConfirmPct = config.breakConfirmPct || 0.4;

    // Retest window: bars after break to look for retest
    this.retestWindowBars = config.retestWindowBars || 12;

    // Compression: N MAs within X% = squeeze
    this.compressionMinMAs = config.compressionMinMAs || 3;
    this.compressionRangePct = config.compressionRangePct || 2.0;

    // Signal decay
    this.decayBars = config.decayBars || 8;

    // --- internal state ---
    this.touchState = {};     // { maId: { touching, side, barsAgo } }
    this.breakState = {};     // { maId: { broken, direction, barsAgo } }
    this.activeSignals = [];  // BOUNDED at 20
    this.signalLog = [];      // BOUNDED at 50
    this.barCount = 0;

    for (const ma of this.maDefinitions) {
      this.touchState[ma.id] = { touching: false, side: 'none', barsAgo: 999 };
      this.breakState[ma.id] = { broken: false, direction: 'none', barsAgo: 999 };
    }
  }

  // ─── CORE API ───────────────────────────────────────────────

  /**
   * @param {Object} candle        — { c, o, h, l, v, t }
   * @param {Array}  priceHistory   — candles array, newest LAST
   * @returns {Object} signal
   */
  update(candle, priceHistory) {
    if (!priceHistory || priceHistory.length < 10) {
      return this._emptySignal();
    }

    this.barCount++;
    const closes = priceHistory.map(candle => c(candle));
    const price = c(candle);
    const high = h(candle);
    const low = l(candle);

    // Calculate MA values
    const levels = {};
    for (const ma of this.maDefinitions) {
      const val = ma.type === 'ema'
        ? this._ema(closes, ma.period)
        : this._sma(closes, ma.period);
      levels[ma.id] = val;  // null if not enough data
    }

    // Detect events per MA
    const events = [];
    let bullishScore = 0;
    let bearishScore = 0;

    for (const ma of this.maDefinitions) {
      const maVal = levels[ma.id];
      if (maVal == null) continue;

      const touchZone = maVal * (this.touchZonePct / 100);
      const isTouching = Math.abs(price - maVal) <= touchZone;
      const priceAbove = price > maVal;
      const priceFarAbove = ((price - maVal) / maVal) * 100 > this.bounceConfirmPct;
      const priceFarBelow = ((maVal - price) / maVal) * 100 > this.bounceConfirmPct;
      const breakThrough = Math.abs(price - maVal) / maVal * 100 > this.breakConfirmPct;

      const touch = this.touchState[ma.id];
      const brk = this.breakState[ma.id];

      // --- BOUNCE detection ---
      if (touch.touching && !isTouching) {
        // Was touching, now moved away
        if (touch.side === 'above' && priceFarAbove) {
          // Bounced UP off MA (support hold)
          events.push({
            type: 'bounce_support',
            ma: ma.id,
            maValue: maVal,
            importance: ma.importance
          });
          bullishScore += 0.15 * ma.importance;
        } else if (touch.side === 'below' && priceFarBelow) {
          // Bounced DOWN off MA (resistance hold)
          events.push({
            type: 'bounce_resistance',
            ma: ma.id,
            maValue: maVal,
            importance: ma.importance
          });
          bearishScore += 0.15 * ma.importance;
        }
      }

      // --- BREAK detection ---
      if (!brk.broken && breakThrough) {
        const brokeUp = price > maVal && (touch.side === 'below' || touch.touching);
        const brokeDown = price < maVal && (touch.side === 'above' || touch.touching);

        if (brokeUp) {
          brk.broken = true;
          brk.direction = 'breakout';
          brk.barsAgo = 0;
          events.push({
            type: 'breakout',
            ma: ma.id,
            maValue: maVal,
            importance: ma.importance
          });
          bullishScore += 0.20 * ma.importance;
        } else if (brokeDown) {
          brk.broken = true;
          brk.direction = 'breakdown';
          brk.barsAgo = 0;
          events.push({
            type: 'breakdown',
            ma: ma.id,
            maValue: maVal,
            importance: ma.importance
          });
          bearishScore += 0.20 * ma.importance;
        }
      }

      // --- RETEST detection (after a break, price returns to MA) ---
      if (brk.broken && brk.barsAgo <= this.retestWindowBars && isTouching) {
        if (brk.direction === 'breakout' && priceAbove) {
          // Retested from above after breakout — confirmation!
          events.push({
            type: 'retest_support',
            ma: ma.id,
            maValue: maVal,
            importance: ma.importance
          });
          bullishScore += 0.10 * ma.importance;
          brk.broken = false;  // consumed
        } else if (brk.direction === 'breakdown' && !priceAbove) {
          events.push({
            type: 'retest_resistance',
            ma: ma.id,
            maValue: maVal,
            importance: ma.importance
          });
          bearishScore += 0.10 * ma.importance;
          brk.broken = false;
        }
      }

      // Age out breaks
      if (brk.broken) {
        brk.barsAgo++;
        if (brk.barsAgo > this.retestWindowBars) {
          brk.broken = false;
        }
      }

      // Update touch state
      touch.touching = isTouching;
      touch.side = priceAbove ? 'above' : 'below';
      touch.barsAgo = isTouching ? 0 : touch.barsAgo + 1;
    }

    // --- COMPRESSION detection ---
    const validLevels = this.maDefinitions
      .filter(ma => levels[ma.id] != null)
      .map(ma => levels[ma.id]);

    let compression = null;
    if (validLevels.length >= this.compressionMinMAs) {
      const maxMA = Math.max(...validLevels);
      const minMA = Math.min(...validLevels);
      const rangePct = ((maxMA - minMA) / minMA) * 100;

      if (rangePct <= this.compressionRangePct) {
        compression = {
          rangePct,
          masInvolved: validLevels.length,
          midpoint: (maxMA + minMA) / 2,
          warning: 'Explosive move likely — MAs compressed'
        };
        // Don't add directional bias — compression is neutral until break
      }
    }

    // FIX 2026-02-18: Include accumulated score from recent (undecayed) signals
    // This makes bounce/retest signals persist for ~8 candles instead of 1
    // Without this, signals vanished before Brain could act on them
    for (const sig of this.activeSignals) {
      const decayFactor = 1 - (sig.age / this.decayBars);
      if (decayFactor > 0) {
        if (sig.type.includes('support') || sig.type === 'breakout') {
          bullishScore += 0.08 * sig.importance * decayFactor;
        } else if (sig.type.includes('resistance') || sig.type === 'breakdown') {
          bearishScore += 0.08 * sig.importance * decayFactor;
        }
      }
    }

    // --- TREND DETECTION (THE FIX) ---
    // FIX 2026-02-23: Only trade WITH the trend, not against it
    // Uptrend = price above SMA200 + SMA20 sloping up
    // Downtrend = price below SMA200 + SMA20 sloping down
    const sma20 = levels['sma20'];
    const sma200 = levels['sma200'];
    let trend = 'neutral';

    if (sma20 && sma200 && closes.length >= 5) {
      const sma20_5ago = this._sma(closes.slice(0, -5), 20);
      const sma20Slope = sma20_5ago ? (sma20 - sma20_5ago) / sma20_5ago : 0;

      if (price > sma200 && sma20Slope > 0.001) {
        trend = 'up';
      } else if (price < sma200 && sma20Slope < -0.001) {
        trend = 'down';
      }
    }

    // --- Aggregate (TREND-ALIGNED SIGNALS ONLY) ---
    // FIX 2026-02-23: Only fire bullish in uptrend, bearish in downtrend
    let direction = 'neutral';
    let confidence = 0;

    // UPTREND: Only take bullish signals (MA = support)
    if (trend === 'up' && bullishScore > bearishScore && bullishScore > 0.1) {
      direction = 'buy';
      const baseConf = Math.min(0.45, bullishScore * 0.35);
      const eventBonus = Math.min(0.20, events.length * 0.08);
      const persistBonus = Math.min(0.15, this.activeSignals.length * 0.025);
      const compressBonus = compression ? 0.10 : 0;
      const trendBonus = 0.10;  // Trading WITH the trend
      confidence = baseConf + eventBonus + persistBonus + compressBonus + trendBonus;
    }
    // DOWNTREND: Only take bearish signals (MA = resistance)
    else if (trend === 'down' && bearishScore > bullishScore && bearishScore > 0.1) {
      direction = 'sell';
      const baseConf = Math.min(0.45, bearishScore * 0.35);
      const eventBonus = Math.min(0.20, events.length * 0.08);
      const persistBonus = Math.min(0.15, this.activeSignals.length * 0.025);
      const compressBonus = compression ? 0.10 : 0;
      const trendBonus = 0.10;
      confidence = baseConf + eventBonus + persistBonus + compressBonus + trendBonus;
    }
    // NEUTRAL/CHOPPY: No signal - don't trade against trend or in chop
    // (This is what the YouTube traders do - they WAIT for clear trend)

    // Decay active signals
    this.activeSignals = this.activeSignals
      .map(s => ({ ...s, age: s.age + 1 }))
      .filter(s => s.age <= this.decayBars);

    // Add new events as active signals
    for (const evt of events) {
      this.activeSignals.push({ ...evt, age: 0 });
      if (this.activeSignals.length > 20) this.activeSignals.shift();
    }

    const signal = {
      module: 'MADynamicSR',
      direction,
      confidence,
      events,
      compression,
      levels,               // raw MA values for dashboard
      activeSignals: this.activeSignals.length,
      bullishScore,
      bearishScore
    };

    this.signalLog.push({ t: candle.t, ...signal });
    if (this.signalLog.length > 50) this.signalLog.shift();

    return signal;
  }

  // ─── MA CALCULATIONS ────────────────────────────────────────

  _ema(closes, period) {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    let ema = 0;
    for (let i = 0; i < period; i++) ema += closes[i];
    ema /= period;
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
  }

  _sma(closes, period) {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  // ─── HELPERS ────────────────────────────────────────────────

  _emptySignal() {
    return {
      module: 'MADynamicSR',
      direction: 'neutral',
      confidence: 0,
      events: [],
      compression: null,
      levels: {},
      activeSignals: 0,
      bullishScore: 0,
      bearishScore: 0
    };
  }

  getSnapshot() {
    return {
      levels: { ...this.touchState },
      breaks: { ...this.breakState },
      lastSignal: this.signalLog[this.signalLog.length - 1] || null,
      recentSignals: this.signalLog.slice(-5)
    };
  }

  destroy() {
    this.signalLog = [];
    this.activeSignals = [];
    this.touchState = {};
    this.breakState = {};
  }
}

module.exports = MADynamicSR;
