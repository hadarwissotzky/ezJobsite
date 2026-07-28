/**
 * setDraftSummary against a REAL SQLite database.
 *   cd apps/mobile && node --test src/summary.test.ts
 *
 * The owner-facing summary (structure.ts `value`) is written draft-only, and that
 * WHERE clause is the ONLY thing keeping it immutable after send — it is not in the
 * change_order freeze trigger's column list (hadar, 2026-07-27). A mock would agree
 * with whatever the WHERE said; only a real engine proves a sent extra's summary
 * cannot be moved. Also proves the column exists after ensureChangeOrderSchema's
 * migration, so a phone that predates the column still gets it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { CHANGE_ORDER_DDL, ensureChangeOrderSchema } from './changeorder.ts';
import { DECISION_DDL } from './decisions.ts';
import { setDraftSummary } from './startextra.ts';

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

async function fresh() {
  const raw = new DatabaseSync(':memory:');
  for (const s of [...CHANGE_ORDER_DDL, ...DECISION_DDL]) raw.exec(s);
  const db = realDb(raw);
  await ensureChangeOrderSchema(db);   // adds the `summary` column + the freeze trigger
  return { raw, db };
}

function seed(raw: DatabaseSync, capId: string, status = 'draft') {
  const now = Date.now();
  raw.prepare(`INSERT INTO decision (id, project_id, owner_id, subject, created_at_ms)
               VALUES (?,?,?,?,?)`).run(`d-${capId}`, 'p1', 'u1', `extra ${capId}`, now);
  raw.prepare(
    `INSERT INTO change_order (id, decision_id, project_id, owner_id, scope,
       amount_cents, who_directed, numbers_confirmed_at_ms, status, created_at_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(`co-${capId}`, `d-${capId}`, 'p1', 'u1', 'Untitled extra', null, 'Owner', now, status, now);
}

const summaryOf = (raw: DatabaseSync, id: string) =>
  (raw.prepare(`SELECT summary FROM change_order WHERE id = ?`).get(id) as any)?.summary ?? null;

test('a draft gets its summary, trimmed', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'A');
  const ok = await setDraftSummary(db, 'co-A', '  Replace ~12 sq ft of rotted subfloor under the tub.  ');
  assert.equal(ok, true);
  assert.equal(summaryOf(raw, 'co-A'), 'Replace ~12 sq ft of rotted subfloor under the tub.');
});

test('a SENT extra refuses — the summary the client saw cannot move', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'S', 'sent');
  const ok = await setDraftSummary(db, 'co-S', 'a different summary');
  assert.equal(ok, false, 'draft-only WHERE must match nothing on a sent extra');
  assert.equal(summaryOf(raw, 'co-S'), null, 'unchanged');
});

test('empty summary is refused', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'E');
  assert.equal(await setDraftSummary(db, 'co-E', '   '), false);
  assert.equal(summaryOf(raw, 'co-E'), null);
});
