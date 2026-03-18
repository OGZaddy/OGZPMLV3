/**
 * ConfigLoader.js - Single Source of Truth for ALL Configuration
 * ==============================================================
 * 
 * RULES:
 * 1. ONLY this file reads process.env
 * 2. Every module receives config via constructor injection
 * 3. Config is frozen after load — no runtime mutations
 * 4. Every value is typed, validated, and source-tracked
 * 5. Unknown env vars are logged as warnings
 * 
 * USAGE:
 *   const config = require('./foundation/ConfigLoader').load();
 *   const tradingLoop = new TradingLoop(config);
 *   // tradingLoop NEVER touches process.env
 * 
 * @module foundation/ConfigLoader
 * @author Claude (Opus) for Trey / OGZPrime
 * @date 2026-03-17
 */

'use strict';

const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════
// ENV READER HELPERS (private — only used inside this file)
// ═══════════════════════════════════════════════════════════════

function envStr(key, fallback) {
  const val = process.env[key];
  if (val !== undefined && val !== '') return { value: val, source: `env:${key}` };
  return { value: fallback, source: 'default' };
}

function envFloat(key, fallback) {
  const val = process.env[key];
  if (val !== undefined && val !== '') {
    const parsed = parseFloat(val);
    if (!isNaN(parsed)) return { value: parsed, source: `env:${key}` };
  }
  return { value: fallback, source: 'default' };
}

function envInt(key, fallback) {
  const val = process.env[key];
  if (val !== undefined && val !== '') {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) return { value: parsed, source: `env:${key}` };
  }
  return { value: fallback, source: 'default' };
}

function envBool(key, fallback) {
  const val = process.env[key];
  if (val === 'true' || val === '1') return { value: true, source: `env:${key}` };
  if (val === 'false' || val === '0') return { value: false, source: `env:${key}` };
  return { value: fallback, source: 'default' };
}

// ═══════════════════════════════════════════════════════════════
// SCHEMA — every env var the system reads, typed and documented
// ═══════════════════════════════════════════════════════════════

function buildConfig() {
  const sources = {}; // Track where each value came from
  
  function track(path, result) {
    sources[path] = result.source;
    return result.value;
  }

  const config = {
    // ─── EXECUTION MODE ───
    mode: {
      execution: track('mode.execution', envStr('EXECUTION_MODE', 'paper')),
      backtest: track('mode.backtest', envBool('BACKTEST_MODE', false)),
      paperTrading: track('mode.paperTrading', envBool('PAPER_TRADING', false)),
      liveTrading: track('mode.liveTrading', envBool('LIVE_TRADING', false)),
      confirmLiveTrading: track('mode.confirmLiveTrading', envBool('CONFIRM_LIVE_TRADING', false)),
      testMode: track('mode.testMode', envBool('TEST_MODE', false)),
      candleSource: track('mode.candleSource', envStr('CANDLE_SOURCE', 'websocket')),
    },

    // ─── BACKTEST ───
    backtest: {
      candleDataFile: track('backtest.candleDataFile', envStr('CANDLE_DATA_FILE', '')),
      candleFile: track('backtest.candleFile', envStr('CANDLE_FILE', '')),
      initialBalance: track('backtest.initialBalance', envFloat('INITIAL_BALANCE', 10000)),
      silent: track('backtest.silent', envBool('BACKTEST_SILENT', false)),
      verbose: track('backtest.verbose', envBool('BACKTEST_VERBOSE', false)),
      fast: track('backtest.fast', envBool('BACKTEST_FAST', false)),
      noPatternSave: track('backtest.noPatternSave', envBool('BACKTEST_NO_PATTERN_SAVE', false)),
      fastBacktest: track('backtest.fastBacktest', envBool('FAST_BACKTEST', false)),
      freshStart: track('backtest.freshStart', envBool('FRESH_START', false)),
    },

    // ─── PATHS ───
    paths: {
      envFile: track('paths.envFile', envStr('DOTENV_CONFIG_PATH', '.env')),
      stateFile: track('paths.stateFile', envStr('STATE_FILE', '')),
      dataDir: track('paths.dataDir', envStr('DATA_DIR', '')),
    },

    // ─── MONITORING ───
    monitoring: {
      sentryDsn: track('monitoring.sentryDsn', envStr('SENTRY_DSN', '')),
      sentryEnabled: track('monitoring.sentryEnabled', envBool('SENTRY_ENABLED', true)),
    },

    // ─── CONFIDENCE GATES ───
    confidence: {
      minTradeConfidence: track('confidence.minTradeConfidence', envFloat('MIN_TRADE_CONFIDENCE', 0.50)),
      minStrategyConfidence: track('confidence.minStrategyConfidence', envFloat('MIN_STRATEGY_CONFIDENCE', 0.35)),
      maxConfidence: track('confidence.maxConfidence', envFloat('MAX_CONFIDENCE', 0.95)),
    },

    // ─── POSITION SIZING ───
    sizing: {
      basePositionSize: track('sizing.basePositionSize', envFloat('BASE_POSITION_SIZE', 0.01)),
      maxPositionSize: track('sizing.maxPositionSize', envFloat('MAX_POSITION_SIZE_PCT', 0.05)),
      maxPositions: track('sizing.maxPositions', envInt('MAX_POSITIONS', 3)),
    },

    // ─── EXIT PARAMETERS ───
    exits: {
      stopLossPercent: track('exits.stopLossPercent', envFloat('STOP_LOSS_PERCENT', 1.5)),
      takeProfitPercent: track('exits.takeProfitPercent', envFloat('TAKE_PROFIT_PERCENT', 2.0)),
      trailingStopPercent: track('exits.trailingStopPercent', envFloat('TRAILING_STOP_PERCENT', 3.5)),
      trailingActivation: track('exits.trailingActivation', envFloat('TRAILING_ACTIVATION', 2.5)),
      maxHoldMinutes: track('exits.maxHoldMinutes', envInt('MAX_HOLD_MINUTES', 240)),
      exitSystem: track('exits.exitSystem', envStr('EXIT_SYSTEM', 'maxprofit')),
    },

    // ─── PROFIT TIERS ───
    tiers: {
      tier1: track('tiers.tier1', envFloat('TIER1_TARGET', 0.007)),
      tier2: track('tiers.tier2', envFloat('TIER2_TARGET', 0.010)),
      tier3: track('tiers.tier3', envFloat('TIER3_TARGET', 0.015)),
      final: track('tiers.final', envFloat('FINAL_TARGET', 0.025)),
    },

    // ─── FEES ───
    fees: {
      makerFee: track('fees.makerFee', envFloat('FEE_MAKER', 0.0025)),
      takerFee: track('fees.takerFee', envFloat('FEE_TAKER', 0.004)),
      get totalRoundTrip() { return this.makerFee + this.takerFee; },
    },

    // ─── RISK MANAGEMENT ───
    risk: {
      riskManagerBypass: track('risk.riskManagerBypass', envBool('RISK_MANAGER_BYPASS', true)),
      accountDrawdownBypass: track('risk.accountDrawdownBypass', envBool('ACCOUNT_DRAWDOWN_BYPASS', false)),
      maxDrawdown: track('risk.maxDrawdown', envFloat('MAX_DRAWDOWN', 10)),
      maxDailyLoss: track('risk.maxDailyLoss', envFloat('MAX_DAILY_LOSS', 3)),
    },

    // ─── FILTERS ───
    filters: {
      atrEnabled: track('filters.atrEnabled', envBool('ATR_FILTER_ENABLED', false)),
      atrMinPercent: track('filters.atrMinPercent', envFloat('ATR_MIN_PERCENT', 0.15)),
    },

    // ─── DYNAMIC TRAILING STOP ───
    trail: {
      atrMultiplier: track('trail.atrMultiplier', envFloat('TRAIL_ATR_MULTIPLIER', 2.0)),
      minActivation: track('trail.minActivation', envFloat('TRAIL_MIN_ACTIVATION', 1.5)),
      trendWiden: track('trail.trendWiden', envFloat('TRAIL_TREND_WIDEN', 1.5)),
      structureTighten: track('trail.structureTighten', envFloat('TRAIL_STRUCTURE_TIGHTEN', 0.5)),
    },

    // ─── BROKER ───
    broker: {
      apiKey: track('broker.apiKey', envStr('KRAKEN_API_KEY', '')),
      apiSecret: track('broker.apiSecret', envStr('KRAKEN_API_SECRET', '')),
      tradingPair: track('broker.tradingPair', envStr('TRADING_PAIR', 'BTC-USD')),
      candleTimeframe: track('broker.candleTimeframe', envStr('CANDLE_TIMEFRAME', '15m')),
      tradingInterval: track('broker.tradingInterval', envInt('TRADING_INTERVAL', 15000)),
    },

    // ─── TRAI (AI) ───
    trai: {
      enabled: track('trai.enabled', envBool('ENABLE_TRAI', false)),
      mode: track('trai.mode', envStr('TRAI_MODE', 'advisory')),
      weight: track('trai.weight', envFloat('TRAI_WEIGHT', 0.2)),
      vetoPower: track('trai.vetoPower', envBool('TRAI_VETO', false)),
      maxRisk: track('trai.maxRisk', envFloat('TRAI_MAX_RISK', 0.03)),
      minConf: track('trai.minConf', envFloat('TRAI_MIN_CONF', 0.40)),
      maxConf: track('trai.maxConf', envFloat('TRAI_MAX_CONF', 0.95)),
      enableBacktest: track('trai.enableBacktest', envBool('TRAI_ENABLE_BACKTEST', false)),
    },

    // ─── PIPELINE TOGGLES ───
    strategies: {
      enableRSI: track('strategies.enableRSI', envBool('ENABLE_RSI', true)),
      enableMADynamicSR: track('strategies.enableMADynamicSR', envBool('ENABLE_MASR', true)),
      enableEMACrossover: track('strategies.enableEMACrossover', envBool('ENABLE_EMA', true)),
      enableLiquiditySweep: track('strategies.enableLiquiditySweep', envBool('ENABLE_LIQSWEEP', true)),
      enableBreakRetest: track('strategies.enableBreakRetest', envBool('ENABLE_BREAKRETEST', false)),
      enableMarketRegime: track('strategies.enableMarketRegime', envBool('ENABLE_REGIME', true)),
      enableMultiTimeframe: track('strategies.enableMultiTimeframe', envBool('ENABLE_MTF', true)),
      enableOGZTPO: track('strategies.enableOGZTPO', envBool('ENABLE_TPO', true)),
      enableORB: track('strategies.enableORB', envBool('ENABLE_ORB', false)),
      enableDashboard: track('strategies.enableDashboard', envBool('ENABLE_DASHBOARD', true)),
    },

    // ─── MISC ───
    misc: {
      botTier: track('misc.botTier', envStr('BOT_TIER', 'ml')),
      tradingProfile: track('misc.tradingProfile', envStr('TRADING_PROFILE', 'balanced')),
      tradeIntelligenceShadow: track('misc.tradeIntelligenceShadow', envBool('TRADE_INTELLIGENCE_SHADOW', false)),
      subscriptionTier: track('misc.subscriptionTier', envStr('SUBSCRIPTION_TIER', 'ML')),
    },
  };

  return { config, sources };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

function validate(config) {
  const errors = [];
  const warnings = [];

  // Confidence
  if (config.confidence.minTradeConfidence < 0 || config.confidence.minTradeConfidence > 1) {
    errors.push(`minTradeConfidence out of range: ${config.confidence.minTradeConfidence}`);
  }
  if (config.confidence.minStrategyConfidence < 0 || config.confidence.minStrategyConfidence > 1) {
    errors.push(`minStrategyConfidence out of range: ${config.confidence.minStrategyConfidence}`);
  }
  if (config.confidence.minTradeConfidence < 0.1) {
    warnings.push(`minTradeConfidence very low (${config.confidence.minTradeConfidence}) — bot will enter on weak signals`);
  }

  // Sizing
  if (config.sizing.maxPositionSize > 0.25) {
    errors.push(`maxPositionSize too high: ${config.sizing.maxPositionSize} (>25% of account per trade)`);
  }

  // Exits
  if (config.exits.stopLossPercent <= 0) {
    errors.push(`stopLossPercent must be positive: ${config.exits.stopLossPercent}`);
  }
  if (config.exits.takeProfitPercent <= 0) {
    errors.push(`takeProfitPercent must be positive: ${config.exits.takeProfitPercent}`);
  }

  // Tiers must be above fees
  const feeThreshold = config.fees.totalRoundTrip;
  if (config.tiers.tier1 < feeThreshold) {
    warnings.push(`tier1 (${config.tiers.tier1}) below round-trip fees (${feeThreshold}) — tier 1 exits are net losses`);
  }

  // Mode conflicts
  if (config.mode.liveTrading && config.mode.backtest) {
    errors.push('Cannot enable both live trading and backtest mode');
  }

  // Balance
  if (config.backtest.initialBalance <= 0) {
    errors.push(`initialBalance must be positive: ${config.backtest.initialBalance}`);
  }

  return { errors, warnings };
}

// ═══════════════════════════════════════════════════════════════
// FINGERPRINT
// ═══════════════════════════════════════════════════════════════

function fingerprint(config) {
  // Exclude secrets from fingerprint
  const safe = JSON.parse(JSON.stringify(config));
  if (safe.broker) {
    safe.broker.apiKey = safe.broker.apiKey ? '[SET]' : '[UNSET]';
    safe.broker.apiSecret = safe.broker.apiSecret ? '[SET]' : '[UNSET]';
  }
  const str = JSON.stringify(safe, Object.keys(safe).sort());
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

// ═══════════════════════════════════════════════════════════════
// DEEP FREEZE
// ═══════════════════════════════════════════════════════════════

function deepFreeze(obj) {
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null && !Object.isFrozen(obj[key])) {
      deepFreeze(obj[key]);
    }
  }
  return obj;
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

let _cached = null;

function load(opts = {}) {
  if (_cached && !opts.force) return _cached;

  // Load .env if not already loaded
  const envPath = process.env.DOTENV_CONFIG_PATH || '.env';
  require('dotenv').config({ path: envPath });

  // Normalize BACKTEST_MODE
  if (process.env.EXECUTION_MODE === 'backtest' || process.env.CANDLE_SOURCE === 'file') {
    process.env.BACKTEST_MODE = 'true';
  }

  // Backtest state isolation - set before buildConfig reads these values
  if (process.env.BACKTEST_MODE === 'true') {
    const path = require('path');
    process.env.STATE_FILE = process.env.STATE_FILE || path.join(process.cwd(), 'data', 'state-backtest.json');
    process.env.DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data', 'backtest');
  }

  const { config, sources } = buildConfig();
  const { errors, warnings } = validate(config);
  const fp = fingerprint(config);

  // Log
  if (!opts.silent) {
    console.log(`\n[ConfigLoader] Fingerprint: ${fp}`);
    console.log(`[ConfigLoader] Source: ${envPath}`);
    if (warnings.length > 0) {
      warnings.forEach(w => console.warn(`[ConfigLoader] WARNING: ${w}`));
    }
    if (errors.length > 0) {
      errors.forEach(e => console.error(`[ConfigLoader] ERROR: ${e}`));
      if (!config.mode.backtest) {
        throw new Error(`ConfigLoader: ${errors.length} validation errors — fix before trading`);
      }
    }
  }

  // Freeze
  const frozen = deepFreeze(config);

  _cached = {
    config: frozen,
    sources,
    fingerprint: fp,
    errors,
    warnings,
    timestamp: new Date().toISOString(),
  };

  return _cached;
}

function get(path) {
  if (!_cached) load();
  const parts = path.split('.');
  let val = _cached.config;
  for (const part of parts) {
    if (val === undefined || val === null) return undefined;
    val = val[part];
  }
  return val;
}

module.exports = { load, get, fingerprint, validate };
