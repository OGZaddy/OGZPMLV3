# MISSION: Full System Audit - Find & Fix Unhooked Code

## Problem Statement
Production-ready bot has TONS of features configured but not actually hooked up

## Found Issues (Quick Scan)
1. **CIRCUIT_BREAKER** - Enabled in config, NOT in run-empire-v2.js
2. **TRAI_INFERENCE** - Configured but never called
3. **ScalpSignalManager.js** - Exists but never instantiated
4. **AssetConfigManager.js** - File exists, never used
5. **TradingProfileManager.js** - File exists, never used
6. **PATTERN_EXIT_MODEL** - Running in "shadowMode" only
7. **PatternMemoryBank.js** - Existed but wasn't being used
8. **Logs not separated** by paper/live/backtest mode
9. **Dashboard WebSocket** - Not updating real-time

## Required Actions
- Audit every feature flag in config/features.json
- Check every .js file in core/ for usage
- Hook up all enabled features
- Remove or document why unused code exists
- Test each connection

## Command to Execute
node ogz-meta/execute-mission.js MISSION-AUDIT-*.md
