/**
 * Instrument.js - Canonical Instrument Identity Model
 * ====================================================
 *
 * Separates instrument identity from display ticker.
 * Critical for multi-broker normalization where the same asset
 * has different symbols across brokers.
 *
 * Examples:
 * - Bitcoin: BTC (Coinbase), XBT (Kraken), BTCUSD (Binance)
 * - S&P 500 ETF: SPY across all US equity brokers
 * - Apple: AAPL (symbol) vs US0378331005 (ISIN)
 *
 * ASSET CLASSES:
 * - equity:  Individual stocks (AAPL, GOOGL, MSFT)
 * - etf:     Exchange-traded funds (SPY, QQQ, IWM)
 * - option:  Options contracts
 * - crypto:  Cryptocurrencies (BTC, ETH)
 * - forex:   Foreign exchange pairs (EUR/USD)
 * - futures: Futures contracts (ES, NQ)
 *
 * @module foundation/Instrument
 * @author Claude (Opus) for Trey / OGZPrime
 * @date 2026-03-17
 */

'use strict';

/**
 * Normalized order status values
 * Maps broker-specific statuses to canonical values
 */
const ORDER_STATUS = {
  PENDING: 'pending',           // Order submitted, not yet accepted
  ACCEPTED: 'accepted',         // Order accepted by broker
  WORKING: 'working',           // Order is live in the market
  PARTIALLY_FILLED: 'partial',  // Some quantity filled
  FILLED: 'filled',             // Completely filled
  CANCELED: 'canceled',         // Canceled by user or system
  REJECTED: 'rejected',         // Rejected by broker
  EXPIRED: 'expired',           // Time-in-force expired
};

/**
 * Asset class enumeration
 */
const ASSET_CLASS = {
  EQUITY: 'equity',
  ETF: 'etf',
  OPTION: 'option',
  CRYPTO: 'crypto',
  FOREX: 'forex',
  FUTURES: 'futures',
};

/**
 * Canonical Instrument model
 */
class Instrument {
  constructor(data = {}) {
    // === IDENTITY ===
    this.symbol = data.symbol || '';                    // Canonical symbol (e.g., 'SPY', 'BTC')
    this.name = data.name || '';                        // Full name (e.g., 'SPDR S&P 500 ETF Trust')
    this.assetClass = data.assetClass || ASSET_CLASS.EQUITY;

    // === IDENTIFIERS ===
    this.cusip = data.cusip || null;                    // US identifier (stocks/ETFs)
    this.isin = data.isin || null;                      // International identifier
    this.figi = data.figi || null;                      // Bloomberg FIGI

    // === EXCHANGE INFO ===
    this.exchange = data.exchange || null;              // Primary exchange (NYSE, NASDAQ, etc.)
    this.currency = data.currency || 'USD';             // Quote currency
    this.country = data.country || 'US';                // Country of listing

    // === BROKER MAPPINGS ===
    // Maps broker name to broker-specific symbol
    this.brokerSymbols = data.brokerSymbols || {};
    // Example: { 'kraken': 'XBTUSD', 'binance': 'BTCUSDT', 'coinbase': 'BTC-USD' }

    // === TRADING PROPERTIES ===
    this.tradeable = data.tradeable !== false;          // Can be traded
    this.shortable = data.shortable || false;           // Can be shorted
    this.marginable = data.marginable || false;         // Eligible for margin
    this.optionsEligible = data.optionsEligible || false; // Has options chain

    // === FRACTIONAL TRADING ===
    this.fractionalEnabled = data.fractionalEnabled || false;
    this.fractionalMinQty = data.fractionalMinQty || null;  // e.g., 0.001 for crypto
    this.fractionalIncrement = data.fractionalIncrement || null;

    // === LOT SIZE / PRECISION ===
    this.lotSize = data.lotSize || 1;                   // Minimum tradeable quantity
    this.priceIncrement = data.priceIncrement || 0.01;  // Tick size
    this.quantityPrecision = data.quantityPrecision || 0; // Decimal places for qty
    this.pricePrecision = data.pricePrecision || 2;     // Decimal places for price

    // === MARKET HOURS ===
    this.tradingHours = data.tradingHours || 'regular'; // 'regular', 'extended', '24/7'

    // === METADATA ===
    this.sector = data.sector || null;                  // GICS sector
    this.industry = data.industry || null;              // GICS industry
    this.marketCap = data.marketCap || null;            // Market cap category
    this.lastUpdated = data.lastUpdated || Date.now();
  }

  /**
   * Get broker-specific symbol
   * @param {string} brokerName - e.g., 'kraken', 'schwab', 'binance'
   * @returns {string} Broker-specific symbol or canonical symbol if no mapping
   */
  getBrokerSymbol(brokerName) {
    return this.brokerSymbols[brokerName.toLowerCase()] || this.symbol;
  }

  /**
   * Set broker-specific symbol mapping
   * @param {string} brokerName
   * @param {string} brokerSymbol
   */
  setBrokerSymbol(brokerName, brokerSymbol) {
    this.brokerSymbols[brokerName.toLowerCase()] = brokerSymbol;
  }

  /**
   * Check if this is a crypto asset (24/7 trading)
   * @returns {boolean}
   */
  isCrypto() {
    return this.assetClass === ASSET_CLASS.CRYPTO;
  }

  /**
   * Check if this is an equity (stock or ETF)
   * @returns {boolean}
   */
  isEquity() {
    return this.assetClass === ASSET_CLASS.EQUITY || this.assetClass === ASSET_CLASS.ETF;
  }

  /**
   * Check if fractional trading is supported
   * @returns {boolean}
   */
  supportsFractional() {
    return this.fractionalEnabled;
  }

  /**
   * Validate a quantity against instrument constraints
   * @param {number} quantity
   * @returns {{valid: boolean, reason: string|null, adjusted: number}}
   */
  validateQuantity(quantity) {
    if (quantity <= 0) {
      return { valid: false, reason: 'Quantity must be positive', adjusted: 0 };
    }

    // Check minimum lot size
    if (quantity < this.lotSize) {
      return {
        valid: false,
        reason: `Minimum quantity is ${this.lotSize}`,
        adjusted: this.lotSize
      };
    }

    // Check fractional rules
    if (!this.fractionalEnabled && quantity % 1 !== 0) {
      const adjusted = Math.floor(quantity);
      return {
        valid: false,
        reason: 'Fractional shares not supported',
        adjusted: adjusted > 0 ? adjusted : this.lotSize
      };
    }

    // Check fractional minimum
    if (this.fractionalEnabled && this.fractionalMinQty && quantity < this.fractionalMinQty) {
      return {
        valid: false,
        reason: `Minimum fractional quantity is ${this.fractionalMinQty}`,
        adjusted: this.fractionalMinQty
      };
    }

    return { valid: true, reason: null, adjusted: quantity };
  }

  /**
   * Round quantity to valid precision
   * @param {number} quantity
   * @returns {number}
   */
  roundQuantity(quantity) {
    const factor = Math.pow(10, this.quantityPrecision);
    return Math.floor(quantity * factor) / factor;
  }

  /**
   * Round price to valid tick size
   * @param {number} price
   * @returns {number}
   */
  roundPrice(price) {
    return Math.round(price / this.priceIncrement) * this.priceIncrement;
  }

  /**
   * Serialize to plain object
   * @returns {Object}
   */
  toJSON() {
    return {
      symbol: this.symbol,
      name: this.name,
      assetClass: this.assetClass,
      cusip: this.cusip,
      isin: this.isin,
      figi: this.figi,
      exchange: this.exchange,
      currency: this.currency,
      country: this.country,
      brokerSymbols: this.brokerSymbols,
      tradeable: this.tradeable,
      shortable: this.shortable,
      marginable: this.marginable,
      optionsEligible: this.optionsEligible,
      fractionalEnabled: this.fractionalEnabled,
      fractionalMinQty: this.fractionalMinQty,
      fractionalIncrement: this.fractionalIncrement,
      lotSize: this.lotSize,
      priceIncrement: this.priceIncrement,
      quantityPrecision: this.quantityPrecision,
      pricePrecision: this.pricePrecision,
      tradingHours: this.tradingHours,
      sector: this.sector,
      industry: this.industry,
      marketCap: this.marketCap,
      lastUpdated: this.lastUpdated,
    };
  }

  /**
   * Create from plain object
   * @param {Object} data
   * @returns {Instrument}
   */
  static fromJSON(data) {
    return new Instrument(data);
  }
}

/**
 * Normalized Order model
 * Canonical order representation across all brokers
 */
class NormalizedOrder {
  constructor(data = {}) {
    // === IDENTIFIERS ===
    this.clientOrderId = data.clientOrderId || null;    // Our internal ID
    this.brokerOrderId = data.brokerOrderId || null;    // Broker's order ID
    this.brokerName = data.brokerName || null;

    // === ORDER DETAILS ===
    this.symbol = data.symbol || '';                    // Canonical symbol
    this.side = data.side || 'buy';                     // 'buy' or 'sell'
    this.type = data.type || 'market';                  // 'market', 'limit', 'stop', 'stop_limit', 'trailing_stop'
    this.timeInForce = data.timeInForce || 'day';       // 'day', 'gtc', 'ioc', 'fok'

    // === QUANTITIES ===
    this.quantity = data.quantity || 0;                 // Requested quantity
    this.filledQuantity = data.filledQuantity || 0;     // Quantity filled so far
    this.remainingQuantity = data.remainingQuantity ?? (this.quantity - this.filledQuantity);

    // === PRICES ===
    this.limitPrice = data.limitPrice || null;          // For limit orders
    this.stopPrice = data.stopPrice || null;            // For stop orders
    this.trailAmount = data.trailAmount || null;        // For trailing stops ($ or %)
    this.trailPercent = data.trailPercent || null;
    this.avgFillPrice = data.avgFillPrice || null;      // Average fill price

    // === STATUS ===
    this.status = data.status || ORDER_STATUS.PENDING;

    // === FEES ===
    this.commission = data.commission || 0;
    this.fees = data.fees || 0;

    // === TIMESTAMPS ===
    this.createdAt = data.createdAt || Date.now();
    this.updatedAt = data.updatedAt || Date.now();
    this.filledAt = data.filledAt || null;

    // === SESSION ===
    this.extendedHours = data.extendedHours || false;   // Pre/after market order
  }

  /**
   * Check if order is still active/working
   * @returns {boolean}
   */
  isActive() {
    return [
      ORDER_STATUS.PENDING,
      ORDER_STATUS.ACCEPTED,
      ORDER_STATUS.WORKING,
      ORDER_STATUS.PARTIALLY_FILLED
    ].includes(this.status);
  }

  /**
   * Check if order is complete (filled or terminal state)
   * @returns {boolean}
   */
  isComplete() {
    return [
      ORDER_STATUS.FILLED,
      ORDER_STATUS.CANCELED,
      ORDER_STATUS.REJECTED,
      ORDER_STATUS.EXPIRED
    ].includes(this.status);
  }

  /**
   * Check if order was successful (filled)
   * @returns {boolean}
   */
  isFilled() {
    return this.status === ORDER_STATUS.FILLED;
  }

  /**
   * Get fill percentage
   * @returns {number} 0-100
   */
  getFillPercent() {
    if (this.quantity === 0) return 0;
    return (this.filledQuantity / this.quantity) * 100;
  }

  /**
   * Serialize to plain object
   * @returns {Object}
   */
  toJSON() {
    return { ...this };
  }
}

/**
 * Common ETF instruments (pre-defined for quick access)
 */
const COMMON_ETFS = {
  SPY: new Instrument({
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    assetClass: ASSET_CLASS.ETF,
    exchange: 'NYSE',
    currency: 'USD',
    optionsEligible: true,
    shortable: true,
    marginable: true,
    sector: 'Index',
  }),
  QQQ: new Instrument({
    symbol: 'QQQ',
    name: 'Invesco QQQ Trust',
    assetClass: ASSET_CLASS.ETF,
    exchange: 'NASDAQ',
    currency: 'USD',
    optionsEligible: true,
    shortable: true,
    marginable: true,
    sector: 'Index',
  }),
  IWM: new Instrument({
    symbol: 'IWM',
    name: 'iShares Russell 2000 ETF',
    assetClass: ASSET_CLASS.ETF,
    exchange: 'NYSE',
    currency: 'USD',
    optionsEligible: true,
    shortable: true,
    marginable: true,
    sector: 'Index',
  }),
  DIA: new Instrument({
    symbol: 'DIA',
    name: 'SPDR Dow Jones Industrial Average ETF',
    assetClass: ASSET_CLASS.ETF,
    exchange: 'NYSE',
    currency: 'USD',
    optionsEligible: true,
    shortable: true,
    marginable: true,
    sector: 'Index',
  }),
};

/**
 * Common crypto instruments
 */
const COMMON_CRYPTO = {
  BTC: new Instrument({
    symbol: 'BTC',
    name: 'Bitcoin',
    assetClass: ASSET_CLASS.CRYPTO,
    currency: 'USD',
    tradingHours: '24/7',
    fractionalEnabled: true,
    fractionalMinQty: 0.0001,
    quantityPrecision: 8,
    pricePrecision: 2,
    brokerSymbols: {
      kraken: 'XBTUSD',
      binance: 'BTCUSDT',
      coinbase: 'BTC-USD',
    },
  }),
  ETH: new Instrument({
    symbol: 'ETH',
    name: 'Ethereum',
    assetClass: ASSET_CLASS.CRYPTO,
    currency: 'USD',
    tradingHours: '24/7',
    fractionalEnabled: true,
    fractionalMinQty: 0.001,
    quantityPrecision: 8,
    pricePrecision: 2,
    brokerSymbols: {
      kraken: 'ETHUSD',
      binance: 'ETHUSDT',
      coinbase: 'ETH-USD',
    },
  }),
};

module.exports = {
  Instrument,
  NormalizedOrder,
  ORDER_STATUS,
  ASSET_CLASS,
  COMMON_ETFS,
  COMMON_CRYPTO,
};
