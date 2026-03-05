# EMPIRE V2 ARCHITECTURE CONTEXT PACK
Generated: 2025-12-22

This document contains the key files for the Empire V2 architecture implementation.

## TABLE OF CONTENTS
1. IBrokerAdapter.js - Broker Interface
2. BrokerRegistry.js - Broker Factory
3. run-empire-v2.js - Main Trading Bot
4. ogzprime-ssl-server.js - WebSocket Server

---

## 1. IBrokerAdapter.js
Location: /opt/ogzprime/OGZPMLV2/brokers/IBrokerAdapter.js

```javascript/**
 * ============================================================================
 * IBrokerAdapter - Universal Broker Interface
 * ============================================================================
 * 
 * ALL broker adapters must implement this interface.
 * This ensures any asset type (crypto, stocks, options, forex, futures)
 * can be traded with the same bot logic.
 * 
 * EMPIRE V2 FOUNDATION
 * 
 * @author OGZPrime Team
 * @version 1.0.0
 * ============================================================================
 */

const EventEmitter = require('events');

class IBrokerAdapter extends EventEmitter {
    constructor() {
        super();
        if (new.target === IBrokerAdapter) {
            throw new Error('IBrokerAdapter is an interface - extend it, don\'t instantiate it');
        }
    }

    // =========================================================================
    // CONNECTION MANAGEMENT
    // =========================================================================

    /**
     * Connect to the broker
     * @returns {Promise<boolean>} Success status
     */
    async connect() {
        throw new Error('connect() must be implemented');
    }

    /**
     * Disconnect from the broker
     * @returns {Promise<void>}
     */
    async disconnect() {
        throw new Error('disconnect() must be implemented');
    }

    /**
     * Check if connected
     * @returns {boolean}
     */
    isConnected() {
        throw new Error('isConnected() must be implemented');
    }

    // =========================================================================
    // ACCOUNT INFO
    // =========================================================================

    /**
     * Get account balance
     * @returns {Promise<Object>} { currency: amount, ... }
     */
    async getBalance() {
        throw new Error('getBalance() must be implemented');
    }

    /**
     * Get open positions
     * @returns {Promise<Array>} [{ symbol, size, entryPrice, currentPrice, pnl }, ...]
     */
    async getPositions() {
        throw new Error('getPositions() must be implemented');
    }

    /**
     * Get open orders
     * @returns {Promise<Array>} [{ orderId, symbol, type, side, price, amount, status }, ...]
     */
    async getOpenOrders() {
        throw new Error('getOpenOrders() must be implemented');
    }

    // =========================================================================
    // ORDER MANAGEMENT
    // =========================================================================

    /**
     * Place a buy order
     * @param {string} symbol - Trading pair/symbol
     * @param {number} amount - Order size
     * @param {number|null} price - Limit price (null for market)
     * @param {Object} options - Additional options { stopLoss, takeProfit, etc. }
     * @returns {Promise<Object>} { orderId, status, ... }
     */
    async placeBuyOrder(symbol, amount, price = null, options = {}) {
        throw new Error('placeBuyOrder() must be implemented');
    }

    /**
     * Place a sell order
     * @param {string} symbol - Trading pair/symbol
     * @param {number} amount - Order size
     * @param {number|null} price - Limit price (null for market)
     * @param {Object} options - Additional options { stopLoss, takeProfit, etc. }
     * @returns {Promise<Object>} { orderId, status, ... }
     */
    async placeSellOrder(symbol, amount, price = null, options = {}) {
        throw new Error('placeSellOrder() must be implemented');
    }

    /**
     * Cancel an order
     * @param {string} orderId - Order ID to cancel
     * @returns {Promise<boolean>} Success status
     */
    async cancelOrder(orderId) {
        throw new Error('cancelOrder() must be implemented');
    }

    /**
     * Modify an existing order
     * @param {string} orderId - Order ID to modify
     * @param {Object} modifications - { price, amount, stopLoss, takeProfit }
     * @returns {Promise<Object>} Modified order details
     */
    async modifyOrder(orderId, modifications) {
        throw new Error('modifyOrder() must be implemented');
    }

    /**
     * Get order status
     * @param {string} orderId - Order ID to check
     * @returns {Promise<Object>} { orderId, status, filledAmount, remainingAmount, ... }
     */
    async getOrderStatus(orderId) {
        throw new Error('getOrderStatus() must be implemented');
    }

    // =========================================================================
    // MARKET DATA
    // =========================================================================

    /**
     * Get current ticker/price
     * @param {string} symbol - Trading pair/symbol
     * @returns {Promise<Object>} { bid, ask, last, volume, ... }
     */
    async getTicker(symbol) {
        throw new Error('getTicker() must be implemented');
    }

    /**
     * Get OHLCV candles
     * @param {string} symbol - Trading pair/symbol
     * @param {string} timeframe - '1m', '5m', '15m', '1h', '4h', '1d'
     * @param {number} limit - Number of candles
     * @returns {Promise<Array>} [{ o, h, l, c, v, t }, ...]
     */
    async getCandles(symbol, timeframe = '1m', limit = 100) {
        throw new Error('getCandles() must be implemented');
    }

    /**
     * Get order book
     * @param {string} symbol - Trading pair/symbol
     * @param {number} depth - Number of levels
     * @returns {Promise<Object>} { bids: [[price, amount], ...], asks: [[price, amount], ...] }
     */
    async getOrderBook(symbol, depth = 20) {
        throw new Error('getOrderBook() must be implemented');
    }

    // =========================================================================
    // REAL-TIME SUBSCRIPTIONS
    // =========================================================================

    /**
     * Subscribe to ticker updates
     * @param {string} symbol - Trading pair/symbol
     * @param {Function} callback - Called with ticker data
     */
    subscribeToTicker(symbol, callback) {
        throw new Error('subscribeToTicker() must be implemented');
    }

    /**
     * Subscribe to candle updates
     * @param {string} symbol - Trading pair/symbol
     * @param {string} timeframe - Candle timeframe
     * @param {Function} callback - Called with new candle
     */
    subscribeToCandles(symbol, timeframe, callback) {
        throw new Error('subscribeToCandles() must be implemented');
    }

    /**
     * Subscribe to order book updates
     * @param {string} symbol - Trading pair/symbol
     * @param {Function} callback - Called with order book updates
     */
    subscribeToOrderBook(symbol, callback) {
        throw new Error('subscribeToOrderBook() must be implemented');
    }

    /**
     * Subscribe to order/position updates
     * @param {Function} callback - Called with order/position updates
     */
    subscribeToAccount(callback) {
        throw new Error('subscribeToAccount() must be implemented');
    }

    /**
     * Unsubscribe from all subscriptions
     */
    unsubscribeAll() {
        throw new Error('unsubscribeAll() must be implemented');
    }

    // =========================================================================
    // ASSET INFORMATION
    // =========================================================================

    /**
     * Get the asset type this broker handles
     * @returns {string} 'crypto' | 'stocks' | 'options' | 'forex' | 'futures'
     */
    getAssetType() {
        throw new Error('getAssetType() must be implemented');
    }

    /**
     * Get broker name/identifier
     * @returns {string} e.g., 'kraken', 'tdameritrade', 'tastyworks'
     */
    getBrokerName() {
        throw new Error('getBrokerName() must be implemented');
    }

    /**
     * Get supported symbols/pairs
     * @returns {Promise<Array>} ['BTC/USD', 'ETH/USD', ...] or ['AAPL', 'GOOGL', ...]
     */
    async getSupportedSymbols() {
        throw new Error('getSupportedSymbols() must be implemented');
    }

    /**
     * Get minimum order size for a symbol
     * @param {string} symbol 
     * @returns {number}
     */
    getMinOrderSize(symbol) {
        throw new Error('getMinOrderSize() must be implemented');
    }

    /**
     * Get trading fees
     * @returns {Object} { maker: 0.001, taker: 0.002 }
     */
    getFees() {
        throw new Error('getFees() must be implemented');
    }

    /**
     * Check if symbol is tradeable right now
     * @param {string} symbol 
     * @returns {boolean}
     */
    isTradeableNow(symbol) {
        throw new Error('isTradeableNow() must be implemented');
    }

    // =========================================================================
    // SYMBOL NORMALIZATION (Override as needed)
    // =========================================================================

    /**
     * Convert universal symbol to broker-specific format
     * @param {string} symbol - Universal format (e.g., 'BTC/USD')
     * @returns {string} Broker format (e.g., 'XBTUSD' for Kraken)
     */
    toBrokerSymbol(symbol) {
        return symbol; // Default: no conversion
    }

    /**
     * Convert broker-specific symbol to universal format
     * @param {string} brokerSymbol - Broker format
     * @returns {string} Universal format
     */
    fromBrokerSymbol(brokerSymbol) {
        return brokerSymbol; // Default: no conversion
    }
}

module.exports = IBrokerAdapter;
```

---

## 2. BrokerRegistry.js
Location: /opt/ogzprime/OGZPMLV2/brokers/BrokerRegistry.js

```javascript
/**
 * ============================================================================
 * BrokerRegistry - Master Broker Implementation Registry
 * ============================================================================
 * 
 * Maps all available broker adapters with metadata
 * 
 * @author OGZPrime Team
 * @version 1.0.0
 * ============================================================================
 */

const BrokerRegistry = {
    // =========================================================================
    // CRYPTO BROKERS
    // =========================================================================
    
    kraken: {
        name: 'Kraken',
        assetType: 'crypto',
        filePath: './kraken_adapter_simple',  // Uses existing simple adapter
        description: 'Spot crypto trading, high liquidity',
        features: ['spot', 'margin', 'staking'],
        supported: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'],
        fees: { maker: 0.0016, taker: 0.0026 },
        timeframe: 'realtime'
    },

    coinbase: {
        name: 'Coinbase',
        assetType: 'crypto',
        filePath: './CoinbaseAdapter',
        description: 'Spot crypto with 100+ pairs',
        features: ['spot', 'advanced-orders'],
        supported: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
        fees: { maker: 0.004, taker: 0.006 },
        timeframe: 'realtime'
    },

    binance: {
        name: 'Binance',
        assetType: 'crypto',
        filePath: './BinanceAdapter',
        description: 'Largest crypto exchange - spot & futures',
        features: ['spot', 'margin', 'futures', 'options'],
        supported: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT'],
        fees: { maker: 0.001, taker: 0.001 },
        timeframe: 'realtime'
    },

    // =========================================================================
    // STOCK BROKERS
    // =========================================================================

    interactivebrokers: {
        name: 'Interactive Brokers',
        assetType: 'stocks',
        filePath: './InteractiveBrokersAdapter',
        description: 'Full market access: stocks, options, futures, forex',
        features: ['stocks', 'options', 'futures', 'forex', 'bonds'],
        supported: ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN'],
        fees: { perShare: 0.001, minimum: 1 },
        timeframe: '930-1600 EST'
    },

    tdameritrade: {
        name: 'TD Ameritrade',
        assetType: 'stocks',
        filePath: './TDAmeritradeAdapter',  // TODO: Create
        description: 'Popular US stock broker',
        features: ['stocks', 'options', 'margin'],
        supported: ['AAPL', 'GOOGL', 'MSFT'],
        fees: { commission: 0 },
        timeframe: '930-1600 EST'
    },

    schwab: {
        name: 'Schwab',
        assetType: 'stocks',
        filePath: './SchwabAdapter',  // TODO: Create
        description: 'Commission-free stock trading',
        features: ['stocks', 'etf', 'options'],
        supported: ['AAPL', 'GOOGL', 'MSFT'],
        fees: { commission: 0 },
        timeframe: '930-1600 EST'
    },

    fidelity: {
        name: 'Fidelity',
        assetType: 'stocks',
        filePath: './FidelityAdapter',  // TODO: Create
        description: 'Full-service stock broker',
        features: ['stocks', 'options', 'bonds'],
        supported: ['AAPL', 'GOOGL', 'MSFT'],
        fees: { commission: 0 },
        timeframe: '930-1600 EST'
    },

    // =========================================================================
    // OPTIONS BROKERS
    // =========================================================================

    tastyworks: {
        name: 'Tastyworks',
        assetType: 'options',
        filePath: './TastyworksAdapter',
        description: 'Options-focused broker with advanced tools',
        features: ['options', 'spreads', 'iron-condors', 'stocks'],
        supported: ['SPY', 'QQQ', 'AAPL', 'TSLA'],
        fees: { perContract: 0.65 },
        timeframe: '930-1600 EST'
    },

    // =========================================================================
    // FOREX BROKERS
    // =========================================================================

    oanda: {
        name: 'OANDA',
        assetType: 'forex',
        filePath: './OandaAdapter',
        description: 'Forex and CFD trading with tight spreads',
        features: ['forex', 'cfd', 'commodities', 'indices'],
        supported: ['EUR/USD', 'GBP/USD', 'USD/JPY'],
        fees: { spread: 0.0002 },
        timeframe: '24/5'
    },

    fxcm: {
        name: 'FXCM',
        assetType: 'forex',
        filePath: './FXCMAdapter',  // TODO: Create
        description: 'Forex and CFD broker',
        features: ['forex', 'cfd'],
        supported: ['EUR/USD', 'GBP/USD'],
        fees: { spread: 0.0003 },
        timeframe: '24/5'
    },

    // =========================================================================
    // FUTURES BROKERS
    // =========================================================================

    cme: {
        name: 'CME (Chicago Mercantile Exchange)',
        assetType: 'futures',
        filePath: './CMEAdapter',
        description: 'E-mini S&P 500, Nasdaq, oil, gold futures',
        features: ['futures', 'options-on-futures'],
        supported: ['ES', 'NQ', 'CL', 'GC', 'SI'],
        fees: { perContract: 2.25 },
        timeframe: '24/5 Globex'
    },

    ice: {
        name: 'ICE',
        assetType: 'futures',
        filePath: './ICEAdapter',  // TODO: Create
        description: 'Energy, metals, agriculture futures',
        features: ['futures', 'options-on-futures'],
        supported: ['BRN', 'RBOB', 'SB', 'CT'],
        fees: { perContract: 2.5 },
        timeframe: '24/5'
    },

    // =========================================================================
    // SPECIALIZED
    // =========================================================================

    bybit: {
        name: 'Bybit',
        assetType: 'crypto',
        filePath: './BinanceAdapter',  // Can reuse - compatible API
        description: 'Crypto derivatives exchange',
        features: ['perpetuals', 'options'],
        supported: ['BTC/USDT', 'ETH/USDT'],
        fees: { maker: 0.0001, taker: 0.0002 },
        timeframe: 'realtime'
    },

    deribit: {
        name: 'Deribit',
        assetType: 'crypto',
        filePath: './DeribitAdapter',  // TODO: Create
        description: 'Crypto options specialist',
        features: ['options', 'perpetuals'],
        supported: ['BTC', 'ETH'],
        fees: { maker: 0.0005, taker: 0.0005 },
        timeframe: 'realtime'
    }
};

/**
 * Get all brokers
 */
function getAllBrokers() {
    return Object.entries(BrokerRegistry).map(([key, value]) => ({
        id: key,
        ...value
    }));
}

/**
 * Get brokers by asset type
 */
function getBrokersByAssetType(assetType) {
    return Object.entries(BrokerRegistry)
        .filter(([_, broker]) => broker.assetType === assetType)
        .map(([key, value]) => ({
            id: key,
            ...value
        }));
}

/**
 * Get broker info
 */
function getBrokerInfo(brokerName) {
    const broker = BrokerRegistry[brokerName.toLowerCase()];
    if (!broker) {
        return null;
    }
    return {
        id: brokerName.toLowerCase(),
        ...broker
    };
}

/**
 * Check if adapter file exists and is implemented
 */
function isImplemented(brokerName) {
    const broker = BrokerRegistry[brokerName.toLowerCase()];
    if (!broker) return false;

    try {
        require(broker.filePath);
        return true;
    } catch (error) {
        return false;
    }
}

module.exports = {
    BrokerRegistry,
    getAllBrokers,
    getBrokersByAssetType,
    getBrokerInfo,
    isImplemented
};
```

---

## 3. run-empire-v2.js (Key Sections)
Location: /opt/ogzprime/OGZPMLV2/run-empire-v2.js

```javascript
#!/usr/bin/env node

/**
 * OGZ PRIME V14 - FINAL MERGED REFACTORED ORCHESTRATOR
 * =====================================================
 * Combines Desktop Claude's 402-line structure with Browser Claude's 439-line AdvancedExecutionLayer
 * Clean modular architecture with zero inline logic
 *
 * MERGED FROM:
 * - Desktop Claude: 402-line orchestrator structure (Change 561)
 * - Browser Claude: 439-line AdvancedExecutionLayer (Change 513 compliant, commits d590022 + 84a2544)
 *
 * Architecture: Pure orchestration pipeline
 * ├── Pattern Recognition → Market opportunity detection
 * ├── Trading Brain → Confidence & position sizing
 * ├── Risk Manager → Pre-trade risk assessment
 * ├── Advanced Execution → Trade execution (439-line merged version)
 * └── Performance → Analytics & dashboard updates
 *
 * @version 14.0.0-FINAL-MERGED
 * @date 2025-11-20
 */

// CRITICAL: Load environment variables FIRST before any module loads
require('dotenv').config();
console.log('[CHECKPOINT-001] Environment loaded');

// Load feature flags configuration
let featureFlags = {};
try {
  featureFlags = require('./config/features.json');
  console.log('[FEATURES] Loaded feature flags:', Object.keys(featureFlags.features).filter(f => featureFlags.features[f].enabled));
} catch (err) {
  console.log('[FEATURES] No feature flags config found, using defaults');
  featureFlags = { features: {}, environment: {} };
}

// Add uncaught exception handler to catch silent failures
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  console.error('Stack:', err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// CRITICAL: ModuleAutoLoader as single source of truth
console.log('[CHECKPOINT-002] Loading ModuleAutoLoader...');
const loader = require('./core/ModuleAutoLoader');
console.log('[CHECKPOINT-003] ModuleAutoLoader ready');

// Load all modules through loader
loader.loadAll();
console.log('[CHECKPOINT-004] All modules loaded');

// CHANGE 2025-12-11: Trading optimizations for visibility and pattern-based sizing
const { TradingOptimizations, PatternStatsManager } = require('./core/TradingOptimizations');
const patternStatsManager = new PatternStatsManager();
const tradingOptimizations = new TradingOptimizations(patternStatsManager, console);

// CHANGE 2025-12-11: StateManager - Single source of truth for position/balance
const { getInstance: getStateManager } = require('./core/StateManager');
const stateManager = getStateManager();

// CHANGE 2025-12-11: MessageQueue - Prevent WebSocket race conditions
const MessageQueue = require('./core/MessageQueue');

// CRITICAL: SingletonLock to prevent multiple instances
console.log('[CHECKPOINT-005] Getting SingletonLock...');
const SingletonLock = loader.get('core', 'SingletonLock') || require('./core/SingletonLock');
const { OGZSingletonLock, checkCriticalPorts } = SingletonLock;
console.log('[CHECKPOINT-006] SingletonLock obtained');
const singletonLock = new OGZSingletonLock('ogz-prime-v14');

// Acquire lock IMMEDIATELY (will exit if another instance is running)
(async () => {
  singletonLock.acquireLock();
  // Skip port check in backtest mode for faster testing
  if (process.env.BACKTEST_MODE !== 'true') {
    // CHANGE 660: Remove port 3010 from check - it's the WebSocket SERVER we connect TO
    // Bot is a CLIENT of 3010, not binding it
    const portsOk = await checkCriticalPorts([3001, 3002, 3003]);
    if (!portsOk) {
      console.error('🚨 Critical ports in use! Exiting...');
      process.exit(1);
    }
  }
})();
const WebSocket = require('ws');

// Core Trading Modules - All through ModuleAutoLoader
console.log('[CHECKPOINT-007] Loading core modules...');
const EnhancedPatternRecognition = loader.get('core', 'EnhancedPatternRecognition');
console.log('  EnhancedPatternRecognition:', !!EnhancedPatternRecognition);
const { EnhancedPatternChecker } = EnhancedPatternRecognition || {};

const OptimizedTradingBrainModule = loader.get('core', 'OptimizedTradingBrain');
console.log('  OptimizedTradingBrain:', !!OptimizedTradingBrainModule);
const { OptimizedTradingBrain } = OptimizedTradingBrainModule || {};

const RiskManager = loader.get('core', 'RiskManager');
console.log('  RiskManager:', !!RiskManager);
const ExecutionRateLimiter = loader.get('core', 'ExecutionRateLimiter');
console.log('  ExecutionRateLimiter:', !!ExecutionRateLimiter);
const AdvancedExecutionLayer = loader.get('core', 'AdvancedExecutionLayer-439-MERGED');
console.log('  AdvancedExecutionLayer:', !!AdvancedExecutionLayer);
const PerformanceAnalyzer = loader.get('core', 'PerformanceAnalyzer');
const OptimizedIndicators = loader.get('core', 'OptimizedIndicators');
const MarketRegimeDetector = loader.get('core', 'MarketRegimeDetector');
const TradingProfileManager = loader.get('core', 'TradingProfileManager');
const GridTradingStrategy = loader.get('core', 'GridTradingStrategy');

// Change 587: Wire SafetyNet and TradeLogger into live loop
// Both removed - SafetyNet too restrictive, TradeLogger doesn't exist
// const TradingSafetyNet = require('./core/TradingSafetyNet');
// const TradeLogger = require('./core/TradeLogger');

// 🤖 AI Co-Founder (Change 574 - Opus Architecture + Codex Fix)
const TRAIDecisionModule = loader.get('core', 'TRAIDecisionModule');

// Infrastructure
const KrakenAdapterSimple = require('./kraken_adapter_simple'); // Keep direct - not in modules
const TierFeatureFlags = require('./TierFeatureFlags'); // Keep direct - in root not core
const OgzTpoIntegration = loader.get('core', 'OgzTpoIntegration');

/**
 * Main Trading Bot Orchestrator
 * Coordinates all modules for production trading
 */
class OGZPrimeV14Bot {
  constructor() {
    console.log('\n🚀 OGZ PRIME V14 FINAL MERGED - INITIALIZING');
    console.log('📊 Desktop Claude (402-line) + Browser Claude (439-line) = MERGED');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    // Environment validation
    this.validateEnvironment();

    // TWO-KEY TURN SAFETY: Require double confirmation for live trading
    this.verifyTradingMode();

    // Tier configuration
    this.tier = process.env.BOT_TIER || 'ml';
    this.tierFlagManager = new TierFeatureFlags(this.tier);
    this.tierFlags = this.tierFlagManager.getTierSummary();
    console.log(`🎯 Tier: ${this.tier.toUpperCase()}`);

    // Initialize core modules
    console.log('[CHECKPOINT-008] Creating pattern checker...');
    if (!EnhancedPatternChecker) {
      console.error('❌ EnhancedPatternChecker is undefined! Module loading failed.');
      process.exit(1);
    }
    this.patternChecker = new EnhancedPatternChecker();
    console.log('[CHECKPOINT-009] EnhancedPatternChecker created');

    // Initialize OGZ Two-Pole Oscillator (pure function implementation from V2)
    this.ogzTpo = this.tierFlagManager.isEnabled('ogzTpoEnabled')
      ? OgzTpoIntegration.fromTierFlags(this.tierFlagManager)
      : null;

    if (this.ogzTpo) {
      console.log('🎯 OGZ TPO initialized with mode:', this.tierFlagManager.getValue('ogzTpoMode'));
    }

    // CHANGE 665: Initialize TradingProfileManager for manual profile switching
    // AUTO-SWITCHING DISABLED - profiles are user-controlled only
    this.profileManager = new TradingProfileManager({
      defaultProfile: process.env.TRADING_PROFILE || 'balanced',
      autoSwitch: false  // DISABLED - user must manually switch profiles
    });

    // Set initial profile based on environment or default
    const initialProfile = process.env.TRADING_PROFILE || 'balanced';
    this.profileManager.setActiveProfile(initialProfile);
    console.log(`📊 Trading Profile: ${initialProfile.toUpperCase()} (manual switching only)`);

    // CHANGE 610: Centralized configuration - all trading params from .env
    // Profile settings are for reference only - env vars take precedence
    const tradingBrainConfig = {
      // Tier settings
      enableQuantumSizing: this.tierFlags.hasQuantumPositionSizer,
      tier: this.tier,

      // Phase 1: High-priority risk management (env vars ONLY)
      minConfidenceThreshold: parseFloat(process.env.MIN_TRADE_CONFIDENCE) || 0.08,
      maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE) || 0.02,
      stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 0.02,
      takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT) || 0.04,
      trailingStopPercent: parseFloat(process.env.TRAILING_STOP_PERCENT) || 0.035,
      trailingStopActivation: parseFloat(process.env.TRAILING_ACTIVATION) || 0.025,
      profitProtectionLevel: parseFloat(process.env.PROFIT_PROTECTION) || 0.015,
      breakevenTrigger: parseFloat(process.env.BREAKEVEN_TRIGGER) || 0.005,
      breakevenPercentage: parseFloat(process.env.BREAKEVEN_EXIT_PERCENT) || 0.50,
      postBreakevenTrailing: parseFloat(process.env.POST_BREAKEVEN_TRAIL) || 0.05,

      // Phase 1: High-priority position sizing
      basePositionSize: parseFloat(process.env.BASE_POSITION_SIZE) || 0.01,
      maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE_PCT) || 0.05,
      lowVolatilityMultiplier: parseFloat(process.env.LOW_VOL_MULTIPLIER) || 1.5,
      highVolatilityMultiplier: parseFloat(process.env.HIGH_VOL_MULTIPLIER) || 0.6,
      volatilityThresholds: {
        low: parseFloat(process.env.LOW_VOL_THRESHOLD) || 0.015,
        high: parseFloat(process.env.HIGH_VOL_THRESHOLD) || 0.035
      },

      // Phase 1: Confidence thresholds
      maxConfidenceThreshold: parseFloat(process.env.MAX_CONFIDENCE) || 0.95,
      confidencePenalty: parseFloat(process.env.CONFIDENCE_PENALTY) || 0.1,
      confidenceBoost: parseFloat(process.env.CONFIDENCE_BOOST) || 0.05,

      // Phase 1: Fund target
      houstonFundTarget: parseFloat(process.env.FUND_TARGET) || 25000
    };

    // Pass feature flags to TradingBrain
    tradingBrainConfig.featureFlags = featureFlags.features || {};
    tradingBrainConfig.patternDominance = featureFlags.features.PATTERN_DOMINANCE?.enabled || false;

    this.tradingBrain = new OptimizedTradingBrain(
      parseFloat(process.env.INITIAL_BALANCE) || 10000,
      tradingBrainConfig
    );
    this.riskManager = new RiskManager({
      maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS) || 0.05,
      maxDrawdown: parseFloat(process.env.MAX_DRAWDOWN) || 0.15
    });

    // Use Browser Claude's merged AdvancedExecutionLayer (Change 513 compliant)
    this.executionLayer = new AdvancedExecutionLayer({
      bot: this,
      botTier: this.tier,
      sandboxMode: process.env.ENABLE_LIVE_TRADING !== 'true',
      enableRiskManagement: true,
      initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 10000,
      paperTrading: featureFlags.features.PAPER_TRADING?.enabled || false,
      featureFlags: featureFlags.features || {}
    });

    this.performanceAnalyzer = new PerformanceAnalyzer();
    this.regimeDetector = new MarketRegimeDetector();

    // Initialize Pattern Exit Model (shadow mode by default)
    this.patternExitModel = null;
    if (featureFlags.features.PATTERN_EXIT_MODEL?.enabled) {
      const PatternBasedExitModel = require('./core/PatternBasedExitModel');
      this.patternExitModel = new PatternBasedExitModel(featureFlags.features.PATTERN_EXIT_MODEL.settings || {});
      this.patternExitShadowMode = featureFlags.features.PATTERN_EXIT_MODEL.shadowMode !== false;
      console.log(`🎯 Pattern Exit Model: ${this.patternExitShadowMode ? 'SHADOW MODE' : 'ACTIVE'}`);
    }

    // CHANGE 670: Initialize Grid Trading Strategy
    this.gridStrategy = null; // Initialize on demand based on strategy mode
    if (process.env.ENABLE_GRID_BOT === 'true') {
      this.gridStrategy = new GridTradingStrategy({
        gridLevels: parseInt(process.env.GRID_LEVELS) || 10,
        gridSpacing: parseFloat(process.env.GRID_SPACING) || 0.002,  // 0.2% default
        orderSize: parseFloat(process.env.GRID_ORDER_SIZE) || 100,
        autoRange: process.env.GRID_AUTO_RANGE !== 'false'
      });
      console.log('🎯 Grid Trading Mode ENABLED');
    }

    // CHANGE 657: Aggressive trading rate limiter (fixed for 8% confidence)
    this.rateLimiter = new ExecutionRateLimiter({
      entryCooldownMs: 5000,        // 5 seconds between entries (was 60 seconds)
      maxEntriesPerWindow: 100,     // 100 entries per window (was 5)
      windowMs: 300000,             // 5 minute window (was 10 minutes)
      burstAllowed: 10              // allow 10 rapid trades (was 2)
    });

    // 🤖 TRAI DECISION MODULE (Change 574 - Opus Architecture + Codex Fix)
    // OPTIMIZECEPTION FIX: Skip TRAI initialization when ENABLE_TRAI=false (4x faster backtests)
    if (process.env.ENABLE_TRAI !== 'false') {
      this.trai = new TRAIDecisionModule({
        mode: process.env.TRAI_MODE || 'advisory',  // Start conservative
        confidenceWeight: parseFloat(process.env.TRAI_WEIGHT) || 0.2,  // 20% influence
        enableVetoPower: process.env.TRAI_VETO === 'true',  // Disabled by default
        maxRiskTolerance: parseFloat(process.env.TRAI_MAX_RISK) || 0.03,
        minConfidenceOverride: parseFloat(process.env.TRAI_MIN_CONF) || 0.40,
        maxConfidenceOverride: parseFloat(process.env.TRAI_MAX_CONF) || 0.95,
        enableLLM: true  // Full AI reasoning enabled
      });
    } else {
      this.trai = null;  // TRAI disabled for fast optimization runs
      console.log('⚡ TRAI disabled for fast backtest mode');
    }

    // 🔥 CRITICAL FIX (Change 547): Connect modules to TradingBrain
    // Without these connections, confidence calculation fails (stuck at 10-35%)
    this.tradingBrain.optimizedIndicators = OptimizedIndicators;
    this.tradingBrain.marketRegimeDetector = this.regimeDetector;
    this.tradingBrain.patternRecognition = this.patternChecker;

    // Change 587: SafetyNet and TradeLogger removed
    // SafetyNet was too restrictive, blocking legitimate trades
    // TradeLogger module doesn't exist in codebase

// ... (middle sections omitted for brevity)

// KEY WEBSOCKET CONNECTION CODE (lines 490-550)
   * Initialize Dashboard WebSocket connection (Change 528)
   * OPTIONAL - only connects if WS_HOST is set
   */
  initializeDashboardWebSocket() {
    // Bot connects locally on port 3010 with /ws path (ogzprime-ssl-server)
    const wsUrl = process.env.WS_URL || 'ws://localhost:3010/ws';

    console.log(`\n📊 Connecting to Dashboard WebSocket at ${wsUrl}...`);

    try {
      this.dashboardWs = new WebSocket(wsUrl);

      this.dashboardWs.on('open', () => {
        console.log('✅ Dashboard WebSocket connected!');
        this.dashboardWsConnected = true;

        // 🔒 SECURITY (Change 582): Authenticate first before sending any data
        const authToken = process.env.WEBSOCKET_AUTH_TOKEN || 'CHANGE_ME_IN_PRODUCTION';
        if (!authToken || authToken === 'CHANGE_ME_IN_PRODUCTION') {
          console.error('⚠️ WEBSOCKET_AUTH_TOKEN not set in .env - using default token');
        }

        this.dashboardWs.send(JSON.stringify({
          type: 'auth',
          token: authToken
        }));
        console.log('🔐 Sent authentication to dashboard');

        // DON'T send identify here - wait for auth_success message
      });

      this.dashboardWs.on('error', (error) => {
        console.error('⚠️ Dashboard WebSocket error:', error.message);
        this.dashboardWsConnected = false;
      });

      this.dashboardWs.on('close', () => {
        console.log('⚠️ Dashboard WebSocket closed - reconnecting in 5s...');
        this.dashboardWsConnected = false;
        if (this.isRunning) {
          setTimeout(() => this.initializeDashboardWebSocket(), 5000);
        }
      });

      this.dashboardWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // Handle authentication success
          if (msg.type === 'auth_success') {
            console.log('🔓 Dashboard authentication successful!');

            // Now send identify message after successful auth
            this.dashboardWs.send(JSON.stringify({
              type: 'identify',
              source: 'trading_bot',
              bot: 'ogzprime-v14-refactored',
              version: 'V14-REFACTORED-MERGED',
              capabilities: ['trading', 'realtime', 'risk-management']
            }));



// KEY MARKET DATA HANDLER (lines 650-750)

        // EVENT LOOP MONITORING: Start monitoring for freezes
        console.log('⚡ Starting event loop monitoring...');
        this.eventLoopMonitor.start();
        console.log('✅ Event loop monitor active');

        // Start trading cycle
        this.startTradingCycle();

        console.log('✅ Bot is now LIVE and trading\n');
      }
    } catch (error) {
      console.error('❌ Startup failed:', error.message);
      await this.shutdown();
    }
  }

  /**
   * Connect to Kraken WebSocket for real-time market data
   */
  async connectToMarketData() {
    return new Promise((resolve, reject) => {
      console.log('📡 Connecting to Kraken WebSocket...');

      this.ws = new WebSocket('wss://ws.kraken.com');

      this.ws.on('open', () => {
        console.log('✅ Connected to Kraken WebSocket');

        // Subscribe to BTC/USD OHLC (1-minute candles) instead of ticker
        // This gives us proper OHLC data instead of daily aggregates
        this.ws.send(JSON.stringify({
          event: 'subscribe',
          pair: ['XBT/USD'],
          subscription: { name: 'ohlc', interval: 1 }  // 1-minute candles
        }));

        // Connect WebSocket to execution layer
        this.executionLayer.setWebSocketClient(this.ws);

        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);

          // Debug: Log first 5 messages to understand all message types
          if (this.ohlcDebugCount < 5) {
            console.log(`📊 Kraken msg #${this.ohlcDebugCount + 1}:`, JSON.stringify(msg).substring(0, 300));
            this.ohlcDebugCount++;
          }

          // Handle system messages (subscription confirmations, heartbeats, etc.)
          if (msg.event) {
            if (msg.event === 'subscriptionStatus') {
              console.log('✅ Kraken subscription confirmed:', msg.subscription?.name, msg.pair);
            }
            return; // System messages don't contain OHLC data
          }

          // Kraken OHLC format: [channelID, [ohlc data], "ohlc-1", "XBT/USD"]
          if (Array.isArray(msg) && msg.length >= 4) {
            const channelType = msg[2];

            if (channelType && channelType.startsWith('ohlc')) {
              const ohlcArray = msg[1];
              if (Array.isArray(ohlcArray) && ohlcArray.length >= 8) {
                // CHANGE 2025-12-11: Queue messages to prevent race conditions
                // Old: this.handleMarketData(ohlcArray) - direct processing caused out-of-order execution
                this.messageQueue.add(ohlcArray);
              } else {
                console.warn('⚠️ Unexpected OHLC array format:', ohlcArray);
              }
            }
          }
        } catch (err) {
          console.error('❌ Error parsing WebSocket message:', err.message);
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('⚠️ WebSocket closed - attempting reconnect...');
        if (this.isRunning) {
          setTimeout(() => this.connectToMarketData(), 5000);
        }
      });
    });
  }

  /**
   * Handle incoming market data from WebSocket
   * Kraken OHLC format: [channelID, [time, etime, open, high, low, close, vwap, volume, count], channelName, pair]
   */
  handleMarketData(ohlcData) {
    console.log(`🔍 [CANDLE-DEBUG] handleMarketData called, priceHistory length: ${this.priceHistory.length}`);
```

---

## 4. ogzprime-ssl-server.js (WebSocket Server)
Location: /opt/ogzprime/OGZPMLV2/ogzprime-ssl-server.js

```javascript
/**
 * ===================================================================
 * 🚀 OGZ PRIME SSL SERVER - KRAKEN INTEGRATION
 * ===================================================================
 * Direct Kraken WebSocket connection for real-time crypto data
 * No complicated broadcaster - simple direct data flow
 * ===================================================================
 */

require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const apiPort = process.env.API_PORT || 3010;
const app = express();
const httpServer = http.createServer(app);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// HTTPS server removed - nginx handles SSL termination
// All connections come through nginx proxy on port 3010

// Single WebSocket server on unified port
const wss = new WebSocket.Server({ 
  server: httpServer,
  path: '/ws'  // Optional: use path-based routing
});

wss.on('connection', (ws, req) => {
  // Simple connection tracking - NO OVERCOMPLICATED BROADCASTER
  const connectionId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  ws.connectionId = connectionId;
  ws.isAlive = true;
  ws.authenticated = false; // 🔒 SECURITY: Require authentication

  console.log(`✅ New WebSocket connection: ${connectionId}`);

  // 🔒 SECURITY: 10-second authentication timeout
  const authTimeout = setTimeout(() => {
    if (!ws.authenticated) {
      console.log(`❌ Client ${connectionId} failed to authenticate - disconnecting`);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Authentication timeout - connection closed'
      }));
      ws.close(1008, 'Authentication timeout');
    }
  }, 10000);

  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      // 🔒 SECURITY: First message MUST be authentication
      if (!ws.authenticated && data.type !== 'auth') {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Authentication required'
        }));
        ws.close(1008, 'Authentication required');
        return;
      }

      // 🔒 SECURITY: Handle authentication
      if (data.type === 'auth') {
        const validToken = process.env.WEBSOCKET_AUTH_TOKEN || 'CHANGE_ME_IN_PRODUCTION';

        if (data.token === validToken) {
          ws.authenticated = true;
          clearTimeout(authTimeout);
          console.log(`🔓 Client ${connectionId} authenticated successfully`);
          ws.send(JSON.stringify({
            type: 'auth_success',
            connectionId: connectionId,
            message: 'Authentication successful'
          }));
        } else {
          console.log(`❌ Client ${connectionId} failed authentication - invalid token`);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid authentication token'
          }));
          ws.close(1008, 'Invalid token');
        }
        return;
      }

      // CRITICAL: Handle ping/pong for connection health
      if (data.type === 'ping') {
        ws.send(JSON.stringify({
          type: 'pong',
          id: data.id,
          timestamp: data.timestamp || Date.now()
        }));
        return;
      }

      if (data.type === 'pong') {
        ws.isAlive = true;
        return;
      }

      // Handle bot identification
      if (data.type === 'identify' && data.source === 'trading_bot') {
        console.log('🤖 TRADING BOT IDENTIFIED!');
        ws.clientType = 'bot';

        ws.send(JSON.stringify({
          type: 'identification_confirmed',
          connectionId: connectionId,
          message: 'Bot registered successfully'
        }));
      }

      // Handle dashboard identification
      if (data.type === 'identify' && data.source === 'dashboard') {
        console.log('📊 DASHBOARD IDENTIFIED!');
        ws.clientType = 'dashboard';
      }
      
    } catch (err) {
      console.error(`Error parsing message from ${connectionId}:`, err.message);
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    console.log(`❌ Client disconnected: ${connectionId}`);
  });
  
  ws.on('error', (err) => {
    console.error(`WebSocket error for ${connectionId}:`, err.message);
  });
});

// Market data variables
let lastKnownPrice = null;
let tickCount = 0;
let assetPrices = {};
let currentAsset = 'BTC-USD';

// � Kraken WebSocket connection (PUBLIC - no API key needed for market data!)
const KRAKEN_PUBLIC_WS = 'wss://ws.kraken.com';

console.log('🐙 Using Kraken public WebSocket for market data (no API key required)');

const krakenSocket = new WebSocket(KRAKEN_PUBLIC_WS);

krakenSocket.on('open', () => {
  console.log('� Connected to Kraken public WebSocket feed');
  
  // Subscribe to multiple crypto pairs on Kraken
  const pairs = [
    'XBT/USD',  // Bitcoin (Kraken uses XBT)
    'ETH/USD',  // Ethereum
    'SOL/USD',  // Solana
    'ADA/USD',  // Cardano
    'DOGE/USD', // Dogecoin
    'XRP/USD',  // Ripple
    'LTC/USD',  // Litecoin
    'MATIC/USD',// Polygon/Matic
    'AVAX/USD', // Avalanche
    'LINK/USD', // Chainlink
    'DOT/USD',  // Polkadot
    'ATOM/USD', // Cosmos
    'UNI/USD',  // Uniswap
    'AAVE/USD', // Aave
    'ALGO/USD', // Algorand
  ];
  
  // Kraken subscription format
  krakenSocket.send(JSON.stringify({
    event: 'subscribe',
    pair: pairs,
    subscription: {
      name: 'ticker'
    }
  }));
  
  console.log(`📡 Subscribed to ${pairs.length} trading pairs on Kraken`);
});

krakenSocket.on('message', (data) => {
  try {
    const msg = JSON.parse(data);
    
    // Kraken sends different message types
    // Array messages are ticker updates: [channelID, tickerData, channelName, pair]
    if (Array.isArray(msg) && msg.length >= 4 && msg[2] === 'ticker') {
      tickCount++;
      
      const tickerData = msg[1];
      const pair = msg[3];
      
      // Extract price from Kraken ticker data
      // tickerData.c = [price, lot volume]
      const price = parseFloat(tickerData.c[0]);
      
      // Convert Kraken pair format to our format
      // XBT/USD -> BTC-USD, ETH/USD -> ETH-USD, etc.
      let asset = pair.replace('XBT/', 'BTC-').replace('/', '-');
      
      // Store price
      assetPrices[asset] = price;
      if (asset === currentAsset || asset === 'BTC-USD') {
        lastKnownPrice = price;
      }

      // Log periodically
      if (tickCount % 10 === 0 || tickCount <= 5) {
        console.log(`🎯 KRAKEN TICK #${tickCount}: ${asset} $${price.toFixed(2)} @ ${new Date().toLocaleTimeString()}`);
      }

      // 🚀 SIMPLE DIRECT BROADCAST - NO OVERCOMPLICATED BROADCASTER
      const priceMessage = {
        type: 'price',
        data: {
          asset: asset,
          price: price,
          timestamp: Date.now(),
          source: 'kraken',
          allPrices: assetPrices,
          tickCount: tickCount,
          volume: parseFloat(tickerData.v[0]) || 0
        }
      };
      
      // Broadcast to ALL connected WebSocket clients
      const messageStr = JSON.stringify(priceMessage);
      let sentCount = 0;
      
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(messageStr);
            sentCount++;
          } catch (err) {
            console.error('Error sending to client:', err.message);
          }
        }
      });
      
      // Log broadcast results periodically
      if (sentCount > 0 && tickCount % 20 === 0) {
        console.log(`📡 Kraken price broadcast: ${asset} $${price.toFixed(2)} → ${sentCount} clients`);
      }
    }
    
    // Handle subscription status messages
    if (msg.event === 'subscriptionStatus') {
      console.log(`📊 Kraken subscription: ${msg.status} - ${msg.pair || 'multiple pairs'}`);
    }
    
    // Handle system status
    if (msg.event === 'systemStatus') {
      console.log(`🐙 Kraken system status: ${msg.status}`);
    }
    
  } catch (err) {
    // Ignore heartbeat messages and other non-JSON data
    if (!data.toString().includes('heartbeat')) {
      console.error('❌ Failed to process Kraken data:', err.message);
    }
  }
});

krakenSocket.on('close', () => {
  console.warn('⚠️ Kraken WebSocket disconnected - attempting reconnect...');
  
  // Broadcast disconnection to all clients
  const disconnectMessage = JSON.stringify({
    type: 'data_feed_status',
    status: 'disconnected',
    message: 'Kraken data feed disconnected',
    timestamp: Date.now()
  });
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(disconnectMessage);
      } catch (err) {
        console.error('Error broadcasting disconnect:', err.message);
      }
    }
  });
  
  // Auto-reconnect after 5 seconds
  setTimeout(() => {
    console.log('🔄 Reconnecting to Kraken...');
    // In production, you'd reinitialize the connection here
  }, 5000);
});

krakenSocket.on('error', (err) => {
  console.error('🚨 Kraken WebSocket error:', err.message);
});

// 📊 Enhanced status monitoring
setInterval(() => {
  const connectedClients = Array.from(wss.clients).filter(c => c.readyState === WebSocket.OPEN);
  const botClients = connectedClients.filter(c => c.clientType === 'bot');
  
  console.log(`📊 SYSTEM STATUS:`);
  console.log(`   � Kraken: ${krakenSocket.readyState === WebSocket.OPEN ? 'Connected ✅' : 'Disconnected ❌'}`);
  console.log(`   📊 Ticks: ${tickCount}`);
  console.log(`   💰 Last Price: $${lastKnownPrice ? lastKnownPrice.toFixed(2) : 'N/A'}`);
  console.log(`   👥 Total Connections: ${connectedClients.length}`);
  console.log(`   🤖 Bot Connections: ${botClients.length}`);
  console.log(`   📡 Assets tracked: ${Object.keys(assetPrices).length}`);
  
  // Alert if no bot connections
  if (botClients.length === 0) {
    console.warn('⚠️ WARNING: No trading bot connections detected!');
  }
  
}, 30000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down SSL server...');

  // Close all WebSocket connections
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close();
    }
  });

  if (krakenSocket.readyState === WebSocket.OPEN) {
    krakenSocket.close();
  }

  httpServer.close(() => {
    console.log('✅ Server shutdown complete');
    process.exit(0);
  });
});

// CRITICAL FIX: Actually start listening on the port!
const wsPort = process.env.WS_PORT || 3010;
httpServer.listen(wsPort, '0.0.0.0', () => {
  console.log(`🚀 WebSocket server ACTUALLY LISTENING on port ${wsPort}`);
  console.log(`📡 Dashboard can now connect to ws://localhost:${wsPort}/ws`);
});

// Network interfaces display
const os = require('os');
const networkInterfaces = os.networkInterfaces();
const localIPs = [];

Object.keys(networkInterfaces).forEach(interfaceName => {
  networkInterfaces[interfaceName].forEach(interface => {
    if (interface.family === 'IPv4' && !interface.internal) {
      localIPs.push(interface.address);
    }
  });
});```

---

## END OF CONTEXT PACK

This pack contains:
1. The complete IBroker interface that all brokers must implement
2. The BrokerRegistry with all configured brokers
3. Key sections from run-empire-v2.js showing initialization and market data handling
4. The complete WebSocket server that handles real-time data distribution

Use this for implementing the full Empire V2 architecture with proper broker abstraction and real-time data flow.
