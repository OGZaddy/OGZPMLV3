/**
 * ContractValidator - Phase 0 of Modular Architecture Refactor
 *
 * PURPOSE: Validates data contracts at every module boundary.
 * Silent corruption is impossible - contracts scream when violated.
 *
 * This module has ZERO behavioral impact. It only adds validation.
 * Extract first, use everywhere.
 *
 * @see ogz-meta/REFACTOR-PLAN-2026-02-27.md
 */

// FIX: Use CandleHelper for format compatibility (Kraken vs standard candle format)
const { c: _c, o: _o, h: _h, l: _l, v: _v, t: _t } = require('./CandleHelper');

class ContractViolation extends Error {
  constructor(message, field, value, expected) {
    super(`CONTRACT VIOLATION: ${message}`);
    this.name = 'ContractViolation';
    this.field = field;
    this.value = value;
    this.expected = expected;
    this.timestamp = Date.now();
  }
}

class ContractValidator {
  constructor(options = {}) {
    this.strict = options.strict !== false; // Default to strict mode
    this.logViolations = options.logViolations !== false;
    this.throwOnViolation = options.throwOnViolation !== false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INDICATOR VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validates the canonical Indicators object from IndicatorSnapshot
   *
   * What this catches:
   * - Bug 1 (ATR not normalized): atrNormalized must be 0-1
   * - Bug 4 (BB bandwidth missing): bandwidth must be defined
   * - Bug 5/P1 (RSI format mismatch): rsi must be 0-100
   * - Silent NaN corruption: all numbers checked for NaN
   */
  validateIndicators(indicators) {
    if (!indicators || typeof indicators !== 'object') {
      this._violation('indicators', indicators, 'object', 'indicators must be an object');
      return false;
    }

    let valid = true;

    // === PRICE CONTEXT ===
    valid = this.assertPositive('price', indicators.price) && valid;

    // === MOMENTUM ===
    valid = this.assertRange('rsi', indicators.rsi, 0, 100) && valid;
    valid = this.assertRange('rsiNormalized', indicators.rsiNormalized, 0, 1) && valid;

    // === VOLATILITY ===
    valid = this.assertPositive('atr', indicators.atr) && valid;
    valid = this.assertRange('atrPercent', indicators.atrPercent, 0, 100) && valid;
    valid = this.assertRange('atrNormalized', indicators.atrNormalized, 0, 1) && valid;

    // === BOLLINGER BANDS ===
    if (indicators.bb) {
      valid = this.assertPositive('bb.upper', indicators.bb.upper) && valid;
      valid = this.assertPositive('bb.middle', indicators.bb.middle) && valid;
      valid = this.assertPositive('bb.lower', indicators.bb.lower) && valid;
      valid = this.assertRange('bb.percentB', indicators.bb.percentB, 0, 1) && valid;
      valid = this.assertRange('bb.bandwidth', indicators.bb.bandwidth, 0, 100) && valid;
    }

    // === DERIVED ===
    valid = this.assertRange('volatilityNormalized', indicators.volatilityNormalized, 0, 1) && valid;

    // === TREND ===
    if (indicators.trend !== undefined) {
      valid = this.assertEnum('trend', indicators.trend, ['uptrend', 'downtrend', 'neutral']) && valid;
    }

    return valid;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SIGNAL VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validates Signal objects at module boundaries
   *
   * CONFIDENCE STANDARD: 0-100 at ALL boundaries, no exceptions.
   * Internal calculations can use 0-1, but must convert before returning.
   */
  validateSignal(signal) {
    if (!signal || typeof signal !== 'object') {
      this._violation('signal', signal, 'object', 'signal must be an object');
      return false;
    }

    let valid = true;

    // Confidence: THE critical check - must be 0-100
    valid = this.assertRange('confidence', signal.confidence, 0, 100) && valid;

    // Action enum
    valid = this.assertEnum('action', signal.action, ['BUY', 'SELL', 'HOLD']) && valid;

    // Price fields (only validate if action is BUY or SELL)
    if (signal.action === 'BUY' || signal.action === 'SELL') {
      valid = this.assertPositive('entryPrice', signal.entryPrice) && valid;
      valid = this.assertPositive('stopLoss', signal.stopLoss) && valid;
      valid = this.assertPositive('takeProfit', signal.takeProfit) && valid;
    }

    // Strategy name
    valid = this.assertDefined('strategy', signal.strategy) && valid;

    return valid;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRADE VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validates Trade objects
   *
   * MUTATION RULES:
   * - ONLY PositionTracker can modify Trade objects
   * - All other modules treat Trade as READ-ONLY
   */
  validateTrade(trade) {
    if (!trade || typeof trade !== 'object') {
      this._violation('trade', trade, 'object', 'trade must be an object');
      return false;
    }

    let valid = true;

    valid = this.assertDefined('id', trade.id) && valid;
    valid = this.assertEnum('side', trade.side, ['buy', 'sell']) && valid;
    valid = this.assertPositive('entryPrice', trade.entryPrice) && valid;
    valid = this.assertPositive('size', trade.size) && valid;

    // maxProfitPercent can be negative (underwater trade)
    if (trade.maxProfitPercent !== undefined) {
      valid = this.assertRange('maxProfitPercent', trade.maxProfitPercent, -100, 1000) && valid;
    }

    return valid;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXIT CONTEXT VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validates ExitContext objects passed to ExitDecider
   */
  validateExitContext(context) {
    if (!context || typeof context !== 'object') {
      this._violation('context', context, 'object', 'exit context must be an object');
      return false;
    }

    let valid = true;

    valid = this.assertDefined('trade', context.trade) && valid;
    valid = this.assertPositive('currentPrice', context.currentPrice) && valid;
    valid = this.assertNumber('timeHeldMinutes', context.timeHeldMinutes) && valid;

    return valid;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXIT CONTRACT VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validates ExitContract objects
   */
  validateExitContract(exitContract) {
    if (!exitContract || typeof exitContract !== 'object') {
      this._violation('exitContract', exitContract, 'object', 'exitContract must be an object');
      return false;
    }

    let valid = true;

    valid = this.assertRange('stopLossPercent', exitContract.stopLossPercent, 0, 100) && valid;
    valid = this.assertRange('takeProfitPercent', exitContract.takeProfitPercent, 0, 100) && valid;
    valid = this.assertRange('trailingStopPercent', exitContract.trailingStopPercent, 0, 100) && valid;
    valid = this.assertPositive('maxHoldTimeMinutes', exitContract.maxHoldTimeMinutes) && valid;

    return valid;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CANDLE VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validates OHLCV candle objects
   * Uses CandleHelper for format compatibility (supports both Kraken and standard format)
   */
  validateCandle(candle) {
    if (!candle || typeof candle !== 'object') {
      this._violation('candle', candle, 'object', 'candle must be an object');
      return false;
    }

    // Extract values using CandleHelper for format compatibility
    const timestamp = _t(candle);
    const open = _o(candle);
    const high = _h(candle);
    const low = _l(candle);
    const close = _c(candle);
    const volume = _v(candle);

    let valid = true;

    valid = this.assertPositive('timestamp', timestamp) && valid;
    valid = this.assertPositive('open', open) && valid;
    valid = this.assertPositive('high', high) && valid;
    valid = this.assertPositive('low', low) && valid;
    valid = this.assertPositive('close', close) && valid;
    valid = this.assertNumber('volume', volume) && valid;

    // Sanity checks
    if (valid) {
      if (high < low) {
        this._violation('candle.high/low', `high=${high}, low=${low}`,
          'high >= low', 'candle high must be >= low');
        valid = false;
      }
      if (high < open || high < close) {
        this._violation('candle.high', high,
          '>= open and close', 'candle high must be >= open and close');
        valid = false;
      }
      if (low > open || low > close) {
        this._violation('candle.low', low,
          '<= open and close', 'candle low must be <= open and close');
        valid = false;
      }
    }

    return valid;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER METHODS - THE CORE ASSERTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Assert value is within range [min, max]
   * CRITICAL: typeof check FIRST - undefined/null/NaN slip through range comparisons
   */
  assertRange(field, value, min, max) {
    // CRITICAL: typeof check FIRST - undefined/null/NaN slip through range comparisons
    if (typeof value !== 'number' || isNaN(value)) {
      this._violation(field, value, `number in range ${min}-${max}`,
        `${field} must be a number, got ${typeof value}: ${value}`);
      return false;
    }
    if (value < min || value > max) {
      this._violation(field, value, `${min}-${max}`,
        `${field} must be ${min}-${max}, got ${value}`);
      return false;
    }
    return true;
  }

  /**
   * Assert value is a positive number (> 0)
   */
  assertPositive(field, value) {
    if (typeof value !== 'number' || isNaN(value)) {
      this._violation(field, value, 'positive number',
        `${field} must be a positive number, got ${typeof value}: ${value}`);
      return false;
    }
    if (value <= 0) {
      this._violation(field, value, '> 0',
        `${field} must be positive, got ${value}`);
      return false;
    }
    return true;
  }

  /**
   * Assert value is a number (can be zero or negative)
   */
  assertNumber(field, value) {
    if (typeof value !== 'number' || isNaN(value)) {
      this._violation(field, value, 'number',
        `${field} must be a number, got ${typeof value}: ${value}`);
      return false;
    }
    return true;
  }

  /**
   * Assert value is defined (not null or undefined)
   */
  assertDefined(field, value) {
    if (value === undefined || value === null) {
      this._violation(field, value, 'defined',
        `${field} is required, got ${value}`);
      return false;
    }
    return true;
  }

  /**
   * Assert value is one of allowed values
   */
  assertEnum(field, value, allowed) {
    if (!allowed.includes(value)) {
      this._violation(field, value, `one of [${allowed.join(', ')}]`,
        `${field} must be one of [${allowed.join(', ')}], got ${value}`);
      return false;
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VIOLATION HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  _violation(field, value, expected, message) {
    const violation = new ContractViolation(message, field, value, expected);

    if (this.logViolations) {
      console.error(`[CONTRACT] ${message}`);
    }

    if (this.throwOnViolation && this.strict) {
      throw violation;
    }

    return violation;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a non-throwing validator for logging/monitoring
   */
  static createMonitor(options = {}) {
    return new ContractValidator({
      ...options,
      throwOnViolation: false,
      logViolations: true
    });
  }

  /**
   * Create a strict validator that throws on any violation
   */
  static createStrict(options = {}) {
    return new ContractValidator({
      ...options,
      throwOnViolation: true,
      strict: true
    });
  }
}

module.exports = { ContractValidator, ContractViolation };
