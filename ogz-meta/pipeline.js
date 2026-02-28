#!/usr/bin/env node

/**
 * pipeline.js
 * Executes the full Claudito pipeline
 *
 * MODES:
 * - BUG FIX (default): Full pipeline with entomologist/exterminator
 * - REFACTOR: Issue starts with "refactor:" or "extract:" - skips bug hunting
 *
 * BUG FIX ORDER:
 * 1. /commander → 2. /branch → 3. /architect → 4. /entomologist → 5. /exterminator
 * 6. /critic → 7. /exterminator → 8. /debugger → 9. /validator → 10. /forensics
 * 11. /debugger → 12. /cicd → 13. /committer → 14. /scribe → 15. /janitor → 16. /warden
 *
 * REFACTOR ORDER (skips entomologist, branches from current):
 * 1. /commander → 2. /branch --refactor → 3. /architect → 4. /fixer
 * 5. /debugger → 6. /critic → 7. /validator → 8. /forensics
 * 9. /debugger → 10. /committer → 11. /scribe → 12. /janitor → 13. /warden
 */

const { route } = require('./slash-router');
const { shouldStop } = require('./manifest-schema');

// Bug fix pipeline - hunts for bugs, applies fixes
const BUGFIX_PIPELINE = [
  '/commander',
  '/branch',              // Creates mission branch off master
  '/architect',
  '/entomologist',        // Find bugs
  '/exterminator',        // Fix bugs
  '/critic',              // Hardening directives
  '/exterminator',        // Apply hardening
  '/debugger',            // Verification pass 1
  '/validator',
  '/forensics',
  '/debugger',            // Verification pass 2 (conditional)
  '/cicd',
  '/committer',
  '/scribe',
  '/janitor',
  '/warden'
];

// Refactor pipeline - extraction/refactoring tasks, no bug hunting
const REFACTOR_PIPELINE = [
  '/commander',
  '/branch --refactor',   // Stay on current branch (no checkout master)
  '/architect',
  // NO entomologist - we're not hunting bugs
  // NO exterminator - architect + fixer handles extraction
  '/fixer',               // Apply the extraction/refactor
  '/debugger',            // Verification pass 1
  '/critic',              // Review the changes
  '/validator',
  '/forensics',
  '/debugger',            // Verification pass 2 (conditional)
  '/committer',
  '/scribe',
  '/janitor',
  '/warden'
];

// Detect mode from issue prefix
function detectMode(issue) {
  const lower = issue.toLowerCase();
  if (lower.startsWith('refactor:') || lower.startsWith('extract:')) {
    return 'refactor';
  }
  return 'bugfix';
}

// Legacy export for backwards compatibility
const PIPELINE = BUGFIX_PIPELINE;

/**
 * Execute full pipeline
 */
async function execute(issue) {
  const mode = detectMode(issue);
  const pipeline = mode === 'refactor' ? REFACTOR_PIPELINE : BUGFIX_PIPELINE;

  console.log('🚀 CLAUDITO PIPELINE INITIATED');
  console.log('=' .repeat(50));
  console.log(`🔧 Mode: ${mode.toUpperCase()}`);

  // Start mission
  let manifest = await route(`/start ${issue}`, {});
  manifest.mode = mode;  // Store mode in manifest for downstream use
  console.log(`\n📋 Mission: ${manifest.mission_id}`);
  console.log(`📝 Issue: ${issue}`);

  // Execute pipeline
  let debuggerRuns = 0;

  for (let i = 0; i < pipeline.length; i++) {
    const command = pipeline[i];

    // Handle conditional second debugger pass
    if (command === '/debugger') {
      debuggerRuns++;
      if (debuggerRuns === 2) {
        if (!manifest.forensics?.catalyze_verification) {
          console.log('\n⏭️  Skipping verification pass 2 (forensics did not trigger)');
          continue;
        }
        console.log('\n🔄 Forensics triggered verification pass 2');
        // Pass forensics flag to debugger
        manifest = await route(`${command} --forensics`, { manifest: `ogz-meta/manifests/current.json` });
        console.log(`   State: ${manifest.state}`);
        continue;
      }
    }

    console.log('\n' + '-'.repeat(50));

    // Check stop conditions before each step
    const stopCheck = shouldStop(manifest);
    if (stopCheck.stop) {
      console.log(`\n🛑 PIPELINE STOPPED: ${stopCheck.reason}`);
      console.log(`   At stage: ${command}`);
      break;
    }

    // Execute command
    manifest = await route(command, { manifest: `ogz-meta/manifests/current.json` });

    // Pipeline status
    console.log(`   State: ${manifest.state}`);
  }

  // Final report
  console.log('\n' + '=' .repeat(50));
  console.log('📊 PIPELINE COMPLETE');
  console.log(`   Final state: ${manifest.state}`);

  if (manifest.state === 'COMPLETE') {
    console.log('   ✅ SUCCESS: Pipeline completed');
    if (mode === 'bugfix') {
      console.log(`   Bugs found: ${manifest.entomologist?.bugs_found?.length || 0}`);
      console.log(`   Fixes applied: ${manifest.exterminator?.fixes_applied?.length || 0}`);
    } else {
      console.log(`   Mode: REFACTOR/EXTRACTION`);
      console.log(`   Changes applied: ${manifest.fixer?.changes_applied?.length || 'N/A'}`);
    }
    console.log(`   Tests passed: ${manifest.debugger?.results?.filter(r => r.passed).length || 0}`);
    console.log(`   Warden approved: ${manifest.warden?.final_approval ? 'YES' : 'NO'}`);
  } else {
    const stopCheck = shouldStop(manifest);
    console.log(`   ⚠️  INCOMPLETE: ${stopCheck.reason || 'Unknown'}`);
  }

  return manifest;
}

// CLI interface
if (require.main === module) {
  const issue = process.argv.slice(2).join(' ');

  if (!issue) {
    console.log('🚀 Claudito Pipeline');
    console.log('\nUsage: node ogz-meta/pipeline.js "<issue description>"');
    console.log('\nMODES:');
    console.log('  BUG FIX (default): Any issue without prefix');
    console.log('  REFACTOR: Start with "refactor:" or "extract:"');
    console.log('\nBUG FIX PIPELINE:');
    BUGFIX_PIPELINE.forEach((cmd, i) => {
      console.log(`  ${i + 1}. ${cmd}`);
    });
    console.log('\nREFACTOR PIPELINE (skips bug hunting, stays on current branch):');
    REFACTOR_PIPELINE.forEach((cmd, i) => {
      console.log(`  ${i + 1}. ${cmd}`);
    });
    console.log('\nStop conditions:');
    console.log('  - Critic fails twice');
    console.log('  - Forensics finds critical issue');
    console.log('  - CI/CD fails');
    console.log('  - Warden blocks');
    process.exit(0);
  }

  execute(issue).catch(console.error);
}

module.exports = { execute, PIPELINE, BUGFIX_PIPELINE, REFACTOR_PIPELINE, detectMode };