/**
 * PatternMemoryStore - Phase 4 of Modular Architecture Refactor
 *
 * PURPOSE: Stores patterns, tracks win rates, returns similar historical patterns.
 * Wraps PatternMemoryBank with contract validation.
 *
 * RESPONSIBILITIES:
 * - Record pattern observations (when pattern is detected)
 * - Record pattern outcomes (when trade closes with P&L)
 * - Look up historical performance for current pattern
 * - Return confidence boost/penalty based on pattern history
 *
 * @see ogz-meta/ledger/PHASES-4-14-EXTRACTION-ROADMAP.md
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ContractValidator } = require('./ContractValidator');
const FeatureExtractor = require('./FeatureExtractor');

const validator = new ContractValidator({ throwOnViolation: false, logViolations: true });

/**
 * PatternMemoryStore - Contract-validated pattern storage
 */
class PatternMemoryStore {
  constructor(config = {}) {
    this.dbPath = config.dbPath || path.join(__dirname, '../data/pattern-memory.json');
    this.backupPath = config.backupPath || path.join(__dirname, '../data/pattern-memory.backup.json');

    // Statistical thresholds
    this.minSampleSize = config.minSampleSize || 10;       // Need 10+ observations
    this.successThreshold = config.successThreshold || 0.65; // 65%+ win rate = success
    this.failureThreshold = config.failureThreshold || 0.35; // <35% win rate = avoid
    this.maxPatternAge = config.maxPatternAge || 90 * 24 * 60 * 60 * 1000; // 90 days

    // In-memory cache
    this.patterns = this._loadPatterns();

    console.log(`[PatternMemoryStore] Initialized with ${Object.keys(this.patterns).length} patterns`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Record a pattern observation (when pattern is detected, before trade outcome)
   *
   * @param {number[]} features - 9-element normalized feature vector from FeatureExtractor
   * @param {Object} metadata - Additional context
   * @returns {string} Pattern signature
   */
  recordObservation(features, metadata = {}) {
    // CONTRACT: Validate features
    if (!this._validateFeatures(features)) {
      console.warn('[PatternMemoryStore] Invalid features, skipping observation');
      return null;
    }

    const signature = FeatureExtractor.computeSignature(features);

    // Initialize pattern if new
    if (!this.patterns[signature]) {
      this.patterns[signature] = {
        features: features,
        signature: signature,
        timesSeen: 0,
        wins: 0,
        losses: 0,
        totalPnL: 0,
        avgPnL: 0,
        winRate: 0,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        outcomes: []
      };
    }

    // Update observation count
    this.patterns[signature].timesSeen++;
    this.patterns[signature].lastSeen = Date.now();

    // Log significant patterns
    const pattern = this.patterns[signature];
    if (pattern.timesSeen % 50 === 0) {
      console.log(`[PatternMemoryStore] Pattern ${signature} seen ${pattern.timesSeen}x`);
    }

    return signature;
  }

  /**
   * Record a pattern outcome (when trade closes with P&L)
   *
   * @param {number[]} features - 9-element normalized feature vector
   * @param {Object} outcome - { pnl: number, pnlPercent: number, holdTime: number }
   * @returns {boolean} Success
   */
  recordOutcome(features, outcome) {
    // CONTRACT: Validate features
    if (!this._validateFeatures(features)) {
      console.warn('[PatternMemoryStore] Invalid features, skipping outcome');
      return false;
    }

    // CONTRACT: Validate outcome
    if (!outcome || typeof outcome.pnl !== 'number') {
      console.warn('[PatternMemoryStore] Invalid outcome, skipping');
      return false;
    }

    const signature = FeatureExtractor.computeSignature(features);

    // Initialize if pattern wasn't observed first (edge case)
    if (!this.patterns[signature]) {
      this.recordObservation(features, { source: 'outcome_backfill' });
    }

    const pattern = this.patterns[signature];
    const isWin = outcome.pnl > 0;

    // Update statistics
    if (isWin) {
      pattern.wins++;
    } else {
      pattern.losses++;
    }

    pattern.totalPnL += outcome.pnl;

    const totalTrades = pattern.wins + pattern.losses;
    pattern.winRate = totalTrades > 0 ? pattern.wins / totalTrades : 0;
    pattern.avgPnL = totalTrades > 0 ? pattern.totalPnL / totalTrades : 0;

    // Store outcome details (keep last 20)
    pattern.outcomes.push({
      timestamp: Date.now(),
      pnl: outcome.pnl,
      pnlPercent: outcome.pnlPercent || 0,
      holdTime: outcome.holdTime || 0,
      isWin: isWin
    });

    if (pattern.outcomes.length > 20) {
      pattern.outcomes = pattern.outcomes.slice(-20);
    }

    // Log significant updates
    if (totalTrades >= this.minSampleSize && totalTrades % 10 === 0) {
      const status = pattern.winRate >= this.successThreshold ? 'SUCCESS' :
                     pattern.winRate < this.failureThreshold ? 'AVOID' : 'LEARNING';
      console.log(`[PatternMemoryStore] ${status} Pattern ${signature}: ` +
                  `${(pattern.winRate * 100).toFixed(1)}% win rate over ${totalTrades} trades`);
    }

    // Persist
    this._savePatterns();

    return true;
  }

  /**
   * Get confidence adjustment for current pattern
   *
   * @param {number[]} features - 9-element normalized feature vector
   * @returns {Object} { confidence: number, source: string, stats: Object } or null
   */
  getPatternConfidence(features) {
    // CONTRACT: Validate features
    if (!this._validateFeatures(features)) {
      return null;
    }

    const signature = FeatureExtractor.computeSignature(features);
    const pattern = this.patterns[signature];

    if (!pattern) {
      return null; // Unknown pattern
    }

    const totalTrades = pattern.wins + pattern.losses;

    // Not enough data for statistical significance
    if (totalTrades < this.minSampleSize) {
      return {
        confidence: 0.5, // Neutral
        source: 'insufficient_data',
        stats: {
          totalTrades,
          wins: pattern.wins,
          losses: pattern.losses,
          winRate: pattern.winRate
        }
      };
    }

    // Statistically significant pattern
    return {
      confidence: pattern.winRate, // 0-1
      source: pattern.winRate >= this.successThreshold ? 'learned_success' :
              pattern.winRate < this.failureThreshold ? 'learned_failure' : 'neutral',
      stats: {
        totalTrades,
        wins: pattern.wins,
        losses: pattern.losses,
        winRate: pattern.winRate,
        avgPnL: pattern.avgPnL,
        timesSeen: pattern.timesSeen
      }
    };
  }

  /**
   * Check if pattern should be avoided (low win rate)
   *
   * @param {number[]} features - 9-element normalized feature vector
   * @returns {boolean} True if pattern should be avoided
   */
  shouldAvoidPattern(features) {
    const result = this.getPatternConfidence(features);

    if (!result) return false; // Unknown = don't avoid

    return result.source === 'learned_failure';
  }

  /**
   * Find similar historical patterns
   *
   * @param {number[]} features - 9-element normalized feature vector
   * @param {number} maxDistance - Maximum feature distance (default 0.3)
   * @returns {Array} Array of similar patterns with their stats
   */
  findSimilarPatterns(features, maxDistance = 0.3) {
    if (!this._validateFeatures(features)) {
      return [];
    }

    const similar = [];

    for (const [signature, pattern] of Object.entries(this.patterns)) {
      const distance = this._calculateDistance(features, pattern.features);

      if (distance <= maxDistance) {
        similar.push({
          signature,
          distance,
          ...pattern
        });
      }
    }

    // Sort by distance (closest first)
    similar.sort((a, b) => a.distance - b.distance);

    return similar.slice(0, 10); // Return top 10
  }

  /**
   * Get memory statistics
   */
  getStats() {
    const patterns = Object.values(this.patterns);
    const significant = patterns.filter(p => p.wins + p.losses >= this.minSampleSize);
    const successful = significant.filter(p => p.winRate >= this.successThreshold);
    const failed = significant.filter(p => p.winRate < this.failureThreshold);

    return {
      totalPatterns: patterns.length,
      significantPatterns: significant.length,
      successfulPatterns: successful.length,
      failedPatterns: failed.length,
      totalObservations: patterns.reduce((sum, p) => sum + p.timesSeen, 0),
      totalOutcomes: patterns.reduce((sum, p) => sum + p.wins + p.losses, 0)
    };
  }

  /**
   * Get memory size (for telemetry)
   */
  getMemorySize() {
    return Object.keys(this.patterns).length;
  }

  /**
   * Prune old patterns
   */
  pruneOldPatterns() {
    const now = Date.now();
    let pruned = 0;

    for (const [signature, pattern] of Object.entries(this.patterns)) {
      const age = now - pattern.lastSeen;
      const totalTrades = pattern.wins + pattern.losses;

      // Prune if: old AND not statistically significant
      if (age > this.maxPatternAge && totalTrades < this.minSampleSize) {
        delete this.patterns[signature];
        pruned++;
      }
    }

    if (pruned > 0) {
      console.log(`[PatternMemoryStore] Pruned ${pruned} old patterns`);
      this._savePatterns();
    }

    return pruned;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate feature vector
   */
  _validateFeatures(features) {
    if (!Array.isArray(features)) return false;
    if (features.length !== 9) return false;

    for (const f of features) {
      if (typeof f !== 'number' || isNaN(f)) return false;
      if (f < 0 || f > 1) return false;
    }

    return true;
  }

  /**
   * Calculate Euclidean distance between feature vectors
   */
  _calculateDistance(featuresA, featuresB) {
    if (!featuresA || !featuresB || featuresA.length !== featuresB.length) {
      return Infinity;
    }

    let sumSquares = 0;
    for (let i = 0; i < featuresA.length; i++) {
      sumSquares += Math.pow(featuresA[i] - featuresB[i], 2);
    }

    return Math.sqrt(sumSquares);
  }

  /**
   * Load patterns from disk
   */
  _loadPatterns() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
        console.log(`[PatternMemoryStore] Loaded ${Object.keys(data).length} patterns from disk`);
        return data;
      }
    } catch (error) {
      console.warn(`[PatternMemoryStore] Failed to load patterns: ${error.message}`);
    }

    return {};
  }

  /**
   * Save patterns to disk
   */
  _savePatterns() {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Backup existing
      if (fs.existsSync(this.dbPath)) {
        fs.copyFileSync(this.dbPath, this.backupPath);
      }

      // Save
      fs.writeFileSync(this.dbPath, JSON.stringify(this.patterns, null, 2));
    } catch (error) {
      console.error(`[PatternMemoryStore] Failed to save patterns: ${error.message}`);
    }
  }
}

module.exports = PatternMemoryStore;
