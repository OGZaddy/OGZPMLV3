#!/usr/bin/env node
/**
 * Parallel Multi-Block Backtest
 * Runs all exit systems in parallel using worker threads
 * Designed for local execution on high-performance hardware
 */

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');

const EXIT_SYSTEMS = ['intelligence', 'maxprofit', 'legacy', 'pattern', 'brain'];
const NUM_CPUS = os.cpus().length;

if (isMainThread) {
  // MAIN THREAD - Orchestrates parallel execution

  async function main() {
    const dataFile = process.argv[2] || path.join(__dirname, '../data/synthetic-5m-candles.json');
    const blockSize = parseInt(process.argv[3]) || 20000;
    const maxWorkers = parseInt(process.argv[4]) || Math.min(NUM_CPUS, 10);

    console.log('='.repeat(60));
    console.log('  PARALLEL BACKTEST ENGINE');
    console.log('='.repeat(60));
    console.log(`  CPUs available: ${NUM_CPUS}`);
    console.log(`  Workers to use: ${maxWorkers}`);
    console.log(`  Data file: ${dataFile}`);
    console.log(`  Block size: ${blockSize.toLocaleString()}`);
    console.log('='.repeat(60));

    // Load candle data
    console.log('\n📂 Loading candles...');
    const allCandles = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    console.log(`   Loaded ${allCandles.length.toLocaleString()} candles`);

    // Split into blocks
    const numBlocks = Math.floor(allCandles.length / blockSize);
    console.log(`   Splitting into ${numBlocks} blocks of ${blockSize.toLocaleString()}`);

    // Create job queue: each job = (exit_system, block_index)
    const jobs = [];
    for (let blockIdx = 0; blockIdx < numBlocks; blockIdx++) {
      for (const exitSystem of EXIT_SYSTEMS) {
        jobs.push({ exitSystem, blockIdx, blockSize });
      }
    }
    console.log(`   Total jobs: ${jobs.length} (${EXIT_SYSTEMS.length} systems × ${numBlocks} blocks)`);

    // Results storage
    const results = {};
    EXIT_SYSTEMS.forEach(sys => {
      results[sys] = { blocks: [], wins: 0, losses: 0, totalReturn: 0 };
    });

    // Progress tracking
    let completed = 0;
    const startTime = Date.now();

    // Worker pool
    const runWorker = (job, candles) => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(__filename, {
          workerData: { job, candles }
        });
        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', code => {
          if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
        });
      });
    };

    // Process jobs in batches
    console.log('\n🚀 Starting parallel execution...\n');

    for (let i = 0; i < jobs.length; i += maxWorkers) {
      const batch = jobs.slice(i, i + maxWorkers);

      const promises = batch.map(job => {
        const startIdx = job.blockIdx * blockSize;
        const blockCandles = allCandles.slice(startIdx, startIdx + blockSize);
        return runWorker(job, blockCandles);
      });

      const batchResults = await Promise.all(promises);

      batchResults.forEach((result, idx) => {
        completed++;
        const job = batch[idx];
        const pct = ((completed / jobs.length) * 100).toFixed(1);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        const emoji = result.returnPct > 0 ? '✅' : '❌';
        console.log(`[${pct}%] ${job.exitSystem.padEnd(12)} Block ${job.blockIdx + 1}: ${emoji} ${result.returnPct >= 0 ? '+' : ''}${result.returnPct.toFixed(2)}% (${elapsed}s)`);

        // Store result
        results[job.exitSystem].blocks.push(result);
        if (result.returnPct > 0) results[job.exitSystem].wins++;
        else results[job.exitSystem].losses++;
        results[job.exitSystem].totalReturn += result.returnPct;
      });
    }

    // Calculate averages and print summary
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '='.repeat(60));
    console.log('  RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Completed in ${totalTime}s`);
    console.log('\n┌─────────────────┬────────┬────────┬────────────┬────────────┐');
    console.log('│ Exit System     │  Wins  │ Losses │ Win Rate   │ Avg Return │');
    console.log('├─────────────────┼────────┼────────┼────────────┼────────────┤');

    const sorted = EXIT_SYSTEMS.sort((a, b) =>
      (results[b].totalReturn / numBlocks) - (results[a].totalReturn / numBlocks)
    );

    sorted.forEach(sys => {
      const r = results[sys];
      const avgReturn = r.totalReturn / numBlocks;
      const winRate = (r.wins / (r.wins + r.losses) * 100).toFixed(1);
      const avgStr = avgReturn >= 0 ? `+${avgReturn.toFixed(2)}%` : `${avgReturn.toFixed(2)}%`;
      console.log(`│ ${sys.padEnd(15)} │ ${String(r.wins).padStart(6)} │ ${String(r.losses).padStart(6)} │ ${winRate.padStart(9)}% │ ${avgStr.padStart(10)} │`);
    });

    console.log('└─────────────────┴────────┴────────┴────────────┴────────────┘');

    const winner = sorted[0];
    console.log(`\n🏆 WINNER: ${winner.toUpperCase()}`);

    // Save results
    const resultsFile = path.join(process.cwd(), 'parallel-backtest-results.json');
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    console.log(`\n📁 Results saved to: ${resultsFile}`);
  }

  main().catch(console.error);

} else {
  // WORKER THREAD - Runs single backtest

  const { job, candles } = workerData;

  // Inline minimal backtest (no external dependencies for speed)
  // This is a simplified version - real version would import the actual bot

  const runBacktest = () => {
    const { execSync } = require('child_process');
    const fs = require('fs');

    // Save candles to temp file
    const tempFile = path.join(os.tmpdir(), `worker-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(tempFile, JSON.stringify(candles));

    try {
      const cmd = `cd /opt/ogzprime/OGZPMLV2 && BACKTEST_MODE=true BACKTEST_FAST=true BACKTEST_SILENT=true ENABLE_TRAI=false EXIT_SYSTEM=${job.exitSystem} CANDLE_DATA_FILE=${tempFile} node run-empire-v2.js 2>&1`;

      const output = execSync(cmd, {
        timeout: 300000,
        maxBuffer: 50 * 1024 * 1024
      }).toString();

      // Parse result
      const balanceMatch = output.match(/Final Balance[:\s]*\$?([\d,.]+)/i);
      const finalBalance = balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, '')) : 10000;
      const returnPct = ((finalBalance - 10000) / 10000) * 100;

      fs.unlinkSync(tempFile);

      return {
        exitSystem: job.exitSystem,
        blockIdx: job.blockIdx,
        finalBalance,
        returnPct,
        success: true
      };
    } catch (err) {
      try { fs.unlinkSync(tempFile); } catch(e) {}
      return {
        exitSystem: job.exitSystem,
        blockIdx: job.blockIdx,
        finalBalance: 10000,
        returnPct: 0,
        success: false,
        error: err.message
      };
    }
  };

  parentPort.postMessage(runBacktest());
}
