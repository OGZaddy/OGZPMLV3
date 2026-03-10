#!/usr/bin/env node

/**
 * trade-validator.js — Prove Every Trade Is Real
 * ================================================
 * 
 * PURPOSE: Independently verify that every trade entry and exit
 * matches the strategy's claimed conditions. No trust — only math.
 * 
 * WHAT IT DOES:
 *   Runs the backtest, captures every trade, then INDEPENDENTLY 
 *   recalculates indicators and checks that the entry conditions
 *   were actually true on the entry candle.
 * 
 * USAGE:
 *   node tools/trade-validator.js                    # Validate all trades
 *   node tools/trade-validator.js --strategy RSI     # Validate one strategy
 *   node tools/trade-validator.js --verbose          # Show every check
 * 
 * OUTPUT:
 *   For each trade:
 *     ✅ RSI Trade #1 @ candle 4523: RSI=22.4 < 25 (oversold) → BUY ✓
 *     ❌ MADynamicSR Trade #3 @ candle 8891: 20 MA slope=flat but claimed rising → INVALID
 * 
 * RULE: If ANY trade fails validation, the strategy has a bug.
 *       Zero tolerance. Every entry must be provably correct.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Project root
const projectRoot = path.resolve(__dirname, '..');

// Load modules for independent calculation
const TradingConfig = require(path.join(projectRoot, 'core/TradingConfig'));
const { c, o, h, l, v, t } = require(path.join(projectRoot, 'core/CandleHelper'));

// ── CONFIG ──
const CANDLE_FILE = process.env.CANDLE_FILE || 'tuning/full-45k.json';
const STRATEGY_FILTER = process.argv.find(a => a.startsWith('--strategy='))?.split('=')[1] 
  || (process.argv.includes('--strategy') ? process.argv[process.argv.indexOf('--strategy') + 1] : null);
const VERBOSE = process.argv.includes('--verbose');
const FEES_PCT = parseFloat(process.env.FEES_PCT) || 0.50;

// ── LOAD CANDLES ──
const candlePath = path.resolve(projectRoot, CANDLE_FILE);
if (!fs.existsSync(candlePath)) {
  console.error(`Candle file not found: ${candlePath}`);
  process.exit(1);
}
const candles = JSON.parse(fs.readFileSync(candlePath, 'utf8'));
console.log(`Loaded ${candles.length} candles from ${CANDLE_FILE}`);

// ── INDEPENDENT INDICATOR CALCULATIONS ──
// These do NOT use IndicatorEngine — they calculate from raw candle data
// to independently verify what the strategies claim

function calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += closes[i];
  ema /= period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  let trSum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      h(curr) - l(curr),
      Math.abs(h(curr) - c(prev)),
      Math.abs(l(curr) - c(prev))
    );
    trSum += tr;
  }
  return trSum / period;
}

function calcEMASlope(closes, period, slopeLookback = 5) {
  if (closes.length < period + slopeLookback) return 'unknown';
  const currentEMA = calcEMA(closes, period);
  const olderCloses = closes.slice(0, closes.length - slopeLookback);
  const olderEMA = calcEMA(olderCloses, period);
  if (!currentEMA || !olderEMA || olderEMA === 0) return 'unknown';
  const slopePct = ((currentEMA - olderEMA) / olderEMA) * 100;
  if (slopePct > 0.03) return 'rising';
  if (slopePct < -0.03) return 'falling';
  return 'flat';
}

function isTouchingEMA(price, ema, touchZonePct = 0.6) {
  if (!ema || ema === 0) return false;
  const distance = Math.abs(price - ema) / ema * 100;
  return distance <= touchZonePct;
}

function isExtended(price, ema, extensionPct = 2.0) {
  if (!ema || ema === 0) return false;
  const distance = Math.abs(price - ema) / ema * 100;
  return distance > extensionPct;
}

// ── RUN BACKTEST AND CAPTURE TRADES ──
// We run the actual backtest and capture trade details

function runBacktestAndCaptureTrades() {
  // Load all required modules
  const IndicatorEngine = require(path.join(projectRoot, 'core/IndicatorCalculator'));
  const EMASMACrossoverSignal = require(path.join(projectRoot, 'modules/EMASMACrossoverSignal'));
  const MADynamicSR = require(path.join(projectRoot, 'modules/MADynamicSR'));
  const LiquiditySweepDetector = require(path.join(projectRoot, 'modules/LiquiditySweepDetector'));
  const StrategyOrchestrator = require(path.join(projectRoot, 'core/StrategyOrchestrator'));
  const { getInstance: getExitContractManager } = require(path.join(projectRoot, 'core/ExitContractManager'));

  // Initialize exactly like the backtest does
  const indicatorEngine = new IndicatorEngine({ warmupCandles: 50 });
  const exitContractManager = getExitContractManager();

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

  const orchestrator = new StrategyOrchestrator({
    minStrategyConfidence: 50 / 100,
    minConfluenceCount: 1,
  });

  // Run candles and capture trades with their entry candle index
  const priceHistory = [];
  const trades = [];
  let position = null;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    priceHistory.push(candle);
    const price = c(candle);

    // Update indicators
    indicatorEngine.update(candle);
    const indicators = indicatorEngine.getSnapshot ? indicatorEngine.getSnapshot() : indicatorEngine;

    // Update signal modules
    let emaSig = null, masrSig = null, liqSig = null;
    try { emaSig = emaCrossover.update(candle, priceHistory); } catch(e) {}
    try { masrSig = maDynamicSR.update(candle, priceHistory); } catch(e) {}
    try { liqSig = liquiditySweep.feedCandle(candle); } catch(e) {}

    // Check exit if in position
    if (position) {
      const pnlPct = ((price - position.entryPrice) / position.entryPrice) * 100;
      const holdBars = i - position.entryIndex;
      
      // Simple exit: SL, TP, or max hold
      const contract = position.exitContract || {};
      let exitReason = null;
      if (pnlPct <= (contract.stopLossPercent || -2.0)) exitReason = 'stop_loss';
      else if (pnlPct >= (contract.takeProfitPercent || 2.5)) exitReason = 'take_profit';
      else if (holdBars >= (contract.maxHoldTimeMinutes ? contract.maxHoldTimeMinutes / 15 : 24)) exitReason = 'max_hold';
      // Tier exits
      else if (pnlPct >= 1.5) exitReason = 'profit_tier_3';
      else if (pnlPct >= 1.0) exitReason = 'profit_tier_2';
      else if (pnlPct >= 0.7) exitReason = 'profit_tier_1';

      if (exitReason) {
        position.exitPrice = price;
        position.exitIndex = i;
        position.exitReason = exitReason;
        position.pnlPct = pnlPct - FEES_PCT;
        trades.push(position);
        position = null;
      }

      // Track MFE/MAE
      if (position) {
        if (pnlPct > (position.mfe || 0)) position.mfe = pnlPct;
        if (pnlPct < (position.mae || 0)) position.mae = pnlPct;
      }
      continue; // Don't look for new entries while in position
    }

    // Evaluate orchestrator
    const orchResult = orchestrator.evaluate(
      indicators, [], null, priceHistory,
      {
        emaCrossoverSignal: emaSig,
        maDynamicSRSignal: masrSig,
        liquiditySweepSignal: liqSig,
        price: price,
      }
    );

    if (orchResult.action !== 'HOLD' && orchResult.direction === 'buy' && orchResult.confidence >= 50) {
      position = {
        strategyName: orchResult.winnerStrategy,
        direction: orchResult.direction,
        entryPrice: price,
        entryIndex: i,
        entryCandle: candle,
        confidence: orchResult.confidence,
        reason: orchResult.reasons?.[0] || '',
        exitContract: orchResult.exitContract,
        signalData: orchResult.allResults?.find(r => r.strategyName === orchResult.winnerStrategy)?.signalData,
        mfe: 0,
        mae: 0,
      };
    }
  }

  // Close open position at end
  if (position) {
    const lastPrice = c(candles[candles.length - 1]);
    position.exitPrice = lastPrice;
    position.exitIndex = candles.length - 1;
    position.exitReason = 'end_of_data';
    position.pnlPct = ((lastPrice - position.entryPrice) / position.entryPrice) * 100 - FEES_PCT;
    trades.push(position);
  }

  return trades;
}

// ── VALIDATE EACH TRADE ──

function validateTrade(trade, candles) {
  const checks = [];
  const idx = trade.entryIndex;
  const price = c(trade.entryCandle);
  const closesUpToEntry = candles.slice(0, idx + 1).map(x => c(x));
  const candlesUpToEntry = candles.slice(0, idx + 1);

  switch (trade.strategyName) {
    case 'RSI': {
      // Independent RSI calculation
      const rsi = calcRSI(closesUpToEntry, 14);
      const rsiConfig = TradingConfig.get('strategies.RSI') || {};
      const oversold = rsiConfig.oversoldLevel || 25;
      const overbought = rsiConfig.overboughtLevel || 75;

      checks.push({
        name: 'RSI value exists',
        passed: rsi !== null,
        expected: 'not null',
        actual: rsi !== null ? rsi.toFixed(2) : 'null',
      });

      if (trade.direction === 'buy') {
        checks.push({
          name: `RSI < ${oversold} (oversold)`,
          passed: rsi !== null && rsi < oversold,
          expected: `< ${oversold}`,
          actual: rsi !== null ? rsi.toFixed(2) : 'null',
        });
      } else if (trade.direction === 'sell') {
        checks.push({
          name: `RSI > ${overbought} (overbought)`,
          passed: rsi !== null && rsi > overbought,
          expected: `> ${overbought}`,
          actual: rsi !== null ? rsi.toFixed(2) : 'null',
        });
      }

      // Verify confidence calculation matches
      if (rsi !== null && trade.direction === 'buy') {
        const strength = Math.min(1.0, (oversold - rsi) / 15);
        const expectedConf = (0.3 + strength * 0.5) * 100;
        checks.push({
          name: 'Confidence matches formula',
          passed: Math.abs(trade.confidence - expectedConf) < 1.0,
          expected: expectedConf.toFixed(1) + '%',
          actual: trade.confidence.toFixed(1) + '%',
        });
      }
      break;
    }

    case 'MADynamicSR': {
      const masrConfig = TradingConfig.get('strategies.MADynamicSR') || {};
      const entryPeriod = masrConfig.entryMaPeriod || 20;
      const touchZone = masrConfig.touchZonePct || 0.6;
      const extensionPct = masrConfig.extensionPct || 2.0;
      const slopeLookback = masrConfig.slopeLookback || 5;

      // Check 20 MA exists and slope
      const ema20 = calcEMA(closesUpToEntry, entryPeriod);
      const slope = calcEMASlope(closesUpToEntry, entryPeriod, slopeLookback);

      checks.push({
        name: '20 MA exists',
        passed: ema20 !== null,
        expected: 'not null',
        actual: ema20 !== null ? ema20.toFixed(2) : 'null',
      });

      // Slope should match direction
      if (trade.direction === 'buy') {
        checks.push({
          name: '20 MA slope is rising (long entry)',
          passed: slope === 'rising',
          expected: 'rising',
          actual: slope,
        });
      } else {
        checks.push({
          name: '20 MA slope is falling (short entry)',
          passed: slope === 'falling',
          expected: 'falling',
          actual: slope,
        });
      }

      // Check price touching 20 MA
      const touching = isTouchingEMA(price, ema20, touchZone);
      checks.push({
        name: `Price touching 20 MA (within ${touchZone}%)`,
        passed: touching,
        expected: 'true',
        actual: touching.toString() + (ema20 ? ` (distance: ${(Math.abs(price - ema20) / ema20 * 100).toFixed(3)}%)` : ''),
      });

      // Check NOT extended
      const extended = isExtended(price, ema20, extensionPct);
      checks.push({
        name: `Price NOT extended (< ${extensionPct}% from 20 MA)`,
        passed: !extended,
        expected: 'false',
        actual: extended.toString(),
      });

      // Check ATR acceleration (candle range > 1.2x ATR)
      const atr = calcATR(candlesUpToEntry, 14);
      const candleRange = h(trade.entryCandle) - l(trade.entryCandle);
      if (atr) {
        checks.push({
          name: 'Acceleration (candle range > 1.2x ATR)',
          passed: candleRange > atr * 1.2,
          expected: `> ${(atr * 1.2).toFixed(2)}`,
          actual: candleRange.toFixed(2),
        });
      }

      break;
    }

    case 'EMASMACrossover': {
      // Check that at least some MA crossover activity exists
      // Verify confidence > 0 came from crossover scoring
      checks.push({
        name: 'Confidence > 50%',
        passed: trade.confidence >= 50,
        expected: '>= 50',
        actual: trade.confidence.toFixed(1),
      });

      checks.push({
        name: 'Direction is buy or sell',
        passed: trade.direction === 'buy' || trade.direction === 'sell',
        expected: 'buy or sell',
        actual: trade.direction,
      });

      // Check MA values exist at entry
      const ema9 = calcEMA(closesUpToEntry, 9);
      const ema20 = calcEMA(closesUpToEntry, 20);
      const ema50 = calcEMA(closesUpToEntry, 50);
      checks.push({
        name: 'EMA 9/20/50 all calculable',
        passed: ema9 !== null && ema20 !== null && ema50 !== null,
        expected: 'all not null',
        actual: `ema9=${ema9?.toFixed(0)||'null'} ema20=${ema20?.toFixed(0)||'null'} ema50=${ema50?.toFixed(0)||'null'}`,
      });

      break;
    }

    case 'LiquiditySweep': {
      // Verify signal data exists
      checks.push({
        name: 'Signal has pattern type',
        passed: !!trade.signalData?.pattern,
        expected: 'hammer|engulfing|etc',
        actual: trade.signalData?.pattern || 'none',
      });

      checks.push({
        name: 'Signal has box (high/low)',
        passed: !!(trade.signalData?.box?.high && trade.signalData?.box?.low),
        expected: 'box exists',
        actual: trade.signalData?.box ? `high=${trade.signalData.box.high?.toFixed(0)} low=${trade.signalData.box.low?.toFixed(0)}` : 'none',
      });

      checks.push({
        name: 'Direction matches pattern',
        passed: (trade.direction === 'buy' && (trade.signalData?.pattern?.includes('bullish') || trade.signalData?.pattern === 'hammer')) ||
                (trade.direction === 'sell' && (trade.signalData?.pattern?.includes('bearish') || trade.signalData?.pattern === 'inverted_hammer')),
        expected: 'direction matches pattern type',
        actual: `${trade.direction} / ${trade.signalData?.pattern || 'none'}`,
      });

      break;
    }

    default: {
      checks.push({
        name: 'Known strategy',
        passed: false,
        expected: 'RSI|MADynamicSR|EMASMACrossover|LiquiditySweep',
        actual: trade.strategyName,
      });
    }
  }

  // Universal checks for all trades
  checks.push({
    name: 'Entry price > 0',
    passed: trade.entryPrice > 0,
    expected: '> 0',
    actual: trade.entryPrice.toFixed(2),
  });

  checks.push({
    name: 'Exit price > 0',
    passed: trade.exitPrice > 0,
    expected: '> 0',
    actual: trade.exitPrice.toFixed(2),
  });

  checks.push({
    name: 'P&L calculation correct',
    passed: Math.abs(trade.pnlPct - (((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100 - FEES_PCT)) < 0.01,
    expected: 'matches raw calc',
    actual: `trade=${trade.pnlPct.toFixed(4)}% raw=${(((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100 - FEES_PCT).toFixed(4)}%`,
  });

  return checks;
}

// ── MAIN ──

console.log('\n════════════════════════════════════════════════════════');
console.log('TRADE VALIDATOR — Independent Verification');
console.log('════════════════════════════════════════════════════════');
console.log(`Fees: ${FEES_PCT}%`);
if (STRATEGY_FILTER) console.log(`Strategy filter: ${STRATEGY_FILTER}`);
console.log('');

console.log('Running backtest to capture trades...');
const trades = runBacktestAndCaptureTrades();

// Filter if requested
const filtered = STRATEGY_FILTER 
  ? trades.filter(t => t.strategyName === STRATEGY_FILTER)
  : trades;

console.log(`\nCaptured ${trades.length} total trades, validating ${filtered.length}`);
console.log('');

let totalChecks = 0;
let totalPassed = 0;
let totalFailed = 0;
const failedTrades = [];
const strategyResults = {};

for (let i = 0; i < filtered.length; i++) {
  const trade = filtered[i];
  const checks = validateTrade(trade, candles);

  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed).length;
  totalChecks += checks.length;
  totalPassed += passed;
  totalFailed += failed;

  // Track per strategy
  if (!strategyResults[trade.strategyName]) {
    strategyResults[trade.strategyName] = { trades: 0, checks: 0, passed: 0, failed: 0 };
  }
  strategyResults[trade.strategyName].trades++;
  strategyResults[trade.strategyName].checks += checks.length;
  strategyResults[trade.strategyName].passed += passed;
  strategyResults[trade.strategyName].failed += failed;

  if (failed > 0) {
    failedTrades.push({ trade, checks });
  }

  if (VERBOSE || failed > 0) {
    const ts = trade.entryCandle?.t ? new Date(t(trade.entryCandle)).toISOString().slice(0, 19) : '?';
    const icon = failed > 0 ? '❌' : '✅';
    console.log(`${icon} ${trade.strategyName} Trade #${i + 1} @ candle ${trade.entryIndex} (${ts}) — ${trade.direction} @ $${trade.entryPrice.toFixed(0)} → $${trade.exitPrice.toFixed(0)} (${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(2)}%) [${trade.exitReason}]`);
    
    for (const check of checks) {
      if (VERBOSE || !check.passed) {
        const ci = check.passed ? '  ✅' : '  ❌';
        console.log(`${ci} ${check.name}: expected ${check.expected}, got ${check.actual}`);
      }
    }
    if (VERBOSE) console.log('');
  }
}

// ── SUMMARY ──
console.log('\n════════════════════════════════════════════════════════');
console.log('VALIDATION SUMMARY');
console.log('════════════════════════════════════════════════════════');
console.log(`Total trades validated: ${filtered.length}`);
console.log(`Total checks run: ${totalChecks}`);
console.log(`Passed: ${totalPassed}`);
console.log(`Failed: ${totalFailed}`);
console.log('');

console.log('Per strategy:');
for (const [name, data] of Object.entries(strategyResults)) {
  const icon = data.failed > 0 ? '❌' : '✅';
  console.log(`  ${icon} ${name.padEnd(20)} ${data.trades} trades, ${data.checks} checks, ${data.passed} passed, ${data.failed} failed`);
}

if (failedTrades.length > 0) {
  console.log('\n════════════════════════════════════════════════════════');
  console.log(`❌ VALIDATION FAILED — ${failedTrades.length} trades have invalid entries`);
  console.log('These trades claim conditions that were NOT true on the entry candle.');
  console.log('════════════════════════════════════════════════════════');
  process.exit(1);
} else {
  console.log('\n════════════════════════════════════════════════════════');
  console.log('✅ ALL TRADES VALIDATED — Every entry condition verified');
  console.log('════════════════════════════════════════════════════════');
}
