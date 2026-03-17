#!/usr/bin/env node
/**
 * Fetch historical stock data from Alpaca
 * Downloads 15-minute candles for 2 years
 * Uses paper/sandbox API keys
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.ALPACA_API_KEY;
const API_SECRET = process.env.ALPACA_API_SECRET;

if (!API_KEY || !API_SECRET) {
  console.error('❌ ALPACA_API_KEY and ALPACA_API_SECRET required in .env');
  process.exit(1);
}

const SYMBOLS = ['SPY', 'QQQ', 'TSLA'];
const OUTPUT_DIR = path.join(__dirname, '../tuning');

// Alpaca Sandbox Data API (for sandbox/broker keys)
const DATA_URL = 'https://data.sandbox.alpaca.markets/v2/stocks';

async function fetchBars(symbol, start, end, timeframe = '15Min') {
  const params = new URLSearchParams({
    start: start,
    end: end,
    timeframe: timeframe,
    limit: '10000',
    adjustment: 'split'
  });

  const url = `${DATA_URL}/${symbol}/bars?${params}`;

  const response = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': API_KEY,
      'APCA-API-SECRET-KEY': API_SECRET
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.bars || [];
}

async function fetchAllData(symbol, years = 2) {
  console.log(`📡 Fetching ${symbol} (15m, ${years} years)...`);

  const allBars = [];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - years);

  let currentStart = new Date(startDate);

  // Fetch in monthly chunks
  while (currentStart < endDate) {
    const chunkEnd = new Date(currentStart);
    chunkEnd.setMonth(chunkEnd.getMonth() + 1);
    if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());

    const startStr = currentStart.toISOString();
    const endStr = chunkEnd.toISOString();

    try {
      const bars = await fetchBars(symbol, startStr, endStr, '15Min');
      allBars.push(...bars);

      process.stdout.write(`\r   ${currentStart.toISOString().split('T')[0]} → ${chunkEnd.toISOString().split('T')[0]}: +${bars.length} (total: ${allBars.length})`);

      // Rate limit
      await new Promise(r => setTimeout(r, 200));
    } catch (error) {
      console.error(`\n   ❌ Error: ${error.message}`);
    }

    currentStart = new Date(chunkEnd);
  }

  console.log();
  return allBars;
}

function convertFormat(bars) {
  // Alpaca: { t, o, h, l, c, v, n, vw }
  // Our format: { t, o, h, l, c, v }
  return bars.map(b => ({
    t: new Date(b.t).getTime(),
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
    v: b.v
  }));
}

async function main() {
  console.log('🚀 Alpaca Stock Data Fetcher');
  console.log('============================');
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Interval: 15m, Range: 2 years`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const symbol of SYMBOLS) {
    try {
      const rawBars = await fetchAllData(symbol, 2);

      if (rawBars.length === 0) {
        console.log(`⚠️ No data for ${symbol}\n`);
        continue;
      }

      const candles = convertFormat(rawBars);

      const filename = `${symbol.toLowerCase()}-15m-2y.json`;
      const filepath = path.join(OUTPUT_DIR, filename);

      fs.writeFileSync(filepath, JSON.stringify(candles));

      const firstDate = new Date(candles[0].t).toISOString().split('T')[0];
      const lastDate = new Date(candles[candles.length - 1].t).toISOString().split('T')[0];
      const priceChange = ((candles[candles.length - 1].c / candles[0].o - 1) * 100).toFixed(2);

      console.log(`✅ ${symbol}: ${candles.length} candles (${firstDate} to ${lastDate})`);
      console.log(`   📈 $${candles[0].o.toFixed(2)} → $${candles[candles.length - 1].c.toFixed(2)} (${priceChange}%)`);
      console.log(`   💾 ${filepath}\n`);

    } catch (error) {
      console.error(`❌ Failed ${symbol}: ${error.message}\n`);
    }
  }

  console.log('Done!');
}

main().catch(console.error);
