/**
 * OrderRouter - Multi-Broker Order Routing
 *
 * Routes orders to the correct broker based on symbol.
 * This is the multi-instrument unlock - adding a new exchange = one adapter file.
 *
 * ARCHITECTURE:
 * ```
 * ExecutionLayer.executeTrade()
 *        |
 * OrderRouter.sendOrder({ symbol: 'BTC/USD', ... })
 *        |
 *        +---> KrakenAdapter (BTC/USD, ETH/USD)
 *        +---> CoinbaseAdapter (SOL/USD, LINK/USD)
 *        +---> IBAdapter (AAPL, GOOGL)
 * ```
 *
 * @module core/OrderRouter
 */

const EventEmitter = require('events');

class OrderRouter extends EventEmitter {
  constructor() {
    super();

    // Map symbol -> adapter
    this.symbolToAdapter = new Map();

    // Map adapter name -> adapter instance
    this.adapters = new Map();

    // Default adapter for unregistered symbols
    this.defaultAdapter = null;

    console.log('[OrderRouter] Initialized');
  }

  /**
   * Register a broker adapter for specific symbols
   * @param {IBrokerAdapter} adapter - Broker adapter instance
   * @param {string[]} symbols - Symbols this adapter handles ['BTC/USD', 'ETH/USD']
   */
  registerBroker(adapter, symbols) {
    const name = adapter.getBrokerName ? adapter.getBrokerName() : 'unknown';

    // Store adapter reference
    this.adapters.set(name, adapter);

    // Map each symbol to this adapter
    for (const symbol of symbols) {
      const normalized = this.normalizeSymbol(symbol);
      this.symbolToAdapter.set(normalized, adapter);
      console.log(`[OrderRouter] ${normalized} -> ${name}`);
    }

    // First registered adapter becomes default
    if (!this.defaultAdapter) {
      this.defaultAdapter = adapter;
      console.log(`[OrderRouter] Default adapter: ${name}`);
    }

    this.emit('brokerRegistered', { name, symbols });
  }

  /**
   * Set the default adapter for unknown symbols
   * @param {IBrokerAdapter} adapter
   */
  setDefaultAdapter(adapter) {
    this.defaultAdapter = adapter;
    const name = adapter.getBrokerName ? adapter.getBrokerName() : 'unknown';
    console.log(`[OrderRouter] Default adapter set: ${name}`);
  }

  /**
   * Get the adapter for a symbol
   * @param {string} symbol
   * @returns {IBrokerAdapter|null}
   */
  getBrokerForSymbol(symbol) {
    const normalized = this.normalizeSymbol(symbol);
    return this.symbolToAdapter.get(normalized) || this.defaultAdapter;
  }

  /**
   * Normalize symbol format for consistent lookup
   * Handles: BTC/USD, BTC-USD, BTCUSD, XBT/USD -> BTC/USD
   * @param {string} symbol
   * @returns {string}
   */
  normalizeSymbol(symbol) {
    // Convert XBT to BTC (Kraken legacy)
    let normalized = symbol.toUpperCase().replace('XBT', 'BTC');

    // Handle common formats
    if (normalized.includes('/')) {
      return normalized; // Already standard format
    }
    if (normalized.includes('-')) {
      return normalized.replace('-', '/');
    }

    // Try to split 6-char symbols (BTCUSD -> BTC/USD)
    if (normalized.length === 6) {
      return normalized.slice(0, 3) + '/' + normalized.slice(3);
    }

    return normalized;
  }

  /**
   * Send an order to the appropriate broker
   * @param {Object} order - Order details
   * @param {string} order.symbol - Trading symbol
   * @param {string} order.side - 'buy' or 'sell'
   * @param {number} order.amount - Order size
   * @param {string} [order.type='market'] - Order type
   * @param {number} [order.price] - Limit price (if applicable)
   * @param {Object} [order.options] - Additional options
   * @returns {Promise<Object>} Order result
   */
  async sendOrder(order) {
    const { symbol, side, amount, type = 'market', price, options = {} } = order;

    const adapter = this.getBrokerForSymbol(symbol);
    if (!adapter) {
      throw new Error(`[OrderRouter] No adapter registered for symbol: ${symbol}`);
    }

    const brokerName = adapter.getBrokerName ? adapter.getBrokerName() : 'unknown';
    console.log(`[OrderRouter] Routing ${side} ${amount} ${symbol} -> ${brokerName}`);

    // Route to appropriate method
    if (side === 'buy') {
      return adapter.placeBuyOrder(symbol, amount, type === 'limit' ? price : null, options);
    } else if (side === 'sell') {
      return adapter.placeSellOrder(symbol, amount, type === 'limit' ? price : null, options);
    } else {
      throw new Error(`[OrderRouter] Invalid side: ${side}`);
    }
  }

  /**
   * Get all positions across all registered brokers
   * @returns {Promise<Array>} Aggregated positions
   */
  async getAllPositions() {
    const allPositions = [];

    for (const [name, adapter] of this.adapters) {
      try {
        const positions = await adapter.getPositions();
        for (const pos of positions) {
          allPositions.push({
            ...pos,
            broker: name
          });
        }
      } catch (error) {
        console.error(`[OrderRouter] Failed to get positions from ${name}:`, error.message);
      }
    }

    return allPositions;
  }

  /**
   * Get all balances across all registered brokers
   * @returns {Promise<Object>} { brokerName: { currency: amount } }
   */
  async getAllBalances() {
    const balances = {};

    for (const [name, adapter] of this.adapters) {
      try {
        balances[name] = await adapter.getBalance();
      } catch (error) {
        console.error(`[OrderRouter] Failed to get balance from ${name}:`, error.message);
        balances[name] = { error: error.message };
      }
    }

    return balances;
  }

  /**
   * Check if any adapter is connected
   * @returns {boolean}
   */
  isConnected() {
    for (const [, adapter] of this.adapters) {
      if (adapter.isConnected && adapter.isConnected()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get list of registered brokers
   * @returns {string[]}
   */
  getRegisteredBrokers() {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get list of registered symbols
   * @returns {string[]}
   */
  getRegisteredSymbols() {
    return Array.from(this.symbolToAdapter.keys());
  }
}

module.exports = OrderRouter;
