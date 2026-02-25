/**
 * QUICK VALIDATION V3: Captures ALL output, writes own report
 */
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const DATA_FILE = path.join(__dirname, 'data', 'polygon-btc-1y.json');
const TEMP_FILE = path.join(__dirname, 'data', 'quick-val.json');

const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const candles = raw.candles || raw;
fs.writeFileSync(TEMP_FILE, JSON.stringify(candles.slice(0, 2000)));

console.log('Quick validation V3: 2000 candles, 15% threshold, VERBOSE ON...\n');

const child = fork(path.join(__dirname, 'run-empire-v2.js'), [], {
  env: {
    ...process.env,
    BACKTEST_MODE: 'true',
    BACKTEST_VERBOSE: 'true',
    BACKTEST_SILENT: 'false',
    BACKTEST_FAST: 'true',
    PAPER_TRADING: 'true',
    ENABLE_TRAI: 'false',
    MIN_TRADE_CONFIDENCE: '0.15',
    EXIT_SYSTEM: 'maxprofit',
    KRAKEN_API_KEY: 'backtest',
    KRAKEN_API_SECRET: 'backtest',
    POLYGON_API_KEY: 'backtest',
    CANDLE_DATA_FILE: TEMP_FILE,
  },
  silent: true
});

let output = '';
let trades = [];

child.stdout.on('data', (d) => {
  const lines = d.toString().split('\n');
  for (const line of lines) {
    output += line + '\n';
    
    // Capture trade events
    if (line.includes('Opening position') || line.includes('POSITION OPENED')) {
      trades.push({ type: 'OPEN', line: line.trim() });
      console.log('  📈 ' + line.trim());
    }
    if (line.includes('Closing position') || line.includes('POSITION CLOSED') || line.includes('EXIT')) {
      trades.push({ type: 'CLOSE', line: line.trim() });
      console.log('  📉 ' + line.trim());
    }
    if (line.includes('BUY DECISION') || line.includes('SELL DECISION')) {
      console.log('  🎯 ' + line.trim().substring(0, 120));
    }
    if (line.includes('executeTrade called') || line.includes('TRADE EXECUTED')) {
      console.log('  ⚡ ' + line.trim().substring(0, 120));
    }
    if (line.includes('BACKTEST COMPLETE') || 
        line.includes('Final Balance') || 
        line.includes('Total P&L') ||
        line.includes('Win Rate') ||
        line.includes('Wins:') ||
        line.includes('Losses:') ||
        line.includes('Total Trades') ||
        line.includes('Candles processed')) {
      console.log('  ' + line.trim());
    }
  }
});

child.stderr.on('data', (d) => {
  const line = d.toString().trim();
  if (line.includes('FATAL') || line.includes('Cannot find module')) {
    console.log('  ❌ ' + line.substring(0, 150));
  }
});

child.on('exit', (code) => {
  try { fs.unlinkSync(TEMP_FILE); } catch(e) {}
  
  console.log('\n' + '='.repeat(60));
  console.log('  TRADE LOG (' + trades.length + ' events captured)');
  console.log('='.repeat(60));
  trades.forEach((t, i) => console.log(`  ${i+1}. [${t.type}] ${t.line.substring(0, 100)}`));
  
  // Save full output for debugging
  fs.writeFileSync('quick-val-output.txt', output);
  console.log('\n  Full output saved to quick-val-output.txt');
  console.log('='.repeat(60));
});
