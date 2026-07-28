/**
 * The transition guards AT THE WRITE SITES, against a real SQLite database. Run:
 *   cd apps/mobile && node --test src/extratransitions.test.ts
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM extralifecycle.test.ts. That one proves the
 * TABLE is right — `canTransition('superseded','approved') === false`. It cannot
 * prove that any code consults it, and DEF-1 was exactly that gap: the rule was
 * knowable and no writer asked. A pure-function test passing while
 * `UPDATE change_order SET status='approved' WHERE id=?` sat in two files is the
 * shape of "green tests, broken product" this project keeps finding.
 *
 * So every test below calls the FUNCTION THE APP CALLS and then reads the row back
 * out of SQLite. The one that matters most is named for what it protects: a retired
 * version and a client's recorded NO must never become a signature, by any path.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  CHANGE_ORDER_DDL, ensureChangeOrderSchema, createChangeOrder, createLinkedExtra,
  originOf, applyLocalApproval, markLocalSent, hydrateChangeOrders,
} from './changeorder.ts';
import {
  LEDGER_STATUS_DDL, supersedeExtra, reassertSupersessions, drainSupersessions,
} from './ledgerstatus.ts';
import { signApproval } from './signing.ts';

/** The PowerSync surface these modules use, over node:sqlite. `rowsAffected` is
 *  load-bearing: every guard below reports a refusal by returning zero from it. */
function realDb(raw: DatabaseSync): any {
  const api = {
    getAll: async (sql: string, params: any[] = []) => raw.prepare(sql).all(...params),
    execute: async (sql: string, params: any[] = []) => {
      const r = raw.prepare(sql).run(...params);
      return { rowsAffected: Number(r.changes) };
    },
    writeTransaction: async (fn: (tx: any) => Promise<void>) => {
      raw.exec('BEGIN');
      try { await fn(api); raw.exec('COMMIT'); }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
  return api;
}

/** A device schema built the way the app builds it — through the real migration
 *  entry point, so the tests also cover the ALTERs and the triggers it creates. */
async function fresh(withLineageColumn = true) {
  const raw = new DatabaseSync(':memory:');
  const db = realDb(raw);
  await ensureChangeOrderSchema(db);
  for (const s of LEDGER_STATUS_DDL) raw.exec(s);
  // `superseded_by` is added by ensureDiscussionSchema in the app, not by
  // CHANGE_ORDER_DDL. Both worlds are exercised: with it, supersedeExtra writes the
  // forward pointer; without it, it must still retire the extra.
  if (withLineageColumn) raw.exec(`ALTER TABLE change_order ADD COLUMN superseded_by TEXT`);
  return { raw, db };
}

const rowOf = (raw: DatabaseSync, id: string): any =>
  raw.prepare(`SELECT * FROM change_order WHERE id = ?`).get(id);

/** A change order in a given status, inserted straight past the writers so the
 *  test can start from a state the writers refuse to produce. */
function seed(raw: DatabaseSync, id: string, status: string, extra: Record<string, any> = {}) {
  const now = Date.now();
  raw.prepare(
    `INSERT INTO change_order (id, decision_id, project_id, owner_id, scope,
       amount_cents, who_directed, numbers_confirmed_at_ms, status, created_at_ms,
       origin_change_order_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, `d-${id}`, 'p1', 'u1', 'Add two outlets', 185000, 'Owner', now, status, now,
        extra.origin ?? null);
}

// ── DEF-1: the defect, at every local write site ──────────────────────────────

test('DEF-1: applyLocalApproval REFUSES a superseded extra and the row does not move', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-sup', 'superseded');

  const r = await applyLocalApproval(db, 'co-sup', 'approved', 'Jane Owner');

  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'not_approvable');
  assert.equal(r.ok === false && r.status, 'superseded', 'the refusal names the real status');
  const row = rowOf(raw, 'co-sup');
  assert.equal(row.status, 'superseded', 'a retired version must never carry a signature');
  assert.equal(row.signed_by, null);
  assert.equal(row.approved_at_ms, null);
});

test('DEF-1: applyLocalApproval REFUSES a declined extra — a recorded NO is not a yes', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-no', 'declined');

  const r = await applyLocalApproval(db, 'co-no', 'approved', 'Jane Owner');

  assert.equal(r.ok, false);
  assert.equal(rowOf(raw, 'co-no').status, 'declined');
  assert.equal(rowOf(raw, 'co-no').signed_by, null);
});

test('DEF-1: an already-approved extra is not approved a second time', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-yes', 'approved');
  const r = await applyLocalApproval(db, 'co-yes', 'approved', 'Someone Else');
  assert.equal(r.ok, false);
  assert.equal(rowOf(raw, 'co-yes').signed_by, null, 'the first signer is not overwritten');
});

test('DEF-1: an approved extra cannot be walked to declined either', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-yes2', 'approved');
  const r = await applyLocalApproval(db, 'co-yes2', 'declined', 'Jane Owner');
  assert.equal(r.ok, false);
  assert.equal(rowOf(raw, 'co-yes2').status, 'approved');
});

test('a legal approval still works, and dates itself (REQ-LC4)', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-live', 'sent');

  const before = Date.now();
  const r = await applyLocalApproval(db, 'co-live', 'approved', 'Jane Owner');

  assert.equal(r.ok, true);
  const row = rowOf(raw, 'co-live');
  assert.equal(row.status, 'approved');
  assert.equal(row.signed_by, 'Jane Owner');
  assert.ok(row.approved_at_ms >= before, 'the moment of the transition is recorded');
  assert.equal(row.declined_at_ms, null, 'and only the moment that happened');
});

test('a DRAFT may still be answered — being behind on sync is not a refusal (mandate #7)', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-behind', 'draft');
  const r = await applyLocalApproval(db, 'co-behind', 'approved', 'Jane Owner');
  assert.equal(r.ok, true, 'the server row is sent; this device has not hydrated it back');
  assert.equal(rowOf(raw, 'co-behind').status, 'approved');
});

test('a decline records its own moment and clears no signature it never had', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-dec', 'sent');
  const r = await applyLocalApproval(db, 'co-dec', 'declined', 'Jane Owner');
  assert.equal(r.ok, true);
  const row = rowOf(raw, 'co-dec');
  assert.equal(row.status, 'declined');
  assert.equal(row.signed_by, null, 'a decline is not signed by anybody');
  assert.ok(row.declined_at_ms > 0);
  assert.equal(row.approved_at_ms, null);
});

test('a missing row is reported as missing, not silently ignored', async () => {
  const { db } = await fresh();
  const r = await applyLocalApproval(db, 'co-ghost', 'approved', 'Jane Owner');
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'not_found');
  assert.equal(r.ok === false && r.status, null);
});

// ── markLocalSent ─────────────────────────────────────────────────────────────

test('markLocalSent moves a draft once, stamps sent_at_ms, and never re-dates it', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-send', 'draft');

  assert.equal(await markLocalSent(db, 'co-send'), true);
  const first = rowOf(raw, 'co-send').sent_at_ms;
  assert.ok(first > 0, 'the send is dated');

  assert.equal(await markLocalSent(db, 'co-send'), false, 'it is not a draft anymore');
  assert.equal(rowOf(raw, 'co-send').sent_at_ms, first,
    'a second call must not move the clock R8 measures from');
});

test('markLocalSent never walks a terminal answer back to sent', async () => {
  const { raw, db } = await fresh();
  for (const s of ['approved', 'declined', 'superseded']) {
    seed(raw, `co-t-${s}`, s);
    assert.equal(await markLocalSent(db, `co-t-${s}`), false, s);
    assert.equal(rowOf(raw, `co-t-${s}`).status, s);
    assert.equal(rowOf(raw, `co-t-${s}`).sent_at_ms, null);
  }
});

// ── supersedeExtra (REQ-LC7 T4) ───────────────────────────────────────────────

test('supersedeExtra retires a sent extra, dates it, and writes the forward pointer', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-v1', 'sent');
  seed(raw, 'co-v2', 'draft');

  const r = await supersedeExtra(db, { changeOrderId: 'co-v1', supersededBy: 'co-v2' });

  assert.equal(r.ok, true);
  const row = rowOf(raw, 'co-v1');
  assert.equal(row.status, 'superseded');
  assert.ok(row.superseded_at_ms > 0, 'REQ-LC4: the retirement is dated');
  assert.equal(row.superseded_by, 'co-v2',
    'the lineage folded in from the dead reviseChangeOrder — same transaction now');
  const q = raw.prepare(`SELECT * FROM co_supersession WHERE change_order_id = ?`).get('co-v1') as any;
  assert.equal(q.superseded_by, 'co-v2', 'and the upload intent commits with it');
});

test('supersedeExtra refuses an APPROVED extra — that would retire a signature', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-signed', 'approved');
  const r = await supersedeExtra(db, { changeOrderId: 'co-signed', supersededBy: 'co-new' });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'not_sent');
  assert.equal(rowOf(raw, 'co-signed').status, 'approved');
  assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM co_supersession`).get() as any).n, 0,
    'nothing may be queued for a supersession that was refused');
});

test('supersedeExtra refuses a draft and a declined extra too', async () => {
  const { raw, db } = await fresh();
  for (const s of ['draft', 'declined']) {
    seed(raw, `co-s-${s}`, s);
    const r = await supersedeExtra(db, { changeOrderId: `co-s-${s}`, supersededBy: 'co-x' });
    assert.equal(r.ok, false, s);
    assert.equal(rowOf(raw, `co-s-${s}`).status, s);
  }
});

test('supersedeExtra still retires the extra on a device with no lineage column', async () => {
  // The column arrives with ensureDiscussionSchema. A phone that has not run it must
  // not lose the supersession itself — the server's own superseded_by refills the
  // lineage later through pullThreads.
  const { raw, db } = await fresh(false);
  seed(raw, 'co-old', 'sent');
  const r = await supersedeExtra(db, { changeOrderId: 'co-old', supersededBy: 'co-new' });
  assert.equal(r.ok, true);
  assert.equal(rowOf(raw, 'co-old').status, 'superseded');
});

test('reassertSupersessions moves ONLY a sent row, and dates it from the local intent', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-p1', 'sent');
  seed(raw, 'co-p2', 'approved');
  // Both have an un-uploaded supersession intent; only the sent one may be re-applied.
  for (const id of ['co-p1', 'co-p2']) {
    raw.prepare(`INSERT INTO co_supersession (change_order_id, superseded_by, at_ms)
                 VALUES (?,?,?)`).run(id, 'co-next', 1_700_000_000_000);
  }

  const r = await reassertSupersessions(db);

  assert.equal(r.reasserted, 1);
  assert.equal(rowOf(raw, 'co-p1').status, 'superseded');
  assert.equal(rowOf(raw, 'co-p1').superseded_at_ms, 1_700_000_000_000,
    'dated when the supersession actually happened, not when the tick noticed');
  assert.equal(rowOf(raw, 'co-p2').status, 'approved', 'a signed extra is never re-asserted');
});

// ── drainSupersessions: a REFUSAL is not an error ─────────────────────────────

test('a server "not_superseded" UNDOES the local supersession instead of banking it', async () => {
  // The failure this pins, end to end. The contractor revises a sent extra while
  // offline (local row → superseded, intent queued). The client signs the still-live
  // link. On reconnect `supersede_change_order_v1` answers
  // {"status":"not_superseded","actual":"approved"} with NO error — 307 does this
  // deliberately so the device stops asking. Reading only `error` stamped
  // uploaded_at_ms and counted it as uploaded, `reassertSupersessions` then stopped
  // covering the row, and the pull will not adopt one terminal status over another.
  // The owner's signed $1,850 read "Superseded" on the phone forever.
  const { raw, db } = await fresh();
  seed(raw, 'co-r1', 'superseded');
  raw.prepare(`UPDATE change_order SET superseded_at_ms = ?, superseded_by = ? WHERE id = ?`)
    .run(1_700_000_000_000, 'co-r2', 'co-r1');
  raw.prepare(`INSERT INTO co_supersession (change_order_id, superseded_by, at_ms)
               VALUES (?,?,?)`).run('co-r1', 'co-r2', 1_700_000_000_000);

  const supabase: any = {
    rpc: async () => ({ data: { status: 'not_superseded', id: 'co-r1', actual: 'approved' }, error: null }),
  };
  const r = await drainSupersessions(db, supabase);

  assert.equal(r.refused, 1);
  assert.equal(r.uploaded, 0, 'a refusal is never reported as an upload');
  const row = rowOf(raw, 'co-r1');
  assert.equal(row.status, 'sent', 'the local-only supersession is undone, not banked');
  assert.equal(row.superseded_at_ms, null);
  assert.equal(row.superseded_by, null);
  assert.equal(
    (raw.prepare(`SELECT COUNT(*) AS n FROM co_supersession WHERE change_order_id = ?`)
      .get('co-r1') as any).n, 0,
    'the dead intent is dropped so reassertSupersessions cannot re-apply it');

  // And the very next hydrate — same tick, App.tsx drains first — now adopts the
  // server's real answer through the ordinary path, with the signer's name.
  const hy = await hydrateChangeOrders(db,
    mockSupabase([serverRow('co-r1', 'approved')],
      [{ change_order_id: 'co-r1', legal_name: 'Jane Owner', action: 'approved' }]),
    'p1', 'u1');
  assert.equal(hy.conflicts, 0);
  assert.equal(rowOf(raw, 'co-r1').status, 'approved');
  assert.equal(rowOf(raw, 'co-r1').signed_by, 'Jane Owner');
});

test('an ACCEPTED supersession still banks normally', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-r3', 'superseded');
  raw.prepare(`INSERT INTO co_supersession (change_order_id, superseded_by, at_ms)
               VALUES (?,?,?)`).run('co-r3', 'co-r4', 1_700_000_000_000);
  const supabase: any = {
    rpc: async () => ({ data: { status: 'superseded', id: 'co-r3' }, error: null }),
  };
  const r = await drainSupersessions(db, supabase);
  assert.equal(r.uploaded, 1);
  assert.equal(r.refused, 0);
  assert.equal(rowOf(raw, 'co-r3').status, 'superseded');
  assert.notEqual(
    (raw.prepare(`SELECT uploaded_at_ms FROM co_supersession WHERE change_order_id = ?`)
      .get('co-r3') as any).uploaded_at_ms, null);
});

// ── hydrateChangeOrders: the downward path ────────────────────────────────────

/** The supabase surface hydrateChangeOrders uses. */
function mockSupabase(coRows: any[], approvals: any[] = []): any {
  return {
    from: (table: string) => ({
      select: (_cols: string) => {
        if (table === 'approval') return Promise.resolve({ data: approvals, error: null });
        return { eq: () => Promise.resolve({ data: coRows, error: null }) };
      },
    }),
  };
}

function serverRow(id: string, status: string) {
  return {
    id, decision_id: `d-${id}`, project_id: 'p1', scope: 'Add two outlets',
    line_items: [], amount_cents: 185000, nte_cents: null, is_mini: 0,
    who_directed: 'Owner', ref_estimate: null,
    numbers_confirmed_at: new Date(0).toISOString(), status,
    created_at: new Date(0).toISOString(),
  };
}

test('hydrate adopts a LEGAL server status — sent here, approved there', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-h1', 'sent');

  const hy = await hydrateChangeOrders(db,
    mockSupabase([serverRow('co-h1', 'approved')],
      [{ change_order_id: 'co-h1', legal_name: 'Jane Owner', action: 'approved' }]),
    'p1', 'u1');

  assert.equal(hy.statusUpdated, 1);
  assert.equal(hy.conflicts, 0);
  assert.equal(rowOf(raw, 'co-h1').status, 'approved');
  assert.equal(rowOf(raw, 'co-h1').signed_by, 'Jane Owner');
  assert.equal(rowOf(raw, 'co-h1').approved_at_ms, null,
    'this device learned WHEN IT LEARNED, which is not when it happened — REQ-LC4');
});

test('DEF-1 by the back door: hydrate REFUSES to un-sign an approved extra', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-h2', 'approved');

  const hy = await hydrateChangeOrders(db, mockSupabase([serverRow('co-h2', 'sent')]), 'p1', 'u1');

  assert.equal(hy.conflicts, 1, 'the disagreement is counted, not swallowed');
  assert.equal(hy.statusUpdated, 0);
  assert.equal(rowOf(raw, 'co-h2').status, 'approved',
    'a signature is not deleted because a pull disagreed');
});

test('hydrate REFUSES to turn a local decline into an approval', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-h3', 'declined');

  const hy = await hydrateChangeOrders(db,
    mockSupabase([serverRow('co-h3', 'approved')],
      [{ change_order_id: 'co-h3', legal_name: 'Jane Owner', action: 'approved' }]),
    'p1', 'u1');

  assert.equal(hy.conflicts, 1);
  assert.equal(rowOf(raw, 'co-h3').status, 'declined');
  assert.equal(rowOf(raw, 'co-h3').signed_by, null);
});

test('hydrate REFUSES to revive a superseded extra as sent', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-h4', 'superseded');
  const hy = await hydrateChangeOrders(db, mockSupabase([serverRow('co-h4', 'sent')]), 'p1', 'u1');
  assert.equal(hy.conflicts, 1);
  assert.equal(rowOf(raw, 'co-h4').status, 'superseded');
});

test('hydrate skips a status this build has never heard of (REQ-LC1)', async () => {
  const { raw, db } = await fresh();
  const hy = await hydrateChangeOrders(db, mockSupabase([serverRow('co-h5', 'viewed')]), 'p1', 'u1');
  assert.equal(hy.skipped, 1);
  assert.equal(hy.pulled, 0);
  assert.equal(rowOf(raw, 'co-h5'), undefined, 'it is not stored as an unknown status either');
});

test('hydrate ADOPTS draft → superseded — a move the SERVER made while this device watched a draft', async () => {
  // The regression this pins. `canTransition('draft','superseded')` is false and
  // correctly so — a draft is corrected, not retired — but hydrate is not PERFORMING
  // the move, it is LEARNING one. A second handset that pulled the row while it was
  // still a draft, before the first phone sent and then revised it, refused this pair
  // on every 15s tick forever and kept rendering a RETIRED version as an editable
  // Stage-1 draft with Edit, Send and Delete live.
  const { raw, db } = await fresh();
  seed(raw, 'co-h7', 'draft');

  const hy = await hydrateChangeOrders(db,
    mockSupabase([serverRow('co-h7', 'superseded')]), 'p1', 'u1');

  assert.equal(hy.conflicts, 0, 'a lawful server outcome is not a conflict');
  assert.equal(hy.statusUpdated, 1);
  assert.equal(rowOf(raw, 'co-h7').status, 'superseded');
});

test('hydrate still REFUSES one terminal status for another — the DEF-1 door stays shut', async () => {
  // The adoption rule is monotonic PROGRESS, not "anything terminal wins". Local
  // superseded vs server approved can only arise from a local write the server
  // rejected, and that is drainSupersessions' refusal to repair — not the pull's to
  // overwrite. Overwriting here would destroy the evidence that the two disagree.
  const { raw, db } = await fresh();
  seed(raw, 'co-h8', 'superseded');
  const hy = await hydrateChangeOrders(db,
    mockSupabase([serverRow('co-h8', 'approved')],
      [{ change_order_id: 'co-h8', legal_name: 'Jane Owner', action: 'approved' }]),
    'p1', 'u1');
  assert.equal(hy.conflicts, 1);
  assert.equal(rowOf(raw, 'co-h8').status, 'superseded');
});

test('hydrate lands D6 lineage on a device that never authored it', async () => {
  // REQ-LC31's origin link is written on ONE phone. Before this, no pull fetched the
  // column, so after a reinstall or on a second handset the follow-on extra came back
  // with a NULL origin — the audit link D6 exists to create, gone on the copy most
  // likely to be opened in a dispute.
  const { raw, db } = await fresh();
  seed(raw, 'co-origin', 'approved');
  const follower = { ...serverRow('co-follow', 'draft'), origin_change_order_id: 'co-origin' };
  const hy = await hydrateChangeOrders(db, mockSupabase([follower]), 'p1', 'u1');
  assert.equal(hy.pulled, 1);
  assert.equal((await originOf(db, 'co-follow'))?.id, 'co-origin');
});

test('a server with no origin column does not take the whole hydrate down with it', async () => {
  // The reason the lineage is a SEPARATE query. `origin_change_order_id` arrives with
  // migration 386; naming it in the main select would make every extra stop syncing
  // on a server that has not run it — and hydrate's error path returns zeros in
  // silence, so nobody would see why.
  const { raw, db } = await fresh();
  const supabase: any = {
    from: () => ({
      select: (cols: string) => {
        if (cols.includes('origin_change_order_id')) {
          return { eq: () => Promise.resolve({ data: null, error: { message: 'column does not exist' } }) };
        }
        if (cols.startsWith('change_order_id')) return Promise.resolve({ data: [], error: null });
        return { eq: () => Promise.resolve({ data: [serverRow('co-noorigin', 'sent')], error: null }) };
      },
    }),
  };
  const hy = await hydrateChangeOrders(db, supabase, 'p1', 'u1');
  assert.equal(hy.pulled, 1, 'the extras still land');
  assert.equal(rowOf(raw, 'co-noorigin').origin_change_order_id, null);
});

test('an identical status is not a conflict and not an update', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-h6', 'sent');
  const hy = await hydrateChangeOrders(db, mockSupabase([serverRow('co-h6', 'sent')]), 'p1', 'u1');
  assert.equal(hy.conflicts, 0);
  assert.equal(hy.statusUpdated, 0);
});

// ── signApproval: the server half of DEF-1 ────────────────────────────────────

/** A PostgREST stand-in holding one change_order status and collecting approvals.
 *  It models the two things the guard depends on: `.in('status', …)` filtering, and
 *  `.select()` returning the rows that actually matched. */
function mockPostgrest(status: string | null) {
  const state = { status, approvals: [] as any[], updates: 0 };
  const client: any = {
    from: (table: string) => {
      if (table === 'approval') {
        return {
          insert: (row: any) => { state.approvals.push(row); return Promise.resolve({ error: null }); },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: state.status === null ? null : { status: state.status }, error: null,
            }),
          }),
        }),
        update: (patch: any) => ({
          eq: () => ({
            in: (_c: string, allowed: string[]) => ({
              select: () => {
                if (state.status !== null && allowed.includes(state.status)) {
                  state.status = patch.status; state.updates++;
                  return Promise.resolve({ data: [{ id: 'co-1' }], error: null });
                }
                return Promise.resolve({ data: [], error: null });
              },
            }),
          }),
        }),
      };
    },
  };
  return { client, state };
}

const signArgs = {
  changeOrderId: 'co-1', projectId: 'p1', shownContent: 'Approve this change order',
  signerLabel: 'Owner', legalName: 'Jane Owner', phoneE164: '+15550001111',
  otpVerifiedAt: new Date(0).toISOString(), action: 'approved' as const,
};

test('DEF-1 server half: signApproval refuses a superseded extra and writes NOTHING', async () => {
  const { client, state } = mockPostgrest('superseded');
  const r = await signApproval(client, signArgs);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : '', /superseded/);
  assert.equal(state.approvals.length, 0, 'no signature is filed against a retired version');
  assert.equal(state.status, 'superseded');
});

test('DEF-1 server half: signApproval refuses a declined extra', async () => {
  const { client, state } = mockPostgrest('declined');
  const r = await signApproval(client, signArgs);
  assert.equal(r.ok, false);
  assert.equal(state.approvals.length, 0);
  assert.equal(state.status, 'declined');
});

test('signApproval refuses an extra the server has never seen', async () => {
  const { client, state } = mockPostgrest(null);
  const r = await signApproval(client, signArgs);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : '', /has not reached the server/);
  assert.equal(state.approvals.length, 0);
});

test('signApproval still records a legal signature and moves the status', async () => {
  const { client, state } = mockPostgrest('sent');
  const r = await signApproval(client, signArgs);
  assert.equal(r.ok, true);
  assert.equal(state.approvals.length, 1);
  assert.equal(state.approvals[0].grade, 'priced');
  assert.equal(state.status, 'approved');
  assert.equal(state.updates, 1);
});

// ── D6 / REQ-LC31: the follow-on extra ────────────────────────────────────────

const newExtra = (id: string, origin?: string) => ({
  id, decisionId: `d-${id}`, projectId: 'p1', ownerId: 'u1',
  scope: 'Move the panel', amountCents: 40000, whoDirected: 'Owner',
  numbersConfirmedAt: new Date(),
  ...(origin ? { originChangeOrderId: origin } : {}),
});

test('a new extra is born a draft with no state-change moments recorded yet', async () => {
  const { raw, db } = await fresh();
  const r = await createChangeOrder(db, newExtra('co-n1'));
  assert.equal(r.ok, true);
  const row = rowOf(raw, 'co-n1');
  assert.equal(row.status, 'draft');
  assert.equal(row.sent_at_ms, null);
  assert.equal(row.approved_at_ms, null);
  assert.equal(row.origin_change_order_id, null);
});

test('D6: a follow-on extra may be created against an APPROVED origin', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-approved', 'approved');
  const before = rowOf(raw, 'co-approved');

  const r = await createLinkedExtra(db, newExtra('co-follow', 'co-approved') as any);

  assert.equal(r.ok, true);
  assert.equal(rowOf(raw, 'co-follow').origin_change_order_id, 'co-approved');
  assert.equal(rowOf(raw, 'co-follow').status, 'draft',
    'a follow-on is an ORDINARY extra: it is priced, previewed and sent like any other');
  // D6's whole content: the approved record is untouched.
  assert.deepEqual(rowOf(raw, 'co-approved'), before,
    'not one column of the origin row may move');
});

test('D6: a follow-on may NOT be hung off a sent, draft, declined or superseded extra', async () => {
  const { raw, db } = await fresh();
  for (const s of ['draft', 'sent', 'declined', 'superseded']) {
    seed(raw, `co-o-${s}`, s);
    const r = await createLinkedExtra(db, newExtra(`co-f-${s}`, `co-o-${s}`) as any);
    assert.equal(r.ok, false, s);
    assert.match(r.ok === false ? r.reason : '', /APPROVED/,
      'the refusal says what the rule is, and names the actual status');
    assert.equal(rowOf(raw, `co-f-${s}`), undefined, 'and nothing was created');
  }
});

test('an origin pointing at nothing is refused rather than dangling', async () => {
  const { db } = await fresh();
  const r = await createLinkedExtra(db, newExtra('co-f0', 'co-nowhere') as any);
  assert.equal(r.ok, false);
});

test('REQ-LC31 rule 3: an origin link cannot be rewritten once set', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-a1', 'approved');
  seed(raw, 'co-a2', 'approved');
  await createLinkedExtra(db, newExtra('co-f1', 'co-a1') as any);

  assert.throws(
    () => raw.prepare(`UPDATE change_order SET origin_change_order_id = ? WHERE id = ?`)
             .run('co-a2', 'co-f1'),
    /set once and never rewritten/);
  assert.equal(rowOf(raw, 'co-f1').origin_change_order_id, 'co-a1');
});

test('originOf reads the lineage back — the column is not write-only', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-a3', 'approved');
  await createLinkedExtra(db, newExtra('co-f2', 'co-a3') as any);

  const o = await originOf(db, 'co-f2');
  assert.equal(o?.id, 'co-a3');
  assert.equal(o?.status, 'approved');
  assert.equal(o?.amountCents, 185000);
  assert.equal(await originOf(db, 'co-a3'), null, 'an extra that follows nothing follows nothing');
});

test('the origin link rides the create payload so the server sees it at insert', async () => {
  const { raw, db } = await fresh();
  seed(raw, 'co-a4', 'approved');
  await createLinkedExtra(db, newExtra('co-f3', 'co-a4') as any);
  const q = raw.prepare(
    `SELECT payload_json FROM change_order_outbox WHERE change_order_id = ?`).get('co-f3') as any;
  assert.equal(JSON.parse(q.payload_json).origin_change_order_id, 'co-a4');
});

// ── the whole point, restated as one test ─────────────────────────────────────

test('NO LOCAL PATH moves a superseded or declined extra to approved', async () => {
  for (const from of ['superseded', 'declined'] as const) {
    const { raw, db } = await fresh();
    seed(raw, 'co-z', from);

    await applyLocalApproval(db, 'co-z', 'approved', 'Jane Owner');
    await markLocalSent(db, 'co-z');
    await supersedeExtra(db, { changeOrderId: 'co-z', supersededBy: 'co-other' });
    await hydrateChangeOrders(db, mockSupabase([serverRow('co-z', 'approved')],
      [{ change_order_id: 'co-z', legal_name: 'Jane Owner', action: 'approved' }]), 'p1', 'u1');
    await reassertSupersessions(db);

    assert.equal(rowOf(raw, 'co-z').status, from, `${from} survived every writer`);
    assert.equal(rowOf(raw, 'co-z').signed_by, null, `${from} gained no signer`);
    assert.equal(rowOf(raw, 'co-z').approved_at_ms, null, `${from} gained no approval time`);
  }
});
