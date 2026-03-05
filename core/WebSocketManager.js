/**
 * WebSocketManager - Phase 20 Extraction
 *
 * EXACT COPY of initializeDashboardWebSocket() + startHeartbeatPing() from run-empire-v2.js
 * NO logic changes. Just moved to separate file.
 *
 * Dependencies passed via context object in constructor.
 *
 * @module core/WebSocketManager
 */

'use strict';

const WebSocket = require('ws');
const { getInstance: getStateManager } = require('./StateManager');
const stateManager = getStateManager();

class WebSocketManager {
  constructor(ctx) {
    this.ctx = ctx;
    console.log('[WebSocketManager] Initialized (Phase 20 - exact copy)');
  }

  /**
   * Initialize Dashboard WebSocket connection (Change 528)
   * OPTIONAL - only connects if WS_HOST is set
   * EXACT COPY from run-empire-v2.js
   */
  initializeDashboardWebSocket() {
    // Bot connects to WebSocket relay on port 3010
    const wsUrl = process.env.WS_URL || 'ws://localhost:3010/ws';

    console.log(`\n📊 Connecting to Dashboard WebSocket at ${wsUrl}...`);

    try {
      this.ctx.dashboardWs = new WebSocket(wsUrl);

      this.ctx.dashboardWs.on('open', () => {
        console.log('✅ Dashboard WebSocket connected!');
        this.ctx.dashboardWsConnected = true;
        this.ctx.lastPongReceived = Date.now(); // CHANGE 2026-01-28: Track pong for heartbeat

        // 🔒 SECURITY (Change 582): Authenticate first before sending any data
        const authToken = process.env.WEBSOCKET_AUTH_TOKEN || 'CHANGE_ME_IN_PRODUCTION';
        if (!authToken || authToken === 'CHANGE_ME_IN_PRODUCTION') {
          console.error('⚠️ WEBSOCKET_AUTH_TOKEN not set in .env - using default token');
        }

        this.ctx.dashboardWs.send(JSON.stringify({
          type: 'auth',
          token: authToken
        }));
        console.log('🔐 Sent authentication to dashboard');

        // DON'T send identify here - wait for auth_success message
      });

      this.ctx.dashboardWs.on('error', (error) => {
        console.error('⚠️ Dashboard WebSocket error:', error.message);
        this.ctx.dashboardWsConnected = false;
      });

      this.ctx.dashboardWs.on('close', () => {
        console.log('⚠️ Dashboard WebSocket closed - reconnecting in 2s...');
        this.ctx.dashboardWsConnected = false;
        // CHANGE 2026-01-31: Clear both intervals on close
        if (this.ctx.heartbeatInterval) {
          clearInterval(this.ctx.heartbeatInterval);
          this.ctx.heartbeatInterval = null;
        }
        if (this.ctx.dataWatchdogInterval) {
          clearInterval(this.ctx.dataWatchdogInterval);
          this.ctx.dataWatchdogInterval = null;
        }
        // Reconnect faster (2s instead of 5s)
        if (this.ctx.isRunning) {
          setTimeout(() => this.initializeDashboardWebSocket(), 2000);
        }
      });

      this.ctx.dashboardWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // CHANGE 2026-01-31: Track last message for data watchdog
          this.ctx.lastDashboardMessageReceived = Date.now();

          // Handle authentication success
          if (msg.type === 'auth_success') {
            console.log('🔓 Dashboard authentication successful!');

            // Now send identify message after successful auth
            this.ctx.dashboardWs.send(JSON.stringify({
              type: 'identify',
              source: 'trading_bot',
              bot: 'ogzprime-v14-refactored',
              version: 'V14-REFACTORED-MERGED',
              capabilities: ['trading', 'realtime', 'risk-management']
            }));

            // PHASE 4 REWRITE: executionLayer deleted - StateManager handles dashboard connection
            // this.ctx.executionLayer.setWebSocketClient(this.ctx.dashboardWs);

            // CHANGE 2025-12-11: Connect StateManager to dashboard for accurate post-update state
            // Dashboard now receives state AFTER changes, never stale data
            stateManager.setDashboardWs(this.ctx.dashboardWs);

            // Connect TRAI for chain-of-thought broadcasts
            if (this.ctx.trai) {
              this.ctx.trai.setWebSocketClient(this.ctx.dashboardWs);
            }

            // CHANGE 2026-01-28: Start heartbeat ping interval after auth
            this.startHeartbeatPing();

            return;
          }

          // Handle authentication errors
          if (msg.type === 'error') {
            console.error('❌ Dashboard error:', msg.message);
            return;
          }

          // CHANGE 2026-01-28: Handle pong for heartbeat
          if (msg.type === 'pong') {
            this.ctx.lastPongReceived = Date.now();
            return;
          }

          // CHANGE 2026-01-30: Handle timeframe change from dashboard
          // Fetch REAL historical data from Kraken REST API, not just cached WebSocket data
          if (msg.type === 'timeframe_change') {
            const newTimeframe = msg.timeframe || '1m';
            console.log(`📊 Dashboard timeframe changed to: ${newTimeframe}`);
            this.ctx.dashboardTimeframe = newTimeframe;

            // Fetch historical candles from Kraken REST API
            this.ctx.fetchAndSendHistoricalCandles(newTimeframe, 200);
            return;
          }

          // CHANGE 2026-01-30: Handle request for historical data
          if (msg.type === 'request_historical') {
            const timeframe = msg.timeframe || '1m';
            const limit = msg.limit || 200;

            // Fetch historical candles from Kraken REST API
            this.ctx.fetchAndSendHistoricalCandles(timeframe, limit);
            return;
          }

          // CHANGE 2026-02-10: Handle asset switching from dashboard (Multi-Asset Manager)
          if (msg.type === 'asset_change') {
            if (this.ctx.assetManager) {
              this.ctx.assetManager.switchAsset(msg.asset);
            }
            return;
          }

          // CHANGE 665: Handle profile switching and dashboard commands
          if (msg.type === 'command') {
            console.log('🔨 Dashboard command received:', msg.command);

            // Profile switching (manual only - does NOT affect confidence)
            if (msg.command === 'switch_profile' && msg.profile) {
              const success = this.ctx.profileManager.setActiveProfile(msg.profile);
              if (success) {
                // Profile is for reference only - does not override env vars
                // Send confirmation to dashboard
                this.ctx.dashboardWs.send(JSON.stringify({
                  type: 'profile_switched',
                  profile: msg.profile,
                  settings: this.ctx.profileManager.getActiveProfile(),
                  note: 'Profile for reference only - trading uses env vars'
                }));
              }
            }

            // Get all profiles
            else if (msg.command === 'get_profiles') {
              this.ctx.dashboardWs.send(JSON.stringify({
                type: 'profiles_list',
                profiles: this.ctx.profileManager.getAllProfiles(),
                active: this.ctx.profileManager.getActiveProfile().name
              }));
            }

            // Dynamic confidence adjustment
            else if (msg.command === 'set_confidence' && msg.confidence) {
              this.ctx.profileManager.setDynamicConfidence(msg.confidence);
              this.ctx.tradingBrain.updateConfidenceThreshold(msg.confidence / 100);
            }

            // PAUSE TRADING - Manual safety stop from dashboard
            else if (msg.command === 'pause_trading') {
              const reason = msg.reason || 'Manual pause from dashboard';
              console.log('🛑 [Dashboard] Pause command received:', reason);
              stateManager.pauseTrading(reason);
              this.ctx.dashboardWs.send(JSON.stringify({
                type: 'pause_confirmed',
                reason: reason,
                timestamp: Date.now()
              }));
            }

            // RESUME TRADING - Manual resume from dashboard
            else if (msg.command === 'resume_trading') {
              console.log('✅ [Dashboard] Resume command received');
              stateManager.resumeTrading();
              this.ctx.dashboardWs.send(JSON.stringify({
                type: 'resume_confirmed',
                timestamp: Date.now()
              }));
            }
          }

          // TRAI Chat Support - Tech support queries from dashboard
          if (msg.type === 'trai_query' && this.ctx.trai) {
            console.log('🧠 [TRAI] Received chat query:', msg.query?.substring(0, 50) + '...');
            this.ctx.handleTraiQuery(msg);
          }
        } catch (error) {
          console.error('❌ Dashboard message parse error:', error.message);
        }
      });

    } catch (error) {
      console.error('❌ Dashboard WebSocket initialization failed:', error.message);
      this.ctx.dashboardWsConnected = false;
    }
  }

  /**
   * CHANGE 2026-01-31: Aggressive heartbeat to prevent silent connection death
   * - Ping every 15s (more frequent)
   * - Timeout after 30s (miss 2 pings = dead)
   * - Data watchdog: reconnect if no messages for 60s
   * EXACT COPY from run-empire-v2.js
   */
  startHeartbeatPing() {
    // Clear any existing intervals
    if (this.ctx.heartbeatInterval) {
      clearInterval(this.ctx.heartbeatInterval);
    }
    if (this.ctx.dataWatchdogInterval) {
      clearInterval(this.ctx.dataWatchdogInterval);
    }

    const PING_INTERVAL = 15000; // 15 seconds (more aggressive)
    const PONG_TIMEOUT = 30000;  // 30 seconds (miss 2 pings = dead)
    const DATA_TIMEOUT = 60000;  // 60 seconds no data = force reconnect

    // Track last message received (any type)
    this.ctx.lastDashboardMessageReceived = this.ctx.lastDashboardMessageReceived || Date.now();

    // Heartbeat ping/pong check
    this.ctx.heartbeatInterval = setInterval(() => {
      // Check if socket exists and thinks it's open
      if (!this.ctx.dashboardWs) {
        console.log('⚠️ [Heartbeat] No WebSocket instance - triggering reconnect');
        this.initializeDashboardWebSocket();
        return;
      }

      const state = this.ctx.dashboardWs.readyState;
      if (state !== 1) {
        console.log(`⚠️ [Heartbeat] Socket not open (readyState=${state}) - waiting for reconnect`);
        return;
      }

      // Check if last pong is too old
      const timeSinceLastPong = Date.now() - (this.ctx.lastPongReceived || 0);
      if (timeSinceLastPong > PONG_TIMEOUT) {
        console.log('💔 [Heartbeat] TIMEOUT - no pong in ' + Math.round(timeSinceLastPong/1000) + 's - forcing reconnect');
        try {
          this.ctx.dashboardWs.terminate();
        } catch (e) {
          console.error('❌ [Heartbeat] Terminate failed:', e.message);
        }
        return;
      }

      // Send ping
      try {
        this.ctx.dashboardWs.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } catch (err) {
        console.error('❌ [Heartbeat] Ping failed:', err.message, '- forcing reconnect');
        try {
          this.ctx.dashboardWs.terminate();
        } catch (e) {}
      }
    }, PING_INTERVAL);

    // Data watchdog - ensure SOME data is flowing
    this.ctx.dataWatchdogInterval = setInterval(() => {
      if (!this.ctx.dashboardWs || this.ctx.dashboardWs.readyState !== 1) {
        return; // Not connected
      }

      const timeSinceData = Date.now() - (this.ctx.lastDashboardMessageReceived || 0);
      if (timeSinceData > DATA_TIMEOUT) {
        console.log('🚨 [Watchdog] NO DATA for ' + Math.round(timeSinceData/1000) + 's - forcing reconnect');
        try {
          this.ctx.dashboardWs.terminate();
        } catch (e) {
          console.error('❌ [Watchdog] Terminate failed:', e.message);
        }
      }
    }, 30000); // Check every 30s

    console.log('💓 Heartbeat started (ping every 15s, pong timeout 30s, data timeout 60s)');
  }
}

module.exports = WebSocketManager;
