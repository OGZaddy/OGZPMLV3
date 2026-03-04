/**
 * OrderExecutor - Phase 14 Extraction
 *
 * EXACT COPY of executeTrade() from run-empire-v2.js
 * NO logic changes. Just moved to separate file.
 *
 * Dependencies passed via context object in constructor.
 *
 * @module core/OrderExecutor
 */

'use strict';

const { getInstance: getStateManager } = require('./StateManager');
const TradingConfig = require('./TradingConfig');
const exitContractManager = require('./ExitContractManager');
const FeatureFlagManager = require('./FeatureFlagManager');
const flagManager = FeatureFlagManager.getInstance();
const { TradingProofLogger } = require('../ogz-meta/claudito-logger');

const stateManager = getStateManager();

// BACKTEST_FAST: Skip notifications during backtest
const BACKTEST_FAST = process.env.BACKTEST_FAST === 'true';

class OrderExecutor {
  constructor(ctx) {
    // Store entire context - all dependencies from runner
    this.ctx = ctx;

    // Local state
    this.pendingTraiDecisions = ctx.pendingTraiDecisions || new Map();
    this.tradeExitCount = 0;

    console.log('[OrderExecutor] Initialized (Phase 14 - exact copy)');
  }

  /**
   * Execute a trade - EXACT COPY from run-empire-v2.js executeTrade()
   */
  // Phase 3 REWRITE: Renamed brainDecision → orchResult (orchestrator result)
  async executeTrade(decision, confidenceData, price, indicators, patterns, traiDecision = null, orchResult = null) {
    // REMOVED 2026-02-20: ExecutionRateLimiter was blocking 95% of trades in backtest
    // Rate limiting now handled by MIN_TRADE_CONFIDENCE threshold + position sizing

    // FIX 2026-02-28: Hard gate for BUY confidence - catches any leaky entry paths
    // This should NEVER trigger if makeTradeDecision is working correctly
    const MIN_BUY_CONFIDENCE = this.ctx.config.minTradeConfidence * 100; // 50% default
    if (decision.action === 'BUY' && decision.confidence < MIN_BUY_CONFIDENCE) {
      console.log(`🚨 [BUY BLOCKED] Confidence ${decision.confidence.toFixed(1)}% < ${MIN_BUY_CONFIDENCE}% threshold (LEAKY ENTRY PATH DETECTED!)`);
      return;
    }

    // FIX 2026-02-17: Dont exit on "no signal" (low confidence)
    // SELL requires: (1) high confidence SELL signal, (2) stop loss, or (3) profit target
    const MIN_SELL_CONFIDENCE = 30;
    const isStopLossExit = decision.exitReason === "stop_loss" || decision.exitReason === "trailing_stop" || decision.exitReason === "invalidation";
    // FIX 2026-02-23: Use startsWith for profit_tier (MaxProfitManager returns "profit_tier_1", "profit_tier_2", etc.)
    const isProfitExit = decision.exitReason?.startsWith("profit_tier") || decision.exitReason === "take_profit";
    const isEmergencyExit = decision.exitReason === "hard_stop" || decision.exitReason === "account_drawdown" || decision.confidence >= 70;
    const isTimeoutExit = decision.exitReason === "max_hold" || decision.exitReason === "max_hold_universal";
    if (decision.action === "SELL" && decision.confidence < MIN_SELL_CONFIDENCE) {
      if (!isStopLossExit && !isProfitExit && !isEmergencyExit && !isTimeoutExit) {
        console.log("[EXIT BLOCKED] Confidence " + decision.confidence.toFixed(1) + "% < " + MIN_SELL_CONFIDENCE + "% minimum");
        return;
      }
    }

    // Log allowed trade
    console.log("*** EXECUTE_TRADE_REACHED ***");
    console.log(`\n🎯 ${decision.action} SIGNAL @ $${price.toFixed(2)} | Confidence: ${decision.confidence.toFixed(1)}%`);

    // CHECKPOINT 1: Entry
    console.log(`📍 CP1: executeTrade ENTRY - Balance: $${stateManager.get('balance')}, Position: ${stateManager.get('position')}`);

    // FIXED: Use actual balance from StateManager, not stale systemState
    const currentBalance = stateManager.get('balance') || 10000;
    // CHANGE 2026-02-28: Use TradingConfig for position sizing
    let basePositionPercent = TradingConfig.get('positionSizing.maxPositionSize');

    // TUNE 2026-02-27: Confidence-scaled position sizing
    // 50% confidence = 0.5x, 75% = 1.5x, 90%+ = 2.5x (cap)
    const rawConfidence = decision.confidence;
    console.log('RAW confidence value:', rawConfidence); // Sanity check: is this 75 or 0.75?
    // decision.confidence comes as percentage (e.g., 75 = 75%), convert to decimal
    const tradeConfidence = (rawConfidence > 1 ? rawConfidence / 100 : rawConfidence) || 0.5;
    // Linear scale: confidence 0.5 → multiplier 0.5, confidence 1.0 → multiplier 2.5
    const confidenceMultiplier = Math.max(0.5, Math.min(2.5,
      0.5 + (tradeConfidence - 0.5) * 4.0
    ));
    basePositionPercent = basePositionPercent * confidenceMultiplier;
    console.log(`📏 Confidence sizing: ${(tradeConfidence * 100).toFixed(0)}% → ${confidenceMultiplier.toFixed(1)}x → ${(basePositionPercent * 100).toFixed(2)}% of balance`);

    // FIX 2026-02-02: AGGRESSIVE_LEARNING_MODE boosts position size while pattern bank builds
    const aggressiveLearning = flagManager.isEnabled('AGGRESSIVE_LEARNING_MODE');
    if (aggressiveLearning) {
      const multiplier = flagManager.getSetting('AGGRESSIVE_LEARNING_MODE', 'positionSizeMultiplier', 2.0);
      basePositionPercent = basePositionPercent * multiplier;
      console.log(`🔥 AGGRESSIVE LEARNING: Position size ${multiplier}x → ${(basePositionPercent * 100).toFixed(1)}%`);
    }
    const baseSizeUSD = currentBalance * basePositionPercent;

    // FIX 2025-12-27: Convert USD to BTC amount (was treating $500 as 500 BTC!)
    const positionSizeUSD = baseSizeUSD; // This is in USD
    const positionSizeBTC = positionSizeUSD / price; // Convert to BTC amount

    console.log(`💰 Position sizing: Balance=$${currentBalance.toFixed(2)}, Percent=${(basePositionPercent*100).toFixed(1)}%, USD=$${positionSizeUSD.toFixed(2)}, BTC=${positionSizeBTC.toFixed(8)}`);

    // CHANGE 2025-12-11: Pass 2 - Pattern-based position sizing
    const patternIds = decision.decisionContext?.patternsActive ||
                      patterns?.map(p => p.id || p.signature || 'unknown') || [];
    // Now pass BTC amount to calculatePositionSize, not USD
    const adjustedPositionBTC = this.ctx.tradingOptimizations.calculatePositionSize(positionSizeBTC, patternIds, decision.decisionContext);
    const positionSize = adjustedPositionBTC; // Final position size in BTC

    // CHECKPOINT 2: Position sizing
    console.log(`📍 CP2: Position size calculated: ${positionSize.toFixed(8)} BTC (base: ${positionSizeBTC.toFixed(8)} BTC, adjusted for pattern quality)`);

    // Change 587: SafetyNet DISABLED - too restrictive
    // Was blocking legitimate trades with overly conservative limits
    // We already have sufficient risk management through:
    // - RiskManager pre-trade validation
    // - TRAI veto power for risky trades
    // - MIN_TRADE_CONFIDENCE threshold (35%)
    // - Position sizing limits (1% per trade)

    try {
      // CHECKPOINT 3: Before ExecutionLayer call
      const usdAmount = positionSize * price;
      console.log(`📍 CP3: Calling ExecutionLayer.executeTrade with USD=$${usdAmount.toFixed(2)} (${positionSize.toFixed(8)} BTC)`);

      // Circuit breaker check before execution
      if (this.ctx.tradingBrain?.errorHandler?.isCircuitBreakerActive('ExecutionLayer')) {
        console.log('🚨 CIRCUIT BREAKER: Execution blocked due to repeated failures');
        console.log('   Error count:', this.ctx.tradingBrain.errorHandler.getErrorStatus());
        // Don't return - let's see what error occurs
        // return;
      }

      // ═══ PHASE 9 FIX: Gate checks BEFORE execution ═══
      // Previously gates ran AFTER executeTrade() - order was already on exchange!
      // Now gates block BEFORE any order is sent
      if (decision.action === 'BUY') {
        const entryDecision = this.ctx.entryDecider.decide(decision, {
          price,
          indicators,
          patterns,
          positionSize
        });

        if (!entryDecision.enter) {
          console.log(`⛔ [ENTRY GATE] BUY blocked BEFORE execution: ${entryDecision.reason}`);
          return;
        }
        console.log(`✅ [ENTRY GATE] All gates passed (risk: ${entryDecision.riskLevel})`);
      }

      // Generate decisionId for pattern attribution (join key to trai-decisions.log)
      const decisionId = decision.decisionId || `dec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

      const tradeResult = await this.ctx.executionLayer.executeTrade({
        direction: decision.action,
        positionSize: usdAmount,  // ExecutionLayer expects USD, not BTC!
        confidence: decision.confidence / 100,
        decisionId: decisionId,  // Pattern attribution join key
        marketData: {
          price,
          indicators,
          volatility: indicators.volatility,
          timestamp: Date.now()
        },
        patterns
      });

      // CHECKPOINT 4: After ExecutionLayer call
      console.log(`📍 CP4: ExecutionLayer returned:`, tradeResult ? `success=${tradeResult.success}` : 'NULL');

      if (tradeResult && tradeResult.success) {
        console.log(`📍 CP4.5: Trade SUCCESS confirmed, creating unified result`);
        // Change 588: Create unified tradeResult format
        const unifiedResult = {
          orderId: tradeResult.orderId || `SIM_${Date.now()}`,
          action: decision.action,
          entryPrice: price,
          entryTime: this.ctx.marketData?.timestamp || Date.now(),
          size: positionSize,
          confidence: decision.confidence,
          // CHANGE 648: Store full pattern objects with signatures for learning
          // BUGFIX 2026-02-01: Include features array for pattern outcome recording!
          // Without features, recordPatternResult at trade close fails with "empty features array"
          patterns: patterns?.map(p => ({
            name: p.name || p.type,
            signature: p.signature || p.id || `${p.name || p.type}_${Date.now()}`,
            confidence: p.confidence || 0,
            features: p.features || []  // CRITICAL: Required for pattern learning!
          })) || [],
          indicators: {
            rsi: indicators.rsi,
            macd: indicators.macd?.macd || 0,  // CHANGE 646: Fix property access - was ?.value
            macdSignal: indicators.macd?.signal || 0,
            trend: indicators.trend,
            volatility: indicators.volatility || 0
          }
        };

        console.log(`📍 CP4.6: Unified result created with orderId: ${unifiedResult.orderId}`);

        // FIX 2026-02-16: REMOVED redundant updateActiveTrade() call
        // openPosition() already adds trade to activeTrades atomically via updateState()
        // Having BOTH caused race condition: updateActiveTrade saved {position:0, activeTrades:[trade]}
        // before openPosition could update position, creating zombie trades
        // See: ZOMBIE-RACE-CONDITION-FIX.md in ledger
        if (false && decision.action === 'BUY') { // DISABLED - openPosition handles this
          console.log(`📍 CP4.7: About to call stateManager.updateActiveTrade (BUY only)`);
          try {
            stateManager.updateActiveTrade(unifiedResult.orderId, unifiedResult);
            console.log(`📍 CP4.8: updateActiveTrade completed successfully`);
          } catch (error) {
            console.error(`❌ CP4.8 ERROR: updateActiveTrade failed:`, error.message);
            console.error(`   Full error:`, error);
          }
        } else {
          console.log(`📍 CP4.7: SKIPPING updateActiveTrade for ${decision.action} (only BUY trades stored)`);
        }

        // FIX 2026-02-14: Store TRAI decision for learning feedback loop
        // Use _lastTraiDecision from async observer OR traiDecision param
        const traiDecisionToStore = traiDecision || this.ctx._lastTraiDecision;
        if (traiDecisionToStore && traiDecisionToStore.id && unifiedResult.orderId) {
          this.pendingTraiDecisions.set(unifiedResult.orderId, {
            decisionId: traiDecisionToStore.id,
            originalConfidence: traiDecisionToStore.originalConfidence,
            traiConfidence: traiDecisionToStore.traiConfidence,
            traiRecommendation: traiDecisionToStore.traiRecommendation,
            timestamp: Date.now()
          });
          this.ctx._lastTraiDecision = null;  // Clear after storing
          console.log(`📚 [TRAI] Decision stored for learning (orderId: ${unifiedResult.orderId})`);
        }
        // Update position tracking
        if (decision.action === 'BUY') {
          // ═══ PHASE 9: Gates moved to EntryDecider (BEFORE execution) ═══
          // Previously gates ran HERE (after order filled) - BUG!
          // Now handled by this.ctx.entryDecider.decide() before executionLayer.executeTrade()

          // CHECKPOINT 5: Before position update
          const stateBefore = stateManager.getState();
          console.log(`📍 CP5: BEFORE BUY - Position: ${stateBefore.position}, Balance: $${stateBefore.balance}`);

          // CHANGE 2025-12-11: Use StateManager for atomic position updates
          // CHANGE 2025-12-11 FIX: orderId was undefined - use unifiedResult.orderId
          // FIX 2026-02-02: Attach patterns + indicators for learning feedback at exit
          // CHANGE 2026-02-13: Attach signalBreakdown for comprehensive trade logging

          // CHANGE 2026-02-21: Use orchestrator's winning strategy and exit contract
          // The StrategyOrchestrator already determined the winner and created the exit contract
          // Phase 3 REWRITE: orchResult is now passed directly from TradingLoop
          const entryStrategy = orchResult?.winnerStrategy || 'default';
          const sizingMultiplier = orchResult?.sizingMultiplier || 1.0;

          // Use orchestrator's exit contract if provided, otherwise create fallback
          const exitContract = orchResult?.exitContract
            || exitContractManager.createExitContract(
                entryStrategy,
                { confidence: orchResult?.confidence || 0 },
                { volatility: indicators.volatility || 0 }
              );

          // Apply confluence-based position sizing
          const adjustedPositionSize = positionSize * sizingMultiplier;

          console.log(`[ORCHESTRATOR-ENTRY] Winner: ${entryStrategy} | Sizing: ${sizingMultiplier}x | SL=${exitContract.stopLossPercent}%, TP=${exitContract.takeProfitPercent}%`);

          const positionResult = await stateManager.openPosition(adjustedPositionSize, price, {
            orderId: unifiedResult.orderId,
            confidence: decision.confidence,
            patterns: patterns || [],  // Attach detected patterns for outcome learning
            entryIndicators: indicators,  // Attach indicators for feature vector reconstruction
            entryTime: this.ctx.marketData?.timestamp || Date.now(),  // FIX 2026-02-05: Use candle time in backtest
            signalBreakdown: orchResult?.signalBreakdown || null,  // Full decision reasoning
            bullishScore: orchResult?.bullishScore || 0,
            bearishScore: orchResult?.bearishScore || 0,
            reasoning: orchResult?.reasoning || '',
            // FIX 2026-02-17: Strategy-owned exit conditions
            entryStrategy: entryStrategy,
            exitContract: exitContract
          });

          // CHANGE 2025-12-12: Validate StateManager.openPosition() success
          if (!positionResult.success) {
            console.error('❌ StateManager.openPosition failed:', positionResult.error);
            // CHANGE 2025-12-13: Remove from StateManager (single source of truth)
            stateManager.removeActiveTrade(unifiedResult.orderId);
            return; // Abort trade
          }

          // CHANGE 2025-12-13: No longer sync to local balance - read from StateManager
          const stateAfter = stateManager.getState();

          // CHECKPOINT 6: After position update
          console.log(`📍 CP6: AFTER BUY - Position: ${stateAfter.position}, Balance: $${stateAfter.balance} (spent $${positionSize})`);

          // Change 605: Start MaxProfitManager on BUY to track profit targets
          this.ctx.tradingBrain.maxProfitManager.start(price, 'buy', positionSize, {
            volatility: indicators.volatility || 0,
            confidence: decision.confidence / 100,
            trend: indicators.trend || 'sideways'
          });
          console.log(`💰 MaxProfitManager started - tracking 1-2% profit targets`);

          // CHANGE 2026-02-01: Send Telegram notification for trade
          // BACKTEST_FAST: Skip notifications during backtest
          if (!BACKTEST_FAST) {
            this.ctx.notifyTrade({
              direction: 'BUY',
              asset: this.ctx.config.symbol || 'BTC',
              price: price,
              size: positionSize / stateAfter.balance,
              confidence: decision.confidence / 100
            }).catch(err => console.warn(`📱 Telegram notify failed: ${err.message}`));

            // CHANGE 2026-02-01: Re-enable Discord notifications (broken since v7)
            this.ctx.discordNotifier.notifyTrade('buy', price, positionSize);
          }

          // Start pattern exit tracking (shadow mode or active)
          if (this.ctx.patternExitModel) {
            const exitTracking = this.ctx.patternExitModel.startTracking({
              entryPrice: price,
              direction: 'buy',
              size: positionSize,
              patterns: patterns || [],
              confidence: decision.confidence / 100,
              entryTime: this.ctx.marketData?.timestamp || Date.now()
            });

            if (this.ctx.patternExitShadowMode) {
              console.log(`🕵️ [SHADOW] Pattern Exit Tracking Started:`);
              console.log(`   Pattern Target: ${(exitTracking.patternTarget * 100).toFixed(2)}%`);
              console.log(`   Pattern Stop: ${(exitTracking.patternStop * 100).toFixed(2)}%`);
            }
          }

          // CHANGE 642: Record BUY trade for backtest reporting
          // FIX 2026-02-17: Added entryStrategy and exitContract for strategy attribution analysis
          if (this.ctx.executionLayer && this.ctx.executionLayer.trades) {
            this.ctx.executionLayer.trades.push({
              timestamp: new Date().toISOString(),
              type: 'BUY',
              price: price,
              amount: positionSize,
              confidence: decision.confidence,
              balance: stateManager.get('balance'),  // CHANGE 2025-12-13: Read from StateManager
              entryStrategy: entryStrategy,  // FIX 2026-02-17: Strategy attribution
              exitContract: exitContract     // FIX 2026-02-17: Exit conditions for analysis
            });
          }

          // CHANGE 2026-01-23: Broadcast BUY trade to dashboard
          if (this.ctx.dashboardWsConnected && this.ctx.dashboardWs && this.ctx.dashboardWs.readyState === 1) {
            this.ctx.dashboardWs.send(JSON.stringify({
              type: 'trade',
              action: 'BUY',
              direction: 'long',
              price: price,
              pnl: 0,  // No P&L on entry
              timestamp: Date.now(),
              confidence: decision.confidence
            }));
            console.log(`📡 Broadcast BUY trade to dashboard at $${price.toFixed(2)}`);
          }

          // CHANGE 2026-01-25: Log trade for website proof
          TradingProofLogger.trade({
            action: 'BUY',
            symbol: this.ctx.tradingPair || 'BTC/USD',
            price: price,
            size: positionSize,
            value_usd: positionSize * price,
            fees: (positionSize * price) * 0.0032,  // ~0.32% Kraken fees
            reason: unifiedResult.patterns?.map(p => p.name).join(' + ') || 'Signal-based entry',
            confidence: decision.confidence,
            indicators: unifiedResult.indicators,
            pattern: unifiedResult.patterns?.[0]?.name || null
          });

        } else if (decision.action === 'SELL') {
          // CHECKPOINT 7: SELL execution
          const currentState = stateManager.getState();
          console.log(`📍 CP7: SELL PATH - Position: ${currentState.position}, Balance: $${currentState.balance}`);

          // Change 589: Complete post-trade integrations
          // Find the matching BUY trade
          // CHANGE 2025-12-13: Read from StateManager (single source of truth)
          const buyTrades = stateManager.getAllTrades()
            .filter(t => t.action === 'BUY')
            .sort((a, b) => a.entryTime - b.entryTime);

          // CHANGE 644: Add error handling for SELL with no matching BUY
          if (buyTrades.length === 0) {
            console.error('❌ CRITICAL: SELL signal but no matching BUY trade found!');
            console.log('   Current position:', currentState.position);
            // CHANGE 2025-12-13: Read from StateManager (single source of truth)
            const allTrades = stateManager.getAllTrades();
            console.log('   Active trades count:', allTrades.length);
            console.log('   Active trades:', allTrades.map(t => ({
              id: t.orderId,
              action: t.action,
              price: t.entryPrice
            })));

            // Force reset to prevent permanent lockup via StateManager
            console.log('   ⚠️ Force resetting position to 0 to prevent lockup');
            await stateManager.emergencyReset();
            // CHANGE 2025-12-13: No local balance sync needed

            // Stop MaxProfitManager if it's tracking
            if (this.ctx.tradingBrain?.maxProfitManager) {
              this.ctx.tradingBrain.maxProfitManager.reset();
            }
            return; // Exit early, don't process invalid SELL
          }

          if (buyTrades.length > 0) {
            const buyTrade = buyTrades[0];
            const pnl = ((price - buyTrade.entryPrice) / buyTrade.entryPrice) * 100;
            const exitTimestamp = this.ctx.marketData?.timestamp || Date.now();
            const holdDuration = exitTimestamp - buyTrade.entryTime;

            // Create complete trade result
            // FIX 2026-02-23: Use actual exitReason from decision (was hardcoded to 'signal')
            const completeTradeResult = {
              ...buyTrade,
              exitPrice: price,
              exitTime: exitTimestamp,
              pnl: pnl,
              pnlDollars: buyTrade.size * (price - buyTrade.entryPrice),  // BUGFIX 2026-02-01: BTC × price_diff = USD profit
              holdDuration: holdDuration,
              exitReason: decision.exitReason || 'signal'
            };

            // CHANGE 2026-02-23: Record trade in BacktestRecorder (with fees, running balance)
            if (this.ctx.backtestRecorder) {
              this.ctx.backtestRecorder.recordTrade({
                entryTime: buyTrade.entryTime ? new Date(buyTrade.entryTime).toISOString() : '',
                exitTime: exitTimestamp ? new Date(exitTimestamp).toISOString() : '',
                direction: 'long',
                entryPrice: buyTrade.entryPrice,
                exitPrice: price,
                stopLoss: buyTrade.exitContract?.stopLossPercent || 0,
                takeProfit: buyTrade.exitContract?.takeProfitPercent || 0,
                size: buyTrade.size || 1,
                strategyName: buyTrade.entryStrategy || 'unknown',
                confidence: buyTrade.confidence || 0,
                exitReason: completeTradeResult.exitReason || 'signal',
                reason: buyTrade.reason || '',
                holdTimeMinutes: holdDuration / 60000,
                exitContract: buyTrade.exitContract
              });
            }

            console.log(`📊 Trade closed: ${pnl >= 0 ? '✅' : '❌'} ${pnl.toFixed(2)}% | Hold: ${(holdDuration/60000).toFixed(1)}min`);

            // CHANGE 2025-12-11: Use StateManager for atomic position close
            const positionState = stateManager.getState();
            const btcPosition = positionState.position;  // BUGFIX 2026-02-01: This is BTC amount, not USD!

            // Close position via StateManager (handles P&L calculation)
            // FIX 2026-02-23: Wire partial close - use exitSize when present (tiered exits)
            const isPartialClose = decision.exitSize && decision.exitSize > 0 && decision.exitSize < 1;
            const partialSize = isPartialClose ? btcPosition * decision.exitSize : null;
            const closeResult = await stateManager.closePosition(price, isPartialClose, partialSize, {
              orderId: buyTrade.orderId,
              exitReason: decision.exitReason || 'signal'
            });

            // CHANGE 2025-12-12: Validate StateManager.closePosition() success
            if (!closeResult.success) {
              console.error('❌ StateManager.closePosition failed:', closeResult.error);
              return; // Abort close
            }

            // Get updated state after close
            // CHANGE 2025-12-13: No local balance sync needed - read from StateManager
            const afterSellState = stateManager.getState();

            // Calculate display values
            // BUGFIX 2026-02-01: btcPosition IS already in BTC, no division needed!
            const btcAmount = btcPosition;  // Already BTC, not USD
            const sellValue = btcAmount * price;  // BTC × current price = USD received
            const entryValue = btcAmount * buyTrade.entryPrice;  // BTC × entry price = USD spent
            const profitLoss = sellValue - entryValue;  // USD received - USD spent = profit
            console.log(`📍 CP8: SELL COMPLETE - New Balance: $${stateManager.get('balance')} (received $${sellValue.toFixed(2)}, P&L: $${profitLoss.toFixed(2)})`);

            // CHANGE 2026-02-01: Send notifications for trade close with P&L
            // BACKTEST_FAST: Skip notifications during backtest
            if (!BACKTEST_FAST) {
              this.ctx.notifyTradeClose({
                pnl: profitLoss,
                entryPrice: buyTrade.entryPrice,
                exitPrice: price,
                duration: `${Math.round((Date.now() - buyTrade.entryTime) / 60000)}m`
              }).catch(err => console.warn(`📱 Telegram notify failed: ${err.message}`));

              // CHANGE 2026-02-01: Re-enable Discord notifications for SELL
              this.ctx.discordNotifier.notifyTrade('sell', price, btcAmount, profitLoss);
            }

            // CHANGE 642: Record SELL trade for backtest reporting
            // CHANGE 649: Add exit indicators for ML learning
            // FIX 2026-02-17: Added entryStrategy and exitContract for strategy attribution
            if (this.ctx.executionLayer && this.ctx.executionLayer.trades) {
              this.ctx.executionLayer.trades.push({
                timestamp: new Date().toISOString(),
                type: 'SELL',
                price: price,
                entryPrice: buyTrade.entryPrice,
                amount: sellValue,
                pnl: pnl,
                pnlDollars: completeTradeResult.pnlDollars,
                confidence: decision.confidence,
                balance: stateManager.get('balance'),
                holdDuration: holdDuration,
                // FIX 2026-02-17: Strategy attribution from entry
                entryStrategy: buyTrade.entryStrategy || 'unknown',
                exitContract: buyTrade.exitContract || null,
                // Entry indicators from BUY
                entryIndicators: buyTrade.indicators,
                // Exit indicators at SELL time
                exitIndicators: {
                  rsi: indicators.rsi,
                  macd: indicators.macd?.macd || 0,
                  macdSignal: indicators.macd?.signal || 0,
                  trend: indicators.trend,
                  volatility: indicators.volatility || 0
                },
                exitReason: completeTradeResult.exitReason || 'signal'
              });
            }

            // CHANGE 2026-01-23: Broadcast SELL trade to dashboard
            if (this.ctx.dashboardWsConnected && this.ctx.dashboardWs && this.ctx.dashboardWs.readyState === 1) {
              this.ctx.dashboardWs.send(JSON.stringify({
                type: 'trade',
                action: 'SELL',
                direction: 'short',
                price: price,
                pnl: completeTradeResult.pnlDollars,
                timestamp: Date.now(),
                duration: `${(holdDuration / 60000).toFixed(1)}m`,
                confidence: decision.confidence
              }));
              console.log(`📡 Broadcast SELL trade to dashboard at $${price.toFixed(2)} (P&L: $${completeTradeResult.pnlDollars.toFixed(2)})`);
            }

            // CHANGE 2026-01-25: Log trade for website proof
            TradingProofLogger.trade({
              action: 'SELL',
              symbol: this.ctx.tradingPair || 'BTC/USD',
              price: price,
              size: btcAmount,
              value_usd: sellValue,
              fees: sellValue * 0.0032,  // ~0.32% Kraken fees
              reason: completeTradeResult.exitReason || 'Signal exit',
              confidence: decision.confidence,
              indicators: { rsi: indicators.rsi, macd: indicators.macd?.macd || 0 },
              pattern: buyTrade.patterns?.[0]?.name || null
            });

            // Log P&L explanation for transparency
            TradingProofLogger.explanation({
              decision: 'SELL',
              plain_english: `Closed position at $${price.toFixed(2)} after ${(holdDuration/60000).toFixed(1)} minutes. ${pnl >= 0 ? 'Profit' : 'Loss'} of ${pnl.toFixed(2)}% ($${profitLoss.toFixed(2)}).`,
              factors: [
                `Entry: $${buyTrade.entryPrice.toFixed(2)}`,
                `Exit: $${price.toFixed(2)}`,
                `Hold time: ${(holdDuration/60000).toFixed(1)} min`,
                `RSI at exit: ${indicators.rsi?.toFixed(1) || 'N/A'}`
              ]
            });

            // 1. SafetyNet DISABLED - too restrictive
            // this.ctx.safetyNet.updateTradeResult(completeTradeResult);

            // 2. Record pattern outcome for learning
            // CHANGE 659: Pass features array for proper pattern matching
            // recordPatternResult REQUIRES features array, never pass signature string
            if (buyTrade.patterns && buyTrade.patterns.length > 0) {
              const pattern = buyTrade.patterns[0]; // Primary pattern object
              const patternSignature = pattern.signature || pattern.name;

              // CRITICAL: Ensure features is an array
              let featuresForRecording;
              if (Array.isArray(pattern.features)) {
                featuresForRecording = pattern.features;
              } else {
                console.warn('⚠️ Pattern features not an array in trade completion, creating fallback');
                // FIX 2026-02-01: Convert trend to numeric if string (bullish=1, bearish=-1, else=0)
                const entryTrend = buyTrade.entryIndicators?.trend;
                const trendNumeric = typeof entryTrend === 'string'
                  ? (entryTrend === 'bullish' || entryTrend === 'uptrend' ? 1 :
                     entryTrend === 'bearish' || entryTrend === 'downtrend' ? -1 : 0)
                  : (entryTrend || 0);
                // FIX 2026-02-25: 9-element vector matching EnhancedPatternRecognition
                // FIX 2026-02-26 P3: Match entry/EPR convention (rsi/100 = 0-1 range, was -1 to 1)
                const rsiNormalized = (buyTrade.entryIndicators?.rsi || 50) / 100;
                const macdDelta = (buyTrade.entryIndicators?.macd || 0) - (buyTrade.entryIndicators?.macdSignal || 0);
                featuresForRecording = [
                  rsiNormalized,                                    // [0] RSI normalized
                  macdDelta,                                        // [1] MACD delta
                  trendNumeric,                                     // [2] Trend -1/0/1
                  buyTrade.entryIndicators?.bbWidth || 0.02,        // [3] Bollinger width
                  buyTrade.entryIndicators?.volatility || 0.01,     // [4] Volatility
                  0.5,                                              // [5] Wick ratio default
                  0,                                                // [6] Price change default
                  0,                                                // [7] Volume change default
                  0                                                 // [8] Last direction default
                ];
              }

              // SAFE TEST MODE CHECK - Never corrupt patterns in test
              if (this.ctx.config.tradingMode !== 'TEST' && process.env.TEST_MODE !== 'true') {
                this.ctx.patternChecker.recordPatternResult(featuresForRecording, {
                  pnl: pnl,
                  holdDurationMs: holdDuration,  // Add temporal data
                  exitReason: completeTradeResult.exitReason || 'signal',
                  timestamp: Date.now()
                });
              } else if (this.ctx.config.tradingMode === 'TEST') {
                console.log('🧪 TEST MODE: Would record P&L pattern but SKIPPING - pattern base protected');
              }
              console.log(`🧠 Pattern learning: ${pattern.name} → ${pnl.toFixed(2)}%`);
            }

            // FIX 2026-02-26: Run health check every 10 trade exits to detect broken pattern recording
            this.tradeExitCount = (this.tradeExitCount || 0) + 1;
            if (this.tradeExitCount % 10 === 0 && this.ctx.patternChecker?.memory) {
              const health = this.ctx.patternChecker.memory.healthCheck();
              if (!health.healthy) {
                console.error('🚨 PATTERN SYSTEM UNHEALTHY - outcomes not recording correctly!');
              }
            }

            // 3. Update PerformanceAnalyzer (using processTrade, not recordTrade)
            this.ctx.performanceAnalyzer.processTrade(completeTradeResult);

            // 3.5 CHANGE 2026-02-14: Wire RiskManager trade tracking (was NEVER CALLED)
            // Updates daily/weekly/monthly loss limits, drawdown, streaks, recovery mode
            if (this.ctx.riskManager) {
              this.ctx.riskManager.recordTradeResult({
                success: pnl >= 0,
                pnl: completeTradeResult.pnlDollars || 0
              });
            }

            // 4. CHANGE 2026-02-13: Re-enable TradeLogger with comprehensive breakdown
            try {
              this.ctx.logTrade({
                // Basic trade info
                type: completeTradeResult.action || 'BUY',
                entryPrice: buyTrade.entryPrice || buyTrade.price,
                exitPrice: price,
                currentPrice: price,
                size: buyTrade.size,

                // Financial results
                pnl: completeTradeResult.pnlDollars || 0,
                pnlPercent: pnl || 0,
                fees: (buyTrade.size * price) * 0.0052,  // FIX 2026-02-25: Actual round-trip fees (0.26% * 2)

                // Timing
                entryTime: new Date(buyTrade.entryTime).toISOString(),
                exitTime: new Date().toISOString(),
                holdTime: holdDuration,

                // Account
                balanceBefore: stateManager.get('balance') - (completeTradeResult.pnlDollars || 0),
                balanceAfter: stateManager.get('balance'),

                // Technical indicators at entry
                rsi: buyTrade.entryIndicators?.rsi || buyTrade.indicators?.rsi || 0,
                macd: buyTrade.entryIndicators?.macd?.macd || buyTrade.indicators?.macd || 0,
                macdSignal: buyTrade.entryIndicators?.macd?.signal || buyTrade.indicators?.macdSignal || 0,
                trend: buyTrade.entryIndicators?.trend || buyTrade.indicators?.trend || 'unknown',
                volatility: buyTrade.entryIndicators?.volatility || buyTrade.indicators?.volatility || 0,

                // CHANGE 2026-02-13: Decision reasoning breakdown
                confidence: buyTrade.confidence || 0,
                signalBreakdown: buyTrade.signalBreakdown || null,
                bullishScore: buyTrade.bullishScore || 0,
                bearishScore: buyTrade.bearishScore || 0,
                entryReason: buyTrade.reasoning || 'no reason stored',

                // Exit analysis
                exitReason: completeTradeResult.exitReason || 'signal',
                exitIndicators: {
                  rsi: indicators.rsi,
                  macd: indicators.macd?.macd || 0,
                  macdSignal: indicators.macd?.signal || 0,
                  trend: indicators.trend,
                  volatility: indicators.volatility || 0
                },

                // Pattern data
                patternType: buyTrade.patterns?.[0]?.name || null,
                patternConfidence: buyTrade.patterns?.[0]?.confidence || 0,

                // Risk management
                positionSize: buyTrade.size * buyTrade.entryPrice,
                riskPercent: (Math.abs(completeTradeResult.pnlDollars || 0) / (stateManager.get('balance') || 1)) * 100,

                // Session context
                totalTrades: stateManager.get('tradeCount') || 0,
                winRate: this.ctx.performanceAnalyzer?.getWinRate?.() || 0
              });
            } catch (logErr) {
              console.warn(`⚠️ TradeLogger error: ${logErr.message}`);
            }

            // 5. TRAI learning — feed PatternMemoryBank for promotion/quarantine
            // FIX 2026-02-14: Pass complete trade object matching PatternMemoryBank schema
            // recordTradeOutcome() takes ONE arg. extractPattern() needs .indicators and .trend
            if (this.ctx.trai && this.pendingTraiDecisions?.has(buyTrade.orderId)) {
              const traiDecisionData = this.pendingTraiDecisions.get(buyTrade.orderId);
              this.ctx.trai.recordTradeOutcome({
                tradeId: buyTrade.orderId,
                decisionId: traiDecisionData.decisionId,
                symbol: this.ctx.tradingPair || 'BTC-USD',
                profitLoss: profitLoss,
                profitLossPercent: pnl,
                holdDuration: holdDuration,
                entry: {
                  price: buyTrade.entryPrice || buyTrade.price,
                  timestamp: buyTrade.entryTime,
                  indicators: {
                    rsi: buyTrade.entryIndicators?.rsi || 50,
                    macd: buyTrade.entryIndicators?.macd?.macd || buyTrade.entryIndicators?.macd || 0,
                    macdHistogram: buyTrade.entryIndicators?.macd?.histogram || 0,
                    primaryPattern: buyTrade.patterns?.[0]?.name || 'none'
                  },
                  trend: buyTrade.entryIndicators?.trend || 'neutral',
                  volatility: buyTrade.entryIndicators?.volatility || 0
                },
                exit: {
                  price: price,
                  timestamp: Date.now(),
                  indicators: {
                    rsi: indicators.rsi,
                    macd: indicators.macd?.macd || 0,
                    macdHistogram: indicators.macd?.histogram || 0
                  },
                  trend: indicators.trend || 'neutral'
                },
                indicators: {
                  rsi: buyTrade.entryIndicators?.rsi || 50,
                  macd: buyTrade.entryIndicators?.macd?.macd || buyTrade.entryIndicators?.macd || 0,
                  macdHistogram: buyTrade.entryIndicators?.macd?.histogram || 0,
                  primaryPattern: buyTrade.patterns?.[0]?.name || 'none'
                },
                trend: buyTrade.entryIndicators?.trend || 'neutral',
                volatility: buyTrade.entryIndicators?.volatility || 0,
                traiConfidence: traiDecisionData.traiConfidence,
                originalConfidence: traiDecisionData.originalConfidence
              });
              this.pendingTraiDecisions.delete(buyTrade.orderId);
              console.log(`🤖 [TRAI] Learning from ${pnl >= 0 ? 'WIN' : 'LOSS'}: ${pnl.toFixed(2)}% ($${profitLoss.toFixed(2)})`);
            }
            // Clean up active trade
            // CHANGE 2025-12-13: Remove from StateManager (single source of truth)
            stateManager.removeActiveTrade(buyTrade.orderId);
          }

          // CHANGE 645: Reset MaxProfitManager after successful SELL
          if (this.ctx.tradingBrain?.maxProfitManager) {
            this.ctx.tradingBrain.maxProfitManager.reset();
            console.log(`💰 MaxProfitManager deactivated - ready for next trade`);
          }

          // Stop pattern exit tracking
          if (this.ctx.patternExitModel) {
            // FIX: closeResult might not exist - use pnl if available
            const pnlValue = typeof pnl !== 'undefined' ? pnl : 0;
            this.ctx.patternExitModel.stopTracking({
              pnl: pnlValue,
              exitReason: 'manual_sell'
            });
            if (this.ctx.patternExitShadowMode) {
              console.log(`🕵️ [SHADOW] Pattern Exit tracking stopped`);
            }
          }

          // Position already reset via stateManager.closePosition() above
        }

        // Record in performance analyzer
        const performanceData = {
          type: decision.action,
          price,
          size: positionSize,
          confidence: decision.confidence,
          timestamp: Date.now(),
          result: tradeResult
        };

        this.ctx.performanceAnalyzer.processTrade(performanceData);

        // CHANGE 650: REMOVED DUPLICATE TRAI STORAGE - Already properly stored at line 853-861
        // This was overwriting the complete data with incomplete data

        console.log(`✅ ${decision.action} executed: ${tradeResult.orderId || 'SIMULATED'} | Size: $${positionSize.toFixed(2)}\n`);
      } else {
        console.log(`⛔ Trade blocked: ${tradeResult?.reason || 'Risk limits'}\n`);
      }

    } catch (error) {
      console.error(`❌ Trade execution failed at checkpoint between CP3 and CP4`);
      console.error(`   Error message: ${error.message}`);
      console.error(`   Stack trace:`, error.stack);
      console.error(`   Decision: ${decision?.action}, Confidence: ${decision?.confidence}`);
      console.error(`   Position size: ${positionSize}`);

      // Report error to circuit breaker
      if (this.ctx.tradingBrain?.errorHandler) {
        console.log(`   Reporting to error handler (circuit breaker will increment)`);
        this.ctx.tradingBrain.errorHandler.reportCritical('ExecutionLayer', error, {
          decision: decision.action,
          confidence: decision.confidence,
          positionSize
        });
      }
    }
  }
}

module.exports = OrderExecutor;
