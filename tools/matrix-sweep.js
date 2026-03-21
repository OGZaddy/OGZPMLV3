#!/usr/bin/env node
/**
 * OGZPrime MATRIX SWEEP BACKTESTER
 * =================================
 *
 * THE FULL OPTIMIZATION MATRIX.
 *
 * Tests every strategy individually x every exit config x every confidence level.
 * Each combination runs in isolation (SOLO_STRATEGY) through the real trading pipeline.
 *
 * What this produces:
 *   A complete Strategy x Exit x Confidence config matrix telling you
 *   the BEST parameters for each strategy, backed by data not guesses.
 *
 * Dimensions (full grid):
 *   Strategies:  RSI, EMASMACrossover, MADynamicSR, LiquiditySweep (4 validated)
 *   Stop Loss:   [0.5, 0.8, 1.0, 1.5, 2.0, 3.0] (6 values)
 *   Take Profit: [1.0, 1.5, 2.0, 2.5, 3.0, 4.0] (6 values, where TP > SL)
 *   Confidence:  [0.30, 0.40, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75] (8 values)
 *
 *   = 4 strategies x 25 valid SL/TP combos x 8 confidence levels = 800 configs
 *   At ~30s each with 14 workers on 7800X3D = ~30 minutes total
 *
 * Usage:
 *   node tools/matrix-sweep.js --data tsla              # Full matrix, all strategies
 *   node tools/matrix-sweep.js --data tsla --solo=RSI   # RSI only (200 configs)
 *   node tools/matrix-sweep.js --data tsla --phase exits # Just SL/TP sweep, locked conf
 *   node tools/matrix-sweep.js --data tsla --phase conf  # Just confidence, locked exits
 *   node tools/matrix-sweep.js --data tsla --quick       # Reduced grid (fast sanity check)
 *
 * Output:
 *   backtest-results/matrix-{timestamp}.json    Full results
 *   backtest-results/matrix-{timestamp}.csv     Spreadsheet-friendly
 *   Console: Per-strategy leaderboard + best config per strategy
 *
 * WORKFLOW (from handoff doc):
 *   1. Isolate one strategy
 *   2. Tune entries: confidence sweep (--phase conf)
 *   3. Tune exits: SL/TP sweep (--phase exits)
 *   4. Retest combined: stacked winners dont always stay winners
 *   5. Validate on unseen data: train/validate/test split
 *
 * @author Claude Opus (Architect) for Trey / OGZPrime
 * @date 2026-03-20
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ===================================================================
// HARDWARE DETECTION
// ===================================================================
const cpuModel = os.cpus()[0]?.model || 'Unknown';
const threadCount = os.cpus().length;
const is7800X3D = cpuModel.includes('7800X3D');
const MAX_WORKERS = Math.max(1, is7800X3D ? 14 : threadCount - 2);

// ===================================================================
// PATHS
// ===================================================================
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(PROJECT_ROOT, 'run-empire-v2.js');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ===================================================================
// DATA FILE SHORTCUTS
// ===================================================================
const DATA_SHORTCUTS = {
  'tsla': 'tuning/tsla-15m-2y.json',
  'tsla-train': 'tuning/tsla-15m-train.json',
  'tsla-test': 'tuning/tsla-15m-test.json',
  'spy': 'tuning/spy-15m-2y.json',
  'qqq': 'tuning/qqq-15m-2y.json',
  'nvda': 'tuning/nvda-15m-2y.json',
  'riot': 'tuning/riot-15m-2y.json',
  'mara': 'tuning/mara-15m-2y.json',
  'coin': 'tuning/coin-15m-2y.json',
  'btc': 'data/polygon-btc-1y.json',
};
const STOCK_TICKERS = ['tsla', 'spy', 'qqq', 'nvda', 'riot', 'mara', 'coin',
                        'tsla-train', 'tsla-test'];

// ===================================================================
// MATRIX DIMENSIONS - The search space
// ===================================================================

// Strategies that have validated walk-forward results
const VALIDATED_STRATEGIES = ['RSI', 'EMASMACrossover', 'MADynamicSR', 'LiquiditySweep'];

// All registered strategies (for exploratory sweeps)
const ALL_STRATEGIES = [
  ...VALIDATED_STRATEGIES,
  'MarketRegime', 'MultiTimeframe', 'OGZTPO', 'OpeningRangeBreakout',
];

const GRID = {
  // Full grid
  full: {
    stopLoss:   [0.5, 0.8, 1.0, 1.5, 2.0, 3.0],
    takeProfit: [1.0, 1.5, 2.0, 2.5, 3.0, 4.0],
    confidence: [0.30, 0.40, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75],
  },
  // Quick sanity check (reduced grid)
  quick: {
    stopLoss:   [0.5, 0.8, 1.5],
    takeProfit: [1.0, 2.0, 3.0],
    confidence: [0.40, 0.55, 0.70],
  },
  // Exit-only phase (locked confidence at current best)
  exits: {
    stopLoss:   [0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 2.5, 3.0],
    takeProfit: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0],
    confidence: [0.60],  // Locked at current validated value
  },
  // Confidence-only phase (locked exits at current best per strategy)
  conf: {
    stopLoss:   null,  // Uses per-strategy locked exits
    takeProfit: null,
    confidence: [0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80],
  },
};

// Locked exits per strategy (from walk-forward validation)
const LOCKED_EXITS = {
  RSI:              { sl: 0.8, tp: 1.0 },
  EMASMACrossover:  { sl: 0.5, tp: 1.0 },
  MADynamicSR:      { sl: 0.8, tp: 1.0 },
  LiquiditySweep:   { sl: 2.0, tp: 2.5 },  // Fallback - uses structural exits
};

// ===================================================================
// MATRIX GENERATOR - Builds the combinatorial config list
// ===================================================================

function generateMatrix(strategies, grid, phase) {
  const configs = [];

  for (const strat of strategies) {
    // Get exit grid: if phase='conf', use locked exits
    let slValues, tpValues;
    if (phase === 'conf' || !grid.stopLoss) {
      const locked = LOCKED_EXITS[strat] || { sl: 1.0, tp: 2.0 };
      slValues = [locked.sl];
      tpValues = [locked.tp];
    } else {
      slValues = grid.stopLoss;
      tpValues = grid.takeProfit;
    }

    for (const sl of slValues) {
      for (const tp of tpValues) {
        // Skip invalid combos: TP must be > SL for positive expectancy
        if (tp <= sl && slValues.length > 1) continue;

        for (const conf of grid.confidence) {
          const shortName = strat.substring(0, 4);
          const name = shortName + '_sl' + sl + '_tp' + tp + '_c' + (conf * 100).toFixed(0);

          configs.push({
            name,
            strategy: strat,
            sl, tp, conf,
            env: {
              SOLO_STRATEGY: strat,
              STOP_LOSS_PERCENT: String(sl),
              TAKE_PROFIT_PERCENT: String(tp),
              MIN_TRADE_CONFIDENCE: String(conf),
            },
          });
        }
      }
    }
  }

  return configs;
}

// ===================================================================
// WORKER - Runs a single backtest as child process
// (Same pattern as parallel-backtest.js)
// ===================================================================

function runWorker(config, dataFile, stockMode) {
  return new Promise(function(resolve) {
    var startTime = Date.now();
    var uid = 'matrix-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
    var stateFile = path.join(PROJECT_ROOT, 'data', 'state-' + uid + '.json');

    // Clean env: dont inherit stale trading vars from shell
    var cleanEnv = Object.assign({}, process.env);
    delete cleanEnv.STOP_LOSS_PERCENT;
    delete cleanEnv.TAKE_PROFIT_PERCENT;
    delete cleanEnv.MIN_TRADE_CONFIDENCE;
    delete cleanEnv.TRAILING_STOP_PERCENT;
    delete cleanEnv.ATR_MIN_PERCENT;
    delete cleanEnv.SOLO_STRATEGY;

    var env = Object.assign({}, cleanEnv, {
      EXECUTION_MODE: 'backtest',
      CANDLE_SOURCE: 'file',
      BACKTEST_MODE: 'true',
      BACKTEST_SILENT: 'true',
      BACKTEST_VERBOSE: 'false',
      BACKTEST_FAST: 'true',
      INITIAL_BALANCE: '10000',
      CANDLE_DATA_FILE: path.resolve(PROJECT_ROOT, dataFile),
      STATE_FILE: stateFile,
      DATA_DIR: path.join(PROJECT_ROOT, 'data', 'backtest'),
      PAPER_TRADING: 'true',
      TEST_MODE: 'true',
      BACKTEST_NO_PATTERN_SAVE: 'true',
      SKIP_CSV_EXPORT: 'true',
      ENABLE_DASHBOARD: 'false',
      SENTRY_DSN: '',
      NODE_ENV: 'test',
      BACKTEST_REPORT_TAG: uid,
      STRATEGY_DIAG: 'false',
    }, stockMode ? { FEE_MAKER: '0', FEE_TAKER: '0' } : {}, config.env);

    var output = '';
    var child = spawn('node', [RUNNER], {
      cwd: PROJECT_ROOT,
      env: env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', function(d) { output += d.toString(); });
    child.stderr.on('data', function(d) { output += d.toString(); });

    child.on('close', function(code) {
      var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      var result = parseOutput(output, config);

      // Try reading report JSON as fallback
      if (result.trades == null) {
        var reportResult = tryReadReport(PROJECT_ROOT);
        if (reportResult) Object.assign(result, reportResult);
      }

      result.elapsed = elapsed;
      result.exitCode = code;

      // Cleanup
      try { fs.unlinkSync(stateFile); } catch (e) {}

      resolve(result);
    });

    child.on('error', function(err) {
      resolve({
        name: config.name,
        strategy: config.strategy,
        sl: config.sl, tp: config.tp, conf: config.conf,
        error: err.message,
        elapsed: ((Date.now() - startTime) / 1000).toFixed(1),
      });
    });
  });
}

function parseOutput(output, config) {
  var r = {
    name: config.name,
    strategy: config.strategy,
    sl: config.sl,
    tp: config.tp,
    conf: config.conf,
  };

  var bal = output.match(/Final Balance:\s*\$?([\d,.]+)/);
  var trades = output.match(/Total Trades:\s*(\d+)/);
  var wr = output.match(/Win Rate:\s*([\d.]+)%/);
  var pnl = output.match(/Net P&L:\s*\$?([-\d,.]+)/);
  var fees = output.match(/Total Fees.*?:\s*\$?([\d,.]+)/);
  var dd = output.match(/Max Drawdown:\s*([\d.]+)%/);
  var pf = output.match(/Profit Factor:\s*([\d.]+)/);
  var exp = output.match(/Expectancy:\s*\$?([-\d,.]+)/);
  var avgWin = output.match(/Avg Win:\s*\$?([\d,.]+)/);
  var avgLoss = output.match(/Avg Loss:\s*\$?([-\d,.]+)/);

  r.finalBalance = bal ? parseFloat(bal[1].replace(',', '')) : null;
  r.trades = trades ? parseInt(trades[1]) : null;
  r.winRate = wr ? parseFloat(wr[1]) : null;
  r.netPnl = pnl ? parseFloat(pnl[1].replace(',', '')) : null;
  r.fees = fees ? parseFloat(fees[1].replace(',', '')) : null;
  r.maxDrawdown = dd ? parseFloat(dd[1]) : null;
  r.profitFactor = pf ? parseFloat(pf[1]) : null;
  r.expectancy = exp ? parseFloat(exp[1].replace(',', '')) : null;
  r.avgWin = avgWin ? parseFloat(avgWin[1].replace(',', '')) : null;
  r.avgLoss = avgLoss ? parseFloat(avgLoss[1].replace(',', '')) : null;

  if (r.finalBalance && r.netPnl == null) {
    r.netPnl = r.finalBalance - 10000;
  }

  return r;
}

function tryReadReport(projectRoot) {
  try {
    var reports = fs.readdirSync(projectRoot)
      .filter(function(f) { return f.startsWith('backtest-report-') && f.endsWith('.json'); })
      .map(function(f) { return { name: f, mtime: fs.statSync(path.join(projectRoot, f)).mtimeMs }; })
      .sort(function(a, b) { return b.mtime - a.mtime; });

    if (reports.length === 0) return null;
    var reportPath = path.join(projectRoot, reports[0].name);
    var data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    try { fs.unlinkSync(reportPath); } catch (e) {}

    var tradeList = data.trades || [];
    var summary = data.summary || {};
    if (tradeList.length === 0 && !summary.finalBalance) return null;

    var winners = tradeList.filter(function(t) { return (t.netPnlDollars || t.pnl || 0) > 0; });
    var totalFees = tradeList.reduce(function(s, t) { return s + (t.feesDollars || 0); }, 0);
    var netPnl = summary.finalBalance ? summary.finalBalance - 10000 :
                 tradeList.reduce(function(s, t) { return s + (t.netPnlDollars || 0); }, 0);

    return {
      finalBalance: summary.finalBalance || null,
      trades: tradeList.length || (summary.totalTrades || null),
      winRate: tradeList.length > 0 ? (winners.length / tradeList.length) * 100 : null,
      netPnl: netPnl,
      fees: totalFees || null,
    };
  } catch (e) { return null; }
}

// ===================================================================
// PARALLEL RUNNER
// ===================================================================

async function runMatrix(configs, dataFile, stockMode) {
  var totalStart = Date.now();

  console.log('\n' + '='.repeat(72));
  console.log('  OGZPrime MATRIX SWEEP' + (stockMode ? ' [STOCK MODE]' : ''));
  console.log('  ' + cpuModel + ' | ' + threadCount + ' threads | ' + MAX_WORKERS + ' workers');
  console.log('  ' + configs.length + ' configurations to test');
  console.log('  Data: ' + dataFile);
  console.log('  ETA: ~' + Math.ceil(configs.length / MAX_WORKERS * 30 / 60) + ' minutes');
  console.log('='.repeat(72) + '\n');

  // Show strategy breakdown
  var stratCounts = {};
  configs.forEach(function(c) { stratCounts[c.strategy] = (stratCounts[c.strategy] || 0) + 1; });
  Object.entries(stratCounts).forEach(function(e) { console.log('  ' + e[0] + ': ' + e[1] + ' configs'); });
  console.log('');

  var results = [];
  var completed = 0;

  for (var i = 0; i < configs.length; i += MAX_WORKERS) {
    var batch = configs.slice(i, i + MAX_WORKERS);
    var batchNum = Math.floor(i / MAX_WORKERS) + 1;
    var totalBatches = Math.ceil(configs.length / MAX_WORKERS);
    var pct = ((completed / configs.length) * 100).toFixed(0);

    process.stdout.write('  Batch ' + batchNum + '/' + totalBatches + ' (' + pct + '% done, ' + batch.length + ' workers)...');

    var batchResults = await Promise.all(
      batch.map(function(c) { return runWorker(c, dataFile, stockMode); })
    );

    batchResults.forEach(function(r) { results.push(r); });
    completed += batch.length;

    // Quick status line
    var successes = batchResults.filter(function(r) { return r.netPnl != null; }).length;
    var bestInBatch = batchResults
      .filter(function(r) { return r.netPnl != null; })
      .sort(function(a, b) { return b.netPnl - a.netPnl; })[0];
    var bestStr = bestInBatch ? 'best=$' + bestInBatch.netPnl.toFixed(0) : 'no results';
    console.log(' ' + successes + '/' + batch.length + ' parsed, ' + bestStr);
  }

  var totalTime = ((Date.now() - totalStart) / 1000).toFixed(1);

  // -- Per-strategy analysis --
  var strategies = [];
  results.forEach(function(r) { if (strategies.indexOf(r.strategy) === -1) strategies.push(r.strategy); });
  var parsed = results.filter(function(r) { return r.netPnl != null; });

  console.log('\n' + '='.repeat(72));
  console.log('  MATRIX RESULTS - ' + parsed.length + '/' + results.length + ' parsed in ' + totalTime + 's');
  console.log('='.repeat(72));

  var bestPerStrategy = {};

  for (var si = 0; si < strategies.length; si++) {
    var strat = strategies[si];
    var stratResults = parsed
      .filter(function(r) { return r.strategy === strat; })
      .sort(function(a, b) { return b.netPnl - a.netPnl; });

    if (stratResults.length === 0) {
      console.log('\n  ' + strat + ': No parseable results');
      continue;
    }

    var best = stratResults[0];
    var worst = stratResults[stratResults.length - 1];
    var profitable = stratResults.filter(function(r) { return r.netPnl > 0; });
    var median = stratResults[Math.floor(stratResults.length / 2)];

    bestPerStrategy[strat] = best;

    console.log('\n  +-- ' + strat + ' (' + stratResults.length + ' configs tested) -----');
    console.log('  |');
    console.log('  |  BEST:   SL=' + best.sl + '% TP=' + best.tp + '% Conf=' + (best.conf * 100).toFixed(0) + '%');
    console.log('  |          P&L: $' + best.netPnl.toFixed(2) + ' | ' + (best.trades || '?') + ' trades | WR: ' + (best.winRate != null ? best.winRate.toFixed(1) : '?') + '%');
    if (best.maxDrawdown != null) {
      console.log('  |          DD: ' + best.maxDrawdown.toFixed(1) + '% | PF: ' + (best.profitFactor != null ? best.profitFactor.toFixed(2) : '?'));
    }
    console.log('  |');
    console.log('  |  Median: P&L $' + median.netPnl.toFixed(2) + ' | Worst: $' + worst.netPnl.toFixed(2));
    console.log('  |  Profitable: ' + profitable.length + '/' + stratResults.length + ' (' + (profitable.length / stratResults.length * 100).toFixed(0) + '%)');
    console.log('  |');

    // Show top 5
    console.log('  |  Top 5:');
    stratResults.slice(0, 5).forEach(function(r, idx) {
      console.log('  |   #' + (idx + 1) + ' SL=' + r.sl + ' TP=' + r.tp + ' C=' + (r.conf * 100).toFixed(0) + '%  ->  $' + r.netPnl.toFixed(2) + ' | ' + (r.trades || '?') + ' trades | WR ' + (r.winRate != null ? r.winRate.toFixed(1) : '?') + '%');
    });

    // Sensitivity check: are neighboring configs also profitable?
    if (stratResults.length >= 3) {
      var top3 = stratResults.slice(0, 3);
      var allClose = top3.every(function(r) { return r.netPnl > 0; });
      console.log('  |');
      console.log('  |  ' + (allClose ? 'ROBUST' : 'WARNING') + ': Top 3 all profitable = ' + (allClose ? 'YES (robust)' : 'NO (fragile, may be overfit)'));
    }
    console.log('  +------------------------------------------------------');
  }

  // -- Cross-strategy summary --
  console.log('\n' + '='.repeat(72));
  console.log('  BEST CONFIG PER STRATEGY (copy to TradingConfig.exitContracts)');
  console.log('='.repeat(72));

  Object.entries(bestPerStrategy).forEach(function(e) {
    var stName = e[0], b = e[1];
    console.log('  ' + stName + ': { stopLossPercent: -' + b.sl + ', takeProfitPercent: ' + b.tp + ' }  // conf=' + (b.conf * 100).toFixed(0) + '% -> $' + b.netPnl.toFixed(2));
  });

  // -- Save results --
  var timestamp = Date.now();
  var reportPath = path.join(RESULTS_DIR, 'matrix-' + timestamp + '.json');
  var csvPath = path.join(RESULTS_DIR, 'matrix-' + timestamp + '.csv');

  // JSON report
  var report = {
    timestamp: new Date().toISOString(),
    hardware: { cpu: cpuModel, threads: threadCount, workers: MAX_WORKERS },
    dataFile: dataFile,
    stockMode: stockMode,
    totalConfigs: configs.length,
    parsedConfigs: parsed.length,
    totalTime: totalTime + 's',
    bestPerStrategy: bestPerStrategy,
    results: parsed.sort(function(a, b) { return b.netPnl - a.netPnl; }),
    failed: results.filter(function(r) { return r.netPnl == null; }).map(function(r) {
      return { name: r.name, strategy: r.strategy, elapsed: r.elapsed, exitCode: r.exitCode };
    }),
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('\nJSON: ' + reportPath);

  // CSV for spreadsheet analysis
  var csvHeader = 'strategy,stopLoss,takeProfit,confidence,netPnl,trades,winRate,maxDrawdown,profitFactor,expectancy,avgWin,avgLoss,fees,elapsed';
  var csvRows = parsed.map(function(r) {
    return [r.strategy, r.sl, r.tp, r.conf,
      r.netPnl != null ? r.netPnl.toFixed(2) : '',
      r.trades || '', r.winRate != null ? r.winRate.toFixed(2) : '',
      r.maxDrawdown != null ? r.maxDrawdown.toFixed(2) : '',
      r.profitFactor != null ? r.profitFactor.toFixed(2) : '',
      r.expectancy != null ? r.expectancy.toFixed(2) : '',
      r.avgWin != null ? r.avgWin.toFixed(2) : '',
      r.avgLoss != null ? r.avgLoss.toFixed(2) : '',
      r.fees != null ? r.fees.toFixed(2) : '',
      r.elapsed].join(',');
  });
  fs.writeFileSync(csvPath, [csvHeader].concat(csvRows).join('\n'));
  console.log('CSV: ' + csvPath);

  // -- Summary --
  var overallBest = parsed.sort(function(a, b) { return b.netPnl - a.netPnl; })[0];
  if (overallBest) {
    console.log('\nOVERALL BEST: ' + overallBest.strategy + ' SL=' + overallBest.sl + '% TP=' + overallBest.tp + '% Conf=' + (overallBest.conf * 100).toFixed(0) + '%');
    console.log('   P&L: $' + overallBest.netPnl.toFixed(2) + ' | Trades: ' + overallBest.trades + ' | WR: ' + (overallBest.winRate != null ? overallBest.winRate.toFixed(1) : '?') + '%');
  }

  return report;
}

// ===================================================================
// CLI
// ===================================================================

async function main() {
  var args = process.argv.slice(2);
  var dataFile = 'tuning/tsla-15m-2y.json';
  var stockMode = false;
  var phase = 'full';       // full | exits | conf | quick
  var soloStrategy = null;  // null = all validated strategies
  var useAllStrategies = false;

  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--data' && args[i + 1]) {
      var val = args[++i].toLowerCase();
      dataFile = DATA_SHORTCUTS[val] || args[i];
      if (STOCK_TICKERS.indexOf(val) !== -1) stockMode = true;
    } else if (args[i].indexOf('--data=') === 0) {
      var dval = args[i].split('=')[1].toLowerCase();
      dataFile = DATA_SHORTCUTS[dval] || args[i].split('=')[1];
      if (STOCK_TICKERS.indexOf(dval) !== -1) stockMode = true;
    } else if (args[i] === '--phase' && args[i + 1]) {
      phase = args[++i];
    } else if (args[i].indexOf('--phase=') === 0) {
      phase = args[i].split('=')[1];
    } else if (args[i] === '--quick') {
      phase = 'quick';
    } else if (args[i] === '--full') {
      phase = 'full';
    } else if (args[i] === '--exits') {
      phase = 'exits';
    } else if (args[i] === '--conf') {
      phase = 'conf';
    } else if (args[i].indexOf('--solo=') === 0) {
      soloStrategy = args[i].split('=')[1];
    } else if (args[i] === '--solo' && args[i + 1]) {
      soloStrategy = args[++i];
    } else if (args[i] === '--all-strategies') {
      useAllStrategies = true;
    } else if (args[i] === '--stocks') {
      stockMode = true;
    } else if (DATA_SHORTCUTS[args[i] ? args[i].toLowerCase() : '']) {
      var key = args[i].toLowerCase();
      dataFile = DATA_SHORTCUTS[key];
      if (STOCK_TICKERS.indexOf(key) !== -1) stockMode = true;
    } else if (args[i] === '--help') {
      console.log('\nOGZPrime Matrix Sweep Backtester');
      console.log('================================\n');
      console.log('Usage: node tools/matrix-sweep.js [options]\n');
      console.log('Phases (what to sweep):');
      console.log('  --full         Full matrix: SL x TP x Confidence (default)');
      console.log('  --quick        Reduced grid (fast sanity check)');
      console.log('  --exits        SL/TP sweep only (confidence locked)');
      console.log('  --conf         Confidence sweep only (exits locked)\n');
      console.log('Strategy Selection:');
      console.log('  --solo=RSI          Test only RSI');
      console.log('  --solo=EMA          Test only EMASMACrossover');
      console.log('  --all-strategies    Test ALL strategies\n');
      console.log('Data:');
      console.log('  --data tsla    TSLA 15m 2-year (default)');
      console.log('  --data spy     SPY, --data qqq, nvda, riot, etc.');
      console.log('  --stocks       Force zero-commission mode\n');
      console.log('Examples:');
      console.log('  node tools/matrix-sweep.js --data tsla');
      console.log('  node tools/matrix-sweep.js --data tsla --solo=RSI --conf');
      console.log('  node tools/matrix-sweep.js --data tsla --solo=EMA --exits');
      console.log('  node tools/matrix-sweep.js --data tsla --quick');
      console.log('  node tools/matrix-sweep.js --data spy --stocks\n');
      console.log('Walk-Forward Workflow:');
      console.log('  1. Run --exits on training data:  --data tsla-train --exits');
      console.log('  2. Lock best SL/TP per strategy');
      console.log('  3. Run --conf on training data:   --data tsla-train --conf');
      console.log('  4. Lock best confidence');
      console.log('  5. Validate on test data:         --data tsla-test');
      console.log('  6. Compare train vs test P&L (WFE > 60% = robust)');
      process.exit(0);
    }
  }

  // Resolve solo strategy (prefix match)
  var strategies = useAllStrategies ? ALL_STRATEGIES : VALIDATED_STRATEGIES;
  if (soloStrategy) {
    var match = ALL_STRATEGIES.find(function(s) {
      return s.toLowerCase().indexOf(soloStrategy.toLowerCase()) === 0;
    });
    if (!match) {
      console.error('Unknown strategy: ' + soloStrategy);
      console.error('Available: ' + ALL_STRATEGIES.join(', '));
      process.exit(1);
    }
    strategies = [match];
    console.log('[SOLO] Testing only: ' + match);
  }

  // Validate phase
  if (!GRID[phase]) {
    console.error('Unknown phase: ' + phase);
    console.error('Available: ' + Object.keys(GRID).join(', '));
    process.exit(1);
  }

  // Generate matrix
  var configs = generateMatrix(strategies, GRID[phase], phase);

  if (configs.length === 0) {
    console.error('No configurations generated. Check strategy name and phase.');
    process.exit(1);
  }

  console.log('\n  Phase: ' + phase);
  console.log('  Strategies: ' + strategies.join(', '));
  console.log('  Total configs: ' + configs.length);

  await runMatrix(configs, dataFile, stockMode);
}

main().catch(function(err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
