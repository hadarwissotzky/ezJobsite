/**
 * The company feed's AUTHOR + CREATED-AT columns, against a REAL SQLite database.
 *   cd apps/mobile && node --test src/feedauthor.test.ts
 *
 * hadar, 2026-08-12: "the records should note who created it, when, its current state".
 * The feed already carried `actor`/`atMs` — WHO MOVED IT LAST — and those are a
 * different pair: on an extra the client approved yesterday they name the client. These
 * assert the distinction holds, because a row that quietly showed the last toucher under
 * the words "Raised by" would be a specific false claim about authorship on a record
 * that ends up under a signature.
 *
 * `extra_actor` is written by the real flows, so the join is the only thing under test
 * here; the DDL is the shipped DDL so a renamed column fails loudly rather than
 * returning nulls the UI would render as an absent author.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { CHANGE_ORDER_DDL } from './changeorder.ts';
import { EXTRA_ACTOR_DDL } from './recordactors.ts';
import { LEDGER_STATUS_DDL } from './ledgerstatus.ts';
import { companyFeed } from './feed.ts';

const T0 = 1_760_000_000_000;
const HOUR = 3_600_000;

function freshDb() {
  const raw = new DatabaseSync(':memory:');
  for (const stmt of [...CHANGE_ORDER_DDL, ...EXTRA_ACTOR_DDL, ...LEDGER_STATUS_DDL]) raw.exec(stmt);
  // `project` is PowerSync-managed on the device (a view over ps_data), so it has no
  // DDL to import. The feed reads one column from it; this is that column.
  raw.exec(`CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, name TEXT)`);
  return {
    getAll: async (sql: string, args: any[] = []) => raw.prepare(sql).all(...args) as any[],
    raw,
  } as any;
}

function addCo(db: any, id: string, o: { project?: string; status?: string; created?: number } = {}) {
  db.raw.prepare(
    `INSERT INTO change_order (id, decision_id, project_id, owner_id, scope, who_directed,
                               numbers_confirmed_at_ms, created_at_ms, status, amount_cents)
     VALUES (?,?,?,'u1','Panel upgrade','Owner',?,?,?,125000)`
  ).run(id, `d-${id}`, o.project ?? 'p1', o.created ?? T0, o.created ?? T0, o.status ?? 'draft');
}

function addActor(db: any, id: string, coId: string, act: string, name: string, atMs: number) {
  db.raw.prepare(
    `INSERT INTO extra_actor (id, subject_kind, subject_id, act, name, at_ms, created_at_ms)
     VALUES (?, 'change_order', ?, ?, ?, ?, ?)`
  ).run(id, coId, act, name, atMs, atMs);
}

test('createdBy is the FIRST actor, not the most recent one', async () => {
  const db = freshDb();
  db.raw.prepare(`INSERT INTO project VALUES ('p1','Stanyan St')`).run();
  addCo(db, 'co1', { status: 'sent', created: T0 });
  addActor(db, 'a1', 'co1', 'captured', 'Sam Ruiz', T0);
  addActor(db, 'a2', 'co1', 'priced',   'Sam Ruiz', T0 + HOUR);
  addActor(db, 'a3', 'co1', 'sent',     'Dana Lee', T0 + 2 * HOUR);

  const [f] = await companyFeed(db);
  assert.equal(f.createdBy, 'Sam Ruiz', 'the author is who raised it');
  assert.equal(f.actor, 'Dana Lee', 'the last actor is still reported separately');
  assert.equal(f.createdAtMs, T0);
  assert.equal(f.atMs, T0 + 2 * HOUR, 'the feed still SORTS by last activity');
});

test('an extra with no actor rows has no author — never a guessed one', async () => {
  const db = freshDb();
  addCo(db, 'co1', { created: T0 });
  const [f] = await companyFeed(db);
  assert.equal(f.createdBy, null);
  // created_at_ms still lands: it comes from the row itself, not the actor log.
  assert.equal(f.createdAtMs, T0);
});

test('an extra whose only act is a price still names its author', async () => {
  // The reason the join is not filtered to act='captured': a typed extra never gets
  // that act, and filtering would leave every one of them permanently anonymous.
  const db = freshDb();
  addCo(db, 'co1', { created: T0 });
  addActor(db, 'a1', 'co1', 'priced', 'Marta Gil', T0 + HOUR);
  const [f] = await companyFeed(db);
  assert.equal(f.createdBy, 'Marta Gil');
});

test('two extras keep their own authors', async () => {
  const db = freshDb();
  addCo(db, 'co1', { created: T0 });
  addCo(db, 'co2', { created: T0 + HOUR });
  addActor(db, 'a1', 'co1', 'captured', 'Sam Ruiz', T0);
  addActor(db, 'a2', 'co2', 'captured', 'Dana Lee', T0 + HOUR);
  const feed = await companyFeed(db);
  const by = Object.fromEntries(feed.map((f) => [f.id, f.createdBy]));
  assert.deepEqual(by, { co1: 'Sam Ruiz', co2: 'Dana Lee' });
});

test('an open question is carried so the row can show "needs you", not "waiting"', async () => {
  const db = freshDb();
  addCo(db, 'co1', { status: 'sent', created: T0 });
  db.raw.prepare(
    `INSERT INTO co_question (question_id, change_order_id, note, asked_at_ms, pulled_at_ms)
     VALUES (1, 'co1', 'What brand of panel?', ?, ?)`
  ).run(T0 + HOUR, T0 + HOUR);
  const [f] = await companyFeed(db);
  assert.equal(f.openQuestions, 1);
  assert.equal(f.status, 'sent', 'the stored status is untouched by the question');
});
