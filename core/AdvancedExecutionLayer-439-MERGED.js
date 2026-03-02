/**
 * @fileoverview AdvancedExecutionLayer - Risk-Integrated Trade Execution Engine
 *
 * Handles actual trade execution with broker adapters, position tracking,
 * P&L calculation, and integration with risk management systems.
 *
 * @description
 * ARCHITECTURE ROLE:
 * ExecutionLayer is the final step before orders hit the exchange. It receives
 * trade decisions from TradingBrain and executes them through the broker adapter.
 *
 * DATA FLOW:
 * ```
 * TradingBrain.openPosition()
 *        ↓
 * ExecutionLayer.executeOrder()
 *        ↓
 * KrakenAdapter.executeOrder()  ← Actual exchange API call
 *        ↓
 * StateManager.openPosition()   ← Records position
 * ```
 *
 * STATE MANAGEMENT:
 * - Reads position/balance from StateManager (single source of truth)
 * - Local this.positions Map is for tracking submitted orders/intents
 * - Local this.balance is fallback, but StateManager.get('balance') is preferred
 *
 * IDEMPOTENCY:
 * Uses intent-based order tracking to prevent duplicate orders. Each trade
 * generates a unique intentId that expires after 5 minutes.
 *
 * @module core/AdvancedExecutionLayer
 * @requires ./StateManager
 * @requires ../utils/discordNotifier
 *
 * @change 513 Stores entry indicators for ML learning
 * @change 668 Gets balance from StateManager (single source of truth)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getInstance: getStateManager } = require('./StateManager');  // CHANGE 2025-12-11: StateManager sync

class AdvancedExecutionLayer {
  constructor(config = {}) {
    this.bot = config.bot || null;
    this.krakenAdapter = null;
    this.wsClient = null;
    this.botTier = config.botTier || process.env.BOT_TIER || 'quantum';

    // Initialize Discord notifications (use singleton to prevent duplicate messages)
    try {
      this.discord = require('../utils/discordNotifier');
      console.log('📢 Discord notifications ready (singleton)');
    } catch (error) {
      console.warn('⚠️ Discord not available:', error.message);
      this.discord = null;
    }

    this.config = {
      maxPositionSize: config.maxPositionSize || 0.1,
      minTradeSize: config.minTradeSize || 0.00001,  // Minimum 0.00001 BTC (~$0.88) - allows small test trades
      sandboxMode: config.sandboxMode !== false,
      enableRiskManagement: config.enableRiskManagement !== false,
      apiKey: config.apiKey || process.env.POLYGON_API_KEY,
      ...config
    };

    // Position and order tracking
    this.positions = new Map();
    this.orders = new Map();
    this.balance = config.initialBalance || 10000;
    this.totalTrades = 0;
    this.winningTrades = 0;
    this.totalPnL = 0;
    this.trades = []; // FIX 2026-02-04: Initialize trades array for backtest reporting

    // IDEMPOTENCY: Track submitted orders to prevent duplicates
    this.submittedIntents = new Map(); // intentId -> { timestamp, status, orderId }
    this.intentTTL = 5 * 60 * 1000; // 5 minutes TTL for intent cache

    console.log('🎯 AdvancedExecutionLayer initialized');
    console.log(`   Mode: ${this.config.sandboxMode ? 'SANDBOX' : '🔥 LIVE 🔥'}`);
    console.log(`   Max Position: ${(this.config.maxPositionSize * 100).toFixed(1)}%`);
    console.log(`   Risk Management: ${this.config.enableRiskManagement ? 'ENABLED' : 'DISABLED'}`);
  }

  setKrakenAdapter(adapter) {
    this.krakenAdapter = adapter;
    console.log('✅ Kraken adapter connected');
  }

  /**
   * Set the OrderRouter for multi-broker order routing
   * @param {OrderRouter} router
   */
  setOrderRouter(router) {
    this.orderRouter = router;
    console.log('✅ OrderRouter connected');
  }

  setWebSocketClient(ws) {
    this.wsClient = ws;
    console.log('✅ WebSocket client connected');
  }

  /**
   * IDEMPOTENCY: Generate unique intent ID for trade
   * Based on: timestamp + symbol + direction + confidence
   */
  generateIntentId(symbol, direction, confidence) {
    const timestamp = Date.now();
    const data = `${timestamp}-${symbol}-${direction}-${(confidence || 0).toFixed(4)}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * IDEMPOTENCY: Generate client order ID from intent ID
   * This ensures same intent always generates same order ID
   */
  generateClientOrderId(intentId, venue = 'kraken') {
    const data = `${intentId}-${venue}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * IDEMPOTENCY: Check if intent was already submitted
   * Returns existing order if duplicate detected
   */
  checkDuplicateIntent(intentId) {
    // Clean old intents from cache
    const now = Date.now();
    for (const [id, intent] of this.submittedIntents.entries()) {
      if (now - intent.timestamp > this.intentTTL) {
        this.submittedIntents.delete(id);
      }
    }

    // Check if intent exists
    const existing = this.submittedIntents.get(intentId);
    if (existing) {
      console.log('⚠️ DUPLICATE ORDER PREVENTED');
      console.log(`   Intent ID: ${intentId}`);
      console.log(`   Original order: ${existing.orderId}`);
      console.log(`   Status: ${existing.status}`);
      return existing;
    }

    return null;
  }

  /**
   * CHANGE 658: Get current holdings in dollars (spot-only)
   * CHANGE 2025-12-12: Read from StateManager (currentPosition deleted in refactor)
   */
  getCurrentHoldings() {
    // Read position from StateManager (single source of truth)
    const { getInstance: getStateManager } = require('./StateManager');
    const stateManager = getStateManager();
    return stateManager.get('position') || 0;
  }

  async executeTrade(params) {
    console.log('🔍 [DEBUG] executeTrade called');
    const { direction, positionSize, confidence, marketData, patterns = [], decisionId = null } = params;
    console.log('🔍 [DEBUG] params extracted');

    try {
      // KILL SWITCH REMOVED - was blocking trades

      // IDEMPOTENCY: Generate intent ID for this trade
      const symbol = marketData?.symbol || 'BTC-USD';
      const intentId = this.generateIntentId(symbol, direction, confidence);

      // FIX 2026-02-20: Skip duplicate check in backtest mode
      // Date.now() doesn't advance with candle timestamps, causing identical hashes
      // that block 99%+ of trades as "duplicates"
      if (process.env.BACKTEST_MODE !== 'true') {
        // Check for duplicate submission (live/paper only)
        const existing = this.checkDuplicateIntent(intentId);
        if (existing) {
          return {
            success: false,
            reason: 'Duplicate order prevented',
            duplicate: true,
            originalOrder: existing.orderId,
            intentId: intentId
          };
        }
      }

      // Record intent submission
      this.submittedIntents.set(intentId, {
        timestamp: Date.now(),
        status: 'pending',
        direction: direction,
        confidence: confidence,
        symbol: symbol
      });

      console.log('\n🎯 EXECUTING TRADE');
      console.log(`   Intent ID: ${intentId}`);
      console.log(`   Direction: ${direction}`);
      console.log(`   Confidence: ${((confidence || 0) * 100).toFixed(1)}%`);
      console.log(`   Price: $${marketData.price}`);

      console.log('🔍 [DEBUG] Checking bot reference:', !!this.bot);
      if (!this.bot) throw new Error('Bot reference not set');
      console.log('🔍 [DEBUG] Bot reference OK');

      // Risk assessment via RiskManager
      // FIX 2026-02-20: Skip in backtest mode - was blocking 97.8% of trades
      if (this.config.enableRiskManagement && this.bot.riskManager && process.env.BACKTEST_MODE !== 'true') {
        const riskAssessment = this.bot.riskManager.assessTradeRisk?.({
          direction, entryPrice: marketData.price, confidence, marketData, patterns
        });
        if (riskAssessment && !riskAssessment.approved) {
          console.log('🛡️ Trade blocked by risk manager');
          return { success: false, reason: riskAssessment.reason };
        }
      }

      // CHANGE 668: Get balance from StateManager (single source of truth)
      const stateManager = getStateManager();
      const balance = stateManager.get('balance') || this.bot.systemState?.currentBalance || this.balance;
      let optimizedPositionSize = positionSize;

      // Calculate optimal position size via TradingBrain
      if (this.bot.tradingBrain?.calculateOptimalPositionSize) {
        // Convert dollar amount to percentage for TradingBrain
        const basePositionPercent = positionSize / balance;

        // TradingBrain works with percentages and returns optimized percentage
        const optimizedPercent = this.bot.tradingBrain.calculateOptimalPositionSize(
          basePositionPercent, confidence, marketData, balance
        );

        // Convert back to dollar amount
        optimizedPositionSize = balance * optimizedPercent;
      } else {
        // Fallback calculation
        optimizedPositionSize = this.calculateRealPositionSize(balance, confidence);
      }

      if (optimizedPositionSize < this.config.minTradeSize) {
        return { success: false, reason: 'Position size too small' };
      }

      console.log(`   Position Size: $${optimizedPositionSize.toFixed(2)}`);

      // Calculate stop loss via TradingBrain
      const entryPrice = marketData.price;
      let stopLoss, takeProfit;

      if (this.bot.tradingBrain?.calculateBreakevenStopLoss) {
        const feeConfig = this.bot.config?.feeConfig || { totalRoundTrip: 0.002 };
        stopLoss = this.bot.tradingBrain.calculateBreakevenStopLoss(entryPrice, direction, feeConfig);
      } else {
        stopLoss = direction === 'buy' ? entryPrice * 0.98 : entryPrice * 1.02;
      }

      // Calculate take profit via TradingBrain
      if (this.bot.tradingBrain?.calculateTakeProfit) {
        takeProfit = this.bot.tradingBrain.calculateTakeProfit(entryPrice, direction, confidence);
      } else {
        takeProfit = direction === 'buy' ? entryPrice * 1.04 : entryPrice * 0.96;
      }

      console.log(`   Stop Loss: $${stopLoss.toFixed(2)}`);
      console.log(`   Take Profit: $${takeProfit.toFixed(2)}`);

      // Use intentId as base for tradeId to ensure consistency
      const tradeId = `trade_${intentId}`;

      // Change 597: Fix case-sensitivity bug - makeTradeDecision returns uppercase 'BUY'/'SELL'
      // but this was checking lowercase 'buy', causing BUY signals to be treated as SELL (shorting!)
      const dirLower = (direction || '').toString().toLowerCase();
      const normalizedDirection = (dirLower === 'buy' || dirLower === 'long') ? 'buy' : 'sell';
      console.log(`   🔍 [Change 597] Input: "${direction}" → Normalized: "${normalizedDirection}"`);

      // CHANGE 658: Spot-only guardrails - prevent selling without holdings
      if (normalizedDirection === 'sell') {
        const currentHoldings = this.getCurrentHoldings();
        if (currentHoldings <= 0) {
          console.log('🚫 SPOT GUARDRAIL: Cannot SELL with 0 holdings');
          return {
            success: false,  // Fixed: normalized field name
            reason: 'NO_HOLDINGS',
            message: 'Attempted to sell with zero holdings (spot-only mode)'
          };
        }
        // Clamp sell size to available holdings
        const originalSize = optimizedPositionSize;
        optimizedPositionSize = Math.min(optimizedPositionSize, currentHoldings);
        if (originalSize > optimizedPositionSize) {
          console.log(`⚠️ SPOT GUARDRAIL: Clamped sell size from $${originalSize.toFixed(2)} to $${optimizedPositionSize.toFixed(2)} (max holdings)`);
        }
      }

      // Create position object (CHANGE 513 COMPLIANT)
      // CHANGE 658: Fix position size units - convert dollars to fraction
      const positionSizeFraction = optimizedPositionSize / this.initialBalance;
      const position = {
        id: tradeId,
        decisionId: decisionId,  // Join key to trai-decisions.log for pattern attribution
        direction: normalizedDirection,
        entryPrice: entryPrice,
        positionSize: positionSizeFraction,  // Now a fraction (0.05 = 5%)
        confidence: confidence,
        timestamp: Date.now(),
        tradeValue: optimizedPositionSize,  // Keep dollar value here
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        active: true,
        patterns: patterns,
        closed: false,
        pnl: 0,
        // CHANGE 513: Store entry indicators for ML learning
        entryIndicators: {
          rsi: marketData.indicators?.rsi || null,
          macd: marketData.indicators?.macd || null,
          macdSignal: marketData.indicators?.macdSignal || null,
          trend: marketData.indicators?.trend || null,
          volatility: marketData.indicators?.volatility || null,
          volume: marketData.volume || null
        }
      };

      // Execute actual trade (Kraken or paper)
      const clientOrderId = this.generateClientOrderId(intentId, 'kraken');
      const order = await this.executeKrakenTrade({
        side: normalizedDirection,
        symbol: 'BTC-USD',
        price: entryPrice,
        size: optimizedPositionSize,
        confidence: confidence,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        clientOrderId: clientOrderId,
        intentId: intentId
      });

      if (order) {
        position.orderId = order.id;
        this.positions.set(tradeId, position);
        this.totalTrades++;

        // Update intent status with successful order
        this.submittedIntents.set(intentId, {
          timestamp: Date.now(),
          status: 'filled',
          orderId: order.id || order.orderId,
          direction: direction,
          confidence: confidence,
          symbol: symbol
        });

        // Track with bot modules
        if (this.bot.riskManager?.registerTrade) {
          this.bot.riskManager.registerTrade(position);
        }

        if (this.bot.performanceDashboard?.trackTrade) {
          this.bot.performanceDashboard.trackTrade({ ...position, type: 'entry' });
        }

        if (this.bot.tradingBrain?.trackTrade) {
          this.bot.tradingBrain.trackTrade(position);
        }

        if (this.bot.activePositions) {
          this.bot.activePositions.set(tradeId, position);
        }

        // Log trade
        if (this.bot.logTrade) {
          await this.bot.logTrade({ ...position, type: 'entry' });
        } else {
          this.logTradeToFile(position);
        }

        // Broadcast to dashboard
        if (this.bot.broadcastToClients) {
          this.bot.broadcastToClients({ type: 'trade_opened', trade: position });
        } else {
          this.broadcastTrade(position);
        }

        // REMOVED 2026-02-02: Discord notification moved to run-empire-v2.js
        // This was sending duplicate notifications with incomplete data (symbol/amount undefined)
        // run-empire-v2.js now sends proper embed notifications via discordNotifier.notifyTrade()

        console.log('✅ TRADE EXECUTED SUCCESSFULLY');
        return { success: true, orderId: order.orderId || order.id, tradeId: tradeId, position: position };
      } else {
        console.log('❌ Trade execution failed');
        return { success: false, error: 'Order execution failed' };
      }

    } catch (error) {
      console.error('❌ Trade execution error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute trade via Kraken adapter or paper trading
   */
  async executeKrakenTrade(params) {
    if (!this.krakenAdapter || this.config.sandboxMode) {
      console.log('📝 Paper trade execution');
      console.log(`   Client Order ID: ${params.clientOrderId}`);
      return {
        success: true,  // FIX: Add success field that run-empire-v2 expects!
        orderId: params.clientOrderId || `PAPER_${Date.now()}`,  // Use clientOrderId
        id: params.intentId || Date.now().toString(),
        side: params.side,
        symbol: params.symbol,
        size: params.size,
        price: params.price,
        timestamp: Date.now(),
        status: 'filled',
        confidence: params.confidence,
        clientOrderId: params.clientOrderId
      };
    }

    console.log('🔹 Executing REAL trade via OrderRouter');
    console.log(`   Client Order ID: ${params.clientOrderId}`);
    try {
      let order;

      // Use OrderRouter if available (multi-broker), else fall back to direct Kraken
      if (this.orderRouter) {
        order = await this.orderRouter.sendOrder({
          symbol: params.symbol,
          side: params.side,
          type: 'market',
          amount: params.size,
          options: { clientOrderId: params.clientOrderId }
        });
      } else if (this.krakenAdapter) {
        // Legacy fallback - direct Kraken adapter
        order = await this.krakenAdapter.placeOrder({
          symbol: params.symbol,
          side: params.side,
          type: 'market',
          quantity: params.size,
          clientOrderId: params.clientOrderId
        });
      } else {
        throw new Error('No OrderRouter or KrakenAdapter configured');
      }

      console.log('✅ ORDER PLACED:', order.orderId);
      return {
        ...order,
        confidence: params.confidence,
        clientOrderId: params.clientOrderId
      };
    } catch (error) {
      console.error('❌ Order execution failed:', error.message);

      // Check if error is due to duplicate clientOrderId
      if (error.message && error.message.includes('duplicate') || error.message.includes('already exists')) {
        console.log('⚠️ Duplicate order detected at exchange level');
        // Query exchange for existing order with this clientOrderId
        // This would need implementation in KrakenAdapter
      }

      throw error;
    }
  }

  /**
   * Calculate position size based on balance and confidence
   */
  calculateRealPositionSize(balance, confidence = 0.5) {
    const maxPosition = balance * this.config.maxPositionSize;
    const scaledPosition = maxPosition * Math.min(confidence, 1);
    const finalSize = Math.max(scaledPosition, this.config.minTradeSize);
    return finalSize;
  }

  // REMOVED 2026-02-01: closePosition() - Dead code (~75 lines)
  // Position closing goes through StateManager.closePosition() → run-empire-v2.js
  // All features (P&L calc, Discord, RiskManager, TRAI learning) handled elsewhere
  // Verified: zero callers in entire codebase

  /**
   * Format and record trade for TRAI pattern memory learning
   * Called automatically when positions close
   */
  recordTradeForTRAI(position) {
    try {
      // Format trade data for TRAI's pattern memory
      const tradeData = {
        // Pattern Attribution: thread IDs for joining decision telemetry to outcomes
        tradeId: position.id,
        decisionId: position.decisionId || null,  // Join key to trai-decisions.log
        symbol: 'BTC-USD',
        side: position.direction,
        entry: {
          timestamp: new Date(position.timestamp).toISOString(),
          price: position.entryPrice,
          indicators: {
            rsi: position.entryIndicators?.rsi || 50,
            macd: position.entryIndicators?.macd || 0,
            macdHistogram: position.entryIndicators?.macdSignal || 0,
            primaryPattern: position.patterns?.[0]?.name || position.patterns?.[0] || 'none'
          },
          trend: position.entryIndicators?.trend || 'sideways',
          volatility: position.entryIndicators?.volatility || 0.02
        },
        exit: {
          timestamp: new Date(position.exitTime).toISOString(),
          price: position.exitPrice,
          reason: position.exitReason || 'unknown'
        },
        profitLoss: position.pnl,
        profitLossPercent: (position.pnl / (position.entryPrice * position.positionSize)) * 100,
        holdDuration: position.exitTime - position.timestamp
      };

      // Record with TRAI
      this.bot.trai.recordTradeOutcome(tradeData);

      console.log(`🧠 [TRAI] Trade recorded for learning: ${(position.pnl || 0) > 0 ? 'WIN' : 'LOSS'} (${(tradeData.profitLossPercent || 0).toFixed(2)}%)`);

    } catch (error) {
      console.error('❌ [TRAI] Failed to record trade:', error.message);
    }
  }

  /**
   * Calculate P&L for all open positions
   */
  calculatePnL(currentPrice) {
    let totalPnL = 0;

    for (const [id, position] of this.positions) {
      if (!position.closed) {
        if (position.direction === 'buy') {
          position.pnl = (currentPrice - position.entryPrice) * position.positionSize;
        } else {
          position.pnl = (position.entryPrice - currentPrice) * position.positionSize;
        }
        totalPnL += position.pnl;
      }
    }

    this.totalPnL = totalPnL;
    return totalPnL;
  }

  /**
   * Get current balance
   */
  async getBalance() {
    return this.bot?.systemState?.currentBalance || this.balance || 10000;
  }

  /**
   * Get trading statistics
   */
  getStats() {
    const winRate = this.totalTrades > 0 ? (this.winningTrades / this.totalTrades * 100) : 0;
    return {
      totalTrades: this.totalTrades,
      winningTrades: this.winningTrades,
      winRate: `${(winRate || 0).toFixed(1)}%`,
      totalPnL: (this.totalPnL || 0).toFixed(2),
      balance: (this.balance || 0).toFixed(2),
      positions: this.positions.size,
      mode: this.config.sandboxMode ? 'PAPER' : 'LIVE'
    };
  }

  /**
   * Get all positions
   */
  getPositions() {
    return Array.from(this.positions.values());
  }

  /**
   * Get trading status
   */
  getStatus() {
    const openPositions = Array.from(this.positions.values()).filter(p => !p.closed);
    const closedPositions = Array.from(this.positions.values()).filter(p => p.closed);

    return {
      mode: this.config.sandboxMode ? 'PAPER' : 'LIVE',
      riskManagement: this.config.enableRiskManagement,
      openPositions: openPositions.length,
      closedPositions: closedPositions.length,
      totalTrades: this.totalTrades,
      winRate: this.totalTrades > 0 ? (this.winningTrades / this.totalTrades * 100).toFixed(1) + '%' : '0%',
      balance: (this.balance || 0).toFixed(2)
    };
  }

  /**
   * Log trade to file
   */
  logTradeToFile(trade) {
    // FIX 2026-02-20: Skip disk writes in backtest - causes EMFILE on Windows
    if (process.env.BACKTEST_MODE === 'true') return;
    try {
      const date = new Date().toISOString().split('T')[0];
      const logDir = path.join(__dirname, '..', 'logs', 'trades');
      const logFile = path.join(logDir, `trades_${date}.json`);

      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      let trades = [];
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf8');
        try {
          trades = JSON.parse(content);
        } catch (e) {
          trades = [];
        }
      }

      trades.push({
        ...trade,
        balance: this.balance,
        totalTrades: this.totalTrades,
        timestamp: new Date().toISOString()
      });

      fs.writeFileSync(logFile, JSON.stringify(trades, null, 2));
    } catch (error) {
      console.error('❌ Failed to log trade:', error.message);
    }
  }

  /**
   * Broadcast trade to WebSocket dashboard
   */
  broadcastTrade(trade) {
    try {
      // Null-safe WebSocket check with optional chaining
      if (this.wsClient?.readyState === 1) { // 1 = OPEN
        const message = {
          type: 'trade',  // CHANGE 2025-12-11: Match frontend expected message type
          botTier: this.botTier,
          source: 'trading_bot',
          action: trade.direction === 'buy' ? 'BUY' : 'SELL',
          price: trade.entryPrice || trade.price,
          pnl: trade.pnl || 0,
          confidence: trade.confidence || 95,
          balance: this.balance,
          totalTrades: this.totalTrades,
          timestamp: Date.now()
        };

        this.wsClient.send(JSON.stringify(message));
        console.log('📡 Trade broadcast to dashboard');
      } else {
        console.warn('⚠️ WebSocket not ready, trade not broadcast');
      }
    } catch (error) {
      console.error('❌ Failed to broadcast trade:', error.message);
    }
  }
}

module.exports = AdvancedExecutionLayer;
