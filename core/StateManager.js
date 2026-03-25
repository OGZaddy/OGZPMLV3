/**
 * @fileoverview StateManager - Single Source of Truth for Trading State
 *
 * This module centralizes ALL trading state management with atomic updates.
 * It prevents the critical position/balance desync bugs that occurred when
 * multiple components tracked state independently.
 *
 * @description
 * ARCHITECTURE ROLE:
 * StateManager sits at the center of the trading system. Every component
 * (TradingBrain, ExecutionLayer, RiskManager) MUST read from and write to
 * StateManager rather than maintaining their own state copies.
 *
 * HISTORICAL BUGS FIXED:
 * - Position desync: this.currentPosition vs this.tradingBrain.position
 * - Balance desync: Multiple components tracking different balances
 * - P&L calculation: BTC treated as USD (lost $99.99 per trade)
 * - activeTrades accumulation: Closed trades not removed from Map
 *
 * CRITICAL INVARIANTS:
 * 1. position is always in BTC (asset units), NOT USD
 * 2. balance is always in USD
 * 3. inPosition tracks USD locked in positions (position × entryPrice)
 * 4. totalBalance = balance + inPosition + unrealizedPnL
 * 5. All updates go through updateState() for atomicity
 *
 * @module core/StateManager
 * @requires fs
 * @requires path
 *
 * @example
 * // Get the singleton instance
 * const { getInstance } = require('./core/StateManager');
 * const stateManager = getInstance();
 *
 * // Open a position (size in BTC)
 * await stateManager.openPosition(0.001, 100000, { source: 'TradingBrain' });
 *
 * // Close position
 * await stateManager.closePosition(101000);
 *
 * // Check current state
 * const state = stateManager.getState();
 * console.log(`Balance: $${state.balance}, Position: ${state.position} BTC`);
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: StateManager Class
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Centralized state management for trading operations.
 * Implements atomic updates, state persistence, and change notifications.
 *
 * @class StateManager
 * @property {Object} state - The current trading state
 * @property {number} state.position - Current position size in BTC (NOT USD!)
 * @property {number} state.positionCount - Number of entries (for averaging)
 * @property {number} state.entryPrice - Average entry price in USD
 * @property {Date|null} state.entryTime - When position was opened
 * @property {number} state.balance - Available USD balance (not in positions)
 * @property {number} state.totalBalance - Total account value in USD
 * @property {number} state.inPosition - USD value locked in positions
 * @property {Map} state.activeTrades - Active trade records (orderId → trade)
 * @property {number} state.realizedPnL - Cumulative realized profit/loss
 * @property {number} state.unrealizedPnL - Current unrealized P&L
 * @property {boolean} state.isTrading - Whether trading is active
 * @property {boolean} state.recoveryMode - Emergency recovery mode flag
 */

const TradingConfig = require('./TradingConfig');
const { get: getConfigValue } = require('../foundation/ConfigLoader');

class StateManager {
  /**
   * Creates a new StateManager instance.
   * Initializes default state, sets up listeners, and loads persisted state.
   *
   * @constructor
   * @note This should only be called by getInstance() - use the singleton!
   */
  constructor() {
    // ─────────────────────────────────────────────────────────────────────
    // POSITION TRACKING
    // CRITICAL: position is in BTC (asset units), NOT USD!
    // ─────────────────────────────────────────────────────────────────────
    this.state = {
      position: 0,              // Current position size in BTC (ASSET UNITS!)
      positionCount: 0,         // Number of entries (for DCA/averaging)
      entryPrice: 0,            // Average entry price in USD
      entryTime: null,          // Timestamp when position was opened

      // ─────────────────────────────────────────────────────────────────────
      // BALANCE TRACKING (all values in USD)
      // Invariant: totalBalance ≈ balance + inPosition + unrealizedPnL
      // ─────────────────────────────────────────────────────────────────────
      balance: 10000,           // Available USD (not locked in positions)
      totalBalance: 10000,      // Total account value in USD
      initialBalance: 10000,    // FIX 2026-03-14: Reference point for drawdown calculation
      inPosition: 0,            // USD locked in positions (position × entryPrice)

      // ─────────────────────────────────────────────────────────────────────
      // TRADE TRACKING
      // activeTrades Map persists across restarts via save()/load()
      // ─────────────────────────────────────────────────────────────────────
      activeTrades: new Map(),  // orderId → { size, price, entryTime, ... }
      lastTradeTime: null,      // Timestamp of last trade execution
      tradeCount: 0,            // Total trades (lifetime)
      dailyTradeCount: 0,       // Trades today (resets via resetDaily())

      // ─────────────────────────────────────────────────────────────────────
      // P&L TRACKING (all values in USD)
      // ─────────────────────────────────────────────────────────────────────
      realizedPnL: 0,           // Cumulative closed trade P&L
      unrealizedPnL: 0,         // Current open position P&L (updated externally)
      totalPnL: 0,              // realizedPnL + unrealizedPnL

      // ─────────────────────────────────────────────────────────────────────
      // SYSTEM STATE
      // ─────────────────────────────────────────────────────────────────────
      isTrading: false,         // false = paused/stopped
      recoveryMode: false,      // true = emergency mode active
      lastError: null,          // Last error message (for pause reason)
      lastUpdate: Date.now()    // Timestamp of last state update
    };

    /** @type {Set<Function>} Listeners notified on state changes */
    this.listeners = new Set();

    /** @type {Array<Object>} Rolling log of recent transactions for debugging */
    this.transactionLog = [];
    this.maxLogSize = 100;

    /** @type {boolean} Lock flag for atomic operations */
    this.locked = false;
    /** @type {Array<Function>} Queue of callbacks waiting for lock */
    this.lockQueue = [];

    // Bind methods to preserve 'this' context when passed as callbacks
    this.get = this.get.bind(this);
    this.set = this.set.bind(this);
    this.updateActiveTrade = this.updateActiveTrade.bind(this);
    this.removeActiveTrade = this.removeActiveTrade.bind(this);
    this.openPosition = this.openPosition.bind(this);
    this.closePosition = this.closePosition.bind(this);

    // Load persisted state from disk (respects BACKTEST_MODE, FRESH_START)
    this.load();
  }

  /**
   * Get current state snapshot (read-only)
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Get specific state value
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Set specific state value (for internal use)
   */
  set(key, value) {
    this.state[key] = value;
    return value;
  }

  /**
   * ATOMIC state update with transaction safety
   * All state changes MUST go through this
   */
  async updateState(updates, context = {}) {
    // Wait for lock
    await this.acquireLock();

    try {
      // Snapshot for rollback
      const snapshot = { ...this.state };
      const timestamp = Date.now();

      // Validate updates
      this.validateUpdates(updates);

      // Apply updates atomically
      for (const [key, value] of Object.entries(updates)) {
        // DEBUG: Log balance changes
        if (key === 'balance') {
          console.log(`💰 [StateManager] Balance update: ${this.state[key]} → ${value}`);
        }

        // CRITICAL FIX: Protect activeTrades Map from being overwritten
        if (key === 'activeTrades') {
          // If it's an array, convert to Map
          if (Array.isArray(value)) {
            this.state.activeTrades = new Map(value);
            console.log(`🔧 [StateManager] Converted activeTrades array to Map with ${value.length} entries`);
          } else if (value instanceof Map) {
            this.state.activeTrades = value;
          } else {
            console.warn(`⚠️ [StateManager] Ignoring invalid activeTrades update (not Array or Map):`, value);
            continue; // Skip this update
          }
        } else {
          this.state[key] = value;
        }
      }

      this.state.lastUpdate = timestamp;

      // Log transaction
      this.logTransaction({
        timestamp,
        updates,
        context,
        snapshot
      });

      // Notify listeners
      this.notifyListeners(updates, context);

      // CHANGE 2025-12-13: Save state to disk after updates
      this.save();

      return { success: true, state: this.getState() };

    } catch (error) {
      console.error('[StateManager] Update failed:', error);
      // Rollback would go here if needed
      return { success: false, error: error.message };

    } finally {
      this.releaseLock();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION: Position Management
  // These methods handle opening/closing positions with proper BTC↔USD math
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Open a new position (BUY).
   *
   * @async
   * @param {number} size - Position size in BTC (asset units, NOT USD!)
   * @param {number} price - Current market price in USD per BTC
   * @param {Object} [context={}] - Additional context for logging/tracking
   * @param {string} [context.orderId] - Broker order ID
   * @param {string} [context.source] - Calling component (e.g., 'TradingBrain')
   * @param {string} [context.reason] - Trade reason (e.g., 'RSI oversold')
   * @param {number} [context.confidence] - Signal confidence (0-100)
   * @returns {Promise<{success: boolean, state?: Object, error?: string}>}
   *
   * @example
   * // Buy 0.001 BTC at $100,000
   * await stateManager.openPosition(0.001, 100000, {
   *   source: 'TradingBrain',
   *   reason: 'RSI oversold bounce',
   *   confidence: 75
   * });
   * // Result: balance -= $100, position = 0.001, inPosition = $100
   *
   * @description
   * CRITICAL MATH:
   * - size is in BTC (e.g., 0.001)
   * - price is in USD per BTC (e.g., $100,000)
   * - usdCost = size × price (e.g., 0.001 × 100,000 = $100)
   * - balance decreases by usdCost
   * - inPosition increases by usdCost
   * - position increases by size (BTC)
   */
  async openPosition(size, price, context = {}) {
    if (this.state.position > 0) {
      console.warn('[StateManager] Already in position, adding to it');
    }

    // DEBUG: Log what we're doing
    const usdCost = size * price;  // Calculate USD cost
    console.log(`📊 [StateManager] Opening position:`);
    console.log(`   Size: ${size} BTC`);
    console.log(`   Price: $${price}`);
    console.log(`   USD Cost: $${usdCost.toFixed(2)}`);
    console.log(`   Current Balance: $${this.state.balance}`);
    console.log(`   New Balance: $${(this.state.balance - usdCost).toFixed(2)}`);

    // CRITICAL FIX: Add trade to activeTrades Map
    const tradeId = context.orderId || `TRADE_${Date.now()}`;
    const tradeAction = context.action || 'BUY';
    const tradeDirection = context.direction || 'long';
    const trade = {
      id: tradeId,
      action: tradeAction,  // BUY or SELL_SHORT
      type: tradeAction,    // Keep both for compatibility
      direction: tradeDirection,  // 'long' or 'short'
      size: size,
      price: price,
      entryPrice: price,  // Add entryPrice field that run-empire expects
      entryTime: Date.now(),  // Add entryTime field
      timestamp: Date.now(),
      status: 'open',
      ...context
    };

    // Add to activeTrades Map
    if (!this.state.activeTrades) {
      this.state.activeTrades = new Map();
    }
    this.state.activeTrades.set(tradeId, trade);
    console.log(`✅ [StateManager] Added trade ${tradeId} to activeTrades (now ${this.state.activeTrades.size} trades)`);

    // FIX 2026-02-05: Deduct trading fee on entry (from TradingConfig)
    const entryFee = usdCost * TradingConfig.get('fees.makerFee');
    // For shorts, position is negative
    const positionDelta = tradeDirection === 'short' ? -size : size;
    const newPosition = this.state.position + positionDelta;
    const updates = {
      position: newPosition,  // Positive for long, negative for short
      positionCount: this.state.positionCount + 1,
      entryPrice: Math.abs(this.state.position) > 0
        ? (this.state.entryPrice * Math.abs(this.state.position) + price * size) / (Math.abs(this.state.position) + size)
        : price,
      entryTime: this.state.entryTime || Date.now(),
      balance: this.state.balance - usdCost - entryFee,  // Subtract USD cost + fee
      inPosition: this.state.inPosition + usdCost,  // BUGFIX: Track USD in position, not BTC!
      lastTradeTime: Date.now(),
      tradeCount: this.state.tradeCount + 1,
      dailyTradeCount: this.state.dailyTradeCount + 1
    };

    return this.updateState(updates, { action: 'OPEN_POSITION', price, size, ...context });
  }

  /**
   * Close position (SELL) - partial or full.
   *
   * @async
   * @param {number} price - Current market price in USD per BTC
   * @param {boolean} [partial=false] - true for partial close, false for full
   * @param {number|null} [size=null] - BTC amount to close (null = full position)
   * @param {Object} [context={}] - Additional context for logging/tracking
   * @returns {Promise<{success: boolean, state?: Object, error?: string}>}
   *
   * @example
   * // Full close at $101,000 (1% profit on $100k entry)
   * await stateManager.closePosition(101000);
   * // Result: pnl = 0.001 × ($101k - $100k) = $1
   * //         balance += 0.001 × $101,000 = $101
   *
   * @description
   * CRITICAL P&L CALCULATION (fixed 2026-02-01):
   * WRONG (old bug): pnl = closeSize × priceChangePercent
   *   - Treated BTC as USD: 0.001 × 0.01 = $0.00001 profit (WRONG!)
   * CORRECT: pnl = closeSize × (price - entryPrice)
   *   - BTC × price_diff = USD: 0.001 × $1000 = $1 profit (CORRECT!)
   *
   * BALANCE RESTORATION (fixed 2026-02-01):
   * WRONG (old bug): balance += closeSize + pnl
   *   - Added BTC to USD: balance + 0.001 + 0.00001 (WRONG!)
   * CORRECT: balance += closeSize × price
   *   - BTC × current_price = USD returned: balance + $101 (CORRECT!)
   */
  async closePosition(price, partial = false, size = null, context = {}) {
    if (this.state.position <= 0) {
      console.error('[StateManager] No position to close!');
      return { success: false, error: 'No position to close' };
    }

    const closeSize = size || this.state.position;
    // CRITICAL BUGFIX 2026-02-01: Position is in BTC, not USD!
    // Previous code treated closeSize as USD, causing $99.99 loss on every trade
    // Example: 0.001 BTC position × 0.01 percent = $0.00001 PnL (WRONG!)
    // Correct: 0.001 BTC × $1000 price change = $1 PnL
    const pnl = closeSize * (price - this.state.entryPrice);  // BTC × price diff = USD profit
    const priceChangePercent = this.state.entryPrice > 0
      ? ((price - this.state.entryPrice) / this.state.entryPrice)
      : 0;
    const pnlPercent = priceChangePercent * 100;

    // FIX 2026-03-19: Remove ONLY the specific trade being closed, not all trades
    // Previous bug: Closing any trade wiped ALL activeTrades, breaking multi-position
    // Now: If context.tradeId provided, remove only that trade
    //      If full close (position → 0), clear all remaining trades
    if (this.state.activeTrades && this.state.activeTrades.size > 0) {
      const tradeId = context.tradeId || context.orderId;

      if (tradeId && this.state.activeTrades.has(tradeId)) {
        // Remove only the specific trade being closed
        const trade = this.state.activeTrades.get(tradeId);
        this.state.activeTrades.delete(tradeId);
        console.log(`🔒 [StateManager] Removed trade ${tradeId} (${trade.action || trade.type}) from activeTrades`);
        console.log(`📊 [StateManager] ${this.state.activeTrades.size} active trades remaining`);
      } else if (!partial && (this.state.position - closeSize) <= 0) {
        // Full close with no position remaining - clear all trades
        const tradeCount = this.state.activeTrades.size;
        for (const [id, trade] of this.state.activeTrades.entries()) {
          this.state.activeTrades.delete(id);
          console.log(`🔒 [StateManager] Removed trade ${id} (${trade.action || trade.type}) from activeTrades`);
        }
        console.log(`📊 [StateManager] Cleared ${tradeCount} active trades (position fully closed)`);
      }
    }

    // CRITICAL BUGFIX 2026-02-01: Balance was adding BTC amount instead of USD value!
    // closeSize is in BTC, we need to add back the USD value at current price
    // Previous: balance + closeSize + pnl → balance + 0.001 + 0.00001 = wrong!
    // Correct: balance + (closeSize * price) → balance + 101 = right!
    const usdValueReturned = closeSize * price;  // What we get back in USD

    // FIX 2026-02-05: Deduct trading fee on exit (from TradingConfig)
    const exitFee = usdValueReturned * TradingConfig.get('fees.takerFee');

    // Calculate USD that was locked in position (at entry price)
    const usdCostLocked = closeSize * this.state.entryPrice;

    // FIX 2026-03-19: Force position to 0 when all activeTrades are closed
    // This ensures position scalar stays in sync with activeTrades Map
    const noActiveTradesRemaining = !this.state.activeTrades || this.state.activeTrades.size === 0;
    const calculatedPosition = Math.max(0, this.state.position - closeSize);
    const finalPosition = noActiveTradesRemaining ? 0 : calculatedPosition;

    const updates = {
      position: finalPosition,
      positionCount: partial ? this.state.positionCount : 0,
      entryPrice: partial ? this.state.entryPrice : 0,
      entryTime: partial ? this.state.entryTime : null,
      balance: this.state.balance + usdValueReturned - exitFee,  // Add back USD at current price minus fee
      inPosition: Math.max(0, this.state.inPosition - usdCostLocked),  // BUGFIX: Subtract USD, not BTC!
      realizedPnL: this.state.realizedPnL + pnl,
      totalPnL: this.state.totalPnL + pnl,
      totalBalance: this.state.totalBalance + pnl,  // BUGFIX: Track total value including profits
      lastTradeTime: Date.now()
    };

    console.log(`📊 Position closed: PnL ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);

    return this.updateState(updates, {
      action: 'CLOSE_POSITION',
      price,
      size: closeSize,
      pnl,
      partial,
      ...context
    });
  }

  /**
   * Update balance (deposits, withdrawals, fees)
   */
  async updateBalance(amount, reason = 'adjustment') {
    const updates = {
      balance: this.state.balance + amount,
      totalBalance: this.state.totalBalance + amount
    };

    return this.updateState(updates, { action: 'BALANCE_UPDATE', amount, reason });
  }

  /**
   * Reset daily counters
   */
  async resetDaily() {
    const updates = {
      dailyTradeCount: 0
    };

    return this.updateState(updates, { action: 'DAILY_RESET' });
  }

  /**
   * Set recovery mode
   */
  async setRecoveryMode(enabled) {
    const updates = {
      recoveryMode: enabled
    };

    return this.updateState(updates, { action: 'RECOVERY_MODE', enabled });
  }

  /**
   * Validate state consistency
   */
  validateState() {
    const issues = [];

    // Check balance consistency
    const expectedTotal = this.state.balance + this.state.inPosition;
    const diff = Math.abs(expectedTotal - this.state.totalBalance);
    if (diff > 0.01) {
      issues.push(`Balance mismatch: total=${this.state.totalBalance}, expected=${expectedTotal}`);
    }

    // Check position consistency
    if (this.state.position > 0 && !this.state.entryPrice) {
      issues.push('Position exists but no entry price');
    }

    if (this.state.position === 0 && this.state.inPosition > 0) {
      issues.push('No position but funds locked');
    }

    if (this.state.position < 0) {
      issues.push('Negative position detected!');
    }

    if (this.state.balance < 0) {
      issues.push('Negative balance detected!');
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * Emergency state reset (use with caution!)
   */
  async emergencyReset(safeBalance = null) {
    console.warn('🚨 [StateManager] EMERGENCY RESET INITIATED');

    const updates = {
      position: 0,
      positionCount: 0,
      entryPrice: 0,
      entryTime: null,
      balance: safeBalance || this.state.totalBalance,
      totalBalance: safeBalance || this.state.totalBalance,
      inPosition: 0,
      activeTrades: new Map(),
      recoveryMode: true
    };

    return this.updateState(updates, { action: 'EMERGENCY_RESET' });
  }

  /**
   * Pause trading for safety
   * @param {string} reason - Why trading is being paused
   */
  async pauseTrading(reason) {
    console.log('🛑 [StateManager] PAUSING TRADING:', reason);

    const updates = {
      isTrading: false,
      lastError: reason,
      pausedAt: Date.now(),
      pauseReason: reason
    };

    await this.updateState(updates, { action: 'PAUSE_TRADING', reason });

    // Log to console with visible warning
    console.log('═══════════════════════════════════════════════════════');
    console.log('🚨 TRADING PAUSED - SAFETY STOP');
    console.log(`   Reason: ${reason}`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log('   Action Required: Review logs and resume manually');
    console.log('═══════════════════════════════════════════════════════');

    return { success: true, message: `Trading paused: ${reason}` };
  }

  /**
   * Resume trading after pause
   */
  async resumeTrading() {
    console.log('✅ [StateManager] RESUMING TRADING');

    const updates = {
      isTrading: true,
      lastError: null,
      pausedAt: null,
      pauseReason: null,
      resumedAt: Date.now()
    };

    await this.updateState(updates, { action: 'RESUME_TRADING' });

    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ TRADING RESUMED');
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log('═══════════════════════════════════════════════════════');

    return { success: true, message: 'Trading resumed' };
  }

  // === CHANGE 2025-12-13: STEP 1 - ACTIVE TRADES MANAGEMENT ===

  /**
   * Add or update an active trade
   * PHASE 13B: BYPASS HALT - triggers haltNewEntries when called from outside PositionTracker
   */
  updateActiveTrade(orderId, tradeData) {
    // PHASE 13B: Bypass halt switch ENABLED
    const BYPASS_HALT_ENABLED = true;

    const stack = new Error().stack;
    const isFromPositionTracker = stack.includes('PositionTracker');
    if (!isFromPositionTracker) {
      const caller = stack.split('\n')[2]?.trim() || 'unknown';

      // Always collect violation for analysis
      this._bypassViolations = this._bypassViolations || [];
      this._bypassViolations.push({
        method: 'updateActiveTrade',
        orderId,
        caller,
        timestamp: Date.now(),
        stack: stack.split('\n').slice(1, 6).join('\n')
      });

      // PHASE 13B: Trigger halt on bypass
      if (BYPASS_HALT_ENABLED) {
        this._haltNewEntries = true;
        this._haltReason = `Bypass detected: ${caller} called updateActiveTrade() directly`;

        console.error(`🚨 [StateManager] BYPASS HALT TRIGGERED`);
        console.error(`   Caller: ${caller}`);
        console.error(`   OrderId: ${orderId}`);
        console.error(`   Stack trace:\n${stack.split('\n').slice(1, 6).join('\n')}`);
        console.error(`   ⛔ NEW ENTRIES HALTED - exits only until flat`);

        // Emit alert event if listeners registered
        if (this._alertListeners?.length > 0) {
          const alert = {
            type: 'BYPASS_VIOLATION',
            method: 'updateActiveTrade',
            caller,
            orderId,
            timestamp: Date.now()
          };
          for (const listener of this._alertListeners) {
            try { listener(alert); } catch (e) { /* ignore */ }
          }
        }
      } else {
        // Detection mode only (Phase 13A behavior)
        console.warn(`⚠️ [StateManager] BYPASS DETECTED: updateActiveTrade() called from outside PositionTracker`);
        console.warn(`   Caller: ${caller}`);
        console.warn(`   OrderId: ${orderId}`);
      }
    }

    console.log(`🔍 [StateManager] updateActiveTrade called with orderId: ${orderId}`);
    console.log(`🔍 [StateManager] this.get exists: ${typeof this.get}`);
    console.log(`🔍 [StateManager] this.set exists: ${typeof this.set}`);

    const trades = this.get('activeTrades') || new Map();
    console.log(`🔍 [StateManager] Got trades: ${trades instanceof Map ? 'Map' : typeof trades}`);

    trades.set(orderId, tradeData);
    console.log(`🔍 [StateManager] About to call this.set with activeTrades`);

    this.set('activeTrades', trades);
    // FIX 2026-02-16: REMOVED this.save() - was causing race condition!
    // openPosition() saves AFTER updating BOTH activeTrades AND position atomically
    console.log(`📝 [StateManager] Updated trade ${orderId} (no save - openPosition will save)`);
  }

  /**
   * Remove an active trade
   */
  removeActiveTrade(orderId) {
    const trades = this.get('activeTrades');
    if (trades && trades.has(orderId)) {
      trades.delete(orderId);
      this.set('activeTrades', trades);
      // FIX 2026-02-16: REMOVED this.save() - same race condition fix
      // closePosition() saves AFTER updating BOTH activeTrades AND position atomically
      console.log(`🗑️ [StateManager] Removed trade ${orderId} (no save - closePosition will save)`);
    }
  }

  /**
   * Get all active trades as array
   */
  getAllTrades() {
    const trades = this.get('activeTrades');
    return trades ? Array.from(trades.values()) : [];
  }

  /**
   * Check if state is in sync
   */
  isInSync() {
    const validation = this.validateState();
    if (!validation.valid) {
      console.error('❌ [StateManager] STATE DESYNC DETECTED:', validation.issues);
    }
    return validation.valid;
  }

  /**
   * PHASE 13A: Get bypass violations for analysis
   * Call this after backtest to see which code paths bypassed PositionTracker
   * @returns {Array} List of bypass violations
   */
  getBypassViolations() {
    return this._bypassViolations || [];
  }

  /**
   * PHASE 13A: Clear bypass violations (for fresh test runs)
   */
  clearBypassViolations() {
    this._bypassViolations = [];
  }

  /**
   * PHASE 13B: Check if new entries are halted due to bypass violation
   * @returns {boolean} True if entries halted
   */
  isHalted() {
    return this._haltNewEntries === true;
  }

  /**
   * PHASE 13B: Get halt reason
   * @returns {string|null} Reason for halt or null
   */
  getHaltReason() {
    return this._haltReason || null;
  }

  /**
   * PHASE 13B: Reset halt flag (use with caution - only on bot restart)
   */
  resetHalt() {
    console.warn('[StateManager] HALT FLAG RESET - entries re-enabled');
    this._haltNewEntries = false;
    this._haltReason = null;
  }

  /**
   * PHASE 13B: Register alert listener for bypass violations
   * @param {Function} callback - Called with alert object on violation
   */
  onAlert(callback) {
    this._alertListeners = this._alertListeners || [];
    this._alertListeners.push(callback);
  }

  // === CHANGE 2025-12-13: CRITICAL - MAP SERIALIZATION FOR PERSISTENCE ===

  /**
   * Save state to disk with Map serialization
   */
  save() {
    try {
      // Skip state saving in backtest mode - don't corrupt real state
      if (getConfigValue('mode.backtest')) {
        return;
      }

      const fs = require('fs');
      const path = require('path');
      const dataDir = getConfigValue('paths.dataDir') || path.join(__dirname, '..', 'data');
      const stateFile = getConfigValue('paths.stateFile') || path.join(dataDir, 'state.json');

      // Create data directory if it doesn't exist
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Prepare state for serialization
      const stateToSave = { ...this.state };

      // CRITICAL: Convert Map to Array for JSON serialization
      if (this.state.activeTrades instanceof Map) {
        stateToSave.activeTrades = Array.from(this.state.activeTrades.entries());
      }

      // Save to disk
      fs.writeFileSync(stateFile, JSON.stringify(stateToSave, null, 2));
      console.log('[StateManager] State saved to disk');
    } catch (error) {
      console.error('[StateManager] Failed to save state:', error);
    }
  }

  /**
   * Load state from disk with Map deserialization
   */
  load() {
    try {
      // Skip state loading in backtest mode - start fresh
      if (getConfigValue('mode.backtest')) {
        console.log('[StateManager] BACKTEST_MODE: Starting with clean state');
        return;
      }

      // CHANGE 2026-01-23: Option to start fresh in paper mode
      // Set FRESH_START=true to reset paper trading state on boot
      if (getConfigValue('backtest.freshStart')) {
        console.log('[StateManager] FRESH_START: Resetting to clean $10k state');
        this.state.balance = 10000;
        this.state.totalBalance = 10000;
        this.state.position = 0;
        this.state.positionCount = 0;
        this.state.entryPrice = 0;
        this.state.entryTime = null;
        this.state.inPosition = 0;
        this.state.activeTrades = new Map();
        this.state.tradeCount = 0;
        this.state.dailyTradeCount = 0;
        this.state.realizedPnL = 0;
        this.state.unrealizedPnL = 0;
        this.state.totalPnL = 0;
        this.save(); // Persist the clean state
        return;
      }

      const fs = require('fs');
      const path = require('path');
      const dataDir = getConfigValue('paths.dataDir') || path.join(__dirname, '..', 'data');
      const stateFile = getConfigValue('paths.stateFile') || path.join(dataDir, 'state.json');

      if (fs.existsSync(stateFile)) {
        const savedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

        // CRITICAL: Convert Array back to Map
        if (Array.isArray(savedState.activeTrades)) {
          savedState.activeTrades = new Map(savedState.activeTrades);
        } else if (!savedState.activeTrades) {
          savedState.activeTrades = new Map();
        }

        // Restore state
        this.state = { ...this.state, ...savedState };
        console.log('[StateManager] State loaded from disk');

        // Verify Map restoration
        console.log(`[StateManager] Active trades restored: ${this.state.activeTrades.size} trades`);
      }
    } catch (error) {
      console.error('[StateManager] Failed to load state:', error);
      // Initialize empty Map if load fails
      this.state.activeTrades = new Map();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION: Internal Methods (Lock, Validation, Logging)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate state updates before applying.
   * Throws if updates would create invalid state.
   *
   * @private
   * @param {Object} updates - Proposed state updates
   * @throws {Error} If updates would create negative position or balance
   */
  validateUpdates(updates) {
    // Add validation logic here
    if (updates.position !== undefined && updates.position < 0) {
      throw new Error('Cannot set negative position');
    }
    if (updates.balance !== undefined && updates.balance < 0) {
      throw new Error('Cannot set negative balance');
    }
  }

  /**
   * Log a transaction for debugging/audit purposes.
   * Maintains a rolling window of the last N transactions.
   *
   * @private
   * @param {Object} transaction - Transaction record
   * @param {number} transaction.timestamp - When transaction occurred
   * @param {Object} transaction.updates - What was changed
   * @param {Object} transaction.context - Why it was changed
   * @param {Object} transaction.snapshot - State before change
   */
  logTransaction(transaction) {
    this.transactionLog.push(transaction);
    if (this.transactionLog.length > this.maxLogSize) {
      this.transactionLog.shift();
    }
  }

  /**
   * Acquire exclusive lock for atomic operations.
   * Uses a simple queue-based mutex to ensure only one update runs at a time.
   *
   * @private
   * @async
   * @returns {Promise<void>} Resolves when lock is acquired
   */
  async acquireLock() {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    // Wait for lock to be available
    await new Promise(resolve => {
      this.lockQueue.push(resolve);
    });
    this.locked = true;  // CRITICAL: Must set after wait completes
  }

  releaseLock() {
    if (this.lockQueue.length > 0) {
      const next = this.lockQueue.shift();
      this.locked = false;  // Release lock
      next();  // Wake next waiter
    } else {
      this.locked = false;  // Only release if no queue
    }
  }

  // === LISTENERS ===

  addListener(callback) {
    this.listeners.add(callback);
  }

  removeListener(callback) {
    this.listeners.delete(callback);
  }

  notifyListeners(updates, context) {
    for (const listener of this.listeners) {
      try {
        listener(updates, context, this.getState());
      } catch (error) {
        console.error('[StateManager] Listener error:', error);
      }
    }

    // CHANGE 2025-12-11: Broadcast to dashboard AFTER state changes
    // This ensures dashboard always shows accurate, post-update state
    this.broadcastToDashboard(updates, context);
  }

  // === DASHBOARD INTEGRATION ===
  // CHANGE 2025-12-11: Dashboard gets state AFTER updates, never stale data

  setDashboardWs(ws) {
    this.dashboardWs = ws;
    console.log('[StateManager] Dashboard WebSocket connected');
  }

  broadcastToDashboard(updates, context) {
    if (!this.dashboardWs || this.dashboardWs.readyState !== 1) return;

    try {
      const state = this.getState();
      this.dashboardWs.send(JSON.stringify({
        type: 'state_update',
        source: 'StateManager',
        updates: updates,
        context: context,
        state: {
          position: state.position,
          balance: state.balance,
          totalBalance: state.totalBalance,
          realizedPnL: state.realizedPnL,
          unrealizedPnL: state.unrealizedPnL,
          totalPnL: state.totalPnL,
          tradeCount: state.tradeCount,
          dailyTradeCount: state.dailyTradeCount,
          recoveryMode: state.recoveryMode
        },
        timestamp: Date.now()
      }));
    } catch (error) {
      // Silent fail - don't let dashboard issues affect trading
    }
  }

  // === DEBUGGING ===

  getTransactionLog() {
    return [...this.transactionLog];
  }

  printState() {
    console.log('\n📊 === STATE SNAPSHOT ===');
    console.log(`Position: ${this.state.position} @ ${this.state.entryPrice || 'N/A'}`);
    console.log(`Balance: $${this.state.balance.toFixed(2)} (Total: $${this.state.totalBalance.toFixed(2)})`);
    console.log(`P&L: $${this.state.totalPnL.toFixed(2)} (Realized: $${this.state.realizedPnL.toFixed(2)})`);
    console.log(`Trades: ${this.state.tradeCount} total, ${this.state.dailyTradeCount} today`);
    console.log(`Recovery Mode: ${this.state.recoveryMode}`);
    console.log('======================\n');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: Module Exports (Singleton Pattern)
// ═══════════════════════════════════════════════════════════════════════════

/** @type {StateManager|null} Singleton instance */
let instance = null;

/**
 * Get the singleton StateManager instance.
 * Creates the instance on first call, returns existing on subsequent calls.
 *
 * @function getInstance
 * @returns {StateManager} The singleton StateManager instance
 *
 * @example
 * const { getInstance } = require('./core/StateManager');
 * const stateManager = getInstance();
 * const state = stateManager.getState();
 */
module.exports = {
  getInstance: () => {
    if (!instance) {
      instance = new StateManager();
    }
    return instance;
  },
  /** @type {typeof StateManager} The StateManager class (for testing) */
  StateManager
};