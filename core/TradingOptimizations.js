/**
 * @fileoverview TradingOptimizations - Surgical Trading Logic Improvements
 *
 * Modular trading optimizations with safe rollout via feature flags.
 * Each optimization pass is independently toggleable for safe deployment.
 *
 * @description
 * ARCHITECTURE ROLE:
 * TradingOptimizations sits between the decision layer and execution layer,
 * applying refinements to trade signals based on pattern performance history.
 *
 * OPTIMIZATION PASSES:
 * - Pass 1: Decision Context - Adds visibility/logging without behavior change
 * - Pass 2: Pattern-based Sizing - Scales position size based on pattern win rate
 * - Pass 3: Elite Bipole Filter - Filters trades to only elite patterns
 *
 * SAFE ROLLOUT:
 * Each pass can be enabled/disabled independently via config/features.json.
 * New optimizations should follow this pattern:
 * 1. Add config flag (default: false)
 * 2. Implement behind flag check
 * 3. Test in paper mode
 * 4. Enable in production
 *
 * PATTERN SIZE SCALING FORMULA:
 * ```
 * multiplier = clamp(winRate × avgR, minMultiplier, maxMultiplier)
 * adjustedSize = baseSize × multiplier
 * ```
 *
 * @module core/TradingOptimizations
 * @requires ./FeatureFlagManager
 *
 * @example
 * const { TradingOptimizations, PatternStatsManager } = require('./core/TradingOptimizations');
 * const stats = new PatternStatsManager();
 * const optimizations = new TradingOptimizations(stats, console);
 *
 * // Create decision context for logging
 * const context = optimizations.createDecisionContext({
 *   symbol: 'BTC/USD',
 *   direction: 'BUY',
 *   confidence: 75,
 *   patterns: ['bullish_engulfing']
 * });
 *
 * // Get pattern-adjusted position size
 * const adjustedSize = optimizations.getPatternAdjustedSize(baseSize, patterns);
 */

const fs = require('fs');
const path = require('path');

// Decision telemetry JSONL path (fire-and-forget)
const DECISION_LOG_PATH = path.join(__dirname, '..', 'logs', 'trai-decisions.log');
try { fs.mkdirSync(path.dirname(DECISION_LOG_PATH), { recursive: true }); } catch (_) {}

class TradingOptimizations {
  constructor(patternStats, logger) {
    this.patternStats = patternStats;
    this.logger = logger || console;

    // Load feature flags via unified FeatureFlagManager
    const FeatureFlagManager = require('./FeatureFlagManager');
    this.flagManager = FeatureFlagManager.getInstance();
    const patternSizingEnabled = this.flagManager.isEnabled('PATTERN_BASED_SIZING');

    // Configuration flags for safe rollout
    this.config = {
      enableDecisionContext: true,
      enablePatternSizeScaling: patternSizingEnabled,  // Now uses feature flag!
      enablePerfectBipoleFilter: false,

      // Size scaling parameters
      minSizeMultiplier: 0.25,
      maxSizeMultiplier: 1.5,

      // Elite pattern thresholds
      eliteMinUses: 10,
      eliteMinWinRate: 0.65,
      eliteMinAvgR: 0.5
    };
  }

  /**
   * PASS 1: Create decision context for every trade
   * This adds visibility without changing any behavior
   */
  createDecisionContext(params) {
    const {
      symbol,
      direction,
      confidence,
      patterns = [],
      patternScores = {},
      indicators = {},
      regime = 'unknown',
      module = 'standard',
      price,
      brainDirection = null
    } = params;

    const activePatternIds = patterns.map(p => p.id || p.signature || 'unknown');

    const decisionContext = {
      time: new Date().toISOString(),
      timestamp: Date.now(),
      symbol,
      price,
      direction,                          // 'LONG' | 'SHORT' | 'CLOSE'
      module,                             // 'bipole' | 'meanRevert' | 'breakout' | 'grid'
      patternsActive: activePatternIds,
      patternScores,
      patternCount: activePatternIds.length,
      regime,                            // 'trend' | 'chop' | 'highVol'
      confidence,

      // Indicators snapshot
      indicators: {
        rsi: indicators.rsi,
        macd: indicators.macd,
        trend: indicators.trend,
        volume: indicators.volume || 0
      },

      // Decision factors
      reasonTags: this.generateReasonTags(params),
      brainDirection,

      // Pattern quality score (for Pass 2)
      patternQuality: this.calculatePatternQuality(activePatternIds)
    };

    // Log the context for visibility
    this.logger.info('[TRADE_DECISION]', decisionContext);

    // ═══════════════════════════════════════════════════════════════
    // DECISION TELEMETRY - JSONL append (fire-and-forget, silent fail)
    // ═══════════════════════════════════════════════════════════════
    const tradingMode = process.env.BACKTEST_MODE === 'true' ? 'backtest' :
                        (process.env.TRADING_MODE === 'live' || process.env.ENABLE_LIVE_TRADING === 'true') ? 'live' : 'paper';

    const telemetry = {
      tsMs: Date.now(),
      type: 'trai_decision',
      decisionId: `dec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      cycleId: null,
      input: {
        symbol: decisionContext.symbol || 'BTC-USD',
        timeframe: '1m',
        action: decisionContext.direction,
        originalConfidence: decisionContext.confidence,
        regime: decisionContext.regime,
        trend: decisionContext.indicators?.trend,
        volatility: decisionContext.indicators?.volatility,
        indicators: {
          rsi: decisionContext.indicators?.rsi,
          macd: decisionContext.indicators?.macd?.macd,
          macdHistogram: decisionContext.indicators?.macd?.hist
        },
        patternIds: decisionContext.patternsActive?.slice(0, 5) || [],
        riskFlags: decisionContext.reasonTags || []
      },
      output: {
        decision: decisionContext.direction === 'LONG' ? 'BUY' : (decisionContext.direction === 'SHORT' ? 'SELL' : 'HOLD'),
        confidence: decisionContext.confidence / 100,
        reasonSummary: decisionContext.reasonTags?.join(', ') || '',
        patternQuality: decisionContext.patternQuality
      },
      meta: {
        version: 'v2.0.0-telem',
        adapterId: 'kraken',
        brokerId: process.env.BOT_TIER || 'quantum',
        mode: tradingMode,
        module: decisionContext.module
      }
    };

    fs.appendFile(DECISION_LOG_PATH, JSON.stringify(telemetry) + '\n', () => {});

    return decisionContext;
  }

  generateReasonTags(params) {
    const tags = [];

    // Module tag
    if (params.module) tags.push(params.module);

    // Market condition tags
    if (params.indicators?.trend === 'uptrend') tags.push('trendUp');
    if (params.indicators?.trend === 'downtrend') tags.push('trendDown');
    if (params.indicators?.rsi > 70) tags.push('overbought');
    if (params.indicators?.rsi < 30) tags.push('oversold');

    // Pattern tags
    if (params.patterns?.length > 3) tags.push('multiPattern');
    if (params.patterns?.length === 0) tags.push('noPattern');

    // Confidence tags
    if (params.confidence > 70) tags.push('highConf');
    if (params.confidence < 40) tags.push('lowConf');

    // Regime tags
    if (params.regime) tags.push(params.regime);

    return tags;
  }

  /**
   * PASS 2: Calculate pattern quality for position sizing
   * Returns a score between -1 and 1
   */
  calculatePatternQuality(patternIds) {
    if (!patternIds || patternIds.length === 0) return 0;

    let totalScore = 0;
    let validPatterns = 0;

    for (const patternId of patternIds) {
      const stats = this.patternStats?.getStats?.(patternId);
      if (!stats || stats.uses < 5) continue; // Skip new/rare patterns

      validPatterns++;

      // Calculate individual pattern score
      const winRate = stats.wins / stats.uses;
      const avgPnL = stats.totalPnL / stats.uses;

      // Score components
      const winRateScore = (winRate - 0.5) * 2;  // -1 to 1
      const pnlScore = Math.tanh(avgPnL / 100);   // Normalized PnL score

      // Weighted average
      const patternScore = (winRateScore * 0.7) + (pnlScore * 0.3);
      totalScore += patternScore;
    }

    if (validPatterns === 0) return 0;

    // Average score across all valid patterns
    const quality = totalScore / validPatterns;

    // Clamp between -1 and 1
    return Math.max(-1, Math.min(1, quality));
  }

  /**
   * PASS 2: Convert pattern quality to size multiplier
   * Maps quality score (-1 to 1) to size multiplier (0.25x to 1.5x)
   */
  sizeMultiplierFromPatternQuality(quality) {
    const q = Math.max(-1, Math.min(1, quality)); // Clamp

    if (!this.config.enablePatternSizeScaling) {
      return 1.0; // Default size if feature disabled
    }

    // Map quality to multiplier
    if (q <= -0.5) return this.config.minSizeMultiplier;  // 0.25x on trash patterns
    if (q <= 0)    return 0.5;                            // 0.5x on mediocre
    if (q <= 0.5)  return 1.0;                            // 1x on decent
    return this.config.maxSizeMultiplier;                 // 1.5x on elite
  }

  /**
   * Enhanced position sizing with pattern quality
   */
  calculatePositionSize(baseSize, patternIds, decisionContext) {
    const patternQuality = decisionContext?.patternQuality ||
                          this.calculatePatternQuality(patternIds);

    const multiplier = this.sizeMultiplierFromPatternQuality(patternQuality);
    const finalSize = baseSize * multiplier;

    // Log the adjustment
    if (multiplier !== 1.0) {
      this.logger.info('[SIZE_ADJUST]', {
        symbol: decisionContext?.symbol,
        baseSize,
        finalSize,
        patternQuality: patternQuality.toFixed(3),
        multiplier
      });
    }

    return finalSize;
  }

  /**
   * PASS 3: Check if pattern is elite for bipole trading
   */
  isEliteBipolePattern(patternId) {
    const stats = this.patternStats?.getStats?.(patternId);
    if (!stats) return false;

    const uses = stats.bipoleUses || stats.uses || 0;
    const wins = stats.bipoleWins || stats.wins || 0;
    const avgR = stats.bipoleAvgR || stats.avgPnL || 0;

    // Not enough data
    if (uses < this.config.eliteMinUses) return false;

    const winRate = wins / uses;

    // Check elite criteria
    return winRate >= this.config.eliteMinWinRate &&
           avgR >= this.config.eliteMinAvgR;
  }

  /**
   * Get all elite bipole patterns from active patterns
   */
  getEliteBipolePatterns(patternIds) {
    if (!this.config.enablePerfectBipoleFilter) {
      return patternIds; // Return all if feature disabled
    }

    return patternIds.filter(id => this.isEliteBipolePattern(id));
  }

  /**
   * Check if current setup qualifies as "perfect" for bipole
   */
  isPerfectBipoleSetup(patternIds, indicators = {}) {
    const elitePatterns = this.getEliteBipolePatterns(patternIds);

    if (elitePatterns.length === 0) {
      this.logger.info('[BIPOLE_SKIP]', {
        reason: 'no_elite_bipole_patterns',
        activePatterns: patternIds,
        timestamp: Date.now()
      });
      return false;
    }

    // Additional perfect setup criteria
    const perfectSetup = {
      hasElitePattern: true,
      elitePatternCount: elitePatterns.length,
      patterns: elitePatterns
    };

    // Could add more criteria here
    // e.g., RSI range, trend alignment, etc.

    return perfectSetup;
  }
}

/**
 * Pattern Stats Manager - Tracks pattern performance
 */
class PatternStatsManager {
  constructor() {
    this.stats = {};
    this.loadStats();
  }

  loadStats() {
    // Load from pattern memory file if exists
    try {
      const fs = require('fs');
      const path = require('path');
      const statsFile = path.join(process.cwd(), 'data', 'pattern-stats.json');

      if (fs.existsSync(statsFile)) {
        const data = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
        this.stats = data.stats || {};
      }
    } catch (err) {
      console.error('Error loading pattern stats:', err);
    }
  }

  saveStats() {
    try {
      const fs = require('fs');
      const path = require('path');
      const statsFile = path.join(process.cwd(), 'data', 'pattern-stats.json');

      fs.writeFileSync(statsFile, JSON.stringify({
        stats: this.stats,
        timestamp: Date.now()
      }, null, 2));
    } catch (err) {
      console.error('Error saving pattern stats:', err);
    }
  }

  getStats(patternId) {
    return this.stats[patternId] || {
      uses: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0,
      avgPnL: 0,
      bipoleUses: 0,
      bipoleWins: 0,
      bipoleAvgR: 0
    };
  }

  updateStats(patternId, result, module = 'standard') {
    if (!this.stats[patternId]) {
      this.stats[patternId] = {
        uses: 0,
        wins: 0,
        losses: 0,
        totalPnL: 0,
        avgPnL: 0,
        bipoleUses: 0,
        bipoleWins: 0,
        bipoleAvgR: 0
      };
    }

    const stats = this.stats[patternId];

    // Update general stats
    stats.uses++;
    if (result.success) {
      stats.wins++;
    } else {
      stats.losses++;
    }
    stats.totalPnL += result.pnl || 0;
    stats.avgPnL = stats.totalPnL / stats.uses;

    // Update module-specific stats
    if (module === 'bipole') {
      stats.bipoleUses = (stats.bipoleUses || 0) + 1;
      if (result.success) {
        stats.bipoleWins = (stats.bipoleWins || 0) + 1;
      }
      const totalBipoleR = (stats.bipoleAvgR || 0) * (stats.bipoleUses - 1) + (result.r || 0);
      stats.bipoleAvgR = totalBipoleR / stats.bipoleUses;
    }

    this.saveStats();
    return stats;
  }

  /**
   * Get composite score for multiple patterns
   */
  getCompositeScore(patternIds) {
    if (!patternIds || patternIds.length === 0) return 0;

    let totalScore = 0;
    let validPatterns = 0;

    for (const id of patternIds) {
      const stats = this.getStats(id);
      if (stats.uses < 3) continue; // Skip very new patterns

      const winRate = stats.wins / stats.uses;
      const score = (winRate - 0.5) * 2 + Math.tanh(stats.avgPnL / 100);

      totalScore += score;
      validPatterns++;
    }

    return validPatterns > 0 ? totalScore / validPatterns : 0;
  }
}

module.exports = { TradingOptimizations, PatternStatsManager };