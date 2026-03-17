# OGZPrime ML V2 - Empire Architecture

## The New Standard in Universal Trading

### Architecture
- **Foundation**: Universal broker adapters (crypto, stocks, options, forex)
- **Core**: Battle-tested trading modules (20 essential)
- **Specialized**: Asset-specific implementations
- **Pure Functions**: Mathematical transformations with no side effects

---

## Start Here / Architecture Map

New to the codebase? Start with these docs:

| Document | Purpose |
|----------|---------|
| [`ogz-meta/OGZPrime-Master-Engineering-Spec.md`](ogz-meta/OGZPrime-Master-Engineering-Spec.md) | Full system specification |
| [`ogz-meta/ogzprime-architecture.mermaid`](ogz-meta/ogzprime-architecture.mermaid) | System component map |
| [`ogz-meta/ogzprime-broker-chain.mermaid`](ogz-meta/ogzprime-broker-chain.mermaid) | Broker layer chain |
| [`ogz-meta/ogzprime-data-structures.mermaid`](ogz-meta/ogzprime-data-structures.mermaid) | Data formats |
| [`ogz-meta/claudito_context.md`](ogz-meta/claudito_context.md) | Full system context |
| [`ogz-meta/04_guardrails-and-rules.md`](ogz-meta/04_guardrails-and-rules.md) | What NOT to do |
| [`ogz-meta/05_landmines-and-gotchas.md`](ogz-meta/05_landmines-and-gotchas.md) | Known traps |
| [`foundation/IBrokerAdapter.js`](foundation/IBrokerAdapter.js) | Broker integration contract |
| [`run-empire-v2.js`](run-empire-v2.js) | Main orchestrator |

### Runtime Data Flow
```
Market Data → CandleStore/Aggregator → IndicatorEngine → FeatureExtractor
    → StrategyOrchestrator → AdaptiveTimeframeSelector → PositionSizer
    → OrderRouter → BrokerAdapter → StateManager → Dashboard/Backtest
```

---

## Key Features
- Two-Pole Oscillator [BigBeluga] integration
- Grid trading strategy
- Scalp signal management
- Tier-based feature flags (indicator/ML)
- Empire V2 universal architecture
- Multi-broker support (Kraken, Binance, Coinbase, IBKR, etc.)
- Backtest parity with live execution

## Running the Bot

### Live/Paper Trading
```bash
node run-empire-v2.js
```

### Backtesting
```bash
EXECUTION_MODE=backtest CANDLE_DATA_FILE=tuning/full-45k.json node run-empire-v2.js
```

### Parallel Parameter Sweep
```bash
node tools/parallel-backtest.js --quick      # 5 configs
node tools/parallel-backtest.js --boosters   # Alpha booster sweep
node tools/parallel-backtest.js --full       # Full 60+ configs
```

## Configuration
See `config/.env.example` for environment variables.

### Key Env Vars
| Variable | Default | Description |
|----------|---------|-------------|
| `EXECUTION_MODE` | `paper` | `live`, `paper`, or `backtest` |
| `MIN_TRADE_CONFIDENCE` | `0.50` | Minimum confidence to enter trade |
| `MAX_POSITION_SIZE_PCT` | `0.04` | Position size as % of balance |
| `STOP_LOSS_PERCENT` | `2.0` | Default stop loss % |
| `TAKE_PROFIT_PERCENT` | `2.5` | Default take profit % |

---

## Directory Structure
```
OGZPMLV2/
├── foundation/        # Universal broker adapters & interfaces
├── brokers/           # Broker-specific implementations
├── core/              # Battle-tested trading modules
│   ├── strategies/    # Strategy implementations
│   ├── exit/          # Exit management
│   └── ...
├── modules/           # Standalone components
├── tuning/            # Backtest data & results
├── tools/             # CLI utilities (parallel-backtest, etc.)
├── ogz-meta/          # Architecture docs & specs
│   ├── ledger/        # Fix history & lessons learned
│   └── sessions/      # Session handoff logs
└── run-empire-v2.js   # Main orchestrator
```

---
*Built with maximum aggression and zero compromise.*
