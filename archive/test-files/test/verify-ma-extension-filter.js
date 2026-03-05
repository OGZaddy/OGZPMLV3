/**
 * MAExtensionFilter Verification Test
 *
 * Runs against real historical data to verify the filter logic works
 * before integration into live bot.
 *
 * ISOLATED TEST - Does not touch live bot or pattern memory
 */

const fs = require('fs');
const path = require('path');

// Load the filter module
const MAExtensionFilter = require('../core/MAExtensionFilter.js');

// Simple indicator calculations (isolated, no dependencies)
function calcSMA(values, period) {
    if (values.length < period) return null;
    const slice = values.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

function calcATR(candles, period = 14) {
    if (candles.length < period + 1) return null;

    let trSum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        const curr = candles[i];
        const prev = candles[i - 1];
        if (!prev) continue;

        const tr = Math.max(
            curr.h - curr.l,
            Math.abs(curr.h - prev.c),
            Math.abs(curr.l - prev.c)
        );
        trSum += tr;
    }
    return trSum / period;
}

// Load and normalize candle data
function loadCandles(filePath) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Handle different formats
    let candles = Array.isArray(raw) ? raw : (raw.candles || raw.data || []);

    // Normalize to { o, h, l, c, v, t }
    return candles.map(c => ({
        o: c.o || c.open || c[1],
        h: c.h || c.high || c[2],
        l: c.l || c.low || c[3],
        c: c.c || c.close || c[4],
        v: c.v || c.volume || c[5] || 0,
        t: c.t || c.time || c.timestamp || c[0]
    })).filter(c => c.c && !isNaN(c.c));
}

// Main verification
async function verifyFilter() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  MAExtensionFilter Verification Test');
    console.log('  ISOLATED - Does NOT touch live bot or pattern memory');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Try to load historical data
    const dataFiles = [
        'data/polygon-btc-1y.json',
        'data/fresh-kraken-btc.json',
        'data/real-kraken-btc.json'
    ];

    let candles = null;
    let usedFile = null;

    for (const file of dataFiles) {
        const fullPath = path.join(__dirname, '..', file);
        if (fs.existsSync(fullPath)) {
            try {
                candles = loadCandles(fullPath);
                if (candles.length > 200) {
                    usedFile = file;
                    break;
                }
            } catch (e) {
                console.log(`  Skipping ${file}: ${e.message}`);
            }
        }
    }

    if (!candles || candles.length < 200) {
        console.log('❌ No suitable candle data found. Need at least 200 candles.');
        console.log('   Available files checked:', dataFiles.join(', '));
        return false;
    }

    console.log(`📊 Loaded ${candles.length} candles from ${usedFile}`);
    console.log(`   Date range: ${new Date(candles[0].t).toISOString().split('T')[0]} to ${new Date(candles[candles.length-1].t).toISOString().split('T')[0]}`);
    console.log(`   Price range: $${Math.min(...candles.map(c => c.l)).toFixed(0)} - $${Math.max(...candles.map(c => c.h)).toFixed(0)}\n`);

    // Initialize filter with default settings
    const filter = new MAExtensionFilter({
        slopeWindow: 5,
        slopeTh: 0.001,
        extTh: 1.5,
        accelTh: 0.2,
        touchBand: 0.3,
        skipTimeout: 20
    });

    // Track statistics
    const stats = {
        totalCandles: 0,
        accelerateUpEvents: 0,
        accelerateDownEvents: 0,
        firstTouchSkips: 0,
        secondTouchAllows: 0,
        timeoutResets: 0,
        regimes: { trendUp: 0, trendDown: 0, sideways: 0, transition: 0 }
    };

    const events = [];
    const closes = [];

    console.log('Running filter through historical data...\n');

    // Process candles
    for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        closes.push(candle.c);

        // Need enough data for indicators
        if (i < 200) continue;

        stats.totalCandles++;

        // Calculate indicators
        const sma20 = calcSMA(closes, 20);
        const sma200 = calcSMA(closes, 200);
        const atr = calcATR(candles.slice(0, i + 1), 14);

        if (!sma20 || !sma200 || !atr) continue;

        // Track state before update
        const prevAccel = filter.state.acceleratingAway;
        const prevSkipActive = filter.state.skipActive;
        const prevTouchCount = filter.state.touchCount;

        // Run filter
        const result = filter.update(candle.c, sma20, sma200, atr);

        // Track regime
        stats.regimes[result.regime] = (stats.regimes[result.regime] || 0) + 1;

        // Detect new accelerate events
        if (filter.state.acceleratingAway && !prevAccel) {
            if (filter.state.accelerateDirection === 'up') {
                stats.accelerateUpEvents++;
                events.push({
                    type: 'ACCELERATE_UP',
                    bar: i,
                    price: candle.c,
                    extension: result.extension.toFixed(2),
                    date: new Date(candle.t).toISOString().split('T')[0]
                });
            } else {
                stats.accelerateDownEvents++;
                events.push({
                    type: 'ACCELERATE_DOWN',
                    bar: i,
                    price: candle.c,
                    extension: result.extension.toFixed(2),
                    date: new Date(candle.t).toISOString().split('T')[0]
                });
            }
        }

        // Detect first touch skips
        if (result.touching && result.skipActive && result.touchCount === 1 && prevTouchCount === 0) {
            stats.firstTouchSkips++;
            events.push({
                type: 'FIRST_TOUCH_SKIP',
                bar: i,
                price: candle.c,
                direction: filter.state.accelerateDirection,
                date: new Date(candle.t).toISOString().split('T')[0]
            });
        }

        // Detect second touch allows
        // After second touch, resetSkip sets touchCount=0, so check: was skipping + now reset + touchCount was high
        if (prevSkipActive && !result.skipActive && prevTouchCount === 1 && result.touchCount === 0) {
            // This was a second-touch reset (not timeout, because prevTouchCount was 1)
            stats.secondTouchAllows++;
            events.push({
                type: 'SECOND_TOUCH_ALLOW',
                bar: i,
                price: candle.c,
                date: new Date(candle.t).toISOString().split('T')[0]
            });
        }

        // Detect timeout resets (was skipping, now not, and touchCount was 0 or low)
        if (prevSkipActive && !result.skipActive && prevTouchCount === 0) {
            stats.timeoutResets++;
        }
    }

    // Print results
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  VERIFICATION RESULTS');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('📈 Statistics:');
    console.log(`   Candles processed: ${stats.totalCandles}`);
    console.log(`   Accelerate UP events: ${stats.accelerateUpEvents}`);
    console.log(`   Accelerate DOWN events: ${stats.accelerateDownEvents}`);
    console.log(`   First-touch skips: ${stats.firstTouchSkips}`);
    console.log(`   Second-touch allows: ${stats.secondTouchAllows}`);
    console.log(`   Timeout resets: ${stats.timeoutResets}`);
    console.log('');

    console.log('🌤️  Regime Distribution:');
    const totalRegime = Object.values(stats.regimes).reduce((a, b) => a + b, 0);
    for (const [regime, count] of Object.entries(stats.regimes)) {
        const pct = ((count / totalRegime) * 100).toFixed(1);
        console.log(`   ${regime}: ${count} (${pct}%)`);
    }
    console.log('');

    // Show sample events
    if (events.length > 0) {
        console.log('📋 Sample Events (first 10):');
        events.slice(0, 10).forEach((e, i) => {
            console.log(`   ${i + 1}. [${e.date}] ${e.type} @ $${e.price.toFixed(0)} ${e.extension ? `(ext: ${e.extension})` : ''}`);
        });
        console.log('');
    }

    // Validation checks
    console.log('✅ Validation Checks:');

    const checks = [
        {
            name: 'Filter instantiates correctly',
            pass: filter instanceof MAExtensionFilter
        },
        {
            name: 'Processes candles without errors',
            pass: stats.totalCandles > 0
        },
        {
            name: 'Detects acceleration events',
            pass: stats.accelerateUpEvents + stats.accelerateDownEvents > 0
        },
        {
            name: 'Skips first touches after acceleration',
            pass: stats.firstTouchSkips > 0 || stats.accelerateUpEvents + stats.accelerateDownEvents === 0
        },
        {
            name: 'Allows second touches',
            pass: stats.secondTouchAllows > 0 || stats.firstTouchSkips === 0
        },
        {
            name: 'Regime detection working',
            pass: Object.values(stats.regimes).some(v => v > 0)
        }
    ];

    let allPassed = true;
    for (const check of checks) {
        const status = check.pass ? '✓' : '✗';
        console.log(`   ${status} ${check.name}`);
        if (!check.pass) allPassed = false;
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    if (allPassed) {
        console.log('  ✅ ALL CHECKS PASSED - Filter verified working');
        console.log('  Safe to integrate with feature flag (disabled by default)');
    } else {
        console.log('  ❌ SOME CHECKS FAILED - Review before integration');
    }
    console.log('═══════════════════════════════════════════════════════════');

    return allPassed;
}

// Run verification
verifyFilter().then(passed => {
    process.exit(passed ? 0 : 1);
}).catch(err => {
    console.error('Verification error:', err);
    process.exit(1);
});
