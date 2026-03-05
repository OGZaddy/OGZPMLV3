#!/usr/bin/env node
/**
 * Signal Test Harness - Pattern-Specific
 *
 * Tests that specific candlestick patterns and TPO signals trigger trades.
 * Scenarios match what the bot actually looks for.
 *
 * Usage:
 *   node test/signal-test-harness.js [scenario]
 *
 * Scenarios:
 *   --engulf     Bullish engulfing at support → BUY
 *   --hammer     Hammer at day low → BUY
 *   --tpo-buy    TPO at value area low → BUY
 *   --tpo-sell   TPO at value area high → SELL
 *   --all        Run all scenarios (default)
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs').promises;

// Get yesterday's range for realistic PDR testing
function getPreviousDayRange(basePrice) {
  return {
    high: basePrice * 1.02,  // 2% above base
    low: basePrice * 0.98,   // 2% below base
    close: basePrice
  };
}

const SCENARIOS = {

  // Bullish engulfing at previous day low
  engulfing_buy: {
    name: 'Bullish Engulfing at PDR Low',
    description: 'Price drops to previous day low, bullish engulfing forms',
    expectedSignal: 'BUY',
    generate: () => {
      const candles = [];
      const baseTime = Date.now() - (60 * 60000);
      const pdr = getPreviousDayRange(90000);
      let price = 90500; // Start mid-range

      // Build up 45 candles of history for indicators
      for (let i = 0; i < 45; i++) {
        const drift = (Math.random() - 0.5) * 100;
        candles.push(makeCandle(baseTime + i * 60000, price, drift, 50));
        price += drift;
      }

      // Drop to PDR low (candles 45-55)
      for (let i = 45; i < 55; i++) {
        const drop = 100 + Math.random() * 50;
        price -= drop;
        candles.push(makeCandle(baseTime + i * 60000, price, -drop, 100));
      }

      // Now at PDR low - create bearish candle
      const bearishOpen = price;
      const bearishClose = price - 150;
      candles.push({
        timestamp: baseTime + 55 * 60000,
        open: bearishOpen,
        high: bearishOpen + 20,
        low: bearishClose - 30,
        close: bearishClose,
        volume: 120
      });

      // BULLISH ENGULFING - completely engulfs previous candle
      const engulfOpen = bearishClose - 10; // Open below prev close
      const engulfClose = bearishOpen + 50; // Close above prev open
      candles.push({
        timestamp: baseTime + 56 * 60000,
        open: engulfOpen,
        high: engulfClose + 30,
        low: engulfOpen - 20,
        close: engulfClose,
        volume: 250 // High volume confirmation
      });

      // Follow-through candles
      for (let i = 57; i < 60; i++) {
        price = engulfClose + (i - 57) * 80;
        candles.push(makeCandle(baseTime + i * 60000, price, 80, 150));
      }

      return { candles, pdr };
    }
  },

  // Hammer candle at support
  hammer_buy: {
    name: 'Hammer at Day Low',
    description: 'Price drops to day low, hammer candle forms with long lower wick',
    expectedSignal: 'BUY',
    generate: () => {
      const candles = [];
      const baseTime = Date.now() - (60 * 60000);
      let price = 91000;

      // Build history
      for (let i = 0; i < 45; i++) {
        const drift = (Math.random() - 0.5) * 80;
        candles.push(makeCandle(baseTime + i * 60000, price, drift, 50));
        price += drift;
      }

      // Downtrend to support (candles 45-54)
      for (let i = 45; i < 54; i++) {
        const drop = 80 + Math.random() * 40;
        price -= drop;
        candles.push(makeCandle(baseTime + i * 60000, price, -drop, 100));
      }

      // HAMMER CANDLE - small body, long lower wick (2:1 ratio minimum)
      const hammerBody = 30;
      const hammerWick = 150; // Long lower wick - 5x body
      candles.push({
        timestamp: baseTime + 54 * 60000,
        open: price,
        high: price + 10,
        low: price - hammerWick,
        close: price + hammerBody, // Close near high (bullish hammer)
        volume: 200
      });

      // Confirmation candle - gap up and hold
      price = price + hammerBody + 50;
      candles.push({
        timestamp: baseTime + 55 * 60000,
        open: price - 40,
        high: price + 60,
        low: price - 50,
        close: price,
        volume: 180
      });

      // Follow-through
      for (let i = 56; i < 60; i++) {
        price += 70;
        candles.push(makeCandle(baseTime + i * 60000, price, 70, 120));
      }

      return { candles };
    }
  },

  // TPO at value area low - buy zone
  tpo_buy: {
    name: 'TPO Value Area Low',
    description: 'Price at value area low with bullish divergence',
    expectedSignal: 'BUY',
    generate: () => {
      const candles = [];
      const baseTime = Date.now() - (120 * 60000); // 2 hours of data
      let price = 92000;

      // Build volume profile - spend time at 91000-91500 (value area)
      // Then drop to VAL (value area low) around 90500

      // Phase 1: Build value area (candles 0-60)
      for (let i = 0; i < 60; i++) {
        // Oscillate around 91250 (POC - point of control)
        const target = 91250;
        const drift = (target - price) * 0.1 + (Math.random() - 0.5) * 100;
        price += drift;
        candles.push(makeCandle(baseTime + i * 60000, price, drift, 80 + Math.random() * 40));
      }

      // Phase 2: Drop to VAL (candles 60-80)
      for (let i = 60; i < 80; i++) {
        const drop = 50 + Math.random() * 30;
        price -= drop;
        if (price < 90500) price = 90500; // VAL floor
        candles.push(makeCandle(baseTime + i * 60000, price, -drop, 60));
      }

      // Phase 3: Test VAL with rejection (candles 80-90)
      for (let i = 80; i < 85; i++) {
        // Slight dip below VAL then recover
        const dip = i < 83 ? -30 : 50;
        price += dip;
        candles.push(makeCandle(baseTime + i * 60000, price, dip, 150)); // High volume at VAL
      }

      // Phase 4: Bounce from VAL (candles 85-100)
      for (let i = 85; i < 100; i++) {
        const gain = 60 + Math.random() * 40;
        price += gain;
        candles.push(makeCandle(baseTime + i * 60000, price, gain, 120));
      }

      return { candles };
    }
  },

  // TPO at value area high - sell zone
  // Candles start AFTER the top, showing clear downtrend
  tpo_sell: {
    name: 'TPO Value Area High - Post Reversal',
    description: 'Price rejected from VAH, now in confirmed downtrend',
    expectedSignal: 'SELL',
    generate: () => {
      const candles = [];
      const baseTime = Date.now() - (100 * 60000);
      let price = 92000; // Start at the top

      // Phase 1: Topping pattern (candles 0-20) - indecision at highs
      for (let i = 0; i < 20; i++) {
        const drift = (Math.random() - 0.5) * 60; // Tight range
        candles.push(makeCandle(baseTime + i * 60000, price, drift, 50));
        price += drift;
      }

      // Phase 2: First rejection (candles 20-35) - bearish engulfing
      for (let i = 20; i < 35; i++) {
        const drop = 80 + Math.random() * 40;
        price -= drop;
        candles.push(makeCandle(baseTime + i * 60000, price, -drop, 150)); // High volume selling
      }

      // Phase 3: Dead cat bounce (candles 35-45) - weak rally
      for (let i = 35; i < 45; i++) {
        const gain = 30 + Math.random() * 20;
        price += gain;
        candles.push(makeCandle(baseTime + i * 60000, price, gain, 40)); // Low volume bounce
      }

      // Phase 4: Continuation down (candles 45-70) - TREND CONFIRMED
      for (let i = 45; i < 70; i++) {
        const drop = 100 + Math.random() * 60;
        price -= drop;
        candles.push(makeCandle(baseTime + i * 60000, price, -drop, 180)); // Accelerating selling
      }

      // Phase 5: Sustained downtrend (candles 70-100)
      for (let i = 70; i < 100; i++) {
        const drop = 60 + Math.random() * 40;
        price -= drop;
        candles.push(makeCandle(baseTime + i * 60000, price, -drop, 120));
      }

      return { candles };
    }
  }
};

// Helper to make a candle
function makeCandle(timestamp, price, change, volume) {
  const open = price - change;
  const close = price;
  const high = Math.max(open, close) + Math.random() * 30;
  const low = Math.min(open, close) - Math.random() * 30;
  return { timestamp, open, high, low, close, volume };
}

// Run scenario
async function runScenario(name) {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    console.error(`Unknown scenario: ${name}`);
    return { passed: false, error: 'Unknown' };
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCENARIO: ${scenario.name}`);
  console.log(`Expected: ${scenario.expectedSignal}`);
  console.log(`${scenario.description}`);
  console.log('='.repeat(60));

  const { candles, pdr } = scenario.generate();
  const tempFile = path.join(__dirname, `temp-${name}.json`);
  await fs.writeFile(tempFile, JSON.stringify(candles, null, 2));

  console.log(`Generated ${candles.length} candles`);
  console.log(`Price range: $${Math.min(...candles.map(c => c.low)).toFixed(0)} - $${Math.max(...candles.map(c => c.high)).toFixed(0)}`);

  return new Promise((resolve) => {
    const { spawn } = require('child_process');

    const env = {
      ...process.env,
      BACKTEST_MODE: 'true',
      TEST_MODE: 'true',
      CANDLE_DATA_FILE: tempFile,
      ENABLE_TRAI: 'false',
      MIN_TRADE_CONFIDENCE: '25', // Lower for testing
      TRAI_ENABLE_BACKTEST: 'false'
    };

    const child = spawn('node', ['run-empire-v2.js'], {
      cwd: path.join(__dirname, '..'),
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    let signals = [];
    let decisions = [];

    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;

      // Capture actual trade executions
      if (text.includes('BUY DECISION') || text.includes('BUY SIGNAL') || text.includes('REGISTERING TRADE') && text.includes('BUY')) {
        if (!signals.includes('BUY')) signals.push('BUY');
        process.stdout.write('B');
      }
      if (text.includes('SELL DECISION') || text.includes('SELL SIGNAL') || text.includes('REGISTERING TRADE') && text.includes('SELL')) {
        if (!signals.includes('SELL')) signals.push('SELL');
        process.stdout.write('S');
      }

      // Capture decisions
      if (text.includes('Decision:')) {
        const match = text.match(/Decision:\s*(\w+)/);
        if (match) decisions.push(match[1]);
      }

      // Capture TPO signals
      if (text.includes('TPO Signal:') || text.includes('TPO Override')) {
        console.log('\n  ' + text.trim());
      }

      // Capture pattern detections
      if (text.includes('Pattern:') || text.includes('Engulfing') || text.includes('Hammer')) {
        console.log('\n  ' + text.trim());
      }

      // Progress
      if (text.includes('Candle #')) {
        process.stdout.write('.');
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      if (text.includes('FATAL') || text.includes('TypeError') || text.includes('ReferenceError')) {
        console.error('\n ERROR:', text.substring(0, 200));
      }
    });

    const timeout = setTimeout(() => {
      child.kill();
      cleanup();
      resolve({ passed: false, error: 'Timeout', signals, scenario: name });
    }, 90000);

    async function cleanup() {
      try { await fs.unlink(tempFile); } catch (e) {}
    }

    child.on('close', async () => {
      clearTimeout(timeout);
      await cleanup();

      const hasExpected = signals.includes(scenario.expectedSignal);
      const passed = hasExpected ||
        (scenario.expectedSignal === 'HOLD' && signals.length === 0);

      console.log(`\n\nSignals triggered: ${signals.length > 0 ? [...new Set(signals)].join(', ') : 'NONE'}`);
      console.log(`Decisions made: ${decisions.length > 0 ? [...new Set(decisions)].join(', ') : 'NONE'}`);
      console.log(`Expected: ${scenario.expectedSignal}`);
      console.log(`Result: ${passed ? 'PASS' : 'FAIL'}`);

      resolve({ passed, scenario: name, expected: scenario.expectedSignal, actual: signals });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  console.log('\n' + '='.repeat(60));
  console.log(' SIGNAL TEST HARNESS - Pattern Testing');
  console.log(' Testing: Engulfing, Hammer, TPO signals');
  console.log('='.repeat(60));

  let scenarios = Object.keys(SCENARIOS);

  if (args.includes('--engulf')) scenarios = ['engulfing_buy'];
  if (args.includes('--hammer')) scenarios = ['hammer_buy'];
  if (args.includes('--tpo-buy')) scenarios = ['tpo_buy'];
  if (args.includes('--tpo-sell')) scenarios = ['tpo_sell'];

  const results = [];
  for (const s of scenarios) {
    results.push(await runScenario(s));
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(' SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.scenario}: Expected ${r.expected}, Got ${r.actual.join(',') || 'NONE'}`);
  }

  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(console.error);
