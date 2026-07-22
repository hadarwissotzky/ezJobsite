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
const files = [];
const walk = (p) => {
  const s = statSync(p, { throwIfNoEntry: false });
  if (!s) return;
  if (s.isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  else if (/\.(ts|tsx|sql|html|mjs)$/.test(p)) files.push(p);
};
roots.forEach(walk);
const text = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
const code = [...text.values()].join('\n');

// ── which of those files can the APP actually reach? ─────────────────────────
// A TAG IN AN UNREACHABLE FILE IS NOT A TRACE. src/timeline.ts carries REQ-TL1/2/3
// and is imported by nothing — the table it defines is never even created — so this
// script reported 42-of-43 while the walkthrough-structure feature did not exist.
// That is worse than an undercount: 42-of-43 gets quoted in a progress doc.
//
// SQL, web and script files are treated as reachable: they are applied or served
// wholesale, and reachability there is a different question (verify.mjs asks it).
// This only walks import edges from App.tsx, where the question is answerable.
const reachable = new Set();
{
  const resolve = (from, rel) => {
    const base = join(from.replace(/\/[^/]+$/, ''), rel);
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
      if (text.has(base + ext)) return base + ext;
    }
    return null;
  };
  const stack = ['apps/mobile/App.tsx'];
  while (stack.length) {
    const f = stack.pop();
    if (!f || reachable.has(f) || !text.has(f)) continue;
    reachable.add(f);
    for (const m of text.get(f).matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const r = resolve(f, m[1]);
      if (r && !reachable.has(r)) stack.push(r);
    }
  }
}
const isTs = (f) => /^apps\/mobile\/(src|App)/.test(f);
/** A requirement traces only if a tag sits somewhere the app can actually get to. */
const tracedIn = (r) => files.filter((f) => text.get(f).includes(r));
const liveTrace = (r) => tracedIn(r).some((f) => !isTs(f) || reachable.has(f));

const traced = reqs.filter(liveTrace);
const untraced = reqs.filter((r) => !code.includes(r));
const orphanTagged = reqs.filter((r) => code.includes(r) && !liveTrace(r));

console.log(`SPEC: ${reqs.length} requirements\n`);
console.log(`TRACED TO CODE (${traced.length}):`);
console.log('  ' + traced.join('  '));
console.log(`\nNOT TRACED (${untraced.length}) — each is EITHER unbuilt OR built-and-untagged.`);
console.log('  ' + untraced.join('  '));
if (orphanTagged.length) {
  console.log(`\nTAGGED BUT UNREACHABLE (${orphanTagged.length}) — the tag exists in a`);
  console.log(`module nothing imports, so the requirement does NOT work today:`);
  for (const r of orphanTagged) {
    console.log(`  ${r}  ->  ${tracedIn(r).join(', ')}`);
  }
}

console.log(`\nThis is a tag count, not a score. Two ways it misleads, both seen here:`);
console.log(`  REQ-PROC2 sat in NOT TRACED while being fully built and proven.`);
console.log(`  REQ-TL1/2/3 sat in TRACED while living in a module nothing imports.`);
console.log(`The second is why this now walks imports from App.tsx before believing a tag.`);
