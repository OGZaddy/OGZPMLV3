#!/usr/bin/env node
/**
 * Fetch BTC/USD 15m candles from Alpaca (FREE - no API keys needed)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

async function fetchAlpacaData() {
  const allCandles = [];
  const startDate = new Date('2024-02-25');
  const endDate = new Date('2025-02-25');

  let currentStart = new Date(startDate);
  let pageToken = null;
  let batchNum = 0;

  console.log('=== Alpaca BTC/USD 15m Data Fetcher ===');
  console.log('Fetching: ' + startDate.toISOString().split('T')[0] + ' -> ' + endDate.toISOString().split('T')[0]);

  while (currentStart < endDate) {
    batchNum++;
    const batchEnd = new Date(Math.min(currentStart.getTime() + (30 * 24 * 60 * 60 * 1000), endDate.getTime()));

    let url = 'https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=BTC/USD&timeframe=15Min&start=' +
              currentStart.toISOString() + '&end=' + batchEnd.toISOString() + '&limit=10000';
    if (pageToken) url += '&page_token=' + pageToken;

    process.stdout.write('\rBatch ' + batchNum + ': ' + currentStart.toISOString().split('T')[0] + ' (' + allCandles.length + ' candles)');

    try {
      const data = await new Promise((resolve, reject) => {
        https.get(url, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch(e) { reject(e); }
          });
        }).on('error', reject);
      });

      if (data.bars && data.bars['BTC/USD']) {
        const bars = data.bars['BTC/USD'];
        bars.forEach(bar => {
          allCandles.push({
            t: new Date(bar.t).getTime(),
            o: bar.o,
            h: bar.h,
            l: bar.l,
            c: bar.c,
            v: bar.v
          });
        });

        if (data.next_page_token) {
          pageToken = data.next_page_token;
        } else {
          pageToken = null;
          currentStart = batchEnd;
        }
      } else {
        currentStart = batchEnd;
        pageToken = null;
      }

      await new Promise(r => setTimeout(r, 250));

    } catch (err) {
      console.error('\nError: ' + err.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  allCandles.sort((a,b) => a.t - b.t);
  const unique = allCandles.filter((c, i, arr) => i === 0 || c.t !== arr[i-1].t);

  console.log('\n\nTotal candles: ' + unique.length);
  console.log('Date range: ' + new Date(unique[0].t).toISOString() + ' -> ' + new Date(unique[unique.length-1].t).toISOString());

  const highs = unique.map(c => c.h);
  const lows = unique.map(c => c.l);
  console.log('Price range: $' + Math.min(...lows).toFixed(0) + ' - $' + Math.max(...highs).toFixed(0));
  console.log('Net change: $' + unique[0].o.toFixed(0) + ' -> $' + unique[unique.length-1].c.toFixed(0));

  const outFile = path.join(__dirname, '../data/alpaca-btc-15m-1y.json');
  fs.writeFileSync(outFile, JSON.stringify(unique, null, 2));
  console.log('Saved to: ' + outFile);
}

fetchAlpacaData().catch(console.error);
