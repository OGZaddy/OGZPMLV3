# OGZPrime Pipeline Briefing — 2026-02-19
## For: GPT / Claude Code / Any AI Assistant in Pipeline

---

## WHO YOU ARE
You are being brought onto OGZPrime, a cryptocurrency trading bot that trades BTC/USD on Kraken. Trey is the project lead. He makes the decisions. You execute what he asks — no freelancing, no "improvements" he didn't request. If you're unsure, ask.

## CURRENT STATE OF THE CODEBASE
The 3 files that were just SCP'd in are the canonical versions. They contain surgical fixes made today (2026-02-19) after a full forensic audit of why the bot only executed 2 trades across 60,000 1-minute candles (833 days of data).

## THE 3 MODIFIED FILES

### 1. `core/OptimizedTradingBrain.js`
The brain that calculates confidence and decides buy/sell/hold.

**Fixes applied:**
- **CUT 1 — Removed 0.40 directional gate (was line ~2999):** Required 40% bullishConfidence to set direction='buy'. On 1m candles, bullish signals typically sum to 15-35%. Almost nothing passed. Now requires only 5% directional edge (bull must beat bear by 5%).
- **CUT 2 — Removed regime filter gate (was line ~2978-2991):** Independently blocked buys if `trending_down && bullishConfidence < 0.60`. Regime already contributes +25% bearish to confidence. Double-punishment killed valid trades.
- **CUT 3 — Removed 0.15 confidence floor (was line ~3500):** Redundant — MIN_TRADE_CONFIDENCE in .env already handles this.
- **CUT 4 — Simplified determineTradingDirection (was line ~3107-3224):** Was a 120-line method that re-analyzed everything with DIFFERENT thresholds than calculateRealConfidence. Now just passes through the direction already decided.
- **CUT 5 — RSI safety 80/20 → 88/12:** Many valid trades happen at RSI 70-80. Only block at true extremes.
- **CUT 6 — Pattern gate veto DISABLED (lines ~3347-3355):** Required 65% confidence + ELITE pattern tier (20+ samples, 75%+ win rate). ALL patterns have 1-2 samples. Every trade was vetoed. Pattern system still LEARNS and RECORDS — it just can't BLOCK trades anymore. Re-enable PATTERN_DOMINANCE when patterns have statistical significance.
- **FIX 7 — RSI dead zone fill:** Added mild signal zones (55-70 = +10% bullish, 30-45 = +10% bearish). 1m candles live in 35-65 range almost always — previously contributed 0%.
- **FIX 8 — MACD dead zone fill:** Added coverage for MACD positive + histogram positive (common crossover state on 1m). Was previously a dead zone contributing 0%.

### 2. `core/EnhancedPatternRecognition.js`
Pattern matching and learning system.

**Fixes applied:**
- **minimumMatches: 3 → 1:** Patterns need to contribute from first occurrence. With minimumMatches=3, NO pattern ever contributed because all had 1-2 samples.
- **confidenceThreshold: 0.6 → 0.2:** New patterns need room to grow. 60% threshold meant nothing passed.
- **FeatureExtractor (line 58):** Changed `candles.length < 30 → return []` to `candles.length === 0`. Features now generate from any data amount.
- **Entry recording re-enabled (observation mode):** Patterns created at entry with `pnl: null`, outcomes recorded at exit with real P&L.
- **recordPattern guard:** `typeof result.pnl === 'number'` — only real trade outcomes update wins/losses.

### 3. `run-empire-v2.js`
The main bot loop.

**Fixes applied:**
- **EMFILE fix — saveCandleHistory():** Now returns immediately when `BACKTEST_FAST=true` or `BACKTEST_MODE=true`. Was writing to disk 60,000 times and exhausting OS file handles.
- **Report write fallback:** Try/catch around report writeFileSync with console dump fallback. If file write fails, results still print to stdout.

## WHAT'S LEFT — THE ONE REMAINING KNOWN ISSUE

**EXIT_SYSTEM defaults to 'maxprofit' but MaxProfitManager doesn't activate for positions.**

This means after a BUY, NOTHING can trigger a SELL except:
- Hard stop at -1.5% P&L
- Confidence drop > 50 points

**Fix:** Set `EXIT_SYSTEM=legacy` in `.env`. This enables all exit paths as fallbacks:
- Sell when P&L > 0.35% (covers fees)
- Brain sell signal + profitable = sell
- Gradual loss exit after 5 minutes
- Emergency cut at -2%

## .ENV SETTINGS REQUIRED
```
EXIT_SYSTEM=legacy
PATTERN_DOMINANCE=false
MIN_TRADE_CONFIDENCE=0.08
BACKTEST_MODE=true
BACKTEST_FAST=true
CANDLE_DATA_FILE=data/polygon-btc-1y.json
ENABLE_TRAI=false
```

## THE ENTRY PIPELINE (after all fixes)

1. `analyzeAndTrade()` — main loop, runs every candle
2. `TradingBrain.getDecision()` — calls calculateRealConfidence
3. `calculateRealConfidence()` — builds bullish/bearish scores from RSI, MACD, EMA, BB, regime, patterns, fib, S/R
4. Direction = whoever wins (bull vs bear) by 5%+ edge
5. `finalConfidence = base(10%) + winning side's score`
6. Pattern gate — **DISABLED** (learns but doesn't block)
7. `determineTradingDirection()` — passthrough
8. Back in run-empire-v2.js: `makeTradeDecision()`
9. **THE ONE GATE:** `pos === 0 && totalConfidence >= minConfidence && brainDirection === 'buy'`
10. `executeTrade()` → opens position

## THE EXIT PIPELINE (with EXIT_SYSTEM=legacy)

1. `pos > 0` → enters exit logic
2. ExitContract check (if trade has one)
3. TradeIntelligence (if enabled, shadow mode default)
4. MaxProfitManager (if active for position)
5. Hard stop at -1.5%
6. Legacy: sell if P&L > 0.35% (fee coverage)
7. Legacy: brain sell + profitable = sell
8. Legacy: gradual exit after 5min at loss
9. Brain emergency sell at -2%
10. Confidence crash > 50 points = sell

## RULES FOR WORKING ON THIS CODEBASE

1. **ONE version of truth.** These 3 files are it. Don't create parallel copies.
2. **No new gates.** The whole problem was too many independent gates overriding each other. ONE threshold (MIN_TRADE_CONFIDENCE) controls entry.
3. **No hardcoded magic numbers.** If it's a threshold, put it in .env.
4. **Test before committing.** Run a backtest, check trade count and P&L.
5. **Git discipline.** Branch before changes. Commit messages describe WHAT changed and WHY.
6. **Don't touch what works.** If you didn't diagnose the problem yourself by reading the code, don't "fix" it.

## NEXT STEPS (Trey decides priority)

1. Run backtest with EXIT_SYSTEM=legacy — confirm trades execute AND close
2. Check trade count and win rate
3. If trades execute: run parallel grid search on MIN_TRADE_CONFIDENCE using 7800X3D
4. If profitable: optimize with ATR-based exits, adaptive stops
5. Push validated version to VPS for paper trading
