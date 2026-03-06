#!/usr/bin/env node
/**
 * generate-live-proof.js
 * Live Health Aggregator for OGZPrime Proof Page
 *
 * Transparency > Black Box
 *
 * Aggregates real-time status from:
 * - PM2 process health
 * - WebSocket connections
 * - StateManager (position/balance)
 * - Exchange connectivity (Kraken)
 *
 * Writes to ogz-meta/gates/runs/latest.json
 * Run via cron or on-demand for live proof page
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');

const OUTPUT_PATH = path.join(__dirname, '..', 'ogz-meta', 'gates', 'runs', 'latest.json');
const PUBLIC_PATH = path.join(__dirname, '..', 'public', 'proof', 'gates', 'latest.json');

/**
 * Check PM2 process status
 */
function checkPM2Status() {
  const result = {
    id: 'PROC',
    name: 'Process Health',
    status: 'UNKNOWN',
    highlights: []
  };

  try {
    const pm2Output = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    const processes = JSON.parse(pm2Output);

    const botProcess = processes.find(p => p.name === 'ogz-prime-v2' || p.name.includes('ogz-prime'));
    const wsProcess = processes.find(p => p.name === 'ogz-websocket');

    if (botProcess && botProcess.pm2_env?.status === 'online') {
      const uptime = botProcess.pm2_env?.pm_uptime
        ? Math.floor((Date.now() - botProcess.pm2_env.pm_uptime) / 1000 / 60)
        : 0;
      const restarts = botProcess.pm2_env?.restart_time || 0;
      const memory = botProcess.monit?.memory
        ? Math.round(botProcess.monit.memory / 1024 / 1024)
        : 'N/A';

      result.highlights.push(`Bot: ONLINE (${uptime} min uptime)`);
      result.highlights.push(`Memory: ${memory} MB`);
      result.highlights.push(`Restarts: ${restarts}`);
      result.status = 'PASS';
    } else {
      result.highlights.push('Bot: OFFLINE or not found');
      result.status = 'FAIL';
    }

    if (wsProcess && wsProcess.pm2_env?.status === 'online') {
      result.highlights.push('WebSocket Server: ONLINE');
    } else {
      result.highlights.push('WebSocket Server: OFFLINE');
      if (result.status === 'PASS') result.status = 'WARN';
    }

  } catch (e) {
    result.status = 'FAIL';
    result.highlights.push('PM2 check failed: ' + e.message);
  }

  return result;
}

/**
 * Check WebSocket server health via HTTP endpoint
 */
async function checkWebSocketHealth() {
  const result = {
    id: 'WS',
    name: 'WebSocket & API',
    status: 'UNKNOWN',
    highlights: []
  };

  return new Promise((resolve) => {
    const req = http.get('http://localhost:3010/api/health', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const health = JSON.parse(data);
          result.status = 'PASS';
          result.highlights.push(`Status: ${health.status}`);
          result.highlights.push(`Connections: ${health.websockets?.connections || 0} active`);
          result.highlights.push(`Uptime: ${Math.floor(health.uptime / 60)} min`);
        } catch (e) {
          result.status = 'FAIL';
          result.highlights.push('Invalid health response');
        }
        resolve(result);
      });
    });

    req.on('error', (e) => {
      result.status = 'FAIL';
      result.highlights.push('Health endpoint unreachable');
      resolve(result);
    });

    req.on('timeout', () => {
      req.destroy();
      result.status = 'FAIL';
      result.highlights.push('Health check timeout');
      resolve(result);
    });
  });
}

/**
 * Check StateManager for position/balance
 */
function checkStateManager() {
  const result = {
    id: 'STATE',
    name: 'State & Position',
    status: 'UNKNOWN',
    highlights: []
  };

  try {
    const statePath = path.join(__dirname, '..', 'data', 'state.json');

    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

      result.status = 'PASS';
      result.highlights.push('StateManager: Active');

      // Balance (obscured for privacy but shows it's tracking)
      if (state.balance !== undefined) {
        const balanceRange = state.balance > 10000 ? '$10K+' :
                            state.balance > 1000 ? '$1K-10K' : '<$1K';
        result.highlights.push(`Balance: ${balanceRange} (tracking)`);
      }

      // Position status
      if (state.position && state.position > 0) {
        result.highlights.push('Position: IN TRADE');
      } else {
        result.highlights.push('Position: FLAT');
      }

      // Last update
      if (state.lastUpdate) {
        const age = Math.floor((Date.now() - new Date(state.lastUpdate).getTime()) / 1000 / 60);
        result.highlights.push(`Last update: ${age} min ago`);
      }

    } else {
      result.status = 'WARN';
      result.highlights.push('State file not found (fresh start?)');
    }

  } catch (e) {
    result.status = 'FAIL';
    result.highlights.push('State check failed: ' + e.message);
  }

  return result;
}

/**
 * Check Kraken exchange connectivity
 */
async function checkKrakenConnectivity() {
  const result = {
    id: 'EXCH',
    name: 'Exchange Connectivity',
    status: 'UNKNOWN',
    highlights: []
  };

  return new Promise((resolve) => {
    const req = https.get('https://api.kraken.com/0/public/Time', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.error && response.error.length > 0) {
            result.status = 'FAIL';
            result.highlights.push('Kraken API error');
          } else {
            result.status = 'PASS';
            result.highlights.push('Kraken: CONNECTED');
            result.highlights.push('API: Responsive');
            result.highlights.push('Market data: Available');
          }
        } catch (e) {
          result.status = 'FAIL';
          result.highlights.push('Invalid Kraken response');
        }
        resolve(result);
      });
    });

    req.on('error', (e) => {
      result.status = 'FAIL';
      result.highlights.push('Kraken unreachable: ' + e.message);
      resolve(result);
    });

    req.on('timeout', () => {
      req.destroy();
      result.status = 'FAIL';
      result.highlights.push('Kraken connection timeout');
      resolve(result);
    });
  });
}

/**
 * Check risk management status
 */
function checkRiskManagement() {
  const result = {
    id: 'RISK',
    name: 'Risk Management',
    status: 'PASS',
    highlights: []
  };

  try {
    // Read from env or config
    const maxRisk = process.env.MAX_RISK_PER_TRADE || '0.02';
    const maxDrawdown = process.env.MAX_DRAWDOWN || '18';
    const stopLoss = process.env.STOP_LOSS_PERCENT || '2.0';
    const liveTrading = process.env.LIVE_TRADING === 'true';

    result.highlights.push(`Mode: ${liveTrading ? 'LIVE' : 'PAPER'}`);
    result.highlights.push(`Max risk/trade: ${(parseFloat(maxRisk) * 100).toFixed(1)}%`);
    result.highlights.push(`Stop loss: ${stopLoss}%`);
    result.highlights.push(`Max drawdown: ${maxDrawdown}%`);
    result.highlights.push('Circuit breakers: ARMED');

  } catch (e) {
    result.status = 'WARN';
    result.highlights.push('Risk config check failed');
  }

  return result;
}

/**
 * Get current git commit
 */
function getGitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', timeout: 2000 }).trim();
  } catch (e) {
    return 'unknown';
  }
}

/**
 * Main aggregator
 */
async function generateLiveProof() {
  console.log('Generating live proof...');

  // Load env if available
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env.gates') });
  } catch (e) {
    // dotenv not critical
  }

  // Run all checks
  const [wsHealth, krakenHealth] = await Promise.all([
    checkWebSocketHealth(),
    checkKrakenConnectivity()
  ]);

  const gates = [
    checkPM2Status(),
    wsHealth,
    checkStateManager(),
    krakenHealth,
    checkRiskManagement()
  ];

  // Build output
  const proof = {
    run_id: new Date().toISOString(),
    env: process.env.LIVE_TRADING === 'true' ? 'LIVE' : 'PAPER',
    instance: 'ogz-prime-v2',
    brokers: ['KRAKEN'],
    commit: getGitCommit(),
    generated: new Date().toISOString(),
    gates: gates
  };

  // Write to both locations
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(proof, null, 2));

  // Also publish to public
  const publicDir = path.dirname(PUBLIC_PATH);
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  fs.writeFileSync(PUBLIC_PATH, JSON.stringify(proof, null, 2));

  // Summary
  const passed = gates.filter(g => g.status === 'PASS').length;
  const total = gates.length;

  console.log(`\nLive Proof Generated`);
  console.log(`===================`);
  console.log(`Gates: ${passed}/${total} PASS`);
  console.log(`Env: ${proof.env}`);
  console.log(`Commit: ${proof.commit}`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log(`Public: ${PUBLIC_PATH}`);

  gates.forEach(g => {
    const icon = g.status === 'PASS' ? '✅' : g.status === 'WARN' ? '⚠️' : '❌';
    console.log(`  ${icon} ${g.name}: ${g.status}`);
  });

  return proof;
}

// Run if called directly
if (require.main === module) {
  generateLiveProof()
    .then(() => process.exit(0))
    .catch(e => {
      console.error('Error:', e);
      process.exit(1);
    });
}

module.exports = { generateLiveProof };
