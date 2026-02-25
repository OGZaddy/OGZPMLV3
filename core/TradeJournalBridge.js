/**
 * ============================================================================
 * TradeJournalBridge v2 — Journal + Replay Auto-Wiring
 * ============================================================================
 *
 * Connects TradeJournal AND TradeReplayCapture to run-empire-v2.js without
 * modifying existing modules. It:
 *   1. Records every entry/exit in the journal ledger
 *   2. Captures candle context at entry/exit for visual replay
 *   3. On trade close: auto-saves replay + pushes "View Replay" to dashboard
 *   4. Handles all dashboard WebSocket requests for journal + replay data
 *   5. Broadcasts journal snapshots every 30s
 *   6. Provides HTTP API routes for /journal, /replay, /api/*
 *
 * INTEGRATION (add to run-empire-v2.js):
 * ```
 * const { TradeJournalBridge } = require('./core/TradeJournalBridge');
 * // In startBot() after all modules initialized:
 * this.journalBridge = new TradeJournalBridge(this);
 * ```
 *
 * @module core/TradeJournalBridge
 * @version 2.0.0
 */

const TradeJournal = require('./TradeJournal');
const TradeReplayCapture = require('./TradeReplayCapture');
const path = require('path');
const fs = require('fs');

class TradeJournalBridge {
  constructor(bot, config = {}) {
    this.bot = bot;

    // ── Initialize journal ──────────────────────────────────────────
    this.journal = new TradeJournal({
      dataDir: config.dataDir || path.join(process.cwd(), 'data', 'journal'),
      startingBalance: config.startingBalance || parseFloat(process.env.INITIAL_BALANCE || '10000'),
      ...config
    });

    // ── Initialize replay capture ───────────────────────────────────
    this.replay = new TradeReplayCapture({
      replayDir: config.replayDir || path.join(process.cwd(), 'data', 'journal', 'replays'),
      candlesBefore: 60,
      candlesAfter: 30
    });

    // ── Wire everything ─────────────────────────────────────────────
    this._wireTradeEvents();
    this._wireDashboardMessages();
    this._wireBroadcastCycle();

    console.log('📒 TradeJournalBridge v2: Journal + Replay wired into bot');
  }


  // ════════════════════════════════════════════════════════════════════════
  // TRADE EVENT WIRING
  // ════════════════════════════════════════════════════════════════════════

  _wireTradeEvents() {
    const bot = this.bot;
    const journal = this.journal;
    const replay = this.replay;
    const bridge = this;

    // ── Intercept trade ENTRIES ─────────────────────────────────────
    const originalExecuteTrade = bot.executeTrade.bind(bot);
    bot.executeTrade = async function(...args) {
      const result = await originalExecuteTrade(...args);

      try {
        const [decision, confidenceData, price, indicators, patterns] = args;
        const stateManager = bot.stateManager;
        const activeTrades = stateManager?.get('activeTrades') || new Map();
        const lastTradeId = activeTrades instanceof Map
          ? [...activeTrades.keys()].pop()
          : Object.keys(activeTrades).pop();
        const lastTrade = lastTradeId
          ? (activeTrades instanceof Map ? activeTrades.get(lastTradeId) : activeTrades[lastTradeId])
          : null;

        if (lastTrade && decision.action === 'BUY') {
          const regime = bot.regimeDetector?.detectRegime?.(bot.priceHistory);
          const entryData = {
            orderId: lastTrade.orderId || lastTradeId,
            direction: decision.action,
            entryPrice: lastTrade.entryPrice || price,
            size: lastTrade.size || 0,
            usdValue: (lastTrade.size || 0) * (lastTrade.entryPrice || price),
            confidence: confidenceData?.totalConfidence || decision.confidence || 0,
            regime: regime?.currentRegime || 'unknown',
            patterns: lastTrade.patterns || patterns || [],
            indicators: {
              rsi: indicators?.rsi || 0,
              macd: indicators?.macd?.macd || indicators?.macd || 0,
              trend: indicators?.trend || 'unknown',
              volatility: indicators?.volatility || 0
            },
            fees: 0
          };

          // Record in journal
          journal.recordEntry(entryData);

          // Capture candle context for replay
          replay.captureEntry(entryData.orderId, {
            price: entryData.entryPrice,
            direction: entryData.direction,
            confidence: entryData.confidence,
            regime: entryData.regime,
            patterns: entryData.patterns,
            indicators: entryData.indicators
          }, bot.priceHistory || []);
        }
      } catch (err) {
        console.warn(`📒 Bridge: Entry recording failed (non-critical): ${err.message}`);
      }

      return result;
    };

    // ── Intercept trade EXITS ───────────────────────────────────────
    const originalLogTrade = bot.logTrade?.bind(bot);
    if (originalLogTrade) {
      bot.logTrade = async function(exitRecord) {
        const result = await originalLogTrade(exitRecord);

        try {
          if (exitRecord && exitRecord.type === 'exit') {
            const stateManager = bot.stateManager;
            const balance = stateManager?.get('balance') || 0;
            const orderId = exitRecord.id || exitRecord.orderId;

            // Record in journal
            journal.recordExit({
              orderId,
              exitPrice: exitRecord.exitPrice || 0,
              reason: exitRecord.reason || 'unknown',
              pnl: exitRecord.pnl || 0,
              fees: 0,
              maxProfit: exitRecord.maxProfit || 0,
              holdTime: exitRecord.holdTime || 0,
              balance,
              direction: exitRecord.direction,
              entryPrice: exitRecord.entryPrice,
              size: exitRecord.size
            });

            // Capture candle context + save replay
            const replayPath = replay.captureExit(orderId, {
              price: exitRecord.exitPrice,
              exitPrice: exitRecord.exitPrice,
              entryPrice: exitRecord.entryPrice,
              reason: exitRecord.reason,
              pnl: exitRecord.pnl,
              pnlPercent: exitRecord.pnlPercent || 0,
              holdTime: exitRecord.holdTime,
              direction: exitRecord.direction,
              size: exitRecord.size
            }, bot.priceHistory || []);

            // ══════════════════════════════════════════════════════════
            // AUTO-EXPORT: Push trade closed + replay link to dashboard
            // ══════════════════════════════════════════════════════════
            bridge._pushTradeClosedNotification(orderId, exitRecord, replayPath);
          }
        } catch (err) {
          console.warn(`📒 Bridge: Exit recording failed (non-critical): ${err.message}`);
        }

        return result;
      };
    }
  }


  // ════════════════════════════════════════════════════════════════════════
  // TRADE CLOSED NOTIFICATION — Pushes "View Replay" to Dashboard
  // ════════════════════════════════════════════════════════════════════════

  _pushTradeClosedNotification(orderId, exitRecord, replayPath) {
    const pnl = exitRecord.pnl || 0;
    this._send({
      type: 'trade_closed_replay',
      data: {
        orderId,
        direction: exitRecord.direction || 'BUY',
        entryPrice: exitRecord.entryPrice || 0,
        exitPrice: exitRecord.exitPrice || 0,
        pnl,
        pnlPercent: exitRecord.pnlPercent || 0,
        reason: exitRecord.reason || 'unknown',
        holdTime: exitRecord.holdTime || 0,
        isWin: pnl >= 0,
        replayAvailable: !!replayPath,
        replayUrl: `/replay?id=${orderId}`,
        timestamp: Date.now()
      }
    });

    // Fresh snapshot so dashboard updates immediately
    this._sendJournalSnapshot();
    console.log(`📒 Trade closed → replay ${replayPath ? 'saved' : 'skipped'} → notification pushed`);
  }


  // ════════════════════════════════════════════════════════════════════════
  // DASHBOARD WEBSOCKET MESSAGE HANDLING
  // ════════════════════════════════════════════════════════════════════════

  _wireDashboardMessages() {
    const bridge = this;

    this.bot._journalMessageHandler = (msg) => {
      try {
        switch (msg.type) {
          case 'request_journal':         bridge._sendJournalSnapshot(); break;
          case 'request_journal_equity':  bridge._sendEquityCurve(); break;
          case 'request_journal_breakdowns': bridge._sendBreakdown(msg.dimension || 'regime'); break;
          case 'request_journal_calendar': bridge._sendCalendar(); break;
          case 'request_journal_export_csv': bridge._exportCSV(); break;
          case 'request_journal_export_report': bridge._exportReport(); break;
          case 'request_replay':          bridge._sendReplay(msg.orderId); break;
          case 'request_replay_list':     bridge._sendReplayList(msg.limit); break;
        }
      } catch (err) {
        console.warn(`📒 Bridge: Handler error: ${err.message}`);
      }
    };

    this._tryDirectWsHook();
  }

  _tryDirectWsHook() {
    const bot = this.bot;
    const handler = bot._journalMessageHandler;

    const hookCheck = setInterval(() => {
      if (bot.dashboardWs && bot.dashboardWs.readyState === 1) {
        bot.dashboardWs.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type && (msg.type.startsWith('request_journal') || msg.type.startsWith('request_replay'))) {
              handler(msg);
            }
          } catch { /* ignore */ }
        });
        clearInterval(hookCheck);
        console.log('📒 Bridge: Hooked into dashboard WebSocket');
      }
    }, 2000);
    setTimeout(() => clearInterval(hookCheck), 30000);
  }


  // ════════════════════════════════════════════════════════════════════════
  // BROADCAST
  // ════════════════════════════════════════════════════════════════════════

  _wireBroadcastCycle() {
    this._broadcastTimer = setInterval(() => {
      if (this.journal.trades.length > 0) this._sendJournalSnapshot();
    }, 30000);
  }


  // ════════════════════════════════════════════════════════════════════════
  // SEND HELPERS
  // ════════════════════════════════════════════════════════════════════════

  _send(payload) {
    try {
      if (this.bot.dashboardWs && this.bot.dashboardWsConnected) {
        this.bot.dashboardWs.send(JSON.stringify(payload));
      }
    } catch (err) {
      console.warn(`📒 Bridge: Send failed: ${err.message}`);
    }
  }

  _sendJournalSnapshot() {
    this._send({ type: 'journal_snapshot', data: this.journal.getSnapshot() });
  }

  _sendEquityCurve() {
    this._send({ type: 'journal_equity', data: this.journal.getEquityCurve(500) });
  }

  _sendBreakdown(dimension) {
    this._send({ type: 'journal_breakdown', data: this.journal.getPerformanceBreakdown(dimension), dimension });
  }

  _sendCalendar() {
    this._send({ type: 'journal_calendar', data: this.journal.getDailySummaries(90) });
  }

  _sendReplay(orderId) {
    if (!orderId) return;
    const data = this.replay.loadReplay(orderId);
    this._send(data ? { type: 'replay_data', data } : { type: 'replay_not_found', orderId });
  }

  _sendReplayList(limit = 50) {
    this._send({ type: 'replay_list', data: this.replay.listReplays(limit) });
  }

  _exportCSV() {
    try {
      const filepath = this.journal.exportCSV();
      this._send({ type: 'journal_export_complete', format: 'csv', path: filepath });
    } catch (err) { console.error(`📒 CSV export failed: ${err.message}`); }
  }

  _exportReport() {
    try {
      const report = this.journal.exportReport();
      const filepath = path.join(process.cwd(), 'data', 'journal', 'exports',
        `ogzprime-report-${new Date().toISOString().split('T')[0]}.json`);
      fs.mkdirSync(path.dirname(filepath), { recursive: true });
      fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf8');
      this._send({ type: 'journal_export_complete', format: 'json', path: filepath });
    } catch (err) { console.error(`📒 Report export failed: ${err.message}`); }
  }


  // ════════════════════════════════════════════════════════════════════════
  // HTTP ROUTES — Register with Express or raw HTTP
  // ════════════════════════════════════════════════════════════════════════

  registerRoutes(app) {
    const replay = this.replay;
    const journal = this.journal;

    app.get('/replay', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'trade-replay.html')));
    app.get('/journal', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'trade-journal.html')));

    app.get('/api/replay/adjacent', (req, res) => {
      const all = replay.listReplays(1000);
      const idx = all.findIndex(r => r.orderId === req.query.id);
      const target = idx + (parseInt(req.query.direction) || 1);
      res.json({ orderId: (target >= 0 && target < all.length) ? all[target].orderId : null });
    });

    app.get('/api/replay/:id', (req, res) => {
      const data = replay.loadReplay(req.params.id);
      data ? res.json(data) : res.status(404).json({ error: 'Replay not found' });
    });

    app.get('/api/replays', (req, res) => res.json(replay.listReplays(parseInt(req.query.limit) || 50)));
    app.get('/api/journal/stats', (req, res) => res.json(journal.getStats()));
    app.get('/api/journal/equity', (req, res) => res.json(journal.getEquityCurve(parseInt(req.query.limit) || 500)));
    app.get('/api/journal/breakdown/:dim', (req, res) => res.json(journal.getPerformanceBreakdown(req.params.dim)));

    console.log('📒 Bridge: HTTP routes registered (/journal, /replay, /api/*)');
  }

  /** Raw HTTP handler for non-Express servers */
  handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sendFile = (filePath) => {
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(filePath));
        return true;
      }
      return false;
    };
    const sendJSON = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return true;
    };

    if (url.pathname === '/journal') return sendFile(path.join(process.cwd(), 'public', 'trade-journal.html'));
    if (url.pathname === '/replay') return sendFile(path.join(process.cwd(), 'public', 'trade-replay.html'));

    if (url.pathname.startsWith('/api/replay/adjacent')) {
      const all = this.replay.listReplays(1000);
      const idx = all.findIndex(r => r.orderId === url.searchParams.get('id'));
      const target = idx + (parseInt(url.searchParams.get('direction')) || 1);
      return sendJSON({ orderId: (target >= 0 && target < all.length) ? all[target].orderId : null });
    }
    if (url.pathname.startsWith('/api/replay/')) {
      const id = url.pathname.split('/').pop();
      const data = this.replay.loadReplay(id);
      return data ? sendJSON(data) : sendJSON({ error: 'Not found' }, 404);
    }
    if (url.pathname === '/api/replays') return sendJSON(this.replay.listReplays(parseInt(url.searchParams.get('limit')) || 50));
    if (url.pathname === '/api/journal/stats') return sendJSON(this.journal.getStats());
    if (url.pathname === '/api/journal/equity') return sendJSON(this.journal.getEquityCurve(500));
    if (url.pathname.startsWith('/api/journal/breakdown/')) {
      const dim = url.pathname.split('/').pop();
      return sendJSON(this.journal.getPerformanceBreakdown(dim));
    }

    return false;
  }


  // ════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ════════════════════════════════════════════════════════════════════════

  destroy() {
    if (this._broadcastTimer) clearInterval(this._broadcastTimer);
    this.journal.destroy();
    console.log('📒 Bridge: Destroyed');
  }
}

module.exports = { TradeJournalBridge, TradeJournal, TradeReplayCapture };
