/**
 * @fileoverview IBrokerAdapter - Universal Broker Interface
 *
 * Abstract base class that ALL broker adapters must extend.
 * Enables multi-broker support with a unified API.
 *
 * @description
 * ARCHITECTURE ROLE:
 * IBrokerAdapter is the foundation of multi-broker architecture.
 * Any exchange/broker (Kraken, Binance, IBKR, etc.) can be integrated
 * by implementing this interface.
 *
 * SUPPORTED ASSET TYPES:
 * - Crypto (Kraken, Binance, Coinbase)
 * - Stocks (Interactive Brokers, Alpaca)
 * - Options (Tastyworks, IBKR)
 * - Forex (Oanda)
 * - Futures (CME via IBKR)
 *
 * INTERFACE METHODS (must implement):
 * - connect() / disconnect() / isConnected()
 * - getBalance() / getPositions()
 * - placeOrder() / cancelOrder() / getOrderStatus()
 * - subscribeToMarketData() / unsubscribeFromMarketData()
 *
 * EVENTS (emit these):
 * - 'marketData' → { symbol, price, volume, timestamp }
 * - 'orderUpdate' → { orderId, status, filledQty, avgPrice }
 * - 'error' → Error object
 *
 * @module foundation/IBrokerAdapter
 * @extends EventEmitter
 * @abstract
 * @author OGZPrime Team
 * @version 1.0.0
 *
 * @example
 * class MyBrokerAdapter extends IBrokerAdapter {
 *   async connect() { ... }
 *   async placeOrder(symbol, side, qty, options) { ... }
 *   // ... implement all required methods
 * }
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

    // =========================================================================
    // BROKER CAPABILITIES (Override in adapters to reflect actual support)
    // =========================================================================

    /**
     * Get all broker capabilities at once
     * @returns {Object} Capability flags
     */
    getCapabilities() {
        return {
            fractionalShares: this.supportsFractionalShares(),
            extendedHours: this.supportsExtendedHours(),
            options: this.supportsOptions(),
            shortSelling: this.supportsShortSelling(),
            marketOrders: this.supportsMarketOrders(),
            limitOrders: this.supportsLimitOrders(),
            stopOrders: this.supportsStopOrders(),
            stopLimitOrders: this.supportsStopLimitOrders(),
            trailingStopOrders: this.supportsTrailingStopOrders(),
            streamingQuotes: this.supportsStreamingQuotes(),
            streamingTrades: this.supportsStreamingTrades(),
            paperTrading: this.supportsPaperTrading(),
            marginTrading: this.supportsMarginTrading(),
            cryptoTrading: this.supportsCryptoTrading(),
        };
    }

    /**
     * @returns {boolean} Whether broker supports fractional share trading
     */
    supportsFractionalShares() {
        return false; // Default: no fractional shares
    }

    /**
     * @returns {boolean} Whether broker supports extended hours (pre/after market)
     */
    supportsExtendedHours() {
        return false; // Default: regular hours only
    }

    /**
     * @returns {boolean} Whether broker supports options trading
     */
    supportsOptions() {
        return false;
    }

    /**
     * @returns {boolean} Whether broker supports short selling
     */
    supportsShortSelling() {
        return false;
    }

    /**
     * @returns {boolean} Whether broker supports market orders
     */
    supportsMarketOrders() {
        return true; // Most brokers support market orders
    }

    /**
     * @returns {boolean} Whether broker supports limit orders
     */
    supportsLimitOrders() {
        return true; // Most brokers support limit orders
    }

    /**
     * @returns {boolean} Whether broker supports stop orders
     */
    supportsStopOrders() {
        return true;
    }

    /**
     * @returns {boolean} Whether broker supports stop-limit orders
     */
    supportsStopLimitOrders() {
        return false;
    }

    /**
     * @returns {boolean} Whether broker supports trailing stop orders
     */
    supportsTrailingStopOrders() {
        return false;
    }

    /**
     * @returns {boolean} Whether broker supports real-time streaming quotes
     */
    supportsStreamingQuotes() {
        return false;
    }

    /**
     * @returns {boolean} Whether broker supports real-time streaming trades
     */
    supportsStreamingTrades() {
        return false;
    }

    /**
     * @returns {boolean} Whether broker has paper trading / sandbox mode
     */
    supportsPaperTrading() {
        return false;
    }

    /**
     * @returns {boolean} Whether broker supports margin trading
     */
    supportsMarginTrading() {
        return false;
    }

    /**
     * @returns {boolean} Whether broker supports crypto trading
     */
    supportsCryptoTrading() {
        return false;
    }
}

module.exports = IBrokerAdapter;
