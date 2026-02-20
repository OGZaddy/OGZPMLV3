#!/usr/bin/env node
/**
 * Grid Search: MIN_TRADE_CONFIDENCE threshold optimization
 * Tests values: 0.05, 0.10, 0.15, 0.20, 0.25, 0.30
 * On 60k polygon candles
 *
 * Usage:
 *   node tools/grid-search-confidence.js           # Sequential (safe)
 *   node tools/grid-search-confidence.js --parallel # Parallel (fast, needs 6+ cores)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const THRESHOLDS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
const CANDLE_LIMIT = 60000;
const WORK_DIR = path.resolve(__dirname, '..');
const DATA_FILE = path.join(WORK_DIR, 'data/polygon-btc-1y.json');

const PARALLEL = process.argv.includes('--parallel') || process.argv.includes('-p');

function runBacktest(threshold) {
  return new Promise((resolve) => {
    const pct = (threshold * 100).toFixed(0);
    const logFile = path.join(WORK_DIR, `grid-${pct}pct.log`);
    const startTime = Date.now();

    console.log(`[${pct}%] Starting backtest...`);

    const env = {
      ...process.env,
      BACKTEST_MODE: 'true',
      BACKTEST_FAST: 'true',
      EXIT_SYSTEM: 'legacy',
      PATTERN_DOMINANCE: 'false',
      CANDLE_LIMIT: String(CANDLE_LIMIT),
      CANDLE_DATA_FILE: DATA_FILE,
      MIN_TRADE_CONFIDENCE: String(threshold),
      DEBUG_AGG: '0',
      DEBUG_BRAIN: '0'
    };

    const child = spawn('node', ['run-empire-v2.js'], {
      cwd: WORK_DIR,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      console.log(`[${pct}%] TIMEOUT after 40 minutes`);
    }, 40 * 60 * 1000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      const log = stdout + stderr;
      fs.writeFileSync(logFile, log);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      let metrics = { trades: 0, wins: 0, losses: 0, pnl: 0 };

      // Parse from report file
      const reportMatch = log.match(/Report saved: ([^\s]+\.json)/);
      if (reportMatch) {
        try {
          const report = JSON.parse(fs.readFileSync(reportMatch[1], 'utf8'));
          metrics.trades = report.metrics?.totalTrades || 0;
          metrics.wins = report.metrics?.winningTrades || 0;
          metrics.losses = report.metrics?.losingTrades || 0;
          metrics.pnl = report.summary?.totalReturn || 0;
        } catch (e) { /* ignore */ }
      }

      // Fallback parsing
      if (metrics.trades === 0) {
        const pnlMatch = log.match(/Total P&L: \$[+-]?\d+\.?\d* \(([+-]?\d+\.?\d*)%\)/);
        if (pnlMatch) metrics.pnl = parseFloat(pnlMatch[1]);
        metrics.trades = (log.match(/BUY DECISION:/g) || []).length;
      }

      // Parse pattern learning stats (more accurate trade count)
      const winsMatch = log.match(/Wins: (\d+)/);
      const lossesMatch = log.match(/Losses: (\d+)/);
      if (winsMatch) metrics.wins = parseInt(winsMatch[1]);
      if (lossesMatch) metrics.losses = parseInt(lossesMatch[1]);

      const winRate = (metrics.wins + metrics.losses) > 0
        ? (metrics.wins / (metrics.wins + metrics.losses)) * 100
        : 0;

      const result = {
        threshold: pct + '%',
        thresholdNum: threshold,
        trades: metrics.wins + metrics.losses,
        wins: metrics.wins,
        losses: metrics.losses,
        winRate: winRate.toFixed(1) + '%',
        winRateNum: winRate,
        pnl: metrics.pnl.toFixed(2) + '%',
        pnlNum: metrics.pnl,
        duration: duration + 's'
      };

      console.log(`[${pct}%] Done: ${result.trades} trades, ${result.winRate} win rate, ${result.pnl} P&L (${duration}s)`);
      resolve(result);
    });
  });
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     MIN_TRADE_CONFIDENCE GRID SEARCH                       ║');
  console.log('║     Testing: 5%, 10%, 15%, 20%, 25%, 30%                   ║');
  console.log('║     Data: 60k polygon candles                              ║');
  console.log(`║     Mode: ${PARALLEL ? 'PARALLEL (all 6 at once)' : 'Sequential'}                         ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  const totalStart = Date.now();
  let results;

  if (PARALLEL) {
    console.log('Launching all 6 backtests in parallel...\n');
    results = await Promise.all(THRESHOLDS.map(t => runBacktest(t)));
  } else {
    results = [];
    for (const threshold of THRESHOLDS) {
      results.push(await runBacktest(threshold));
    }
  }

  // Sort by threshold for display
  results.sort((a, b) => a.thresholdNum - b.thresholdNum);

  const totalDuration = ((Date.now() - totalStart) / 1000 / 60).toFixed(1);

  console.log('\n' + '═'.repeat(70));
  console.log('GRID SEARCH RESULTS');
  console.log('═'.repeat(70));
  console.log('');
  console.log('| Threshold | Trades | Wins | Losses | Win Rate | P&L      |');
  console.log('|-----------|--------|------|--------|----------|----------|');

  for (const r of results) {
    console.log(`| ${r.threshold.padEnd(9)} | ${String(r.trades).padEnd(6)} | ${String(r.wins).padEnd(4)} | ${String(r.losses).padEnd(6)} | ${r.winRate.padEnd(8)} | ${r.pnl.padEnd(8)} |`);
  }

  console.log('');
  console.log(`Total duration: ${totalDuration} minutes`);

  // Find sweet spot - score balances trades, win rate, and P&L
  const validResults = results.filter(r => r.trades > 0);
  if (validResults.length > 0) {
    // Score formula: trades * winRate * (1 + pnl/10)
    // Rewards: more trades, higher win rate, positive P&L
    const scored = validResults.map(r => ({
      ...r,
      score: r.trades * (r.winRateNum / 100) * (1 + r.pnlNum / 10)
    }));
    scored.sort((a, b) => b.score - a.score);

    console.log('');
    console.log('SWEET SPOT ANALYSIS:');
    console.log('─'.repeat(50));
    for (let i = 0; i < Math.min(3, scored.length); i++) {
      const r = scored[i];
      console.log(`  #${i+1}: ${r.threshold} threshold`);
      console.log(`      ${r.trades} trades, ${r.winRate} win rate, ${r.pnl} P&L`);
      console.log(`      Score: ${r.score.toFixed(2)}`);
    }
    console.log('');
    console.log(`RECOMMENDATION: Use MIN_TRADE_CONFIDENCE=${scored[0].thresholdNum}`);
  }

  // Save results
  const resultsFile = path.join(WORK_DIR, 'grid-search-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${resultsFile}`);
}

main().catch(console.error);
