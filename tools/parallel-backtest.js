#!/usr/bin/env node
/**
 * OGZPrime PARALLEL BACKTESTER — REAL PIPELINE EDITION
 * ====================================================
 * 
 * This runs the ACTUAL trading pipeline (not random numbers).
 * Each worker spawns a fresh node process with env var overrides
 * that flow through TradingConfig → StrategyOrchestrator → 
 * TradingLoop → OrderExecutor → ExitContractManager.
 * 
 * Your 7800X3D runs 14 workers in parallel.
 * Each worker is a full backtest with different parameters.
 * 
 * Usage:
 *   node tools/parallel-backtest.js                    # Run default sweep
 *   node tools/parallel-backtest.js --quick             # Fast 5-config test
 *   node tools/parallel-backtest.js --config sweep.json  # Custom sweep file
 * 
 * @author Claude (Opus) for Trey / OGZPrime
 * @date 2026-03-16
 */

'use strict';

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ═══════════════════════════════════════════════════════════════
// HARDWARE DETECTION
// ═══════════════════════════════════════════════════════════════
const cpuModel = os.cpus()[0]?.model || 'Unknown';
const threadCount = os.cpus().length;
const is7800X3D = cpuModel.includes('7800X3D');
const MAX_WORKERS = Math.max(1, is7800X3D ? 14 : threadCount - 2);

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(PROJECT_ROOT, 'run-empire-v2.js');
const DEFAULT_DATA = 'tuning/full-45k.json';
const RESULTS_DIR = path.join(PROJECT_ROOT, 'backtest-results');

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ═══════════════════════════════════════════════════════════════
// PARAMETER SWEEP DEFINITIONS
// 
// Each key maps to an env var that TradingConfig reads.
// The backtester runs the REAL pipeline with these overrides.
// ═══════════════════════════════════════════════════════════════

const SWEEP_PRESETS = {
  // Quick sanity check — 5 configs
  quick: [
    { name: 'baseline', env: {} },
    { name: 'wide-stops', env: { STOP_LOSS_PERCENT: '2.0', TAKE_PROFIT_PERCENT: '2.5' } },
    { name: 'tight-stops', env: { STOP_LOSS_PERCENT: '0.5', TAKE_PROFIT_PERCENT: '1.0' } },
    { name: 'high-conf', env: { MIN_TRADE_CONFIDENCE: '0.60' } },
    { name: 'low-conf', env: { MIN_TRADE_CONFIDENCE: '0.25' } },
  ],

  // Alpha booster toggles (on/off for each)
  boosters: [
    { name: 'baseline-no-boosters', env: {} },
    { name: 'atr-filter-on', env: { ATR_FILTER_ENABLED: 'true', ATR_MIN_PERCENT: '0.15' } },
    { name: 'atr-filter-aggressive', env: { ATR_FILTER_ENABLED: 'true', ATR_MIN_PERCENT: '0.40' } },
    { name: 'regime-filter-on', env: { REGIME_FILTER_ENABLED: 'true' } },
    { name: 'trai-enabled', env: { ENABLE_TRAI: 'true' } },
    { name: 'atr+regime', env: { ATR_FILTER_ENABLED: 'true', ATR_MIN_PERCENT: '0.15', REGIME_FILTER_ENABLED: 'true' } },
  ],

  // Exit contract tuning — sweep SL/TP
  exits: generateExitSweep(),

  // Confidence threshold sweep
  confidence: [
    { name: 'conf-10', env: { MIN_TRADE_CONFIDENCE: '0.10' } },
    { name: 'conf-20', env: { MIN_TRADE_CONFIDENCE: '0.20' } },
    { name: 'conf-30', env: { MIN_TRADE_CONFIDENCE: '0.30' } },
    { name: 'conf-35', env: { MIN_TRADE_CONFIDENCE: '0.35' } },
    { name: 'conf-40', env: { MIN_TRADE_CONFIDENCE: '0.40' } },
    { name: 'conf-50', env: { MIN_TRADE_CONFIDENCE: '0.50' } },
    { name: 'conf-60', env: { MIN_TRADE_CONFIDENCE: '0.60' } },
    { name: 'conf-70', env: { MIN_TRADE_CONFIDENCE: '0.70' } },
  ],

  // Position sizing sweep
  sizing: [
    { name: 'size-2pct', env: { MAX_POSITION_SIZE_PCT: '0.02' } },
    { name: 'size-3pct', env: { MAX_POSITION_SIZE_PCT: '0.03' } },
    { name: 'size-4pct', env: { MAX_POSITION_SIZE_PCT: '0.04' } },
    { name: 'size-5pct', env: { MAX_POSITION_SIZE_PCT: '0.05' } },
    { name: 'size-7pct', env: { MAX_POSITION_SIZE_PCT: '0.07' } },
    { name: 'size-10pct', env: { MAX_POSITION_SIZE_PCT: '0.10' } },
  ],

  // Profit tier sweep
  tiers: [
    { name: 'tiers-tight', env: { TIER1_TARGET: '0.005', TIER2_TARGET: '0.008', TIER3_TARGET: '0.012' } },
    { name: 'tiers-configD', env: { TIER1_TARGET: '0.007', TIER2_TARGET: '0.010', TIER3_TARGET: '0.015' } },
    { name: 'tiers-above-fees', env: { TIER1_TARGET: '0.010', TIER2_TARGET: '0.015', TIER3_TARGET: '0.020' } },
    { name: 'tiers-wide', env: { TIER1_TARGET: '0.015', TIER2_TARGET: '0.020', TIER3_TARGET: '0.030' } },
    { name: 'tiers-no-early', env: { TIER1_TARGET: '0.020', TIER2_TARGET: '0.030', TIER3_TARGET: '0.050' } },
  ],

  // Full kitchen sink — run everything
  full: function() {
    return [
      ...SWEEP_PRESETS.quick,
      ...SWEEP_PRESETS.boosters,
      ...SWEEP_PRESETS.exits,
      ...SWEEP_PRESETS.confidence,
      ...SWEEP_PRESETS.sizing,
      ...SWEEP_PRESETS.tiers,
    ];
  },
};

function generateExitSweep() {
  const configs = [];
  const stopLosses = [0.5, 0.8, 1.0, 1.5, 2.0, 3.0];
  const takeProfits = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0];
  
  for (const sl of stopLosses) {
    for (const tp of takeProfits) {
      if (tp <= sl) continue; // TP must be > SL
      configs.push({
        name: `sl${sl}-tp${tp}`,
        env: { STOP_LOSS_PERCENT: String(sl), TAKE_PROFIT_PERCENT: String(tp) }
      });
    }
  }
  return configs;
}

// ═══════════════════════════════════════════════════════════════
// WORKER — Runs a single backtest as a child process
// ═══════════════════════════════════════════════════════════════

function runSingleBacktest(config, dataFile) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const stateFile = path.join(PROJECT_ROOT, 'data', `state-parallel-${config.name}-${Date.now()}.json`);
    
    // Build env with overrides — this flows through TradingConfig.js env() calls
    const env = {
      ...process.env,
      EXECUTION_MODE: 'backtest',
      CANDLE_SOURCE: 'file',
      BACKTEST_MODE: 'true',
      BACKTEST_SILENT: 'true',
      INITIAL_BALANCE: '10000',
      CANDLE_DATA_FILE: path.join(PROJECT_ROOT, dataFile),
      STATE_FILE: stateFile,
      DATA_DIR: path.join(PROJECT_ROOT, 'data', 'backtest'),
      PAPER_TRADING: 'true',
      BACKTEST_NO_PATTERN_SAVE: 'true',  // EMFILE fix - disable disk writes in parallel backtest
      // Apply config overrides
      ...config.env,
    };

    let output = '';
    let errorOutput = '';

    const child = spawn('node', [RUNNER], {
      cwd: PROJECT_ROOT,
      env: env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 1200000, // 20 min max per backtest (Windows is slow)
    });

    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { errorOutput += data.toString(); });

    child.on('close', (code) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      // Parse results from output
      const result = parseBacktestOutput(output, config.name);
      result.elapsed = elapsed;
      result.exitCode = code;
      result.config = config;

      // Find and parse the report JSON if it was saved
      try {
        const reports = fs.readdirSync(PROJECT_ROOT)
          .filter(f => f.startsWith('backtest-report-') && f.endsWith('.json'))
          .sort()
          .reverse();
        
        if (reports.length > 0) {
          const reportPath = path.join(PROJECT_ROOT, reports[0]);
          const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
          result.report = {
            trades: reportData.trades?.length || 0,
            finalBalance: reportData.summary?.finalBalance || 0,
            totalReturn: reportData.summary?.totalReturn || 0,
          };
          // Clean up report file
          try { fs.unlinkSync(reportPath); } catch(e) {}
        }
      } catch(e) {}

      // Clean up state file
      try { fs.unlinkSync(stateFile); } catch(e) {}

      resolve(result);
    });

    child.on('error', (err) => {
      resolve({
        name: config.name,
        config: config,
        error: err.message,
        elapsed: ((Date.now() - startTime) / 1000).toFixed(1),
      });
    });
  });
}

function parseBacktestOutput(output, name) {
  const result = { name };

  // Parse the BacktestRecorder summary
  const balanceMatch = output.match(/Final Balance:\s*\$?([\d,.]+)/);
  const tradesMatch = output.match(/Total Trades:\s*(\d+)/);
  const winRateMatch = output.match(/Win Rate:\s*([\d.]+)%/);
  const pnlMatch = output.match(/Net P&L:\s*\$?([-\d,.]+)/);
  const feesMatch = output.match(/Total Fees.*?:\s*\$?([\d,.]+)/);
  const drawdownMatch = output.match(/Max Drawdown:\s*([\d.]+)%/);
  const profitFactorMatch = output.match(/Profit Factor:\s*([\d.]+)/);

  result.finalBalance = balanceMatch ? parseFloat(balanceMatch[1].replace(',', '')) : null;
  result.trades = tradesMatch ? parseInt(tradesMatch[1]) : null;
  result.winRate = winRateMatch ? parseFloat(winRateMatch[1]) : null;
  result.netPnl = pnlMatch ? parseFloat(pnlMatch[1].replace(',', '')) : null;
  result.fees = feesMatch ? parseFloat(feesMatch[1].replace(',', '')) : null;
  result.maxDrawdown = drawdownMatch ? parseFloat(drawdownMatch[1]) : null;
  result.profitFactor = profitFactorMatch ? parseFloat(profitFactorMatch[1]) : null;

  // Parse exit reasons
  const exitReasons = {};
  const exitRegex = /(\w+):\s*(\d+)\s*trades?\s*\|\s*[+$-]*([\d.,-]+)/g;
  let match;
  while ((match = exitRegex.exec(output)) !== null) {
    exitReasons[match[1]] = { count: parseInt(match[2]), pnl: parseFloat(match[3]) };
  }
  if (Object.keys(exitReasons).length > 0) result.exitReasons = exitReasons;

  // Parse strategy breakdown
  const stratRegex = /(RSI|CandlePattern|MADynamicSR|LiquiditySweep|EMASMACrossover|MarketRegime|MultiTimeframe|OGZTPO):\s*(\d+)\s*trades?\s*\|\s*([\d.]+)%\s*WR\s*\|\s*\$?([-\d,.]+)/g;
  const strategies = {};
  while ((match = stratRegex.exec(output)) !== null) {
    strategies[match[1]] = {
      trades: parseInt(match[2]),
      winRate: parseFloat(match[3]),
      pnl: parseFloat(match[4].replace(',', ''))
    };
  }
  if (Object.keys(strategies).length > 0) result.strategies = strategies;

  return result;
}

// ═══════════════════════════════════════════════════════════════
// PARALLEL RUNNER
// ═══════════════════════════════════════════════════════════════

async function runParallelSweep(configs, dataFile) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  OGZPrime PARALLEL BACKTESTER`);
  console.log(`  ${cpuModel} | ${threadCount} threads | ${MAX_WORKERS} workers`);
  console.log(`  ${configs.length} configurations to test`);
  console.log(`  Data: ${dataFile}`);
  console.log(`${'═'.repeat(70)}\n`);

  const results = [];
  const startTime = Date.now();

  // Run in batches of MAX_WORKERS
  for (let i = 0; i < configs.length; i += MAX_WORKERS) {
    const batch = configs.slice(i, i + MAX_WORKERS);
    const batchNum = Math.floor(i / MAX_WORKERS) + 1;
    const totalBatches = Math.ceil(configs.length / MAX_WORKERS);

    console.log(`\n── Batch ${batchNum}/${totalBatches} (${batch.length} workers) ──`);
    batch.forEach(c => console.log(`  → ${c.name}`));

    const batchResults = await Promise.all(
      batch.map(config => runSingleBacktest(config, dataFile))
    );

    batchResults.forEach(r => {
      results.push(r);
      const status = r.error ? '❌' : (r.netPnl > 0 ? '🟢' : '🔴');
      const pnl = r.netPnl != null ? `$${r.netPnl.toFixed(2)}` : 'N/A';
      const trades = r.trades || 'N/A';
      const wr = r.winRate != null ? `${r.winRate.toFixed(1)}%` : 'N/A';
      console.log(`  ${status} ${r.name.padEnd(25)} | P&L: ${pnl.padEnd(12)} | Trades: ${String(trades).padEnd(5)} | WR: ${wr.padEnd(7)} | ${r.elapsed}s`);
    });
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Sort by net P&L (best first)
  const ranked = results
    .filter(r => r.netPnl != null)
    .sort((a, b) => b.netPnl - a.netPnl);

  // Print leaderboard
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  LEADERBOARD (${ranked.length} completed, ${totalTime}s total)`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`  ${'#'.padEnd(4)} ${'Config'.padEnd(28)} ${'P&L'.padEnd(14)} ${'Trades'.padEnd(8)} ${'WR%'.padEnd(8)} ${'DD%'.padEnd(8)} ${'PF'.padEnd(6)}`);
  console.log(`  ${'-'.repeat(66)}`);

  ranked.forEach((r, i) => {
    const icon = i === 0 ? '👑' : (r.netPnl > 0 ? '🟢' : '🔴');
    const pnl = `$${r.netPnl.toFixed(2)}`;
    const trades = r.trades || '-';
    const wr = r.winRate != null ? `${r.winRate.toFixed(1)}%` : '-';
    const dd = r.maxDrawdown != null ? `${r.maxDrawdown.toFixed(1)}%` : '-';
    const pf = r.profitFactor != null ? r.profitFactor.toFixed(2) : '-';
    console.log(`  ${icon}${String(i+1).padEnd(3)} ${r.name.padEnd(28)} ${pnl.padEnd(14)} ${String(trades).padEnd(8)} ${wr.padEnd(8)} ${dd.padEnd(8)} ${pf.padEnd(6)}`);
  });

  // Save full results
  const reportPath = path.join(RESULTS_DIR, `sweep-${Date.now()}.json`);
  const report = {
    timestamp: new Date().toISOString(),
    hardware: { cpu: cpuModel, threads: threadCount, workers: MAX_WORKERS },
    dataFile,
    totalConfigs: configs.length,
    totalTime: `${totalTime}s`,
    results: ranked,
    winner: ranked[0] || null,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📁 Full results saved: ${reportPath}`);

  if (ranked[0]) {
    console.log(`\n👑 WINNER: ${ranked[0].name}`);
    console.log(`   P&L: $${ranked[0].netPnl.toFixed(2)} | WR: ${ranked[0].winRate?.toFixed(1)}% | Trades: ${ranked[0].trades}`);
    if (ranked[0].config.env && Object.keys(ranked[0].config.env).length > 0) {
      console.log(`   Config: ${JSON.stringify(ranked[0].config.env)}`);
    }
  }

  return report;
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  
  let sweepName = 'quick';
  let dataFile = DEFAULT_DATA;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sweep' && args[i+1]) {
      sweepName = args[++i];
    } else if (args[i] === '--data' && args[i+1]) {
      dataFile = args[++i];
    } else if (args[i] === '--quick') {
      sweepName = 'quick';
    } else if (args[i] === '--full') {
      sweepName = 'full';
    } else if (args[i] === '--boosters') {
      sweepName = 'boosters';
    } else if (args[i] === '--exits') {
      sweepName = 'exits';
    } else if (args[i] === '--confidence') {
      sweepName = 'confidence';
    } else if (args[i] === '--sizing') {
      sweepName = 'sizing';
    } else if (args[i] === '--tiers') {
      sweepName = 'tiers';
    } else if (args[i] === '--help') {
      console.log(`
OGZPrime Parallel Backtester
Usage: node tools/parallel-backtest.js [options]

Sweeps:
  --quick        5 configs — sanity check (default)
  --boosters     Alpha booster toggles (ATR, regime, TRAI)
  --exits        SL/TP grid search (30 configs)
  --confidence   Confidence threshold sweep (8 configs)
  --sizing       Position size sweep (6 configs)
  --tiers        Profit tier sweep (5 configs)
  --full         Everything above (~60 configs)
  --sweep NAME   Custom sweep name

Options:
  --data FILE    Candle data file (default: ${DEFAULT_DATA})
  --help         Show this help
`);
      process.exit(0);
    }
  }

  // Get configs
  let configs;
  if (typeof SWEEP_PRESETS[sweepName] === 'function') {
    configs = SWEEP_PRESETS[sweepName]();
  } else {
    configs = SWEEP_PRESETS[sweepName];
  }

  if (!configs) {
    console.error(`Unknown sweep: ${sweepName}`);
    console.error(`Available: ${Object.keys(SWEEP_PRESETS).join(', ')}`);
    process.exit(1);
  }

  await runParallelSweep(configs, dataFile);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
