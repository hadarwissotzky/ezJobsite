/**
 * The OTA safety gate. These tests exist for one reason: the gate is the only thing
 * standing between an update and a capture in progress, and it fails OPEN if written
 * carelessly (an exception swallowed into `safe: true` would reload the app under a
 * recording user).
 *
 * The list-completeness test is the important one. `OUTBOX_TABLES` was written from a
 * grep, not from memory, precisely because the first draft of the design named three
 * of the nine. If someone adds a tenth outbox and forgets this list, that is a silent
 * hole — this test is what makes it loud.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { OUTBOX_TABLES, buildLine, inFlight } from './ota.ts';

/** Minimal stand-in for the PowerSync db: table -> row count, or a thrown error. */
function fakeDb(counts: Record<string, number | Error>) {
  return {
    async getAll<T>(sql: string): Promise<T[]> {
      const m = /FROM (\w+)/.exec(sql);
      const t = m?.[1] ?? '';
      const v = counts[t];
      if (v === undefined) throw new Error(`no such table: ${t}`);
      if (v instanceof Error) throw v;
      return [{ n: v }] as unknown as T[];
    },
  } as any;
}

const allEmpty = Object.fromEntries([...OUTBOX_TABLES, 'capture_draft'].map((t) => [t, 0]));

test('nothing queued and no open draft -> safe', async () => {
  const r = await inFlight(fakeDb(allEmpty));
  assert.equal(r.queued, 0);
  assert.equal(r.openDrafts, 0);
  assert.equal(r.safe, true);
});

test('a single queued row in ANY outbox blocks the update', async () => {
  for (const t of OUTBOX_TABLES) {
    const r = await inFlight(fakeDb({ ...allEmpty, [t]: 1 }));
    assert.equal(r.safe, false, `${t} with a pending row must block`);
  }
});

test('an open capture draft blocks the update', async () => {
  const r = await inFlight(fakeDb({ ...allEmpty, capture_draft: 1 }));
  assert.equal(r.safe, false);
});

test('a missing table counts as zero, not as an error', async () => {
  // An older app version genuinely has no such table; that is not "unsafe", it is empty.
  const missing = { ...allEmpty };
  delete (missing as any).tag_outbox;
  const r = await inFlight(fakeDb(missing));
  assert.equal(r.safe, true);
});

test('OUTBOX_TABLES covers every *_outbox table in the source', () => {
  const dir = new URL('.', import.meta.url).pathname;
  const found = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/CREATE TABLE IF NOT EXISTS (\w*_outbox\w*)/g)) found.add(m[1]);
  }
  const missing = [...found].filter((t) => !(OUTBOX_TABLES as readonly string[]).includes(t));
  assert.deepEqual(missing, [],
    `these outboxes are not in OUTBOX_TABLES, so an update could reload with their rows unsent: ${missing.join(', ')}`);
});

// ── the build line shown in Settings → About (REQ-OTA5) ────────────────────────

test('build line distinguishes the embedded bundle from a downloaded update', () => {
  assert.equal(buildLine({ version: '1.0.0', updateId: null, embedded: true }), 'v1.0.0 (base)');
  assert.equal(
    buildLine({ version: '1.0.0', updateId: 'abcdef12-3456-7890', embedded: false }),
    'v1.0.0 · update abcdef12');
  // An id present but running embedded still reads as base — the id alone does not
  // mean an update is live, and saying otherwise would misdirect support.
  assert.equal(buildLine({ version: '1.0.0', updateId: 'abcdef12', embedded: true }), 'v1.0.0 (base)');
});
