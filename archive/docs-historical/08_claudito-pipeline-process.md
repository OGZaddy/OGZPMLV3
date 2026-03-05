# 08 - Claudito Pipeline Process

**Established:** 2026-01-25
**Status:** MANDATORY for all code changes

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

## The Golden Rule

**NO CODE CHANGES WITHOUT CLAUDITO PIPELINE.**

This is not a suggestion. This is not a guideline. This is THE LAW.

---

## Pipeline Phases

### Phase 1: Plan
```
/orchestrate → /warden → /architect → /purpose
```
- **Orchestrator**: Coordinates the mission, plans the approach
- **Warden**: Checks for scope creep (REJECTS if detected)
- **Architect**: Explains how the affected area works (context for Fixer)
- **Purpose**: Verifies alignment with OGZPrime mission

### Phase 2: Fix (loop until clean)
```
/fixer → /debugger → /validator → /critic
   ↑__________________________|
   (if rejected, loop back)
```
- **Fixer**: Applies minimal change ONLY
- **Debugger**: Tests it actually works
- **Validator**: Quality gate check
- **Critic**: Adversarial review - finds weaknesses
- If Critic rejects → back to Fixer

### Phase 3: Verify
```
/cicd → /telemetry → /validator → /forensics
```
- **CICD**: Run tests, ensure nothing broke
- **Telemetry**: Check metrics, log performance
- **Validator**: Final quality check
- **Forensics**: Hunt for hidden landmines
- If landmine found → mini fix cycle

### Phase 4: Ship
```
/scribe → /commit → /janitor → /validator → /warden → /learning → /changelog
```
- **Scribe**: Document everything that happened
- **Commit**: Git commit with proper message
- **Janitor**: Clean up any mess
- **Validator**: Final sanity check
- **Warden**: Verify no scope creep snuck in
- **Learning**: Record lessons for future
- **Changelog**: Update CHANGELOG.md

---

## Quick Commands

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/pipeline` | Full chain | Most fixes |
| `/orchestrate` | Multi-Claudito coordination | Complex missions |
| `/fixer` | Single fix only | After Forensics identified issue |
| `/forensics` | Deep code audit | Investigating bugs |
| `/validator` | Quality check | Before commit |

---

## Logging Integration

Every Claudito MUST use the logger:

```javascript
const { ClauditoLogger } = require('./claudito-logger');

// Log hook emissions
ClauditoLogger.hook('/fixer', 'FIX_APPLIED', {
  result: 'success',
  next: '/debugger'
});

// Log decisions
ClauditoLogger.decision('forensics', 'AUDIT_COMPLETE',
  'Found 3 issues in pattern memory', 95);

// Log errors (NEVER silent)
ClauditoLogger.error('fixer', error, {
  file: 'run-empire-v2.js',
  line: 1234
});

// Log mission status
ClauditoLogger.mission('MISSION-123', 'in_progress', {
  clauditos: ['forensics', 'fixer', 'debugger'],
  fixes: 2
});
```

---

## Hook Communication

Clauditos communicate via hooks, NOT direct calls:

### Hook Flow Example
```yaml
# Forensics finds bug
hook: "BUG_FOUND"
from: Forensics
to: Orchestrator
payload:
  severity: "CRITICAL"
  file: "run-empire-v2.js"
  line: 1891
  description: "Bag-hold logic missing gradual exit"

# Orchestrator dispatches Fixer
hook: "FIX_REQUEST"
from: Orchestrator
to: Fixer
payload:
  bug_id: "BAG_HOLD_001"
  approach: "Add gradual exit at -2% after 5 min hold"

# Fixer completes
hook: "FIX_APPLIED"
from: Fixer
to: Debugger
payload:
  file: "run-empire-v2.js"
  lines_changed: 4
  ready_for_test: true
```

---

## Forbidden Patterns

### NEVER DO:
- Skip Warden and go straight to Fixer
- Commit without Debugger verification
- Touch code without Forensics first (for bugs)
- Bypass Critic review
- Silent errors (ClauditoLogger.error is MANDATORY)
- Scope creep (Warden will catch you)

### IF YOU SEE:
- "while I'm at it..."
- "I also noticed..."
- "might as well..."
- "I'll just clean up..."

**STOP. That's scope creep. Warden rejects.**

---

## Trading Integration

For trading decisions, use TradingProofLogger:

```javascript
const { TradingProofLogger } = require('./claudito-logger');

// Log every trade
TradingProofLogger.trade({
  action: 'BUY',
  symbol: 'BTC/USD',
  price: 88500.50,
  size: 0.001,
  value_usd: 88.50,
  fees: 0.28,
  reason: 'RSI oversold + support bounce',
  confidence: 72,
  indicators: { rsi: 28, macd: 'bullish_cross' },
  pattern: 'double_bottom'
});

// Explain decisions in plain English (per transparency rules)
TradingProofLogger.explanation({
  decision: 'BUY',
  plain_english: 'Price hit strong support with oversold RSI. Historical pattern shows 73% bounce probability.',
  factors: ['RSI at 28', 'Price at daily support', 'Volume spike']
});

// Daily summary for website proof
TradingProofLogger.dailySummary({
  date: '2026-01-25',
  starting_balance: 10000,
  ending_balance: 10150,
  total_pnl_usd: 150,
  total_pnl_percent: 1.5,
  total_trades: 8,
  winning_trades: 5,
  losing_trades: 3,
  win_rate: 62.5
});
```

---

## Why This Process Exists

1. **Prevents scope creep** - Warden blocks "while I'm at it" disasters
2. **Catches bugs before commit** - Debugger + Critic review
3. **Creates audit trail** - Full logging of every decision
4. **Enables learning** - Learning Claudito improves future fixes
5. **Builds proof** - Trading logs for website credibility
6. **Maintains discipline** - OGZPrime runs on process, not chaos

---

## The Motto

> "Every change through the pipeline. No exceptions. No shortcuts."

This is how we keep OGZPrime stable while continuously improving.
