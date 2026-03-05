/**
 * Pattern Quality Scoring System
 * Evaluates pattern performance history to optimize trade sizing
 * CHANGE 2.0.13 - Trading logic optimization based on pattern quality
 */

class PatternQualityScoring {
  constructor(patternMemory) {
    this.memory = patternMemory;
    this.cache = new Map(); // Cache scores for performance
    this.cacheTimeout = 60000; // Refresh every minute
  }

  /**
   * Get composite quality score for active patterns
   * @param {Array} patternIds - Active pattern IDs
   * @returns {Number} Score between -1 (terrible) and +1 (excellent)
   */
  getCompositeScore(patternIds) {
    if (!patternIds || patternIds.length === 0) return 0;

    const scores = patternIds.map(id => this.getPatternScore(id));
    const validScores = scores.filter(s => s !== null);

    if (validScores.length === 0) return 0;

    // Weighted average based on recency and sample size
    const weightedSum = validScores.reduce((sum, score) => sum + score, 0);
    return Math.max(-1, Math.min(1, weightedSum / validScores.length));
  }

  /**
   * Get individual pattern score
   * @param {String} patternId - Pattern key/ID
   * @returns {Number|null} Score or null if insufficient data
   */
  getPatternScore(patternId) {
    // Check cache first
    const cached = this.cache.get(patternId);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.score;
    }

    const pattern = this.memory.memory[patternId];
    if (!pattern) return null;

    // Need minimum samples
    if (pattern.timesSeen < 5) return null;

    const winRate = pattern.wins / pattern.timesSeen;
    const avgPnL = pattern.totalPnL / pattern.timesSeen;

    // Calculate score based on win rate and average PnL
    let score = 0;

    // Win rate component (0.6 weight)
    if (winRate >= 0.7) score += 0.6;
    else if (winRate >= 0.6) score += 0.3;
    else if (winRate >= 0.5) score += 0.1;
    else if (winRate < 0.4) score -= 0.3;

    // Average PnL component (0.4 weight)
    if (avgPnL > 2) score += 0.4;
    else if (avgPnL > 1) score += 0.2;
    else if (avgPnL > 0) score += 0.1;
    else if (avgPnL < -1) score -= 0.2;

    // Cache the score
    this.cache.set(patternId, { score, timestamp: Date.now() });

    return score;
  }

  /**
   * Calculate position size multiplier based on pattern quality
   * @param {Number} qualityScore - Composite quality score
   * @returns {Number} Size multiplier (0.25 to 1.5)
   */
  getSizeMultiplier(qualityScore) {
    // Safety clamp
    qualityScore = Math.max(-1, Math.min(1, qualityScore));

    if (qualityScore <= -0.5) return 0.25;  // Quarter size on bad patterns
    if (qualityScore <= 0) return 0.5;      // Half size on unproven patterns
    if (qualityScore <= 0.5) return 1.0;    // Normal size on decent patterns
    return 1.5;                             // Press size on elite patterns
  }

  /**
   * Check if this is an elite pattern for specific strategy
   * @param {String} patternId - Pattern key
   * @param {String} strategy - Strategy name (e.g., 'bipole')
   * @returns {Boolean}
   */
  isElitePattern(patternId, strategy = 'general') {
    const pattern = this.memory.memory[patternId];
    if (!pattern) return false;

    // Need sufficient data
    if (pattern.timesSeen < 10) return false;

    const winRate = pattern.wins / pattern.timesSeen;
    const avgPnL = pattern.totalPnL / pattern.timesSeen;

    // Elite criteria
    return winRate >= 0.65 && avgPnL >= 1.5;
  }

  /**
   * Get elite patterns from active set
   * @param {Array} patternIds - Active pattern IDs
   * @param {String} strategy - Strategy filter
   * @returns {Array} Elite pattern IDs only
   */
  getElitePatterns(patternIds, strategy = 'general') {
    if (!patternIds || patternIds.length === 0) return [];
    return patternIds.filter(id => this.isElitePattern(id, strategy));
  }

  /**
   * Build decision context for logging/analysis
   * @param {Object} params - Decision parameters
   * @returns {Object} Complete decision context
   */
  buildDecisionContext(params) {
    const {
      symbol,
      direction,
      patterns,
      indicators,
      regime,
      confidence,
      module = 'unknown'
    } = params;

    const patternIds = patterns?.map(p => p.signature || p.name) || [];
    const patternScores = {};
    patternIds.forEach(id => {
      const score = this.getPatternScore(id);
      if (score !== null) patternScores[id] = score;
    });

    const compositeScore = this.getCompositeScore(patternIds);
    const sizeMultiplier = this.getSizeMultiplier(compositeScore);
    const elitePatterns = this.getElitePatterns(patternIds);

    return {
      timestamp: Date.now(),
      symbol,
      direction,
      module,
      patternsActive: patternIds,
      patternScores,
      compositeScore,
      sizeMultiplier,
      elitePatterns,
      hasElite: elitePatterns.length > 0,
      regime: regime || 'unknown',
      confidence,
      indicators: {
        rsi: indicators?.rsi,
        macd: indicators?.macd?.macd,
        trend: indicators?.trend
      },
      reasonTags: this.generateReasonTags(params)
    };
  }

  /**
   * Generate reason tags for trade decision
   * @private
   */
  generateReasonTags(params) {
    const tags = [];

    if (params.module) tags.push(params.module);
    if (params.regime) tags.push(params.regime);
    if (params.direction) tags.push(params.direction.toLowerCase());

    const elitePatterns = this.getElitePatterns(params.patterns?.map(p => p.signature || p.name) || []);
    if (elitePatterns.length > 0) tags.push('elite_pattern');

    if (params.indicators?.rsi > 70) tags.push('overbought');
    if (params.indicators?.rsi < 30) tags.push('oversold');
    if (params.indicators?.trend === 'up') tags.push('uptrend');
    if (params.indicators?.trend === 'down') tags.push('downtrend');

    return tags;
  }

  /**
   * Log trade decision with full context
   * @param {Object} decisionContext - Context from buildDecisionContext
   * @param {String} action - Action taken (trade/skip/reduce)
   */
  logDecision(decisionContext, action) {
    console.log(`[TRADE_DECISION] ${action}`, {
      symbol: decisionContext.symbol,
      direction: decisionContext.direction,
      confidence: decisionContext.confidence,
      compositeScore: decisionContext.compositeScore,
      sizeMultiplier: decisionContext.sizeMultiplier,
      hasElite: decisionContext.hasElite,
      reasonTags: decisionContext.reasonTags.join(', ')
    });
  }
}

module.exports = PatternQualityScoring;