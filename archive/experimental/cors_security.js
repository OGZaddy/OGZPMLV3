// Add to your WebSocket server initialization
const WebSocket = require('ws');

// Configure WebSocket server with CORS
const wss = new WebSocket.Server({
  port: 3005,
  verifyClient: (info) => {
    // Allow connections from your domain
    const allowedOrigins = [
      'https://ogzprime.com',
      'https://www.ogzprime.com',
      'http://localhost:3000', // For development
      'http://192.168.4.61:3000' // Local testing
    ];
    
    const origin = info.origin;
    return allowedOrigins.includes(origin);
  }
});

// Handle CORS headers if needed
wss.on('headers', (headers, request) => {
  headers.push('Access-Control-Allow-Origin: https://ogzprime.com');
  headers.push('Access-Control-Allow-Credentials: true');
});

// Connection handler
wss.on('connection', (ws, request) => {
  console.log(`🔌 Client connected from: ${request.socket.remoteAddress}`);
  
  // Send initial connection confirmation
  ws.send(JSON.stringify({
    type: 'connection',
    status: 'connected',
    message: 'OGZPrime WebSocket ready',
    timestamp: new Date().toISOString()
  }));
  
  // Handle client disconnection
  ws.on('close', () => {
    console.log('🔌 Client disconnected');
  });
});

console.log('🚀 OGZPrime WebSocket server running on port 3005');
console.log('🌐 Accepting connections from ogzprime.com');