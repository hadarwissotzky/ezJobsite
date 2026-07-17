#!/usr/bin/env node
/**
 * Which requirements trace to code? — CLAUDE.md §3: "Trace everything. Every
 * requirement must trace to a research finding or a logged human decision. If you
 * can't trace it, flag it as an assumption."
 *
 * A tag is not proof a requirement WORKS. It proves someone knew which requirement
 * they were building, and it makes the gap between "I think that's done" and "the
 * code says so" visible. My own audit early in this session counted REQ-PROC2 as
 * missing when it was built — the TAG was the gap, not the behaviour. That cuts
 * both ways, which is why this prints both lists and neither is a score.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const spec = readFileSync('docs/SPEC-capture-core-v1.md', 'utf8');
const reqs = [...new Set([...spec.matchAll(/\*\*(REQ-[A-Z]+\d+)\s+—/g)].map((m) => m[1]))].sort();

const roots = ['apps/mobile/src', 'apps/mobile/App.tsx', 'apps/mobile/sql', 'apps/web', 'scripts'];
let code = '';
const walk = (p) => {
  const s = statSync(p, { throwIfNoEntry: false });
  if (!s) return;
  if (s.isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  else if (/\.(ts|tsx|sql|html|mjs)$/.test(p)) code += readFileSync(p, 'utf8');
};
roots.forEach(walk);

const traced = reqs.filter((r) => code.includes(r));
const untraced = reqs.filter((r) => !code.includes(r));

console.log(`SPEC: ${reqs.length} requirements\n`);
console.log(`TRACED TO CODE (${traced.length}):`);
console.log('  ' + traced.join('  '));
console.log(`\nNOT TRACED (${untraced.length}) — each is EITHER unbuilt OR built-and-untagged.`);
console.log('  ' + untraced.join('  '));
console.log(`\nThis is a tag count, not a score. Check before you build:`);
console.log(`REQ-PROC2 sat in this list while being fully built and proven.`);
