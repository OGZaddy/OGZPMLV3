/**
 * MultiTimeframeAdapter.js — V2-Compatible Rebuild
 * =================================================
 * Aggregates 1m candles into 5m/15m/30m/1h/4h/1d timeframes.
 * Calculates indicators per timeframe. Returns confluence score.
 *
 * V2 FIXES:
 *   • All candles use V2 format: { c, o, h, l, v, t } (Kraken OHLCV)
 *   • No external indicator dependencies — self-contained math
 *   • Bounded arrays (maxCandles per timeframe)
 *   • Clean API: ingestCandle(candle) + getConfluenceScore()
 *   • EventEmitter for dashboard integration
 *   • Optional Polygon backfill kept but normalized to V2 format
 *
 * Integration:
 *   const mtf = new MultiTimeframeAdapter({ activeTimeframes: ['1m','5m','15m','1h','4h','1d'] });
 *   // In your 1m candle loop:
 *   mtf.ingestCandle(candle);  // candle = { c, o, h, l, v, t }
 *   const confluence = mtf.getConfluenceScore();
 */

'use strict';

const EventEmitter = require('events');

// FIX 2026-02-16: Use centralized candle helper for format compatibility
const { c, o, h, l, v, t } = require('../core/CandleHelper');

class MultiTimeframeAdapter extends EventEmitter {
  constructor(config = {}) {
    super();

    this.TIMEFRAME_CONFIG = {
      '1m':  { ms: 60000,      maxCandles: 1440 },
      '5m':  { ms: 300000,     maxCandles: 576  },
      '15m': { ms: 900000,     maxCandles: 384  },
      '30m': { ms: 1800000,    maxCandles: 336  },
      '1h':  { ms: 3600000,    maxCandles: 720  },
      '4h':  { ms: 14400000,   maxCandles: 360  },
      '1d':  { ms: 86400000,   maxCandles: 365  },
    };

    this.config = {
      activeTimeframes: config.activeTimeframes || ['1m', '5m', '15m', '1h', '4h', '1d'],
      indicatorPeriods: {
        rsi: 14,
        smaFast: 10,
        smaSlow: 50,
        ema: 21,
        macdFast: 12,
        macdSlow: 26,
        atr: 14,
        bollingerPeriod: 20,
        bollingerStd: 2,
        ...(config.indicatorPeriods || {}),
      },
      minCandlesForAnalysis: config.minCandlesForAnalysis || 30,
    };

    // Storage
    this.candles = new Map();
    this.pendingCandles = new Map();
    this.indicators = new Map();
    this.readyTimeframes = new Set();
    this.lastUpdate = new Map();

    this.stats = {
      candlesProcessed: 0,
      aggregationsPerformed: 0,
      indicatorCalculations: 0,
      confluenceChecks: 0,
      errors: 0,
    };

    for (const tf of this.config.activeTimeframes) {
      this.candles.set(tf, []);
      this.pendingCandles.set(tf, null);
      this.indicators.set(tf, null);
      this.lastUpdate.set(tf, 0);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 1: CANDLE INGESTION + AGGREGATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Feed a 1-minute candle from the WebSocket.
   * @param {Object} candle — { c, o, h, l, v, t } (V2 Kraken)
   */
  ingestCandle(candle) {
    if (!candle || c(candle) == null || t(candle) == null) return;

    this.stats.candlesProcessed++;

    // Store raw 1m
    this._addCandle('1m', candle);

    // Aggregate into higher timeframes
    for (const tf of this.config.activeTimeframes) {
      if (tf === '1m') continue;
      const tfConfig = this.TIMEFRAME_CONFIG[tf];
      if (!tfConfig) continue;
      this._aggregateInto(tf, candle);
    }

    // Recalc indicators on ready timeframes
    this._recalculateIndicators();

    this.emit('timeframes_updated', {
      timestamp: t(candle),
      price: c(candle),
      readyTimeframes: Array.from(this.readyTimeframes),
    });
  }

  /**
   * Aggregate a 1m candle into a higher timeframe's pending candle.
   * @private
   */
  _aggregateInto(timeframe, minuteCandle) {
    const tfConfig = this.TIMEFRAME_CONFIG[timeframe];
    const interval = tfConfig.ms;
    const candleStart = Math.floor(_t(minuteCandle) / interval) * interval;

    let pending = this.pendingCandles.get(timeframe);

    if (!pending || _t(pending) !== candleStart) {
      // Previous candle complete — store it
      if (pending && _t(pending)) {
        this._addCandle(timeframe, { ...pending });
        this.stats.aggregationsPerformed++;
      }

      // New candle
      pending = {
        t: candleStart,
        o: _o(minuteCandle),
        h: _h(minuteCandle),
        l: _l(minuteCandle),
        c: _c(minuteCandle),
        v: _v(minuteCandle) || 0,
        tickCount: 1,
      };
    } else {
      _h(pending) = Math.max(_h(pending), _h(minuteCandle));
      _l(pending) = Math.min(_l(pending), _l(minuteCandle));
      _c(pending) = _c(minuteCandle);
      _v(pending) += (_v(minuteCandle) || 0);
      pending.tickCount++;
    }

    this.pendingCandles.set(timeframe, pending);
  }

  /**
   * Add a completed candle to storage with max-size enforcement.
   * @private
   */
  _addCandle(timeframe, candle) {
    const arr = this.candles.get(timeframe);
    if (!arr) return;

    const tfConfig = this.TIMEFRAME_CONFIG[timeframe];
    const max = tfConfig ? tfConfig.maxCandles : 500;

    arr.push(candle);
    if (arr.length > max) arr.splice(0, arr.length - max);

    this.lastUpdate.set(timeframe, _t(candle));

    if (arr.length >= this.config.minCandlesForAnalysis) {
      this.readyTimeframes.add(timeframe);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 2: INDICATORS PER TIMEFRAME
  // ═══════════════════════════════════════════════════════════

  /** @private */
  _recalculateIndicators() {
    for (const tf of this.readyTimeframes) {
      const candleArr = this.candles.get(tf);
      if (!candleArr || candleArr.length < this.config.minCandlesForAnalysis) continue;

      const closes = candleArr.map(candle => c(candle));
      const highs = candleArr.map(candle => h(candle));
      const lows = candleArr.map(candle => l(candle));
      const volumes = candleArr.map(candle => v(candle));

      try {
        const p = this.config.indicatorPeriods;
        const snapshot = {
          timeframe: tf,
          timestamp: Date.now(),
          candleCount: candleArr.length,
          price: closes[closes.length - 1],
          rsi: this._calcRSI(closes, p.rsi),
          smaFast: this._calcSMA(closes, p.smaFast),
          smaSlow: this._calcSMA(closes, p.smaSlow),
          ema: this._calcEMA(closes, p.ema),
          macd: this._calcMACD(closes, p.macdFast, p.macdSlow),
          atr: this._calcATR(highs, lows, closes, p.atr),
          bollinger: this._calcBollinger(closes, p.bollingerPeriod, p.bollingerStd),
          trend: null,
          trendStrength: 0,
          volumeSMA: this._calcSMA(volumes, 20),
          volumeRatio: 0,
        };

        // Derive trend
        if (snapshot.smaFast && snapshot.smaSlow) {
          if (snapshot.smaFast > snapshot.smaSlow) {
            snapshot.trend = 'bullish';
            snapshot.trendStrength = Math.min(1, (snapshot.smaFast - snapshot.smaSlow) / snapshot.smaSlow * 100);
          } else {
            snapshot.trend = 'bearish';
            snapshot.trendStrength = Math.min(1, (snapshot.smaSlow - snapshot.smaFast) / snapshot.smaFast * 100);
          }
        }

        if (snapshot.volumeSMA && snapshot.volumeSMA > 0) {
          snapshot.volumeRatio = volumes[volumes.length - 1] / snapshot.volumeSMA;
        }

        this.indicators.set(tf, snapshot);
        this.stats.indicatorCalculations++;
      } catch (err) {
        this.stats.errors++;
      }
    }
  }

  // ── Self-contained indicator math ───────────────────────────

  _calcRSI(closes, period) {
    if (closes.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change; else losses += Math.abs(change);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  }

  _calcSMA(data, period) {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  _calcEMA(data, period) {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  _calcMACD(closes, fast, slow) {
    const emaFast = this._calcEMA(closes, fast);
    const emaSlow = this._calcEMA(closes, slow);
    if (emaFast === null || emaSlow === null) return null;
    const macdLine = emaFast - emaSlow;
    return { macdLine, bullish: macdLine > 0 };
  }

  _calcATR(highs, lows, closes, period) {
    if (highs.length < period + 1) return null;
    const trs = [];
    for (let i = highs.length - period; i < highs.length; i++) {
      trs.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      ));
    }
    return trs.reduce((a, b) => a + b, 0) / trs.length;
  }

  _calcBollinger(closes, period, stdDev) {
    const sma = this._calcSMA(closes, period);
    if (sma === null) return null;
    const slice = closes.slice(-period);
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
    const std = Math.sqrt(variance);
    return {
      upper: sma + (std * stdDev),
      middle: sma,
      lower: sma - (std * stdDev),
      bandwidth: ((std * stdDev * 2) / sma),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 3: CONFLUENCE SCORING
  // ═══════════════════════════════════════════════════════════

  /**
   * Get weighted confluence score across all ready timeframes.
   * @returns {Object} analysis with direction, confidence, shouldTrade
   */
  getConfluenceScore() {
    this.stats.confluenceChecks++;

    const analysis = {
      module: 'MultiTimeframe',
      timestamp: Date.now(),
      readyTimeframes: Array.from(this.readyTimeframes),
      totalTimeframes: this.config.activeTimeframes.length,
      bullishCount: 0,
      bearishCount: 0,
      neutralCount: 0,
      overallBias: 'neutral',
      confluenceScore: 0,
      confidence: 0,
      rsiAverage: 0,
      rsiExtreme: false,
      trendAlignment: 0,
      timeframeSignals: {},
      shouldTrade: false,
      direction: 'neutral',
      reasoning: [],
    };

    if (this.readyTimeframes.size === 0) {
      analysis.reasoning.push('No timeframes ready yet');
      return analysis;
    }

    const weights = {
      '1m': 0.05, '5m': 0.08, '15m': 0.10, '30m': 0.10,
      '1h': 0.15, '4h': 0.17, '1d': 0.15,
    };

    let weightedScore = 0, totalWeight = 0;
    let rsiSum = 0, rsiCount = 0;
    let trendMatches = 0, trendTotal = 0;
    let primaryTrend = null;

    for (const tf of this.readyTimeframes) {
      const ind = this.indicators.get(tf);
      if (!ind) continue;

      const weight = weights[tf] || 0.05;
      let signal = 0;

      // RSI
      if (ind.rsi !== null) {
        rsiSum += ind.rsi;
        rsiCount++;
        if (ind.rsi < 30) signal += 0.4;
        else if (ind.rsi > 70) signal -= 0.4;
        else if (ind.rsi < 45) signal += 0.1;
        else if (ind.rsi > 55) signal -= 0.1;
      }

      // Trend
      if (ind.trend === 'bullish') {
        signal += 0.3 * Math.min(1, ind.trendStrength);
        analysis.bullishCount++;
      } else if (ind.trend === 'bearish') {
        signal -= 0.3 * Math.min(1, ind.trendStrength);
        analysis.bearishCount++;
      } else {
        analysis.neutralCount++;
      }

      // MACD
      if (ind.macd) signal += ind.macd.bullish ? 0.2 : -0.2;

      // Bollinger
      if (ind.bollinger && ind.price) {
        const bbRange = ind.bollinger.upper - ind.bollinger.lower;
        if (bbRange > 0) {
          const bbPos = (ind.price - ind.bollinger.lower) / bbRange;
          if (bbPos < 0.2) signal += 0.1;
          else if (bbPos > 0.8) signal -= 0.1;
        }
      }

      signal = Math.max(-1, Math.min(1, signal));

      if (!primaryTrend && ind.trend && weight >= 0.10) primaryTrend = ind.trend;
      if (ind.trend && primaryTrend) {
        trendTotal++;
        if (ind.trend === primaryTrend) trendMatches++;
      }

      weightedScore += signal * weight;
      totalWeight += weight;

      analysis.timeframeSignals[tf] = {
        signal: signal > 0.15 ? 'bullish' : signal < -0.15 ? 'bearish' : 'neutral',
        strength: Math.abs(signal),
        rsi: ind.rsi ? Math.round(ind.rsi * 10) / 10 : null,
        trend: ind.trend,
        weight,
      };
    }

    // Final scores
    if (totalWeight > 0) analysis.confluenceScore = weightedScore / totalWeight;
    if (rsiCount > 0) {
      analysis.rsiAverage = rsiSum / rsiCount;
      analysis.rsiExtreme = analysis.rsiAverage < 30 || analysis.rsiAverage > 70;
    }
    if (trendTotal > 0) analysis.trendAlignment = trendMatches / trendTotal;

    const score = analysis.confluenceScore;
    if (score > 0.4) analysis.overallBias = 'strong_bullish';
    else if (score > 0.15) analysis.overallBias = 'bullish';
    else if (score < -0.4) analysis.overallBias = 'strong_bearish';
    else if (score < -0.15) analysis.overallBias = 'bearish';

    const agreementRatio = Math.max(analysis.bullishCount, analysis.bearishCount) /
      (analysis.bullishCount + analysis.bearishCount + analysis.neutralCount || 1);
    analysis.confidence = agreementRatio * analysis.trendAlignment;

    analysis.shouldTrade = analysis.confidence > 0.5 && Math.abs(score) > 0.15;
    if (analysis.shouldTrade) {
      analysis.direction = score > 0 ? 'buy' : 'sell';
    }

    return analysis;
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 4: GETTERS + DASHBOARD
  // ═══════════════════════════════════════════════════════════

  /** Get indicator snapshot for a specific timeframe */
  getTimeframeIndicators(tf) {
    return this.indicators.get(tf) || null;
  }

  /** Get candle count per timeframe */
  getCandleCounts() {
    const counts = {};
    for (const [tf, arr] of this.candles) counts[tf] = arr.length;
    return counts;
  }

  /** Get raw candles for a timeframe (e.g., for chart rendering) */
  getCandles(tf) {
    return this.candles.get(tf) || [];
  }

  /** Dashboard snapshot */
  getSnapshot() {
    return {
      readyTimeframes: Array.from(this.readyTimeframes),
      candleCounts: this.getCandleCounts(),
      indicators: Object.fromEntries(this.indicators),
      stats: { ...this.stats },
    };
  }

  /** Cleanup */
  destroy() {
    this.removeAllListeners();
    this.candles.clear();
    this.pendingCandles.clear();
    this.indicators.clear();
    this.readyTimeframes.clear();
  }
}

module.exports = MultiTimeframeAdapter;
