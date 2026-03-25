/**
 * SmartMoneySweep.js — OGZPrime Strategy Module
 * ==============================================================
 * Port of SmartMoneySweep v4 PineScript to Node.js.
 * PineScript answer key: TSLA 15m, 207 trades, PF 1.555.
 *
 * ARCHITECTURE:
 *   Self-contained module. Computes its own Volume Profile (VAH/VAL/POC/LVN),
 *   IVB range, candle classification (absorption/initiative/CVD/exhaustion),
 *   sweep detection, and confidence scoring — all from raw candle history.
 *   No external indicator dependencies except ATR for TP calculation.
 *
 * INTEGRATION:
 *   const sms = new SmartMoneySweep(config);
 *   const signal = sms.update(candle, priceHistory);
 *   // signal = { direction, confidence, reason, conditionsMet, overrideLevels, ... } or null
 *
 * @module modules/SmartMoneySweep
 */

'use strict';

const { c, o, h, l, v, t } = require('../core/CandleHelper');

class SmartMoneySweep {
  constructor(config = {}) {
    // ─── Volume Profile Config ───
    this.vpDays = config.vpDays || 5;
    this.vpBins = config.vpBins || 50;
    this.valueAreaPct = config.valueAreaPct || 70;
    this.bodyWeightPct = config.bodyWeightPct || 70;
    this.lvnPctile = config.lvnPctile || 20;

    // ─── IVB Config ───
    this.ivbMinutes = config.ivbMinutes || 30;
    this.cashSessionStart = config.cashSessionStartHour || 9;
    this.cashSessionStartMin = config.cashSessionStartMinute || 30;
    this.cashSessionEndHour = config.cashSessionEndHour || 16;
    this.cashSessionEndMin = config.cashSessionEndMinute || 0;

    // ─── Candle Classification Config ───
    this.volAvgLen = config.volAvgLen || 20;
    this.absorbBodyPct = config.absorbBodyPct || 35;
    this.absorbWickPct = config.absorbWickPct || 60;
    this.absorbVolMult = config.absorbVolMult || 1.2;
    this.initBodyPct = config.initBodyPct || 60;
    // Progress thresholds (relaxed versions)
    this.absorbBodyProgPct = config.absorbBodyProgPct || 50;
    this.absorbWickProgPct = config.absorbWickProgPct || 40;
    this.absorbVolProgMult = config.absorbVolProgMult || 0.9;
    this.initBodyProgPct = config.initBodyProgPct || 45;

    // ─── CVD Config ───
    this.cvdDivLen = config.cvdDivLen || 10;

    // ─── Exit Config ───
    this.atrLen = config.atrLen || 14;
    this.lowConvATRMult = config.lowConvATRMult || 0.5;
    this.midConvATRMult = config.midConvATRMult || 1.0;
    this.highConvATRMult = config.highConvATRMult || 1.5;
    this.slBufferPct = config.slBufferPct || 0.15;
    this.maxLossPct = config.maxLossPct || 0.3;
    this.maxHoldBars = config.maxHoldBars || 60;
    this.maxDailyLosses = config.maxDailyLosses || 3;

    // ─── Session Filter ───
    this.useSessionFilter = config.useSessionFilter !== false;
    this.validSessionStartHour = config.validSessionStartHour || 9;
    this.validSessionStartMin = config.validSessionStartMinute || 45;
    this.validSessionEndHour = config.validSessionEndHour || 15;
    this.validSessionEndMin = config.validSessionEndMinute || 45;

    // ─── Internal State ───
    this.ivbHigh = null;
    this.ivbLow = null;
    this.ivbLocked = false;
    this.ivbBarCount = 0;
    this.ivbDirection = 0;  // 0=none, 1=long, -1=short
    this.sessionDay = -1;

    this.cvd = 0;
    this.dailyLosses = 0;

    this.lastLongSweepBar = -1;
    this.lastShortSweepBar = -1;

    // Candle index counter (since we don't have bar_index)
    this.barIndex = 0;
  }

  // ═══════════════════════════════════════════════════════════════════
  // CORE API — Called by StrategyOrchestrator
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Feed a new candle + full price history. Returns signal or null.
   * @param {Object} candle - Latest candle { c/close, o/open, h/high, l/low, v/volume, t/timestamp }
   * @param {Array} priceHistory - Full candle array, newest LAST
   * @returns {Object|null} { direction, confidence, reason, conditionsMet, overrideLevels } or null
   */
  update(candle, priceHistory) {
    if (!priceHistory || priceHistory.length < 30) return null;
    this.barIndex = priceHistory.length - 1;

    const tfMinutes = this._detectTimeframe(priceHistory);
    if (tfMinutes <= 0) return null;

    const barsPerDay = Math.round(390 / tfMinutes);
    const vpLookback = this.vpDays * barsPerDay;

    // Need enough history for VP
    if (priceHistory.length < vpLookback) return null;

    // ─── Step 1: Volume Profile ───
    const vpSlice = priceHistory.slice(-vpLookback);
    const vp = this._computeVolumeProfile(vpSlice);
    if (!vp) return null;

    // ─── Step 2: IVB ───
    this._updateIVB(candle, tfMinutes);

    // ─── Helpers ───
    const volAvg = this._smaVolume(priceHistory, this.volAvgLen);
    const atrVal = this._computeATR(priceHistory, this.atrLen);

    // ─── Session filter ───
    const candleTime = this._getCandleDate(candle);
    const inCash = this._inCashSession(candleTime);
    const inValid = this.useSessionFilter ? this._inValidSession(candleTime) : true;
    const canTrade = this.dailyLosses < this.maxDailyLosses;

    // ─── Step 3: Classify last 4 candles ───
    // We need current + 3 prior candles for sweep lookback
    if (priceHistory.length < 5) return null;
    const cc = []; // classified candles: index 0 = current, 1 = [1], 2 = [2], 3 = [3]
    for (let i = 0; i < 4; i++) {
      const idx = priceHistory.length - 1 - i;
      if (idx < 0) return null;
      cc.push(this._classifyCandle(priceHistory[idx], volAvg));
    }

    // ─── CVD ───
    this._updateCVD(candle);
    const cvdResult = this._computeCVDDivergence(priceHistory);

    // ─── Exhaustion ───
    const exh = this._detectExhaustion(priceHistory);

    // ─── Step 4: Sweep Detection ───
    // Sweep on bars [1], [2], [3] — check if price wicked beyond a level and closed back
    const sweeps = this._detectSweeps(priceHistory, vp);

    // ─── Step 5: Confidence Scoring ───
    // Long sweep: any of bars [1-3] swept long
    const sweepLongAny = (sweeps[1].long || sweeps[2].long || sweeps[3].long) && inCash && inValid && canTrade;
    const sweepShortAny = (sweeps[1].short || sweeps[2].short || sweeps[3].short) && inCash && inValid && canTrade;

    // Get absorption on the sweep candle itself
    const sweepBarIdxL = sweeps[1].long ? 1 : sweeps[2].long ? 2 : sweeps[3].long ? 3 : -1;
    const sweepBarIdxS = sweeps[1].short ? 1 : sweeps[2].short ? 2 : sweeps[3].short ? 3 : -1;

    let longResult = null;
    let shortResult = null;

    if (sweepLongAny) {
      longResult = this._scoreLong(cc, sweepBarIdxL, vp, cvdResult, exh, priceHistory);
    }
    if (sweepShortAny) {
      shortResult = this._scoreShort(cc, sweepBarIdxS, vp, cvdResult, exh, priceHistory);
    }

    // ─── Step 6: Entry Validation ───
    // Freshness check: don't re-trigger same sweep bar
    const currentLongSweepBar = sweeps[1].long ? this.barIndex - 1 :
                                 sweeps[2].long ? this.barIndex - 2 :
                                 sweeps[3].long ? this.barIndex - 3 : -1;
    const currentShortSweepBar = sweeps[1].short ? this.barIndex - 1 :
                                  sweeps[2].short ? this.barIndex - 2 :
                                  sweeps[3].short ? this.barIndex - 3 : -1;

    const longFresh = sweepLongAny && currentLongSweepBar !== this.lastLongSweepBar;
    const shortFresh = sweepShortAny && currentShortSweepBar !== this.lastShortSweepBar;

    const longValid = longFresh && longResult && (longResult.conditionsMet >= 1 || longResult.confidence > 0);
    const shortValid = shortFresh && shortResult && (shortResult.conditionsMet >= 1 || shortResult.confidence > 0);

    // Pick the stronger signal if both fire
    let winner = null;
    if (longValid && shortValid) {
      // Total score = conditionsMet * 100 + confidence
      const longScore = longResult.conditionsMet * 100 + longResult.rawConfidence;
      const shortScore = shortResult.conditionsMet * 100 + shortResult.rawConfidence;
      winner = longScore >= shortScore ? 'long' : 'short';
    } else if (longValid) {
      winner = 'long';
    } else if (shortValid) {
      winner = 'short';
    }

    if (!winner) return null;

    const result = winner === 'long' ? longResult : shortResult;
    const direction = winner === 'long' ? 'buy' : 'sell';

    // Mark sweep as consumed
    if (winner === 'long') this.lastLongSweepBar = currentLongSweepBar;
    if (winner === 'short') this.lastShortSweepBar = currentShortSweepBar;

    // ─── Step 7: Compute SL/TP ───
    const price = c(candle);
    const levels = this._computeExitLevels(direction, price, priceHistory, atrVal, vp, result.conditionsMet);

    // ─── Normalize confidence to 0-1 for orchestrator ───
    // PineScript scoring: conditionsMet 0-7, rawConfidence 0-100
    // Normalize: (conditionsMet / 7) * 0.6 + (rawConfidence / 100) * 0.4
    // Min 0.3 if any conditions/confidence exist
    const normalizedConf = Math.min(1.0,
      Math.max(0.3,
        (result.conditionsMet / 7) * 0.6 + (result.rawConfidence / 100) * 0.4
      )
    );

    return {
      direction,
      confidence: normalizedConf,
      reason: `SMS ${direction.toUpperCase()}: ${result.conditionsMet}/7 conditions, ` +
              `${result.rawConfidence.toFixed(0)}% progress | ${result.details.join(', ')}`,
      conditionsMet: result.conditionsMet,
      rawConfidence: result.rawConfidence,
      overrideLevels: levels,
      signalData: {
        vah: vp.vah,
        val: vp.val,
        poc: vp.poc,
        ivbHigh: this.ivbHigh,
        ivbLow: this.ivbLow,
        ivbDirection: this.ivbDirection,
        profileBias: vp.profileBias,
        conditionsMet: result.conditionsMet,
        rawConfidence: result.rawConfidence,
      }
    };
  }

  /**
   * Notify the module of a closed trade result (for daily loss tracking).
   * Called by the trade management layer after a position closes.
   * @param {number} pnl - Profit/loss of the closed trade
   */
  recordTradeResult(pnl) {
    if (pnl < 0) {
      this.dailyLosses++;
    }
  }

  /**
   * Reset daily state. Call at session open detection.
   */
  resetDaily() {
    this.dailyLosses = 0;
    this.ivbHigh = null;
    this.ivbLow = null;
    this.ivbLocked = false;
    this.ivbBarCount = 0;
    this.ivbDirection = 0;
    this.sessionDay = -1;
  }

  // ═══════════════════════════════════════════════════════════════════
  // VOLUME PROFILE — Body-weighted distribution (Fabio method)
  // ═══════════════════════════════════════════════════════════════════

  _computeVolumeProfile(candles) {
    if (!candles || candles.length === 0) return null;

    let vpHigh = -Infinity;
    let vpLow = Infinity;
    for (const candle of candles) {
      const hi = h(candle);
      const lo = l(candle);
      if (hi > vpHigh) vpHigh = hi;
      if (lo < vpLow) vpLow = lo;
    }

    const vpRange = vpHigh - vpLow;
    if (vpRange <= 0) return null;
    const binSize = vpRange / this.vpBins;

    // Build volume array with body-weighted distribution
    const vpVolume = new Float64Array(this.vpBins);
    const bW = this.bodyWeightPct / 100;

    for (const candle of candles) {
      const cH = h(candle);
      const cL = l(candle);
      const cO = o(candle);
      const cC = c(candle);
      const cV = v(candle);
      const bTop = Math.max(cO, cC);
      const bBot = Math.min(cO, cC);
      const cRng = cH - cL;
      if (cRng <= 0) continue;

      const sBin = Math.max(0, Math.min(Math.floor((cL - vpLow) / binSize), this.vpBins - 1));
      const eBin = Math.max(0, Math.min(Math.floor((cH - vpLow) / binSize), this.vpBins - 1));
      const bsBin = Math.max(0, Math.min(Math.floor((bBot - vpLow) / binSize), this.vpBins - 1));
      const beBin = Math.max(0, Math.min(Math.floor((bTop - vpLow) / binSize), this.vpBins - 1));
      const tBins = eBin - sBin + 1;
      const bBins = beBin - bsBin + 1;
      const wBins = tBins - bBins;
      if (tBins <= 0) continue;

      let vpbb, vpwb;
      if (wBins <= 0) {
        vpbb = cV / tBins;
        vpwb = 0;
      } else {
        vpbb = bBins > 0 ? (cV * bW) / bBins : 0;
        vpwb = (cV * (1 - bW)) / wBins;
      }

      for (let k = sBin; k <= eBin; k++) {
        const isBB = k >= bsBin && k <= beBin;
        vpVolume[k] += isBB ? vpbb : vpwb;
      }
    }

    // POC — bin with max volume
    let pocBin = 0;
    let pocVol = 0;
    for (let i = 0; i < this.vpBins; i++) {
      if (vpVolume[i] > pocVol) {
        pocVol = vpVolume[i];
        pocBin = i;
      }
    }
    const pocPrice = vpLow + (pocBin + 0.5) * binSize;

    // Total volume
    let totalVol = 0;
    for (let i = 0; i < this.vpBins; i++) totalVol += vpVolume[i];
    if (totalVol <= 0) return null;

    // Value Area — expand from POC until target% of volume captured
    const vaTargetVol = totalVol * (this.valueAreaPct / 100);
    let vahBin = pocBin;
    let valBin = pocBin;
    let vaVol = pocVol;

    while (vaVol < vaTargetVol) {
      const eUp = vahBin < this.vpBins - 1;
      const eDn = valBin > 0;
      if (!eUp && !eDn) break;
      const uV = eUp ? vpVolume[vahBin + 1] : 0;
      const dV = eDn ? vpVolume[valBin - 1] : 0;
      if (eUp && (uV >= dV || !eDn)) {
        vahBin++;
        vaVol += uV;
      } else if (eDn) {
        valBin--;
        vaVol += dV;
      } else {
        break;
      }
    }

    const vahPrice = vpLow + (vahBin + 1) * binSize;
    const valPrice = vpLow + valBin * binSize;

    // Profile shape bias
    const vpMid = (vpHigh + vpLow) / 2;
    const profileBias = pocPrice > vpMid ? 1 : pocPrice < vpMid ? -1 : 0;

    // LVN detection — bins with volume below lvnPctile threshold
    const sortedVols = Array.from(vpVolume).sort((a, b) => a - b);
    const pIdx = Math.max(0, Math.min(Math.floor(this.vpBins * (this.lvnPctile / 100)), this.vpBins - 1));
    const lvnThreshold = sortedVols[pIdx];

    const lvnLevels = [];
    for (let i = 0; i < this.vpBins; i++) {
      if (vpVolume[i] <= lvnThreshold && vpVolume[i] > 0) {
        const lp = vpLow + (i + 0.5) * binSize;
        // Only LVNs outside the value area
        if ((lp < valPrice || lp > vahPrice) && lvnLevels.length < 10) {
          lvnLevels.push(lp);
        }
      }
    }

    return { vah: vahPrice, val: valPrice, poc: pocPrice, profileBias, lvnLevels, vpHigh, vpLow };
  }

  // ═══════════════════════════════════════════════════════════════════
  // IVB — Initial Volume Breakout (First 30 Min Range)
  // ═══════════════════════════════════════════════════════════════════

  _updateIVB(candle, tfMinutes) {
    const candleDate = this._getCandleDate(candle);
    if (!candleDate) return;

    const inCash = this._inCashSession(candleDate);
    const currentDay = candleDate.getUTCDay();

    // Detect new session
    const newSession = currentDay !== this.sessionDay && inCash;
    if (newSession) {
      this.sessionDay = currentDay;
      this.ivbHigh = h(candle);
      this.ivbLow = l(candle);
      this.ivbLocked = false;
      this.ivbBarCount = 1;
      this.ivbDirection = 0;
      this.dailyLosses = 0; // Reset daily losses on new session
      return;
    }

    // Build IVB during first N minutes
    const ivbBarsNeeded = Math.round(this.ivbMinutes / tfMinutes);
    if (inCash && !this.ivbLocked) {
      this.ivbBarCount++;
      const hi = h(candle);
      const lo = l(candle);
      if (this.ivbHigh === null || hi > this.ivbHigh) this.ivbHigh = hi;
      if (this.ivbLow === null || lo < this.ivbLow) this.ivbLow = lo;
      if (this.ivbBarCount >= ivbBarsNeeded) {
        this.ivbLocked = true;
      }
    }

    // IVB breakout direction (first breakout of the day)
    if (this.ivbLocked && this.ivbDirection === 0) {
      const close = c(candle);
      if (close > this.ivbHigh) this.ivbDirection = 1;
      else if (close < this.ivbLow) this.ivbDirection = -1;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CANDLE CLASSIFICATION
  // ═══════════════════════════════════════════════════════════════════

  _classifyCandle(candle, volAvg) {
    const cH = h(candle);
    const cL = l(candle);
    const cO = o(candle);
    const cC = c(candle);
    const cV = v(candle);
    const cRange = cH - cL;
    const cBody = Math.abs(cC - cO);
    const uWick = cH - Math.max(cO, cC);
    const lWick = Math.min(cO, cC) - cL;

    const bodyPct = cRange > 0 ? (cBody / cRange) * 100 : 0;
    const lWickPct = cRange > 0 ? (lWick / cRange) * 100 : 0;
    const uWickPct = cRange > 0 ? (uWick / cRange) * 100 : 0;
    const isBullish = cC > cO;
    const isBearish = cC < cO;

    // Absorption MET — high volume, small body or big wick = rejection
    const absorbMet = cV > volAvg * this.absorbVolMult && (
      bodyPct < this.absorbBodyPct || lWickPct > this.absorbWickPct || uWickPct > this.absorbWickPct
    );

    // Absorption IN PROGRESS — relaxed thresholds
    const absorbProg = !absorbMet && cV > volAvg * this.absorbVolProgMult && (
      bodyPct < this.absorbBodyProgPct || lWickPct > this.absorbWickProgPct || uWickPct > this.absorbWickProgPct
    );

    // Initiative BULL MET — strong body bullish candle with volume
    const initBullMet = cV > volAvg && bodyPct > this.initBodyPct && isBullish;
    const initBearMet = cV > volAvg && bodyPct > this.initBodyPct && isBearish;

    // Initiative IN PROGRESS
    const initBullProg = !initBullMet && cV > volAvg * 0.8 && bodyPct > this.initBodyProgPct && isBullish;
    const initBearProg = !initBearMet && cV > volAvg * 0.8 && bodyPct > this.initBodyProgPct && isBearish;

    return {
      close: cC, open: cO, high: cH, low: cL, volume: cV,
      bodyPct, lWickPct, uWickPct, isBullish, isBearish,
      absorbMet, absorbProg, initBullMet, initBearMet, initBullProg, initBearProg
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // CVD — Cumulative Volume Delta + Divergence
  // ═══════════════════════════════════════════════════════════════════

  _updateCVD(candle) {
    const cC = c(candle);
    const cO = o(candle);
    const cV = v(candle);
    const delta = cC > cO ? cV : cC < cO ? -cV : 0;
    this.cvd += delta;
  }

  _computeCVDDivergence(priceHistory) {
    const len = Math.min(this.cvdDivLen, priceHistory.length);
    if (len < 3) return { bullMet: false, bearMet: false, bullProg: false, bearProg: false };

    // Rebuild CVD series for lookback
    const cvdSeries = [];
    let runCvd = 0;
    // We need to compute from enough candles back
    const startIdx = Math.max(0, priceHistory.length - len);
    for (let i = startIdx; i < priceHistory.length; i++) {
      const candle = priceHistory[i];
      const cC = c(candle);
      const cO = o(candle);
      const cV = v(candle);
      runCvd += cC > cO ? cV : cC < cO ? -cV : 0;
      cvdSeries.push({ cvd: runCvd, high: h(candle), low: l(candle), close: cC });
    }

    const cvdHi = Math.max(...cvdSeries.map(d => d.cvd));
    const cvdLo = Math.min(...cvdSeries.map(d => d.cvd));
    const prHi = Math.max(...cvdSeries.map(d => d.high));
    const prLo = Math.min(...cvdSeries.map(d => d.low));
    const latest = cvdSeries[cvdSeries.length - 1];

    // Bullish divergence: price makes new low but CVD doesn't
    const cvdBullMet = latest.low <= prLo && latest.cvd > cvdLo;
    const cvdBearMet = latest.high >= prHi && latest.cvd < cvdHi;

    // Progress version: 3-bar slope check
    let cvdBullProg = false;
    let cvdBearProg = false;
    if (cvdSeries.length >= 4) {
      const cur = cvdSeries[cvdSeries.length - 1];
      const prev3 = cvdSeries[cvdSeries.length - 4];
      const cvdSlope3 = cur.cvd - prev3.cvd;
      const priceSlope3 = cur.close - prev3.close;
      cvdBullProg = !cvdBullMet && priceSlope3 < 0 && cvdSlope3 > -Math.abs(priceSlope3) * 0.3;
      cvdBearProg = !cvdBearMet && priceSlope3 > 0 && cvdSlope3 < Math.abs(priceSlope3) * 0.3;
    }

    return { bullMet: cvdBullMet, bearMet: cvdBearMet, bullProg: cvdBullProg, bearProg: cvdBearProg };
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXHAUSTION DETECTION
  // ═══════════════════════════════════════════════════════════════════

  _detectExhaustion(priceHistory) {
    if (priceHistory.length < 4) return { bullMet: false, bearMet: false, bullProg: false, bearProg: false };

    const len = priceHistory.length;
    const c1 = priceHistory[len - 2]; // [1]
    const c2 = priceHistory[len - 3]; // [2]
    const c3 = priceHistory[len - 4]; // [3]

    const bear1 = c(c1) < o(c1);
    const bear2 = c(c2) < o(c2);
    const bear3 = c(c3) < o(c3);
    const bull1 = c(c1) > o(c1);
    const bull2 = c(c2) > o(c2);
    const bull3 = c(c3) > o(c3);

    const v1 = v(c1);
    const v2 = v(c2);
    const v3 = v(c3);

    // Exhaustion bull: 3 bearish candles with declining volume = sellers exhausted
    const exhBullMet = bear1 && bear2 && bear3 && v1 < v2 && v2 < v3;
    const exhBullProg = !exhBullMet && bear1 && bear2 && v1 < v2;

    // Exhaustion bear: 3 bullish candles with declining volume = buyers exhausted
    const exhBearMet = bull1 && bull2 && bull3 && v1 < v2 && v2 < v3;
    const exhBearProg = !exhBearMet && bull1 && bull2 && v1 < v2;

    return { bullMet: exhBullMet, bearMet: exhBearMet, bullProg: exhBullProg, bearProg: exhBearProg };
  }

  // ═══════════════════════════════════════════════════════════════════
  // SWEEP DETECTION — Price wicks beyond level and closes back
  // ═══════════════════════════════════════════════════════════════════

  _detectSweeps(priceHistory, vp) {
    const sweeps = {};
    // Check bars [1], [2], [3]
    for (let offset = 1; offset <= 3; offset++) {
      const idx = priceHistory.length - 1 - offset;
      if (idx < 0) {
        sweeps[offset] = { long: false, short: false };
        continue;
      }
      const candle = priceHistory[idx];
      const cC = c(candle);
      const cL = l(candle);
      const cH = h(candle);

      let sweepLong = false;
      let sweepShort = false;

      // LONG sweep: wick below VAL and close above
      if (cC > vp.val && cL < vp.val) sweepLong = true;
      // LONG sweep: wick below IVB low and close above
      if (this.ivbLocked && this.ivbLow !== null && cC > this.ivbLow && cL < this.ivbLow) sweepLong = true;
      // LONG sweep: wick below LVN (below POC) and close above
      for (const lvn of vp.lvnLevels) {
        if (lvn < vp.poc && cL < lvn && cC > lvn) { sweepLong = true; break; }
      }

      // SHORT sweep: wick above VAH and close below
      if (cC < vp.vah && cH > vp.vah) sweepShort = true;
      // SHORT sweep: wick above IVB high and close below
      if (this.ivbLocked && this.ivbHigh !== null && cC < this.ivbHigh && cH > this.ivbHigh) sweepShort = true;
      // SHORT sweep: wick above LVN (above POC) and close below
      for (const lvn of vp.lvnLevels) {
        if (lvn > vp.poc && cH > lvn && cC < lvn) { sweepShort = true; break; }
      }

      sweeps[offset] = { long: sweepLong, short: sweepShort };
    }
    return sweeps;
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONFIDENCE SCORING — Matches PineScript exactly
  // ═══════════════════════════════════════════════════════════════════

  _scoreLong(cc, sweepBarIdx, vp, cvdResult, exh, priceHistory) {
    let conditionsMet = 0;
    let confidence = 0;
    const details = [];

    // 1. IVB direction alignment
    if (this.ivbDirection === 1) {
      conditionsMet++;
      details.push('IVB↑');
    } else if (this.ivbDirection === 0 && this.ivbLocked) {
      confidence += 10;
      details.push('IVB~');
    }

    // 2. Profile bias alignment (P-shape = long bias)
    if (vp.profileBias === 1) {
      conditionsMet++;
      details.push('P-shape');
    } else if (vp.profileBias === 0) {
      confidence += 10;
      details.push('D-shape');
    }

    // 3. Absorption on the sweep candle
    if (sweepBarIdx >= 0 && sweepBarIdx < cc.length) {
      const sweepCandle = cc[sweepBarIdx];
      if (sweepCandle.absorbMet) {
        conditionsMet++;
        details.push('Absorb✓');
      } else if (sweepCandle.absorbProg) {
        confidence += 20;
        details.push('Absorb~');
      }
    }

    // 4. Initiative (current candle = cc[0])
    if (cc[0].initBullMet) {
      conditionsMet++;
      details.push('Init✓');
    } else if (cc[0].initBullProg) {
      confidence += 20;
      details.push('Init~');
    }

    // 5. Prior close inside VA (check cc[1])
    if (cc.length > 1) {
      const priorClose = cc[1].close;
      const insideVA = priorClose >= vp.val && priorClose <= vp.vah;
      if (insideVA) {
        conditionsMet++;
        details.push('PriorVA✓');
      } else {
        // Near VA boundary check (within 0.5%)
        const nearVAH = Math.abs(priorClose - vp.vah) / vp.vah * 100 < 0.5;
        const nearVAL = Math.abs(priorClose - vp.val) / vp.val * 100 < 0.5;
        if (nearVAH || nearVAL) {
          confidence += 15;
          details.push('PriorVA~');
        }
      }
    }

    // 6. CVD divergence
    if (cvdResult.bullMet) {
      conditionsMet++;
      details.push('CVD✓');
    } else if (cvdResult.bullProg) {
      confidence += 15;
      details.push('CVD~');
    }

    // 7. Exhaustion
    if (exh.bullMet) {
      conditionsMet++;
      details.push('Exh✓');
    } else if (exh.bullProg) {
      confidence += 10;
      details.push('Exh~');
    }

    return { conditionsMet, rawConfidence: confidence, details };
  }

  _scoreShort(cc, sweepBarIdx, vp, cvdResult, exh, priceHistory) {
    let conditionsMet = 0;
    let confidence = 0;
    const details = [];

    // 1. IVB direction alignment
    if (this.ivbDirection === -1) {
      conditionsMet++;
      details.push('IVB↓');
    } else if (this.ivbDirection === 0 && this.ivbLocked) {
      confidence += 10;
      details.push('IVB~');
    }

    // 2. Profile bias (b-shape = short bias)
    if (vp.profileBias === -1) {
      conditionsMet++;
      details.push('b-shape');
    } else if (vp.profileBias === 0) {
      confidence += 10;
      details.push('D-shape');
    }

    // 3. Absorption on sweep candle
    if (sweepBarIdx >= 0 && sweepBarIdx < cc.length) {
      const sweepCandle = cc[sweepBarIdx];
      if (sweepCandle.absorbMet) {
        conditionsMet++;
        details.push('Absorb✓');
      } else if (sweepCandle.absorbProg) {
        confidence += 20;
        details.push('Absorb~');
      }
    }

    // 4. Initiative bear
    if (cc[0].initBearMet) {
      conditionsMet++;
      details.push('Init✓');
    } else if (cc[0].initBearProg) {
      confidence += 20;
      details.push('Init~');
    }

    // 5. Prior close inside VA
    if (cc.length > 1) {
      const priorClose = cc[1].close;
      const insideVA = priorClose >= vp.val && priorClose <= vp.vah;
      if (insideVA) {
        conditionsMet++;
        details.push('PriorVA✓');
      } else {
        const nearVAH = Math.abs(priorClose - vp.vah) / vp.vah * 100 < 0.5;
        const nearVAL = Math.abs(priorClose - vp.val) / vp.val * 100 < 0.5;
        if (nearVAH || nearVAL) {
          confidence += 15;
          details.push('PriorVA~');
        }
      }
    }

    // 6. CVD divergence
    if (cvdResult.bearMet) {
      conditionsMet++;
      details.push('CVD✓');
    } else if (cvdResult.bearProg) {
      confidence += 15;
      details.push('CVD~');
    }

    // 7. Exhaustion
    if (exh.bearMet) {
      conditionsMet++;
      details.push('Exh✓');
    } else if (exh.bearProg) {
      confidence += 10;
      details.push('Exh~');
    }

    return { conditionsMet, rawConfidence: confidence, details };
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXIT LEVELS — SL/TP from PineScript logic
  // ═══════════════════════════════════════════════════════════════════

  _computeExitLevels(direction, price, priceHistory, atrVal, vp, conditionsMet) {
    if (direction === 'buy') {
      // SL = lowest low of sweep bars minus buffer, capped by maxLossPct
      const sweepLow = Math.min(
        l(priceHistory[priceHistory.length - 2]),
        l(priceHistory[priceHistory.length - 3]),
        l(priceHistory[priceHistory.length - 4])
      );
      const slBuffer = price * (this.slBufferPct / 100);
      const wickSL = sweepLow - slBuffer;
      const maxLossSL = price - (price * this.maxLossPct / 100);
      const stopLoss = Math.max(wickSL, maxLossSL);

      // TP: ATR-based scaled by conviction + VP/VWAP structural targets
      const atrTPLow = price + atrVal * this.lowConvATRMult;
      const atrTPMid = price + atrVal * this.midConvATRMult;
      const atrTPHigh = price + atrVal * this.highConvATRMult;

      // VP targets
      const vpTP = vp.poc > price ? vp.poc : vp.vah > price ? vp.vah : atrTPMid;
      const midTarget = Math.min(vpTP, atrTPMid);
      const highTarget = vp.vah > price ? Math.min(vp.vah, atrTPHigh) : atrTPHigh;

      const takeProfit = conditionsMet >= 3 ? highTarget : conditionsMet >= 2 ? midTarget : atrTPLow;

      return { stopLoss, takeProfit };
    } else {
      // Short
      const sweepHigh = Math.max(
        h(priceHistory[priceHistory.length - 2]),
        h(priceHistory[priceHistory.length - 3]),
        h(priceHistory[priceHistory.length - 4])
      );
      const slBuffer = price * (this.slBufferPct / 100);
      const wickSL = sweepHigh + slBuffer;
      const maxLossSL = price + (price * this.maxLossPct / 100);
      const stopLoss = Math.min(wickSL, maxLossSL);

      const atrTPLow = price - atrVal * this.lowConvATRMult;
      const atrTPMid = price - atrVal * this.midConvATRMult;
      const atrTPHigh = price - atrVal * this.highConvATRMult;

      const vpTP = vp.poc < price ? vp.poc : vp.val < price ? vp.val : atrTPMid;
      const midTarget = Math.max(vpTP, atrTPMid);
      const highTarget = vp.val < price ? Math.max(vp.val, atrTPHigh) : atrTPHigh;

      const takeProfit = conditionsMet >= 3 ? highTarget : conditionsMet >= 2 ? midTarget : atrTPLow;

      return { stopLoss, takeProfit };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════

  _detectTimeframe(priceHistory) {
    if (priceHistory.length < 2) return 15; // Default to 15m
    const t1 = t(priceHistory[priceHistory.length - 1]);
    const t2 = t(priceHistory[priceHistory.length - 2]);
    if (!t1 || !t2) return 15;
    const diffMs = Math.abs(t1 - t2);
    const diffMin = diffMs / 60000;
    // Snap to common timeframes
    if (diffMin <= 1.5) return 1;
    if (diffMin <= 5.5) return 5;
    if (diffMin <= 16) return 15;
    if (diffMin <= 35) return 30;
    if (diffMin <= 65) return 60;
    if (diffMin <= 250) return 240;
    return 15;
  }

  _smaVolume(priceHistory, period) {
    const len = Math.min(period, priceHistory.length);
    if (len === 0) return 0;
    let sum = 0;
    for (let i = priceHistory.length - len; i < priceHistory.length; i++) {
      sum += v(priceHistory[i]);
    }
    return sum / len;
  }

  _computeATR(priceHistory, period) {
    if (priceHistory.length < period + 1) return 0;
    let atr = 0;
    for (let i = priceHistory.length - period; i < priceHistory.length; i++) {
      const candle = priceHistory[i];
      const prev = priceHistory[i - 1];
      if (!prev) continue;
      const tr = Math.max(
        h(candle) - l(candle),
        Math.abs(h(candle) - c(prev)),
        Math.abs(l(candle) - c(prev))
      );
      atr += tr;
    }
    return atr / period;
  }

  _getCandleDate(candle) {
    const ts = t(candle);
    if (!ts) return null;
    // Timestamps could be seconds or milliseconds
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms);
  }

  _inCashSession(date) {
    if (!date) return false;
    // Convert to US Eastern (UTC-5 standard, UTC-4 DST)
    // Approximate: use UTC offset. For production, would use proper timezone lib.
    const utcHour = date.getUTCHours();
    const utcMin = date.getUTCMinutes();
    // EST = UTC-5, EDT = UTC-4. Check DST roughly (March-November)
    const month = date.getUTCMonth(); // 0-indexed
    const isDST = month >= 2 && month <= 10; // Rough DST approximation
    const offset = isDST ? 4 : 5;
    let etHour = utcHour - offset;
    if (etHour < 0) etHour += 24;
    const etMin = utcMin;

    const etTime = etHour * 60 + etMin;
    const sessionStartTime = this.cashSessionStart * 60 + this.cashSessionStartMin; // 9:30 = 570
    const sessionEndTime = this.cashSessionEndHour * 60 + this.cashSessionEndMin;   // 16:00 = 960
    return etTime >= sessionStartTime && etTime < sessionEndTime;
  }

  _inValidSession(date) {
    if (!date) return false;
    const utcHour = date.getUTCHours();
    const utcMin = date.getUTCMinutes();
    const month = date.getUTCMonth();
    const isDST = month >= 2 && month <= 10;
    const offset = isDST ? 4 : 5;
    let etHour = utcHour - offset;
    if (etHour < 0) etHour += 24;
    const etMin = utcMin;

    const etTime = etHour * 60 + etMin;
    const validStart = this.validSessionStartHour * 60 + this.validSessionStartMin; // 9:45 = 585
    const validEnd = this.validSessionEndHour * 60 + this.validSessionEndMin;       // 15:45 = 945
    return etTime >= validStart && etTime < validEnd;
  }
}

module.exports = SmartMoneySweep;
