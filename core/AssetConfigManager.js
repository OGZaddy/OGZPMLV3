/**
 * ============================================================================
 * AssetConfigManager - Asset-Specific Configuration Hub
 * ============================================================================
 * 
 * Manages market-specific configurations for all asset types.
 * This replaces hardcoded crypto keywords, pairs, and settings
 * with a centralized, extensible configuration system.
 * 
 * EMPIRE V2 FOUNDATION
 * 
 * @author OGZPrime Team
 * @version 1.0.0
 * ============================================================================
 */

class AssetConfigManager {
    constructor() {
        this.configs = this.loadDefaultConfigs();
        console.log('📋 AssetConfigManager initialized');
    }

    /**
     * Load default configurations for all asset types
     */
    loadDefaultConfigs() {
        return {
            // =================================================================
            // CRYPTO CONFIGURATION
            // =================================================================
            crypto: {
                name: 'Cryptocurrency',
                symbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'],
                defaultSymbol: 'BTC/USD',
                
                // Trading hours
                tradingHours: {
                    type: '24/7',
                    timezone: 'UTC'
                },
                
                // Order sizing
                minOrderSize: {
                    'BTC/USD': 0.0001,
                    'ETH/USD': 0.001,
                    'SOL/USD': 0.01,
                    default: 0.001
                },
                
                // News keywords for sentiment analysis
                newsKeywords: [
                    'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'blockchain',
                    'defi', 'nft', 'web3', 'binance', 'coinbase', 'sec crypto',
                    'bitcoin etf', 'crypto regulation', 'stablecoin'
                ],
                
                // Correlated pairs for analysis
                correlatedPairs: [
                    ['BTC/USD', 'ETH/USD'],
                    ['ETH/USD', 'SOL/USD'],
                    ['BTC/USD', 'SOL/USD']
                ],
                
                // Risk parameters
                volatilityMultiplier: 1.5,    // Crypto is more volatile
                defaultStopLoss: 2.0,          // 2% stop loss
                defaultTakeProfit: 6.0,        // 6% take profit (3:1 R:R)
                maxPositionPercent: 0.15,      // Max 15% of portfolio per position
                
                // Strategy parameters
                confidenceThreshold: {
                    buy: 0.65,
                    sell: 0.35
                },
                
                // Specific features
                features: {
                    shortingEnabled: true,
                    leverageEnabled: true,
                    maxLeverage: 5,
                    stakingIntegration: false
                }
            },

            // =================================================================
            // STOCKS CONFIGURATION  
            // =================================================================
            stocks: {
                name: 'US Stocks',
                symbols: ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'NVDA', 'META'],
                defaultSymbol: 'AAPL',
                
                // Trading hours (US Market)
                tradingHours: {
                    type: 'scheduled',
                    timezone: 'America/New_York',
                    sessions: {
                        premarket: { start: '04:00', end: '09:30' },
                        regular: { start: '09:30', end: '16:00' },
                        afterhours: { start: '16:00', end: '20:00' }
                    },
                    tradeDuringPremarket: false,
                    tradeDuringAfterHours: false,
                    holidays: [] // Will be populated dynamically
                },
                
                // Order sizing
                minOrderSize: {
                    default: 1  // 1 share minimum
                },
                
                // News keywords
                newsKeywords: [
                    'earnings', 'fed', 'fomc', 'gdp', 'jobs report', 'nfp',
                    'inflation', 'cpi', 'interest rate', 'recession',
                    'stock market', 'dow jones', 'sp500', 'nasdaq'
                ],
                
                // Sector correlations
                correlatedPairs: [
                    ['AAPL', 'MSFT'],   // Tech giants
                    ['GOOGL', 'META'],  // Ad tech
                    ['NVDA', 'AMD'],    // Semiconductors
                    ['TSLA', 'RIVN']    // EVs
                ],
                
                // Risk parameters (more conservative)
                volatilityMultiplier: 1.0,
                defaultStopLoss: 1.5,          // 1.5% stop loss
                defaultTakeProfit: 4.0,        // 4% take profit
                maxPositionPercent: 0.10,      // Max 10% per position
                
                // Strategy parameters
                confidenceThreshold: {
                    buy: 0.70,    // Higher threshold for stocks
                    sell: 0.30
                },
                
                // Earnings protection
                earnings: {
                    avoidBeforeEarnings: true,
                    bufferDays: 3,              // Don't trade 3 days before earnings
                    closeBeforeEarnings: true   // Close positions before earnings
                },
                
                // Specific features
                features: {
                    shortingEnabled: true,      // Requires margin
                    leverageEnabled: false,     // No leverage on stocks
                    dividendTracking: true,
                    splitAdjustment: true
                }
            },

            // =================================================================
            // OPTIONS CONFIGURATION
            // =================================================================
            options: {
                name: 'Stock Options',
                symbols: ['SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'AMD'],
                defaultSymbol: 'SPY',
                
                // Trading hours (same as stocks)
                tradingHours: {
                    type: 'scheduled',
                    timezone: 'America/New_York',
                    sessions: {
                        regular: { start: '09:30', end: '16:00' }
                    }
                },
                
                // Order sizing
                minOrderSize: {
                    default: 1  // 1 contract minimum
                },
                
                // News keywords
                newsKeywords: [
                    'vix', 'volatility', 'options', 'implied volatility',
                    'fed', 'fomc', 'earnings', 'gdp', 'expiration'
                ],
                
                // Risk parameters
                volatilityMultiplier: 2.0,     // Options are very volatile
                defaultStopLoss: 30.0,         // 30% stop (options move fast)
                defaultTakeProfit: 50.0,       // 50% profit target
                maxPositionPercent: 0.05,      // Max 5% per position (risky!)
                
                // Strategy parameters
                confidenceThreshold: {
                    buy: 0.75,    // Very high threshold
                    sell: 0.25
                },
                
                // Options-specific parameters
                options: {
                    maxDTE: 45,                 // Max 45 days to expiration
                    minDTE: 7,                  // Min 7 days to expiration
                    preferredDelta: {
                        calls: 0.30,            // 30 delta calls
                        puts: -0.30             // 30 delta puts
                    },
                    ivRankThreshold: 30,        // Sell premium above 30 IV rank
                    greeksEnabled: true,
                    spreadStrategies: ['vertical', 'iron_condor', 'butterfly']
                },
                
                // Features
                features: {
                    greeksCalculation: true,
                    ivAnalysis: true,
                    expiryManagement: true,
                    rolloverAlerts: true
                }
            },

            // =================================================================
            // FOREX CONFIGURATION
            // =================================================================
            forex: {
                name: 'Foreign Exchange',
                symbols: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD'],
                defaultSymbol: 'EUR/USD',
                
                // Trading hours (24/5)
                tradingHours: {
                    type: '24/5',
                    timezone: 'America/New_York',
                    sessions: {
                        sydney: { start: '17:00', end: '02:00' },   // Sunday
                        tokyo: { start: '19:00', end: '04:00' },
                        london: { start: '03:00', end: '12:00' },
                        newyork: { start: '08:00', end: '17:00' }   // Friday close
                    },
                    weekendClosed: true  // Closed Saturday-Sunday
                },
                
                // Order sizing (mini lots)
                minOrderSize: {
                    default: 1000  // Mini lot
                },
                
                // News keywords
                newsKeywords: [
                    'fed', 'fomc', 'ecb', 'boe', 'boj', 'rba',
                    'nfp', 'cpi', 'gdp', 'interest rate', 'central bank',
                    'forex', 'currency', 'dollar', 'euro', 'yen'
                ],
                
                // Currency correlations
                correlatedPairs: [
                    ['EUR/USD', 'GBP/USD'],   // Positive correlation
                    ['EUR/USD', 'USD/CHF'],   // Negative correlation
                    ['AUD/USD', 'NZD/USD']    // Commodity currencies
                ],
                
                // Risk parameters (tighter for forex)
                volatilityMultiplier: 0.8,
                defaultStopLoss: 0.5,          // 0.5% (50 pips on most pairs)
                defaultTakeProfit: 1.5,        // 1.5% (150 pips)
                maxPositionPercent: 0.02,      // Max 2% risk per trade
                
                // Strategy parameters
                confidenceThreshold: {
                    buy: 0.65,
                    sell: 0.35
                },
                
                // Forex-specific
                forex: {
                    pipValue: {
                        'EUR/USD': 0.0001,
                        'USD/JPY': 0.01,
                        default: 0.0001
                    },
                    maxLeverage: 50,           // Up to 50:1
                    swapTracking: true,        // Track overnight swaps
                    sessionOverlaps: true      // Best during session overlaps
                },
                
                // Features
                features: {
                    leverageEnabled: true,
                    carryTradeAnalysis: true,
                    centralBankCalendar: true,
                    correlationMatrix: true
                }
            },

            // =================================================================
            // FUTURES CONFIGURATION
            // =================================================================
            futures: {
                name: 'Futures',
                symbols: ['ES', 'NQ', 'CL', 'GC', 'SI'],  // E-mini S&P, Nasdaq, Crude, Gold, Silver
                defaultSymbol: 'ES',
                
                // Trading hours (nearly 24/5)
                tradingHours: {
                    type: 'scheduled',
                    timezone: 'America/Chicago',
                    sessions: {
                        globex: { start: '18:00', end: '17:00' }  // Sunday-Friday
                    },
                    dailyClose: { start: '16:15', end: '16:30' }  // Daily settlement
                },
                
                // Order sizing
                minOrderSize: {
                    'ES': 1,    // 1 E-mini contract
                    'NQ': 1,
                    'CL': 1,
                    default: 1
                },
                
                // News keywords
                newsKeywords: [
                    'fed', 'fomc', 'gdp', 'cpi', 'employment',
                    'crude oil', 'opec', 'gold', 'silver',
                    'futures', 'commodities', 'contango', 'backwardation'
                ],
                
                // Risk parameters
                volatilityMultiplier: 1.2,
                defaultStopLoss: 1.0,
                defaultTakeProfit: 3.0,
                maxPositionPercent: 0.10,
                
                // Strategy parameters
                confidenceThreshold: {
                    buy: 0.70,
                    sell: 0.30
                },
                
                // Futures-specific
                futures: {
                    contractExpiry: true,       // Track contract expiry
                    rolloverDays: 5,           // Roll 5 days before expiry
                    marginRequirements: true,
                    contangoBackwardation: true
                },
                
                // Features
                features: {
                    leverageEnabled: true,
                    marginTracking: true,
                    rolloverManagement: true,
                    settlementTracking: true
                }
            }
        };
    }

    // =========================================================================
    // GETTERS
    // =========================================================================

    /**
     * Get full configuration for an asset type
     * @param {string} assetType - 'crypto', 'stocks', 'options', 'forex', 'futures'
     * @returns {Object} Full configuration object
     */
    getConfig(assetType) {
        const config = this.configs[assetType.toLowerCase()];
        if (!config) {
            console.warn(`⚠️ Unknown asset type: ${assetType}, defaulting to crypto`);
            return this.configs.crypto;
        }
        return config;
    }

    /**
     * Get news keywords for an asset type
     * @param {string} assetType 
     * @returns {Array<string>}
     */
    getKeywords(assetType) {
        return this.getConfig(assetType).newsKeywords || [];
    }

    /**
     * Get correlated pairs for analysis
     * @param {string} assetType 
     * @returns {Array<Array<string>>}
     */
    getCorrelatedPairs(assetType) {
        return this.getConfig(assetType).correlatedPairs || [];
    }

    /**
     * Get default symbols for an asset type
     * @param {string} assetType 
     * @returns {Array<string>}
     */
    getSymbols(assetType) {
        return this.getConfig(assetType).symbols || [];
    }

    /**
     * Get risk parameters
     * @param {string} assetType 
     * @returns {Object}
     */
    getRiskParams(assetType) {
        const config = this.getConfig(assetType);
        return {
            volatilityMultiplier: config.volatilityMultiplier,
            defaultStopLoss: config.defaultStopLoss,
            defaultTakeProfit: config.defaultTakeProfit,
            maxPositionPercent: config.maxPositionPercent,
            confidenceThreshold: config.confidenceThreshold
        };
    }

    /**
     * Get minimum order size for a symbol
     * @param {string} assetType 
     * @param {string} symbol 
     * @returns {number}
     */
    getMinOrderSize(assetType, symbol) {
        const config = this.getConfig(assetType);
        return config.minOrderSize[symbol] || config.minOrderSize.default || 1;
    }

    // =========================================================================
    // TRADING HOURS
    // =========================================================================

    /**
     * Check if trading is allowed right now
     * @param {string} assetType 
     * @returns {boolean}
     */
    isWithinTradingHours(assetType) {
        const config = this.getConfig(assetType);
        const hours = config.tradingHours;

        if (hours.type === '24/7') return true;
        
        if (hours.type === '24/5') {
            return !this.isWeekend(hours.timezone);
        }

        if (hours.type === 'scheduled') {
            return this.isWithinScheduledHours(hours);
        }

        return true; // Default to allowing trades
    }

    /**
     * Check if it's the weekend
     * @param {string} timezone 
     * @returns {boolean}
     */
    isWeekend(timezone = 'UTC') {
        const now = new Date();
        // Simple weekend check (can be enhanced with proper timezone handling)
        const day = now.getUTCDay();
        return day === 0 || day === 6; // Sunday or Saturday
    }

    /**
     * Check if within scheduled trading hours
     * @param {Object} hoursConfig 
     * @returns {boolean}
     */
    isWithinScheduledHours(hoursConfig) {
        // Simplified - in production, use proper timezone library
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const currentTime = hours * 100 + minutes;

        for (const session of Object.values(hoursConfig.sessions || {})) {
            const [startHour, startMin] = session.start.split(':').map(Number);
            const [endHour, endMin] = session.end.split(':').map(Number);
            
            const startTime = startHour * 100 + startMin;
            const endTime = endHour * 100 + endMin;

            if (currentTime >= startTime && currentTime <= endTime) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get next market open time
     * @param {string} assetType 
     * @returns {Date|null}
     */
    getNextMarketOpen(assetType) {
        // Placeholder - implement with proper timezone handling
        return null;
    }

    // =========================================================================
    // FEATURES
    // =========================================================================

    /**
     * Check if a feature is enabled for an asset type
     * @param {string} assetType 
     * @param {string} feature 
     * @returns {boolean}
     */
    isFeatureEnabled(assetType, feature) {
        const config = this.getConfig(assetType);
        return config.features?.[feature] || false;
    }

    /**
     * Get all enabled features for an asset type
     * @param {string} assetType 
     * @returns {Object}
     */
    getFeatures(assetType) {
        return this.getConfig(assetType).features || {};
    }

    // =========================================================================
    // CUSTOMIZATION
    // =========================================================================

    /**
     * Override configuration values
     * @param {string} assetType 
     * @param {Object} overrides 
     */
    setOverrides(assetType, overrides) {
        const config = this.configs[assetType.toLowerCase()];
        if (config) {
            Object.assign(config, overrides);
            console.log(`📋 Config overrides applied for ${assetType}`);
        }
    }

    /**
     * Add a new asset type configuration
     * @param {string} assetType 
     * @param {Object} config 
     */
    addAssetType(assetType, config) {
        this.configs[assetType.toLowerCase()] = config;
        console.log(`📋 New asset type added: ${assetType}`);
    }

    /**
     * Get all available asset types
     * @returns {Array<string>}
     */
    getAvailableAssetTypes() {
        return Object.keys(this.configs);
    }
}

// Singleton instance
let instance = null;

/**
 * Get singleton instance
 * @returns {AssetConfigManager}
 */
AssetConfigManager.getInstance = function() {
    if (!instance) {
        instance = new AssetConfigManager();
    }
    return instance;
};

module.exports = AssetConfigManager;
