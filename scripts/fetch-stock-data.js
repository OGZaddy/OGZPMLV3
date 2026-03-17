#!/usr/bin/env node
/**
 * Fetch historical stock data from Yahoo Finance
 * Downloads 1-hour candles for 2 years (Yahoo max for intraday)
 * No API key needed
 */

const fs = require('fs');
const path = require('path');

const SYMBOLS = ['SPY', 'QQQ', 'TSLA'];
const OUTPUT_DIR = path.join(__dirname, '../tuning');

async function fetchYahoo(symbol, interval = '1h', range = '2y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;

  console.log(`📡 Fetching ${symbol} (${interval}, ${range})...`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.chart.error) {
    throw new Error(data.chart.error.description);
  }

  const result = data.chart.result[0];
  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0];

  if (!timestamps || timestamps.length === 0) {
    throw new Error('No data returned');
  }

  // Convert to our backtest format: {t, o, h, l, c, v}
  const candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.open[i] === null || quote.close[i] === null) continue;

    candles.push({
      t: timestamps[i] * 1000,
      o: quote.open[i],
      h: quote.high[i],
      l: quote.low[i],
      c: quote.close[i],
      v: quote.volume[i] || 0
    });
  }

  return candles;
}

async function main() {
  console.log('🚀 Yahoo Finance Stock Data Fetcher');
  console.log('====================================');
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Interval: 1h, Range: 2 years (Yahoo max for hourly)`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const symbol of SYMBOLS) {
    try {
      const candles = await fetchYahoo(symbol, '1h', '2y');

      if (candles.length === 0) {
        console.log(`⚠️ No data for ${symbol}`);
        continue;
      }

      const filename = `${symbol.toLowerCase()}-1h-2y.json`;
      const filepath = path.join(OUTPUT_DIR, filename);

      fs.writeFileSync(filepath, JSON.stringify(candles));

      const firstDate = new Date(candles[0].t).toISOString().split('T')[0];
      const lastDate = new Date(candles[candles.length - 1].t).toISOString().split('T')[0];
      const priceChange = ((candles[candles.length - 1].c / candles[0].o - 1) * 100).toFixed(2);

      console.log(`✅ ${symbol}: ${candles.length} candles (${firstDate} to ${lastDate})`);
      console.log(`   📈 $${candles[0].o.toFixed(2)} → $${candles[candles.length - 1].c.toFixed(2)} (${priceChange}%)`);
      console.log(`   💾 ${filepath}\n`);

      await new Promise(r => setTimeout(r, 1000));

    } catch (error) {
      console.error(`❌ Failed ${symbol}: ${error.message}\n`);
    }
  }

  console.log('Done!');
}

main().catch(console.error);
