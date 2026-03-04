═══════════════════════════════════════════════════════════════════════════════
  DEAD CODE REMOVAL — Post Phase 0-3 Wiring Cleanup
  
  For: Claude Code
  From: Claude Desktop (architect)
  Date: 2026-02-27
  
  WHY: These modules were replaced by the Phase 0-3 wiring. Leaving them
  creates a risk that someone (human or AI) wires them back in later.
  Remove them now while we know they're dead.
  
  RULES:
  1. Make each change individually
  2. Run golden test after EACH change
  3. If golden test fails, REVERT that change and STOP
═══════════════════════════════════════════════════════════════════════════════


████████████████████████████████████████████████████████████████████████████████
█ CHANGE 1: Remove MarketRegimeDetector import + instantiation                █
████████████████████████████████████████████████████████████████████████████████

In run-empire-v2.js, find and DELETE this line (should be near line 295):

const MarketRegimeDetector = loader.get('core', 'MarketRegimeDetector');

Then find and DELETE this line (should be near line 478):

    this.regimeDetector = new MarketRegimeDetector();

Then find and DELETE this line (should be near line 588):

    this.tradingBrain.marketRegimeDetector = this.regimeDetector;

Then find this line (should be around line 2450):

             regime: this.regimeDetector?.currentRegime || 'unknown',

REPLACE it with:

             regime: this.marketRegime?.currentRegime || 'unknown',

(this.marketRegime is set at the wiring point and is always current)

GOLDEN TEST: Run backtest. Should be identical to previous run.


████████████████████████████████████████████████████████████████████████████████
█ CHANGE 2: Remove OptimizedIndicators import + brain injection               █
████████████████████████████████████████████████████████████████████████████████

In run-empire-v2.js, find and DELETE this line (should be near line 294):

const OptimizedIndicators = loader.get('core', 'OptimizedIndicators');

Then find and DELETE this line (should be near line 587):

    this.tradingBrain.optimizedIndicators = OptimizedIndicators;

NOTE: Do NOT delete the OptimizedIndicators.js FILE itself. The brain still
has internal references to this.optimizedIndicators, but since we just removed
the injection, those code paths will hit `if (this.optimizedIndicators &&`
checks and skip safely. The brain's getDecision() is already dead code
(replaced by StrategyOrchestrator). We're just cutting the wire that injected
the module into the brain.

Also check for any remaining direct calls to OptimizedIndicators in
run-empire-v2.js. After the wiring, the old reshape lines (1666-1667) should
already be gone. But if any remain, they need to be removed too:

grep "OptimizedIndicators\." run-empire-v2.js

If grep returns ONLY comments (lines starting with //) that's fine. If it
returns actual code, those lines need to be addressed.

GOLDEN TEST: Run backtest. Should be identical.


████████████████████████████████████████████████████████████████████████████████
█ CHANGE 3: Remove old MarketRegimeDetector from constructor chain            █
████████████████████████████████████████████████████████████████████████████████

After changes 1 and 2, verify no references remain:

grep -n "MarketRegimeDetector\|this\.regimeDetector\b" run-empire-v2.js
grep -n "OptimizedIndicators" run-empire-v2.js

EXPECTED: Zero results for MarketRegimeDetector and this.regimeDetector.
For OptimizedIndicators: only comments (line ~3411) should remain.

If ANY code references remain, list them and STOP. Do not remove them
without architect approval.


████████████████████████████████████████████████████████████████████████████████
█ COMMIT                                                                     █
████████████████████████████████████████████████████████████████████████████████

git add run-empire-v2.js
git commit -m "refactor: Remove dead code — MarketRegimeDetector + OptimizedIndicators

REMOVED FROM run-empire-v2.js:
- MarketRegimeDetector import, instantiation, brain injection
  Replaced by: RegimeDetector.detect() wired in commit 84c80f9
- OptimizedIndicators import and brain injection
  Replaced by: IndicatorSnapshot.create() wired in commit 84c80f9
- Stale this.regimeDetector?.currentRegime → this.marketRegime?.currentRegime

NOT REMOVED (still needed):
- OptimizedIndicators.js file (brain has internal refs, skipped via null check)
- OptimizedTradingBrain.js (still used for risk, maxProfit, error handling)
- core/MarketRegimeDetector.js file (can be removed in future cleanup)

Dead code removal prevents future accidental re-wiring."

git push origin HEAD
