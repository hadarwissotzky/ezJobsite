/**
 * `discardCapture` against a REAL SQLite database.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A DEVICE CHECK. hadar tapped Delete on his
 * phone across five builds and it did not work. Every static check said the
 * feature was fine — it typechecks, the guard was unit-tested against
 * hand-built inputs, `feature claims` proved every function is called. All true.
 * None of them execute the SQL.
 *
 * The device check that WOULD have executed it could not be trusted either: it
 * took four round trips to get an edited bundle onto the handset at all, and the
 * error it finally reported was truncated to 70 characters by the very build
 * that was too stale to have my fix in it. A test I cannot get to run is not a
 * test.
 *
 * So this runs the real statements against `node:sqlite`, in-process, in
 * milliseconds, with the real schema. It cannot prove a thumb can reach the
 * button — nothing here can — but it proves the delete actually deletes, which
 * is the half that was silently broken twice.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { CHANGE_ORDER_DDL } from './changeorder.ts';
import { APP_OWNED_DDL } from './captureddl.ts';
import { DECISION_DDL } from './decisions.ts';
import { PAIR_DDL } from './pair.ts';
import { DISCARD_DDL, discardCapture } from './discardstore.ts';

/**
 * The narrow slice of PowerSync's surface `discardstore` uses, backed by real
 * SQLite. Deliberately NOT a mock: a mock would agree with whatever I wrote,
 * which is exactly how the guard shipped broken. `writeTransaction` is a real
 * transaction so a failure mid-way rolls back like the device's would.
 */
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

function fresh() {
  const raw = new DatabaseSync(':memory:');
  for (const s of [...APP_OWNED_DDL, ...CHANGE_ORDER_DDL, ...DECISION_DDL, PAIR_DDL, ...DISCARD_DDL]) {
    raw.exec(s);
  }
  return { raw, db: realDb(raw) };
}

/** A capture as performCapture leaves one, plus the extra startExtraFromCapture
 *  now creates for it. Column list taken from the DDL, not from memory — my
 *  first attempt at this omitted two NOT NULL columns and failed on the device
 *  for a reason that had nothing to do with delete. */
function seed(raw: DatabaseSync, capId: string, status = 'draft') {
  const now = Date.now();
  raw.prepare(
    `INSERT INTO capture_commit (capture_id, attachment_id, mutation_id, project_id,
       owner_id, media_relpath, media_sha256, media_bytes, media_mime_type, modality,
       captured_at_ms, committed_at_ms, request_sha256)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(capId, `att-${capId}`, `mut-${capId}`, 'p1', 'u1', `m/${capId}.m4a`,
        'a'.repeat(64), 31, 'audio/m4a', 'voice', now, now, 'c'.repeat(64));

  raw.prepare(`INSERT INTO decision (id, project_id, owner_id, subject, created_at_ms)
               VALUES (?,?,?,?,?)`).run(`d-${capId}`, 'p1', 'u1', `extra ${capId}`, now);
  raw.prepare(`INSERT INTO decision_version (id, decision_id, value, capture_id, created_at_ms)
               VALUES (?,?,?,?,?)`).run(`dv-${capId}`, `d-${capId}`, 'Untitled', capId, now);
  raw.prepare(
    `INSERT INTO change_order (id, decision_id, project_id, owner_id, scope,
       amount_cents, who_directed, numbers_confirmed_at_ms, status, created_at_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(`co-${capId}`, `d-${capId}`, 'p1', 'u1', 'Untitled extra', null, 'Owner', now, status, now);
}

const rows = (raw: DatabaseSync, sql: string) => raw.prepare(sql).all() as any[];

// THE ONE THAT WAS BROKEN. Every recording now auto-creates a decision_version,
// and the old guard refused whenever one existed — so this returned refused for
// every capture in the app, silently, and the list never changed.
test('a draft extra is deleted, and leaves the ledger', async () => {
  const { raw, db } = fresh();
  seed(raw, 'capA');
  assert.equal(rows(raw, `SELECT id FROM change_order`).length, 1, 'seeded');

  const r = await discardCapture(db, 'capA');

  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  assert.equal(rows(raw, `SELECT id FROM change_order`).length, 0, 'extra must be gone');
  assert.equal(rows(raw, `SELECT capture_id FROM capture_discarded`).length, 1, 'tombstoned');
});

test('a SENT extra refuses, and stays', async () => {
  const { raw, db } = fresh();
  seed(raw, 'capS', 'sent');

  const r = await discardCapture(db, 'capS');

  assert.equal(r.ok, false);
  assert.equal((r as any).reason, 'confirmed');
  assert.equal(rows(raw, `SELECT id FROM change_order`).length, 1, 'sent extra must survive');
  assert.equal(rows(raw, `SELECT capture_id FROM capture_discarded`).length, 0, 'not tombstoned');
});

// "once it is deleted all of the items (recordings, and images) are being
// deleted with it" — the photos go with the recording, not just the row the
// user happened to be looking at.
test('the whole pair group goes — recording and photos', async () => {
  const { raw, db } = fresh();
  seed(raw, 'capV');
  seed(raw, 'capP');
  raw.exec(`INSERT INTO capture_pair (pair_id, capture_id, role, at_ms)
            VALUES ('pair1','capV','voice',1), ('pair1','capP','photo',2)`);

  const r = await discardCapture(db, 'capV');

  assert.equal(r.ok, true);
  assert.equal(r.deleted, 2, 'both captures counted');
  assert.equal(rows(raw, `SELECT capture_id FROM capture_discarded`).length, 2);
  assert.equal(rows(raw, `SELECT id FROM change_order`).length, 0, 'both extras gone');
});

// A group is all-or-nothing: deleting around a sent sibling would leave the
// recording without its photos, or worse, strip evidence from something a
// client has already read.
test('a group with one SENT sibling refuses entirely', async () => {
  const { raw, db } = fresh();
  seed(raw, 'capV2');
  seed(raw, 'capP2', 'sent');
  raw.exec(`INSERT INTO capture_pair (pair_id, capture_id, role, at_ms)
            VALUES ('pair2','capV2','voice',1), ('pair2','capP2','photo',2)`);

  const r = await discardCapture(db, 'capV2');

  assert.equal(r.ok, false);
  assert.equal(rows(raw, `SELECT id FROM change_order`).length, 2, 'nothing removed');
});

test('an unknown capture is refused, not silently ok', async () => {
  const { db } = fresh();
  const r = await discardCapture(db, 'nope');
  assert.equal(r.ok, false);
  assert.equal((r as any).reason, 'not_found');
});
