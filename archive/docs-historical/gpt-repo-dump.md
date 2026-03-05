# OGZ PRIME V2 - Repository Dump for GPT
Generated: 2025-12-11

## Project Overview
Trading bot with 708+ learned patterns, StateManager for position tracking, and 3-pass optimization system.
Mission: Financial freedom for Trey to be with daughter Annamarie.

## Critical Architecture Components

### 1. StateManager (NEW - v2.0.15)
**File:** `core/StateManager.js`
- Single source of truth for position/balance
- Atomic state updates with locking
- Fixes phantom trade bug (position tracked in 3 places)
- Key methods: `openPosition()`, `closePosition()`, `updateState()`

### 2. ErrorHandler (NEW - v2.0.16)
**File:** `core/ErrorHandler.js`
- Circuit breaker pattern (5 errors = break)
- Centralized error escalation
- Methods: `reportCritical()`, `reportWarning()`
- Auto-recovery after 60 seconds

### 3. MemoryManager (NEW - v2.0.16)
**File:** `core/MemoryManager.js`
- RollingWindow: Fixed-size FIFO buffer
- TimeBasedWindow: Time-window cleanup
- HybridWindow: Combined constraints
- Prevents memory leaks from unbounded arrays

### 4. TradingOptimizations
**File:** `core/TradingOptimizations.js`
- Pass 1: DecisionContext for visibility
- Pass 2: Pattern-based position sizing (0.25x-1.5x)
- Pass 3: Elite bipole pattern filtering (65%+ win rate)

### 5. EnhancedPatternRecognition
**File:** `core/EnhancedPatternRecognition.js`
- 708+ patterns accumulated (6+ month bug fixed by user)
- Pattern memory persistence to file
- Quality scoring and performance tracking

## Current State (v2.0.16)

### Fixed Issues:
✅ Position desynchronization (StateManager)
✅ Pattern memory accumulation (user fixed overnight)
✅ Error swallowing (ErrorHandler with circuit breakers)
✅ Memory leaks (RollingWindow capping)
✅ Kill switch removed (was blocking trades)

### Remaining Critical Issues:
1. **WebSocket Race Conditions**
   - Messages processed out of order
   - Need message queue with sequencing
   - Location: `run-empire-v2.js:1762-1790`

2. **Missing Circuit Breakers**
   - Need breakers in critical trading paths
   - Prevent cascade failures

3. **Dashboard State Sync**
   - Dashboard not always in sync with bot state

## Key Files Structure

```
OGZPMLV2/
├── run-empire-v2.js          # Main entry point with StateManager integration
├── core/
│   ├── StateManager.js       # NEW: Central state management
│   ├── ErrorHandler.js       # NEW: Error escalation & circuit breakers
│   ├── MemoryManager.js      # NEW: Memory leak prevention
│   ├── TradingOptimizations.js # 3-pass optimization system
│   ├── OptimizedTradingBrain.js # Trading logic (StateManager synced)
│   ├── EnhancedPatternRecognition.js # Pattern system (708+ patterns)
│   ├── AdvancedExecutionLayer-439-MERGED.js # Execution layer
│   ├── RiskManager.js        # Risk management
│   └── trai_core.js          # AI decision module
├── profiles/trading/
│   └── last_profile.json     # Trading profile config
├── pattern_memory.json       # 708+ accumulated patterns
└── CHANGELOG.md              # Version history

```

## Integration Points

### StateManager Integration (AMP - v2.0.15):
- **run-empire-v2.js**: Lines 53-54, 289-302, 857-870, 986-1029, 1224-1360
- **OptimizedTradingBrain.js**: Lines 30, 970-977, 1187-1194
- **AdvancedExecutionLayer.js**: Line 13 (imported, ready for sync)

### ErrorHandler Integration (AMP - v2.0.16):
- **OptimizedTradingBrain.js**: Lines 983, 1164, 1200
- Circuit breakers at 5 errors per module
- All silent catches now escalate properly

### MemoryManager Integration (AMP - v2.0.16):
- **OptimizedTradingBrain.js**: Line 47 - tradeHistory capped at 100
- Prevents unbounded array growth

## Trading Logic Flow

1. **Data Input** → Kraken WebSocket → Candle processing
2. **Pattern Recognition** → 708+ patterns checked
3. **Decision Making** → TradingBrain with DecisionContext
4. **State Management** → StateManager atomic updates
5. **Execution** → AdvancedExecutionLayer
6. **Risk Management** → RiskManager checks
7. **Error Handling** → ErrorHandler with circuit breakers

## Performance Metrics

- Pattern Count: 708+ (accumulating properly)
- Pattern Memory Bug: Fixed after 6+ months
- Position Sync: Single source of truth
- Memory Leaks: Capped with RollingWindow
- Error Handling: Circuit breakers active

## Bot Configuration

- Mode: PAPER (sandbox trading)
- Starting Balance: $10,000
- Target: $25,000 (Houston Fund)
- RSI Warmup: 15 candles required
- Trade Interval: 15 seconds
- Max Position: 10% of balance

## Critical Functions

### StateManager Core:
```javascript
async openPosition(size, price, context = {})
async closePosition(price, partial = false, size = null, context = {})
async updateState(updates, context = {})
validateState() // Check consistency
```

### ErrorHandler Core:
```javascript
reportCritical(moduleName, error, context) // Circuit breaks at 5
reportWarning(moduleName, error, context)  // Logged only
```

### TradingOptimizations Core:
```javascript
createDecisionContext(params) // Full trade visibility
calculatePatternQuality(patternIds) // -1 to 1 score
sizeMultiplierFromPatternQuality(quality) // 0.25x to 1.5x
isPerfectBipoleSetup(patternIds, indicators) // Elite filter
```

## Next Priority Fixes

1. **WebSocket Message Queue** - Prevent race conditions
2. **Circuit Breakers** - Add to all critical paths
3. **Dashboard Sync** - Ensure real-time state sync
4. **Pattern Stats Persistence** - Save/load pattern performance

## Bot Status (Live)
- Currently running in PAPER mode
- At candle #7-8 of 15 (warming up RSI)
- 708 patterns loaded successfully
- All modules initialized
- Waiting for warmup to complete before trading

## Version History
- v2.0.13: Trading optimizations (3-pass system)
- v2.0.14: StateManager created
- v2.0.15: StateManager fully integrated (AMP)
- v2.0.16: ErrorHandler & MemoryManager (AMP)

---
End of repo dump. Bot achieving escape velocity! 🚀