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

/**
 * Pattern memory system with persistent storage and similarity matching
 */
class PatternMemorySystem {
  /**
   * Create a new pattern memory system
   * @param {Object} options - Memory configuration
   */
  constructor(options = {}) {
    // FIX 2025-12-27: Use mode-based pattern memory files
    // FIX 2026-02-11: Check BACKTEST_MODE first (was being overridden by PAPER_TRADING)
    const mode = process.env.BACKTEST_MODE === 'true' ? 'backtest' :
                 process.env.PAPER_TRADING === 'true' ? 'paper' : 'live';
    const memoryFileName = `pattern-memory.${mode}.json`;
    console.log(`ðŸ“ Pattern Memory: Using ${memoryFileName} (mode: ${mode})`);

    // EMFILE FIX: Disable disk persistence in parallel backtest (prevents too many open files on Windows)
    const skipDiskSave = process.env.BACKTEST_NO_PATTERN_SAVE === 'true';

    this.options = {
      memoryFile: path.join(process.cwd(), 'data', memoryFileName),
      persistToDisk: !skipDiskSave,
      maxPatterns: 10000,
      featureWeights: [
        0.25,  // RSI - 25% weight
        0.15,  // MACD delta - 15% weight
        0.15,  // Trend - 15% weight
        0.10,  // Bollinger width - 10% weight
        0.05,  // Volatility - 5% weight
        0.05,  // Wick ratio - 5% weight
        0.15,  // Price momentum - 15% weight
        0.05,  // Volume change - 5% weight
        0.05   // Position context - 5% weight
      ],
      ...options
    };

    // Initialize memory store
    if (!this.memory) {
      this.memory = {};
    }
    this.patternCount = 0;
    this.lastSaveTime = Date.now();
    
    // CHANGE 2025-12-12: Save queue for atomic writes
    this.saving = false;
    this.saveQueue = [];

    // Create data directory if it doesn't exist
    const dataDir = path.dirname(this.options.memoryFile);
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (err) {
        console.error(`Failed to create directory ${dataDir}:`, err);
      }
    }

    // Load existing memory from disk if available
    this.loadFromDisk();

    // Set up periodic saving
    if (this.options.persistToDisk) {
      this.saveInterval = setInterval(() => {
        this.saveToDisk();
      }, 5 * 60 * 1000); // Save every 5 minutes
    }
  }

  /**
   * Load pattern memory from disk
   */
  loadFromDisk() {
    if (!this.options.persistToDisk) return;

    try {
      if (fs.existsSync(this.options.memoryFile)) {
        const data = fs.readFileSync(this.options.memoryFile, 'utf8');
        const parsed = JSON.parse(data);

        this.memory = parsed.patterns || {};
        this.patternCount = parsed.count || Object.keys(this.memory).length;

        console.log(`Loaded ${this.patternCount} patterns from memory file`);

        // Only initialize seed patterns if BOTH memory and count are empty
        // CRITICAL FIX: Don't wipe patterns just because count is 0
        if (Object.keys(this.memory).length === 0 && this.patternCount === 0) {
          console.log('âš ï¸ Pattern memory truly empty, initializing fresh');
          this.initializeSeedPatterns();
        } else {
          console.log(`âœ… Keeping existing ${Object.keys(this.memory).length} patterns in memory`);
        }
      } else {
        console.log('No pattern memory file found, initializing with seed patterns');
        this.initializeSeedPatterns();
      }
    } catch (err) {
      console.error('Error loading pattern memory:', err);
      console.log('Initializing with seed patterns due to error');
      this.initializeSeedPatterns();
    }
  }

  /**
   * Initialize memory with seed patterns for learning bootstrapping
   */
  initializeSeedPatterns() {
  console.log('ðŸ§  Initializing minimum required patterns for bot operation');

  // Keep existing patterns but ensure we have at least one base pattern
  if (!this.memory) {
    this.memory = {};
  }

  // FIX 2026-02-26 P6: Removed BASE_PATTERN seed - wrong format, never matched
  // The old seed used { type, confidence, occurrences } but real patterns use
  // { timesSeen, wins, losses, totalPnL, results[] }. It was invisible to evaluation.
  if (Object.keys(this.memory).length === 0) {
    console.log('📊 Starting with empty pattern memory (will learn from trades)');
    this.patternCount = 0;
  } else {
    console.log(`âœ… Keeping ${Object.keys(this.memory).length} existing patterns`);
  }
  }

  /**
   * Save pattern memory to disk
   */
  async saveToDisk() {
    if (!this.options.persistToDisk) return;
    // FIX 2026-03-14: Allow backtest saves to pattern-memory.backtest.json
    // Was skipping entirely, now saves to separate file (set in constructor line 222)

    // CHANGE 2025-12-12: Prevent concurrent writes with save queue
    if (this.saving) {
      return new Promise(resolve => this.saveQueue.push(resolve));
    }
    this.saving = true;

    try {
      const data = JSON.stringify({
        count: this.patternCount,
        patterns: this.memory,
        timestamp: new Date().toISOString()
      });

      // CHANGE 2025-12-12: Use atomic file write (tmp + rename)
      const tmpFile = this.options.memoryFile + '.tmp';
      await fs.promises.writeFile(tmpFile, data, 'utf8');
      await fs.promises.rename(tmpFile, this.options.memoryFile);
      
      this.lastSaveTime = Date.now();
      console.log(`Saved ${this.patternCount} patterns to memory file`);
    } catch (err) {
      console.error('Error saving pattern memory:', err);
    } finally {
      this.saving = false;
      // CHANGE 2025-12-12: Process queued saves
      const hadQueue = this.saveQueue.length > 0;
      const queue = [...this.saveQueue];
      this.saveQueue = [];
      queue.forEach(resolve => resolve());
      
      // If there were queued saves, execute one more save to get all pending changes
      if (hadQueue) {
        setImmediate(() => this.saveToDisk());
      }
    }
  }

  /**
   * Generate pattern key from features with corruption protection
   * @param {Array} features - Feature vector
   * @returns {string} Pattern key
   */
  getPatternKey(features) {
    if (!features || !Array.isArray(features) || features.length === 0) {
      return '';
    }

    // ðŸ›¡ï¸ CORRUPTION PROTECTION: Validate features array before processing
    if (features.length > 50) {
      console.warn('âš ï¸ Feature vector too large, truncating to prevent corruption');
      features = features.slice(0, 50);
    }

    try {
      // ðŸ›¡ï¸ SAFE PROCESSING: Validate each feature and handle edge cases
      const safeFeatures = features.map((n, index) => {
        // Handle various input types safely
        if (typeof n === 'number' && isFinite(n)) {
          // Clamp values to prevent extreme numbers causing issues
          const clampedValue = Math.max(-999999, Math.min(999999, n));
          return clampedValue.toFixed(2);
        } else if (typeof n === 'string' && !isNaN(parseFloat(n))) {
          const parsedValue = parseFloat(n);
          if (isFinite(parsedValue)) {
            const clampedValue = Math.max(-999999, Math.min(999999, parsedValue));
            return clampedValue.toFixed(2);
          }
        }

        // Default fallback for invalid values
        console.warn(`âš ï¸ Invalid feature at index ${index}:`, n, 'defaulting to 0.00');
        return '0.00';
      });

      // ðŸ›¡ï¸ LENGTH VALIDATION: Ensure result isn't too long
      const result = safeFeatures.join(',');
      if (result.length > 1000) {
        console.warn('âš ï¸ Pattern key too long, truncating to prevent memory issues');
        return safeFeatures.slice(0, 20).join(','); // Truncate to safe length
      }

      return result;

    } catch (error) {
      console.error('ðŸš¨ Pattern key generation error:', error);
      console.error('ðŸš¨ Features causing error:', features);

      // Emergency fallback - return safe default
      return Array(Math.min(features.length, 20)).fill('0.00').join(',');
    }
  }

  /**
   * Record a pattern and its result
   * @param {Array} features - Feature vector
   * @param {Object} result - Trade result
   * @returns {boolean} Success
   */
  recordPattern(features, result) {
    if (!features || !Array.isArray(features) || features.length === 0 || !result) {
      return false;
    }

    const key = this.getPatternKey(features);
        if (!key) return null;
    if (!key) return false;

    // Create or update pattern entry
    const entry = this.memory[key] || {
      timesSeen: 0,
      totalPnL: 0,
      wins: 0,
      losses: 0,
      results: []
    };

    // FIX 2026-02-25: Only increment timesSeen for OUTCOMES, not observations
    // Previously: timesSeen incremented for both entry (null) and exit (number)
    // This caused win rate = wins/timesSeen to be halved (2 increments per trade, 1 win)
    // Now: timesSeen only incremented for outcomes, so win rate is accurate
    if (typeof result.pnl === 'number') {
      entry.timesSeen += 1;  // Only count completed trades
      entry.totalPnL += result.pnl;
      if (result.pnl > 0) {
        entry.wins += 1;
      } else if (result.pnl < 0) {
        entry.losses += 1;
      }

      // Add result to history only for outcomes (keep only last 10)
      entry.results.push({
        timestamp: result.timestamp || Date.now(),
        pnl: result.pnl,
        success: result.pnl > 0
      });

      if (entry.results.length > 10) {
        entry.results = entry.results.slice(-10);
      }
    }

    // Store pattern
    this.memory[key] = entry;

    // Increment count if this is a new pattern
    if (entry.timesSeen === 1) {
      this.patternCount++;
    }

    // Check if we need to prune memory
    if (this.patternCount > this.options.maxPatterns) {
      this.pruneMemory();
    }

    // ðŸš€ SCALPER OPTIMIZATION: Skip disk saves during active scalping for speed
    const timeSinceLastSave = Date.now() - this.lastSaveTime;
    const isScalperActive = this.scalperModeActive || false; // Will be set by trading brain

    if (this.options.persistToDisk && timeSinceLastSave > 5 * 60 * 1000 && !isScalperActive) {
      this.saveToDisk();
    } else if (isScalperActive && timeSinceLastSave > 30 * 60 * 1000) {
      // Save every 30 minutes during scalping instead of 5 minutes
      this.saveToDisk();
    }

    return true;
  }

  /**
   * Get statistics for a specific pattern
   * @param {Array} features - Feature vector
   * @returns {Object|null} Pattern statistics
   */
  getPatternStats(features) {
    if (!features || !Array.isArray(features) || features.length === 0) {
      return null;
    }

    const key = this.getPatternKey(features);
    return this.memory[key] || null;
  }

  /**
   * Calculate similarity between two feature vectors using weighted euclidean distance
   * @param {Array} features1 - First feature vector
   * @param {Array} features2 - Second feature vector
   * @returns {number} Similarity score (0-1, higher is more similar)
   */
  calculateSimilarity(features1, features2) {
    if (!features1 || !features2 || features1.length !== features2.length) {
      return 0;
    }

    try {
      let weightedSum = 0;
      let totalWeight = 0;

      for (let i = 0; i < features1.length; i++) {
        const weight = this.options.featureWeights[i] || 0.1;
        const diff = features1[i] - features2[i];
        weightedSum += weight * (diff * diff);
        totalWeight += weight;
      }

      // Convert to similarity (lower distance = higher similarity)
      const distance = Math.sqrt(weightedSum / totalWeight);
      const similarity = Math.max(0, 1 - (distance / 2)); // Normalize to 0-1

      return similarity;
    } catch (error) {
      console.error('Error calculating similarity:', error);
      return 0;
    }
  }

  /**
   * Find similar patterns to the given features
   * @param {Array} features - Feature vector to match
   * @param {number} threshold - Similarity threshold (0-1)
   * @param {number} limit - Maximum number of results
   * @returns {Array} Similar patterns with similarity scores
   */
  findSimilarPatterns(features, threshold = 0.8, limit = 5) {
    // FIX 2026-02-24: Validate features input (Phase 12 fuzzing)
    if (!features || !Array.isArray(features) || features.length === 0) {
      return [];
    }

    const results = [];

    // Check for exact match first
    const exactKey = this.getPatternKey(features);
    if (exactKey && this.memory[exactKey]) {
      results.push({
        key: exactKey,
        similarity: 1.0,
        stats: this.memory[exactKey]
      });

      if (limit === 1) {
        return results;
      }
    }

    // Search for similar patterns
    // Optimization: Convert all keys up front
    const patterns = Object.entries(this.memory).map(([key, stats]) => {
      return {
        key,
        features: key.split(',').map(Number),
        stats
      };
    });

    // Filter by feature length first (quick elimination)
    const potentialMatches = patterns.filter(p =>
      p.key !== exactKey && // Skip exact match we already found
      p.features.length === features.length
    );

    // Calculate similarity for potential matches
    for (const pattern of potentialMatches) {
      const similarity = this.calculateSimilarity(features, pattern.features);

      if (similarity >= threshold) {
        results.push({
          key: pattern.key,
          similarity,
          stats: pattern.stats
        });
      }
    }

    // Sort by similarity (descending) and limit results
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Find similar patterns using Dynamic Time Warping (handles time-stretched patterns)
   * DTW can match patterns that are "same shape, different speed" - e.g., fast vs slow MA retests
   * @param {Array} features - Feature vector to match
   * @param {number} threshold - Similarity threshold (0-1), default 0.65
   * @param {number} limit - Maximum number of results
   * @returns {Array} Similar patterns with DTW similarity scores
   */
  findSimilarPatternsDTW(features, threshold = 0.62, limit = 5) {
    if (!features || !Array.isArray(features) || features.length === 0) {
      return [];
    }

    const bestMatch = findBestDTWMatch(features, this.memory);

    // Log DTW match for debugging
    if (bestMatch) {
      console.log(`[DTW 15m] Match: ${bestMatch.similarity} similarity, ${bestMatch.patternData.timesSeen} trades`);
    }

    if (bestMatch) {
      return [{
        key: bestMatch.signature,
        similarity: bestMatch.similarity,
        stats: bestMatch.patternData,
        matchType: 'dtw',
        distance: bestMatch.distance
      }];
    }

    return [];
  }

  /**
   * Evaluate a pattern and determine its trading potential
   * @param {Array} features - Feature vector
   * @param {Object} options - Evaluation options
   * @returns {Object} Evaluation result
   */
  evaluatePattern(features, options = {}) {
    // FIX 2026-02-24: Validate features input (Phase 12 fuzzing)
    if (!features || !Array.isArray(features) || features.length === 0) {
      return { confidence: 0, direction: 'hold', exactMatch: false, timesSeen: 0, reason: 'Invalid features' };
    }

    const opts = {
      similarityThreshold: 0.8,
      // FIX 2026-02-26 P2: Raised from 1 to 3. Single-sample win rates cause +25% noise.
      // A pattern with 1 win = 100% WR → +25% confidence. Then 1 loss → 50% WR → 0%.
      // Need at least 3 samples for statistical relevance.
      minimumMatches: 3,
      // REFACTOR 2026-02-19: Lowered from 0.6 to 0.2. At 60% threshold, even a pattern
      // with 1 win / 2 seen (50% win rate) returned confidence=0. New patterns need room
      // to grow. Low confidence = low influence, but at least non-zero.
      confidenceThreshold: 0.2,
      recencyBonus: true,
      ...options
    };

    // Check for exact match first
    const exactStats = this.getPatternStats(features);

    if (exactStats && exactStats.timesSeen >= opts.minimumMatches) {
      const winRate = exactStats.wins / exactStats.timesSeen;
      const avgPnL = exactStats.totalPnL / exactStats.timesSeen;

      // CHANGE 614: Fix case-sensitivity
      const direction = (avgPnL > 0 ? 'buy' : avgPnL < 0 ? 'sell' : 'hold').toLowerCase();
      let confidence = winRate;

      // Apply recency bonus if enabled (recent successful trades boost confidence)
      if (opts.recencyBonus && exactStats.results.length > 0) {
        const recentSuccesses = exactStats.results.filter(r => r.success).length;
        const recentWinRate = recentSuccesses / exactStats.results.length;

        // Blend overall win rate with recent win rate
        confidence = (winRate * 0.7) + (recentWinRate * 0.3);
      }

      return {
        confidence: confidence >= opts.confidenceThreshold ? confidence : 0,
        direction,
        exactMatch: true,
        timesSeen: exactStats.timesSeen,
        winRate,
        avgPnL,
        reason: `Exact pattern match with ${exactStats.timesSeen} occurrences, ${(winRate * 100).toFixed(1)}% win rate`
      };
    }

    // If no exact match, try DTW match first (catches time-stretched patterns like fast/slow MA retests)
    const dtwMatches = this.findSimilarPatternsDTW(features, 0.62, 1);
    if (dtwMatches.length > 0 && dtwMatches[0].stats.timesSeen >= opts.minimumMatches) {
      const dtwMatch = dtwMatches[0];
      const winRate = dtwMatch.stats.wins / dtwMatch.stats.timesSeen;
      const avgPnL = dtwMatch.stats.totalPnL / dtwMatch.stats.timesSeen;
      const direction = (avgPnL > 0 ? 'buy' : avgPnL < 0 ? 'sell' : 'hold').toLowerCase();

      console.log(`[DTW 15m] EVAL: ${(dtwMatch.similarity * 100).toFixed(1)}% similar, ${dtwMatch.stats.timesSeen} trades, ${(winRate * 100).toFixed(1)}% WR`);

      return {
        confidence: winRate >= opts.confidenceThreshold ? winRate * dtwMatch.similarity : 0,
        direction,
        exactMatch: false,
        dtwMatch: true,
        timesSeen: dtwMatch.stats.timesSeen,
        winRate,
        avgPnL,
        reason: `DTW match: ${(dtwMatch.similarity * 100).toFixed(1)}% similar, ${(winRate * 100).toFixed(1)}% win rate`
      };
    }

    // If no DTW match, fall back to Euclidean similarity search
    const similarPatterns = this.findSimilarPatterns(
      features,
      opts.similarityThreshold,
      10 // Get more matches to aggregate
    );

    // Filter to patterns with enough occurrences
    const validPatterns = similarPatterns.filter(p =>
      p.stats.timesSeen >= opts.minimumMatches
    );

    // If we don't have enough valid patterns, return low confidence
    if (validPatterns.length === 0) {
      return {
        confidence: 0,
        // CHANGE 614: Fix case-sensitivity
        direction: 'hold'.toLowerCase(),
        exactMatch: false,
        timesSeen: 0,
        reason: "No similar patterns with sufficient history"
      };
    }

    // Aggregate statistics from similar patterns, weighted by similarity
    let totalWeightedSeen = 0;
    let totalWeightedWins = 0;
    let totalWeightedPnL = 0;
    let totalWeight = 0;

    for (const pattern of validPatterns) {
      const weight = pattern.similarity;
      totalWeight += weight;

      totalWeightedSeen += pattern.stats.timesSeen * weight;
      totalWeightedWins += pattern.stats.wins * weight;
      totalWeightedPnL += pattern.stats.totalPnL * weight;
    }

    // Calculate weighted statistics
    const effectiveTimesSeen = totalWeightedSeen / totalWeight;
    const effectiveWinRate = totalWeightedWins / totalWeightedSeen;
    const effectiveAvgPnL = totalWeightedPnL / totalWeightedSeen;

    // Determine direction and confidence
    // CHANGE 614: Fix case-sensitivity
    const direction = (effectiveAvgPnL > 0 ? 'buy' : effectiveAvgPnL < 0 ? 'sell' : 'hold').toLowerCase();
    let confidence = effectiveWinRate;

    // Adjust confidence based on number of patterns and their similarity
    const similarityBonus = validPatterns.reduce((sum, p) => sum + p.similarity, 0) / validPatterns.length;
    confidence *= similarityBonus;

    // Apply minimum threshold
    confidence = confidence >= opts.confidenceThreshold ? confidence : 0;

    return {
      confidence,
      direction,
      exactMatch: false,
      similarPatterns: validPatterns.length,
      winRate: effectiveWinRate,
      avgPnL: effectiveAvgPnL,
      reason: `Similar pattern match: ${validPatterns.length} patterns, ${(effectiveWinRate * 100).toFixed(1)}% win rate`
    };
  }

  /**
   * Prune memory to stay within size limits
   * Removes least valuable patterns
   */
  pruneMemory() {
    console.log(`Memory size (${this.patternCount}) exceeded limit, pruning...`);

    // Convert to array for sorting
    const patterns = Object.entries(this.memory).map(([key, stats]) => {
      // Calculate pattern value based on times seen and recency
      // FIX: Check if results exists before accessing length
      const mostRecentTime = stats.results && stats.results.length > 0
        ? Math.max(...stats.results.map(r => r.timestamp))
        : 0;

      const recencyScore = mostRecentTime
        ? (Date.now() - mostRecentTime) / (30 * 24 * 60 * 60 * 1000) // Normalize to roughly 30 days
        : 1;

      const value = (stats.timesSeen / 10) * (1 - Math.min(recencyScore, 1));

      return { key, stats, value };
    });

    // Sort by value (ascending, so least valuable first)
    patterns.sort((a, b) => a.value - b.value);

    // Keep the most valuable patterns
    const keepCount = Math.floor(this.options.maxPatterns * 0.8); // Remove 20% of patterns
    const patternsToKeep = patterns.slice(-keepCount);

    // Create new memory with kept patterns
    const newMemory = {};
    for (const pattern of patternsToKeep) {
      newMemory[pattern.key] = pattern.stats;
    }

    this.memory = newMemory;
    this.patternCount = patternsToKeep.length;

    console.log(`Pruned memory to ${this.patternCount} patterns`);
  }

  /**
   * Clean up resources
   */
  // FIX 2026-02-19: Make async to ensure save completes before process exits
  async cleanup() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }

    await this.saveToDisk();
  }

  /**
   * Get memory statistics
   * @returns {Object} Memory stats
   */
  getStats() {
    // Aggregate wins/losses from all patterns
    let totalWins = 0;
    let totalLosses = 0;
    let totalTrades = 0;

    for (const key of Object.keys(this.memory)) {
      const entry = this.memory[key];
      if (entry && typeof entry.wins === 'number') {
        totalWins += entry.wins;
        totalLosses += entry.losses || 0;
        totalTrades += entry.timesSeen || 0;
      }
    }

    return {
      patterns: this.patternCount,
      lastSaved: new Date(this.lastSaveTime).toISOString(),
      totalWins,
      totalLosses,
      totalTrades,
      overallWinRate: totalTrades > 0 ? totalWins / totalTrades : 0
    };
  }

  /**
   * HEALTH CHECK: Verify pattern outcomes are being recorded correctly
   * FIX 2026-02-26: Added after P3 bug (RSI normalization mismatch) was found
   * This detects if outcomes are going to wrong pattern keys
   * @returns {Object} Health check result
   */
  healthCheck() {
    const stats = this.getStats();
    const patternCount = Object.keys(this.memory).length;

    // Skip check if no patterns yet
    if (patternCount === 0) {
      return { healthy: true, reason: 'No patterns yet (fresh start)', stats };
    }

    // Count patterns with outcomes vs observations only
    let patternsWithOutcomes = 0;
    let patternsObservationOnly = 0;

    for (const key of Object.keys(this.memory)) {
      const entry = this.memory[key];
      if (!entry) continue;

      const hasOutcome = (entry.wins || 0) + (entry.losses || 0) > 0;
      if (hasOutcome) {
        patternsWithOutcomes++;
      } else if (entry.timesSeen > 0) {
        patternsObservationOnly++;
      }
    }

    // Health check logic
    const outcomeRatio = patternCount > 0 ? patternsWithOutcomes / patternCount : 0;

    // If we have many patterns but zero outcomes, something is wrong
    if (patternCount >= 10 && patternsWithOutcomes === 0) {
      console.error('🚨 PATTERN HEALTH CHECK FAILED!');
      console.error(`   ${patternCount} patterns observed, but 0 have outcomes (wins/losses)`);
      console.error('   This suggests exit recording is broken (RSI normalization mismatch?)');
      console.error('   Check: run-empire-v2.js line 3152 should use rsi/100, not (rsi-50)/50');
      return {
        healthy: false,
        reason: `${patternCount} patterns but 0 outcomes - exit recording broken!`,
        patternsWithOutcomes,
        patternsObservationOnly,
        outcomeRatio,
        stats
      };
    }

    // Healthy
    if (patternsWithOutcomes > 0) {
      console.log(`✅ Pattern health OK: ${patternsWithOutcomes}/${patternCount} patterns have outcomes`);
    }

    return {
      healthy: true,
      reason: `${patternsWithOutcomes}/${patternCount} patterns have outcomes`,
      patternsWithOutcomes,
      patternsObservationOnly,
      outcomeRatio,
      stats
    };
  }
}

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

    // Initialize pattern memory system
    this.memory = new PatternMemorySystem(options.memory || {});

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
    console.log(`âœ… Pattern RECORDED: features[${featuresOrSignature.length}], pnl=${result?.pnl?.toFixed(2) || '?'}%, total=${this.stats.tradeResults}`);
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
module.exports = {
  EnhancedPatternChecker,
  FeatureExtractor,
  PatternMemorySystem,
  pattern_performance,
  trackPatternResult
};
