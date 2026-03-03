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

// Phase 10: Delegate to individual exit checkers
const StopLossChecker = require('./exit/StopLossChecker');
const TakeProfitChecker = require('./exit/TakeProfitChecker');
const TrailingStopChecker = require('./exit/TrailingStopChecker');
const MaxHoldChecker = require('./exit/MaxHoldChecker');

/**
 * Default exit contracts by strategy type
 * These are used when a strategy doesn't provide its own generateExitContract()
 */
// FIX 2026-02-21: Scaled for 1-minute candle reality
// OLD values (2-5% TP) were UNREACHABLE on 1m candles where BTC moves 0.05-0.5% per bar
// This caused trades to be trapped until max hold timeout, bleeding fees
// NEW values: Realistic R:R ratios that actually trigger on 1-minute price action
// TUNE 2026-02-27: Widened exits for positive net R:R after 0.52% fees
// Old: TP 0.75%, SL -0.45% → Net R:R 0.24:1 (needed 81% WR)
// New: TP 2.0%, SL -1.0% → Net R:R ~1:1 (needs 50% WR)
// Added trailingActivation to prevent premature trail triggers on volatility noise
const DEFAULT_CONTRACTS = {
  // ═══ Trend Following (hold longer, ride the trend) ═══
  EMASMACrossover: {
    stopLossPercent: -1.2,
    takeProfitPercent: 2.5,
    trailingStopPercent: 0.8,
    trailingActivation: 1.0,    // Don't activate trail until +1%
    invalidationConditions: ['ema_cross_reversal'],
    maxHoldTimeMinutes: 300     // 20 candles at 15m — trends need room
  },

  // ═══ Mean Reversion (tighter, quicker exits) ═══
  LiquiditySweep: {
    stopLossPercent: -0.8,
    takeProfitPercent: 1.5,
    trailingStopPercent: 0.5,
    trailingActivation: 0.8,
    invalidationConditions: ['sweep_invalidated', 'box_broken'],
    maxHoldTimeMinutes: 180
  },

  // ═══ Momentum (RSI extremes — expect snapback) ═══
  RSI: {
    stopLossPercent: -1.0,
    takeProfitPercent: 2.0,
    trailingStopPercent: 0.6,
    trailingActivation: 0.8,
    invalidationConditions: [],
    maxHoldTimeMinutes: 240
  },

  // ═══ Support/Resistance (bounce trades) ═══
  MADynamicSR: {
    stopLossPercent: -0.8,
    takeProfitPercent: 1.5,
    trailingStopPercent: 0.5,
    trailingActivation: 0.8,
    invalidationConditions: ['sr_level_broken'],
    maxHoldTimeMinutes: 180
  },

  // ═══ Pattern Recognition (quick setups, moderate hold) ═══
  CandlePattern: {
    stopLossPercent: -0.8,
    takeProfitPercent: 1.5,
    trailingStopPercent: 0.5,
    trailingActivation: 0.7,
    invalidationConditions: ['pattern_negated'],
    maxHoldTimeMinutes: 150
  },

  // ═══ Regime Confluence (strongest signals, widest room) ═══
  MarketRegime: {
    stopLossPercent: -1.5,
    takeProfitPercent: 3.0,
    trailingStopPercent: 1.0,
    trailingActivation: 1.5,
    invalidationConditions: ['regime_change'],
    maxHoldTimeMinutes: 360     // 24 candles — big moves need time
  },

  // ═══ Multi-Timeframe (high-conviction confluence) ═══
  MultiTimeframe: {
    stopLossPercent: -1.2,
    takeProfitPercent: 2.5,
    trailingStopPercent: 0.8,
    trailingActivation: 1.0,
    invalidationConditions: ['mtf_divergence'],
    maxHoldTimeMinutes: 300
  },

  // ═══ TPO / Volume Profile ═══
  OGZTPO: {
    stopLossPercent: -1.0,
    takeProfitPercent: 2.0,
    trailingStopPercent: 0.6,
    trailingActivation: 0.8,
    invalidationConditions: [],
    maxHoldTimeMinutes: 240
  },

  // ═══ Default fallback ═══
  default: {
    stopLossPercent: -1.0,
    takeProfitPercent: 2.0,
    trailingStopPercent: 0.6,
    trailingActivation: 0.8,
    invalidationConditions: [],
    maxHoldTimeMinutes: 240
  }
};

/**
 * Universal circuit breakers - always enforced regardless of strategy
 */
// FIX 2026-02-21: Universal limits for 15m trading
// TUNE 2026-02-27: Raised from 150 to 360 to match widened strategy contracts
// Old 150 min cap was firing before TPs could hit with widened exits
const UNIVERSAL_LIMITS = {
  hardStopLossPercent: -2.0,      // Per-trade absolute max loss (wider for 15m)
  accountDrawdownPercent: -10.0,  // Force close all if account down 10%
  maxHoldTimeMinutes: 360         // 360 min — matches MarketRegime max hold
};

class ExitContractManager {
  constructor() {
    this.universalLimits = UNIVERSAL_LIMITS;
    this.defaultContracts = DEFAULT_CONTRACTS;

    // Phase 10: Delegate to individual checkers
    this.stopLossChecker = new StopLossChecker(UNIVERSAL_LIMITS);
    this.takeProfitChecker = new TakeProfitChecker();
    this.trailingStopChecker = new TrailingStopChecker();
    this.maxHoldChecker = new MaxHoldChecker(UNIVERSAL_LIMITS);
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

    // 3. Trailing stop
    const tsResult = this.trailingStopChecker.check(trade, pnlPercent);
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
   * @param {Object} context - Market context at entry
   * @returns {Object} Complete exit contract
   */
  createExitContract(strategyName, signal = {}, context = {}) {
    // FIX 2026-02-24: Null safety for signal and context (Phase 12 fuzzing)
    if (!signal || typeof signal !== 'object') signal = {};
    if (!context || typeof context !== 'object') context = {};

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
    // FIX 2026-02-21: Raised threshold from 2.0 to 5.0 for 1-minute data
    // On 1m candles, volatility 2.0 is normal - only widen on extreme vol
    if (context.volatility && context.volatility > 5.0) {
      // High volatility - widen stops (reduced multipliers)
      contract.stopLossPercent *= 1.15;
      contract.takeProfitPercent *= 1.2;
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
