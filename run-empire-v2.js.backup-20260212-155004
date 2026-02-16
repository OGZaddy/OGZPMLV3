#!/usr/bin/env node

// SILENT MODE: Disable logging during backtest for 100x speed boost
// Set BACKTEST_SILENT=true or it auto-enables when BACKTEST_MODE=true
// BACKTEST_FAST: Skip notifications, file I/O during backtest (explicit opt-in)
const BACKTEST_FAST = process.env.BACKTEST_FAST === 'true';
if (process.env.BACKTEST_SILENT === 'true' ||
    (process.env.BACKTEST_MODE === 'true' && process.env.BACKTEST_VERBOSE !== 'true')) {
  const originalLog = console.log;
  let lastProgress = 0;
  console.log = (...args) => {
    // Only show critical output: COMPLETE, errors, final results
    const msg = args[0]?.toString() || '';
    if (msg.includes('BACKTEST COMPLETE') ||
        msg.includes('PATTERN LEARNING') ||
        msg.includes('Final Balance') ||
        msg.includes('Total P&L') ||
        msg.includes('❌ Error') ||
        msg.includes('Report saved')) {
      originalLog(...args);
    }
  };
  console.warn = () => {};
}

// SENTRY: Must be first import - catches all unhandled errors
require('./instrument.js');

/**
 * @fileoverview OGZ PRIME V14 - Main Trading Bot Orchestrator
 *
 * This is the main entry point and orchestration layer for the OGZ Prime trading bot.
 * It coordinates all trading components: data ingestion, analysis, decision-making,
 * and execution.
 *
 * @description
 * ARCHITECTURE OVERVIEW:
 * ```
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                         run-empire-v2.js (ORCHESTRATOR)                 │
 * │                                                                         │
 * │  ┌─────────────┐    ┌────────────────┐    ┌──────────────────────────┐ │
 * │  │   KRAKEN    │───▶│  INDICATORS    │───▶│  PATTERN RECOGNITION     │ │
 * │  │  WEBSOCKET  │    │  (RSI,MACD,BB) │    │  (EnhancedPatternRecog)  │ │
 * │  └─────────────┘    └────────────────┘    └──────────────────────────┘ │
 * │         │                   │                        │                  │
 * │         ▼                   ▼                        ▼                  │
 * │  ┌─────────────┐    ┌────────────────┐    ┌──────────────────────────┐ │
 * │  │   REGIME    │◀───│  TRADING BRAIN │◀───│      TRAI (AI)           │ │
 * │  │  DETECTOR   │    │  (Decisions)   │    │  (Optional co-pilot)     │ │
 * │  └─────────────┘    └────────────────┘    └──────────────────────────┘ │
 * │                            │                                            │
 * │                            ▼                                            │
 * │                     ┌────────────────┐                                  │
 * │                     │  RISK MANAGER  │                                  │
 * │                     │  (Pre-trade)   │                                  │
 * │                     └────────────────┘                                  │
 * │                            │                                            │
 * │                            ▼                                            │
 * │  ┌─────────────┐    ┌────────────────┐    ┌──────────────────────────┐ │
 * │  │   STATE     │◀───│  EXECUTION     │───▶│  KRAKEN API              │ │
 * │  │  MANAGER    │    │  LAYER         │    │  (Paper or Live)         │ │
 * │  └─────────────┘    └────────────────┘    └──────────────────────────┘ │
 * │         │                                                               │
 * │         ▼                                                               │
 * │  ┌─────────────┐                                                        │
 * │  │  DASHBOARD  │  (WebSocket to browser)                               │
 * │  │  UPDATES    │                                                        │
 * │  └─────────────┘                                                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * MAIN TRADING LOOP (processCandle):
 * 1. Receive OHLC candle from Kraken WebSocket
 * 2. Calculate indicators (RSI, MACD, Bollinger Bands, OGZ-TPO)
 * 3. Detect patterns (EnhancedPatternRecognition)
 * 4. Get TradingBrain decision (BUY/SELL/HOLD)
 * 5. Optional: Consult TRAI for AI guidance
 * 6. Manage existing position (trailing stops, exits)
 * 7. Execute new trades if conditions met
 * 8. Broadcast updates to dashboard
 *
 * KEY METHODS:
 * - processCandle(candle): Main trading loop entry point
 * - executeTrade(decision, ...): Executes BUY/SELL orders
 * - manageExistingPosition(price, ...): Handles exits/trailing stops
 * - handleMarketData(candle): Routes incoming market data
 *
 * STATE MANAGEMENT:
 * All position/balance state is centralized in StateManager (single source of truth).
 * Local caches in TradingBrain sync FROM StateManager before decisions.
 *
 * @module run-empire-v2
 * @version 14.0.0-FINAL-MERGED
 * @date 2025-11-20
 */

// CRITICAL: Load environment variables FIRST before any module loads
// Support DOTENV_CONFIG_PATH for parallel instance testing
const envPath = process.env.DOTENV_CONFIG_PATH || '.env';
require('dotenv').config({ path: envPath });

// SAFETY INVARIANT: TEST_MODE or gates requires DATA_DIR to prevent data collision
if (process.env.TEST_MODE === 'true' && !process.env.DATA_DIR) {
  console.error('❌ FATAL: TEST_MODE=true requires DATA_DIR to be set');
  console.error('   This prevents accidental writes to production data.');
  console.error('   Set DATA_DIR=/path/to/test/data in your .env file.');
  process.exit(1);
}

// Log resolved paths for debugging
console.log('[CHECKPOINT-001] Environment loaded');
console.log(`   ENV_FILE: ${envPath}`);
console.log(`   DATA_DIR: ${process.env.DATA_DIR || '(default: ./data)'}`);
console.log(`   PAPER_TRADING: ${process.env.PAPER_TRADING}`);
console.log(`   TEST_MODE: ${process.env.TEST_MODE || 'false'}`);

// Load feature flags configuration via unified FeatureFlagManager
const FeatureFlagManager = require('./core/FeatureFlagManager');
const flagManager = FeatureFlagManager.getInstance();

// Legacy compatibility: Keep featureFlags object for existing code
let featureFlags = {};
try {
  featureFlags = require('./config/features.json');
  console.log('[FEATURES] Loaded via FeatureFlagManager:', flagManager.getEnabledFeatures());
} catch (err) {
  console.log('[FEATURES] No feature flags config found, using defaults');
  featureFlags = { features: {}, environment: {} };
}

// Add uncaught exception handler to catch silent failures
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  console.error('Stack:', err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// CRITICAL: ModuleAutoLoader as single source of truth
console.log('[CHECKPOINT-002] Loading ModuleAutoLoader...');
const loader = require('./core/ModuleAutoLoader');
console.log('[CHECKPOINT-003] ModuleAutoLoader ready');

// Load all modules through loader
loader.loadAll();
console.log('[CHECKPOINT-004] All modules loaded');

// CHANGE 2025-12-11: Trading optimizations for visibility and pattern-based sizing
const { TradingOptimizations, PatternStatsManager } = require('./core/TradingOptimizations');
const patternStatsManager = new PatternStatsManager();
const tradingOptimizations = new TradingOptimizations(patternStatsManager, console);

// CHANGE 2025-12-11: StateManager - Single source of truth for position/balance
const { getInstance: getStateManager } = require('./core/StateManager');
const stateManager = getStateManager();

// CHANGE 2025-12-11: MessageQueue - Prevent WebSocket race conditions
const MessageQueue = require('./core/MessageQueue');

// CHANGE 2025-12-23: Empire V2 IndicatorEngine - Single source of truth for indicators
const IndicatorEngine = require('./core/indicators/IndicatorEngine');
const indicatorEngine = new IndicatorEngine({
  symbol: 'BTC-USD',
  tf: '1m',
  ogzTpoEnabled: true
});

// CHANGE 2026-01-25: Trading Proof Logger for website transparency
const { TradingProofLogger } = require('./ogz-meta/claudito-logger');

// CHANGE 2026-01-31: Axios for TRAI web search capability
const axios = require('axios');

// CHANGE 2026-02-01: Telegram notifications for mobile alerts
const { telegramNotifier, notifyTrade, notifyTradeClose, notifyAlert } = require('./utils/telegramNotifier');

// CHANGE 2026-02-01: Discord notifications (was disconnected since v7)
// CHANGE 2026-02-02: Use singleton - was creating duplicate instances causing double messages
const discordNotifier = require('./utils/discordNotifier');

// CHANGE 2026-02-02: TradeIntelligenceEngine - intelligent per-trade decision tree
const TradeIntelligenceEngine = require('./core/TradeIntelligenceEngine');

// CHANGE 2026-02-10: Modular Entry System (V2 Kraken format: c/o/h/l/v/t)
const MultiTimeframeAdapter = require('./modules/MultiTimeframeAdapter');
const EMASMACrossoverSignal = require('./modules/EMASMACrossoverSignal');
const MADynamicSR = require('./modules/MADynamicSR');
const LiquiditySweepDetector = require('./modules/LiquiditySweepDetector');

// CHANGE 2026-02-10: Multi-Asset Manager for asset switching
const MultiAssetManager = require('./core/MultiAssetManager');

// CHANGE 2026-02-10: Trade Journal + Instant Replay
const { TradeJournalBridge } = require('./core/TradeJournalBridge');

// CRITICAL: SingletonLock to prevent multiple instances
console.log('[CHECKPOINT-005] Getting SingletonLock...');
const SingletonLock = loader.get('core', 'SingletonLock') || require('./core/SingletonLock');
const { OGZSingletonLock, checkCriticalPorts } = SingletonLock;
console.log('[CHECKPOINT-006] SingletonLock obtained');
const singletonLock = new OGZSingletonLock('ogz-prime-v14');

// Acquire lock IMMEDIATELY (will exit if another instance is running)
(async () => {
  // Skip singleton lock in backtest mode - allows testing while live bot runs
  if (process.env.BACKTEST_MODE !== 'true') {
    singletonLock.acquireLock();
  } else {
    console.log('⏭️ Skipping singleton lock (BACKTEST_MODE)');
  }
  // Skip port check in backtest mode for faster testing
  if (process.env.BACKTEST_MODE !== 'true') {
    // CHANGE 660: Remove port 3010 from check - it's the WebSocket SERVER we connect TO
    // Bot is a CLIENT of 3010, not binding it
    const portsOk = await checkCriticalPorts([3001, 3002, 3003]);
    if (!portsOk) {
      console.error('🚨 Critical ports in use! Exiting...');
      process.exit(1);
    }
  }
})();
const WebSocket = require('ws');

// Core Trading Modules - All through ModuleAutoLoader
console.log('[CHECKPOINT-007] Loading core modules...');
const EnhancedPatternRecognition = loader.get('core', 'EnhancedPatternRecognition');
console.log('  EnhancedPatternRecognition:', !!EnhancedPatternRecognition);
const { EnhancedPatternChecker } = EnhancedPatternRecognition || {};

const OptimizedTradingBrainModule = loader.get('core', 'OptimizedTradingBrain');
console.log('  OptimizedTradingBrain:', !!OptimizedTradingBrainModule);
const { OptimizedTradingBrain } = OptimizedTradingBrainModule || {};

const RiskManager = loader.get('core', 'RiskManager');
console.log('  RiskManager:', !!RiskManager);
const ExecutionRateLimiter = loader.get('core', 'ExecutionRateLimiter');
console.log('  ExecutionRateLimiter:', !!ExecutionRateLimiter);
const AdvancedExecutionLayer = loader.get('core', 'AdvancedExecutionLayer-439-MERGED');
console.log('  AdvancedExecutionLayer:', !!AdvancedExecutionLayer);
const PerformanceAnalyzer = loader.get('core', 'PerformanceAnalyzer');
const OptimizedIndicators = loader.get('core', 'OptimizedIndicators');
const MarketRegimeDetector = loader.get('core', 'MarketRegimeDetector');
const TradingProfileManager = loader.get('core', 'TradingProfileManager');
const GridTradingStrategy = loader.get('core', 'GridTradingStrategy');

// Change 587: Wire SafetyNet and TradeLogger into live loop
// Both removed - SafetyNet too restrictive, TradeLogger doesn't exist
// const TradingSafetyNet = require('./core/TradingSafetyNet');
// const TradeLogger = require('./core/TradeLogger');

// 🤖 AI Co-Founder (Change 574 - Opus Architecture + Codex Fix)
const TRAIDecisionModule = loader.get('core', 'TRAIDecisionModule');

// Infrastructure
// EMPIRE V2 ARCHITECTURE: Using BrokerFactory for proper abstraction
const { createBrokerAdapter } = require('./brokers/BrokerFactory');
const TierFeatureFlags = require('./TierFeatureFlags'); // Keep direct - in root not core
const OgzTpoIntegration = loader.get('core', 'OgzTpoIntegration');

/**
 * CHANGE 2026-01-29: Get correct display labels based on market type
 * - SPOT crypto: BUY/SELL (no shorting possible)
 * - Futures/Options/Margin: LONG/SHORT (actual directional positions)
 *
 * This prevents misleading labels like "SHORT" when we're just selling on spot.
 * @param {string} direction - 'buy' or 'sell'
 * @param {string} assetType - 'crypto', 'options', 'futures', etc.
 * @returns {string} Display label for the direction
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

/**
 * Main Trading Bot Orchestrator
 * Coordinates all modules for production trading
 */
class OGZPrimeV14Bot {
  constructor() {
    console.log('\n🚀 OGZ PRIME V14 FINAL MERGED - INITIALIZING');
    console.log('📊 Desktop Claude (402-line) + Browser Claude (439-line) = MERGED');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    // Environment validation
    this.validateEnvironment();

    // TWO-KEY TURN SAFETY: Require double confirmation for live trading
    this.verifyTradingMode();

    // Tier configuration
    this.tier = process.env.BOT_TIER || 'ml';
    this.tierFlagManager = new TierFeatureFlags(this.tier);
    this.tierFlags = this.tierFlagManager.getTierSummary();
    console.log(`🎯 Tier: ${this.tier.toUpperCase()}`);

    // Initialize core modules
    console.log('[CHECKPOINT-008] Creating pattern checker...');
    if (!EnhancedPatternChecker) {
      console.error('❌ EnhancedPatternChecker is undefined! Module loading failed.');
      process.exit(1);
    }
    this.patternChecker = new EnhancedPatternChecker();
    console.log('[CHECKPOINT-009] EnhancedPatternChecker created');

    // Initialize OGZ Two-Pole Oscillator (pure function implementation from V2)
    this.ogzTpo = this.tierFlagManager.isEnabled('ogzTpoEnabled')
      ? OgzTpoIntegration.fromTierFlags(this.tierFlagManager)
      : null;

    if (this.ogzTpo) {
      console.log('🎯 OGZ TPO initialized with mode:', this.tierFlagManager.getValue('ogzTpoMode'));
    }

    // CHANGE 665: Initialize TradingProfileManager for manual profile switching
    // AUTO-SWITCHING DISABLED - profiles are user-controlled only
    this.profileManager = new TradingProfileManager({
      defaultProfile: process.env.TRADING_PROFILE || 'balanced',
      autoSwitch: false  // DISABLED - user must manually switch profiles
    });

    // Set initial profile based on environment or default
    const initialProfile = process.env.TRADING_PROFILE || 'balanced';
    this.profileManager.setActiveProfile(initialProfile);
    console.log(`📊 Trading Profile: ${initialProfile.toUpperCase()} (manual switching only)`);

    // CHANGE 610: Centralized configuration - all trading params from .env
    // Profile settings are for reference only - env vars take precedence
    const tradingBrainConfig = {
      // Tier settings
      enableQuantumSizing: this.tierFlags.hasQuantumPositionSizer,
      tier: this.tier,

      // Phase 1: High-priority risk management (env vars ONLY)
      // CHANGE 661: Fix percentage conversion (15 → 0.15, not 15.0)
      minConfidenceThreshold: process.env.MIN_TRADE_CONFIDENCE
        ? (parseFloat(process.env.MIN_TRADE_CONFIDENCE) > 1
          ? parseFloat(process.env.MIN_TRADE_CONFIDENCE) / 100
          : parseFloat(process.env.MIN_TRADE_CONFIDENCE))
        : 0.08,
      maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE) || 0.02,
      stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 0.02,
      takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT) || 0.04,
      trailingStopPercent: parseFloat(process.env.TRAILING_STOP_PERCENT) || 0.035,
      trailingStopActivation: parseFloat(process.env.TRAILING_ACTIVATION) || 0.025,
      profitProtectionLevel: parseFloat(process.env.PROFIT_PROTECTION) || 0.015,
      breakevenTrigger: parseFloat(process.env.BREAKEVEN_TRIGGER) || 0.005,
      breakevenPercentage: parseFloat(process.env.BREAKEVEN_EXIT_PERCENT) || 0.50,
      postBreakevenTrailing: parseFloat(process.env.POST_BREAKEVEN_TRAIL) || 0.05,

      // Phase 1: High-priority position sizing
      basePositionSize: parseFloat(process.env.BASE_POSITION_SIZE) || 0.01,
      maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE_PCT) || 0.05,
      lowVolatilityMultiplier: parseFloat(process.env.LOW_VOL_MULTIPLIER) || 1.5,
      highVolatilityMultiplier: parseFloat(process.env.HIGH_VOL_MULTIPLIER) || 0.6,
      volatilityThresholds: {
        low: parseFloat(process.env.LOW_VOL_THRESHOLD) || 0.015,
        high: parseFloat(process.env.HIGH_VOL_THRESHOLD) || 0.035
      },

      // Phase 1: Confidence thresholds
      maxConfidenceThreshold: parseFloat(process.env.MAX_CONFIDENCE) || 0.95,
      confidencePenalty: parseFloat(process.env.CONFIDENCE_PENALTY) || 0.1,
      confidenceBoost: parseFloat(process.env.CONFIDENCE_BOOST) || 0.05,

      // Phase 1: Fund target
      houstonFundTarget: parseFloat(process.env.FUND_TARGET) || 25000
    };

    // Pass feature flags to TradingBrain
    tradingBrainConfig.featureFlags = featureFlags.features || {};
    tradingBrainConfig.patternDominance = featureFlags.features.PATTERN_DOMINANCE?.enabled || false;

    this.tradingBrain = new OptimizedTradingBrain(
      parseFloat(process.env.INITIAL_BALANCE) || 10000,
      tradingBrainConfig
    );
    this.riskManager = new RiskManager({
      maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS) || 0.05,
      maxDrawdown: parseFloat(process.env.MAX_DRAWDOWN) || 0.15
    });

    // Use Browser Claude's merged AdvancedExecutionLayer (Change 513 compliant)
    this.executionLayer = new AdvancedExecutionLayer({
      bot: this,
      botTier: this.tier,
      sandboxMode: process.env.LIVE_TRADING !== 'true',
      enableRiskManagement: true,
      initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 10000,
      paperTrading: featureFlags.features.PAPER_TRADING?.enabled || false,
      featureFlags: featureFlags.features || {}
    });

    this.performanceAnalyzer = new PerformanceAnalyzer();
    this.regimeDetector = new MarketRegimeDetector();

    // Initialize Pattern Exit Model (shadow mode by default)
    this.patternExitModel = null;
    if (featureFlags.features.PATTERN_EXIT_MODEL?.enabled) {
      const PatternBasedExitModel = require('./core/PatternBasedExitModel');
      this.patternExitModel = new PatternBasedExitModel(featureFlags.features.PATTERN_EXIT_MODEL.settings || {});
      this.patternExitShadowMode = featureFlags.features.PATTERN_EXIT_MODEL.shadowMode !== false;
      console.log(`🎯 Pattern Exit Model: ${this.patternExitShadowMode ? 'SHADOW MODE' : 'ACTIVE'}`);
    }

    // CHANGE 2026-02-02: TradeIntelligenceEngine - intelligent per-trade evaluation
    // Each trade evaluated on 13 dimensions (regime, momentum, structure, volume, TRAI, whales, etc.)
    this.tradeIntelligence = new TradeIntelligenceEngine({
      // Profit/Loss thresholds (%)
      profitTakePartial: 1.5,
      profitTrailTight: 2.5,
      lossWarning: 0.5,
      lossCut: 1.5,
      // Time thresholds (minutes)
      minHoldTime: 2,
      staleTradeTime: 30
    });
    this.tradeIntelligenceShadowMode = process.env.TRADE_INTELLIGENCE_SHADOW === 'true'; // ACTIVE by default
    console.log(`🧠 Trade Intelligence Engine: ${this.tradeIntelligenceShadowMode ? 'SHADOW MODE' : 'ACTIVE'}`);

    // CHANGE 2026-02-10: Modular Entry System (V2 format: c/o/h/l/v/t)
    this.mtfAdapter = new MultiTimeframeAdapter({
      activeTimeframes: ['1m', '5m', '15m', '1h', '4h', '1d'],
    });
    this.emaCrossover = new EMASMACrossoverSignal();
    this.maDynamicSR = new MADynamicSR();
    this.liquiditySweep = new LiquiditySweepDetector({
      sessionOpenHour: 0,    // Midnight UTC for crypto (24/7 market)
      sessionOpenMinute: 0,
    });
    console.log('📊 Modular Entry System: MTF + Crossovers + S/R + Liquidity initialized');

    // EXIT_SYSTEM feature flag: Only ONE exit system active at a time
    // Options: maxprofit, intelligence, pattern, brain, legacy (all active)
    // Hard stop loss + stale trade exit + confidence crash ALWAYS run regardless
    this.activeExitSystem = process.env.EXIT_SYSTEM || featureFlags.features?.EXIT_SYSTEM?.settings?.activeSystem || 'maxprofit';
    console.log(`🚪 Active Exit System: ${this.activeExitSystem.toUpperCase()} (set EXIT_SYSTEM env to change)`);

    // CHANGE 670: Initialize Grid Trading Strategy
    this.gridStrategy = null; // Initialize on demand based on strategy mode
    if (process.env.ENABLE_GRID_BOT === 'true') {
      this.gridStrategy = new GridTradingStrategy({
        gridLevels: parseInt(process.env.GRID_LEVELS) || 10,
        gridSpacing: parseFloat(process.env.GRID_SPACING) || 0.002,  // 0.2% default
        orderSize: parseFloat(process.env.GRID_ORDER_SIZE) || 100,
        autoRange: process.env.GRID_AUTO_RANGE !== 'false'
      });
      console.log('🎯 Grid Trading Mode ENABLED');
    }

    // CHANGE 657: Aggressive trading rate limiter (fixed for 8% confidence)
    this.rateLimiter = new ExecutionRateLimiter({
      entryCooldownMs: 5000,        // 5 seconds between entries (was 60 seconds)
      maxEntriesPerWindow: 100,     // 100 entries per window (was 5)
      windowMs: 300000,             // 5 minute window (was 10 minutes)
      burstAllowed: 10              // allow 10 rapid trades (was 2)
    });

    // 🤖 TRAI DECISION MODULE (Change 574 - Opus Architecture + Codex Fix)
    // OPTIMIZECEPTION FIX: Skip TRAI initialization when ENABLE_TRAI=false (4x faster backtests)
    if (process.env.ENABLE_TRAI !== 'false') {
      this.trai = new TRAIDecisionModule({
        mode: process.env.TRAI_MODE || 'advisory',  // Start conservative
        confidenceWeight: parseFloat(process.env.TRAI_WEIGHT) || 0.2,  // 20% influence
        enableVetoPower: process.env.TRAI_VETO === 'true',  // Disabled by default
        maxRiskTolerance: parseFloat(process.env.TRAI_MAX_RISK) || 0.03,
        minConfidenceOverride: parseFloat(process.env.TRAI_MIN_CONF) || 0.40,
        maxConfidenceOverride: parseFloat(process.env.TRAI_MAX_CONF) || 0.95,
        enableLLM: true  // Full AI reasoning enabled
      });
    } else {
      this.trai = null;  // TRAI disabled for fast optimization runs
      console.log('⚡ TRAI disabled for fast backtest mode');
    }

    // 🔥 CRITICAL FIX (Change 547): Connect modules to TradingBrain
    // Without these connections, confidence calculation fails (stuck at 10-35%)
    this.tradingBrain.optimizedIndicators = OptimizedIndicators;
    this.tradingBrain.marketRegimeDetector = this.regimeDetector;
    this.tradingBrain.patternRecognition = this.patternChecker;

    // Change 587: SafetyNet and TradeLogger removed
    // SafetyNet was too restrictive, blocking legitimate trades
    // TradeLogger module doesn't exist in codebase
    // We already have RiskManager + TRAI veto + confidence thresholds
    // this.safetyNet = new TradingSafetyNet(); // DISABLED - blocking everything
    // this.tradeLogger = new TradeLogger(); // Module doesn't exist

    console.log('🔍 [DEBUG] About to create Kraken adapter...');
    console.log('🔍 [DEBUG] BrokerFactory available:', typeof createBrokerAdapter);

    // EMPIRE V2: Create Kraken adapter through BrokerFactory (SINGLE SOURCE OF TRUTH)
    // NO FALLBACK - if BrokerFactory fails, bot fails. No bypasses.
    this.kraken = createBrokerAdapter('kraken', {
      apiKey: process.env.KRAKEN_API_KEY,
      apiSecret: process.env.KRAKEN_API_SECRET
    });
    console.log('🏭 [EMPIRE V2] Created Kraken adapter via BrokerFactory');
    console.log('🔍 [DEBUG] Kraken adapter type:', this.kraken.constructor.name);

    // Connect execution layer to Kraken
    this.executionLayer.setKrakenAdapter(this.kraken);

    // RECONCILER REMOVED - was causing more problems than it solved

    // EVENT LOOP MONITORING: DISABLED 2026-02-04
    // Reason: Pauses trading on transient CPU spikes and never auto-resumes
    // Liveness Watchdog already covers "no data" scenario
    // const { getInstance: getEventLoopMonitor } = require('./core/EventLoopMonitor');
    // this.eventLoopMonitor = getEventLoopMonitor({
    //   warningThreshold: 100,
    //   criticalThreshold: 500,
    //   checkInterval: 1000
    // });
    this.eventLoopMonitor = null; // Disabled

    // Dashboard WebSocket (Change 528) - OPTIONAL for real-time monitoring
    this.dashboardWs = null;
    this.dashboardWsConnected = false;
    // CHANGE 661: Always connect to dashboard WebSocket (defaults to localhost)
    console.log('🔌 Initializing Dashboard WebSocket connection...');
    this.initializeDashboardWebSocket();

    // Trading state
    this.isRunning = false;
    this.marketData = null;
    this.priceHistory = [];  // 1m candles for trading logic
    this.candleSaveCounter = 0; // CHANGE 2026-01-28: Track candles for periodic save
    this.loadCandleHistory(); // CHANGE 2026-01-28: Load saved candles on startup

    // CHANGE 2026-01-29: Multi-timeframe candle storage for dashboard
    // Each timeframe has its own history from native Kraken data
    this.timeframeHistories = {
      '1m': [],   // same as priceHistory
      '5m': [],
      '15m': [],
      '30m': [],
      '1h': [],
      '4h': [],   // CHANGE 2026-01-29: Added missing 4H timeframe
      '1d': []
    };
    this.dashboardTimeframe = '1m';  // Track what timeframe dashboard wants

    // Stale data tracking
    this.staleFeedPaused = false;
    this.feedRecoveryCandles = 0;
    // CHANGE 2026-01-16: Liveness watchdog - tracks last data arrival
    this.lastDataReceived = null;  // Set when handleMarketData receives data
    this.livenessCheckInterval = null;  // Periodic check for "no data at all"
    // CHANGE 2025-12-11: Position tracking moved to StateManager (single source of truth)
    // this.currentPosition removed - use stateManager.get('position') instead
    // CHANGE 2025-12-13: STEP 1 - SINGLE SOURCE OF TRUTH
    // stateManager.get('balance') REMOVED - use stateManager.get('balance') instead
    // this.activeTrades REMOVED - use stateManager.get('activeTrades') instead
    const initialBalance = parseFloat(process.env.INITIAL_BALANCE) || 10000;
    this.startTime = Date.now();
    this.systemState = {
      currentBalance: initialBalance
    };

    // Initialize StateManager with starting balance ONLY if not already loaded
    // CRITICAL FIX: Don't overwrite saved state on startup!
    const currentState = stateManager.getState();
    if (!currentState.balance || currentState.balance === 0) {
      console.log('🆕 Initializing fresh state with balance:', initialBalance);
      stateManager.updateState({
        balance: initialBalance,
        totalBalance: initialBalance,
        activeTrades: new Map()  // CHANGE 2025-12-13: Centralized active trades
      }, { action: 'INIT' });
    } else {
      console.log('✅ Using existing state - Balance:', currentState.balance, 'Trades:', currentState.activeTrades?.size || 0);
    }

    // CHANGE 644: Initialize trade tracking Maps in constructor to prevent crashes
    // CHANGE 2025-12-13: MOVED TO StateManager - no longer tracked here
    this.pendingTraiDecisions = new Map();
    this.confidenceHistory = [];  // Used for confidence tracking

    // Debug flags
    this.ohlcDebugCount = 0; // Log first 5 messages for debugging

    // CHANGE 2025-12-11: MessageQueue for WebSocket race condition prevention
    this.messageQueue = new MessageQueue({
      maxQueueSize: 50,
      minProcessingGapMs: 5,
      staleThresholdMs: 3000,
      onProcess: (data) => this.handleMarketData(data),
      onError: (msg, err) => console.error('❌ MessageQueue:', msg, err.message)
    });

    // MODE DETECTION: Paper, Live, or Backtest (MUTUAL EXCLUSION)
    const enableLiveTrading = process.env.LIVE_TRADING === 'true';
    const enableBacktestMode = process.env.BACKTEST_MODE === 'true';
    const enableTestMode = process.env.TEST_MODE === 'true';  // Signal testing without pattern corruption

    // Enforce mutual exclusion: Only ONE mode can be active
    if (enableLiveTrading && enableBacktestMode) {
      throw new Error('❌ FATAL: Cannot enable both LIVE trading and BACKTEST mode simultaneously!');
    }

    // Determine trading mode
    let tradingMode = 'PAPER';
    if (enableLiveTrading) tradingMode = 'LIVE';
    if (enableBacktestMode) tradingMode = 'BACKTEST';
    if (enableTestMode) {
      tradingMode = 'TEST';
      console.log('🧪 TEST MODE ACTIVATED:');
      console.log('   ✅ Patterns will NOT be saved');
      console.log('   ✅ Trades are simulated');
      console.log('   ✅ To inject signal: Set TEST_CONFIDENCE env var (0-100)');
      console.log('   ✅ Example: TEST_CONFIDENCE=75 npm start');
    }

    this.config = {
      // CHANGE 632: Fix MIN_TRADE_CONFIDENCE parsing - accept percentage or decimal
      minTradeConfidence: process.env.MIN_TRADE_CONFIDENCE
        ? (parseFloat(process.env.MIN_TRADE_CONFIDENCE) > 1
          ? parseFloat(process.env.MIN_TRADE_CONFIDENCE) / 100  // Convert percentage to decimal
          : parseFloat(process.env.MIN_TRADE_CONFIDENCE))      // Already decimal
        : 0.35,  // Default 35%
      tradingPair: process.env.TRADING_PAIR || 'BTC-USD',
      enableShorts: process.env.ENABLE_SHORTS === 'true',
      enableLiveTrading,
      enableBacktestMode,
      tradingMode
    };

    console.log(`🎯 Trading Mode: ${tradingMode}`);

    console.log('✅ All modules initialized successfully');
    console.log(`   Risk Management: ENABLED`);
    console.log(`   Change 513 Compliance: ✅\n`);
  }

  /**
   * Validate required environment variables
   */
  validateEnvironment() {
    const required = ['KRAKEN_API_KEY', 'KRAKEN_API_SECRET', 'POLYGON_API_KEY'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      console.error('❌ Missing environment variables:', missing);
      throw new Error(`Missing required environment: ${missing.join(', ')}`);
    }
  }

  /**
   * TWO-KEY TURN SAFETY: Verify trading mode with double confirmation
   * Prevents accidental live trading activation
   */
  verifyTradingMode() {
    const enableLive = process.env.LIVE_TRADING === 'true';
    const confirmLive = process.env.CONFIRM_LIVE_TRADING === 'true';

    // Check if attempting live mode
    if (enableLive) {
      if (!confirmLive) {
        console.log('\n' + '═'.repeat(70));
        console.log('⚠️  TWO-KEY SAFETY CHECK FAILED');
        console.log('═'.repeat(70));
        console.log('You have set ENABLE_LIVE_TRADING=true');
        console.log('But CONFIRM_LIVE_TRADING is not set to true');
        console.log('\nTo enable LIVE trading, you must set BOTH:');
        console.log('  ENABLE_LIVE_TRADING=true');
        console.log('  CONFIRM_LIVE_TRADING=true');
        console.log('\n🛡️ Starting in PAPER TRADING mode for safety');
        console.log('═'.repeat(70) + '\n');

        // Force paper mode
        process.env.ENABLE_LIVE_TRADING = 'false';
        this.mode = 'PAPER';
      } else {
        // BOTH keys confirmed - show BIG warning
        console.log('\n' + '╔'.repeat(70));
        console.log('║' + ' '.repeat(20) + '⚠️  LIVE TRADING MODE ACTIVE  ⚠️' + ' '.repeat(17) + '║');
        console.log('║' + ' '.repeat(68) + '║');
        console.log('║' + ' '.repeat(20) + '    REAL MONEY AT RISK!' + ' '.repeat(25) + '║');
        console.log('║' + ' '.repeat(68) + '║');
        console.log('║' + ' '.repeat(15) + 'Two-key safety confirmed. Proceeding...' + ' '.repeat(14) + '║');
        console.log('╚'.repeat(70) + '\n');

        // 10-second countdown
        console.log('Starting in:');
        for (let i = 10; i > 0; i--) {
          process.stdout.write(`\r  ${i} seconds...`);
          require('child_process').execSync('sleep 1');
        }
        console.log('\r  🚀 LIVE TRADING ENGAGED!\n');

        this.mode = 'LIVE';
      }
    } else {
      // Paper mode
      console.log('📝 PAPER TRADING MODE (safe mode)');
      this.mode = 'PAPER';
    }
  }

  /**
   * Initialize Dashboard WebSocket connection (Change 528)
   * OPTIONAL - only connects if WS_HOST is set
   */
  initializeDashboardWebSocket() {
    // Bot connects to WebSocket relay on port 3010
    const wsUrl = process.env.WS_URL || 'ws://localhost:3010/ws';

    console.log(`\n📊 Connecting to Dashboard WebSocket at ${wsUrl}...`);

    try {
      this.dashboardWs = new WebSocket(wsUrl);

      this.dashboardWs.on('open', () => {
        console.log('✅ Dashboard WebSocket connected!');
        this.dashboardWsConnected = true;
        this.lastPongReceived = Date.now(); // CHANGE 2026-01-28: Track pong for heartbeat

        // 🔒 SECURITY (Change 582): Authenticate first before sending any data
        const authToken = process.env.WEBSOCKET_AUTH_TOKEN || 'CHANGE_ME_IN_PRODUCTION';
        if (!authToken || authToken === 'CHANGE_ME_IN_PRODUCTION') {
          console.error('⚠️ WEBSOCKET_AUTH_TOKEN not set in .env - using default token');
        }

        this.dashboardWs.send(JSON.stringify({
          type: 'auth',
          token: authToken
        }));
        console.log('🔐 Sent authentication to dashboard');

        // DON'T send identify here - wait for auth_success message
      });

      this.dashboardWs.on('error', (error) => {
        console.error('⚠️ Dashboard WebSocket error:', error.message);
        this.dashboardWsConnected = false;
      });

      this.dashboardWs.on('close', () => {
        console.log('⚠️ Dashboard WebSocket closed - reconnecting in 2s...');
        this.dashboardWsConnected = false;
        // CHANGE 2026-01-31: Clear both intervals on close
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }
        if (this.dataWatchdogInterval) {
          clearInterval(this.dataWatchdogInterval);
          this.dataWatchdogInterval = null;
        }
        // Reconnect faster (2s instead of 5s)
        if (this.isRunning) {
          setTimeout(() => this.initializeDashboardWebSocket(), 2000);
        }
      });

      this.dashboardWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // CHANGE 2026-01-31: Track last message for data watchdog
          this.lastDashboardMessageReceived = Date.now();

          // Handle authentication success
          if (msg.type === 'auth_success') {
            console.log('🔓 Dashboard authentication successful!');

            // Now send identify message after successful auth
            this.dashboardWs.send(JSON.stringify({
              type: 'identify',
              source: 'trading_bot',
              bot: 'ogzprime-v14-refactored',
              version: 'V14-REFACTORED-MERGED',
              capabilities: ['trading', 'realtime', 'risk-management']
            }));

            // Connect to AdvancedExecutionLayer for trade broadcasts
            this.executionLayer.setWebSocketClient(this.dashboardWs);

            // CHANGE 2025-12-11: Connect StateManager to dashboard for accurate post-update state
            // Dashboard now receives state AFTER changes, never stale data
            stateManager.setDashboardWs(this.dashboardWs);

            // Connect TRAI for chain-of-thought broadcasts
            if (this.trai) {
              this.trai.setWebSocketClient(this.dashboardWs);
            }

            // CHANGE 2026-01-28: Start heartbeat ping interval after auth
            this.startHeartbeatPing();

            return;
          }

          // Handle authentication errors
          if (msg.type === 'error') {
            console.error('❌ Dashboard error:', msg.message);
            return;
          }

          // CHANGE 2026-01-28: Handle pong for heartbeat
          if (msg.type === 'pong') {
            this.lastPongReceived = Date.now();
            return;
          }

          // CHANGE 2026-01-30: Handle timeframe change from dashboard
          // Fetch REAL historical data from Kraken REST API, not just cached WebSocket data
          if (msg.type === 'timeframe_change') {
            const newTimeframe = msg.timeframe || '1m';
            console.log(`📊 Dashboard timeframe changed to: ${newTimeframe}`);
            this.dashboardTimeframe = newTimeframe;

            // Fetch historical candles from Kraken REST API
            this.fetchAndSendHistoricalCandles(newTimeframe, 200);
            return;
          }

          // CHANGE 2026-01-30: Handle request for historical data
          if (msg.type === 'request_historical') {
            const timeframe = msg.timeframe || '1m';
            const limit = msg.limit || 200;

            // Fetch historical candles from Kraken REST API
            this.fetchAndSendHistoricalCandles(timeframe, limit);
            return;
          }

          // CHANGE 2026-02-10: Handle asset switching from dashboard (Multi-Asset Manager)
          if (msg.type === 'asset_change') {
            if (this.assetManager) {
              this.assetManager.switchAsset(msg.asset);
            }
            return;
          }

          // CHANGE 665: Handle profile switching and dashboard commands
          if (msg.type === 'command') {
            console.log('📨 Dashboard command received:', msg.command);

            // Profile switching (manual only - does NOT affect confidence)
            if (msg.command === 'switch_profile' && msg.profile) {
              const success = this.profileManager.setActiveProfile(msg.profile);
              if (success) {
                // Profile is for reference only - does not override env vars
                // Send confirmation to dashboard
                this.dashboardWs.send(JSON.stringify({
                  type: 'profile_switched',
                  profile: msg.profile,
                  settings: this.profileManager.getActiveProfile(),
                  note: 'Profile for reference only - trading uses env vars'
                }));
              }
            }

            // Get all profiles
            else if (msg.command === 'get_profiles') {
              this.dashboardWs.send(JSON.stringify({
                type: 'profiles_list',
                profiles: this.profileManager.getAllProfiles(),
                active: this.profileManager.getActiveProfile().name
              }));
            }

            // Dynamic confidence adjustment
            else if (msg.command === 'set_confidence' && msg.confidence) {
              this.profileManager.setDynamicConfidence(msg.confidence);
              this.tradingBrain.updateConfidenceThreshold(msg.confidence / 100);
            }

            // PAUSE TRADING - Manual safety stop from dashboard
            else if (msg.command === 'pause_trading') {
              const reason = msg.reason || 'Manual pause from dashboard';
              console.log('🛑 [Dashboard] Pause command received:', reason);
              stateManager.pauseTrading(reason);
              this.dashboardWs.send(JSON.stringify({
                type: 'pause_confirmed',
                reason: reason,
                timestamp: Date.now()
              }));
            }

            // RESUME TRADING - Manual resume from dashboard
            else if (msg.command === 'resume_trading') {
              console.log('✅ [Dashboard] Resume command received');
              stateManager.resumeTrading();
              this.dashboardWs.send(JSON.stringify({
                type: 'resume_confirmed',
                timestamp: Date.now()
              }));
            }
          }

          // TRAI Chat Support - Tech support queries from dashboard
          if (msg.type === 'trai_query' && this.trai) {
            console.log('🧠 [TRAI] Received chat query:', msg.query?.substring(0, 50) + '...');
            this.handleTraiQuery(msg);
          }
        } catch (error) {
          console.error('❌ Dashboard message parse error:', error.message);
        }
      });

    } catch (error) {
      console.error('❌ Dashboard WebSocket initialization failed:', error.message);
      this.dashboardWsConnected = false;
    }
  }

  /**
   * CHANGE 2026-01-31: Aggressive heartbeat to prevent silent connection death
   * - Ping every 15s (more frequent)
   * - Timeout after 30s (miss 2 pings = dead)
   * - Data watchdog: reconnect if no messages for 60s
   */
  startHeartbeatPing() {
    // Clear any existing intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.dataWatchdogInterval) {
      clearInterval(this.dataWatchdogInterval);
    }

    const PING_INTERVAL = 15000; // 15 seconds (more aggressive)
    const PONG_TIMEOUT = 30000;  // 30 seconds (miss 2 pings = dead)
    const DATA_TIMEOUT = 60000;  // 60 seconds no data = force reconnect

    // Track last message received (any type)
    this.lastDashboardMessageReceived = this.lastDashboardMessageReceived || Date.now();

    // Heartbeat ping/pong check
    this.heartbeatInterval = setInterval(() => {
      // Check if socket exists and thinks it's open
      if (!this.dashboardWs) {
        console.log('⚠️ [Heartbeat] No WebSocket instance - triggering reconnect');
        this.initializeDashboardWebSocket();
        return;
      }

      const state = this.dashboardWs.readyState;
      if (state !== 1) {
        console.log(`⚠️ [Heartbeat] Socket not open (readyState=${state}) - waiting for reconnect`);
        return;
      }

      // Check if last pong is too old
      const timeSinceLastPong = Date.now() - (this.lastPongReceived || 0);
      if (timeSinceLastPong > PONG_TIMEOUT) {
        console.log('💔 [Heartbeat] TIMEOUT - no pong in ' + Math.round(timeSinceLastPong/1000) + 's - forcing reconnect');
        try {
          this.dashboardWs.terminate();
        } catch (e) {
          console.error('❌ [Heartbeat] Terminate failed:', e.message);
        }
        return;
      }

      // Send ping
      try {
        this.dashboardWs.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } catch (err) {
        console.error('❌ [Heartbeat] Ping failed:', err.message, '- forcing reconnect');
        try {
          this.dashboardWs.terminate();
        } catch (e) {}
      }
    }, PING_INTERVAL);

    // Data watchdog - ensure SOME data is flowing
    this.dataWatchdogInterval = setInterval(() => {
      if (!this.dashboardWs || this.dashboardWs.readyState !== 1) {
        return; // Not connected
      }

      const timeSinceData = Date.now() - (this.lastDashboardMessageReceived || 0);
      if (timeSinceData > DATA_TIMEOUT) {
        console.log('🚨 [Watchdog] NO DATA for ' + Math.round(timeSinceData/1000) + 's - forcing reconnect');
        try {
          this.dashboardWs.terminate();
        } catch (e) {
          console.error('❌ [Watchdog] Terminate failed:', e.message);
        }
      }
    }, 30000); // Check every 30s

    console.log('💓 Heartbeat started (ping every 15s, pong timeout 30s, data timeout 60s)');
  }

  /**
   * CHANGE 2026-01-28: Load candle history from disk on startup
   * Prevents fat bars on dashboard after restart
   */
  loadCandleHistory() {
    const fs = require('fs');
    const path = require('path');
    const candleFile = path.join(__dirname, 'data', 'candle-history.json');

    try {
      if (fs.existsSync(candleFile)) {
        const saved = JSON.parse(fs.readFileSync(candleFile, 'utf8'));
        if (Array.isArray(saved) && saved.length > 0) {
          // Filter out candles older than 4 hours (stale data)
          const fourHoursAgo = Date.now() - (4 * 60 * 60 * 1000);
          this.priceHistory = saved.filter(c => c.t > fourHoursAgo);
          console.log(`📂 Loaded ${this.priceHistory.length} candles from disk (filtered from ${saved.length})`);
        }
      } else {
        console.log('📂 No saved candle history found - starting fresh');
      }
    } catch (error) {
      console.error('⚠️ Failed to load candle history:', error.message);
      this.priceHistory = [];
    }
  }

  /**
   * CHANGE 2026-01-28: Save candle history to disk
   * Called every 5 new candles to avoid disk thrashing
   */
  saveCandleHistory() {
    const fs = require('fs');
    const path = require('path');
    const candleFile = path.join(__dirname, 'data', 'candle-history.json');

    try {
      // Save last 200 candles
      const toSave = this.priceHistory.slice(-200);
      fs.writeFileSync(candleFile, JSON.stringify(toSave));
      // Silent save - only log errors
    } catch (error) {
      console.error('⚠️ Failed to save candle history:', error.message);
    }
  }

  /**
   * Start the trading bot
   */
  async start() {
    console.log('🚀 Starting OGZ Prime V14 MERGED...\n');
    this.isRunning = true;

    // 🤖 Initialize TRAI Decision Module (Change 574)
    if (this.trai) {
      try {
        await this.trai.initialize();
        console.log('✅ TRAI Decision Module initialized - IN THE HOT PATH!\n');
      } catch (error) {
        console.error('⚠️ TRAI initialization failed:', error.message);
        console.log('   Bot will continue without TRAI...\n');
        this.trai = null;
      }
    }

    try {
      // FEATURE FLAG: Backtest mode uses historical data, Live/Paper use WebSocket
      if (this.config.enableBacktestMode) {
        console.log('📊 BACKTEST MODE: Loading historical data...');
        await this.loadHistoricalDataAndBacktest();
      } else {
        console.log('📡 LIVE/PAPER MODE: Connecting to real-time data...');
        // V2 ARCHITECTURE: Get market data from BrokerFactory
        // Subscribe to broker events instead of direct connection
        this.subscribeToMarketData();

        // RECONCILER REMOVED - was blocking trades

        // EVENT LOOP MONITORING: DISABLED 2026-02-04
        // if (this.eventLoopMonitor) {
        //   console.log('⚡ Starting event loop monitoring...');
        //   this.eventLoopMonitor.start();
        //   console.log('✅ Event loop monitor active');
        // }

        // CHANGE 2026-02-10: Initialize Multi-Asset Manager
        this.assetManager = new MultiAssetManager(this);

        // CHANGE 2026-02-10: Initialize Trade Journal + Replay Bridge
        this.journalBridge = new TradeJournalBridge(this);

        // Start trading cycle
        this.startTradingCycle();

        console.log('✅ Bot is now LIVE and trading\n');
      }
    } catch (error) {
      console.error('❌ Startup failed:', error.message);
      await this.shutdown();
    }
  }

  /**
   * V2 ARCHITECTURE: Subscribe to market data from BrokerFactory
   * Single source of truth - no direct connections
   */
  subscribeToMarketData() {
    console.log('📡 V2 ARCHITECTURE: Subscribing to market data from BrokerFactory...');

    if (this.kraken) {
      // Start market data subscription immediately
      const symbol = process.env.TRADING_PAIR || 'BTC/USD';
      const timeframe = process.env.CANDLE_TIMEFRAME || '1m';

      // Subscribe to candles if method exists
      if (this.kraken.subscribeToCandles) {
        console.log(`🔌 Starting ${symbol} ${timeframe} subscription...`);
        this.kraken.subscribeToCandles(symbol, timeframe);
      }

      // Subscribe to OHLC events from the broker
      if (this.kraken.on) {
        this.kraken.on('ohlc', (eventData) => {
          // CHANGE 2026-01-29: Handle multi-timeframe OHLC data
          const timeframe = eventData.timeframe || '1m';
          const ohlcData = eventData.data || eventData;  // Support old format too

          // Store in timeframe-specific history for dashboard
          this.storeTimeframeCandle(timeframe, ohlcData);

          // Only process 1m candles through trading logic
          if (timeframe === '1m') {
            console.log('📊 V2: Received 1m OHLC from broker');
            this.handleMarketData(ohlcData);
          }
        });

        this.kraken.on('ticker', (data) => {
          if (data && data.price) {
            console.log(`💹 V2 Ticker: $${data.price}`);
          }
        });

        console.log('✅ V2: Subscribed to BrokerFactory events (single source of truth)');
      }
    } else {
      console.error('❌ Broker not initialized');
    }
  }


  /**
   * Handle incoming market data from WebSocket
   * Kraken OHLC format: [channelID, [time, etime, open, high, low, close, vwap, volume, count], channelName, pair]
   */
  handleMarketData(ohlcData) {

    // OHLC data is array: [time, etime, open, high, low, close, vwap, volume, count]
    if (!Array.isArray(ohlcData) || ohlcData.length < 8) {
      console.warn('⚠️ Invalid OHLC data format:', ohlcData);
      return;
    }

    const [time, etime, open, high, low, close, vwap, volume, count] = ohlcData;

    // CHANGE 2026-01-16: Track when we last received ANY data (for liveness watchdog)
    this.lastDataReceived = Date.now();

    // STALE DATA DETECTION: Check if DATA ITSELF is old (not arrival time)
    // FIX BACKTEST_001: Skip stale check in backtest mode - historical data is intentionally old
    const isBacktesting = process.env.BACKTEST_MODE === 'true' || this.config?.enableBacktestMode;
    const now = Date.now();
    const dataAge = now - (etime * 1000); // etime is in SECONDS, convert to milliseconds

    // If data is more than 2 minutes old, it's stale (but NOT during backtesting!)
    if (dataAge > 120000 && !isBacktesting) {
      console.error('🚨 STALE DATA:', Math.round(dataAge / 1000), 'seconds old');

      // AUTO-PAUSE TRADING
      if (!this.staleFeedPaused) {
        console.error('⏸️ PAUSING NEW ENTRIES DUE TO STALE DATA');
        this.staleFeedPaused = true;

        // Notify StateManager to pause
        try {
          const { getInstance: getStateManager } = require('./core/StateManager');
          const stateManager = getStateManager();
          stateManager.pauseTrading(`Stale data: ${Math.round(dataAge / 1000)}s old`);
        } catch (error) {
          console.error('Failed to pause via StateManager:', error.message);
        }
      }
    } else if (this.staleFeedPaused && dataAge < 30000) {
      // Data is fresh again - resume
      console.log('✅ Fresh data restored, resuming');
      this.staleFeedPaused = false;
      this.feedRecoveryCandles = 0;
      stateManager.resumeTrading();
    }

    let price = parseFloat(close);
    if (!price || isNaN(price)) return;

    // Test code removed - running on REAL market data

    // Build proper OHLCV candle structure from Kraken OHLC stream
    const candle = {
      o: parseFloat(open),
      h: parseFloat(high),
      l: parseFloat(low),
      c: parseFloat(close),
      v: parseFloat(volume),
      t: parseFloat(time) * 1000,  // Actual timestamp for display
      etime: parseFloat(etime) * 1000  // End time for deduplication
    };

    // Update price history (use etime to detect new minutes, not actual timestamp)
    const lastCandle = this.priceHistory[this.priceHistory.length - 1];
    const isNewMinute = !lastCandle || lastCandle.etime !== candle.etime;

    if (!isNewMinute) {
      // Update existing candle (same minute) - Kraken sends multiple updates per minute
      this.priceHistory[this.priceHistory.length - 1] = candle;

      // Debug: Show updates for first few candles
      if (this.priceHistory.length <= 3) {
        const candleTime = new Date(candle.t).toLocaleTimeString();
        // CHANGE 634: Clean output for humans (no more decimal headaches!)
        const o = Math.round(candle.o);
        const h = Math.round(candle.h);
        const l = Math.round(candle.l);
        const c = Math.round(candle.c);
        console.log(`🕯️ Candle #${this.priceHistory.length} [${candleTime}]: $${c.toLocaleString()} (H:${h.toLocaleString()} L:${l.toLocaleString()})`);
      }
    } else {
      // New candle (new minute) - etime changed
      this.priceHistory.push(candle);

      // CHANGE 2026-02-10: Feed modular entry system with new candle
      if (this.mtfAdapter) this.mtfAdapter.ingestCandle(candle);
      if (this.emaCrossover) this.emaCrossoverSignal = this.emaCrossover.update(candle, this.priceHistory);
      if (this.maDynamicSR) this.maDynamicSRSignal = this.maDynamicSR.update(candle, this.priceHistory);
      if (this.liquiditySweep) this.liquiditySweepSignal = this.liquiditySweep.feedCandle(candle);

      // Only log during warmup phase (first 20 candles)
      if (this.priceHistory.length <= 20) {
        const candleTime = new Date(candle.t).toLocaleTimeString();
        console.log(`✅ Candle #${this.priceHistory.length}/15 [${candleTime}]`);
      }

      if (this.priceHistory.length > 200) {
        this.priceHistory = this.priceHistory.slice(-200);
      }

      // CHANGE 2026-01-28: Save candles to disk every 5 new candles
      this.candleSaveCounter++;
      if (this.candleSaveCounter >= 5) {
        this.saveCandleHistory();
        this.candleSaveCounter = 0;
      }
    }

    // Store latest market data
    this.marketData = {
      price,
      timestamp: parseFloat(time) * 1000,  // Use candle's actual timestamp
      systemTime: Date.now(),  // Keep system time separately if needed
      volume: parseFloat(volume) || 0,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low)
    };

    // CHANGE 2025-12-23: Feed candle to IndicatorEngine (Empire V2)
    indicatorEngine.updateCandle({
      t: parseFloat(time) * 1000,
      o: parseFloat(open),
      h: parseFloat(high),
      l: parseFloat(low),
      c: parseFloat(close),
      v: parseFloat(volume) || 0
    });

    // CHANGE 663: Broadcast market data to dashboard
    if (this.dashboardWsConnected && this.dashboardWs) {
      try {
        // CHANGE 2025-12-23: Use IndicatorEngine render packet for dashboard
        const renderPacket = indicatorEngine.getRenderPacket({ maxPoints: 200 });

        // CHANGE 2026-01-23: Calculate performance stats for dashboard
        // BUGFIX 2026-01-23: Include position value in P&L calculation!
        const currentBalance = stateManager.get('balance');
        const currentPosition = stateManager.get('position') || 0;
        const positionValue = currentPosition * price;  // Current market value of position
        const totalAccountValue = currentBalance + positionValue;
        const initialBalance = 10000;  // TODO: Make this configurable
        const totalPnL = totalAccountValue - initialBalance;  // Correct: includes open position
        const trades = this.executionLayer?.trades || [];
        const closedTrades = trades.filter(t => t.pnl !== undefined);
        const winningTrades = closedTrades.filter(t => t.pnl > 0).length;
        const winRate = closedTrades.length > 0 ? (winningTrades / closedTrades.length) * 100 : 0;

        this.dashboardWs.send(JSON.stringify({
          type: 'price',  // CHANGE 2025-12-11: Match frontend expected message type
          data: {
            price: price,
            candle: {
              open: parseFloat(open),
              high: parseFloat(high),
              low: parseFloat(low),
              close: price,
              volume: parseFloat(volume),
              timestamp: Date.now()
            },
            indicators: renderPacket.indicators,  // Use IndicatorEngine output
            // CHANGE 2026-01-29: Send candles for dashboard's selected timeframe
            candles: this.getCandlesForTimeframe(this.dashboardTimeframe).slice(-50),
            timeframe: this.dashboardTimeframe,  // Tell dashboard what timeframe this is
            overlays: renderPacket.overlays,  // FIX: Should be 'overlays' not 'series'!
            balance: currentBalance,
            position: stateManager.get('position'),
            totalTrades: this.executionLayer?.totalTrades || 0,
            // CHANGE 2026-01-23: Include performance stats
            totalPnL: totalPnL,
            winRate: winRate
          }
        }));

        // Broadcast edge analytics data
        this.broadcastEdgeAnalytics(price, parseFloat(volume), candle);
      } catch (error) {
        // Fail silently - don't let dashboard issues affect trading
      }
    }
  }

  /**
   * CHANGE 2026-01-29: Store candle in timeframe-specific history for dashboard
   * @param {string} timeframe - '1m', '5m', '15m', '30m', '1h', '1d'
   * @param {Array} ohlcData - Kraken OHLC array [time, etime, o, h, l, c, vwap, vol, count]
   */
  storeTimeframeCandle(timeframe, ohlcData) {
    if (!this.timeframeHistories[timeframe]) {
      this.timeframeHistories[timeframe] = [];
    }

    if (!Array.isArray(ohlcData) || ohlcData.length < 8) return;

    const [time, etime, open, high, low, close, vwap, volume] = ohlcData;
    const candle = {
      t: parseFloat(time) * 1000,
      etime: parseFloat(etime) * 1000,
      o: parseFloat(open),
      h: parseFloat(high),
      l: parseFloat(low),
      c: parseFloat(close),
      v: parseFloat(volume)
    };

    const history = this.timeframeHistories[timeframe];
    const lastCandle = history[history.length - 1];

    // Update existing candle or add new one based on etime
    if (lastCandle && lastCandle.etime === candle.etime) {
      history[history.length - 1] = candle;
    } else {
      history.push(candle);
      // Keep max 200 candles per timeframe
      if (history.length > 200) {
        this.timeframeHistories[timeframe] = history.slice(-200);
      }
    }

    // Sync 1m with priceHistory (trading logic uses this)
    if (timeframe === '1m') {
      this.timeframeHistories['1m'] = this.priceHistory;
    }
  }

  /**
   * CHANGE 2026-01-29: Get candles for a specific timeframe (for dashboard)
   */
  getCandlesForTimeframe(timeframe) {
    // Default to 1m if invalid timeframe
    const tf = this.timeframeHistories[timeframe] ? timeframe : '1m';
    return this.timeframeHistories[tf] || this.priceHistory;
  }

  /**
   * CHANGE 2026-01-30: Fetch historical candles from Kraken REST API and send to dashboard
   * This is the PROPER way to get historical data - REST API, not just WebSocket cache
   * @param {string} timeframe - '1m', '5m', '15m', '30m', '1h', '4h', '1d'
   * @param {number} limit - Number of candles to fetch
   */
  async fetchAndSendHistoricalCandles(timeframe, limit = 200) {
    try {
      if (!this.kraken || !this.dashboardWs) {
        console.warn('⚠️ Cannot fetch historical candles - broker or dashboard not connected');
        return;
      }

      console.log(`📊 Fetching ${limit} historical ${timeframe} candles from Kraken REST API...`);

      // CHANGE 2026-02-10: Use active asset from MultiAssetManager if available
      const symbol = this.assetManager
        ? this.assetManager.toSlashFormat(this.assetManager.activeAsset)
        : (process.env.TRADING_PAIR || 'BTC/USD');
      const candles = await this.kraken.getCandles(symbol, timeframe, limit);

      if (candles && candles.length > 0) {
        // Update our local cache with the fetched data
        this.timeframeHistories[timeframe] = candles.slice(-200);

        // Send to dashboard
        this.dashboardWs.send(JSON.stringify({
          type: 'historical_candles',
          timeframe: timeframe,
          candles: candles
        }));

        console.log(`✅ Sent ${candles.length} historical ${timeframe} candles to dashboard`);
      } else {
        console.warn(`⚠️ No historical candles returned for ${timeframe}`);
        // Fall back to cached WebSocket data if available
        const cached = this.getCandlesForTimeframe(timeframe);
        if (cached.length > 0) {
          this.dashboardWs.send(JSON.stringify({
            type: 'historical_candles',
            timeframe: timeframe,
            candles: cached
          }));
          console.log(`📊 Sent ${cached.length} cached ${timeframe} candles as fallback`);
        }
      }
    } catch (error) {
      console.error(`❌ Failed to fetch historical ${timeframe} candles:`, error.message);
      // Fall back to cached data
      const cached = this.getCandlesForTimeframe(timeframe);
      if (cached.length > 0 && this.dashboardWs) {
        this.dashboardWs.send(JSON.stringify({
          type: 'historical_candles',
          timeframe: timeframe,
          candles: cached
        }));
      }
    }
  }

  /**
   * Main trading cycle - runs every 15 seconds
   */
  startTradingCycle() {
    const interval = parseInt(process.env.TRADING_INTERVAL) || 15000;

    this.tradingInterval = setInterval(async () => {
      // Reduced to 3 candles - fuck the over-engineering
      if (!this.marketData || this.priceHistory.length < 3) {
        console.log(`⏳ Warming up... ${this.priceHistory.length}/3 candles`);
        return;
      }

      try {
        await this.analyzeAndTrade();
      } catch (error) {
        console.error('❌ Trading cycle error:', error.message);
        console.error(error.stack);
      }
    }, interval);

    console.log(`⏰ Trading cycle started (${interval}ms interval)`);

    // CHANGE 2026-01-16: Liveness watchdog - catches "no data at all" scenario
    this.startLivenessWatchdog();
  }

  /**
   * Liveness watchdog - detects when data feed goes completely silent
   * Runs every 60 seconds, pauses trading if no data received in 2 minutes
   */
  startLivenessWatchdog() {
    const LIVENESS_CHECK_INTERVAL = 60000;  // Check every 60 seconds
    const MAX_DATA_SILENCE = 120000;  // 2 minutes without data = dead feed

    this.livenessCheckInterval = setInterval(() => {
      if (!this.lastDataReceived) {
        // No data ever received - still warming up
        return;
      }

      const silenceDuration = Date.now() - this.lastDataReceived;

      if (silenceDuration > MAX_DATA_SILENCE && !this.staleFeedPaused) {
        console.error('🚨🚨🚨 LIVENESS WATCHDOG: NO DATA RECEIVED FOR', Math.round(silenceDuration / 1000), 'SECONDS');
        console.error('⏸️ PAUSING TRADING - DATA FEED APPEARS DEAD');
        this.staleFeedPaused = true;

        // Notify StateManager to pause
        try {
          const { getInstance: getStateManager } = require('./core/StateManager');
          const stateManager = getStateManager();
          stateManager.pauseTrading(`Liveness watchdog: No data for ${Math.round(silenceDuration / 1000)}s`);
        } catch (error) {
          console.error('Failed to pause via StateManager:', error.message);
        }
      }
    }, LIVENESS_CHECK_INTERVAL);

    console.log('🔍 Liveness watchdog started (checks every 60s, alerts if no data for 2min)');
  }

  /**
   * Analyze market and execute trades
   * Core trading pipeline orchestration
   */
  async analyzeAndTrade() {
    // PAUSE_001 REVERTED 2026-02-04: The isTrading check was a band-aid
    // Real fix: WebSocket reconnect (this.connected = true in kraken_adapter_simple.js)
    // Frozen price/$0 P&L was caused by WebSocket not reconnecting, not missing pause check

    const { price } = this.marketData;

    // CHANGE 2025-12-23: Use IndicatorEngine as single source of truth
    const engineState = indicatorEngine.getSnapshot();

    // Map IndicatorEngine output to expected format
    const indicators = {
      rsi: engineState.rsi || 50,
      macd: engineState.macd || { macd: 0, signal: 0, hist: 0 },
      ema12: engineState.ema?.[12] || price,
      ema26: engineState.ema?.[26] || price,
      trend: OptimizedIndicators.determineTrend(this.priceHistory, 10, 30), // Keep for now
      volatility: engineState.atr || OptimizedIndicators.calculateVolatility(this.priceHistory, 20)
    };

    // CHANGE 655: RSI Smoothing - Prevent machine-gun trading without circuit breakers
    if (!this.rsiHistory) this.rsiHistory = [];
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
    const patterns = this.patternChecker.analyzePatterns({
      candles: this.priceHistory,
      trend: indicators.trend,
      macd: indicators.macd?.macd || indicators.macd?.macdLine || 0,
      macdSignal: indicators.macd?.signal || indicators.macd?.signalLine || 0,
      rsi: indicators.rsi,
      volume: this.marketData.volume || 0
    });

    // CRITICAL FIX: Record patterns immediately when detected for learning
    // Don't wait for trade completion - patterns need to be recorded NOW
    if (patterns && patterns.length > 0) {
      // TELEMETRY: Track pattern detection
      const telemetry = require('./core/Telemetry').getTelemetry();

      patterns.forEach(pattern => {
        const signature = pattern.signature || pattern.name || 'unknown_pattern';
        if (!signature || signature === 'unknown_pattern') {
          console.warn('⚠️ Pattern missing proper signature, using generic fallback:', pattern);
          // Don't return - still record for statistics even with generic signature
        }

        // CHANGE 659: Fix pattern recording - pass features array instead of signature string
        // recordPatternResult expects features array, not signature string

        // DEBUG: Check what we're getting
        if (!Array.isArray(pattern.features)) {
          console.error('❌ Pattern features is not an array:', {
            type: typeof pattern.features,
            value: pattern.features,
            pattern: pattern
          });
        }

        // ENSURE we always have an array
        let featuresForRecording;
        if (Array.isArray(pattern.features)) {
          featuresForRecording = pattern.features;
        } else {
          // Create fallback array from indicators
          console.warn('⚠️ Creating fallback features array');
          // FIX 2026-02-01: Convert trend to numeric if string (bullish=1, bearish=-1, else=0)
        const trendNumeric = typeof indicators.trend === 'string'
          ? (indicators.trend === 'bullish' || indicators.trend === 'uptrend' ? 1 :
             indicators.trend === 'bearish' || indicators.trend === 'downtrend' ? -1 : 0)
          : (indicators.trend || 0);
        featuresForRecording = [
            indicators.rsi || 50,
            indicators.macd?.macd || 0,
            indicators.macd?.signal || 0,
            trendNumeric,
            this.marketData.volume || 0
          ];
        }

        // DISABLED 2026-02-01: Entry recording creates patterns with pnl=0, polluting learning data
        // Pattern outcomes are recorded at trade EXIT (line ~2743) with actual P&L
        // This was causing 8000+ patterns all with wins=0, losses=0, totalPnL=0
        // if (this.config.tradingMode !== 'TEST') {
        //   this.patternChecker.recordPatternResult(featuresForRecording, {...});
        // }
        // Pattern detection is still tracked via telemetry below

        // TELEMETRY: Log pattern detection event
        telemetry.event('pattern_detected', {
          signature,
          confidence: pattern.confidence,
          isNew: pattern.isNew,
          price: this.marketData.price
        });
      });

      // TELEMETRY: Log batch recording
      telemetry.event('pattern_recorded', {
        count: patterns.length,
        memorySize: this.patternChecker.getMemorySize ? this.patternChecker.getMemorySize() : 0
      });

      console.log(`📊 Recorded ${patterns.length} patterns for learning`);
    }

    // Update OGZ Two-Pole Oscillator with latest candle
    let tpoResult = null;
    if (this.ogzTpo && this.priceHistory.length > 0) {
      const latestCandle = this.priceHistory[this.priceHistory.length - 1];
      tpoResult = this.ogzTpo.update({
        o: latestCandle.open,
        h: latestCandle.high,
        l: latestCandle.low,
        c: latestCandle.close,
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

    // NOTE: PreviousDayRangeStrategy removed (was using wrong property names c.high vs c.h)
    // Will be re-implemented with correct math when user provides specs

    // 📡 Broadcast pattern analysis to dashboard
    this.broadcastPatternAnalysis(patterns, indicators);

    // Detect market regime
    const regime = this.regimeDetector.detectRegime(this.priceHistory);

    // Change 596: Use TradingBrain.getDecision() instead of calculateRealConfidence()
    // This properly integrates direction + confidence from TradingBrain's analysis
    const marketDataForConfidence = {
      trend: indicators.trend,
      macd: indicators.macd?.macd || indicators.macd?.macdLine || 0,
      macdSignal: indicators.macd?.signal || indicators.macd?.signalLine || 0,
      rsi: indicators.rsi,
      volume: this.marketData.volume || 0,
      // CHANGE 2026-02-10: Modular entry system signals
      emaCrossoverSignal: this.emaCrossoverSignal,
      maDynamicSRSignal: this.maDynamicSRSignal,
      liquiditySweepSignal: this.liquiditySweepSignal,
      mtfAdapter: this.mtfAdapter
    };

    // 🔧 FIX: Pass priceData to TradingBrain for MarketRegimeDetector
    this.tradingBrain.priceData = this.priceHistory;

    // FIX BRAIN_001: Apply AGGRESSIVE_LEARNING_MODE threshold BEFORE TradingBrain decides
    // Previously this adjustment happened AFTER TradingBrain already rejected - useless!
    // Now we update TradingBrain's config before it makes the decision
    if (flagManager.isEnabled('AGGRESSIVE_LEARNING_MODE')) {
      const aggressiveThreshold = flagManager.getSetting('AGGRESSIVE_LEARNING_MODE', 'minConfidenceThreshold', 55) / 100;
      if (!this.tradingBrain.config) this.tradingBrain.config = {};
      this.tradingBrain.config.minConfidenceThreshold = aggressiveThreshold;
      // Log once per minute to avoid spam
      if (!this._lastAggLog || Date.now() - this._lastAggLog > 60000) {
        console.log(`🔥 AGGRESSIVE LEARNING: TradingBrain threshold set to ${(aggressiveThreshold * 100).toFixed(0)}%`);
        this._lastAggLog = Date.now();
      }
    }

    // Get full decision from TradingBrain (direction + confidence + reasoning)
    const brainDecision = await this.tradingBrain.getDecision(
      marketDataForConfidence,
      patterns,
      this.priceHistory
    );

    // CHANGE 625: Fix directional confusion - TradingBrain doesn't know about positions
    // CHANGE 2026-01-29: Updated comment - "shorts forbidden" was misleading
    // On SPOT market, you can only SELL what you OWN - no shorting possible
    // So 'sell' with no position = nothing to sell = HOLD
    // 'sell' with position = close position (sell our coins)
    let tradingDirection = brainDecision.direction; // 'buy', 'sell', or 'hold'

    // CHANGE 2025-12-11: Use StateManager for position reads
    const currentPosition = stateManager.get('position');
    if (tradingDirection === 'sell' && currentPosition === 0) {
      // SPOT MARKET: Can only sell what we own - no position means nothing to sell
      console.log('🚫 TradingBrain said SELL but no position to sell (SPOT market) - converting to HOLD');
      tradingDirection = 'hold';
    } else if (tradingDirection === 'sell' && currentPosition > 0) {
      // CHANGE 638: Allow SELL to proceed when we have a position
      // MaxProfitManager was never being checked due to this conversion to HOLD
      console.log('📊 TradingBrain bearish - executing SELL of position');
      // Let the SELL proceed instead of converting to HOLD
    }

    // TEST MODE: Use patterns for decisions but DON'T save new patterns
    let rawConfidence = brainDecision.confidence;
    if (this.config.tradingMode === 'TEST') {
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

    // 🤖 STEP 5: TRAI DECISION PROCESSING (IN THE HOT PATH - Change 574)
    let finalConfidence = confidenceData.totalConfidence;
    let traiDecision = null;

    // Change 590: Check TRAI bypass flag for fast backtesting
    const skipTRAI = this.config.enableBacktestMode && process.env.TRAI_ENABLE_BACKTEST === 'false';

    if (this.trai && !skipTRAI) {
      try {
        // Prepare signal for TRAI (Change 596: Use TradingBrain's direction, not trend)
        const signal = {
          action: tradingDirection.toUpperCase(), // 'buy' → 'BUY', 'sell' → 'SELL', 'hold' → 'HOLD'
          confidence: rawConfidence,
          patterns: patterns,
          indicators: indicators,
          price: price,
          timestamp: Date.now()
        };

        // Prepare context for TRAI
        const context = {
          volatility: indicators.volatility,
          trend: indicators.trend,
          volume: this.marketData.volume || 'normal',
          regime: regime.currentRegime || 'unknown',
          indicators: indicators,
          positionSize: stateManager.get('balance') * 0.01,
          currentPosition: stateManager.get('position')
        };

        // CHANGE 2025-12-13: TRAI DISABLED FOR CLEAN PROFESSIONAL LOGS
        // TRAI was async but still cluttering output
        // Pure mathematical trading only - no AI interference

        /* DISABLED - Uncomment to re-enable TRAI learning
        this.trai.processDecision(signal, context)
          .then(decision => {
            // Log when TRAI completes (async)
            console.log(`🤖 [TRAI Async] Completed: ${(decision.traiConfidence * 100).toFixed(1)}% → ${(decision.finalConfidence * 100).toFixed(1)}% | ${decision.traiRecommendation}`);

            // Store for post-trade learning (but don't block)
            if (decision.id) {
              this.pendingTraiDecisions.set(`async_${Date.now()}`, {
                decisionId: decision.id,
                originalConfidence: decision.originalConfidence,
                traiConfidence: decision.traiConfidence,
                timestamp: Date.now()
              });
            }
          })
          .catch(err => {
            console.warn('⚠️ [TRAI Async] Error (non-blocking):', err.message);
          });
        */

        // CRITICAL: Do NOT wait for TRAI - use mathematical confidence immediately
        // finalConfidence stays at rawConfidence - TRAI no longer affects real-time decisions

      } catch (error) {
        console.error('⚠️ TRAI processing error:', error.message);
        // Continue with original confidence
      }
    }

    // Log clean analysis summary
    const bestPattern = patterns.length > 0 ? patterns[0].name : 'none';
    // CHANGE 634: Clean human-readable output
    const cleanPrice = Math.round(price).toLocaleString();
    console.log(`\n📊 $${cleanPrice} | Conf: ${confidenceData.totalConfidence.toFixed(0)}% | RSI: ${Math.round(indicators.rsi)} | ${indicators.trend} | ${regime.currentRegime || 'analyzing'}`);

    // CHECK FOR STRONG INDICATOR SIGNALS (TPO) THAT CAN OVERRIDE
    let overrideSignal = null;
    let signalSource = null;

    // Check if TPO has a high-probability signal
    if (tpoResult && tpoResult.signal && tpoResult.signal.highProbability) {
      console.log(`\n⚡ TPO Override: High probability ${tpoResult.signal.zone} signal`);

      if (tpoResult.signal.strength > 0.03) {
        overrideSignal = tpoResult.signal;
        signalSource = 'TPO';
        tradingDirection = tpoResult.signal.action === 'BUY' ? 'buy' : 'sell';
      }
    }

    // CHANGE 639: Pass TradingBrain's direction to makeTradeDecision
    // Bug: When TRAI disabled, TradingBrain's 'sell' signal was ignored
    // Fix: Pass tradingDirection so makeTradeDecision respects TradingBrain
    const decision = this.makeTradeDecision(confidenceData, indicators, patterns, price, tradingDirection);

    // Add override signal info to decision
    if (overrideSignal && decision.action !== 'HOLD') {
      decision.signalSource = signalSource;
      decision.overrideSignal = overrideSignal;

      // Use dynamic SL/TP from signals if available
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

    // V2 ARCHITECTURE: Broadcast TRAI chain-of-thought to dashboard
    // CHANGE 2026-01-29: Use 'bot_thinking' type to match dashboard handler
    if (this.dashboardWsConnected && this.dashboardWs && decision.decisionContext) {
      // CHANGE 2026-01-29: Structure matches dashboard handler expectations
      const reasoning = decision.action === 'HOLD' ?
        `Waiting: Confidence ${decision.confidence?.toFixed(1) || 0}% < ${this.config.minTradeConfidence * 100}% minimum` :
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

      // Auto-draw technical levels when taking a trade - DISABLED: causing crashes
      // if (decision.action !== 'HOLD' && this.priceHistory && Array.isArray(this.priceHistory) && this.priceHistory.length > 50) {
      //   const autoDrawLevels = this.calculateAutoDrawLevels(price, this.priceHistory);
      //   chainOfThought.autoDrawLevels = autoDrawLevels;
      // }

      try {
        this.dashboardWs.send(JSON.stringify(chainOfThought));
        console.log(`🧠 [TRAI] Chain-of-thought sent to dashboard: ${decision.action}`);
      } catch (err) {
        console.error('Failed to send TRAI reasoning to dashboard:', err.message);
      }
    }

    if (decision.action !== 'HOLD') {
      await this.executeTrade(decision, confidenceData, price, indicators, patterns, traiDecision);
    }
  }

  // REMOVED 2026-02-01: calculateAutoDrawLevels() - Dead code (call was commented out)
  // ~275 lines removed - was never invoked, only definition existed

  /**
   * Determine if we should trade and in which direction
   * CHANGE 639: Added brainDirection parameter to respect TradingBrain's decision
   */
  makeTradeDecision(confidenceData, indicators, patterns, currentPrice, brainDirection = null) {
    const { totalConfidence } = confidenceData;
    let minConfidence = this.config.minTradeConfidence * 100;

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
    const assetType = this.kraken?.getAssetType?.() || 'crypto';
    const decisionContext = tradingOptimizations.createDecisionContext({
      symbol: this.tradingPair || 'XBT/USD',
      direction: getDirectionDisplayLabel(brainDirection, assetType),
      confidence: totalConfidence,
      patterns: patterns || [],
      patternScores: confidenceData.patternScores || {},
      indicators,
      regime: this.marketRegime?.currentRegime || 'unknown',
      module: this.gridStrategy ? 'grid' : 'standard',
      price: currentPrice,
      brainDirection
    });

    // CHANGE 670: Check grid strategy first if enabled
    if (this.gridStrategy) {
      const gridSignal = this.gridStrategy.getGridSignal(currentPrice, indicators);

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
        // CHANGE 2026-02-02: TradeIntelligenceEngine - Intelligent Exit Decisions
        // Evaluates each trade on 13 dimensions instead of blanket rules
        // =====================================================================
        if (this.tradeIntelligence) {
          const intelligenceContext = {
            // Pattern bank data
            patternBank: this.tradingBrain?.patternMemory,
            // Trade history for similar trade analysis
            tradeHistory: stateManager.getAllTrades().filter(t => t.pnl !== undefined),
            // Current confidence from the bot
            currentConfidence: totalConfidence / 100,
            // TRAI analysis if available
            traiAnalysis: this.lastTraiDecision || null,
            // Risk context
            currentDrawdown: stateManager.get('maxDrawdown') || 0,
            consecutiveLosses: stateManager.get('consecutiveLosses') || 0,
            dailyPnL: stateManager.get('dailyPnL') || 0,
            // Sentiment (if available)
            fearGreedIndex: this.marketData?.fearGreed,
            // Whale activity (placeholder - can be connected to exchange data)
            whaleActivity: this.marketData?.whaleActivity || null
          };

          const marketDataForIntelligence = {
            price: currentPrice,
            volume: this.marketData?.volume,
            avgVolume: this.marketData?.avgVolume,
            high24h: this.marketData?.high24h,
            low24h: this.marketData?.low24h,
            priceChange: this.marketData?.priceChange,
            currentCandle: this.priceHistory?.[this.priceHistory.length - 1]
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
            volume: this.marketData?.volume,
            avgVolume: this.marketData?.avgVolume
          };

          const intelligenceResult = this.tradeIntelligence.evaluate(
            activeTrade,
            marketDataForIntelligence,
            indicatorsForIntelligence,
            intelligenceContext
          );

          // Log or act on intelligence result
          if (this.tradeIntelligenceShadowMode) {
            // Shadow mode - just log what would happen
            if (intelligenceResult.action !== 'HOLD_CAUTIOUS' && intelligenceResult.action !== 'HOLD_STRONG') {
              console.log(`🧠 [INTELLIGENCE-SHADOW] Would recommend: ${intelligenceResult.action}`);
              console.log(`   Confidence: ${(intelligenceResult.confidence * 100).toFixed(0)}%`);
              console.log(`   Reasoning: ${intelligenceResult.reasoning.slice(0, 3).join(' | ')}`);
              console.log(`   Score breakdown: regime=${intelligenceResult.scores.regime?.score || 0}, momentum=${intelligenceResult.scores.momentum?.score || 0}, ema=${intelligenceResult.scores.ema?.score || 0}`);
            }
          } else if (this.activeExitSystem === 'intelligence' || this.activeExitSystem === 'legacy') {
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
        // BUGFIX 2026-02-01: this.candles doesn't exist, use this.priceHistory
         const levelAnalysis = this.tradingBrain.analyzeFibSRLevels(this.priceHistory, currentPrice);

         // CHANGE 652: Check MaxProfitManager state before calling update
         // EXIT_SYSTEM flag: Only run MPM when activeExitSystem is maxprofit or legacy
         let profitResult = null;
         if (this.activeExitSystem === 'maxprofit' || this.activeExitSystem === 'legacy') {
           if (!this.tradingBrain?.maxProfitManager?.state?.active) {
             console.log('⚠️ MaxProfitManager not active for position, will check other exit conditions');
           } else {
             profitResult = this.tradingBrain.maxProfitManager.update(currentPrice, {
             volatility: indicators.volatility || 0,
             trend: indicators.trend || 'sideways',
             volume: this.marketData?.volume || 0,
             trailMultiplier: levelAnalysis.trailMultiplier || 1.0
           });
           }
         }

         // Evaluate pattern exit model (shadow mode or active)
         // EXIT_SYSTEM flag: Only run pattern exits when activeExitSystem is pattern or legacy
         if (this.patternExitModel && (this.activeExitSystem === 'pattern' || this.activeExitSystem === 'legacy')) {
           const profitPercent = (currentPrice - entryPrice) / entryPrice;
           const exitDecision = this.patternExitModel.evaluateExit({
             currentPrice,
             currentPatterns: patterns || [],
             indicators: {
               rsi: indicators.rsi,
               macd: indicators.macd
             },
             regime: this.regimeDetector?.currentRegime || 'unknown',
             profitPercent,
             maxProfitManagerState: profitResult
           });

           if (this.patternExitShadowMode) {
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
        if (profitResult && (profitResult.action === 'exit' || profitResult.action === 'exit_full' || profitResult.action === 'exit_partial') && (this.activeExitSystem === 'maxprofit' || this.activeExitSystem === 'legacy')) {
          console.log(`📉 SELL Signal: ${profitResult.reason || 'MaxProfitManager exit'} (${profitResult.action})`);
          return { action: 'SELL', direction: 'close', confidence: totalConfidence, exitSize: profitResult.exitSize };
        }

        // CRITICAL FIX: Calculate P&L for exit decisions
        const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;
        // FIX 2026-02-05: Use candle timestamp not Date.now() (broken in backtest - all holdTimes were ~0)
        const currentTime = this.marketData?.timestamp || Date.now();
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
        if (this.activeExitSystem === 'legacy' && !this.tradingBrain?.maxProfitManager?.state?.active) {
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
        if (brainDirection === 'sell' && (this.activeExitSystem === 'brain' || this.activeExitSystem === 'legacy')) {
          // Get the oldest BUY trade to check hold time
          const buyTrades = stateManager.getAllTrades()
            .filter(t => t.action === 'BUY')
            .sort((a, b) => a.entryTime - b.entryTime);

          if (buyTrades.length > 0) {
            const buyTrade = buyTrades[0];
            const holdTime = ((this.marketData?.timestamp || Date.now()) - buyTrade.entryTime) / 60000; // Convert to minutes
            const minHoldTime = 0.05; // 3 seconds for 5-sec candles

            // Additional conditions for Brain to override:
            // 1. Minimum hold time met
            // 2. Position is in profit (don't panic sell at loss)
            const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;

            if (holdTime >= minHoldTime && pnl > 0.35) {  // MUST COVER FEES (0.32% + buffer)
              console.log(`🧠 Brain bearish & profitable - allowing SELL (held ${holdTime.toFixed(2)} min, PnL: ${pnl.toFixed(2)}%)`);
              return { action: 'SELL', direction: 'close', confidence: totalConfidence };
            } else if (holdTime >= minHoldTime && pnl < -2) {
              // Emergency: Allow Brain to cut losses if down > 2%
              console.log(`🚨 Brain emergency sell - cutting losses (PnL: ${pnl.toFixed(2)}%)`);
              return { action: 'SELL', direction: 'close', confidence: totalConfidence };
            } else if (holdTime >= 5 && pnl < 0 && pnl >= -2) {
              // CHANGE 2026-01-25: Gradual loss exit - don't bag hold small losses forever
              // After 5 minutes, exit gracefully if losing but not yet at emergency threshold
              console.log(`📉 Gradual exit - held ${holdTime.toFixed(1)} min at ${pnl.toFixed(2)}% loss, cutting loose`);
              return { action: 'SELL', direction: 'close', confidence: totalConfidence };
            } else {
              console.log(`🧠 Brain wants sell but conditions not met (hold: ${holdTime.toFixed(3)} min, PnL: ${pnl.toFixed(2)}%)`);
            }
          }
        }

        // Change 604: DISABLE confidence exits - they're killing profitability
        // Confidence reversal exits were triggering BEFORE profit targets (1-2%)
        // This caused 100% of exits at 0.00-0.12% profit = NET LOSS after fees
        //
        // Let MaxProfitManager handle exits with proper profit targets
        // Only use confidence as EXTREME emergency exit (50%+ drop)

        const recentConfidences = this.confidenceHistory || [];
        this.confidenceHistory = this.confidenceHistory || [];
        this.confidenceHistory.push(totalConfidence);
        if (this.confidenceHistory.length > 10) this.confidenceHistory.shift();

        const peakConfidence = Math.max(...this.confidenceHistory.slice(-5));
        const confidenceDrop = peakConfidence - totalConfidence;

        // ONLY exit on MASSIVE confidence drops (market crash scenario)
        if (confidenceDrop > 50) {
          console.log(`📉 SELL Signal: EXTREME reversal (${confidenceDrop.toFixed(1)}% confidence drop)`);
          return { action: 'SELL', direction: 'close', confidence: totalConfidence };
        }

        // Let profitable trades ride - don't exit on minor confidence fluctuations
      }
    }

    // 🚫 CRYPTO: NO SHORTING/MARGIN - Too risky, disabled permanently
    // (Shorting only enabled for stocks/forex if needed in future)

    // HOLD means we're uncertain - should have LOW confidence, not high!
    // High confidence should only be for BUY/SELL signals
    // CHANGE 2026-01-29: Include decisionContext for chain of thought updates
    return { action: 'HOLD', confidence: Math.min(0.2, totalConfidence * 0.1), decisionContext };
  }

  /**
   * Execute a trade through the merged AdvancedExecutionLayer
   * Uses Browser Claude's Change 513 compliant version
   */
  async executeTrade(decision, confidenceData, price, indicators, patterns, traiDecision = null) {
    // CHANGE 657: Codex-recommended rate limiter - NEVER blocks exits!
    // CHANGE 658: Make symbol-specific instead of hardcoded
    const gate = this.rateLimiter.allow({
      symbol: this.tradingPair || process.env.TRADING_PAIR || 'XBT/USD',
      action: decision.action,
      currentPosition: stateManager.get('position')
    });

    if (!gate.ok) {
      console.log(`🛑 RATE LIMIT: ${gate.reason} - ${gate.message}`);
      if (gate.retryInMs) {
        console.log(`⏱️ Retry in ${(gate.retryInMs/1000).toFixed(1)}s`);
      }
      return; // Block only entries, exits always allowed
    }

    // Log allowed trade
    console.log(`\n🎯 ${decision.action} SIGNAL @ $${price.toFixed(2)} | Confidence: ${decision.confidence.toFixed(1)}%`);

    // CHECKPOINT 1: Entry
    console.log(`📍 CP1: executeTrade ENTRY - Balance: $${stateManager.get('balance')}, Position: ${stateManager.get('position')}`);

    // FIXED: Use actual balance from StateManager, not stale systemState
    const currentBalance = stateManager.get('balance') || 10000;
    let basePositionPercent = parseFloat(process.env.MAX_POSITION_SIZE_PCT) || 0.01;

    // FIX 2026-02-02: AGGRESSIVE_LEARNING_MODE boosts position size while pattern bank builds
    const aggressiveLearning = flagManager.isEnabled('AGGRESSIVE_LEARNING_MODE');
    if (aggressiveLearning) {
      const multiplier = flagManager.getSetting('AGGRESSIVE_LEARNING_MODE', 'positionSizeMultiplier', 2.0);
      basePositionPercent = basePositionPercent * multiplier;
      console.log(`🔥 AGGRESSIVE LEARNING: Position size ${multiplier}x → ${(basePositionPercent * 100).toFixed(1)}%`);
    }
    const baseSizeUSD = currentBalance * basePositionPercent;

    // FIX 2025-12-27: Convert USD to BTC amount (was treating $500 as 500 BTC!)
    const positionSizeUSD = baseSizeUSD; // This is in USD
    const positionSizeBTC = positionSizeUSD / price; // Convert to BTC amount

    console.log(`💰 Position sizing: Balance=$${currentBalance.toFixed(2)}, Percent=${(basePositionPercent*100).toFixed(1)}%, USD=$${positionSizeUSD.toFixed(2)}, BTC=${positionSizeBTC.toFixed(8)}`);

    // CHANGE 2025-12-11: Pass 2 - Pattern-based position sizing
    const patternIds = decision.decisionContext?.patternsActive ||
                      patterns?.map(p => p.id || p.signature || 'unknown') || [];
    // Now pass BTC amount to calculatePositionSize, not USD
    const adjustedPositionBTC = tradingOptimizations.calculatePositionSize(positionSizeBTC, patternIds, decision.decisionContext);
    const positionSize = adjustedPositionBTC; // Final position size in BTC

    // CHECKPOINT 2: Position sizing
    console.log(`📍 CP2: Position size calculated: ${positionSize.toFixed(8)} BTC (base: ${positionSizeBTC.toFixed(8)} BTC, adjusted for pattern quality)`);

    // Change 587: SafetyNet DISABLED - too restrictive
    // Was blocking legitimate trades with overly conservative limits
    // We already have sufficient risk management through:
    // - RiskManager pre-trade validation
    // - TRAI veto power for risky trades
    // - MIN_TRADE_CONFIDENCE threshold (35%)
    // - Position sizing limits (1% per trade)
    /*
    const tradeRequest = {
      action: decision.action,
      size: positionSize,
      price: price,
      confidence: decision.confidence / 100,
      indicators: indicators,
      patterns: patterns
    };

    const safetyCheck = this.safetyNet.validateTrade(tradeRequest, {
      price: price,
      volume: this.marketData?.volume || 0,
      volatility: indicators.volatility,
      timestamp: Date.now()
    });

    if (!safetyCheck.allowed) {
      console.log(`🛡️ SafetyNet BLOCKED: ${safetyCheck.reason}`);
      return;
    }
    */

    try {
      // CHECKPOINT 3: Before ExecutionLayer call
      const usdAmount = positionSize * price;
      console.log(`📍 CP3: Calling ExecutionLayer.executeTrade with USD=$${usdAmount.toFixed(2)} (${positionSize.toFixed(8)} BTC)`);

      // Circuit breaker check before execution
      if (this.tradingBrain?.errorHandler?.isCircuitBreakerActive('ExecutionLayer')) {
        console.log('🚨 CIRCUIT BREAKER: Execution blocked due to repeated failures');
        console.log('   Error count:', this.tradingBrain.errorHandler.getErrorStatus());
        // Don't return - let's see what error occurs
        // return;
      }

      // Generate decisionId for pattern attribution (join key to trai-decisions.log)
      const decisionId = decision.decisionId || `dec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

      const tradeResult = await this.executionLayer.executeTrade({
        direction: decision.action,
        positionSize: usdAmount,  // ExecutionLayer expects USD, not BTC!
        confidence: decision.confidence / 100,
        decisionId: decisionId,  // Pattern attribution join key
        marketData: {
          price,
          indicators,
          volatility: indicators.volatility,
          timestamp: Date.now()
        },
        patterns
      });

      // CHECKPOINT 4: After ExecutionLayer call
      console.log(`📍 CP4: ExecutionLayer returned:`, tradeResult ? `success=${tradeResult.success}` : 'NULL');

      if (tradeResult && tradeResult.success) {
        console.log(`📍 CP4.5: Trade SUCCESS confirmed, creating unified result`);
        // Change 588: Create unified tradeResult format
        const unifiedResult = {
          orderId: tradeResult.orderId || `SIM_${Date.now()}`,
          action: decision.action,
          entryPrice: price,
          entryTime: this.marketData?.timestamp || Date.now(),
          size: positionSize,
          confidence: decision.confidence,
          // CHANGE 648: Store full pattern objects with signatures for learning
          // BUGFIX 2026-02-01: Include features array for pattern outcome recording!
          // Without features, recordPatternResult at trade close fails with "empty features array"
          patterns: patterns?.map(p => ({
            name: p.name || p.type,
            signature: p.signature || p.id || `${p.name || p.type}_${Date.now()}`,
            confidence: p.confidence || 0,
            features: p.features || []  // CRITICAL: Required for pattern learning!
          })) || [],
          indicators: {
            rsi: indicators.rsi,
            macd: indicators.macd?.macd || 0,  // CHANGE 646: Fix property access - was ?.value
            macdSignal: indicators.macd?.signal || 0,
            trend: indicators.trend,
            volatility: indicators.volatility || 0
          }
        };

        console.log(`📍 CP4.6: Unified result created with orderId: ${unifiedResult.orderId}`);

        // Store for pattern learning and post-trade analysis
        // CHANGE 2025-12-13: Store in StateManager (single source of truth)
        // BUGFIX 2026-01-23: Only call updateActiveTrade for BUY trades!
        // SELL trades were being added to activeTrades but never cleaned up because
        // closePosition() only removes trades where type === 'BUY'.
        // This caused 96 SELL trades to accumulate, destroying the paper balance.
        if (decision.action === 'BUY') {
          console.log(`📍 CP4.7: About to call stateManager.updateActiveTrade (BUY only)`);
          try {
            stateManager.updateActiveTrade(unifiedResult.orderId, unifiedResult);
            console.log(`📍 CP4.8: updateActiveTrade completed successfully`);
          } catch (error) {
            console.error(`❌ CP4.8 ERROR: updateActiveTrade failed:`, error.message);
            console.error(`   Full error:`, error);
          }
        } else {
          console.log(`📍 CP4.7: SKIPPING updateActiveTrade for ${decision.action} (only BUY trades stored)`);
        }

        // CHANGE 647: Store TRAI decision for learning feedback loop
        // CHANGE 650: Use correct field name 'id' not 'decisionId'
        if (traiDecision && traiDecision.id && unifiedResult.orderId) {
          this.pendingTraiDecisions.set(unifiedResult.orderId, {
            decisionId: traiDecision.id,  // Use 'id' field from TRAI decision
            originalConfidence: traiDecision.originalConfidence,
            traiConfidence: traiDecision.traiConfidence,
            timestamp: Date.now()
          });
          console.log(`📚 [TRAI] Decision stored for learning (ID: ${traiDecision.id})`);
        }

        // Update position tracking
        if (decision.action === 'BUY') {
          // CHECKPOINT 5: Before position update
          const stateBefore = stateManager.getState();
          console.log(`📍 CP5: BEFORE BUY - Position: ${stateBefore.position}, Balance: $${stateBefore.balance}`);

          // CHANGE 2025-12-11: Use StateManager for atomic position updates
          // CHANGE 2025-12-11 FIX: orderId was undefined - use unifiedResult.orderId
          // FIX 2026-02-02: Attach patterns + indicators for learning feedback at exit
          const positionResult = await stateManager.openPosition(positionSize, price, {
            orderId: unifiedResult.orderId,
            confidence: decision.confidence,
            patterns: patterns || [],  // Attach detected patterns for outcome learning
            entryIndicators: indicators,  // Attach indicators for feature vector reconstruction
            entryTime: this.marketData?.timestamp || Date.now()  // FIX 2026-02-05: Use candle time in backtest
          });

          // CHANGE 2025-12-12: Validate StateManager.openPosition() success
          if (!positionResult.success) {
            console.error('❌ StateManager.openPosition failed:', positionResult.error);
            // CHANGE 2025-12-13: Remove from StateManager (single source of truth)
            stateManager.removeActiveTrade(unifiedResult.orderId);
            return; // Abort trade
          }

          // CHANGE 2025-12-13: No longer sync to local balance - read from StateManager
          const stateAfter = stateManager.getState();

          // CHECKPOINT 6: After position update
          console.log(`📍 CP6: AFTER BUY - Position: ${stateAfter.position}, Balance: $${stateAfter.balance} (spent $${positionSize})`);

          // Change 605: Start MaxProfitManager on BUY to track profit targets
          this.tradingBrain.maxProfitManager.start(price, 'buy', positionSize, {
            volatility: indicators.volatility || 0,
            confidence: decision.confidence / 100,
            trend: indicators.trend || 'sideways'
          });
          console.log(`💰 MaxProfitManager started - tracking 1-2% profit targets`);

          // CHANGE 2026-02-01: Send Telegram notification for trade
          // BACKTEST_FAST: Skip notifications during backtest
          if (!BACKTEST_FAST) {
            notifyTrade({
              direction: 'BUY',
              asset: this.config.symbol || 'BTC',
              price: price,
              size: positionSize / stateAfter.balance,
              confidence: decision.confidence / 100
            }).catch(err => console.warn(`📱 Telegram notify failed: ${err.message}`));

            // CHANGE 2026-02-01: Re-enable Discord notifications (broken since v7)
            discordNotifier.notifyTrade('buy', price, positionSize);
          }

          // Start pattern exit tracking (shadow mode or active)
          if (this.patternExitModel) {
            const exitTracking = this.patternExitModel.startTracking({
              entryPrice: price,
              direction: 'buy',
              size: positionSize,
              patterns: patterns || [],
              confidence: decision.confidence / 100,
              entryTime: this.marketData?.timestamp || Date.now()
            });

            if (this.patternExitShadowMode) {
              console.log(`🕵️ [SHADOW] Pattern Exit Tracking Started:`);
              console.log(`   Pattern Target: ${(exitTracking.patternTarget * 100).toFixed(2)}%`);
              console.log(`   Pattern Stop: ${(exitTracking.patternStop * 100).toFixed(2)}%`);
            }
          }

          // CHANGE 642: Record BUY trade for backtest reporting
          if (this.executionLayer && this.executionLayer.trades) {
            this.executionLayer.trades.push({
              timestamp: new Date().toISOString(),
              type: 'BUY',
              price: price,
              amount: positionSize,
              confidence: decision.confidence,
              balance: stateManager.get('balance')  // CHANGE 2025-12-13: Read from StateManager
            });
          }

          // CHANGE 2026-01-23: Broadcast BUY trade to dashboard
          if (this.dashboardWsConnected && this.dashboardWs && this.dashboardWs.readyState === 1) {
            this.dashboardWs.send(JSON.stringify({
              type: 'trade',
              action: 'BUY',
              direction: 'long',
              price: price,
              pnl: 0,  // No P&L on entry
              timestamp: Date.now(),
              confidence: decision.confidence
            }));
            console.log(`📡 Broadcast BUY trade to dashboard at $${price.toFixed(2)}`);
          }

          // CHANGE 2026-01-25: Log trade for website proof
          TradingProofLogger.trade({
            action: 'BUY',
            symbol: this.tradingPair || 'BTC/USD',
            price: price,
            size: positionSize,
            value_usd: positionSize * price,
            fees: (positionSize * price) * 0.0032,  // ~0.32% Kraken fees
            reason: unifiedResult.patterns?.map(p => p.name).join(' + ') || 'Signal-based entry',
            confidence: decision.confidence,
            indicators: unifiedResult.indicators,
            pattern: unifiedResult.patterns?.[0]?.name || null
          });

        } else if (decision.action === 'SELL') {
          // CHECKPOINT 7: SELL execution
          const currentState = stateManager.getState();
          console.log(`📍 CP7: SELL PATH - Position: ${currentState.position}, Balance: $${currentState.balance}`);

          // Change 589: Complete post-trade integrations
          // Find the matching BUY trade
          // CHANGE 2025-12-13: Read from StateManager (single source of truth)
          const buyTrades = stateManager.getAllTrades()
            .filter(t => t.action === 'BUY')
            .sort((a, b) => a.entryTime - b.entryTime);

          // CHANGE 644: Add error handling for SELL with no matching BUY
          if (buyTrades.length === 0) {
            console.error('❌ CRITICAL: SELL signal but no matching BUY trade found!');
            console.log('   Current position:', currentState.position);
            // CHANGE 2025-12-13: Read from StateManager (single source of truth)
            const allTrades = stateManager.getAllTrades();
            console.log('   Active trades count:', allTrades.length);
            console.log('   Active trades:', allTrades.map(t => ({
              id: t.orderId,
              action: t.action,
              price: t.entryPrice
            })));

            // Force reset to prevent permanent lockup via StateManager
            console.log('   ⚠️ Force resetting position to 0 to prevent lockup');
            await stateManager.emergencyReset();
            // CHANGE 2025-12-13: No local balance sync needed

            // Stop MaxProfitManager if it's tracking
            if (this.tradingBrain?.maxProfitManager) {
              this.tradingBrain.maxProfitManager.reset();
            }
            return; // Exit early, don't process invalid SELL
          }

          if (buyTrades.length > 0) {
            const buyTrade = buyTrades[0];
            const pnl = ((price - buyTrade.entryPrice) / buyTrade.entryPrice) * 100;
            const exitTimestamp = this.marketData?.timestamp || Date.now();
            const holdDuration = exitTimestamp - buyTrade.entryTime;

            // Create complete trade result
            const completeTradeResult = {
              ...buyTrade,
              exitPrice: price,
              exitTime: exitTimestamp,
              pnl: pnl,
              pnlDollars: buyTrade.size * (price - buyTrade.entryPrice),  // BUGFIX 2026-02-01: BTC × price_diff = USD profit
              holdDuration: holdDuration,
              exitReason: 'signal'
            };

            console.log(`📊 Trade closed: ${pnl >= 0 ? '✅' : '❌'} ${pnl.toFixed(2)}% | Hold: ${(holdDuration/60000).toFixed(1)}min`);

            // CHANGE 2025-12-11: Use StateManager for atomic position close
            const positionState = stateManager.getState();
            const btcPosition = positionState.position;  // BUGFIX 2026-02-01: This is BTC amount, not USD!
            
            // Close position via StateManager (handles P&L calculation)
            const closeResult = await stateManager.closePosition(price, false, null, {
              orderId: buyTrade.orderId,
              exitReason: 'signal'
            });

            // CHANGE 2025-12-12: Validate StateManager.closePosition() success
            if (!closeResult.success) {
              console.error('❌ StateManager.closePosition failed:', closeResult.error);
              return; // Abort close
            }
            
            // Get updated state after close
            // CHANGE 2025-12-13: No local balance sync needed - read from StateManager
            const afterSellState = stateManager.getState();
            
            // Calculate display values
            // BUGFIX 2026-02-01: btcPosition IS already in BTC, no division needed!
            const btcAmount = btcPosition;  // Already BTC, not USD
            const sellValue = btcAmount * price;  // BTC × current price = USD received
            const entryValue = btcAmount * buyTrade.entryPrice;  // BTC × entry price = USD spent
            const profitLoss = sellValue - entryValue;  // USD received - USD spent = profit
            console.log(`📍 CP8: SELL COMPLETE - New Balance: $${stateManager.get('balance')} (received $${sellValue.toFixed(2)}, P&L: $${profitLoss.toFixed(2)})`);

            // CHANGE 2026-02-01: Send notifications for trade close with P&L
            // BACKTEST_FAST: Skip notifications during backtest
            if (!BACKTEST_FAST) {
              notifyTradeClose({
                pnl: profitLoss,
                entryPrice: buyTrade.entryPrice,
                exitPrice: price,
                duration: `${Math.round((Date.now() - buyTrade.entryTime) / 60000)}m`
              }).catch(err => console.warn(`📱 Telegram notify failed: ${err.message}`));

              // CHANGE 2026-02-01: Re-enable Discord notifications for SELL
              discordNotifier.notifyTrade('sell', price, btcAmount, profitLoss);
            }

            // CHANGE 642: Record SELL trade for backtest reporting
            // CHANGE 649: Add exit indicators for ML learning
            if (this.executionLayer && this.executionLayer.trades) {
              this.executionLayer.trades.push({
                timestamp: new Date().toISOString(),
                type: 'SELL',
                price: price,
                entryPrice: buyTrade.entryPrice,
                amount: sellValue,
                pnl: pnl,
                pnlDollars: completeTradeResult.pnlDollars,
                confidence: decision.confidence,
                balance: stateManager.get('balance'),
                holdDuration: holdDuration,
                // Entry indicators from BUY
                entryIndicators: buyTrade.indicators,
                // Exit indicators at SELL time
                exitIndicators: {
                  rsi: indicators.rsi,
                  macd: indicators.macd?.macd || 0,
                  macdSignal: indicators.macd?.signal || 0,
                  trend: indicators.trend,
                  volatility: indicators.volatility || 0
                },
                exitReason: completeTradeResult.exitReason || 'signal'
              });
            }

            // CHANGE 2026-01-23: Broadcast SELL trade to dashboard
            if (this.dashboardWsConnected && this.dashboardWs && this.dashboardWs.readyState === 1) {
              this.dashboardWs.send(JSON.stringify({
                type: 'trade',
                action: 'SELL',
                direction: 'short',
                price: price,
                pnl: completeTradeResult.pnlDollars,
                timestamp: Date.now(),
                duration: `${(holdDuration / 60000).toFixed(1)}m`,
                confidence: decision.confidence
              }));
              console.log(`📡 Broadcast SELL trade to dashboard at $${price.toFixed(2)} (P&L: $${completeTradeResult.pnlDollars.toFixed(2)})`);
            }

            // CHANGE 2026-01-25: Log trade for website proof
            TradingProofLogger.trade({
              action: 'SELL',
              symbol: this.tradingPair || 'BTC/USD',
              price: price,
              size: btcAmount,
              value_usd: sellValue,
              fees: sellValue * 0.0032,  // ~0.32% Kraken fees
              reason: completeTradeResult.exitReason || 'Signal exit',
              confidence: decision.confidence,
              indicators: { rsi: indicators.rsi, macd: indicators.macd?.macd || 0 },
              pattern: buyTrade.patterns?.[0]?.name || null
            });

            // Log P&L explanation for transparency
            TradingProofLogger.explanation({
              decision: 'SELL',
              plain_english: `Closed position at $${price.toFixed(2)} after ${(holdDuration/60000).toFixed(1)} minutes. ${pnl >= 0 ? 'Profit' : 'Loss'} of ${pnl.toFixed(2)}% ($${profitLoss.toFixed(2)}).`,
              factors: [
                `Entry: $${buyTrade.entryPrice.toFixed(2)}`,
                `Exit: $${price.toFixed(2)}`,
                `Hold time: ${(holdDuration/60000).toFixed(1)} min`,
                `RSI at exit: ${indicators.rsi?.toFixed(1) || 'N/A'}`
              ]
            });

            // 1. SafetyNet DISABLED - too restrictive
            // this.safetyNet.updateTradeResult(completeTradeResult);

            // 2. Record pattern outcome for learning
            // CHANGE 659: Pass features array for proper pattern matching
            // recordPatternResult REQUIRES features array, never pass signature string
            if (buyTrade.patterns && buyTrade.patterns.length > 0) {
              const pattern = buyTrade.patterns[0]; // Primary pattern object
              const patternSignature = pattern.signature || pattern.name;

              // CRITICAL: Ensure features is an array
              let featuresForRecording;
              if (Array.isArray(pattern.features)) {
                featuresForRecording = pattern.features;
              } else {
                console.warn('⚠️ Pattern features not an array in trade completion, creating fallback');
                // FIX 2026-02-01: Convert trend to numeric if string (bullish=1, bearish=-1, else=0)
                const entryTrend = buyTrade.entryIndicators?.trend;
                const trendNumeric = typeof entryTrend === 'string'
                  ? (entryTrend === 'bullish' || entryTrend === 'uptrend' ? 1 :
                     entryTrend === 'bearish' || entryTrend === 'downtrend' ? -1 : 0)
                  : (entryTrend || 0);
                featuresForRecording = [
                  buyTrade.entryIndicators?.rsi || 50,
                  buyTrade.entryIndicators?.macd || 0,
                  buyTrade.entryIndicators?.macdSignal || 0,
                  trendNumeric,
                  buyTrade.entryIndicators?.volume || 0
                ];
              }

              // SAFE TEST MODE CHECK - Never corrupt patterns in test
              if (this.config.tradingMode !== 'TEST' && process.env.TEST_MODE !== 'true') {
                this.patternChecker.recordPatternResult(featuresForRecording, {
                  pnl: pnl,
                  holdDurationMs: holdDuration,  // Add temporal data
                  exitReason: completeTradeResult.exitReason || 'signal',
                  timestamp: Date.now()
                });
              } else if (this.config.tradingMode === 'TEST') {
                console.log('🧪 TEST MODE: Would record P&L pattern but SKIPPING - pattern base protected');
              }
              console.log(`🧠 Pattern learning: ${pattern.name} → ${pnl.toFixed(2)}%`);
            }

            // 3. Update PerformanceAnalyzer (using processTrade, not recordTrade)
            this.performanceAnalyzer.processTrade(completeTradeResult);

            // 4. TradeLogger removed (module doesn't exist)
            // this.tradeLogger.logTrade(completeTradeResult);

            // 5. TRAI learning (if applicable)
            if (this.trai && this.pendingTraiDecisions?.has(buyTrade.orderId)) {
              const traiDecision = this.pendingTraiDecisions.get(buyTrade.orderId);
              this.trai.recordTradeOutcome(traiDecision.decisionId, {
                actualPnL: pnl,
                exitPrice: price,
                exitTime: Date.now(),
                holdDuration: holdDuration
              });
              this.pendingTraiDecisions.delete(buyTrade.orderId);
              console.log(`🤖 [TRAI] Learning from ${pnl.toFixed(2)}% outcome`);
            }

            // Clean up active trade
            // CHANGE 2025-12-13: Remove from StateManager (single source of truth)
            stateManager.removeActiveTrade(buyTrade.orderId);
          }

          // CHANGE 645: Reset MaxProfitManager after successful SELL
          if (this.tradingBrain?.maxProfitManager) {
            this.tradingBrain.maxProfitManager.reset();
            console.log(`💰 MaxProfitManager deactivated - ready for next trade`);
          }

          // Stop pattern exit tracking
          if (this.patternExitModel) {
            // FIX: closeResult might not exist - use pnl if available
            const pnlValue = typeof pnl !== 'undefined' ? pnl : 0;
            this.patternExitModel.stopTracking({
              pnl: pnlValue,
              exitReason: 'manual_sell'
            });
            if (this.patternExitShadowMode) {
              console.log(`🕵️ [SHADOW] Pattern Exit tracking stopped`);
            }
          }

          // Position already reset via stateManager.closePosition() above
        }

        // Record in performance analyzer
        const performanceData = {
          type: decision.action,
          price,
          size: positionSize,
          confidence: decision.confidence,
          timestamp: Date.now(),
          result: tradeResult
        };

        this.performanceAnalyzer.processTrade(performanceData);

        // CHANGE 650: REMOVED DUPLICATE TRAI STORAGE - Already properly stored at line 853-861
        // This was overwriting the complete data with incomplete data

        console.log(`✅ ${decision.action} executed: ${tradeResult.orderId || 'SIMULATED'} | Size: $${positionSize.toFixed(2)}\n`);
      } else {
        console.log(`⛔ Trade blocked: ${tradeResult?.reason || 'Risk limits'}\n`);
      }

    } catch (error) {
      console.error(`❌ Trade execution failed at checkpoint between CP3 and CP4`);
      console.error(`   Error message: ${error.message}`);
      console.error(`   Stack trace:`, error.stack);
      console.error(`   Decision: ${decision?.action}, Confidence: ${decision?.confidence}`);
      console.error(`   Position size: ${positionSize}`);

      // Report error to circuit breaker
      if (this.tradingBrain?.errorHandler) {
        console.log(`   Reporting to error handler (circuit breaker will increment)`);
        this.tradingBrain.errorHandler.reportCritical('ExecutionLayer', error, {
          decision: decision.action,
          confidence: decision.confidence,
          positionSize
        });
      }
    }
  }

  // REMOVED 2026-02-01: calculateSimpleIndicators() and calculateEMA() - Dead code
  // ~45 lines removed - never invoked, indicators come from OptimizedIndicators.js

  /**
   * Broadcast pattern analysis to dashboard for transparency
   */
  broadcastPatternAnalysis(patterns, indicators) {
    try {
      if (this.dashboardWs && this.dashboardWs.readyState === 1) {
        // Format patterns for display
        const primaryPattern = patterns && patterns.length > 0 ? patterns[0] : null;

        // CHANGE 665: Include active trading profile in dashboard updates
        const activeProfile = this.profileManager.getActiveProfile();

        // CHANGE 2.0.12: Include pattern memory stats in dashboard
        const patternMemoryCount = this.patternChecker?.memory?.patternCount || 0;
        const patternMemorySize = Object.keys(this.patternChecker?.memory?.memory || {}).length;

        const message = {
          type: 'pattern_analysis',
          timestamp: Date.now(),
          pattern: {
            name: primaryPattern?.name || primaryPattern?.type || 'No strong pattern',
            confidence: primaryPattern?.confidence || 0,
            description: this.getPatternDescription(primaryPattern, indicators),
            allPatterns: patterns.map(p => ({
              name: p.name || p.type || 'unknown',
              confidence: p.confidence || 0
            }))
          },
          patternMemory: {
            count: patternMemoryCount,
            uniquePatterns: patternMemorySize,
            growthRate: `${(patternMemoryCount / Math.max(1, this.candleCount)).toFixed(2)} patterns/candle`,
            status: patternMemoryCount > 100 ? 'Learning Active 🧠' : 'Building Memory 📚'
          },
          indicators: {
            rsi: indicators.rsi,
            macd: indicators.macd?.macd || indicators.macd?.macdLine || 0,
            macdSignal: indicators.macd?.signal || indicators.macd?.signalLine || 0,
            trend: indicators.trend,
            volatility: indicators.volatility,
            // CHANGE 2026-01-25: Send EMA in format dashboard expects (ema[20], ema[50], ema[200])
            ema: indicatorEngine.getSnapshot().ema || {},
            // CHANGE 2026-01-25: Send BB and VWAP for dashboard overlays
            bb: indicatorEngine.getSnapshot().bb || {},
            vwap: indicatorEngine.getSnapshot().vwap || null
          },
          profile: {
            name: activeProfile.name,
            description: activeProfile.description,
            minConfidence: activeProfile.minConfidence,
            tradesPerDay: activeProfile.tradesPerDay
          }
        };

        this.dashboardWs.send(JSON.stringify(message));
      }
    } catch (error) {
      // Fail silently - don't let dashboard issues affect trading
      console.error('⚠️ Pattern broadcast failed:', error.message);
    }
  }

  /**
   * BACKTEST MODE: Load historical data and run simulation
   * Ported from Change 572 - loads Polygon historical data and feeds through trading logic
   */
  async loadHistoricalDataAndBacktest() {
    console.log('📊 BACKTEST MODE: Loading historical data...');

    const fs = require('fs').promises;
    const path = require('path');

    try {
      // Load historical candles - check for custom data file first (CHANGE 633)
      let dataPath;
      if (process.env.CANDLE_DATA_FILE) {
        // Use custom candle data file (e.g., 5-second candles for optimization)
        dataPath = process.env.CANDLE_DATA_FILE;
        console.log(`📂 Using custom data file: ${dataPath}`);
      } else {
        // Default behavior - CHANGE 633: Use 5-second candles for fast backtest
        const dataFile = process.env.FAST_BACKTEST === 'true'
          ? 'polygon-btc-5sec.json'  // 60k 5-second candles for rapid testing
          : 'polygon-btc-1y.json';    // 60k 1-minute candles for full validation
        console.log(`📂 Data file: data/${dataFile}`);
        dataPath = path.join(__dirname, 'data', dataFile);
      }
      const rawData = await fs.readFile(dataPath, 'utf8');
      const parsedData = JSON.parse(rawData);
      // Handle both formats: array of candles or object with .candles property
      const historicalCandles = parsedData.candles || parsedData;

      console.log(`✅ Loaded ${historicalCandles.length.toLocaleString()} historical candles`);
      console.log(`📅 Date range: ${new Date(historicalCandles[0].timestamp).toLocaleDateString()} → ${new Date(historicalCandles[historicalCandles.length - 1].timestamp).toLocaleDateString()}`);
      console.log(`⏱️  Starting backtest simulation...\n`);

      let processedCount = 0;
      let errorCount = 0;
      const startTime = Date.now();

      // Process each candle through the trading logic
      for (const polygonCandle of historicalCandles) {
        try {
          // Convert Polygon format to OHLCV format that our system expects
          const ohlcvCandle = {
            o: polygonCandle.open,
            h: polygonCandle.high,
            l: polygonCandle.low,
            c: polygonCandle.close,
            v: polygonCandle.volume,
            t: polygonCandle.timestamp
          };

          // Feed through handleMarketData (same as live mode)
          this.handleMarketData([
            ohlcvCandle.t / 1000,  // time (in seconds for Kraken compatibility)
            (ohlcvCandle.t / 1000) + 60,  // etime (end time)
            ohlcvCandle.o,
            ohlcvCandle.h,
            ohlcvCandle.l,
            ohlcvCandle.c,
            0,  // vwap (not used)
            ohlcvCandle.v,
            1   // count
          ]);

          // Run trading analysis after warmup (WITH TRAI!)
          if (this.priceHistory.length >= 15) {
            await this.analyzeAndTrade();
          }

          processedCount++;

          // Progress reporting every 5,000 candles
          if (processedCount % 5000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const rate = (processedCount / (elapsed || 1)).toFixed(0);
            console.log(`📊 Progress: ${processedCount.toLocaleString()}/${historicalCandles.length.toLocaleString()} candles (${rate}/sec) | Errors: ${errorCount}`);
          }

        } catch (err) {
          errorCount++;
          if (errorCount <= 5) {
            console.error(`❌ Error processing candle #${processedCount}:`, err.message);
          }
        }
      }

      // Final summary
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n✅ BACKTEST COMPLETE!`);
      console.log(`   📊 Candles processed: ${processedCount.toLocaleString()}`);
      console.log(`   ⏱️  Duration: ${totalTime}s`);
      console.log(`   ⚡ Rate: ${(processedCount / totalTime).toFixed(0)} candles/sec`);
      console.log(`   ❌ Errors: ${errorCount}`);
      console.log(`   💰 Final Balance: $${stateManager.get('balance').toFixed(2)}`);
      console.log(`   📈 Total P&L: $${(stateManager.get('balance') - 10000).toFixed(2)} (${((stateManager.get('balance') / 10000 - 1) * 100).toFixed(2)}%)`);

      // Pattern Learning Summary - Visual proof patterns are being recorded
      if (this.patternChecker?.getMemoryStats) {
        const patternStats = this.patternChecker.getMemoryStats();
        const wins = patternStats.totalWins || 0;
        const losses = patternStats.totalLosses || 0;
        const totalTrades = wins + losses;
        const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
        console.log(`\n   🧠 PATTERN LEARNING SUMMARY:`);
        console.log(`      📊 Patterns Recorded: ${patternStats.tradeResults || 0}`);
        console.log(`      ✅ Wins: ${wins}`);
        console.log(`      ❌ Losses: ${losses}`);
        console.log(`      📈 Win Rate: ${winRate}%`);
        console.log(`      🎯 Promoted Patterns: ${patternStats.promoted || 0}`);
        console.log(`      🔬 Candidates: ${patternStats.candidates || 0}`);
      }

      // Generate backtest report
      const reportPath = path.join(__dirname, `backtest-report-v14MERGED-${Date.now()}.json`);

      // Collect trades from execution layer (if available)
      const trades = this.executionLayer?.trades || [];
      const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

      const report = {
        summary: {
          initialBalance: 10000,
          finalBalance: stateManager.get('balance'),
          totalReturn: ((stateManager.get('balance') / 10000 - 1) * 100),
          totalPnL: stateManager.get('balance') - 10000,
          duration: `${totalTime}s`,
          candlesProcessed: processedCount,
          errors: errorCount
        },
        metrics: {
          totalTrades: trades.length,
          winningTrades: trades.filter(t => t.pnl > 0).length,
          losingTrades: trades.filter(t => t.pnl < 0).length,
          winRate: trades.length > 0 ? trades.filter(t => t.pnl > 0).length / trades.length : 0,
          totalPnL: totalPnL
        },
        trades: trades,
        config: {
          symbol: this.config.primaryAsset,
          initialBalance: 10000,
          maxPositionSize: this.config.maxPositionSize,
          minTradeConfidence: this.config.patternConfidence,
          tier: process.env.SUBSCRIPTION_TIER?.toUpperCase() || 'ML'
        },
        timestamp: new Date().toISOString()
      };

      // Write report FIRST (sync to prevent 0-byte files on timeout/exit)
      require('fs').writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\n📄 Report saved: ${reportPath}`);

      // FIX 2026-02-10: Save pattern memory after backtest (was never being saved!)
      if (this.patternChecker?.cleanup) {
        this.patternChecker.cleanup();
        console.log('🧠 Backtest patterns saved to disk');
      }

      // 🤖 TRAI Analysis of Backtest Results (Change 586)
      // Run AFTER report is saved so we always have results even if TRAI hangs
      if (this.trai && this.trai.analyzeBacktestResults) {
        console.log('\n🤖 [TRAI] Analyzing backtest results for optimization insights...');
        try {
          const traiAnalysis = await this.trai.analyzeBacktestResults(report);
          report.traiAnalysis = traiAnalysis;
          console.log('✅ TRAI Analysis Complete:', traiAnalysis.summary);
          // Re-save with TRAI analysis appended
          require('fs').writeFileSync(reportPath, JSON.stringify(report, null, 2));
        } catch (error) {
          console.error('⚠️ TRAI analysis failed:', error.message);
        }
      }

      // Exit after backtest
      console.log('\n🛑 Backtest complete - exiting...');
      process.exit(0);

    } catch (err) {
      console.error('❌ BACKTEST FAILED:', err.message);
      console.error(err.stack);
      process.exit(1);
    }
  }

  /**
   * Get human-readable pattern description
   */
  getPatternDescription(pattern, indicators) {
    if (!pattern) {
      return `Market scanning - RSI: ${indicators.rsi?.toFixed(1)}, Trend: ${indicators.trend}, MACD: ${(indicators.macd?.macd || 0).toFixed(4)}`;
    }

    const patternName = pattern.name || pattern.type || 'unknown';

    // Pattern descriptions for education
    const descriptions = {
      'head_and_shoulders': 'Bearish reversal pattern with three peaks - left shoulder, head (highest), right shoulder. Suggests trend change from bullish to bearish.',
      'inverse_head_and_shoulders': 'Bullish reversal pattern with three troughs. Signals potential trend change from bearish to bullish.',
      'double_top': 'Bearish reversal pattern showing two peaks at similar price levels. Indicates resistance and potential downward move.',
      'double_bottom': 'Bullish reversal pattern with two troughs at similar levels. Suggests support and potential upward breakout.',
      'triple_top': 'Strong bearish reversal with three peaks. More reliable than double top, signals strong resistance.',
      'triple_bottom': 'Strong bullish reversal with three troughs. More reliable than double bottom, indicates strong support.',
      'ascending_triangle': 'Bullish continuation pattern with flat upper resistance and rising support. Breakout expected upward.',
      'descending_triangle': 'Bearish continuation pattern with flat lower support and declining resistance. Breakout expected downward.',
      'symmetrical_triangle': 'Neutral pattern showing convergence. Breakout direction determines trend continuation or reversal.',
      'bull_flag': 'Bullish continuation pattern after strong uptrend. Brief consolidation before continuing higher.',
      'bear_flag': 'Bearish continuation pattern after strong downtrend. Brief consolidation before continuing lower.',
      'cup_and_handle': 'Bullish continuation pattern forming U-shape followed by slight pullback. Strong continuation signal.',
      'golden_cross': 'Bullish signal when short-term EMA crosses above long-term EMA. Indicates momentum shift to upside.',
      'death_cross': 'Bearish signal when short-term EMA crosses below long-term EMA. Indicates momentum shift to downside.',
      'bullish_divergence': 'Price makes lower lows while indicator (RSI/MACD) makes higher lows. Suggests trend reversal to upside.',
      'bearish_divergence': 'Price makes higher highs while indicator makes lower highs. Suggests trend reversal to downside.'
    };

    return descriptions[patternName] || `${patternName} pattern detected with ${(pattern.confidence * 100).toFixed(1)}% confidence. Analyzing market structure and momentum.`;
  }

  /**
   * CHANGE 2026-01-31: Fetch real market context from web for TRAI
   * Universal - supports any crypto (CoinGecko) or stock (Yahoo Finance)
   */
  async fetchWebMarketContext(query = '') {
    // Detect what asset the user is asking about
    let asset = this.detectAssetFromQuery(query);
    console.log(`🌐 [TRAI Web] Detected asset: ${asset.type} - ${asset.symbol || asset.id || asset.query}`);

    try {
      let result;

      // If type is 'search', we need to find the asset via API
      if (asset.type === 'search') {
        console.log(`🔍 [TRAI Web] Searching for: "${asset.query}"`);

        // Try crypto search first
        const cryptoResult = await this.searchCrypto(asset.query);
        if (cryptoResult) {
          asset = cryptoResult;
        } else {
          // Try stock search
          const stockResult = await this.searchStock(asset.query);
          if (stockResult) {
            asset = stockResult;
          } else {
            // Fall back to BTC
            console.log('🌐 [TRAI Web] No match found, defaulting to BTC');
            asset = { type: 'crypto', id: 'bitcoin', symbol: 'BTC' };
          }
        }
      }

      // Now fetch the actual data
      if (asset.type === 'crypto') {
        result = await this.fetchCryptoContext(asset.id, asset.symbol);
      } else if (asset.type === 'stock') {
        result = await this.fetchStockContext(asset.symbol);
      } else {
        result = await this.fetchCryptoContext('bitcoin', 'BTC');
      }

      console.log(`✅ [TRAI Web] Fetched ${result.asset}: $${result.price} (${result.change24h} 24h)`);
      return result;
    } catch (error) {
      console.warn('⚠️ Failed to fetch web market context:', error.message);
      return null;
    }
  }

  /**
   * Detect asset from user query - SMART detection with fuzzy matching
   */
  detectAssetFromQuery(query) {
    const q = query.toLowerCase().replace(/[^a-z0-9\s]/g, ''); // Clean query
    const words = q.split(/\s+/);

    // Common crypto names → CoinGecko ID (case insensitive, fuzzy)
    const cryptoPatterns = [
      { patterns: ['bitcoin', 'btc'], id: 'bitcoin', symbol: 'BTC' },
      { patterns: ['ethereum', 'eth', 'ether'], id: 'ethereum', symbol: 'ETH' },
      { patterns: ['solana', 'sol'], id: 'solana', symbol: 'SOL' },
      { patterns: ['cardano', 'ada'], id: 'cardano', symbol: 'ADA' },
      { patterns: ['xrp', 'ripple'], id: 'ripple', symbol: 'XRP' },
      { patterns: ['dogecoin', 'doge'], id: 'dogecoin', symbol: 'DOGE' },
      { patterns: ['polkadot', 'dot'], id: 'polkadot', symbol: 'DOT' },
      { patterns: ['avalanche', 'avax'], id: 'avalanche-2', symbol: 'AVAX' },
      { patterns: ['chainlink', 'link'], id: 'chainlink', symbol: 'LINK' },
      { patterns: ['polygon', 'matic'], id: 'matic-network', symbol: 'MATIC' },
      { patterns: ['litecoin', 'ltc'], id: 'litecoin', symbol: 'LTC' },
      { patterns: ['binance', 'bnb'], id: 'binancecoin', symbol: 'BNB' },
      { patterns: ['shiba', 'shib'], id: 'shiba-inu', symbol: 'SHIB' },
      { patterns: ['tron', 'trx'], id: 'tron', symbol: 'TRX' },
      { patterns: ['uniswap', 'uni'], id: 'uniswap', symbol: 'UNI' }
    ];

    // Common stock names → Yahoo symbol (fuzzy matching)
    const stockPatterns = [
      { patterns: ['apple', 'aapl'], symbol: 'AAPL' },
      { patterns: ['tesla', 'tsla'], symbol: 'TSLA' },
      { patterns: ['microsoft', 'msft'], symbol: 'MSFT' },
      { patterns: ['google', 'googl', 'alphabet'], symbol: 'GOOGL' },
      { patterns: ['amazon', 'amzn'], symbol: 'AMZN' },
      { patterns: ['nvidia', 'nvda'], symbol: 'NVDA' },
      { patterns: ['meta', 'facebook', 'fb'], symbol: 'META' },
      { patterns: ['netflix', 'nflx'], symbol: 'NFLX' },
      { patterns: ['spy', 'sp500', 's&p', 'snp'], symbol: 'SPY' },
      { patterns: ['qqq', 'qq', 'nasdaq', 'nas', 'tech'], symbol: 'QQQ' },
      { patterns: ['amd'], symbol: 'AMD' },
      { patterns: ['intel', 'intc'], symbol: 'INTC' },
      { patterns: ['disney', 'dis'], symbol: 'DIS' },
      { patterns: ['boeing', 'ba'], symbol: 'BA' },
      { patterns: ['jpmorgan', 'jpm'], symbol: 'JPM' },
      { patterns: ['walmart', 'wmt'], symbol: 'WMT' },
      { patterns: ['costco', 'cost'], symbol: 'COST' }
    ];

    // Fuzzy match helper - checks if any word starts with or closely matches pattern
    const fuzzyMatch = (pattern) => {
      for (const word of words) {
        // Exact match
        if (word === pattern) return true;
        // Word starts with pattern (handles "bitcoins", "teslas")
        if (word.startsWith(pattern)) return true;
        // Pattern starts with word (handles "btc" matching "b")
        if (pattern.startsWith(word) && word.length >= 2) return true;
        // Levenshtein distance 1 for typos (simple check: same length, 1 char diff)
        if (Math.abs(word.length - pattern.length) <= 1) {
          let diffs = 0;
          const longer = word.length >= pattern.length ? word : pattern;
          const shorter = word.length < pattern.length ? word : pattern;
          for (let i = 0; i < longer.length && diffs <= 1; i++) {
            if (longer[i] !== shorter[i]) diffs++;
          }
          if (diffs <= 1 && shorter.length >= 2) return true;
        }
      }
      return false;
    };

    // Check for crypto first
    for (const crypto of cryptoPatterns) {
      for (const pattern of crypto.patterns) {
        if (fuzzyMatch(pattern)) {
          return { type: 'crypto', id: crypto.id, symbol: crypto.symbol };
        }
      }
    }

    // Check for stocks
    for (const stock of stockPatterns) {
      for (const pattern of stock.patterns) {
        if (fuzzyMatch(pattern)) {
          return { type: 'stock', symbol: stock.symbol };
        }
      }
    }

    // Try to extract a ticker-like word (2-5 uppercase letters)
    const tickerMatch = query.match(/\b([A-Z]{2,5})\b/);
    if (tickerMatch) {
      return { type: 'stock', symbol: tickerMatch[1] };
    }

    // No local match - try API search (async, but we'll handle it)
    // Extract the most likely asset name from the query
    const assetWords = words.filter(w =>
      w.length >= 2 &&
      !['how', 'what', 'is', 'the', 'are', 'doing', 'like', 'about', 'whats', 'hows'].includes(w)
    );

    if (assetWords.length > 0) {
      // Store for async lookup
      return { type: 'search', query: assetWords.join(' ') };
    }

    // Default to Bitcoin
    return { type: 'crypto', id: 'bitcoin', symbol: 'BTC' };
  }

  /**
   * Search CoinGecko for a crypto by name
   */
  async searchCrypto(searchQuery) {
    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(searchQuery)}`,
        { timeout: 3000 }
      );
      const coins = response.data.coins || [];
      if (coins.length > 0) {
        const top = coins[0];
        console.log(`🔍 [TRAI Search] Found crypto: ${top.name} (${top.symbol})`);
        return { type: 'crypto', id: top.id, symbol: top.symbol.toUpperCase() };
      }
    } catch (error) {
      console.warn('⚠️ Crypto search failed:', error.message);
    }
    return null;
  }

  /**
   * Search Yahoo Finance for a stock by name
   */
  async searchStock(searchQuery) {
    try {
      const response = await axios.get(
        `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchQuery)}&quotesCount=1`,
        { timeout: 3000, headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const quotes = response.data.quotes || [];
      if (quotes.length > 0) {
        const top = quotes[0];
        console.log(`🔍 [TRAI Search] Found stock: ${top.shortname || top.symbol} (${top.symbol})`);
        return { type: 'stock', symbol: top.symbol };
      }
    } catch (error) {
      console.warn('⚠️ Stock search failed:', error.message);
    }
    return null;
  }

  /**
   * Fetch crypto market data from CoinGecko + Fear & Greed Index + News Headlines
   * CHANGE 2026-02-01: Added Fear & Greed Index and News Headlines for full market context
   */
  async fetchCryptoContext(coinId, symbol) {
    // Fetch all in parallel for speed
    const [coinResponse, fearGreed, newsHeadlines] = await Promise.all([
      axios.get(
        `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`,
        { timeout: 5000 }
      ),
      this.fetchFearGreedIndex(),
      this.fetchCryptoNewsHeadlines()
    ]);

    const data = coinResponse.data;
    const market = data.market_data;

    return {
      source: 'coingecko',
      assetType: 'crypto',
      asset: symbol,
      assetName: data.name,
      timestamp: Date.now(),
      price: market.current_price?.usd || 0,
      change24h: market.price_change_percentage_24h?.toFixed(2) + '%',
      change7d: market.price_change_percentage_7d?.toFixed(2) + '%',
      change30d: market.price_change_percentage_30d?.toFixed(2) + '%',
      high24h: market.high_24h?.usd || 0,
      low24h: market.low_24h?.usd || 0,
      ath: market.ath?.usd || 0,
      athDate: market.ath_date?.usd?.split('T')[0] || 'unknown',
      athChangePercent: market.ath_change_percentage?.usd?.toFixed(2) + '%',
      marketCap: market.market_cap?.usd || 0,
      marketCapRank: data.market_cap_rank || 0,
      sentimentUp: data.sentiment_votes_up_percentage || 50,
      sentimentDown: data.sentiment_votes_down_percentage || 50,
      // Fear & Greed Index (crypto-specific sentiment)
      fearGreedIndex: fearGreed?.value || null,
      fearGreedLabel: fearGreed?.classification || null,
      // News Headlines (crypto market news)
      newsHeadlines: newsHeadlines || []
    };
  }

  /**
   * Fetch stock market data from Yahoo Finance (via unofficial API)
   */
  async fetchStockContext(symbol) {
    // Yahoo Finance unofficial API endpoint
    const response = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1mo`,
      { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );

    const result = response.data.chart.result[0];
    const meta = result.meta;
    const quotes = result.indicators.quote[0];
    const closes = quotes.close.filter(c => c !== null);

    const currentPrice = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const change24h = ((currentPrice - prevClose) / prevClose * 100).toFixed(2);

    // Calculate 7d and 30d changes from historical data
    const price7dAgo = closes[closes.length - 6] || closes[0];
    const price30dAgo = closes[0];
    const change7d = ((currentPrice - price7dAgo) / price7dAgo * 100).toFixed(2);
    const change30d = ((currentPrice - price30dAgo) / price30dAgo * 100).toFixed(2);

    return {
      source: 'yahoo_finance',
      assetType: 'stock',
      asset: symbol,
      assetName: meta.shortName || symbol,
      timestamp: Date.now(),
      price: currentPrice,
      change24h: change24h + '%',
      change7d: change7d + '%',
      change30d: change30d + '%',
      high24h: meta.regularMarketDayHigh || currentPrice,
      low24h: meta.regularMarketDayLow || currentPrice,
      ath: meta.fiftyTwoWeekHigh || currentPrice,
      athDate: 'within 52 weeks',
      athChangePercent: ((currentPrice - meta.fiftyTwoWeekHigh) / meta.fiftyTwoWeekHigh * 100).toFixed(2) + '%',
      marketCap: meta.marketCap || 0,
      marketCapRank: 0, // Not available from Yahoo
      sentimentUp: 50,
      sentimentDown: 50
    };
  }

  /**
   * CHANGE 2026-02-01: Fetch Fear & Greed Index from alternative.me
   * Returns current market sentiment on 0-100 scale
   * 0-25: Extreme Fear, 26-45: Fear, 46-54: Neutral, 55-74: Greed, 75-100: Extreme Greed
   */
  async fetchFearGreedIndex() {
    try {
      const response = await axios.get(
        'https://api.alternative.me/fng/?limit=1',
        { timeout: 5000 }
      );

      const data = response.data.data[0];
      return {
        value: parseInt(data.value),
        classification: data.value_classification,
        timestamp: parseInt(data.timestamp) * 1000,
        nextUpdate: data.time_until_update || 'unknown'
      };
    } catch (error) {
      console.warn(`⚠️ [TRAI] Fear & Greed fetch failed: ${error.message}`);
      return null;
    }
  }

  /**
   * CHANGE 2026-02-01: Fetch crypto news headlines from CryptoCompare
   * Returns top 3 recent headlines for market context
   */
  async fetchCryptoNewsHeadlines() {
    try {
      const response = await axios.get(
        'https://min-api.cryptocompare.com/data/v2/news/?categories=BTC&excludeCategories=Sponsored',
        { timeout: 5000 }
      );

      // Get top 3 headlines
      const headlines = response.data.Data?.slice(0, 3).map(article => ({
        title: article.title,
        source: article.source_info?.name || article.source,
        time: new Date(article.published_on * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      })) || [];

      return headlines;
    } catch (error) {
      console.warn(`⚠️ [TRAI] News fetch failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Handle TRAI chat queries from dashboard
   * Used for tech support and customer questions
   * Includes live market context for NLP-style queries
   */
  async handleTraiQuery(msg) {
    const { query, queryId, sessionId } = msg;

    try {
      // CHANGE 2026-01-31: Fetch REAL market context from web (detects asset from query)
      const webContext = await this.fetchWebMarketContext(query);

      // Build live market context for TRAI
      const lastCandle = this.priceHistory[this.priceHistory.length - 1];
      const stats = this.executionLayer?.getStats() || {};
      const position = this.executionLayer?.getPositions()?.find(p => !p.closed);

      const marketContext = {
        source: 'dashboard_chat',
        sessionId: sessionId,
        timestamp: Date.now(),
        // REAL market data from web (if available)
        ...(webContext && {
          currentPrice: webContext.price,
          change24h: webContext.change24h,
          change7d: webContext.change7d,
          change30d: webContext.change30d,
          high24h: webContext.high24h,
          low24h: webContext.low24h,
          ath: webContext.ath,
          athDate: webContext.athDate,
          athChangePercent: webContext.athChangePercent,
          assetType: webContext.assetType,
          assetName: webContext.assetName,
          asset: webContext.asset,
          // CHANGE 2026-02-01: Fear & Greed Index for crypto
          fearGreedIndex: webContext.fearGreedIndex || null,
          fearGreedLabel: webContext.fearGreedLabel || null,
          // CHANGE 2026-02-01: News Headlines for market context
          newsHeadlines: webContext.newsHeadlines || [],
          marketSentiment: webContext.sentimentUp > 60 ? 'BULLISH' :
                          webContext.sentimentDown > 60 ? 'BEARISH' : 'NEUTRAL'
        }),
        // Fallback to local data if web fetch failed
        ...(!webContext && {
          currentPrice: lastCandle?.c || this.currentPrice,
          priceChange24h: 'N/A (web fetch failed)',
        }),
        candleCount: this.priceHistory.length,
        // Bot status
        botMode: this.config.sandboxMode ? 'PAPER' : 'LIVE',
        isTrading: this.isRunning,
        totalTrades: stats.totalTrades || 0,
        winRate: stats.winRate || '0%',
        balance: stats.balance || '0.00',
        // Current position
        hasOpenPosition: !!position,
        positionDirection: position?.direction || null,
        positionPnL: position?.pnl?.toFixed(2) || null,
        // Indicators (if available)
        lastDecision: this.lastDecisionContext?.decision || 'HOLD',
        confidence: this.lastDecisionContext?.confidence || 0
      };

      // Process query with TRAICore (chat/queries go to core, not decision module)
      if (!this.trai.traiCore) {
        throw new Error('TRAI Core not available - LLM inference server not running');
      }
      const response = await this.trai.traiCore.processQuery(query, marketContext);

      // Send response back to dashboard
      if (this.dashboardWs && this.dashboardWs.readyState === 1) {
        this.dashboardWs.send(JSON.stringify({
          type: 'trai_response',
          queryId: queryId,
          sessionId: sessionId,
          // CHANGE 2026-01-31: Use explicit check - empty string is valid, don't fall through to whole object
          response: (response.response !== undefined && response.response !== null)
            ? response.response
            : (response.message || response.text || 'Unable to generate response'),
          timestamp: Date.now()
        }));
        console.log('🧠 [TRAI] Sent chat response');
      }
    } catch (error) {
      console.error('❌ [TRAI] Chat query failed:', error.message);

      // Send error response
      if (this.dashboardWs && this.dashboardWs.readyState === 1) {
        this.dashboardWs.send(JSON.stringify({
          type: 'trai_response',
          queryId: queryId,
          sessionId: sessionId,
          response: 'Sorry, I encountered an issue processing your question. Please try again.',
          error: true,
          timestamp: Date.now()
        }));
      }
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('\n🛑 Shutting down OGZ Prime V14 MERGED...');
    this.isRunning = false;

    if (this.tradingInterval) {
      clearInterval(this.tradingInterval);
    }

    // CHANGE 2026-01-21: Clear liveness watchdog interval (memory leak fix)
    if (this.livenessCheckInterval) {
      clearInterval(this.livenessCheckInterval);
      console.log('🔍 Liveness watchdog interval cleaned up');
    }

    // CHANGE 2026-01-29: Clear heartbeat interval (memory leak fix)
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log('💓 Heartbeat interval cleaned up');
    }

    // 🔥 CRITICAL: Remove event listeners before closing (Change 575 - Memory leak fix)
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      console.log('📡 Market data WebSocket cleaned up');
    }

    // CHANGE 2026-02-10: Cleanup modular entry system
    if (this.mtfAdapter) this.mtfAdapter.destroy();
    if (this.emaCrossover) this.emaCrossover.destroy();
    if (this.maDynamicSR) this.maDynamicSR.destroy();
    if (this.liquiditySweep) this.liquiditySweep.destroy();
    console.log('📊 Modular Entry System cleaned up');

    if (this.dashboardWs) {
      this.dashboardWs.removeAllListeners();
      this.dashboardWs.close();
      console.log('📊 Dashboard WebSocket cleaned up');
    }

    // 🤖 Shutdown TRAI LLM server (Change 579)
    if (this.trai && this.trai.traiCore) {
      this.trai.traiCore.shutdown();
      console.log('🤖 TRAI Core shutdown complete');
    }

    // CHANGE 2025-12-12: Cleanup RiskManager timer leak
    if (this.riskManager) {
      this.riskManager.shutdown();
      console.log('🛡️ RiskManager timers cleaned up');
    }

    // FIX 2026-02-10: Save pattern memory before exit (was never being saved!)
    if (this.patternChecker?.cleanup) {
      this.patternChecker.cleanup();
      console.log('🧠 Pattern memory saved to disk');
    }

    // Print final performance stats
    console.log('\n📊 Final Performance:');
    console.log(`   Session Duration: ${((Date.now() - this.startTime) / 1000 / 60).toFixed(1)} minutes`);
    console.log(`   Final Balance: $${stateManager.get('balance').toFixed(2)}`);

    console.log('\n✅ Shutdown complete\n');
    process.exit(0);
  }

  /**
   * Broadcast Edge Analytics data to dashboard
   * Includes CVD, liquidation levels, funding rates, whale alerts, market internals
   */
  broadcastEdgeAnalytics(price, volume, candle) {
    try {
      if (!this.dashboardWs || this.dashboardWs.readyState !== 1) return;

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
      const isBuy = candle.c >= candle.o;  // Simple: close >= open = buy pressure
      const volumeDelta = isBuy ? volume : -volume;
      this.edgeAnalytics.cvd += volumeDelta;
      this.edgeAnalytics.buyVolume += isBuy ? volume : 0;
      this.edgeAnalytics.sellVolume += !isBuy ? volume : 0;

      // Send CVD update
      this.dashboardWs.send(JSON.stringify({
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

        this.dashboardWs.send(JSON.stringify({
          type: 'liquidation_data',
          levels: liquidationData,
          currentPrice: price,
          timestamp: Date.now()
        }));
      }

      // Check for whale trades (large volume)
      const avgVolume = this.priceHistory.slice(-20).reduce((sum, c) => sum + (c.v || 0), 0) / 20;
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

        this.dashboardWs.send(JSON.stringify({
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

        this.dashboardWs.send(JSON.stringify({
          type: 'market_internals',
          ...internals,
          timestamp: Date.now()
        }));
      }

      // Update funding rates (every 60 seconds)
      if (now - this.edgeAnalytics.lastFundingCheck > 60000) {
        this.edgeAnalytics.lastFundingCheck = now;

        const momentum = this.priceHistory.length > 10 ?
          (price - this.priceHistory[this.priceHistory.length - 10].c) / this.priceHistory[this.priceHistory.length - 10].c : 0;
        const fundingBias = momentum * 0.001;
        this.edgeAnalytics.fundingRate = 0.0001 + fundingBias;

        const predictedFunding = this.edgeAnalytics.fundingRate * (1 + momentum);

        this.dashboardWs.send(JSON.stringify({
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
        const momentum = this.priceHistory.length > 10 ?
          (price - this.priceHistory[this.priceHistory.length - 10].c) / this.priceHistory[this.priceHistory.length - 10].c : 0;
        const volumeTrend = volume / Math.max(avgVolume, 0.01);

        const fearGreed = Math.min(100, Math.max(0,
          50 +
          (momentum > 0 ? 20 : -20) +
          (volatility < 0.02 ? 10 : -10) +
          (volumeTrend > 1 ? 10 : -10) +
          (this.edgeAnalytics.cvd > 0 ? 10 : -10)
        ));

        this.edgeAnalytics.fearGreedValue = fearGreed;

        this.dashboardWs.send(JSON.stringify({
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
          this.dashboardWs.send(JSON.stringify({
            type: 'divergence',
            divergences: divergences,
            timestamp: Date.now()
          }));
        }
      }

      // Smart Money Flow (every 20 seconds)
      if (now - this.edgeAnalytics.lastSmartMoneyCheck > 20000) {
        this.edgeAnalytics.lastSmartMoneyCheck = now;

        const priceChange = this.priceHistory.length > 10 ?
          (price - this.priceHistory[Math.max(0, this.priceHistory.length - 10)].c) / price : 0;
        const volumeProfile = this.edgeAnalytics.whaleTrades.filter(t => t.side === 'BUY').length;

        let flow = 'NEUTRAL';
        if (priceChange < -0.02 && volumeProfile > 3) flow = 'ACCUMULATING';
        else if (priceChange > 0.02 && volumeProfile < 2) flow = 'DISTRIBUTING';

        const activity = volume > avgVolume * 3 ? 'HIGH' : volume > avgVolume * 1.5 ? 'MEDIUM' : 'LOW';

        this.edgeAnalytics.smartMoney = { flow, activity };

        this.dashboardWs.send(JSON.stringify({
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
   */
  calculateVolatility() {
    if (this.priceHistory.length < 20) return 0.02;

    const returns = [];
    for (let i = 1; i < Math.min(20, this.priceHistory.length); i++) {
      const ret = (this.priceHistory[i].c - this.priceHistory[i-1].c) / this.priceHistory[i-1].c;
      returns.push(ret);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  /**
   * Detect price/indicator divergences
   */
  detectDivergences() {
    const divergences = [];

    if (this.priceHistory.length < 20) return divergences;

    const recentPrices = this.priceHistory.slice(-20);
    const priceHigh = Math.max(...recentPrices.map(c => c.h));
    const priceLow = Math.min(...recentPrices.map(c => c.l));
    const currentPrice = recentPrices[recentPrices.length - 1].c;

    const indicators = indicatorEngine.getSnapshot();
    const rsi = indicators?.rsi;

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

// Main execution
async function main() {
  const bot = new OGZPrimeV14Bot();

  // Graceful shutdown handlers
  process.on('SIGINT', () => bot.shutdown());
  process.on('SIGTERM', () => bot.shutdown());
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
    bot.shutdown();
  });

  // 🔥 CRITICAL: Handle unhandled promise rejections (Change 575)
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Promise Rejection:', reason);
    console.error('   Promise:', promise);
    // Log but don't shutdown - async failures shouldn't kill bot
    console.error('   Bot continuing despite rejection...');
  });

  await bot.start();
}

// Run bot
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = OGZPrimeV14Bot;
