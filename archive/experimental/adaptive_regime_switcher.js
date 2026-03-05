// AdaptiveRegimeSwitcher.js - ADAPTIVE REGIME SWITCHING ENGINE
// Revolutionary dynamic strategy allocation based on market regimes
// AUTOMATICALLY SWITCHES TRADING LOGIC BASED ON MARKET CONDITIONS!

const EventEmitter = require('events');

class AdaptiveRegimeSwitcher extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Regime Detection Parameters
      regimeWindow: 100,                  // Lookback window for regime detection
      regimeConfidenceThreshold: 0.8,     // Minimum confidence to switch regimes
      regimeStabilityPeriod: 20,          // Minimum periods before regime change
      volatilityThreshold: 0.02,          // 2% daily volatility threshold
      trendThreshold: 0.05,               // 5% trend strength threshold
      
      // Strategy Allocation Parameters
      maxStrategyWeight: 0.6,             // Maximum weight per strategy
      minStrategyWeight: 0.1,             // Minimum active strategy weight
      rebalanceThreshold: 0.15,           // 15% weight change triggers rebalance
      adaptationSpeed: 0.3,               // How fast to adapt (0-1)
      
      // Market Regime Definitions
      regimeDefinitions: {
        trending_bull: {
          name: 'Trending Bull Market',
          strategies: ['momentum', 'breakout', 'trend_following'],
          weights: [0.4, 0.35, 0.25],
          riskMultiplier: 1.2
        },
        trending_bear: {
          name: 'Trending Bear Market', 
          strategies: ['short_momentum', 'breakdown', 'bear_trend'],
          weights: [0.45, 0.3, 0.25],
          riskMultiplier: 0.8
        },
        ranging_market: {
          name: 'Ranging/Sideways Market',
          strategies: ['mean_reversion', 'range_trading', 'volatility_trading'],
          weights: [0.5, 0.3, 0.2],
          riskMultiplier: 1.0
        },
        high_volatility: {
          name: 'High Volatility Market',
          strategies: ['volatility_breakout', 'gap_trading', 'news_momentum'],
          weights: [0.4, 0.35, 0.25],
          riskMultiplier: 0.7
        },
        low_volatility: {
          name: 'Low Volatility Market',
          strategies: ['carry_trade', 'theta_decay', 'accumulation'],
          weights: [0.4, 0.3, 0.3],
          riskMultiplier: 1.3
        },
        crisis_mode: {
          name: 'Crisis/Panic Market',
          strategies: ['defensive', 'crisis_alpha', 'safe_haven'],
          weights: [0.6, 0.25, 0.15],
          riskMultiplier: 0.5
        }
      },
      
      ...config
    };
    
    // Current State
    this.currentState = {
      activeRegime: 'ranging_market',
      regimeConfidence: 0.5,
      regimeHistory: [],
      lastRegimeChange: Date.now(),
      regimeStability: 0,
      
      // Strategy Allocation
      activeStrategies: new Map(),
      strategyWeights: new Map(),
      strategyPerformance: new Map(),
      
      // Market Metrics
      trendStrength: 0,
      volatilityLevel: 0,
      momentumFactor: 0,
      marketStress: 0
    };
    
    // Strategy Performance Tracking
    this.strategyMetrics = new Map();
    
    // Regime Detection Components
    this.regimeIndicators = {
      volatilityRegime: null,
      trendRegime: null,
      momentumRegime: null,
      correlationRegime: null,
      volumeRegime: null
    };
    
    // Initialize default strategy weights
    this.initializeStrategyWeights();
    
    console.log('🔄 ADAPTIVE REGIME SWITCHER INITIALIZED');
    console.log(`🎯 Monitoring ${Object.keys(this.config.regimeDefinitions).length} market regimes`);
  }
  
  // MAIN REGIME ANALYSIS AND SWITCHING
  async analyzeAndSwitchRegime(marketData, portfolioState) {
    try {
      // 1. Detect current market regime
      const detectedRegime = this.detectMarketRegime(marketData);
      
      // 2. Calculate regime confidence
      const regimeConfidence = this.calculateRegimeConfidence(detectedRegime, marketData);
      
      // 3. Check if regime switch is warranted
      const shouldSwitch = this.shouldSwitchRegime(detectedRegime, regimeConfidence);
      
      // 4. Execute regime switch if needed
      if (shouldSwitch) {
        await this.executeRegimeSwitch(detectedRegime, regimeConfidence);
      }
      
      // 5. Adapt strategy weights within current regime
      await this.adaptStrategyWeights(marketData, portfolioState);
      
      // 6. Update strategy performance tracking
      this.updateStrategyPerformance(portfolioState);
      
      // 7. Generate strategy allocation recommendations
      const allocationRecommendations = this.generateAllocationRecommendations();
      
      // 8. Monitor regime stability
      this.updateRegimeStability();
      
      return {
        currentRegime: this.currentState.activeRegime,
        regimeConfidence: this.currentState.regimeConfidence,
        strategyAllocations: Object.fromEntries(this.currentState.strategyWeights),
        allocationRecommendations: allocationRecommendations,
        regimeMetrics: this.getRegimeMetrics(),
        regimeSwitch: shouldSwitch
      };
      
    } catch (error) {
      console.error('❌ Regime switching error:', error);
      throw error;
    }
  }
  
  // ADVANCED MARKET REGIME DETECTION
  detectMarketRegime(marketData) {
    // Calculate multiple regime indicators
    const volatilityRegime = this.detectVolatilityRegime(marketData);
    const trendRegime = this.detectTrendRegime(marketData);
    const momentumRegime = this.detectMomentumRegime(marketData);
    const stressRegime = this.detectMarketStress(marketData);
    const correlationRegime = this.detectCorrelationRegime(marketData);
    
    // Store for diagnostics
    this.regimeIndicators = {
      volatilityRegime,
      trendRegime,
      momentumRegime,
      stressRegime,
      correlationRegime
    };
    
    // Regime decision matrix
    const regimeScores = new Map();
    
    // Crisis detection (highest priority)
    if (stressRegime.level > 0.8 || volatilityRegime.level > 0.9) {
      regimeScores.set('crisis_mode', 0.9);
    }
    
    // High volatility regime
    if (volatilityRegime.level > 0.7) {
      regimeScores.set('high_volatility', 0.8);
    }
    
    // Low volatility regime
    if (volatilityRegime.level < 0.3) {
      regimeScores.set('low_volatility', 0.7);
    }
    
    // Trending regimes
    if (trendRegime.strength > 0.6) {
      if (trendRegime.direction > 0) {
        regimeScores.set('trending_bull', 0.8);
      } else {
        regimeScores.set('trending_bear', 0.8);
      }
    }
    
    // Ranging market (default if no strong signals)
    if (trendRegime.strength < 0.4 && volatilityRegime.level < 0.6) {
      regimeScores.set('ranging_market', 0.6);
    }
    
    // Select regime with highest score
    let detectedRegime = 'ranging_market';
    let highestScore = 0;
    
    for (const [regime, score] of regimeScores) {
      if (score > highestScore) {
        highestScore = score;
        detectedRegime = regime;
      }
    }
    
    return {
      regime: detectedRegime,
      confidence: highestScore,
      indicators: this.regimeIndicators
    };
  }
  
  // VOLATILITY REGIME DETECTION
  detectVolatilityRegime(marketData) {
    const candles = marketData.candles || [];
    if (candles.length < this.config.regimeWindow) {
      return { level: 0.5, classification: 'normal' };
    }
    
    // Calculate realized volatility
    const returns = [];
    for (let i = 1; i < candles.length; i++) {
      const return_ = (candles[i].close - candles[i-1].close) / candles[i-1].close;
      returns.push(return_);
    }
    
    // Recent volatility (last 20 periods)
    const recentReturns = returns.slice(-20);
    const volatility = this.calculateVolatility(recentReturns);
    
    // Historical volatility (last 100 periods)
    const historicalReturns = returns.slice(-this.config.regimeWindow);
    const historicalVolatility = this.calculateVolatility(historicalReturns);
    
    // Volatility ratio
    const volatilityRatio = volatility / (historicalVolatility || 0.01);
    
    // Volatility level classification
    let level, classification;
    if (volatilityRatio > 2.0) {
      level = 0.9; classification = 'extreme';
    } else if (volatilityRatio > 1.5) {
      level = 0.7; classification = 'high';
    } else if (volatilityRatio < 0.7) {
      level = 0.3; classification = 'low';
    } else {
      level = 0.5; classification = 'normal';
    }
    
    return {
      level: level,
      classification: classification,
      currentVolatility: volatility,
      historicalVolatility: historicalVolatility,
      volatilityRatio: volatilityRatio
    };
  }
  
  // TREND REGIME DETECTION
  detectTrendRegime(marketData) {
    const candles = marketData.candles || [];
    if (candles.length < 50) {
      return { strength: 0, direction: 0, classification: 'sideways' };
    }
    
    // Multiple timeframe trend analysis
    const shortTerm = this.calculateTrendStrength(candles.slice(-20));  // 20 periods
    const mediumTerm = this.calculateTrendStrength(candles.slice(-50)); // 50 periods
    const longTerm = this.calculateTrendStrength(candles.slice(-100));  // 100 periods
    
    // Weighted trend strength
    const trendStrength = (shortTerm.strength * 0.5 + mediumTerm.strength * 0.3 + longTerm.strength * 0.2);
    const trendDirection = (shortTerm.direction * 0.5 + mediumTerm.direction * 0.3 + longTerm.direction * 0.2);
    
    // Trend classification
    let classification;
    if (trendStrength > 0.7) {
      classification = trendDirection > 0 ? 'strong_uptrend' : 'strong_downtrend';
    } else if (trendStrength > 0.4) {
      classification = trendDirection > 0 ? 'weak_uptrend' : 'weak_downtrend';
    } else {
      classification = 'sideways';
    }
    
    return {
      strength: trendStrength,
      direction: trendDirection,
      classification: classification,
      shortTerm: shortTerm,
      mediumTerm: mediumTerm,
      longTerm: longTerm
    };
  }
  
  // MARKET STRESS DETECTION
  detectMarketStress(marketData) {
    const stressIndicators = [];
    
    // Volume stress (unusually high volume)
    const volumeStress = this.calculateVolumeStress(marketData);
    stressIndicators.push(volumeStress);
    
    // Price gap stress (large price gaps)
    const gapStress = this.calculateGapStress(marketData);
    stressIndicators.push(gapStress);
    
    // Volatility stress (sudden volatility spikes)
    const volStress = this.calculateVolatilityStress(marketData);
    stressIndicators.push(volStress);
    
    // Correlation stress (correlation breakdown)
    const corrStress = this.calculateCorrelationStress(marketData);
    stressIndicators.push(corrStress);
    
    // Aggregate stress level
    const stressLevel = stressIndicators.reduce((sum, stress) => sum + stress, 0) / stressIndicators.length;
    
    return {
      level: stressLevel,
      components: {
        volume: volumeStress,
        gaps: gapStress,
        volatility: volStress,
        correlation: corrStress
      },
      classification: stressLevel > 0.8 ? 'crisis' : stressLevel > 0.6 ? 'stressed' : 'normal'
    };
  }
  
  // REGIME SWITCHING LOGIC
  shouldSwitchRegime(detectedRegime, regimeConfidence) {
    const currentRegime = this.currentState.activeRegime;
    const timeSinceLastSwitch = Date.now() - this.currentState.lastRegimeChange;
    
    // Don't switch if regime is the same
    if (detectedRegime.regime === currentRegime) {
      return false;
    }
    
    // Don't switch if confidence is too low
    if (regimeConfidence < this.config.regimeConfidenceThreshold) {
      return false;
    }
    
    // Don't switch too frequently (stability period)
    const stabilityPeriodMs = this.config.regimeStabilityPeriod * 60000; // Convert to ms
    if (timeSinceLastSwitch < stabilityPeriodMs) {
      return false;
    }
    
    // Special case: Always switch to crisis mode if detected
    if (detectedRegime.regime === 'crisis_mode' && regimeConfidence > 0.7) {
      return true;
    }
    
    // Switch if new regime has significantly higher confidence
    const confidenceDifference = regimeConfidence - this.currentState.regimeConfidence;
    return confidenceDifference > 0.2; // 20% confidence improvement required
  }
  
  // EXECUTE REGIME SWITCH
  async executeRegimeSwitch(detectedRegime, regimeConfidence) {
    const previousRegime = this.currentState.activeRegime;
    const newRegime = detectedRegime.regime;
    
    console.log(`🔄 REGIME SWITCH: ${previousRegime} → ${newRegime}`);
    console.log(`📊 Confidence: ${(regimeConfidence * 100).toFixed(1)}%`);
    
    // Update current state
    this.currentState.activeRegime = newRegime;
    this.currentState.regimeConfidence = regimeConfidence;
    this.currentState.lastRegimeChange = Date.now();
    this.currentState.regimeStability = 0;
    
    // Add to regime history
    this.currentState.regimeHistory.push({
      previousRegime: previousRegime,
      newRegime: newRegime,
      confidence: regimeConfidence,
      timestamp: Date.now(),
      indicators: detectedRegime.indicators
    });
    
    // Update strategy weights for new regime
    await this.updateStrategyWeightsForRegime(newRegime);
    
    // Emit regime switch event
    this.emit('regimeSwitch', {
      previousRegime: previousRegime,
      newRegime: newRegime,
      confidence: regimeConfidence,
      strategyChanges: this.getStrategyChanges(previousRegime, newRegime)
    });
    
    console.log(`✅ Regime switch completed: ${this.getRegimeStrategies(newRegime).join(', ')}`);
  }
  
  // ADAPTIVE STRATEGY WEIGHT MANAGEMENT
  async adaptStrategyWeights(marketData, portfolioState) {
    const currentRegime = this.currentState.activeRegime;
    const regimeConfig = this.config.regimeDefinitions[currentRegime];
    
    if (!regimeConfig) return;
    
    // Get current strategy performance
    const strategyPerformance = this.getStrategyPerformance();
    
    // Calculate adaptive weights
    const adaptiveWeights = new Map();
    
    for (let i = 0; i < regimeConfig.strategies.length; i++) {
      const strategy = regimeConfig.strategies[i];
      const baseWeight = regimeConfig.weights[i];
      const performance = strategyPerformance.get(strategy) || { sharpe: 0, winRate: 0.5 };
      
      // Adapt weight based on recent performance
      let adaptedWeight = baseWeight;
      
      // Performance-based adjustment
      const performanceMultiplier = 1 + (performance.sharpe * 0.2) + ((performance.winRate - 0.5) * 0.4);
      adaptedWeight *= performanceMultiplier;
      
      // Market condition adjustment
      const marketConditionMultiplier = this.calculateMarketConditionMultiplier(strategy, marketData);
      adaptedWeight *= marketConditionMultiplier;
      
      // Apply adaptation speed
      const currentWeight = this.currentState.strategyWeights.get(strategy) || baseWeight;
      const finalWeight = currentWeight + (adaptedWeight - currentWeight) * this.config.adaptationSpeed;
      
      adaptiveWeights.set(strategy, Math.max(this.config.minStrategyWeight, Math.min(this.config.maxStrategyWeight, finalWeight)));
    }
    
    // Normalize weights
    this.normalizeStrategyWeights(adaptiveWeights);
    
    // Update if change is significant
    const weightChange = this.calculateWeightChange(this.currentState.strategyWeights, adaptiveWeights);
    if (weightChange > this.config.rebalanceThreshold) {
      this.currentState.strategyWeights = adaptiveWeights;
      
      this.emit('strategyRebalance', {
        regime: currentRegime,
        newWeights: Object.fromEntries(adaptiveWeights),
        weightChange: weightChange
      });
    }
  }
  
  // STRATEGY ALLOCATION RECOMMENDATIONS
  generateAllocationRecommendations() {
    const recommendations = [];
    const currentRegime = this.currentState.activeRegime;
    const regimeConfig = this.config.regimeDefinitions[currentRegime];
    
    if (!regimeConfig) return recommendations;
    
    // Generate recommendations for each active strategy
    for (const [strategy, weight] of this.currentState.strategyWeights) {
      const recommendation = {
        strategy: strategy,
        allocation: weight,
        action: this.getStrategyAction(strategy, weight),
        confidence: this.getStrategyConfidence(strategy),
        riskMultiplier: regimeConfig.riskMultiplier,
        reasoning: this.getStrategyReasoning(strategy, currentRegime)
      };
      
      recommendations.push(recommendation);
    }
    
    return recommendations.sort((a, b) => b.allocation - a.allocation);
  }
  
  // UTILITY FUNCTIONS
  initializeStrategyWeights() {
    const defaultRegime = this.currentState.activeRegime;
    const regimeConfig = this.config.regimeDefinitions[defaultRegime];
    
    if (regimeConfig) {
      for (let i = 0; i < regimeConfig.strategies.length; i++) {
        const strategy = regimeConfig.strategies[i];
        const weight = regimeConfig.weights[i];
        this.currentState.strategyWeights.set(strategy, weight);
        
        // Initialize performance tracking
        this.strategyMetrics.set(strategy, {
          trades: 0,
          winRate: 0.5,
          sharpe: 0,
          maxDrawdown: 0,
          recentPnL: []
        });
      }
    }
  }
  
  updateStrategyWeightsForRegime(regime) {
    const regimeConfig = this.config.regimeDefinitions[regime];
    if (!regimeConfig) return;
    
    // Clear current weights
    this.currentState.strategyWeights.clear();
    
    // Set new weights
    for (let i = 0; i < regimeConfig.strategies.length; i++) {
      const strategy = regimeConfig.strategies[i];
      const weight = regimeConfig.weights[i];
      this.currentState.strategyWeights.set(strategy, weight);
    }
  }
  
  calculateTrendStrength(candles) {
    if (candles.length < 2) return { strength: 0, direction: 0 };
    
    const startPrice = candles[0].close;
    const endPrice = candles[candles.length - 1].close;
    const priceChange = (endPrice - startPrice) / startPrice;
    
    // Calculate trend consistency
    let trendConsistency = 0;
    const expectedDirection = priceChange > 0 ? 1 : -1;
    
    for (let i = 1; i < candles.length; i++) {
      const dayChange = (candles[i].close - candles[i-1].close) / candles[i-1].close;
      const dayDirection = dayChange > 0 ? 1 : -1;
      
      if (dayDirection === expectedDirection) {
        trendConsistency++;
      }
    }
    
    const consistency = trendConsistency / (candles.length - 1);
    const strength = Math.abs(priceChange) * consistency;
    
    return {
      strength: Math.min(strength * 10, 1), // Scale to 0-1
      direction: priceChange > 0 ? 1 : -1,
      consistency: consistency
    };
  }
  
  calculateVolatility(returns) {
    if (returns.length === 0) return 0;
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance) * Math.sqrt(252); // Annualized
  }
  
  normalizeStrategyWeights(weights) {
    const totalWeight = Array.from(weights.values()).reduce((sum, weight) => sum + weight, 0);
    
    if (totalWeight > 0) {
      for (const [strategy, weight] of weights) {
        weights.set(strategy, weight / totalWeight);
      }
    }
  }
  
  getRegimeStrategies(regime) {
    const regimeConfig = this.config.regimeDefinitions[regime];
    return regimeConfig ? regimeConfig.strategies : [];
  }
  
  getRegimeMetrics() {
    return {
      currentRegime: this.currentState.activeRegime,
      regimeConfidence: this.currentState.regimeConfidence,
      regimeStability: this.currentState.regimeStability,
      timeSinceLastChange: Date.now() - this.currentState.lastRegimeChange,
      indicators: this.regimeIndicators
    };
  }
  
  // Get comprehensive diagnostics
  getDiagnostics() {
    return {
      config: this.config,
      currentState: this.currentState,
      regimeIndicators: this.regimeIndicators,
      strategyMetrics: Object.fromEntries(this.strategyMetrics),
      regimeHistory: this.currentState.regimeHistory.slice(-10) // Last 10 regime changes
    };
  }
}

module.exports = { AdaptiveRegimeSwitcher };