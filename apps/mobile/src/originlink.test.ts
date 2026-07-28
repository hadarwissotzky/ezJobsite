/**
 * drainChangeOrderOutbox and REQ-LC31's lineage, against a REAL SQLite outbox.
 *   cd apps/mobile && node --test src/originlink.test.ts
 *
 * WHY THIS TEST EXISTS. The two halves of D6 were written by different hands and
 * disagreed about the wire shape, in the one direction nothing else could catch:
 * the client passed `p_origin_change_order_id` as a 20th argument to
 * `ingest_change_order_v1`, and 386 had deliberately NOT widened that signature —
 * it exposes `link_origin_change_order_v1` instead, and its header says why in as
 * many words. Both files typechecked, all 405 tests passed, and every ordinary
 * extra would have synced perfectly. Only follow-on extras — the entire feature
 * D6 exists to provide — would have failed, on a real device with real signal,
 * with PGRST202: a code that is NOT in CO_PERMANENT, so they would never park and
 * never surface. They would retry forever while the ledger said "pending".
 *
 * tsc cannot see across a network boundary and the SQL is not executed here, so
 * the ONLY thing that can hold these two halves together is a test that asserts
 * the argument names actually put on the wire. That is what this does: it fakes
 * the transport and reads back exactly which RPCs were called with which keys.
 *
 * The real SQLite database is not decoration — the assertion that the outbox row
 * SURVIVES a failed link is the durability claim (mandate #1: the intent is
 * deleted only on success), and a mock db would agree with whatever the code did.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { CHANGE_ORDER_DDL, drainChangeOrderOutbox } from './changeorder.ts';

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

type Call = { fn: string; args: Record<string, any> };

/** Records every RPC. `fail` names the ONE function that should reject, so a
 *  transport failure can be aimed at the link without breaking the ingest. */
function fakeSupabase(calls: Call[], fail?: { fn: string; code: string }): any {
  return {
    rpc: async (fn: string, args: Record<string, any>) => {
      calls.push({ fn, args });
      if (fail && fail.fn === fn) {
        return { data: null, error: Object.assign(new Error(`${fn} refused`), { code: fail.code }) };
      }
      return { data: { status: 'applied' }, error: null };
    },
  };
}

/** An outbox row is all the drain reads; the change_order row it came from is not
 *  touched by this path, so seeding the queue alone is the honest minimum. */
function queue(raw: DatabaseSync, id: string, origin: string | null) {
  const payload = {
    mutation_id: `m-${id}`, id, decision_id: `d-${id}`, project_id: 'p1',
    scope: 'Replace rotted subfloor', line_items: [], amount_cents: 40000,
    nte_cents: null, is_mini: 0, who_directed: 'Owner', ref_estimate: null,
    numbers_confirmed_at_ms: Date.now(), created_at_ms: Date.now(),
    billing_timing: null, schedule_effect: null, schedule_days: null, exclusions: null,
    origin_change_order_id: origin,
  };
  raw.prepare(
    `INSERT INTO change_order_outbox (mutation_id, change_order_id, payload_json,
       payload_sha256, queued_at_ms, next_attempt_at_ms)
     VALUES (?,?,?,?,?,0)`
  ).run(`m-${id}`, id, JSON.stringify(payload), `sha-${id}`, Date.now());
}

function fresh() {
  const raw = new DatabaseSync(':memory:');
  for (const s of CHANGE_ORDER_DDL) raw.exec(s);
  return { raw, db: realDb(raw) };
}

const outboxCount = (raw: DatabaseSync) =>
  Number((raw.prepare(`SELECT count(*) c FROM change_order_outbox`).get() as any).c);

test('an ordinary extra is ingested and NEVER carries an origin argument', async () => {
  const { raw, db } = fresh();
  queue(raw, 'co-plain', null);
  const calls: Call[] = [];

  const r = await drainChangeOrderOutbox(db, fakeSupabase(calls), 'u1');

  assert.equal(r.uploaded, 1);
  assert.equal(calls.length, 1, 'an extra with no origin makes exactly one call');
  assert.equal(calls[0].fn, 'ingest_change_order_v1');
  // THE REGRESSION, named: PostgREST resolves by exact argument-name set, so an
  // undeclared key here is PGRST202 for every extra on the device, not just this one.
  assert.ok(!('p_origin_change_order_id' in calls[0].args),
    'ingest_change_order_v1 does not declare p_origin_change_order_id (386) — sending it is PGRST202');
  assert.equal(outboxCount(raw), 0, 'a fully applied intent is deleted');
});

test('a follow-on links through link_origin_change_order_v1, AFTER the ingest', async () => {
  const { raw, db } = fresh();
  queue(raw, 'co-fw-1', 'co-approved');
  const calls: Call[] = [];

  await drainChangeOrderOutbox(db, fakeSupabase(calls), 'u1');

  assert.deepEqual(calls.map((c) => c.fn),
    ['ingest_change_order_v1', 'link_origin_change_order_v1'],
    'the child row must exist server-side before the link can find it');
  // Still not on the ingest, even when there IS an origin — this is the exact
  // shape the two agents disagreed about.
  assert.ok(!('p_origin_change_order_id' in calls[0].args));
  assert.deepEqual(calls[1].args,
    { p_id: 'co-fw-1', p_origin_change_order_id: 'co-approved' },
    'the argument names are 386\'s signature, verbatim');
  assert.equal(outboxCount(raw), 0);
});

test('a failed link KEEPS the intent queued — the lineage is never silently lost', async () => {
  const { raw, db } = fresh();
  queue(raw, 'co-fw-2', 'co-approved');
  const calls: Call[] = [];

  // 08006 = connection failure: retryable, so the row must be left to replay.
  const r = await drainChangeOrderOutbox(db, fakeSupabase(calls, { fn: 'link_origin_change_order_v1', code: '08006' }), 'u1');

  assert.equal(r.retryable, 1);
  assert.equal(r.uploaded, 0, 'a row is not "uploaded" until its lineage is recorded too');
  assert.equal(outboxCount(raw), 1,
    'the outbox row survives: the ingest replays as already_applied and the link is idempotent by outcome (386)');
});

test('a permanently refused link parks the row instead of retrying forever', async () => {
  const { raw, db } = fresh();
  queue(raw, 'co-fw-3', 'co-sent-not-approved');
  const calls: Call[] = [];

  // 23514 is what 386's trigger raises when the referent is not `approved`, and
  // what its cross-project guard raises. It is in CO_PERMANENT: the server is
  // saying "never", and never must not be retried at the 30-minute cap for the
  // life of the install.
  const r = await drainChangeOrderOutbox(db, fakeSupabase(calls, { fn: 'link_origin_change_order_v1', code: '23514' }), 'u1');

  assert.equal(r.parked, 1);
  assert.equal(outboxCount(raw), 1, 'parked, not deleted — a refused intent is still evidence');
});
