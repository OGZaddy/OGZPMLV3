#!/usr/bin/env node
/**
 * test-volume-profile.js — Verify VolumeProfile produces real data
 * Run: node test-volume-profile.js
 */

'use strict';

const VolumeProfile = require('./core/VolumeProfile');
const fs = require('fs');

// ─── Load real candle data ───
let candles;
const paths = [
  './data/btc_15m_candles.json',
  './data/XBTUSD_15m.json',
  './data/backtest_candles.json',
  './backtest-data.json',
];

for (const p of paths) {
  try {
    candles = JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log(`✅ Loaded ${candles.length} candles from ${p}`);
    break;
  } catch (_) {}
}

if (!candles || candles.length < 100) {
  console.log('⚠️  No candle file found, generating synthetic data...');
  candles = generateSyntheticCandles(500);
}

// ─── Run the profile ───
const vp = new VolumeProfile({
  sessionLookback: 96,  // 24 hours of 15min candles
  numBins: 50,
  recalcInterval: 1,    // Recalc every candle for testing
});

console.log('\n═══════════════════════════════════════════');
console.log('  VOLUME PROFILE TEST — Fabio Valentino');
console.log('═══════════════════════════════════════════\n');

// Feed candles
for (let i = 0; i < candles.length; i++) {
  const history = candles.slice(0, i + 1);
  vp.update(candles[i], history);
}

// ─── Print results ───
const profile = vp.getProfile();
const lastPrice = profile.currentPrice;

console.log('PROFILE SUMMARY:');
console.log(`  POC:  $${profile.poc?.toFixed(2)}`);
console.log(`  VAH:  $${profile.vah?.toFixed(2)}`);
console.log(`  VAL:  $${profile.val?.toFixed(2)}`);
console.log(`  Value Area Width: ${profile.vah && profile.val ? ((profile.vah - profile.val) / profile.poc * 100).toFixed(2) : '?'}%`);
console.log(`  Range: $${profile.rangeLow?.toFixed(2)} — $${profile.rangeHigh?.toFixed(2)}`);
console.log(`  Market State: ${profile.marketState}`);
console.log(`  Current Price: $${lastPrice?.toFixed(2)}`);
console.log(`  Volume in VA: ${profile.valueAreaVolumePct}%`);
console.log(`  Candles Used: ${profile.candlesUsed}`);

console.log(`\n  LOW VOLUME NODES (${profile.lvns.length}):`);
for (const lvn of profile.lvns) {
  const dist = ((lvn.price - lastPrice) / lastPrice * 100).toFixed(2);
  console.log(`    LVN: $${lvn.price.toFixed(2)} (${lvn.volumePct}% of max) | ${dist}% from price`);
}

console.log(`\n  HIGH VOLUME NODES (${profile.hvns.length}):`);
for (const hvn of profile.hvns) {
  const dist = ((hvn.price - lastPrice) / lastPrice * 100).toFixed(2);
  console.log(`    HVN: $${hvn.price.toFixed(2)} (${hvn.volumePct}% of max) | ${dist}% from price`);
}

// ─── Test market state ───
console.log('\n─── MARKET STATE CHECK ───');
const state = vp.getMarketState(lastPrice);
console.log(`  State: ${state.state}`);
console.log(`  Distance to POC: ${state.priceRelativeToPoc}%`);
console.log(`  Distance to VAH: ${state.priceRelativeToVah}%`);
console.log(`  Distance to VAL: ${state.priceRelativeToVal}%`);
if (state.nearestLvn) {
  console.log(`  Nearest LVN: $${state.nearestLvn.price.toFixed(2)} (${state.nearestLvn.distancePct}% away)`);
}

// ─── Test strategy filter ───
console.log('\n─── STRATEGY FILTER (Fabio\'s Rules) ───');
const trendCheck = vp.filterStrategy('trend', lastPrice);
console.log(`  Trend Following: ${trendCheck.allowed ? '✅ ALLOWED' : '❌ BLOCKED'} — ${trendCheck.reason}`);
const revCheck = vp.filterStrategy('reversion', lastPrice);
console.log(`  Mean Reversion: ${revCheck.allowed ? '✅ ALLOWED' : '❌ BLOCKED'} — ${revCheck.reason}`);

// ─── Test targets ───
console.log('\n─── TRADE TARGETS ───');
const buyTargets = vp.getTargets('buy', lastPrice);
if (buyTargets) {
  console.log(`  BUY targets:`);
  console.log(`    Mean Reversion TP: $${buyTargets.meanReversionTarget?.toFixed(2)} (POC — 70% prob)`);
  console.log(`    Trend TP: $${buyTargets.trendTarget?.toFixed(2)}`);
  console.log(`    Stop Level: $${buyTargets.stopLevel?.toFixed(2)} (VAL)`);
  if (buyTargets.entryZones.length) {
    console.log(`    Entry Zones (LVNs below price):`);
    for (const ez of buyTargets.entryZones) {
      console.log(`      $${ez.price.toFixed(2)} (${ez.volumePct}% vol)`);
    }
  }
}

// ─── Visual histogram ───
console.log('\n─── VOLUME HISTOGRAM ───');
if (profile.bins.length > 0) {
  const maxBinVol = Math.max(...profile.bins.map(b => b.volume));
  const barWidth = 50;
  
  // Sample every 2nd bin for readability
  for (let i = profile.bins.length - 1; i >= 0; i -= 2) {
    const bin = profile.bins[i];
    const barLen = Math.round((bin.volume / maxBinVol) * barWidth);
    const bar = '█'.repeat(barLen);
    const marker = bin.isPoc ? ' ◄POC' : (bin.isVA ? ' VA' : '');
    const priceStr = bin.price.toFixed(0).padStart(7);
    console.log(`  ${priceStr} |${bar}${marker}`);
  }
}

// ─── Previous session data ───
if (profile.previousPoc) {
  console.log(`\n─── PREVIOUS SESSION ───`);
  console.log(`  Prev POC: $${profile.previousPoc.toFixed(2)}`);
  console.log(`  Prev VAH: $${profile.previousVah?.toFixed(2)}`);
  console.log(`  Prev VAL: $${profile.previousVal?.toFixed(2)}`);
}

console.log('\n═══════════════════════════════════════════');
console.log('  TEST COMPLETE');
console.log('═══════════════════════════════════════════\n');

// ─── Synthetic candle generator (fallback) ───
function generateSyntheticCandles(count) {
  const synth = [];
  let price = 95000;
  
  for (let i = 0; i < count; i++) {
    // Create trending + ranging behavior
    const trend = Math.sin(i / 80) * 2000;
    const noise = (Math.random() - 0.5) * 600;
    price = 95000 + trend + noise;
    
    const hl = Math.random() * 400 + 100;
    const open = price + (Math.random() - 0.5) * 200;
    const close = price;
    const high = Math.max(open, close) + Math.random() * hl;
    const low = Math.min(open, close) - Math.random() * hl;
    const volume = Math.random() * 50 + 5;
    
    synth.push({
      open, high, low, close, volume,
      timestamp: Date.now() - (count - i) * 15 * 60 * 1000,
    });
  }
  console.log(`  Generated ${count} synthetic BTC candles (~$93K-$97K range)`);
  return synth;
}
