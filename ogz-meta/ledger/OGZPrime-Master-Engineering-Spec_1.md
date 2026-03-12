# OGZPrime Master Engineering Spec
## DTO Validation, Strategy Verification & Pipeline Overhaul
### March 11, 2026

**Authored by:** Claude Opus (Architect) + Mercury 2 (D-LLM Reviewer)
**For:** Trey (Project Owner) + Claude Code (VPS Executor)

---

## EXECUTIVE SUMMARY

Two independent AI architectures (autoregressive + diffusion) analyzed OGZPrime's codebase and converged on the same conclusion: the root cause of every recurring bug is the absence of enforced data contracts between modules. The fix is a Zod-validated DTO at every boundary, deterministic strategy tests, and AST-based code comprehension for the CI pipeline. This document is the single source of truth for implementation.

---

## TABLE OF CONTENTS

1. Critical Bugs Found (March 9-11, 2026)
2. Phase 1: DTO Validation with Zod
3. Phase 2: Deterministic Strategy Verification
4. Phase 3: AST-Based Code Comprehension
5. Phase 4: Pipeline Toggle System
6. Phase 5: Waterfall Regression Framework
7. Execution Batches (Parallel Plan)
8. Mercury 2 Review & Corrections
9. Files to Create
10. Files to Delete
11. Validation Criteria

---

## 1. CRITICAL BUGS FOUND (March 9-11, 2026)

### 1.1 RSI Permanently Broken (c.c vs _c(c))
**File:** `core/indicators/IndicatorEngine.js` line 488
**Bug:** Used `c.c` (direct property access) instead of `_c(c)` (CandleHelper abstraction)
**Impact:** RSI always calculated as 100.00. Every RSI trade ever taken was based on a broken indicator.
**Status:** FIXED via pipeline. Lines 488, 500 corrected. OBV lines 785, 790, 791 still need fixing.

### 1.2 Nested Object Data Path
**Bug:** `IndicatorEngine.getSnapshot()` returns `{ type, indicators: { rsi, ... }, overlays: {} }` but consumers read `indicators.rsi` directly, getting `undefined` because RSI lives at `indicators.indicators.rsi`.
**Impact:** Production TradingLoop falls into catch block warmup fallback with RSI defaulting to 50. Backtest gets undefined.
**Status:** IDENTIFIED. Fix is the DTO validation in Phase 1.

### 1.3 Standalone Backtest Parallel Universe
**Bug:** `tuning/tuning-backtest-full.js` reimplemented the entire trading pipeline with different constructors, indicator paths, fee handling, and position logic.
**Impact:** Every backtest result for the past month was from a parallel universe that didn't match production.
**Status:** Pipeline toggle system (Phase 4) replaces standalone script. Script to be deleted.

### 1.4 Phantom Short Trades on Spot Market
**Bug:** Backtest took SELL (short) positions on a spot market where shorting is impossible.
**Impact:** RSI's 39 "trades" were all phantom shorts. Zero real trades existed.
**Status:** Direction filter (`DIRECTION_FILTER=long_only`) implemented in TradingLoop.

### 1.5 Fee Chaos (6 Files, 4 Different Values)
**Values found:** 0.16%, 0.25%, 0.26%, 0.32%, 0.40%, 0.50%, 0.52%, 0.65%
**Actual Kraken fees (bottom tier):** Maker 0.25%, Taker 0.40%
**Correct round-trip:** 0.65% (maker entry + taker exit)
**Status:** TradingConfig centralized. KrakenAdapterV2 line 329 still had hardcoded 0.0026 — needs pipeline fix.

### 1.6 MADynamicSR Incorrect Trend Filter
**Bug:** Used 200 EMA as binary trend gate instead of 20 EMA slope detection per Trader DNA method.
**Status:** FIXED. Slope detection, extension skip, first-touch skip all implemented.

### 1.7 LiquiditySweep Timeframe Mismatch
**Bug:** Expected 1-minute candles but production feeds 15-minute. Timing 15x wrong.
**Status:** FIXED. Timeframe-agnostic rewrite with auto-detection from timestamps.

### 1.8 Filter Gate Stacking
**Bug:** 10+ independent confidence/volume filters applied sequentially. 383 valid signals reduced to 6 trades.
**Status:** MAExtensionFilter disabled, VP chop filter disabled. Full audit in gate-audit.md.

---

## 2. PHASE 1: DTO VALIDATION WITH ZOD

### 2.1 Install Zod
```bash
npm i zod
```

### 2.2 Create IndicatorSnapshotDTO
**File:** `core/dto/IndicatorSnapshotDTO.js`

Single source of truth for indicator data shape. Validated at runtime. No TypeScript required.

```javascript
'use strict';
const { z } = require('zod');

const IndicatorSnapshotSchema = z.object({
  timestamp: z.number().int(),
  indicators: z.object({
    rsi: z.number().min(0).max(100),
    ema9: z.number(),
    ema20: z.number(),
    ema50: z.number(),
    ema200: z.number(),
    sma20: z.number().optional(),
    sma50: z.number().optional(),
    sma200: z.number().optional(),
    atr: z.number().min(0),
    atrPercent: z.number().min(0),
    bbUpper: z.number(),
    bbMiddle: z.number(),
    bbLower: z.number(),
    bbWidth: z.number(),
    bbPercentB: z.number(),
    macd: z.number(),
    macdSignal: z.number(),
    macdHistogram: z.number(),
    stochRsiK: z.number().optional(),
    stochRsiD: z.number().optional(),
    adx: z.number().optional(),
    plusDI: z.number().optional(),
    minusDI: z.number().optional(),
    volume: z.number().min(0),
    vwap: z.number().optional(),
    obv: z.number().optional(),
    mfi: z.number().optional(),
    superTrend: z.number().optional(),
    superTrendDirection: z.string().optional(),
    price: z.number().positive(),
  }),
  candle: z.object({
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number(),
    timestamp: z.number(),
  }).optional(),
  overlays: z.object({}).passthrough().optional(),
});

function validateSnapshot(raw) {
  return IndicatorSnapshotSchema.parse(raw);
}

function validateSnapshotSafe(raw) {
  const result = IndicatorSnapshotSchema.safeParse(raw);
  if (result.success) return result.data;
  console.error('[DTO] Invalid snapshot:', result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '));
  return null;
}

module.exports = { IndicatorSnapshotSchema, validateSnapshot, validateSnapshotSafe };
```

### 2.3 Refactor IndicatorEngine.getSnapshot()
Build flat DTO, validate before returning. See dto-validation-spec.md for full code.

### 2.4 Update All Consumers
Replace all `indicators.indicators.rsi` with `indicators.rsi`. Use AST scanner (Phase 3) to find every occurrence.

### 2.5 Fix OBV Bug (lines 785, 790, 791)
```bash
node ogz-meta/ast/property-to-function.js core/indicators/IndicatorEngine.js
```

---

## 3. PHASE 2: DETERMINISTIC STRATEGY VERIFICATION

### 3.1 RSI Unit Test (Known Analytical Answer)

**File:** `test/rsi-deterministic.test.js`

Mercury 2 corrected version (uses Jest, proper imports, handles IndicatorEngine API):

```javascript
const IndicatorEngine = require('../core/indicators/IndicatorEngine');
const { validateSnapshot } = require('../core/dto/IndicatorSnapshotDTO');

function makeCandle(close, ts) {
  return { open: close, high: close * 1.001, low: close * 0.999, close, volume: 1000, timestamp: ts };
}

function rsiFromCloses(closes, period = 14) {
  const ie = new IndicatorEngine({ rsiPeriod: period, warmupCandles: 0 });
  for (let i = 0; i < closes.length; i++) {
    ie.update(makeCandle(closes[i], i * 900_000));
  }
  const snapshot = ie.getSnapshot();
  return snapshot.indicators.rsi;
}

test('Wilder textbook example (RSI ~ 51.78)', () => {
  const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
    46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
  expect(rsiFromCloses(closes, 14)).toBeCloseTo(51.78, 0);
});

test('All gains -> RSI ~ 100', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  expect(rsiFromCloses(closes, 14)).toBeGreaterThan(99);
});

test('All losses -> RSI ~ 0', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 - i);
  expect(rsiFromCloses(closes, 14)).toBeLessThan(1);
});

test('Alternating -> RSI ~ 50', () => {
  const closes = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 101 : 99));
  expect(rsiFromCloses(closes, 14)).toBeCloseTo(50, 0);
});

test('Snapshot validates against Zod schema', () => {
  const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
    46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
  const ie = new IndicatorEngine({ rsiPeriod: 14, warmupCandles: 0 });
  for (let i = 0; i < closes.length; i++) ie.update(makeCandle(closes[i], i * 900_000));
  const snapshot = ie.getSnapshot();
  expect(snapshot.indicators.rsi).toBeDefined();
});
```

### 3.2 Strategy Verification Pattern
For each strategy: enable only that strategy via pipeline toggles, run through BacktestRunner (production code path), capture trades, independently recalculate indicator, verify entry condition was true.

---

## 4. PHASE 3: AST-BASED CODE COMPREHENSION

### 4.1 Install recast
```bash
npm i --save-dev recast @babel/parser
```

### 4.2 Property-to-Function Transformer (Mercury 2 corrected version)
**File:** `ogz-meta/ast/property-to-function.js`

Replaces `candle.c` with `_c(candle)` using AST parsing, not regex.

Key correction from Mercury 2: Uses `p.parentPath.node` instead of `p.parent.node` (original would crash).

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const recast = require('recast');
const parser = require('recast/parsers/babel');

const PROPERTY_MAP = { c: '_c', o: '_o', h: '_h', l: '_l', v: '_v', t: '_t' };

function transform(filePath, dryRun = false) {
  const src = fs.readFileSync(path.resolve(filePath), 'utf8');
  const ast = recast.parse(src, { parser });
  const b = recast.types.builders;
  let count = 0;

  recast.visit(ast, {
    visitMemberExpression(p) {
      const node = p.node;
      if (node.property.type === 'Identifier' && PROPERTY_MAP[node.property.name] && !node.computed) {
        const parent = p.parentPath && p.parentPath.node;
        if (parent && parent.type === 'CallExpression' && parent.callee.type === 'Identifier' 
            && parent.callee.name === PROPERTY_MAP[node.property.name]) {
          return false;
        }
        const call = b.callExpression(b.identifier(PROPERTY_MAP[node.property.name]), [node.object]);
        p.replace(call);
        count++;
        return false;
      }
      this.traverse(p);
    },
  });

  if (count && !dryRun) {
    fs.writeFileSync(path.resolve(filePath), recast.print(ast, { quote: 'single' }).code, 'utf8');
    console.log(`✅ ${filePath}: ${count} replacement(s)`);
  } else if (count && dryRun) {
    console.log(`[DRY] ${filePath}: ${count} would be applied`);
  } else {
    console.log(`ℹ️  ${filePath}: no matches`);
  }
  return count;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const files = args.filter(a => !a.startsWith('--'));
if (!files.length) { console.error('Usage: node property-to-function.js [--dry-run] <file.js>'); process.exit(1); }
let total = 0;
files.forEach(f => (total += transform(f, dryRun)));
console.log(`\nTotal replacements: ${total}`);
```

### 4.3 DTO Violation Scanner
**File:** `ogz-meta/ast/scan-dto-violations.js`

AST-based scan for `indicators.indicators` patterns. Authoritative — replaces regex lint.

### 4.4 ESLint Custom Rule
**File:** `eslint-rules/no-nested-indicators.js`

Flags any `indicators.indicators` access at lint time.

### 4.5 DTO Lint Script (regex fallback)
**File:** `scripts/lint-dto.js`

Quick regex scan for known bad patterns: `indicators.indicators`, `c.c`, `c.o`, `c.h`, `c.l`, `c.v`, `rsi || 50`.

---

## 5. PHASE 4: PIPELINE TOGGLE SYSTEM

### 5.1 TradingConfig Pipeline Section (IMPLEMENTED)
```javascript
pipeline: {
  enableRSI: envBool('ENABLE_RSI', true),
  enableMADynamicSR: envBool('ENABLE_MASR', true),
  enableEMACrossover: envBool('ENABLE_EMA', true),
  enableLiquiditySweep: envBool('ENABLE_LIQSWEEP', true),
  enableRiskManager: envBool('ENABLE_RISK', true),
  enableTRAI: envBool('ENABLE_TRAI', false),
  enableDashboard: envBool('ENABLE_DASHBOARD', true),
  enableNotifications: envBool('ENABLE_NOTIFICATIONS', true),
  executionMode: env('EXECUTION_MODE', 'paper'),
  candleSource: env('CANDLE_SOURCE', 'live'),
  candleFile: env('CANDLE_FILE', 'tuning/full-45k.json'),
  directionFilter: env('DIRECTION_FILTER', 'long_only'),
  positionMode: env('POSITION_MODE', 'single'),
},
```

### 5.2 StrategyOrchestrator Toggle (IMPLEMENTED)
Uses filter pattern — registers ALL strategies, then filters at the end based on toggles. Logs which strategies are active/disabled.

### 5.3 Direction Filter (IMPLEMENTED)
Blocks sell signals on spot market. Preserves sell-to-close-position.

### 5.4 Singleton Lock Safety (IMPLEMENTED)
Requires BOTH `CANDLE_SOURCE=file` AND `EXECUTION_MODE=backtest` to skip lock. Prints mode in giant text at startup.

### 5.5 Usage
```bash
# RSI alone on historical data
ENABLE_RSI=true ENABLE_MASR=false ENABLE_EMA=false ENABLE_LIQSWEEP=false \
CANDLE_SOURCE=file EXECUTION_MODE=backtest DIRECTION_FILTER=long_only \
node run-empire-v2.js
```

---

## 6. PHASE 5: WATERFALL REGRESSION FRAMEWORK

### 6.1 Concept
Each layer of the trading pipeline is added one at a time and tested before the next layer goes on:

1. **Baseline strategy** (bare RSI: oversold < 25 = buy) → test → freeze
2. **Add exit logic** (SL/TP/trailing) → test → freeze
3. **Add entry refinements** (confidence scaling, fib boost) → test → freeze
4. **Add regime detection** (trend filter) → test → freeze
5. **Add trading brain** (orchestrator confidence threshold) → test → freeze
6. **Add ML components** (TRAI) → test → freeze
7. **Add pattern system** (pattern memory) → test → freeze

Each step clones the previous config, adds one thing, and verifies nothing broke.

### 6.2 Implementation
**File:** `test/regression/waterfall.js`

See Mercury 2's corrected implementation in Section 8.

---

## 7. EXECUTION BATCHES (PARALLEL PLAN)

### Batch A — Data Contract Backbone (Day 1-3)
**Executor:** Claude Code
- Install Zod
- Create IndicatorSnapshotDTO
- Refactor getSnapshot() to flat + validated
- Replace all `indicators.indicators` patterns
- Remove old IndicatorSnapshot.js (after confirming no imports remain)
- Fix OBV c.c bug

### Batch B — Strategy Bug Fixes (Day 3-5, parallel branches)
**Executor:** Claude Code
- RSI: verify signal flow through orchestrator (DTO should fix this)
- MADynamicSR: already fixed, verify with deterministic test
- EMACrossover: verify with deterministic test
- LiquiditySweep: already fixed, verify with deterministic test
- Clean up redundant filter gates

### Batch C — Backtest Alignment (Day 5-6)
**Executor:** Claude Code
- Delete `tuning/tuning-backtest-full.js`
- Verify BacktestRunner uses new DTO
- Sanity test: trade count matches entry signal count

### Batch D — Regression/Waterfall Harness (Day 6-7)
**Executor:** Claude Code + Opus spec
- Create `test/regression/waterfall.js`
- Generate first baseline JSON
- Add Jest tests for each strategy

### Batch E — CI Pipeline Scaffolding (Day 0-1, parallel with everything)
**Executor:** Opus (spec) + Claude Code (implement)
- Install recast
- Create AST transformer
- Create DTO scanner
- Add npm scripts to package.json
- Create GitHub Actions workflow (optional)

### Batch F — Documentation (anytime)
- `docs/DTO_CONTRACT.md`
- Strategy enable/disable guide
- Pipeline toggle reference

---

## 8. MERCURY 2 REVIEW & CORRECTIONS

### 8.1 Issues Mercury 2 Found in Original Spec

| # | Issue | Fix |
|---|-------|-----|
| 1 | Missing CandleHelper imports in IndicatorEngine snippet | Add `const { _c, _v, _t, _o, _h, _l } = require('../helpers/CandleHelper')` |
| 2 | IndicatorEngine constructor may not accept `{ rsiPeriod, warmupCandles }` | Verify actual constructor signature |
| 3 | `ie.update()` may not exist — could be `processCandle` | Verify method name |
| 4 | AST transformer uses `nodePath.parent.node` — should be `nodePath.parentPath.node` | **CRITICAL BUG** — corrected in Phase 3 code above |
| 5 | Test import paths may be wrong depending on folder depth | Verify relative paths |
| 6 | `timestamp` should use `z.number().int()` not just `z.number()` | Updated in schema |
| 7 | Old `IndicatorSnapshot.js` imports will explode after deletion | Search and replace all imports first |
| 8 | `console.assert` doesn't abort tests | Use Jest `expect()` instead |
| 9 | No npm scripts defined for new tools | Add to package.json |
| 10 | Regex lint script has false positives on comments | AST scanner is authoritative; regex is fallback only |

### 8.2 Mercury 2's Recommended npm Scripts
```json
{
  "scripts": {
    "lint:dto": "node scripts/lint-dto.js",
    "scan:dto": "node ogz-meta/ast/scan-dto-violations.js",
    "fix:props": "node ogz-meta/ast/property-to-function.js",
    "test": "jest --runInBand",
    "test:deterministic": "node test/rsi-deterministic.test.js",
    "baseline": "node tools/generate-baseline.js",
    "regression": "node test/regression/waterfall.js",
    "ci": "npm run lint:dto && npm run scan:dto && npm test && npm run baseline"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "recast": "^0.23.6",
    "zod": "^3.22.4"
  }
}
```

### 8.3 Mercury 2's Architectural Recommendation
Adopt **Hexagonal (Ports-and-Adapters) Architecture** long-term:
- Core domain: pure business logic (indicators, strategies, trade decisions)
- Ports: interfaces for external concerns (candle source, exchange, config, logger)
- Adapters: implementations (Kraken, file loader, env config)
- Application layer: wires ports to adapters

Short-term: Zod DTOs + JSDoc types provide 80% of the benefit without a full rewrite.

### 8.4 Mercury 2's Additional Risk Areas Identified
- No global try/catch or promise-rejection handling in 2K-line main runner
- Race condition on `currentPosition` shared across async streams
- No structured logging (JSON with timestamps, module name, correlation IDs)
- No health-check/watchdog endpoint
- No versioned data store for trades (SQLite/PostgreSQL)
- API keys read from env vars with no secret management

---

## 9. FILES TO CREATE

| File | Phase | Purpose |
|------|-------|---------|
| `core/dto/IndicatorSnapshotDTO.js` | 1 | Zod schema + validateSnapshot |
| `test/rsi-deterministic.test.js` | 2 | Known-answer RSI tests |
| `ogz-meta/ast/property-to-function.js` | 3 | AST transformer (c.c → _c(c)) |
| `ogz-meta/ast/scan-dto-violations.js` | 3 | AST violation scanner |
| `scripts/lint-dto.js` | 3 | Regex fallback lint |
| `eslint-rules/no-nested-indicators.js` | 3 | ESLint custom rule |
| `test/regression/waterfall.js` | 5 | Waterfall regression harness |
| `test/fixtures/rsi-candle-set.json` | 5 | Deterministic candle fixture |
| `docs/DTO_CONTRACT.md` | 6 | Contract documentation |
| `.env.backtest-rsi` | 4 | RSI-only backtest profile |
| `.env.backtest-all` | 4 | All-strategy backtest profile |
| `.env.paper` | 4 | Paper trading profile |
| `.env.production` | 4 | Live trading profile |

---

## 10. FILES TO DELETE

| File | Reason |
|------|--------|
| `tuning/tuning-backtest-full.js` | Parallel universe — replaced by BacktestRunner + toggles |
| `core/IndicatorSnapshot.js` | Replaced by Zod-validated DTO (after all imports updated) |
| Any `backtest-strategies.js` variants | Parallel universe |
| `backtest/OptimizedBacktestEngine.js` | Parallel universe |
| `backtest/backtest-api.js` | Parallel universe |

---

## 11. VALIDATION CRITERIA

This spec is **DONE** when ALL of the following pass:

1. `npm test` — Jest suite passes (RSI deterministic + Zod validation)
2. `npm run scan:dto` — Zero AST violations
3. `npm run lint:dto` — Zero regex violations
4. BacktestRunner produces trades with validated indicator snapshots
5. RSI shows oversold buy signals in the 45K candle dataset (666+ candles with RSI < 25)
6. Trade validator confirms every entry condition was mathematically true
7. Regression baseline saved from production code path (not standalone script)
8. No `indicators.indicators` pattern anywhere in codebase
9. No `c.c` / `c.o` / `c.h` / `c.l` / `c.v` direct access patterns in IndicatorEngine
10. Round-trip fee set to 0.65% everywhere (maker 0.25% + taker 0.40%)
11. All backtests run long-only on spot market (no phantom shorts)
12. Singleton lock requires BOTH `CANDLE_SOURCE=file` AND `EXECUTION_MODE=backtest` to skip

---

*This document was cross-validated by two independent AI architectures. Mercury 2 (diffusion-based reasoning) reviewed and corrected the original spec from Claude Opus (autoregressive reasoning). All code corrections from Mercury 2 are incorporated above.*
