/**
 * @fileoverview KrakenAdapterV2 - IBrokerAdapter-Compliant Kraken Exchange Interface
 *
 * Wraps kraken_adapter_simple.js to provide IBrokerAdapter interface compliance.
 * Enables multi-broker architecture while preserving working Kraken connection.
 *
 * @description
 * ARCHITECTURE ROLE:
 * KrakenAdapterV2 is the bridge between OGZ Prime and the Kraken exchange.
 * It implements IBrokerAdapter interface, allowing the system to support
 * multiple exchanges through a unified API.
 *
 * ```
 * ExecutionLayer
 *       ↓
 * BrokerFactory.create('kraken')
 *       ↓
 * KrakenAdapterV2 (implements IBrokerAdapter)
 *       ↓
 * KrakenAdapterSimple (actual API calls)
 *       ↓
 * Kraken Exchange API / WebSocket
 * ```
 *
 * TECHNICAL DEBT NOTE:
 * This wrapper exists because kraken_adapter_simple.js works but doesn't
 * implement IBrokerAdapter. Rather than risk breaking a working connection,
 * we wrapped it. Future migration plan:
 * 1. Use wrapper to get system stable (CURRENT)
 * 2. Write proper native KrakenAdapter with tests
 * 3. Migrate once proven stable
 *
 * @module core/KrakenAdapterV2
 * @extends IBrokerAdapter
 * @requires ../foundation/IBrokerAdapter
 * @requires ../kraken_adapter_simple
 *
 * @example
 * const KrakenAdapterV2 = require('./core/KrakenAdapterV2');
 * const adapter = new KrakenAdapterV2({ apiKey, apiSecret });
 *
 * await adapter.connect();
 * const balance = await adapter.getBalance();
 * const order = await adapter.placeOrder('XBT/USD', 'buy', 0.001, { type: 'market' });
 */

const IBrokerAdapter = require('../brokers/IBrokerAdapter');
const KrakenAdapterSimple = require('../kraken_adapter_simple');
const { getStateManager } = require('./StateManager');
const TradingConfig = require('./TradingConfig');

class KrakenAdapterV2 extends IBrokerAdapter {
  constructor(config = {}) {
    super();

    // Use the existing working adapter internally
    this.simple = new KrakenAdapterSimple(config);

    // Get state manager for position tracking
    this.stateManager = getStateManager();

    // Track connection status
    this.connected = false;

    console.warn('[KrakenAdapterV2] Using wrapped adapter - technical debt, migrate to native v2');
  }

  // =========================================================================
  // CONNECTION MANAGEMENT
  // =========================================================================

  async connect() {
    try {
      await this.simple.connect();
      this.connected = true;

      // Also connect WebSocket for real-time data
      await this.simple.connectWebSocketStream(
        'XBT/USD',
        (data) => this.emit('marketData', data),
        (error) => this.emit('error', error)
      );

      return true;
    } catch (error) {
      console.error('[KrakenAdapterV2] Connection failed:', error);
      return false;
    }
  }

  async disconnect() {
    await this.simple.disconnect();
    this.connected = false;
  }

  isConnected() {
    return this.connected && this.simple.isConnected();
  }

  // =========================================================================
  // ACCOUNT INFO
  // =========================================================================

  async getBalance() {
    try {
      const balance = await this.simple.getAccountBalance();
      return balance;
    } catch (error) {
      console.error('[KrakenAdapterV2] Get balance failed:', error);
      return {};
    }
  }

  async getPositions() {
    // Simple adapter doesn't track positions, use StateManager
    const activeTrades = this.stateManager.getAllTrades();
    return activeTrades.map(trade => ({
      symbol: trade.symbol || 'XBT/USD',
      size: trade.size,
      entryPrice: trade.entryPrice,
      currentPrice: trade.currentPrice || trade.entryPrice,
      pnl: trade.pnl || 0
    }));
  }

  async getOpenOrders() {
    // Simple adapter doesn't track open orders
    // Would need to implement via REST API
    console.warn('[KrakenAdapterV2] getOpenOrders not implemented in simple adapter');
    return [];
  }

  // =========================================================================
  // ORDER MANAGEMENT
  // =========================================================================

  async placeBuyOrder(symbol, amount, price = null, options = {}) {
    try {
      const orderData = {
        symbol: symbol,
        side: 'buy',
        amount: amount,
        price: price,
        type: price ? 'limit' : 'market',
        ...options
      };

      const result = await this.simple.placeOrder(orderData);

      // Track in StateManager
      if (result.success) {
        this.stateManager.updateActiveTrade(result.orderId, {
          orderId: result.orderId,
          symbol: symbol,
          action: 'BUY',
          size: amount,
          entryPrice: price || result.price,
          entryTime: Date.now(),
          status: 'open'
        });
      }

      return result;
    } catch (error) {
      console.error('[KrakenAdapterV2] Buy order failed:', error);
      return { success: false, error: error.message };
    }
  }

  async placeSellOrder(symbol, amount, price = null, options = {}) {
    try {
      const orderData = {
        symbol: symbol,
        side: 'sell',
        amount: amount,
        price: price,
        type: price ? 'limit' : 'market',
        ...options
      };

      const result = await this.simple.placeOrder(orderData);

      // Update StateManager on successful sell
      if (result.success) {
        // Find and remove the corresponding buy trade
        const activeTrades = this.stateManager.getAllTrades();
        const buyTrade = activeTrades.find(t => t.action === 'BUY');
        if (buyTrade) {
          this.stateManager.removeActiveTrade(buyTrade.orderId);
        }
      }

      return result;
    } catch (error) {
      console.error('[KrakenAdapterV2] Sell order failed:', error);
      return { success: false, error: error.message };
    }
  }

  async cancelOrder(orderId) {
    try {
      return await this.simple.cancelOrder(orderId);
    } catch (error) {
      console.error('[KrakenAdapterV2] Cancel order failed:', error);
      return false;
    }
  }

  async modifyOrder(orderId, modifications) {
    // Simple adapter doesn't support order modification
    console.warn('[KrakenAdapterV2] Order modification not supported - cancel and replace');
    return { success: false, error: 'Not implemented' };
  }

  async getOrderStatus(orderId) {
    // Simple adapter doesn't track order status
    // Would need to implement via REST API
    console.warn('[KrakenAdapterV2] getOrderStatus not implemented in simple adapter');
    return { orderId, status: 'unknown' };
  }

  // =========================================================================
  // MARKET DATA
  // =========================================================================

  async getTicker(symbol) {
    try {
      return await this.simple.getMarketData(symbol);
    } catch (error) {
      console.error('[KrakenAdapterV2] Get ticker failed:', error);
      return null;
    }
  }

  async getCandles(symbol, timeframe = '1m', limit = 100) {
    // Simple adapter doesn't support candle history
    console.warn('[KrakenAdapterV2] Candle history not implemented in simple adapter');
    return [];
  }

  async getOrderBook(symbol, depth = 20) {
    // Simple adapter doesn't support order book
    console.warn('[KrakenAdapterV2] Order book not implemented in simple adapter');
    return { bids: [], asks: [] };
  }

  // =========================================================================
  // REAL-TIME SUBSCRIPTIONS
  // =========================================================================

  subscribeToTicker(symbol, callback) {
    // Already connected in connect() method
    this.on('marketData', callback);
  }

  subscribeToCandles(symbol, timeframe, callback) {
    // Simple adapter only has OHLC via WebSocket
    this.on('marketData', (data) => {
      if (data.type === 'ohlc') {
        callback(data);
      }
    });
  }

  subscribeToOrderBook(symbol, callback) {
    console.warn('[KrakenAdapterV2] Order book subscription not implemented');
  }

  subscribeToAccount(callback) {
    // Simple adapter has no private WebSocket
    // Poll for account updates instead
    console.warn('[KrakenAdapterV2] Account subscription via polling (no private WS)');

    // CHANGE 2026-01-29: Store interval for cleanup
    this.accountPollingInterval = setInterval(async () => {
      try {
        const balance = await this.getBalance();
        const positions = await this.getPositions();
        callback({ balance, positions });
      } catch (error) {
        console.error('[KrakenAdapterV2] Account polling error:', error);
      }
    }, 5000); // Poll every 5 seconds
  }

  unsubscribeAll() {
    this.removeAllListeners();
    // CHANGE 2026-01-29: Clear polling interval
    if (this.accountPollingInterval) {
      clearInterval(this.accountPollingInterval);
      this.accountPollingInterval = null;
    }
  }

  // =========================================================================
  // ASSET INFORMATION
  // =========================================================================

  getAssetType() {
    return 'crypto';
  }

  getBrokerName() {
    return 'kraken';
  }

  async getSupportedSymbols() {
    try {
      const pairs = await this.simple.getAssetPairs();
      return Object.keys(pairs);
    } catch (error) {
      console.error('[KrakenAdapterV2] Get symbols failed:', error);
      return ['XBT/USD']; // Fallback to known working pair
    }
  }

  getMinOrderSize(symbol) {
    // Kraken minimums (approximate)
    const minimums = {
      'XBT/USD': 0.0001,
      'ETH/USD': 0.001,
      'default': 0.001
    };
    return minimums[symbol] || minimums.default;
  }

  getFees() {
    return {
      maker: TradingConfig.get('fees.makerFee'), // From TradingConfig
      taker: TradingConfig.get('fees.takerFee')  // From TradingConfig
    };
  }

  isTradeableNow(symbol) {
    // Crypto trades 24/7
    return true;
  }

  // =========================================================================
  // SYMBOL CONVERSION (Already in simple adapter)
  // =========================================================================

  toBrokerSymbol(symbol) {
    return this.simple.convertToKrakenSymbol(symbol);
  }

  fromBrokerSymbol(brokerSymbol) {
    // Simple adapter doesn't have reverse conversion
    const map = {
      'XXBTZUSD': 'BTC/USD',
      'XETHZUSD': 'ETH/USD'
    };
    return map[brokerSymbol] || brokerSymbol;
  }
}

module.exports = KrakenAdapterV2;