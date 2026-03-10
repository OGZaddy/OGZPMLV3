# Pipeline Changes Summary (2026-03-10)

## Overview
Major upgrades to the Claudito pipeline to support structural/full-file replacements and cleaner refactor workflows.

---

## New Features

### 1. FULL_FILE Replacement Support
**Issue prefixes:** `replace:`

The pipeline now supports replacing entire files via the `replace:` command:
```bash
node ogz-meta/pipeline.js "replace: LiquiditySweepDetector.js with ogz-meta/replacement-file.js"
```

**Pattern matching:**
- `replace: X.js with path/to/replacement.js`
- `replace: X.js with Y from path/to/replacement.js`

**Internal type:** `bugType: 'FULL_FILE'`

### 2. Refactor/Replace Pipeline Mode
**Issue prefixes:** `refactor:`, `extract:`, `replace:`

All three prefixes trigger the REFACTOR_PIPELINE which:
- Skips entomologist (no bug hunting)
- Uses /fixer instead of /exterminator
- Stays on current branch (no branch switching)
- No dirty tree check (we're not switching branches)

### 3. Execute Mode Stop Condition Reset
When running `--execute`, the pipeline now resets stop_conditions to prevent stale blocks from previous failed runs:
```javascript
manifest.stop_conditions = {
  critic_failures: 0,
  forensics_critical: false,
  verification_failed: false,
  cicd_failed: false,
  manifest_mismatch: false,
  warden_blocked: false
};
```

---

## Updated Files

### ogz-meta/pipeline.js
- `detectMode()` - Now cleans flags before checking prefix, supports `replace:`
- Execute mode - Resets stop_conditions, sets pipeline_type from detected mode
- No dirty tree check in REFACTOR mode

### ogz-meta/slash-router.js

#### parseIssueForCodeRefs()
New pattern for FULL_FILE:
```javascript
/replace[:\s]+(\w+\.js)\s+with\s+(?:.*?from\s+)?([^\s]+\.js)/i
```

#### scanCodeForBug()
New FULL_FILE handling:
```javascript
if (scan.type === 'full_file' || scan.bugType === 'FULL_FILE') {
  return {
    bugType: 'FULL_FILE',
    replacementFile: scan.replacementFile,
    ...
  };
}
```

#### loadReplacementBlocks()
New step 4: Check each bug for replacementFile path:
```javascript
for (const bug of bugs) {
  if (bug.replacementFile) {
    // Try ogz-meta/, project root, and absolute paths
    ...
  }
}
```

#### branch()
REFACTOR mode no longer checks for dirty tree:
```javascript
// REFACTOR MODE: Stay on current branch, NO dirty check needed
if (isRefactor) {
  const currentBranch = execSync('git branch --show-current', ...).trim();
  console.log(`✅ Branch: Staying on ${currentBranch} (refactor mode)`);
  ...
  return manifest;
}
```

#### fixer()
Now supports EXECUTE mode for FULL_FILE:
```javascript
if (isExecuteMode) {
  const refs = parseIssueForCodeRefs(manifest.issue);
  const fullFileRef = refs.find(r => r.bugType === 'FULL_FILE');

  if (fullFileRef && fullFileRef.replacementFile) {
    // Find replacement file, backup original, copy new, run smoke test
    ...
  }
}
```

#### exterminator()
New FULL_FILE handling before STRUCTURAL:
```javascript
if (bug.bugType === 'FULL_FILE') {
  // Copy replacement file directly to target
  fs.copyFileSync(targetPath, backupPath);
  fs.writeFileSync(targetPath, replacement, 'utf8');
  ...
}
```

---

## Usage Examples

### Full File Replacement (via Pipeline)
```bash
# 1. Advisory mode - generates proposal
node ogz-meta/pipeline.js "replace: LiquiditySweepDetector.js with ogz-meta/new-version.js"

# 2. Approve
node ogz-meta/approve.js current

# 3. Execute
node ogz-meta/pipeline.js --execute "replace: LiquiditySweepDetector.js with ogz-meta/new-version.js"
```

### Structural Fix (Function-level)
```bash
# 1. Advisory mode
node ogz-meta/pipeline.js "fix: LiquiditySweepDetector.js feedCandle() bug"

# 2. Create replacement block
# Put function code in: ogz-meta/replacements/MISSION-<id>.js

# 3. Approve and execute
node ogz-meta/approve.js current
node ogz-meta/pipeline.js --execute "fix: LiquiditySweepDetector.js feedCandle() bug"
```

### Bug Fix (Line-level)
```bash
# Standard bug fix flow - uses BUGFIX_PIPELINE
node ogz-meta/pipeline.js "fix: hardcoded 0.0026 in StateManager.js line 312"
```

---

## Pipeline Types

| Prefix | Pipeline | Dirty Check | Branch | Uses |
|--------|----------|-------------|--------|------|
| `fix:` or none | BUGFIX | Yes | Creates mission branch | /exterminator |
| `refactor:` | REFACTOR | No | Stays on current | /fixer |
| `extract:` | REFACTOR | No | Stays on current | /fixer |
| `replace:` | REFACTOR | No | Stays on current | /fixer |

---

## Bug Types

| Type | Description | Requires |
|------|-------------|----------|
| LINE | Single line fix | fix_hint |
| STRUCTURAL | Function rewrite | replacement_block |
| SEMANTIC | Full file analysis | replacement_block |
| FULL_FILE | Complete file replace | replacementFile path |
| HARDCODED_VALUE | Magic number fix | pattern + fixHint |

---

## Flags

| Flag | Effect |
|------|--------|
| `--execute` | Run in execute mode (requires prior approval) |
| `--stay` | Stay on current branch for bugfix mode |
| `--refactor` | Alias for `--stay` |

---

## File Locations

- **Replacement files:** `ogz-meta/replacements/MISSION-<id>.js`
- **Proposals:** `ogz-meta/proposals/MISSION-<id>-PROPOSAL.md`
- **Manifests:** `ogz-meta/manifests/MISSION-<id>.json`
- **Current manifest:** `ogz-meta/manifests/current.json`

---

Generated by Claude Code session 2026-03-10
