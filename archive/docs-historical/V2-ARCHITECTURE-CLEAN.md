# V2 Clean Architecture Implementation
## Single Source of Truth via BrokerFactory

### Overview
The V2 architecture establishes **BrokerFactory** as the single source of truth for all market data and broker interactions. This eliminates duplicate connections, ensures data consistency, and provides a clean event-driven architecture.

### Key Principles

1. **Single WebSocket Connection**
   - One connection per broker (Kraken, Coinbase, etc.)
   - No duplicate WebSocket connections anywhere in the codebase
   - All data flows through BrokerFactory

2. **Event-Driven Architecture**
   - Brokers emit events (`connected`, `ohlc`, `ticker`, etc.)
   - Components subscribe to broker events
   - No direct WebSocket connections in consuming modules

3. **Clean Data Flow**
   ```
   Market → Broker Adapter → BrokerFactory → Bot → Dashboard
                    ↓
              (Single WebSocket)
   ```

### Implementation Details

#### BrokerFactory (`/brokers/BrokerFactory.js`)
- Creates and manages broker instances
- Single entry point for all broker interactions
- Handles broker selection based on asset type

#### Broker Adapters
- **IBrokerAdapter** - Interface all brokers must implement
- **KrakenIBrokerAdapter** - Kraken implementation
- **CoinbaseBrokerAdapter** - Coinbase implementation
- **AlpacaBrokerAdapter** - Alpaca implementation

#### Key Changes from V1

1. **Removed Direct Connections**
   - Deleted `connectToMarketData()` from `run-empire-v2.js`
   - Removed duplicate WebSocket in `KrakenIBrokerAdapter`
   - Consolidated all connections through adapters

2. **Event System**
   ```javascript
   // Old V1 approach (multiple connections)
   this.ws = new WebSocket('wss://ws.kraken.com');

   // New V2 approach (single source)
   this.kraken.on('ohlc', (data) => {
     this.handleMarketData(data);
   });
   ```

3. **Unified Data Format**
   - All brokers normalize data to common format
   - Consistent timestamps (UTC milliseconds)
   - Standard symbol formats (BTC/USD, not XBT/USD)

### Configuration

#### Environment Variables
```bash
TRADING_PAIR=BTC/USD        # Trading pair
CANDLE_TIMEFRAME=1m         # Candle timeframe
BROKER=kraken              # Active broker
```

#### Supported Brokers
- **kraken** - Crypto spot trading
- **coinbase** - Crypto spot trading
- **alpaca** - Stocks and crypto
- **polygon** - Market data only

### WebSocket Management

#### Single Connection Per Broker
```javascript
// kraken_adapter_simple.js handles ALL Kraken WebSocket needs
- Ticker data (price updates)
- OHLC data (candles)
- Order updates
- Account updates
```

#### Subscription Management
```javascript
// Subscribe to market data
broker.subscribeToCandles(symbol, timeframe, callback);
broker.subscribeToTicker(symbol, callback);
broker.subscribeToOrderBook(symbol, callback);

// Unsubscribe all
broker.unsubscribeAll();
```

### TRAI Chain-of-Thought Integration

The V2 architecture includes real-time TRAI decision reasoning broadcast:

1. **Decision Context Creation**
   - Patterns detected
   - Indicator values
   - Confidence scores
   - Market regime

2. **Dashboard Display**
   - Dedicated TRAI reasoning panel
   - Real-time updates
   - Color-coded decisions
   - Pattern and indicator details

3. **WebSocket Message**
   ```javascript
   {
     type: 'trai_reasoning',
     decision: 'BUY',
     confidence: 85.2,
     context: {
       patterns: [...],
       indicators: {...},
       regime: 'trending',
       reasoning: 'Strong bullish pattern...'
     }
   }
   ```

### Benefits of V2 Architecture

1. **Data Consistency**
   - Single source eliminates conflicting data
   - Pattern memory stays clean
   - Accurate timestamps

2. **Reduced Complexity**
   - Fewer connections to manage
   - Simpler debugging
   - Clear data flow

3. **Better Performance**
   - Less network overhead
   - Reduced CPU usage
   - Faster response times

4. **Maintainability**
   - Clear separation of concerns
   - Easy to add new brokers
   - Standardized interfaces

### Testing V2 Architecture

#### Verify Single Connection
```bash
pm2 logs ogz-prime-v2 | grep "WebSocket connected"
# Should see only ONE "Kraken WebSocket connected"
```

#### Check Data Flow
```bash
pm2 logs ogz-prime-v2 | grep "V2 ARCHITECTURE"
# Should see subscription and data flow messages
```

#### Monitor TRAI Reasoning
```bash
pm2 logs ogz-prime-v2 | grep "Chain-of-thought"
# Should see reasoning being sent to dashboard
```

### Migration Guide

For modules still using direct connections:

1. Remove direct WebSocket creation
2. Get broker instance from BrokerFactory
3. Subscribe to broker events
4. Handle data in event callbacks

Example migration:
```javascript
// OLD WAY
const ws = new WebSocket('wss://ws.kraken.com');
ws.on('message', handleData);

// NEW WAY
const broker = BrokerFactory.create('kraken');
broker.on('ohlc', handleData);
```

### Future Enhancements

1. **Multi-Exchange Arbitrage**
   - Compare prices across exchanges
   - Execute on best price
   - Unified order management

2. **Failover Support**
   - Automatic broker switching
   - Connection health monitoring
   - Redundant data feeds

3. **Advanced Order Types**
   - Iceberg orders
   - TWAP/VWAP execution
   - Smart order routing

---

*Last Updated: 2025-12-31*
*Version: 2.0.0*