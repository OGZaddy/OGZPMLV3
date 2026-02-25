#!/usr/bin/env node
/**
 * OGZPrime Pipeline Phase 7: HANDOFF VERIFICATION ENGINE
 * ========================================================
 * 
 * PURPOSE: Catches bugs that exist BETWEEN modules — where the pipe exists
 * but the water doesn't flow. Phases 1-6 verify structure. Phase 7 verifies VALUES.
 * 
 * THIS TOOL EXISTS BECAUSE:
 *   - 11 bugs lived in the exit system for 6 months undetected
 *   - 5 different AIs audited the code and said "looks good"
 *   - exit_partial !== partialExit was never caught by reading code
 *   - Tier targets at 2% on 15m candles was never caught by checking wiring
 *   - closePosition(price, false, null) ignoring exitSize was never caught
 * 
 * WHAT THIS CHECKS (that nothing else does):
 *   1. ACTION STRING MATCHING — Does Module A's output string match Module B's input check?
 *   2. PARAMETER FORWARDING — When A passes data to B, does B actually USE that data?
 *   3. CONFIG CONSISTENCY — Are .env values physically achievable given timeframe constraints?
 *   4. STRING COMPARISON INTEGRITY — Do === checks match the actual values being compared?
 *   5. CONFIG KEY MATCHING — Do config keys match between setter and getter?
 *   6. DUPLICATE ENV DETECTION — Are there conflicting .env entries?
 *   7. NUMERIC SANITY — Are trail/stop/target values in the right order?
 * 
 * DESIGN PRINCIPLE: Test with REAL values, not regex. Actually call functions,
 * capture what they return, and verify the receiver would accept it.
 * 
 * Usage:
 *   node ogz-meta/pipeline-phase7-handoff.js              # Full audit
 *   node ogz-meta/pipeline-phase7-handoff.js --json        # JSON output
 *   node ogz-meta/pipeline-phase7-handoff.js --fix-report  # Generate fix list
 * 
 * Created: 2026-02-24 by Trey + Opus cross-reference audit
 * Designed to catch every class of bug from the Feb 23 tiered exit discovery
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const FIX_REPORT = args.includes('--fix-report');

// ─── RESULTS TRACKING ────────────────────────────────────────
let totalChecks = 0;
let passed = 0;
let failed = 0;
let warnings = 0;
const results = {
  actionStrings: [],
  parameterForwarding: [],
  configConsistency: [],
  stringComparisons: [],
  configKeys: [],
  duplicateEnv: [],
  numericSanity: [],
  summary: {}
};

function check(category, name, condition, detail = '', fixHint = '') {
  totalChecks++;
  const status = condition ? 'PASS' : 'FAIL';
  if (condition) passed++;
  else failed++;
  const entry = { name, status, detail, fixHint };
  results[category].push(entry);
  if (!JSON_OUT) {
    const icon = condition ? '✅' : '❌';
    const detailStr = detail ? ` — ${detail}` : '';
    console.log(`  ${icon} ${name}${detailStr}`);
    if (!condition && fixHint) {
      console.log(`     💡 FIX: ${fixHint}`);
    }
  }
  return condition;
}

function warn(category, name, detail = '') {
  warnings++;
  const entry = { name, status: 'WARN', detail };
  results[category].push(entry);
  if (!JSON_OUT) {
    console.log(`  ⚠️  ${name} — ${detail}`);
  }
}

function section(title) {
  if (!JSON_OUT) {
    console.log(`\n${'═'.repeat(65)}`);
    console.log(`  PHASE 7.${title}`);
    console.log(`${'═'.repeat(65)}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// CHECK 1: ACTION STRING MATCHING
// Does Module A's output action string match Module B's input check?
// ═══════════════════════════════════════════════════════════════
function checkActionStrings() {
  section('1 — ACTION STRING MATCHING');

  // Load source files
  const mainBot = fs.readFileSync(path.join(ROOT, 'run-empire-v2.js'), 'utf8');
  const brainSrc = fs.readFileSync(path.join(ROOT, 'core/OptimizedTradingBrain.js'), 'utf8');
  const mpmSrc = fs.readFileSync(path.join(ROOT, 'core/MaxProfitManager.js'), 'utf8');

  // ── MaxProfitManager → TradingBrain action names ──
  // Extract what MPM RETURNS (only clean action strings, not code fragments)
  const mpmActions = [];
  const mpmActionRegex = /action:\s*['"]([a-z_]+)['"]/g;
  let match;
  while ((match = mpmActionRegex.exec(mpmSrc)) !== null) {
    if (!mpmActions.includes(match[1]) && match[1].length < 20) mpmActions.push(match[1]);
  }

  // Extract what TradingBrain CHECKS FOR
  const brainActionChecks = [];
  const brainCheckRegex = /(?:profitResult|result)\.action\s*===?\s*['"]([^'"]+)['"]/g;
  while ((match = brainCheckRegex.exec(brainSrc)) !== null) {
    if (!brainActionChecks.includes(match[1])) brainActionChecks.push(match[1]);
  }

  // Extract what run-empire-v2.js CHECKS FOR from profit results
  const mainProfitChecks = [];
  const mainCheckRegex = /profitResult\.action\s*===?\s*['"]([^'"]+)['"]/g;
  while ((match = mainCheckRegex.exec(mainBot)) !== null) {
    if (!mainProfitChecks.includes(match[1])) mainProfitChecks.push(match[1]);
  }

  // Verify: Every action MPM returns has a receiver
  // Note: 'none', 'hold', 'update' are non-action states the bot correctly ignores
  const passiveActions = ['none', 'hold', 'update'];
  const allReceivers = [...new Set([...brainActionChecks, ...mainProfitChecks])];
  for (const action of mpmActions) {
    if (passiveActions.includes(action)) {
      check('actionStrings',
        `MPM returns '${action}' → passive state (correctly ignored)`,
        true,
        `'${action}' is a no-op state — bot correctly skips it`
      );
      continue;
    }
    const hasReceiver = allReceivers.includes(action);
    check('actionStrings',
      `MPM returns '${action}' → receiver exists`,
      hasReceiver,
      hasReceiver ? `matched in ${brainActionChecks.includes(action) ? 'Brain' : 'main'}` : `NO RECEIVER — action '${action}' is returned but never checked`,
      `Add '${action}' to the action checks in TradingBrain or run-empire-v2.js`
    );
  }

  // Verify: Every action the receivers check for is actually produced
  for (const action of allReceivers) {
    const isProduced = mpmActions.includes(action);
    check('actionStrings',
      `Receiver checks '${action}' → MPM produces it`,
      isProduced,
      isProduced ? 'matched' : `DEAD CHECK — '${action}' is checked for but never returned by MPM`,
      `Remove dead check for '${action}' or verify it comes from another source`
    );
  }

  // ── ExitContractManager → run-empire-v2.js exit reasons ──
  let ecmSrc;
  try {
    ecmSrc = fs.readFileSync(path.join(ROOT, 'core/ExitContractManager.js'), 'utf8');
  } catch (e) {
    warn('actionStrings', 'ExitContractManager.js', 'Could not load — skipping exit reason checks');
    return;
  }

  // Extract exitReason values ECM produces
  const ecmReasons = [];
  const ecmReasonRegex = /exitReason:\s*['"]([^'"]+)['"]/g;
  while ((match = ecmReasonRegex.exec(ecmSrc)) !== null) {
    if (!ecmReasons.includes(match[1])) ecmReasons.push(match[1]);
  }

  // Extract exitReason checks in main bot
  const mainExitChecks = [];
  const exitCheckRegex = /exitReason\s*(?:===?\s*['"]([^'"]+)['"]|\.startsWith\(\s*['"]([^'"]+)['"]\))/g;
  while ((match = exitCheckRegex.exec(mainBot)) !== null) {
    const val = match[1] || match[2];
    if (val && !mainExitChecks.includes(val)) {
      mainExitChecks.push({ value: val, isPrefix: !!match[2] });
    }
  }

  // Verify exit reasons match
  for (const reason of ecmReasons) {
    const hasMatch = mainExitChecks.some(c => {
      if (c.isPrefix) return reason.startsWith(c.value);
      return reason === c.value;
    });
    check('actionStrings',
      `ECM exitReason '${reason}' → main bot handles it`,
      hasMatch,
      hasMatch ? 'matched' : `UNHANDLED — exit reason '${reason}' produced but not checked in main bot`,
      `Add handler for '${reason}' in run-empire-v2.js exit reason checks`
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// CHECK 2: PARAMETER FORWARDING
// When A passes data to B, does B actually USE that data?
// ═══════════════════════════════════════════════════════════════
function checkParameterForwarding() {
  section('2 — PARAMETER FORWARDING');

  const mainBot = fs.readFileSync(path.join(ROOT, 'run-empire-v2.js'), 'utf8');

  // ── Check exitSize is forwarded to closePosition ──
  // Find where exitSize is set on the decision
  const hasExitSize = /decision\.exitSize|exitSize:\s*profitResult\.exitSize/.test(mainBot);
  // Find where closePosition is called 
  const closeCallRegex = /closePosition\(([^)]+)\)/g;
  let match;
  const closeCalls = [];
  while ((match = closeCallRegex.exec(mainBot)) !== null) {
    closeCalls.push(match[1]);
  }

  // Check if any closePosition call uses exitSize/partialSize
  const usesPartial = closeCalls.some(call =>
    /isPartialClose|partial.*true|decision\.exitSize|partialSize/.test(call)
  );

  check('parameterForwarding',
    'exitSize → closePosition partial parameter',
    hasExitSize && usesPartial,
    usesPartial ? 'exitSize is forwarded to closePosition' : 'exitSize EXISTS on decision but closePosition ignores it',
    'Change closePosition call to: closePosition(price, isPartialClose, partialSize, {...})'
  );

  // ── Check exitReason is forwarded from MaxProfitManager → decision → isProfitExit ──
  const mpmReturnsReason = /reason:\s*['"]profit_tier/.test(
    fs.readFileSync(path.join(ROOT, 'core/MaxProfitManager.js'), 'utf8')
  );

  // Check if exitReason is included when building the SELL decision from MPM
  const mpmSellBlock = mainBot.match(/profitResult\.action\s*===\s*'exit_partial'[\s\S]{0,500}/);
  const forwardsExitReason = mpmSellBlock && /exitReason:\s*profitResult\.reason/.test(mpmSellBlock[0]);

  check('parameterForwarding',
    'MaxProfitManager reason → decision.exitReason',
    forwardsExitReason,
    forwardsExitReason ? 'profitResult.reason forwarded to decision' : 'MPM returns profit_tier_X in .reason but it is NOT forwarded to the decision object',
    'Add exitReason: profitResult.reason to the SELL return object'
  );

  // ── Check signalBreakdown flows from brain → trade record ──
  const brainReturnsBreakdown = /signalBreakdown/.test(
    fs.readFileSync(path.join(ROOT, 'core/OptimizedTradingBrain.js'), 'utf8')
  );
  const tradeStoresBreakdown = /signalBreakdown:\s*(?:brainDecision|decision)\??\.signalBreakdown/.test(mainBot);

  check('parameterForwarding',
    'signalBreakdown → trade record',
    brainReturnsBreakdown && tradeStoresBreakdown,
    tradeStoresBreakdown ? 'signalBreakdown forwarded to trade' : 'Brain returns signalBreakdown but trade record does not store it',
    'Add signalBreakdown to the trade context in openPosition call'
  );
}

// ═══════════════════════════════════════════════════════════════
// CHECK 3: CONFIG CONSISTENCY
// Are .env values physically achievable given timeframe constraints?
// ═══════════════════════════════════════════════════════════════
function checkConfigConsistency() {
  section('3 — CONFIG CONSISTENCY (env vs reality)');

  // Load .env (try multiple locations)
  let envContent;
  let envPath;
  const envPaths = [
    path.join(ROOT, '.env'),
    path.join(ROOT, 'config', '.env.example'),
    path.join(ROOT, '.env.example'),
  ];
  for (const p of envPaths) {
    try {
      envContent = fs.readFileSync(p, 'utf8');
      envPath = p;
      break;
    } catch (e) { /* try next */ }
  }
  if (!envContent) {
    warn('configConsistency', '.env file', 'Could not find .env or .env.example — skipping config checks');
    return;
  }
  if (!JSON_OUT) console.log(`  📁 Using: ${path.relative(ROOT, envPath)}`);

  // Parse env values
  const envVars = {};
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const val = rest.join('=').split('#')[0].trim();
    envVars[key.trim()] = val;
  }

  // ── Tier targets vs max hold time ──
  const tier1 = parseFloat(envVars.TIER1_TARGET);
  const tier2 = parseFloat(envVars.TIER2_TARGET);
  const tier3 = parseFloat(envVars.TIER3_TARGET);
  const finalTarget = parseFloat(envVars.FINAL_TARGET);
  const maxHoldMinutes = parseFloat(envVars.MAX_HOLD_TIME_MINUTES) || 105;

  // BTC 15m candle avg move: 0.3-0.8%. In maxHold minutes, max reasonable move:
  // Rough heuristic: 15m candle = ~0.5% avg, maxHold/15 candles, sqrt scaling
  const numCandles = maxHoldMinutes / 15;
  const maxReasonableMove = 0.5 * Math.sqrt(numCandles) / 100; // as decimal

  if (!isNaN(tier1)) {
    check('configConsistency',
      `TIER1_TARGET (${(tier1 * 100).toFixed(1)}%) reachable in ${maxHoldMinutes}min`,
      tier1 <= maxReasonableMove * 1.5,
      tier1 <= maxReasonableMove * 1.5
        ? `${(tier1 * 100).toFixed(1)}% is achievable (max reasonable: ${(maxReasonableMove * 100 * 1.5).toFixed(1)}%)`
        : `${(tier1 * 100).toFixed(1)}% is UNREACHABLE — max reasonable move in ${maxHoldMinutes}min is ~${(maxReasonableMove * 100 * 1.5).toFixed(1)}%`,
      `Set TIER1_TARGET to ${(maxReasonableMove * 0.5 * 100).toFixed(1)}% or lower`
    );
  }

  if (!isNaN(finalTarget)) {
    check('configConsistency',
      `FINAL_TARGET (${(finalTarget * 100).toFixed(1)}%) sanity check`,
      finalTarget <= maxReasonableMove * 3,
      finalTarget <= maxReasonableMove * 3
        ? `${(finalTarget * 100).toFixed(1)}% is ambitious but possible`
        : `${(finalTarget * 100).toFixed(1)}% is FANTASY — BTC rarely moves this much in ${maxHoldMinutes}min`,
      `Set FINAL_TARGET to ${(maxReasonableMove * 2 * 100).toFixed(1)}% or lower for 15m scalping`
    );
  }

  // ── Tier order sanity ──
  if (!isNaN(tier1) && !isNaN(tier2) && !isNaN(tier3) && !isNaN(finalTarget)) {
    check('configConsistency',
      'Tier targets in ascending order',
      tier1 < tier2 && tier2 < tier3 && tier3 < finalTarget,
      tier1 < tier2 && tier2 < tier3 && tier3 < finalTarget
        ? `${tier1} < ${tier2} < ${tier3} < ${finalTarget}`
        : `WRONG ORDER: ${tier1}, ${tier2}, ${tier3}, ${finalTarget}`,
      'Ensure TIER1 < TIER2 < TIER3 < FINAL'
    );
  }

  // ── Tier 1 vs fee threshold ──
  const feePercent = 0.0026 * 2; // Round-trip Kraken fee (0.26% * 2)
  if (!isNaN(tier1)) {
    check('configConsistency',
      `TIER1_TARGET (${(tier1 * 100).toFixed(2)}%) > round-trip fees (${(feePercent * 100).toFixed(2)}%)`,
      tier1 > feePercent,
      tier1 > feePercent
        ? `${(tier1 * 100).toFixed(2)}% clears ${(feePercent * 100).toFixed(2)}% fees by ${((tier1 - feePercent) * 100).toFixed(2)}%`
        : `TIER1 is BELOW FEES — every tier 1 exit is a guaranteed loss`,
      `Set TIER1_TARGET above ${(feePercent * 100).toFixed(2)}% (e.g., 0.007 for 0.7%)`
    );
  }

  // ── ExitContractManager defaults vs .env ──
  let ecmSrc;
  try {
    ecmSrc = fs.readFileSync(path.join(ROOT, 'core/ExitContractManager.js'), 'utf8');
  } catch (e) { return; }

  // Extract ECM default TP values per strategy
  const ecmTPRegex = /(\w+):\s*\{[^}]*takeProfitPercent:\s*([\d.]+)/g;
  let ecmMatch;
  while ((ecmMatch = ecmTPRegex.exec(ecmSrc)) !== null) {
    const strategy = ecmMatch[1];
    const tp = parseFloat(ecmMatch[2]);
    const envTP = parseFloat(envVars.TAKE_PROFIT_PERCENT);
    if (!isNaN(envTP) && Math.abs(tp - envTP) > 0.5) {
      warn('configConsistency',
        `${strategy} ECM TP (${tp}%) vs .env TAKE_PROFIT_PERCENT (${envTP}%)`,
        `Mismatch — document which one controls exits for ${strategy}`
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// CHECK 4: STRING COMPARISON INTEGRITY
// Do === checks match the actual values being compared?
// ═══════════════════════════════════════════════════════════════
function checkStringComparisons() {
  section('4 — STRING COMPARISON INTEGRITY');

  const mainBot = fs.readFileSync(path.join(ROOT, 'run-empire-v2.js'), 'utf8');
  const lines = mainBot.split('\n');

  // Find all === string comparisons with exitReason
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('//')) continue;

    // Check for exact match on values that could be prefixed
    const prefixableValues = [
      { field: 'exitReason', value: 'profit_tier', actualValues: ['profit_tier_1', 'profit_tier_2', 'profit_tier_3', 'profit_tier_4'] },
      { field: 'exitReason', value: 'trailing', actualValues: ['trailing_stop', 'trailing_stop_tight'] },
    ];

    for (const pv of prefixableValues) {
      const exactMatch = new RegExp(`${pv.field}\\s*===\\s*['"]${pv.value}['"]`);
      if (exactMatch.test(line)) {
        // This is a === check on a value that should be startsWith
        const usesStartsWith = new RegExp(`${pv.field}\\?\\.startsWith|${pv.field}\\.startsWith`);
        const isStartsWith = usesStartsWith.test(line);

        check('stringComparisons',
          `Line ${i + 1}: ${pv.field} === '${pv.value}' (actual values: ${pv.actualValues.join(', ')})`,
          isStartsWith,
          isStartsWith
            ? 'Uses .startsWith() — correct'
            : `Uses === which will NEVER match '${pv.actualValues[0]}' etc`,
          `Change to: ${pv.field}?.startsWith('${pv.value}')`
        );
      }
    }
  }

  // Check for === on values that might have variant forms
  const variantChecks = [
    { pattern: /\.action\s*===\s*['"]SELL['"]/, expected: 'SELL', file: 'run-empire-v2.js' },
    { pattern: /\.action\s*===\s*['"]BUY['"]/, expected: 'BUY', file: 'run-empire-v2.js' },
    { pattern: /\.direction\s*===\s*['"]buy['"]/, note: 'verify strategies return lowercase' },
    { pattern: /\.direction\s*===\s*['"]sell['"]/, note: 'verify strategies return lowercase' },
  ];

  // Verify buy/sell/hold direction consistency across modules
  const moduleFiles = [
    'modules/EMASMACrossoverSignal.js',
    'modules/MADynamicSR.js',
    'modules/LiquiditySweepDetector.js',
  ];

  const directionValues = new Set();
  for (const modFile of moduleFiles) {
    try {
      const src = fs.readFileSync(path.join(ROOT, modFile), 'utf8');
      const dirRegex = /direction:\s*['"](\w+)['"]/g;
      let m;
      while ((m = dirRegex.exec(src)) !== null) {
        directionValues.add(`${path.basename(modFile)}: '${m[1]}'`);
      }
    } catch (e) { /* skip missing files */ }
  }

  // Check brain for direction checks
  const brainSrc = fs.readFileSync(path.join(ROOT, 'core/OptimizedTradingBrain.js'), 'utf8');
  const brainDirChecks = new Set();
  const brainDirRegex = /direction\s*===?\s*['"](\w+)['"]/g;
  let m;
  while ((m = brainDirRegex.exec(brainSrc)) !== null) {
    brainDirChecks.add(m[1]);
  }

  check('stringComparisons',
    'Direction value consistency across modules',
    true, // Informational — report findings
    `Modules produce: ${[...directionValues].join(', ')}. Brain checks: ${[...brainDirChecks].join(', ')}`
  );
}

// ═══════════════════════════════════════════════════════════════
// CHECK 5: CONFIG KEY MATCHING
// Do config keys match between setter and getter?
// ═══════════════════════════════════════════════════════════════
function checkConfigKeys() {
  section('5 — CONFIG KEY MATCHING');

  // Load modules that use config keys
  const filesToCheck = [
    'core/OptimizedTradingBrain.js',
    'core/MaxProfitManager.js',
    'core/ExitContractManager.js',
    'core/RiskManager.js',
    'core/StateManager.js',
  ];

  for (const file of filesToCheck) {
    try {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const basename = path.basename(file);

      // Find config keys being SET in constructors (this.config.X or options.X)
      const configSetRegex = /(?:config|options|this)\.(\w+(?:Enable|enable|Enabled|enabled)\w*)/g;
      const configSets = new Set();
      let match;
      while ((match = configSetRegex.exec(src)) !== null) {
        configSets.add(match[1]);
      }

      // Find config keys being READ (this.config.X, this.X checks)
      const configReadRegex = /(?:this\.config|this)\.(\w+(?:Enable|enable|Enabled|enabled)\w*)/g;
      const configReads = new Set();
      while ((match = configReadRegex.exec(src)) !== null) {
        configReads.add(match[1]);
      }

      // Look for near-misses (keys that are almost the same but differ by s/ed/etc)
      const allKeys = [...new Set([...configSets, ...configReads])];
      for (let i = 0; i < allKeys.length; i++) {
        for (let j = i + 1; j < allKeys.length; j++) {
          const a = allKeys[i];
          const b = allKeys[j];
          // Check for singular/plural mismatch
          if (a + 's' === b || b + 's' === a ||
            a + 'ed' === b || b + 'ed' === a ||
            a.replace(/s$/, '') === b || b.replace(/s$/, '') === a) {
            check('configKeys',
              `${basename}: key mismatch '${a}' vs '${b}'`,
              false,
              `Near-duplicate config keys — one is likely a typo`,
              `Standardize to one key name in ${basename}`
            );
          }
        }
      }
    } catch (e) { /* skip missing files */ }
  }

  // ── Check .env keys vs code that reads them ──
  let envContent;
  try {
    envContent = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  } catch (e) { return; }

  const envKeys = new Set();
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const key = trimmed.split('=')[0].trim();
    envKeys.add(key);
  }

  // Check if code reads env vars that don't exist in .env
  const mainBot = fs.readFileSync(path.join(ROOT, 'run-empire-v2.js'), 'utf8');
  const envReadRegex = /process\.env\.(\w+)/g;
  const codeEnvReads = new Set();
  let match;
  while ((match = envReadRegex.exec(mainBot)) !== null) {
    codeEnvReads.add(match[1]);
  }

  // Common env vars that are okay to be missing (system vars, optional)
  const optionalEnvVars = new Set([
    'NODE_ENV', 'PORT', 'HOME', 'PATH', 'USER', 'BACKTEST_MODE',
    'BACKTEST_FAST', 'BACKTEST_LIMIT', 'BACKTEST_FILE', 'BACKTEST_VERBOSE',
    'EXIT_SYSTEM', 'PIPELINE_TRACE', 'DEBUG',
  ]);

  for (const envVar of codeEnvReads) {
    if (optionalEnvVars.has(envVar)) continue;
    if (!envKeys.has(envVar)) {
      warn('configKeys',
        `Code reads process.env.${envVar} but NOT in .env`,
        'Will fall back to undefined/default — verify this is intentional'
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// CHECK 6: DUPLICATE ENV DETECTION
// Are there conflicting .env entries?
// ═══════════════════════════════════════════════════════════════
function checkDuplicateEnv() {
  section('6 — DUPLICATE ENV DETECTION');

  let envContent;
  const envPaths = [
    path.join(ROOT, '.env'),
    path.join(ROOT, 'config', '.env.example'),
  ];
  for (const p of envPaths) {
    try { envContent = fs.readFileSync(p, 'utf8'); break; } catch (e) { /* next */ }
  }
  if (!envContent) {
    warn('duplicateEnv', '.env file', 'Could not load');
    return;
  }

  const envEntries = {};
  const lines = envContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const key = trimmed.split('=')[0].trim();
    const val = trimmed.split('=').slice(1).join('=').split('#')[0].trim();

    if (envEntries[key]) {
      check('duplicateEnv',
        `DUPLICATE: ${key}`,
        false,
        `Line ${envEntries[key].line}: '${envEntries[key].value}' vs Line ${i + 1}: '${val}' — LAST VALUE WINS`,
        `Remove duplicate ${key} from .env (keep the correct value)`
      );
    } else {
      envEntries[key] = { value: val, line: i + 1 };
    }
  }

  if (Object.keys(envEntries).length > 0 && failed === 0) {
    check('duplicateEnv', 'No duplicate .env keys', true, `${Object.keys(envEntries).length} unique keys`);
  }
}

// ═══════════════════════════════════════════════════════════════
// CHECK 7: NUMERIC SANITY
// Are values in the right order/range?
// ═══════════════════════════════════════════════════════════════
function checkNumericSanity() {
  section('7 — NUMERIC SANITY');

  let envContent;
  const envPathsNum = [
    path.join(ROOT, '.env'),
    path.join(ROOT, 'config', '.env.example'),
  ];
  for (const p of envPathsNum) {
    try { envContent = fs.readFileSync(p, 'utf8'); break; } catch (e) { /* next */ }
  }
  if (!envContent) return;

  const envVars = {};
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    envVars[key.trim()] = rest.join('=').split('#')[0].trim();
  }

  // ── Trail distances: tight < normal ──
  const trailDist = parseFloat(envVars.TRAIL_DISTANCE);
  const tightTrailDist = parseFloat(envVars.TIGHT_TRAIL_DISTANCE);
  if (!isNaN(trailDist) && !isNaN(tightTrailDist)) {
    check('numericSanity',
      `TIGHT_TRAIL_DISTANCE (${tightTrailDist}) < TRAIL_DISTANCE (${trailDist})`,
      tightTrailDist < trailDist,
      tightTrailDist < trailDist
        ? `Correct: tight (${tightTrailDist}) is tighter than normal (${trailDist})`
        : `INVERTED — "tight" (${tightTrailDist}) is LOOSER than normal (${trailDist})`,
      `Swap values or reduce TIGHT_TRAIL_DISTANCE below ${trailDist}`
    );
  }

  // ── Stop loss < Take profit (absolute values) ──
  const stopLoss = Math.abs(parseFloat(envVars.STOP_LOSS_PERCENT) || 0);
  const takeProfit = parseFloat(envVars.TAKE_PROFIT_PERCENT) || 0;
  if (stopLoss > 0 && takeProfit > 0) {
    check('numericSanity',
      `R:R ratio — SL (${stopLoss}%) vs TP (${takeProfit}%)`,
      takeProfit > stopLoss,
      takeProfit > stopLoss
        ? `R:R = 1:${(takeProfit / stopLoss).toFixed(1)}`
        : `NEGATIVE R:R — stop (${stopLoss}%) is wider than target (${takeProfit}%)`,
      `Ensure TP > SL for positive expected value`
    );
  }

  // ── Check ExitContractManager strategy defaults ──
  try {
    const ecmSrc = fs.readFileSync(path.join(ROOT, 'core/ExitContractManager.js'), 'utf8');

    // Extract all strategy contracts
    const contractRegex = /(\w+):\s*\{([^}]+)\}/g;
    let match;
    while ((match = contractRegex.exec(ecmSrc)) !== null) {
      const strategy = ecmMatch[1];
      const block = match[2];

      const slMatch = block.match(/stopLossPercent:\s*([-\d.]+)/);
      const tpMatch = block.match(/takeProfitPercent:\s*([\d.]+)/);
      const trailMatch = block.match(/trailingStopPercent:\s*([\d.]+)/);
      const maxHoldMatch = block.match(/maxHoldTimeMinutes:\s*(\d+)/);

      if (slMatch && tpMatch) {
        const sl = Math.abs(parseFloat(slMatch[1]));
        const tp = parseFloat(tpMatch[1]);
        const rr = tp / sl;

        check('numericSanity',
          `${strategy} contract: SL=${sl}% TP=${tp}% R:R=1:${rr.toFixed(1)}`,
          rr >= 1.0,
          rr >= 1.0
            ? `Positive R:R (1:${rr.toFixed(1)})`
            : `NEGATIVE R:R — losing more on losers than gaining on winners`,
          `Increase TP or tighten SL for ${strategy}`
        );

        // Check TP is achievable on 15m candles
        if (tp > 2.0) {
          check('numericSanity',
            `${strategy} TP (${tp}%) achievable on 15m`,
            false,
            `${tp}% TP is unreachable on 15m candles (avg move 0.3-0.8%)`,
            `Reduce ${strategy} TP to 0.7-1.5% range`
          );
        }
      }

      // Check trailing < TP (trail should be tighter than target)
      if (trailMatch && tpMatch) {
        const trail = parseFloat(trailMatch[1]);
        const tp = parseFloat(tpMatch[1]);
        check('numericSanity',
          `${strategy}: trail (${trail}%) < TP (${tp}%)`,
          trail < tp,
          trail < tp
            ? 'Correct — trail is tighter than target'
            : 'WRONG — trail is wider than TP, will never trigger before TP',
          `Reduce trail to below ${tp}%`
        );
      }
    }
  } catch (e) { /* skip if ECM not found */ }
}

// ═══════════════════════════════════════════════════════════════
// CHECK 8: LIVE HANDOFF TEST
// Actually call functions and verify output matches expected input
// ═══════════════════════════════════════════════════════════════
function checkLiveHandoffs() {
  section('8 — LIVE HANDOFF TEST (real function calls)');

  // ── Test MaxProfitManager returns correct action strings ──
  try {
    const MPMPath = path.resolve(ROOT, 'core/MaxProfitManager');
    delete require.cache[require.resolve(MPMPath)];
    const MPMMod = require(MPMPath);
    const MPMClass = MPMMod.MaxProfitManager || MPMMod;
    const mpm = new MPMClass({
      enableTieredExit: true,
      firstTierTarget: 0.005,
      secondTierTarget: 0.01,
      thirdTierTarget: 0.015,
      finalTarget: 0.025,
    });

    // Suppress console
    const origLog = console.log;
    console.log = () => { };

    mpm.start(95000, 'buy', 0.001, { confidence: 0.72 });

    // Simulate price reaching tier 1
    let result = mpm.update(95500); // +0.53%

    console.log = origLog;

    if (result && result.action) {
      // Verify action is one of the expected values
      const validActions = ['hold', 'exit', 'exit_full', 'exit_partial'];
      check('parameterForwarding',
        `MPM.update() returns action='${result.action}'`,
        validActions.includes(result.action),
        validActions.includes(result.action)
          ? `'${result.action}' is a valid action`
          : `'${result.action}' is NOT recognized by the pipeline`,
        `Add '${result.action}' to valid actions list or change MPM to return a valid action`
      );

      // If it's a tier exit, verify it has a reason
      if (result.action === 'exit_partial' || result.action === 'exit') {
        check('parameterForwarding',
          `MPM tier exit includes 'reason' field`,
          !!result.reason,
          result.reason ? `reason='${result.reason}'` : 'NO REASON FIELD — exitReason forwarding will be undefined',
          'Ensure MPM returns { action, reason, exitSize } on tier exits'
        );

        // Verify reason matches what the main bot checks for
        if (result.reason) {
          const mainBot = fs.readFileSync(path.join(ROOT, 'run-empire-v2.js'), 'utf8');
          const wouldMatch = mainBot.includes('.startsWith("profit_tier")')
            ? result.reason.startsWith('profit_tier')
            : mainBot.includes(`"${result.reason}"`);

          check('parameterForwarding',
            `MPM reason '${result.reason}' matches main bot exit check`,
            wouldMatch,
            wouldMatch ? 'Would be recognized' : 'Would NOT be recognized — exit would be blocked',
            'Fix the exit reason check in run-empire-v2.js'
          );
        }
      }
    } else {
      warn('parameterForwarding', 'MPM.update() at +0.53%', `returned: ${JSON.stringify(result)} — may not have reached tier`);
    }

    mpm.reset();
  } catch (e) {
    check('parameterForwarding', 'MaxProfitManager live test', false, e.message);
  }

  // ── Test ExitContractManager creates valid contracts ──
  try {
    const ecmPath = path.resolve(ROOT, 'core/ExitContractManager');
    delete require.cache[require.resolve(ecmPath)];
    const { getInstance } = require(ecmPath);
    const ecm = getInstance();

    const strategies = ['MADynamicSR', 'LiquiditySweep', 'EMASMACrossover', 'CandlePattern', 'default'];
    for (const strategy of strategies) {
      try {
        const contract = ecm.createExitContract(strategy, {}, { entryPrice: 95000 });
        if (contract) {
          // Verify contract has all required fields
          const requiredFields = ['stopLossPercent', 'takeProfitPercent', 'maxHoldTimeMinutes'];
          for (const field of requiredFields) {
            check('parameterForwarding',
              `${strategy} exit contract has '${field}'`,
              contract[field] !== undefined && contract[field] !== null,
              contract[field] !== undefined ? `${field}=${contract[field]}` : `MISSING — exits will use fallback behavior`,
              `Add ${field} to ${strategy} contract in ExitContractManager.js`
            );
          }
        }
      } catch (e) {
        warn('parameterForwarding', `${strategy} contract creation`, e.message);
      }
    }
  } catch (e) {
    warn('parameterForwarding', 'ExitContractManager live test', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// CHECK 9: MAP VS OBJECT SAFETY
// Ensure Map objects aren't treated as plain objects
// ═══════════════════════════════════════════════════════════════
function checkMapObjectSafety() {
  section('9 — MAP VS OBJECT SAFETY');

  // Known issue: TradeJournalBridge uses Object.keys() on a Map
  const filesToCheck = [
    { file: 'core/TradeJournalBridge.js', description: 'TradeJournalBridge' },
    { file: 'run-empire-v2.js', description: 'Main bot' },
  ];

  for (const { file, description } of filesToCheck) {
    try {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');

      // Check for Object.keys() on activeTrades (which is a Map)
      // BUT allow if there's an instanceof Map guard with proper .keys() handling
      const hasObjectKeys = /Object\.keys\(.*activeTrades/.test(src);
      const hasMapGuardForKeys = /activeTrades\s+instanceof\s+Map[\s\S]{0,100}\.keys\(\)/.test(src);
      if (hasObjectKeys && !hasMapGuardForKeys) {
        check('configKeys',
          `${description}: Object.keys() on activeTrades (Map)`,
          false,
          'activeTrades is a Map — Object.keys(Map) returns [] empty array',
          'Use activeTrades.keys() or [...activeTrades.entries()] instead'
        );
      } else if (hasObjectKeys && hasMapGuardForKeys) {
        check('configKeys',
          `${description}: Object.keys() on activeTrades (guarded)`,
          true,
          'Has instanceof Map guard with .keys() fallback'
        );
      }

      // Check for .length on Map (Maps use .size)
      // BUT allow if there's an instanceof Map ternary: Map ? .size : .length
      const hasLength = /activeTrades\.length/.test(src);
      const hasMapGuardForLength = /activeTrades\s+instanceof\s+Map\s*\?\s*activeTrades\.size/.test(src);
      if (hasLength && !hasMapGuardForLength) {
        check('configKeys',
          `${description}: activeTrades.length (Map has no .length)`,
          false,
          'Maps use .size not .length — this will always be undefined',
          'Change to activeTrades.size'
        );
      } else if (hasLength && hasMapGuardForLength) {
        check('configKeys',
          `${description}: activeTrades.length (guarded)`,
          true,
          'Has instanceof Map ternary with .size/.length handling'
        );
      }
    } catch (e) { /* skip missing files */ }
  }
}

// ─── SUMMARY ─────────────────────────────────────────────────
function printSummary() {
  if (!JSON_OUT) {
    console.log(`\n${'═'.repeat(65)}`);
    console.log('  PHASE 7 HANDOFF VERIFICATION — SUMMARY');
    console.log(`${'═'.repeat(65)}`);
  }

  results.summary = {
    totalChecks,
    passed,
    failed,
    warnings,
    passRate: totalChecks > 0 ? ((passed / totalChecks) * 100).toFixed(1) + '%' : '0%',
    timestamp: new Date().toISOString(),
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`\n  Total checks:  ${totalChecks}`);
  console.log(`  ✅ Passed:     ${passed}`);
  console.log(`  ❌ Failed:     ${failed}`);
  console.log(`  ⚠️  Warnings:   ${warnings}`);
  console.log(`  Pass rate:     ${results.summary.passRate}`);

  if (failed > 0) {
    console.log(`\n${'─'.repeat(65)}`);
    console.log('  FAILURES (these are the bugs hiding in the handoffs):');
    console.log(`${'─'.repeat(65)}`);
    for (const [cat, entries] of Object.entries(results)) {
      if (cat === 'summary') continue;
      const failures = entries.filter(e => e.status === 'FAIL');
      for (const f of failures) {
        console.log(`\n  ❌ [${cat}] ${f.name}`);
        console.log(`     ${f.detail}`);
        if (f.fixHint) console.log(`     💡 ${f.fixHint}`);
      }
    }
  }

  if (FIX_REPORT) {
    console.log(`\n${'═'.repeat(65)}`);
    console.log('  FIX REPORT — Copy to Claude Code:');
    console.log(`${'═'.repeat(65)}`);
    let fixNum = 1;
    for (const [cat, entries] of Object.entries(results)) {
      if (cat === 'summary') continue;
      const failures = entries.filter(e => e.status === 'FAIL');
      for (const f of failures) {
        console.log(`\n  ${fixNum}. ${f.name}`);
        console.log(`     Problem: ${f.detail}`);
        if (f.fixHint) console.log(`     Fix: ${f.fixHint}`);
        fixNum++;
      }
    }
  }

  console.log(`\n${'═'.repeat(65)}`);
  console.log(failed === 0
    ? '  🟢 ALL HANDOFF CHECKS PASSED — No water leaking between pipes'
    : `  🔴 ${failed} HANDOFF FAILURES — Water is leaking between modules`
  );
  console.log(`${'═'.repeat(65)}\n`);

  // Save results
  const reportDir = path.join(ROOT, 'logs');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `phase7-audit-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  if (!JSON_OUT) console.log(`  📄 Report saved: ${reportPath}\n`);
}

// ─── MAIN ────────────────────────────────────────────────────
function main() {
  if (!JSON_OUT) {
    console.log(`\n${'╔'.padEnd(64, '═')}╗`);
    console.log(`║  OGZPrime Phase 7: HANDOFF VERIFICATION ENGINE              ║`);
    console.log(`║  "Check if the WATER matches, not just if the PIPE exists"  ║`);
    console.log(`║  ${new Date().toISOString().padEnd(61)}║`);
    console.log(`${'╚'.padEnd(64, '═')}╝`);
  }

  checkActionStrings();
  checkParameterForwarding();
  checkConfigConsistency();
  checkStringComparisons();
  checkConfigKeys();
  checkDuplicateEnv();
  checkNumericSanity();
  checkLiveHandoffs();
  checkMapObjectSafety();

  printSummary();
  process.exit(failed > 0 ? 1 : 0);
}

main();
