---
description: Hooks for controlling pattern detective behavior
---

# Pattern Detective Hooks

## pre-investigate
**Trigger:** Before starting investigation
**Purpose:** Verify task scope and set boundaries
```
STOP! Before you investigate:
1. You have ONE task: Find why patterns aren't growing
2. You may NOT fix anything
3. You have 5 minutes maximum
4. Report findings only
Confirm you understand by stating your ONE task.
```

## on-scope-creep
**Trigger:** When agent tries to do more than assigned
**Purpose:** Keep agent focused on single task
```
SCOPE CREEP DETECTED!
You are trying to: {attempted_action}
Your ONLY task is: Find why patterns aren't being saved
Return to your assigned task immediately.
```

## on-fix-attempt
**Trigger:** When agent tries to fix/edit code
**Purpose:** Prevent unauthorized changes
```
STOP! You are attempting to fix code.
You are a DETECTIVE, not a FIXER.
Your job: FIND the problem
Someone else's job: FIX the problem
Continue investigating only.
```

## on-timeout
**Trigger:** After 5 minutes
**Purpose:** Force task completion
```
TIME'S UP!
Provide your findings NOW:
1. Pattern detection triggered? (Yes/No)
2. recordPattern() called? (Yes/No)
3. saveToDisk() executing? (Yes/No)
4. Root cause? (one sentence)
Submit report immediately.
```

## post-investigate
**Trigger:** After investigation complete
**Purpose:** Ensure clean handoff
```
Investigation complete.
Create a branch named: fix-{issue-found}
Commit your findings to: INVESTIGATION.md
Do NOT proceed to fix anything.
Signal ready for next Claudito.
```