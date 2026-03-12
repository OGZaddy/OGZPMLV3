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

        // GUARD: Skip assignment targets - can't transform `obj.c = value` to `_c(obj) = value`
        // This catches both AssignmentExpression and compound assignments (+=, -=, etc.)
        if (
          parent &&
          parent.type === 'AssignmentExpression' &&
          parent.left === node
        ) {
          this.traverse(p);
          return; // Don't transform assignment targets
        }

        // GUARD: Skip UpdateExpression targets (++, --)
        if (
          parent &&
          parent.type === 'UpdateExpression' &&
          parent.argument === node
        ) {
          this.traverse(p);
          return; // Don't transform update targets
        }

        const helperName = PROPERTY_MAP[node.property.name];
        const call = b.callExpression(b.identifier(helperName), [node.object]);

        // recast preserves comments automatically during AST transformation
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
