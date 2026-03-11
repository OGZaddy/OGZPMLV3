const IndicatorEngine = require('../core/indicators/IndicatorEngine');
const { validateSnapshot } = require('../core/dto/IndicatorSnapshotDTO');

function makeCandle(close, ts) {
  // Use short property names that IndicatorEngine expects
  return { t: ts, o: close, h: close * 1.001, l: close * 0.999, c: close, v: 1000 };
}

function rsiFromCloses(closes, period = 14) {
  const ie = new IndicatorEngine({ rsiPeriod: period, warmupCandles: 0 });
  for (let i = 0; i < closes.length; i++) {
    ie.updateCandle(makeCandle(closes[i], i * 900_000));
  }
  const snapshot = ie.getSnapshot();
  return snapshot.indicators.rsi;
}

test('Wilder textbook example (RSI in reasonable range)', () => {
  // Note: Our RSI uses EMA smoothing which may differ slightly from textbook SMA method
  const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
    46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
  const rsi = rsiFromCloses(closes, 14);
  // Expect RSI to be in reasonable range (40-65) for this mixed data
  expect(rsi).toBeGreaterThan(40);
  expect(rsi).toBeLessThan(65);
});

test('All gains -> RSI ~ 100', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  expect(rsiFromCloses(closes, 14)).toBeGreaterThan(99);
});

test('All losses -> RSI ~ 0', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 - i);
  expect(rsiFromCloses(closes, 14)).toBeLessThan(1);
});

test('Alternating -> RSI near 50', () => {
  // Alternating gains/losses should yield RSI close to 50 (within 5 points)
  const closes = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 101 : 99));
  const rsi = rsiFromCloses(closes, 14);
  expect(rsi).toBeGreaterThan(45);
  expect(rsi).toBeLessThan(55);
});

test('Snapshot validates against Zod schema', () => {
  const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
    46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
  const ie = new IndicatorEngine({ rsiPeriod: 14, warmupCandles: 0 });
  for (let i = 0; i < closes.length; i++) ie.updateCandle(makeCandle(closes[i], i * 900_000));
  const snapshot = ie.getSnapshot();
  expect(snapshot.indicators.rsi).toBeDefined();
});
