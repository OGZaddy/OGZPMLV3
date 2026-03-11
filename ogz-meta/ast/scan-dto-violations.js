#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const recast = require('recast');
const parser = require('recast/parsers/babel');

const VIOLATIONS = [];

function scanFile(filePath) {
  let src;
  try {
    src = fs.readFileSync(path.resolve(filePath), 'utf8');
  } catch (e) {
    console.error(`Cannot read ${filePath}: ${e.message}`);
    return;
  }

  let ast;
  try {
    ast = recast.parse(src, { parser });
  } catch (e) {
    console.error(`Cannot parse ${filePath}: ${e.message}`);
    return;
  }

  recast.visit(ast, {
    visitMemberExpression(p) {
      const node = p.node;
      // Check for indicators.indicators pattern
      if (node.property.type === 'Identifier' && node.property.name === 'indicators' &&
          node.object.type === 'MemberExpression' &&
          node.object.property.type === 'Identifier' && node.object.property.name === 'indicators') {
        VIOLATIONS.push({
          file: filePath,
          line: node.loc ? node.loc.start.line : '?',
          pattern: 'indicators.indicators',
        });
      }
      // Check for c.c, c.o, c.h, c.l, c.v direct access (not inside _c() etc)
      if (node.property.type === 'Identifier' && ['c', 'o', 'h', 'l', 'v'].includes(node.property.name) && !node.computed) {
        const parent = p.parentPath && p.parentPath.node;
        const isWrapped = parent && parent.type === 'CallExpression' &&
          parent.callee.type === 'Identifier' && parent.callee.name.startsWith('_');
        if (!isWrapped && node.object.type === 'Identifier') {
          // Heuristic: if object name suggests it's a candle
          const objName = node.object.name.toLowerCase();
          if (objName.includes('candle') || objName === 'c' || objName === 'bar' || objName === 'ohlc') {
            VIOLATIONS.push({
              file: filePath,
              line: node.loc ? node.loc.start.line : '?',
              pattern: `${node.object.name}.${node.property.name}`,
            });
          }
        }
      }
      this.traverse(p);
    },
  });
}

function scanDir(dir, extensions = ['.js']) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      scanDir(fullPath, extensions);
    } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
      scanFile(fullPath);
    }
  }
}

// Main
const args = process.argv.slice(2);
const targets = args.length ? args : ['core', 'modules'];

for (const target of targets) {
  if (fs.statSync(target).isDirectory()) {
    scanDir(target);
  } else {
    scanFile(target);
  }
}

if (VIOLATIONS.length) {
  console.log('\n❌ DTO VIOLATIONS FOUND:\n');
  for (const v of VIOLATIONS) {
    console.log(`  ${v.file}:${v.line} - ${v.pattern}`);
  }
  console.log(`\nTotal: ${VIOLATIONS.length} violation(s)`);
  process.exit(1);
} else {
  console.log('✅ No DTO violations found');
  process.exit(0);
}
