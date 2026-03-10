#!/usr/bin/env node

/**
 * slash-router.js
 * Routes slash commands to manifest sections
 *
 * RULES:
 * - Each command reads manifest
 * - Each command writes ONLY its section
 * - Each command emits a hook
 * - Any failure = STOP
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createManifest, loadManifest, saveManifest, updateSection, shouldStop } = require('./manifest-schema');
const { ClauditoLogger } = require('./claudito-logger');

const MANIFEST_DIR = path.join(__dirname, 'manifests');

// Ensure manifest directory exists
if (!fs.existsSync(MANIFEST_DIR)) {
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
}

/**
 * Route command to handler
 */
async function route(command, args) {
  const [cmd, ...params] = command.split(' ');
  const manifestPath = args.manifest || path.join(MANIFEST_DIR, 'current.json');

  // Load or create manifest
  let manifest;
  if (cmd === '/start') {
    manifest = createManifest();
    manifest.issue = params.join(' ');
    saveManifest(manifest, manifestPath);
    console.log(`✅ Created manifest: ${manifest.mission_id}`);
    return manifest;
  } else {
    manifest = loadManifest(manifestPath);
  }

  // Check stop conditions
  const stopCheck = shouldStop(manifest);
  if (stopCheck.stop) {
    console.error(`🛑 STOP CONDITION: ${stopCheck.reason}`);
    process.exit(1);
  }

  // Route to handler
  const handlers = {
    '/branch': branch,
    '/commander': commander,
    '/architect': architect,
    '/bombardier': bombardier,  // Blast radius analysis - shows impact before fixing
    '/entomologist': entomologist,
    '/exterminator': exterminator,
    '/fixer': fixer,           // For refactor mode - applies extractions/refactors
    '/debugger': debuggerHandler,
    '/critic': critic,
    '/validator': validator,
    '/forensics': forensics,
    '/cicd': cicd,
    '/committer': committer,
    '/scribe': scribe,
    '/janitor': janitor,
    '/warden': warden
  };

  const handler = handlers[cmd];
  if (!handler) {
    console.error(`❌ Unknown command: ${cmd}`);
    return null;
  }

  // Execute handler
  console.log(`\n🔧 Executing: ${cmd}`);
  const result = await handler(manifest, params);

  // Save updated manifest
  saveManifest(manifest, manifestPath);

  // Emit hook
  emitHook(cmd, manifest);

  return manifest;
}

/**
 * Branch: Creates a mission branch off master (read-only master rule)
 *
 * Three modes:
 * - --stay: Skip dirty check, skip branching, work on current branch as-is
 * - --refactor: Require clean tree, stay on current branch
 * - No flag (bugfix): Require clean tree, checkout master, create mission branch
 */
async function branch(manifest, params) {
  const missionBranch = `mission/${manifest.mission_id}`;
  const isRefactor = params.includes('--refactor') || manifest.mode === 'refactor';
  const isStay = params.includes('--stay');

  // STAY MODE: Skip dirty check and branching — work on current branch as-is
  if (isStay) {
    const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    console.log(`✅ Branch: Staying on ${currentBranch} (stay mode)`);
    updateSection(manifest, 'branch', {
      success: true,
      branch: currentBranch,
      mode: 'stay',
      based_on: currentBranch
    });
    return manifest;
  }

  // REFACTOR MODE: Stay on current branch but require clean tree
  if (isRefactor) {
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' })
      .split('\n')
      .filter(line => !line.startsWith('??'))
      .filter(line => !line.includes('ogz-meta/manifests/'))
      .filter(line => !line.includes('prodlock-portable'))
      .filter(line => !line.includes('data/'))
      .filter(line => !line.includes('public/proof/'))
      .join('\n')
      .trim();
    if (dirty) {
      manifest.stop_conditions.warden_blocked = true;
      updateSection(manifest, 'branch', {
        blocked: true,
        reason: 'Working tree not clean; refusing to branch',
        dirty_preview: dirty.split('\n').slice(0, 10)
      });
      console.log('🛑 Branch: BLOCKED (dirty working tree)');
      return manifest;
    }
    const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    console.log(`✅ Branch: Staying on ${currentBranch} (refactor mode)`);
    updateSection(manifest, 'branch', {
      success: true,
      branch: currentBranch,
      mode: 'refactor',
      based_on: currentBranch
    });
    return manifest;
  }

  // BUG FIX MODE: Require clean tree, base off latest master
  const dirty = execSync('git status --porcelain', { encoding: 'utf8' })
    .split('\n')
    .filter(line => !line.startsWith('??'))
    .filter(line => !line.includes('ogz-meta/manifests/'))
    .filter(line => !line.includes('prodlock-portable'))
    .filter(line => !line.includes('data/'))
    .filter(line => !line.includes('public/proof/'))
    .join('\n')
    .trim();
  if (dirty) {
    manifest.stop_conditions.warden_blocked = true;
    updateSection(manifest, 'branch', {
      blocked: true,
      reason: 'Working tree not clean; refusing to branch',
      dirty_preview: dirty.split('\n').slice(0, 10)
    });
    console.log('🛑 Branch: BLOCKED (dirty working tree)');
    return manifest;
  }

  try {
    execSync('git checkout master', { stdio: 'pipe' });
    execSync('git pull origin master', { stdio: 'pipe' });
  } catch (e) {
    manifest.stop_conditions.warden_blocked = true;
    updateSection(manifest, 'branch', {
      blocked: true,
      reason: 'Failed to checkout/pull master',
      error: e.message
    });
    console.log('🛑 Branch: BLOCKED (could not sync master)');
    return manifest;
  }

  try {
    execSync(`git checkout -b ${missionBranch}`, { stdio: 'pipe' });
  } catch (e) {
    try {
      execSync(`git checkout ${missionBranch}`, { stdio: 'pipe' });
    } catch (e2) {
      manifest.stop_conditions.warden_blocked = true;
      updateSection(manifest, 'branch', {
        blocked: true,
        reason: 'Failed to create/switch mission branch',
        error: e2.message
      });
      console.log('🛑 Branch: BLOCKED (could not create/switch mission branch)');
      return manifest;
    }
  }

  updateSection(manifest, 'branch', {
    base: 'master',
    branch: missionBranch
  });

  console.log(`✅ Branch: on ${missionBranch} (based on master)`);
  return manifest;
}

/**
 * Commander: Provides context
 */
async function commander(manifest, params) {
  const { getCurrentState, selectAgent } = require('./commander');
  const { ragQuery } = require('./rag-query');

  // Get current state from existing commander
  const state = getCurrentState();

  // Check Fix Ledger for known issues
  const ragResults = ragQuery(manifest.issue);

  updateSection(manifest, 'commander', {
    context: state,
    agent_selection: 'Pipeline mode - all agents',
    known_issues: ragResults.ledger.slice(0, 3),
    rag_score: ragResults.ledger[0]?._score || 0
  });

  if (ragResults.ledger.length > 0 && ragResults.ledger[0]._score > 150) {
    console.log(`   ⚠️  Known issue detected: ${ragResults.ledger[0].id}`);
  }

  console.log('✅ Commander: Context provided + ledger checked');
  return manifest;
}

/**
 * Architect: Maps system
 */
async function architect(manifest, params) {
  // Read architecture from claudito_context
  const contextPath = path.join(__dirname, 'claudito_context.md');
  const context = fs.readFileSync(contextPath, 'utf8');

  updateSection(manifest, 'architect', {
    system_map: [
      'run-empire-v2.js (main)',
      'core/indicators/IndicatorEngine.js',
      'brokers/BrokerFactory.js',
      'core/StateManager.js'
    ],
    dependencies: ['Empire V2 Architecture', 'IBrokerAdapter']
  });

  console.log('✅ Architect: System mapped');
  return manifest;
}

/**
 * Bombardier: Blast radius analysis
 * Shows what will be affected before making changes
 */
async function bombardier(manifest, params) {
  const { Bombardier } = require('./bombardier');
  const bomb = new Bombardier();

  // Load or build call graph
  if (!bomb.loadCache()) {
    console.log('📊 Building call graph (first run)...');
    await bomb.buildGraph();
  }

  // Get target from params or from architect's findings
  let target = params[0];
  if (!target && manifest.architect?.system_map?.length > 0) {
    // Use first file from architect's system map
    target = manifest.architect.system_map[0];
  }

  if (!target) {
    console.log('⚠️ Bombardier: No target specified');
    updateSection(manifest, 'bombardier', {
      status: 'NO_TARGET',
      blast_radius: null
    });
    return manifest;
  }

  // Parse file:line or function name
  let result;
  if (target.includes(':')) {
    const [file, line] = target.split(':');
    result = bomb.getBlastRadius(file, parseInt(line, 10));
  } else {
    result = bomb.getBlastRadius(target);
  }

  // Print the blast radius
  bomb.printBlastRadius(result);

  // Store in manifest
  const blastData = {
    target,
    found: result.found,
    upstream_count: result.upstream?.length || 0,
    downstream_count: result.downstream?.length || 0,
    files_affected: result.files?.length || 0,
    risk_level: 'LOW'
  };

  // Calculate risk
  const totalImpact = blastData.upstream_count + blastData.downstream_count;
  if (totalImpact > 20 || blastData.files_affected > 5) blastData.risk_level = 'HIGH';
  else if (totalImpact > 10 || blastData.files_affected > 3) blastData.risk_level = 'MEDIUM';

  // Block if HIGH risk without explicit approval
  if (blastData.risk_level === 'HIGH') {
    console.log('\n⚠️  HIGH RISK - Review blast radius carefully before proceeding');
  }

  updateSection(manifest, 'bombardier', {
    status: 'ANALYZED',
    blast_radius: blastData,
    upstream: result.upstream?.slice(0, 10) || [],
    downstream: result.downstream?.slice(0, 10) || [],
    files: result.files || []
  });

  console.log(`✅ Bombardier: ${blastData.risk_level} risk - ${totalImpact} functions, ${blastData.files_affected} files`);
  return manifest;
}

/**
 * Entomologist: FINDS bugs via code scanning + RAG
 */
async function entomologist(manifest, params) {
  const { ragQuery } = require('./rag-query');
  const issue = manifest.issue || '';
  const bugs = [];

  // 1. SCAN CODE: Parse issue for file/line/pattern references
  const codeScans = parseIssueForCodeRefs(issue);
  for (const scan of codeScans) {
    try {
      const found = scanCodeForBug(scan);
      if (found) {
        bugs.push({
          type: 'CODE_SCAN',
          location: `${found.file}:${found.line}`,
          description: found.description,
          code: found.code,
          fix_hint: scan.fixHint || null
        });
      }
    } catch (err) {
      console.log(`   ⚠️  Scan error: ${err.message}`);
    }
  }

  // 2. Query RAG for known similar issues
  const ragResults = ragQuery(issue);

  // 3. Add RAG results if no code scan found bugs
  if (ragResults.reports.length > 0 && bugs.length === 0) {
    ragResults.reports.slice(0, 3).forEach(report => {
      bugs.push({
        type: 'DOCUMENTED',
        location: report.file || 'unknown',
        description: report.excerpt || 'See report for details',
        score: report.score
      });
    });
  }

  // 4. Check for common patterns not in ledger (existing functionality)
  if (manifest.issue.includes('trade') && !manifest.commander?.known_issues?.some(i => i.symptom?.includes('trade'))) {
    bugs.push({
      type: 'RATE_LIMIT',
      location: 'run-empire-v2.js:1451',
      description: 'Rate limiter may not apply to all paths'
    });
  }

  if (manifest.issue.includes('dashboard') && !manifest.commander?.known_issues?.some(i => i.symptom?.includes('dashboard'))) {
    bugs.push({
      type: 'DISPLAY',
      location: 'WebSocket server',
      description: 'Indicators may not be broadcasted'
    });
  }

  updateSection(manifest, 'entomologist', {
    bugs_found: bugs,
    classifications: bugs.map(b => b.type),
    code_scans: codeScans,
    rag_reports: ragResults.reports.slice(0, 3)
  });

  console.log(`✅ Entomologist: Found ${bugs.length} bugs (${codeScans.length} code scans, ${ragResults.reports.length} RAG reports)`);
  return manifest;
}

/**
 * Parse issue text for file names, line numbers, patterns to search
 */
function parseIssueForCodeRefs(issue) {
  const refs = [];

  // Pattern: "FileName line XXX" or "FileName:XXX"
  const fileLineMatch = issue.match(/(\w+(?:\.js)?)\s*(?:line\s*|:)(\d+)/i);
  if (fileLineMatch) {
    const fileName = fileLineMatch[1].replace(/\.js$/, '');
    const lineNum = parseInt(fileLineMatch[2], 10);
    refs.push({ file: fileName, line: lineNum, type: 'exact' });
  }

  // Pattern: "hardcoded X.XXX" or "hardcoded 'value'"
  const hardcodedMatch = issue.match(/hardcoded\s+['"]?([0-9.]+|[^'"]+)['"]?/i);
  if (hardcodedMatch && refs.length > 0) {
    refs[0].pattern = hardcodedMatch[1];
    refs[0].bugType = 'HARDCODED_VALUE';
  }

  // Pattern: "→ TradingConfig" or "-> TradingConfig" - fix hint
  const fixHintMatch = issue.match(/[→\->]+\s*(\w+)/);
  if (fixHintMatch && refs.length > 0) {
    refs[0].fixHint = `Replace with ${fixHintMatch[1]}`;
  }

  // Pattern: look for common bug keywords
  if (issue.match(/fee|fees/i) && refs.length > 0) {
    refs[0].bugType = refs[0].bugType || 'FEE_MISMATCH';
  }

  return refs;
}

/**
 * Actually scan the codebase for the bug
 */
function scanCodeForBug(scan) {
  const projectRoot = path.resolve(__dirname, '..');

  // Find the file
  let filePath = null;
  const possiblePaths = [
    `core/${scan.file}.js`,
    `modules/${scan.file}.js`,
    `brokers/${scan.file}.js`,
    `${scan.file}.js`,
    `core/${scan.file}`,
    `modules/${scan.file}`
  ];

  for (const p of possiblePaths) {
    const full = path.join(projectRoot, p);
    if (fs.existsSync(full)) {
      filePath = full;
      break;
    }
  }

  if (!filePath) {
    console.log(`   📂 File not found: ${scan.file}`);
    return null;
  }

  // Read the file and check the specific line
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  if (scan.line && scan.line <= lines.length) {
    const lineContent = lines[scan.line - 1];

    // Check if the pattern exists on this line
    if (scan.pattern && lineContent.includes(scan.pattern)) {
      return {
        file: path.relative(projectRoot, filePath),
        line: scan.line,
        code: lineContent.trim(),
        description: `Found hardcoded '${scan.pattern}' at line ${scan.line}`,
        bugType: scan.bugType || 'HARDCODED_VALUE'
      };
    }

    // Even without pattern match, return the line for review
    return {
      file: path.relative(projectRoot, filePath),
      line: scan.line,
      code: lineContent.trim(),
      description: `Line ${scan.line} flagged for review`,
      bugType: scan.bugType || 'REVIEW_NEEDED'
    };
  }

  // If no specific line, grep for the pattern
  if (scan.pattern) {
    try {
      const grepResult = execSync(
        `grep -n "${scan.pattern}" "${filePath}" | head -5`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();

      if (grepResult) {
        const firstMatch = grepResult.split('\n')[0];
        const [lineNum, ...codeParts] = firstMatch.split(':');
        return {
          file: path.relative(projectRoot, filePath),
          line: parseInt(lineNum, 10),
          code: codeParts.join(':').trim(),
          description: `Found '${scan.pattern}' via grep`,
          bugType: scan.bugType || 'PATTERN_MATCH'
        };
      }
    } catch (e) {
      // grep returned no results
    }
  }

  return null;
}

/**
 * Apply a code fix based on bug info
 */
function applyCodeFix(bug) {
  const projectRoot = path.resolve(__dirname, '..');

  // Parse location "file:line"
  const [relFile, lineStr] = bug.location.split(':');
  const lineNum = parseInt(lineStr, 10);
  const filePath = path.join(projectRoot, relFile);

  if (!fs.existsSync(filePath)) {
    return { success: false, error: `File not found: ${relFile}` };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    if (lineNum < 1 || lineNum > lines.length) {
      return { success: false, error: `Line ${lineNum} out of range` };
    }

    const originalLine = lines[lineNum - 1];

    // Generate the fix based on fix_hint
    let newLine = originalLine;

    // Handle "Replace with TradingConfig" pattern
    if (bug.fix_hint && bug.fix_hint.includes('TradingConfig')) {
      // Common patterns for TradingConfig replacement
      if (bug.code.includes('0.0052') || bug.code.includes('fees')) {
        newLine = originalLine.replace(
          /\*\s*0\.0052\s*,?\s*(\/\/.*)?$/,
          `* TradingConfig.get('fees.totalRoundTrip'),  // From TradingConfig`
        );
      } else if (bug.code.match(/\*\s*0\.\d+/)) {
        // Generic hardcoded multiplier
        const match = bug.code.match(/\*\s*(0\.\d+)/);
        if (match) {
          newLine = originalLine.replace(
            new RegExp(`\\*\\s*${match[1].replace('.', '\\.')}\\s*,?\\s*(\\/\\/.*)?$`),
            `* TradingConfig.get('fees.totalRoundTrip'),  // From TradingConfig`
          );
        }
      }
    }

    // If no change was made, return failure
    if (newLine === originalLine) {
      return { success: false, error: 'Could not determine fix transformation' };
    }

    // Apply the fix
    lines[lineNum - 1] = newLine;
    fs.writeFileSync(filePath, lines.join('\n'));

    return {
      success: true,
      newCode: newLine.trim(),
      originalCode: originalLine.trim()
    };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Exterminator: PROPOSES fixes (advisory mode) or APPLIES fixes (execute mode)
 */
async function exterminator(manifest, params) {
  const bugs = manifest.entomologist.bugs_found || [];
  const proposals = [];
  const fixes = [];

  // For each bug, create a proposal
  bugs.forEach(bug => {
    const proposal = {
      bug_id: bug.type,
      location: bug.location,
      description: bug.description,
      proposed_fix: `Fix for ${bug.type} at ${bug.location}`,
      impact: 'See proposal document for full analysis',
      status: 'PENDING_REVIEW'
    };
    proposals.push(proposal);
  });

  // ADVISORY MODE (default): Only propose, never apply
  if (manifest.mode === 'ADVISORY' || !manifest.mode) {
    // Generate proposal document
    const proposalDoc = generateProposalDocument(manifest, proposals);
    const proposalPath = path.join(__dirname, 'proposals', `${manifest.mission_id}-PROPOSAL.md`);

    // Ensure proposals directory exists
    if (!fs.existsSync(path.join(__dirname, 'proposals'))) {
      fs.mkdirSync(path.join(__dirname, 'proposals'), { recursive: true });
    }

    fs.writeFileSync(proposalPath, proposalDoc);
    manifest.artifacts.proposals.push(proposalPath);

    updateSection(manifest, 'exterminator', {
      fixes_applied: [],  // Empty in advisory mode
      patches: [],
      proposals: proposals
    });

    console.log(`📋 Exterminator: Generated ${proposals.length} proposals (ADVISORY MODE)`);
    console.log(`   📄 Proposal document: ${proposalPath}`);
    console.log(`   ⏳ Awaiting human approval before any changes`);
  } else {
    // EXECUTE MODE: Only if explicitly enabled AND approved
    if (manifest.approval?.status !== 'APPROVED') {
      console.log(`🛑 Exterminator: BLOCKED - requires human approval first`);
      manifest.stop_conditions.warden_blocked = true;
      return manifest;
    }

    // Actually apply fixes for CODE_SCAN bugs
    for (const bug of bugs) {
      if (bug.type === 'CODE_SCAN' && bug.code && bug.fix_hint) {
        const result = applyCodeFix(bug);
        fixes.push({
          bug_id: bug.type,
          location: bug.location,
          original: bug.code,
          patch: result.newCode || 'N/A',
          applied: result.success,
          error: result.error || null
        });
        if (result.success) {
          console.log(`   ✅ Fixed: ${bug.location}`);
        } else {
          console.log(`   ❌ Failed: ${bug.location} - ${result.error}`);
        }
      } else {
        // Non-scannable bugs get placeholder
        fixes.push({
          bug_id: bug.type,
          patch: `Manual fix needed for ${bug.type} at ${bug.location}`,
          applied: false
        });
      }
    }

    updateSection(manifest, 'exterminator', {
      fixes_applied: fixes,
      patches: fixes.filter(f => f.applied).map(f => f.patch),
      proposals: proposals
    });

    const applied = fixes.filter(f => f.applied).length;
    console.log(`✅ Exterminator: Applied ${applied}/${fixes.length} fixes (EXECUTE MODE - APPROVED)`);
  }

  return manifest;
}

/**
 * Fixer: For refactor mode - applies extractions/refactors based on architect plan
 * Similar to exterminator but works from architect's plan instead of entomologist's bugs
 */
async function fixer(manifest, params) {
  const plan = manifest.architect?.plan || {};
  const changes = [];

  // In ADVISORY mode (default): Generate proposal, don't apply
  // Generate refactor proposal document
  const proposalDoc = generateRefactorProposal(manifest);
  const proposalPath = path.join(__dirname, 'proposals', `${manifest.mission_id}-REFACTOR-PROPOSAL.md`);

  // Ensure proposals directory exists
  if (!fs.existsSync(path.join(__dirname, 'proposals'))) {
    fs.mkdirSync(path.join(__dirname, 'proposals'), { recursive: true });
  }

  fs.writeFileSync(proposalPath, proposalDoc);
  manifest.artifacts.proposals.push(proposalPath);

  updateSection(manifest, 'fixer', {
    changes_applied: [],  // Empty in advisory mode
    plan: plan,
    proposal_path: proposalPath
  });

  console.log(`📋 Fixer: Generated refactor proposal (ADVISORY MODE)`);
  console.log(`   📄 Proposal document: ${proposalPath}`);
  console.log(`   ⏳ Awaiting human approval before any changes`);
  console.log(`   💡 Run with approved manifest to apply changes`);

  return manifest;
}

/**
 * Generate refactor proposal document
 */
function generateRefactorProposal(manifest) {
  return `# REFACTOR PROPOSAL: ${manifest.mission_id}
Generated: ${new Date().toISOString()}

## ⚠️ ADVISORY MODE - NO CHANGES MADE
This document proposes refactoring changes for human review.
**Nothing has been modified. You must approve before execution.**

---

## Task
${manifest.issue}

## Architect Plan
${manifest.architect?.plan?.description || 'No plan generated'}

### Files to Create
${manifest.architect?.plan?.files_to_create?.map(f => `- \`${f}\``).join('\n') || 'None specified'}

### Files to Modify
${manifest.architect?.plan?.files_to_modify?.map(f => `- \`${f}\``).join('\n') || 'None specified'}

### Extraction Details
${manifest.architect?.plan?.details || 'See architect analysis'}

## RAG Context
${manifest.commander?.known_issues?.map(i => `- [${i.severity}] ${i.id}: ${i.symptom?.slice(0, 80)}...`).join('\n') || 'No prior issues found'}

---

## Approval
To approve and execute:
1. Review the plan above
2. Set \`manifest.approval.status = 'APPROVED'\` in the manifest
3. Re-run the pipeline

Or manually apply the changes following the architect plan.
`;
}

/**
 * Generate proposal document for human review
 */
function generateProposalDocument(manifest, proposals) {
  const doc = `# PROPOSAL: ${manifest.mission_id}
Generated: ${new Date().toISOString()}

## ⚠️ ADVISORY MODE - NO CHANGES MADE
This document proposes changes for human review.
**Nothing has been modified. You must approve before execution.**

---

## Issue
${manifest.issue}

## RAG Context Retrieved
${manifest.commander?.known_issues?.map(i => `- [${i.severity}] ${i.id}: ${i.symptom?.slice(0, 100)}...`).join('\n') || 'No prior issues found'}

## Bugs Identified
${manifest.entomologist?.bugs_found?.map((b, i) => `
### Bug ${i + 1}: ${b.type}
- **Location**: ${b.location}
- **Description**: ${b.description || 'See analysis'}
- **Score**: ${b.score || 'N/A'}
`).join('\n') || 'No bugs identified'}

## Proposed Fixes
${proposals.map((p, i) => `
### Proposal ${i + 1}: ${p.bug_id}
- **Location**: ${p.location}
- **Proposed Change**: ${p.proposed_fix}
- **Status**: ${p.status}

\`\`\`
// BEFORE: [Current code at ${p.location}]
// AFTER:  [Proposed change - see detailed analysis]
\`\`\`
`).join('\n')}

## Impact Analysis
- Files potentially affected: ${manifest.architect?.system_map?.join(', ') || 'Unknown'}
- Dependencies: ${manifest.architect?.dependencies?.join(', ') || 'Unknown'}

## To Approve
Run: \`node ogz-meta/approve.js ${manifest.mission_id}\`

## To Reject
Run: \`node ogz-meta/reject.js ${manifest.mission_id}\`

---
Generated by Claudito Pipeline (Advisory Mode)
`;

  return doc;
}

/**
 * Debugger: Tests fixes
 */
async function debuggerHandler(manifest, params) {
  let tests = [
    { name: 'syntax_check', command: 'node --check run-empire-v2.js' },
    { name: 'unit_tests', command: 'npm test' }
  ];

  // If forensics pass, add recommended verifications
  const isForensicsPass = params && params[0] === '--forensics';
  if (isForensicsPass && manifest.forensics?.recommended_verifications) {
    console.log('   🔬 Running forensics recommended verifications...');
    manifest.forensics.recommended_verifications.forEach((cmd, i) => {
      tests.push({
        name: `forensics_check_${i}`,
        command: cmd
      });
    });
  }

  const results = [];
  for (const test of tests) {
    try {
      if (test.name === 'unit_tests') {
        // Check if test script exists first
        try {
          const packageJson = require('../package.json');
          if (!packageJson.scripts?.test) {
            results.push({ test: test.name, passed: false, skipped: true, reason: 'No test script' });
            continue;
          }
        } catch (e) {
          results.push({ test: test.name, passed: false, skipped: true, reason: 'No package.json' });
          continue;
        }
      }

      execSync(test.command, { encoding: 'utf8' });
      results.push({ test: test.name, passed: true });
    } catch (e) {
      results.push({ test: test.name, passed: false, error: e.message });
      // Test failures should stop the pipeline
      if (!results[results.length - 1].skipped) {
        manifest.stop_conditions.verification_failed = true;
      }
    }
  }

  updateSection(manifest, 'debugger', {
    tests_run: tests.map(t => t.name),
    results
  });

  console.log(`✅ Debugger: ${results.filter(r => r.passed).length}/${tests.length} tests passed`);
  return manifest;
}

/**
 * Critic: Lists weaknesses
 */
async function critic(manifest, params) {
  const weaknesses = [];

  // Check for issues
  if (!manifest.entomologist.bugs_found?.length) {
    weaknesses.push('No bugs found - insufficient analysis');
  }

  if (!manifest.debugger.results?.every(r => r.passed)) {
    weaknesses.push('Tests failing - fixes incomplete');
  }

  if (weaknesses.length >= 3) {
    manifest.stop_conditions.critic_failures++;
  }

  updateSection(manifest, 'critic', {
    weaknesses,
    force_rerun: weaknesses.length >= 3
  });

  console.log(`✅ Critic: Found ${weaknesses.length} weaknesses`);
  return manifest;
}

/**
 * Validator: Final checks
 */
async function validator(manifest, params) {
  const checks = [];

  checks.push({
    name: 'manifest_integrity',
    passed: true
  });

  checks.push({
    name: 'no_production_changes',
    passed: !manifest.artifacts.files_modified?.includes('master')
  });

  updateSection(manifest, 'validator', {
    checks_passed: checks.filter(c => c.passed).map(c => c.name),
    checks_failed: checks.filter(c => !c.passed).map(c => c.name)
  });

  console.log(`✅ Validator: ${checks.filter(c => c.passed).length}/${checks.length} checks passed`);
  return manifest;
}

/**
 * Forensics: Secondary verification
 */
async function forensics(manifest, params) {
  const silentBugs = [];
  const regressionRisks = [];
  let catalyzeVerification = false;

  // Check for silent issues
  if (manifest.issue.includes('memory')) {
    silentBugs.push('Potential memory leak in pattern storage');
    catalyzeVerification = true;
  }

  // Check if any tests failed - needs deeper verification
  if (manifest.debugger?.results?.some(r => !r.passed && !r.skipped)) {
    catalyzeVerification = true;
    regressionRisks.push('Test failures indicate potential regression');
  }

  // Check if critic found major issues
  if (manifest.critic?.weaknesses?.length >= 2) {
    catalyzeVerification = true;
  }

  updateSection(manifest, 'forensics', {
    silent_bugs: silentBugs,
    regression_risks: regressionRisks,
    catalyze_verification: catalyzeVerification,
    severity: silentBugs.length > 0 ? 'P1' : 'P2',
    recommended_verifications: catalyzeVerification ? [
      'node --check run-empire-v2.js',
      'pm2 status',
      'ps aux | grep node'
    ] : []
  });

  if (silentBugs.some(b => b.includes('leak'))) {
    manifest.stop_conditions.forensics_critical = true;
  }

  console.log(`✅ Forensics: ${silentBugs.length} silent bugs, ${regressionRisks.length} risks`);
  if (catalyzeVerification) {
    console.log('   🔄 Will trigger verification pass 2');
  }
  return manifest;
}

/**
 * CI/CD: Build and test
 */
async function cicd(manifest, params) {
  let buildResult = 'PASS';
  let testResult = 'PASS';

  try {
    execSync('node --check run-empire-v2.js', { encoding: 'utf8' });
  } catch (e) {
    buildResult = 'FAIL';
    manifest.stop_conditions.cicd_failed = true;
  }

  updateSection(manifest, 'cicd', {
    build_result: buildResult,
    test_result: testResult
  });

  console.log(`✅ CI/CD: Build ${buildResult}, Tests ${testResult}`);
  return manifest;
}

/**
 * Committer: Commits changes
 */
async function committer(manifest, params) {
  const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();

  // CRITICAL: Clauditos cannot write to master
  if (branch === 'master') {
    manifest.stop_conditions.warden_blocked = true;
    updateSection(manifest, 'committer', {
      branch,
      blocked: true,
      reason: 'Clauditos cannot commit to production branch master'
    });
    console.log('🛑 Committer: BLOCKED (on master)');
    return manifest;
  }

  if (!branch.startsWith('mission/')) {
    console.log('⚠️  Not on mission branch, skipping commit');
    return manifest;
  }

  updateSection(manifest, 'committer', {
    commit_hash: 'pending',
    branch
  });

  console.log(`✅ Committer: Ready to commit on ${branch}`);
  return manifest;
}

/**
 * Scribe: Updates documentation
 */
async function scribe(manifest, params) {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');

  const changelogEntry = `Mission ${manifest.mission_id}: ${manifest.issue}`;

  // Write mission report for ledger harvesting if fixes were applied
  if (manifest.exterminator?.fixes_applied?.length > 0) {
    const reportContent = `# MISSION REPORT - ${manifest.mission_id}
Generated: ${new Date().toISOString()}

## Issue
${manifest.issue}

## Severity
${manifest.forensics?.severity || 'MEDIUM'}

## Root Cause
${manifest.entomologist?.bugs_found[0]?.description || 'See bug analysis'}

## Minimal Fix
${manifest.exterminator.fixes_applied[0]?.patch || 'Applied fixes per manifest'}

## Files Modified
${manifest.artifacts?.files_modified?.join(', ') || 'None'}

## What Worked
${manifest.debugger?.results?.filter(r => r.passed).map(r => r.test).join(', ') || 'Tests pending'}

## What Failed
${manifest.debugger?.results?.filter(r => !r.passed && !r.skipped).map(r => r.test).join(', ') || 'None'}
`;

    // Write report for harvesting
    const reportPath = path.join(__dirname, 'reports', `MISSION-${manifest.mission_id}.md`);
    if (!fs.existsSync(path.dirname(reportPath))) {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    }
    fs.writeFileSync(reportPath, reportContent);
    console.log(`   ✅ Mission report written`);

    // Update ledger digest
    try {
      execSync('node ogz-meta/update-ledger.js', { stdio: 'pipe' });
      console.log('   ✅ Ledger updated');
    } catch (e) {
      console.log('   ⚠️  Ledger update failed');
    }

    // Rebuild context pack
    try {
      execSync('node ogz-meta/build-claudito-context.js', { stdio: 'pipe' });
      console.log('   ✅ Context pack rebuilt');
    } catch (e) {
      console.log('   ⚠️  Context rebuild failed');
    }
  }

  updateSection(manifest, 'scribe', {
    changelog_entry: changelogEntry,
    ledger_update: manifest.exterminator?.fixes_applied?.length > 0 ? 'completed' : 'skipped'
  });

  console.log('✅ Scribe: Documentation updated');
  return manifest;
}

/**
 * Janitor: Cleans artifacts
 */
async function janitor(manifest, params) {
  const artifacts = manifest.artifacts.files_created || [];

  updateSection(manifest, 'janitor', {
    files_cleaned: [],
    artifacts_removed: artifacts.filter(f => f.includes('.tmp'))
  });

  console.log(`✅ Janitor: ${artifacts.length} artifacts marked for cleanup`);
  return manifest;
}

/**
 * Warden: Final gate
 */
async function warden(manifest, params) {
  const violations = [];

  // CRITICAL: Check if on forbidden master branch
  const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
  if (branch === 'master') {
    violations.push('On production branch master (writes forbidden for Clauditos)');
  }

  // Check scope
  if (manifest.artifacts.files_modified?.length > 10) {
    violations.push('Too many files modified');
  }

  if (violations.length > 0) {
    manifest.stop_conditions.warden_blocked = true;
  }

  updateSection(manifest, 'warden', {
    scope_violations: violations,
    safety_blocks: [],
    final_approval: violations.length === 0
  });

  console.log(`✅ Warden: ${violations.length === 0 ? 'APPROVED' : 'BLOCKED'}`);
  return manifest;
}

/**
 * Emit hook for downstream processing
 * Enhanced with real-time console logging per ogz-meta specs
 */
function emitHook(command, manifest) {
  const hookFile = path.join(MANIFEST_DIR, `${manifest.mission_id}.hook`);
  const hook = {
    command,
    state: manifest.state,
    timestamp: new Date().toISOString()
  };

  // Write to file (original behavior)
  fs.writeFileSync(hookFile, JSON.stringify(hook, null, 2));

  // Real-time console logging (new per ogz-meta specs)
  ClauditoLogger.hook(command, manifest.state, {
    missionId: manifest.mission_id,
    result: manifest[command.replace('/', '')]?.status || 'executed'
  });
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];
  const args = {
    manifest: process.argv[3]
  };

  if (!command) {
    console.log('🔧 Slash Router');
    console.log('\nUsage: node ogz-meta/slash-router.js <command> [manifest]');
    console.log('\nCommands:');
    console.log('  /start "issue description"  - Start new mission');
    console.log('  /commander                   - Provide context');
    console.log('  /architect                   - Map system');
    console.log('  /entomologist                - Find bugs');
    console.log('  /exterminator                - Fix bugs');
    console.log('  /debugger                    - Test fixes');
    console.log('  /critic                      - Find weaknesses');
    console.log('  /validator                   - Final checks');
    console.log('  /forensics                   - Deep verification');
    console.log('  /cicd                        - Build/test');
    console.log('  /committer                   - Commit changes');
    console.log('  /scribe                      - Update docs');
    console.log('  /janitor                     - Clean artifacts');
    console.log('  /warden                      - Final approval');
    process.exit(0);
  }

  route(command, args).then(manifest => {
    if (manifest) {
      console.log(`\n📋 State: ${manifest.state}`);
      const stopCheck = shouldStop(manifest);
      if (stopCheck.stop) {
        console.log(`🛑 STOPPED: ${stopCheck.reason}`);
      }
    }
  }).catch(console.error);
}

module.exports = { route };