/**
 * ============================================================================
 * OgzTpoIntegration.js - Two-Pole Oscillator Integration Layer
 * ============================================================================
 *
 * PURPOSE: Bridge the new OGZ TPO indicator into the existing trading flow
 *
 * ARCHITECTURAL ROLE:
 * - Wraps the pure-function ogzTwoPoleOscillator for stateful use
 * - Provides voting system integration for ensemble decisions
 * - Manages dual-TPO A/B testing (new vs existing)
 * - Calculates dynamic SL/TP using ATR
 * - Ready for Empire V2 migration (modular, feature-flagged)
 *
 * EMPIRE V2 READY:
 * - Uses FeatureFlagManager (unified source of truth for feature flags)
 * - Event-driven architecture for decoupling
 * - Pure indicator math separated from strategy logic
 * - Configurable via JSON profiles
 *
 * @author OGZPrime Team (Opus-Valhalla)
 * @version 1.1.0
 * @since 2025-12
 * ============================================================================
 */

const EventEmitter = require('events');
const FeatureFlagManager = require('./FeatureFlagManager');

// FIX 2026-02-16: Use centralized candle helper for format compatibility
const { c, h, l, t } = require('./CandleHelper');

// Import the pure-function TPO
let computeOgzTpo, detectTpoCrossover, calculateDynamicLevels;
try {
    const ogzTpo = require('../src/indicators/ogzTwoPoleOscillator');
    computeOgzTpo = ogzTpo.computeOgzTpo;
    detectTpoCrossover = ogzTpo.detectTpoCrossover;
    calculateDynamicLevels = ogzTpo.calculateDynamicLevels;
} catch (e) {
    console.warn('⚠️ OgzTwoPoleOscillator not found, trying alternate path...');
    try {
        const ogzTpo = require('./src/indicators/ogzTwoPoleOscillator');
        computeOgzTpo = ogzTpo.computeOgzTpo;
        detectTpoCrossover = ogzTpo.detectTpoCrossover;
        calculateDynamicLevels = ogzTpo.calculateDynamicLevels;
    } catch (e2) {
        console.error('❌ OgzTwoPoleOscillator module not found!');
    }
}

// Try to import existing TPO for A/B testing
let ExistingTwoPoleOscillator;
try {
    ExistingTwoPoleOscillator = require('./TwoPoleOscillator');
} catch (e) {
    console.log('ℹ️ Existing TwoPoleOscillator not available for A/B');
}

class OgzTpoIntegration extends EventEmitter {
    constructor(config = {}) {
        super();
        
        // Configuration with defaults
        this.config = {
            enabled: config.enabled ?? true,
            mode: config.mode || 'standard',           // 'standard' | 'aggressive' | 'conservative'
            dynamicSL: config.dynamicSL ?? true,
            confluence: config.confluence ?? false,     // Require both TPOs to agree
            voteWeight: config.voteWeight ?? 0.25,
            adaptive: config.adaptive ?? false,
            
            // TPO parameters
            tpoLength: config.tpoLength || 20,
            normLength: config.normLength || 25,
            volLength: config.volLength || 20,
            lagBars: config.lagBars || 4,
            
            // Mode-specific adjustments
            modes: {
                conservative: { minStrength: 0.03, zoneRequired: true, voteMultiplier: 0.8 },
                standard: { minStrength: 0.02, zoneRequired: false, voteMultiplier: 1.0 },
                aggressive: { minStrength: 0.01, zoneRequired: false, voteMultiplier: 1.2 }
            },
            
            ...config
        };
        
        // Candle history for batch processing
        this.candleHistory = {
            closes: [],
            highs: [],
            lows: [],
            timestamps: []
        };
        this.maxHistory = config.maxHistory || 200;
        
        // Last computed results
        this.lastResult = null;
        this.lastSignal = null;
        
        // Existing TPO for A/B testing
        this.existingTpo = ExistingTwoPoleOscillator ? 
            new ExistingTwoPoleOscillator({
                smaLength: this.config.normLength,
                filterLength: this.config.tpoLength
            }) : null;
        
        // Statistics for A/B comparison
        this.stats = {
            newTpoSignals: 0,
            existingTpoSignals: 0,
            confluenceMatches: 0,
            totalUpdates: 0
        };
        
        console.log(`🎯 OgzTpoIntegration initialized`);
        console.log(`   Mode: ${this.config.mode}`);
        console.log(`   Dynamic SL: ${this.config.dynamicSL ? 'YES' : 'NO'}`);
        console.log(`   Confluence: ${this.config.confluence ? 'ENABLED' : 'DISABLED'}`);
        console.log(`   Vote Weight: ${this.config.voteWeight}`);
    }
    
    /**
     * Initialize from FeatureFlagManager (preferred method)
     * Uses the unified feature flag system
     * @returns {OgzTpoIntegration|null}
     */
    static fromFeatureFlags() {
        const flagManager = FeatureFlagManager.getInstance();

        if (!flagManager.isEnabled('OGZ_TPO')) {
            return null;
        }

        return new OgzTpoIntegration({
            enabled: true,
            mode: flagManager.getSetting('OGZ_TPO', 'mode', 'standard'),
            dynamicSL: flagManager.getSetting('OGZ_TPO', 'dynamicSL', true),
            confluence: flagManager.getSetting('OGZ_TPO', 'confluence', false),
            voteWeight: flagManager.getSetting('OGZ_TPO', 'voteWeight', 0.25),
            adaptive: flagManager.getSetting('OGZ_TPO', 'adaptive', false)
        });
    }

    /**
     * Initialize from TierFeatureFlags (legacy - delegates to FeatureFlagManager)
     * @deprecated Use fromFeatureFlags() instead
     * @param {TierFeatureFlags} tierFlags - Feature flags instance (ignored, uses singleton)
     */
    static fromTierFlags(tierFlags) {
        // Delegate to unified FeatureFlagManager
        return OgzTpoIntegration.fromFeatureFlags();
    }
    
    /**
     * Update with new candle data
     * @param {Object} candle - OHLC candle {o, h, l, c, t}
     * @returns {Object} Update result with signals and votes
     */
    update(candle) {
        if (!this.config.enabled || !computeOgzTpo) {
            return { enabled: false };
        }
        
        // Add to history
        this.candleHistory.closes.push(c(candle));
        this.candleHistory.highs.push(h(candle));
        this.candleHistory.lows.push(l(candle));
        this.candleHistory.timestamps.push(t(candle));
        
        // Trim to max history
        if (this.candleHistory.closes.length > this.maxHistory) {
            this.candleHistory.closes.shift();
            this.candleHistory.highs.shift();
            this.candleHistory.lows.shift();
            this.candleHistory.timestamps.shift();
        }
        
        this.stats.totalUpdates++;
        
        // Need minimum data for calculation
        if (this.candleHistory.closes.length < this.config.normLength + 5) {
            return { 
                enabled: true, 
                ready: false, 
                message: `Warming up (${this.candleHistory.closes.length}/${this.config.normLength + 5})` 
            };
        }
        
        // Compute new TPO
        const tpoResult = computeOgzTpo({
            closes: this.candleHistory.closes,
            highs: this.candleHistory.highs,
            lows: this.candleHistory.lows,
            tpoLength: this.config.tpoLength,
            normLength: this.config.normLength,
            volLength: this.config.volLength,
            lagBars: this.config.lagBars
        });
        
        this.lastResult = tpoResult;
        
        const lastIdx = this.candleHistory.closes.length - 1;
        
        // Detect signals from new TPO
        const newSignal = detectTpoCrossover(tpoResult, lastIdx);
        
        // Update existing TPO if available (for A/B)
        let existingSignal = null;
        if (this.existingTpo) {
            const existingResult = this.existingTpo.update(c(candle));
            existingSignal = existingResult.signal;
        }
        
        // Track statistics
        if (newSignal && newSignal.type !== 'INVALID') this.stats.newTpoSignals++;
        if (existingSignal && existingSignal.type !== 'INVALID') this.stats.existingTpoSignals++;
        
        // Confluence check
        let confluenceMatch = false;
        if (newSignal && existingSignal) {
            const newAction = newSignal.action;
            const existingAction = existingSignal.type;
            if (newAction === existingAction) {
                confluenceMatch = true;
                this.stats.confluenceMatches++;
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STRIPPED DOWN: Core TPO crossover detection only
        // All filters commented out - platform handles filtering, not strategy
        // ═══════════════════════════════════════════════════════════════════

        // COMMENTED FILTERS - move to orchestrator if needed later
        // ─────────────────────────────────────────────────────────────────────
        // const modeSettings = this.config.modes[this.config.mode] || this.config.modes.standard;
        // const meetsStrength = newSignal.strength >= modeSettings.minStrength;
        // const meetsZone = !modeSettings.zoneRequired || newSignal.highProbability;
        // const meetsConfluence = !this.config.confluence || confluenceMatch;
        // if (meetsStrength && meetsZone && meetsConfluence) { ... }
        // ─────────────────────────────────────────────────────────────────────

        // Determine final signal - STRIPPED: just pass through crossover detection
        let finalSignal = null;

        if (newSignal && newSignal.type !== 'INVALID') {
            // SIMPLE: If TPO detects a crossover, return it (no filtering)
            finalSignal = {
                ...newSignal,
                source: 'ogzTpo',
                confluenceConfirmed: confluenceMatch,
                mode: this.config.mode,
                price: c(candle),
                timestamp: Date.now()
            };

            // Calculate dynamic levels if enabled (keep - this is data, not filter)
            if (this.config.dynamicSL) {
                const vol = tpoResult.vol[lastIdx];
                const direction = newSignal.action === 'BUY' ? 'LONG' : 'SHORT';
                const levels = calculateDynamicLevels(c(candle), vol, direction);
                finalSignal.levels = levels;
            }

            this.lastSignal = finalSignal;

            // Emit event for decoupled architecture
            this.emit('signal', finalSignal);

            console.log(`\n🎯 OGZ TPO SIGNAL: ${finalSignal.action}`);
            console.log(`   Zone: ${finalSignal.zone}`);
            console.log(`   Strength: ${(finalSignal.strength * 100).toFixed(2)}%`);
            console.log(`   High Probability: ${finalSignal.highProbability ? '⭐ YES' : 'NO'}`);
            console.log(`   Confluence: ${finalSignal.confluenceConfirmed ? '✅ CONFIRMED' : '❌ NEW TPO ONLY'}`);
            if (finalSignal.levels) {
                console.log(`   Dynamic SL: $${finalSignal.levels.stopLoss.toFixed(2)}`);
                console.log(`   Dynamic TP: $${finalSignal.levels.takeProfit.toFixed(2)}`);
            }
        }
        
        return {
            enabled: true,
            ready: true,
            tpo: tpoResult.tpo[lastIdx],
            tpoLag: tpoResult.tpoLag[lastIdx],
            norm: tpoResult.norm[lastIdx],
            vol: tpoResult.vol[lastIdx],
            bands: tpoResult.bands,
            signal: finalSignal,
            newTpoRaw: newSignal,
            existingTpoRaw: existingSignal,
            confluenceMatch,
            stats: this.stats
        };
    }
    
    /**
     * Get votes for the ensemble voting system
     * Compatible with OptimizedIndicators.getAllVotes()
     * @returns {Array} Array of vote objects
     */
    getVotes() {
        if (!this.lastSignal || !this.config.enabled) {
            return [];
        }
        
        const votes = [];
        const modeSettings = this.config.modes[this.config.mode] || this.config.modes.standard;
        const weight = this.config.voteWeight * modeSettings.voteMultiplier;
        
        // Main signal vote
        if (this.lastSignal.action === 'BUY') {
            votes.push({
                tag: `TPO:${this.lastSignal.zone}`,
                vote: 1,
                strength: weight * (this.lastSignal.highProbability ? 1.5 : 1.0)
            });
        } else if (this.lastSignal.action === 'SELL') {
            votes.push({
                tag: `TPO:${this.lastSignal.zone}`,
                vote: -1,
                strength: weight * (this.lastSignal.highProbability ? 1.5 : 1.0)
            });
        }
        
        // Confluence bonus vote
        if (this.lastSignal.confluenceConfirmed) {
            votes.push({
                tag: 'TPO:confluence',
                vote: this.lastSignal.action === 'BUY' ? 1 : -1,
                strength: 0.1 // Bonus for confirmation
            });
        }
        
        return votes;
    }
    
    /**
     * Get TPO state for dashboard/visualization
     * @returns {Object} Current TPO state
     */
    getState() {
        if (!this.lastResult) {
            return { ready: false };
        }
        
        const lastIdx = this.candleHistory.closes.length - 1;
        
        return {
            ready: true,
            enabled: this.config.enabled,
            mode: this.config.mode,
            current: {
                tpo: this.lastResult.tpo[lastIdx],
                tpoLag: this.lastResult.tpoLag[lastIdx],
                norm: this.lastResult.norm[lastIdx],
                vol: this.lastResult.vol[lastIdx]
            },
            bands: this.lastResult.bands,
            lastSignal: this.lastSignal,
            stats: this.stats,
            history: {
                tpo: this.lastResult.tpo.slice(-50),
                tpoLag: this.lastResult.tpoLag.slice(-50)
            }
        };
    }
    
    /**
     * Get dynamic SL/TP levels for current price
     * @param {number} entryPrice - Entry price
     * @param {string} direction - 'LONG' or 'SHORT'
     * @param {number} multiplier - ATR multiplier (default from mode)
     * @returns {Object} Stop loss and take profit levels
     */
    getDynamicLevels(entryPrice, direction, multiplier = null) {
        if (!this.lastResult) {
            return null;
        }
        
        const lastIdx = this.candleHistory.closes.length - 1;
        const vol = this.lastResult.vol[lastIdx];
        
        // Use mode-appropriate multiplier if not specified
        if (!multiplier) {
            switch (this.config.mode) {
                case 'conservative': multiplier = 2.0; break;
                case 'aggressive': multiplier = 1.0; break;
                default: multiplier = 1.5;
            }
        }
        
        return calculateDynamicLevels(entryPrice, vol, direction, multiplier);
    }
    
    /**
     * Reset state (useful for backtesting)
     */
    reset() {
        this.candleHistory = { closes: [], highs: [], lows: [], timestamps: [] };
        this.lastResult = null;
        this.lastSignal = null;
        this.stats = {
            newTpoSignals: 0,
            existingTpoSignals: 0,
            confluenceMatches: 0,
            totalUpdates: 0
        };
        
        if (this.existingTpo) {
            // Reset existing TPO state
            this.existingTpo.oscillatorHistory = [];
            this.existingTpo.filteredHistory = [];
            this.existingTpo.priceHistory = [];
            this.existingTpo.smooth1 = null;
            this.existingTpo.smooth2 = null;
        }
        
        console.log('🔄 OgzTpoIntegration reset');
    }
    
    /**
     * Get configuration summary
     */
    getConfigSummary() {
        return {
            enabled: this.config.enabled,
            mode: this.config.mode,
            dynamicSL: this.config.dynamicSL,
            confluence: this.config.confluence,
            voteWeight: this.config.voteWeight,
            parameters: {
                tpoLength: this.config.tpoLength,
                normLength: this.config.normLength,
                volLength: this.config.volLength,
                lagBars: this.config.lagBars
            }
        };
    }
}

module.exports = OgzTpoIntegration;

// Export static factories
module.exports.fromFeatureFlags = OgzTpoIntegration.fromFeatureFlags;
module.exports.fromTierFlags = OgzTpoIntegration.fromTierFlags; // Legacy
