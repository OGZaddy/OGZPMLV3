/**
 * @fileoverview TradeIntelligenceEngine - Intelligent Trade Management System
 *
 * Decision tree-based trade evaluation that treats each position as unique.
 * Evaluates trades across multiple dimensions to determine optimal action.
 *
 * @description
 * PHILOSOPHY:
 * Every trade is different. A winning trade in a strong trend should ride.
 * A losing trade with broken thesis should cut. No blanket rules - each
 * position evaluated on its own merit through intelligent decision trees.
 *
 * EVALUATION DIMENSIONS:
 * 1. Market Regime - trend strength, volatility, session
 * 2. Momentum Health - RSI divergence, MACD state, volume confirmation
 * 3. Structure & Levels - Fib, S/R, pivots, psychological levels
 * 4. Candle Forensics - patterns, wicks, manipulation detection
 * 5. Sentiment - Fear/Greed, funding rates, social
 * 6. Trade Context - entry conditions vs current, time in trade
 * 7. Risk State - drawdown, consecutive losses, portfolio heat
 * 8. Volume Analysis - volume profile, accumulation/distribution, climax
 * 9. TRAI/NLP Analysis - AI sentiment on current market conditions
 * 10. Whale Activity - large order detection, smart money flow
 * 11. Pattern Bank - historical pattern performance, similar setups
 * 12. Trade History - how similar trades performed, win rate by setup
 * 13. Bot Confidence - the bot's own confidence score for this trade
 *
 * OUTPUT ACTIONS:
 * - HOLD_STRONG, HOLD_CAUTIOUS
 * - SCALE_IN, SCALE_OUT
 * - TRAIL_TIGHT, TRAIL_LOOSE
 * - MOVE_TO_BREAKEVEN
 * - EXIT_PROFIT, EXIT_LOSS
 * - REVERSE
 *
 * @module core/TradeIntelligenceEngine
 * @author OGZPrime Team
 * @version 1.0.0
 */

const EventEmitter = require('events');

// FIX 2026-02-16: Use centralized candle helper for format compatibility
const { c: _c, o: _o, h: _h, l: _l } = require('./CandleHelper');

class TradeIntelligenceEngine extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            // Fibonacci levels
            fibLevels: [0.236, 0.382, 0.5, 0.618, 0.786],
            fibExtensions: [1.0, 1.272, 1.618, 2.0, 2.618],

            // Thresholds
            strongTrendADX: 25,
            volatilityExpansionMultiple: 1.5,
            volumeConfirmationMultiple: 1.3,

            // RSI zones
            rsiOversold: 30,
            rsiOverbought: 70,
            rsiExtremeLow: 20,
            rsiExtremeHigh: 80,

            // Profit/Loss thresholds (%)
            profitTakePartial: 1.5,
            profitTrailTight: 2.5,
            lossWarning: 0.5,
            lossCut: 1.5,

            // Time thresholds (minutes)
            minHoldTime: 2,
            staleTradeTime: 30,

            ...config
        };

        // Cache for calculations
        this.cache = {
            levels: null,
            levelsExpiry: 0,
            regime: null,
            regimeExpiry: 0
        };

        console.log('[TradeIntelligence] Engine initialized');
    }

    // =========================================================================
    // MAIN EVALUATION FUNCTION
    // =========================================================================

    /**
     * Evaluate a trade and return recommended action
     * @param {Object} trade - The active trade
     * @param {Object} marketData - Current market data
     * @param {Object} indicators - Current indicators
     * @param {Object} context - Additional context (portfolio, history)
     * @returns {Object} { action, confidence, reasoning }
     */
    evaluate(trade, marketData, indicators, context = {}) {
        const evaluation = {
            timestamp: Date.now(),
            tradeId: trade.id,
            scores: {},
            signals: [],
            action: 'HOLD_CAUTIOUS',
            confidence: 0.5,
            reasoning: []
        };

        try {
            // Calculate current P&L
            const currentPrice = marketData.price;
            const entryPrice = trade.entryPrice;
            const isLong = trade.direction === 'buy' || trade.action === 'BUY';
            const pnlPercent = isLong
                ? ((currentPrice - entryPrice) / entryPrice) * 100
                : ((entryPrice - currentPrice) / entryPrice) * 100;

            const timeInTrade = (Date.now() - trade.entryTime) / 60000; // minutes

            // Run all evaluation modules
            const regimeScore = this.evaluateMarketRegime(marketData, indicators);
            const momentumScore = this.evaluateMomentumHealth(trade, indicators);
            const structureScore = this.evaluateStructure(currentPrice, marketData, trade);
            const candleScore = this.evaluateCandleForensics(marketData);
            const sentimentScore = this.evaluateSentiment(context);
            const tradeContextScore = this.evaluateTradeContext(trade, indicators, pnlPercent, timeInTrade);
            const riskScore = this.evaluateRiskState(context, pnlPercent);

            // Additional evaluation modules
            const volumeScore = this.evaluateVolumeProfile(marketData, indicators, trade);
            const traiScore = this.evaluateTRAI(context, trade);
            const whaleScore = this.evaluateWhaleActivity(context, trade);
            const patternScore = this.evaluatePatternBank(context, trade);
            const historyScore = this.evaluateTradeHistory(context, trade, indicators);
            const confidenceScore = this.evaluateBotConfidence(trade, context);
            const emaScore = this.evaluateEMABehavior(marketData, indicators, trade);

            // Store scores
            evaluation.scores = {
                regime: regimeScore,
                momentum: momentumScore,
                structure: structureScore,
                candle: candleScore,
                sentiment: sentimentScore,
                tradeContext: tradeContextScore,
                risk: riskScore,
                volume: volumeScore,
                trai: traiScore,
                whale: whaleScore,
                pattern: patternScore,
                history: historyScore,
                botConfidence: confidenceScore,
                ema: emaScore,
                pnlPercent,
                timeInTrade
            };

            // Collect all signals
            evaluation.signals = [
                ...regimeScore.signals,
                ...momentumScore.signals,
                ...structureScore.signals,
                ...candleScore.signals,
                ...tradeContextScore.signals,
                ...riskScore.signals,
                ...volumeScore.signals,
                ...traiScore.signals,
                ...whaleScore.signals,
                ...patternScore.signals,
                ...historyScore.signals,
                ...confidenceScore.signals,
                ...emaScore.signals
            ];

            // Run decision tree
            const decision = this.runDecisionTree(evaluation, isLong, pnlPercent, timeInTrade);

            evaluation.action = decision.action;
            evaluation.confidence = decision.confidence;
            evaluation.reasoning = decision.reasoning;

            this.emit('evaluation', evaluation);

        } catch (error) {
            console.error('[TradeIntelligence] Evaluation error:', error.message);
            evaluation.action = 'HOLD_CAUTIOUS';
            evaluation.reasoning = ['Error in evaluation - defaulting to cautious hold'];
        }

        return evaluation;
    }

    // =========================================================================
    // EVALUATION MODULES
    // =========================================================================

    /**
     * Evaluate market regime
     */
    evaluateMarketRegime(marketData, indicators) {
        const result = { score: 0, signals: [], regime: 'unknown' };

        try {
            // ADX for trend strength (if available)
            const adx = indicators.adx || 20;
            if (adx > this.config.strongTrendADX) {
                result.signals.push({ type: 'STRONG_TREND', value: adx });
                result.regime = 'trending';
                result.score += 20;
            } else {
                result.signals.push({ type: 'WEAK_TREND', value: adx });
                result.regime = 'ranging';
            }

            // Volatility assessment
            const atr = indicators.atr || 0;
            const avgAtr = indicators.avgAtr || atr;
            if (atr > avgAtr * this.config.volatilityExpansionMultiple) {
                result.signals.push({ type: 'VOLATILITY_EXPANSION', value: atr / avgAtr });
                result.score += 10;
            }

            // EMA alignment
            const ema9 = indicators.ema9 || indicators.ema12;
            const ema20 = indicators.ema20 || indicators.ema26;
            const ema50 = indicators.ema50;

            if (ema9 && ema20 && ema50) {
                if (ema9 > ema20 && ema20 > ema50) {
                    result.signals.push({ type: 'BULLISH_ALIGNMENT', detail: '9>20>50' });
                    result.score += 15;
                } else if (ema9 < ema20 && ema20 < ema50) {
                    result.signals.push({ type: 'BEARISH_ALIGNMENT', detail: '9<20<50' });
                    result.score -= 15;
                } else {
                    result.signals.push({ type: 'MIXED_ALIGNMENT' });
                }
            }

            // Volume confirmation
            const volume = marketData.volume || indicators.volume;
            const avgVolume = indicators.avgVolume || volume;
            if (volume && avgVolume && volume > avgVolume * this.config.volumeConfirmationMultiple) {
                result.signals.push({ type: 'HIGH_VOLUME', ratio: volume / avgVolume });
                result.score += 10;
            }

        } catch (error) {
            console.error('[TradeIntelligence] Regime evaluation error:', error.message);
        }

        return result;
    }

    /**
     * Evaluate momentum health
     */
    evaluateMomentumHealth(trade, indicators) {
        const result = { score: 0, signals: [], divergence: false };
        const isLong = trade.direction === 'buy' || trade.action === 'BUY';

        try {
            const rsi = indicators.rsi;
            const macd = indicators.macd;
            const entryRsi = trade.entryIndicators?.rsi;
            const entryMacd = trade.entryIndicators?.macd;

            // RSI analysis
            if (rsi !== undefined) {
                // Overbought/Oversold
                if (rsi > this.config.rsiExtremeHigh) {
                    result.signals.push({ type: 'RSI_EXTREME_HIGH', value: rsi });
                    result.score += isLong ? -20 : 20; // Bad for longs, good for shorts
                } else if (rsi < this.config.rsiExtremeLow) {
                    result.signals.push({ type: 'RSI_EXTREME_LOW', value: rsi });
                    result.score += isLong ? 20 : -20; // Good for longs, bad for shorts
                } else if (rsi > this.config.rsiOverbought) {
                    result.signals.push({ type: 'RSI_OVERBOUGHT', value: rsi });
                    result.score += isLong ? -10 : 10;
                } else if (rsi < this.config.rsiOversold) {
                    result.signals.push({ type: 'RSI_OVERSOLD', value: rsi });
                    result.score += isLong ? 10 : -10;
                }

                // RSI divergence from entry
                if (entryRsi !== undefined) {
                    const rsiChange = rsi - entryRsi;
                    if (isLong && rsiChange < -20) {
                        result.signals.push({ type: 'RSI_DIVERGENCE_BEARISH', change: rsiChange });
                        result.divergence = true;
                        result.score -= 15;
                    } else if (!isLong && rsiChange > 20) {
                        result.signals.push({ type: 'RSI_DIVERGENCE_BULLISH', change: rsiChange });
                        result.divergence = true;
                        result.score -= 15;
                    }
                }
            }

            // MACD analysis
            if (macd && typeof macd === 'object') {
                const histogram = macd.hist || macd.histogram;
                const entryHist = entryMacd?.hist || entryMacd?.histogram;

                if (histogram !== undefined) {
                    // Histogram direction
                    if (histogram > 0 && isLong) {
                        result.signals.push({ type: 'MACD_BULLISH', value: histogram });
                        result.score += 10;
                    } else if (histogram < 0 && !isLong) {
                        result.signals.push({ type: 'MACD_BEARISH', value: histogram });
                        result.score += 10;
                    } else {
                        result.signals.push({ type: 'MACD_AGAINST_POSITION', value: histogram });
                        result.score -= 10;
                    }

                    // Histogram expanding or contracting
                    if (entryHist !== undefined) {
                        const histChange = Math.abs(histogram) - Math.abs(entryHist);
                        if (histChange > 0) {
                            result.signals.push({ type: 'MACD_EXPANDING' });
                            result.score += 5;
                        } else {
                            result.signals.push({ type: 'MACD_CONTRACTING' });
                            result.score -= 5;
                        }
                    }
                }
            }

        } catch (error) {
            console.error('[TradeIntelligence] Momentum evaluation error:', error.message);
        }

        return result;
    }

    /**
     * Evaluate structure and key levels
     */
    evaluateStructure(currentPrice, marketData, trade) {
        const result = { score: 0, signals: [], nearLevel: false, levelType: null };

        try {
            const isLong = trade.direction === 'buy' || trade.action === 'BUY';

            // Calculate Fibonacci levels from recent high/low
            const recentHigh = marketData.high24h || marketData.dayHigh || currentPrice * 1.02;
            const recentLow = marketData.low24h || marketData.dayLow || currentPrice * 0.98;
            const range = recentHigh - recentLow;

            // Check proximity to Fib levels
            for (const fib of this.config.fibLevels) {
                const fibLevel = recentLow + (range * fib);
                const distancePercent = Math.abs(currentPrice - fibLevel) / currentPrice * 100;

                if (distancePercent < 0.3) { // Within 0.3% of fib level
                    result.signals.push({
                        type: 'NEAR_FIB_LEVEL',
                        level: fib,
                        price: fibLevel,
                        distance: distancePercent
                    });
                    result.nearLevel = true;
                    result.levelType = `fib_${fib}`;

                    // Near fib level can mean support or resistance depending on direction
                    if (fib >= 0.5) {
                        // Higher fibs are typically resistance
                        result.score += isLong ? -10 : 10;
                    } else {
                        // Lower fibs are typically support
                        result.score += isLong ? 10 : -10;
                    }
                }
            }

            // Psychological levels (round numbers)
            const roundLevel = Math.round(currentPrice / 1000) * 1000;
            const distanceToRound = Math.abs(currentPrice - roundLevel) / currentPrice * 100;
            if (distanceToRound < 0.5) {
                result.signals.push({
                    type: 'NEAR_PSYCHOLOGICAL_LEVEL',
                    level: roundLevel,
                    distance: distanceToRound
                });
                result.nearLevel = true;
            }

            // Previous day high/low
            if (marketData.prevDayHigh) {
                const distToHigh = Math.abs(currentPrice - marketData.prevDayHigh) / currentPrice * 100;
                if (distToHigh < 0.3) {
                    result.signals.push({ type: 'AT_PREV_DAY_HIGH' });
                    result.score += isLong ? -5 : 5; // Resistance for longs
                }
            }
            if (marketData.prevDayLow) {
                const distToLow = Math.abs(currentPrice - marketData.prevDayLow) / currentPrice * 100;
                if (distToLow < 0.3) {
                    result.signals.push({ type: 'AT_PREV_DAY_LOW' });
                    result.score += isLong ? 5 : -5; // Support for longs
                }
            }

        } catch (error) {
            console.error('[TradeIntelligence] Structure evaluation error:', error.message);
        }

        return result;
    }

    /**
     * Evaluate candle patterns and forensics
     */
    evaluateCandleForensics(marketData) {
        const result = { score: 0, signals: [], manipulation: false };

        try {
            const candle = marketData.currentCandle || marketData;
            if (!candle || !_o(candle) || !_h(candle) || !_l(candle) || !_c(candle)) {
                return result;
            }

            const open = _o(candle);
            const high = _h(candle);
            const low = _l(candle);
            const close = _c(candle);

            const body = Math.abs(close - open);
            const upperWick = high - Math.max(open, close);
            const lowerWick = Math.min(open, close) - low;
            const totalRange = high - low;

            if (totalRange === 0) return result;

            const bodyRatio = body / totalRange;
            const upperWickRatio = upperWick / totalRange;
            const lowerWickRatio = lowerWick / totalRange;

            // Doji - indecision
            if (bodyRatio < 0.1) {
                result.signals.push({ type: 'DOJI', bodyRatio });
                result.score -= 5; // Uncertainty
            }

            // Long upper wick - rejection / manipulation
            if (upperWickRatio > 0.6) {
                result.signals.push({ type: 'LONG_UPPER_WICK', ratio: upperWickRatio });
                result.manipulation = true;
                result.score -= 10; // Bearish signal
            }

            // Long lower wick - support / manipulation
            if (lowerWickRatio > 0.6) {
                result.signals.push({ type: 'LONG_LOWER_WICK', ratio: lowerWickRatio });
                result.manipulation = true;
                result.score += 10; // Bullish signal (bought up)
            }

            // Hammer (bullish reversal)
            if (lowerWickRatio > 0.5 && upperWickRatio < 0.1 && bodyRatio < 0.3) {
                result.signals.push({ type: 'HAMMER' });
                result.score += 15;
            }

            // Shooting star (bearish reversal)
            if (upperWickRatio > 0.5 && lowerWickRatio < 0.1 && bodyRatio < 0.3) {
                result.signals.push({ type: 'SHOOTING_STAR' });
                result.score -= 15;
            }

            // Strong bullish candle
            if (bodyRatio > 0.7 && close > open) {
                result.signals.push({ type: 'STRONG_BULLISH_CANDLE' });
                result.score += 10;
            }

            // Strong bearish candle
            if (bodyRatio > 0.7 && close < open) {
                result.signals.push({ type: 'STRONG_BEARISH_CANDLE' });
                result.score -= 10;
            }

        } catch (error) {
            console.error('[TradeIntelligence] Candle evaluation error:', error.message);
        }

        return result;
    }

    /**
     * Evaluate sentiment
     */
    evaluateSentiment(context) {
        const result = { score: 0, signals: [] };

        try {
            // Fear & Greed
            const fearGreed = context.fearGreedIndex;
            if (fearGreed !== undefined) {
                if (fearGreed < 20) {
                    result.signals.push({ type: 'EXTREME_FEAR', value: fearGreed });
                    result.score += 15; // Contrarian - buy opportunity
                } else if (fearGreed > 80) {
                    result.signals.push({ type: 'EXTREME_GREED', value: fearGreed });
                    result.score -= 15; // Contrarian - caution
                }
            }

            // Funding rate (for perps)
            const fundingRate = context.fundingRate;
            if (fundingRate !== undefined) {
                if (fundingRate > 0.05) {
                    result.signals.push({ type: 'HIGH_FUNDING_LONGS', value: fundingRate });
                    result.score -= 10; // Crowded long trade
                } else if (fundingRate < -0.05) {
                    result.signals.push({ type: 'HIGH_FUNDING_SHORTS', value: fundingRate });
                    result.score += 10; // Crowded short trade
                }
            }

        } catch (error) {
            console.error('[TradeIntelligence] Sentiment evaluation error:', error.message);
        }

        return result;
    }

    /**
     * Evaluate trade-specific context
     */
    evaluateTradeContext(trade, indicators, pnlPercent, timeInTrade) {
        const result = { score: 0, signals: [], thesisBroken: false };
        const isLong = trade.direction === 'buy' || trade.action === 'BUY';

        try {
            // P&L based signals
            if (pnlPercent > this.config.profitTrailTight) {
                result.signals.push({ type: 'STRONG_PROFIT', pnl: pnlPercent });
                result.score += 20;
            } else if (pnlPercent > this.config.profitTakePartial) {
                result.signals.push({ type: 'GOOD_PROFIT', pnl: pnlPercent });
                result.score += 15;
            } else if (pnlPercent > 0.5) {
                result.signals.push({ type: 'SMALL_PROFIT', pnl: pnlPercent });
                result.score += 5;
            } else if (pnlPercent < -this.config.lossCut) {
                result.signals.push({ type: 'SIGNIFICANT_LOSS', pnl: pnlPercent });
                result.score -= 25;
            } else if (pnlPercent < -this.config.lossWarning) {
                result.signals.push({ type: 'LOSS_WARNING', pnl: pnlPercent });
                result.score -= 10;
            }

            // Time in trade
            if (timeInTrade < this.config.minHoldTime) {
                result.signals.push({ type: 'NEW_TRADE', minutes: timeInTrade });
            } else if (timeInTrade > this.config.staleTradeTime && Math.abs(pnlPercent) < 0.5) {
                result.signals.push({ type: 'STALE_TRADE', minutes: timeInTrade });
                result.score -= 10;
            }

            // Check if entry thesis still valid
            const entryRsi = trade.entryIndicators?.rsi;
            const currentRsi = indicators.rsi;
            const entryTrend = trade.entryIndicators?.trend;
            const currentTrend = indicators.trend;

            // RSI thesis check
            if (entryRsi && currentRsi) {
                const rsiAtEntryOversold = entryRsi < this.config.rsiOversold;
                const rsiNowOverbought = currentRsi > this.config.rsiOverbought;

                if (isLong && rsiAtEntryOversold && rsiNowOverbought) {
                    result.signals.push({ type: 'RSI_THESIS_COMPLETE' });
                    result.score += 10; // Good time to exit with profit
                }
            }

            // Trend thesis check
            if (entryTrend && currentTrend && entryTrend !== currentTrend) {
                result.signals.push({
                    type: 'TREND_CHANGED',
                    from: entryTrend,
                    to: currentTrend
                });
                result.thesisBroken = true;
                result.score -= 15;
            }

        } catch (error) {
            console.error('[TradeIntelligence] Trade context evaluation error:', error.message);
        }

        return result;
    }

    /**
     * Evaluate risk state
     */
    evaluateRiskState(context, pnlPercent) {
        const result = { score: 0, signals: [], highRisk: false };

        try {
            // Current drawdown
            const drawdown = context.currentDrawdown || 0;
            if (drawdown > 5) {
                result.signals.push({ type: 'HIGH_DRAWDOWN', value: drawdown });
                result.score -= 20;
                result.highRisk = true;
            } else if (drawdown > 2) {
                result.signals.push({ type: 'MODERATE_DRAWDOWN', value: drawdown });
                result.score -= 10;
            }

            // Consecutive losses
            const consecutiveLosses = context.consecutiveLosses || 0;
            if (consecutiveLosses >= 3) {
                result.signals.push({ type: 'LOSING_STREAK', count: consecutiveLosses });
                result.score -= 15;
                result.highRisk = true;
            }

            // Daily P&L
            const dailyPnL = context.dailyPnL || 0;
            if (dailyPnL < -2) {
                result.signals.push({ type: 'BAD_DAY', pnl: dailyPnL });
                result.score -= 10;
            } else if (dailyPnL > 3) {
                result.signals.push({ type: 'GOOD_DAY', pnl: dailyPnL });
                result.score += 5;
            }

            // Portfolio heat
            const portfolioHeat = context.portfolioHeat || 0;
            if (portfolioHeat > 10) {
                result.signals.push({ type: 'HIGH_EXPOSURE', value: portfolioHeat });
                result.score -= 10;
            }

        } catch (error) {
            console.error('[TradeIntelligence] Risk evaluation error:', error.message);
        }

        return result;
    }

    // =========================================================================
    // ADDITIONAL EVALUATION MODULES
    // =========================================================================

    /**
     * Evaluate volume profile and behavior
     */
    evaluateVolumeProfile(marketData, indicators, trade) {
        const result = { score: 0, signals: [], volumeConfirms: false };
        const isLong = trade.direction === 'buy' || trade.action === 'BUY';

        try {
            const volume = marketData.volume || indicators.volume;
            const avgVolume = indicators.avgVolume || marketData.avgVolume;
            const priceChange = marketData.priceChange || 0;

            if (!volume || !avgVolume) return result;

            const volumeRatio = volume / avgVolume;

            // High volume confirmation
            if (volumeRatio > 2.0) {
                result.signals.push({ type: 'CLIMAX_VOLUME', ratio: volumeRatio });
                // Climax volume can mean exhaustion or breakout
                if (Math.abs(priceChange) > 1) {
                    result.signals.push({ type: 'VOLUME_BREAKOUT' });
                    result.score += 15;
                } else {
                    result.signals.push({ type: 'POSSIBLE_EXHAUSTION' });
                    result.score -= 5;
                }
            } else if (volumeRatio > 1.5) {
                result.signals.push({ type: 'HIGH_VOLUME', ratio: volumeRatio });
                // High volume in direction of trade = good
                if ((isLong && priceChange > 0) || (!isLong && priceChange < 0)) {
                    result.volumeConfirms = true;
                    result.score += 10;
                } else {
                    result.score -= 10;
                }
            } else if (volumeRatio < 0.5) {
                result.signals.push({ type: 'LOW_VOLUME', ratio: volumeRatio });
                // Low volume moves are suspect
                result.score -= 5;
            }

            // Accumulation vs Distribution
            const obv = indicators.obv;
            const prevObv = indicators.prevObv;
            if (obv !== undefined && prevObv !== undefined) {
                if (obv > prevObv && isLong) {
                    result.signals.push({ type: 'ACCUMULATION' });
                    result.score += 10;
                } else if (obv < prevObv && !isLong) {
                    result.signals.push({ type: 'DISTRIBUTION' });
                    result.score += 10;
                } else if ((obv > prevObv && !isLong) || (obv < prevObv && isLong)) {
                    result.signals.push({ type: 'VOLUME_DIVERGENCE' });
                    result.score -= 15;
                }
            }

        } catch (error) {
            console.error('[TradeIntelligence] Volume evaluation error:', error.message);
        }

        return result;
    }

    /**
     * Evaluate TRAI/NLP AI analysis
     */
    evaluateTRAI(context, trade) {
        const result = { score: 0, signals: [], traiRecommendation: null };
        const isLong = trade.direction === 'buy' || trade.action === 'BUY';

        try {
            const traiAnalysis = context.traiAnalysis;
            if (!traiAnalysis) return result;

            result.traiRecommendation = traiAnalysis.recommendation;

            // TRAI sentiment alignment
            if (traiAnalysis.sentiment === 'bullish' && isLong) {
                result.signals.push({ type: 'TRAI_CONFIRMS_LONG' });
                result.score += 15;
            } else if (traiAnalysis.sentiment === 'bearish' && !isLong) {
                result.signals.push({ type: 'TRAI_CONFIRMS_SHORT' });
                result.score += 15;
            } else if (traiAnalysis.sentiment === 'bullish' && !isLong) {
                result.signals.push({ type: 'TRAI_AGAINST_SHORT' });
                result.score -= 15;
            } else if (traiAnalysis.sentiment === 'bearish' && isLong) {
                result.signals.push({ type: 'TRAI_AGAINST_LONG' });
                result.score -= 15;
            }

            // TRAI confidence level
            if (traiAnalysis.confidence > 0.8) {
                result.signals.push({ type: 'TRAI_HIGH_CONFIDENCE', value: traiAnalysis.confidence });
                result.score += result.score > 0 ? 10 : -10; // Amplify
            }

            // TRAI detected patterns or events
            if (traiAnalysis.detectedEvents?.length > 0) {
                for (const event of traiAnalysis.detectedEvents) {
                    result.signals.push({ type: 'TRAI_EVENT', event });
                    if (event.includes('reversal') || event.includes('warning')) {
                        result.score -= 10;
                    }
                }
            }

        } catch (error) {
            console.error('[TradeIntelligence] TRAI evaluation error:', error.message);
        }

        return result;
    }

    /**
     * Evaluate whale activity and smart money flow
     */
    evaluateWhaleActivity(context, trade) {
        const result = { score: 0, signals: [], whaleAlert: false };
        const isLong = trade.direction === 'buy' || trade.action === 'BUY';

        try {
            const whaleData = context.whaleActivity;
            if (!whaleData) return result;

            // Large buy orders
            if (whaleData.largeBuys > whaleData.largeSells * 1.5) {
                result.signals.push({ type: 'WHALE_ACCUMULATING' });
                result.score += isLong ? 20 : -15;
                result.whaleAlert = true;
            }

            // Large sell orders
            if (whaleData.largeSells > whaleData.largeBuys * 1.5) {
                result.signals.push({ type: 'WHALE_DISTRIBUTING' });
                result.score += isLong ? -20 : 15;
                result.whaleAlert = true;
            }

            // Exchange inflows (bearish - selling pressure coming)
            if (whaleData.exchangeInflow > whaleData.avgInflow * 2) {
                result.signals.push({ type: 'HIGH_EXCHANGE_INFLOW' });
                result.score -= 15;
            }

            // Exchange outflows (bullish - accumulation)
            if (whaleData.exchangeOutflow > whaleData.avgOutflow * 2) {
                result.signals.push({ type: 'HIGH_EXCHANGE_OUTFLOW' });
                result.score += 15;
            }

            // Smart money indicator
            if (whaleData.smartMoneyFlow !== undefined) {
                if (whaleData.smartMoneyFlow > 0 && isLong) {
                    result.signals.push({ type: 'SMART_MONEY_BULLISH' });
                    result.score += 10;
                } else if (whaleData.smartMoneyFlow < 0 && !isLong) {
                    result.signals.push({ type: 'SMART_MONEY_BEARISH' });
                    result.score += 10;
                }
            }

        } catch (error) {
            console.error('[TradeIntelligence] Whale evaluation error:', error.message);
        }

        return result;
    }

    /**
     * Evaluate pattern bank historical performance
     */
    evaluatePatternBank(context, trade) {
        const result = { score: 0, signals: [], patternMatch: null };

        try {
            const patternData = context.patternBank;
            const tradePatterns = trade.patterns || [];

            if (!patternData || tradePatterns.length === 0) return result;

            for (const pattern of tradePatterns) {
                const signature = pattern.signature;
                const historicalPerf = patternData.getPerformance?.(signature);

                if (historicalPerf) {
                    result.patternMatch = {
                        signature,
                        winRate: historicalPerf.winRate,
                        avgReturn: historicalPerf.avgReturn,
                        occurrences: historicalPerf.occurrences
                    };

                    // High win rate pattern
                    if (historicalPerf.occurrences >= 10) {
                        if (historicalPerf.winRate > 0.65) {
                            result.signals.push({
                                type: 'HIGH_WIN_PATTERN',
                                winRate: historicalPerf.winRate,
                                occurrences: historicalPerf.occurrences
                            });
                            result.score += 20;
                        } else if (historicalPerf.winRate < 0.35) {
                            result.signals.push({
                                type: 'LOW_WIN_PATTERN',
                                winRate: historicalPerf.winRate
                            });
                            result.score -= 20;
                        }
                    }

                    // Average return
                    if (historicalPerf.avgReturn > 1) {
                        result.signals.push({ type: 'POSITIVE_EXPECTANCY', avgReturn: historicalPerf.avgReturn });
                        result.score += 10;
                    } else if (historicalPerf.avgReturn < -0.5) {
                        result.signals.push({ type: 'NEGATIVE_EXPECTANCY', avgReturn: historicalPerf.avgReturn });
                        result.score -= 15;
                    }
                }
            }

        } catch (error) {
            console.error('[TradeIntelligence] Pattern bank evaluation error:', error.message);
        }

        return result;
    }

    /**
     * Evaluate trade history for similar setups
     */
    evaluateTradeHistory(context, trade, indicators) {
        const result = { score: 0, signals: [], similarTrades: [] };

        try {
            const tradeHistory = context.tradeHistory;
            if (!tradeHistory || tradeHistory.length === 0) return result;

            // Find similar trades (same direction, similar RSI, similar trend)
            const currentRsi = indicators.rsi;
            const currentTrend = indicators.trend;
            const isLong = trade.direction === 'buy' || trade.action === 'BUY';

            const similarTrades = tradeHistory.filter(t => {
                const sameDirection = (t.direction === 'buy') === isLong;
                const similarRsi = t.entryIndicators?.rsi != null && Math.abs(t.entryIndicators.rsi - currentRsi) < 10;
                const sameTrend = t.entryIndicators?.trend === currentTrend;
                return sameDirection && (similarRsi || sameTrend);
            }).slice(-20); // Last 20 similar trades

            if (similarTrades.length >= 5) {
                const wins = similarTrades.filter(t => t.pnl > 0).length;
                const winRate = wins / similarTrades.length;
                const avgPnl = similarTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / similarTrades.length;

                result.similarTrades = similarTrades;

                if (winRate > 0.6) {
                    result.signals.push({ type: 'SIMILAR_TRADES_WINNING', winRate, count: similarTrades.length });
                    result.score += 15;
                } else if (winRate < 0.4) {
                    result.signals.push({ type: 'SIMILAR_TRADES_LOSING', winRate, count: similarTrades.length });
                    result.score -= 15;
                }

                if (avgPnl > 0.5) {
                    result.signals.push({ type: 'SIMILAR_TRADES_PROFITABLE', avgPnl });
                    result.score += 10;
                } else if (avgPnl < -0.5) {
                    result.signals.push({ type: 'SIMILAR_TRADES_UNPROFITABLE', avgPnl });
                    result.score -= 10;
                }
            }

        } catch (error) {
            console.error('[TradeIntelligence] Trade history evaluation error:', error.message);
        }

        return result;
    }

    /**
     * Evaluate the bot's own confidence score
     */
    evaluateBotConfidence(trade, context) {
        const result = { score: 0, signals: [] };

        try {
            const entryConfidence = trade.confidence;
            const currentBotConfidence = context.currentConfidence;

            // Entry confidence
            if (entryConfidence !== undefined) {
                if (entryConfidence > 0.8) {
                    result.signals.push({ type: 'HIGH_ENTRY_CONFIDENCE', value: entryConfidence });
                    result.score += 10;
                } else if (entryConfidence < 0.5) {
                    result.signals.push({ type: 'LOW_ENTRY_CONFIDENCE', value: entryConfidence });
                    result.score -= 10;
                }
            }

            // Current confidence vs entry
            if (currentBotConfidence !== undefined && entryConfidence !== undefined) {
                const confidenceChange = currentBotConfidence - entryConfidence;
                if (confidenceChange > 0.2) {
                    result.signals.push({ type: 'CONFIDENCE_INCREASING', change: confidenceChange });
                    result.score += 10;
                } else if (confidenceChange < -0.2) {
                    result.signals.push({ type: 'CONFIDENCE_DECREASING', change: confidenceChange });
                    result.score -= 15;
                }
            }

        } catch (error) {
            console.error('[TradeIntelligence] Bot confidence evaluation error:', error.message);
        }

        return result;
    }

    /**
     * Evaluate EMA/SMA relationship and price behavior
     */
    evaluateEMABehavior(marketData, indicators, trade) {
        const result = { score: 0, signals: [], emaStatus: null };
        const isLong = trade.direction === 'buy' || trade.action === 'BUY';
        const price = marketData.price;

        try {
            const ema9 = indicators.ema9 || indicators.ema12;
            const ema20 = indicators.ema20 || indicators.ema26;
            const ema50 = indicators.ema50;
            const sma200 = indicators.sma200;

            // Price vs EMAs
            if (ema9 && ema20) {
                const priceAboveEma9 = price > ema9;
                const priceAboveEma20 = price > ema20;
                const ema9AboveEma20 = ema9 > ema20;

                // Bullish alignment for longs
                if (isLong) {
                    if (priceAboveEma9 && priceAboveEma20 && ema9AboveEma20) {
                        result.signals.push({ type: 'BULLISH_EMA_STACK' });
                        result.emaStatus = 'bullish_aligned';
                        result.score += 20;
                    } else if (!priceAboveEma9 && !priceAboveEma20) {
                        result.signals.push({ type: 'PRICE_BELOW_EMAS' });
                        result.emaStatus = 'bearish';
                        result.score -= 20;
                    } else if (priceAboveEma20 && !priceAboveEma9) {
                        result.signals.push({ type: 'PRICE_TESTING_EMA9' });
                        result.emaStatus = 'testing_support';
                        result.score -= 5;
                    }
                } else {
                    // Bearish alignment for shorts
                    if (!priceAboveEma9 && !priceAboveEma20 && !ema9AboveEma20) {
                        result.signals.push({ type: 'BEARISH_EMA_STACK' });
                        result.emaStatus = 'bearish_aligned';
                        result.score += 20;
                    } else if (priceAboveEma9 && priceAboveEma20) {
                        result.signals.push({ type: 'PRICE_ABOVE_EMAS' });
                        result.emaStatus = 'bullish';
                        result.score -= 20;
                    }
                }

                // EMA convergence/divergence
                const emaSpread = Math.abs(ema9 - ema20) / ema20 * 100;
                if (emaSpread < 0.1) {
                    result.signals.push({ type: 'EMA_SQUEEZE', spread: emaSpread });
                    // Squeeze often precedes big move
                } else if (emaSpread > 1) {
                    result.signals.push({ type: 'EMA_WIDE_SPREAD', spread: emaSpread });
                }
            }

            // SMA 200 - major support/resistance
            if (sma200) {
                const distanceFromSma200 = ((price - sma200) / sma200) * 100;
                if (Math.abs(distanceFromSma200) < 1) {
                    result.signals.push({ type: 'NEAR_SMA200', distance: distanceFromSma200 });
                    // Major level - be careful
                }
                if (price > sma200 && isLong) {
                    result.signals.push({ type: 'ABOVE_SMA200' });
                    result.score += 5;
                } else if (price < sma200 && !isLong) {
                    result.signals.push({ type: 'BELOW_SMA200' });
                    result.score += 5;
                }
            }

        } catch (error) {
            console.error('[TradeIntelligence] EMA evaluation error:', error.message);
        }

        return result;
    }

    // =========================================================================
    // DECISION TREE
    // =========================================================================

    /**
     * Run the decision tree based on all evaluations
     */
    runDecisionTree(evaluation, isLong, pnlPercent, timeInTrade) {
        const { scores, signals } = evaluation;
        const reasoning = [];

        // Calculate aggregate score from ALL evaluation modules
        const totalScore =
            (scores.regime?.score || 0) +
            (scores.momentum?.score || 0) +
            (scores.structure?.score || 0) +
            (scores.candle?.score || 0) +
            (scores.tradeContext?.score || 0) +
            (scores.risk?.score || 0) +
            (scores.volume?.score || 0) +
            (scores.trai?.score || 0) +
            (scores.whale?.score || 0) +
            (scores.pattern?.score || 0) +
            (scores.history?.score || 0) +
            (scores.botConfidence?.score || 0) +
            (scores.ema?.score || 0);

        reasoning.push(`Total score: ${totalScore} (13 dimensions evaluated)`);

        // =====================================================================
        // SPECIAL CONDITIONS FROM NEW MODULES
        // =====================================================================

        // Whale alert + against position = danger
        if (scores.whale?.whaleAlert) {
            const whaleAgainst = (isLong && scores.whale.signals.some(s => s.type === 'WHALE_DISTRIBUTING')) ||
                                (!isLong && scores.whale.signals.some(s => s.type === 'WHALE_ACCUMULATING'));
            if (whaleAgainst && pnlPercent < 0.5) {
                reasoning.push('WHALE ACTIVITY AGAINST POSITION: Smart money diverging');
                return { action: 'EXIT_LOSS', confidence: 0.8, reasoning };
            }
        }

        // TRAI strongly disagrees
        if (scores.trai?.score < -20) {
            reasoning.push('TRAI AI STRONGLY BEARISH ON POSITION');
            if (pnlPercent < 0) {
                return { action: 'EXIT_LOSS', confidence: 0.75, reasoning };
            }
        }

        // Pattern bank shows this is historically bad
        if (scores.pattern?.score < -15 && scores.history?.score < -10) {
            reasoning.push('PATTERN HISTORY + SIMILAR TRADES BOTH NEGATIVE');
            if (pnlPercent < 0) {
                return { action: 'EXIT_LOSS', confidence: 0.7, reasoning };
            }
        }

        // Volume not confirming move
        if (scores.volume?.score < -10 && !scores.volume?.volumeConfirms) {
            reasoning.push('VOLUME NOT CONFIRMING - move may be fake');
        }

        // EMA structure broken
        if (scores.ema?.score < -15) {
            reasoning.push('EMA STRUCTURE BROKEN - trend may be reversing');
            if (pnlPercent > this.config.profitTakePartial) {
                return { action: 'TRAIL_TIGHT', confidence: 0.8, reasoning };
            }
        }

        // =====================================================================
        // IMMEDIATE EXIT CONDITIONS
        // =====================================================================

        // High risk state - protect capital
        if (scores.risk.highRisk && pnlPercent < 0) {
            reasoning.push('HIGH RISK STATE + LOSING: Exit to protect capital');
            return { action: 'EXIT_LOSS', confidence: 0.9, reasoning };
        }

        // Thesis broken + losing
        if (scores.tradeContext.thesisBroken && pnlPercent < -0.5) {
            reasoning.push('THESIS BROKEN + LOSING: Exit, entry assumption invalid');
            return { action: 'EXIT_LOSS', confidence: 0.85, reasoning };
        }

        // Significant loss
        if (pnlPercent < -this.config.lossCut) {
            reasoning.push(`STOP LOSS TERRITORY (${pnlPercent.toFixed(2)}%): Cut losses`);
            return { action: 'EXIT_LOSS', confidence: 0.95, reasoning };
        }

        // =====================================================================
        // PROFIT MANAGEMENT
        // =====================================================================

        if (pnlPercent > 0) {
            // Strong profit + weakening momentum
            if (pnlPercent > this.config.profitTrailTight) {
                if (totalScore < 0) {
                    reasoning.push(`STRONG PROFIT + NEGATIVE SIGNALS: Take profit`);
                    return { action: 'EXIT_PROFIT', confidence: 0.85, reasoning };
                }
                if (scores.momentum.divergence) {
                    reasoning.push(`STRONG PROFIT + DIVERGENCE: Trail tight`);
                    return { action: 'TRAIL_TIGHT', confidence: 0.8, reasoning };
                }
                reasoning.push(`STRONG PROFIT + POSITIVE SIGNALS: Let it ride with trail`);
                return { action: 'TRAIL_LOOSE', confidence: 0.75, reasoning };
            }

            // Good profit
            if (pnlPercent > this.config.profitTakePartial) {
                if (scores.structure.nearLevel) {
                    reasoning.push(`GOOD PROFIT + AT KEY LEVEL: Scale out`);
                    return { action: 'SCALE_OUT', confidence: 0.7, reasoning };
                }
                if (totalScore > 20) {
                    reasoning.push(`GOOD PROFIT + STRONG SIGNALS: Hold strong`);
                    return { action: 'HOLD_STRONG', confidence: 0.8, reasoning };
                }
                reasoning.push(`GOOD PROFIT: Move to breakeven`);
                return { action: 'MOVE_TO_BREAKEVEN', confidence: 0.75, reasoning };
            }

            // Small profit
            if (pnlPercent > 0.3) {
                if (totalScore > 30) {
                    reasoning.push(`SMALL PROFIT + VERY STRONG SIGNALS: Hold strong, potential runner`);
                    return { action: 'HOLD_STRONG', confidence: 0.75, reasoning };
                }
                if (totalScore < -10) {
                    reasoning.push(`SMALL PROFIT + NEGATIVE SIGNALS: Take what you can`);
                    return { action: 'EXIT_PROFIT', confidence: 0.65, reasoning };
                }
            }
        }

        // =====================================================================
        // LOSS MANAGEMENT
        // =====================================================================

        if (pnlPercent < 0) {
            // Warning zone loss
            if (pnlPercent < -this.config.lossWarning) {
                if (totalScore < -15) {
                    reasoning.push(`LOSS + NEGATIVE SIGNALS: Cut before it gets worse`);
                    return { action: 'EXIT_LOSS', confidence: 0.75, reasoning };
                }
                if (scores.tradeContext.thesisBroken) {
                    reasoning.push(`LOSS + THESIS BROKEN: Exit, wrong on this one`);
                    return { action: 'EXIT_LOSS', confidence: 0.8, reasoning };
                }
                reasoning.push(`LOSS but signals mixed: Hold cautiously`);
                return { action: 'HOLD_CAUTIOUS', confidence: 0.5, reasoning };
            }

            // Small loss - normal noise territory
            if (totalScore > 20) {
                reasoning.push(`SMALL LOSS + STRONG SIGNALS: Thesis intact, hold`);
                return { action: 'HOLD_STRONG', confidence: 0.7, reasoning };
            }
        }

        // =====================================================================
        // SCALING OPPORTUNITIES
        // =====================================================================

        // Scale in on strength
        if (totalScore > 40 && pnlPercent > 0.2 && pnlPercent < 1) {
            reasoning.push(`PROFITABLE + VERY STRONG SIGNALS: Consider adding`);
            return { action: 'SCALE_IN', confidence: 0.65, reasoning };
        }

        // =====================================================================
        // STALE TRADE HANDLING
        // =====================================================================

        if (timeInTrade > this.config.staleTradeTime && Math.abs(pnlPercent) < 0.3) {
            reasoning.push(`STALE TRADE: Going nowhere, free up capital`);
            return { action: pnlPercent > 0 ? 'EXIT_PROFIT' : 'EXIT_LOSS', confidence: 0.6, reasoning };
        }

        // =====================================================================
        // DEFAULT HOLDS
        // =====================================================================

        if (totalScore > 15) {
            reasoning.push(`POSITIVE OVERALL SCORE: Hold with confidence`);
            return { action: 'HOLD_STRONG', confidence: 0.7, reasoning };
        }

        if (totalScore < -15) {
            reasoning.push(`NEGATIVE OVERALL SCORE: Hold but be ready to exit`);
            return { action: 'HOLD_CAUTIOUS', confidence: 0.4, reasoning };
        }

        reasoning.push(`MIXED SIGNALS: Default cautious hold`);
        return { action: 'HOLD_CAUTIOUS', confidence: 0.5, reasoning };
    }

    // =========================================================================
    // UTILITY METHODS
    // =========================================================================

    /**
     * Get human-readable action description
     */
    getActionDescription(action) {
        const descriptions = {
            'HOLD_STRONG': 'Hold position - thesis intact, signals positive',
            'HOLD_CAUTIOUS': 'Hold but monitor closely - mixed signals',
            'SCALE_IN': 'Add to position - strong confirmation',
            'SCALE_OUT': 'Take partial profits - reduce exposure',
            'TRAIL_TIGHT': 'Tighten stop loss - protect profits aggressively',
            'TRAIL_LOOSE': 'Trail stop loosely - give room to run',
            'MOVE_TO_BREAKEVEN': 'Move stop to entry - free trade',
            'EXIT_PROFIT': 'Close position - take profits',
            'EXIT_LOSS': 'Close position - cut losses',
            'REVERSE': 'Close and reverse - strong opposite signal'
        };
        return descriptions[action] || action;
    }

    /**
     * Convert action to execution parameters
     */
    getExecutionParams(action, trade, currentPrice) {
        const entryPrice = trade.entryPrice;
        const isLong = trade.direction === 'buy' || trade.action === 'BUY';

        switch (action) {
            case 'TRAIL_TIGHT':
                return {
                    adjustStop: true,
                    newStop: isLong
                        ? currentPrice * 0.995  // 0.5% below current
                        : currentPrice * 1.005  // 0.5% above current
                };

            case 'TRAIL_LOOSE':
                return {
                    adjustStop: true,
                    newStop: isLong
                        ? currentPrice * 0.985  // 1.5% below current
                        : currentPrice * 1.015  // 1.5% above current
                };

            case 'MOVE_TO_BREAKEVEN':
                return {
                    adjustStop: true,
                    newStop: entryPrice
                };

            case 'SCALE_OUT':
                return {
                    partialClose: true,
                    closePercent: 50  // Close half
                };

            case 'SCALE_IN':
                return {
                    addToPosition: true,
                    addPercent: 50  // Add 50% more
                };

            case 'EXIT_PROFIT':
            case 'EXIT_LOSS':
                return {
                    closePosition: true
                };

            case 'REVERSE':
                return {
                    closePosition: true,
                    openOpposite: true
                };

            default:
                return { hold: true };
        }
    }
}

module.exports = TradeIntelligenceEngine;
