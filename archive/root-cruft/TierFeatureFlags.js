/**
 * TierFeatureFlags - Subscription tier management for OGZ Trading System
 *
 * IMPORTANT: This class now DELEGATES to FeatureFlagManager for all feature checks.
 * It's kept for backward compatibility but FeatureFlagManager is the source of truth.
 *
 * The tier system provides SCALING (multipliers, limits) on top of feature TOGGLES.
 * Toggles are controlled in config/features.json.
 *
 * @deprecated Prefer using FeatureFlagManager.getInstance() directly
 */

const FeatureFlagManager = require('./core/FeatureFlagManager');

class TierFeatureFlags {
  constructor(tier = 'ml') {
    this.tier = tier.toLowerCase();

    // Get the singleton FeatureFlagManager
    this.flagManager = FeatureFlagManager.getInstance();

    // Legacy features object for backward compatibility
    // Maps old feature names to new unified system
    this.features = this._buildLegacyFeatures();

    console.log(`🎭 TierFeatureFlags initialized for ${this.tier} tier (delegating to FeatureFlagManager)`);
  }

  /**
   * Build legacy features object from FeatureFlagManager
   * This provides backward compatibility for code that accesses this.features directly
   */
  _buildLegacyFeatures() {
    const tierScaling = this._getTierScaling();

    return {
      // Tier-specific scaling values
      patterns: this.tier === 'ml' ? 'AI-Powered (Unlimited)' : 'All (25+)',
      maxPositions: tierScaling.maxPositions,
      multiDirectional: true,
      quantum: this.tier === 'elite' || this.tier === 'ml',
      leverage: tierScaling.leverage,
      riskManagement: this.tier === 'ml' ? 'Quantum AI + TRAI' : 'Elite',
      analytics: this.tier === 'ml' ? 'Quantum AI + TRAI' : 'Elite',
      strategies: ['All Available'],
      maxDailyTrades: tierScaling.maxDailyTrades,
      stopLoss: true,
      takeProfit: true,
      trailingStop: true,
      arbitrage: this.tier === 'elite' || this.tier === 'ml',
      optionsTrading: this.tier === 'elite' || this.tier === 'ml',
      futuresTrading: this.tier === 'elite' || this.tier === 'ml',
      forexTrading: this.tier !== 'starter',
      cryptoTrading: true,
      mlLearning: true,
      customIndicators: true,
      backtesting: this.tier === 'ml' ? 'Quantum AI + TRAI' : 'Professional',
      liveAlerts: true,
      apiAccess: this.tier === 'ml' ? 'Full + AI + TRAI' : 'Full',
      priority: this.tier === 'ml' ? 'GOD MODE' : 'VIP',

      // Feature toggles - DELEGATE to FeatureFlagManager
      traiEnabled: this.flagManager.isEnabled('TRAI_INFERENCE'),
      traiBacktestAnalysis: this.flagManager.isEnabled('TRAI_INFERENCE'),
      unlimitedFeatures: this.tier === 'ml',

      // OGZ TPO features - DELEGATE to FeatureFlagManager
      ogzTpoEnabled: this.flagManager.isEnabled('OGZ_TPO'),
      ogzTpoMode: this.flagManager.getSetting('OGZ_TPO', 'mode', 'standard'),
      ogzTpoDynamicSL: this.flagManager.getSetting('OGZ_TPO', 'dynamicSL', true),
      ogzTpoConfluence: this.flagManager.getSetting('OGZ_TPO', 'confluence', false),
      ogzTpoVoteWeight: this.flagManager.getSetting('OGZ_TPO', 'voteWeight', 0.25),
      ogzTpoAdaptive: this.flagManager.getSetting('OGZ_TPO', 'adaptive', false),

      // Derived features for compatibility
      quantumPositionSizer: this.flagManager.isEnabled('PATTERN_BASED_SIZING'),
      patternsEnabled: this.flagManager.isEnabled('PATTERN_DOMINANCE'),
      patternsMaxPatterns: tierScaling.patternLimit
    };
  }

  /**
   * Get tier-specific scaling values
   */
  _getTierScaling() {
    const scaling = {
      starter: { maxPositions: 5, leverage: 1, maxDailyTrades: 50, patternLimit: 10 },
      pro: { maxPositions: 10, leverage: 2, maxDailyTrades: 200, patternLimit: 50 },
      elite: { maxPositions: 20, leverage: 5, maxDailyTrades: 500, patternLimit: 100 },
      ml: { maxPositions: 50, leverage: 10, maxDailyTrades: 1000, patternLimit: 10000 }
    };
    return scaling[this.tier] || scaling.elite;
  }

  /**
   * Check if a feature is enabled
   * DELEGATES to FeatureFlagManager (source of truth)
   */
  isEnabled(feature) {
    // First check FeatureFlagManager
    if (this.flagManager.isEnabled(feature)) {
      return true;
    }

    // Fallback to legacy features object for tier-specific booleans
    const parts = feature.split('.');
    let value = this.features;
    for (const part of parts) {
      value = value && value[part];
    }
    return value || false;
  }

  /**
   * Check if feature exists (alias for hasFeature)
   * DELEGATES to FeatureFlagManager
   */
  hasFeature(feature) {
    return this.flagManager.hasFeature(feature) || this.isEnabled(feature);
  }

  /**
   * Get feature value for current tier
   */
  getValue(feature) {
    // Check FeatureFlagManager settings first
    const settings = this.flagManager.getSettings(feature);
    if (Object.keys(settings).length > 0) {
      return settings;
    }
    return this.features[feature];
  }

  /**
   * Get feature value with nested path support
   */
  getFeatureValue(feature) {
    const parts = feature.split('.');
    let value = this.features;
    for (const part of parts) {
      value = value && value[part];
    }
    return value;
  }

  /**
   * Get tier summary for display
   */
  getTierSummary() {
    return {
      tier: this.tier,
      patterns: this.features.patterns,
      maxPositions: this.features.maxPositions,
      multiDirectional: this.features.multiDirectional,
      quantum: this.features.quantum,
      leverage: this.features.leverage,
      analytics: this.features.analytics,
      strategies: this.features.strategies.join(', '),
      maxDailyTrades: this.features.maxDailyTrades
    };
  }

  /**
   * Check if user can access a specific trading feature
   */
  canTrade(asset) {
    return this.flagManager.canTrade(asset);
  }

  /**
   * Check if user can use a specific strategy
   */
  canUseStrategy(strategy) {
    if (this.features.strategies.includes('All Available')) {
      return true;
    }
    return this.features.strategies.includes(strategy);
  }

  /**
   * Get maximum position size based on tier
   */
  getMaxPositionSize(baseSize) {
    return this.flagManager.getMaxPositionSize(baseSize);
  }

  /**
   * Check if user has reached daily trade limit
   */
  canMakeMoreTrades(currentTrades) {
    return this.flagManager.canMakeMoreTrades(currentTrades);
  }

  /**
   * Get pattern detector based on tier
   * @deprecated Prefer using EnhancedPatternRecognition directly
   */
  getPatternDetector() {
    if (!this.flagManager.isEnabled('PATTERN_DOMINANCE')) {
      return null;
    }

    switch(this.tier) {
      case 'ml':
        try {
          const { EnhancedPatternChecker } = require('./core/EnhancedPatternRecognition.js');
          return new EnhancedPatternChecker({
            unlimitedPatterns: true,
            aiPowered: true,
            maxPatterns: 1000
          });
        } catch (error) {
          console.log('⚠️ EnhancedPatternRecognition not available');
          return null;
        }

      case 'elite':
      case 'pro':
        try {
          const { EnhancedPatternChecker } = require('./core/EnhancedPatternRecognition.js');
          return new EnhancedPatternChecker();
        } catch (error) {
          return null;
        }

      default:
        return null;
    }
  }

  /**
   * Get tier upgrade recommendations
   */
  getUpgradeRecommendations() {
    if (this.tier === 'starter') {
      return {
        nextTier: 'pro',
        benefits: ['Multi-directional trading', 'Advanced patterns', 'ML learning systems', 'Forex trading', 'Live alerts']
      };
    } else if (this.tier === 'pro') {
      return {
        nextTier: 'elite',
        benefits: ['Quantum features', 'Options & Futures trading', 'Professional backtesting', 'Full API access', 'VIP support']
      };
    }
    return { nextTier: null, benefits: ['You have the highest tier!'] };
  }

  /**
   * Display tier information
   */
  displayTierInfo() {
    const summary = this.getTierSummary();
    console.log(`\n🏆 SUBSCRIPTION TIER: ${summary.tier.toUpperCase()}`);
    console.log(`📊 Patterns: ${summary.patterns}`);
    console.log(`💼 Max Positions: ${summary.maxPositions}`);
    console.log(`🔄 Multi-Directional: ${summary.multiDirectional ? 'YES' : 'NO'}`);
    console.log(`⚛️ Quantum Features: ${summary.quantum ? 'ENABLED' : 'DISABLED'}`);
    console.log(`📈 Max Leverage: ${summary.leverage}x`);
    console.log(`🎯 Strategies: ${summary.strategies}`);
    console.log(`📈 Daily Trades: ${summary.maxDailyTrades}`);
  }
}

module.exports = TierFeatureFlags;
