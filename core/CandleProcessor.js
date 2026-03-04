/**
 * CandleProcessor - Phase 19 Extraction + Gap Recovery
 *
 * Handles incoming market data from WebSocket.
 * Includes gap detection and REST API backfill recovery.
 *
 * Gap Recovery Flow:
 * 1. Gap detected (>1.5x candle interval)
 * 2. Attempt REST backfill via kraken.getHistoricalOHLC()
 * 3. Success: splice candles, replay through indicators, continue
 * 4. Fail: THEN halt, retry every 60s, resume after 3 clean candles
 *
 * @module core/CandleProcessor
 */

'use strict';

const { getInstance: getStateManager } = require('./StateManager');
const stateManager = getStateManager();

// Candle accessors (V2 format)
const _o = (candle) => candle?.o ?? candle?.open ?? 0;
const _h = (candle) => candle?.h ?? candle?.high ?? 0;
const _l = (candle) => candle?.l ?? candle?.low ?? 0;
const _c = (candle) => candle?.c ?? candle?.close ?? 0;

class CandleProcessor {
  constructor(ctx) {
    this.ctx = ctx;

    // Gap recovery state
    this.candleIntervalMs = 15 * 60 * 1000; // 15 minutes default
    this.gapThresholdMultiplier = 1.5; // Gap if > 1.5x interval (22.5 min for 15m candles)
    this.cleanCandleCount = 0;
    this.cleanCandlesRequired = 3;
    this.backfillRetryInterval = null;
    this.backfillRetryDelayMs = 60000; // 60 seconds

    console.log('[CandleProcessor] Initialized with gap recovery');
  }

  /**
   * Process a candle - ONE CANONICAL PATH
   * Phase 5 REWRITE: Handles both new candles AND updates to existing candles
   * Used by live feed, backfill replay, and intra-candle updates
   * @param {Object} candle - Candle in V2 format { o, h, l, c, v, t, etime }
   * @returns {boolean} true if new candle, false if update to existing
   */
  processNewCandle(candle) {
    // Check if this is an update to existing candle or a new candle
    const existingIndex = this.ctx.priceHistory.findIndex(c => c.etime === candle.etime);
    const isUpdate = existingIndex !== -1;

    if (isUpdate) {
      // UPDATE existing candle (same etime, new OHLCV values as candle forms)
      this.ctx.priceHistory[existingIndex] = candle;
      this.ctx._candleStore.addCandle('BTC-USD', '15m', candle);

      // Feed IndicatorEngine for real-time updates
      if (this.ctx.indicatorEngine) {
        this.ctx.indicatorEngine.updateCandle({
          t: candle.t, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v
        });
      }
      return false; // Was update, not new
    }

    // NEW candle - smart insert: push if latest, splice if backfill
    const lastCandle = this.ctx.priceHistory[this.ctx.priceHistory.length - 1];
    if (!lastCandle || candle.etime > lastCandle.etime) {
      this.ctx.priceHistory.push(candle);
    } else {
      // Backfill case: insert in timestamp order
      let insertIndex = 0;
      for (let i = this.ctx.priceHistory.length - 1; i >= 0; i--) {
        if (this.ctx.priceHistory[i].etime < candle.etime) {
          insertIndex = i + 1;
          break;
        }
      }
      this.ctx.priceHistory.splice(insertIndex, 0, candle);
    }

    this.ctx._candleStore.addCandle('BTC-USD', '15m', candle);

    // Feed IndicatorEngine
    if (this.ctx.indicatorEngine) {
      this.ctx.indicatorEngine.updateCandle({
        t: candle.t, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v
      });
    }

    // Feed modular entry systems (only on NEW candles, not updates)
    if (this.ctx.mtfAdapter) this.ctx.mtfAdapter.ingestCandle(candle);
    if (this.ctx.emaCrossover) this.ctx.emaCrossoverSignal = this.ctx.emaCrossover.update(candle, this.ctx.priceHistory);
    if (this.ctx.maDynamicSR) this.ctx.maDynamicSRSignal = this.ctx.maDynamicSR.update(candle, this.ctx.priceHistory);
    if (this.ctx.breakAndRetest) this.ctx.breakRetestSignal = this.ctx.breakAndRetest.update(candle, this.ctx.priceHistory);
    if (this.ctx.liquiditySweep) this.ctx.liquiditySweepSignal = this.ctx.liquiditySweep.feedCandle(candle);
    if (this.ctx.volumeProfile) this.ctx.volumeProfile.update(candle, this.ctx.priceHistory);

    // Warmup log (only first 20 candles)
    if (this.ctx.priceHistory.length <= 20) {
      const candleTime = new Date(candle.t).toLocaleTimeString();
      console.log(`✅ Candle #${this.ctx.priceHistory.length}/15 [${candleTime}]`);
    }

    // Trim history to 250
    if (this.ctx.priceHistory.length > 250) {
      this.ctx.priceHistory = this.ctx.priceHistory.slice(-250);
    }

    // Save counter
    this.ctx.candleSaveCounter++;
    if (this.ctx.candleSaveCounter >= 5) {
      this.ctx.saveCandleHistory();
      this.ctx.candleSaveCounter = 0;
    }

    return true; // Was new candle
  }

  /**
   * Attempt to backfill missing candles via REST API
   * @param {number} gapStart - Start timestamp of gap (ms)
   * @param {number} gapEnd - End timestamp of gap (ms)
   * @returns {Array} Backfilled candles or empty array on failure
   */
  async attemptBackfill(gapStart, gapEnd) {
    try {
      if (!this.ctx.kraken || !this.ctx.kraken.getHistoricalOHLC) {
        console.error('[GAP-RECOVERY] Kraken adapter not available');
        return [];
      }

      // Calculate how many candles we need
      const missingCount = Math.ceil((gapEnd - gapStart) / this.candleIntervalMs);
      const fetchCount = missingCount + 5; // Small buffer

      console.log(`[GAP-RECOVERY] Fetching ${fetchCount} candles to fill ${missingCount} missing`);

      const candles = await this.ctx.kraken.getHistoricalOHLC('XBTUSD', 15, fetchCount);

      if (!candles || candles.length === 0) {
        console.error('[GAP-RECOVERY] REST API returned no candles');
        return [];
      }

      // Filter to only candles within the gap
      const gapCandles = candles.filter(c => c.etime > gapStart && c.etime <= gapEnd);

      // Sort chronologically (oldest first - critical for indicator replay)
      gapCandles.sort((a, b) => a.t - b.t);

      return gapCandles;

    } catch (error) {
      console.error(`[GAP-RECOVERY] Backfill failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Start retry loop for failed backfill
   * @param {number} gapStart - Start timestamp
   * @param {number} gapEnd - End timestamp
   */
  startBackfillRetry(gapStart, gapEnd) {
    if (this.backfillRetryInterval) return; // Already retrying

    console.log('[GAP-RECOVERY] Starting retry loop (every 60s)');

    this.backfillRetryInterval = setInterval(async () => {
      console.log('[GAP-RECOVERY] Retry attempt...');

      const candles = await this.attemptBackfill(gapStart, gapEnd);

      if (candles.length > 0) {
        console.log(`[GAP-RECOVERY] Retry succeeded: ${candles.length} candles`);
        this.handleBackfillSuccess(candles);
        this.stopBackfillRetry();
      }
    }, this.backfillRetryDelayMs);
  }

  /**
   * Stop the retry loop
   */
  stopBackfillRetry() {
    if (this.backfillRetryInterval) {
      clearInterval(this.backfillRetryInterval);
      this.backfillRetryInterval = null;
    }
  }

  /**
   * Handle successful backfill - process through canonical path
   * @param {Array} candles - Backfilled candles (sorted chronologically)
   */
  handleBackfillSuccess(candles) {
    console.log(`[GAP-RECOVERY] Processing ${candles.length} backfilled candles`);

    // One canonical path - dedupe + insert + indicators all in one
    candles.forEach(c => this.processNewCandle(c));

    console.log(`[GAP-RECOVERY] Backfilled ${candles.length} candles via REST`);
  }

  /**
   * Handle incoming market data from WebSocket
   * Kraken OHLC format: [channelID, [time, etime, open, high, low, close, vwap, volume, count], channelName, pair]
   */
  handleMarketData(ohlcData) {

    // OHLC data is array: [time, etime, open, high, low, close, vwap, volume, count]
    if (!Array.isArray(ohlcData) || ohlcData.length < 8) {
      console.warn('⚠️ Invalid OHLC data format:', ohlcData);
      return;
    }

    const [time, etime, open, high, low, close, vwap, volume, count] = ohlcData;

    // CHANGE 2026-01-16: Track when we last received ANY data (for liveness watchdog)
    this.ctx.lastDataReceived = Date.now();

    // STALE DATA DETECTION: Check if DATA ITSELF is old (not arrival time)
    // FIX BACKTEST_001: Skip stale check in backtest mode - historical data is intentionally old
    const isBacktesting = process.env.BACKTEST_MODE === 'true' || this.ctx.config?.enableBacktestMode;
    const now = Date.now();
    const dataAge = now - (etime * 1000); // etime is in SECONDS, convert to milliseconds

    // If data is more than 2 minutes old, it's stale (but NOT during backtesting!)
    if (dataAge > 120000 && !isBacktesting) {
      console.error('🚨 STALE DATA:', Math.round(dataAge / 1000), 'seconds old');

      // AUTO-PAUSE TRADING
      if (!this.ctx.staleFeedPaused) {
        console.error('⏸️ PAUSING NEW ENTRIES DUE TO STALE DATA');
        this.ctx.staleFeedPaused = true;

        // Notify StateManager to pause
        try {
          stateManager.pauseTrading(`Stale data: ${Math.round(dataAge / 1000)}s old`);
        } catch (error) {
          console.error('Failed to pause via StateManager:', error.message);
        }
      }
    } else if (this.ctx.staleFeedPaused && dataAge < 30000) {
      // Data is fresh again - resume
      console.log('✅ Fresh data restored, resuming');
      this.ctx.staleFeedPaused = false;
      this.ctx.feedRecoveryCandles = 0;
      stateManager.resumeTrading();
    }

    let price = parseFloat(close);
    if (!price || isNaN(price)) return;

    // Build proper OHLCV candle structure from Kraken OHLC stream
    const candle = {
      o: parseFloat(open),
      h: parseFloat(high),
      l: parseFloat(low),
      c: parseFloat(close),
      v: parseFloat(volume),
      t: parseFloat(time) * 1000,  // Actual timestamp for display
      etime: parseFloat(etime) * 1000  // End time for deduplication
    };

    // Phase 5 REWRITE: ONE CANONICAL PATH - always call processNewCandle
    // processNewCandle now handles both updates (same etime) and new candles
    const lastCandle = this.ctx.priceHistory[this.ctx.priceHistory.length - 1];
    const isNewCandle = !lastCandle || lastCandle.etime !== candle.etime;

    // GAP DETECTION: Check for gaps only on new candles, not in backtest
    if (isNewCandle && lastCandle && !isBacktesting) {
      const gapMs = candle.etime - lastCandle.etime;
      const gapThreshold = this.candleIntervalMs * this.gapThresholdMultiplier;

      if (gapMs > gapThreshold) {
        const missingCandles = Math.floor(gapMs / this.candleIntervalMs) - 1;
        console.warn(`⚠️ [GAP-RECOVERY] Gap detected: ${Math.round(gapMs/60000)} min (${missingCandles} candles missing)`);

        this.attemptBackfill(lastCandle.etime, candle.etime).then(backfilledCandles => {
          if (backfilledCandles.length > 0) {
            this.handleBackfillSuccess(backfilledCandles);
            this.cleanCandleCount = 0;
          } else {
            console.error('[GAP-RECOVERY] Backfill failed, halting trading');
            this.ctx.staleFeedPaused = true;
            stateManager.pauseTrading(`Data gap: ${missingCandles} candles missing, backfill failed`);
            this.startBackfillRetry(lastCandle.etime, candle.etime);
          }
        });
      }
    }

    // Track clean candles for recovery after gap
    if (isNewCandle && this.ctx.staleFeedPaused && this.backfillRetryInterval) {
      this.cleanCandleCount++;
      if (this.cleanCandleCount >= this.cleanCandlesRequired) {
        console.log(`✅ [GAP-RECOVERY] ${this.cleanCandleCount} clean candles - resuming trading`);
        this.ctx.staleFeedPaused = false;
        this.cleanCandleCount = 0;
        this.stopBackfillRetry();
        stateManager.resumeTrading();
      }
    }

    // ONE CANONICAL PATH - all candles (new and updates) go through processNewCandle
    this.processNewCandle(candle);

    // Store latest market data
    this.ctx.marketData = {
      price,
      timestamp: parseFloat(time) * 1000,  // Use candle's actual timestamp
      systemTime: Date.now(),  // Keep system time separately if needed
      volume: parseFloat(volume) || 0,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low)
    };

    // CHANGE 663: Broadcast market data to dashboard
    if (this.ctx.dashboardWsConnected && this.ctx.dashboardWs) {
      try {
        // CHANGE 2025-12-23: Use IndicatorEngine render packet for dashboard
        const renderPacket = this.ctx.indicatorEngine.getRenderPacket({ maxPoints: 200 });

        // CHANGE 2026-01-23: Calculate performance stats for dashboard
        // BUGFIX 2026-01-23: Include position value in P&L calculation!
        const currentBalance = stateManager.get('balance');
        const currentPosition = stateManager.get('position') || 0;
        const positionValue = currentPosition * price;  // Current market value of position
        const totalAccountValue = currentBalance + positionValue;
        // FIX 2026-02-26: Use StateManager instead of hardcoded value
        const initialBalance = stateManager.get('initialBalance') || parseFloat(process.env.INITIAL_BALANCE) || 10000;
        const totalPnL = totalAccountValue - initialBalance;  // Correct: includes open position
        const trades = this.ctx.executionLayer?.trades || [];
        const closedTrades = trades.filter(t => t.pnl !== undefined);
        const winningTrades = closedTrades.filter(t => t.pnl > 0).length;
        const winRate = closedTrades.length > 0 ? (winningTrades / closedTrades.length) * 100 : 0;

        this.ctx.dashboardWs.send(JSON.stringify({
          type: 'price',  // CHANGE 2025-12-11: Match frontend expected message type
          data: {
            price: price,
            candle: {
              open: parseFloat(open),
              high: parseFloat(high),
              low: parseFloat(low),
              close: price,
              volume: parseFloat(volume),
              timestamp: Date.now()
            },
            indicators: renderPacket.indicators,  // Use IndicatorEngine output
            // CHANGE 2026-01-29: Send candles for dashboard's selected timeframe
            candles: this.ctx.getCandlesForTimeframe(this.ctx.dashboardTimeframe).slice(-50),
            timeframe: this.ctx.dashboardTimeframe,  // Tell dashboard what timeframe this is
            overlays: renderPacket.overlays,  // FIX: Should be 'overlays' not 'series'!
            balance: currentBalance,
            position: stateManager.get('position'),
            totalTrades: this.ctx.executionLayer?.totalTrades || 0,
            // CHANGE 2026-01-23: Include performance stats
            totalPnL: totalPnL,
            winRate: winRate
          }
        }));

        // Broadcast edge analytics data
        this.ctx.broadcastEdgeAnalytics(price, parseFloat(volume), candle);
      } catch (error) {
        // Fail silently - don't let dashboard issues affect trading
      }
    }
  }

  /**
   * Cleanup on shutdown
   */
  cleanup() {
    this.stopBackfillRetry();
  }
}

module.exports = CandleProcessor;
