/**
 * ============================================================================
 * OptimizedIndicators.js - High-Performance Technical Analysis Engine
 * ============================================================================
 *
 * PURPOSE: Centralized technical indicator calculations with caching and optimization
 *
 * ARCHITECTURAL ROLE:
 * - Provides RSI, MACD, EMA, and volatility calculations
 * - Implements scalper-optimized caching for high-frequency trading
 * - Handles edge cases and provides safe defaults
 * - Supports both standalone and batch calculations
 *
 * PERFORMANCE FEATURES:
 * - Scalper caching: Avoids redundant calculations in fast markets
 * - Memory-efficient: Bounded cache with FIFO eviction
 * - Error-resilient: Graceful fallbacks for invalid data
 *
 * BUSINESS VALUE:
 * - Accurate technical signals drive profitable trading decisions
 * - Fast calculations enable real-time market analysis
 * - Reliable indicators reduce false signals and improve win rates
 *
 * @author OGZ Prime Development Team
 * @version 1.0.0
 * @since 2025-10-27
 * ============================================================================
 */

// FIX 2026-02-16: Use centralized candle helper for format compatibility
const { c: _c, o: _o, h: _h, l: _l, v: _v } = require('./CandleHelper');

class OptimizedIndicators {
  constructor() {
    this.cache = new Map();
    this.maxCacheSize = 1000; // Prevent memory leaks in long-running bots

    // MACD signal line history for proper EMA calculation
    this.macdHistory = [];
    this.maxMacdHistory = 50; // Keep enough for 9-period EMA

    // Initialize Two-Pole Oscillator
    const TwoPoleOscillator = require('./TwoPoleOscillator');
    this.twoPoleOscillator = new TwoPoleOscillator({
      smaLength: 25,
      filterLength: 20,
      upperThreshold: 0.5,
      lowerThreshold: -0.5
    });

    console.log('📊 OptimizedIndicators initialized with scalper caching');
    console.log('🎯 Two-Pole Oscillator [BigBeluga] integrated');
  }

  /**
   * SCALPER CACHING SYSTEM
   * Prevents redundant calculations in high-frequency trading
   */
  getScalperCacheKey(indicator, data, ...params) {
    // Create deterministic cache key from data and parameters
    const dataHash = data.map(d => _c(d)).join(',').substring(0, 50);
    return `${indicator}_${dataHash}_${params.join('_')}`;
  }

  getScalperCached(indicator, data, calculationFn, ...params) {
    const cacheKey = this.getScalperCacheKey(indicator, data, ...params);

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const result = calculationFn.call(this, data, ...params);

    // FIFO cache eviction
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * MAIN TECHNICAL INDICATORS CALCULATION
   * Comprehensive analysis for trading decisions
   */
  calculateTechnicalIndicators(priceData = null) {
    try {
      // Use passed data or bot's price history
      const data = priceData || this.priceHistory;

      if (!data || data.length < 2) {
        return { rsi: 50, macd: 0, macdSignal: 0, volatility: 0.02, twoPole: null }; // Safe defaults
      }

      // Calculate RSI from real data
      const rsi = this.calculateRSI(data.slice(-14));

      // Calculate MACD with signal line from real data
      const macdData = this.calculateMACD(data.slice(-26));

      // Calculate volatility from real price movements
      const volatility = this.calculateVolatility(data.slice(-20));

      // Update Two-Pole Oscillator with latest price
      let twoPole = null;
      if (data.length > 0) {
        const currentPrice = _c(data[data.length - 1]) || data[data.length - 1];
        twoPole = this.twoPoleOscillator.update(currentPrice);
      }

      return {
        rsi,
        macd: macdData.macd,
        macdSignal: macdData.signal,
        volatility,
        twoPole
      };

    } catch (error) {
      console.error('❌ Technical indicator calculation error:', error);
      return { rsi: 50, macd: 0, volatility: 0.02 }; // Safe defaults
    }
  }

  /**
   * RSI CALCULATION
   * Relative Strength Index for momentum analysis
   */
  calculateRSI(priceData, period = 14) {
    return this.getScalperCached('RSI', priceData, this._calculateRSICore, period);
  }

  _calculateRSICore(priceData, period = 14) {

    // TESTING MODE: Reduce minimum candle requirement to 2
    const minCandles = process.env.TESTING === 'true' ? 2 : period;

    if (priceData.length < minCandles) {
      return 50;
    }

    // Validate data structure
    const firstCandle = priceData[0];
    const lastCandle = priceData[priceData.length - 1];

    let gains = 0;
    let losses = 0;

    const dataLength = Math.min(priceData.length, period);
    // CHANGE 654: Debug RSI calculation issue
    let debugPrices = [];
    for (let i = 1; i < dataLength; i++) {
      const change = _c(priceData[i]) - _c(priceData[i-1]); // Close price changes
      if (i <= 3) debugPrices.push(`${_c(priceData[i-1]).toFixed(2)}→${_c(priceData[i]).toFixed(2)}=${change.toFixed(2)}`);
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }
    if (dataLength > 0 && gains + losses < 0.01 * _c(priceData[0])) {
      console.log(`⚠️ RSI Debug: Prices flat! Changes: [${debugPrices.join(', ')}] Gains=${gains.toFixed(2)} Losses=${losses.toFixed(2)}`);
    }

    const avgGain = gains / Math.max(1, dataLength - 1);
    const avgLoss = losses / Math.max(1, dataLength - 1);

    // CHANGE 654: Fix RSI extremes when price is flat
    // If total movement is less than 0.01% of price, return neutral RSI
    const avgPrice = _c(priceData[dataLength - 1]);
    const totalMovement = gains + losses;
    const movementPercent = (totalMovement / avgPrice) * 100;

    if (movementPercent < 0.01) {
      console.log(`⚠️ RSI: Price too flat (${movementPercent.toFixed(4)}% movement), returning neutral 50`);
      return 50; // Neutral when price is flat
    }

    if (avgLoss === 0) {
      return 100;
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return Math.max(0, Math.min(100, rsi));
  }

  /**
   * MACD CALCULATION
   * Moving Average Convergence Divergence for trend analysis
   */
  calculateMACD(priceData) {
    return this.getScalperCached('MACD', priceData, this._calculateMACDCore);
  }

  _calculateMACDCore(priceData) {

    // TESTING MODE: Reduce minimum candle requirement to 1
    const minCandles = process.env.TESTING === 'true' ? 1 : 26;

    if (priceData.length < minCandles) {
      return { macdLine: 0, signalLine: 0, histogram: 0, macd: 0, signal: 0 };
    }

    // Validate data structure
    const firstCandle = priceData[0];
    const lastCandle = priceData[priceData.length - 1];

    // CRITICAL FIX: Use most recent data, not oldest!
    // priceData stores newest at the end, so use slice(-26) not slice(0,26)
    const ema12 = this.calculateEMA(priceData.slice(-12), 12);
    const ema26 = this.calculateEMA(priceData.slice(-26), 26);

    const macdLine = ema12 - ema26;

    // FIX: Properly calculate signal line as 9-period EMA of MACD
    // Maintain MACD history for accurate signal line calculation
    this.macdHistory.push(macdLine);
    if (this.macdHistory.length > this.maxMacdHistory) {
      this.macdHistory.shift(); // Remove oldest
    }

    // Calculate 9-period EMA of MACD values for signal line
    let signalLine = macdLine; // Default to current MACD if not enough history
    if (this.macdHistory.length >= 9) {
      // Calculate EMA of MACD history
      const macdForSignal = this.macdHistory.slice(-9); // Last 9 MACD values
      signalLine = this.calculateEMA(macdForSignal.map(val => ({ c: val })), 9);
    } else {
    }

    const histogram = macdLine - signalLine;
    return { macdLine, signalLine, histogram, macd: macdLine, signal: signalLine };
  }

  /**
   * EMA CALCULATION
   * Exponential Moving Average for trend smoothing
   */
  calculateEMA(priceData, period) {
    return this.getScalperCached('EMA', priceData, this._calculateEMACore, period);
  }

  _calculateEMACore(priceData, period) {

    if (priceData.length === 0) {
      return 0;
    }

    // Validate data structure
    const lastCandle = priceData[priceData.length - 1];

    if (!_c(lastCandle)) {
      return 0;
    }

    const multiplier = 2 / (period + 1);
    let ema = _c(priceData[priceData.length - 1]); // Start with most recent close

    for (let i = priceData.length - 2; i >= 0; i--) {
      if (!_c(priceData[i])) {
        continue;
      }
      ema = (_c(priceData[i]) * multiplier) + (ema * (1 - multiplier));
    }

    return ema;
  }

  /**
   * VOLATILITY CALCULATION
   * Price volatility for risk assessment
   */
  calculateVolatility(priceData, period = 20) {
    return this.getScalperCached('VOLATILITY', priceData, this._calculateVolatilityCore, period);
  }

  _calculateVolatilityCore(priceData, period = 20) {
    if (priceData.length < 2) return 0.02;

    // Use last 'period' candles or all available
    const data = priceData.slice(-period);

    const returns = [];
    for (let i = 1; i < data.length; i++) {
      // CHANGE 613: Fix inverted volatility formula - was (prev - curr) / curr, should be (curr - prev) / prev
      const return_rate = (_c(data[i]) - _c(data[i-1])) / _c(data[i-1]);
      returns.push(return_rate);
    }

    if (returns.length === 0) return 0.02;

    // Calculate standard deviation
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;

    return Math.sqrt(variance);
  }

  /**
   * BOLLINGER BANDS CALCULATION
   * Volatility bands for price containment analysis
   */
  calculateBollingerBands(candles, period = 20, stdDevMultiplier = 2) {

    if (!candles || candles.length < period) {
      return {
        upper: 0,
        middle: 0,
        lower: 0,
        width: 0
      };
    }

    // Validate data structure
    const firstCandle = candles[0];
    const lastCandle = candles[candles.length - 1];

    // Calculate SMA (middle band)
    const prices = candles.slice(-period).map(c => c.close || c.c);

    // Check for undefined/NaN prices
    const invalidPrices = prices.filter(p => !p || isNaN(p));
    if (invalidPrices.length > 0) {
      return { upper: 0, middle: 0, lower: 0, width: 0 };
    }

    const sma = prices.reduce((sum, price) => sum + price, 0) / period;

    // Calculate standard deviation
    const squaredDiffs = prices.map(price => Math.pow(price - sma, 2));
    const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / period;
    const stdDev = Math.sqrt(variance);

    // Calculate bands
    const upper = sma + (stdDev * stdDevMultiplier);
    const lower = sma - (stdDev * stdDevMultiplier);
    const width = (upper - lower) / sma * 100; // Width as percentage

    return {
      upper,
      middle: sma,
      lower,
      width
    };
  }

  /**
   * TREND DETERMINATION
   * Market trend analysis for directional bias
   */
  determineTrend(priceData, shortPeriod = 20, longPeriod = 50) {
    if (!priceData || priceData.length < longPeriod) {
      return 'sideways';
    }

    const shortEMA = this.calculateEMA(priceData.slice(-shortPeriod), shortPeriod);
    const longEMA = this.calculateEMA(priceData.slice(-longPeriod), longPeriod);
    const currentPrice = _c(priceData[priceData.length - 1]);

    // Simple trend logic based on EMA crossover and price position
    if (shortEMA > longEMA && currentPrice > shortEMA) {
      return 'uptrend';
    } else if (shortEMA < longEMA && currentPrice < shortEMA) {
      return 'downtrend';
    } else {
      return 'sideways';
    }
  }

  /**
   * VOTE-BASED INDICATOR ANALYSIS
   * Returns structured votes for ensemble decision making
   */
  getRSIVotes(rsi) {
    const votes = [];

    if (rsi >= 75) {
      votes.push({ tag: 'RSI>75', vote: -1, strength: 0.25 }); // Oversold - SELL
    } else if (rsi >= 70) {
      votes.push({ tag: 'RSI>70', vote: -1, strength: 0.20 });
    } else if (rsi <= 25) {
      votes.push({ tag: 'RSI<25', vote: 1, strength: 0.25 }); // Oversold - BUY
    } else if (rsi <= 30) {
      votes.push({ tag: 'RSI<30', vote: 1, strength: 0.20 });
    }

    return votes;
  }

  getMACDVotes(macdData) {
    const votes = [];

    if (macdData.macd > 0 && macdData.signal > 0 && (macdData.macd - macdData.signal) > 0) {
      votes.push({ tag: 'MACD:strongBullish', vote: 1, strength: 0.20 });
    } else if (macdData.macd < 0 && macdData.signal < 0 && (macdData.macd - macdData.signal) < 0) {
      votes.push({ tag: 'MACD:strongBearish', vote: -1, strength: 0.20 });
    }

    return votes;
  }

  getAllVotes(marketData) {
    const votes = [];

    // RSI votes
    if (marketData.rsi) {
      votes.push(...this.getRSIVotes(marketData.rsi));
    }

    // MACD votes
    if (marketData.macd && marketData.macdSignal) {
      votes.push(...this.getMACDVotes({
        macd: marketData.macd,
        signal: marketData.macdSignal,
        histogram: marketData.macdHistogram || 0
      }));
    }

    return votes;
  }

  /**
   * Calculate Average True Range (ATR) for dynamic stop loss
   * ATR measures market volatility using the true range over a period
   *
   * @param {Array} priceData - Array of OHLC data: [{o, h, l, c, t}, ...]
   * @param {number} period - ATR period (default: 14)
   * @returns {number} - ATR value as decimal (e.g., 0.02 = 2% volatility)
   */
  calculateATR(priceData, period = 14) {
    console.log(`🔍 [ATR] Entry: priceData.length=${priceData?.length || 0}, period=${period}`);

    // Need at least period + 1 candles for ATR calculation
    if (!priceData || priceData.length < period + 1) {
      console.log(`⚠️ [ATR] Insufficient data (need ${period + 1}, have ${priceData?.length || 0})`);
      return 0.02; // Default 2% volatility assumption
    }

    // Calculate True Range for each candle
    const trueRanges = [];

    for (let i = 1; i < priceData.length; i++) {
      const candle = priceData[i];
      const prevCandle = priceData[i - 1];

      // Validate data structure
      if (!_h(candle) || !_l(candle) || !_c(candle) || !_c(prevCandle)) {
        console.log(`⚠️ [ATR] Invalid candle structure at index ${i}`);
        continue;
      }

      // True Range = MAX of:
      // 1. High - Low (current candle range)
      // 2. |High - Previous Close| (gap up)
      // 3. |Low - Previous Close| (gap down)
      const tr = Math.max(
        _h(candle) - _l(candle),
        Math.abs(_h(candle) - _c(prevCandle)),
        Math.abs(_l(candle) - _c(prevCandle))
      );

      trueRanges.push(tr);
    }

    if (trueRanges.length < period) {
      console.log(`⚠️ [ATR] Not enough true ranges calculated: ${trueRanges.length}`);
      return 0.02;
    }

    // Calculate initial ATR as SMA of first 'period' true ranges
    const recentTR = trueRanges.slice(-period);
    const atrAbsolute = recentTR.reduce((sum, tr) => sum + tr, 0) / period;

    // Convert to percentage of current price
    const currentPrice = _c(priceData[priceData.length - 1]);
    const atrPercent = atrAbsolute / currentPrice;

    console.log(`✅ [ATR] Calculated: ${(atrPercent * 100).toFixed(2)}% (abs: $${atrAbsolute.toFixed(2)}, price: $${currentPrice.toFixed(2)})`);

    return atrPercent;
  }

  /**
   * CACHE MANAGEMENT
   * Monitor and maintain cache health
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      utilization: ((this.cache.size / this.maxCacheSize) * 100).toFixed(1) + '%'
    };
  }

  clearCache() {
    const cleared = this.cache.size;
    this.cache.clear();
    console.log(`🧹 OptimizedIndicators cache cleared: ${cleared} entries removed`);
    return cleared;
  }
}

// Export singleton instance for consistent caching across the application
module.exports = new OptimizedIndicators();
