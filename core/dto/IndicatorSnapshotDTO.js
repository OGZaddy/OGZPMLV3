'use strict';
const { z } = require('zod');

const IndicatorSnapshotSchema = z.object({
  timestamp: z.number().int(),
  indicators: z.object({
    rsi: z.number().min(0).max(100),
    ema9: z.number(),
    ema20: z.number(),
    ema50: z.number(),
    ema200: z.number(),
    sma20: z.number().optional(),
    sma50: z.number().optional(),
    sma200: z.number().optional(),
    atr: z.number().min(0),
    atrPercent: z.number().min(0),
    bbUpper: z.number(),
    bbMiddle: z.number(),
    bbLower: z.number(),
    bbWidth: z.number(),
    bbPercentB: z.number(),
    macd: z.number(),
    macdSignal: z.number(),
    macdHistogram: z.number(),
    stochRsiK: z.number().nullable().optional(),
    stochRsiD: z.number().nullable().optional(),
    adx: z.number().nullable().optional(),
    plusDI: z.number().nullable().optional(),
    minusDI: z.number().nullable().optional(),
    volume: z.number().min(0),
    vwap: z.number().nullable().optional(),
    obv: z.number().nullable().optional(),
    mfi: z.number().nullable().optional(),
    superTrend: z.number().nullable().optional(),
    superTrendDirection: z.string().nullable().optional(),
    price: z.number().positive(),
  }),
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

function validateSnapshot(raw) {
  return IndicatorSnapshotSchema.parse(raw);
}

function validateSnapshotSafe(raw) {
  const result = IndicatorSnapshotSchema.safeParse(raw);
  if (result.success) return result.data;
  console.error('[DTO] Invalid snapshot:', result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '));
  return null;
}

module.exports = { IndicatorSnapshotSchema, validateSnapshot, validateSnapshotSafe };
