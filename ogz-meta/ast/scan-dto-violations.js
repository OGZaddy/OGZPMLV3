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
