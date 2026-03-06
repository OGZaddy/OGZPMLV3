#!/usr/bin/env node
/**
 * Bombardier Dynamic Dependency Scanner
 * ======================================
 * Scans the ENTIRE codebase for module dependencies including:
 * 1. Static require() calls
 * 2. ModuleAutoLoader.get() dynamic loads
 * 3. IBroker/wrapper chain references
 * 4. Cross-references against archive/ to find incorrectly archived deps
 *
 * Usage:
 *   node tools/dep-scanner.js                    # Full scan
 *   node tools/dep-scanner.js --check-archive    # Only check archive safety
 *   node tools/dep-scanner.js --output json      # JSON output
 *
 * Created: 2026-03-06
 * Purpose: Prevent archiving live dependencies (the kraken_adapter_simple disaster)
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const IGNORE_DIRS = ['node_modules', '.git', 'archive', '.claude', 'ogz-meta/ledger'];
const ARCHIVE_DIR = path.join(PROJECT_ROOT, 'archive');

// ═══════════════════════════════════════════════════════════════
// STEP 1: Find all JS files in production (not archive)
// ═══════════════════════════════════════════════════════════════

function findJSFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(PROJECT_ROOT, fullPath);
    if (IGNORE_DIRS.some(d => relative.startsWith(d))) continue;
    if (entry.isDirectory()) {
      findJSFiles(fullPath, results);
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.bak')) {
      results.push(fullPath);
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// STEP 2: Extract all dependency references from a file
// ═══════════════════════════════════════════════════════════════

function extractDeps(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relative = path.relative(PROJECT_ROOT, filePath);
  const deps = [];

  // Pattern 1: require('./path') or require('../path')
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = requireRegex.exec(content)) !== null) {
    const target = match[1];
    if (target.startsWith('.')) {
      // Resolve relative to the file's directory
      const resolved = path.resolve(path.dirname(filePath), target);
      deps.push({
        type: 'require',
        source: relative,
        target: target,
        resolved: path.relative(PROJECT_ROOT, resolved),
        line: content.substring(0, match.index).split('\n').length
      });
    }
  }

  // Pattern 2: loader.get('category', 'moduleName')
  const loaderGetRegex = /loader\.get\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = loaderGetRegex.exec(content)) !== null) {
    const category = match[1];
    const moduleName = match[2];
    deps.push({
      type: 'loader.get',
      source: relative,
      target: `${category}/${moduleName}`,
      resolved: `${category}/${moduleName}.js`,
      line: content.substring(0, match.index).split('\n').length
    });
  }

  // Pattern 3: loader.get('moduleName') — single arg
  const loaderGetSingleRegex = /loader\.get\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = loaderGetSingleRegex.exec(content)) !== null) {
    // Skip if already matched by two-arg pattern
    if (match[0].includes(',')) continue;
    const moduleName = match[1];
    deps.push({
      type: 'loader.get',
      source: relative,
      target: moduleName,
      resolved: `core/${moduleName}.js`, // Default to core/
      line: content.substring(0, match.index).split('\n').length
    });
  }

  // Pattern 4: createBrokerAdapter('name') — BrokerFactory dynamic loads
  const brokerRegex = /createBrokerAdapter\s*\(\s*['"]([^'"]+)['"]/g;
  while ((match = brokerRegex.exec(content)) !== null) {
    deps.push({
      type: 'broker_factory',
      source: relative,
      target: match[1],
      resolved: `brokers/${match[1]}`, // Will need BrokerRegistry lookup
      line: content.substring(0, match.index).split('\n').length
    });
  }

  return deps;
}

// ═══════════════════════════════════════════════════════════════
// STEP 3: Resolve BrokerRegistry mappings
// ═══════════════════════════════════════════════════════════════

function resolveBrokerRegistry() {
  const registryPath = path.join(PROJECT_ROOT, 'brokers', 'BrokerRegistry.js');
  if (!fs.existsSync(registryPath)) return {};
  const content = fs.readFileSync(registryPath, 'utf8');
  const mappings = {};

  // Extract filePath mappings: filePath: './KrakenIBrokerAdapter'
  const regex = /(\w+):\s*\{[^}]*filePath:\s*['"]([^'"]+)['"]/gs;
  let match;
  while ((match = regex.exec(content)) !== null) {
    mappings[match[1]] = match[2];
  }
  return mappings;
}

// ═══════════════════════════════════════════════════════════════
// STEP 4: Build full dependency chain (follow wrappers)
// ═══════════════════════════════════════════════════════════════

function buildDependencyChain(allDeps) {
  const chains = [];

  for (const dep of allDeps) {
    if (dep.type === 'broker_factory') {
      const brokerMappings = resolveBrokerRegistry();
      const adapterFile = brokerMappings[dep.target];
      if (adapterFile) {
        chains.push({
          ...dep,
          chain: [
            `BrokerFactory('${dep.target}')`,
            `BrokerRegistry → ${adapterFile}`,
          ],
          resolvedFile: `brokers/${path.basename(adapterFile)}.js`
        });
      }
    }
  }

  return chains;
}

// ═══════════════════════════════════════════════════════════════
// STEP 5: Find all archived files
// ═══════════════════════════════════════════════════════════════

function findArchivedFiles() {
  const archived = [];
  if (!fs.existsSync(ARCHIVE_DIR)) return archived;

  function scan(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.name.endsWith('.js')) {
        archived.push({
          name: entry.name,
          basename: entry.name.replace('.js', ''),
          fullPath: fullPath,
          archivePath: path.relative(ARCHIVE_DIR, fullPath)
        });
      }
    }
  }
  scan(ARCHIVE_DIR);
  return archived;
}

// ═══════════════════════════════════════════════════════════════
// STEP 6: Cross-reference deps against archive
// ═══════════════════════════════════════════════════════════════

function checkArchiveSafety(allDeps, archivedFiles) {
  const problems = [];

  for (const dep of allDeps) {
    // Check if the resolved target exists
    let targetFile = dep.resolved;
    if (!targetFile.endsWith('.js')) targetFile += '.js';

    const fullTarget = path.join(PROJECT_ROOT, targetFile);

    // Does the target exist in production?
    if (!fs.existsSync(fullTarget) && !fs.existsSync(fullTarget.replace('.js', '/index.js'))) {
      // Is it in the archive?
      const basename = path.basename(targetFile, '.js');
      const inArchive = archivedFiles.find(a => a.basename === basename);

      if (inArchive) {
        problems.push({
          severity: 'CRITICAL',
          message: `${dep.source}:${dep.line} requires "${dep.target}" but it's ARCHIVED at ${inArchive.archivePath}`,
          dep: dep,
          archivedFile: inArchive
        });
      } else {
        // Check if it's a node_module or built-in
        try {
          require.resolve(dep.target);
        } catch {
          problems.push({
            severity: 'WARNING',
            message: `${dep.source}:${dep.line} requires "${dep.target}" — file not found (may be optional or conditional)`,
            dep: dep
          });
        }
      }
    }
  }

  return problems;
}

// ═══════════════════════════════════════════════════════════════
// STEP 7: Generate orphan report (files not imported by anything)
// ═══════════════════════════════════════════════════════════════

function findOrphans(jsFiles, allDeps) {
  const imported = new Set();

  for (const dep of allDeps) {
    // Normalize resolved paths
    let resolved = dep.resolved;
    if (!resolved.endsWith('.js')) resolved += '.js';
    imported.add(resolved);
    // Also add without .js
    imported.add(resolved.replace('.js', ''));
  }

  const orphans = [];
  const entryPoints = ['run-empire-v2.js', 'ogzprime-ssl-server.js', 'stripe-checkout.js'];

  for (const file of jsFiles) {
    const relative = path.relative(PROJECT_ROOT, file);
    // Skip entry points, config files, tools
    if (entryPoints.includes(relative)) continue;
    if (relative.startsWith('tools/')) continue;
    if (relative.startsWith('tuning/')) continue;
    if (relative.startsWith('scripts/')) continue;
    if (relative.startsWith('devtools/')) continue;
    if (relative === 'instrument.js') continue;

    // Check if any dep resolves to this file
    const isImported = allDeps.some(d => {
      let resolved = d.resolved;
      if (!resolved.endsWith('.js')) resolved += '.js';
      return resolved === relative || resolved === relative.replace('.js', '');
    });

    if (!isImported) {
      orphans.push(relative);
    }
  }

  return orphans;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

function main() {
  const args = process.argv.slice(2);
  const checkArchiveOnly = args.includes('--check-archive');
  const jsonOutput = args.includes('--output') && args[args.indexOf('--output') + 1] === 'json';

  console.log('🎯 BOMBARDIER DEPENDENCY SCANNER');
  console.log('='.repeat(60));
  console.log(`Project root: ${PROJECT_ROOT}`);

  // Step 1: Find all JS files
  const jsFiles = findJSFiles(PROJECT_ROOT);
  console.log(`\n📁 Production JS files: ${jsFiles.length}`);

  // Step 2: Extract all deps
  const allDeps = [];
  for (const file of jsFiles) {
    const deps = extractDeps(file);
    allDeps.push(...deps);
  }

  console.log(`📦 Total dependency references: ${allDeps.length}`);
  console.log(`   require():        ${allDeps.filter(d => d.type === 'require').length}`);
  console.log(`   loader.get():     ${allDeps.filter(d => d.type === 'loader.get').length}`);
  console.log(`   broker_factory:   ${allDeps.filter(d => d.type === 'broker_factory').length}`);

  // Step 3: Broker chains
  const chains = buildDependencyChain(allDeps);
  if (chains.length > 0) {
    console.log(`\n🔗 Broker chains detected:`);
    for (const chain of chains) {
      console.log(`   ${chain.chain.join(' → ')}`);
    }
  }

  // Step 4: Archive safety check
  const archivedFiles = findArchivedFiles();
  console.log(`\n📦 Archived files: ${archivedFiles.length}`);

  const problems = checkArchiveSafety(allDeps, archivedFiles);

  if (problems.length > 0) {
    console.log(`\n🚨 ARCHIVE SAFETY ISSUES: ${problems.length}`);
    console.log('-'.repeat(60));

    const critical = problems.filter(p => p.severity === 'CRITICAL');
    const warnings = problems.filter(p => p.severity === 'WARNING');

    if (critical.length > 0) {
      console.log(`\n❌ CRITICAL (${critical.length}) — These WILL crash the bot:`);
      for (const p of critical) {
        console.log(`   ${p.message}`);
        if (p.archivedFile) {
          console.log(`   FIX: cp archive/${p.archivedFile.archivePath} ${p.dep.resolved}.js`);
        }
      }
    }

    if (warnings.length > 0) {
      console.log(`\n⚠️  WARNINGS (${warnings.length}) — May be optional/conditional:`);
      for (const p of warnings) {
        console.log(`   ${p.message}`);
      }
    }
  } else {
    console.log(`\n✅ ARCHIVE SAFETY: All dependencies resolved. Safe to proceed.`);
  }

  if (!checkArchiveOnly) {
    // Step 5: Orphan detection
    const orphans = findOrphans(jsFiles, allDeps);
    if (orphans.length > 0) {
      console.log(`\n👻 ORPHAN FILES (${orphans.length}) — Not imported by any production code:`);
      for (const o of orphans) {
        console.log(`   ${o}`);
      }
      console.log(`\n   NOTE: Orphans MAY be entry points, CLI tools, or dynamically loaded.`);
      console.log(`   Verify before archiving!`);
    }
  }

  // JSON output
  if (jsonOutput) {
    const report = {
      timestamp: new Date().toISOString(),
      files: jsFiles.length,
      dependencies: allDeps.length,
      archived: archivedFiles.length,
      problems: problems,
      chains: chains
    };
    const outPath = path.join(PROJECT_ROOT, 'tuning', `dep-scan-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Full report: ${outPath}`);
  }

  console.log('\n' + '='.repeat(60));

  if (problems.some(p => p.severity === 'CRITICAL')) {
    console.log('❌ SCAN FAILED — Critical dependencies in archive');
    process.exit(1);
  } else {
    console.log('✅ SCAN PASSED');
    process.exit(0);
  }
}

main();
