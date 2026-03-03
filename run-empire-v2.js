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
        msg.includes('âŒ Error') ||
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
 * â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
 * â”‚                         run-empire-v2.js (ORCHESTRATOR)                 â”‚
 * â”‚                                                                         â”‚
 * â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
 * â”‚  â”‚   KRAKEN    â”‚â”€â”€â”€â–¶â”‚  INDICATORS    â”‚â”€â”€â”€â–¶â”‚  PATTERN RECOGNITION     â”‚ â”‚
 * â”‚  â”‚  WEBSOCKET  â”‚    â”‚  (RSI,MACD,BB) â”‚    â”‚  (EnhancedPatternRecog)  â”‚ â”‚
 * â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
 * â”‚         â”‚                   â”‚                        â”‚                  â”‚
 * â”‚         â–¼                   â–¼                        â–¼                  â”‚
 * â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
 * â”‚  â”‚   REGIME    â”‚â—€â”€â”€â”€â”‚  TRADING BRAIN â”‚â—€â”€â”€â”€â”‚      TRAI (AI)           â”‚ â”‚
 * â”‚  â”‚  DETECTOR   â”‚    â”‚  (Decisions)   â”‚    â”‚  (Optional co-pilot)     â”‚ â”‚
 * â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
 * â”‚                            â”‚                                            â”‚
 * â”‚                            â–¼                                            â”‚
 * â”‚                     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”                                  â”‚
 * â”‚                     â”‚  RISK MANAGER  â”‚                                  â”‚
 * â”‚                     â”‚  (Pre-trade)   â”‚                                  â”‚
 * â”‚                     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                                  â”‚
 * â”‚                            â”‚                                            â”‚
 * â”‚                            â–¼                                            â”‚
 * â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
 * â”‚  â”‚   STATE     â”‚â—€â”€â”€â”€â”‚  EXECUTION     â”‚â”€â”€â”€â–¶â”‚  KRAKEN API              â”‚ â”‚
 * â”‚  â”‚  MANAGER    â”‚    â”‚  LAYER         â”‚    â”‚  (Paper or Live)         â”‚ â”‚
 * â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
 * â”‚         â”‚                                                               â”‚
 * â”‚         â–¼                                                               â”‚
 * â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”                                                        â”‚
 * â”‚  â”‚  DASHBOARD  â”‚  (WebSocket to browser)                               â”‚
 * â”‚  â”‚  UPDATES    â”‚                                                        â”‚
 * â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                                                        â”‚
 * â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
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
  console.error('âŒ FATAL: TEST_MODE=true requires DATA_DIR to be set');
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

// FIX 2026-02-16: Use centralized candle helper for format compatibility (backtest vs live)
const { c: _c, o: _o, h: _h, l: _l, v: _v } = require('./core/CandleHelper');

// PHASE 0: ContractValidator - validates data contracts at module boundaries
// Monitor mode: logs violations but doesn't throw (zero behavioral impact)
// See: ogz-meta/REFACTOR-PLAN-2026-02-27.md
const { ContractValidator } = require('./core/ContractValidator');
const contractValidator = ContractValidator.createMonitor();

// PHASE 1: CandleStore + IndicatorCalculator - pure data and math modules
// CandleStore: stores candles by symbol/timeframe (will replace this.priceHistory)
// IndicatorCalculator: stateless indicator calculations (pure math)
// See: ogz-meta/REFACTOR-PLAN-2026-02-27.md
const { CandleStore } = require('./core/CandleStore');
const { IndicatorCalculator } = require('./core/IndicatorCalculator');

// PHASE 2: IndicatorSnapshot - THE single reshape point for indicators
// Creates canonical indicator object from raw engine output. No fallback paths.
// See: ogz-meta/REFACTOR-PLAN-2026-02-27.md
const { IndicatorSnapshot } = require('./core/IndicatorSnapshot');

// PHASE 3: CandleAggregator + RegimeDetector - pure functions
// CandleAggregator: builds higher timeframe candles from 1m candles
// RegimeDetector: detects market regime (trending/ranging/volatile)
// See: ogz-meta/REFACTOR-PLAN-2026-02-27.md
const { CandleAggregator } = require('./core/CandleAggregator');
const { RegimeDetector } = require('./core/RegimeDetector');

// REFACTOR Phase 4: FeatureExtractor + PatternMemoryStore
const FeatureExtractor = require('./core/FeatureExtractor');
const PatternMemoryStore = require('./core/PatternMemoryStore');

// REFACTOR Phase 5: OrderRouter for multi-broker order routing
const OrderRouter = require('./core/OrderRouter');

// REFACTOR Phase 14: OrderExecutor - exact copy of executeTrade() extracted
const OrderExecutor = require('./core/OrderExecutor');

// REFACTOR Phase 15: TradingLoop - exact copy of analyzeAndTrade() extracted
const TradingLoop = require('./core/TradingLoop');

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

// FIX 2026-02-17: ExitContractManager - Strategy-owned exit conditions
const { getInstance: getExitContractManager } = require('./core/ExitContractManager');
const exitContractManager = getExitContractManager();

// CHANGE 2026-02-28: TradingConfig - Centralized trading parameters
const TradingConfig = require('./core/TradingConfig');

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
const BreakAndRetest = require('./modules/BreakAndRetest');
const LiquiditySweepDetector = require('./modules/LiquiditySweepDetector');

// CHANGE 2026-02-10: Multi-Asset Manager for asset switching
const MultiAssetManager = require('./core/MultiAssetManager');

// CHANGE 2026-02-10: Trade Journal + Instant Replay
const { TradeJournalBridge } = require('./core/TradeJournalBridge');

// CHANGE 2026-02-16: Pipeline Snapshot for 30-min state capture
const PipelineSnapshot = require('./core/PipelineSnapshot');

// CHANGE 2026-02-23: Volume Profile (Fabio Valentino / Auction Market Theory)
// Only trend follow when OUT OF BALANCE (price outside value area)
const VolumeProfile = require('./core/VolumeProfile');

// CHANGE 2026-02-21: Isolated strategy entry pipeline (replaces soupy pooled confidence)
const { StrategyOrchestrator } = require('./core/StrategyOrchestrator');
const { AdaptiveTimeframeSelector } = require('./core/AdaptiveTimeframeSelector');

// PHASE 13A: Position management with immutability guarantees
const PnLCalculator = require('./core/PnLCalculator');
const PositionSizer = require('./core/PositionSizer');
const PositionTracker = require('./core/PositionTracker');

// CHANGE 2026-02-23: BacktestRecorder for proper trade tracking with fees
const BacktestRecorder = require('./core/BacktestRecorder');

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
    console.log('â­ï¸ Skipping singleton lock (BACKTEST_MODE)');
  }
  // Skip port check in backtest mode for faster testing
  if (process.env.BACKTEST_MODE !== 'true') {
    // CHANGE 660: Remove port 3010 from check - it's the WebSocket SERVER we connect TO
    // Bot is a CLIENT of 3010, not binding it
    const portsOk = await checkCriticalPorts([3001, 3002, 3003]);
    if (!portsOk) {
      console.error('ðŸš¨ Critical ports in use! Exiting...');
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
const EntryDecider = loader.get('core', 'EntryDecider');
console.log('  EntryDecider:', !!EntryDecider);
// REMOVED 2026-02-20: ExecutionRateLimiter was blocking 95% of trades in backtest
// const ExecutionRateLimiter = loader.get('core', 'ExecutionRateLimiter');
const AdvancedExecutionLayer = loader.get('core', 'AdvancedExecutionLayer-439-MERGED');
console.log('  AdvancedExecutionLayer:', !!AdvancedExecutionLayer);
const PerformanceAnalyzer = loader.get('core', 'PerformanceAnalyzer');
const TradingProfileManager = loader.get('core', 'TradingProfileManager');
const GridTradingStrategy = loader.get('core', 'GridTradingStrategy');

// Change 587: Wire SafetyNet and TradeLogger into live loop
// Both removed - SafetyNet too restrictive, TradeLogger doesn't exist
// const TradingSafetyNet = require('./core/TradingSafetyNet');
// CHANGE 2026-02-13: Re-enable TradeLogger for comprehensive trade logging
const { logTrade, getTodayStats } = require('./core/tradeLogger');

// ðŸ¤– AI Co-Founder (Change 574 - Opus Architecture + Codex Fix)
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
    console.log('\nðŸš€ OGZ PRIME V14 FINAL MERGED - INITIALIZING');
    console.log('ðŸ“Š Desktop Claude (402-line) + Browser Claude (439-line) = MERGED');
    console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');

    // Environment validation
    this.validateEnvironment();

    // TWO-KEY TURN SAFETY: Require double confirmation for live trading
    this.verifyTradingMode();

    // Tier configuration
    this.tier = process.env.BOT_TIER || 'ml';
    this.tierFlagManager = new TierFeatureFlags(this.tier);
    this.tierFlags = this.tierFlagManager.getTierSummary();
    console.log(`ðŸŽ¯ Tier: ${this.tier.toUpperCase()}`);

    // Initialize core modules
    console.log('[CHECKPOINT-008] Creating pattern checker...');
    if (!EnhancedPatternChecker) {
      console.error('âŒ EnhancedPatternChecker is undefined! Module loading failed.');
      process.exit(1);
    }
    this.patternChecker = new EnhancedPatternChecker();
    console.log('[CHECKPOINT-009] EnhancedPatternChecker created');

    // Initialize OGZ Two-Pole Oscillator (pure function implementation from V2)
    this.ogzTpo = this.tierFlagManager.isEnabled('ogzTpoEnabled')
      ? OgzTpoIntegration.fromTierFlags(this.tierFlagManager)
      : null;

    if (this.ogzTpo) {
      console.log('ðŸŽ¯ OGZ TPO initialized with mode:', this.tierFlagManager.getValue('ogzTpoMode'));
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
    console.log(`ðŸ“Š Trading Profile: ${initialProfile.toUpperCase()} (manual switching only)`);

    // CHANGE 610: Centralized configuration - all trading params from .env
    // Profile settings are for reference only - env vars take precedence
    const tradingBrainConfig = {
      // Tier settings
      enableQuantumSizing: this.tierFlags.hasQuantumPositionSizer,
      tier: this.tier,

      // CHANGE 2026-02-28: All trading params from TradingConfig (single source of truth)
      // Confidence
      minConfidenceThreshold: TradingConfig.get('confidence.minTradeConfidence'),
      maxConfidenceThreshold: TradingConfig.get('confidence.maxConfidence'),
      confidencePenalty: TradingConfig.get('confidence.confidencePenalty'),
      confidenceBoost: TradingConfig.get('confidence.confidenceBoost'),

      // Risk management
      maxRiskPerTrade: TradingConfig.get('risk.maxRiskPerTrade'),

      // Exit parameters
      stopLossPercent: TradingConfig.get('exits.stopLossPercent'),
      takeProfitPercent: TradingConfig.get('exits.takeProfitPercent'),
      trailingStopPercent: TradingConfig.get('exits.trailingStopPercent'),
      trailingStopActivation: TradingConfig.get('exits.trailingActivation'),
      profitProtectionLevel: TradingConfig.get('exits.profitProtectionLevel'),
      breakevenTrigger: TradingConfig.get('exits.breakevenTrigger'),
      breakevenPercentage: TradingConfig.get('exits.breakevenExitPercent'),
      postBreakevenTrailing: TradingConfig.get('exits.postBreakevenTrail'),

      // Position sizing
      basePositionSize: TradingConfig.get('positionSizing.basePositionSize'),
      maxPositionSize: TradingConfig.get('positionSizing.maxPositionSize'),
      lowVolatilityMultiplier: TradingConfig.get('positionSizing.lowVolMultiplier'),
      highVolatilityMultiplier: TradingConfig.get('positionSizing.highVolMultiplier'),
      volatilityThresholds: {
        low: TradingConfig.get('positionSizing.lowVolThreshold'),
        high: TradingConfig.get('positionSizing.highVolThreshold')
      },

      // Fund target
      houstonFundTarget: TradingConfig.get('fundTarget')
    };

    // Pass feature flags to TradingBrain
    tradingBrainConfig.featureFlags = featureFlags.features || {};
    tradingBrainConfig.patternDominance = featureFlags.features.PATTERN_DOMINANCE?.enabled || false;

    this.tradingBrain = new OptimizedTradingBrain(
      parseFloat(process.env.INITIAL_BALANCE) || 10000,
      tradingBrainConfig
    );

    // Phase 12: Expose module-level tradingOptimizations for EntryDecider
    this.tradingOptimizations = tradingOptimizations;

    // CHANGE 2026-02-21: Isolated strategy entry pipeline (replaces soupy pooled confidence)
    // Each strategy evaluates independently. Highest confidence WINS and OWNS the trade.
    // Confluence only affects POSITION SIZING, not the entry decision.
    this.strategyOrchestrator = new StrategyOrchestrator({
      // CHANGE 2026-02-28: Use TradingConfig for minStrategyConfidence
      minStrategyConfidence: TradingConfig.get('confidence.minStrategyConfidence'),
      minConfluenceCount: 1,         // 1 = winner alone can trade
    });

    // Fibonacci level detection for strategy context (supports EMA bounce + fib confluence)
    const FibonacciDetector = require('./core/FibonacciDetector');
    this.fibonacciDetector = new FibonacciDetector({
      lookbackCandles: 100,
      strengthRequired: 3,
      proximityThreshold: 0.5,
    });

    this.riskManager = new RiskManager({
      // CHANGE 2026-02-28: Use TradingConfig
      maxDailyLoss: TradingConfig.get('risk.maxDailyLoss'),
      maxDrawdown: TradingConfig.get('risk.maxDrawdown')
    });

    // Phase 9: EntryDecider - gate checks BEFORE execution (fixes bug where gates ran after)
    this.entryDecider = new EntryDecider({
      riskManager: this.riskManager,
      tradingBrain: this.tradingBrain,
      stateManager: stateManager,
      tierFlags: this.tierFlags
    });

    // PHASE 13A: Position management with immutability guarantees
    this.pnlCalculator = new PnLCalculator();
    this.positionSizer = new PositionSizer();
    this.positionTracker = new PositionTracker();

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

    // Initialize Pattern Exit Model (shadow mode by default)
    this.patternExitModel = null;
    if (featureFlags.features.PATTERN_EXIT_MODEL?.enabled) {
      const PatternBasedExitModel = require('./core/PatternBasedExitModel');
      this.patternExitModel = new PatternBasedExitModel(featureFlags.features.PATTERN_EXIT_MODEL.settings || {});
      this.patternExitShadowMode = featureFlags.features.PATTERN_EXIT_MODEL.shadowMode !== false;
      console.log(`ðŸŽ¯ Pattern Exit Model: ${this.patternExitShadowMode ? 'SHADOW MODE' : 'ACTIVE'}`);
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
    console.log(`ðŸ§  Trade Intelligence Engine: ${this.tradeIntelligenceShadowMode ? 'SHADOW MODE' : 'ACTIVE'}`);

    // CHANGE 2026-02-10: Modular Entry System (V2 format: c/o/h/l/v/t)
    this.mtfAdapter = new MultiTimeframeAdapter({
      activeTimeframes: ['1m', '5m', '15m', '1h', '4h', '1d'],
    });

    // CHANGE 2026-02-21: Adaptive timeframe selection based on market conditions
    this.timeframeSelector = new AdaptiveTimeframeSelector({
      mtfAdapter: this.mtfAdapter,
      feePercent: 0.26,                            // Kraken maker/taker fee per side
      allowedTimeframes: ['5m', '15m', '30m', '1h'], // Don't scalp 1m, don't swing 4h+
      defaultTimeframe: '15m',
      minSwitchIntervalMs: 5 * 60 * 1000,          // 5 min minimum between switches
    });

    this.emaCrossover = new EMASMACrossoverSignal();
    this.maDynamicSR = new MADynamicSR();
    this.breakAndRetest = new BreakAndRetest();

    // CHANGE 2026-02-23: BacktestRecorder for proper trade tracking
    // FIX 2026-02-26: Use same INITIAL_BALANCE as StateManager (was hardcoded 25000 vs 10000 mismatch)
    if (process.env.BACKTEST_MODE === 'true') {
      this.backtestRecorder = new BacktestRecorder({
        startingBalance: parseFloat(process.env.INITIAL_BALANCE) || 10000
      });
    }

    this.liquiditySweep = new LiquiditySweepDetector({
      // FIX 2026-02-18: Disable session check for 24/7 crypto - scan for sweeps anytime
      disableSessionCheck: true,
    });

    // CHANGE 2026-02-23: Volume Profile (Fabio Valentino / Auction Market Theory)
    // Filters out trend strategies when market is BALANCED (inside value area = chop)
    this.volumeProfile = new VolumeProfile({
      sessionLookback: 96,    // 96 x 15min = 24 hours
      numBins: 50,
      valueAreaPct: 0.70,
      recalcInterval: 5,      // Recalculate every 5 candles
    });

    console.log('ðŸ"Š Modular Entry System: MTF + Crossovers + S/R + Liquidity initialized');

    // EXIT_SYSTEM feature flag: Only ONE exit system active at a time
    // Options: maxprofit, intelligence, pattern, brain, legacy (all active)
    // Hard stop loss + stale trade exit + confidence crash ALWAYS run regardless
    this.activeExitSystem = process.env.EXIT_SYSTEM || featureFlags.features?.EXIT_SYSTEM?.settings?.activeSystem || 'maxprofit';
    console.log(`ðŸšª Active Exit System: ${this.activeExitSystem.toUpperCase()} (set EXIT_SYSTEM env to change)`);

    // CHANGE 670: Initialize Grid Trading Strategy
    this.gridStrategy = null; // Initialize on demand based on strategy mode
    if (process.env.ENABLE_GRID_BOT === 'true') {
      this.gridStrategy = new GridTradingStrategy({
        gridLevels: parseInt(process.env.GRID_LEVELS) || 10,
        gridSpacing: parseFloat(process.env.GRID_SPACING) || 0.002,  // 0.2% default
        orderSize: parseFloat(process.env.GRID_ORDER_SIZE) || 100,
        autoRange: process.env.GRID_AUTO_RANGE !== 'false'
      });
      console.log('ðŸŽ¯ Grid Trading Mode ENABLED');
    }

    // REMOVED 2026-02-20: ExecutionRateLimiter was blocking 95% of trades in backtest
    // Rate limiting now handled by MIN_TRADE_CONFIDENCE threshold + position sizing
    this.rateLimiter = null;

    // ðŸ¤– TRAI DECISION MODULE (Change 574 - Opus Architecture + Codex Fix)
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
      console.log('âš¡ TRAI disabled for fast backtest mode');
    }

    // ðŸ”¥ CRITICAL FIX (Change 547): Connect modules to TradingBrain
    // Without these connections, confidence calculation fails (stuck at 10-35%)
    this.tradingBrain.patternRecognition = this.patternChecker;

    // Change 587: SafetyNet and TradeLogger removed
    // SafetyNet was too restrictive, blocking legitimate trades
    // TradeLogger module doesn't exist in codebase
    // We already have RiskManager + TRAI veto + confidence thresholds
    // this.safetyNet = new TradingSafetyNet(); // DISABLED - blocking everything
    // this.tradeLogger = new TradeLogger(); // Module doesn't exist

    console.log('ðŸ” [DEBUG] About to create Kraken adapter...');
    console.log('ðŸ” [DEBUG] BrokerFactory available:', typeof createBrokerAdapter);

    // EMPIRE V2: Create Kraken adapter through BrokerFactory (SINGLE SOURCE OF TRUTH)
    // NO FALLBACK - if BrokerFactory fails, bot fails. No bypasses.
    this.kraken = createBrokerAdapter('kraken', {
      apiKey: process.env.KRAKEN_API_KEY,
      apiSecret: process.env.KRAKEN_API_SECRET
    });
    console.log('ðŸ­ [EMPIRE V2] Created Kraken adapter via BrokerFactory');
    console.log('ðŸ” [DEBUG] Kraken adapter type:', this.kraken.constructor.name);

    // Connect execution layer to Kraken (legacy path)
    this.executionLayer.setKrakenAdapter(this.kraken);

    // REFACTOR Phase 5: OrderRouter for multi-broker routing
    // Future: Add more brokers with orderRouter.registerBroker(adapter, symbols)
    this.orderRouter = new OrderRouter();
    this.orderRouter.registerBroker(this.kraken, ['BTC/USD', 'XBT/USD', 'ETH/USD', 'SOL/USD']);
    this.executionLayer.setOrderRouter(this.orderRouter);
    console.log('[EMPIRE V2] OrderRouter initialized - multi-broker ready');

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
    console.log('ðŸ”Œ Initializing Dashboard WebSocket connection...');
    this.initializeDashboardWebSocket();

    // Trading state
    this.isRunning = false;
    this.marketData = null;
    this.priceHistory = [];  // 1m candles for trading logic
    this._candleStore = new CandleStore({ maxCandles: 250 });  // REFACTOR: shadow priceHistory
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
      console.log('ðŸ†• Initializing fresh state with balance:', initialBalance);
      stateManager.updateState({
        balance: initialBalance,
        totalBalance: initialBalance,
        activeTrades: new Map()  // CHANGE 2025-12-13: Centralized active trades
      }, { action: 'INIT' });
    } else {
      console.log('âœ… Using existing state - Balance:', currentState.balance, 'Trades:', currentState.activeTrades?.size || 0);
    }

    // FIX 2026-02-26: Initialize RiskManager with balance (was never called, caused Infinity drawdown)
    // Without this, peakBalance=0, drawdown=Infinity, checkRiskLimits() blocks ALL trades
    const balanceForRisk = currentState.balance || initialBalance;
    this.riskManager.initializeBalance(balanceForRisk);

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
      onError: (msg, err) => console.error('âŒ MessageQueue:', msg, err.message)
    });

    // MODE DETECTION: Paper, Live, or Backtest (MUTUAL EXCLUSION)
    const enableLiveTrading = process.env.LIVE_TRADING === 'true';
    const enableBacktestMode = process.env.BACKTEST_MODE === 'true';
    const enableTestMode = process.env.TEST_MODE === 'true';  // Signal testing without pattern corruption

    // Enforce mutual exclusion: Only ONE mode can be active
    if (enableLiveTrading && enableBacktestMode) {
      throw new Error('âŒ FATAL: Cannot enable both LIVE trading and BACKTEST mode simultaneously!');
    }

    // Determine trading mode
    let tradingMode = 'PAPER';
    if (enableLiveTrading) tradingMode = 'LIVE';
    if (enableBacktestMode) tradingMode = 'BACKTEST';
    if (enableTestMode) {
      tradingMode = 'TEST';
      console.log('ðŸ§ª TEST MODE ACTIVATED:');
      console.log('   âœ… Patterns will NOT be saved');
      console.log('   âœ… Trades are simulated');
      console.log('   âœ… To inject signal: Set TEST_CONFIDENCE env var (0-100)');
      console.log('   âœ… Example: TEST_CONFIDENCE=75 npm start');
    }

    this.config = {
      // CHANGE 2026-02-28: Use TradingConfig for minTradeConfidence
      minTradeConfidence: TradingConfig.get('confidence.minTradeConfidence'),
      tradingPair: process.env.TRADING_PAIR || 'BTC-USD',
      enableShorts: TradingConfig.get('features.enableShorts'),
      enableLiveTrading,
      enableBacktestMode,
      tradingMode
    };

    console.log(`ðŸŽ¯ Trading Mode: ${tradingMode}`);

    // REFACTOR Phase 14: OrderExecutor - context with all dependencies
    this.orderExecutor = new OrderExecutor({
      executionLayer: this.executionLayer,
      entryDecider: this.entryDecider,
      tradingBrain: this.tradingBrain,
      performanceAnalyzer: this.performanceAnalyzer,
      patternChecker: this.patternChecker,
      patternExitModel: this.patternExitModel,
      patternExitShadowMode: this.patternExitShadowMode,
      backtestRecorder: this.backtestRecorder,
      riskManager: this.riskManager,
      trai: this.trai,
      config: this.config,
      pendingTraiDecisions: this.pendingTraiDecisions,
      tradingPair: this.tradingPair || process.env.TRADING_PAIR || 'BTC-USD',
      // Module-level functions
      notifyTrade: notifyTrade,
      notifyTradeClose: notifyTradeClose,
      discordNotifier: discordNotifier,
      tradingOptimizations: tradingOptimizations,
      logTrade: logTrade
    });

    // REFACTOR Phase 15: TradingLoop - context with all dependencies
    this.tradingLoop = new TradingLoop({
      indicatorEngine: indicatorEngine,
      contractValidator: this.contractValidator,
      tradingBrain: this.tradingBrain,
      entryDecider: this.entryDecider,
      marketDataAggregator: this.marketDataAggregator,
      patternChecker: this.patternChecker,
      config: this.config,
      riskManager: this.riskManager,
      executionLayer: this.executionLayer,
      pendingTraiDecisions: this.pendingTraiDecisions,
      trai: this.trai,
      backtestRecorder: this.backtestRecorder,
      orderExecutor: this.orderExecutor,
      // Additional context for strategy orchestration
      strategyOrchestrator: this.strategyOrchestrator,
      emaCrossoverSignal: this.emaCrossoverSignal,
      maDynamicSRSignal: this.maDynamicSRSignal,
      breakRetestSignal: this.breakRetestSignal,
      liquiditySweepSignal: this.liquiditySweepSignal,
      mtfAdapter: this.mtfAdapter,
      volumeProfile: this.volumeProfile,
      ogzTpo: this.ogzTpo,
      fibonacciDetector: this.fibonacciDetector,
      timeframeSelector: this.timeframeSelector,
      runner: this  // Self reference for makeTradeDecision
    });

    console.log('âœ… All modules initialized successfully');
    console.log(`   Risk Management: ENABLED`);
    console.log(`   Change 513 Compliance: âœ…\n`);
  }

  /**
   * Validate required environment variables
   * FIX 2026-02-18: Skip in BACKTEST_MODE for Windows local testing
   */
  validateEnvironment() {
    // Skip API key validation in backtest mode - not needed for historical data
    if (process.env.BACKTEST_MODE === 'true') {
      console.log('⏭️ Skipping API key validation (BACKTEST_MODE)');
      return;
    }

    const required = ['KRAKEN_API_KEY', 'KRAKEN_API_SECRET', 'POLYGON_API_KEY'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      console.error('âŒ Missing environment variables:', missing);
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
        console.log('\n' + 'â•'.repeat(70));
        console.log('âš ï¸  TWO-KEY SAFETY CHECK FAILED');
        console.log('â•'.repeat(70));
        console.log('You have set ENABLE_LIVE_TRADING=true');
        console.log('But CONFIRM_LIVE_TRADING is not set to true');
        console.log('\nTo enable LIVE trading, you must set BOTH:');
        console.log('  ENABLE_LIVE_TRADING=true');
        console.log('  CONFIRM_LIVE_TRADING=true');
        console.log('\nðŸ›¡ï¸ Starting in PAPER TRADING mode for safety');
        console.log('â•'.repeat(70) + '\n');

        // Force paper mode
        process.env.ENABLE_LIVE_TRADING = 'false';
        this.mode = 'PAPER';
      } else {
        // BOTH keys confirmed - show BIG warning
        console.log('\n' + 'â•”'.repeat(70));
        console.log('â•‘' + ' '.repeat(20) + 'âš ï¸  LIVE TRADING MODE ACTIVE  âš ï¸' + ' '.repeat(17) + 'â•‘');
        console.log('â•‘' + ' '.repeat(68) + 'â•‘');
        console.log('â•‘' + ' '.repeat(20) + '    REAL MONEY AT RISK!' + ' '.repeat(25) + 'â•‘');
        console.log('â•‘' + ' '.repeat(68) + 'â•‘');
        console.log('â•‘' + ' '.repeat(15) + 'Two-key safety confirmed. Proceeding...' + ' '.repeat(14) + 'â•‘');
        console.log('â•š'.repeat(70) + '\n');

        // 10-second countdown
        console.log('Starting in:');
        for (let i = 10; i > 0; i--) {
          process.stdout.write(`\r  ${i} seconds...`);
          require('child_process').execSync('sleep 1');
        }
        console.log('\r  ðŸš€ LIVE TRADING ENGAGED!\n');

        this.mode = 'LIVE';
      }
    } else {
      // Paper mode
      console.log('ðŸ“ PAPER TRADING MODE (safe mode)');
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

    console.log(`\nðŸ“Š Connecting to Dashboard WebSocket at ${wsUrl}...`);

    try {
      this.dashboardWs = new WebSocket(wsUrl);

      this.dashboardWs.on('open', () => {
        console.log('âœ… Dashboard WebSocket connected!');
        this.dashboardWsConnected = true;
        this.lastPongReceived = Date.now(); // CHANGE 2026-01-28: Track pong for heartbeat

        // ðŸ”’ SECURITY (Change 582): Authenticate first before sending any data
        const authToken = process.env.WEBSOCKET_AUTH_TOKEN || 'CHANGE_ME_IN_PRODUCTION';
        if (!authToken || authToken === 'CHANGE_ME_IN_PRODUCTION') {
          console.error('âš ï¸ WEBSOCKET_AUTH_TOKEN not set in .env - using default token');
        }

        this.dashboardWs.send(JSON.stringify({
          type: 'auth',
          token: authToken
        }));
        console.log('ðŸ” Sent authentication to dashboard');

        // DON'T send identify here - wait for auth_success message
      });

      this.dashboardWs.on('error', (error) => {
        console.error('âš ï¸ Dashboard WebSocket error:', error.message);
        this.dashboardWsConnected = false;
      });

      this.dashboardWs.on('close', () => {
        console.log('âš ï¸ Dashboard WebSocket closed - reconnecting in 2s...');
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
            console.log('ðŸ”“ Dashboard authentication successful!');

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
            console.error('âŒ Dashboard error:', msg.message);
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
            console.log(`ðŸ“Š Dashboard timeframe changed to: ${newTimeframe}`);
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
            console.log('ðŸ“¨ Dashboard command received:', msg.command);

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
              console.log('ðŸ›‘ [Dashboard] Pause command received:', reason);
              stateManager.pauseTrading(reason);
              this.dashboardWs.send(JSON.stringify({
                type: 'pause_confirmed',
                reason: reason,
                timestamp: Date.now()
              }));
            }

            // RESUME TRADING - Manual resume from dashboard
            else if (msg.command === 'resume_trading') {
              console.log('âœ… [Dashboard] Resume command received');
              stateManager.resumeTrading();
              this.dashboardWs.send(JSON.stringify({
                type: 'resume_confirmed',
                timestamp: Date.now()
              }));
            }
          }

          // TRAI Chat Support - Tech support queries from dashboard
          if (msg.type === 'trai_query' && this.trai) {
            console.log('ðŸ§  [TRAI] Received chat query:', msg.query?.substring(0, 50) + '...');
            this.handleTraiQuery(msg);
          }
        } catch (error) {
          console.error('âŒ Dashboard message parse error:', error.message);
        }
      });

    } catch (error) {
      console.error('âŒ Dashboard WebSocket initialization failed:', error.message);
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
        console.log('âš ï¸ [Heartbeat] No WebSocket instance - triggering reconnect');
        this.initializeDashboardWebSocket();
        return;
      }

      const state = this.dashboardWs.readyState;
      if (state !== 1) {
        console.log(`âš ï¸ [Heartbeat] Socket not open (readyState=${state}) - waiting for reconnect`);
        return;
      }

      // Check if last pong is too old
      const timeSinceLastPong = Date.now() - (this.lastPongReceived || 0);
      if (timeSinceLastPong > PONG_TIMEOUT) {
        console.log('ðŸ’” [Heartbeat] TIMEOUT - no pong in ' + Math.round(timeSinceLastPong/1000) + 's - forcing reconnect');
        try {
          this.dashboardWs.terminate();
        } catch (e) {
          console.error('âŒ [Heartbeat] Terminate failed:', e.message);
        }
        return;
      }

      // Send ping
      try {
        this.dashboardWs.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } catch (err) {
        console.error('âŒ [Heartbeat] Ping failed:', err.message, '- forcing reconnect');
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
        console.log('ðŸš¨ [Watchdog] NO DATA for ' + Math.round(timeSinceData/1000) + 's - forcing reconnect');
        try {
          this.dashboardWs.terminate();
        } catch (e) {
          console.error('âŒ [Watchdog] Terminate failed:', e.message);
        }
      }
    }, 30000); // Check every 30s

    console.log('ðŸ’“ Heartbeat started (ping every 15s, pong timeout 30s, data timeout 60s)');
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
          console.log(`ðŸ“‚ Loaded ${this.priceHistory.length} candles from disk (filtered from ${saved.length})`);
        }
      } else {
        console.log('ðŸ“‚ No saved candle history found - starting fresh');
      }
    } catch (error) {
      console.error('âš ï¸ Failed to load candle history:', error.message);
      this.priceHistory = [];
    }
  }

  /**
   * CHANGE 2026-01-28: Save candle history to disk
   * Called every 5 new candles to avoid disk thrashing
   */
  saveCandleHistory() {
    // FIX 2026-02-19: Skip disk writes in backtest to prevent EMFILE (60k writes exhausts OS file handles)
    if (process.env.BACKTEST_FAST === 'true' || process.env.BACKTEST_MODE === 'true') return;
    const fs = require('fs');
    const path = require('path');
    const candleFile = path.join(__dirname, 'data', 'candle-history.json');

    try {
      // Save last 200 candles
      const toSave = this.priceHistory.slice(-200);
      fs.writeFileSync(candleFile, JSON.stringify(toSave));
      // Silent save - only log errors
    } catch (error) {
      console.error('âš ï¸ Failed to save candle history:', error.message);
    }
  }

  /**
   * Start the trading bot
   */
  async start() {
    console.log('ðŸš€ Starting OGZ Prime V14 MERGED...\n');
    this.isRunning = true;

    // ðŸ¤– Initialize TRAI Decision Module (Change 574)
    if (this.trai) {
      try {
        await this.trai.initialize();
        console.log('âœ… TRAI Decision Module initialized - IN THE HOT PATH!\n');
      } catch (error) {
        console.error('âš ï¸ TRAI initialization failed:', error.message);
        console.log('   Bot will continue without TRAI...\n');
        this.trai = null;
      }
    }

    try {
      // FEATURE FLAG: Backtest mode uses historical data, Live/Paper use WebSocket
      if (this.config.enableBacktestMode) {
        console.log('ðŸ“Š BACKTEST MODE: Loading historical data...');
        await this.loadHistoricalDataAndBacktest();
      } else {
        console.log('ðŸ“¡ LIVE/PAPER MODE: Connecting to real-time data...');
        // V2 ARCHITECTURE: Get market data from BrokerFactory
        // Subscribe to broker events instead of direct connection
        this.subscribeToMarketData();

        // RECONCILER REMOVED - was blocking trades

        // EVENT LOOP MONITORING: DISABLED 2026-02-04
        // if (this.eventLoopMonitor) {
        //   console.log('âš¡ Starting event loop monitoring...');
        //   this.eventLoopMonitor.start();
        //   console.log('âœ… Event loop monitor active');
        // }

        // CHANGE 2026-02-10: Initialize Multi-Asset Manager
        this.assetManager = new MultiAssetManager(this);

        // CHANGE 2026-02-10: Initialize Trade Journal + Replay Bridge
        this.journalBridge = new TradeJournalBridge(this);

        // CHANGE 2026-02-16: Pipeline Snapshot - 30-min state capture
        this.pipelineSnapshot = new PipelineSnapshot(this);

        // Start trading cycle
        this.startTradingCycle();

        console.log('âœ… Bot is now LIVE and trading\n');
      }
    } catch (error) {
      console.error('âŒ Startup failed:', error.message);
      await this.shutdown();
    }
  }

  /**
   * V2 ARCHITECTURE: Subscribe to market data from BrokerFactory
   * Single source of truth - no direct connections
   */
  subscribeToMarketData() {
    console.log('ðŸ“¡ V2 ARCHITECTURE: Subscribing to market data from BrokerFactory...');

    if (this.kraken) {
      // Start market data subscription immediately
      const symbol = process.env.TRADING_PAIR || 'BTC/USD';
      const timeframe = process.env.CANDLE_TIMEFRAME || '15m';

      // Subscribe to candles if method exists
      if (this.kraken.subscribeToCandles) {
        console.log(`ðŸ”Œ Starting ${symbol} ${timeframe} subscription...`);
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

          // CHANGE 2026-02-21: Feed 1m candles to indicators + MTF adapter (granular data)
          if (timeframe === '1m') {
            this.handleMarketData(ohlcData);
          }

          // CHANGE 2026-02-21: Re-evaluate best timeframe on 5m candle close
          if (timeframe === '5m' && this.timeframeSelector) {
            const tfResult = this.timeframeSelector.evaluate();
            if (tfResult.switched) {
              console.log(`🔄 Active trading timeframe: ${tfResult.timeframe} (score: ${tfResult.score.toFixed(2)})`);
            }
          }

          // CHANGE 2026-02-21: Trigger trading analysis on ACTIVE timeframe candle close
          const activeTf = this.timeframeSelector?.currentTimeframe || '15m';
          if (timeframe === activeTf) {
            console.log(`📊 V2: ${activeTf} candle closed — running trading analysis`);
            this.run15mTradingCycle();
          }
        });

        this.kraken.on('ticker', (data) => {
          if (data && data.price) {
            console.log(`ðŸ’¹ V2 Ticker: $${data.price}`);
          }
        });

        console.log('âœ… V2: Subscribed to BrokerFactory events (single source of truth)');
      }
    } else {
      console.error('âŒ Broker not initialized');
    }
  }


  /**
   * Handle incoming market data from WebSocket
   * Kraken OHLC format: [channelID, [time, etime, open, high, low, close, vwap, volume, count], channelName, pair]
   */
  handleMarketData(ohlcData) {

    // OHLC data is array: [time, etime, open, high, low, close, vwap, volume, count]
    if (!Array.isArray(ohlcData) || ohlcData.length < 8) {
      console.warn('âš ï¸ Invalid OHLC data format:', ohlcData);
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
      console.error('ðŸš¨ STALE DATA:', Math.round(dataAge / 1000), 'seconds old');

      // AUTO-PAUSE TRADING
      if (!this.staleFeedPaused) {
        console.error('â¸ï¸ PAUSING NEW ENTRIES DUE TO STALE DATA');
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
      console.log('âœ… Fresh data restored, resuming');
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
      this._candleStore.addCandle('BTC-USD', '15m', candle);  // REFACTOR: dual-write (update)

      // Debug: Show updates for first few candles
      if (this.priceHistory.length <= 3) {
        const candleTime = new Date(candle.t).toLocaleTimeString();
        // CHANGE 634: Clean output for humans (no more decimal headaches!)
        const open = Math.round(_o(candle));
        const high = Math.round(_h(candle));
        const low = Math.round(_l(candle));
        const close = Math.round(_c(candle));
        console.log(`ðŸ•¯ï¸ Candle #${this.priceHistory.length} [${candleTime}]: $${close.toLocaleString()} (H:${high.toLocaleString()} L:${low.toLocaleString()})`);
      }
    } else {
      // New candle (new minute) - etime changed
      this.priceHistory.push(candle);
      this._candleStore.addCandle('BTC-USD', '15m', candle);  // REFACTOR: dual-write

      // CHANGE 2026-02-10: Feed modular entry system with new candle
      if (this.mtfAdapter) this.mtfAdapter.ingestCandle(candle);
      if (this.emaCrossover) this.emaCrossoverSignal = this.emaCrossover.update(candle, this.priceHistory);
      if (this.maDynamicSR) this.maDynamicSRSignal = this.maDynamicSR.update(candle, this.priceHistory);
      if (this.breakAndRetest) this.breakRetestSignal = this.breakAndRetest.update(candle, this.priceHistory);
      if (this.liquiditySweep) this.liquiditySweepSignal = this.liquiditySweep.feedCandle(candle);

      // CHANGE 2026-02-23: Update Volume Profile (chop filter for trend strategies)
      if (this.volumeProfile) this.volumeProfile.update(candle, this.priceHistory);


      // Only log during warmup phase (first 20 candles)
      if (this.priceHistory.length <= 20) {
        const candleTime = new Date(candle.t).toLocaleTimeString();
        console.log(`âœ… Candle #${this.priceHistory.length}/15 [${candleTime}]`);
      }

      // Keep enough history for 200 EMA + swing detection (220 bars minimum)
      if (this.priceHistory.length > 250) {
        this.priceHistory = this.priceHistory.slice(-250);
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
        // FIX 2026-02-26: Use StateManager instead of hardcoded value
        const initialBalance = stateManager.get('initialBalance') || parseFloat(process.env.INITIAL_BALANCE) || 10000;
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

    // CHANGE 2026-02-21: Sync 15m with priceHistory (trading logic uses 15m candles now)
    if (timeframe === '15m') {
      this.timeframeHistories['15m'] = this.priceHistory;
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
        console.warn('âš ï¸ Cannot fetch historical candles - broker or dashboard not connected');
        return;
      }

      console.log(`ðŸ“Š Fetching ${limit} historical ${timeframe} candles from Kraken REST API...`);

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

        console.log(`âœ… Sent ${candles.length} historical ${timeframe} candles to dashboard`);
      } else {
        console.warn(`âš ï¸ No historical candles returned for ${timeframe}`);
        // Fall back to cached WebSocket data if available
        const cached = this.getCandlesForTimeframe(timeframe);
        if (cached.length > 0) {
          this.dashboardWs.send(JSON.stringify({
            type: 'historical_candles',
            timeframe: timeframe,
            candles: cached
          }));
          console.log(`ðŸ“Š Sent ${cached.length} cached ${timeframe} candles as fallback`);
        }
      }
    } catch (error) {
      console.error(`âŒ Failed to fetch historical ${timeframe} candles:`, error.message);
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
        console.log(`â³ Warming up... ${this.priceHistory.length}/3 candles (15m timeframe)`);
        return;
      }

      try {
        await this.analyzeAndTrade();
      } catch (error) {
        console.error('âŒ Trading cycle error:', error.message);
        console.error(error.stack);
      }
    }, interval);

    console.log(`â° Trading cycle started (${interval}ms interval)`);

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
        console.error('ðŸš¨ðŸš¨ðŸš¨ LIVENESS WATCHDOG: NO DATA RECEIVED FOR', Math.round(silenceDuration / 1000), 'SECONDS');
        console.error('â¸ï¸ PAUSING TRADING - DATA FEED APPEARS DEAD');
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

    console.log('ðŸ” Liveness watchdog started (checks every 60s, alerts if no data for 2min)');
  }

  /**
   * Analyze market and execute trades
   * Core trading pipeline orchestration
   * REFACTOR Phase 15: Thin dispatcher - delegates to TradingLoop
   */
  async analyzeAndTrade() {
    // Update context with current instance state before delegating
    this.tradingLoop.ctx.marketData = this.marketData;
    this.tradingLoop.ctx.priceHistory = this.priceHistory;
    this.tradingLoop.ctx.dashboardWs = this.dashboardWs;
    this.tradingLoop.ctx.dashboardWsConnected = this.dashboardWsConnected;
    this.tradingLoop.ctx._lastTraiDecision = this._lastTraiDecision;
    this.tradingLoop.ctx.executeTrade = this.executeTrade.bind(this);
    this.tradingLoop.ctx.broadcastPatternAnalysis = this.broadcastPatternAnalysis.bind(this);
    return this.tradingLoop.analyzeAndTrade();
  }


  // REMOVED 2026-02-01: calculateAutoDrawLevels() - Dead code (call was commented out)
  // ~275 lines removed - was never invoked, only definition existed

  // REMOVED Phase 16: makeTradeDecision() - Dead code (~400 lines)
  // Logic already exists in core/EntryDecider.js, TradingLoop calls entryDecider.makeTradeDecision()


  /**
   * Execute a trade - PHASE 14 THIN DISPATCHER
   * Original logic moved to core/OrderExecutor.js
   */
  async executeTrade(decision, confidenceData, price, indicators, patterns, traiDecision = null, brainDecision = null) {
    // Update context with current runtime values
    this.orderExecutor.ctx.marketData = this.marketData;
    this.orderExecutor.ctx.dashboardWs = this.dashboardWs;
    this.orderExecutor.ctx.dashboardWsConnected = this.dashboardWsConnected;
    this.orderExecutor.ctx._lastTraiDecision = this._lastTraiDecision;

    // Delegate to OrderExecutor (exact copy of original logic)
    return this.orderExecutor.executeTrade(decision, confidenceData, price, indicators, patterns, traiDecision, brainDecision);
  }

  // REMOVED 2026-03-03: Original executeTrade() body (~810 lines) moved to core/OrderExecutor.js

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
            status: patternMemoryCount > 100 ? 'Learning Active ðŸ§ ' : 'Building Memory ðŸ“š'
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
      console.error('âš ï¸ Pattern broadcast failed:', error.message);
    }
  }

  /**
   * BACKTEST MODE: Load historical data and run simulation
   * Ported from Change 572 - loads Polygon historical data and feeds through trading logic
   */
  async loadHistoricalDataAndBacktest() {
    console.log('ðŸ“Š BACKTEST MODE: Loading historical data...');

    const fs = require('fs').promises;
    const path = require('path');

    try {
      // Load historical candles - check for custom data file first (CHANGE 633)
      let dataPath;
      if (process.env.CANDLE_DATA_FILE) {
        // Use custom candle data file (e.g., 5-second candles for optimization)
        dataPath = process.env.CANDLE_DATA_FILE;
        console.log(`ðŸ“‚ Using custom data file: ${dataPath}`);
      } else {
        // Default behavior - CHANGE 633: Use 5-second candles for fast backtest
        const dataFile = process.env.FAST_BACKTEST === 'true'
          ? 'polygon-btc-5sec.json'  // 60k 5-second candles for rapid testing
          : 'polygon-btc-1y.json';    // 60k 1-minute candles for full validation
        console.log(`ðŸ“‚ Data file: data/${dataFile}`);
        dataPath = path.join(__dirname, 'data', dataFile);
      }
      const rawData = await fs.readFile(dataPath, 'utf8');
      const parsedData = JSON.parse(rawData);
      // Handle both formats: array of candles or object with .candles property
      const historicalCandles = parsedData.candles || parsedData;

      console.log(`âœ… Loaded ${historicalCandles.length.toLocaleString()} historical candles`);
      console.log(`ðŸ“… Date range: ${new Date(historicalCandles[0].timestamp).toLocaleDateString()} â†’ ${new Date(historicalCandles[historicalCandles.length - 1].timestamp).toLocaleDateString()}`);
      console.log(`â±ï¸  Starting backtest simulation...\n`);

      let processedCount = 0;
      let errorCount = 0;
      const startTime = Date.now();

      // Process each candle through the trading logic
      for (const polygonCandle of historicalCandles) {
        try {
          // Convert to OHLCV format - handle both Polygon format and shorthand
          const ohlcvCandle = {
            o: polygonCandle.open || polygonCandle.o,
            h: polygonCandle.high || polygonCandle.h,
            l: polygonCandle.low || polygonCandle.l,
            c: polygonCandle.close || polygonCandle.c,
            v: polygonCandle.volume || polygonCandle.v,
            t: polygonCandle.timestamp || polygonCandle.t
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
            console.log(`ðŸ“Š Progress: ${processedCount.toLocaleString()}/${historicalCandles.length.toLocaleString()} candles (${rate}/sec) | Errors: ${errorCount}`);
          }

        } catch (err) {
          errorCount++;
          if (errorCount <= 5) {
            console.error(`âŒ Error processing candle #${processedCount}:`, err.message);
          }
            console.error(err.stack);
        }
      }

      // Final summary
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\nâœ… BACKTEST COMPLETE!`);
      console.log(`   ðŸ“Š Candles processed: ${processedCount.toLocaleString()}`);
      console.log(`   â±ï¸  Duration: ${totalTime}s`);
      console.log(`   âš¡ Rate: ${(processedCount / totalTime).toFixed(0)} candles/sec`);
      console.log(`   âŒ Errors: ${errorCount}`);
      console.log(`   ðŸ’° Final Balance: $${stateManager.get('balance').toFixed(2)}`);
      console.log(`   ðŸ“ˆ Total P&L: $${(stateManager.get('balance') - 10000).toFixed(2)} (${((stateManager.get('balance') / 10000 - 1) * 100).toFixed(2)}%)`);

      // Pattern Learning Summary - Visual proof patterns are being recorded
      if (this.patternChecker?.getMemoryStats) {
        const patternStats = this.patternChecker.getMemoryStats();
        const wins = patternStats.totalWins || 0;
        const losses = patternStats.totalLosses || 0;
        const totalTrades = wins + losses;
        const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
        console.log(`\n   ðŸ§  PATTERN LEARNING SUMMARY:`);
        console.log(`      ðŸ“Š Patterns Recorded: ${patternStats.tradeResults || 0}`);
        console.log(`      âœ… Wins: ${wins}`);
        console.log(`      âŒ Losses: ${losses}`);
        console.log(`      ðŸ“ˆ Win Rate: ${winRate}%`);
        console.log(`      ðŸŽ¯ Promoted Patterns: ${patternStats.promoted || 0}`);
        console.log(`      ðŸ”¬ Candidates: ${patternStats.candidates || 0}`);
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
      // FIX 2026-02-19: Try/catch with console fallback to prevent losing results on EMFILE
      try {
        require('fs').writeFileSync(reportPath, JSON.stringify(report, null, 2));
      } catch (err) {
        console.error('⚠️ Could not write report file: ' + err.message);
        console.log('📊 === BACKTEST RESULTS (CONSOLE DUMP) ===');
        console.log('Final Balance: $' + report.finalBalance);
        console.log('Total P&L: $' + report.totalPnL + ' (' + report.totalPnLPercent + '%)');
        console.log('Total Trades: ' + (report.totalTrades || (report.trades && report.trades.length) || 'N/A'));
        console.log('Win Rate: ' + (report.winRate || 'N/A'));
        console.log('📊 === END CONSOLE DUMP ===');
      }
      console.log(`\nðŸ“„ Report saved: ${reportPath}`);

      // FIX 2026-02-10: Save pattern memory after backtest (was never being saved!)
      // FIX 2026-02-19: Await async cleanup to ensure save completes before exit
      if (this.patternChecker?.cleanup) {
        await this.patternChecker.cleanup();
        console.log('ðŸ§  Backtest patterns saved to disk');
      }

      // ðŸ¤– TRAI Analysis of Backtest Results (Change 586)
      // Run AFTER report is saved so we always have results even if TRAI hangs
      if (this.trai && this.trai.analyzeBacktestResults) {
        console.log('\nðŸ¤– [TRAI] Analyzing backtest results for optimization insights...');
        try {
          const traiAnalysis = await this.trai.analyzeBacktestResults(report);
          report.traiAnalysis = traiAnalysis;
          console.log('âœ… TRAI Analysis Complete:', traiAnalysis.summary);
          // Re-save with TRAI analysis appended
          require('fs').writeFileSync(reportPath, JSON.stringify(report, null, 2));
        } catch (error) {
          console.error('âš ï¸ TRAI analysis failed:', error.message);
        }
      }

      // CHANGE 2026-02-23: Print BacktestRecorder summary with fees and export CSV
      if (this.backtestRecorder) {
        this.backtestRecorder.printSummary();
        this.backtestRecorder.exportCSV('./backtest-trades.csv');
      }

      // Exit after backtest
      console.log('\nðŸ›‘ Backtest complete - exiting...');
      process.exit(0);

    } catch (err) {
      console.error('âŒ BACKTEST FAILED:', err.message);
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
    console.log(`ðŸŒ [TRAI Web] Detected asset: ${asset.type} - ${asset.symbol || asset.id || asset.query}`);

    try {
      let result;

      // If type is 'search', we need to find the asset via API
      if (asset.type === 'search') {
        console.log(`ðŸ” [TRAI Web] Searching for: "${asset.query}"`);

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
            console.log('ðŸŒ [TRAI Web] No match found, defaulting to BTC');
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

      console.log(`âœ… [TRAI Web] Fetched ${result.asset}: $${result.price} (${result.change24h} 24h)`);
      return result;
    } catch (error) {
      console.warn('âš ï¸ Failed to fetch web market context:', error.message);
      return null;
    }
  }

  /**
   * Detect asset from user query - SMART detection with fuzzy matching
   */
  detectAssetFromQuery(query) {
    const q = query.toLowerCase().replace(/[^a-z0-9\s]/g, ''); // Clean query
    const words = q.split(/\s+/);

    // Common crypto names â†’ CoinGecko ID (case insensitive, fuzzy)
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

    // Common stock names â†’ Yahoo symbol (fuzzy matching)
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
        console.log(`ðŸ” [TRAI Search] Found crypto: ${top.name} (${top.symbol})`);
        return { type: 'crypto', id: top.id, symbol: top.symbol.toUpperCase() };
      }
    } catch (error) {
      console.warn('âš ï¸ Crypto search failed:', error.message);
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
        console.log(`ðŸ” [TRAI Search] Found stock: ${top.shortname || top.symbol} (${top.symbol})`);
        return { type: 'stock', symbol: top.symbol };
      }
    } catch (error) {
      console.warn('âš ï¸ Stock search failed:', error.message);
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
      console.warn(`âš ï¸ [TRAI] Fear & Greed fetch failed: ${error.message}`);
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
      console.warn(`âš ï¸ [TRAI] News fetch failed: ${error.message}`);
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
        console.log('ðŸ§  [TRAI] Sent chat response');
      }
    } catch (error) {
      console.error('âŒ [TRAI] Chat query failed:', error.message);

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
    console.log('\nðŸ›‘ Shutting down OGZ Prime V14 MERGED...');
    this.isRunning = false;

    if (this.tradingInterval) {
      clearInterval(this.tradingInterval);
    }

    // CHANGE 2026-01-21: Clear liveness watchdog interval (memory leak fix)
    if (this.livenessCheckInterval) {
      clearInterval(this.livenessCheckInterval);
      console.log('ðŸ” Liveness watchdog interval cleaned up');
    }

    // CHANGE 2026-01-29: Clear heartbeat interval (memory leak fix)
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log('ðŸ’“ Heartbeat interval cleaned up');
    }

    // ðŸ”¥ CRITICAL: Remove event listeners before closing (Change 575 - Memory leak fix)
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      console.log('ðŸ“¡ Market data WebSocket cleaned up');
    }

    // CHANGE 2026-02-10: Cleanup modular entry system
    if (this.mtfAdapter) this.mtfAdapter.destroy();
    if (this.emaCrossover) this.emaCrossover.destroy();
    if (this.maDynamicSR) this.maDynamicSR.destroy();
    if (this.liquiditySweep) this.liquiditySweep.destroy();
    console.log('ðŸ“Š Modular Entry System cleaned up');

    if (this.dashboardWs) {
      this.dashboardWs.removeAllListeners();
      this.dashboardWs.close();
      console.log('ðŸ“Š Dashboard WebSocket cleaned up');
    }

    // ðŸ¤– Shutdown TRAI LLM server (Change 579)
    if (this.trai && this.trai.traiCore) {
      this.trai.traiCore.shutdown();
      console.log('ðŸ¤– TRAI Core shutdown complete');
    }

    // CHANGE 2025-12-12: Cleanup RiskManager timer leak
    if (this.riskManager) {
      this.riskManager.shutdown();
      console.log('ðŸ›¡ï¸ RiskManager timers cleaned up');
    }

    // FIX 2026-02-10: Save pattern memory before exit (was never being saved!)
    // FIX 2026-02-19: Await async cleanup
    if (this.patternChecker?.cleanup) {
      await this.patternChecker.cleanup();
      console.log('ðŸ§  Pattern memory saved to disk');
    }

    // Print final performance stats
    console.log('\nðŸ“Š Final Performance:');
    console.log(`   Session Duration: ${((Date.now() - this.startTime) / 1000 / 60).toFixed(1)} minutes`);
    console.log(`   Final Balance: $${stateManager.get('balance').toFixed(2)}`);

    console.log('\nâœ… Shutdown complete\n');
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
      const isBuy = _c(candle) >= _o(candle);  // Simple: close >= open = buy pressure
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
          (price - _c(this.priceHistory[this.priceHistory.length - 10])) / _c(this.priceHistory[this.priceHistory.length - 10]) : 0;
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
          (price - _c(this.priceHistory[this.priceHistory.length - 10])) / _c(this.priceHistory[this.priceHistory.length - 10]) : 0;
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
          (price - _c(this.priceHistory[Math.max(0, this.priceHistory.length - 10)])) / price : 0;
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
      console.error('âš ï¸ Edge analytics broadcast failed:', error.message);
    }
  }

  /**
   * Calculate price volatility for Fear & Greed
   */
  calculateVolatility() {
    if (this.priceHistory.length < 20) return 0.02;

    const returns = [];
    for (let i = 1; i < Math.min(20, this.priceHistory.length); i++) {
      const ret = (_c(this.priceHistory[i]) - _c(this.priceHistory[i-1])) / _c(this.priceHistory[i-1]);
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
    const priceHigh = Math.max(...recentPrices.map(candle => _h(candle)));
    const priceLow = Math.min(...recentPrices.map(candle => _l(candle)));
    const currentPrice = _c(recentPrices[recentPrices.length - 1]);

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
    console.error('âŒ Uncaught exception:', error);
    bot.shutdown();
  });

  // ðŸ”¥ CRITICAL: Handle unhandled promise rejections (Change 575)
  process.on('unhandledRejection', (reason, promise) => {
    console.error('âŒ Unhandled Promise Rejection:', reason);
    console.error('   Promise:', promise);
    // Log but don't shutdown - async failures shouldn't kill bot
    console.error('   Bot continuing despite rejection...');
  });

  await bot.start();
}

// Run bot
if (require.main === module) {
  main().catch(error => {
    console.error('âŒ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = OGZPrimeV14Bot;
