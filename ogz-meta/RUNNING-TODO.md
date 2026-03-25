# OGZPrime Running TODO

Persistent ideas and future work. One change at a time rule - pick one, finish it, commit it.

---

## IN PROGRESS

### SmartMoneySweep Strategy (#5)
**Status:** VALIDATED on TradingView - ready for Node.js port

**TradingView Results (2026-03-24):**
- TSLA: 207 trades, 49.76% WR, 1.555 PF, +$202.71
- NFLX: 223 trades, 55.16% WR, 1.071 PF, +$30.83
- NVDA: 185 trades, 51.35% WR, 1.212 PF, +$70.60
- AAPL: 232 trades, 48.28% WR, 0.827 PF, -$48.46 (shorts killed in bull trend)
- AMZN: 209 trades, 47.37% WR, 1.169 PF, +$57.75
- **Combined: +$313 on $10K (3.1%) across 5 stocks, zero parameter tuning**

4/5 profitable. AAPL loss was shorts in uptrend (longs were +$46.21, shorts -$94.67).

Core concept: Detect institutional stop hunts - price sweeps liquidity level, reverses.

Four components:
1. Liquidity Level Detection - rolling swing H/L
2. Sweep Detection - wick beyond, close inside
3. Manipulation Candle Detection - wick ratio, declining volume
4. Volume Confirmation - above-avg reversal candle

**Pending decisions:**
- [ ] Swing lookback: N = ? (20? 50?)
- [ ] Wick-to-body ratio threshold (>2:1 or configurable?)
- [ ] "Above average" volume = 20-period SMA? 50?
- [ ] "Strong body" definition = body > 60% of range?
- [ ] "Declining follow-through" = next 1-2 candles? How much decline?
- [ ] Edge cases: sweep of sweep, multi-candle sweep, manipulation=reversal candle

**Exit contract:**
- SL: below sweep wick
- TP: 2:1 R:R (primary)
- Trailing: activates at 1:1
- Max hold: TBD from backtest

**Implementation:** New module `SmartMoneySweepStrategy.js` (not modifying existing LiquiditySweepDetector)

---

## BACKLOG

### Dynamic Position Sizing (Re-wire)
**Status:** Reverted - needs curve tuning

DynamicPositionSizer was unwired (commit 924f01f) because curves needed tuning. The module exists but isn't active.

**What it does:** Adjusts position size based on:
- Win rate
- Recent P&L
- Drawdown state
- Confidence level

**Why reverted:** Curves were too aggressive or too conservative - need to tune the scaling factors before re-enabling.

**TODO:**
- [ ] Define proper scaling curves
- [ ] Backtest with different curve parameters
- [ ] Re-wire once curves are validated

---

### Validate Existing Strategies (TradingView Cross-Check)
**Status:** Backlog

Use the Phase 1-5 validation pipeline to verify existing strategies:
- [ ] RSI strategy - build PineScript version, compare trades
- [ ] EMA/SMA Crossover - build PineScript version, compare trades
- [ ] Break and Retest - already bled, might be logic bug
- [ ] Bollinger Band strategy

**Goal:** Ensure Node.js implementation matches TradingView trade-by-trade.

---

### Remove Legacy Crypto Conversions
**Status:** Tech debt - needs audit

Bot was built crypto-first. There are places in the code that convert TO crypto format and back unnecessarily - even when trading stocks/forex/etc. This is leftover legacy code from before the modularization/generalization pivot.

**The problem:**
Arithmetic pipeline has crypto conversions baked in that shouldn't exist for non-crypto assets. The code converts to crypto, does math, converts back - when it should just do the math directly.

**TODO:**
- [ ] Audit arithmetic pipeline for unnecessary crypto conversions
- [ ] Identify which conversions are asset-class-specific vs universal
- [ ] Remove/refactor legacy crypto-first assumptions
- [ ] Ensure clean arithmetic path for stocks, forex, futures
- [ ] Test each asset class after cleanup

---

### Order Flow Integration
**Status:** Idea stage

Consensus from Reddit: order flow is essential for algo trading.

Options:
- L2 order book depth (Kraken `book` subscription)
- Trade tape (individual trades, aggressor side)
- Enhanced CVD (current CVD in edgeAnalytics is derived, not true order flow)
- Footprint/volume at price
- Imbalances

**Note:** Kraken provides `book` and `trade` WebSocket subscriptions. Current system only uses `ticker` and `ohlc`.

### TradingView Cross-Validation Pipeline
**Status:** Documented

Process for validating strategies:
1. Build in PineScript on TradingView
2. Build in OGZPrime Node.js
3. Compare trade-by-trade
4. If trades match across two independent implementations = strategy is real

Doc: User's Phase 1-5 validation script (shared in chat)

---

### Orphan Functions (Bombardier Audit 2026-03-24)
**Status:** Identified - needs review/cleanup

Ran `node ogz-meta/bombardier.js --orphans --core` - found 39 orphans (606 lines).

**Confirmed real orphans:**

| Function | File | Lines | Notes |
|----------|------|-------|-------|
| `integrateWithBot` | core/trai_core.js:688 | 32 | TRAI integration never wired |
| `shouldTakeLong` | core/MAExtensionFilter.js:246 | 15 | Direction filter - should be used! |
| `shouldTakeShort` | core/MAExtensionFilter.js:267 | 15 | Direction filter - should be used! |
| `extractMultiTimeframe` | core/EnhancedPatternRecognition.js:251 | 51 | Multi-TF features unwired |
| `patchTrade` | core/PositionTracker.js:207 | 44 | API designed but never called |

**Suspicious (might be bugs):**
- `shouldTakeLong/Short` - These exist to prevent entering at bad extension levels. If not called, might be entering trades when price is too extended from MA.

**Likely intentional (emergency/debug):**
- `emergencySync`, `emergencyCleanup` - keep for emergencies
- `disableKillSwitch`, `enableKillSwitch` - safety toggles
- `printDiagnostics`, `printStats`, `printState` - debug helpers

**TODO:**
- [ ] Review `shouldTakeLong/Short` - should these be wired into entry logic?
- [ ] Decide: wire `integrateWithBot` or delete it
- [ ] Decide: use `extractMultiTimeframe` or delete it
- [ ] Clean up unused APIs like `patchTrade`

---

## COMPLETED

(Move items here when done)

---

## ICEBOX

(Ideas that are interesting but not priority)

---

*Last updated: 2026-03-23*
