// test/regression/waterfall.js
'use strict';

/**
 * Waterfall Regression Test Framework
 *
 * Tests each layer of the trading pipeline in isolation before stacking.
 * Locks down behavior at each level to catch regressions.
 *
 * Usage:
 *   node test/regression/waterfall.js baseline  - Generate baseline JSON
 *   node test/regression/waterfall.js verify    - Verify against baseline
 */

const fs = require('fs');
const path = require('path');

// Load fixture
const fixture = require('../fixtures/rsi-candle-set.json');

/**
 * Helper – run IndicatorEngine on fixture and return final snapshot
 */
async function runIndicators(config = {}) {
  const IndicatorEngine = require('../../core/indicators/IndicatorEngine');

  const ie = new IndicatorEngine({
    rsiPeriod: config.rsiPeriod || 14,
    warmupCandles: config.warmupCandles || 0,
    ...config
  });

  for (const candle of fixture) {
    ie.updateCandle(candle);
  }

  return ie.getSnapshot();
}

/**
 * Generate baseline JSON (run once, commit the result)
 */
async function generateBaseline() {
  console.log('📊 Generating regression baseline...\n');

  const result = {
    generated: new Date().toISOString(),
    fixture: 'rsi-candle-set.json',
    candleCount: fixture.length,
    tests: {}
  };

  // Test 1: RSI with period 14 (Wilder standard)
  console.log('  [1] RSI-14 on Wilder textbook data...');
  const snapshot14 = await runIndicators({ rsiPeriod: 14 });
  result.tests.rsi14 = {
    rsi: snapshot14.indicators.rsi,
    expectedRange: [50, 53], // Wilder textbook: ~51.78
    price: snapshot14.indicators.price
  };
  console.log(`      RSI: ${result.tests.rsi14.rsi.toFixed(2)}`);

  // Test 2: RSI with period 7 (shorter, more volatile)
  console.log('  [2] RSI-7 on same data...');
  const snapshot7 = await runIndicators({ rsiPeriod: 7 });
  result.tests.rsi7 = {
    rsi: snapshot7.indicators.rsi,
    price: snapshot7.indicators.price
  };
  console.log(`      RSI: ${result.tests.rsi7.rsi.toFixed(2)}`);

  // Test 3: EMA values
  console.log('  [3] EMA values...');
  result.tests.ema = {
    ema9: snapshot14.indicators.ema9,
    ema20: snapshot14.indicators.ema20
  };
  console.log(`      EMA9: ${result.tests.ema.ema9.toFixed(2)}, EMA20: ${result.tests.ema.ema20.toFixed(2)}`);

  // Test 4: MACD
  console.log('  [4] MACD values...');
  result.tests.macd = {
    macd: snapshot14.indicators.macd,
    signal: snapshot14.indicators.macdSignal,
    histogram: snapshot14.indicators.macdHistogram
  };
  console.log(`      MACD: ${result.tests.macd.macd.toFixed(4)}`);

  // Test 5: Bollinger Bands
  console.log('  [5] Bollinger Bands...');
  result.tests.bb = {
    upper: snapshot14.indicators.bbUpper,
    middle: snapshot14.indicators.bbMiddle,
    lower: snapshot14.indicators.bbLower
  };
  console.log(`      BB: ${result.tests.bb.lower.toFixed(2)} - ${result.tests.bb.middle.toFixed(2)} - ${result.tests.bb.upper.toFixed(2)}`);

  // Save baseline
  const outPath = path.resolve(__dirname, 'baseline.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\n✅ Baseline saved to ${outPath}`);

  return result;
}

/**
 * Verify current output against saved baseline
 */
async function verifyBaseline() {
  const baselinePath = path.resolve(__dirname, 'baseline.json');

  if (!fs.existsSync(baselinePath)) {
    console.error('❌ No baseline found. Run: node test/regression/waterfall.js baseline');
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  console.log(`📊 Verifying against baseline from ${baseline.generated}\n`);

  let passed = 0;
  let failed = 0;
  const tolerance = 0.01; // 1% tolerance for floating point

  // Test 1: RSI-14
  console.log('  [1] RSI-14...');
  const snapshot14 = await runIndicators({ rsiPeriod: 14 });
  const rsi14Diff = Math.abs(snapshot14.indicators.rsi - baseline.tests.rsi14.rsi);
  if (rsi14Diff < tolerance) {
    console.log(`      ✅ PASS: RSI=${snapshot14.indicators.rsi.toFixed(2)} (baseline: ${baseline.tests.rsi14.rsi.toFixed(2)})`);
    passed++;
  } else {
    console.log(`      ❌ FAIL: RSI=${snapshot14.indicators.rsi.toFixed(2)} (baseline: ${baseline.tests.rsi14.rsi.toFixed(2)}, diff: ${rsi14Diff.toFixed(4)})`);
    failed++;
  }

  // Test 2: RSI-7
  console.log('  [2] RSI-7...');
  const snapshot7 = await runIndicators({ rsiPeriod: 7 });
  const rsi7Diff = Math.abs(snapshot7.indicators.rsi - baseline.tests.rsi7.rsi);
  if (rsi7Diff < tolerance) {
    console.log(`      ✅ PASS: RSI=${snapshot7.indicators.rsi.toFixed(2)} (baseline: ${baseline.tests.rsi7.rsi.toFixed(2)})`);
    passed++;
  } else {
    console.log(`      ❌ FAIL: RSI=${snapshot7.indicators.rsi.toFixed(2)} (baseline: ${baseline.tests.rsi7.rsi.toFixed(2)}, diff: ${rsi7Diff.toFixed(4)})`);
    failed++;
  }

  // Test 3: EMA
  console.log('  [3] EMA values...');
  const ema9Diff = Math.abs(snapshot14.indicators.ema9 - baseline.tests.ema.ema9);
  const ema20Diff = Math.abs(snapshot14.indicators.ema20 - baseline.tests.ema.ema20);
  if (ema9Diff < tolerance && ema20Diff < tolerance) {
    console.log(`      ✅ PASS: EMA9=${snapshot14.indicators.ema9.toFixed(2)}, EMA20=${snapshot14.indicators.ema20.toFixed(2)}`);
    passed++;
  } else {
    console.log(`      ❌ FAIL: EMA values differ (diff: ${ema9Diff.toFixed(4)}, ${ema20Diff.toFixed(4)})`);
    failed++;
  }

  // Test 4: MACD
  console.log('  [4] MACD...');
  const macdDiff = Math.abs(snapshot14.indicators.macd - baseline.tests.macd.macd);
  if (macdDiff < tolerance) {
    console.log(`      ✅ PASS: MACD=${snapshot14.indicators.macd.toFixed(4)}`);
    passed++;
  } else {
    console.log(`      ❌ FAIL: MACD=${snapshot14.indicators.macd.toFixed(4)} (baseline: ${baseline.tests.macd.macd.toFixed(4)})`);
    failed++;
  }

  // Test 5: Bollinger Bands
  console.log('  [5] Bollinger Bands...');
  const bbDiff = Math.abs(snapshot14.indicators.bbMiddle - baseline.tests.bb.middle);
  if (bbDiff < tolerance) {
    console.log(`      ✅ PASS: BB Middle=${snapshot14.indicators.bbMiddle.toFixed(2)}`);
    passed++;
  } else {
    console.log(`      ❌ FAIL: BB Middle=${snapshot14.indicators.bbMiddle.toFixed(2)} (baseline: ${baseline.tests.bb.middle.toFixed(2)})`);
    failed++;
  }

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 REGRESSION SUMMARY: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    console.log(`❌ ${failed} tests FAILED - regression detected!`);
    process.exit(1);
  } else {
    console.log(`✅ All tests PASSED - no regression detected`);
  }
}

/**
 * Entry point
 */
(async () => {
  const mode = process.argv[2];

  if (mode === 'baseline') {
    await generateBaseline();
  } else if (mode === 'verify') {
    await verifyBaseline();
  } else {
    console.log('Usage: node test/regression/waterfall.js <baseline|verify>');
    console.log('');
    console.log('  baseline  Generate baseline.json from current indicator output');
    console.log('  verify    Check current output against saved baseline');
    process.exit(1);
  }
})();
