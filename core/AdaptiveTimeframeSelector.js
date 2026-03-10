/**
 * AdaptiveTimeframeSelector.js — Dynamic Timeframe Selection
 * ============================================================
 * 
 * THE PROBLEM THIS SOLVES:
 *   Hardcoding "always trade 15m" means the bot sits blind when 15m is choppy
 *   but 5m or 1h has a clean setup. Markets change character — sometimes 5m
 *   scalps are printing, sometimes only 4h swings make sense.
 * 
 * WHAT IT DOES:
 *   Reads per-timeframe indicators from MultiTimeframeAdapter and scores each
 *   timeframe on "tradability" — trend clarity, volatility vs fees, signal
 *   strength, and noise level. The highest-scoring timeframe becomes the
 *   active trading timeframe for the next evaluation cycle.
 * 
 * HOW IT INTEGRATES:
 *   1. MTF adapter provides per-timeframe indicators (already exists)
 *   2. This module scores each timeframe and picks the best one
 *   3. StrategyOrchestrator uses the selected timeframe's data for entry decisions
 *   4. ExitContractManager adjusts SL/TP based on the timeframe's typical range
 * 
 * USAGE:
 *   const selector = new AdaptiveTimeframeSelector({ mtfAdapter, feePercent: 0.26 });
 *   const best = selector.evaluate();
 *   // best = { timeframe: '15m', score: 0.82, reason: '...', exitParams: { ... } }
 * 
 * @module core/AdaptiveTimeframeSelector
 */

'use strict';

const TradingConfig = require('./TradingConfig');

class AdaptiveTimeframeSelector {
  constructor(config = {}) {
    this.mtfAdapter = config.mtfAdapter || null;

    // Kraken spot fees from TradingConfig (maker 0.25%, taker 0.40%, round-trip 0.50%)
    this.feePerSide = config.feePercent || (TradingConfig.get('fees.makerFee', 0.0025) * 100);  // As percent
    this.roundTripFee = TradingConfig.get('fees.totalRoundTrip', 0.005) * 100;  // 0.50%

    // Minimum R:R after fees for a timeframe to be tradable
    // If average move on a timeframe can't give at least 2:1 reward:risk after fees, skip it
    this.minRewardToRisk = config.minRewardToRisk || 2.0;

    // Timeframe characteristics — expected ATR ranges and exit parameters
    // These are baseline estimates; actual ATR from indicators overrides them
    this.timeframeProfiles = {
      '1m':  { typicalMovePct: 0.15, minMovePct: 0.08, slPct: 0.5,  tpPct: 0.8,  trailPct: 0.3,  maxHoldMin: 15,   weight: 0.3  },
      '5m':  { typicalMovePct: 0.40, minMovePct: 0.20, slPct: 1.0,  tpPct: 1.8,  trailPct: 0.6,  maxHoldMin: 60,   weight: 0.7  },
      '15m': { typicalMovePct: 0.80, minMovePct: 0.40, slPct: 1.5,  tpPct: 2.5,  trailPct: 1.0,  maxHoldMin: 120,  weight: 1.0  },
      '30m': { typicalMovePct: 1.20, minMovePct: 0.60, slPct: 2.0,  tpPct: 3.5,  trailPct: 1.5,  maxHoldMin: 240,  weight: 0.9  },
      '1h':  { typicalMovePct: 1.80, minMovePct: 0.80, slPct: 2.5,  tpPct: 4.5,  trailPct: 2.0,  maxHoldMin: 480,  weight: 0.85 },
      '4h':  { typicalMovePct: 3.50, minMovePct: 1.50, slPct: 3.5,  tpPct: 7.0,  trailPct: 3.0,  maxHoldMin: 1440, weight: 0.6  },
      '1d':  { typicalMovePct: 5.00, minMovePct: 2.50, slPct: 5.0,  tpPct: 10.0, trailPct: 4.0,  maxHoldMin: 4320, weight: 0.4  },
    };

    // Allowed timeframes for trading (can be restricted)
    this.allowedTimeframes = config.allowedTimeframes || ['5m', '15m', '30m', '1h'];

    // How often to re-evaluate (don't switch every minute)
    this.minSwitchIntervalMs = config.minSwitchIntervalMs || 5 * 60 * 1000; // 5 min minimum
    this.lastSwitchTime = 0;

    // State
    this.currentTimeframe = config.defaultTimeframe || '15m';
    this.lastEvaluation = null;
    this.evalCount = 0;
    this.switchCount = 0;
  }

  /**
   * Score each allowed timeframe and pick the best one for current conditions.
   * 
   * @returns {Object} { timeframe, score, scores, exitParams, reason, switched }
   */
  evaluate() {
    this.evalCount++;

    if (!this.mtfAdapter) {
      return this._defaultResult('No MTF adapter available');
    }

    const scores = {};
    const details = {};

    for (const tf of this.allowedTimeframes) {
      const result = this._scoreTimeframe(tf);
      scores[tf] = result.score;
      details[tf] = result;
    }

    // Find the best timeframe
    let bestTf = this.currentTimeframe;
    let bestScore = scores[bestTf] || 0;

    for (const [tf, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestTf = tf;
      }
    }

    // Hysteresis: only switch if the new timeframe is significantly better (20%+)
    // This prevents ping-ponging between timeframes
    const currentScore = scores[this.currentTimeframe] || 0;
    const improvement = bestScore - currentScore;
    const shouldSwitch = improvement > 0.15 && (Date.now() - this.lastSwitchTime > this.minSwitchIntervalMs);

    let switched = false;
    if (shouldSwitch && bestTf !== this.currentTimeframe) {
      const oldTf = this.currentTimeframe;
      this.currentTimeframe = bestTf;
      this.lastSwitchTime = Date.now();
      this.switchCount++;
      switched = true;
      console.log(`🔄 [TIMEFRAME] Switched ${oldTf} → ${bestTf} (score: ${currentScore.toFixed(2)} → ${bestScore.toFixed(2)}, improvement: ${(improvement * 100).toFixed(0)}%)`);
    }

    // Get exit parameters for the selected timeframe
    const profile = this.timeframeProfiles[this.currentTimeframe] || this.timeframeProfiles['15m'];
    const exitParams = {
      stopLossPercent: -profile.slPct,
      takeProfitPercent: profile.tpPct,
      trailingStopPercent: profile.trailPct,
      maxHoldTimeMinutes: profile.maxHoldMin,
    };

    const result = {
      timeframe: this.currentTimeframe,
      score: scores[this.currentTimeframe] || 0,
      scores,
      details,
      exitParams,
      switched,
      reason: details[this.currentTimeframe]?.reason || 'default',
    };

    this.lastEvaluation = result;
    return result;
  }

  /**
   * Score a single timeframe on tradability.
   * 
   * Factors:
   *   1. Fee viability — can moves on this TF clear fees?
   *   2. Trend clarity — is there a clear direction?
   *   3. Signal strength — how strong are the indicators?
   *   4. Noise level — is it choppy or clean?
   *   5. Timeframe weight — preference for medium timeframes
   */
  _scoreTimeframe(tf) {
    const profile = this.timeframeProfiles[tf];
    if (!profile) return { score: 0, reason: 'Unknown timeframe' };

    const indicators = this.mtfAdapter.getTimeframeIndicators(tf);
    if (!indicators) return { score: 0, reason: `${tf} not ready` };

    let score = 0;
    const factors = [];

    // ─── Factor 1: Fee viability (0 - 0.25) ───
    // Can the typical move on this timeframe overcome fees and leave profit?
    const atrPct = indicators.atr && indicators.price
      ? (indicators.atr / indicators.price) * 100
      : profile.typicalMovePct;

    const netMoveAfterFees = atrPct - this.roundTripFee;
    if (netMoveAfterFees <= 0) {
      // This timeframe can't even clear fees — disqualified
      return { score: 0, reason: `${tf}: ATR ${atrPct.toFixed(2)}% < fees ${this.roundTripFee}%` };
    }

    const feeViability = Math.min(0.25, (netMoveAfterFees / atrPct) * 0.25);
    score += feeViability;
    factors.push(`fees: ${feeViability.toFixed(2)} (ATR ${atrPct.toFixed(2)}%, net ${netMoveAfterFees.toFixed(2)}%)`);

    // ─── Factor 2: Trend clarity (0 - 0.30) ───
    // Clear trend = higher score. Choppy/neutral = lower.
    let trendScore = 0;
    if (indicators.trend === 'bullish' || indicators.trend === 'bearish') {
      const strength = indicators.trendStrength || 0.5;
      trendScore = 0.15 + (strength * 0.15); // 0.15 - 0.30
    } else {
      trendScore = 0.05; // Neutral/ranging — still tradable but less ideal
    }
    score += trendScore;
    factors.push(`trend: ${trendScore.toFixed(2)} (${indicators.trend || 'unknown'})`);

    // ─── Factor 3: Signal strength (0 - 0.25) ───
    // RSI at extremes, MACD crossover, strong EMA alignment = higher score
    let signalScore = 0;

    if (indicators.rsi != null) {
      if (indicators.rsi < 30 || indicators.rsi > 70) {
        signalScore += 0.10; // Extreme RSI = clear signal
      } else if (indicators.rsi < 40 || indicators.rsi > 60) {
        signalScore += 0.05; // Moderate lean
      }
    }

    if (indicators.macd) {
      if (indicators.macd.crossover) signalScore += 0.08; // Fresh crossover
      else if (indicators.macd.bullish || indicators.macd.bearish) signalScore += 0.04;
    }

    // EMA alignment (price above/below key EMAs)
    if (indicators.ema && indicators.price) {
      const emaDistance = Math.abs(indicators.price - indicators.ema) / indicators.price;
      if (emaDistance > 0.005 && emaDistance < 0.03) {
        signalScore += 0.07; // Price near EMA but not on it — potential bounce zone
      }
    }

    signalScore = Math.min(0.25, signalScore);
    score += signalScore;
    factors.push(`signal: ${signalScore.toFixed(2)}`);

    // ─── Factor 4: Noise level (0 - 0.10) ───
    // Low noise (clean candles) = higher score
    // Approximate noise by checking Bollinger bandwidth
    let noiseScore = 0.05; // Default moderate
    if (indicators.bollinger) {
      const bw = indicators.bollinger.upper - indicators.bollinger.lower;
      if (bw > 0 && indicators.price) {
        const bwPct = (bw / indicators.price) * 100;
        // Tight bands = compressed, about to move (good)
        // Very wide bands = volatile/noisy (less good)
        if (bwPct < 1.5) noiseScore = 0.08; // Compressed — potential breakout
        else if (bwPct < 3.0) noiseScore = 0.06; // Normal
        else noiseScore = 0.02; // Wide — noisy
      }
    }
    score += noiseScore;
    factors.push(`noise: ${noiseScore.toFixed(2)}`);

    // ─── Factor 5: Timeframe preference weight (0 - 0.10) ───
    // Slight preference for medium timeframes (15m, 30m)
    const prefScore = profile.weight * 0.10;
    score += prefScore;
    factors.push(`pref: ${prefScore.toFixed(2)}`);

    return {
      score,
      factors,
      reason: `${tf}: ${score.toFixed(2)} [${factors.join(' | ')}]`,
      indicators: {
        trend: indicators.trend,
        rsi: indicators.rsi,
        atrPct,
      },
    };
  }

  /**
   * Default result when evaluation can't run
   */
  _defaultResult(reason) {
    const profile = this.timeframeProfiles[this.currentTimeframe] || this.timeframeProfiles['15m'];
    return {
      timeframe: this.currentTimeframe,
      score: 0.5,
      scores: {},
      details: {},
      exitParams: {
        stopLossPercent: -profile.slPct,
        takeProfitPercent: profile.tpPct,
        trailingStopPercent: profile.trailPct,
        maxHoldTimeMinutes: profile.maxHoldMin,
      },
      switched: false,
      reason,
    };
  }

  /**
   * Get current state for dashboard/monitoring
   */
  getState() {
    return {
      currentTimeframe: this.currentTimeframe,
      evalCount: this.evalCount,
      switchCount: this.switchCount,
      lastEvaluation: this.lastEvaluation,
    };
  }

  /**
   * Force a specific timeframe (for testing or manual override)
   */
  forceTimeframe(tf) {
    if (this.timeframeProfiles[tf]) {
      this.currentTimeframe = tf;
      this.lastSwitchTime = Date.now();
      console.log(`🔒 [TIMEFRAME] Forced to ${tf}`);
    }
  }
}

module.exports = { AdaptiveTimeframeSelector };
