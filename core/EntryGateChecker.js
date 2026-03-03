/**
 * EntryGateChecker - Pre-Entry Gate Validation
 *
 * SINGLE RESPONSIBILITY: Run ALL pre-entry checks BEFORE order execution.
 * Extracted from run-empire-v2.js as part of Phase 9 modular refactor.
 *
 * BUG FIX: Previously gates ran AFTER executeTrade() - orders were already
 * on the exchange before we checked if we should have traded.
 *
 * @module core/EntryGateChecker
 */

'use strict';

class EntryGateChecker {
  constructor(dependencies = {}) {
    this.riskManager = dependencies.riskManager;
    this.tradingBrain = dependencies.tradingBrain;
    this.stateManager = dependencies.stateManager;
    this.tierFlags = dependencies.tierFlags || {};

    console.log('[EntryGateChecker] Initialized (Phase 9 - gate ordering fix)');
  }

  /**
   * Update dependencies (for late binding)
   */
  setDependencies(deps) {
    if (deps.riskManager) this.riskManager = deps.riskManager;
    if (deps.tradingBrain) this.tradingBrain = deps.tradingBrain;
    if (deps.stateManager) this.stateManager = deps.stateManager;
    if (deps.tierFlags) this.tierFlags = deps.tierFlags;
  }

  /**
   * Run ALL pre-entry gate checks
   * MUST be called BEFORE any order execution
   *
   * @param {Object} params - { confidence, price, indicators, patterns }
   * @returns {Object} - { pass: boolean, failedGates: string[], riskLevel: string }
   */
  check(params = {}) {
    const { confidence = 0, price = 0, indicators = {}, patterns = [] } = params;
    const failedGates = [];
    let riskLevel = 'LOW';

    // Gate 1: Position/ActiveTrades desync guard
    const desyncResult = this._checkDesyncGuard();
    if (!desyncResult.pass) {
      failedGates.push(desyncResult.reason);
      return { pass: false, failedGates, riskLevel: 'CRITICAL', blockType: 'DESYNC' };
    }

    // Gate 2: Account drawdown block
    const drawdownResult = this._checkDrawdownBlock();
    if (!drawdownResult.pass) {
      failedGates.push(drawdownResult.reason);
      return { pass: false, failedGates, riskLevel: 'HIGH', blockType: 'DRAWDOWN' };
    }

    // Gate 3: Risk limits (daily/weekly/monthly loss, emergency stop)
    if (this.tradingBrain) {
      const riskCheck = this.tradingBrain.checkRiskLimits();
      if (riskCheck.halt) {
        failedGates.push(`risk_limits: ${riskCheck.reason}`);
        return { pass: false, failedGates, riskLevel: 'HIGH', blockType: 'RISK_LIMIT' };
      }
    }

    // Gate 4: Position limits (max concurrent positions per tier)
    if (this.tradingBrain && this.stateManager) {
      const activeTrades = this.stateManager.get('activeTrades');
      const positionCount = activeTrades?.size || 0;
      if (!this.tradingBrain.canOpenNewPosition(positionCount, this.tierFlags)) {
        failedGates.push(`position_limit: Max positions (${positionCount})`);
        return { pass: false, failedGates, riskLevel: 'MEDIUM', blockType: 'POSITION_LIMIT' };
      }
    }

    // Gate 5: Comprehensive risk assessment
    if (this.riskManager) {
      const riskAssessment = this.riskManager.assessTradeRisk({
        direction: 'BUY',
        entryPrice: price,
        confidence: confidence,
        marketData: indicators,
        patterns: patterns
      });

      if (!riskAssessment.approved) {
        failedGates.push(`risk_assessment: ${riskAssessment.reason}`);
        return { pass: false, failedGates, riskLevel: riskAssessment.riskLevel, blockType: 'RISK_ASSESSMENT' };
      }

      riskLevel = riskAssessment.riskLevel || 'LOW';
    }

    // All gates passed
    return {
      pass: true,
      failedGates: [],
      riskLevel,
      blockType: null
    };
  }

  /**
   * Gate 1: Check for position/activeTrades desync
   * Bug: position=0 but activeTrades exists = zombie trades
   */
  _checkDesyncGuard() {
    if (!this.stateManager) {
      return { pass: true, reason: null };
    }

    const pos = this.stateManager.get('position');
    const activeTrades = this.stateManager.get('activeTrades');
    const hasActiveTrades = activeTrades &&
      (activeTrades instanceof Map ? activeTrades.size > 0 : activeTrades.length > 0);

    if (pos === 0 && hasActiveTrades) {
      return {
        pass: false,
        reason: 'position_desync: position=0 but activeTrades exists'
      };
    }

    return { pass: true, reason: null };
  }

  /**
   * Gate 2: Check account drawdown
   * Block new entries when account is down significantly
   */
  _checkDrawdownBlock() {
    if (!this.stateManager) {
      return { pass: true, reason: null };
    }

    const currentBalance = this.stateManager.get('balance') || 10000;
    const initialBalance = this.stateManager.get('initialBalance') || 10000;
    const accountDrawdown = ((currentBalance - initialBalance) / initialBalance) * 100;

    if (accountDrawdown <= -10) {
      return {
        pass: false,
        reason: `drawdown_block: Account ${accountDrawdown.toFixed(1)}% down`
      };
    }

    return { pass: true, reason: null };
  }
}

module.exports = EntryGateChecker;
