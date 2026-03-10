/**
 * @fileoverview BacktestRecorder - In-Memory Trade Recording for Backtests
 *
 * Tracks all trades during backtest with running balance, exports CSV,
 * and provides comprehensive summary statistics.
 *
 * @description
 * Unlike TradeLogger which writes to disk (disabled in backtest mode),
 * this records everything in memory and exports at the end.
 *
 * Starting balance: $25,000 (Apex eval size)
 * Fees: 0.52% round trip (0.26% each way - Kraken taker)
 */

const fs = require('fs');
const path = require('path');
const TradingConfig = require('./TradingConfig');

class BacktestRecorder {
    constructor(config = {}) {
        this.startingBalance = config.startingBalance || 25000;
        this.feePerSide = config.feePerSide || TradingConfig.get('fees.makerFee');  // From TradingConfig
        this.roundTripFee = this.feePerSide * 2;        // 0.52%

        this.balance = this.startingBalance;
        this.trades = [];
        this.peakBalance = this.startingBalance;
        this.maxDrawdown = 0;
        this.maxDrawdownDollars = 0;
    }

    /**
     * Record a trade with all details
     * @param {Object} trade - Trade data from exit handler
     */
    recordTrade(trade) {
        const entryValue = trade.entryPrice * (trade.size || 1);
        const exitValue = trade.exitPrice * (trade.size || 1);

        // Calculate fees (both entry and exit)
        const entryFee = entryValue * this.feePerSide;
        const exitFee = exitValue * this.feePerSide;
        const totalFees = entryFee + exitFee;

        // Calculate raw P&L
        let rawPnlDollars;
        if (trade.direction === 'long' || trade.direction === 'buy') {
            rawPnlDollars = exitValue - entryValue;
        } else {
            rawPnlDollars = entryValue - exitValue;
        }

        // Net P&L after fees
        const netPnlDollars = rawPnlDollars - totalFees;
        const netPnlPercent = (netPnlDollars / entryValue) * 100;

        // Update balance
        const balanceBefore = this.balance;
        this.balance += netPnlDollars;

        // Track peak and drawdown
        if (this.balance > this.peakBalance) {
            this.peakBalance = this.balance;
        }
        const currentDrawdown = ((this.peakBalance - this.balance) / this.peakBalance) * 100;
        const currentDrawdownDollars = this.peakBalance - this.balance;
        if (currentDrawdown > this.maxDrawdown) {
            this.maxDrawdown = currentDrawdown;
            this.maxDrawdownDollars = currentDrawdownDollars;
        }

        // Build trade record
        const record = {
            tradeNumber: this.trades.length + 1,
            entryTime: trade.entryTime || trade.entryCandle?.time || '',
            exitTime: trade.exitTime || trade.exitCandle?.time || '',
            direction: trade.direction || 'unknown',
            entryPrice: trade.entryPrice || 0,
            exitPrice: trade.exitPrice || 0,
            stopLoss: trade.stopLoss || trade.exitContract?.stopLoss || 0,
            takeProfit: trade.takeProfit || trade.exitContract?.takeProfit || 0,
            size: trade.size || 1,

            // P&L
            rawPnlDollars,
            feesDollars: totalFees,
            netPnlDollars,
            netPnlPercent,

            // Strategy info
            strategyName: trade.strategyName || trade.winner || 'unknown',
            confidence: trade.confidence || 0,
            exitReason: trade.exitReason || 'unknown',

            // Balance tracking
            balanceBefore,
            balanceAfter: this.balance,

            // Extra context
            reason: trade.reason || '',
            holdTimeMinutes: trade.holdTimeMinutes || 0,

            // Raw candle data for deep dive
            entryCandle: trade.entryCandle || null,
            exitCandle: trade.exitCandle || null,
            signalDetails: trade.signalDetails || null
        };

        this.trades.push(record);

        // Log running balance
        const arrow = netPnlDollars >= 0 ? '↑' : '↓';
        console.log(`💰 Trade #${record.tradeNumber}: ${record.strategyName} ${record.direction.toUpperCase()} | ${netPnlDollars >= 0 ? '+' : ''}$${netPnlDollars.toFixed(2)} (${netPnlPercent >= 0 ? '+' : ''}${netPnlPercent.toFixed(2)}%) | Balance: $${this.balance.toFixed(2)} ${arrow}`);

        return record;
    }

    /**
     * Export all trades to CSV
     * @param {string} filepath - Output file path
     */
    exportCSV(filepath = './backtest-trades.csv') {
        const headers = [
            'trade_number',
            'entry_time',
            'exit_time',
            'direction',
            'entry_price',
            'exit_price',
            'stop_loss',
            'take_profit',
            'raw_pnl_dollars',
            'fees_dollars',
            'net_pnl_dollars',
            'net_pnl_percent',
            'strategy_name',
            'confidence',
            'exit_reason',
            'balance_after',
            'hold_time_minutes'
        ];

        const rows = this.trades.map(t => [
            t.tradeNumber,
            t.entryTime,
            t.exitTime,
            t.direction,
            t.entryPrice.toFixed(2),
            t.exitPrice.toFixed(2),
            t.stopLoss,
            t.takeProfit,
            t.rawPnlDollars.toFixed(2),
            t.feesDollars.toFixed(2),
            t.netPnlDollars.toFixed(2),
            t.netPnlPercent.toFixed(2),
            t.strategyName,
            t.confidence.toFixed(1),
            t.exitReason,
            t.balanceAfter.toFixed(2),
            t.holdTimeMinutes.toFixed(1)
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

        fs.writeFileSync(filepath, csv);
        console.log(`\n📊 Exported ${this.trades.length} trades to ${filepath}`);

        return filepath;
    }

    /**
     * Get comprehensive summary statistics
     */
    getSummary() {
        if (this.trades.length === 0) {
            return { totalTrades: 0, message: 'No trades recorded' };
        }

        const winners = this.trades.filter(t => t.netPnlDollars > 0);
        const losers = this.trades.filter(t => t.netPnlDollars < 0);
        const breakeven = this.trades.filter(t => t.netPnlDollars === 0);

        const totalPnl = this.trades.reduce((sum, t) => sum + t.netPnlDollars, 0);
        const totalFees = this.trades.reduce((sum, t) => sum + t.feesDollars, 0);

        const avgWinner = winners.length > 0
            ? winners.reduce((sum, t) => sum + t.netPnlDollars, 0) / winners.length
            : 0;
        const avgLoser = losers.length > 0
            ? losers.reduce((sum, t) => sum + t.netPnlDollars, 0) / losers.length
            : 0;

        const bestTrade = this.trades.reduce((best, t) =>
            t.netPnlDollars > best.netPnlDollars ? t : best, this.trades[0]);
        const worstTrade = this.trades.reduce((worst, t) =>
            t.netPnlDollars < worst.netPnlDollars ? t : worst, this.trades[0]);

        // Strategy breakdown
        const strategyStats = {};
        this.trades.forEach(t => {
            if (!strategyStats[t.strategyName]) {
                strategyStats[t.strategyName] = { wins: 0, losses: 0, pnl: 0, count: 0 };
            }
            strategyStats[t.strategyName].count++;
            strategyStats[t.strategyName].pnl += t.netPnlDollars;
            if (t.netPnlDollars > 0) strategyStats[t.strategyName].wins++;
            else if (t.netPnlDollars < 0) strategyStats[t.strategyName].losses++;
        });

        // Exit reason breakdown
        const exitStats = {};
        this.trades.forEach(t => {
            if (!exitStats[t.exitReason]) {
                exitStats[t.exitReason] = { count: 0, pnl: 0 };
            }
            exitStats[t.exitReason].count++;
            exitStats[t.exitReason].pnl += t.netPnlDollars;
        });

        return {
            // Core metrics
            totalTrades: this.trades.length,
            winners: winners.length,
            losers: losers.length,
            breakeven: breakeven.length,
            winRate: (winners.length / this.trades.length * 100).toFixed(1),

            // P&L
            startingBalance: this.startingBalance,
            finalBalance: this.balance,
            netPnlDollars: totalPnl,
            netPnlPercent: ((this.balance - this.startingBalance) / this.startingBalance * 100).toFixed(2),
            totalFeesPaid: totalFees,

            // Averages
            avgWinnerDollars: avgWinner,
            avgLoserDollars: avgLoser,
            avgWinnerPercent: winners.length > 0
                ? (winners.reduce((sum, t) => sum + t.netPnlPercent, 0) / winners.length).toFixed(2)
                : 0,
            avgLoserPercent: losers.length > 0
                ? (losers.reduce((sum, t) => sum + t.netPnlPercent, 0) / losers.length).toFixed(2)
                : 0,

            // Risk
            maxDrawdownPercent: this.maxDrawdown.toFixed(2),
            maxDrawdownDollars: this.maxDrawdownDollars.toFixed(2),
            profitFactor: losers.length > 0
                ? (winners.reduce((sum, t) => sum + t.netPnlDollars, 0) / Math.abs(losers.reduce((sum, t) => sum + t.netPnlDollars, 0))).toFixed(2)
                : 'N/A',

            // Extremes
            bestTrade: {
                number: bestTrade.tradeNumber,
                strategy: bestTrade.strategyName,
                pnl: bestTrade.netPnlDollars.toFixed(2)
            },
            worstTrade: {
                number: worstTrade.tradeNumber,
                strategy: worstTrade.strategyName,
                pnl: worstTrade.netPnlDollars.toFixed(2)
            },

            // Breakdowns
            strategyStats,
            exitStats
        };
    }

    /**
     * Print formatted summary to console
     */
    printSummary() {
        const s = this.getSummary();

        if (s.totalTrades === 0) {
            console.log('\n📊 BACKTEST SUMMARY: No trades recorded');
            return;
        }

        console.log('\n' + '═'.repeat(60));
        console.log('📊 BACKTEST SUMMARY (after 0.52% round-trip fees)');
        console.log('═'.repeat(60));

        console.log(`\n💰 ACCOUNT:`);
        console.log(`   Starting Balance:  $${s.startingBalance.toLocaleString()}`);
        console.log(`   Final Balance:     $${s.finalBalance.toLocaleString()}`);
        console.log(`   Net P&L:           ${s.netPnlDollars >= 0 ? '+' : ''}$${s.netPnlDollars.toFixed(2)} (${s.netPnlPercent}%)`);
        console.log(`   Total Fees Paid:   $${s.totalFeesPaid.toFixed(2)}`);

        console.log(`\n📈 PERFORMANCE:`);
        console.log(`   Total Trades:      ${s.totalTrades}`);
        console.log(`   Win Rate:          ${s.winRate}% (${s.winners}W / ${s.losers}L)`);
        console.log(`   Avg Winner:        +$${s.avgWinnerDollars.toFixed(2)} (+${s.avgWinnerPercent}%)`);
        console.log(`   Avg Loser:         $${s.avgLoserDollars.toFixed(2)} (${s.avgLoserPercent}%)`);
        console.log(`   Profit Factor:     ${s.profitFactor}`);

        console.log(`\n⚠️  RISK:`);
        console.log(`   Max Drawdown:      ${s.maxDrawdownPercent}% ($${s.maxDrawdownDollars})`);
        console.log(`   Best Trade:        #${s.bestTrade.number} ${s.bestTrade.strategy} +$${s.bestTrade.pnl}`);
        console.log(`   Worst Trade:       #${s.worstTrade.number} ${s.worstTrade.strategy} $${s.worstTrade.pnl}`);

        console.log(`\n🎯 BY STRATEGY:`);
        Object.entries(s.strategyStats).forEach(([name, stats]) => {
            const winRate = stats.count > 0 ? ((stats.wins / stats.count) * 100).toFixed(1) : 0;
            console.log(`   ${name}: ${stats.count} trades | ${winRate}% WR | ${stats.pnl >= 0 ? '+' : ''}$${stats.pnl.toFixed(2)}`);
        });

        console.log(`\n🚪 BY EXIT REASON:`);
        Object.entries(s.exitStats).forEach(([reason, stats]) => {
            console.log(`   ${reason}: ${stats.count} trades | ${stats.pnl >= 0 ? '+' : ''}$${stats.pnl.toFixed(2)}`);
        });

        console.log('\n' + '═'.repeat(60));
    }

    /**
     * Get detailed info about a specific trade
     * @param {number} tradeNumber - Trade number (1-indexed)
     */
    getTradeDetails(tradeNumber) {
        const trade = this.trades.find(t => t.tradeNumber === tradeNumber);

        if (!trade) {
            return { error: `Trade #${tradeNumber} not found. Total trades: ${this.trades.length}` };
        }

        console.log('\n' + '─'.repeat(50));
        console.log(`🔍 TRADE #${tradeNumber} DEEP DIVE`);
        console.log('─'.repeat(50));

        console.log(`\n📋 BASIC INFO:`);
        console.log(`   Strategy:     ${trade.strategyName}`);
        console.log(`   Direction:    ${trade.direction.toUpperCase()}`);
        console.log(`   Confidence:   ${trade.confidence.toFixed(1)}%`);
        console.log(`   Entry Time:   ${trade.entryTime}`);
        console.log(`   Exit Time:    ${trade.exitTime}`);
        console.log(`   Hold Time:    ${trade.holdTimeMinutes.toFixed(1)} minutes`);

        console.log(`\n💵 PRICES:`);
        console.log(`   Entry Price:  $${trade.entryPrice.toFixed(2)}`);
        console.log(`   Exit Price:   $${trade.exitPrice.toFixed(2)}`);
        console.log(`   Stop Loss:    ${trade.stopLoss}%`);
        console.log(`   Take Profit:  ${trade.takeProfit}%`);

        console.log(`\n💰 P&L:`);
        console.log(`   Raw P&L:      ${trade.rawPnlDollars >= 0 ? '+' : ''}$${trade.rawPnlDollars.toFixed(2)}`);
        console.log(`   Fees:         -$${trade.feesDollars.toFixed(2)}`);
        console.log(`   Net P&L:      ${trade.netPnlDollars >= 0 ? '+' : ''}$${trade.netPnlDollars.toFixed(2)} (${trade.netPnlPercent >= 0 ? '+' : ''}${trade.netPnlPercent.toFixed(2)}%)`);
        console.log(`   Balance:      $${trade.balanceBefore.toFixed(2)} → $${trade.balanceAfter.toFixed(2)}`);

        console.log(`\n🚪 EXIT:`);
        console.log(`   Reason:       ${trade.exitReason}`);
        console.log(`   Signal:       ${trade.reason}`);

        if (trade.entryCandle) {
            console.log(`\n🕯️ ENTRY CANDLE:`);
            console.log(`   O: ${trade.entryCandle.open} H: ${trade.entryCandle.high} L: ${trade.entryCandle.low} C: ${trade.entryCandle.close}`);
        }

        if (trade.exitCandle) {
            console.log(`\n🕯️ EXIT CANDLE:`);
            console.log(`   O: ${trade.exitCandle.open} H: ${trade.exitCandle.high} L: ${trade.exitCandle.low} C: ${trade.exitCandle.close}`);
        }

        if (trade.signalDetails) {
            console.log(`\n📊 SIGNAL DETAILS:`);
            console.log(`   ${JSON.stringify(trade.signalDetails, null, 2)}`);
        }

        console.log('─'.repeat(50));

        return trade;
    }

    /**
     * Reset for new backtest
     */
    reset() {
        this.balance = this.startingBalance;
        this.trades = [];
        this.peakBalance = this.startingBalance;
        this.maxDrawdown = 0;
        this.maxDrawdownDollars = 0;
    }
}

module.exports = BacktestRecorder;
