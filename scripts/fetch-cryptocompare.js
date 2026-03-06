#!/usr/bin/env node
/**
 * Fetch Historical Candles from CryptoCompare
 * Supports pagination to get large datasets
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CC_BASE = 'https://min-api.cryptocompare.com/data/v2';

async function fetchCandles(options = {}) {
  const {
    symbol = 'BTC',
    currency = 'USD',
    interval = 'hour',    // 'minute', 'hour', 'day'
    totalCandles = 10000,
    outputFile = path.join(__dirname, '../data/cryptocompare-candles.json')
  } = options;

  const endpoint = interval === 'minute' ? 'histominute' :
                   interval === 'hour' ? 'histohour' : 'histoday';

  console.log('='.repeat(60));
  console.log('  CRYPTOCOMPARE HISTORICAL FETCHER');
  console.log('='.repeat(60));
  console.log(`  Symbol: ${symbol}/${currency}`);
  console.log(`  Interval: ${interval}`);
  console.log(`  Target: ${totalCandles.toLocaleString()} candles`);
  console.log('='.repeat(60));

  const allCandles = [];
  const limit = 2000;  // Max per request
  let toTs = Math.floor(Date.now() / 1000);  // Start from now
  let attempts = 0;
  const maxAttempts = Math.ceil(totalCandles / limit) + 5;

  while (allCandles.length < totalCandles && attempts < maxAttempts) {
    attempts++;
    process.stdout.write(`\r  Batch ${attempts}: ${allCandles.length.toLocaleString()} candles...`);

    try {
      const url = `${CC_BASE}/${endpoint}?fsym=${symbol}&tsym=${currency}&limit=${limit}&toTs=${toTs}`;
      const response = await axios.get(url, { timeout: 30000 });

      if (response.data.Response !== 'Success') {
        console.error(`\n  Error: ${response.data.Message}`);
        break;
      }

      const candles = response.data.Data.Data;
      if (!candles || candles.length === 0) {
        console.log('\n  No more data');
        break;
      }

      // Convert to our format
      const formatted = candles.map(c => ({
        timestamp: c.time * 1000,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volumefrom
      })).filter(c => c.open > 0);  // Skip empty candles

      // Add non-duplicates
      const existingTimes = new Set(allCandles.map(c => c.timestamp));
      const newCandles = formatted.filter(c => !existingTimes.has(c.timestamp));

      if (newCandles.length === 0) {
        console.log('\n  No new candles (hit end of history)');
        break;
      }

      allCandles.push(...newCandles);

      // Move toTs back for next batch
      toTs = Math.floor(candles[0].time) - 1;

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 300));

    } catch (error) {
      console.error(`\n  Error: ${error.message}`);
      if (error.response?.status === 429) {
        console.log('  Rate limited, waiting 10s...');
        await new Promise(r => setTimeout(r, 10000));
      } else {
        break;
      }
    }
  }

  // Sort oldest first
  allCandles.sort((a, b) => a.timestamp - b.timestamp);

  console.log(`\n\n  Total fetched: ${allCandles.length.toLocaleString()}`);

  if (allCandles.length > 0) {
    const startDate = new Date(allCandles[0].timestamp).toISOString().split('T')[0];
    const endDate = new Date(allCandles[allCandles.length - 1].timestamp).toISOString().split('T')[0];
    console.log(`  Date range: ${startDate} to ${endDate}`);

    fs.writeFileSync(outputFile, JSON.stringify(allCandles, null, 2));
    console.log(`  Saved to: ${outputFile}`);
  }

  return allCandles;
}

// CLI usage
if (require.main === module) {
  const interval = process.argv[2] || 'hour';
  const totalCandles = parseInt(process.argv[3]) || 10000;

  fetchCandles({ interval, totalCandles })
    .then(() => console.log('\n  Done!'))
    .catch(err => {
      console.error('  Error:', err.message);
      process.exit(1);
    });
}

module.exports = { fetchCandles };
