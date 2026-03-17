#!/usr/bin/env node
/**
 * Fetch historical stock data from Polygon.io
 * Downloads 1-minute candles for SPY, QQQ, etc.
 * Outputs in same format as crypto backtester data
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');

const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
if (!POLYGON_API_KEY) {
  console.error('❌ POLYGON_API_KEY not set in .env');
  process.exit(1);
}

// Config
const SYMBOLS = ['SPY', 'QQQ', 'IWM'];
const TIMEFRAME = '1';  // 1 minute
const TIMEFRAME_UNIT = 'minute';

// Polygon free tier: 5 calls/min, but paid tier is much higher
const RATE_LIMIT_MS = 250;  // 4 calls/sec for paid tier

async function fetchCandles(symbol, from, to) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/${TIMEFRAME}/${TIMEFRAME_UNIT}/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${POLYGON_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status === 'ERROR') {
    throw new Error(data.error || 'Unknown error');
  }

  return data.results || [];
}

async function fetchAllData(symbol, startDate, endDate) {
  console.log(`\n📊 Fetching ${symbol} from ${startDate} to ${endDate}...`);

  const allCandles = [];
  let currentStart = new Date(startDate);
  const end = new Date(endDate);

  // Fetch in 7-day chunks (Polygon limit per request)
  while (currentStart < end) {
    const chunkEnd = new Date(currentStart);
    chunkEnd.setDate(chunkEnd.getDate() + 7);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    const fromStr = currentStart.toISOString().split('T')[0];
    const toStr = chunkEnd.toISOString().split('T')[0];

    try {
      const candles = await fetchCandles(symbol, fromStr, toStr);
      allCandles.push(...candles);

      process.stdout.write(`\r  ✅ ${fromStr} - ${toStr}: ${candles.length} candles (total: ${allCandles.length})`);

      // Rate limit
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    } catch (error) {
      console.error(`\n  ❌ Error fetching ${fromStr}: ${error.message}`);
    }

    currentStart = new Date(chunkEnd);
    currentStart.setDate(currentStart.getDate() + 1);
  }

  console.log(`\n  📈 Total: ${allCandles.length} candles for ${symbol}`);
  return allCandles;
}

function convertToBacktestFormat(candles, symbol) {
  // Convert Polygon format to our backtest format
  // Polygon: { v, vw, o, c, h, l, t, n }
  // Our format: { t, o, h, l, c, v }
  return candles.map(c => ({
    t: c.t,           // Unix timestamp (ms)
    o: c.o,           // Open
    h: c.h,           // High
    l: c.l,           // Low
    c: c.c,           // Close
    v: c.v,           // Volume
    symbol: symbol    // Add symbol for multi-asset support
  }));
}

async function main() {
  console.log('🚀 Stock Data Fetcher');
  console.log('=====================');
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Timeframe: ${TIMEFRAME}${TIMEFRAME_UNIT}`);

  // Fetch 2 years of data
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 2);

  console.log(`Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

  const outputDir = path.join(__dirname, '../tuning');

  for (const symbol of SYMBOLS) {
    try {
      const rawCandles = await fetchAllData(symbol, startDate, endDate);

      if (rawCandles.length === 0) {
        console.log(`⚠️ No data for ${symbol}`);
        continue;
      }

      const candles = convertToBacktestFormat(rawCandles, symbol);

      // Save to file
      const filename = `${symbol.toLowerCase()}-2yr-1m.json`;
      const filepath = path.join(outputDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(candles, null, 2));
      console.log(`💾 Saved: ${filepath} (${candles.length} candles)`);

      // Also save stats
      const stats = {
        symbol,
        candles: candles.length,
        startDate: new Date(candles[0].t).toISOString(),
        endDate: new Date(candles[candles.length - 1].t).toISOString(),
        tradingDays: Math.ceil(candles.length / 390),  // ~390 1m candles per trading day
        firstPrice: candles[0].o,
        lastPrice: candles[candles.length - 1].c,
        priceChange: ((candles[candles.length - 1].c / candles[0].o - 1) * 100).toFixed(2) + '%'
      };
      console.log(`📊 ${symbol} Stats:`, stats);

    } catch (error) {
      console.error(`❌ Failed to fetch ${symbol}:`, error.message);
    }
  }

  console.log('\n✅ Done!');
}

main().catch(console.error);
