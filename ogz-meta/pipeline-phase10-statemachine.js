#!/usr/bin/env node
/**
 * OGZPrime Phase 10: STATE MACHINE VALIDATOR
 * ============================================
 *
 * PURPOSE: Model the bot's valid states and transitions.
 * Any invalid transition = a bug that produced an impossible state.
 *
 * VALID STATES:
 *   IDLE          — No position, no active trades, waiting for signal
 *   ENTERING      — Signal received, position being opened
 *   IN_POSITION   — Position open, monitoring for exit
 *   EXITING       — Exit triggered, position being closed
 *   PARTIAL       — Partial exit done, reduced position still open
 *   COOLDOWN      — Just exited, waiting before next trade
 *
 * VALID TRANSITIONS:
 *   IDLE → ENTERING         (BUY signal with sufficient confidence)
 *   ENTERING → IN_POSITION  (Position confirmed open)
 *   ENTERING → IDLE         (Entry failed/rejected)
 *   IN_POSITION → EXITING   (Exit signal: SL, TP, trailing, max_hold, tiered)
 *   IN_POSITION → PARTIAL   (Partial exit from tiered profit system)
 *   PARTIAL → EXITING       (Full exit of remaining position)
 *   PARTIAL → PARTIAL       (Another partial exit tier)
 *   EXITING → COOLDOWN      (Position confirmed closed)
 *   EXITING → IN_POSITION   (Exit failed, still holding)
 *   COOLDOWN → IDLE         (Cooldown period elapsed)
 *
 * INVALID TRANSITIONS (bugs):
 *   IDLE → EXITING           (Selling nothing)
 *   IDLE → PARTIAL           (Partial exit of nothing)
 *   IN_POSITION → ENTERING   (Buying when already in position)
 *   EXITING → ENTERING       (Buying during exit)
 *   COOLDOWN → EXITING       (Selling during cooldown)
 *
 * Usage:
 *   node ogz-meta/pipeline-phase10-statemachine.js                          # Analyze backtest CSV
 *   node ogz-meta/pipeline-phase10-statemachine.js --file path/to/trades.csv
 *   node ogz-meta/pipeline-phase10-statemachine.js --json
 *
 * Created: 2026-02-24 | Catches impossible state transitions
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const csvFileArg = args.find(a => a.startsWith('--file='));
const CSV_FILE = csvFileArg
  ? csvFileArg.split('=')[1]
  : path.join(ROOT, 'backtest-trades.csv');

// ─── STATE DEFINITIONS ───────────────────────────────────────
const STATES = {
  IDLE: 'IDLE',
  ENTERING: 'ENTERING',
  IN_POSITION: 'IN_POSITION',
  EXITING: 'EXITING',
  PARTIAL: 'PARTIAL',
  COOLDOWN: 'COOLDOWN',
};

// Valid transitions: fromState → [toStates]
const VALID_TRANSITIONS = {
  IDLE: ['ENTERING'],
  ENTERING: ['IN_POSITION', 'IDLE'],
  IN_POSITION: ['EXITING', 'PARTIAL'],
  PARTIAL: ['EXITING', 'PARTIAL'],
  EXITING: ['COOLDOWN', 'IN_POSITION', 'IDLE'],
  COOLDOWN: ['IDLE'],
};

// ─── RESULTS ─────────────────────────────────────────────────
let totalEvents = 0;
let validTransitions = 0;
let invalidTransitions = 0;
const violations = [];
const stateHistory = [];

function logTransition(from, to, event, tradeNum, detail) {
  totalEvents++;
  const isValid = VALID_TRANSITIONS[from]?.includes(to);
  const entry = {
    trade: tradeNum,
    from,
    to,
    event,
    valid: isValid,
    detail,
  };
  stateHistory.push(entry);

  if (isValid) {
    validTransitions++;
  } else {
    invalidTransitions++;
    violations.push(entry);
  }
  return isValid;
}

// ─── PARSE BACKTEST CSV ──────────────────────────────────────
function parseCSV(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const trades = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const trade = {};
    for (let j = 0; j < headers.length; j++) {
      trade[headers[j]] = values[j];
    }
    trade._lineNum = i + 1;
    trades.push(trade);
  }

  return trades;
}

// ─── RUN STATE MACHINE AGAINST TRADES ────────────────────────
function validateTrades(trades) {
  let currentState = STATES.IDLE;
  let positionSize = 0;
  let entryPrice = 0;
  let tradeCount = 0;
  let lastExitTime = null;

  for (const trade of trades) {
    tradeCount++;
    const action = (trade.action || trade.side || trade.direction || '').toUpperCase();
    const exitReason = trade.exitReason || trade.exit_reason || trade.reason || '';
    const size = parseFloat(trade.size || trade.positionSize || trade.amount || 0);
    const price = parseFloat(trade.price || trade.entryPrice || trade.entry_price || 0);
    const pnl = parseFloat(trade.pnl || trade.profit || trade.net_pnl || 0);
    const time = trade.time || trade.timestamp || trade.entryTime || '';

    if (action === 'BUY' || action === 'LONG' || action === 'ENTRY') {
      // ── ENTRY EVENT ──

      // Check: Can we enter from current state?
      const prevState = currentState;
      const newState = STATES.ENTERING;
      const valid = logTransition(prevState, newState, `BUY #${tradeCount}`, tradeCount,
        `price=${price}, size=${size}`);

      if (!valid) {
        if (prevState === STATES.IN_POSITION) {
          // Buying while already in position — double entry
          violations[violations.length - 1].bugType = 'DOUBLE_ENTRY';
          violations[violations.length - 1].severity = 'CRITICAL';
          violations[violations.length - 1].detail = `Already in position (size=${positionSize}) but trying to BUY again at ${price}`;
        }
      }

      // Transition to IN_POSITION (assuming instant fill for backtest)
      currentState = STATES.IN_POSITION;
      logTransition(STATES.ENTERING, STATES.IN_POSITION, `FILL #${tradeCount}`, tradeCount,
        `position=${size}@${price}`);
      positionSize = size;
      entryPrice = price;

    } else if (action === 'SELL' || action === 'SHORT' || action === 'EXIT' || action === 'CLOSE') {
      // ── EXIT EVENT ──

      const prevState = currentState;
      const isPartial = exitReason.includes('partial') || exitReason.includes('tier');
      const newState = isPartial ? STATES.PARTIAL : STATES.EXITING;

      const valid = logTransition(prevState, newState, `${isPartial ? 'PARTIAL' : 'SELL'} #${tradeCount}`, tradeCount,
        `reason=${exitReason}, pnl=${pnl}`);

      if (!valid) {
        if (prevState === STATES.IDLE) {
          violations[violations.length - 1].bugType = 'SELL_NOTHING';
          violations[violations.length - 1].severity = 'CRITICAL';
          violations[violations.length - 1].detail = `Trying to SELL with no position! exitReason=${exitReason}`;
        } else if (prevState === STATES.COOLDOWN) {
          violations[violations.length - 1].bugType = 'SELL_IN_COOLDOWN';
          violations[violations.length - 1].severity = 'HIGH';
          violations[violations.length - 1].detail = `Selling during cooldown period`;
        }
      }

      if (isPartial) {
        // Partial exit — still in position with reduced size
        currentState = STATES.PARTIAL;
        positionSize *= 0.7; // Approximate remaining after partial
      } else {
        // Full exit
        currentState = STATES.COOLDOWN;
        logTransition(STATES.EXITING, STATES.COOLDOWN, `CLOSED #${tradeCount}`, tradeCount,
          `pnl=${pnl}`);
        positionSize = 0;
        entryPrice = 0;
        lastExitTime = time;

        // Instant cooldown transition for backtest (no real time delay)
        currentState = STATES.IDLE;
        logTransition(STATES.COOLDOWN, STATES.IDLE, `READY #${tradeCount}`, tradeCount, '');
      }

    } else {
      // ── UNKNOWN ACTION ──
      // In backtest CSV, each row is typically an entry+exit pair
      // Try to infer from fields

      if (trade.entryPrice && trade.exitPrice) {
        // This is a complete trade record (entry + exit in one row)
        const ep = parseFloat(trade.entryPrice || trade.entry_price);
        const xp = parseFloat(trade.exitPrice || trade.exit_price);

        // Entry
        const prevState = currentState;
        logTransition(prevState, STATES.ENTERING, `ENTRY #${tradeCount}`, tradeCount,
          `entry=${ep}`);

        if (prevState !== STATES.IDLE) {
          if (violations.length > 0) {
            violations[violations.length - 1].bugType = 'ENTRY_WITHOUT_IDLE';
            violations[violations.length - 1].severity = prevState === STATES.IN_POSITION ? 'CRITICAL' : 'HIGH';
          }
        }

        currentState = STATES.IN_POSITION;
        logTransition(STATES.ENTERING, STATES.IN_POSITION, `FILL #${tradeCount}`, tradeCount,
          `position@${ep}`);

        // Exit
        const isPartial = exitReason.includes('partial') || exitReason.includes('tier');
        if (isPartial) {
          currentState = STATES.PARTIAL;
          logTransition(STATES.IN_POSITION, STATES.PARTIAL, `PARTIAL #${tradeCount}`, tradeCount,
            `reason=${exitReason}`);
        }

        currentState = STATES.EXITING;
        logTransition(isPartial ? STATES.PARTIAL : STATES.IN_POSITION, STATES.EXITING,
          `EXIT #${tradeCount}`, tradeCount, `exit=${xp}, reason=${exitReason}`);

        currentState = STATES.COOLDOWN;
        logTransition(STATES.EXITING, STATES.COOLDOWN, `CLOSED #${tradeCount}`, tradeCount,
          `pnl=${pnl}`);

        currentState = STATES.IDLE;
        logTransition(STATES.COOLDOWN, STATES.IDLE, `READY #${tradeCount}`, tradeCount, '');

        positionSize = 0;
        entryPrice = 0;
      }
    }
  }

  // ── CHECK FINAL STATE ──
  if (currentState !== STATES.IDLE) {
    violations.push({
      trade: tradeCount,
      from: currentState,
      to: 'END',
      event: 'SESSION_END',
      valid: false,
      bugType: 'DANGLING_POSITION',
      severity: 'HIGH',
      detail: `Session ended in state ${currentState} (positionSize=${positionSize}) — position may not have been closed`,
    });
    invalidTransitions++;
  }
}

// ─── ANALYZE PATTERNS ────────────────────────────────────────
function analyzePatterns(trades) {
  const patterns = {
    consecutiveEntries: 0,
    consecutiveExits: 0,
    maxConsecutiveEntries: 0,
    maxConsecutiveExits: 0,
    entryExitPairs: 0,
    orphanEntries: 0,
    orphanExits: 0,
  };

  let lastAction = null;
  let consecutiveCount = 0;

  for (const trade of trades) {
    const action = (trade.action || trade.side || '').toUpperCase();
    const isEntry = action === 'BUY' || action === 'LONG' || action === 'ENTRY';
    const isExit = action === 'SELL' || action === 'SHORT' || action === 'EXIT';
    const currentAction = isEntry ? 'entry' : isExit ? 'exit' : 'complete';

    if (currentAction === lastAction) {
      consecutiveCount++;
      if (currentAction === 'entry') {
        patterns.consecutiveEntries = Math.max(patterns.consecutiveEntries, consecutiveCount);
      } else if (currentAction === 'exit') {
        patterns.consecutiveExits = Math.max(patterns.consecutiveExits, consecutiveCount);
      }
    } else {
      consecutiveCount = 1;
    }
    lastAction = currentAction;
  }

  return patterns;
}

// ─── STATIC CODE ANALYSIS ────────────────────────────────────
// Check that the code enforces state machine rules
function analyzeCodeStateGuards() {
  const issues = [];

  try {
    const mainBot = fs.readFileSync(path.join(ROOT, 'run-empire-v2.js'), 'utf8');

    // Check: Is there a position check before BUY?
    // Look for pattern: action === 'BUY' and nearby position/activeTrades check
    const buyBlocks = mainBot.match(/action\s*===?\s*['"]BUY['"][\s\S]{0,500}/g) || [];
    let hasBuyGuard = false;
    for (const block of buyBlocks) {
      if (/position|activeTrades|inPosition|hasPosition/.test(block)) {
        hasBuyGuard = true;
        break;
      }
    }
    if (!hasBuyGuard) {
      issues.push({
        type: 'MISSING_GUARD',
        severity: 'CRITICAL',
        detail: 'BUY action has no position check — could double-enter',
        fix: 'Add: if (stateManager.get("position") > 0) return; before BUY execution',
      });
    }

    // Check: Is there a position check before SELL?
    const sellBlocks = mainBot.match(/action\s*===?\s*['"]SELL['"][\s\S]{0,500}/g) || [];
    let hasSellGuard = false;
    for (const block of sellBlocks) {
      if (/position|activeTrades|inPosition|hasPosition/.test(block)) {
        hasSellGuard = true;
        break;
      }
    }
    if (!hasSellGuard) {
      issues.push({
        type: 'MISSING_GUARD',
        severity: 'CRITICAL',
        detail: 'SELL action has no position check — could sell nothing',
        fix: 'Add: if (stateManager.get("position") === 0) return; before SELL execution',
      });
    }

    // Check: Is there a cooldown mechanism?
    const hasCooldown = /cooldown|COOLDOWN|lastExitTime|minTimeBetweenTrades/.test(mainBot);
    if (!hasCooldown) {
      issues.push({
        type: 'MISSING_STATE',
        severity: 'HIGH',
        detail: 'No cooldown mechanism found — could rapid-fire trades after exit',
        fix: 'Add cooldown timer: no new entry for N candles after exit',
      });
    }

    // Check: Does closePosition verify position exists?
    const closeBlocks = mainBot.match(/closePosition[\s\S]{0,300}/g) || [];
    let closeChecksPosition = false;
    for (const block of closeBlocks) {
      if (/position.*>.*0|position.*===.*0|activeTrades/.test(block)) {
        closeChecksPosition = true;
        break;
      }
    }
    if (!closeChecksPosition) {
      issues.push({
        type: 'MISSING_GUARD',
        severity: 'HIGH',
        detail: 'closePosition() may not verify position exists before closing',
        fix: 'Add position existence check at top of closePosition()',
      });
    }

  } catch (e) {
    issues.push({ type: 'SCAN_ERROR', severity: 'LOW', detail: e.message });
  }

  return issues;
}

// ─── PRINT RESULTS ───────────────────────────────────────────
function printResults() {
  if (!JSON_OUT) {
    console.log(`\n${'╔'.padEnd(64, '═')}╗`);
    console.log(`║  OGZPrime Phase 10: STATE MACHINE VALIDATOR                 ║`);
    console.log(`║  "Every state change must be legal"                         ║`);
    console.log(`║  ${new Date().toISOString().padEnd(61)}║`);
    console.log(`${'╚'.padEnd(64, '═')}╝`);
  }

  // ── Trade Analysis ──
  if (!JSON_OUT) {
    console.log(`\n${'═'.repeat(65)}`);
    console.log(`  TRADE LOG STATE MACHINE ANALYSIS`);
    console.log(`${'═'.repeat(65)}`);
    console.log(`\n  Total state transitions: ${totalEvents}`);
    console.log(`  ✅ Valid:   ${validTransitions}`);
    console.log(`  ❌ Invalid: ${invalidTransitions}`);
  }

  if (violations.length > 0 && !JSON_OUT) {
    console.log(`\n${'─'.repeat(65)}`);
    console.log(`  STATE VIOLATIONS:`);
    console.log(`${'─'.repeat(65)}`);

    for (const v of violations) {
      const sev = v.severity === 'CRITICAL' ? '🔴' : v.severity === 'HIGH' ? '🟠' : '🟡';
      console.log(`\n  ${sev} Trade #${v.trade}: ${v.from} → ${v.to} (${v.event})`);
      console.log(`     Type: ${v.bugType || 'INVALID_TRANSITION'}`);
      console.log(`     ${v.detail}`);
    }
  } else if (!JSON_OUT) {
    console.log(`\n  ✅ All state transitions are valid`);
  }

  // ── Code Guard Analysis ──
  if (!JSON_OUT) {
    console.log(`\n${'═'.repeat(65)}`);
    console.log(`  CODE STATE GUARDS ANALYSIS`);
    console.log(`${'═'.repeat(65)}`);
  }

  const codeIssues = analyzeCodeStateGuards();
  if (codeIssues.length > 0 && !JSON_OUT) {
    for (const issue of codeIssues) {
      const sev = issue.severity === 'CRITICAL' ? '🔴' : issue.severity === 'HIGH' ? '🟠' : '🟡';
      console.log(`\n  ${sev} ${issue.type}: ${issue.detail}`);
      if (issue.fix) console.log(`     💡 FIX: ${issue.fix}`);
    }
  } else if (!JSON_OUT) {
    console.log(`\n  ✅ All state guards present in code`);
  }

  // ── Summary ──
  if (!JSON_OUT) {
    console.log(`\n${'═'.repeat(65)}`);
    console.log(`  SUMMARY`);
    console.log(`${'═'.repeat(65)}`);
    console.log(`  State transitions:  ${totalEvents}`);
    console.log(`  Valid:              ${validTransitions}`);
    console.log(`  Invalid:            ${invalidTransitions}`);
    console.log(`  Code guard issues:  ${codeIssues.length}`);
    console.log(`  Verdict:            ${invalidTransitions === 0 && codeIssues.length === 0
      ? '🟢 STATE MACHINE CLEAN' : '🔴 STATE VIOLATIONS FOUND'}`);
    console.log(`${'═'.repeat(65)}\n`);
  }

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    totalEvents, validTransitions, invalidTransitions,
    violations,
    codeIssues: analyzeCodeStateGuards(),
    summary: {
      passRate: totalEvents > 0 ? ((validTransitions / totalEvents) * 100).toFixed(1) + '%' : 'N/A',
    }
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const reportDir = path.join(ROOT, 'logs');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `phase10-statemachine-${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`  📄 Report saved: ${reportPath}\n`);
  }

  process.exit(invalidTransitions > 0 || codeIssues.length > 0 ? 1 : 0);
}

// ─── MAIN ────────────────────────────────────────────────────
function main() {
  if (fs.existsSync(CSV_FILE)) {
    if (!JSON_OUT) console.log(`  📁 Loading trades from: ${path.relative(ROOT, CSV_FILE)}`);
    const trades = parseCSV(CSV_FILE);
    if (!JSON_OUT) console.log(`  📊 Found ${trades.length} trades\n`);
    validateTrades(trades);
  } else {
    if (!JSON_OUT) console.log(`  ⚠️  No backtest CSV found at ${CSV_FILE}`);
    if (!JSON_OUT) console.log(`  Running code analysis only...\n`);
  }

  printResults();
}

main();
