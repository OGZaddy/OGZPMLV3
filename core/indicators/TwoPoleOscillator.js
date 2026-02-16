/**
 * OGZ NATIVE TWO-POLE OSCILLATOR - Empire V2 Clean Version
 * =========================================================
 * Pure function implementation for Empire V2 IndicatorEngine integration
 *
 * This is the authoritative two-pole oscillator implementation.
 * Separation of concerns:
 * - This module: Computes oscillator values and crossover signals
 * - RiskManager: Handles stop loss and take profit levels
 *
 * @author OGZPrime Team
 * @version 2.0.0 - Empire V2
 */

// FIX 2026-02-16: Use centralized candle helper for format compatibility
const { c: _c, h: _h, l: _l } = require('../CandleHelper');

// ============================================================================
// HELPER FUNCTIONS (Pure, no side effects)
// ============================================================================

/**
 * Simple Moving Average
 * @param {number[]} values - Array of values
 * @param {number} period - Lookback period
 * @param {number} endIndex - Calculate SMA ending at this index
 * @returns {number} SMA value
 */
function sma(values, period, endIndex) {
    if (endIndex < period - 1) {
        // Not enough data, return the average of what we have
        const available = values.slice(0, endIndex + 1);
        return available.reduce((sum, v) => sum + v, 0) / available.length;
    }

    let sum = 0;
    for (let i = endIndex - period + 1; i <= endIndex; i++) {
        sum += values[i];
    }
    return sum / period;
}

/**
 * Standard Deviation
 * @param {number[]} values - Array of values
 * @param {number} period - Lookback period
 * @param {number} endIndex - Calculate StdDev ending at this index
 * @returns {number} Standard deviation
 */
function stdDev(values, period, endIndex) {
    if (endIndex < period - 1) {
        // Not enough data
        const available = values.slice(0, endIndex + 1);
        if (available.length < 2) return 0;

        const mean = available.reduce((sum, v) => sum + v, 0) / available.length;
        const squaredDiffs = available.map(v => Math.pow(v - mean, 2));
        const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / available.length;
        return Math.sqrt(variance);
    }

    const mean = sma(values, period, endIndex);
    let sumSquaredDiff = 0;

    for (let i = endIndex - period + 1; i <= endIndex; i++) {
        sumSquaredDiff += Math.pow(values[i] - mean, 2);
    }

    return Math.sqrt(sumSquaredDiff / period);
}

/**
 * True Range calculation for a single bar
 * @param {number} high - Current high
 * @param {number} low - Current low
 * @param {number} prevClose - Previous close
 * @returns {number} True range value
 */
function trueRange(high, low, prevClose) {
    return Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
    );
}

// ============================================================================
// MAIN TWO-POLE OSCILLATOR CLASS
// ============================================================================

class TwoPoleOscillator {
    constructor(config = {}) {
        // Configuration with defaults
        this.tpoLength = config.tpoLength || 20;
        this.normLength = config.normLength || 25;
        this.volLength = config.volLength || 20;
        this.lagBars = config.lagBars || 4;

        // Internal state arrays
        this.closes = [];
        this.highs = [];
        this.lows = [];

        // Computed values
        this.tpo = [];
        this.tpoLag = [];
        this.norm = [];
        this.vol = [];

        // Reference bands (static)
        this.bands = {
            upperExtreme: 1,
            upperZone: 0.5,
            mid: 0,
            lowerZone: -0.5,
            lowerExtreme: -1
        };

        // Latest signal (if any)
        this.latestSignal = null;
    }

    /**
     * Update oscillator with new candle close
     * Call this on candle close only
     *
     * @param {Object} candle - Candle data with { h, l, c } properties
     */
    update(candle) {
        const closeVal = _c(candle);
        if (!candle || typeof closeVal !== 'number') return;

        // Add new data
        this.closes.push(closeVal);
        this.highs.push(_h(candle) || closeVal);
        this.lows.push(_l(candle) || closeVal);

        const len = this.closes.length;
        const index = len - 1;

        // ====================================================================
        // STEP 1: Calculate Normalized Price Signal
        // ====================================================================
        const dev = [];
        for (let i = 0; i < len; i++) {
            const closeSma = sma(this.closes, this.normLength, i);
            dev.push(this.closes[i] - closeSma);
        }

        // Normalize the current deviation
        const devSma = sma(dev, this.normLength, index);
        const devCentered = dev[index] - devSma;
        const stdevDev = stdDev(dev, this.normLength, index);
        const normValue = stdevDev > 0 ? devCentered / stdevDev : 0;

        if (this.norm.length < len) {
            this.norm.push(normValue);
        } else {
            this.norm[index] = normValue;
        }

        // ====================================================================
        // STEP 2: Two-Pole Smoothing Filter
        // ====================================================================
        const alpha = 2 / (this.tpoLength + 1);

        if (index === 0) {
            // Initialize
            this.tpo.push(normValue);
            this.tpoLag.push(normValue);
        } else {
            // Calculate s1 and s2 for two-pole filter
            const prevIndex = index - 1;

            // For s1: Use previous s1 if we can calculate it
            let s1_prev = this.norm[prevIndex]; // fallback
            if (prevIndex > 0) {
                // Reconstruct previous s1 from previous tpo calculation
                s1_prev = this.norm[prevIndex];
                for (let j = prevIndex - 1; j >= 0 && j > prevIndex - 5; j--) {
                    s1_prev = (1 - alpha) * s1_prev + alpha * this.norm[j];
                }
            }

            const s1 = (1 - alpha) * s1_prev + alpha * normValue;

            // For s2: Use previous tpo value
            const s2_prev = this.tpo[prevIndex] || normValue;
            const s2 = (1 - alpha) * s2_prev + alpha * s1;

            if (this.tpo.length < len) {
                this.tpo.push(s2);
            } else {
                this.tpo[index] = s2;
            }

            // Calculate lagged value
            const laggedValue = index >= this.lagBars ?
                this.tpo[index - this.lagBars] : this.tpo[0];

            if (this.tpoLag.length < len) {
                this.tpoLag.push(laggedValue);
            } else {
                this.tpoLag[index] = laggedValue;
            }
        }

        // ====================================================================
        // STEP 3: Volatility (ATR)
        // ====================================================================
        const prevClose = index > 0 ? this.closes[index - 1] : this.closes[0];
        const tr = trueRange(
            this.highs[index],
            this.lows[index],
            prevClose
        );

        // Calculate ATR as SMA of true range
        const trValues = [];
        for (let i = 0; i <= index; i++) {
            const pc = i > 0 ? this.closes[i - 1] : this.closes[0];
            trValues.push(trueRange(this.highs[i], this.lows[i], pc));
        }
        const atr = sma(trValues, this.volLength, index);

        if (this.vol.length < len) {
            this.vol.push(atr);
        } else {
            this.vol[index] = atr;
        }

        // ====================================================================
        // STEP 4: Detect Crossover Signal
        // ====================================================================
        this.latestSignal = this._detectCrossover(index);
    }

    /**
     * Detect crossover signals
     * @private
     */
    _detectCrossover(index) {
        if (index < 1) return null;

        const prevTpo = this.tpo[index - 1];
        const currTpo = this.tpo[index];
        const prevLag = this.tpoLag[index - 1];
        const currLag = this.tpoLag[index];

        // Bullish crossover: TPO crosses above TPO_LAG
        if (prevTpo <= prevLag && currTpo > currLag) {
            const inOversold = currTpo <= this.bands.lowerZone;
            const inExtremeOversold = currTpo <= this.bands.lowerExtreme;

            return {
                type: 'BULLISH_CROSS',
                action: 'BUY',
                tpo: currTpo,
                tpoLag: currLag,
                zone: inExtremeOversold ? 'extreme_oversold' : (inOversold ? 'oversold' : 'neutral'),
                strength: Math.abs(currTpo - currLag),
                highProbability: inOversold,
                timestamp: Date.now(),
                index: index
            };
        }

        // Bearish crossover: TPO crosses below TPO_LAG
        if (prevTpo >= prevLag && currTpo < currLag) {
            const inOverbought = currTpo >= this.bands.upperZone;
            const inExtremeOverbought = currTpo >= this.bands.upperExtreme;

            return {
                type: 'BEARISH_CROSS',
                action: 'SELL',
                tpo: currTpo,
                tpoLag: currLag,
                zone: inExtremeOverbought ? 'extreme_overbought' : (inOverbought ? 'overbought' : 'neutral'),
                strength: Math.abs(currTpo - currLag),
                highProbability: inOverbought,
                timestamp: Date.now(),
                index: index
            };
        }

        return null;
    }

    /**
     * Get current oscillator values
     * @returns {Object} Current state
     */
    getValues() {
        const lastIndex = this.tpo.length - 1;
        if (lastIndex < 0) {
            return {
                tpo: 0,
                tpoLag: 0,
                norm: 0,
                vol: 0,
                signal: null,
                bands: this.bands
            };
        }

        return {
            tpo: this.tpo[lastIndex],
            tpoLag: this.tpoLag[lastIndex],
            norm: this.norm[lastIndex],
            vol: this.vol[lastIndex],
            signal: this.latestSignal,
            bands: this.bands
        };
    }

    /**
     * Get render-ready data for charts
     * @param {number} maxPoints - Maximum points to return
     * @returns {Object} Chart-ready data
     */
    getRenderData(maxPoints = 200) {
        const startIdx = Math.max(0, this.tpo.length - maxPoints);

        return {
            tpo: this.tpo.slice(startIdx),
            tpoLag: this.tpoLag.slice(startIdx),
            norm: this.norm.slice(startIdx),
            vol: this.vol.slice(startIdx),
            bands: this.bands,
            signal: this.latestSignal,
            length: this.tpo.length - startIdx
        };
    }

    /**
     * Reset the oscillator state
     */
    reset() {
        this.closes = [];
        this.highs = [];
        this.lows = [];
        this.tpo = [];
        this.tpoLag = [];
        this.norm = [];
        this.vol = [];
        this.latestSignal = null;
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = TwoPoleOscillator;

// Also support ES6 imports
module.exports.default = TwoPoleOscillator;