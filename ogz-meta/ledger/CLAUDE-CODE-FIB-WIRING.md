# CLAUDE CODE: Wire Fibonacci Levels into StrategyOrchestrator

## CONTEXT

`FibonacciDetector.js` (387 lines) exists in `core/` and works. It finds swing highs/lows,
calculates retracement levels (0.236, 0.382, 0.5, 0.618, 0.786), detects golden zone (0.618),
and has `getNearestLevel(price)` that returns how close price is to any fib level.

Currently it's ONLY used inside `OptimizedTradingBrain` as part of the soupy pooled confidence.
Since we're replacing TradingBrain's entry role with StrategyOrchestrator, fib levels need to
flow through the new pipeline.

**Goal:** The orchestrator's strategies should know when price is near a fib level so they can:
1. Boost confidence on EMA/SMA bounces that happen AT a fib level (double confirmation)
2. Boost confidence on liquidity sweeps that reverse AT a fib level
3. Provide fib levels to exit contracts for smarter TP/SL placement

---

## CHANGES

### 1. Add FibonacciDetector to run-empire-v2.js constructor

Near where `this.strategyOrchestrator` is instantiated, add:

```javascript
    // Fibonacci level detection for strategy context
    const FibonacciDetector = require('./core/FibonacciDetector');
    this.fibonacciDetector = new FibonacciDetector({
      lookbackCandles: 100,
      strengthRequired: 3,
      proximityThreshold: 0.5,
    });
```

### 2. In analyzeAndTrade(), update fib levels before orchestrator call

Before the orchestrator.evaluate() call, add:

```javascript
    // Update Fibonacci levels with current price history
    let fibLevels = null;
    let nearestFibLevel = null;
    if (this.fibonacciDetector && this.priceHistory.length >= 30) {
      fibLevels = this.fibonacciDetector.update(this.priceHistory);
      if (fibLevels) {
        nearestFibLevel = this.fibonacciDetector.getNearestLevel(price);
      }
    }
```

### 3. Pass fib data to orchestrator via extras

Update the orchestrator.evaluate() call to include fib data:

```javascript
    const orchResult = this.strategyOrchestrator.evaluate(
      indicators,
      patterns,
      regime,
      this.priceHistory,
      {
        emaCrossoverSignal: this.emaCrossoverSignal,
        maDynamicSRSignal: this.maDynamicSRSignal,
        liquiditySweepSignal: this.liquiditySweepSignal,
        mtfAdapter: this.mtfAdapter,
        tpoResult: tpoResult,
        price: price,
        // NEW: Fibonacci context
        fibLevels: fibLevels,
        nearestFibLevel: nearestFibLevel,
      }
    );
```

### 4. Update StrategyOrchestrator.js — Add fib awareness to the two primary strategies

In `core/StrategyOrchestrator.js`, update the EMA/SMA Crossover strategy evaluator:

Find the EMASMACrossover evaluate function. After the confidence is set, add fib boost:

```javascript
    // ─── 1. EMA/SMA Crossover Strategy ───
    this.strategies.push({
      name: 'EMASMACrossover',
      evaluate: (ctx) => {
        const sig = ctx.extras?.emaCrossoverSignal;
        if (!sig || sig.direction === 'neutral' || !sig.direction) return null;
        let conf = sig.confidence || 0;
        if (conf < 0.05) return null;

        // Fib level boost: if price is bouncing at a fib level, this is a stronger setup
        const fib = ctx.extras?.nearestFibLevel;
        let fibBoost = '';
        if (fib && fib.distance < 0.5) {
          // Price is within 0.5% of a fib level — boost confidence
          const boost = fib.isGoldenZone ? 0.15 : 0.10;
          conf = Math.min(1.0, conf + boost);
          fibBoost = ` + Fib ${(fib.level * 100).toFixed(1)}% (${fib.isGoldenZone ? 'GOLDEN ZONE' : 'near level'})`;
        }

        return {
          direction: sig.direction,
          confidence: conf,
          reason: `EMA/SMA Crossover ${sig.direction} (${sig.crossovers?.length || 0} crosses)${fibBoost}`,
          signalData: sig
        };
      }
    });
```

Do the same for MADynamicSR:

```javascript
    // ─── 2. MA Dynamic S/R Strategy ───
    this.strategies.push({
      name: 'MADynamicSR',
      evaluate: (ctx) => {
        const sig = ctx.extras?.maDynamicSRSignal;
        if (!sig || sig.direction === 'neutral' || !sig.direction) return null;
        let conf = sig.confidence || 0;
        if (conf < 0.05) return null;

        // Fib level boost: bounce at MA + fib level = very strong S/R
        const fib = ctx.extras?.nearestFibLevel;
        let fibBoost = '';
        if (fib && fib.distance < 0.5) {
          const boost = fib.isGoldenZone ? 0.15 : 0.10;
          conf = Math.min(1.0, conf + boost);
          fibBoost = ` + Fib ${(fib.level * 100).toFixed(1)}%${fib.isGoldenZone ? ' GOLDEN' : ''}`;
        }

        return {
          direction: sig.direction,
          confidence: conf,
          reason: `MA Dynamic S/R ${sig.direction} (${(sig.events || []).map(e => e.event || e).join(', ') || 'level touch'})${fibBoost}`,
          signalData: sig
        };
      }
    });
```

And for LiquiditySweep:

```javascript
    // ─── 3. Liquidity Sweep Strategy ───
    this.strategies.push({
      name: 'LiquiditySweep',
      evaluate: (ctx) => {
        const sig = ctx.extras?.liquiditySweepSignal;
        if (!sig || !sig.hasSignal) return null;
        if (!sig.direction || sig.direction === 'neutral') return null;
        let conf = sig.confidence || 0;
        if (conf < 0.05) return null;

        // Fib level boost: sweep reversal at a fib level = institutional level
        const fib = ctx.extras?.nearestFibLevel;
        let fibBoost = '';
        if (fib && fib.distance < 0.8) {
          const boost = fib.isGoldenZone ? 0.12 : 0.08;
          conf = Math.min(1.0, conf + boost);
          fibBoost = ` @ Fib ${(fib.level * 100).toFixed(1)}%${fib.isGoldenZone ? ' GOLDEN' : ''}`;
        }

        return {
          direction: sig.direction,
          confidence: conf,
          reason: `Liquidity Sweep ${sig.direction} (${sig.sweepType || 'institutional'})${fibBoost}`,
          signalData: sig
        };
      }
    });
```

### 5. (Optional) Pass fib levels to ExitContract for smarter TP placement

In the orchestrator's `evaluate()` method, after creating the exit contract, adjust TP if
a fib level is nearby above/below current price:

```javascript
    // If we have fib levels, check if a fib level makes a better TP target
    if (exitContract && extras.fibLevels && extras.price) {
      const price = extras.price;
      const levels = extras.fibLevels;
      const direction = winner.direction;

      // Find the nearest fib level in the profit direction
      let bestTarget = null;
      for (const [key, levelPrice] of Object.entries(levels)) {
        if (key === 'direction' || key === 'swingHigh' || key === 'swingLow') continue;
        const pctFromPrice = ((levelPrice - price) / price) * 100;

        if (direction === 'buy' && pctFromPrice > 0.5 && pctFromPrice < 5.0) {
          // Level is above current price and within reasonable TP range
          if (!bestTarget || pctFromPrice < bestTarget.pct) {
            bestTarget = { pct: pctFromPrice, level: key, price: levelPrice };
          }
        }
        if (direction === 'sell' && pctFromPrice < -0.5 && pctFromPrice > -5.0) {
          if (!bestTarget || Math.abs(pctFromPrice) < Math.abs(bestTarget.pct)) {
            bestTarget = { pct: pctFromPrice, level: key, price: levelPrice };
          }
        }
      }

      if (bestTarget) {
        // Use fib level as TP if it's within our exit contract's range
        const currentTP = exitContract.takeProfitPercent;
        if (Math.abs(bestTarget.pct) <= Math.abs(currentTP) * 1.2) {
          exitContract.takeProfitPercent = Math.abs(bestTarget.pct);
          exitContract.fibTarget = bestTarget;
          console.log(`📐 TP adjusted to Fib ${bestTarget.level} @ $${bestTarget.price.toFixed(0)} (${bestTarget.pct.toFixed(2)}%)`);
        }
      }
    }
```

---

## WHAT THIS GIVES YOU

Before: Fib levels existed but only added to soupy confidence blob
After: Fib levels directly boost the confidence of your two primary strategies when price
is at a meaningful fib level, AND can adjust take-profit targets to fib levels

Example scenario:
- Price retraces to EMA 50 (MADynamicSR fires BUY at 40% confidence)
- That EMA 50 happens to be at the 0.618 fib golden zone
- Fib boost adds 15% → MADynamicSR now at 55% confidence
- TP gets adjusted from +3.0% to the 0.382 fib level (say +2.7%) for a cleaner exit
- This is a textbook institutional trade setup

---

## TESTING

```bash
# Verify FibonacciDetector loads
node -e "const F = require('./core/FibonacciDetector'); const f = new F(); console.log('✅ FibDetector loads')"

# In live logs, look for:
# "📐 Price near 0.618 Fib golden zone" (from fib detection)
# "EMA/SMA Crossover buy + Fib 61.8% (GOLDEN ZONE)" (from orchestrator)
# "📐 TP adjusted to Fib 0.382 @ $98500 (2.7%)" (from TP adjustment)
```
