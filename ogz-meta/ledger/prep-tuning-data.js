#!/usr/bin/env node
/**
 * OGZPrime Tuning Data Prep
 * 
 * Takes raw 15-min candle datasets, segments them by market regime,
 * generates fingerprints for reproducibility, and outputs ready-to-use
 * tuning segments.
 * 
 * Usage: node prep-tuning-data.js
 */

'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const UPLOADS = '/mnt/user-data/uploads';
const OUTPUT = '/home/claude/tuning';

// ── HELPERS ─────────────────────────────────────────────────────────────────

function hash(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

function loadCandles(filename) {
  const raw = fs.readFileSync(path.join(UPLOADS, filename), 'utf8');
  const d = JSON.parse(raw);
  const arr = Array.isArray(d) ? d : (d.candles || d.data || []);
  // Normalize to { t, o, h, l, c, v } format
  return arr.map(c => ({
    t: c.t || c.timestamp,
    o: c.o || c.open,
    h: c.h || c.high,
    l: c.l || c.low,
    c: c.c || c.close,
    v: c.v || c.volume || 0,
  }));
}

function detectRegime(candles, windowSize = 96) {
  // 96 candles = 24 hours on 15-min
  // Returns: 'uptrend', 'downtrend', 'range', 'volatile'
  if (candles.length < windowSize) return 'unknown';

  const closes = candles.slice(-windowSize).map(c => c.c);
  const first = closes[0], last = closes[closes.length - 1];
  const returnPct = ((last - first) / first) * 100;

  // Volatility: average absolute candle-to-candle % change
  let totalAbsChange = 0;
  for (let i = 1; i < closes.length; i++) {
    totalAbsChange += Math.abs((closes[i] - closes[i-1]) / closes[i-1] * 100);
  }
  const avgVolatility = totalAbsChange / (closes.length - 1);

  // High volatility = > 0.3% avg move per 15-min candle
  const isVolatile = avgVolatility > 0.3;

  if (isVolatile && Math.abs(returnPct) < 2) return 'volatile_chop';
  if (returnPct > 3) return 'uptrend';
  if (returnPct < -3) return 'downtrend';
  if (isVolatile) return 'volatile_trend';
  return 'range';
}

function segmentByRegime(candles, segmentSize = 2000) {
  const segments = [];
  for (let i = 0; i + segmentSize <= candles.length; i += segmentSize) {
    const seg = candles.slice(i, i + segmentSize);
    const regime = detectRegime(seg);
    const startDate = new Date(seg[0].t).toISOString().slice(0, 10);
    const endDate = new Date(seg[seg.length - 1].t).toISOString().slice(0, 10);
    const startPrice = seg[0].c;
    const endPrice = seg[seg.length - 1].c;
    const returnPct = ((endPrice - startPrice) / startPrice * 100).toFixed(2);

    // Max drawdown within segment
    let peak = seg[0].c, maxDD = 0;
    for (const c of seg) {
      peak = Math.max(peak, c.c);
      maxDD = Math.max(maxDD, (peak - c.c) / peak * 100);
    }

    segments.push({
      id: `seg_${segments.length + 1}`,
      regime,
      candles: seg,
      meta: {
        startDate, endDate, startPrice, endPrice,
        returnPct: parseFloat(returnPct),
        maxDrawdown: parseFloat(maxDD.toFixed(2)),
        candleCount: seg.length,
        dataHash: hash(seg),
      }
    });
  }
  return segments;
}

// ── MAIN ────────────────────────────────────────────────────────────────────

console.log('=== OGZPrime Tuning Data Prep ===\n');

// Load the big dataset
console.log('Loading btc-15m-2024-2025.json (45,812 candles)...');
const fullData = loadCandles('btc-15m-2024-2025.json');
console.log(`  Loaded: ${fullData.length} candles`);
console.log(`  Range: ${new Date(fullData[0].t).toISOString().slice(0,10)} to ${new Date(fullData[fullData.length-1].t).toISOString().slice(0,10)}`);
console.log(`  Price: $${fullData[0].c.toFixed(0)} to $${fullData[fullData.length-1].c.toFixed(0)}\n`);

// Also load 2023 data for out-of-sample validation
console.log('Loading polygon-btc-1y-15min.json (4,000 candles, 2023)...');
const data2023 = loadCandles('polygon-btc-1y-15min.json');
console.log(`  Loaded: ${data2023.length} candles`);
console.log(`  Range: ${new Date(data2023[0].t).toISOString().slice(0,10)} to ${new Date(data2023[data2023.length-1].t).toISOString().slice(0,10)}`);
console.log(`  Price: $${data2023[0].c.toFixed(0)} to $${data2023[data2023.length-1].c.toFixed(0)}\n`);

// Segment main dataset
console.log('Segmenting into 2000-candle chunks (~21 days each)...\n');
const segments = segmentByRegime(fullData, 2000);

console.log('SEGMENTS:');
console.log('─'.repeat(100));
console.log('ID       | Regime          | Date Range                | Price        | Return  | MaxDD   | Hash');
console.log('─'.repeat(100));

const regimeCounts = {};
for (const seg of segments) {
  regimeCounts[seg.regime] = (regimeCounts[seg.regime] || 0) + 1;
  console.log(
    `${seg.id.padEnd(9)}| ${seg.regime.padEnd(16)}| ${seg.meta.startDate} to ${seg.meta.endDate} | $${seg.meta.startPrice.toFixed(0).padStart(6)} → $${seg.meta.endPrice.toFixed(0).padStart(6)} | ${(seg.meta.returnPct >= 0 ? '+' : '') + seg.meta.returnPct.toFixed(1).padStart(6)}% | ${seg.meta.maxDrawdown.toFixed(1).padStart(5)}% | ${seg.meta.dataHash}`
  );
}

console.log('─'.repeat(100));
console.log('\nRegime distribution:');
for (const [regime, count] of Object.entries(regimeCounts).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${regime}: ${count} segments`);
}

// Pick 3 diverse segments for cross-validation tuning
// Goal: 1 uptrend, 1 downtrend/range, 1 volatile
const tuningSet = [];
const regimePriority = ['uptrend', 'downtrend', 'range', 'volatile_chop', 'volatile_trend'];
const usedRegimes = new Set();

for (const targetRegime of regimePriority) {
  if (tuningSet.length >= 3) break;
  const candidate = segments.find(s => s.regime === targetRegime && !usedRegimes.has(s.id));
  if (candidate) {
    tuningSet.push(candidate);
    usedRegimes.add(candidate.id);
  }
}

// If we still need more, grab any remaining
while (tuningSet.length < 3 && segments.length > tuningSet.length) {
  const next = segments.find(s => !usedRegimes.has(s.id));
  if (!next) break;
  tuningSet.push(next);
  usedRegimes.add(next.id);
}

console.log('\n=== SELECTED TUNING SET (3 diverse regimes) ===\n');
for (const seg of tuningSet) {
  console.log(`  ${seg.id} [${seg.regime}]: ${seg.meta.startDate} to ${seg.meta.endDate}, $${seg.meta.startPrice.toFixed(0)}→$${seg.meta.endPrice.toFixed(0)} (${seg.meta.returnPct > 0 ? '+' : ''}${seg.meta.returnPct}%)`);
}

// Save segments
for (const seg of segments) {
  const outPath = path.join(OUTPUT, `${seg.id}_${seg.regime}.json`);
  fs.writeFileSync(outPath, JSON.stringify(seg.candles));
  // Save metadata separately
  const metaPath = path.join(OUTPUT, `${seg.id}_${seg.regime}.meta.json`);
  fs.writeFileSync(metaPath, JSON.stringify(seg.meta, null, 2));
}

// Save tuning set index
const tuningIndex = {
  created: new Date().toISOString(),
  dataSource: 'btc-15m-2024-2025.json',
  dataHash: hash(fullData),
  totalCandles: fullData.length,
  segmentSize: 2000,
  segments: segments.map(s => ({ id: s.id, regime: s.regime, ...s.meta })),
  tuningSet: tuningSet.map(s => s.id),
  validationSet: 'polygon-btc-1y-15min.json (2023, out-of-sample)',
  validationHash: hash(data2023),
};

fs.writeFileSync(path.join(OUTPUT, 'tuning-index.json'), JSON.stringify(tuningIndex, null, 2));

// Save 2023 as out-of-sample validation
fs.writeFileSync(path.join(OUTPUT, 'validation-2023.json'), JSON.stringify(data2023));

console.log(`\nFiles written to ${OUTPUT}/`);
console.log(`  ${segments.length} segment files (candles + meta)`);
console.log(`  tuning-index.json (master index with fingerprints)`);
console.log(`  validation-2023.json (out-of-sample validation data)`);

// Print the fingerprint
console.log('\n=== BASELINE FINGERPRINT ===');
console.log(`  Data hash:       ${tuningIndex.dataHash}`);
console.log(`  Validation hash: ${tuningIndex.validationHash}`);
console.log(`  Config hash:     (run baseline backtest to generate)`);
console.log(`  Commit hash:     (from git on VPS)`);
console.log('\nReady for tuning. Run baseline backtest on each tuning segment next.');
