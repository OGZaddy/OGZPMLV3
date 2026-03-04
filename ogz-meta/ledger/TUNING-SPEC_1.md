# OGZPrime Tuning Harness Spec
## For Claude Code Implementation

### Overview
Systematic parameter tuning using 3 diverse market regime segments + out-of-sample validation.
Target metric: **Max Sharpe with 10% drawdown ceiling.**

---

## STEP 1: Baseline Run (DO THIS FIRST)

Run the backtest engine with CURRENT config against all 3 tuning segments.
Record results as the baseline fingerprint.

```bash
# Tuning segments are pre-built in the tuning/ directory:
# seg_16_uptrend.json   - Nov 2024 breakout ($77K→$98K)
# seg_5_downtrend.json  - Mar-Apr 2024 ($65K→$64K) 
# seg_1_range.json      - Jan 2024 ($42K chop)

# For each segment:
BACKTEST_MODE=true CANDLE_DATA_FILE=tuning/seg_16_uptrend.json node run-empire-v2.js

# Capture the backtest-report JSON for each run
```

### Baseline Fingerprint Format
Save as `tuning/baseline.json`:
```json
{
  "fingerprint": {
    "configHash": "<sha256 of TradingConfig.js exits + exitContracts sections>",
    "dataHash": "<from tuning-index.json>",
    "commitHash": "<git rev-parse HEAD>"
  },
  "results": {
    "seg_16_uptrend": {
      "trades": 0, "winRate": 0, "pnlPercent": 0,
      "sharpe": 0, "maxDrawdown": 0, "profitFactor": 0
    },
    "seg_5_downtrend": { ... },
    "seg_1_range": { ... }
  },
  "composite": {
    "avgSharpe": 0,
    "avgWinRate": 0,
    "worstDrawdown": 0,
    "totalPnlPercent": 0
  }
}
```

---

## STEP 2: Tuning Rounds (One Knob Family at a Time)

### Round 1: Exit Thresholds (BIGGEST IMPACT)

Current values to test against:
```
Default SL: 1.5%    Default TP: 2.0%
Tier 1: 0.7%        Tier 2: 1.0%
Tier 3: 1.5%        Final: 2.5%
Breakeven trigger: 0.5%
```

**Test matrix (run each config against ALL 3 segments):**

| Config | Tier1 | Tier2 | Tier3 | Final | SL   | Rationale |
|--------|-------|-------|-------|-------|------|-----------|
| A      | 0.5%  | 0.8%  | 1.2%  | 2.0%  | 1.5% | Tighter tiers, same SL |
| B      | 0.5%  | 0.8%  | 1.2%  | 2.0%  | 1.0% | Tighter everything |
| C      | 0.3%  | 0.6%  | 1.0%  | 1.5%  | 0.8% | Scalper-tight |
| D      | 0.7%  | 1.0%  | 1.5%  | 2.5%  | 2.0% | Current tiers, wider SL |
| E      | 0.5%  | 1.0%  | 2.0%  | 3.0%  | 1.5% | Wide tiers, current SL |

**Acceptance criteria:**
- Must improve composite Sharpe vs baseline
- Must NOT exceed 10% max drawdown on ANY segment
- Must improve on at least 2 of 3 segments

### Round 2: Confidence Thresholds

After Round 1 winner is locked in, test min confidence:
```
Current: varies by profile (40-70%)
Test: 35%, 45%, 55%, 65%
```

Lower = more trades (more data, potentially worse quality)
Higher = fewer trades (less data, potentially better quality)

### Round 3: Strategy-Specific Exit Contracts

After Round 2, tune per-strategy exits:
- Which strategies are profitable? Widen their TP, let them run.
- Which are bleeding? Tighten their SL or disable them.
- The dashboard Strategy Breakdown panel shows this.

### Round 4: Regime Multipliers

After Round 3, tune the regime multipliers:
```
strong_uptrend:   { slMultiplier: 1.5, tpMultiplier: 2.0 }
trading_range:    { slMultiplier: 0.8, tpMultiplier: 1.0 }
volatile_spike:   { slMultiplier: 0.5, tpMultiplier: 0.8 }
```

Test: Does widening SL in uptrends help? Does tightening TP in chop help?

---

## STEP 3: Validation

After all 4 rounds, take the winning config and run it against:
1. **validation-2023.json** — completely different price regime ($17K-$42K)
2. **Full 45K candle dataset** — btc-15m-2024-2025.json
3. **All 22 segments individually** — check for any segment with >10% drawdown

If it passes all 3, the config is production-ready.

---

## RULES
1. ONE knob family per round. Don't change exits AND confidence at the same time.
2. Every run gets a fingerprint (config hash + data hash + commit hash).
3. Compare to baseline, not to the last experiment. Avoid drift.
4. If a change helps one regime but hurts another, it's a REGIME OVERRIDE, not a global change.
5. Log everything. Every run, every result, every decision.

---

## Config Override Mechanism

To test different configs without editing TradingConfig.js:

```bash
# Environment variable overrides
STOP_LOSS_PERCENT=1.0 \
TAKE_PROFIT_PERCENT=2.0 \
TIER1_TARGET=0.005 \
TIER2_TARGET=0.008 \
TIER3_TARGET=0.012 \
FINAL_TARGET=0.020 \
BACKTEST_MODE=true \
CANDLE_DATA_FILE=tuning/seg_16_uptrend.json \
node run-empire-v2.js
```

This way TradingConfig.js stays clean — env vars override defaults.
