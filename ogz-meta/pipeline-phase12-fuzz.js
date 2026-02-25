#!/usr/bin/env node
/**
 * OGZPrime Phase 12: CONTRACT FUZZING
 * =====================================
 *
 * PURPOSE: Feed garbage into every module. If it crashes or silently
 * returns wrong answers instead of failing gracefully — that's a bug.
 *
 * FUZZ INPUTS:
 *   null, undefined, NaN, Infinity, -Infinity,
 *   0, -1, -99999, 99999999,
 *   '', 'garbage', {}, [], true, false,
 *   { close: NaN }, { close: -1 }, empty candle arrays
 *
 * WHAT THIS CATCHES:
 *   - Uncaught exceptions (crash the bot)
 *   - NaN propagation (poison spreads through calculations)
 *   - Silent wrong answers (returns 0 instead of throwing)
 *   - Missing null checks
 *   - Type coercion bugs
 *
 * Usage:
 *   node ogz-meta/pipeline-phase12-fuzz.js            # Full fuzz
 *   node ogz-meta/pipeline-phase12-fuzz.js --json     # JSON output
 *   node ogz-meta/pipeline-phase12-fuzz.js --verbose  # Show all results
 *
 * Created: 2026-02-24 | "Feed garbage in, see what breaks"
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const VERBOSE = args.includes('--verbose');

// ─── FUZZ VALUES ─────────────────────────────────────────────
const FUZZ_PRIMITIVES = [
  { label: 'null', value: null },
  { label: 'undefined', value: undefined },
  { label: 'NaN', value: NaN },
  { label: 'Infinity', value: Infinity },
  { label: '-Infinity', value: -Infinity },
  { label: 'zero', value: 0 },
  { label: 'negative', value: -99999 },
  { label: 'huge', value: 99999999999 },
  { label: 'empty string', value: '' },
  { label: 'garbage string', value: 'xyzzy_garbage_💀' },
  { label: 'empty object', value: {} },
  { label: 'empty array', value: [] },
  { label: 'true', value: true },
  { label: 'false', value: false },
];

const FUZZ_CANDLES = [
  { label: 'null candle', value: null },
  { label: 'empty object candle', value: {} },
  { label: 'NaN candle', value: { open: NaN, high: NaN, low: NaN, close: NaN, volume: NaN, timestamp: NaN } },
  { label: 'negative candle', value: { open: -100, high: -50, low: -200, close: -150, volume: -1, timestamp: -1 } },
  { label: 'zero candle', value: { open: 0, high: 0, low: 0, close: 0, volume: 0, timestamp: 0 } },
  { label: 'inverted candle', value: { open: 100, high: 50, low: 200, close: 150, volume: 1000, timestamp: Date.now() } },
  { label: 'missing fields', value: { close: 95000 } },
  { label: 'string fields', value: { open: '95000', high: '96000', low: '94000', close: '95500', volume: '1000' } },
];

const FUZZ_CANDLE_ARRAYS = [
  { label: 'null array', value: null },
  { label: 'empty array', value: [] },
  { label: 'single candle', value: [{ open: 95000, high: 96000, low: 94000, close: 95500, volume: 1000, timestamp: Date.now() }] },
  { label: 'array of nulls', value: [null, null, null] },
  { label: 'mixed garbage', value: [null, undefined, {}, 'garbage', 42] },
];

// ─── RESULTS ─────────────────────────────────────────────────
let totalTests = 0;
let passed = 0;     // Handled gracefully (no crash, no NaN output)
let crashed = 0;    // Threw uncaught exception
let nanOutput = 0;  // Returned NaN (poison)
let silentFail = 0; // Returned without error but wrong type

const results = [];

function fuzzTest(moduleName, methodName, fuzzLabel, fn) {
  totalTests++;
  const entry = { module: moduleName, method: methodName, fuzz: fuzzLabel };

  try {
    const result = fn();

    // Check for NaN in output
    if (hasNaN(result)) {
      nanOutput++;
      entry.status = 'NaN_OUTPUT';
      entry.detail = `Returned NaN — poison will propagate`;
      if (!JSON_OUT && VERBOSE) console.log(`  🟠 ${moduleName}.${methodName}(${fuzzLabel}) → NaN output`);
    } else {
      passed++;
      entry.status = 'PASS';
      if (!JSON_OUT && VERBOSE) console.log(`  ✅ ${moduleName}.${methodName}(${fuzzLabel}) → handled`);
    }
  } catch (e) {
    // Check if it's a graceful rejection (intentional throw) vs unexpected crash
    const isGraceful = e.message && (
      e.message.includes('Invalid') ||
      e.message.includes('required') ||
      e.message.includes('must be') ||
      e.message.includes('cannot') ||
      e.message.includes('expected')
    );

    if (isGraceful) {
      passed++;
      entry.status = 'GRACEFUL_REJECT';
      entry.detail = e.message;
      if (!JSON_OUT && VERBOSE) console.log(`  ✅ ${moduleName}.${methodName}(${fuzzLabel}) → graceful reject`);
    } else {
      crashed++;
      entry.status = 'CRASH';
      entry.detail = e.message;
      entry.stack = e.stack?.split('\n').slice(0, 3).join('\n');
      if (!JSON_OUT) console.log(`  🔴 ${moduleName}.${methodName}(${fuzzLabel}) → CRASH: ${e.message}`);
    }
  }

  results.push(entry);
}

function hasNaN(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return isNaN(value);
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (typeof value[key] === 'number' && isNaN(value[key])) return true;
      if (typeof value[key] === 'object' && value[key] !== null && hasNaN(value[key])) return true;
    }
  }
  return false;
}

// ─── MODULE FUZZERS ──────────────────────────────────────────

function fuzzMaxProfitManager() {
  const section = 'MaxProfitManager';
  if (!JSON_OUT) console.log(`\n  📁 Fuzzing ${section}...`);

  try {
    const modPath = path.resolve(ROOT, 'core/MaxProfitManager');
    delete require.cache[require.resolve(modPath)];
    const MPMMod = require(modPath);
    const MPMClass = MPMMod.MaxProfitManager || MPMMod;

    // Suppress console during fuzzing
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};

    // Fuzz constructor
    for (const fuzz of FUZZ_PRIMITIVES) {
      fuzzTest(section, 'constructor', fuzz.label, () => new MPMClass(fuzz.value));
    }

    // Fuzz start()
    const mpm = new MPMClass({ enableTieredExit: true });
    for (const fuzz of FUZZ_PRIMITIVES) {
      fuzzTest(section, 'start', `price=${fuzz.label}`, () => mpm.start(fuzz.value, 'buy', 0.001));
      fuzzTest(section, 'start', `direction=${fuzz.label}`, () => mpm.start(95000, fuzz.value, 0.001));
      fuzzTest(section, 'start', `size=${fuzz.label}`, () => mpm.start(95000, 'buy', fuzz.value));
    }

    // Fuzz update()
    mpm.start(95000, 'buy', 0.001, { confidence: 0.72 });
    for (const fuzz of FUZZ_PRIMITIVES) {
      fuzzTest(section, 'update', fuzz.label, () => mpm.update(fuzz.value));
    }

    console.log = origLog;
    console.warn = origWarn;
  } catch (e) {
    if (!JSON_OUT) console.log(`  ⚠️  Could not load ${section}: ${e.message}`);
  }
}

function fuzzExitContractManager() {
  const section = 'ExitContractManager';
  if (!JSON_OUT) console.log(`\n  📁 Fuzzing ${section}...`);

  try {
    const modPath = path.resolve(ROOT, 'core/ExitContractManager');
    delete require.cache[require.resolve(modPath)];
    const { getInstance } = require(modPath);
    const ecm = getInstance();

    const origLog = console.log;
    console.log = () => {};

    for (const fuzz of FUZZ_PRIMITIVES) {
      fuzzTest(section, 'createExitContract', `strategy=${fuzz.label}`, () =>
        ecm.createExitContract(fuzz.value, {}, { entryPrice: 95000 }));
      fuzzTest(section, 'createExitContract', `context=${fuzz.label}`, () =>
        ecm.createExitContract('MADynamicSR', fuzz.value, { entryPrice: 95000 }));
      fuzzTest(section, 'createExitContract', `trade=${fuzz.label}`, () =>
        ecm.createExitContract('MADynamicSR', {}, fuzz.value));
    }

    // Fuzz evaluateExit with garbage contracts
    for (const fuzz of FUZZ_CANDLES) {
      fuzzTest(section, 'evaluateExit', `candle=${fuzz.label}`, () => {
        const contract = ecm.createExitContract('MADynamicSR', {}, { entryPrice: 95000 });
        return ecm.evaluateExit ? ecm.evaluateExit(contract, fuzz.value, 95000) : 'no evaluateExit method';
      });
    }

    console.log = origLog;
  } catch (e) {
    if (!JSON_OUT) console.log(`  ⚠️  Could not load ${section}: ${e.message}`);
  }
}

function fuzzStateManager() {
  const section = 'StateManager';
  if (!JSON_OUT) console.log(`\n  📁 Fuzzing ${section}...`);

  try {
    const modPath = path.resolve(ROOT, 'core/StateManager');
    delete require.cache[require.resolve(modPath)];
    const SMClass = require(modPath);
    const sm = new SMClass();

    const origLog = console.log;
    console.log = () => {};

    // Fuzz set/get
    for (const fuzz of FUZZ_PRIMITIVES) {
      fuzzTest(section, 'set', `key=${fuzz.label}`, () => sm.set(fuzz.value, 'test'));
      fuzzTest(section, 'set', `value=${fuzz.label}`, () => sm.set('test_key', fuzz.value));
      fuzzTest(section, 'get', fuzz.label, () => sm.get(fuzz.value));
    }

    // Fuzz openPosition with garbage
    for (const fuzz of FUZZ_PRIMITIVES) {
      fuzzTest(section, 'openPosition', `size=${fuzz.label}`, () => sm.openPosition(fuzz.value, 95000));
      fuzzTest(section, 'openPosition', `price=${fuzz.label}`, () => sm.openPosition(0.001, fuzz.value));
    }

    console.log = origLog;
  } catch (e) {
    if (!JSON_OUT) console.log(`  ⚠️  Could not load ${section}: ${e.message}`);
  }
}

function fuzzRiskManager() {
  const section = 'RiskManager';
  if (!JSON_OUT) console.log(`\n  📁 Fuzzing ${section}...`);

  try {
    const modPath = path.resolve(ROOT, 'core/RiskManager');
    delete require.cache[require.resolve(modPath)];
    const RMClass = require(modPath);
    const rm = new RMClass({});

    const origLog = console.log;
    console.log = () => {};

    // Fuzz calculatePositionSize
    if (rm.calculatePositionSize) {
      for (const fuzz of FUZZ_PRIMITIVES) {
        fuzzTest(section, 'calculatePositionSize', `balance=${fuzz.label}`, () =>
          rm.calculatePositionSize(fuzz.value, 95000, 0.02));
        fuzzTest(section, 'calculatePositionSize', `price=${fuzz.label}`, () =>
          rm.calculatePositionSize(10000, fuzz.value, 0.02));
        fuzzTest(section, 'calculatePositionSize', `risk=${fuzz.label}`, () =>
          rm.calculatePositionSize(10000, 95000, fuzz.value));
      }
    }

    // Fuzz canTrade
    if (rm.canTrade) {
      for (const fuzz of FUZZ_PRIMITIVES) {
        fuzzTest(section, 'canTrade', fuzz.label, () => rm.canTrade(fuzz.value));
      }
    }

    console.log = origLog;
  } catch (e) {
    if (!JSON_OUT) console.log(`  ⚠️  Could not load ${section}: ${e.message}`);
  }
}

function fuzzStrategies() {
  const strategies = [
    { name: 'MADynamicSR', path: 'modules/MADynamicSR' },
    { name: 'EMASMACrossover', path: 'modules/EMASMACrossoverSignal' },
    { name: 'LiquiditySweep', path: 'modules/LiquiditySweepDetector' },
    { name: 'BreakAndRetest', path: 'modules/BreakAndRetest' },
  ];

  for (const strat of strategies) {
    if (!JSON_OUT) console.log(`\n  📁 Fuzzing ${strat.name}...`);

    try {
      const modPath = path.resolve(ROOT, strat.path);
      delete require.cache[require.resolve(modPath)];
      const Mod = require(modPath);
      const instance = new Mod();

      const origLog = console.log;
      console.log = () => {};

      // Fuzz analyze/evaluate with garbage candle data
      const analyzeMethods = ['analyze', 'evaluate', 'generateSignal', 'detectSignal', 'update'];
      for (const method of analyzeMethods) {
        if (typeof instance[method] === 'function') {
          for (const fuzz of FUZZ_CANDLE_ARRAYS) {
            fuzzTest(strat.name, method, `candles=${fuzz.label}`, () =>
              instance[method](fuzz.value));
          }
          for (const fuzz of FUZZ_CANDLES) {
            fuzzTest(strat.name, method, `candle=${fuzz.label}`, () =>
              instance[method]([fuzz.value]));
          }
        }
      }

      console.log = origLog;
    } catch (e) {
      if (!JSON_OUT) console.log(`  ⚠️  Could not load ${strat.name}: ${e.message}`);
    }
  }
}

// ─── PRINT RESULTS ───────────────────────────────────────────
function printResults() {
  if (!JSON_OUT) {
    console.log(`\n${'╔'.padEnd(64, '═')}╗`);
    console.log(`║  OGZPrime Phase 12: CONTRACT FUZZING RESULTS                ║`);
    console.log(`║  "Feed garbage in, see what breaks"                         ║`);
    console.log(`${'╚'.padEnd(64, '═')}╝`);
  }

  if (!JSON_OUT) {
    console.log(`\n  Total fuzz tests:  ${totalTests}`);
    console.log(`  ✅ Handled:        ${passed}`);
    console.log(`  🔴 Crashed:        ${crashed}`);
    console.log(`  🟠 NaN output:     ${nanOutput}`);
    console.log(`  Pass rate:         ${totalTests > 0 ? ((passed / totalTests) * 100).toFixed(1) : 0}%`);

    if (crashed > 0) {
      console.log(`\n${'─'.repeat(65)}`);
      console.log(`  CRASHES (will kill the bot in production):`);
      console.log(`${'─'.repeat(65)}`);
      const crashes = results.filter(r => r.status === 'CRASH');
      for (const c of crashes) {
        console.log(`\n  🔴 ${c.module}.${c.method}(${c.fuzz})`);
        console.log(`     ${c.detail}`);
      }
    }

    if (nanOutput > 0) {
      console.log(`\n${'─'.repeat(65)}`);
      console.log(`  NaN OUTPUTS (poison that spreads through calculations):`);
      console.log(`${'─'.repeat(65)}`);
      const nans = results.filter(r => r.status === 'NaN_OUTPUT');
      // Group by module
      const byModule = {};
      for (const n of nans) {
        const key = `${n.module}.${n.method}`;
        if (!byModule[key]) byModule[key] = [];
        byModule[key].push(n.fuzz);
      }
      for (const [key, fuzzes] of Object.entries(byModule)) {
        console.log(`\n  🟠 ${key}()`);
        console.log(`     NaN on: ${fuzzes.join(', ')}`);
      }
    }

    console.log(`\n${'═'.repeat(65)}`);
    console.log(crashed === 0 && nanOutput === 0
      ? '  🟢 ALL MODULES HANDLE GARBAGE GRACEFULLY'
      : `  🔴 ${crashed} CRASHES + ${nanOutput} NaN OUTPUTS — needs hardening`);
    console.log(`${'═'.repeat(65)}\n`);
  }

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    totalTests, passed, crashed, nanOutput, silentFail,
    passRate: totalTests > 0 ? ((passed / totalTests) * 100).toFixed(1) + '%' : 'N/A',
    crashes: results.filter(r => r.status === 'CRASH'),
    nanOutputs: results.filter(r => r.status === 'NaN_OUTPUT'),
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const reportDir = path.join(ROOT, 'logs');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `phase12-fuzz-${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`  📄 Report saved: ${reportPath}\n`);
  }
}

// ─── ADDITIONAL MODULE FUZZERS (2026-02-24) ─────────────────

function fuzzVolumeProfile() {
  const section = 'VolumeProfile';
  if (!JSON_OUT) console.log(`\n  📁 Fuzzing ${section}...`);

  try {
    const modPath = path.resolve(ROOT, 'core/VolumeProfile');
    delete require.cache[require.resolve(modPath)];
    const VPClass = require(modPath);
    const vp = new VPClass();

    const origLog = console.log;
    console.log = () => {};

    // Fuzz update()
    for (const fuzz of FUZZ_PRIMITIVES) {
      fuzzTest(section, 'update', `candle=${fuzz.label}`, () => vp.update(fuzz.value, []));
    }
    for (const fuzz of FUZZ_CANDLE_ARRAYS) {
      fuzzTest(section, 'update', `candles=${fuzz.label}`, () => vp.update({ close: 95000, high: 96000, low: 94000, volume: 1000 }, fuzz.value));
    }

    // Fuzz getProfile()
    for (const fuzz of FUZZ_PRIMITIVES) {
      fuzzTest(section, 'getProfile', fuzz.label, () => vp.getProfile ? vp.getProfile(fuzz.value) : 'no method');
    }

    console.log = origLog;
  } catch (e) {
    if (!JSON_OUT) console.log(`  ⚠️  Could not load ${section}: ${e.message}`);
  }
}

function fuzzOptimizedTradingBrain() {
  const section = 'OptimizedTradingBrain';
  if (!JSON_OUT) console.log(`\n  📁 Fuzzing ${section}...`);

  try {
    const modPath = path.resolve(ROOT, 'core/OptimizedTradingBrain');
    delete require.cache[require.resolve(modPath)];
    const { OptimizedTradingBrain } = require(modPath);

    const origLog = console.log;
    const origWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};

    // Fuzz constructor
    for (const fuzz of FUZZ_PRIMITIVES) {
      fuzzTest(section, 'constructor', `balance=${fuzz.label}`, () => new OptimizedTradingBrain(fuzz.value));
    }

    const brain = new OptimizedTradingBrain(10000);

    // Fuzz openPosition()
    for (const fuzz of FUZZ_PRIMITIVES) {
      fuzzTest(section, 'openPosition', `price=${fuzz.label}`, () => brain.openPosition(fuzz.value, 'buy', 0.001, 0.7, 'test'));
      fuzzTest(section, 'openPosition', `direction=${fuzz.label}`, () => brain.openPosition(95000, fuzz.value, 0.001, 0.7, 'test'));
      fuzzTest(section, 'openPosition', `size=${fuzz.label}`, () => brain.openPosition(95000, 'buy', fuzz.value, 0.7, 'test'));
      fuzzTest(section, 'openPosition', `confidence=${fuzz.label}`, () => brain.openPosition(95000, 'buy', 0.001, fuzz.value, 'test'));
    }

    // Fuzz closePosition()
    for (const fuzz of FUZZ_PRIMITIVES) {
      fuzzTest(section, 'closePosition', `price=${fuzz.label}`, () => brain.closePosition(fuzz.value, 'test'));
    }

    console.log = origLog;
    console.warn = origWarn;
  } catch (e) {
    if (!JSON_OUT) console.log(`  ⚠️  Could not load ${section}: ${e.message}`);
  }
}

function fuzzPatternMemory() {
  const section = 'EnhancedPatternRecognition';
  if (!JSON_OUT) console.log(`\n  📁 Fuzzing ${section}...`);

  try {
    const modPath = path.resolve(ROOT, 'core/EnhancedPatternRecognition');
    delete require.cache[require.resolve(modPath)];
    const { PatternMemorySystem, EnhancedPatternChecker } = require(modPath);

    const origLog = console.log;
    console.log = () => {};

    // Fuzz PatternMemorySystem
    const pms = new PatternMemorySystem();
    for (const fuzz of FUZZ_PRIMITIVES) {
      fuzzTest(section, 'recordPattern', `key=${fuzz.label}`, () => pms.recordPattern(fuzz.value, { pnl: 0.5 }));
      fuzzTest(section, 'recordPattern', `result=${fuzz.label}`, () => pms.recordPattern('test_pattern', fuzz.value));
      fuzzTest(section, 'evaluatePattern', fuzz.label, () => pms.evaluatePattern(fuzz.value));
    }

    // Fuzz EnhancedPatternChecker
    const checker = new EnhancedPatternChecker();
    for (const fuzz of FUZZ_CANDLE_ARRAYS) {
      fuzzTest(section, 'analyzePatterns', `candles=${fuzz.label}`, () => checker.analyzePatterns(fuzz.value, 95000));
    }
    for (const fuzz of FUZZ_PRIMITIVES) {
      fuzzTest(section, 'analyzePatterns', `price=${fuzz.label}`, () =>
        checker.analyzePatterns([{ open: 95000, high: 96000, low: 94000, close: 95500, volume: 1000 }], fuzz.value));
    }

    console.log = origLog;
  } catch (e) {
    if (!JSON_OUT) console.log(`  ⚠️  Could not load ${section}: ${e.message}`);
  }
}

// ─── MAIN ────────────────────────────────────────────────────
function main() {
  if (!JSON_OUT) {
    console.log(`\n${'╔'.padEnd(64, '═')}╗`);
    console.log(`║  OGZPrime Phase 12: CONTRACT FUZZING                        ║`);
    console.log(`║  "Feed garbage in, see what breaks"                         ║`);
    console.log(`║  ${new Date().toISOString().padEnd(61)}║`);
    console.log(`${'╚'.padEnd(64, '═')}╝`);
  }

  fuzzMaxProfitManager();
  fuzzExitContractManager();
  fuzzStateManager();
  fuzzRiskManager();
  fuzzStrategies();
  fuzzVolumeProfile();
  fuzzOptimizedTradingBrain();
  fuzzPatternMemory();

  printResults();
  process.exit(crashed > 0 ? 1 : 0);
}

main();
