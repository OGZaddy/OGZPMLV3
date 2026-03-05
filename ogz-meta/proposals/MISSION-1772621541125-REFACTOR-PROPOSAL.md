# REFACTOR PROPOSAL: MISSION-1772621541125
Generated: 2026-03-04T10:52:44.296Z

## ⚠️ ADVISORY MODE - NO CHANGES MADE
This document proposes refactoring changes for human review.
**Nothing has been modified. You must approve before execution.**

---

## Task
refactor: Phase 1 REWRITE-SPEC - Fix fee values in TradingConfig.js to actual Kraken rates, add strategies section, make ExitContractManager read from TradingConfig

## Architect Plan
No plan generated

### Files to Create
None specified

### Files to Modify
None specified

### Extraction Details
See architect analysis

## RAG Context
- [HIGH] TUNE-2026-03-04-EXIT-THRESHOLDS: Default exit thresholds (SL=1.5%, TP=2.0%, Tiers 0.5%/0.8%/1.2%) causing bleeds ...
- [MEDIUM] FIX-2026-02-05-DEEPSEARCH-005-BREAKEVEN-BUFFER: Breakeven stop triggered guaranteed losses - fee buffer 0.1% vs actual 0.32% rou...
- [CRITICAL] BUG-2026-03-04-ORCHESTRATOR-ZERO-CONFIDENCE: Production bot backtest shows confidence=0 on ALL signals, brainDirection=hold, ...

---

## Approval
To approve and execute:
1. Review the plan above
2. Set `manifest.approval.status = 'APPROVED'` in the manifest
3. Re-run the pipeline

Or manually apply the changes following the architect plan.
