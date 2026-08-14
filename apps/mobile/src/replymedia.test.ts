/**
 * Photos on a message, against a REAL SQLite database.
 *   cd apps/mobile && node --test src/replymedia.test.ts
 *
 * WHAT THESE EXIST TO CATCH, and none of it shows up by reading the code:
 *
 *  1. A MESSAGE THAT COMMITS WITHOUT ITS PHOTOS. `postReply` writes the message row,
 *     the link rows and the outbox intent in ONE transaction — the same write-ahead
 *     rule REQ-CAP8 applies to a capture. If a later edit moves the links outside it,
 *     a crash between the two leaves a message whose photos nothing knows about, and
 *     the contractor is looking at a bubble that lost its picture.
 *
 *  2. A MESSAGE PHOTO LEAKING INTO THE INSTRUMENT. The whole point of the request
 *     (hadar, 2026-08-09) is that a photo sent in the conversation is NOT evidence on
 *     the change order. Nothing links it to `decision_version` or `capture_pair`, so
 *     the extra's photo query must not find it. That is one careless JOIN away from
 *     being false, and the failure is silent: a picture appears inside the document
 *     the client is being asked to sign.
 *
 *  3. A WORDLESS PHOTO MESSAGE REFUSED. `body` is NOT NULL with length > 0 on both
 *     sides, so a photo-only message needs a stored mark. Getting this wrong means
 *     the one-touch case — snap, send — throws.
 *
 *  4. PUBLISHED STATE READ AS SENT. `published_at_ms` is what the bubble uses to say
 *     "on this phone only". If `threadFor` stops reporting it, the screen tells the
 *     contractor the homeowner is looking at a photo that has not left the device.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { APP_OWNED_DDL } from './captureddl.ts';
import { CHANGE_ORDER_DDL } from './changeorder.ts';
import { DECISION_DDL } from './decisions.ts';
import { PAIR_DDL } from './pair.ts';
import { DISCUSSION_DDL, PHOTO_ONLY_BODY, postReply, threadFor } from './discussionstore.ts';

/** The PowerSync surface these two functions actually use, over node:sqlite. */
function wrap(raw: DatabaseSync): any {
  const run = (sql: string, args: any[] = []) => { raw.prepare(sql).run(...args); };
  return {
    execute: async (sql: string, args: any[] = []) => { run(sql, args); return { rows: { _array: [] } }; },
    getAll: async (sql: string, args: any[] = []) => raw.prepare(sql).all(...(args ?? [])),
    writeTransaction: async (fn: (tx: any) => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await fn({ execute: async (sql: string, args: any[] = []) => { run(sql, args); } });
        raw.exec('COMMIT');
      } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
}

function fresh() {
  const raw = new DatabaseSync(':memory:');
  // PAIR_DDL is a single statement, not a list — spreading it iterates characters.
  for (const ddl of [...APP_OWNED_DDL, ...DECISION_DDL, PAIR_DDL,
                     ...CHANGE_ORDER_DDL, ...DISCUSSION_DDL]) raw.exec(ddl);
  // `superseded_by` arrives by ALTER in ensureDiscussionSchema, not in the CREATE
  // list — and threadFor's lineage walk needs it.
  raw.exec(`ALTER TABLE change_order ADD COLUMN superseded_by TEXT`);
  raw.prepare(
    `INSERT INTO change_order (id, decision_id, project_id, owner_id, scope, amount_cents,
       who_directed, created_at_ms, status, numbers_confirmed_at_ms)
     VALUES ('co1','d1','p1','u1','Subfloor', 185000, 'Dana', 1000, 'sent', 1000)`
  ).run();
  return { raw, db: wrap(raw) };
}

/** A real-shaped sha256: capture_commit CHECKs it is 64 lowercase hex. */
const sha = (id: string) =>
  Array.from(id).reduce((h, c) => h + c.charCodeAt(0).toString(16), '').padEnd(64, '0').slice(0, 64);

/** A committed photo, as `performCapture` would have left it. */
function commitPhoto(raw: DatabaseSync, id: string) {
  raw.prepare(
    `INSERT INTO capture_commit (capture_id, attachment_id, mutation_id, owner_id, project_id,
       modality, captured_at_ms, committed_at_ms, media_relpath, media_sha256, media_bytes,
       media_mime_type, request_sha256)
     VALUES (?, ?, ?, 'u1','p1','photo', 2000, 2000, ?, ?, 1234, 'image/jpeg', ?)`
  ).run(id, `att-${id}`, `mut-${id}`, `capture-media/${id}.jpg`, sha(id), sha('req' + id));
}

test('the message, its photo links and its outbox intent commit together', async () => {
  const { raw, db } = fresh();
  commitPhoto(raw, 'capA');
  commitPhoto(raw, 'capB');

  const r = await postReply(db, {
    changeOrderId: 'co1', body: 'Here is the rot', ownerId: 'u1',
    captureIds: ['capA', 'capB'], atMs: 3000,
  });
  assert.equal(r.ok, true);
  const id = (r as any).id;

  const links = raw.prepare(
    `SELECT capture_id, ord FROM thread_message_media WHERE message_id = ? ORDER BY ord`
  ).all(id) as any[];
  assert.deepEqual(links.map((l) => l.capture_id), ['capA', 'capB']);
  // Order shot, preserved: two photos in the same millisecond must still render in
  // the order he took them.
  assert.deepEqual(links.map((l) => l.ord), [0, 1]);

  const out = raw.prepare(`SELECT count(*) AS n FROM r5b_outbox WHERE row_id = ?`).get(id) as any;
  assert.equal(out.n, 1, 'the transport intent commits with the message');
});

test('a photo with no words is a message', async () => {
  const { raw, db } = fresh();
  commitPhoto(raw, 'capA');

  const r = await postReply(db, {
    changeOrderId: 'co1', body: '', ownerId: 'u1', captureIds: ['capA'], atMs: 3000,
  });
  assert.equal(r.ok, true, 'snap-and-send must not require a caption');

  const row = raw.prepare(`SELECT body FROM thread_message WHERE id = ?`).get((r as any).id) as any;
  assert.equal(row.body, PHOTO_ONLY_BODY);
});

test('a message with neither words nor photos is still refused', async () => {
  const { db } = fresh();
  const r = await postReply(db, { changeOrderId: 'co1', body: '   ', ownerId: 'u1', atMs: 3000 });
  assert.equal(r.ok, false);
  assert.equal((r as any).reason, 'empty');
});

test('threadFor carries the photos, in order, with their published state', async () => {
  const { raw, db } = fresh();
  commitPhoto(raw, 'capA');
  commitPhoto(raw, 'capB');
  const r = await postReply(db, {
    changeOrderId: 'co1', body: 'two shots', ownerId: 'u1',
    captureIds: ['capA', 'capB'], atMs: 3000,
  });
  const id = (r as any).id;
  raw.prepare(`UPDATE thread_message_media SET published_at_ms = 9 WHERE capture_id = 'capA'`).run();

  const thread = await threadFor(db, 'co1');
  const msg = thread.find((m) => m.id === id)!;
  assert.equal(msg.photos?.length, 2);
  assert.equal(msg.photos![0].captureId, 'capA');
  assert.equal(msg.photos![0].relpath, 'capture-media/capA.jpg');
  // The one fact the bubble uses to avoid claiming the client can see it.
  assert.equal(msg.photos![0].published, true);
  assert.equal(msg.photos![1].published, false);
});

test('a message with no photos reports an empty list, not undefined', async () => {
  const { db } = fresh();
  await postReply(db, { changeOrderId: 'co1', body: 'just words', ownerId: 'u1', atMs: 3000 });
  const thread = await threadFor(db, 'co1');
  assert.deepEqual(thread[0].photos, []);
});

test('a message photo is NOT evidence on the change order', async () => {
  const { raw, db } = fresh();
  commitPhoto(raw, 'capMsg');
  await postReply(db, {
    changeOrderId: 'co1', body: 'look', ownerId: 'u1', captureIds: ['capMsg'], atMs: 3000,
  });

  // The extra's own photo rule (CO_PHOTO_SUBQUERY): decision_version, or a sibling
  // reached through capture_pair. A message photo has neither, and this is the
  // assertion that keeps the conversation out of the instrument.
  const found = raw.prepare(
    `SELECT cc.capture_id FROM capture_commit cc
      WHERE cc.modality = 'photo' AND cc.capture_id IN (
        SELECT dv.capture_id FROM decision_version dv
         WHERE dv.decision_id = 'd1' AND dv.capture_id IS NOT NULL
        UNION
        SELECT p2.capture_id FROM capture_pair p2
         WHERE p2.pair_id IN (
           SELECT p1.pair_id FROM capture_pair p1
            WHERE p1.capture_id IN (
              SELECT dv.capture_id FROM decision_version dv WHERE dv.decision_id = 'd1'
            )
         )
      )`
  ).all() as any[];
  assert.equal(found.length, 0, 'a conversation photo must never appear in the document');
});

test('message media is append-only: nothing may unlink a photo from a sent message', async () => {
  const { raw, db } = fresh();
  commitPhoto(raw, 'capA');
  const r = await postReply(db, {
    changeOrderId: 'co1', body: 'x', ownerId: 'u1', captureIds: ['capA'], atMs: 3000,
  });
  const id = (r as any).id;

  assert.throws(() => raw.prepare(
    `DELETE FROM thread_message_media WHERE message_id = ?`).run(id), /append-only/);
  assert.throws(() => raw.prepare(
    `UPDATE thread_message_media SET capture_id = 'other' WHERE message_id = ?`).run(id),
    /append-only/);

  // …but the publish stamp IS allowed to move: it is transport state, not evidence.
  raw.prepare(`UPDATE thread_message_media SET published_at_ms = 5 WHERE message_id = ?`).run(id);
  const row = raw.prepare(
    `SELECT published_at_ms FROM thread_message_media WHERE message_id = ?`).get(id) as any;
  assert.equal(row.published_at_ms, 5);
});
