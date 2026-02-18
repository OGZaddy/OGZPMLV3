#!/usr/bin/env node
/**
 * Calibration Measurement Script
 *
 * Runs through the 60k candle dataset and measures actual value distributions
 * from each module. Outputs statistics to set data-driven thresholds.
 *
 * Usage: node calibration-measure.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Load modules
const MarketRegimeDetector = require('./core/MarketRegimeDetector');
const MultiTimeframeAdapter = require('./modules/MultiTimeframeAdapter');
const EMASMACrossoverSignal = require('./modules/EMASMACrossoverSignal');
const MADynamicSR = require('./modules/MADynamicSR');
const LiquiditySweepDetector = require('./modules/LiquiditySweepDetector');

// Collectors for each metric
const collectors = {
  // MarketRegimeDetector
  volatility: [],
  trendStrength: [],
  trendDirection: [],
  volumeRatio: [],
  momentum: [],
  pricePosition: [],

  // MultiTimeframeAdapter
  mtfConfluenceScore: [],
  mtfConfidence: [],
  mtfBullishCount: [],
  mtfBearishCount: [],
  mtfRsiAverage: [],

  // EMASMACrossover
  emaCrossConfidence: [],
  emaCrossBullish: [],
  emaCrossBearish: [],

  // MADynamicSR
  maDynamicConfidence: [],
  maDynamicBullishScore: [],
  maDynamicBearishScore: [],

  // LiquiditySweep
  liqSweepDailyATR: [],
  liqSweepManipThreshold: [],
};

// Load historical data
function loadHistoricalData() {
  const dataDir = process.env.DATA_DIR || './data';
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));

  let allCandles = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
      if (Array.isArray(data)) {
        allCandles = allCandles.concat(data);
      } else if (data.candles) {
        allCandles = allCandles.concat(data.candles);
      }
    } catch (e) {
      // Skip invalid files
    }
  }

  // Sort by timestamp
  allCandles.sort((a, b) => (a.t || a.timestamp || 0) - (b.t || b.timestamp || 0));

  // Normalize format
  return allCandles.map(c => ({
    t: c.t || c.timestamp || c.time || 0,
    o: c.o ?? c.open ?? 0,
    h: c.h ?? c.high ?? 0,
    l: c.l ?? c.low ?? 0,
    c: c.c ?? c.close ?? 0,
    v: c.v ?? c.volume ?? 0,
  }));
}

// Calculate percentiles
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p / 100);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// Calculate statistics
function calcStats(arr, name) {
  if (arr.length === 0) {
    return { name, count: 0, error: 'No data' };
  }

  const validArr = arr.filter(x => x !== null && x !== undefined && !isNaN(x));
  if (validArr.length === 0) {
    return { name, count: arr.length, error: 'All values null/NaN' };
  }

  const sorted = [...validArr].sort((a, b) => a - b);
  const sum = validArr.reduce((a, b) => a + b, 0);

  return {
    name,
    count: validArr.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / validArr.length,
    p10: percentile(validArr, 10),
    p25: percentile(validArr, 25),
    p50: percentile(validArr, 50),
    p75: percentile(validArr, 75),
    p90: percentile(validArr, 90),
    p95: percentile(validArr, 95),
    p99: percentile(validArr, 99),
  };
}

async function main() {
  console.log('='.repeat(70));
  console.log('CALIBRATION MEASUREMENT - Analyzing 60k candle dataset');
  console.log('='.repeat(70));

  // Load data
  console.log('\nLoading historical data...');
  const candles = loadHistoricalData();
  console.log(`Loaded ${candles.length} candles`);

  if (candles.length < 100) {
    console.error('Not enough candles for calibration');
    process.exit(1);
  }

  // Initialize modules
  const regimeDetector = new MarketRegimeDetector();
  const mtfAdapter = new MultiTimeframeAdapter({ activeTimeframes: ['1m', '5m', '15m', '1h'] });
  const emaCrossover = new EMASMACrossoverSignal();
  const maDynamicSR = new MADynamicSR();
  const liqSweep = new LiquiditySweepDetector({ sessionOpenHour: 14, sessionOpenMinute: 30 });

  // Process candles
  console.log('\nProcessing candles...');
  const priceHistory = [];
  let processed = 0;

  for (const candle of candles) {
    priceHistory.push(candle);
    if (priceHistory.length > 500) priceHistory.shift(); // Keep bounded

    // Only measure after warmup
    if (priceHistory.length < 100) continue;

    // MarketRegimeDetector
    try {
      const regime = regimeDetector.analyzeMarket(priceHistory, {});
      if (regimeDetector.metrics) {
        collectors.volatility.push(regimeDetector.metrics.volatility);
        collectors.trendStrength.push(regimeDetector.metrics.trendStrength);
        collectors.trendDirection.push(regimeDetector.metrics.trendDirection);
        collectors.volumeRatio.push(regimeDetector.metrics.volumeRatio);
        collectors.momentum.push(regimeDetector.metrics.momentum);
        collectors.pricePosition.push(regimeDetector.metrics.pricePosition);
      }
    } catch (e) {}

    // MultiTimeframeAdapter
    try {
      mtfAdapter.ingestCandle(candle);
      if (mtfAdapter.readyTimeframes.size > 0) {
        const confluence = mtfAdapter.getConfluenceScore();
        collectors.mtfConfluenceScore.push(confluence.confluenceScore);
        collectors.mtfConfidence.push(confluence.confidence);
        collectors.mtfBullishCount.push(confluence.bullishCount);
        collectors.mtfBearishCount.push(confluence.bearishCount);
        collectors.mtfRsiAverage.push(confluence.rsiAverage);
      }
    } catch (e) {}

    // EMASMACrossover
    try {
      const emaSignal = emaCrossover.update(candle, priceHistory);
      if (emaSignal) {
        collectors.emaCrossConfidence.push(emaSignal.confidence);
        collectors.emaCrossBullish.push(emaSignal.activeBullish);
        collectors.emaCrossBearish.push(emaSignal.activeBearish);
      }
    } catch (e) {}

    // MADynamicSR
    try {
      const maSignal = maDynamicSR.update(candle, priceHistory);
      if (maSignal) {
        collectors.maDynamicConfidence.push(maSignal.confidence);
        collectors.maDynamicBullishScore.push(maSignal.bullishScore);
        collectors.maDynamicBearishScore.push(maSignal.bearishScore);
      }
    } catch (e) {}

    // LiquiditySweep
    try {
      const liqSignal = liqSweep.feedCandle(candle);
      if (liqSweep.state.dailyATR) {
        collectors.liqSweepDailyATR.push(liqSweep.state.dailyATR);
      }
      if (liqSweep.state.manipThreshold) {
        collectors.liqSweepManipThreshold.push(liqSweep.state.manipThreshold);
      }
    } catch (e) {}

    processed++;
    if (processed % 10000 === 0) {
      console.log(`  Processed ${processed} candles...`);
    }
  }

  console.log(`\nProcessed ${processed} candles total`);

  // Output statistics
  console.log('\n' + '='.repeat(70));
  console.log('CALIBRATION RESULTS');
  console.log('='.repeat(70));

  const results = {};

  console.log('\n--- MarketRegimeDetector ---');
  for (const key of ['volatility', 'trendStrength', 'trendDirection', 'volumeRatio', 'momentum', 'pricePosition']) {
    const stats = calcStats(collectors[key], key);
    results[key] = stats;
    if (stats.error) {
      console.log(`  ${key}: ${stats.error}`);
    } else {
      console.log(`  ${key}:`);
      console.log(`    range: ${stats.min.toFixed(4)} - ${stats.max.toFixed(4)}`);
      console.log(`    mean: ${stats.mean.toFixed(4)}, median: ${stats.p50.toFixed(4)}`);
      console.log(`    p10: ${stats.p10.toFixed(4)}, p90: ${stats.p90.toFixed(4)}`);
    }
  }

  console.log('\n--- MultiTimeframeAdapter ---');
  for (const key of ['mtfConfluenceScore', 'mtfConfidence', 'mtfBullishCount', 'mtfBearishCount', 'mtfRsiAverage']) {
    const stats = calcStats(collectors[key], key);
    results[key] = stats;
    if (stats.error) {
      console.log(`  ${key}: ${stats.error}`);
    } else {
      console.log(`  ${key}:`);
      console.log(`    range: ${stats.min.toFixed(4)} - ${stats.max.toFixed(4)}`);
      console.log(`    mean: ${stats.mean.toFixed(4)}, median: ${stats.p50.toFixed(4)}`);
      console.log(`    p10: ${stats.p10.toFixed(4)}, p90: ${stats.p90.toFixed(4)}`);
    }
  }

  console.log('\n--- EMASMACrossover ---');
  for (const key of ['emaCrossConfidence', 'emaCrossBullish', 'emaCrossBearish']) {
    const stats = calcStats(collectors[key], key);
    results[key] = stats;
    if (stats.error) {
      console.log(`  ${key}: ${stats.error}`);
    } else {
      console.log(`  ${key}:`);
      console.log(`    range: ${stats.min.toFixed(4)} - ${stats.max.toFixed(4)}`);
      console.log(`    mean: ${stats.mean.toFixed(4)}, median: ${stats.p50.toFixed(4)}`);
      console.log(`    p10: ${stats.p10.toFixed(4)}, p90: ${stats.p90.toFixed(4)}`);
    }
  }

  console.log('\n--- MADynamicSR ---');
  for (const key of ['maDynamicConfidence', 'maDynamicBullishScore', 'maDynamicBearishScore']) {
    const stats = calcStats(collectors[key], key);
    results[key] = stats;
    if (stats.error) {
      console.log(`  ${key}: ${stats.error}`);
    } else {
      console.log(`  ${key}:`);
      console.log(`    range: ${stats.min.toFixed(4)} - ${stats.max.toFixed(4)}`);
      console.log(`    mean: ${stats.mean.toFixed(4)}, median: ${stats.p50.toFixed(4)}`);
      console.log(`    p10: ${stats.p10.toFixed(4)}, p90: ${stats.p90.toFixed(4)}`);
    }
  }

  console.log('\n--- LiquiditySweep ---');
  for (const key of ['liqSweepDailyATR', 'liqSweepManipThreshold']) {
    const stats = calcStats(collectors[key], key);
    results[key] = stats;
    if (stats.error) {
      console.log(`  ${key}: ${stats.error}`);
    } else {
      console.log(`  ${key}:`);
      console.log(`    range: ${stats.min.toFixed(4)} - ${stats.max.toFixed(4)}`);
      console.log(`    mean: ${stats.mean.toFixed(4)}, median: ${stats.p50.toFixed(4)}`);
      console.log(`    p10: ${stats.p10.toFixed(4)}, p90: ${stats.p90.toFixed(4)}`);
    }
  }

  // Output recommended thresholds
  console.log('\n' + '='.repeat(70));
  console.log('RECOMMENDED THRESHOLD CALIBRATIONS');
  console.log('='.repeat(70));

  if (results.volatility && !results.volatility.error) {
    console.log(`\nMarketRegimeDetector.lowVolThreshold:`);
    console.log(`  Current: 0.1 (already fixed from 0.5)`);
    console.log(`  Measured p10: ${results.volatility.p10.toFixed(4)}`);
    console.log(`  Recommended: ${(results.volatility.p10 * 0.8).toFixed(4)} (80% of p10 for "quiet")`);
  }

  if (results.mtfConfluenceScore && !results.mtfConfluenceScore.error) {
    console.log(`\nMultiTimeframeAdapter.shouldTrade score threshold:`);
    console.log(`  Current: 0.15`);
    console.log(`  Measured p75: ${results.mtfConfluenceScore.p75.toFixed(4)}`);
    console.log(`  Measured p90: ${results.mtfConfluenceScore.p90.toFixed(4)}`);
    console.log(`  Recommended: ${(results.mtfConfluenceScore.p75).toFixed(4)} (p75 for meaningful signals)`);
  }

  if (results.emaCrossConfidence && !results.emaCrossConfidence.error) {
    console.log(`\nEMASMACrossover detection threshold:`);
    console.log(`  Current: 0.03`);
    console.log(`  Measured p75: ${results.emaCrossConfidence.p75.toFixed(4)}`);
    console.log(`  Measured p90: ${results.emaCrossConfidence.p90.toFixed(4)}`);
    console.log(`  Recommended: ${(results.emaCrossConfidence.p75).toFixed(4)} (p75 for quality signals)`);
  }

  if (results.maDynamicConfidence && !results.maDynamicConfidence.error) {
    console.log(`\nMADynamicSR detection threshold:`);
    console.log(`  Current: 0.03`);
    console.log(`  Measured p75: ${results.maDynamicConfidence.p75.toFixed(4)}`);
    console.log(`  Measured p90: ${results.maDynamicConfidence.p90.toFixed(4)}`);
    console.log(`  Recommended: ${(results.maDynamicConfidence.p75).toFixed(4)} (p75 for quality signals)`);
  }

  // Save results to file
  const outputPath = '/tmp/calibration-results.json';
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nFull results saved to: ${outputPath}`);
}

main().catch(console.error);
