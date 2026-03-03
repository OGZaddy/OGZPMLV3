/**
 * ModuleInitializer - Phase 21 Extraction
 *
 * Configuration factory helpers for the trading bot constructor.
 * Centralizes config creation logic to reduce constructor size.
 *
 * @module core/ModuleInitializer
 */

'use strict';

// Config - the only required import for config factory methods
const TradingConfig = require('./TradingConfig');

class ModuleInitializer {
  constructor() {
    console.log('[ModuleInitializer] Initialized (Phase 21)');
  }

  /**
   * Create trading brain configuration object
   * EXACT COPY from run-empire-v2.js constructor
   */
  createTradingBrainConfig(tierFlags, featureFlags) {
    return {
      // Tier settings
      enableQuantumSizing: tierFlags.hasQuantumPositionSizer,
      tier: tierFlags.tier,

      // CHANGE 2026-02-28: All trading params from TradingConfig (single source of truth)
      // Confidence
      minConfidenceThreshold: TradingConfig.get('confidence.minTradeConfidence'),
      maxConfidenceThreshold: TradingConfig.get('confidence.maxConfidence'),
      confidencePenalty: TradingConfig.get('confidence.confidencePenalty'),
      confidenceBoost: TradingConfig.get('confidence.confidenceBoost'),

      // Risk management
      maxRiskPerTrade: TradingConfig.get('risk.maxRiskPerTrade'),

      // Exit parameters
      stopLossPercent: TradingConfig.get('exits.stopLossPercent'),
      takeProfitPercent: TradingConfig.get('exits.takeProfitPercent'),
      trailingStopPercent: TradingConfig.get('exits.trailingStopPercent'),
      trailingStopActivation: TradingConfig.get('exits.trailingActivation'),
      profitProtectionLevel: TradingConfig.get('exits.profitProtectionLevel'),
      breakevenTrigger: TradingConfig.get('exits.breakevenTrigger'),
      breakevenPercentage: TradingConfig.get('exits.breakevenExitPercent'),
      postBreakevenTrailing: TradingConfig.get('exits.postBreakevenTrail'),

      // Position sizing
      basePositionSize: TradingConfig.get('positionSizing.basePositionSize'),
      maxPositionSize: TradingConfig.get('positionSizing.maxPositionSize'),
      lowVolatilityMultiplier: TradingConfig.get('positionSizing.lowVolMultiplier'),
      highVolatilityMultiplier: TradingConfig.get('positionSizing.highVolMultiplier'),
      volatilityThresholds: {
        low: TradingConfig.get('positionSizing.lowVolThreshold'),
        high: TradingConfig.get('positionSizing.highVolThreshold')
      },

      // Fund target
      houstonFundTarget: TradingConfig.get('fundTarget'),

      // Feature flags
      featureFlags: featureFlags.features || {},
      patternDominance: featureFlags.features?.PATTERN_DOMINANCE?.enabled || false
    };
  }
}

module.exports = ModuleInitializer;
