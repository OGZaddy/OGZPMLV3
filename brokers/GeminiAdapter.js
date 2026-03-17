/**
 * Gemini Exchange Adapter for Empire V2
 *
 * Features:
 * - REST API v1 for trading
 * - WebSocket API v2 for real-time data
 * - Supports spot trading
 * - Advanced order types (limit, market, IOC, FOK, maker-or-cancel)
 * - Sandbox environment for testing
 */

const IBrokerAdapter = require('./IBrokerAdapter');
const crypto = require('crypto');
const axios = require('axios');
const WebSocket = require('ws');

class GeminiAdapter extends IBrokerAdapter {
  constructor(config) {
    super();
    // CHANGE 2026-01-31: Use GEMINI_EXCHANGE_* env vars to distinguish from Google AI's GEMINI_API_KEY
    this.config = {
      apiKey: config.apiKey || process.env.GEMINI_EXCHANGE_API_KEY,
      apiSecret: config.apiSecret || process.env.GEMINI_EXCHANGE_API_SECRET,
      sandbox: config.sandbox || process.env.GEMINI_SANDBOX === 'true' || false,
      ...config
    };

    // API endpoints
    this.baseUrl = this.config.sandbox
      ? 'https://api.sandbox.gemini.com/v1'
      : 'https://api.gemini.com/v1';

    this.wsUrl = this.config.sandbox
      ? 'wss://api.sandbox.gemini.com/v2/marketdata'
      : 'wss://api.gemini.com/v2/marketdata';

    this.ws = null;
    this.subscriptions = new Map();
    this.connected = false;
    this.accountInfo = null;

    // Rate limiting
    this.requestQueue = [];
    this.requestsPerSecond = 10; // Gemini limit
    this.lastRequestTime = 0;

    console.log('💎 Gemini adapter initialized' + (this.config.sandbox ? ' (SANDBOX)' : ''));
  }

  /**
   * Generate authentication headers for Gemini
   */
  _generateAuthHeaders(path, payload = {}) {
    const nonce = Date.now().toString();
    const completePayload = {
      nonce,
      request: path,
      ...payload
    };

    const encodedPayload = Buffer.from(JSON.stringify(completePayload)).toString('base64');
    const signature = crypto
      .createHmac('sha384', this.config.apiSecret)
      .update(encodedPayload)
      .digest('hex');

    return {
      'X-GEMINI-APIKEY': this.config.apiKey,
      'X-GEMINI-PAYLOAD': encodedPayload,
      'X-GEMINI-SIGNATURE': signature,
      'Content-Type': 'text/plain'
    };
  }

  /**
   * Make authenticated request to Gemini
   */
  async _request(endpoint, payload = {}) {
    try {
      const headers = this._generateAuthHeaders(`/v1${endpoint}`, payload);
      const response = await axios.post(
        `${this.baseUrl}${endpoint}`,
        null,
        { headers }
      );
      return response.data;
    } catch (error) {
      console.error(`❌ Gemini API error: ${error.response?.data?.message || error.message}`);
      throw error;
    }
  }

  /**
   * Make public request (no auth needed)
   */
  async _publicRequest(endpoint) {
    try {
      const response = await axios.get(`${this.baseUrl}${endpoint}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Gemini public API error: ${error.message}`);
      throw error;
    }
  }

  // CONNECTION MANAGEMENT
  async connect() {
    try {
      // Test connection with account info
      this.accountInfo = await this._request('/account');

      // Initialize WebSocket
      await this._initWebSocket();

      this.connected = true;
      console.log('✅ Connected to Gemini exchange');
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to Gemini:', error.message);
      return false;
    }
  }

  async _initWebSocket() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        console.log('📡 Gemini WebSocket connected');
        resolve();
      });

      this.ws.on('message', (data) => {
        this._handleWebSocketMessage(JSON.parse(data));
      });

      this.ws.on('error', (error) => {
        console.error('❌ Gemini WebSocket error:', error);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('📴 Gemini WebSocket disconnected');
        this._reconnectWebSocket();
      });
    });
  }

  _handleWebSocketMessage(message) {
    if (message.type === 'update' && message.events) {
      for (const event of message.events) {
        const callbacks = this.subscriptions.get(event.symbol);
        if (callbacks) {
          callbacks.forEach(cb => cb(this._normalizeWebSocketData(event)));
        }
      }
    }
  }

  _normalizeWebSocketData(event) {
    return {
      symbol: this.fromBrokerSymbol(event.symbol),
      price: parseFloat(event.price),
      amount: parseFloat(event.amount),
      side: event.side,
      timestamp: event.timestamp || Date.now()
    };
  }

  async _reconnectWebSocket() {
    console.log('🔄 Attempting to reconnect Gemini WebSocket...');
    setTimeout(() => {
      this._initWebSocket();
    }, 5000);
  }

  async disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    console.log('📴 Disconnected from Gemini');
  }

  isConnected() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  // ACCOUNT INFO
  async getBalance() {
    try {
      const balances = await this._request('/balances');

      const balance = {
        total: 0,
        free: 0,
        used: 0,
        currencies: {}
      };

      for (const asset of balances) {
        const currency = asset.currency.toUpperCase();
        const amount = parseFloat(asset.amount);
        const available = parseFloat(asset.available);

        balance.currencies[currency] = {
          total: amount,
          free: available,
          used: amount - available
        };

        // Convert to USD for total (simplified - should use real rates)
        if (currency === 'USD') {
          balance.total += amount;
          balance.free += available;
          balance.used += (amount - available);
        }
      }

      return balance;
    } catch (error) {
      console.error('❌ Failed to get balance:', error);
      return null;
    }
  }

  async getPositions() {
    // Gemini doesn't have "positions" like futures, return balances
    const balances = await this.getBalance();
    const positions = [];

    for (const [currency, data] of Object.entries(balances.currencies)) {
      if (data.total > 0 && currency !== 'USD') {
        positions.push({
          symbol: `${currency}/USD`,
          side: 'long',
          amount: data.total,
          entryPrice: 0, // Would need order history to calculate
          currentPrice: 0, // Would need ticker data
          pnl: 0,
          pnlPercent: 0
        });
      }
    }

    return positions;
  }

  async getOpenOrders(symbol = null) {
    try {
      const orders = await this._request('/orders');

      return orders
        .filter(order => !symbol || order.symbol === this._toBrokerSymbol(symbol))
        .map(order => ({
          id: order.order_id,
          symbol: this.fromBrokerSymbol(order.symbol),
          type: order.type,
          side: order.side,
          price: parseFloat(order.price),
          amount: parseFloat(order.original_amount),
          filled: parseFloat(order.executed_amount),
          remaining: parseFloat(order.remaining_amount),
          status: order.is_live ? 'open' : 'closed',
          timestamp: order.timestamp
        }));
    } catch (error) {
      console.error('❌ Failed to get open orders:', error);
      return [];
    }
  }

  // ORDER MANAGEMENT
  async placeBuyOrder(symbol, amount, price = null, options = {}) {
    return this._placeOrder(symbol, 'buy', amount, price, options);
  }

  async placeSellOrder(symbol, amount, price = null, options = {}) {
    return this._placeOrder(symbol, 'sell', amount, price, options);
  }

  async _placeOrder(symbol, side, amount, price, options) {
    try {
      const orderType = price ? 'exchange limit' : 'exchange market';

      const payload = {
        symbol: this._toBrokerSymbol(symbol),
        amount: amount.toString(),
        side,
        type: orderType,
        options: options.orderOptions || []
      };

      if (price) {
        payload.price = price.toString();
      }

      const order = await this._request('/order/new', payload);

      return {
        id: order.order_id,
        symbol: this.fromBrokerSymbol(order.symbol),
        type: order.type,
        side: order.side,
        price: parseFloat(order.price || 0),
        amount: parseFloat(order.original_amount),
        status: 'open',
        timestamp: order.timestamp
      };
    } catch (error) {
      console.error(`❌ Failed to place ${side} order:`, error);
      return null;
    }
  }

  async cancelOrder(orderId) {
    try {
      const result = await this._request('/order/cancel', {
        order_id: orderId
      });
      return result.is_cancelled;
    } catch (error) {
      console.error('❌ Failed to cancel order:', error);
      return false;
    }
  }

  async getOrderStatus(orderId) {
    try {
      const order = await this._request('/order/status', {
        order_id: orderId
      });

      return {
        id: order.order_id,
        symbol: this.fromBrokerSymbol(order.symbol),
        status: order.is_live ? 'open' : order.is_cancelled ? 'cancelled' : 'filled',
        filled: parseFloat(order.executed_amount),
        remaining: parseFloat(order.remaining_amount),
        avgPrice: parseFloat(order.avg_execution_price || 0)
      };
    } catch (error) {
      console.error('❌ Failed to get order status:', error);
      return null;
    }
  }

  // MARKET DATA
  async getTicker(symbol) {
    try {
      const ticker = await this._publicRequest(`/pubticker/${this._toBrokerSymbol(symbol)}`);

      return {
        symbol: symbol,
        bid: parseFloat(ticker.bid),
        ask: parseFloat(ticker.ask),
        last: parseFloat(ticker.last),
        volume: parseFloat(ticker.volume[ticker.volume.USD ? 'USD' : Object.keys(ticker.volume)[0]])
      };
    } catch (error) {
      console.error('❌ Failed to get ticker:', error);
      return null;
    }
  }

  async getCandles(symbol, timeframe = '1m', limit = 100) {
    // Gemini doesn't have a direct candles endpoint in v1
    // Would need to aggregate from trades or use v2 API
    console.warn('⚠️ Candles not implemented for Gemini v1 API');
    return [];
  }

  async getOrderBook(symbol, depth = 10) {
    try {
      const book = await this._publicRequest(`/book/${this._toBrokerSymbol(symbol)}`);

      return {
        bids: book.bids.slice(0, depth).map(b => ({
          price: parseFloat(b.price),
          amount: parseFloat(b.amount)
        })),
        asks: book.asks.slice(0, depth).map(a => ({
          price: parseFloat(a.price),
          amount: parseFloat(a.amount)
        })),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('❌ Failed to get order book:', error);
      return null;
    }
  }

  // REAL-TIME SUBSCRIPTIONS
  subscribeToTicker(symbol, callback) {
    const brokerSymbol = this._toBrokerSymbol(symbol);

    if (!this.subscriptions.has(brokerSymbol)) {
      this.subscriptions.set(brokerSymbol, []);

      // Send subscription message
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'subscribe',
          subscriptions: [{
            name: 'l2',
            symbols: [brokerSymbol]
          }]
        }));
      }
    }

    this.subscriptions.get(brokerSymbol).push(callback);
  }

  unsubscribeAll() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'unsubscribe'
      }));
    }
    this.subscriptions.clear();
  }

  // ASSET INFO
  getAssetType() {
    return 'crypto';
  }

  getBrokerName() {
    return 'Gemini';
  }

  async getSupportedSymbols() {
    try {
      const symbols = await this._publicRequest('/symbols');
      return symbols.map(s => this.fromBrokerSymbol(s));
    } catch (error) {
      console.error('❌ Failed to get supported symbols:', error);
      return [];
    }
  }

  async getMinOrderSize(symbol) {
    // Gemini minimums (simplified - should fetch from API)
    const minimums = {
      'BTC/USD': 0.00001,
      'ETH/USD': 0.001,
      'LTC/USD': 0.01,
      'BCH/USD': 0.001,
      'LINK/USD': 0.1,
      'DAI/USD': 1,
      'AMP/USD': 100
    };

    return minimums[symbol] || 0.001;
  }

  getFees() {
    return {
      maker: 0.0025, // 0.25%
      taker: 0.0035  // 0.35%
    };
  }

  isTradeableNow(symbol) {
    return true; // Gemini is 24/7 for crypto
  }

  // SYMBOL NORMALIZATION
  _toBrokerSymbol(symbol) {
    // Convert BTC/USD to btcusd
    return symbol.replace('/', '').toLowerCase();
  }

  fromBrokerSymbol(brokerSymbol) {
    // Convert btcusd to BTC/USD
    const upper = brokerSymbol.toUpperCase();

    // Common Gemini pairs
    const pairs = {
      'BTCUSD': 'BTC/USD',
      'ETHUSD': 'ETH/USD',
      'LTCUSD': 'LTC/USD',
      'BCHUSD': 'BCH/USD',
      'LINKUSD': 'LINK/USD',
      'DAIUSD': 'DAI/USD',
      'AMPUSD': 'AMP/USD',
      'ZECUSD': 'ZEC/USD',
      'BATUSD': 'BAT/USD',
      'UNIUSD': 'UNI/USD',
      'AAVEUSD': 'AAVE/USD',
      'COMPUSD': 'COMP/USD',
      'SUSHIUSD': 'SUSHI/USD',
      'SNXUSD': 'SNX/USD',
      'CRVUSD': 'CRV/USD',
      'SANDUSD': 'SAND/USD',
      'MANAUSD': 'MANA/USD',
      'DOGEUSD': 'DOGE/USD',
      'SHIBUSD': 'SHIB/USD'
    };

    return pairs[upper] || upper;
  }

  // =========================================================================
  // BROKER CAPABILITIES (Gemini-specific overrides)
  // =========================================================================

  supportsFractionalShares() {
    return true; // Crypto supports fractional
  }

  supportsExtendedHours() {
    return true; // 24/7 crypto
  }

  supportsOptions() {
    return false;
  }

  supportsShortSelling() {
    return false; // Gemini is spot only
  }

  supportsMarketOrders() {
    return true;
  }

  supportsLimitOrders() {
    return true;
  }

  supportsStopOrders() {
    return true;
  }

  supportsStopLimitOrders() {
    return true;
  }

  supportsTrailingStopOrders() {
    return false;
  }

  supportsStreamingQuotes() {
    return true; // WebSocket API
  }

  supportsStreamingTrades() {
    return true; // WebSocket API
  }

  supportsPaperTrading() {
    return true; // Gemini has sandbox mode
  }

  supportsMarginTrading() {
    return false; // Spot only
  }

  supportsCryptoTrading() {
    return true;
  }
}

module.exports = GeminiAdapter;