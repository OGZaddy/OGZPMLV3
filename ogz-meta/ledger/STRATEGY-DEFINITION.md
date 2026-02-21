# OGZPrime Trading Strategy Definition
## For Claude Code / All AI Assistants

---

## THE THESIS — Two Clean Edges on 15-Minute Candles

OGZPrime runs **two primary strategies** on 15-minute BTC/USD candles via Kraken.
Everything else is **supporting confluence** that affects position sizing, not entry decisions.

**Why 15-minute candles:**
- Kraken spot fees = ~0.26% per side = **0.52% round-trip**
- 1-minute candle moves: 0.05% - 0.5% → net-negative after fees on nearly every trade
- 15-minute candle moves: 0.5% - 3.0% → meaningful moves that can absorb fees and profit
- Institutional players (liquidity sweep traders) operate on 15m candles
- SMA/EMA support/resistance is meaningful on 15m, noise on 1m

---

## STRATEGY 1: Liquidity Sweep (Mean Reversion)

**Module:** `modules/LiquiditySweepDetector.js`
**Exit Contract:** SL -1.5%, TP +2.5%, trailing 1.0%, max hold 90 min
**Concept:** Institutional stop hunt → reversal

### How it works:
1. Price makes an aggressive move past a recent high/low (the "sweep")
2. This triggers retail stop losses — institutions are filling orders
3. Price reverses back into the range
4. We enter on the reversal candle
5. Target: the opposite side of the range or previous support/resistance

### What makes a good sweep signal:
- ATR filter confirms volatility is sufficient (not a dead market)
- Manipulation candle: long wick past the range, body closes back inside
- Reversal confirmation: next candle continues back into range
- Volume spike on the sweep candle (institutions moving size)

### When this strategy fires:
- Confidence 40%+ = qualified to win (strong sweep + reversal confirmation)
- Confidence 60%+ = high conviction (textbook sweep pattern)
- Fires maybe 2-5 times per day on 15m candles

### What it looks like:
```
Price sweeps below support → long wick → reversal candle → BUY
Price sweeps above resistance → long wick → reversal candle → SELL
```

---

## STRATEGY 2: EMA/SMA Bounce + Crossover (Trend Following)

**Modules:** `modules/EMASMACrossoverSignal.js` + `modules/MADynamicSR.js`
**Exit Contract:** SL -2.0%, TP +4.0%, trailing 1.5%, max hold 240 min
**Concept:** Buy retrace to support → ride trend until momentum dies

### How it works:
1. Identify trend via EMA crossovers (golden cross = bullish, death cross = bearish)
2. Wait for price to pull back to a key moving average (EMA 20, SMA 50, EMA 50)
3. MA acts as dynamic support/resistance — price "bounces" off it
4. Enter on the bounce
5. Ride the trend until:
   - Price rubberbands too far from the MA (extended, trailing stop catches it)
   - Crossover reversal (death cross after golden cross = momentum shift)
   - Candles change momentum (multiple opposite-direction candles)

### The two sub-modules work together:
- **EMASMACrossoverSignal** detects the trend direction and crossover events
  - Tracks 5 MA pairs: EMA 9/20, EMA 20/50, EMA 50/200, SMA 20/50, SMA 50/200
  - Golden cross = bullish, Death cross = bearish
  - Also detects: divergence velocity, snapback, blowoff, confluence between pairs
- **MADynamicSR** detects bounces off the MAs
  - Treats each MA as a dynamic support/resistance level
  - Detects: MA bounce, MA break, MA retest, MA compression zones
  - Fires when price touches an MA and starts moving away from it

### When to BUY:
- EMA crossover says BULLISH (golden cross on 2+ pairs)
- Price pulls back to EMA 20 or SMA 50
- MADynamicSR detects a bounce (price touches MA, reversal candle forms)
- Both modules agree on BUY direction → this strategy fires with high confidence

### When to SELL (exit):
- Trailing stop triggered (price moved too far, rubberbanded back)
- Crossover reversal (death cross on primary pair)
- Price breaks below the MA it bounced from (support broken = invalidation)
- Max hold time reached (240 min = 16 candles on 15m)

### What it looks like:
```
Golden cross (EMA 9 > EMA 20) → price retraces to EMA 20 → bounce → BUY
Ride up... trailing stop follows...
Price extends too far above EMA → starts pulling back → trailing stop hit → EXIT
```

---

## SUPPORTING CONFLUENCE (Not Primary Entries)

These strategies CAN fire independently if they hit 25%+ confidence, but their
main role is **confirming the two primary strategies** and boosting position sizing.

| Strategy | Role | When it helps |
|----------|------|---------------|
| RSI Extreme | Confirms oversold/overbought | RSI < 25 confirms sweep buy, RSI > 75 confirms sweep sell |
| Pattern Recognition | Confirms reversal patterns | Bull flag at bounce, engulfing at sweep reversal |
| Market Regime + Trend | Confirms macro direction | Bull regime + bullish trend = let the SMA ride longer |
| Multi-Timeframe | Confirms higher TF alignment | 1h and 4h agree with 15m direction = stronger trade |
| OGZ TPO | Confirms value area edges | Price at TPO value area low = good buy zone |

### How confluence affects trades:

| Confluent Signals | Position Sizing |
|-------------------|----------------|
| 1 (winner alone) | 1.0x base |
| 2 agree | 1.5x base |
| 3 agree | 2.0x base |
| 4+ agree | 2.5x base (cap) |

**Example:** Liquidity Sweep fires BUY at 55% confidence. RSI is at 22 (extreme oversold,
also says BUY). Pattern Recognition sees a bullish engulfing (also BUY).
→ Winner: Liquidity Sweep (highest confidence)
→ Confluence: 3 strategies agree
→ Position size: 2.0x base
→ Exit contract: Liquidity Sweep's (-1.5% SL, +2.5% TP)

---

## EXIT LOGIC (Unchanged)

Exits are handled by `ExitContractManager.js` using the contract frozen at entry.
The winning strategy's exit contract controls the trade. This means:

- Liquidity Sweep trades have tighter stops and shorter holds (mean reversion)
- EMA/SMA trades have wider stops and longer holds (trend following)

No more "unrelated strategy confidence drops trigger premature exits."

---

## CONFIGURATION

In `StrategyOrchestrator` constructor:
```javascript
{
  minStrategyConfidence: 0.25,  // Individual strategy must be 25%+ to qualify
  minConfluenceCount: 1,        // 1 = winner alone can trade (set to 2 for conservative)
  confluenceSizing: {
    1: 1.0,   // Solo
    2: 1.5,   // Two agree
    3: 2.0,   // Three agree
    4: 2.5,   // Four+ agree (cap)
  }
}
```

**Tuning knobs:**
- Raise `minStrategyConfidence` to 0.35-0.45 if too many bad trades
- Raise `minConfluenceCount` to 2 if you want to require confirmation
- Adjust `confluenceSizing` multipliers based on risk tolerance
- Adjust exit contract values in `ExitContractManager.js` DEFAULT_CONTRACTS

---

## WHAT SUCCESS LOOKS LIKE

On 15-minute candles with these two strategies:
- **Trade frequency:** 3-8 trades per day (not 50+ like on 1-minute)
- **Win rate target:** 55-65% (quality over quantity)
- **Average hold time:** 30-120 minutes
- **Average win:** 1.5-3.0% (after 0.52% fees = 1.0-2.5% net)
- **Average loss:** -1.5-2.0% (stopped out quickly)
- **Expectancy:** Positive with 55%+ win rate at these R:R ratios

The math works because 15m candles move enough to clear fees AND leave profit.
