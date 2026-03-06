/**
 * @fileoverview KrakenAdapterSimple - Direct Kraken Exchange Integration
 *
 * Provides direct API integration with Kraken for order execution and
 * real-time market data via WebSocket.
 *
 * @description
 * ARCHITECTURE ROLE:
 * This is the lowest-level component - it talks directly to Kraken's API.
 * All trading commands flow through here for actual exchange execution.
 *
 * DATA FLOW:
 * ```
 * Kraken WebSocket → onMessage() → emit('ohlc') → run-empire-v2.js
 * TradingBrain.openPosition() → executeOrder() → Kraken REST API
 * ```
 *
 * KEY FEATURES:
 * - WebSocket subscription for real-time OHLC (1m, 5m, 15m, 30m, 1h, 4h, 1d)
 * - Rate limiting with exponential backoff (15 req/sec limit)
 * - Automatic reconnection with heartbeat monitoring
 * - Data-level watchdog: forces reconnect if no data for 60s
 *
 * CRITICAL NOTES:
 * - Requires KRAKEN_API_KEY and KRAKEN_API_SECRET in .env
 * - Paper mode: Orders are logged but not sent to exchange
 * - Live mode: Real orders - use with extreme caution!
 *
 * @module kraken_adapter_simple
 * @requires axios
 * @requires ws
 * @requires crypto
 */

const crypto = require('crypto');
const axios = require('axios');
const querystring = require('querystring');
const WebSocket = require('ws');

class KrakenAdapterSimple {
  constructor(config = {}) {
    this.config = config;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = 'https://api.kraken.com';
    this.wsUrl = 'wss://ws-auth.kraken.com/v2';
    this.connected = false;
    this.assetPairs = new Map();
    this.ws = null;
    this.authToken = null;

    // Latest price storage for fallback access
    this.currentPrices = new Map(); // Store latest price per asset

    // WebSocket reconnect management
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectTimeout = null;

    // CHANGE 2026-01-21: Heartbeat to keep connection alive
    this.pingInterval = null;
    this.lastPong = Date.now();

    // CHANGE 2026-01-23: Data-level watchdog - force reconnect if no data even if socket "open"
    this.lastDataReceived = Date.now();
    this.dataWatchdogInterval = null;
    this.dataTimeout = 60000; // 60 seconds without data = force reconnect

    // Rate limiting (Kraken API tier 2: 15 req/sec)
    this.requestWindow = 1000; // 1 second window
    this.maxRequestsPerWindow = 15;
    this.requestTimestamps = [];
    this.rateLimitBackoff = 1000; // Start at 1s for 429 errors

    // CHANGE 2025-12-13: Step 4 - Simple queue to prevent recursion
    this.requestQueue = [];
    this.queueProcessing = false;
    this.processQueueInterval = null;

    // Capabilities
    this.capabilities = {
      markets: ['crypto'],
      orderTypes: ['market', 'limit', 'stop-loss', 'take-profit'],
      timeInForce: ['GTC', 'GTD', 'IOC'],
      crypto: true
    };
  }

  async connect() {
    try {
      // Test API credentials first
      await this.testCredentials();

      // Load asset pairs
      await this.loadAssetPairs();

      // Get WebSocket auth token
      await this.getAuthToken();

      this.connected = true;
      console.log('✅ Kraken adapter connected successfully');
      return true;
    } catch (error) {
      console.error('❌ Kraken connection failed:', error.message);
      return false;
    }
  }

  async testCredentials() {
    const response = await this.makePrivateRequest('/0/private/Balance');
    if (response.error && response.error.length > 0) {
      throw new Error(`API Error: ${response.error.join(', ')}`);
    }
    return response.result;
  }

  async loadAssetPairs() {
    try {
      const response = await axios.get(`${this.baseUrl}/0/public/AssetPairs`);
      if (response.data.error && response.data.error.length > 0) {
        throw new Error(`Asset pairs error: ${response.data.error.join(', ')}`);
      }

      const pairs = response.data.result;
      Object.entries(pairs).forEach(([key, value]) => {
        this.assetPairs.set(key, value);
      });

      console.log(`✅ Loaded ${this.assetPairs.size} asset pairs`);
    } catch (error) {
      throw new Error(`Failed to load asset pairs: ${error.message}`);
    }
  }

  async getAuthToken() {
    try {
      const response = await this.makePrivateRequest('/0/private/GetWebSocketsToken');
      if (response.error && response.error.length > 0) {
        throw new Error(`Token error: ${response.error.join(', ')}`);
      }

      this.authToken = response.result.token;
      console.log('✅ WebSocket auth token obtained');
    } catch (error) {
      throw new Error(`Failed to get auth token: ${error.message}`);
    }
  }

  // CHANGE 2025-12-13: Step 4 - Queue-based request handling (no recursion)
  async makePrivateRequest(endpoint, data = {}) {
    return new Promise((resolve, reject) => {
      // Add request to queue
      this.requestQueue.push({
        endpoint,
        data,
        resolve,
        reject,
        retries: 0
      });

      // Start queue processor if not running
      this.startQueueProcessor();
    });
  }

  // Process queued requests without recursion
  startQueueProcessor() {
    if (this.queueProcessing) return;

    this.queueProcessing = true;
    this.processQueueInterval = setInterval(() => this.processQueue(), 100);
  }

  async processQueue() {
    if (this.requestQueue.length === 0) {
      // Stop processor when queue is empty
      clearInterval(this.processQueueInterval);
      this.queueProcessing = false;
      return;
    }

    // Check rate limit
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(ts => now - ts < this.requestWindow);

    if (this.requestTimestamps.length >= this.maxRequestsPerWindow) {
      // Still rate limited, wait for next interval
      return;
    }

    // Process next request
    const request = this.requestQueue.shift();
    if (!request) return;

    try {
      // Rate limit enforcement
      this.requestTimestamps.push(now);

      const nonce = Date.now() * 1000;
      const postData = querystring.stringify({ nonce, ...request.data });

      // Create signature
      const secret = Buffer.from(this.apiSecret, 'base64');
      const hash = crypto.createHash('sha256').update(nonce + postData).digest();
      const hmac = crypto.createHmac('sha512', secret);
      hmac.update(request.endpoint, 'utf8');
      hmac.update(hash);
      const signature = hmac.digest('base64');

      const response = await axios.post(`${this.baseUrl}${request.endpoint}`, postData, {
        headers: {
          'API-Key': this.apiKey,
          'API-Sign': signature,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      // Success - reset backoff
      this.rateLimitBackoff = 1000;
      request.resolve(response.data);

    } catch (error) {
      // Handle 429 rate limit errors
      if (error.response?.status === 429) {
        console.log(`⚠️ RATE_LIMIT_429: Re-queuing request after ${this.rateLimitBackoff}ms`);

        // Put request back at front of queue
        this.requestQueue.unshift(request);

        // Pause queue processing
        clearInterval(this.processQueueInterval);
        this.queueProcessing = false;

        // Resume after backoff
        setTimeout(() => {
          this.rateLimitBackoff = Math.min(this.rateLimitBackoff * 2, 8000);
          this.startQueueProcessor();
        }, this.rateLimitBackoff);
      } else {
        // Other errors - reject promise
        request.reject(error);
      }
    }
  }

  async enforceRateLimit() {
    const now = Date.now();

    // Remove timestamps older than 1 second
    this.requestTimestamps = this.requestTimestamps.filter(ts => now - ts < this.requestWindow);

    // If at limit, wait until oldest request expires
    if (this.requestTimestamps.length >= this.maxRequestsPerWindow) {
      const oldestRequest = this.requestTimestamps[0];
      const waitTime = this.requestWindow - (now - oldestRequest);
      if (waitTime > 0) {
        console.log(`⚠️ RATE_LIMIT_DELAY: ${waitTime}ms (${this.requestTimestamps.length}/${this.maxRequestsPerWindow} requests in window)`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // Add current request timestamp
    this.requestTimestamps.push(Date.now());
  }

  /**
   * CHANGE 2026-01-30: Fetch historical OHLC candles from Kraken REST API
   * This provides actual historical data, not just real-time WebSocket updates
   * @param {string} pair - Trading pair (e.g., 'XBTUSD', 'ETHUSD')
   * @param {number} interval - Candle interval in minutes (1, 5, 15, 30, 60, 240, 1440)
   * @param {number} count - Number of candles to fetch (max ~720)
   * @returns {Array} Array of OHLC candles
   */
  async getHistoricalOHLC(pair = 'XBTUSD', interval = 1, count = 200) {
    try {
      // Calculate 'since' timestamp to get approximately 'count' candles
      const intervalMs = interval * 60 * 1000;
      const since = Math.floor((Date.now() - (count * intervalMs)) / 1000);

      const url = `${this.baseUrl}/0/public/OHLC?pair=${pair}&interval=${interval}&since=${since}`;
      console.log(`📊 [Kraken REST] Fetching ${count} historical ${interval}m candles for ${pair}`);

      const response = await axios.get(url);

      if (response.data.error && response.data.error.length > 0) {
        throw new Error(`OHLC error: ${response.data.error.join(', ')}`);
      }

      // Kraken returns { result: { XXBTZUSD: [[time, open, high, low, close, vwap, volume, count], ...], last: ... } }
      const result = response.data.result;
      const pairKey = Object.keys(result).find(k => k !== 'last');

      if (!pairKey || !result[pairKey]) {
        console.warn(`⚠️ [Kraken REST] No OHLC data for ${pair}`);
        return [];
      }

      const candles = result[pairKey];
      console.log(`✅ [Kraken REST] Received ${candles.length} historical candles for ${pair} @ ${interval}m`);

      // Convert to our standard format: { t, etime, o, h, l, c, v }
      // Kraken format: [time, open, high, low, close, vwap, volume, count]
      return candles.map(c => ({
        t: parseFloat(c[0]) * 1000,       // Start time in ms
        etime: (parseFloat(c[0]) + interval * 60) * 1000, // End time in ms
        o: parseFloat(c[1]),
        h: parseFloat(c[2]),
        l: parseFloat(c[3]),
        c: parseFloat(c[4]),
        v: parseFloat(c[6])
      }));

    } catch (error) {
      console.error(`❌ [Kraken REST] Failed to fetch OHLC: ${error.message}`);
      return [];
    }
  }

  async getAccountBalance() {
    const response = await this.makePrivateRequest('/0/private/Balance');
    if (response.error && response.error.length > 0) {
      throw new Error(`Balance error: ${response.error.join(', ')}`);
    }
    return response.result;
  }

  async getPositions() {
    // Kraken doesn't have a direct positions endpoint for spot trading
    // Use balance to determine holdings
    const balance = await this.getAccountBalance();
    const positions = [];

    Object.entries(balance).forEach(([asset, amount]) => {
      if (parseFloat(amount) > 0) {
        positions.push({
          symbol: asset,
          quantity: parseFloat(amount),
          side: 'long'
        });
      }
    });

    return positions;
  }

  // Alias for compatibility with ExchangeReconciler
  async getBalance() {
    const balances = await this.getAccountBalance();
    let totalUSD = 0;

    // Calculate total balance in USD
    Object.entries(balances).forEach(([asset, amount]) => {
      if (asset === 'ZUSD' || asset === 'USD') {
        totalUSD += parseFloat(amount);
      }
      // Add conversion for other assets if needed
    });

    return {
      total: totalUSD,
      available: totalUSD,
      currencies: balances
    };
  }

  // Alias for compatibility - KrakenAdapterSimple uses getPositions
  async getOpenPositions() {
    return await this.getPositions();
  }

  // Get open orders - not implemented in simple adapter
  async getOpenOrders() {
    // Would need to implement via REST API
    // For now return empty array
    return [];
  }

  convertToKrakenSymbol(symbol) {
    // CHANGE 2026-02-10: Full Kraken symbol mapping for all supported assets
    const map = {
      'BTC-USD':   'XXBTZUSD',  'BTC/USD':   'XXBTZUSD',
      'ETH-USD':   'XETHZUSD',  'ETH/USD':   'XETHZUSD',
      'SOL-USD':   'SOLUSD',    'SOL/USD':   'SOLUSD',
      'XRP-USD':   'XXRPZUSD',  'XRP/USD':   'XXRPZUSD',
      'ADA-USD':   'ADAUSD',    'ADA/USD':   'ADAUSD',
      'DOT-USD':   'DOTUSD',    'DOT/USD':   'DOTUSD',
      'AVAX-USD':  'AVAXUSD',   'AVAX/USD':  'AVAXUSD',
      'LINK-USD':  'LINKUSD',   'LINK/USD':  'LINKUSD',
      'MATIC-USD': 'MATICUSD',  'MATIC/USD': 'MATICUSD',
      'UNI-USD':   'UNIUSD',    'UNI/USD':   'UNIUSD',
      'ATOM-USD':  'ATOMUSD',   'ATOM/USD':  'ATOMUSD',
      'LTC-USD':   'XLTCZUSD',  'LTC/USD':   'XLTCZUSD',
      'DOGE-USD':  'XDGUSD',    'DOGE/USD':  'XDGUSD',
      'SHIB-USD':  'SHIBUSD',   'SHIB/USD':  'SHIBUSD',
      'APT-USD':   'APTUSD',    'APT/USD':   'APTUSD',
    };
    return map[symbol] || symbol.replace('-', '').replace('/', '');
  }

  validateOrder(order) {
    const errors = [];

    if (!order.symbol) errors.push('Symbol is required');
    if (!order.side || !['buy', 'sell'].includes(order.side)) {
      errors.push('Side must be "buy" or "sell"');
    }
    if (!order.type || !this.capabilities.orderTypes.includes(order.type)) {
      errors.push(`Order type must be one of: ${this.capabilities.orderTypes.join(', ')}`);
    }
    if (!order.quantity || order.quantity <= 0) {
      errors.push('Quantity must be greater than 0');
    }

    // Check if symbol exists
    const krakenSymbol = this.convertToKrakenSymbol(order.symbol);
    const pair = this.assetPairs.get(krakenSymbol);
    if (!pair) {
      errors.push(`Symbol ${order.symbol} not found in Kraken asset pairs`);
    } else {
      // Check minimum order size
      const minOrder = parseFloat(pair.ordermin || 0);
      if (order.quantity < minOrder) {
        errors.push(`Order quantity ${order.quantity} below minimum ${minOrder}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async placeOrder(order) {
    // Validate order first
    const validation = this.validateOrder(order);
    if (!validation.valid) {
      throw new Error(`Order validation failed: ${validation.errors.join(', ')}`);
    }

    // Convert to Kraken format
    const krakenSymbol = this.convertToKrakenSymbol(order.symbol);

    const orderData = {
      pair: krakenSymbol,
      type: order.side,
      ordertype: order.type,
      volume: order.quantity.toString()
    };

    if (order.type === 'limit' && order.price) {
      orderData.price = order.price.toString();
    }

    try {
      const response = await this.makePrivateRequest('/0/private/AddOrder', orderData);

      if (response.error && response.error.length > 0) {
        throw new Error(`Order error: ${response.error.join(', ')}`);
      }

      return {
        orderId: response.result.txid[0],
        status: 'pending',
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        quantity: order.quantity,
        price: order.price
      };
    } catch (error) {
      throw new Error(`Failed to place order: ${error.message}`);
    }
  }

  // Execute trade method called by bot - translates bot format to Kraken format
  async executeTrade(params) {
    const { direction, positionSize, confidence, marketData } = params;

    // Determine symbol from market data or use BTC-USD as default
    const symbol = marketData?.symbol || 'BTC-USD';

    // Convert direction to Kraken side (buy/sell)
    const side = direction === 'buy' ? 'buy' : 'sell';

    // Use market orders for live trading
    const orderType = 'market';

    // Calculate quantity based on position size and current price
    const price = marketData?.price || this.currentPrices.get(symbol);
    if (!price) {
      throw new Error(`No price available for ${symbol}`);
    }

    const quantity = positionSize / price; // Convert position size to coin quantity

    // Validate quantity
    if (isNaN(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity calculated: ${quantity} for position size ${positionSize} at price ${price}`);
    }

    console.log(`🔥 EXECUTING LIVE ${side.toUpperCase()} ORDER: ${quantity.toFixed(8)} ${symbol.split('-')[0]} at market price`);

    // Place the order
    const order = {
      symbol,
      side,
      type: orderType,
      quantity
    };

    const result = await this.placeOrder(order);

    console.log(`✅ LIVE ORDER PLACED: ${result.orderId} - ${side} ${quantity.toFixed(8)} ${symbol.split('-')[0]}`);

    return result;
  }

  async getMarketData(symbol) {
    const krakenSymbol = this.convertToKrakenSymbol(symbol);

    try {
      const response = await axios.get(`${this.baseUrl}/0/public/Ticker?pair=${krakenSymbol}`);

      if (response.data.error && response.data.error.length > 0) {
        throw new Error(`Market data error: ${response.data.error.join(', ')}`);
      }

      const ticker = response.data.result[krakenSymbol];
      if (!ticker) {
        throw new Error(`No market data found for ${symbol}`);
      }

      // FIX: Validate Kraken message data before returning
      const price = parseFloat(ticker.c[0]);
      const bid = parseFloat(ticker.b[0]);
      const ask = parseFloat(ticker.a[0]);
      const volume = parseFloat(ticker.v[1]);

      if (isNaN(price) || price <= 0 ||
          isNaN(bid) || bid <= 0 ||
          isNaN(ask) || ask <= 0 ||
          isNaN(volume) || volume < 0) {
        throw new Error(`Invalid market data received from Kraken: price=${price}, bid=${bid}, ask=${ask}, volume=${volume}`);
      }

      // FIX: Extract 24h high/low/open for accurate market context
      const high24h = parseFloat(ticker.h?.[1] || ticker.h?.[0] || 0);
      const low24h = parseFloat(ticker.l?.[1] || ticker.l?.[0] || 0);
      const open24h = parseFloat(ticker.o || 0);

      return {
        symbol,
        price, // Last trade price
        bid,   // Bid price
        ask,   // Ask price
        volume, // 24h volume
        high24h,  // 24h high
        low24h,   // 24h low
        open24h,  // 24h open (today's open)
        timestamp: Date.now()
      };
    } catch (error) {
      throw new Error(`Failed to get market data: ${error.message}`);
    }
  }

  supportsSymbol(symbol) {
    const krakenSymbol = this.convertToKrakenSymbol(symbol);
    return this.assetPairs.has(krakenSymbol);
  }

  isCryptoSymbol(symbol) {
    return this.capabilities.crypto; // All Kraken symbols are crypto
  }

  // Add WebSocket streaming for real-time price data
  async connectWebSocketStream(onPriceUpdate) {
    try {
      // Public WebSocket for market data (no auth needed for public feeds)
      this.ws = new WebSocket('wss://ws.kraken.com');

      this.ws.on('open', () => {
        console.log('✅ Kraken WebSocket connected');

        // FIX 2026-02-04: Set connected flag so onclose handler will auto-reconnect
        // THIS WAS THE BUG: connectWebSocketStream() never set this.connected = true
        // So when WebSocket closed, reconnect logic was skipped (if this.connected check failed)
        this.connected = true;

        // CHANGE 2026-01-16: Reset reconnect counter on successful connection
        // Without this, counter accumulates across disconnects and eventually hits max
        if (this.reconnectAttempts > 0) {
          console.log(`🔄 Reconnect successful after ${this.reconnectAttempts} attempts - resetting counter`);
          this.reconnectAttempts = 0;
        }

        // V2 ARCHITECTURE FIX: Single source subscribes to ALL data types
        // Subscribe to both ticker AND OHLC data
        const tickerSub = {
          event: 'subscribe',
          pair: ['XBT/USD'],  // Kraken uses XBT for Bitcoin
          subscription: {
            name: 'ticker'
          }
        };

        // CHANGE 2026-01-29: Subscribe to multiple OHLC timeframes for dashboard
        // Kraken intervals: 1=1m, 5=5m, 15=15m, 30=30m, 60=1h, 240=4h, 1440=1d
        const ohlcIntervals = [1, 5, 15, 30, 60, 240, 1440];

        this.ws.send(JSON.stringify(tickerSub));

        for (const interval of ohlcIntervals) {
          const ohlcSub = {
            event: 'subscribe',
            pair: ['XBT/USD'],
            subscription: {
              name: 'ohlc',
              interval: interval
            }
          };
          this.ws.send(JSON.stringify(ohlcSub));
        }
        console.log('📊 Multi-timeframe: Subscribed to ticker + OHLC (1m, 5m, 15m, 30m, 1h, 4h, 1d)');

        // CHANGE 2026-01-21: Start heartbeat ping interval to keep connection alive
        // Kraken closes idle connections - this prevents that
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.ping();
          }
        }, 30000); // Ping every 30 seconds
        console.log('💓 Heartbeat started (30s ping interval)');

        // CHANGE 2026-01-23: Data watchdog - force reconnect if no data even if socket "open"
        // This catches silent failures where TCP stays alive but Kraken stops sending
        if (this.dataWatchdogInterval) clearInterval(this.dataWatchdogInterval);
        this.lastDataReceived = Date.now(); // Reset on fresh connection
        this.dataWatchdogInterval = setInterval(() => {
          const timeSinceData = Date.now() - this.lastDataReceived;
          if (timeSinceData > this.dataTimeout) {
            console.error(`🚨 DATA WATCHDOG: No data for ${Math.round(timeSinceData/1000)}s - forcing reconnect`);
            // Force close to trigger reconnect logic
            if (this.ws) {
              this.ws.terminate(); // Hard close, don't wait for graceful
            }
          }
        }, 30000); // Check every 30 seconds
        console.log('🔍 Data watchdog started (60s timeout)');
      });

      // CHANGE 2026-01-21: Respond to server pings to prevent timeout
      this.ws.on('ping', () => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.pong();
        }
      });

      // CHANGE 2026-01-21: Track pong responses for connection health
      this.ws.on('pong', () => {
        this.lastPong = Date.now();
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);

          // Kraken sends various message types, filter for ticker updates
          if (Array.isArray(msg) && msg[2] === 'ticker') {
            const tickerData = msg[1];

            // CHANGE 2026-01-23: Update data watchdog timestamp
            this.lastDataReceived = Date.now();

            // FIX #2: Validate price message shape and value
            const price = parseFloat(tickerData?.c?.[0]);
            if (isNaN(price) || price <= 0) {
              console.log('⚠️ WS_PRICE_INVALID: Ignoring malformed Kraken message');
              return;
            }

            // Store latest price for fallback access
            this.currentPrices.set('BTC-USD', {
              price: price,
              timestamp: Date.now(),
              volume: parseFloat(tickerData?.v?.[1]) || 0, // 24h volume
              source: 'kraken'
            });

            // Call the callback with price update
            if (onPriceUpdate) {
              onPriceUpdate({
                type: 'price',
                data: {
                  asset: 'BTC--USD',
                  price: price,
                  timestamp: Date.now(),
                  source: 'kraken'
                }
              });
            }
          }

          // V2 ARCHITECTURE: Handle OHLC data for ALL timeframes
          // CHANGE 2026-01-29: Support multi-timeframe (ohlc-1, ohlc-5, ohlc-15, ohlc-30, ohlc-60, ohlc-1440)
          if (Array.isArray(msg) && typeof msg[2] === 'string' && msg[2].startsWith('ohlc-')) {
            // CHANGE 2026-01-23: Update data watchdog timestamp
            this.lastDataReceived = Date.now();

            // OHLC data format: [channelID, ohlcArray, channelName, pair]
            const ohlcData = msg[1];
            const channelName = msg[2];  // e.g., 'ohlc-1', 'ohlc-5', 'ohlc-15'
            const pair = msg[3];

            // Extract interval from channel name (ohlc-1 → 1, ohlc-60 → 60)
            const interval = parseInt(channelName.split('-')[1], 10);

            // Map Kraken intervals to readable timeframes
            const intervalToTimeframe = {
              1: '1m', 5: '5m', 15: '15m', 30: '30m',
              60: '1h', 240: '4h', 1440: '1d'
            };
            const timeframe = intervalToTimeframe[interval] || `${interval}m`;

            // Emit raw OHLC for KrakenIBrokerAdapter with timeframe info
            if (onPriceUpdate) {
              onPriceUpdate({
                type: 'ohlc',
                data: ohlcData,
                pair: pair,
                timeframe: timeframe,
                interval: interval,
                timestamp: Date.now()
              });
            }
          }
        } catch (err) {
          // Ignore non-JSON messages (Kraken sends heartbeats)
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ Kraken WebSocket error:', error.message);
      });

      this.ws.on('close', () => {
        console.log('🔌 Kraken WebSocket disconnected');

        // CHANGE 2026-01-21: Clear heartbeat interval on disconnect
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }

        // CHANGE 2026-01-23: Clear data watchdog on disconnect
        if (this.dataWatchdogInterval) {
          clearInterval(this.dataWatchdogInterval);
          this.dataWatchdogInterval = null;
        }

        // CHANGE 2026-01-21: Never give up on reconnects - keep trying forever
        // This is critical for stability - a trading bot must stay connected
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
        }

        // Only reconnect if we were intentionally connected (not manually disconnected)
        if (this.connected) {
          this.reconnectAttempts++;

          // Exponential backoff: 5s, 10s, 20s, 40s... capped at 5 minutes
          const baseDelay = 5000;
          const maxDelay = 300000; // 5 minutes max
          const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts - 1), maxDelay);

          // Log warning at certain thresholds but NEVER stop trying
          if (this.reconnectAttempts === 10) {
            console.warn('⚠️ WS_RECONNECT: 10 attempts failed - will keep trying (check network?)');
          } else if (this.reconnectAttempts === 50) {
            console.error('🚨 WS_RECONNECT: 50 attempts failed - serious connectivity issue!');
          }

          console.log(`🔄 WS_RECONNECT delay=${Math.round(delay/1000)}s attempt=${this.reconnectAttempts}`);

          this.reconnectTimeout = setTimeout(() => {
            // Cleanup old websocket
            if (this.ws) {
              this.ws.removeAllListeners();
              try { this.ws.close(); } catch(e) {}
              try { this.ws.terminate(); } catch(e) {}
              this.ws = null;
            }
            this.reconnectTimeout = null;
            this.connectWebSocketStream(onPriceUpdate);
          }, delay);
        }
      });

      return true;
    } catch (error) {
      console.error('❌ Failed to connect Kraken WebSocket:', error.message);
      return false;
    }
  }

  /**
   * Get current price for an asset (used for fallback when WebSocket unavailable)
   */
  getCurrentPrice(asset = 'BTC-USD') {
    const priceData = this.currentPrices.get(asset);
    if (!priceData) {
      return null;
    }

    // Check if price is fresh (within last 60 seconds)
    const age = Date.now() - priceData.timestamp;
    if (age > 60000) {
      return null;
    }

    return priceData;
  }

  async disconnect() {
    // CHANGE 2026-01-21: Clear heartbeat interval on disconnect
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    // CHANGE 2026-01-23: Clear data watchdog on disconnect
    if (this.dataWatchdogInterval) {
      clearInterval(this.dataWatchdogInterval);
      this.dataWatchdogInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    console.log('🔌 Kraken adapter disconnected');
    return true;
  }
}

module.exports = KrakenAdapterSimple;