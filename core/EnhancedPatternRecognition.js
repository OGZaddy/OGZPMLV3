/**
 * @fileoverview EnhancedPatternRecognition - Advanced Pattern Detection System
 *
 * Identifies high-probability trading setups by analyzing price action patterns
 * and tracking their historical performance.
 *
 * @description
 * ARCHITECTURE ROLE:
 * Pattern recognition feeds into the trading decision pipeline. Detected patterns
 * with high historical win rates boost trade confidence, while weak patterns
 * reduce it or block trades entirely.
 *
 * KEY COMPONENTS:
 * - FeatureExtractor: Normalizes market data into a 9-element feature vector
 * - PatternMemory: Stores pattern performance (wins, losses, avg P&L)
 * - PatternMatcher: Compares current features against known patterns
 *
 * FEATURE VECTOR FORMAT (9 elements):
 * [rsi, macdDelta, trend, bodySize, wickRatio, bbWidth, vol, momentum, pricePos]
 *
 * LEARNING FLOW:
 * 1. Trade entry: Extract features â†’ recordPatternResult(features, { pnl: 0 })
 * 2. Trade exit: recordPatternResult(features, { pnl: actualPnL })
 * 3. Pattern memory updates win/loss counts and average P&L
 * 4. Future trades consult pattern history for confidence adjustment
 *
 * @module core/EnhancedPatternRecognition
 * @requires ./OptimizedIndicators
 */

const fs = require('fs');
const path = require('path');
const indicators = require('./OptimizedIndicators'); // Fixed: Import singleton directly
const { c, o, h, l, v } = require('./CandleHelper');
const { getInstance: getUnifiedPatternMemory } = require('./UnifiedPatternMemory');

// Pattern performance tracking for visualization and marketing
const pattern_performance = {};
let patternCount = 0;

// =============================================================================
// DYNAMIC TIME WARPING (DTW) - 15m OPTIMIZED (Trey-approved 2026-03-15)
// Handles time-stretched pattern matching (fast vs slow MA retests)
// =============================================================================

/**
 * Normalize a series to 0-1 range for fair DTW comparison
 * Critical: Without this, features with different scales dominate unfairly
 * @param {Array} arr - Feature array
 * @returns {Array} Normalized array (0-1 range)
 */
function normalizeSeries(arr) {
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  return arr.map(v => (max - min) === 0 ? 0.5 : (v - min) / (max - min));
}

/**
 * Dynamic Time Warping (DTW) for pattern matching - tuned for 15m
 * Compares two feature sequences allowing for time stretching
 * @param {Array} seriesA - First feature sequence (normalized)
 * @param {Array} seriesB - Second feature sequence (normalized)
 * @returns {number} Distance (lower = better match), Infinity if invalid
 */
function dynamicTimeWarping(seriesA, seriesB) {
  const n = seriesA.length;
  const m = seriesB.length;
  if (n === 0 || m === 0) return Infinity;

  // Early stop if obviously bad match (length mismatch > 8 bars)
  if (Math.abs(n - m) > 8) return Infinity;

  const cost = Array.from({ length: n }, () => Array(m).fill(Infinity));
  cost[0][0] = Math.abs(seriesA[0] - seriesB[0]);

  for (let i = 1; i < n; i++) cost[i][0] = cost[i-1][0] + Math.abs(seriesA[i] - seriesB[0]);
  for (let j = 1; j < m; j++) cost[0][j] = cost[0][j-1] + Math.abs(seriesA[0] - seriesB[j]);

  for (let i = 1; i < n; i++) {
    for (let j = 1; j < m; j++) {
      const minPrev = Math.min(cost[i-1][j], cost[i][j-1], cost[i-1][j-1]);
      cost[i][j] = minPrev + Math.abs(seriesA[i] - seriesB[j]);
    }
  }

  return cost[n-1][m-1];
}

/**
 * Find best DTW match for a new pattern (15m tuned)
 * Uses shorter windows (8-20 bars) for clean retests
 * @param {Array} newFeatures - Current feature vector
 * @param {Object} storedPatterns - Pattern memory object
 * @returns {Object|null} Best match or null if below 62% threshold
 */
function findBestDTWMatch(newFeatures, storedPatterns) {
  let bestMatch = null;
  let bestSimilarity = -Infinity;

  // Limit to patterns with at least 2 outcomes for statistical relevance
  const candidates = Object.entries(storedPatterns)
    .filter(([_, p]) => p.timesSeen >= 2)
    .slice(0, 250);

  for (const [signature, patternData] of candidates) {
    const storedFeatures = signature.split(',').map(Number);

    // Normalize both series for fair comparison (critical!)
    const normA = normalizeSeries(newFeatures);
    const normB = normalizeSeries(storedFeatures);

    // Use min length to avoid over-stretching on 15m (max 20 bars)
    const len = Math.min(normA.length, normB.length, 20);
    const a = normA.slice(0, len);
    const b = normB.slice(0, len);

    const distance = dynamicTimeWarping(a, b);
    const similarity = Math.max(0, 1 - (distance / (len * 1.8))); // tighter divisor

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = {
        signature,
        similarity: parseFloat(similarity.toFixed(3)),
        patternData,
        distance
      };
    }
  }

  return bestMatch && bestSimilarity > 0.62 ? bestMatch : null; // 62% threshold
}

// =============================================================================

/**
 * Pattern feature extraction with optimized signal processing
 */
class FeatureExtractor {
  /**
   * Extract normalized feature vector from market data
   * @param {Object} params - Input parameters
   * @returns {Array} Feature vector for pattern matching
   */
  static extract({
    candles,
    trend,
    macd,
    signal,
    rsi,
    lastTrade = null,
    useOptimizedIndicators = true
  }) {
    // FIX 2026-02-19: Never return empty array - always generate features
    // Empty features breaks pattern learning pipeline (outcomes never recorded)
    if (!candles || candles.length === 0) {
      // No candles at all - return default feature vector
      // [rsi, macdDelta, trend, bbWidth, vol, wickRatio, priceChange, volumeChange, lastDirection]
      return [0.5, 0, 0, 0.02, 0.01, 0.5, 0, 0, 0];
    }

    const latestCandle = candles[candles.length - 1];
    const previousCandle = candles.length > 1 ? candles[candles.length - 2] : latestCandle;

    // Use optimized indicators if available
    if (useOptimizedIndicators && typeof indicators !== 'undefined') {
      // Technical indicators (use provided values or calculate)
      const calculatedRsi = rsi || indicators.calculateRSI(candles);
      const calculatedMacd = typeof macd === 'number' ? macd : indicators.calculateMACD(candles).macdLine;
      const calculatedSignal = typeof signal === 'number' ? signal : indicators.calculateMACD(candles).signalLine;
      const calculatedTrend = trend || indicators.determineTrend(candles);

      // Bollinger data for volatility context
      const bb = indicators.calculateBollingerBands(candles);
      const bbWidth = bb.width || 0;

      // Volatility measure - FIX 2026-02-26 P1: Normalize to 0-1 scale
      // Raw stddev ~0.02 for normal, ~0.05 for high vol. Cap at 1.0
      const rawVol = indicators.calculateVolatility(candles);
      const vol = Math.min(rawVol / 0.05, 1.0);  // Normalize: 0.05 stddev = 1.0

      // Normalize and encode features
      const rsiNormalized = calculatedRsi / 100;  // Scale to 0-1
      const macdDelta = calculatedMacd - calculatedSignal;
      // CHANGE 614: Fix case-sensitivity
      const trendEncoded = calculatedTrend?.toLowerCase?.() === 'uptrend' ? 1 : calculatedTrend?.toLowerCase?.() === 'downtrend' ? -1 : 0;

      // Candle pattern features
      const bodySize = Math.abs(c(latestCandle) - o(latestCandle)) / c(latestCandle);
      const wickRatio = h(latestCandle) !== l(latestCandle)
        ? (Math.abs(c(latestCandle) - o(latestCandle)) / (h(latestCandle) - l(latestCandle)))
        : 0.5;

      // Price momentum
      const priceChange = previousCandle && c(previousCandle) > 0
        ? (c(latestCandle) - c(previousCandle)) / c(previousCandle)
        : 0;

      // Position context
      // CHANGE 614: Fix case-sensitivity
      const lastDirection = lastTrade?.direction?.toLowerCase?.() === 'buy' ? 1 : lastTrade?.direction?.toLowerCase?.() === 'sell' ? -1 : 0;

      // Volume features if available
      const volumeChange = v(latestCandle) && v(previousCandle) && v(previousCandle) > 0
        ? v(latestCandle) / v(previousCandle) - 1
        : 0;

      // Return comprehensive feature vector
      return [
        rsiNormalized,           // Normalized RSI (0-1)
        macdDelta,               // MACD line - Signal line
        trendEncoded,            // -1, 0, 1 for down/side/up
        bbWidth,                 // Bollinger band width (relative)
        vol,                     // Market volatility
        wickRatio,               // Candle body to range ratio
        priceChange * 100,       // Price change percentage
        volumeChange,            // Volume momentum
        lastDirection            // Position context
      ];
    }
    // Fallback to basic calculation if optimized indicators not available
    else {
      // Use provided values or defaults
      const rsiValue = rsi || 50;
      const macdValue = macd || 0;
      const signalValue = signal || 0;
      const trendValue = trend || 'sideways';

      // Simple feature vector with provided data
      return [
        rsiValue / 100,                                              // Normalized RSI
        macdValue - signalValue,                                     // MACD delta
        // CHANGE 614: Fix case-sensitivity
        trendValue?.toLowerCase?.() === 'uptrend' ? 1 : trendValue?.toLowerCase?.() === 'downtrend' ? -1 : 0,  // Trend
        0.02,                                                        // Default BB width
        0.01,                                                        // Default volatility
        0.5,                                                         // Default wick ratio
        0,                                                           // No price change
        0,                                                           // No volume change
        // CHANGE 614: Fix case-sensitivity
        lastTrade?.direction?.toLowerCase?.() === 'buy' ? 1 : lastTrade?.direction?.toLowerCase?.() === 'sell' ? -1 : 0  // Position
      ];
    }
  }

  /**
   * Extract multi-timeframe features
   * @param {Object} params - Multi-timeframe parameters
   * @returns {Array} Combined feature vector
   */
  static extractMultiTimeframe({
    candles1m,
    candles5m,
    candles15m,
    trend,
    macd,
    signal,
    rsi,
    lastTrade
  }) {
    // Extract features from each timeframe
    const features1m = this.extract({
      candles: candles1m,
      trend,
      macd,
      signal,
      rsi,
      lastTrade
    });

    const features5m = candles5m?.length >= 30 ? this.extract({
      candles: candles5m,
      trend,
      macd,
      signal,
      rsi,
      lastTrade
    }) : [];

    const features15m = candles15m?.length >= 30 ? this.extract({
      candles: candles15m,
      trend,
      macd,
      signal,
      rsi,
      lastTrade
    }) : [];

    // Combine features with precedence to higher timeframes for trend/context
    const combinedFeatures = [...features1m];

    // Add multi-timeframe alignment features if available
    if (features5m.length > 0 && features15m.length > 0) {
      // Calculate trend alignment across timeframes
      const trendAlign = Math.sign(features1m[2]) + Math.sign(features5m[2]) + Math.sign(features15m[2]);

      // Add alignment feature to vector
      combinedFeatures.push(trendAlign / 3); // Normalized to -1 to 1
    }

    return combinedFeatures;
  }
}


// CHANGE 2026-03-18: PatternMemorySystem class removed - replaced by UnifiedPatternMemory


/**
 * Enhanced Pattern Checker with advanced analysis and prediction
 */
class EnhancedPatternChecker {
  /**
   * Create a new pattern checker
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.options = {
      similarityThreshold: 0.75, // Slightly more lenient similarity matching
      minTradeHistory: 2,        // Lower minimum history for faster adaptation
      confidenceThreshold: 0.45, // More aggressive confidence threshold
      ...options
    };

    // Initialize pattern memory system - uses UnifiedPatternMemory singleton
    // CHANGE 2026-03-18: Replaced PatternMemorySystem with UnifiedPatternMemory
    // One store for pipeline writes + TRAI reads. DTW and exact matching available.
    this.memory = getUnifiedPatternMemory();

    // Stats
    this.stats = {
      evaluations: 0,
      highConfidenceSignals: 0,
      tradeResults: 0
    };

    // Store last evaluated features for reference
    this.lastEvaluatedFeatures = null;
  }

  /**
   * Analyze patterns from market data - MAIN METHOD FOR BOT
   * @param {Object} marketData - Market data object
   * @returns {Array} Array of detected patterns
   */
  analyzePatterns(marketData) {
    // FIX 2026-02-24: Validate marketData input (Phase 12 fuzzing)
    if (!marketData || typeof marketData !== 'object') {
      return [{ name: 'Invalid Input', confidence: 0, direction: 'hold' }];
    }

    const patterns = [];

    // Extract features from market data
    const features = FeatureExtractor.extract({
      candles: marketData.candles || [],
      trend: marketData.trend || 'sideways',
      macd: marketData.macd || 0,
      signal: marketData.macdSignal || 0,
      rsi: marketData.rsi,
      volume: marketData.volume || 1000000
    });

    // Evaluate the pattern
    const result = this.evaluatePattern(features);

    // CRITICAL FIX: Always create pattern for learning, even with 0 confidence
    // The bot needs to see patterns to learn from them!
    patterns.push({
      name: result?.bestMatch?.pattern || 'Learning Pattern',
      confidence: result?.confidence || 0.1,  // Force minimum 0.1 for new patterns
      direction: result?.direction || 'neutral',
      signature: JSON.stringify(features).substring(0, 50),
      features: features,
      quality: result?.quality || 0.3,
      isNew: true,  // Always flag as new for learning
      reason: result?.reason || 'New pattern being learned'
    });

    return patterns;
  }

  /**
   * Get pattern history - REQUIRED BY BOT
   * @param {String} signature - Pattern signature
   * @returns {Object} Pattern history data
   */
  getPatternHistory(signature) {
    // Search memory for similar patterns
    const similar = this.memory.findSimilarPatterns({ signature }, 0.9);
    if (similar && similar.length > 0) {
      const stats = similar[0];

      // Apply exponential time decay to success rate
      const currentTime = Date.now();
      let decayedSuccessRate = stats.successRate || 0;

      // If pattern has results with timestamps, apply time-weighted decay
      if (stats.results && stats.results.length > 0) {
        let weightedWins = 0;
        let totalWeight = 0;

        stats.results.forEach(result => {
          const ageHours = (currentTime - result.timestamp) / (1000 * 60 * 60);
          const timeWeight = Math.exp(-ageHours * 0.01); // Same decay rate as applyTimeDecay

          if (result.success) {
            weightedWins += timeWeight;
          }
          totalWeight += timeWeight;
        });

        if (totalWeight > 0) {
          decayedSuccessRate = weightedWins / totalWeight;
        }
      } else {
        // Fallback: apply simple decay based on pattern age
        const patternAge = similar[0].lastSeen ? (currentTime - similar[0].lastSeen) / (1000 * 60 * 60) : 0;
        const decayMultiplier = Math.exp(-patternAge * 0.01);
        decayedSuccessRate = (stats.successRate || 0) * Math.max(0.1, decayMultiplier);
      }

      return {
        timesSeen: stats.seenCount || 0,
        wins: stats.successCount || 0,
        successRate: decayedSuccessRate,
        originalSuccessRate: stats.successRate || 0, // Keep original for comparison
        decayApplied: true
      };
    }
    return null;
  }

  /**
   * Record pattern result - REQUIRED BY BOT
   * @param {String} signature - Pattern signature
   * @param {Object} result - Trade result
   */
  recordPatternResult(featuresOrSignature, result) {
    // CHANGE 659: Features array required - strict validation
    if (!Array.isArray(featuresOrSignature)) {
      console.error('âŒ recordPatternResult: Expected features array, got:', typeof featuresOrSignature);
      console.error('   Value received:', featuresOrSignature);
      console.error('   Stack trace:', new Error().stack);
      return false;
    }

    // Skip empty arrays (no features to record)
    if (featuresOrSignature.length === 0) {
      console.warn('âš ï¸ recordPatternResult: Empty features array, skipping');
      return false;
    }
    
    this.memory.recordPattern(featuresOrSignature, result);
    this.stats.tradeResults++;
    // CHANGE 2026-01-21: Removed aggressive saveToDisk() call
    // PatternMemorySystem already has 5-minute periodic saves (line 234-236)
    // Calling saveToDisk on every recordPatternResult caused massive I/O spam
    // DEBUG 2026-02-02: Confirm pattern was recorded
    // BACKTEST_FAST: Skip verbose logging
    if (process.env.BACKTEST_FAST !== 'true') {
      console.log(`✅ Pattern RECORDED: features[${featuresOrSignature.length}], pnl=${result?.pnl?.toFixed(2) || '?'}%, total=${this.stats.tradeResults}`);
    }
    return true;
  }

  /**
   * Apply exponential falloff to pattern confidence based on time
   * @param {Object} pattern - Pattern data with lastSeen timestamp
   * @param {number} currentTime - Current timestamp
   * @returns {number} Time decay multiplier (0-1)
   */
  applyTimeDecay(pattern, currentTime = Date.now()) {
    if (!pattern.lastSeen) return 1.0; // No decay for patterns without timestamp

    const ageHours = (currentTime - pattern.lastSeen) / (1000 * 60 * 60); // Age in hours
    const decayRate = 0.01; // Exponential decay rate (adjustable)

    // Exponential falloff: newer patterns retain more confidence
    // After 24 hours: ~90% confidence retained
    // After 168 hours (1 week): ~50% confidence retained
    // After 720 hours (1 month): ~10% confidence retained
    const decayMultiplier = Math.exp(-ageHours * decayRate);

    return Math.max(0.1, decayMultiplier); // Minimum 10% to prevent complete decay
  }

  /**
   * Evaluate a pattern for trading decision
   * @param {Array} features - Feature vector
   * @param {Object} options - Evaluation options
   * @returns {Object} Evaluation result with confidence and direction
   */
  evaluatePattern(features, options = {}) {
    this.stats.evaluations++;
    this.lastEvaluatedFeatures = features;

    // Merge default options with provided options
    const evalOptions = {
      ...this.options,
      ...options
    };

    // ðŸš€ SCALPER FAST PATH: Skip complex similarity matching for speed
    if (evalOptions.scalperMode || evalOptions.fastPath) {
      return this.evaluatePatternFastPath(features, evalOptions);
    }

    // Delegate to memory system for evaluation
    const evaluation = this.memory.evaluatePattern(features, evalOptions);

    // Track high confidence signals
    if (evaluation.confidence >= evalOptions.confidenceThreshold) {
      this.stats.highConfidenceSignals++;
    }

    return evaluation;
  }

  /**
   * ðŸš€ SCALPER FAST PATH: Lightning-fast pattern evaluation for high-frequency trading
   * @param {Array} features - Feature vector
   * @param {Object} options - Evaluation options
   * @returns {Object} Fast evaluation result
   */
  evaluatePatternFastPath(features, options = {}) {
    // Check for exact match first (O(1) lookup)
    const exactStats = this.memory.getPatternStats(features);

    if (exactStats && exactStats.timesSeen >= 2) { // Lower threshold for speed
      const winRate = exactStats.wins / exactStats.timesSeen;
      const avgPnL = exactStats.totalPnL / exactStats.timesSeen;

      // CHANGE 614: Fix case-sensitivity
      const direction = (avgPnL > 0 ? 'buy' : avgPnL < 0 ? 'sell' : 'hold').toLowerCase();

      // Fast confidence calculation
      let confidence = winRate;

      // Quick recency bonus (only last 3 results)
      if (exactStats.results.length > 0) {
        const recentResults = exactStats.results.slice(-3);
        const recentSuccesses = recentResults.filter(r => r.success).length;
        const recentWinRate = recentSuccesses / recentResults.length;
        confidence = (winRate * 0.7) + (recentWinRate * 0.3);
      }

      this.stats.highConfidenceSignals++;

      return {
        confidence: confidence >= options.confidenceThreshold ? confidence : 0,
        direction,
        exactMatch: true,
        timesSeen: exactStats.timesSeen,
        winRate,
        avgPnL,
        reason: `FAST: Exact match, ${exactStats.timesSeen} trades, ${(winRate * 100).toFixed(1)}% WR`,
        fastPath: true
      };
    }

    // No exact match - return minimal confidence for speed
    return {
      confidence: 0.1, // Very low confidence for new patterns in scalper mode
      // CHANGE 614: Fix case-sensitivity
      direction: 'hold'.toLowerCase(),
      exactMatch: false,
      timesSeen: 0,
      reason: "FAST: No exact pattern match, minimal confidence for speed",
      fastPath: true
    };
  }

  /**
   * Record a trade result for learning
   * @param {Array} features - Feature vector when decision was made
   * @param {Object} result - Trade result
   * @returns {boolean} Success
   */
  recordTradeResult(features, result) {
    this.stats.tradeResults++;
    return this.memory.recordPattern(features, result);
  }

  /**
   * Find similar patterns to the current market state
   * @param {Array} features - Feature vector
   * @param {number} threshold - Similarity threshold
   * @param {number} limit - Maximum number of results
   * @returns {Array} Similar patterns
   */
  findSimilarPatterns(features, threshold = 0.8, limit = 5) {
    return this.memory.findSimilarPatterns(features, threshold, limit);
  }

  /**
   * Get memory size statistics
   * @returns {Object} Memory statistics
   */
  getMemoryStats() {
    return {
      ...this.memory.getStats(),
      evaluations: this.stats.evaluations,
      highConfidenceSignals: this.stats.highConfidenceSignals,
      tradeResults: this.stats.tradeResults,
      signalRatio: this.stats.evaluations > 0 ?
        (this.stats.highConfidenceSignals / this.stats.evaluations) : 0
    };
  }

  /**
   * Clean up resources
   */
  // FIX 2026-02-19: Make async to await memory cleanup
  async cleanup() {
    await this.memory.cleanup();
  }
}

/**
 * Track pattern trade result
 * @param {string} patternId - Pattern identifier
 * @param {number} entryTime - Entry timestamp
 * @param {number} exitTime - Exit timestamp
 * @param {number} pnl - Profit and loss
 * @param {number} confidence - Trade confidence score
 */
function trackPatternResult(patternId, entryTime, exitTime, pnl, confidence) {
  // Create pattern entry if it doesn't exist
  if (!pattern_performance[patternId]) {
    pattern_performance[patternId] = {
      id: patternId,
      name: patternId.split('_')[0], // Extract name from ID
      trades: [],
      stats: {
        winRate: 0,
        totalPnL: 0,
        averagePnL: 0
      }
    };
    patternCount++;
  }

  // Add the trade to the pattern
  pattern_performance[patternId].trades.push({
    entryTime,
    exitTime,
    pnl,
    confidence,
    holdTime: (exitTime - entryTime) / (60 * 1000) // Hold time in minutes
  });

  // Update stats
  const pattern = pattern_performance[patternId];
  const trades = pattern.trades;

  // Calculate win rate
  const winCount = trades.filter(t => t.pnl > 0).length;
  pattern.stats.winRate = winCount / trades.length;

  // Calculate total PnL
  pattern.stats.totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);

  // Calculate average PnL
  pattern.stats.averagePnL = pattern.stats.totalPnL / trades.length;

  // Log result for marketing
  const isWin = pnl > 0;
  console.log(`${isWin ? 'ðŸ’°' : 'ðŸ“‰'} Pattern ${patternId} trade result: ${pnl.toFixed(2)}`);

  return true;
}

// Export the enhanced pattern recognition components
// CHANGE 2026-03-18: PatternMemorySystem removed - replaced by UnifiedPatternMemory
module.exports = {
  EnhancedPatternChecker,
  FeatureExtractor,
  pattern_performance,
  trackPatternResult
};
