/**
 * TradingLoop - Phase 15 Extraction
 *
 * EXACT COPY of analyzeAndTrade() from run-empire-v2.js
 * NO logic changes. Just moved to separate file.
 *
 * Dependencies passed via context object in constructor.
 *
 * @module core/TradingLoop
 */

'use strict';

const { getInstance: getStateManager } = require('./StateManager');
const { IndicatorSnapshot } = require('./IndicatorSnapshot');
const { RegimeDetector } = require('./RegimeDetector');
const FeatureExtractor = require('./FeatureExtractor');
const FeatureFlagManager = require('./FeatureFlagManager');
const TradingConfig = require('./TradingConfig');
const { getInstance: getExitContractManager } = require('./ExitContractManager');
const flagManager = FeatureFlagManager.getInstance();

const stateManager = getStateManager();
const exitContractManager = getExitContractManager();

class TradingLoop {
  constructor(ctx) {
    // Store entire context - all dependencies from runner
    this.ctx = ctx;

    // Local state
    this.rsiHistory = [];
    this._lastAggLog = null;

    console.log('[TradingLoop] Initialized (Phase 15 - exact copy)');
  }

  /**
   * Analyze market and make trade decisions - EXACT COPY from run-empire-v2.js
   */
  async analyzeAndTrade() {
    // PAUSE_001 REVERTED 2026-02-04: The isTrading check was a band-aid
    // Real fix: WebSocket reconnect (this.connected = true in kraken_adapter_simple.js)
    // Frozen price/$0 P&L was caused by WebSocket not reconnecting, not missing pause check

    const { price } = this.ctx.marketData;

    // CHANGE 2025-12-23: Use IndicatorEngine as single source of truth
    const engineState = this.ctx.indicatorEngine.getSnapshot();

    // REFACTOR 2026-02-27: IndicatorSnapshot replaces manual reshape
    // Single transformation point. No fallback paths. Contracts that scream.
    const _indicatorSnapshot = new IndicatorSnapshot(this.ctx.contractValidator);
    let indicators;
    try {
      indicators = _indicatorSnapshot.create(engineState, price, this.ctx.priceHistory);
    } catch (snapErr) {
      // During warmup (first ~200 candles), IndicatorEngine may not have all data yet.
      // RSI needs 14 candles, BB needs 20, EMA200 needs 200.
      // This is the ONLY acceptable reason for the catch to fire.
      if (this.ctx.priceHistory.length < 50) {
        console.warn(`⚠️ IndicatorSnapshot warmup (${this.ctx.priceHistory.length} candles): ${snapErr.message}`);
        indicators = {
          price, rsi: engineState.rsi || 50, rsiNormalized: ((engineState.rsi || 50) / 100),
          macd: engineState.macd || { macd: 0, signal: 0, histogram: 0 },
          ema9: price, ema21: price, ema50: price, ema200: price,
          trend: 'neutral',
          atr: engineState.atr || (price * 0.005), atrPercent: 0.5, atrNormalized: 0.1,
          bb: { upper: price * 1.02, middle: price, lower: price * 0.98, bandwidth: 4, percentB: 0.5 },
          volatilityNormalized: 0.1, volume: 0, vwap: price
        };
      } else {
        // After warmup, a throw means real missing data — this IS the bug
        console.error(`❌ IndicatorSnapshot FAILED after warmup: ${snapErr.message}`);
        throw snapErr;
      }
    }

    // BACKWARD COMPAT: downstream reads these legacy field names
    indicators.ema12 = indicators.ema9 || price;
    indicators.ema26 = indicators.ema21 || price;
    indicators.volatility = indicators.atr || 0;
    indicators.bbWidth = indicators.bb?.bandwidth || 0;
    indicators.bollingerBands = indicators.bb;

    // Phase 3 REWRITE: RSI smoothing deleted - IndicatorEngine owns RSI calculation

    // Detect patterns
    const patterns = this.ctx.patternChecker.analyzePatterns({
      candles: this.ctx.priceHistory,
      trend: indicators.trend,
      macd: indicators.macd?.macd || indicators.macd?.macdLine || 0,
      macdSignal: indicators.macd?.signal || indicators.macd?.signalLine || 0,
      rsi: indicators.rsi,
      volume: this.ctx.marketData.volume || 0
    });

    // CRITICAL FIX: Record patterns immediately when detected for learning
    // Don't wait for trade completion - patterns need to be recorded NOW
    if (patterns && patterns.length > 0) {
      // TELEMETRY: Track pattern detection
      const telemetry = require('./Telemetry').getTelemetry();

      patterns.forEach(pattern => {
        const signature = pattern.signature || pattern.name || 'unknown_pattern';
        if (!signature || signature === 'unknown_pattern') {
          console.warn('⚠️ Pattern missing proper signature, using generic fallback:', pattern);
        }

        // ENSURE we always have an array
        let featuresForRecording;
        if (Array.isArray(pattern.features)) {
          featuresForRecording = pattern.features;
        } else {
          // REFACTOR Phase 4: Use FeatureExtractor module for fallback
          console.warn('[FeatureExtractor] Creating fallback features array');
          featuresForRecording = FeatureExtractor.extractArray({
            indicators: indicators,
            candles: this.ctx.priceHistory
          });
        }

        // FIX 2026-02-19: Re-enable entry recording with pnl: null (observation-only mode)
        if (this.ctx.config.tradingMode !== 'TEST' && process.env.TEST_MODE !== 'true') {
          this.ctx.patternChecker.recordPatternResult(featuresForRecording, {
            pnl: null,  // null = observation only
            timestamp: Date.now(),
            type: 'observation'
          });
        }

        // TELEMETRY: Log pattern detection event
        telemetry.event('pattern_detected', {
          signature,
          confidence: pattern.confidence,
          isNew: pattern.isNew,
          price: this.ctx.marketData.price
        });
      });

      // TELEMETRY: Log batch recording
      telemetry.event('pattern_recorded', {
        count: patterns.length,
        memorySize: this.ctx.patternChecker.getMemorySize ? this.ctx.patternChecker.getMemorySize() : 0
      });

      console.log(`📊 Recorded ${patterns.length} patterns for learning`);
    }

    // Update OGZ Two-Pole Oscillator with latest candle
    let tpoResult = null;
    if (this.ctx.ogzTpo && this.ctx.priceHistory.length > 0) {
      const latestCandle = this.ctx.priceHistory[this.ctx.priceHistory.length - 1];
      tpoResult = this.ctx.ogzTpo.update({
        o: latestCandle.o,
        h: latestCandle.h,
        l: latestCandle.l,
        c: latestCandle.c,
        t: latestCandle.time || Date.now()
      });

      if (tpoResult.signal) {
        console.log(`\n🎯 OGZ TPO Signal: ${tpoResult.signal.action} (${tpoResult.signal.zone})`);
        console.log(`   Strength: ${(tpoResult.signal.strength * 100).toFixed(2)}%`);
        console.log(`   High Probability: ${tpoResult.signal.highProbability ? '⭐ YES' : 'NO'}`);
        if (tpoResult.signal.levels) {
          console.log(`   SL: $${tpoResult.signal.levels.stopLoss.toFixed(2)}`);
          console.log(`   TP: $${tpoResult.signal.levels.takeProfit.toFixed(2)}`);
        }
      }
    }

    // 📡 Broadcast pattern analysis to dashboard
    this.ctx.broadcastPatternAnalysis(patterns, indicators);

    // REFACTOR 2026-02-27: New RegimeDetector replaces 797-line MarketRegimeDetector
    const _regimeDetector = new RegimeDetector();
    const regimeResult = _regimeDetector.detect(indicators, this.ctx.priceHistory);
    const regime = {
      currentRegime: regimeResult.regime || 'unknown',
      confidence: regimeResult.confidence || 0,
      parameters: regimeResult.details || {}
    };
    this.ctx.marketRegime = regime;  // Store for downstream reads

    // Update Fibonacci levels with current price history
    let fibLevels = null;
    let nearestFibLevel = null;
    if (this.ctx.fibonacciDetector && this.ctx.priceHistory.length >= 30) {
      fibLevels = this.ctx.fibonacciDetector.update(this.ctx.priceHistory);
      if (fibLevels) {
        nearestFibLevel = this.ctx.fibonacciDetector.getNearestLevel(price);
      }
    }

    // Phase 3 REWRITE: AGGRESSIVE_LEARNING_MODE deleted - use TradingConfig thresholds

    // Run orchestrator: each strategy evaluates independently, highest confidence wins
    const orchResult = this.ctx.strategyOrchestrator.evaluate(
      indicators,
      patterns,
      regime,
      this.ctx.priceHistory,
      {
        emaCrossoverSignal: this.ctx.emaCrossoverSignal,
        maDynamicSRSignal: this.ctx.maDynamicSRSignal,
        breakRetestSignal: this.ctx.breakRetestSignal,
        liquiditySweepSignal: this.ctx.liquiditySweepSignal,
        mtfAdapter: this.ctx.mtfAdapter,
        tpoResult: tpoResult,
        price: price,
        fibLevels: fibLevels,
        nearestFibLevel: nearestFibLevel,
        volumeProfile: this.ctx.volumeProfile,
      }
    );

    // Phase 3 REWRITE: Use orchResult directly, no brainDecision mapping
    // Normalize confidence to 0-1 decimal (downstream expects this)
    const normalizedConfidence = orchResult.confidence / 100;

    // SPOT market direction handling
    let tradingDirection = orchResult.direction;
    const currentPosition = stateManager.get('position');

    // Pipeline direction filter - block shorts on spot market
    const pipeline = TradingConfig.get('pipeline') || {};
    if (pipeline.directionFilter === 'long_only' && tradingDirection === 'sell') {
      if (currentPosition > 0) {
        console.log('📊 Orchestrator bearish - executing SELL of position');
      } else {
        console.log('🚫 [PIPELINE] Direction filter: long_only - blocking sell signal');
        tradingDirection = 'hold';
      }
    }

    // Phase 3 REWRITE: TEST_CONFIDENCE override deleted - use TradingConfig
    const confidenceData = {
      totalConfidence: orchResult.confidence
    };

    // BROADCAST SIGNAL DATA TO DASHBOARD
    if (this.ctx.dashboardWs && this.ctx.dashboardWs.readyState === 1) {
      try {
        const strategySignals = orchResult?.signalBreakdown?.signals || [];
        const bullishCount = strategySignals.filter(s => s.direction === 'buy').length;
        const bearishCount = strategySignals.filter(s => s.direction === 'sell').length;

        this.ctx.dashboardWs.send(JSON.stringify({
          type: 'signal_analysis',
          timestamp: Date.now(),
          signal: {
            direction: tradingDirection,
            confidence: orchResult.confidence,
            reasons: orchResult.reasons || [],
            meta: {
              signalsFired: strategySignals.length,
              bullishCount,
              bearishCount,
            },
            signals: strategySignals,
          },
          modules: {
            emaCrossover: this.ctx.emaCrossoverSignal ? {
              active: this.ctx.emaCrossoverSignal.direction !== 'neutral',
              direction: this.ctx.emaCrossoverSignal.direction,
              confidence: this.ctx.emaCrossoverSignal.confidence || 0,
            } : { active: false },
            liquiditySweep: this.ctx.liquiditySweepSignal ? {
              active: this.ctx.liquiditySweepSignal.hasSignal || false,
              direction: this.ctx.liquiditySweepSignal.direction,
              confidence: this.ctx.liquiditySweepSignal.confidence || 0,
            } : { active: false },
            maDynamicSR: this.ctx.maDynamicSRSignal ? {
              active: this.ctx.maDynamicSRSignal.direction !== 'neutral',
              direction: this.ctx.maDynamicSRSignal.direction,
              confidence: this.ctx.maDynamicSRSignal.confidence || 0,
            } : { active: false },
            tpo: this.ctx.ogzTpo ? { active: true } : { active: false },
            regime: {
              regime: regime?.currentRegime || regime?.regime || 'unknown',
              confidence: regime?.confidence || 0,
            },
            patterns: patterns.slice(0, 5).map(p => ({
              name: p.name || p.type,
              direction: p.direction,
              confidence: p.confidence,
            })),
            orchestrator: orchResult ? {
              winner: orchResult.winnerStrategy,
              direction: orchResult.direction,
              confidence: orchResult.confidence,
              confluence: orchResult.confluence,
              sizingMultiplier: orchResult.sizingMultiplier,
              exitContract: orchResult.exitContract,
              strategies: (orchResult.allResults || []).map(s => ({
                name: s.strategyName,
                direction: s.direction,
                confidence: s.confidence,
                reason: s.reason,
              })),
            } : null,
            timeframeSelector: this.ctx.timeframeSelector?.getState(),
          },
        }));
      } catch (e) {
        // Fail silently
      }
    }

    // TRAI DECISION PROCESSING
    let finalConfidence = confidenceData.totalConfidence;
    let traiDecision = null;
    const skipTRAI = this.ctx.config.enableBacktestMode && process.env.TRAI_ENABLE_BACKTEST === 'false';

    if (this.ctx.trai && !skipTRAI) {
      try {
        const signal = {
          action: tradingDirection.toUpperCase(),
          confidence: orchResult.confidence,
          patterns: patterns,
          indicators: indicators,
          price: price,
          timestamp: Date.now()
        };

        const context = {
          volatility: indicators.volatility,
          trend: indicators.trend,
          volume: this.ctx.marketData.volume || 'normal',
          regime: regime.currentRegime || 'unknown',
          indicators: indicators,
          positionSize: stateManager.get('balance') * 0.01,
          currentPosition: stateManager.get('position')
        };

        // TRAI ASYNC OBSERVER
        this.ctx.trai.processDecision(signal, context)
          .then(decision => {
            if (decision && decision.id) {
              this.ctx._lastTraiDecision = decision;
            }
          })
          .catch(err => {
            console.warn('⚠️ [TRAI Async] Error (non-blocking):', err.message);
          });
      } catch (error) {
        console.error('⚠️ TRAI processing error:', error.message);
      }
    }

    // Log clean analysis summary
    const bestPattern = patterns.length > 0 ? patterns[0].name : 'none';
    const cleanPrice = Math.round(price).toLocaleString();
    console.log(`\n📊 $${cleanPrice} | Conf: ${confidenceData.totalConfidence.toFixed(0)}% | RSI: ${Math.round(indicators.rsi)} | ${indicators.trend} | ${regime.currentRegime || 'analyzing'}`);

    // CHECK FOR STRONG INDICATOR SIGNALS (TPO) THAT CAN OVERRIDE
    let overrideSignal = null;
    let signalSource = null;

    if (tpoResult && tpoResult.signal && tpoResult.signal.highProbability) {
      console.log(`\n⚡ TPO Override: High probability ${tpoResult.signal.zone} signal`);

      if (tpoResult.signal.strength > 0.03) {
        overrideSignal = tpoResult.signal;
        signalSource = 'TPO';
        tradingDirection = tpoResult.signal.action === 'BUY' ? 'buy' : 'sell';
      }
    }

    // Phase 3 REWRITE: Inline trade decision logic (EntryDecider deleted)
    // Simple flow: BUY when flat + bullish signal, SELL via ExitContractManager, else HOLD
    console.log(`🔍 PRE-DECISION: tradingDirection=${tradingDirection}, conf=${confidenceData.totalConfidence.toFixed(1)}%`);

    const pos = stateManager.get('position');
    const minConfidence = this.ctx.config.minTradeConfidence * 100;
    let decision = { action: 'HOLD', confidence: orchResult.confidence };

    // Check for SELL first (exit existing position)
    if (pos > 0) {
      const allTrades = stateManager.getAllTrades();
      const activeTrade = allTrades.find(t => t.action === 'BUY');

      if (activeTrade) {
        // Update max profit for trailing stop calculation
        exitContractManager.updateMaxProfit(activeTrade, price);

        // Check exit conditions from trade's own contract
        const exitCheck = exitContractManager.checkExitConditions(activeTrade, price, {
          indicators: indicators,
          currentTime: this.ctx.marketData?.timestamp || Date.now(),
          accountBalance: stateManager.get('balance'),
          initialBalance: stateManager.get('initialBalance') || 10000
        });

        if (exitCheck.shouldExit) {
          console.log(`[EXIT-CONTRACT] ${exitCheck.details}`);
          decision = {
            action: 'SELL',
            direction: 'close',
            confidence: exitCheck.confidence || 100,
            exitReason: exitCheck.exitReason
          };
        }

        // Check MaxProfitManager for tiered profit exits (if active)
        // Phase 4 REWRITE: Access maxProfitManager directly (was inside deleted tradingBrain)
        if (decision.action !== 'SELL' && this.ctx.maxProfitManager?.state?.active) {
          const profitResult = this.ctx.maxProfitManager.update(price, {
            volatility: indicators.volatility || 0,
            trend: indicators.trend || 'sideways',
            volume: this.ctx.marketData?.volume || 0
          });

          if (profitResult && (profitResult.action === 'exit_full' || profitResult.action === 'exit_partial')) {
            console.log(`📉 SELL Signal: ${profitResult.reason || 'MaxProfitManager exit'} (${profitResult.action})`);
            decision = {
              action: 'SELL',
              direction: 'close',
              confidence: orchResult.confidence,
              exitSize: profitResult.exitSize,
              exitReason: profitResult.reason
            };
          }
        }
      }
    } else if (tradingDirection === 'buy' && orchResult.confidence >= minConfidence) {
      // FIX 2026-03-06: ENFORCE MAX_DRAWDOWN + MAX_DAILY_LOSS via RiskManager
      // These flags were loaded but never checked - wiring them now
      if (this.ctx.riskManager) {
        const riskCheck = this.ctx.riskManager.isTradingAllowed();
        if (!riskCheck.allowed) {
          console.log(`🛑 RISK BLOCK: ${riskCheck.reason} - Trade rejected`);
          decision = { action: 'HOLD', confidence: 0, blockReason: riskCheck.reason };
        } else {
          // Also run full risk assessment for position sizing guidance
          const riskAssessment = this.ctx.riskManager.assessTradeRisk({
            confidence: orchResult.confidence / 100,
            direction: tradingDirection
          });
          if (!riskAssessment.approved) {
            console.log(`🛑 RISK BLOCK: ${riskAssessment.reason} - Trade rejected`);
            decision = { action: 'HOLD', confidence: 0, blockReason: riskAssessment.reason };
          } else {
            // BUY when flat and orchestrator signals buy with sufficient confidence
            console.log(`✅ BUY DECISION: Confidence ${orchResult.confidence.toFixed(1)}% >= ${minConfidence}% | Direction: ${tradingDirection}`);
            if (riskAssessment.riskLevel !== 'LOW') {
              console.log(`   ⚠️ Risk level: ${riskAssessment.riskLevel} - ${riskAssessment.recommendation}`);
            }
            decision = {
              action: 'BUY',
              direction: 'long',
              confidence: orchResult.confidence,
              riskLevel: riskAssessment.riskLevel,
              riskRecommendation: riskAssessment.recommendation
            };
          }
        }
      } else {
        // Fallback if riskManager not available (shouldn't happen)
        console.log(`✅ BUY DECISION: Confidence ${orchResult.confidence.toFixed(1)}% >= ${minConfidence}% | Direction: ${tradingDirection}`);
        decision = {
          action: 'BUY',
          direction: 'long',
          confidence: orchResult.confidence
        };
      }
    }

    // Store for PipelineSnapshot
    this.ctx.lastConfidence = confidenceData.totalConfidence;
    this.ctx.lastDirection = tradingDirection;

    // Add override signal info to decision
    if (overrideSignal && decision.action !== 'HOLD') {
      decision.signalSource = signalSource;
      decision.overrideSignal = overrideSignal;

      if (overrideSignal.levels) {
        decision.suggestedStopLoss = overrideSignal.levels.stopLoss || overrideSignal.stop;
        decision.suggestedTakeProfit = overrideSignal.levels.takeProfit || overrideSignal.target1;
        console.log(`   📍 Using ${signalSource} levels: SL=$${decision.suggestedStopLoss?.toFixed(2)}, TP=$${decision.suggestedTakeProfit?.toFixed(2)}`);
      } else if (overrideSignal.stop && overrideSignal.target1) {
        decision.suggestedStopLoss = overrideSignal.stop;
        decision.suggestedTakeProfit = overrideSignal.target1;
        console.log(`   📍 Using ${signalSource} levels: SL=$${decision.suggestedStopLoss.toFixed(2)}, TP=$${decision.suggestedTakeProfit.toFixed(2)}`);
      }
    }

    // Broadcast chain-of-thought to dashboard (Phase 3: uses orchResult directly)
    if (this.ctx.dashboardWsConnected && this.ctx.dashboardWs) {
      const reasoning = decision.action === 'HOLD' ?
        `Waiting: Confidence ${decision.confidence?.toFixed(1) || 0}% < ${minConfidence}% minimum` :
        `${decision.action}: Confidence ${decision.confidence?.toFixed(1)}% | ${orchResult.winnerStrategy || 'signal'} strategy`;

      const chainOfThought = {
        type: 'bot_thinking',
        timestamp: Date.now(),
        message: reasoning,
        confidence: decision.confidence,
        data: {
          reasoning: reasoning,
          pattern: patterns?.[0]?.name || 'Scanning...',
          rsi: indicators.rsi,
          trend: indicators.trend,
          riskScore: 0,
          recommendation: decision.action,
          finalConfidence: decision.confidence,
          price: price,
          regime: regime?.currentRegime || 'unknown',
          module: orchResult.winnerStrategy || 'orchestrator',
          volatility: indicators.volatility
        }
      };

      try {
        this.ctx.dashboardWs.send(JSON.stringify(chainOfThought));
      } catch (err) {
        // Fail silently - dashboard is optional
      }
    }

    if (decision.action !== 'HOLD') {
      await this.ctx.executeTrade(decision, confidenceData, price, indicators, patterns, traiDecision, orchResult);
    }
  }
}

module.exports = TradingLoop;
