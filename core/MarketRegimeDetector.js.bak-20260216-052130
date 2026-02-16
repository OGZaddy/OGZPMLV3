/**
 * @fileoverview MarketRegimeDetector - Multi-Dimensional Market State Analysis
 *
 * Detects the current market regime (trending, ranging, volatile, etc.) using
 * technical indicators, correlation analysis, and macro signals.
 *
 * @description
 * ARCHITECTURE ROLE:
 * Regime detection informs trading strategy selection. Different regimes
 * require different approaches (trend-following vs mean-reversion).
 *
 * REGIMES DETECTED:
 * - TRENDING_UP/DOWN: Strong directional movement
 * - RANGING: Sideways consolidation (mean-reversion opportunities)
 * - VOLATILE: High volatility (reduce position sizes)
 * - QUIET: Low volatility (accumulation phase)
 * - BREAKOUT/BREAKDOWN: Regime transition in progress
 * - RISK_ON/RISK_OFF: Macro correlation-based regimes
 * - PANIC/CRASH: Emergency risk-off conditions
 *
 * USAGE:
 * TradingBrain and run-empire-v2.js consult the current regime to adjust
 * confidence thresholds, position sizing, and strategy selection.
 *
 * @module core/MarketRegimeDetector
 * @extends EventEmitter
 */

const EventEmitter = require('events');

class MarketRegimeDetector extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Technical regime detection parameters
      lookbackPeriod: 100,          // Candles to analyze
      updateFrequency: 10,          // Update regime every N candles
      
      // Volatility thresholds
      lowVolThreshold: 0.5,         // Below = quiet market
      highVolThreshold: 2.0,        // Above = volatile market
      
      // Trend strength thresholds
      strongTrendThreshold: 0.7,    // ADX > 70 = strong trend
      weakTrendThreshold: 0.3,      // ADX < 30 = ranging
      
      // Volume analysis
      volumeMALength: 20,           // Volume moving average
      highVolumeMultiple: 1.5,      // 1.5x average = high volume
      
      // Correlation-based regime detection
      correlationAssets: config.correlationAssets || [
        'ETH', 'BNB', 'SOL', 'MATIC', 'AVAX',
        'DXY', 'SPX', 'GOLD', 'VIX'
      ],
      riskOnThreshold: 0.6,         // Crypto correlation for risk-on
      flightToQualityThreshold: -0.5, // DXY inverse correlation
      
      // Macro regime indicators
      crashRSIThreshold: 20,        // RSI below 20 = crash conditions
      panicVolumeMultiple: 3.0,     // 3x volume = panic
      
      // Advanced features
      enableCorrelationAnalysis: config.enableCorrelationAnalysis !== false,
      enableMacroAnalysis: config.enableMacroAnalysis !== false,
      enableAdaptiveParameters: config.enableAdaptiveParameters !== false,
      
      ...config
    };
    
    // ENHANCED REGIME STATES - Best of all systems combined!
    this.regimes = {
      // Technical regimes
      TRENDING_UP: 'trending_up',
      TRENDING_DOWN: 'trending_down',
      RANGING: 'ranging',
      VOLATILE: 'volatile',
      QUIET: 'quiet',
      BREAKOUT: 'breakout',
      BREAKDOWN: 'breakdown',
      
      // Macro regimes (from CorrelationAnalyzer)
      RISK_ON: 'risk_on',
      RISK_OFF: 'risk_off',
      DECORRELATED: 'decorrelated',
      
      // Crisis regimes (from MultiDirectionalTrader)
      CRASH: 'crash',
      RECOVERY: 'recovery',
      EUPHORIA: 'euphoria'
    };
    
    // Enhanced state tracking
    this.currentRegime = this.regimes.RANGING;
    this.previousRegime = this.regimes.RANGING;
    this.regimeStrength = 0;
    this.lastUpdate = 0;
    this.updateCount = 0;
    
    // Multi-dimensional metrics
    this.metrics = {
      // Technical metrics
      volatility: 0,
      trendStrength: 0,
      trendDirection: 0,
      volumeRatio: 1,
      pricePosition: 0.5, // 0 = bottom of range, 1 = top
      momentum: 0,
      
      // Correlation metrics
      correlationStrength: 0,
      riskOnIndicator: 0,
      flightToQuality: 0,
      cryptoCorrelation: 0,
      macroCorrelation: 0,
      
      // Macro metrics
      marketStress: 0,
      liquidityConditions: 1,
      sentimentScore: 0.5,
      fearGreedIndex: 50
    };
    
    // Correlation data storage (from CorrelationAnalyzer integration)
    this.correlationData = new Map();
    this.priceData = new Map();
    this.returns = new Map();
    
    // Regime history for pattern recognition
    this.regimeHistory = [];
    this.regimeTransitions = new Map();
    
    // Enhanced regime-specific parameters
    this.regimeParameters = this.initializeRegimeParameters();
    
    console.log('🔮 ULTIMATE Market Regime Detector initialized');
    console.log(`📊 Tracking ${this.config.correlationAssets.length} correlation assets`);
    console.log(`🧠 Correlation Analysis: ${this.config.enableCorrelationAnalysis ? 'ENABLED' : 'DISABLED'}`);
    console.log(`🌍 Macro Analysis: ${this.config.enableMacroAnalysis ? 'ENABLED' : 'DISABLED'}`);
  }
  
  initializeRegimeParameters() {
    return {
      [this.regimes.TRENDING_UP]: {
        riskMultiplier: 1.2,        // Take bigger positions in trends
        confidenceThreshold: 0.5,    // Lower threshold for trend trades
        stopLossMultiplier: 1.5,     // Wider stops in trends
        takeProfitMultiplier: 2.0,   // Let winners run
        indicatorWeights: {
          trend: 0.4,
          momentum: 0.3,
          volume: 0.2,
          volatility: 0.1
        }
      },
      [this.regimes.TRENDING_DOWN]: {
        riskMultiplier: 0.8,        // Reduce risk in downtrends
        confidenceThreshold: 0.7,    // Higher threshold for shorts
        stopLossMultiplier: 1.2,     
        takeProfitMultiplier: 1.5,   
        indicatorWeights: {
          trend: 0.4,
          momentum: 0.3,
          volume: 0.2,
          volatility: 0.1
        }
      },
      [this.regimes.RANGING]: {
        riskMultiplier: 1.0,        
        confidenceThreshold: 0.6,    
        stopLossMultiplier: 0.8,     // Tighter stops in ranges
        takeProfitMultiplier: 1.0,   // Quick profits
        indicatorWeights: {
          trend: 0.1,
          momentum: 0.2,
          volume: 0.2,
          volatility: 0.5        // Volatility matters more
        }
      },
      [this.regimes.VOLATILE]: {
        riskMultiplier: 0.5,        // Half risk in volatile markets
        confidenceThreshold: 0.8,    // Very selective
        stopLossMultiplier: 2.0,     // Wide stops needed
        takeProfitMultiplier: 1.5,   
        indicatorWeights: {
          trend: 0.2,
          momentum: 0.2,
          volume: 0.3,
          volatility: 0.3
        }
      },
      [this.regimes.QUIET]: {
        riskMultiplier: 0.7,        // Reduced risk in quiet markets
        confidenceThreshold: 0.7,    
        stopLossMultiplier: 0.5,     // Very tight stops
        takeProfitMultiplier: 0.8,   // Small targets
        indicatorWeights: {
          trend: 0.3,
          momentum: 0.4,      // Momentum breakouts matter
          volume: 0.2,
          volatility: 0.1
        }
      },
      [this.regimes.BREAKOUT]: {
        riskMultiplier: 1.5,        // Aggressive on breakouts
        confidenceThreshold: 0.6,    
        stopLossMultiplier: 1.0,     
        takeProfitMultiplier: 3.0,   // Big targets on breakouts
        indicatorWeights: {
          trend: 0.2,
          momentum: 0.4,
          volume: 0.3,        // Volume confirms breakouts
          volatility: 0.1
        }
      },
      [this.regimes.BREAKDOWN]: {
        riskMultiplier: 0.6,        // Careful on breakdowns
        confidenceThreshold: 0.8,    
        stopLossMultiplier: 1.0,     
        takeProfitMultiplier: 2.0,   
        indicatorWeights: {
          trend: 0.3,
          momentum: 0.3,
          volume: 0.3,
          volatility: 0.1
        }
      }
    };
  }
  
  /**
   * Analyze market and detect regime
   * @param {Array} candles - Recent price candles
   * @param {Object} indicators - Current indicator values
   * @returns {Object} Regime analysis
   */
  analyzeMarket(candles, indicators = {}) {
    if (!candles || candles.length < this.config.lookbackPeriod) {
      return {
        regime: this.currentRegime,
        confidence: 0,
        parameters: this.regimeParameters[this.currentRegime]
      };
    }
    
    // Update counter
    this.updateCount++;
    
    // Only update regime at specified frequency
    if (this.updateCount % this.config.updateFrequency !== 0) {
      return {
        regime: this.currentRegime,
        confidence: this.regimeStrength,
        parameters: this.regimeParameters[this.currentRegime]
      };
    }
    
    // Calculate all metrics
    this.calculateVolatility(candles);
    this.calculateTrend(candles, indicators);
    this.calculateVolume(candles);
    this.calculateMomentum(candles);
    this.calculatePricePosition(candles);
    
    // Detect regime based on metrics
    const detectedRegime = this.detectRegime();
    
    // Calculate regime change confidence
    const regimeConfidence = this.calculateRegimeConfidence(detectedRegime);
    
    // Update regime if confidence is high enough
    if (regimeConfidence > 0.7 || detectedRegime === this.currentRegime) {
      this.previousRegime = this.currentRegime;
      this.currentRegime = detectedRegime;
      this.regimeStrength = regimeConfidence;
      this.lastUpdate = Date.now();
    }
    
    // Get parameters for current regime
    const parameters = this.getAdjustedParameters();
    
    // Log regime change
    if (this.previousRegime !== this.currentRegime) {
      console.log(`📊 Market Regime Changed: ${this.previousRegime} → ${this.currentRegime} (Confidence: ${(regimeConfidence * 100).toFixed(1)}%)`);
    }
    
    return {
      regime: this.currentRegime,
      previousRegime: this.previousRegime,
      confidence: this.regimeStrength,
      parameters,
      metrics: { ...this.metrics },
      recommendation: this.getTradeRecommendation()
    };
  }
  
  calculateVolatility(candles) {
    // Calculate ATR-based volatility
    const atr = this.calculateATR(candles, 14);
    const avgPrice = candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
    
    // Normalize volatility as percentage
    this.metrics.volatility = (atr / avgPrice) * 100;
  }
  
  calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return 0;
    
    let atr = 0;
    
    // Initial ATR
    for (let i = 1; i <= period; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      
      atr += tr;
    }
    
    atr /= period;
    
    // Smooth ATR for remaining candles
    for (let i = period + 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      
      atr = ((atr * (period - 1)) + tr) / period;
    }
    
    return atr;
  }
  
  calculateTrend(candles, indicators) {
    // Multiple trend detection methods
    
    // 1. Moving average trend
    const ma20 = this.calculateSMA(candles.map(c => c.close), 20);
    const ma50 = this.calculateSMA(candles.map(c => c.close), 50);
    const currentPrice = candles[candles.length - 1].close;
    
    let maTrend = 0;
    if (currentPrice > ma20 && ma20 > ma50) maTrend = 1;
    else if (currentPrice < ma20 && ma20 < ma50) maTrend = -1;
    
    // 2. Higher highs/lower lows
    const swingTrend = this.calculateSwingTrend(candles);
    
    // 3. ADX trend strength (if provided)
    const adx = indicators.adx || this.calculateADX(candles);
    
    // Combine trend signals
    this.metrics.trendDirection = (maTrend + swingTrend) / 2;
    this.metrics.trendStrength = Math.min(adx / 100, 1);
  }
  
  calculateSwingTrend(candles, lookback = 10) {
    if (candles.length < lookback * 2) return 0;
    
    // Find recent swing highs and lows
    const recentCandles = candles.slice(-lookback * 2);
    let highs = [];
    let lows = [];
    
    for (let i = 2; i < recentCandles.length - 2; i++) {
      const candle = recentCandles[i];
      
      // Swing high
      if (candle.high > recentCandles[i - 1].high && 
          candle.high > recentCandles[i - 2].high &&
          candle.high > recentCandles[i + 1].high && 
          candle.high > recentCandles[i + 2].high) {
        highs.push({ index: i, price: candle.high });
      }
      
      // Swing low
      if (candle.low < recentCandles[i - 1].low && 
          candle.low < recentCandles[i - 2].low &&
          candle.low < recentCandles[i + 1].low && 
          candle.low < recentCandles[i + 2].low) {
        lows.push({ index: i, price: candle.low });
      }
    }
    
    // Analyze swing pattern
    if (highs.length >= 2 && lows.length >= 2) {
      const lastTwoHighs = highs.slice(-2);
      const lastTwoLows = lows.slice(-2);
      
      const higherHighs = lastTwoHighs[1].price > lastTwoHighs[0].price;
      const higherLows = lastTwoLows[1].price > lastTwoLows[0].price;
      const lowerHighs = lastTwoHighs[1].price < lastTwoHighs[0].price;
      const lowerLows = lastTwoLows[1].price < lastTwoLows[0].price;
      
      if (higherHighs && higherLows) return 1;    // Uptrend
      if (lowerHighs && lowerLows) return -1;     // Downtrend
    }
    
    return 0; // No clear trend
  }
  
  calculateVolume(candles) {
    if (!candles[0].volume) {
      this.metrics.volumeRatio = 1;
      return;
    }
    
    const volumes = candles.map(c => c.volume);
    const avgVolume = this.calculateSMA(volumes, this.config.volumeMALength);
    const currentVolume = volumes[volumes.length - 1];
    
    this.metrics.volumeRatio = currentVolume / avgVolume;
  }
  
  calculateMomentum(candles) {
    // Rate of change momentum
    const lookback = 10;
    if (candles.length < lookback + 1) {
      this.metrics.momentum = 0;
      return;
    }
    
    const currentPrice = candles[candles.length - 1].close;
    const pastPrice = candles[candles.length - lookback - 1].close;
    
    this.metrics.momentum = (currentPrice - pastPrice) / pastPrice;
  }
  
  calculatePricePosition(candles) {
    // Where is price within recent range?
    const period = Math.min(50, candles.length);
    const recentCandles = candles.slice(-period);
    
    const highest = Math.max(...recentCandles.map(c => c.high));
    const lowest = Math.min(...recentCandles.map(c => c.low));
    const current = candles[candles.length - 1].close;
    
    if (highest === lowest) {
      this.metrics.pricePosition = 0.5;
    } else {
      this.metrics.pricePosition = (current - lowest) / (highest - lowest);
    }
  }
  
  detectRegime() {
    const { volatility, trendStrength, trendDirection, volumeRatio, pricePosition, momentum } = this.metrics;
    
    // Breakout detection
    if (pricePosition > 0.9 && volumeRatio > this.config.highVolumeMultiple && momentum > 0.02) {
      return this.regimes.BREAKOUT;
    }
    
    // Breakdown detection
    if (pricePosition < 0.1 && volumeRatio > this.config.highVolumeMultiple && momentum < -0.02) {
      return this.regimes.BREAKDOWN;
    }
    
    // Volatile market
    if (volatility > this.config.highVolThreshold) {
      return this.regimes.VOLATILE;
    }
    
    // Quiet market
    if (volatility < this.config.lowVolThreshold) {
      return this.regimes.QUIET;
    }
    
    // Trending markets
    if (trendStrength > this.config.strongTrendThreshold) {
      return trendDirection > 0 ? this.regimes.TRENDING_UP : this.regimes.TRENDING_DOWN;
    }
    
    // Default to ranging
    return this.regimes.RANGING;
  }
  
  calculateRegimeConfidence(regime) {
    // Calculate how confident we are in the regime detection
    let confidence = 0;
    
    switch (regime) {
      case this.regimes.TRENDING_UP:
        confidence = this.metrics.trendStrength * Math.max(0, this.metrics.trendDirection);
        break;
        
      case this.regimes.TRENDING_DOWN:
        confidence = this.metrics.trendStrength * Math.abs(Math.min(0, this.metrics.trendDirection));
        break;
        
      case this.regimes.RANGING:
        confidence = 1 - this.metrics.trendStrength;
        break;
        
      case this.regimes.VOLATILE:
        confidence = Math.min(1, this.metrics.volatility / this.config.highVolThreshold);
        break;
        
      case this.regimes.QUIET:
        confidence = Math.min(1, this.config.lowVolThreshold / Math.max(0.1, this.metrics.volatility));
        break;
        
      case this.regimes.BREAKOUT:
      case this.regimes.BREAKDOWN:
        confidence = Math.min(1, this.metrics.volumeRatio / this.config.highVolumeMultiple) * 
                    Math.abs(this.metrics.momentum) * 10;
        break;
    }
    
    return Math.max(0, Math.min(1, confidence));
  }
  
  getAdjustedParameters() {
    const baseParams = this.regimeParameters[this.currentRegime];
    
    // Further adjust based on regime strength
    const strengthMultiplier = 0.5 + (this.regimeStrength * 0.5); // 0.5 to 1.0
    
    return {
      ...baseParams,
      riskMultiplier: baseParams.riskMultiplier * strengthMultiplier,
      confidenceThreshold: baseParams.confidenceThreshold / strengthMultiplier
    };
  }
  
  getTradeRecommendation() {
    // Provide specific recommendations based on regime
    const recommendations = {
      [this.regimes.TRENDING_UP]: {
        bias: 'long',
        entry: 'Buy on pullbacks to support or moving averages',
        exit: 'Trail stops loosely, target 2-3x risk',
        avoid: 'Avoid shorting against the trend'
      },
      [this.regimes.TRENDING_DOWN]: {
        bias: 'short',
        entry: 'Short on rallies to resistance',
        exit: 'Take profits quickly, market can reverse',
        avoid: 'Avoid buying falling knives'
      },
      [this.regimes.RANGING]: {
        bias: 'neutral',
        entry: 'Buy support, sell resistance',
        exit: 'Take profits at opposite boundary',
        avoid: 'Avoid breakout trades without confirmation'
      },
      [this.regimes.VOLATILE]: {
        bias: 'neutral',
        entry: 'Wait for volatility to subside',
        exit: 'Use wider stops if trading',
        avoid: 'Avoid trading unless very confident'
      },
      [this.regimes.QUIET]: {
        bias: 'neutral',
        entry: 'Look for momentum breakouts',
        exit: 'Use tight stops',
        avoid: 'Avoid overtrading in dead market'
      },
      [this.regimes.BREAKOUT]: {
        bias: 'long',
        entry: 'Buy immediately or on first pullback',
        exit: 'Trail stops, target big moves',
        avoid: 'Avoid fading the breakout'
      },
      [this.regimes.BREAKDOWN]: {
        bias: 'short',
        entry: 'Short on failed rallies',
        exit: 'Cover into panic selling',
        avoid: 'Avoid buying too early'
      }
    };
    
    return recommendations[this.currentRegime] || recommendations[this.regimes.RANGING];
  }
  
  // Utility functions
  calculateSMA(values, period) {
    if (values.length < period) return values[values.length - 1] || 0;
    
    const relevantValues = values.slice(-period);
    return relevantValues.reduce((sum, val) => sum + val, 0) / period;
  }
  
  calculateADX(candles, period = 14) {
    // Simplified ADX calculation
    if (candles.length < period * 2) return 0;
    
    // This is a placeholder - implement full ADX if needed
    // For now, return a value based on trend consistency
    const trendValues = [];
    for (let i = period; i < candles.length; i++) {
      const prevAvg = this.calculateSMA(candles.slice(i - period, i).map(c => c.close), period);
      const currAvg = this.calculateSMA(candles.slice(i - period + 1, i + 1).map(c => c.close), period);
      trendValues.push(currAvg > prevAvg ? 1 : -1);
    }
    
    // Count consecutive same direction
    let streaks = 0;
    let currentStreak = 1;
    for (let i = 1; i < trendValues.length; i++) {
      if (trendValues[i] === trendValues[i - 1]) {
        currentStreak++;
      } else {
        streaks = Math.max(streaks, currentStreak);
        currentStreak = 1;
      }
    }
    streaks = Math.max(streaks, currentStreak);
    
    // Convert to 0-100 scale
    return Math.min(100, (streaks / period) * 100);
  }
  
  /**
   * Restart the regime detector
   */
  async restart() {
    try {
      console.log('🔄 Restarting Market Regime Detector...');
      
      // Reset state
      this.currentRegime = this.regimes.RANGING;
      this.previousRegime = this.regimes.RANGING;
      this.regimeStrength = 0;
      this.lastUpdate = 0;
      this.updateCount = 0;
      
      // Reset metrics
      this.metrics = {
        volatility: 0,
        trendStrength: 0,
        trendDirection: 0,
        volumeRatio: 1,
        pricePosition: 0.5,
        momentum: 0,
        correlationStrength: 0,
        riskOnIndicator: 0,
        flightToQuality: 0,
        cryptoCorrelation: 0,
        macroCorrelation: 0,
        marketStress: 0,
        liquidityConditions: 1,
        sentimentScore: 0.5,
        fearGreedIndex: 50
      };
      
      // Clear history
      this.regimeHistory = [];
      this.regimeTransitions.clear();
      this.correlationData.clear();
      this.priceData.clear();
      this.returns.clear();
      
      console.log('✅ Market Regime Detector restarted successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Failed to restart regime detector:', error);
      throw error;
    }
  }

  /**
   * Get candles for pattern analysis
   * @returns {Array} Array of candle data
   */
  getCandles() {
    // Return the stored price history as candles
    if (!this.priceHistory || this.priceHistory.length === 0) {
      return [];
    }
    
    // Convert price history to proper candle format
    return Array.from(this.priceHistory.values()).flat();
  }

  /**
   * Get current state for external use
   */
  getState() {
    return {
      regime: this.currentRegime,
      strength: this.regimeStrength,
      metrics: { ...this.metrics },
      parameters: this.regimeParameters[this.currentRegime],
      lastUpdate: this.lastUpdate
    };
  }

  /**
   * Get regime-specific parameters for a given regime
   * CHANGE 2026-01-31: Exposed for OptimizedTradingBrain to use stopLossMultiplier
   * @param {string} regime - The regime to get parameters for
   * @returns {Object|null} Regime parameters including stopLossMultiplier, takeProfitMultiplier, etc.
   */
  getRegimeParameters(regime) {
    if (!regime) return this.regimeParameters[this.currentRegime];
    return this.regimeParameters[regime] || this.regimeParameters[this.currentRegime];
  }

  /**
   * Generate vote from current regime
   * Returns vote structure: {tag, vote, strength}
   * @param {Object} regimeData - Current regime data (optional, uses internal state if not provided)
   * @returns {Array} Array of vote objects
   */
  getRegimeVotes(regimeData) {
    const votes = [];

    // Use provided regime data or internal state
    const regime = regimeData?.regime || this.currentRegime;
    const strength = regimeData?.strength || this.regimeStrength || 0.5;

    if (!regime) return votes;

    // CHANGE 614: Fix case-sensitivity - normalize regime to lowercase
    const normalizedRegime = String(regime).toLowerCase();

    // Map regimes to votes
    switch (normalizedRegime) {
      case this.regimes.RANGING:
      case 'ranging':
      case 'sideways':
        votes.push({ tag: 'Regime:ranging', vote: 0, strength: 0.075 });
        break;

      case this.regimes.TRENDING_UP:
      case 'trending_up':
      case 'uptrend':
      case 'bull':
        votes.push({ tag: 'Regime:uptrend', vote: 1, strength: Math.min(0.25, strength * 0.3) });
        break;

      case this.regimes.TRENDING_DOWN:
      case 'trending_down':
      case 'downtrend':
      case 'bear':
        votes.push({ tag: 'Regime:downtrend', vote: -1, strength: Math.min(0.25, strength * 0.3) });
        break;

      case this.regimes.BREAKOUT:
      case 'breakout':
        votes.push({ tag: 'Regime:breakout', vote: 1, strength: 0.30 });
        break;

      case this.regimes.BREAKDOWN:
      case 'breakdown':
        votes.push({ tag: 'Regime:breakdown', vote: -1, strength: 0.30 });
        break;

      case this.regimes.VOLATILE:
      case 'volatile':
        // Volatile market - neutral vote but high strength signal to reduce position size
        votes.push({ tag: 'Regime:volatile', vote: 0, strength: 0.15 });
        break;

      case this.regimes.QUIET:
      case 'quiet':
        votes.push({ tag: 'Regime:quiet', vote: 0, strength: 0.05 });
        break;
    }

    return votes;
  }
}

module.exports = MarketRegimeDetector;
