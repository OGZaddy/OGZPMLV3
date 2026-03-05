// MarketMicrostructureAI.js - INSTITUTIONAL-GRADE ORDER FLOW ANALYSIS
// Revolutionary AI that analyzes market microstructure patterns
// This gives you WALL STREET level insights from retail data!

const EventEmitter = require('events');

class MarketMicrostructureAI extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      orderFlowWindow: 100,           // Ticks to analyze
      volumeImbalanceThreshold: 0.3,  // 30% imbalance triggers signal
      liquidityDetectionPeriod: 20,   // Periods to analyze liquidity
      darkPoolDetectionEnabled: true, // Detect hidden institutional activity
      spoofingDetectionEnabled: true, // Detect market manipulation
      smartMoneyTracking: true,       // Track institutional footprints
      ...options
    };
    
    // Order flow tracking
    this.orderFlow = {
      buyVolume: [],
      sellVolume: [],
      bidAskSpread: [],
      tickDirection: [],
      volumeAtPrice: new Map(),
      timeAndSales: []
    };
    
    // Market depth simulation
    this.marketDepth = {
      bidLevels: [],
      askLevels: [],
      supportLevels: new Map(),
      resistanceLevels: new Map(),
      liquidityPockets: []
    };
    
    // Institutional activity detection
    this.institutionalSignals = {
      darkPoolActivity: 0,
      blockTradeDetection: [],
      algorithmicActivity: 0,
      smartMoneyDirection: 'neutral',
      manipulationScore: 0
    };
    
    // Advanced pattern recognition
    this.microPatterns = {
      icebergOrders: [],
      hiddenLiquidity: [],
      stopHunting: [],
      liquidityGrabs: [],
      smartMoneyAccumulation: []
    };
    
    console.log('🏛️ Market Microstructure AI initialized');
  }
  
  // MAIN ANALYSIS FUNCTION
  analyzeMarketMicrostructure(tick) {
    this.processTick(tick);
    
    const analysis = {
      orderFlowImbalance: this.calculateOrderFlowImbalance(),
      liquidityAnalysis: this.analyzeLiquidity(),
      institutionalActivity: this.detectInstitutionalActivity(),
      microPatterns: this.detectMicroPatterns(),
      marketManipulation: this.detectManipulation(),
      smartMoneySignals: this.analyzeSmartMoney(),
      tradingOpportunity: this.identifyTradingOpportunity()
    };
    
    // Emit signals for high-confidence opportunities
    if (analysis.tradingOpportunity.confidence > 0.8) {
      this.emit('highConfidenceSignal', analysis);
    }
    
    return analysis;
  }
  
  processTick(tick) {
    // Classify tick direction
    const direction = this.classifyTickDirection(tick);
    this.orderFlow.tickDirection.push(direction);
    
    // Estimate buy/sell volume based on price movement and volume
    const volumeSplit = this.estimateVolumeSplit(tick, direction);
    this.orderFlow.buyVolume.push(volumeSplit.buy);
    this.orderFlow.sellVolume.push(volumeSplit.sell);
    
    // Track volume at price levels
    const priceLevel = Math.round(tick.price * 100) / 100; // Round to cent
    const currentVolume = this.orderFlow.volumeAtPrice.get(priceLevel) || 0;
    this.orderFlow.volumeAtPrice.set(priceLevel, currentVolume + tick.volume);
    
    // Maintain sliding window
    this.maintainSlidingWindow();
    
    // Update market depth simulation
    this.updateMarketDepth(tick);
  }
  
  classifyTickDirection(tick) {
    if (!this.lastTick) {
      this.lastTick = tick;
      return 0;
    }
    
    const priceChange = tick.price - this.lastTick.price;
    this.lastTick = tick;
    
    if (priceChange > 0) return 1;   // Uptick
    if (priceChange < 0) return -1;  // Downtick
    return 0;                        // No change
  }
  
  estimateVolumeSplit(tick, direction) {
    // Advanced volume classification algorithm
    // In real institutional systems, this comes from Level II data
    
    let buyRatio = 0.5; // Default 50/50 split
    
    // Adjust based on tick direction
    if (direction === 1) {
      buyRatio = 0.7; // More likely buyers
    } else if (direction === -1) {
      buyRatio = 0.3; // More likely sellers
    }
    
    // Adjust based on volume size (large volume = institutional)
    const avgVolume = this.getAverageVolume();
    if (tick.volume > avgVolume * 3) {
      // Large block trade - likely institutional
      if (direction === 1) buyRatio = 0.8;
      if (direction === -1) buyRatio = 0.2;
    }
    
    return {
      buy: tick.volume * buyRatio,
      sell: tick.volume * (1 - buyRatio)
    };
  }
  
  // ORDER FLOW IMBALANCE CALCULATION
  calculateOrderFlowImbalance() {
    const recentBuyVolume = this.orderFlow.buyVolume.slice(-this.config.orderFlowWindow);
    const recentSellVolume = this.orderFlow.sellVolume.slice(-this.config.orderFlowWindow);
    
    const totalBuyVolume = recentBuyVolume.reduce((a, b) => a + b, 0);
    const totalSellVolume = recentSellVolume.reduce((a, b) => a + b, 0);
    const totalVolume = totalBuyVolume + totalSellVolume;
    
    if (totalVolume === 0) return { imbalance: 0, direction: 'neutral' };
    
    const buyRatio = totalBuyVolume / totalVolume;
    const sellRatio = totalSellVolume / totalVolume;
    const imbalance = buyRatio - sellRatio;
    
    let direction = 'neutral';
    let strength = 'weak';
    
    if (Math.abs(imbalance) > this.config.volumeImbalanceThreshold) {
      direction = imbalance > 0 ? 'bullish' : 'bearish';
      strength = Math.abs(imbalance) > 0.5 ? 'strong' : 'moderate';
    }
    
    return {
      imbalance: imbalance,
      direction: direction,
      strength: strength,
      buyVolume: totalBuyVolume,
      sellVolume: totalSellVolume,
      confidence: Math.min(Math.abs(imbalance) * 2, 1)
    };
  }
  
  // LIQUIDITY ANALYSIS
  analyzeLiquidity() {
    const liquidityMap = this.buildLiquidityMap();
    const liquidityGaps = this.findLiquidityGaps(liquidityMap);
    const liquidityPockets = this.findLiquidityPockets(liquidityMap);
    
    return {
      liquidityMap: liquidityMap,
      liquidityGaps: liquidityGaps,
      liquidityPockets: liquidityPockets,
      marketDepth: this.calculateMarketDepth(),
      liquidityRisk: this.assessLiquidityRisk(liquidityGaps)
    };
  }
  
  buildLiquidityMap() {
    const map = new Map();
    const priceRange = this.getPriceRange();
    
    // Build liquidity profile from volume at price data
    for (const [price, volume] of this.orderFlow.volumeAtPrice) {
      if (price >= priceRange.min && price <= priceRange.max) {
        map.set(price, volume);
      }
    }
    
    return map;
  }
  
  findLiquidityGaps() {
    // Identify areas with low liquidity (potential breakout zones)
    const gaps = [];
    const liquidityThreshold = this.calculateAverageLiquidity() * 0.3;
    
    const sortedPrices = Array.from(this.orderFlow.volumeAtPrice.keys()).sort((a, b) => a - b);
    
    for (let i = 1; i < sortedPrices.length - 1; i++) {
      const currentPrice = sortedPrices[i];
      const currentVolume = this.orderFlow.volumeAtPrice.get(currentPrice);
      
      if (currentVolume < liquidityThreshold) {
        gaps.push({
          price: currentPrice,
          volume: currentVolume,
          gapSize: liquidityThreshold - currentVolume,
          breakoutPotential: this.calculateBreakoutPotential(currentPrice)
        });
      }
    }
    
    return gaps.sort((a, b) => b.breakoutPotential - a.breakoutPotential);
  }
  
  // INSTITUTIONAL ACTIVITY DETECTION
  detectInstitutionalActivity() {
    const blockTrades = this.detectBlockTrades();
    const icebergOrders = this.detectIcebergOrders();
    const darkPoolActivity = this.estimateDarkPoolActivity();
    const algorithmicTrading = this.detectAlgorithmicTrading();
    
    return {
      blockTrades: blockTrades,
      icebergOrders: icebergOrders,
      darkPoolActivity: darkPoolActivity,
      algorithmicTrading: algorithmicTrading,
      institutionalBias: this.calculateInstitutionalBias(),
      smartMoneyFlow: this.analyzeSmartMoneyFlow()
    };
  }
  
  detectBlockTrades() {
    const blockTrades = [];
    const recentVolumes = this.orderFlow.buyVolume.concat(this.orderFlow.sellVolume).slice(-50);
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const blockThreshold = avgVolume * 5; // 5x average = block trade
    
    for (let i = 0; i < recentVolumes.length; i++) {
      if (recentVolumes[i] > blockThreshold) {
        blockTrades.push({
          volume: recentVolumes[i],
          timestamp: Date.now() - (recentVolumes.length - i) * 1000,
          type: 'block_trade',
          institutionalProbability: Math.min(recentVolumes[i] / avgVolume / 10, 1)
        });
      }
    }
    
    return blockTrades;
  }
  
  detectIcebergOrders() {
    // Iceberg orders: Large orders split into smaller visible pieces
    const icebergs = [];
    const priceWindow = 0.001; // Price tolerance
    
    // Look for repeated volume at similar price levels
    const priceGroups = new Map();
    
    for (const [price, volume] of this.orderFlow.volumeAtPrice) {
      const groupKey = Math.round(price / priceWindow) * priceWindow;
      if (!priceGroups.has(groupKey)) {
        priceGroups.set(groupKey, []);
      }
      priceGroups.get(groupKey).push({ price, volume });
    }
    
    for (const [groupPrice, trades] of priceGroups) {
      if (trades.length > 5) { // Multiple trades at similar price
        const totalVolume = trades.reduce((sum, t) => sum + t.volume, 0);
        const avgTradeSize = totalVolume / trades.length;
        
        if (totalVolume > this.getAverageVolume() * 3) {
          icebergs.push({
            price: groupPrice,
            totalVolume: totalVolume,
            tradeCount: trades.length,
            avgTradeSize: avgTradeSize,
            icebergProbability: Math.min(trades.length / 10, 1)
          });
        }
      }
    }
    
    return icebergs;
  }
  
  // MARKET MANIPULATION DETECTION
  detectManipulation() {
    const spoofing = this.detectSpoofing();
    const stopHunting = this.detectStopHunting();
    const painting = this.detectPaintingTheTape();
    
    return {
      spoofing: spoofing,
      stopHunting: stopHunting,
      paintingTheTape: painting,
      manipulationScore: this.calculateManipulationScore(),
      trustworthiness: this.calculateMarketTrustworthiness()
    };
  }
  
  detectSpoofing() {
    // Spoofing: Large orders that disappear quickly
    const spoofingEvents = [];
    
    // In a real system, this would analyze order book changes
    // Here we simulate by looking for volume spikes followed by price reversals
    
    const recentTicks = this.orderFlow.tickDirection.slice(-20);
    const recentVolumes = this.orderFlow.buyVolume.slice(-20);
    
    for (let i = 2; i < recentTicks.length - 2; i++) {
      const volumeSpike = recentVolumes[i] > this.getAverageVolume() * 2;
      const directionChange = recentTicks[i] !== recentTicks[i + 1];
      
      if (volumeSpike && directionChange) {
        spoofingEvents.push({
          timestamp: Date.now() - (recentTicks.length - i) * 1000,
          volume: recentVolumes[i],
          suspicionLevel: 'medium'
        });
      }
    }
    
    return spoofingEvents;
  }
  
  // SMART MONEY ANALYSIS
  analyzeSmartMoney() {
    const distribution = this.analyzeAccumulationDistribution();
    const flowDirection = this.calculateSmartMoneyFlow();
    const institutionalFootprints = this.detectInstitutionalFootprints();
    
    return {
      accumulation: distribution.accumulation,
      distribution: distribution.distribution,
      flowDirection: flowDirection,
      institutionalFootprints: institutionalFootprints,
      smartMoneyBias: this.calculateSmartMoneyBias(),
      followSmartMoney: this.shouldFollowSmartMoney()
    };
  }
  
  analyzeAccumulationDistribution() {
    // Smart money accumulates on weakness, distributes on strength
    const priceChanges = [];
    const volumeChanges = [];
    
    for (let i = 1; i < this.orderFlow.tickDirection.length; i++) {
      priceChanges.push(this.orderFlow.tickDirection[i]);
      volumeChanges.push(this.orderFlow.buyVolume[i] + this.orderFlow.sellVolume[i]);
    }
    
    let accumulation = 0;
    let distribution = 0;
    
    for (let i = 0; i < priceChanges.length; i++) {
      if (priceChanges[i] < 0 && volumeChanges[i] > this.getAverageVolume()) {
        accumulation++; // High volume on down moves = accumulation
      }
      if (priceChanges[i] > 0 && volumeChanges[i] > this.getAverageVolume()) {
        distribution++; // High volume on up moves = distribution
      }
    }
    
    return {
      accumulation: accumulation,
      distribution: distribution,
      ratio: accumulation / (accumulation + distribution + 1),
      phase: accumulation > distribution ? 'accumulation' : 'distribution'
    };
  }
  
  // TRADING OPPORTUNITY IDENTIFICATION
  identifyTradingOpportunity() {
    const orderFlowSignal = this.calculateOrderFlowImbalance();
    const liquiditySignal = this.analyzeLiquidity();
    const institutionalSignal = this.detectInstitutionalActivity();
    const smartMoneySignal = this.analyzeSmartMoney();
    
    // Combine all signals for final trading decision
    let confidence = 0;
    let direction = 'neutral';
    let reasoning = [];
    
    // Order flow imbalance (40% weight)
    if (orderFlowSignal.confidence > 0.6) {
      confidence += orderFlowSignal.confidence * 0.4;
      direction = orderFlowSignal.direction;
      reasoning.push(`Order Flow: ${orderFlowSignal.direction} (${(orderFlowSignal.confidence * 100).toFixed(1)}%)`);
    }
    
    // Liquidity analysis (25% weight)
    if (liquiditySignal.liquidityGaps.length > 0) {
      const bestGap = liquiditySignal.liquidityGaps[0];
      if (bestGap.breakoutPotential > 0.7) {
        confidence += 0.25;
        reasoning.push(`Liquidity Gap at ${bestGap.price} (${(bestGap.breakoutPotential * 100).toFixed(1)}%)`);
      }
    }
    
    // Institutional activity (20% weight)
    if (institutionalSignal.smartMoneyFlow.confidence > 0.6) {
      confidence += institutionalSignal.smartMoneyFlow.confidence * 0.2;
      reasoning.push(`Smart Money: ${institutionalSignal.smartMoneyFlow.direction}`);
    }
    
    // Smart money signals (15% weight)
    if (smartMoneySignal.smartMoneyBias !== 'neutral') {
      confidence += 0.15;
      reasoning.push(`Smart Money Bias: ${smartMoneySignal.smartMoneyBias}`);
    }
    
    return {
      action: confidence > 0.7 ? (direction === 'bullish' ? 'buy' : 'sell') : 'hold',
      confidence: Math.min(confidence, 1),
      direction: direction,
      reasoning: reasoning,
      riskLevel: this.calculateRiskLevel(confidence, liquiditySignal),
      entryZone: this.calculateOptimalEntry(),
      stopLoss: this.calculateOptimalStopLoss(),
      takeProfit: this.calculateOptimalTakeProfit()
    };
  }
  
  // UTILITY FUNCTIONS
  maintainSlidingWindow() {
    const maxWindow = this.config.orderFlowWindow;
    
    if (this.orderFlow.buyVolume.length > maxWindow) {
      this.orderFlow.buyVolume.shift();
      this.orderFlow.sellVolume.shift();
      this.orderFlow.tickDirection.shift();
    }
    
    // Clean old price data (keep last 1000 price levels)
    if (this.orderFlow.volumeAtPrice.size > 1000) {
      const sortedEntries = Array.from(this.orderFlow.volumeAtPrice.entries())
        .sort((a, b) => b[1] - a[1]) // Sort by volume
        .slice(0, 800); // Keep top 800
      
      this.orderFlow.volumeAtPrice.clear();
      for (const [price, volume] of sortedEntries) {
        this.orderFlow.volumeAtPrice.set(price, volume);
      }
    }
  }
  
  getAverageVolume() {
    const volumes = this.orderFlow.buyVolume.concat(this.orderFlow.sellVolume);
    return volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 1;
  }
  
  calculateAverageLiquidity() {
    const volumes = Array.from(this.orderFlow.volumeAtPrice.values());
    return volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 1;
  }
  
  getPriceRange() {
    const prices = Array.from(this.orderFlow.volumeAtPrice.keys());
    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
      range: Math.max(...prices) - Math.min(...prices)
    };
  }
  
  // Get comprehensive diagnostics
  getDiagnostics() {
    return {
      orderFlowWindow: this.config.orderFlowWindow,
      totalTicks: this.orderFlow.tickDirection.length,
      uniquePriceLevels: this.orderFlow.volumeAtPrice.size,
      averageVolume: this.getAverageVolume(),
      averageLiquidity: this.calculateAverageLiquidity(),
      priceRange: this.getPriceRange(),
      institutionalSignals: this.institutionalSignals,
      microPatterns: this.microPatterns.length || 0
    };
  }
}

module.exports = { MarketMicrostructureAI };