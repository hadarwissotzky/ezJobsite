/**
 * Pulling the client roster onto a device that did not type it in.
 *   cd apps/mobile && node --test src/approverhydrate.test.ts
 *
 * The bug being guarded against is not a crash. It is a send sheet that opens with no
 * recipient on a job that has one, and a handover that destroys every client on the
 * account — which is what shipped for weeks because R5c had an uplink and no downlink.
 *
 * The rules below are the ones that are dangerous to get wrong, not the happy path:
 * a retired person must never come back, recency must never walk backwards, and a
 * correction this device made must never be undone by a server that cannot receive it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { hydrateApprovers } from './approverhydrate.ts';

type Exec = { sql: string; args: any[] };

/** `local` is the set of ids this device already holds; INSERT OR IGNORE mirrors
 *  SQLite by reporting 0 rows affected for those. */
function fakeDb(local: string[] = [], updateHits = 1) {
  const execs: Exec[] = [];
  return {
    execs,
    inserts: () => execs.filter((e) => /INSERT OR IGNORE/.test(e.sql)),
    updates: () => execs.filter((e) => /^\s*UPDATE/.test(e.sql)),
    db: {
      execute: async (sql: string, args: any[] = []) => {
        execs.push({ sql, args });
        if (/INSERT OR IGNORE/.test(sql)) {
          return { rowsAffected: local.includes(args[0]) ? 0 : 1 };
        }
        return { rowsAffected: updateHits };
      },
    } as any,
  };
}

/** supabase-js is awaited directly when no .eq() is chained, so the builder must be
 *  thenable. Built separately to keep the fake above readable. */
function sb(rows: any[] | { error: string }) {
  const result = Array.isArray(rows)
    ? { data: rows, error: null }
    : { data: null, error: { message: (rows as any).error } };
  const seen: { project?: string } = {};
  const chain: any = {
    eq: (_c: string, v: string) => { seen.project = v; return Promise.resolve(result); },
    then: (res: any) => Promise.resolve(result).then(res),
  };
  return { seen, client: { from: () => ({ select: () => chain }) } as any };
}

const ROW = {
  id: 'ap-1', project_id: 'p-1', name: 'Sarah Miller', role: 'owner',
  phone_e164: '+14155550134', email: null, status: 'active',
  can_bind_money: true, last_used_ms: 1000, created_at_ms: 900,
};

test('a client this device never saw lands', async () => {
  const { db, inserts } = fakeDb();
  const r = await hydrateApprovers(db, sb([ROW]).client, null);
  assert.deepEqual(r, { pulled: 1, updated: 0, ok: true });
  assert.equal(inserts().length, 1);
  assert.equal(inserts()[0].args[0], 'ap-1');
  assert.equal(inserts()[0].args[4], '+14155550134', 'the phone is the whole point');
});

test('booleans and nulls cross the wire as SQLite values', async () => {
  const { db, inserts } = fakeDb();
  await hydrateApprovers(db, sb([{ ...ROW, can_bind_money: null, email: null }]).client, null);
  assert.equal(inserts()[0].args[7], null, 'never asked stays never asked, not 0');

  const b = fakeDb();
  await hydrateApprovers(b.db, sb([{ ...ROW, can_bind_money: false }]).client, null);
  assert.equal(b.inserts()[0].args[7], 0, 'false must become 0, not stay a boolean');
});

test('a RETIRED client is never resurrected by the pull', async () => {
  // The one-way rule. A local 'removed' whose retire is still queued would otherwise be
  // undone by the very sync meant to carry it, and the contractor would watch somebody
  // he removed reappear on every tick.
  const { db, updates } = fakeDb(['ap-1']);
  await hydrateApprovers(db, sb([{ ...ROW, status: 'active' }]).client, null);
  const u = updates()[0];
  assert.ok(u, 'an existing row still gets the narrow update');
  assert.ok(/CASE WHEN \? = 'removed'/.test(u.sql),
    "status is only ever written when the SERVER says removed");
  assert.equal(u.args[0], 'active');
  assert.ok(!/SET status = \?/.test(u.sql), 'a bare assignment would resurrect the row');
});

test("a retirement made on another phone DOES come down", async () => {
  const { db, updates } = fakeDb(['ap-1']);
  const r = await hydrateApprovers(db, sb([{ ...ROW, status: 'removed' }]).client, null);
  assert.equal(r.updated, 1);
  assert.equal(updates()[0].args[0], 'removed');
});

test('recency moves forward only', async () => {
  const { db, updates } = fakeDb(['ap-1']);
  await hydrateApprovers(db, sb([{ ...ROW, last_used_ms: 5000 }]).client, null);
  const u = updates()[0];
  assert.ok(/MAX\(last_used_ms, \?\)/.test(u.sql),
    'out-of-order drains must not make an older send look like the newest');
  assert.equal(u.args[1], 5000);
});

test('an existing row is never overwritten wholesale', async () => {
  // `ingest_r5c_v1`'s add is ON CONFLICT DO NOTHING, so a corrected phone cannot reach
  // the server. Adopting server columns here would undo that correction every 15s.
  const { db, inserts, updates } = fakeDb(['ap-1']);
  await hydrateApprovers(db, sb([{ ...ROW, phone_e164: '+15550000000', name: 'Stale' }]).client, null);
  assert.equal(inserts()[0].sql.includes('INSERT OR IGNORE'), true);
  const sql = updates()[0].sql;
  assert.ok(!/phone_e164/.test(sql), 'the local phone stands');
  assert.ok(!/name/.test(sql), 'the local name stands');
});

test('device-only columns are not invented', async () => {
  // chain_side and sms_consent_at_ms do not exist server-side. They must arrive NULL —
  // and for consent NULL BLOCKS A SEND, which is the safe direction.
  const { db, inserts } = fakeDb();
  await hydrateApprovers(db, sb([ROW]).client, null);
  const sql = inserts()[0].sql;
  assert.ok(!/chain_side/.test(sql));
  assert.ok(!/sms_consent_at_ms/.test(sql),
    'a second device must not text somebody on a consent it has never seen');
});

test('one malformed row does not take the roster with it', async () => {
  let n = 0;
  const db = { execute: async (sql: string, args: any[] = []) => {
    if (/INSERT OR IGNORE/.test(sql)) { n++; if (args[0] === 'bad') throw new Error('constraint'); }
    return { rowsAffected: 1 };
  } } as any;
  const r = await hydrateApprovers(db, sb([ROW, { ...ROW, id: 'bad', name: '' }, { ...ROW, id: 'ap-2' }]).client, null);
  assert.equal(r.ok, true);
  assert.equal(r.pulled, 2, 'the good rows still land');
  assert.equal(n, 3, 'and every row was attempted');
});

test('offline reports not-ok and writes nothing', async () => {
  const { db, execs } = fakeDb();
  const r = await hydrateApprovers(db, sb({ error: 'network' } as any).client, null);
  assert.deepEqual(r, { pulled: 0, updated: 0, ok: false });
  assert.equal(execs.length, 0);
});

test('a project filter is applied only when one is given', async () => {
  const scoped = sb([ROW]);
  await hydrateApprovers(fakeDb().db, scoped.client, 'p-1');
  assert.equal(scoped.seen.project, 'p-1');

  const all = sb([ROW]);
  await hydrateApprovers(fakeDb().db, all.client, null);
  assert.equal(all.seen.project, undefined, 'account-wide: every job, not just the open one');
});
