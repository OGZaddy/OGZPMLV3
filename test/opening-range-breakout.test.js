// test/opening-range-breakout.test.js
'use strict';

const OpeningRangeBreakout = require('../modules/OpeningRangeBreakout');

describe('OpeningRangeBreakout', () => {
  let orb;

  // Helper: create timestamp at specific hour/minute on a test date
  const makeTimestamp = (hour, minute = 0) => {
    const d = new Date('2026-03-12T00:00:00Z');
    d.setUTCHours(hour, minute, 0, 0);
    return d.getTime();
  };

  // Helper: create candle
  const candle = (o, h, l, c, t) => ({ o, h, l, c, v: 1000, t });

  beforeEach(() => {
    orb = new OpeningRangeBreakout({
      sessionOpenHourUTC: 14, // 9am EST
      orDurationMinutes: 15,
      fvgScanBars: 10,
      minFVGPercent: 0.01,  // Very permissive for tests
      maxFVGPercent: 5.0,
      entryLevel: 'top',
      stopBufferPct: 0.05,
      targetRR: 2.0,
    });
  });

  describe('State Machine - Opening Range Detection', () => {
    test('sets opening range on first candle at session open', () => {
      // Before session open - no OR set
      const preSession = candle(100, 102, 98, 101, makeTimestamp(13, 55));
      orb.update(preSession);
      expect(orb.getState().openingRange).toBeNull();

      // At session open (14:00 UTC) - OR set
      const sessionOpen = candle(100, 105, 98, 103, makeTimestamp(14, 0));
      orb.update(sessionOpen);

      const state = orb.getState();
      expect(state.state).toBe('WATCHING_FOR_BREAK');
      expect(state.openingRange).not.toBeNull();
      expect(state.openingRange.high).toBe(105);
      expect(state.openingRange.low).toBe(98);
    });

    test('transitions to WATCHING_FOR_BREAK after OR candle', () => {
      const sessionOpen = candle(100, 105, 98, 103, makeTimestamp(14, 0));
      orb.update(sessionOpen);

      expect(orb.getState().state).toBe('WATCHING_FOR_BREAK');
    });
  });

  describe('State Machine - Breakout Detection', () => {
    beforeEach(() => {
      // Set up OR first
      orb.update(candle(100, 105, 98, 103, makeTimestamp(14, 0)));
    });

    test('detects bullish breakout when close > OR high', () => {
      // No breakout yet
      orb.update(candle(103, 104, 102, 103, makeTimestamp(14, 15)));
      expect(orb.getState().breakoutDirection).toBeNull();

      // Bullish breakout: close=106 > OR high=105
      orb.update(candle(104, 108, 103, 106, makeTimestamp(14, 30)));

      const state = orb.getState();
      expect(state.breakoutDirection).toBe('bullish');
      expect(state.state).toBe('WATCHING_FOR_FVG');
    });

    test('detects bearish breakout when close < OR low', () => {
      // Bearish breakout: close=96 < OR low=98
      orb.update(candle(100, 100, 95, 96, makeTimestamp(14, 15)));

      const state = orb.getState();
      expect(state.breakoutDirection).toBe('bearish');
      expect(state.state).toBe('WATCHING_FOR_FVG');
    });

    test('no breakout when close stays within OR', () => {
      orb.update(candle(103, 104, 99, 102, makeTimestamp(14, 15)));
      orb.update(candle(102, 103, 100, 101, makeTimestamp(14, 30)));

      const state = orb.getState();
      expect(state.breakoutDirection).toBeNull();
      expect(state.state).toBe('WATCHING_FOR_BREAK');
    });
  });

  describe('State Machine - FVG Detection After Breakout', () => {
    test('generates bullish signal when FVG appears after bullish breakout', () => {
      // Session open - OR: 98-105
      orb.update(candle(100, 105, 98, 103, makeTimestamp(14, 0)));

      // Breakout candle
      orb.update(candle(104, 108, 103, 107, makeTimestamp(14, 15)));

      // Candles to create FVG: c1.high=108, c2 gap up, c3.low=112 (gap 108-112)
      orb.update(candle(107, 108, 106, 107.5, makeTimestamp(14, 30)));  // c1
      orb.update(candle(108, 115, 108, 114, makeTimestamp(14, 45)));     // c2 (gap creator)
      const signal = orb.update(candle(114, 118, 112, 116, makeTimestamp(15, 0))); // c3 (gap: 108-112)

      expect(signal).not.toBeNull();
      expect(signal.direction).toBe('buy');
      expect(signal.strategy).toBe('OpeningRangeBreakout');
      expect(signal.orderType).toBe('LIMIT');
      expect(signal.fvg).toBeDefined();
      expect(signal.openingRange).toBeDefined();
    });

    test('generates bearish signal when FVG appears after bearish breakout', () => {
      // Session open - OR: 98-105
      orb.update(candle(100, 105, 98, 103, makeTimestamp(14, 0)));

      // Bearish breakout: close=95 < OR low=98
      orb.update(candle(100, 100, 93, 95, makeTimestamp(14, 15)));

      // Candles to create bearish FVG: c1.low=93, c2 gap down, c3.high=88
      orb.update(candle(95, 96, 93, 94, makeTimestamp(14, 30)));    // c1
      orb.update(candle(93, 93, 85, 86, makeTimestamp(14, 45)));     // c2 (gap creator)
      const signal = orb.update(candle(86, 88, 84, 85, makeTimestamp(15, 0))); // c3 (gap: 88-93)

      expect(signal).not.toBeNull();
      expect(signal.direction).toBe('sell');
      expect(signal.strategy).toBe('OpeningRangeBreakout');
    });

    test('transitions to DONE when FVG scan limit exceeded', () => {
      orb = new OpeningRangeBreakout({
        sessionOpenHourUTC: 14,
        fvgScanBars: 3, // Very short scan window
        minFVGPercent: 0.01,
        maxFVGPercent: 5.0,
      });

      // OR and breakout - use overlapping candles to avoid accidental FVG
      orb.update(candle(100, 105, 98, 103, makeTimestamp(14, 0)));
      orb.update(candle(104, 106, 103, 106, makeTimestamp(14, 15))); // Breakout, close>105

      // No FVG in these candles - each candle low touches previous high (no gap)
      // For no bullish FVG: c3.low must be <= c1.high
      orb.update(candle(106, 107, 105, 106.5, makeTimestamp(14, 30))); // low=105 touches prev high
      orb.update(candle(106, 107, 106, 106.5, makeTimestamp(14, 45))); // low=106 touches prev high
      orb.update(candle(106, 107, 106, 106.5, makeTimestamp(15, 0)));
      orb.update(candle(106, 107, 106, 106.5, makeTimestamp(15, 15)));

      expect(orb.getState().state).toBe('DONE');
    });
  });

  describe('Session Reset', () => {
    test('resets state machine on new session date', () => {
      // Day 1 session
      orb.update(candle(100, 105, 98, 103, makeTimestamp(14, 0)));
      expect(orb.getState().state).toBe('WATCHING_FOR_BREAK');

      // Day 2 session (next day at 14:00)
      const nextDay = new Date('2026-03-13T14:00:00Z').getTime();
      orb.update(candle(110, 115, 108, 113, nextDay));

      const state = orb.getState();
      expect(state.openingRange.high).toBe(115);
      expect(state.openingRange.low).toBe(108);
    });
  });

  describe('Signal Quality', () => {
    test('signal includes exit contract hint', () => {
      // Set up for signal
      orb.update(candle(100, 105, 98, 103, makeTimestamp(14, 0)));
      orb.update(candle(104, 108, 103, 107, makeTimestamp(14, 15)));
      orb.update(candle(107, 108, 106, 107.5, makeTimestamp(14, 30)));
      orb.update(candle(108, 115, 108, 114, makeTimestamp(14, 45)));
      const signal = orb.update(candle(114, 118, 112, 116, makeTimestamp(15, 0)));

      expect(signal.exitContractHint).toBeDefined();
      expect(signal.exitContractHint.strategyName).toBe('OpeningRangeBreakout');
      expect(signal.exitContractHint.stopLossPercent).toBeLessThan(0);
      expect(signal.exitContractHint.takeProfitPercent).toBeGreaterThan(0);
    });

    test('signal confidence is reasonable (0.5-0.85)', () => {
      orb.update(candle(100, 105, 98, 103, makeTimestamp(14, 0)));
      orb.update(candle(104, 108, 103, 107, makeTimestamp(14, 15)));
      orb.update(candle(107, 108, 106, 107.5, makeTimestamp(14, 30)));
      orb.update(candle(108, 115, 108, 114, makeTimestamp(14, 45)));
      const signal = orb.update(candle(114, 118, 112, 116, makeTimestamp(15, 0)));

      expect(signal.confidence).toBeGreaterThanOrEqual(0.5);
      expect(signal.confidence).toBeLessThanOrEqual(0.85);
    });
  });

  describe('consumeSignal', () => {
    test('clears pending signal and transitions to DONE', () => {
      // Generate signal
      orb.update(candle(100, 105, 98, 103, makeTimestamp(14, 0)));
      orb.update(candle(104, 108, 103, 107, makeTimestamp(14, 15)));
      orb.update(candle(107, 108, 106, 107.5, makeTimestamp(14, 30)));
      orb.update(candle(108, 115, 108, 114, makeTimestamp(14, 45)));
      orb.update(candle(114, 118, 112, 116, makeTimestamp(15, 0)));

      expect(orb.getState().hasPendingSignal).toBe(true);

      orb.consumeSignal();

      expect(orb.getState().hasPendingSignal).toBe(false);
      expect(orb.getState().state).toBe('DONE');
    });
  });
});
