/**
 * IndicatorCalculator - Phase 1 of Modular Architecture Refactor
 *
 * PURPOSE: Calculates indicators from candles. Pure math, no side effects.
 * Takes candles in, returns numbers out.
 *
 * Self-contained: Yes - pure math functions.
 * Hot-swap: Yes - can swap calculation library.
 * Stateless: Yes - no internal state, all static methods.
 *
 * @see ogz-meta/REFACTOR-PLAN-2026-02-27.md
 */

const { c: _c, o: _o, h: _h, l: _l, v: _v } = require('./CandleHelper');

class IndicatorCalculator {
  // ═══════════════════════════════════════════════════════════════════════════
  // MOVING AVERAGES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate Simple Moving Average
   * @param {Array} candles - Array of OHLCV candles
   * @param {number} period - SMA period
   * @returns {number} SMA value
   */
  static calculateSMA(candles, period) {
    if (!candles || candles.length < period) {
      return null;
    }

    const slice = candles.slice(-period);
    const sum = slice.reduce((acc, c) => acc + _c(c), 0);
    return sum / period;
  }

  /**
   * Calculate Exponential Moving Average
   * @param {Array} candles - Array of OHLCV candles
   * @param {number} period - EMA period
   * @returns {number} EMA value
   */
  static calculateEMA(candles, period) {
    if (!candles || candles.length === 0) {
      return null;
    }

    const multiplier = 2 / (period + 1);

    // Seed with SMA if we have enough data
    let ema;
    if (candles.length >= period) {
      const seedSlice = candles.slice(0, period);
      ema = seedSlice.reduce((acc, c) => acc + _c(c), 0) / period;

      // Apply EMA formula from period onwards
      for (let i = period; i < candles.length; i++) {
        const price = _c(candles[i]);
        ema = (price - ema) * multiplier + ema;
      }
    } else {
      // Not enough data, use simple average
      ema = candles.reduce((acc, c) => acc + _c(c), 0) / candles.length;
    }

    return ema;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RSI
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate Relative Strength Index
   * @param {Array} candles - Array of OHLCV candles
   * @param {number} period - RSI period (default: 14)
   * @returns {number} RSI value (0-100)
   */
  static calculateRSI(candles, period = 14) {
    if (!candles || candles.length < period + 1) {
      return 50; // Neutral default
    }

    const slice = candles.slice(-(period + 1));
    let gains = 0;
    let losses = 0;

    for (let i = 1; i < slice.length; i++) {
      const change = _c(slice[i]) - _c(slice[i - 1]);
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) {
      return 100; // All gains, max RSI
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return Math.max(0, Math.min(100, rsi));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MACD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   * @param {Array} candles - Array of OHLCV candles
   * @param {number} fast - Fast EMA period (default: 12)
   * @param {number} slow - Slow EMA period (default: 26)
   * @param {number} signal - Signal EMA period (default: 9)
   * @returns {Object} { macd, signal, histogram }
   */
  static calculateMACD(candles, fast = 12, slow = 26, signal = 9) {
    if (!candles || candles.length < slow) {
      return { macd: 0, signal: 0, histogram: 0 };
    }

    const emaFast = this.calculateEMA(candles, fast);
    const emaSlow = this.calculateEMA(candles, slow);
    const macdLine = emaFast - emaSlow;

    // For signal line, we need MACD history
    // Since this is stateless, we compute MACD series and then EMA of that
    const macdSeries = [];
    for (let i = slow - 1; i < candles.length; i++) {
      const slice = candles.slice(0, i + 1);
      const ef = this.calculateEMA(slice, fast);
      const es = this.calculateEMA(slice, slow);
      macdSeries.push(ef - es);
    }

    // Calculate signal line as EMA of MACD series
    let signalLine = macdLine;
    if (macdSeries.length >= signal) {
      const multiplier = 2 / (signal + 1);
      let sigEma = macdSeries.slice(0, signal).reduce((a, b) => a + b, 0) / signal;
      for (let i = signal; i < macdSeries.length; i++) {
        sigEma = (macdSeries[i] - sigEma) * multiplier + sigEma;
      }
      signalLine = sigEma;
    }

    return {
      macd: macdLine,
      signal: signalLine,
      histogram: macdLine - signalLine
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOLLINGER BANDS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate Bollinger Bands
   * @param {Array} candles - Array of OHLCV candles
   * @param {number} period - BB period (default: 20)
   * @param {number} stdDev - Standard deviation multiplier (default: 2)
   * @returns {Object} { upper, middle, lower, bandwidth, percentB }
   */
  static calculateBB(candles, period = 20, stdDev = 2) {
    if (!candles || candles.length < period) {
      return { upper: 0, middle: 0, lower: 0, bandwidth: 0, percentB: 0.5 };
    }

    const slice = candles.slice(-period);
    const closes = slice.map(c => _c(c));

    // Calculate SMA (middle band)
    const middle = closes.reduce((a, b) => a + b, 0) / period;

    // Calculate standard deviation
    const variance = closes.reduce((acc, c) => acc + Math.pow(c - middle, 2), 0) / period;
    const sd = Math.sqrt(variance);

    const upper = middle + (stdDev * sd);
    const lower = middle - (stdDev * sd);

    // Calculate derived values
    const currentPrice = _c(candles[candles.length - 1]);
    const bandwidth = middle > 0 ? ((upper - lower) / middle) * 100 : 0;
    const percentB = (upper - lower) > 0 ? (currentPrice - lower) / (upper - lower) : 0.5;

    return {
      upper,
      middle,
      lower,
      bandwidth,
      percentB: Math.max(0, Math.min(1, percentB))
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ATR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate Average True Range
   * @param {Array} candles - Array of OHLCV candles
   * @param {number} period - ATR period (default: 14)
   * @returns {number} ATR value in price units
   */
  static calculateATR(candles, period = 14) {
    if (!candles || candles.length < period + 1) {
      return 0;
    }

    // Calculate True Range for each candle
    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
      const high = _h(candles[i]);
      const low = _l(candles[i]);
      const prevClose = _c(candles[i - 1]);

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }

    if (trueRanges.length < period) {
      return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
    }

    // Calculate ATR as SMA of true ranges
    const recentTR = trueRanges.slice(-period);
    return recentTR.reduce((a, b) => a + b, 0) / period;
  }

  /**
   * Calculate ATR as percentage of price
   * @param {Array} candles - Array of OHLCV candles
   * @param {number} period - ATR period (default: 14)
   * @returns {number} ATR as percentage (0-100)
   */
  static calculateATRPercent(candles, period = 14) {
    const atr = this.calculateATR(candles, period);
    const currentPrice = candles && candles.length > 0 ? _c(candles[candles.length - 1]) : 0;
    return currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VWAP
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate Volume Weighted Average Price
   * @param {Array} candles - Array of OHLCV candles
   * @returns {number} VWAP value
   */
  static calculateVWAP(candles) {
    if (!candles || candles.length === 0) {
      return 0;
    }

    let cumPV = 0;
    let cumV = 0;

    for (const candle of candles) {
      const typical = (_h(candle) + _l(candle) + _c(candle)) / 3;
      const volume = _v(candle);
      cumPV += typical * volume;
      cumV += volume;
    }

    return cumV > 0 ? cumPV / cumV : _c(candles[candles.length - 1]);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TREND DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Determine market trend based on EMA alignment
   * @param {Array} candles - Array of OHLCV candles
   * @param {number} shortPeriod - Short EMA period
   * @param {number} longPeriod - Long EMA period
   * @returns {string} 'uptrend' | 'downtrend' | 'neutral'
   */
  static determineTrend(candles, shortPeriod = 20, longPeriod = 50) {
    if (!candles || candles.length < longPeriod) {
      return 'neutral';
    }

    const shortEMA = this.calculateEMA(candles, shortPeriod);
    const longEMA = this.calculateEMA(candles, longPeriod);
    const currentPrice = _c(candles[candles.length - 1]);

    if (shortEMA > longEMA && currentPrice > shortEMA) {
      return 'uptrend';
    } else if (shortEMA < longEMA && currentPrice < shortEMA) {
      return 'downtrend';
    } else {
      return 'neutral';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VOLATILITY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate price volatility (standard deviation of returns)
   * @param {Array} candles - Array of OHLCV candles
   * @param {number} period - Volatility period
   * @returns {number} Volatility as decimal (0.02 = 2%)
   */
  static calculateVolatility(candles, period = 20) {
    if (!candles || candles.length < 2) {
      return 0.02; // Default 2%
    }

    const slice = candles.slice(-period);
    const returns = [];

    for (let i = 1; i < slice.length; i++) {
      const prevClose = _c(slice[i - 1]);
      const currClose = _c(slice[i]);
      if (prevClose > 0) {
        returns.push((currClose - prevClose) / prevClose);
      }
    }

    if (returns.length === 0) {
      return 0.02;
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) / returns.length;

    return Math.sqrt(variance);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVENIENCE: CALCULATE ALL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate all major indicators at once
   * @param {Array} candles - Array of OHLCV candles
   * @returns {Object} All indicator values
   */
  static calculateAll(candles) {
    const macd = this.calculateMACD(candles);
    const bb = this.calculateBB(candles);
    const atr = this.calculateATR(candles);
    const currentPrice = candles && candles.length > 0 ? _c(candles[candles.length - 1]) : 0;

    return {
      // Price context
      price: currentPrice,

      // Momentum
      rsi: this.calculateRSI(candles),

      // Trend
      macd,
      ema9: this.calculateEMA(candles, 9),
      ema21: this.calculateEMA(candles, 21),
      ema50: this.calculateEMA(candles, 50),
      ema200: this.calculateEMA(candles, 200),
      sma20: this.calculateSMA(candles, 20),
      sma50: this.calculateSMA(candles, 50),

      // Volatility
      atr,
      atrPercent: currentPrice > 0 ? (atr / currentPrice) * 100 : 0,
      bb,
      volatility: this.calculateVolatility(candles),

      // Volume
      vwap: this.calculateVWAP(candles),

      // Derived
      trend: this.determineTrend(candles)
    };
  }
}

module.exports = { IndicatorCalculator };
