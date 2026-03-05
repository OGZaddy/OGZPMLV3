/**
 * Per-Strategy Backtest - Full Year Analysis
 * Uses ALL 45,812 candles from Jan 2024 to Apr 2025
 * Groups results by winnerStrategy to identify profitable vs dragging strategies
 *
 * Key metrics:
 * - Per strategy: trades, wins, losses, win%, avg P&L
 * - Exit reasons: TP/SL/trailing vs max_hold timeouts
 * - High timeout rate = weak entries that go sideways
 */
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const DATA_FILE = path.join(__dirname, 'data', 'btc-15m-2024-2025.json');
const TEMP_FILE = path.join(__dirname, 'data', 'backtest-full.json');

// Load full dataset - ALL candles
const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const candles = raw.candles || raw;
const firstDate = new Date(candles[0].timestamp).toISOString().split('T')[0];
const lastDate = new Date(candles[candles.length - 1].timestamp).toISOString().split('T')[0];
const firstPrice = candles[0].close.toFixed(0);
const lastPrice = candles[candles.length - 1].close.toFixed(0);

console.log('='.repeat(70));
console.log('  FULL YEAR BACKTEST - Per-Strategy Breakdown');
console.log('='.repeat(70));
console.log(`  Candles: ${candles.length} (${firstDate} to ${lastDate})`);
console.log(`  Price range: $${firstPrice} → $${lastPrice}`);
console.log(`  Confidence threshold: 55%`);
console.log('='.repeat(70) + '\n');

fs.writeFileSync(TEMP_FILE, JSON.stringify(candles)); // ALL candles, no slice

const child = fork(path.join(__dirname, 'run-empire-v2.js'), [], {
  env: {
    ...process.env,
    BACKTEST_MODE: 'true',
    BACKTEST_VERBOSE: 'true',
    BACKTEST_SILENT: 'false',
    BACKTEST_FAST: 'true',
    PAPER_TRADING: 'true',
    ENABLE_TRAI: 'false',
    MIN_TRADE_CONFIDENCE: '0.55',  // 55% threshold
    EXIT_SYSTEM: 'legacy',  // FIX 2026-02-23: Was 'contract' which skips MaxProfitManager tiered exits
    KRAKEN_API_KEY: 'backtest',
    KRAKEN_API_SECRET: 'backtest',
    CANDLE_DATA_FILE: TEMP_FILE,
  },
  silent: true
});

// Per-strategy tracking
const strategyStats = {};
const allTrades = [];
let currentTrade = null;
let output = '';

function getOrCreateStrategy(name) {
  const key = name || 'unknown';
  if (!strategyStats[key]) {
    strategyStats[key] = {
      trades: 0, wins: 0, losses: 0, totalPnl: 0, pnls: [],
      exitReasons: { take_profit: 0, stop_loss: 0, trailing_stop: 0, max_hold: 0, hard_stop: 0, invalidation: 0, other: 0 }
    };
  }
  return strategyStats[key];
}

// Track pending exit reason from EXIT-CONTRACT line
let pendingExitReason = null;
let signalCount = 0;

child.stdout.on('data', (d) => {
  const text = d.toString();
  output += text;
  const lines = text.split('\n');

  for (const line of lines) {
    // Track all orchestrator signals for visibility
    if (line.includes('[ORCHESTRATOR]') && !line.includes('ENTRY')) {
      signalCount++;
      const match = line.match(/\[ORCHESTRATOR\]\s+(BUY|SELL)\s+\|\s+(\w+)\s+@\s+(\d+)%/);
      if (match && signalCount <= 20) {
        console.log(`  🎯 Signal: ${match[1]} ${match[2]} @ ${match[3]}%`);
      }
    }

    // Capture actual trade entry: [ORCHESTRATOR-ENTRY] Winner: CandlePattern | Sizing: 1x
    if (line.includes('[ORCHESTRATOR-ENTRY]')) {
      const stratMatch = line.match(/Winner:\s*(\w+)/);
      const slMatch = line.match(/SL=([+-]?[\d.]+)%/);
      const tpMatch = line.match(/TP=([+-]?[\d.]+)%/);

      currentTrade = {
        strategy: stratMatch ? stratMatch[1] : 'unknown',
        sl: slMatch ? parseFloat(slMatch[1]) : 0,
        tp: tpMatch ? parseFloat(tpMatch[1]) : 0,
      };
      console.log(`  📈 ENTRY [${currentTrade.strategy}] SL=${currentTrade.sl.toFixed(2)}% TP=${currentTrade.tp.toFixed(2)}%`);
    }

    // Capture exit reason from EXIT-CONTRACT line
    // Format: [EXIT-CONTRACT] CandlePattern TP: 1.11% >= 0.84%
    // Format: [EXIT-CONTRACT] MADynamicSR SL: -0.52% <= -0.45%
    // Format: [EXIT-CONTRACT] EMASMACrossover max hold: 120 min >= 120 min
    if (line.includes('[EXIT-CONTRACT]')) {
      const stratMatch = line.match(/\[EXIT-CONTRACT\]\s*(\w+)/);
      if (line.includes(' TP:') || line.includes('take_profit')) {
        pendingExitReason = 'take_profit';
      } else if (line.includes(' SL:') || line.includes('stop_loss')) {
        pendingExitReason = 'stop_loss';
      } else if (line.includes('max hold') || line.includes('max_hold')) {
        pendingExitReason = 'max_hold';
      } else if (line.includes('trailing') || line.includes('Trail')) {
        pendingExitReason = 'trailing_stop';
      } else if (line.includes('hard') || line.includes('Hard')) {
        pendingExitReason = 'hard_stop';
      } else if (line.includes('invalid')) {
        pendingExitReason = 'invalidation';
      }
      // Also capture strategy from exit contract if we lost track
      if (stratMatch && (!currentTrade || currentTrade.strategy === 'unknown')) {
        currentTrade = currentTrade || {};
        currentTrade.strategy = stratMatch[1];
      }
    }

    // Capture position close with P&L
    // Format: 📊 Position closed: PnL +$2.78 (1.11%)
    if (line.includes('Position closed:') && line.includes('PnL')) {
      const pnlMatch = line.match(/\(([+-]?[\d.]+)%\)/);
      const pnl = pnlMatch ? parseFloat(pnlMatch[1]) : 0;
      const exitReason = pendingExitReason || 'other';
      const strategy = currentTrade?.strategy || 'unknown';

      const stats = getOrCreateStrategy(strategy);
      stats.trades++;
      stats.totalPnl += pnl;
      stats.pnls.push(pnl);
      if (pnl > 0) stats.wins++;
      else if (pnl < 0) stats.losses++;

      if (stats.exitReasons[exitReason] !== undefined) {
        stats.exitReasons[exitReason]++;
      } else {
        stats.exitReasons.other++;
      }

      allTrades.push({ strategy, pnl, exitReason });
      const pnlStr = pnl >= 0 ? `+${pnl.toFixed(2)}` : pnl.toFixed(2);
      console.log(`  📉 EXIT [${strategy}] ${pnlStr}% via ${exitReason}`);

      // Reset for next trade
      currentTrade = null;
      pendingExitReason = null;
    }

    // Log candle progress
    if (line.includes('Candle #')) {
      const match = line.match(/Candle #(\d+)/);
      if (match && parseInt(match[1]) % 10000 === 0) {
        console.log(`  ⏳ Processed ${match[1]} candles...`);
      }
    }

    // Pass through summary lines
    if (line.includes('BACKTEST COMPLETE') || line.includes('Final Balance') ||
        line.includes('Total P&L') || line.includes('Win Rate') ||
        line.includes('Total Trades')) {
      console.log('  ' + line.trim());
    }
  }
});

child.stderr.on('data', (d) => {
  const line = d.toString().trim();
  if (line.includes('FATAL') || line.includes('Error') || line.includes('Cannot find module')) {
    console.log('  ❌ ' + line.substring(0, 200));
  }
});

child.on('exit', (code) => {
  // Cleanup temp file
  try { fs.unlinkSync(TEMP_FILE); } catch(e) {}

  console.log('\n' + '='.repeat(70));
  console.log('  PER-STRATEGY BREAKDOWN (sorted by total P&L)');
  console.log('='.repeat(70));

  // Sort strategies by total P&L (best performers first)
  const sortedStrategies = Object.entries(strategyStats)
    .filter(([name, s]) => s.trades > 0)
    .sort((a, b) => b[1].totalPnl - a[1].totalPnl);

  if (sortedStrategies.length === 0) {
    console.log('\n  ⚠️  No trades captured. Check if strategies are firing.');
    console.log('  Full output saved to backtest-output.txt for debugging.\n');
    fs.writeFileSync('backtest-output.txt', output);
    return;
  }

  for (const [name, s] of sortedStrategies) {
    const winRate = s.trades > 0 ? (s.wins / s.trades * 100).toFixed(1) : '0.0';
    const avgPnl = s.trades > 0 ? (s.totalPnl / s.trades).toFixed(3) : '0.000';
    const tpSlHits = s.exitReasons.take_profit + s.exitReasons.stop_loss + s.exitReasons.trailing_stop;
    const timeoutRate = s.trades > 0 ? (s.exitReasons.max_hold / s.trades * 100).toFixed(1) : '0.0';
    const tpRate = s.trades > 0 ? (s.exitReasons.take_profit / s.trades * 100).toFixed(1) : '0.0';

    // Determine strategy health emoji
    let health = '⚪';
    if (s.totalPnl > 0 && parseFloat(winRate) >= 50) health = '🟢';
    else if (s.totalPnl > 0) health = '🟡';
    else if (parseFloat(timeoutRate) > 50) health = '🔴';
    else health = '🟠';

    console.log(`\n  ${health} ${name}:`);
    console.log(`     Trades: ${s.trades} | Wins: ${s.wins} | Losses: ${s.losses} | Win Rate: ${winRate}%`);
    console.log(`     Total P&L: ${s.totalPnl >= 0 ? '+' : ''}${s.totalPnl.toFixed(2)}% | Avg P&L/trade: ${avgPnl}%`);
    console.log(`     Exit Breakdown:`);
    console.log(`       ✅ Take Profit: ${s.exitReasons.take_profit} (${tpRate}%)`);
    console.log(`       🛑 Stop Loss: ${s.exitReasons.stop_loss}`);
    console.log(`       📈 Trailing Stop: ${s.exitReasons.trailing_stop}`);
    console.log(`       ⏰ Max Hold Timeout: ${s.exitReasons.max_hold} (${timeoutRate}%) ${parseFloat(timeoutRate) > 30 ? '⚠️ HIGH' : ''}`);
    if (s.exitReasons.hard_stop > 0) console.log(`       💥 Hard Stop: ${s.exitReasons.hard_stop}`);
    if (s.exitReasons.invalidation > 0) console.log(`       ❌ Invalidation: ${s.exitReasons.invalidation}`);
  }

  // Overall summary
  const totalTrades = Object.values(strategyStats).reduce((sum, s) => sum + s.trades, 0);
  const totalWins = Object.values(strategyStats).reduce((sum, s) => sum + s.wins, 0);
  const totalTimeouts = Object.values(strategyStats).reduce((sum, s) => sum + s.exitReasons.max_hold, 0);
  const totalTP = Object.values(strategyStats).reduce((sum, s) => sum + s.exitReasons.take_profit, 0);
  const totalPnl = Object.values(strategyStats).reduce((sum, s) => sum + s.totalPnl, 0);
  const overallWinRate = totalTrades > 0 ? (totalWins / totalTrades * 100).toFixed(1) : '0.0';

  console.log('\n' + '='.repeat(70));
  console.log('  OVERALL SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Total Trades: ${totalTrades}`);
  console.log(`  Overall Win Rate: ${overallWinRate}%`);
  console.log(`  Total P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%`);
  console.log(`  Avg P&L/trade: ${totalTrades > 0 ? (totalPnl / totalTrades).toFixed(3) : 0}%`);
  console.log('');
  console.log(`  Exit Distribution:`);
  console.log(`    Take Profit: ${totalTP} (${totalTrades > 0 ? (totalTP/totalTrades*100).toFixed(1) : 0}%)`);
  console.log(`    Max Hold Timeouts: ${totalTimeouts} (${totalTrades > 0 ? (totalTimeouts/totalTrades*100).toFixed(1) : 0}%)`);

  if (totalTrades > 0 && totalTimeouts / totalTrades > 0.3) {
    console.log('\n  ⚠️  WARNING: >30% of trades timing out at max hold');
    console.log('     This indicates entries lack follow-through. Consider:');
    console.log('     - Raising confidence threshold further');
    console.log('     - Tighter entry conditions on weak strategies');
    console.log('     - Disabling strategies with >50% timeout rate');
  }

  console.log('\n' + '='.repeat(70));

  // Save full output for debugging
  fs.writeFileSync('backtest-output.txt', output);
  console.log('  Full output saved to backtest-output.txt');
  console.log('='.repeat(70) + '\n');
});
