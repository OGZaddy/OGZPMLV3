/**
 * ExitContractManager.js - Strategy-Owned Exit System
 * =====================================================
 * Each trade stores its own exit conditions frozen at entry.
 * Exit evaluation checks ONLY the trade's contract, not aggregate confidence.
 *
 * ARCHITECTURE:
 * - Entry: Strategy generates exitContract with SL/TP/invalidation
 * - Trade: exitContract stored on trade object, immutable after entry
 * - Exit: Only check this trade's contract, ignore other strategies
 *
 * FIX 2026-02-17: Stops premature exits caused by unrelated strategy confidence drops
 *
 * @module core/ExitContractManager
 */

'use strict';

// Phase 1 REWRITE: Single source of truth for all trading params
const TradingConfig = require('./TradingConfig');

// Phase 10: Delegate to individual exit checkers
const StopLossChecker = require('./exit/StopLossChecker');
const TakeProfitChecker = require('./exit/TakeProfitChecker');
const DynamicTrailingStop = require('./exit/DynamicTrailingStop');
const MaxHoldChecker = require('./exit/MaxHoldChecker');
// Phase 11: Break-even state machine (single source of truth)
const BreakEvenManager = require('./exit/BreakEvenManager');

/**
 * Exit contracts and universal limits now come from TradingConfig (single source of truth)
 * Phase 1 REWRITE: Eliminated hardcoded duplicates - TradingConfig owns all trading params
 */
const DEFAULT_CONTRACTS = TradingConfig.BASE_CONFIG.exitContracts;
const UNIVERSAL_LIMITS = TradingConfig.BASE_CONFIG.universalLimits;

class ExitContractManager {
  constructor() {
    // Phase 1 REWRITE: Read from TradingConfig (single source of truth)
    this.universalLimits = TradingConfig.BASE_CONFIG.universalLimits;
    this.defaultContracts = TradingConfig.BASE_CONFIG.exitContracts;

    // Phase 10: Delegate to individual checkers
    this.stopLossChecker = new StopLossChecker(this.universalLimits);
    this.takeProfitChecker = new TakeProfitChecker();
    this.trailingStopChecker = new DynamicTrailingStop();
    this.maxHoldChecker = new MaxHoldChecker(this.universalLimits);
    // Phase 11: Break-even state machine (for external access/dashboard)
    this.breakEvenManager = new BreakEvenManager();
  }

  /**
   * Get default exit contract for a strategy type
   * @param {string} strategyName - Name of the strategy
   * @returns {Object} Exit contract with SL/TP/invalidation
   */
  getDefaultContract(strategyName) {
    // FIX 2026-02-24: Validate strategyName is a string (Phase 12 fuzzing)
    if (typeof strategyName !== 'string' || !strategyName) {
      strategyName = 'default';
    }

    // Try exact match first
    if (this.defaultContracts[strategyName]) {
      return { ...this.defaultContracts[strategyName] };
    }

    // Try partial match
    const lowerName = strategyName.toLowerCase();
    if (lowerName.includes('ema') || lowerName.includes('crossover')) {
      return { ...this.defaultContracts.EMASMACrossover };
    }
    if (lowerName.includes('sweep') || lowerName.includes('liquidity')) {
      return { ...this.defaultContracts.LiquiditySweep };
    }
    if (lowerName.includes('sr') || lowerName.includes('support') || lowerName.includes('resistance')) {
      return { ...this.defaultContracts.MADynamicSR };
    }
    if (lowerName.includes('candle') || lowerName.includes('pattern')) {
      return { ...this.defaultContracts.CandlePattern };
    }
    if (lowerName.includes('regime')) {
      return { ...this.defaultContracts.MarketRegime };
    }
    if (lowerName.includes('mtf') || lowerName.includes('timeframe')) {
      return { ...this.defaultContracts.MultiTimeframe };
    }

    return { ...this.defaultContracts.default };
  }

  /**
   * Check if exit conditions are met for a trade
   * Phase 10: Delegates to individual checkers
   * @param {Object} trade - Trade object with exitContract
   * @param {number} currentPrice - Current market price
   * @param {Object} context - { indicators, accountBalance, initialBalance, currentTime }
   * @returns {Object} { shouldExit, exitReason, details }
   */
  checkExitConditions(trade, currentPrice, context = {}) {
    if (!trade || !trade.entryPrice) {
      return { shouldExit: false, exitReason: null, details: 'No valid trade' };
    }

    const entryPrice = trade.entryPrice;
    const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    const holdTimeMinutes = context.currentTime
      ? (context.currentTime - trade.entryTime) / 60000
      : (Date.now() - trade.entryTime) / 60000;

    const contract = trade.exitContract || this.getDefaultContract(trade.entryStrategy || 'default');
    // Ensure trade has contract for checkers
    if (!trade.exitContract) trade.exitContract = contract;

    // PRIORITY ORDER: StopLoss > TakeProfit > TrailingStop > MaxHold > Invalidation

    // 1. Stop loss + universal circuit breakers
    const slResult = this.stopLossChecker.check(trade, currentPrice, pnlPercent, context);
    if (slResult.shouldExit) return slResult;

    // 2. Take profit
    const tpResult = this.takeProfitChecker.check(trade, pnlPercent);
    if (tpResult.shouldExit) return tpResult;

    // 3. Dynamic trailing stop (passes market context for ATR/trend-aware trailing)
    const tsResult = this.trailingStopChecker.check(trade, pnlPercent, {
      atr: context.indicators?.atr || 0,
      price: currentPrice,
      trend: context.indicators?.trend || context.indicators?.regime || 'sideways',
      rsi: context.indicators?.rsi || 50,
      nearestStructure: context.indicators?.nearestStructure || null
    });
    if (tsResult.shouldExit) return tsResult;

    // 4. Max hold time
    const mhResult = this.maxHoldChecker.check(trade, holdTimeMinutes, pnlPercent);
    if (mhResult.shouldExit) return mhResult;

    // 5. Invalidation conditions (stays in ECM — strategy-specific)
    if (contract.invalidationConditions && contract.invalidationConditions.length > 0 && context.indicators) {
      const invalidation = this.checkInvalidationConditions(
        contract.invalidationConditions,
        trade,
        context.indicators
      );
      if (invalidation.triggered) {
        return {
          shouldExit: true,
          exitReason: 'invalidation',
          details: `${trade.entryStrategy || 'Strategy'} invalidated: ${invalidation.reason}`,
          confidence: 90
        };
      }
    }

    // No exit condition met
    return {
      shouldExit: false,
      exitReason: null,
      details: `Holding: P&L ${pnlPercent.toFixed(2)}%, hold ${holdTimeMinutes.toFixed(0)} min`
    };
  }

  /**
   * Check strategy-specific invalidation conditions
   * @param {Array} conditions - Array of condition strings
   * @param {Object} trade - Trade object
   * @param {Object} indicators - Current market indicators
   * @returns {Object} { triggered, reason }
   */
  checkInvalidationConditions(conditions, trade, indicators) {
    for (const condition of conditions) {
      switch (condition) {
        case 'ema_cross_reversal':
          // EMA crossover reversed (e.g., golden cross → death cross)
          if (trade.entryIndicators?.ema9 > trade.entryIndicators?.ema20 &&
              indicators.ema9 < indicators.ema20) {
            return { triggered: true, reason: 'EMA cross reversed (bullish → bearish)' };
          }
          break;

        case 'regime_change':
          // Market regime changed from entry
          if (trade.entryIndicators?.regime &&
              indicators.regime &&
              trade.entryIndicators.regime !== indicators.regime) {
            return { triggered: true, reason: `Regime changed: ${trade.entryIndicators.regime} → ${indicators.regime}` };
          }
          break;

        case 'sr_level_broken':
          // Support/resistance level that triggered entry is now broken
          if (trade.customMetadata?.srLevel) {
            const level = trade.customMetadata.srLevel;
            if (level.type === 'support' && indicators.price < level.price * 0.995) {
              return { triggered: true, reason: `Support broken at ${level.price}` };
            }
            if (level.type === 'resistance' && indicators.price > level.price * 1.005) {
              return { triggered: true, reason: `Resistance broken at ${level.price}` };
            }
          }
          break;

        case 'pattern_negated':
          // Candle pattern that triggered entry is negated
          // This would need pattern-specific logic
          break;

        case 'sweep_invalidated':
          // Liquidity sweep setup is invalidated
          if (trade.customMetadata?.sweepBox) {
            const box = trade.customMetadata.sweepBox;
            // If price breaks back through the box in the wrong direction
            if (trade.direction === 'buy' && indicators.price < box.low * 0.99) {
              return { triggered: true, reason: 'Sweep box broken to downside' };
            }
          }
          break;

        case 'mtf_divergence':
          // Multi-timeframe alignment broke down
          if (trade.entryIndicators?.mtfAlignment &&
              indicators.mtfAlignment &&
              trade.entryIndicators.mtfAlignment !== indicators.mtfAlignment) {
            return { triggered: true, reason: 'MTF alignment diverged' };
          }
          break;
      }
    }

    return { triggered: false, reason: null };
  }

  /**
   * Update trade's max profit for trailing stop calculation
   * Phase 10: Delegates to TrailingStopChecker (single owner of maxProfitPercent)
   * @param {Object} trade - Trade object
   * @param {number} currentPrice - Current market price
   * @returns {number} Updated max profit percent
   */
  updateMaxProfit(trade, currentPrice) {
    return this.trailingStopChecker.updateMaxProfit(trade, currentPrice);
  }

  /**
   * Create an exit contract from strategy signal
   * @param {string} strategyName - Name of the triggering strategy
   * @param {Object} signal - Strategy's signal object
   * @param {Object} context - Market context at entry (includes timeframe)
   * @returns {Object} Complete exit contract
   */
  createExitContract(strategyName, signal = {}, context = {}) {
    // FIX 2026-02-24: Null safety for signal and context (Phase 12 fuzzing)
    if (!signal || typeof signal !== 'object') signal = {};
    if (!context || typeof context !== 'object') context = {};

    // Start with default contract for this strategy
    const contract = this.getDefaultContract(strategyName);

    // FIX 2026-03-19: Apply timeframe-specific exit parameters
    // 1m trades get tight stops (0.5%), 4h trades get wide stops (3.5%)
    const timeframe = context.timeframe || '15m';
    const tfConfig = TradingConfig.getTimeframeConfig(timeframe);
    if (tfConfig) {
      // Convert decimal to percent and apply as base (strategy can still override)
      contract.stopLossPercent = -1 * (tfConfig.slPct * 100);  // 0.015 → -1.5
      contract.takeProfitPercent = tfConfig.tpPct * 100;       // 0.025 → 2.5
      contract.trailingStopPercent = tfConfig.trailPct * 100;  // 0.010 → 1.0
      contract.maxHoldTimeMinutes = tfConfig.maxHoldMin;       // 120
      console.log(`[EXIT] Using ${timeframe} config: SL=${contract.stopLossPercent}%, TP=${contract.takeProfitPercent}%, Trail=${contract.trailingStopPercent}%`);
    }

    // Override with signal-specific values if provided
    if (signal.stopLossPercent !== undefined) {
      contract.stopLossPercent = signal.stopLossPercent;
    }
    if (signal.takeProfitPercent !== undefined) {
      contract.takeProfitPercent = signal.takeProfitPercent;
    }
    if (signal.trailingStopPercent !== undefined) {
      contract.trailingStopPercent = signal.trailingStopPercent;
    }
    if (signal.invalidationConditions) {
      contract.invalidationConditions = signal.invalidationConditions;
    }
    if (signal.maxHoldTimeMinutes !== undefined) {
      contract.maxHoldTimeMinutes = signal.maxHoldTimeMinutes;
    }

    // Adjust for volatility if provided
    // FIX 2026-02-21: Raised threshold from 2.0 to 5.0 for 1-minute data
    // On 1m candles, volatility 2.0 is normal - only widen on extreme vol
    // FIX 2026-03-19: Extracted hardcoded values to TradingConfig
    const volThreshold = TradingConfig.get('exits.volatilityThreshold') || 5.0;
    const volSlMult = TradingConfig.get('exits.volatilitySlMultiplier') || 1.15;
    const volTpMult = TradingConfig.get('exits.volatilityTpMultiplier') || 1.20;
    if (context.volatility && context.volatility > volThreshold) {
      // High volatility - widen stops
      contract.stopLossPercent *= volSlMult;
      contract.takeProfitPercent *= volTpMult;
    }

    // Freeze contract metadata
    contract.createdAt = Date.now();
    // FIX 2026-02-24: Ensure strategyName is string (Phase 12 fuzzing - NaN prevention)
    contract.strategyName = (typeof strategyName === 'string' && strategyName) ? strategyName : 'default';
    contract.signalConfidence = (typeof signal.confidence === 'number' && !isNaN(signal.confidence)) ? signal.confidence : 0;

    return contract;
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new ExitContractManager();
  }
  return instance;
}

module.exports = {
  ExitContractManager,
  getInstance,
  DEFAULT_CONTRACTS,
  UNIVERSAL_LIMITS
};
