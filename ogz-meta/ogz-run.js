#!/usr/bin/env node

/**
 * ogz-run.js
 * ONE COMMAND. FULL PIPELINE. NO EXCUSES.
 * 
 * Usage:
 *   node ogz-meta/ogz-run.js "fix pattern detection showing fake data"
 * 
 * What it does:
 *   1. Captures bot state (PM2, balance, position, connections)
 *   2. Searches RAG ledger for known issues (don't repeat old mistakes)
 *   3. Calls DeepSeek to analyze code and find bugs
 *   4. Calls DeepSeek to generate fix proposals with BEFORE/AFTER patches
 *   5. Calls DeepSeek to review its own fixes for safety
 *   6. Runs syntax check on main bot file
 *   7. Generates PROPOSAL document (human reviews before anything changes)
 *   8. Generates SESSION FORM with all sections filled
 *   9. Updates RAG ledger with findings
 *   10. Saves everything to ogz-meta/sessions/ and ogz-meta/proposals/
 * 
 * NO code is changed. YOU review the proposal, then apply manually.
 * The form and RAG get populated regardless.
 * 
 * That's it. One command. Stop the amnesia loop.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');

// ── PATHS ──
const PROJECT_DIR = path.resolve(__dirname, '..');
const META_DIR = __dirname;
const SESSIONS_DIR = path.join(META_DIR, 'sessions');
const PROPOSALS_DIR = path.join(META_DIR, 'proposals');
const MANIFESTS_DIR = path.join(META_DIR, 'manifests');
const LEDGER_FILE = path.join(META_DIR, 'ledger', 'fixes.jsonl');

// Ensure directories
[SESSIONS_DIR, PROPOSALS_DIR, MANIFESTS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── CONFIG ──
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'deepseek-r1:8b';
const MAX_CODE_LINES = 800;

// ── COLORS ──
const C = {
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', bold: '\x1b[1m',
  dim: '\x1b[2m', reset: '\x1b[0m'
};

function log(icon, msg) { console.log(`${icon}  ${msg}`); }
function header(msg) { console.log(`\n${C.cyan}${'═'.repeat(55)}${C.reset}\n${C.bold}  ${msg}${C.reset}\n${C.cyan}${'═'.repeat(55)}${C.reset}`); }
function step(n, total, msg) { console.log(`\n${C.blue}[${n}/${total}]${C.reset} ${C.bold}${msg}${C.reset}`); }

// ═══════════════════════════════════════════════════════════
// STEP 1: COLLECT BOT STATE
// ═══════════════════════════════════════════════════════════
function collectBotState() {
  const state = {
    pm2: { status: 'unknown', uptime: 'unknown', restarts: 0, memory: 'unknown', cpu: 'unknown' },
    trading: { mode: 'unknown', inPosition: 'unknown', balance: 'unknown', asset: 'unknown', dailyPnL: 'unknown' },
    connections: { ssl: false }
  };

  // PM2
  try {
    const pm2Json = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    const procs = JSON.parse(pm2Json);
    const bot = procs.find(p => p.name.toLowerCase().includes('ogz'));
    if (bot) {
      const env = bot.pm2_env || {};
      const mon = bot.monit || {};
      state.pm2.status = env.status || 'unknown';
      state.pm2.uptime = env.pm_uptime ? `${Math.floor((Date.now() - env.pm_uptime) / 60000)} min` : 'unknown';
      state.pm2.restarts = env.restart_time || 0;
      state.pm2.memory = mon.memory ? `${Math.round(mon.memory / 1024 / 1024)}MB` : 'unknown';
      state.pm2.cpu = mon.cpu !== undefined ? `${mon.cpu}%` : 'unknown';
    }
  } catch (e) { /* pm2 unavailable */ }

  // State.json
  try {
    const stateFile = path.join(PROJECT_DIR, 'data', 'state.json');
    if (fs.existsSync(stateFile)) {
      const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      state.trading.mode = s.mode || (s.paperTrading ? 'PAPER' : 'LIVE');
      state.trading.inPosition = s.position > 0 ? `Yes (${s.position} @ $${s.entryPrice || '?'})` : 'No';
      state.trading.balance = s.balance ? `$${s.balance.toFixed(2)}` : 'unknown';
      state.trading.asset = s.currentAsset || s.tradingPair || 'BTC-USD';
      state.trading.dailyPnL = s.dailyPnL ? `$${s.dailyPnL.toFixed(2)}` : '$0.00';
    }
  } catch (e) { /* state.json unavailable */ }

  // SSL
  try {
    execSync('pgrep -f "ogzprime-ssl-server" > /dev/null 2>&1');
    state.connections.ssl = true;
  } catch (e) { /* not running */ }

  return state;
}

// ═══════════════════════════════════════════════════════════
// STEP 2: RAG SEARCH
// ═══════════════════════════════════════════════════════════
function searchRAG(issue) {
  const results = { matches: [], warning: null };

  if (!fs.existsSync(LEDGER_FILE)) {
    results.warning = 'No fix ledger found — RAG is empty';
    return results;
  }

  const entries = fs.readFileSync(LEDGER_FILE, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(Boolean);

  const issueWords = issue.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  const scored = entries.map(entry => {
    let score = 0;
    const searchText = `${entry.symptom} ${entry.root_cause} ${entry.tags?.join(' ')} ${entry.files?.join(' ')}`.toLowerCase();
    issueWords.forEach(word => {
      if (searchText.includes(word)) score += 10;
    });
    return { ...entry, _score: score };
  }).filter(e => e._score > 0).sort((a, b) => b._score - a._score).slice(0, 5);

  results.matches = scored;
  return results;
}

// ═══════════════════════════════════════════════════════════
// STEP 3-5: AI BRAIN (DeepSeek via Ollama)
// ═══════════════════════════════════════════════════════════
async function callOllama(prompt, opts = {}) {
  const payload = JSON.stringify({
    model: opts.model || MODEL,
    prompt,
    stream: false,
    options: { temperature: opts.temp || 0.2, num_predict: opts.maxTokens || 8192 }
  });

  return new Promise((resolve, reject) => {
    const url = new URL('/api/generate', OLLAMA_HOST);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 120000
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data).response || ''); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

async function ollamaHealth() {
  return new Promise(resolve => {
    http.get(`${OLLAMA_HOST}/api/tags`, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ running: true, models: JSON.parse(d).models?.map(m => m.name) }); } catch (e) { resolve({ running: true }); } });
    }).on('error', () => resolve({ running: false }));
  });
}

function extractCode(filePath, issue, maxLines = MAX_CODE_LINES) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  if (lines.length <= maxLines) return { code: lines.join('\n'), full: true, lines: lines.length };

  const words = issue.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  let bestStart = 0, bestScore = 0;
  for (let i = 0; i <= lines.length - maxLines; i += 20) {
    const window = lines.slice(i, i + maxLines).join('\n').toLowerCase();
    let score = 0;
    words.forEach(w => { score += (window.match(new RegExp(w, 'g')) || []).length; });
    if (score > bestScore) { bestScore = score; bestStart = i; }
  }
  return { code: lines.slice(bestStart, bestStart + maxLines).join('\n'), startLine: bestStart + 1, full: false, lines: lines.length };
}

function findRelevantFiles(issue) {
  const files = [];
  const candidates = ['run-empire-v2.js', 'ogzprime-ssl-server.js', 'public/unified-dashboard.html'];

  // Add core modules
  const coreDir = path.join(PROJECT_DIR, 'core');
  if (fs.existsSync(coreDir)) {
    fs.readdirSync(coreDir).filter(f => f.endsWith('.js')).forEach(f => candidates.push(`core/${f}`));
  }

  const words = issue.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  for (const file of candidates) {
    const full = path.join(PROJECT_DIR, file);
    if (!fs.existsSync(full)) continue;
    const content = fs.readFileSync(full, 'utf8').toLowerCase();
    let score = 0;
    words.forEach(w => {
      if (file.toLowerCase().includes(w)) score += 20;
      score += Math.min((content.match(new RegExp(w, 'g')) || []).length, 10);
    });
    if (score > 0) files.push({ file, path: full, score });
  }

  return files.sort((a, b) => b.score - a.score).slice(0, 3);
}

// ═══════════════════════════════════════════════════════════
// STEP 6: SYNTAX CHECK
// ═══════════════════════════════════════════════════════════
function syntaxCheck() {
  const mainFile = path.join(PROJECT_DIR, 'run-empire-v2.js');
  if (!fs.existsSync(mainFile)) return { pass: false, error: 'run-empire-v2.js not found' };
  try {
    execSync(`node --check "${mainFile}"`, { encoding: 'utf8' });
    return { pass: true };
  } catch (e) {
    return { pass: false, error: e.message.slice(0, 500) };
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════
async function run(issue) {
  const TOTAL_STEPS = 10;
  const missionId = `MISSION-${Date.now()}`;
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const slug = issue.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);

  header(`🚀 OGZPrime Pipeline — ${missionId}`);
  log('📝', `Issue: ${issue}`);
  log('🕐', `Started: ${now.toISOString()}`);

  // ── COLLECT STATE ──
  step(1, TOTAL_STEPS, 'Collecting bot state...');
  const botState = collectBotState();
  log('📊', `PM2: ${botState.pm2.status} | Mem: ${botState.pm2.memory} | Restarts: ${botState.pm2.restarts}`);
  log('💰', `Mode: ${botState.trading.mode} | Position: ${botState.trading.inPosition} | Balance: ${botState.trading.balance}`);
  log('🔌', `SSL: ${botState.connections.ssl ? 'Running' : 'Down'}`);

  // ── RAG SEARCH ──
  step(2, TOTAL_STEPS, 'Searching RAG ledger...');
  const rag = searchRAG(issue);
  if (rag.warning) {
    log('⚠️', rag.warning);
  } else if (rag.matches.length > 0) {
    log('📚', `Found ${rag.matches.length} related past issues:`);
    rag.matches.slice(0, 3).forEach(m => {
      log('  ', `${C.dim}[${m.severity}] ${m.id}: ${(m.symptom || '').slice(0, 80)}${C.reset}`);
    });
  } else {
    log('✅', 'No similar past issues found — this appears to be new');
  }

  // ── AI ANALYSIS ──
  step(3, TOTAL_STEPS, 'Checking DeepSeek...');
  const health = await ollamaHealth();
  let aiBugs = [];
  let aiFixes = [];
  let aiReview = null;
  let aiRawAnalysis = '';
  let aiRawFix = '';
  let aiRawReview = '';

  if (!health.running) {
    log('⚠️', `Ollama not running. Start with: ollama serve`);
    log('⚠️', 'Continuing without AI analysis — form will still be generated');
  } else {
    log('🧠', `DeepSeek R1 available on ${OLLAMA_HOST}`);

    // Find relevant files
    const files = findRelevantFiles(issue);
    if (files.length === 0) {
      log('⚠️', 'No relevant files found for this issue');
    } else {
      log('📂', `Analyzing: ${files.map(f => f.file).join(', ')}`);

      // Build code context
      const codeBlocks = files.map(f => {
        const ext = extractCode(f.path, issue);
        if (!ext) return '';
        const label = ext.full ? `${f.file} (${ext.lines} lines)` : `${f.file} (lines ${ext.startLine}-${ext.startLine + MAX_CODE_LINES} of ${ext.lines})`;
        return `### ${label}\n\`\`\`javascript\n${ext.code}\n\`\`\``;
      }).filter(Boolean);

      // Known issues context
      const knownCtx = rag.matches.length > 0
        ? `\n## ALREADY FIXED (do NOT report these):\n${rag.matches.map(m => `- ${m.id}: ${m.symptom}`).join('\n')}\n`
        : '';

      // ── FIND BUGS ──
      step(4, TOTAL_STEPS, 'AI analyzing code for bugs...');
      try {
        aiRawAnalysis = await callOllama(`You are a code auditor analyzing a Node.js trading bot.

## ISSUE REPORTED:
${issue}
${knownCtx}
## CODE:
${codeBlocks.join('\n\n')}

## TASK:
Find bugs related to the reported issue. For each bug:
1. LOCATION: file and line
2. TYPE: category
3. DESCRIPTION: what's wrong
4. SEVERITY: CRITICAL/HIGH/MEDIUM/LOW
5. ROOT_CAUSE: why

Be specific. Reference actual variable and function names. If no bugs, say NO BUGS FOUND.`, { temp: 0.2, maxTokens: 8192});

        // Parse bugs
        const cleaned = aiRawAnalysis.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        const bugPattern = /(\d+)\.\s*([\s\S]*?)(?=\n\d+\.|$)/g;
        let match;
        while ((match = bugPattern.exec(cleaned)) !== null) {
          const block = match[2].trim();
          if (block.length < 15 || block.toLowerCase().includes('no bugs found')) continue;
          aiBugs.push({
            type: block.match(/TYPE:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || 'CODE_ISSUE',
            location: (block.match(/LOCATION:\s*(.+?)(?:\n|$)/i)?.[1] || block.match(/(\w+\.js)/)?.[0] || 'unknown').trim(),
            description: (block.match(/DESCRIPTION:\s*(.+?)(?:\n|$)/i)?.[1] || block.slice(0, 200)).trim(),
            severity: block.match(/CRITICAL/i) ? 'CRITICAL' : block.match(/HIGH/i) ? 'HIGH' : block.match(/LOW/i) ? 'LOW' : 'MEDIUM',
            rootCause: (block.match(/ROOT.?CAUSE:\s*(.+?)(?:\n|$)/i)?.[1] || '').trim()
          });
        }
        log('🔬', `Found ${aiBugs.length} bugs`);
        aiBugs.forEach((b, i) => log('  ', `${C.yellow}[${b.severity}]${C.reset} ${b.type}: ${b.description.slice(0, 80)}`));
      } catch (e) {
        log('❌', `Bug analysis failed: ${e.message}`);
      }

      // ── GENERATE FIXES ──
      if (aiBugs.length > 0) {
        step(5, TOTAL_STEPS, 'AI generating fix proposals...');
        const bugList = aiBugs.map((b, i) => `${i + 1}. [${b.severity}] ${b.type} at ${b.location}: ${b.description}`).join('\n');
        try {
          aiRawFix = await callOllama(`You are a code fixer for a Node.js trading bot.

## ISSUE: ${issue}

## BUGS:
${bugList}

## CODE:
${codeBlocks.join('\n\n')}

## TASK: Generate MINIMAL fixes. For each:
### Fix N: [description]
**File:** [filename]
**Line:** ~[number]

BEFORE:
\`\`\`javascript
[exact current code]
\`\`\`

AFTER:
\`\`\`javascript
[fixed code]
\`\`\`

**Why:** [1 sentence]

Be precise. Patches must be copy-paste ready. Change as FEW lines as possible.`, { temp: 0.1, maxTokens: 8192 });

          // Parse fixes
          const fixCleaned = aiRawFix.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
          const fixBlocks = fixCleaned.split(/(?=###?\s*Fix\s+\d)/i);
          for (const block of fixBlocks) {
            if (block.trim().length < 30) continue;
            const fix = {
              description: (block.match(/###?\s*Fix\s+\d+:?\s*(.*?)(?:\n|$)/i)?.[1] || '').trim(),
              file: (block.match(/\*?\*?File:?\*?\*?\s*`?(\S+\.(?:js|html))`?/i)?.[1] || 'unknown'),
              line: parseInt(block.match(/\*?\*?Line:?\*?\*?\s*~?(\d+)/i)?.[1] || '0') || null,
              before: (block.match(/BEFORE:?\s*\n```(?:javascript)?\n([\s\S]*?)```/i)?.[1] || '').trim(),
              after: (block.match(/AFTER:?\s*\n```(?:javascript)?\n([\s\S]*?)```/i)?.[1] || '').trim(),
              why: (block.match(/\*?\*?Why:?\*?\*?\s*(.+?)(?:\n|$)/i)?.[1] || '').trim()
            };
            if (fix.before || fix.after || fix.description) aiFixes.push(fix);
          }
          log('🔧', `Generated ${aiFixes.length} fix proposals`);
        } catch (e) {
          log('❌', `Fix generation failed: ${e.message}`);
        }

        // ── REVIEW FIXES ──
        if (aiFixes.length > 0) {
          step(6, TOTAL_STEPS, 'AI reviewing fixes for safety...');
          try {
            aiRawReview = await callOllama(`You are a code reviewer for a PRODUCTION trading bot. Safety is critical.

## ISSUE: ${issue}

## PROPOSED FIXES:
${aiFixes.map((f, i) => `Fix ${i + 1}: ${f.description}\nFile: ${f.file}\nBEFORE: ${f.before.slice(0, 300)}\nAFTER: ${f.after.slice(0, 300)}`).join('\n\n')}

## REVIEW:
For each fix: APPROVE or REJECT with reason.
Could any fix introduce new bugs? Edge cases? Break existing functionality?
Overall verdict: APPROVE ALL, APPROVE WITH WARNINGS, or REJECT.`, { temp: 0.2, maxTokens: 8192 });

            const reviewCleaned = aiRawReview.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            const approved = reviewCleaned.toLowerCase().includes('approve') && !reviewCleaned.match(/\breject\b/i);
            aiReview = { text: reviewCleaned, approved };
            log(approved ? '✅' : '⚠️', `Review verdict: ${approved ? 'APPROVED' : 'CONCERNS FLAGGED'}`);
          } catch (e) {
            log('❌', `Review failed: ${e.message}`);
          }
        }
      } else {
        step(5, TOTAL_STEPS, 'No bugs found — skipping fix generation');
        step(6, TOTAL_STEPS, 'No fixes to review — skipping');
      }
    }
  }

  // ── SYNTAX CHECK ──
  step(7, TOTAL_STEPS, 'Syntax check...');
  const syntax = syntaxCheck();
  log(syntax.pass ? '✅' : '❌', syntax.pass ? 'run-empire-v2.js syntax OK' : `Syntax error: ${syntax.error?.slice(0, 100)}`);

  // ── GENERATE PROPOSAL ──
  step(8, TOTAL_STEPS, 'Generating proposal document...');
  const proposalPath = path.join(PROPOSALS_DIR, `${missionId}-PROPOSAL.md`);
  const proposal = `# PROPOSAL: ${missionId}
Generated: ${now.toISOString()}
Model: ${MODEL}

## ⚠️ NO CODE CHANGED — Review and apply manually

---

## Issue
${issue}

## RAG Matches (Known Past Issues)
${rag.matches.length > 0 ? rag.matches.map(m => `- **${m.id}** [${m.severity}]: ${(m.symptom || '').slice(0, 100)}\n  Fix: ${(m.minimal_fix || '').slice(0, 100)}`).join('\n') : 'None found'}

## Bugs Found by AI
${aiBugs.length > 0 ? aiBugs.map((b, i) => `### Bug ${i + 1}: [${b.severity}] ${b.type}
- **Location:** ${b.location}
- **Description:** ${b.description}
- **Root Cause:** ${b.rootCause || 'See analysis'}`).join('\n\n') : 'No bugs found'}

## Proposed Fixes
${aiFixes.length > 0 ? aiFixes.map((f, i) => `### Fix ${i + 1}: ${f.description}
**File:** ${f.file}${f.line ? ` (line ~${f.line})` : ''}
**Why:** ${f.why}

**BEFORE:**
\`\`\`javascript
${f.before || '(not captured)'}
\`\`\`

**AFTER:**
\`\`\`javascript
${f.after || '(not captured)'}
\`\`\``).join('\n\n---\n\n') : 'No fixes generated'}

## AI Review
${aiReview ? `**Verdict:** ${aiReview.approved ? '✅ APPROVED' : '⚠️ CONCERNS'}\n\n${aiReview.text}` : 'No review performed'}

## Syntax Check
${syntax.pass ? '✅ PASS' : `❌ FAIL: ${syntax.error?.slice(0, 200)}`}

---

## Raw AI Analysis
\`\`\`
${(aiRawAnalysis || 'N/A').replace(/<think>[\s\S]*?<\/think>/g, '').slice(0, 3000)}
\`\`\`

## Raw AI Fix Output
\`\`\`
${(aiRawFix || 'N/A').replace(/<think>[\s\S]*?<\/think>/g, '').slice(0, 3000)}
\`\`\`

---
*Generated by ogz-run.js — Claudito Pipeline with DeepSeek R1*
`;
  fs.writeFileSync(proposalPath, proposal);
  log('📄', `Proposal: ${proposalPath}`);

  // ── GENERATE SESSION FORM ──
  step(9, TOTAL_STEPS, 'Generating session handoff form...');
  const formPath = path.join(SESSIONS_DIR, `SESSION-${dateStr}-${timeStr}-${slug}.md`);
  const endState = collectBotState();  // Capture end state too

  const sessionForm = `# OGZPrime Session Handoff Form

> Mission: ${missionId}
> Date: ${dateStr} ${now.toTimeString().split(' ')[0]}
> Generated by: ogz-run.js (automated pipeline)

---

## SECTION 1: SESSION IDENTITY

| Field | Value |
|-------|-------|
| **Date** | ${dateStr} |
| **Platform** | Automated Pipeline (DeepSeek R1 + ogz-run.js) |
| **Session Goal** | ${issue} |
| **Modules In Scope** | ${findRelevantFiles(issue).map(f => f.file).join(', ') || 'None identified'} |

---

## SECTION 2: BOT STATE AT SESSION START

| Field | Value |
|-------|-------|
| **PM2 Status** | ${botState.pm2.status} |
| **Uptime** | ${botState.pm2.uptime} |
| **Restarts** | ${botState.pm2.restarts} |
| **Memory** | ${botState.pm2.memory} |
| **Mode** | ${botState.trading.mode} |
| **In Position** | ${botState.trading.inPosition} |
| **Balance** | ${botState.trading.balance} |
| **Asset** | ${botState.trading.asset} |
| **Daily P&L** | ${botState.trading.dailyPnL} |
| **SSL Server** | ${botState.connections.ssl ? 'Running' : 'Down'} |

---

## SECTION 3: RAG CONTEXT

### Known Past Issues Checked
${rag.matches.length > 0 ? rag.matches.map(m => `- [${m.severity}] **${m.id}**: ${(m.symptom || '').slice(0, 100)}`).join('\n') : '- No related past issues found'}

---

## SECTION 4: WORK PERFORMED

### Bugs Found
${aiBugs.length > 0 ? aiBugs.map((b, i) => `| ${i + 1} | [${b.severity}] ${b.type} | ${b.location} | ${b.description.slice(0, 80)} |`).join('\n') : '| None found | | | |'}

### Fixes Proposed
${aiFixes.length > 0 ? aiFixes.map((f, i) => `| ${i + 1} | ${f.file} | ${f.description.slice(0, 60)} | ${f.why.slice(0, 60)} |`).join('\n') : '| None | | | |'}

### AI Review
${aiReview ? `**Verdict:** ${aiReview.approved ? '✅ Approved' : '⚠️ Concerns flagged'}` : 'Not performed (no fixes to review)'}

### Syntax Check
${syntax.pass ? '✅ PASS' : '❌ FAIL'}

### Decisions
- Pipeline ran in ADVISORY mode — no code changed
- ${aiFixes.length} fix proposals generated for human review
- Proposal document: \`${path.basename(proposalPath)}\`

---

## SECTION 5: BOT STATE AT SESSION END

| Field | Value |
|-------|-------|
| **PM2 Status** | ${endState.pm2.status} |
| **Restarts** | ${endState.pm2.restarts} |
| **Memory** | ${endState.pm2.memory} |
| **Balance** | ${endState.trading.balance} |
| **In Position** | ${endState.trading.inPosition} |
| **SSL** | ${endState.connections.ssl ? 'Running' : 'Down'} |

---

## SECTION 6: HANDOFF TO NEXT SESSION

### What's Ready
${aiFixes.length > 0 ? `- ${aiFixes.length} fix proposals ready for review in \`${path.basename(proposalPath)}\`` : '- No fixes generated'}

### What Needs Attention
${aiBugs.filter(b => b.severity === 'CRITICAL').length > 0 ? aiBugs.filter(b => b.severity === 'CRITICAL').map(b => `- **CRITICAL:** ${b.description.slice(0, 100)}`).join('\n') : '- No critical issues'}

### Next Steps
1. Review proposal: \`cat ${proposalPath}\`
2. Apply fixes manually if approved
3. Test: \`pm2 restart ogzprime && pm2 logs ogzprime --lines 30\`
4. Verify dashboard loads

---

*Generated: ${now.toISOString()} by ogz-run.js*
*Model: ${MODEL} via Ollama*
`;

  fs.writeFileSync(formPath, sessionForm);
  log('📋', `Session form: ${formPath}`);

  // ── UPDATE RAG ──
  step(10, TOTAL_STEPS, 'Updating RAG ledger...');
  if (aiBugs.length > 0) {
    const ledgerEntry = {
      id: missionId,
      date: dateStr,
      severity: aiBugs.some(b => b.severity === 'CRITICAL') ? 'CRITICAL' : aiBugs.some(b => b.severity === 'HIGH') ? 'HIGH' : 'MEDIUM',
      tags: [...new Set(aiBugs.map(b => b.type.toLowerCase().replace(/\s+/g, '-')))],
      symptom: issue,
      root_cause: aiBugs[0]?.rootCause || aiBugs[0]?.description || 'See proposal',
      minimal_fix: aiFixes[0]?.why || aiFixes[0]?.description || 'See proposal',
      files: [...new Set(aiFixes.map(f => f.file).filter(f => f !== 'unknown'))],
      verification: ['Review proposal document'],
      outcome: 'pending_review',
      what_worked: [],
      what_failed: [],
      evidence: [path.basename(proposalPath), path.basename(formPath)],
      commit: null
    };

    // Ensure ledger directory exists
    const ledgerDir = path.dirname(LEDGER_FILE);
    if (!fs.existsSync(ledgerDir)) fs.mkdirSync(ledgerDir, { recursive: true });

    fs.appendFileSync(LEDGER_FILE, JSON.stringify(ledgerEntry) + '\n');
    log('📚', 'RAG ledger updated with findings');
  } else {
    log('📚', 'No bugs found — ledger unchanged');
  }

  // ── SAVE MANIFEST ──
  const manifest = {
    mission_id: missionId,
    issue,
    started: now.toISOString(),
    completed: new Date().toISOString(),
    bot_state_start: botState,
    bot_state_end: endState,
    rag_matches: rag.matches.length,
    bugs_found: aiBugs.length,
    fixes_proposed: aiFixes.length,
    ai_review: aiReview?.approved ?? null,
    syntax_pass: syntax.pass,
    proposal: proposalPath,
    session_form: formPath,
    model: MODEL
  };
  const manifestPath = path.join(MANIFESTS_DIR, `${missionId}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // ── DONE ──
  header('✅ PIPELINE COMPLETE');
  console.log(`
  Mission:       ${missionId}
  Bugs found:    ${aiBugs.length}
  Fixes proposed:${aiFixes.length}
  AI review:     ${aiReview ? (aiReview.approved ? 'APPROVED' : 'CONCERNS') : 'N/A'}
  Syntax:        ${syntax.pass ? 'PASS' : 'FAIL'}

  📄 Proposal:   ${proposalPath}
  📋 Form:       ${formPath}
  📊 Manifest:   ${manifestPath}

  ${C.bold}Next: Review the proposal, apply fixes manually, restart bot.${C.reset}
`);
}

// ── CLI ──
const issue = process.argv.slice(2).join(' ');
if (!issue) {
  console.log(`
${C.bold}OGZPrime Pipeline — One Command${C.reset}

Usage:
  node ogz-meta/ogz-run.js "describe the problem"

Examples:
  node ogz-meta/ogz-run.js "pattern detection showing 8000 fake patterns"
  node ogz-meta/ogz-run.js "dashboard Y-axis not rescaling on asset switch"
  node ogz-meta/ogz-run.js "WebSocket disconnects after 30 minutes"

What happens:
  1. Captures bot state
  2. Searches RAG for past issues
  3. DeepSeek analyzes code + finds bugs
  4. DeepSeek generates fix proposals
  5. DeepSeek reviews fixes for safety
  6. Syntax check
  7. Writes PROPOSAL doc (you review)
  8. Writes SESSION FORM (automatic)
  9. Updates RAG ledger
  10. Done. No code changed. You decide what to apply.
`);
  process.exit(0);
}

run(issue).catch(err => {
  console.error(`\n${C.red}❌ PIPELINE FATAL: ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(1);
});
