#!/usr/bin/env node
/**
 * OGZPrime PARALLEL BACKTESTER — REAL PIPELINE EDITION v2
 * ========================================================
 * 
 * Runs the ACTUAL trading pipeline via child processes with env var overrides.
 * Each worker = fresh node run-empire-v2.js with different config.
 * 
 * Fixes from v1:
 * - Timeout raised to 20 min
 * - BACKTEST_SILENT passes through summary lines for parsing
 * - EMFILE fix: skip pattern saving + CSV export in parallel mode
 * - Reads results from JSON report file as fallback
 * 
 * Usage:
 *   node tools/parallel-backtest.js --quick
 *   node tools/parallel-backtest.js --full
 *   node tools/parallel-backtest.js --boosters
 * 
 * @author Claude (Opus) for Trey / OGZPrime
 * @date 2026-03-16
 */

'use strict';

const { spawn } = require('child_process');
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
const TIMEOUT_MS = 0; // No timeout - let it finish

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

// Clean up any leftover state files from previous runs
try {
  const dataDir = path.join(PROJECT_ROOT, 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.startsWith('state-parallel-'))
      .forEach(f => { try { fs.unlinkSync(path.join(dataDir, f)); } catch(e) {} });
  }
} catch(e) {}

// ═══════════════════════════════════════════════════════════════
// PARAMETER SWEEP DEFINITIONS
// ═══════════════════════════════════════════════════════════════

const SWEEP_PRESETS = {
  quick: [
    { name: 'baseline', env: {} },
    { name: 'wide-stops', env: { STOP_LOSS_PERCENT: '2.0', TAKE_PROFIT_PERCENT: '2.5' } },
    { name: 'tight-stops', env: { STOP_LOSS_PERCENT: '0.5', TAKE_PROFIT_PERCENT: '1.0' } },
    { name: 'high-conf', env: { MIN_TRADE_CONFIDENCE: '0.60' } },
    { name: 'low-conf', env: { MIN_TRADE_CONFIDENCE: '0.25' } },
  ],

  boosters: [
    { name: 'baseline-no-boosters', env: { RISK_MANAGER_BYPASS: 'true', ACCOUNT_DRAWDOWN_BYPASS: 'true' } },
    { name: 'atr-015', env: { ATR_FILTER_ENABLED: 'true', ATR_MIN_PERCENT: '0.15', RISK_MANAGER_BYPASS: 'true', ACCOUNT_DRAWDOWN_BYPASS: 'true' } },
    { name: 'atr-040', env: { ATR_FILTER_ENABLED: 'true', ATR_MIN_PERCENT: '0.40', RISK_MANAGER_BYPASS: 'true', ACCOUNT_DRAWDOWN_BYPASS: 'true' } },
    { name: 'risk-mgr-on', env: { RISK_MANAGER_BYPASS: 'false', ACCOUNT_DRAWDOWN_BYPASS: 'true' } },
    { name: 'drawdown-on', env: { RISK_MANAGER_BYPASS: 'true', ACCOUNT_DRAWDOWN_BYPASS: 'false' } },
    { name: 'atr+risk', env: { ATR_FILTER_ENABLED: 'true', ATR_MIN_PERCENT: '0.15', RISK_MANAGER_BYPASS: 'false', ACCOUNT_DRAWDOWN_BYPASS: 'true' } },
  ],

  exits: generateExitSweep(),

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

  sizing: [
    { name: 'size-2pct', env: { MAX_POSITION_SIZE_PCT: '0.02' } },
    { name: 'size-3pct', env: { MAX_POSITION_SIZE_PCT: '0.03' } },
    { name: 'size-4pct', env: { MAX_POSITION_SIZE_PCT: '0.04' } },
    { name: 'size-5pct', env: { MAX_POSITION_SIZE_PCT: '0.05' } },
    { name: 'size-7pct', env: { MAX_POSITION_SIZE_PCT: '0.07' } },
    { name: 'size-10pct', env: { MAX_POSITION_SIZE_PCT: '0.10' } },
  ],

  tiers: [
    { name: 'tiers-tight', env: { TIER1_TARGET: '0.005', TIER2_TARGET: '0.008', TIER3_TARGET: '0.012' } },
    { name: 'tiers-configD', env: { TIER1_TARGET: '0.007', TIER2_TARGET: '0.010', TIER3_TARGET: '0.015' } },
    { name: 'tiers-above-fees', env: { TIER1_TARGET: '0.010', TIER2_TARGET: '0.015', TIER3_TARGET: '0.020' } },
    { name: 'tiers-wide', env: { TIER1_TARGET: '0.015', TIER2_TARGET: '0.020', TIER3_TARGET: '0.030' } },
    { name: 'tiers-no-early', env: { TIER1_TARGET: '0.020', TIER2_TARGET: '0.030', TIER3_TARGET: '0.050' } },
  ],

  // ═══════════════════════════════════════════════════════════════
  // FOCUSED OPTIMIZATION SWEEPS (one variable at a time)
  // ═══════════════════════════════════════════════════════════════

  // ATR filter sweep - find optimal volatility threshold
  atr: [
    { name: 'atr-off', env: { ATR_FILTER_ENABLED: 'false' } },
    { name: 'atr-010', env: { ATR_FILTER_ENABLED: 'true', ATR_MIN_PERCENT: '0.10' } },
    { name: 'atr-015', env: { ATR_FILTER_ENABLED: 'true', ATR_MIN_PERCENT: '0.15' } },
    { name: 'atr-020', env: { ATR_FILTER_ENABLED: 'true', ATR_MIN_PERCENT: '0.20' } },
    { name: 'atr-025', env: { ATR_FILTER_ENABLED: 'true', ATR_MIN_PERCENT: '0.25' } },
    { name: 'atr-030', env: { ATR_FILTER_ENABLED: 'true', ATR_MIN_PERCENT: '0.30' } },
    { name: 'atr-035', env: { ATR_FILTER_ENABLED: 'true', ATR_MIN_PERCENT: '0.35' } },
    { name: 'atr-040', env: { ATR_FILTER_ENABLED: 'true', ATR_MIN_PERCENT: '0.40' } },
  ],

  // RSI thresholds sweep - oversold x overbought grid
  rsi: generateRSISweep(),

  // Trailing stop sweep - find optimal trail percentage
  trailing: [
    { name: 'trail-off', env: { TRAILING_STOP_ENABLED: 'false' } },
    { name: 'trail-03', env: { TRAILING_STOP_ENABLED: 'true', TRAILING_STOP_PERCENT: '0.3' } },
    { name: 'trail-05', env: { TRAILING_STOP_ENABLED: 'true', TRAILING_STOP_PERCENT: '0.5' } },
    { name: 'trail-08', env: { TRAILING_STOP_ENABLED: 'true', TRAILING_STOP_PERCENT: '0.8' } },
    { name: 'trail-10', env: { TRAILING_STOP_ENABLED: 'true', TRAILING_STOP_PERCENT: '1.0' } },
    { name: 'trail-15', env: { TRAILING_STOP_ENABLED: 'true', TRAILING_STOP_PERCENT: '1.5' } },
    { name: 'trail-20', env: { TRAILING_STOP_ENABLED: 'true', TRAILING_STOP_PERCENT: '2.0' } },
  ],

  // Market regime sweep - which regimes to trade in
  regime: [
    { name: 'regime-all', env: { REGIME_FILTER_ENABLED: 'false' } },
    { name: 'regime-trend-only', env: { REGIME_FILTER_ENABLED: 'true', REGIME_ALLOW_TRENDING: 'true', REGIME_ALLOW_RANGING: 'false' } },
    { name: 'regime-range-only', env: { REGIME_FILTER_ENABLED: 'true', REGIME_ALLOW_TRENDING: 'false', REGIME_ALLOW_RANGING: 'true' } },
    { name: 'regime-volatile', env: { REGIME_FILTER_ENABLED: 'true', REGIME_ALLOW_VOLATILE: 'true', REGIME_ALLOW_QUIET: 'false' } },
  ],

  // Strategy confidence sweep - per-strategy minimum confidence
  stratconf: [
    { name: 'stratconf-25', env: { MIN_STRATEGY_CONFIDENCE: '0.25' } },
    { name: 'stratconf-30', env: { MIN_STRATEGY_CONFIDENCE: '0.30' } },
    { name: 'stratconf-35', env: { MIN_STRATEGY_CONFIDENCE: '0.35' } },
    { name: 'stratconf-40', env: { MIN_STRATEGY_CONFIDENCE: '0.40' } },
    { name: 'stratconf-45', env: { MIN_STRATEGY_CONFIDENCE: '0.45' } },
    { name: 'stratconf-50', env: { MIN_STRATEGY_CONFIDENCE: '0.50' } },
    { name: 'stratconf-55', env: { MIN_STRATEGY_CONFIDENCE: '0.55' } },
    { name: 'stratconf-60', env: { MIN_STRATEGY_CONFIDENCE: '0.60' } },
  ],

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
      if (tp <= sl) continue;
      configs.push({
        name: `sl${sl}-tp${tp}`,
        env: { STOP_LOSS_PERCENT: String(sl), TAKE_PROFIT_PERCENT: String(tp) }
      });
    }
  }
  return configs;
}

function generateRSISweep() {
  const configs = [];
  const oversoldLevels = [15, 20, 25, 30, 35];
  const overboughtLevels = [65, 70, 75, 80, 85];
  for (const os of oversoldLevels) {
    for (const ob of overboughtLevels) {
      // Only valid combinations where oversold < overbought with reasonable spread
      if (ob - os < 30) continue;
      configs.push({
        name: `rsi-${os}-${ob}`,
        env: { RSI_OVERSOLD: String(os), RSI_OVERBOUGHT: String(ob) }
      });
    }
  }
  return configs;
}

// ═══════════════════════════════════════════════════════════════
// WORKER — Runs a single backtest as a child process
// ═══════════════════════════════════════════════════════════════

function runSingleBacktest(config, dataFile, stockMode = false) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const uniqueId = `${config.name}-${Date.now()}-${Math.random().toString(36).substr(2,4)}`;
    const stateFile = path.join(PROJECT_ROOT, 'data', `state-parallel-${uniqueId}.json`);
    const reportTag = `parallel-${uniqueId}`;
    
    const env = {
      ...process.env,
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
      // Skip pattern saving and CSV export to avoid EMFILE on Windows
      BACKTEST_NO_PATTERN_SAVE: 'true',
      SKIP_CSV_EXPORT: 'true',
      // Disable dashboard WebSocket (no server on local PC = infinite reconnect loop)
      ENABLE_DASHBOARD: 'false',
      // Disable Sentry (hooks every async op = massive overhead on 45K candles)
      SENTRY_DSN: '',
      NODE_ENV: 'test',
      // Tag for finding the right report file
      BACKTEST_REPORT_TAG: reportTag,
      // Stock mode: zero commission
      ...(stockMode ? { FEE_MAKER: '0', FEE_TAKER: '0' } : {}),
      ...config.env,
    };

    let output = '';

    const child = spawn('node', [RUNNER], {
      cwd: PROJECT_ROOT,
      env: env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Timeout handler (disabled when TIMEOUT_MS = 0)
    let timer = null;
    if (TIMEOUT_MS > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, TIMEOUT_MS);
    }

    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      // Try parsing from console output first
      let result = parseBacktestOutput(output, config.name);
      
      // If console parsing failed, try reading the report JSON
      if (result.trades == null) {
        const reportResult = tryReadReport(PROJECT_ROOT, reportTag);
        if (reportResult) {
          result = { ...result, ...reportResult };
        }
      }

      // Also try reading the most recent report file
      if (result.trades == null) {
        const latestResult = tryReadLatestReport(PROJECT_ROOT);
        if (latestResult) {
          result = { ...result, ...latestResult };
        }
      }

      result.elapsed = elapsed;
      result.exitCode = code;
      result.config = config;

      // Clean up state file
      try { fs.unlinkSync(stateFile); } catch(e) {}

      resolve(result);
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        name: config.name,
        config: config,
        error: err.message,
        elapsed: ((Date.now() - startTime) / 1000).toFixed(1),
      });
    });
  });
}

function tryReadReport(projectRoot, tag) {
  try {
    const reports = fs.readdirSync(projectRoot)
      .filter(f => f.startsWith('backtest-report-') && f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(projectRoot, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    
    if (reports.length === 0) return null;

    const reportPath = path.join(projectRoot, reports[0].name);
    const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    
    // Clean up
    try { fs.unlinkSync(reportPath); } catch(e) {}

    const trades = data.trades || [];
    const summary = data.summary || {};
    
    if (trades.length === 0 && !summary.finalBalance) return null;

    const winners = trades.filter(t => (t.netPnlDollars || t.pnl || 0) > 0);
    const totalFees = trades.reduce((s, t) => s + (t.feesDollars || 0), 0);
    const netPnl = summary.finalBalance ? summary.finalBalance - 10000 : 
                   trades.reduce((s, t) => s + (t.netPnlDollars || 0), 0);

    return {
      finalBalance: summary.finalBalance || null,
      trades: trades.length > 0 ? trades.length : (summary.totalTrades || null),
      winRate: trades.length > 0 ? (winners.length / trades.length) * 100 : null,
      netPnl: netPnl,
      fees: totalFees || null,
    };
  } catch(e) {
    return null;
  }
}

function tryReadLatestReport(projectRoot) {
  return tryReadReport(projectRoot, null);
}

function parseBacktestOutput(output, name) {
  const result = { name };

  // Parse BacktestRecorder summary block
  const balanceMatch = output.match(/Final Balance:\s*\$?([\d,.]+)/);
  const tradesMatch = output.match(/Total Trades:\s*(\d+)/);
  const winRateMatch = output.match(/Win Rate:\s*([\d.]+)%/);
  const pnlMatch = output.match(/Net P&L:\s*\$?([-\d,.]+)/);
  const feesMatch = output.match(/Total Fees.*?:\s*\$?([\d,.]+)/);
  const drawdownMatch = output.match(/Max Drawdown:\s*([\d.]+)%/);
  const profitFactorMatch = output.match(/Profit Factor:\s*([\d.]+)/);
  
  // Also try the console dump format (when EMFILE prevents file write)
  const consolePnlMatch = output.match(/Total P&L:\s*\$?([-\d,.]+)\s*\(([-\d,.]+)%\)/);
  const consoleBalMatch = output.match(/Final Balance:\s*\$?([\d,.]+)/);

  result.finalBalance = balanceMatch ? parseFloat(balanceMatch[1].replace(',', '')) : null;
  result.trades = tradesMatch ? parseInt(tradesMatch[1]) : null;
  result.winRate = winRateMatch ? parseFloat(winRateMatch[1]) : null;
  result.netPnl = pnlMatch ? parseFloat(pnlMatch[1].replace(',', '')) : 
                  (consolePnlMatch ? parseFloat(consolePnlMatch[1].replace(',', '')) : null);
  result.fees = feesMatch ? parseFloat(feesMatch[1].replace(',', '')) : null;
  result.maxDrawdown = drawdownMatch ? parseFloat(drawdownMatch[1]) : null;
  result.profitFactor = profitFactorMatch ? parseFloat(profitFactorMatch[1]) : null;

  // If we got balance but no PnL, calculate it
  if (result.finalBalance && result.netPnl == null) {
    result.netPnl = result.finalBalance - 10000;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// PARALLEL RUNNER
// ═══════════════════════════════════════════════════════════════

async function runParallelSweep(configs, dataFile, stockMode = false) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  OGZPrime PARALLEL BACKTESTER v2${stockMode ? ' [STOCK MODE - Zero Fees]' : ''}`);
  console.log(`  ${cpuModel} | ${threadCount} threads | ${MAX_WORKERS} workers`);
  console.log(`  ${configs.length} configurations to test`);
  console.log(`  Data: ${dataFile}`);
  console.log(`  Timeout: None (runs until complete)`);
  if (stockMode) console.log(`  Fees: $0 (zero commission stocks)`);
  console.log(`${'═'.repeat(70)}\n`);

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < configs.length; i += MAX_WORKERS) {
    const batch = configs.slice(i, i + MAX_WORKERS);
    const batchNum = Math.floor(i / MAX_WORKERS) + 1;
    const totalBatches = Math.ceil(configs.length / MAX_WORKERS);

    console.log(`\n── Batch ${batchNum}/${totalBatches} (${batch.length} workers) ──`);
    batch.forEach(c => console.log(`  → ${c.name}`));
    console.log(`  ⏳ Running... (no timeout, will finish when done)`);

    const batchResults = await Promise.all(
      batch.map(config => runSingleBacktest(config, dataFile, stockMode))
    );

    batchResults.forEach(r => {
      results.push(r);
      const status = r.error ? '❌' : (r.netPnl > 0 ? '🟢' : (r.netPnl != null ? '🔴' : '⚠️'));
      const pnl = r.netPnl != null ? `$${r.netPnl.toFixed(2)}` : 'PARSE FAIL';
      const trades = r.trades || '?';
      const wr = r.winRate != null ? `${r.winRate.toFixed(1)}%` : '?';
      console.log(`  ${status} ${r.name.padEnd(25)} | P&L: ${pnl.padEnd(14)} | Trades: ${String(trades).padEnd(5)} | WR: ${wr.padEnd(7)} | ${r.elapsed}s`);
    });
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  const ranked = results
    .filter(r => r.netPnl != null)
    .sort((a, b) => b.netPnl - a.netPnl);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  LEADERBOARD (${ranked.length}/${results.length} parsed, ${totalTime}s total)`);
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

  // Show configs that failed to parse
  const failed = results.filter(r => r.netPnl == null);
  if (failed.length > 0) {
    console.log(`\n  ⚠️  ${failed.length} configs failed to produce parseable results:`);
    failed.forEach(r => {
      console.log(`     ${r.name} (${r.elapsed}s, exit code: ${r.exitCode})`);
    });
  }

  const reportPath = path.join(RESULTS_DIR, `sweep-${Date.now()}.json`);
  const report = {
    timestamp: new Date().toISOString(),
    hardware: { cpu: cpuModel, threads: threadCount, workers: MAX_WORKERS },
    dataFile,
    totalConfigs: configs.length,
    parsedConfigs: ranked.length,
    totalTime: `${totalTime}s`,
    results: ranked,
    failed: failed.map(r => ({ name: r.name, elapsed: r.elapsed, exitCode: r.exitCode })),
    winner: ranked[0] || null,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📁 Full results saved: ${reportPath}`);

  if (ranked[0]) {
    console.log(`\n👑 WINNER: ${ranked[0].name}`);
    console.log(`   P&L: $${ranked[0].netPnl.toFixed(2)} | WR: ${ranked[0].winRate?.toFixed(1) || '?'}% | Trades: ${ranked[0].trades || '?'}`);
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
  let stockMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sweep' && args[i+1]) sweepName = args[++i];
    else if (args[i] === '--data' && args[i+1]) dataFile = args[++i];
    else if (args[i] === '--quick') sweepName = 'quick';
    else if (args[i] === '--full') sweepName = 'full';
    else if (args[i] === '--boosters') sweepName = 'boosters';
    else if (args[i] === '--exits') sweepName = 'exits';
    else if (args[i] === '--confidence') sweepName = 'confidence';
    else if (args[i] === '--sizing') sweepName = 'sizing';
    else if (args[i] === '--tiers') sweepName = 'tiers';
    else if (args[i] === '--atr') sweepName = 'atr';
    else if (args[i] === '--rsi') sweepName = 'rsi';
    else if (args[i] === '--trailing') sweepName = 'trailing';
    else if (args[i] === '--regime') sweepName = 'regime';
    else if (args[i] === '--stratconf') sweepName = 'stratconf';
    else if (args[i] === '--stocks') stockMode = true;
    else if (args[i] === '--help') {
      console.log(`
OGZPrime Parallel Backtester v2
Usage: node tools/parallel-backtest.js [options]

Quick Sweeps:
  --quick        5 configs (default)
  --full         Everything (~60 configs)

Focused Optimization (one variable at a time):
  --confidence   Trade confidence gate (8 configs: 0.10-0.70)
  --stratconf    Strategy confidence (8 configs: 0.25-0.60)
  --atr          ATR volatility filter (8 configs: off, 0.10-0.40)
  --rsi          RSI oversold/overbought grid (15 configs)
  --exits        SL/TP grid search (30 configs)
  --trailing     Trailing stop sweep (7 configs: off, 0.3%-2.0%)
  --regime       Market regime filter (4 configs)
  --tiers        Profit tier sweep (5 configs)

Other:
  --boosters     Alpha booster toggles
  --sizing       Position size sweep (6 configs)

Options:
  --data FILE    Candle data file (default: ${DEFAULT_DATA})
  --stocks       Zero commission mode (for stocks)
  --help         Show this help

Walk-Forward Validation:
  After finding winners, test on unseen data:
  1. Train on first 6 months, find optimal params
  2. Validate on next 6 months, confirm they hold
  3. Test on final year, prove edge is real

Notes:
  - Results saved to backtest-results/
  - Run sweeps one at a time, lock in winners, stack them
`);
      process.exit(0);
    }
  }

  let configs;
  if (typeof SWEEP_PRESETS[sweepName] === 'function') configs = SWEEP_PRESETS[sweepName]();
  else configs = SWEEP_PRESETS[sweepName];

  if (!configs) {
    console.error(`Unknown sweep: ${sweepName}`);
    console.error(`Available: ${Object.keys(SWEEP_PRESETS).join(', ')}`);
    process.exit(1);
  }

  await runParallelSweep(configs, dataFile, stockMode);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
