#!/usr/bin/env node

/**
 * Pattern System Test
 * Verifies pattern memory is actually growing
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 PATTERN TEST: Checking pattern memory growth...');

const testFile = 'data/pattern-memory.backtest.json';
const testPath = path.join(__dirname, '..', testFile);

// Clean start
if (fs.existsSync(testPath)) {
  fs.unlinkSync(testPath);
  console.log('✅ Cleaned old test pattern file');
}

// Start bot
const bot = spawn('node', ['run-empire-v2.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    NODE_ENV: 'test',
    BACKTEST_MODE: 'true',  // Use backtest pattern file
    CANDLE_LIMIT: '50'  // Process 50 candles then stop
  }
});

let patternCount = 0;
let lastPatternCount = 0;
let checkInterval;

// Monitor pattern file growth
checkInterval = setInterval(() => {
  if (fs.existsSync(testPath)) {
    try {
      const content = fs.readFileSync(testPath, 'utf8');
      const data = JSON.parse(content);
      const currentCount = Object.keys(data.patterns || {}).length;

      if (currentCount > lastPatternCount) {
        console.log(`📈 Patterns grew: ${lastPatternCount} → ${currentCount}`);
        lastPatternCount = currentCount;
        patternCount = currentCount;
      }
    } catch (e) {
      // File might be writing, ignore
    }
  }
}, 2000);

// Timeout and check
setTimeout(() => {
  bot.kill('SIGTERM');
  clearInterval(checkInterval);

  console.log('\n📊 PATTERN TEST RESULTS:');
  console.log(`- Final pattern count: ${patternCount}`);
  console.log(`- Pattern file exists: ${fs.existsSync(testPath)}`);

  // Success = patterns were recorded
  const success = patternCount > 0;

  if (success) {
    console.log(`\n✅ PATTERN TEST PASSED! Bot learned ${patternCount} patterns`);
    process.exit(0);
  } else {
    console.log('\n❌ PATTERN TEST FAILED! No patterns recorded');

    // Show what's in the file
    if (fs.existsSync(testPath)) {
      const content = fs.readFileSync(testPath, 'utf8');
      console.log('Pattern file content:', content.slice(0, 500));
    }

    process.exit(1);
  }
}, 60000); // 60 seconds

bot.on('exit', (code) => {
  if (code && code !== 0 && code !== 143) { // 143 = SIGTERM
    console.log(`⚠️ Bot exited with code ${code}`);
  }
});