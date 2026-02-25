#!/usr/bin/env node
/**
 * OGZPrime Phase 7B: FUNCTION CONNECTION MAP
 * =============================================
 * 
 * Extracts every function from every module, maps where each is called,
 * and finds:
 *   1. ORPHANS — functions defined but never called anywhere
 *   2. NEAR-MISSES — similar names that should be the same (typos, refactor leftovers)
 *   3. ONE-WAY CONNECTIONS — A calls B but B never calls back (potential dead paths)
 *   4. MERMAID CHART — visual map of what connects to what
 *
 * This catches bugs like:
 *   - exit_partial vs partialExit (near-miss)
 *   - enableTieredExits vs enableTieredExit (near-miss)
 *   - executePartialExit() defined but never called (orphan)
 *   - Function exists in module but run-empire-v2.js doesn't call it (unwired)
 *
 * Usage:
 *   node ogz-meta/pipeline-phase7b-connectionmap.js                # Full scan
 *   node ogz-meta/pipeline-phase7b-connectionmap.js --orphans      # Only show orphans
 *   node ogz-meta/pipeline-phase7b-connectionmap.js --near-misses  # Only show similar names
 *   node ogz-meta/pipeline-phase7b-connectionmap.js --mermaid      # Output mermaid chart
 *   node ogz-meta/pipeline-phase7b-connectionmap.js --json         # JSON output
 *
 * Created: 2026-02-24 | Trey's idea: "return all function names, ctrl-F for similar"
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const ONLY_ORPHANS = args.includes('--orphans');
const ONLY_NEAR = args.includes('--near-misses');
const MERMAID = args.includes('--mermaid');

// ─── FILES TO SCAN ───────────────────────────────────────────
const SCAN_FILES = [
  'run-empire-v2.js',
  'core/OptimizedTradingBrain.js',
  'core/MaxProfitManager.js',
  'core/ExitContractManager.js',
  'core/StateManager.js',
  'core/RiskManager.js',
  'core/tradeLogger.js',
  'core/AdvancedExecutionLayer-439-MERGED.js',
  'core/EnhancedPatternRecognition.js',
  'core/MarketRegimeDetector.js',
  'core/PerformanceAnalyzer.js',
  'core/TRAIDecisionModule.js',
  'core/FibonacciDetector.js',
  'core/SupportResistanceDetector.js',
  'core/MemoryManager.js',
  'core/PersistentPatternMap.js',
  'core/ErrorHandler.js',
  'core/PatternBasedExitModel.js',
  'core/TradingProfileManager.js',
  'core/TradeIntelligenceEngine.js',
  'core/indicators/IndicatorEngine.js',
  'core/TradeJournalBridge.js',
  'modules/EMASMACrossoverSignal.js',
  'modules/MADynamicSR.js',
  'modules/LiquiditySweepDetector.js',
  'modules/MultiTimeframeAdapter.js',
  'modules/BreakAndRetest.js',
  'modules/VolumeProfile.js',
  'core/StrategyOrchestrator.js',
  'core/BacktestRecorder.js',
];

// ─── EXTRACT FUNCTIONS ───────────────────────────────────────
function extractFunctions(filePath, source) {
  const functions = [];
  const lines = source.split('\n');
  const basename = path.basename(filePath, '.js');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

    // Method definitions: methodName(params) {
    let match = line.match(/^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/);
    if (match && !['if', 'for', 'while', 'switch', 'catch', 'function', 'else', 'return', 'constructor'].includes(match[1])) {
      functions.push({ name: match[1], file: basename, line: lineNum, type: 'method' });
      continue;
    }

    // Arrow functions assigned: const/let/var name = (...) =>
    match = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?/);
    if (match && (line.includes('=>') || line.includes('function'))) {
      functions.push({ name: match[1], file: basename, line: lineNum, type: 'arrow' });
      continue;
    }

    // Function declarations: function name(
    match = line.match(/^\s*(?:async\s+)?function\s+(\w+)\s*\(/);
    if (match) {
      functions.push({ name: match[1], file: basename, line: lineNum, type: 'function' });
      continue;
    }

    // Module.exports functions: exports.name = function
    match = line.match(/(?:module\.)?exports\.(\w+)\s*=/);
    if (match) {
      functions.push({ name: match[1], file: basename, line: lineNum, type: 'export' });
      continue;
    }

    // Prototype methods: ClassName.prototype.methodName
    match = line.match(/(\w+)\.prototype\.(\w+)\s*=/);
    if (match) {
      functions.push({ name: match[2], file: basename, line: lineNum, type: 'prototype' });
      continue;
    }
  }

  return functions;
}

// ─── SPLIT CAMELCASE INTO WORDS ──────────────────────────────
function splitCamelCase(name) {
  // checkRiskLimits → ['check', 'Risk', 'Limits']
  // calculateTrailingStop → ['calculate', 'Trailing', 'Stop']
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_]+/)
    .map(w => w.toLowerCase())
    .filter(w => w.length > 0);
}

// ─── FIND KEYWORD MATCHES IN CODEBASE ────────────────────────
// Given keywords from an orphan function name, search entire codebase
// for lines where 2+ keywords appear together — probable connection points
function findKeywordMatches(keywords, funcName, sourceFile, allSources) {
  const matches = [];
  const seen = new Set();

  for (const { file, source } of allSources) {
    const basename = path.basename(file, '.js');
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLower = line.toLowerCase();
      const lineNum = i + 1;

      // Skip the function's own definition
      if (basename === sourceFile && line.includes(funcName)) continue;
      // Skip pure comments that just mention the function
      if (line.trim().startsWith('*') && !line.toLowerCase().includes('todo')) continue;

      // Count how many keywords appear in this line
      const keywordHits = keywords.filter(k => lineLower.includes(k));

      if (keywordHits.length >= 2) {
        const key = `${basename}:${lineNum}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Classify the match type
        let type = 'keyword_cluster';

        // Is it a TODO or comment about this functionality?
        if (/\/\/.*(?:todo|fixme|hack|need|should|missing|add|wire|connect|hook)/i.test(line)) {
          type = 'comment';
        }

        // Is it calling a SIMILAR function? (same keywords, different name)
        const funcCallMatch = line.match(/\.(\w+)\s*\(/g);
        if (funcCallMatch) {
          for (const call of funcCallMatch) {
            const calledName = call.replace(/[.()]/g, '').trim();
            if (calledName !== funcName && calledName.length > 4) {
              const calledWords = splitCamelCase(calledName);
              const overlap = keywords.filter(k => calledWords.includes(k));
              if (overlap.length >= 2) {
                type = 'similar_call';
              }
            }
          }
        }

        matches.push({
          file: basename,
          line: lineNum,
          snippet: line,
          keywordHits: keywordHits.length,
          keywords: keywordHits,
          type
        });
      }
    }
  }

  // Sort by: comments first, then similar calls, then keyword clusters
  // Within each type, sort by keyword hit count (more = better match)
  const typePriority = { comment: 0, similar_call: 1, keyword_cluster: 2 };
  matches.sort((a, b) => {
    const typeDiff = (typePriority[a.type] || 9) - (typePriority[b.type] || 9);
    if (typeDiff !== 0) return typeDiff;
    return b.keywordHits - a.keywordHits;
  });

  return matches;
}

// ─── FIND CALLS ──────────────────────────────────────────────
function findCalls(funcName, allSources) {
  const calls = [];
  for (const { file, source } of allSources) {
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//')) continue;

      // Look for function being called: funcName( or .funcName(
      const callPattern = new RegExp(`\\.${funcName}\\s*\\(|\\b${funcName}\\s*\\(`);
      if (callPattern.test(line)) {
        // Don't count the definition itself
        const defPattern = new RegExp(`(?:async\\s+)?(?:function\\s+)?${funcName}\\s*\\([^)]*\\)\\s*\\{`);
        const protoPattern = new RegExp(`prototype\\.${funcName}`);
        if (!defPattern.test(line) && !protoPattern.test(line)) {
          calls.push({ file: path.basename(file, '.js'), line: i + 1 });
        }
      }
    }
  }
  return calls;
}

// ─── LEVENSHTEIN DISTANCE ────────────────────────────────────
function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = a[i - 1] === b[j - 1]
        ? matrix[i - 1][j - 1]
        : 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
    }
  }
  return matrix[a.length][b.length];
}

// ─── FIND NEAR-MISSES ───────────────────────────────────────
function findNearMisses(allFunctions) {
  const nearMisses = [];
  const names = [...new Set(allFunctions.map(f => f.name))].filter(n => n.length > 4);

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];

      // Skip if same name (same function in multiple files is fine)
      if (a === b) continue;

      const dist = levenshtein(a.toLowerCase(), b.toLowerCase());
      const maxLen = Math.max(a.length, b.length);
      const similarity = 1 - (dist / maxLen);

      // Flag if > 80% similar but not identical
      if (similarity >= 0.80 && similarity < 1.0) {
        const aLocs = allFunctions.filter(f => f.name === a).map(f => f.file);
        const bLocs = allFunctions.filter(f => f.name === b).map(f => f.file);
        nearMisses.push({
          a, b, similarity: (similarity * 100).toFixed(0) + '%',
          aFiles: [...new Set(aLocs)],
          bFiles: [...new Set(bLocs)],
          distance: dist,
        });
      }

      // Also check for singular/plural and camelCase variants
      if (a + 's' === b || b + 's' === a ||
          a + 'ed' === b || b + 'ed' === a ||
          a.replace(/Exit/g, 'Exits') === b || b.replace(/Exit/g, 'Exits') === a ||
          a.replace(/Exits/g, 'Exit') === b || b.replace(/Exits/g, 'Exit') === a) {
        if (!nearMisses.some(nm => (nm.a === a && nm.b === b) || (nm.a === b && nm.b === a))) {
          const aLocs = allFunctions.filter(f => f.name === a).map(f => f.file);
          const bLocs = allFunctions.filter(f => f.name === b).map(f => f.file);
          nearMisses.push({
            a, b, similarity: 'VARIANT',
            aFiles: [...new Set(aLocs)],
            bFiles: [...new Set(bLocs)],
            distance: dist,
          });
        }
      }
    }
  }

  return nearMisses;
}

// ─── SCAN STRING CONSTANTS ───────────────────────────────────
// Finds string values used as identifiers (action names, exit reasons, config keys)
function findStringConstants(allSources) {
  const producers = []; // { string, file, line, context: 'returns'|'sets' }
  const consumers = []; // { string, file, line, context: 'checks'|'reads' }

  for (const { file, source } of allSources) {
    const lines = source.split('\n');
    const basename = path.basename(file, '.js');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//')) continue;

      // String being SET/RETURNED: action: 'something', exitReason: 'something'
      const setMatch = line.match(/(?:action|exitReason|reason|type|status|direction|signal):\s*['"]([a-zA-Z_]+)['"]/);
      if (setMatch) {
        producers.push({ string: setMatch[1], file: basename, line: i + 1, field: setMatch[0].split(':')[0].trim() });
      }

      // String being CHECKED: === 'something', .startsWith('something')
      const checkMatch = line.match(/===\s*['"]([a-zA-Z_]+)['"]|startsWith\(\s*['"]([a-zA-Z_]+)['"]\)/);
      if (checkMatch) {
        const val = checkMatch[1] || checkMatch[2];
        consumers.push({ string: val, file: basename, line: i + 1, isPrefix: !!checkMatch[2] });
      }
    }
  }

  // Find mismatches: strings produced but never consumed, and vice versa
  const producedStrings = [...new Set(producers.map(p => p.string))];
  const consumedStrings = [...new Set(consumers.map(c => c.string))];

  const orphanProducers = producedStrings.filter(s =>
    !consumedStrings.some(c => c === s) &&
    !consumers.some(c => c.isPrefix && s.startsWith(c.string))
  );

  const orphanConsumers = consumedStrings.filter(s =>
    !producedStrings.some(p => p === s || (consumers.find(c => c.string === s)?.isPrefix && p.startsWith(s)))
  );

  // Find near-miss strings
  const nearMissStrings = [];
  for (const prod of producedStrings) {
    for (const cons of consumedStrings) {
      if (prod === cons) continue;
      const dist = levenshtein(prod, cons);
      const maxLen = Math.max(prod.length, cons.length);
      if (dist <= 2 && dist > 0 && maxLen > 4) {
        nearMissStrings.push({
          produced: prod,
          consumed: cons,
          distance: dist,
          producedIn: producers.filter(p => p.string === prod).map(p => `${p.file}:${p.line}`),
          consumedIn: consumers.filter(c => c.string === cons).map(c => `${c.file}:${c.line}`),
        });
      }
    }
  }

  return { producers, consumers, orphanProducers, orphanConsumers, nearMissStrings };
}

// ─── GENERATE MERMAID ────────────────────────────────────────
function generateMermaid(allFunctions, connections) {
  const lines = ['graph LR'];

  // Group functions by file
  const byFile = {};
  for (const f of allFunctions) {
    if (!byFile[f.file]) byFile[f.file] = [];
    byFile[f.file].push(f.name);
  }

  // Create subgraphs
  for (const [file, funcs] of Object.entries(byFile)) {
    lines.push(`  subgraph ${file}`);
    const unique = [...new Set(funcs)];
    for (const fn of unique.slice(0, 15)) { // Cap at 15 per file to keep readable
      lines.push(`    ${file}_${fn}["${fn}()"]`);
    }
    if (unique.length > 15) {
      lines.push(`    ${file}_more["... +${unique.length - 15} more"]`);
    }
    lines.push('  end');
  }

  // Add connections
  for (const conn of connections) {
    const fromId = `${conn.from.file}_${conn.from.name}`;
    const toId = `${conn.to.file}_${conn.to.name}`;
    // Only include cross-file connections
    if (conn.from.file !== conn.to.file) {
      lines.push(`  ${fromId} --> ${toId}`);
    }
  }

  return lines.join('\n');
}

// ─── MAIN ────────────────────────────────────────────────────
function main() {
  if (!JSON_OUT) {
    console.log(`\n${'╔'.padEnd(64, '═')}╗`);
    console.log(`║  OGZPrime Phase 7B: FUNCTION CONNECTION MAP                 ║`);
    console.log(`║  "Map every function, find what's orphaned or miswired"     ║`);
    console.log(`║  ${new Date().toISOString().padEnd(61)}║`);
    console.log(`${'╚'.padEnd(64, '═')}╝`);
  }

  // Load all sources
  const allSources = [];
  const allFunctions = [];
  let totalLines = 0;

  for (const file of SCAN_FILES) {
    const fullPath = path.join(ROOT, file);
    try {
      const source = fs.readFileSync(fullPath, 'utf8');
      allSources.push({ file, source });
      const funcs = extractFunctions(file, source);
      allFunctions.push(...funcs);
      totalLines += source.split('\n').length;
    } catch (e) {
      if (!JSON_OUT) console.log(`  ⚠️  Skipping ${file}: ${e.message.split('\n')[0]}`);
    }
  }

  if (!JSON_OUT) {
    console.log(`\n  Scanned: ${allSources.length} files, ${totalLines.toLocaleString()} lines, ${allFunctions.length} functions\n`);
  }

  // ── Find where each function is called ──
  const connections = [];
  const orphans = [];
  const funcMap = {};

  // De-duplicate function names (same function might be parsed multiple times)
  const uniqueFuncs = [];
  const seen = new Set();
  for (const f of allFunctions) {
    const key = `${f.file}:${f.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueFuncs.push(f);
    }
  }

  for (const func of uniqueFuncs) {
    const calls = findCalls(func.name, allSources);
    funcMap[`${func.file}.${func.name}`] = { ...func, calledBy: calls, callCount: calls.length };

    if (calls.length === 0) {
      orphans.push(func);
    }

    for (const call of calls) {
      connections.push({
        from: { file: call.file, name: func.name },
        to: { file: func.file, name: func.name },
      });
    }
  }

  // ── ORPHANS ──
  if (!ONLY_NEAR && !MERMAID) {
    if (!JSON_OUT) {
      console.log(`${'═'.repeat(65)}`);
      console.log(`  ORPHAN FUNCTIONS — defined but never called`);
      console.log(`${'═'.repeat(65)}`);
    }

    // Filter out common false positives (constructors, getters, exports, event handlers)
    const realOrphans = orphans.filter(o =>
      !['constructor', 'destroy', 'toString', 'toJSON', 'valueOf'].includes(o.name) &&
      !o.name.startsWith('get') && !o.name.startsWith('set') &&
      !o.name.startsWith('on') && !o.name.startsWith('handle') &&
      !o.name.startsWith('_') &&
      o.name.length > 3
    );

    if (!JSON_OUT) {
      // Group by file
      const orphansByFile = {};
      for (const o of realOrphans) {
        if (!orphansByFile[o.file]) orphansByFile[o.file] = [];
        orphansByFile[o.file].push(o);
      }

      for (const [file, funcs] of Object.entries(orphansByFile)) {
        console.log(`\n  📁 ${file}:`);
        for (const f of funcs) {
          console.log(`     ⚠️  ${f.name}() — line ${f.line} — ${f.type} — NEVER CALLED`);

          // ── KEYWORD DECOMPOSITION SEARCH ──
          // Break function name into component words, search codebase for where
          // those words appear together — that's where this function SHOULD be wired
          const keywords = splitCamelCase(f.name).filter(w => w.length > 3);
          if (keywords.length >= 2) {
            const suspects = findKeywordMatches(keywords, f.name, f.file, allSources);
            if (suspects.length > 0) {
              console.log(`        🔎 Keywords: [${keywords.join(', ')}]`);
              for (const s of suspects.slice(0, 3)) { // Top 3 matches
                console.log(`        📍 ${s.file}:${s.line} — "${s.snippet.trim().substring(0, 90)}${s.snippet.trim().length > 90 ? '...' : ''}"`);
                if (s.type === 'comment') console.log(`           ^ TODO/comment — this is where it should be wired`);
                if (s.type === 'similar_call') console.log(`           ^ Similar function called here — should THIS be ${f.name}()?`);
                if (s.type === 'keyword_cluster') console.log(`           ^ Keywords cluster here — probable connection point`);
              }
            }
          }
        }
      }
      console.log(`\n  Total orphans: ${realOrphans.length} out of ${uniqueFuncs.length} functions`);
    }
  }

  // ── NEAR-MISSES (function names) ──
  if (!ONLY_ORPHANS && !MERMAID) {
    if (!JSON_OUT) {
      console.log(`\n${'═'.repeat(65)}`);
      console.log(`  NEAR-MISS FUNCTION NAMES — possible typos or refactor leftovers`);
      console.log(`${'═'.repeat(65)}`);
    }

    const nearMisses = findNearMisses(uniqueFuncs);
    if (!JSON_OUT) {
      if (nearMisses.length === 0) {
        console.log('  ✅ No suspicious near-miss function names found');
      }
      for (const nm of nearMisses) {
        console.log(`\n  🔍 '${nm.a}' vs '${nm.b}' (${nm.similarity} similar)`);
        console.log(`     ${nm.a} → ${nm.aFiles.join(', ')}`);
        console.log(`     ${nm.b} → ${nm.bFiles.join(', ')}`);
        if (nm.similarity === 'VARIANT') {
          console.log(`     ⚠️  Singular/plural variant — likely should be ONE name`);
        }
      }
    }
  }

  // ── STRING CONSTANT MISMATCHES ──
  if (!ONLY_ORPHANS && !MERMAID) {
    if (!JSON_OUT) {
      console.log(`\n${'═'.repeat(65)}`);
      console.log(`  STRING CONSTANT ANALYSIS — action names, exit reasons, directions`);
      console.log(`${'═'.repeat(65)}`);
    }

    const strings = findStringConstants(allSources);

    if (!JSON_OUT) {
      if (strings.nearMissStrings.length > 0) {
        console.log('\n  🔴 NEAR-MISS STRINGS (potential handoff bugs):');
        for (const nm of strings.nearMissStrings) {
          console.log(`\n     Produced: '${nm.produced}' in ${nm.producedIn.join(', ')}`);
          console.log(`     Consumed: '${nm.consumed}' in ${nm.consumedIn.join(', ')}`);
          console.log(`     Distance: ${nm.distance} char(s) different — POSSIBLE MISMATCH`);
        }
      }

      if (strings.orphanProducers.length > 0) {
        console.log('\n  🟡 PRODUCED BUT NEVER CHECKED:');
        for (const s of strings.orphanProducers) {
          const locs = strings.producers.filter(p => p.string === s);
          console.log(`     '${s}' — set in ${locs.map(l => `${l.file}:${l.line}`).join(', ')}`);
        }
      }

      if (strings.orphanConsumers.length > 0) {
        console.log('\n  🟡 CHECKED BUT NEVER PRODUCED:');
        for (const s of strings.orphanConsumers) {
          const locs = strings.consumers.filter(c => c.string === s);
          console.log(`     '${s}' — checked in ${locs.map(l => `${l.file}:${l.line}`).join(', ')}`);
        }
      }
    }
  }

  // ── MERMAID CHART ──
  if (MERMAID) {
    // Only include cross-file connections for readability
    const crossFile = connections.filter(c => c.from.file !== c.to.file);
    const uniqueConns = [];
    const connSeen = new Set();
    for (const c of crossFile) {
      const key = `${c.from.file}.${c.from.name}->${c.to.file}.${c.to.name}`;
      if (!connSeen.has(key)) {
        connSeen.add(key);
        uniqueConns.push(c);
      }
    }

    const mermaid = generateMermaid(uniqueFuncs, uniqueConns);
    console.log(mermaid);

    // Save to file
    const mermaidPath = path.join(ROOT, 'ogz-meta', 'ledger', 'connection-map.mermaid');
    fs.writeFileSync(mermaidPath, mermaid);
    if (!JSON_OUT) console.log(`\n  📄 Mermaid chart saved: ${mermaidPath}`);
  }

  // ── SUMMARY ──
  if (!JSON_OUT && !MERMAID) {
    const calledFuncs = uniqueFuncs.length - orphans.length;
    console.log(`\n${'═'.repeat(65)}`);
    console.log(`  SUMMARY`);
    console.log(`${'═'.repeat(65)}`);
    console.log(`  Functions found:    ${uniqueFuncs.length}`);
    console.log(`  Connected:          ${calledFuncs}`);
    console.log(`  Orphaned:           ${orphans.length}`);
    console.log(`  Files scanned:      ${allSources.length}`);
    console.log(`  Lines scanned:      ${totalLines.toLocaleString()}`);
    console.log(`${'═'.repeat(65)}\n`);
  }

  // Save JSON report
  if (JSON_OUT) {
    console.log(JSON.stringify({ funcMap, orphans, connections }, null, 2));
  } else {
    const reportPath = path.join(ROOT, 'logs', `phase7b-connectionmap-${new Date().toISOString().split('T')[0]}.json`);
    try {
      fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({ funcMap, orphans, connections: connections.length }, null, 2));
      console.log(`  📄 Report saved: ${reportPath}\n`);
    } catch (e) { /* skip if can't write */ }
  }
}

main();
