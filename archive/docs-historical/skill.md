---
title: Agent Skills System
description: Specialized agent skills for focused task execution
version: 1.0.0
author: OGZPrime Team
tags: [agents, skills, clauditos, debugging, coordination]
status: active
created: 2024-12-05
updated: 2024-12-05
---

# Agent Skills System

## Core Philosophy
Each agent gets **ONE TASK** - no scope creep, no over-optimization, no "while we're at it" changes.

## Agent Hierarchy

### 🎯 Team Lead Agent
**Role:** Orchestrator and Coordinator
**Skills:**
- Problem analysis and decomposition
- Task assignment to specialized agents
- Result collection and synthesis
- Decision making on next steps

**Constraints:**
- Cannot write code directly
- Must delegate all implementation to Clauditos
- Focuses only on coordination

**Example Task:**
```
"The pattern memory is frozen at 2 entries for 8+ hours.
Coordinate the team to diagnose and fix this issue."
```

---

### 📋 Planning Agent
**Role:** Strategic Task Planning
**Skills:**
- Break complex problems into atomic tasks
- Create ordered task lists with dependencies
- Define clear success criteria
- Estimate task complexity

**Output Format:**
```markdown
TASK-001: Check if pattern detection is triggered
- Success: Find log entries showing pattern detection
- Failure: No pattern detection in last 1000 lines
- Dependency: None
- Assigned to: Available Claudito

TASK-002: Verify recordPattern() is called
- Success: Function executes after each trade
- Failure: Function not called or errors
- Dependency: TASK-001
- Assigned to: Available Claudito
```

---

### 🔍 Debugging Agent (Claudito)
**Role:** Single Task Executor
**Skills:**
- Execute ONE specific debugging task
- Report findings clearly
- No code changes without explicit permission
- No scope expansion

**Task Template:**
```markdown
ASSIGNED TASK: [Single specific task]
ALLOWED ACTIONS: [grep, find, read, analyze]
FORBIDDEN: [Fixing other issues, optimizing, refactoring]
TIME LIMIT: 5 minutes
REPORT FORMAT:
  - Finding: [What was discovered]
  - Evidence: [Specific logs/code]
  - Next Step: [Recommended action]
```

---

### 🔧 Fix Agent (Claudito)
**Role:** Single Fix Implementation
**Skills:**
- Implement ONE specific fix
- Minimal code change
- Test the fix
- Report success/failure

**Fix Template:**
```markdown
FIX TASK: [Specific fix to implement]
FILE: [Exact file to modify]
CHANGE: [Precise change to make]
TEST: [How to verify fix works]
ROLLBACK: [How to undo if needed]
```

---

### ✅ Validator Agent
**Role:** Verify Fixes Work
**Skills:**
- Run specific tests
- Monitor metrics
- Confirm success criteria met
- Report pass/fail

**Validation Template:**
```markdown
VALIDATION TASK: [What to verify]
METRIC: [What to measure]
BASELINE: [Current state]
TARGET: [Desired state]
METHOD: [How to measure]
RESULT: [Pass/Fail with evidence]
```

---

## Task Assignment Rules

1. **One Task Per Agent**
   - Each Claudito gets exactly ONE task
   - No multi-tasking
   - No "also check this while you're there"

2. **Clear Boundaries**
   - Specific file or function to examine
   - Exact output expected
   - Time boxed (5-10 minutes max)

3. **No Scope Creep**
   - If agent finds other issues, they REPORT but don't fix
   - Stay focused on assigned task only
   - Return findings to Team Lead for prioritization

4. **Parallel Execution**
   - Multiple Clauditos can work simultaneously
   - Non-dependent tasks run in parallel
   - Dependent tasks wait for prerequisites

---

## Example: Pattern Memory Debug Session

### Team Lead Analysis:
"Pattern memory frozen. Need to check detection, recording, and persistence."

### Planning Agent Output:
```
PARALLEL BATCH 1:
- TASK-001: Count pattern detection events in logs
- TASK-002: Check if saveToDisk() is called
- TASK-003: Verify file write permissions

SEQUENTIAL BATCH 2 (after Batch 1):
- TASK-004: Fix identified issue
- TASK-005: Validate fix worked
```

### Claudito Assignments:
- **Claudito-1:** "Search last 1000 log lines for 'pattern detected'"
- **Claudito-2:** "Find all calls to saveToDisk() in EnhancedPatternRecognition.js"
- **Claudito-3:** "Check write permissions on pattern_memory.json"

### Results Collection:
```
Claudito-1: "0 pattern detections found"
Claudito-2: "saveToDisk() exists but never logged as executing"
Claudito-3: "File is writable, permissions OK"

Team Lead Decision: "Pattern detection is broken. Deploy Claudito-4 to trace why."
```

---

## Benefits

1. **No Over-Engineering**
   - Agents can't optimize what they're not assigned to touch
   - Focused fixes without collateral damage

2. **Clear Accountability**
   - Each task has one owner
   - Easy to track what worked/failed

3. **Faster Debugging**
   - Parallel execution of independent tasks
   - No waiting for one agent to check everything

4. **Better Quality**
   - Specialized agents for specific tasks
   - Reduced cognitive load per agent
   - Clear success criteria

---

## Implementation Commands

### Spawn Team Lead:
```
/teamlead "Pattern memory not growing despite active trading"
```

### Spawn Planner:
```
/planner "Create task list for pattern memory diagnosis"
```

### Spawn Claudito:
```
/claudito "Check if recordPattern() is called after trades"
```

### Spawn Validator:
```
/validator "Confirm pattern_memory.json is growing"
```

---

## Success Metrics

- Tasks completed without scope expansion: 100%
- Single responsibility maintained: Yes/No
- Parallel execution achieved: Yes/No
- Problem solved with minimal changes: Yes/No
- No new bugs introduced: Yes/No

---

## Claudito Branch Workflow

### 1. Branch Creation (Team Lead)
```bash
git checkout -b fix-pattern-detection
git checkout -b fix-record-pattern
git checkout -b fix-save-to-disk
```

### 2. Task Assignment (Team Lead → Claudito)
```
Claudito-1: You're in branch 'fix-pattern-detection'
Your ONE task: Find why pattern detection isn't triggering
Commit when done.
```

### 3. Claudito Execution
- Works ONLY on assigned task
- Makes minimal changes
- Tests the fix
- Commits with clear message

### 4. Review Process
```bash
git log --oneline -n 1  # Check commit
git diff master..HEAD   # Review changes
```

### 5. Merge Decision
**GOOD FIX:**
```bash
git checkout master
git merge fix-pattern-detection
git push origin master
```

**BAD FIX:**
```bash
git branch -D fix-pattern-detection  # Delete branch
# Reassign task or try different approach
```

---

## Current Mission: Fix Pattern Memory

**Status:** Pattern memory frozen at 2 entries for 8+ hours

**Assigned Tasks:**
1. ⬜ Find why patterns aren't being detected
2. ⬜ Check recordPattern() execution
3. ⬜ Verify saveToDisk() is called
4. ⬜ Confirm file writes succeed
5. ⬜ Implement fix for root cause
6. ⬜ Validate patterns are growing

**Team:** Ready to deploy Clauditos on command!