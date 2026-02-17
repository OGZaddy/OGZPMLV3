/**
 * SignalGenerator.js — OGZPrime Clean Signal Pipeline
 * 
 * REPLACES: calculateRealConfidence() + determineTradingDirection()
 * KEEPS: Everything else (IndicatorEngine, PatternRecognition, RiskManager, Execution)
 * 
 * Architecture:
 *   IndicatorEngine.getSnapshot() → SignalGenerator.evaluate() → {direction, confidence, reasons}
 *   
 * Each signal source is independent, testable, and returns the same shape:
 *   { direction: 'buy'|'sell'|'neutral', strength: 0-1, name: string }
 * 
 * No side effects. No duplicate indicator calculations. No nested gates.
 * One input, one output, one decision.
 */

const { c } = require('./CandleHelper');

class SignalGenerator {
  constructor(config = {}) {
    // Weights for each signal source (how much it matters)
    this.weights = {
      rsi:        config.rsiWeight        ?? 1.0,
      macd:       config.macdWeight       ?? 1.0,
      emaCross:   config.emaCrossWeight   ?? 0.8,
      bollinger:  config.bollingerWeight  ?? 0.7,
      patterns:   config.patternsWeight   ?? 1.2,
      regime:     config.regimeWeight     ?? 0.6,
      volume:     config.volumeWeight     ?? 0.5,
      momentum:   config.momentumWeight   ?? 0.6,
      tpo:        config.tpoWeight        ?? 0.7,
      sr:         config.srWeight         ?? 0.6,
      // Modular entry signals
      emaSMACross:    config.emaSMACrossWeight    ?? 0.9,
      liquiditySweep: config.liquiditySweepWeight ?? 1.1,
      maDynamicSR:    config.maDynamicSRWeight    ?? 0.7,
      mtf:            config.mtfWeight            ?? 0.8,
    };

    // Minimum signals required to fire a trade (prevents single-indicator trades)
    this.minSignalsToTrade = config.minSignalsToTrade ?? 2;

    // Minimum net confidence to fire
    this.minConfidence = config.minConfidence ?? 0.25;

    // Track signal history for debugging
    this.lastSignals = [];
    this.signalCount = 0;
  }

  /**
   * Main entry point — evaluates all signal sources and returns a trading decision.
   * 
   * @param {Object} indicators - From IndicatorEngine.getSnapshot() 
   * @param {Array}  patterns   - From EnhancedPatternRecognition.analyzePatterns()
   * @param {Object} regime     - From MarketRegimeDetector.detectRegime()
   * @param {Array}  priceHistory - Candle array from bot
   * @param {Object} extras     - Optional: tpoResult, srLevels, fibLevels, etc.
   * @returns {{ direction: string, confidence: number, reasons: string[], signals: Object[], meta: Object }}
   */
  evaluate(indicators, patterns = [], regime = null, priceHistory = [], extras = {}) {
    const signals = [];
    const price = indicators?.lastCandle ? c(indicators.lastCandle)
      : priceHistory[priceHistory.length - 1] ? c(priceHistory[priceHistory.length - 1])
      : extras.price
      || 0;

    // ─── Gather signals from each source ───
    const rsiSig = this.evaluateRSI(indicators?.rsi);
    if (rsiSig) signals.push({ ...rsiSig, weight: this.weights.rsi });

    const macdSig = this.evaluateMACD(indicators?.macd);
    if (macdSig) signals.push({ ...macdSig, weight: this.weights.macd });

    const emaSig = this.evaluateEMACross(indicators?.ema, price);
    if (emaSig) signals.push({ ...emaSig, weight: this.weights.emaCross });

    const bbSig = this.evaluateBollinger(indicators?.bb, price);
    if (bbSig) signals.push({ ...bbSig, weight: this.weights.bollinger });

    const patSig = this.evaluatePatterns(patterns);
    if (patSig) signals.push({ ...patSig, weight: this.weights.patterns });

    const regSig = this.evaluateRegime(regime);
    if (regSig) signals.push({ ...regSig, weight: this.weights.regime });

    const volSig = this.evaluateVolume(indicators, priceHistory);
    if (volSig) signals.push({ ...volSig, weight: this.weights.volume });

    const momSig = this.evaluateMomentum(indicators, priceHistory);
    if (momSig) signals.push({ ...momSig, weight: this.weights.momentum });

    // Optional signals from extras
    if (extras.tpoResult) {
      const tpoSig = this.evaluateTPO(extras.tpoResult);
      if (tpoSig) signals.push({ ...tpoSig, weight: this.weights.tpo });
    }

    if (extras.srLevels) {
      const srSig = this.evaluateSR(extras.srLevels, price);
      if (srSig) signals.push({ ...srSig, weight: this.weights.sr });
    }

    // Modular entry system signals
    if (extras.emaCrossoverSignal) {
      const ecSig = this.evaluateEMASMACrossover(extras.emaCrossoverSignal);
      if (ecSig) signals.push({ ...ecSig, weight: this.weights.emaSMACross });
    }

    if (extras.liquiditySweepSignal) {
      const lsSig = this.evaluateLiquiditySweep(extras.liquiditySweepSignal);
      if (lsSig) signals.push({ ...lsSig, weight: this.weights.liquiditySweep });
    }

    if (extras.maDynamicSRSignal) {
      const maSig = this.evaluateMADynamicSR(extras.maDynamicSRSignal);
      if (maSig) signals.push({ ...maSig, weight: this.weights.maDynamicSR });
    }

    if (extras.mtfSignal) {
      const mtfSig = this.evaluateMTF(extras.mtfSignal);
      if (mtfSig) signals.push({ ...mtfSig, weight: this.weights.mtf });
    }

    // ─── Aggregate ───
    const result = this.aggregate(signals, price);

    // ─── Safety overrides ───
    const safeResult = this.applySafetyOverrides(result, indicators, regime);

    // ─── Store for debugging ───
    this.signalCount++;
    this.lastSignals = signals;

    return safeResult;
  }

  // ═══════════════════════════════════════════════════════════
  // SIGNAL EVALUATORS — Each one is independent and testable
  // ═══════════════════════════════════════════════════════════

  /**
   * RSI — Relative Strength Index
   * Classic oversold/overbought with gradient strength
   */
  evaluateRSI(rsi) {
    if (rsi === null || rsi === undefined || typeof rsi !== 'number') return null;

    if (rsi < 20)  return { direction: 'buy',  strength: 0.9, name: 'RSI Extreme Oversold (<20)' };
    if (rsi < 25)  return { direction: 'buy',  strength: 0.7, name: 'RSI Strong Oversold (<25)' };
    if (rsi < 30)  return { direction: 'buy',  strength: 0.5, name: 'RSI Oversold (<30)' };
    if (rsi < 35)  return { direction: 'buy',  strength: 0.3, name: 'RSI Approaching Oversold (<35)' };
    if (rsi > 80)  return { direction: 'sell', strength: 0.9, name: 'RSI Extreme Overbought (>80)' };
    if (rsi > 75)  return { direction: 'sell', strength: 0.7, name: 'RSI Strong Overbought (>75)' };
    if (rsi > 70)  return { direction: 'sell', strength: 0.5, name: 'RSI Overbought (>70)' };
    if (rsi > 65)  return { direction: 'sell', strength: 0.3, name: 'RSI Approaching Overbought (>65)' };

    return { direction: 'neutral', strength: 0, name: `RSI Neutral (${rsi.toFixed(1)})` };
  }

  /**
   * MACD — Moving Average Convergence/Divergence
   * Crossovers and histogram direction
   */
  evaluateMACD(macd) {
    if (!macd || typeof macd !== 'object') return null;

    const macdLine = macd.macd ?? macd.macdLine ?? null;
    const signalLine = macd.signal ?? macd.signalLine ?? null;
    const histogram = macd.hist ?? macd.histogram ?? null;

    if (macdLine === null || signalLine === null) return null;

    // MACD above signal = bullish, below = bearish
    const diff = macdLine - signalLine;
    const absDiff = Math.abs(diff);

    // Strong crossover (significant divergence)
    if (diff > 0 && absDiff > 1) {
      return { direction: 'buy', strength: Math.min(0.8, absDiff / 5), name: `MACD Bullish Cross (${diff.toFixed(2)})` };
    }
    if (diff < 0 && absDiff > 1) {
      return { direction: 'sell', strength: Math.min(0.8, absDiff / 5), name: `MACD Bearish Cross (${Math.abs(diff).toFixed(2)})` };
    }

    // Weak signal
    if (diff > 0) return { direction: 'buy', strength: 0.2, name: 'MACD Slightly Bullish' };
    if (diff < 0) return { direction: 'sell', strength: 0.2, name: 'MACD Slightly Bearish' };

    return { direction: 'neutral', strength: 0, name: 'MACD Flat' };
  }

  /**
   * EMA Crossover — 9/20/50 alignment
   */
  evaluateEMACross(ema, price) {
    if (!ema || typeof ema !== 'object' || !price) return null;

    const ema9 = ema[9] ?? ema.ema9 ?? null;
    const ema20 = ema[20] ?? ema.ema20 ?? null;
    const ema50 = ema[50] ?? ema.ema50 ?? null;

    // Need at least two EMAs
    if (ema9 === null && ema20 === null) return null;

    let bullishCount = 0;
    let bearishCount = 0;

    // Price above EMA = bullish
    if (ema9 !== null) {
      if (price > ema9) bullishCount++;
      else bearishCount++;
    }
    if (ema20 !== null) {
      if (price > ema20) bullishCount++;
      else bearishCount++;
    }
    if (ema50 !== null) {
      if (price > ema50) bullishCount++;
      else bearishCount++;
    }

    // EMA stacking (9 > 20 > 50 = strong trend)
    if (ema9 !== null && ema20 !== null && ema50 !== null) {
      if (ema9 > ema20 && ema20 > ema50) {
        return { direction: 'buy', strength: 0.7, name: 'EMA Perfect Bull Stack (9>20>50)' };
      }
      if (ema9 < ema20 && ema20 < ema50) {
        return { direction: 'sell', strength: 0.7, name: 'EMA Perfect Bear Stack (9<20<50)' };
      }
    }

    // Partial alignment
    const total = bullishCount + bearishCount;
    if (total === 0) return null;

    if (bullishCount > bearishCount) {
      return { direction: 'buy', strength: 0.3 + (bullishCount / total) * 0.3, name: `EMA Bullish (${bullishCount}/${total} above)` };
    }
    if (bearishCount > bullishCount) {
      return { direction: 'sell', strength: 0.3 + (bearishCount / total) * 0.3, name: `EMA Bearish (${bearishCount}/${total} below)` };
    }

    return { direction: 'neutral', strength: 0, name: 'EMA Mixed' };
  }

  /**
   * Bollinger Bands — Price relative to bands
   */
  evaluateBollinger(bb, price) {
    if (!bb || !price) return null;

    const upper = bb.upper ?? bb.bbUpper ?? null;
    const lower = bb.lower ?? bb.bbLower ?? null;
    const middle = bb.mid ?? bb.middle ?? bb.bbMiddle ?? null;

    if (upper === null || lower === null) return null;

    const bandwidth = upper - lower;
    if (bandwidth <= 0) return null;

    // Position within bands (0 = lower band, 1 = upper band)
    const position = (price - lower) / bandwidth;

    if (position <= 0.05) {
      return { direction: 'buy', strength: 0.8, name: 'BB Price at Lower Band (squeeze buy)' };
    }
    if (position <= 0.15) {
      return { direction: 'buy', strength: 0.5, name: 'BB Price near Lower Band' };
    }
    if (position >= 0.95) {
      return { direction: 'sell', strength: 0.8, name: 'BB Price at Upper Band (squeeze sell)' };
    }
    if (position >= 0.85) {
      return { direction: 'sell', strength: 0.5, name: 'BB Price near Upper Band' };
    }

    return { direction: 'neutral', strength: 0, name: `BB Mid-range (${(position * 100).toFixed(0)}%)` };
  }

  /**
   * Pattern Recognition — From EnhancedPatternRecognition
   * Weights by pattern confidence and count
   */
  evaluatePatterns(patterns) {
    if (!patterns || !Array.isArray(patterns) || patterns.length === 0) return null;

    let bullishStrength = 0;
    let bearishStrength = 0;
    const names = [];

    for (const p of patterns) {
      if (!p || !p.direction) continue;

      const conf = p.confidence || 0.5;
      const dir = p.direction.toLowerCase();

      if (dir === 'bullish' || dir === 'buy') {
        bullishStrength += conf * 0.3; // Scale: each pattern contributes up to 30%
        names.push(`${p.name || 'pattern'} (bull ${(conf * 100).toFixed(0)}%)`);
      } else if (dir === 'bearish' || dir === 'sell') {
        bearishStrength += conf * 0.3;
        names.push(`${p.name || 'pattern'} (bear ${(conf * 100).toFixed(0)}%)`);
      }
    }

    // Cap at 1.0
    bullishStrength = Math.min(1.0, bullishStrength);
    bearishStrength = Math.min(1.0, bearishStrength);

    if (bullishStrength > bearishStrength && bullishStrength > 0.1) {
      return { direction: 'buy', strength: bullishStrength, name: `Patterns: ${names.join(', ')}` };
    }
    if (bearishStrength > bullishStrength && bearishStrength > 0.1) {
      return { direction: 'sell', strength: bearishStrength, name: `Patterns: ${names.join(', ')}` };
    }

    return null;
  }

  /**
   * Market Regime — Trend following
   */
  evaluateRegime(regime) {
    if (!regime) return null;

    const regimeStr = (typeof regime === 'string') ? regime : regime.regime || regime.currentRegime || null;
    if (!regimeStr) return null;

    const r = regimeStr.toLowerCase();

    if (r === 'trending_up' || r === 'strong_uptrend' || r === 'uptrend') {
      return { direction: 'buy', strength: 0.5, name: `Regime: ${regimeStr}` };
    }
    if (r === 'trending_down' || r === 'strong_downtrend' || r === 'downtrend') {
      return { direction: 'sell', strength: 0.5, name: `Regime: ${regimeStr}` };
    }
    if (r === 'volatile' || r === 'breakout') {
      return { direction: 'neutral', strength: 0, name: `Regime: ${regimeStr} (no bias)` };
    }

    return { direction: 'neutral', strength: 0, name: `Regime: ${regimeStr}` };
  }

  /**
   * Volume — Confirms or weakens signals
   * Returns neutral direction but modifies confidence via weight
   */
  evaluateVolume(indicators, priceHistory) {
    if (!priceHistory || priceHistory.length < 20) return null;

    // Calculate average volume from price history
    const recent = priceHistory.slice(-20);
    const avgVol = recent.reduce((sum, c) => sum + (c.v || 0), 0) / recent.length;
    const currentVol = priceHistory[priceHistory.length - 1]?.v || 0;

    if (avgVol <= 0) return null;

    const ratio = currentVol / avgVol;

    if (ratio > 2.0) {
      // Very high volume — confirms whatever direction other signals show
      return { direction: 'neutral', strength: 0, name: `Volume Spike (${ratio.toFixed(1)}x avg)`, volumeMultiplier: 1.3 };
    }
    if (ratio > 1.5) {
      return { direction: 'neutral', strength: 0, name: `High Volume (${ratio.toFixed(1)}x avg)`, volumeMultiplier: 1.15 };
    }
    if (ratio < 0.3) {
      // Very low volume — reduce confidence in any direction
      return { direction: 'neutral', strength: 0, name: `Low Volume (${ratio.toFixed(1)}x avg)`, volumeMultiplier: 0.7 };
    }

    return null; // Normal volume, no adjustment
  }

  /**
   * Momentum — Price rate of change
   */
  evaluateMomentum(indicators, priceHistory) {
    if (!priceHistory || priceHistory.length < 10) return null;

    const lookback = 10;
    const current = priceHistory[priceHistory.length - 1] ? c(priceHistory[priceHistory.length - 1]) : null;
    const past = priceHistory[priceHistory.length - lookback] ? c(priceHistory[priceHistory.length - lookback]) : null;

    if (!current || !past || past === 0) return null;

    const momentum = ((current - past) / past) * 100; // Percentage change

    if (momentum > 2.0)  return { direction: 'buy',  strength: 0.6, name: `Strong Momentum +${momentum.toFixed(2)}%` };
    if (momentum > 1.0)  return { direction: 'buy',  strength: 0.3, name: `Positive Momentum +${momentum.toFixed(2)}%` };
    if (momentum < -2.0) return { direction: 'sell', strength: 0.6, name: `Strong Neg Momentum ${momentum.toFixed(2)}%` };
    if (momentum < -1.0) return { direction: 'sell', strength: 0.3, name: `Negative Momentum ${momentum.toFixed(2)}%` };

    return { direction: 'neutral', strength: 0, name: `Flat Momentum (${momentum.toFixed(2)}%)` };
  }

  /**
   * TPO — Two Pole Oscillator (OGZ proprietary)
   */
  evaluateTPO(tpoResult) {
    if (!tpoResult || !tpoResult.signal) return null;

    const signal = tpoResult.signal;
    const score = tpoResult.score || signal.score || 0;

    if (signal.action === 'BUY' || signal.zone === 'oversold') {
      return { direction: 'buy', strength: Math.min(0.8, Math.abs(score)), name: `TPO Bullish (${signal.zone || 'buy'})` };
    }
    if (signal.action === 'SELL' || signal.zone === 'overbought') {
      return { direction: 'sell', strength: Math.min(0.8, Math.abs(score)), name: `TPO Bearish (${signal.zone || 'sell'})` };
    }

    return null;
  }

  /**
   * Support/Resistance — Price near key levels
   */
  evaluateSR(srLevels, price) {
    if (!srLevels || !price) return null;

    const supports = srLevels.supports || [];
    const resistances = srLevels.resistances || [];

    // Find nearest support and resistance
    let nearestSupport = null;
    let nearestResistance = null;

    for (const s of supports) {
      const level = typeof s === 'number' ? s : s.level || s.price;
      if (level && level < price) {
        if (!nearestSupport || level > nearestSupport) nearestSupport = level;
      }
    }

    for (const r of resistances) {
      const level = typeof r === 'number' ? r : r.level || r.price;
      if (level && level > price) {
        if (!nearestResistance || level < nearestResistance) nearestResistance = level;
      }
    }

    // Check proximity (within 0.5% of level)
    const proximityThreshold = price * 0.005;

    if (nearestSupport && (price - nearestSupport) < proximityThreshold) {
      return { direction: 'buy', strength: 0.5, name: `Near Support ($${nearestSupport.toFixed(0)})` };
    }
    if (nearestResistance && (nearestResistance - price) < proximityThreshold) {
      return { direction: 'sell', strength: 0.5, name: `Near Resistance ($${nearestResistance.toFixed(0)})` };
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // MODULAR ENTRY SIGNAL EVALUATORS
  // ═══════════════════════════════════════════════════════════

  /**
   * EMA/SMA Crossover Signal — Golden/death crosses, snapback, confluence
   * Input: { direction: 'buy'|'sell'|'neutral', confidence: 0-1, confluence, snapback, blowoff }
   */
  evaluateEMASMACrossover(signal) {
    if (!signal || signal.direction === 'neutral' || !signal.confidence) return null;

    let strength = signal.confidence;

    // Confluence bonus — multiple MA pairs agreeing
    if (signal.confluence && signal.confluence > 0.6) {
      strength = Math.min(1.0, strength * 1.3);
    }

    // Snapback signals are high-conviction mean reversion plays
    if (signal.snapback && signal.snapback.active) {
      strength = Math.min(1.0, strength * 1.2);
    }

    // Blowoff warning — reduce confidence (overextended move)
    if (signal.blowoff && signal.blowoff.active) {
      strength *= 0.6;
    }

    const dir = signal.direction === 'buy' ? 'buy' : 'sell';
    return { direction: dir, strength, name: `EMA/SMA Cross (${dir}, conf: ${(strength * 100).toFixed(0)}%)` };
  }

  /**
   * Liquidity Sweep Detector — Institutional manipulation candle detection
   * Input: { hasSignal: bool, direction: 'buy'|'sell'|'neutral', confidence: 0-1 }
   */
  evaluateLiquiditySweep(signal) {
    if (!signal || !signal.hasSignal || signal.direction === 'neutral') return null;

    const strength = Math.min(1.0, signal.confidence || 0.5);
    const dir = signal.direction === 'buy' ? 'buy' : 'sell';
    return { direction: dir, strength, name: `Liquidity Sweep (${dir}, conf: ${(strength * 100).toFixed(0)}%)` };
  }

  /**
   * MA Dynamic Support/Resistance — Price bouncing off moving averages
   * Input: { direction: 'buy'|'sell'|'neutral', confidence: 0-1, level, ... }
   */
  evaluateMADynamicSR(signal) {
    if (!signal || signal.direction === 'neutral' || !signal.confidence) return null;

    const strength = Math.min(1.0, signal.confidence || 0.4);
    const dir = signal.direction === 'buy' ? 'buy' : 'sell';
    return { direction: dir, strength, name: `MA Dynamic S/R (${dir}, conf: ${(strength * 100).toFixed(0)}%)` };
  }

  /**
   * Multi-Timeframe Adapter — Higher timeframe confirmation
   * Input: { bias: 'bullish'|'bearish'|'neutral', strength: 0-1, timeframes: [...] }
   */
  evaluateMTF(signal) {
    if (!signal || !signal.bias || signal.bias === 'neutral') return null;

    const strength = Math.min(1.0, signal.strength || signal.confidence || 0.4);
    const dir = signal.bias === 'bullish' ? 'buy' : 'sell';
    return { direction: dir, strength, name: `MTF Confluence (${dir}, ${(strength * 100).toFixed(0)}%)` };
  }

  // ═══════════════════════════════════════════════════════════
  // AGGREGATION — Weighted vote system
  // ═══════════════════════════════════════════════════════════

  aggregate(signals, price) {
    let weightedBullish = 0;
    let weightedBearish = 0;
    let totalWeight = 0;
    let bullishCount = 0;
    let bearishCount = 0;
    let volumeMultiplier = 1.0;
    const reasons = [];

    for (const sig of signals) {
      if (!sig) continue;

      // Capture volume multiplier if present
      if (sig.volumeMultiplier) {
        volumeMultiplier = sig.volumeMultiplier;
        reasons.push(sig.name);
        continue;
      }

      const weight = sig.weight || 1.0;
      totalWeight += weight;

      if (sig.direction === 'buy') {
        weightedBullish += sig.strength * weight;
        bullishCount++;
        reasons.push(`📈 ${sig.name}`);
      } else if (sig.direction === 'sell') {
        weightedBearish += sig.strength * weight;
        bearishCount++;
        reasons.push(`📉 ${sig.name}`);
      } else if (sig.direction === 'neutral' && sig.name) {
        reasons.push(`➖ ${sig.name}`);
      }
    }

    // Apply volume multiplier to the dominant direction
    weightedBullish *= volumeMultiplier;
    weightedBearish *= volumeMultiplier;

    // Determine direction
    let direction = 'hold';
    let netConfidence = 0;

    if (weightedBullish > weightedBearish) {
      // Net bullish
      netConfidence = totalWeight > 0 ? (weightedBullish - weightedBearish) / totalWeight : 0;
      if (bullishCount >= this.minSignalsToTrade && netConfidence >= this.minConfidence) {
        direction = 'buy';
      }
    } else if (weightedBearish > weightedBullish) {
      // Net bearish
      netConfidence = totalWeight > 0 ? (weightedBearish - weightedBullish) / totalWeight : 0;
      if (bearishCount >= this.minSignalsToTrade && netConfidence >= this.minConfidence) {
        direction = 'sell';
      }
    }

    // Cap confidence at 1.0
    netConfidence = Math.min(1.0, netConfidence);

    return {
      direction,
      confidence: netConfidence,
      reasons,
      signals,
      meta: {
        bullishTotal: weightedBullish,
        bearishTotal: weightedBearish,
        bullishCount,
        bearishCount,
        totalWeight,
        volumeMultiplier,
        signalsFired: bullishCount + bearishCount,
        price
      }
    };
  }

  // ═══════════════════════════════════════════════════════════
  // SAFETY OVERRIDES — Hard limits that override everything
  // ═══════════════════════════════════════════════════════════

  applySafetyOverrides(result, indicators, regime) {
    // Clone to avoid mutation
    const safe = { ...result, meta: { ...result.meta } };

    // RSI safety: Don't buy at extreme overbought, don't sell at extreme oversold
    const rsi = indicators?.rsi;
    if (rsi !== null && rsi !== undefined) {
      if (rsi > 85 && safe.direction === 'buy') {
        safe.direction = 'hold';
        safe.confidence = 0;
        safe.reasons.push('🚫 SAFETY: Blocked BUY at RSI > 85');
      }
      if (rsi < 15 && safe.direction === 'sell') {
        safe.direction = 'hold';
        safe.confidence = 0;
        safe.reasons.push('🚫 SAFETY: Blocked SELL at RSI < 15');
      }
    }

    // Regime safety: Weak buys in strong downtrends need extra confirmation
    const regimeStr = typeof regime === 'string' ? regime : regime?.regime || regime?.currentRegime || '';
    if (regimeStr.includes('down') && safe.direction === 'buy' && safe.confidence < 0.4) {
      safe.direction = 'hold';
      safe.reasons.push(`🚫 SAFETY: Blocked weak buy in downtrend (conf: ${(safe.confidence * 100).toFixed(0)}%)`);
      safe.confidence = 0;
    }

    return safe;
  }

  // ═══════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════

  /**
   * Get the last evaluation for debugging/dashboard
   */
  getLastEvaluation() {
    return {
      signals: this.lastSignals,
      count: this.signalCount
    };
  }

  /**
   * Log a formatted summary of the current signal state
   */
  logSummary(result) {
    const { direction, confidence, meta, reasons } = result;
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📡 SIGNAL: ${direction.toUpperCase()} @ ${(confidence * 100).toFixed(1)}% confidence`);
    console.log(`   Bull: ${(meta.bullishTotal * 100).toFixed(1)}% (${meta.bullishCount} signals)`);
    console.log(`   Bear: ${(meta.bearishTotal * 100).toFixed(1)}% (${meta.bearishCount} signals)`);
    
    if (meta.volumeMultiplier !== 1.0) {
      console.log(`   Vol:  ${meta.volumeMultiplier.toFixed(2)}x multiplier`);
    }

    for (const r of reasons) {
      console.log(`   ${r}`);
    }
    console.log(`${'═'.repeat(60)}\n`);
  }
}

module.exports = { SignalGenerator };
