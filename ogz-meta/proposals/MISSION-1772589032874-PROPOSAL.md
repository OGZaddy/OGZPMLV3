# PROPOSAL: MISSION-1772589032874
Generated: 2026-03-04T01:50:33.586Z

## ⚠️ ADVISORY MODE - NO CHANGES MADE
This document proposes changes for human review.
**Nothing has been modified. You must approve before execution.**

---

## Issue
Fix dashboard bugs: 1) duplicate signal box 2) trades not showing 3) confidence stuck 4) fibonacci broken 5) EMA unlabeled 6) delete 8181 junk patterns

## RAG Context Retrieved
- [CRITICAL] FIX-2026-02-19-GATE-MAZE-REFACTOR: 99.997% of signals killed by 6 hardcoded gates. Pattern confidence always 0, direction always hold. ...
- [HIGH] FIX-2026-02-23-MADYNAMICSR-TRADER-DNA: MADynamicSR generating 0 trades despite module working - signals not reaching orchestrator...
- [CRITICAL] FIX-2026-02-19-PATTERN-LEARNING-PIPELINE: Pattern memory stuck at 8182 patterns all with wins:0, losses:0, totalPnL:0. Confidence perpetually ...

## Bugs Identified

### Bug 1: DOCUMENTED
- **Location**: VERIFY-FIX-659.md
- **Description**: ```bash
# List all pattern keys
cat /opt/ogzprime/OGZPMLV2/data/pattern-memory.json | jq '.patterns | keys'
# Expected: Array with multiple unique pattern keys like:
# ["0.50,0.15,-1,0.02,0.01,0.50,0.0,0.0,0.0", ...]

# Count unique patterns
cat /opt/ogzprime/OGZPMLV2/data/pattern-memory.json | jq '.patterns | keys | length'
# Expected: 5+ unique patterns
```

### 3. Pattern Statistics

```bash
# Check pattern success rates
cat /opt/ogzprime/OGZPMLV2/data/pattern-memory.json | jq '.patterns[] | {timesSeen, wins, totalPnL}'
# Expected: Mix of patterns with varying stats, not just BASE_PATTERN

# Find best performing pattern
cat /opt/ogzprime/OGZPMLV2/data/pattern-memory.json | jq '.patterns | to_entries | sort_by(.value.totalPnL) | reverse | .[0]'
- **Score**: 320


### Bug 2: DOCUMENTED
- **Location**: FIX-659-INDEX.md
- **Description**: - **CHANGE 659**: Pattern Recording Fix - Features Array Handling
  - Lines marked in code
  - Consistent across all files
  - Easy to track and audit

## Next Steps

1. Read CHANGES-APPLIED.txt for overview
2. Run VERIFY-FIX-659.md testing procedures
3. Check data/pattern-memory.json for growth
4. Monitor bot decision quality improvement
5. Review FIX-659-SUMMARY.md after test passes

## Questions?

- **Why features not signatures?**: Signatures truncate, features preserve all data
- **Why 3 recording points?**: Learn patterns detected, trades completed, risk managed
- **Why backward compatible?**: Old callers still work, new callers work better
- **Why warning logs?**: Help identify code still using old approach
- **Why fix in 4 places?**: Every recording point needed the fix
- **Score**: 315


### Bug 3: DOCUMENTED
- **Location**: FIX-659-SUMMARY.md
- **Description**: # Check pattern file after 30+ trades
cat /opt/ogzprime/OGZPMLV2/data/pattern-memory.json | jq '.count'
# Expected: 10+ patterns (should grow with each trade)

# Check that new patterns are being added
cat /opt/ogzprime/OGZPMLV2/data/pattern-memory.json | jq '.patterns | keys | length'
# Expected: 10+ unique pattern keys
```

### Verification Signs
- ✅ Console logs `✅ Added [X] new patterns` instead of `❌ Pattern recording failed`
- ✅ Pattern count increases with each trade
- ✅ No warnings about signature strings in pattern recording
- ✅ Pattern-memory.json file size grows
- ✅ Patterns field in responses shows valid feature vectors

## Change Tracking

- **CHANGE 659**: Pattern Recording Fix - Features Array Handling
  - Location: run-empire-v2.js (lines 756, 1305), EnhancedPatternRecognition.js (line 848), RiskManager.js (line 1792)
- **Score**: 195


### Bug 4: DISPLAY
- **Location**: WebSocket server
- **Description**: Indicators may not be broadcasted
- **Score**: N/A


## Proposed Fixes

### Proposal 1: DOCUMENTED
- **Location**: VERIFY-FIX-659.md
- **Proposed Change**: Fix for DOCUMENTED at VERIFY-FIX-659.md
- **Status**: PENDING_REVIEW

```
// BEFORE: [Current code at VERIFY-FIX-659.md]
// AFTER:  [Proposed change - see detailed analysis]
```


### Proposal 2: DOCUMENTED
- **Location**: FIX-659-INDEX.md
- **Proposed Change**: Fix for DOCUMENTED at FIX-659-INDEX.md
- **Status**: PENDING_REVIEW

```
// BEFORE: [Current code at FIX-659-INDEX.md]
// AFTER:  [Proposed change - see detailed analysis]
```


### Proposal 3: DOCUMENTED
- **Location**: FIX-659-SUMMARY.md
- **Proposed Change**: Fix for DOCUMENTED at FIX-659-SUMMARY.md
- **Status**: PENDING_REVIEW

```
// BEFORE: [Current code at FIX-659-SUMMARY.md]
// AFTER:  [Proposed change - see detailed analysis]
```


### Proposal 4: DISPLAY
- **Location**: WebSocket server
- **Proposed Change**: Fix for DISPLAY at WebSocket server
- **Status**: PENDING_REVIEW

```
// BEFORE: [Current code at WebSocket server]
// AFTER:  [Proposed change - see detailed analysis]
```


## Impact Analysis
- Files potentially affected: run-empire-v2.js (main), core/indicators/IndicatorEngine.js, brokers/BrokerFactory.js, core/StateManager.js
- Dependencies: Empire V2 Architecture, IBrokerAdapter

## To Approve
Run: `node ogz-meta/approve.js MISSION-1772589032874`

## To Reject
Run: `node ogz-meta/reject.js MISSION-1772589032874`

---
Generated by Claudito Pipeline (Advisory Mode)
