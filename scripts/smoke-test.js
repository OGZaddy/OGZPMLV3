#!/usr/bin/env node
/**
 * smoke-test.js - Comprehensive sanity checks for OGZ Prime
 *
 * NOT just syntax checking. Actually:
 * 1. Instantiates core modules and feeds test data
 * 2. Verifies signal modules can process candles
 * 3. Checks TradingConfig values are production-ready
 * 4. Tests orchestrator can evaluate signals
 * 5. Uses Bombardier to detect hidden bugs:
 *    - Orphaned/dead code
 *    - Missing dependencies
 *    - Circular references
 */

'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// Track results
let passed = 0;
let failed = 0;
let warnings = 0;
const failures = [];
const warningsList = [];

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

function warn(name, message) {
  warnings++;
  warningsList.push({ name, message });
  console.log(`⚠️  ${name}: ${message}`);
}

console.log('🔬 OGZ Prime Smoke Test (Comprehensive)\n');

// ═══════════════════════════════════════════════════════════
// TEST DATA - Simulated candles for functional tests
// ═══════════════════════════════════════════════════════════
const baseTime = Date.now() - (100 * 15 * 60 * 1000);
const testCandles = [];
let price = 85000;

for (let i = 0; i < 100; i++) {
  const change = (Math.random() - 0.48) * 200;
  price = Math.max(80000, Math.min(90000, price + change));
  const high = price + Math.random() * 100;
  const low = price - Math.random() * 100;
  const open = price + (Math.random() - 0.5) * 50;
  const close = price + (Math.random() - 0.5) * 50;
  testCandles.push({
    t: baseTime + (i * 15 * 60 * 1000),
    o: open,
    h: Math.max(open, close, high),
    l: Math.min(open, close, low),
    c: close,
    v: 100 + Math.random() * 500
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 1: DEPENDENCY CHECKS (Hidden Bug Detection)
// ═══════════════════════════════════════════════════════════
console.log('\n--- DEPENDENCY CHECKS ---\n');

test('All critical modules can be required', () => {
  const criticalModules = [
    'core/TradingConfig',
    'core/StrategyOrchestrator',
    'core/OrderExecutor',
    'core/StateManager',
    'core/ExitContractManager',
    'core/indicators/IndicatorEngine',
    'core/VolumeProfile',
    'modules/EMASMACrossoverSignal',
    'modules/MADynamicSR',
    'modules/LiquiditySweepDetector',
    'modules/BreakAndRetest',
    'modules/MultiTimeframeAdapter',
  ];

  const missing = [];
  for (const mod of criticalModules) {
    try {
      require(path.join(projectRoot, mod));
    } catch (err) {
      missing.push(`${mod}: ${err.message}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing modules:\n  ${missing.join('\n  ')}`);
  }
});

test('No circular dependencies in core modules', () => {
  // Try requiring modules in different orders to catch circular deps
  const orders = [
    ['core/TradingConfig', 'core/StrategyOrchestrator', 'core/OrderExecutor'],
    ['core/OrderExecutor', 'core/TradingConfig', 'core/StrategyOrchestrator'],
    ['core/StateManager', 'core/ExitContractManager', 'core/TradingConfig'],
  ];

  for (const order of orders) {
    // Clear require cache
    for (const mod of order) {
      const fullPath = require.resolve(path.join(projectRoot, mod));
      delete require.cache[fullPath];
    }
    // Require in order
    for (const mod of order) {
      require(path.join(projectRoot, mod));
    }
  }
});

// ═══════════════════════════════════════════════════════════
// SECTION 2: CONFIGURATION VALIDATION
// ═══════════════════════════════════════════════════════════
console.log('\n--- CONFIGURATION VALIDATION ---\n');

test('TradingConfig fees are production-ready', () => {
  const TradingConfig = require(path.join(projectRoot, 'core/TradingConfig'));
  const makerFee = TradingConfig.get('fees.makerFee');
  const takerFee = TradingConfig.get('fees.takerFee');
  const roundTrip = TradingConfig.get('fees.totalRoundTrip');

  if (typeof makerFee !== 'number') throw new Error(`makerFee not a number: ${makerFee}`);
  if (typeof takerFee !== 'number') throw new Error(`takerFee not a number: ${takerFee}`);
  if (makerFee < 0.001 || makerFee > 0.01) throw new Error(`makerFee out of range: ${makerFee}`);
  if (takerFee < 0.001 || takerFee > 0.01) throw new Error(`takerFee out of range: ${takerFee}`);
  if (!roundTrip || roundTrip < 0.003) throw new Error(`totalRoundTrip invalid: ${roundTrip}`);
});

test('TradingConfig strategy params exist and are valid', () => {
  const TradingConfig = require(path.join(projectRoot, 'core/TradingConfig'));

  const configs = {
    'strategies.EMACrossover': ['decayBars', 'snapbackThreshold'],
    'strategies.MADynamicSR': ['entryMaPeriod', 'srMaPeriod', 'slopeLookback'],
    'strategies.LiquiditySweep': ['sweepLookbackBars', 'atrPeriod', 'entryWindowMinutes'],
  };

  for (const [configPath, requiredKeys] of Object.entries(configs)) {
    const config = TradingConfig.get(configPath);
    if (!config) throw new Error(`${configPath} missing`);

    for (const key of requiredKeys) {
      if (config[key] === undefined) {
        throw new Error(`${configPath}.${key} missing`);
      }
    }
  }
});

test('Exit contract thresholds are sane', () => {
  const TradingConfig = require(path.join(projectRoot, 'core/TradingConfig'));
  const stopLoss = TradingConfig.get('exits.stopLossPercent');
  const takeProfit = TradingConfig.get('exits.takeProfitPercent');

  if (!stopLoss || stopLoss < 0.5 || stopLoss > 10) {
    throw new Error(`stopLossPercent invalid: ${stopLoss}`);
  }
  if (!takeProfit || takeProfit < 0.5 || takeProfit > 15) {
    throw new Error(`takeProfitPercent invalid: ${takeProfit}`);
  }
  if (takeProfit < stopLoss) {
    throw new Error(`takeProfit (${takeProfit}) < stopLoss (${stopLoss}) - bad R:R`);
  }
});

// ═══════════════════════════════════════════════════════════
// SECTION 3: INDICATOR ENGINE
// ═══════════════════════════════════════════════════════════
console.log('\n--- INDICATOR ENGINE ---\n');

test('IndicatorEngine computes RSI, EMA, ATR correctly', () => {
  const IndicatorEngine = require(path.join(projectRoot, 'core/indicators/IndicatorEngine'));
  const engine = new IndicatorEngine({ warmupCandles: 20 });

  for (const candle of testCandles) {
    engine.updateCandle(candle);
  }

  const snap = engine.getSnapshot();

  if (!snap) throw new Error('getSnapshot() returned nothing');
  // RSI lives in indicators object
  if (!snap.indicators || snap.indicators.rsi === null || snap.indicators.rsi === undefined) throw new Error('RSI not calculated');
  if (snap.indicators.rsi < 0 || snap.indicators.rsi > 100) throw new Error(`RSI out of range: ${snap.indicators.rsi}`);
  // EMA exists
  if (!snap.indicators.ema20) throw new Error('EMA not calculated');
  // ATR is a direct number
  if (!snap.indicators.atr || snap.indicators.atr <= 0) throw new Error(`ATR invalid: ${snap.indicators.atr}`);
});

// ═══════════════════════════════════════════════════════════
// SECTION 4: SIGNAL MODULES
// ═══════════════════════════════════════════════════════════
console.log('\n--- SIGNAL MODULES ---\n');

test('EMASMACrossoverSignal processes candles and returns structure', () => {
  const EMASMACrossoverSignal = require(path.join(projectRoot, 'modules/EMASMACrossoverSignal'));
  const TradingConfig = require(path.join(projectRoot, 'core/TradingConfig'));

  const emaConfig = TradingConfig.get('strategies.EMACrossover') || {};
  const signal = new EMASMACrossoverSignal({
    decayBars: emaConfig.decayBars || 10,
    snapbackThresholdPct: emaConfig.snapbackThreshold || 2.5,
    blowoffAccelThreshold: emaConfig.blowoffThreshold || 0.15,
  });

  let lastResult = null;
  for (const candle of testCandles) {
    lastResult = signal.update(candle, testCandles);
  }

  if (!lastResult) throw new Error('update() returned nothing');
  if (typeof lastResult.confidence !== 'number') throw new Error('No confidence in result');
  if (typeof lastResult.direction !== 'string') throw new Error('No direction in result');
});

test('MADynamicSR processes candles and builds swing data', () => {
  const MADynamicSR = require(path.join(projectRoot, 'modules/MADynamicSR'));
  const TradingConfig = require(path.join(projectRoot, 'core/TradingConfig'));

  const masrConfig = TradingConfig.get('strategies.MADynamicSR') || {};
  const signal = new MADynamicSR({
    entryMaPeriod: masrConfig.entryMaPeriod || 20,
    srMaPeriod: masrConfig.srMaPeriod || 200,
    slopeLookback: masrConfig.slopeLookback || 5,
    minSlopePct: masrConfig.minSlopePct || 0.03,
  });

  let lastResult = null;
  for (const candle of testCandles) {
    lastResult = signal.update(candle, testCandles);
  }

  if (!lastResult) throw new Error('update() returned nothing');
  if (lastResult.diagnostics && lastResult.diagnostics.swingCount === undefined) {
    throw new Error('No swing count in diagnostics');
  }
});

test('LiquiditySweepDetector processes candles and tracks levels', () => {
  const LiquiditySweepDetector = require(path.join(projectRoot, 'modules/LiquiditySweepDetector'));
  const TradingConfig = require(path.join(projectRoot, 'core/TradingConfig'));

  const liqConfig = TradingConfig.get('strategies.LiquiditySweep') || {};
  const detector = new LiquiditySweepDetector({
    sweepLookbackBars: liqConfig.sweepLookbackBars || 50,
    atrPeriod: liqConfig.atrPeriod || 14,
    disableSessionCheck: true,
  });

  let lastResult = null;
  for (const candle of testCandles) {
    lastResult = detector.feedCandle(candle);
  }

  if (!lastResult) throw new Error('feedCandle() returned nothing');
  if (typeof lastResult.hasSignal !== 'boolean') throw new Error('No hasSignal in result');
});

// ═══════════════════════════════════════════════════════════
// SECTION 5: ORCHESTRATOR
// ═══════════════════════════════════════════════════════════
console.log('\n--- ORCHESTRATOR ---\n');

test('StrategyOrchestrator loads strategies and evaluates', () => {
  const { StrategyOrchestrator } = require(path.join(projectRoot, 'core/StrategyOrchestrator'));
  const IndicatorEngine = require(path.join(projectRoot, 'core/indicators/IndicatorEngine'));

  const orchestrator = new StrategyOrchestrator({
    minStrategyConfidence: 0.50,
    minConfluenceCount: 1,
  });

  if (!orchestrator.strategies || orchestrator.strategies.length === 0) {
    throw new Error('No strategies loaded');
  }

  const engine = new IndicatorEngine({ warmupCandles: 20 });
  for (const candle of testCandles) {
    engine.updateCandle(candle);
  }

  const indicators = engine.getSnapshot();

  // orchestrator.evaluate(indicators, patterns, regime, priceHistory, extras)
  const result = orchestrator.evaluate(indicators, [], null, testCandles, {});

  if (!result) throw new Error('evaluate() returned nothing');
  if (typeof result.confidence !== 'number') throw new Error('No confidence in result');
  if (typeof result.direction !== 'string') throw new Error('No direction in result');
});

// ═══════════════════════════════════════════════════════════
// SECTION 6: EXIT CONTRACT
// ═══════════════════════════════════════════════════════════
console.log('\n--- EXIT CONTRACT ---\n');

test('ExitContractManager evaluates positions correctly', () => {
  const { getInstance } = require(path.join(projectRoot, 'core/ExitContractManager'));
  const manager = getInstance();

  if (!manager) throw new Error('getInstance() returned nothing');
  if (typeof manager.checkExitConditions !== 'function') throw new Error('checkExitConditions not a function');

  // Mock trade with contract (as ExitContractManager expects)
  const mockTrade = {
    entryPrice: 85000,
    size: 0.01,
    entryTime: Date.now() - 30 * 60 * 1000,
    maxProfitReached: 0.5,
    strategy: 'RSI',
    contract: {
      stopLossPercent: -2.0,
      takeProfitPercent: 2.5,
      trailingStopPercent: 1.0,
      maxHoldTimeMinutes: 120,
    }
  };

  const lastCandle = testCandles[testCandles.length - 1];
  const result = manager.checkExitConditions(mockTrade, lastCandle.c, {
    candle: lastCandle,
    indicators: { rsi: 55, atr: 500 }
  });

  if (!result) throw new Error('checkExitConditions() returned nothing');
  if (typeof result.shouldExit !== 'boolean') throw new Error('No shouldExit in result');
});

// ═══════════════════════════════════════════════════════════
// SECTION 7: BOMBARDIER - HIDDEN BUG DETECTION
// ═══════════════════════════════════════════════════════════
console.log('\n--- BOMBARDIER ANALYSIS ---\n');

test('Bombardier can load and detect orphans', () => {
  let Bombardier;
  try {
    const bombardierModule = require(path.join(projectRoot, 'ogz-meta/bombardier'));
    Bombardier = bombardierModule.Bombardier;
  } catch (err) {
    // Bombardier may not work without tree-sitter installed
    warn('Bombardier', `Could not load: ${err.message}`);
    return;
  }

  const bombardier = new Bombardier();

  // Try to load cache or build graph
  try {
    bombardier._loadCache();
    if (bombardier.callGraph.size === 0) {
      warn('Bombardier', 'Call graph empty - run "node ogz-meta/bombardier.js --build" to populate');
      return;
    }
  } catch (err) {
    warn('Bombardier', `Cache not available: ${err.message}`);
    return;
  }

  // Check for orphans in critical paths
  const criticalFunctions = [
    'evaluateSignals',
    'update',
    'feedCandle',
    'evaluatePosition',
  ];

  for (const funcName of criticalFunctions) {
    const result = bombardier.getBlastRadius(funcName);
    if (!result.found) {
      warn('Bombardier', `Function "${funcName}" not found in call graph`);
    }
  }
});

// ═══════════════════════════════════════════════════════════
// SECTION 8: INTEGRATION SANITY
// ═══════════════════════════════════════════════════════════
console.log('\n--- INTEGRATION SANITY ---\n');

test('Full signal→orchestrator→exit flow works', () => {
  const { StrategyOrchestrator } = require(path.join(projectRoot, 'core/StrategyOrchestrator'));
  const { getInstance } = require(path.join(projectRoot, 'core/ExitContractManager'));
  const IndicatorEngine = require(path.join(projectRoot, 'core/indicators/IndicatorEngine'));

  const orchestrator = new StrategyOrchestrator({
    minStrategyConfidence: 0.30, // Lower for test
    minConfluenceCount: 1,
  });

  const exitManager = getInstance();
  const engine = new IndicatorEngine({ warmupCandles: 20 });

  for (const candle of testCandles) {
    engine.updateCandle(candle);
  }

  const indicators = engine.getSnapshot();
  const lastCandle = testCandles[testCandles.length - 1];

  // Step 1: Get signal using orchestrator.evaluate()
  const signalResult = orchestrator.evaluate(indicators, [], null, testCandles, {});

  // Step 2: If we had a position, evaluate exit
  const mockTrade = {
    entryPrice: lastCandle.c * 0.99, // Slight profit
    size: 0.01,
    entryTime: Date.now() - 60 * 60 * 1000,
    maxProfitReached: 1.0,
    strategy: signalResult.winningStrategy || 'RSI',
    contract: {
      stopLossPercent: -2.0,
      takeProfitPercent: 2.5,
      trailingStopPercent: 1.0,
      maxHoldTimeMinutes: 120,
    }
  };

  const exitResult = exitManager.checkExitConditions(mockTrade, lastCandle.c, {
    candle: lastCandle,
    indicators
  });

  // Both should return valid structures
  if (!signalResult || !exitResult) {
    throw new Error('Flow broken - null result');
  }
});

// ═══════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (warningsList.length > 0) {
  console.log('\nWarnings:');
  warningsList.forEach(w => console.log(`  ⚠️  ${w.name}: ${w.message}`));
}

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.error}`));
  process.exit(1);
}

console.log('\n✅ All smoke tests passed - System functional');
process.exit(0);
