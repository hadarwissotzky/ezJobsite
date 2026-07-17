#!/usr/bin/env node
/**
 * Is any function, view or trigger defined in more than one SQL file?
 *
 * WHY THIS EXISTS: bundle_limitations() was defined in BOTH 080_dispute_bundle.sql
 * and 090_corroboration.sql. 090 rewrote it with an extra limitation that REQ-TL5
 * demands; re-running 080 SILENTLY REVERTED IT. Nothing failed — `create or
 * replace` is a replace, not a merge — and the dispute bundle went back to
 * OVERCLAIMING what it could prove. I caught it by counting array elements. That
 * is not a way to catch things.
 *
 * The files are applied by hand and by number, so "whichever ran last wins" is the
 * actual semantics, and the loser is invisible. This makes the collision loud.
 *
 * A duplicate is not always wrong — a file may legitimately rebuild an object it
 * owns. What is wrong is TWO FILES OWNING ONE OBJECT, because then the object's
 * definition depends on the order someone happened to run them in.
 *
 * Run: node scripts/check-sql-duplicates.mjs apps/mobile/sql
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'apps/mobile/sql';
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

/** name -> Set(files that CREATE it) */
const owners = new Map();

const patterns = [
  // create [or replace] function public.name(
  [/create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(/gi, 'function'],
  [/create\s+(?:or\s+replace\s+)?view\s+([\w.]+)/gi, 'view'],
  [/create\s+trigger\s+([\w.]+)/gi, 'trigger'],
  [/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)/gi, 'table'],
];

for (const f of files) {
  const sql = readFileSync(join(dir, f), 'utf8')
    // strip line comments so a name mentioned in prose is not a definition
    .replace(/--[^\n]*/g, '');
  for (const [re, kind] of patterns) {
    for (const m of sql.matchAll(re)) {
      const key = `${kind} ${m[1].toLowerCase()}`;
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(f);
    }
  }
}

let bad = 0;
for (const [key, fs] of [...owners].sort()) {
  if (fs.size > 1) {
    console.log(`FATAL  ${key}`);
    console.log(`       defined in: ${[...fs].join(', ')}`);
    console.log(`       -> whichever file runs LAST wins, silently. One object, one file.`);
    bad++;
  }
}

// `alter table ... add column if not exists` is fine in many files -- that is
// additive and idempotent. Only CREATE is exclusive, which is why alter is not
// checked above.
console.log(`\n${files.length} files, ${owners.size} objects, ${bad} owned by more than one file`);
if (bad) {
  console.log('A duplicate means an object\'s definition depends on the order someone');
  console.log('happened to run the files in. That is how the bundle silently lost a');
  console.log('limitation and went back to overclaiming.');
  process.exit(1);
}
