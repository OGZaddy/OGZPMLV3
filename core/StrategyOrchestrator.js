/**
 * StrategyOrchestrator.js — Isolated Strategy Entry Pipeline
 * ============================================================
 * 
 * THE FIX FOR THE SOUPY POOLED CONFIDENCE PROBLEM.
 * 
 * BEFORE (broken):
 *   All signals → blend into one number → trade on that number
 *   Result: 8 weak signals = high confidence = bad trade
 * 
 * AFTER (this file):
 *   Each strategy evaluates independently → highest confidence WINS →
 *   winner OWNS the trade (its exit contract, its SL/TP) →
 *   confluence only affects POSITION SIZING (2x for 2 agree, 3x for 3)
 * 
 * INTEGRATION:
 *   const orchestrator = new StrategyOrchestrator(config);
 *   const result = orchestrator.evaluate(indicators, patterns, regime, priceHistory, extras);
 *   // result = { action, direction, confidence, winnerStrategy, exitContract, sizingMultiplier, ... }
 * 
 * WIRING INTO run-empire-v2.js:
 *   Replace the tradingBrain.getDecision() call in analyzeAndTrade() with:
 *     const orchResult = this.strategyOrchestrator.evaluate(indicators, patterns, regime, priceHistory, extras);
 *   Then use orchResult.direction, orchResult.confidence, orchResult.exitContract, orchResult.sizingMultiplier
 * 
 * @module core/StrategyOrchestrator
 */

'use strict';

const { getInstance: getExitContractManager } = require('./ExitContractManager');
const MAExtensionFilter = require('./MAExtensionFilter');
const TradingConfig = require('./TradingConfig');
const OpeningRangeBreakout = require('../modules/OpeningRangeBreakout');

class StrategyOrchestrator {
  constructor(config = {}) {
    // Minimum confidence a single strategy needs to fire a trade
    // This is PER-STRATEGY, not aggregate — much more meaningful
    // TUNE 2026-02-27: Raised from 0.25 to filter garbage signals
    this.minStrategyConfidence = TradingConfig.get('confidence.minStrategyConfidence') ?? 0.01;

    // Minimum confluence signals to allow entry (default: 1 = winner alone is enough)
    this.minConfluenceCount = config.minConfluenceCount ?? 1;

    // Position sizing multipliers based on how many strategies agree
    this.confluenceSizing = config.confluenceSizing ?? {
      1: 1.0,   // Single strategy — base size
      2: 1.5,   // Two agree — 1.5x
      3: 2.0,   // Three agree — 2x
      4: 2.5,   // Four+ agree — 2.5x (cap)
    };

    // Strategy definitions — each has an evaluate function
    // These are pluggable: add/remove strategies by editing this array
    this.strategies = [];

    // Opening Range Breakout stateful strategy instance
    // MUST be initialized BEFORE _registerBuiltinStrategies() so closure captures it
    this.orbStrategy = new OpeningRangeBreakout();

    // MA Extension Filter for trend confirmation + first-touch skip
    this.maExtensionFilter = new MAExtensionFilter();

    // Register built-in strategies
    this._registerBuiltinStrategies();

    // Stats tracking
    this.lastEvaluation = null;
    this.evalCount = 0;
  }

  /**
   * Register the built-in strategies that map to existing modules.
   * Each strategy has:
   *   - name: identifier (matches ExitContractManager DEFAULT_CONTRACTS keys)
   *   - evaluate(ctx): returns { direction, confidence, reason } or null
   */
  _registerBuiltinStrategies() {

    // ─── 1. EMA/SMA Crossover Strategy ───
    this.strategies.push({
      name: 'EMASMACrossover',
      evaluate: (ctx) => {
        const sig = ctx.extras?.emaCrossoverSignal;
        if (!sig || sig.direction === 'neutral' || !sig.direction) return null;
        let conf = sig.confidence || 0;
        if (conf < 0.05) return null;

        // Fib level boost: if price is bouncing at a fib level, this is a stronger setup
        const fib = ctx.extras?.nearestFibLevel;
        let fibBoost = '';
        if (fib && fib.distance < 0.5) {
          // Price is within 0.5% of a fib level — boost confidence
          const boost = fib.isGoldenZone ? 0.15 : 0.10;
          conf = Math.min(1.0, conf + boost);
          fibBoost = ` + Fib ${(fib.level * 100).toFixed(1)}% (${fib.isGoldenZone ? 'GOLDEN ZONE' : 'near level'})`;
        }

        return {
          direction: sig.direction,
          confidence: conf,
          reason: `EMA/SMA Crossover ${sig.direction} (${sig.crossovers?.length || 0} crosses)${fibBoost}`,
          signalData: sig
        };
      }
    });

    // ─── 2. MA Dynamic S/R Strategy ───
    // NOTE: 'this' context is bound via arrow function in evaluate wrapper below
    const orchestrator = this;
    this.strategies.push({
      name: 'MADynamicSR',
      evaluate: (ctx) => {
        const sig = ctx.extras?.maDynamicSRSignal;
        if (!sig || sig.direction === 'neutral' || !sig.direction) return null;
        let conf = sig.confidence || 0;
        if (conf < 0.05) return null;

        // ─── MAExtensionFilter Gate ───
        // DISABLED 2026-03-09: MADynamicSR now handles extension detection internally
        // (slope detection, extension skip, first-touch skip per Trader DNA rewrite)
        // Having two extension filters stacked was killing 362 out of 383 signals.
        const price = ctx.extras?.price || (ctx.priceHistory?.length > 0 ? ctx.priceHistory[ctx.priceHistory.length - 1]?.c : null);

        // Fib level boost: bounce at MA + fib level = very strong S/R
        const fib = ctx.extras?.nearestFibLevel;
        let fibBoost = '';
        if (fib && fib.distance < 0.5) {
          const boost = fib.isGoldenZone ? 0.15 : 0.10;
          conf = Math.min(1.0, conf + boost);
          fibBoost = ` + Fib ${(fib.level * 100).toFixed(1)}%${fib.isGoldenZone ? ' GOLDEN' : ''}`;
        }

        // FIX 2026-02-23: Extract stops from sig.levels (nested) OR sig directly
        const sl = sig.levels?.stopLoss || sig.stopLoss;
        const tp = sig.levels?.takeProfit || sig.takeProfit;

        return {
          direction: sig.direction,
          confidence: conf,
          reason: `MA Dynamic S/R ${sig.direction} (${(sig.events || []).map(e => e.event || e).join(', ') || 'level touch'})${fibBoost}`,
          signalData: sig,
          // FIX 2026-02-23: Pass structural stops to exit contract (check sig.levels too)
          overrideLevels: sl && tp ? {
            stopLoss: sl,
            takeProfit: tp
          } : null
        };
      }
    });

    // ─── 3. Liquidity Sweep Strategy ───
    this.strategies.push({
      name: 'LiquiditySweep',
      evaluate: (ctx) => {
        const sig = ctx.extras?.liquiditySweepSignal;
        if (!sig || !sig.hasSignal) return null;
        if (!sig.direction || sig.direction === 'neutral') return null;
        let conf = sig.confidence || 0;
        if (conf < 0.05) return null;

        // Fib level boost: sweep reversal at a fib level = institutional level
        const fib = ctx.extras?.nearestFibLevel;
        let fibBoost = '';
        if (fib && fib.distance < 0.8) {
          const boost = fib.isGoldenZone ? 0.12 : 0.08;
          conf = Math.min(1.0, conf + boost);
          fibBoost = ` @ Fib ${(fib.level * 100).toFixed(1)}%${fib.isGoldenZone ? ' GOLDEN' : ''}`;
        }

        return {
          direction: sig.direction,
          confidence: conf,
          reason: `Liquidity Sweep ${sig.direction} (${sig.sweepType || 'institutional'})${fibBoost}`,
          signalData: sig,
          // FIX 2026-02-23: Pass structural stops from sweep analysis
          overrideLevels: sig.stopLoss && sig.takeProfit ? {
            stopLoss: sig.stopLoss,
            takeProfit: sig.takeProfit
          } : null
        };
      }
    });

    // ─── 4. Break & Retest Strategy (Desi Trades) ───
    // DISABLED 2026-02-23: 0 for 9 in backtest, dragging down P&L. Isolating MADynamicSR.
    this.strategies.push({
      name: 'BreakRetest',
      evaluate: (ctx) => {
        return null; // DISABLED - re-enable after tuning
      }
    });

    // ─── 5. RSI Extreme Strategy ───
    // FIX 2026-03-06: Read thresholds from TradingConfig per STRATEGY-REWRITE-SPEC
    this.strategies.push({
      name: 'RSI',  // RSI Extreme strategy
      evaluate: (ctx) => {
        const rsi = ctx.indicators?.rsi;
        if (rsi == null) return null;

        const rsiConfig = TradingConfig.get('strategies.RSI') || {};
        const oversold = rsiConfig.oversoldLevel || 25;
        const overbought = rsiConfig.overboughtLevel || 75;

        // Only fire on extremes — not the gradient nonsense
        // FIX 2026-03-13: Boost confidence so RSI=25 passes 50% gate
        // OLD: 0.3 + (strength * 0.5) gave 0.30 at threshold — too weak
        // NEW: 0.5 + (strength * 0.4) gives 0.50 at threshold, 0.90 at extreme
        if (rsi < oversold) {
          const strength = Math.min(1.0, (oversold - rsi) / 15); // Stronger as RSI drops
          return {
            direction: 'buy',
            confidence: 0.5 + (strength * 0.4), // 0.50 - 0.90
            reason: `RSI Oversold (${rsi.toFixed(1)} < ${oversold})`,
            signalData: { rsi }
          };
        }
        if (rsi > overbought) {
          const strength = Math.min(1.0, (rsi - overbought) / 15);
          return {
            direction: 'sell',
            confidence: 0.5 + (strength * 0.4), // 0.50 - 0.90
            reason: `RSI Overbought (${rsi.toFixed(1)} > ${overbought})`,
            signalData: { rsi }
          };
        }
        return null;
      }
    });

    // ─── 5. Pattern Recognition Strategy ───
    this.strategies.push({
      name: 'CandlePattern',
      evaluate: (ctx) => {
        const patterns = ctx.patterns || [];
        if (patterns.length === 0) return null;

        // Use the highest-confidence pattern
        const best = patterns.reduce((a, b) =>
          (b.confidence || 0) > (a.confidence || 0) ? b : a, patterns[0]);

        if (!best || !best.direction || best.direction === 'neutral') return null;
        const conf = best.confidence || 0;
        if (conf < 0.1) return null;

        return {
          direction: best.direction === 'bullish' ? 'buy' : best.direction === 'bearish' ? 'sell' : best.direction,
          confidence: conf,
          reason: `Pattern: ${best.name || best.type || 'detected'} (${(conf * 100).toFixed(0)}%)`,
          signalData: best
        };
      }
    });

    // ─── 6. Market Regime + Trend Strategy ───
    this.strategies.push({
      name: 'MarketRegime',
      evaluate: (ctx) => {
        const regime = ctx.regime;
        const trend = ctx.indicators?.trend;
        if (!regime || !regime.currentRegime || regime.currentRegime === 'unknown') return null;

        const regimeConf = regime.confidence || 0;
        if (regimeConf < 0.3) return null;

        // Only fire on strong trending regimes with trend confirmation
        const regimeName = regime.currentRegime.toLowerCase();
        const isBullRegime = regimeName.includes('bull') || regimeName.includes('uptrend') || regimeName.includes('accumulation');
        const isBearRegime = regimeName.includes('bear') || regimeName.includes('downtrend') || regimeName.includes('distribution');

        const isBullTrend = trend === 'bullish' || trend === 'uptrend';
        const isBearTrend = trend === 'bearish' || trend === 'downtrend';

        // Need BOTH regime AND trend to agree
        if (isBullRegime && isBullTrend) {
          return {
            direction: 'buy',
            confidence: regimeConf * 0.8, // Discount slightly — regime is slow
            reason: `Regime: ${regime.currentRegime} + Trend: ${trend}`,
            signalData: regime
          };
        }
        if (isBearRegime && isBearTrend) {
          return {
            direction: 'sell',
            confidence: regimeConf * 0.8,
            reason: `Regime: ${regime.currentRegime} + Trend: ${trend}`,
            signalData: regime
          };
        }
        return null;
      }
    });

    // ─── 7. Multi-Timeframe Confluence Strategy ───
    this.strategies.push({
      name: 'MultiTimeframe',
      evaluate: (ctx) => {
        const mtf = ctx.extras?.mtfAdapter;
        if (!mtf || typeof mtf.getConfluence !== 'function') return null;

        let confluence;
        try {
          confluence = mtf.getConfluence();
        } catch (e) {
          return null;
        }

        if (!confluence || !confluence.direction || confluence.direction === 'neutral') return null;
        if ((confluence.score || 0) < 0.3) return null;

        return {
          direction: confluence.direction,
          confidence: confluence.score || 0,
          reason: `MTF Confluence: ${confluence.direction} (${confluence.timeframes?.join(', ') || 'multiple'})`,
          signalData: confluence
        };
      }
    });

    // ─── 8. OGZ TPO Strategy ───
    this.strategies.push({
      name: 'OGZTPO',  // OGZ TPO strategy
      evaluate: (ctx) => {
        const tpo = ctx.extras?.tpoResult;
        if (!tpo || !tpo.signal) return null;
        if (!tpo.signal.highProbability) return null; // Only fire on high probability

        const action = tpo.signal.action;
        const strength = tpo.signal.strength || 0;
        if (strength < 0.03) return null;

        const direction = action === 'BUY' ? 'buy' : action === 'SELL' ? 'sell' : null;
        if (!direction) return null;

        return {
          direction,
          confidence: Math.min(1.0, strength * 10), // Scale 0.03-0.1 → 0.3-1.0
          reason: `OGZ TPO ${tpo.signal.zone} (strength: ${(strength * 100).toFixed(1)}%)`,
          signalData: tpo.signal,
          // TPO provides its own levels
          overrideLevels: tpo.signal.levels ? {
            stopLoss: tpo.signal.levels.stopLoss,
            takeProfit: tpo.signal.levels.takeProfit,
          } : null
        };
      }
    });

    // ─── 9. Opening Range Breakout Strategy ───
    // ICT-style session-based strategy with FVG entry
    const orbInstance = this.orbStrategy;
    this.strategies.push({
      name: 'OpeningRangeBreakout',
      evaluate: (ctx) => {
        // ORB needs the latest candle from priceHistory
        const candles = ctx.priceHistory;
        if (!candles || candles.length === 0) return null;

        const latestCandle = candles[candles.length - 1];
        const signal = orbInstance.update(latestCandle);

        if (!signal) return null;

        // Consume the signal so it doesn't fire again
        orbInstance.consumeSignal();

        return {
          direction: signal.direction,
          confidence: signal.confidence,
          reason: signal.reason,
          signalData: signal,
          // ORB provides structural levels from FVG
          overrideLevels: {
            stopLoss: signal.stop,
            takeProfit: signal.target,
          },
          // Pass order type hint
          orderTypeHint: signal.orderType,
          limitPrice: signal.limitPrice,
        };
      }
    });

    // Apply pipeline toggles - filter strategies based on env vars
    this._applyPipelineToggles();
  }

  /**
   * Filter registered strategies based on pipeline toggles.
   * Called once at end of _registerBuiltinStrategies().
   * Logs exactly which strategies are active/disabled - no silent failures.
   */
  _applyPipelineToggles() {
    const pipeline = TradingConfig.get('pipeline') || {};
    const toggleMap = {
      'RSI': pipeline.enableRSI,
      'MADynamicSR': pipeline.enableMADynamicSR,
      'EMASMACrossover': pipeline.enableEMACrossover,
      'LiquiditySweep': pipeline.enableLiquiditySweep,
      'BreakRetest': pipeline.enableBreakRetest,
      'MarketRegime': pipeline.enableMarketRegime,
      'MultiTimeframe': pipeline.enableMultiTimeframe,
      'OGZTPO': pipeline.enableOGZTPO,
      'OpeningRangeBreakout': pipeline.enableOpeningRangeBreakout,
    };

    const before = this.strategies.length;
    const disabled = [];

    this.strategies = this.strategies.filter(s => {
      const toggle = toggleMap[s.name];
      if (toggle === false) {
        disabled.push(s.name);
        return false;
      }
      return true;
    });

    if (disabled.length > 0) {
      console.log(`[PIPELINE] Disabled ${disabled.length} strategies: ${disabled.join(', ')}`);
    }
    console.log(`[PIPELINE] Active strategies: ${this.strategies.map(s => s.name).join(', ')} (${this.strategies.length}/${before})`);
  }

  /**
   * Main entry point — evaluate all strategies independently, pick winner.
   * 
   * @param {Object} indicators - From IndicatorEngine.getSnapshot()
   * @param {Array} patterns - From EnhancedPatternRecognition.analyzePatterns()
   * @param {Object} regime - From MarketRegimeDetector.analyzeMarket()
   * @param {Array} priceHistory - Candle history
   * @param {Object} extras - { emaCrossoverSignal, maDynamicSRSignal, liquiditySweepSignal, mtfAdapter, tpoResult, price }
   * @returns {Object} { action, direction, confidence, winnerStrategy, exitContract, sizingMultiplier, confluence, allResults }
   */
  evaluate(indicators, patterns = [], regime = null, priceHistory = [], extras = {}) {
    this.evalCount++;

    const ctx = { indicators, patterns, regime, priceHistory, extras };

    // ═══════════════════════════════════════════════════════════════════════
    // CHANGE 2026-02-23: Volume Profile Chop Filter (Fabio Valentino)
    // Only trend follow when OUT OF BALANCE (price outside value area)
    // When BALANCED (inside VA) = choppy market, trend strategies bleed fees
    // ═══════════════════════════════════════════════════════════════════════
    // DISABLED 2026-03-09: VP chop filter was one of 6 stacked gates killing signals
    // MADynamicSR now has its own slope/extension filters. VP chop filter is redundant.
    // TODO: Full gate audit needed — one filter, one job, no overlap.
    // const TREND_STRATEGIES = ['MADynamicSR', 'EMASMACrossover', 'MultiTimeframe', 'MarketRegime'];
    let vpMarketState = null;
    let skipTrendStrategies = false;  // Always false now — strategies handle their own filtering

    // ─── Step 1: Run ALL strategies independently ───
    const results = [];
    for (const strategy of this.strategies) {
      // DISABLED 2026-03-09: VP chop filter removed — strategies handle own filtering
      // if (skipTrendStrategies && TREND_STRATEGIES.includes(strategy.name)) {
      //   continue;
      // }

      try {
        const result = strategy.evaluate(ctx);
        if (result && result.direction && result.confidence > 0) {
          results.push({
            ...result,
            strategyName: strategy.name,
          });
        }
      } catch (err) {
        console.warn(`⚠️ [StrategyOrchestrator] ${strategy.name} threw: ${err.message}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ATR PRE-ENTRY FILTER — Data-driven threshold from backtest analysis
    // FIX 2026-03-13: 0.40% killed 74% of 15m BTC candles. Lowered to 0.15%
    // Original: Winners at 0.58%, losers at 0.34%, midpoint 0.40%
    // ═══════════════════════════════════════════════════════════════════════
    const filterPrice = extras.price || (priceHistory.length > 0 ? priceHistory[priceHistory.length - 1]?.c : 0);
    const filterATR = indicators?.atr || 0;
    const filterATRpct = (filterATR && filterPrice > 0) ? (filterATR / filterPrice) * 100 : 0;

    // ATR filter: Skip trades in dead markets (controlled by env var for parallel backtester)
    const atrFilterEnabled = process.env.ATR_FILTER_ENABLED === 'true';
    const atrMinPercent = parseFloat(process.env.ATR_MIN_PERCENT) || 0.15;
    if (atrFilterEnabled && filterATRpct > 0 && filterATRpct < atrMinPercent && results.length > 0) {
      for (const r of results) {
        if (this.evalCount % 200 === 0) {
          console.log(`[FILTER:atr] Skipped ${r.strategyName} — ATR ${filterATRpct.toFixed(3)}% below minimum ${atrMinPercent}%`);
        }
      }
      results.length = 0; // Kill all signals — market is too dead
    }

    // ─── Step 2: Sort by confidence (highest first) ───
    results.sort((a, b) => b.confidence - a.confidence);

    // DEBUG 2026-03-06: Why is confidence 0?
    if (results.length > 0) {
      console.log(`🔍 [ORCH] ${results.length} strategies returned signals:`);
      results.slice(0, 5).forEach(r => console.log(`   - ${r.strategyName}: ${(r.confidence * 100).toFixed(1)}% ${r.direction}`));
    } else {
      console.log(`🔍 [ORCH] 0 strategies returned signals (all returned null or conf=0)`);
    }

    // ─── Step 3: Filter by minimum confidence threshold ───
    const qualified = results.filter(r => r.confidence >= this.minStrategyConfidence);

    if (qualified.length === 0) {
      this.lastEvaluation = { action: 'HOLD', results, qualified: [] };
      return {
        action: 'HOLD',
        direction: 'hold',
        confidence: 0,
        winnerStrategy: null,
        exitContract: null,
        sizingMultiplier: 1.0,
        confluence: { count: 0, strategies: [] },
        allResults: results,
        reasons: results.length > 0
          ? [`No strategy above ${(this.minStrategyConfidence * 100).toFixed(0)}% threshold (best: ${results[0]?.strategyName} at ${(results[0]?.confidence * 100).toFixed(0)}%)`]
          : ['No signals detected']
      };
    }

    // ─── Step 4: Winner = highest confidence ───
    const winner = qualified[0];

    // ─── Step 5: Count confluence (how many strategies agree on direction) ───
    const agreeing = qualified.filter(r => r.direction === winner.direction);
    const confluenceCount = agreeing.length;

    // Check minimum confluence requirement
    if (confluenceCount < this.minConfluenceCount) {
      this.lastEvaluation = { action: 'HOLD', results, qualified, winner, confluenceCount };
      return {
        action: 'HOLD',
        direction: 'hold',
        confidence: winner.confidence * 100,  // FIX 2026-02-26: Match BUY/SELL format (0-100)
        winnerStrategy: winner.strategyName,
        exitContract: null,
        sizingMultiplier: 1.0,
        confluence: { count: confluenceCount, strategies: agreeing.map(r => r.strategyName) },
        allResults: results,
        reasons: [`Need ${this.minConfluenceCount} confluent signals, got ${confluenceCount}`]
      };
    }

    // ─── Step 6: Position sizing multiplier from confluence ───
    const cappedCount = Math.min(confluenceCount, 4);
    const sizingMultiplier = this.confluenceSizing[cappedCount] || this.confluenceSizing[4] || 2.5;

    // ─── Step 7: Create exit contract from winning strategy ───
    let exitContract = null;
    try {
      const ecm = getExitContractManager();
      const price = extras.price || (priceHistory.length > 0 ? priceHistory[priceHistory.length - 1]?.c : 0);

      // If the winning strategy provided its own levels (e.g. TPO), use them
      const signalOverrides = {};
      if (winner.overrideLevels) {
        if (winner.overrideLevels.stopLoss && price) {
          signalOverrides.stopLossPercent = ((winner.overrideLevels.stopLoss - price) / price) * 100;
        }
        if (winner.overrideLevels.takeProfit && price) {
          signalOverrides.takeProfitPercent = ((winner.overrideLevels.takeProfit - price) / price) * 100;
        }
      }

      // FIX 2026-02-23: Convert ATR to percentage (was passing raw $ causing inflation)
      const volPct = indicators?.atr && price ? (indicators.atr / price * 100) : (indicators?.volatility || 0);
      exitContract = ecm.createExitContract(
        winner.strategyName,
        { ...signalOverrides, confidence: winner.confidence },
        { volatility: volPct }
      );
    } catch (err) {
      console.warn(`⚠️ [StrategyOrchestrator] Failed to create exit contract: ${err.message}`);
    }

    // ─── Step 8: Build reasons list ───
    const reasons = [
      `🏆 Winner: ${winner.strategyName} (${(winner.confidence * 100).toFixed(0)}%) — ${winner.reason}`,
      `🤝 Confluence: ${confluenceCount} strategies agree on ${winner.direction.toUpperCase()}`,
      `📏 Sizing: ${sizingMultiplier}x base position`,
    ];

    // Add supporting strategies
    agreeing.slice(1).forEach(r => {
      reasons.push(`  ✅ ${r.strategyName}: ${r.reason}`);
    });

    // Log opposing strategies (info only)
    const opposing = qualified.filter(r => r.direction !== winner.direction);
    opposing.forEach(r => {
      reasons.push(`  ⚠️ Opposing: ${r.strategyName} says ${r.direction} (${(r.confidence * 100).toFixed(0)}%)`);
    });

    const output = {
      action: winner.direction === 'buy' ? 'BUY' : winner.direction === 'sell' ? 'SELL' : 'HOLD',
      direction: winner.direction,
      confidence: winner.confidence * 100, // Convert to percentage for compatibility with existing code
      winnerStrategy: winner.strategyName,
      exitContract,
      sizingMultiplier,
      confluence: {
        count: confluenceCount,
        strategies: agreeing.map(r => r.strategyName),
        opposing: opposing.map(r => ({ name: r.strategyName, direction: r.direction, confidence: r.confidence })),
      },
      allResults: results,
      reasons,
      // Signal breakdown for trade logging (compatible with existing signalBreakdown format)
      signalBreakdown: {
        winnerStrategy: winner.strategyName,
        winnerConfidence: winner.confidence,
        confluenceCount,
        sizingMultiplier,
        signals: results.map(r => ({
          name: r.strategyName,
          direction: r.direction,
          confidence: r.confidence,
          reason: r.reason,
        })),
      },
    };

    this.lastEvaluation = output;

    // Log decision
    console.log(`\n🎯 [ORCHESTRATOR] ${output.action} | ${winner.strategyName} @ ${(winner.confidence * 100).toFixed(0)}% | Confluence: ${confluenceCount}x (sizing: ${sizingMultiplier}x)`);
    if (agreeing.length > 1) {
      console.log(`   Supporting: ${agreeing.slice(1).map(r => r.strategyName).join(', ')}`);
    }

    return output;
  }

  /**
   * Get last evaluation for debugging / dashboard
   */
  getLastEvaluation() {
    return this.lastEvaluation;
  }

  /**
   * Register a custom strategy at runtime
   * @param {Object} strategy - { name: string, evaluate: function(ctx) }
   */
  registerStrategy(strategy) {
    if (!strategy.name || typeof strategy.evaluate !== 'function') {
      throw new Error('Strategy must have name and evaluate function');
    }
    this.strategies.push(strategy);
    console.log(`📌 [StrategyOrchestrator] Registered strategy: ${strategy.name}`);
  }

  /**
   * Remove a strategy by name
   */
  removeStrategy(name) {
    this.strategies = this.strategies.filter(s => s.name !== name);
    console.log(`🗑️ [StrategyOrchestrator] Removed strategy: ${name}`);
  }

  /**
   * Get stats for monitoring
   */
  getStats() {
    return {
      registeredStrategies: this.strategies.map(s => s.name),
      evaluationCount: this.evalCount,
      lastResult: this.lastEvaluation ? {
        action: this.lastEvaluation.action,
        winner: this.lastEvaluation.winnerStrategy,
        confluence: this.lastEvaluation.confluence?.count || 0,
      } : null,
    };
  }
}

module.exports = { StrategyOrchestrator };
