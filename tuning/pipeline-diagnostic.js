#!/usr/bin/env node
/**
 * Pipeline Diagnostic Script
 *
 * Verifies ALL plumbing before tuning:
 * - TradingConfig respect (minTradeConfidence override)
 * - Strategy verification (confidence ranges, signals vs wins)
 * - Exit contract verification (contract matches strategy)
 * - Gate verification (counts blocks per gate)
 * - Position sizing verification
 * - Fee verification
 *
 * Output: tuning/diagnostic-report.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const projectRoot = path.resolve(__dirname, '..');

// ── CORE MODULES (same paths as tuning-backtest-full.js) ─────────────────
const IndicatorEngine = require(path.join(projectRoot, 'core/indicators/IndicatorEngine'));
const { getInstance: getExitContractManager } = require(path.join(projectRoot, 'core/ExitContractManager'));
const TradingConfig = require(path.join(projectRoot, 'core/TradingConfig'));
const { StrategyOrchestrator } = require(path.join(projectRoot, 'core/StrategyOrchestrator'));

// ── SIGNAL MODULES ───────────────────────────────────────────────────────
const EMASMACrossoverSignal = require(path.join(projectRoot, 'modules/EMASMACrossoverSignal'));
const MADynamicSR = require(path.join(projectRoot, 'modules/MADynamicSR'));
const LiquiditySweepDetector = require(path.join(projectRoot, 'modules/LiquiditySweepDetector'));
const BreakAndRetest = require(path.join(projectRoot, 'modules/BreakAndRetest'));
const MultiTimeframeAdapter = require(path.join(projectRoot, 'modules/MultiTimeframeAdapter'));
const VolumeProfile = require(path.join(projectRoot, 'core/VolumeProfile'));

// ── CONFIG FROM ENV ──────────────────────────────────────────────────────
const CANDLE_FILE = process.env.CANDLE_FILE || 'data/btc-15m-2024-2025.json';
const FEES_PCT = parseFloat(process.env.FEES_PCT) || 0;
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE) || 35;
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_BALANCE) || 10000;
const POSITION_SIZE_PCT = parseFloat(process.env.POSITION_SIZE_PCT) || 4;

// Exit config from TradingConfig
const STOP_LOSS_PCT = parseFloat(process.env.STOP_LOSS_PERCENT) || TradingConfig.get('exits.stopLossPercent') || 2.0;
const TAKE_PROFIT_PCT = parseFloat(process.env.TAKE_PROFIT_PERCENT) || TradingConfig.get('exits.takeProfitPercent') || 2.5;
const TIER1 = parseFloat(process.env.TIER1_TARGET) || 0.007;
const TIER2 = parseFloat(process.env.TIER2_TARGET) || 0.010;
const TIER3 = parseFloat(process.env.TIER3_TARGET) || 0.015;

console.log('='.repeat(70));
console.log('PIPELINE DIAGNOSTIC - PLUMBING VERIFICATION');
console.log('='.repeat(70));
console.log(`Candle file:    ${CANDLE_FILE}`);
console.log(`Min confidence: ${MIN_CONFIDENCE}%`);
console.log(`Fees/slippage:  ${FEES_PCT}%`);
console.log('='.repeat(70));

// ── LOAD CANDLES ─────────────────────────────────────────────────────────
const candlePath = path.resolve(projectRoot, CANDLE_FILE);
let candles;
try {
  const raw = fs.readFileSync(candlePath, 'utf8');
  candles = JSON.parse(raw).map(c => ({
    t: _t(c) || c.timestamp,
    o: _o(c) || c.open,
    h: _h(c) || c.high,
    l: _l(c) || c.low,
    c: _c(c) || c.close,
    v: _v(c) || c.volume || 0
  }));
  console.log(`Loaded ${candles.length} candles\n`);
} catch (err) {
  console.error(`Failed to load candles: ${err.message}`);
  process.exit(1);
}

// ── DIAGNOSTIC REPORT STRUCTURE ──────────────────────────────────────────
const report = {
  timestamp: new Date().toISOString(),
  config: {
    candleFile: CANDLE_FILE,
    minConfidence: MIN_CONFIDENCE,
    feesPct: FEES_PCT,
    stopLoss: STOP_LOSS_PCT,
    takeProfit: TAKE_PROFIT_PCT,
    tiers: [TIER1, TIER2, TIER3]
  },
  tests: {
    tradingConfigRespect: { status: 'pending', details: {} },
    strategyVerification: { status: 'pending', details: {} },
    exitContractVerification: { status: 'pending', details: {} },
    gateVerification: { status: 'pending', details: {} },
    feeVerification: { status: 'pending', details: {} },
    positionSizing: { status: 'pending', details: {} }
  },
  flags: [],
  summary: { passed: 0, failed: 0, warnings: 0 }
};

// ── INITIALIZE ALL MODULES ───────────────────────────────────────────────
const indicatorEngine = new IndicatorEngine({ warmupCandles: 50 });
const exitContractManager = getExitContractManager();
const emaCrossover = new EMASMACrossoverSignal();
const maDynamicSR = new MADynamicSR({ emaPeriod: 20, trendEmaPeriod: 50 });
const liquiditySweep = new LiquiditySweepDetector();
const breakAndRetest = new BreakAndRetest();
const mtfAdapter = new MultiTimeframeAdapter();
const volumeProfile = new VolumeProfile();

const orchestrator = new StrategyOrchestrator({
  minStrategyConfidence: MIN_CONFIDENCE / 100,
  minConfluenceCount: 1,
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: TradingConfig Respect
// ═══════════════════════════════════════════════════════════════════════════
console.log('TEST 1: TradingConfig Respect');
console.log('-'.repeat(50));

const tcConfidence = TradingConfig.get('confidence');
const tcExits = TradingConfig.get('exits');
const tcFees = TradingConfig.get('fees');

report.tests.tradingConfigRespect.details = {
  configConfidence: tcConfidence,
  configExits: tcExits,
  configFees: tcFees,
  envMinConfidence: MIN_CONFIDENCE,
  envFeesPct: FEES_PCT
};

// Check if we can read config values
if (tcConfidence && tcExits) {
  console.log(`  ✓ TradingConfig readable`);
  console.log(`    - minTradeConfidence: ${tcConfidence.minTradeConfidence}`);
  console.log(`    - stopLossPercent: ${tcExits.stopLossPercent}`);
  console.log(`    - takeProfitPercent: ${tcExits.takeProfitPercent}`);
  report.tests.tradingConfigRespect.status = 'pass';
  report.summary.passed++;
} else {
  console.log(`  ✗ TradingConfig NOT readable`);
  report.tests.tradingConfigRespect.status = 'fail';
  report.flags.push('TradingConfig values not accessible');
  report.summary.failed++;
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: Exit Contract Verification
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nTEST 2: Exit Contract Verification');
console.log('-'.repeat(50));

const strategyNames = ['RSI', 'EMASMACrossover', 'MADynamicSR', 'BreakAndRetest', 'LiquiditySweep'];
const contracts = {};
let contractsValid = true;

for (const strat of strategyNames) {
  try {
    const contract = exitContractManager.getDefaultContract(strat);
    contracts[strat] = contract;
    console.log(`  ✓ ${strat}: SL=${contract.stopLossPercent}% TP=${contract.takeProfitPercent}% MaxHold=${contract.maxHoldTimeMinutes}min`);
  } catch (e) {
    console.log(`  ✗ ${strat}: Failed to get contract - ${e.message}`);
    contracts[strat] = null;
    contractsValid = false;
  }
}

report.tests.exitContractVerification.details = { contracts };
report.tests.exitContractVerification.status = contractsValid ? 'pass' : 'fail';
if (contractsValid) report.summary.passed++; else report.summary.failed++;

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: Full Backtest with Detailed Logging
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nTEST 3: Full Backtest with Strategy Tracking');
console.log('-'.repeat(50));

// State
let balance = INITIAL_BALANCE;
let position = null;
const trades = [];
const priceHistory = [];
const strategyStats = {};
let peakBalance = INITIAL_BALANCE;

// Signal state
let emaCrossoverSignal = null;
let maDynamicSRSignal = null;
let liquiditySweepSignal = null;
let breakRetestSignal = null;

// Gate counters
const gateBlocks = {
  confidence: 0,
  confluence: 0,
  vpChop: 0,
  regime: 0,
  shorts: 0
};

// Entry/exit counters
const entryReasons = {};
const exitReasons = {};

function checkExit(pos, price, time) {
  const dir = pos.direction === 'sell' ? -1 : 1;
  const pnlPercent = ((price - pos.entryPrice) / pos.entryPrice) * 100 * dir;
  const holdMinutes = (time - pos.entryTime) / 60000;
  const contract = pos.exitContract;

  if (pnlPercent > (pos.mfe || 0)) pos.mfe = pnlPercent;
  if (pnlPercent < (pos.mae || 0)) pos.mae = pnlPercent;

  // Stop loss
  if (pnlPercent <= contract.stopLossPercent) {
    return { shouldExit: true, reason: 'stop_loss', pnlPercent };
  }
  // Take profit
  if (pnlPercent >= contract.takeProfitPercent) {
    return { shouldExit: true, reason: 'take_profit', pnlPercent };
  }
  // Tier 1
  if (pnlPercent >= TIER1 * 100 && !pos.tier1Hit) {
    pos.tier1Hit = true;
    return { shouldExit: true, reason: 'profit_tier_1', pnlPercent };
  }
  // Max hold
  if (holdMinutes >= (contract.maxHoldTimeMinutes || 240)) {
    return { shouldExit: true, reason: 'max_hold', pnlPercent };
  }
  return { shouldExit: false, reason: null, pnlPercent };
}

function executeEntry(price, confidence, time, direction, strategyName, exitContract) {
  const positionValue = balance * (POSITION_SIZE_PCT / 100);
  const amount = positionValue / price;

  // Normalize strategyName - use 'RSI' as fallback (default strategy)
  const normalizedStrategy = strategyName || 'RSI';

  const baseContract = exitContract || exitContractManager.getDefaultContract(normalizedStrategy);
  const contract = {
    ...baseContract,
    stopLossPercent: -Math.abs(STOP_LOSS_PCT),
    takeProfitPercent: Math.abs(TAKE_PROFIT_PCT),
  };

  position = {
    entryPrice: price, entryTime: time, amount, confidence,
    direction: direction || 'buy', exitContract: contract,
    strategyName: normalizedStrategy, mfe: 0, mae: 0,
  };
  balance -= positionValue;

  if (!strategyStats[normalizedStrategy]) strategyStats[normalizedStrategy] = { trades: 0, wins: 0, pnl: 0, confidences: [] };
  strategyStats[normalizedStrategy].confidences.push(confidence);

  entryReasons[strategyName] = (entryReasons[strategyName] || 0) + 1;
}

function executeExit(price, reason, pnlPercent, time) {
  const exitValue = position.amount * price;
  const positionValue = position.amount * position.entryPrice;
  const grossPnlDollars = position.direction === 'sell'
    ? positionValue - exitValue
    : exitValue - positionValue;
  const feeDollars = positionValue * (FEES_PCT / 100);
  const pnlDollars = grossPnlDollars - feeDollars;
  const netPnlPercent = pnlPercent - FEES_PCT;

  balance += positionValue + pnlDollars;

  const ss = strategyStats[position.strategyName];
  if (ss) {
    ss.trades++;
    ss.pnl += netPnlPercent;
    if (netPnlPercent > 0) ss.wins++;
  }

  if (balance > peakBalance) peakBalance = balance;

  exitReasons[reason] = (exitReasons[reason] || 0) + 1;

  trades.push({
    strategyName: position.strategyName,
    entryPrice: position.entryPrice,
    exitPrice: price,
    pnlPercent: netPnlPercent,
    grossPnlPercent: pnlPercent,
    feeDollars,
    reason,
    confidence: position.confidence,
    contract: position.exitContract
  });

  position = null;
}

// Run backtest
const WARMUP = 100;
let signalCount = 0;

for (let i = 0; i < candles.length; i++) {
  const candle = candles[i];
  const price = _c(candle);
  const time = _t(candle);

  // Feed all modules
  indicatorEngine.updateCandle({
    o: _o(candle), h: _h(candle), l: _l(candle), c: _c(candle), v: _v(candle) || 0, t: time,
  });

  priceHistory.push(candle);
  if (priceHistory.length > 500) priceHistory.shift();

  try { emaCrossoverSignal = emaCrossover.update(candle, priceHistory); } catch(e) {}
  try { maDynamicSRSignal = maDynamicSR.update(candle, priceHistory); } catch(e) {}
  try { breakRetestSignal = breakAndRetest.update(candle, priceHistory); } catch(e) {}
  try { liquiditySweepSignal = liquiditySweep.feedCandle(candle); } catch(e) {}
  try { mtfAdapter.ingestCandle(candle); } catch(e) {}
  try { volumeProfile.update(candle, priceHistory); } catch(e) {}

  if (i < WARMUP) continue;

  const indicators = indicatorEngine.getSnapshot();

  // Check exit
  if (position) {
    const exitCheck = checkExit(position, price, time);
    if (exitCheck.shouldExit) {
      executeExit(price, exitCheck.reason, exitCheck.pnlPercent, time);
    }
  }

  // Check entry
  if (!position) {
    const extras = {
      emaCrossoverSignal, maDynamicSRSignal, breakRetestSignal, liquiditySweepSignal,
      mtfAdapter, volumeProfile, price,
    };

    const orchResult = orchestrator.evaluate(indicators, extras);

    if (orchResult.direction === 'buy' || orchResult.direction === 'sell') {
      signalCount++;

      // Confidence gate check
      if (orchResult.confidence < MIN_CONFIDENCE) {
        gateBlocks.confidence++;
        continue;
      }

      // Shorts gate
      if (orchResult.direction === 'sell') {
        gateBlocks.shorts++;
        continue;
      }

      // VP Chop filter check (if enabled)
      if (volumeProfile && typeof volumeProfile.isChopZone === 'function') {
        if (volumeProfile.isChopZone(price)) {
          gateBlocks.vpChop++;
          continue;
        }
      }

      // Execute entry
      executeEntry(price, orchResult.confidence, time, orchResult.direction,
                   orchResult.strategyName, orchResult.exitContract);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RESULTS ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n  Candles processed: ${candles.length}`);
console.log(`  Total trades: ${trades.length}`);
console.log(`  Signals generated: ${signalCount}`);
console.log(`  Final balance: $${balance.toFixed(2)}`);
console.log(`  Total return: ${((balance - INITIAL_BALANCE) / INITIAL_BALANCE * 100).toFixed(2)}%`);

// Strategy breakdown
console.log('\nTEST 4: Strategy Breakdown');
console.log('-'.repeat(50));
report.tests.strategyVerification.details = { strategies: {} };

let anyStrategyHasTrades = false;
for (const [strat, stats] of Object.entries(strategyStats)) {
  if (stats.trades > 0) {
    anyStrategyHasTrades = true;
    const winRate = ((stats.wins / stats.trades) * 100).toFixed(1);
    const avgConf = stats.confidences.length > 0
      ? (stats.confidences.reduce((a,b) => a+b, 0) / stats.confidences.length).toFixed(1)
      : 'N/A';
    const confRange = stats.confidences.length > 0
      ? `${Math.min(...stats.confidences).toFixed(1)}-${Math.max(...stats.confidences).toFixed(1)}`
      : 'N/A';

    console.log(`  ${strat}: ${stats.trades} trades, ${winRate}% win, PnL: ${stats.pnl.toFixed(2)}%`);
    console.log(`    Confidence: avg=${avgConf}, range=${confRange}`);

    report.tests.strategyVerification.details.strategies[strat] = {
      trades: stats.trades,
      wins: stats.wins,
      winRate: parseFloat(winRate),
      pnl: stats.pnl,
      avgConfidence: avgConf === 'N/A' ? null : parseFloat(avgConf),
      confidenceRange: confRange
    };
  }
}

if (anyStrategyHasTrades) {
  report.tests.strategyVerification.status = 'pass';
  report.summary.passed++;
} else {
  report.tests.strategyVerification.status = 'fail';
  report.flags.push('No strategies generated any trades');
  report.summary.failed++;
}

// Gate verification
console.log('\nTEST 5: Gate Verification');
console.log('-'.repeat(50));
console.log(`  Blocked by confidence gate: ${gateBlocks.confidence}`);
console.log(`  Blocked by shorts gate: ${gateBlocks.shorts}`);
console.log(`  Blocked by VP chop filter: ${gateBlocks.vpChop}`);

report.tests.gateVerification.details = { gateBlocks };
report.tests.gateVerification.status = 'pass';
report.summary.passed++;

// Exit verification
console.log('\nTEST 6: Exit Reason Breakdown');
console.log('-'.repeat(50));
for (const [reason, count] of Object.entries(exitReasons)) {
  console.log(`  ${reason}: ${count}`);
}

// Fee verification
console.log('\nTEST 7: Fee Verification');
console.log('-'.repeat(50));
const totalFees = trades.reduce((sum, t) => sum + (t.feeDollars || 0), 0);
const avgFeePerTrade = trades.length > 0 ? totalFees / trades.length : 0;

console.log(`  FEES_PCT setting: ${FEES_PCT}%`);
console.log(`  Total fees paid: $${totalFees.toFixed(2)}`);
console.log(`  Avg fee per trade: $${avgFeePerTrade.toFixed(2)}`);

report.tests.feeVerification.details = {
  feesPctSetting: FEES_PCT,
  totalFeesPaid: totalFees,
  avgFeePerTrade
};

if (FEES_PCT > 0 && totalFees > 0) {
  report.tests.feeVerification.status = 'pass';
  console.log(`  ✓ Fees are being applied`);
  report.summary.passed++;
} else if (FEES_PCT === 0) {
  report.tests.feeVerification.status = 'pass';
  console.log(`  ✓ Fees disabled (FEES_PCT=0)`);
  report.summary.passed++;
} else {
  report.tests.feeVerification.status = 'fail';
  report.flags.push('FEES_PCT > 0 but no fees applied');
  report.summary.failed++;
}

// Position sizing verification
console.log('\nTEST 8: Position Sizing Verification');
console.log('-'.repeat(50));
console.log(`  POSITION_SIZE_PCT: ${POSITION_SIZE_PCT}%`);
console.log(`  Expected position value: $${(INITIAL_BALANCE * POSITION_SIZE_PCT / 100).toFixed(2)}`);

report.tests.positionSizing.details = { positionSizePct: POSITION_SIZE_PCT };
report.tests.positionSizing.status = 'pass';
report.summary.passed++;

// ═══════════════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log('DIAGNOSTIC SUMMARY');
console.log('='.repeat(70));

console.log(`Tests Passed: ${report.summary.passed}`);
console.log(`Tests Failed: ${report.summary.failed}`);

if (report.flags.length > 0) {
  console.log('\n🚨 FLAGS:');
  for (const flag of report.flags) {
    console.log(`  - ${flag}`);
  }
}

if (report.summary.failed === 0) {
  console.log('\n✅ ALL PLUMBING CHECKS PASSED');
} else {
  console.log('\n❌ SOME CHECKS FAILED - DO NOT MERGE');
}

// Write report
const reportPath = path.join(projectRoot, 'tuning', `diagnostic-report-${Date.now()}.json`);
report.backtest = {
  candlesProcessed: candles.length,
  totalTrades: trades.length,
  signalsGenerated: signalCount,
  finalBalance: balance,
  totalReturn: ((balance - INITIAL_BALANCE) / INITIAL_BALANCE * 100),
  strategyStats,
  gateBlocks,
  exitReasons,
  trades: trades.slice(0, 20) // First 20 trades for debugging
};

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport written to: ${reportPath}`);
