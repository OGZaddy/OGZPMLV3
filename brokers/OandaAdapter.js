/**
 * ============================================================================
 * OandaAdapter - Universal Broker Adapter for OANDA
 * ============================================================================
 * 
 * Implements IBrokerAdapter for OANDA Forex & CFD trading
 * Supports: Forex pairs, commodities, indices, crypto
 * 
 * @author OGZPrime Team
 * @version 1.0.0
 * ============================================================================
 */

const IBrokerAdapter = require('../foundation/IBrokerAdapter');
const axios = require('axios');
const WebSocket = require('ws');

class OandaAdapter extends IBrokerAdapter {
    constructor(config = {}) {
        super();
        this.config = config;
        this.apiKey = config.apiKey;
        this.accountId = config.accountId;
        this.baseUrl = config.practice ? 'https://stream-fxpractice.oanda.com' : 'https://stream-fxtrade.oanda.com';
        this.apiUrl = config.practice ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com';
        this.connected = false;
        this.ws = null;
        this.subscriptions = new Map();
    }

    // =========================================================================
    // CONNECTION MANAGEMENT
    // =========================================================================

    async connect() {
        try {
            const accounts = await this._apiCall('GET', '/v3/accounts');
            if (accounts.accounts && accounts.accounts.length > 0) {
                if (!this.accountId) {
                    this.accountId = accounts.accounts[0].id;
                }
                this.connected = true;
                console.log('✅ OANDA adapter connected');
                return true;
            }
            return false;
        } catch (error) {
            console.error('❌ OANDA connection failed:', error.message);
            return false;
        }
    }

    async disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        console.log('🔌 OANDA adapter disconnected');
        return true;
    }

    isConnected() {
        return this.connected && (!this.ws || this.ws.readyState === 1);
    }

    // =========================================================================
    // API HELPERS
    // =========================================================================

    async _apiCall(method, endpoint, data = null, stream = false) {
        const baseURL = stream ? this.baseUrl : this.apiUrl;
        const config = {
            method,
            url: `${baseURL}${endpoint}`,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'Accept-Datetime-Format': 'UNIX'
            }
        };

        if (data) {
            config.data = data;
        }

        try {
            const response = await axios(config);
            return response.data;
        } catch (error) {
            throw new Error(`API call failed: ${error.message}`);
        }
    }

    // =========================================================================
    // ACCOUNT INFO
    // =========================================================================

    async getBalance() {
        try {
            const response = await this._apiCall('GET', `/v3/accounts/${this.accountId}`);
            
            return {
                USD: parseFloat(response.account.balance),
                equity: parseFloat(response.account.balance) + parseFloat(response.account.unrealizedPL),
                buyingPower: parseFloat(response.account.marginAvailable),
                usedMargin: parseFloat(response.account.marginUsed),
                unrealizedPL: parseFloat(response.account.unrealizedPL)
            };
        } catch (error) {
            throw new Error(`Failed to get balance: ${error.message}`);
        }
    }

    async getPositions() {
        try {
            const response = await this._apiCall('GET', `/v3/accounts/${this.accountId}/openPositions`);

            return response.positions.map(pos => ({
                symbol: pos.instrument,
                size: Math.abs(parseFloat(pos.long?.units || 0) + parseFloat(pos.short?.units || 0)),
                side: parseFloat(pos.long?.units || 0) > 0 ? 'long' : 'short',
                entryPrice: parseFloat(pos.long?.averagePrice || pos.short?.averagePrice || 0),
                currentPrice: pos.unrealizedPL,  // Approximation
                pnl: parseFloat(pos.unrealizedPL)
            }));
        } catch (error) {
            throw new Error(`Failed to get positions: ${error.message}`);
        }
    }

    async getOpenOrders() {
        try {
            const response = await this._apiCall('GET', `/v3/accounts/${this.accountId}/orders`);

            return response.orders
                .filter(order => order.state === 'PENDING')
                .map(order => ({
                    orderId: order.id,
                    symbol: order.instrument,
                    type: order.type,
                    side: order.side,
                    price: parseFloat(order.priceBound || order.price || 0),
                    amount: parseFloat(order.units),
                    status: order.state
                }));
        } catch (error) {
            throw new Error(`Failed to get open orders: ${error.message}`);
        }
    }

    // =========================================================================
    // ORDER MANAGEMENT
    // =========================================================================

    async placeBuyOrder(symbol, amount, price = null, options = {}) {
        return this._placeOrder(symbol, 'BUY', amount, price, options);
    }

    async placeSellOrder(symbol, amount, price = null, options = {}) {
        return this._placeOrder(symbol, 'SELL', amount, price, options);
    }

    async _placeOrder(symbol, side, amount, price, options = {}) {
        try {
            const brokerSymbol = this._toBrokerSymbol(symbol);
            
            const orderBody = {
                order: {
                    instrument: brokerSymbol,
                    units: side === 'BUY' ? amount : -amount,
                    type: price ? 'LIMIT' : 'MARKET',
                    timeInForce: 'GTC'
                }
            };

            if (price) {
                orderBody.order.priceBound = price;
            }

            if (options.stopLoss) {
                orderBody.order.stopLossOnFill = {
                    price: options.stopLoss
                };
            }

            if (options.takeProfit) {
                orderBody.order.takeProfitOnFill = {
                    price: options.takeProfit
                };
            }

            const response = await this._apiCall('POST', `/v3/accounts/${this.accountId}/orders`, orderBody);

            return {
                orderId: response.orderFillTransaction?.id || response.orderCreateTransaction?.id,
                status: 'accepted',
                symbol: symbol,
                side: side,
                price: price,
                amount: amount
            };
        } catch (error) {
            throw new Error(`Failed to place order: ${error.message}`);
        }
    }

    async cancelOrder(orderId) {
        try {
            await this._apiCall('PUT', `/v3/accounts/${this.accountId}/orders/${orderId}/cancel`);
            return true;
        } catch (error) {
            console.error(`Failed to cancel order: ${error.message}`);
            return false;
        }
    }

    async modifyOrder(orderId, modifications) {
        try {
            const orderBody = {
                order: {
                    id: orderId,
                    ...modifications
                }
            };

            const response = await this._apiCall(
                'PUT',
                `/v3/accounts/${this.accountId}/orders/${orderId}`,
                orderBody
            );

            return response.orderUpdateTransaction || {};
        } catch (error) {
            throw new Error(`Failed to modify order: ${error.message}`);
        }
    }

    async getOrderStatus(orderId) {
        try {
            const response = await this._apiCall('GET', `/v3/accounts/${this.accountId}/orders/${orderId}`);

            return {
                orderId: response.order.id,
                status: response.order.state,
                filledAmount: parseFloat(response.order.filledUnits || 0),
                remainingAmount: parseFloat(response.order.units || 0) - parseFloat(response.order.filledUnits || 0)
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
            const brokerSymbol = this._toBrokerSymbol(symbol);
            const response = await this._apiCall('GET', `/v3/instruments/${brokerSymbol}/candles`, {
                params: {
                    count: 1,
                    granularity: 'M1'
                }
            });

            if (response.candles.length === 0) {
                throw new Error('No candle data');
            }

            const candle = response.candles[0];
            return {
                bid: parseFloat(candle.bid.c),
                ask: parseFloat(candle.ask.c),
                last: parseFloat((parseFloat(candle.bid.c) + parseFloat(candle.ask.c)) / 2),
                volume: parseInt(candle.volume)
            };
        } catch (error) {
            throw new Error(`Failed to get ticker: ${error.message}`);
        }
    }

    async getCandles(symbol, timeframe = 'M1', limit = 100) {
        try {
            const brokerSymbol = this._toBrokerSymbol(symbol);
            const response = await this._apiCall('GET', `/v3/instruments/${brokerSymbol}/candles`, {
                params: {
                    count: Math.min(limit, 5000),
                    granularity: timeframe
                }
            });

            return response.candles.map(candle => ({
                t: candle.time,
                o: parseFloat(candle.mid.o),
                h: parseFloat(candle.mid.h),
                l: parseFloat(candle.mid.l),
                c: parseFloat(candle.mid.c),
                v: parseInt(candle.volume)
            }));
        } catch (error) {
            throw new Error(`Failed to get candles: ${error.message}`);
        }
    }

    async getOrderBook(symbol, depth = 20) {
        // OANDA doesn't provide order book directly - return bid/ask spread
        try {
            const ticker = await this.getTicker(symbol);
            return {
                bids: [[ticker.bid, 1000000]],  // Estimated liquidity
                asks: [[ticker.ask, 1000000]]
            };
        } catch (error) {
            throw new Error(`Failed to get order book: ${error.message}`);
        }
    }

    // =========================================================================
    // REAL-TIME SUBSCRIPTIONS
    // =========================================================================

    subscribeToTicker(symbol, callback) {
        this._ensureWebSocketConnected(() => {
            const brokerSymbol = this._toBrokerSymbol(symbol);
            this.subscriptions.set(`ticker-${symbol}`, callback);

            this.ws.send(JSON.stringify({
                type: 'SUBSCRIBE',
                instruments: [brokerSymbol]
            }));
        });
    }

    subscribeToCandles(symbol, timeframe, callback) {
        this._ensureWebSocketConnected(() => {
            const brokerSymbol = this._toBrokerSymbol(symbol);
            this.subscriptions.set(`candles-${symbol}-${timeframe}`, callback);

            this.ws.send(JSON.stringify({
                type: 'SUBSCRIBE',
                instruments: [brokerSymbol],
                granularity: timeframe
            }));
        });
    }

    subscribeToOrderBook(symbol, callback) {
        // OANDA doesn't have order book updates - use ticker
        this.subscribeToTicker(symbol, callback);
    }

    subscribeToAccount(callback) {
        // OANDA doesn't have account subscription - implement polling
        this._startPolling('account', callback);
    }

    unsubscribeAll() {
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({
                type: 'UNSUBSCRIBE'
            }));
        }
        this.subscriptions.clear();
        this._stopPolling();
    }

    // =========================================================================
    // REAL-TIME (WebSocket)
    // =========================================================================

    _ensureWebSocketConnected(callback) {
        if (!this.ws || this.ws.readyState !== 1) {
            this.ws = new WebSocket(`${this.baseUrl.replace('https', 'wss')}/v3/pricing/stream?instruments=EUR%2FUSD`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });

            this.ws.on('open', () => {
                callback();
            });

            this.ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    this._handleWebSocketMessage(msg);
                } catch (error) {
                    // Ignore non-JSON
                }
            });

            this.ws.on('error', (error) => {
                console.error('OANDA WebSocket error:', error.message);
            });
        } else {
            callback();
        }
    }

    _handleWebSocketMessage(msg) {
        if (msg.type === 'PRICE') {
            const symbol = this.fromBrokerSymbol(msg.instrument);
            const callback = this.subscriptions.get(`ticker-${symbol}`);
            if (callback) {
                callback({
                    symbol,
                    bid: parseFloat(msg.bids[0].price),
                    ask: parseFloat(msg.asks[0].price),
                    volume: 0
                });
            }
        }
    }

    _pollingIntervals = new Map();

    _startPolling(type, callback) {
        if (this._pollingIntervals.has(type)) {
            clearInterval(this._pollingIntervals.get(type));
        }

        const interval = setInterval(async () => {
            try {
                if (type === 'account') {
                    const data = await this.getBalance();
                    callback(data);
                }
            } catch (error) {
                console.error(`Polling error:`, error.message);
            }
        }, 1000);

        this._pollingIntervals.set(type, interval);
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
        return 'forex';
    }

    getBrokerName() {
        return 'oanda';
    }

    async getSupportedSymbols() {
        try {
            const response = await this._apiCall('GET', '/v3/instruments', {
                params: { accountID: this.accountId }
            });
            return response.instruments.map(i => this.fromBrokerSymbol(i.name));
        } catch (error) {
            return ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD'];
        }
    }

    getMinOrderSize(symbol) {
        // 1k micro lot
        return 1000;
    }

    getFees() {
        return {
            spread: 0.00020  // 2 pips on EUR/USD
        };
    }

    isTradeableNow(symbol) {
        // Forex trades 24/5
        const now = new Date();
        const day = now.getUTCDay();
        return day !== 0 && day !== 6;  // Not Saturday or Sunday
    }

    // =========================================================================
    // SYMBOL NORMALIZATION
    // =========================================================================

    _toBrokerSymbol(symbol) {
        return symbol.replace('/', '_').toUpperCase();
    }

    fromBrokerSymbol(brokerSymbol) {
        return brokerSymbol.replace('_', '/');
    }
}

module.exports = OandaAdapter;
