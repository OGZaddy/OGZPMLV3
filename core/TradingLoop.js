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
const flagManager = FeatureFlagManager.getInstance();

const stateManager = getStateManager();

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

    // CHANGE 655: RSI Smoothing - Prevent machine-gun trading without circuit breakers
    this.rsiHistory.push(indicators.rsi);
    if (this.rsiHistory.length > 3) this.rsiHistory.shift(); // Keep last 3 RSI values

    // Smooth RSI using weighted average to prevent jumps
    if (this.rsiHistory.length >= 2) {
      const weights = [0.5, 0.3, 0.2]; // Most recent gets 50% weight
      let smoothedRSI = 0;
      for (let i = 0; i < this.rsiHistory.length; i++) {
        smoothedRSI += this.rsiHistory[this.rsiHistory.length - 1 - i] * (weights[i] || 0.1);
      }

      // If RSI jumped too much, use smoothed value
      const lastRSI = this.rsiHistory[this.rsiHistory.length - 2];
      const rsiJump = Math.abs(indicators.rsi - lastRSI);

      if (rsiJump > 30) {
        console.log(`🔄 RSI Smoothing: Jump ${lastRSI.toFixed(1)}→${indicators.rsi.toFixed(1)} smoothed to ${smoothedRSI.toFixed(1)}`);
        indicators.rsi = smoothedRSI;
      }
    }

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

    // AGGRESSIVE_LEARNING_MODE: Lower the orchestrator threshold if enabled
    if (flagManager.isEnabled('AGGRESSIVE_LEARNING_MODE')) {
      const aggressiveThreshold = flagManager.getSetting('AGGRESSIVE_LEARNING_MODE', 'minConfidenceThreshold', 55) / 100;
      this.ctx.strategyOrchestrator.minStrategyConfidence = aggressiveThreshold;
      if (!this._lastAggLog || Date.now() - this._lastAggLog > 60000) {
        console.log(`🔥 AGGRESSIVE LEARNING: Orchestrator threshold set to ${(aggressiveThreshold * 100).toFixed(0)}%`);
        this._lastAggLog = Date.now();
      }
    }

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

    // Map orchestrator output to existing variable names
    const brainDecision = {
      direction: orchResult.direction,
      confidence: orchResult.confidence / 100,  // Downstream expects 0-1 decimal
      reasons: orchResult.reasons,
      signalBreakdown: orchResult.signalBreakdown,
      action: orchResult.action,
      exitContract: orchResult.exitContract,
      sizingMultiplier: orchResult.sizingMultiplier,
      winnerStrategy: orchResult.winnerStrategy,
    };

    // SPOT market direction handling
    let tradingDirection = brainDecision.direction;
    const currentPosition = stateManager.get('position');
    if (tradingDirection === 'sell' && currentPosition === 0) {
      console.log('🚫 TradingBrain said SELL but no position to sell (SPOT market) - converting to HOLD');
      tradingDirection = 'hold';
    } else if (tradingDirection === 'sell' && currentPosition > 0) {
      console.log('📊 TradingBrain bearish - executing SELL of position');
    }

    // TEST MODE handling
    let rawConfidence = brainDecision.confidence;
    if (this.ctx.config.tradingMode === 'TEST') {
      console.log(`🧪 TEST MODE: Using EXISTING patterns (${patterns.length} found) but NOT saving new ones`);
      if (process.env.TEST_CONFIDENCE) {
        const testConfidence = parseFloat(process.env.TEST_CONFIDENCE);
        rawConfidence = testConfidence / 100;
        console.log(`🧪 Override confidence: ${testConfidence}% (was ${(brainDecision.confidence * 100).toFixed(1)}%)`);
      }
    }

    const confidenceData = {
      totalConfidence: rawConfidence * 100
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
            confidence: rawConfidence,
            reasons: brainDecision.reasons || [],
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
          confidence: rawConfidence,
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

    // Make trade decision
    console.log(`🔍 PRE-DECISION: tradingDirection=${tradingDirection}, conf=${confidenceData.totalConfidence.toFixed(1)}%`);
    const decision = this.ctx.entryDecider.makeTradeDecision(confidenceData, indicators, patterns, price, tradingDirection, this.ctx.runner);

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

    // Broadcast TRAI chain-of-thought to dashboard
    if (this.ctx.dashboardWsConnected && this.ctx.dashboardWs && decision.decisionContext) {
      const reasoning = decision.action === 'HOLD' ?
        `Waiting: Confidence ${decision.confidence?.toFixed(1) || 0}% < ${this.ctx.config.minTradeConfidence * 100}% minimum` :
        `${decision.action}: Confidence ${decision.confidence?.toFixed(1)}% | ${decision.decisionContext.module} strategy`;

      const chainOfThought = {
        type: 'bot_thinking',
        timestamp: Date.now(),
        message: reasoning,
        confidence: decision.confidence,
        data: {
          reasoning: reasoning,
          pattern: decision.decisionContext.patterns?.[0] || 'Scanning...',
          rsi: indicators.rsi,
          trend: indicators.trend,
          riskScore: (isNaN(decision.decisionContext.riskScore) ? 0 : decision.decisionContext.riskScore) || 0,
          recommendation: decision.action,
          finalConfidence: decision.confidence,
          price: decision.decisionContext.price,
          regime: decision.decisionContext.regime,
          module: decision.decisionContext.module,
          volatility: indicators.volatility
        }
      };

      try {
        this.ctx.dashboardWs.send(JSON.stringify(chainOfThought));
        console.log(`🧠 [TRAI] Chain-of-thought sent to dashboard: ${decision.action}`);
      } catch (err) {
        console.error('Failed to send TRAI reasoning to dashboard:', err.message);
      }
    }

    if (decision.action !== 'HOLD') {
      await this.ctx.executeTrade(decision, confidenceData, price, indicators, patterns, traiDecision, brainDecision);
    }
  }
}

module.exports = TradingLoop;
