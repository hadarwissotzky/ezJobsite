/**
 * The approval celebration.
 *   cd apps/mobile && node --test src/celebrate.test.ts
 *
 * REAL SQLITE, because every claim about which approvals surface is a claim about a WHERE
 * clause, a LEFT JOIN and a seed statement — and the seed in particular can only be
 * proven by creating the table against a database that already holds approved rows. That
 * is the exact condition of the first launch after this ships, and getting it wrong
 * throws fireworks for every extra ever approved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  celebrationDescription, celebrationLine, ensureCelebrateSchema, markCelebrated,
  pendingCelebrations,
} from './celebrate.ts';

function realDb(db: DatabaseSync): any {
  return {
    getAll: async (sql: string, params: any[] = []) => db.prepare(sql).all(...params),
    execute: async (sql: string, params: any[] = []) => {
      const r = db.prepare(sql).run(...params);
      return { rowsAffected: Number(r.changes) };
    },
  };
}

/** Just the columns this module reads — the shipped DDL's shape for each of them. */
const BASE_DDL = [
  `CREATE TABLE change_order (
      id TEXT NOT NULL PRIMARY KEY, project_id TEXT NOT NULL, scope TEXT NOT NULL,
      scope_of_work TEXT, amount_cents INTEGER, signed_by TEXT, status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL, approved_at_ms INTEGER) STRICT`,
  `CREATE TABLE project (id TEXT NOT NULL PRIMARY KEY, name TEXT) STRICT`,
];

async function fresh(seed: Array<Record<string, unknown>> = [], withProject = true) {
  const raw = new DatabaseSync(':memory:');
  const db = realDb(raw);
  for (const s of BASE_DDL) await db.execute(s);
  if (withProject) await db.execute(`INSERT INTO project (id, name) VALUES ('p-1','Oak St')`);
  for (const r of seed) {
    await db.execute(
      `INSERT INTO change_order
         (id, project_id, scope, scope_of_work, amount_cents, signed_by, status,
          created_at_ms, approved_at_ms)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [r.id, r.project_id ?? 'p-1', r.scope ?? 'Extra outlet', r.scope_of_work ?? null,
       r.amount_cents ?? 45000, r.signed_by ?? 'Dana Reyes', r.status ?? 'approved',
       r.created_at_ms ?? 1000, r.approved_at_ms ?? null]);
  }
  return db;
}

/* ------------------------------------------------------------- the watermark -- */

test('the FIRST launch celebrates nothing that was already approved', async () => {
  // The whole point of the seed. Without it, shipping this throws confetti for every
  // extra ever signed, back to back, which teaches him the popup means nothing.
  const db = await fresh([
    { id: 'old-1' }, { id: 'old-2' }, { id: 'draft-1', status: 'draft' },
  ]);
  await ensureCelebrateSchema(db, 0);
  assert.deepEqual(await pendingCelebrations(db), []);
});

test('an approval that lands AFTER the table exists IS news', async () => {
  const db = await fresh([{ id: 'old-1' }]);
  await ensureCelebrateSchema(db, 0);
  await db.execute(
    `INSERT INTO change_order (id, project_id, scope, status, created_at_ms, amount_cents)
     VALUES ('new-1','p-1','Relocate panel','approved',2000,125000)`);
  assert.deepEqual(
    (await pendingCelebrations(db)).map((c) => c.changeOrderId), ['new-1']);
});

test('re-running the schema does NOT re-seed over live news', async () => {
  // ensureCelebrateSchema runs on every launch. If the seed were unconditional, an
  // approval that arrived while the app was closed would be stamped as already-seen on
  // the very next start and he would never see it.
  const db = await fresh([]);
  await ensureCelebrateSchema(db, 0);
  await db.execute(
    `INSERT INTO change_order (id, project_id, scope, status, created_at_ms)
     VALUES ('new-1','p-1','Relocate panel','approved',2000)`);
  await ensureCelebrateSchema(db, 0);
  assert.equal((await pendingCelebrations(db)).length, 1);
});

/* ----------------------------------------------------------------- the queue -- */

test('only approved rows surface', async () => {
  const db = await fresh();
  await ensureCelebrateSchema(db, 0);
  for (const st of ['draft', 'sent', 'declined', 'superseded', 'approved']) {
    await db.execute(
      `INSERT INTO change_order (id, project_id, scope, status, created_at_ms)
       VALUES (?, 'p-1', 'x', ?, 1)`, [`co-${st}`, st]);
  }
  assert.deepEqual(
    (await pendingCelebrations(db)).map((c) => c.changeOrderId), ['co-approved']);
});

test('the queue reads forward — oldest approval first', async () => {
  const db = await fresh();
  await ensureCelebrateSchema(db, 0);
  await db.execute(`INSERT INTO change_order (id,project_id,scope,status,created_at_ms,approved_at_ms)
                    VALUES ('b','p-1','x','approved',1,9000)`);
  await db.execute(`INSERT INTO change_order (id,project_id,scope,status,created_at_ms,approved_at_ms)
                    VALUES ('a','p-1','x','approved',1,100)`);
  // No approved_at_ms (an older row): falls back to created_at_ms rather than sorting as
  // null and jumping the queue.
  await db.execute(`INSERT INTO change_order (id,project_id,scope,status,created_at_ms)
                    VALUES ('c','p-1','x','approved',5000)`);
  assert.deepEqual(
    (await pendingCelebrations(db)).map((c) => c.changeOrderId), ['a', 'c', 'b']);
});

test('approvals on OTHER jobs surface too, carrying their job id', async () => {
  // A signature on another jobsite is still the best news he gets today. The popup has to
  // be able to switch jobs before opening the record, so the id travels with it.
  const db = await fresh();
  await ensureCelebrateSchema(db, 0);
  await db.execute(`INSERT INTO project (id,name) VALUES ('p-2','Maple Ave')`);
  await db.execute(`INSERT INTO change_order (id,project_id,scope,status,created_at_ms)
                    VALUES ('co-2','p-2','x','approved',1)`);
  const [c] = await pendingCelebrations(db);
  assert.equal(c.projectId, 'p-2');
  assert.equal(c.projectName, 'Maple Ave');
});

test('an unsynced job row loses the NAME, never the celebration', async () => {
  // An INNER JOIN here would swallow the most important event in the product because a
  // cosmetic label had not synced yet.
  const db = await fresh();
  await ensureCelebrateSchema(db, 0);
  await db.execute(`INSERT INTO change_order (id,project_id,scope,status,created_at_ms)
                    VALUES ('co-9','p-missing','x','approved',1)`);
  const [c] = await pendingCelebrations(db);
  assert.equal(c.changeOrderId, 'co-9');
  assert.equal(c.projectName, null);
});

test('dismissing one leaves the rest queued', async () => {
  const db = await fresh();
  await ensureCelebrateSchema(db, 0);
  for (const id of ['a', 'b']) {
    await db.execute(`INSERT INTO change_order (id,project_id,scope,status,created_at_ms)
                      VALUES (?, 'p-1','x','approved',1)`, [id]);
  }
  await markCelebrated(db, 'a');
  assert.deepEqual((await pendingCelebrations(db)).map((c) => c.changeOrderId), ['b']);
});

test('no table yet is "nothing to celebrate", not a crash', async () => {
  const db = await fresh([{ id: 'old-1' }]);
  assert.deepEqual(await pendingCelebrations(db), []);
});

/* ------------------------------------------------------------------ the copy -- */

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

test('the line names whoever and whatever is actually known', () => {
  assert.deepEqual(celebrationLine({ signedBy: 'Dana', amountCents: 45000 }, money),
    { k: 'cel.byFor', p: { who: 'Dana', amount: '$450.00' } });
  assert.deepEqual(celebrationLine({ signedBy: 'Dana', amountCents: null }, money),
    { k: 'cel.by', p: { who: 'Dana' } });
  assert.deepEqual(celebrationLine({ signedBy: null, amountCents: 45000 }, money),
    { k: 'cel.for', p: { amount: '$450.00' } });
  assert.deepEqual(celebrationLine({ signedBy: '   ', amountCents: null }, money),
    { k: 'cel.plain', p: {} });
});

test('a NULL price never renders as $0.00 over a signature', () => {
  // amount_cents is nullable by design: null means "no price was stated", which is a
  // different fact from free. Printing $0.00 here is the most expensive sentence this app
  // could show a contractor about work he just got approved.
  const l = celebrationLine({ signedBy: 'Dana', amountCents: null }, money);
  assert.equal(l.k, 'cel.by');
  assert.equal(JSON.stringify(l.p).includes('0.00'), false);
});

test('a zero price is a real price and still shows', () => {
  assert.deepEqual(celebrationLine({ signedBy: null, amountCents: 0 }, money),
    { k: 'cel.for', p: { amount: '$0.00' } });
});

test('the popup carries the TITLE, not the fourteen-hundred-character signed body', () => {
  // A real approved record on the dev phone has a scope_of_work of ~1400 characters
  // (WHY THIS IS NEEDED / WHAT WILL BE DONE / CONDITIONS). That belongs on the record,
  // not in a popup hadar described as "like an SMS".
  assert.equal(
    celebrationDescription({
      scope: 'Fireplace facing restoration',
      scopeOfWork: 'WHY THIS IS NEEDED\nThe owner wants the existing modern facing…',
    }),
    'Fireplace facing restoration');
  assert.equal(celebrationDescription({ scope: 'Panel', scopeOfWork: null }), 'Panel');
});

test('an empty title falls back to the body rather than an empty headline', () => {
  // `scope` is NOT NULL with a length CHECK locally, but rows also arrive from the
  // server. A blank line over a signature is worse than a long one.
  assert.equal(
    celebrationDescription({ scope: '   ', scopeOfWork: 'Relocate the main panel 6ft' }),
    'Relocate the main panel 6ft');
});

/**
 * THE BUG hadar HIT ON 2026-08-24: "every time I log into 415497 I get this message of
 * approval". A fresh sign-in (or `purgeLocalData` on a device handover) drops these
 * tables, so the row-by-row seed runs against an EMPTY `change_order` and marks nothing;
 * hydration then delivers months of already-approved extras and every one reads as news.
 */
test('an approval that predates this install is history, not news', async () => {
  const db = await fresh([]);
  // The device meets the account at t=5000. Nothing existed locally when it did.
  await ensureCelebrateSchema(db, 5000);
  // …then the hydrate arrives, carrying an approval the client signed long before.
  await db.execute(
    `INSERT INTO change_order (id,project_id,scope,status,created_at_ms,approved_at_ms)
     VALUES ('co-old','p1','Signed in July','approved',900,1000)`);
  assert.deepEqual(await pendingCelebrations(db), [],
    'confetti for a job approved before this phone ever saw the account');
});

test('an approval that lands after the install still celebrates', async () => {
  const db = await fresh([]);
  await ensureCelebrateSchema(db, 5000);
  await db.execute(
    `INSERT INTO change_order (id,project_id,scope,status,created_at_ms,approved_at_ms)
     VALUES ('co-new','p1','Signed just now','approved',5100,6000)`);
  const out = await pendingCelebrations(db);
  assert.equal(out.length, 1);
  assert.equal(out[0].changeOrderId, 'co-new');
});

test('an approval exactly ON the epoch counts as news, not history', async () => {
  const db = await fresh([]);
  await ensureCelebrateSchema(db, 5000);
  await db.execute(
    `INSERT INTO change_order (id,project_id,scope,status,created_at_ms,approved_at_ms)
     VALUES ('co-edge','p1','Same millisecond','approved',4000,5000)`);
  assert.equal((await pendingCelebrations(db)).length, 1);
});
