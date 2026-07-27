/**
 * The Inbox → upload path, and the outbox FK migration that makes it possible.
 *
 * WHY THIS FILE EXISTS. On 2026-07-27 nothing had uploaded from hadar's phone for two
 * days. The visible symptom was a Postgres error:
 *
 *   23503: insert or update on table "capture" violates foreign key constraint
 *          "capture_project_id_fkey"
 *
 * The cause was structural, not transient. `capture.project_id` on the server is
 * NOT NULL REFERENCES project(id); the Inbox is a SENTINEL with no row anywhere; and
 * the outbox payload — which carries the project id — was digest-locked to an
 * append-only `capture_commit` row written BEFORE the human ever said which job it
 * was. The destination was welded shut at capture time and no later filing could
 * change it. It retried forever.
 *
 * These tests pin the two halves of the fix:
 *   1. the outbox FK migration must not lose a single pending upload, and
 *   2. filing an unresolved capture must produce a queue entry aimed at the REAL job.
 *
 * Real SQLite, no mocks — a mock would agree with whatever I wrote, which is the
 * failure mode this whole area already has a history of.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { sha256 } from 'js-sha256';
import { APP_OWNED_DDL, OUTBOX_FK_MIGRATION, INBOX_ID, buildCapturePayload } from './captureddl.ts';
import { RESOLUTION_DDL, fileCapture } from './projects.ts';

function realDb(db: DatabaseSync): any {
  const api = {
    getAll: async (sql: string, params: any[] = []) => db.prepare(sql).all(...params),
    execute: async (sql: string, params: any[] = []) => {
      const r = db.prepare(sql).run(...params);
      return { rowsAffected: Number(r.changes) };
    },
    writeTransaction: async (fn: (tx: any) => Promise<void>) => {
      db.exec('BEGIN');
      try { await fn(api); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
  return api;
}

/** PowerSync owns `project` on the device; the tests only need somewhere to point. */
const PROJECT_DDL = `CREATE TABLE IF NOT EXISTS project (
   id TEXT PRIMARY KEY, name TEXT, last_used_ms INTEGER)`;

function fresh() {
  const raw = new DatabaseSync(':memory:');
  for (const s of [...APP_OWNED_DDL, ...RESOLUTION_DDL, PROJECT_DDL]) raw.exec(s);
  raw.prepare(`INSERT INTO project (id, name) VALUES ('prj-real','1151 Stanyan St')`).run();
  return { raw, db: realDb(raw) };
}

const SHA = 'a'.repeat(64);

/** A committed capture, exactly as performCapture leaves one. */
function commit(raw: DatabaseSync, capId: string, projectId: string) {
  raw.prepare(
    `INSERT INTO capture_commit (capture_id, attachment_id, mutation_id, project_id,
       owner_id, media_relpath, media_sha256, media_bytes, media_mime_type, modality,
       captured_at_ms, committed_at_ms, request_sha256, stamp_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(capId, `att-${capId}`, `mut-${capId}`, projectId, 'owner-1',
        `media/${capId}.m4a`, SHA, 1234, 'audio/m4a', 'voice',
        1000, 2000, SHA, 'unavailable');
}

function queue(raw: DatabaseSync, capId: string, projectId: string) {
  const payload = buildCapturePayload({
    captureId: capId, attachmentId: `att-${capId}`, mutationId: `mut-${capId}`,
    projectId, ownerId: 'owner-1', mediaSha256: SHA, mediaBytes: 1234,
    mediaMimeType: 'audio/m4a', modality: 'voice', capturedAtMs: 1000,
    gpsLat: null, gpsLng: null, gpsAccuracyM: null, gpsFixAgeMs: null,
    stampStatus: 'unavailable',
  });
  raw.prepare(
    `INSERT INTO capture_outbox (mutation_id, capture_id, operation, payload_json,
       payload_sha256, queued_at_ms, attempt_count, next_attempt_at_ms)
     VALUES (?,?,'capture.create.v1',?,?,?,?,?)`
  ).run(`mut-${capId}`, capId, payload, sha256(payload).toLowerCase(), 500, 9, 0);
}

const outbox = (raw: DatabaseSync, capId: string) =>
  raw.prepare(`SELECT * FROM capture_outbox WHERE capture_id = ?`).get(capId) as any;

// ── the fix, half 1: filing gives a held capture a real destination ───────────

test('a capture held in the Inbox gets queued to the real job when filed', async () => {
  const { raw, db } = fresh();
  commit(raw, 'cap-1', INBOX_ID);          // committed, deliberately NOT queued
  assert.equal(outbox(raw, 'cap-1'), undefined, 'held captures must not be queued');

  await fileCapture(db, { captureId: 'cap-1', projectId: 'prj-real', by: 'hadar' });

  const row = outbox(raw, 'cap-1');
  assert.ok(row, 'filing must produce a queue entry');
  const payload = JSON.parse(row.payload_json);
  assert.equal(payload.project_id, 'prj-real', 'must be aimed at the filed job');
  assert.equal(payload.media_sha256, SHA, 'evidence must be carried over unchanged');
  assert.equal(row.attempt_count, 0);
  assert.equal(row.next_attempt_at_ms, 0, 'must be due immediately');
});

test('the minted digest is the digest the server will be sent', async () => {
  // uploader.ts passes row.payload_sha256 as p_request_sha256, and the server keys
  // idempotency on it. If it is not the hash of payload_json, every upload is a
  // conflicting replay waiting to happen.
  const { raw, db } = fresh();
  commit(raw, 'cap-2', INBOX_ID);
  await fileCapture(db, { captureId: 'cap-2', projectId: 'prj-real', by: 'hadar' });

  const row = outbox(raw, 'cap-2');
  assert.equal(row.payload_sha256, sha256(row.payload_json).toLowerCase());
  assert.match(row.payload_sha256, /^[0-9a-f]{64}$/);
});

test('a capture STUCK with an inbox payload is rewritten, not left to spin', async () => {
  // The state hadar's phone was actually in: queued before the fix, failing 23503 on
  // every tick because the payload named a project that cannot exist.
  const { raw, db } = fresh();
  commit(raw, 'cap-3', INBOX_ID);
  queue(raw, 'cap-3', INBOX_ID);
  assert.equal(JSON.parse(outbox(raw, 'cap-3').payload_json).project_id, INBOX_ID);

  await fileCapture(db, { captureId: 'cap-3', projectId: 'prj-real', by: 'hadar' });

  const rows = raw.prepare(`SELECT * FROM capture_outbox WHERE capture_id='cap-3'`).all();
  assert.equal(rows.length, 1, 'exactly one queue entry — never a duplicate send');
  const row = rows[0] as any;
  assert.equal(JSON.parse(row.payload_json).project_id, 'prj-real');
  assert.equal(row.attempt_count, 0, 'the failed attempts belonged to the old destination');
  assert.notEqual(row.mutation_id, 'mut-cap-3',
    'a changed digest under the old mutation_id is exactly the 23505 conflict case');
});

test('a capture already queued to a REAL job is never rewritten', async () => {
  // Guard against double-sending something that may already be in flight.
  const { raw, db } = fresh();
  commit(raw, 'cap-4', 'prj-real');
  queue(raw, 'cap-4', 'prj-real');
  const before = outbox(raw, 'cap-4');

  await fileCapture(db, { captureId: 'cap-4', projectId: 'prj-real', by: 'hadar' });

  const after = outbox(raw, 'cap-4');
  assert.equal(after.mutation_id, before.mutation_id, 'in-flight rows must be left alone');
  assert.equal(after.attempt_count, before.attempt_count);
});

test('filing INTO the inbox queues nothing', async () => {
  const { raw, db } = fresh();
  commit(raw, 'cap-5', INBOX_ID);
  await fileCapture(db, { captureId: 'cap-5', projectId: INBOX_ID, by: 'hadar' });
  assert.equal(outbox(raw, 'cap-5'), undefined);
});

test('filing records the human override without touching the commit', async () => {
  const { raw, db } = fresh();
  commit(raw, 'cap-6', INBOX_ID);
  await fileCapture(db, { captureId: 'cap-6', projectId: 'prj-real', by: 'hadar' });

  const res = raw.prepare(`SELECT * FROM capture_resolution WHERE capture_id='cap-6'`).get() as any;
  assert.equal(res.project_id, 'prj-real');
  const c = raw.prepare(`SELECT project_id FROM capture_commit WHERE capture_id='cap-6'`).get() as any;
  assert.equal(c.project_id, INBOX_ID,
    'capture_commit is append-only: what the device believed at capture time stands');
});

// ── the fix, half 2: the FK migration must not lose a pending upload ──────────

/** capture_outbox as it existed BEFORE 2026-07-27 — the composite FK. */
const OLD_OUTBOX_DDL = `CREATE TABLE capture_outbox (
    mutation_id        TEXT NOT NULL PRIMARY KEY,
    capture_id         TEXT NOT NULL UNIQUE,
    operation          TEXT NOT NULL CHECK (operation = 'capture.create.v1'),
    payload_json       TEXT NOT NULL CHECK (json_valid(payload_json)),
    payload_sha256     TEXT NOT NULL
      CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
    queued_at_ms       INTEGER NOT NULL CHECK (queued_at_ms > 0),
    attempt_count      INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_attempt_at_ms INTEGER,
    next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
    last_error_code    TEXT,
    last_error_text    TEXT,
    FOREIGN KEY (mutation_id, capture_id, payload_sha256)
      REFERENCES capture_commit (mutation_id, capture_id, request_sha256)
      ON UPDATE RESTRICT ON DELETE RESTRICT
 ) STRICT`;

test('the outbox FK migration preserves every pending upload', async () => {
  const raw = new DatabaseSync(':memory:');
  // The commit table, then the OLD outbox shape beside it.
  raw.exec(APP_OWNED_DDL[0]); raw.exec(APP_OWNED_DDL[1]); raw.exec(APP_OWNED_DDL[2]);
  raw.exec(OLD_OUTBOX_DDL);

  for (const id of ['cap-a', 'cap-b', 'cap-c']) {
    commit(raw, id, 'prj-real');
    const payload = buildCapturePayload({
      captureId: id, attachmentId: `att-${id}`, mutationId: `mut-${id}`,
      projectId: 'prj-real', ownerId: 'owner-1', mediaSha256: SHA, mediaBytes: 1,
      mediaMimeType: 'audio/m4a', modality: 'voice', capturedAtMs: 1,
      gpsLat: null, gpsLng: null, gpsAccuracyM: null, gpsFixAgeMs: null,
      stampStatus: 'unavailable',
    });
    // The old FK demanded the commit's own digest — that is the cage being removed.
    raw.prepare(
      `INSERT INTO capture_outbox (mutation_id, capture_id, operation, payload_json,
         payload_sha256, queued_at_ms, attempt_count, next_attempt_at_ms, last_error_code)
       VALUES (?,?,'capture.create.v1',?,?,?,?,?,?)`
    ).run(`mut-${id}`, id, payload, SHA, 42, 7, 99, '23503');
  }

  raw.exec('PRAGMA foreign_keys=off');
  raw.exec('BEGIN');
  for (const stmt of OUTBOX_FK_MIGRATION) raw.exec(stmt);
  raw.exec('COMMIT');
  raw.exec('PRAGMA foreign_keys=on');

  const rows = raw.prepare(`SELECT * FROM capture_outbox ORDER BY capture_id`).all() as any[];
  assert.equal(rows.length, 3, 'NO pending upload may be dropped by the rebuild');
  assert.deepEqual(rows.map((r) => r.capture_id), ['cap-a', 'cap-b', 'cap-c']);
  // Retry bookkeeping has to survive too, or every queued capture silently restarts
  // its backoff and a parked row quietly becomes live again.
  assert.equal(rows[0].attempt_count, 7);
  assert.equal(rows[0].next_attempt_at_ms, 99);
  assert.equal(rows[0].last_error_code, '23503');

  const fks = raw.prepare(`PRAGMA foreign_key_list('capture_outbox')`).all() as any[];
  assert.equal(fks.length, 1, 'exactly one FK remains');
  assert.equal(fks[0].from, 'capture_id', 'and it is the narrow one');
  assert.equal(fks[0].table, 'capture_commit');
});

test('after migrating, an outbox row may carry a digest the commit never had', async () => {
  // The whole point: transport is free to be re-minted; the commitment record is not.
  const { raw, db } = fresh();
  commit(raw, 'cap-7', INBOX_ID);
  await fileCapture(db, { captureId: 'cap-7', projectId: 'prj-real', by: 'hadar' });

  const row = outbox(raw, 'cap-7');
  const c = raw.prepare(`SELECT request_sha256, mutation_id FROM capture_commit
                          WHERE capture_id='cap-7'`).get() as any;
  assert.notEqual(row.payload_sha256, c.request_sha256);
  assert.notEqual(row.mutation_id, c.mutation_id);
  // ...and the row still cannot exist without a commitment behind it.
  assert.throws(() => raw.prepare(
    `INSERT INTO capture_outbox (mutation_id, capture_id, operation, payload_json,
       payload_sha256, queued_at_ms) VALUES ('m','no-such-capture','capture.create.v1','{}',?,1)`
  ).run(SHA), /FOREIGN KEY/i, 'the outbox must never reference uncommitted evidence');
});
