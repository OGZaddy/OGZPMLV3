/**
 * CandleProcessor - Phase 19 Extraction
 *
 * EXACT COPY of handleMarketData() from run-empire-v2.js
 * NO logic changes. Just moved to separate file.
 *
 * Dependencies passed via context object in constructor.
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
    console.log('[CandleProcessor] Initialized (Phase 19 - exact copy)');
  }

  /**
   * Handle incoming market data from WebSocket
   * Kraken OHLC format: [channelID, [time, etime, open, high, low, close, vwap, volume, count], channelName, pair]
   * EXACT COPY from run-empire-v2.js
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

    // Update price history (use etime to detect new minutes, not actual timestamp)
    const lastCandle = this.ctx.priceHistory[this.ctx.priceHistory.length - 1];
    const isNewMinute = !lastCandle || lastCandle.etime !== candle.etime;

    if (!isNewMinute) {
      // Update existing candle (same minute) - Kraken sends multiple updates per minute
      this.ctx.priceHistory[this.ctx.priceHistory.length - 1] = candle;
      this.ctx._candleStore.addCandle('BTC-USD', '15m', candle);  // REFACTOR: dual-write (update)

      // Debug: Show updates for first few candles
      if (this.ctx.priceHistory.length <= 3) {
        const candleTime = new Date(candle.t).toLocaleTimeString();
        // CHANGE 634: Clean output for humans (no more decimal headaches!)
        const openVal = Math.round(_o(candle));
        const highVal = Math.round(_h(candle));
        const lowVal = Math.round(_l(candle));
        const closeVal = Math.round(_c(candle));
        console.log(`🕯️ Candle #${this.ctx.priceHistory.length} [${candleTime}]: $${closeVal.toLocaleString()} (H:${highVal.toLocaleString()} L:${lowVal.toLocaleString()})`);
      }
    } else {
      // New candle (new minute) - etime changed
      this.ctx.priceHistory.push(candle);
      this.ctx._candleStore.addCandle('BTC-USD', '15m', candle);  // REFACTOR: dual-write

      // CHANGE 2026-02-10: Feed modular entry system with new candle
      if (this.ctx.mtfAdapter) this.ctx.mtfAdapter.ingestCandle(candle);
      if (this.ctx.emaCrossover) this.ctx.emaCrossoverSignal = this.ctx.emaCrossover.update(candle, this.ctx.priceHistory);
      if (this.ctx.maDynamicSR) this.ctx.maDynamicSRSignal = this.ctx.maDynamicSR.update(candle, this.ctx.priceHistory);
      if (this.ctx.breakAndRetest) this.ctx.breakRetestSignal = this.ctx.breakAndRetest.update(candle, this.ctx.priceHistory);
      if (this.ctx.liquiditySweep) this.ctx.liquiditySweepSignal = this.ctx.liquiditySweep.feedCandle(candle);

      // CHANGE 2026-02-23: Update Volume Profile (chop filter for trend strategies)
      if (this.ctx.volumeProfile) this.ctx.volumeProfile.update(candle, this.ctx.priceHistory);


      // Only log during warmup phase (first 20 candles)
      if (this.ctx.priceHistory.length <= 20) {
        const candleTime = new Date(candle.t).toLocaleTimeString();
        console.log(`✅ Candle #${this.ctx.priceHistory.length}/15 [${candleTime}]`);
      }

      // Keep enough history for 200 EMA + swing detection (220 bars minimum)
      if (this.ctx.priceHistory.length > 250) {
        this.ctx.priceHistory = this.ctx.priceHistory.slice(-250);
      }

      // CHANGE 2026-01-28: Save candles to disk every 5 new candles
      this.ctx.candleSaveCounter++;
      if (this.ctx.candleSaveCounter >= 5) {
        this.ctx.saveCandleHistory();
        this.ctx.candleSaveCounter = 0;
      }
    }

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

    // CHANGE 2025-12-23: Feed candle to IndicatorEngine (Empire V2)
    this.ctx.indicatorEngine.updateCandle({
      t: parseFloat(time) * 1000,
      o: parseFloat(open),
      h: parseFloat(high),
      l: parseFloat(low),
      c: parseFloat(close),
      v: parseFloat(volume) || 0
    });

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
}

module.exports = CandleProcessor;
