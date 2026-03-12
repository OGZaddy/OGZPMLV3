# Opening Range Breakout + Fair Value Gap Entry
## Strategy Spec — OGZPrime
### March 11, 2026
### Source: Trey's manual trading approach (ICT-style)

---

## CONCEPT

The first 15-minute candle of the day defines the battlefield. Institutional players establish positions during this candle, creating a range. When price breaks out of that range, it reveals which side has control. The fair value gap (FVG) left behind by the breakout is where smart money re-enters — and where we place our limit order.

This is NOT a momentum chase. It's a retracement entry on a confirmed breakout with defined risk.

---

## DEFINITIONS

**Opening Range (OR):** The high and low of the first 15-minute candle of the trading day (UTC midnight for 24/7 crypto, or configurable session open).

**Fair Value Gap (FVG):** A three-candle pattern where the wick of candle 1 and the wick of candle 3 don't overlap, leaving an imbalance zone. This gap represents aggressive directional movement where one side overwhelmed the other.

```
BULLISH FVG (after downside break + reversal):
  Candle 1: high = $100
  Candle 2: big move up (the gap creator)
  Candle 3: low = $102
  FVG zone: $100 to $102 (the unfilled gap)

BEARISH FVG (after upside break + reversal):
  Candle 1: low = $105
  Candle 2: big move down (the gap creator)
  Candle 3: high = $103
  FVG zone: $103 to $105 (the unfilled gap)
```

**2R Target:** Take profit at 2x the risk. If stop is $50, target is $100 profit.

---

## THE SETUP (Step by Step)

### Step 1: Identify the Opening Range
- On the 15-minute chart, mark the high and low of the FIRST candle of the day
- This creates the OR box
- Config: `sessionOpenHour` (UTC), `openingRangeMinutes: 15`

### Step 2: Watch for Range Break on 5-Minute Chart
- Switch to 5-minute candles
- Wait for a candle that CLOSES above the OR high (bullish break) or CLOSES below the OR low (bearish break)
- A wick through doesn't count — needs a close beyond the level
- This is the breakout confirmation

### Step 3: Detect the Fair Value Gap
- After the breakout candle, look for an FVG in the breakout direction
- Bullish breakout → look for bullish FVG (gap between candle 1 high and candle 3 low)
- Bearish breakout → look for bearish FVG (gap between candle 1 low and candle 3 high)
- The FVG must form AFTER the range break, not before

### Step 4: Place Limit Order on FVG
- **Bullish:** Limit BUY at the TOP of the FVG (conservative) or MIDDLE of the FVG (aggressive)
- **Bearish:** Limit SELL at the BOTTOM of the FVG (conservative) or MIDDLE (aggressive)
- Entry type: LIMIT ORDER (not market — we wait for price to retrace to the FVG)
- If price doesn't retrace to the FVG within `entryWindowMinutes`, cancel the order

### Step 5: Set Stop Loss
- Stop goes on the FIRST candle of the FVG
- **Bullish:** Stop below the low of candle 1 in the FVG pattern
- **Bearish:** Stop above the high of candle 1 in the FVG pattern
- Add a small buffer: `stopBufferPct` (default 0.05%)

### Step 6: Set Take Profit at 2R
- Calculate risk: `risk = |entryPrice - stopLoss|`
- Take profit: `entry + (2 * risk)` for longs, `entry - (2 * risk)` for shorts
- Fixed 2R. No trailing, no scaling out. Simple.

### Step 7: Trade Management
- Once filled, set SL and TP — walk away
- No moving to breakeven early (let the trade breathe)
- Exit only on SL or TP hit
- Max hold time as safety net (configurable, default 4 hours)

---

## DETECTION LOGIC

### FairValueGapDetector Module

```
Input: Array of 5-minute candles
Output: { hasFVG, direction, gapHigh, gapLow, midpoint, firstCandleLow, firstCandleHigh }

For each set of 3 consecutive candles [c1, c2, c3]:

BULLISH FVG:
  if c3.low > c1.high:
    gap exists from c1.high to c3.low
    gapHigh = c3.low
    gapLow = c1.high
    direction = 'bullish'
    firstCandleHigh = c1.high
    firstCandleLow = c1.low  // stop goes here

BEARISH FVG:
  if c3.high < c1.low:
    gap exists from c3.high to c1.low
    gapHigh = c1.low
    gapLow = c3.high
    direction = 'bearish'
    firstCandleHigh = c1.high  // stop goes here
    firstCandleLow = c1.low

MINIMUM GAP SIZE:
  gapSize = gapHigh - gapLow
  if gapSize < minFVGPercent * price: skip (too small, likely noise)
```

### OpeningRangeBreakout Strategy (orchestrates the full flow)

```
State machine:
  1. WAITING_FOR_OPEN → collect first 15m candle → set OR high/low → WATCHING_FOR_BREAK
  2. WATCHING_FOR_BREAK → check each 5m candle close vs OR high/low
     - Close above OR high → breakDirection = 'bullish' → WATCHING_FOR_FVG
     - Close below OR low → breakDirection = 'bearish' → WATCHING_FOR_FVG
     - No break within entryWindowMinutes → DONE (no trade today)
  3. WATCHING_FOR_FVG → scan for FVG in breakout direction
     - FVG found → calculate entry, SL, TP → SIGNAL_ACTIVE
     - No FVG within fvgWindowBars → DONE
  4. SIGNAL_ACTIVE → limit order placed, waiting for fill
     - Filled → POSITION_OPEN
     - Not filled within entryWindowMinutes → cancel → DONE
  5. POSITION_OPEN → waiting for SL or TP
  6. DONE → reset for next session
```

---

## MULTI-TIMEFRAME REQUIREMENT

This strategy operates on TWO timeframes simultaneously:
- **15-minute:** Opening range definition (first candle only)
- **5-minute:** Breakout detection and FVG scanning

The bot currently feeds 15-minute candles. To support this strategy, it needs to ALSO subscribe to 5-minute candles OR derive 5-minute candles from the 15-minute feed.

**Option A (preferred):** Subscribe to both 15m and 5m candle feeds from Kraken. The MultiTimeframeAdapter already exists for this.

**Option B:** Use 15-minute candles for everything. The OR is still one candle. The breakout detection works but is less precise (15m close vs 5m close). FVG detection on 15m candles will find larger gaps but miss smaller intrabar ones.

**Option C:** Subscribe to 1-minute candles and aggregate internally to both 5m and 15m. Most flexible but highest data volume.

Recommendation: Start with Option B (15m only) to prove the logic works. Upgrade to Option A when multi-timeframe is wired.

---

## CONFIG (TradingConfig.strategies.OpeningRangeBreakout)

```javascript
OpeningRangeBreakout: {
  // Session timing
  sessionOpenHour: env('ORB_SESSION_HOUR', 0),           // UTC midnight for 24/7 crypto
  sessionOpenMinute: env('ORB_SESSION_MINUTE', 0),
  openingRangeMinutes: env('ORB_RANGE_MINUTES', 15),     // First candle = 15 min

  // Breakout detection
  breakRequiresClose: true,                               // Must close beyond OR, not just wick
  entryWindowMinutes: env('ORB_ENTRY_WINDOW', 120),      // 2 hours to find entry after break

  // Fair Value Gap
  minFVGPercent: env('ORB_MIN_FVG_PCT', 0.05),           // Minimum gap size as % of price
  fvgWindowBars: env('ORB_FVG_WINDOW', 10),              // Max bars after break to find FVG
  fvgEntryLevel: env('ORB_FVG_ENTRY', 'top'),            // 'top', 'middle', or 'bottom' of FVG

  // Risk management
  stopBufferPct: env('ORB_STOP_BUFFER', 0.05),           // Buffer beyond FVG candle 1
  targetRR: env('ORB_TARGET_RR', 2.0),                   // Fixed 2R target
  maxHoldMinutes: env('ORB_MAX_HOLD', 240),              // 4 hour safety net

  // Confidence
  baseConfidence: 0.60,                                   // Starts at 60%
  fvgSizeBoost: 0.10,                                    // +10% if FVG is large (>0.2%)
  volumeBoost: 0.10,                                     // +10% if breakout candle has high volume
  retestBoost: 0.10,                                     // +10% if OR level was tested before break

  enabled: false,                                         // Off until verified
}
```

---

## EXIT CONTRACT

```javascript
{
  stopLossPercent: -(risk / entryPrice * 100),            // Derived from FVG candle 1
  takeProfitPercent: (risk * targetRR) / entryPrice * 100, // 2R
  maxHoldTimeMinutes: 240,
  trailingStop: false,                                     // No trailing — fixed SL/TP
  scalingOut: false,                                       // No partial exits
}
```

---

## WHY THIS IS BETTER THAN CURRENT LIQUIDITY SWEEP

| Aspect | Current LiquiditySweep | Opening Range + FVG |
|--------|----------------------|---------------------|
| Entry signal | Hammer/engulfing after box exit | Limit order on FVG retracement |
| Entry precision | Market order on pattern candle | Limit order at specific price level |
| Stop placement | Below pattern wick (variable) | First candle of FVG (structural) |
| Target | Box opposite side (variable R:R) | Fixed 2R (predictable) |
| Fill quality | Chases the move | Waits for retracement |
| Fee impact | Taker on entry (0.40%) | Maker on entry (0.25%) — limit order |
| R:R consistency | Varies per trade | Always 2:1 |

The FVG entry saves 0.15% per trade on entry fees alone (limit vs market). Over 100 trades that's 15% of capital preserved.

---

## IMPLEMENTATION ORDER

1. **FairValueGapDetector module** (`modules/FairValueGapDetector.js`)
   - Pure detection: takes candle array, returns FVG zones
   - Unit test with known FVG patterns

2. **OpeningRangeBreakout strategy** (`modules/OpeningRangeBreakout.js`)
   - State machine: OR → break → FVG → entry → exit
   - Uses FairValueGapDetector for step 3
   - Config from TradingConfig

3. **Register in StrategyOrchestrator**
   - Add toggle: `pipeline.enableOpeningRangeBreakout`
   - Wire signal through the same path as other strategies

4. **Deterministic tests**
   - Hand-craft candle set with known OR, breakout, and FVG
   - Verify entry price, stop, and target are correct

5. **Backtest through production pipeline**
   - RSI alone → freeze
   - RSI + ORB → compare
   - ORB alone → isolate performance

---

## VALIDATION CRITERIA

This strategy is VERIFIED when:

1. FVG detector correctly identifies bullish and bearish gaps in test data
2. OR high/low match the first 15m candle exactly
3. Break detection requires close beyond OR (not just wick)
4. Entry is a limit order at the FVG level, not a market order
5. Stop is on the first candle of the FVG + buffer
6. Target is exactly 2R from entry
7. No trades taken during warmup
8. Long-only on spot market (no short entries)
9. All config values come from TradingConfig (no hardcodes)
10. Passes deterministic test with known analytical answer
