// Replace localhost connections with your external setup
// Option 1: Direct IP (if you have static IP)
const WS_BASE = 'ws://YOUR_EXTERNAL_IP:3005';

// Option 2: Domain-based (recommended)
const WS_BASE = 'wss://ogzprime.com:3005'; // Use wss:// for secure WebSocket

// Option 3: Subdomain routing (cleanest)
const WS_BASE = 'wss://bot.ogzprime.com';

// Update your connection functions:
function connectDataWebSocket() {
  ws = new WebSocket(`${WS_BASE}/data`); // or whatever your endpoint structure is
  
  ws.onopen = () => {
    console.log('[OGZPrime] ✅ Connected to live trading data');
    updateConnectionStatus('CONNECTED');
  };
  
  ws.onerror = (error) => {
    console.error('[OGZPrime] ❌ WebSocket error:', error);
    updateConnectionStatus('ERROR');
  };
  
  ws.onclose = () => {
    console.warn('[OGZPrime] ⚠️ Connection lost, reconnecting...');
    updateConnectionStatus('RECONNECTING');
    setTimeout(connectDataWebSocket, 5000); // Auto-reconnect
  };
}

// Add connection status display
function updateConnectionStatus(status) {
  const statusEl = document.getElementById('connection-status');
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.className = `status-${status.toLowerCase()}`;
  }
}