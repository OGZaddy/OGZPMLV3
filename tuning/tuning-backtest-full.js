#!/usr/bin/env node
/**
 * tuning-backtest-full.js - Full Strategy Stack Tuning Backtest
 * ==============================================================
 * Wires ALL signal modules through the StrategyOrchestrator.
 * 
 * Fixes the zero-confidence problem: the original tuning-backtest.js
 * passed empty extras to the orchestrator, so only RSI fired.
 * This version instantiates every signal module, feeds each candle
 * through them, and passes results as extras — exactly like 
 * CandleProcessor.processNewCandle() does in production.
 *
 * Usage:
 *   STOP_LOSS_PERCENT=2.0 TAKE_PROFIT_PERCENT=2.5 \
 *   MIN_CONFIDENCE=50 FEES_PCT=0.25 \
 *   CANDLE_FILE=tuning/seg_1_range.json \
 *   node tuning/tuning-backtest-full.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const projectRoot = path.resolve(__dirname, '..');

// ── CORE MODULES ──────────────────────────────────────────────────────────
const IndicatorEngine = require(path.join(projectRoot, 'core/indicators/IndicatorEngine'));
const { getInstance: getExitContractManager } = require(path.join(projectRoot, 'core/ExitContractManager'));
const TradingConfig = require(path.join(projectRoot, 'core/TradingConfig'));
const { StrategyOrchestrator } = require(path.join(projectRoot, 'core/StrategyOrchestrator'));

// ── SIGNAL MODULES (the missing pieces) ───────────────────────────────────
const EMASMACrossoverSignal = require(path.join(projectRoot, 'modules/EMASMACrossoverSignal'));
const MADynamicSR = require(path.join(projectRoot, 'modules/MADynamicSR'));
const LiquiditySweepDetector = require(path.join(projectRoot, 'modules/LiquiditySweepDetector'));
const BreakAndRetest = require(path.join(projectRoot, 'modules/BreakAndRetest'));
const MultiTimeframeAdapter = require(path.join(projectRoot, 'modules/MultiTimeframeAdapter'));
const VolumeProfile = require(path.join(projectRoot, 'core/VolumeProfile'));

// ── CONFIG FROM ENV ───────────────────────────────────────────────────────
const CANDLE_FILE = process.env.CANDLE_FILE || 'tuning/seg_1_range.json';
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE) || 50;  // Match production (was 35)
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_BALANCE) || 10000;
const POSITION_SIZE_PCT = parseFloat(process.env.POSITION_SIZE_PCT) || 4;
const FEES_PCT = parseFloat(process.env.FEES_PCT) || 0.65;  // Round-trip fees (maker 0.25% + taker 0.40%)
const ENABLE_SHORTS = process.env.ENABLE_SHORTS === 'true';
const MIN_CONFLUENCE = parseInt(process.env.MIN_CONFLUENCE) || 1;
const ISOLATE_STRATEGY = process.env.ISOLATE || null;  // e.g. 'MADynamicSR' to test one strategy alone

// Exit config from TradingConfig (reads env vars)
const STOP_LOSS_PCT = parseFloat(process.env.STOP_LOSS_PERCENT) || TradingConfig.get('exits.stopLossPercent') || 2.0;
const TAKE_PROFIT_PCT = parseFloat(process.env.TAKE_PROFIT_PERCENT) || TradingConfig.get('exits.takeProfitPercent') || 2.5;
const TIER1 = parseFloat(process.env.TIER1_TARGET) || 0.007;
const TIER2 = parseFloat(process.env.TIER2_TARGET) || 0.010;
const TIER3 = parseFloat(process.env.TIER3_TARGET) || 0.015;

console.log('='.repeat(60));
console.log('FULL-STACK TUNING BACKTEST');
console.log('='.repeat(60));
console.log(`Candle file:    ${CANDLE_FILE}`);
console.log(`Min confidence: ${MIN_CONFIDENCE}%`);
console.log(`Min confluence: ${MIN_CONFLUENCE}`);
if (ISOLATE_STRATEGY) {
  console.log(`\n>>> ISOLATION MODE: Testing ${ISOLATE_STRATEGY} ONLY <<<\n`);
}
console.log(`Stop loss:      ${STOP_LOSS_PCT}%`);
console.log(`Take profit:    ${TAKE_PROFIT_PCT}%`);
console.log(`Profit tiers:   ${(TIER1*100).toFixed(1)}% / ${(TIER2*100).toFixed(1)}% / ${(TIER3*100).toFixed(1)}%`);
console.log(`Fees/slippage:  ${FEES_PCT}% per trade`);
console.log(`Shorts:         ${ENABLE_SHORTS ? 'ON' : 'OFF'}`);
console.log('='.repeat(60));

// ── LOAD CANDLES ──────────────────────────────────────────────────────────
const candlePath = path.resolve(projectRoot, CANDLE_FILE);
let candles;
try {
  const raw = fs.readFileSync(candlePath, 'utf8');
  candles = JSON.parse(raw).map(c => ({
    t: c.t || c.timestamp,
    o: c.o || c.open,
    h: c.h || c.high,
    l: c.l || c.low,
    c: c.c || c.close,
    v: c.v || c.volume || 0
  }));
  console.log(`Loaded ${candles.length} candles`);
} catch (err) {
  console.error(`Failed to load candles: ${err.message}`);
  process.exit(1);
}

// ── INITIALIZE ALL MODULES (SYNCED WITH run-empire-v2.js) ─────────────────
const indicatorEngine = new IndicatorEngine({ warmupCandles: 50 });
const exitContractManager = getExitContractManager();

// Wire strategies to TradingConfig — MUST match run-empire-v2.js exactly
const emaConfig = TradingConfig.get('strategies.EMACrossover') || {};
const emaCrossover = new EMASMACrossoverSignal({
  decayBars: emaConfig.decayBars || 10,
  snapbackThresholdPct: emaConfig.snapbackThreshold || 2.5,
  blowoffAccelThreshold: emaConfig.blowoffThreshold || 0.15,
});

const masrConfig = TradingConfig.get('strategies.MADynamicSR') || {};
const maDynamicSR = new MADynamicSR({
  entryMaPeriod: masrConfig.entryMaPeriod || 20,
  srMaPeriod: masrConfig.srMaPeriod || 200,
  touchZonePct: masrConfig.touchZonePct || 0.6,
  srTestCount: masrConfig.srTestCount || 2,
  swingLookback: masrConfig.swingLookback || 3,
  srZonePct: masrConfig.srZonePct || 1.0,
  slopeLookback: masrConfig.slopeLookback || 5,
  minSlopePct: masrConfig.minSlopePct || 0.03,
  extensionPct: masrConfig.extensionPct || 2.0,
  skipFirstTouch: masrConfig.skipFirstTouch ?? true,
  atrPeriod: masrConfig.atrPeriod || 14,
  patternPersistBars: masrConfig.patternPersistBars || 15,
});

const liqConfig = TradingConfig.get('strategies.LiquiditySweep') || {};
const liquiditySweep = new LiquiditySweepDetector({
  sweepLookbackBars: liqConfig.sweepLookbackBars || 50,
  sweepMinExtensionPct: liqConfig.sweepMinExtensionPct || 0.1,
  atrMultiplier: liqConfig.atrMultiplier || 0.25,
  atrPeriod: liqConfig.atrPeriod || 14,
  entryWindowMinutes: liqConfig.entryWindowMinutes || 90,
  hammerBodyMaxPct: liqConfig.hammerBodyMaxPct || 0.35,
  hammerWickMinRatio: liqConfig.hammerWickMinRatio || 2.0,
  engulfMinRatio: liqConfig.engulfMinRatio || 1.0,
  stopBufferPct: liqConfig.stopBufferPct || 0.05,
  disableSessionCheck: liqConfig.disableSessionCheck ?? true,
});

const breakAndRetest = new BreakAndRetest();
const mtfAdapter = new MultiTimeframeAdapter();

const vpConfig = TradingConfig.get('strategies.VolumeProfile') || {};
const volumeProfile = new VolumeProfile({
  sessionLookback: vpConfig.sessionLookback || 96,
  numBins: vpConfig.numBins || 50,
  valueAreaPct: vpConfig.valueAreaPct || 0.70,
  outOfBalancePct: vpConfig.outOfBalancePct || 0.5,
  recalcInterval: vpConfig.recalcInterval || 5,
});

const orchestrator = new StrategyOrchestrator({
  minStrategyConfidence: MIN_CONFIDENCE / 100,
  minConfluenceCount: MIN_CONFLUENCE,
});

console.log(`Strategies: ${orchestrator.strategies.length} loaded`);
console.log(`Modules: EMA✓ MASR✓ LiqSweep✓ B&R✓ MTF✓ VP✓`);

// ── STATE ─────────────────────────────────────────────────────────────────
let balance = INITIAL_BALANCE;
let position = null;
const trades = [];
const priceHistory = [];
const strategyStats = {};  // per-strategy tracking
let peakBalance = INITIAL_BALANCE;

const metrics = {
  totalTrades: 0, wins: 0, losses: 0, totalPnL: 0,
  maxDrawdown: 0, mfeSum: 0, maeSum: 0, givebackCount: 0,
  timeInMarket: 0, entrySignals: 0, regimeSkips: 0,
};

// Signal state (updated each candle)
let emaCrossoverSignal = null;
let maDynamicSRSignal = null;
let liquiditySweepSignal = null;
let breakRetestSignal = null;

// ── EXIT CHECKER ──────────────────────────────────────────────────────────
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
  // Tier 3
  if (pnlPercent >= TIER3 * 100 && !pos.tier3Hit) {
    pos.tier3Hit = true;
    return { shouldExit: true, reason: 'profit_tier_3', pnlPercent };
  }
  // Tier 1
  if (pnlPercent >= TIER1 * 100 && !pos.tier1Hit) {
    pos.tier1Hit = true;
    return { shouldExit: true, reason: 'profit_tier_1', pnlPercent };
  }
  // Tier 2 tracking
  if (pnlPercent >= TIER2 * 100 && !pos.tier2Hit) pos.tier2Hit = true;

  // Trailing stop
  if (contract.trailingStopPercent && contract.trailingActivation) {
    if (pos.mfe >= contract.trailingActivation) {
      const trailStop = pos.mfe - contract.trailingStopPercent;
      if (pnlPercent <= trailStop) {
        return { shouldExit: true, reason: 'trailing_stop', pnlPercent };
      }
    }
  }
  // Max hold
  if (holdMinutes >= (contract.maxHoldTimeMinutes || 240)) {
    return { shouldExit: true, reason: 'max_hold', pnlPercent };
  }
  return { shouldExit: false, reason: null, pnlPercent };
}

// ── ENTRY ─────────────────────────────────────────────────────────────────
function executeEntry(price, confidence, time, direction, strategyName, exitContract) {
  const positionValue = balance * (POSITION_SIZE_PCT / 100);
  const amount = positionValue / price;

  const baseContract = exitContract || exitContractManager.getDefaultContract(strategyName || 'RSI');
  const contract = {
    ...baseContract,
    stopLossPercent: -Math.abs(STOP_LOSS_PCT),
    takeProfitPercent: Math.abs(TAKE_PROFIT_PCT),
  };

  position = {
    entryPrice: price, entryTime: time, amount, confidence,
    direction: direction || 'buy', exitContract: contract,
    strategyName: strategyName || 'unknown', mfe: 0, mae: 0,
  };
  balance -= positionValue;

  // Track per-strategy
  if (!strategyStats[strategyName]) strategyStats[strategyName] = { trades: 0, wins: 0, pnl: 0 };
}

// ── EXIT ──────────────────────────────────────────────────────────────────
function executeExit(price, reason, pnlPercent, time) {
  const exitValue = position.amount * price;
  const positionValue = position.amount * position.entryPrice;
  const grossPnlDollars = position.direction === 'sell'
    ? positionValue - exitValue  // short: profit when price drops
    : exitValue - positionValue;
  const feeDollars = positionValue * (FEES_PCT / 100);
  const pnlDollars = grossPnlDollars - feeDollars;
  const netPnlPercent = pnlPercent - FEES_PCT;

  balance += positionValue + pnlDollars;

  metrics.totalTrades++;
  metrics.totalPnL += netPnlPercent;
  metrics.mfeSum += position.mfe || 0;
  metrics.maeSum += position.mae || 0;
  metrics.timeInMarket += (time - position.entryTime);

  if (netPnlPercent > 0) metrics.wins++;
  else metrics.losses++;

  if ((position.mfe || 0) > 0.5 && netPnlPercent < 0) metrics.givebackCount++;

  if (balance > peakBalance) peakBalance = balance;
  const dd = ((peakBalance - balance) / peakBalance) * 100;
  if (dd > metrics.maxDrawdown) metrics.maxDrawdown = dd;

  // Per-strategy stats
  const ss = strategyStats[position.strategyName];
  if (ss) {
    ss.trades++;
    ss.pnl += netPnlPercent;
    if (netPnlPercent > 0) ss.wins++;
  }

  trades.push({
    direction: position.direction, strategyName: position.strategyName,
    entryPrice: position.entryPrice, exitPrice: price,
    pnlPercent: netPnlPercent, grossPnlPercent: pnlPercent,
    pnlDollars, feeDollars, reason, entryTime: position.entryTime,
    exitTime: time, holdDuration: time - position.entryTime,
    mfe: position.mfe, mae: position.mae, confidence: position.confidence,
  });

  position = null;
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN BACKTEST LOOP
// ══════════════════════════════════════════════════════════════════════════
console.log('\nRunning backtest...');
const startTime = Date.now();
const WARMUP = 100;  // Need 100 candles for regime detection + indicator warmup

for (let i = 0; i < candles.length; i++) {
  const candle = candles[i];
  const price = candle.c;
  const time = candle.t;

  // ── Step 1: Feed ALL modules (canonical ingestion path) ──
  indicatorEngine.updateCandle({
    o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v || 0, t: time,
  });

  priceHistory.push(candle);
  if (priceHistory.length > 500) priceHistory.shift();  // Keep last 500

  // Feed signal modules (same as CandleProcessor.processNewCandle)
  try { emaCrossoverSignal = emaCrossover.update(candle, priceHistory); } catch(e) { /* skip */ }
  try { maDynamicSRSignal = maDynamicSR.update(candle, priceHistory); } catch(e) { /* skip */ }
  try { breakRetestSignal = breakAndRetest.update(candle, priceHistory); } catch(e) { /* skip */ }
  try { liquiditySweepSignal = liquiditySweep.feedCandle(candle); } catch(e) { /* skip */ }
  try { mtfAdapter.ingestCandle(candle); } catch(e) { /* skip */ }
  try { volumeProfile.update(candle, priceHistory); } catch(e) { /* skip */ }

  // Skip warmup
  if (i < WARMUP) continue;

  // ── Step 2: Get indicators snapshot ──
  const indicators = indicatorEngine.getSnapshot();

  // ── Step 3: Check exit if in position ──
  if (position) {
    const exitCheck = checkExit(position, price, time);
    if (exitCheck.shouldExit) {
      executeExit(price, exitCheck.reason, exitCheck.pnlPercent, time);
    }
  }

  // ── Step 4: Check entry if flat ──
  if (!position) {
    // Build extras object — EXACTLY what CandleProcessor feeds to TradingLoop
    let extras = {
      emaCrossoverSignal: emaCrossoverSignal || null,
      maDynamicSRSignal: maDynamicSRSignal || null,
      breakRetestSignal: breakRetestSignal || null,
      liquiditySweepSignal: liquiditySweepSignal || null,
      mtfAdapter: mtfAdapter,
      volumeProfile: volumeProfile,
      price: price,
    };

    // ISOLATE mode: null out all strategies except the one we're testing
    if (ISOLATE_STRATEGY) {
      const isolateMap = {
        'MADynamicSR': 'maDynamicSRSignal',
        'EMASMACrossover': 'emaCrossoverSignal',
        'LiquiditySweep': 'liquiditySweepSignal',
        'BreakAndRetest': 'breakRetestSignal',
        'RSI': null,  // RSI is built-in, handled via indicators
      };
      const keepKey = isolateMap[ISOLATE_STRATEGY];

      // Null out extras-based strategies
      extras = {
        ...extras,
        emaCrossoverSignal: keepKey === 'emaCrossoverSignal' ? extras.emaCrossoverSignal : null,
        maDynamicSRSignal: keepKey === 'maDynamicSRSignal' ? extras.maDynamicSRSignal : null,
        breakRetestSignal: keepKey === 'breakRetestSignal' ? extras.breakRetestSignal : null,
        liquiditySweepSignal: keepKey === 'liquiditySweepSignal' ? extras.liquiditySweepSignal : null,
      };

      // If not isolating RSI, disable it by setting RSI to neutral (50)
      if (ISOLATE_STRATEGY !== 'RSI' && indicators.rsi !== undefined) {
        indicators.rsi = 50;  // Neutral RSI = no signal
      }
    }

    // Run orchestrator with FULL extras (or isolated extras)
    const orchResult = orchestrator.evaluate(
      indicators,           // indicators
      [],                   // patterns (empty for now — Phase 2)
      null,                 // regime (orchestrator has its own VP chop filter)
      priceHistory,         // price history
      extras                // THE FIX: all signal module outputs
    );

    if (orchResult.action !== 'HOLD' && orchResult.confidence > 0) {
      const conf = orchResult.confidence * 100;
      metrics.entrySignals++;

      // Direction check
      const dir = orchResult.direction;
      const canEnter = (dir === 'buy') || (dir === 'sell' && ENABLE_SHORTS);

      if (canEnter && conf >= MIN_CONFIDENCE) {
        executeEntry(price, conf, time, dir, orchResult.winnerStrategy, orchResult.exitContract);
      }
    }
  }
}

// Close open position at end
if (position) {
  const last = candles[candles.length - 1];
  const dir = position.direction === 'sell' ? -1 : 1;
  const pnl = ((last.c - position.entryPrice) / position.entryPrice) * 100 * dir;
  executeExit(last.c, 'end_of_data', pnl, last.t);
}

const duration = ((Date.now() - startTime) / 1000).toFixed(1);

// ── RESULTS ───────────────────────────────────────────────────────────────
const totalReturn = ((balance - INITIAL_BALANCE) / INITIAL_BALANCE) * 100;
const winRate = metrics.totalTrades > 0 ? (metrics.wins / metrics.totalTrades) * 100 : 0;
const avgPnL = metrics.totalTrades > 0 ? metrics.totalPnL / metrics.totalTrades : 0;
const avgMFE = metrics.totalTrades > 0 ? metrics.mfeSum / metrics.totalTrades : 0;
const avgMAE = metrics.totalTrades > 0 ? metrics.maeSum / metrics.totalTrades : 0;
const givebackRate = metrics.totalTrades > 0 ? (metrics.givebackCount / metrics.totalTrades) * 100 : 0;

const totalPeriod = candles.length > 1 ? candles[candles.length-1].t - candles[0].t : 1;
const timeInMarketPct = (metrics.timeInMarket / totalPeriod) * 100;
const exposureAdjReturn = timeInMarketPct > 0 ? totalReturn / (timeInMarketPct / 100) : 0;

console.log('\n' + '='.repeat(60));
console.log('RESULTS');
console.log('='.repeat(60));
console.log(`Duration:        ${duration}s`);
console.log(`Candles:         ${candles.length}`);
console.log(`Initial balance: $${INITIAL_BALANCE.toLocaleString()}`);
console.log(`Final balance:   $${balance.toFixed(2)}`);
console.log(`Total return:    ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`);
console.log(`Total trades:    ${metrics.totalTrades} (${metrics.entrySignals} signals generated)`);
console.log(`Win rate:        ${winRate.toFixed(1)}%`);
console.log(`Avg P&L/trade:   ${avgPnL >= 0 ? '+' : ''}${avgPnL.toFixed(2)}%`);
console.log(`Max drawdown:    ${metrics.maxDrawdown.toFixed(2)}%`);
console.log(`Avg MFE:         ${avgMFE.toFixed(2)}%`);
console.log(`Avg MAE:         ${avgMAE.toFixed(2)}%`);
console.log(`Giveback rate:   ${givebackRate.toFixed(1)}%`);
console.log(`Time in market:  ${timeInMarketPct.toFixed(1)}%`);
console.log(`Exp-adj return:  ${exposureAdjReturn >= 0 ? '+' : ''}${exposureAdjReturn.toFixed(2)}%`);

// Strategy breakdown
const stratNames = Object.keys(strategyStats).sort((a,b) => strategyStats[b].pnl - strategyStats[a].pnl);
if (stratNames.length > 0) {
  console.log('\nSTRATEGY BREAKDOWN:');
  console.log('-'.repeat(50));
  for (const name of stratNames) {
    const s = strategyStats[name];
    const wr = s.trades > 0 ? (s.wins / s.trades * 100).toFixed(0) : '0';
    console.log(`  ${name.padEnd(20)} ${String(s.trades).padStart(3)}t  ${wr.padStart(3)}%WR  ${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}%`);
  }
}

// Exit reason breakdown
const exitReasons = {};
trades.filter(t => t.reason).forEach(t => {
  if (!exitReasons[t.reason]) exitReasons[t.reason] = { count: 0, pnl: 0 };
  exitReasons[t.reason].count++;
  exitReasons[t.reason].pnl += t.pnlPercent;
});
if (Object.keys(exitReasons).length > 0) {
  console.log('\nEXIT REASONS:');
  console.log('-'.repeat(50));
  for (const [reason, data] of Object.entries(exitReasons).sort((a,b) => b[1].count - a[1].count)) {
    console.log(`  ${reason.padEnd(20)} ${String(data.count).padStart(3)}x  ${data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)}%`);
  }
}

console.log('='.repeat(60));

// ── MADynamicSR DIAGNOSTICS ─────────────────────────────────────────────────
console.log('\nMADynamicSR DIAGNOSTICS (condition funnel):');
maDynamicSR.printDiagnostics();

// ── SAVE REPORT ───────────────────────────────────────────────────────────
const report = {
  config: {
    candleFile: CANDLE_FILE, minConfidence: MIN_CONFIDENCE,
    stopLoss: STOP_LOSS_PCT, takeProfit: TAKE_PROFIT_PCT,
    tiers: [TIER1, TIER2, TIER3], feesPct: FEES_PCT,
    enableShorts: ENABLE_SHORTS, minConfluence: MIN_CONFLUENCE,
  },
  summary: {
    initialBalance: INITIAL_BALANCE, finalBalance: balance,
    totalReturn, candlesProcessed: candles.length,
  },
  metrics: {
    totalTrades: metrics.totalTrades, winningTrades: metrics.wins,
    losingTrades: metrics.losses, winRate, totalPnL: metrics.totalPnL,
    maxDrawdown: metrics.maxDrawdown, avgMFE, avgMAE,
    givebackRate, timeInMarketPct, exposureAdjReturn,
    entrySignals: metrics.entrySignals,
  },
  strategyBreakdown: strategyStats,
  exitBreakdown: exitReasons,
  trades,
  timestamp: new Date().toISOString(),
};

const reportPath = path.join(projectRoot, 'tuning', `fullstack-report-${Date.now()}.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport saved: ${reportPath}`);
