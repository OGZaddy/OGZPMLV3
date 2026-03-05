# Multi-Broker Arbitrage Architecture Plan

## Status: PLANNED (Not Yet Implemented)
## Date: 2026-01-31

---

## What's Already Built

- ✅ BrokerFactory (creates broker instances)
- ✅ IBrokerAdapter interface (all brokers use same API)
- ✅ KrakenAdapter (working)
- ✅ GeminiAdapter (exists, needs API key permissions fix)
- ✅ BrokerRegistry (lists all brokers with metadata)
- ✅ V2 event-driven architecture

---

## Architecture

```
                    ┌─────────────────────┐
                    │   PRICE AGGREGATOR  │
                    │  (compares prices)  │
                    └──────────┬──────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ KrakenAdapter │    │ GeminiAdapter │    │CoinbaseAdapter│
│   BTC: $82,800│    │   BTC: $82,850│    │   BTC: $82,780│
└───────────────┘    └───────────────┘    └───────────────┘
        │                      │                      │
        └──────────────────────┼──────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  ARBITRAGE ENGINE   │
                    │ Buy Coinbase $82,780│
                    │ Sell Gemini $82,850 │
                    │ Profit: $70 - fees  │
                    └─────────────────────┘
```

---

## Components to Build

### 1. MultiBrokerManager (~100 lines)
**Location:** `core/MultiBrokerManager.js`

```javascript
class MultiBrokerManager extends EventEmitter {
  constructor() {
    this.brokers = new Map(); // name -> adapter instance
  }

  async addBroker(name, config) {
    const adapter = BrokerFactory.create(name, config);
    await adapter.connect();
    this.brokers.set(name, adapter);

    // Forward price events with broker tag
    adapter.on('ticker', (data) => {
      this.emit('ticker', { broker: name, ...data });
    });
  }

  getBroker(name) { return this.brokers.get(name); }
  getAllBrokers() { return Array.from(this.brokers.values()); }
}
```

### 2. PriceAggregator (~80 lines)
**Location:** `core/PriceAggregator.js`

```javascript
class PriceAggregator {
  constructor(brokerManager) {
    this.prices = new Map(); // broker -> { bid, ask, timestamp }

    brokerManager.on('ticker', (data) => {
      this.prices.set(data.broker, {
        bid: data.bid,
        ask: data.ask,
        timestamp: Date.now()
      });
    });
  }

  getBestBuy() {
    // Return broker with lowest ask (cheapest to buy)
    let best = { broker: null, price: Infinity };
    for (const [broker, data] of this.prices) {
      if (data.ask < best.price) {
        best = { broker, price: data.ask };
      }
    }
    return best;
  }

  getBestSell() {
    // Return broker with highest bid (best to sell)
    let best = { broker: null, price: 0 };
    for (const [broker, data] of this.prices) {
      if (data.bid > best.price) {
        best = { broker, price: data.bid };
      }
    }
    return best;
  }

  getSpread() {
    const buy = this.getBestBuy();
    const sell = this.getBestSell();
    return {
      buyFrom: buy.broker,
      buyPrice: buy.price,
      sellTo: sell.broker,
      sellPrice: sell.price,
      spreadPercent: ((sell.price - buy.price) / buy.price) * 100
    };
  }
}
```

### 3. ArbitrageDetector (~60 lines)
**Location:** `core/ArbitrageDetector.js`

```javascript
class ArbitrageDetector extends EventEmitter {
  constructor(priceAggregator, config = {}) {
    this.aggregator = priceAggregator;
    this.minSpreadPercent = config.minSpreadPercent || 0.5; // 0.5% minimum
    this.totalFees = config.totalFees || 0.35; // 0.35% round trip
  }

  check() {
    const spread = this.aggregator.getSpread();
    const netProfit = spread.spreadPercent - this.totalFees;

    if (netProfit > 0 && spread.buyFrom !== spread.sellTo) {
      this.emit('opportunity', {
        ...spread,
        netProfitPercent: netProfit,
        timestamp: Date.now()
      });
      return true;
    }
    return false;
  }
}
```

### 4. Execution Modification (~40 lines)
**Location:** Modify `core/AdvancedExecutionLayer.js`

```javascript
// Add broker parameter to executeOrder
async executeOrder(order, options = {}) {
  const broker = options.broker
    ? this.brokerManager.getBroker(options.broker)
    : this.defaultBroker;

  return broker.placeOrder(order);
}

// Arbitrage execution
async executeArbitrage(opportunity, size) {
  const buyOrder = this.executeOrder(
    { side: 'buy', size, price: opportunity.buyPrice },
    { broker: opportunity.buyFrom }
  );

  const sellOrder = this.executeOrder(
    { side: 'sell', size, price: opportunity.sellPrice },
    { broker: opportunity.sellTo }
  );

  return Promise.all([buyOrder, sellOrder]);
}
```

---

## Implementation Order

1. **MultiBrokerManager** - Foundation for holding multiple connections
2. **PriceAggregator** - Compare prices in real-time
3. **ArbitrageDetector** - Find opportunities
4. **Execution modification** - Route to specific broker

---

## Prerequisites

- [ ] Fix Gemini API key permissions
- [ ] Add Coinbase API credentials
- [ ] Verify all adapters connect successfully
- [ ] Have funds on multiple exchanges
- [ ] Calculate accurate fee structures per exchange

---

## Risks & Considerations

1. **Execution Risk** - One leg fills, other doesn't
2. **Latency** - Price moves before execution
3. **Balance Management** - Need funds on all exchanges
4. **Transfer Costs** - Moving funds between exchanges
5. **Withdrawal Limits** - Exchanges have daily limits

---

## Total Estimate: ~300 lines of new code

The hardest part isn't the code - it's operational:
- Getting API keys working on all exchanges
- Having funds deposited on multiple exchanges
- Testing with real money (paper trading arbitrage is meaningless)
