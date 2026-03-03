/**
 * EntryDecider - Entry Decision Orchestrator
 *
 * SINGLE RESPONSIBILITY: Orchestrate entry decisions by combining
 * signal analysis with gate validation.
 *
 * Extracted from run-empire-v2.js as part of Phase 9 modular refactor.
 *
 * KEY FIX: EntryGateChecker MUST be called BEFORE returning enter=true.
 * Previously gates ran after execution - this fixes that critical bug.
 *
 * @module core/EntryDecider
 */

'use strict';

const EntryGateChecker = require('./EntryGateChecker');

class EntryDecider {
  constructor(dependencies = {}) {
    this.gateChecker = new EntryGateChecker(dependencies);
    this.stateManager = dependencies.stateManager;

    console.log('[EntryDecider] Initialized (Phase 9 - gate ordering fix)');
  }

  /**
   * Update dependencies (for late binding)
   */
  setDependencies(deps) {
    this.gateChecker.setDependencies(deps);
    if (deps.stateManager) this.stateManager = deps.stateManager;
  }

  /**
   * Decide whether to enter a trade
   * Runs gate checks BEFORE approving entry
   *
   * @param {Object} signal - { action, confidence, direction, ... }
   * @param {Object} context - { price, indicators, patterns, positionSize }
   * @returns {Object} - { enter: boolean, signal, reason, positionSize, riskLevel }
   */
  decide(signal, context = {}) {
    const { price = 0, indicators = {}, patterns = [], positionSize = 0 } = context;

    // If signal isn't a BUY, pass through (no gates needed for HOLD/SELL)
    if (!signal || signal.action !== 'BUY') {
      return {
        enter: false,
        signal,
        reason: signal?.action === 'HOLD' ? 'hold_signal' : 'not_buy_signal',
        positionSize: 0,
        riskLevel: 'N/A'
      };
    }

    // Run ALL gate checks BEFORE approving entry
    const gateResult = this.gateChecker.check({
      confidence: signal.confidence,
      price,
      indicators,
      patterns
    });

    if (!gateResult.pass) {
      console.log(`[EntryDecider] BLOCKED: ${gateResult.failedGates.join(', ')}`);
      return {
        enter: false,
        signal,
        reason: gateResult.failedGates[0] || 'gate_check_failed',
        positionSize: 0,
        riskLevel: gateResult.riskLevel,
        blockType: gateResult.blockType,
        failedGates: gateResult.failedGates
      };
    }

    // All gates passed - approve entry
    console.log(`[EntryDecider] APPROVED: All gates passed (risk: ${gateResult.riskLevel})`);
    return {
      enter: true,
      signal,
      reason: 'all_gates_passed',
      positionSize,
      riskLevel: gateResult.riskLevel
    };
  }

  /**
   * Get the underlying gate checker for direct access
   */
  getGateChecker() {
    return this.gateChecker;
  }
}

module.exports = EntryDecider;
