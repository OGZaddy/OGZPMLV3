/**
 * PnLTracker - Profit/Loss and Time-Based Statistics Tracking
 *
 * SINGLE RESPONSIBILITY: Track P&L, streaks, and daily/weekly/monthly stats.
 * Extracted from RiskManager.js as part of Phase 8 modular refactor.
 *
 * @module core/PnLTracker
 */

'use strict';

class PnLTracker {
  constructor(config = {}) {
    this.config = {
      dailyLossLimitPercent: config.dailyLossLimitPercent ?? 5.0,
      weeklyLossLimitPercent: config.weeklyLossLimitPercent ?? 10.0,
      monthlyLossLimitPercent: config.monthlyLossLimitPercent ?? 20.0,
      alertThresholds: {
        consecutiveLosses: config.consecutiveLossesAlert ?? 3,
      },
    };

    this.state = {
      consecutiveWins: 0,
      consecutiveLosses: 0,
      totalTrades: 0,
      successfulTrades: 0,
      winRate: 0,

      dailyStats: this._createPeriodStats(this._getUTCDateString()),
      weeklyStats: this._createPeriodStats(this._getUTCWeekStart()),
      monthlyStats: this._createPeriodStats(this._getUTCMonthStart()),
    };

    this.tradeHistory = [];
  }

  _createPeriodStats(lastReset) {
    return {
      startBalance: 0,
      currentBalance: 0,
      pnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      breachedLimit: false,
      lastReset,
    };
  }

  _getUTCDateString() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  }

  _getUTCWeekStart() {
    const now = new Date();
    const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = utcDate.getUTCDay();
    utcDate.setUTCDate(utcDate.getUTCDate() - day);
    return `${utcDate.getUTCFullYear()}-${String(utcDate.getUTCMonth() + 1).padStart(2, '0')}-${String(utcDate.getUTCDate()).padStart(2, '0')}`;
  }

  _getUTCMonthStart() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Initialize with starting balance
   * @param {number} balance
   */
  initialize(balance) {
    this.state.dailyStats.startBalance = balance;
    this.state.dailyStats.currentBalance = balance;
    this.state.weeklyStats.startBalance = balance;
    this.state.weeklyStats.currentBalance = balance;
    this.state.monthlyStats.startBalance = balance;
    this.state.monthlyStats.currentBalance = balance;
  }

  /**
   * Record a completed trade
   * @param {Object} trade - { success: boolean, pnl: number }
   * @returns {Object} - { alerts: string[] }
   */
  recordTrade(trade) {
    if (!trade || typeof trade.success !== 'boolean' || typeof trade.pnl !== 'number') {
      console.error('[PnLTracker] Invalid trade data');
      return { alerts: [] };
    }

    const alerts = [];

    // Streak tracking
    if (trade.success) {
      this.state.consecutiveWins++;
      this.state.consecutiveLosses = 0;
      this.state.successfulTrades++;
    } else {
      this.state.consecutiveLosses++;
      this.state.consecutiveWins = 0;

      if (this.state.consecutiveLosses >= this.config.alertThresholds.consecutiveLosses) {
        alerts.push(`consecutive_losses:${this.state.consecutiveLosses}`);
      }
    }

    this.state.totalTrades++;
    this.state.winRate = (this.state.successfulTrades / this.state.totalTrades) * 100;

    // Update time-based stats
    this._updateTimeBasedStats(trade);

    // Store in history for recent win rate calculation
    this.tradeHistory.push({ success: trade.success, pnl: trade.pnl, timestamp: Date.now() });
    if (this.tradeHistory.length > 100) {
      this.tradeHistory.shift();
    }

    return { alerts };
  }

  _updateTimeBasedStats(trade) {
    const currentDate = this._getUTCDateString();
    const currentWeek = this._getUTCWeekStart();
    const currentMonth = this._getUTCMonthStart();

    // Reset daily if new day
    if (this.state.dailyStats.lastReset !== currentDate) {
      this._resetPeriod('dailyStats', currentDate);
    }

    // Reset weekly if new week
    if (this.state.weeklyStats.lastReset !== currentWeek) {
      this._resetPeriod('weeklyStats', currentWeek);
    }

    // Reset monthly if new month
    if (this.state.monthlyStats.lastReset !== currentMonth) {
      this._resetPeriod('monthlyStats', currentMonth);
    }

    // Update all periods
    for (const period of ['dailyStats', 'weeklyStats', 'monthlyStats']) {
      const stats = this.state[period];
      stats.pnl += trade.pnl;
      stats.currentBalance += trade.pnl;
      stats.trades++;
      if (trade.success) stats.wins++;
      else stats.losses++;

      // Check loss limits
      this._checkLossLimit(period);
    }
  }

  _resetPeriod(period, newReset) {
    const currentBalance = this.state[period].currentBalance || 0;
    this.state[period] = this._createPeriodStats(newReset);
    this.state[period].startBalance = currentBalance;
    this.state[period].currentBalance = currentBalance;
  }

  _checkLossLimit(period) {
    const stats = this.state[period];
    if (stats.startBalance <= 0) return;

    const lossPercent = (Math.abs(Math.min(0, stats.pnl)) / stats.startBalance) * 100;
    let limit;

    if (period === 'dailyStats') limit = this.config.dailyLossLimitPercent;
    else if (period === 'weeklyStats') limit = this.config.weeklyLossLimitPercent;
    else limit = this.config.monthlyLossLimitPercent;

    if (lossPercent >= limit) {
      stats.breachedLimit = true;
    }
  }

  /**
   * Get recent win rate
   * @param {number} count - Number of recent trades to consider
   * @returns {number} Win rate 0-100
   */
  getRecentWinRate(count = 10) {
    const recent = this.tradeHistory.slice(-count);
    if (recent.length === 0) return 0;
    const wins = recent.filter(t => t.success).length;
    return (wins / recent.length) * 100;
  }

  /**
   * Check if any loss limit is breached
   * @returns {{ daily: boolean, weekly: boolean, monthly: boolean }}
   */
  getLimitBreaches() {
    return {
      daily: this.state.dailyStats.breachedLimit,
      weekly: this.state.weeklyStats.breachedLimit,
      monthly: this.state.monthlyStats.breachedLimit,
    };
  }

  /**
   * Get current state
   */
  getState() {
    return {
      consecutiveWins: this.state.consecutiveWins,
      consecutiveLosses: this.state.consecutiveLosses,
      totalTrades: this.state.totalTrades,
      winRate: this.state.winRate,
      dailyPnL: this.state.dailyStats.pnl,
      weeklyPnL: this.state.weeklyStats.pnl,
      monthlyPnL: this.state.monthlyStats.pnl,
      limitBreaches: this.getLimitBreaches(),
    };
  }

  /**
   * Reset all stats
   * @param {number} [newBalance]
   */
  reset(newBalance = null) {
    this.state.consecutiveWins = 0;
    this.state.consecutiveLosses = 0;
    this.state.totalTrades = 0;
    this.state.successfulTrades = 0;
    this.state.winRate = 0;
    this.tradeHistory = [];

    if (newBalance !== null) {
      this.initialize(newBalance);
    }
  }
}

module.exports = PnLTracker;
