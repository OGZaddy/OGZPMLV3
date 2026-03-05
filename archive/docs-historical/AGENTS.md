# AGENTS.md - OGZPrime Empire V2 Development Guide

## Build/Test/Lint Commands

```bash
npm start              # Run bot: node run-empire-v2.js
npm run test           # Run all tests (smoke + patterns)
npm run test:smoke     # Single test: node scripts/smoke-test.js
npm run test:patterns  # Single test: node scripts/test-patterns.js
npm run check          # Syntax check: node --check run-trading-bot-v14FINAL.js
npm run backtest       # Backtest: node tools/optimized-backtester.js
```

## Architecture

- **Core**: `core/` - Pattern recognition, indicators, execution layer, risk management
- **Brokers**: `brokers/` - Adapter pattern for multi-exchange support (Kraken, etc)
- **Data**: `data/` - Pattern memory store, persistent state
- **Config**: `config/` - Environment and asset configurations
- **Utils**: `utils/` - Helpers, Discord notifications, logging
- **Specialized**: `specialized/` - Asset-specific trading strategies

Key modules: `EnhancedPatternRecognition.js`, `OptimizedTradingBrain.js`, `RiskManager.js`, `OptimizedIndicators.js`

## Code Style

- **Imports**: `const Module = require('./path')` at top of file
- **Classes**: PascalCase; static methods for utilities
- **Functions**: camelCase; named exports with module.exports
- **Comments**: JSDoc for public methods; CHANGE XXX prefix for tracked fixes
- **Errors**: Try/catch with meaningful console logs; fallback returns (null/false/0)
- **Safety**: Validate inputs; use guard clauses; clamp numeric ranges
