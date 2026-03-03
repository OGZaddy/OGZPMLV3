/**
 * EntryDecider - Trade Decision Orchestrator
 *
 * SINGLE RESPONSIBILITY: Orchestrate trade decisions (entry AND exit)
 * by combining signal analysis with gate validation.
 *
 * Extracted from run-empire-v2.js as part of Phase 9 modular refactor.
 * Phase 12: Merged makeTradeDecision into this module.
 *
 * KEY FIX: EntryGateChecker MUST be called BEFORE returning enter=true.
 * Previously gates ran after execution - this fixes that critical bug.
 *
 * @module core/EntryDecider
 */

'use strict';

const EntryGateChecker = require('./EntryGateChecker');
const FeatureFlagManager = require('./FeatureFlagManager');
const { getInstance: getStateManager } = require('./StateManager');
const { getInstance: getExitContractManager } = require('./ExitContractManager');
const TradingConfig = require('./TradingConfig');

// Get singleton instances
const flagManager = FeatureFlagManager.getInstance();
const stateManager = getStateManager();
const exitContractManager = getExitContractManager();

/**
 * Get display label for direction based on asset type
 * Copied EXACTLY from run-empire-v2.js line 334
 */
function getDirectionDisplayLabel(direction, assetType = 'crypto') {
  const isSell = direction === 'sell' || direction === 'SELL';

  // For spot crypto, use BUY/SELL (honest about what's actually happening)
  if (assetType === 'crypto') {
    return isSell ? 'SELL' : 'BUY';
  }

  // For futures/options/margin, use LONG/SHORT (actual directional positions)
  return isSell ? 'SHORT' : 'LONG';
}

class EntryDecider {
  constructor(dependencies = {}) {
    this.gateChecker = new EntryGateChecker(dependencies);
    this.stateManager = dependencies.stateManager;

    console.log('[EntryDecider] Initialized (Phase 12 - merged makeTradeDecision)');
  }

  /**
   * Update dependencies (for late binding)
   */
  setDependencies(deps) {
    this.gateChecker.setDependencies(deps);
    if (deps.stateManager) this.stateManager = deps.stateManager;
  }

  /**
   * Decide whether to enter a trade
   * Runs gate checks BEFORE approving entry
   *
   * @param {Object} signal - { action, confidence, direction, ... }
   * @param {Object} context - { price, indicators, patterns, positionSize }
   * @returns {Object} - { enter: boolean, signal, reason, positionSize, riskLevel }
   */
  decide(signal, context = {}) {
    const { price = 0, indicators = {}, patterns = [], positionSize = 0 } = context;

    // If signal isn't a BUY, pass through (no gates needed for HOLD/SELL)
    if (!signal || signal.action !== 'BUY') {
      return {
        enter: false,
        signal,
        reason: signal?.action === 'HOLD' ? 'hold_signal' : 'not_buy_signal',
        positionSize: 0,
        riskLevel: 'N/A'
      };
    }

    // Run ALL gate checks BEFORE approving entry
    const gateResult = this.gateChecker.check({
      confidence: signal.confidence,
      price,
      indicators,
      patterns
    });

    if (!gateResult.pass) {
      console.log(`[EntryDecider] BLOCKED: ${gateResult.failedGates.join(', ')}`);
      return {
        enter: false,
        signal,
        reason: gateResult.failedGates[0] || 'gate_check_failed',
        positionSize: 0,
        riskLevel: gateResult.riskLevel,
        blockType: gateResult.blockType,
        failedGates: gateResult.failedGates
      };
    }

    // All gates passed - approve entry
    console.log(`[EntryDecider] APPROVED: All gates passed (risk: ${gateResult.riskLevel})`);
    return {
      enter: true,
      signal,
      reason: 'all_gates_passed',
      positionSize,
      riskLevel: gateResult.riskLevel
    };
  }

  /**
   * Get the underlying gate checker for direct access
   */
  getGateChecker() {
    return this.gateChecker;
  }

  /**
   * Determine if we should trade and in which direction
   * CHANGE 639: Added brainDirection parameter to respect TradingBrain's decision
   * Phase 12: Merged from run-empire-v2.js
   *
   * @param {Object} confidenceData - { totalConfidence, patternScores, ... }
   * @param {Object} indicators - Technical indicators
   * @param {Array} patterns - Detected patterns
   * @param {number} currentPrice - Current market price
   * @param {string} brainDirection - TradingBrain's direction (buy/sell/hold)
   * @param {Object} bot - Bot instance for accessing dependencies
   * @returns {Object} - { action, direction, confidence, ... }
   */
  makeTradeDecision(confidenceData, indicators, patterns, currentPrice, brainDirection = null, bot) {
    const { totalConfidence } = confidenceData;
    let minConfidence = bot.config.minTradeConfidence * 100;

    // FIX 2026-02-02: AGGRESSIVE_LEARNING_MODE lowers threshold for faster learning
    if (flagManager.isEnabled('AGGRESSIVE_LEARNING_MODE')) {
      const aggressiveThreshold = flagManager.getSetting('AGGRESSIVE_LEARNING_MODE', 'minConfidenceThreshold', 55);
      if (aggressiveThreshold < minConfidence) {
        console.log(`🔥 AGGRESSIVE LEARNING: Confidence threshold ${minConfidence}% → ${aggressiveThreshold}%`);
        minConfidence = aggressiveThreshold;
      }
    }

    // CHANGE 2025-12-11: Pass 1 - Add decision context for visibility
    // CHANGE 2026-01-29: Use correct display labels based on market type
    const assetType = bot.kraken?.getAssetType?.() || 'crypto';
    const decisionContext = bot.tradingOptimizations.createDecisionContext({
      symbol: bot.tradingPair || 'XBT/USD',
      direction: getDirectionDisplayLabel(brainDirection, assetType),
      confidence: totalConfidence,
      patterns: patterns || [],
      patternScores: confidenceData.patternScores || {},
      indicators,
      regime: bot.marketRegime?.currentRegime || 'unknown',
      module: bot.gridStrategy ? 'grid' : 'standard',
      price: currentPrice,
      brainDirection
    });

    // CHANGE 670: Check grid strategy first if enabled
    if (bot.gridStrategy) {
      const gridSignal = bot.gridStrategy.getGridSignal(currentPrice, indicators);

      if (gridSignal.action !== 'HOLD') {
        console.log(`\n🎯 GRID BOT SIGNAL: ${gridSignal.action} | ${gridSignal.reason}`);
        console.log(`   Grid Stats: ${gridSignal.gridStats.completedTrades} trades | $${gridSignal.gridStats.totalProfit.toFixed(2)} profit`);

        // Grid signals override normal trading logic
        return {
          action: gridSignal.action,
          direction: gridSignal.action === 'BUY' ? 'long' : 'close',
          confidence: gridSignal.confidence * 100,
          isGridTrade: true,
          gridSize: gridSignal.size
        };
      }
    }

    const pos = stateManager.get('position');

    // PHASE 9: Desync guard + drawdown block moved to EntryGateChecker
    // Now checked in executeTrade() BEFORE order execution (was checking AFTER - bug!)
    // See: core/EntryGateChecker.js

    // CHANGE 2025-12-13: Step 5 - MaxProfitManager gets priority on exits
    // Math (stops/targets) ALWAYS wins over Brain (emotional) signals

    // Check if we should BUY (when flat) - Brain direction MUST agree
    // FIX 2026-02-05: Was buying on bearish/hold signals (~50% of positions opened wrong direction)
    if (pos === 0 && totalConfidence >= minConfidence && brainDirection === 'buy') {
      console.log(`✅ BUY DECISION: Confidence ${totalConfidence.toFixed(1)}% >= ${minConfidence}% | Brain: ${brainDirection} - ALIGNED TRADE!`);

        // CHANGE 2025-12-11: Pass 2 - Include decision context and pattern quality
        return {
          action: 'BUY',
          direction: 'long',
          confidence: totalConfidence,
          decisionContext,
          patternQuality: decisionContext.patternQuality
        };
    }

    // Check if we should SELL (when long)
    // Change 603: Integrate MaxProfitManager for dynamic exits
    if (pos > 0) {
      // Get entry trade to calculate P&L
      // CHANGE 2025-12-13: Read from StateManager (single source of truth)
      const allTrades = stateManager.getAllTrades();
      const buyTrades = allTrades
        .filter(t => t.action === 'BUY')
        .sort((a, b) => a.entryTime - b.entryTime);

      if (buyTrades.length > 0) {
        const entryPrice = buyTrades[0].entryPrice;
        const activeTrade = buyTrades[0];

        // =====================================================================
        // FIX 2026-02-17: CHECK EXIT CONTRACT FIRST
        // Strategy-owned exits: each trade has its own SL/TP/invalidation frozen at entry
        // This prevents premature exits from unrelated strategy confidence drops
        // =====================================================================
        if (activeTrade.exitContract) {
          // Update max profit for trailing stop calculation
          exitContractManager.updateMaxProfit(activeTrade, currentPrice);

          // Check exit conditions from the trade's own contract
          const exitCheck = exitContractManager.checkExitConditions(activeTrade, currentPrice, {
            indicators: indicators,
            currentTime: bot.marketData?.timestamp || Date.now(),
            accountBalance: stateManager.get('balance'),
            initialBalance: stateManager.get('initialBalance') || 10000
          });

          if (exitCheck.shouldExit) {
            console.log(`[EXIT-CONTRACT] ${exitCheck.details}`);
            return {
              action: 'SELL',
              direction: 'close',
              confidence: exitCheck.confidence || 100,
              exitReason: exitCheck.exitReason,
              decisionContext: {
                source: 'ExitContract',
                strategy: activeTrade.entryStrategy,
                ...decisionContext
              }
            };
          }

          // If exitContract exists but doesn't say exit, DON'T let aggregate confidence trigger exit
          // Only universal circuit breakers and exitContract conditions can close this trade
          // This is the key fix: brain aggregate direction is ignored for exit decisions
        }

        // =====================================================================
        // CHANGE 2026-02-02: TradeIntelligenceEngine - Intelligent Exit Decisions
        // Evaluates each trade on 13 dimensions instead of blanket rules
        // =====================================================================
        if (bot.tradeIntelligence) {
          const intelligenceContext = {
            // Pattern bank data
            patternBank: bot.tradingBrain?.patternMemory,
            // Trade history for similar trade analysis
            tradeHistory: stateManager.getAllTrades().filter(t => t.pnl !== undefined),
            // Current confidence from the bot
            currentConfidence: totalConfidence / 100,
            // TRAI analysis if available
            traiAnalysis: bot.lastTraiDecision || null,
            // Risk context
            currentDrawdown: stateManager.get('maxDrawdown') || 0,
            consecutiveLosses: stateManager.get('consecutiveLosses') || 0,
            dailyPnL: stateManager.get('dailyPnL') || 0,
            // Sentiment (if available)
            fearGreedIndex: bot.marketData?.fearGreed,
            // Whale activity (placeholder - can be connected to exchange data)
            whaleActivity: bot.marketData?.whaleActivity || null
          };

          const marketDataForIntelligence = {
            price: currentPrice,
            volume: bot.marketData?.volume,
            avgVolume: bot.marketData?.avgVolume,
            high24h: bot.marketData?.high24h,
            low24h: bot.marketData?.low24h,
            priceChange: bot.marketData?.priceChange,
            currentCandle: bot.priceHistory?.[bot.priceHistory.length - 1]
          };

          const indicatorsForIntelligence = {
            rsi: indicators.rsi,
            macd: indicators.macd,
            ema9: indicators.ema9 || indicators.ema12,
            ema20: indicators.ema20 || indicators.ema26,
            ema50: indicators.ema50,
            sma200: indicators.sma200,
            atr: indicators.atr,
            avgAtr: indicators.avgAtr,
            trend: indicators.trend,
            adx: indicators.adx,
            volume: bot.marketData?.volume,
            avgVolume: bot.marketData?.avgVolume
          };

          const intelligenceResult = bot.tradeIntelligence.evaluate(
            activeTrade,
            marketDataForIntelligence,
            indicatorsForIntelligence,
            intelligenceContext
          );

          // Log or act on intelligence result
          if (bot.tradeIntelligenceShadowMode) {
            // Shadow mode - just log what would happen
            if (intelligenceResult.action !== 'HOLD_CAUTIOUS' && intelligenceResult.action !== 'HOLD_STRONG') {
              console.log(`🧠 [INTELLIGENCE-SHADOW] Would recommend: ${intelligenceResult.action}`);
              console.log(`   Confidence: ${(intelligenceResult.confidence * 100).toFixed(0)}%`);
              console.log(`   Reasoning: ${intelligenceResult.reasoning.slice(0, 3).join(' | ')}`);
              console.log(`   Score breakdown: regime=${intelligenceResult.scores.regime?.score || 0}, momentum=${intelligenceResult.scores.momentum?.score || 0}, ema=${intelligenceResult.scores.ema?.score || 0}`);
            }
          } else if (bot.activeExitSystem === 'intelligence' || bot.activeExitSystem === 'legacy') {
            // ACTIVE MODE - actually use the intelligence
            if (intelligenceResult.action === 'EXIT_LOSS' && intelligenceResult.confidence > 0.7) {
              console.log(`🧠 [INTELLIGENCE] EXIT_LOSS: ${intelligenceResult.reasoning.join(' | ')}`);
              return { action: 'SELL', direction: 'close', confidence: totalConfidence, source: 'TradeIntelligence' };
            }
            if (intelligenceResult.action === 'EXIT_PROFIT' && intelligenceResult.confidence > 0.7) {
              console.log(`🧠 [INTELLIGENCE] EXIT_PROFIT: ${intelligenceResult.reasoning.join(' | ')}`);
              return { action: 'SELL', direction: 'close', confidence: totalConfidence, source: 'TradeIntelligence' };
            }
            if (intelligenceResult.action === 'TRAIL_TIGHT') {
              console.log(`🧠 [INTELLIGENCE] TRAIL_TIGHT - tightening stop`);
              // Could adjust MaxProfitManager here
            }
          }
        }
        // =====================================================================

        // Change 608: Analyze Fib/S&R levels to adjust trailing stops dynamically
        // BUGFIX 2026-02-01: bot.candles doesn't exist, use bot.priceHistory
         const levelAnalysis = bot.tradingBrain.analyzeFibSRLevels(bot.priceHistory, currentPrice);

         // CHANGE 652: Check MaxProfitManager state before calling update
         // EXIT_SYSTEM flag: Only run MPM when activeExitSystem is maxprofit or legacy
         let profitResult = null;
         if (bot.activeExitSystem === 'maxprofit' || bot.activeExitSystem === 'legacy') {
           if (!bot.tradingBrain?.maxProfitManager?.state?.active) {
             console.log('⚠️ MaxProfitManager not active for position, will check other exit conditions');
           } else {
             profitResult = bot.tradingBrain.maxProfitManager.update(currentPrice, {
             volatility: indicators.volatility || 0,
             trend: indicators.trend || 'sideways',
             volume: bot.marketData?.volume || 0,
             trailMultiplier: levelAnalysis.trailMultiplier || 1.0
           });
           }
         }

         // Evaluate pattern exit model (shadow mode or active)
         // EXIT_SYSTEM flag: Only run pattern exits when activeExitSystem is pattern or legacy
         if (bot.patternExitModel && (bot.activeExitSystem === 'pattern' || bot.activeExitSystem === 'legacy')) {
           const profitPercent = (currentPrice - entryPrice) / entryPrice;
           const exitDecision = bot.patternExitModel.evaluateExit({
             currentPrice,
             currentPatterns: patterns || [],
             indicators: {
               rsi: indicators.rsi,
               macd: indicators.macd
             },
             regime: bot.marketRegime?.currentRegime || 'unknown',
             profitPercent,
             maxProfitManagerState: profitResult
           });

           if (bot.patternExitShadowMode) {
             // Shadow mode - just log what would happen
             if (exitDecision.exitRecommended) {
               console.log(`🕵️ [SHADOW] Pattern Exit would trigger:`);
               console.log(`   Action: ${exitDecision.action}`);
               console.log(`   Urgency: ${exitDecision.exitUrgency}`);
               console.log(`   Exit %: ${(exitDecision.exitPercent * 100).toFixed(0)}%`);
               console.log(`   Reasons: ${exitDecision.reasons.join(', ')}`);
             }
             if (exitDecision.adjustments &&
                 (exitDecision.adjustments.targetMultiplier !== 1.0 ||
                  exitDecision.adjustments.stopMultiplier !== 1.0 ||
                  exitDecision.adjustments.trailMultiplier !== 1.0)) {
               console.log(`🕵️ [SHADOW] Pattern adjustments would apply:`);
               console.log(`   Target: ${exitDecision.adjustments.targetMultiplier.toFixed(2)}x`);
               console.log(`   Stop: ${exitDecision.adjustments.stopMultiplier.toFixed(2)}x`);
               console.log(`   Trail: ${exitDecision.adjustments.trailMultiplier.toFixed(2)}x`);
             }
           } else if (exitDecision.exitRecommended &&
                      (exitDecision.exitUrgency === 'high' || exitDecision.exitUrgency === 'critical')) {
             // Active mode - actually trigger exit on high urgency
             console.log(`🎯 Pattern Exit ACTIVE: ${exitDecision.reasons.join(', ')}`);
             return { action: 'SELL', direction: 'close', confidence: totalConfidence * 1.2 };
           }
         }

        // Check if MaxProfitManager signals exit (only when maxprofit or legacy active)
        // FIX 2026-02-05: Added exit_partial - tiered profit exits were silently dropped
        if (profitResult && (profitResult.action === 'exit_full' || profitResult.action === 'exit_partial') && (bot.activeExitSystem === 'maxprofit' || bot.activeExitSystem === 'legacy')) {
          console.log(`📉 SELL Signal: ${profitResult.reason || 'MaxProfitManager exit'} (${profitResult.action})`);
          // FIX 2026-02-24: Add exitReason so isProfitExit check at line 2572 passes (Bug #11)
          return { action: 'SELL', direction: 'close', confidence: totalConfidence, exitSize: profitResult.exitSize, exitReason: profitResult.reason };
        }

        // CRITICAL FIX: Calculate P&L for exit decisions
        const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;
        // FIX 2026-02-05: Use candle timestamp not Date.now() (broken in backtest - all holdTimes were ~0)
        const currentTime = bot.marketData?.timestamp || Date.now();
        const holdTime = (currentTime - (buyTrades[0]?.entryTime || currentTime)) / 60000;
        const feeBuffer = 0.35; // Total fees are 0.32% round-trip

        // BUGFIX 2026-02-01: These safety exits MUST run regardless of MaxProfitManager state!
        // Previously inside if(!maxProfitManager.active) block = skipped when MPM active but broken

        // HARD STOP LOSS - ALWAYS ENFORCED
        if (pnl < -1.5) {
          console.log(`🛑 HARD STOP LOSS: Exiting at ${pnl.toFixed(2)}% loss`);
          return { action: 'SELL', direction: 'close', confidence: totalConfidence };
        }

        // DISABLED 2026-02-06: Moving to 1-hour timeframe - 30min stale timer was killing trades
        // SHIT OR GET OFF THE POT - DISABLED FOR HOURLY TRADING
        // if (holdTime > 30 && pnl < feeBuffer && pnl > -1.5) {
        //   console.log(`💩 SHIT OR GET OFF THE POT: ${holdTime.toFixed(0)} min hold, P&L: ${pnl.toFixed(2)}% - Taking the L and moving on`);
        //   return { action: 'SELL', direction: 'close', confidence: totalConfidence };
        // }

        // Legacy fallback exits (only when legacy mode AND MPM not active)
        if (bot.activeExitSystem === 'legacy' && !bot.tradingBrain?.maxProfitManager?.state?.active) {
          // Exit if profitable above fees
          if (pnl > feeBuffer) {
            console.log(`✅ EXIT: Taking profit at ${pnl.toFixed(2)}% (covers ${feeBuffer}% fees)`);
            return { action: 'SELL', direction: 'close', confidence: totalConfidence };
          }

          // Exit on brain sell signal after minimum hold - BUT ONLY IF PROFITABLE
          if (brainDirection === 'sell' && holdTime > 0.5 && pnl > feeBuffer) {
            console.log(`🧠 Brain SELL signal: Exiting after ${holdTime.toFixed(1)} min hold (P&L: ${pnl.toFixed(2)}%)`);
            return { action: 'SELL', direction: 'close', confidence: totalConfidence };
          }
        }

        // CHANGE 2025-12-13: Step 5 - Brain sell signals ONLY after MaxProfitManager
        // EXIT_SYSTEM flag: Only run brain exits when activeExitSystem is brain or legacy
        if (brainDirection === 'sell' && (bot.activeExitSystem === 'brain' || bot.activeExitSystem === 'legacy')) {
          // Get the oldest BUY trade to check hold time
          const buyTradesForBrain = stateManager.getAllTrades()
            .filter(t => t.action === 'BUY')
            .sort((a, b) => a.entryTime - b.entryTime);

          if (buyTradesForBrain.length > 0) {
            const buyTrade = buyTradesForBrain[0];

            // FIX 2026-02-17: If trade has exitContract, skip brain aggregate exit
            // Only the trade's own contract (checked earlier) can trigger exit
            if (buyTrade.exitContract) {
              console.log(`[EXIT-CONTRACT] Brain says SELL but trade has exitContract - IGNORING aggregate`);
              // Don't return SELL - let the trade ride until its own contract triggers
            } else {
              // Legacy behavior for trades without exitContract
              const holdTimeForBrain = ((bot.marketData?.timestamp || Date.now()) - buyTrade.entryTime) / 60000; // Convert to minutes
              const minHoldTime = 0.05; // 3 seconds for 5-sec candles

              // Additional conditions for Brain to override:
              // 1. Minimum hold time met
              // 2. Position is in profit (don't panic sell at loss)
              const pnlForBrain = ((currentPrice - entryPrice) / entryPrice) * 100;

              if (holdTimeForBrain >= minHoldTime && pnlForBrain > 0.35) {  // MUST COVER FEES (0.32% + buffer)
              console.log(`🧠 Brain bearish & profitable - allowing SELL (held ${holdTimeForBrain.toFixed(2)} min, PnL: ${pnlForBrain.toFixed(2)}%)`);
              return { action: 'SELL', direction: 'close', confidence: totalConfidence };
            } else if (holdTimeForBrain >= minHoldTime && pnlForBrain < -2) {
              // Emergency: Allow Brain to cut losses if down > 2%
              console.log(`🚨 Brain emergency sell - cutting losses (PnL: ${pnlForBrain.toFixed(2)}%)`);
              return { action: 'SELL', direction: 'close', confidence: totalConfidence };
            } else if (holdTimeForBrain >= 5 && pnlForBrain < 0 && pnlForBrain >= -2) {
              // CHANGE 2026-01-25: Gradual loss exit - don't bag hold small losses forever
              // After 5 minutes, exit gracefully if losing but not yet at emergency threshold
              console.log(`📉 Gradual exit - held ${holdTimeForBrain.toFixed(1)} min at ${pnlForBrain.toFixed(2)}% loss, cutting loose`);
              return { action: 'SELL', direction: 'close', confidence: totalConfidence };
            } else {
              console.log(`🧠 Brain wants sell but conditions not met (hold: ${holdTimeForBrain.toFixed(3)} min, PnL: ${pnlForBrain.toFixed(2)}%)`);
            }
            } // close else block for !exitContract
          }
        }

        // Change 604: DISABLE confidence exits - they're killing profitability
        // Confidence reversal exits were triggering BEFORE profit targets (1-2%)
        // This caused 100% of exits at 0.00-0.12% profit = NET LOSS after fees
        //
        // Let MaxProfitManager handle exits with proper profit targets
        // Only use confidence as EXTREME emergency exit (50%+ drop)

        bot.confidenceHistory = bot.confidenceHistory || [];
        bot.confidenceHistory.push(totalConfidence);
        if (bot.confidenceHistory.length > 10) bot.confidenceHistory.shift();

        const peakConfidence = Math.max(...bot.confidenceHistory.slice(-5));
        const confidenceDrop = peakConfidence - totalConfidence;

        // ONLY exit on MASSIVE confidence drops (market crash scenario)
        if (confidenceDrop > 50) {
          console.log(`📉 SELL Signal: EXTREME reversal (${confidenceDrop.toFixed(1)}% confidence drop)`);
          return { action: 'SELL', direction: 'close', confidence: totalConfidence };
        }

        // Let profitable trades ride - don't exit on minor confidence fluctuations
        // DEBUG 2026-02-17: If we get here, no exit condition matched - HOLD
        console.log(`📊 [EXIT-DEBUG] No exit condition matched. pos=${pos}, pnl=${pnl?.toFixed(3) || 'N/A'}%, conf=${totalConfidence}, brainDir=${brainDirection}`);
      }
    }

    // 🚫 CRYPTO: NO SHORTING/MARGIN - Too risky, disabled permanently
    // (Shorting only enabled for stocks/forex if needed in future)

    // HOLD means we're uncertain - should have LOW confidence, not high!
    // High confidence should only be for BUY/SELL signals
    // CHANGE 2026-01-29: Include decisionContext for chain of thought updates
    return { action: 'HOLD', confidence: Math.min(0.2, totalConfidence * 0.1), decisionContext };
  }
}

module.exports = EntryDecider;
