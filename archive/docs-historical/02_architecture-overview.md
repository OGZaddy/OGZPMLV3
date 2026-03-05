# 02 – Architecture Overview

## High-Level Shape

OGZPrime is a **modular trading engine** with a clear separation between:

- **Signal/Brain Layer** – decides *what* to do
- **Execution Layer** – decides *how* to do it on real brokers
- **Risk / Guardrail Layer** – decides *if* we're allowed to do it
- **Pattern / Learning Layer** – watches history and adapts
- **I/O / Infra Layer** – websockets, data feeds, logs, config, dashboards
- **Claudito Pipeline Layer** – ALL code changes go through this (mandatory)
- **Proof Logging Layer** – immutable audit trail for trading proof + Claudito activity

Everything should plug into those lanes.
No module should try to be "the whole bot".

---

## Runtime Flow (Candle Loop)

1. **Market Data In**
   - Websocket / feed ingests ticks/candles
   - Normalized into a standard structure (symbol, timeframe, OHLCV, metadata)

2. **Pre-Checks**
   - Circuit/guardrail checks (market open, spread sanity, max risk per symbol, etc.)
   - If any HARD guardrail fails → **no trade**, log why.

3. **Signal Generation**
   - Technical + pattern + ML engines run:
     - Indicators (RSI/MA/ATR/etc.)
     - Pattern recognition (EnhancedPatternRecognition, pattern memory)
     - Regime detection (MarketRegimeDetector / neuromorphic cores)
   - Output: one or more **signals** with:
     - side, size_hint, confidence, rationale, metadata

4. **Decision / Consolidation**
   - Core decision brain (UnifiedTradingCore / OptimizedTradingBrain / QuantumNeuromorphicCore)
   - Merges all signals into a **single decision** per symbol:
     - “OPEN_LONG”, “OPEN_SHORT”, “CLOSE_LONG”, “FLAT”, etc.
   - Applies strategy rules + current positions + risk constraints.

5. **Execution Layer**
   - Maps decision → broker API calls:
     - position sizing
     - order type (market/limit/TP/SL)
     - retries, error handling, idempotency
   - Multi-broker logic is handled here, not in the brain.

6. **Post-Trade Logging + Learning**
   - LogLearningSystem / pattern memory update:
     - decision id
     - features snapshot
     - outcome (PnL, MAE/MFE, duration, regime tags)
   - EnhancedPatternRecognition updates:
     - pattern counts / stats
     - persist to `data/pattern-memory.json`

7. **Telemetry / Dashboard**
   - WebsocketManager + dashboard:
     - live positions
     - recent trades
     - PnL curves
     - health stats / error events

---

## Key Architectural Rules

- **Single Responsibility**
  - Each module has ONE main job (decision, execution, risk, learning, etc.).
  - If a file starts doing too many things, it’s a design smell.

- **Brain-Agnostic Execution**
  - ExecutionLayer should work with *any* brain that outputs the standard decision schema.
  - Brains can be swapped (classic, quantum, ML) without rewriting broker code.

- **Config-Driven Behavior**
  - Strategy, risk, and broker settings live in config / profiles.
  - Code shouldn’t hard-code per-broker quirks when a config can express it.

- **Deterministic on Same Inputs**
  - Given the same data + config, the system should make the same decision.
  - Randomization (if any) must be explicit and logged.

- **No Silent Failure**
  - If something is wrong (no data, malformed signal, order rejection),
    the system logs loudly with enough context to trace it later.

---

## Upgrade Path

- **New Brains** (ML/quantum/neuromorphic)
  - Plug in at the **Signal/Brain** layer.
  - Must emit the standard decision schema used by ExecutionLayer.

- **New Brokers**
  - Implement a broker adapter that speaks:
    - `placeOrder`, `cancelOrder`, `getPositions`, `getBalance`, etc.
  - ExecutionLayer routes through the adapter instead of talking per-broker APIs directly.

- **New Risk Models**
  - Attach into the **Pre-Checks** and/or **Decision** stage.
  - They should *veto* or *scale* decisions, not silently replace them.

---

## Claudito Pipeline (MANDATORY for Code Changes)

**Added:** 2026-01-25

```
*************************************************************
*                                                           *
*   ALL CODE CHANGES MUST GO THROUGH CLAUDITO PIPELINE      *
*                                                           *
*   *** NO EXCEPTIONS ***                                   *
*                                                           *
*   Not "quick fixes." Not "small tweaks." Not "I'll just"  *
*   EVERYTHING goes through the pipeline.                   *
*                                                           *
*************************************************************
```

### Pipeline Flow
```
Phase 1: Plan
  /orchestrate → /warden → /architect → /purpose

Phase 2: Fix (loop until clean)
  /fixer → /debugger → /validator → /critic
     ↑___________________________|
     (if rejected)

Phase 3: Verify
  /cicd → /telemetry → /validator → /forensics

Phase 4: Ship
  /scribe → /commit → /janitor → /learning → /changelog
```

### Key Clauditos
| Claudito | Job |
|----------|-----|
| Warden | Blocks scope creep |
| Forensics | Finds bugs/landmines |
| Architect | Explains how affected area works (context) |
| Fixer | Applies minimal fix |
| Debugger | Tests fix works |
| Critic | Adversarial review |
| Validator | Quality gate |
| Scribe | Documents everything |

See `08_claudito-pipeline-process.md` for full details.

---

## Proof Logging Layer

**Added:** 2026-01-25

Two logging systems for full audit trail:

### ClauditoLogger (AI/Agent Activity)
- Logs all hook emissions
- Logs all Claudito decisions with reason + confidence
- Logs all errors with full context
- Logs mission status changes
- Output: `ogz-meta/logs/claudito-activity.jsonl`

### TradingProofLogger (Trading Activity)
- Logs every BUY with price, size, reason, confidence
- Logs every SELL with P&L calculation
- Logs position updates
- Generates daily summaries
- Includes plain English explanations
- Output: `ogz-meta/logs/trading-proof.jsonl`

### Purpose
1. Verifiable proof of profitability for website
2. Audit trail for debugging
3. Learning data for pattern improvement
4. Transparency (per ogz-meta rules)

---

## WebSocket & Dashboard Architecture

**Updated:** 2026-01-31

### Data Flow
```
Kraken WebSocket ─────────────────────────┐
       │                                   │
       ▼                                   │
┌─────────────────┐                        │
│ kraken_adapter  │ Market data (OHLC)     │
│ _simple.js      │◄──────────────────────►│ Kraken REST API
└────────┬────────┘   (historical data)    │
         │                                 │
         ▼                                 │
┌─────────────────┐                        │
│ run-empire-v2.js│ Trading Bot            │
│ (ogz-prime-v2)  │ - Signal generation    │
└────────┬────────┘ - TRAI decisions       │
         │          - Pattern learning     │
         │                                 │
         ▼                                 │
┌─────────────────┐                        │
│ ogzprime-ssl-   │ WebSocket Server       │
│ server.js       │ (port 3010)            │
│ (ogz-websocket) │ - Authenticates clients│
└────────┬────────┘ - Relays bot→dashboard │
         │          - Relays dashboard→bot │
         │                                 │
         ▼                                 │
┌─────────────────┐                        │
│ unified-        │ Dashboard              │
│ dashboard.html  │ - Chart (Lightweight)  │
└─────────────────┘ - Indicators           │
                    - TRAI chat widget     │
                    - Trade log            │
                    - Pattern analysis     │
```

### Key Components

| Component | Port | PM2 Name | Purpose |
|-----------|------|----------|---------|
| Trading Bot | - | ogz-prime-v2 | Signal generation, execution, TRAI |
| WebSocket Server | 3010 | ogz-websocket | Relay between bot and dashboard |
| Dashboard | 443 | (nginx) | User interface |

### Connection Health

Bot maintains connection to WebSocket server with:
- **Heartbeat**: Ping every 15s, timeout 30s
- **Data Watchdog**: Force reconnect if no messages for 60s
- **Auto-reconnect**: 2s delay on disconnect

Dashboard connects via nginx (SSL termination) → WebSocket server.

### Message Types

**Bot → Dashboard:**
- `price` - Real-time price updates
- `candle` - OHLC candles
- `trade` - Trade executions
- `bot_thinking` - TRAI Chain of Thought
- `pattern_analysis` - Pattern detection
- `historical_candles` - Bulk historical data

**Dashboard → Bot:**
- `trai_query` - TRAI chat questions
- `timeframe_change` - Switch chart timeframe
- `request_historical` - Request historical data

---

## Current Infrastructure

**Server:** VPS with A100 GPU
**Services:**
- nginx (SSL, reverse proxy)
- PM2 (process manager)
- Ollama (local LLM for TRAI)

**PM2 Processes:**
```
ogz-websocket   - WebSocket relay server
ogz-prime-v2    - Main trading bot
ogz-prime-gates - Gates proof bot (separate)
```

**Startup:** `./start-ogzprime.sh start`
