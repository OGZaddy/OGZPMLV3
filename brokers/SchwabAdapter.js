/**
 * Charles Schwab / thinkorswim (TOS) Adapter for Empire V2
 *
 * NOTE: Schwab acquired TD Ameritrade and thinkorswim
 * This adapter works with both Schwab accounts and legacy TD/TOS accounts
 *
 * Features:
 * - Stock, ETF, and Options trading via Schwab Trader API
 * - Compatible with thinkorswim platform
 * - Real-time quotes via streaming API
 * - Advanced order types
 * - Account management
 */

const IBrokerAdapter = require('./IBrokerAdapter');
const axios = require('axios');
const WebSocket = require('ws');
const crypto = require('crypto');

class SchwabAdapter extends IBrokerAdapter {
  constructor(config) {
    super();
    this.config = {
      clientId: config.clientId || process.env.SCHWAB_CLIENT_ID,
      clientSecret: config.clientSecret || process.env.SCHWAB_CLIENT_SECRET,
      refreshToken: config.refreshToken || process.env.SCHWAB_REFRESH_TOKEN,
      accountNumber: config.accountNumber || process.env.SCHWAB_ACCOUNT_NUMBER,
      sandbox: config.sandbox || false,
      ...config
    };

    // API endpoints (no sandbox available)
    this.baseUrl = 'https://api.schwabapi.com/marketdata/v1';

    this.tradingUrl = 'https://api.schwabapi.com/trader/v1';

    this.wsUrl = 'wss://stream.schwabapi.com/v1/stream';

    this.accessToken = null;
    this.tokenExpiry = null;
    this.ws = null;
    this.connected = false;
    this.subscriptions = new Map();

    // Rate limiting (Schwab limits: 120 requests per minute)
    this.requestQueue = [];
    this.requestsPerMinute = 120;
    this.lastRequestTime = 0;

    console.log('🏦 Schwab adapter initialized');
  }

  /**
   * Get OAuth2 access token
   */
  async _getAccessToken() {
    if (this.accessToken && this.tokenExpiry > Date.now()) {
      return this.accessToken;
    }

    try {
      const response = await axios.post(
        'https://api.schwabapi.com/v1/oauth/token',
        {
          grant_type: 'refresh_token',
          refresh_token: this.config.refreshToken,
          client_id: this.config.clientId
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`
          }
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

      return this.accessToken;
    } catch (error) {
      console.error('❌ Failed to get Schwab access token:', error.message);
      throw error;
    }
  }

  /**
   * Make authenticated request
   */
  async _request(url, method = 'GET', data = null) {
    const token = await this._getAccessToken();

    try {
      const config = {
        method,
        url,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error(`❌ Schwab API error: ${error.response?.data?.message || error.message}`);
      throw error;
    }
  }

  // CONNECTION MANAGEMENT
  async connect() {
    try {
      // Test connection by getting account info
      await this._getAccessToken();

      const accounts = await this._request(
        `${this.tradingUrl}/accounts/${this.config.accountNumber}`
      );

      if (accounts) {
        console.log('✅ Connected to Schwab');
        this.connected = true;

        // Initialize WebSocket for streaming
        await this._initWebSocket();

        return true;
      }
    } catch (error) {
      console.error('❌ Failed to connect to Schwab:', error.message);
      return false;
    }
  }

  async _initWebSocket() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', async () => {
        // Authenticate WebSocket
        const token = await this._getAccessToken();
        this.ws.send(JSON.stringify({
          service: 'ADMIN',
          command: 'LOGIN',
          parameters: {
            token: token,
            version: '1.0'
          }
        }));

        console.log('📡 Schwab WebSocket connected');
        resolve();
      });

      this.ws.on('message', (data) => {
        this._handleWebSocketMessage(JSON.parse(data));
      });

      this.ws.on('error', (error) => {
        console.error('❌ Schwab WebSocket error:', error);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('📴 Schwab WebSocket disconnected');
        setTimeout(() => this._initWebSocket(), 5000);
      });
    });
  }

  _handleWebSocketMessage(message) {
    if (message.data && message.service === 'QUOTE') {
      const callbacks = this.subscriptions.get(message.key);
      if (callbacks) {
        callbacks.forEach(cb => cb(this._normalizeQuote(message.data)));
      }
    }
  }

  _normalizeQuote(data) {
    return {
      symbol: data.symbol,
      bid: parseFloat(data.bidPrice || 0),
      ask: parseFloat(data.askPrice || 0),
      last: parseFloat(data.lastPrice || 0),
      volume: parseInt(data.totalVolume || 0),
      timestamp: data.timestamp || Date.now()
    };
  }

  async disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    console.log('📴 Disconnected from Schwab');
  }

  isConnected() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  // ACCOUNT INFO
  async getBalance() {
    try {
      const account = await this._request(
        `${this.tradingUrl}/accounts/${this.config.accountNumber}`
      );

      const balances = account.securitiesAccount.currentBalances;

      return {
        total: balances.liquidationValue || 0,
        free: balances.availableFunds || 0,
        used: balances.buyingPower || 0,
        currencies: {
          USD: {
            total: balances.liquidationValue || 0,
            free: balances.availableFunds || 0,
            used: (balances.liquidationValue || 0) - (balances.availableFunds || 0)
          }
        }
      };
    } catch (error) {
      console.error('❌ Failed to get balance:', error);
      return null;
    }
  }

  async getPositions() {
    try {
      const account = await this._request(
        `${this.tradingUrl}/accounts/${this.config.accountNumber}`
      );

      const positions = account.securitiesAccount.positions || [];

      return positions.map(pos => ({
        symbol: pos.instrument.symbol,
        side: pos.longQuantity > 0 ? 'long' : 'short',
        amount: Math.abs(pos.longQuantity || pos.shortQuantity || 0),
        entryPrice: pos.averagePrice || 0,
        currentPrice: pos.marketValue / Math.abs(pos.longQuantity || pos.shortQuantity || 1),
        pnl: pos.currentDayProfitLoss || 0,
        pnlPercent: pos.currentDayProfitLossPercentage || 0
      }));
    } catch (error) {
      console.error('❌ Failed to get positions:', error);
      return [];
    }
  }

  async getOpenOrders(symbol = null) {
    try {
      const orders = await this._request(
        `${this.tradingUrl}/accounts/${this.config.accountNumber}/orders`
      );

      return orders
        .filter(order => !symbol || order.symbol === symbol)
        .map(order => ({
          id: order.orderId,
          symbol: order.symbol,
          type: order.orderType.toLowerCase(),
          side: order.instruction.toLowerCase().includes('buy') ? 'buy' : 'sell',
          price: order.price || 0,
          amount: order.quantity || 0,
          filled: order.filledQuantity || 0,
          remaining: order.remainingQuantity || 0,
          status: order.status.toLowerCase(),
          timestamp: new Date(order.enteredTime).getTime()
        }));
    } catch (error) {
      console.error('❌ Failed to get open orders:', error);
      return [];
    }
  }

  // ORDER MANAGEMENT
  async placeBuyOrder(symbol, amount, price = null, options = {}) {
    return this._placeOrder('BUY', symbol, amount, price, options);
  }

  async placeSellOrder(symbol, amount, price = null, options = {}) {
    return this._placeOrder('SELL', symbol, amount, price, options);
  }

  async _placeOrder(instruction, symbol, quantity, price, options) {
    try {
      const orderType = price ? 'LIMIT' : 'MARKET';

      const order = {
        orderType: orderType,
        session: options.session || 'NORMAL',
        duration: options.duration || 'DAY',
        orderStrategyType: 'SINGLE',
        orderLegCollection: [{
          instruction: instruction,
          quantity: quantity,
          instrument: {
            symbol: symbol,
            assetType: options.assetType || 'EQUITY'
          }
        }]
      };

      if (price) {
        order.price = price;
      }

      const response = await this._request(
        `${this.tradingUrl}/accounts/${this.config.accountNumber}/orders`,
        'POST',
        order
      );

      // Schwab returns order ID in Location header
      const orderId = response.headers?.location?.split('/').pop() || Date.now().toString();

      return {
        id: orderId,
        symbol: symbol,
        type: orderType.toLowerCase(),
        side: instruction.toLowerCase(),
        price: price || 0,
        amount: quantity,
        status: 'pending',
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`❌ Failed to place ${instruction} order:`, error);
      return null;
    }
  }

  async cancelOrder(orderId) {
    try {
      await this._request(
        `${this.tradingUrl}/accounts/${this.config.accountNumber}/orders/${orderId}`,
        'DELETE'
      );
      return true;
    } catch (error) {
      console.error('❌ Failed to cancel order:', error);
      return false;
    }
  }

  async getOrderStatus(orderId) {
    try {
      const order = await this._request(
        `${this.tradingUrl}/accounts/${this.config.accountNumber}/orders/${orderId}`
      );

      return {
        id: order.orderId,
        symbol: order.symbol,
        status: order.status.toLowerCase(),
        filled: order.filledQuantity || 0,
        remaining: order.remainingQuantity || 0,
        avgPrice: order.averagePrice || 0
      };
    } catch (error) {
      console.error('❌ Failed to get order status:', error);
      return null;
    }
  }

  // MARKET DATA
  async getTicker(symbol) {
    try {
      const quote = await this._request(
        `${this.baseUrl}/quotes?symbols=${symbol}`
      );

      const data = quote[symbol];

      return {
        symbol: symbol,
        bid: parseFloat(data.bidPrice || 0),
        ask: parseFloat(data.askPrice || 0),
        last: parseFloat(data.lastPrice || 0),
        volume: parseInt(data.totalVolume || 0)
      };
    } catch (error) {
      console.error('❌ Failed to get ticker:', error);
      return null;
    }
  }

  async getCandles(symbol, timeframe = '1D', limit = 100) {
    try {
      // Map timeframe to Schwab format
      const periodType = 'day';
      const period = 10;
      const frequencyType = 'minute';
      const frequency = timeframe === '1m' ? 1 : timeframe === '5m' ? 5 : 30;

      const priceHistory = await this._request(
        `${this.baseUrl}/pricehistory?symbol=${symbol}&periodType=${periodType}&period=${period}&frequencyType=${frequencyType}&frequency=${frequency}`
      );

      // FIX 2026-02-25: Use Kraken-compatible format {t,o,h,l,c,v} not {timestamp,open,high,low,close,volume}
      return priceHistory.candles.slice(-limit).map(candle => ({
        t: candle.datetime,  // milliseconds
        o: candle.open,
        h: candle.high,
        l: candle.low,
        c: candle.close,
        v: candle.volume
      }));
    } catch (error) {
      console.error('❌ Failed to get candles:', error);
      return [];
    }
  }

  async getOrderBook(symbol, depth = 10) {
    // Schwab doesn't provide order book via standard API
    console.warn('⚠️ Order book not available for Schwab API');
    return {
      bids: [],
      asks: [],
      timestamp: Date.now()
    };
  }

  // REAL-TIME SUBSCRIPTIONS
  subscribeToTicker(symbol, callback) {
    if (!this.subscriptions.has(symbol)) {
      this.subscriptions.set(symbol, []);

      // Subscribe via WebSocket
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          service: 'QUOTE',
          command: 'SUBS',
          parameters: {
            keys: symbol,
            fields: '0,1,2,3,4,5,8,9'  // bid, ask, last, volume, etc
          }
        }));
      }
    }

    this.subscriptions.get(symbol).push(callback);
  }

  unsubscribeAll() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      for (const symbol of this.subscriptions.keys()) {
        this.ws.send(JSON.stringify({
          service: 'QUOTE',
          command: 'UNSUBS',
          parameters: {
            keys: symbol
          }
        }));
      }
    }
    this.subscriptions.clear();
  }

  // ASSET INFO
  getAssetType() {
    return 'stocks';
  }

  getBrokerName() {
    return 'Schwab';
  }

  async getSupportedSymbols() {
    // Would need to implement instrument search
    // For now, return common symbols
    return ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'SPY', 'QQQ', 'IWM', 'DIA'];
  }

  async getMinOrderSize(symbol) {
    return 1; // 1 share minimum for stocks
  }

  getFees() {
    return {
      stock: 0,      // $0 commission on stocks
      options: 0.65  // $0.65 per option contract
    };
  }

  isTradeableNow(symbol) {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const day = now.getDay();

    // Market hours: 9:30 AM - 4:00 PM ET, Monday-Friday
    // This is simplified - should check for holidays
    if (day === 0 || day === 6) return false; // Weekend

    const marketTime = hour * 60 + minute;
    const marketOpen = 9 * 60 + 30;  // 9:30 AM
    const marketClose = 16 * 60;     // 4:00 PM

    return marketTime >= marketOpen && marketTime < marketClose;
  }

  // SYMBOL NORMALIZATION
  _toBrokerSymbol(symbol) {
    // Schwab uses standard ticker symbols
    return symbol.replace('/', '');  // Remove any slashes
  }

  fromBrokerSymbol(brokerSymbol) {
    // Schwab symbols are already in standard format
    return brokerSymbol;
  }
}

module.exports = SchwabAdapter;