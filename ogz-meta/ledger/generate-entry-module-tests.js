/**
 * generate-entry-module-tests.js
 * Creates test datasets designed to trigger each entry module specifically
 *
 * Pipeline Task: Verify all 4 entry modules fire correctly
 */

const fs = require('fs');

const BASE_PRICE = 40000;
const BASE_TIME = Date.now() - (300 * 60000); // Start 300 mins ago

function generateCandle(index, open, close, highExtra = 0, lowExtra = 0) {
  const high = Math.max(open, close) + highExtra;
  const low = Math.min(open, close) - lowExtra;
  return {
    t: BASE_TIME + (index * 60000),
    o: open,
    h: high,
    l: low,
    c: close,
    v: 100 + Math.random() * 50
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 1: EMA 9/20 GOLDEN CROSS
// Pattern: 50 candles trending down, then 50 candles trending up
// This should cause EMA9 to cross above EMA20
// ═══════════════════════════════════════════════════════════════
function generateEMACrossoverTest() {
  const candles = [];
  let price = BASE_PRICE;

  // Phase 1: Downtrend (candles 0-49) - EMA9 stays below EMA20
  for (let i = 0; i < 50; i++) {
    const drop = 20 + Math.random() * 10; // ~$20-30 drop per candle
    const open = price;
    price -= drop;
    const close = price;
    candles.push(generateCandle(i, open, close, 5, 5));
  }

  // Phase 2: Sharp reversal (candles 50-59) - Quick move up
  for (let i = 50; i < 60; i++) {
    const rise = 80 + Math.random() * 40; // Strong $80-120 rise per candle
    const open = price;
    price += rise;
    const close = price;
    candles.push(generateCandle(i, open, close, 20, 5));
  }

  // Phase 3: Continued uptrend (candles 60-120) - EMA9 should cross above EMA20
  for (let i = 60; i < 120; i++) {
    const rise = 15 + Math.random() * 15; // Moderate $15-30 rise
    const open = price;
    price += rise;
    const close = price;
    candles.push(generateCandle(i, open, close, 10, 5));
  }

  // Phase 4: Hold the gains (candles 120-200) - Let signals develop
  for (let i = 120; i < 200; i++) {
    const move = (Math.random() - 0.4) * 20; // Slight upward bias
    const open = price;
    price += move;
    const close = price;
    candles.push(generateCandle(i, open, close, 8, 8));
  }

  return candles;
}

// ═══════════════════════════════════════════════════════════════
// TEST 2: LIQUIDITY SWEEP
// Pattern: Range-bound box → wick sweep below support → hammer recovery
// ═══════════════════════════════════════════════════════════════
function generateLiquiditySweepTest() {
  const candles = [];
  let price = BASE_PRICE;
  const boxHigh = BASE_PRICE + 200;
  const boxLow = BASE_PRICE - 200;

  // Phase 1: Build a range/box (candles 0-50)
  for (let i = 0; i < 50; i++) {
    const rangePos = Math.sin(i * 0.3) * 150; // Oscillate within range
    const open = BASE_PRICE + rangePos;
    const close = BASE_PRICE + rangePos + (Math.random() - 0.5) * 30;
    price = close;
    candles.push(generateCandle(i, open, close, 20, 20));
  }

  // Phase 2: Sweep below support with long wick (candles 50-52)
  // This is the manipulation candle
  const sweepCandle1 = {
    t: BASE_TIME + (50 * 60000),
    o: boxLow + 50,           // Open near bottom of range
    h: boxLow + 60,           // High slightly above open
    l: boxLow - 150,          // LONG WICK below support (sweep)
    c: boxLow + 30,           // Close back inside range
    v: 500                    // High volume on sweep
  };
  candles.push(sweepCandle1);

  // Hammer candle (reversal signal)
  const hammerCandle = {
    t: BASE_TIME + (51 * 60000),
    o: boxLow + 20,
    h: boxLow + 100,          // Strong close toward high
    l: boxLow - 80,           // Another sweep test but rejected
    c: boxLow + 90,           // Close near high = hammer
    v: 400
  };
  candles.push(hammerCandle);

  // Bullish engulfing (confirmation)
  const engulfCandle = {
    t: BASE_TIME + (52 * 60000),
    o: boxLow + 80,
    h: boxLow + 200,
    l: boxLow + 70,
    c: boxLow + 190,          // Engulfs previous
    v: 350
  };
  candles.push(engulfCandle);

  // Phase 3: Recovery rally (candles 53-100)
  price = boxLow + 200;
  for (let i = 53; i < 100; i++) {
    const rise = 10 + Math.random() * 20;
    const open = price;
    price += rise;
    const close = price;
    candles.push(generateCandle(i, open, close, 15, 10));
  }

  // Phase 4: Consolidate for more candles
  for (let i = 100; i < 200; i++) {
    const move = (Math.random() - 0.5) * 30;
    const open = price;
    price += move;
    const close = price;
    candles.push(generateCandle(i, open, close, 10, 10));
  }

  return candles;
}

// ═══════════════════════════════════════════════════════════════
// TEST 3: MA DYNAMIC S/R (Bounce off EMA)
// Pattern: Price approaches EMA from above, touches, bounces
// ═══════════════════════════════════════════════════════════════
function generateMABounceTest() {
  const candles = [];
  let price = BASE_PRICE;

  // Phase 1: Establish uptrend so EMAs are below price (candles 0-60)
  for (let i = 0; i < 60; i++) {
    const rise = 15 + Math.random() * 15;
    const open = price;
    price += rise;
    const close = price;
    candles.push(generateCandle(i, open, close, 10, 5));
  }

  // Phase 2: Pullback toward EMA (candles 60-80)
  // Price drops back toward the rising EMA
  for (let i = 60; i < 80; i++) {
    const drop = 25 + Math.random() * 15; // Pull back faster than EMA rises
    const open = price;
    price -= drop;
    const close = price;
    candles.push(generateCandle(i, open, close, 5, 10));
  }

  // Phase 3: Touch and bounce (candles 80-85)
  // This should trigger MA bounce signal
  for (let i = 80; i < 85; i++) {
    const open = price;
    // Small drop then recovery (bounce pattern)
    const lowPoint = price - 50;
    const close = price + 30; // Close higher than open = bounce
    price = close;
    candles.push({
      t: BASE_TIME + (i * 60000),
      o: open,
      h: close + 20,
      l: lowPoint,
      c: close,
      v: 200
    });
  }

  // Phase 4: Continuation up (candles 85-200)
  for (let i = 85; i < 200; i++) {
    const rise = 10 + Math.random() * 20;
    const open = price;
    price += rise;
    const close = price;
    candles.push(generateCandle(i, open, close, 10, 5));
  }

  return candles;
}

// ═══════════════════════════════════════════════════════════════
// TEST 4: BRAIN CONFIDENCE (Standard signals)
// Pattern: Clear bullish setup with RSI, MACD, trend alignment
// ═══════════════════════════════════════════════════════════════
function generateBrainConfidenceTest() {
  const candles = [];
  let price = BASE_PRICE;

  // Phase 1: Consolidation / slight downtrend (candles 0-30)
  for (let i = 0; i < 30; i++) {
    const move = -5 + Math.random() * 3;
    const open = price;
    price += move;
    const close = price;
    candles.push(generateCandle(i, open, close, 10, 10));
  }

  // Phase 2: RSI oversold zone (candles 30-50) - Drop to create oversold
  for (let i = 30; i < 50; i++) {
    const drop = 30 + Math.random() * 20;
    const open = price;
    price -= drop;
    const close = price;
    candles.push(generateCandle(i, open, close, 5, 15));
  }

  // Phase 3: Reversal with strong bullish candles (candles 50-70)
  // MACD should cross bullish, RSI should rise from oversold
  for (let i = 50; i < 70; i++) {
    const rise = 50 + Math.random() * 30; // Strong bullish candles
    const open = price;
    price += rise;
    const close = price;
    candles.push(generateCandle(i, open, close, 20, 5));
  }

  // Phase 4: Trend continuation (candles 70-200)
  for (let i = 70; i < 200; i++) {
    const rise = 10 + Math.random() * 15;
    const open = price;
    price += rise;
    const close = price;
    candles.push(generateCandle(i, open, close, 10, 5));
  }

  return candles;
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Generate all test files
// ═══════════════════════════════════════════════════════════════

console.log('Generating entry module test datasets...\n');

const tests = [
  { name: 'ema-crossover', fn: generateEMACrossoverTest, description: 'EMA 9/20 golden cross' },
  { name: 'liquidity-sweep', fn: generateLiquiditySweepTest, description: 'Wick sweep below support' },
  { name: 'ma-bounce', fn: generateMABounceTest, description: 'MA touch and bounce' },
  { name: 'brain-confidence', fn: generateBrainConfidenceTest, description: 'RSI/MACD bullish setup' },
];

for (const test of tests) {
  const candles = test.fn();
  const filename = `ogz-meta/ledger/test-${test.name}.json`;
  fs.writeFileSync(filename, JSON.stringify(candles, null, 2));
  console.log(`✅ ${test.description}: ${filename} (${candles.length} candles)`);
}

console.log('\nAll test datasets generated!');
console.log('\nRun backtests with:');
console.log('  node run-empire-v2.js --backtest --candles ogz-meta/ledger/test-ema-crossover.json --tier ML');
console.log('  node run-empire-v2.js --backtest --candles ogz-meta/ledger/test-liquidity-sweep.json --tier ML');
console.log('  node run-empire-v2.js --backtest --candles ogz-meta/ledger/test-ma-bounce.json --tier ML');
console.log('  node run-empire-v2.js --backtest --candles ogz-meta/ledger/test-brain-confidence.json --tier ML');
