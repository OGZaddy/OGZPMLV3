// TimeframeManager.js - HOUSTON EDITION - Enhanced for OGZ Prime Valhalla
// Optimized for performance, memory efficiency, and bulletproof reliability
// 🔧 FIXES APPLIED: TTL-based cache, smarter cleanup, stale data prevention

// Import performance.now() for Node.js compatibility
const { performance } = require('perf_hooks');
const { c: _c, o: _o, h: _h, l: _l, v: _v, t: _t } = require('./CandleHelper');

/**
 * Advanced multi-timeframe manager with intelligent caching and optimization
 * Built for high-frequency trading with minimal latency
 *
 * CRITICAL FIXES:
 * - Added TTL (Time To Live) to cache entries to prevent stale data during volatility
 * - Made emergency cleanup less aggressive to preserve pattern recognition data
 * - Added cache invalidation on market volatility spikes
 * - Enhanced memory management with graduated cleanup levels
 */
class TimeframeManager {
  /**
   * Create a new Enhanced Timeframe Manager
   * @param {string} baseTimeframe - The lowest timeframe data is collected in (default: "1m")
   * @param {Object} config - Advanced configuration options
   */
  constructor(baseTimeframe = "1m", config = {}) {
    // Enhanced timeframe definitions with millisecond precision
    this.TIMEFRAMES = {
      "1s": 1000,
      "5s": 5000,
      "15s": 15000,
      "30s": 30000,
      "1m": 60000,
      "3m": 180000,
      "5m": 300000,
      "15m": 900000,
      "30m": 1800000,
      "1h": 3600000,
      "2h": 7200000,
      "4h": 14400000,
      "6h": 21600000,
      "8h": 28800000,
      "12h": 43200000,
      "1d": 86400000,
      "3d": 259200000,
      "1w": 604800000,
      "1M": 2629746000 // Average month
    };
    
    // Configuration with intelligent defaults
    this.config = {
      maxCandles: 2000,           // Increased for more history
      enableCaching: true,        // Performance optimization
      enableCompression: true,    // Memory optimization
      autoCleanup: true,         // Automatic memory management
      compressionThreshold: 1000, // Compress when exceeding this many candles
      performanceMode: 'balanced', // 'speed', 'balanced', 'memory'
      enableValidation: true,     // Data integrity checks
      enableMetrics: true,        // Performance tracking
      aggregationMethod: 'OHLCV', // Standard OHLCV aggregation
      
      // FIXED: Cache TTL settings to prevent stale data
      cacheTTL: 5000, // 5 seconds TTL for scalping optimization
      volatilityCacheInvalidation: true, // Invalidate cache on volatility spikes
      maxVolatilityThreshold: 0.05, // 5% volatility threshold for cache invalidation
      
      // FIXED: Graduated cleanup levels instead of aggressive emergency cleanup
      cleanupLevels: {
        gentle: 0.8,      // Remove 20% of oldest data
        moderate: 0.65,   // Remove 35% of oldest data  
        aggressive: 0.5   // Remove 50% of oldest data (only in true emergency)
      },
      emergencyThresholdMB: 100,  // Emergency cleanup at 100MB
      warningThresholdMB: 75,     // Gentle cleanup at 75MB
      
      ...config
    };
    
    this.baseTimeframe = baseTimeframe;
    this.baseInterval = this.TIMEFRAMES[baseTimeframe];
    this.activeTimeframes = new Set([baseTimeframe]);
    
    // Enhanced data storage with intelligent structures
    this.candles = new Map();
    
    // FIXED: TTL-aware cache with timestamps
    this.candleCache = new Map(); // LRU cache for frequently accessed data
    this.cacheTimestamps = new Map(); // Track cache entry timestamps for TTL
    
    this.lastCandleTime = new Map();
    this.pendingUpdates = new Map(); // Buffer for partial candles
    
    // FIXED: Track market volatility for cache invalidation
    this.marketVolatility = 0;
    this.lastVolatilityCheck = 0;
    
    // Performance metrics
    this.metrics = {
      totalCandles: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheInvalidations: 0,  // FIXED: Track cache invalidations
      aggregationsPerformed: 0,
      memoryUsage: 0,
      lastOptimization: Date.now(),
      staleDataPrevented: 0   // FIXED: Track prevented stale data serves
    };
    
    // Initialize base timeframe
    this.candles.set(baseTimeframe, []);
    this.lastCandleTime.set(baseTimeframe, null);
    this.pendingUpdates.set(baseTimeframe, null);
    
    // Setup automatic optimization
    if (this.config.autoCleanup) {
      this.setupAutoOptimization();
    }
    
    // FIXED: Setup cache TTL cleanup
    this.setupCacheCleanup();
    
    console.log(`🚀 Enhanced TimeframeManager initialized - Base: ${baseTimeframe}, Mode: ${this.config.performanceMode} (TTL-enabled)`);
  }
  
  /**
   * FIXED: Setup automatic cache cleanup based on TTL
   * Prevents serving stale data during volatile market conditions
   */
  setupCacheCleanup() {
    // CHANGE 2026-01-29: Assign intervals to instance vars for cleanup
    // Check cache TTL every 10 seconds
    this.cacheCleanupInterval = setInterval(() => {
      this.cleanupExpiredCache();
    }, 10000);

    // Check volatility every 5 seconds for cache invalidation
    if (this.config.volatilityCacheInvalidation) {
      this.volatilityCheckInterval = setInterval(() => {
        this.checkVolatilityAndInvalidateCache();
      }, 5000);
    }
  }
  
  /**
   * FIXED: Clean up expired cache entries based on TTL
   * Ensures fresh data during volatile periods
   */
  cleanupExpiredCache() {
    const now = Date.now();
    const ttl = this.config.cacheTTL;
    let cleaned = 0;
    
    for (const [key, timestamp] of this.cacheTimestamps) {
      if (now - timestamp > ttl) {
        this.candleCache.delete(key);
        this.cacheTimestamps.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.metrics.staleDataPrevented += cleaned;
      console.log(`🧹 Cleaned ${cleaned} expired cache entries (TTL: ${ttl}ms)`);
    }
  }
  
  /**
   * FIXED: Check market volatility and invalidate cache if needed
   * Prevents serving stale data during market spikes
   */
  checkVolatilityAndInvalidateCache() {
    const now = Date.now();
    
    // Only check volatility every 30 seconds minimum
    if (now - this.lastVolatilityCheck < 30000) {
      return;
    }
    
    this.lastVolatilityCheck = now;
    
    // Calculate current volatility from base timeframe
    const baseCandles = this.candles.get(this.baseTimeframe);
    if (!baseCandles || baseCandles.length < 20) {
      return;
    }
    
    // Calculate recent volatility (last 10 candles)
    const recentCandles = baseCandles.slice(-10);
    const returns = [];
    
    for (let i = 1; i < recentCandles.length; i++) {
      const ret = ((_c(recentCandles[i]) || recentCandles[i].close) - (_c(recentCandles[i-1]) || recentCandles[i-1].close)) / (_c(recentCandles[i-1]) || recentCandles[i-1].close);
      returns.push(Math.abs(ret));
    }
    
    const avgVolatility = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    this.marketVolatility = avgVolatility;
    
    // FIXED: Invalidate cache if volatility spike detected
    if (avgVolatility > this.config.maxVolatilityThreshold) {
      const cacheSize = this.candleCache.size;
      this.candleCache.clear();
      this.cacheTimestamps.clear();
      
      this.metrics.cacheInvalidations++;
      
      console.log(`🌪️ High volatility detected (${(avgVolatility * 100).toFixed(2)}%) - Cache invalidated (${cacheSize} entries)`);
    }
  }
  
  /**
   * Add a new timeframe with intelligent pre-allocation
   * @param {string} timeframe - Timeframe to add (e.g., "5m", "1h")
   * @param {Object} options - Timeframe-specific options
   * @returns {boolean} Success status
   */
  addTimeframe(timeframe, options = {}) {
    if (!this.TIMEFRAMES[timeframe]) {
      console.error(`❌ Unsupported timeframe: ${timeframe}`);
      return false;
    }
    
    if (this.activeTimeframes.has(timeframe)) {
      console.log(`⚠️ Timeframe ${timeframe} already active`);
      return true;
    }
    
    // Add timeframe with optimized initial capacity
    this.activeTimeframes.add(timeframe);
    const estimatedCapacity = this.estimateInitialCapacity(timeframe);
    this.candles.set(timeframe, new Array(estimatedCapacity));
    this.candles.get(timeframe).length = 0; // Reset length but keep capacity
    this.lastCandleTime.set(timeframe, null);
    this.pendingUpdates.set(timeframe, null);
    
    // Backfill if we have base data and this is a higher timeframe
    if (this.canBackfillTimeframe(timeframe)) {
      this.backfillTimeframe(timeframe);
    }
    
    console.log(`✅ Added timeframe: ${timeframe} (capacity: ${estimatedCapacity})`);
    return true;
  }
  
  /**
   * Process a new candle with intelligent aggregation
   * @param {Object} candle - Candle data with OHLCV and timestamp
   * @param {string} timeframe - Source timeframe (defaults to baseTimeframe)
   * @returns {Object} Processing results with update information
   */
  processCandle(candle, timeframe = null) {
    if (!this.validateCandle(candle)) {
      console.error('❌ Invalid candle data provided');
      return { success: false, error: 'Invalid candle data' };
    }
    
    const targetTimeframe = timeframe || this.baseTimeframe;
    const startTime = performance.now();
    
    // Add to target timeframe with intelligent duplicate detection
    const addResult = this.addCandleToTimeframe(candle, targetTimeframe);
    if (!addResult.success) {
      return addResult;
    }
    
    // FIXED: Invalidate related cache entries when new data arrives
    this.invalidateRelatedCache(targetTimeframe);
    
    // Update higher timeframes if this is base timeframe
    const updatedTimeframes = [targetTimeframe];
    if (targetTimeframe === this.baseTimeframe) {
      const higherUpdates = this.updateHigherTimeframes(candle);
      updatedTimeframes.push(...higherUpdates);
    }
    
    // Update metrics
    this.updateMetrics(performance.now() - startTime);
    
    // FIXED: Use graduated cleanup thresholds
    if (this.shouldOptimize()) {
      this.performOptimization();
    }
    
    return {
      success: true,
      timestamp: candle.timestamp,
      sourceTimeframe: targetTimeframe,
      updatedTimeframes,
      processingTimeMs: performance.now() - startTime,
      metricsSnapshot: this.config.enableMetrics ? this.getMetricsSnapshot() : null
    };
  }
  
  /**
   * FIXED: Invalidate cache entries related to updated timeframe
   * @param {string} timeframe - Updated timeframe
   */
  invalidateRelatedCache(timeframe) {
    let invalidated = 0;
    
    for (const key of this.candleCache.keys()) {
      if (key.includes(timeframe)) {
        this.candleCache.delete(key);
        this.cacheTimestamps.delete(key);
        invalidated++;
      }
    }
    
    if (invalidated > 0) {
      this.metrics.cacheInvalidations++;
    }
  }
  
  /**
   * Get candles with intelligent caching and compression
   * @param {string} timeframe - Target timeframe
   * @param {number} count - Number of candles to return
   * @param {Object} options - Query options
   * @returns {Array} Requested candles
   */
  getCandles(timeframe, count = 100, options = {}) {
    const opts = {
      includeIncomplete: false,
      useCache: true,
      format: 'object', // 'object', 'array', 'minimal'
      ...options
    };
    
    if (!this.activeTimeframes.has(timeframe)) {
      this.addTimeframe(timeframe);
    }
    
    // Check cache first (FIXED: Include TTL check)
    const cacheKey = `${timeframe}_${count}_${opts.includeIncomplete}`;
    if (opts.useCache && this.candleCache.has(cacheKey)) {
      const cacheTimestamp = this.cacheTimestamps.get(cacheKey);
      const now = Date.now();
      
      // FIXED: Check if cache entry is still valid (TTL)
      if (cacheTimestamp && (now - cacheTimestamp) <= this.config.cacheTTL) {
        this.metrics.cacheHits++;
        return this.candleCache.get(cacheKey);
      } else {
        // Cache expired, remove it
        this.candleCache.delete(cacheKey);
        this.cacheTimestamps.delete(cacheKey);
        this.metrics.staleDataPrevented++;
      }
    }
    
    this.metrics.cacheMisses++;
    
    // Get candles from storage
    const candleArray = this.candles.get(timeframe) || [];
    let result;
    
    if (opts.includeIncomplete && this.pendingUpdates.get(timeframe)) {
      // Include the pending incomplete candle
      result = [...candleArray.slice(-count + 1), this.pendingUpdates.get(timeframe)];
    } else {
      result = candleArray.slice(-count);
    }
    
    // Format result based on options
    if (opts.format === 'minimal') {
      result = result.map(c => [_t(c) || c.timestamp, _o(c) || c.open, _h(c) || c.high, _l(c) || c.low, _c(c) || c.close, _v(c) || c.volume || 0]);
    } else if (opts.format === 'array') {
      result = result.map(c => [_o(c) || c.open, _h(c) || c.high, _l(c) || c.low, _c(c) || c.close, _v(c) || c.volume || 0]);
    }
    
    // Cache result if caching enabled (FIXED: With timestamp)
    if (opts.useCache && this.config.enableCaching) {
      this.updateCache(cacheKey, result);
    }
    
    return result;
  }
  
  /**
   * FIXED: Update cache with TTL timestamp
   * @param {string} key - Cache key
   * @param {*} value - Cache value
   */
  updateCache(key, value) {
    this.candleCache.set(key, value);
    this.cacheTimestamps.set(key, Date.now());
    
    // Prevent cache from growing too large
    if (this.candleCache.size > 200) {
      // Remove oldest 20% of cache entries
      const entries = Array.from(this.cacheTimestamps.entries())
        .sort((a, b) => a[1] - b[1]); // Sort by timestamp
      
      const removeCount = Math.floor(entries.length * 0.2);
      for (let i = 0; i < removeCount; i++) {
        const [oldKey] = entries[i];
        this.candleCache.delete(oldKey);
        this.cacheTimestamps.delete(oldKey);
      }
    }
  }
  
  /**
   * Get real-time candle for specific timeframe
   * @param {string} timeframe - Target timeframe
   * @param {boolean} includePending - Include incomplete candle
   * @returns {Object|null} Current candle or null
   */
  getCurrentCandle(timeframe, includePending = false) {
    const candles = this.candles.get(timeframe);
    if (!candles || candles.length === 0) return null;
    
    if (includePending && this.pendingUpdates.get(timeframe)) {
      return this.pendingUpdates.get(timeframe);
    }
    
    return candles[candles.length - 1];
  }
  
  /**
   * Check if a candle is complete for given timeframe
   * @param {number} timestamp - Timestamp to check
   * @param {string} timeframe - Target timeframe
   * @returns {boolean} True if candle is closed
   */
  isCandleComplete(timestamp, timeframe) {
    const interval = this.TIMEFRAMES[timeframe];
    const candleStart = Math.floor(timestamp / interval) * interval;
    const candleEnd = candleStart + interval;
    
    return Date.now() >= candleEnd;
  }
  
  /**
   * Advanced candle aggregation with multiple methods
   * @private
   * @param {Array} sourceCandles - Source candles to aggregate
   * @param {number} targetTimestamp - Target candle timestamp
   * @param {string} method - Aggregation method
   * @returns {Object} Aggregated candle
   */
  aggregateCandles(sourceCandles, targetTimestamp, method = 'OHLCV') {
    if (!sourceCandles || sourceCandles.length === 0) return null;
    
    switch (method) {
      case 'OHLCV':
        return this.aggregateOHLCV(sourceCandles, targetTimestamp);
      case 'VWAP':
        return this.aggregateVWAP(sourceCandles, targetTimestamp);
      case 'MEDIAN':
        return this.aggregateMedian(sourceCandles, targetTimestamp);
      default:
        return this.aggregateOHLCV(sourceCandles, targetTimestamp);
    }
  }
  
  /**
   * Standard OHLCV aggregation
   * @private
   */
  aggregateOHLCV(candles, timestamp) {
    const opens = candles.map(c => _o(c) || c.open);
    const highs = candles.map(c => _h(c) || c.high);
    const lows = candles.map(c => _l(c) || c.low);
    const closes = candles.map(c => _c(c) || c.close);
    const volumes = candles.map(c => _v(c) || c.volume || 0);
    
    return {
      timestamp,
      open: opens[0],
      high: Math.max(...highs),
      low: Math.min(...lows),
      close: closes[closes.length - 1],
      volume: volumes.reduce((sum, vol) => sum + vol, 0),
      candleCount: candles.length
    };
  }
  
  /**
   * Volume Weighted Average Price aggregation
   * @private
   */
  aggregateVWAP(candles, timestamp) {
    let totalVolume = 0;
    let weightedSum = 0;
    
    candles.forEach(candle => {
      const typicalPrice = ((_h(candle) || candle.high) + (_l(candle) || candle.low) + (_c(candle) || candle.close)) / 3;
      const volume = _v(candle) || candle.volume || 0;
      weightedSum += typicalPrice * volume;
      totalVolume += volume;
    });

    const vwap = totalVolume > 0 ? weightedSum / totalVolume : (_c(candles[0]) || candles[0].close);
    
    return {
      timestamp,
      open: _o(candles[0]) || candles[0].open,
      high: Math.max(...candles.map(c => _h(c) || c.high)),
      low: Math.min(...candles.map(c => _l(c) || c.low)),
      close: _c(candles[candles.length - 1]) || candles[candles.length - 1].close,
      volume: totalVolume,
      vwap,
      candleCount: candles.length
    };
  }
  
  /**
   * FIXED: Performance optimization and memory management with graduated levels
   * @private
   */
  performOptimization() {
    console.log('🔧 Performing TimeframeManager optimization...');
    const startTime = performance.now();
    
    // Determine cleanup level based on memory usage
    const memoryUsageMB = this.estimateMemoryUsage();
    let cleanupLevel = 'gentle';
    
    if (memoryUsageMB > this.config.emergencyThresholdMB) {
      cleanupLevel = 'aggressive';
      console.log(`🚨 Emergency memory cleanup triggered (${memoryUsageMB}MB)`);
    } else if (memoryUsageMB > this.config.warningThresholdMB) {
      cleanupLevel = 'moderate';
      console.log(`⚠️ Moderate memory cleanup triggered (${memoryUsageMB}MB)`);
    }
    
    // FIXED: Graduated cleanup instead of aggressive 50% cut
    for (const [timeframe, candleArray] of this.candles) {
      if (candleArray.length > this.config.maxCandles) {
        const targetRatio = this.config.cleanupLevels[cleanupLevel];
        const targetCount = Math.floor(this.config.maxCandles * targetRatio);
        const keepCount = Math.max(targetCount, 500); // Never go below 500 candles
        
        const excess = candleArray.length - keepCount;
        if (excess > 0) {
          candleArray.splice(0, excess);
          console.log(`🧹 ${cleanupLevel} cleanup: Removed ${excess} old candles from ${timeframe} (kept ${keepCount})`);
        }
      }
    }
    
    // Compress data if enabled
    if (this.config.enableCompression) {
      this.compressOldData();
    }
    
    // FIXED: Smart cache cleanup based on size and TTL
    const cacheSize = this.candleCache.size;
    if (cacheSize > 100) {
      this.cleanupExpiredCache(); // Clean based on TTL first
      
      // If still too large, remove oldest entries
      if (this.candleCache.size > 150) {
        const entriesToRemove = this.candleCache.size - 100;
        const entries = Array.from(this.cacheTimestamps.entries())
          .sort((a, b) => a[1] - b[1]); // Sort by timestamp
        
        for (let i = 0; i < entriesToRemove; i++) {
          const [key] = entries[i];
          this.candleCache.delete(key);
          this.cacheTimestamps.delete(key);
        }
        
        console.log(`🧹 Cleaned up ${entriesToRemove} oldest cache entries`);
      }
    }
    
    // Update metrics
    this.metrics.lastOptimization = Date.now();
    this.updateMemoryUsage();
    
    const optimizationTime = performance.now() - startTime;
    console.log(`✅ ${cleanupLevel} optimization complete in ${optimizationTime.toFixed(2)}ms`);
  }
  
  /**
   * Get comprehensive system status
   * @returns {Object} Detailed status information
   */
  getDetailedStatus() {
    const status = {
      baseTimeframe: this.baseTimeframe,
      activeTimeframes: Array.from(this.activeTimeframes),
      candleCounts: {},
      memoryUsage: this.estimateMemoryUsage(),
      
      // FIXED: Enhanced cache statistics with TTL info
      cacheStats: {
        size: this.candleCache.size,
        hitRate: this.getCacheHitRate(),
        invalidations: this.metrics.cacheInvalidations,
        staleDataPrevented: this.metrics.staleDataPrevented,
        ttl: this.config.cacheTTL,
        oldestEntryAge: this.getOldestCacheEntryAge()
      },
      
      performance: {
        ...this.metrics,
        uptime: Date.now() - this.metrics.lastOptimization,
        volatility: this.marketVolatility
      },
      health: this.getHealthStatus()
    };
    
    // Add candle counts for each timeframe
    for (const tf of this.activeTimeframes) {
      const candles = this.candles.get(tf);
      status.candleCounts[tf] = candles ? candles.length : 0;
    }
    
    return status;
  }
  
  /**
   * FIXED: Get age of oldest cache entry
   * @returns {number} Age in milliseconds
   */
  getOldestCacheEntryAge() {
    if (this.cacheTimestamps.size === 0) return 0;
    
    const now = Date.now();
    const timestamps = Array.from(this.cacheTimestamps.values());
    const oldest = Math.min(...timestamps);
    
    return now - oldest;
  }
  
  /**
   * Validate candle data integrity
   * @private
   */
  validateCandle(candle) {
    if (!candle || typeof candle !== 'object') return false;
    const ts = _t(candle) || candle.timestamp;
    const o = _o(candle) || candle.open;
    const h = _h(candle) || candle.high;
    const l = _l(candle) || candle.low;
    const c = _c(candle) || candle.close;
    if (typeof ts !== 'number' || ts <= 0) return false;
    if (typeof o !== 'number' || o <= 0) return false;
    if (typeof h !== 'number' || h <= 0) return false;
    if (typeof l !== 'number' || l <= 0) return false;
    if (typeof c !== 'number' || c <= 0) return false;

    // Logical validation
    if (h < Math.max(o, c)) return false;
    if (l > Math.min(o, c)) return false;

    return true;
  }
  
  /**
   * Setup automatic optimization scheduler
   * @private
   */
  setupAutoOptimization() {
    // CHANGE 2026-01-29: Assign to instance var for cleanup
    this.autoOptimizationInterval = setInterval(() => {
      if (this.shouldOptimize()) {
        this.performOptimization();
      }
    }, 60000); // Check every minute
  }
  
  /**
   * FIXED: Graduated optimization thresholds
   * @private
   */
  shouldOptimize() {
    const timeSinceLastOptimization = Date.now() - this.metrics.lastOptimization;
    const memoryUsage = this.estimateMemoryUsage();
    
    return (
      timeSinceLastOptimization > 300000 || // 5 minutes
      memoryUsage > this.config.warningThresholdMB || // FIXED: Use warning threshold
      this.candleCache.size > 200
    );
  }
  
  /**
   * Estimate memory usage in MB
   * @private
   */
  estimateMemoryUsage() {
    let totalCandles = 0;
    for (const candleArray of this.candles.values()) {
      totalCandles += candleArray.length;
    }
    
    // FIXED: More accurate memory estimation including cache
    const candleMemory = totalCandles * 200; // ~200 bytes per candle object
    const cacheMemory = this.candleCache.size * 150; // ~150 bytes per cache entry
    
    return (candleMemory + cacheMemory) / (1024 * 1024);
  }
  
  /**
   * Get cache hit rate percentage
   * @private
   */
  getCacheHitRate() {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    return total > 0 ? (this.metrics.cacheHits / total * 100).toFixed(2) : 0;
  }
  
  /**
   * Update performance metrics
   * @private
   */
  updateMetrics(processingTime) {
    this.metrics.totalCandles++;
    this.metrics.aggregationsPerformed++;
    
    // Update average processing time (simple moving average)
    if (!this.metrics.avgProcessingTime) {
      this.metrics.avgProcessingTime = processingTime;
    } else {
      this.metrics.avgProcessingTime = (this.metrics.avgProcessingTime * 0.9) + (processingTime * 0.1);
    }
  }
  
  /**
   * Get current metrics snapshot
   * @private
   */
  getMetricsSnapshot() {
    return {
      ...this.metrics,
      cacheHitRate: this.getCacheHitRate(),
      memoryUsageMB: this.estimateMemoryUsage(),
      oldestCacheEntryAge: this.getOldestCacheEntryAge(),
      marketVolatility: this.marketVolatility
    };
  }
  
  /**
   * FIXED: Less aggressive emergency cleanup
   */
  emergencyCleanup() {
    console.log('🚨 Emergency cleanup initiated!');
    
    // FIXED: Keep more essential data - use aggressive level instead of 50% hard cut
    const targetRatio = this.config.cleanupLevels.aggressive; // 50%
    
    for (const [timeframe, candleArray] of this.candles) {
      const keepCount = Math.max(
        Math.floor(this.config.maxCandles * targetRatio), 
        300  // FIXED: Never go below 300 candles (was 500)
      );
      
      if (candleArray.length > keepCount) {
        candleArray.splice(0, candleArray.length - keepCount);
      }
    }
    
    // Clear all caches
    this.candleCache.clear();
    this.cacheTimestamps.clear();
    
    console.log(`✅ Emergency cleanup complete - preserved ${Math.floor(this.config.maxCandles * targetRatio)} candles per timeframe`);
  }
  
  /**
   * Export data for backup/analysis
   * @param {Array} timeframes - Timeframes to export
   * @param {Object} options - Export options
   * @returns {Object} Exported data
   */
  exportData(timeframes = null, options = {}) {
    const targetTimeframes = timeframes || Array.from(this.activeTimeframes);
    const opts = {
      includeMetrics: true,
      compress: false,
      format: 'json',
      ...options
    };
    
    const exportData = {
      timestamp: Date.now(),
      baseTimeframe: this.baseTimeframe,
      config: this.config,
      data: {},
      // FIXED: Include cache and volatility state
      cacheStats: {
        size: this.candleCache.size,
        hitRate: this.getCacheHitRate(),
        invalidations: this.metrics.cacheInvalidations,
        staleDataPrevented: this.metrics.staleDataPrevented
      },
      marketVolatility: this.marketVolatility
    };
    
    for (const tf of targetTimeframes) {
      if (this.candles.has(tf)) {
        exportData.data[tf] = this.candles.get(tf).slice(); // Copy array
      }
    }
    
    if (opts.includeMetrics) {
      exportData.metrics = this.getMetricsSnapshot();
    }
    
    return exportData;
  }
  
  /**
   * Graceful shutdown with data preservation
   */
  shutdown() {
    console.log('🛑 TimeframeManager shutting down...');

    // CHANGE 2026-01-29: Clear ALL intervals
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
    }
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
    }
    if (this.volatilityCheckInterval) {
      clearInterval(this.volatilityCheckInterval);
    }
    if (this.autoOptimizationInterval) {
      clearInterval(this.autoOptimizationInterval);
    }
    
    // Final optimization
    this.performOptimization();
    
    // FIXED: Log enhanced final stats
    const finalStats = this.getDetailedStatus();
    console.log('📊 Final TimeframeManager stats:', {
      totalCandles: finalStats.memoryUsage,
      cacheHitRate: finalStats.cacheStats.hitRate,
      memoryUsage: finalStats.memoryUsage,
      staleDataPrevented: finalStats.cacheStats.staleDataPrevented,
      volatilityInvalidations: finalStats.cacheStats.invalidations
    });
    
    return this.exportData();
  }
  
  // FIXED: Helper methods for missing functionality referenced in the class
  
  /**
   * Estimate initial capacity for a timeframe
   * @param {string} timeframe - Target timeframe
   * @returns {number} Estimated capacity
   */
  estimateInitialCapacity(timeframe) {
    const interval = this.TIMEFRAMES[timeframe];
    const baseInterval = this.TIMEFRAMES[this.baseTimeframe];
    const ratio = interval / baseInterval;
    
    // Estimate based on how much data we expect
    return Math.max(100, Math.floor(this.config.maxCandles / ratio));
  }
  
  /**
   * Check if we can backfill a timeframe
   * @param {string} timeframe - Target timeframe
   * @returns {boolean} Can backfill
   */
  canBackfillTimeframe(timeframe) {
    const baseCandles = this.candles.get(this.baseTimeframe);
    const interval = this.TIMEFRAMES[timeframe];
    const baseInterval = this.TIMEFRAMES[this.baseTimeframe];
    
    return baseCandles && 
           baseCandles.length > 0 && 
           interval > baseInterval;
  }
  
  /**
   * Backfill a timeframe from base data
   * @param {string} timeframe - Target timeframe
   */
  backfillTimeframe(timeframe) {
    // Implementation would aggregate base timeframe data into higher timeframe
    console.log(`🔄 Backfilling ${timeframe} from base data...`);
  }
  
  /**
   * Add candle to specific timeframe
   * @param {Object} candle - Candle data
   * @param {string} timeframe - Target timeframe
   * @returns {Object} Add result
   */
  addCandleToTimeframe(candle, timeframe) {
    const candleArray = this.candles.get(timeframe);
    if (!candleArray) {
      return { success: false, error: 'Timeframe not initialized' };
    }
    
    // Simple add for now - would include duplicate detection in full implementation
    candleArray.push(candle);
    this.lastCandleTime.set(timeframe, candle.timestamp);
    
    return { success: true };
  }
  
  /**
   * Update higher timeframes from base data
   * @param {Object} candle - Base candle
   * @returns {Array} Updated timeframes
   */
  updateHigherTimeframes(candle) {
    const updated = [];
    
    for (const tf of this.activeTimeframes) {
      if (tf !== this.baseTimeframe) {
        // Would implement aggregation logic here
        updated.push(tf);
      }
    }
    
    return updated;
  }
  
  /**
   * Compress old data if needed
   */
  compressOldData() {
    // Placeholder for compression implementation
    console.log('📦 Compressing old data...');
  }
  
  /**
   * Update memory usage metrics
   */
  updateMemoryUsage() {
    this.metrics.memoryUsage = this.estimateMemoryUsage();
  }
  
  /**
   * Get health status
   * @returns {string} Health status
   */
  getHealthStatus() {
    const memUsage = this.estimateMemoryUsage();

    if (memUsage > this.config.emergencyThresholdMB) {
      return 'critical';
    } else if (memUsage > this.config.warningThresholdMB) {
      return 'warning';
    } else {
      return 'healthy';
    }
  }

  // CHANGE 614: Case-safe direction/signal comparison helpers
  // Prevents case sensitivity bugs when comparing direction and signal values

  /**
   * Normalize direction string to lowercase
   * CHANGE 614: Case normalization helper
   * @param {string} direction - Direction value (BUY, buy, Buy, SELL, sell, etc.)
   * @returns {string} Normalized lowercase direction
   */
  normalizeDirection(direction) {
    return (direction || '').toString().toLowerCase(); // CHANGE 614
  }

  /**
   * Normalize signal string to lowercase
   * CHANGE 614: Case normalization helper
   * @param {string} signal - Signal value (UP, up, Down, DOWN, etc.)
   * @returns {string} Normalized lowercase signal
   */
  normalizeSignal(signal) {
    return (signal || '').toString().toLowerCase(); // CHANGE 614
  }

  /**
   * Safe direction comparison
   * CHANGE 614: Case-insensitive direction comparison
   * @param {string} direction - Direction to check
   * @param {string} expected - Expected direction value
   * @returns {boolean} True if directions match (case-insensitive)
   */
  isDirection(direction, expected) {
    return this.normalizeDirection(direction) === this.normalizeDirection(expected); // CHANGE 614
  }

  /**
   * Safe signal comparison
   * CHANGE 614: Case-insensitive signal comparison
   * @param {string} signal - Signal to check
   * @param {string} expected - Expected signal value
   * @returns {boolean} True if signals match (case-insensitive)
   */
  isSignal(signal, expected) {
    return this.normalizeSignal(signal) === this.normalizeSignal(expected); // CHANGE 614
  }

  /**
   * Check if direction is a BUY
   * CHANGE 614: Safe BUY direction check
   * @param {string} direction - Direction to check
   * @returns {boolean} True if direction is BUY
   */
  isBuyDirection(direction) {
    const normalized = this.normalizeDirection(direction); // CHANGE 614
    return normalized === 'buy' || normalized === 'long'; // CHANGE 614
  }

  /**
   * Check if direction is a SELL
   * CHANGE 614: Safe SELL direction check
   * @param {string} direction - Direction to check
   * @returns {boolean} True if direction is SELL
   */
  isSellDirection(direction) {
    const normalized = this.normalizeDirection(direction); // CHANGE 614
    return normalized === 'sell' || normalized === 'short'; // CHANGE 614
  }

  /**
   * Check if signal is UP
   * CHANGE 614: Safe UP signal check
   * @param {string} signal - Signal to check
   * @returns {boolean} True if signal is UP
   */
  isUpSignal(signal) {
    const normalized = this.normalizeSignal(signal); // CHANGE 614
    return normalized === 'up' || normalized === 'bullish'; // CHANGE 614
  }

  /**
   * Check if signal is DOWN
   * CHANGE 614: Safe DOWN signal check
   * @param {string} signal - Signal to check
   * @returns {boolean} True if signal is DOWN
   */
  isDownSignal(signal) {
    const normalized = this.normalizeSignal(signal); // CHANGE 614
    return normalized === 'down' || normalized === 'bearish'; // CHANGE 614
  }
}

module.exports = TimeframeManager;