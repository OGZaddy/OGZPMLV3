# OGZ PRIME SYSTEM ARCHITECTURE PACKET
## Dashboard Display & Data Flow Issues - December 2025

---

## CORE PROBLEM
**Dashboard chart not displaying live candlestick data despite bot successfully sending data via WebSocket**

---

## 1. SYSTEM ARCHITECTURE OVERVIEW

### Data Flow Pipeline:
```
Kraken WebSocket → Bot (run-empire-v2.js) → WebSocket Server (:3010) → Dashboard → Chart Display
                    ↓                          ↓
            IndicatorEngine           Dashboard WebSocket Client
                    ↓                          ↓
            Pattern Recognition        Chart Manager/Adapter
                    ↓                          ↓
            Trading Decisions           Visual Display
```

---

## 2. CORE MODULES & FILES

### A. BACKEND/BOT COMPONENTS

#### Main Trading Bot
- **File**: `/opt/ogzprime/OGZPMLV2/run-empire-v2.js`
- **Purpose**: Main trading bot orchestrator
- **Key Functions**:
  - Lines 897-926: WebSocket broadcast to dashboard
  - Sends: price updates, indicators, candles, trades
  - WebSocket server on port 3010
  - Broadcasts every 5 seconds when dashboard connected

#### Indicator Engine
- **File**: `/opt/ogzprime/OGZPMLV2/core/indicators/IndicatorEngine.js`
- **Purpose**: Calculate 30+ technical indicators
- **Indicators**: RSI, MACD, Bollinger Bands, EMA, SMA, VWAP, OBV, ATR, etc.
- **Output Format**:
```javascript
{
  symbol: 'BTC',
  tf: '1m',
  indicators: {
    rsi: 45.67,
    macd: { macd: 0.123, signal: 0.111, hist: 0.012 },
    bb: { upper: 88000, mid: 87500, lower: 87000 },
    // ... 30+ more indicators
  }
}
```

#### Pattern Recognition
- **File**: `/opt/ogzprime/OGZPMLV2/core/EnhancedPatternRecognition.js`
- **Purpose**: Detect trading patterns (head & shoulders, triangles, etc.)
- **Memory**: `/opt/ogzprime/OGZPMLV2/data/pattern-memory.json`

#### WebSocket Server
- **Port**: 3010
- **Protocol**: ws://localhost:3010/ws
- **Message Types**:
  - `price`: Current price and candle data
  - `indicators`: Technical indicator values
  - `trade`: Trade execution details
  - `pattern`: Pattern detection alerts

### B. FRONTEND/DASHBOARD COMPONENTS

#### Main Dashboard HTML
- **File**: `/opt/ogzprime/OGZPMLV2/public/unified-dashboard.html`
- **Issue**: Chart not displaying despite receiving data
- **Current State**:
  - Lines 1090-1200: Chart initialization code
  - Using TradingView Lightweight Charts library
  - WebSocket connection established
  - Data received but not rendering

#### Chart Manager
- **File**: `/opt/ogzprime/OGZPMLV2/public/js/ChartManager.js`
- **Created**: December 2025
- **Purpose**: Centralized OHLCV data management
- **Features**:
  - Multi-timeframe support (1m, 5m, 15m, 1h, 4h, 1d)
  - Multi-asset tracking
  - 500 candle memory limit per asset/timeframe
  - Indicator value caching

#### Indicator Adapter
- **File**: `/opt/ogzprime/OGZPMLV2/public/js/IndicatorAdapter.js`
- **Created**: December 2025
- **Purpose**: Bridge server-side indicators to client display
- **Functions**:
  - processIndicatorUpdate(): Parse WebSocket indicator data
  - getIndicatorDisplay(): Format for UI display
  - getChartOverlays(): Generate chart overlay data

#### Test Chart (Simplified)
- **File**: `/opt/ogzprime/OGZPMLV2/public/test-chart.html`
- **Purpose**: Minimal test implementation
- **Status**: Created but not accessible (nginx 404)

### C. INFRASTRUCTURE

#### Web Server
- **Server**: Nginx
- **Config**: `/etc/nginx/sites-available/ogzprime.conf`
- **Root**: `/opt/ogzprime/OGZPMLV2/public` ✅ (FIXED - was pointing to /var/www/ogzprime.com)
- **Status**: Config updated, nginx needs reload

#### SSL/TLS
- **Domain**: ogzprime.com
- **Certificate**: Let's Encrypt
- **HTTPS**: Port 443
- **WebSocket**: wss://ogzprime.com/ws (proxied to ws://localhost:3010/ws)

#### Process Management
- **PM2**: Managing bot process
- **Process Name**: ogz-prime-v2
- **Auto-restart**: Enabled
- **Logs**: `~/.pm2/logs/ogz-prime-v2-out.log`

---

## 3. CURRENT ISSUES & STATUS

### CONFIRMED WORKING:
✅ Bot running and trading
✅ WebSocket server active on :3010
✅ Dashboard connects to WebSocket
✅ Data broadcasting every 5 seconds
✅ Indicators calculating correctly
✅ Pattern recognition active

### NOT WORKING:
❌ Chart display in dashboard (main issue)
❌ Candlestick rendering
❌ Test chart page (404 error)
❌ Historical data loading

### ATTEMPTED SOLUTIONS:
1. ❌ Chart.js with chartjs-chart-financial plugin → "String.prototype.toString" error
2. ❌ Chart.js 2.9.4 with financial plugin → "candlestick controller not registered"
3. ❌ Chart.js 3.x → Incompatible with financial plugins
4. ⏳ TradingView Lightweight Charts → Current attempt, not rendering

---

## 4. DATA STRUCTURES

### WebSocket Message Format:
```javascript
// Price Update
{
  type: 'price',
  data: {
    symbol: 'BTC',
    price: 87654.32,
    volume: 1234.56,
    candle: {
      t: 1703789100000,  // timestamp
      o: 87600,          // open
      h: 87700,          // high
      l: 87500,          // low
      c: 87654,          // close
      v: 1234.56         // volume
    }
  }
}

// Indicator Update
{
  type: 'indicators',
  symbol: 'BTC',
  tf: '1m',
  indicators: { /* 30+ indicator values */ }
}
```

### OHLCV Candle Structure:
```javascript
{
  t: timestamp,    // Unix timestamp in ms
  o: open,        // Open price
  h: high,        // High price
  l: low,         // Low price
  c: close,       // Close price
  v: volume       // Volume
}
```

---

## 5. DEPENDENCIES

### Backend:
- Node.js 18+
- ws (WebSocket for Kraken market data)
- Polygon.io API (configured but secondary)
- technicalindicators
- express
- dotenv

### Frontend:
- TradingView Lightweight Charts (current)
- Chart.js (attempted, issues)
- Bootstrap 5
- Font Awesome

---

## 6. FILE PERMISSIONS ISSUE (FIXED)
- **Problem**: JS files had 600 permissions
- **Solution**: `chmod 644 /opt/ogzprime/OGZPMLV2/public/js/*.js`
- **Directory**: `chmod 755 /opt/ogzprime/OGZPMLV2/public/js/`

---

## 7. CRITICAL CODE SECTIONS

### Bot WebSocket Broadcast (run-empire-v2.js:897-926)
```javascript
if (dashboardWsConnected) {
  const dashboardData = {
    timestamp: Date.now(),
    price: currentPrice,
    indicators: currentIndicators,
    candle: latestCandle,
    positions: activePositions,
    performance: performanceMetrics
  };
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(dashboardData));
    }
  });
}
```

### Dashboard WebSocket Handler (unified-dashboard.html:1150)
```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'price' && data.data.candle) {
    // Process candle data for chart
    chartManager.addCandle('BTC', '1m', data.data.candle);
    updateChart();
  }
};
```

---

## 8. IMMEDIATE TASKS NEEDED

1. **Fix chart rendering in dashboard**
   - Verify TradingView library loads
   - Ensure candle data format matches library requirements
   - Check chart initialization timing

2. **Configure nginx for test files**
   - Update nginx config to serve test-chart.html
   - Reload nginx

3. **Connect live data to chart**
   - Map WebSocket data to chart update calls
   - Handle historical data loading
   - Implement proper time axis

4. **Complete indicator overlays**
   - Add moving averages to chart
   - Display RSI in separate panel
   - Show Bollinger Bands

---

## 9. TESTING COMMANDS

```bash
# Check bot status
pm2 status ogz-prime-v2

# View bot logs
pm2 logs ogz-prime-v2 --lines 50

# Test WebSocket connection
wscat -c ws://localhost:3010/ws

# Check nginx config
nginx -t

# Reload nginx
sudo systemctl reload nginx

# Test dashboard
curl https://ogzprime.com/unified-dashboard.html

# Check file permissions
ls -la /opt/ogzprime/OGZPMLV2/public/js/
```

---

## 10. CONTACT & ENVIRONMENT

- **Domain**: ogzprime.com
- **Server**: Ubuntu with nginx
- **Bot Process**: PM2-managed Node.js
- **Working Directory**: /opt/ogzprime/OGZPMLV2
- **User Requirements**:
  - No code knowledge
  - Needs visual dashboard
  - Requires CHANGELOG documentation
  - Professional candlestick charts essential

---

## SUMMARY FOR COLLABORATORS

The core issue is that the dashboard receives live trading data via WebSocket but fails to render candlestick charts. The bot successfully broadcasts OHLCV data every 5 seconds, indicators calculate correctly, but the chart display remains blank. Multiple charting libraries have been attempted with various compatibility issues. Current approach uses TradingView Lightweight Charts but needs proper implementation to display the data stream.

**Key files to examine**:
1. `/opt/ogzprime/OGZPMLV2/public/unified-dashboard.html` (lines 1090-1200)
2. `/opt/ogzprime/OGZPMLV2/public/js/ChartManager.js`
3. `/opt/ogzprime/OGZPMLV2/run-empire-v2.js` (lines 897-926)

---

Generated: December 28, 2025
Purpose: Multi-modal collaboration on dashboard display issues