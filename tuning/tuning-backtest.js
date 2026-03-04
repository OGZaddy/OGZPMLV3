#!/usr/bin/env node
/**
 * tuning-backtest.js - Clean Exit Tuning Backtest
 * ================================================
 * Minimal backtest for evaluating exit configurations.
 * No brain direction gate. No orchestrator. No complex gates.
 * Just: signals → confidence → entry → exit management → report
 *
 * Usage:
 *   STOP_LOSS_PERCENT=1.5 TAKE_PROFIT_PERCENT=2.0 \
 *   CANDLE_FILE=tuning/seg_1_range.json \
 *   node tuning/tuning-backtest.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const projectRoot = path.resolve(__dirname, '..');

// Load core modules
const IndicatorEngine = require(path.join(projectRoot, 'core/indicators/IndicatorEngine'));
const { getInstance: getExitContractManager } = require(path.join(projectRoot, 'core/ExitContractManager'));
const TradingConfig = require(path.join(projectRoot, 'core/TradingConfig'));
const { StrategyOrchestrator } = require(path.join(projectRoot, 'core/StrategyOrchestrator'));

// Config from env vars
const CANDLE_FILE = process.env.CANDLE_FILE || 'tuning/seg_1_range.json';
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE) || 25;  // 25% default for tuning
const INITIAL_BALANCE = parseFloat(process.env.INITIAL_BALANCE) || 10000;
const POSITION_SIZE_PCT = parseFloat(process.env.POSITION_SIZE_PCT) || 4;  // 4% of balance per trade
const FEES_PCT = parseFloat(process.env.FEES_PCT) || 0;  // Round-trip fees + slippage as %
const USE_ORCHESTRATOR = process.env.USE_ORCHESTRATOR === 'true';  // Use full strategy stack

// Exit config from TradingConfig (reads env vars)
const STOP_LOSS_PCT = TradingConfig.get('exits.stopLossPercent');
const TAKE_PROFIT_PCT = TradingConfig.get('exits.takeProfitPercent');
const TIER1 = TradingConfig.get('exits.profitTiers.tier1');
const TIER2 = TradingConfig.get('exits.profitTiers.tier2');
const TIER3 = TradingConfig.get('exits.profitTiers.tier3');

console.log('='.repeat(60));
console.log('TUNING BACKTEST - Exit Configuration Evaluation');
console.log('='.repeat(60));
console.log(`Candle file:    ${CANDLE_FILE}`);
console.log(`Min confidence: ${MIN_CONFIDENCE}%`);
console.log(`Stop loss:      ${STOP_LOSS_PCT}%`);
console.log(`Take profit:    ${TAKE_PROFIT_PCT}%`);
console.log(`Profit tiers:   ${(TIER1*100).toFixed(1)}% / ${(TIER2*100).toFixed(1)}% / ${(TIER3*100).toFixed(1)}%`);
console.log(`Fees/slippage:  ${FEES_PCT}% per trade`);
console.log('='.repeat(60));

// Load candles
const candlePath = path.resolve(__dirname, '..', CANDLE_FILE);
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
  console.log(`Loaded ${candles.length} candles from ${CANDLE_FILE}`);
} catch (err) {
  console.error(`Failed to load candles: ${err.message}`);
  process.exit(1);
}

// Initialize indicator engine
const indicatorEngine = new IndicatorEngine({ warmupCandles: 50 });
const exitContractManager = getExitContractManager();

// Initialize strategy orchestrator if enabled
let strategyOrchestrator = null;
if (USE_ORCHESTRATOR) {
  strategyOrchestrator = new StrategyOrchestrator({
    minStrategyConfidence: MIN_CONFIDENCE / 100,  // Convert to 0-1 range
    minConfluenceCount: 1  // Single strategy can fire
  });
  console.log(`Strategy mode:  ORCHESTRATOR (${strategyOrchestrator.strategies.length} strategies)`);
} else {
  console.log(`Strategy mode:  Simple RSI`);
}

// State
let balance = INITIAL_BALANCE;
let position = null;  // { entryPrice, entryTime, amount, exitContract }
const trades = [];
const metrics = {
  totalTrades: 0,
  wins: 0,
  losses: 0,
  totalPnL: 0,
  maxDrawdown: 0,
  mfeSum: 0,  // Max favorable excursion sum
  maeSum: 0,  // Max adverse excursion sum
  givebackCount: 0,  // Trades that went positive then closed negative
};
let peakBalance = INITIAL_BALANCE;

/**
 * Regime detector - returns 'trending' or 'range'
 * Only trade in trending conditions
 */
function detectRegime(indicators) {
  const adx = indicators.adx?.adx || 0;
  const superTrend = indicators.superTrend?.trend || 'neutral';
  const ema20 = indicators.ema?.[20] || 0;
  const ema50 = indicators.ema?.[50] || 0;
  const price = indicators.lastCandle?.c || 0;

  // ADX > 25 = trending market
  // Also check EMA alignment for confirmation
  const adxTrending = adx > 25;
  const emasAligned = Math.abs(ema20 - ema50) / ema50 > 0.002; // 0.2% spread
  const priceAboveEmas = price > ema20 && price > ema50;
  const priceBelowEmas = price < ema20 && price < ema50;
  const clearTrend = priceAboveEmas || priceBelowEmas;

  if (adxTrending && clearTrend) {
    return 'trending';
  }
  return 'range';
}

/**
 * Simple RSI-based signal generator
 * Returns { direction: 'buy'|'sell'|'hold', confidence: 0-100 }
 */
function generateSignal(indicators, price) {
  const rsi = indicators.rsi || 50;
  const macd = indicators.macd || { histogram: 0 };

  let direction = 'hold';
  let confidence = 0;

  // RSI oversold = buy signal
  if (rsi < 30) {
    direction = 'buy';
    confidence = Math.min(80, (30 - rsi) * 3 + 40);  // 40-80% based on how oversold
  }
  // RSI overbought = sell signal (exit or short)
  else if (rsi > 70) {
    direction = 'sell';
    confidence = Math.min(80, (rsi - 70) * 3 + 40);
  }
  // MACD histogram positive + RSI neutral = mild buy
  else if (macd.histogram > 0 && rsi < 60) {
    direction = 'buy';
    confidence = 30 + Math.min(20, macd.histogram * 10);
  }
  // MACD histogram negative + RSI neutral = mild sell
  else if (macd.histogram < 0 && rsi > 40) {
    direction = 'sell';
    confidence = 30 + Math.min(20, Math.abs(macd.histogram) * 10);
  }

  return { direction, confidence };
}

/**
 * Check exit conditions for open position
 * Returns { shouldExit: boolean, reason: string, pnlPercent: number }
 */
function checkExit(position, currentPrice, currentTime) {
  const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  const holdMinutes = (currentTime - position.entryTime) / 60000;
  const contract = position.exitContract;

  // Track MFE/MAE
  if (pnlPercent > (position.mfe || 0)) position.mfe = pnlPercent;
  if (pnlPercent < (position.mae || 0)) position.mae = pnlPercent;

  // Stop loss (negative)
  if (pnlPercent <= contract.stopLossPercent) {
    return { shouldExit: true, reason: 'stop_loss', pnlPercent };
  }

  // Take profit (full exit)
  if (pnlPercent >= contract.takeProfitPercent) {
    return { shouldExit: true, reason: 'take_profit', pnlPercent };
  }

  // Tiered profit taking
  if (pnlPercent >= TIER3 * 100 && !position.tier3Hit) {
    position.tier3Hit = true;
    return { shouldExit: true, reason: 'profit_tier_3', pnlPercent };
  }
  if (pnlPercent >= TIER2 * 100 && !position.tier2Hit) {
    position.tier2Hit = true;
    // Partial exit could go here, for now just track
  }
  if (pnlPercent >= TIER1 * 100 && !position.tier1Hit) {
    position.tier1Hit = true;
    return { shouldExit: true, reason: 'profit_tier_1', pnlPercent };
  }

  // Trailing stop (if activated)
  if (contract.trailingStopPercent && contract.trailingActivation) {
    if (position.mfe >= contract.trailingActivation) {
      const trailStop = position.mfe - contract.trailingStopPercent;
      if (pnlPercent <= trailStop) {
        return { shouldExit: true, reason: 'trailing_stop', pnlPercent };
      }
    }
  }

  // Max hold time
  if (holdMinutes >= (contract.maxHoldTimeMinutes || 240)) {
    return { shouldExit: true, reason: 'max_hold', pnlPercent };
  }

  return { shouldExit: false, reason: null, pnlPercent };
}

/**
 * Execute entry
 */
function executeEntry(price, confidence, time, strategyName = 'RSI') {
  const positionValue = balance * (POSITION_SIZE_PCT / 100);
  const amount = positionValue / price;

  // Get exit contract from ExitContractManager (uses strategy-specific defaults)
  const baseContract = exitContractManager.getDefaultContract(strategyName || 'RSI');
  const exitContract = {
    ...baseContract,
    stopLossPercent: -Math.abs(STOP_LOSS_PCT),
    takeProfitPercent: Math.abs(TAKE_PROFIT_PCT),
  };

  position = {
    entryPrice: price,
    entryTime: time,
    amount,
    confidence,
    exitContract,
    strategyName: strategyName || 'RSI',
    mfe: 0,
    mae: 0,
  };

  balance -= positionValue;

  trades.push({
    type: 'BUY',
    price,
    amount,
    confidence,
    strategyName: strategyName || 'RSI',
    time,
    balance,
    exitContract: { ...exitContract },
  });
}

/**
 * Execute exit
 */
function executeExit(price, reason, pnlPercent, time) {
  const exitValue = position.amount * price;
  const grossPnlDollars = exitValue - (position.amount * position.entryPrice);

  // Apply fees (round-trip: entry + exit)
  const positionValue = position.amount * position.entryPrice;
  const feeDollars = positionValue * (FEES_PCT / 100);
  const pnlDollars = grossPnlDollars - feeDollars;
  const netPnlPercent = pnlPercent - FEES_PCT;

  balance += exitValue - feeDollars;

  // Track metrics (net of fees)
  metrics.totalTrades++;
  metrics.totalPnL += netPnlPercent;
  metrics.mfeSum += position.mfe || 0;
  metrics.maeSum += position.mae || 0;

  if (netPnlPercent > 0) {
    metrics.wins++;
  } else {
    metrics.losses++;
  }

  // Giveback: went positive then closed negative (net of fees)
  if ((position.mfe || 0) > 0.5 && netPnlPercent < 0) {
    metrics.givebackCount++;
  }

  // Drawdown tracking
  if (balance > peakBalance) peakBalance = balance;
  const drawdown = ((peakBalance - balance) / peakBalance) * 100;
  if (drawdown > metrics.maxDrawdown) metrics.maxDrawdown = drawdown;

  trades.push({
    type: 'SELL',
    price,
    entryPrice: position.entryPrice,
    pnlPercent: netPnlPercent,
    grossPnlPercent: pnlPercent,
    pnlDollars,
    feeDollars,
    reason,
    time,
    balance,
    holdDuration: time - position.entryTime,
    mfe: position.mfe,
    mae: position.mae,
  });

  position = null;
}

// Main backtest loop
console.log('\nRunning backtest...');
const startTime = Date.now();

for (let i = 0; i < candles.length; i++) {
  const candle = candles[i];
  const price = candle.c;
  const time = candle.t;

  // Feed to indicator engine
  indicatorEngine.updateCandle({
    o: candle.o,
    h: candle.h,
    l: candle.l,
    c: candle.c,
    v: candle.v || 0,
    t: time,
  });

  // Skip warmup period
  if (i < 50) continue;

  // Get indicators
  const indicators = indicatorEngine.getSnapshot();

  // Check exit first if in position
  if (position) {
    const exitCheck = checkExit(position, price, time);
    if (exitCheck.shouldExit) {
      executeExit(price, exitCheck.reason, exitCheck.pnlPercent, time);
    }
  }

  // Check entry if flat
  if (!position) {
    let signal;
    let winnerStrategy = null;

    if (USE_ORCHESTRATOR && strategyOrchestrator) {
      // Use full strategy stack - orchestrator handles its own filtering
      const orchResult = strategyOrchestrator.evaluate(indicators, [], null, [], { price });
      signal = {
        direction: orchResult.direction,
        confidence: (orchResult.confidence || 0) * 100  // Convert to 0-100
      };
      winnerStrategy = orchResult.winnerStrategy;
    } else {
      // Simple RSI-based signals with regime filter
      signal = generateSignal(indicators, price);
      const regime = detectRegime(indicators);
      if (regime !== 'trending') {
        if (signal.direction === 'buy' && signal.confidence >= MIN_CONFIDENCE) {
          metrics.regimeSkips = (metrics.regimeSkips || 0) + 1;
        }
        signal = { direction: 'hold', confidence: 0 };
      }
    }

    // Single gate: confidence > threshold AND direction is buy
    if (signal.direction === 'buy' && signal.confidence >= MIN_CONFIDENCE) {
      executeEntry(price, signal.confidence, time, winnerStrategy);
    }
  }
}

// Close any open position at end
if (position) {
  const lastCandle = candles[candles.length - 1];
  const pnlPercent = ((lastCandle.c - position.entryPrice) / position.entryPrice) * 100;
  executeExit(lastCandle.c, 'end_of_data', pnlPercent, lastCandle.t);
}

const duration = ((Date.now() - startTime) / 1000).toFixed(1);

// Calculate final metrics
const totalReturn = ((balance - INITIAL_BALANCE) / INITIAL_BALANCE) * 100;
const winRate = metrics.totalTrades > 0 ? (metrics.wins / metrics.totalTrades) * 100 : 0;
const avgPnL = metrics.totalTrades > 0 ? metrics.totalPnL / metrics.totalTrades : 0;
const avgMFE = metrics.totalTrades > 0 ? metrics.mfeSum / metrics.totalTrades : 0;
const avgMAE = metrics.totalTrades > 0 ? metrics.maeSum / metrics.totalTrades : 0;
const givebackRate = metrics.totalTrades > 0 ? (metrics.givebackCount / metrics.totalTrades) * 100 : 0;

// Output results
console.log('\n' + '='.repeat(60));
console.log('RESULTS');
console.log('='.repeat(60));
console.log(`Duration:        ${duration}s`);
console.log(`Candles:         ${candles.length}`);
console.log(`Initial balance: $${INITIAL_BALANCE.toLocaleString()}`);
console.log(`Final balance:   $${balance.toFixed(2)}`);
console.log(`Total return:    ${totalReturn.toFixed(2)}%`);
console.log(`Total trades:    ${metrics.totalTrades}`);
console.log(`Regime skips:    ${metrics.regimeSkips || 0}`);
console.log(`Win rate:        ${winRate.toFixed(1)}%`);
console.log(`Avg P&L/trade:   ${avgPnL.toFixed(2)}%`);
console.log(`Max drawdown:    ${metrics.maxDrawdown.toFixed(2)}%`);
console.log(`Avg MFE:         ${avgMFE.toFixed(2)}%`);
console.log(`Avg MAE:         ${avgMAE.toFixed(2)}%`);
console.log(`Giveback rate:   ${givebackRate.toFixed(1)}%`);
console.log('='.repeat(60));

// Save report
const report = {
  config: {
    candleFile: CANDLE_FILE,
    minConfidence: MIN_CONFIDENCE,
    stopLossPct: STOP_LOSS_PCT,
    takeProfitPct: TAKE_PROFIT_PCT,
    tier1: TIER1,
    tier2: TIER2,
    tier3: TIER3,
    initialBalance: INITIAL_BALANCE,
    positionSizePct: POSITION_SIZE_PCT,
  },
  summary: {
    initialBalance: INITIAL_BALANCE,
    finalBalance: balance,
    totalReturn,
    candlesProcessed: candles.length,
    duration,
  },
  metrics: {
    totalTrades: metrics.totalTrades,
    wins: metrics.wins,
    losses: metrics.losses,
    winRate,
    avgPnL,
    maxDrawdown: metrics.maxDrawdown,
    avgMFE,
    avgMAE,
    givebackRate,
    givebackCount: metrics.givebackCount,
  },
  trades,
  timestamp: new Date().toISOString(),
};

const reportPath = path.resolve(__dirname, `tuning-report-${Date.now()}.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport saved: ${reportPath}`);
