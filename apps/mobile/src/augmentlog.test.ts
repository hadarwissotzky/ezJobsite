/**
 * `extra_augment_log` against a REAL SQLite database.
 *   cd apps/mobile && node --test src/augmentlog.test.ts
 *
 * WHY REAL SQL, NOT A MOCK (same reason as discardstore.test.ts). The whole point of
 * `appendAugmentDesc` is a targeting query — "the newest voice row that has no
 * description yet". A mock would agree with whatever I wrote; the bug lives in the
 * WHERE clause, which only a real engine executes. And the migration in
 * `ensureAugmentSchema` (ADD COLUMN against a table that predates the column) can only
 * be proven by running it against a table built the old way.
 *
 * These lock the three things the description-augment feature (hadar, 2026-07-27)
 * stands on: photo rows never get a description, the append lands on THIS edit's row
 * and not an older one, and a re-run cannot clobber a description already written.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  AUGMENT_DDL, ensureAugmentSchema, noteAugment, augmentEventsFor, appendAugmentDesc,
} from './augmentlog.ts';

function realDb(db: DatabaseSync): any {
  const api = {
    getAll: async (sql: string, params: any[] = []) => db.prepare(sql).all(...params),
    execute: async (sql: string, params: any[] = []) => {
      const r = db.prepare(sql).run(...params);
      return { rowsAffected: Number(r.changes) };
    },
  };
  return api;
}

async function fresh() {
  const raw = new DatabaseSync(':memory:');
  const db = realDb(raw);
  await ensureAugmentSchema(db);   // creates the table AND runs the desc_text ALTER
  return { raw, db };
}

const CO = 'co-1';

test('a voice edit gets its description; a photo edit never does', async () => {
  const { db } = await fresh();
  await noteAugment(db, { changeOrderId: CO, kind: 'photo', n: 2, atMs: 1000, byName: 'Al' });
  await noteAugment(db, { changeOrderId: CO, kind: 'voice', n: 1, atMs: 1001, byName: 'Al' });

  const ok = await appendAugmentDesc(db, CO, '  Extra outlet in the garage  ');
  assert.equal(ok, true);

  const evs = await augmentEventsFor(db, CO);
  const photo = evs.find((e) => e.kind === 'photo')!;
  const voice = evs.find((e) => e.kind === 'voice')!;
  assert.equal(photo.descText, null, 'photo rows carry no description');
  assert.equal(voice.descText, 'Extra outlet in the garage', 'trimmed and stored');
});

test('append lands on THIS edit — the newest un-described voice row', async () => {
  const { db } = await fresh();
  // An earlier voice edit that was already described.
  await noteAugment(db, { changeOrderId: CO, kind: 'voice', n: 1, atMs: 1000 });
  await appendAugmentDesc(db, CO, 'first edit');
  // A newer voice edit, awaiting its description.
  await noteAugment(db, { changeOrderId: CO, kind: 'voice', n: 1, atMs: 2000 });
  await appendAugmentDesc(db, CO, 'second edit');

  const texts = (await augmentEventsFor(db, CO))   // oldest first
    .filter((e) => e.kind === 'voice').map((e) => e.descText);
  assert.deepEqual(texts, ['first edit', 'second edit'],
    'each edit keeps its own words; the second never overwrote the first');
});

test('a re-run cannot clobber a description already written', async () => {
  const { db } = await fresh();
  await noteAugment(db, { changeOrderId: CO, kind: 'voice', n: 1, atMs: 1000 });
  await appendAugmentDesc(db, CO, 'the real read');

  // A retried transition fires again with nothing new to say — there is no
  // un-described voice row, so it is a no-op, not an overwrite.
  const again = await appendAugmentDesc(db, CO, 'a stale retry');
  assert.equal(again, false, 'no un-described row to fill');

  const voice = (await augmentEventsFor(db, CO)).find((e) => e.kind === 'voice')!;
  assert.equal(voice.descText, 'the real read');
});

test('empty text is refused', async () => {
  const { db } = await fresh();
  await noteAugment(db, { changeOrderId: CO, kind: 'voice', n: 1, atMs: 1000 });
  assert.equal(await appendAugmentDesc(db, CO, '   '), false);
  const voice = (await augmentEventsFor(db, CO)).find((e) => e.kind === 'voice')!;
  assert.equal(voice.descText, null);
});

test('ensureAugmentSchema migrates a table that predates desc_text, and is re-runnable', async () => {
  const raw = new DatabaseSync(':memory:');
  // Build the OLD shape — the table as it shipped, before desc_text existed.
  raw.exec(`CREATE TABLE extra_augment_log (
     id TEXT PRIMARY KEY, change_order_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('photo','voice')),
     n INTEGER NOT NULL, at_ms INTEGER NOT NULL, by_name TEXT) STRICT`);
  const db = realDb(raw);

  await ensureAugmentSchema(db);          // must ADD COLUMN, not throw
  await ensureAugmentSchema(db);          // duplicate-column no-op, still not throw

  await noteAugment(db, { changeOrderId: CO, kind: 'voice', n: 1, atMs: 1000 });
  assert.equal(await appendAugmentDesc(db, CO, 'works after migration'), true);
});

// Silence "unused" for the exported DDL — referenced so a rename of AUGMENT_DDL
// trips this file too.
void AUGMENT_DDL;
