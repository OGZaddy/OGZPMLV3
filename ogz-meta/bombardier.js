#!/usr/bin/env node

/**
 * bombardier.js - Blast Radius Analyzer
 * =====================================
 * Uses tree-sitter to parse the codebase and show what will be affected
 * when you change a function/file.
 *
 * Usage:
 *   node ogz-meta/bombardier.js <file>:<line>
 *   node ogz-meta/bombardier.js <functionName>
 *   node ogz-meta/bombardier.js --build-graph  (rebuild cache)
 *
 * Pipeline integration:
 *   Run before /fixer to show blast radius for approval
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');

const PROJECT_ROOT = path.join(__dirname, '..');
const CACHE_FILE = path.join(__dirname, 'call-graph-cache.json');

// Files/dirs to skip
const SKIP_PATTERNS = [
  'node_modules',
  '.git',
  'data/',
  'tuning/fullstack-report',
  'tuning/diagnostic-report',
  'public/proof',
  '.min.js',
  'bundle.js'
];

/**
 * Main class for blast radius analysis
 */
class Bombardier {
  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(JavaScript);

    // Call graph: functionId -> { file, line, name, calls: [], calledBy: [] }
    this.callGraph = new Map();

    // File -> functions map for quick lookup
    this.fileIndex = new Map();

    // Function name -> [functionIds] for name-based lookup
    this.nameIndex = new Map();
  }

  /**
   * Build the call graph by parsing all JS files
   */
  async buildGraph() {
    console.log('Building call graph...');
    const startTime = Date.now();

    const jsFiles = this._findJsFiles(PROJECT_ROOT);
    console.log(`Found ${jsFiles.length} JS files to parse`);

    let parsed = 0;
    let errors = 0;

    for (const file of jsFiles) {
      try {
        await this._parseFile(file);
        parsed++;
      } catch (err) {
        errors++;
        if (process.env.VERBOSE) {
          console.error(`Error parsing ${file}: ${err.message}`);
        }
      }
    }

    // Second pass: resolve call references
    this._resolveCallReferences();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Parsed ${parsed} files (${errors} errors) in ${elapsed}s`);
    console.log(`Found ${this.callGraph.size} functions`);

    // Cache the graph
    this._saveCache();

    return this;
  }

  /**
   * Find all JS files in directory
   */
  _findJsFiles(dir, files = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(PROJECT_ROOT, fullPath);

      // Skip patterns
      if (SKIP_PATTERNS.some(p => relativePath.includes(p))) {
        continue;
      }

      if (entry.isDirectory()) {
        this._findJsFiles(fullPath, files);
      } else if (entry.name.endsWith('.js')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Parse a single file and extract function definitions/calls
   */
  async _parseFile(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    const tree = this.parser.parse(code);
    const relativePath = path.relative(PROJECT_ROOT, filePath);

    // Track functions in this file
    const fileFunctions = [];

    // Walk the tree
    this._walkTree(tree.rootNode, relativePath, code, fileFunctions);

    this.fileIndex.set(relativePath, fileFunctions);
  }

  /**
   * Recursively walk the AST
   */
  _walkTree(node, file, code, fileFunctions, parentFunction = null) {
    // Function declarations
    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const funcInfo = this._registerFunction(file, node, nameNode.text, code);
        fileFunctions.push(funcInfo.id);

        // Walk body with this as parent
        const body = node.childForFieldName('body');
        if (body) {
          this._walkTree(body, file, code, fileFunctions, funcInfo);
        }
        return;
      }
    }

    // Method definitions in classes
    if (node.type === 'method_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const funcInfo = this._registerFunction(file, node, nameNode.text, code);
        fileFunctions.push(funcInfo.id);

        const body = node.childForFieldName('body');
        if (body) {
          this._walkTree(body, file, code, fileFunctions, funcInfo);
        }
        return;
      }
    }

    // Arrow functions assigned to variables
    if (node.type === 'variable_declarator') {
      const nameNode = node.childForFieldName('name');
      const value = node.childForFieldName('value');
      if (nameNode && value && (value.type === 'arrow_function' || value.type === 'function')) {
        const funcInfo = this._registerFunction(file, value, nameNode.text, code);
        fileFunctions.push(funcInfo.id);

        const body = value.childForFieldName('body');
        if (body) {
          this._walkTree(body, file, code, fileFunctions, funcInfo);
        }
        return;
      }
    }

    // Function calls
    if (node.type === 'call_expression') {
      const funcNode = node.childForFieldName('function');
      if (funcNode && parentFunction) {
        const callName = this._extractCallName(funcNode);
        if (callName) {
          parentFunction.calls.push({
            name: callName,
            line: node.startPosition.row + 1
          });
        }
      }
    }

    // Recurse into children
    for (let i = 0; i < node.childCount; i++) {
      this._walkTree(node.child(i), file, code, fileFunctions, parentFunction);
    }
  }

  /**
   * Register a function in the call graph
   */
  _registerFunction(file, node, name, code) {
    const line = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const id = `${file}:${name}:${line}`;

    const funcInfo = {
      id,
      file,
      name,
      line,
      endLine,
      calls: [],      // Functions this calls (resolved later)
      calledBy: [],   // Functions that call this (resolved later)
      rawCalls: []    // Unresolved call names
    };

    // Store with raw calls for later resolution
    funcInfo.calls = [];

    this.callGraph.set(id, funcInfo);

    // Index by name
    if (!this.nameIndex.has(name)) {
      this.nameIndex.set(name, []);
    }
    this.nameIndex.get(name).push(id);

    return funcInfo;
  }

  /**
   * Extract the name being called from a call expression
   */
  _extractCallName(node) {
    if (node.type === 'identifier') {
      return node.text;
    }
    if (node.type === 'member_expression') {
      const prop = node.childForFieldName('property');
      if (prop) return prop.text;
    }
    return null;
  }

  /**
   * Second pass: resolve call references to actual functions
   */
  _resolveCallReferences() {
    for (const [id, func] of this.callGraph) {
      for (const call of func.calls) {
        // Find functions with this name
        const targets = this.nameIndex.get(call.name) || [];

        for (const targetId of targets) {
          if (targetId !== id) {  // Don't count self-calls as external
            const target = this.callGraph.get(targetId);
            if (target && !target.calledBy.includes(id)) {
              target.calledBy.push(id);
            }
          }
        }
      }
    }
  }

  /**
   * Get blast radius for a specific location
   */
  getBlastRadius(fileOrFunc, line = null) {
    let targetFuncs = [];

    if (line !== null) {
      // File:line lookup
      const file = fileOrFunc;
      const fileFuncs = this.fileIndex.get(file) || [];

      for (const funcId of fileFuncs) {
        const func = this.callGraph.get(funcId);
        if (func && line >= func.line && line <= func.endLine) {
          targetFuncs.push(func);
        }
      }
    } else {
      // Function name lookup
      const funcIds = this.nameIndex.get(fileOrFunc) || [];
      targetFuncs = funcIds.map(id => this.callGraph.get(id)).filter(Boolean);
    }

    if (targetFuncs.length === 0) {
      return { found: false, target: fileOrFunc };
    }

    // Collect blast radius
    const result = {
      found: true,
      targets: [],
      upstream: new Set(),    // Functions that call these
      downstream: new Set(),  // Functions these call
      files: new Set()        // All affected files
    };

    for (const func of targetFuncs) {
      result.targets.push({
        id: func.id,
        name: func.name,
        file: func.file,
        line: func.line
      });

      result.files.add(func.file);

      // Upstream: who calls this?
      for (const callerId of func.calledBy) {
        const caller = this.callGraph.get(callerId);
        if (caller) {
          result.upstream.add(JSON.stringify({
            name: caller.name,
            file: caller.file,
            line: caller.line
          }));
          result.files.add(caller.file);
        }
      }

      // Downstream: what does this call?
      for (const call of func.calls) {
        const targets = this.nameIndex.get(call.name) || [];
        for (const targetId of targets) {
          const target = this.callGraph.get(targetId);
          if (target) {
            result.downstream.add(JSON.stringify({
              name: target.name,
              file: target.file,
              line: target.line
            }));
            result.files.add(target.file);
          }
        }
      }
    }

    // Convert sets to arrays
    result.upstream = Array.from(result.upstream).map(s => JSON.parse(s));
    result.downstream = Array.from(result.downstream).map(s => JSON.parse(s));
    result.files = Array.from(result.files);

    return result;
  }

  /**
   * Pretty print blast radius
   */
  printBlastRadius(result) {
    if (!result.found) {
      console.log(`\nNo function found at: ${result.target}`);
      return;
    }

    console.log('\n' + '='.repeat(60));
    console.log('BLAST RADIUS ANALYSIS');
    console.log('='.repeat(60));

    console.log('\nTARGET:');
    for (const t of result.targets) {
      console.log(`  ${t.name} @ ${t.file}:${t.line}`);
    }

    console.log(`\nUPSTREAM (${result.upstream.length} callers):`);
    if (result.upstream.length === 0) {
      console.log('  (none - this is a root/entry point)');
    } else {
      for (const u of result.upstream.slice(0, 15)) {
        console.log(`  <- ${u.name} @ ${u.file}:${u.line}`);
      }
      if (result.upstream.length > 15) {
        console.log(`  ... and ${result.upstream.length - 15} more`);
      }
    }

    console.log(`\nDOWNSTREAM (${result.downstream.length} callees):`);
    if (result.downstream.length === 0) {
      console.log('  (none - this is a leaf function)');
    } else {
      for (const d of result.downstream.slice(0, 15)) {
        console.log(`  -> ${d.name} @ ${d.file}:${d.line}`);
      }
      if (result.downstream.length > 15) {
        console.log(`  ... and ${result.downstream.length - 15} more`);
      }
    }

    console.log(`\nFILES AFFECTED: ${result.files.length}`);
    for (const f of result.files.slice(0, 10)) {
      console.log(`  ${f}`);
    }
    if (result.files.length > 10) {
      console.log(`  ... and ${result.files.length - 10} more`);
    }

    console.log('\n' + '='.repeat(60));

    // Risk assessment
    const totalImpact = result.upstream.length + result.downstream.length;
    let risk = 'LOW';
    if (totalImpact > 20 || result.files.length > 5) risk = 'HIGH';
    else if (totalImpact > 10 || result.files.length > 3) risk = 'MEDIUM';

    console.log(`RISK LEVEL: ${risk}`);
    console.log(`Total impact: ${totalImpact} functions across ${result.files.length} files`);
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Save call graph to cache
   */
  _saveCache() {
    const data = {
      timestamp: Date.now(),
      callGraph: Array.from(this.callGraph.entries()),
      fileIndex: Array.from(this.fileIndex.entries()),
      nameIndex: Array.from(this.nameIndex.entries())
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
    console.log(`Cache saved to ${CACHE_FILE}`);
  }

  /**
   * Load call graph from cache
   */
  loadCache() {
    if (!fs.existsSync(CACHE_FILE)) {
      return false;
    }

    try {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));

      // Check if cache is stale (> 1 hour)
      const age = Date.now() - data.timestamp;
      if (age > 60 * 60 * 1000) {
        console.log('Cache is stale, rebuilding...');
        return false;
      }

      this.callGraph = new Map(data.callGraph);
      this.fileIndex = new Map(data.fileIndex);
      this.nameIndex = new Map(data.nameIndex);

      console.log(`Loaded ${this.callGraph.size} functions from cache`);
      return true;
    } catch (err) {
      console.error('Failed to load cache:', err.message);
      return false;
    }
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Usage:
  node bombardier.js <file>:<line>     Show blast radius for function at location
  node bombardier.js <functionName>    Show blast radius for function by name
  node bombardier.js --build           Rebuild the call graph cache
  node bombardier.js --stats           Show graph statistics
`);
    process.exit(0);
  }

  const bombardier = new Bombardier();

  // Build or load cache
  if (args[0] === '--build') {
    await bombardier.buildGraph();
    process.exit(0);
  }

  if (!bombardier.loadCache()) {
    await bombardier.buildGraph();
  }

  if (args[0] === '--stats') {
    console.log(`\nCall Graph Statistics:`);
    console.log(`  Functions: ${bombardier.callGraph.size}`);
    console.log(`  Files: ${bombardier.fileIndex.size}`);
    console.log(`  Unique names: ${bombardier.nameIndex.size}`);
    process.exit(0);
  }

  // Parse input
  const input = args[0];
  let file = null;
  let line = null;
  let funcName = null;

  if (input.includes(':')) {
    const parts = input.split(':');
    file = parts[0];
    line = parseInt(parts[1], 10);
  } else {
    funcName = input;
  }

  // Get blast radius
  const result = file
    ? bombardier.getBlastRadius(file, line)
    : bombardier.getBlastRadius(funcName);

  bombardier.printBlastRadius(result);
}

// Export for programmatic use
module.exports = { Bombardier };

// Run CLI if called directly
if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
