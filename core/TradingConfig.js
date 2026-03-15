/**
 * TradingConfig.js - CENTRALIZED TRADING CONFIGURATION
 * =====================================================
 * SINGLE SOURCE OF TRUTH for ALL trading parameters.
 *
 * RULES:
 * 1. This is the ONLY file that reads process.env for trading params
 * 2. All other files import from TradingConfig, NEVER from process.env directly
 * 3. If you find parseFloat(process.env.TRADING_PARAM) anywhere else, it's a bug
 * 4. Use setOverrides() for backtest/dashboard temporary config changes
 *
 * Created: 2026-02-28
 * Purpose: Eliminate scattered hardcoded values across 15+ files
 */

require('dotenv').config();

// Helper to parse env vars with fallback
const env = (key, fallback) => {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  const num = parseFloat(val);
  return isNaN(num) ? val : num;
};

const envBool = (key, fallback) => {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  return val === 'true' || val === '1';
};

// =============================================================================
// BASE CONFIGURATION - Read from .env with sensible defaults
// =============================================================================

const BASE_CONFIG = {
  // =========================================================================
  // CONFIDENCE THRESHOLDS
  // =========================================================================
  confidence: {
    minTradeConfidence: env('MIN_TRADE_CONFIDENCE', 0.35),      // 35% - Kills CandlePattern noise (10% floor), RSI passes (50%+)
    maxConfidence: env('MAX_CONFIDENCE', 0.95),                  // 95% - cap (nothing is 100%)
    minStrategyConfidence: env('MIN_STRATEGY_CONFIDENCE', 0.35), // 35% - per individual strategy
    // REMOVED 2026-03-10 (dead config - nothing reads these):
    // minSignalConfidence: env('MIN_SIGNAL_CONFIDENCE', 0.25),
    // minSignalsToTrade: env('MIN_SIGNALS_TO_TRADE', 2),
    // confidencePenalty: env('CONFIDENCE_PENALTY', 0.10),
    // confidenceBoost: env('CONFIDENCE_BOOST', 0.05),
  },

  // =========================================================================
  // RISK MANAGEMENT
  // =========================================================================
  risk: {
    maxRiskPerTrade: env('MAX_RISK_PER_TRADE', 0.02),           // 2% max risk per trade
    maxDrawdown: env('MAX_DRAWDOWN', 0.18),                      // 18% max account drawdown
    maxDailyLoss: env('MAX_DAILY_LOSS', 0.10),                   // 10% max daily loss

    // Recovery mode (after losses)
    recoveryModeReduction: 0.50,                                  // 50% size reduction in recovery
    counterTrendReduction: 0.30,                                  // 30% reduction against trend
    lowConfidenceReduction: 0.25,                                 // 25% reduction on weak signals
    highConfidenceBoost: 1.30,                                    // 1.3x on strong signals
  },

  // =========================================================================
  // POSITION SIZING
  // =========================================================================
  positionSizing: {
    basePositionSize: env('BASE_POSITION_SIZE', 0.01),           // 1% base position
    maxPositionSize: env('MAX_POSITION_SIZE_PCT', 0.05),         // 5% max position
    maxPositions: env('MAX_POSITIONS', 3),                        // Max concurrent positions

    // Volatility-based scaling
    lowVolMultiplier: env('LOW_VOL_MULTIPLIER', 1.5),            // 1.5x in calm markets
    highVolMultiplier: env('HIGH_VOL_MULTIPLIER', 0.6),          // 0.6x in choppy markets
    lowVolThreshold: env('LOW_VOL_THRESHOLD', 0.015),            // 1.5% = low volatility
    highVolThreshold: env('HIGH_VOL_THRESHOLD', 0.035),          // 3.5% = high volatility

    // Confidence-scaled sizing (from engine tuning)
    confidenceSizeMin: 0.5,                                       // 50% base at low confidence
    confidenceSizeMax: 2.5,                                       // 250% base at high confidence
    confidenceSizeSlope: 4.0,                                     // scaling factor

    // Confluence multipliers
    confluenceMultipliers: {
      1: 1.0,   // 1 strategy = base size
      2: 1.5,   // 2 strategies agree = 1.5x
      3: 2.0,   // 3 strategies agree = 2x
      4: 2.5,   // 4+ strategies = capped at 2.5x
    },
  },

  // =========================================================================
  // STOP LOSS / TAKE PROFIT - Defaults (strategies override via EXIT_CONTRACTS)
  // =========================================================================
  // NOTE: All percentages in PERCENT form (1.5 = 1.5%, not 0.015)
  // This matches .env and ExitContractManager convention
  exits: {
    stopLossPercent: env('STOP_LOSS_PERCENT', 1.5),              // 1.5% default SL
    takeProfitPercent: env('TAKE_PROFIT_PERCENT', 2.0),          // 2.0% default TP
    trailingStopPercent: env('TRAILING_STOP_PERCENT', 3.5),      // 3.5% trailing
    trailingActivation: env('TRAILING_ACTIVATION', 2.5),         // 2.5% profit before trailing kicks in

    // Breakeven system (percent form)
    breakevenTrigger: env('BREAKEVEN_TRIGGER', 0.5),             // 0.5% profit triggers BE
    breakevenExitPercent: env('BREAKEVEN_EXIT_PERCENT', 50),     // 50% position exits at BE
    postBreakevenTrail: env('POST_BREAKEVEN_TRAIL', 5.0),        // 5% trail after BE withdrawal
    profitProtectionLevel: env('PROFIT_PROTECTION', 1.5),        // 1.5% min profit to lock in

    // Tiered profit targets (for MaxProfitManager)
    profitTiers: {
      tier1: env('TIER1_TARGET', 0.007),                         // 0.7% first tier
      tier2: env('TIER2_TARGET', 0.010),                         // 1.0% second tier
      tier3: env('TIER3_TARGET', 0.015),                         // 1.5% third tier
      final: env('FINAL_TARGET', 0.025),                         // 2.5% final target
    },

    // Trail distances
    normalTrailDistance: env('TRAIL_DISTANCE', 0.025),           // 2.5% normal trail
    tightTrailDistance: env('TIGHT_TRAIL_DISTANCE', 0.015),      // 1.5% tight trail
  },

  // =========================================================================
  // STRATEGY-SPECIFIC EXIT CONTRACTS
  // =========================================================================
  exitContracts: {
    EMASMACrossover: {
      stopLossPercent: -1.2,
      takeProfitPercent: 2.5,
      trailingStopPercent: 0.8,
      trailingActivation: 1.0,
      maxHoldTimeMinutes: 300,
      invalidationConditions: ['ema_cross_reversal'],
    },
    LiquiditySweep: {
      stopLossPercent: -0.8,
      takeProfitPercent: 1.5,
      trailingStopPercent: 0.5,
      trailingActivation: 0.7,
      maxHoldTimeMinutes: 180,
      invalidationConditions: ['liquidity_absorbed'],
    },
    RSI: {
      stopLossPercent: -0.5,
      takeProfitPercent: 2.0,
      trailingStopPercent: 0.6,
      trailingActivation: 0.8,
      maxHoldTimeMinutes: 240,
      invalidationConditions: [],
    },
    MADynamicSR: {
      stopLossPercent: -0.8,
      takeProfitPercent: 1.5,
      trailingStopPercent: 0.5,
      trailingActivation: 0.7,
      maxHoldTimeMinutes: 180,
      invalidationConditions: ['sr_break'],
    },
    CandlePattern: {
      stopLossPercent: -0.4,
      takeProfitPercent: 1.5,
      trailingStopPercent: 0.5,
      trailingActivation: 0.7,
      maxHoldTimeMinutes: 150,
      invalidationConditions: ['pattern_invalidated'],
    },
    MarketRegime: {
      stopLossPercent: -1.5,
      takeProfitPercent: 3.0,
      trailingStopPercent: 1.0,
      trailingActivation: 1.5,
      maxHoldTimeMinutes: 360,
      invalidationConditions: ['regime_change'],
    },
    MultiTimeframe: {
      stopLossPercent: -1.2,
      takeProfitPercent: 2.5,
      trailingStopPercent: 0.8,
      trailingActivation: 1.0,
      maxHoldTimeMinutes: 300,
      invalidationConditions: [],
    },
    OGZTPO: {
      stopLossPercent: -1.0,
      takeProfitPercent: 2.0,
      trailingStopPercent: 0.6,
      trailingActivation: 0.8,
      maxHoldTimeMinutes: 240,
      invalidationConditions: [],
    },
    OpeningRangeBreakout: {
      stopLossPercent: -1.0,
      takeProfitPercent: 2.0,
      trailingStopPercent: 0.6,
      trailingActivation: 0.8,
      maxHoldTimeMinutes: 180,
      invalidationConditions: ['fvg_filled', 'or_break_reversal'],
    },
    default: {
      stopLossPercent: -1.0,
      takeProfitPercent: 2.0,
      trailingStopPercent: 0.6,
      trailingActivation: 0.8,
      maxHoldTimeMinutes: 240,
      invalidationConditions: [],
    },
  },

  // =========================================================================
  // STRATEGY-SPECIFIC PARAMETERS (per STRATEGY-REWRITE-SPEC.md)
  // =========================================================================
  strategies: {
    MADynamicSR: {
      // Trader DNA CORRECTED - 20 MA for trend/entry, 200 MA for S/R level
      entryMaPeriod: env('MASR_ENTRY_MA', 20),         // 20 MA — trend + entry line
      srMaPeriod: env('MASR_SR_MA', 200),              // 200 MA — support/resistance level (NOT trend)
      touchZonePct: env('MASR_TOUCH_ZONE', 0.6),       // % distance to count as "touching"
      srTestCount: env('MASR_SR_TESTS', 2),            // Min S/R zone touches
      swingLookback: env('MASR_SWING_LOOKBACK', 3),    // Bars to confirm a swing
      srZonePct: env('MASR_SR_ZONE_PCT', 1.0),         // Zone width as % of price
      slopeLookback: env('MASR_SLOPE_LOOKBACK', 5),    // Bars to compare 20 MA slope
      minSlopePct: env('MASR_MIN_SLOPE', 0.03),        // Min slope % to count as trending
      extensionPct: env('MASR_EXTENSION_PCT', 2.0),    // Max distance from 20 MA (%)
      skipFirstTouch: true,                            // Skip first touch after extension
      atrPeriod: env('MASR_ATR_PERIOD', 14),           // ATR for SL buffer
      patternPersistBars: env('MASR_PATTERN_PERSIST', 15),
      enabled: true,
    },
    EMACrossover: {
      // EMA/SMA crossover with snapback detection
      decayBars: env('EMA_DECAY_BARS', 10),            // Signal decay (bars until fade)
      snapbackThreshold: env('EMA_SNAPBACK_PCT', 2.5), // % spread for snapback signal
      blowoffThreshold: env('EMA_BLOWOFF_ACCEL', 0.15),// Acceleration threshold
      enabled: true,
    },
    LiquiditySweep: {
      // Marco-style liquidity grabs (24/7 crypto)
      sweepLookbackBars: env('LIQSWEEP_LOOKBACK', 50),         // Was lookbackCandles — renamed to match constructor
      sweepMinExtensionPct: env('LIQSWEEP_WICK_MIN', 0.1),     // Was sweepWickMinPct — renamed to match constructor
      atrMultiplier: env('LIQSWEEP_ATR_MULT', 0.25),           // NEW — was only hardcoded default
      atrPeriod: env('LIQSWEEP_ATR_PERIOD', 14),               // NEW
      entryWindowMinutes: env('LIQSWEEP_ENTRY_WINDOW_MIN', 90),  // 90 min entry window
      hammerBodyMaxPct: env('LIQSWEEP_HAMMER_BODY', 0.35),     // NEW
      hammerWickMinRatio: env('LIQSWEEP_HAMMER_WICK', 2.0),    // NEW
      engulfMinRatio: env('LIQSWEEP_ENGULF_RATIO', 1.0),       // NEW
      stopBufferPct: env('LIQSWEEP_STOP_BUFFER', 0.05),        // NEW
      disableSessionCheck: true,                                 // 24/7 crypto — no session filter
      enabled: true,
    },
    RSI: {
      // RSI mean reversion on extremes
      period: 14,                                       // Standard RSI period
      oversoldLevel: env('RSI_OVERSOLD', 30),          // Oversold threshold (widened from 25)
      overboughtLevel: env('RSI_OVERBOUGHT', 70),      // Overbought threshold (widened from 75)
      enabled: true,
    },
    VolumeProfile: {
      // Fabio Valentino - Auction Market Theory
      sessionLookback: env('VP_SESSION_LOOKBACK', 96), // 24h of 15m candles
      numBins: env('VP_NUM_BINS', 50),                 // Price bins for profile
      valueAreaPct: env('VP_VALUE_AREA_PCT', 0.70),    // 70% value area
      outOfBalancePct: env('VP_OUT_OF_BALANCE_PCT', 0.5), // Was 0.1%, needs 0.5%
      recalcInterval: env('VP_RECALC_INTERVAL', 5),    // Candles between recalc
      enabled: true,
    },
    OpeningRangeBreakout: {
      // ICT-style Opening Range + FVG entry (Trey's approach)
      sessionOpenHourUTC: env('ORB_SESSION_OPEN_HOUR', 14),  // 9am EST = 14:00 UTC
      orDurationMinutes: env('ORB_DURATION_MIN', 15),        // First 15 min defines OR
      fvgScanBars: env('ORB_FVG_SCAN_BARS', 10),             // Bars to scan for FVG after breakout
      minFVGPercent: env('ORB_MIN_FVG_PCT', 0.05),           // Minimum FVG size %
      maxFVGPercent: env('ORB_MAX_FVG_PCT', 2.0),            // Maximum FVG size %
      entryLevel: env('ORB_ENTRY_LEVEL', 'top'),             // 'top', 'middle', 'bottom' of FVG
      stopBufferPct: env('ORB_STOP_BUFFER_PCT', 0.05),       // Stop buffer beyond first candle
      targetRR: env('ORB_TARGET_RR', 2.0),                   // Risk:Reward ratio
      enabled: true,
    },
  },

  // =========================================================================
  // UNIVERSAL CIRCUIT BREAKERS (override strategy contracts)
  // =========================================================================
  universalLimits: {
    hardStopLossPercent: -5.0,                                    // -5% absolute max loss (was -2%, too tight for BTC)
    accountDrawdownPercent: -10.0,                                // -10% force close all
    maxHoldTimeMinutes: 360,                                      // 6 hours max hold (matches MarketRegime)
  },

  // =========================================================================
  // MAX HOLD TIMES
  // =========================================================================
  holdTimes: {
    defaultMaxHold: 180,                                          // 3 hours default
    minHoldTimeMinutes: env('MIN_HOLD_TIME_MINUTES', 0.0),       // 0 = no minimum (scalping)

    // Time-based trail tightening (for MaxProfitManager)
    tighteningSchedule: [
      { minutes: 30, trailFactor: 1.0 },
      { minutes: 60, trailFactor: 0.8 },
      { minutes: 120, trailFactor: 0.6 },
      { minutes: 180, trailFactor: 0.4 },
    ],
  },

  // =========================================================================
  // FEE CONFIGURATION
  // =========================================================================
  fees: {
    makerFee: env('FEE_MAKER', 0.0025),                          // 0.25% maker (Kraken actual)
    takerFee: env('FEE_TAKER', 0.0040),                          // 0.40% taker (Kraken actual)
    slippage: env('FEE_SLIPPAGE', 0.0005),                       // 0.05% slippage
    totalRoundTrip: env('FEE_TOTAL_ROUNDTRIP', 0.0065),          // 0.65% total (maker 0.25% + taker 0.40%)
    safetyBuffer: env('FEE_SAFETY_BUFFER', 0.001),               // 0.10% buffer

    // Computed: minimum profit to be a "winner" after fees
    get minProfitAfterFees() {
      return this.totalRoundTrip + this.safetyBuffer;            // ~0.52%
    },
  },

  // =========================================================================
  // TIMEFRAME-SPECIFIC ADJUSTMENTS
  // =========================================================================
  timeframeConfig: {
    '1m':  { trailPct: 0.003, maxHoldMin: 15,   slPct: 0.005, tpPct: 0.008 },
    '5m':  { trailPct: 0.006, maxHoldMin: 60,   slPct: 0.010, tpPct: 0.018 },
    '15m': { trailPct: 0.010, maxHoldMin: 120,  slPct: 0.015, tpPct: 0.025 },
    '30m': { trailPct: 0.015, maxHoldMin: 240,  slPct: 0.020, tpPct: 0.035 },
    '1h':  { trailPct: 0.020, maxHoldMin: 480,  slPct: 0.025, tpPct: 0.045 },
    '4h':  { trailPct: 0.030, maxHoldMin: 1440, slPct: 0.035, tpPct: 0.070 },
    '1d':  { trailPct: 0.040, maxHoldMin: 4320, slPct: 0.050, tpPct: 0.100 },
  },

  // =========================================================================
  // MARKET REGIME MULTIPLIERS
  // =========================================================================
  regimeMultipliers: {
    strong_uptrend:   { slMultiplier: 1.5, tpMultiplier: 2.0 },
    mild_uptrend:     { slMultiplier: 1.2, tpMultiplier: 1.5 },
    trading_range:    { slMultiplier: 0.8, tpMultiplier: 1.0 },
    accumulation:     { slMultiplier: 2.0, tpMultiplier: 1.5 },
    volatile_spike:   { slMultiplier: 0.5, tpMultiplier: 0.8 },
    breakout:         { slMultiplier: 1.0, tpMultiplier: 3.0 },
    consolidation:    { slMultiplier: 1.0, tpMultiplier: 2.0 },
  },

  // =========================================================================
  // TRADING PROFILES (for profile-based trading)
  // =========================================================================
  profiles: {
    scalper: {
      minConfidence: 0.40,
      maxPositionSize: 0.10,
      riskPercent: 0.005,
      maxHoldMinutes: 30,
    },
    day_trader: {
      minConfidence: 0.50,
      maxPositionSize: 0.15,
      riskPercent: 0.010,
      maxHoldMinutes: 480,
    },
    swing: {
      minConfidence: 0.60,
      maxPositionSize: 0.25,
      riskPercent: 0.020,
      maxHoldMinutes: 4320,
    },
    conservative: {
      minConfidence: 0.70,
      maxPositionSize: 0.10,
      riskPercent: 0.010,
      maxHoldMinutes: 1440,
    },
    balanced: {
      minConfidence: 0.55,
      maxPositionSize: 0.20,
      riskPercent: 0.015,
      maxHoldMinutes: 720,
    },
    quantum: {
      minConfidence: 0.50,
      maxPositionSize: 0.15,
      riskPercent: 0.010,
      maxHoldMinutes: 480,
    },
  },

  // =========================================================================
  // SCALPER-SPECIFIC CONFIG
  // =========================================================================
  scalper: {
    microProfitTarget: env('SCALPER_MICRO_PROFIT', 0.005),       // 0.5%
    quickProfitTarget: env('SCALPER_QUICK_PROFIT', 0.008),       // 0.8%
    momentumShiftExit: env('SCALPER_MOMENTUM_SHIFT', 0.15),      // 15% momentum loss = exit
    stopMultiplier: env('SCALPER_STOP_MULTIPLIER', 0.5),         // 50% tighter stops
    maxHoldTime: env('SCALPER_MAX_HOLD_TIME', 300000),           // 5 minutes in ms
  },

  // =========================================================================
  // FEATURE FLAGS
  // =========================================================================
  features: {
    enableDynamicSizing: envBool('ENABLE_DYNAMIC_SIZING', true),
    enableVolatilityScaling: envBool('ENABLE_VOLATILITY_SCALING', true),
    enableLearning: envBool('ENABLE_LEARNING', true),
    enableArbitrage: envBool('ENABLE_ARBITRAGE', true),
    enableHedging: envBool('ENABLE_HEDGING', true),
    enableShorts: envBool('ENABLE_SHORTS', false),               // DISABLED - no margin
  },

  // =========================================================================
  // PIPELINE TOGGLES - Component enable/disable for testing
  // =========================================================================
  pipeline: {
    // Strategy toggles
    enableRSI: envBool('ENABLE_RSI', true),
    enableMADynamicSR: envBool('ENABLE_MASR', true),
    enableEMACrossover: envBool('ENABLE_EMA', true),
    enableLiquiditySweep: envBool('ENABLE_LIQSWEEP', true),
    enableBreakRetest: envBool('ENABLE_BREAKRETEST', false),
    enableMarketRegime: envBool('ENABLE_REGIME', true),
    enableMultiTimeframe: envBool('ENABLE_MTF', true),
    enableOGZTPO: envBool('ENABLE_TPO', true),
    enableOpeningRangeBreakout: envBool('ENABLE_ORB', false), // NEW: Disabled by default until tuned

    // Component toggles
    enableRiskManager: envBool('ENABLE_RISK', true),
    enableTRAI: envBool('ENABLE_TRAI', false),
    enableDashboard: envBool('ENABLE_DASHBOARD', true),
    enableNotifications: envBool('ENABLE_NOTIFICATIONS', true),

    // Execution mode: 'live' | 'paper' | 'backtest'
    executionMode: env('EXECUTION_MODE', 'paper'),

    // Candle source: 'live' | 'file'
    candleSource: env('CANDLE_SOURCE', 'live'),
    candleFile: env('CANDLE_FILE', 'tuning/full-45k.json'),

    // Direction filter: 'long_only' | 'both'
    directionFilter: env('DIRECTION_FILTER', 'long_only'),

    // Position mode: 'single' | 'multi'
    positionMode: env('POSITION_MODE', 'single'),
  },

  // =========================================================================
  // FUND TARGET
  // =========================================================================
  fundTarget: env('FUND_TARGET', 25000),
  startingBalance: env('STARTING_BALANCE', 10000),
};

// =============================================================================
// RUNTIME STATE
// =============================================================================

let activeOverrides = {};
let configFrozen = false;

// =============================================================================
// TRADING CONFIG CLASS
// =============================================================================

class TradingConfig {
  /**
   * Get a config value by path (e.g., 'confidence.minTradeConfidence')
   * Overrides take precedence over base config
   */
  static get(path, defaultValue = undefined) {
    // Check overrides first
    if (activeOverrides[path] !== undefined) {
      return activeOverrides[path];
    }

    // Navigate nested path
    const parts = path.split('.');
    let value = BASE_CONFIG;

    for (const part of parts) {
      if (value === undefined || value === null) {
        return defaultValue;
      }
      value = value[part];
    }

    return value !== undefined ? value : defaultValue;
  }

  /**
   * Get entire section (e.g., 'confidence', 'exits', 'exitContracts')
   */
  static getSection(section) {
    const base = BASE_CONFIG[section];
    if (!base) return undefined;

    // Merge any overrides for this section
    const result = { ...base };
    for (const [key, val] of Object.entries(activeOverrides)) {
      if (key.startsWith(`${section}.`)) {
        const subKey = key.slice(section.length + 1);
        result[subKey] = val;
      }
    }

    return result;
  }

  /**
   * Get exit contract for a strategy
   */
  static getExitContract(strategyName) {
    const contracts = BASE_CONFIG.exitContracts;
    return contracts[strategyName] || contracts.default;
  }

  /**
   * Get timeframe-specific config
   */
  static getTimeframeConfig(timeframe) {
    return BASE_CONFIG.timeframeConfig[timeframe] || BASE_CONFIG.timeframeConfig['15m'];
  }

  /**
   * Get regime multipliers
   */
  static getRegimeMultipliers(regime) {
    return BASE_CONFIG.regimeMultipliers[regime] || { slMultiplier: 1.0, tpMultiplier: 1.0 };
  }

  /**
   * Get trading profile
   */
  static getProfile(profileName) {
    return BASE_CONFIG.profiles[profileName] || BASE_CONFIG.profiles.balanced;
  }

  /**
   * Set temporary overrides (for backtest/dashboard)
   * Does NOT modify .env - values only persist until clearOverrides() or process restart
   */
  static setOverrides(overrides) {
    if (configFrozen) {
      console.warn('[TradingConfig] Config is frozen, ignoring setOverrides()');
      return;
    }

    // Flatten nested objects to dot notation
    const flatten = (obj, prefix = '') => {
      const result = {};
      for (const [key, val] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          Object.assign(result, flatten(val, fullKey));
        } else {
          result[fullKey] = val;
        }
      }
      return result;
    };

    const flatOverrides = flatten(overrides);
    activeOverrides = { ...activeOverrides, ...flatOverrides };

    console.log(`[TradingConfig] Overrides set: ${Object.keys(flatOverrides).join(', ')}`);
  }

  /**
   * Clear all overrides (restore to base config)
   */
  static clearOverrides() {
    activeOverrides = {};
    console.log('[TradingConfig] Overrides cleared');
  }

  /**
   * Freeze config (prevent further overrides - use in production)
   */
  static freeze() {
    configFrozen = true;
    console.log('[TradingConfig] Config frozen');
  }

  /**
   * Unfreeze config (allow overrides again)
   */
  static unfreeze() {
    configFrozen = false;
    console.log('[TradingConfig] Config unfrozen');
  }

  /**
   * Get all current config (base + overrides merged)
   */
  static getAll() {
    const result = JSON.parse(JSON.stringify(BASE_CONFIG));

    // Apply overrides
    for (const [path, val] of Object.entries(activeOverrides)) {
      const parts = path.split('.');
      let target = result;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]]) target[parts[i]] = {};
        target = target[parts[i]];
      }
      target[parts[parts.length - 1]] = val;
    }

    return result;
  }

  /**
   * Print current config summary (for debugging)
   */
  static printSummary() {
    const conf = this.getSection('confidence');
    const risk = this.getSection('risk');
    const pos = this.getSection('positionSizing');
    const exits = this.getSection('exits');
    const fees = this.getSection('fees');

    console.log('\n=== TRADING CONFIG SUMMARY ===');
    // Confidence/risk/position are decimal form (0.50 = 50%), multiply by 100
    console.log(`Min Trade Confidence: ${(conf.minTradeConfidence * 100).toFixed(1)}%`);
    console.log(`Max Risk Per Trade:   ${(risk.maxRiskPerTrade * 100).toFixed(1)}%`);
    console.log(`Base Position Size:   ${(pos.basePositionSize * 100).toFixed(1)}%`);
    console.log(`Max Position Size:    ${(pos.maxPositionSize * 100).toFixed(1)}%`);
    // Exits are already in percent form (1.5 = 1.5%), no multiplication needed
    console.log(`Stop Loss:            ${exits.stopLossPercent.toFixed(2)}%`);
    console.log(`Take Profit:          ${exits.takeProfitPercent.toFixed(2)}%`);
    console.log(`Trailing Stop:        ${exits.trailingStopPercent.toFixed(2)}%`);
    console.log(`Round-trip Fees:      ${(fees.totalRoundTrip * 100).toFixed(2)}%`);
    console.log(`Active Overrides:     ${Object.keys(activeOverrides).length}`);
    console.log('==============================\n');
  }

  /**
   * Validate config (check for obviously bad values)
   */
  static validate() {
    const errors = [];

    const conf = this.getSection('confidence');
    const exits = this.getSection('exits');
    const pos = this.getSection('positionSizing');

    // Confidence checks
    if (conf.minTradeConfidence < 0.1) {
      errors.push(`minTradeConfidence too low (${conf.minTradeConfidence}) - likely to enter bad trades`);
    }
    if (conf.minTradeConfidence > 0.9) {
      errors.push(`minTradeConfidence too high (${conf.minTradeConfidence}) - will rarely trade`);
    }

    // Exit checks
    if (Math.abs(exits.stopLossPercent) > Math.abs(exits.takeProfitPercent)) {
      errors.push(`SL (${exits.stopLossPercent}) is wider than TP (${exits.takeProfitPercent}) - negative R:R`);
    }

    // Position sizing checks
    if (pos.maxPositionSize > 0.25) {
      errors.push(`maxPositionSize (${pos.maxPositionSize}) > 25% - very high risk`);
    }

    if (errors.length > 0) {
      console.warn('\n⚠️  TRADING CONFIG VALIDATION WARNINGS:');
      errors.forEach(e => console.warn(`   - ${e}`));
      console.warn('');
    }

    return errors;
  }
}

// =============================================================================
// CONVENIENCE EXPORTS (for quick access to common values)
// =============================================================================

module.exports = TradingConfig;
module.exports.BASE_CONFIG = BASE_CONFIG;

// Quick accessors for the most commonly used values
module.exports.MIN_CONFIDENCE = () => TradingConfig.get('confidence.minTradeConfidence');
module.exports.MAX_RISK = () => TradingConfig.get('risk.maxRiskPerTrade');
module.exports.FEES_ROUND_TRIP = () => TradingConfig.get('fees.totalRoundTrip');
