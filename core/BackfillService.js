/**
 * BackfillService - Gap Recovery via REST API
 *
 * When WebSocket data has gaps, attempts to backfill missing candles
 * from Kraken REST API before halting trading.
 *
 * Flow:
 * 1. Gap detected in candle stream
 * 2. BackfillService.fill(gapStart, gapEnd) called
 * 3. Fetches missing candles via REST API
 * 4. Returns candles to splice into history
 * 5. If fails, trading halts until WebSocket recovers
 *
 * @module core/BackfillService
 */

'use strict';

const { getInstance: getStateManager } = require('./StateManager');

class BackfillService {
  constructor(ctx) {
    this.ctx = ctx;
    this.retryInterval = null;
    this.retryCount = 0;
    this.maxRetries = parseInt(process.env.BACKFILL_MAX_RETRIES) || 10;
    this.retryDelayMs = parseInt(process.env.BACKFILL_RETRY_DELAY) || 60000; // 60s
    console.log('[BackfillService] Initialized');
  }

  /**
   * Attempt to fill a gap in candle data via REST API
   * @param {number} gapStart - Start timestamp of gap (ms)
   * @param {number} gapEnd - End timestamp of gap (ms)
   * @param {number} interval - Candle interval in minutes (default 1)
   * @returns {Object} { success: bool, candles: [], error: string }
   */
  async fill(gapStart, gapEnd, interval = 1) {
    try {
      // Validate inputs
      if (!gapStart || !gapEnd || gapEnd <= gapStart) {
        return { success: false, candles: [], error: 'Invalid gap timestamps' };
      }

      // Calculate expected candle count
      const intervalMs = interval * 60 * 1000;
      const expectedCandles = Math.ceil((gapEnd - gapStart) / intervalMs);

      // Sanity check - don't try to backfill huge gaps
      if (expectedCandles > 720) {
        return {
          success: false,
          candles: [],
          error: `Gap too large: ${expectedCandles} candles (max 720)`
        };
      }

      console.log(`[BackfillService] Attempting to fill gap: ${expectedCandles} candles from ${new Date(gapStart).toISOString()} to ${new Date(gapEnd).toISOString()}`);

      // Get Kraken adapter from context
      const kraken = this.ctx.kraken;
      if (!kraken || !kraken.getHistoricalOHLC) {
        return { success: false, candles: [], error: 'Kraken adapter not available' };
      }

      // Fetch historical candles
      // Add buffer to ensure we get the gap candles
      const fetchCount = expectedCandles + 5;
      const candles = await kraken.getHistoricalOHLC('XBTUSD', interval, fetchCount);

      if (!candles || candles.length === 0) {
        return { success: false, candles: [], error: 'REST API returned no candles' };
      }

      // Filter to only candles within the gap
      const gapCandles = candles.filter(c => c.t >= gapStart && c.t < gapEnd);

      if (gapCandles.length === 0) {
        return {
          success: false,
          candles: [],
          error: `REST API returned ${candles.length} candles but none in gap range`
        };
      }

      // Sort by timestamp
      gapCandles.sort((a, b) => a.t - b.t);

      console.log(`[BackfillService] Successfully retrieved ${gapCandles.length}/${expectedCandles} expected gap candles`);

      return {
        success: true,
        candles: gapCandles,
        error: null
      };

    } catch (error) {
      console.error(`[BackfillService] Fill failed: ${error.message}`);
      return {
        success: false,
        candles: [],
        error: error.message
      };
    }
  }

  /**
   * Start retry loop for failed backfill
   * @param {Object} gap - Gap info { start, end, size }
   * @param {Function} onSuccess - Callback when retry succeeds
   */
  startRetryLoop(gap, onSuccess) {
    if (this.retryInterval) {
      console.log('[BackfillService] Retry loop already running');
      return;
    }

    this.retryCount = 0;
    console.log(`[BackfillService] Starting retry loop (max ${this.maxRetries} attempts, ${this.retryDelayMs/1000}s interval)`);

    this.retryInterval = setInterval(async () => {
      this.retryCount++;
      console.log(`[BackfillService] Retry attempt ${this.retryCount}/${this.maxRetries}`);

      const result = await this.fill(gap.start, gap.end);

      if (result.success) {
        console.log(`[BackfillService] Retry successful after ${this.retryCount} attempts`);
        this.stopRetryLoop();
        if (onSuccess) onSuccess(result.candles);
        return;
      }

      if (this.retryCount >= this.maxRetries) {
        console.error(`[BackfillService] Max retries (${this.maxRetries}) reached - giving up`);
        this.stopRetryLoop();
        // Notify dashboard of persistent failure
        this.notifyDashboard('backfill_failed', {
          message: `Backfill failed after ${this.maxRetries} attempts`,
          gap: gap
        });
      }
    }, this.retryDelayMs);
  }

  /**
   * Stop the retry loop
   */
  stopRetryLoop() {
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
      this.retryCount = 0;
    }
  }

  /**
   * Notify dashboard of backfill status
   */
  notifyDashboard(type, data) {
    try {
      if (this.ctx.dashboardWs && this.ctx.dashboardWsConnected) {
        this.ctx.dashboardWs.send(JSON.stringify({
          type: type,
          data: data,
          timestamp: Date.now()
        }));
      }
    } catch (err) {
      // Silent fail - dashboard notification is non-critical
    }
  }

  /**
   * Cleanup on shutdown
   */
  cleanup() {
    this.stopRetryLoop();
  }
}

module.exports = BackfillService;
