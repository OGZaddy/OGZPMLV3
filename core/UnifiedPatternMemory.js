/**
 * UnifiedPatternMemory.js - Single Source of Truth for Pattern Learning
 * =====================================================================
 * 
 * REPLACES:
 *   - PatternMemorySystem (inside EnhancedPatternRecognition.js)
 *   - PatternMemoryStore.js (TRAI's separate store)
 * 
 * PROBLEM SOLVED:
 *   The trading pipeline recorded patterns to PatternMemorySystem.
 *   TRAI read patterns from PatternMemoryStore.
 *   They were two separate stores with different data, different matching
 *   algorithms, and different formats. Patterns never reached TRAI.
 * 
 * NOW:
 *   One store. Pipeline writes to it. TRAI reads from it. DTW matching
 *   and exact signature matching both available. Promotion, quarantine,
 *   and decay all in one place.
 * 
 * ARCHITECTURE:
 *   ┌─────────────────┐     ┌──────────────────────┐
 *   │  TradingLoop     │────▶│  UnifiedPatternMemory │
 *   │  (records PnL)   │     │                        │
 *   └─────────────────┘     │  ┌──────────────────┐  │
 *                            │  │  Observation Pool │  │  (all detected patterns)
 *   ┌─────────────────┐     │  └──────────────────┘  │
 *   │  EnhancedPattern │────▶│  ┌──────────────────┐  │
 *   │  Recognition      │     │  │  Outcome Store    │  │  (patterns with PnL)
 *   └─────────────────┘     │  └──────────────────┘  │
 *                            │  ┌──────────────────┐  │
 *   ┌─────────────────┐     │  │  Promoted Patterns│  │  (statistically proven)
 *   │  TRAI Decision   │◀───│  └──────────────────┘  │
 *   │  Module           │     │  ┌──────────────────┐  │
 *   └─────────────────┘     │  │  Quarantined      │  │  (proven losers)
 *                            │  └──────────────────┘  │
 *   ┌─────────────────┐     │  ┌──────────────────┐  │
 *   │  DTW Matcher      │◀──▶│  │  Similarity Index │  │  (fuzzy matching)
 *   └─────────────────┘     │  └──────────────────┘  │
 *                            └──────────────────────┘
 * 
 * LIFECYCLE:
 *   1. OBSERVE:  Pattern detected → recordObservation(features, metadata)
 *   2. OUTCOME:  Trade closes    → recordOutcome(features, { pnl, holdTime })
 *   3. QUERY:    New signal      → getConfidence(features) → boost/kill/neutral
 *   4. PROMOTE:  10+ trades, >65% WR → promoted (high confidence in future)
 *   5. QUARANTINE: 10+ trades, <35% WR → quarantined (blocked from trading)
 *   6. DECAY:    Old patterns lose weight over time
 *   7. PRUNE:    Patterns with <3 trades older than 90 days get deleted
 * 
 * ENV VARS:
 *   PATTERN_MIN_SAMPLES      - Min trades before trusting (default: 10)
 *   PATTERN_SUCCESS_THRESHOLD - Win rate for promotion (default: 0.65)
 *   PATTERN_FAILURE_THRESHOLD - Win rate for quarantine (default: 0.35)
 *   PATTERN_MAX_AGE_DAYS     - Max pattern age before prune (default: 90)
 *   PATTERN_DECAY_HALFLIFE   - Days until pattern weight halves (default: 30)
 *   PATTERN_MAX_STORED       - Max patterns in memory (default: 10000)
 *   PATTERN_DTW_THRESHOLD    - DTW similarity threshold (default: 0.62)
 * 
 * @module core/UnifiedPatternMemory
 * @author Claude (Opus) for Trey / OGZPrime
 * @date 2026-03-17
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════
// DTW (Dynamic Time Warping) — fuzzy pattern matching
// ═══════════════════════════════════════════════════════════════

function normalize(series) {
  const min = Math.min(...series);
  const max = Math.max(...series);
  if (max === min) return series.map(() => 0.5);
  return series.map(v => (v - min) / (max - min));
}

function dynamicTimeWarping(seriesA, seriesB) {
  const n = seriesA.length;
  const m = seriesB.length;
  const dtw = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  dtw[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    const windowStart = Math.max(1, i - 20);
    const windowEnd = Math.min(m, i + 20);
    for (let j = windowStart; j <= windowEnd; j++) {
      const cost = Math.abs(seriesA[i - 1] - seriesB[j - 1]);
      dtw[i][j] = cost + Math.min(dtw[i - 1][j], dtw[i][j - 1], dtw[i - 1][j - 1]);
    }
  }
  return dtw[n][m];
}

// ═══════════════════════════════════════════════════════════════
// FEATURE SIGNATURE — deterministic hash of feature vector
// ═══════════════════════════════════════════════════════════════

function computeSignature(features) {
  if (!Array.isArray(features) || features.length === 0) return null;
  // Quantize to 2 decimal places for grouping similar patterns
  const quantized = features.map(f => {
    if (typeof f !== 'number' || !isFinite(f)) return '0.00';
    return Math.max(-999, Math.min(999, f)).toFixed(2);
  }).join(',');
  return crypto.createHash('md5').update(quantized).digest('hex').substring(0, 12);
}

// ═══════════════════════════════════════════════════════════════
// FEATURE WEIGHTS — importance of each feature dimension
// ═══════════════════════════════════════════════════════════════

const DEFAULT_FEATURE_WEIGHTS = [
  0.25,  // [0] RSI normalized (0-1)
  0.15,  // [1] MACD delta
  0.15,  // [2] Trend direction (-1/0/1)
  0.10,  // [3] Bollinger bandwidth
  0.05,  // [4] Volatility (ATR-based)
  0.05,  // [5] Wick ratio
  0.15,  // [6] Price momentum
  0.05,  // [7] Volume change
  0.05,  // [8] Position context
];

// ═══════════════════════════════════════════════════════════════
// UNIFIED PATTERN MEMORY
// ═══════════════════════════════════════════════════════════════

class UnifiedPatternMemory {
  constructor(config = {}) {
    // Config with env var overrides
    this.config = {
      minSamples: parseInt(process.env.PATTERN_MIN_SAMPLES) || config.minSamples || 10,
      successThreshold: parseFloat(process.env.PATTERN_SUCCESS_THRESHOLD) || config.successThreshold || 0.65,
      failureThreshold: parseFloat(process.env.PATTERN_FAILURE_THRESHOLD) || config.failureThreshold || 0.35,
      maxAgeDays: parseInt(process.env.PATTERN_MAX_AGE_DAYS) || config.maxAgeDays || 90,
      decayHalflifeDays: parseInt(process.env.PATTERN_DECAY_HALFLIFE) || config.decayHalflifeDays || 30,
      maxPatterns: parseInt(process.env.PATTERN_MAX_STORED) || config.maxPatterns || 10000,
      dtwThreshold: parseFloat(process.env.PATTERN_DTW_THRESHOLD) || config.dtwThreshold || 0.62,
      featureWeights: config.featureWeights || DEFAULT_FEATURE_WEIGHTS,
      persistToDisk: config.persistToDisk !== false && process.env.BACKTEST_NO_PATTERN_SAVE !== 'true',
      saveIntervalMs: config.saveIntervalMs || 5 * 60 * 1000, // 5 minutes
    };

    // Determine storage file based on mode
    const mode = process.env.BACKTEST_MODE === 'true' ? 'backtest' :
                 process.env.PAPER_TRADING === 'true' ? 'paper' : 'live';
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.storagePath = config.storagePath || path.join(dataDir, `unified-patterns.${mode}.json`);

    // Pattern storage — keyed by signature
    this.patterns = {};

    // Stats
    this.stats = {
      observations: 0,
      outcomes: 0,
      promoted: 0,
      quarantined: 0,
      dtwMatches: 0,
      exactMatches: 0,
      lastPruneTime: 0,
    };

    // Load from disk
    this._load();

    // Periodic save
    this._saveTimer = null;
    if (this.config.persistToDisk) {
      this._saveTimer = setInterval(() => this.save(), this.config.saveIntervalMs);
    }

    const patternCount = Object.keys(this.patterns).length;
    console.log(`[UnifiedPatternMemory] Initialized: ${patternCount} patterns, mode=${mode}, persist=${this.config.persistToDisk}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // WRITE — Record observations and outcomes
  // ═══════════════════════════════════════════════════════════════

  /**
   * Record a pattern observation (detected, no outcome yet)
   * Called on every candle by EnhancedPatternRecognition
   * 
   * @param {number[]} features - 9-element feature vector
   * @param {Object} metadata - { timestamp, strategy, price }
   * @returns {string|null} Pattern signature
   */
  recordObservation(features, metadata = {}) {
    if (!this._validateFeatures(features)) return null;

    const sig = computeSignature(features);
    if (!sig) return null;

    if (!this.patterns[sig]) {
      this.patterns[sig] = this._createPattern(sig, features);
    }

    const p = this.patterns[sig];
    p.timesSeen++;
    p.lastSeen = Date.now();
    this.stats.observations++;

    return sig;
  }

  /**
   * Record a trade outcome (trade closed with PnL)
   * Called by OrderExecutor when position closes
   * 
   * @param {number[]} features - 9-element feature vector from entry
   * @param {Object} outcome - { pnl: number, pnlPercent: number, holdTimeMs: number, exitReason: string, strategy: string }
   * @returns {boolean} Success
   */
  recordOutcome(features, outcome) {
    if (!this._validateFeatures(features)) return false;
    if (!outcome || typeof outcome.pnl !== 'number') return false;

    const sig = computeSignature(features);
    if (!sig) return false;

    // Create pattern if it wasn't observed first (edge case)
    if (!this.patterns[sig]) {
      this.patterns[sig] = this._createPattern(sig, features);
    }

    const p = this.patterns[sig];
    const isWin = outcome.pnl > 0;

    // Update stats
    if (isWin) {
      p.wins++;
    } else if (outcome.pnl < 0) {
      p.losses++;
    }

    p.totalPnL += outcome.pnl;
    const totalTrades = p.wins + p.losses;
    p.winRate = totalTrades > 0 ? p.wins / totalTrades : 0;
    p.avgPnL = totalTrades > 0 ? p.totalPnL / totalTrades : 0;
    p.lastOutcome = Date.now();

    // Track outcome history (keep last 20)
    p.outcomes.push({
      timestamp: Date.now(),
      pnl: outcome.pnl,
      pnlPercent: outcome.pnlPercent || 0,
      holdTimeMs: outcome.holdTimeMs || 0,
      exitReason: outcome.exitReason || 'unknown',
      strategy: outcome.strategy || 'unknown',
      isWin,
    });
    if (p.outcomes.length > 20) {
      p.outcomes = p.outcomes.slice(-20);
    }

    // Check promotion / quarantine
    this._evaluateStatus(p);

    this.stats.outcomes++;
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // READ — Query pattern confidence for trading decisions
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get confidence adjustment for current market conditions
   * Called by TRAI and StrategyOrchestrator
   * 
   * Uses two matching strategies:
   *   1. Exact signature match (fast, precise)
   *   2. DTW fuzzy match (slower, catches time-stretched patterns)
   * 
   * @param {number[]} features - 9-element feature vector
   * @returns {Object|null} { confidence, source, status, stats } or null
   */
  getConfidence(features) {
    if (!this._validateFeatures(features)) return null;

    // Try exact match first (fast)
    const sig = computeSignature(features);
    const exactMatch = this.patterns[sig];

    if (exactMatch) {
      const totalTrades = exactMatch.wins + exactMatch.losses;
      this.stats.exactMatches++;

      if (totalTrades < this.config.minSamples) {
        return {
          confidence: 0.5, // Neutral — not enough data
          source: 'insufficient_data',
          status: 'learning',
          stats: this._getPatternStats(exactMatch),
        };
      }

      // Apply time decay
      const decayedWR = this._applyDecay(exactMatch);

      return {
        confidence: decayedWR,
        source: decayedWR >= this.config.successThreshold ? 'learned_success' :
                decayedWR < this.config.failureThreshold ? 'learned_failure' : 'neutral',
        status: exactMatch.status,
        stats: this._getPatternStats(exactMatch),
      };
    }

    // Try DTW fuzzy match (slower, for time-stretched patterns)
    const dtwMatch = this._findDTWMatch(features);
    if (dtwMatch) {
      this.stats.dtwMatches++;
      const totalTrades = dtwMatch.pattern.wins + dtwMatch.pattern.losses;

      if (totalTrades < this.config.minSamples) {
        return {
          confidence: 0.5,
          source: 'dtw_insufficient',
          status: 'learning',
          similarity: dtwMatch.similarity,
          stats: this._getPatternStats(dtwMatch.pattern),
        };
      }

      const decayedWR = this._applyDecay(dtwMatch.pattern);
      // Scale confidence by similarity (80% similar = 80% of the learned confidence)
      const scaledConfidence = 0.5 + (decayedWR - 0.5) * dtwMatch.similarity;

      return {
        confidence: scaledConfidence,
        source: decayedWR >= this.config.successThreshold ? 'dtw_success' :
                decayedWR < this.config.failureThreshold ? 'dtw_failure' : 'dtw_neutral',
        status: dtwMatch.pattern.status,
        similarity: dtwMatch.similarity,
        stats: this._getPatternStats(dtwMatch.pattern),
      };
    }

    return null; // Unknown pattern
  }

  /**
   * Check if pattern should be avoided
   * Quick check for TRAI and StrategyOrchestrator pre-trade filter
   * 
   * @param {number[]} features
   * @returns {boolean}
   */
  shouldAvoid(features) {
    const result = this.getConfidence(features);
    if (!result) return false;
    return result.source === 'learned_failure' || result.source === 'dtw_failure';
  }

  /**
   * Check if pattern is promoted (proven winner)
   * 
   * @param {number[]} features
   * @returns {boolean}
   */
  isPromoted(features) {
    const result = this.getConfidence(features);
    if (!result) return false;
    return result.source === 'learned_success' || result.source === 'dtw_success';
  }

  // ═══════════════════════════════════════════════════════════════
  // PROMOTION & QUARANTINE
  // ═══════════════════════════════════════════════════════════════

  _evaluateStatus(pattern) {
    const totalTrades = pattern.wins + pattern.losses;
    if (totalTrades < this.config.minSamples) {
      pattern.status = 'learning';
      return;
    }

    const decayedWR = this._applyDecay(pattern);

    if (decayedWR >= this.config.successThreshold) {
      if (pattern.status !== 'promoted') {
        pattern.status = 'promoted';
        pattern.promotedAt = Date.now();
        this.stats.promoted++;
        console.log(`🏆 [PATTERN PROMOTED] ${pattern.signature}: ${(decayedWR * 100).toFixed(1)}% WR over ${totalTrades} trades`);
      }
    } else if (decayedWR < this.config.failureThreshold) {
      if (pattern.status !== 'quarantined') {
        pattern.status = 'quarantined';
        pattern.quarantinedAt = Date.now();
        this.stats.quarantined++;
        console.log(`⛔ [PATTERN QUARANTINED] ${pattern.signature}: ${(decayedWR * 100).toFixed(1)}% WR over ${totalTrades} trades`);
      }
    } else {
      pattern.status = 'neutral';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TIME DECAY — recent trades weighted more than old ones
  // ═══════════════════════════════════════════════════════════════

  _applyDecay(pattern) {
    if (!pattern.outcomes || pattern.outcomes.length === 0) {
      return pattern.winRate;
    }

    const halflifeMs = this.config.decayHalflifeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let weightedWins = 0;
    let weightedTotal = 0;

    for (const outcome of pattern.outcomes) {
      const age = now - outcome.timestamp;
      const weight = Math.pow(0.5, age / halflifeMs);
      weightedTotal += weight;
      if (outcome.isWin) {
        weightedWins += weight;
      }
    }

    if (weightedTotal === 0) return pattern.winRate;
    return weightedWins / weightedTotal;
  }

  // ═══════════════════════════════════════════════════════════════
  // DTW FUZZY MATCHING
  // ═══════════════════════════════════════════════════════════════

  _findDTWMatch(features) {
    const normFeatures = normalize(features);
    let bestMatch = null;
    let bestSimilarity = 0;

    // Only search patterns with enough data
    for (const [sig, pattern] of Object.entries(this.patterns)) {
      const totalTrades = pattern.wins + pattern.losses;
      if (totalTrades < 3) continue; // Skip very sparse patterns
      if (!pattern.features || pattern.features.length !== features.length) continue;

      const normStored = normalize(pattern.features);
      const distance = dynamicTimeWarping(normFeatures, normStored);
      const similarity = Math.max(0, 1 - (distance / (features.length * 1.8)));

      if (similarity > this.config.dtwThreshold && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = { pattern, similarity };
      }
    }

    return bestMatch;
  }

  // ═══════════════════════════════════════════════════════════════
  // PRUNING — remove stale and useless patterns
  // ═══════════════════════════════════════════════════════════════

  prune() {
    const maxAgeMs = this.config.maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let pruned = 0;

    for (const [sig, pattern] of Object.entries(this.patterns)) {
      const age = now - pattern.firstSeen;
      const totalTrades = pattern.wins + pattern.losses;

      // Prune old patterns with few trades
      if (age > maxAgeMs && totalTrades < 3) {
        delete this.patterns[sig];
        pruned++;
        continue;
      }

      // Prune patterns that haven't been seen in 2x max age
      if (now - pattern.lastSeen > maxAgeMs * 2) {
        delete this.patterns[sig];
        pruned++;
        continue;
      }
    }

    // If still over limit, prune least useful
    const entries = Object.entries(this.patterns);
    if (entries.length > this.config.maxPatterns) {
      // Sort by usefulness: promoted > neutral > quarantined, then by recency
      entries.sort((a, b) => {
        const statusOrder = { promoted: 0, neutral: 1, learning: 2, quarantined: 3 };
        const statusDiff = (statusOrder[a[1].status] || 2) - (statusOrder[b[1].status] || 2);
        if (statusDiff !== 0) return statusDiff;
        return b[1].lastSeen - a[1].lastSeen;
      });

      // Keep only maxPatterns
      const toKeep = entries.slice(0, this.config.maxPatterns);
      this.patterns = Object.fromEntries(toKeep);
      pruned += entries.length - toKeep.length;
    }

    if (pruned > 0) {
      console.log(`[UnifiedPatternMemory] Pruned ${pruned} patterns. Remaining: ${Object.keys(this.patterns).length}`);
    }
    this.stats.lastPruneTime = now;
  }

  // ═══════════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════════

  save() {
    if (!this.config.persistToDisk) return;

    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        version: 2,
        savedAt: new Date().toISOString(),
        stats: this.stats,
        config: {
          minSamples: this.config.minSamples,
          successThreshold: this.config.successThreshold,
          failureThreshold: this.config.failureThreshold,
        },
        patternCount: Object.keys(this.patterns).length,
        patterns: this.patterns,
      };

      // Atomic write: write to temp, rename
      const tmpPath = this.storagePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data));
      fs.renameSync(tmpPath, this.storagePath);
    } catch (err) {
      console.error(`[UnifiedPatternMemory] Save failed: ${err.message}`);
    }
  }

  _load() {
    if (!this.config.persistToDisk) return;

    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(raw);

        if (data.version === 2 && data.patterns) {
          this.patterns = data.patterns;
          this.stats = { ...this.stats, ...data.stats };
          console.log(`[UnifiedPatternMemory] Loaded ${Object.keys(this.patterns).length} patterns from disk`);
        } else {
          console.log('[UnifiedPatternMemory] Incompatible version, starting fresh');
        }
      }
    } catch (err) {
      console.error(`[UnifiedPatternMemory] Load failed: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  _createPattern(signature, features) {
    return {
      signature,
      features: [...features],
      status: 'learning', // learning | neutral | promoted | quarantined
      timesSeen: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0,
      winRate: 0,
      avgPnL: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      lastOutcome: null,
      promotedAt: null,
      quarantinedAt: null,
      outcomes: [],
    };
  }

  _validateFeatures(features) {
    if (!Array.isArray(features) || features.length === 0) return false;
    if (features.length > 50) return false;
    return true;
  }

  _getPatternStats(pattern) {
    return {
      totalTrades: pattern.wins + pattern.losses,
      wins: pattern.wins,
      losses: pattern.losses,
      winRate: pattern.winRate,
      avgPnL: pattern.avgPnL,
      timesSeen: pattern.timesSeen,
      status: pattern.status,
      age: Date.now() - pattern.firstSeen,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC STATS — for dashboard and health checks
  // ═══════════════════════════════════════════════════════════════

  getStats() {
    const patterns = Object.values(this.patterns);
    return {
      total: patterns.length,
      learning: patterns.filter(p => p.status === 'learning').length,
      neutral: patterns.filter(p => p.status === 'neutral').length,
      promoted: patterns.filter(p => p.status === 'promoted').length,
      quarantined: patterns.filter(p => p.status === 'quarantined').length,
      totalObservations: this.stats.observations,
      totalOutcomes: this.stats.outcomes,
      exactMatches: this.stats.exactMatches,
      dtwMatches: this.stats.dtwMatches,
    };
  }

  healthCheck() {
    const stats = this.getStats();
    const healthy = stats.total > 0 && stats.totalOutcomes > 0;
    return {
      healthy,
      ...stats,
      issues: [
        ...(stats.total === 0 ? ['No patterns stored'] : []),
        ...(stats.totalOutcomes === 0 ? ['No outcomes recorded — learning disabled?'] : []),
        ...(stats.promoted === 0 && stats.totalOutcomes > 100 ? ['No patterns promoted after 100+ outcomes'] : []),
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // COMPATIBILITY API — for EnhancedPatternRecognition migration
  // These methods adapt the old PatternMemorySystem API to the new UnifiedPatternMemory
  // ═══════════════════════════════════════════════════════════════

  /**
   * Record a pattern result (compatibility with PatternMemorySystem)
   * @param {number[]} features - Feature vector
   * @param {Object} result - { pnl: number, timestamp?: number }
   * @returns {boolean}
   */
  recordPattern(features, result) {
    if (!features || !Array.isArray(features) || features.length === 0 || !result) {
      return false;
    }

    // If pnl is provided, this is an outcome; otherwise it's an observation
    if (typeof result.pnl === 'number') {
      return this.recordOutcome(features, {
        pnl: result.pnl,
        pnlPercent: result.pnl, // Old API uses pnl as percentage
        exitReason: result.reason || 'unknown',
        strategy: result.strategy || 'unknown',
      });
    } else {
      // Just observation (pattern detected, no outcome yet)
      this.recordObservation(features, {
        timestamp: result.timestamp || Date.now(),
        strategy: result.strategy,
      });
      return true;
    }
  }

  /**
   * Get pattern stats (compatibility with PatternMemorySystem)
   * @param {number[]} features
   * @returns {Object|null}
   */
  getPatternStats(features) {
    if (!this._validateFeatures(features)) return null;
    const sig = computeSignature(features);
    const p = this.patterns[sig];
    if (!p) return null;
    return {
      timesSeen: p.timesSeen,
      wins: p.wins,
      losses: p.losses,
      totalPnL: p.totalPnL,
      results: p.outcomes.map(o => ({ timestamp: o.timestamp, pnl: o.pnl, success: o.isWin })),
    };
  }

  /**
   * Evaluate a pattern (compatibility with PatternMemorySystem)
   * @param {number[]} features
   * @param {Object} options
   * @returns {Object}
   */
  evaluatePattern(features, options = {}) {
    const result = this.getConfidence(features);

    if (!result) {
      return {
        confidence: 0.1,
        direction: 'hold',
        reason: 'Unknown pattern',
        bestMatch: null,
      };
    }

    const direction = result.confidence >= 0.6 ? 'buy' :
                      result.confidence <= 0.4 ? 'sell' : 'hold';

    return {
      confidence: result.confidence,
      direction,
      reason: result.source,
      quality: result.stats ? result.stats.totalTrades / 10 : 0,
      bestMatch: result.stats ? { pattern: 'DTW_MATCH', ...result.stats } : null,
      timesSeen: result.stats?.timesSeen || 0,
      winRate: result.stats?.winRate || 0,
      avgPnL: result.stats?.avgPnL || 0,
    };
  }

  /**
   * Find similar patterns (compatibility with PatternMemorySystem)
   * @param {number[]|Object} featuresOrQuery
   * @param {number} threshold
   * @param {number} limit
   * @returns {Array}
   */
  findSimilarPatterns(featuresOrQuery, threshold = 0.8, limit = 5) {
    // Handle both array and object input
    const features = Array.isArray(featuresOrQuery)
      ? featuresOrQuery
      : (featuresOrQuery.features || []);

    if (!this._validateFeatures(features)) return [];

    const matches = [];
    const normFeatures = normalize(features);

    for (const [sig, pattern] of Object.entries(this.patterns)) {
      if (!pattern.features || pattern.features.length !== features.length) continue;

      const normStored = normalize(pattern.features);
      const distance = dynamicTimeWarping(normFeatures, normStored);
      const similarity = Math.max(0, 1 - (distance / (features.length * 1.8)));

      if (similarity >= threshold) {
        matches.push({
          ...this._getPatternStats(pattern),
          similarity,
          signature: sig,
          successRate: pattern.winRate,
        });
      }
    }

    // Sort by similarity descending, limit results
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, limit);
  }

  /**
   * Cleanup — call on shutdown
   */
  async cleanup() {
    if (this._saveTimer) {
      clearInterval(this._saveTimer);
      this._saveTimer = null;
    }
    this.prune();
    this.save();
    console.log(`[UnifiedPatternMemory] Cleanup complete. ${Object.keys(this.patterns).length} patterns saved.`);
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let _instance = null;

function getInstance(config) {
  if (!_instance) {
    _instance = new UnifiedPatternMemory(config);
  }
  return _instance;
}

module.exports = { UnifiedPatternMemory, getInstance, computeSignature };
