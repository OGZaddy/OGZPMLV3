/**
 * VolumeProfile.js — Fabio Valentino / Auction Market Theory
 * ===========================================================
 * SOURCE: Chart Fanatics — Fabio Valentino (Robbins World Cup Top 3, 500%+ return)
 *
 * CORE CONCEPT:
 *   Market is an auction. Price moves from balance → imbalance → new balance.
 *   Volume Profile shows WHERE the market accepted price (balance)
 *   and where it moved through quickly (imbalance / low volume nodes).
 *
 * WHAT THIS MODULE PRODUCES:
 *   - POC (Point of Control): Price level with most volume = "fair price"
 *   - VAH (Value Area High): Upper bound where 70% of volume transacted
 *   - VAL (Value Area Low): Lower bound where 70% of volume transacted
 *   - Low Volume Nodes: Gaps in profile where price moves FAST
 *   - High Volume Nodes: Clusters where price consolidates
 *   - Market State: BALANCED (inside VA) vs IMBALANCED (outside VA)
 *
 * FABIO'S RULES:
 *   - Only trend follow when OUT OF BALANCE (price outside value area)
 *   - Mean revert when price goes to discount/premium and returns to POC
 *   - Low Volume Nodes = entry zones (price moves through fast, tight stops)
 *   - POC = target for mean reversion (70% probability of reaching it)
 *   - Previous day's POC/VAH/VAL = key levels for next session
 *
 * INTEGRATION:
 *   const vp = new VolumeProfile();
 *   vp.update(candle, priceHistory);
 *   const profile = vp.getProfile();
 *   // profile = { poc, vah, val, lvns[], hvns[], marketState, ... }
 *
 * @module core/VolumeProfile
 */

'use strict';

const { c, o, h, l, v } = require('./CandleHelper');

class VolumeProfile {
  constructor(config = {}) {
    // ─── PROFILE SETTINGS ───
    // Number of price bins to divide the range into
    this.numBins = config.numBins || 50;

    // Value area percentage (standard is 70% — where 70% of volume transacted)
    this.valueAreaPct = config.valueAreaPct || 0.70;

    // Session lookback for building the profile (candles)
    this.sessionLookback = config.sessionLookback || 96;  // 96 x 15min = 24 hours

    // Low Volume Node threshold (below this % of max bin = LVN)
    this.lvnThresholdPct = config.lvnThresholdPct || 0.20;

    // High Volume Node threshold (above this % of max bin = HVN)
    this.hvnThresholdPct = config.hvnThresholdPct || 0.60;

    // Recalculate interval (every N candles)
    this.recalcInterval = config.recalcInterval || 5;

    // How far outside VA to consider "out of balance" (% beyond VAH/VAL)
    // FIX 2026-03-06: Was 0.1% (too tight), changed to 0.5% per STRATEGY-REWRITE-SPEC
    this.outOfBalancePct = config.outOfBalancePct || 0.5;

    // ─── INTERNAL STATE ───
    this.profile = null;          // Current computed profile
    this.previousProfile = null;  // Previous session profile (for targets)
    this.barCount = 0;
    this.lastProfileBar = -999;
  }

  // ═══════════════════════════════════════════════════════════════
  //  CORE API
  // ═══════════════════════════════════════════════════════════════

  /**
   * Update with new candle data
   * @param {Object} candle       — current candle
   * @param {Array}  priceHistory  — candles array, newest LAST
   */
  update(candle, priceHistory) {
    if (!priceHistory || priceHistory.length < 20) return;

    this.barCount++;

    // Recalculate profile periodically
    if (this.barCount - this.lastProfileBar >= this.recalcInterval) {
      // Save current as previous before rebuilding
      if (this.profile) {
        this.previousProfile = { ...this.profile };
      }
      this._buildProfile(priceHistory);
      this.lastProfileBar = this.barCount;
    }
  }

  /**
   * Get the current volume profile data
   * @returns {Object} profile data for use by strategies
   */
  getProfile() {
    if (!this.profile) {
      return {
        poc: null,
        vah: null,
        val: null,
        lvns: [],
        hvns: [],
        marketState: 'unknown',
        bins: [],
        previousPoc: null,
        previousVah: null,
        previousVal: null,
      };
    }
    return this.profile;
  }

  /**
   * Check if current price is in balanced or imbalanced state
   * @param {number} price — current price
   * @returns {Object} { state: 'balanced'|'imbalanced_high'|'imbalanced_low', nearestLvn, nearestHvn }
   */
  getMarketState(price) {
    if (!this.profile) return { state: 'unknown' };

    const { vah, val, poc, lvns, hvns } = this.profile;

    let state = 'balanced';
    if (price > vah * (1 + this.outOfBalancePct / 100)) {
      state = 'imbalanced_high';  // Above value area = expensive, trend up
    } else if (price < val * (1 - this.outOfBalancePct / 100)) {
      state = 'imbalanced_low';   // Below value area = cheap, trend down
    }

    // Find nearest LVN and HVN
    let nearestLvn = null;
    let nearestLvnDist = Infinity;
    for (const lvn of lvns) {
      const dist = Math.abs(price - lvn.price);
      if (dist < nearestLvnDist) {
        nearestLvnDist = dist;
        nearestLvn = lvn;
      }
    }

    let nearestHvn = null;
    let nearestHvnDist = Infinity;
    for (const hvn of hvns) {
      const dist = Math.abs(price - hvn.price);
      if (dist < nearestHvnDist) {
        nearestHvnDist = dist;
        nearestHvn = hvn;
      }
    }

    return {
      state,
      priceRelativeToPoc: poc ? ((price - poc) / poc * 100).toFixed(2) : null,
      priceRelativeToVah: vah ? ((price - vah) / vah * 100).toFixed(2) : null,
      priceRelativeToVal: val ? ((price - val) / val * 100).toFixed(2) : null,
      nearestLvn: nearestLvn ? {
        price: nearestLvn.price,
        distance: nearestLvnDist,
        distancePct: poc ? (nearestLvnDist / poc * 100).toFixed(3) : null,
      } : null,
      nearestHvn: nearestHvn ? {
        price: nearestHvn.price,
        distance: nearestHvnDist,
      } : null,
    };
  }

  /**
   * Get target for mean reversion (POC) or trend continuation
   * @param {string} direction — 'buy' or 'sell'
   * @param {number} price — current price
   * @returns {Object} { meanReversionTarget, trendTarget, stopLevel }
   */
  getTargets(direction, price) {
    if (!this.profile) return null;

    const { poc, vah, val, lvns } = this.profile;
    const prevPoc = this.previousProfile?.poc;

    if (direction === 'buy') {
      return {
        // Mean reversion: price is below POC, target = POC (Fabio's 70% probability)
        meanReversionTarget: poc,
        // Trend: price is above VAH, target = previous POC or next HVN
        trendTarget: prevPoc && prevPoc > price ? prevPoc : vah * 1.01,
        // Stop below VAL or nearest LVN below
        stopLevel: val,
        // Entry zones: LVNs below current price (price moves fast through these)
        entryZones: lvns
          .filter(n => n.price < price)
          .sort((a, b) => b.price - a.price)
          .slice(0, 3),
      };
    } else {
      return {
        meanReversionTarget: poc,
        trendTarget: prevPoc && prevPoc < price ? prevPoc : val * 0.99,
        stopLevel: vah,
        entryZones: lvns
          .filter(n => n.price > price)
          .sort((a, b) => a.price - b.price)
          .slice(0, 3),
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PROFILE BUILDER
  // ═══════════════════════════════════════════════════════════════

  _buildProfile(priceHistory) {
    const candles = priceHistory.slice(-this.sessionLookback);
    if (candles.length < 20) return;

    // Find price range
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    for (const cd of candles) {
      const cdHigh = h(cd);
      const cdLow = l(cd);
      if (cdHigh > maxPrice) maxPrice = cdHigh;
      if (cdLow < minPrice) minPrice = cdLow;
    }

    if (maxPrice <= minPrice) return;

    const range = maxPrice - minPrice;
    const binSize = range / this.numBins;

    // Build volume histogram
    // Each candle distributes its volume across the bins it touches
    const bins = new Array(this.numBins).fill(0);
    const binPrices = new Array(this.numBins);

    for (let i = 0; i < this.numBins; i++) {
      binPrices[i] = minPrice + (i + 0.5) * binSize; // Midpoint of bin
    }

    for (const cd of candles) {
      const cdHigh = h(cd);
      const cdLow = l(cd);
      const cdVol = v(cd) || 1; // Fallback to 1 if no volume
      const cdClose = c(cd);
      const cdOpen = o(cd);

      // Which bins does this candle touch?
      const lowBin = Math.floor((cdLow - minPrice) / binSize);
      const highBin = Math.floor((cdHigh - minPrice) / binSize);

      const touchedBins = Math.max(1, highBin - lowBin + 1);
      const volPerBin = cdVol / touchedBins;

      // Distribute volume with emphasis on close (more volume where candle closed)
      for (let b = Math.max(0, lowBin); b <= Math.min(this.numBins - 1, highBin); b++) {
        // Weight: more volume near the close price
        const binMid = binPrices[b];
        const distToClose = Math.abs(binMid - cdClose);
        const distToOpen = Math.abs(binMid - cdOpen);
        const minDist = Math.min(distToClose, distToOpen);
        const maxDist = cdHigh - cdLow || 1;
        const weight = 1 + (1 - minDist / maxDist); // 1-2x weight, higher near close/open

        bins[b] += volPerBin * weight;
      }
    }

    // ─── Find POC (bin with max volume) ───
    let maxVol = 0;
    let pocBin = 0;
    for (let i = 0; i < bins.length; i++) {
      if (bins[i] > maxVol) {
        maxVol = bins[i];
        pocBin = i;
      }
    }
    const poc = binPrices[pocBin];

    // ─── Calculate Value Area (70% of total volume) ───
    const totalVolume = bins.reduce((sum, b) => sum + b, 0);
    const targetVolume = totalVolume * this.valueAreaPct;

    // Start from POC, expand up and down until 70% captured
    let vaVolume = bins[pocBin];
    let vaLowBin = pocBin;
    let vaHighBin = pocBin;

    while (vaVolume < targetVolume && (vaLowBin > 0 || vaHighBin < bins.length - 1)) {
      const expandUp = vaHighBin < bins.length - 1 ? bins[vaHighBin + 1] : 0;
      const expandDown = vaLowBin > 0 ? bins[vaLowBin - 1] : 0;

      if (expandUp >= expandDown) {
        vaHighBin++;
        vaVolume += bins[vaHighBin];
      } else {
        vaLowBin--;
        vaVolume += bins[vaLowBin];
      }
    }

    const vah = binPrices[vaHighBin] + binSize / 2; // Top of upper bin
    const val = binPrices[vaLowBin] - binSize / 2;  // Bottom of lower bin

    // ─── Find Low Volume Nodes ───
    const lvnThreshold = maxVol * this.lvnThresholdPct;
    const lvns = [];
    for (let i = 1; i < bins.length - 1; i++) {
      // LVN = bin significantly lower than neighbors
      if (bins[i] < lvnThreshold && bins[i] < bins[i - 1] * 0.6 && bins[i] < bins[i + 1] * 0.6) {
        lvns.push({
          price: binPrices[i],
          volume: bins[i],
          volumePct: (bins[i] / maxVol * 100).toFixed(1),
          binIndex: i,
        });
      }
    }

    // ─── Find High Volume Nodes ───
    const hvnThreshold = maxVol * this.hvnThresholdPct;
    const hvns = [];
    for (let i = 0; i < bins.length; i++) {
      if (bins[i] >= hvnThreshold && i !== pocBin) {
        hvns.push({
          price: binPrices[i],
          volume: bins[i],
          volumePct: (bins[i] / maxVol * 100).toFixed(1),
          binIndex: i,
        });
      }
    }

    // ─── Determine current market state ───
    const currentPrice = c(candles[candles.length - 1]);
    let marketState = 'balanced';
    if (currentPrice > vah) {
      marketState = 'imbalanced_high';
    } else if (currentPrice < val) {
      marketState = 'imbalanced_low';
    }

    // ─── Store profile ───
    this.profile = {
      poc,
      vah,
      val,
      lvns,
      hvns,
      marketState,
      currentPrice,
      rangeHigh: maxPrice,
      rangeLow: minPrice,
      binSize,
      totalVolume,
      valueAreaVolumePct: ((vaVolume / totalVolume) * 100).toFixed(1),
      bins: bins.map((vol, i) => ({
        price: binPrices[i],
        volume: vol,
        isVA: i >= vaLowBin && i <= vaHighBin,
        isPoc: i === pocBin,
      })),
      // Previous session data for targets
      previousPoc: this.previousProfile?.poc || null,
      previousVah: this.previousProfile?.vah || null,
      previousVal: this.previousProfile?.val || null,
      // Timestamp
      calculatedAt: this.barCount,
      candlesUsed: candles.length,
    };
  }

  /**
   * Get a human-readable summary for logging
   */
  getSummary() {
    if (!this.profile) return 'No profile computed yet';

    const p = this.profile;
    return `VP: POC=${p.poc?.toFixed(0)} | VAH=${p.vah?.toFixed(0)} | VAL=${p.val?.toFixed(0)} | ` +
      `State=${p.marketState} | LVNs=${p.lvns.length} | HVNs=${p.hvns.length} | ` +
      `Price=${p.currentPrice?.toFixed(0)} | VA=${p.valueAreaVolumePct}%`;
  }

  /**
   * Check if a strategy should be allowed based on market state
   * Fabio's rule: trend follow ONLY when out of balance
   * @param {string} strategyType — 'trend' or 'reversion'
   * @param {number} price
   * @returns {Object} { allowed, reason }
   */
  filterStrategy(strategyType, price) {
    if (!this.profile) return { allowed: true, reason: 'No profile yet' };

    const state = this.getMarketState(price);

    if (strategyType === 'trend') {
      // Trend following only allowed when OUT of balance
      if (state.state === 'balanced') {
        return {
          allowed: false,
          reason: `Trend blocked: Price inside value area (${state.priceRelativeToPoc}% from POC)`,
        };
      }
      return {
        allowed: true,
        reason: `Trend allowed: ${state.state} (${state.priceRelativeToPoc}% from POC)`,
      };
    }

    if (strategyType === 'reversion') {
      // Mean reversion only allowed when IN balance or returning to balance
      if (state.state !== 'balanced') {
        // Allow if price is heading back toward POC
        return {
          allowed: true,
          reason: `Reversion allowed: Price ${state.state}, target POC at ${this.profile.poc?.toFixed(0)}`,
        };
      }
      return {
        allowed: true,
        reason: `Reversion allowed: Balanced market`,
      };
    }

    return { allowed: true, reason: 'Unknown strategy type' };
  }
}

module.exports = VolumeProfile;
