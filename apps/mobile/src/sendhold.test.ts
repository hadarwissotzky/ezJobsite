/**
 * The queue behind "it goes out on its own".
 *   cd apps/mobile && node --test src/sendhold.test.ts
 *
 * Two halves, tested two ways.
 *
 * REAL SQLITE for the store, because every claim here is a claim about a WHERE clause or
 * an ON CONFLICT clause: that a re-tap leaves one hold rather than two, that it does not
 * reset the queue position, and that the drain order is oldest-first. A mock would agree
 * with whatever I wrote.
 *
 * PURE CALLS for `holdsToDrain`, because it decides how many network sends fire the
 * instant the app is foregrounded, and that is not something a UI test would ever pin
 * down. The unknown-balance rule in particular (attempt exactly one) is invisible until
 * the day six queued extras meet one bar of signal.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  MAX_ATTEMPTS, clearHold, ensureSendHoldSchema, heldCount, heldSends, holdSend,
  holdsToDrain, noteHoldAttempt, type SendHold,
} from './sendhold.ts';

function realDb(db: DatabaseSync): any {
  return {
    getAll: async (sql: string, params: any[] = []) => db.prepare(sql).all(...params),
    execute: async (sql: string, params: any[] = []) => {
      const r = db.prepare(sql).run(...params);
      return { rowsAffected: Number(r.changes) };
    },
  };
}

async function fresh() {
  const db = realDb(new DatabaseSync(':memory:'));
  await ensureSendHoldSchema(db);
  return db;
}

/* ------------------------------------------------------------------- the store -- */

test('the confirmed recipient is stored, not re-derived later', async () => {
  // The reason this is a copy: mandate #2's confirmation was about a specific name and
  // phone. A queue that re-resolves the roster on retry sends something nobody confirmed.
  const db = await fresh();
  await holdSend(db, {
    changeOrderId: 'co-1', approverId: 'a-9', approverName: 'Dana Reyes',
    approverPhone: '+15125550143', atMs: 1000,
  });

  const [h] = await heldSends(db);
  assert.equal(h.approverId, 'a-9');
  assert.equal(h.approverName, 'Dana Reyes');
  assert.equal(h.approverPhone, '+15125550143');
  assert.equal(h.attempts, 0);
});

test('tapping send three times leaves one hold', async () => {
  const db = await fresh();
  for (const at of [1000, 2000, 3000]) {
    await holdSend(db, { changeOrderId: 'co-1', approverName: 'Dana', atMs: at });
  }
  const held = await heldSends(db);
  assert.equal(held.length, 1);
  // And it keeps its ORIGINAL place in the line. Re-tapping is impatience, not a new
  // request, and sending him to the back of his own queue for it would be perverse.
  assert.equal(held[0].heldAtMs, 1000);
});

test('a re-tap clears a failing hold’s attempt count', async () => {
  // He has asked again. That is a fresh intent, and it deserves the full retry budget
  // rather than inheriting the exhausted one.
  const db = await fresh();
  await holdSend(db, { changeOrderId: 'co-1', atMs: 1000 });
  await noteHoldAttempt(db, 'co-1', 'network down');
  await noteHoldAttempt(db, 'co-1', 'network down');
  assert.equal((await heldSends(db))[0].attempts, 2);

  await holdSend(db, { changeOrderId: 'co-1', atMs: 5000 });
  const [h] = await heldSends(db);
  assert.equal(h.attempts, 0);
  assert.equal(h.lastError, null);
});

test('the queue drains oldest first', async () => {
  const db = await fresh();
  await holdSend(db, { changeOrderId: 'newer', atMs: 9000 });
  await holdSend(db, { changeOrderId: 'oldest', atMs: 100 });
  await holdSend(db, { changeOrderId: 'middle', atMs: 4000 });
  assert.deepEqual(
    (await heldSends(db)).map((h) => h.changeOrderId),
    ['oldest', 'middle', 'newer']);
});

test('a failed attempt records why', async () => {
  const db = await fresh();
  await holdSend(db, { changeOrderId: 'co-1', atMs: 1000 });
  await noteHoldAttempt(db, 'co-1', 'CONFIRM_BASE is not set');
  const [h] = await heldSends(db);
  assert.equal(h.attempts, 1);
  assert.equal(h.lastError, 'CONFIRM_BASE is not set');
});

test('clearing removes only the one that sent', async () => {
  const db = await fresh();
  await holdSend(db, { changeOrderId: 'co-1', atMs: 1000 });
  await holdSend(db, { changeOrderId: 'co-2', atMs: 2000 });
  await clearHold(db, 'co-1');
  assert.deepEqual((await heldSends(db)).map((h) => h.changeOrderId), ['co-2']);
});

test('no table yet is "nothing waiting", not a crash', async () => {
  // A launch that predates this schema must reach a screen.
  const db = realDb(new DatabaseSync(':memory:'));
  assert.deepEqual(await heldSends(db), []);
});

/* -------------------------------------------------------------- what may fire -- */

const hold = (id: string, atMs: number, attempts = 0): SendHold => ({
  changeOrderId: id, approverId: null, approverName: null, approverPhone: null,
  heldAtMs: atMs, attempts, lastError: null,
});

test('a known balance fires exactly that many sends', () => {
  const q = [hold('a', 1), hold('b', 2), hold('c', 3)];
  assert.deepEqual(holdsToDrain(q, 2).map((h) => h.changeOrderId), ['a', 'b']);
  assert.deepEqual(holdsToDrain(q, 9).map((h) => h.changeOrderId), ['a', 'b', 'c']);
});

test('zero fires nothing', () => {
  assert.deepEqual(holdsToDrain([hold('a', 1)], 0), []);
  assert.deepEqual(holdsToDrain([hold('a', 1)], -1), []);
});

test('an UNKNOWN balance attempts exactly one, never the whole queue', () => {
  // Unknown is not zero (credits.ts) — but it is not "send everything" either. One
  // round-trip is what turns unknown into known. Six queued extras meeting one bar of
  // signal must not fire six sends.
  const q = [hold('a', 1), hold('b', 2), hold('c', 3)];
  assert.deepEqual(holdsToDrain(q, null).map((h) => h.changeOrderId), ['a']);
});

test('a hold that has failed its budget stops retrying itself', () => {
  const q = [hold('broken', 1, MAX_ATTEMPTS), hold('fine', 2)];
  assert.deepEqual(holdsToDrain(q, 5).map((h) => h.changeOrderId), ['fine']);
  // …but it is STILL WAITING. It has stopped retrying, not been dropped, and the line
  // that tells him what is queued must keep counting it or the app has quietly binned a
  // change order it promised to send.
  assert.equal(heldCount(q), 2);
});

test('one below the budget still retries', () => {
  assert.equal(holdsToDrain([hold('a', 1, MAX_ATTEMPTS - 1)], 5).length, 1);
});
