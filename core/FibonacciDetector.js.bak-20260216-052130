// FibonacciDetector.js - Fibonacci level detection and analysis
// Detects swing high/lows and calculates retracement levels

/**
 * Advanced Fibonacci level detection and analysis
 * Identifies swing points and calculates retracement levels for trading decisions
 */
class FibonacciDetector {
  /**
   * Create a new Fibonacci detector with configurable parameters
   * @param {Object} config - Configuration options for Fibonacci analysis
   */
  constructor(config = {}) {
    // Default configuration with Fibonacci-specific settings
    this.config = {
      // Standard Fibonacci retracement levels (0-1 ratio)
      levels: [0.236, 0.382, 0.5, 0.618, 0.786],
      
      // Golden zone (most significant reversal area)
      goldenZone: [0.618, 0.65],
      
      // Swing detection settings for finding pivot points
      lookbackCandles: 100,        // Number of candles to analyze for swings
      strengthRequired: 3,         // Minimum candles confirming swing point
      swingThresholdPercent: 1.0,  // Min % price change to confirm swing
      
      // Level proximity settings for "at level" detection
      proximityThreshold: 0.5, // % threshold to consider price "at" a level
      
      // Merged with user config overrides
      ...config
    };
    
    // Initialize Fibonacci state
    this.reset();
  }
  
  /**
   * Reset detector state to initial values
   * Clears all swing points and calculated levels
   */
  reset() {
    // Initialize state object with default values
    this.state = {
      lastUpdate: 0,          // Timestamp of last level calculation
      swingHigh: null,        // Highest swing point price
      swingLow: null,         // Lowest swing point price
      swingHighIndex: -1,     // Index of swing high in candle array
      swingLowIndex: -1,      // Index of swing low in candle array
      trend: null,            // Current trend direction ('up' or 'down')
      levels: null,           // Calculated Fibonacci levels object
      activeLevels: []        // Currently active/relevant levels
    };
  }
  
  /**
   * Update Fibonacci levels with new candle data
   * Main analysis method that detects swings and calculates retracement levels
   * @param {Array} candles - Price candles array
   * @returns {Object|null} Fibonacci levels or null if not detected
   */
  update(candles) {
    // Validate input data and minimum required candles
    if (!candles || candles.length < Math.max(30, this.config.lookbackCandles)) {
      return null;
    }
    
    // Use smaller of available candles or configured lookback period
    const lookback = Math.min(this.config.lookbackCandles, candles.length);
    
    // Find swing high and low points within lookback period
    const { swingHigh, swingLow, swingHighIndex, swingLowIndex } = this.findSwings(candles, lookback);
    
    // Store identified swing points in state
    this.state.swingHigh = swingHigh;
    this.state.swingLow = swingLow;
    this.state.swingHighIndex = swingHighIndex;
    this.state.swingLowIndex = swingLowIndex;
    
    // Skip Fibonacci calculation if missing either swing point
    if (swingHighIndex === -1 || swingLowIndex === -1) {
      return null;
    }
    
    // Determine trend direction based on which swing occurred more recently
    const isUptrend = swingHighIndex > swingLowIndex;
    this.state.trend = isUptrend ? 'up' : 'down';
    
    // Calculate price range between swing points
    const range = Math.abs(swingHigh - swingLow);
    
    // Initialize levels object for Fibonacci calculations
    const levels = {};
    
    if (isUptrend) {
      // Uptrend - calculate retracement levels from swing low to high
      this.config.levels.forEach(level => {
        levels[level] = swingLow + range * level;
      });
      
      // Include swing points as reference levels
      levels.swingLow = swingLow;
      levels.swingHigh = swingHigh;
      levels.direction = 'up';
    } else {
      // Downtrend - calculate retracement levels from swing high to low
      this.config.levels.forEach(level => {
        levels[level] = swingHigh - range * level;
      });
      
      // Include swing points as reference levels
      levels.swingLow = swingLow;
      levels.swingHigh = swingHigh;
      levels.direction = 'down';
    }
    
    // Store calculated levels and update timestamp
    this.state.levels = levels;
    this.state.lastUpdate = Date.now();
    
    return levels;
  }
  
  /**
   * Find swing highs and lows in candle data using strength validation
   * Identifies significant pivot points that meet strength requirements
   * @param {Array} candles - Price candles to analyze
   * @param {number} lookback - Number of candles to look back
   * @returns {Object} Swing point information with indices
   */
  findSwings(candles, lookback) {
    // Initialize swing tracking variables
    let swingHigh = -Infinity;
    let swingLow = Infinity;
    let swingHighIndex = -1;
    let swingLowIndex = -1;
    
    // Calculate minimum price change to qualify as significant swing
    const currentPrice = candles[candles.length - 1].close;
    const minSwingChange = currentPrice * (this.config.swingThresholdPercent / 100);
    
    // Array to store potential swing candidates for strength validation
    const potentialSwings = [];
    
    // Analyze candles within lookback period for swing points
    for (let i = candles.length - lookback; i < candles.length; i++) {
      const candle = candles[i];
      
      // Check for new swing high
      if (candle.high > swingHigh) {
        // Validate swing high meets minimum change threshold
        if (swingHigh !== -Infinity && candle.high - swingHigh >= minSwingChange) {
          potentialSwings.push({
            type: 'high',
            price: candle.high,
            index: i,
            strength: this.getSwingStrength(candles, i, 'high')
          });
        }
        
        // Update current swing high
        swingHigh = candle.high;
        swingHighIndex = i;
      }
      
      // Check for new swing low
      if (candle.low < swingLow) {
        // Validate swing low meets minimum change threshold
        if (swingLow !== Infinity && swingLow - candle.low >= minSwingChange) {
          potentialSwings.push({
            type: 'low',
            price: candle.low,
            index: i,
            strength: this.getSwingStrength(candles, i, 'low')
          });
        }
        
        // Update current swing low
        swingLow = candle.low;
        swingLowIndex = i;
      }
    }
    
    // Find strongest swings that meet strength requirements
    let strongestHigh = null;
    let strongestLow = null;
    
    // Evaluate each potential swing for strength qualification
    for (const swing of potentialSwings) {
      if (swing.strength >= this.config.strengthRequired) {
        // Update strongest high swing if this one is stronger
        if (swing.type === 'high' && (!strongestHigh || swing.strength > strongestHigh.strength)) {
          strongestHigh = swing;
        // Update strongest low swing if this one is stronger
        } else if (swing.type === 'low' && (!strongestLow || swing.strength > strongestLow.strength)) {
          strongestLow = swing;
        }
      }
    }
    
    // Use strongest validated swings if available
    if (strongestHigh) {
      swingHigh = strongestHigh.price;
      swingHighIndex = strongestHigh.index;
    }
    
    if (strongestLow) {
      swingLow = strongestLow.price;
      swingLowIndex = strongestLow.index;
    }
    
    return { swingHigh, swingLow, swingHighIndex, swingLowIndex };
  }
  
  /**
   * Calculate swing strength by counting confirming candles around pivot
   * Validates swing significance by analyzing surrounding price action
   * @param {Array} candles - Price candles array
   * @param {number} index - Index of potential swing point
   * @param {string} type - Type of swing ('high' or 'low')
   * @returns {number} Strength score (number of confirming candles)
   */
  getSwingStrength(candles, index, type) {
    if (type === 'high') {
      const high = candles[index].high;
      let strength = 0;
      
      // Count candles before swing that are lower (confirming high)
      for (let i = Math.max(0, index - 5); i < index; i++) {
        if (candles[i].high < high) strength++;
      }
      
      // Count candles after swing that are lower (confirming high)
      for (let i = index + 1; i < Math.min(candles.length, index + 6); i++) {
        if (candles[i].high < high) strength++;
      }
      
      return strength;
    } else {
      const low = candles[index].low;
      let strength = 0;
      
      // Count candles before swing that are higher (confirming low)
      for (let i = Math.max(0, index - 5); i < index; i++) {
        if (candles[i].low > low) strength++;
      }
      
      // Count candles after swing that are higher (confirming low)
      for (let i = index + 1; i < Math.min(candles.length, index + 6); i++) {
        if (candles[i].low > low) strength++;
      }
      
      return strength;
    }
  }
  
  /**
   * Check if current price is near any Fibonacci level
   * Identifies the closest Fibonacci level within proximity threshold
   * @param {number} price - Current market price
   * @returns {Object|null} Nearest level info or null if none near
   */
  getNearestLevel(price) {
    // Return null if no levels have been calculated
    if (!this.state.levels) return null;
    
    // Initialize tracking variables for nearest level search
    let nearestLevel = null;
    let nearestDistance = Infinity;
    let nearestKey = null;
    
    // Check distance to each calculated Fibonacci level
    for (const [key, level] of Object.entries(this.state.levels)) {
      // Skip non-numeric keys (like 'direction', 'swingHigh', etc.)
      if (!parseFloat(key) && parseFloat(key) !== 0) continue;
      
      // Calculate distance as percentage of current price
      const distance = Math.abs(price - level) / price * 100;
      
      // Update nearest level if this one is closer
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestLevel = level;
        nearestKey = key;
      }
    }
    
    // Return level info only if within proximity threshold
    if (nearestDistance <= this.config.proximityThreshold) {
      return {
        level: parseFloat(nearestKey),        // Fibonacci ratio (0.618, etc.)
        price: nearestLevel,                 // Actual price level
        distance: nearestDistance,           // Percentage distance from current price
        isGoldenZone: this.isInGoldenZone(parseFloat(nearestKey)) // Special golden zone flag
      };
    }
    
    return null;
  }
  
  /**
   * Check if a Fibonacci level falls within the "golden zone"
   * Golden zone (around 0.618) is considered most significant for reversals
   * @param {number} level - Fibonacci level value to check
   * @returns {boolean} True if level is in golden zone
   */
  isInGoldenZone(level) {
    return level >= this.config.goldenZone[0] && level <= this.config.goldenZone[1];
  }
  
  /**
   * Get all currently active Fibonacci levels
   * Returns the complete calculated levels object
   * @returns {Object} Active Fibonacci levels with all ratios and prices
   */
  getLevels() {
    return this.state.levels;
  }
  
  /**
   * Get trading suggestion based on current price and Fibonacci levels
   * Analyzes price position relative to levels and trend for action recommendation
   * @param {number} price - Current market price
   * @param {string} timeframe - Current analysis timeframe
   * @returns {Object|null} Trading suggestion or null if none available
   */
  getSuggestion(price, timeframe = 'primary') {
    // Return null if no Fibonacci levels calculated
    if (!this.state.levels) return null;
    
    // Find nearest Fibonacci level to current price
    const nearestLevel = this.getNearestLevel(price);
    if (!nearestLevel) return null;
    
    // Build base suggestion object with current state
    const suggestion = {
      price,                    // Current market price
      timeframe,               // Analysis timeframe
      nearestLevel,            // Nearest Fibonacci level info
      fibLevel: nearestLevel.level, // Fibonacci ratio (0.618, etc.)
      trend: this.state.trend, // Current trend direction
      action: 'hold',          // Default action (buy/sell/hold)
      confidence: 0,           // Confidence score (0-1)
      reason: ''               // Explanation for suggestion
    };
    
    // Generate trading suggestion based on trend and level position
    // CHANGE 612: Fix trend mismatch - normalize trend string to catch all variants
    const trendLower = (this.state.trend || '').toLowerCase().trim();
    const isUptrend = ['up', 'uptrend', 'bull', 'bullish', 'long'].includes(trendLower);
    const isDowntrend = ['down', 'downtrend', 'bear', 'bearish', 'short'].includes(trendLower);

    if (isUptrend) {
      // In uptrend - look for retracement buy opportunities
      if (nearestLevel.isGoldenZone) {
        // Golden zone in uptrend - high probability buy setup
        suggestion.action = 'buy';
        suggestion.confidence = 0.8;
        suggestion.reason = `Price at golden zone Fibonacci level (${nearestLevel.level}) in uptrend`;
      } else if (nearestLevel.level < 0.5) {
        // Deeper retracement in uptrend - potential buy opportunity
        suggestion.action = 'buy';
        suggestion.confidence = 0.6;
        suggestion.reason = `Price at deeper retracement level (${nearestLevel.level}) in uptrend`;
      }
    } else if (isDowntrend) {
      // In downtrend - look for retracement sell opportunities
      if (nearestLevel.isGoldenZone) {
        // Golden zone in downtrend - potential short setup
        suggestion.action = 'sell';
        suggestion.confidence = 0.7;
        suggestion.reason = `Price at golden zone Fibonacci level (${nearestLevel.level}) in downtrend`;
      } else if (nearestLevel.level < 0.5) {
        // Deeper retracement in downtrend - potential sell opportunity
        suggestion.action = 'sell';
        suggestion.confidence = 0.6;
        suggestion.reason = `Price at deeper retracement level (${nearestLevel.level}) in downtrend`;
      }
    }
    
    return suggestion;
  }
}

module.exports = FibonacciDetector;