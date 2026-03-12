// test/fvg-detector.test.js
'use strict';

const FairValueGapDetector = require('../modules/FairValueGapDetector');

describe('FairValueGapDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new FairValueGapDetector({ minFVGPercent: 0.01, maxFVGPercent: 5.0 }); // Permissive for tests
  });

  describe('Bullish FVG Detection', () => {
    test('detects bullish FVG when c3.low > c1.high', () => {
      // Candle 1: high=100, low=98
      // Candle 2: big up move (gap creator)
      // Candle 3: low=102, high=105 (gap: 100 to 102)
      const candles = [
        { o: 99, h: 100, l: 98, c: 99.5, v: 1000, t: 1000 },
        { o: 100, h: 106, l: 100, c: 105, v: 2000, t: 2000 },
        { o: 105, h: 108, l: 102, c: 107, v: 1500, t: 3000 },
      ];

      const fvg = detector.detect(candles);

      expect(fvg).not.toBeNull();
      expect(fvg.direction).toBe('bullish');
      expect(fvg.gapLow).toBe(100);  // c1.high
      expect(fvg.gapHigh).toBe(102); // c3.low
      expect(fvg.midpoint).toBe(101);
      expect(fvg.firstCandleLow).toBe(98); // Stop level
    });

    test('returns null when no gap exists (c3.low <= c1.high)', () => {
      // No gap - candle 3 low touches candle 1 high
      const candles = [
        { o: 99, h: 100, l: 98, c: 99.5, v: 1000, t: 1000 },
        { o: 100, h: 103, l: 99, c: 102, v: 2000, t: 2000 },
        { o: 102, h: 104, l: 100, c: 103, v: 1500, t: 3000 }, // low=100 touches c1.high=100
      ];

      const fvg = detector.detect(candles, 'bullish');
      expect(fvg).toBeNull();
    });
  });

  describe('Bearish FVG Detection', () => {
    test('detects bearish FVG when c3.high < c1.low', () => {
      // Candle 1: high=105, low=103
      // Candle 2: big down move (gap creator)
      // Candle 3: high=100, low=97 (gap: 100 to 103)
      const candles = [
        { o: 104, h: 105, l: 103, c: 103.5, v: 1000, t: 1000 },
        { o: 103, h: 103, l: 98, c: 99, v: 2000, t: 2000 },
        { o: 99, h: 100, l: 97, c: 98, v: 1500, t: 3000 },
      ];

      const fvg = detector.detect(candles);

      expect(fvg).not.toBeNull();
      expect(fvg.direction).toBe('bearish');
      expect(fvg.gapHigh).toBe(103); // c1.low
      expect(fvg.gapLow).toBe(100);  // c3.high
      expect(fvg.midpoint).toBe(101.5);
      expect(fvg.firstCandleHigh).toBe(105); // Stop level
    });
  });

  describe('Direction Filter', () => {
    test('filters by direction when specified', () => {
      // This creates a bullish FVG
      const candles = [
        { o: 99, h: 100, l: 98, c: 99.5, v: 1000, t: 1000 },
        { o: 100, h: 106, l: 100, c: 105, v: 2000, t: 2000 },
        { o: 105, h: 108, l: 102, c: 107, v: 1500, t: 3000 },
      ];

      expect(detector.detect(candles, 'bullish')).not.toBeNull();
      expect(detector.detect(candles, 'bearish')).toBeNull();
    });
  });

  describe('Minimum Gap Size', () => {
    test('ignores gaps smaller than minFVGPercent', () => {
      const strictDetector = new FairValueGapDetector({ minFVGPercent: 5.0 }); // 5% minimum

      // Small gap (< 5%)
      const candles = [
        { o: 99, h: 100, l: 98, c: 99.5, v: 1000, t: 1000 },
        { o: 100, h: 103, l: 100, c: 102, v: 2000, t: 2000 },
        { o: 102, h: 104, l: 101, c: 103, v: 1500, t: 3000 }, // 1% gap
      ];

      expect(strictDetector.detect(candles)).toBeNull();
    });
  });

  describe('Calculate Levels', () => {
    test('calculates entry, stop, target for bullish FVG', () => {
      const fvg = {
        direction: 'bullish',
        gapHigh: 102,
        gapLow: 100,
        midpoint: 101,
        firstCandleLow: 98,
        firstCandleHigh: 100,
      };

      const levels = detector.calculateLevels(fvg, 'top', 0.05, 2.0);

      expect(levels.entry).toBe(102);        // Top of gap
      expect(levels.stop).toBeCloseTo(97.951, 2); // 98 - 0.05%
      expect(levels.direction).toBe('bullish');

      const expectedRisk = 102 - 97.951;
      expect(levels.risk).toBeCloseTo(expectedRisk, 2);
      expect(levels.target).toBeCloseTo(102 + (expectedRisk * 2), 2);
    });

    test('calculates entry, stop, target for bearish FVG', () => {
      const fvg = {
        direction: 'bearish',
        gapHigh: 103,
        gapLow: 100,
        midpoint: 101.5,
        firstCandleLow: 103,
        firstCandleHigh: 105,
      };

      const levels = detector.calculateLevels(fvg, 'bottom', 0.05, 2.0);

      expect(levels.entry).toBe(103);        // Bottom of gap for bearish
      expect(levels.stop).toBeCloseTo(105.0525, 2); // 105 + 0.05%
      expect(levels.direction).toBe('bearish');
    });
  });

  describe('isFilled', () => {
    test('detects when candle fills the FVG', () => {
      const fvg = { gapHigh: 102, gapLow: 100 };

      // Candle that touches the gap
      expect(detector.isFilled(fvg, { h: 101, l: 99 })).toBe(true);

      // Candle fully inside gap
      expect(detector.isFilled(fvg, { h: 101.5, l: 100.5 })).toBe(true);

      // Candle completely above gap
      expect(detector.isFilled(fvg, { h: 110, l: 105 })).toBe(false);

      // Candle completely below gap
      expect(detector.isFilled(fvg, { h: 98, l: 95 })).toBe(false);
    });
  });

  describe('detectAll', () => {
    test('finds multiple FVGs in sequence', () => {
      const candles = [
        { o: 99, h: 100, l: 98, c: 99.5, v: 1000, t: 1000 },
        { o: 100, h: 106, l: 100, c: 105, v: 2000, t: 2000 },
        { o: 105, h: 108, l: 102, c: 107, v: 1500, t: 3000 }, // FVG #1
        { o: 107, h: 107, l: 103, c: 104, v: 1000, t: 4000 },
        { o: 104, h: 104, l: 99, c: 100, v: 2000, t: 5000 },
        { o: 100, h: 101, l: 97, c: 98, v: 1500, t: 6000 },  // FVG #2 (bearish)
      ];

      const allFvgs = detector.detectAll(candles);

      expect(allFvgs.length).toBe(2);
      expect(allFvgs[0].direction).toBe('bullish');
      expect(allFvgs[1].direction).toBe('bearish');
    });
  });
});
