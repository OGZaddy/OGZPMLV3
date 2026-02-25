/**
 * EMASMACrossoverSignal.js — V2-Compatible Rebuild
 * ================================================
 * Detects Golden/Death crosses across multiple MA pairs.
 * Tracks divergence velocity, snapback, blowoff, and confluence.
 *
 * V2 FIXES:
 *   • Candle format: uses .c/.o/.h/.l/.v/.t (Kraken OHLCV)
 *   • Self-contained EMA/SMA — no dependency on OptimizedIndicators
 *   • Bounded arrays (divergenceHistory, signalLog)
 *   • Clean integration API: update(candle, priceHistory) → signal
 *
 * Integration:
 *   const crossover = new EMASMACrossoverSignal();
 *   // Inside your candle loop:
 *   const signal = crossover.update(candle, this.priceHistory);
 *   // signal = { direction, confidence, crossovers, snapback, blowoff, confluence }
 */

'use strict';

// FIX 2026-02-16: Use centralized candle helper for format compatibility
const { c } = require('../core/CandleHelper');

class EMASMACrossoverSignal {
  constructor(config = {}) {
    // MA pair definitions — period pairs + type
    this.pairs = [
      { id: 'ema9_20',   fast: 9,   slow: 20,  type: 'ema', weight: 1.0 },
      { id: 'ema20_50',  fast: 20,  slow: 50,  type: 'ema', weight: 1.2 },
      { id: 'ema50_200', fast: 50,  slow: 200, type: 'ema', weight: 1.5 },
      { id: 'sma20_50',  fast: 20,  slow: 50,  type: 'sma', weight: 1.0 },
      { id: 'sma50_200', fast: 50,  slow: 200, type: 'sma', weight: 1.4 },
    ];

    // Signal decay (bars until a crossover signal fades)
    this.decayBars = config.decayBars || 10;

    // Divergence tracking depth
    this.divergenceDepth = config.divergenceDepth || 20;

    // Snapback: how far (%) spread must extend before qualifying
    this.snapbackThresholdPct = config.snapbackThresholdPct || 2.5;

    // Blowoff: acceleration threshold (spread velocity increasing)
    this.blowoffAccelThreshold = config.blowoffAccelThreshold || 0.15;

    // --- internal state ---
    this.crossoverState = {};      // { pairId: { side, barsAgo } }
    this.prevSpreads = {};         // { pairId: number } — last tick's spread
    this.divergenceHistory = {};   // { pairId: [{ spread, velocity }] }  BOUNDED
    this.signalLog = [];           // recent signals — BOUNDED at 50

    // Pre-init state per pair
    for (const p of this.pairs) {
      this.crossoverState[p.id] = { side: 'none', barsAgo: 999 };
      this.prevSpreads[p.id] = null;
      this.divergenceHistory[p.id] = [];
    }
  }

  // ─── CORE API ───────────────────────────────────────────────
  /**
   * Feed a new 1-minute candle + full price history.
   * Returns a unified signal object.
   *
   * @param {Object} candle  — { c, o, h, l, v, t } (V2 Kraken format)
   * @param {Array}  priceHistory — array of candles, newest LAST
   * @returns {Object} signal
   */
  update(candle, priceHistory) {
    if (!priceHistory || priceHistory.length < 10) {
      return this._emptySignal();
    }

    const closes = priceHistory.map(candle => c(candle));
    const price = c(candle);

    // Calculate all MAs we need
    const maValues = this._calculateAllMAs(closes);

    // Process each pair
    const crossovers = [];
    let bullishCount = 0;
    let bearishCount = 0;
    let totalWeight = 0;
    let snapbackSignal = null;
    let blowoffWarning = false;

    for (const pair of this.pairs) {
      const fastVal = maValues[`${pair.type}${pair.fast}`];
      const slowVal = maValues[`${pair.type}${pair.slow}`];

      if (fastVal == null || slowVal == null) continue;

      const spread = ((fastVal - slowVal) / slowVal) * 100;  // as %
      const prevSpread = this.prevSpreads[pair.id];
      const state = this.crossoverState[pair.id];

      // --- Crossover detection ---
      const prevSide = state.side;
      const currentSide = fastVal > slowVal ? 'golden' : fastVal < slowVal ? 'death' : 'flat';

      if (prevSide !== 'none' && prevSide !== currentSide && currentSide !== 'flat') {
        // New crossover!
        state.side = currentSide;
        state.barsAgo = 0;

        crossovers.push({
          pair: pair.id,
          type: currentSide,  // 'golden' or 'death'
          weight: pair.weight,
          spread: spread
        });
      } else {
        state.side = currentSide;
        state.barsAgo++;
      }

      // --- Active signal decay ---
      if (state.barsAgo <= this.decayBars) {
        const decayFactor = 1 - (state.barsAgo / this.decayBars);
        if (currentSide === 'golden') {
          bullishCount += pair.weight * decayFactor;
        } else if (currentSide === 'death') {
          bearishCount += pair.weight * decayFactor;
        }
      }
      totalWeight += pair.weight;

      // --- Divergence tracking ---
      if (prevSpread != null) {
        const velocity = spread - prevSpread;
        const hist = this.divergenceHistory[pair.id];
        hist.push({ spread, velocity });
        if (hist.length > this.divergenceDepth) hist.shift();  // BOUNDED

        // Snapback detection: spread overextended + decelerating
        if (hist.length >= 3) {
          const lastVelocity = hist[hist.length - 1].velocity;
          const prevVelocity = hist[hist.length - 2].velocity;
          const acceleration = lastVelocity - prevVelocity;

          const absSpread = Math.abs(spread);
          const isOverextended = absSpread > this.snapbackThresholdPct;
          const isDecelerating = (spread > 0 && acceleration < -0.05) ||
                                 (spread < 0 && acceleration > 0.05);

          if (isOverextended && isDecelerating) {
            snapbackSignal = {
              pair: pair.id,
              direction: spread > 0 ? 'bearish_snapback' : 'bullish_snapback',
              spread: spread,
              confidence: Math.min(0.8, absSpread / 5)  // scale by extension
            };
          }

          // Blowoff detection: MAs accelerating apart
          if (Math.abs(acceleration) > this.blowoffAccelThreshold && Math.abs(lastVelocity) > Math.abs(prevVelocity)) {
            blowoffWarning = true;
          }
        }
      }

      this.prevSpreads[pair.id] = spread;
    }

    // --- Confluence ---
    const confluenceRatio = totalWeight > 0
      ? Math.max(bullishCount, bearishCount) / totalWeight
      : 0;

    // --- Direction (EVIDENCE-BASED CONFIDENCE) ---
    // FIX 2026-02-23: Dynamic confidence from stacked evidence, not static caps
    let direction = 'neutral';
    let confidence = 0;

    if (bullishCount > bearishCount && bullishCount > 0.3) {
      direction = 'buy';
      // Stack evidence: confluence + fresh crosses + heavyweight pairs
      const baseConf = confluenceRatio * 0.45;             // Alignment across pairs (0-45%)
      const freshBonus = Math.min(0.25, crossovers.filter(c => c.type === 'golden').length * 0.12);
      const heavyBonus = crossovers.some(c => c.weight >= 1.4 && c.type === 'golden') ? 0.10 : 0;
      confidence = baseConf + freshBonus + heavyBonus;
    } else if (bearishCount > bullishCount && bearishCount > 0.3) {
      direction = 'sell';
      const baseConf = confluenceRatio * 0.45;
      const freshBonus = Math.min(0.25, crossovers.filter(c => c.type === 'death').length * 0.12);
      const heavyBonus = crossovers.some(c => c.weight >= 1.4 && c.type === 'death') ? 0.10 : 0;
      confidence = baseConf + freshBonus + heavyBonus;
    }

    // Snapback overrides (scaled better)
    if (snapbackSignal) {
      if (snapbackSignal.direction === 'bullish_snapback') {
        direction = 'buy';
        confidence = Math.max(confidence, snapbackSignal.confidence * 0.5);
      } else {
        direction = 'sell';
        confidence = Math.max(confidence, snapbackSignal.confidence * 0.5);
      }
    }

    // Blowoff warning reduces confidence (don't chase!)
    if (blowoffWarning) {
      confidence *= 0.5;
    }

    // FIX 2026-02-25: Add SL/TP fields for consistency with other strategies
    // Default: 0.5% stop, 0.8% target (uses ECM defaults if not overridden)
    const signal = {
      module: 'EMASMACrossover',
      direction,
      confidence,
      stopLoss: null,        // Let ExitContractManager use strategy defaults
      takeProfit: null,      // Let ExitContractManager use strategy defaults
      crossovers,            // new crosses this tick
      activeBullish: bullishCount,
      activeBearish: bearishCount,
      confluence: confluenceRatio,
      snapback: snapbackSignal,
      blowoff: blowoffWarning,
      maValues               // expose raw MA values for dashboard
    };

    // Log (bounded)
    this.signalLog.push({ t: candle.t, ...signal });
    if (this.signalLog.length > 50) this.signalLog.shift();

    return signal;
  }

  // ─── MA CALCULATIONS (self-contained) ───────────────────────

  _calculateAllMAs(closes) {
    const result = {};
    const periods = new Set();
    for (const p of this.pairs) {
      periods.add(`${p.type}${p.fast}`);
      periods.add(`${p.type}${p.slow}`);
    }

    for (const key of periods) {
      const type = key.startsWith('ema') ? 'ema' : 'sma';
      const period = parseInt(key.replace(/^(ema|sma)/, ''));

      if (closes.length < period) {
        result[key] = null;
        continue;
      }

      if (type === 'ema') {
        result[key] = this._ema(closes, period);
      } else {
        result[key] = this._sma(closes, period);
      }
    }
    return result;
  }

  _ema(closes, period) {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    // Seed with SMA of first `period` values
    let ema = 0;
    for (let i = 0; i < period; i++) ema += closes[i];
    ema /= period;
    // Walk forward
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
      module: 'EMASMACrossover',
      direction: 'neutral',
      confidence: 0,
      stopLoss: null,      // FIX 2026-02-25: Add for consistency
      takeProfit: null,    // FIX 2026-02-25: Add for consistency
      crossovers: [],
      activeBullish: 0,
      activeBearish: 0,
      confluence: 0,
      snapback: null,
      blowoff: false,
      maValues: {}
    };
  }

  /** Dashboard snapshot */
  getSnapshot() {
    return {
      crossoverState: { ...this.crossoverState },
      lastSignal: this.signalLog[this.signalLog.length - 1] || null,
      recentSignals: this.signalLog.slice(-5)
    };
  }

  /** Cleanup for shutdown */
  destroy() {
    this.signalLog = [];
    this.divergenceHistory = {};
    this.crossoverState = {};
    this.prevSpreads = {};
  }
}

module.exports = EMASMACrossoverSignal;
