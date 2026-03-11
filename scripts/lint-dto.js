#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const BAD_PATTERNS = [
  { regex: /indicators\.indicators\./g, name: 'indicators.indicators' },
  { regex: /\bc\.c\b/g, name: 'c.c (use _c(c))' },
  { regex: /\bc\.o\b/g, name: 'c.o (use _o(c))' },
  { regex: /\bc\.h\b/g, name: 'c.h (use _h(c))' },
  { regex: /\bc\.l\b/g, name: 'c.l (use _l(c))' },
  { regex: /\bc\.v\b/g, name: 'c.v (use _v(c))' },
  { regex: /rsi\s*\|\|\s*50/g, name: 'rsi || 50 (silent fallback)' },
];

const VIOLATIONS = [];

function lintFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return;
  }

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

    for (const pattern of BAD_PATTERNS) {
      if (pattern.regex.test(line)) {
        VIOLATIONS.push({
          file: filePath,
          line: i + 1,
          pattern: pattern.name,
          content: line.trim().substring(0, 80),
        });
      }
      // Reset regex lastIndex
      pattern.regex.lastIndex = 0;
    }
  }
}

function lintDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      lintDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      lintFile(fullPath);
    }
  }
}

// Main
const args = process.argv.slice(2);
const targets = args.length ? args : ['core', 'modules', 'run-empire-v2.js'];

for (const target of targets) {
  try {
    if (fs.statSync(target).isDirectory()) {
      lintDir(target);
    } else {
      lintFile(target);
    }
  } catch (e) {
    console.error(`Cannot access ${target}: ${e.message}`);
  }
}

if (VIOLATIONS.length) {
  console.log('\n❌ DTO LINT VIOLATIONS:\n');
  for (const v of VIOLATIONS) {
    console.log(`  ${v.file}:${v.line} - ${v.pattern}`);
    console.log(`    ${v.content}`);
  }
  console.log(`\nTotal: ${VIOLATIONS.length} violation(s)`);
  process.exit(1);
} else {
  console.log('✅ No DTO lint violations found');
  process.exit(0);
}
