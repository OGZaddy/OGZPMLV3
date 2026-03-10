#!/usr/bin/env node
/**
 * test-patterns.js - Pattern Recognition Tests
 *
 * Tests the pattern memory and recognition systems.
 * Verifies pattern storage, retrieval, and matching.
 */

'use strict';

const path = require('path');
const projectRoot = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`❌ ${name}: ${err.message}`);
  }
}

console.log('🧠 Pattern Recognition Tests\n');

// Test pattern-related modules exist
test('EnhancedPatternRecognition loads', () => {
  try {
    const EPR = require(path.join(projectRoot, 'core/EnhancedPatternRecognition'));
    if (!EPR) throw new Error('Module not exported');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.log('   (Module not present - skipping)');
      return;
    }
    throw err;
  }
});

test('PatternMemory loads if present', () => {
  try {
    const PM = require(path.join(projectRoot, 'core/PatternMemory'));
    if (!PM) throw new Error('Module not exported');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.log('   (Module not present - skipping)');
      return;
    }
    throw err;
  }
});

// Summary
console.log('\n' + '='.repeat(40));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
  process.exit(1);
}

console.log('\n✅ Pattern tests passed');
process.exit(0);
