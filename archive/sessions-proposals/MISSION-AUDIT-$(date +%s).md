# MISSION: Full System Audit - Find & Fix Unhooked Code

## Timestamp
- Created: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
- Mission ID: AUDIT-$(date +%s)

## Problem Statement
Production-ready bot has tons of features configured but not actually hooked up:
- Circuit breaker enabled but not used
- TRAI inference configured but not called
- Multiple Manager classes exist but never instantiated
- Features in shadow mode instead of active
- Pattern memory wasn't separating by mode (just fixed)

## Scope
1. Audit all features in config/features.json
2. Check if each feature is actually being used in code
3. Find all Manager/Engine/Layer classes that exist but aren't instantiated
4. Identify all "shadow mode" features that should be active
5. Create fix list for each unhooked component

## Expected Deliverables
1. Complete audit report of unhooked code
2. Prioritized fix list
3. Implementation plan for each fix
4. Test verification for each hookup

## Success Criteria
- Every enabled feature in config actually does something
- No "orphaned" code that was built but never connected
- Clear documentation of what each feature does
- Bot actually uses what it claims to use

## Context Files
- config/features.json (feature flags)
- run-empire-v2.js (main entry point)
- core/*.js (all core modules)
- TierFeatureFlags.js (tier management)

## Pipeline Stages
1. /commander - Gather full context
2. /branch - Create audit mission branch
3. /forensics - Deep scan for unhooked code
4. /architect - Design connection strategy
5. /exterminator - Fix each unhooked component
6. /critic - Review for missed connections
7. /debugger - Verify all features work
8. /validator - Confirm no regressions
9. /cicd - Run full test suite
10. /committer - Commit fixes
11. /scribe - Document all changes
12. /warden - Final safety check

## Notes
- User frustrated that "production ready" bot has disconnected features
- Pattern memory separation just fixed
- Position sizing bug just fixed
- This is first real test of fixed Claudito pipeline

## Authorization
User explicitly requested: "we are absolutely doing a full audit and what a better time to test the claudito pipeline"