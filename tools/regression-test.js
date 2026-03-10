#!/usr/bin/env node

/**
 * regression-test.js — Strategy Regression Testing
 * =================================================
 * 
 * PURPOSE: Prove that code changes don't break strategy performance.
 * 
 * MODES:
 *   node tools/regression-test.js --baseline     Save current results as the known-good baseline
 *   node tools/regression-test.js --check        Run backtest and compare against baseline
 *   node tools/regression-test.js --show         Show the saved baseline without running anything
 * 
 * WHAT IT CHECKS:
 *   - Same number of trades per strategy
 *   - Same win rate per strategy (within tolerance)
 *   - Same P&L per strategy (within tolerance)
 *   - Same total return
 *   - Same exit reason distribution
 *   - Same fee calculation
 * 
 * TOLERANCES:
 *   Trade count: must be EXACT (same data + same code = same trades)
 *   Win rate: exact (deterministic system)
 *   P&L: within 0.01% (floating point rounding only)
 * 
 * RULE: Run --check BEFORE and AFTER every code change.
 *       If --check fails after a change, the change broke something.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASELINE_FILE = path.join(__dirname, '..', 'tuning', 'regression-baseline.json');
const BACKTEST_CMD = 'CANDLE_FILE=tuning/full-45k.json node tuning/tuning-backtest-full.js 2>&1';

// Tolerances
const PNL_TOLERANCE = 0.01;  // 0.01% — only floating point rounding allowed

function parseBacktestOutput(output) {
  const result = {
    timestamp: new Date().toISOString(),
    totalReturn: null,
    totalTrades: null,
    winRate: null,
    avgPnlPerTrade: null,
    maxDrawdown: null,
    avgMFE: null,
    avgMAE: null,
    timeInMarket: null,
    strategies: {},
    exitReasons: {},
    fees: null,
  };

  // Parse total return
  const returnMatch = output.match(/Total return:\s+([-+]?\d+\.?\d*)%/);
  if (returnMatch) result.totalReturn = parseFloat(returnMatch[1]);

  // Parse total trades
  const tradesMatch = output.match(/Total trades:\s+(\d+)/);
  if (tradesMatch) result.totalTrades = parseInt(tradesMatch[1]);

  // Parse win rate
  const wrMatch = output.match(/Win rate:\s+([\d.]+)%/);
  if (wrMatch) result.winRate = parseFloat(wrMatch[1]);

  // Parse avg P&L per trade
  const avgPnlMatch = output.match(/Avg P&L\/trade:\s+([-+]?\d+\.?\d*)%/);
  if (avgPnlMatch) result.avgPnlPerTrade = parseFloat(avgPnlMatch[1]);

  // Parse max drawdown
  const ddMatch = output.match(/Max drawdown:\s+([\d.]+)%/);
  if (ddMatch) result.maxDrawdown = parseFloat(ddMatch[1]);

  // Parse avg MFE
  const mfeMatch = output.match(/Avg MFE:\s+([\d.]+)%/);
  if (mfeMatch) result.avgMFE = parseFloat(mfeMatch[1]);

  // Parse avg MAE
  const maeMatch = output.match(/Avg MAE:\s+([-\d.]+)%/);
  if (maeMatch) result.avgMAE = parseFloat(maeMatch[1]);

  // Parse time in market
  const timMatch = output.match(/Time in market:\s+([\d.]+)%/);
  if (timMatch) result.timeInMarket = parseFloat(timMatch[1]);

  // Parse fees
  const feeMatch = output.match(/Fees\/slippage:\s+([\d.]+)%/);
  if (feeMatch) result.fees = parseFloat(feeMatch[1]);

  // Parse strategy breakdown
  const stratLines = output.match(/^\s+(RSI|MADynamicSR|EMASMACrossover|LiquiditySweep)\s+(\d+)t\s+(\d+)%WR\s+([-+]?\d+\.?\d*)%/gm);
  if (stratLines) {
    for (const line of stratLines) {
      const m = line.match(/(RSI|MADynamicSR|EMASMACrossover|LiquiditySweep)\s+(\d+)t\s+(\d+)%WR\s+([-+]?\d+\.?\d*)%/);
      if (m) {
        result.strategies[m[1]] = {
          trades: parseInt(m[2]),
          winRate: parseInt(m[3]),
          pnl: parseFloat(m[4]),
        };
      }
    }
  }

  // Parse exit reasons
  const exitLines = output.match(/^\s+(profit_tier_1|profit_tier_2|profit_tier_3|take_profit|stop_loss|max_hold|trailing_stop)\s+(\d+)x\s+([-+]?\d+\.?\d*)%/gm);
  if (exitLines) {
    for (const line of exitLines) {
      const m = line.match(/(profit_tier_1|profit_tier_2|profit_tier_3|take_profit|stop_loss|max_hold|trailing_stop)\s+(\d+)x\s+([-+]?\d+\.?\d*)%/);
      if (m) {
        result.exitReasons[m[1]] = {
          count: parseInt(m[2]),
          pnl: parseFloat(m[3]),
        };
      }
    }
  }

  return result;
}

function runBacktest() {
  console.log('Running backtest...');
  console.log(`Command: ${BACKTEST_CMD}`);
  console.log('This may take 60-90 seconds.\n');

  try {
    const output = execSync(BACKTEST_CMD, {
      cwd: path.join(__dirname, '..'),
      timeout: 300000,  // 5 minute timeout
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,  // 50MB buffer for verbose output
    });
    return { output, parsed: parseBacktestOutput(output) };
  } catch (err) {
    if (err.stdout) {
      return { output: err.stdout, parsed: parseBacktestOutput(err.stdout) };
    }
    console.error('Backtest failed:', err.message);
    process.exit(1);
  }
}

function saveBaseline() {
  const { output, parsed } = runBacktest();

  if (!parsed.totalReturn && parsed.totalReturn !== 0) {
    console.error('ERROR: Could not parse backtest output. Cannot save baseline.');
    console.error('Raw output tail:\n', output.slice(-2000));
    process.exit(1);
  }

  // Save full baseline
  const baseline = {
    savedAt: new Date().toISOString(),
    gitCommit: getGitCommit(),
    results: parsed,
    rawOutputTail: output.slice(-3000),  // Last 3000 chars for reference
  };

  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));

  console.log('════════════════════════════════════════════════');
  console.log('BASELINE SAVED');
  console.log('════════════════════════════════════════════════');
  console.log(`File: ${BASELINE_FILE}`);
  console.log(`Commit: ${baseline.gitCommit}`);
  console.log(`Fees: ${parsed.fees}%`);
  console.log(`Total return: ${parsed.totalReturn}%`);
  console.log(`Total trades: ${parsed.totalTrades}`);
  console.log(`Win rate: ${parsed.winRate}%`);
  console.log('');
  console.log('Strategy breakdown:');
  for (const [name, data] of Object.entries(parsed.strategies)) {
    console.log(`  ${name.padEnd(20)} ${data.trades}t  ${data.winRate}%WR  ${data.pnl >= 0 ? '+' : ''}${data.pnl}%`);
  }
  console.log('');
  console.log('Exit reasons:');
  for (const [reason, data] of Object.entries(parsed.exitReasons)) {
    console.log(`  ${reason.padEnd(20)} ${data.count}x  ${data.pnl >= 0 ? '+' : ''}${data.pnl}%`);
  }
  console.log('');
  console.log('This is now the known-good baseline.');
  console.log('Run --check after any code change to verify nothing broke.');
}

function checkAgainstBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    console.error('ERROR: No baseline found. Run --baseline first.');
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const { parsed: current } = runBacktest();

  console.log('════════════════════════════════════════════════');
  console.log('REGRESSION CHECK');
  console.log('════════════════════════════════════════════════');
  console.log(`Baseline from: ${baseline.savedAt}`);
  console.log(`Baseline commit: ${baseline.gitCommit}`);
  console.log(`Current commit: ${getGitCommit()}`);
  console.log('');

  const failures = [];
  const warnings = [];
  const passes = [];

  // Check fees match
  if (baseline.results.fees !== current.fees) {
    failures.push(`FEES CHANGED: baseline ${baseline.results.fees}% → current ${current.fees}% — different fee = different universe, comparison invalid`);
  } else {
    passes.push(`Fees: ${current.fees}%`);
  }

  // Check total trades
  if (baseline.results.totalTrades !== current.totalTrades) {
    failures.push(`TOTAL TRADES: baseline ${baseline.results.totalTrades} → current ${current.totalTrades}`);
  } else {
    passes.push(`Total trades: ${current.totalTrades}`);
  }

  // Check total return
  const returnDiff = Math.abs((baseline.results.totalReturn || 0) - (current.totalReturn || 0));
  if (returnDiff > PNL_TOLERANCE) {
    failures.push(`TOTAL RETURN: baseline ${baseline.results.totalReturn}% → current ${current.totalReturn}% (diff: ${returnDiff.toFixed(4)}%)`);
  } else {
    passes.push(`Total return: ${current.totalReturn}%`);
  }

  // Check win rate
  if (baseline.results.winRate !== current.winRate) {
    failures.push(`WIN RATE: baseline ${baseline.results.winRate}% → current ${current.winRate}%`);
  } else {
    passes.push(`Win rate: ${current.winRate}%`);
  }

  // Check each strategy
  const allStrats = new Set([
    ...Object.keys(baseline.results.strategies || {}),
    ...Object.keys(current.strategies || {}),
  ]);

  for (const strat of allStrats) {
    const base = baseline.results.strategies[strat];
    const curr = current.strategies[strat];

    if (!base && curr) {
      warnings.push(`NEW STRATEGY: ${strat} (${curr.trades}t) — not in baseline`);
      continue;
    }
    if (base && !curr) {
      failures.push(`MISSING STRATEGY: ${strat} was in baseline (${base.trades}t) but not in current`);
      continue;
    }

    // Trade count must be exact
    if (base.trades !== curr.trades) {
      failures.push(`${strat} TRADES: ${base.trades} → ${curr.trades}`);
    } else {
      passes.push(`${strat} trades: ${curr.trades}`);
    }

    // Win rate must be exact
    if (base.winRate !== curr.winRate) {
      failures.push(`${strat} WIN RATE: ${base.winRate}% → ${curr.winRate}%`);
    } else {
      passes.push(`${strat} WR: ${curr.winRate}%`);
    }

    // P&L within tolerance
    const pnlDiff = Math.abs(base.pnl - curr.pnl);
    if (pnlDiff > PNL_TOLERANCE) {
      failures.push(`${strat} P&L: ${base.pnl}% → ${curr.pnl}% (diff: ${pnlDiff.toFixed(4)}%)`);
    } else {
      passes.push(`${strat} P&L: ${curr.pnl}%`);
    }
  }

  // Check exit reasons
  const allExits = new Set([
    ...Object.keys(baseline.results.exitReasons || {}),
    ...Object.keys(current.exitReasons || {}),
  ]);

  for (const reason of allExits) {
    const base = baseline.results.exitReasons[reason];
    const curr = current.exitReasons[reason];

    if (!base && curr) {
      warnings.push(`NEW EXIT REASON: ${reason} (${curr.count}x)`);
      continue;
    }
    if (base && !curr) {
      failures.push(`MISSING EXIT REASON: ${reason} was ${base.count}x in baseline`);
      continue;
    }

    if (base.count !== curr.count) {
      failures.push(`EXIT ${reason}: ${base.count}x → ${curr.count}x`);
    } else {
      passes.push(`Exit ${reason}: ${curr.count}x`);
    }
  }

  // Print results
  console.log(`PASSED: ${passes.length}`);
  for (const p of passes) console.log(`  ✅ ${p}`);

  if (warnings.length > 0) {
    console.log(`\nWARNINGS: ${warnings.length}`);
    for (const w of warnings) console.log(`  ⚠️  ${w}`);
  }

  if (failures.length > 0) {
    console.log(`\nFAILED: ${failures.length}`);
    for (const f of failures) console.log(`  ❌ ${f}`);
    console.log('\n════════════════════════════════════════════════');
    console.log('❌ REGRESSION CHECK FAILED');
    console.log('Something changed. Do NOT commit until you understand why.');
    console.log('════════════════════════════════════════════════');
    process.exit(1);
  } else {
    console.log('\n════════════════════════════════════════════════');
    console.log('✅ REGRESSION CHECK PASSED');
    console.log('All numbers match baseline. Safe to commit.');
    console.log('════════════════════════════════════════════════');
  }
}

function showBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    console.error('No baseline saved yet. Run --baseline first.');
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  console.log('════════════════════════════════════════════════');
  console.log('SAVED BASELINE');
  console.log('════════════════════════════════════════════════');
  console.log(`Saved: ${baseline.savedAt}`);
  console.log(`Commit: ${baseline.gitCommit}`);
  console.log(`Fees: ${baseline.results.fees}%`);
  console.log(`Total return: ${baseline.results.totalReturn}%`);
  console.log(`Total trades: ${baseline.results.totalTrades}`);
  console.log(`Win rate: ${baseline.results.winRate}%`);
  console.log('');
  console.log('Strategies:');
  for (const [name, data] of Object.entries(baseline.results.strategies || {})) {
    console.log(`  ${name.padEnd(20)} ${data.trades}t  ${data.winRate}%WR  ${data.pnl >= 0 ? '+' : ''}${data.pnl}%`);
  }
  console.log('');
  console.log('Exit reasons:');
  for (const [reason, data] of Object.entries(baseline.results.exitReasons || {})) {
    console.log(`  ${reason.padEnd(20)} ${data.count}x  ${data.pnl >= 0 ? '+' : ''}${data.pnl}%`);
  }
}

function getGitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: path.join(__dirname, '..') }).trim();
  } catch {
    return 'unknown';
  }
}

// CLI
const args = process.argv.slice(2);
if (args.includes('--baseline')) {
  saveBaseline();
} else if (args.includes('--check')) {
  checkAgainstBaseline();
} else if (args.includes('--show')) {
  showBaseline();
} else {
  console.log('regression-test.js — Strategy Regression Testing');
  console.log('');
  console.log('Usage:');
  console.log('  node tools/regression-test.js --baseline   Save current results as known-good');
  console.log('  node tools/regression-test.js --check      Compare current run against baseline');
  console.log('  node tools/regression-test.js --show       Show saved baseline');
  console.log('');
  console.log('Workflow:');
  console.log('  1. Get to a known-good state');
  console.log('  2. Run --baseline to save it');
  console.log('  3. Make a code change');
  console.log('  4. Run --check to verify nothing broke');
  console.log('  5. If check passes → safe to commit');
  console.log('  6. If check fails → something broke, investigate before committing');
}
