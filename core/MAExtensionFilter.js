/**
 * MAExtensionFilter - 20MA Extension + Acceleration + First-Touch Skip
 *
 * Filters mean-reversion signals by tracking how far/fast price moves
 * away from the 20MA. After an "accelerating away" event, the first
 * touch back to the MA is often a fake-out - skip it, take the second.
 *
 * @author OGZPrime
 */

class MAExtensionFilter {
    constructor(config = {}) {
        // Slope thresholds
        this.slopeWindow = config.slopeWindow || 5;           // Bars for slope calc
        this.slopeTh = config.slopeTh || 0.001;               // Trend slope threshold
        this.slope200Th = config.slope200Th || 0.0005;        // Sideways 200MA threshold

        // Extension thresholds (in ATR units)
        this.extTh = config.extTh || 1.5;                     // Extension threshold
        this.accelTh = config.accelTh || 0.2;                 // Acceleration threshold
        this.touchBand = config.touchBand || 0.3;             // Touch band (ATR units)

        // First-touch skip settings
        this.skipTimeout = config.skipTimeout || 20;          // Bars before reset
        this.usePercentBand = config.usePercentBand || false; // Use % instead of ATR
        this.percentBand = config.percentBand || 0.005;       // 0.5% band if no ATR

        // State tracking
        this.state = {
            regime: 'unknown',           // 'trendUp', 'trendDown', 'sideways'
            extension: 0,
            prevExtension: 0,
            accel: 0,
            acceleratingAway: false,
            accelerateDirection: null,   // 'up' or 'down'
            touchCount: 0,
            barsSinceAccelerate: 0,
            skipActive: false
        };

        // Consolidation zone tracking (for trend confirmation)
        this.consolidation = {
            active: false,               // Zone is being tracked
            high: null,                  // Previous high (wick)
            low: null,                   // Previous low (wick)
            crossBar: 0,                 // When MA was crossed
            confirmed: null,             // 'bullish' | 'bearish' | null
            lastCrossDirection: null     // 'above' | 'below'
        };

        // History for slope calculation
        this.sma20History = [];
        this.sma200History = [];
        this.extensionHistory = [];
        this.priceHistory = [];          // For consolidation zone calc

        console.log('📐 MAExtensionFilter initialized');
    }

    /**
     * Calculate slope over N bars
     */
    calcSlope(values, n) {
        if (values.length < n + 1) return 0;

        const recent = values.slice(-n - 1);
        const oldest = recent[0];
        const newest = recent[recent.length - 1];

        if (oldest === 0) return 0;
        return (newest - oldest) / oldest / n;
    }

    /**
     * Detect market regime
     */
    detectRegime(close, sma20, sma200) {
        const slope20 = this.calcSlope(this.sma20History, this.slopeWindow);
        const slope200 = this.calcSlope(this.sma200History, this.slopeWindow);

        // Trend up: positive slope + price above MA
        if (slope20 > this.slopeTh && close > sma20) {
            return 'trendUp';
        }

        // Trend down: negative slope + price below MA
        if (slope20 < -this.slopeTh && close < sma20) {
            return 'trendDown';
        }

        // Sideways: flat 20MA and 200MA
        if (Math.abs(slope20) <= this.slopeTh && Math.abs(slope200) <= this.slope200Th) {
            return 'sideways';
        }

        return 'transition';
    }

    /**
     * Calculate extension from 20MA (in ATR units or %)
     */
    calcExtension(close, sma20, atr) {
        if (this.usePercentBand || !atr || atr === 0) {
            // Use percentage
            return (close - sma20) / close;
        }
        // Use ATR
        return (close - sma20) / atr;
    }

    /**
     * Check if price is touching the 20MA band
     */
    isTouchingMA(close, sma20, atr) {
        const distance = Math.abs(close - sma20);

        if (this.usePercentBand || !atr || atr === 0) {
            return distance / close <= this.percentBand;
        }

        return distance <= this.touchBand * atr;
    }

    /**
     * Main update - call on each candle
     * Returns filter decision for mean-reversion signals
     */
    update(close, sma20, sma200, atr) {
        // Update histories
        this.sma20History.push(sma20);
        this.sma200History.push(sma200);
        if (this.sma20History.length > 50) this.sma20History.shift();
        if (this.sma200History.length > 50) this.sma200History.shift();

        // Calculate extension
        this.state.prevExtension = this.state.extension;
        this.state.extension = this.calcExtension(close, sma20, atr);
        this.state.accel = this.state.extension - this.state.prevExtension;

        this.extensionHistory.push(this.state.extension);
        if (this.extensionHistory.length > 20) this.extensionHistory.shift();

        // Detect regime
        this.state.regime = this.detectRegime(close, sma20, sma200);

        // Check for accelerating away
        const acceleratingUp = this.state.regime === 'trendUp' &&
                               this.state.extension > this.extTh &&
                               this.state.accel > this.accelTh;

        const acceleratingDown = this.state.regime === 'trendDown' &&
                                 this.state.extension < -this.extTh &&
                                 this.state.accel < -this.accelTh;

        // New accelerate event
        if (acceleratingUp && !this.state.acceleratingAway) {
            this.state.acceleratingAway = true;
            this.state.accelerateDirection = 'up';
            this.state.touchCount = 0;
            this.state.barsSinceAccelerate = 0;
            this.state.skipActive = true;
            console.log(`🚀 Accelerating UP - extension: ${this.state.extension.toFixed(2)}, accel: ${this.state.accel.toFixed(3)}`);
        }

        if (acceleratingDown && !this.state.acceleratingAway) {
            this.state.acceleratingAway = true;
            this.state.accelerateDirection = 'down';
            this.state.touchCount = 0;
            this.state.barsSinceAccelerate = 0;
            this.state.skipActive = true;
            console.log(`🚀 Accelerating DOWN - extension: ${this.state.extension.toFixed(2)}, accel: ${this.state.accel.toFixed(3)}`);
        }

        // Track bars since accelerate event
        if (this.state.skipActive) {
            this.state.barsSinceAccelerate++;

            // Timeout reset
            if (this.state.barsSinceAccelerate >= this.skipTimeout) {
                this.resetSkip('timeout');
            }
        }

        // Check for MA touch
        const touching = this.isTouchingMA(close, sma20, atr);

        if (touching && this.state.skipActive) {
            this.state.touchCount++;
            console.log(`👆 MA Touch #${this.state.touchCount} (skip: ${this.state.touchCount === 1 ? 'YES' : 'NO'})`);

            if (this.state.touchCount >= 2) {
                this.resetSkip('second_touch');
            }
        }

        // Reset accelerating state when price returns to MA
        if (touching && !this.state.skipActive) {
            this.state.acceleratingAway = false;
            this.state.accelerateDirection = null;
        }

        return this.getFilterResult(close, sma20, touching);
    }

    /**
     * Reset skip state
     */
    resetSkip(reason) {
        console.log(`📐 Skip reset: ${reason}`);
        this.state.skipActive = false;
        this.state.touchCount = 0;
        this.state.barsSinceAccelerate = 0;
    }

    /**
     * Get filter result for signal decisions
     */
    getFilterResult(close, sma20, touching) {
        const shouldSkip = this.state.skipActive && this.state.touchCount <= 1;

        return {
            regime: this.state.regime,
            extension: this.state.extension,
            accel: this.state.accel,
            acceleratingAway: this.state.acceleratingAway,
            accelerateDirection: this.state.accelerateDirection,
            touching: touching,
            touchCount: this.state.touchCount,
            skipActive: this.state.skipActive,
            shouldSkipSignal: shouldSkip,
            barsSinceAccelerate: this.state.barsSinceAccelerate,

            // Signal guidance
            allowLong: !shouldSkip || this.state.accelerateDirection !== 'down',
            allowShort: !shouldSkip || this.state.accelerateDirection !== 'up',

            // Debug
            priceVsMA: close > sma20 ? 'above' : 'below'
        };
    }

    /**
     * Check if a mean-reversion LONG signal should be taken
     * Checks: 1) First-touch skip  2) Trend confirmation (HH breakout)
     */
    shouldTakeLong(close, sma20, atr) {
        const result = this.getFilterResult(close, sma20, this.isTouchingMA(close, sma20, atr));

        // Skip first touch after accelerating down
        if (result.skipActive && result.accelerateDirection === 'down' && result.touchCount <= 1) {
            return { take: false, reason: 'first_touch_skip' };
        }

        // Check trend confirmation (HH breakout)
        const trendCheck = this.isTrendConfirmedLong();
        if (!trendCheck.confirmed) {
            return { take: false, reason: trendCheck.reason };
        }

        return { take: true, reason: trendCheck.reason };
    }

    /**
     * Check if a mean-reversion SHORT signal should be taken
     * Checks: 1) First-touch skip  2) Trend confirmation (LL breakout)
     */
    shouldTakeShort(close, sma20, atr) {
        const result = this.getFilterResult(close, sma20, this.isTouchingMA(close, sma20, atr));

        // Skip first touch after accelerating up
        if (result.skipActive && result.accelerateDirection === 'up' && result.touchCount <= 1) {
            return { take: false, reason: 'first_touch_skip' };
        }

        // Check trend confirmation (LL breakout)
        const trendCheck = this.isTrendConfirmedShort();
        if (!trendCheck.confirmed) {
            return { take: false, reason: trendCheck.reason };
        }

        return { take: true, reason: trendCheck.reason };
    }

    /**
     * Capture consolidation zone when MA is crossed
     * Uses WICKS (h/l) not bodies (c) per user spec
     */
    captureConsolidationZone(lookback = 10) {
        if (this.priceHistory.length < lookback) return;

        const recent = this.priceHistory.slice(-lookback);
        // Use highest wick and lowest wick
        this.consolidation.high = Math.max(...recent.map(c => _h(c)));
        this.consolidation.low = Math.min(...recent.map(c => _l(c)));
        this.consolidation.active = true;
        this.consolidation.confirmed = null;
        this.consolidation.crossBar = 0;

        console.log(`📊 Consolidation zone set: ${this.consolidation.low.toFixed(0)} - ${this.consolidation.high.toFixed(0)}`);
    }

    /**
     * Check for breakout from consolidation zone
     * Break above high → bullish confirmed (HH)
     * Break below low → bearish confirmed (LL)
     */
    checkZoneBreakout(candle) {
        if (!this.consolidation.active) return null;

        // Use wicks for breakout confirmation
        if (_h(candle) > this.consolidation.high) {
            this.consolidation.confirmed = 'bullish';
            // Adjust high to new wick (per user spec)
            this.consolidation.high = _h(candle);
            console.log(`🔺 BULLISH CONFIRMED: Break above ${this.consolidation.high.toFixed(0)}`);
            return 'bullish';
        }

        if (_l(candle) < this.consolidation.low) {
            this.consolidation.confirmed = 'bearish';
            // Adjust low to new wick
            this.consolidation.low = _l(candle);
            console.log(`🔻 BEARISH CONFIRMED: Break below ${this.consolidation.low.toFixed(0)}`);
            return 'bearish';
        }

        this.consolidation.crossBar++;
        return null;
    }

    /**
     * Update with full candle (for consolidation zone tracking)
     */
    updateWithCandle(candle, sma20, sma200, atr) {
        // Track price history for consolidation
        this.priceHistory.push(candle);
        if (this.priceHistory.length > 50) this.priceHistory.shift();

        const close = _c(candle);
        const prevCandle = this.priceHistory.length > 1 ? this.priceHistory[this.priceHistory.length - 2] : null;

        // Detect MA cross
        if (prevCandle && sma20) {
            const wasAbove = _c(prevCandle) > sma20;
            const nowAbove = close > sma20;

            if (wasAbove !== nowAbove) {
                // MA crossed - capture consolidation zone
                this.consolidation.lastCrossDirection = nowAbove ? 'above' : 'below';
                this.captureConsolidationZone(10);
            }
        }

        // Check for breakout if zone is active
        if (this.consolidation.active) {
            this.checkZoneBreakout(candle);
        }

        // Run base update
        return this.update(close, sma20, sma200, atr);
    }

    /**
     * Check if trend is confirmed for LONG entry
     * Needs: bullish breakout (HH) OR no active zone
     */
    isTrendConfirmedLong() {
        if (!this.consolidation.active) return { confirmed: true, reason: 'no_zone' };
        if (this.consolidation.confirmed === 'bullish') return { confirmed: true, reason: 'bullish_breakout' };
        return { confirmed: false, reason: 'awaiting_breakout' };
    }

    /**
     * Check if trend is confirmed for SHORT entry
     * Needs: bearish breakout (LL) OR no active zone
     */
    isTrendConfirmedShort() {
        if (!this.consolidation.active) return { confirmed: true, reason: 'no_zone' };
        if (this.consolidation.confirmed === 'bearish') return { confirmed: true, reason: 'bearish_breakout' };
        return { confirmed: false, reason: 'awaiting_breakout' };
    }

    /**
     * Get current state for debugging/telemetry
     */
    getState() {
        return { ...this.state, consolidation: { ...this.consolidation } };
    }

    /**
     * Reset all state
     */
    reset() {
        this.state = {
            regime: 'unknown',
            extension: 0,
            prevExtension: 0,
            accel: 0,
            acceleratingAway: false,
            accelerateDirection: null,
            touchCount: 0,
            barsSinceAccelerate: 0,
            skipActive: false
        };
        this.consolidation = {
            active: false,
            high: null,
            low: null,
            crossBar: 0,
            confirmed: null,
            lastCrossDirection: null
        };
        this.sma20History = [];
        this.sma200History = [];
        this.extensionHistory = [];
        this.priceHistory = [];
        console.log('📐 MAExtensionFilter reset');
    }
}

module.exports = MAExtensionFilter;
