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

    // File -> Set of exported function names (for dynamic export detection)
    this.exports = new Map();
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

    // Track exports for this file
    const fileExports = new Set();

    // Walk the tree
    this._walkTree(tree.rootNode, relativePath, code, fileFunctions, null, fileExports);

    // Also detect exports via regex for patterns tree-sitter might miss
    this._detectExportsRegex(code, fileExports);

    this.fileIndex.set(relativePath, fileFunctions);
    this.exports.set(relativePath, fileExports);
  }

  /**
   * Detect exports using regex (catches edge cases)
   */
  _detectExportsRegex(code, fileExports) {
    // module.exports = { func1, func2, ... }
    const objExportMatch = code.match(/module\.exports\s*=\s*\{([^}]+)\}/g);
    if (objExportMatch) {
      objExportMatch.forEach(match => {
        // Extract function names from { func1, func2, key: func3 }
        const inner = match.match(/\{([^}]+)\}/)?.[1] || '';
        const names = inner.split(',').map(s => {
          // Handle both "funcName" and "key: funcName"
          const parts = s.split(':');
          return (parts[parts.length - 1] || '').trim();
        }).filter(n => n && !n.includes('('));
        names.forEach(n => fileExports.add(n));
      });
    }

    // module.exports = functionName
    const singleExportMatch = code.match(/module\.exports\s*=\s*(\w+)\s*[;\n]/g);
    if (singleExportMatch) {
      singleExportMatch.forEach(match => {
        const name = match.match(/module\.exports\s*=\s*(\w+)/)?.[1];
        if (name && name !== 'class' && name !== 'function') {
          fileExports.add(name);
        }
      });
    }

    // exports.funcName = ... or module.exports.funcName = ...
    const namedExportMatches = code.matchAll(/(?:module\.)?exports\.(\w+)\s*=/g);
    for (const match of namedExportMatches) {
      fileExports.add(match[1]);
    }

    // Dynamic routing patterns: { '/command': handler, ... }
    const routeMatches = code.matchAll(/['"]\/\w+['"]\s*:\s*(\w+)/g);
    for (const match of routeMatches) {
      fileExports.add(match[1]);
    }

    // Object patterns like: const handlers = { func1, func2 }
    const handlerMatches = code.matchAll(/(?:handlers|routes|commands|ROUTES|COMMANDS)\s*=\s*\{([^}]+)\}/g);
    for (const match of handlerMatches) {
      const names = match[1].split(',').map(s => s.split(':').pop().trim()).filter(n => n && /^\w+$/.test(n));
      names.forEach(n => fileExports.add(n));
    }
  }

  /**
   * Recursively walk the AST
   */
  _walkTree(node, file, code, fileFunctions, parentFunction = null, fileExports = new Set()) {
    // Function declarations
    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const funcInfo = this._registerFunction(file, node, nameNode.text, code);
        fileFunctions.push(funcInfo.id);

        // Walk body with this as parent
        const body = node.childForFieldName('body');
        if (body) {
          this._walkTree(body, file, code, fileFunctions, funcInfo, fileExports);
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
          this._walkTree(body, file, code, fileFunctions, funcInfo, fileExports);
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
          this._walkTree(body, file, code, fileFunctions, funcInfo, fileExports);
        }
        return;
      }
    }

    // Detect module.exports assignments
    if (node.type === 'assignment_expression') {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (left && this._isModuleExports(left)) {
        this._extractExportedNames(right, fileExports);
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

      // Detect dynamic calls: obj[key]() or handlers[name]()
      if (funcNode && funcNode.type === 'subscript_expression') {
        // Mark the object's functions as potentially called
        const obj = funcNode.childForFieldName('object');
        if (obj) {
          const objName = obj.text;
          // These are dynamically dispatched - can't track statically
          // But we note the pattern exists
        }
      }
    }

    // Recurse into children
    for (let i = 0; i < node.childCount; i++) {
      this._walkTree(node.child(i), file, code, fileFunctions, parentFunction, fileExports);
    }
  }

  /**
   * Check if node is module.exports or exports
   */
  _isModuleExports(node) {
    const text = node.text || '';
    return text === 'module.exports' || text === 'exports' || text.startsWith('module.exports.');
  }

  /**
   * Extract exported function names from right side of module.exports = ...
   */
  _extractExportedNames(node, fileExports) {
    if (!node) return;

    // module.exports = functionName
    if (node.type === 'identifier') {
      fileExports.add(node.text);
      return;
    }

    // module.exports = { func1, func2, key: func3 }
    if (node.type === 'object') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'pair') {
          // key: value
          const value = child.childForFieldName('value');
          if (value && value.type === 'identifier') {
            fileExports.add(value.text);
          }
          const key = child.childForFieldName('key');
          if (key) {
            fileExports.add(key.text);
          }
        } else if (child.type === 'shorthand_property_identifier') {
          // { funcName } shorthand
          fileExports.add(child.text);
        }
      }
    }

    // module.exports = class/function
    if (node.type === 'class' || node.type === 'function') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        fileExports.add(nameNode.text);
      }
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

  /**
   * Find orphan functions (never called by anyone)
   */
  findOrphans(options = {}) {
    const {
      excludeEntryPoints = true,
      minSize = 3,
      excludePaths = true,  // Exclude worktrees, archive, test files
      coreOnly = false      // Only show core/ and modules/ orphans
    } = options;

    // Paths to exclude (false positives)
    const excludePathPatterns = [
      '.claude/worktrees/',
      'archive/',
      'node_modules/',
      'test/',
      'tests/',
      '__tests__/',
      '.backup',
      'backup-',
      'prodlock-portable/'
    ];

    // Known entry points that are legitimately uncalled
    const entryPointPatterns = [
      'main', 'start', 'init', 'setup', 'run', 'execute',
      'constructor', 'render', 'componentDidMount', 'useEffect',
      'module.exports', 'exports', 'default'
    ];

    const orphans = [];
    const entryPoints = [];
    const excluded = { paths: 0, entryPoints: 0, exported: 0, classMethod: 0 };

    for (const [id, func] of this.callGraph) {
      // Skip if it has callers
      if (func.calledBy.length > 0) continue;

      // Skip excluded paths
      if (excludePaths && excludePathPatterns.some(p => func.file.includes(p))) {
        excluded.paths++;
        continue;
      }

      // Core only filter
      if (coreOnly && !func.file.startsWith('core/') && !func.file.startsWith('modules/')) {
        continue;
      }

      // Check if it's an entry point
      const isEntryPoint = entryPointPatterns.some(p =>
        func.name.toLowerCase().includes(p.toLowerCase())
      );

      // Check if it's exported (appears in module.exports context)
      const isExported = func.file && this._isExportedFunction(func);

      // Check if it's a class method (likely called via this.methodName)
      const isClassMethod = this._isLikelyClassMethod(func);

      if (isEntryPoint) {
        excluded.entryPoints++;
        if (!excludeEntryPoints) entryPoints.push(func);
        continue;
      }

      if (isExported) {
        excluded.exported++;
        continue;
      }

      if (isClassMethod) {
        excluded.classMethod++;
        continue;
      }

      // Skip tiny functions (likely helpers)
      const size = func.endLine - func.line;
      if (size < minSize) continue;

      orphans.push({
        name: func.name,
        file: func.file,
        line: func.line,
        size: size,
        calls: func.calls.length
      });
    }

    // Sort by size (biggest orphans first - most code to review)
    orphans.sort((a, b) => b.size - a.size);

    return { orphans, entryPoints, excluded };
  }

  /**
   * Check if function is likely a class method called via this.
   */
  _isLikelyClassMethod(func) {
    // Check if this function name is called via this. anywhere in the same file
    const fileFunctions = this.fileIndex.get(func.file) || [];

    for (const funcId of fileFunctions) {
      const otherFunc = this.callGraph.get(funcId);
      if (!otherFunc || otherFunc.id === func.id) continue;

      // Check if any call in otherFunc matches this.funcName
      for (const call of otherFunc.calls || []) {
        if (call.name === `this.${func.name}` || call.name === func.name) {
          return true;
        }
      }
    }

    // Common class method patterns
    const classMethodPatterns = [
      /^_/,           // Private methods like _helper
      /^#/,           // Private fields
      /Callback$/,    // Callbacks
      /^on[A-Z]/,     // Event handlers
      /^handle[A-Z]/, // Event handlers
      /^render/,      // Render methods
      /^update/,      // Update methods
      /^process/,     // Processing methods
      /^calculate/,   // Calculation methods
      /^validate/,    // Validation methods
      /^parse/,       // Parsing methods
      /^format/,      // Formatting methods
      /^build/,       // Builder methods
      /^create/,      // Factory methods
      /^load/,        // Loading methods
      /^save/,        // Saving methods
      /^fetch/,       // Fetching methods
      /^send/,        // Sending methods
      /^emit/,        // Event emitting
      /^broadcast/,   // Broadcasting
      /^notify/,      // Notifications
      /^log/,         // Logging
      /^debug/,       // Debugging
      /^trace/,       // Tracing
      /^check/,       // Checking methods
      /^verify/,      // Verification methods
      /^assert/,      // Assertions
      /^ensure/,      // Ensuring methods
      /^apply/,       // Application methods
      /^execute/,     // Execution methods
      /^invoke/,      // Invocation methods
      /^dispatch/,    // Dispatching methods
      /^route/,       // Routing methods
      /^register/,    // Registration methods
      /^subscribe/,   // Subscription methods
      /^unsubscribe/, // Unsubscription methods
      /^add/,         // Adding methods
      /^remove/,      // Removing methods
      /^delete/,      // Deletion methods
      /^clear/,       // Clearing methods
      /^reset/,       // Reset methods
      /^cleanup/,     // Cleanup methods
      /^destroy/,     // Destruction methods
      /^dispose/,     // Disposal methods
      /^close/,       // Closing methods
      /^open/,        // Opening methods
      /^connect/,     // Connection methods
      /^disconnect/,  // Disconnection methods
    ];

    return classMethodPatterns.some(p => p.test(func.name));
  }

  /**
   * Check if function is likely exported or dynamically called
   */
  _isExportedFunction(func) {
    // 1. Check explicit exports map
    const fileExports = this.exports.get(func.file);
    if (fileExports && fileExports.has(func.name)) {
      return true;
    }

    // 2. Common export/handler patterns
    const exportPatterns = ['Handler', 'Controller', 'Middleware', 'Router', 'API', 'Service', 'Manager'];
    if (exportPatterns.some(p => func.name.includes(p))) {
      return true;
    }

    // 3. Event handlers (on*, handle*)
    if (/^on[A-Z]|^handle[A-Z]/.test(func.name)) {
      return true;
    }

    // 4. Lifecycle methods
    const lifecycleMethods = ['constructor', 'init', 'setup', 'destroy', 'cleanup', 'reset', 'start', 'stop'];
    if (lifecycleMethods.includes(func.name.toLowerCase())) {
      return true;
    }

    // 5. Getter/setter patterns
    if (/^get[A-Z]|^set[A-Z]|^is[A-Z]|^has[A-Z]/.test(func.name)) {
      return true;
    }

    // 6. Common callback names
    const callbackNames = ['callback', 'cb', 'done', 'next', 'resolve', 'reject', 'then', 'catch'];
    if (callbackNames.includes(func.name.toLowerCase())) {
      return true;
    }

    // 7. Test functions
    if (/^test|^spec|^it$|^describe$|^before|^after/.test(func.name.toLowerCase())) {
      return true;
    }

    return false;
  }

  /**
   * Print orphan report
   */
  printOrphans(result) {
    console.log('\n' + '='.repeat(60));
    console.log('ORPHAN DETECTION REPORT');
    console.log('='.repeat(60));

    // Show exclusion stats if available
    if (result.excluded) {
      console.log('\n📊 Exclusions (false positives filtered):');
      console.log(`   Excluded paths (archive/worktrees): ${result.excluded.paths}`);
      console.log(`   Entry points:                       ${result.excluded.entryPoints}`);
      console.log(`   Exported functions:                 ${result.excluded.exported}`);
      console.log(`   Class methods:                      ${result.excluded.classMethod}`);
      const total = Object.values(result.excluded).reduce((a, b) => a + b, 0);
      console.log(`   ─────────────────────────────────────`);
      console.log(`   Total filtered:                     ${total}`);
    }

    if (result.orphans.length === 0) {
      console.log('\n✅ No orphan functions detected!');
      console.log('All functions are either called or are entry points.\n');
      return;
    }

    console.log(`\n⚠️  Found ${result.orphans.length} potential orphan functions:\n`);

    // Group by file
    const byFile = {};
    for (const orphan of result.orphans) {
      if (!byFile[orphan.file]) byFile[orphan.file] = [];
      byFile[orphan.file].push(orphan);
    }

    for (const [file, funcs] of Object.entries(byFile)) {
      console.log(`📁 ${file}:`);
      for (const f of funcs) {
        console.log(`   └─ ${f.name} (line ${f.line}, ${f.size} lines, calls ${f.calls} funcs)`);
      }
    }

    console.log('\n' + '-'.repeat(60));
    console.log('SUMMARY:');
    console.log(`  Total orphans: ${result.orphans.length}`);
    console.log(`  Total lines:   ${result.orphans.reduce((sum, o) => sum + o.size, 0)}`);
    console.log(`  Files affected: ${Object.keys(byFile).length}`);
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Generate call graph for a function (upstream + downstream)
   */
  getCallGraph(funcName, depth = 3) {
    const funcIds = this.nameIndex.get(funcName) || [];
    if (funcIds.length === 0) {
      return { found: false, name: funcName };
    }

    const nodes = new Map();  // id -> { name, file, line, type }
    const edges = [];         // { from, to, type }

    // BFS to build graph
    const visited = new Set();
    const queue = [];

    // Start with target functions
    for (const id of funcIds) {
      const func = this.callGraph.get(id);
      if (func) {
        nodes.set(id, {
          name: func.name,
          file: func.file,
          line: func.line,
          type: 'target'
        });
        queue.push({ id, depth: 0, direction: 'both' });
      }
    }

    while (queue.length > 0) {
      const { id, depth: currentDepth, direction } = queue.shift();

      if (visited.has(id + direction) || currentDepth >= depth) continue;
      visited.add(id + direction);

      const func = this.callGraph.get(id);
      if (!func) continue;

      // Upstream (callers)
      if (direction === 'both' || direction === 'up') {
        for (const callerId of func.calledBy) {
          const caller = this.callGraph.get(callerId);
          if (caller) {
            if (!nodes.has(callerId)) {
              nodes.set(callerId, {
                name: caller.name,
                file: caller.file,
                line: caller.line,
                type: 'upstream'
              });
            }
            edges.push({ from: callerId, to: id, type: 'calls' });
            queue.push({ id: callerId, depth: currentDepth + 1, direction: 'up' });
          }
        }
      }

      // Downstream (callees)
      if (direction === 'both' || direction === 'down') {
        for (const call of func.calls) {
          const targetIds = this.nameIndex.get(call.name) || [];
          for (const targetId of targetIds) {
            const target = this.callGraph.get(targetId);
            if (target && targetId !== id) {
              if (!nodes.has(targetId)) {
                nodes.set(targetId, {
                  name: target.name,
                  file: target.file,
                  line: target.line,
                  type: 'downstream'
                });
              }
              edges.push({ from: id, to: targetId, type: 'calls' });
              queue.push({ id: targetId, depth: currentDepth + 1, direction: 'down' });
            }
          }
        }
      }
    }

    return {
      found: true,
      name: funcName,
      nodes: Array.from(nodes.entries()).map(([id, data]) => ({ id, ...data })),
      edges
    };
  }

  /**
   * Generate Mermaid diagram from call graph
   */
  toMermaid(graphResult, options = {}) {
    if (!graphResult.found) {
      return `%% No function found: ${graphResult.name}`;
    }

    const { direction = 'TB', maxNodes = 50 } = options;

    let mermaid = `flowchart ${direction}\n`;
    mermaid += `  %% Call graph for: ${graphResult.name}\n`;
    mermaid += `  %% Generated by bombardier.js\n\n`;

    // Limit nodes if too many
    const nodes = graphResult.nodes.slice(0, maxNodes);
    const nodeIds = new Set(nodes.map(n => n.id));

    // Style definitions
    mermaid += `  classDef target fill:#f96,stroke:#333,stroke-width:3px\n`;
    mermaid += `  classDef upstream fill:#6cf,stroke:#333,stroke-width:1px\n`;
    mermaid += `  classDef downstream fill:#9f6,stroke:#333,stroke-width:1px\n\n`;

    // Create node definitions with sanitized IDs
    const idMap = new Map();
    nodes.forEach((node, i) => {
      const safeId = `n${i}`;
      idMap.set(node.id, safeId);
      const shortFile = node.file.split('/').pop();
      mermaid += `  ${safeId}["${node.name}<br/><small>${shortFile}:${node.line}</small>"]\n`;
    });

    mermaid += '\n';

    // Create edges
    for (const edge of graphResult.edges) {
      const fromId = idMap.get(edge.from);
      const toId = idMap.get(edge.to);
      if (fromId && toId) {
        mermaid += `  ${fromId} --> ${toId}\n`;
      }
    }

    mermaid += '\n';

    // Apply styles
    for (const node of nodes) {
      const safeId = idMap.get(node.id);
      mermaid += `  class ${safeId} ${node.type}\n`;
    }

    if (graphResult.nodes.length > maxNodes) {
      mermaid += `\n  %% Note: Showing ${maxNodes} of ${graphResult.nodes.length} nodes\n`;
    }

    return mermaid;
  }

  /**
   * Print call graph as text
   */
  printCallGraph(result) {
    if (!result.found) {
      console.log(`\nNo function found: ${result.name}`);
      return;
    }

    console.log('\n' + '='.repeat(60));
    console.log(`CALL GRAPH: ${result.name}`);
    console.log('='.repeat(60));

    // Separate by type
    const targets = result.nodes.filter(n => n.type === 'target');
    const upstream = result.nodes.filter(n => n.type === 'upstream');
    const downstream = result.nodes.filter(n => n.type === 'downstream');

    console.log(`\n📍 TARGET (${targets.length}):`);
    for (const t of targets) {
      console.log(`   ${t.name} @ ${t.file}:${t.line}`);
    }

    console.log(`\n⬆️  UPSTREAM/CALLERS (${upstream.length}):`);
    for (const u of upstream.slice(0, 20)) {
      console.log(`   ${u.name} @ ${u.file}:${u.line}`);
    }
    if (upstream.length > 20) {
      console.log(`   ... and ${upstream.length - 20} more`);
    }

    console.log(`\n⬇️  DOWNSTREAM/CALLEES (${downstream.length}):`);
    for (const d of downstream.slice(0, 20)) {
      console.log(`   ${d.name} @ ${d.file}:${d.line}`);
    }
    if (downstream.length > 20) {
      console.log(`   ... and ${downstream.length - 20} more`);
    }

    console.log(`\n📊 EDGES: ${result.edges.length} call relationships`);
    console.log('='.repeat(60) + '\n');
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
  node bombardier.js --orphans         Find dead/uncalled functions
  node bombardier.js --orphans --core  Only show core/ and modules/ orphans
  node bombardier.js --orphans --all   Include archive/worktrees (all false positives)
  node bombardier.js --callgraph <fn>  Show call graph for function
  node bombardier.js --mermaid <fn>    Generate Mermaid diagram for function
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

  // Orphan detection
  if (args[0] === '--orphans') {
    const coreOnly = args.includes('--core');
    const includeAll = args.includes('--all');
    const result = bombardier.findOrphans({
      coreOnly: coreOnly,
      excludePaths: !includeAll
    });
    bombardier.printOrphans(result);
    process.exit(0);
  }

  // Call graph
  if (args[0] === '--callgraph') {
    const funcName = args[1];
    if (!funcName) {
      console.error('Usage: --callgraph <functionName>');
      process.exit(1);
    }
    const depth = parseInt(args[2]) || 3;
    const result = bombardier.getCallGraph(funcName, depth);
    bombardier.printCallGraph(result);
    process.exit(0);
  }

  // Mermaid diagram
  if (args[0] === '--mermaid') {
    const funcName = args[1];
    if (!funcName) {
      console.error('Usage: --mermaid <functionName>');
      process.exit(1);
    }
    const depth = parseInt(args[2]) || 3;
    const result = bombardier.getCallGraph(funcName, depth);
    const mermaid = bombardier.toMermaid(result);
    console.log(mermaid);

    // Also save to file
    const outFile = path.join(__dirname, `callgraph-${funcName}.mmd`);
    fs.writeFileSync(outFile, mermaid);
    console.error(`\nSaved to: ${outFile}`);
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
