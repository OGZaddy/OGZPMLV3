#!/usr/bin/env node

/**
 * Pattern System Test
 * Verifies pattern memory is recording entries
 *
 * NOTE: Checks console output for "Pattern RECORDED" messages
 * because disk writes are skipped in backtest mode (EMFILE fix)
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🔍 PATTERN TEST: Checking pattern recording...');

// Start bot in backtest mode
const bot = spawn('node', ['run-empire-v2.js', '--backtest', '--candles', '100'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    NODE_ENV: 'test'
  }
});

let patternsRecorded = 0;
let output = '';

// Monitor stdout for pattern recording
bot.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;

  // Count "Pattern RECORDED" messages
  const matches = text.match(/Pattern RECORDED/g);
  if (matches) {
    patternsRecorded += matches.length;
  }
});

bot.stderr.on('data', (data) => {
  // Ignore stderr - handled by smoke test
});

// Timeout
setTimeout(() => {
  bot.kill('SIGTERM');

  console.log('\n📊 PATTERN TEST RESULTS:');
  console.log(`- Patterns recorded: ${patternsRecorded}`);

  // Success = at least some patterns were recorded in memory
  const success = patternsRecorded >= 5;

  if (success) {
    console.log(`\n✅ PATTERN TEST PASSED! ${patternsRecorded} patterns recorded`);
    process.exit(0);
  } else {
    console.log('\n❌ PATTERN TEST FAILED! Insufficient patterns recorded');
    console.log('Last output:', output.slice(-500));
    process.exit(1);
  }
}, 45000); // 45 seconds

bot.on('exit', (code) => {
  // Bot exiting normally after backtest is fine
  if (code === 0) {
    console.log('✅ Backtest completed');
  } else if (code && code !== 143) { // 143 = SIGTERM
    console.log(`⚠️ Bot exited with code ${code}`);
  }
});
