# REFACTOR PROPOSAL: MISSION-1772621327841
Generated: 2026-03-04T10:48:48.150Z

## ⚠️ ADVISORY MODE - NO CHANGES MADE
This document proposes refactoring changes for human review.
**Nothing has been modified. You must approve before execution.**

---

## Task
refactor: Phase 1 REWRITE-SPEC - Fix fee values in TradingConfig.js to actual Kraken rates (0.25%/0.40%/0.50%), add strategies section with MADynamicSR/EMACrossover/LiquiditySweep/RSI params, make ExitContractManager read from TradingConfig instead of hardcoded contracts

## Architect Plan
No plan generated

### Files to Create
None specified

### Files to Modify
None specified

### Extraction Details
See architect analysis

## RAG Context
- [HIGH] FIX-2026-02-05-DEEPSEARCH-004-BACKTEST-TIME: holdTime calculations used Date.now() instead of candle timestamps - all hold ti...
- [MEDIUM] FIX-2026-02-05-DEEPSEARCH-005-BREAKEVEN-BUFFER: Breakeven stop triggered guaranteed losses - fee buffer 0.1% vs actual 0.32% rou...
- [HIGH] TUNE-2026-03-04-EXIT-THRESHOLDS: Default exit thresholds (SL=1.5%, TP=2.0%, Tiers 0.5%/0.8%/1.2%) causing bleeds ...

---

## Approval
To approve and execute:
1. Review the plan above
2. Set `manifest.approval.status = 'APPROVED'` in the manifest
3. Re-run the pipeline

Or manually apply the changes following the architect plan.
