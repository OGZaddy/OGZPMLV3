/**
 * PositionTracker - Sole Writer to Trade Objects
 *
 * Phase 13: Extracted from run-empire-v2.js
 *
 * SINGLE RESPONSIBILITY: Manage trade lifecycle with immutability guarantees.
 * Wraps StateManager.openPosition/closePosition.
 *
 * INVARIANTS (non-negotiable):
 * 1. entryStrategy is WRITE-ONCE. Set at openPosition(), immutable after.
 * 2. Trade identity fields are immutable: entryStrategy, signalId, entryTime, side, entryPrice, orderId
 * 3. Mutable fields: maxProfitPercent, currentPnL, trailingStop, partialFills, exitReason, exitTime, exitPrice
 * 4. If immutable field mutation attempted: halt entries, alert, continue exits only until flat
 *
 * @module core/PositionTracker
 */

'use strict';

const { getInstance: getStateManager } = require('./StateManager');
const PnLCalculator = require('./PnLCalculator');

// Fields that CANNOT be changed after trade creation
const IMMUTABLE_FIELDS = Object.freeze([
  'entryStrategy',
  'signalId',
  'entryTime',
  'entryPrice',
  'side',
  'direction',
  'orderId',
  'exitContract'
]);

// Fields that CAN be patched during trade lifecycle
const MUTABLE_FIELDS = Object.freeze([
  'maxProfitPercent',
  'currentPnL',
  'pnl',
  'pnlDollars',
  'trailingStop',
  'partialFills',
  'exitReason',
  'exitTime',
  'exitPrice',
  'holdDuration',
  'maxProfit'
]);

class PositionTracker {
  constructor(options = {}) {
    this.stateManager = getStateManager();
    this.pnlCalculator = new PnLCalculator(options.pnlOptions);

    // HALT FLAG: Set to true if immutable field mutation attempted
    this.haltNewEntries = false;
    this.haltReason = null;

    // Event listeners for alerts
    this.alertListeners = [];

    console.log('[PositionTracker] Initialized (Phase 13 - immutability enforced, halt-on-mutation)');
  }

  /**
   * Register alert listener for immutable field violations
   */
  onAlert(callback) {
    this.alertListeners.push(callback);
  }

  /**
   * Emit alert when immutable field mutation attempted
   */
  _emitAlert(field, caller) {
    const alert = {
      type: 'IMMUTABLE_FIELD_VIOLATION',
      field,
      caller: caller || 'unknown',
      timestamp: Date.now(),
      message: `Attempted mutation of immutable field '${field}'`
    };

    console.error(`[PositionTracker] INVARIANT VIOLATION: ${alert.message} by ${caller}`);

    for (const listener of this.alertListeners) {
      try {
        listener(alert);
      } catch (err) {
        console.error('[PositionTracker] Alert listener error:', err);
      }
    }
  }

  /**
   * Open a new position
   * Sets all identity fields as WRITE-ONCE (immutable after creation)
   * BLOCKED if haltNewEntries is true
   *
   * @param {Object} params
   * @param {number} params.size - Position size in base currency
   * @param {number} params.price - Entry price
   * @param {string} params.side - 'long' or 'short' (required!)
   * @param {string} params.entryStrategy - Strategy that triggered entry (WRITE-ONCE)
   * @param {Object} params.exitContract - Exit conditions (WRITE-ONCE)
   * @param {Object} [params.metadata] - Additional trade metadata
   * @returns {Promise<Object>} { success, trade, error }
   */
  async openPosition(params) {
    // CHECK HALT FLAG
    if (this.haltNewEntries) {
      console.error(`[PositionTracker] NEW ENTRIES HALTED: ${this.haltReason}`);
      return {
        success: false,
        error: `Entries halted due to invariant violation: ${this.haltReason}`
      };
    }

    const {
      size,
      price,
      side = 'long',
      entryStrategy,
      exitContract,
      metadata = {}
    } = params;

    // Validate required fields
    if (!entryStrategy) {
      return { success: false, error: 'entryStrategy is REQUIRED (Phase 13 invariant)' };
    }

    if (!side || !['long', 'short'].includes(side)) {
      return { success: false, error: `side must be 'long' or 'short', got: ${side}` };
    }

    if (!exitContract) {
      console.warn('[PositionTracker] No exitContract provided - trade will lack exit conditions');
    }

    // Generate unique identifiers
    const orderId = metadata.orderId || `pos_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const signalId = metadata.signalId || `sig_${Date.now()}`;
    const entryTime = metadata.entryTime || Date.now();

    // Create trade object with immutable identity
    const trade = {
      // IMMUTABLE IDENTITY (Phase 13 invariant) - SET ONCE HERE ONLY
      orderId,
      signalId,
      entryStrategy,
      entryTime,
      entryPrice: price,
      side,
      direction: side,
      exitContract: exitContract ? Object.freeze({ ...exitContract }) : null,

      // MUTABLE STATE (can be patched via patchTrade)
      size,
      pnl: 0,
      pnlDollars: 0,
      currentPnL: 0,
      maxProfitPercent: 0,
      maxProfit: 0,
      trailingStop: null,
      partialFills: [],
      exitReason: null,
      exitPrice: null,
      exitTime: null,

      // Metadata (for reference, not enforced immutable)
      action: 'BUY',
      confidence: metadata.confidence || 0,
      patterns: metadata.patterns || [],
      entryIndicators: metadata.entryIndicators || {},
      signalBreakdown: metadata.signalBreakdown || null
    };

    // Delegate to StateManager - ONLY place identity fields get set
    const result = await this.stateManager.openPosition(size, price, {
      ...trade,
      ...metadata
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    console.log(`[PositionTracker] Position OPENED: ${side.toUpperCase()} ${size.toFixed(8)} @ $${price.toFixed(2)} | Strategy: ${entryStrategy}`);

    return {
      success: true,
      trade,
      orderId
    };
  }

  /**
   * Patch mutable trade fields ONLY
   * THROWS and HALTS if trying to patch immutable fields
   *
   * @param {string} orderId - Trade order ID
   * @param {Object} patch - Fields to patch (must be in MUTABLE_FIELDS)
   * @param {string} [caller] - Name of calling module for audit
   * @returns {Object} { success, error }
   */
  patchTrade(orderId, patch, caller = 'unknown') {
    // Check for immutable field violations
    for (const field of Object.keys(patch)) {
      if (IMMUTABLE_FIELDS.includes(field)) {
        // HALT NEW ENTRIES
        this.haltNewEntries = true;
        this.haltReason = `${caller} attempted to mutate immutable field '${field}'`;

        // EMIT ALERT
        this._emitAlert(field, caller);

        // DO NOT CRASH - protect open positions
        // Return error but allow exit loop to continue
        return {
          success: false,
          error: `INVARIANT VIOLATION: Cannot mutate '${field}' - field is WRITE-ONCE`,
          halted: true
        };
      }

      // Validate field is in mutable list
      if (!MUTABLE_FIELDS.includes(field)) {
        console.warn(`[PositionTracker] Unknown field '${field}' from ${caller} - rejecting`);
        return {
          success: false,
          error: `Unknown field '${field}' - not in MUTABLE_FIELDS allowlist`
        };
      }
    }

    // Get trade and apply patch
    const trades = this.stateManager.getAllTrades();
    const trade = trades.find(t => t.orderId === orderId);

    if (!trade) {
      return { success: false, error: `Trade ${orderId} not found` };
    }

    // Apply patch to mutable fields only
    for (const [field, value] of Object.entries(patch)) {
      trade[field] = value;
    }

    return { success: true };
  }

  /**
   * Close a position (full or partial)
   * ALWAYS ALLOWED even when haltNewEntries is true (exit loop must continue)
   *
   * @param {Object} params
   * @param {number} params.price - Exit price
   * @param {string} params.exitReason - Reason for exit (from ExitContractManager)
   * @param {boolean} [params.partial] - Partial close?
   * @param {number} [params.partialSize] - Size to close if partial
   * @param {Object} [params.metadata] - Additional metadata
   * @returns {Promise<Object>} { success, trade, pnl, error }
   */
  async closePosition(params) {
    const {
      price,
      exitReason,
      partial = false,
      partialSize = null,
      metadata = {}
    } = params;

    // Get active trade
    const activeTrades = this.stateManager.getAllTrades()
      .filter(t => t.action === 'BUY')
      .sort((a, b) => a.entryTime - b.entryTime);

    if (activeTrades.length === 0) {
      return { success: false, error: 'No active position to close' };
    }

    const trade = activeTrades[0];
    const side = trade.side || 'long';
    const exitTime = metadata.exitTime || Date.now();

    // Calculate P&L
    const pnlResult = this.pnlCalculator.calculateNetPnL(
      trade.entryPrice,
      price,
      trade.size,
      side
    );

    // Delegate to StateManager
    const result = await this.stateManager.closePosition(
      price,
      partial,
      partialSize,
      { orderId: trade.orderId, exitReason }
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Create completed trade record
    const completedTrade = {
      ...trade,
      exitPrice: price,
      exitTime,
      exitReason: exitReason || 'signal',
      pnl: pnlResult.grossPnLPercent,
      pnlDollars: pnlResult.netPnL,
      holdDuration: exitTime - trade.entryTime
    };

    console.log(`[PositionTracker] Position CLOSED: ${pnlResult.grossPnLPercent >= 0 ? '+' : ''}${pnlResult.grossPnLPercent.toFixed(2)}% | $${pnlResult.netPnL.toFixed(2)} | Reason: ${exitReason}`);

    // If halted and now flat, log status
    if (this.haltNewEntries) {
      const state = this.stateManager.getState();
      if (state.position === 0) {
        console.log('[PositionTracker] Now FLAT after halt - no new entries until restart');
      }
    }

    return {
      success: true,
      trade: completedTrade,
      pnl: pnlResult
    };
  }

  /**
   * Get current position info
   */
  getPositionInfo() {
    const state = this.stateManager.getState();
    const trades = this.stateManager.getAllTrades()
      .filter(t => t.action === 'BUY')
      .sort((a, b) => a.entryTime - b.entryTime);

    const hasPosition = state.position > 0;
    const activeTrade = trades[0] || null;

    return {
      hasPosition,
      position: state.position,
      side: activeTrade?.side || 'long',
      entryPrice: activeTrade?.entryPrice || 0,
      entryStrategy: activeTrade?.entryStrategy || null,
      entryTime: activeTrade?.entryTime || null,
      exitContract: activeTrade?.exitContract || null,
      haltNewEntries: this.haltNewEntries,
      haltReason: this.haltReason
    };
  }

  /**
   * Check if entries are halted
   */
  isHalted() {
    return this.haltNewEntries;
  }

  /**
   * Get P&L calculator instance
   */
  getPnLCalculator() {
    return this.pnlCalculator;
  }

  /**
   * Reset halt flag (use with caution - only on restart)
   */
  resetHalt() {
    console.warn('[PositionTracker] HALT FLAG RESET - entries re-enabled');
    this.haltNewEntries = false;
    this.haltReason = null;
  }

  /**
   * Get READ-ONLY snapshot of a trade (deep frozen)
   * This is the ONLY safe way to read trade data.
   *
   * @param {string} orderId - Trade order ID
   * @returns {Object|null} Deep-frozen trade snapshot or null
   */
  getTradeSnapshot(orderId) {
    const trades = this.stateManager.getAllTrades();
    const trade = trades.find(t => t.orderId === orderId);

    if (!trade) {
      return null;
    }

    // Deep clone and freeze to prevent mutations
    const snapshot = JSON.parse(JSON.stringify(trade));
    return this._deepFreeze(snapshot);
  }

  /**
   * Get READ-ONLY snapshot of the active trade (deep frozen)
   * @returns {Object|null} Deep-frozen active trade snapshot or null
   */
  getActiveTradeSnapshot() {
    const trades = this.stateManager.getAllTrades()
      .filter(t => t.action === 'BUY')
      .sort((a, b) => a.entryTime - b.entryTime);

    if (trades.length === 0) {
      return null;
    }

    // Deep clone and freeze to prevent mutations
    const snapshot = JSON.parse(JSON.stringify(trades[0]));
    return this._deepFreeze(snapshot);
  }

  /**
   * Deep freeze an object and all nested objects
   * @private
   */
  _deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    Object.keys(obj).forEach(key => {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        this._deepFreeze(obj[key]);
      }
    });

    return Object.freeze(obj);
  }
}

module.exports = PositionTracker;
