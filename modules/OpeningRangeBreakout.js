// modules/OpeningRangeBreakout.js
'use strict';

const { c: _c, o: _o, h: _h, l: _l, v: _v, t: _t } = require('../core/CandleHelper');
const FairValueGapDetector = require('./FairValueGapDetector');
const TradingConfig = require('../core/TradingConfig');

/**
 * OpeningRangeBreakout (ORB) Strategy
 *
 * Implements Trey's ICT-style Opening Range + FVG entry system.
 * This is a SESSION-BASED strategy that tracks state across candles.
 *
 * STATE MACHINE:
 * 1. WAITING_FOR_OPEN → Wait for session open (first 15-min candle after session start)
 * 2. WATCHING_FOR_BREAK → OR defined. Watch for breakout (close beyond OR high/low)
 * 3. WATCHING_FOR_FVG → Breakout detected. Scan for FVG in breakout direction
 * 4. SIGNAL_READY → FVG found. Return signal with LIMIT entry hint
 * 5. DONE → Signal consumed. Wait for next session
 *
 * Source: ogz-meta/ledger/opening-range-fvg-spec.md
 *
 * @module modules/OpeningRangeBreakout
 */

const STATES = {
  WAITING_FOR_OPEN: 'WAITING_FOR_OPEN',
  WATCHING_FOR_BREAK: 'WATCHING_FOR_BREAK',
  WATCHING_FOR_FVG: 'WATCHING_FOR_FVG',
  SIGNAL_READY: 'SIGNAL_READY',
  DONE: 'DONE',
};

class OpeningRangeBreakout {
  constructor(config = {}) {
    // Read from TradingConfig with fallbacks
    const orbConfig = TradingConfig.get('strategies.OpeningRangeBreakout') || {};

    this.sessionOpenHourUTC = config.sessionOpenHourUTC ?? orbConfig.sessionOpenHourUTC ?? 14; // 9am EST = 14:00 UTC
    this.orDurationMinutes = config.orDurationMinutes ?? orbConfig.orDurationMinutes ?? 15;
    this.fvgScanBars = config.fvgScanBars ?? orbConfig.fvgScanBars ?? 10;
    this.minFVGPercent = config.minFVGPercent ?? orbConfig.minFVGPercent ?? 0.05;
    this.maxFVGPercent = config.maxFVGPercent ?? orbConfig.maxFVGPercent ?? 2.0;
    this.entryLevel = config.entryLevel ?? orbConfig.entryLevel ?? 'top'; // 'top', 'middle', 'bottom'
    this.stopBufferPct = config.stopBufferPct ?? orbConfig.stopBufferPct ?? 0.05;
    this.targetRR = config.targetRR ?? orbConfig.targetRR ?? 2.0;

    // State
    this.state = STATES.WAITING_FOR_OPEN;
    this.currentSessionDate = null;
    this.openingRange = null;     // { high, low, timestamp }
    this.breakoutDirection = null; // 'bullish' or 'bearish'
    this.pendingSignal = null;
    this.recentCandles = [];      // Rolling buffer for FVG scan

    // FVG detector instance
    this.fvgDetector = new FairValueGapDetector({
      minFVGPercent: this.minFVGPercent,
      maxFVGPercent: this.maxFVGPercent,
    });

    console.log(`[ORB] Initialized: session=${this.sessionOpenHourUTC}:00 UTC, OR=${this.orDurationMinutes}min, entry=${this.entryLevel}`);
  }

  /**
   * Reset for new session
   */
  reset() {
    this.state = STATES.WAITING_FOR_OPEN;
    this.openingRange = null;
    this.breakoutDirection = null;
    this.pendingSignal = null;
    this.recentCandles = [];
  }

  /**
   * Main update - feed each new candle through the state machine.
   *
   * @param {Object} candle - OHLCV candle { o, h, l, c, v, t }
   * @returns {Object|null} Signal if ready, null otherwise
   */
  update(candle) {
    if (!candle || !_t(candle)) return null;

    const timestamp = _t(candle);
    const candleDate = new Date(timestamp);
    const sessionDate = this._getSessionDate(candleDate);

    // New session? Reset state machine
    if (sessionDate !== this.currentSessionDate) {
      this.reset();
      this.currentSessionDate = sessionDate;
    }

    // Track recent candles for FVG scanning
    this.recentCandles.push(candle);
    if (this.recentCandles.length > this.fvgScanBars + 5) {
      this.recentCandles.shift();
    }

    // State machine dispatch
    switch (this.state) {
      case STATES.WAITING_FOR_OPEN:
        return this._handleWaitingForOpen(candle, candleDate);

      case STATES.WATCHING_FOR_BREAK:
        return this._handleWatchingForBreak(candle);

      case STATES.WATCHING_FOR_FVG:
        return this._handleWatchingForFVG(candle);

      case STATES.SIGNAL_READY:
        // Signal already pending - return it
        return this.pendingSignal;

      case STATES.DONE:
        // Wait for next session
        return null;

      default:
        return null;
    }
  }

  /**
   * Check if this candle marks the session open.
   * @private
   */
  _handleWaitingForOpen(candle, candleDate) {
    const hour = candleDate.getUTCHours();
    const minute = candleDate.getUTCMinutes();

    // Is this the first candle of the OR period?
    if (hour === this.sessionOpenHourUTC && minute < this.orDurationMinutes) {
      // First 15-min candle defines the Opening Range
      this.openingRange = {
        high: _h(candle),
        low: _l(candle),
        timestamp: _t(candle),
      };
      this.state = STATES.WATCHING_FOR_BREAK;
      console.log(`[ORB] Opening Range set: high=${this.openingRange.high.toFixed(2)}, low=${this.openingRange.low.toFixed(2)}`);
    }

    return null;
  }

  /**
   * Watch for price to close beyond OR high/low.
   * @private
   */
  _handleWatchingForBreak(candle) {
    if (!this.openingRange) return null;

    const close = _c(candle);

    // Bullish breakout: close above OR high
    if (close > this.openingRange.high) {
      this.breakoutDirection = 'bullish';
      this.state = STATES.WATCHING_FOR_FVG;
      console.log(`[ORB] BULLISH breakout! Close ${close.toFixed(2)} > OR high ${this.openingRange.high.toFixed(2)}`);
      // Immediately check for FVG in this bar
      return this._handleWatchingForFVG(candle);
    }

    // Bearish breakout: close below OR low
    if (close < this.openingRange.low) {
      this.breakoutDirection = 'bearish';
      this.state = STATES.WATCHING_FOR_FVG;
      console.log(`[ORB] BEARISH breakout! Close ${close.toFixed(2)} < OR low ${this.openingRange.low.toFixed(2)}`);
      return this._handleWatchingForFVG(candle);
    }

    return null;
  }

  /**
   * Scan for FVG in breakout direction.
   * @private
   */
  _handleWatchingForFVG(candle) {
    if (!this.breakoutDirection) return null;
    if (this.recentCandles.length < 3) return null;

    // Look for FVG in the direction of breakout
    const fvg = this.fvgDetector.detect(this.recentCandles, this.breakoutDirection);

    if (fvg) {
      // Found FVG! Generate signal
      const signal = this._generateSignal(fvg, candle);
      this.pendingSignal = signal;
      this.state = STATES.SIGNAL_READY;
      console.log(`[ORB] FVG found: ${fvg.direction} gap ${fvg.gapLow.toFixed(2)}-${fvg.gapHigh.toFixed(2)}`);
      return signal;
    }

    // Check scan limit
    const barsSinceBreakout = this.recentCandles.length;
    if (barsSinceBreakout >= this.fvgScanBars) {
      // No FVG found within window - session done
      this.state = STATES.DONE;
      console.log(`[ORB] No FVG found within ${this.fvgScanBars} bars. Session done.`);
    }

    return null;
  }

  /**
   * Generate the trade signal from FVG.
   * @private
   */
  _generateSignal(fvg, currentCandle) {
    const levels = this.fvgDetector.calculateLevels(
      fvg,
      this.entryLevel,
      this.stopBufferPct,
      this.targetRR
    );

    return {
      strategy: 'OpeningRangeBreakout',
      direction: fvg.direction === 'bullish' ? 'buy' : 'sell',
      confidence: this._calculateConfidence(fvg),

      // Entry details
      entry: levels.entry,
      stop: levels.stop,
      target: levels.target,
      risk: levels.risk,

      // FVG zone for reference
      fvg: {
        gapHigh: fvg.gapHigh,
        gapLow: fvg.gapLow,
        midpoint: fvg.midpoint,
        gapPercent: fvg.gapPercent,
      },

      // Opening Range for reference
      openingRange: this.openingRange,

      // LIMIT order hint (don't market chase)
      orderType: 'LIMIT',
      limitPrice: levels.entry,

      // Exit contract hint for ExitContractManager
      exitContractHint: {
        strategyName: 'OpeningRangeBreakout',
        stopLossPercent: -Math.abs((levels.stop - levels.entry) / levels.entry * 100),
        takeProfitPercent: Math.abs((levels.target - levels.entry) / levels.entry * 100),
        trailingStopPercent: 0.6,
        trailingActivation: 0.8,
        maxHoldTimeMinutes: 180,
        invalidationConditions: ['fvg_filled', 'or_break_reversal'],
      },

      timestamp: _t(currentCandle),
      reason: `ORB ${fvg.direction} | OR ${this.openingRange.low.toFixed(0)}-${this.openingRange.high.toFixed(0)} | FVG ${fvg.gapLow.toFixed(0)}-${fvg.gapHigh.toFixed(0)}`,
    };
  }

  /**
   * Calculate confidence based on FVG quality and OR characteristics.
   * @private
   */
  _calculateConfidence(fvg) {
    let confidence = 0.50; // Base confidence

    // Boost for cleaner gaps (larger but not excessive)
    if (fvg.gapPercent >= 0.3 && fvg.gapPercent <= 1.0) {
      confidence += 0.15;
    } else if (fvg.gapPercent > 1.0 && fvg.gapPercent <= 1.5) {
      confidence += 0.10;
    }

    // Cap at 0.85 (nothing is certain)
    return Math.min(0.85, confidence);
  }

  /**
   * Consume the pending signal (called after trade execution).
   */
  consumeSignal() {
    this.pendingSignal = null;
    this.state = STATES.DONE;
  }

  /**
   * Get session date string (for tracking session boundaries).
   * @private
   */
  _getSessionDate(date) {
    // Session resets at sessionOpenHourUTC
    const adjusted = new Date(date);
    if (adjusted.getUTCHours() < this.sessionOpenHourUTC) {
      adjusted.setUTCDate(adjusted.getUTCDate() - 1);
    }
    return adjusted.toISOString().slice(0, 10);
  }

  /**
   * Get current state for debugging/dashboard.
   */
  getState() {
    return {
      state: this.state,
      sessionDate: this.currentSessionDate,
      openingRange: this.openingRange,
      breakoutDirection: this.breakoutDirection,
      hasPendingSignal: !!this.pendingSignal,
      recentCandleCount: this.recentCandles.length,
    };
  }
}

module.exports = OpeningRangeBreakout;
