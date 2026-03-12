# Mercury 2 Code Reference — Complete Implementation Code
## Every code snippet from Mercury 2's analysis, organized by target file path
## March 11, 2026

**IMPORTANT:** This document contains the CORRECTED versions of all code from Mercury 2's review.
Use these versions, NOT the originals from Opus's spec. Mercury 2 found and fixed bugs in the
original implementations (parentPath vs parent, missing imports, console.assert vs Jest expect).

---

## FILE: core/dto/IndicatorSnapshotDTO.js
**Purpose:** Single source of truth Zod schema for indicator data shape

```javascript
'use strict';
const { z } = require('zod');

/**
 * Canonical flat indicator snapshot.
 * NO nested indicators.indicators — ever.
 * Every field is explicitly declared and validated at runtime.
 */
const IndicatorSnapshotSchema = z.object({
  timestamp: z.number(),
  indicators: z.object({
    // RSI
    rsi: z.number().min(0).max(100),
    // Moving averages
    ema9: z.number(),
    ema20: z.number(),
    ema50: z.number(),
    ema200: z.number(),
    sma20: z.number().optional(),
    sma50: z.number().optional(),
    sma200: z.number().optional(),
    // Volatility
    atr: z.number().min(0),
    atrPercent: z.number().min(0),
    // Bollinger Bands
    bbUpper: z.number(),
    bbMiddle: z.number(),
    bbLower: z.number(),
    bbWidth: z.number(),
    bbPercentB: z.number(),
    // MACD
    macd: z.number(),
    macdSignal: z.number(),
    macdHistogram: z.number(),
    // Stochastic RSI
    stochRsiK: z.number().optional(),
    stochRsiD: z.number().optional(),
    // ADX
    adx: z.number().optional(),
    plusDI: z.number().optional(),
    minusDI: z.number().optional(),
    // Volume
    volume: z.number().min(0),
    vwap: z.number().optional(),
    obv: z.number().optional(),
    mfi: z.number().optional(),
    // Trend
    superTrend: z.number().optional(),
    superTrendDirection: z.string().optional(),
    // Price
    price: z.number().positive(),
  }),
  // Optional metadata
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

/**
 * Validate a snapshot object. Throws ZodError with detailed message if invalid.
 * Call this at EVERY boundary where indicator data is produced or consumed.
 */
function validateSnapshot(raw) {
  return IndicatorSnapshotSchema.parse(raw);
}

/**
 * Safe validation that returns null instead of throwing.
 * Use in non-critical paths (e.g., logging, diagnostics).
 */
function validateSnapshotSafe(raw) {
  const result = IndicatorSnapshotSchema.safeParse(raw);
  if (result.success) return result.data;
  console.error('[DTO] Invalid snapshot:', result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '));
  return null;
}

module.exports = { IndicatorSnapshotSchema, validateSnapshot, validateSnapshotSafe };
```

---

## FILE: core/indicators/IndicatorEngine.js — getSnapshot() refactor
**Purpose:** Return flat validated DTO instead of nested object

```javascript
const { validateSnapshot } = require('../dto/IndicatorSnapshotDTO');

getSnapshot() {
  const s = this.state;
  const lastCandle = s.lastCandle;
  const price = lastCandle ? _c(lastCandle) : 0;
  const snapshot = {
    timestamp: Date.now(),
    indicators: {
      rsi: s.rsi,
      ema9: s.ema?.get(9) || price,
      ema20: s.ema?.get(20) || price,
      ema50: s.ema?.get(50) || price,
      ema200: s.ema?.get(200) || price,
      sma20: s.sma?.get(20) || null,
      sma50: s.sma?.get(50) || null,
      sma200: s.sma?.get(200) || null,
      atr: s.atr || 0,
      atrPercent: price > 0 ? ((s.atr || 0) / price) * 100 : 0,
      bbUpper: s.bb?.upper || price * 1.02,
      bbMiddle: s.bb?.middle || price,
      bbLower: s.bb?.lower || price * 0.98,
      bbWidth: s.bb?.bandwidth || 0,
      bbPercentB: s.bb?.percentB || 0.5,
      macd: s.macd?.macd || 0,
      macdSignal: s.macd?.signal || 0,
      macdHistogram: s.macd?.histogram || 0,
      stochRsiK: s.stochRsi?.k || null,
      stochRsiD: s.stochRsi?.d || null,
      adx: s.adx?.adx || null,
      plusDI: s.adx?.plusDI || null,
      minusDI: s.adx?.minusDI || null,
      volume: lastCandle ? _v(lastCandle) || 0 : 0,
      vwap: s.vwap || null,
      obv: s.obv || null,
      mfi: s.mfi || null,
      superTrend: s.superTrend?.value || null,
      superTrendDirection: s.superTrend?.direction || null,
      price: price,
    },
    candle: lastCandle ? {
      open: _o(lastCandle),
      high: _h(lastCandle),
      low: _l(lastCandle),
      close: _c(lastCandle),
      volume: _v(lastCandle) || 0,
      timestamp: _t(lastCandle) || Date.now(),
    } : undefined,
    overlays: {},
  };

  // Validate before returning — catches ANY malformed data immediately
  return validateSnapshot(snapshot);
}
```

---

## FILE: test/rsi-deterministic.test.js
**Purpose:** RSI tests with known analytical answers (Mercury 2 corrected Jest version)

```javascript
// test/rsi-deterministic.test.js
const IndicatorEngine = require('../core/indicators/IndicatorEngine');
const { validateSnapshot } = require('../core/dto/IndicatorSnapshotDTO');

function makeCandle(close, ts) {
  return {
    open: close,
    high: close * 1.001,
    low: close * 0.999,
    close,
    volume: 1000,
    timestamp: ts,
  };
}

/**
 * Feed a list of close prices to a fresh IndicatorEngine and return the final RSI.
 */
function rsiFromCloses(closes, period = 14) {
  const ie = new IndicatorEngine({ rsiPeriod: period, warmupCandles: 0 });
  for (let i = 0; i < closes.length; i++) {
    ie.update(makeCandle(closes[i], i * 900_000)); // 15-min candles
  }
  const snapshot = ie.getSnapshot(); // validated DTO
  return snapshot.indicators.rsi;
}

test('Wilder textbook example (RSI ~ 51.78)', () => {
  const closes = [
    44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
    46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41,
    46.22, 45.64,
  ];
  const rsi = rsiFromCloses(closes, 14);
  expect(rsi).toBeCloseTo(51.78, 0);
});

test('All-gains -> RSI ~ 100', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  const rsi = rsiFromCloses(closes, 14);
  expect(rsi).toBeGreaterThan(99);
});

test('All-losses -> RSI ~ 0', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 - i);
  const rsi = rsiFromCloses(closes, 14);
  expect(rsi).toBeLessThan(1);
});

test('Alternating gains/losses -> RSI ~ 50', () => {
  const closes = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 101 : 99));
  const rsi = rsiFromCloses(closes, 14);
  expect(rsi).toBeCloseTo(50, 5);
});

test('Snapshot validates against Zod schema', () => {
  const closes = [
    44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
    46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41,
    46.22, 45.64,
  ];
  const ie = new IndicatorEngine({ rsiPeriod: 14, warmupCandles: 0 });
  for (let i = 0; i < closes.length; i++) ie.update(makeCandle(closes[i], i * 900_000));
  const snapshot = ie.getSnapshot(); // will throw if malformed
  // If we got here the DTO is valid
  expect(snapshot.indicators.rsi).toBeDefined();
});
```

---

## FILE: ogz-meta/ast/property-to-function.js
**Purpose:** AST transformer that replaces obj.c -> _c(obj) (Mercury 2 CORRECTED version — fixes parentPath bug)

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const recast = require('recast');
const parser = require('recast/parsers/babel');

const PROPERTY_MAP = {
  c: '_c',
  o: '_o',
  h: '_h',
  l: '_l',
  v: '_v',
  t: '_t',
};

function transform(filePath, dryRun = false) {
  const src = fs.readFileSync(path.resolve(filePath), 'utf8');
  const ast = recast.parse(src, { parser });

  const b = recast.types.builders;
  let count = 0;

  recast.visit(ast, {
    visitMemberExpression(p) {
      const node = p.node;

      // Only simple `obj.c` (no computed) and property name is in the map
      if (
        node.property.type === 'Identifier' &&
        PROPERTY_MAP[node.property.name] &&
        !node.computed
      ) {
        // Avoid double-transforming something that is already a helper call
        const parent = p.parentPath && p.parentPath.node;
        if (
          parent &&
          parent.type === 'CallExpression' &&
          parent.callee.type === 'Identifier' &&
          parent.callee.name === PROPERTY_MAP[node.property.name]
        ) {
          return false; // already transformed
        }

        const helperName = PROPERTY_MAP[node.property.name];
        const call = b.callExpression(b.identifier(helperName), [node.object]);

        // Preserve any comments attached to the original node
        recast.types.namedTypes.Node.check(node) && recast.types.copyComments(node, call, true);

        p.replace(call);
        count++;
        return false; // stop walking this branch
      }
      this.traverse(p);
    },
  });

  if (count && !dryRun) {
    const out = recast.print(ast, { quote: 'single' }).code;
    fs.writeFileSync(path.resolve(filePath), out, 'utf8');
    console.log(`✅ ${filePath}: ${count} replacement(s) applied`);
  } else if (count && dryRun) {
    console.log(`[DRY] ${filePath}: ${count} replacement(s) would be applied`);
  } else {
    console.log(`ℹ️  ${filePath}: no matches`);
  }
  return count;
}

/* CLI ----------------------------------------------------------------- */
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const files = args.filter(a => !a.startsWith('--'));

if (!files.length) {
  console.error('Usage: node property-to-function.js [--dry-run] <file.js> [more.js ...]');
  process.exit(1);
}

let total = 0;
files.forEach(f => (total += transform(f, dryRun)));
console.log(`\nTotal replacements: ${total}`);
```

---

## FILE: ogz-meta/ast/scan-dto-violations.js
**Purpose:** AST-based scanner for indicators.indicators patterns (robust detection)

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const recast = require('recast');
const parser = require('recast/parsers/babel');

function scanFile(filePath) {
  const src = fs.readFileSync(path.resolve(filePath), 'utf8');
  let ast;
  try {
    ast = recast.parse(src, { parser });
  } catch (e) {
    console.warn(`⚠️  Unable to parse ${filePath}: ${e.message}`);
    return [];
  }

  const violations = [];

  recast.visit(ast, {
    visitMemberExpression(p) {
      const node = p.node;
      // Look for `indicators.indicators.xxx`
      if (
        node.object.type === 'MemberExpression' &&
        node.object.property.type === 'Identifier' &&
        node.object.property.name === 'indicators' &&
        node.object.object.type === 'Identifier' &&
        node.object.object.name === 'indicators'
      ) {
        const loc = node.loc?.start || {};
        violations.push({
          file: filePath,
          line: loc.line ?? '?',
          column: loc.column ?? '?',
          code: `indicators.indicators.${node.property.name || '?'}`,
        });
      }
      this.traverse(p);
    },
  });

  return violations;
}

/* ----------------------------------------------------------------- */
const ROOTS = ['core', 'modules', 'tuning'];
let all = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) {
      walk(full);
    } else if (e.isFile() && e.name.endsWith('.js')) {
      all = all.concat(scanFile(full));
    }
  }
}
ROOTS.forEach(d => fs.existsSync(d) && walk(d));

if (all.length) {
  console.error('❌ DTO violations detected:');
  all.forEach(v => console.error(`  ${v.file}:${v.line}:${v.column} → ${v.code}`));
  process.exit(1);
} else {
  console.log('✅ No nested-indicator accesses found (AST scan).');
}
```

---

## FILE: scripts/lint-dto.js
**Purpose:** Quick regex-based DTO violation scanner (fallback for AST scanner)

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const BAD_PATTERNS = [
  /indicators\.indicators\./g,    // nested access
  /\.rsi\s*\|\|\s*50/g,           // fallback to 50 (hides missing RSI)
  /c\.c\b/g,                      // direct property access instead of _c()
  /c\.o\b/g,                      // direct property access instead of _o()
  /c\.h\b/g,                      // direct property access instead of _h()
  /c\.l\b/g,                      // direct property access instead of _l()
  /c\.v\b/g,                      // direct property access instead of _v()
];

const SCAN_DIRS = ['core', 'modules', 'tuning'];
let violations = 0;

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue; // skip comments
    for (const pattern of BAD_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) {
        console.error(`❌ ${filePath}:${i + 1} — ${match[0]}`);
        violations++;
      }
    }
  }
}

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      scanDir(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      scanFile(full);
    }
  }
}

for (const dir of SCAN_DIRS) {
  if (fs.existsSync(dir)) scanDir(dir);
}

if (violations > 0) {
  console.error(`\n❌ ${violations} DTO violations found. Fix before committing.`);
  process.exit(1);
} else {
  console.log('✅ No DTO violations found.');
}
```

---

## FILE: eslint-rules/no-nested-indicators.js
**Purpose:** ESLint custom rule to flag indicators.indicators accesses

```javascript
// eslint-rules/no-nested-indicators.js
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow access to nested `indicators.indicators`",
      category: "Possible Errors",
      recommended: true,
    },
    messages: {
      nested: "Avoid using `indicators.indicators`; flatten the DTO instead.",
    },
    schema: [], // no options
  },

  create(context) {
    return {
      MemberExpression(node) {
        // Detect `obj.indicators.indicators`
        if (
          node.property.type === "Identifier" &&
          node.property.name === "indicators" &&
          node.object.type === "MemberExpression" &&
          node.object.property.type === "Identifier" &&
          node.object.property.name === "indicators"
        ) {
          context.report({ node, messageId: "nested" });
        }
      },
    };
  },
};
```

---

## FILE: scripts/generate-rsi-baseline.js
**Purpose:** Generate baseline expected-results JSON for RSI integration test

```javascript
// scripts/generate-rsi-baseline.js
const fs = require('fs');
const path = require('path');
const { BacktestRunner } = require('../core/BacktestRunner');
const { TradingConfig } = require('../core/TradingConfig');

/* 1. Build the deterministic candle set */
const baseCandles = [
  { open: 10, high: 12, low: 9, close: 10, volume: 100, timestamp: 0 },
  { open: 10, high: 13, low: 11, close: 12, volume: 110, timestamp: 600_000 },
  { open: 12, high: 12.5, low: 10.5, close: 11, volume: 120, timestamp: 1_200_000 },
  { open: 11, high: 14, low: 10.8, close: 13, volume: 130, timestamp: 1_800_000 },
];

const candles = [];
for (let i = 0; i < 5; i++) {
  const offset = i * 2_400_000;
  baseCandles.forEach((c) => {
    candles.push({ ...c, timestamp: c.timestamp + offset });
  });
}

/* 2. Minimal config – only RSI enabled */
const config = new TradingConfig({
  mode: 'paper',
  candleInterval: 15,
  strategies: {
    rsi: { enabled: true, period: 3, overbought: 70, oversold: 30 },
    madynamicsr: { enabled: false },
    emasmacrossover: { enabled: false },
    liquiditysweep: { enabled: false },
  },
});

/* 3. Run and write baseline JSON */
async function main() {
  const runner = new BacktestRunner({ config, candles });
  const results = await runner.run();

  const payload = {
    _meta: { config, candles },
    ...results,
  };

  const outPath = path.resolve('baseline', 'rsi.backtest.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`✅ Baseline written to ${outPath}`);
}

main().catch((e) => {
  console.error('❌ Failed to generate baseline:', e);
  process.exit(1);
});
```

---

## FILE: test/regression/waterfall.js
**Purpose:** Waterfall regression test framework — lock down each pipeline layer before the next

```javascript
// test/regression/waterfall.js
'use strict';
const { BacktestRunner } = require('../../core/BacktestRunner');
const { TradingConfig } = require('../../core/TradingConfig');
const fs = require('fs');
const path = require('path');

/**
 * 1. Load a tiny candle fixture (same 20-candle series used in RSI unit test)
 */
const fixture = require('../fixtures/rsi-candle-set.json'); // [{open,high,low,close,volume,timestamp}, ...]

/**
 * 2. Helper – run a back-test with a given config and return the raw result.
 */
async function run(config) {
  const runner = new BacktestRunner({ config, candles: fixture });
  return await runner.run(); // { trades: [...], stats: {...} }
}

/**
 * 3. Baseline generation (run once, commit the JSON)
 */
async function generateBaseline() {
  const cfg = new TradingConfig({
    mode: 'paper',
    candleInterval: 15,
    strategies: {
      rsi: { enabled: true, period: 14, overbought: 70, oversold: 30 },
      madynamicsr: { enabled: false },
      emasmacrossover: { enabled: false },
      liquiditysweep: { enabled: false },
    },
  });
  const result = await run(cfg);
  const out = path.resolve(__dirname, 'baseline.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`✅ Baseline saved to ${out}`);
}

/**
 * 4. Comparison – fail if any trade violates the RSI entry rule.
 */
async function verifyRSI() {
  const cfg = new TradingConfig({
    mode: 'paper',
    candleInterval: 15,
    strategies: {
      rsi: { enabled: true, period: 14, overbought: 70, oversold: 30 },
      madynamicsr: { enabled: false },
      emasmacrossover: { enabled: false },
      liquiditysweep: { enabled: false },
    },
  });

  const result = await run(cfg);
  const { trades } = result;
  if (!trades.length) throw new Error('No trades were generated – RSI never fired');

  // Re-calculate RSI for each entry candle using the same engine
  const IndicatorEngine = require('../../core/indicators/IndicatorEngine');
  for (const t of trades) {
    const entryIdx = fixture.findIndex(c => c.timestamp === t.entryTimestamp);
    const slice = fixture.slice(entryIdx - cfg.strategies.rsi.period, entryIdx + 1);
    const ie = new IndicatorEngine({ rsiPeriod: cfg.strategies.rsi.period });
    slice.forEach(c => ie.update(c));
    const rsi = ie.getSnapshot().indicators.rsi;
    const condition = t.side === 'BUY' ? rsi <= cfg.strategies.rsi.oversold : rsi >= cfg.strategies.rsi.overbought;
    if (!condition) {
      throw new Error(`Trade ${t.id} entry RSI ${rsi.toFixed(2)} violated the rule`);
    }
  }
  console.log('✅ All RSI trades respect the entry condition');
}

/**
 * 5. Entry point – choose mode via CLI arg
 */
(async () => {
  const mode = process.argv[2];
  if (mode === 'baseline') {
    await generateBaseline();
  } else if (mode === 'verify') {
    await verifyRSI();
  } else {
    console.error('Usage: node waterfall.js <baseline|verify>');
    process.exit(1);
  }
})();
```

---

## FILE: .github/workflows/ci.yml
**Purpose:** Full CI pipeline — lint, scan, AST transform, test, baseline

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      # 1. Checkout & Node setup
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      # 2. Lint – quick regex fallback (optional)
      - name: Run regex DTO lint (optional)
        run: npm run lint:dto

      # 3. Authoritative AST scanner (fails on any nested access)
      - name: Run DTO AST scanner
        run: npm run scan:dto

      # 4. Detect changed .js files and apply property-to-function transformer
      - name: Determine changed JS files
        id: changed
        run: |
          FILES=$(git diff --name-only ${{ github.event.pull_request.base.sha }} ${{ github.event.pull_request.head.sha }} \
            | grep '\.js$' | tr '\n' ' ')
          echo "files=$FILES" >> $GITHUB_OUTPUT

      - name: Apply AST refactor (dry-run first)
        if: steps.changed.outputs.files != ''
        run: |
          # Dry-run – just log what would be changed
          node ogz-meta/ast/property-to-function.js ${{ steps.changed.outputs.files }} --dry-run
          # Real run – modify files
          node ogz-meta/ast/property-to-function.js ${{ steps.changed.outputs.files }}
          # Commit the automatic fixes back to the PR
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add .
          if ! git diff --cached --quiet; then
            git commit -m "chore: auto-refactor property accesses (obj.c -> _c(obj))"
            git push origin HEAD:${{ github.head_ref }}
          fi

      # 5. Test suite (Jest)
      - name: Run Jest test suite
        env:
          ENABLE_RSI: 'true'
          ENABLE_MADSR: 'false'
          ENABLE_EMA: 'false'
          ENABLE_LIQSWEEP: 'false'
          CANDLE_INTERVAL: '15'
          EXECUTION_MODE: 'backtest'
          DIRECTION_FILTER: 'long_only'
        run: npm test

      # 6. Baseline generation (only on main)
      - name: Generate baseline JSON (main only)
        if: github.ref == 'refs/heads/main'
        run: npm run baseline
```

---

## FILE: package.json (scripts + devDependencies to merge)
**Purpose:** npm scripts for all new tools

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

---

## FILE: core/indicators/IndicatorEngine.js — OBV bug fix (lines 785, 790, 791)
**Purpose:** Replace c.c and c.v with _c(c) and _v(c)

```javascript
// BEFORE (lines 785, 790, 791):
this.obvState.prevClose = c.c;
if (c.c > this.obvState.prevClose) this.obvState.obv += (c.v || 0);
else if (c.c < this.obvState.prevClose) this.obvState.obv -= (c.v || 0);
this.obvState.prevClose = c.c;

// AFTER:
this.obvState.prevClose = _c(c);
if (_c(c) > this.obvState.prevClose) this.obvState.obv += (_v(c) || 0);
else if (_c(c) < this.obvState.prevClose) this.obvState.obv -= (_v(c) || 0);
this.obvState.prevClose = _c(c);
```

Or use the AST transformer:
```bash
node ogz-meta/ast/property-to-function.js core/indicators/IndicatorEngine.js
```

---

## MERCURY 2 CORRECTIONS TO ORIGINAL SPEC

| # | Bug Found | Fix Applied |
|---|-----------|-------------|
| 1 | AST transformer used `nodePath.parent.node` — crashes on root | Changed to `p.parentPath && p.parentPath.node` |
| 2 | Tests used `console.assert` — doesn't abort on failure | Replaced with Jest `expect()` |
| 3 | Missing CandleHelper imports in IndicatorEngine snippet | Added note: must import `_c, _v, _t, _o, _h, _l` |
| 4 | IndicatorEngine constructor signature unverified | Test must match actual constructor (`rsiPeriod`, `warmupCandles`) |
| 5 | `ie.update()` may not exist | Verify method name matches actual API |
| 6 | Import paths may be wrong depending on folder depth | Verify relative paths for actual repo layout |
| 7 | Old IndicatorSnapshot.js imports will break after deletion | Search whole repo, update all imports BEFORE deleting |
| 8 | No npm scripts defined for new tools | Added package.json scripts block |
| 9 | Regex lint has false positives on comments | AST scanner is authoritative; regex is fallback only |
| 10 | Missing `validateSnapshotSafe` usage examples | Added to DTO file with JSDoc |
