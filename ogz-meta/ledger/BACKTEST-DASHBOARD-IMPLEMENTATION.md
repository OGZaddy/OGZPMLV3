═══════════════════════════════════════════════════════════════════════════════
  BACKTEST DASHBOARD — IMPLEMENTATION GUIDE
  
  Companion to: BACKTEST-DASHBOARD-SPEC.md
  Purpose: Engineering details for Claude Code to actually build this
  Date: 2026-02-28
═══════════════════════════════════════════════════════════════════════════════


████████████████████████████████████████████████████████████████████████████████
█ PREREQUISITE: FIX THE TWO BUGS FIRST                                       █
████████████████████████████████████████████████████████████████████████████████

Before building ANYTHING, fix these two bugs discovered in the last backtest:

BUG 1: max_hold tagging uses raw PnL (before fees) to decide winner/loser
────────────────────────────────────────────────────────────────────────────
File: core/ExitContractManager.js — checkExitConditions() method
Where: The max_hold exit check (around line 275-282)

Current code:
    const holdExitType = pnlPercent > 0 ? 'max_hold_winner' : 'max_hold_loser';

Problem: Trade 1 in the last CSV had raw pnl +0.03% but net pnl -0.49%
         after 0.52% fees. It was tagged "max_hold_winner" but it LOST money.

Fix:
    // Account for round-trip fees when determining winner/loser
    const roundTripFeePct = (this.feePerSide || 0.0026) * 2 * 100;
    const holdExitType = pnlPercent > roundTripFeePct
      ? 'max_hold_winner'
      : 'max_hold_loser';

Note: pnlPercent at this point should be the RAW percent move (not in
decimal — verify whether it's 0.03 or 3.0 at this location). The fee
threshold needs to match the same unit. Check nearby code for how 
pnlPercent is calculated and match units accordingly.


BUG 2: Confidence filter bypass — trades at 15% and 20% got through 50% gate
────────────────────────────────────────────────────────────────────────────
This is the more critical bug. Multiple entry paths exist. The confidence
gate only covers one of them.

Step 1: Find ALL entry paths
    grep -rn "executeTrade\|openPosition\|executeOrder\|createPosition" run-empire-v2.js

Step 2: For EACH entry path found, verify a confidence check exists
    The check should be:
        if (decision.confidence < minTradeConfidence * 100) {
            // REJECT — confidence too low
            return;
        }
    
    Note: minTradeConfidence is stored as 0.50 (decimal), but
    decision.confidence comes through as 50.0 (percentage).
    The comparison must account for this mismatch.

Step 3: If ANY path is missing the gate, add it. Don't assume
    a single gate catches everything — check every fork.

Step 4: Add a log at the actual execution point:
    console.log(`🔒 CONFIDENCE GATE: ${decision.confidence}% vs ${minTradeConfidence * 100}% threshold — ${decision.confidence >= minTradeConfidence * 100 ? 'PASS' : 'BLOCKED'}`);

COMMIT these fixes:
git commit -m "fix: max_hold uses net PnL after fees, confidence gate on all entry paths

Bug 1: max_hold_winner/loser now checks P&L against round-trip fee (0.52%)
Bug 2: Found and gated all entry paths against 50% confidence threshold"


████████████████████████████████████████████████████████████████████████████████
█ THE REAL ENGINEERING CHALLENGE: ISOLATING THE BACKTEST ENGINE               █
████████████████████████████████████████████████████████████████████████████████

The hard part of building this dashboard isn't the frontend — it's
extracting the backtest execution logic from run-empire-v2.js into
something that can run in a worker thread with config overrides.

run-empire-v2.js is ~4000 lines. It mixes:
  - Live trading loop (WebSocket to Kraken)
  - Backtest mode (process historical candles)
  - Strategy evaluation (StrategyOrchestrator)
  - Trade execution (executeTrade function)
  - Exit monitoring (ExitContractManager integration)
  - State management (StateManager)
  - Logging, pattern learning, and everything else

The backtest mode ALREADY exists — it's triggered by environment flags.
We don't need to rewrite the engine. We need to WRAP it.

═══ APPROACH: Worker Wrapper, Not Engine Rewrite ═══

The worker (backtest-worker.js) should:

1. Set environment variables that configure the engine for backtest mode
2. Override config objects BEFORE the engine initializes
3. Require/import the necessary modules
4. Feed candle data and collect results
5. Emit progress messages back to the main thread

The worker does NOT rewrite the trading logic. It just runs the existing
engine with overrides injected. This is critical — if we rewrite the
engine, we introduce new bugs and the backtest no longer tests what
the live bot would actually do.

═══ Config Override Strategy ═══

The existing engine reads config from several sources:
  - process.env variables (MAX_POSITION_SIZE_PCT, etc.)
  - Constructor parameters for StrategyOrchestrator
  - DEFAULT_CONTRACTS object in ExitContractManager
  - Hardcoded values scattered throughout

For the worker, override these BEFORE module initialization:

Method 1 (environment variables — already supported):
    process.env.MAX_POSITION_SIZE_PCT = config.basePositionPercent / 100;
    process.env.BACKTEST_MODE = 'true';
    process.env.BACKTEST_DATA_FILE = config.dataFile;

Method 2 (module-level overrides — needs small code changes):
    For ExitContractManager.DEFAULT_CONTRACTS:
      Option A: Add a static setOverrides(overrides) method
      Option B: Accept overrides in the constructor
      Option C: Read from a config file path passed via env var
    
    For StrategyOrchestrator confidence thresholds:
      Already configurable via constructor config object.
      Pass overrides: new StrategyOrchestrator({ 
        minStrategyConfidence: config.minOrchestratorConfidence / 100 
      });

Method 3 (monkey-patching — avoid if possible):
    If a module doesn't support config injection, we CAN override
    its exported objects after require(). But this is fragile.

RECOMMENDATION: Use Method 1 for values already read from env vars.
Add Method 2 for ExitContractManager (one small change to the module).
This requires minimal changes to the existing codebase.


████████████████████████████████████████████████████████████████████████████████
█ backtest-worker.js — Skeleton                                              █
████████████████████████████████████████████████████████████████████████████████

const { parentPort, workerData } = require('worker_threads');
const config = workerData.config;

// ═══ Step 1: Set environment overrides BEFORE loading engine modules ═══
process.env.BACKTEST_MODE = 'true';
process.env.BACKTEST_FAST = 'true';
process.env.MAX_POSITION_SIZE_PCT = String(config.basePositionPercent / 100);

// ═══ Step 2: Load engine modules ═══
// These read process.env at load time, so env must be set first
const ExitContractManager = require('./core/ExitContractManager');
const StrategyOrchestrator = require('./core/StrategyOrchestrator');
const BacktestRecorder = require('./core/BacktestRecorder');
const StateManager = require('./core/StateManager');
// ... other required modules

// ═══ Step 3: Apply config overrides ═══
if (config.exitOverrides) {
  // Override DEFAULT_CONTRACTS if the module exposes them
  // This needs ExitContractManager to have a setOverrides() method
  // OR we modify the contracts after construction
  const overrides = config.exitOverrides;
  if (overrides.takeProfitPercent !== null) {
    // Apply to all strategy contracts
    Object.keys(ExitContractManager.DEFAULT_CONTRACTS).forEach(strategy => {
      ExitContractManager.DEFAULT_CONTRACTS[strategy].takeProfitPercent = overrides.takeProfitPercent;
    });
  }
  // Same for stopLoss, trailing, maxHold...
}

// ═══ Step 4: Load candle data ═══
const candles = loadCandles(config.dataFile, config.startDate, config.endDate);
const totalCandles = candles.length;

// ═══ Step 5: Run the backtest loop ═══
// This is where the actual engine processes candles
// Emit progress every 100 candles:
let candlesProcessed = 0;
for (const candle of candles) {
  // Process candle through the engine...
  // (This is the part that depends on how the engine is structured)
  
  candlesProcessed++;
  if (candlesProcessed % 100 === 0) {
    parentPort.postMessage({
      type: 'progress',
      candlesProcessed,
      totalCandles,
      percent: (candlesProcessed / totalCandles * 100).toFixed(1),
      tradeCount: recorder.trades.length,
      // Live stats if available
    });
  }
}

// ═══ Step 6: Collect and return results ═══
const results = buildResults(recorder, config);
parentPort.postMessage({ type: 'complete', results });


CRITICAL QUESTION FOR CLAUDE CODE:
How does the backtest loop work in run-empire-v2.js right now?

Look for: the function or code block that iterates through historical
candles in backtest mode. It probably looks something like:

    for (let i = 0; i < candles.length; i++) {
      processCandle(candles[i]);
    }

Or it might be event-driven with a fake WebSocket feeding candles.
Or it might process all candles in a batch in a separate function.

FIND THIS LOOP. That's the code that goes into the worker.
Everything else (Express server, WebSocket, frontend) is just
plumbing around this core loop.


████████████████████████████████████████████████████████████████████████████████
█ backtest-server.js — Skeleton                                              █
████████████████████████████████████████████████████████████████████████████████

const express = require('express');
const { Worker } = require('worker_threads');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.BACKTEST_PORT || 3333;

// ═══ Active runs tracking ═══
const activeRuns = new Map(); // runId -> { worker, config, status, results }
const runHistory = [];        // Completed runs for comparison

// ═══ WebSocket for live progress ═══
const server = app.listen(PORT, () => {
  console.log(`Backtest Dashboard running on http://localhost:${PORT}`);
});
const wss = new WebSocketServer({ server });
const wsClients = new Set();
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wsClients.forEach(ws => {
    if (ws.readyState === 1) ws.send(msg);
  });
}

// ═══ API: Start a backtest ═══
app.post('/api/backtest/run', (req, res) => {
  const config = req.body;
  const runId = `run-${Date.now()}`;
  
  const worker = new Worker('./backtest-worker.js', {
    workerData: { config, runId }
  });
  
  activeRuns.set(runId, {
    worker,
    config,
    status: 'running',
    startTime: Date.now(),
    progress: 0,
    results: null
  });
  
  worker.on('message', (msg) => {
    if (msg.type === 'progress') {
      activeRuns.get(runId).progress = msg.percent;
      broadcast({ runId, ...msg });
    }
    if (msg.type === 'complete') {
      const run = activeRuns.get(runId);
      run.status = 'complete';
      run.results = msg.results;
      run.endTime = Date.now();
      // Save to disk
      const resultPath = path.join(__dirname, 'backtest-results', `${runId}.json`);
      fs.writeFileSync(resultPath, JSON.stringify({
        config: run.config,
        results: run.results,
        startTime: run.startTime,
        endTime: run.endTime,
        duration: run.endTime - run.startTime
      }, null, 2));
      broadcast({ runId, type: 'complete', results: msg.results });
      runHistory.push(runId);
    }
  });
  
  worker.on('error', (err) => {
    activeRuns.get(runId).status = 'error';
    activeRuns.get(runId).error = err.message;
    broadcast({ runId, type: 'error', error: err.message });
  });
  
  res.json({ runId, status: 'started' });
});

// ═══ API: Get status ═══
app.get('/api/backtest/status', (req, res) => {
  const statuses = {};
  activeRuns.forEach((run, id) => {
    statuses[id] = {
      status: run.status,
      progress: run.progress,
      startTime: run.startTime,
      config: run.config
    };
  });
  res.json(statuses);
});

// ═══ API: Get results ═══
app.get('/api/backtest/results/:runId', (req, res) => {
  const run = activeRuns.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (run.status !== 'complete') return res.json({ status: run.status });
  res.json(run.results);
});

// ═══ API: List available data files ═══
app.get('/api/data/files', (req, res) => {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) return res.json([]);
  const files = fs.readdirSync(dataDir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      name: f,
      size: fs.statSync(path.join(dataDir, f)).size,
      path: path.join(dataDir, f)
    }));
  res.json(files);
});

// ═══ API: List past results ═══
app.get('/api/backtest/history', (req, res) => {
  const resultsDir = path.join(__dirname, 'backtest-results');
  if (!fs.existsSync(resultsDir)) return res.json([]);
  const files = fs.readdirSync(resultsDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 50);
  const history = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(resultsDir, f)));
    return {
      runId: f.replace('.json', ''),
      config: data.config,
      startTime: data.startTime,
      duration: data.duration,
      // Summary stats for the list view
      totalTrades: data.results?.aggregate?.totalTrades || 0,
      netPnl: data.results?.aggregate?.netPnlPercent || 0,
      winRate: data.results?.aggregate?.winRate || 0
    };
  });
  res.json(history);
});

// ═══ API: Stop a run ═══
app.post('/api/backtest/stop/:runId', (req, res) => {
  const run = activeRuns.get(req.params.runId);
  if (!run || run.status !== 'running') {
    return res.status(404).json({ error: 'No active run found' });
  }
  run.worker.terminate();
  run.status = 'stopped';
  broadcast({ runId: req.params.runId, type: 'stopped' });
  res.json({ status: 'stopped' });
});


████████████████████████████████████████████████████████████████████████████████
█ FRONTEND DESIGN DIRECTION                                                  █
████████████████████████████████████████████████████████████████████████████████

Aesthetic: DARK TRADING TERMINAL
Think Bloomberg Terminal meets TradingView meets modern dark mode SaaS.

Color palette:
  Background:  #0a0e17 (near-black with blue tint)
  Surface:     #131a2a (cards, panels)
  Border:      #1e2a3f (subtle separators)
  Text:        #e0e6f0 (primary), #7b8a9e (secondary)
  Green:       #00d395 (profit, wins, positive)
  Red:         #ff4757 (loss, stops, negative)
  Amber:       #ffb800 (warnings, max_hold, caution)
  Blue:        #4a9eff (links, info, neutral)
  Accent:      #e8a838 (OGZPrime brand gold — from existing docs)

Font: 'JetBrains Mono' for numbers/data, 'Inter' for UI text
  (these are free Google Fonts, load from CDN)

Layout: Three-panel responsive
  - Left sidebar: Config panel (collapsible)
  - Center: Main content (charts, progress, results)
  - Right sidebar: Trade log (collapsible)
  - Full-width on mobile

Charts: Use Chart.js (CDN link below)
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  
  Dark theme Chart.js config:
  Chart.defaults.color = '#7b8a9e';
  Chart.defaults.borderColor = '#1e2a3f';
  Chart.defaults.backgroundColor = 'rgba(0, 211, 149, 0.1)';

Key charts:
  1. Equity curve (line — green when above starting, red when below)
  2. P&L per trade (bar — green/red per trade)
  3. Exit reason breakdown (doughnut — colors per reason type)
  4. Strategy P&L (horizontal bar — sorted by contribution)
  5. Drawdown (area — red fill below zero line)
  6. Confidence vs outcome (scatter — x=confidence, y=net PnL, color=win/loss)

Animations: Subtle and fast.
  - Cards slide in on page load (opacity + translateY, 200ms stagger)
  - Progress bar smooth transition
  - Chart data transitions on load
  - No gratuitous motion — this is a work tool, not a showcase


████████████████████████████████████████████████████████████████████████████████
█ RESULTS DATA STRUCTURE                                                     █
████████████████████████████████████████████████████████████████████████████████

The worker returns this structure. The frontend renders it.

{
  "runId": "run-1709164800000",
  "config": { /* the config that was used for this run */ },
  "duration": 45200,  // milliseconds

  "trades": [
    {
      "tradeNumber": 1,
      "entryTime": "2023-01-01T00:14:00.000Z",
      "exitTime": "2023-01-01T04:14:00.000Z",
      "direction": "long",
      "entryPrice": 16510.82,
      "exitPrice": 16760.00,
      "strategy": "RSI",
      "confidence": 55.8,
      "confluenceCount": 1,
      "stopLoss": -1.0,
      "takeProfit": 2.0,
      "trailingActivation": 0.8,
      "exitReason": "take_profit",
      "rawPnlDollars": 14.20,
      "feeDollars": 0.95,
      "netPnlDollars": 13.25,
      "netPnlPercent": 1.33,
      "balanceAfter": 10013.25,
      "holdTimeMinutes": 240,
      "maxProfitDuringTrade": 2.14,
      "maxDrawdownDuringTrade": -0.35
    }
    // ... more trades
  ],

  "aggregate": {
    "totalTrades": 156,
    "wins": 74,
    "losses": 82,
    "winRate": 47.4,
    "avgWinnerPercent": 2.14,
    "avgLoserPercent": -1.08,
    "rewardRiskRatio": 1.98,
    "profitFactor": 1.87,
    "netPnlDollars": 1247.50,
    "netPnlPercent": 12.5,
    "maxDrawdownPercent": -4.2,
    "maxConsecutiveWins": 7,
    "maxConsecutiveLosses": 5,
    "totalFeesPaid": 312.40,
    "sharpeRatio": 1.42,
    "avgHoldTimeMinutes": 185,
    "longestTradeMinutes": 355,
    "shortestTradeMinutes": 30
  },

  "exitBreakdown": {
    "take_profit":      { count: 53, percent: 34.0, avgPnl: 1.82 },
    "trailing_stop":    { count: 34, percent: 21.8, avgPnl: 1.45 },
    "stop_loss":        { count: 28, percent: 17.9, avgPnl: -1.12 },
    "max_hold_winner":  { count: 19, percent: 12.2, avgPnl: 0.32 },
    "max_hold_loser":   { count: 12, percent:  7.7, avgPnl: -0.44 },
    "profit_tier_1":    { count: 6,  percent:  3.8, avgPnl: 0.58 },
    "invalidation":     { count: 4,  percent:  2.6, avgPnl: -0.67 }
  },

  "strategyBreakdown": {
    "MarketRegime":      { trades: 28, wins: 16, netPnl: 820.50,  avgPnl: 29.30 },
    "MultiTimeframe":    { trades: 24, wins: 13, netPnl: 490.20,  avgPnl: 20.42 },
    "RSI":               { trades: 32, wins: 15, netPnl: 180.00,  avgPnl: 5.63 },
    "EMASMACrossover":   { trades: 22, wins: 10, netPnl: 40.00,   avgPnl: 1.82 },
    "CandlePattern":     { trades: 18, wins: 8,  netPnl: -12.30,  avgPnl: -0.68 },
    "LiquiditySweep":    { trades: 16, wins: 6,  netPnl: -95.40,  avgPnl: -5.96 },
    "MADynamicSR":       { trades: 16, wins: 6,  netPnl: -176.00, avgPnl: -11.00 }
  },

  "equityCurve": [
    { "time": "2023-01-01T00:00:00Z", "balance": 10000 },
    { "time": "2023-01-01T04:14:00Z", "balance": 10013.25 },
    // ... one entry per trade
  ],

  "drawdownCurve": [
    { "time": "2023-01-01T00:00:00Z", "drawdown": 0 },
    { "time": "2023-01-15T12:00:00Z", "drawdown": -2.3 },
    // ... tracks underwater from peak
  ]
}


████████████████████████████████████████████████████████████████████████████████
█ STRATEGY TOGGLE IMPLEMENTATION                                             █
████████████████████████████████████████████████████████████████████████████████

The dashboard needs checkboxes to enable/disable specific strategies.
This requires knowing which strategies exist and how they're evaluated.

Current strategies (from StrategyOrchestrator):
  - EMASMACrossover (DeathCross/GoldenCross)
  - LiquiditySweep (BBSqueeze)
  - RSI (RSIExtreme)
  - MADynamicSR (TrendFollowing)
  - CandlePattern
  - MarketRegime (RegimeConfluence)
  - MultiTimeframe
  - OGZTPO

To disable a strategy in the backtest, the worker needs to either:
  A) Pass enabledStrategies list → Orchestrator skips disabled ones
  B) Set disabled strategy confidence to 0 → Never passes threshold
  C) Filter out disabled strategies from evaluation results

Option A is cleanest. The StrategyOrchestrator constructor or evaluate()
method should accept an enabledStrategies filter. If this doesn't exist
yet, add it:

    evaluate(candle, enabledStrategies = null) {
      const strategies = this.getStrategies();
      const filtered = enabledStrategies 
        ? strategies.filter(s => enabledStrategies.includes(s.name))
        : strategies;
      // ... evaluate filtered strategies
    }


████████████████████████████████████████████████████████████████████████████████
█ PARALLEL A/B COMPARISON — UI DESIGN                                        █
████████████████████████████████████████████████████████████████████████████████

When "Run Parallel" is clicked:

CONFIG SCREEN:
┌─────────── Run A ───────────┐  ┌─────────── Run B ───────────┐
│ TP: [2.0%]  SL: [-1.0%]    │  │ TP: [1.5%]  SL: [-0.8%]    │
│ Trail: [0.8%] Act: [1.0%]  │  │ Trail: [0.5%] Act: [0.7%]  │
│ Confidence: [50%]          │  │ Confidence: [40%]          │
│ [x] RSI [x] MarketRegime  │  │ [x] RSI [x] MarketRegime  │
│ [ ] CandlePattern          │  │ [x] CandlePattern          │
└─────────────────────────────┘  └─────────────────────────────┘
                    [ Run Both ]

PROGRESS SCREEN:
Run A: ████████████░░░░░ 65%  |  Run B: ██████████░░░░░░░ 52%
Trades: 42  Win: 48%          |  Trades: 67  Win: 51%

RESULTS SCREEN:
┌─────────── Run A ───────────┐  ┌─────────── Run B ───────────┐
│ Net P&L: +12.5% ↑          │  │ Net P&L: +8.2%              │
│ Win Rate: 47.4%             │  │ Win Rate: 52.1%             │
│ R:R: 1.98:1 ↑              │  │ R:R: 1.34:1                │
│ Trades: 156                 │  │ Trades: 234                 │
│ Max DD: -4.2%               │  │ Max DD: -5.8% ↓             │
└─────────────────────────────┘  └─────────────────────────────┘

↑ = this metric is better than the other run
↓ = this metric is worse than the other run

Charts overlay both runs with different colors:
  Run A = blue (#4a9eff)
  Run B = amber (#ffb800)
  
  Equity curves on same chart, two lines.
  Exit reason doughnuts side-by-side.
  Strategy bars interleaved.


████████████████████████████████████████████████████████████████████████████████
█ FILE STRUCTURE                                                             █
████████████████████████████████████████████████████████████████████████████████

ogzprime/
├── backtest-server.js          ← Express + WebSocket server
├── backtest-worker.js          ← Worker thread (wraps engine)
├── backtest-results/           ← Saved JSON results (gitignored)
│   ├── run-1709164800000.json
│   └── ...
├── public/                     ← Frontend (served by Express)
│   ├── index.html              ← Main page (single page app)
│   ├── css/
│   │   └── dashboard.css       ← Dark theme styles
│   └── js/
│       ├── app.js              ← Main frontend logic
│       ├── charts.js           ← Chart.js chart builders
│       ├── config-panel.js     ← Config form logic
│       └── websocket.js        ← WebSocket connection manager
├── data/                       ← Candle data files
│   ├── polygon-btc-1y.json
│   └── polygon-btc-3k.json
├── core/                       ← (existing) Trading engine modules
├── run-empire-v2.js            ← (existing) Main engine
└── package.json                ← Add express and ws dependencies


████████████████████████████████████████████████████████████████████████████████
█ DEPENDENCIES TO INSTALL                                                    █
████████████████████████████████████████████████████████████████████████████████

npm install express ws

That's it. Chart.js loads from CDN. No build step.
No React. No webpack. No babel. Just HTML, CSS, vanilla JS.

This keeps it simple and fast to iterate.
We can add React later for the customer version.


████████████████████████████████████████████████████████████████████████████████
█ BUILD ORDER (for Claude Code)                                              █
████████████████████████████████████████████████████████████████████████████████

PHASE 0: Fix the two bugs (max_hold PnL, confidence gate)
  → Commit

PHASE 1: backtest-worker.js
  1. Study how run-empire-v2.js processes candles in backtest mode
  2. Create worker that wraps this loop
  3. Accept config overrides
  4. Emit progress messages
  5. Return full results in the data structure above
  6. Test standalone: node backtest-worker.js (with test config)
  → Commit

PHASE 2: backtest-server.js
  1. Express server with API routes
  2. Worker thread management
  3. WebSocket broadcasting
  4. Results storage
  5. Test: curl POST to /api/backtest/run, watch progress
  → Commit

PHASE 3: Frontend
  1. index.html with config panel
  2. CSS dark theme
  3. WebSocket connection for live progress
  4. Results dashboard with Chart.js charts
  5. Sortable/filterable trade log table
  6. Test: open browser, configure, run, see results
  → Commit

PHASE 4: Parallel mode
  1. A/B config panel UI
  2. Two workers simultaneously
  3. Side-by-side results comparison
  4. Overlay charts
  → Commit

Each phase is a working increment. Phase 1 alone is already useful
(can run backtests from a config file). Phase 2 adds the API.
Phase 3 adds the visual dashboard. Phase 4 adds comparison.

Don't skip to Phase 3 before Phase 1 works. The worker is the foundation.


████████████████████████████████████████████████████████████████████████████████
█ ACCESSING THE DASHBOARD                                                    █
████████████████████████████████████████████████████████████████████████████████

On the VPS:
  node backtest-server.js
  → Dashboard at http://localhost:3333

From Trey's iPad/laptop:
  The VPS has a public IP. Access via http://<VPS_IP>:3333

  If port 3333 isn't open, either:
  A) Open it in the VPS firewall (quick but less secure)
  B) SSH tunnel: ssh -L 3333:localhost:3333 user@vps
  C) Use nginx reverse proxy with basic auth (production-ready)

  Option B is recommended for now (secure, no config needed).
  Option C for when customers use it.


████████████████████████████████████████████████████████████████████████████████
█ FUTURE: DOCKER (after dashboard works)                                     █
████████████████████████████████████████████████████████████████████████████████

Once the dashboard is working locally, Dockerize it:

Dockerfile:
  FROM node:20-slim
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY . .
  EXPOSE 3333
  CMD ["node", "backtest-server.js"]

docker-compose.yml:
  services:
    backtest:
      build: .
      ports:
        - "3333:3333"
      volumes:
        - ./data:/app/data
        - ./backtest-results:/app/backtest-results

This makes the entire backtest engine portable. Anyone can:
  docker-compose up
  → Open localhost:3333
  → Run backtests

This IS the customer product, packaged.
But Docker is AFTER the dashboard works. Don't prematurely optimize.
