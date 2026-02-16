/**
 * @fileoverview OptimizedTradingBrain - Core Trading Decision Engine
 *
 * This is the brain of OGZ Prime, responsible for all trading decisions,
 * position management, and sophisticated exit strategies.
 *
 * @description
 * ARCHITECTURE ROLE:
 * TradingBrain sits between signal generation and execution. It receives
 * market data + pattern signals, decides whether to trade, sizes positions,
 * manages trailing stops, and triggers exits.
 *
 * DATA FLOW:
 * ```
 * run-empire-v2.js (market data)
 *        ↓
 * TradingBrain.getDecision() → BUY/SELL/HOLD
 *        ↓
 * TradingBrain.openPosition() or closePosition()
 *        ↓
 * StateManager (single source of truth)
 *        ↓
 * BrokerAdapter (order execution)
 * ```
 *
 * KEY FEATURES:
 * - Dynamic position sizing based on confidence + volatility
 * - MaxProfitManager integration for tiered exits
 * - "Break even fast, then let winners run" strategy
 * - Pattern learning integration
 * - Multi-asset support (BTC, ETH, SOL, ADA)
 *
 * CRITICAL NOTES:
 * 1. This class maintains a local position copy for quick access, but
 *    StateManager is the source of truth. Always sync before decisions.
 * 2. Balance desync was a major bug (fixed 2026-02-01) - now syncs from
 *    StateManager in openPosition() before calculating position size.
 * 3. All trades should be logged via logTrade() for performance tracking.
 *
 * @module core/OptimizedTradingBrain
 * @requires ./MaxProfitManager
 * @requires ./StateManager
 * @requires ./FibonacciDetector
 * @requires ./SupportResistanceDetector
 * @requires ../utils/tradeLogger
 *
 * @author Trey (OGZPrime Technologies)
 * @version 10.2 Enhanced with Comprehensive Logging
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: Dependencies
// ═══════════════════════════════════════════════════════════════════════════

const { logTrade } = require('../utils/tradeLogger');
const MaxProfitManager = require('./MaxProfitManager');
const FibonacciDetector = require('./FibonacciDetector');
const SupportResistanceDetector = require('./SupportResistanceDetector');
const PersistentPatternMap = require('./PersistentPatternMap');  // CHANGE 631: Simple persistence!
const { getInstance: getStateManager } = require('./StateManager');  // CHANGE 2025-12-11: StateManager sync
const ErrorHandler = require('./ErrorHandler');  // CHANGE 2025-12-11: Error escalation
const { RollingWindow } = require('./MemoryManager');  // CHANGE 2025-12-11: Memory leak prevention

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: OptimizedTradingBrain Class
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Core trading decision engine with comprehensive logging and analysis.
 * Manages all trading decisions, position management, and performance tracking.
 *
 * @class OptimizedTradingBrain
 *
 * @property {number} balance - Current available balance (LOCAL CACHE - sync from StateManager!)
 * @property {number} initialBalance - Starting balance for P&L calculation
 * @property {Object|null} position - Current open position details
 * @property {RollingWindow} tradeHistory - Last 100 trades (fixed-size to prevent memory leak)
 * @property {MaxProfitManager} maxProfitManager - Tiered exit strategy manager
 * @property {Object} config - Trading configuration (risk, sizing, thresholds)
 * @property {ErrorHandler} errorHandler - Circuit breaker for error management
 *
 * @warning BALANCE DESYNC BUG: This class caches this.balance locally. It MUST sync
 *          from StateManager before making position sizing decisions. See openPosition().
 */
class OptimizedTradingBrain {
  /**
   * Initialize the trading brain with account balance and configuration.
   *
   * @constructor
   * @param {number} [balance=10000] - Starting account balance in USD
   * @param {Object} [config={}] - Configuration options
   * @param {number} [config.maxRiskPerTrade=0.02] - Max risk per trade (2%)
   * @param {number} [config.stopLossPercent=0.02] - Stop loss percentage
   * @param {number} [config.takeProfitPercent=0.04] - Take profit percentage
   * @param {number} [config.minConfidenceThreshold=0.45] - Min confidence to trade
   * @param {number} [config.maxPositionSize=0.05] - Max position size (5% of balance)
   *
   * @example
   * const brain = new OptimizedTradingBrain(10000, {
   *   minConfidenceThreshold: 0.50,  // Stricter entry
   *   maxPositionSize: 0.03          // Smaller positions
   * });
   */
  constructor(balance = 10000, config = {}) {
    // CHANGE 2025-12-11: Error handler for circuit breaker pattern
    this.errorHandler = new ErrorHandler({
      maxErrorsBeforeCircuitBreak: 5,
      circuitBreakResetMs: 60000
    });

    // Account management
    this.balance = balance;
    this.initialBalance = balance;
    this.position = null; // Current open position
    this.tradeHistory = new RollingWindow(100); // CHANGE 2025-12-11: Fixed-size window (was unbounded [])
    this.lastTradeResult = null; // Last trade result for quick access
    
    
    // Configuration with intelligent defaults
    // CHANGE 610: Read from config object (populated from .env)
    this.config = {
      // Risk management - ENHANCED WITH BREAKEVEN WITHDRAWAL + LOOSE TRAILING
      maxRiskPerTrade: config.maxRiskPerTrade || 0.02,
      stopLossPercent: config.stopLossPercent || 0.02,
      takeProfitPercent: config.takeProfitPercent || 0.04,
      enableTrailingStop: true,        // Enable trailing stops
      trailingStopPercent: config.trailingStopPercent || 0.035,
      trailingStopActivation: config.trailingStopActivation || 0.025,
      profitProtectionLevel: config.profitProtectionLevel || 0.015,
      dynamicTrailingAdjustment: true, // Adjust trailing based on volatility

      // 💰 BREAKEVEN WITHDRAWAL SYSTEM
      enableBreakevenWithdrawal: true, // Auto-withdraw at breakeven
      breakevenTrigger: config.breakevenTrigger || 0.005,
      breakevenPercentage: config.breakevenPercentage || 0.50,
      postBreakevenTrailing: config.postBreakevenTrailing || 0.05,
      freeProfitMode: false,           // Track if position is in "free profit" mode

      // Position sizing - VOLATILITY ENHANCED
      basePositionSize: config.basePositionSize || 0.01,
      confidenceScaling: true,         // Scale size by confidence
      maxPositionSize: config.maxPositionSize || 0.05,
      volatilityScaling: true,         // Scale size based on volatility
      lowVolatilityMultiplier: config.lowVolatilityMultiplier || 1.5,
      highVolatilityMultiplier: config.highVolatilityMultiplier || 0.6,
      volatilityThresholds: config.volatilityThresholds || {
        low: 0.015,                    // 1.5% volatility threshold
        high: 0.035                    // 3.5% volatility threshold
      },

      // 🛡️ ENHANCED CONFIDENCE THRESHOLDS (Win Rate Optimized)
      minConfidenceThreshold: config.minConfidenceThreshold || 0.45,   // CHANGE 609/610: From .env via config
      maxConfidenceThreshold: config.maxConfidenceThreshold || 0.95,
      dynamicConfidenceAdjustment: true, // Enable dynamic confidence based on performance
      confidencePenalty: config.confidencePenalty || 0.1,
      confidenceBoost: config.confidenceBoost || 0.05,
      enableSafetyValidation: true,    // Enable safety net validation
      enablePerformanceTracking: true, // Enable performance validator

      // Performance tracking
      enablePatternLearning: true,     // Learn from patterns

      // Houston fund tracking
      houstonFundTarget: config.houstonFundTarget || 25000,

      // Multi-asset support - PRODUCTION READY
      supportedAssets: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'ADA-USD'],
      currentAsset: 'BTC-USD',         // Default asset
      assetSpecificConfidence: {
        'BTC-USD': 0.65,               // Standard confidence for BTC
        'ETH-USD': 0.70,               // Slightly higher for ETH volatility
        'SOL-USD': 0.75,               // Higher for SOL volatility
        'ADA-USD': 0.68                // Standard for ADA
      },
      assetSpecificRisk: {
        'BTC-USD': 0.02,               // 2% risk for BTC
        'ETH-USD': 0.018,              // 1.8% risk for ETH
        'SOL-USD': 0.015,              // 1.5% risk for SOL (more volatile)
        'ADA-USD': 0.022               // 2.2% risk for ADA
      },
      
      // Merge user config
      ...config
    };
    
    // Advanced profit management system
    // Change 606: Crypto-optimized stops (3-5x wider than stocks)
    // Change 607: "Break even fast then let it ride" strategy
    this.maxProfitManager = new MaxProfitManager({
      enableTieredExits: true,         // Multi-tier profit taking
      enableDynamicTrailing: true,     // Dynamic trailing stops
      enableVolatilityAdaptation: true, // Adapt to market volatility

      // CHANGE 623: Use .env values instead of hardcoding
      // CRYPTO-SPECIFIC: "Break even fast, then let winners run"
      initialStopLossPercent: parseFloat(process.env.INITIAL_STOP_LOSS) || 0.05,
      breakevenThreshold: parseFloat(process.env.MPM_BREAKEVEN_THRESHOLD) || 0.015,
      minProfit: parseFloat(process.env.MIN_PROFIT_TRAIL) || 0.015,

      // WIDE trailing stops for crypto (from .env)
      trailDistance: parseFloat(process.env.TRAIL_DISTANCE) || 0.07,
      tightTrailDistance: parseFloat(process.env.TIGHT_TRAIL_DISTANCE) || 0.10,

      // Profit targets for partial exits (from .env)
      firstTierTarget: parseFloat(process.env.TIER1_TARGET) || 0.02,
      secondTierTarget: parseFloat(process.env.TIER2_TARGET) || 0.04,
      thirdTierTarget: parseFloat(process.env.TIER3_TARGET) || 0.06,
      finalTarget: parseFloat(process.env.FINAL_TARGET) || 0.10
    });

    // Change 608: Initialize Fibonacci and Support/Resistance detectors
    this.fibonacciDetector = new FibonacciDetector({
      levels: [0.236, 0.382, 0.5, 0.618, 0.786],  // Standard Fib levels
      goldenZone: [0.618, 0.65],                   // Most important zone for reversals
      proximityThreshold: 0.5                       // 0.5% to be "at" a level
    });

    this.supportResistanceDetector = new SupportResistanceDetector({
      minStrength: 3,                    // Min 3 touches to be significant
      proximityThresholdPercent: 0.3,    // 0.3% to be "at" a level
      maxLevels: 8                       // Track top 8 S/R levels
    });

    // Performance tracking
    this.sessionStats = {
      tradesCount: 0,
      winsCount: 0,
      lossesCount: 0,
      totalPnL: 0,
      bestTrade: 0,
      worstTrade: 0,
      winStreak: 0,
      lossStreak: 0,
      currentStreak: 0,
      currentStreakType: null
    };
    
    // KILLED SYSTEM 2 (2026-02-10): This was competing with EnhancedPatternRecognition's pattern memory
    // The correct pattern memory is in EnhancedPatternRecognition → data/pattern-memory.{mode}.json
    // This one (./pattern_memory.json) was never being updated because closePosition() was never called
    this.patternMemory = null; // DISABLED - Let System 1 (EnhancedPatternRecognition) handle patterns
    this.currentPatternId = null;
    
    // CHANGE 623: SCALPER CONFIG from .env instead of hardcoding
    // 🚀 SCALPER-SPECIFIC: FEE-AWARE Micro-profit and quick exit system
    this.scalperConfig = {
      microProfitThreshold: parseFloat(process.env.SCALPER_MICRO_PROFIT) || 0.005,
      quickProfitThreshold: parseFloat(process.env.SCALPER_QUICK_PROFIT) || 0.008,
      momentumShiftThreshold: parseFloat(process.env.SCALPER_MOMENTUM_SHIFT) || 0.15,
      tightStopMultiplier: parseFloat(process.env.SCALPER_STOP_MULTIPLIER) || 0.5,
      maxHoldTime: parseInt(process.env.SCALPER_MAX_HOLD_TIME) || 300000,
      entryMomentum: null,             // Track entry momentum for comparison
      lastMomentumCheck: 0,            // Throttle momentum checks to every 5 seconds
      scalperModeActive: false         // Track if scalper mode is active
    };
    
    // CHANGE 623: FEE CONFIG from .env instead of hardcoding
    // 💰 FEE-AWARE TRADING: Critical for profitability
    this.feeConfig = {
      maker: parseFloat(process.env.FEE_MAKER) || 0.0010,
      taker: parseFloat(process.env.FEE_TAKER) || 0.0015,
      slippage: parseFloat(process.env.FEE_SLIPPAGE) || 0.0005,
      totalRoundTrip: parseFloat(process.env.FEE_TOTAL_ROUNDTRIP) || 0.0035,
      safetyBuffer: parseFloat(process.env.FEE_SAFETY_BUFFER) || 0.001
    };
    
    // Reference to parent OGZ Prime system for logging
    this.ogzPrime = null;
    
    // Quantum Position Sizer reference (set by OGZ Prime)
    this.quantumPositionSizer = null;
    
    // 🛡️ SAFETY SYSTEMS: References to new safety components
    this.tradingSafetyNet = null;     // Emergency circuit breakers
    this.performanceValidator = null; // Component profitability tracking
    
    // 🛡️ ENHANCED RISK MANAGEMENT - Loss Limits & Emergency Controls
    this.riskLimits = {
      dailyLossLimit: balance * 0.05,    // 5% daily loss limit
      weeklyLossLimit: balance * 0.15,   // 15% weekly loss limit
      monthlyLossLimit: balance * 0.30,  // 30% monthly loss limit
      maxDrawdownLimit: balance * 0.20,  // 20% maximum drawdown
      emergencyStopTrigger: balance * 0.10, // 10% loss triggers emergency stop
      
      // Loss tracking
      dailyLosses: 0,
      weeklyLosses: 0,
      monthlyLosses: 0,
      currentDrawdown: 0,
      peakBalance: balance,
      
      // Time tracking for limits
      dayStartTime: new Date().setHours(0,0,0,0),
      weekStartTime: this.getWeekStart(),
      monthStartTime: new Date().setDate(1),
      
      // Emergency controls
      emergencyStopActive: false,
      emergencyStopReason: null,
      tradingHalted: false,
      haltReason: null,
      
      // Recovery mechanisms
      accountRecoveryMode: false,
      recoveryStartBalance: 0,
      recoveryTargetReached: false
    };
    
    console.log(`🧠 Enhanced Trading Brain initialized with $${balance.toLocaleString()} balance`);
    console.log(`🎯 Houston Fund Target: $${this.config.houstonFundTarget.toLocaleString()}`);
  }
  

  setCandles(candles) {
  this.candles = candles;
}

  /**
   * Change 608: Analyze Fib/S&R levels and provide trailing stop context
   * This is the scalper's edge - tighten near levels, widen on breakouts
   * @param {Array} candles - Price candles
   * @param {number} currentPrice - Current market price
   * @returns {Object} Level analysis with trailing stop recommendations
   */
  analyzeFibSRLevels(candles, currentPrice) {
    if (!candles || candles.length < 30 || !currentPrice) {
      return { nearLevel: false, trailMultiplier: 1.0 };
    }

    // Update detectors with latest candle data
    const fibLevels = this.fibonacciDetector.update(candles);
    const srLevels = this.supportResistanceDetector.update(candles);

    let nearLevel = false;
    let levelType = null;
    let distancePercent = 100;
    let trailMultiplier = 1.0;  // 1.0 = normal, <1.0 = tighter, >1.0 = wider

    // Check if price is near any Fibonacci level
    if (fibLevels && fibLevels.levels) {
      for (const [levelName, levelPrice] of Object.entries(fibLevels.levels)) {
        const dist = Math.abs((currentPrice - levelPrice) / currentPrice) * 100;
        if (dist < distancePercent) {
          distancePercent = dist;
          levelType = `Fib ${levelName}`;

          // Within 0.5% of level = NEAR
          if (dist < 0.5) {
            nearLevel = true;

            // TIGHTEN stops near golden zone (61.8% most important)
            if (levelName === '0.618' || levelName === '0.5') {
              trailMultiplier = 0.5;  // 50% tighter (7% → 3.5%)
              console.log(`📐 Price near ${levelName} Fib golden zone - tightening trail to ${(0.07 * trailMultiplier * 100).toFixed(1)}%`);
            } else {
              trailMultiplier = 0.7;  // 30% tighter (7% → 4.9%)
            }
          }
        }
      }
    }

    // Check if price is near Support/Resistance
    if (srLevels && srLevels.length > 0) {
      for (const level of srLevels) {
        const dist = Math.abs((currentPrice - level.price) / currentPrice) * 100;
        if (dist < distancePercent) {
          distancePercent = dist;
          levelType = `${level.type} (${level.strength} touches)`;

          // Within 0.3% of S/R level = NEAR
          if (dist < 0.3) {
            nearLevel = true;
            trailMultiplier = 0.6;  // 40% tighter (7% → 4.2%)
            console.log(`📊 Price near ${level.type} at $${level.price.toFixed(2)} - tightening trail to ${(0.07 * trailMultiplier * 100).toFixed(1)}%`);
          }
        }
      }
    }

    // Check for BREAKOUT scenario (price broke through major S/R)
    if (srLevels && srLevels.length > 0) {
      const recentLevels = srLevels.slice(0, 3);  // Top 3 strongest levels
      for (const level of recentLevels) {
        // Did we recently break through this level?
        if (candles.length >= 5) {
          const prev5Candles = candles.slice(-5);
          const wasBelow = prev5Candles.some(c => c.close < level.price - (level.price * 0.001));
          const isAboveNow = currentPrice > level.price + (level.price * 0.002);

          if (wasBelow && isAboveNow && level.type === 'resistance') {
            // BREAKOUT! Price broke through resistance - WIDEN stops
            trailMultiplier = 1.5;  // 50% wider (7% → 10.5%)
            nearLevel = false;  // Override tightening
            console.log(`🚀 BREAKOUT detected! Broke resistance at $${level.price.toFixed(2)} - widening trail to ${(0.07 * trailMultiplier * 100).toFixed(1)}%`);
            break;
          }
        }
      }
    }

    return {
      nearLevel,
      levelType,
      distancePercent,
      trailMultiplier,
      fibLevels,
      srLevels
    };
  }

  /**
   * Set reference to parent OGZ Prime system for enhanced integration
   * @param {Object} ogzPrime - Reference to main OGZ Prime system
   */
  setOGZPrimeReference(ogzPrime) {
    this.ogzPrime = ogzPrime;
    console.log('🔗 Trading Brain linked to OGZ Prime system');
  }
  
  /**
   * Set reference to Quantum Position Sizer for advanced position sizing
   * @param {QuantumPositionSizer} quantumPositionSizer - Quantum position sizer instance
   */
  setQuantumPositionSizer(quantumPositionSizer) {
    this.quantumPositionSizer = quantumPositionSizer;
    console.log('⚛️ Trading Brain linked to Quantum Position Sizer');
  }
  
  /**
   * 🛡️ Set reference to Trading Safety Net for emergency circuit breakers
   * @param {TradingSafetyNet} tradingSafetyNet - Trading safety net instance
   */
  setTradingSafetyNet(tradingSafetyNet) {
    this.tradingSafetyNet = tradingSafetyNet;
    console.log('🛡️ Trading Brain linked to Safety Net');
  }
  
  /**
   * 📊 Set reference to Performance Validator for component tracking
   * @param {PerformanceValidator} performanceValidator - Performance validator instance
   */
  setPerformanceValidator(performanceValidator) {
    this.performanceValidator = performanceValidator;
    console.log('📊 Trading Brain linked to Performance Validator');
  }
  
  /**
   * 🚀 SCALPER-SPECIFIC: Activate FEE-AWARE scalper mode with profile settings
   * @param {Object} profileSettings - Scalper profile configuration
   */
  activateScalperMode(profileSettings = {}) {
    this.scalperConfig.scalperModeActive = true;
    
    // Load fee-aware settings from profile
    if (profileSettings.feeAwareProfitTargets) {
      this.scalperConfig.microProfitThreshold = profileSettings.feeAwareProfitTargets.microProfitThreshold || 0.005;
      this.scalperConfig.quickProfitThreshold = profileSettings.feeAwareProfitTargets.quickProfitThreshold || 0.008;
    }
    
    // Load fee configuration
    if (profileSettings.fees) {
      this.feeConfig = { ...this.feeConfig, ...profileSettings.fees };
    }
    
    // Override with specific settings if provided
    if (profileSettings.enableMicroProfits) {
      this.scalperConfig.microProfitThreshold = profileSettings.microProfitTarget || this.scalperConfig.microProfitThreshold;
    }
    if (profileSettings.enableQuickExits) {
      this.scalperConfig.quickProfitThreshold = profileSettings.quickProfitTarget || this.scalperConfig.quickProfitThreshold;
    }
    if (profileSettings.maxHoldTimeSeconds) {
      this.scalperConfig.maxHoldTime = profileSettings.maxHoldTimeSeconds * 1000;
    }
    
    console.log('🚀 FEE-AWARE SCALPER MODE ACTIVATED!');
    console.log(`   💰 Micro-Profit: ${(this.scalperConfig.microProfitThreshold * 100).toFixed(1)}% (was 0.3% - DEATH TRAP!)` );
    console.log(`   ⚡ Quick-Profit: ${(this.scalperConfig.quickProfitThreshold * 100).toFixed(1)}% (was 0.5% - BARELY SAFE!)`);
    console.log(`   💸 Total Fees: ${(this.feeConfig.totalRoundTrip * 100).toFixed(2)}% per round trip`);
    console.log(`   🛡️ Net Profit: ${((this.scalperConfig.microProfitThreshold - this.feeConfig.totalRoundTrip) * 100).toFixed(2)}% micro, ${((this.scalperConfig.quickProfitThreshold - this.feeConfig.totalRoundTrip) * 100).toFixed(2)}% quick`);
    console.log(`   🕒 Max Hold: ${this.scalperConfig.maxHoldTime / 1000}s`);
    console.log(`   🔴 Tight Stops: ${this.scalperConfig.tightStopMultiplier * 100}% of normal`);
  }
  
  /**
   * 🚀 SCALPER-SPECIFIC: Deactivate scalper mode
   */
  deactivateScalperMode() {
    this.scalperConfig.scalperModeActive = false;
    this.scalperConfig.entryMomentum = null;
    console.log('⏹️ Scalper mode deactivated');
  }
  
  /**
   * Calculate Optimal Position Size - Enhanced Risk-Adjusted Sizing
   * 
   * CRITICAL METHOD: Calculates the optimal position size based on confidence,
   * volatility, account balance, and risk management parameters.
   * 
   * @param {number} basePositionSize - Base position size percentage
   * @param {number} confidence - Trade confidence (0-1)
   * @param {Object} marketData - Current market data
   * @param {number} accountBalance - Current account balance
   * @returns {number} - Optimal position size percentage
   */
  calculateOptimalPositionSize(basePositionSize, confidence, marketData, accountBalance) {
    let optimalSize = basePositionSize;
    
    console.log(`🧠 CALCULATING OPTIMAL SIZE: Base ${(basePositionSize * 100).toFixed(2)}%`);
    
    // Confidence scaling
    if (this.config.confidenceScaling) {
      const confidenceMultiplier = Math.max(0.5, Math.min(2.0, confidence * 2));
      optimalSize *= confidenceMultiplier;
      console.log(`   📊 Confidence scaling: ${(confidenceMultiplier * 100).toFixed(0)}% (confidence: ${(confidence * 100).toFixed(1)}%)`);
    }
    
    // Volatility scaling
    if (this.config.volatilityScaling && marketData.volatility) {
      const volatility = marketData.volatility;
      let volatilityMultiplier = 1.0;
      
      if (volatility < this.config.volatilityThresholds.low) {
        volatilityMultiplier = this.config.lowVolatilityMultiplier;
        console.log(`   📈 Low volatility boost: ${(volatilityMultiplier * 100).toFixed(0)}%`);
      } else if (volatility > this.config.volatilityThresholds.high) {
        volatilityMultiplier = this.config.highVolatilityMultiplier;
        console.log(`   📉 High volatility reduction: ${(volatilityMultiplier * 100).toFixed(0)}%`);
      }
      
      optimalSize *= volatilityMultiplier;
    }
    
    // Apply limits
    optimalSize = Math.max(this.config.basePositionSize * 0.5, optimalSize); // Min 50% of base
    optimalSize = Math.min(this.config.maxPositionSize, optimalSize); // Max position limit
    
    console.log(`🧠 OPTIMAL SIZE CALCULATED: ${(optimalSize * 100).toFixed(2)}% (was ${(basePositionSize * 100).toFixed(2)}%)`);
    
    return optimalSize;
  }
  
  /**
   * Calculate Take Profit - Enhanced Profit Target Calculation (DEPRECATED - see line ~1700 for active version)
   * This function has been replaced by the version with case normalization.
   * Keeping as comment for reference only.
   */
  // calculateTakeProfit() - REMOVED DUPLICATE - See line 1700 for active version with case normalization
  
  /**
   * Calculate Trailing Stop - Dynamic Trailing Stop Calculation
   * 
   * @param {number} entryPrice - Entry price
   * @param {string} direction - Trade direction
   * @returns {number} - Initial trailing stop price
   */
  calculateTrailingStop(entryPrice, direction) {
    const trailingPercent = this.config.trailingStopPercent;
    
    let trailingStop;
    if (direction === 'buy') {
      trailingStop = entryPrice * (1 - trailingPercent);
    } else {
      trailingStop = entryPrice * (1 + trailingPercent);
    }
    
    return trailingStop;
  }
  
  /**
   * Track Trade - Performance Tracking and Analysis
   * 
   * @param {Object} tradeData - Trade data to track
   * @param {number} currentBalance - Current account balance
   */
  trackTrade(tradeData, currentBalance) {
    const {
      id,
      direction,
      entryPrice,
      positionSize,
      confidence,
      patterns,
      marketData
    } = tradeData;
    
    console.log(`🧠 TRACKING TRADE: ${id} (${direction.toUpperCase()})`);
    
    // Update session stats
    this.sessionStats.tradesCount++;
    
    // Store trade for pattern learning (DISABLED - System 2 killed, EnhancedPatternRecognition handles this)
    // if (patterns && patterns.length > 0 && this.patternMemory) {
    //   const patternKey = patterns.map(p => p.type).join('_');
    //   if (!this.patternMemory.has(patternKey)) {
    //     this.patternMemory.set(patternKey, {
    //       trades: [],
    //       successRate: 0,
    //       avgProfit: 0
    //     });
    //   }
    //
    //   this.patternMemory.get(patternKey).trades.push({
    //     id,
    //     direction,
    //     entryPrice,
    //     confidence,
    //     timestamp: Date.now()
    //   });
    // }
    
    // Calculate Houston fund progress (only if currentBalance provided)
    if (currentBalance !== undefined) {
      const progressPercent = (currentBalance / this.config.houstonFundTarget) * 100;
      console.log(`🎯 Houston Fund Progress: ${progressPercent.toFixed(1)}% ($${currentBalance.toLocaleString()}/$${this.config.houstonFundTarget.toLocaleString()})`);
    }
    
    this.log(`Trade tracked: ${id} - Confidence: ${(confidence * 100).toFixed(1)}%, Size: ${(positionSize * 100).toFixed(2)}%`, 'info');
  }
  
  /**
   * Log Method - Enhanced Logging with Context
   * 
   * @param {string} message - Log message
   * @param {string} level - Log level (info, warning, error)
   */
  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = level === 'error' ? '❌' : level === 'warning' ? '⚠️' : '📊';
    console.log(`${prefix} [${timestamp}] OptimizedTradingBrain: ${message}`);
  }
  
  /**
   * 💰 BREAKEVEN WITHDRAWAL: Check if breakeven withdrawal should be executed
   * @param {number} price - Current market price
   * @param {Object} currentAnalysis - Current market analysis
   * @returns {Object|null} Breakeven action result
   */
  checkBreakevenWithdrawal(price, currentAnalysis) {
    if (!this.position || this.position.breakevenWithdrawn) return null;
    
    const currentPnL = this.calculatePnL(price);
    const pnlPercent = Math.abs(currentPnL / (this.position.entryPrice * this.position.size));
    
    // Check if we've hit the breakeven trigger threshold
    if (currentPnL > 0 && pnlPercent >= this.config.breakevenTrigger) {
      console.log(`💰 BREAKEVEN TRIGGER ACTIVATED: ${(pnlPercent * 100).toFixed(2)}% profit reached`);
      
      return {
        action: 'withdraw',
        currentPnL: currentPnL,
        pnlPercent: pnlPercent,
        withdrawalSize: this.position.size * this.config.breakevenPercentage,
        remainingSize: this.position.size * (1 - this.config.breakevenPercentage),
        withdrawalValue: currentPnL * this.config.breakevenPercentage,
        reason: `Breakeven withdrawal at ${(pnlPercent * 100).toFixed(2)}% profit`
      };
    }
    
    return null;
  }
  
  /**
   * 🛡️ ENHANCED BREAKEVEN PROTECTION: Calculate breakeven stop loss with fee buffer
   * @param {number} entryPrice - Trade entry price
   * @param {string} direction - Trade direction ('buy' or 'sell')
   * @param {number} fees - Total round-trip fees (default 0.002 = 0.2%)
   * @returns {number} Breakeven stop loss price
   */
  calculateBreakevenStopLoss(entryPrice, direction, fees = 0.002) {
    // CHANGE 611: Normalize direction to lowercase to fix case-sensitivity bug (BUY vs buy)
    const dirLower = (direction || '').toString().toLowerCase();

    // Handle both object and number input for fees
    const feeValue = typeof fees === 'object' ? fees.totalRoundTrip : fees;
    const breakevenBuffer = feeValue + 0.001; // 0.3% total buffer for fees + slippage

    // Validate inputs
    if (!entryPrice || isNaN(entryPrice)) {
      console.error('❌ [OptimizedTradingBrain] Invalid entry price:', entryPrice);
      // Fallback: 2% stop loss
      return dirLower === 'buy' ? entryPrice * 0.98 : entryPrice * 1.02;
    }

    let stopLoss;
    if (dirLower === 'buy' || dirLower === 'long') {
      // BUY: Stop BELOW entry to protect downside (Change 594)
      stopLoss = entryPrice * (1 - breakevenBuffer);
    } else {
      // SELL: Stop ABOVE entry to protect downside (Change 594)
      stopLoss = entryPrice * (1 + breakevenBuffer);
    }

    // Validate output
    if (isNaN(stopLoss)) {
      console.error('❌ [OptimizedTradingBrain] Stop loss calculation returned NaN:', {
        entryPrice, direction, fees, breakevenBuffer
      });
      // Fallback: 2% stop loss
      return dirLower === 'buy' ? entryPrice * 0.98 : entryPrice * 1.02;
    }

    console.log(`✅ [OptimizedTradingBrain] Stop loss calculated: ${direction} @ $${entryPrice.toFixed(2)} → $${stopLoss.toFixed(2)} (${(breakevenBuffer * 100).toFixed(2)}% buffer)`);
    return stopLoss;
  }
  
  /**
   * 💰 BREAKEVEN WITHDRAWAL: Execute the breakeven withdrawal
   * @param {number} price - Current market price
   * @param {Object} breakevenAction - Breakeven action from check
   * @param {Object} currentAnalysis - Current market analysis
   */
  executeBreakevenWithdrawal(price, breakevenAction, currentAnalysis) {
    if (!this.position || this.position.breakevenWithdrawn) return;
    
    // Calculate withdrawal details
    const withdrawalSize = breakevenAction.withdrawalSize;
    const withdrawalPnL = (price - this.position.entryPrice) * withdrawalSize;
    const withdrawalFees = withdrawalSize * this.position.entryPrice * this.feeConfig.totalRoundTrip;
    const netWithdrawal = withdrawalPnL - withdrawalFees;
    
    // Update account balance with withdrawal
    this.balance += netWithdrawal;
    
    // Update position to reflect partial exit
    this.position.size = breakevenAction.remainingSize;
    this.position.breakevenWithdrawn = true;
    this.position.breakevenWithdrawalPrice = price;
    this.position.breakevenWithdrawalAmount = netWithdrawal;
    this.position.freeProfitMode = true;
    
    // Adjust stop loss to breakeven for remaining position
    this.position.stopLossPrice = this.position.entryPrice;
    
    // Switch to MUCH LOOSER trailing stops for the free profit portion
    this.position.postBreakevenTrailing = true;
    
    console.log(`💰 BREAKEVEN WITHDRAWAL EXECUTED!`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💸 WITHDRAWAL: $${netWithdrawal.toFixed(2)} (${(this.config.breakevenPercentage * 100).toFixed(0)}% of position)`);
    console.log(`🎯 REMAINING SIZE: ${this.position.size.toFixed(6)} shares (NOW 100% FREE PROFIT)`);
    console.log(`🛡️ STOP LOSS: Moved to breakeven at $${this.position.entryPrice.toFixed(2)}`);
    console.log(`📈 TRAILING STOPS: Now ${(this.config.postBreakevenTrailing * 100).toFixed(1)}% (VERY LOOSE for max profit)`);
    console.log(`💳 BALANCE: +$${netWithdrawal.toFixed(2)} → $${this.balance.toFixed(2)}`);
    console.log(`🚀 FREE PROFIT MODE: Everything from here is pure profit!`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    // Record partial exit in trade history for tracking
    this.tradeHistory.push({
      type: 'partial_exit_breakeven',
      exitPrice: price,
      size: withdrawalSize,
      pnl: netWithdrawal,
      timestamp: new Date().toISOString(),
      reason: 'Breakeven withdrawal - securing initial capital',
      balanceAfter: this.balance,
      remainingPositionSize: this.position.size
    });
  }
  
  /**
   * Check if currently holding a position
   * @returns {boolean} True if in position, false otherwise
   */
  isInPosition() {
    return this.position !== null;
  }
  
  /**
   * Get current position information
   * @returns {Object|null} Current position or null if no position
   */
  getCurrentPosition() {
    return this.position;
  }
  
  /**
   * Get account balance
   * @returns {number} Current account balance
   */
  getBalance() {
    return this.balance;
  }
  
  /**
   * Get total number of trades executed
   * @returns {number} Total trades count
   */
  getTotalTrades() {
    return this.tradeHistory.length;
  }
  
  /**
   * Get number of decisions made today (placeholder - would need date tracking)
   * @returns {number} Decisions made today
   */
  getDecisionsToday() {
    // For now, return session trades count as a proxy for decisions
    // This could be enhanced to track actual decision timestamps
    return this.sessionStats.tradesCount;
  }
  
  /**
   * Get comprehensive account status
   * @returns {Object} Account status with performance metrics
   */
  getAccountStatus() {
    const totalReturn = ((this.balance - this.initialBalance) / this.initialBalance) * 100;
    const houstonProgress = (this.balance / this.config.houstonFundTarget) * 100;
    
    return {
      balance: this.balance,
      initialBalance: this.initialBalance,
      totalReturn: totalReturn,
      totalPnL: this.balance - this.initialBalance,
      houstonProgress: houstonProgress,
      houstonRemaining: this.config.houstonFundTarget - this.balance,
      isInPosition: this.isInPosition(),
      position: this.position,
      sessionStats: { ...this.sessionStats },
      tradeCount: this.tradeHistory.length
    };
  }
  
  /**
   * Open a new trading position with comprehensive data capture
   * @param {number} price - Entry price
   * @param {string} direction - 'buy' or 'sell'
   * @param {number} size - Position size
   * @param {number} confidence - Signal confidence (0-5)
   * @param {string} reason - Entry reason/signal description
   * @param {Object} analysisData - Complete market analysis data
   * @returns {boolean} True if position opened successfully
   */
  openPosition(price, direction, size, confidence, reason = '', analysisData = {}) {
    // Prevent multiple positions
    if (this.position) {
      console.log('⚠️ Cannot open position: Already in position');
      return false;
    }
    
    // 🛡️ ENHANCED SAFETY: Validate confidence thresholds
    if (confidence < this.config.minConfidenceThreshold) {
      console.log(`🛡️ Position blocked: Confidence ${(confidence * 100).toFixed(1)}% below minimum ${(this.config.minConfidenceThreshold * 100).toFixed(1)}%`);
      return false;
    }
    
    if (confidence > this.config.maxConfidenceThreshold) {
      console.log(`🛡️ Confidence capped: ${(confidence * 100).toFixed(1)}% reduced to ${(this.config.maxConfidenceThreshold * 100).toFixed(1)}% to prevent overconfidence`);
      confidence = this.config.maxConfidenceThreshold;
    }
    
    // 🛡️ SAFETY NET: Validate trade with safety systems
    if (this.config.enableSafetyValidation && this.tradingSafetyNet) {
      const tradeRequest = {
        price,
        direction,
        size,
        confidence,
        reason
      };
      
      const safetyResult = this.tradingSafetyNet.validateTrade(tradeRequest, analysisData);
      if (!safetyResult.approved) {
        console.log(`🛡️ TRADE BLOCKED by Safety Net: ${safetyResult.reason}`);
        return false;
      }
    }
    
    // Validate inputs
    if (!price || price <= 0) {
      console.log('❌ Invalid price for position entry');
      return false;
    }
    
    if (!['buy', 'sell'].includes(direction)) {
      console.log('❌ Invalid direction. Must be "buy" or "sell"');
      return false;
    }
    
    // Calculate position value and validate
    // FIX 2026-02-01: Sync balance from StateManager (single source of truth) before position sizing
    // Prevents desync between OptimizedTradingBrain.balance and actual account balance
    const stateManager = getStateManager();
    const currentBalance = stateManager.get('balance') || this.balance;
    this.balance = currentBalance; // Sync local cache

    const positionValue = price * size;
    const maxPositionValue = currentBalance * this.config.maxPositionSize;
    
    if (positionValue > maxPositionValue) {
      console.log(`⚠️ Position size too large. Max: $${maxPositionValue.toFixed(2)}, Requested: $${positionValue.toFixed(2)}`);
      size = maxPositionValue / price; // Adjust size to maximum allowed
    }
    
    // Create comprehensive position record
    this.position = {
      // Basic position data
      entryPrice: price,
      direction: direction,
      size: size,
      entryTime: new Date(),
      entryTimestamp: Date.now(),
      
      // Trading signals and confidence
      entryConfidence: confidence,
      entryReason: reason,
      
      // Comprehensive market analysis at entry
      entryAnalysis: {
        // Technical indicators
        rsi: analysisData.rsi || 0,
        rsiSignal: this.interpretRSI(analysisData.rsi || 0),
        macd: analysisData.macd || 0,
        macdSignal: analysisData.macdSignal || 0,
        macdHistogram: analysisData.macdHistogram || 0,
        macdCrossover: analysisData.macdCrossover || false,
        
        // Moving averages
        ema20: analysisData.ema20 || 0,
        ema50: analysisData.ema50 || 0,
        ema200: analysisData.ema200 || 0,
        sma20: analysisData.sma20 || 0,
        sma50: analysisData.sma50 || 0,
        
        // Bollinger Bands
        bollingerUpper: analysisData.bollingerUpper || 0,
        bollingerLower: analysisData.bollingerLower || 0,
        bollingerMiddle: analysisData.bollingerMiddle || 0,
        
        // Additional indicators
        stochastic: analysisData.stochastic || 0,
        atr: analysisData.atr || 0,
        adx: analysisData.adx || 0,
        volume: analysisData.volume || 0,
        
        // Market structure
        trend: analysisData.trend || 'unknown',
        trendStrength: analysisData.trendStrength || 0,
        confidence: confidence,
        volatility: analysisData.volatility || 0,
        marketRegime: analysisData.marketRegime || 'normal',
        
        // Support and resistance
        support: analysisData.support || 0,
        resistance: analysisData.resistance || 0,
        fibLevels: analysisData.fibLevels || [],
        keyLevel: analysisData.keyLevel || null,
        levelDistance: analysisData.levelDistance || 0,
        
        // Pattern recognition
        patternType: analysisData.patternType || null,
        patternId: analysisData.patternId || null,
        patternConfidence: analysisData.patternConfidence || 0,
        similarPatterns: analysisData.similarPatterns || 0,
        
        // Multi-timeframe analysis
        timeframeConcurrence: analysisData.timeframeConcurrence || false,
        primaryTimeframe: analysisData.primaryTimeframe || '1m',
        
        // Raw market data for analysis
        candles: analysisData.candles ? analysisData.candles.slice(-10) : [],
        features: analysisData.features || [],
        originalAnalysis: analysisData
      },
      
      // Risk management with dynamic context
      stopLossPrice: this.calculateStopLoss(price, direction, {
        regime: analysisData.marketRegime || analysisData.trend || 'ranging',
        confidence: confidence,
        atr: analysisData.atr || 0.02,
        volatility: analysisData.volatility || 0
      }),
      takeProfitPrice: this.calculateTakeProfit(price, direction),
      maxRisk: positionValue * this.config.maxRiskPerTrade,
      
      // Performance tracking
      highestPrice: price,  // Track highest price reached
      lowestPrice: price,   // Track lowest price reached
      maxProfitReached: 0,  // Track maximum profit reached
      maxDrawdown: 0,       // Track maximum drawdown
      
      // Profit management state
      profitTiers: [],      // Track which profit tiers have been hit
      partialExitsDone: 0,  // Count of partial exits executed
      
      // Position metadata
      positionId: `pos_${Date.now()}`, // Unique position identifier
      sessionTradeNumber: this.sessionStats.tradesCount + 1,
      
      // 💰 BREAKEVEN WITHDRAWAL TRACKING
      breakevenWithdrawn: false,        // Track if breakeven withdrawal was executed
      breakevenWithdrawalPrice: 0,      // Price at which breakeven withdrawal occurred
      breakevenWithdrawalAmount: 0,     // Amount withdrawn at breakeven
      originalSize: size,               // Original position size before any withdrawals
      freeProfitMode: false            // Track if position is now in "free profit" mode
    };
    
    // 🚀 SCALPER-SPECIFIC: Capture entry momentum for shift detection
    if (this.scalperConfig.scalperModeActive) {
      this.scalperConfig.entryMomentum = {
        rsi: analysisData.rsi || 50,
        macd: analysisData.macd || 0,
        volume: analysisData.volume || 0,
        trend: analysisData.trend || 'neutral',
        capturedAt: Date.now()
      };
    }
    
    // Start advanced profit management
    this.maxProfitManager.start(price, direction, {
      volatility: analysisData.volatility,
      confidence: confidence,
      marketRegime: analysisData.marketRegime
    });
    
    // Update session statistics
    this.sessionStats.tradesCount++;
    
    // Store pattern data for learning
    if (analysisData.patternType) {
      this.currentPatternId = analysisData.patternId;
      this.storePatternEntry(analysisData);
    }
    
    // 🔥 AGGRESSIVE MODE: Notify that a trade was executed to stop infinite "FORCE FIRST TRADE" loop
    if (this.ogzPrime && this.ogzPrime.aggressiveTradingMode && this.ogzPrime.aggressiveTradingMode.isActive()) {
      this.ogzPrime.aggressiveTradingMode.recordTrade();
      console.log('🔥 AGGRESSIVE MODE: Trade recorded - stopping force trade loop');
    }
    
    // 📊 PERFORMANCE TRACKING: Record trade initiation
    if (this.config.enablePerformanceTracking && this.performanceValidator) {
      const involvedComponents = this.extractInvolvedComponents(reason, analysisData);
      // Note: We'll record the full trade result in closePosition
      console.log(`📊 Trade initiated - Components: [${involvedComponents.join(', ')}]`);
    }
    
    // Log position opening
    console.log(`🚀 POSITION OPENED:`);
    console.log(`   ${direction.toUpperCase()} @ $${price.toFixed(2)} | Size: ${size.toFixed(6)} | Value: $${positionValue.toFixed(2)}`);
    console.log(`   Confidence: ${confidence.toFixed(2)} | Reason: ${reason}`);
    console.log(`   RSI: ${(analysisData.rsi || 0).toFixed(1)} | Trend: ${analysisData.trend || 'unknown'}`);
    console.log(`   Stop Loss: $${this.position.stopLossPrice.toFixed(2)} | Take Profit: $${this.position.takeProfitPrice.toFixed(2)}`);
    
    // CHANGE 2025-12-11: Sync with StateManager for single source of truth
    // Note: stateManager already declared at line 823 for balance sync
    stateManager.openPosition(positionValue, price, { source: 'TradingBrain', reason, confidence })
      .catch(e => {
        this.errorHandler.reportCritical('OptimizedTradingBrain', e, {
          operation: 'StateManager.openPosition',
          price, reason, confidence, positionValue
        });
      });
    
    return true;
  }
  
  /**
   * Close current position with comprehensive logging and analysis
   * @param {number} price - Exit price
   * @param {string} reason - Exit reason/trigger
   * @param {Object} currentAnalysis - Current market analysis at exit
   * @returns {Object|false} Trade result object or false if no position
   */
  closePosition(price, reason = 'Manual exit', currentAnalysis = {}) {
    // Ensure we have a position to close
    if (!this.position) {
      console.log('⚠️ No position to close');
      return false;
    }
    
    // Calculate comprehensive trade results
    const exitTime = new Date();
    const exitTimestamp = Date.now();
    const holdTime = exitTimestamp - this.position.entryTimestamp;
    
    // Calculate profit/loss with precise math
    const pnl = this.calculatePnL(price);
    const pnlPercent = ((price - this.position.entryPrice) / this.position.entryPrice) * 100;
    const realPercent = pnlPercent; // For verification
    
    // Removed: High-frequency profit calculation verification logs
    
    // Update account balance
    const balanceBefore = this.balance;
    this.balance += pnl;
    const balanceAfter = this.balance;
    
    // Update performance tracking
    this.updateSessionStats(pnl);
    
    // Create comprehensive trade record for logging
    const tradeData = {
      // Basic trade information
      type: this.position.direction,
      entryPrice: this.position.entryPrice,
      exitPrice: price,
      currentPrice: price,
      size: this.position.size,
      
      // Financial results
      pnl: pnl,
      pnlPercent: pnlPercent,
      fees: 0, // Can be enhanced to include actual fees
      netPnl: pnl, // After fees
      
      // Timing information
      entryTime: this.position.entryTime.toISOString(),
      exitTime: exitTime.toISOString(),
      holdTime: holdTime,
      
      // Account status
      balanceBefore: balanceBefore,
      balanceAfter: balanceAfter,
      
      // Technical indicators at entry (from stored analysis)
      rsi: this.position.entryAnalysis.rsi,
      macd: this.position.entryAnalysis.macd,
      macdSignal: this.position.entryAnalysis.macdSignal,
      macdHistogram: this.position.entryAnalysis.macdHistogram,
      macdCrossover: this.position.entryAnalysis.macdCrossover,
      ema20: this.position.entryAnalysis.ema20,
      ema50: this.position.entryAnalysis.ema50,
      ema200: this.position.entryAnalysis.ema200,
      sma20: this.position.entryAnalysis.sma20,
      sma50: this.position.entryAnalysis.sma50,
      bollingerUpper: this.position.entryAnalysis.bollingerUpper,
      bollingerLower: this.position.entryAnalysis.bollingerLower,
      bollingerMiddle: this.position.entryAnalysis.bollingerMiddle,
      stochastic: this.position.entryAnalysis.stochastic,
      volume: this.position.entryAnalysis.volume,
      atr: this.position.entryAnalysis.atr,
      adx: this.position.entryAnalysis.adx,
      
      // Market analysis
      trend: this.position.entryAnalysis.trend,
      trendStrength: this.position.entryAnalysis.trendStrength,
      confidence: this.position.entryAnalysis.confidence,
      volatility: this.position.entryAnalysis.volatility,
      marketRegime: this.position.entryAnalysis.marketRegime,
      support: this.position.entryAnalysis.support,
      resistance: this.position.entryAnalysis.resistance,
      fibLevels: this.position.entryAnalysis.fibLevels,
      keyLevel: this.position.entryAnalysis.keyLevel,
      levelDistance: this.position.entryAnalysis.levelDistance,
      
      // Entry signal analysis
      entryReason: this.position.entryReason,
      secondaryReasons: this.extractSecondaryReasons(this.position.entryAnalysis),
      signalStrength: this.position.entryConfidence,
      conflictingSignals: this.identifyConflictingSignals(this.position.entryAnalysis),
      patternMatch: this.position.entryAnalysis.patternType,
      patternConfidence: this.position.entryAnalysis.patternConfidence,
      timeframeConcurrence: this.position.entryAnalysis.timeframeConcurrence,
      
      // Exit signal analysis
      exitReason: reason,
      exitType: this.determineExitType(reason),
      profitTier: this.extractProfitTier(reason),
      stopLossPrice: this.position.stopLossPrice,
      takeProfitPrice: this.position.takeProfitPrice,
      trailingStopPrice: currentAnalysis.trailingStopPrice || 0,
      maxProfitReached: this.position.maxProfitReached,
      maxDrawdown: this.position.maxDrawdown,
      
      // Risk management metrics
      positionSize: this.position.size * this.position.entryPrice,
      riskPercent: (Math.abs(pnl) / balanceBefore) * 100,
      riskAmount: this.position.maxRisk,
      rewardRiskRatio: pnl > 0 ? Math.abs(pnl / this.position.maxRisk) : 0,
      maxRisk: this.position.maxRisk,
      actualRisk: Math.abs(Math.min(0, pnl)),
      
      // Pattern recognition data
      patternType: this.position.entryAnalysis.patternType,
      patternId: this.position.entryAnalysis.patternId,
      similarPatterns: this.position.entryAnalysis.similarPatterns,
      patternWinRate: this.getPatternWinRate(this.position.entryAnalysis.patternType),
      patternAvgReturn: this.getPatternAvgReturn(this.position.entryAnalysis.patternType),
      isNewPattern: this.currentPatternId ? false : true,
      
      // Session performance context
      winStreak: this.sessionStats.winStreak,
      lossStreak: this.sessionStats.lossStreak,
      dailyPnL: this.sessionStats.totalPnL + pnl,
      totalTrades: this.sessionStats.tradesCount,
      winRate: this.calculateCurrentWinRate(),
      
      // Houston fund progress
      houstonTarget: this.config.houstonFundTarget,
      houstonCurrent: balanceAfter,
      houstonProgress: (balanceAfter / this.config.houstonFundTarget) * 100,
      houstonRemaining: this.config.houstonFundTarget - balanceAfter,
      daysTrading: this.calculateTradingDays(),
      avgDailyGain: this.calculateAvgDailyGain(),
        
      // Raw analysis data for debugging
      candles: this.position.entryAnalysis.candles,
      features: this.position.entryAnalysis.features,
      originalAnalysis: this.position.entryAnalysis.originalAnalysis
    };
    
    // Store trade result for quick access
    this.lastTradeResult = {
      success: pnl > 0,
      pnl: pnl,
      pnlPercent: pnlPercent,
      entryTime: this.position.entryTime,
      exitTime: exitTime,
      entryPrice: this.position.entryPrice,
      exitPrice: price,
      holdTime: holdTime,
      reason: reason
    };


    // Add to trade history
    this.tradeHistory.push(tradeData);
    
    // Update pattern learning with trade result
    if (this.currentPatternId) {
      this.updatePatternLearning(this.currentPatternId, pnl > 0, pnl, tradeData);
      this.currentPatternId = null;
    }
    
    // Log trade to comprehensive logger
    try {
      logTrade(tradeData);
    } catch (error) {
      this.errorHandler.reportWarning('OptimizedTradingBrain', error, {
        operation: 'logTrade',
        tradeId: tradeData.id
      });
    }
    
    // 🛡️ SAFETY NET: Update trade result for safety tracking
    if (this.tradingSafetyNet) {
      this.tradingSafetyNet.updateTradeResult({
        pnl: pnl,
        balance: balanceAfter,
        timestamp: exitTimestamp,
        holdTime: holdTime,
        direction: this.position.direction
      });
    }
    
    // 📊 PERFORMANCE VALIDATOR: Record trade performance by component
    if (this.performanceValidator) {
      const involvedComponents = this.extractInvolvedComponents(this.position.entryReason, this.position.entryAnalysis);
      this.performanceValidator.recordTrade({
        pnl: pnl,
        size: this.position.size,
        duration: holdTime,
        fees: 0, // Can be enhanced with actual fees
        strategy: this.position.entryReason,
        timeframe: this.position.entryAnalysis.primaryTimeframe || '1m',
        marketCondition: this.classifyMarketCondition(this.position.entryAnalysis),
        metadata: {
          entryPrice: this.position.entryPrice,
          exitPrice: price,
          confidence: this.position.entryConfidence,
          reason: reason
        }
      }, involvedComponents);
    }
    
                                            // CHANGE 2025-12-11: Sync with StateManager before clearing position
                                            const stateManager = getStateManager();
                                            stateManager.closePosition(price, false, null, { source: 'TradingBrain', reason, pnl })
                                              .catch(e => {
                                                this.errorHandler.reportCritical('OptimizedTradingBrain', e, {
                                                  operation: 'StateManager.closePosition',
                                                  price, reason, pnl
                                                });
                                              });
    
    // Reset position and profit manager
    this.position = null;
    this.maxProfitManager.reset();
    
    // Display comprehensive trade result with enhanced PnL tracking
    console.log(`\n${pnl >= 0 ? '✅ PROFIT' : '❌ LOSS'} TRADE COMPLETED:`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💰 TRADE P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
    console.log(`📈 Entry: $${this.position.entryPrice.toFixed(2)} → Exit: $${price.toFixed(2)}`);
    console.log(`⏰ Hold Time: ${this.formatHoldTime(holdTime)} | Exit Reason: ${reason}`);
    console.log(`💳 Account Balance: $${balanceBefore.toFixed(2)} → $${balanceAfter.toFixed(2)}`);
    console.log(`📊 Session P&L: $${this.sessionStats.totalPnL.toFixed(2)} | Total Trades: ${this.sessionStats.tradesCount}`);
    console.log(`🎯 Houston Progress: ${((balanceAfter / this.config.houstonFundTarget) * 100).toFixed(1)}% ($${(this.config.houstonFundTarget - balanceAfter).toFixed(0)} remaining)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    // Process trade with any connected systems
    if (this.ogzPrime) {
      // Update risk manager if available
      if (this.ogzPrime.riskManager) {
     //   this.ogzPrime.riskManager.processTrade(tradeData, balanceAfter);
      }
      
      // Update performance analyzer if available
      if (this.ogzPrime.performanceAnalyzer) {
        this.ogzPrime.performanceAnalyzer.processTrade(tradeData, currentAnalysis);
      }
      
      // Update daily stats in main system
      if (this.ogzPrime.updateDailyStats) {
        this.ogzPrime.updateDailyStats(pnl);
      }
    }
    
    return tradeData;
  }
  
  /**
   * Manage active position with price updates and profit management
   * @param {number} price - Current market price
   * @param {Object} currentAnalysis - Current market analysis
   */
  managePosition(price, currentAnalysis = {}) {
    // Only manage if we have an active position
    if (!this.position) return;
    
    // 🚀 SCALPER-SPECIFIC: Check for micro-profits and quick exits FIRST
    if (this.scalperConfig.scalperModeActive) {
      const scalperAction = this.checkScalperExitConditions(price, currentAnalysis);
      if (scalperAction) {
        this.closePosition(price, scalperAction.reason, currentAnalysis);
        return; // Exit early - scalper takes priority
      }
    }
    
    // 💰 BREAKEVEN WITHDRAWAL: Check for breakeven withdrawal opportunity
    if (this.config.enableBreakevenWithdrawal && !this.position.breakevenWithdrawn) {
      const breakevenAction = this.checkBreakevenWithdrawal(price, currentAnalysis);
      if (breakevenAction) {
        this.executeBreakevenWithdrawal(price, breakevenAction, currentAnalysis);
        return; // Continue managing the remaining position
      }
    }
    
    // Update position tracking metrics
    this.updatePositionMetrics(price);
    
    // Update advanced profit management system
    const profitResult = this.maxProfitManager.update(price, {
      volatility: currentAnalysis.volatility,
      trend: currentAnalysis.trend,
      volume: currentAnalysis.volume
    });
    
    // Handle profit management signals
    if (profitResult.action === 'exit') {
      // Full position exit triggered
      this.closePosition(price, profitResult.reason, currentAnalysis);
    } else if (profitResult.action === 'partialExit') {
      // Partial exit triggered
      this.executePartialExit(price, profitResult, currentAnalysis);
    }
    
    // Check for manual stop loss or take profit with FREE PROFIT ADJUSTMENTS
    this.checkBasicExitConditions(price, currentAnalysis);
  }
  
  /**
   * Execute partial exit of position
   * @param {number} price - Current price
   * @param {Object} exitResult - Exit result from profit manager
   * @param {Object} currentAnalysis - Current market analysis
   */
  executePartialExit(price, exitResult, currentAnalysis) {
    if (!this.position) return;
    
    // Calculate partial exit amount
    const partialSize = this.position.size * exitResult.exitSize;
    const partialPnl = (price - this.position.entryPrice) * partialSize;
    
    // Update balance and position size
    this.balance += partialPnl;
    this.position.size -= partialSize;
    this.position.partialExitsDone++;
    
    // Track which profit tier was hit
    if (exitResult.tier) {
      this.position.profitTiers.push({
        tier: exitResult.tier,
        price: price,
        size: partialSize,
        pnl: partialPnl,
        timestamp: Date.now()
      });
    }
    
    // Removed: High-frequency partial exit logging
  }
  
  /**
   * 🚀 SCALPER-SPECIFIC: Check FEE-AWARE scalper exit conditions (micro-profits, quick exits)
   * @param {number} price - Current price
   * @param {Object} currentAnalysis - Current market analysis
   * @returns {Object|null} Exit action or null
   */
  checkScalperExitConditions(price, currentAnalysis) {
    if (!this.position) return null;
    
    const currentTime = Date.now();
    const holdTime = currentTime - this.position.entryTimestamp;
    const currentPnL = this.calculatePnL(price);
    const pnlPercent = Math.abs(currentPnL / (this.position.entryPrice * this.position.size));
    
    // 💰 FEE-AWARE MICRO-PROFIT TAKING: 0.5%+ profits (after 0.35% fees = 0.15% net)
    if (this.isProfitTargetMet(pnlPercent, this.scalperConfig.microProfitThreshold) && currentPnL > 0) {
      const netProfit = this.calculateNetProfit(currentPnL);
      return {
        action: 'exit',
        reason: `FEE-AWARE Micro-Profit: ${(pnlPercent * 100).toFixed(2)}% gross, ${((netProfit / (this.position.entryPrice * this.position.size)) * 100).toFixed(2)}% net in ${this.formatHoldTime(holdTime)}`
      };
    }
    
    // ⚡ FEE-AWARE QUICK PROFIT TAKING: 0.8%+ profits (after 0.35% fees = 0.45% net)
    if (this.isProfitTargetMet(pnlPercent, this.scalperConfig.quickProfitThreshold) && currentPnL > 0) {
      const netProfit = this.calculateNetProfit(currentPnL);
      return {
        action: 'exit',
        reason: `FEE-AWARE Quick-Profit: ${(pnlPercent * 100).toFixed(2)}% gross, ${((netProfit / (this.position.entryPrice * this.position.size)) * 100).toFixed(2)}% net FAST EXIT`
      };
    }
    
    // 🕒 MAX HOLD TIME: 5 minutes maximum
    if (holdTime >= this.scalperConfig.maxHoldTime) {
      return {
        action: 'exit',
        reason: `Scalper Max-Hold: ${this.formatHoldTime(holdTime)} limit reached`
      };
    }
    
    // 📉 MOMENTUM SHIFT DETECTION: Check every 5 seconds
    if (currentTime - this.scalperConfig.lastMomentumCheck >= 5000) {
      this.scalperConfig.lastMomentumCheck = currentTime;
      
      const momentumShift = this.detectMomentumShift(currentAnalysis);
      if (momentumShift) {
        return {
          action: 'exit',
          reason: `Scalper Momentum-Shift: ${momentumShift.reason}`
        };
      }
    }
    
    // 🔴 TIGHT STOP LOSS: 50% tighter than normal
    const tightStopDistance = this.position.entryPrice * this.config.stopLossPercent * this.scalperConfig.tightStopMultiplier;
    const tightStopPrice = this.position.direction === 'buy'
      ? this.position.entryPrice - tightStopDistance
      : this.position.entryPrice + tightStopDistance;
      
    if ((this.position.direction === 'buy' && price <= tightStopPrice) ||
        (this.position.direction === 'sell' && price >= tightStopPrice)) {
      return {
        action: 'exit',
        reason: `Scalper Tight-Stop: ${(this.scalperConfig.tightStopMultiplier * 100)}% tighter stop triggered`
      };
    }
    
    return null; // No scalper exit conditions met
  }
  
  /**
   * 📊 SCALPER-SPECIFIC: Detect momentum shifts for quick exits
   * @param {Object} currentAnalysis - Current market analysis
   * @returns {Object|null} Momentum shift detection result
   */
  detectMomentumShift(currentAnalysis) {
    if (!this.position || !this.scalperConfig.entryMomentum) return null;
    
    // Compare current momentum vs entry momentum
    const currentMomentum = {
      rsi: currentAnalysis.rsi || 50,
      macd: currentAnalysis.macd || 0,
      volume: currentAnalysis.volume || 0,
      trend: currentAnalysis.trend || 'neutral'
    };
    
    // RSI momentum shift (15% threshold)
    const rsiShift = Math.abs(currentMomentum.rsi - this.scalperConfig.entryMomentum.rsi) / this.scalperConfig.entryMomentum.rsi;
    if (rsiShift >= this.scalperConfig.momentumShiftThreshold) {
      return { reason: `RSI shifted ${(rsiShift * 100).toFixed(1)}%` };
    }
    
    // MACD momentum shift
    if (this.scalperConfig.entryMomentum.macd !== 0) {
      const macdShift = Math.abs(currentMomentum.macd - this.scalperConfig.entryMomentum.macd) / Math.abs(this.scalperConfig.entryMomentum.macd);
      if (macdShift >= this.scalperConfig.momentumShiftThreshold) {
        return { reason: `MACD shifted ${(macdShift * 100).toFixed(1)}%` };
      }
    }
    
    // Trend reversal
    if (this.scalperConfig.entryMomentum.trend !== currentMomentum.trend &&
        currentMomentum.trend !== 'neutral') {
      return { reason: `Trend reversed: ${this.scalperConfig.entryMomentum.trend} → ${currentMomentum.trend}` };
    }
    
    return null;
  }

  /**
   * Check basic exit conditions (stop loss, take profit)
   * @param {number} price - Current price
   * @param {Object} currentAnalysis - Current market analysis
   */
  checkBasicExitConditions(price, currentAnalysis) {
    if (!this.position) return;
    
    // Check stop loss
    if (this.position.direction === 'buy' && price <= this.position.stopLossPrice) {
      this.closePosition(price, 'Stop Loss triggered', currentAnalysis);
      return;
    }
    
    if (this.position.direction === 'sell' && price >= this.position.stopLossPrice) {
      this.closePosition(price, 'Stop Loss triggered', currentAnalysis);
      return;
    }
    
    // Check take profit
    if (this.position.direction === 'buy' && price >= this.position.takeProfitPrice) {
      this.closePosition(price, 'Take Profit triggered', currentAnalysis);
      return;
    }
    
    if (this.position.direction === 'sell' && price <= this.position.takeProfitPrice) {
      this.closePosition(price, 'Take Profit triggered', currentAnalysis);
      return;
    }
  }
  
  /**
   * Update position tracking metrics
   * @param {number} price - Current price
   */
  updatePositionMetrics(price) {
    if (!this.position) return;
    
    // Update highest and lowest prices reached
    this.position.highestPrice = Math.max(this.position.highestPrice, price);
    this.position.lowestPrice = Math.min(this.position.lowestPrice, price);
    
    // Calculate and update maximum profit reached
    const currentPnl = this.calculatePnL(price);
    this.position.maxProfitReached = Math.max(this.position.maxProfitReached, currentPnl);
    
    // Calculate and update maximum drawdown
    const drawdownFromPeak = this.position.maxProfitReached - currentPnl;
    this.position.maxDrawdown = Math.max(this.position.maxDrawdown, drawdownFromPeak);
  }
  
  // ========================================================================
  // 🛡️ RISK MANAGEMENT UTILITY METHODS
  // ========================================================================
  
  /**
   * Get the start of the current week (Monday)
   * @returns {number} Week start timestamp
   */
  getWeekStart() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday = 0, Monday = 1
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysToMonday);
    monday.setHours(0, 0, 0, 0);
    return monday.getTime();
  }
  
  /**
   * Check if trading should be halted due to risk limits
   * @returns {Object} Risk check result
   */
  checkRiskLimits() {
    const currentLoss = this.initialBalance - this.balance;
    const currentTime = Date.now();
    
    // Check emergency stop
    if (currentLoss >= this.riskLimits.emergencyStopTrigger) {
      this.activateEmergencyStop('Emergency loss limit reached');
      return { halt: true, reason: 'Emergency stop triggered' };
    }
    
    // Check daily limits
    if (this.riskLimits.dailyLosses >= this.riskLimits.dailyLossLimit) {
      return { halt: true, reason: 'Daily loss limit exceeded' };
    }
    
    // Check weekly limits
    if (this.riskLimits.weeklyLosses >= this.riskLimits.weeklyLossLimit) {
      return { halt: true, reason: 'Weekly loss limit exceeded' };
    }
    
    // Check monthly limits
    if (this.riskLimits.monthlyLosses >= this.riskLimits.monthlyLossLimit) {
      return { halt: true, reason: 'Monthly loss limit exceeded' };
    }
    
    // Check drawdown
    if (this.riskLimits.currentDrawdown >= this.riskLimits.maxDrawdownLimit) {
      return { halt: true, reason: 'Maximum drawdown exceeded' };
    }
    
    return { halt: false, reason: null };
  }
  
  /**
   * Activate emergency stop mechanism
   * @param {string} reason - Reason for emergency stop
   */
  activateEmergencyStop(reason) {
    this.riskLimits.emergencyStopActive = true;
    this.riskLimits.emergencyStopReason = reason;
    this.riskLimits.tradingHalted = true;
    this.riskLimits.haltReason = reason;
    
    console.log(`🚨 EMERGENCY STOP ACTIVATED: ${reason}`);
    console.log(`📊 Account Status: $${this.balance.toFixed(2)} (${((this.balance/this.initialBalance-1)*100).toFixed(1)}%)`);
  }
  
  // ========================================================================
  // CALCULATION AND UTILITY METHODS
  // ========================================================================
  
  /**
   * Calculate profit/loss for current position at given price
   * @param {number} price - Current/exit price
   * @returns {number} Calculated P&L
   */
  calculatePnL(price) {
    if (!this.position) return 0;
    
    const diff = this.position.direction === 'buy'
      ? price - this.position.entryPrice
      : this.position.entryPrice - price;
      
    return diff * this.position.size;
  }
  
  /**
   * 💰 FEE-AWARE: Calculate NET profit after all fees and costs
   * @param {number} grossProfit - Gross profit before fees
   * @returns {number} Net profit after fees
   */
  calculateNetProfit(grossProfit) {
    if (!this.position) return 0;
    
    const positionValue = this.position.entryPrice * this.position.size;
    const totalFees = positionValue * this.feeConfig.totalRoundTrip;
    
    return grossProfit - totalFees;
  }
  
  /**
   * 🎯 FEE-AWARE: Check if profit target is met AFTER accounting for fees
   * @param {number} grossProfitPercent - Gross profit percentage
   * @param {number} targetPercent - Target profit percentage
   * @returns {boolean} True if target is met after fees
   */
  isProfitTargetMet(grossProfitPercent, targetPercent) {
    // Ensure gross profit exceeds target + fees + safety buffer
    const requiredGross = targetPercent + this.feeConfig.totalRoundTrip + this.feeConfig.safetyBuffer;
    return grossProfitPercent >= requiredGross;
  }
  
  /**
   * Calculate position size based on risk parameters and confidence
   * Uses Quantum Position Sizer when available, falls back to traditional sizing
   * @param {number} price - Entry price
   * @param {number} confidence - Signal confidence (0-5)
   * @param {Object} analysisData - Market analysis data
   * @returns {number} Calculated position size
   */
  /**
   * Enhanced Position Size Calculation with Quantum Sizing
   * @param {number} price - Current market price
   * @param {number} confidence - Signal confidence (0-1)
   * @param {Object} marketData - Complete market data
   * @param {Object} tierFlags - Feature flags for tier-based sizing
   * @returns {number} Calculated position size as percentage
   */
  calculatePositionSize(price, confidence = 1, marketData = {}, tierFlags = {}) {
    // === PHASE 1: QUANTUM POSITION SIZER ===
    // Use quantum sizing for ELITE tier with advanced Kelly criterion
    if (tierFlags.enableQuantumPositionSizer && this.quantumPositionSizer) {
      try {
        const quantumSize = this.quantumPositionSizer.calculateOptimalPosition(
          price,
          marketData.volatility || 0.02,
          confidence,
          this.balance,
          {
            winRate: marketData.winRate || 0.5,
            avgWin: marketData.avgWin || 2.5,
            avgLoss: marketData.avgLoss || 1.5,
            volume: marketData.volume,
            correlation: marketData.correlation || 0,
            momentum: marketData.momentum || 0,
            currentDrawdown: marketData.currentDrawdown || 0
          }
        );

        console.log(`💎 Quantum Size: ${(quantumSize * 100).toFixed(3)}%`);
        console.log(`   📊 Confidence: ${(confidence * 100).toFixed(1)}%`);
        console.log(`   📈 Win Rate: ${((marketData.winRate || 0.5) * 100).toFixed(1)}%`);
        console.log(`   📊 Volatility: ${((marketData.volatility || 0.02) * 100).toFixed(1)}%`);

        return quantumSize;

      } catch (error) {
        console.log(`⚠️ Quantum Position Sizer error: ${error.message}, falling back to basic sizing`);
        // Fall through to basic sizing
      }
    }

    // === PHASE 2: PATTERN-BASED POSITION SIZING ===
    // Adjust position size based on historical pattern win rate
    let patternSizeMultiplier = 1.0;

    if (marketData.patterns && marketData.patterns.length > 0) {
      // Get the primary pattern (highest confidence)
      const primaryPattern = marketData.patterns.reduce((best, current) =>
        (current.confidence > best.confidence) ? current : best
      );

      // Get historical win rate for this pattern type
      const patternWinRate = this.getPatternWinRate(primaryPattern.type || primaryPattern.name);
      const sampleSize = this.getPatternSampleSize(primaryPattern.type || primaryPattern.name);

      // Only apply multiplier if we have sufficient sample size
      if (sampleSize >= 10) {  // Require at least 10 historical occurrences
        // Clamp multiplier between 0.75 and 1.5 for safety
        // Win rate 70%+ = 1.5x size
        // Win rate 50% = 1.0x size
        // Win rate 30%- = 0.75x size
        patternSizeMultiplier = Math.max(0.75, Math.min(1.5, 0.5 + patternWinRate));

        console.log(`🎯 Pattern-Based Sizing Active:`);
        console.log(`   📊 Pattern: ${primaryPattern.type || primaryPattern.name}`);
        console.log(`   📈 Win Rate: ${(patternWinRate * 100).toFixed(1)}% (${sampleSize} samples)`);
        console.log(`   🎚️ Size Multiplier: ${patternSizeMultiplier.toFixed(2)}x`);
      }
    }

    // === PHASE 3: BASIC POSITION SIZING ===
    // Enhanced basic sizing for STARTER/PRO tiers
    const baseSize = this.config.maxPositionSize || 0.1;
    const volatilityAdjustment = (marketData.volatility && marketData.volatility > 0.03) ? 0.7 : 1.0;
    const confidenceMultiplier = 0.5 + (confidence * 0.5);

    // CHANGE 2026-01-31: Use MarketRegimeDetector's riskMultiplier for position sizing
    // VOLATILE: 0.5 (half risk), BREAKOUT: 1.5 (aggressive), TRENDING_DOWN: 0.8 (reduce risk)
    let regimeRiskMultiplier = 1.0;
    let regimeName = 'unknown';
    if (this.marketRegimeDetector) {
      const regime = this.marketRegimeDetector.currentRegime;
      const regimeParams = this.marketRegimeDetector.getRegimeParameters?.(regime);
      if (regimeParams?.riskMultiplier) {
        regimeRiskMultiplier = regimeParams.riskMultiplier;
        regimeName = regime;
      }
    }

    // Apply leverage limits based on tier
    const maxLeverage = tierFlags.enableHedgeMode ? 2 : 1; // Allow 2x leverage for hedge mode
    const leverageMultiplier = Math.min(maxLeverage, 1 + (confidence - 0.5) * 2);

    const size = baseSize * volatilityAdjustment * confidenceMultiplier * leverageMultiplier * patternSizeMultiplier * regimeRiskMultiplier;

    console.log(`📊 Final Position Size: ${(size * 100).toFixed(2)}%`);
    console.log(`   📊 Confidence: ${(confidence * 100).toFixed(1)}%`);
    console.log(`   📈 Leverage: ${leverageMultiplier.toFixed(1)}x (max ${maxLeverage}x)`);
    console.log(`   🎯 Pattern Multiplier: ${patternSizeMultiplier.toFixed(2)}x`);
    console.log(`   🌡️ Regime Risk: ${regimeRiskMultiplier.toFixed(2)}x (${regimeName})`);

    return Math.min(size, baseSize * maxLeverage * patternSizeMultiplier * regimeRiskMultiplier);
  }
  
  /**
   * Calculate stop loss price
   * Uses AdaptiveRiskManagementSystem if available, otherwise falls back to static percent
   *
   * @param {number} entryPrice - Entry price
   * @param {string} direction - Position direction
   * @param {object} context - Additional context (regime, atr, confidence, etc.)
   * @returns {number} Stop loss price
   */
  calculateStopLoss(entryPrice, direction, context = {}) {
    // CHANGE 611: Normalize direction to lowercase for case-insensitive comparisons
    const dirLower = (direction || '').toString().toLowerCase();

    // CHANGE 2026-01-31: Use MarketRegimeDetector's stopLossMultiplier (FINALLY WIRED UP!)
    let regimeMultiplier = 1.0;
    let regimeName = 'unknown';
    if (this.marketRegimeDetector) {
      const regime = this.marketRegimeDetector.currentRegime;
      const regimeParams = this.marketRegimeDetector.getRegimeParameters?.(regime);
      if (regimeParams?.stopLossMultiplier) {
        regimeMultiplier = regimeParams.stopLossMultiplier;
        regimeName = regime;
      }
    }

    // Try to use AdaptiveRiskManagementSystem for dynamic stops if available
    if (this.bot?.adaptiveRiskSystem) {
      const signal = {
        entryPrice,
        direction: direction.toUpperCase(),
        regime: context.regime || 'ranging',
        confidence: context.confidence || 0.5
      };

      const dynamicStop = this.bot.adaptiveRiskSystem.calculateDynamicStopLoss(signal);
      // Apply regime multiplier to dynamic stop distance
      const adjustedDistance = (entryPrice - dynamicStop.stopPrice) * regimeMultiplier;
      const adjustedStop = dirLower === 'buy'
        ? entryPrice - Math.abs(adjustedDistance)
        : entryPrice + Math.abs(adjustedDistance);

      console.log(`🎯 [DYNAMIC STOP] ${regimeName}: $${adjustedStop.toFixed(2)} (${regimeMultiplier}x multiplier)`);
      return adjustedStop;
    }

    // CHANGE 2026-01-31: Apply regime multiplier to static stop loss
    const baseStopPercent = this.config.stopLossPercent / 100;
    const adjustedStopPercent = baseStopPercent * regimeMultiplier;
    const stopDistance = entryPrice * adjustedStopPercent;
    const stopPrice = dirLower === 'buy'
      ? entryPrice - stopDistance
      : entryPrice + stopDistance;

    console.log(`📏 [REGIME STOP] ${regimeName}: ${(adjustedStopPercent * 100).toFixed(2)}% (${regimeMultiplier}x) → $${stopPrice.toFixed(2)}`);
    return stopPrice;
  }
  
  /**
   * Calculate take profit price
   * @param {number} entryPrice - Entry price
   * @param {string} direction - Position direction
   * @returns {number} Take profit price
   */
  calculateTakeProfit(entryPrice, direction) {
    // CHANGE 611: Normalize direction to lowercase to fix case-sensitivity bug
    const dirLower = (direction || '').toString().toLowerCase();

    // CHANGE 2026-01-31: Use MarketRegimeDetector's takeProfitMultiplier
    // TRENDING_UP: 2.0 (let winners run), RANGING: 1.0 (quick profits), BREAKOUT: 3.0 (big targets)
    let regimeMultiplier = 1.0;
    if (this.marketRegimeDetector) {
      const regime = this.marketRegimeDetector.currentRegime;
      const regimeParams = this.marketRegimeDetector.getRegimeParameters?.(regime);
      if (regimeParams?.takeProfitMultiplier) {
        regimeMultiplier = regimeParams.takeProfitMultiplier;
      }
    }

    // CHANGE 652: Fix take profit calculation - was multiplying by 15 instead of 0.15
    // OLD BUG: entryPrice * 15.0 = $16,528 * 15 = $247,920 (1400% profit target!)
    // FIXED: entryPrice * (15.0 / 100) = $16,528 * 0.15 = $2,479 profit
    const baseProfitDistance = entryPrice * (this.config.takeProfitPercent / 100);
    const adjustedProfitDistance = baseProfitDistance * regimeMultiplier;

    return dirLower === 'buy'
      ? entryPrice + adjustedProfitDistance
      : entryPrice - adjustedProfitDistance;
  }
  
  // ========================================================================
  // ANALYSIS AND LEARNING METHODS
  // ========================================================================
  
  /**
   * Interpret RSI value into signal category
   * @param {number} rsi - RSI value
   * @returns {string} RSI interpretation
   */
  interpretRSI(rsi) {
    if (rsi >= 70) return 'overbought';
    if (rsi <= 30) return 'oversold';
    if (rsi >= 60) return 'bullish';
    if (rsi <= 40) return 'bearish';
    return 'neutral';
  }
  
  /**
   * Determine exit type from reason string
   * @param {string} reason - Exit reason
   * @returns {string} Exit type category
   */
  determineExitType(reason) {
    const reasonLower = reason.toLowerCase();
    if (reasonLower.includes('stop')) return 'stop_loss';
    if (reasonLower.includes('profit') || reasonLower.includes('tier')) return 'take_profit';
    if (reasonLower.includes('trailing')) return 'trailing_stop';
    if (reasonLower.includes('signal')) return 'signal';
    return 'manual';
  }
  
  /**
   * Extract profit tier number from exit reason
   * @param {string} reason - Exit reason
   * @returns {number|null} Profit tier number
   */
  extractProfitTier(reason) {
    const tierMatch = reason.match(/tier\s*(\d+)/i);
    return tierMatch ? parseInt(tierMatch[1]) : null;
  }
  
  /**
   * Extract secondary reasons from analysis
   * @param {Object} analysis - Market analysis
   * @returns {Array} Array of secondary reasons
   */
  extractSecondaryReasons(analysis) {
    const reasons = [];
    
    if (analysis.macdCrossover) reasons.push('MACD crossover');
    if (analysis.rsi <= 30) reasons.push('RSI oversold');
    if (analysis.rsi >= 70) reasons.push('RSI overbought');
    if (analysis.trend === 'uptrend') reasons.push('Uptrend alignment');
    if (analysis.trend === 'downtrend') reasons.push('Downtrend alignment');
    if (analysis.keyLevel) reasons.push('Key level proximity');
    
    return reasons;
  }
  
  /**
   * Identify conflicting signals in analysis
   * @param {Object} analysis - Market analysis
   * @returns {Array} Array of conflicting signals
   */
  identifyConflictingSignals(analysis) {
    const conflicts = [];
    
    // RSI vs Trend conflicts
    if (analysis.rsi >= 70 && analysis.trend === 'uptrend') {
      conflicts.push('RSI overbought but trend bullish');
    }
    if (analysis.rsi <= 30 && analysis.trend === 'downtrend') {
      conflicts.push('RSI oversold but trend bearish');
    }
    
    // MACD vs Price action conflicts
    if (analysis.macd < 0 && analysis.trend === 'uptrend') {
      conflicts.push('MACD bearish but price uptrending');
    }
    
    return conflicts;
  }
  
  // ========================================================================
  // PERFORMANCE TRACKING METHODS
  // ========================================================================
  
  /**
   * Update session statistics with trade result
   * @param {number} pnl - Trade profit/loss
   */
  updateSessionStats(pnl) {
    this.sessionStats.totalPnL += pnl;
    
    if (pnl > 0) {
      this.sessionStats.winsCount++;
      this.sessionStats.bestTrade = Math.max(this.sessionStats.bestTrade, pnl);
      
      // Update win streak
      if (this.sessionStats.currentStreakType === 'win') {
        this.sessionStats.currentStreak++;
      } else {
        this.sessionStats.currentStreak = 1;
        this.sessionStats.currentStreakType = 'win';
      }
      this.sessionStats.winStreak = Math.max(this.sessionStats.winStreak, this.sessionStats.currentStreak);
      
    } else if (pnl < 0) {
      this.sessionStats.lossesCount++;
      this.sessionStats.worstTrade = Math.min(this.sessionStats.worstTrade, pnl);
      
      // Update loss streak
      if (this.sessionStats.currentStreakType === 'loss') {
        this.sessionStats.currentStreak++;
      } else {
        this.sessionStats.currentStreak = 1;
        this.sessionStats.currentStreakType = 'loss';
      }
      this.sessionStats.lossStreak = Math.max(this.sessionStats.lossStreak, this.sessionStats.currentStreak);
    }
  }
  
  /**
   * Calculate current win rate
   * @returns {number} Win rate percentage
   */
  calculateCurrentWinRate() {
    const totalTrades = this.sessionStats.winsCount + this.sessionStats.lossesCount;
    return totalTrades > 0 ? (this.sessionStats.winsCount / totalTrades) * 100 : 0;
  }
  
  /**
   * Calculate number of trading days
   * @returns {number} Number of trading days
   */
  calculateTradingDays() {
    // This would be enhanced to track actual trading start date
    return 1; // Placeholder - should track from session start
  }
  
  /**
   * Calculate average daily gain
   * @returns {number} Average daily gain
   */
  calculateAvgDailyGain() {
    const days = this.calculateTradingDays();
    return days > 0 ? this.sessionStats.totalPnL / days : 0;
  }
  
  /**
   * Format hold time in human readable format
   * @param {number} holdTimeMs - Hold time in milliseconds
   * @returns {string} Formatted hold time
   */
  formatHoldTime(holdTimeMs) {
    if (!holdTimeMs) return '0s';
    
    const seconds = Math.floor(holdTimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
  
  // ========================================================================
  // PATTERN LEARNING METHODS (PLACEHOLDER FOR FUTURE ENHANCEMENT)
  // ========================================================================
  
  /**
   * Store pattern entry data for learning
   * @param {Object} analysisData - Analysis data with pattern information
   */
  storePatternEntry(analysisData) {
    // 🧠 PROFILE-SPECIFIC PATTERN STORAGE: Store pattern with ProfilePatternManager
    if (this.ogzPrime && this.ogzPrime.profilePatternManager && analysisData.patternType) {
      try {
        const profile = this.ogzPrime.getCurrentProfile();
        if (profile) {
          console.log(`🧠 Storing pattern entry for profile: ${profile.name}`);
          
          // Create comprehensive pattern data
          const patternData = {
            type: analysisData.patternType,
            id: analysisData.patternId || `pattern_${Date.now()}`,
            confidence: analysisData.patternConfidence || analysisData.confidence || 0,
            features: {
              rsi: analysisData.rsi || 0,
              macd: analysisData.macd || 0,
              macdSignal: analysisData.macdSignal || 0,
              macdHistogram: analysisData.macdHistogram || 0,
              trend: analysisData.trend || 'unknown',
              trendStrength: analysisData.trendStrength || 0,
              volatility: analysisData.volatility || 0,
              volume: analysisData.volume || 0,
              support: analysisData.support || 0,
              resistance: analysisData.resistance || 0
            },
            marketConditions: {
              timeframe: analysisData.primaryTimeframe || '1m',
              marketRegime: analysisData.marketRegime || 'normal',
              timeframeConcurrence: analysisData.timeframeConcurrence || false
            },
            metadata: {
              entryPrice: this.position ? this.position.entryPrice : 0,
              timestamp: new Date().toISOString(),
              sessionTradeNumber: this.sessionStats.tradesCount
            }
          };
          
          // Add pattern to ProfilePatternManager
          this.ogzPrime.profilePatternManager.addPattern(profile.name, patternData);
          
          console.log(`✅ Pattern ${analysisData.patternType} stored for ${profile.name}`);
        } else {
          console.log('⚠️ No active profile found for pattern storage');
        }
      } catch (error) {
        console.error('❌ Failed to store pattern entry:', error.message);
      }
    } else {
      console.log('⚠️ ProfilePatternManager not available or no pattern type specified');
    }
  }
  
  /**
   * Update pattern learning with trade result
   * @param {string} patternId - Pattern identifier
   * @param {boolean} wasWin - Whether trade was profitable
   * @param {number} pnl - Profit/loss amount
   * @param {Object} tradeData - Complete trade data
   */
  updatePatternLearning(patternId, wasWin, pnl, tradeData) {
    // 🧠 PROFILE-SPECIFIC PATTERN LEARNING: Record trade result with ProfilePatternManager
    if (this.ogzPrime && this.ogzPrime.profilePatternManager) {
      try {
        const profile = this.ogzPrime.getCurrentProfile();
        if (profile) {
          console.log(`🧠 Recording trade result for pattern ${patternId} in profile: ${profile.name}`);
          
          // Record the trade result with comprehensive data
          this.ogzPrime.profilePatternManager.recordTradeResult(profile.name, patternId, {
            successful: wasWin,
            pnl: pnl,
            pnlPercent: tradeData.pnlPercent || 0,
            entryPrice: tradeData.entryPrice,
            exitPrice: tradeData.exitPrice,
            holdTime: tradeData.holdTime,
            exitReason: tradeData.exitReason,
            marketConditions: {
              rsi: tradeData.rsi,
              macd: tradeData.macd,
              trend: tradeData.trend,
              volatility: tradeData.volatility,
              volume: tradeData.volume,
              confidence: tradeData.confidence
            },
            timestamp: new Date().toISOString()
          });
          
          console.log(`✅ Pattern learning updated for ${profile.name}: ${wasWin ? 'WIN' : 'LOSS'} ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
        } else {
          console.log('⚠️ No active profile found for pattern learning');
        }
      } catch (error) {
        console.error('❌ Failed to update pattern learning:', error.message);
      }
    } else {
      console.log('⚠️ ProfilePatternManager not available for pattern learning');
    }
    
    // Legacy pattern memory (keep for compatibility)
    if (patternId && this.patternMemory) {
      if (!this.patternMemory.has(patternId)) {
        this.patternMemory.set(patternId, { wins: 0, losses: 0, totalPnl: 0, count: 0 });
      }
      
      const pattern = this.patternMemory.get(patternId);
      pattern.count++;
      pattern.totalPnl += pnl;
      
      if (wasWin) {
        pattern.wins++;
      } else {
        pattern.losses++;
      }
    }
  }
  
  /**
   * Get pattern win rate
   * @param {string} patternType - Pattern type
   * @returns {number} Pattern win rate percentage
   */
  getPatternWinRate(patternType) {
    // 🧠 PROFILE-SPECIFIC PATTERN QUERY: Get win rate from ProfilePatternManager
    if (this.ogzPrime && this.ogzPrime.profilePatternManager) {
      try {
        const profile = this.ogzPrime.getCurrentProfile();
        if (profile) {
          const patterns = this.ogzPrime.profilePatternManager.getPatterns(profile.name);
          const typePatterns = patterns.filter(p => p.type === patternType);
          
          if (typePatterns.length === 0) return 0;
          
          let wins = 0;
          let total = 0;
          
          typePatterns.forEach(pattern => {
            if (pattern.tradeResults && pattern.tradeResults.length > 0) {
              pattern.tradeResults.forEach(result => {
                total++;
                if (result.successful) wins++;
              });
            }
          });
          
          return total > 0 ? (wins / total) * 100 : 0;
        }
      } catch (error) {
        console.error('❌ Failed to get pattern win rate:', error.message);
      }
    }
    
    // Fallback to legacy pattern memory
    if (this.patternMemory && this.patternMemory.has(patternType)) {
      const pattern = this.patternMemory.get(patternType);
      const total = pattern.wins + pattern.losses;
      return total > 0 ? (pattern.wins / total) * 100 : 0;
    }
    
    return 0;
  }
  
  /**
   * Get pattern average return
   * @param {string} patternType - Pattern type
   * @returns {number} Pattern average return percentage
   */
  getPatternAvgReturn(patternType) {
    // 🧠 PROFILE-SPECIFIC PATTERN QUERY: Get average return from ProfilePatternManager
    if (this.ogzPrime && this.ogzPrime.profilePatternManager) {
      try {
        const profile = this.ogzPrime.getCurrentProfile();
        if (profile) {
          const patterns = this.ogzPrime.profilePatternManager.getPatterns(profile.name);
          const typePatterns = patterns.filter(p => p.type === patternType);
          
          if (typePatterns.length === 0) return 0;
          
          let totalReturn = 0;
          let count = 0;
          
          typePatterns.forEach(pattern => {
            if (pattern.tradeResults && pattern.tradeResults.length > 0) {
              pattern.tradeResults.forEach(result => {
                totalReturn += result.pnlPercent || 0;
                count++;
              });
            }
          });
          
          return count > 0 ? totalReturn / count : 0;
        }
      } catch (error) {
        console.error('❌ Failed to get pattern average return:', error.message);
      }
    }
    
    // Fallback to legacy pattern memory
    if (this.patternMemory && this.patternMemory.has(patternType)) {
      const pattern = this.patternMemory.get(patternType);
      return pattern.count > 0 ? (pattern.totalPnl / pattern.count) : 0;
    }
    
    return 0;
  }
  
  // ========================================================================
  /**
   * Count confluence signals for pattern gating
   * @param {Object} marketData - Market data with indicators
   * @param {Array} patterns - Detected patterns
   * @returns {number} Number of confluence signals present
   */
  countConfluenceSignals(marketData, patterns) {
    let confluenceCount = 0;

    // Check TPO crossover
    if (marketData.tpoSignal === 'bullish' || marketData.tpoSignal === 'bearish') {
      confluenceCount++;
    }

    // Check Fibonacci levels
    if (marketData.fibLevel === 0.618 || marketData.fibLevel === 0.382) {
      confluenceCount++;
    }

    // Check support/resistance
    if (marketData.nearSupport || marketData.nearResistance) {
      confluenceCount++;
    }

    // Check trend alignment
    if (marketData.trend === 'strong_bullish' || marketData.trend === 'strong_bearish') {
      confluenceCount++;
    }

    // Check RSI extremes
    if (marketData.rsi && (marketData.rsi < 30 || marketData.rsi > 70)) {
      confluenceCount++;
    }

    // Check MACD crossover
    if (marketData.macdCrossover) {
      confluenceCount++;
    }

    return confluenceCount;
  }

  /**
   * Get pattern sample size (number of historical occurrences)
   * @param {string} patternType - Pattern type
   * @returns {number} Number of times this pattern has been seen
   */
  getPatternSampleSize(patternType) {
    // 🧠 PROFILE-SPECIFIC PATTERN QUERY: Get sample size from ProfilePatternManager
    if (this.ogzPrime && this.ogzPrime.profilePatternManager) {
      try {
        const profile = this.ogzPrime.getCurrentProfile();
        if (profile) {
          const patterns = this.ogzPrime.profilePatternManager.getPatterns(profile.name);
          const typePatterns = patterns.filter(p => p.type === patternType);

          let total = 0;
          typePatterns.forEach(pattern => {
            if (pattern.tradeResults && pattern.tradeResults.length > 0) {
              total += pattern.tradeResults.length;
            }
          });

          return total;
        }
      } catch (error) {
        console.error('❌ Failed to get pattern sample size:', error.message);
      }
    }

    // Fallback to legacy pattern memory
    if (this.patternMemory && this.patternMemory.has(patternType)) {
      const pattern = this.patternMemory.get(patternType);
      return (pattern.wins || 0) + (pattern.losses || 0);
    }

    return 0;
  }

  // 🛡️ SAFETY INTEGRATION METHODS
  // ========================================================================

  /**
   * 📊 Extract involved components from trade reason and analysis
   * @param {string} reason - Trade reason
   * @param {Object} analysisData - Analysis data
   * @returns {Array} Array of involved component names
   */
  extractInvolvedComponents(reason, analysisData) {
    const components = ['OptimizedTradingBrain']; // Always involved
    
    // Check for specific components mentioned in reason
    if (reason.includes('RANDOM') || reason.includes('Random')) {
      components.push('RandomTrades');
    }
    if (reason.includes('AGGRESSIVE') || reason.includes('Aggressive')) {
      components.push('AggressiveTradingMode');
    }
    if (reason.includes('COSMIC') || reason.includes('Cosmic')) {
      components.push('CosmicAnalysis');
    }
    if (reason.includes('QUANTUM') || reason.includes('Quantum')) {
      components.push('QuantumAnalysis');
    }
    if (reason.includes('SCALPER') || reason.includes('Scalper')) {
      components.push('ScalperMode');
    }
    
    // Check analysis data for component involvement
    if (analysisData && analysisData.patternType) {
      components.push('MultiTimeframeAnalysis');
    }
    if (this.quantumPositionSizer) {
      components.push('QuantumPositionSizer');
    }
    
    return [...new Set(components)]; // Remove duplicates
  }
  
  /**
   * 🌍 Classify market condition for performance tracking
   * @param {Object} analysisData - Market analysis data
   * @returns {string} Market condition classification
   */
  classifyMarketCondition(analysisData) {
    if (!analysisData) return 'unknown';
    
    // Determine market condition based on analysis
    if (analysisData.trend === 'uptrend') return 'trending_up';
    if (analysisData.trend === 'downtrend') return 'trending_down';
    if (analysisData.volatility > 0.03) return 'volatile';
    if (analysisData.volume && analysisData.volume < 1000) return 'low_volume';
    if (analysisData.volume && analysisData.volume > 10000) return 'high_volume';
    
    return 'sideways';
  }
  
  // ========================================================================
  // LEGACY COMPATIBILITY METHODS
  // ========================================================================
  
  /**
   * Process analysis result (legacy compatibility)
   * @param {Object} analysis - Analysis result
   * @param {number} price - Current price
   */
  processAnalysis(analysis, price) {
    console.log('🧠 TRADING BRAIN: Processing analysis...');
    console.log('🧠 Analysis Data:', {
      decision: analysis.decision,
      confidence: analysis.confidence,
      reason: analysis.reason,
      price: price,
      trend: analysis.trend,
      rsi: analysis.rsi,
      macd: analysis.macd
    });
    console.log('🧠 Current State:', {
      inPosition: this.isInPosition(),
      balance: this.balance,
      minConfidenceThreshold: this.config.minConfidenceThreshold,
      position: this.position
    });
    
    // Update position if we have one
    if (this.isInPosition()) {
      console.log('🧠 Managing existing position...');
      this.managePosition(price, analysis);
      return; // Exit early if managing position
    }
    
    // Check for new position entry (ENHANCED SAFETY: Increased confidence threshold)
    console.log('🧠 Checking new position entry criteria...');
    console.log('🧠 Entry Checks:', {
      inPosition: this.isInPosition(),
      decision: analysis.decision,
      decisionNotHold: analysis.decision !== 'hold',
      confidence: analysis.confidence,
      minThreshold: this.config.minConfidenceThreshold,
      confidenceMet: analysis.confidence >= this.config.minConfidenceThreshold
    });
    
    if (!this.isInPosition() && analysis.decision !== 'hold' && analysis.confidence >= this.config.minConfidenceThreshold) {
      console.log('🧠 All entry criteria met! Proceeding with trade...');
      
      const direction = analysis.decision === 'buy' ? 'buy' : 'sell';
      console.log(`🧠 Trade Direction: ${direction}`);
      
      console.log('🧠 Calculating position size...');
      const size = this.calculatePositionSize(price, analysis.confidence, analysis);
      console.log(`🧠 Calculated Position Size: ${size} shares`);
      
      if (size > 0) {
        console.log('🧠 Position size valid, opening position...');
        const opened = this.openPosition(price, direction, size, analysis.confidence, analysis.reason, analysis);
        console.log(`🧠 Position opened: ${opened ? 'SUCCESS' : 'FAILED'}`);
      } else {
        console.log('🧠 TRADE BLOCKED: Position size is 0 or invalid');
      }
    } else {
      console.log('🧠 Entry criteria NOT met - trade blocked');
      if (this.isInPosition()) {
        console.log('   - Already in position');
      }
      if (analysis.decision === 'hold') {
        console.log('   - Decision is HOLD');
      }
      if (analysis.confidence < this.config.minConfidenceThreshold) {
        console.log(`   - Confidence too low: ${analysis.confidence} < ${this.config.minConfidenceThreshold}`);
      }
    }
  }

  /**
   * ============================================================================
   * MODULAR REFACTOR METHODS - EXTRACTED FROM MAIN BOT
   * ============================================================================
   * These methods were extracted from run-trading-bot-v14FINAL.js during Phase 3
   * of the 9-phase modular refactor to improve code organization and maintainability.
   * ============================================================================
   */

  /**
   * MAIN CONFIDENCE CALCULATION - EXTRACTED FROM MONOLITH
   * Multi-factor confidence analysis for trading decisions
   */
  calculateRealConfidence(marketData, patterns = []) {
    // CRITICAL FIX: Make confidence directional (bullish vs bearish)
    let bullishConfidence = 0;
    let bearishConfidence = 0;
    let confidence = 0.1; // START WITH BASE 10% CONFIDENCE NOT 0!

    // OFFENSIVE MODULE: Pattern Recognition (CRITICAL: 15-30% confidence boost)
    if (this.patternRecognition && this.priceData && this.priceData.length >= 30) {
      try {
        const detectedPatterns = this.patternRecognition.analyzePatterns({
          candles: this.priceData,
          trend: marketData.trend || 'sideways',
          macd: marketData.macd || 0,
          macdSignal: marketData.macdSignal || 0,
          rsi: marketData.rsi || 50,
          volume: marketData.volume || 1000000
        });

        if (detectedPatterns && detectedPatterns.length > 0) {
          detectedPatterns.forEach(pattern => {
            if (pattern.direction === 'bullish' && pattern.confidence > 0.6) {
              bullishConfidence += 0.25;
              console.log(`   ✅ PATTERN: ${pattern.name} (${(pattern.confidence * 100).toFixed(1)}%) +25% bullish`);
            } else if (pattern.direction === 'bullish' && pattern.confidence > 0.5) {
              bullishConfidence += 0.15;
              console.log(`   ✅ PATTERN: ${pattern.name} (${(pattern.confidence * 100).toFixed(1)}%) +15% bullish`);
            } else if (pattern.direction === 'bearish' && pattern.confidence > 0.6) {
              bearishConfidence += 0.25;
              console.log(`   ✅ PATTERN: ${pattern.name} (${(pattern.confidence * 100).toFixed(1)}%) +25% bearish`);
            } else if (pattern.direction === 'bearish' && pattern.confidence > 0.5) {
              bearishConfidence += 0.15;
              console.log(`   ✅ PATTERN: ${pattern.name} (${(pattern.confidence * 100).toFixed(1)}%) +15% bearish`);
            }
          });
          console.log(`   📊 Total patterns detected: ${detectedPatterns.length}`);
        }
      } catch (error) {
        console.log(`   ⚠️ Pattern analysis error: ${error.message}`);
      }
    }

    // OFFENSIVE MODULE: Market Regime Detection (BOOSTED: 15-25%)
    // TEST MODE: Lowered from 100 to 5 candles - CHANGE BACK TO 100 FOR PRODUCTION
    console.log(`🔍 MarketRegimeDetector: exists=${!!this.marketRegimeDetector}, priceData=${this.priceData?.length || 0} candles`);
    // REQUIRE MINIMUM 100 CANDLES for proper regime analysis (MarketRegimeDetector lookback = 100)
    if (this.marketRegimeDetector && this.priceData && this.priceData.length >= 100) {
      const regimeAnalysis = this.marketRegimeDetector.analyzeMarket(this.priceData);
      console.log(`   📊 Regime: ${regimeAnalysis?.regime || 'none'}, confidence=${regimeAnalysis?.confidence || 0}`);
      if (regimeAnalysis) {
        if (regimeAnalysis.regime === 'trending_up' && regimeAnalysis.confidence > 0.7) {
          bullishConfidence += 0.25; // Strong uptrend
          console.log(`   ✅ Added 25% bullish (uptrend)`);
        } else if (regimeAnalysis.regime === 'trending_down' && regimeAnalysis.confidence > 0.7) {
          bearishConfidence += 0.25; // Strong downtrend
          console.log(`   ✅ Added 25% bearish (downtrend)`);
        } else if (regimeAnalysis.regime === 'ranging') {
          // Ranging markets slightly favor mean reversion
          bullishConfidence += 0.075;
          bearishConfidence += 0.075;
          console.log(`   ✅ Added 7.5% both (ranging)`);
        }
        marketData.marketRegime = regimeAnalysis;
      }
    } else {
      console.log(`   ⚠️ MarketRegimeDetector skipped: not enough data or not initialized`);
    }

    // VISUALIZATION MODULE: Fibonacci Levels (10-15%)
    if (this.fibonacciDetector && this.priceData && this.priceData.length > 5) {
      const fibLevels = this.fibonacciDetector.update(this.priceData);
      if (fibLevels) {
        const price = marketData.price || (this.priceData[this.priceData.length - 1]?.close || 0);
        const nearestLevel = this.fibonacciDetector.getNearestLevel(price);
        if (nearestLevel && nearestLevel.distance < 0.5) {
          confidence += 0.15; // BOOSTED from 0.10
        } else if (nearestLevel && nearestLevel.distance < 1.0) {
          confidence += 0.10; // Additional tier
        }
        marketData.fibLevels = fibLevels;
      }
    }

    // VISUALIZATION MODULE: Support/Resistance (15-20%)
    if (this.supportResistanceDetector && this.priceData && this.priceData.length > 5) {
      const levels = this.supportResistanceDetector.update(this.priceData);
      if (levels && levels.length > 0) {
        const price = marketData.price || (this.priceData[this.priceData.length - 1]?.close || 0);
        const nearestLevel = this.supportResistanceDetector.getNearestLevel(price);
        if (nearestLevel) {
          if (nearestLevel.type === 'support' && nearestLevel.distance < 0.3) {
            confidence += 0.20; // BOOSTED from 0.15
          } else if (nearestLevel.type === 'resistance' && nearestLevel.distance < 0.3) {
            confidence += 0.15; // BOOSTED from 0.08
          } else if (nearestLevel.distance < 0.5) {
            confidence += 0.10; // Additional tier for nearby levels
          }
        }
        marketData.srLevels = levels;
        console.log(`🔍 CONFIDENCE AFTER S/R: ${(confidence * 100).toFixed(1)}%`);
      }
    }

    // OFFENSIVE MODULE: Optimized Indicators (FULL SUITE)
    if (this.optimizedIndicators && this.priceData && this.priceData.length >= 2) {
      try {
        console.log(`📊 Calculating FULL indicator suite from ${this.priceData.length} candles...`);
        
        // Core indicators
        const rsi = this.optimizedIndicators.calculateRSI(this.priceData);
        const macd = this.optimizedIndicators.calculateMACD(this.priceData);
        const bb = this.optimizedIndicators.calculateBollingerBands(this.priceData);
        const atr = this.optimizedIndicators.calculateATR(this.priceData, 14);
        
        // EMA suite
        const ema20 = this.optimizedIndicators.calculateEMA(this.priceData.slice(-20), 20);
        const ema50 = this.optimizedIndicators.calculateEMA(this.priceData.slice(-50), 50);
        const ema9 = this.optimizedIndicators.calculateEMA(this.priceData.slice(-9), 9);
        
        console.log(`   📊 RSI=${rsi?.toFixed(1) || 'null'}, MACD=${macd?.macd?.toFixed(2) || 'null'}, ATR=${atr?.toFixed(2) || 'null'}%`)
console.log(`   📊 EMA9=${ema9?.toFixed(2) || 'null'}, EMA20=${ema20?.toFixed(2) || 'null'}, EMA50=${ema50?.toFixed(2) || 'null'}`);

        // RSI Signals - DIRECTIONAL (oversold = bullish, overbought = bearish)
        if (rsi) {
          if (rsi < 25) {
            bullishConfidence += 0.25; // STRONG oversold - bullish signal
            console.log(`   ✅ RSI ${rsi.toFixed(1)} < 25: Added 25% bullish (STRONG oversold)`);
          } else if (rsi < 30) {
            bullishConfidence += 0.20; // Oversold - bullish signal
            console.log(`   ✅ RSI ${rsi.toFixed(1)} < 30: Added 20% bullish (oversold)`);
          } else if (rsi > 75) {
            bearishConfidence += 0.25; // STRONG overbought - bearish signal
            console.log(`   ✅ RSI ${rsi.toFixed(1)} > 75: Added 25% bearish (STRONG overbought)`);
          } else if (rsi > 70) {
            bearishConfidence += 0.20; // Overbought - bearish signal
            console.log(`   ✅ RSI ${rsi.toFixed(1)} > 70: Added 20% bearish (overbought)`);
          } else if (rsi >= 45 && rsi <= 55) {
            console.log(`   ⚪ RSI ${rsi.toFixed(1)} in neutral zone (45-55): No confidence added`);
            // Neutral zone - no directional bias
          } else {
            console.log(`   ⚪ RSI ${rsi.toFixed(1)} not in signal range: No confidence added`);
          }
          marketData.rsi = rsi;
        }

        // MACD Signals - DIRECTIONAL
        if (macd) {
          // Calculate histogram for additional signal strength
          const histogram = macd.macd - macd.signal;

          // Use correct property names: macd.macd and macd.signal
          if (macd.macd > 0 && macd.signal > 0 && histogram > 0) {
            bullishConfidence += 0.20; // Strong bullish momentum
          } else if (macd.macd > 0 && macd.signal > 0) {
            bullishConfidence += 0.15; // Bullish momentum
          } else if (macd.macd < 0 && macd.signal < 0 && histogram < 0) {
            bearishConfidence += 0.20; // Strong bearish momentum
          } else if (macd.macd < 0 && macd.signal < 0) {
            bearishConfidence += 0.15; // Bearish momentum
          }
          // Persist on marketData with consistent naming
          marketData.macd = macd.macd;
          marketData.macdSignal = macd.signal;
          marketData.macdHistogram = histogram;
        }

        // Bollinger Bands - DIRECTIONAL (lower band = bullish, upper band = bearish)
        if (bb && marketData.price) {
          if (marketData.price <= bb.lower) {
            bullishConfidence += 0.10; // Price at lower band - oversold
            console.log(`   ✅ BB: Price at lower band +10% bullish`);
          } else if (marketData.price >= bb.upper) {
            bearishConfidence += 0.10; // Price at upper band - overbought
            console.log(`   ✅ BB: Price at upper band +10% bearish`);
          }
          marketData.bbUpper = bb.upper;
          marketData.bbMiddle = bb.middle;
          marketData.bbLower = bb.lower;
        }

        // EMA Crossover Signals - DIRECTIONAL
        if (ema9 && ema20 && ema50) {
          const price = marketData.price || this.priceData[this.priceData.length - 1]?.c;
          
          // Golden cross: EMA9 > EMA20 > EMA50 = strong bullish
          if (ema9 > ema20 && ema20 > ema50) {
            bullishConfidence += 0.20;
            console.log(`   ✅ EMA: Golden alignment (9>20>50) +20% bullish`);
          } 
          // Death cross: EMA9 < EMA20 < EMA50 = strong bearish
          else if (ema9 < ema20 && ema20 < ema50) {
            bearishConfidence += 0.20;
            console.log(`   ✅ EMA: Death alignment (9<20<50) +20% bearish`);
          }
          // Price above all EMAs = bullish
          else if (price > ema9 && price > ema20 && price > ema50) {
            bullishConfidence += 0.15;
            console.log(`   ✅ EMA: Price above all EMAs +15% bullish`);
          }
          // Price below all EMAs = bearish
          else if (price < ema9 && price < ema20 && price < ema50) {
            bearishConfidence += 0.15;
            console.log(`   ✅ EMA: Price below all EMAs +15% bearish`);
          }
          
          marketData.ema9 = ema9;
          marketData.ema20 = ema20;
          marketData.ema50 = ema50;
        }

        // ATR Volatility Analysis - RISK ADJUSTMENT
        if (atr) {
          marketData.atr = atr;
          if (atr > 3.0) {
            console.log(`   ⚠️ ATR: High volatility ${atr.toFixed(2)}% - reduce confidence by 10%`);
            bullishConfidence *= 0.9;
            bearishConfidence *= 0.9;
          } else if (atr < 1.0) {
            console.log(`   ✅ ATR: Low volatility ${atr.toFixed(2)}% - boost confidence by 10%`);
            bullishConfidence *= 1.1;
            bearishConfidence *= 1.1;
          }
        }
      } catch (error) {
        console.error('Error calculating optimized indicators:', error.message);
      }
    } else {
      // Fallback to basic indicators if no optimized module
      if (marketData.rsi) {
        if (marketData.rsi < 25) {
          confidence += 0.25; // STRONG oversold - BOOSTED
        } else if (marketData.rsi < 30) {
          confidence += 0.20; // Oversold - BOOSTED
        } else if (marketData.rsi > 75) {
          confidence += 0.25; // STRONG overbought - BOOSTED
        } else if (marketData.rsi > 70) {
          confidence += 0.20; // Overbought - BOOSTED
        } else if (marketData.rsi >= 45 && marketData.rsi <= 55) {
          confidence += 0.08; // Neutral zone
        }
      }

      // Basic MACD
      if (marketData.macd) {
        if (marketData.macd > 0 && marketData.macdSignal > 0) {
          confidence += 0.20; // Bullish - BOOSTED
        } else if (marketData.macd < 0 && marketData.macdSignal < 0) {
          confidence += 0.15; // Bearish - BOOSTED
        }
      }
    }

    // Trend alignment - DIRECTIONAL
    if (marketData.trend) {
      if (marketData.trend === 'strong_uptrend') {
        bullishConfidence += 0.25;
      } else if (marketData.trend === 'uptrend') {
        bullishConfidence += 0.15;
      } else if (marketData.trend === 'strong_downtrend') {
        bearishConfidence += 0.25;
      } else if (marketData.trend === 'downtrend') {
        bearishConfidence += 0.15;
      }
    }

    // Volume confirmation (15-20% for high volume)
    if (marketData.volume && marketData.avgVolume) {
      if (marketData.volume > marketData.avgVolume * 2.0) {
        confidence += 0.20; // Very high volume - NEW
      } else if (marketData.volume > marketData.avgVolume * 1.5) {
        confidence += 0.15; // High volume - BOOSTED from 0.10
      } else if (marketData.volume > marketData.avgVolume * 1.2) {
        confidence += 0.08; // Above average volume - NEW
      }
    }

    // Pattern bonus - DIRECTIONAL based on pattern type
    if (patterns && patterns.length > 0) {
      patterns.forEach(pattern => {
        const patternBonus = 0.08;
        const qualityMultiplier = pattern.confidence && pattern.strength ?
          (pattern.confidence * pattern.strength) : 0.5;
        const effectiveStrength = patternBonus * qualityMultiplier;

        // Normalize pattern types and apply directional scoring
        if (pattern.type && (pattern.type.includes('buy') || pattern.type.includes('bullish') ||
            pattern.type.includes('long') || pattern.type === 'ascending')) {
          bullishConfidence += effectiveStrength;
        } else if (pattern.type && (pattern.type.includes('sell') || pattern.type.includes('bearish') ||
                   pattern.type.includes('short') || pattern.type === 'descending')) {
          bearishConfidence += effectiveStrength;
        }
      });
    }

    // Support/Resistance proximity - DIRECTIONAL
    if (marketData.nearSupport) {
      bullishConfidence += 0.15; // Near support - bullish bounce expected
    } else if (marketData.nearResistance) {
      bearishConfidence += 0.15; // Near resistance - bearish rejection expected
    }

    // Multi-timeframe alignment (20% for full alignment)
    if (marketData.multiTimeframeAligned) {
      confidence += 0.20; // BOOSTED from 0.15
    }

    // EMA alignment - DIRECTIONAL
    if (marketData.ema20 && marketData.ema50 && marketData.price) {
      if (marketData.price > marketData.ema20 && marketData.ema20 > marketData.ema50) {
        bullishConfidence += 0.15; // Bullish EMA alignment
      } else if (marketData.price < marketData.ema20 && marketData.ema20 < marketData.ema50) {
        bearishConfidence += 0.15; // Bearish EMA alignment
      }
    }

    // CHANGE 2026-02-10: MODULAR ENTRY SYSTEM SIGNALS
    // EMA/SMA Crossover Signal
    if (marketData.emaCrossoverSignal && marketData.emaCrossoverSignal.confidence > 0) {
      const sig = marketData.emaCrossoverSignal;
      if (sig.direction === 'buy') {
        bullishConfidence += sig.confidence;
        console.log(`   ✅ EMACrossover: +${(sig.confidence * 100).toFixed(1)}% bullish (confluence: ${(sig.confluence * 100).toFixed(0)}%)`);
      } else if (sig.direction === 'sell') {
        bearishConfidence += sig.confidence;
        console.log(`   ✅ EMACrossover: +${(sig.confidence * 100).toFixed(1)}% bearish (confluence: ${(sig.confluence * 100).toFixed(0)}%)`);
      }
      if (sig.blowoff) {
        console.log(`   ⚠️ EMACrossover: BLOWOFF warning — don't chase!`);
      }
    }

    // MA Dynamic S/R Signal
    if (marketData.maDynamicSRSignal && marketData.maDynamicSRSignal.confidence > 0) {
      const sig = marketData.maDynamicSRSignal;
      if (sig.direction === 'buy') {
        bullishConfidence += sig.confidence;
        console.log(`   ✅ MADynamicSR: +${(sig.confidence * 100).toFixed(1)}% bullish (${sig.events.length} events)`);
      } else if (sig.direction === 'sell') {
        bearishConfidence += sig.confidence;
        console.log(`   ✅ MADynamicSR: +${(sig.confidence * 100).toFixed(1)}% bearish (${sig.events.length} events)`);
      }
      if (sig.compression) {
        console.log(`   🔥 MADynamicSR: COMPRESSION — ${sig.compression.masInvolved} MAs within ${sig.compression.rangePct.toFixed(1)}%`);
      }
    }

    // Liquidity Sweep Signal
    if (marketData.liquiditySweepSignal && marketData.liquiditySweepSignal.hasSignal) {
      const sig = marketData.liquiditySweepSignal;
      if (sig.direction === 'buy') {
        bullishConfidence += sig.confidence * 0.5;  // Scale down — rare high-conviction signal
        console.log(`   🎯 LiquiditySweep: +${(sig.confidence * 50).toFixed(1)}% bullish (${sig.pattern})`);
      } else if (sig.direction === 'sell') {
        bearishConfidence += sig.confidence * 0.5;
        console.log(`   🎯 LiquiditySweep: +${(sig.confidence * 50).toFixed(1)}% bearish (${sig.pattern})`);
      }
    }

    // Multi-Timeframe Confluence
    if (marketData.mtfAdapter) {
      const confluence = marketData.mtfAdapter.getConfluenceScore();
      if (confluence.shouldTrade && confluence.confidence > 0.5) {
        const mtfBoost = confluence.confidence * 0.20;  // Max 20% boost from MTF
        if (confluence.direction === 'buy') {
          bullishConfidence += mtfBoost;
          console.log(`   ✅ MTF Confluence: +${(mtfBoost * 100).toFixed(1)}% bullish (${confluence.readyTimeframes.length} TFs aligned)`);
        } else if (confluence.direction === 'sell') {
          bearishConfidence += mtfBoost;
          console.log(`   ✅ MTF Confluence: +${(mtfBoost * 100).toFixed(1)}% bearish (${confluence.readyTimeframes.length} TFs aligned)`);
        }
      }
      // Set flag for existing multiTimeframeAligned check
      marketData.multiTimeframeAligned = confluence.trendAlignment > 0.7;
    }

    // VOLUME-BASED CONFIDENCE ADJUSTMENT (10-20%) - Change 477
    if (marketData.avgVolume && marketData.volume) {
      const volumeRatio = marketData.volume / marketData.avgVolume;

      // High volume confirms the trend
      if (volumeRatio > 1.5) {
        // Very high volume - strong confirmation
        const volumeBoost = Math.min(0.20, volumeRatio * 0.05);
        if (marketData.trend === 'up' || marketData.trend === 'uptrend') {
          bullishConfidence += volumeBoost;
          console.log(`📊 High volume bullish confirmation: +${(volumeBoost * 100).toFixed(1)}%`);
        } else if (marketData.trend === 'down' || marketData.trend === 'downtrend') {
          bearishConfidence += volumeBoost;
          console.log(`📊 High volume bearish confirmation: +${(volumeBoost * 100).toFixed(1)}%`);
        }
      } else if (volumeRatio > 1.2) {
        // Above average volume - moderate confirmation
        const volumeBoost = 0.10;
        if (marketData.trend === 'up' || marketData.trend === 'uptrend') {
          bullishConfidence += volumeBoost;
        } else if (marketData.trend === 'down' || marketData.trend === 'downtrend') {
          bearishConfidence += volumeBoost;
        }
      } else if (volumeRatio < 0.5) {
        // Low volume - reduce confidence
        confidence *= 0.85;
      }
    }

    // Volatility adjustment (less aggressive reduction)
    if (marketData.volatility) {
      if (marketData.volatility > 0.08) {
        confidence *= 0.85; // Very high volatility - less reduction
      } else if (marketData.volatility > 0.05) {
        confidence *= 0.90; // High volatility - ADJUSTED from 0.8
      } else if (marketData.volatility < 0.005) {
        confidence *= 0.95; // Too low volatility - ADJUSTED from 0.9
      }
      // Normal volatility (0.005-0.05) = no adjustment
    }

    // Momentum bonus (NEW - 5-10% for strong momentum)
    if (marketData.momentum) {
      if (Math.abs(marketData.momentum) > 2.0) {
        confidence += 0.10; // Strong momentum
      } else if (Math.abs(marketData.momentum) > 1.0) {
        confidence += 0.05; // Moderate momentum
      }
    }

    // DIRECTIONAL DECISION: Compare bullish vs bearish scores
    let finalConfidence = confidence; // CRITICAL FIX: Include base confidence, not starting from 0

    // 🧠 LEARNING SYSTEM: Apply confidence multiplier for hot patterns
    if (this.learningSystem) {
      const learningState = this.learningSystem.getLearningState();
      if (learningState.metrics.confidenceMultiplier > 1) {
        const oldConfidence = finalConfidence;
        finalConfidence *= learningState.metrics.confidenceMultiplier;
        console.log(`🔥 HOT PATTERNS: Boosting confidence from ${oldConfidence.toFixed(1)}% to ${finalConfidence.toFixed(1)}% (${learningState.metrics.confidenceMultiplier}x multiplier)`);
      }

      // Check for danger patterns
      if (learningState.metrics.dangerLevel > 3) {
        finalConfidence *= 0.5;
        console.log(`⚠️ DANGER PATTERNS: Reducing confidence by 50% due to danger level ${learningState.metrics.dangerLevel}`);
      }
    }

    let direction = 'neutral';

    // FIX 2026-02-10: Cap aggregate confidence to prevent runaway stacking
    bullishConfidence = Math.min(1.0, bullishConfidence);
    bearishConfidence = Math.min(1.0, bearishConfidence);

    // FIX 2026-02-10: REGIME FILTER - Block weak buys in downtrends
    if (marketData.marketRegime?.regime === 'trending_down' && bullishConfidence < 0.60) {
      console.log(`🚫 REGIME FILTER: Blocking weak buy in downtrend (bull: ${(bullishConfidence * 100).toFixed(1)}%)`);
      marketData.direction = 'neutral';
      marketData.bullishScore = bullishConfidence;
      marketData.bearishScore = bearishConfidence;
      return Math.max(0, Math.min(1.0, confidence));
    }

    console.log(`📊 CONFIDENCE CALCULATION SUMMARY:`);
    console.log(`   Base confidence: ${(confidence * 100).toFixed(1)}%`);
    console.log(`   Bullish signals: ${(bullishConfidence * 100).toFixed(1)}%`);
    console.log(`   Bearish signals: ${(bearishConfidence * 100).toFixed(1)}%`);

    // FIX 2026-02-10: Raised threshold from 0.15 to 0.40 to require stronger signals
    if (bullishConfidence > bearishConfidence && bullishConfidence > 0.40) {
      direction = 'buy';
      // CHANGE 622: Combine base + directional confidence instead of replacing
      finalConfidence = confidence + bullishConfidence;  // ADD don't REPLACE!
      console.log(`   ✅ Direction: BUY (base ${(confidence * 100).toFixed(1)}% + bullish ${(bullishConfidence * 100).toFixed(1)}% = ${(finalConfidence * 100).toFixed(1)}%)`);
    } else if (bearishConfidence > bullishConfidence && bearishConfidence > 0.40) {
      direction = 'sell';
      // CHANGE 622: Combine base + directional confidence instead of replacing
      finalConfidence = confidence + bearishConfidence;  // ADD don't REPLACE!
      console.log(`   ✅ Direction: SELL (base ${(confidence * 100).toFixed(1)}% + bearish ${(bearishConfidence * 100).toFixed(1)}% = ${(finalConfidence * 100).toFixed(1)}%)`);
    } else {
      console.log(`   ⚠️ Direction: NEUTRAL (neither exceeded 40% threshold, keeping base ${(confidence * 100).toFixed(1)}%)`);
    }

    // CRITICAL FIX: RSI Safety Override - prevent buying at tops and selling at bottoms
    if (marketData && marketData.indicators && marketData.indicators.rsi) {
      if (marketData.indicators.rsi > 80 && direction === 'buy') {
        console.log(`🚫 RSI SAFETY: Blocking BUY at RSI ${marketData.indicators.rsi.toFixed(1)} (>80) - preventing top buying!`);
        direction = 'hold';
        finalConfidence = 0;
      } else if (marketData.indicators.rsi < 20 && direction === 'sell') {
        console.log(`🚫 RSI SAFETY: Blocking SELL at RSI ${marketData.indicators.rsi.toFixed(1)} (<20) - preventing bottom selling!`);
        direction = 'hold';
        finalConfidence = 0;
      }
    }

    // --- ultra-minimal bars (toggle with DEBUG_AGG=1) ---
    if (process.env.DEBUG_AGG === '1') {
      const base = confidence;
      const gate = parseFloat(process.env.MIN_TRADE_CONFIDENCE) || 0.08;
      const bullish = bullishConfidence;
      const bearish = bearishConfidence;
      const bar = p => '█'.repeat(Math.max(0, Math.min(20, Math.round(p * 20)))).padEnd(20, ' ');
      const pct = x => (x * 100).toFixed(1) + '%';
      console.log(
        `\nAGG base=${pct(base)} gate=${pct(gate)} dir=${direction} conf=${pct(finalConfidence)} pass=${finalConfidence>=gate}\n` +
        `  Bull ${pct(bullish)} │${bar(bullish)}│\n` +
        `  Bear ${pct(bearish)} │${bar(bearish)}│`
      );
    }
    // --- end minimal bars ---

    // Apply volatility adjustment to final confidence
    if (marketData.volatility && finalConfidence > 0) {
      if (marketData.volatility > 0.08) {
        finalConfidence *= 0.85;
      } else if (marketData.volatility > 0.05) {
        finalConfidence *= 0.90;
      } else if (marketData.volatility < 0.005) {
        finalConfidence *= 0.95;
      }
    }

    // Cap final confidence at 1.0 (100%)
    finalConfidence = Math.max(0, Math.min(1.0, finalConfidence));

    // Store directional info in marketData
    marketData.bullishScore = bullishConfidence;
    marketData.bearishScore = bearishConfidence;
    marketData.direction = direction;

    // Log significant directional signals
    if (finalConfidence > 0.30 && direction !== 'neutral') {
      console.log(`🎯 DIRECTIONAL Signal: ${direction.toUpperCase()} @ ${(finalConfidence * 100).toFixed(1)}%`);
      console.log(`   📊 Bullish: ${(bullishConfidence * 100).toFixed(1)}% | Bearish: ${(bearishConfidence * 100).toFixed(1)}%`);
      console.log(`   📈 RSI: ${marketData.rsi?.toFixed(0)} | MACD: ${marketData.macd?.toFixed(2)}`);

      if (finalConfidence > 0.50) {
        console.log(`   ✅ HIGH CONFIDENCE BREAKDOWN:`);
        if (marketData.rsi && (marketData.rsi < 30 || marketData.rsi > 70)) {
          console.log(`      • RSI Signal: ${marketData.rsi < 30 ? 'OVERSOLD' : 'OVERBOUGHT'}`);
        }
        if (marketData.marketRegime?.regime?.includes('trending')) {
          console.log(`      • Market Regime: ${marketData.marketRegime.regime.toUpperCase()}`);
        }
        if (patterns?.length > 0) {
          console.log(`      • Patterns Detected: ${patterns.length}`);
        }
        if (marketData.nearSupport || marketData.nearResistance) {
          console.log(`      • Near Key Level: ${marketData.nearSupport ? 'SUPPORT' : 'RESISTANCE'}`);
        }
      }
    }

    return finalConfidence;
  }

  /**
   * TRADING DIRECTION DETERMINATION
   * Extracted from main bot for modular architecture
   *
   * METHODICAL VALIDATION:
   * ✅ Parameter validation with detailed error messages
   * ✅ Data structure integrity checks
   * ✅ Silent failure prevention with logging
   * ✅ Confidence threshold validation
   * ✅ Pattern data structure validation
   */
  determineTradingDirection(marketData, patterns, confidence) {
    // === PHASE 1: PARAMETER VALIDATION ===
    if (!marketData || typeof marketData !== 'object') {
      console.error('❌ determineTradingDirection: marketData is not a valid object');
      return 'hold';
    }

    if (!Array.isArray(patterns)) {
      console.warn('⚠️ determineTradingDirection: patterns is not an array, using empty array');
      patterns = [];
    }

    if (typeof confidence !== 'number' || isNaN(confidence)) {
      console.error('❌ determineTradingDirection: confidence is not a valid number');
      return 'hold';
    }

    // === PHASE 2: CONFIDENCE THRESHOLD CHECK WITH ENSEMBLE OVERRIDE ===
    const minConfidenceThreshold = this.config?.minConfidenceThreshold || 0.08;
    let ensembleOverride = false; // DISABLED - ensemble system removed per Change 538

    // ENSEMBLE SYSTEM DISABLED - Require real confidence for ALL trades
    // Removed per user request in Change 538 - was causing 0% confidence trades
    // const ensembleVotes = this.calculateEnsembleVotes(marketData, patterns, confidence);
    // if (ensembleVotes.greenLight) {
    //   ensembleOverride = true;
    //   console.log(`🎯 ENSEMBLE OVERRIDE: ${ensembleVotes.votes} conditions met, allowing trade despite ${(confidence * 100).toFixed(1)}% confidence`);
    // }

    if (confidence < minConfidenceThreshold && !ensembleOverride) {
      console.log(`📊 Direction determination skipped: confidence ${(confidence * 100).toFixed(1)}% below threshold ${(minConfidenceThreshold * 100).toFixed(1)}%`);
      return 'hold';
    }

    // === PHASE 3: DIRECTIONAL SCORES VALIDATION ===
    // Check if marketData has directional scores from confidence calculation
    if (marketData.direction) {
      // FIX 2026-02-07: REMOVED RANDOM ENTRY LOGIC
      // Previous code used Math.random() for "learning" - that's not learning, that's gambling
      // If direction is neutral, we HOLD. No signal = no trade. Period.
      if (marketData.direction === 'neutral') {
        console.log(`📊 NEUTRAL direction - NO TRADE (removed random/RSI>52 garbage)`);
        return 'hold';
      }

      // Handle directional signals (buy/sell)
      if (marketData.direction !== 'neutral') {
        // Validate directional scores exist and are numbers
        const bullishScore = typeof marketData.bullishScore === 'number' ? marketData.bullishScore : 0;
        const bearishScore = typeof marketData.bearishScore === 'number' ? marketData.bearishScore : 0;

        console.log(`📊 Using directional signal: ${marketData.direction} (Bull: ${(bullishScore * 100).toFixed(1)}%, Bear: ${(bearishScore * 100).toFixed(1)}%)`);

        // Validate direction is one of expected values
        if (['buy', 'sell', 'hold'].includes(marketData.direction)) {
          return marketData.direction;
        } else {
          console.warn(`⚠️ Invalid direction from marketData: ${marketData.direction}, defaulting to hold`);
          return 'hold';
        }
      }
    }

    // === PHASE 4: PATTERN-BASED DIRECTION ANALYSIS ===
    console.log(`🔍 Analyzing ${patterns.length} patterns for directional signals...`);

    // Validate pattern data structures
    const validPatterns = patterns.filter(pattern => {
      if (!pattern || typeof pattern !== 'object') {
        console.warn('⚠️ Invalid pattern object found, skipping');
        return false;
      }
      if (!pattern.direction || typeof pattern.direction !== 'string') {
        console.warn('⚠️ Pattern missing valid direction, skipping');
        return false;
      }
      if (typeof pattern.strength !== 'number' || isNaN(pattern.strength)) {
        console.warn('⚠️ Pattern missing valid strength, using default 0.5');
        pattern.strength = 0.5;
      }
      return true;
    });

    // Separate patterns by direction with validation
    const buyPatterns = validPatterns.filter(p => p.direction === 'buy');
    const sellPatterns = validPatterns.filter(p => p.direction === 'sell');

    console.log(`📊 Valid patterns: ${validPatterns.length}/${patterns.length} (Buy: ${buyPatterns.length}, Sell: ${sellPatterns.length})`);

    // Calculate strength with overflow protection
    const buyStrength = buyPatterns.reduce((sum, p) => {
      const strength = Math.max(0, Math.min(1, p.strength || 0.5)); // Clamp to 0-1
      return sum + strength;
    }, 0);

    const sellStrength = sellPatterns.reduce((sum, p) => {
      const strength = Math.max(0, Math.min(1, p.strength || 0.5)); // Clamp to 0-1
      return sum + strength;
    }, 0);

    console.log(`💪 Pattern strengths - Buy: ${buyStrength.toFixed(2)}, Sell: ${sellStrength.toFixed(2)}`);

    // === PHASE 5: DIRECTION DECISION WITH HYSTERESIS ===
    const strengthThreshold = 0.2; // Minimum advantage needed
    const buyAdvantage = buyStrength - sellStrength;
    const sellAdvantage = sellStrength - buyStrength;

    if (buyAdvantage > strengthThreshold) {
      console.log(`✅ BUY SIGNAL: Pattern advantage ${(buyAdvantage * 100).toFixed(1)}% (threshold: ${(strengthThreshold * 100).toFixed(1)}%)`);
      return 'buy';
    } else if (sellAdvantage > strengthThreshold) {
      console.log(`✅ SELL SIGNAL: Pattern advantage ${(sellAdvantage * 100).toFixed(1)}% (threshold: ${(strengthThreshold * 100).toFixed(1)}%)`);
      return 'sell';
    }

    // === PHASE 6: FALLBACK DECISION ===
    console.log(`⚠️ No clear directional signal (Buy adv: ${(buyAdvantage * 100).toFixed(1)}%, Sell adv: ${(sellAdvantage * 100).toFixed(1)}%, threshold: ${(strengthThreshold * 100).toFixed(1)}%)`);
    return 'hold';
  }

  /**
   * ENSEMBLE VOTING SYSTEM: Calculate if multiple conditions give green light for trading
   * Even with low confidence, certain combinations of conditions can allow trades
   */
  calculateEnsembleVotes(marketData, patterns, confidence) {
    let votes = 0;
    const conditions = [];

    // Condition 1: RSI Extreme + EMA Alignment (Strongest signal - 2 votes)
    if (marketData.rsi !== undefined && marketData.ema20 && marketData.ema50 && marketData.price) {
      const rsiExtreme = (marketData.rsi < 25 || marketData.rsi > 75);
      const emaAligned = (marketData.price > marketData.ema20 && marketData.ema20 > marketData.ema50) ||
                        (marketData.price < marketData.ema20 && marketData.ema20 < marketData.ema50);

      if (rsiExtreme && emaAligned) {
        votes += 2; // Double vote for strong combo
        conditions.push(`RSI${marketData.rsi < 25 ? 'Oversold' : 'Overbought'}+EMA-Aligned`);
      }
    }

    // Condition 2: Multiple S/R Levels Nearby (1 vote)
    if (marketData.srLevels && marketData.srLevels.length >= 2) {
      votes += 1;
      conditions.push(`${marketData.srLevels.length}SR-Levels`);
    }

    // Condition 3: Strong Volume Confirmation (1 vote)
    if (marketData.volume && marketData.avgVolume) {
      const volumeRatio = marketData.volume / marketData.avgVolume;
      if (volumeRatio > 2.0) {
        votes += 1;
        conditions.push(`HighVolume-${volumeRatio.toFixed(1)}x`);
      }
    }

    // Condition 4: Fibonacci Level Proximity (1 vote)
    if (marketData.fibLevels && marketData.fibLevels.length > 0) {
      votes += 1;
      conditions.push('Fib-Levels');
    }

    // Condition 5: Pattern Recognition (0.5 votes)
    if (patterns && patterns.length > 0) {
      votes += 0.5; // Half vote for patterns
      conditions.push(`${patterns.length}Patterns`);
    }

    // Condition 6: Low Volatility Environment (0.5 votes)
    if (marketData.volatility && marketData.volatility < 0.03) { // Relaxed from 0.02
      votes += 0.5;
      conditions.push('LowVolatility');
    }

    // Condition 7: MACD Momentum (1 vote) - Relaxed for fresh bot
    if (marketData.macd && marketData.macdSignal) {
      const macdMomentum = Math.abs(marketData.macd - marketData.macdSignal);
      if (macdMomentum > 5) { // Relaxed from 10 for fresh bot
        votes += 1;
        conditions.push(`MACD-Momentum-${macdMomentum.toFixed(1)}`);
      }
    }

    // Condition 8: Extreme RSI Only (1 vote) - Only for truly extreme conditions
    if (marketData.rsi !== undefined) {
      if (marketData.rsi < 25 || marketData.rsi > 75) { // Only extreme overbought/oversold
        votes += 1;
        conditions.push(`RSI-Extreme-${marketData.rsi.toFixed(1)}`);
      }
    }

    // Condition 9: Strong Price vs EMA Divergence (1 vote) - Significant misalignment
    if (marketData.price && marketData.ema20) {
      const priceVsEma = (marketData.price - marketData.ema20) / marketData.ema20;
      if (Math.abs(priceVsEma) > 0.02) { // 2% significant deviation
        votes += 1;
        conditions.push(`Price-EMA-Divergence-${(priceVsEma * 100).toFixed(2)}%`);
      }
    }

    // Condition 10: Volume Spike + Price Action (2 votes) - Strong confirmation
    if (marketData.volume && marketData.avgVolume && marketData.price && marketData.ema20) {
      const volumeRatio = marketData.volume / marketData.avgVolume;
      const priceVsEma = (marketData.price - marketData.ema20) / marketData.ema20;

      if (volumeRatio > 3.0 && Math.abs(priceVsEma) > 0.015) { // 3x volume + 1.5% deviation
        votes += 2;
        conditions.push(`VolumeSpike-${volumeRatio.toFixed(1)}x+PriceAction`);
      }
    }

    // GREEN LIGHT: Strict requirements - need genuine confluence of signals
    // 3+ votes = definite green light, 2+ votes with decent confidence = green light
    const greenLight = votes >= 3.0 || (votes >= 2.0 && confidence >= 0.25);

    console.log(`🎯 ENSEMBLE VOTES: ${votes.toFixed(1)}/3.0 needed (${conditions.length} conditions: ${conditions.join(', ')})`);

    return {
      greenLight,
      votes: votes.toFixed(1),
      conditions,
      reasoning: greenLight ?
        `✅ ENSEMBLE GREEN LIGHT: ${conditions.join(', ')}` :
        `❌ Insufficient votes: ${votes.toFixed(1)} (need 3.0+ or 2.0+ with 25%+ confidence)`
    };
  }

  /**
   * POSITION MANAGEMENT METHODS
   * Extracted from main bot for modular architecture
   */
  canOpenNewPosition(currentPositionCount, tierFlags) {
    const maxPositions = tierFlags?.maxPositions ||
      (tierFlags?.elite ? 10 : tierFlags?.premium ? 5 : tierFlags?.pro ? 3 : 1);

    return currentPositionCount < maxPositions;
  }

  /**
   * UNIFIED DECISION ENGINE
   * Provides complete trading decision with all factors integrated
   *
   * METHODICAL VALIDATION:
   * ✅ Input parameter validation with detailed logging
   * ✅ Data structure integrity checks
   * ✅ Error handling with graceful degradation
   * ✅ Confidence and direction correlation validation
   * ✅ Position size calculation with risk limits
   */
  getDecision(marketData, patterns, priceData) {
    // === PHASE 1: INPUT VALIDATION ===
  if (!marketData || typeof marketData !== 'object') {
      console.error('❌ getDecision: Invalid marketData object');
      return { direction: 'hold', confidence: 0, size: 0, reasoning: 'Invalid market data' };
  }

    if (!Array.isArray(patterns)) {
      console.warn('⚠️ getDecision: patterns is not an array, using empty array');
      patterns = [];
  }

    if (!Array.isArray(priceData)) {
      console.warn('⚠️ getDecision: priceData is not an array, using empty array');
      priceData = [];
  }

    // Update price data reference for indicator calculations
    // Always use the most current data passed from the bot
    this.priceData = Array.isArray(priceData) ? priceData : this.priceData || [];

  // === PHASE 2: CONFIDENCE CALCULATION ===
    let confidence;
    try {
      confidence = this.calculateRealConfidence(marketData, patterns);
      if (typeof confidence !== 'number' || isNaN(confidence)) {
        console.error('❌ getDecision: calculateRealConfidence returned invalid value');
        confidence = 0;
      }
    } catch (error) {
      console.error('❌ getDecision: Error in confidence calculation:', error.message);
      confidence = 0;
    }

  // === PHASE 2.5: PATTERN-BASED ENTRY GATING (EMPIRE PATTERN DOMINANCE) ===
  // Pattern-driven entry system - patterns decide IF, indicators decide HOW MUCH
  let patternGateApproved = true;
  let patternTier = 'unknown';
  let patternSizeOverride = 1.0;
  let gatingReason = '';

  // Check if pattern dominance mode is enabled (feature flag)
  const PATTERN_DOMINANCE_ENABLED = process.env.PATTERN_DOMINANCE === 'true' || this.config.patternDominance;

  if (PATTERN_DOMINANCE_ENABLED && patterns && patterns.length > 0) {
    // Get the strongest pattern by confidence
    const primaryPattern = patterns.reduce((best, current) =>
      (current.confidence > best.confidence) ? current : best
    );

    // Get historical performance for this pattern
    const patternWinRate = this.getPatternWinRate(primaryPattern.type || primaryPattern.name) / 100; // Convert to 0-1
    const patternSamples = this.getPatternSampleSize(primaryPattern.type || primaryPattern.name);

    // Determine pattern tier
    if (patternWinRate >= 0.75 && patternSamples >= 20) {
      patternTier = 'ELITE';
      patternSizeOverride = 1.5; // Aggressive sizing for elite patterns
      confidence += 0.3; // Elite boost
      gatingReason = `ELITE PATTERN (${(patternWinRate*100).toFixed(0)}% win, ${patternSamples} samples)`;
    } else if (patternWinRate >= 0.65 && patternSamples >= 10) {
      patternTier = 'PROVEN';
      patternSizeOverride = 1.0; // Standard sizing
      confidence += 0.15; // Proven boost
      gatingReason = `PROVEN PATTERN (${(patternWinRate*100).toFixed(0)}% win, ${patternSamples} samples)`;
    } else if (patternWinRate < 0.5 && patternSamples >= 5) {
      patternTier = 'WEAK';
      patternSizeOverride = 0.5; // Reduce size for weak patterns
      confidence -= 0.2; // Penalty for weak patterns
      gatingReason = `WEAK PATTERN - CAUTION (${(patternWinRate*100).toFixed(0)}% win)`;
    } else {
      patternTier = 'LEARNING';
      // Learning mode - need confluence or skip
      const confluenceCount = this.countConfluenceSignals(marketData, patterns);
      if (confluenceCount < 2) {
        patternGateApproved = false;
        gatingReason = 'LEARNING PATTERN - NEED CONFLUENCE';
      } else {
        patternSizeOverride = 0.3; // Tiny probe for learning
        gatingReason = `LEARNING WITH CONFLUENCE (${confluenceCount} signals)`;
      }
    }

    // Final pattern gate - no entry on weak confidence even with patterns
    if (confidence < 0.65 && patternTier !== 'ELITE') {
      patternGateApproved = false;
      gatingReason = 'PATTERN CONFIDENCE TOO LOW';
    }

    console.log(`🎯 Pattern Gate: ${patternTier} - ${gatingReason}`);
    console.log(`   📊 Win Rate: ${(patternWinRate*100).toFixed(1)}%, Samples: ${patternSamples}`);
    console.log(`   🎚️ Size Override: ${patternSizeOverride}x`);
    console.log(`   ✅ Gate: ${patternGateApproved ? 'APPROVED' : 'BLOCKED'}`);
  }

  // If pattern gate blocks, return hold
  if (PATTERN_DOMINANCE_ENABLED && !patternGateApproved) {
    return {
      direction: 'hold',
      confidence: confidence,
      size: 0.1,
      reasoning: gatingReason,
      patternTier,
      blocked: 'PATTERN_GATE'
    };
  }

  // === PHASE 3: DIRECTION DETERMINATION ===
  let direction;
  try {
    direction = this.determineTradingDirection(marketData, patterns, confidence);
      if (!['buy', 'sell', 'hold'].includes(direction)) {
        console.warn(`⚠️ getDecision: Invalid direction "${direction}", defaulting to hold`);
        direction = 'hold';
      }
    } catch (error) {
      console.error('❌ getDecision: Error in direction determination:', error.message);
      direction = 'hold';
    }

    // === PHASE 4: POSITION SIZE CALCULATION ===
    let size;
    try {
      const price = typeof marketData.price === 'number' ? marketData.price : 0;
      size = this.calculatePositionSize(price, confidence, marketData);

      // Apply pattern size override if pattern dominance is enabled
      if (PATTERN_DOMINANCE_ENABLED && patternSizeOverride !== 1.0) {
        const originalSize = size;
        size = size * patternSizeOverride;
        console.log(`   📊 Pattern Size Override: ${originalSize.toFixed(4)} → ${size.toFixed(4)} (${patternSizeOverride}x)`);
      }

      // Validate size is reasonable
      if (typeof size !== 'number' || isNaN(size) || size < 0 || size > 1) {
        console.warn(`⚠️ getDecision: Invalid position size ${size}, defaulting to 0.01`);
        size = 0.01; // 1% minimum
      }
    } catch (error) {
      console.error('❌ getDecision: Error in position size calculation:', error.message);
      size = 0.01; // Safe minimum
    }

    // === PHASE 5: DECISION VALIDATION ===
    // Ensure confidence and direction are correlated
    if (direction !== 'hold' && confidence < 0.15) {
      console.warn(`⚠️ getDecision: Direction "${direction}" but confidence ${(confidence * 100).toFixed(1)}% < 15% threshold, forcing hold`);
      direction = 'hold';
    }

    // === PHASE 6: REASONING GENERATION ===
    let reasoning = `Confidence: ${(confidence * 100).toFixed(1)}%, Direction: ${direction}, Size: ${(size * 100).toFixed(2)}%, Patterns: ${patterns.length}`;

    // Add pattern tier to reasoning if pattern dominance is enabled
    if (PATTERN_DOMINANCE_ENABLED) {
      reasoning += `, Pattern Tier: ${patternTier}`;
    }

    console.log(`🎯 DECISION: ${direction.toUpperCase()} @ ${(confidence * 100).toFixed(1)}% confidence, ${(size * 100).toFixed(2)}% position`);
    if (PATTERN_DOMINANCE_ENABLED) {
      console.log(`   🎯 Pattern Tier: ${patternTier}`);
    }

    return {
      direction,
      confidence,
      size,
      reasoning,
      patternTier: PATTERN_DOMINANCE_ENABLED ? patternTier : undefined,
      patternGated: PATTERN_DOMINANCE_ENABLED ? !patternGateApproved : undefined
    };
  }
}

// Export the enhanced trading brain
module.exports = { OptimizedTradingBrain };
