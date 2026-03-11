// /opt/ogzprime/OGZPMLV2/core/indicators/IndicatorEngine.js
// Empire V2 - Authoritative Indicator Engine (single source of truth)
//
// Usage:
//   const engine = new IndicatorEngine({ tf: '1m', symbol: 'BTC-USD' });
//   engine.updateCandle({ t, o, h, l, c, v });
//   const snap = engine.getSnapshot();
//   const payload = engine.getRenderPacket({ maxPoints: 200 }); // optional chart-ready series
//
// Notes:
// - This module is deterministic: given same candle stream -> same outputs.
// - Fib/Trendlines/SR are heuristic (pivot-based), but deterministic as well.
//
// Candle format expected:
// { t: epoch_ms, o: number, h: number, l: number, c: number, v: number }

// FIX 2026-02-16: Use centralized candle helper for format compatibility
const { c: _c, o: _o, h: _h, l: _l, v: _v } = require('../CandleHelper');

// Import OGZ Two-Pole Oscillator (pure-function implementation)
let computeOgzTpo, detectTpoCrossover;
try {
  const ogzTpo = require('../ogzTwoPoleOscillator');
  computeOgzTpo = ogzTpo.computeOgzTpo;
  detectTpoCrossover = ogzTpo.detectTpoCrossover;
  console.log('[IndicatorEngine] OGZ TPO module loaded successfully');
} catch (e) {
  console.error('[IndicatorEngine] OGZ TPO module error:', e.message);
  console.log('[IndicatorEngine] OGZ TPO oscillator will be disabled');
}

class IndicatorEngine {
  constructor(config = {}) {
    this.config = {
      symbol: config.symbol || 'BTC-USD',
      tf: config.tf || '1m',

      // core lengths
      smaPeriods: config.smaPeriods || [20, 50, 200],
      emaPeriods: config.emaPeriods || [20, 50, 200],
      bbPeriod: config.bbPeriod || 20,
      bbStdDev: config.bbStdDev || 2,
      atrPeriod: config.atrPeriod || 14,

      // RSI + Stoch
      rsiPeriod: config.rsiPeriod || 14,
      stochRsiPeriod: config.stochRsiPeriod || 14,
      stochRsiK: config.stochRsiK || 3,
      stochRsiD: config.stochRsiD || 3,

      // ADX
      adxPeriod: config.adxPeriod || 14,

      // SuperTrend
      superTrendPeriod: config.superTrendPeriod || 10,
      superTrendMultiplier: config.superTrendMultiplier || 3,

      // Keltner Channels
      keltnerPeriod: config.keltnerPeriod || 20,
      keltnerMultiplier: config.keltnerMultiplier || 1.5,

      // Donchian Channels
      donchianPeriod: config.donchianPeriod || 20,

      // macd defaults
      macdFast: config.macdFast || 12,
      macdSlow: config.macdSlow || 26,
      macdSignal: config.macdSignal || 9,

      // MFI
      mfiPeriod: config.mfiPeriod || 14,

      // Two-pole oscillator (existing)
      twoPolePeriod: config.twoPolePeriod || 20,
      twoPoleNormalizeByATR: config.twoPoleNormalizeByATR ?? true,

      // OGZ Two-Pole Oscillator (pure-function implementation)
      ogzTpoEnabled: config.ogzTpoEnabled ?? true,
      ogzTpoLength: config.ogzTpoLength || 20,
      ogzTpoNormLength: config.ogzTpoNormLength || 25,
      ogzTpoVolLength: config.ogzTpoVolLength || 20,
      ogzTpoLagBars: config.ogzTpoLagBars || 4,
      ogzTpoEmitMarkers: config.ogzTpoEmitMarkers ?? true,

      // ichimoku defaults
      ichimokuTenkan: config.ichimokuTenkan || 9,
      ichimokuKijun: config.ichimokuKijun || 26,
      ichimokuSenkouB: config.ichimokuSenkouB || 52,
      ichimokuDisplacement: config.ichimokuDisplacement || 26,

      // pivots for SR, fib, trendlines
      pivotLeft: config.pivotLeft || 3,
      pivotRight: config.pivotRight || 3,
      srClusterPct: config.srClusterPct || 0.0025, // 0.25% clustering tolerance
      maxSRLevels: config.maxSRLevels || 12,

      // trendlines
      trendMinPivots: config.trendMinPivots || 3,
      trendMaxLookback: config.trendMaxLookback || 200,

      // storage
      maxCandles: config.maxCandles || 2000,
      maxSeriesPoints: config.maxSeriesPoints || 400,
    };

    this.candles = []; // rolling candle buffer
    this.state = this._blankState();

    // EMA caches keyed by period
    this.ema = new Map();
    this.macdState = {
      emaFast: null,
      emaSlow: null,
      signalEma: null,
      macd: null,
      signal: null,
      hist: null,
    };

    // RSI state
    this.rsiState = { avgGain: null, avgLoss: null, rsi: null };
    this.stochRsiState = { stoch: null, k: null, d: null, history: [] };

    // ADX state
    this.adxState = { prevH: null, prevL: null, prevC: null, smTR: null, smPDM: null, smMDM: null, pdi: null, mdi: null, dx: null, adx: null };

    // SuperTrend state
    this.superTrendState = { upper: null, lower: null, trend: null, value: null };

    // Keltner state
    this.keltnerState = { ema: null, upper: null, mid: null, lower: null };

    // Donchian state
    this.donchianState = { upper: null, lower: null, mid: null };

    // Volume indicators
    this.obvState = { obv: 0, prevClose: null };
    this.mfiState = { posFlow: [], negFlow: [], mfi: null };

    // Two-pole oscillator (existing)
    this.twoPoleState = { filt: null, filt2: null, osc: null };

    // OGZ TPO (pure-function oscillator) cached result
    this.ogzTpoState = {
      last: null,      // full compute output (tpo,tpoLag,norm,bands,vol)
      signal: null,    // last detected signal
    };

    // ATR state
    this.atrState = {
      prevClose: null,
      atr: null,
    };

    // VWAP (resets by "session" day in UTC unless configured otherwise)
    this.vwapState = {
      sessionKey: null,
      cumPV: 0,
      cumV: 0,
      vwap: null,
    };

    // Ichimoku needs high/low windows
    this.ichimokuState = {
      tenkan: null,
      kijun: null,
      senkouA: null,
      senkouB: null,
      chikou: null,
      // we store forward-shifted values as arrays aligned to candle index
      senkouAForward: [],
      senkouBForward: [],
    };

    // Pivots (for fib, SR, trendlines)
    this.pivots = {
      highs: [], // { i, t, price }
      lows: [],  // { i, t, price }
    };

    // Computed SR levels
    this.sr = {
      supports: [],
      resistances: [],
    };

    // Fib
    this.fib = {
      swing: null, // { from: {t,price}, to: {t,price}, dir: 'up'|'down' }
      levels: {},  // {0:price, 0.236:price, ...}
    };

    // Trendlines
    this.trends = {
      up: null,   // { slope, intercept, points:[...], r2 }
      down: null, // { slope, intercept, points:[...], r2 }
    };

    // Precreate series store (chart-friendly)
    this.series = this._blankSeries();
  }

  _blankState() {
    return {
      symbol: this.config.symbol,
      tf: this.config.tf,
      lastCandle: null,

      sma: {},      // period -> value
      ema: {},      // period -> value
      bb: null,     // { upper, mid, lower }
      bbExtras: null, // { percentB, bandwidth }
      atr: null,    // number
      rsi: null,    // number
      stochRsi: null, // { stoch, k, d }
      adx: null,    // { adx, pdi, mdi }
      superTrend: null, // { value, trend, upper, lower }
      keltner: null,    // { upper, mid, lower }
      donchian: null,   // { upper, mid, lower }
      vwap: null,   // number
      obv: null,    // number
      mfi: null,    // number
      twoPole: null, // { smooth, osc, period, normalized }
      ogzTpo: null, // { tpo, tpoLag, norm, vol, bands, signal }
      macd: null,   // { macd, signal, hist }
      ichimoku: null, // { tenkan,kijun,senkouA,senkouB,chikou, cloudBullish? }
      fib: null,    // { swing, levels }
      sr: null,     // { supports, resistances }
      trendlines: null, // { up, down }
      updatedAt: null,
    };
  }

  _blankSeries() {
    return {
      candles: [], // {t,o,h,l,c,v}
      lines: new Map(), // id -> [{t,y}]
      bands: new Map(), // id -> { upper:[{t,y}], mid:[{t,y}], lower:[{t,y}] }
      panels: new Map(),// id -> [{t,y}] (oscillators)
      markers: [],      // {t,y,kind,label,meta}
    };
  }

  // ---------- Public API ----------

  updateCandle(c) {
    this._validateCandle(c);

    // append / roll
    this.candles.push(c);
    if (this.candles.length > this.config.maxCandles) this.candles.shift();

    this.state.lastCandle = c;

    // core calculations
    this._updateSMA();
    this._updateEMA();
    this._updateBollinger();
    this._updateATR();
    this._updateVWAP();
    this._updateRSI();
    this._updateStochRSI();
    this._updateADX();
    this._updateSuperTrend();
    this._updateKeltner();
    this._updateDonchian();
    this._updateOBV();
    this._updateMFI();
    this._updateTwoPoleOsc();
    this._updateOgzTpo();
    this._updateBollingerExtras();
    this._updateMACD();
    this._updateIchimoku();

    // pivots + derived structures (fib, SR, trendlines)
    this._updatePivots();
    this._updateFib();
    this._updateSupportResistance();
    this._updateTrendlines();

    // update state snapshot
    this.state.sma = this._copyObj(this.state.sma);
    this.state.ema = this._copyObj(this.state.ema);
    this.state.bb = this.state.bb ? { ...this.state.bb } : null;
    this.state.atr = this.atrState.atr;
    this.state.vwap = this.vwapState.vwap;
    this.state.macd = this.macdState.macd == null ? null : {
      macd: this.macdState.macd,
      signal: this.macdState.signal,
      hist: this.macdState.hist,
    };
    this.state.ichimoku = this._getIchimokuSnapshot();
    this.state.fib = this.fib.swing ? { swing: this.fib.swing, levels: { ...this.fib.levels } } : null;
    this.state.sr = { supports: [...this.sr.supports], resistances: [...this.sr.resistances] };
    this.state.trendlines = {
      up: this.trends.up ? { ...this.trends.up, points: [...this.trends.up.points] } : null,
      down: this.trends.down ? { ...this.trends.down, points: [...this.trends.down.points] } : null,
    };
    this.state.updatedAt = Date.now();

    // build render series incrementally (optional but useful)
    this._updateSeries(c);

    return this.getSnapshot();
  }

  computeBatch(candles) {
    // deterministic rebuild from scratch (useful for replay/backfill)
    this._resetAll();
    for (const c of candles) this.updateCandle(c);
    return this.getSnapshot();
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  // Chart-ready packet you can send to dashboard
  getRenderPacket({ maxPoints } = {}) {
    const cap = maxPoints || this.config.maxSeriesPoints;

    const packLines = [];
    for (const [id, pts] of this.series.lines.entries()) {
      packLines.push({ id, points: pts.slice(-cap) });
    }

    const packBands = [];
    for (const [id, band] of this.series.bands.entries()) {
      packBands.push({
        id,
        upper: band.upper.slice(-cap),
        mid: band.mid.slice(-cap),
        lower: band.lower.slice(-cap),
      });
    }

    const packPanels = [];
    for (const [id, pts] of this.series.panels.entries()) {
      packPanels.push({ id, points: pts.slice(-cap) });
    }

    return {
      type: 'market_update',
      symbol: this.config.symbol,
      tf: this.config.tf,
      candle: this.state.lastCandle,
      indicators: {
        sma: this.state.sma,
        ema: this.state.ema,
        bb: this.state.bb,
        bbExtras: this.state.bbExtras,
        atr: this.state.atr,
        rsi: this.state.rsi,
        stochRsi: this.state.stochRsi,
        adx: this.state.adx,
        superTrend: this.state.superTrend,
        keltner: this.state.keltner,
        donchian: this.state.donchian,
        vwap: this.state.vwap,
        obv: this.state.obv,
        mfi: this.state.mfi,
        twoPole: this.state.twoPole,
        ogzTpo: this.state.ogzTpo,
        macd: this.state.macd,
        ichimoku: this.state.ichimoku,
        fib: this.state.fib,
        sr: this.state.sr,
        trendlines: this.state.trendlines,
      },
      overlays: {
        candles: this.series.candles.slice(-cap),
        lines: packLines,
        bands: packBands,
        panels: packPanels,
        markers: this.series.markers.slice(-200),
      },
      timestamp: Date.now(),
      source: 'bot',
    };
  }

  // ---------- Core indicators ----------

  _updateSMA() {
    const closes = this._getCloses();
    for (const p of this.config.smaPeriods) {
      if (closes.length < p) continue;
      const sum = this._sumTail(closes, p);
      this.state.sma[p] = sum / p;
    }
  }

  _updateEMA() {
    const c = this._lastClose();
    if (c == null) return;

    for (const p of this.config.emaPeriods) {
      const prev = this.ema.get(p);
      const k = 2 / (p + 1);

      if (prev == null) {
        // seed EMA with SMA(p) when possible, otherwise first close
        const closes = this._getCloses();
        if (closes.length >= p) {
          const seed = this._sumTail(closes, p) / p;
          this.ema.set(p, seed);
          this.state.ema[p] = seed;
        } else {
          this.ema.set(p, c);
          this.state.ema[p] = c;
        }
      } else {
        const next = (c - prev) * k + prev;
        this.ema.set(p, next);
        this.state.ema[p] = next;
      }
    }
  }

  _updateBollinger() {
    const p = this.config.bbPeriod;
    const closes = this._getCloses();
    if (closes.length < p) return;

    const slice = closes.slice(-p);
    const mean = slice.reduce((a, b) => a + b, 0) / p;
    const variance = slice.reduce((a, b) => a + (b - mean) * (b - mean), 0) / p;
    const sd = Math.sqrt(variance);

    const upper = mean + this.config.bbStdDev * sd;
    const lower = mean - this.config.bbStdDev * sd;

    this.state.bb = { upper, mid: mean, lower };
  }

  _updateBollingerExtras() {
    if (!this.state.bb) return;
    const c = this._lastClose();
    if (c == null) return;

    const { upper, mid, lower } = this.state.bb;
    const denom = (upper - lower);
    const percentB = denom === 0 ? 0 : ((c - lower) / denom) * 100;
    const bandwidth = mid === 0 ? 0 : (denom / mid) * 100;

    this.state.bbExtras = { percentB, bandwidth };
  }

  _updateATR() {
    const candle = this._lastCandle();
    if (!candle) return;

    const prevClose = this.atrState.prevClose;
    const tr = prevClose == null
      ? (_h(candle) - _l(candle))
      : Math.max(
          _h(candle) - _l(candle),
          Math.abs(_h(candle) - prevClose),
          Math.abs(_l(candle) - prevClose)
        );

    const p = this.config.atrPeriod;

    if (this.atrState.atr == null) {
      // seed ATR by SMA of TR once enough candles exist
      const trs = this._computeTRSeries();
      if (trs.length >= p) {
        const seed = this._sumTail(trs, p) / p;
        this.atrState.atr = seed;
      } else {
        this.atrState.atr = tr;
      }
    } else {
      // Wilder's smoothing
      this.atrState.atr = ((this.atrState.atr * (p - 1)) + tr) / p;
    }

    this.atrState.prevClose = _c(candle);
  }

  _updateRSI() {
    const p = this.config.rsiPeriod;
    if (this.candles.length < 2) return;

    const c = this._lastCandle();
    const prev = this.candles[this.candles.length - 2];

    const change = _c(c) - _c(prev);
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (this.rsiState.avgGain == null || this.rsiState.avgLoss == null) {
      // seed with simple average over p once available
      if (this.candles.length < p + 1) return;

      let sumG = 0, sumL = 0;
      for (let i = this.candles.length - p; i < this.candles.length; i++) {
        const cur = this.candles[i];
        const pr = this.candles[i - 1];
        const ch = _c(cur) - _c(pr);
        sumG += Math.max(ch, 0);
        sumL += Math.max(-ch, 0);
      }
      this.rsiState.avgGain = sumG / p;
      this.rsiState.avgLoss = sumL / p;
    } else {
      // Wilder smoothing
      this.rsiState.avgGain = (this.rsiState.avgGain * (p - 1) + gain) / p;
      this.rsiState.avgLoss = (this.rsiState.avgLoss * (p - 1) + loss) / p;
    }

    const rs = this.rsiState.avgLoss === 0 ? Infinity : (this.rsiState.avgGain / this.rsiState.avgLoss);
    const rsi = 100 - (100 / (1 + rs));
    this.rsiState.rsi = isFinite(rsi) ? rsi : 100;

    this.state.rsi = this.rsiState.rsi;
  }

  _updateStochRSI() {
    const p = this.config.stochRsiPeriod;
    const kLen = this.config.stochRsiK;
    const dLen = this.config.stochRsiD;

    // Need RSI series
    const rsiSeries = this._getRSISeries(p + 50); // small lookback buffer
    if (rsiSeries.length < p) return;

    const tail = rsiSeries.slice(-p);
    const minR = Math.min(...tail);
    const maxR = Math.max(...tail);
    const curR = rsiSeries[rsiSeries.length - 1];
    const stoch = (maxR === minR) ? 0 : ((curR - minR) / (maxR - minR)) * 100;

    this.stochRsiState.history.push(stoch);
    if (this.stochRsiState.history.length > 500) this.stochRsiState.history.shift();

    const k = this._smaArrayTail(this.stochRsiState.history, kLen);
    const d = this._smaArrayTail(this.stochRsiState.history.slice(-Math.max(kLen, dLen)), dLen);

    this.stochRsiState.stoch = stoch;
    this.stochRsiState.k = k;
    this.stochRsiState.d = d;

    this.state.stochRsi = { stoch, k, d };
  }

  _getRSISeries(lookback = 200) {
    // build RSI series deterministically from candles (batch) for StochRSI
    const p = this.config.rsiPeriod;
    const cs = this.candles.slice(-lookback);
    if (cs.length < p + 1) return [];

    let avgG = null, avgL = null;
    const out = [];

    for (let i = 1; i < cs.length; i++) {
      const change = _c(cs[i]) - _c(cs[i - 1]);
      const gain = Math.max(change, 0);
      const loss = Math.max(-change, 0);

      if (i === p) {
        // seed
        let sumG = 0, sumL = 0;
        for (let j = 1; j <= p; j++) {
          const ch = _c(cs[j]) - _c(cs[j - 1]);
          sumG += Math.max(ch, 0);
          sumL += Math.max(-ch, 0);
        }
        avgG = sumG / p;
        avgL = sumL / p;
      } else if (i > p) {
        avgG = (avgG * (p - 1) + gain) / p;
        avgL = (avgL * (p - 1) + loss) / p;
      }

      if (i >= p) {
        const rs = avgL === 0 ? Infinity : (avgG / avgL);
        const rsi = 100 - (100 / (1 + rs));
        out.push(isFinite(rsi) ? rsi : 100);
      }
    }
    return out;
  }

  _updateADX() {
    const p = this.config.adxPeriod;
    if (this.candles.length < 2) return;

    const cur = this._lastCandle();
    const prev = this.candles[this.candles.length - 2];

    const upMove = _h(cur) - _h(prev);
    const downMove = _l(prev) - _l(cur);

    const pdm = (upMove > downMove && upMove > 0) ? upMove : 0;
    const mdm = (downMove > upMove && downMove > 0) ? downMove : 0;

    const tr = Math.max(
      _h(cur) - _l(cur),
      Math.abs(_h(cur) - _c(prev)),
      Math.abs(_l(cur) - _c(prev))
    );

    // Wilder smoothing
    if (this.adxState.smTR == null) {
      if (this.candles.length < p + 1) return;

      // seed sums over p
      let sumTR = 0, sumPDM = 0, sumMDM = 0;
      for (let i = this.candles.length - p; i < this.candles.length; i++) {
        const candle = this.candles[i];
        const pr = this.candles[i - 1];
        const up = _h(candle) - _h(pr);
        const down = _l(pr) - _l(candle);
        const _pdm = (up > down && up > 0) ? up : 0;
        const _mdm = (down > up && down > 0) ? down : 0;
        const _tr = Math.max(_h(candle) - _l(candle), Math.abs(_h(candle) - _c(pr)), Math.abs(_l(candle) - _c(pr)));
        sumTR += _tr; sumPDM += _pdm; sumMDM += _mdm;
      }
      this.adxState.smTR = sumTR;
      this.adxState.smPDM = sumPDM;
      this.adxState.smMDM = sumMDM;
    } else {
      this.adxState.smTR = this.adxState.smTR - (this.adxState.smTR / p) + tr;
      this.adxState.smPDM = this.adxState.smPDM - (this.adxState.smPDM / p) + pdm;
      this.adxState.smMDM = this.adxState.smMDM - (this.adxState.smMDM / p) + mdm;
    }

    const smTR = this.adxState.smTR;
    const pdi = smTR === 0 ? 0 : (100 * (this.adxState.smPDM / smTR));
    const mdi = smTR === 0 ? 0 : (100 * (this.adxState.smMDM / smTR));

    const dx = (pdi + mdi === 0) ? 0 : (100 * (Math.abs(pdi - mdi) / (pdi + mdi)));

    // ADX smoothing
    if (this.adxState.adx == null) {
      // seed ADX after enough DX values (approx: need p*2 candles minimum)
      if (this.candles.length < (p * 2)) {
        this.adxState.pdi = pdi; this.adxState.mdi = mdi; this.adxState.dx = dx;
        this.state.adx = null;
        return;
      }
      // compute last p dx values using a quick batch
      const dxs = this._computeDXSeries(p).slice(-p);
      const seed = dxs.reduce((a,b)=>a+b,0) / p;
      this.adxState.adx = seed;
    } else {
      this.adxState.adx = ((this.adxState.adx * (p - 1)) + dx) / p;
    }

    this.adxState.pdi = pdi;
    this.adxState.mdi = mdi;
    this.adxState.dx = dx;

    this.state.adx = { adx: this.adxState.adx, pdi, mdi };
  }

  _computeDXSeries(lookback = 50) {
    // lightweight batch DX builder for seeding
    const p = this.config.adxPeriod;
    const cs = this.candles.slice(-Math.max(lookback, p * 3));
    if (cs.length < p + 2) return [];

    let smTR = null, smPDM = null, smMDM = null;
    const dxs = [];

    for (let i = 1; i < cs.length; i++) {
      const cur = cs[i], prev = cs[i - 1];
      const upMove = _h(cur) - _h(prev);
      const downMove = _l(prev) - _l(cur);
      const pdm = (upMove > downMove && upMove > 0) ? upMove : 0;
      const mdm = (downMove > upMove && downMove > 0) ? downMove : 0;
      const tr = Math.max(_h(cur) - _l(cur), Math.abs(_h(cur) - _c(prev)), Math.abs(_l(cur) - _c(prev)));

      if (i === p) {
        let sumTR = 0, sumPDM = 0, sumMDM = 0;
        for (let j = 1; j <= p; j++) {
          const candle = cs[j], pr = cs[j - 1];
          const up = _h(candle) - _h(pr);
          const down = _l(pr) - _l(candle);
          const _pdm = (up > down && up > 0) ? up : 0;
          const _mdm = (down > up && down > 0) ? down : 0;
          const _tr = Math.max(_h(candle) - _l(candle), Math.abs(_h(candle) - _c(pr)), Math.abs(_l(candle) - _c(pr)));
          sumTR += _tr; sumPDM += _pdm; sumMDM += _mdm;
        }
        smTR = sumTR; smPDM = sumPDM; smMDM = sumMDM;
      } else if (i > p) {
        smTR = smTR - (smTR / p) + tr;
        smPDM = smPDM - (smPDM / p) + pdm;
        smMDM = smMDM - (smMDM / p) + mdm;
      }

      if (i >= p && smTR != null) {
        const pdi = smTR === 0 ? 0 : (100 * (smPDM / smTR));
        const mdi = smTR === 0 ? 0 : (100 * (smMDM / smTR));
        const dx = (pdi + mdi === 0) ? 0 : (100 * (Math.abs(pdi - mdi) / (pdi + mdi)));
        dxs.push(dx);
      }
    }
    return dxs;
  }

  _updateSuperTrend() {
    // Basic SuperTrend using ATR
    const p = this.config.superTrendPeriod;
    const m = this.config.superTrendMultiplier;

    if (this.candles.length < p + 1) return;
    if (this.atrState.atr == null) return;

    const candle = this._lastCandle();
    const hl2 = (_h(candle) + _l(candle)) / 2;
    const atr = this.atrState.atr;

    const basicUpper = hl2 + m * atr;
    const basicLower = hl2 - m * atr;

    // final bands
    const prevUpper = this.superTrendState.upper;
    const prevLower = this.superTrendState.lower;
    const prevTrend = this.superTrendState.trend; // 'up'|'down'|null

    const upper = (prevUpper == null) ? basicUpper : (basicUpper < prevUpper ? basicUpper : prevUpper);
    const lower = (prevLower == null) ? basicLower : (basicLower > prevLower ? basicLower : prevLower);

    let trend = prevTrend;
    if (trend == null) trend = 'up';

    // trend switch logic
    if (trend === 'up' && _c(candle) < lower) trend = 'down';
    else if (trend === 'down' && _c(candle) > upper) trend = 'up';

    const value = (trend === 'up') ? lower : upper;

    this.superTrendState.upper = upper;
    this.superTrendState.lower = lower;
    this.superTrendState.trend = trend;
    this.superTrendState.value = value;

    this.state.superTrend = { value, trend, upper, lower };
  }

  _updateKeltner() {
    // Keltner: EMA(mid) +/- multiplier * ATR
    const p = this.config.keltnerPeriod;
    const m = this.config.keltnerMultiplier;
    const close = this._lastClose();
    if (close == null) return;
    if (this.atrState.atr == null) return;

    const k = 2 / (p + 1);
    if (this.keltnerState.ema == null) this.keltnerState.ema = close;
    else this.keltnerState.ema = (close - this.keltnerState.ema) * k + this.keltnerState.ema;

    const mid = this.keltnerState.ema;
    const atr = this.atrState.atr;
    this.keltnerState.mid = mid;
    this.keltnerState.upper = mid + m * atr;
    this.keltnerState.lower = mid - m * atr;

    this.state.keltner = { upper: this.keltnerState.upper, mid, lower: this.keltnerState.lower };
  }

  _updateDonchian() {
    const p = this.config.donchianPeriod;
    if (this.candles.length < p) return;
    const slice = this.candles.slice(-p);
    let hh = -Infinity, ll = Infinity;
    for (const c of slice) {
      if (c.h > hh) hh = c.h;
      if (c.l < ll) ll = c.l;
    }
    const mid = (hh + ll) / 2;
    this.donchianState.upper = hh;
    this.donchianState.lower = ll;
    this.donchianState.mid = mid;
    this.state.donchian = { upper: hh, mid, lower: ll };
  }

  _updateOBV() {
    const c = this._lastCandle();
    if (!c) return;

    if (this.obvState.prevClose == null) {
      this.obvState.prevClose = c.c;
      this.state.obv = this.obvState.obv;
      return;
    }

    if (c.c > this.obvState.prevClose) this.obvState.obv += (c.v || 0);
    else if (c.c < this.obvState.prevClose) this.obvState.obv -= (c.v || 0);

    this.obvState.prevClose = c.c;
    this.state.obv = this.obvState.obv;
  }

  _updateMFI() {
    const p = this.config.mfiPeriod;
    if (this.candles.length < 2) return;

    const c = this._lastCandle();
    const prev = this.candles[this.candles.length - 2];

    const tp = (c.h + c.l + c.c) / 3;
    const prevTp = (prev.h + prev.l + prev.c) / 3;
    const rawFlow = tp * (c.v || 0);

    if (tp > prevTp) this.mfiState.posFlow.push(rawFlow);
    else if (tp < prevTp) this.mfiState.negFlow.push(rawFlow);
    else {
      this.mfiState.posFlow.push(0);
      this.mfiState.negFlow.push(0);
    }

    // keep windows
    if (this.mfiState.posFlow.length > p) this.mfiState.posFlow.shift();
    if (this.mfiState.negFlow.length > p) this.mfiState.negFlow.shift();

    if (this.mfiState.posFlow.length < p) return;

    const pos = this.mfiState.posFlow.reduce((a,b)=>a+b,0);
    const neg = this.mfiState.negFlow.reduce((a,b)=>a+b,0);
    const mr = neg === 0 ? Infinity : (pos / neg);
    const mfi = 100 - (100 / (1 + mr));
    this.mfiState.mfi = isFinite(mfi) ? mfi : 100;

    this.state.mfi = this.mfiState.mfi;
  }

  _updateTwoPoleOsc() {
    // Two-pole smoothing filter -> oscillator = price - filtered(price)
    const p = this.config.twoPolePeriod;
    const price = this._lastClose();
    if (price == null) return;

    // Simple 2-pole IIR inspired by super-smoother style (deterministic, stable)
    // We implement as two sequential EMAs (a classic "two-pole" smooth)
    const k = 2 / (p + 1);

    if (this.twoPoleState.filt == null) this.twoPoleState.filt = price;
    else this.twoPoleState.filt = (price - this.twoPoleState.filt) * k + this.twoPoleState.filt;

    if (this.twoPoleState.filt2 == null) this.twoPoleState.filt2 = this.twoPoleState.filt;
    else this.twoPoleState.filt2 = (this.twoPoleState.filt - this.twoPoleState.filt2) * k + this.twoPoleState.filt2;

    const smooth = this.twoPoleState.filt2;
    let osc = price - smooth;

    // normalize by ATR (optional) so thresholds are stable across volatility regimes
    if (this.config.twoPoleNormalizeByATR && this.atrState.atr != null && this.atrState.atr > 0) {
      osc = osc / this.atrState.atr;
    }

    this.twoPoleState.osc = osc;

    this.state.twoPole = { smooth, osc, period: p, normalized: !!this.config.twoPoleNormalizeByATR };
  }

  _updateOgzTpo() {
    if (!this.config.ogzTpoEnabled) return;
    if (typeof computeOgzTpo !== 'function') return;

    // Need enough history for stable output
    const need = this.config.ogzTpoNormLength + 5;
    if (this.candles.length < need) {
      this.state.ogzTpo = { ready: false, warmup: `${this.candles.length}/${need}` };
      return;
    }

    // Build arrays (deterministic)
    const closes = [];
    const highs = [];
    const lows = [];
    for (const candle of this.candles) {
      closes.push(_c(candle));
      highs.push(_h(candle));
      lows.push(_l(candle));
    }

    const out = computeOgzTpo({
      closes,
      highs,
      lows,
      tpoLength: this.config.ogzTpoLength,
      normLength: this.config.ogzTpoNormLength,
      volLength: this.config.ogzTpoVolLength,
      lagBars: this.config.ogzTpoLagBars,
    });

    const idx = closes.length - 1;

    // Signal (helper only)
    const sig = detectTpoCrossover ? detectTpoCrossover(out, idx) : null;

    // Cache
    this.ogzTpoState.last = out;
    this.ogzTpoState.signal = sig;

    // Snapshot (latest values only)
    this.state.ogzTpo = {
      ready: true,
      tpo: out.tpo[idx],
      tpoLag: out.tpoLag[idx],
      norm: out.norm[idx],
      vol: out.vol[idx],
      bands: out.bands,
      signal: sig,
      params: {
        tpoLength: this.config.ogzTpoLength,
        normLength: this.config.ogzTpoNormLength,
        volLength: this.config.ogzTpoVolLength,
        lagBars: this.config.ogzTpoLagBars,
      }
    };
  }

  _updateVWAP() {
    const c = this._lastCandle();
    if (!c) return;

    // sessionKey in UTC YYYY-MM-DD
    const d = new Date(c.t);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

    if (this.vwapState.sessionKey !== key) {
      this.vwapState.sessionKey = key;
      this.vwapState.cumPV = 0;
      this.vwapState.cumV = 0;
      this.vwapState.vwap = null;
    }

    const typical = (c.h + c.l + c.c) / 3;
    const v = c.v || 0;

    this.vwapState.cumPV += typical * v;
    this.vwapState.cumV += v;

    if (this.vwapState.cumV > 0) {
      this.vwapState.vwap = this.vwapState.cumPV / this.vwapState.cumV;
    }
  }

  _updateMACD() {
    const close = this._lastClose();
    if (close == null) return;

    const kFast = 2 / (this.config.macdFast + 1);
    const kSlow = 2 / (this.config.macdSlow + 1);
    const kSig  = 2 / (this.config.macdSignal + 1);

    if (this.macdState.emaFast == null) this.macdState.emaFast = close;
    else this.macdState.emaFast = (close - this.macdState.emaFast) * kFast + this.macdState.emaFast;

    if (this.macdState.emaSlow == null) this.macdState.emaSlow = close;
    else this.macdState.emaSlow = (close - this.macdState.emaSlow) * kSlow + this.macdState.emaSlow;

    const macd = this.macdState.emaFast - this.macdState.emaSlow;
    this.macdState.macd = macd;

    if (this.macdState.signalEma == null) this.macdState.signalEma = macd;
    else this.macdState.signalEma = (macd - this.macdState.signalEma) * kSig + this.macdState.signalEma;

    this.macdState.signal = this.macdState.signalEma;
    this.macdState.hist = this.macdState.macd - this.macdState.signal;
  }

  _updateIchimoku() {
    const len = this.candles.length;
    if (len === 0) return;

    const tenkan = this._midpointHighLow(this.config.ichimokuTenkan);
    const kijun  = this._midpointHighLow(this.config.ichimokuKijun);
    const senkouB = this._midpointHighLow(this.config.ichimokuSenkouB);

    if (tenkan != null) this.ichimokuState.tenkan = tenkan;
    if (kijun != null) this.ichimokuState.kijun = kijun;

    // Senkou A = (Tenkan + Kijun)/2, shifted forward
    if (tenkan != null && kijun != null) {
      const senkouA = (tenkan + kijun) / 2;
      this.ichimokuState.senkouA = senkouA;
      this.ichimokuState.senkouAForward[len - 1 + this.config.ichimokuDisplacement] = senkouA;
    }

    // Senkou B shifted forward
    if (senkouB != null) {
      this.ichimokuState.senkouB = senkouB;
      this.ichimokuState.senkouBForward[len - 1 + this.config.ichimokuDisplacement] = senkouB;
    }

    // Chikou = close shifted backward
    const close = this._lastClose();
    const idx = len - 1 - this.config.ichimokuDisplacement;
    this.ichimokuState.chikou = idx >= 0 ? _c(this.candles[idx]) : null;

    // trim forward arrays to avoid unbounded growth
    const max = this.config.maxCandles + this.config.ichimokuDisplacement + 10;
    if (this.ichimokuState.senkouAForward.length > max) this.ichimokuState.senkouAForward = this.ichimokuState.senkouAForward.slice(-max);
    if (this.ichimokuState.senkouBForward.length > max) this.ichimokuState.senkouBForward = this.ichimokuState.senkouBForward.slice(-max);
  }

  _getIchimokuSnapshot() {
    const len = this.candles.length;
    if (len === 0) return null;

    const currentForwardIdx = len - 1;
    const cloudA = this.ichimokuState.senkouAForward[currentForwardIdx];
    const cloudB = this.ichimokuState.senkouBForward[currentForwardIdx];

    const cloudBullish = (cloudA != null && cloudB != null) ? (cloudA >= cloudB) : null;

    return {
      tenkan: this.ichimokuState.tenkan,
      kijun: this.ichimokuState.kijun,
      senkouA: cloudA ?? null,
      senkouB: cloudB ?? null,
      chikou: this.ichimokuState.chikou,
      cloudBullish,
    };
  }

  // ---------- Pivots / SR / Fib / Trendlines ----------

  _updatePivots() {
    // detect pivots with a L/R fractal window
    const L = this.config.pivotLeft;
    const R = this.config.pivotRight;
    const n = this.candles.length;
    if (n < L + R + 1) return;

    const pivotIndex = n - 1 - R;
    const pivotC = this.candles[pivotIndex];

    // find max/min in window
    let isHigh = true;
    let isLow = true;

    for (let i = pivotIndex - L; i <= pivotIndex + R; i++) {
      if (i === pivotIndex) continue;
      const cc = this.candles[i];
      if (_h(cc) >= _h(pivotC)) isHigh = false;
      if (_l(cc) <= _l(pivotC)) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) this._pushPivot(this.pivots.highs, { i: pivotIndex, t: pivotC.t, price: _h(pivotC) });
    if (isLow)  this._pushPivot(this.pivots.lows,  { i: pivotIndex, t: pivotC.t, price: _l(pivotC) });

    // trim pivots to lookback
    const maxLook = Math.max(this.config.trendMaxLookback, 500);
    this.pivots.highs = this.pivots.highs.filter(p => (n - 1 - p.i) <= maxLook);
    this.pivots.lows  = this.pivots.lows.filter(p => (n - 1 - p.i) <= maxLook);
  }

  _pushPivot(arr, p) {
    // prevent duplicates at same index
    const last = arr[arr.length - 1];
    if (last && last.i === p.i) return;
    arr.push(p);
  }

  _updateFib() {
    // Fib from most recent swing
    const highs = this.pivots.highs;
    const lows = this.pivots.lows;
    if (highs.length === 0 || lows.length === 0) return;

    const lastHigh = highs[highs.length - 1];
    const lastLow = lows[lows.length - 1];

    // Determine direction by which pivot is more recent
    let swing = null;

    if (lastHigh.i > lastLow.i) {
      // last event was a high -> downswing
      const after = lows.filter(p => p.i > lastHigh.i);
      const to = after.length ? after[after.length - 1] : lastLow;
      swing = {
        from: { t: lastHigh.t, price: lastHigh.price },
        to: { t: to.t, price: to.price },
        dir: 'down',
      };
    } else {
      // last event was a low -> upswing
      const after = highs.filter(p => p.i > lastLow.i);
      const to = after.length ? after[after.length - 1] : lastHigh;
      swing = {
        from: { t: lastLow.t, price: lastLow.price },
        to: { t: to.t, price: to.price },
        dir: 'up',
      };
    }

    // If swing is degenerate, ignore
    const range = Math.abs(swing.to.price - swing.from.price);
    if (!isFinite(range) || range <= 0) return;

    this.fib.swing = swing;
    this.fib.levels = this._computeFibLevels(swing.from.price, swing.to.price);
  }

  _computeFibLevels(from, to) {
    const hi = Math.max(from, to);
    const lo = Math.min(from, to);
    const diff = hi - lo;

    const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const levels = {};
    for (const r of ratios) {
      // level value from hi down toward lo by r*diff
      levels[r] = hi - (diff * r);
    }
    // extensions (optional)
    const ext = [1.272, 1.618];
    for (const r of ext) {
      levels[r] = hi + (diff * (r - 1));
    }
    return levels;
  }

  _updateSupportResistance() {
    // cluster pivot highs as resistance and pivot lows as support
    const srPct = this.config.srClusterPct;

    const supports = this._clusterLevels(this.pivots.lows.map(p => p.price), srPct);
    const resistances = this._clusterLevels(this.pivots.highs.map(p => p.price), srPct);

    // Keep nearest relevant levels to current price
    const px = this._lastClose();
    if (px != null) {
      supports.sort((a, b) => Math.abs(px - a) - Math.abs(px - b));
      resistances.sort((a, b) => Math.abs(px - a) - Math.abs(px - b));
    }

    this.sr.supports = supports.slice(0, this.config.maxSRLevels).sort((a, b) => a - b);
    this.sr.resistances = resistances.slice(0, this.config.maxSRLevels).sort((a, b) => a - b);
  }

  _clusterLevels(levels, pctTol) {
    const cleaned = levels.filter(v => isFinite(v) && v > 0).sort((a, b) => a - b);
    const clusters = [];

    for (const v of cleaned) {
      let placed = false;
      for (const c of clusters) {
        const tol = c.mean * pctTol;
        if (Math.abs(v - c.mean) <= tol) {
          c.values.push(v);
          c.mean = c.values.reduce((x, y) => x + y, 0) / c.values.length;
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push({ mean: v, values: [v] });
    }

    // return cluster means weighted by count
    clusters.sort((a, b) => b.values.length - a.values.length);
    return clusters.map(c => c.mean);
  }

  _updateTrendlines() {
    // Build 1 uptrend (from pivot lows) + 1 downtrend (from pivot highs)
    this.trends.up = this._fitTrendline(this.pivots.lows);
    this.trends.down = this._fitTrendline(this.pivots.highs);
  }

  _fitTrendline(pivots) {
    const n = this.candles.length;
    const look = this.config.trendMaxLookback;
    const minPts = this.config.trendMinPivots;

    const pts = pivots
      .filter(p => (n - 1 - p.i) <= look)
      .slice(-Math.max(minPts, 10));

    if (pts.length < minPts) return null;

    // Regress y(price) on x(index)
    const xs = pts.map(p => p.i);
    const ys = pts.map(p => p.price);

    const { slope, intercept, r2 } = this._linearRegression(xs, ys);

    return {
      slope,
      intercept,
      r2,
      points: pts.map(p => ({ t: p.t, y: p.price })),
      valueNow: slope * (n - 1) + intercept,
    };
  }

  _linearRegression(xs, ys) {
    const n = xs.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;

    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX;
      num += dx * (ys[i] - meanY);
      den += dx * dx;
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = meanY - slope * meanX;

    // r2
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i++) {
      const pred = slope * xs[i] + intercept;
      ssRes += (ys[i] - pred) ** 2;
      ssTot += (ys[i] - meanY) ** 2;
    }
    const r2 = ssTot === 0 ? 1 : (1 - ssRes / ssTot);

    return { slope, intercept, r2 };
  }

  // ---------- Render series ----------

  _updateSeries(c) {
    // candles
    this.series.candles.push(c);
    if (this.series.candles.length > this.config.maxSeriesPoints * 4) {
      this.series.candles = this.series.candles.slice(-this.config.maxSeriesPoints * 4);
    }

    const t = c.t;

    // SMA / EMA lines
    for (const p of this.config.smaPeriods) {
      const v = this.state.sma[p];
      if (v == null) continue;
      this._pushLine(`sma${p}`, { t, y: v });
    }
    for (const p of this.config.emaPeriods) {
      const v = this.state.ema[p];
      if (v == null) continue;
      this._pushLine(`ema${p}`, { t, y: v });
    }

    // VWAP
    if (this.vwapState.vwap != null) this._pushLine('vwap', { t, y: this.vwapState.vwap });

    // Bollinger band
    if (this.state.bb) {
      this._pushBand('bb', t, this.state.bb.upper, this.state.bb.mid, this.state.bb.lower);
    }

    // Keltner band
    if (this.state.keltner) {
      this._pushBand('keltner', t, this.state.keltner.upper, this.state.keltner.mid, this.state.keltner.lower);
    }

    // Donchian band
    if (this.state.donchian) {
      this._pushBand('donchian', t, this.state.donchian.upper, this.state.donchian.mid, this.state.donchian.lower);
    }

    // SuperTrend overlay line
    if (this.state.superTrend?.value != null) {
      this._pushLine('superTrend', { t, y: this.state.superTrend.value });
    }

    // ATR panel
    if (this.atrState.atr != null) this._pushPanel('atr', { t, y: this.atrState.atr });

    // RSI panel
    if (this.state.rsi != null) this._pushPanel('rsi', { t, y: this.state.rsi });

    // StochRSI panel
    if (this.state.stochRsi?.k != null) this._pushPanel('stochRsiK', { t, y: this.state.stochRsi.k });
    if (this.state.stochRsi?.d != null) this._pushPanel('stochRsiD', { t, y: this.state.stochRsi.d });

    // ADX panel
    if (this.state.adx?.adx != null) this._pushPanel('adx', { t, y: this.state.adx.adx });

    // MACD panel
    if (this.macdState.macd != null) {
      this._pushPanel('macd', { t, y: this.macdState.macd });
      this._pushPanel('macdSignal', { t, y: this.macdState.signal });
      this._pushPanel('macdHist', { t, y: this.macdState.hist });
    }

    // Two-pole osc panel
    if (this.state.twoPole?.osc != null) {
      this._pushPanel('twoPoleOsc', { t, y: this.state.twoPole.osc });
    }

    // OGZ TPO panels
    if (this.state.ogzTpo?.ready) {
      if (this.state.ogzTpo.tpo != null) this._pushPanel('ogzTpo', { t, y: this.state.ogzTpo.tpo });
      if (this.state.ogzTpo.tpoLag != null) this._pushPanel('ogzTpoLag', { t, y: this.state.ogzTpo.tpoLag });
      if (this.state.ogzTpo.norm != null) this._pushPanel('ogzTpoNorm', { t, y: this.state.ogzTpo.norm });

      // Optional markers for high-probability crosses
      const sig = this.state.ogzTpo.signal;
      if (this.config.ogzTpoEmitMarkers && sig && sig.action && sig.highProbability) {
        this.series.markers.push({
          t,
          y: c.c,
          kind: 'ogzTpoSignal',
          label: `OGZ TPO ${sig.action} (${sig.zone})`,
          meta: sig,
        });
      }
    }

    // OBV / MFI panels
    if (this.state.obv != null) this._pushPanel('obv', { t, y: this.state.obv });
    if (this.state.mfi != null) this._pushPanel('mfi', { t, y: this.state.mfi });

    // BB extras panels
    if (this.state.bbExtras?.percentB != null) this._pushPanel('bbPercentB', { t, y: this.state.bbExtras.percentB });
    if (this.state.bbExtras?.bandwidth != null) this._pushPanel('bbBandwidth', { t, y: this.state.bbExtras.bandwidth });

    // Ichimoku lines + cloud bands
    const ich = this.state.ichimoku;
    if (ich?.tenkan != null) this._pushLine('ichTenkan', { t, y: ich.tenkan });
    if (ich?.kijun != null) this._pushLine('ichKijun', { t, y: ich.kijun });
    if (ich?.senkouA != null) this._pushLine('ichSenkouA', { t, y: ich.senkouA });
    if (ich?.senkouB != null) this._pushLine('ichSenkouB', { t, y: ich.senkouB });

    // Trendlines as simple 2-point lines spanning lookback window
    const n = this.candles.length;
    const idxNow = n - 1;
    const tNow = c.t;
    const firstIdx = Math.max(0, idxNow - this.config.trendMaxLookback);
    const tFirst = this.candles[firstIdx]?.t ?? tNow;

    if (this.trends.up) {
      this._setLine2('trendUp', [
        { t: tFirst, y: this.trends.up.slope * firstIdx + this.trends.up.intercept },
        { t: tNow,   y: this.trends.up.slope * idxNow + this.trends.up.intercept },
      ]);
    }
    if (this.trends.down) {
      this._setLine2('trendDown', [
        { t: tFirst, y: this.trends.down.slope * firstIdx + this.trends.down.intercept },
        { t: tNow,   y: this.trends.down.slope * idxNow + this.trends.down.intercept },
      ]);
    }

    // Fib levels as horizontal lines (latest swing)
    if (this.fib?.levels && Object.keys(this.fib.levels).length) {
      for (const [k, v] of Object.entries(this.fib.levels)) {
        const id = `fib_${k}`;
        this._setLine2(id, [
          { t: tFirst, y: v },
          { t: tNow,   y: v },
        ]);
      }
    }

    // SR levels as horizontal lines
    if (this.sr.supports.length) {
      for (let i = 0; i < this.sr.supports.length; i++) {
        const v = this.sr.supports[i];
        this._setLine2(`sup_${i}`, [{ t: tFirst, y: v }, { t: tNow, y: v }]);
      }
    }
    if (this.sr.resistances.length) {
      for (let i = 0; i < this.sr.resistances.length; i++) {
        const v = this.sr.resistances[i];
        this._setLine2(`res_${i}`, [{ t: tFirst, y: v }, { t: tNow, y: v }]);
      }
    }
  }

  _pushLine(id, pt) {
    if (!this.series.lines.has(id)) this.series.lines.set(id, []);
    const arr = this.series.lines.get(id);
    arr.push(pt);
    if (arr.length > this.config.maxSeriesPoints * 4) this.series.lines.set(id, arr.slice(-this.config.maxSeriesPoints * 4));
  }

  _setLine2(id, pts2) {
    // overwrite with just 2 points so it renders as a line segment
    this.series.lines.set(id, pts2);
  }

  _pushBand(id, t, upper, mid, lower) {
    if (!this.series.bands.has(id)) this.series.bands.set(id, { upper: [], mid: [], lower: [] });
    const b = this.series.bands.get(id);
    b.upper.push({ t, y: upper });
    b.mid.push({ t, y: mid });
    b.lower.push({ t, y: lower });

    const cap = this.config.maxSeriesPoints * 4;
    if (b.upper.length > cap) {
      b.upper = b.upper.slice(-cap);
      b.mid = b.mid.slice(-cap);
      b.lower = b.lower.slice(-cap);
      this.series.bands.set(id, b);
    }
  }

  _pushPanel(id, pt) {
    if (!this.series.panels.has(id)) this.series.panels.set(id, []);
    const arr = this.series.panels.get(id);
    arr.push(pt);
    if (arr.length > this.config.maxSeriesPoints * 4) this.series.panels.set(id, arr.slice(-this.config.maxSeriesPoints * 4));
  }

  // ---------- Helpers ----------

  _resetAll() {
    this.candles = [];
    this.state = this._blankState();
    this.ema = new Map();
    this.macdState = { emaFast: null, emaSlow: null, signalEma: null, macd: null, signal: null, hist: null };
    this.rsiState = { avgGain: null, avgLoss: null, rsi: null };
    this.stochRsiState = { stoch: null, k: null, d: null, history: [] };
    this.adxState = { prevH: null, prevL: null, prevC: null, smTR: null, smPDM: null, smMDM: null, pdi: null, mdi: null, dx: null, adx: null };
    this.superTrendState = { upper: null, lower: null, trend: null, value: null };
    this.keltnerState = { ema: null, upper: null, mid: null, lower: null };
    this.donchianState = { upper: null, lower: null, mid: null };
    this.obvState = { obv: 0, prevClose: null };
    this.mfiState = { posFlow: [], negFlow: [], mfi: null };
    this.twoPoleState = { filt: null, filt2: null, osc: null };
    this.atrState = { prevClose: null, atr: null };
    this.vwapState = { sessionKey: null, cumPV: 0, cumV: 0, vwap: null };
    this.ichimokuState = { tenkan: null, kijun: null, senkouA: null, senkouB: null, chikou: null, senkouAForward: [], senkouBForward: [] };
    this.pivots = { highs: [], lows: [] };
    this.sr = { supports: [], resistances: [] };
    this.fib = { swing: null, levels: {} };
    this.trends = { up: null, down: null };
    this.series = this._blankSeries();
  }

  _validateCandle(candle) {
    // Use helper to validate both formats work
    const o = _o(candle), high = _h(candle), low = _l(candle), close = _c(candle), vol = _v(candle);
    if (o == null || high == null || low == null || close == null) {
      throw new Error(`IndicatorEngine: missing candle OHLC fields`);
    }
    if (!isFinite(o) || !isFinite(high) || !isFinite(low) || !isFinite(close)) {
      throw new Error(`IndicatorEngine: candle OHLC values not finite`);
    }
    if (high < low) throw new Error(`IndicatorEngine: candle invalid h<l (h=${high}, l=${low})`);
  }

  _lastCandle() {
    return this.candles[this.candles.length - 1] || null;
  }

  _lastClose() {
    const candle = this._lastCandle();
    return candle ? _c(candle) : null;
  }

  _getCloses() {
    return this.candles.map(x => _c(x));
  }

  _sumTail(arr, n) {
    let s = 0;
    for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
    return s;
  }

  _computeTRSeries() {
    const trs = [];
    let prevClose = null;
    for (const candle of this.candles) {
      const tr = prevClose == null
        ? (_h(candle) - _l(candle))
        : Math.max(
            _h(candle) - _l(candle),
            Math.abs(_h(candle) - prevClose),
            Math.abs(_l(candle) - prevClose)
          );
      trs.push(tr);
      prevClose = _c(candle);
    }
    return trs;
  }

  _midpointHighLow(period) {
    if (this.candles.length < period) return null;
    const slice = this.candles.slice(-period);
    let hh = -Infinity, ll = Infinity;
    for (const candle of slice) {
      if (_h(candle) > hh) hh = _h(candle);
      if (_l(candle) < ll) ll = _l(candle);
    }
    if (!isFinite(hh) || !isFinite(ll)) return null;
    return (hh + ll) / 2;
  }

  _smaArrayTail(arr, n) {
    if (!arr || arr.length < n) return null;
    let sum = 0;
    for (let i = arr.length - n; i < arr.length; i++) sum += arr[i];
    return sum / n;
  }

  _copyObj(o) {
    return Object.assign({}, o);
  }
}

module.exports = IndicatorEngine;