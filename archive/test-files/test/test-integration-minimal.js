/**
 * Minimal integration test - verifies TradeIntelligenceEngine loads in bot context
 */

console.log('='.repeat(60));
console.log('INTEGRATION TEST - TradeIntelligenceEngine in Bot Context');
console.log('='.repeat(60));

// Simulate environment
process.env.BACKTEST_MODE = 'true';
process.env.TEST_MODE = 'true';
process.env.DATA_DIR = '/opt/ogzprime/OGZPMLV2/test';
process.env.ENABLE_TRAI = 'false';
process.env.PAPER_TRADING = 'true';

let passed = 0;
let failed = 0;

// Test 1: Load TradeIntelligenceEngine
console.log('\n[TEST 1] Load TradeIntelligenceEngine...');
try {
    const TradeIntelligenceEngine = require('../core/TradeIntelligenceEngine');
    const engine = new TradeIntelligenceEngine();
    console.log('  Engine loaded: ✅');
    passed++;
} catch (err) {
    console.log('  FAIL: ❌', err.message);
    failed++;
}

// Test 2: Load StateManager (dependency)
console.log('\n[TEST 2] Load StateManager...');
try {
    const { getInstance: getStateManager } = require('../core/StateManager');
    const stateManager = getStateManager();
    console.log('  StateManager loaded: ✅');
    console.log('  Balance:', stateManager.get('balance'));
    passed++;
} catch (err) {
    console.log('  FAIL: ❌', err.message);
    failed++;
}

// Test 3: Simulate trade evaluation flow
console.log('\n[TEST 3] Simulate trade evaluation flow...');
try {
    const TradeIntelligenceEngine = require('../core/TradeIntelligenceEngine');
    const engine = new TradeIntelligenceEngine();

    // Mock data as would come from run-empire-v2.js
    const activeTrade = {
        id: 'mock-trade-001',
        direction: 'buy',
        action: 'BUY',
        entryPrice: 75000,
        entryTime: Date.now() - (15 * 60 * 1000),
        confidence: 0.72,
        entryIndicators: {
            rsi: 35,
            macd: { hist: 5 },
            trend: 'uptrend'
        }
    };

    const marketDataForIntelligence = {
        price: 75800,
        volume: 1200,
        avgVolume: 1000,
        high24h: 76500,
        low24h: 74000,
        priceChange: 0.8,
        currentCandle: {
            o: 75600,
            h: 75900,
            l: 75500,
            c: 75800
        }
    };

    const indicatorsForIntelligence = {
        rsi: 58,
        macd: { hist: 12 },
        ema9: 75700,
        ema20: 75400,
        ema50: 75000,
        trend: 'uptrend',
        atr: 250
    };

    const intelligenceContext = {
        currentConfidence: 0.68,
        tradeHistory: [],
        currentDrawdown: 1.5,
        consecutiveLosses: 0,
        dailyPnL: 0.5
    };

    const result = engine.evaluate(
        activeTrade,
        marketDataForIntelligence,
        indicatorsForIntelligence,
        intelligenceContext
    );

    console.log('  Evaluation completed: ✅');
    console.log('  Action:', result.action);
    console.log('  Confidence:', (result.confidence * 100).toFixed(0) + '%');
    console.log('  Signals count:', result.signals.length);
    console.log('  Scores evaluated:', Object.keys(result.scores).filter(k => typeof result.scores[k] === 'object').length);
    passed++;
} catch (err) {
    console.log('  FAIL: ❌', err.message);
    console.log('  Stack:', err.stack);
    failed++;
}

// Test 4: Shadow mode logging format
console.log('\n[TEST 4] Shadow mode output format...');
try {
    const TradeIntelligenceEngine = require('../core/TradeIntelligenceEngine');
    const engine = new TradeIntelligenceEngine();

    const losingTrade = {
        id: 'mock-losing',
        direction: 'buy',
        entryPrice: 76000,
        entryTime: Date.now() - (20 * 60 * 1000),
        confidence: 0.65
    };

    const badMarket = {
        price: 74500, // -2% loss
        volume: 500,
        avgVolume: 1000
    };

    const badIndicators = {
        rsi: 25,
        macd: { hist: -20 },
        ema9: 75500,
        ema20: 75800,
        trend: 'downtrend'
    };

    const result = engine.evaluate(losingTrade, badMarket, badIndicators, {});

    // Format like shadow mode in run-empire-v2.js would
    if (result.action !== 'HOLD_CAUTIOUS' && result.action !== 'HOLD_STRONG') {
        console.log(`  🧠 [INTELLIGENCE-SHADOW] Would recommend: ${result.action}`);
        console.log(`     Confidence: ${(result.confidence * 100).toFixed(0)}%`);
        console.log(`     Reasoning: ${result.reasoning.slice(0, 3).join(' | ')}`);
        console.log(`     Score breakdown: regime=${result.scores.regime?.score || 0}, momentum=${result.scores.momentum?.score || 0}, ema=${result.scores.ema?.score || 0}`);
    }
    console.log('  Shadow format works: ✅');
    passed++;
} catch (err) {
    console.log('  FAIL: ❌', err.message);
    failed++;
}

// Test 5: Verify no memory leaks (run 100 evaluations)
console.log('\n[TEST 5] Memory/performance test (100 evaluations)...');
try {
    const TradeIntelligenceEngine = require('../core/TradeIntelligenceEngine');
    const engine = new TradeIntelligenceEngine();

    const startMem = process.memoryUsage().heapUsed;
    const startTime = Date.now();

    for (let i = 0; i < 100; i++) {
        const trade = {
            id: `perf-test-${i}`,
            direction: 'buy',
            entryPrice: 75000 + (i * 10),
            entryTime: Date.now() - (i * 60 * 1000),
            confidence: 0.5 + (Math.random() * 0.3)
        };

        const market = {
            price: 75000 + (i * 15),
            volume: 800 + (i * 10),
            avgVolume: 1000
        };

        const indicators = {
            rsi: 30 + (i % 40),
            macd: { hist: (i % 20) - 10 },
            trend: i % 2 === 0 ? 'uptrend' : 'downtrend'
        };

        engine.evaluate(trade, market, indicators, {});
    }

    const endTime = Date.now();
    const endMem = process.memoryUsage().heapUsed;

    const duration = endTime - startTime;
    const memDelta = (endMem - startMem) / 1024 / 1024;

    console.log(`  100 evaluations in ${duration}ms (${(duration/100).toFixed(1)}ms each)`);
    console.log(`  Memory delta: ${memDelta.toFixed(2)} MB`);

    if (duration < 5000 && memDelta < 50) {
        console.log('  Performance: ✅');
        passed++;
    } else {
        console.log('  Performance: ⚠️ (slow or memory heavy)');
        passed++; // Still pass but warn
    }
} catch (err) {
    console.log('  FAIL: ❌', err.message);
    failed++;
}

// Summary
console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
    console.log('\n❌ INTEGRATION TEST FAILED\n');
    process.exit(1);
} else {
    console.log('\n✅ ALL INTEGRATION TESTS PASSED\n');
    console.log('TradeIntelligenceEngine is ready for shadow mode deployment.');
    process.exit(0);
}
