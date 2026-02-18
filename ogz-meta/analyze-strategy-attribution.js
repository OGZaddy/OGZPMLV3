#!/usr/bin/env node
/**
 * Strategy Attribution Analyzer
 * =============================
 * Parses backtest reports and breaks down performance by entry strategy.
 * Shows which strategies are carrying profit and which are dragging it down.
 *
 * Usage:
 *   node ogz-meta/analyze-strategy-attribution.js [report-file]
 *
 * If no report file specified, uses the most recent backtest-report-*.json
 *
 * Output:
 *   - Strategy breakdown table (trades, wins, losses, win rate, P&L)
 *   - Exit reason breakdown
 *   - Recommendations for tuning
 *
 * FIX 2026-02-17: Created for strategy-owned exit system analysis
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// Get report file
let reportPath = process.argv[2];

if (!reportPath) {
  // Find most recent report
  const reports = fs.readdirSync(REPO_ROOT)
    .filter(f => f.startsWith('backtest-report-'))
    .sort()
    .reverse();

  if (reports.length === 0) {
    console.log('No backtest reports found. Run a backtest first.');
    process.exit(1);
  }
  reportPath = path.join(REPO_ROOT, reports[0]);
} else if (!path.isAbsolute(reportPath)) {
  reportPath = path.join(process.cwd(), reportPath);
}

// Load report
let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath));
} catch (e) {
  console.error('Failed to load report:', e.message);
  process.exit(1);
}

console.log('');
console.log('='.repeat(70));
console.log('  STRATEGY ATTRIBUTION ANALYSIS');
console.log('='.repeat(70));
console.log('');
console.log('Report:', path.basename(reportPath));
console.log('Date:', report.timestamp || 'unknown');
console.log('');

// Parse trades
const trades = report.trades || [];
const completedTrades = [];

// Pair BUY/SELL
for (let i = 0; i < trades.length - 1; i++) {
  if (trades[i].type === 'BUY' && trades[i+1].type === 'SELL') {
    completedTrades.push({
      buy: trades[i],
      sell: trades[i+1],
      entryStrategy: trades[i].entryStrategy || 'unknown',
      exitContract: trades[i].exitContract || null,
      pnl: trades[i+1].pnl || 0,
      pnlDollars: trades[i+1].pnlDollars || 0,
      exitReason: trades[i+1].exitReason || 'signal',
      holdDuration: trades[i+1].holdDuration || 0
    });
    i++;
  }
}

// Group by strategy
const byStrategy = {};
const byExitReason = {};

for (const trade of completedTrades) {
  // Strategy stats
  const strat = trade.entryStrategy;
  if (!byStrategy[strat]) {
    byStrategy[strat] = {
      trades: 0, wins: 0, losses: 0, breakeven: 0,
      totalPnl: 0, totalPnlDollars: 0,
      totalHoldTime: 0,
      biggestWin: 0, biggestLoss: 0
    };
  }
  byStrategy[strat].trades++;
  byStrategy[strat].totalPnl += trade.pnl;
  byStrategy[strat].totalPnlDollars += trade.pnlDollars;
  byStrategy[strat].totalHoldTime += trade.holdDuration;

  if (trade.pnl > 0.1) {
    byStrategy[strat].wins++;
    if (trade.pnlDollars > byStrategy[strat].biggestWin) {
      byStrategy[strat].biggestWin = trade.pnlDollars;
    }
  } else if (trade.pnl < -0.1) {
    byStrategy[strat].losses++;
    if (trade.pnlDollars < byStrategy[strat].biggestLoss) {
      byStrategy[strat].biggestLoss = trade.pnlDollars;
    }
  } else {
    byStrategy[strat].breakeven++;
  }

  // Exit reason stats
  const reason = trade.exitReason;
  if (!byExitReason[reason]) {
    byExitReason[reason] = { count: 0, totalPnl: 0 };
  }
  byExitReason[reason].count++;
  byExitReason[reason].totalPnl += trade.pnlDollars;
}

// Print strategy table
console.log('STRATEGY BREAKDOWN');
console.log('-'.repeat(70));
console.log('| Strategy             | Trades | Wins | Loss | Win%  | Total P&L  | Avg P&L |');
console.log('|' + '-'.repeat(68) + '|');

const stratEntries = Object.entries(byStrategy).sort((a, b) => b[1].totalPnlDollars - a[1].totalPnlDollars);

for (const [strat, data] of stratEntries) {
  const winRate = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(1) : '0.0';
  const avgPnl = data.trades > 0 ? (data.totalPnlDollars / data.trades).toFixed(2) : '0.00';
  const stratName = strat.substring(0, 20).padEnd(20);
  const tradesStr = String(data.trades).padStart(6);
  const winsStr = String(data.wins).padStart(4);
  const lossesStr = String(data.losses).padStart(4);
  const winRateStr = (winRate + '%').padStart(5);
  const totalPnlStr = ('$' + data.totalPnlDollars.toFixed(2)).padStart(10);
  const avgPnlStr = ('$' + avgPnl).padStart(7);

  // Color coding hint
  const indicator = data.totalPnlDollars >= 0 ? '+' : '-';

  console.log(`| ${stratName} | ${tradesStr} | ${winsStr} | ${lossesStr} | ${winRateStr} | ${totalPnlStr} | ${avgPnlStr} |`);
}

console.log('|' + '-'.repeat(68) + '|');

// Totals
const totalTrades = completedTrades.length;
const totalWins = completedTrades.filter(t => t.pnl > 0.1).length;
const totalLosses = completedTrades.filter(t => t.pnl < -0.1).length;
const totalPnl = completedTrades.reduce((sum, t) => sum + t.pnlDollars, 0);
const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
const winRate = totalTrades > 0 ? (totalWins / totalTrades * 100).toFixed(1) : '0.0';

console.log(`| ${'TOTAL'.padEnd(20)} | ${String(totalTrades).padStart(6)} | ${String(totalWins).padStart(4)} | ${String(totalLosses).padStart(4)} | ${(winRate + '%').padStart(5)} | ${('$' + totalPnl.toFixed(2)).padStart(10)} | ${('$' + avgPnl.toFixed(2)).padStart(7)} |`);
console.log('-'.repeat(70));

// Exit reason breakdown
console.log('');
console.log('EXIT REASON BREAKDOWN');
console.log('-'.repeat(50));

for (const [reason, data] of Object.entries(byExitReason).sort((a, b) => b[1].count - a[1].count)) {
  const avgPnl = data.count > 0 ? data.totalPnl / data.count : 0;
  console.log(`  ${reason.padEnd(20)} : ${String(data.count).padStart(4)} trades, $${data.totalPnl.toFixed(2).padStart(10)} total, $${avgPnl.toFixed(2).padStart(7)} avg`);
}

// Strategy attribution status
console.log('');
console.log('ATTRIBUTION STATUS');
console.log('-'.repeat(50));
const hasStrategy = completedTrades.filter(t => t.entryStrategy !== 'unknown').length;
console.log(`  Trades with entryStrategy: ${hasStrategy}/${completedTrades.length}`);

if (hasStrategy === 0) {
  console.log('');
  console.log('  WARNING: No strategy attribution data!');
  console.log('  Run a new backtest with the updated code to get attribution.');
}

// Recommendations
console.log('');
console.log('RECOMMENDATIONS');
console.log('-'.repeat(50));

for (const [strat, data] of stratEntries) {
  if (data.trades < 3) {
    console.log(`  ${strat}: Not enough data (${data.trades} trades) - need more samples`);
  } else if (data.totalPnlDollars < 0 && data.trades >= 5) {
    const winRate = (data.wins / data.trades * 100);
    if (winRate < 40) {
      console.log(`  ${strat}: UNDERPERFORMING - ${winRate.toFixed(0)}% win rate, $${data.totalPnlDollars.toFixed(2)} loss - consider disabling or tuning`);
    } else {
      console.log(`  ${strat}: Decent win rate but losing money - check risk/reward ratio`);
    }
  } else if (data.totalPnlDollars > 0 && data.trades >= 5) {
    console.log(`  ${strat}: PROFITABLE - $${data.totalPnlDollars.toFixed(2)} with ${(data.wins / data.trades * 100).toFixed(0)}% win rate - consider increasing size`);
  }
}

console.log('');
console.log('='.repeat(70));
