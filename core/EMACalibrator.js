/**
 * EMACalibrator.js - Find which EMAs the market respects
 *
 * Per Trader DNA: "Every market has its own favorite moving average"
 * This utility tests different EMA periods and finds:
 * 1. Best long-term EMA (trend filter) - price stays on one side
 * 2. Best short-term EMA (entry trigger) - price bounces off cleanly
 */

'use strict';

class EMACalibrator {
  constructor(config = {}) {
    // EMA periods to test
    this.periods = config.periods || [20, 30, 50, 75, 100, 150, 200];

    // Touch detection threshold (percentage from EMA)
    this.touchThreshold = config.touchThreshold || 0.5;  // 0.5%

    // Bounce/slice detection
    this.bounceThreshold = config.bounceThreshold || 0.5;  // 0.5% move away
    this.lookAhead = config.lookAhead || 5;  // candles to check after touch
  }

  /**
   * Calculate EMA for a given period
   */
  calcEMA(closes, period) {
    if (closes.length < period) return [];

    const k = 2 / (period + 1);
    const emas = [];

    // SMA for first value
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;

    // Fill initial values with null
    for (let i = 0; i < period - 1; i++) {
      emas.push(null);
    }
    emas.push(ema);

    // Calculate EMA for remaining
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
      emas.push(ema);
    }

    return emas;
  }

  /**
   * Test a single EMA period for respect rate
   */
  testPeriod(candles, period) {
    const closes = candles.map(c => c.close);
    const emas = this.calcEMA(closes, period);

    let bounces = 0;
    let slices = 0;
    let touches = 0;
    let trendHolds = 0;  // How long price stays on one side

    let currentSide = null;
    let sideStreak = 0;
    let maxStreak = 0;
    let totalStreaks = 0;
    let streakCount = 0;

    for (let i = period; i < candles.length - this.lookAhead; i++) {
      const price = closes[i];
      const ema = emas[i];

      if (!ema) continue;

      // Track which side of EMA price is on (for long-term EMA scoring)
      const side = price > ema ? 'above' : 'below';
      if (side === currentSide) {
        sideStreak++;
        if (sideStreak > maxStreak) maxStreak = sideStreak;
      } else {
        if (sideStreak > 5) {  // Only count meaningful streaks
          totalStreaks += sideStreak;
          streakCount++;
        }
        currentSide = side;
        sideStreak = 1;
      }

      // Check for touch (price within threshold of EMA)
      const distancePct = Math.abs(price - ema) / ema * 100;

      if (distancePct <= this.touchThreshold) {
        touches++;

        // Look ahead to see if price bounces or slices
        let bounced = false;
        let sliced = false;

        for (let j = 1; j <= this.lookAhead; j++) {
          const futurePrice = closes[i + j];
          const futureEma = emas[i + j];
          const futureDistPct = Math.abs(futurePrice - futureEma) / futureEma * 100;

          // Check if price moved away (bounced)
          if (futureDistPct >= this.bounceThreshold) {
            // Determine if it bounced (same side) or sliced (opposite side)
            const wasBullish = price > ema;
            const isBullish = futurePrice > futureEma;

            if (wasBullish === isBullish) {
              bounced = true;  // Stayed on same side = respected EMA
            } else {
              sliced = true;   // Crossed to other side = ignored EMA
            }
            break;
          }
        }

        if (bounced) bounces++;
        if (sliced) slices++;
      }
    }

    const respectRate = touches > 0 ? bounces / touches : 0;
    const avgStreak = streakCount > 0 ? totalStreaks / streakCount : 0;

    return {
      period,
      touches,
      bounces,
      slices,
      respectRate,
      respectPct: (respectRate * 100).toFixed(1),
      maxStreak,
      avgStreak: avgStreak.toFixed(1),
      // Score for short-term (entries): high bounce rate
      shortTermScore: respectRate * (bounces / Math.max(1, touches)),
      // Score for long-term (trend): high streak length
      longTermScore: avgStreak * respectRate
    };
  }

  /**
   * Run calibration on all periods
   */
  calibrate(candles) {
    console.log(`\n===== EMA CALIBRATOR =====`);
    console.log(`Testing ${candles.length} candles across ${this.periods.length} EMA periods`);
    console.log(`Touch threshold: ${this.touchThreshold}%, Bounce threshold: ${this.bounceThreshold}%\n`);

    const results = [];

    for (const period of this.periods) {
      const result = this.testPeriod(candles, period);
      results.push(result);

      console.log(`EMA ${period.toString().padStart(3)}: ` +
                  `${result.touches.toString().padStart(4)} touches, ` +
                  `${result.bounces.toString().padStart(4)} bounces, ` +
                  `${result.slices.toString().padStart(4)} slices | ` +
                  `Respect: ${result.respectPct}% | ` +
                  `MaxStreak: ${result.maxStreak} | ` +
                  `AvgStreak: ${result.avgStreak}`);
    }

    // Find best short-term EMA (highest respect rate)
    const bestShortTerm = results.reduce((best, r) =>
      r.shortTermScore > best.shortTermScore ? r : best
    );

    // Find best long-term EMA (highest trend persistence)
    const bestLongTerm = results.reduce((best, r) =>
      r.longTermScore > best.longTermScore ? r : best
    );

    // Find overall highest respect rate
    const highestRespect = results.reduce((best, r) =>
      r.respectRate > best.respectRate ? r : best
    );

    console.log(`\n===== RESULTS =====`);
    console.log(`Best short-term EMA (entries): ${bestShortTerm.period} (${bestShortTerm.respectPct}% respect)`);
    console.log(`Best long-term EMA (trend):    ${bestLongTerm.period} (avg streak: ${bestLongTerm.avgStreak})`);
    console.log(`Highest respect rate:          ${highestRespect.period} (${highestRespect.respectPct}%)`);

    return {
      shortTermEMA: bestShortTerm.period,
      longTermEMA: bestLongTerm.period,
      highestRespect: highestRespect.period,
      allResults: results
    };
  }
}

// CLI runner
if (require.main === module) {
  const dataPath = process.argv[2] || './data/btc-15m-2024-2025.json';

  console.log(`Loading candles from ${dataPath}...`);
  const candles = require(dataPath);

  const calibrator = new EMACalibrator();
  const results = calibrator.calibrate(candles);

  console.log(`\nRecommendation for MADynamicSR:`);
  console.log(`  emaPeriod: ${results.shortTermEMA}  // For entries`);
  console.log(`  trendEMA:  ${results.longTermEMA}   // For trend filter`);
}

module.exports = EMACalibrator;
