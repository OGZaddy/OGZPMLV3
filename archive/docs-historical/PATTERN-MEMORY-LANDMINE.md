# CRITICAL: Pattern Memory Path Confusion

## The Landmine
- **ID**: PATTERN_PATH_003
- **Discovered**: 2024-12-07 via Claudito chain investigation
- **Time Wasted**: 6+ months of "why aren't patterns saving?"

## Symptom
- `pattern_memory.json` in repo root appears empty or missing
- Patterns don't seem to be saving
- Bot appears to not be learning

## Reality
- **ACTUAL FILE**: `data/pattern-memory.json`
- **DECOY FILE**: `pattern_memory.json` (root) - OBSOLETE

## Root Cause
```javascript
// core/EnhancedPatternRecognition.js line 185
memoryFile: path.join(process.cwd(), 'data', 'pattern-memory.json')
```

Patterns have ALWAYS been saving to `data/` subdirectory, not root!

## How We Found It
1. Forensics Claudito investigated save logic
2. Fixer applied memory init fix
3. Debugger checked wrong file (root)
4. Forensics found the path configuration
5. Debugger confirmed data/pattern-memory.json exists and works

## The Fix
1. Deleted misleading root `pattern_memory.json`
2. Documented correct path
3. Created smoke test that checks RIGHT file

## Rules Going Forward
- **ALWAYS** check `data/pattern-memory.json` for patterns
- **NEVER** trust root `pattern_memory.json`
- Run `/pattern-test` to verify patterns are saving

## Lessons
- 6 months of confusion from looking at wrong file
- Claudito chain found it in 20 minutes
- Systematic investigation > random poking