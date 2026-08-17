/**
 * Naming the client on a draft extra.
 *   cd apps/mobile && node --test src/setdraftclient.test.ts
 *
 * Against a REAL SQLite database, because the guarantees are in the SQL: a `WHERE
 * status = 'draft'` that stopped matching, or an outbox payload that stopped being
 * rewritten, would both pass a mocked test and fail on a phone.
 *
 * Why this field is worth the trouble: `who_directed` is who the extra is FOR. It is
 * copied into `confirmation_request.counterparty_label` at send, which is frozen into
 * the instrument the client signs. A write that lands on a sent extra, or one that
 * lands locally but never reaches the server, makes the app disagree with a signed
 * document.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { CHANGE_ORDER_DDL, setDraftClient } from './changeorder.ts';

const T0 = 1_760_000_000_000;

function freshDb() {
  const raw = new DatabaseSync(':memory:');
  for (const stmt of CHANGE_ORDER_DDL) raw.exec(stmt);
  return {
    raw,
    getAll: async (sql: string, args: any[] = []) => raw.prepare(sql).all(...args) as any[],
    execute: async (sql: string, args: any[] = []) => {
      const r = raw.prepare(sql).run(...args);
      return { rowsAffected: Number(r.changes ?? 0) };
    },
  } as any;
}

function addCo(db: any, id: string, status: string, who = 'Owner') {
  db.raw.prepare(
    `INSERT INTO change_order (id, decision_id, project_id, owner_id, scope, who_directed,
                               numbers_confirmed_at_ms, created_at_ms, status)
     VALUES (?, ?, 'p1', 'u1', 'Fireplace face', ?, ?, ?, ?)`
  ).run(id, `d-${id}`, who, T0, T0, status);
}

function queueOutbox(db: any, coId: string, payload: Record<string, unknown>) {
  const json = JSON.stringify(payload);
  db.raw.prepare(
    `INSERT INTO change_order_outbox (mutation_id, change_order_id, payload_json,
                                      payload_sha256, queued_at_ms)
     VALUES (?, ?, ?, 'sha', ?)`
  ).run(`m-${coId}`, coId, json, T0);
}

const whoOf = (db: any, id: string) =>
  (db.raw.prepare(`SELECT who_directed FROM change_order WHERE id = ?`).get(id) as any).who_directed;

/* ---------------------------------------------------------------- writing -- */

test('naming a client on a draft writes it to the extra', async () => {
  const db = freshDb();
  addCo(db, 'co1', 'draft');
  const r = await setDraftClient(db, 'co1', 'Sarah Miller');
  assert.deepEqual(r, { ok: true });
  assert.equal(whoOf(db, 'co1'), 'Sarah Miller');
});

test('the name is trimmed — trailing space is not part of who signs', async () => {
  const db = freshDb();
  addCo(db, 'co1', 'draft');
  await setDraftClient(db, 'co1', '  Sarah Miller \n');
  assert.equal(whoOf(db, 'co1'), 'Sarah Miller');
});

test('an empty name is refused, and changes nothing', async () => {
  const db = freshDb();
  addCo(db, 'co1', 'draft', 'Owner');
  const r = await setDraftClient(db, 'co1', '   ');
  assert.equal(r.ok, false);
  // The sentinel survives: a blank must not overwrite it with emptiness.
  assert.equal(whoOf(db, 'co1'), 'Owner');
});

/* ------------------------------------------------------------- draft only -- */

test('a SENT extra refuses the write — its recipient is already in the instrument', async () => {
  const db = freshDb();
  addCo(db, 'co1', 'sent', 'Sarah Miller');
  const r = await setDraftClient(db, 'co1', 'Somebody Else');
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : '', /not a draft/);
  assert.equal(whoOf(db, 'co1'), 'Sarah Miller', 'the sent record is untouched');
});

test('an APPROVED extra refuses it too', async () => {
  const db = freshDb();
  addCo(db, 'co1', 'approved', 'Sarah Miller');
  assert.equal((await setDraftClient(db, 'co1', 'Somebody Else')).ok, false);
  assert.equal(whoOf(db, 'co1'), 'Sarah Miller');
});

test('an extra that does not exist is refused, not silently created', async () => {
  const db = freshDb();
  assert.equal((await setDraftClient(db, 'nope', 'Sarah')).ok, false);
});

/* ---------------------------------------------------------------- outbox -- */

test('a still-queued INSERT is rewritten, so the server never sees the old name', async () => {
  const db = freshDb();
  addCo(db, 'co1', 'draft');
  queueOutbox(db, 'co1', { id: 'co1', scope: 'Fireplace face', who_directed: 'Owner' });

  await setDraftClient(db, 'co1', 'Sarah Miller');

  const row = db.raw.prepare(
    `SELECT payload_json, payload_sha256 FROM change_order_outbox WHERE change_order_id = 'co1'`
  ).get() as any;
  const p = JSON.parse(row.payload_json);
  assert.equal(p.who_directed, 'Sarah Miller');
  // Everything else in the payload survives — this rewrites one field, not the row.
  assert.equal(p.scope, 'Fireplace face');
  assert.equal(p.id, 'co1');
  // The hash must move with the body, or the drain ships a payload whose digest lies.
  assert.notEqual(row.payload_sha256, 'sha');
});

test('with nothing queued it still succeeds — the local write is the point', async () => {
  const db = freshDb();
  addCo(db, 'co1', 'draft');
  const r = await setDraftClient(db, 'co1', 'Sarah Miller');
  assert.deepEqual(r, { ok: true });
  assert.equal(whoOf(db, 'co1'), 'Sarah Miller');
});

test('a corrupt queued payload does not lose the local write', async () => {
  const db = freshDb();
  addCo(db, 'co1', 'draft');
  db.raw.prepare(
    `INSERT INTO change_order_outbox (mutation_id, change_order_id, payload_json,
                                      payload_sha256, queued_at_ms)
     VALUES ('m1', 'co1', '{not json', 'sha', ?)`).run(T0);

  const r = await setDraftClient(db, 'co1', 'Sarah Miller');
  assert.deepEqual(r, { ok: true }, 'the extra is still named');
  assert.equal(whoOf(db, 'co1'), 'Sarah Miller');
});
