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

/**
 * Default exit contracts by strategy type
 * These are used when a strategy doesn't provide its own generateExitContract()
 */
const DEFAULT_CONTRACTS = {
  // EMA/SMA Crossover - trend following, wider stops
  EMASMACrossover: {
    stopLossPercent: -2.0,
    takeProfitPercent: 4.0,
    trailingStopPercent: 1.5,
    invalidationConditions: ['ema_cross_reversal'],
    maxHoldTimeMinutes: 240
  },

  // Liquidity Sweep - mean reversion, tighter targets
  LiquiditySweep: {
    stopLossPercent: -1.5,
    takeProfitPercent: 2.5,
    trailingStopPercent: 1.0,
    invalidationConditions: ['sweep_invalidated', 'box_broken'],
    maxHoldTimeMinutes: 90
  },

  // MA Dynamic S/R - support/resistance bounces
  MADynamicSR: {
    stopLossPercent: -1.8,
    takeProfitPercent: 3.0,
    trailingStopPercent: 1.2,
    invalidationConditions: ['sr_level_broken'],
    maxHoldTimeMinutes: 180
  },

  // Candle Pattern - quick setups
  CandlePattern: {
    stopLossPercent: -1.5,
    takeProfitPercent: 2.0,
    trailingStopPercent: 0.8,
    invalidationConditions: ['pattern_negated'],
    maxHoldTimeMinutes: 60
  },

  // Market Regime - longer holds in strong trends
  MarketRegime: {
    stopLossPercent: -2.5,
    takeProfitPercent: 5.0,
    trailingStopPercent: 2.0,
    invalidationConditions: ['regime_change'],
    maxHoldTimeMinutes: 360
  },

  // Multi-Timeframe - confluence trades, moderate stops
  MultiTimeframe: {
    stopLossPercent: -2.0,
    takeProfitPercent: 3.5,
    trailingStopPercent: 1.5,
    invalidationConditions: ['mtf_divergence'],
    maxHoldTimeMinutes: 180
  },

  // Default fallback for unknown strategies
  default: {
    stopLossPercent: -1.8,
    takeProfitPercent: 3.0,
    trailingStopPercent: 1.0,
    invalidationConditions: [],
    maxHoldTimeMinutes: 120
  }
};

/**
 * Universal circuit breakers - always enforced regardless of strategy
 */
const UNIVERSAL_LIMITS = {
  hardStopLossPercent: -3.0,      // Per-trade absolute max loss
  accountDrawdownPercent: -10.0,  // Force close all if account down 10%
  maxHoldTimeMinutes: 480         // 8 hour absolute max hold
};

class ExitContractManager {
  constructor() {
    this.universalLimits = UNIVERSAL_LIMITS;
    this.defaultContracts = DEFAULT_CONTRACTS;
  }

  /**
   * Get default exit contract for a strategy type
   * @param {string} strategyName - Name of the strategy
   * @returns {Object} Exit contract with SL/TP/invalidation
   */
  getDefaultContract(strategyName) {
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

    // === UNIVERSAL CIRCUIT BREAKERS (always checked first) ===

    // Hard stop loss - absolute per-trade limit
    if (pnlPercent <= this.universalLimits.hardStopLossPercent) {
      return {
        shouldExit: true,
        exitReason: 'hard_stop',
        details: `Universal hard stop: ${pnlPercent.toFixed(2)}% <= ${this.universalLimits.hardStopLossPercent}%`,
        confidence: 100
      };
    }

    // Account drawdown check
    if (context.accountBalance && context.initialBalance) {
      const accountDrawdown = ((context.accountBalance - context.initialBalance) / context.initialBalance) * 100;
      if (accountDrawdown <= this.universalLimits.accountDrawdownPercent) {
        return {
          shouldExit: true,
          exitReason: 'account_drawdown',
          details: `Account drawdown: ${accountDrawdown.toFixed(2)}% <= ${this.universalLimits.accountDrawdownPercent}%`,
          confidence: 100
        };
      }
    }

    // Universal max hold time
    if (holdTimeMinutes >= this.universalLimits.maxHoldTimeMinutes) {
      return {
        shouldExit: true,
        exitReason: 'max_hold_universal',
        details: `Universal max hold: ${holdTimeMinutes.toFixed(0)} min >= ${this.universalLimits.maxHoldTimeMinutes} min`,
        confidence: 100
      };
    }

    // === STRATEGY-SPECIFIC EXIT CONTRACT ===

    // Stop loss
    if (pnlPercent <= contract.stopLossPercent) {
      return {
        shouldExit: true,
        exitReason: 'stop_loss',
        details: `${trade.entryStrategy || 'Strategy'} SL: ${pnlPercent.toFixed(2)}% <= ${contract.stopLossPercent}%`,
        confidence: 100
      };
    }

    // Take profit
    if (pnlPercent >= contract.takeProfitPercent) {
      return {
        shouldExit: true,
        exitReason: 'take_profit',
        details: `${trade.entryStrategy || 'Strategy'} TP: ${pnlPercent.toFixed(2)}% >= ${contract.takeProfitPercent}%`,
        confidence: 100
      };
    }

    // Trailing stop (only if in profit above trailing threshold)
    if (contract.trailingStopPercent && trade.maxProfitPercent) {
      const trailTrigger = contract.trailingStopPercent;
      if (trade.maxProfitPercent >= trailTrigger) {
        const trailStop = trade.maxProfitPercent - contract.trailingStopPercent;
        if (pnlPercent <= trailStop) {
          return {
            shouldExit: true,
            exitReason: 'trailing_stop',
            details: `Trailing stop: P&L ${pnlPercent.toFixed(2)}% fell from peak ${trade.maxProfitPercent.toFixed(2)}%`,
            confidence: 100
          };
        }
      }
    }

    // Max hold time (strategy-specific)
    if (contract.maxHoldTimeMinutes && holdTimeMinutes >= contract.maxHoldTimeMinutes) {
      return {
        shouldExit: true,
        exitReason: 'max_hold',
        details: `${trade.entryStrategy || 'Strategy'} max hold: ${holdTimeMinutes.toFixed(0)} min >= ${contract.maxHoldTimeMinutes} min`,
        confidence: 80
      };
    }

    // Invalidation conditions (strategy-specific logic)
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
   * @param {Object} trade - Trade object
   * @param {number} currentPrice - Current market price
   * @returns {number} Updated max profit percent
   */
  updateMaxProfit(trade, currentPrice) {
    if (!trade || !trade.entryPrice) return 0;

    const pnlPercent = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
    trade.maxProfitPercent = Math.max(trade.maxProfitPercent || 0, pnlPercent);
    return trade.maxProfitPercent;
  }

  /**
   * Create an exit contract from strategy signal
   * @param {string} strategyName - Name of the triggering strategy
   * @param {Object} signal - Strategy's signal object
   * @param {Object} context - Market context at entry
   * @returns {Object} Complete exit contract
   */
  createExitContract(strategyName, signal = {}, context = {}) {
    // Start with default contract for this strategy
    const contract = this.getDefaultContract(strategyName);

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
    if (context.volatility && context.volatility > 2.0) {
      // High volatility - widen stops
      contract.stopLossPercent *= 1.2;
      contract.takeProfitPercent *= 1.3;
    }

    // Freeze contract metadata
    contract.createdAt = Date.now();
    contract.strategyName = strategyName;
    contract.signalConfidence = signal.confidence || 0;

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
