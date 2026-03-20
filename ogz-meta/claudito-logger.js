#!/usr/bin/env node

/**
 * claudito-logger.js
 * Real-time console logging for Claudito system + Trading proof
 *
 * Per ogz-meta specs:
 * - 04_guardrails-and-rules.md: "All decisions must be logged"
 * - 04_guardrails-and-rules.md: "All errors must be logged"
 * - 04_guardrails-and-rules.md: "No silent exits EVER"
 * - telemetry.md: Track patterns, bugs, time metrics
 * - scribe.md: Document everything in real-time
 */

const fs = require('fs');
const path = require('path');

// Log file paths
const LOGS_DIR = path.join(__dirname, 'logs');
const CLAUDITO_LOG = path.join(LOGS_DIR, 'claudito-activity.jsonl');
const TRADING_PROOF_LOG = path.join(LOGS_DIR, 'trading-proof.jsonl');

// Live proof output for website (public folder)
const PUBLIC_PROOF_DIR = path.join(__dirname, '..', 'public', 'proof');
const LIVE_TRADES_FILE = path.join(PUBLIC_PROOF_DIR, 'live-trades.json');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Format timestamp for console output
 */
function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * CLAUDITO LOGGER
 * Real-time console + file logging for Claudito system
 */
const ClauditoLogger = {
  /**
   * Log hook emission (per CLAUDITO-DOSSIERS.md hook system)
   */
  hook(command, state, details = {}) {
    const entry = {
      type: 'HOOK',
      timestamp: new Date().toISOString(),
      command,
      state,
      ...details
    };

    // Console output
    console.log(`[${timestamp()}] 🔗 HOOK: ${command} → state: ${state}`);
    if (details.result) console.log(`   └─ Result: ${details.result}`);
    if (details.next) console.log(`   └─ Next: ${details.next}`);

    // File output
    fs.appendFileSync(CLAUDITO_LOG, JSON.stringify(entry) + '\n');
  },

  /**
   * Log Claudito decision (per guardrails: "All decisions must be logged")
   */
  decision(claudito, action, reason, confidence = null) {
    const entry = {
      type: 'DECISION',
      timestamp: new Date().toISOString(),
      claudito,
      action,
      reason,
      confidence
    };

    // Console output
    const confStr = confidence !== null ? ` (${confidence}% conf)` : '';
    console.log(`[${timestamp()}] 🤖 ${claudito.toUpperCase()}: ${action}${confStr}`);
    console.log(`   └─ Reason: ${reason}`);

    // File output
    fs.appendFileSync(CLAUDITO_LOG, JSON.stringify(entry) + '\n');
  },

  /**
   * Log error (per guardrails: "All errors must be logged")
   */
  error(claudito, error, context = {}) {
    const entry = {
      type: 'ERROR',
      timestamp: new Date().toISOString(),
      claudito,
      error: error.message || error,
      stack: error.stack,
      context
    };

    // Console output (always visible)
    console.error(`[${timestamp()}] ❌ ERROR in ${claudito}: ${error.message || error}`);
    if (context.file) console.error(`   └─ File: ${context.file}`);

    // File output
    fs.appendFileSync(CLAUDITO_LOG, JSON.stringify(entry) + '\n');
  },

  /**
   * Log telemetry metrics (per telemetry.md)
   */
  metrics(data) {
    const entry = {
      type: 'METRICS',
      timestamp: new Date().toISOString(),
      ...data
    };

    // Console output
    console.log(`[${timestamp()}] 📊 METRICS:`);
    if (data.patterns_detected !== undefined) console.log(`   └─ Patterns: ${data.patterns_detected} detected, ${data.patterns_saved || 0} saved`);
    if (data.bugs_fixed !== undefined) console.log(`   └─ Bugs: ${data.bugs_fixed} fixed`);
    if (data.duration_ms !== undefined) console.log(`   └─ Duration: ${data.duration_ms}ms`);

    // File output
    fs.appendFileSync(CLAUDITO_LOG, JSON.stringify(entry) + '\n');
  },

  /**
   * Log mission status (per scribe.md format)
   */
  mission(missionId, status, details = {}) {
    const entry = {
      type: 'MISSION',
      timestamp: new Date().toISOString(),
      missionId,
      status,
      ...details
    };

    // Console output
    const statusEmoji = {
      'started': '🚀',
      'in_progress': '🔄',
      'blocked': '🛑',
      'complete': '✅',
      'failed': '❌'
    };
    console.log(`[${timestamp()}] ${statusEmoji[status] || '📋'} MISSION ${missionId}: ${status.toUpperCase()}`);
    if (details.clauditos) console.log(`   └─ Clauditos: ${details.clauditos.join(' → ')}`);
    if (details.fixes) console.log(`   └─ Fixes: ${details.fixes} applied`);

    // File output
    fs.appendFileSync(CLAUDITO_LOG, JSON.stringify(entry) + '\n');
  }
};

/**
 * TRADING PROOF LOGGER
 * Records every trade for website proof of profitability
 * Per transparency rules: "All signals must be understandable"
 */
const TradingProofLogger = {
  /**
   * Log trade execution
   */
  trade(data) {
    // Skip file logging in backtest mode to prevent EMFILE
    if (process.env.TEST_MODE === 'true' || process.env.BACKTEST_NO_PATTERN_SAVE === 'true') {
      return;
    }
    const entry = {
      type: 'TRADE',
      timestamp: new Date().toISOString(),
      action: data.action,           // BUY or SELL
      symbol: data.symbol,           // e.g., BTC/USD
      price: data.price,             // Execution price
      size: data.size,               // Position size
      value_usd: data.value_usd,     // Trade value in USD
      fees: data.fees,               // Trading fees
      reason: data.reason,           // Why this trade (plain English)
      confidence: data.confidence,   // AI confidence %
      indicators: data.indicators,   // Key indicators at time of trade
      pattern: data.pattern          // Pattern detected (if any)
    };

    // Console output
    const emoji = data.action === 'BUY' ? '🟢' : '🔴';
    console.log(`[${timestamp()}] ${emoji} TRADE: ${data.action} ${data.size} ${data.symbol} @ $${data.price}`);
    console.log(`   └─ Value: $${data.value_usd?.toFixed(2)} | Fees: $${data.fees?.toFixed(4)}`);
    console.log(`   └─ Reason: ${data.reason}`);
    console.log(`   └─ Confidence: ${data.confidence}%`);

    // File output
    fs.appendFileSync(TRADING_PROOF_LOG, JSON.stringify(entry) + '\n');

    // CHANGE 2026-01-29: Auto-publish to website for real-time proof
    this.publishLiveProof();
  },

  /**
   * Publish live proof to public folder for website transparency
   * CHANGE 2026-01-29: Real-time proof publishing
   */
  publishLiveProof() {
    try {
      // Ensure public proof directory exists
      if (!fs.existsSync(PUBLIC_PROOF_DIR)) {
        fs.mkdirSync(PUBLIC_PROOF_DIR, { recursive: true });
      }

      // Read recent entries from trading proof log
      if (!fs.existsSync(TRADING_PROOF_LOG)) {
        return; // No trades yet
      }

      const lines = fs.readFileSync(TRADING_PROOF_LOG, 'utf8').trim().split('\n');
      const entries = lines.slice(-100).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);

      // Extract trades only
      const trades = entries.filter(e => e.type === 'TRADE');
      const recentTrades = trades.slice(-20); // Last 20 trades

      // Calculate stats
      const sells = trades.filter(t => t.action === 'SELL');
      const totalTrades = sells.length;

      // Build live proof summary
      const liveProof = {
        updated: new Date().toISOString(),
        instance: 'ogz-prime-v2',
        env: process.env.PAPER_TRADING === 'true' ? 'PAPER' : 'LIVE',
        stats: {
          total_trades: totalTrades,
          last_24h_trades: trades.filter(t =>
            new Date(t.timestamp) > new Date(Date.now() - 24*60*60*1000)
          ).length,
          symbols_traded: [...new Set(trades.map(t => t.symbol))],
        },
        recent_trades: recentTrades.map(t => ({
          time: t.timestamp,
          action: t.action,
          symbol: t.symbol,
          price: t.price,
          value_usd: t.value_usd,
          reason: t.reason,
          confidence: t.confidence
        })),
        explanations: entries.filter(e => e.type === 'EXPLANATION').slice(-5).map(e => ({
          time: e.timestamp,
          decision: e.decision,
          summary: e.plain_english
        }))
      };

      // Write to public folder
      fs.writeFileSync(LIVE_TRADES_FILE, JSON.stringify(liveProof, null, 2));

    } catch (err) {
      // Fail silently - don't crash bot for proof publishing
      console.error(`[ProofLogger] Failed to publish live proof: ${err.message}`);
    }
  },

  /**
   * Log position update
   */
  position(data) {
    const entry = {
      type: 'POSITION',
      timestamp: new Date().toISOString(),
      symbol: data.symbol,
      size: data.size,
      entry_price: data.entry_price,
      current_price: data.current_price,
      pnl_percent: data.pnl_percent,
      pnl_usd: data.pnl_usd,
      hold_time_min: data.hold_time_min
    };

    // Console output
    const pnlEmoji = data.pnl_percent >= 0 ? '📈' : '📉';
    const pnlColor = data.pnl_percent >= 0 ? '+' : '';
    console.log(`[${timestamp()}] ${pnlEmoji} POSITION: ${data.symbol}`);
    console.log(`   └─ Entry: $${data.entry_price} → Current: $${data.current_price}`);
    console.log(`   └─ P&L: ${pnlColor}${data.pnl_percent?.toFixed(2)}% ($${pnlColor}${data.pnl_usd?.toFixed(2)})`);
    console.log(`   └─ Hold time: ${data.hold_time_min?.toFixed(1)} min`);

    // File output
    fs.appendFileSync(TRADING_PROOF_LOG, JSON.stringify(entry) + '\n');
  },

  /**
   * Log daily summary (for website proof)
   */
  dailySummary(data) {
    const entry = {
      type: 'DAILY_SUMMARY',
      timestamp: new Date().toISOString(),
      date: data.date,
      starting_balance: data.starting_balance,
      ending_balance: data.ending_balance,
      total_pnl_usd: data.total_pnl_usd,
      total_pnl_percent: data.total_pnl_percent,
      total_trades: data.total_trades,
      winning_trades: data.winning_trades,
      losing_trades: data.losing_trades,
      win_rate: data.win_rate,
      largest_win: data.largest_win,
      largest_loss: data.largest_loss,
      avg_hold_time: data.avg_hold_time
    };

    // Console output
    const pnlEmoji = data.total_pnl_usd >= 0 ? '✅' : '❌';
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[${timestamp()}] 📊 DAILY SUMMARY - ${data.date}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`   Balance: $${data.starting_balance?.toFixed(2)} → $${data.ending_balance?.toFixed(2)}`);
    console.log(`   ${pnlEmoji} P&L: $${data.total_pnl_usd >= 0 ? '+' : ''}${data.total_pnl_usd?.toFixed(2)} (${data.total_pnl_percent >= 0 ? '+' : ''}${data.total_pnl_percent?.toFixed(2)}%)`);
    console.log(`   Trades: ${data.total_trades} (${data.winning_trades}W / ${data.losing_trades}L)`);
    console.log(`   Win Rate: ${data.win_rate?.toFixed(1)}%`);
    console.log(`   Best: +$${data.largest_win?.toFixed(2)} | Worst: -$${Math.abs(data.largest_loss || 0)?.toFixed(2)}`);
    console.log(`${'='.repeat(60)}\n`);

    // File output
    fs.appendFileSync(TRADING_PROOF_LOG, JSON.stringify(entry) + '\n');
  },

  /**
   * Log decision explanation (per transparency: "TRAI must explain in plain English")
   */
  explanation(data) {
    const entry = {
      type: 'EXPLANATION',
      timestamp: new Date().toISOString(),
      decision: data.decision,
      plain_english: data.plain_english,
      factors: data.factors,
      confidence_breakdown: data.confidence_breakdown
    };

    // Console output
    console.log(`[${timestamp()}] 💭 DECISION EXPLANATION:`);
    console.log(`   └─ Decision: ${data.decision}`);
    console.log(`   └─ Why: ${data.plain_english}`);
    if (data.factors) {
      console.log(`   └─ Factors:`);
      data.factors.forEach(f => console.log(`      • ${f}`));
    }

    // File output
    fs.appendFileSync(TRADING_PROOF_LOG, JSON.stringify(entry) + '\n');
  }
};

// Export for use in other modules
module.exports = {
  ClauditoLogger,
  TradingProofLogger,
  // Convenience exports
  logHook: ClauditoLogger.hook,
  logDecision: ClauditoLogger.decision,
  logError: ClauditoLogger.error,
  logMetrics: ClauditoLogger.metrics,
  logMission: ClauditoLogger.mission,
  logTrade: TradingProofLogger.trade,
  logPosition: TradingProofLogger.position,
  logDailySummary: TradingProofLogger.dailySummary,
  logExplanation: TradingProofLogger.explanation
};

// CLI test
if (require.main === module) {
  console.log('🧪 Testing Claudito Logger...\n');

  // Test Claudito logging
  ClauditoLogger.hook('/fixer', 'FIX_APPLIED', { result: 'success', next: '/debugger' });
  ClauditoLogger.decision('forensics', 'AUDIT_COMPLETE', 'Found 3 issues in pattern memory', 95);
  ClauditoLogger.metrics({ patterns_detected: 47, patterns_saved: 45, bugs_fixed: 2, duration_ms: 1500 });
  ClauditoLogger.mission('MISSION-123456', 'in_progress', { clauditos: ['forensics', 'fixer', 'debugger'], fixes: 2 });

  console.log('\n🧪 Testing Trading Proof Logger...\n');

  // Test Trading logging
  TradingProofLogger.trade({
    action: 'BUY',
    symbol: 'BTC/USD',
    price: 88500.50,
    size: 0.001,
    value_usd: 88.50,
    fees: 0.28,
    reason: 'RSI oversold + bullish divergence + support bounce',
    confidence: 72,
    indicators: { rsi: 28, macd: 'bullish_cross' },
    pattern: 'double_bottom'
  });

  TradingProofLogger.position({
    symbol: 'BTC/USD',
    size: 0.001,
    entry_price: 88500.50,
    current_price: 88750.00,
    pnl_percent: 0.28,
    pnl_usd: 0.25,
    hold_time_min: 5.5
  });

  TradingProofLogger.explanation({
    decision: 'BUY',
    plain_english: 'Price hit strong support at $88,500 with oversold RSI. Historical pattern shows 73% bounce probability.',
    factors: ['RSI at 28 (oversold)', 'Price at daily support', 'Volume spike on bounce', 'MACD bullish crossover'],
    confidence_breakdown: { technical: 75, pattern: 70, volume: 65 }
  });

  TradingProofLogger.dailySummary({
    date: new Date().toISOString().split('T')[0],
    starting_balance: 10000,
    ending_balance: 10150,
    total_pnl_usd: 150,
    total_pnl_percent: 1.5,
    total_trades: 8,
    winning_trades: 5,
    losing_trades: 3,
    win_rate: 62.5,
    largest_win: 85,
    largest_loss: 35,
    avg_hold_time: 12.5
  });

  console.log('\n✅ Logger test complete. Check ogz-meta/logs/ for output files.');
}
