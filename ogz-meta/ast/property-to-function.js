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
      // Guard: only process if we have valid property and object
      if (!node.property || !node.object) {
        this.traverse(p);
        return;
      }
      const propName = node.property.name;
      const funcName = PROPERTY_MAP[propName];
      if (node.property.type === 'Identifier' && funcName && !node.computed) {
        const parent = p.parentPath && p.parentPath.node;
        if (parent && parent.type === 'CallExpression' && parent.callee.type === 'Identifier'
            && parent.callee.name === funcName) {
          return false;
        }
        // Guard: skip if object is not a valid node (could be destructuring, etc.)
        if (!node.object.type) {
          this.traverse(p);
          return;
        }
        // Guard: ensure funcName is defined (should always be true due to check above, but be safe)
        if (!funcName) {
          this.traverse(p);
          return;
        }
        try {
          const call = b.callExpression(b.identifier(funcName), [node.object]);
          p.replace(call);
          count++;
        } catch (e) {
          console.warn(`Skipping replacement at ${node.loc?.start?.line || '?'}: ${e.message}`);
        }
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
