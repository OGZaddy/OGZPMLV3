#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const BAD_PATTERNS = [
  /indicators\.indicators\./g,    // nested access
  /\.rsi\s*(\|\||\?\?)\s*50/g,    // ANY fallback to 50 hides missing RSI - remove entirely
  /c\.c\b/g,                      // direct property access instead of _c()
  /c\.o\b/g,                      // direct property access instead of _o()
  /c\.h\b/g,                      // direct property access instead of _h()
  /c\.l\b/g,                      // direct property access instead of _l()
  /c\.v\b/g,                      // direct property access instead of _v()
];

// Note: tuning/ excluded - files there marked for deletion per spec
const SCAN_DIRS = ['core', 'modules'];
let violations = 0;

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue; // skip comments
    for (const pattern of BAD_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) {
        console.error(`❌ ${filePath}:${i + 1} — ${match[0]}`);
        violations++;
      }
    }
  }
}

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      scanDir(full);
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.includes('.pipeline-backup')) {
      scanFile(full);
    }
  }
}

for (const dir of SCAN_DIRS) {
  if (fs.existsSync(dir)) scanDir(dir);
}

if (violations > 0) {
  console.error(`\n❌ ${violations} DTO violations found. Fix before committing.`);
  process.exit(1);
} else {
  console.log('✅ No DTO violations found.');
}
