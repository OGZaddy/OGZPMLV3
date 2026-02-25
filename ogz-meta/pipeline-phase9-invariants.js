#!/usr/bin/env node
/**
 * OGZPrime Pipeline Phase 9: RUNTIME INVARIANT CHECKER
 * =====================================================
 *
 * PURPOSE: Define rules that should ALWAYS be true. Any violation = bug.
 *
 * WHAT THIS CATCHES:
 *   - Impossible states (negative balance, ghost trades, orphan positions)
 *   - Value range violations (confidence > 100%, negative prices)
 *   - State desync (position=0 but activeTrades exists, or vice versa)
 *   - Timestamp anomalies (future dates, backwards time)
 *   - Data integrity issues (NaN, undefined where numbers expected)
 *
 * USAGE:
 *   // Standalone check against StateManager
 *   node ogz-meta/pipeline-phase9-invariants.js
 *
 *   // Import and use in bot loop
 *   const { checkInvariants } = require('./ogz-meta/pipeline-phase9-invariants');
 *   checkInvariants(stateManager, { throw: true }); // throws on violation
 *   checkInvariants(stateManager, { throw: false }); // returns violations array
 *
 *   // Inject into backtest (add to run-empire-v2.js processCandle)
 *   if (process.env.INVARIANT_CHECK === 'true') {
 *     const violations = checkInvariants(this.stateManager, { throw: false });
 *     if (violations.length > 0) console.error('INVARIANT VIOLATIONS:', violations);
 *   }
 *
 * Created: 2026-02-24
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── INVARIANT DEFINITIONS ───────────────────────────────────
// Each invariant: { name, check: (state) => boolean, message }

const INVARIANTS = [
  // ═══ BALANCE INVARIANTS ═══
  {
    name: 'BALANCE_NON_NEGATIVE',
    severity: 'CRITICAL',
    check: (state) => state.balance >= 0,
    message: (state) => `Balance is negative: $${state.balance?.toFixed(2)}`,
  },
  {
    name: 'BALANCE_IS_NUMBER',
    severity: 'CRITICAL',
    check: (state) => typeof state.balance === 'number' && !isNaN(state.balance) && isFinite(state.balance),
    message: (state) => `Balance is not a valid number: ${state.balance} (${typeof state.balance})`,
  },
  {
    name: 'BALANCE_REASONABLE',
    severity: 'WARNING',
    check: (state) => state.balance < 10000000, // $10M sanity check
    message: (state) => `Balance suspiciously high: $${state.balance?.toFixed(2)} — possible overflow or bug`,
  },

  // ═══ POSITION INVARIANTS ═══
  {
    name: 'POSITION_NON_NEGATIVE',
    severity: 'CRITICAL',
    check: (state) => state.position >= 0,
    message: (state) => `Position is negative: ${state.position} — cannot hold negative crypto`,
  },
  {
    name: 'POSITION_IS_NUMBER',
    severity: 'CRITICAL',
    check: (state) => typeof state.position === 'number' && !isNaN(state.position) && isFinite(state.position),
    message: (state) => `Position is not a valid number: ${state.position} (${typeof state.position})`,
  },
  {
    name: 'POSITION_REASONABLE',
    severity: 'WARNING',
    check: (state) => state.position < 100, // 100 BTC sanity check
    message: (state) => `Position suspiciously large: ${state.position} BTC — verify this is intentional`,
  },

  // ═══ POSITION ↔ ACTIVE TRADES SYNC ═══
  {
    name: 'NO_GHOST_TRADES',
    severity: 'CRITICAL',
    check: (state) => {
      const pos = state.position || 0;
      const tradesSize = state.activeTrades instanceof Map
        ? state.activeTrades.size
        : Object.keys(state.activeTrades || {}).length;
      // If position is 0, there should be no active trades
      return !(pos === 0 && tradesSize > 0);
    },
    message: (state) => {
      const tradesSize = state.activeTrades instanceof Map
        ? state.activeTrades.size
        : Object.keys(state.activeTrades || {}).length;
      return `Ghost trades detected: position=0 but activeTrades.size=${tradesSize}`;
    },
  },
  {
    name: 'NO_ORPHAN_POSITION',
    severity: 'CRITICAL',
    check: (state) => {
      const pos = state.position || 0;
      const tradesSize = state.activeTrades instanceof Map
        ? state.activeTrades.size
        : Object.keys(state.activeTrades || {}).length;
      // If position > 0, there should be at least one active trade
      return !(pos > 0 && tradesSize === 0);
    },
    message: (state) => `Orphan position detected: position=${state.position} but no activeTrades`,
  },

  // ═══ ACTIVE TRADE INVARIANTS ═══
  {
    name: 'TRADE_ENTRY_PRICE_POSITIVE',
    severity: 'CRITICAL',
    check: (state) => {
      const trades = state.activeTrades instanceof Map
        ? [...state.activeTrades.values()]
        : Object.values(state.activeTrades || {});
      return trades.every(t => t.entryPrice > 0);
    },
    message: (state) => {
      const trades = state.activeTrades instanceof Map
        ? [...state.activeTrades.values()]
        : Object.values(state.activeTrades || {});
      const bad = trades.find(t => t.entryPrice <= 0);
      return `Trade with invalid entry price: ${bad?.entryPrice} (orderId: ${bad?.orderId})`;
    },
  },
  {
    name: 'TRADE_SIZE_POSITIVE',
    severity: 'CRITICAL',
    check: (state) => {
      const trades = state.activeTrades instanceof Map
        ? [...state.activeTrades.values()]
        : Object.values(state.activeTrades || {});
      return trades.every(t => t.size > 0);
    },
    message: (state) => {
      const trades = state.activeTrades instanceof Map
        ? [...state.activeTrades.values()]
        : Object.values(state.activeTrades || {});
      const bad = trades.find(t => t.size <= 0);
      return `Trade with invalid size: ${bad?.size} (orderId: ${bad?.orderId})`;
    },
  },
  {
    name: 'TRADE_HAS_ENTRY_TIME',
    severity: 'HIGH',
    check: (state) => {
      const trades = state.activeTrades instanceof Map
        ? [...state.activeTrades.values()]
        : Object.values(state.activeTrades || {});
      return trades.every(t => t.entryTime && t.entryTime > 0);
    },
    message: (state) => {
      const trades = state.activeTrades instanceof Map
        ? [...state.activeTrades.values()]
        : Object.values(state.activeTrades || {});
      const bad = trades.find(t => !t.entryTime || t.entryTime <= 0);
      return `Trade missing entryTime: ${bad?.entryTime} (orderId: ${bad?.orderId})`;
    },
  },
  {
    name: 'TRADE_ENTRY_TIME_NOT_FUTURE',
    severity: 'HIGH',
    check: (state, context) => {
      const trades = state.activeTrades instanceof Map
        ? [...state.activeTrades.values()]
        : Object.values(state.activeTrades || {});
      const now = context?.currentTime || Date.now();
      return trades.every(t => !t.entryTime || t.entryTime <= now + 60000); // 1min tolerance
    },
    message: (state, context) => {
      const trades = state.activeTrades instanceof Map
        ? [...state.activeTrades.values()]
        : Object.values(state.activeTrades || {});
      const now = context?.currentTime || Date.now();
      const bad = trades.find(t => t.entryTime > now + 60000);
      return `Trade with future entryTime: ${new Date(bad?.entryTime).toISOString()} (orderId: ${bad?.orderId})`;
    },
  },

  // ═══ CONFIDENCE INVARIANTS ═══
  {
    name: 'CONFIDENCE_IN_RANGE',
    severity: 'HIGH',
    check: (state, context) => {
      const conf = context?.lastConfidence;
      if (conf === undefined || conf === null) return true; // No confidence to check
      return conf >= 0 && conf <= 100;
    },
    message: (state, context) => `Confidence out of range [0-100]: ${context?.lastConfidence}%`,
  },

  // ═══ PRICE INVARIANTS ═══
  {
    name: 'PRICE_POSITIVE',
    severity: 'CRITICAL',
    check: (state, context) => {
      const price = context?.currentPrice;
      if (price === undefined || price === null) return true;
      return price > 0;
    },
    message: (state, context) => `Current price is not positive: $${context?.currentPrice}`,
  },
  {
    name: 'PRICE_IS_NUMBER',
    severity: 'CRITICAL',
    check: (state, context) => {
      const price = context?.currentPrice;
      if (price === undefined || price === null) return true;
      return typeof price === 'number' && !isNaN(price) && isFinite(price);
    },
    message: (state, context) => `Current price is not a valid number: ${context?.currentPrice}`,
  },
  {
    name: 'PRICE_REASONABLE',
    severity: 'WARNING',
    check: (state, context) => {
      const price = context?.currentPrice;
      if (price === undefined || price === null) return true;
      // BTC sanity: between $1,000 and $1,000,000
      return price > 1000 && price < 1000000;
    },
    message: (state, context) => `Price outside reasonable BTC range: $${context?.currentPrice}`,
  },

  // ═══ PNL INVARIANTS ═══
  {
    name: 'DAILY_PNL_REASONABLE',
    severity: 'WARNING',
    check: (state) => {
      const pnl = state.dailyPnL;
      if (pnl === undefined || pnl === null) return true;
      const balance = state.balance || 10000;
      // Daily PnL shouldn't exceed ±50% of balance
      return Math.abs(pnl) < balance * 0.5;
    },
    message: (state) => `Daily PnL seems extreme: $${state.dailyPnL?.toFixed(2)} (balance: $${state.balance?.toFixed(2)})`,
  },

  // ═══ TRADE COUNT INVARIANTS ═══
  {
    name: 'TOTAL_TRADES_NON_NEGATIVE',
    severity: 'HIGH',
    check: (state) => {
      const total = state.totalTrades;
      if (total === undefined || total === null) return true;
      return total >= 0;
    },
    message: (state) => `Total trades is negative: ${state.totalTrades}`,
  },
  {
    name: 'WIN_RATE_IN_RANGE',
    severity: 'HIGH',
    check: (state) => {
      const wr = state.winRate;
      if (wr === undefined || wr === null) return true;
      return wr >= 0 && wr <= 1;
    },
    message: (state) => `Win rate out of range [0-1]: ${state.winRate}`,
  },

  // ═══ EXIT CONTRACT INVARIANTS ═══
  {
    name: 'TRADE_EXIT_CONTRACT_VALID',
    severity: 'HIGH',
    check: (state) => {
      const trades = state.activeTrades instanceof Map
        ? [...state.activeTrades.values()]
        : Object.values(state.activeTrades || {});
      return trades.every(t => {
        if (!t.exitContract) return true; // No contract is OK
        const ec = t.exitContract;
        // SL should be negative or zero, TP should be positive
        const slOk = ec.stopLossPercent === undefined || ec.stopLossPercent <= 0;
        const tpOk = ec.takeProfitPercent === undefined || ec.takeProfitPercent > 0;
        return slOk && tpOk;
      });
    },
    message: (state) => {
      const trades = state.activeTrades instanceof Map
        ? [...state.activeTrades.values()]
        : Object.values(state.activeTrades || {});
      const bad = trades.find(t => {
        if (!t.exitContract) return false;
        const ec = t.exitContract;
        return (ec.stopLossPercent !== undefined && ec.stopLossPercent > 0) ||
               (ec.takeProfitPercent !== undefined && ec.takeProfitPercent <= 0);
      });
      return `Trade with invalid exit contract: SL=${bad?.exitContract?.stopLossPercent}, TP=${bad?.exitContract?.takeProfitPercent} (orderId: ${bad?.orderId})`;
    },
  },

  // ═══ POSITION SIZE CONSISTENCY ═══
  {
    name: 'POSITION_MATCHES_TRADE_SIZES',
    severity: 'HIGH',
    check: (state) => {
      const pos = state.position || 0;
      if (pos === 0) return true; // No position to check

      const trades = state.activeTrades instanceof Map
        ? [...state.activeTrades.values()]
        : Object.values(state.activeTrades || {});

      if (trades.length === 0) return true; // Handled by NO_ORPHAN_POSITION

      const totalSize = trades.reduce((sum, t) => sum + (t.size || 0), 0);
      // Allow 0.01% tolerance for floating point
      return Math.abs(pos - totalSize) < pos * 0.0001;
    },
    message: (state) => {
      const trades = state.activeTrades instanceof Map
        ? [...state.activeTrades.values()]
        : Object.values(state.activeTrades || {});
      const totalSize = trades.reduce((sum, t) => sum + (t.size || 0), 0);
      return `Position (${state.position}) doesn't match sum of trade sizes (${totalSize})`;
    },
  },
];

// ─── CHECK FUNCTION ──────────────────────────────────────────

/**
 * Check all invariants against current state
 * @param {Object} stateManager - StateManager instance or state object
 * @param {Object} options - { throw: boolean, context: { currentPrice, currentTime, lastConfidence } }
 * @returns {Array} violations - Array of { name, severity, message }
 */
function checkInvariants(stateManager, options = {}) {
  const { throw: shouldThrow = false, context = {} } = options;

  // Get state (support both StateManager instance and plain object)
  const state = typeof stateManager?.getState === 'function'
    ? stateManager.getState()
    : stateManager;

  if (!state) {
    const error = { name: 'NO_STATE', severity: 'CRITICAL', message: 'State is null/undefined' };
    if (shouldThrow) throw new Error(`INVARIANT VIOLATION: ${error.message}`);
    return [error];
  }

  const violations = [];

  for (const invariant of INVARIANTS) {
    try {
      const passed = invariant.check(state, context);
      if (!passed) {
        const violation = {
          name: invariant.name,
          severity: invariant.severity,
          message: invariant.message(state, context),
        };
        violations.push(violation);

        if (shouldThrow && invariant.severity === 'CRITICAL') {
          throw new Error(`INVARIANT VIOLATION [${invariant.name}]: ${violation.message}`);
        }
      }
    } catch (e) {
      if (e.message.startsWith('INVARIANT VIOLATION')) throw e;
      // Invariant check itself failed
      violations.push({
        name: invariant.name,
        severity: 'ERROR',
        message: `Invariant check failed: ${e.message}`,
      });
    }
  }

  return violations;
}

/**
 * Create a middleware that checks invariants every candle
 * @param {Object} stateManager
 * @param {Object} options
 * @returns {Function} middleware to call on each candle
 */
function createInvariantMiddleware(stateManager, options = {}) {
  const { onViolation = console.error, stopOnCritical = true } = options;
  let violationCount = 0;

  return function checkOnCandle(candle) {
    const context = {
      currentPrice: candle?.c || candle?.close,
      currentTime: candle?.t || candle?.timestamp || Date.now(),
    };

    const violations = checkInvariants(stateManager, { throw: false, context });

    if (violations.length > 0) {
      violationCount += violations.length;

      for (const v of violations) {
        onViolation(`[INVARIANT ${v.severity}] ${v.name}: ${v.message}`);
      }

      const hasCritical = violations.some(v => v.severity === 'CRITICAL');
      if (hasCritical && stopOnCritical) {
        throw new Error(`CRITICAL INVARIANT VIOLATION — stopping execution`);
      }
    }

    return violations;
  };
}

// ─── STANDALONE EXECUTION ────────────────────────────────────

if (require.main === module) {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  OGZPrime Phase 9: RUNTIME INVARIANT CHECKER                 ║');
  console.log('║  "Rules that should ALWAYS be true"                          ║');
  console.log(`║  ${new Date().toISOString().padEnd(61)}║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // Try to load StateManager and check current state
  const ROOT = path.resolve(__dirname, '..');

  try {
    const StateManager = require(path.join(ROOT, 'core/StateManager'));
    const stateManager = StateManager.getInstance ? StateManager.getInstance() : new StateManager();

    console.log('📊 Checking current state against invariants...\n');

    const violations = checkInvariants(stateManager, { throw: false });

    if (violations.length === 0) {
      console.log('✅ All invariants passed!\n');
    } else {
      console.log(`❌ ${violations.length} invariant violation(s) found:\n`);
      for (const v of violations) {
        const icon = v.severity === 'CRITICAL' ? '🔴' : v.severity === 'HIGH' ? '🟠' : '🟡';
        console.log(`  ${icon} [${v.severity}] ${v.name}`);
        console.log(`     ${v.message}\n`);
      }
    }

    // Print invariant list
    console.log('═'.repeat(65));
    console.log('  INVARIANT DEFINITIONS');
    console.log('═'.repeat(65));

    const bySeverity = { CRITICAL: [], HIGH: [], WARNING: [] };
    for (const inv of INVARIANTS) {
      bySeverity[inv.severity]?.push(inv.name) || bySeverity.WARNING.push(inv.name);
    }

    console.log(`\n  🔴 CRITICAL (${bySeverity.CRITICAL.length}):`);
    bySeverity.CRITICAL.forEach(n => console.log(`     - ${n}`));

    console.log(`\n  🟠 HIGH (${bySeverity.HIGH.length}):`);
    bySeverity.HIGH.forEach(n => console.log(`     - ${n}`));

    console.log(`\n  🟡 WARNING (${bySeverity.WARNING.length}):`);
    bySeverity.WARNING.forEach(n => console.log(`     - ${n}`));

    console.log(`\n  Total: ${INVARIANTS.length} invariants defined\n`);

  } catch (e) {
    console.log('⚠️  Could not load StateManager:', e.message);
    console.log('   Run this during bot execution or backtest for live checking.\n');

    // Still print invariant definitions
    console.log('═'.repeat(65));
    console.log('  INVARIANT DEFINITIONS');
    console.log('═'.repeat(65));
    console.log(`\n  Total: ${INVARIANTS.length} invariants\n`);
    INVARIANTS.forEach(inv => {
      const icon = inv.severity === 'CRITICAL' ? '🔴' : inv.severity === 'HIGH' ? '🟠' : '🟡';
      console.log(`  ${icon} ${inv.name}`);
    });
    console.log('');
  }

  // Usage instructions
  console.log('═'.repeat(65));
  console.log('  USAGE');
  console.log('═'.repeat(65));
  console.log(`
  // In backtest or live bot:
  const { checkInvariants, createInvariantMiddleware } = require('./ogz-meta/pipeline-phase9-invariants');

  // Option 1: Check on demand
  const violations = checkInvariants(stateManager, { throw: false });

  // Option 2: Middleware for every candle
  const checkCandle = createInvariantMiddleware(stateManager, {
    onViolation: console.error,
    stopOnCritical: true  // throw on CRITICAL violations
  });
  // In processCandle:
  checkCandle(candle);

  // Option 3: Enable via env var
  // INVARIANT_CHECK=true node run-empire-v2.js
`);
}

// ─── EXPORTS ─────────────────────────────────────────────────

module.exports = {
  checkInvariants,
  createInvariantMiddleware,
  INVARIANTS,
};
