/**
 * "We heard nothing" — who gets told, and who must not be.
 *   cd apps/mobile && node --test src/silentnotice.test.ts
 *
 * REAL SQLITE, because every claim here is a claim about a WHERE clause, and the whole
 * value of this feature is that it does not cry wolf. A popup that fires while a
 * recording is still uploading, or on an extra whose scope is already written, teaches
 * the user to dismiss it unread — at which point the one state that cannot fix itself
 * stops reaching anybody.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  ensureSilentNoticeSchema, markSilentNoticeShown, pendingSilentNotices,
} from './silentnotice.ts';

function realDb(db: DatabaseSync): any {
  return {
    getAll: async (sql: string, params: any[] = []) => db.prepare(sql).all(...params),
    execute: async (sql: string, params: any[] = []) => {
      const r = db.prepare(sql).run(...params);
      return { rowsAffected: Number(r.changes) };
    },
  };
}

/** Only the columns this module reads, in the shipped shape. */
const DDL = [
  `CREATE TABLE change_order (id TEXT PRIMARY KEY, decision_id TEXT NOT NULL,
     project_id TEXT NOT NULL, scope TEXT NOT NULL, scope_of_work TEXT,
     status TEXT NOT NULL, created_at_ms INTEGER NOT NULL) STRICT`,
  `CREATE TABLE decision_version (decision_id TEXT NOT NULL, capture_id TEXT) STRICT`,
  `CREATE TABLE capture_commit (capture_id TEXT PRIMARY KEY, modality TEXT) STRICT`,
  `CREATE TABLE voice_transcript_cache (capture_id TEXT PRIMARY KEY, text TEXT) STRICT`,
  `CREATE TABLE capture_outbox (capture_id TEXT NOT NULL) STRICT`,
];

/** An extra with one voice capture and `n` photos. Transcript/queue optional. */
async function seed(db: any, o: {
  id: string; scopeOfWork?: string | null; status?: string;
  transcript?: string | null; queued?: boolean; photos?: number; voice?: boolean;
}) {
  const dec = `dec-${o.id}`;
  await db.execute(
    `INSERT INTO change_order (id, decision_id, project_id, scope, scope_of_work, status, created_at_ms)
     VALUES (?,?, 'p-1', 'Extra outlet', ?, ?, 1)`,
    [o.id, dec, o.scopeOfWork ?? null, o.status ?? 'draft']);
  if (o.voice !== false) {
    const v = `cap-v-${o.id}`;
    await db.execute(`INSERT INTO capture_commit VALUES (?, 'voice')`, [v]);
    await db.execute(`INSERT INTO decision_version VALUES (?, ?)`, [dec, v]);
    if (o.transcript != null) {
      await db.execute(`INSERT INTO voice_transcript_cache VALUES (?, ?)`, [v, o.transcript]);
    }
    if (o.queued) await db.execute(`INSERT INTO capture_outbox VALUES (?)`, [v]);
  }
  for (let i = 0; i < (o.photos ?? 0); i++) {
    const p = `cap-p-${o.id}-${i}`;
    await db.execute(`INSERT INTO capture_commit VALUES (?, 'photo')`, [p]);
    await db.execute(`INSERT INTO decision_version VALUES (?, ?)`, [dec, p]);
  }
}

async function fresh() {
  const db = realDb(new DatabaseSync(':memory:'));
  for (const s of DDL) await db.execute(s);
  return db;
}

test('a finished, silent, empty extra IS reported — with its photo count', async () => {
  const db = await fresh();
  await ensureSilentNoticeSchema(db);
  await seed(db, { id: 'co-1', photos: 3 });
  const [n] = await pendingSilentNotices(db);
  assert.equal(n.changeOrderId, 'co-1');
  assert.equal(n.photos, 3);
});

test('NOT while a capture is still queued — the words may be minutes away', async () => {
  // The guard that matters most offline. Reporting silence while the recording sits in
  // the outbox is a lie, and mandate #7 says no signal is the expected condition.
  const db = await fresh();
  await ensureSilentNoticeSchema(db);
  await seed(db, { id: 'co-1', queued: true });
  assert.deepEqual(await pendingSilentNotices(db), []);
});

test('NOT when a transcript exists', async () => {
  const db = await fresh();
  await ensureSilentNoticeSchema(db);
  await seed(db, { id: 'co-1', transcript: 'replace the panel' });
  assert.deepEqual(await pendingSilentNotices(db), []);
});

test('a blank transcript row still counts as silence', async () => {
  // An empty string is what the recogniser writes when it heard nothing, and it must not
  // read as "we have the words".
  const db = await fresh();
  await ensureSilentNoticeSchema(db);
  await seed(db, { id: 'co-1', transcript: '   ' });
  assert.equal((await pendingSilentNotices(db)).length, 1);
});

test('NOT when the scope is already written — hadar’s condition', async () => {
  // If he typed it himself the silence cost him nothing and there is nothing to report.
  const db = await fresh();
  await ensureSilentNoticeSchema(db);
  await seed(db, { id: 'co-1', scopeOfWork: 'Relocate the main panel 6ft' });
  assert.deepEqual(await pendingSilentNotices(db), []);
});

test('NOT when there was never a recording at all', async () => {
  // Photos only, no voice: "we heard nothing" is a non-sequitur — nobody spoke.
  const db = await fresh();
  await ensureSilentNoticeSchema(db);
  await seed(db, { id: 'co-1', voice: false, photos: 2 });
  assert.deepEqual(await pendingSilentNotices(db), []);
});

test('NOT once it has been sent', async () => {
  const db = await fresh();
  await ensureSilentNoticeSchema(db);
  await seed(db, { id: 'co-1', status: 'sent' });
  assert.deepEqual(await pendingSilentNotices(db), []);
});

test('told once, never again', async () => {
  const db = await fresh();
  await ensureSilentNoticeSchema(db);
  await seed(db, { id: 'co-1' });
  assert.equal((await pendingSilentNotices(db)).length, 1);
  await markSilentNoticeShown(db, 'co-1');
  assert.deepEqual(await pendingSilentNotices(db), []);
});

test('the first launch after this ships reports NOTHING', async () => {
  // The watermark. Without it, a stack of notices about weeks-old recordings — which
  // teaches him to dismiss the sheet without reading it.
  const db = await fresh();
  await seed(db, { id: 'old-1' });
  await seed(db, { id: 'old-2' });
  await ensureSilentNoticeSchema(db);
  assert.deepEqual(await pendingSilentNotices(db), []);
});

test('an extra created AFTER the table exists is still news', async () => {
  const db = await fresh();
  await ensureSilentNoticeSchema(db);
  await seed(db, { id: 'new-1' });
  assert.equal((await pendingSilentNotices(db)).length, 1);
});
