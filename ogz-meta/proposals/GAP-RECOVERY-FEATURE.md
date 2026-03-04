# Gap Recovery Feature (POST-EXTRACTION)

**Status:** IMPLEMENTED - Commit 3530445
**Logged:** 2026-03-03
**Priority:** HIGH - prevents unnecessary downtime

---

## Current Behavior (BROKEN)
```
Gap detected → immediate halt → wait for WebSocket data → resume
```
- Misses trading opportunities during WebSocket hiccups
- No attempt to recover via REST API
- Halts even when data is easily recoverable

## Target Behavior (CORRECT)
```
Gap detected → attempt REST backfill →
  success: recalc indicators → resume (no downtime)
  fail: THEN halt → retry every 60s → 3 clean candles → resume
```

---

## Components Needed

### 1. GapDetector (in CandleProcessor after extraction)
- Detect timestamp gaps in incoming candles
- Gap threshold: configurable (default 2 minutes for 1m candles)
- Track last candle timestamp, compare to incoming
- Return { hasGap: bool, gapSize: ms, expectedCandles: int }

### 2. BackfillService
- Wraps `kraken_adapter_simple.getHistoricalOHLC()`
- Input: gapStart, gapEnd timestamps
- Output: array of candles to fill the gap
- Handles rate limiting, retries, error cases
- Returns `{ success: bool, candles: [], error: string }`

### 3. Indicator Recalc Trigger
- After successful backfill, splice candles into priceHistory
- Call `indicatorEngine.computeBatch(patchedHistory)` for clean recalc
- Existing method at `IndicatorEngine.js:308`

### 4. Resume Requirements
- 3 clean candles required before resuming entries
- "Clean" = sequential timestamps, no gaps
- Counter resets if another gap detected
- Configurable via `RECOVERY_CANDLES_REQUIRED` env var

### 5. Retry Loop
- On backfill failure: halt entries, retry every 60s
- Max retries configurable (default 10 = 10 minutes)
- Log each attempt with reason for failure
- Alert to dashboard on repeated failures

---

## Implementation Flow

```javascript
// In CandleProcessor (future extraction of handleMarketData)
async processCandle(candle) {
  const gap = this.detectGap(candle);

  if (gap.hasGap) {
    console.warn(`⚠️ Gap detected: ${gap.gapSize}ms (${gap.expectedCandles} candles)`);

    // FIRST: Try REST backfill
    const backfill = await this.backfillService.fill(gap.start, gap.end);

    if (backfill.success) {
      // Patch history and recalc
      this.spliceCandles(backfill.candles);
      this.indicatorEngine.computeBatch(this.priceHistory);
      console.log(`✅ Backfill success: ${backfill.candles.length} candles recovered`);
      // Continue normal operation - no halt needed
    } else {
      // THEN: Halt and retry
      console.error(`❌ Backfill failed: ${backfill.error}`);
      this.haltEntries('Backfill failed - data gap unrecoverable');
      this.startBackfillRetry(gap);
    }
  }

  // Track clean candles for recovery
  if (this.isHalted() && this.isCleanCandle(candle)) {
    this.cleanCandleCount++;
    if (this.cleanCandleCount >= 3) {
      this.resumeEntries();
    }
  }

  // Normal processing...
}
```

---

## Depends On
- **handleMarketData extraction** → CandleProcessor module
- CandleProcessor is next after current extraction phases complete

## Files to Modify
- `core/CandleProcessor.js` (new - from handleMarketData extraction)
- `core/BackfillService.js` (new)
- `kraken_adapter_simple.js` (already has getHistoricalOHLC)
- `core/indicators/IndicatorEngine.js` (already has computeBatch)
- `core/StateManager.js` (halt/resume methods exist)

## Testing
- Simulate gap by skipping candles in backtest
- Mock REST API failures
- Verify 3-candle recovery requirement
- Verify indicator recalc produces same results as clean history

---

## Why This Matters
Every unnecessary halt = missed trades. If Kraken WebSocket hiccups for 30 seconds but REST API works fine, we should backfill and keep trading. The halt should be a **last resort**, not the first response.
