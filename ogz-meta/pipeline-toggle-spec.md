# OGZPrime Pipeline Toggle System
## Date: March 11, 2026
## Purpose: One codebase, hotswappable components, no parallel universe

---

## The Problem

A standalone backtest script (`tuning-backtest-full.js`) reimplemented the entire trade pipeline — different constructors, different indicator paths, different fee handling, different position logic. Every bug found in it was a test harness bug, not a production bug. RSI was broken for the entire life of the project and nobody knew because the standalone script calculated indicators differently.

## The Solution

**Delete the standalone backtest. Use BacktestRunner with toggles.**

BacktestRunner already exists (`core/BacktestRunner.js`) and already feeds candles through the real production pipeline — `handleMarketData()` → `CandleProcessor.processNewCandle()` → `TradingLoop.analyzeAndTrade()`. Same code path as live trading.

What it needs: a toggle system so each step of the pipeline can be individually enabled/disabled for testing.

---

## Toggle Architecture

### TradingConfig additions

```javascript
pipeline: {
  // ── Component toggles ──
  // Each step can be turned on/off independently
  // Default: all on (production behavior)
  
  enableRSI: envBool('ENABLE_RSI', true),
  enableMADynamicSR: envBool('ENABLE_MASR', true),
  enableEMACrossover: envBool('ENABLE_EMA', true),
  enableLiquiditySweep: envBool('ENABLE_LIQSWEEP', true),
  enableBreakRetest: envBool('ENABLE_BREAKRETEST', false),  // Already disabled
  enableMarketRegime: envBool('ENABLE_REGIME', true),
  enableMultiTimeframe: envBool('ENABLE_MTF', true),
  enableOGZTPO: envBool('ENABLE_TPO', true),
  
  enableRiskManager: envBool('ENABLE_RISK', true),
  enableTRAI: envBool('ENABLE_TRAI', false),                // Off by default
  enableDashboard: envBool('ENABLE_DASHBOARD', true),
  enableNotifications: envBool('ENABLE_NOTIFICATIONS', true),
  
  // ── Execution mode ──
  // 'live' = real Kraken orders
  // 'paper' = paper trading (log but don't execute)
  // 'backtest' = BacktestRecorder (historical replay)
  executionMode: env('EXECUTION_MODE', 'paper'),
  
  // ── Candle source ──
  // 'live' = Kraken WebSocket
  // 'file' = Historical JSON file (CANDLE_FILE env var)
  candleSource: env('CANDLE_SOURCE', 'live'),
  
  // ── Position mode ──
  // 'single' = one position at a time (current)
  // 'multi' = multiple concurrent positions (future)
  positionMode: env('POSITION_MODE', 'single'),
  
  // ── Direction filter ──
  // 'long_only' = spot market, only BUY
  // 'both' = futures/margin, BUY and SELL
  directionFilter: env('DIRECTION_FILTER', 'long_only'),
},
```

### How toggles are consumed

**StrategyOrchestrator** — reads toggles to decide which strategies to evaluate:

```javascript
// In _registerBuiltinStrategies() or evaluate():
const pipeline = TradingConfig.get('pipeline') || {};

// Only register strategies that are enabled
if (pipeline.enableRSI !== false) {
  this.strategies.push({ name: 'RSI', evaluate: (ctx) => { ... } });
}
if (pipeline.enableMADynamicSR !== false) {
  this.strategies.push({ name: 'MADynamicSR', evaluate: (ctx) => { ... } });
}
// etc.
```

**TradingLoop** — reads toggles for risk, direction, execution:

```javascript
const pipeline = TradingConfig.get('pipeline') || {};

// Direction filter
if (pipeline.directionFilter === 'long_only' && tradingDirection === 'sell') {
  tradingDirection = 'hold';  // Spot market, can't short
}

// Risk manager toggle
if (pipeline.enableRiskManager !== false && this.ctx.riskManager) {
  const riskCheck = this.ctx.riskManager.isTradingAllowed();
  if (!riskCheck.allowed) { ... }
}
```

**run-empire-v2.js** — reads toggles for initialization:

```javascript
const pipeline = TradingConfig.get('pipeline') || {};

// Only initialize what's enabled
if (pipeline.enableTRAI) {
  this.trai = new TRAIDecisionModule({ ... });
}

if (pipeline.enableDashboard) {
  this.dashboardBroadcaster = new DashboardBroadcaster({ ... });
}

// Candle source
if (pipeline.candleSource === 'file') {
  // Use BacktestRunner to feed from file
  await this.backtestRunner.loadHistoricalDataAndBacktest();
} else {
  // Subscribe to live Kraken feed
  this.subscribeToMarketData();
}
```

---

## Usage Examples

### Test RSI alone on historical data
```bash
ENABLE_RSI=true ENABLE_MASR=false ENABLE_EMA=false ENABLE_LIQSWEEP=false \
CANDLE_SOURCE=file CANDLE_FILE=tuning/full-45k.json \
EXECUTION_MODE=backtest DIRECTION_FILTER=long_only \
ENABLE_TRAI=false ENABLE_DASHBOARD=false \
node run-empire-v2.js
```

### Test MADynamicSR alone
```bash
ENABLE_RSI=false ENABLE_MASR=true ENABLE_EMA=false ENABLE_LIQSWEEP=false \
CANDLE_SOURCE=file CANDLE_FILE=tuning/full-45k.json \
EXECUTION_MODE=backtest DIRECTION_FILTER=long_only \
node run-empire-v2.js
```

### Test all strategies, long only, paper mode
```bash
CANDLE_SOURCE=live EXECUTION_MODE=paper DIRECTION_FILTER=long_only \
node run-empire-v2.js
```

### Full production live trading
```bash
CANDLE_SOURCE=live EXECUTION_MODE=live DIRECTION_FILTER=long_only \
node run-empire-v2.js
```

### Quick shorthand via .env profiles
Create `.env.backtest-rsi`:
```
ENABLE_RSI=true
ENABLE_MASR=false
ENABLE_EMA=false
ENABLE_LIQSWEEP=false
CANDLE_SOURCE=file
CANDLE_FILE=tuning/full-45k.json
EXECUTION_MODE=backtest
DIRECTION_FILTER=long_only
ENABLE_TRAI=false
ENABLE_DASHBOARD=false
ENABLE_NOTIFICATIONS=false
```

Run with:
```bash
DOTENV_CONFIG_PATH=.env.backtest-rsi node run-empire-v2.js
```

---

## What Gets Deleted

Once toggles are wired:

1. **`tuning/tuning-backtest-full.js`** — the standalone backtest. Replaced by `CANDLE_SOURCE=file EXECUTION_MODE=backtest node run-empire-v2.js`
2. **`backtest-strategies.js`** — another standalone backtest variant
3. **`backtest/OptimizedBacktestEngine.js`** — yet another one
4. **`backtest/backtest-api.js`** — and another

All replaced by one command with different env vars.

---

## Implementation Steps

### Step 1: Add pipeline toggles to TradingConfig
- Add the `pipeline:` section shown above
- No behavior changes — just config declarations

### Step 2: Wire strategy toggles into StrategyOrchestrator
- Read `pipeline.enableXXX` flags
- Only register/evaluate enabled strategies
- Test: `ENABLE_RSI=false` → RSI produces 0 signals

### Step 3: Wire direction filter into TradingLoop
- Read `pipeline.directionFilter`
- Block sell signals on `long_only`
- Test: no short trades on spot market

### Step 4: Wire execution mode into run-empire-v2.js
- Read `pipeline.executionMode` and `pipeline.candleSource`
- Route to BacktestRunner or live feed accordingly
- Test: `CANDLE_SOURCE=file` feeds historical data through production pipeline

### Step 5: Wire remaining toggles
- Risk manager, TRAI, dashboard, notifications
- Each reads its toggle and skips initialization if disabled

### Step 6: Create .env profiles
- `.env.backtest-rsi` — RSI only, file source, backtest mode
- `.env.backtest-masr` — MADynamicSR only
- `.env.backtest-all` — all strategies, file source
- `.env.paper` — all strategies, live feed, paper mode
- `.env.production` — everything on, live trading

### Step 7: Delete standalone scripts
- Remove `tuning/tuning-backtest-full.js` and other standalone backtests
- Update any references to use the toggle system instead

### Step 8: Update regression test and trade validator
- Both should use the toggle system instead of their own internal backtest
- `regression-test.js` runs `EXECUTION_MODE=backtest node run-empire-v2.js` and parses output
- `trade-validator.js` does the same with extra validation checks

---

## What This Fixes

| Problem | How toggles fix it |
|---------|-------------------|
| Standalone backtest uses different constructors | Eliminated — same code |
| Standalone backtest uses different indicator path | Eliminated — same code |
| Standalone backtest has different fee handling | Eliminated — same code |
| RSI broken for months, nobody knew | Same IndicatorEngine + IndicatorSnapshot in backtest |
| Backtest diverges from production over time | Impossible — it IS production |
| Testing one strategy requires editing code | Env vars: `ENABLE_RSI=true ENABLE_MASR=false` |
| Can't test direction filter | Env var: `DIRECTION_FILTER=long_only` |
| Have to choose between live and backtest | Env var: `CANDLE_SOURCE=file` vs `live` |

---

## BacktestRecorder Output

BacktestRecorder already exists and tracks trades during backtest mode. It needs to be enhanced to output the same format as the old standalone script (strategy breakdown, exit reasons, MFE/MAE, diagnostics) so the regression test and trade validator can parse it.

The current BacktestRecorder (`core/BacktestRecorder.js`) has `printSummary()` and `exportCSV()`. These need to be expanded to match the output format that regression-test.js and trade-validator.js expect.
