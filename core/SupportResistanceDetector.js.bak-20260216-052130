// SupportResistanceDetector.js - Identify key market levels
// Uses price clustering and rejections to find important levels

/**
 * Support and Resistance level detector
 * Identifies important price levels using multiple methods
 */
class SupportResistanceDetector {
  /**
   * Create a new Support/Resistance detector
   * @param {Object} config - Configuration options
   */
  constructor(config = {}) {
    // Default configuration with optimal settings
    this.config = {
      // Level detection settings
      priceClustering: true,           // Enable price clustering method
      fractals: true,                  // Enable fractal detection
      volumeProfile: false,            // Enable volume profile method
      
      // Filtering settings
      minStrength: 3,                  // Minimum touches to be significant
      mergeThresholdPercent: 0.5,      // % distance to merge nearby levels
      maxLevels: 8,                    // Maximum levels to track
      
      // Round levels to this precision (0 = disabled)
      // e.g., 2 means round to nearest 100 (29875 -> 29900)
      roundingPrecision: 1,
      
      // Level proximity
      proximityThresholdPercent: 0.3,  // % distance to be considered "at" a level
      
      // For price clustering method
      lookbackCandles: 300,            // Candles to analyze
      clusteringDensity: 30,           // Price points binning value
      
      // For fractal detection
      fractalRange: 2,                 // Bars on each side for fractal 
      fractalStrengthMin: 2,           // Minimum bars confirming
      
      // Merged with user config
      ...config
    };
    
    // State
    this.reset();
  }
  
  /**
   * Reset detector state
   */
  reset() {
    this.state = {
      lastUpdate: 0,
      levels: [],
      activeLevels: []
    };
  }
  
  /**
   * Update support/resistance levels with new candles
   * @param {Array} candles - Price candles
   * @returns {Array} Detected levels
   */
  update(candles) {
    if (!candles || candles.length < Math.max(30, this.config.lookbackCandles)) {
      return [];
    }
    
    // Track levels using multiple methods
    const levels = [];
    
    // Get current price
    const currentPrice = candles[candles.length - 1].close;
    
    // Price clustering method
    if (this.config.priceClustering) {
      const clusteringLevels = this.findLevelsByClustering(candles);
      levels.push(...clusteringLevels);
    }
    
    // Fractal method (local highs/lows)
    if (this.config.fractals) {
      const fractalLevels = this.findLevelsByFractals(candles);
      levels.push(...fractalLevels);
    }
    
    // Volume profile (if enabled)
    if (this.config.volumeProfile) {
      const volumeLevels = this.findLevelsByVolume(candles);
      levels.push(...volumeLevels);
    }
    
    // Merge and filter levels
    const mergedLevels = this.mergeLevels(levels, currentPrice);
    
    // Store levels
    this.state.levels = mergedLevels;
    this.state.lastUpdate = Date.now();
    
    // Update active levels (near current price)
    this.updateActiveLevels(currentPrice);
    
    return mergedLevels;
  }
  
  /**
   * Find levels using price clustering
   * @param {Array} candles - Price candles
   * @returns {Array} Detected levels
   */
  findLevelsByClustering(candles) {
    const lookback = Math.min(this.config.lookbackCandles, candles.length);
    const priceFrequency = {};
    
    // Get current price for normalization
    const currentPrice = candles[candles.length - 1].close;
    
    // Calculate rounding factor
    let roundingFactor = 1;
    if (this.config.roundingPrecision > 0) {
      roundingFactor = Math.pow(10, this.config.roundingPrecision);
    }
    
    // Helper to round price
    const roundPrice = (price) => {
      if (this.config.roundingPrecision === 0) return price;
      return Math.round(price / roundingFactor) * roundingFactor;
    };
    
    // Count price touches at highs and lows
    for (let i = candles.length - lookback; i < candles.length; i++) {
      // Normalize each candle's prices
      const highRounded = roundPrice(candles[i].high);
      const lowRounded = roundPrice(candles[i].low);
      
      // Increment frequency counters
      priceFrequency[highRounded] = (priceFrequency[highRounded] || 0) + 1;
      priceFrequency[lowRounded] = (priceFrequency[lowRounded] || 0) + 1;
    }
    
    // Find levels with sufficient touches
    const levels = Object.entries(priceFrequency)
      .filter(([_, count]) => count >= this.config.minStrength)
      .map(([price, count]) => ({
        price: parseFloat(price),
        strength: count,
        method: 'cluster',
        type: parseFloat(price) < currentPrice ? 'support' : 'resistance'
      }))
      .sort((a, b) => b.strength - a.strength);
    
    return levels;
  }
  
  /**
   * Find levels using price fractals (local highs/lows)
   * @param {Array} candles - Price candles
   * @returns {Array} Detected levels
   */
  findLevelsByFractals(candles) {
    const levels = [];
    const currentPrice = candles[candles.length - 1].close;
    const range = this.config.fractalRange;
    
    // Helper to round price
    let roundingFactor = 1;
    if (this.config.roundingPrecision > 0) {
      roundingFactor = Math.pow(10, this.config.roundingPrecision);
    }
    
    const roundPrice = (price) => {
      if (this.config.roundingPrecision === 0) return price;
      return Math.round(price / roundingFactor) * roundingFactor;
    };
    
    // Look for high fractals
    for (let i = range; i < candles.length - range; i++) {
      // Check for high fractal - local high with lower highs on both sides
      let isHighFractal = true;
      
      for (let j = i - range; j < i; j++) {
        if (candles[j].high >= candles[i].high) {
          isHighFractal = false;
          break;
        }
      }
      
      for (let j = i + 1; j <= i + range; j++) {
        if (candles[j].high >= candles[i].high) {
          isHighFractal = false;
          break;
        }
      }
      
      if (isHighFractal) {
        // Calculate fractal strength
        let strength = 0;
        
        // Count candles that respect this level
        for (let j = i + range + 1; j < candles.length; j++) {
          // If price approaches but doesn't break the level, increase strength
          if (candles[j].high > candles[i].high * 0.995 && 
              candles[j].high <= candles[i].high) {
            strength++;
          }
          
          // If price breaks level, reset strength
          if (candles[j].high > candles[i].high) {
            strength = 0;
          }
        }
        
        // Only add significant fractals
        if (strength >= this.config.fractalStrengthMin) {
          const price = roundPrice(candles[i].high);
          levels.push({
            price,
            strength: strength,
            method: 'fractal',
            type: price < currentPrice ? 'support' : 'resistance'
          });
        }
      }
      
      // Check for low fractal - local low with higher lows on both sides
      let isLowFractal = true;
      
      for (let j = i - range; j < i; j++) {
        if (candles[j].low <= candles[i].low) {
          isLowFractal = false;
          break;
        }
      }
      
      for (let j = i + 1; j <= i + range; j++) {
        if (candles[j].low <= candles[i].low) {
          isLowFractal = false;
          break;
        }
      }
      
      if (isLowFractal) {
        // Calculate fractal strength
        let strength = 0;
        
        // Count candles that respect this level
        for (let j = i + range + 1; j < candles.length; j++) {
          // If price approaches but doesn't break the level, increase strength
          if (candles[j].low < candles[i].low * 1.005 && 
              candles[j].low >= candles[i].low) {
            strength++;
          }
          
          // If price breaks level, reset strength
          if (candles[j].low < candles[i].low) {
            strength = 0;
          }
        }
        
        // Only add significant fractals
        if (strength >= this.config.fractalStrengthMin) {
          const price = roundPrice(candles[i].low);
          levels.push({
            price,
            strength: strength,
            method: 'fractal',
            type: price < currentPrice ? 'support' : 'resistance'
          });
        }
      }
    }
    
    return levels;
  }
  
  /**
   * Find levels using volume profile
   * @param {Array} candles - Price candles
   * @returns {Array} Detected levels
   */
  findLevelsByVolume(candles) {
    // Simple volume profile
    const volumeProfile = {};
    const currentPrice = candles[candles.length - 1].close;
    
    // Helper to round price
    let roundingFactor = 1;
    if (this.config.roundingPrecision > 0) {
      roundingFactor = Math.pow(10, this.config.roundingPrecision);
    }
    
    const roundPrice = (price) => {
      if (this.config.roundingPrecision === 0) return price;
      return Math.round(price / roundingFactor) * roundingFactor;
    };
    
    // Build volume profile
    for (const candle of candles) {
      const midPrice = roundPrice((candle.high + candle.low) / 2);
      volumeProfile[midPrice] = (volumeProfile[midPrice] || 0) + candle.volume;
    }
    
    // Find high volume nodes
    const levels = Object.entries(volumeProfile)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([price, volume]) => ({
        price: parseFloat(price),
        strength: volume / 100, // Normalize volume strength
        method: 'volume',
        type: parseFloat(price) < currentPrice ? 'support' : 'resistance'
      }));
    
    return levels;
  }
  
  /**
   * Merge nearby levels and filter to most significant
   * @param {Array} levels - All detected levels
   * @param {number} currentPrice - Current price
   * @returns {Array} Merged and filtered levels
   */
  mergeLevels(levels, currentPrice) {
    if (levels.length === 0) return [];
    
    // Sort by price
    levels.sort((a, b) => a.price - b.price);
    
    // Merge nearby levels
    const mergedLevels = [];
    let currentGroup = [levels[0]];
    
    for (let i = 1; i < levels.length; i++) {
      const lastLevel = currentGroup[currentGroup.length - 1];
      const percentDiff = Math.abs(levels[i].price - lastLevel.price) / lastLevel.price * 100;
      
      if (percentDiff <= this.config.mergeThresholdPercent) {
        // Merge with current group
        currentGroup.push(levels[i]);
      } else {
        // Process current group
        if (currentGroup.length > 0) {
          const mergedLevel = this.mergeGroup(currentGroup, currentPrice);
          mergedLevels.push(mergedLevel);
        }
        
        // Start new group
        currentGroup = [levels[i]];
      }
    }
    
    // Process last group
    if (currentGroup.length > 0) {
      const mergedLevel = this.mergeGroup(currentGroup, currentPrice);
      mergedLevels.push(mergedLevel);
    }
    
    // Sort by strength and limit number of levels
    return mergedLevels
      .sort((a, b) => b.strength - a.strength)
      .slice(0, this.config.maxLevels);
  }
  
  /**
   * Merge a group of nearby levels
   * @param {Array} group - Group of levels to merge
   * @param {number} currentPrice - Current price
   * @returns {Object} Merged level
   */
  mergeGroup(group, currentPrice) {
    // Calculate weighted average price
    let totalWeight = 0;
    let weightedSum = 0;
    
    for (const level of group) {
      weightedSum += level.price * level.strength;
      totalWeight += level.strength;
    }
    
    const avgPrice = weightedSum / totalWeight;
    
    // Get dominant method
    const methodCounts = {};
    for (const level of group) {
      methodCounts[level.method] = (methodCounts[level.method] || 0) + 1;
    }
    
    const dominantMethod = Object.entries(methodCounts)
      .sort((a, b) => b[1] - a[1])[0][0];
    
    // Determine level type
    const type = avgPrice < currentPrice ? 'support' : 'resistance';
    
    // Return merged level
    return {
      price: avgPrice,
      strength: totalWeight,
      method: dominantMethod,
      type,
      originalLevels: group.length
    };
  }
  
  /**
   * Update active levels based on current price
   * @param {number} currentPrice - Current price
   */
  updateActiveLevels(currentPrice) {
    this.state.activeLevels = this.state.levels.filter(level => {
      const percentDiff = Math.abs(level.price - currentPrice) / currentPrice * 100;
      return percentDiff <= this.config.proximityThresholdPercent * 2;
    });
  }
  
  /**
   * Get the nearest level to current price
   * @param {number} price - Current price
   * @returns {Object|null} Nearest level or null if none near
   */
  getNearestLevel(price) {
    // Validate input price
    if (!price || typeof price !== 'number' || isNaN(price) || price <= 0) {
      return null;
    }

    if (!this.state.levels || this.state.levels.length === 0) {
      return null;
    }

    let nearestLevel = null;
    let nearestDistance = Infinity;

    for (const level of this.state.levels) {
      // Skip invalid levels
      if (!level || !level.price || typeof level.price !== 'number' || isNaN(level.price)) {
        continue;
      }

      // Safe distance calc - use max to avoid div/zero
      const denominator = Math.max(price, level.price, 0.0001);
      const percentDiff = Math.abs(price - level.price) / denominator * 100;

      if (!isNaN(percentDiff) && percentDiff < nearestDistance) {
        nearestDistance = percentDiff;
        nearestLevel = level;
      }
    }

    // Check if nearest level is within threshold
    if (nearestLevel && nearestDistance <= this.config.proximityThresholdPercent) {
      return {
        ...nearestLevel,
        distance: nearestDistance
      };
    }

    return null;
  }
  
  /**
   * Get all active S/R levels
   * @returns {Array} Active levels
   */
  getLevels() {
    return this.state.levels;
  }
  
  /**
   * Get all levels near current price
   * @returns {Array} Active levels near price
   */
  getActiveLevels() {
    return this.state.activeLevels;
  }
  
  /**
   * Get trading suggestion based on support/resistance
   * @param {number} price - Current price
   * @param {string} timeframe - Current timeframe
   * @returns {Object|null} Suggestion or null if none
   */
  getSuggestion(price, timeframe = 'primary') {
    if (this.state.levels.length === 0) return null;
    
    const nearestLevel = this.getNearestLevel(price);
    if (!nearestLevel) return null;
    
    // Generate trading suggestion
    const suggestion = {
      price,
      timeframe,
      nearestLevel,
      type: nearestLevel.type,
      action: 'hold',
      confidence: 0,
      reason: ''
    };
    
    // Very near support level - potential buy
    if (nearestLevel.type === 'support' && 
        nearestLevel.distance < this.config.proximityThresholdPercent / 2) {
      suggestion.action = 'buy';
      suggestion.confidence = 0.7 * Math.min(1, nearestLevel.strength / 10);
      suggestion.reason = `Price at strong support level ($${nearestLevel.price.toFixed(2)})`;
    }
    
    // Very near resistance level - potential sell
    else if (nearestLevel.type === 'resistance' && 
             nearestLevel.distance < this.config.proximityThresholdPercent / 2) {
      suggestion.action = 'sell';
      suggestion.confidence = 0.7 * Math.min(1, nearestLevel.strength / 10);
      suggestion.reason = `Price at strong resistance level ($${nearestLevel.price.toFixed(2)})`;
    }
    
    // Only return suggestion if confidence is significant
    if (suggestion.confidence > 0.3) {
      return suggestion;
    }
    
    return null;
  }
}

module.exports = SupportResistanceDetector;