═══════════════════════════════════════════════════════════════════════════════
  UNIVERSAL TRADING ENGINE — TUNING BATTLE PLAN
  
  For: Claude Code
  From: Claude Desktop (architect) + Trey (vision)
  Date: 2026-02-27
  
  CORE PRINCIPLE: "Strategies are strategies. Liquidity is liquidity."
  This is NOT a crypto bot. This is a TRADING ENGINE that happens to be
  connected to Kraken right now. Every change below must be market-agnostic.
  When we plug in stocks, forex, futures, or options later, NOTHING here
  should need to change — only the exchange adapter and fee structure.
  
  THE PROBLEM: 3K backtest showed 55% win rate but breakeven before fees.
  Winners: +1.10%. Losers: -1.08%. Reward:risk = 1.02:1.
  Round-trip fees = 0.52%. Most TPs barely clear fees.
  33% of trades exit at max_hold = TP/SL never triggered.
  
  THE FIX: Five surgical changes to the engine. No new features.
  No new strategies. Just tune what exists.
═══════════════════════════════════════════════════════════════════════════════


████████████████████████████████████████████████████████████████████████████████
█ CHANGE 1: WIDEN EXIT CONTRACTS — The #1 Priority                           █
████████████████████████████████████████████████████████████████████████████████

FILE: core/ExitContractManager.js (lines 30-95)

CURRENT PROBLEM:
  Round-trip fee = 0.52% (0.26% × 2 sides)
  Average TP = 0.75%
  Net profit after fees = 0.75% - 0.52% = 0.23%
  Average SL = -0.45%
  Net loss after fees = -0.45% - 0.52% = -0.97%
  
  Reward:Risk = 0.23 : 0.97 = 0.24:1 NET OF FEES
  You need 81% win rate just to break even. That's impossible.

NEW VALUES — target 2:1 net reward:risk after fees:

Replace the entire DEFAULT_CONTRACTS object (lines 30-95) with:

const DEFAULT_CONTRACTS = {
  // ═══ Trend Following (hold longer, ride the trend) ═══
  EMASMACrossover: {
    stopLossPercent: -1.2,
    takeProfitPercent: 2.5,
    trailingStopPercent: 0.8,   // Only trail after meaningful move
    trailingActivation: 1.0,    // Don't activate trail until +1%
    invalidationConditions: ['ema_cross_reversal'],
    maxHoldTimeMinutes: 300     // 20 candles at 15m — trends need room
  },

  // ═══ Mean Reversion (tighter, quicker exits) ═══
  LiquiditySweep: {
    stopLossPercent: -0.8,
    takeProfitPercent: 1.5,
    trailingStopPercent: 0.5,
    trailingActivation: 0.8,
    invalidationConditions: ['sweep_invalidated', 'box_broken'],
    maxHoldTimeMinutes: 180
  },

  // ═══ Momentum (RSI extremes — expect snapback) ═══
  RSI: {
    stopLossPercent: -1.0,
    takeProfitPercent: 2.0,
    trailingStopPercent: 0.6,
    trailingActivation: 0.8,
    invalidationConditions: [],
    maxHoldTimeMinutes: 240
  },

  // ═══ Support/Resistance (bounce trades) ═══
  MADynamicSR: {
    stopLossPercent: -0.8,
    takeProfitPercent: 1.5,
    trailingStopPercent: 0.5,
    trailingActivation: 0.8,
    invalidationConditions: ['sr_level_broken'],
    maxHoldTimeMinutes: 180
  },

  // ═══ Pattern Recognition (quick setups, moderate hold) ═══
  CandlePattern: {
    stopLossPercent: -0.8,
    takeProfitPercent: 1.5,
    trailingStopPercent: 0.5,
    trailingActivation: 0.7,
    invalidationConditions: ['pattern_negated'],
    maxHoldTimeMinutes: 150
  },

  // ═══ Regime Confluence (strongest signals, widest room) ═══
  MarketRegime: {
    stopLossPercent: -1.5,
    takeProfitPercent: 3.0,
    trailingStopPercent: 1.0,
    trailingActivation: 1.5,
    invalidationConditions: ['regime_change'],
    maxHoldTimeMinutes: 360     // 24 candles — big moves need time
  },

  // ═══ Multi-Timeframe (high-conviction confluence) ═══
  MultiTimeframe: {
    stopLossPercent: -1.2,
    takeProfitPercent: 2.5,
    trailingStopPercent: 0.8,
    trailingActivation: 1.0,
    invalidationConditions: ['mtf_divergence'],
    maxHoldTimeMinutes: 300
  },

  // ═══ TPO / Volume Profile ═══
  OGZTPO: {
    stopLossPercent: -1.0,
    takeProfitPercent: 2.0,
    trailingStopPercent: 0.6,
    trailingActivation: 0.8,
    invalidationConditions: [],
    maxHoldTimeMinutes: 240
  },

  // ═══ Default fallback ═══
  default: {
    stopLossPercent: -1.0,
    takeProfitPercent: 2.0,
    trailingStopPercent: 0.6,
    trailingActivation: 0.8,
    invalidationConditions: [],
    maxHoldTimeMinutes: 240
  }
};

MATH CHECK (using default as example):
  TP = 2.0% - 0.52% fees = 1.48% net win
  SL = -1.0% - 0.52% fees = -1.52% net loss
  Net Reward:Risk = 1.48 : 1.52 = ~1:1
  
  With MarketRegime:
  TP = 3.0% - 0.52% = 2.48% net win
  SL = -1.5% - 0.52% = -2.02% net loss
  Net R:R = 2.48 : 2.02 = 1.23:1
  Need only 45% win rate to profit.

  Win rate will DROP from 55% because TP is wider (harder to hit).
  But PROFIT will INCREASE because each winner is 3x-4x bigger than before.
  This is the Kelly Criterion in action.


████████████████████████████████████████████████████████████████████████████████
█ CHANGE 2: TRAILING STOP ACTIVATION — Stop Capping Winners                  █
████████████████████████████████████████████████████████████████████████████████

FILE: core/ExitContractManager.js — checkExitConditions() method

CURRENT PROBLEM:
  trailingStopPercent is 0.2-0.25%. This means:
  - Trade goes +0.3% → trail activates → trail is at +0.05%
  - Normal 15m volatility is 0.3-0.8% per candle
  - Next candle pulls back 0.3% (NORMAL noise) → trail triggers → exit at +0.05%
  - Net after fees: +0.05% - 0.52% = -0.47% LOSS on a WINNING trade
  
  The trailing stop is CONVERTING WINNERS INTO LOSERS.

FIND the trailing stop check in checkExitConditions() (around line 255-270):

Look for something like:
    if (trade.maxProfitPercent > 0) {
      const trailStop = trade.maxProfitPercent - contract.trailingStopPercent * 100;

Or wherever the trailing stop logic lives.

REPLACE/ADD the trailingActivation concept:

    // Trailing stop — only activate AFTER price has moved enough
    if (trade.maxProfitPercent && contract.trailingActivation) {
      // Don't trail until we've reached activation threshold
      if (trade.maxProfitPercent >= (contract.trailingActivation || 0)) {
        const trailStop = trade.maxProfitPercent - (contract.trailingStopPercent * 100);
        if (pnlPercent <= trailStop && trailStop > effectiveStop) {
          return {
            shouldExit: true,
            reason: 'trailing_stop',
            details: `Trailing: P&L ${pnlPercent.toFixed(2)}% fell from peak ${trade.maxProfitPercent.toFixed(2)}% (activated at ${contract.trailingActivation}%)`
          };
        }
      }
    }

KEY: The trailingActivation field is NEW. It means "don't even START trailing
until the trade is up at least X%." This prevents the trail from triggering
on normal volatility noise during the first few candles of a trade.

GOLDEN TEST: Run 3K backtest. Check how many trades exit at trailing_stop.
Should be FEWER than before (because activation is later) but the ones
that DO trigger should have larger profits (because they ran further first).


████████████████████████████████████████████████████████████████████████████████
█ CHANGE 3: RAISE ENTRY CONFIDENCE THRESHOLD                                 █
████████████████████████████████████████████████████████████████████████████████

FILE: run-empire-v2.js (line ~735) AND core/StrategyOrchestrator.js (line ~38)

CURRENT STATE:
  minTradeConfidence = 0.35 (35%) — run-empire default
  minStrategyConfidence = 0.25 (25%) — orchestrator filter
  
  A SINGLE RSI at 76 (barely overbought) generates ~35% confidence.
  That passes the threshold. But it's barely above a coin flip.
  These weak signals enter trades that oscillate and exit at max_hold
  or with tiny P&L that doesn't cover fees.

CHANGE 3A: In run-empire-v2.js, find line ~735:

        : 0.35,  // Default 35%

REPLACE with:

        : 0.50,  // Default 50% — reject coin-flip signals

CHANGE 3B: In core/StrategyOrchestrator.js, find line ~38:

    this.minStrategyConfidence = config.minStrategyConfidence ?? 0.25;

REPLACE with:

    this.minStrategyConfidence = config.minStrategyConfidence ?? 0.35;

MATH: This will REDUCE trade count. Fewer trades is GOOD if the
surviving trades have higher conviction. We want 20 high-quality trades
instead of 50 coin-flip trades.

GOLDEN TEST: Run 3K backtest. Compare:
  - Old trade count vs new trade count (expect 30-50% fewer)
  - Old win rate vs new win rate (expect higher — weak signals filtered)
  - Old net P&L vs new net P&L (this is the real test)


████████████████████████████████████████████████████████████████████████████████
█ CHANGE 4: CONFIDENCE-SCALED POSITION SIZING                                █
████████████████████████████████████████████████████████████████████████████████

FILE: run-empire-v2.js (around line 2641-2660)

CURRENT PROBLEM:
  Every trade gets the same position size regardless of confidence.
  A 51% confidence trade risks the same dollars as a 95% confidence trade.
  This means your weakest signals drag down your strongest signals.

CURRENT CODE (line ~2641):

    let basePositionPercent = parseFloat(process.env.MAX_POSITION_SIZE_PCT) || 0.01;

REPLACE the sizing block with:

    // ═══ Confidence-scaled position sizing ═══
    // Base: 1% of balance. Scale 0.5x to 2.5x based on confidence.
    // 50% confidence (minimum) = 0.5x = 0.5% of balance
    // 75% confidence = 1.5x = 1.5% of balance
    // 90%+ confidence = 2.5x = 2.5% of balance (cap)
    let basePositionPercent = parseFloat(process.env.MAX_POSITION_SIZE_PCT) || 0.01;
    
    const tradeConfidence = decision.confidence || 0.5;
    // Linear scale: confidence 0.5 → multiplier 0.5, confidence 1.0 → multiplier 2.5
    const confidenceMultiplier = Math.max(0.5, Math.min(2.5, 
      0.5 + (tradeConfidence - 0.5) * 4.0
    ));
    basePositionPercent = basePositionPercent * confidenceMultiplier;
    
    console.log(`📏 Confidence sizing: ${(tradeConfidence * 100).toFixed(0)}% → ${confidenceMultiplier.toFixed(1)}x → ${(basePositionPercent * 100).toFixed(2)}% of balance`);

This works WITH the existing confluence sizing from the orchestrator.
Orchestrator outputs sizingMultiplier based on HOW MANY strategies agree.
This new code scales based on HOW CONFIDENT the winning strategy is.
They multiply together: 75% confidence (1.5x) × 3 strategies agree (2.0x) = 3.0x.

DO NOT DELETE the orchestrator's sizingMultiplier — it still applies later
at line ~2846. These stack.


████████████████████████████████████████████████████████████████████████████████
█ CHANGE 5: MAX HOLD ANALYSIS EXIT — Turn Data Loss Into Data                █
████████████████████████████████████████████████████████████████████████████████

FILE: core/ExitContractManager.js — checkExitConditions() method

CURRENT PROBLEM:
  33% of trades exit at max_hold. That's 1 in 3 trades where the TP and SL
  NEVER triggered. These trades just sat there oscillating until the clock
  ran out. Most are small winners or small losers.

  max_hold is supposed to be a safety net, not the primary exit.
  If it's triggering 33% of the time, the TP and SL are wrong (too tight
  for TP, too tight for SL to not trigger first on losers).

  Change 1 (wider exits) should reduce max_hold exits. But we also need
  to tag them for analysis.

FIND the max_hold exit check. It probably looks like:

    if (holdTimeMinutes >= maxHold) {
      return { shouldExit: true, reason: 'max_hold', ... };
    }

ADD P&L context to the max_hold exit reason:

    if (holdTimeMinutes >= maxHold) {
      const holdExitType = pnlPercent > 0 ? 'max_hold_winner' : 'max_hold_loser';
      return { 
        shouldExit: true, 
        reason: holdExitType,
        details: `Max hold ${maxHold}min reached: P&L ${pnlPercent.toFixed(2)}% (${holdExitType})`
      };
    }

This splits max_hold into 'max_hold_winner' and 'max_hold_loser' in the
BacktestRecorder output. After the next backtest, we can see:
  - If most max_hold are winners → TP is too tight, widen it more
  - If most max_hold are losers → SL is too tight, OR entry was wrong
  - If it's 50/50 → max_hold is doing its job as a safety net


████████████████████████████████████████████████████████████████████████████████
█ EXECUTION ORDER                                                            █
████████████████████████████████████████████████████████████████████████████████

STEP 1: Apply Change 1 (exit contracts) — this is the biggest impact
STEP 2: Apply Change 2 (trailing activation) — same file, do together
STEP 3: Golden test on 3K data — compare to baseline

STEP 4: Apply Change 3 (confidence threshold)
STEP 5: Apply Change 4 (confidence sizing)
STEP 6: Golden test on 3K data — compare to Step 3 result

STEP 7: Apply Change 5 (max_hold tagging)
STEP 8: Run full 45K backtest
STEP 9: Report: trade count, win rate, net P&L, exit reason breakdown,
        average winner vs average loser, max_hold_winner vs max_hold_loser

COMMIT after Step 3 and Step 6 separately so we can see the impact
of exits vs entries independently.


████████████████████████████████████████████████████████████████████████████████
█ WHAT THIS DOES NOT CHANGE (intentionally)                                  █
████████████████████████████████████████████████████████████████████████████████

- NO new strategies added
- NO market-specific logic
- NO new indicators
- NO changes to the signal engine
- NO changes to the orchestrator strategy evaluation
- NO changes to pattern recognition
- NO changes to regime detection

This is PURELY: better exits, higher entry bar, smarter sizing.
The strategies stay the same. The signals stay the same.
We're just being PICKIER about which signals we trade,
and SMARTER about how we exit and size the ones we do take.

When we plug in stocks/forex/futures later, these same exits,
thresholds, and sizing rules apply. Only the fee structure
and exchange adapter change.

That's the whole point: tune the ENGINE, not the market.


████████████████████████████████████████████████████████████████████████████████
█ COMMIT MESSAGE                                                             █
████████████████████████████████████████████████████████████████████████████████

After Step 3:
git commit -m "tune: Widen exit contracts, add trailing activation

Exit contracts widened to achieve positive net R:R after 0.52% fees:
- Default TP: 0.75% → 2.0% (net after fees: +1.48%)
- Default SL: -0.45% → -1.0% (net after fees: -1.52%)
- Trail activation: NEW — don't trail until trade is up 0.8-1.5%
- Trail distance: 0.25% → 0.5-1.0% (match actual volatility)
- Max hold: extended to 150-360min (wider exits need more time)

Old net R:R after fees: 0.24:1 (needed 81% WR to profit)
New net R:R after fees: ~1:1 (needs 50% WR to profit)
Trend strategies (MarketRegime): 1.23:1 (needs 45% WR)"

After Step 6:
git commit -m "tune: Raise confidence threshold, add confidence sizing

Entry confidence: 35% → 50% (reject coin-flip signals)
Orchestrator floor: 25% → 35% (don't even evaluate garbage)
Position sizing: flat 1% → confidence-scaled 0.5x to 2.5x
  50% confidence = 0.5% of balance (minimum bet)
  75% confidence = 1.5% of balance (standard bet)
  90% confidence = 2.5% of balance (high conviction)
Max_hold tagged as winner/loser for analysis.

Fewer trades, higher quality, better sizing = the engine tuning."
