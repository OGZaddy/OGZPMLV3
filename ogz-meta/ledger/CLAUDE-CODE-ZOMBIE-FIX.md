# CLAUDE CODE: ZOMBIE TRADE FIX — FINAL PIECE
# Date: 2026-02-16
# Status: Fix 2 (save removal) already applied. Fix 1 below is the last piece.

## CONTEXT

The `this.save()` removal in `updateActiveTrade()` and `removeActiveTrade()` is already done (confirmed in repo). 

But the ROOT CAUSE is still active: `run-empire-v2.js` line ~2409-2419 calls `stateManager.updateActiveTrade()` for BUY trades BEFORE calling `stateManager.openPosition()` 30 lines later. This is REDUNDANT because `openPosition()` (StateManager.js lines 300-308) already adds the trade to `activeTrades` internally before doing the atomic `updateState()` save.

The redundant call means:
- Trade gets added to activeTrades Map twice (same orderId, Map.set overwrites, but wasteful)
- Even with save() removed, it's dead code that confuses future debugging
- It was the original trigger for the race condition

Additionally, the desync guard in `canEnterNewPosition()` is firing and blocking 76-91% confidence BUY signals. The guard is correct — there ARE orphaned trades in state.json. After applying this fix, the zombie state needs to be cleared.

## FIX 1: Remove redundant updateActiveTrade call for BUYs

**File:** `run-empire-v2.js`
**Find this block** (around line 2403-2419):

```javascript
        // Store for pattern learning and post-trade analysis
        // CHANGE 2025-12-13: Store in StateManager (single source of truth)
        // BUGFIX 2026-01-23: Only call updateActiveTrade for BUY trades!
        // SELL trades were being added to activeTrades but never cleaned up because
        // closePosition() only removes trades where type === 'BUY'.
        // This caused 96 SELL trades to accumulate, destroying the paper balance.
        if (decision.action === 'BUY') {
          console.log(`🔍 CP4.7: About to call stateManager.updateActiveTrade (BUY only)`);
          try {
            stateManager.updateActiveTrade(unifiedResult.orderId, unifiedResult);
            console.log(`🔍 CP4.8: updateActiveTrade completed successfully`);
          } catch (error) {
            console.error(`❌ CP4.8 ERROR: updateActiveTrade failed:`, error.message);
            console.error(`   Full error:`, error);
          }
        } else {
          console.log(`🔍 CP4.7: SKIPPING updateActiveTrade for ${decision.action} (only BUY trades stored)`);
        }
```

**Replace with:**

```javascript
        // FIX 2026-02-16: REMOVED redundant updateActiveTrade() call for BUY trades.
        // ROOT CAUSE OF ZOMBIE TRADE ACCUMULATION:
        // updateActiveTrade() was writing activeTrades to disk with position=0 BEFORE
        // openPosition() could update position. Next cycle reads position=0, thinks
        // bot is flat, opens another BUY → 41+ phantom trades.
        // openPosition() (StateManager.js:300-308) already adds the trade to activeTrades
        // AND updates position+balance in ONE atomic updateState() call with lock.
        // This separate call was both redundant and the race condition trigger.
        if (decision.action !== 'BUY') {
          console.log(`🔍 CP4.7: SKIPPING activeTrades for ${decision.action} (handled by closePosition)`);
        } else {
          console.log(`🔍 CP4.7: BUY trade — openPosition() will handle activeTrades atomically`);
        }
```

## FIX 2: Add Claude Code's debug line to canEnterNewPosition (APPROVED)

**File:** `core/StateManager.js`
**In `canEnterNewPosition()` method** (around line 631), after the desync detection log:

**Find:**
```javascript
    if (activeCount > 0 && pos === 0) {
      console.error(`🚨 [STATE-DESYNC] activeTrades=${activeCount} but position=${pos} — REFUSING ENTRY`);
      console.error(`   Auto-repairing: clearing orphaned activeTrades`);
```

**Replace with:**
```javascript
    if (activeCount > 0 && pos === 0) {
      console.error(`🚨 [STATE-DESYNC] activeTrades=${activeCount} but position=${pos} — REFUSING ENTRY`);
      console.error(`   activeTrades type=${active instanceof Map ? 'Map' : typeof active} size=${active.size ?? active.length ?? 'unknown'} contents=${JSON.stringify(active instanceof Map ? [...active.entries()].slice(0,2) : (Array.isArray(active) ? active.slice(0,2) : active))}`);
      console.error(`   Auto-repairing: clearing orphaned activeTrades`);
```

## POST-FIX: Clear zombie state on server

```bash
pm2 stop ogz-prime-v2
cd /opt/ogzprime/OGZPMLV2/data
cp state.json state.json.bak.$(date +%s)
jq '.position = 0 | .activeTrades = [] | .inPosition = 0 | .entryPrice = 0 | .positionCount = 0' state.json > state_clean.json
mv state_clean.json state.json
pm2 start ogz-prime-v2
```

## VERIFICATION

After restart, watch logs:
```bash
pm2 logs ogz-prime-v2 --lines 100 | grep -E "CP4.7|CP5|CP6|DESYNC|openPosition|TRADE EXECUTED"
```

Expected behavior:
- CP4.7 says "openPosition() will handle activeTrades atomically"
- CP5 shows position=0 BEFORE buy
- CP6 shows position>0 AFTER buy  
- NO more DESYNC warnings
- ONE trade per signal, not 41
