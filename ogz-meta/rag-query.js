#!/usr/bin/env node

/**
 * rag-query.js
 * Deterministic RAG retrieval from:
 * - ogz-meta markdown files
 * - Fix Ledger
 * - Forensics reports
 * No embeddings, just smart keyword + structure matching
 */

const fs = require('fs');
const path = require('path');

const META_DIR = __dirname;
const LEDGER_FILE = path.join(META_DIR, 'ledger', 'fixes.jsonl');
const REPORTS_DIR = path.dirname(__dirname);
const RAG_INDEX = path.join(META_DIR, 'rag_index.json');

/**
 * Score relevance of text to query
 */
function scoreRelevance(text, query) {
  if (!text || typeof text !== 'string') return 0;
  if (!query || typeof query !== 'string') return 0;
  const queryWords = query.toLowerCase().split(/\s+/);
  const textLower = text.toLowerCase();
  let score = 0;

  queryWords.forEach(word => {
    // Exact word match
    const exactMatches = (textLower.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
    score += exactMatches * 10;

    // Partial match
    if (textLower.includes(word)) {
      score += 5;
    }
  });

  // Boost for file paths mentioned in query
  const pathPattern = /[a-zA-Z0-9_-]+\.js/g;
  const queryPaths = query.match(pathPattern) || [];
  queryPaths.forEach(path => {
    if (text.includes(path)) score += 20;
  });

  return score;
}

/**
 * Query the Fix Ledger
 */
function queryLedger(query, limit = 3) {
  if (!fs.existsSync(LEDGER_FILE)) return [];

  const entries = fs.readFileSync(LEDGER_FILE, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));

  // Score each entry
  const scored = entries.map(entry => {
    let score = 0;

    // Score against various fields (handle alternate schemas: feature entries use summary/details)
    score += scoreRelevance(entry.symptom || entry.summary || '', query);
    score += scoreRelevance(entry.root_cause || entry.details || '', query) * 0.8;
    score += scoreRelevance(entry.minimal_fix || '', query) * 0.5;
    score += scoreRelevance((entry.tags || []).join(' '), query) * 2;
    score += scoreRelevance((entry.files || []).join(' '), query) * 1.5;

    // Recency boost (last 30 days)
    const daysSince = Math.floor((Date.now() - new Date(entry.date).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince < 30) {
      score += (30 - daysSince);
    }

    // Severity boost
    if (entry.severity === 'CRITICAL') score += 15;
    if (entry.severity === 'HIGH') score += 10;

    return { ...entry, _score: score };
  });

  // Sort and return top N
  return scored
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .filter(e => e._score > 0);
}

/**
 * Query markdown reports
 */
function queryReports(query, limit = 3) {
  const reportFiles = fs.readdirSync(REPORTS_DIR)
    .filter(f => f.match(/(SURGICAL|FIX-\d+|VERIFY|CLAUDITO).*\.md$/))
    .map(f => path.join(REPORTS_DIR, f));

  const results = [];

  for (const file of reportFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const score = scoreRelevance(content, query);

    if (score > 0) {
      // Extract relevant section
      const lines = content.split('\n');
      let bestSection = '';
      let bestScore = 0;

      // Find best 20-line window
      for (let i = 0; i < lines.length - 20; i++) {
        const section = lines.slice(i, i + 20).join('\n');
        const sectionScore = scoreRelevance(section, query);
        if (sectionScore > bestScore) {
          bestScore = sectionScore;
          bestSection = section;
        }
      }

      results.push({
        file: path.basename(file),
        score: score,
        excerpt: bestSection.slice(0, 1000),
        path: file
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Query ogz-meta files
 */
function queryMeta(query, limit = 3) {
  const metaFiles = fs.readdirSync(META_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(META_DIR, f));

  const results = [];

  for (const file of metaFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const score = scoreRelevance(content, query);

    if (score > 0) {
      // Extract most relevant section
      const sections = content.split(/^##/m);
      let bestSection = '';
      let bestScore = 0;

      sections.forEach(section => {
        const sectionScore = scoreRelevance(section, query);
        if (sectionScore > bestScore) {
          bestScore = sectionScore;
          bestSection = section;
        }
      });

      results.push({
        file: path.basename(file),
        score: score,
        excerpt: bestSection.slice(0, 1000),
        path: file
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Main RAG query function
 */
function ragQuery(query, options = {}) {
  const results = {
    query: query,
    timestamp: new Date().toISOString(),
    ledger: [],
    reports: [],
    meta: [],
    summary: []
  };

  console.log(`\n🔍 RAG Query: "${query}"\n`);

  // Query all sources
  results.ledger = queryLedger(query, options.limit || 3);
  results.reports = queryReports(query, options.limit || 3);
  results.meta = queryMeta(query, options.limit || 3);

  // Format results
  if (results.ledger.length > 0) {
    console.log('📚 Fix Ledger Matches:');
    results.ledger.forEach(entry => {
      console.log(`  [${entry.severity}] ${entry.id}`);
      console.log(`    Symptom: ${entry.symptom.slice(0, 100)}...`);
      console.log(`    Fix: ${entry.minimal_fix.slice(0, 100)}...`);
      console.log(`    What worked: ${entry.what_worked[0] || 'N/A'}`);
      results.summary.push({
        source: 'ledger',
        id: entry.id,
        key_info: entry.minimal_fix
      });
    });
    console.log('');
  }

  if (results.reports.length > 0) {
    console.log('📄 Report Matches:');
    results.reports.forEach(report => {
      console.log(`  ${report.file} (score: ${report.score})`);
      console.log(`    ${report.excerpt.split('\n')[0]}...`);
      results.summary.push({
        source: 'report',
        file: report.file,
        key_info: report.excerpt.slice(0, 200)
      });
    });
    console.log('');
  }

  if (results.meta.length > 0) {
    console.log('📋 Meta-Pack Matches:');
    results.meta.forEach(meta => {
      console.log(`  ${meta.file} (score: ${meta.score})`);
      console.log(`    ${meta.excerpt.split('\n')[0]}...`);
      results.summary.push({
        source: 'meta',
        file: meta.file,
        key_info: meta.excerpt.slice(0, 200)
      });
    });
    console.log('');
  }

  if (results.summary.length === 0) {
    console.log('❌ No relevant matches found');
    console.log('\n💡 Suggestions:');
    console.log('  - Try different keywords');
    console.log('  - Check file names directly');
    console.log('  - Run update-ledger.js to index recent fixes');
  }

  return results;
}

/**
 * Format for injection into context
 */
function formatForContext(results, maxTokens = 2000) {
  let context = '# Retrieved Context\n\n';

  if (results.ledger.length > 0) {
    context += '## Relevant Past Fixes:\n';
    results.ledger.forEach(entry => {
      context += `- **${entry.id}**: ${entry.minimal_fix}\n`;
      context += `  - Root cause: ${entry.root_cause.slice(0, 100)}\n`;
      context += `  - Files: ${entry.files.join(', ')}\n`;
      if (entry.what_worked.length > 0) {
        context += `  - ✅ Worked: ${entry.what_worked[0]}\n`;
      }
      if (entry.what_failed.length > 0) {
        context += `  - ❌ Failed: ${entry.what_failed[0]}\n`;
      }
    });
    context += '\n';
  }

  if (results.reports.length > 0) {
    context += '## Relevant Reports:\n';
    results.reports.forEach(report => {
      context += `### ${report.file}\n`;
      context += report.excerpt.slice(0, 500) + '...\n\n';
    });
  }

  if (results.meta.length > 0) {
    context += '## Architecture/Guardrails:\n';
    results.meta.forEach(meta => {
      context += `### From ${meta.file}:\n`;
      context += meta.excerpt.slice(0, 400) + '...\n\n';
    });
  }

  return context;
}

// CLI interface
if (require.main === module) {
  const query = process.argv.slice(2).join(' ');

  if (!query) {
    console.log('Usage: node rag-query.js <search query>');
    console.log('\nExamples:');
    console.log('  node rag-query.js "pattern memory not saving"');
    console.log('  node rag-query.js "StateManager.js state sync"');
    console.log('  node rag-query.js "TRAI blocking main loop"');
    process.exit(1);
  }

  const results = ragQuery(query);

  // Save results for other tools
  const outputPath = path.join(META_DIR, '.last-rag-query.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n📁 Full results saved to: ${outputPath}`);

  // Show formatted context
  console.log('\n' + '='.repeat(50));
  console.log('FORMATTED CONTEXT FOR INJECTION:');
  console.log('='.repeat(50));
  console.log(formatForContext(results));
}

module.exports = { ragQuery, formatForContext };