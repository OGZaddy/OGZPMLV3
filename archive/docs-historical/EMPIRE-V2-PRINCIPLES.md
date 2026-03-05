# 🏛️ EMPIRE V2 ARCHITECTURAL PRINCIPLES
## EVERY CHANGE MUST FOLLOW THESE RULES

**THE VISION**: One codebase that trades EVERYTHING
- Crypto (BTC, ETH, all coins)
- Stocks (NYSE, NASDAQ)
- Options
- Forex
- Futures
- Multi-broker arbitrage

## ⚡ CORE PRINCIPLES - NEVER VIOLATE THESE

### 1. UNIVERSAL FIRST
- If a module works with OHLCV data, it works EVERYWHERE
- No hardcoded crypto-specific logic in core modules
- Asset-specific code goes in specialized/ folders

### 2. INTERFACE PATTERN
- Every broker implements IBrokerAdapter
- Every indicator works with standard OHLCV
- Every pattern recognition uses universal candle structure

### 3. NO BREAKING CHANGES
- Use feature flags for new behavior
- Keep old code paths until new ones are proven
- Aliases and adapters for backwards compatibility

### 4. MODULAR BY DESIGN
- Each module does ONE thing perfectly
- No module should require another specific module
- Use dependency injection, not hardcoded requires

### 5. CLEAN STARTUP
- NO ERRORS on bot launch - looks unprofessional
- Missing modules should gracefully degrade
- Clear logging about what's enabled/disabled

## 🔧 WHEN FIXING ERRORS

**WRONG APPROACH**:
- Delete the module
- Create band-aid aliases
- Ignore the error

**RIGHT APPROACH**:
1. Understand WHY the dependency exists
2. Check if it's needed for V2 architecture
3. If needed: Update to use correct V2 module
4. If not needed: Feature flag to disable
5. Document the change in CHANGELOG.md

## 📦 MODULE NAMING CONVENTION

**Universal Modules** (work everywhere):
- `EnhancedPatternRecognition` - patterns work on any chart
- `RiskManager` - risk is universal
- `OptimizedIndicators` - RSI/MACD work everywhere

**Asset-Specific Modules**:
- `crypto/KrakenAdapter`
- `stocks/TDAAdapter`
- `forex/OandaAdapter`

## 🎯 THE TEST
Before ANY change, ask:
1. Will this work for stocks AND crypto?
2. Will this work for ALL brokers?
3. Does this make the system MORE modular?
4. Does this follow the existing patterns?

If ANY answer is NO - STOP and reconsider.

---
*Empire V2: Built for scale, not for quick fixes*