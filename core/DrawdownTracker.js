/**
 * DrawdownTracker - Capital Protection via Drawdown Monitoring
 *
 * SINGLE RESPONSIBILITY: Track account drawdown and provide protection multipliers.
 * Extracted from RiskManager.js as part of Phase 8 modular refactor.
 *
 * @module core/DrawdownTracker
 */

'use strict';

class DrawdownTracker {
  constructor(config = {}) {
    this.config = {
      maxDrawdownPercent: config.maxDrawdownPercent ?? 15,
      recoveryThreshold: config.recoveryThreshold ?? 10,
      recoveryModeBackoffMs: config.recoveryModeBackoffMs ?? 300000, // 5 min
      tradesRequiredToExitRecovery: config.tradesRequiredToExitRecovery ?? 5,
    };

    this.state = {
      accountBalance: 0,
      initialBalance: 0,
      peakBalance: 0,
      currentDrawdown: 0,
      maxDrawdownReached: 0,
      recoveryMode: false,
      recoveryModeEnteredAt: 0,
      lastRecoveryExit: 0,
    };
  }

  /**
   * Initialize with starting balance
   * @param {number} balance - Starting account balance
   */
  initialize(balance) {
    if (balance <= 0) {
      throw new Error('Balance must be positive');
    }
    this.state.accountBalance = balance;
    this.state.initialBalance = balance;
    this.state.peakBalance = balance;
    this.state.currentDrawdown = 0;
    console.log(`[DrawdownTracker] Initialized with $${balance.toFixed(2)}`);
  }

  /**
   * Update balance after a trade
   * @param {number} pnl - Profit/loss from trade
   */
  updateBalance(pnl) {
    this.state.accountBalance += pnl;

    // Update peak balance for drawdown calculation
    if (this.state.accountBalance > this.state.peakBalance) {
      this.state.peakBalance = this.state.accountBalance;
    }

    // Calculate current drawdown
    if (this.state.peakBalance > 0) {
      this.state.currentDrawdown =
        ((this.state.peakBalance - this.state.accountBalance) / this.state.peakBalance) * 100;
    }

    if (this.state.currentDrawdown > this.state.maxDrawdownReached) {
      this.state.maxDrawdownReached = this.state.currentDrawdown;
    }
  }

  /**
   * Set balance directly (for sync with external source)
   * @param {number} newBalance - New balance value
   */
  setBalance(newBalance) {
    this.state.accountBalance = newBalance;
    if (newBalance > this.state.peakBalance) {
      this.state.peakBalance = newBalance;
    }
    if (this.state.peakBalance > 0) {
      this.state.currentDrawdown =
        ((this.state.peakBalance - this.state.accountBalance) / this.state.peakBalance) * 100;
    }
  }

  /**
   * Check and update recovery mode status
   * @param {number} consecutiveWins - Current winning streak
   * @param {number} recentWinRate - Win rate over recent trades (0-100)
   */
  checkRecoveryMode(consecutiveWins = 0, recentWinRate = 0) {
    const now = Date.now();
    const wasInRecovery = this.state.recoveryMode;

    // Enter recovery mode
    if (!this.state.recoveryMode && this.state.currentDrawdown >= this.config.recoveryThreshold) {
      const timeSinceLastExit = now - this.state.lastRecoveryExit;
      if (timeSinceLastExit >= this.config.recoveryModeBackoffMs) {
        this.state.recoveryMode = true;
        this.state.recoveryModeEnteredAt = now;
        console.log(`[DrawdownTracker] RECOVERY MODE ACTIVATED: ${this.state.currentDrawdown.toFixed(2)}% drawdown`);
      }
    }
    // Exit recovery mode
    else if (this.state.recoveryMode) {
      const timeInRecovery = now - this.state.recoveryModeEnteredAt;
      const minTimeInRecovery = 600000; // 10 minutes minimum

      const drawdownImproved = this.state.currentDrawdown < (this.config.recoveryThreshold * 0.8);
      const sufficientWins = consecutiveWins >= this.config.tradesRequiredToExitRecovery;
      const goodPerformance = recentWinRate > 60;
      const minTimeElapsed = timeInRecovery >= minTimeInRecovery;

      if (minTimeElapsed && drawdownImproved && (sufficientWins || goodPerformance)) {
        this.state.recoveryMode = false;
        this.state.lastRecoveryExit = now;
        console.log(`[DrawdownTracker] RECOVERY MODE EXITED: Drawdown at ${this.state.currentDrawdown.toFixed(2)}%`);
      }
    }

    return this.state.recoveryMode !== wasInRecovery;
  }

  /**
   * Calculate position size multiplier based on drawdown
   * @returns {number} Multiplier (0.4 to 1.2)
   */
  calculateProtectionMultiplier() {
    const { accountBalance, initialBalance } = this.state;

    if (!initialBalance || initialBalance <= 0) {
      return 1.0;
    }

    const drawdownPercent = ((accountBalance - initialBalance) / initialBalance) * 100;

    if (drawdownPercent < -10) return 0.4;  // Severe - 40%
    if (drawdownPercent < -5) return 0.6;   // Moderate - 60%
    if (drawdownPercent < -2) return 0.8;   // Light - 80%
    if (drawdownPercent > 10) return 1.2;   // Strong performance - 120%

    return 1.0;
  }

  /**
   * Check if max drawdown exceeded (trading should stop)
   * @returns {boolean}
   */
  isMaxDrawdownExceeded() {
    return this.state.currentDrawdown >= this.config.maxDrawdownPercent;
  }

  /**
   * Get current drawdown state
   * @returns {Object}
   */
  getState() {
    return {
      accountBalance: this.state.accountBalance,
      peakBalance: this.state.peakBalance,
      currentDrawdown: this.state.currentDrawdown,
      maxDrawdownReached: this.state.maxDrawdownReached,
      recoveryMode: this.state.recoveryMode,
      protectionMultiplier: this.calculateProtectionMultiplier(),
    };
  }

  /**
   * Reset tracker state
   * @param {number} [newBalance] - Optional new starting balance
   */
  reset(newBalance = null) {
    if (newBalance !== null && newBalance > 0) {
      this.initialize(newBalance);
    }
    this.state.recoveryMode = false;
    this.state.recoveryModeEnteredAt = 0;
    this.state.maxDrawdownReached = 0;
  }
}

module.exports = DrawdownTracker;
