/**
 * THE STATUS VOCABULARY LIVES IN FIVE PLACES. THIS IS WHAT MAKES THEM AGREE.
 *
 * Written 2026-08-24, after `cancelled` was added and the app refused the very act it
 * had just shipped: "illegal change order transition sent -> cancelled", raised by
 * `384_status_transition_guard.sql` — a PL/pgSQL trigger holding its OWN copy of the
 * transition table, which nothing compared to `LEGAL_TRANSITIONS`. The CHECK constraint
 * was widened, the device DDL was widened, `STORED_STATUSES` was widened, a test
 * asserted those three agreed, and the fourth copy sat there refusing every withdrawal
 * with nothing failing anywhere. hadar found it by tapping the button.
 *
 * The commit that shipped it claimed in its BLAST RADIUS that "THREE SCHEMAS had to move
 * together" and named the vocabulary test as the thing that makes forgetting one a test
 * failure. That was wrong twice over: there were four, and the named test compares a TS
 * array to a SQL string it does not read.
 *
 * So this file reads the actual files. It is deliberately not a nice abstraction — it
 * greps DDL and PL/pgSQL with regexes, which is ugly and which is the point: the
 * authority for what the database will accept is the file the database was given, not a
 * constant somebody remembered to update beside it.
 *
 * WHEN THIS FAILS, DO NOT EDIT THE EXPECTED VALUE. Every assertion here means two
 * definitions of one rule have drifted, and the fix is to move whichever one is behind.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STORED_STATUSES } from './extrastatus.ts';
import { LEGAL_TRANSITIONS } from './extralifecycle.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), 'utf8');

/**
 * Comments are not code, and this file learned that the hard way within a minute of
 * being written: `changeorder.ts`'s own migration note contains the sentence
 * "still holds `CHECK (status IN (... 'superseded'))`", and the parser dutifully read it
 * as a one-value constraint and failed. A test that greps source has to grep the source
 * and not the prose about it.
 *
 * Block comments and line comments, in that order — a `--` inside a `/* *\/` block is
 * already gone by the time the second pass runs.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

/**
 * Every `CHECK (status IN ('a','b',…))` in a blob of SQL or TS, as arrays of statuses.
 *
 * ANCHORED ON `CHECK`, not on `status IN`, and the difference is not pedantry: a bare
 * `status IN (…)` also matches ordinary query filters — `where co.status in
 * ('draft','sent')` — and the first version of this test read one of those and reported
 * that the device DDL only admitted two statuses. A filter is a question; a CHECK is the
 * rule. Only the rule belongs here.
 */
function statusChecks(sql: string): string[][] {
  const out: string[][] = [];
  const re = /CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/gi;
  for (const m of stripComments(sql).matchAll(re)) {
    const list = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    if (list.length) out.push(list);
  }
  return out;
}

test('030_change_order.sql accepts exactly the statuses the app can store', () => {
  const sql = read('../sql/030_change_order.sql');
  // The column's own CHECK — the first `status in (...)` in the table definition.
  const lists = statusChecks(sql);
  assert.ok(lists.length > 0, 'no status CHECK found in 030 — did the column move?');
  assert.deepEqual([...lists[0]].sort(), [...STORED_STATUSES].sort(),
    'the server CHECK and STORED_STATUSES disagree: one of them is behind');
});

test('the DEVICE DDL accepts exactly the same statuses — both copies of it', () => {
  const ts = read('./changeorder.ts');
  // changeorder.ts carries the CHECK twice: the live table and the rebuild used by
  // `allowCancelledStatus`. A rebuild that admits a different set from the table it
  // replaces is a migration that silently narrows the vocabulary.
  const lists = statusChecks(ts);
  assert.ok(lists.length >= 2,
    `expected the live table AND the rebuild to declare a status CHECK, found ${lists.length}`);
  for (const l of lists) {
    assert.deepEqual([...l].sort(), [...STORED_STATUSES].sort(),
      'a device-side CHECK disagrees with STORED_STATUSES');
  }
});

/**
 * THE ONE THAT WOULD HAVE CAUGHT IT.
 *
 * `change_order_transition_guard` is a BEFORE UPDATE trigger whose body is a chain of
 *   (old.status = 'X' and new.status in ('a','b'))
 * clauses. Parsed here and compared, pair for pair, with `LEGAL_TRANSITIONS`.
 */
function guardPairs(sql: string): Set<string> {
  const pairs = new Set<string>();
  const re = /\(\s*old\.status\s*=\s*'([a-z_]+)'\s+and\s+new\.status\s+in\s*\(([^)]*)\)\s*\)/gi;
  for (const m of sql.matchAll(re)) {
    for (const t of [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])) {
      pairs.add(`${m[1]}->${t}`);
    }
  }
  return pairs;
}

function appPairs(): Set<string> {
  const pairs = new Set<string>();
  for (const [from, tos] of Object.entries(LEGAL_TRANSITIONS)) {
    for (const to of tos) pairs.add(`${from}->${to}`);
  }
  return pairs;
}

test("the server's transition guard allows exactly what LEGAL_TRANSITIONS allows", () => {
  const server = guardPairs(stripComments(read('../sql/384_status_transition_guard.sql')));
  const app = appPairs();
  assert.ok(server.size > 0, 'no transition pairs parsed from 384 — did the guard move?');

  const onlyServer = [...server].filter((p) => !app.has(p));
  const onlyApp = [...app].filter((p) => !server.has(p));

  assert.deepEqual(onlyApp, [],
    'the app believes it may make a transition the server WILL REFUSE — this is the '
    + '"illegal change order transition" failure, caught before it reaches a contractor');
  assert.deepEqual(onlyServer, [],
    'the server permits a transition the app does not model — the guard is the last '
    + 'line and must not be looser than the rule it guards');
});

test('every terminal status is terminal on BOTH sides', () => {
  const server = guardPairs(stripComments(read('../sql/384_status_transition_guard.sql')));
  for (const [from, tos] of Object.entries(LEGAL_TRANSITIONS)) {
    if (tos.length) continue;
    const escapes = [...server].filter((p) => p.startsWith(`${from}->`));
    assert.deepEqual(escapes, [],
      `${from} is sealed in the app but the server would let it move — that empty `
      + 'array IS the seal (REQ-LC30), and a seal enforced on one side only is not one');
  }
});

/**
 * A WITHDRAWN LINK IS NOT A LIVE LINK.
 *
 * The second thing missed on 2026-08-24: `388_reminder_scheduler.sql` decided a link was
 * live from `superseded_at is null` alone. A cancelled link has `cancelled_at` set and
 * `superseded_at` NULL, so the scheduler would have gone on reminding a client about a
 * change order the contractor had withdrawn. Every live-link filter must exclude both.
 */
test('every live-link filter in the reminder scheduler excludes withdrawn links', () => {
  const sql = stripComments(read('../sql/388_reminder_scheduler.sql'));
  const superseded = (sql.match(/superseded_at\s+is\s+null/gi) ?? []).length;
  const cancelled = (sql.match(/cancelled_at\s+is\s+null/gi) ?? []).length;
  assert.equal(cancelled, superseded,
    `${superseded} live-link filters test superseded_at but only ${cancelled} test `
    + 'cancelled_at — a withdrawn extra would still be reminded about');
});
