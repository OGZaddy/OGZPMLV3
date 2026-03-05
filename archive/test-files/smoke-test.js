#!/usr/bin/env node

/**
 * OGZPrime Smoke Test
 * Ensures bot doesn't die on startup and can process candles
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔥 SMOKE TEST: Starting OGZPrime Empire V2...');

// Clean up old pattern memory for test
const testPatternFile = path.join(__dirname, '..', 'pattern_memory_test.json');
if (fs.existsSync(testPatternFile)) {
  fs.unlinkSync(testPatternFile);
}

// Start the bot
const bot = spawn('node', ['run-empire-v2.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PATTERN_MEMORY_FILE: 'pattern_memory_test.json'
  }
});

let output = '';
let candleCount = 0;
let patternsDetected = false;
let decisionsMode = false;
let hasErrors = false;

// Capture output
bot.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;

  // Count candles
  if (text.includes('Candle #')) {
    candleCount++;
    console.log(`✅ Candle ${candleCount} processed`);
  }

  // Check for patterns
  if (text.includes('patterns detected') || text.includes('Recorded') || text.includes('Pattern')) {
    patternsDetected = true;
    console.log('✅ Pattern system working');
  }

  // Check for trading decisions
  if (text.includes('DECISION') || text.includes('Signal') || text.includes('EXECUTING')) {
    decisionsMode = true;
    console.log('✅ Trading decisions being made');
  }
});

bot.stderr.on('data', (data) => {
  const text = data.toString();

  // Ignore warnings about missing optional modules and expected warmup messages
  if (!text.includes('Warning') &&
      !text.includes('Deprecation') &&
      !text.includes('warmup') &&
      !text.includes('WebSocket not ready')) {
    console.error('❌ ERROR:', text);
    hasErrors = true;
  }
});

// Set timeout
setTimeout(() => {
  bot.kill('SIGTERM');

  console.log('\n📊 SMOKE TEST RESULTS:');
  console.log(`- Candles processed: ${candleCount}`);
  console.log(`- Patterns detected: ${patternsDetected ? 'YES' : 'NO'}`);
  console.log(`- Trading decisions: ${decisionsMode ? 'YES' : 'NO'}`);
  console.log(`- Errors encountered: ${hasErrors ? 'YES' : 'NO'}`);

  // Check success criteria
  const success = candleCount >= 2 && !hasErrors;

  if (success) {
    console.log('\n✅ SMOKE TEST PASSED!');
    process.exit(0);
  } else {
    console.log('\n❌ SMOKE TEST FAILED!');
    console.log('Output:', output.slice(-500));
    process.exit(1);
  }
}, 45000); // 45 seconds timeout

bot.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.log(`❌ Bot exited with code ${code}`);
    process.exit(1);
  }
});