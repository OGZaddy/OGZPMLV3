/**
 * ============================================================================
 * TastyworksAdapter - Universal Broker Adapter for Tastyworks
 * ============================================================================
 * 
 * Implements IBrokerAdapter for Tastyworks options trading
 * Supports: Options, spreads, multi-leg strategies, stocks
 * 
 * @author OGZPrime Team
 * @version 1.0.0
 * ============================================================================
 */

const IBrokerAdapter = require('../foundation/IBrokerAdapter');
const axios = require('axios');

class TastyworksAdapter extends IBrokerAdapter {
    constructor(config = {}) {
        super();
        this.config = config;
        this.username = config.username;
        this.password = config.password;
        this.baseUrl = 'https://api.tastyworks.com';
        this.token = null;
        this.connected = false;
        this.session = null;
    }

    // =========================================================================
    // CONNECTION MANAGEMENT
    // =========================================================================

    async connect() {
        try {
            // Authenticate
            const response = await axios.post(`${this.baseUrl}/sessions`, {
                login: this.username,
                password: this.password
            });

            this.token = response.data.data.session.token;
            this.session = response.data.data.session;
            this.connected = true;
            console.log('✅ Tastyworks adapter connected');
            return true;
        } catch (error) {
            console.error('❌ Tastyworks connection failed:', error.message);
            return false;
        }
    }

    async disconnect() {
        try {
            if (this.token) {
                await axios.delete(`${this.baseUrl}/sessions`, {
                    headers: {
                        'Authorization': this.token
                    }
                });
            }
        } catch (error) {
            console.warn('⚠️ Disconnect error:', error.message);
        }
        this.connected = false;
        this.token = null;
        console.log('🔌 Tastyworks adapter disconnected');
        return true;
    }

    isConnected() {
        return this.connected && this.token;
    }

    // =========================================================================
    // API HELPERS
    // =========================================================================

    async _apiCall(method, endpoint, data = null) {
        const config = {
            method,
            url: `${this.baseUrl}${endpoint}`,
            headers: {
                'Authorization': this.token,
                'Content-Type': 'application/json'
            }
        };

        if (data) {
            config.data = data;
        }

        try {
            const response = await axios(config);
            return response.data.data || response.data;
        } catch (error) {
            throw new Error(`API call failed: ${error.message}`);
        }
    }

    // =========================================================================
    // ACCOUNT INFO
    // =========================================================================

    async getBalance() {
        try {
            const accounts = await this._apiCall('GET', '/customers/me/accounts');
            if (!accounts || accounts.length === 0) {
                throw new Error('No accounts found');
            }

            const accountId = accounts[0].account.external_id;
            const balances = await this._apiCall('GET', `/accounts/${accountId}/balances`);

            return {
                cash: parseFloat(balances.cash_balance),
                buyingPower: parseFloat(balances.buying_power),
                equity: parseFloat(balances.equity),
                netLiquidationValue: parseFloat(balances.net_liquidation_value)
            };
        } catch (error) {
            throw new Error(`Failed to get balance: ${error.message}`);
        }
    }

    async getPositions() {
        try {
            const accounts = await this._apiCall('GET', '/customers/me/accounts');
            const accountId = accounts[0].account.external_id;
            const positions = await this._apiCall('GET', `/accounts/${accountId}/positions`);

            return positions.map(pos => ({
                symbol: pos.symbol,
                size: pos.quantity_direction === 'Long' ? pos.quantity : -pos.quantity,
                side: pos.quantity_direction,
                entryPrice: pos.average_open_price,
                currentPrice: pos.mark_price,
                pnl: pos.unrealized_gain_loss,
                greeks: {
                    delta: pos.delta,
                    gamma: pos.gamma,
                    theta: pos.theta,
                    vega: pos.vega
                }
            }));
        } catch (error) {
            throw new Error(`Failed to get positions: ${error.message}`);
        }
    }

    async getOpenOrders() {
        try {
            const accounts = await this._apiCall('GET', '/customers/me/accounts');
            const accountId = accounts[0].account.external_id;
            const orders = await this._apiCall('GET', `/accounts/${accountId}/orders?status=Open`);

            return orders.map(order => ({
                orderId: order.id,
                symbol: order.symbol,
                type: order.order_type,
                side: order.legs[0]?.action,
                price: order.price_effect?.affected_price,
                amount: order.legs[0]?.quantity,
                status: order.status,
                greeks: this._extractOrderGreeks(order)
            }));
        } catch (error) {
            throw new Error(`Failed to get open orders: ${error.message}`);
        }
    }

    // =========================================================================
    // ORDER MANAGEMENT
    // =========================================================================

    async placeBuyOrder(symbol, amount, price = null, options = {}) {
        return this._placeOrder(symbol, 'BUY_TO_OPEN', amount, price, options);
    }

    async placeSellOrder(symbol, amount, price = null, options = {}) {
        return this._placeOrder(symbol, 'SELL_TO_CLOSE', amount, price, options);
    }

    async _placeOrder(symbol, action, amount, price, options = {}) {
        try {
            const accounts = await this._apiCall('GET', '/customers/me/accounts');
            const accountId = accounts[0].account.external_id;

            // Build order legs
            const legs = [{
                symbol: symbol,
                action: action,
                quantity: amount
            }];

            // Support spreads and multi-leg strategies
            if (options.legs && Array.isArray(options.legs)) {
                legs.push(...options.legs);
            }

            const orderData = {
                order_type: price ? 'Limit' : 'Market',
                legs: legs,
                price: price,
                time_in_force: options.timeInForce || 'Day',
                gtc_date: options.gtcDate || null
            };

            const response = await this._apiCall('POST', `/accounts/${accountId}/orders`, orderData);

            return {
                orderId: response.id,
                status: response.status,
                symbol: symbol,
                action: action,
                amount: amount,
                price: price
            };
        } catch (error) {
            throw new Error(`Failed to place order: ${error.message}`);
        }
    }

    async cancelOrder(orderId) {
        try {
            const accounts = await this._apiCall('GET', '/customers/me/accounts');
            const accountId = accounts[0].account.external_id;
            
            await this._apiCall('DELETE', `/accounts/${accountId}/orders/${orderId}`);
            return true;
        } catch (error) {
            console.error(`Failed to cancel order: ${error.message}`);
            return false;
        }
    }

    async modifyOrder(orderId, modifications) {
        try {
            const accounts = await this._apiCall('GET', '/customers/me/accounts');
            const accountId = accounts[0].account.external_id;
            
            const result = await this._apiCall(
                'PUT',
                `/accounts/${accountId}/orders/${orderId}`,
                modifications
            );
            return result;
        } catch (error) {
            throw new Error(`Failed to modify order: ${error.message}`);
        }
    }

    async getOrderStatus(orderId) {
        try {
            const accounts = await this._apiCall('GET', '/customers/me/accounts');
            const accountId = accounts[0].account.external_id;
            const order = await this._apiCall('GET', `/accounts/${accountId}/orders/${orderId}`);

            return {
                orderId: order.id,
                status: order.status,
                filledAmount: order.filled_quantity,
                remainingAmount: order.quantity - order.filled_quantity
            };
        } catch (error) {
            throw new Error(`Failed to get order status: ${error.message}`);
        }
    }

    // =========================================================================
    // MARKET DATA
    // =========================================================================

    async getTicker(symbol) {
        try {
            const quote = await this._apiCall('GET', `/quotes/${symbol}`);

            return {
                bid: parseFloat(quote.bid),
                ask: parseFloat(quote.ask),
                last: parseFloat(quote.last),
                volume: parseFloat(quote.volume),
                iv: parseFloat(quote.implied_volatility || 0)
            };
        } catch (error) {
            throw new Error(`Failed to get ticker: ${error.message}`);
        }
    }

    async getCandles(symbol, timeframe = '1m', limit = 100) {
        try {
            const response = await this._apiCall('GET', `/intraday-history`, {
                params: {
                    symbol: symbol,
                    interval: timeframe,
                    limit: limit
                }
            });

            // FIX 2026-02-25: Return milliseconds (was dividing by 1000 → seconds)
            return response.candles.map(candle => ({
                t: new Date(candle.time).getTime(),  // milliseconds, not seconds
                o: parseFloat(candle.open),
                h: parseFloat(candle.high),
                l: parseFloat(candle.low),
                c: parseFloat(candle.close),
                v: parseFloat(candle.volume)
            }));
        } catch (error) {
            throw new Error(`Failed to get candles: ${error.message}`);
        }
    }

    async getOrderBook(symbol, depth = 20) {
        try {
            const book = await this._apiCall('GET', `/market-data/book/${symbol}`);

            return {
                bids: book.bids.slice(0, depth).map(b => [b.price, b.size]),
                asks: book.asks.slice(0, depth).map(a => [a.price, a.size])
            };
        } catch (error) {
            throw new Error(`Failed to get order book: ${error.message}`);
        }
    }

    // =========================================================================
    // GREEKS & ANALYTICS
    // =========================================================================

    async getOptionChain(symbol, expiration) {
        try {
            const response = await this._apiCall('GET', `/option-chains/${symbol}`, {
                params: { expiration_date: expiration }
            });
            return response;
        } catch (error) {
            throw new Error(`Failed to get option chain: ${error.message}`);
        }
    }

    async getImpliedVolatility(symbol) {
        try {
            const quote = await this.getTicker(symbol);
            return quote.iv;
        } catch (error) {
            return null;
        }
    }

    // =========================================================================
    // REAL-TIME SUBSCRIPTIONS
    // =========================================================================

    subscribeToTicker(symbol, callback) {
        // Tastyworks doesn't have WebSocket - implement polling
        this._startPolling(symbol, 'ticker', callback);
    }

    subscribeToCandles(symbol, timeframe, callback) {
        this._startPolling(symbol, `candles-${timeframe}`, callback);
    }

    subscribeToOrderBook(symbol, callback) {
        this._startPolling(symbol, 'orderbook', callback);
    }

    subscribeToAccount(callback) {
        this._startPolling(null, 'account', callback);
    }

    unsubscribeAll() {
        this._stopPolling();
    }

    _pollingIntervals = new Map();

    _startPolling(symbol, type, callback) {
        const key = `${symbol}-${type}`;
        
        if (this._pollingIntervals.has(key)) {
            clearInterval(this._pollingIntervals.get(key));
        }

        const interval = setInterval(async () => {
            try {
                if (type === 'ticker' && symbol) {
                    const data = await this.getTicker(symbol);
                    callback(data);
                } else if (type.startsWith('candles') && symbol) {
                    const timeframe = type.split('-')[1];
                    const data = await this.getCandles(symbol, timeframe, 1);
                    if (data.length > 0) callback(data[0]);
                } else if (type === 'orderbook' && symbol) {
                    const data = await this.getOrderBook(symbol);
                    callback(data);
                } else if (type === 'account') {
                    const balance = await this.getBalance();
                    callback(balance);
                }
            } catch (error) {
                console.error(`Polling error for ${key}:`, error.message);
            }
        }, 1000);

        this._pollingIntervals.set(key, interval);
    }

    _stopPolling() {
        for (const interval of this._pollingIntervals.values()) {
            clearInterval(interval);
        }
        this._pollingIntervals.clear();
    }

    // =========================================================================
    // ASSET INFORMATION
    // =========================================================================

    getAssetType() {
        return 'options';
    }

    getBrokerName() {
        return 'tastyworks';
    }

    async getSupportedSymbols() {
        return ['SPY', 'QQQ', 'AAPL', 'TSLA', 'GOOGL'];
    }

    getMinOrderSize(symbol) {
        return 1;  // 1 contract
    }

    getFees() {
        return {
            perContract: 0.65  // $0.65 per contract
        };
    }

    isTradeableNow(symbol) {
        // US market hours
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const day = now.getDay();

        if (day === 0 || day === 6) return false;
        const time = hours * 100 + minutes;
        return time >= 930 && time < 1600;
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    _toBrokerSymbol(symbol) {
        return symbol.toUpperCase();
    }

    fromBrokerSymbol(brokerSymbol) {
        return brokerSymbol;
    }

    _extractOrderGreeks(order) {
        const greeks = {};
        if (order.legs && order.legs[0]) {
            greeks.delta = order.legs[0].delta;
            greeks.gamma = order.legs[0].gamma;
            greeks.theta = order.legs[0].theta;
            greeks.vega = order.legs[0].vega;
        }
        return greeks;
    }
}

module.exports = TastyworksAdapter;
