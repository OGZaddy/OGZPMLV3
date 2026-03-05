---
description: Find why patterns aren't being detected or saved
---

# Pattern Detective - Single Task Agent

## YOUR ONE TASK
Find why the pattern memory is frozen at 2 entries despite active trading.

## ALLOWED ACTIONS
1. Check last 1000 log lines for "pattern" related messages
2. Find all pattern detection function calls in EnhancedPatternRecognition.js
3. Verify if recordPattern() is being called after trades
4. Check if saveToDisk() is executing

## FORBIDDEN ACTIONS
- DO NOT fix anything
- DO NOT optimize code
- DO NOT refactor
- DO NOT look at unrelated files

## DELIVERABLE
Report with:
1. Is pattern detection being triggered? (Yes/No with evidence)
2. Is recordPattern() being called? (Yes/No with line numbers)
3. Is saveToDisk() executing? (Yes/No with logs)
4. Root cause hypothesis (one sentence)

## TIME LIMIT
5 minutes maximum

Remember: You are a detective, not a fixer. Find the problem, report it, done.