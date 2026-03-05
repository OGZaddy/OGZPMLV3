#!/usr/bin/env node
/**
 * Pattern Memory Cleanup Script
 * Removes garbage patterns (all zeros) while keeping good ones (real pnl data)
 */

const fs = require('fs');
const path = require('path');

const filePath = process.argv[2] || 'data/pattern-memory.paper.json';
const dryRun = process.argv.includes('--dry-run');

console.log(`Pattern cleanup: ${filePath}`);
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
console.log('---');

// Load pattern file
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const patterns = data.patterns;

const goodPatterns = {};
let garbage = 0;
let good = 0;

for (const key of Object.keys(patterns)) {
  const val = patterns[key];

  // Pattern is "good" if it has any non-zero pnl
  const hasRealPnL = val.totalPnL !== 0 ||
    (val.results && val.results.some(r => r.pnl !== 0 && r.pnl !== null));

  if (hasRealPnL) {
    goodPatterns[key] = val;
    good++;
  } else {
    garbage++;
  }
}

console.log(`Total patterns: ${Object.keys(patterns).length}`);
console.log(`Garbage (all zeros): ${garbage}`);
console.log(`Good (has real pnl): ${good}`);
console.log(`Reduction: ${((garbage / Object.keys(patterns).length) * 100).toFixed(1)}%`);

if (!dryRun && garbage > 0) {
  // Backup original
  const backupPath = filePath.replace('.json', `.backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(data, null, 2));
  console.log(`\nBackup saved: ${backupPath}`);

  // Write cleaned file
  const cleanedData = {
    count: good,
    patterns: goodPatterns
  };
  fs.writeFileSync(filePath, JSON.stringify(cleanedData));
  console.log(`Cleaned file saved: ${filePath}`);
  console.log(`\nRemoved ${garbage} garbage patterns, kept ${good} good ones.`);
} else if (dryRun) {
  console.log('\n[DRY RUN] No changes made. Remove --dry-run to apply.');
}
