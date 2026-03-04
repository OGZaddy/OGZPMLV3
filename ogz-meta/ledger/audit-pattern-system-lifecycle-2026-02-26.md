# Pattern System Lifecycle Audit — 2026-02-26
## Claude Opus Session: Deep Trace Analysis

---

## EXECUTIVE SUMMARY

The pattern system has **FOUR separate subsystems** that were built at different times and never unified. Only ONE (PatternMemorySystem inside EPR) is actively recording data. The other three are loaded but inert. The one that IS active has critical data corruption bugs that make its learning ineffective.

---

## THE FOUR PATTERN SYSTEMS

| # | System | Location | Storage | Status |
|---|--------|----------|---------|--------|
| 1 | PatternMemorySystem | EnhancedPatternRecognition.js | data/pattern-memory.{mode}.json | **ACTIVE** but corrupted |
| 2 | PatternStatsManager | TradingOptimizations.js | data/pattern-stats.json | **DEAD** — file doesn't exist, never written to |
| 3 | TRAIDecisionModule | TRAIDecisionModule.js | async observer | **OBSERVER** — never modifies confidence |
| 4 | PatternBasedExitModel | PatternBasedExitModel.js | feature-flag gated | **DISABLED** — feature flag off |

Only System #1 matters. The rest are architectural ghosts.

---

## PATTERN LIFECYCLE TRACE (System #1)

### Step 1: Feature Extraction (every candle)
**Location:** `run-empire-v2.js:1659` → `EnhancedPatternRecognition.analyzePatterns()` → `FeatureExtractor.extract()`

9-element feature vector:
```
[0] RSI normalized (rsi/100, 0-1 range)
[1] MACD delta (macd - signal, raw value)
[2] Trend encoded (-1/0/1)
[3] Bollinger bandwidth (calculated from candles)
[4] Volatility (stddev of returns, ~0.005-0.05)
[5] Wick ratio (body/range, 0-1)
[6] Price change % (× 100)
[7] Volume change (ratio - 1)
[8] Last direction (-1/0/1)
```

### Step 2: Pattern Evaluation
**Location:** `EnhancedPatternChecker.evaluatePattern()`

1. Generate pattern key: `features.map(n => n.toFixed(2)).join(',')` (exact string)
2. Check for exact match in memory by key
3. If no exact match: find similar patterns (weighted Euclidean distance)
4. Return confidence = win rate (0-1), direction, reason

### Step 3: Pattern Recording at Entry (observation)
**Location:** `run-empire-v2.js:1725`
```javascript
patternChecker.recordPatternResult(featuresForRecording, {
  pnl: null,  // observation only
  timestamp: Date.now(),
  type: 'observation'
});
```
With the 2026-02-25 fix: `pnl: null` = observation only, does NOT increment timesSeen.

### Step 4: Patterns Stored on Trade Object
**Location:** `run-empire-v2.js:2811`
```javascript
patterns: patterns || []  // Attached to trade in StateManager
```

### Step 5: Pattern Recording at Exit (outcome)
**Location:** `run-empire-v2.js:3155`
```javascript
patternChecker.recordPatternResult(featuresForRecording, {
  pnl: pnl,
  holdDurationMs: holdDuration,
  exitReason: completeTradeResult.exitReason,
  timestamp: Date.now()
});
```
Uses `buyTrade.patterns[0].features` — same features from entry. ✅

### Step 6: Pattern Influences Next Trade
**Location:** `OptimizedTradingBrain.calculateRealConfidence()` line 2555

Brain calls `analyzePatterns()` AGAIN (second call per candle, same instance).
Pattern confidence thresholds:
- `> 0.6` (60% win rate) → +25% confidence
- `> 0.5` (50% win rate) → +15% confidence
- `< 0.5` → 0% contribution

### Step 7: Confidence Flows to Trade Decision
Pattern contribution gets added to bullish/bearish confidence totals.
Combined with RSI, MACD, regime, other signals into final confidence.

---

## BUGS FOUND: 8 (3 Critical, 3 High, 2 Medium)

---

### BUG P1 — CRITICAL: Volatility Feature Destroys Similarity Matching

**FeatureExtractor (EPR internal):** `vol = indicators.calculateVolatility(candles)` → stddev of returns → ~0.02
**Fallback (run-empire):** `indicators.volatility` → raw ATR in dollars → ~$500

Feature [4] is **25,000x larger** when fallback fires vs EPR path.

**Similarity impact:**
- Volatility feature contributes 125 to distance (ATR diff $50, weight 0.05)
- RSI feature contributes 0.000625 to distance (diff 0.05, weight 0.25)
- Ratio: **200,000:1** — volatility drowns out ALL other features

Even when both paths use EPR (no fallback), the volatility stddev changes enough between candles that it dominates similarity. The feature weights give volatility only 5%, but because it's not normalized to the same scale as other features (0-1), the raw magnitude makes it the only feature that matters.

**Result:** Pattern similarity is effectively "was stddev roughly identical?" Everything else (RSI, MACD, trend, momentum) is noise.

---

### BUG P2 — CRITICAL: One-Sample Win Rate = +25% Confidence Swing

**Mechanism:**
1. Pattern seen once, won → win rate = 1.0 (100%)
2. Next match: 1.0 > 0.6 → +25% bullish confidence
3. Pattern seen twice, 1 win 1 loss → win rate = 0.50
4. Next match: 0.50 < 0.5 → 0% contribution

**Impact:** Patterns oscillate between massive +25% boost and zero contribution based on their most recent outcome. This is pure noise until a pattern has 10+ samples. With exact-match keys being rare, most patterns will NEVER reach 10 samples.

The `minimumMatches` threshold was lowered from 3 to 1 (line 645), meaning single-sample patterns actively influence trading decisions.

---

### BUG P3 — CRITICAL: Feature Normalization Mismatch Corrupts Learning When Fallback Fires

Three normalization differences between EPR's FeatureExtractor and run-empire's fallback:

| Element | EPR Path | Fallback Path | Impact |
|---------|----------|---------------|--------|
| [0] RSI | rsi/100 = 0.65 | (rsi-50)/50 = 0.30 | Different normalization scheme |
| [3] bbWidth | Calculated from candles | `indicators.bbWidth` = undefined → 0.02 | Always constant in fallback |
| [4] volatility | stddev ≈ 0.02 | ATR in dollars ≈ 500 | 25,000x scale difference |

When entry uses EPR features and exit hits fallback: different pattern keys, outcome recorded against wrong pattern. But this is MITIGATED because exit reads `buyTrade.patterns[0].features` from the stored trade (same features from entry). Fallback only fires if pattern.features is somehow not an array — which should be rare.

**Primary risk:** The fallback exists for a reason. When it fires, it corrupts the pattern bank. And there's no logging to show WHEN it fires.

---

### BUG P4 — HIGH: PatternStatsManager is Dead Code

**Location:** `TradingOptimizations.js`

- Reads from `data/pattern-stats.json` — file doesn't exist
- `this.stats = {}` — always empty
- `getStats(patternId)` → returns `{ uses: 0, wins: 0, ... }`
- `calculatePatternQuality()` → checks `stats.uses < 5` → skips all → returns 0
- `sizeMultiplierFromPatternQuality(0)` → returns 1.0
- `calculatePositionSize()` → always returns baseSize unmodified

**Impact:** Pattern-based position sizing never adjusts anything. Every call to `tradingOptimizations.calculatePositionSize()` at line 2619 is wasted computation that always returns the input unchanged. No code in the trading loop ever writes to PatternStatsManager.

---

### BUG P5 — HIGH: analyzePatterns Called Twice Per Candle

**Call 1:** `run-empire-v2.js:1659` — `this.patternChecker.analyzePatterns(marketData)`
**Call 2:** `OptimizedTradingBrain.calculateRealConfidence:2555` — `this.patternRecognition.analyzePatterns(marketData)`

`this.patternRecognition` IS `this.patternChecker` (line 560).

Same instance, same function, same data, called twice. Double computation on every candle. The entry recording at line 1725 only runs on the run-empire call, so observations aren't double-counted. But the feature extraction and memory lookup run twice.

---

### BUG P6 — HIGH: Seed Pattern Format Mismatch

**Seed pattern (line 330):**
```javascript
this.memory['BASE_PATTERN'] = {
  type: 'seed', confidence: 0.5, successRate: 0.5,
  occurrences: 1, lastSeen: Date.now()
};
```

**Recorded pattern format:**
```javascript
this.memory['0.65,0.23,1.00,0.02,0.01,0.50,1.23,0.05,1.00'] = {
  timesSeen: 3, totalPnL: 0.5, wins: 1, losses: 2,
  results: [{ timestamp, pnl, success }]
};
```

Different key format (name vs feature string), different field names (occurrences vs timesSeen, confidence vs wins/losses). The seed pattern is invisible to all evaluation code — it exists in memory but can never be found or matched.

---

### BUG P7 — MEDIUM: No Pattern Persistence Between Runs

No `pattern-memory.backtest.json` file exists in `data/`. Every backtest starts with empty memory (+ useless seed pattern). Patterns accumulate during the run, may or may not save to disk (5-minute timer), and are lost on next run.

For backtesting this is arguably correct (clean slate). For live trading it means the bot starts with zero learning every restart.

---

### BUG P8 — MEDIUM: Exact Match Keys Are Astronomically Rare

Pattern key = 9 floating-point numbers rounded to 2 decimal places.
Example: `"0.65,-0.23,1.00,0.02,0.01,0.50,1.23,0.05,1.00"`

For an exact match, ALL 9 features must round to the same 2 decimal values.
RSI: changes every candle. MACD delta: changes every candle. Price change: changes every candle.

With continuous features, exact matches essentially require the SAME market conditions to repeat to 2 decimal precision. This almost never happens. The system falls through to `findSimilarPatterns()` on virtually every evaluation.

This isn't necessarily a bug — similar matching is the right approach. But the combination of:
- Exact matches being rare → always fuzzy matching
- Volatility dominating similarity → only ATR matters
- One-sample patterns giving +25% boost → noise

Means the pattern system is effectively random.

---

## PATTERN SYSTEM ARCHITECTURE DIAGRAM

```
Every Candle:
  ┌──────────────────────────────────────────────────────┐
  │ run-empire: patternChecker.analyzePatterns()          │ ← Call #1
  │   └── FeatureExtractor.extract(candles, indicators)   │
  │       └── Returns 9-element feature vector            │
  │   └── PatternMemorySystem.evaluatePattern(features)   │
  │       └── getPatternKey → exact match lookup          │
  │       └── findSimilarPatterns → fuzzy match           │
  │       └── Returns { confidence, direction }           │
  │   └── Returns [{ features, confidence, direction }]   │
  └──────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌──────────────────────────────────────────────────────┐
  │ Brain.calculateRealConfidence()                       │
  │   └── patternRecognition.analyzePatterns()            │ ← Call #2 (DUPLICATE)
  │       └── Same computation again                      │
  │   └── If confidence > 0.6: +25% bullish/bearish      │
  │   └── If confidence > 0.5: +15% bullish/bearish      │
  └──────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌──────────────────────────────────────────────────────┐
  │ Entry Recording (if trade opens)                      │
  │   └── recordPatternResult(features, { pnl: null })   │
  │       └── Observation only, no timesSeen increment   │
  │   └── Patterns stored on trade: buyTrade.patterns     │
  └──────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌──────────────────────────────────────────────────────┐
  │ Exit Recording (when trade closes)                    │
  │   └── Read features from buyTrade.patterns[0]         │
  │   └── recordPatternResult(features, { pnl: actual })  │
  │       └── timesSeen += 1, wins/losses, totalPnL      │
  └──────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌──────────────────────────────────────────────────────┐
  │ Dead Systems (loaded but never contribute)            │
  │   └── PatternStatsManager: no data file, returns 0   │
  │   └── TRAIDecisionModule: observer only, no influence │
  │   └── PatternBasedExitModel: feature flag disabled    │
  └──────────────────────────────────────────────────────┘
```

---

## WHAT THE PATTERN SYSTEM ACTUALLY DOES TODAY

1. Extracts 9 features from market data (twice per candle)
2. Looks for similar patterns in memory (dominated by volatility feature)
3. If a similar pattern exists with 1+ winning sample: adds +15-25% to confidence
4. Records observations at entry, outcomes at exit
5. Pattern memory resets every run (no persistence file)
6. Three other pattern subsystems exist but do nothing

**Net effect on trading:** Small, noisy confidence perturbations based primarily on whether ATR stddev is similar to a past candle where a trade happened to win. This is closer to random noise than genuine pattern learning.

---

## PRIORITY FIXES

1. **Normalize feature [4]** — volatility must be on 0-1 scale like other features. Use `(stddev / maxExpectedStddev)` or similar normalization.
2. **Minimum sample threshold** — Raise `minimumMatches` back to at least 3-5. One-sample win rates are pure noise.
3. **Remove duplicate analyzePatterns call** — Brain should receive patterns from run-empire, not re-analyze.
4. **Fix seed pattern format** — Either remove BASE_PATTERN (it does nothing) or make it match the real format.
5. **Add bbWidth to indicator reshape** — So fallback features match EPR features.
6. **Kill dead systems** — Remove or disable PatternStatsManager computation. It wastes cycles.
7. **For live trading:** Ensure pattern-memory file saves reliably and loads on restart.
