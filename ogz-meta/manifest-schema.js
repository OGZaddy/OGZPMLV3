#!/usr/bin/env node

/**
 * manifest-schema.js
 * Mission Manifest Schema - Single source of truth
 *
 * RULES:
 * - Every agent reads the manifest
 * - Every agent writes ONLY its section
 * - Manifest is immutable between stages
 * - Any mismatch = STOP
 */

/**
 * Create empty manifest
 */
function createManifest(missionId) {
  return {
    mission_id: missionId || `MISSION-${Date.now()}`,
    created: new Date().toISOString(),
    state: 'INIT',
    issue: '',

    // ADVISORY MODE: Clauditos analyze and propose, never execute
    // All changes require human approval
    mode: 'ADVISORY',  // ADVISORY (default) or EXECUTE (requires explicit flag)

    // Each agent owns exactly ONE section
    commander: {
      timestamp: null,
      context: null,
      agent_selection: null
    },

    branch: {
      timestamp: null,
      base: null,
      branch: null,
      blocked: false,
      reason: null
    },

    architect: {
      timestamp: null,
      system_map: [],
      dependencies: []
    },

    entomologist: {
      timestamp: null,
      bugs_found: [],
      classifications: []
    },

    exterminator: {
      timestamp: null,
      fixes_applied: [],    // Only populated in EXECUTE mode
      patches: [],
      proposals: []         // ADVISORY mode: proposed changes for human review
    },

    fixer: {
      timestamp: null,
      changes_applied: [],  // For refactor mode
      plan: {},
      proposal_path: null
    },

    debugger: {
      timestamp: null,
      tests_run: [],
      results: []
    },

    critic: {
      timestamp: null,
      weaknesses: [],
      force_rerun: false
    },

    validator: {
      timestamp: null,
      checks_passed: [],
      checks_failed: []
    },

    forensics: {
      timestamp: null,
      silent_bugs: [],
      regression_risks: []
    },

    cicd: {
      timestamp: null,
      build_result: null,
      test_result: null
    },

    committer: {
      timestamp: null,
      commit_hash: null,
      branch: null
    },

    scribe: {
      timestamp: null,
      changelog_entry: null,
      ledger_update: null
    },

    janitor: {
      timestamp: null,
      files_cleaned: [],
      artifacts_removed: []
    },

    warden: {
      timestamp: null,
      scope_violations: [],
      safety_blocks: [],
      final_approval: false
    },

    // Artifacts tracking
    artifacts: {
      files_created: [],
      files_modified: [],
      backups: [],
      reports: [],
      proposals: []         // ADVISORY mode: proposal documents for review
    },

    // Human approval tracking
    approval: {
      status: 'PENDING',    // PENDING, APPROVED, REJECTED
      approved_by: null,
      approved_at: null,
      notes: null
    },

    // Stop conditions
    stop_conditions: {
      critic_failures: 0,
      forensics_critical: false,
      verification_failed: false,
      cicd_failed: false,
      manifest_mismatch: false,
      warden_blocked: false
    }
  };
}

/**
 * Load manifest from file
 */
function loadManifest(path) {
  const fs = require('fs');
  if (!fs.existsSync(path)) {
    throw new Error(`Manifest not found: ${path}`);
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

/**
 * Save manifest to file
 */
function saveManifest(manifest, path) {
  const fs = require('fs');
  fs.writeFileSync(path, JSON.stringify(manifest, null, 2));
}

/**
 * Update manifest section (agent-specific)
 */
function updateSection(manifest, agent, data) {
  if (!manifest[agent]) {
    throw new Error(`Invalid agent: ${agent}`);
  }

  manifest[agent] = {
    ...manifest[agent],
    ...data,
    timestamp: new Date().toISOString()
  };

  // Update state
  const stateFlow = {
    'commander': 'BRANCH',
    'branch': 'ARCHITECT',
    'architect': 'ENTOMOLOGY',
    'entomologist': 'EXTERMINATION',
    'exterminator': 'DEBUG',
    'debugger': 'CRITIC',
    'critic': 'VALIDATE',
    'validator': 'FORENSICS',
    'forensics': 'CICD',
    'cicd': 'COMMIT',
    'committer': 'SCRIBE',
    'scribe': 'JANITOR',
    'janitor': 'WARDEN',
    'warden': 'COMPLETE'
  };

  manifest.state = stateFlow[agent] || manifest.state;

  return manifest;
}

/**
 * Check stop conditions
 */
function shouldStop(manifest) {
  const stops = manifest.stop_conditions;

  if (stops.critic_failures >= 2) {
    return { stop: true, reason: 'Critic failed twice' };
  }

  if (stops.forensics_critical) {
    return { stop: true, reason: 'Forensics found critical issue' };
  }

  if (stops.verification_failed) {
    return { stop: true, reason: 'Verification tests failed' };
  }

  if (stops.cicd_failed) {
    return { stop: true, reason: 'CI/CD build failed' };
  }

  if (stops.manifest_mismatch) {
    return { stop: true, reason: 'Manifest integrity violation' };
  }

  if (stops.warden_blocked) {
    return { stop: true, reason: 'Warden blocked execution' };
  }

  return { stop: false };
}

module.exports = {
  createManifest,
  loadManifest,
  saveManifest,
  updateSection,
  shouldStop
};