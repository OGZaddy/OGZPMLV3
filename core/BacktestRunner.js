/**
 * BacktestRunner - Phase 18 Extraction
 *
 * EXACT COPY of loadHistoricalDataAndBacktest() from run-empire-v2.js
 * NO logic changes. Just moved to separate file.
 *
 * Dependencies passed via context object in constructor.
 *
 * @module core/BacktestRunner
 */

'use strict';

const { getInstance: getStateManager } = require('./StateManager');
const stateManager = getStateManager();

class BacktestRunner {
  constructor(ctx) {
    this.ctx = ctx;
    console.log('[BacktestRunner] Initialized (Phase 18 - exact copy)');
  }

  /**
   * BACKTEST MODE: Load historical data and run simulation
   * Ported from Change 572 - loads Polygon historical data and feeds through trading logic
   * EXACT COPY from run-empire-v2.js
   */
  async loadHistoricalDataAndBacktest() {
    // FIX 2026-03-12: Isolate backtest state from production
    const path = require('path');
    if (process.env.EXECUTION_MODE === 'backtest' || process.env.CANDLE_SOURCE === 'file') {
      process.env.STATE_FILE = path.join(this.ctx.__dirname || '.', 'data', 'state-backtest.json');
      console.log(`📁 [BacktestRunner] Using isolated state file: ${process.env.STATE_FILE}`);
    }

    console.log('📊 BACKTEST MODE: Loading historical data...');

    const fs = require('fs').promises;
    const path = require('path');

    try {
      // Load historical candles - check for custom data file first (CHANGE 633)
      let dataPath;
      if (process.env.CANDLE_DATA_FILE || process.env.CANDLE_FILE) {
        // Use custom candle data file (e.g., 5-second candles for optimization)
        dataPath = process.env.CANDLE_DATA_FILE || process.env.CANDLE_FILE;
        console.log(`📂 Using custom data file: ${dataPath}`);
      } else {
        // Default behavior - CHANGE 633: Use 5-second candles for fast backtest
        const dataFile = process.env.FAST_BACKTEST === 'true'
          ? 'polygon-btc-5sec.json'  // 60k 5-second candles for rapid testing
          : 'polygon-btc-1y.json';    // 60k 1-minute candles for full validation
        console.log(`📂 Data file: data/${dataFile}`);
        dataPath = path.join(this.ctx.__dirname, 'data', dataFile);
      }
      const rawData = await fs.readFile(dataPath, 'utf8');
      const parsedData = JSON.parse(rawData);
      // Handle both formats: array of candles or object with .candles property
      const historicalCandles = parsedData.candles || parsedData;

      console.log(`✅ Loaded ${historicalCandles.length.toLocaleString()} historical candles`);
      console.log(`📅 Date range: ${new Date(historicalCandles[0].timestamp).toLocaleDateString()} → ${new Date(historicalCandles[historicalCandles.length - 1].timestamp).toLocaleDateString()}`);
      console.log(`⏱️  Starting backtest simulation...\n`);

      let processedCount = 0;
      let errorCount = 0;
      const startTime = Date.now();

      // Process each candle through the trading logic
      for (const polygonCandle of historicalCandles) {
        try {
          // Convert to OHLCV format - handle both Polygon format and shorthand
          const ohlcvCandle = {
            o: polygonCandle.open || polygonCandle.o,
            h: polygonCandle.high || polygonCandle.h,
            l: polygonCandle.low || polygonCandle.l,
            c: polygonCandle.close || polygonCandle.c,
            v: polygonCandle.volume || polygonCandle.v,
            t: polygonCandle.timestamp || polygonCandle.t
          };

          // Feed through handleMarketData (same as live mode)
          this.ctx.handleMarketData([
            ohlcvCandle.t / 1000,  // time (in seconds for Kraken compatibility)
            (ohlcvCandle.t / 1000) + 60,  // etime (end time)
            ohlcvCandle.o,
            ohlcvCandle.h,
            ohlcvCandle.l,
            ohlcvCandle.c,
            0,  // vwap (not used)
            ohlcvCandle.v,
            1   // count
          ]);

          // Run trading analysis after warmup (WITH TRAI!)
          if (this.ctx.priceHistory.length >= 200) {
            await this.ctx.analyzeAndTrade();
          }

          processedCount++;

          // Progress reporting every 5,000 candles
          if (processedCount % 5000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const rate = (processedCount / (elapsed || 1)).toFixed(0);
            console.log(`📊 Progress: ${processedCount.toLocaleString()}/${historicalCandles.length.toLocaleString()} candles (${rate}/sec) | Errors: ${errorCount}`);
          }

        } catch (err) {
          errorCount++;
          if (errorCount <= 5) {
            console.error(`❌ Error processing candle #${processedCount}:`, err.message);
          }
            console.error(err.stack);
        }
      }

      // Final summary
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n✅ BACKTEST COMPLETE!`);
      console.log(`   📊 Candles processed: ${processedCount.toLocaleString()}`);
      console.log(`   ⏱️  Duration: ${totalTime}s`);
      console.log(`   ⚡ Rate: ${(processedCount / totalTime).toFixed(0)} candles/sec`);
      console.log(`   ❌ Errors: ${errorCount}`);
      console.log(`   💰 Final Balance: $${stateManager.get('balance').toFixed(2)}`);
      console.log(`   📈 Total P&L: $${(stateManager.get('balance') - 10000).toFixed(2)} (${((stateManager.get('balance') / 10000 - 1) * 100).toFixed(2)}%)`);

      // Pattern Learning Summary - Visual proof patterns are being recorded
      if (this.ctx.patternChecker?.getMemoryStats) {
        const patternStats = this.ctx.patternChecker.getMemoryStats();
        const wins = patternStats.totalWins || 0;
        const losses = patternStats.totalLosses || 0;
        const totalTrades = wins + losses;
        const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
        console.log(`\n   🧠 PATTERN LEARNING SUMMARY:`);
        console.log(`      📊 Patterns Recorded: ${patternStats.tradeResults || 0}`);
        console.log(`      ✅ Wins: ${wins}`);
        console.log(`      ❌ Losses: ${losses}`);
        console.log(`      📈 Win Rate: ${winRate}%`);
        console.log(`      🎯 Promoted Patterns: ${patternStats.promoted || 0}`);
        console.log(`      🔬 Candidates: ${patternStats.candidates || 0}`);
      }

      // Generate backtest report
      const reportPath = path.join(this.ctx.__dirname, `backtest-report-v14MERGED-${Date.now()}.json`);

      // Collect trades from execution layer (if available)
      const trades = this.ctx.executionLayer?.trades || [];
      const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

      const report = {
        summary: {
          initialBalance: 10000,
          finalBalance: stateManager.get('balance'),
          totalReturn: ((stateManager.get('balance') / 10000 - 1) * 100),
          totalPnL: stateManager.get('balance') - 10000,
          duration: `${totalTime}s`,
          candlesProcessed: processedCount,
          errors: errorCount
        },
        metrics: {
          totalTrades: trades.length,
          winningTrades: trades.filter(t => t.pnl > 0).length,
          losingTrades: trades.filter(t => t.pnl < 0).length,
          winRate: trades.length > 0 ? trades.filter(t => t.pnl > 0).length / trades.length : 0,
          totalPnL: totalPnL
        },
        trades: trades,
        config: {
          initialBalance: 10000,
          tier: process.env.SUBSCRIPTION_TIER?.toUpperCase() || 'ML'
        },
        timestamp: new Date().toISOString()
      };

      // Write report FIRST (sync to prevent 0-byte files on timeout/exit)
      // FIX 2026-02-19: Try/catch with console fallback to prevent losing results on EMFILE
      try {
        require('fs').writeFileSync(reportPath, JSON.stringify(report, null, 2));
      } catch (err) {
        console.error('⚠️ Could not write report file: ' + err.message);
        console.log('📊 === BACKTEST RESULTS (CONSOLE DUMP) ===');
        console.log('Final Balance: $' + report.summary.finalBalance);
        console.log('Total P&L: $' + report.summary.totalPnL + ' (' + report.summary.totalReturn + '%)');
        console.log('Total Trades: ' + (report.metrics.totalTrades || 'N/A'));
        console.log('Win Rate: ' + (report.metrics.winRate || 'N/A'));
        console.log('📊 === END CONSOLE DUMP ===');
      }
      console.log(`\n📄 Report saved: ${reportPath}`);

      // FIX 2026-02-10: Save pattern memory after backtest (was never being saved!)
      // FIX 2026-02-19: Await async cleanup to ensure save completes before exit
      if (this.ctx.patternChecker?.cleanup) {
        await this.ctx.patternChecker.cleanup();
        console.log('🧠 Backtest patterns saved to disk');
      }

      // 🤖 TRAI Analysis of Backtest Results (Change 586)
      // Run AFTER report is saved so we always have results even if TRAI hangs
      if (this.ctx.trai && this.ctx.trai.analyzeBacktestResults) {
        console.log('\n🤖 [TRAI] Analyzing backtest results for optimization insights...');
        try {
          const traiAnalysis = await this.ctx.trai.analyzeBacktestResults(report);
          report.traiAnalysis = traiAnalysis;
          console.log('✅ TRAI Analysis Complete:', traiAnalysis.summary);
          // Re-save with TRAI analysis appended
          require('fs').writeFileSync(reportPath, JSON.stringify(report, null, 2));
        } catch (error) {
          console.error('⚠️ TRAI analysis failed:', error.message);
        }
      }

      // CHANGE 2026-02-23: Print BacktestRecorder summary with fees and export CSV
      if (this.ctx.backtestRecorder) {
        this.ctx.backtestRecorder.printSummary();
        this.ctx.backtestRecorder.exportCSV('./backtest-trades.csv');
      }

      // Exit after backtest
      console.log('\n🛑 Backtest complete - exiting...');
      process.exit(0);

    } catch (err) {
      console.error('❌ BACKTEST FAILED:', err.message);
      console.error(err.stack);
      process.exit(1);
    }
  }
}

module.exports = BacktestRunner;
