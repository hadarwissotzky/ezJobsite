/**
 * THE WRONG-JOB RACE (Codex review, 2026-09-03). Run:
 *   cd apps/mobile && node --test src/rehome.test.ts
 *
 * WHAT THIS EXISTS TO CATCH, and it is not a formatting slip.
 *
 * The change order is minted by a fire-and-forget `startExtraFromCapture`, while the
 * capture promise resolves with a DERIVED id — `co-<captureId>` — for a row that may not
 * exist yet. Step 2 then files the captures to the job the human picked and calls
 * `rehomeDraftExtra` with that id.
 *
 * `rehomeDraftExtra` used to return `void`. So "moved it" and "there was no such row and
 * I did nothing" were the same call, and losing the race meant the extra was inserted
 * moments later under the GPS GUESS while its photos sat on the chosen job. A split
 * record, silently, on the screen that decides where a priced document lives — with
 * mandate #8 inverted, GPS deciding instead of suggesting.
 *
 * The caller now awaits the creation, so the race should not happen. This test is the
 * second line: it pins the BOOLEAN, so the day someone restores `Promise<void>` for
 * tidiness, the failure has somewhere to be noticed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { CHANGE_ORDER_DDL, rehomeDraftExtra } from './changeorder.ts';

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
  // An ARRAY of statements, same as discardstore.test.ts spreads it.
  for (const stmt of CHANGE_ORDER_DDL) raw.exec(stmt);
  return { raw, db: realDb(raw) };
}

const insertDraft = (raw: DatabaseSync, id: string, project: string, status = 'draft') =>
  raw.prepare(
    `INSERT INTO change_order
       (id, decision_id, project_id, owner_id, scope, who_directed,
        numbers_confirmed_at_ms, created_at_ms, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, `d-${id}`, project, 'owner-1', 'Rotted subfloor under the tub',
        'Owner', 0, 1, status);

test('a row that does not exist yet reports FALSE, never silent success', async () => {
  const { db } = fresh();
  // Exactly the lost race: step 2 files to job B and rehomes an id nothing has inserted.
  const moved = await rehomeDraftExtra(db, 'co-cap1', 'job-B');
  assert.equal(moved, false);
});

test('a draft moves to the job the human picked, and says so', async () => {
  const { raw, db } = fresh();
  insertDraft(raw, 'co-cap1', 'job-A-the-gps-guess');
  const moved = await rehomeDraftExtra(db, 'co-cap1', 'job-B-he-chose');
  assert.equal(moved, true);
  const row: any = raw.prepare(`SELECT project_id FROM change_order WHERE id = ?`).get('co-cap1');
  assert.equal(row.project_id, 'job-B-he-chose');
});

test('an extra that is no longer a draft is NOT moved, and reports false', async () => {
  const { raw, db } = fresh();
  // Its instrument is frozen (mandate #5). Rehoming it would edit a sent document.
  insertDraft(raw, 'co-cap1', 'job-A', 'sent');
  const moved = await rehomeDraftExtra(db, 'co-cap1', 'job-B');
  assert.equal(moved, false);
  const row: any = raw.prepare(`SELECT project_id FROM change_order WHERE id = ?`).get('co-cap1');
  assert.equal(row.project_id, 'job-A');
});
