# OGZPMLV2 — Independent Strategy Architecture v2
## Date: 2026-02-15
## Status: BLUEPRINT — The real trading architecture

---

## THE PROBLEM (Current State)

`calculateRealConfidence()` takes ALL module outputs and dumps them into
two shared buckets: `bullishConfidence` + `bearishConfidence`. Everything
stacks. Good signals get diluted. Noise stacks into fake signals.

No individual strategy ever gets to say "THIS is my setup, take it."

---

## THE FIX: Two-Layer Architecture

### Layer 1: STRATEGY LAYER (Entry Decision)
Each strategy independently evaluates: "Is MY setup present? YES or NO."
This is binary. The strategy owns the entry decision entirely.
One strategy fires → move to Layer 2. No voting. No averaging.

### Layer 2: CONVICTION LAYER (Position Sizing + Trade Plan)
AFTER a strategy fires, the other modules score conviction:
- Pattern history: "This setup won 80% of the time" → size up
- Fibonacci: "Entry is at 0.618 retracement" → tighter stop, more size
- Support/Resistance: "Strong support right below" → good stop placement
- Market Regime: "Volatile/choppy" → reduce size regardless
- Volume: "Above average" → confirms the move, size up
- TPO: "Price in value area" → less edge, size down

Conviction adjusts HOW MUCH you risk, not WHETHER you trade.
Below minimum conviction? Strategy fired but we sit it out.

---

## THE FLOW

```
Every 15-second cycle:
                                    
  ┌──────────────────────────────────────────────────┐
  │              MARKET DATA (candles, indicators)    │
  └──────────────┬───────────────────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────────────────┐
  │           LAYER 1: STRATEGY EVALUATION            │
  │                                                    │
  │  Each strategy independently asks:                 │
  │  "Is MY specific setup here right now?"            │
  │                                                    │
  │  EMA Cross:  NO    Liq Sweep: YES!   MA Dyn: NO  │
  │  RSI Extr:   NO    Fib Retr:  NO     S/R:    NO  │
  │  Regime Trd: NO    Pattern:   NO                  │
  │                                                    │
  │  RESULT: LiquiditySweep fired → BUY               │
  │          stop: $96,800 | target: $98,100           │
  └──────────────┬───────────────────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────────────────┐
  │           LAYER 2: CONVICTION SCORING             │
  │                                                    │
  │  "How much conviction do we have in this trade?"   │
  │                                                    │
  │  Pattern Memory: Setup won 7/10 times        → +2 │
  │  Fibonacci: Entry near 0.618 level           → +1 │
  │  S/R: Strong support at $96,900              → +1 │
  │  Regime: Trending up, high confidence        → +2 │
  │  Volume: 1.8x average                        → +1 │
  │  TPO: Outside value area (breakout)          → +1 │
  │  TRAI History: Strategy win rate 65%         → +1 │
  │                                                    │
  │  Conviction Score: 9/10 = HIGH                     │
  │                                                    │
  │  Score 1-3:  SKIP (not enough support)             │
  │  Score 4-5:  0.5% of balance (minimum)             │
  │  Score 6-7:  1.0% of balance (standard)            │
  │  Score 8-9:  1.5% of balance (high conviction)     │
  │  Score 10:   2.0% of balance (maximum)             │
  │                                                    │
  │  RESULT: Size = 1.5% of balance                    │
  └──────────────┬───────────────────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────────────────┐
  │           RISK MANAGER → EXECUTE → TRAI           │
  │                                                    │
  │  Risk check passes → Trade placed                  │
  │  TRAI records: which strategy, conviction,         │
  │  entry conditions — waits for exit to learn.       │
  │                                                    │
  │  On close: TRAI tracks per-strategy win/loss       │
  │  → promotes winners, quarantines losers             │
  └──────────────────────────────────────────────────┘
```

---

## STRATEGIES (Layer 1) vs CONVICTION MODULES (Layer 2)

### Layer 1 — These DECIDE whether to trade:
| # | Strategy | Module | Entry Logic |
|---|----------|--------|-------------|
| 1 | EMA/SMA Crossover | EMASMACrossoverSignal.js | Golden/death cross + confluence > threshold |
| 2 | Liquidity Sweep | LiquiditySweepDetector.js | Sweep detected + reaction confirms reversal |
| 3 | MA Dynamic S/R | MADynamicSR.js | Bounce off dynamic MA with volume confirm |
| 4 | RSI Extreme | NEW wrapper around indicators | RSI < 25 or > 75 with momentum shift |
| 5 | Fibonacci Retracement | FibonacciDetector.js | Price hits key fib + reaction candle |
| 6 | S/R Bounce | SupportResistanceDetector.js | Touch strong level + volume rejection |
| 7 | Regime Trend | MarketRegimeDetector.js | Strong trend + EMA alignment |
| 8 | Pattern Replay | EnhancedPatternRecognition.js | High win-rate pattern match from memory |

### Layer 2 — These SCORE conviction after a strategy fires:
| Module | What it scores | Points |
|--------|---------------|--------|
| PatternMemoryBank | Has this setup won before? | 0-2 |
| FibonacciDetector | Entry near a fib level? | 0-1 |
| SupportResistanceDetector | Stop behind strong level? | 0-1 |
| MarketRegimeDetector | Regime supports direction? | -1 to +2 |
| Volume analysis | Participation confirms? | 0-1 |
| OgzTpoIntegration | Price in/out of value area? | 0-1 |
| TRAI strategy history | Strategy's track record? | 0-2 |
| **MAX CONVICTION** | | **10** |

NOTE: Some modules serve BOTH layers. Fibonacci can be its own strategy
("price hit 0.618 with reaction → enter") AND a conviction scorer for
other strategies ("the EMA crossover entry happens to be near a fib level
→ +1 conviction"). Different questions, same module.

---

## STRATEGY INTERFACE

```javascript
class IStrategy {
  constructor(id) {
    this.strategyId = id;
    this.quarantined = false;   // TRAI can disable this
  }

  /**
   * Binary: Is MY setup here right now?
   * Returns fire: true/false with trade plan if firing.
   */
  evaluate(ctx) {
    return {
      strategyId: this.strategyId,
      fire: false,              // YES or NO
      direction: 'neutral',     // 'buy' | 'sell'
      entry: null,              // Entry price (null = market)
      stop: null,               // Stop loss price
      target: null,             // Take profit price
      reason: '',               // Why this fired
      metadata: {}              // Strategy-specific data for TRAI
    };
  }
}
```

---

## CONVICTION SCORER

```javascript
class ConvictionScorer {
  constructor(modules) {
    this.patternRecognition = modules.patternRecognition;
    this.fibonacciDetector = modules.fibonacciDetector;
    this.supportResistance = modules.supportResistance;
    this.regimeDetector = modules.regimeDetector;
    this.tpoIntegration = modules.tpoIntegration;
    this.traiMemory = modules.traiMemory;
  }

  /**
   * Score conviction AFTER a strategy decided to trade.
   * Does NOT decide whether to trade. Only how much.
   */
  score(signal, ctx) {
    let conviction = 0;
    const details = [];

    // Each scorer returns { points: N, detail: '...' }
    const scorers = [
      this._scorePatternHistory(signal, ctx),
      this._scoreFibAlignment(signal, ctx),
      this._scoreSRAlignment(signal, ctx),
      this._scoreRegimeAlignment(signal, ctx),
      this._scoreVolume(ctx),
      this._scoreTPO(signal, ctx),
      this._scoreStrategyHistory(signal),
    ];

    for (const s of scorers) {
      conviction += s.points;
      details.push(s);
    }

    conviction = Math.min(10, Math.max(0, conviction));

    return {
      conviction,
      positionSize: this._convictionToSize(conviction),
      skip: conviction < 4,
      details
    };
  }

  _convictionToSize(conviction) {
    if (conviction <= 3) return 0;        // Skip
    if (conviction <= 5) return 0.005;    // 0.5%
    if (conviction <= 7) return 0.010;    // 1.0%
    if (conviction <= 9) return 0.015;    // 1.5%
    return 0.020;                         // 2.0%
  }
}
```

---

## STRATEGY ROUTER

```javascript
class StrategyRouter {
  constructor(strategies, scorer, riskManager) {
    this.strategies = strategies;
    this.scorer = scorer;
    this.riskManager = riskManager;
  }

  evaluate(ctx) {
    // 1. Run every non-quarantined strategy
    const signals = this.strategies
      .filter(s => !s.quarantined)
      .map(s => { try { return s.evaluate(ctx); } catch(e) { return { fire: false }; }})
      .filter(s => s.fire);

    // 2. Nobody fired → HOLD
    if (signals.length === 0) {
      return { action: 'HOLD' };
    }

    // 3. Resolve conflicts (opposing directions cancel)
    const resolved = this._resolve(signals);
    if (!resolved) return { action: 'HOLD', reason: 'Conflicting signals' };

    // 4. Score conviction
    const conviction = this.scorer.score(resolved, ctx);

    // 5. Not enough conviction → sit out
    if (conviction.skip) {
      return { action: 'HOLD', reason: `${resolved.strategyId} fired but conviction ${conviction.conviction}/10` };
    }

    // 6. Risk check
    const risk = this.riskManager.evaluate(resolved, conviction);
    if (!risk.approved) return { action: 'HOLD', reason: risk.reason };

    // 7. GO
    return {
      action: resolved.direction === 'buy' ? 'BUY' : 'SELL',
      strategyId: resolved.strategyId,
      conviction: conviction.conviction,
      positionSize: conviction.positionSize,
      entry: resolved.entry,
      stop: resolved.stop,
      target: resolved.target,
      reason: resolved.reason,
      details: conviction.details
    };
  }

  _resolve(signals) {
    const buys = signals.filter(s => s.direction === 'buy');
    const sells = signals.filter(s => s.direction === 'sell');

    // Same direction → highest confidence wins
    if (buys.length > 0 && sells.length === 0)
      return buys.sort((a, b) => (b.confidence||0) - (a.confidence||0))[0];
    if (sells.length > 0 && buys.length === 0)
      return sells.sort((a, b) => (b.confidence||0) - (a.confidence||0))[0];

    // Opposing → conflict, sit out
    return null;
  }
}
```

---

## IMPLEMENTATION ORDER

### Phase 1: Deploy current fixes FIRST (today)
- 73 candle property fixes (done right, no normalizers)
- TRAI learning loop (3 fixes in run-empire-v2.js)
- Regime detector fix (analyzeMarket not detectRegime)
- Let the bot run with real data flowing through everything

### Phase 2: Build the two new modules
- StrategyRouter.js
- ConvictionScorer.js

### Phase 3: Wrap existing modules as strategies
- EMASMACrossoverSignal → already has evaluate-like API
- LiquiditySweepDetector → already has getSignal()
- MADynamicSR → already has signal output
- Thin wrappers for RSI extreme, Fib retracement, S/R bounce, Regime trend

### Phase 4: Rewire run-empire-v2.js
- Replace calculateRealConfidence flow with StrategyRouter.evaluate()
- makeTradeDecision receives router output directly
- Execution uses conviction-based position sizing

### Phase 5: Per-Strategy TRAI Tracking
- TRAI records strategyId on every trade
- Per-strategy promote/quarantine
- Dashboard shows which strategies are printing money

### Phase 6: Expand
- Add that YouTube session sweep strategy as Strategy #9
- Add new strategies anytime — they just implement IStrategy
- TRAI naturally kills what doesn't work
