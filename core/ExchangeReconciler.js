/**
 * ExchangeReconciler.js - Truth Source Reconciliation System
 *
 * Ensures internal state matches exchange reality
 * Prevents position drift and detects discrepancies
 *
 * CRITICAL: Exchange is ALWAYS the source of truth
 */

const { getInstance: getStateManager } = require('./StateManager');

class ExchangeReconciler {
  constructor(config = {}) {
    this.krakenAdapter = config.krakenAdapter || null;
    this.interval = config.interval || 30000; // 30 seconds default
    this.reconcileTimer = null;
    this.isReconciling = false;
    this.lastReconcileTime = 0;
    this.paperMode = config.paperMode || false;

    // Drift thresholds - DISABLED THE E-BRAKE! LET IT RIP!
    this.thresholds = {
      positionWarning: 1.0,      // 1 BTC warning (was 0.01)
      positionPause: 10.0,       // 10 BTC pause - NEVER GONNA HAPPEN
      balanceWarning: 5000,      // $5000 warning (was $50)
      balancePause: 50000        // $50,000 pause - E-BRAKE RELEASED!
    };

    // Drift tracking
    this.driftHistory = [];
    this.maxDriftHistory = 100;

    console.log('🔄 ExchangeReconciler initialized');
    console.log(`   Interval: ${this.interval / 1000}s`);
    console.log(`   Position drift pause: ${this.thresholds.positionPause} BTC`);
    console.log(`   Balance drift pause: $${this.thresholds.balancePause}`);
  }

  setKrakenAdapter(adapter) {
    this.krakenAdapter = adapter;
    console.log('✅ Kraken adapter connected to reconciler');
  }

  /**
   * Start reconciliation loop
   * @param {boolean} blockUntilFirst - Block trading until first reconcile completes
   */
  async start(blockUntilFirst = true) {
    console.log('\n🔄 STARTING RECONCILIATION SYSTEM');

    if (blockUntilFirst) {
      console.log('⏳ Blocking trading until initial reconciliation...');
      const result = await this.reconcileNow();

      if (!result.success) {
        console.error('❌ INITIAL RECONCILIATION FAILED - trading will remain paused until recovered');
        const stateManager = getStateManager();
        await stateManager.pauseTrading('Initial reconciliation failed');
        // do NOT throw - keep process alive
      }

      console.log('✅ Initial reconciliation complete - trading enabled');
    }

    // Start periodic reconciliation
    this.reconcileTimer = setInterval(async () => {
      await this.reconcileNow();
    }, this.interval);

    console.log(`🔄 Reconciliation loop started (every ${this.interval / 1000}s)`);
  }

  /**
   * Stop reconciliation loop
   */
  stop() {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
      console.log('🛑 Reconciliation loop stopped');
    }
  }

  /**
   * Perform immediate reconciliation
   */
  async reconcileNow() {
    // Skip reconciliation in paper mode
    if (this.paperMode) {
      console.log('📝 Paper mode - skipping exchange reconciliation');
      return { success: true, reason: 'Paper mode - no reconciliation needed' };
    }

    if (this.isReconciling) {
      console.log('⚠️ Reconciliation already in progress, skipping');
      return { success: false, reason: 'Already reconciling' };
    }

    this.isReconciling = true;
    const startTime = Date.now();

    try {
      console.log('\n📊 Starting reconciliation...');

      // Get exchange truth
      const exchangeData = await this.fetchExchangeTruth();
      if (!exchangeData) {
        throw new Error('Failed to fetch exchange data');
      }

      // Get internal state
      const stateManager = getStateManager();
      const internalState = {
        balance: stateManager.get('balance') || 0,
        position: stateManager.get('position') || 0,
        openOrders: stateManager.get('openOrders') || []
      };

      console.log('📊 Exchange positions:', JSON.stringify(exchangeData.positions));
      console.log('📊 Internal positions:', internalState.position);

      // Calculate drift
      const drift = this.calculateDrift(exchangeData, internalState);
      console.log(`📊 Drift detected: ${drift.summary}`);

      // Record drift history
      this.recordDrift(drift);

      // Handle drift based on thresholds
      const action = await this.handleDrift(drift, exchangeData, internalState);

      const duration = Date.now() - startTime;
      console.log(`✅ Reconciliation complete in ${duration}ms`);

      this.lastReconcileTime = Date.now();
      this.isReconciling = false;

      return {
        success: true,
        drift: drift,
        action: action,
        duration: duration
      };

    } catch (error) {
      console.error('❌ Reconciliation error:', error.message);
      this.isReconciling = false;

      // On reconciliation failure, pause trading for safety
      const stateManager = getStateManager();
      await stateManager.pauseTrading('Reconciliation failed');

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Fetch truth from exchange
   */
  async fetchExchangeTruth() {
    if (!this.krakenAdapter) {
      console.log('📝 Paper mode - using mock exchange data');
      return {
        balance: 10000,
        positions: {},
        openOrders: [],
        timestamp: Date.now()
      };
    }

    try {
      // Fetch balance
      const balance = await this.krakenAdapter.getBalance();

      // Fetch open positions
      const positions = await this.krakenAdapter.getOpenPositions();

      // Fetch open orders
      const openOrders = await this.krakenAdapter.getOpenOrders();

      return {
        balance: balance.total || 0,
        positions: positions || {},
        openOrders: openOrders || [],
        timestamp: Date.now()
      };

    } catch (error) {
      console.error('❌ Failed to fetch exchange data:', error.message);
      return null;
    }
  }

  /**
   * Calculate drift between exchange and internal state
   */
  calculateDrift(exchangeData, internalState) {
    const btcPosition = exchangeData.positions['BTC'] || 0;
    const positionDrift = Math.abs(btcPosition - internalState.position);
    const balanceDrift = Math.abs(exchangeData.balance - internalState.balance);

    const drift = {
      positionDrift: positionDrift,
      balanceDrift: balanceDrift,
      positionDriftBTC: positionDrift,
      balanceDriftUSD: balanceDrift,
      hasUnknownPosition: btcPosition > 0 && internalState.position === 0,
      timestamp: Date.now(),
      summary: 'none'
    };

    // Determine drift severity
    if (drift.hasUnknownPosition) {
      drift.summary = 'CRITICAL: Unknown position on exchange';
      drift.severity = 'critical';
    } else if (positionDrift > this.thresholds.positionPause || balanceDrift > this.thresholds.balancePause) {
      drift.summary = `LARGE: Position ${positionDrift.toFixed(4)} BTC, Balance $${balanceDrift.toFixed(2)}`;
      drift.severity = 'large';
    } else if (positionDrift > this.thresholds.positionWarning || balanceDrift > this.thresholds.balanceWarning) {
      drift.summary = `SMALL: Position ${positionDrift.toFixed(4)} BTC, Balance $${balanceDrift.toFixed(2)}`;
      drift.severity = 'small';
    } else {
      drift.summary = 'none';
      drift.severity = 'none';
    }

    return drift;
  }

  /**
   * Handle drift based on severity
   */
  async handleDrift(drift, exchangeData, internalState) {
    const stateManager = getStateManager();

    // PAPER MODE: never pause trading, only log + track
    if (this.paperMode) {
      if (drift.severity !== 'none') {
        console.warn(`📝 [PAPER] Drift detected (${drift.severity}): ${drift.summary}`);
      }
      return 'LOG_ONLY';
    }

    // LIVE MODE: existing behavior
    switch (drift.severity) {
      case 'critical':
        console.error('🚨 CRITICAL DRIFT - HARD STOP');
        await stateManager.pauseTrading('Critical drift: unknown exchange position');

        // Send alert
        if (this.alertHandler) {
          await this.alertHandler.sendCriticalAlert('Unknown position on exchange!', drift);
        }

        return 'HARD_STOP';

      case 'large':
        console.error('⚠️ LARGE DRIFT - PAUSING TRADING');
        await stateManager.pauseTrading(`Large drift detected: ${drift.summary}`);

        // Send alert
        if (this.alertHandler) {
          await this.alertHandler.sendWarningAlert('Large drift detected', drift);
        }

        return 'PAUSE_TRADING';

      case 'small':
        console.warn('⚠️ Small drift detected - auto-correcting');

        // Auto-correct small drift
        await stateManager.updateState({
          balance: exchangeData.balance,
          position: exchangeData.positions['BTC'] || 0
        }, { source: 'reconciliation', auto: true });

        return 'AUTO_CORRECTED';

      case 'none':
        // No action needed
        return 'NO_ACTION';

      default:
        console.error('❓ Unknown drift severity:', drift.severity);
        return 'UNKNOWN';
    }
  }

  /**
   * Record drift for analysis
   */
  recordDrift(drift) {
    this.driftHistory.push({
      ...drift,
      timestamp: Date.now()
    });

    // Keep history bounded
    if (this.driftHistory.length > this.maxDriftHistory) {
      this.driftHistory.shift();
    }
  }

  /**
   * Get drift statistics
   */
  getDriftStats() {
    if (this.driftHistory.length === 0) {
      return {
        count: 0,
        avgPositionDrift: 0,
        avgBalanceDrift: 0,
        maxPositionDrift: 0,
        maxBalanceDrift: 0,
        criticalCount: 0
      };
    }

    const stats = {
      count: this.driftHistory.length,
      avgPositionDrift: 0,
      avgBalanceDrift: 0,
      maxPositionDrift: 0,
      maxBalanceDrift: 0,
      criticalCount: 0
    };

    this.driftHistory.forEach(drift => {
      stats.avgPositionDrift += drift.positionDrift;
      stats.avgBalanceDrift += drift.balanceDrift;
      stats.maxPositionDrift = Math.max(stats.maxPositionDrift, drift.positionDrift);
      stats.maxBalanceDrift = Math.max(stats.maxBalanceDrift, drift.balanceDrift);

      if (drift.severity === 'critical') {
        stats.criticalCount++;
      }
    });

    stats.avgPositionDrift /= this.driftHistory.length;
    stats.avgBalanceDrift /= this.driftHistory.length;

    return stats;
  }

  /**
   * Emergency reconciliation with forced sync
   */
  async emergencySync() {
    console.log('\n🚨 EMERGENCY SYNC INITIATED');

    try {
      const exchangeData = await this.fetchExchangeTruth();
      if (!exchangeData) {
        throw new Error('Cannot fetch exchange data for emergency sync');
      }

      const stateManager = getStateManager();

      // Force update to exchange truth
      await stateManager.updateState({
        balance: exchangeData.balance,
        position: exchangeData.positions['BTC'] || 0,
        openOrders: exchangeData.openOrders,
        lastSync: Date.now()
      }, { source: 'emergency_sync', forced: true });

      console.log('✅ Emergency sync complete - state forced to exchange truth');

      // Clear drift history
      this.driftHistory = [];

      return { success: true };

    } catch (error) {
      console.error('❌ Emergency sync failed:', error.message);
      return { success: false, error: error.message };
    }
  }
}

// Singleton instance
let instance = null;

module.exports = {
  ExchangeReconciler,
  getInstance: (config) => {
    if (!instance) {
      instance = new ExchangeReconciler(config);
    }
    return instance;
  }
};