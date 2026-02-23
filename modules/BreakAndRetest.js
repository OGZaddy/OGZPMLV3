/**
 * BreakAndRetest.js — Desi Trades Strategy
 * ==========================================
 * SOURCE: Chart Fanatics podcast — Vincent Desano (Desi Trades)
 *         "$400K+ year using Break & Retest"
 *
 * CORE CONCEPT:
 *   Don't buy breakouts. Wait for price to break a key level,
 *   pull back to retest it, confirm it holds, THEN enter.
 *
 * THE MECHANICAL RULES:
 *   1. Identify key levels (session high/low, tested S/R zones)
 *   2. Define No Trade Zone (NTZ) between upper and lower boundary
 *   3. Wait for decisive BREAK through key level
 *   4. Wait for RETEST — price returns to broken level (Battle Zone)
 *   5. Read 3-5 candles at retest: wicks defending? flag forming?
 *   6. Enter on engulfing/confirmation candle that breaks the flag
 *   7. Stop below retest level (longs) or above (shorts)
 *   8. PT1 = previous breakout high (1:1), scale 50%, let rest run
 *
 * INTEGRATION:
 *   const br = new BreakAndRetest();
 *   const signal = br.update(candle, priceHistory);
 *   // signal = { direction, confidence, reason, stopLoss, takeProfit, ... }
 *
 * WIRING:
 *   Registers as strategy #5 in StrategyOrchestrator via:
 *     ctx.extras.breakRetestSignal = signal
 *
 * @module modules/BreakAndRetest
 */

'use strict';

const { c, o, h, l, v } = require('../core/CandleHelper');

class BreakAndRetest {
  constructor(config = {}) {
    // ─── KEY LEVEL DETECTION ───
    // How many candles back to find session highs/lows
    this.sessionLookback = config.sessionLookback || 96;  // 96 x 15min = 24 hours

    // S/R zone width — swings within this % are grouped as one level
    this.srZonePct = config.srZonePct || 0.5;

    // Minimum times a level must be tested to be "key"
    this.minLevelTests = config.minLevelTests || 2;

    // Swing detection lookback (bars on each side)
    this.swingLookback = config.swingLookback || 5;

    // ─── BREAK DETECTION ───
    // How far through the level price must close to confirm break (%)
    this.breakConfirmPct = config.breakConfirmPct || 0.15;

    // Minimum candle body size relative to ATR to be a "breaker candle"
    this.minBreakerBodyRatio = config.minBreakerBodyRatio || 0.4;

    // ─── RETEST / BATTLE ZONE ───
    // How close price must return to the broken level (%)
    this.retestZonePct = config.retestZonePct || 0.3;

    // Max candles to wait for retest after break
    this.maxRetestWait = config.maxRetestWait || 20;

    // Min candles in battle zone before entry is valid
    this.minBattleCandles = config.minBattleCandles || 3;

    // Max candles in battle zone before setup expires
    this.maxBattleCandles = config.maxBattleCandles || 15;

    // ─── NO TRADE ZONE ───
    // If upper and lower key levels are within this %, define NTZ
    this.ntzMaxRangePct = config.ntzMaxRangePct || 2.0;

    // ─── RISK MANAGEMENT ───
    // Reward to risk ratio for PT1
    this.rewardRiskRatio = config.rewardRiskRatio || 1.5;

    // ─── INTERNAL STATE ───
    this.keyLevels = [];         // { price, type: 'high'|'low', tests, source }
    this.activeBreak = null;     // { level, direction, breakBar, breakoutHigh/Low }
    this.battleZone = null;      // { enteredBar, candles[], level, direction }
    this.ntz = null;             // { upper, lower } — No Trade Zone
    this.barCount = 0;
    this.atr = 0;
    this.recentCandles = [];     // Bounded at sessionLookback + 50

    // Signal log for debugging
    this.signalLog = [];         // Bounded at 30
  }

  // ═══════════════════════════════════════════════════════════════
  //  CORE API
  // ═══════════════════════════════════════════════════════════════

  /**
   * @param {Object} candle       — { c/close, o/open, h/high, l/low, v/volume, t/timestamp }
   * @param {Array}  priceHistory  — candles array, newest LAST
   * @returns {Object} signal
   */
  update(candle, priceHistory) {
    if (!priceHistory || priceHistory.length < 30) {
      return this._emptySignal();
    }

    this.barCount++;
    const price = c(candle);
    const candleHigh = h(candle);
    const candleLow = l(candle);
    const candleOpen = o(candle);
    const body = Math.abs(price - candleOpen);
    const totalRange = candleHigh - candleLow;

    // Update recent candles buffer
    this.recentCandles.push(candle);
    if (this.recentCandles.length > this.sessionLookback + 50) {
      this.recentCandles = this.recentCandles.slice(-this.sessionLookback - 50);
    }

    // Calculate ATR
    this.atr = this._calcATR(priceHistory, 14);
    if (this.atr === 0) return this._emptySignal();

    // ─── PHASE 1: Update key levels ───
    this._updateKeyLevels(priceHistory);

    // ─── PHASE 2: Define NTZ ───
    this._updateNTZ(price);

    // ─── PHASE 3: Check if we're in NTZ (suppress signals) ───
    const inNTZ = this._isInNTZ(price);

    // ─── PHASE 4: Detect new break ───
    if (!this.activeBreak) {
      this._detectBreak(candle, priceHistory);
    }

    // ─── PHASE 5: Watch for retest (Battle Zone entry) ───
    if (this.activeBreak && !this.battleZone) {
      this._detectRetest(candle);
    }

    // ─── PHASE 6: Read Battle Zone price action ───
    let signal = this._emptySignal();

    if (this.battleZone) {
      this.battleZone.candles.push(candle);
      const battleCount = this.battleZone.candles.length;

      // Expire if too many candles without confirmation
      if (battleCount > this.maxBattleCandles) {
        this._logSignal('BATTLE_EXPIRED', `Battle zone expired after ${battleCount} candles`);
        this._resetState();
        return this._emptySignal();
      }

      // Check if level was invalidated (price closed back through decisively)
      if (this._isInvalidated(candle)) {
        this._logSignal('INVALIDATED', `Level ${this.battleZone.level.toFixed(2)} reclaimed — setup dead`);
        this._resetState();
        return this._emptySignal();
      }

      // Need minimum candles before we look for entry
      if (battleCount >= this.minBattleCandles) {
        signal = this._readBattleZone(candle, priceHistory);
      }
    }

    // ─── PHASE 7: Expire stale breaks waiting for retest ───
    if (this.activeBreak && !this.battleZone) {
      const barsWaiting = this.barCount - this.activeBreak.breakBar;
      if (barsWaiting > this.maxRetestWait) {
        this._logSignal('RETEST_TIMEOUT', `No retest after ${barsWaiting} bars — break expired`);
        this._resetState();
      }
    }

    // ─── NTZ OVERRIDE: suppress if signal would fire inside NTZ ───
    if (inNTZ && signal.direction !== 'neutral') {
      this._logSignal('NTZ_SUPPRESSED', `Signal suppressed — inside No Trade Zone`);
      return this._emptySignal();
    }

    return signal;
  }

  // ═══════════════════════════════════════════════════════════════
  //  KEY LEVEL DETECTION
  // ═══════════════════════════════════════════════════════════════

  _updateKeyLevels(priceHistory) {
    // Only recalculate every 10 bars (performance)
    if (this.barCount % 10 !== 0 && this.keyLevels.length > 0) return;

    const candles = priceHistory.slice(-this.sessionLookback);
    if (candles.length < 20) return;

    // Find swing highs and lows
    const swings = [];
    for (let i = this.swingLookback; i < candles.length - this.swingLookback; i++) {
      const cHigh = h(candles[i]);
      const cLow = l(candles[i]);

      let isSwingHigh = true;
      let isSwingLow = true;

      for (let j = 1; j <= this.swingLookback; j++) {
        if (h(candles[i - j]) >= cHigh || h(candles[i + j]) >= cHigh) isSwingHigh = false;
        if (l(candles[i - j]) <= cLow || l(candles[i + j]) <= cLow) isSwingLow = false;
      }

      if (isSwingHigh) swings.push({ price: cHigh, type: 'high', bar: i });
      if (isSwingLow) swings.push({ price: cLow, type: 'low', bar: i });
    }

    // Group swings into zones
    const levels = [];
    const used = new Set();

    for (let i = 0; i < swings.length; i++) {
      if (used.has(i)) continue;

      const zone = { price: swings[i].price, type: swings[i].type, tests: 1, bars: [swings[i].bar] };
      const zoneTolerance = swings[i].price * (this.srZonePct / 100);

      for (let j = i + 1; j < swings.length; j++) {
        if (used.has(j)) continue;
        if (Math.abs(swings[j].price - zone.price) <= zoneTolerance) {
          zone.tests++;
          zone.price = (zone.price * (zone.tests - 1) + swings[j].price) / zone.tests; // running avg
          zone.bars.push(swings[j].bar);
          used.add(j);
        }
      }
      used.add(i);

      if (zone.tests >= this.minLevelTests) {
        levels.push(zone);
      }
    }

    // Also add session high/low as key levels (always relevant)
    const sessionHigh = Math.max(...candles.map(cd => h(cd)));
    const sessionLow = Math.min(...candles.map(cd => l(cd)));

    // Check if session high/low already covered by a zone
    const highCovered = levels.some(lv => Math.abs(lv.price - sessionHigh) / sessionHigh < this.srZonePct / 100);
    const lowCovered = levels.some(lv => Math.abs(lv.price - sessionLow) / sessionLow < this.srZonePct / 100);

    if (!highCovered) levels.push({ price: sessionHigh, type: 'high', tests: 1, source: 'session_high' });
    if (!lowCovered) levels.push({ price: sessionLow, type: 'low', tests: 1, source: 'session_low' });

    // Sort by proximity to current price (most relevant first)
    const currentPrice = c(priceHistory[priceHistory.length - 1]);
    levels.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));

    this.keyLevels = levels.slice(0, 10); // Keep top 10 nearest
  }

  // ═══════════════════════════════════════════════════════════════
  //  NO TRADE ZONE
  // ═══════════════════════════════════════════════════════════════

  _updateNTZ(price) {
    if (this.keyLevels.length < 2) {
      this.ntz = null;
      return;
    }

    // Find nearest level above and below current price
    let upper = null;
    let lower = null;

    for (const level of this.keyLevels) {
      if (level.price > price && (!upper || level.price < upper.price)) {
        upper = level;
      }
      if (level.price < price && (!lower || level.price > lower.price)) {
        lower = level;
      }
    }

    if (upper && lower) {
      const rangePct = ((upper.price - lower.price) / lower.price) * 100;
      if (rangePct <= this.ntzMaxRangePct) {
        this.ntz = { upper: upper.price, lower: lower.price, rangePct };
      } else {
        this.ntz = null; // Range too wide to be NTZ
      }
    } else {
      this.ntz = null;
    }
  }

  _isInNTZ(price) {
    if (!this.ntz) return false;
    return price > this.ntz.lower && price < this.ntz.upper;
  }

  // ═══════════════════════════════════════════════════════════════
  //  BREAK DETECTION
  // ═══════════════════════════════════════════════════════════════

  _detectBreak(candle, priceHistory) {
    const price = c(candle);
    const candleOpen = o(candle);
    const body = Math.abs(price - candleOpen);

    // Need a candle with decent body (not a doji)
    if (body < this.atr * this.minBreakerBodyRatio) return;

    for (const level of this.keyLevels) {
      const breakThreshold = level.price * (this.breakConfirmPct / 100);

      // BULLISH BREAK: price closes above a resistance level
      if (price > level.price + breakThreshold && candleOpen < level.price) {
        // Candle opened below, closed above = breaker candle
        this.activeBreak = {
          level: level.price,
          direction: 'bullish',
          breakBar: this.barCount,
          breakoutHigh: h(candle),
          levelTests: level.tests,
          source: level.source || 'sr_zone',
        };
        this._logSignal('BREAK_BULLISH', `Broke above ${level.price.toFixed(2)} (${level.tests}x tested)`);
        return;
      }

      // BEARISH BREAK: price closes below a support level
      if (price < level.price - breakThreshold && candleOpen > level.price) {
        this.activeBreak = {
          level: level.price,
          direction: 'bearish',
          breakBar: this.barCount,
          breakoutLow: l(candle),
          levelTests: level.tests,
          source: level.source || 'sr_zone',
        };
        this._logSignal('BREAK_BEARISH', `Broke below ${level.price.toFixed(2)} (${level.tests}x tested)`);
        return;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  RETEST DETECTION (Battle Zone Entry)
  // ═══════════════════════════════════════════════════════════════

  _detectRetest(candle) {
    if (!this.activeBreak) return;

    const price = c(candle);
    const level = this.activeBreak.level;
    const retestZone = level * (this.retestZonePct / 100);

    if (this.activeBreak.direction === 'bullish') {
      // For bullish: retest = price pulls back DOWN to the broken level
      // Price should still be above or near the level
      if (Math.abs(price - level) <= retestZone || l(candle) <= level + retestZone) {
        this.battleZone = {
          enteredBar: this.barCount,
          candles: [candle],
          level: level,
          direction: 'bullish',
          breakoutHigh: this.activeBreak.breakoutHigh,
          flagHigh: h(candle),
          flagLow: l(candle),
        };
        this._logSignal('RETEST_BULLISH', `Price returned to ${level.toFixed(2)} — entering Battle Zone`);
      }
    } else {
      // For bearish: retest = price rallies back UP to the broken level
      if (Math.abs(price - level) <= retestZone || h(candle) >= level - retestZone) {
        this.battleZone = {
          enteredBar: this.barCount,
          candles: [candle],
          level: level,
          direction: 'bearish',
          breakoutLow: this.activeBreak.breakoutLow,
          flagHigh: h(candle),
          flagLow: l(candle),
        };
        this._logSignal('RETEST_BEARISH', `Price returned to ${level.toFixed(2)} — entering Battle Zone`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  BATTLE ZONE READING
  // ═══════════════════════════════════════════════════════════════

  _readBattleZone(candle, priceHistory) {
    const bz = this.battleZone;
    if (!bz) return this._emptySignal();

    const price = c(candle);
    const candleOpen = o(candle);
    const candleHigh = h(candle);
    const candleLow = l(candle);
    const body = Math.abs(price - candleOpen);
    const isBullishCandle = price > candleOpen;
    const isBearishCandle = price < candleOpen;

    // Update flag boundaries
    for (const cd of bz.candles) {
      if (h(cd) > bz.flagHigh) bz.flagHigh = h(cd);
      if (l(cd) < bz.flagLow) bz.flagLow = l(cd);
    }

    // ─── BULLISH ENTRY: Break & Retest Long ───
    if (bz.direction === 'bullish') {
      // Check for defending wicks: lows dip near/below level but close above
      const defendingWicks = bz.candles.filter(cd => {
        return l(cd) <= bz.level * 1.002 && c(cd) > bz.level;
      }).length;

      // Check for engulfing / strong bullish candle breaking flag
      const isEngulfing = this._isBullishEngulfing(candle, bz.candles);
      const isStrongBullish = isBullishCandle && body > this.atr * 0.5;
      const breaksFlagHigh = price > bz.flagHigh && isBullishCandle;

      // ENTRY CONDITION: Defending wicks + bullish confirmation + flag break
      if ((isEngulfing || isStrongBullish) && (breaksFlagHigh || defendingWicks >= 2)) {
        const stopLoss = Math.min(bz.level, bz.flagLow) - (this.atr * 0.2);
        const risk = price - stopLoss;
        const takeProfit = price + (risk * this.rewardRiskRatio);
        const pt2 = bz.breakoutHigh || (price + risk * 2.5);

        // Confidence based on quality
        let confidence = 0.35; // Base
        confidence += Math.min(0.15, defendingWicks * 0.05);        // Wick defense
        confidence += isEngulfing ? 0.15 : 0.05;                    // Candle quality
        confidence += Math.min(0.15, (bz.candles.length - 2) * 0.03); // Battle time
        confidence += Math.min(0.10, (this.activeBreak?.levelTests || 1) * 0.05); // Level quality
        confidence = Math.min(0.90, confidence);

        const reason = `BREAK_RETEST LONG: Broke ${bz.level.toFixed(0)}, retested ${bz.candles.length} bars, ` +
          `${defendingWicks} defending wicks, ${isEngulfing ? 'engulfing' : 'strong_bullish'}, ` +
          `S/R tested ${this.activeBreak?.levelTests || '?'}x`;

        this._logSignal('ENTRY_LONG', reason);
        this._resetState();

        return {
          direction: 'buy',
          confidence,
          reason,
          stopLoss,
          takeProfit,
          pt2,
          riskReward: risk > 0 ? (takeProfit - price) / risk : 0,
          entryType: 'break_retest_long',
          levelPrice: bz.level,
          battleCandles: bz.candles.length,
          defendingWicks,
        };
      }
    }

    // ─── BEARISH ENTRY: Break & Retest Short ───
    if (bz.direction === 'bearish') {
      // Check for rejection wicks: highs poke near/above level but close below
      const rejectionWicks = bz.candles.filter(cd => {
        return h(cd) >= bz.level * 0.998 && c(cd) < bz.level;
      }).length;

      // Check for engulfing / strong bearish candle breaking flag
      const isEngulfing = this._isBearishEngulfing(candle, bz.candles);
      const isStrongBearish = isBearishCandle && body > this.atr * 0.5;
      const breaksFlagLow = price < bz.flagLow && isBearishCandle;

      // ENTRY CONDITION: Rejection wicks + bearish confirmation + flag break
      if ((isEngulfing || isStrongBearish) && (breaksFlagLow || rejectionWicks >= 2)) {
        const stopLoss = Math.max(bz.level, bz.flagHigh) + (this.atr * 0.2);
        const risk = stopLoss - price;
        const takeProfit = price - (risk * this.rewardRiskRatio);
        const pt2 = bz.breakoutLow || (price - risk * 2.5);

        let confidence = 0.35;
        confidence += Math.min(0.15, rejectionWicks * 0.05);
        confidence += isEngulfing ? 0.15 : 0.05;
        confidence += Math.min(0.15, (bz.candles.length - 2) * 0.03);
        confidence += Math.min(0.10, (this.activeBreak?.levelTests || 1) * 0.05);
        confidence = Math.min(0.90, confidence);

        const reason = `BREAK_RETEST SHORT: Broke ${bz.level.toFixed(0)}, retested ${bz.candles.length} bars, ` +
          `${rejectionWicks} rejection wicks, ${isEngulfing ? 'engulfing' : 'strong_bearish'}, ` +
          `S/R tested ${this.activeBreak?.levelTests || '?'}x`;

        this._logSignal('ENTRY_SHORT', reason);
        this._resetState();

        return {
          direction: 'sell',
          confidence,
          reason,
          stopLoss,
          takeProfit,
          pt2,
          riskReward: risk > 0 ? (price - takeProfit) / risk : 0,
          entryType: 'break_retest_short',
          levelPrice: bz.level,
          battleCandles: bz.candles.length,
          rejectionWicks,
        };
      }
    }

    return this._emptySignal();
  }

  // ═══════════════════════════════════════════════════════════════
  //  INVALIDATION
  // ═══════════════════════════════════════════════════════════════

  _isInvalidated(candle) {
    if (!this.battleZone) return false;
    const price = c(candle);
    const level = this.battleZone.level;
    const invalidateThreshold = level * (this.breakConfirmPct * 2 / 100);

    if (this.battleZone.direction === 'bullish') {
      // Invalidated if price closes decisively BELOW the level
      return price < level - invalidateThreshold;
    } else {
      // Invalidated if price closes decisively ABOVE the level
      return price > level + invalidateThreshold;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  CANDLE PATTERN HELPERS
  // ═══════════════════════════════════════════════════════════════

  _isBullishEngulfing(candle, previousCandles) {
    if (previousCandles.length < 2) return false;
    const prev = previousCandles[previousCandles.length - 2];
    if (!prev) return false;

    const currClose = c(candle);
    const currOpen = o(candle);
    const prevClose = c(prev);
    const prevOpen = o(prev);

    // Current candle is bullish
    if (currClose <= currOpen) return false;
    // Previous candle was bearish (or small)
    if (prevClose > prevOpen) return false;
    // Current body engulfs previous body
    return currClose > prevOpen && currOpen < prevClose;
  }

  _isBearishEngulfing(candle, previousCandles) {
    if (previousCandles.length < 2) return false;
    const prev = previousCandles[previousCandles.length - 2];
    if (!prev) return false;

    const currClose = c(candle);
    const currOpen = o(candle);
    const prevClose = c(prev);
    const prevOpen = o(prev);

    // Current candle is bearish
    if (currClose >= currOpen) return false;
    // Previous candle was bullish (or small)
    if (prevClose < prevOpen) return false;
    // Current body engulfs previous body
    return currClose < prevOpen && currOpen > prevClose;
  }

  // ═══════════════════════════════════════════════════════════════
  //  UTILITIES
  // ═══════════════════════════════════════════════════════════════

  _calcATR(priceHistory, period = 14) {
    if (priceHistory.length < period + 1) return 0;
    const recent = priceHistory.slice(-period - 1);
    let sum = 0;
    for (let i = 1; i < recent.length; i++) {
      const tr = Math.max(
        h(recent[i]) - l(recent[i]),
        Math.abs(h(recent[i]) - c(recent[i - 1])),
        Math.abs(l(recent[i]) - c(recent[i - 1]))
      );
      sum += tr;
    }
    return sum / period;
  }

  _resetState() {
    this.activeBreak = null;
    this.battleZone = null;
  }

  _logSignal(type, msg) {
    const entry = { bar: this.barCount, type, msg, ts: Date.now() };
    this.signalLog.push(entry);
    if (this.signalLog.length > 30) this.signalLog = this.signalLog.slice(-30);
    console.log(`🔄 [BreakRetest] Bar ${this.barCount}: ${type} — ${msg}`);
  }

  _emptySignal() {
    return {
      direction: 'neutral',
      confidence: 0,
      reason: '',
      stopLoss: null,
      takeProfit: null,
      entryType: null,
      ntz: this.ntz,
      activeBreak: this.activeBreak ? {
        level: this.activeBreak.level,
        direction: this.activeBreak.direction,
        barsWaiting: this.barCount - (this.activeBreak?.breakBar || 0),
      } : null,
      battleZone: this.battleZone ? {
        level: this.battleZone.level,
        candles: this.battleZone.candles.length,
        direction: this.battleZone.direction,
      } : null,
      keyLevels: this.keyLevels.slice(0, 5).map(lv => ({
        price: lv.price,
        tests: lv.tests,
        type: lv.type,
      })),
    };
  }

  /**
   * Get current state for dashboard/debugging
   */
  getState() {
    return {
      barCount: this.barCount,
      keyLevels: this.keyLevels,
      ntz: this.ntz,
      activeBreak: this.activeBreak,
      battleZone: this.battleZone ? {
        level: this.battleZone.level,
        direction: this.battleZone.direction,
        candleCount: this.battleZone.candles.length,
      } : null,
      recentSignals: this.signalLog.slice(-5),
    };
  }
}

module.exports = BreakAndRetest;
