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
import { CHANGE_ORDER_DDL, ensureChangeOrderSchema } from './changeorder.ts';
import { EXTRA_ACTOR_DDL } from './recordactors.ts';
import { APP_OWNED_DDL } from './captureddl.ts';
import { DECISION_DDL } from './decisions.ts';
import { PAIR_DDL } from './pair.ts';
import { MIRROR_DDL } from './evidencemirror.ts';
import { LEDGER_STATUS_DDL } from './ledgerstatus.ts';
import { companyFeed } from './feed.ts';

const T0 = 1_760_000_000_000;
const HOUR = 3_600_000;

/**
 * THE DEVICE SCHEMA IS THE DDL *PLUS THE MIGRATIONS*, and this has to be both.
 *
 * `co_number` and the other later columns are added by `ensureChangeOrderSchema`'s
 * ALTER pass, not by `CHANGE_ORDER_DDL` — an existing install cannot have its table
 * recreated. Applying only the DDL gave a table the shipped code cannot query, and the
 * feed's first read of `co.co_number` failed with "no such column" in the test while
 * working perfectly on a real phone. Running the real migration keeps this honest in
 * both directions: a renamed column still fails loudly, and a newly migrated one does
 * not fail falsely.
 */
async function freshDb() {
  const raw = new DatabaseSync(':memory:');
  // `capture_commit` / `decision_version` / `capture_pair` / `capture_mirror` are the
  // tables the cover-photo subquery reads (2026-08-14; the mirror added 2026-08-21 so a
  // second device shows the cover at all). The SHIPPED DDL, not a hand-written stand-in:
  // a stand-in is how a query passes its test and then fails on a phone against the real
  // column names.
  for (const stmt of [...CHANGE_ORDER_DDL, ...EXTRA_ACTOR_DDL, ...LEDGER_STATUS_DDL,
                      ...APP_OWNED_DDL, ...DECISION_DDL, ...MIRROR_DDL,
                      ...(Array.isArray(PAIR_DDL) ? PAIR_DDL : [PAIR_DDL])]) raw.exec(stmt);
  // `project` is PowerSync-managed on the device (a view over ps_data), so it has no
  // DDL to import. The feed reads one column from it; this is that column.
  raw.exec(`CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, name TEXT)`);
  const db = {
    getAll: async (sql: string, args: any[] = []) => raw.prepare(sql).all(...args) as any[],
    execute: async (sql: string, args: any[] = []) => {
      if (args.length) raw.prepare(sql).run(...args); else raw.exec(sql);
      return { rows: { _array: [] } };
    },
    writeTransaction: async (fn: any) => fn({
      execute: async (sql: string, args: any[] = []) => {
        if (args.length) raw.prepare(sql).run(...args); else raw.exec(sql);
      },
      getAll: async (sql: string, args: any[] = []) => raw.prepare(sql).all(...args) as any[],
    }),
    raw,
  } as any;
  await ensureChangeOrderSchema(db);
  return db;
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
  const db = await freshDb();
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
  const db = await freshDb();
  addCo(db, 'co1', { created: T0 });
  const [f] = await companyFeed(db);
  assert.equal(f.createdBy, null);
  // created_at_ms still lands: it comes from the row itself, not the actor log.
  assert.equal(f.createdAtMs, T0);
});

test('an extra whose only act is a price still names its author', async () => {
  // The reason the join is not filtered to act='captured': a typed extra never gets
  // that act, and filtering would leave every one of them permanently anonymous.
  const db = await freshDb();
  addCo(db, 'co1', { created: T0 });
  addActor(db, 'a1', 'co1', 'priced', 'Marta Gil', T0 + HOUR);
  const [f] = await companyFeed(db);
  assert.equal(f.createdBy, 'Marta Gil');
});

test('two extras keep their own authors', async () => {
  const db = await freshDb();
  addCo(db, 'co1', { created: T0 });
  addCo(db, 'co2', { created: T0 + HOUR });
  addActor(db, 'a1', 'co1', 'captured', 'Sam Ruiz', T0);
  addActor(db, 'a2', 'co2', 'captured', 'Dana Lee', T0 + HOUR);
  const feed = await companyFeed(db);
  const by = Object.fromEntries(feed.map((f) => [f.id, f.createdBy]));
  assert.deepEqual(by, { co1: 'Sam Ruiz', co2: 'Dana Lee' });
});

test('an open question is carried so the row can show "needs you", not "waiting"', async () => {
  const db = await freshDb();
  addCo(db, 'co1', { status: 'sent', created: T0 });
  db.raw.prepare(
    `INSERT INTO co_question (question_id, change_order_id, note, asked_at_ms, pulled_at_ms)
     VALUES (1, 'co1', 'What brand of panel?', ?, ?)`
  ).run(T0 + HOUR, T0 + HOUR);
  const [f] = await companyFeed(db);
  assert.equal(f.openQuestions, 1);
  assert.equal(f.status, 'sent', 'the stored status is untouched by the question');
});

/* ------------------------------------------------------------- cover photo -- */

const SHA = 'a'.repeat(64);

/** Commit one capture and hang it off `coId`'s decision, the way the real flows do. */
function addCapture(db: any, o: {
  coId: string; captureId: string; modality: 'photo' | 'voice'; relpath: string; atMs: number;
}) {
  db.raw.prepare(
    `INSERT INTO capture_commit (capture_id, attachment_id, mutation_id, project_id,
       owner_id, media_relpath, media_sha256, media_bytes, media_mime_type, modality,
       captured_at_ms, committed_at_ms, request_sha256)
     VALUES (?,?,?,'p1','u1',?,?,10,'image/jpeg',?,?,?,?)`
  ).run(o.captureId, `att-${o.captureId}`, `mut-${o.captureId}`, o.relpath, SHA,
        o.modality, o.atMs, o.atMs, SHA);
  // `decision_version.decision_id` has a real FK, so the parent has to exist — the
  // same order the capture flow writes them in.
  db.raw.prepare(
    `INSERT OR IGNORE INTO decision (id, project_id, owner_id, subject, created_at_ms)
     VALUES (?, 'p1', 'u1', 'Panel upgrade', ?)`
  ).run(`d-${o.coId}`, o.atMs);
  db.raw.prepare(
    `INSERT INTO decision_version (id, decision_id, value, capture_id, created_at_ms)
     VALUES (?,?,'v1',?,?)`
  ).run(`dv-${o.captureId}`, `d-${o.coId}`, o.captureId, o.atMs);
}

test('the row carries the FIRST photo, so the card can show a cover', async () => {
  const db = await freshDb();
  addCo(db, 'co1', { created: T0 });
  addCapture(db, { coId: 'co1', captureId: 'c2', modality: 'photo',
                   relpath: 'media/second.jpg', atMs: T0 + HOUR });
  addCapture(db, { coId: 'co1', captureId: 'c1', modality: 'photo',
                   relpath: 'media/first.jpg', atMs: T0 });

  const [f] = await companyFeed(db);
  // EARLIEST, not "whichever the join happened to reach first" — the same extra must
  // show the same cover here as it does on the job list and on Home.
  assert.equal(f.photoRelpath, 'media/first.jpg');
});

test('a voice-only extra has no cover — the card draws its placeholder', async () => {
  const db = await freshDb();
  addCo(db, 'co1', { created: T0 });
  addCapture(db, { coId: 'co1', captureId: 'c1', modality: 'voice',
                   relpath: 'media/note.m4a', atMs: T0 });

  const [f] = await companyFeed(db);
  // Null, never the voice file: handing an audio relpath to an <Image> is a broken
  // tile, and a broken tile reads as a lost photo.
  assert.equal(f.photoRelpath, null);
});

test('a photo on ANOTHER extra is not borrowed as this one\'s cover', async () => {
  const db = await freshDb();
  addCo(db, 'co1', { created: T0 });
  addCo(db, 'co2', { created: T0 + HOUR });
  addCapture(db, { coId: 'co2', captureId: 'c1', modality: 'photo',
                   relpath: 'media/other.jpg', atMs: T0 });

  const rows = await companyFeed(db);
  const one = rows.find((r) => r.id === 'co1')!;
  const two = rows.find((r) => r.id === 'co2')!;
  assert.equal(one.photoRelpath, null);
  assert.equal(two.photoRelpath, 'media/other.jpg');
});
