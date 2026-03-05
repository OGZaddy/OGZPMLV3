#!/usr/bin/env node
/**
 * Multi-Block Backtest Validation
 * Tests each exit system across multiple 60k candle blocks
 * Reports win rate and average performance
 */

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const BLOCK_SIZE = parseInt(process.env.BLOCK_SIZE) || 2000;  // 2k blocks = 10 blocks from 20k
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '../data/cryptocompare-candles.json');
const RESULTS_DIR = '/tmp/multi-block-results';
const EXIT_SYSTEMS = ['intelligence', 'maxprofit', 'legacy', 'pattern', 'brain'];
const FEE_RATE = process.env.FEE_RATE || '0.005';  // Default 0.5% per side = 1% round trip (worst case)

async function main() {
  console.log('='.repeat(60));
  console.log('  MULTI-BLOCK BACKTEST VALIDATION');
  console.log('='.repeat(60));

  // Load full candle data
  console.log('\n📂 Loading candle data...');
  const allCandles = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  console.log(`   Total candles: ${allCandles.length.toLocaleString()}`);

  // Calculate blocks
  const numBlocks = Math.floor(allCandles.length / BLOCK_SIZE);
  console.log(`   Block size: ${BLOCK_SIZE.toLocaleString()}`);
  console.log(`   Number of blocks: ${numBlocks}`);

  // Create results directory
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  // Results storage
  const results = {};
  EXIT_SYSTEMS.forEach(sys => {
    results[sys] = {
      blocks: [],
      wins: 0,
      losses: 0,
      totalReturn: 0,
      avgReturn: 0
    };
  });

  // Run backtests for each block and each exit system
  for (let blockNum = 0; blockNum < numBlocks; blockNum++) {
    const startIdx = blockNum * BLOCK_SIZE;
    const endIdx = startIdx + BLOCK_SIZE;
    const blockCandles = allCandles.slice(startIdx, endIdx);

    // Save block to temp file
    const blockFile = path.join(RESULTS_DIR, `block-${blockNum}.json`);
    fs.writeFileSync(blockFile, JSON.stringify(blockCandles));

    const startDate = new Date(blockCandles[0].timestamp).toISOString().split('T')[0];
    const endDate = new Date(blockCandles[blockCandles.length - 1].timestamp).toISOString().split('T')[0];

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📊 BLOCK ${blockNum + 1}/${numBlocks}: ${startDate} to ${endDate}`);
    console.log(`${'─'.repeat(60)}`);

    for (const exitSystem of EXIT_SYSTEMS) {
      process.stdout.write(`   ${exitSystem.padEnd(15)}: `);

      try {
        // Run backtest
        const cmd = `cd /opt/ogzprime/OGZPMLV2 && BACKTEST_MODE=true BACKTEST_SILENT=true ENABLE_TRAI=false EXIT_SYSTEM=${exitSystem} CANDLE_DATA_FILE=${blockFile} node run-empire-v2.js 2>&1`;
        const output = execSync(cmd, {
          timeout: 300000,  // 5 min timeout per block
          maxBuffer: 50 * 1024 * 1024
        }).toString();

        // Extract final balance from output
        const balanceMatch = output.match(/Final Balance:\s*\$?([\d,.-]+)/i) ||
                            output.match(/balance[:\s]+\$?([\d,.-]+)/i);
        const returnMatch = output.match(/Total Return:\s*([-\d.]+)%/i) ||
                           output.match(/return[:\s]+([-\d.]+)%/i);

        let finalBalance = 10000;
        let returnPct = 0;

        if (balanceMatch) {
          finalBalance = parseFloat(balanceMatch[1].replace(/,/g, ''));
          returnPct = ((finalBalance - 10000) / 10000) * 100;
        } else if (returnMatch) {
          returnPct = parseFloat(returnMatch[1]);
          finalBalance = 10000 * (1 + returnPct / 100);
        } else {
          // Try to find in JSON output
          const jsonMatch = output.match(/"finalBalance":\s*([\d.]+)/);
          if (jsonMatch) {
            finalBalance = parseFloat(jsonMatch[1]);
            returnPct = ((finalBalance - 10000) / 10000) * 100;
          }
        }

        const isWin = returnPct > 0;
        const emoji = isWin ? '✅' : '❌';

        console.log(`${emoji} ${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}% ($${finalBalance.toFixed(2)})`);

        // Store results
        results[exitSystem].blocks.push({
          blockNum,
          startDate,
          endDate,
          finalBalance,
          returnPct,
          isWin
        });

        if (isWin) results[exitSystem].wins++;
        else results[exitSystem].losses++;
        results[exitSystem].totalReturn += returnPct;

      } catch (err) {
        console.log(`❌ ERROR: ${err.message.slice(0, 50)}`);
        results[exitSystem].blocks.push({
          blockNum,
          error: err.message
        });
        results[exitSystem].losses++;
      }
    }

    // Cleanup block file
    fs.unlinkSync(blockFile);
  }

  // Calculate averages
  EXIT_SYSTEMS.forEach(sys => {
    const validBlocks = results[sys].blocks.filter(b => !b.error);
    results[sys].avgReturn = validBlocks.length > 0
      ? results[sys].totalReturn / validBlocks.length
      : 0;
  });

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('  FINAL RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log('\n┌─────────────────┬────────┬────────┬────────────┬────────────┐');
  console.log('│ Exit System     │  Wins  │ Losses │ Win Rate   │ Avg Return │');
  console.log('├─────────────────┼────────┼────────┼────────────┼────────────┤');

  // Sort by average return
  const sorted = EXIT_SYSTEMS.sort((a, b) => results[b].avgReturn - results[a].avgReturn);

  sorted.forEach(sys => {
    const r = results[sys];
    const winRate = ((r.wins / (r.wins + r.losses)) * 100).toFixed(1);
    const avgRet = r.avgReturn >= 0 ? `+${r.avgReturn.toFixed(2)}%` : `${r.avgReturn.toFixed(2)}%`;
    console.log(`│ ${sys.padEnd(15)} │ ${String(r.wins).padStart(6)} │ ${String(r.losses).padStart(6)} │ ${winRate.padStart(9)}% │ ${avgRet.padStart(10)} │`);
  });

  console.log('└─────────────────┴────────┴────────┴────────────┴────────────┘');

  // Winner announcement
  const winner = sorted[0];
  console.log(`\n🏆 WINNER: ${winner.toUpperCase()}`);
  console.log(`   Win Rate: ${((results[winner].wins / (results[winner].wins + results[winner].losses)) * 100).toFixed(1)}%`);
  console.log(`   Avg Return: ${results[winner].avgReturn >= 0 ? '+' : ''}${results[winner].avgReturn.toFixed(2)}%`);

  // Save full results
  const resultsFile = path.join(RESULTS_DIR, 'multi-block-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(`\n📁 Full results saved to: ${resultsFile}`);
}

main().catch(console.error);
