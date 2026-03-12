'use strict';
const { z } = require('zod');

/**
 * Canonical flat indicator snapshot.
 * NO nested indicators.indicators — ever.
 * Every field is explicitly declared and validated at runtime.
 */
const IndicatorSnapshotSchema = z.object({
  timestamp: z.number(),
  indicators: z.object({
    // RSI
    rsi: z.number().min(0).max(100),
    // Moving averages
    ema9: z.number(),
    ema20: z.number(),
    ema50: z.number(),
    ema200: z.number(),
    sma20: z.number().nullable().optional(),
    sma50: z.number().nullable().optional(),
    sma200: z.number().nullable().optional(),
    // Volatility
    atr: z.number().min(0),
    atrPercent: z.number().min(0),
    // Bollinger Bands
    bbUpper: z.number(),
    bbMiddle: z.number(),
    bbLower: z.number(),
    bbWidth: z.number(),
    bbPercentB: z.number(),
    // MACD
    macd: z.number(),
    macdSignal: z.number(),
    macdHistogram: z.number(),
    // Stochastic RSI
    stochRsiK: z.number().nullable().optional(),
    stochRsiD: z.number().nullable().optional(),
    // ADX
    adx: z.number().nullable().optional(),
    plusDI: z.number().nullable().optional(),
    minusDI: z.number().nullable().optional(),
    // Volume
    volume: z.number().min(0),
    vwap: z.number().nullable().optional(),
    obv: z.number().nullable().optional(),
    mfi: z.number().nullable().optional(),
    // Trend
    superTrend: z.number().nullable().optional(),
    superTrendDirection: z.string().nullable().optional(),
    // Price
    price: z.number().positive(),
  }),
  // Optional metadata
  candle: z.object({
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number(),
    timestamp: z.number(),
  }).optional(),
  overlays: z.object({}).passthrough().optional(),
});

/**
 * Validate a snapshot object. Throws ZodError with detailed message if invalid.
 * Call this at EVERY boundary where indicator data is produced or consumed.
 */
function validateSnapshot(raw) {
  return IndicatorSnapshotSchema.parse(raw);
}

/**
 * Safe validation that returns null instead of throwing.
 * Use in non-critical paths (e.g., logging, diagnostics).
 */
function validateSnapshotSafe(raw) {
  const result = IndicatorSnapshotSchema.safeParse(raw);
  if (result.success) return result.data;
  const errMsg = result.error.issues.map(function(i) { return i.path.join('.') + ': ' + i.message; }).join(', ');
  console.error('[DTO] Invalid snapshot:', errMsg);
  return null;
}

module.exports = { IndicatorSnapshotSchema, validateSnapshot, validateSnapshotSafe };
