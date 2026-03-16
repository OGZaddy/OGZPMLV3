/**
 * @fileoverview MaxProfitManager - Advanced Profit Optimization & Exit Strategy Engine
 *
 * ============================================================================
 * THE PROFIT MAXIMIZER OF OGZ PRIME - TURNING WINS INTO MAXIMUM GAINS
 * ============================================================================
 *
 * @module core/MaxProfitManager
 *
 * @example
 * const MaxProfitManager = require('./core/MaxProfitManager');
 * const profitManager = new MaxProfitManager({
 *   enableBreakevenStop: true,
 *   tieredExits: [0.5, 0.75, 1.0]  // Take profit at 0.5%, 0.75%, 1%
 * });
 *
 * // Start tracking a position
 * profitManager.startTracking(entryPrice, positionSize);
 *
 * // Update on each candle - returns exit signal if triggered
 * const exitSignal = profitManager.update(currentPrice, { volatility, trend });
 * if (exitSignal.shouldExit) {
 *   console.log(`Exit at ${exitSignal.exitPrice} - Reason: ${exitSignal.reason}`);
 * }
 * 
 * This is where good trades become GREAT trades. While the AI finds opportunities
 * and the TradingBrain executes them, the MaxProfitManager ensures you extract
 * maximum profit from every winning position through sophisticated exit strategies.
 * 
 * CRITICAL FOR SCALING:
 * New developers must understand this system separates amateur trading from
 * professional profit extraction. It's the difference between small wins and
 * life-changing gains that fund your Houston mission.
 * 
 * BUSINESS IMPACT:
 * - Implements tiered profit-taking to maximize gains from winning trades
 * - Uses dynamic trailing stops that adapt to market volatility
 * - Applies time-based exit optimizations for different market sessions
 * - Protects profits with breakeven stops and risk-adjusted trailing
 * - Provides detailed profit analytics for strategy optimization
 * 
 * HOUSTON MISSION CRITICAL:
 * Every dollar of additional profit gets you closer to financial freedom.
 * This system is designed to maximize the return from every successful trade,
 * compounding your growth toward the Houston goal.
 * 
 * AUTHOR: OGZ Prime Team - Built for Maximum Profit Extraction
 * DATE: Advanced Profit Management Implementation
 * 
 * ============================================================================
 * PROFIT OPTIMIZATION PHILOSOPHY:
 * ============================================================================
 * 
 * 1. TIERED EXITS: Take profits in stages to balance risk and reward
 * 2. DYNAMIC TRAILING: Adapt stop distances based on volatility and time
 * 3. VOLATILITY SCALING: Wider stops in volatile markets, tighter in calm ones
 * 4. TIME OPTIMIZATION: Adjust strategies based on trade duration
 * 5. BREAKEVEN PROTECTION: Lock in profits once position becomes profitable
 * 6. MARKET ADAPTATION: Different strategies for different market conditions
 * 
 * ============================================================================
 */

const TradingConfig = require('./TradingConfig');  // CHANGE 2026-02-28: Centralized config

/**
 * MaxProfitManager Class - Advanced Profit Optimization Engine
 * 
 * CRITICAL PROFIT COMPONENT: This class implements sophisticated profit-taking
 * strategies that can significantly increase overall trading profitability by
 * optimizing exit timing and partial position management.
 * 
 * SCALING BENEFIT: New team members can adjust profit-taking parameters
 * without understanding the complex calculations behind dynamic trailing
 * stops and tiered exit strategies.
 * 
 * CORE RESPONSIBILITIES:
 * 1. Tiered profit-taking at multiple price levels
 * 2. Dynamic trailing stops that adapt to market conditions
 * 3. Time-based exit optimizations
 * 4. Volatility-adjusted stop management
 * 5. Breakeven stop activation and management
 * 6. Profit analytics and performance tracking
 */
class MaxProfitManager {
  
  /**
   * Constructor - Initialize the Profit Optimization System
   * 
   * Sets up the comprehensive profit management framework with default settings
   * optimized for maximum profit extraction while maintaining risk control.
   * 
   * @param {Object} config - Profit management configuration
   */
  constructor(config = {}) {
    // ======================================================================
    // CORE PROFIT OPTIMIZATION CONFIGURATION
    // ======================================================================
    this.config = {
      // --------------------------------------------------------------------
      // TIERED EXIT STRATEGY
      // --------------------------------------------------------------------
      enableTieredExit: true,         // Enable multi-tier profit taking
      // FIX 2026-03-16: All tiers must clear 0.65% round-trip fees
      // OLD: 0.5-2.5% targets (tier1 was BELOW fees = guaranteed loss)
      // NEW: 1.5-5.0% targets (all tiers profitable after fees)
      firstTierTarget: 0.015,          // 1.5% profit - clears fees with margin
      firstTierExit: 0.30,            // Exit 30% to lock in profit
      secondTierTarget: 0.020,         // 2.0% profit - solid gain
      secondTierExit: 0.30,           // Exit another 30%
      thirdTierTarget: 0.030,          // 3.0% profit - great move
      thirdTierExit: 0.20,            // Exit 20%
      finalTarget: 0.050,              // 5.0% - let final 20% ride for big moves
      
      // --------------------------------------------------------------------
      // TRAILING STOP MANAGEMENT
      // --------------------------------------------------------------------
      enableTrailingStop: true,       // Enable dynamic trailing stops
      initialStopLossPercent: TradingConfig.get('exits.stopLossPercent', 1.5) / 100,  // CHANGE 629→2026-02-28: From TradingConfig (percent→decimal)
      // CHANGE 653: Realistic trailing stop thresholds for scalping
      minProfit: 0.003,                // 0.3% minimum profit before trailing starts
      trailDistance: 0.002,            // 0.2% trail distance (tight for scalping)
      tightTrailThreshold: 0.01,       // Tighten trail after 1% profit
      tightTrailDistance: 0.001,       // 0.1% tight trail (very tight)
      breakevenThreshold: 0.002,       // Move to breakeven at 0.2% profit
      
      // --------------------------------------------------------------------
      // TIME-BASED OPTIMIZATIONS
      // --------------------------------------------------------------------
      enableTimeBasedAdjustments: false,    // CHANGE 630: Disabled - for scalpers, not swing traders
      maxHoldTimeMinutes: 180,              // 3 hours maximum hold time

      // Minimum hold time - can be 0 for aggressive scalping
      // Read from TradingConfig to allow flexibility in backtest/scalping modes
      minHoldTimeMinutes: TradingConfig.get('holdTimes.minHoldTimeMinutes', 0),

      timeAdjustmentIntervals: [
        { minutes: 30, trailFactor: 1.0 },  // Normal trail for first 30 min
        { minutes: 60, trailFactor: 0.8 },  // 20% tighter after 1 hour
        { minutes: 120, trailFactor: 0.6 }, // 40% tighter after 2 hours
        { minutes: 180, trailFactor: 0.4 }  // 60% tighter after 3 hours
      ],
      
      // --------------------------------------------------------------------
      // VOLATILITY ADAPTATIONS
      // --------------------------------------------------------------------
      enableVolatilityAdjustment: false,    // CHANGE 629: Disabled - was making stops too tight
      lowVolatilityThreshold: 0.005,        // 0.5% low volatility threshold
      highVolatilityThreshold: 0.02,        // 2% high volatility threshold
      volatilityLookbackPeriods: 20,        // Periods for volatility calculation
      
      // --------------------------------------------------------------------
      // MARKET CONDITION ADAPTATIONS
      // --------------------------------------------------------------------
      enableMarketAdaptation: true,         // Adapt to market conditions
      trendingMarketMultiplier: 1.3,        // 30% larger targets in trending markets
      rangeboundMarketMultiplier: 0.8,      // 20% smaller targets in range-bound
      
      // --------------------------------------------------------------------
      // PERFORMANCE TRACKING
      // --------------------------------------------------------------------
      trackPerformance: true,               // Enable performance analytics
      logLevel: 'info',                     // Logging level ('debug', 'info', 'warning', 'error')
      
      // Override with user configuration
      ...config
    };
    
    // ======================================================================
    // POSITION STATE MANAGEMENT
    // ======================================================================
    this.state = {
      // POSITION BASICS
      active: false,              // Whether actively managing a position
      entryPrice: 0,              // Position entry price
      direction: null,            // Position direction ('buy' or 'sell')
      originalSize: 0,            // Original position size
      remainingSize: 0,           // Remaining position size after partial exits
      
      // PRICE TRACKING
      currentPrice: 0,            // Latest price update
      highestPrice: 0,            // Highest price reached (for longs)
      lowestPrice: Infinity,      // Lowest price reached (for shorts)
      
      // STOP MANAGEMENT
      currentStop: null,          // Current stop loss price
      initialStop: null,          // Original stop loss price
      trailingActive: false,      // Whether trailing stop is active
      breakevenActive: false,     // Whether breakeven stop is active
      
      // PROFIT TIERS
      tiers: [],                  // Array of profit tier definitions
      completedTiers: [],         // Array of completed tier exits
      
      // TIMING
      entryTime: 0,               // Position entry timestamp
      lastUpdateTime: 0,          // Last price update timestamp
      
      // PERFORMANCE METRICS
      unrealizedPnL: 0,           // Current unrealized profit/loss
      realizedPnL: 0,             // Realized profit from partial exits
      maxUnrealizedPnL: 0,        // Peak unrealized profit reached
      totalFeesEstimated: 0       // Estimated trading fees
    };
    
    // ======================================================================
    // PERFORMANCE ANALYTICS
    // ======================================================================
    this.analytics = {
      totalPositionsManaged: 0,
      totalProfitExtracted: 0,
      averageHoldTime: 0,
      tiersCompletedDistribution: {},
      trailingStopTriggered: 0,
      breakevenStopsTriggered: 0,
      averageProfitPerPosition: 0,
      bestPositionProfit: 0,
      worstPositionLoss: 0,
      volatilityAdjustments: 0,
      timeBasedExits: 0
    };
    
    console.log('💰 MaxProfitManager initialized with advanced profit optimization');
    this.log('Configuration loaded with tiered exits and dynamic trailing', 'info');
  }
  
  /**
   * Start Position Management - Initialize Profit Optimization
   * 
   * CRITICAL STARTUP: Begins profit management for a new position with
   * all optimization strategies activated based on market conditions.
   * 
   * @param {number} entryPrice - Position entry price
   * @param {string} direction - Position direction ('buy' or 'sell')
   * @param {number} size - Position size
   * @param {Object} options - Additional options
   * @param {number} options.volatility - Current market volatility
   * @param {string} options.marketCondition - Market condition ('trending', 'ranging', etc.)
   * @param {number} options.confidence - Trade confidence score
   * 
   * @returns {Object} - Initialization result with stop prices and targets
   */
  start(entryPrice, direction, size = 1.0, options = {}) {
    // ====================================================================
    // FIX 2026-02-24: Type validation (Phase 12 fuzzing - prevent NaN/crash)
    // ====================================================================
    if (typeof entryPrice !== 'number' || isNaN(entryPrice) || !isFinite(entryPrice) || entryPrice <= 0) {
      this.log('Invalid entry price provided (must be positive number)', 'error');
      return { success: false, error: 'Invalid entry price' };
    }
    if (typeof direction !== 'string') {
      this.log('Invalid direction provided (must be string)', 'error');
      return { success: false, error: 'Invalid direction' };
    }
    if (typeof size !== 'number' || isNaN(size) || size <= 0) {
      size = 1.0; // Default to 1.0 if invalid
    }

    // ====================================================================
    // CHANGE 614: Fix case-sensitivity bug - normalize direction
    // ====================================================================
    direction = direction.toLowerCase();

    // ====================================================================
    // INPUT VALIDATION
    // ====================================================================
    if (!['buy', 'sell'].includes(direction)) {
      this.log('Invalid direction provided', 'error');
      return { success: false, error: 'Invalid direction' };
    }

    // ====================================================================
    // STATE INITIALIZATION
    // ====================================================================
    this.state = {
      active: true,
      entryPrice: entryPrice,
      direction: direction,
      originalSize: size,
      remainingSize: size,
      currentPrice: entryPrice,
      highestPrice: direction === 'buy' ? entryPrice : 0,
      lowestPrice: direction === 'sell' ? entryPrice : Infinity,
      currentStop: null,
      initialStop: null,
      trailingActive: false,
      breakevenActive: false,
      tiers: [],
      completedTiers: [],
      entryTime: Date.now(),
      lastUpdateTime: Date.now(),
      unrealizedPnL: 0,
      realizedPnL: 0,
      maxUnrealizedPnL: 0,
      totalFeesEstimated: 0
    };
    
    // ====================================================================
    // MARKET CONDITION ANALYSIS
    // ====================================================================
    const marketCondition = options.marketCondition || 'normal';
    const volatility = options.volatility || 0.02; // Default 2% volatility
    const confidence = options.confidence || 0.5;  // Default neutral confidence
    
    // Calculate volatility adjustment factors
    const volatilityAdjustment = this.calculateVolatilityAdjustment(volatility);
    
    // ====================================================================
    // INITIAL STOP LOSS SETUP
    // ====================================================================
    const stopDistance = this.config.initialStopLossPercent * volatilityAdjustment.stopFactor;
    
    if (direction === 'buy') {
      this.state.currentStop = entryPrice * (1 - stopDistance);
      this.state.initialStop = this.state.currentStop;
    } else {
      this.state.currentStop = entryPrice * (1 + stopDistance);
      this.state.initialStop = this.state.currentStop;
    }
    
    // ====================================================================
    // PROFIT TIER SETUP
    // ====================================================================
    if (this.config.enableTieredExit) {
      this.setupProfitTiers(volatilityAdjustment, marketCondition, confidence);
    }
    
    // ====================================================================
    // ANALYTICS UPDATE
    // ====================================================================
    this.analytics.totalPositionsManaged++;
    if (volatilityAdjustment.adjusted) {
      this.analytics.volatilityAdjustments++;
    }
    
    // ====================================================================
    // LOGGING AND REPORTING
    // ====================================================================
    this.log(`Position management started: ${direction.toUpperCase()} at ${entryPrice}`, 'info');
    this.log(`Initial stop: ${this.state.currentStop.toFixed(2)} (${(stopDistance * 100).toFixed(2)}%)`, 'info');
    this.log(`Profit tiers: ${this.state.tiers.length} configured`, 'info');
    
    return {
      success: true,
      entryPrice: entryPrice,
      direction: direction,
      initialStop: this.state.currentStop,
      profitTiers: this.state.tiers.map(tier => ({
        target: tier.targetPrice,
        percentage: tier.exitPercentage * 100
      })),
      volatilityAdjustment: volatilityAdjustment
    };
  }
  
  /**
   * Update Position - Process New Price Information
   * 
   * CORE OPTIMIZATION ENGINE: Processes each price update to determine
   * if any profit-taking actions should be executed, trailing stops
   * should be adjusted, or position management should be modified.
   * 
   * @param {number} currentPrice - Current market price
   * @param {Object} options - Additional market data
   * @param {number} options.volatility - Current volatility
   * @param {number} options.volume - Current volume
   * 
   * @returns {Object} - Update result with any actions to take
   */
  update(currentPrice, options = {}) {
    // ====================================================================
    // VALIDATION AND SETUP
    // ====================================================================
    // FIX 2026-02-24: Type validation (Phase 12 fuzzing - prevent NaN)
    if (typeof currentPrice !== 'number' || isNaN(currentPrice) || !isFinite(currentPrice)) {
      return { action: 'none', reason: 'Invalid price type' };
    }
    if (!this.state.active || currentPrice <= 0) {
      return { action: 'none', reason: 'Invalid state or price' };
    }
    
    // Update state with new price information
    this.state.currentPrice = currentPrice;
    this.state.lastUpdateTime = Date.now();

    // ====================================================================
    // MINIMUM HOLD TIME GUARD
    // Prevents instant same-candle exits after entry
    // ====================================================================
    const holdTimeMinutes = (Date.now() - this.state.entryTime) / (1000 * 60);
    if (this.config.minHoldTimeMinutes && holdTimeMinutes < this.config.minHoldTimeMinutes) {
      return {
        action: 'hold',
        reason: `min_hold_not_reached_${holdTimeMinutes.toFixed(3)}m`,
        profitPercent: this.calculateProfitPercent(currentPrice),
        unrealizedPnL: this.state.unrealizedPnL,
        holdTimeMinutes
      };
    }
    
    // Track price extremes for trailing stop calculations
    if (this.state.direction === 'buy') {
      if (currentPrice > this.state.highestPrice) {
        this.state.highestPrice = currentPrice;
      }
    } else {
      if (currentPrice < this.state.lowestPrice) {
        this.state.lowestPrice = currentPrice;
      }
    }
    
    // ====================================================================
    // PROFIT/LOSS CALCULATION
    // ====================================================================
    const profitPercent = this.calculateProfitPercent(currentPrice);
    this.state.unrealizedPnL = profitPercent * this.state.originalSize * this.state.entryPrice;
    
    // Track maximum profit reached
    if (this.state.unrealizedPnL > this.state.maxUnrealizedPnL) {
      this.state.maxUnrealizedPnL = this.state.unrealizedPnL;
    }
    
    // ====================================================================
    // STOP LOSS CHECK (HIGHEST PRIORITY)
    // ====================================================================
    if (this.shouldExitPosition(currentPrice, profitPercent)) {
      const reason = this.state.trailingActive ? 'trailing_stop' : 'stop_loss';
      this.log(`Position exit triggered: ${reason} at ${currentPrice}`, 'info');
      
      // Update analytics
      if (reason === 'trailing_stop') {
        this.analytics.trailingStopTriggered++;
      }
      
      return {
        action: 'exit_full',
        price: currentPrice,
        reason: reason,
        profitPercent: profitPercent,
        unrealizedPnL: this.state.unrealizedPnL,
        holdTime: Date.now() - this.state.entryTime
      };
    }
    
    // ====================================================================
    // PROFIT TIER CHECK
    // ====================================================================
    const tierExit = this.checkProfitTiers(currentPrice, profitPercent);
    if (tierExit.shouldExit) {
      this.log(`Profit tier ${tierExit.tier} triggered at ${currentPrice} (${(profitPercent * 100).toFixed(2)}%)`, 'info');
      
      // Execute partial exit
      this.executePartialExit(tierExit);
      
      return {
        action: 'exit_partial',
        price: currentPrice,
        exitSize: tierExit.exitSize,
        remainingSize: this.state.remainingSize,
        reason: `profit_tier_${tierExit.tier}`,
        profitPercent: profitPercent,
        tier: tierExit.tier
      };
    }
    
    // ====================================================================
    // TRAILING STOP MANAGEMENT
    // ====================================================================
    const trailingUpdate = this.updateTrailingStop(currentPrice, profitPercent, options.volatility);
    if (trailingUpdate.updated) {
      this.log(`Trailing stop updated to ${this.state.currentStop.toFixed(2)}`, 'debug');
    }
    
    // ====================================================================
    // BREAKEVEN STOP ACTIVATION
    // ====================================================================
    this.updateBreakevenStop(profitPercent);
    
    // ====================================================================
    // TIME-BASED ADJUSTMENTS
    // ====================================================================
    const timeAdjustment = this.applyTimeBasedAdjustments();
    if (timeAdjustment.exitRecommended) {
      this.log(`Time-based exit recommended after ${timeAdjustment.holdTimeMinutes} minutes`, 'info');
      this.analytics.timeBasedExits++;
      
      return {
        action: 'exit_full',
        price: currentPrice,
        reason: 'time_based_exit',
        profitPercent: profitPercent,
        holdTime: Date.now() - this.state.entryTime
      };
    }
    
    // ====================================================================
    // STANDARD UPDATE RESPONSE
    // ====================================================================
    return {
      action: 'update',
      state: this.getPositionState(),
      profitPercent: profitPercent,
      unrealizedPnL: this.state.unrealizedPnL,
      trailingStop: this.state.currentStop,
      nextTier: this.getNextProfitTier()
    };
  }
  
  /**
   * Calculate Profit Percentage - Profit Calculation
   * 
   * @param {number} currentPrice - Current market price
   * @returns {number} - Profit percentage (positive for profit, negative for loss)
   */
  calculateProfitPercent(currentPrice) {
    if (this.state.direction === 'buy') {
      return (currentPrice - this.state.entryPrice) / this.state.entryPrice;
    } else {
      return (this.state.entryPrice - currentPrice) / this.state.entryPrice;
    }
  }
  
  /**
   * Setup Profit Tiers - Initialize Profit Taking Levels
   * 
   * TIER STRATEGY: Creates multiple profit-taking levels that allow
   * the position to capture profits at different stages while leaving
   * room for larger moves.
   * 
   * @param {Object} volatilityAdjustment - Volatility-based adjustments
   * @param {string} marketCondition - Market condition
   * @param {number} confidence - Trade confidence score
   */
  setupProfitTiers(volatilityAdjustment, marketCondition = 'normal', confidence = 0.5) {
    this.state.tiers = [];
    
    // Base tier configuration
    const baseTiers = [
      { target: this.config.firstTierTarget, exit: this.config.firstTierExit },
      { target: this.config.secondTierTarget, exit: this.config.secondTierExit },
      { target: this.config.thirdTierTarget, exit: this.config.thirdTierExit },
      { target: this.config.finalTarget, exit: 1.0 - (this.config.firstTierExit + this.config.secondTierExit + this.config.thirdTierExit) }
    ];
    
    // Adjust targets based on market conditions
    let marketMultiplier = 1.0;
    if (marketCondition === 'trending' && this.config.enableMarketAdaptation) {
      marketMultiplier = this.config.trendingMarketMultiplier;
    } else if (marketCondition === 'ranging' && this.config.enableMarketAdaptation) {
      marketMultiplier = this.config.rangeboundMarketMultiplier;
    }
    
    // Adjust targets based on confidence
    let confidenceMultiplier = 1.0;
    if (confidence > 0.8) {
      confidenceMultiplier = 1.2; // 20% higher targets for high confidence
    } else if (confidence < 0.6) {
      confidenceMultiplier = 0.8; // 20% lower targets for low confidence
    }
    
    // Create tier definitions
    baseTiers.forEach((tier, index) => {
      const adjustedTarget = tier.target * volatilityAdjustment.targetFactor * marketMultiplier * confidenceMultiplier;
      
      let targetPrice;
      if (this.state.direction === 'buy') {
        targetPrice = this.state.entryPrice * (1 + adjustedTarget);
      } else {
        targetPrice = this.state.entryPrice * (1 - adjustedTarget);
      }
      
      this.state.tiers.push({
        tier: index + 1,
        targetPercent: adjustedTarget,
        targetPrice: targetPrice,
        exitPercentage: tier.exit,
        exitSize: this.state.originalSize * tier.exit,
        completed: false
      });
    });
    
    this.log(`Setup ${this.state.tiers.length} profit tiers with market multiplier ${marketMultiplier.toFixed(2)}`, 'debug');
  }
  
  /**
   * Check Profit Tiers - Evaluate Tier Trigger Conditions
   * 
   * TIER EXECUTION: Checks if current price has reached any profit tier
   * targets and determines if partial exits should be executed.
   * 
   * @param {number} currentPrice - Current market price
   * @param {number} profitPercent - Current profit percentage
   * @returns {Object} - Tier exit recommendation
   */
  checkProfitTiers(currentPrice, profitPercent) {
    for (let tier of this.state.tiers) {
      if (tier.completed) continue;
      
      let targetReached = false;
      
      if (this.state.direction === 'buy') {
        targetReached = currentPrice >= tier.targetPrice;
      } else {
        targetReached = currentPrice <= tier.targetPrice;
      }
      
      if (targetReached) {
        return {
          shouldExit: true,
          tier: tier.tier,
          targetPrice: tier.targetPrice,
          exitSize: tier.exitSize,
          exitPercentage: tier.exitPercentage,
          profitPercent: tier.targetPercent
        };
      }
    }
    
    return { shouldExit: false };
  }
  
  /**
   * Execute Partial Exit - Process Tier Exit
   * 
   * POSITION MANAGEMENT: Executes a partial exit and updates position
   * state to reflect the reduced position size.
   * 
   * @param {Object} tierExit - Tier exit details
   */
  executePartialExit(tierExit) {
    // Mark tier as completed
    const tier = this.state.tiers.find(t => t.tier === tierExit.tier);
    if (tier) {
      tier.completed = true;
      this.state.completedTiers.push({
        tier: tierExit.tier,
        executionTime: Date.now(),
        price: this.state.currentPrice,
        size: tierExit.exitSize,
        profitPercent: tierExit.profitPercent
      });
    }
    
    // Update position size
    this.state.remainingSize -= tierExit.exitSize;
    
    // Calculate realized P&L from this exit
    const realizedProfit = tierExit.exitSize * this.state.entryPrice * tierExit.profitPercent;
    this.state.realizedPnL += realizedProfit;
    
    // Update analytics
    if (!this.analytics.tiersCompletedDistribution[tierExit.tier]) {
      this.analytics.tiersCompletedDistribution[tierExit.tier] = 0;
    }
    this.analytics.tiersCompletedDistribution[tierExit.tier]++;
    
    this.log(`Executed tier ${tierExit.tier} exit: ${tierExit.exitSize.toFixed(4)} units at ${this.state.currentPrice.toFixed(2)}`, 'info');
  }
  
  /**
   * Update Trailing Stop - Dynamic Stop Management
   * 
   * TRAILING OPTIMIZATION: Adjusts trailing stop based on profit levels,
   * volatility conditions, and time-based factors.
   * 
   * @param {number} currentPrice - Current market price
   * @param {number} profitPercent - Current profit percentage
   * @param {number} volatility - Current market volatility
   * @returns {Object} - Update result
   */
  updateTrailingStop(currentPrice, profitPercent, volatility = null) {
    if (!this.config.enableTrailingStop) {
      return { updated: false, reason: 'trailing_disabled' };
    }
    
    // Only activate trailing after minimum profit reached
    if (profitPercent < this.config.minProfit) {
      return { updated: false, reason: 'insufficient_profit' };
    }
    
    // Activate trailing stop if not already active
    if (!this.state.trailingActive) {
      this.state.trailingActive = true;
      this.log('Trailing stop activated', 'info');
    }
    
    // Determine trail distance based on profit level
    let trailDistance = this.config.trailDistance;
    if (profitPercent >= this.config.tightTrailThreshold) {
      trailDistance = this.config.tightTrailDistance;
    }
    
    // Adjust for volatility if provided
    if (volatility && this.config.enableVolatilityAdjustment) {
      const volatilityAdjustment = this.calculateVolatilityAdjustment(volatility);
      trailDistance *= volatilityAdjustment.trailFactor;
    }
    
    // Calculate new stop price
    let newStop;
    if (this.state.direction === 'buy') {
      newStop = this.state.highestPrice * (1 - trailDistance);
    } else {
      newStop = this.state.lowestPrice * (1 + trailDistance);
    }
    
    // Only update if new stop is better (closer to current price)
    let shouldUpdate = false;
    if (this.state.direction === 'buy') {
      shouldUpdate = newStop > this.state.currentStop;
    } else {
      shouldUpdate = newStop < this.state.currentStop;
    }
    
    if (shouldUpdate) {
      const oldStop = this.state.currentStop;
      this.state.currentStop = newStop;
      
      this.log(`Trailing stop: ${oldStop.toFixed(2)} → ${newStop.toFixed(2)} (${(trailDistance * 100).toFixed(2)}% trail)`, 'debug');
      
      return {
        updated: true,
        oldStop: oldStop,
        newStop: newStop,
        trailDistance: trailDistance
      };
    }
    
    return { updated: false, reason: 'no_improvement' };
  }
  
  /**
   * Update Breakeven Stop - Breakeven Protection
   * 
   * CAPITAL PROTECTION: Moves stop to breakeven once position becomes
   * sufficiently profitable to lock in at least a neutral outcome.
   * 
   * @param {number} profitPercent - Current profit percentage
   */
  updateBreakevenStop(profitPercent) {
    if (this.state.breakevenActive || profitPercent < this.config.breakevenThreshold) {
      return;
    }
    
    // Move stop to breakeven (plus buffer for round-trip fees)
    // FIX 2026-02-05: Was 0.001 (0.1%) but Kraken round-trip is 0.52% (0.26% × 2 sides)
    const feeBuffer = TradingConfig.get('fees.takerFee'); // From TradingConfig - covers fees + slippage
    let breakevenStop;
    
    if (this.state.direction === 'buy') {
      breakevenStop = this.state.entryPrice * (1 + feeBuffer);
    } else {
      breakevenStop = this.state.entryPrice * (1 - feeBuffer);
    }
    
    // Only update if breakeven stop is better than current stop
    let shouldUpdate = false;
    if (this.state.direction === 'buy') {
      shouldUpdate = breakevenStop > this.state.currentStop;
    } else {
      shouldUpdate = breakevenStop < this.state.currentStop;
    }
    
    if (shouldUpdate) {
      this.state.currentStop = breakevenStop;
      this.state.breakevenActive = true;
      this.analytics.breakevenStopsTriggered++;
      
      this.log(`Breakeven stop activated at ${breakevenStop.toFixed(2)}`, 'info');
    }
  }
  
  /**
   * Apply Time-Based Adjustments - Time Optimization
   * 
   * TIME STRATEGY: Applies time-based exit logic and stop adjustments
   * based on how long the position has been held.
   * 
   * @returns {Object} - Time-based recommendations
   */
  applyTimeBasedAdjustments() {
    if (!this.config.enableTimeBasedAdjustments) {
      return { exitRecommended: false };
    }
    
    const holdTimeMinutes = (Date.now() - this.state.entryTime) / (1000 * 60);
    
    // Check for maximum hold time
    if (holdTimeMinutes >= this.config.maxHoldTimeMinutes) {
      return {
        exitRecommended: true,
        reason: 'max_hold_time',
        holdTimeMinutes: holdTimeMinutes
      };
    }
    
    // Apply time-based trail adjustments
    for (let interval of this.config.timeAdjustmentIntervals) {
      if (holdTimeMinutes >= interval.minutes) {
        // This could tighten trailing stops over time
        // Implementation depends on specific strategy
      }
    }
    
    return {
      exitRecommended: false,
      holdTimeMinutes: holdTimeMinutes
    };
  }
  
  /**
   * Calculate Volatility Adjustment - Volatility Adaptation
   * 
   * VOLATILITY SCALING: Calculates adjustment factors for stops and targets
   * based on current market volatility conditions.
   * 
   * @param {number} volatility - Current market volatility
   * @returns {Object} - Volatility adjustment factors
   */
  calculateVolatilityAdjustment(volatility) {
    if (!this.config.enableVolatilityAdjustment) {
      return {
        stopFactor: 1.0,
        trailFactor: 1.0,
        targetFactor: 1.0,
        adjusted: false
      };
    }
    
    let stopFactor = 1.0;
    let trailFactor = 1.0;
    let targetFactor = 1.0;
    let adjusted = false;
    
    if (volatility <= this.config.lowVolatilityThreshold) {
      // Low volatility: tighter stops and targets
      stopFactor = 0.7;   // 30% tighter stops
      trailFactor = 0.7;  // 30% tighter trailing
      targetFactor = 0.8; // 20% lower targets
      adjusted = true;
    } else if (volatility >= this.config.highVolatilityThreshold) {
      // High volatility: wider stops and targets
      stopFactor = 1.5;   // 50% wider stops
      trailFactor = 1.3;  // 30% wider trailing
      targetFactor = 1.4; // 40% higher targets
      adjusted = true;
    }
    
    return {
      stopFactor,
      trailFactor,
      targetFactor,
      adjusted,
      volatilityLevel: volatility <= this.config.lowVolatilityThreshold ? 'low' :
                      volatility >= this.config.highVolatilityThreshold ? 'high' : 'normal'
    };
  }
  
  /**
   * Should Exit Position - Exit Decision Logic
   * 
   * EXIT EVALUATION: Determines if position should be completely closed
   * based on stop loss conditions.
   * 
   * @param {number} currentPrice - Current market price
   * @param {number} profitPercent - Current profit percentage
   * @returns {boolean} - Whether to exit position
   */
  shouldExitPosition(currentPrice, profitPercent) {
    if (!this.state.currentStop) return false;
    
    if (this.state.direction === 'buy') {
      return currentPrice <= this.state.currentStop;
    } else {
      return currentPrice >= this.state.currentStop;
    }
  }
  
  /**
   * Get Next Profit Tier - Tier Information
   * 
   * @returns {Object|null} - Next uncompleted profit tier
   */
  getNextProfitTier() {
    return this.state.tiers.find(tier => !tier.completed) || null;
  }
  
  /**
   * Get Position State - Current State Summary
   * 
   * @returns {Object} - Complete position state information
   */
  getPositionState() {
    const holdTimeMinutes = (Date.now() - this.state.entryTime) / (1000 * 60);
    const profitPercent = this.calculateProfitPercent(this.state.currentPrice);
    
    return {
      active: this.state.active,
      direction: this.state.direction,
      entryPrice: this.state.entryPrice,
      currentPrice: this.state.currentPrice,
      profitPercent: profitPercent,
      unrealizedPnL: this.state.unrealizedPnL,
      realizedPnL: this.state.realizedPnL,
      totalPnL: this.state.unrealizedPnL + this.state.realizedPnL,
      remainingSize: this.state.remainingSize,
      originalSize: this.state.originalSize,
      currentStop: this.state.currentStop,
      trailingActive: this.state.trailingActive,
      breakevenActive: this.state.breakevenActive,
      completedTiers: this.state.completedTiers.length,
      totalTiers: this.state.tiers.length,
      holdTimeMinutes: holdTimeMinutes,
      maxUnrealizedPnL: this.state.maxUnrealizedPnL
    };
  }
  
  /**
   * Close Position - Position Closure
   * 
   * POSITION FINALIZATION: Closes the position and finalizes all profit
   * calculations and analytics.
   * 
   * @param {number} exitPrice - Final exit price
   * @param {string} reason - Reason for closure
   * @returns {Object} - Position closure summary
   */
  close(exitPrice, reason = 'manual') {
    if (!this.state.active) {
      return { success: false, error: 'No active position to close' };
    }
    
    const holdTime = Date.now() - this.state.entryTime;
    const holdTimeMinutes = holdTime / (1000 * 60);
    const finalProfitPercent = this.calculateProfitPercent(exitPrice);
    
    // Calculate final P&L
    const remainingPnL = this.state.remainingSize * this.state.entryPrice * finalProfitPercent;
    const totalPnL = this.state.realizedPnL + remainingPnL;
    
    // Update analytics
    this.analytics.totalProfitExtracted += totalPnL;
    this.analytics.averageHoldTime = ((this.analytics.averageHoldTime * (this.analytics.totalPositionsManaged - 1)) + holdTimeMinutes) / this.analytics.totalPositionsManaged;
    this.analytics.averageProfitPerPosition = this.analytics.totalProfitExtracted / this.analytics.totalPositionsManaged;
    
    if (totalPnL > this.analytics.bestPositionProfit) {
      this.analytics.bestPositionProfit = totalPnL;
    }
    if (totalPnL < this.analytics.worstPositionLoss) {
      this.analytics.worstPositionLoss = totalPnL;
    }
    
    // Create closure summary
    const summary = {
      success: true,
      entryPrice: this.state.entryPrice,
      exitPrice: exitPrice,
      direction: this.state.direction,
      originalSize: this.state.originalSize,
      finalSize: this.state.remainingSize,
      realizedPnL: this.state.realizedPnL,
      remainingPnL: remainingPnL,
      totalPnL: totalPnL,
      profitPercent: finalProfitPercent,
      maxUnrealizedPnL: this.state.maxUnrealizedPnL,
      holdTime: holdTime,
      holdTimeMinutes: holdTimeMinutes,
      reason: reason,
      tiersCompleted: this.state.completedTiers.length,
      totalTiers: this.state.tiers.length,
      trailingStopUsed: this.state.trailingActive,
      breakevenStopUsed: this.state.breakevenActive
    };
    
    // Reset state
    this.reset();
    
    this.log(`Position closed: ${reason} | P&L: ${totalPnL.toFixed(2)} (${(finalProfitPercent * 100).toFixed(2)}%)`, 'info');
    
    return summary;
  }
  
  /**
   * Reset State - Reset for New Position
   * 
   * SYSTEM RESET: Resets all state for managing a new position while
   * preserving analytics and configuration.
   */
  reset() {
    this.state = {
      active: false,
      entryPrice: 0,
      direction: null,
      originalSize: 0,
      remainingSize: 0,
      currentPrice: 0,
      highestPrice: 0,
      lowestPrice: Infinity,
      currentStop: null,
      initialStop: null,
      trailingActive: false,
      breakevenActive: false,
      tiers: [],
      completedTiers: [],
      entryTime: 0,
      lastUpdateTime: 0,
      unrealizedPnL: 0,
      realizedPnL: 0,
      maxUnrealizedPnL: 0,
      totalFeesEstimated: 0
    };
  }
  
  /**
   * Get Analytics Summary - Performance Analytics
   * 
   * PERFORMANCE REPORTING: Provides comprehensive analytics about
   * profit management performance for optimization and reporting.
   * 
   * @returns {Object} - Complete analytics summary
   */
  getAnalytics() {
    return {
      ...this.analytics,
      efficiency: this.analytics.totalPositionsManaged > 0 ? 
        (this.analytics.totalProfitExtracted / this.analytics.totalPositionsManaged) : 0,
      trailingStopSuccessRate: this.analytics.totalPositionsManaged > 0 ?
        (this.analytics.trailingStopTriggered / this.analytics.totalPositionsManaged) * 100 : 0,
      breakevenProtectionRate: this.analytics.totalPositionsManaged > 0 ?
        (this.analytics.breakevenStopsTriggered / this.analytics.totalPositionsManaged) * 100 : 0
    };
  }
  
  /**
   * Export Configuration - Config Export
   * 
   * SYSTEM BACKUP: Exports current configuration for backup or sharing.
   * 
   * @returns {Object} - Exportable configuration
   */
  exportConfig() {
    return {
      timestamp: Date.now(),
      version: '1.0',
      config: { ...this.config }
    };
  }
  
  /**
   * Import Configuration - Config Import
   * 
   * SYSTEM RESTORE: Imports configuration from backup or template.
   * 
   * @param {Object} configData - Configuration to import
   * @returns {boolean} - Success status
   */
  importConfig(configData) {
    try {
      if (!configData || !configData.config) {
        throw new Error('Invalid configuration data');
      }
      
      this.config = { ...this.config, ...configData.config };
      this.log('Configuration imported successfully', 'info');
      return true;
      
    } catch (error) {
      this.log(`Failed to import configuration: ${error.message}`, 'error');
      return false;
    }
  }
  
  /**
   * Validate Configuration - Config Validation
   * 
   * SYSTEM INTEGRITY: Validates configuration parameters to ensure
   * they're within safe and logical ranges.
   * 
   * @returns {Object} - Validation result
   */
  validateConfig() {
    const errors = [];
    const warnings = [];
    
    // Tier validation
    if (this.config.firstTierTarget >= this.config.secondTierTarget) {
      errors.push('First tier target must be less than second tier target');
    }
    
    if (this.config.secondTierTarget >= this.config.thirdTierTarget) {
      errors.push('Second tier target must be less than third tier target');
    }
    
    if (this.config.thirdTierTarget >= this.config.finalTarget) {
      errors.push('Third tier target must be less than final target');
    }
    
    // Exit percentage validation
    const totalExit = this.config.firstTierExit + this.config.secondTierExit + this.config.thirdTierExit;
    if (totalExit > 1.0) {
      errors.push('Total tier exit percentages cannot exceed 100%');
    }
    
    // Trailing stop validation
    if (this.config.tightTrailDistance >= this.config.trailDistance) {
      warnings.push('Tight trail distance should be smaller than regular trail distance');
    }
    
    if (this.config.minProfit >= this.config.firstTierTarget) {
      warnings.push('Minimum profit for trailing should be less than first tier target');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors,
      warnings: warnings
    };
  }
  
  getState() {
  return {
    currentStop: this.currentStop || null,
    lastProfitTrigger: this.lastProfitTrigger || null,
    isTrailing: this.isTrailing || false
  };
}

  /**
   * Logging Function - Enhanced Logging
   * 
   * DEBUGGING SUPPORT: Provides structured logging with different severity levels.
   * 
   * @param {string} message - Log message
   * @param {string} level - Log level ('debug', 'info', 'warning', 'error')
   */
  log(message, level = 'info') {
    // Filter debug messages based on config
    if (level === 'debug' && this.config.logLevel !== 'debug') {
      return;
    }
    
    // Format based on severity
    let prefix = '💰';
    
    switch (level) {
      case 'error':
        prefix = '❌';
        break;
      case 'warning':
        prefix = '⚠️';
        break;
      case 'info':
        prefix = '💰';
        break;
      case 'debug':
        prefix = '🔍';
        break;
    }
    
    const timestamp = new Date().toISOString();
    console.log(`${prefix} [${timestamp}] [MaxProfitManager] ${message}`);
  }
}


// ============================================================================
// EXPORTS
// ============================================================================

/* 
============================================================================
💰 MAX PROFIT MANAGER USAGE EXAMPLES FOR NEW DEVELOPERS:
============================================================================

// 1. INITIALIZE PROFIT MANAGER
const MaxProfitManager = require('./core/MaxProfitManager');

const profitManager = new MaxProfitManager({
  enableTieredExit: true,
  firstTierTarget: 0.02,        // 2% profit
  firstTierExit: 0.25,          // Exit 25% of position
  enableTrailingStop: true,
  trailDistance: 0.01,          // 1% trailing distance
  enableVolatilityAdjustment: true
});

// 2. START MANAGING A POSITION
const startResult = profitManager.start(
  50000,                        // Entry price
  'buy',                        // Direction
  1.0,                          // Position size
  {
    volatility: 0.03,           // 3% market volatility
    marketCondition: 'trending', // Market condition
    confidence: 0.85            // Trade confidence
  }
);

console.log('Initial stop:', startResult.initialStop);
console.log('Profit tiers:', startResult.profitTiers);

// 3. UPDATE WITH NEW PRICES
const currentPrice = 51000;     // Price moved up $1000

const update = profitManager.update(currentPrice, {
  volatility: 0.025,            // Updated volatility
  volume: 150000                // Current volume
});

console.log('Update action:', update.action);

if (update.action === 'exit_partial') {
  console.log(`Execute partial exit: ${update.exitSize} units`);
  console.log(`Reason: ${update.reason}`);
  console.log(`Remaining size: ${update.remainingSize}`);
}

if (update.action === 'exit_full') {
  console.log(`Execute full exit at ${update.price}`);
  console.log(`Reason: ${update.reason}`);
  console.log(`Final profit: ${(update.profitPercent * 100).toFixed(2)}%`);
}

// 4. MONITOR POSITION STATE
const state = profitManager.getPositionState();

console.log(`Current P&L: ${state.totalPnL.toFixed(2)}`);
console.log(`Profit %: ${(state.profitPercent * 100).toFixed(2)}%`);
console.log(`Completed tiers: ${state.completedTiers}/${state.totalTiers}`);
console.log(`Trailing active: ${state.trailingActive}`);
console.log(`Hold time: ${state.holdTimeMinutes.toFixed(1)} minutes`);

// 5. CLOSE POSITION MANUALLY
if (someCondition) {
  const closure = profitManager.close(currentPrice, 'manual_override');
  
  console.log(`Position closed: ${closure.success}`);
  console.log(`Total P&L: ${closure.totalPnL.toFixed(2)}`);
  console.log(`Hold time: ${closure.holdTimeMinutes.toFixed(1)} minutes`);
  console.log(`Tiers completed: ${closure.tiersCompleted}/${closure.totalTiers}`);
}

// 6. ANALYZE PERFORMANCE
const analytics = profitManager.getAnalytics();

console.log(`Total positions managed: ${analytics.totalPositionsManaged}`);
console.log(`Total profit extracted: ${analytics.totalProfitExtracted.toFixed(2)}`);
console.log(`Average profit per position: ${analytics.averageProfitPerPosition.toFixed(2)}`);
console.log(`Average hold time: ${analytics.averageHoldTime.toFixed(1)} minutes`);
console.log(`Trailing stop success rate: ${analytics.trailingStopSuccessRate.toFixed(1)}%`);

// 7. CONFIGURATION MANAGEMENT
const configValidation = profitManager.validateConfig();

if (!configValidation.valid) {
  console.error('Configuration errors:', configValidation.errors);
}

if (configValidation.warnings.length > 0) {
  console.warn('Configuration warnings:', configValidation.warnings);
}

// 8. BACKUP AND RESTORE CONFIGURATION
const configBackup = profitManager.exportConfig();
// Save to file or database

// Later, restore configuration
// const success = profitManager.importConfig(configBackup);
 
============================================================================
💰 THIS IS YOUR PROFIT AMPLIFIER!
============================================================================

The MaxProfitManager transforms good trades into GREAT trades by:

✅ TIERED EXITS - Take profits in stages to maximize gains
✅ DYNAMIC TRAILING - Protect profits while allowing for bigger moves
✅ VOLATILITY ADAPTATION - Adjust strategies based on market conditions
✅ TIME OPTIMIZATION - Different strategies for different hold periods
✅ BREAKEVEN PROTECTION - Lock in profits once position becomes profitable
✅ MARKET AWARENESS - Adapt targets based on trending vs ranging markets
✅ PERFORMANCE ANALYTICS - Track and optimize profit extraction efficiency

This system can be the difference between making rent and making life-changing
money. Every extra percent of profit gets you closer to Houston!

The difference between amateur and professional trading isn't just finding
good trades - it's maximizing the profit from every winning trade.

FOR VALHALLA! FOR HOUSTON! FOR MAXIMUM PROFITS! 💰🚀

*/

module.exports = MaxProfitManager;