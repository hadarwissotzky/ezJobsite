/**
 * `discardExtra` against a REAL SQLite database — the RECORD-SCREEN DELETE BUTTON's
 * actual path.
 *   cd apps/mobile && node --test src/discardextra.test.ts
 *
 * WHY THIS EXISTS. discardstore.test.ts and loopcheck step 14 both exercise
 * `discardCapture`. But the record screen's onDelete opens the confirm sheet with NO
 * captureId, so the confirm button calls `discardExtra` (App.tsx ~2623). That path had
 * zero coverage — the exact "the test proves the wrong function" trap discardstore.ts's
 * own header warns about. hadar (2026-07-27): deleting a draft extra "doesn't remove
 * it". These run the button's real calls and assert the row is GONE.
 *
 * No SupabaseClient is passed — that is the offline/local case (mandate #7), which is
 * how a field delete usually runs, and the case a self-test on Wi-Fi would never hit.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { APP_OWNED_DDL } from './captureddl.ts';
import { CHANGE_ORDER_DDL, hydrateChangeOrders } from './changeorder.ts';
import { DECISION_DDL } from './decisions.ts';
import { PAIR_DDL } from './pair.ts';
import { DISCARD_DDL, discardExtra, discardedExtraIds } from './discardstore.ts';

/** A supabase stand-in for hydrateChangeOrders: `.from(t).select().eq()` for the
 *  change_order pull, `.from('approval').select()` for the signer names. It returns
 *  whatever server rows the test hands it — this is how we reproduce "the server
 *  still has the row" that used to resurrect a deleted extra. */
function mockSupabase(coRows: any[]): any {
  return {
    from: (table: string) => ({
      select: (_cols: string) => {
        if (table === 'approval') return Promise.resolve({ data: [], error: null });
        return { eq: (_c: string, _v: string) => Promise.resolve({ data: coRows, error: null }) };
      },
    }),
  };
}

/** The server's view of a draft extra, shaped as hydrateChangeOrders reads it. */
function serverRow(capId: string, status = 'draft') {
  return {
    id: `co-${capId}`, decision_id: `d-${capId}`, project_id: 'p1', scope: 'Untitled extra',
    line_items: [], amount_cents: null, nte_cents: null, is_mini: 0, who_directed: 'Owner',
    ref_estimate: null, numbers_confirmed_at: new Date(0).toISOString(), status,
    created_at: new Date(0).toISOString(),
  };
}

// co_live_link, inlined from activitystore.ts's REMIND_DDL. Importing that module
// pulls in ./activity (i18n etc.), which node --test cannot load — the same reason
// discardstore.ts is type-only. previewDiscard only needs this table to EXIST.
const CO_LIVE_LINK_DDL =
  `CREATE TABLE IF NOT EXISTS co_live_link (
      change_order_id TEXT NOT NULL PRIMARY KEY, token TEXT NOT NULL, url TEXT NOT NULL,
      sent_at_ms INTEGER NOT NULL, remind_count INTEGER NOT NULL DEFAULT 0,
      last_remind_ms INTEGER) STRICT`;

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
  for (const s of [...APP_OWNED_DDL, ...CHANGE_ORDER_DDL, ...DECISION_DDL, PAIR_DDL,
                   CO_LIVE_LINK_DDL, ...DISCARD_DDL]) {
    raw.exec(s);
  }
  return { raw, db: realDb(raw) };
}

const rows = (raw: DatabaseSync, sql: string) => raw.prepare(sql).all() as any[];

/** A voice capture + its decision + draft extra, exactly as the app builds one. */
function seedVoice(raw: DatabaseSync, capId: string, status = 'draft') {
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

test('the button path: a voice-only draft is deleted and leaves the ledger', async () => {
  const { raw, db } = fresh();
  seedVoice(raw, 'capA');
  assert.equal(rows(raw, `SELECT id FROM change_order`).length, 1, 'seeded');

  const r = await discardExtra(db, 'co-capA');   // no client — the offline path
  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  assert.equal(rows(raw, `SELECT id FROM change_order`).length, 0, 'extra must be gone');
  assert.equal(rows(raw, `SELECT capture_id FROM capture_discarded`).length, 1, 'voice tombstoned');
});

test('the button path: a FUSED draft (voice + photos) — extra gone, and no evidence lingers', async () => {
  const { raw, db } = fresh();
  seedVoice(raw, 'capV');
  const now = Date.now();
  // Two photos, committed as their own captures and tied to the voice through a pair —
  // the fused shape. They are NOT in decision_version (only the voice anchor is).
  for (const pid of ['capP1', 'capP2']) {
    raw.prepare(
      `INSERT INTO capture_commit (capture_id, attachment_id, mutation_id, project_id,
         owner_id, media_relpath, media_sha256, media_bytes, media_mime_type, modality,
         captured_at_ms, committed_at_ms, request_sha256)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(pid, `att-${pid}`, `mut-${pid}`, 'p1', 'u1', `m/${pid}.jpg`,
          'b'.repeat(64), 99, 'image/jpeg', 'photo', now, now, 'e'.repeat(64));
  }
  const pair = 'pair-1';
  raw.prepare(`INSERT INTO capture_pair (pair_id, capture_id, role, at_ms) VALUES (?,?,?,?)`)
     .run(pair, 'capV', 'voice', now);
  raw.prepare(`INSERT INTO capture_pair (pair_id, capture_id, role, at_ms) VALUES (?,?,?,?)`)
     .run(pair, 'capP1', 'photo', now);
  raw.prepare(`INSERT INTO capture_pair (pair_id, capture_id, role, at_ms) VALUES (?,?,?,?)`)
     .run(pair, 'capP2', 'photo', now);

  const r = await discardExtra(db, 'co-capV');
  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  assert.equal(rows(raw, `SELECT id FROM change_order`).length, 0, 'extra must be gone');

  // The home "captured walkthroughs" card excludes a pair only when a MEMBER is
  // tombstoned. If just the voice is tombstoned that holds — but the photos are still
  // live captures, so anything that lists captures/evidence will keep showing them.
  const tomb = rows(raw, `SELECT capture_id FROM capture_discarded`).map((x: any) => x.capture_id);
  assert.deepEqual(tomb.sort(), ['capP1', 'capP2', 'capV'],
    'every capture behind the extra — voice AND photos — must be tombstoned');
});

test('a delete writes a change_order tombstone the pull can see', async () => {
  const { raw, db } = fresh();
  seedVoice(raw, 'capT');
  await discardExtra(db, 'co-capT');   // no client → server row still "exists", server_done = 0
  const t = rows(raw, `SELECT change_order_id, server_done FROM change_order_discarded`);
  assert.equal(t.length, 1, 'tombstoned');
  assert.equal(t[0].change_order_id, 'co-capT');
  assert.equal(t[0].server_done, 0, 'server not confirmed offline — drainDiscardedExtras will retry');
  assert.ok((await discardedExtraIds(db)).has('co-capT'), 'exposed to hydrate');
});

// THE ACTUAL BUG. Before the tombstone, this test failed: hydrate re-inserted the
// server's copy of a just-deleted draft and the extra came back on the 15s tick.
test('hydrate does NOT resurrect a locally-deleted extra the server still has', async () => {
  const { raw, db } = fresh();
  seedVoice(raw, 'capG');
  await discardExtra(db, 'co-capG');   // deleted locally; server (mock) still holds it
  assert.equal(rows(raw, `SELECT id FROM change_order`).length, 0, 'gone after delete');

  const hy = await hydrateChangeOrders(db, mockSupabase([serverRow('capG')]), 'p1', 'u1');

  assert.equal(rows(raw, `SELECT id FROM change_order`).length, 0,
    'the deleted extra must STAY gone — hydrate must not re-pull it');
  assert.equal(hy.pulled, 0, 'nothing pulled');
  assert.equal(hy.skipped, 1, 'the discarded extra was skipped, on purpose');
});

test('hydrate still pulls a normal (non-deleted) extra — the skip is specific', async () => {
  const { raw, db } = fresh();
  // decision must exist for the FK; no local change_order — it lives only on the server.
  const now = Date.now();
  raw.prepare(`INSERT INTO decision (id, project_id, owner_id, subject, created_at_ms)
               VALUES (?,?,?,?,?)`).run('d-capN', 'p1', 'u1', 'extra capN', now);

  const hy = await hydrateChangeOrders(db, mockSupabase([serverRow('capN')]), 'p1', 'u1');

  assert.equal(hy.pulled, 1, 'a live server extra this device lacks must land');
  assert.equal(rows(raw, `SELECT id FROM change_order WHERE id = 'co-capN'`).length, 1);
});
