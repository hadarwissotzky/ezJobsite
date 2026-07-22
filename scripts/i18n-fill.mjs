#!/usr/bin/env node
/**
 * Add i18n keys that the code now references but i18n.ts does not define, pulling
 * the translations from a JSON file of {EN:{k:v}, ES:{k:v}} literals.
 *
 * WHY: 61 modules were written by parallel agents that were barred from editing
 * i18n.ts (two agents in one file collide), so they returned their strings instead.
 * Wiring a module makes its keys referenced, and `npm run verify` then fails the
 * i18n coverage check. Doing that reconciliation by hand once per requirement is
 * nine chances to fumble a quote.
 *
 * IT ONLY ADDS PAIRS. A key present in one language and missing in the other is
 * skipped and reported, never half-applied: t() falls back to the key name, so a
 * half-applied pair ships English text to a Spanish reader with no error anywhere.
 * Mandate #5 is per-user display language, not English with gaps.
 *
 * It never overwrites an existing key. If i18n.ts already defines it, the file on
 * disk wins -- a hand-written translation is worth more than a recovered one.
 *
 * Usage: node scripts/i18n-fill.mjs <parsed.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const I18N = join(ROOT, 'apps/mobile/src/i18n.ts');
const src = process.argv[2];
if (!src) { console.error('usage: i18n-fill.mjs <parsed.json>'); process.exit(2); }

const { EN = {}, ES = {} } = JSON.parse(readFileSync(src, 'utf8'));
let i18n = readFileSync(I18N, 'utf8');

// Every non-test source file, the same three call shapes verify.mjs scans for.
const files = execFileSync('sh', ['-c',
  `find "${join(ROOT, 'apps/mobile/src')}" -name '*.ts' -o -name '*.tsx'; echo "${join(ROOT, 'apps/mobile/App.tsx')}"`],
  { encoding: 'utf8' }).split('\n').map((s) => s.trim())
  .filter((f) => f && !f.endsWith('.test.ts') && !f.endsWith('/i18n.ts'));

const refs = new Set();
for (const f of files) {
  let t; try { t = readFileSync(f, 'utf8'); } catch { continue; }
  for (const m of t.matchAll(/\b[tT]\(\s*['"]([a-z0-9]+\.[A-Za-z0-9_.]+)['"]/g)) refs.add(m[1]);
  for (const m of t.matchAll(/\bk:\s*['"]([a-z0-9]+\.[A-Za-z0-9_.]+)['"]/g)) refs.add(m[1]);
}

const undefinedKeys = [...refs].filter((k) => !i18n.includes(`'${k}'`)).sort();
const both = undefinedKeys.filter((k) => k in EN && k in ES);
const oneSided = undefinedKeys.filter((k) => (k in EN) !== (k in ES));
const unknown = undefinedKeys.filter((k) => !(k in EN) && !(k in ES));

if (both.length) {
  const EN_ANCHOR = "  'erec.noTime': 'time not recorded',\n";
  const ES_ANCHOR = "  'erec.noTime': 'sin hora registrada',\n";
  if (!i18n.includes(EN_ANCHOR) || !i18n.includes(ES_ANCHOR)) {
    console.error('anchor missing in i18n.ts — refusing to guess where to insert');
    process.exit(1);
  }
  i18n = i18n
    .replace(EN_ANCHOR, EN_ANCHOR + both.map((k) => `  '${k}': ${EN[k]},\n`).join(''))
    .replace(ES_ANCHOR, ES_ANCHOR + both.map((k) => `  '${k}': ${ES[k]},\n`).join(''));
  writeFileSync(I18N, i18n);
}

console.log(`added ${both.length} pair(s)`);
if (oneSided.length) {
  console.log(`SKIPPED ${oneSided.length} one-sided (needs a hand translation): ${oneSided.join(', ')}`);
}
if (unknown.length) {
  console.log(`STILL UNDEFINED ${unknown.length} (not in the recovered set): ${unknown.join(', ')}`);
}
process.exit(oneSided.length || unknown.length ? 1 : 0);
