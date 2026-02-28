/**
 * TRAI DECISION MODULE - AI Co-Founder Pipeline Integration
 * ==========================================================
 * 
 * This module integrates TRAI directly into the trading pipeline as a 
 * critical decision component that sits between pattern recognition and execution.
 * 
 * TRAI's Role in Pipeline:
 * 1. Signal Enrichment: Enhances raw signals with AI insights
 * 2. Confidence Scoring: Provides independent confidence assessment
 * 3. Risk Governance: Acts as final sanity check before execution
 * 4. Pattern Learning: Feeds back successful patterns for ML training
 * 
 * Integration Points:
 * - PRE-BRAIN: Enriches patterns before brain processing
 * - POST-BRAIN: Validates and adjusts confidence scores
 * - PRE-EXECUTION: Final risk assessment and veto power
 * 
 * @author Trey (OGZPrime Technologies)
 * @version 1.0.0
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const TradingConfig = require('./TradingConfig');  // CHANGE 2026-02-28: Centralized config

// Version hash for telemetry
const VERSION_HASH = 'v2.0.0-telem';

// Ensure logs directory exists (fire-and-forget, ignore errors)
const LOGS_DIR = path.join(__dirname, '..', 'logs');
try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (_) {}

class TRAIDecisionModule extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Configuration
    this.config = {
      // Confidence thresholds
      minConfidenceOverride: 0.40,    // TRAI can override down to 40%
      maxConfidenceOverride: 0.95,    // TRAI can boost up to 95%
      confidenceWeight: 0.3,          // TRAI's weight in final confidence (30%)
      
      // Risk governance
      enableVetoPower: true,          // TRAI can veto risky trades
      maxRiskTolerance: 0.03,         // 3% max risk per trade
      emergencyStopLoss: 0.05,        // 5% emergency stop
      
      // Pattern learning
      enablePatternLearning: true,    // Learn from successful patterns
      minSampleSize: 100,             // Min samples before pattern trust
      
      // Integration mode
      mode: 'passive',                 // CHANGE 628: TRAI now observes only, doesn't block trades
      
      // Performance tracking
      trackDecisions: true,
      logPath: './logs/trai-decisions.log',
      
      ...config
    };
    
    // State management
    this.state = {
      isInitialized: false,
      totalDecisions: 0,
      overrides: 0,
      vetoes: 0,
      successfulTrades: 0,
      failedTrades: 0
    };
    
    // Pattern memory
    this.patternMemory = new Map();
    
    // Decision history for ML feedback
    this.decisionHistory = [];
    
    // TRAI Core instance (will be initialized)
    this.traiCore = null;

    // WebSocket client for dashboard broadcasts
    this.wsClient = null;
  }

  /**
   * Set WebSocket client for dashboard broadcasts
   */
  setWebSocketClient(wsClient) {
    this.wsClient = wsClient;
    console.log('✅ [TRAI] Dashboard WebSocket connected');
  }

  /**
   * Initialize TRAI Decision Module
   */
  async initialize() {
    try {
      console.log('🤖 [TRAI] Initializing Decision Module...');
      
      // Initialize TRAI Core if available and LLM is enabled
      const enableLLM = process.env.TRAI_ENABLE_LLM !== 'false';

      if (enableLLM) {
        try {
          const TRAICore = require('./trai_core.js');
          this.traiCore = new TRAICore({
            staticBrainPath: './trai_brain',
            enableLLM: true,
            llmConfig: {
              modelPath: './trai_brain/models',
              temperature: 0.3,  // Lower temperature for trading decisions
              maxTokens: 150     // Concise responses
            }
          });

          await this.traiCore.initialize();
          console.log('✅ [TRAI] Core AI initialized with process pool (max 4 concurrent)');
        } catch (error) {
          console.log('⚠️ [TRAI] LLM initialization failed, falling back to rule-based mode');
          this.traiCore = null;
        }
      } else {
        console.log('⚠️ [TRAI] Running in rule-based mode (LLM disabled via TRAI_ENABLE_LLM=false)');
        this.traiCore = null;
      }
      
      this.state.isInitialized = true;
      this.emit('initialized');
      
    } catch (error) {
      console.error('❌ [TRAI] Initialization failed:', error.message);
      throw error;
    }
  }
  
  /**
   * MAIN PIPELINE METHOD: Process trading signal through TRAI
   * This is the primary integration point for the trading pipeline
   * 
   * @param {Object} signal - Raw trading signal
   * @param {Object} context - Market context and indicators
   * @returns {Object} Enhanced decision with TRAI input
   */
  async processDecision(signal, context) {
    console.log('[TRAI-CHECKPOINT-1] processDecision START');
    console.log(`[TRAI-CHECKPOINT-2] Input - action: ${signal.action}, confidence: ${signal.confidence}`);

    this.state.totalDecisions++;

    const startTime = Date.now();
    const decision = {
      id: Date.now(), // 🔥 CODEX FIX: Add ID for learning feedback loop
      originalSignal: signal,
      originalConfidence: signal.confidence || 0,
      traiConfidence: 0,
      finalConfidence: 0,
      traiRecommendation: 'HOLD',
      riskAssessment: {},
      adjustments: [],
      reasoning: '',
      processingTime: 0,
      vetoApplied: false
    };

    console.log(`[TRAI-CHECKPOINT-3] Decision initialized - originalConfidence: ${decision.originalConfidence}`);

    try {
      // Step 1: Analyze patterns and market conditions
      console.log('[TRAI-CHECKPOINT-4] Calling analyzeMarketConditions');
      const marketAnalysis = await this.analyzeMarketConditions(context);
      console.log(`[TRAI-CHECKPOINT-5] Market analysis - volatility: ${marketAnalysis.volatility}, trend: ${marketAnalysis.trend}`);
      
      // Step 2: Calculate TRAI's independent confidence score
      console.log('[TRAI-CHECKPOINT-6] Calling calculateConfidence');
      decision.traiConfidence = await this.calculateConfidence(signal, context, marketAnalysis);
      console.log(`[TRAI-CHECKPOINT-7] TRAI confidence calculated: ${decision.traiConfidence}`);
      
      // Step 3: Blend confidences based on mode
      decision.finalConfidence = this.blendConfidences(
        signal.confidence,
        decision.traiConfidence
      );
      
      // Step 4: Risk assessment and governance
      decision.riskAssessment = await this.assessRisk(signal, context, decision.finalConfidence);
      
      // Step 5: Make final recommendation (pass original action for proper BUY/SELL handling)
      decision.traiRecommendation = this.makeRecommendation(
        decision.finalConfidence,
        decision.riskAssessment,
        signal.action
      );
      
      // Step 6: Check for veto conditions
      if (this.config.enableVetoPower) {
        decision.vetoApplied = this.checkVetoConditions(decision.riskAssessment);
        if (decision.vetoApplied) {
          decision.traiRecommendation = 'VETO';
          decision.finalConfidence = 0;
          decision.reasoning = `VETO: ${decision.riskAssessment.vetoReason}`;
          this.state.vetoes++;
        }
      }
      
      // Step 7: Generate reasoning (use LLM for uncertain decisions, rule-based for clear ones)
      if (this.traiCore && !decision.vetoApplied) {
        // Use LLM for borderline decisions (40-70% confidence) - need deep analysis
        // CRITICAL: Check ORIGINAL confidence, not final (final is already blended down!)
        // Uses persistent LLM server for fast inference (<2s with model in GPU)
        const useLLM = signal.confidence >= 0.40 && signal.confidence <= 0.70;

        if (useLLM) {
          try {
            const llmReasoning = await this.generateReasoning(signal, context, decision);
            // If LLM returns valid response, use it; otherwise fallback
            if (llmReasoning && !llmReasoning.includes("I'm TRAI, your AI co-founder")) {
              decision.reasoning = llmReasoning;
            } else {
              decision.reasoning = this.generateRuleBasedReasoning(decision, context);
            }
          } catch (error) {
            decision.reasoning = this.generateRuleBasedReasoning(decision, context);
          }
        } else {
          // Clear signals (>70%) or weak signals (<40%) - use fast rule-based
          decision.reasoning = this.generateRuleBasedReasoning(decision, context);
        }
      } else if (!decision.vetoApplied) {
        decision.reasoning = this.generateRuleBasedReasoning(decision, context);
      }
      
      // Step 8: Apply position size adjustments
      if (decision.traiRecommendation === 'BUY' || decision.traiRecommendation === 'SELL') {
        decision.adjustments = this.calculateAdjustments(decision.finalConfidence, decision.riskAssessment);
      }
      
      // Step 9: Store decision for learning
      this.storeDecision(decision, signal, context);

    } catch (error) {
      console.error('❌ [TRAI] Error processing decision:', error.message);
      // Fail gracefully - return original signal
      decision.finalConfidence = signal.confidence;
      // CHANGE 614: Fix case-sensitivity bug - normalize to uppercase for consistency
      const fallbackAction = (signal.action || 'HOLD').toString().toUpperCase();
      decision.traiRecommendation = fallbackAction;
      decision.reasoning = 'Error in TRAI processing - using original signal';
    }

    // Calculate processing time BEFORE logging
    decision.processingTime = Date.now() - startTime;

    // Step 10: Log the decision (after processingTime is set!)
    this.logDecision(decision, signal, context);

    // Emit decision event for monitoring
    this.emit('decision', decision);

    // 📡 Broadcast chain-of-thought to dashboard
    this.broadcastChainOfThought(decision, context);

    return decision;
  }

  /**
   * Broadcast TRAI's chain-of-thought to dashboard for transparency
   */
  broadcastChainOfThought(decision, context) {
    try {
      if (this.wsClient && this.wsClient.readyState === 1) {
        const message = {
          type: 'bot_thinking',
          step: 'trai_analysis',
          timestamp: Date.now(),
          message: decision.reasoning,
          confidence: (decision.finalConfidence * 100).toFixed(1),
          data: {
            // Market analysis
            price: context.price,
            trend: context.trend,
            rsi: context.indicators?.rsi,
            macd: context.indicators?.macd,
            volatility: context.volatility,

            // TRAI decision breakdown
            originalConfidence: (decision.originalConfidence * 100).toFixed(1),
            traiConfidence: (decision.traiConfidence * 100).toFixed(1),
            finalConfidence: (decision.finalConfidence * 100).toFixed(1),
            recommendation: decision.traiRecommendation,
            riskScore: (decision.riskAssessment.riskScore * 100).toFixed(1),

            // Pattern memory
            patternMemoryUsed: decision.patternMemoryMatch || false,
            historicalWinRate: decision.historicalWinRate ? (decision.historicalWinRate * 100).toFixed(1) : null,

            // Performance
            processingTime: decision.processingTime
          }
        };

        this.wsClient.send(JSON.stringify(message));
      }
    } catch (error) {
      // Fail silently - don't let dashboard broadcast issues affect trading
      console.error('⚠️ [TRAI] Dashboard broadcast failed:', error.message);
    }
  }
  
  /**
   * Analyze market conditions for context
   */
  async analyzeMarketConditions(context) {
    const analysis = {
      volatility: context.volatility || 0.02,
      trend: context.trend || 'neutral',
      volume: context.volume || 'normal',
      regime: context.regime || 'unknown',
      sentiment: 'neutral',
      risk: 'medium'
    };
    
    // Classify volatility
    if (analysis.volatility < 0.015) {
      analysis.risk = 'low';
    } else if (analysis.volatility > 0.035) {
      analysis.risk = 'high';
    }
    
    // Analyze trend strength
    if (context.indicators) {
      const { rsi, macd } = context.indicators;
      if (rsi > 70) analysis.sentiment = 'overbought';
      else if (rsi < 30) analysis.sentiment = 'oversold';
      else if (rsi > 55 && macd?.histogram > 0) analysis.sentiment = 'bullish';
      else if (rsi < 45 && macd?.histogram < 0) analysis.sentiment = 'bearish';
    }
    
    return analysis;
  }
  
  /**
   * Calculate TRAI's independent confidence score
   */
  async calculateConfidence(signal, context, marketAnalysis) {
    console.log('[TRAI-CALC-1] calculateConfidence START');
    console.log(`[TRAI-CALC-2] Input - signal.action: ${signal.action}, signal.confidence: ${signal.confidence}`);

    let confidence = 0;
    console.log(`[DEBUG] calculateConfidence called with signal.action: ${signal.action}, signal.confidence: ${signal.confidence}`);

    // 🧠 PRIORITY 1: Check TRAI's learned pattern memory first
    // If TRAI has learned about this pattern, use that knowledge
    console.log('[TRAI-CALC-3] Checking traiCore');
    if (this.traiCore) {
      console.log('[TRAI-CALC-4] traiCore exists, creating marketData');
      const marketData = {
        indicators: context.indicators,
        trend: context.trend,
        volatility: context.volatility,
        timestamp: new Date().toISOString()
      };

      console.log('[TRAI-CALC-5] Calling checkPatternMemory');
      const learnedPattern = this.traiCore.checkPatternMemory(marketData);
      console.log(`[TRAI-CALC-6] learnedPattern result: ${learnedPattern ? JSON.stringify(learnedPattern) : 'null'}`);

      if (learnedPattern) {
        if (learnedPattern.source === 'learned_success') {
          // TRAI knows this pattern works!
          console.log(`[TRAI-CALC-7] LEARNED SUCCESS - confidence: ${learnedPattern.confidence}`);
          console.log(`🧠 [TRAI Memory] Using learned pattern confidence: ${(learnedPattern.confidence * 100).toFixed(1)}%`);
          return learnedPattern.confidence;
        } else if (learnedPattern.source === 'learned_failure') {
          // TRAI knows to avoid this pattern
          console.log('[TRAI-CALC-7] LEARNED FAILURE - returning 0');
          console.log(`⚠️ [TRAI Memory] Avoiding failed pattern`);
          return 0.0;
        }
      }
    } else {
      console.log('[TRAI-CALC-4] traiCore not available');
    }

    // Base confidence from signal strength (Change 586: Fix TRAI confidence for all signals)
    console.log(`[TRAI-CALC-8] Checking action: ${signal.action}`);
    // Change 588: Handle HOLD signals too - they still need confidence evaluation
    // CHANGE 614: Fix case-sensitivity bug - normalize to lowercase
    const actionLower = (signal.action || '').toString().toLowerCase();
    if (actionLower === 'buy' || actionLower === 'sell' || actionLower === 'hold') {
      console.log(`[TRAI-CALC-9] Action is ${signal.action}`);
      // Change 586: Properly handle signal confidence
      // Signal confidence might be in percentage (44) or decimal (0.44)
      // Ensure we always have a reasonable starting confidence
      if (signal.confidence !== undefined && signal.confidence !== null) {
        // If confidence > 1, it's likely a percentage
        confidence = signal.confidence > 1 ? signal.confidence / 100 : signal.confidence;
      } else {
        // No signal confidence provided, use default based on action
        // CHANGE 614: Fix case-sensitivity bug - normalize to lowercase
        confidence = actionLower === 'hold' ? 0.3 : 0.5;
      }
      console.log(`[TRAI-CALC-10] Initial confidence from signal: ${confidence} (raw: ${signal.confidence})`);

      // If confidence appears to be very low, ensure we start with reasonable base
      if (confidence < 0.3) {
        console.log(`[TRAI-CALC-11] Boosting low confidence from ${confidence} to 0.3`);
        confidence = 0.3; // Minimum base confidence for actionable signals
      }

      // Pattern recognition boost (small adjustments)
      if (signal.patterns && signal.patterns.length > 0) {
        console.log(`[TRAI-CALC-12] Evaluating ${signal.patterns.length} patterns`);
        const patternBoost = this.evaluatePatterns(signal.patterns);
        console.log(`[TRAI-CALC-13] Pattern boost: ${patternBoost}`);
        confidence += patternBoost * 0.1; // Scale down pattern boost
        console.log(`[TRAI-CALC-14] Confidence after patterns: ${confidence}`);
      }

      // Indicator alignment (small adjustments)
      if (context.indicators) {
        console.log('[TRAI-CALC-15] Scoring indicators');
        const indicatorScore = this.scoreIndicators(context.indicators, signal.action);
        console.log(`[TRAI-CALC-16] Indicator score: ${indicatorScore}`);
        confidence += indicatorScore * 0.1; // Scale down indicator boost
        console.log(`[TRAI-CALC-17] Confidence after indicators: ${confidence}`);
      }

      // Market regime alignment (small adjustments)
      // CHANGE 614: Fix case-sensitivity bug - normalize to lowercase
      if (marketAnalysis.sentiment === 'bullish' && actionLower === 'buy') {
        confidence += 0.05; // Reduced from 0.1
      } else if (marketAnalysis.sentiment === 'bearish' && actionLower === 'sell') {
        confidence += 0.05; // Reduced from 0.1
      }

      // Volatility adjustment (small adjustments)
      if (marketAnalysis.risk === 'low') {
        confidence += 0.03; // Reduced from 0.05
      } else if (marketAnalysis.risk === 'high') {
        confidence -= 0.05; // Reduced from 0.1
      }

      // Legacy historical pattern success rate (old Map-based memory)
      const patternKey = this.generatePatternKey(signal, context);
      if (this.patternMemory.has(patternKey)) {
        const history = this.patternMemory.get(patternKey);
        if (history.samples >= this.config.minSampleSize) {
          const successRate = history.successes / history.samples;
          confidence = confidence * 0.7 + successRate * 0.3; // 30% weight to history
        }
      }
    } else {
      console.log(`[TRAI-CALC-20] Action is ${signal.action} - not BUY/SELL, confidence remains ${confidence}`);
    }

    // Clamp confidence to valid range
    const finalConfidence = Math.max(0, Math.min(1, confidence));
    console.log(`[TRAI-CALC-FINAL] Returning confidence: ${finalConfidence}`);
    return finalConfidence;
  }
  
  /**
   * Evaluate pattern strength
   */
  evaluatePatterns(patterns) {
    let boost = 0;
    const strongPatterns = [
      'golden_cross', 'bullish_engulfing', 'hammer',
      'morning_star', 'three_white_soldiers'
    ];
    const weakPatterns = ['doji', 'spinning_top'];
    
    for (const pattern of patterns) {
      if (strongPatterns.includes(pattern.name || pattern)) {
        boost += 0.15;
      } else if (!weakPatterns.includes(pattern.name || pattern)) {
        boost += 0.08;
      }
    }
    
    return Math.min(0.3, boost); // Cap at 30% boost
  }
  
  /**
   * Score indicator alignment
   */
  scoreIndicators(indicators, action) {
    let score = 0;
    const { rsi, macd, trend } = indicators;

    // CHANGE 614: Fix case-sensitivity bug - normalize to lowercase
    const actionLower = (action || '').toString().toLowerCase();

    if (actionLower === 'buy') {
      if (rsi > 30 && rsi < 70) score += 0.1;
      if (rsi > 40 && rsi < 60) score += 0.05; // Optimal range
      if (macd?.histogram > 0) score += 0.1;
      if (trend === 'upward' || trend === 'up' || trend === 'uptrend') score += 0.1;
    } else if (actionLower === 'sell') {
      if (rsi > 30 && rsi < 70) score += 0.1;
      if (rsi > 40 && rsi < 60) score += 0.05;
      if (macd?.histogram < 0) score += 0.1;
      if (trend === 'downward' || trend === 'down' || trend === 'downtrend') score += 0.1;
    }

    return score;
  }
  
  /**
   * Blend TRAI confidence with original confidence
   */
  blendConfidences(originalConfidence, traiConfidence) {
    const weight = this.config.confidenceWeight;

    switch (this.config.mode) {
      case 'passive':
        // TRAI observes but doesn't influence
        return originalConfidence;

      case 'advisory':
        // Change 615: Restore Change 586 - TRAI learning caution
        // When TRAI confidence < 10%, it hasn't learned the pattern yet
        if (traiConfidence < 0.1) {
          return originalConfidence * 0.9; // Slight caution penalty
        }

        // Change 599: TRAI BOOSTS confidence (additive), not blend (weighted average)
        // Original confidence is the sum of all indicators (RSI, MACD, EMAs, patterns, etc.)
        // TRAI adds intelligence layer on top
        const traiBoost = traiConfidence * this.config.confidenceWeight; // 20% of TRAI's confidence
        const boosted = originalConfidence + traiBoost;
        return Math.min(1.0, boosted); // Cap at 100%

      case 'hybrid':
        // Balanced additive boost (higher TRAI influence)
        const hybridBoost = traiConfidence * weight;
        return Math.min(1.0, originalConfidence + hybridBoost);

      case 'autonomous':
        // TRAI has primary control - use blend for this mode only
        return traiConfidence * 0.7 + originalConfidence * 0.3;

      default:
        return originalConfidence;
    }
  }
  
  /**
   * Assess risk for the trade
   */
  async assessRisk(signal, context, confidence) {
    const assessment = {
      riskScore: 0,
      maxLoss: 0,
      probability: confidence,
      factors: [],
      approved: true,
      vetoReason: null
    };
    
    // Calculate risk score (0-1, higher is riskier)
    let riskScore = 0;
    
    // Volatility risk
    const volatility = context.volatility || 0.02;
    riskScore += volatility * 10; // Scale volatility to 0-0.5 range
    
    // Low confidence risk
    if (confidence < 0.5) {
      riskScore += (0.5 - confidence) * 0.5;
      assessment.factors.push('low_confidence');
    }
    
    // Market regime risk
    if (context.regime === 'volatile' || context.regime === 'unknown') {
      riskScore += 0.2;
      assessment.factors.push('uncertain_regime');
    }
    
    // Time of day risk (if available)
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 6) {
      riskScore += 0.1; // Low liquidity hours
      assessment.factors.push('low_liquidity_hours');
    }
    
    // Calculate max loss based on position size and stop loss
    const positionSize = context.positionSize || 0.01;
    const stopLoss = signal.stopLossPercent || this.config.emergencyStopLoss;
    assessment.maxLoss = positionSize * stopLoss;
    
    // Check if risk exceeds tolerance
    if (assessment.maxLoss > this.config.maxRiskTolerance) {
      assessment.approved = false;
      assessment.vetoReason = `Max loss ${(assessment.maxLoss * 100).toFixed(2)}% exceeds tolerance ${(this.config.maxRiskTolerance * 100).toFixed(2)}%`;
    }
    
    assessment.riskScore = Math.min(1, riskScore);
    
    return assessment;
  }
  
  /**
   * Make final recommendation based on confidence and risk
   * Change 586: Fixed to handle SELL signals properly
   */
  makeRecommendation(confidence, riskAssessment, originalAction) {
    // Check if risk veto
    if (!riskAssessment.approved) {
      return 'HOLD';
    }

    // Change 598→2026-02-28: Honor minConfidenceOverride from config
    // Determine minimum confidence threshold:
    // 1) prefer explicit override from config (TRAI_MIN_CONF)
    // 2) fall back to TradingConfig centralized config
    // 3) default to 0.35 if nothing set
    const minConfidence =
      (this.config && typeof this.config.minConfidenceOverride === 'number'
        ? this.config.minConfidenceOverride
        : TradingConfig.get('confidence.minTradeConfidence', 0.50)) || 0.35;

    // Change 595: Simplified logic - trust the confidence threshold
    // If confidence exceeds threshold, approve the trade (unless vetoed by risk)
    // Risk veto only triggers for extremely high risk (>80%), already checked above

    if (confidence >= minConfidence) {
      // CHANGE 614: Fix case-sensitivity bug - normalize to lowercase
      const originalActionLower = (originalAction || '').toString().toLowerCase();
      // Return the original action - let confidence threshold be the gate
      if (originalActionLower === 'sell') {
        return confidence >= 0.7 ? 'STRONG_SELL' : 'SELL';
      } else if (originalActionLower === 'buy') {
        return confidence >= 0.7 ? 'STRONG_BUY' : 'BUY';
      } else {
        return originalAction; // HOLD if that's what was passed
      }
    }

    // Below threshold = hold
    return 'HOLD';
  }
  
  /**
   * Check for veto conditions
   */
  checkVetoConditions(riskAssessment) {
    // Veto if risk is too high
    if (riskAssessment.riskScore > 0.8) {
      riskAssessment.vetoReason = 'Risk score exceeds safety threshold';
      return true;
    }
    
    // Veto if max loss exceeds emergency stop
    if (riskAssessment.maxLoss > this.config.emergencyStopLoss) {
      riskAssessment.vetoReason = 'Potential loss exceeds emergency stop';
      return true;
    }
    
    // Veto if too many risk factors
    if (riskAssessment.factors.length >= 3) {
      riskAssessment.vetoReason = 'Too many risk factors present';
      return true;
    }
    
    return false;
  }
  
  /**
   * Generate reasoning using LLM
   */
  async generateReasoning(signal, context, decision) {
    if (!this.traiCore) {
      return this.generateRuleBasedReasoning(decision, context);
    }
    
    try {
      const prompt = `BTC ${signal.action} ${(signal.confidence * 100).toFixed(0)}%, RSI ${context.indicators?.rsi?.toFixed(0) || 'N/A'}, ${context.trend || 'sideways'} trend.

Why ${decision.traiRecommendation}? Answer in ONE sentence (max 15 words). State the KEY reason only.`;
      
      const response = await this.traiCore.generateIntelligentResponse(prompt, {
        context: 'trading_decision',
        priority: 'high'
      });
      
      return response;
      
    } catch (error) {
      console.error('⚠️ [TRAI] LLM reasoning failed:', error.message);
      return this.generateRuleBasedReasoning(decision, context);
    }
  }
  
  /**
   * Generate rule-based reasoning with market context
   */
  generateRuleBasedReasoning(decision, context = {}) {
    const confidence = (decision.finalConfidence * 100).toFixed(1);
    const risk = (decision.riskAssessment.riskScore * 100).toFixed(1);
    const original = (decision.originalConfidence * 100).toFixed(1);
    const traiBoost = (decision.traiConfidence * 100).toFixed(1);

    if (decision.vetoApplied) {
      return `Trade vetoed: ${decision.riskAssessment.vetoReason}`;
    }

    // Build context string
    let contextStr = '';
    if (context.indicators) {
      const rsi = context.indicators.rsi?.toFixed(1) || '?';
      const trend = context.trend || 'unknown';
      const vol = context.volatility?.toFixed(3) || '?';
      contextStr = ` Market: RSI ${rsi}, ${trend} trend, ${vol} volatility.`;
    }

    if (decision.traiRecommendation === 'STRONG_BUY') {
      return `Strong buy signal: ${original}% base → ${confidence}% final (TRAI +${traiBoost}%). Risk: ${risk}%. Excellent pattern alignment.${contextStr}`;
    }

    if (decision.traiRecommendation === 'BUY') {
      return `Buy signal: ${original}% base → ${confidence}% final (TRAI +${traiBoost}%). Risk: ${risk}%. Favorable conditions detected.${contextStr}`;
    }

    if (decision.traiRecommendation === 'SELL') {
      return `Sell signal: ${original}% base → ${confidence}% final (TRAI +${traiBoost}%). Risk: ${risk}%. Bearish conditions detected.${contextStr}`;
    }

    return `Holding: ${confidence}% confidence (base ${original}%, TRAI ${traiBoost}%), ${risk}% risk. Waiting for clearer setup.${contextStr}`;
  }
  
  /**
   * Calculate position adjustments
   */
  calculateAdjustments(confidence, riskAssessment) {
    const adjustments = [];
    
    // Position size adjustment based on confidence
    if (confidence > 0.8) {
      adjustments.push({
        type: 'position_size',
        factor: 1.2,
        reason: 'High confidence'
      });
    } else if (confidence < 0.6) {
      adjustments.push({
        type: 'position_size',
        factor: 0.8,
        reason: 'Lower confidence'
      });
    }
    
    // Stop loss adjustment based on risk
    if (riskAssessment.riskScore > 0.5) {
      adjustments.push({
        type: 'stop_loss',
        factor: 0.8, // Tighter stop
        reason: 'Higher risk environment'
      });
    }
    
    // Take profit adjustment based on volatility
    if (riskAssessment.factors.includes('low_liquidity_hours')) {
      adjustments.push({
        type: 'take_profit',
        factor: 0.7, // Lower target
        reason: 'Low liquidity period'
      });
    }
    
    return adjustments;
  }
  
  /**
   * Generate pattern key for memory
   */
  generatePatternKey(signal, context) {
    const patterns = (signal.patterns || []).map(p => p.name || p).sort().join(',');
    const regime = context.regime || 'unknown';
    const trend = context.trend || 'neutral';
    return `${patterns}_${regime}_${trend}`;
  }
  
  /**
   * Store decision for learning
   */
  storeDecision(decision, signal, context) {
    const entry = {
      timestamp: Date.now(),
      decision: decision,
      signal: signal,
      context: context,
      outcome: null // Will be updated after trade completes
    };
    
    this.decisionHistory.push(entry);
    
    // Keep only last 1000 decisions
    if (this.decisionHistory.length > 1000) {
      this.decisionHistory.shift();
    }
    
    // Store pattern for learning
    const patternKey = this.generatePatternKey(signal, context);
    if (!this.patternMemory.has(patternKey)) {
      this.patternMemory.set(patternKey, {
        samples: 0,
        successes: 0,
        failures: 0
      });
    }
  }
  
  /**
   * Update decision outcome (called after trade completes)
   */
  updateOutcome(decisionId, outcome) {
    const decision = this.decisionHistory.find(d => 
      d.timestamp === decisionId || d.decision.id === decisionId
    );
    
    if (decision) {
      decision.outcome = outcome;
      
      // Update pattern memory
      const patternKey = this.generatePatternKey(decision.signal, decision.context);
      const memory = this.patternMemory.get(patternKey);
      
      if (memory) {
        memory.samples++;
        if (outcome.profitable) {
          memory.successes++;
          this.state.successfulTrades++;
        } else {
          memory.failures++;
          this.state.failedTrades++;
        }
      }
    }
  }
  
  /**
   * Log decision for audit trail (JSONL telemetry)
   * Schema: tsMs, type, decisionId, cycleId, input (sanitized), output, meta
   */
  logDecision(decision, signal, context) {
    if (!this.config.trackDecisions) return;

    // Detect trading mode (no secrets exposure)
    const tradingMode = process.env.BACKTEST_MODE === 'true' ? 'backtest' :
                        (process.env.TRADING_MODE === 'live' || process.env.ENABLE_LIVE_TRADING === 'true') ? 'live' : 'paper';

    const telemetry = {
      tsMs: Date.now(),
      type: "trai_decision",
      decisionId: decision.id,
      cycleId: this.state?.totalDecisions ?? null,

      // Sanitized input - NO secrets, NO full env dumps
      input: {
        symbol: signal?.symbol || 'BTC-USD',
        timeframe: signal?.timeframe || '1m',
        action: signal?.action,
        originalConfidence: decision.originalConfidence,
        regime: context?.regime || null,
        trend: context?.trend || null,
        volatility: context?.volatility || null,
        indicators: {
          rsi: context?.indicators?.rsi || null,
          macd: context?.indicators?.macd || null,
          macdHistogram: context?.indicators?.macdHistogram || null
        },
        patternIds: (signal?.patterns || []).map(p => p.id || p.name || p).slice(0, 5),
        riskFlags: decision.riskAssessment?.factors || []
      },

      output: {
        decision: decision.traiRecommendation,
        confidence: decision.finalConfidence,
        traiConfidence: decision.traiConfidence,
        reasonSummary: (decision.reasoning || '').slice(0, 200),
        vetoApplied: decision.vetoApplied,
        riskScore: decision.riskAssessment?.riskScore || null,
        chosenPatternIds: (decision.adjustments || []).map(a => a.type).slice(0, 5),
        intendedOrderParams: decision.traiRecommendation !== 'HOLD' ? {
          direction: decision.traiRecommendation.includes('BUY') ? 'buy' : 'sell',
          confidenceGate: decision.finalConfidence
        } : null
      },

      meta: {
        version: VERSION_HASH,
        adapterId: 'kraken',
        brokerId: process.env.BOT_TIER || 'quantum',
        mode: tradingMode,
        traiMode: this.config.mode,
        latencyMs: decision.processingTime
      }
    };

    // Async fire-and-forget JSONL append (silent failure)
    fs.appendFile(
      this.config.logPath,
      JSON.stringify(telemetry) + "\n",
      () => {} // Ignore errors
    );
  }
  
  /**
   * Get current statistics
   */
  getStats() {
    const successRate = this.state.successfulTrades / 
      (this.state.successfulTrades + this.state.failedTrades) || 0;
    
    return {
      totalDecisions: this.state.totalDecisions,
      overrides: this.state.overrides,
      vetoes: this.state.vetoes,
      successRate: successRate,
      successfulTrades: this.state.successfulTrades,
      failedTrades: this.state.failedTrades,
      mode: this.config.mode
    };
  }
  
  /**
   * Update configuration dynamically
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log(`🤖 [TRAI] Configuration updated:`, newConfig);
  }

  /**
   * Record trade result for TRAI pattern memory learning
   * Call this when a trade closes to let TRAI learn from the outcome
   *
   * @param {Object} tradeData - Complete trade data including entry, exit, and P&L
   * @example
   * {
   *   entry: {
   *     timestamp: '2025-11-22T10:30:00.000Z',
   *     price: 42000,
   *     indicators: { rsi: 45, macd: 0.002, ... },
   *     trend: 'up',
   *     volatility: 0.025
   *   },
   *   exit: {
   *     timestamp: '2025-11-22T11:00:00.000Z',
   *     price: 42500,
   *     reason: 'take_profit'
   *   },
   *   profitLoss: 500,
   *   profitLossPercent: 1.19,
   *   holdDuration: 1800000  // 30 minutes in ms
   * }
   */
  recordTradeOutcome(tradeData) {
    if (!this.traiCore) {
      console.log('⚠️ [TRAI] Cannot record trade - TRAI Core not initialized');
      return;
    }

    try {
      this.traiCore.recordTradeResult(tradeData);
      console.log(`📚 [TRAI] Recorded trade outcome: ${tradeData.profitLoss > 0 ? 'WIN' : 'LOSS'} (${tradeData.profitLossPercent.toFixed(2)}%)`);
    } catch (error) {
      console.error('❌ [TRAI] Error recording trade outcome:', error.message);
    }
  }

  /**
   * Get TRAI's memory statistics
   * Shows how many patterns TRAI has learned, win rates, etc.
   */
  getMemoryStats() {
    if (!this.traiCore) {
      return {
        enabled: false,
        message: 'TRAI Core not initialized'
      };
    }

    return this.traiCore.getMemoryStats();
  }

  /**
   * Prune old patterns from TRAI's memory
   * Call periodically to remove patterns that haven't been seen in 90 days
   */
  pruneOldPatterns() {
    if (!this.traiCore) {
      return 0;
    }

    return this.traiCore.pruneOldMemories();
  }
}

module.exports = TRAIDecisionModule;
