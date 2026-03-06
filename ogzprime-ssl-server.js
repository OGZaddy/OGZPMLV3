/**
 * @fileoverview OGZ Prime Dashboard Server - Web Interface & API
 *
 * Serves the trading dashboard and provides API endpoints for
 * real-time data, TRAI chat, and system control.
 *
 * @description
 * ARCHITECTURE ROLE:
 * This server provides the web interface for monitoring and controlling
 * OGZ Prime. It runs separately from the trading bot (run-empire-v2.js)
 * and communicates via WebSocket.
 *
 * ENDPOINTS:
 * - GET /               → Dashboard HTML (unified-dashboard.html)
 * - POST /api/ollama/chat → Proxy to TRAI/Ollama for AI chat
 * - WS /                → Real-time trading data stream
 *
 * ARCHITECTURE:
 * ```
 * Browser (Dashboard)
 *        ↓ WebSocket
 * ogzprime-ssl-server.js (this file)
 *        ↓ HTTP proxy
 * Ollama (TRAI inference)
 *
 * run-empire-v2.js ──WebSocket──→ Dashboard (real-time updates)
 * ```
 *
 * SSL:
 * SSL termination is handled by nginx reverse proxy, not this server.
 * This server listens on HTTP (port 3010 by default).
 *
 * @module ogzprime-ssl-server
 * @requires express
 * @requires ws
 * @requires dotenv
 *
 * @example
 * // Start the dashboard server
 * node ogzprime-ssl-server.js
 *
 * // Or via PM2
 * pm2 start ogzprime-ssl-server.js --name ogz-dashboard
 */

require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const apiPort = process.env.API_PORT || 3010;
const app = express();
const httpServer = http.createServer(app);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// CHANGE 2026-02-10: Trade Journal and Replay page routes
app.get('/journal', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'trade-journal.html'));
});
app.get('/replay', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'trade-replay.html'));
});

// CHANGE 2026-01-23: Ollama proxy for TRAI widget
app.post('/api/ollama/chat', async (req, res) => {
  try {
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[Ollama Proxy] Error:', error.message);
    res.status(500).json({ error: 'Failed to reach TRAI inference server' });
  }
});

// CHANGE 2026-03-06: Restore /api/health endpoint for proof page
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    websockets: {
      connections: wss.clients.size
    },
    timestamp: Date.now()
  });
});

// HTTPS server removed - nginx handles SSL termination
// All connections come through nginx proxy on port 3010

// Single WebSocket server on unified port
const wss = new WebSocket.Server({ 
  server: httpServer,
  path: '/ws'  // Optional: use path-based routing
});

wss.on('connection', (ws, req) => {
  // Simple connection tracking - NO OVERCOMPLICATED BROADCASTER
  const connectionId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  ws.connectionId = connectionId;
  ws.isAlive = true;
  ws.authenticated = false; // 🔒 SECURITY: Require authentication

  console.log(`✅ New WebSocket connection: ${connectionId}`);

  // 🔒 SECURITY: 10-second authentication timeout
  const authTimeout = setTimeout(() => {
    if (!ws.authenticated) {
      console.log(`❌ Client ${connectionId} failed to authenticate - disconnecting`);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Authentication timeout - connection closed'
      }));
      ws.close(1008, 'Authentication timeout');
    }
  }, 10000);

  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      // 🔒 SECURITY: First message MUST be authentication
      if (!ws.authenticated && data.type !== 'auth') {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Authentication required'
        }));
        ws.close(1008, 'Authentication required');
        return;
      }

      // 🔒 SECURITY: Handle authentication
      if (data.type === 'auth') {
        const validToken = process.env.WEBSOCKET_AUTH_TOKEN || 'CHANGE_ME_IN_PRODUCTION';

        if (data.token === validToken) {
          ws.authenticated = true;
          clearTimeout(authTimeout);
          console.log(`🔓 Client ${connectionId} authenticated successfully`);
          ws.send(JSON.stringify({
            type: 'auth_success',
            connectionId: connectionId,
            message: 'Authentication successful'
          }));
        } else {
          console.log(`❌ Client ${connectionId} failed authentication - invalid token`);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid authentication token'
          }));
          ws.close(1008, 'Invalid token');
        }
        return;
      }

      // CRITICAL: Handle ping/pong for connection health
      if (data.type === 'ping') {
        ws.send(JSON.stringify({
          type: 'pong',
          id: data.id,
          timestamp: data.timestamp || Date.now()
        }));
        return;
      }

      if (data.type === 'pong') {
        ws.isAlive = true;
        return;
      }

      // Handle bot 
            if (data.type === 'identify' && data.source === 'trading_bot') {
        console.log('🤖 TRADING BOT IDENTIFIED!');
        ws.clientType = 'bot';

        ws.send(JSON.stringify({
          type: 'identification_confirmed',
          connectionId: connectionId,
          message: 'Bot registered successfully'
        }));
      }

      // Handle dashboard identification
      if (data.type === 'identify' && data.source === 'dashboard') {
        console.log('📊 DASHBOARD IDENTIFIED!');
        ws.clientType = 'dashboard';
      }

      // 🚀 RELAY: Dashboard → Bot (for TRAI queries)
      if (ws.clientType === 'dashboard' && data.type === 'trai_query') {
        const messageStr = JSON.stringify(data);

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN &&
              client.authenticated &&
              client.clientType === 'bot') {
            try {
              client.send(messageStr);
              console.log('🧠 [TRAI] Relayed query to bot');
            } catch (err) {
              console.error('Error relaying TRAI query to bot:', err.message);
            }
          }
        });
      }

      // CHANGE 2026-01-29: RELAY Dashboard → Bot (for timeframe changes)
      if (ws.clientType === 'dashboard' && (data.type === 'timeframe_change' || data.type === 'request_historical')) {
        const messageStr = JSON.stringify(data);

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN &&
              client.authenticated &&
              client.clientType === 'bot') {
            try {
              client.send(messageStr);
              console.log(`📊 Relayed ${data.type} (${data.timeframe}) to bot`);
            } catch (err) {
              console.error('Error relaying timeframe message to bot:', err.message);
            }
          }
        });
      }

      // CHANGE 2026-02-10: RELAY Dashboard → Bot (for journal/replay/asset requests)
      if (ws.clientType === 'dashboard' && (
          data.type === 'asset_change' ||
          data.type.startsWith('request_journal') ||
          data.type.startsWith('request_replay'))) {
        const messageStr = JSON.stringify(data);

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN &&
              client.authenticated &&
              client.clientType === 'bot') {
            try {
              client.send(messageStr);
              console.log(`📒 Relayed ${data.type} to bot`);
            } catch (err) {
              console.error('Error relaying journal/replay message to bot:', err.message);
            }
          }
        });
      }

      // 🚀 RELAY: Bot messages → Dashboard clients
      if (ws.clientType === 'bot' && data.type !== 'identify') {
        const messageStr = JSON.stringify(data);

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN &&
              client.authenticated &&
              client.clientType === 'dashboard') {
            try {
              client.send(messageStr);
            } catch (err) {
              console.error('Error relaying to dashboard:', err.message);
            }
          }
        });

        // Log relay activity
        if (data.type === 'price') {
          console.log(`📡 Relayed price to dashboards: $${data.data?.price?.toFixed(2) || 'N/A'}`);
        }
      }

    } catch (err) {
      console.error(`Error parsing message from ${connectionId}:`, err.message);
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    console.log(`❌ Client disconnected: ${connectionId}`);
  });
  
  ws.on('error', (err) => {
    console.error(`WebSocket error for ${connectionId}:`, err.message);
  });
});

// Market data variables
let lastKnownPrice = null;
let tickCount = 0;
let assetPrices = {};
let currentAsset = 'BTC-USD';

// � Kraken WebSocket connection (PUBLIC - no API key needed for market data!)
const KRAKEN_PUBLIC_WS = 'wss://ws.kraken.com';

console.log('🔧 [EMPIRE V2] Kraken direct connection DISABLED - Bot provides all market data');
console.log('📡 WebSocket server acting as relay only - no direct Kraken connection');

// TEMPORARILY DISABLED to fix data conflicts - bot sends all data
// const krakenSocket = new WebSocket(KRAKEN_PUBLIC_WS);
const krakenSocket = {
  on: () => {},
  send: () => {},
  readyState: 0,
  close: () => {}
};

krakenSocket.on('open', () => {
  console.log('� Connected to Kraken public WebSocket feed');
  
  // Subscribe to multiple crypto pairs on Kraken
  const pairs = [
    'XBT/USD',  // Bitcoin (Kraken uses XBT)
    'ETH/USD',  // Ethereum
    'SOL/USD',  // Solana
    'ADA/USD',  // Cardano
    'DOGE/USD', // Dogecoin
    'XRP/USD',  // Ripple
    'LTC/USD',  // Litecoin
    'MATIC/USD',// Polygon/Matic
    'AVAX/USD', // Avalanche
    'LINK/USD', // Chainlink
    'DOT/USD',  // Polkadot
    'ATOM/USD', // Cosmos
    'UNI/USD',  // Uniswap
    'AAVE/USD', // Aave
    'ALGO/USD', // Algorand
  ];
  
  // Kraken subscription format
  krakenSocket.send(JSON.stringify({
    event: 'subscribe',
    pair: pairs,
    subscription: {
      name: 'ticker'
    }
  }));
  
  console.log(`📡 Subscribed to ${pairs.length} trading pairs on Kraken`);
});

krakenSocket.on('message', (data) => {
  try {
    const msg = JSON.parse(data);
    
    // Kraken sends different message types
    // Array messages are ticker updates: [channelID, tickerData, channelName, pair]
    if (Array.isArray(msg) && msg.length >= 4 && msg[2] === 'ticker') {
      tickCount++;
      
      const tickerData = msg[1];
      const pair = msg[3];
      
      // Extract price from Kraken ticker data
      // tickerData.c = [price, lot volume]
      const price = parseFloat(tickerData.c[0]);
      
      // Convert Kraken pair format to our format
      // XBT/USD -> BTC-USD, ETH/USD -> ETH-USD, etc.
      let asset = pair.replace('XBT/', 'BTC-').replace('/', '-');
      
      // Store price
      assetPrices[asset] = price;
      if (asset === currentAsset || asset === 'BTC-USD') {
        lastKnownPrice = price;
      }

      // Log periodically
      if (tickCount % 10 === 0 || tickCount <= 5) {
        console.log(`🎯 KRAKEN TICK #${tickCount}: ${asset} $${price.toFixed(2)} @ ${new Date().toLocaleTimeString()}`);
      }

      // 🚀 SIMPLE DIRECT BROADCAST - NO OVERCOMPLICATED BROADCASTER
      const priceMessage = {
        type: 'price',
        data: {
          asset: asset,
          price: price,
          timestamp: Date.now(),
          source: 'kraken',
          allPrices: assetPrices,
          tickCount: tickCount,
          volume: parseFloat(tickerData.v[0]) || 0
        }
      };
      
      // Broadcast ONLY to authenticated WebSocket clients
      const messageStr = JSON.stringify(priceMessage);
      let sentCount = 0;

      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.authenticated) {
          try {
            client.send(messageStr);
            sentCount++;
          } catch (err) {
            console.error('Error sending to authenticated client:', err.message);
          }
        }
      });
      
      // Log broadcast results periodically
      if (sentCount > 0 && tickCount % 20 === 0) {
        console.log(`📡 Kraken price broadcast: ${asset} $${price.toFixed(2)} → ${sentCount} clients`);
      }
    }
    
    // Handle subscription status messages
    if (msg.event === 'subscriptionStatus') {
      console.log(`📊 Kraken subscription: ${msg.status} - ${msg.pair || 'multiple pairs'}`);
    }
    
    // Handle system status
    if (msg.event === 'systemStatus') {
      console.log(`🐙 Kraken system status: ${msg.status}`);
    }
    
  } catch (err) {
    // Ignore heartbeat messages and other non-JSON data
    if (!data.toString().includes('heartbeat')) {
      console.error('❌ Failed to process Kraken data:', err.message);
    }
  }
});

krakenSocket.on('close', () => {
  console.warn('⚠️ Kraken WebSocket disconnected - attempting reconnect...');
  
  // Broadcast disconnection to all clients
  const disconnectMessage = JSON.stringify({
    type: 'data_feed_status',
    status: 'disconnected',
    message: 'Kraken data feed disconnected',
    timestamp: Date.now()
  });
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.authenticated) {
      try {
        client.send(disconnectMessage);
      } catch (err) {
        console.error('Error broadcasting disconnect:', err.message);
      }
    }
  });
  
  // Auto-reconnect after 5 seconds
  setTimeout(() => {
    console.log('🔄 Reconnecting to Kraken...');
    // In production, you'd reinitialize the connection here
  }, 5000);
});

krakenSocket.on('error', (err) => {
  console.error('🚨 Kraken WebSocket error:', err.message);
});

// 📊 Enhanced status monitoring
setInterval(() => {
  const connectedClients = Array.from(wss.clients).filter(c => c.readyState === WebSocket.OPEN);
  const botClients = connectedClients.filter(c => c.clientType === 'bot');
  
  console.log(`📊 SYSTEM STATUS:`);
  console.log(`   � Kraken: ${krakenSocket.readyState === WebSocket.OPEN ? 'Connected ✅' : 'Disconnected ❌'}`);
  console.log(`   📊 Ticks: ${tickCount}`);
  console.log(`   💰 Last Price: $${lastKnownPrice ? lastKnownPrice.toFixed(2) : 'N/A'}`);
  console.log(`   👥 Total Connections: ${connectedClients.length}`);
  console.log(`   🤖 Bot Connections: ${botClients.length}`);
  console.log(`   📡 Assets tracked: ${Object.keys(assetPrices).length}`);
  
  // Alert if no bot connections
  if (botClients.length === 0) {
    console.warn('⚠️ WARNING: No trading bot connections detected!');
  }
  
}, 30000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down SSL server...');

  // Close all WebSocket connections
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close();
    }
  });

  if (krakenSocket.readyState === WebSocket.OPEN) {
    krakenSocket.close();
  }

  httpServer.close(() => {
    console.log('✅ Server shutdown complete');
    process.exit(0);
  });
});

// CRITICAL FIX: Actually start listening on the port!
const wsPort = process.env.WS_PORT || 3010;
httpServer.listen(wsPort, '0.0.0.0', () => {
  console.log(`🚀 WebSocket server ACTUALLY LISTENING on port ${wsPort}`);
  console.log(`📡 Dashboard can now connect to ws://localhost:${wsPort}/ws`);
});

// Network interfaces display
const os = require('os');
const networkInterfaces = os.networkInterfaces();
const localIPs = [];

Object.keys(networkInterfaces).forEach(interfaceName => {
  networkInterfaces[interfaceName].forEach(interface => {
    if (interface.family === 'IPv4' && !interface.internal) {
      localIPs.push(interface.address);
    }
  });
});