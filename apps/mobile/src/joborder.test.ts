/**
 * The Jobs list's ORDER, against a REAL SQLite database.
 *   cd apps/mobile && node --test src/joborder.test.ts
 *
 * hadar, 2026-08-12: "order jobs by last updated (or updated change orders inside the
 * job)". The list used to be ordered by `last_used_ms` — a browsing stamp — and the
 * card's "last activity" line counted captures only. So a job whose client approved a
 * change order an hour ago sat below a job nothing had happened on, and merely opening
 * a job reordered the list under the finger.
 *
 * These assert the two halves that were wrong: a change-order event COUNTS as activity
 * (and beats an older capture), and a client message counts too. The queries run
 * against the SHIPPED DDL, not hand-written tables — the whole failure mode being
 * guarded is a column name that exists in the test and not on the phone, since
 * projectCards swallows a bad query and silently returns "no activity".
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { APP_OWNED_DDL } from './captureddl.ts';
import { CHANGE_ORDER_DDL } from './changeorder.ts';
import { DISCUSSION_DDL } from './discussionstore.ts';
import { RESOLUTION_DDL } from './projects.ts';
import { projectCards } from './ui/home.ts';

const DAY = 86_400_000;
const T0 = 1_760_000_000_000;

/** A project row shaped as listProjects returns it. */
const proj = (id: string, lastUsed: number | null): any =>
  ({ id, name: id, address: null, lat: null, lng: null, geofence_m: 150,
     client_ref: null, status: 'in_progress', last_used_ms: lastUsed, label: null });

function freshDb() {
  const raw = new DatabaseSync(':memory:');
  for (const stmt of [...APP_OWNED_DDL, ...RESOLUTION_DDL, ...CHANGE_ORDER_DDL, ...DISCUSSION_DDL]) raw.exec(stmt);
  // projectCards only ever reads, so a getAll shim is the whole surface it needs.
  const db: any = {
    // ASYNC, so a bad query REJECTS rather than throwing synchronously — that is what
    // PowerSync does, and it is the behaviour projectCards' .catch() depends on.
    getAll: async (sql: string, args: any[] = []) => raw.prepare(sql).all(...args) as any[],
    raw,
  };
  return db;
}

function addCapture(db: any, projectId: string, ms: number, id = `c-${ms}-${projectId}`) {
  const hex = 'a'.repeat(64);
  db.raw.prepare(
    `INSERT INTO capture_commit (capture_id, attachment_id, mutation_id, project_id, owner_id,
                                 media_relpath, media_sha256, media_bytes, media_mime_type,
                                 modality, captured_at_ms, committed_at_ms, request_sha256)
     VALUES (?,?,?,?, 'u1', ?, ?, 1, 'image/jpeg', 'photo', ?, ?, ?)`
  ).run(id, `at-${id}`, `m-${id}`, projectId, `${id}.jpg`, hex, ms, ms, hex);
}

type CoStamps = { created?: number; sent?: number; approved?: number; status?: string };

function addCo(db: any, id: string, projectId: string, stamps: CoStamps) {
  db.raw.prepare(
    `INSERT INTO change_order (id, decision_id, project_id, owner_id, scope, who_directed,
                               numbers_confirmed_at_ms, created_at_ms, status,
                               sent_at_ms, approved_at_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, `d-${id}`, projectId, 'u1', 'Scope', 'Owner', stamps.created ?? T0,
        stamps.created ?? T0, stamps.status ?? 'draft',
        stamps.sent ?? null, stamps.approved ?? null);
}

test('a change order beats an older capture — the job with the approval sorts first', async () => {
  const db = freshDb();
  addCapture(db, 'A', T0 + 9 * DAY);          // A: photos last week, nothing since
  addCapture(db, 'B', T0 + 1 * DAY);          // B: an old photo…
  addCo(db, 'co1', 'B', { created: T0 + 2 * DAY, approved: T0 + 10 * DAY, status: 'approved' });

  const cards = await projectCards(db, [proj('A', T0), proj('B', T0)]);
  assert.deepEqual(cards.map((c) => c.id), ['B', 'A']);
  assert.equal(cards[0].lastMs, T0 + 10 * DAY, 'the approval is the activity, not the capture');
});

test('a message on a change order counts as activity for its job', async () => {
  const db = freshDb();
  addCo(db, 'co1', 'A', { created: T0 });
  addCo(db, 'co2', 'B', { created: T0 + 5 * DAY });
  db.raw.prepare(
    `INSERT INTO thread_message (id, change_order_id, side, body, at_ms) VALUES (?,?,?,?,?)`
  ).run('q-1', 'co1', 'client', 'When can you start?', T0 + 8 * DAY);

  const cards = await projectCards(db, [proj('B', T0), proj('A', T0)]);
  assert.deepEqual(cards.map((c) => c.id), ['A', 'B'], 'the client spoke on A most recently');
  assert.equal(cards[0].lastMs, T0 + 8 * DAY);
});

test('a capture still counts, and the newest of the two signals wins', async () => {
  const db = freshDb();
  addCo(db, 'co1', 'A', { created: T0 + 2 * DAY });
  addCapture(db, 'A', T0 + 6 * DAY);
  const [a] = await projectCards(db, [proj('A', T0)]);
  assert.equal(a.lastMs, T0 + 6 * DAY);
  assert.equal(a.captureCount, 1);
});

test('opening a job no longer reorders the list — last_used_ms is not activity', async () => {
  const db = freshDb();
  addCapture(db, 'A', T0 + 3 * DAY);
  // B was OPENED just now (touchProject) but nothing happened in it. It must not
  // outrank A, and it must not claim a "last activity" it never had.
  const cards = await projectCards(db, [proj('B', T0 + 99 * DAY), proj('A', T0)]);
  assert.deepEqual(cards.map((c) => c.id), ['A', 'B']);
  assert.equal(cards[1].lastMs, null, 'an untouched job has no activity to report');
});

test('jobs with no activity keep the order listProjects gave them', async () => {
  const db = freshDb();
  const cards = await projectCards(db, [proj('newer', T0 + DAY), proj('older', T0)]);
  assert.deepEqual(cards.map((c) => c.id), ['newer', 'older']);
});

test('a missing thread_message table costs the message signal, not the whole ordering', async () => {
  const db = freshDb();
  db.raw.exec('DROP TRIGGER thread_message_no_delete');
  db.raw.exec('DROP TABLE thread_message');
  addCo(db, 'co1', 'B', { created: T0 + 4 * DAY });
  const cards = await projectCards(db, [proj('A', T0), proj('B', T0)]);
  assert.deepEqual(cards.map((c) => c.id), ['B', 'A'], 'the lifecycle half survives');
});
