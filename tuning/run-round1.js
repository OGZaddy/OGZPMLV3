#!/usr/bin/env node
/**
 * Round 1: Exit Threshold Tuning
 * Tests 5 configs on 3 market regime segments
 */
const { execSync } = require('child_process');
const fs = require('fs');

const configs = {
  'A': { TIER1: 0.005, TIER2: 0.008, TIER3: 0.012, TP: 2.0, SL: 1.5, desc: 'Tighter tiers, same SL' },
  'B': { TIER1: 0.005, TIER2: 0.008, TIER3: 0.012, TP: 2.0, SL: 1.0, desc: 'Tighter everything' },
  'C': { TIER1: 0.003, TIER2: 0.006, TIER3: 0.010, TP: 1.5, SL: 0.8, desc: 'Scalper-tight' },
  'D': { TIER1: 0.007, TIER2: 0.010, TIER3: 0.015, TP: 2.5, SL: 2.0, desc: 'Current tiers, wider SL' },
  'E': { TIER1: 0.005, TIER2: 0.010, TIER3: 0.020, TP: 3.0, SL: 1.5, desc: 'Wide tiers, current SL' },
};

const segments = ['seg_16_uptrend', 'seg_5_range', 'seg_1_range'];
const results = {};

console.log('ROUND 1: EXIT THRESHOLD TUNING');
console.log('='.repeat(80));

for (const [configName, cfg] of Object.entries(configs)) {
  console.log('\n' + '-'.repeat(80));
  console.log(`CONFIG ${configName}: ${cfg.desc}`);
  console.log(`  Tiers: ${(cfg.TIER1*100).toFixed(1)}% / ${(cfg.TIER2*100).toFixed(1)}% / ${(cfg.TIER3*100).toFixed(1)}% / ${cfg.TP}%`);
  console.log(`  SL: ${cfg.SL}%`);
  console.log('-'.repeat(80));

  results[configName] = { cfg, segments: {} };

  for (const seg of segments) {
    try {
      const env = {
        ...process.env,
        BACKTEST_MODE: 'true',
        BACKTEST_SILENT: 'true',
        STOP_LOSS_PERCENT: String(cfg.SL),
        TAKE_PROFIT_PERCENT: String(cfg.TP),
        TIER1_TARGET: String(cfg.TIER1),
        TIER2_TARGET: String(cfg.TIER2),
        TIER3_TARGET: String(cfg.TIER3),
        CANDLE_DATA_FILE: `/opt/ogzprime/OGZPMLV2/tuning/${seg}.json`
      };

      const output = execSync('node run-empire-v2.js', {
        timeout: 120000,
        env,
        cwd: '/opt/ogzprime/OGZPMLV2'
      }).toString();

      // Extract P&L
      const pnlMatch = output.match(/Total P&L:.*\(([-\d.]+)%\)/);
      const pnl = pnlMatch ? parseFloat(pnlMatch[1]) : null;

      results[configName].segments[seg] = pnl;
      console.log(`  ${seg}: ${pnl !== null ? pnl.toFixed(2) + '%' : 'ERROR'}`);
    } catch(e) {
      console.log(`  ${seg}: ERROR - ${e.message.slice(0, 50)}`);
      results[configName].segments[seg] = null;
    }
  }

  // Compute average
  const vals = Object.values(results[configName].segments).filter(v => v !== null);
  const avg = vals.length > 0 ? vals.reduce((a,b) => a+b, 0) / vals.length : null;
  results[configName].avgPnl = avg;
  console.log(`  AVG: ${avg !== null ? avg.toFixed(2) + '%' : 'N/A'}`);
}

console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log('Config | seg_16 | seg_5 | seg_1 | AVG');
console.log('-'.repeat(50));
for (const [configName, r] of Object.entries(results)) {
  const s16 = r.segments.seg_16_uptrend?.toFixed(2) || 'ERR';
  const s5 = r.segments.seg_5_range?.toFixed(2) || 'ERR';
  const s1 = r.segments.seg_1_range?.toFixed(2) || 'ERR';
  const avg = r.avgPnl?.toFixed(2) || 'ERR';
  console.log(`${configName.padEnd(7)}| ${s16.padStart(6)} | ${s5.padStart(5)} | ${s1.padStart(5)} | ${avg}`);
}

// Baseline comparison
console.log('\nBASELINE: -2.25% | -3.39% | -3.61% | -3.08%');

fs.writeFileSync('/opt/ogzprime/OGZPMLV2/tuning/round1-results.json', JSON.stringify(results, null, 2));
console.log('\nResults saved to tuning/round1-results.json');
