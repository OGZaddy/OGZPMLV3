#!/usr/bin/env node

/**
 * DASHBOARD WEBSOCKET SERVER
 *
 * Serves dashboard files and handles WebSocket connections for the bot
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
// const StripeEndpoints = require('./stripe_endpoints'); // Disabled until real Stripe keys are configured

const app = express();
const server = http.createServer(app);

// CORS CONFIGURATION FOR PUBLIC WEBSITE ACCESS
const corsConfig = {
  // Allow all origins for now (restrict to specific domains in production)
  origin: process.env.NODE_ENV === 'production'
    ? ['https://ogzprime.com', 'https://www.ogzprime.com']
    : '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Upgrade', 'Connection'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Apply CORS to Express static file serving
app.use((req, res, next) => {
  const origin = Array.isArray(corsConfig.origin) ? corsConfig.origin[0] : corsConfig.origin;

  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', corsConfig.methods.join(', '));
  res.header('Access-Control-Allow-Headers', corsConfig.allowedHeaders.join(', '));
  res.header('Access-Control-Allow-Credentials', corsConfig.credentials.toString());

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(corsConfig.optionsSuccessStatus);
    return;
  }

  next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    // Additional headers for static assets
    const origin = Array.isArray(corsConfig.origin) ? corsConfig.origin[0] : corsConfig.origin;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

// WebSocket server with CORS handling
const wss = new WebSocket.Server({
  server,
  // Handle WebSocket upgrade requests with CORS
  verifyClient: (info, callback) => {
    const origin = info.origin;
    const allowedOrigins = Array.isArray(corsConfig.origin) ? corsConfig.origin : [corsConfig.origin];

    // Allow connections from allowed origins or localhost for development
    const isAllowed = allowedOrigins.includes('*') ||
                     allowedOrigins.includes(origin) ||
                     origin?.includes('localhost') ||
                     origin?.includes('127.0.0.1');

    if (!isAllowed) {
      console.log(`🚫 WebSocket connection rejected from origin: ${origin}`);
      callback(false, 403, 'Forbidden - CORS policy violation');
      return;
    }

    console.log(`✅ WebSocket connection allowed from origin: ${origin}`);
    callback(true);
  }
});

// Store connected clients
const clients = new Set();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('📡 Dashboard client connected');
  clients.add(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      // Handle different message types
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      } else if (data.type === 'bot_status') {
        // Broadcast bot status to all dashboard clients
        broadcastToClients({
          type: 'bot_update',
          data: data.data,
          timestamp: Date.now()
        });
      } else if (data.type === 'trade_signal') {
        // Broadcast trade signals
        broadcastToClients({
          type: 'trade_signal',
          data: data.data,
          timestamp: Date.now()
        });
      } else if (data.type === 'trai_query') {
        // Forward TRAI query to all clients (including bot)
        console.log('🧠 [TRAI] Forwarding chat query to bot');
        broadcastToClients(data);
      } else if (data.type === 'trai_response') {
        // Forward TRAI response to all clients
        console.log('🧠 [TRAI] Forwarding chat response to clients');
        broadcastToClients(data);
      } else if (data.type === 'trade') {
        // CHANGE 2026-01-27: Forward trade messages (P&L + chart markers)
        console.log(`📈 [TRADE] ${data.action || data.direction} @ $${data.price}`);
        broadcastToClients(data);
      } else if (data.type === 'bot_thinking') {
        // CHANGE 2026-01-27: Forward chain of thought updates
        broadcastToClients(data);
      } else if (data.type === 'pattern_analysis') {
        // CHANGE 2026-01-27: Forward pattern analysis for pattern box visualization
        broadcastToClients(data);
      } else if (data.type === 'price') {
        // CHANGE 2026-01-28: Forward price updates (includes candles for chart!)
        broadcastToClients(data);
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    console.log('📡 Dashboard client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

function broadcastToClients(message) {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error broadcasting to client:', error);
        clients.delete(client);
      }
    }
  });
}

// Global function for bot to send updates
global.sendToDashboard = (type, data) => {
  broadcastToClients({
    type: type,
    data: data,
    timestamp: Date.now()
  });
};

// Initialize Stripe payment endpoints (disabled until real keys configured)
// const stripeEndpoints = new StripeEndpoints({
//   apiKey: process.env.STRIPE_SECRET_KEY,
//   webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
//   corsOrigin: corsConfig.origin,
//   enableRateLimit: true,
//   maxRequestsPerMinute: 30
// });

// Mount Stripe routes under /api/stripe
// app.use('/api/stripe', stripeEndpoints.app);

// Start server
const PORT = process.env.PORT || 3010;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Dashboard server running on http://0.0.0.0:${PORT}`);
  console.log(`📡 WebSocket server ready for bot connections`);
  console.log(`🌐 Open http://localhost:${PORT}/unified-dashboard.html to view dashboard`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down dashboard server...');
  wss.close();
  server.close(() => {
    console.log('✅ Dashboard server stopped');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down dashboard server...');
  wss.close();
  server.close(() => {
    console.log('✅ Dashboard server stopped');
    process.exit(0);
  });
});

module.exports = { app, server, wss, broadcastToClients };
