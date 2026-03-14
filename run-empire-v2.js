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

// FIX 2026-03-12: Isolate backtest state BEFORE any modules load StateManager
// This MUST run before require('./core/StateManager') at line ~214
if (process.env.EXECUTION_MODE === 'backtest' || process.env.CANDLE_SOURCE === 'file') {
  const path = require('path');
  process.env.STATE_FILE = path.join(__dirname, 'data', 'state-backtest.json');
  process.env.DATA_DIR = path.join(__dirname, 'data', 'backtest');
  console.log(`📁 [BACKTEST] Isolated state: ${process.env.STATE_FILE}`);
  console.log(`📁 [BACKTEST] Isolated data dir: ${process.env.DATA_DIR}`);
}

// FIX 2026-03-14: Normalize BACKTEST_MODE for all downstream modules
// 15+ files check BACKTEST_MODE but backtest launches via EXECUTION_MODE
if (process.env.EXECUTION_MODE === 'backtest' || process.env.CANDLE_SOURCE === 'file') {
  process.env.BACKTEST_MODE = 'true';
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

// FIX 2026-03-12: IndicatorSnapshot deleted - use IndicatorEngine.getSnapshot() directly
// TradingLoop now uses getSnapshot() which returns validated DTO format

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

// Phase 4 REWRITE: MaxProfitManager standalone (was inside deleted OptimizedTradingBrain)
const MaxProfitManager = require('./core/MaxProfitManager');

// REFACTOR Phase 15: TradingLoop - exact copy of analyzeAndTrade() extracted
const TradingLoop = require('./core/TradingLoop');

// REFACTOR Phase 17: DashboardBroadcaster - edge analytics broadcasting
const DashboardBroadcaster = require('./core/DashboardBroadcaster');

// REFACTOR Phase 18: BacktestRunner - backtest simulation logic
const BacktestRunner = require('./core/BacktestRunner');

// REFACTOR Phase 19: CandleProcessor - market data handling
const CandleProcessor = require('./core/CandleProcessor');

// REFACTOR Phase 20: WebSocketManager - dashboard WebSocket handling
const WebSocketManager = require('./core/WebSocketManager');

// REFACTOR Phase 21: ModuleInitializer - configuration and module factory helpers
const ModuleInitializer = require('./core/ModuleInitializer');

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

// Phase 2 REWRITE: TradingOptimizations deleted - PatternStatsManager unused

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
  // Skip singleton lock ONLY when BOTH conditions met:
  // 1. CANDLE_SOURCE=file (no live exchange connection)
  // 2. EXECUTION_MODE=backtest (explicitly not trading)
  // This prevents $50 mistakes - BOTH gates required!
  const isFileSource = process.env.CANDLE_SOURCE === 'file';
  const isBacktestMode = process.env.EXECUTION_MODE === 'backtest' || process.env.BACKTEST_MODE === 'true';
  const skipLock = isFileSource && isBacktestMode;

  if (!skipLock) {
    singletonLock.acquireLock();
  } else {
    console.log('');
    console.log('='.repeat(70));
    console.log('  SINGLETON LOCK SKIPPED - BACKTEST MODE');
    console.log('  CANDLE_SOURCE=file + EXECUTION_MODE=backtest');
    console.log('='.repeat(70));
    console.log('');
  }
  // REMOVED: Port check was conflicting with other services (ogz-stripe on 3001)
  // Singleton lock file is sufficient to prevent duplicate bot instances
})();;
const WebSocket = require('ws');

// Core Trading Modules - All through ModuleAutoLoader
console.log('[CHECKPOINT-007] Loading core modules...');
const EnhancedPatternRecognition = loader.get('core', 'EnhancedPatternRecognition');
console.log('  EnhancedPatternRecognition:', !!EnhancedPatternRecognition);
const { EnhancedPatternChecker } = EnhancedPatternRecognition || {};

// Phase 2 REWRITE: OptimizedTradingBrain deleted - orchestrator replaced it

const RiskManager = loader.get('core', 'RiskManager');
console.log('  RiskManager:', !!RiskManager);
// Phase 3 REWRITE: EntryDecider deleted - logic inlined to TradingLoop
// REMOVED 2026-02-20: ExecutionRateLimiter was blocking 95% of trades in backtest
// const ExecutionRateLimiter = loader.get('core', 'ExecutionRateLimiter');
// Phase 2 REWRITE: AdvancedExecutionLayer deleted - OrderRouter+OrderExecutor replaced it
const PerformanceAnalyzer = loader.get('core', 'PerformanceAnalyzer');
// Phase 2 REWRITE: TradingProfileManager, GridTradingStrategy deleted

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

    // REFACTOR Phase 21: ModuleInitializer for configuration helpers
    this.moduleInitializer = new ModuleInitializer();

    // Environment validation
    this.validateEnvironment();

    // TWO-KEY TURN SAFETY: Require double confirmation for live trading
    this.verifyTradingMode();

    // Tier configuration
    this.tier = process.env.BOT_TIER || 'ml';
    this.tierFlagManager = new TierFeatureFlags(this.tier);
    this.tierFlags = this.tierFlagManager.getTierSummary();
    console.log(`ðŸŽ¯ Tier: ${this.tier.toUpperCase()}`);

    // PIPELINE: Read toggles early for component initialization
    this.pipeline = TradingConfig.get('pipeline') || {};

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
    // Phase 2 REWRITE: TradingProfileManager, OptimizedTradingBrain, tradingOptimizations deleted
    // Profiles now in TradingConfig, orchestrator replaced brain, PatternStatsManager unused
    const initialProfile = process.env.TRADING_PROFILE || 'balanced';
    console.log(`📊 Trading Profile: ${initialProfile.toUpperCase()} (from TradingConfig)`);

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

    // Phase 3 REWRITE: EntryDecider deleted - decision logic inlined to TradingLoop
    // Gate checks and exit logic now in TradingLoop + ExitContractManager

    // PHASE 13A: Position management with immutability guarantees
    this.pnlCalculator = new PnLCalculator();
    this.positionSizer = new PositionSizer();
    this.positionTracker = new PositionTracker();

    // Phase 2 REWRITE: AdvancedExecutionLayer deleted - OrderRouter+OrderExecutor handle execution

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

    // Wire strategies to TradingConfig (per STRATEGY-REWRITE-SPEC.md)
    const emaConfig = TradingConfig.get('strategies.EMACrossover') || {};
    this.emaCrossover = new EMASMACrossoverSignal({
      decayBars: emaConfig.decayBars || 10,
      snapbackThresholdPct: emaConfig.snapbackThreshold || 2.5,
      blowoffAccelThreshold: emaConfig.blowoffThreshold || 0.15,
    });

    const masrConfig = TradingConfig.get('strategies.MADynamicSR') || {};
    this.maDynamicSR = new MADynamicSR({
      entryMaPeriod: masrConfig.entryMaPeriod || 20,
      srMaPeriod: masrConfig.srMaPeriod || 200,
      touchZonePct: masrConfig.touchZonePct || 0.6,
      srTestCount: masrConfig.srTestCount || 2,
      swingLookback: masrConfig.swingLookback || 3,
      srZonePct: masrConfig.srZonePct || 1.0,
      slopeLookback: masrConfig.slopeLookback || 5,
      minSlopePct: masrConfig.minSlopePct || 0.03,
      extensionPct: masrConfig.extensionPct || 2.0,
      skipFirstTouch: masrConfig.skipFirstTouch ?? true,
      atrPeriod: masrConfig.atrPeriod || 14,
      patternPersistBars: masrConfig.patternPersistBars || 15,
    });

    this.breakAndRetest = new BreakAndRetest();

    // CHANGE 2026-02-23: BacktestRecorder for proper trade tracking
    // FIX 2026-02-26: Use same INITIAL_BALANCE as StateManager (was hardcoded 25000 vs 10000 mismatch)
    if (process.env.BACKTEST_MODE === 'true' || process.env.EXECUTION_MODE === 'backtest' || process.env.CANDLE_SOURCE === 'file') {
      this.backtestRecorder = new BacktestRecorder({
        startingBalance: parseFloat(process.env.INITIAL_BALANCE) || 10000
      });
    }

    const liqConfig = TradingConfig.get('strategies.LiquiditySweep') || {};
    this.liquiditySweep = new LiquiditySweepDetector({
      sweepLookbackBars: liqConfig.sweepLookbackBars || 50,
      sweepMinExtensionPct: liqConfig.sweepMinExtensionPct || 0.1,
      atrMultiplier: liqConfig.atrMultiplier || 0.25,
      atrPeriod: liqConfig.atrPeriod || 14,
      entryWindowMinutes: liqConfig.entryWindowMinutes || 90,
      hammerBodyMaxPct: liqConfig.hammerBodyMaxPct || 0.35,
      hammerWickMinRatio: liqConfig.hammerWickMinRatio || 2.0,
      engulfMinRatio: liqConfig.engulfMinRatio || 1.0,
      stopBufferPct: liqConfig.stopBufferPct || 0.05,
      disableSessionCheck: liqConfig.disableSessionCheck ?? true,
    });

    // CHANGE 2026-02-23: Volume Profile (Fabio Valentino / Auction Market Theory)
    // Filters out trend strategies when market is BALANCED (inside value area = chop)
    const vpConfig = TradingConfig.get('strategies.VolumeProfile') || {};
    this.volumeProfile = new VolumeProfile({
      sessionLookback: vpConfig.sessionLookback || 96,    // 96 x 15min = 24 hours
      numBins: vpConfig.numBins || 50,
      valueAreaPct: vpConfig.valueAreaPct || 0.70,
      outOfBalancePct: vpConfig.outOfBalancePct || 0.5,   // FIX: Was 0.1%, needs 0.5%
      recalcInterval: vpConfig.recalcInterval || 5,
    });

    console.log('ðŸ"Š Modular Entry System: MTF + Crossovers + S/R + Liquidity initialized');

    // EXIT_SYSTEM feature flag: Only ONE exit system active at a time
    // Options: maxprofit, intelligence, pattern, brain, legacy (all active)
    // Hard stop loss + stale trade exit + confidence crash ALWAYS run regardless
    this.activeExitSystem = process.env.EXIT_SYSTEM || featureFlags.features?.EXIT_SYSTEM?.settings?.activeSystem || 'maxprofit';
    console.log(`ðŸšª Active Exit System: ${this.activeExitSystem.toUpperCase()} (set EXIT_SYSTEM env to change)`);

    // Phase 2 REWRITE: GridTradingStrategy deleted - different trading style, feature-flagged off

    // REMOVED 2026-02-20: ExecutionRateLimiter was blocking 95% of trades in backtest
    // Rate limiting now handled by MIN_TRADE_CONFIDENCE threshold + position sizing
    this.rateLimiter = null;

    // ðŸ¤– TRAI DECISION MODULE (Change 574 - Opus Architecture + Codex Fix)
    // OPTIMIZECEPTION FIX: Skip TRAI initialization when disabled (4x faster backtests)
    // PIPELINE: Check both legacy env var AND new pipeline toggle
    if (this.pipeline.enableTRAI !== false && process.env.ENABLE_TRAI !== 'false') {
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

    // Phase 2 REWRITE: tradingBrain deleted - orchestrator handles confidence

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

    // Phase 2 REWRITE: executionLayer deleted - OrderRouter handles routing directly

    // REFACTOR Phase 5: OrderRouter for multi-broker routing
    // Future: Add more brokers with orderRouter.registerBroker(adapter, symbols)
    this.orderRouter = new OrderRouter();
    this.orderRouter.registerBroker(this.kraken, ['BTC/USD', 'XBT/USD', 'ETH/USD', 'SOL/USD']);
    console.log('[EMPIRE V2] OrderRouter initialized - multi-broker ready');

    // Phase 4 REWRITE: MaxProfitManager standalone (was inside deleted OptimizedTradingBrain)
    this.maxProfitManager = new MaxProfitManager();
    console.log('[EMPIRE V2] MaxProfitManager initialized - tiered exits ready');

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
    // REFACTOR Phase 20: WebSocketManager - must be instantiated before initializeDashboardWebSocket call
    this.webSocketManager = new WebSocketManager(this);
    // CHANGE 661: Connect to dashboard WebSocket (defaults to localhost)
    // PIPELINE: Skip dashboard in backtest mode for faster runs
    if (this.pipeline.enableDashboard !== false) {
      console.log('ðŸ"Œ Initializing Dashboard WebSocket connection...');
      this.initializeDashboardWebSocket();
    }

    // Trading state
    this.isRunning = false;
    this.marketData = null;
    this.priceHistory = [];  // 1m candles for trading logic
    this._candleStore = new CandleStore({ maxCandles: 250 });  // REFACTOR: shadow priceHistory
    this.candleSaveCounter = 0; // CHANGE 2026-01-28: Track candles for periodic save
    this.loadCandleHistory(); // CHANGE 2026-01-28: Load saved candles on startup

    // FIX 2026-03-06: Replay saved candles through IndicatorEngine on startup
    // Bug: priceHistory loaded from disk but IndicatorEngine started empty
    // Result: RSI was null because IndicatorEngine had 0 candles while priceHistory had 16
    // Fix: Use computeBatch() to replay all saved candles through indicator calculations
    if (this.priceHistory.length > 0) {
      console.log(`🔄 Replaying ${this.priceHistory.length} saved candles through IndicatorEngine...`);
      indicatorEngine.computeBatch(this.priceHistory);
      console.log(`✅ IndicatorEngine synced with priceHistory (RSI: ${indicatorEngine.getSnapshot().indicators?.rsi?.toFixed(1) || 'warming up'})`);
    }

    // FIX 2026-03-06: Replay saved candles through signal modules on startup
    // Same bug as IndicatorEngine - these modules are stateful and need history replayed
    // EMASMACrossoverSignal: crossoverState, prevSpreads, divergenceHistory
    // MADynamicSR: swings, srLevels, pattern123, barCount
    if (this.priceHistory.length > 0 && this.emaCrossover && this.maDynamicSR) {
      console.log(`🔄 Replaying ${this.priceHistory.length} saved candles through signal modules...`);
      for (let i = 0; i < this.priceHistory.length; i++) {
        const candle = this.priceHistory[i];
        const historyUpToNow = this.priceHistory.slice(0, i + 1);
        this.emaCrossover.update(candle, historyUpToNow);
        this.maDynamicSR.update(candle, historyUpToNow);
      }
      const emaSnap = this.emaCrossover.getSnapshot();
      const srSnap = this.maDynamicSR.getSnapshot();
      console.log(`✅ Signal modules synced (EMA states: ${Object.values(emaSnap.crossoverState).filter(s => s.side !== 'none').length}, SR swings: ${srSnap.swings?.length || 0})`);
    }

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
        initialBalance: initialBalance,   // FIX 2026-03-14: Store for drawdown reference
        activeTrades: new Map()  // CHANGE 2025-12-13: Centralized active trades
      }, { action: 'INIT' });
    } else {
      console.log('âœ… Using existing state - Balance:', currentState.balance, 'Trades:', currentState.activeTrades?.size || 0);
      // FIX 2026-03-14: Ensure initialBalance exists on state restore
      if (!currentState.initialBalance) {
        stateManager.updateState({ initialBalance: initialBalance }, { action: 'SET_INITIAL_BALANCE' });
      }
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
    // PIPELINE: Use this.pipeline set earlier in constructor

    // Support both legacy env vars AND new pipeline toggles
    const enableLiveTrading = process.env.LIVE_TRADING === 'true' || this.pipeline.executionMode === 'live';
    const enableBacktestMode = process.env.BACKTEST_MODE === 'true' ||
                               this.pipeline.candleSource === 'file' ||
                               this.pipeline.executionMode === 'backtest';
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
    // Phase 2 REWRITE: executionLayer, tradingBrain, tradingOptimizations deleted
    // Phase 3 REWRITE: entryDecider deleted - gate checks in TradingLoop
    // Phase 4 REWRITE: Added orderRouter + maxProfitManager
    this.orderExecutor = new OrderExecutor({
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
      // Phase 4 REWRITE: Standalone dependencies (was inside deleted modules)
      orderRouter: this.orderRouter,
      maxProfitManager: this.maxProfitManager,
      // Module-level functions
      notifyTrade: notifyTrade,
      notifyTradeClose: notifyTradeClose,
      discordNotifier: discordNotifier,
      logTrade: logTrade
    });

    // REFACTOR Phase 15: TradingLoop - context with all dependencies
    // Phase 2 REWRITE: tradingBrain, executionLayer deleted - orchestrator handles decisions
    // Phase 3 REWRITE: entryDecider deleted - decision logic inlined here
    // Phase 4 REWRITE: Added maxProfitManager for tiered exits
    this.tradingLoop = new TradingLoop({
      indicatorEngine: indicatorEngine,
      contractValidator: this.contractValidator,
      marketDataAggregator: this.marketDataAggregator,
      patternChecker: this.patternChecker,
      config: this.config,
      riskManager: this.riskManager,
      pendingTraiDecisions: this.pendingTraiDecisions,
      trai: this.trai,
      backtestRecorder: this.backtestRecorder,
      orderExecutor: this.orderExecutor,
      // Phase 4 REWRITE: MaxProfitManager standalone
      maxProfitManager: this.maxProfitManager,
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

    // REFACTOR Phase 17: DashboardBroadcaster - context with dependencies
    // PIPELINE: Skip dashboard in backtest mode for faster runs
    if (this.pipeline.enableDashboard !== false) {
      this.dashboardBroadcaster = new DashboardBroadcaster({
        indicatorEngine: indicatorEngine
      });
    } else {
      this.dashboardBroadcaster = null;
    }

    // REFACTOR Phase 18: BacktestRunner - context with dependencies
    // Phase 2 REWRITE: executionLayer removed from BacktestRunner
    this.backtestRunner = new BacktestRunner({
      __dirname: __dirname,
      patternChecker: this.patternChecker,
      trai: this.trai,
      backtestRecorder: this.backtestRecorder
    });

    // REFACTOR Phase 19: CandleProcessor - context with runner self-reference
    // Attach indicatorEngine to this so CandleProcessor can access via ctx
    this.indicatorEngine = indicatorEngine;
    this.candleProcessor = new CandleProcessor(this);

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
    if (process.env.BACKTEST_MODE === 'true' || process.env.EXECUTION_MODE === 'backtest' || process.env.CANDLE_SOURCE === 'file') {
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
   * Initialize Dashboard WebSocket connection
   * REFACTOR Phase 20: Thin dispatcher to WebSocketManager
   */
  initializeDashboardWebSocket() {
    this.webSocketManager.initializeDashboardWebSocket();
  }

  /**
   * Start heartbeat ping for WebSocket connection
   * REFACTOR Phase 20: Thin dispatcher to WebSocketManager
   */
  startHeartbeatPing() {
    this.webSocketManager.startHeartbeatPing();
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
        console.log('ðŸ"¡ LIVE/PAPER MODE: Connecting to real-time data...');
        // V2 ARCHITECTURE: Connect broker first to load asset pairs
        await this.kraken.connect();
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
   * REFACTOR Phase 19: Thin dispatcher to CandleProcessor
   */
  handleMarketData(ohlcData) {
    this.candleProcessor.handleMarketData(ohlcData);
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

    this.livenessCheckInterval = setInterval(async () => {
      if (!this.lastDataReceived) {
        // No data ever received - still warming up
        return;
      }

      const silenceDuration = Date.now() - this.lastDataReceived;

      if (silenceDuration > MAX_DATA_SILENCE && !this.staleFeedPaused) {
        console.warn('⚠️ LIVENESS WATCHDOG: No data for', Math.round(silenceDuration / 1000), 'seconds - attempting REST backfill...');

        // ATTEMPT BACKFILL FIRST before halting
        try {
          const candles = await this.kraken.getHistoricalOHLC('XBTUSD', 15, 10);
          if (candles && candles.length > 0) {
            console.log(`✅ REST backfill success: ${candles.length} candles recovered`);
            // Feed candles through CandleProcessor one at a time (uses canonical processNewCandle)
            for (const candle of candles) {
              this.candleProcessor.handleMarketData([
                candle.t / 1000,  // time (seconds)
                candle.etime / 1000,  // etime (seconds)
                candle.o,
                candle.h,
                candle.l,
                candle.c,
                0,  // vwap (not used)
                candle.v,
                0   // count (not used)
              ]);
            }
            this.lastDataReceived = Date.now();
            console.log('🔄 Data feed recovered via REST backfill - continuing');
            return; // Don't halt - we recovered
          }
        } catch (backfillError) {
          console.error('❌ REST backfill failed:', backfillError.message);
        }

        // Backfill failed - now halt
        console.error('🚨🚨🚨 LIVENESS WATCHDOG: BACKFILL FAILED - HALTING');
        console.error('⸏ PAUSING TRADING - DATA FEED APPEARS DEAD');
        this.staleFeedPaused = true;

        // Notify StateManager to pause
        try {
          const { getInstance: getStateManager } = require('./core/StateManager');
          const stateManager = getStateManager();
          stateManager.pauseTrading(`Liveness watchdog: No data for ${Math.round(silenceDuration / 1000)}s, backfill failed`);
        } catch (error) {
          console.error('Failed to pause via StateManager:', error.message);
        }
      }
    }, LIVENESS_CHECK_INTERVAL);

    console.log('ðŸ” Liveness watchdog started (checks every 60s, attempts REST backfill before halting)');
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
  // Phase 3 REWRITE: EntryDecider deleted, logic inlined to TradingLoop


  /**
   * Execute a trade - PHASE 14 THIN DISPATCHER
   * Original logic moved to core/OrderExecutor.js
   * Phase 3 REWRITE: Renamed brainDecision → orchResult (orchestrator result)
   */
  async executeTrade(decision, confidenceData, price, indicators, patterns, traiDecision = null, orchResult = null) {
    // Update context with current runtime values
    this.orderExecutor.ctx.marketData = this.marketData;
    this.orderExecutor.ctx.dashboardWs = this.dashboardWs;
    this.orderExecutor.ctx.dashboardWsConnected = this.dashboardWsConnected;
    this.orderExecutor.ctx._lastTraiDecision = this._lastTraiDecision;

    // Delegate to OrderExecutor (exact copy of original logic)
    return this.orderExecutor.executeTrade(decision, confidenceData, price, indicators, patterns, traiDecision, orchResult);
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

        // Phase 2 REWRITE: profileManager deleted - profiles now in TradingConfig
        const activeProfile = process.env.TRADING_PROFILE || 'balanced';

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
            // Use getRawState() for dashboard compatibility with legacy format
            ema: indicatorEngine.getRawState().ema || {},
            // CHANGE 2026-01-25: Send BB and VWAP for dashboard overlays
            bb: indicatorEngine.getRawState().bb || {},
            vwap: indicatorEngine.getRawState().vwap || null
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
   * REFACTOR Phase 18: Thin dispatcher - delegates to BacktestRunner
   */
  async loadHistoricalDataAndBacktest() {
    // Update context with current instance state before delegating
    this.backtestRunner.ctx.priceHistory = this.priceHistory;
    this.backtestRunner.ctx.handleMarketData = this.handleMarketData.bind(this);
    this.backtestRunner.ctx.analyzeAndTrade = this.analyzeAndTrade.bind(this);
    return this.backtestRunner.loadHistoricalDataAndBacktest();
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
      // Phase 2 REWRITE: executionLayer deleted - use stateManager for position info
      const lastCandle = this.priceHistory[this.priceHistory.length - 1];
      const stats = {};
      const position = stateManager.getPosition();

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
   * REFACTOR Phase 17: Thin dispatcher - delegates to DashboardBroadcaster
   */
  broadcastEdgeAnalytics(price, volume, candle) {
    this.dashboardBroadcaster.ctx.dashboardWs = this.dashboardWs;
    this.dashboardBroadcaster.ctx.priceHistory = this.priceHistory;
    return this.dashboardBroadcaster.broadcastEdgeAnalytics(price, volume, candle);
  }

  /**
   * Calculate price volatility for Fear & Greed
   * REFACTOR Phase 17: Thin dispatcher
   */
  calculateVolatility() {
    this.dashboardBroadcaster.ctx.priceHistory = this.priceHistory;
    return this.dashboardBroadcaster.calculateVolatility();
  }

  /**
   * Detect price/indicator divergences
   * REFACTOR Phase 17: Thin dispatcher
   */
  detectDivergences() {
    this.dashboardBroadcaster.ctx.priceHistory = this.priceHistory;
    return this.dashboardBroadcaster.detectDivergences();
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
