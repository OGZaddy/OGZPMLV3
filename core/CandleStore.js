/**
 * CandleStore - Phase 1 of Modular Architecture Refactor
 *
 * PURPOSE: Stores candles by symbol and timeframe. That's it.
 * Pure data structure, no external deps.
 *
 * Self-contained: Yes - pure data structure, no external deps.
 * Hot-swap: Yes - can swap storage backend (memory, redis, sqlite).
 *
 * @see ogz-meta/REFACTOR-PLAN-2026-02-27.md
 */

const { ContractValidator } = require('./ContractValidator');
const { c: _c, t: _t } = require('./CandleHelper');

class CandleStore {
  constructor(config = {}) {
    this.config = {
      maxCandles: config.maxCandles || 500,
      persist: config.persist || false,
      validator: config.validator || null
    };

    // Primary storage: Map<symbol, Map<timeframe, candle[]>>
    this.store = new Map();

    // Contract validation (monitor mode - log but don't throw)
    this.validator = this.config.validator || ContractValidator.createMonitor();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STORE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add a single candle to the store
   * @param {string} symbol - Trading pair (e.g., 'BTC-USD')
   * @param {string} timeframe - Candle timeframe (e.g., '1m', '5m', '15m')
   * @param {Object} candle - OHLCV candle object
   */
  addCandle(symbol, timeframe, candle) {
    // Validate candle contract
    this.validator.validateCandle(candle);

    // Ensure symbol exists in store
    if (!this.store.has(symbol)) {
      this.store.set(symbol, new Map());
    }

    const symbolStore = this.store.get(symbol);

    // Ensure timeframe exists for symbol
    if (!symbolStore.has(timeframe)) {
      symbolStore.set(timeframe, []);
    }

    const candles = symbolStore.get(timeframe);

    // Check if this is an update to the last candle (same timestamp)
    const lastCandle = candles[candles.length - 1];
    const candleTime = _t(candle);
    const lastTime = lastCandle ? _t(lastCandle) : null;

    if (lastTime && candleTime === lastTime) {
      // Update existing candle (same timestamp)
      candles[candles.length - 1] = candle;
    } else {
      // New candle
      candles.push(candle);

      // Enforce max candles limit
      if (candles.length > this.config.maxCandles) {
        candles.shift();
      }
    }
  }

  /**
   * Add multiple candles at once (for batch loading)
   * @param {string} symbol - Trading pair
   * @param {string} timeframe - Candle timeframe
   * @param {Array} candles - Array of OHLCV candles
   */
  addCandles(symbol, timeframe, candles) {
    for (const candle of candles) {
      this.addCandle(symbol, timeframe, candle);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RETRIEVE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get candles for a symbol/timeframe
   * @param {string} symbol - Trading pair
   * @param {string} timeframe - Candle timeframe
   * @param {number} limit - Optional limit on number of candles (most recent)
   * @returns {Array} Array of OHLCV candles
   */
  getCandles(symbol, timeframe, limit = null) {
    const candles = this._getCandles(symbol, timeframe);
    if (limit && limit > 0) {
      return candles.slice(-limit);
    }
    return [...candles]; // Return copy to prevent external mutation
  }

  /**
   * Get the most recent candle
   * @param {string} symbol - Trading pair
   * @param {string} timeframe - Candle timeframe
   * @returns {Object|null} Latest candle or null
   */
  getLatestCandle(symbol, timeframe) {
    const candles = this._getCandles(symbol, timeframe);
    return candles.length > 0 ? candles[candles.length - 1] : null;
  }

  /**
   * Get candle at specific timestamp
   * @param {string} symbol - Trading pair
   * @param {string} timeframe - Candle timeframe
   * @param {number} timestamp - Unix timestamp
   * @returns {Object|null} Candle at timestamp or null
   */
  getCandleAt(symbol, timeframe, timestamp) {
    const candles = this._getCandles(symbol, timeframe);
    return candles.find(c => _t(c) === timestamp) || null;
  }

  /**
   * Get latest close price
   * @param {string} symbol - Trading pair
   * @param {string} timeframe - Candle timeframe
   * @returns {number|null} Latest close price or null
   */
  getLatestPrice(symbol, timeframe) {
    const candle = this.getLatestCandle(symbol, timeframe);
    return candle ? _c(candle) : null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // METADATA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all symbols in the store
   * @returns {Array} Array of symbol strings
   */
  getSymbols() {
    return Array.from(this.store.keys());
  }

  /**
   * Get all timeframes for a symbol
   * @param {string} symbol - Trading pair
   * @returns {Array} Array of timeframe strings
   */
  getTimeframes(symbol) {
    const symbolStore = this.store.get(symbol);
    return symbolStore ? Array.from(symbolStore.keys()) : [];
  }

  /**
   * Get candle count for a symbol/timeframe
   * @param {string} symbol - Trading pair
   * @param {string} timeframe - Candle timeframe
   * @returns {number} Number of candles stored
   */
  getCandleCount(symbol, timeframe) {
    return this._getCandles(symbol, timeframe).length;
  }

  /**
   * Check if we have minimum candles for analysis
   * @param {string} symbol - Trading pair
   * @param {string} timeframe - Candle timeframe
   * @param {number} minRequired - Minimum candles required
   * @returns {boolean}
   */
  hasMinimumCandles(symbol, timeframe, minRequired) {
    return this.getCandleCount(symbol, timeframe) >= minRequired;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAINTENANCE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clear all candles for a symbol/timeframe
   */
  clear(symbol = null, timeframe = null) {
    if (!symbol) {
      this.store.clear();
    } else if (!timeframe) {
      this.store.delete(symbol);
    } else {
      const symbolStore = this.store.get(symbol);
      if (symbolStore) {
        symbolStore.delete(timeframe);
      }
    }
  }

  /**
   * Filter out stale candles (older than threshold)
   * @param {string} symbol - Trading pair
   * @param {string} timeframe - Candle timeframe
   * @param {number} maxAgeMs - Maximum age in milliseconds
   * @returns {number} Number of candles removed
   */
  filterStale(symbol, timeframe, maxAgeMs) {
    const candles = this._getCandles(symbol, timeframe);
    const cutoff = Date.now() - maxAgeMs;
    const originalLength = candles.length;

    const filtered = candles.filter(c => _t(c) > cutoff);

    if (filtered.length !== originalLength) {
      this.store.get(symbol).set(timeframe, filtered);
    }

    return originalLength - filtered.length;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL
  // ═══════════════════════════════════════════════════════════════════════════

  _getCandles(symbol, timeframe) {
    const symbolStore = this.store.get(symbol);
    if (!symbolStore) return [];
    return symbolStore.get(timeframe) || [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FACTORY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a CandleStore with custom max candles
   */
  static create(maxCandles = 500) {
    return new CandleStore({ maxCandles });
  }

  /**
   * Create a CandleStore from existing price history array
   * (For migration from run-empire-v2.js priceHistory)
   */
  static fromArray(symbol, timeframe, candles, config = {}) {
    const store = new CandleStore(config);
    store.addCandles(symbol, timeframe, candles);
    return store;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSISTENCE (load/save to disk)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Load candle history from disk
   * Filters out candles older than maxAge (default 4 hours)
   */
  loadFromDisk(filePath, symbol, timeframe, maxAgeMs = 4 * 60 * 60 * 1000) {
    const fs = require('fs');
    try {
      if (!fs.existsSync(filePath)) {
        console.log('[CandleStore] No saved history found - starting fresh');
        return 0;
      }
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(saved) || saved.length === 0) return 0;

      const cutoff = Date.now() - maxAgeMs;
      const fresh = saved.filter(c => _t(c) > cutoff);
      this.addCandles(symbol, timeframe, fresh);
      console.log(`[CandleStore] Loaded ${fresh.length} candles (filtered from ${saved.length})`);
      return fresh.length;
    } catch (error) {
      console.error('[CandleStore] Failed to load:', error.message);
      return 0;
    }
  }

  /**
   * Save candle history to disk
   * Saves the most recent N candles (default 200)
   */
  saveToDisk(filePath, symbol, timeframe, maxCandles = 200) {
    const fs = require('fs');
    try {
      const candles = this.getCandles(symbol, timeframe, maxCandles);
      fs.writeFileSync(filePath, JSON.stringify(candles));
    } catch (error) {
      console.error('[CandleStore] Failed to save:', error.message);
    }
  }
}

module.exports = { CandleStore };
