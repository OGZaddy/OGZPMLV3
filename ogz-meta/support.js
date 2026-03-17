#!/usr/bin/env node

/**
 * support.js
 * The "Summonable Tech Support Department"
 * One entry point for the entire fix chain
 */

const fs = require('fs');
const path = require('path');
const { ragQuery, formatForContext } = require('./rag-query');
const { updateLedger } = require('./update-ledger');

/**
 * Triage the issue
 */
function triage(issue, ragResults) {
  const analysis = {
    issue: issue,
    timestamp: new Date().toISOString(),
    severity: 'UNKNOWN',
    category: 'UNKNOWN',
    subsystem: [],
    containment: [],
    similar_fixes: []
  };

  // Analyze severity
  if (issue.match(/crash|blown|loss|phantom|corrupt|wipe/i)) {
    analysis.severity = 'CRITICAL';
  } else if (issue.match(/block|stuck|fail|error|broken/i)) {
    analysis.severity = 'HIGH';
  } else if (issue.match(/slow|delay|warn/i)) {
    analysis.severity = 'MEDIUM';
  } else {
    analysis.severity = 'LOW';
  }

  // Categorize
  if (issue.match(/pattern|memory|record/i)) {
    analysis.category = 'PATTERN_MEMORY';
    analysis.subsystem.push('EnhancedPatternRecognition', 'PatternMemoryBank');
  }
  if (issue.match(/state|sync|position|balance/i)) {
    analysis.category = 'STATE_MANAGEMENT';
    analysis.subsystem.push('StateManager', 'ExecutionLayer');
  }
  if (issue.match(/trai|ai|decision/i)) {
    analysis.category = 'AI_DECISION';
    analysis.subsystem.push('TRAIDecisionModule', 'OptimizedTradingBrain');
  }
  if (issue.match(/websocket|disconnect|feed/i)) {
    analysis.category = 'CONNECTIVITY';
    analysis.subsystem.push('WebsocketManager', 'KrakenAdapter');
  }
  if (issue.match(/trade|order|buy|sell/i)) {
    analysis.category = 'TRADING';
    analysis.subsystem.push('ExecutionLayer', 'MaxProfitManager');
  }

  // Containment recommendations
  if (analysis.severity === 'CRITICAL') {
    analysis.containment.push('STOP TRADING IMMEDIATELY');
    analysis.containment.push('Switch to PAPER_TRADING mode');
  }
  if (analysis.category === 'STATE_MANAGEMENT') {
    analysis.containment.push('Save state snapshot before changes');
    analysis.containment.push('pm2 stop ogz-prime-v2');
  }
  if (analysis.category === 'PATTERN_MEMORY') {
    analysis.containment.push('Backup data/pattern-memory.json');
  }

  // Find similar past fixes
  if (ragResults.ledger.length > 0) {
    analysis.similar_fixes = ragResults.ledger.map(e => ({
      id: e.id,
      fix: e.minimal_fix,
      worked: e.what_worked[0]
    }));
  }

  return analysis;
}

/**
 * Generate the forced eval table
 */
function forcedEval(issue, triage, ragResults) {
  const evalResult = {
    'RAG_RETRIEVAL': 'YES - Must retrieve architecture and past fixes',
    'FORENSICS': 'UNKNOWN',
    'FIXER': 'NO',
    'DEBUGGER': 'NO',
    'TESTS': 'NO',
    'DEPLOYMENT': 'NO'
  };

  // Determine what's needed based on triage
  if (triage.severity === 'CRITICAL' || triage.severity === 'HIGH') {
    evalResult.FORENSICS = 'YES - Root cause analysis required';
  }

  if (ragResults.ledger.length === 0) {
    evalResult.FORENSICS = 'YES - No prior fixes found, need investigation';
  } else if (ragResults.ledger[0]._score > 100) {
    evalResult.FORENSICS = 'MAYBE - Similar issue found, may reuse fix';
  }

  return evalResult;
}

/**
 * Generate mission plan
 */
function generateMissionPlan(issue, triage, evalResult, context) {
  const plan = `
# SUPPORT MISSION PLAN
Generated: ${new Date().toISOString()}

## ISSUE
${issue}

## TRIAGE RESULTS
- **Severity**: ${triage.severity}
- **Category**: ${triage.category}
- **Subsystems**: ${triage.subsystem.join(', ')}
- **Containment**: ${triage.containment.join('; ')}

## FORCED EVAL (COMMITMENT)
\`\`\`
${Object.entries(evalResult).map(([k,v]) => `${k}: ${v}`).join('\n')}
\`\`\`

## SIMILAR PAST FIXES
${triage.similar_fixes.length > 0 ?
  triage.similar_fixes.map(f => `- ${f.id}: ${f.fix}`).join('\n') :
  'None found - new issue class'}

## RETRIEVED CONTEXT
${context}

## ⚠️ USER VERIFICATION REQUIRED
**NO CHANGES WILL BE MADE AUTOMATICALLY**

This is a diagnostic report only. Review the analysis and suggested fixes below.
All changes require explicit user approval before implementation.

## SUGGESTED APPROACH
1. ${eval.FORENSICS.startsWith('YES') ? '**FORENSICS NEEDED**: Investigate root cause' : 'Known issue - see similar fixes below'}
2. **REVIEW**: User reviews suggested fixes from past issues
3. **APPROVE**: User selects which approach to take
4. **IMPLEMENT**: User or approved agent implements fix
5. **TEST**: Run smoke tests on affected subsystems
6. **DOCUMENT**: Update CHANGELOG and Fix Ledger

## RISK MAP TEMPLATE (FOR REFERENCE)
\`\`\`javascript
{
  file: "path/to/file.js",
  line: 123,
  root_cause: "...",
  minimal_fix: "...",
  required_tests: ["smoke test X", "verify Y"],
  telemetry: ["monitor metric Z"]
}
\`\`\`

## RULES
- NO action without context
- NO fixes without forensics Risk Map
- NO commits without tests
- EVERY fix updates the ledger

---
To proceed, run the mission chain with this plan as context.
`;

  return plan;
}

/**
 * Main support entry point
 */
async function support(issue) {
  console.log('\n🚨 TECH SUPPORT DEPARTMENT ACTIVATED');
  console.log('=' .repeat(50));

  // Step 1: RAG retrieval (mandatory)
  console.log('\n📚 Step 1: Context Retrieval...');
  const ragResults = ragQuery(issue);
  const context = formatForContext(ragResults);

  // Step 2: Triage
  console.log('\n🏥 Step 2: Triage...');
  const triageResults = triage(issue, ragResults);

  console.log(`  Severity: ${triageResults.severity}`);
  console.log(`  Category: ${triageResults.category}`);
  console.log(`  Subsystems: ${triageResults.subsystem.join(', ')}`);

  // Step 3: Forced Eval
  console.log('\n⚖️ Step 3: Forced Evaluation...');
  const evalResults = forcedEval(issue, triageResults, ragResults);

  Object.entries(evalResults).forEach(([step, decision]) => {
    console.log(`  ${step}: ${decision}`);
  });

  // Step 4: Generate mission plan
  console.log('\n📋 Step 4: Generating Mission Plan...');
  const missionPlan = generateMissionPlan(issue, triageResults, evalResults, context);

  // Save outputs
  const outputDir = path.join(__dirname, 'support-missions');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const missionId = `MISSION-${Date.now()}`;
  const missionFile = path.join(outputDir, `${missionId}.md`);
  fs.writeFileSync(missionFile, missionPlan);

  console.log(`\n✅ Mission plan saved: ${missionFile}`);
  console.log('\n' + '='.repeat(50));
  console.log(missionPlan);

  // Update ledger with any new reports
  if (evalResults.FORENSICS.startsWith('YES')) {
    console.log('\n📝 Note: After forensics completes, run:');
    console.log('  node ogz-meta/update-ledger.js');
    console.log('  node ogz-meta/build-claudito-context.js');
  }

  return {
    missionId,
    triage: triageResults,
    eval: evalResults,
    plan: missionPlan,
    ragResults
  };
}

// CLI interface
if (require.main === module) {
  const issue = process.argv.slice(2).join(' ');

  if (!issue) {
    console.log('🚨 OGZ Tech Support Department');
    console.log('\nUsage: node ogz-meta/support.js "<issue description>"');
    console.log('\nExamples:');
    console.log('  node ogz-meta/support.js "bot machine-gunning trades"');
    console.log('  node ogz-meta/support.js "pattern memory not saving after restart"');
    console.log('  node ogz-meta/support.js "phantom trades showing wrong balance"');
    console.log('\nThe department will:');
    console.log('  1. Retrieve relevant context (RAG)');
    console.log('  2. Triage the issue');
    console.log('  3. Generate mission plan');
    console.log('  4. Save plan for execution');
    process.exit(1);
  }

  support(issue).catch(console.error);
}

module.exports = { support };