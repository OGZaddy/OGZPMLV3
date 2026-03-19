#!/usr/bin/env node
/**
 * Pattern Pack Generator
 * ======================
 *
 * Exports patterns from UnifiedPatternMemory into categorized pattern packs
 * for premium distribution or backup.
 *
 * Usage:
 *   node tools/generate-pattern-pack.js --ticker TSLA --mode paper
 *   node tools/generate-pattern-pack.js --output data/packs/my-pack.json
 *
 * @author Claude (Opus) for Trey / OGZPrime
 * @date 2026-03-19
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════
// CLI ARGUMENT PARSING
// ═══════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const options = {
  ticker: 'BTC-USD',
  mode: 'paper',
  output: null,
  minSamples: 5, // Minimum trades to include pattern
  verbose: false,
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--ticker':
    case '-t':
      options.ticker = args[++i];
      break;
    case '--mode':
    case '-m':
      options.mode = args[++i];
      break;
    case '--output':
    case '-o':
      options.output = args[++i];
      break;
    case '--min-samples':
      options.minSamples = parseInt(args[++i]) || 5;
      break;
    case '--verbose':
    case '-v':
      options.verbose = true;
      break;
    case '--help':
    case '-h':
      console.log(`
Pattern Pack Generator
======================

Usage: node tools/generate-pattern-pack.js [options]

Options:
  --ticker, -t      Ticker symbol (default: BTC-USD)
  --mode, -m        Pattern file mode: live, paper, backtest (default: paper)
  --output, -o      Output file path (default: data/packs/<ticker>-<date>.json)
  --min-samples     Minimum trades to include pattern (default: 5)
  --verbose, -v     Verbose output
  --help, -h        Show this help
      `);
      process.exit(0);
  }
}

// ═══════════════════════════════════════════════════════════════
// PATTERN CATEGORIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Categorize a pattern based on its features
 * Features: [RSI, MACD, trend, bbWidth, volatility, wickRatio, priceChange, volumeChange, positionContext]
 *
 * Categories:
 *   - entry: Patterns that typically trigger new trades (RSI extremes, strong trend alignment)
 *   - exit: Patterns that typically signal exits (RSI overbought, trend reversals)
 *   - regime: Market condition patterns (volatility spikes, compression)
 *   - continuation: Patterns suggesting trend continuation
 *   - reversal: Patterns suggesting direction change
 */
function categorizePattern(pattern) {
  const [rsi, macd, trend, bbWidth, volatility, wickRatio, priceChange, volumeChange, positionCtx] = pattern.features;

  // Analyze feature characteristics
  const isRsiExtreme = rsi < 0.3 || rsi > 0.7;
  const isRsiOversold = rsi < 0.3;
  const isRsiOverbought = rsi > 0.7;
  const isTrending = Math.abs(trend) > 0.5;
  const isVolatile = volatility > 0.03;
  const isCompressed = bbWidth < 0.02;
  const isLargeWick = wickRatio > 0.6;
  const isVolumeSpike = volumeChange > 0.5;
  const hasMomentum = Math.abs(priceChange) > 0.3;

  // Entry patterns: RSI extremes with trend alignment
  if (isRsiOversold && trend > 0) return 'entry';       // Oversold in uptrend
  if (isRsiOverbought && trend < 0) return 'entry';     // Overbought in downtrend

  // Exit patterns: Counter-trend RSI extremes
  if (isRsiOverbought && trend > 0.3) return 'exit';    // Overbought at trend top
  if (isRsiOversold && trend < -0.3) return 'exit';     // Oversold at trend bottom

  // Reversal patterns: Extreme wick + RSI extreme + momentum opposite to trend
  if (isLargeWick && isRsiExtreme && Math.sign(priceChange) !== Math.sign(trend)) {
    return 'reversal';
  }

  // Continuation patterns: Aligned momentum and trend
  if (isTrending && Math.sign(priceChange) === Math.sign(trend) && isVolumeSpike) {
    return 'continuation';
  }

  // Regime patterns: Volatility/compression characteristics
  if (isCompressed || (isVolatile && !hasMomentum)) {
    return 'regime';
  }

  // Default: entry if winning, exit if losing
  return pattern.winRate > 0.5 ? 'entry' : 'exit';
}

/**
 * Determine pattern direction from features
 */
function getPatternDirection(pattern) {
  const [rsi, macd, trend] = pattern.features;

  // Strong directional signals
  if (trend > 0.5 || (rsi < 0.3 && macd > 0)) return 'buy';
  if (trend < -0.5 || (rsi > 0.7 && macd < 0)) return 'sell';

  // Moderate signals
  if (trend > 0.1 && rsi < 0.5) return 'buy';
  if (trend < -0.1 && rsi > 0.5) return 'sell';

  return 'neutral';
}

/**
 * Get human-readable pattern name from features
 */
function getPatternName(pattern) {
  const [rsi, macd, trend, bbWidth, volatility, wickRatio] = pattern.features;

  const names = [];

  // RSI condition
  if (rsi < 0.3) names.push('oversold');
  else if (rsi > 0.7) names.push('overbought');
  else if (rsi < 0.45) names.push('low_rsi');
  else if (rsi > 0.55) names.push('high_rsi');

  // Trend condition
  if (trend > 0.5) names.push('strong_uptrend');
  else if (trend < -0.5) names.push('strong_downtrend');
  else if (Math.abs(trend) < 0.2) names.push('ranging');

  // Volatility
  if (volatility > 0.04) names.push('high_vol');
  else if (volatility < 0.01) names.push('low_vol');

  // Wick
  if (wickRatio > 0.6) names.push('hammer');
  else if (wickRatio < 0.2) names.push('marubozu');

  return names.length > 0 ? names.join('_') : 'unknown';
}

// ═══════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═══════════════════════════════════════════════════════════════

async function generatePatternPack() {
  console.log(`\n=== Pattern Pack Generator ===`);
  console.log(`Ticker: ${options.ticker}`);
  console.log(`Mode: ${options.mode}`);
  console.log(`Min Samples: ${options.minSamples}`);

  // Load pattern file
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const patternFile = path.join(dataDir, `unified-patterns.${options.mode}.json`);

  if (!fs.existsSync(patternFile)) {
    console.error(`\nError: Pattern file not found: ${patternFile}`);
    console.log('Available pattern files:');
    const files = fs.readdirSync(dataDir).filter(f => f.startsWith('unified-patterns'));
    files.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }

  const rawData = JSON.parse(fs.readFileSync(patternFile, 'utf8'));
  const allPatterns = rawData.patterns || {};

  console.log(`\nLoaded ${Object.keys(allPatterns).length} total patterns`);

  // Filter and categorize patterns
  const categories = {
    entry: { patterns: [], wins: 0, losses: 0, totalPnL: 0 },
    exit: { patterns: [], wins: 0, losses: 0, totalPnL: 0 },
    regime: { patterns: [], wins: 0, losses: 0, totalPnL: 0 },
    continuation: { patterns: [], wins: 0, losses: 0, totalPnL: 0 },
    reversal: { patterns: [], wins: 0, losses: 0, totalPnL: 0 },
  };

  let included = 0;
  let excluded = 0;

  for (const [sig, pattern] of Object.entries(allPatterns)) {
    const totalTrades = pattern.wins + pattern.losses;

    // Filter by minimum samples
    if (totalTrades < options.minSamples) {
      excluded++;
      continue;
    }

    included++;

    // Categorize
    const category = categorizePattern(pattern);
    const direction = getPatternDirection(pattern);
    const name = getPatternName(pattern);

    // Add to category
    const cat = categories[category];
    cat.patterns.push({
      signature: sig,
      features: pattern.features,
      name,
      direction,
      wins: pattern.wins,
      losses: pattern.losses,
      winRate: pattern.winRate,
      avgPnL: pattern.avgPnL,
      totalPnL: pattern.totalPnL,
      status: pattern.status,
      firstSeen: pattern.firstSeen,
      lastOutcome: pattern.lastOutcome,
    });

    cat.wins += pattern.wins;
    cat.losses += pattern.losses;
    cat.totalPnL += pattern.totalPnL;
  }

  console.log(`Included: ${included} patterns (>= ${options.minSamples} trades)`);
  console.log(`Excluded: ${excluded} patterns (< ${options.minSamples} trades)`);

  // Calculate category stats
  const categorySummary = {};
  for (const [catName, cat] of Object.entries(categories)) {
    const totalTrades = cat.wins + cat.losses;
    categorySummary[catName] = {
      count: cat.patterns.length,
      promoted: cat.patterns.filter(p => p.status === 'promoted').length,
      avgWinRate: totalTrades > 0 ? cat.wins / totalTrades : 0,
      avgExpectancy: totalTrades > 0 ? cat.totalPnL / totalTrades : 0,
    };

    if (options.verbose) {
      console.log(`\n${catName.toUpperCase()}: ${cat.patterns.length} patterns`);
      cat.patterns.slice(0, 5).forEach(p => {
        console.log(`  - ${p.name}: WR=${(p.winRate * 100).toFixed(1)}% (${p.wins}W/${p.losses}L)`);
      });
    }
  }

  // Build regime configs from regime patterns
  const regimeConfigs = {};
  for (const p of categories.regime.patterns) {
    const [, , trend] = p.features;
    let regimeName = 'ranging';
    if (trend > 0.3) regimeName = 'trending_up';
    else if (trend < -0.3) regimeName = 'trending_down';

    if (!regimeConfigs[regimeName]) {
      regimeConfigs[regimeName] = { patterns: [], totalPnL: 0, totalTrades: 0 };
    }
    regimeConfigs[regimeName].patterns.push(p);
    regimeConfigs[regimeName].totalPnL += p.totalPnL;
    regimeConfigs[regimeName].totalTrades += p.wins + p.losses;
  }

  // Calculate best config per regime (simplified)
  for (const [regime, data] of Object.entries(regimeConfigs)) {
    const avgPnL = data.totalTrades > 0 ? data.totalPnL / data.totalTrades : 0;
    regimeConfigs[regime] = {
      bestSL: avgPnL > 0 ? 1.5 : 1.0, // Wider stops if profitable
      bestTP: avgPnL > 0 ? 2.5 : 1.5, // Wider targets if profitable
      bestSizing: avgPnL > 0 ? 0.07 : 0.03, // More aggressive if profitable
      patternCount: data.patterns.length,
      avgExpectancy: avgPnL,
    };
  }

  // Add regime configs to summary
  if (categorySummary.regime) {
    categorySummary.regime.configs = regimeConfigs;
  }

  // Build output pack
  const pack = {
    pack: `${options.ticker}-Patterns-v1`,
    ticker: options.ticker,
    generated: new Date().toISOString().split('T')[0],
    dataRange: 'auto-detected',
    totalPatterns: included,
    version: 1,
    categories: categorySummary,
    patterns: {
      entry: categories.entry.patterns,
      exit: categories.exit.patterns,
      regime: categories.regime.patterns,
      continuation: categories.continuation.patterns,
      reversal: categories.reversal.patterns,
    },
  };

  // Determine first/last pattern dates
  const allDates = Object.values(allPatterns)
    .filter(p => p.firstSeen)
    .map(p => p.firstSeen);
  if (allDates.length > 0) {
    const earliest = new Date(Math.min(...allDates)).toISOString().split('T')[0];
    const latest = new Date(Math.max(...allDates)).toISOString().split('T')[0];
    pack.dataRange = `${earliest} to ${latest}`;
  }

  // Output file
  const outputDir = path.join(dataDir, 'packs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = options.output || path.join(outputDir, `${options.ticker}-${pack.generated}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(pack, null, 2));

  console.log(`\n=== Pattern Pack Generated ===`);
  console.log(`Output: ${outputFile}`);
  console.log(`Total: ${pack.totalPatterns} patterns`);
  console.log(`\nCategory breakdown:`);
  for (const [cat, stats] of Object.entries(categorySummary)) {
    console.log(`  ${cat}: ${stats.count} patterns (${stats.promoted} promoted, ${(stats.avgWinRate * 100).toFixed(1)}% WR)`);
  }

  return pack;
}

// Run
generatePatternPack().catch(err => {
  console.error('Error generating pattern pack:', err);
  process.exit(1);
});
