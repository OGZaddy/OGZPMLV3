# Data Structure Mismatch Audit — 2026-02-26
## Claude Opus Session: Deep Trace Analysis

---

## BUGS FOUND: 7 (2 Critical, 3 High, 2 Medium)

---

### BUG 1 — CRITICAL: ECM Volatility Always Widening Stops
**Location:** `run-empire-v2.js:1633` → `StrategyOrchestrator.js:505` → `ExitContractManager.js:420`

**Chain of failure:**
1. Indicator reshape (line 1633): `volatility: engineState.atr` → stores raw dollar ATR (~$500 for BTC)
2. Orchestrator (line 505): `indicators?.atr` → **UNDEFINED** (not in reshaped object) → falls to `indicators?.volatility` → $500
3. ECM (line 420): `if (context.volatility > 5.0)` → `500 > 5.0` = **ALWAYS TRUE**
4. Result: SL widened ×1.15, TP widened ×1.2 on **every single trade**

**Impact:** Every exit contract in every backtest has been running with inflated stops. SL -0.45% becomes -0.52%, TP 0.75% becomes 0.90%. This changes the entire performance profile.

**Fix:** Add `atr: engineState.atr` to the indicator reshape object at line 1626. Then orchestrator line 505 will find `indicators.atr` and correctly compute `(atr / price * 100)` = ~0.5% instead of $500.

---

### BUG 2 — CRITICAL: Short Trade PnL is Long-Only Everywhere (Pre-Launch Blocker)

**Affected modules:**
- `ExitContractManager.js:176` — `pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100`
- `ExitContractManager.js:379` — `updateMaxProfit()` uses same formula
- `StateManager.js:367` — `pnl = closeSize * (price - entryPrice)`

**Only MaxProfitManager handles direction correctly** (line 515-517).

**Impact when ENABLE_SHORTS=true:**
- ECM will report winning shorts as LOSING → trigger SL on profitable trades
- ECM trailing stop will track wrong peak → never trail correctly
- StateManager will calculate negative PnL for profitable shorts → balance goes down on wins
- Break-even logic will never trigger for shorts

**Current impact:** None (ENABLE_SHORTS=false). But this is a **hard blocker** before enabling shorts. Every short trade will lose money even when the direction is correct.

---

### BUG 3 — HIGH: BacktestRecorder Double-Multiplies Confidence
**Location:** `BacktestRecorder.js` lines 156 and 334

**Chain:**
1. Strategies output 0-1 (e.g., 0.55)
2. Orchestrator multiplies ×100 → 55
3. run-empire stores 55 on trade object
4. BacktestRecorder displays `(t.confidence * 100).toFixed(1)` → **5500.0%**

**Impact:** CSV and console show 4800%, 5500% etc. instead of 48%, 55%. Misleading diagnostics. Cannot trust confidence data in exports.

**Fix:** Change both lines to `t.confidence.toFixed(1)` (remove `* 100`).

---

### BUG 4 — HIGH: Feature Vector bbWidth Always 0.02
**Location:** `run-empire-v2.js:1712`

**Chain:**
1. IndicatorEngine stores Bollinger bandwidth in `engineState.bbExtras.bandwidth`
2. Indicator reshape at line 1626 does NOT include bbExtras
3. Fallback feature vector uses `indicators.bbWidth || 0.02` → always 0.02
4. Pattern learning element [3] is constant → blind to volatility regime

**Impact:** Pattern recognition cannot distinguish between Bollinger squeezes (pre-breakout, real ~0.005) and high-volatility trends (real ~0.15). All market conditions recorded as identical volatility. Pattern matching accuracy degraded.

**Fix:** Add `bbWidth: engineState.bbExtras?.bandwidth || 0.02` to indicator reshape at line 1626.

---

### BUG 5 — HIGH: Feature Vector RSI Normalization Mismatch
**Location:** `EnhancedPatternRecognition.js:85` vs `run-empire-v2.js:1706`

**EPR extract():** `rsiNormalized = rsi / 100` → RSI 65 becomes 0.65 (range 0-1)
**Fallback vector:** `rsiNormalized = (rsi - 50) / 50` → RSI 65 becomes 0.30 (range -1 to 1)

**Impact:** If entry uses EPR features (0.65) and exit hits fallback (0.30), the pattern outcome is recorded against mismatched features. Euclidean distance between "same" market conditions would be 0.35 — significant enough to prevent pattern matching.

**Fix:** Change fallback to use `rsi / 100` matching EPR's convention.

---

### BUG 6 — MEDIUM: Orchestrator HOLD Returns Wrong Confidence Format
**Location:** `StrategyOrchestrator.js:474` vs line 537

**BUY/SELL path** (line 537): `confidence: winner.confidence * 100` (0-100 format)
**HOLD path** (line 474): `confidence: winner.confidence` (0-1 format, raw)

**Downstream at line 1843:** `brainDecision.confidence = orchResult.confidence / 100`
- BUY: 55 / 100 = 0.55 ✅
- HOLD: 0.55 / 100 = 0.0055 ❌

**Impact:** Diagnostic logging shows near-zero confidence for HOLD decisions even when strategies have 55% confidence. No trade impact (HOLD = no trade) but corrupts analytics.

**Fix:** Line 474: change to `confidence: winner.confidence * 100`

---

### BUG 7 — MEDIUM: signalConfidence Write-Only
**Location:** `ExitContractManager.js:429`

`contract.signalConfidence` is stored but never read anywhere in the codebase. Dead computation. No behavioral impact. Noted for cleanup.

---

## CONFIRMED WORKING

| Component | Status | Notes |
|-----------|--------|-------|
| SL/TP chain: MADynamicSR → Orchestrator → ECM | ✅ | 2026-02-23 fix wired correctly |
| Confidence format: strategies → orch → brain → run-empire | ✅ | Works but fragile (3 format conversions) |
| updateMaxProfit called before exit check | ✅ | Line 2264, every candle |
| Orchestrator overrideLevels for all 4 strategies | ✅ | MADynamicSR, LiquiditySweep, BreakRetest, TPO |
| Strategies compute own EMAs from raw candles | ✅ | Don't depend on reshaped indicators |
| Feature vector size: EPR=9, fallback=9 | ✅ | Fixed 2026-02-25 |

---

## CONFIDENCE FORMAT MAP (for reference)

```
Strategies: 0-1 (e.g., 0.55)
    ↓
Orchestrator: ×100 → 55 (line 537)
    ↓
brainDecision: /100 → 0.55 (line 1843)
    ↓
rawConfidence: 0.55 (line 1873)
    ↓
totalConfidence: ×100 → 55 (line 1884)
    ↓
decision.confidence: 55 (stored on trade, used for thresholds)
    ↓
BacktestRecorder: ×100 → 5500 ← BUG #3
    ↓
MPM/ECM: /100 → 0.55 (lines 2305, 2637, 2674)
```

Three format conversions (×100, /100, ×100) to end up at the same place. Functional but one wrong conversion away from catastrophic mismatch.

---

## PRIORITY ORDER FOR FIXES

1. **BUG 1** (Critical) — ATR/volatility format. Every backtest result has been wrong because of widened stops.
2. **BUG 3** (High) — BacktestRecorder confidence display. Quick fix, restores trust in diagnostics.
3. **BUG 4** (High) — bbWidth in indicators. Unlocks pattern learning for volatility regimes.
4. **BUG 5** (High) — RSI normalization. Prevents pattern corruption.
5. **BUG 6** (Medium) — Orchestrator HOLD confidence. Analytics fix.
6. **BUG 2** (Critical but deferred) — Short trade PnL. Must fix before ENABLE_SHORTS=true. No impact today.
7. **BUG 7** (Medium) — Dead code cleanup. Low priority.
