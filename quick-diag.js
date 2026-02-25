/**
 * Quick diagnostic for MADynamicSR - find the bottleneck
 */

const MADynamicSR = require('./modules/MADynamicSR');
const candles = require('./data/btc-15m-2024-2025.json');

// Use 5000 candles for quick test
const testCandles = candles.slice(0, 5000);

console.log(`Testing MADynamicSR on ${testCandles.length} candles...`);

const strategy = new MADynamicSR({
  touchZonePct: 0.6,
  srZonePct: 1.0
});

// Run through all candles
for (let i = 220; i < testCandles.length; i++) {
  const candle = testCandles[i];
  const history = testCandles.slice(0, i + 1);
  const signal = strategy.update(candle, history);

  // Log when we get a signal
  if (signal.direction !== 'neutral') {
    console.log(`Signal @ bar ${i}: ${signal.direction} - ${signal.reason}`);
  }
}

// Print diagnostics
strategy.printDiagnostics();

// Also show which conditions are most/least frequent
const d = strategy.diag;
console.log('\n===== BOTTLENECK ANALYSIS =====');
console.log('Bars with each condition TRUE:');
console.log(`  Trend bullish:    ${(d.trendBullish / strategy.barCount * 100).toFixed(1)}%`);
console.log(`  Trend bearish:    ${(d.trendBearish / strategy.barCount * 100).toFixed(1)}%`);
console.log(`  Pattern uptrend:  ${(d.patternUptrend / strategy.barCount * 100).toFixed(1)}%`);
console.log(`  Pattern downtrend:${(d.patternDowntrend / strategy.barCount * 100).toFixed(1)}%`);
console.log(`  EMA touch:        ${(d.emaTouches / strategy.barCount * 100).toFixed(1)}%`);
console.log(`  S/R aligned:      ${(d.srAligned / strategy.barCount * 100).toFixed(1)}%`);
console.log(`  Confirm bullish:  ${(d.confirmBullish / strategy.barCount * 100).toFixed(1)}%`);
console.log(`  Confirm bearish:  ${(d.confirmBearish / strategy.barCount * 100).toFixed(1)}%`);
console.log('================================');
