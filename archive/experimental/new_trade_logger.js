// utils/tradeLogger.js - Clean Trade Logging System
const fs = require('fs');
const path = require('path');

class TradeLogger {
    constructor() {
        // Use project root directory
        this.logDir = path.join(process.cwd(), 'logs', 'trades');
        this.ensureDirectoryExists();
    }

    /**
     * Ensure the logs directory exists
     */
    ensureDirectoryExists() {
        try {
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
                console.log(`✅ Created logs directory: ${this.logDir}`);
            }
        } catch (error) {
            console.error(`❌ Failed to create logs directory: ${error.message}`);
        }
    }

    /**
     * Get today's log filename
     * @returns {string} Full path to today's log file
     */
    getTodayLogFile() {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        return path.join(this.logDir, `trades_${today}.json`);
    }

    /**
     * Load existing trades for today
     * @returns {Array} Array of existing trades
     */
    loadTodaysTrades() {
        const filePath = this.getTodayLogFile();
        
        try {
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.warn(`⚠️ Could not load existing trades: ${error.message}`);
        }
        
        return [];
    }

    /**
     * Save trades array to file
     * @param {Array} trades - Array of trade objects
     */
    saveTrades(trades) {
        const filePath = this.getTodayLogFile();
        
        try {
            const jsonData = JSON.stringify(trades, null, 2);
            fs.writeFileSync(filePath, jsonData, 'utf8');
            return true;
        } catch (error) {
            console.error(`❌ Failed to save trades: ${error.message}`);
            return false;
        }
    }

    /**
     * Format hold time in human readable format
     * @param {number} holdTimeMs - Hold time in milliseconds
     * @returns {string} Formatted hold time
     */
    formatHoldTime(holdTimeMs) {
        if (!holdTimeMs) return '0s';
        
        const seconds = Math.floor(holdTimeMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    /**
     * Get RSI signal interpretation
     * @param {number} rsi - RSI value
     * @returns {string} RSI signal
     */
    getRsiSignal(rsi) {
        if (!rsi) return 'unknown';
        if (rsi >= 70) return 'overbought';
        if (rsi <= 30) return 'oversold';
        if (rsi >= 60) return 'bullish';
        if (rsi <= 40) return 'bearish';
        return 'neutral';
    }

    /**
     * Get current market session
     * @returns {string} Market session
     */
    getMarketSession() {
        const hour = new Date().getUTCHours();
        
        // Market sessions (UTC)
        if (hour >= 13 && hour < 21) return 'US_OPEN';
        if (hour >= 8 && hour < 16) return 'EU_OPEN';
        if (hour >= 0 && hour < 8) return 'ASIA_OPEN';
        return 'OFF_HOURS';
    }

    /**
     * Log a single trade with comprehensive market analysis
     * @param {Object} tradeData - Trade information
     */
    logTrade(tradeData) {
        try {
            // Comprehensive trade record with all indicators and analysis
            const trade = {
                // Basic trade info
                timestamp: new Date().toISOString(),
                tradeId: `trade_${Date.now()}`,
                type: tradeData.type || 'unknown',
                
                // Price data
                entryPrice: tradeData.entryPrice || 0,
                exitPrice: tradeData.exitPrice || 0,
                currentPrice: tradeData.currentPrice || 0,
                size: tradeData.size || 0,
                
                // Performance metrics
                pnl: tradeData.pnl || 0,
                pnlPercent: tradeData.pnlPercent || 0,
                fees: tradeData.fees || 0,
                netPnl: (tradeData.pnl || 0) - (tradeData.fees || 0),
                
                // Timing
                entryTime: tradeData.entryTime || new Date().toISOString(),
                exitTime: tradeData.exitTime || new Date().toISOString(),
                holdTime: tradeData.holdTime || 0,
                holdTimeFormatted: this.formatHoldTime(tradeData.holdTime || 0),
                
                // Account data
                balanceBefore: tradeData.balanceBefore || 0,
                balanceAfter: tradeData.balanceAfter || 0,
                
                // Technical indicators at entry
                indicators: {
                    rsi: tradeData.rsi || 0,
                    rsiSignal: this.getRsiSignal(tradeData.rsi),
                    macd: tradeData.macd || 0,
                    macdSignal: tradeData.macdSignal || 0,
                    macdHistogram: tradeData.macdHistogram || 0,
                    macdCrossover: tradeData.macdCrossover || false,
                    ema20: tradeData.ema20 || 0,
                    ema50: tradeData.ema50 || 0,
                    ema200: tradeData.ema200 || 0,
                    sma20: tradeData.sma20 || 0,
                    sma50: tradeData.sma50 || 0,
                    bollingerUpper: tradeData.bollingerUpper || 0,
                    bollingerLower: tradeData.bollingerLower || 0,
                    bollingerMiddle: tradeData.bollingerMiddle || 0,
                    stochastic: tradeData.stochastic || 0,
                    volume: tradeData.volume || 0,
                    atr: tradeData.atr || 0,
                    adx: tradeData.adx || 0
                },
                
                // Market analysis
                analysis: {
                    trend: tradeData.trend || 'unknown',
                    trendStrength: tradeData.trendStrength || 0,
                    confidence: tradeData.confidence || 0,
                    volatility: tradeData.volatility || 0,
                    marketRegime: tradeData.marketRegime || 'normal',
                    support: tradeData.support || 0,
                    resistance: tradeData.resistance || 0,
                    fibLevels: tradeData.fibLevels || [],
                    keyLevel: tradeData.keyLevel || null,
                    levelDistance: tradeData.levelDistance || 0
                },
                
                // Entry reasoning
                entrySignal: {
                    primaryReason: tradeData.entryReason || 'no reason provided',
                    secondaryReasons: tradeData.secondaryReasons || [],
                    signalStrength: tradeData.signalStrength || 0,
                    conflictingSignals: tradeData.conflictingSignals || [],
                    patternMatch: tradeData.patternMatch || null,
                    patternConfidence: tradeData.patternConfidence || 0,
                    timeframeConcurrence: tradeData.timeframeConcurrence || false
                },
                
                // Exit reasoning
                exitSignal: {
                    exitReason: tradeData.exitReason || tradeData.reason || 'unknown',
                    exitType: tradeData.exitType || 'manual', // stop_loss, take_profit, trailing_stop, signal, manual
                    profitTier: tradeData.profitTier || null,
                    stopLossPrice: tradeData.stopLossPrice || 0,
                    takeProfitPrice: tradeData.takeProfitPrice || 0,
                    trailingStopPrice: tradeData.trailingStopPrice || 0,
                    maxProfitReached: tradeData.maxProfitReached || 0,
                    maxDrawdown: tradeData.maxDrawdown || 0
                },
                
                // Risk management
                riskManagement: {
                    positionSize: tradeData.positionSize || 0,
                    riskPercent: tradeData.riskPercent || 0,
                    riskAmount: tradeData.riskAmount || 0,
                    rewardRiskRatio: tradeData.rewardRiskRatio || 0,
                    maxRisk: tradeData.maxRisk || 0,
                    actualRisk: tradeData.actualRisk || 0
                },
                
                // Pattern recognition data
                patternData: {
                    patternType: tradeData.patternType || null,
                    patternId: tradeData.patternId || null,
                    similarPatterns: tradeData.similarPatterns || 0,
                    patternWinRate: tradeData.patternWinRate || 0,
                    patternAvgReturn: tradeData.patternAvgReturn || 0,
                    isNewPattern: tradeData.isNewPattern || false
                },
                
                // Market context
                marketContext: {
                    timeOfDay: new Date().getHours(),
                    dayOfWeek: new Date().getDay(),
                    marketSession: this.getMarketSession(),
                    newsEvents: tradeData.newsEvents || [],
                    economicEvents: tradeData.economicEvents || [],
                    marketSentiment: tradeData.marketSentiment || 'neutral'
                },
                
                // Performance tracking
                performance: {
                    winStreak: tradeData.winStreak || 0,
                    lossStreak: tradeData.lossStreak || 0,
                    dailyPnL: tradeData.dailyPnL || 0,
                    weeklyPnL: tradeData.weeklyPnL || 0,
                    monthlyPnL: tradeData.monthlyPnL || 0,
                    totalTrades: tradeData.totalTrades || 0,
                    winRate: tradeData.winRate || 0
                },
                
                // Houston fund tracking
                houstonFund: {
                    target: 25000,
                    current: tradeData.balanceAfter || 0,
                    progress: ((tradeData.balanceAfter || 0) / 25000) * 100,
                    remaining: 25000 - (tradeData.balanceAfter || 0),
                    daysTrading: tradeData.daysTrading || 0,
                    avgDailyGain: tradeData.avgDailyGain || 0
                },
                
                // Raw data for debugging
                rawData: {
                    candles: tradeData.candles ? tradeData.candles.slice(-5) : [], // Last 5 candles
                    features: tradeData.features || [],
                    originalAnalysis: tradeData.originalAnalysis || null
                },
                
                // Include any additional fields
                ...tradeData
            };

            // Load existing trades
            const trades = this.loadTodaysTrades();
            
            // Add new trade
            trades.push(trade);
            
            // Save updated trades
            const saved = this.saveTrades(trades);
            
            if (saved) {
                console.log(`📝 COMPREHENSIVE TRADE LOG:`);
                console.log(`   ${trade.type} | Entry: ${trade.entryPrice} | Exit: ${trade.exitPrice}`);
                console.log(`   P&L: ${trade.pnl.toFixed(2)} (${trade.pnlPercent.toFixed(2)}%) | Hold: ${trade.holdTimeFormatted}`);
                console.log(`   RSI: ${trade.indicators.rsi.toFixed(1)} (${trade.indicators.rsiSignal}) | Trend: ${trade.analysis.trend} | Confidence: ${trade.analysis.confidence.toFixed(2)}`);
                console.log(`   Reason: ${trade.entrySignal.primaryReason} → ${trade.exitSignal.exitReason}`);
                console.log(`   Houston Fund: ${trade.houstonFund.current.toFixed(2)} (${trade.houstonFund.progress.toFixed(1)}% to goal)`);
            }
            
            return saved;
            
        } catch (error) {
            console.error(`❌ Error logging trade: ${error.message}`);
            return false;
        }
    }

    /**
     * Get comprehensive trade statistics for today
     * @returns {Object} Detailed trade statistics
     */
    getTodayStats() {
        const trades = this.loadTodaysTrades();
        
        if (trades.length === 0) {
            return {
                totalTrades: 0,
                wins: 0,
                losses: 0,
                totalPnL: 0,
                winRate: 0,
                avgPnL: 0,
                bestTrade: 0,
                worstTrade: 0,
                avgHoldTime: 0,
                avgRSI: 0,
                trendBreakdown: {},
                exitReasonBreakdown: {},
                houstonProgress: 0
            };
        }

        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl < 0);
        const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
        const bestTrade = Math.max(...trades.map(t => t.pnl));
        const worstTrade = Math.min(...trades.map(t => t.pnl));
        const avgHoldTime = trades.reduce((sum, t) => sum + (t.holdTime || 0), 0) / trades.length;
        const avgRSI = trades.reduce((sum, t) => sum + (t.indicators?.rsi || 0), 0) / trades.length;

        // Trend breakdown
        const trendBreakdown = {};
        trades.forEach(t => {
            const trend = t.analysis?.trend || 'unknown';
            trendBreakdown[trend] = (trendBreakdown[trend] || 0) + 1;
        });

        // Exit reason breakdown
        const exitReasonBreakdown = {};
        trades.forEach(t => {
            const reason = t.exitSignal?.exitReason || 'unknown';
            exitReasonBreakdown[reason] = (exitReasonBreakdown[reason] || 0) + 1;
        });

        // Pattern performance
        const patternStats = {};
        trades.forEach(t => {
            if (t.patternData?.patternType) {
                const pattern = t.patternData.patternType;
                if (!patternStats[pattern]) {
                    patternStats[pattern] = { wins: 0, losses: 0, totalPnL: 0, count: 0 };
                }
                patternStats[pattern].count++;
                patternStats[pattern].totalPnL += t.pnl;
                if (t.pnl > 0) patternStats[pattern].wins++;
                else patternStats[pattern].losses++;
            }
        });

        // Risk management stats
        const avgRiskPercent = trades.reduce((sum, t) => sum + (t.riskManagement?.riskPercent || 0), 0) / trades.length;
        const avgRewardRisk = trades.reduce((sum, t) => sum + (t.riskManagement?.rewardRiskRatio || 0), 0) / trades.length;

        return {
            // Basic stats
            totalTrades: trades.length,
            wins: wins.length,
            losses: losses.length,
            breakeven: trades.filter(t => t.pnl === 0).length,
            
            // Performance
            totalPnL: totalPnL,
            winRate: (wins.length / trades.length) * 100,
            avgPnL: totalPnL / trades.length,
            bestTrade: bestTrade,
            worstTrade: worstTrade,
            profitFactor: wins.reduce((sum, t) => sum + t.pnl, 0) / Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0)) || 0,
            
            // Timing
            avgHoldTime: avgHoldTime,
            avgHoldTimeFormatted: this.formatHoldTime(avgHoldTime),
            shortestTrade: Math.min(...trades.map(t => t.holdTime || 0)),
            longestTrade: Math.max(...trades.map(t => t.holdTime || 0)),
            
            // Technical analysis
            avgRSI: avgRSI,
            avgConfidence: trades.reduce((sum, t) => sum + (t.analysis?.confidence || 0), 0) / trades.length,
            avgVolatility: trades.reduce((sum, t) => sum + (t.analysis?.volatility || 0), 0) / trades.length,
            
            // Breakdowns
            trendBreakdown,
            exitReasonBreakdown,
            patternStats,
            
            // Risk management
            avgRiskPercent,
            avgRewardRisk,
            maxDrawdown: Math.min(...trades.map(t => t.exitSignal?.maxDrawdown || 0)),
            
            // Houston fund
            houstonProgress: trades.length > 0 ? trades[trades.length - 1].houstonFund?.progress || 0 : 0,
            currentBalance: trades.length > 0 ? trades[trades.length - 1].balanceAfter || 0 : 0,
            
            // Raw data
            trades: trades
        };
    }

    /**
     * Get all trade files
     * @returns {Array} Array of trade file paths
     */
    getAllTradeFiles() {
        try {
            const files = fs.readdirSync(this.logDir);
            return files
                .filter(file => file.startsWith('trades_') && file.endsWith('.json'))
                .map(file => path.join(this.logDir, file));
        } catch (error) {
            console.error(`❌ Error reading trade files: ${error.message}`);
            return [];
        }
    }

    /**
     * Clean old log files (keep last 30 days)
     */
    cleanOldLogs() {
        try {
            const files = this.getAllTradeFiles();
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            files.forEach(filePath => {
                const fileName = path.basename(filePath);
                const dateMatch = fileName.match(/trades_(\d{4}-\d{2}-\d{2})\.json/);
                
                if (dateMatch) {
                    const fileDate = new Date(dateMatch[1]);
                    if (fileDate < thirtyDaysAgo) {
                        fs.unlinkSync(filePath);
                        console.log(`🗑️ Cleaned old log file: ${fileName}`);
                    }
                }
            });
        } catch (error) {
            console.error(`❌ Error cleaning old logs: ${error.message}`);
        }
    }
}

// Create singleton instance
const tradeLogger = new TradeLogger();

// Export functions for compatibility
function logTrade(tradeData) {
    return tradeLogger.logTrade(tradeData);
}

function getTodayStats() {
    return tradeLogger.getTodayStats();
}

function cleanOldLogs() {
    return tradeLogger.cleanOldLogs();
}

function generateDailyReport() {
    return tradeLogger.generateDailyReport();
}

// Export both class and functions
module.exports = {
    TradeLogger,
    logTrade,
    getTodayStats,
    cleanOldLogs,
    generateDailyReport,
    tradeLogger
};