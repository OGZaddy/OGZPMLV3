/**
 * DashboardBroadcaster - Phase 17 Extraction
 *
 * EXACT COPY of broadcastEdgeAnalytics(), calculateVolatility(), detectDivergences()
 * from run-empire-v2.js. NO logic changes.
 *
 * Dependencies passed via context object in constructor.
 *
 * @module core/DashboardBroadcaster
 */

'use strict';

// Candle accessors (V2 format: c/o/h/l/v/t)
const _c = (candle) => candle?.c ?? candle?.close ?? 0;
const _o = (candle) => candle?.o ?? candle?.open ?? 0;
const _h = (candle) => candle?.h ?? candle?.high ?? 0;
const _l = (candle) => candle?.l ?? candle?.low ?? 0;

class DashboardBroadcaster {
  constructor(ctx) {
    this.ctx = ctx;
    this.edgeAnalytics = null;  // Initialized on first use
    console.log('[DashboardBroadcaster] Initialized (Phase 17 - exact copy)');
  }

  /**
   * Broadcast Edge Analytics data to dashboard
   * Includes CVD, liquidation levels, funding rates, whale alerts, market internals
   * EXACT COPY from run-empire-v2.js
   */
  broadcastEdgeAnalytics(price, volume, candle) {
    try {
      if (!this.ctx.dashboardWs || this.ctx.dashboardWs.readyState !== 1) return;

      // Initialize edge analytics state if needed
      if (!this.edgeAnalytics) {
        this.edgeAnalytics = {
          cvd: 0,
          buyVolume: 0,
          sellVolume: 0,
          lastFundingCheck: 0,
          fundingRate: 0.0001,
          liquidationLevels: { long: {}, short: {} },
          marketInternals: {},
          fearGreedValue: 50,
          smartMoney: { flow: 'NEUTRAL', activity: 'MEDIUM' },
          whaleTrades: [],
          lastLiquidationCalc: 0,
          lastInternalsCalc: 0,
          lastFearGreedCalc: 0,
          lastDivergenceCheck: 0,
          lastSmartMoneyCheck: 0
        };
      }

      // Calculate CVD (Cumulative Volume Delta)
      const isBuy = _c(candle) >= _o(candle);  // Simple: close >= open = buy pressure
      const volumeDelta = isBuy ? volume : -volume;
      this.edgeAnalytics.cvd += volumeDelta;
      this.edgeAnalytics.buyVolume += isBuy ? volume : 0;
      this.edgeAnalytics.sellVolume += !isBuy ? volume : 0;

      // Send CVD update
      this.ctx.dashboardWs.send(JSON.stringify({
        type: 'cvd_update',
        cvd: this.edgeAnalytics.cvd,
        buyVolume: this.edgeAnalytics.buyVolume,
        sellVolume: this.edgeAnalytics.sellVolume,
        timestamp: Date.now()
      }));

      // Calculate liquidation levels (every 10 seconds)
      const now = Date.now();
      if (now - this.edgeAnalytics.lastLiquidationCalc > 10000) {
        this.edgeAnalytics.lastLiquidationCalc = now;

        // Typical leverages for crypto
        const leverages = [10, 25, 50, 100];
        const liquidationData = {
          long: { price: 0, volume: 0 },
          short: { price: 99999999, volume: 0 }
        };

        // Calculate weighted liquidation zones
        leverages.forEach(leverage => {
          const longLiq = price * (1 - 1/leverage);
          const shortLiq = price * (1 + 1/leverage);

          // Weight by typical leverage usage
          const weight = 100 / leverage;

          // Find nearest liquidation clusters
          if (longLiq > liquidationData.long.price) {
            liquidationData.long.price = longLiq;
          }
          liquidationData.long.volume += volume * weight * 10000;

          if (shortLiq < liquidationData.short.price) {
            liquidationData.short.price = shortLiq;
          }
          liquidationData.short.volume += volume * weight * 10000;
        });

        this.edgeAnalytics.liquidationLevels = liquidationData;

        this.ctx.dashboardWs.send(JSON.stringify({
          type: 'liquidation_data',
          levels: liquidationData,
          currentPrice: price,
          timestamp: Date.now()
        }));
      }

      // Check for whale trades (large volume)
      const avgVolume = this.ctx.priceHistory.slice(-20).reduce((sum, c) => sum + (c.v || 0), 0) / 20;
      if (volume > avgVolume * 5) {  // 5x average = whale
        const whaleData = {
          size: volume * price,  // USD value
          price: price,
          side: isBuy ? 'BUY' : 'SELL',
          timestamp: Date.now()
        };

        this.edgeAnalytics.whaleTrades.push(whaleData);
        if (this.edgeAnalytics.whaleTrades.length > 10) {
          this.edgeAnalytics.whaleTrades.shift();
        }

        this.ctx.dashboardWs.send(JSON.stringify({
          type: 'whale_trade',
          ...whaleData
        }));
      }

      // Calculate market internals (every 5 seconds)
      if (now - this.edgeAnalytics.lastInternalsCalc > 5000) {
        this.edgeAnalytics.lastInternalsCalc = now;

        const buySellRatio = this.edgeAnalytics.buyVolume / Math.max(this.edgeAnalytics.sellVolume, 0.01);
        const aggressor = buySellRatio > 1.2 ? 'BUYERS' : buySellRatio < 0.8 ? 'SELLERS' : 'NEUTRAL';
        const spread = candle.h - candle.l;
        const spreadPercent = (spread / price) || 0;

        const internals = {
          buySellRatio: buySellRatio,
          aggressor: aggressor,
          bookImbalance: (buySellRatio - 1) / (buySellRatio + 1),
          spread: spreadPercent
        };

        this.edgeAnalytics.marketInternals = internals;

        this.ctx.dashboardWs.send(JSON.stringify({
          type: 'market_internals',
          ...internals,
          timestamp: Date.now()
        }));
      }

      // Update funding rates (every 60 seconds)
      if (now - this.edgeAnalytics.lastFundingCheck > 60000) {
        this.edgeAnalytics.lastFundingCheck = now;

        const momentum = this.ctx.priceHistory.length > 10 ?
          (price - _c(this.ctx.priceHistory[this.ctx.priceHistory.length - 10])) / _c(this.ctx.priceHistory[this.ctx.priceHistory.length - 10]) : 0;
        const fundingBias = momentum * 0.001;
        this.edgeAnalytics.fundingRate = 0.0001 + fundingBias;

        const predictedFunding = this.edgeAnalytics.fundingRate * (1 + momentum);

        this.ctx.dashboardWs.send(JSON.stringify({
          type: 'funding_rate',
          current: this.edgeAnalytics.fundingRate,
          predicted: predictedFunding,
          timestamp: Date.now()
        }));
      }

      // Calculate Fear & Greed (every 30 seconds)
      if (now - this.edgeAnalytics.lastFearGreedCalc > 30000) {
        this.edgeAnalytics.lastFearGreedCalc = now;

        const volatility = this.calculateVolatility();
        const momentum = this.ctx.priceHistory.length > 10 ?
          (price - _c(this.ctx.priceHistory[this.ctx.priceHistory.length - 10])) / _c(this.ctx.priceHistory[this.ctx.priceHistory.length - 10]) : 0;
        const volumeTrend = volume / Math.max(avgVolume, 0.01);

        const fearGreed = Math.min(100, Math.max(0,
          50 +
          (momentum > 0 ? 20 : -20) +
          (volatility < 0.02 ? 10 : -10) +
          (volumeTrend > 1 ? 10 : -10) +
          (this.edgeAnalytics.cvd > 0 ? 10 : -10)
        ));

        this.edgeAnalytics.fearGreedValue = fearGreed;

        this.ctx.dashboardWs.send(JSON.stringify({
          type: 'fear_greed',
          value: fearGreed,
          timestamp: Date.now()
        }));
      }

      // Detect divergences (every 15 seconds)
      if (now - this.edgeAnalytics.lastDivergenceCheck > 15000) {
        this.edgeAnalytics.lastDivergenceCheck = now;

        const divergences = this.detectDivergences();

        if (divergences.length > 0) {
          this.ctx.dashboardWs.send(JSON.stringify({
            type: 'divergence',
            divergences: divergences,
            timestamp: Date.now()
          }));
        }
      }

      // Smart Money Flow (every 20 seconds)
      if (now - this.edgeAnalytics.lastSmartMoneyCheck > 20000) {
        this.edgeAnalytics.lastSmartMoneyCheck = now;

        const priceChange = this.ctx.priceHistory.length > 10 ?
          (price - _c(this.ctx.priceHistory[Math.max(0, this.ctx.priceHistory.length - 10)])) / price : 0;
        const volumeProfile = this.edgeAnalytics.whaleTrades.filter(t => t.side === 'BUY').length;

        let flow = 'NEUTRAL';
        if (priceChange < -0.02 && volumeProfile > 3) flow = 'ACCUMULATING';
        else if (priceChange > 0.02 && volumeProfile < 2) flow = 'DISTRIBUTING';

        const activity = volume > avgVolume * 3 ? 'HIGH' : volume > avgVolume * 1.5 ? 'MEDIUM' : 'LOW';

        this.edgeAnalytics.smartMoney = { flow, activity };

        this.ctx.dashboardWs.send(JSON.stringify({
          type: 'smart_money',
          flow: flow,
          activity: activity,
          dormancy: 'LOW',
          timestamp: Date.now()
        }));
      }

    } catch (error) {
      console.error('⚠️ Edge analytics broadcast failed:', error.message);
    }
  }

  /**
   * Calculate price volatility for Fear & Greed
   * EXACT COPY from run-empire-v2.js
   */
  calculateVolatility() {
    if (this.ctx.priceHistory.length < 20) return 0.02;

    const returns = [];
    for (let i = 1; i < Math.min(20, this.ctx.priceHistory.length); i++) {
      const ret = (_c(this.ctx.priceHistory[i]) - _c(this.ctx.priceHistory[i-1])) / _c(this.ctx.priceHistory[i-1]);
      returns.push(ret);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  /**
   * Detect price/indicator divergences
   * EXACT COPY from run-empire-v2.js
   */
  detectDivergences() {
    const divergences = [];

    if (this.ctx.priceHistory.length < 20) return divergences;

    const recentPrices = this.ctx.priceHistory.slice(-20);
    const priceHigh = Math.max(...recentPrices.map(candle => _h(candle)));
    const priceLow = Math.min(...recentPrices.map(candle => _l(candle)));
    const currentPrice = _c(recentPrices[recentPrices.length - 1]);

    const indicators = this.ctx.indicatorEngine.getSnapshot();
    const rsi = indicators?.indicators?.rsi;

    if (rsi) {
      if (currentPrice > priceHigh * 0.98 && rsi < 70) {
        divergences.push({
          type: 'bearish',
          indicator: 'RSI',
          timeframe: '1m'
        });
      } else if (currentPrice < priceLow * 1.02 && rsi > 30) {
        divergences.push({
          type: 'bullish',
          indicator: 'RSI',
          timeframe: '1m'
        });
      }
    }

    const avgVolume = recentPrices.reduce((sum, c) => sum + c.v, 0) / recentPrices.length;
    const currentVolume = recentPrices[recentPrices.length - 1].v;

    if (currentPrice > priceHigh * 0.98 && currentVolume < avgVolume * 0.7) {
      divergences.push({
        type: 'bearish',
        indicator: 'Volume',
        timeframe: '1m'
      });
    }

    return divergences;
  }
}

module.exports = DashboardBroadcaster;
