#!/usr/bin/env node
/**
 * Matrix Sweep - Strategy × Timeframe × Confidence × Exits
 * =========================================================
 *
 * Tests ALL combinations independently:
 * - 8 strategies
 * - 3 timeframes (15m, 1h, 4h)
 * - 8 confidence levels (0.10-0.70)
 * - 25 SL/TP combos
 *
 * Results saved to matrix-results/{timestamp}.json
 *
 * Usage:
 *   node tools/matrix-sweep.js --data=tsla --stocks
 *   node tools/matrix-sweep.js --data=btc --timeframe=15m
 *   node tools/matrix-sweep.js --strategy=RSI --timeframe=15m
 *   node tools/matrix-sweep.js --quick  (reduced combos for testing)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(PROJECT_ROOT, 'run-empire-v2.js');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'matrix-results');

// Ensure results directory exists
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════
// MATRIX DIMENSIONS
// ═══════════════════════════════════════════════════════════════

const STRATEGIES = [
  'RSI',
  'EMASMACrossover',
  'MADynamicSR',
  'LiquiditySweep',
  'MarketRegime',
  'MultiTimeframe',
  'OGZTPO',
  'OpeningRangeBreakout'
];

const TIMEFRAMES = ['15m', '1h', '4h'];

const CONFIDENCES = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70];

const EXIT_COMBOS = [
  { sl: 0.5, tp: 1.0 },
  { sl: 0.5, tp: 1.5 },
  { sl: 0.5, tp: 2.0 },
  { sl: 0.8, tp: 1.0 },
  { sl: 0.8, tp: 1.5 },
  { sl: 0.8, tp: 2.0 },
  { sl: 1.0, tp: 1.5 },
  { sl: 1.0, tp: 2.0 },
  { sl: 1.0, tp: 2.5 },
  { sl: 1.5, tp: 2.0 },
  { sl: 1.5, tp: 2.5 },
  { sl: 1.5, tp: 3.0 },
  { sl: 2.0, tp: 2.5 },
  { sl: 2.0, tp: 3.0 },
  { sl: 2.0, tp: 4.0 },
  { sl: 2.5, tp: 3.0 },
  { sl: 2.5, tp: 4.0 },
  { sl: 3.0, tp: 4.0 },
];

// Quick mode - reduced combos for testing
const QUICK_CONFIDENCES = [0.30, 0.50, 0.70];
const QUICK_EXITS = [
  { sl: 0.5, tp: 1.0 },
  { sl: 0.8, tp: 1.0 },
  { sl: 1.0, tp: 2.0 },
  { sl: 2.0, tp: 3.0 },
];

// Data file shortcuts
const DATA_SHORTCUTS = {
  'tsla': 'tuning/tsla-15m-2y.json',
  'tsla-y1': 'tuning/tsla-15m-year1.json',
  'tsla-y2': 'tuning/tsla-15m-year2.json',
  'spy': 'tuning/spy-15m-2y.json',
  'qqq': 'tuning/qqq-15m-2y.json',
  'btc': 'data/polygon-btc-1y.json',
};

// ═══════════════════════════════════════════════════════════════
// SINGLE BACKTEST RUNNER
// ═══════════════════════════════════════════════════════════════

function runBacktest(config) {
  return new Promise((resolve) => {
    const { strategy, timeframe, confidence, sl, tp, dataFile, stockMode } = config;
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const stateFile = path.join(PROJECT_ROOT, 'data', `state-matrix-${uniqueId}.json`);

    // Clean parent env vars
    const cleanEnv = { ...process.env };
    delete cleanEnv.STOP_LOSS_PERCENT;
    delete cleanEnv.TAKE_PROFIT_PERCENT;
    delete cleanEnv.MIN_TRADE_CONFIDENCE;
    delete cleanEnv.TRAILING_STOP_PERCENT;
    delete cleanEnv.ATR_MIN_PERCENT;
    delete cleanEnv.SOLO_STRATEGY;

    const env = {
      ...cleanEnv,
      EXECUTION_MODE: 'backtest',
      CANDLE_SOURCE: 'file',
      BACKTEST_MODE: 'true',
      BACKTEST_FAST: 'true',
      BACKTEST_SILENT: 'true',
      TEST_MODE: 'true',
      PAPER_TRADING: 'true',
      ENABLE_TRAI: 'false',
      KRAKEN_API_KEY: 'backtest',
      KRAKEN_API_SECRET: 'backtest',
      CANDLE_DATA_FILE: path.resolve(PROJECT_ROOT, dataFile),
      STATE_FILE: stateFile,
      DATA_DIR: path.join(PROJECT_ROOT, 'data', 'backtest'),
      // Matrix params
      SOLO_STRATEGY: strategy,
      CANDLE_TIMEFRAME: timeframe,
      MIN_TRADE_CONFIDENCE: String(confidence),
      STOP_LOSS_PERCENT: String(sl),
      TAKE_PROFIT_PERCENT: String(tp),
      // Zero fees for stocks
      ...(stockMode ? { FEE_MAKER: '0', FEE_TAKER: '0' } : {}),
    };

    const child = spawn('node', [RUNNER], {
      env,
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => stdout += d.toString());
    child.stderr.on('data', (d) => stderr += d.toString());

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({
        strategy, timeframe, confidence, sl, tp,
        status: 'timeout',
        pnl: null, trades: null, winRate: null,
      });
    }, 120000); // 2 min timeout per config

    child.on('close', (code) => {
      clearTimeout(timeout);

      // Clean up state file
      try { fs.unlinkSync(stateFile); } catch(e) {}

      // Parse results from stdout
      const result = parseResults(stdout, { strategy, timeframe, confidence, sl, tp });
      result.exitCode = code;
      resolve(result);
    });
  });
}

function parseResults(output, config) {
  const result = { ...config, status: 'ok' };

  // Extract P&L
  const pnlMatch = output.match(/Net P&L.*?:\s*\+?\$?([-\d,.]+)/i) ||
                   output.match(/Final.*?:\s*\$?([\d,.]+)/i);
  if (pnlMatch) {
    result.pnl = parseFloat(pnlMatch[1].replace(',', ''));
  }

  // Extract trades
  const tradesMatch = output.match(/Total Trades.*?:\s*(\d+)/i) ||
                      output.match(/(\d+)\s*trades/i);
  if (tradesMatch) {
    result.trades = parseInt(tradesMatch[1]);
  }

  // Extract win rate
  const wrMatch = output.match(/Win Rate.*?:\s*([\d.]+)%/i) ||
                  output.match(/WR.*?([\d.]+)%/i);
  if (wrMatch) {
    result.winRate = parseFloat(wrMatch[1]);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// MATRIX GENERATOR
// ═══════════════════════════════════════════════════════════════

function generateMatrix(options) {
  const {
    strategies = STRATEGIES,
    timeframes = TIMEFRAMES,
    confidences = options.quick ? QUICK_CONFIDENCES : CONFIDENCES,
    exits = options.quick ? QUICK_EXITS : EXIT_COMBOS,
    dataFile,
    stockMode,
  } = options;

  const configs = [];

  for (const strategy of strategies) {
    for (const timeframe of timeframes) {
      for (const confidence of confidences) {
        for (const exit of exits) {
          configs.push({
            strategy,
            timeframe,
            confidence,
            sl: exit.sl,
            tp: exit.tp,
            dataFile,
            stockMode,
          });
        }
      }
    }
  }

  return configs;
}

// ═══════════════════════════════════════════════════════════════
// PARALLEL EXECUTOR
// ═══════════════════════════════════════════════════════════════

async function runMatrix(configs, maxWorkers = 10) {
  const results = [];
  const total = configs.length;
  let completed = 0;
  let running = 0;
  let index = 0;

  console.log(`\n⏳ Running ${total} configurations with ${maxWorkers} workers...\n`);

  return new Promise((resolve) => {
    function startNext() {
      while (running < maxWorkers && index < configs.length) {
        const config = configs[index++];
        running++;

        runBacktest(config).then((result) => {
          results.push(result);
          completed++;
          running--;

          const pct = ((completed / total) * 100).toFixed(1);
          const pnl = result.pnl != null ? (result.pnl >= 0 ? `+$${result.pnl.toFixed(0)}` : `-$${Math.abs(result.pnl).toFixed(0)}`) : '?';
          console.log(`[${pct}%] ${result.strategy}/${result.timeframe} conf=${result.confidence} sl=${result.sl} tp=${result.tp} → ${pnl}`);

          if (completed === total) {
            resolve(results);
          } else {
            startNext();
          }
        });
      }
    }

    startNext();
  });
}

// ═══════════════════════════════════════════════════════════════
// RESULTS ANALYZER
// ═══════════════════════════════════════════════════════════════

function analyzeResults(results) {
  // Group by strategy × timeframe
  const matrix = {};

  for (const r of results) {
    const key = `${r.strategy}_${r.timeframe}`;
    if (!matrix[key]) {
      matrix[key] = { strategy: r.strategy, timeframe: r.timeframe, configs: [] };
    }
    matrix[key].configs.push(r);
  }

  // Find best config per strategy × timeframe
  const winners = [];
  for (const key of Object.keys(matrix)) {
    const group = matrix[key];
    const best = group.configs
      .filter(c => c.pnl != null)
      .sort((a, b) => b.pnl - a.pnl)[0];

    if (best) {
      winners.push({
        strategy: group.strategy,
        timeframe: group.timeframe,
        bestConf: best.confidence,
        bestSL: best.sl,
        bestTP: best.tp,
        pnl: best.pnl,
        trades: best.trades,
        winRate: best.winRate,
      });
    }
  }

  return { matrix, winners };
}

function printMatrix(winners) {
  console.log('\n' + '═'.repeat(80));
  console.log('  STRATEGY × TIMEFRAME MATRIX WINNERS');
  console.log('═'.repeat(80));

  // Group by strategy
  const byStrategy = {};
  for (const w of winners) {
    if (!byStrategy[w.strategy]) byStrategy[w.strategy] = {};
    byStrategy[w.strategy][w.timeframe] = w;
  }

  console.log('\n  Strategy          │ 15m                  │ 1h                   │ 4h');
  console.log('  ──────────────────┼──────────────────────┼──────────────────────┼──────────────────────');

  for (const strat of STRATEGIES) {
    const row = byStrategy[strat] || {};
    const cells = TIMEFRAMES.map(tf => {
      const w = row[tf];
      if (!w) return '      ---           ';
      const pnl = w.pnl >= 0 ? `+$${w.pnl.toFixed(0)}`.padEnd(6) : `-$${Math.abs(w.pnl).toFixed(0)}`.padEnd(6);
      return `${pnl} sl${w.bestSL}/tp${w.bestTP}`;
    });
    console.log(`  ${strat.padEnd(18)}│ ${cells[0].padEnd(20)} │ ${cells[1].padEnd(20)} │ ${cells[2]}`);
  }

  console.log('═'.repeat(80));
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  let dataFile = 'tuning/tsla-15m-2y.json';
  let stockMode = false;
  let filterStrategies = null;
  let filterTimeframes = null;
  let quickMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--data=')) {
      const val = args[i].split('=')[1].toLowerCase();
      dataFile = DATA_SHORTCUTS[val] || args[i].split('=')[1];
      if (['tsla', 'spy', 'qqq'].includes(val)) stockMode = true;
    }
    else if (args[i] === '--stocks') stockMode = true;
    else if (args[i] === '--quick') quickMode = true;
    else if (args[i].startsWith('--strategy=')) {
      filterStrategies = args[i].split('=')[1].split(',');
    }
    else if (args[i].startsWith('--timeframe=')) {
      filterTimeframes = args[i].split('=')[1].split(',');
    }
    else if (DATA_SHORTCUTS[args[i].toLowerCase()]) {
      const key = args[i].toLowerCase();
      dataFile = DATA_SHORTCUTS[key];
      if (['tsla', 'spy', 'qqq'].includes(key)) stockMode = true;
    }
    else if (args[i] === '--help') {
      console.log(`
Matrix Sweep - Strategy × Timeframe × Confidence × Exits

Usage:
  node tools/matrix-sweep.js [options]

Options:
  --data=FILE          Data file (or shortcut: tsla, spy, qqq, btc)
  --stocks             Zero commission mode
  --quick              Reduced combos for quick testing
  --strategy=NAME      Filter to specific strategy(s) (comma-separated)
  --timeframe=TF       Filter to specific timeframe(s) (15m, 1h, 4h)

Examples:
  node tools/matrix-sweep.js tsla --quick
  node tools/matrix-sweep.js --data=tsla --strategy=RSI,EMA --timeframe=15m
  node tools/matrix-sweep.js --data=btc --strategy=MADynamicSR
`);
      return;
    }
  }

  // Build matrix
  const options = {
    strategies: filterStrategies || STRATEGIES,
    timeframes: filterTimeframes || TIMEFRAMES,
    quick: quickMode,
    dataFile,
    stockMode,
  };

  const configs = generateMatrix(options);
  const cpuCount = os.cpus().length;
  const maxWorkers = Math.min(Math.max(cpuCount - 2, 4), 12);

  console.log('═'.repeat(80));
  console.log('  MATRIX SWEEP');
  console.log('═'.repeat(80));
  console.log(`  Strategies:  ${options.strategies.length}`);
  console.log(`  Timeframes:  ${options.timeframes.length}`);
  console.log(`  Confidences: ${quickMode ? QUICK_CONFIDENCES.length : CONFIDENCES.length}`);
  console.log(`  Exit combos: ${quickMode ? QUICK_EXITS.length : EXIT_COMBOS.length}`);
  console.log(`  Total:       ${configs.length} configurations`);
  console.log(`  Workers:     ${maxWorkers}`);
  console.log(`  Data:        ${dataFile}`);
  console.log(`  Fees:        ${stockMode ? '$0' : 'standard'}`);
  console.log('═'.repeat(80));

  // Run matrix
  const startTime = Date.now();
  const results = await runMatrix(configs, maxWorkers);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Analyze
  const { winners } = analyzeResults(results);
  printMatrix(winners);

  // Save results
  const timestamp = Date.now();
  const resultFile = path.join(RESULTS_DIR, `matrix-${timestamp}.json`);
  fs.writeFileSync(resultFile, JSON.stringify({
    timestamp,
    elapsed,
    options,
    totalConfigs: configs.length,
    winners,
    allResults: results,
  }, null, 2));

  console.log(`\n📁 Results saved: ${resultFile}`);
  console.log(`⏱️  Total time: ${elapsed}s`);
}

main().catch(console.error);
