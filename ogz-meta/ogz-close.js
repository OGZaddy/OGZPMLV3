#!/usr/bin/env node

/**
 * ogz-close.js
 * Close out a fix and feed it into the RAG ledger.
 * 
 * Run this AFTER you deploy a fix — whether it came from Claude,
 * GPT, Claude Code, DeepSeek, or your own brain.
 * 
 * This is what breaks the amnesia loop. Without this, the next
 * AI session has no idea what was fixed.
 * 
 * USAGE:
 *   node ogz-meta/ogz-close.js "what was the problem" --fix "what fixed it"
 * 
 * FULL OPTIONS:
 *   node ogz-meta/ogz-close.js "symptom description" \
 *     --fix "root cause and what fixed it" \
 *     --files "file1.js,file2.js" \
 *     --severity CRITICAL|HIGH|MEDIUM|LOW \
 *     --worked "what approach worked" \
 *     --failed "what was tried and didn't work" \
 *     --tags "tag1,tag2"
 * 
 * QUICK MODE (just the essentials):
 *   node ogz-meta/ogz-close.js "Y-axis not rescaling" --fix "reset bounds in switchAsset"
 * 
 * INTERACTIVE MODE (asks you questions):
 *   node ogz-meta/ogz-close.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const META_DIR = __dirname;
const LEDGER_FILE = path.join(META_DIR, 'ledger', 'fixes.jsonl');
const SESSIONS_DIR = path.join(META_DIR, 'sessions');

// Colors
const C = {
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', bold: '\x1b[1m',
  dim: '\x1b[2m', reset: '\x1b[0m'
};

/**
 * Parse CLI args
 */
function parseArgs(argv) {
  const args = { symptom: '', fix: '', files: [], severity: 'MEDIUM', worked: [], failed: [], tags: [] };
  
  // First non-flag arg is the symptom
  const positional = [];
  
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    
    if (arg === '--fix' && argv[i + 1]) {
      args.fix = argv[++i];
    } else if (arg === '--files' && argv[i + 1]) {
      args.files = argv[++i].split(',').map(f => f.trim());
    } else if (arg === '--severity' && argv[i + 1]) {
      args.severity = argv[++i].toUpperCase();
    } else if (arg === '--worked' && argv[i + 1]) {
      args.worked = argv[++i].split(',').map(w => w.trim());
    } else if (arg === '--failed' && argv[i + 1]) {
      args.failed = argv[++i].split(',').map(f => f.trim());
    } else if (arg === '--tags' && argv[i + 1]) {
      args.tags = argv[++i].split(',').map(t => t.trim());
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }
  
  args.symptom = positional.join(' ');
  return args;
}

/**
 * Interactive mode - ask questions
 */
async function interactive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log(`\n${C.cyan}${'═'.repeat(55)}${C.reset}`);
  console.log(`${C.bold}  📋 OGZPrime — Close Out a Fix${C.reset}`);
  console.log(`${C.cyan}${'═'.repeat(55)}${C.reset}\n`);

  // Check for recent sessions to reference
  if (fs.existsSync(SESSIONS_DIR)) {
    const recent = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, 3);
    
    if (recent.length > 0) {
      console.log(`${C.dim}Recent sessions:${C.reset}`);
      recent.forEach(f => console.log(`  ${C.dim}${f}${C.reset}`));
      console.log('');
    }
  }

  const symptom = await ask(`${C.bold}What was the problem?${C.reset}\n  > `);
  const fix = await ask(`\n${C.bold}What fixed it? (root cause + solution)${C.reset}\n  > `);
  const filesRaw = await ask(`\n${C.bold}What files were changed?${C.reset} (comma-separated, or Enter to skip)\n  > `);
  const severity = await ask(`\n${C.bold}Severity?${C.reset} [CRITICAL/HIGH/MEDIUM/LOW] (default: MEDIUM)\n  > `);
  const workedRaw = await ask(`\n${C.bold}What approach worked?${C.reset} (or Enter to skip)\n  > `);
  const failedRaw = await ask(`\n${C.bold}What was tried and DIDN'T work?${C.reset} (or Enter to skip)\n  > `);
  const tagsRaw = await ask(`\n${C.bold}Tags?${C.reset} (comma-separated, e.g. dashboard,chart,y-axis — or Enter to auto-generate)\n  > `);

  rl.close();

  return {
    symptom: symptom.trim(),
    fix: fix.trim(),
    files: filesRaw.trim() ? filesRaw.split(',').map(f => f.trim()) : [],
    severity: (severity.trim().toUpperCase() || 'MEDIUM'),
    worked: workedRaw.trim() ? [workedRaw.trim()] : [],
    failed: failedRaw.trim() ? [failedRaw.trim()] : [],
    tags: tagsRaw.trim() ? tagsRaw.split(',').map(t => t.trim()) : []
  };
}

/**
 * Auto-generate tags from symptom and fix text
 */
function autoTags(symptom, fix) {
  const text = `${symptom} ${fix}`.toLowerCase();
  const tagMap = {
    'dashboard': 'dashboard',
    'chart': 'chart',
    'websocket': 'websocket',
    'ws': 'websocket',
    'pattern': 'pattern',
    'memory': 'memory',
    'state': 'state',
    'statemanager': 'state',
    'trade': 'trading',
    'trading': 'trading',
    'position': 'trading',
    'balance': 'trading',
    'kraken': 'kraken',
    'broker': 'broker',
    'indicator': 'indicators',
    'rsi': 'indicators',
    'macd': 'indicators',
    'atr': 'indicators',
    'fibonacci': 'indicators',
    'ssl': 'ssl',
    'trai': 'trai',
    'brain': 'trading-brain',
    'risk': 'risk',
    'exit': 'exit-logic',
    'entry': 'entry-logic',
    'candle': 'candles',
    'y-axis': 'chart',
    'axis': 'chart',
    'rescal': 'chart',
    'render': 'dashboard',
    'display': 'dashboard',
    'pm2': 'deployment',
    'restart': 'deployment',
    'crash': 'crash',
    'loop': 'crash',
    'singleton': 'state',
    'serialize': 'state',
    'json': 'data',
    'polygon': 'data-feed',
    'timeout': 'connection',
    'disconnect': 'connection'
  };

  const tags = new Set();
  for (const [keyword, tag] of Object.entries(tagMap)) {
    if (text.includes(keyword)) tags.add(tag);
  }

  return [...tags];
}

/**
 * Generate fix ID
 */
function generateFixId(symptom) {
  const date = new Date().toISOString().split('T')[0];
  const slug = symptom
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `FIX-${date}-${slug}`;
}

/**
 * Capture current bot state for the close-out
 */
function captureState() {
  const state = {};
  
  try {
    const pm2Json = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    const procs = JSON.parse(pm2Json);
    const bot = procs.find(p => p.name.toLowerCase().includes('ogz'));
    if (bot) {
      state.pm2 = bot.pm2_env?.status || 'unknown';
      state.restarts = bot.pm2_env?.restart_time || 0;
    }
  } catch (e) { state.pm2 = 'unavailable'; }

  try {
    const stateFile = path.join(META_DIR, '..', 'data', 'state.json');
    if (fs.existsSync(stateFile)) {
      const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      state.balance = s.balance ? `$${s.balance.toFixed(2)}` : 'unknown';
      state.inPosition = s.position > 0;
    }
  } catch (e) { /* */ }

  return state;
}

/**
 * Write to RAG ledger
 */
function writeToLedger(entry) {
  const ledgerDir = path.dirname(LEDGER_FILE);
  if (!fs.existsSync(ledgerDir)) fs.mkdirSync(ledgerDir, { recursive: true });
  fs.appendFileSync(LEDGER_FILE, JSON.stringify(entry) + '\n');
}

/**
 * Main
 */
async function main() {
  let args;
  
  // If no args, go interactive
  if (process.argv.length <= 2) {
    args = await interactive();
  } else {
    args = parseArgs(process.argv);
  }

  // Validate
  if (!args.symptom) {
    console.error(`${C.red}Error: Must provide a symptom/problem description${C.reset}`);
    console.log('\nUsage: node ogz-meta/ogz-close.js "what was the problem" --fix "what fixed it"');
    console.log('   Or: node ogz-meta/ogz-close.js   (interactive mode)');
    process.exit(1);
  }

  if (!args.fix) {
    console.error(`${C.red}Error: Must provide --fix "what fixed it"${C.reset}`);
    process.exit(1);
  }

  // Auto-generate tags if none provided
  if (args.tags.length === 0) {
    args.tags = autoTags(args.symptom, args.fix);
  }

  // Validate severity
  const validSeverities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  if (!validSeverities.includes(args.severity)) {
    args.severity = 'MEDIUM';
  }

  // Generate entry
  const fixId = generateFixId(args.symptom);
  const botState = captureState();
  const now = new Date();

  const ledgerEntry = {
    id: fixId,
    date: now.toISOString().split('T')[0],
    severity: args.severity,
    tags: args.tags,
    symptom: args.symptom,
    root_cause: args.fix,
    minimal_fix: args.fix,
    files: args.files,
    verification: [`Bot state at close: PM2=${botState.pm2}, Balance=${botState.balance || '?'}`],
    outcome: 'success',
    what_worked: args.worked.length > 0 ? args.worked : [args.fix],
    what_failed: args.failed,
    evidence: [],
    commit: null
  };

  // Write to ledger
  writeToLedger(ledgerEntry);

  // Count total entries
  const totalEntries = fs.readFileSync(LEDGER_FILE, 'utf8').split('\n').filter(l => l.trim()).length;

  // Print confirmation
  console.log(`\n${C.cyan}${'═'.repeat(55)}${C.reset}`);
  console.log(`${C.bold}  ✅ Fix logged to RAG ledger${C.reset}`);
  console.log(`${C.cyan}${'═'.repeat(55)}${C.reset}`);
  console.log(`
  ${C.bold}ID:${C.reset}        ${fixId}
  ${C.bold}Severity:${C.reset}  ${args.severity}
  ${C.bold}Symptom:${C.reset}   ${args.symptom}
  ${C.bold}Fix:${C.reset}       ${args.fix}
  ${C.bold}Files:${C.reset}     ${args.files.join(', ') || 'none specified'}
  ${C.bold}Tags:${C.reset}      ${args.tags.join(', ')}
  ${C.bold}Worked:${C.reset}    ${args.worked.join(', ') || args.fix}
  ${C.bold}Failed:${C.reset}    ${args.failed.join(', ') || 'nothing noted'}
  
  ${C.dim}Ledger: ${LEDGER_FILE}${C.reset}
  ${C.dim}Total entries: ${totalEntries}${C.reset}
  
  ${C.green}Next AI session will know about this fix.${C.reset}
`);
}

main().catch(err => {
  console.error(`${C.red}Error: ${err.message}${C.reset}`);
  process.exit(1);
});
