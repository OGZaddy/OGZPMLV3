# OGZ Prime Platform Refactor Plan - 2026-02-27

## STATUS: PLAN ONLY - DO NOT EXECUTE WITHOUT REVIEW

**Vision:** Multi-asset, multi-broker trading platform
**Assets:** Crypto, Stocks, Futures, Forex, Options
**Capabilities:** Arbitrage, multi-broker execution, unified strategy engine

**Baseline:** `run-empire-v2.js.FROZEN-2026-02-27` (212KB, 4519 lines)

---

## DESIGN PRINCIPLES

### 1. SELF-CONTAINED
Each module contains EVERYTHING it needs. No hidden dependencies.
If a module needs something, it declares it in constructor or config.

### 2. HOT-SWAPPABLE
Any module can be bolted on or off at runtime.
Runner doesn't break if a module is missing - it degrades gracefully.

### 3. NAME = FUNCTION
Module name tells you EXACTLY what it does. No vague names.
- `CandleStore` stores candles
- `OrderRouter` routes orders
- `StopLossChecker` checks stop losses

### 4. SINGLE RESPONSIBILITY
Each module does ONE thing. If you need two things, use two modules.

### 5. EXPLICIT CONTRACTS
Every input/output is typed and documented. No magic.

### 6. CONTRACTS THAT SCREAM
Every module boundary validates incoming data. Silent corruption is impossible.

---

## ⚠️ CONTRACT STANDARDS (THE LAW)

These standards are non-negotiable. Every bug we've fixed lived at a boundary where these were violated.

### CONFIDENCE: 0-100 EVERYWHERE

**At every module boundary, confidence is 0-100. No exceptions.**

```javascript
// CORRECT - at boundaries
confidence: 75,      // 0-100 scale

// INTERNAL ONLY - convert before returning
const internalConf = 0.75;  // 0-1 for math
return { confidence: internalConf * 100 };  // Convert at boundary
```

**This fixes:** Bug 6 (HOLD confidence wrong format), P1 (RSI normalization mismatch)

### UNIT ANNOTATIONS REQUIRED

Every numeric field in every contract MUST have:
1. Unit (dollars, percent, normalized 0-1, etc.)
2. Valid range
3. Example value

```javascript
// WRONG - just "number"
atr: number,

// RIGHT - unit + range + example
atr: number,  // Dollars. Range: 0-∞. Example: $523 for BTC
```

**This fixes:** Bug 1 (ATR not normalized), Bug 4 (BB bandwidth missing)

### NO FALLBACK PATHS

One path, one format. If you need a different format, create a different field.

```javascript
// WRONG - fallback creates mismatch
const volatility = indicators.volatility ?? indicators.atr / price;

// RIGHT - single source of truth
const volatility = indicatorSnapshot.volatilityNormalized;
// If missing, THROW - don't silently compute a different value
```

---

## ⚠️ KNOWN BUGS BEING FIXED

These are existing bugs in the monolith that the refactor MUST correct. Not implied - explicitly fixed.

### BUG FIX 1: Gate Ordering

**Current (WRONG):** Gates checked AFTER ExecutionLayer.executeTrade()
**Refactored (CORRECT):** Gates checked BEFORE OrderExecutor.executeOrder()

```
CURRENT (buggy):
Signal → EntryDecider → ExecutionLayer.executeTrade() → THEN gates check → oops, already in trade

REFACTORED (correct):
Signal → EntryDecider → EntryGateChecker.checkAll() → PASS → OrderExecutor.executeOrder()
```

**Enforcement:** EntryDecider MUST call EntryGateChecker before returning `enter: true`.

### BUG FIX 2: Trade Object Mutation

**Current (WRONG):** Multiple modules mutate trade.maxProfitPercent directly
**Refactored (CORRECT):** Only PositionTracker can mutate Trade objects

```javascript
// WRONG - direct mutation from exit checker
trade.maxProfitPercent = Math.max(trade.maxProfitPercent, currentPnl);

// RIGHT - request update through PositionTracker
positionTracker.updateTradeField(tradeId, 'maxProfitPercent', newValue);
```

**Trade object is READ-ONLY to all modules except PositionTracker.**

### BUG FIX 3: Indicator Reshape

**Current (WRONG):** Multiple places reshape engineState → indicators with different logic
**Refactored (CORRECT):** Single IndicatorSnapshot module does ALL reshaping

---

## 1. TARGET ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OGZ PRIME PLATFORM                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         RUNNER / ORCHESTRATOR                        │   │
│  │                         (run-empire-v2.js)                          │   │
│  │    - Main loop                                                       │   │
│  │    - Module initialization                                           │   │
│  │    - Config loading                                                  │   │
│  │    - Lifecycle management (start/stop/restart)                       │   │
│  │    - ~500 lines target                                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│         ┌────────────────────────────┼────────────────────────────┐        │
│         │                            │                            │        │
│         ▼                            ▼                            ▼        │
│  ┌─────────────┐            ┌─────────────┐            ┌─────────────┐    │
│  │   BROKER    │            │  STRATEGY   │            │    DATA     │    │
│  │   LAYER     │            │   ENGINE    │            │   LAYER     │    │
│  └─────────────┘            └─────────────┘            └─────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. CORE MODULES

### Module: `OrderRouter` (`core/OrderRouter.js`)

**Does:** Routes orders to the correct broker and returns execution result.
**Self-contained:** Yes - just needs broker adapters injected at startup.
**Hot-swap:** Yes - can swap broker adapters without restart.

```javascript
// WHAT'S IN THE BOX:
class OrderRouter {
  constructor(brokerAdapters) {
    this.brokers = new Map();  // symbol -> adapter
    this.defaultBroker = null;
  }

  // Register a broker for specific symbols
  registerBroker(adapter, symbols) {}

  // Route and execute
  async sendOrder(order) → ExecutionResult {}
  async cancelOrder(orderId, broker) → CancelResult {}

  // Query across brokers
  async getAllPositions() → Position[] {}
  async getAllBalances() → Balance[] {}
}
```

---

### Module: `KrakenBroker` (`core/brokers/KrakenBroker.js`)

**Does:** Connects to Kraken, sends orders, streams market data.
**Self-contained:** Yes - only needs API keys in config.
**Hot-swap:** Yes - can be replaced with any broker implementing same interface.

```javascript
// WHAT'S IN THE BOX:
class KrakenBroker {
  constructor(config) {
    // config: { apiKey, apiSecret, wsUrl }
  }

  // Connection
  async connect() → { success, error? }
  async disconnect() → void
  isConnected() → boolean

  // Market Data
  subscribeCandles(symbol, timeframe, callback) → subId
  subscribeTicker(symbol, callback) → subId
  unsubscribe(subId) → void

  // Orders
  async placeOrder(order) → { orderId, status, filled, avgPrice }
  async cancelOrder(orderId) → { success, error? }
  async getOrder(orderId) → OrderDetails

  // Account
  async getBalance() → { total, available, byAsset }
  async getPositions() → Position[]
}
```

Same interface for: `AlpacaBroker`, `IBKRBroker`, `CoinbaseBroker`, `BinanceBroker`

**Interface Contract:**
```javascript
class BrokerInterface {
  // Connection
  async connect() → { success: boolean, error?: string }
  async disconnect() → void
  isConnected() → boolean

  // Market Data
  subscribeToMarket(symbol, callback) → subscriptionId
  unsubscribe(subscriptionId) → void
  async getQuote(symbol) → { bid, ask, last, volume }
  async getCandles(symbol, timeframe, limit) → OHLCV[]

  // Orders
  async placeOrder(order) → { orderId, status, filled, error? }
  async cancelOrder(orderId) → { success, error? }
  async getOrder(orderId) → OrderDetails
  async getOpenOrders() → Order[]

  // Account
  async getBalance() → { total, available, margin }
  async getPositions() → Position[]

  // Asset Info
  getAssetType() → 'crypto' | 'stock' | 'futures' | 'forex' | 'options'
  getSymbolFormat(symbol) → string  # Normalize symbol across brokers
  getMinOrderSize(symbol) → number
  getFees(symbol) → { maker, taker }
}
```

**What moves from run-empire-v2.js:**
- Kraken WebSocket handling (lines 799-1007)
- Order execution (lines 2692-2750)
- Balance/position queries

---

---

### Module: `CandleStore` (`core/CandleStore.js`)

**Does:** Stores candles by symbol and timeframe. That's it.
**Self-contained:** Yes - pure data structure, no external deps.
**Hot-swap:** Yes - can swap storage backend (memory, redis, sqlite).

```javascript
// WHAT'S IN THE BOX:
class CandleStore {
  constructor(config) {
    // config: { maxCandles: 500, persist: false }
  }

  // Store
  addCandle(symbol, timeframe, candle) → void
  addCandles(symbol, timeframe, candles) → void

  // Retrieve
  getCandles(symbol, timeframe, limit) → OHLCV[]
  getLatestCandle(symbol, timeframe) → OHLCV | null
  getCandleAt(symbol, timeframe, timestamp) → OHLCV | null

  // Metadata
  getSymbols() → string[]
  getTimeframes(symbol) → string[]
  getCandleCount(symbol, timeframe) → number
}
```

---

### Module: `IndicatorCalculator` (`core/IndicatorCalculator.js`)

**Does:** Calculates indicators from candles. Pure math, no side effects.
**Self-contained:** Yes - takes candles in, returns numbers out.
**Hot-swap:** Yes - can swap calculation library.

```javascript
// WHAT'S IN THE BOX:
class IndicatorCalculator {
  // Each method takes candles, returns indicator value(s)

  calculateRSI(candles, period = 14) → number
  calculateMACD(candles, fast = 12, slow = 26, signal = 9) → { macd, signal, hist }
  calculateBB(candles, period = 20, stdDev = 2) → { upper, middle, lower }
  calculateATR(candles, period = 14) → number
  calculateEMA(candles, period) → number
  calculateSMA(candles, period) → number
  calculateVWAP(candles) → number

  // Convenience: calculate all at once
  calculateAll(candles) → {
    rsi: number,
    macd: { macd, signal, hist },
    bb: { upper, middle, lower },
    atr: number,
    ema9: number, ema21: number, ema50: number, ema200: number,
    sma20: number, sma50: number
  }
}
```

---

### Module: `RegimeDetector` (`core/RegimeDetector.js`)

**Does:** Detects market regime (trending, ranging, volatile).
**Self-contained:** Yes - takes indicators, returns regime string.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class RegimeDetector {
  constructor(config) {
    // config: { trendThreshold: 0.02, volatilityThreshold: 0.03 }
  }

  detect(indicators, candles) → {
    regime: 'trending_up' | 'trending_down' | 'ranging' | 'volatile',
    confidence: number,  // 0-1
    details: {
      adx: number,
      trendStrength: number,
      volatility: number
    }
  }
}
```

---

### Module: `CandleAggregator` (`core/CandleAggregator.js`)

**Does:** Builds higher timeframe candles from lower timeframe.
**Self-contained:** Yes - pure transformation.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class CandleAggregator {
  // Aggregate 1m candles into higher timeframes
  aggregate(candles1m, targetTimeframe) → OHLCV[]

  // Build single candle from array
  buildCandle(candles) → OHLCV

  // Check if candle period is complete
  isPeriodComplete(timestamp, timeframe) → boolean
}
```

---

### Module: `IndicatorSnapshot` (`core/IndicatorSnapshot.js`)

**Does:** Creates the ONE canonical indicator object from raw calculations.
**Self-contained:** Yes - single transformation point.
**Hot-swap:** Yes.

**WHY THIS EXISTS:**
The biggest bug source in the monolith was the indicator reshape at line 1641 where raw
engine state gets converted into the indicators object. Different code paths produced
different shapes/units (Bug 1, Bug 4, Bug 5, P1). This module is THE SINGLE PLACE
where that transformation happens. No fallback paths. No alternative reshapes.

```javascript
// WHAT'S IN THE BOX:
class IndicatorSnapshot {
  constructor(validator) {
    this.validator = validator;  // ContractValidator instance
  }

  // THE ONE METHOD - creates canonical indicator object
  create(rawIndicators, price) → Indicators {
    const snapshot = {
      // === PRICE CONTEXT ===
      price: number,              // Dollars. Current price. Example: $95,432

      // === MOMENTUM (all 0-100) ===
      rsi: number,                // 0-100. RSI value. Example: 45
      rsiNormalized: number,      // 0-1. RSI/100. Example: 0.45

      // === TREND ===
      macd: {
        macd: number,             // Dollars. MACD line. Example: $123
        signal: number,           // Dollars. Signal line. Example: $110
        histogram: number         // Dollars. Histogram. Example: $13
      },
      ema9: number,               // Dollars. EMA 9. Example: $95,100
      ema21: number,              // Dollars. EMA 21. Example: $94,800
      ema50: number,              // Dollars. EMA 50. Example: $93,500
      ema200: number,             // Dollars. EMA 200. Example: $88,000

      // === VOLATILITY ===
      atr: number,                // Dollars. ATR in price terms. Example: $523
      atrPercent: number,         // Percent 0-100. ATR/price*100. Example: 0.55 (BTC)
                                  // MULTI-ASSET NOTE: Range 0-100 is correct.
                                  // BTC: $523/$95K = 0.55%. Penny stock: $0.50/$2 = 25%.
                                  // Validator uses 0-100 to support all asset classes.
      atrNormalized: number,      // 0-1. Normalized ATR (0.05 stddev = 1.0). Example: 0.73
      bb: {
        upper: number,            // Dollars. Upper band. Example: $96,500
        middle: number,           // Dollars. Middle band. Example: $95,000
        lower: number,            // Dollars. Lower band. Example: $93,500
        bandwidth: number,        // Percent 0-100. (upper-lower)/middle*100. Example: 3.2
        percentB: number          // 0-1. Where price is in bands. Example: 0.65
      },

      // === VOLUME ===
      volume: number,             // Base asset. Volume. Example: 1523.5 BTC
      vwap: number,               // Dollars. VWAP. Example: $95,200

      // === DERIVED ===
      volatilityNormalized: number, // 0-1. THE volatility score. Example: 0.73

      // === TREND (single source of truth) ===
      trend: string               // Enum: 'uptrend' | 'downtrend' | 'neutral'
                                  // Computed from EMA alignment: ema9 > ema21 > ema50 = uptrend
                                  // This is THE trend field. No other module computes trend.
    };

    // VALIDATE BEFORE RETURNING - contracts that scream
    this.validator.validateIndicators(snapshot);

    return snapshot;
  }
}
```

**NO FALLBACK PATHS:**
```javascript
// WRONG - don't do this anywhere
const volatility = indicators.volatilityNormalized ?? indicators.atr / price;

// RIGHT - if missing, it's a bug
const volatility = indicatorSnapshot.volatilityNormalized;
// IndicatorSnapshot guarantees this field exists and is valid
```

---

---

### Module: `SignalGenerator` (`core/SignalGenerator.js`)

**Does:** Runs all registered strategies and returns their signals.
**Self-contained:** Yes - strategies are injected, it just runs them.
**Hot-swap:** Yes - strategies can be added/removed at runtime.

```javascript
// WHAT'S IN THE BOX:
class SignalGenerator {
  constructor() {
    this.strategies = [];
  }

  // Manage strategies
  registerStrategy(strategy) → void
  unregisterStrategy(name) → void
  getRegisteredStrategies() → string[]

  // Generate signals
  generateSignals(context) → Signal[] {
    // Runs each strategy's analyze() method
    // Returns array of all signals
  }
}

// Context passed to strategies
interface SignalContext {
  symbol: string,
  assetType: string,
  price: number,
  candles: OHLCV[],
  indicators: Indicators,
  regime: string,
  position: number,
  accountBalance: number
}

// Signal returned by each strategy
interface Signal {
  strategy: string,
  action: 'BUY' | 'SELL' | 'HOLD',
  confidence: number,        // 0-100
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  reason: string
}
```

---

### Module: `SignalRanker` (`core/SignalRanker.js`)

**Does:** Takes multiple signals, ranks them, picks the best one.
**Self-contained:** Yes - pure ranking logic.
**Hot-swap:** Yes - can swap ranking algorithm.

```javascript
// WHAT'S IN THE BOX:
class SignalRanker {
  constructor(config) {
    // config: { minConfidence: 35, preferStrategies: ['EMACrossover'] }
  }

  // Rank and select
  rankSignals(signals, regime) → RankedSignal[]
  selectBest(signals, regime) → Signal | null

  // Conflict resolution
  resolveConflicts(buySignals, sellSignals) → Signal | null
}
```

---

### Strategy Interface (all strategies implement this)

**Does:** Analyzes market and generates a signal.
**Self-contained:** Yes - each strategy is independent.
**Hot-swap:** Yes - drop in any strategy file.

```javascript
// WHAT EVERY STRATEGY MUST HAVE:
class StrategyBase {
  // Identity
  getName() → string           // 'EMACrossover', 'RSIMeanRevert'
  getAssetClasses() → string[] // ['crypto'], ['stocks'], ['all']
  getTimeframes() → string[]   // ['1m', '5m', '15m']

  // Requirements
  getRequiredIndicators() → string[]  // ['rsi', 'macd', 'ema21']
  getRequiredCandles() → number       // 50

  // The main method
  analyze(context) → Signal
}
```

**Example strategies:**
- `EMACrossoverStrategy` - Buys when fast EMA crosses above slow EMA
- `RSIMeanRevertStrategy` - Buys oversold, sells overbought
- `LiquiditySweepStrategy` - Detects liquidity grabs
- `BreakAndRetestStrategy` - Structure breakout + retest
- `GridStrategy` - Range-bound grid trading
- `PatternRecognitionStrategy` - ML-based pattern matching (see Pattern System below)

---

## PATTERN SYSTEM PLACEMENT

The pattern recognition system currently spans multiple files. Here's where each piece lives in the new architecture:

### Module: `PatternRecognitionStrategy` (`core/strategies/PatternRecognitionStrategy.js`)

**Does:** Implements StrategyBase using pattern memory for signal generation.
**Self-contained:** Yes - just needs PatternMemoryStore injected.
**This is a STRATEGY, not a separate system.**

```javascript
// WHAT'S IN THE BOX:
class PatternRecognitionStrategy extends StrategyBase {
  constructor(patternStore, featureExtractor) {
    this.store = patternStore;
    this.extractor = featureExtractor;
  }

  getName() → 'PatternRecognition'
  getAssetClasses() → ['all']
  getTimeframes() → ['1m', '5m', '15m']

  analyze(context) → Signal {
    // 1. Extract features from current market state
    const features = this.extractor.extract(context);

    // 2. Find matching patterns
    const matches = this.store.findMatches(features);

    // 3. Evaluate pattern quality
    const evaluation = this.evaluatePatterns(matches);

    // 4. Return signal (confidence 0-100 at boundary!)
    return {
      strategy: 'PatternRecognition',
      action: evaluation.direction,
      confidence: evaluation.confidence,  // 0-100
      // ...
    };
  }
}
```

---

### Module: `PatternMemoryStore` (`core/data/PatternMemoryStore.js`)

**Does:** Stores and retrieves patterns. Like CandleStore but for patterns.
**Self-contained:** Yes - pure data structure.
**Hot-swap:** Yes - can swap storage backend.

```javascript
// WHAT'S IN THE BOX:
class PatternMemoryStore {
  // Store patterns
  addPattern(pattern) → void
  updatePatternOutcome(patternKey, outcome) → void

  // Retrieve
  findMatches(features, threshold) → PatternMatch[]
  getPattern(key) → Pattern | null
  getPatternsByType(type) → Pattern[]

  // Stats
  getWinRateForPattern(key) → number      // 0-1. Win rate. Example: 0.67
  getConfidenceForPattern(key) → number   // 0-100. Confidence. Example: 72

  // Persistence
  async save() → void
  async load() → void
  healthCheck() → HealthStatus
}
```

---

### Module: `FeatureExtractor` (`core/data/FeatureExtractor.js`)

**Does:** Extracts features from market state for pattern matching. Pure function.
**Self-contained:** Yes - takes indicators, returns features.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class FeatureExtractor {
  // Extract features from current state
  extract(context) → PatternFeatures {
    return {
      // All features normalized 0-1 for consistent matching
      rsiZone: number,           // 0-1. RSI bucket (oversold/neutral/overbought)
      trendStrength: number,     // 0-1. How strong is current trend
      volatilityLevel: number,   // 0-1. Normalized volatility
      bbPosition: number,        // 0-1. Where in BB bands
      volumeProfile: number,     // 0-1. Volume relative to average
      priceAction: string,       // 'bullish_engulf' | 'doji' | etc.
      structureType: string      // 'higher_high' | 'lower_low' | etc.
    };
  }

  // Generate pattern key from features
  generateKey(features) → string
}
```

---

### Pattern Learning Loop (in PositionTracker)

**Where outcome recording lives:** PositionTracker.removePosition()

When a trade closes, PositionTracker records the outcome back to PatternMemoryStore:

```javascript
// In PositionTracker
removePosition(tradeId) {
  const trade = this.positions.get(tradeId);
  if (!trade) return null;

  // Record outcome for pattern learning
  if (trade.patterns && trade.patterns.length > 0) {
    const outcome = {
      pnlPercent: trade.realizedPnl,
      holdTimeMinutes: trade.holdTime,
      exitReason: trade.exitReason
    };

    // PatternMemoryStore updates win rates, adjusts confidence
    this.patternStore.recordOutcome(trade.patterns, outcome);
  }

  this.positions.delete(tradeId);
  return trade;
}
```

**Pattern System Summary:**
| Component | Module | Layer |
|-----------|--------|-------|
| Signal generation | PatternRecognitionStrategy | STRATEGY |
| Pattern storage | PatternMemoryStore | DATA |
| Feature extraction | FeatureExtractor | DATA |
| Outcome recording | PositionTracker.removePosition() | POSITION |

---

---

### Module: `EntryDecider` (`core/EntryDecider.js`)

**Does:** Decides if we should enter a trade. Yes or no.
**Self-contained:** Yes - takes signal + account state, returns decision.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class EntryDecider {
  constructor(config) {
    // config: { minConfidence: 35, requireBrainAlignment: true }
  }

  // The one method that matters
  shouldEnter(context) → {
    enter: boolean,
    reason: string,           // Why yes or why no
    order: Order | null       // If entering, the order details
  }
}

interface EntryContext {
  position: number,           // 0 = flat, can enter
  signal: Signal,             // From SignalRanker
  brainDirection: string,     // 'buy' | 'sell' | 'hold'
  accountState: AccountState
}

interface Order {
  symbol: string,
  side: 'buy' | 'sell',
  size: number,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  strategy: string
}
```

---

### Module: `EntryGateChecker` (`core/EntryGateChecker.js`)

**Does:** Checks all entry gates. Returns pass/fail.
**Self-contained:** Yes - gates are injected.
**Hot-swap:** Yes - add/remove gates at runtime.

```javascript
// WHAT'S IN THE BOX:
class EntryGateChecker {
  constructor() {
    this.gates = [];
  }

  // Manage gates
  addGate(gate) → void
  removeGate(name) → void

  // Check all gates
  checkAll(context) → {
    passed: boolean,
    blockedBy: string | null,  // Which gate blocked
    gateResults: GateResult[]  // Result from each gate
  }
}

// Gate interface
interface Gate {
  getName() → string
  check(context) → { passed: boolean, reason: string }
}
```

**Built-in gates:**
- `DailyLossGate` - Blocks if daily loss limit hit
- `DrawdownGate` - Blocks if account drawdown too high
- `PositionLimitGate` - Blocks if max positions reached
- `TradingHoursGate` - Blocks outside trading hours

---

---

### Module: `ExitDecider` (`core/ExitDecider.js`)

**Does:** Decides if we should exit a position. Yes or no + reason.
**Self-contained:** Yes - takes trade + current price, returns decision.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class ExitDecider {
  constructor() {
    this.checkers = [];  // Exit condition checkers
  }

  // Register exit checkers
  addChecker(checker) → void
  removeChecker(name) → void

  // The one method that matters
  shouldExit(context) → {
    exit: boolean,
    reason: string,      // 'stop_loss' | 'take_profit' | 'trailing' | 'max_hold' | 'signal'
    urgency: string      // 'low' | 'medium' | 'high' | 'critical'
  }
}

interface ExitContext {
  trade: Trade,
  currentPrice: number,
  indicators: Indicators,
  brainDirection: string,
  timeHeldMinutes: number
}
```

---

### Module: `StopLossChecker` (`core/exit/StopLossChecker.js`)

**Does:** Checks if stop loss hit. Returns yes/no.
**Self-contained:** Yes.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class StopLossChecker {
  check(trade, currentPrice) → {
    triggered: boolean,
    pnlPercent: number
  }
}
```

---

### Module: `TakeProfitChecker` (`core/exit/TakeProfitChecker.js`)

**Does:** Checks if take profit hit. Returns yes/no.
**Self-contained:** Yes.

```javascript
// WHAT'S IN THE BOX:
class TakeProfitChecker {
  check(trade, currentPrice) → {
    triggered: boolean,
    pnlPercent: number
  }
}
```

---

### Module: `TrailingStopChecker` (`core/exit/TrailingStopChecker.js`)

**Does:** Checks trailing stop. Updates max profit. Returns yes/no.
**Self-contained:** Yes.

```javascript
// WHAT'S IN THE BOX:
class TrailingStopChecker {
  check(trade, currentPrice) → {
    triggered: boolean,
    maxProfit: number,
    currentPnl: number,
    dropFromPeak: number
  }

  updateMaxProfit(trade, currentPrice) → number
}
```

---

### Module: `MaxHoldChecker` (`core/exit/MaxHoldChecker.js`)

**Does:** Checks if max hold time exceeded. Returns yes/no.
**Self-contained:** Yes.

```javascript
// WHAT'S IN THE BOX:
class MaxHoldChecker {
  check(trade, currentTime) → {
    triggered: boolean,
    holdTimeMinutes: number,        // Minutes. Range: 0-∞. Example: 45
    maxAllowedMinutes: number       // Minutes. Range: 1-∞. Example: 120
  }
}
```

---

### Module: `BreakEvenManager` (`core/exit/BreakEvenManager.js`)

**Does:** Manages break-even stop transitions. When trade profits exceed risk, moves stop to entry.
**Self-contained:** Yes - owns the break-even state machine.
**Hot-swap:** Yes.

**WHY THIS EXISTS:**
Break-even logic spans StopLossChecker AND TrailingStopChecker in the current code (ExitContractManager line 236).
This module explicitly owns that state transition so it doesn't fall through the cracks.

```javascript
// WHAT'S IN THE BOX:
class BreakEvenManager {
  // Check if break-even should activate
  shouldActivate(trade, currentPrice) → {
    activate: boolean,
    reason: string
  }

  // Calculate new stop loss at break-even
  getBreakEvenStop(trade) → {
    newStopLoss: number,           // Dollars. The entry price (break-even point)
    originalStopLoss: number,      // Dollars. What it was before
    profitLocked: number           // Dollars. Profit locked in (usually 0 at break-even)
  }

  // Check conditions
  hasReachedBreakEvenThreshold(trade, currentPrice) → boolean
  isAtBreakEven(trade) → boolean
}

// Break-even activates when:
// 1. maxProfit >= initialRisk (trade has "paid for itself")
// 2. Trade is still open
// 3. Current stop is below entry

// STATE MACHINE:
// INITIAL_STOP → (maxProfit >= risk) → BREAK_EVEN → (trailing takes over)
```

**Interaction with other exit modules:**
- StopLossChecker: Uses current stop (may be at break-even)
- TrailingStopChecker: Takes over AFTER break-even is set
- PositionTracker: Receives stop updates from BreakEvenManager

---

---

### Module: `PositionTracker` (`core/PositionTracker.js`)

**Does:** Tracks open positions. Add, remove, query. Nothing else.
**Self-contained:** Yes - pure data structure.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class PositionTracker {
  // Add/remove
  addPosition(trade) → void
  removePosition(tradeId) → Trade | null

  // Query
  getPosition(symbol) → Trade | null
  getAllPositions() → Trade[]
  getPositionCount() → number
  hasPosition(symbol) → boolean

  // Aggregates
  getTotalExposure() → number  // Sum of all position values
  getUnrealizedPnL(currentPrices) → number
}
```

---

### Module: `OrderExecutor` (`core/OrderExecutor.js`)

**Does:** Sends orders to broker. Returns result. Nothing else.
**Self-contained:** Yes - needs OrderRouter injected.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class OrderExecutor {
  constructor(orderRouter) {
    this.router = orderRouter;
  }

  // Execute
  async executeOrder(order) → {
    success: boolean,
    orderId: string,
    filledPrice: number,
    filledSize: number,
    fees: number,
    error?: string
  }

  // Cancel
  async cancelOrder(orderId) → { success: boolean, error?: string }
}
```

---

### Module: `PositionSizer` (`core/PositionSizer.js`)

**Does:** Calculates position size based on risk parameters.
**Self-contained:** Yes - pure math.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class PositionSizer {
  constructor(config) {
    // config: { maxPositionPercent: 0.02, maxRiskPercent: 0.01 }
  }

  // Calculate size
  calculateSize(params) → {
    size: number,           // Position size in base asset
    sizeUSD: number,        // Position size in USD
    riskAmount: number      // Dollar risk
  }
}

interface SizingParams {
  accountBalance: number,
  entryPrice: number,
  stopLoss: number,
  confidence: number,        // Higher confidence = larger size
  patternQuality: number     // Pattern-based adjustment
}
```

---

### Module: `PnLCalculator` (`core/PnLCalculator.js`)

**Does:** Calculates P&L. Takes entry/exit, returns profit/loss.
**Self-contained:** Yes - pure math.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class PnLCalculator {
  // Calculate for a trade
  calculate(trade, exitPrice) → {
    pnl: number,            // Absolute P&L
    pnlPercent: number,     // Percentage P&L
    fees: number,           // Estimated fees
    netPnl: number          // P&L after fees
  }

  // Calculate unrealized
  calculateUnrealized(trade, currentPrice) → {
    unrealizedPnl: number,
    unrealizedPercent: number
  }
}
```

---

---

### Module: `DrawdownTracker` (`core/DrawdownTracker.js`)

**Does:** Tracks account drawdown. Updates on every balance change.
**Self-contained:** Yes.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class DrawdownTracker {
  constructor(initialBalance) {
    this.peak = initialBalance;
    this.current = initialBalance;
  }

  // Update
  updateBalance(newBalance) → void

  // Query
  getCurrentDrawdown() → number      // Current % below peak
  getMaxDrawdown() → number          // Worst drawdown ever
  getPeak() → number                 // Highest balance ever
  isInDrawdown() → boolean           // Currently below peak?
}
```

---

### Module: `PnLTracker` (`core/PnLTracker.js`)

**Does:** Tracks P&L by period (daily, weekly, monthly).
**Self-contained:** Yes.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class PnLTracker {
  // Record
  recordTrade(trade) → void

  // Query
  getDailyPnL() → number
  getWeeklyPnL() → number
  getMonthlyPnL() → number
  getYearlyPnL() → number

  // Stats
  getWinRate() → number
  getAverageWin() → number
  getAverageLoss() → number
  getProfitFactor() → number
}
```

---

### Module: `RiskAssessor` (`core/RiskAssessor.js`)

**Does:** Assesses risk of a proposed trade. Returns risk score.
**Self-contained:** Yes.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class RiskAssessor {
  constructor(config) {
    // config: { maxRiskScore: 5, factors: [...] }
  }

  // Assess
  assess(params) → {
    approved: boolean,
    riskScore: number,        // 0-10 (lower = safer)
    riskLevel: string,        // 'low' | 'medium' | 'high' | 'extreme'
    factors: RiskFactor[],    // What contributed to score
    reason: string            // Human readable
  }
}

interface AssessParams {
  symbol: string,
  side: string,
  size: number,
  entryPrice: number,
  stopLoss: number,
  currentDrawdown: number,
  dailyPnL: number,
  openPositions: number
}
```

---

## CONTRACT VALIDATION LAYER

**Every module boundary validates data. Silent corruption is impossible.**

This is the thing that would have caught Bug 1, Bug 4, Bug 5, and P1 on day one.

### Module: `ContractValidator` (`core/ContractValidator.js`)

**Does:** Validates data contracts at every boundary. Throws on violation.
**Self-contained:** Yes - pure validation.
**Hot-swap:** Yes.

```javascript
// WHAT'S IN THE BOX:
class ContractValidator {
  // Indicator validation
  validateIndicators(indicators) {
    this.assertRange('rsi', indicators.rsi, 0, 100);
    this.assertRange('rsiNormalized', indicators.rsiNormalized, 0, 1);
    this.assertPositive('atr', indicators.atr);
    this.assertRange('atrPercent', indicators.atrPercent, 0, 100);  // Supports all asset classes
    this.assertRange('atrNormalized', indicators.atrNormalized, 0, 1);
    this.assertRange('bb.percentB', indicators.bb?.percentB, 0, 1);
    this.assertRange('bb.bandwidth', indicators.bb?.bandwidth, 0, 100);
    this.assertPositive('price', indicators.price);
    this.assertDefined('volatilityNormalized', indicators.volatilityNormalized);
    this.assertEnum('trend', indicators.trend, ['uptrend', 'downtrend', 'neutral']);
  }

  // Signal validation
  validateSignal(signal) {
    this.assertRange('confidence', signal.confidence, 0, 100);
    this.assertEnum('action', signal.action, ['BUY', 'SELL', 'HOLD']);
    this.assertPositive('entryPrice', signal.entryPrice);
    this.assertPositive('stopLoss', signal.stopLoss);
    this.assertPositive('takeProfit', signal.takeProfit);
  }

  // Trade validation
  validateTrade(trade) {
    this.assertDefined('id', trade.id);
    this.assertEnum('side', trade.side, ['buy', 'sell']);
    this.assertPositive('entryPrice', trade.entryPrice);
    this.assertPositive('size', trade.size);
    this.assertRange('maxProfitPercent', trade.maxProfitPercent, -100, 1000);
  }

  // Exit context validation
  validateExitContext(context) {
    this.assertDefined('trade', context.trade);
    this.assertPositive('currentPrice', context.currentPrice);
    this.assertNumber('timeHeldMinutes', context.timeHeldMinutes);
  }

  // Helper methods
  assertRange(field, value, min, max) {
    // CRITICAL: typeof check FIRST - undefined/null/NaN slip through range comparisons
    if (typeof value !== 'number' || isNaN(value)) {
      throw new ContractViolation(
        `${field} must be a number, got ${typeof value}: ${value}`
      );
    }
    if (value < min || value > max) {
      throw new ContractViolation(
        `${field} must be ${min}-${max}, got ${value}`
      );
    }
  }

  assertPositive(field, value) {
    if (typeof value !== 'number' || value <= 0 || isNaN(value)) {
      throw new ContractViolation(
        `${field} must be positive number, got ${value}`
      );
    }
  }

  assertDefined(field, value) {
    if (value === undefined || value === null) {
      throw new ContractViolation(`${field} is required, got ${value}`);
    }
  }

  assertEnum(field, value, allowed) {
    if (!allowed.includes(value)) {
      throw new ContractViolation(
        `${field} must be one of [${allowed}], got ${value}`
      );
    }
  }
}

class ContractViolation extends Error {
  constructor(message) {
    super(`CONTRACT VIOLATION: ${message}`);
    this.name = 'ContractViolation';
  }
}
```

### Where Validation Lives

| Boundary | Validator Method | Called By |
|----------|-----------------|-----------|
| IndicatorSnapshot → * | validateIndicators() | IndicatorSnapshot.create() |
| SignalGenerator → SignalRanker | validateSignal() | SignalGenerator.generateSignals() |
| SignalRanker → EntryDecider | validateSignal() | SignalRanker.selectBest() |
| EntryDecider → OrderExecutor | validateTrade() | EntryDecider.shouldEnter() |
| * → ExitDecider | validateExitContext() | ExitDecider.shouldExit() |
| PositionTracker mutations | validateTrade() | PositionTracker.updateTradeField() |

### Validation in Production

```javascript
// In production, validation is ALWAYS ON
// In tests, validation catches bugs immediately

class IndicatorSnapshot {
  create(rawIndicators, price) {
    const snapshot = { /* ... build snapshot ... */ };

    // ALWAYS validate - no silent corruption
    this.validator.validateIndicators(snapshot);

    return snapshot;
  }
}

class SignalGenerator {
  generateSignals(context) {
    const signals = this.strategies.map(s => s.analyze(context));

    // Validate every signal before returning
    signals.forEach(s => this.validator.validateSignal(s));

    return signals;
  }
}
```

### What This Catches

| Bug | Caught By | How |
|-----|-----------|-----|
| Bug 1 (ATR not normalized) | assertRange('atrNormalized', value, 0, 1) | atr=523 would throw |
| Bug 4 (BB bandwidth missing) | assertDefined('bb.bandwidth', value) | undefined would throw |
| Bug 5/P1 (RSI format mismatch) | assertRange('rsi', value, 0, 100) | rsi=0.45 would throw |
| Bug 6 (HOLD confidence wrong) | assertRange('confidence', value, 0, 100) | confidence=-1 would throw |
| Silent NaN corruption | assertPositive checks isNaN() | NaN would throw |

**Contracts that scream instead of silently corrupting.**

---

## 3. ASSET-SPECIFIC CONSIDERATIONS

### Crypto (Current)
- 24/7 trading
- High volatility
- Fee structure: maker/taker
- Position sizing in base asset (BTC, ETH)

### Stocks
- Market hours only (9:30-16:00 ET)
- Pre/post market optional
- Pattern day trader rules
- Position sizing in shares

### Futures
- Extended hours
- Margin requirements
- Contract expiration
- Tick size considerations

### Forex
- 24/5 trading
- Pip-based P&L
- Leverage considerations
- Lot sizing (standard/mini/micro)

### Options
- Greeks-aware
- Expiration management
- IV considerations
- Complex order types

---

## 4. WHAT STAYS IN RUNNER (~500 lines)

```javascript
// run-empire-v2.js - AFTER REFACTOR

class OGZPrimeRunner {
  constructor() {
    // Load config
    // Initialize modules
    // Wire dependencies
  }

  async start() {
    // Connect to broker(s)
    // Subscribe to market data
    // Start trading loop
  }

  async tradingLoop() {
    // 1. Get latest data from DataManager
    // 2. Run StrategyEngine.analyze()
    // 3. If has position: ExitPipeline.evaluate()
    // 4. If flat: EntryPipeline.evaluate()
    // 5. If signal: PositionManager.execute()
    // 6. Update state
  }

  async shutdown() {
    // Graceful shutdown
  }
}
```

---

## 5. MODULE SUMMARY TABLE

| Layer | Module | Does | Deps | Lines Est |
|-------|--------|------|------|-----------|
| **CORE** | ContractValidator | Validates all contracts, throws on violation | None | 100 |
| **BROKER** | OrderRouter | Routes orders to correct broker | BrokerAdapters | 80 |
| **BROKER** | KrakenBroker | Kraken WebSocket + REST | None (API keys) | 250 |
| **BROKER** | AlpacaBroker | Alpaca REST | None (API keys) | 200 |
| **DATA** | CandleStore | Stores candles by symbol/tf | None | 60 |
| **DATA** | IndicatorCalculator | RSI, MACD, BB, ATR, EMA | None (pure math) | 150 |
| **DATA** | IndicatorSnapshot | THE single indicator reshape | ContractValidator | 80 |
| **DATA** | RegimeDetector | trending/ranging/volatile | IndicatorSnapshot | 80 |
| **DATA** | CandleAggregator | 1m → 5m, 15m, 1h | None | 50 |
| **DATA** | PatternMemoryStore | Stores patterns, tracks win rates | None | 120 |
| **DATA** | FeatureExtractor | Extracts features for pattern matching | None (pure) | 80 |
| **STRATEGY** | SignalGenerator | Runs strategies, returns signals | Strategies, Validator | 100 |
| **STRATEGY** | SignalRanker | Ranks signals, picks best | ContractValidator | 80 |
| **STRATEGY** | StrategyBase | Interface all strategies implement | None | 40 |
| **STRATEGY** | PatternRecognitionStrategy | ML pattern-based signals | PatternMemoryStore | 100 |
| **ENTRY** | EntryDecider | Yes/no on entering trade | Gates (MUST check first!) | 100 |
| **ENTRY** | EntryGateChecker | Runs all entry gates | Gates | 60 |
| **EXIT** | ExitDecider | Yes/no on exiting trade | Exit checkers | 80 |
| **EXIT** | StopLossChecker | Stop loss hit? | None | 30 |
| **EXIT** | TakeProfitChecker | Take profit hit? | None | 30 |
| **EXIT** | TrailingStopChecker | Trailing stop hit? | None | 50 |
| **EXIT** | MaxHoldChecker | Max hold time hit? | None | 30 |
| **EXIT** | BreakEvenManager | Break-even state transitions | None | 60 |
| **POSITION** | PositionTracker | Track positions (SOLE WRITER) | PatternMemoryStore | 100 |
| **POSITION** | OrderExecutor | Send orders to broker | OrderRouter | 100 |
| **POSITION** | PositionSizer | Calculate position size | None (pure math) | 60 |
| **POSITION** | PnLCalculator | Calculate P&L | None (pure math) | 40 |
| **RISK** | DrawdownTracker | Track account drawdown | None | 50 |
| **RISK** | PnLTracker | Track P&L by period | None | 80 |
| **RISK** | RiskAssessor | Assess trade risk score | DrawdownTracker, PnLTracker | 100 |

**Total: ~2600 lines in modules + ~500 lines runner = 3100 lines (down from 4519)**
**Note: More modules but each is smaller, testable, and has clear boundaries**

---

## 6. MODULE DEPENDENCY DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                    RUNNER                                        │
│                              (orchestrates all)                                  │
└───────────┬────────────────────────┬────────────────────────┬───────────────────┘
            │                        │                        │
            ▼                        ▼                        ▼
    ┌───────────────┐       ┌───────────────┐       ┌───────────────┐
    │  DATA LAYER   │       │ STRATEGY LAYER│       │ BROKER LAYER  │
    ├───────────────┤       ├───────────────┤       ├───────────────┤
    │ CandleStore   │◄──────│SignalGenerator│       │ OrderRouter   │
    │       ↓       │       │       ↓       │       │       ↓       │
    │IndicatorCalc  │──────►│ SignalRanker  │       │ KrakenBroker  │
    │       ↓       │       └───────┬───────┘       │ AlpacaBroker  │
    │ RegimeDetector│               │               │ IBKRBroker    │
    │       ↓       │               │               └───────┬───────┘
    │CandleAggregator               │                       │
    └───────┬───────┘               │                       │
            │                       │                       │
            │              ┌────────┴────────┐              │
            │              │                 │              │
            ▼              ▼                 ▼              ▼
    ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐
    │  ENTRY LAYER  │  │  EXIT LAYER   │  │  POSITION LAYER   │
    ├───────────────┤  ├───────────────┤  ├───────────────────┤
    │ EntryDecider  │  │ ExitDecider   │  │ PositionTracker   │
    │       ↓       │  │       ↓       │  │        ↓          │
    │EntryGateChecker  │ StopLossCheck │  │ OrderExecutor ────┼──► BROKER
    │       │       │  │ TakeProfitChk │  │        ↓          │
    │       │       │  │TrailingStopChk│  │ PositionSizer     │
    │       │       │  │ MaxHoldChecker│  │        ↓          │
    │       │       │  └───────┬───────┘  │ PnLCalculator     │
    └───────┼───────┘          │          └────────┬──────────┘
            │                  │                   │
            └──────────────────┼───────────────────┘
                               │
                               ▼
                       ┌───────────────┐
                       │  RISK LAYER   │
                       ├───────────────┤
                       │DrawdownTracker│
                       │       ↓       │
                       │  PnLTracker   │
                       │       ↓       │
                       │ RiskAssessor  │◄─── Blocks entries if risk too high
                       └───────────────┘
```

**Key Flows:**
1. **Data** → calculates indicators → feeds **Strategy**
2. **Strategy** → generates signals → feeds **Entry**
3. **Entry** checks **Risk** → if approved → **Position** executes via **Broker**
4. **Exit** monitors positions → triggers **Position** to close via **Broker**

---

## 7. EXTRACTION ORDER (RISK-ORDERED)

| Phase | Modules | Risk | Why This Order |
|-------|---------|------|----------------|
| **0** | ContractValidator | ZERO | Pure validation. No behavior. Extract first, use everywhere. |
| **1** | CandleStore, IndicatorCalculator | LOW | Pure data, no side effects. Easy to verify with golden test. |
| **2** | IndicatorSnapshot | LOW | Single reshape point. ContractValidator catches mismatches. |
| **3** | CandleAggregator, RegimeDetector | LOW | Build on Phase 1-2. Still pure functions. |
| **4** | FeatureExtractor, PatternMemoryStore | LOW | Pattern data layer. Pure storage/extraction. |
| **5** | KrakenBroker, OrderRouter | LOW | Isolated I/O. Can mock for testing. |
| **6** | SignalGenerator, SignalRanker, StrategyBase | MED | Core logic. Compare signals to baseline. |
| **7** | PatternRecognitionStrategy | MED | Uses PatternMemoryStore. Compare to current patterns. |
| **8** | DrawdownTracker, PnLTracker, RiskAssessor | MED | Independent risk calculations. |
| **9** | EntryDecider, EntryGateChecker | MED | **FIX: Gates MUST run before order execution.** |
| **10** | StopLossChecker, TakeProfitChecker, TrailingStopChecker, MaxHoldChecker | MED | Individual exit conditions. Easy to unit test. |
| **11** | BreakEvenManager | MED | Owns break-even state transitions explicitly. |
| **12** | ExitDecider | HIGH | Orchestrates exit checkers. Critical path. |
| **13** | PositionTracker, PnLCalculator, PositionSizer | HIGH | **PositionTracker is SOLE WRITER to Trade objects.** |
| **14** | OrderExecutor | HIGH | Actually sends orders. Final integration. |

**After EACH phase:**
```bash
# Golden test
BACKTEST_MODE=true BACKTEST_VERBOSE=true node run-empire-v2.js > current.txt
diff <(grep "Trade closed" baseline.txt) <(grep "Trade closed" current.txt)
# MUST BE IDENTICAL
```

**Phase 0 is special:** ContractValidator has zero behavior impact. It just adds validation.
Extract it first so every subsequent phase uses it from day one.

---

## 8. DATA CONTRACTS SUMMARY (WITH UNITS)

**Every numeric field has: Unit, Range, Example**

### Candle (OHLCV)
```javascript
{
  timestamp: number,    // Unix milliseconds. Range: 0-∞. Example: 1709078400000
  open: number,         // Dollars. Range: 0-∞. Example: 95432.50
  high: number,         // Dollars. Range: >= open,close. Example: 95650.00
  low: number,          // Dollars. Range: <= open,close. Example: 95200.00
  close: number,        // Dollars. Range: 0-∞. Example: 95500.00
  volume: number        // Base asset units. Range: 0-∞. Example: 1523.45 (BTC)
}
```

### Trade
```javascript
{
  id: string,                    // UUID. Example: "trade-1709078400000-abc123"
  symbol: string,                // Ticker. Example: "BTC/USD"
  side: 'buy' | 'sell',
  entryPrice: number,            // Dollars. Range: 0-∞. Example: 95432.50
  entryTime: number,             // Unix ms. Range: 0-∞. Example: 1709078400000
  size: number,                  // Base asset units. Range: 0-∞. Example: 0.015
  stopLoss: number,              // Dollars. Range: 0-∞. Example: 94500.00
  takeProfit: number,            // Dollars. Range: 0-∞. Example: 96200.00
  exitContract: ExitContract,
  maxProfitPercent: number,      // Percent. Range: -100 to 1000. Example: 0.85
  strategy: string,              // Strategy name. Example: "EMACrossover"
  patterns: string[],            // Pattern keys. Example: ["rsi_ob_vol_high"]
  indicators: Indicators         // Snapshot at entry (see IndicatorSnapshot)
}

// MUTATION RULES:
// - ONLY PositionTracker can modify Trade objects
// - All other modules treat Trade as READ-ONLY
// - Updates go through: positionTracker.updateTradeField(id, field, value)
```

### ExitContract
```javascript
{
  stopLossPercent: number,       // Percent. Range: 0-100. Example: 1.5 (means 1.5%)
  takeProfitPercent: number,     // Percent. Range: 0-100. Example: 3.0 (means 3.0%)
  trailingStopPercent: number,   // Percent. Range: 0-100. Example: 0.5 (means 0.5%)
  maxHoldTimeMinutes: number,    // Minutes. Range: 1-∞. Example: 120
  breakEvenThreshold: number,    // Percent. Range: 0-100. Example: 1.0 (move to BE at 1% profit)
  invalidationConditions: string[] // Conditions. Example: ["rsi_below_30", "trend_reversal"]
}
```

### Signal
```javascript
{
  strategy: string,              // Strategy name. Example: "RSIMeanRevert"
  action: 'BUY' | 'SELL' | 'HOLD',
  confidence: number,            // 0-100 ALWAYS. Range: 0-100. Example: 72
  entryPrice: number,            // Dollars. Range: 0-∞. Example: 95432.50
  stopLoss: number,              // Dollars. Range: 0-∞. Example: 94500.00
  takeProfit: number,            // Dollars. Range: 0-∞. Example: 96200.00
  reason: string                 // Human readable. Example: "RSI oversold bounce"
}

// CONFIDENCE STANDARD:
// - At ALL module boundaries: 0-100
// - Internal calculations can use 0-1, convert before returning
// - Never mix scales. Ever.
```

### Indicators (from IndicatorSnapshot)
```javascript
{
  // === PRICE CONTEXT ===
  price: number,                 // Dollars. Range: 0-∞. Example: 95432.50

  // === MOMENTUM ===
  rsi: number,                   // 0-100. Range: 0-100. Example: 45
  rsiNormalized: number,         // 0-1. Range: 0-1. Example: 0.45

  // === TREND ===
  macd: {
    macd: number,                // Dollars. Range: -∞ to ∞. Example: 123.50
    signal: number,              // Dollars. Range: -∞ to ∞. Example: 110.25
    histogram: number            // Dollars. Range: -∞ to ∞. Example: 13.25
  },
  ema9: number,                  // Dollars. Range: 0-∞. Example: 95100.00
  ema21: number,                 // Dollars. Range: 0-∞. Example: 94800.00
  ema50: number,                 // Dollars. Range: 0-∞. Example: 93500.00
  ema200: number,                // Dollars. Range: 0-∞. Example: 88000.00

  // === VOLATILITY ===
  atr: number,                   // Dollars. Range: 0-∞. Example: 523.00
  atrPercent: number,            // Percent. Range: 0-100. Example: 0.55
  atrNormalized: number,         // 0-1. Range: 0-1. Example: 0.73
  bb: {
    upper: number,               // Dollars. Range: 0-∞. Example: 96500.00
    middle: number,              // Dollars. Range: 0-∞. Example: 95000.00
    lower: number,               // Dollars. Range: 0-∞. Example: 93500.00
    bandwidth: number,           // Percent. Range: 0-100. Example: 3.2
    percentB: number             // 0-1. Range: 0-1. Example: 0.65
  },
  volatilityNormalized: number,  // 0-1. THE volatility score. Example: 0.73

  // === VOLUME ===
  volume: number,                // Base asset. Range: 0-∞. Example: 1523.5
  vwap: number,                  // Dollars. Range: 0-∞. Example: 95200.00

  // === TREND (single source of truth) ===
  trend: string                  // Enum: 'uptrend' | 'downtrend' | 'neutral'
                                 // Computed from EMA alignment in IndicatorSnapshot
                                 // NO OTHER MODULE computes trend direction
}

// VALIDATION: ContractValidator.validateIndicators() checks all ranges
// SINGLE SOURCE: IndicatorSnapshot.create() is the ONLY way to build this
```

### PatternFeatures (for PatternMemoryStore)
```javascript
{
  // ALL FEATURES NORMALIZED 0-1 FOR CONSISTENT MATCHING
  rsiZone: number,               // 0-1. 0=oversold, 0.5=neutral, 1=overbought
  trendStrength: number,         // 0-1. How strong is current trend
  volatilityLevel: number,       // 0-1. Normalized volatility
  bbPosition: number,            // 0-1. Where price is in BB bands
  volumeProfile: number,         // 0-1. Volume relative to average
  priceAction: string,           // Enum: 'bullish_engulf' | 'doji' | 'hammer' | etc.
  structureType: string          // Enum: 'higher_high' | 'lower_low' | 'range' | etc.
}
```

---

## 9. ARBITRAGE ARCHITECTURE (FUTURE)

```
┌─────────────────────────────────────────────────────────────┐
│                    ARBITRAGE ENGINE                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐               │
│  │  Kraken  │   │  Alpaca  │   │   IBKR   │               │
│  │   BTC    │   │   BTC    │   │  BTC/F   │               │
│  │ $95,000  │   │ $95,050  │   │ $95,100  │               │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘               │
│       │              │              │                      │
│       └──────────────┼──────────────┘                      │
│                      ▼                                      │
│              ┌───────────────┐                             │
│              │ Opportunity   │                             │
│              │  Detector     │                             │
│              │               │                             │
│              │ Spread: $100  │                             │
│              │ Fees: $30     │                             │
│              │ Net: $70      │                             │
│              └───────┬───────┘                             │
│                      │                                      │
│                      ▼                                      │
│              ┌───────────────┐                             │
│              │  Execution    │                             │
│              │  Coordinator  │                             │
│              │               │                             │
│              │ BUY Kraken    │                             │
│              │ SELL IBKR     │                             │
│              │ (atomic)      │                             │
│              └───────────────┘                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. MIGRATION PATH

### Week 1-2: Foundation
- [ ] Extract DataManager (indicators, candles)
- [ ] Extract BrokerInterface (Kraken adapter first)
- [ ] Verify backtest produces identical results

### Week 3-4: Strategy Layer
- [ ] Extract StrategyEngine
- [ ] Migrate existing strategies to interface
- [ ] Add strategy hot-reload capability

### Week 5-6: Entry/Exit
- [ ] Extract EntryPipeline
- [ ] Extract ExitPipeline
- [ ] Verify all exits work identically

### Week 7-8: Position & Risk
- [ ] Extract PositionManager
- [ ] Extract RiskEngine
- [ ] Full regression test

### Week 9+: Multi-Broker
- [ ] Add Alpaca adapter
- [ ] Add IBKR adapter
- [ ] Arbitrage engine prototype

---

## 11. VERIFICATION AT EACH PHASE

**Golden Test:**
```bash
# Baseline (FROZEN version)
BACKTEST_MODE=true node run-empire-v2.js.FROZEN-2026-02-27 > baseline.txt

# After each extraction
BACKTEST_MODE=true node run-empire-v2.js > current.txt

# Compare
diff <(grep "Trade closed" baseline.txt) <(grep "Trade closed" current.txt)
# Must be IDENTICAL
```

---

## 12. ROLLBACK PROTOCOL

If ANY regression detected:
1. `git checkout run-empire-v2.js.FROZEN-2026-02-27`
2. Delete extracted module
3. Run golden test to confirm recovery
4. Document what broke

---

## SIGN-OFF REQUIRED

### Architecture
- [ ] Trey reviewed architecture diagram
- [ ] Trey approved module boundaries
- [ ] Trey approved extraction order (14 phases)

### Contracts (THE LAW)
- [ ] Unit annotations on all numeric fields
- [ ] Confidence standard: 0-100 at ALL boundaries
- [ ] ContractValidator catches violations immediately

### Bug Fixes Embedded
- [ ] Gate ordering: Gates run BEFORE order execution
- [ ] Trade mutation: PositionTracker is SOLE WRITER
- [ ] Indicator reshape: IndicatorSnapshot is SINGLE SOURCE

### New Modules
- [ ] BreakEvenManager owns break-even state transitions
- [ ] IndicatorSnapshot eliminates fallback paths
- [ ] Pattern system mapped (Strategy + Data layers)
- [ ] ContractValidator at every boundary

### Verification
- [ ] Baseline backtest saved
- [ ] Golden test command documented

**DO NOT PROCEED WITHOUT ALL CHECKBOXES**

---

## NOTES

_Space for discussion notes during review_

### 2026-02-27 Review Notes

**Items added after initial review:**
1. Unit annotations on every numeric field (with range + example)
2. Confidence standard: 0-100 everywhere at boundaries
3. BreakEvenManager module (exit layer)
4. Gate ordering fix documented as known bug
5. Trade mutation rules (PositionTracker sole writer)
6. IndicatorSnapshot module (no fallback paths)
7. Pattern system placement (PatternRecognitionStrategy, PatternMemoryStore, FeatureExtractor)
8. ContractValidator at every boundary (contracts that scream)

**These 8 items address every bug class found in the codebase.**

### 2026-02-27 Final Review Fixes

**Three items addressed per Trey's review:**

1. **trend field added to IndicatorSnapshot**
   - `trend: 'uptrend' | 'downtrend' | 'neutral'`
   - Computed from EMA alignment (ema9 > ema21 > ema50 = uptrend)
   - IndicatorSnapshot is THE single source - no other module computes trend

2. **typeof guard added to assertRange**
   ```javascript
   assertRange(field, value, min, max) {
     // CRITICAL: typeof check FIRST - undefined/null/NaN slip through
     if (typeof value !== 'number' || isNaN(value)) {
       throw new ContractViolation(`${field} must be a number, got ${typeof value}: ${value}`);
     }
     // Then range check...
   }
   ```

3. **atrPercent range verified for multi-asset**
   - Range 0-100 is correct
   - BTC: $523/$95K = 0.55%
   - Penny stock: $0.50/$2 = 25%
   - Validator uses 0-100 to support all asset classes

**All sign-off items addressed. Plan ready for execution.**
