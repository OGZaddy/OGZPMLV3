# CRITICAL BUG: Pattern Recording System - Features Lost in Translation

## Bug Status: CONFIRMED ✓

Pattern memory is stuck at baseline because the recording pipeline loses features data.

## Root Cause Analysis

### The Call Chain (Where It Breaks)

```
1. run-empire-v2.js:756
   this.patternChecker.recordPatternResult(signature, {...})
   
2. core/EnhancedPatternRecognition.js:849
   recordPatternResult(signature, result) {
     this.memory.recordPattern({ signature }, result)  ← WRONG: passes {signature} object
   }
   
3. core/EnhancedPatternRecognition.js:376
   recordPattern(features, result) {
     if (!features || !Array.isArray(features) || features.length === 0 || !result) {
       return false;  ← FAILS HERE: {signature} is not an Array
     }
   }
```

### Why Features Are Lost

**Line 782** (analyzePatterns):
```javascript
signature: JSON.stringify(features).substring(0, 50)
```

- `signature` is a TRUNCATED string (first 50 chars)
- `features` is a numeric array `[rsi, macd, trend, ...]`
- Signature loses data: `"[0.50,0.15,-1,0.02,0.01,0.5"` (truncated)
- **Cannot convert signature back to features**

## Two Different Code Paths

### Path A: OptimizedTradingBrain (Legacy)
- File: `core/OptimizedTradingBrain.js:170`
- Uses: `./pattern_memory.json` (root)
- Module: `PersistentPatternMap`
- Status: **Decoy/unused**

### Path B: EnhancedPatternRecognition (Active)
- File: `core/EnhancedPatternRecognition.js:185`
- Uses: `data/pattern-memory.json`
- Module: `PatternMemorySystem`
- Status: **Correct, but broken by call chain**

## Evidence

### pattern-memory.json Status
```json
{
  "count": 1,
  "patterns": {
    "BASE_PATTERN": {
      "type": "seed",
      "confidence": 0.5,
      "successRate": 0.5,
      "occurrences": 1,
      "lastSeen": <timestamp>
    }
  }
}
```

**Expected after hours of trading**: 100+ patterns with growing counts  
**Actual**: Only BASE_PATTERN despite many trades

## The Fix

**Option 1: Pass Features Array (RECOMMENDED)**

Run-empire-v2.js line 756:
```javascript
// BEFORE
this.patternChecker.recordPatternResult(signature, {...})

// AFTER
this.patternChecker.recordPatternResult(pattern.features || signature, {...})
```

**Option 2: Store Features in Pattern Object**

EnhancedPatternRecognition.js line 849:
```javascript
// BEFORE
recordPatternResult(signature, result) {
  this.memory.recordPattern({ signature }, result)
}

// AFTER
recordPatternResult(signature, result, features = null) {
  this.memory.recordPattern(features || signature, result)
}
```

**Option 3: Create Signature Mapping**

PatternMemorySystem: Store `signature → features` mapping for lookup

## Verification

Check if pattern.features is available at line 756:
```bash
grep -A5 "let patterns = " /opt/ogzprime/OGZPMLV2/run-empire-v2.js | grep -A3 "analyzePatterns"
```

Result: **YES** - patterns array has `features` field (line 783)

## Files to Check

- `/opt/ogzprime/OGZPMLV2/data/pattern-memory.json` - Should grow
- `/opt/ogzprime/OGZPMLV2/pattern_memory.json` - Legacy (ignore)
- `/opt/ogzprime/OGZPMLV2/run-empire-v2.js:756` - Main recording call
- `/opt/ogzprime/OGZPMLV2/core/EnhancedPatternRecognition.js:849` - Recording wrapper
- `/opt/ogzprime/OGZPMLV2/core/EnhancedPatternRecognition.js:376` - RecordPattern validator

## Implementation Priority

1. **HIGH**: Fix line 756 (run-empire-v2.js)
2. **HIGH**: Verify features field is passed correctly
3. **MEDIUM**: Add logging to confirm pattern recording
4. **LOW**: Clean up legacy pattern_memory.json file
