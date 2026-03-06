#!/usr/bin/env node
/**
 * Candle Interpolator
 * Expands larger timeframe candles into smaller synthetic candles
 * e.g., 1-hour → 5-min (12 candles per hour)
 *
 * Uses constrained random walk to generate plausible price paths
 * that respect OHLC values of the source candle
 */

const fs = require('fs');
const path = require('path');

/**
 * Interpolate a single candle into multiple smaller candles
 * @param {Object} candle - Source candle {timestamp, open, high, low, close, volume}
 * @param {number} divisions - How many smaller candles to create
 * @returns {Array} Array of interpolated candles
 */
function interpolateCandle(candle, divisions) {
  const { timestamp, open, high, low, close, volume } = candle;
  const intervalMs = (divisions > 1) ? Math.floor((getNextTimestamp(candle, divisions) - timestamp) / divisions) : 60000;

  const result = [];
  const priceRange = high - low;

  // Generate a plausible path from open to close that hits high and low
  const path = generatePricePath(open, high, low, close, divisions);

  // Distribute volume across candles (more volume near high/low)
  const volumePerCandle = volume / divisions;

  for (let i = 0; i < divisions; i++) {
    const candleOpen = path[i];
    const candleClose = path[i + 1];

    // Local high/low with some randomness
    const localHigh = Math.max(candleOpen, candleClose) + Math.random() * priceRange * 0.02;
    const localLow = Math.min(candleOpen, candleClose) - Math.random() * priceRange * 0.02;

    // Constrain to parent candle's high/low
    const constrainedHigh = Math.min(localHigh, high);
    const constrainedLow = Math.max(localLow, low);

    result.push({
      timestamp: timestamp + (i * intervalMs),
      open: candleOpen,
      high: constrainedHigh,
      low: constrainedLow,
      close: candleClose,
      volume: volumePerCandle * (0.8 + Math.random() * 0.4) // Vary volume ±20%
    });
  }

  return result;
}

/**
 * Generate a price path that starts at open, ends at close,
 * and touches high and low at some point
 */
function generatePricePath(open, high, low, close, steps) {
  const path = [open];

  // Decide when to hit high and low (random positions)
  const highPos = Math.floor(Math.random() * (steps - 2)) + 1;
  let lowPos = Math.floor(Math.random() * (steps - 2)) + 1;

  // Make sure high and low aren't at same position
  while (lowPos === highPos) {
    lowPos = Math.floor(Math.random() * (steps - 2)) + 1;
  }

  // Create key points
  const keyPoints = {};
  keyPoints[0] = open;
  keyPoints[highPos] = high;
  keyPoints[lowPos] = low;
  keyPoints[steps] = close;

  // Sort key point indices
  const sortedIndices = Object.keys(keyPoints).map(Number).sort((a, b) => a - b);

  // Interpolate between key points with some noise
  for (let i = 1; i <= steps; i++) {
    if (keyPoints[i] !== undefined) {
      path.push(keyPoints[i]);
    } else {
      // Find surrounding key points
      let prevIdx = 0, nextIdx = steps;
      for (const idx of sortedIndices) {
        if (idx < i) prevIdx = idx;
        if (idx > i && nextIdx === steps) nextIdx = idx;
      }

      // Linear interpolation with noise
      const prevVal = keyPoints[prevIdx];
      const nextVal = keyPoints[nextIdx];
      const progress = (i - prevIdx) / (nextIdx - prevIdx);
      const baseVal = prevVal + (nextVal - prevVal) * progress;

      // Add small random noise (constrained to high/low)
      const noise = (Math.random() - 0.5) * (high - low) * 0.1;
      const noisyVal = Math.max(low, Math.min(high, baseVal + noise));

      path.push(noisyVal);
    }
  }

  return path;
}

function getNextTimestamp(candle, divisions) {
  // Assume hourly candles = 3600000ms
  return candle.timestamp + 3600000;
}

/**
 * Expand an entire dataset of candles
 * @param {Array} candles - Source candles
 * @param {string} sourceInterval - Source interval ('1h', '4h', '1d')
 * @param {string} targetInterval - Target interval ('5m', '1m', '15m')
 */
function expandDataset(candles, sourceInterval = '1h', targetInterval = '5m') {
  const intervalMap = {
    '1m': 60000,
    '5m': 300000,
    '15m': 900000,
    '30m': 1800000,
    '1h': 3600000,
    '4h': 14400000,
    '1d': 86400000
  };

  const sourceMs = intervalMap[sourceInterval];
  const targetMs = intervalMap[targetInterval];

  if (targetMs >= sourceMs) {
    throw new Error(`Target interval (${targetInterval}) must be smaller than source (${sourceInterval})`);
  }

  const divisions = sourceMs / targetMs;
  console.log(`Expanding ${candles.length} ${sourceInterval} candles → ${targetInterval} (${divisions}x)`);

  const expanded = [];

  for (let i = 0; i < candles.length; i++) {
    if (i % 1000 === 0) {
      process.stdout.write(`\r  Processing: ${i}/${candles.length} (${((i/candles.length)*100).toFixed(1)}%)`);
    }

    const interpolated = interpolateCandle(candles[i], divisions);
    expanded.push(...interpolated);
  }

  console.log(`\n  Generated ${expanded.length.toLocaleString()} synthetic candles`);
  return expanded;
}

// CLI
if (require.main === module) {
  const inputFile = process.argv[2] || path.join(__dirname, '../data/cryptocompare-candles.json');
  const sourceInterval = process.argv[3] || '1h';
  const targetInterval = process.argv[4] || '5m';
  const outputFile = process.argv[5] || path.join(__dirname, `../data/synthetic-${targetInterval}-candles.json`);

  console.log('='.repeat(60));
  console.log('  CANDLE INTERPOLATOR');
  console.log('='.repeat(60));
  console.log(`  Input: ${inputFile}`);
  console.log(`  Source: ${sourceInterval} → Target: ${targetInterval}`);
  console.log('='.repeat(60));

  const candles = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  console.log(`  Loaded ${candles.length.toLocaleString()} source candles`);

  const startDate = new Date(candles[0].timestamp).toISOString().split('T')[0];
  const endDate = new Date(candles[candles.length-1].timestamp).toISOString().split('T')[0];
  console.log(`  Date range: ${startDate} to ${endDate}`);

  const expanded = expandDataset(candles, sourceInterval, targetInterval);

  fs.writeFileSync(outputFile, JSON.stringify(expanded));
  console.log(`  Saved to: ${outputFile}`);

  const fileSizeMB = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(2);
  console.log(`  File size: ${fileSizeMB} MB`);
  console.log('\n  Done!');
}

module.exports = { interpolateCandle, expandDataset };
