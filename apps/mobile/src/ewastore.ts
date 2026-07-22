/**
 * R3 two-step authorization — the durable half.
 *
 * The decisions are NOT here. They are in `ewa.ts`, which imports nothing and is
 * covered by `ewa.test.ts`. This file is the boring part: local tables, the
 * outbox, and the query that feeds the pure functions. Same split, same reason, as
 * approverrouting.ts / approvers.ts.
 *
 * AN EWA IS A CHANGE ORDER. It is not a parallel record type, and that is the
 * central decision in this file.
 *   Everything a signed instrument needs already hangs off `change_order`:
 *   the frozen-once-sent trigger, the confirmation_request foreign key
 *   (240_shown_content_integrity), one-live-link retirement (250), the marks-sent
 *   trigger (230), the ledger, the record screen, the evidence bundle. A second
 *   table would have had to re-earn every one of those, and the first one it
 *   failed to re-earn would be a signed authorization that nothing could freeze.
 *   So an EWA is a `change_order` row with `amount_cents = 0` and an `ewa` row
 *   beside it carrying the terms.
 *
 * WHY amount_cents = 0 AND NOT NULL: the column is NOT NULL with CHECK >= 0 in
 * three places and cannot be widened without rebuilding a table that holds signed
 * records on phones in the field. Zero is also the truthful number — an
 * authorization commits the client to billability and terms, not to an amount —
 * and it means every existing money total in the app already treats an EWA
 * correctly (AC3/AC5) without a single one of them being edited. The T&M cap rides
 * in `nte_cents`, which is exactly what that column is for.
 *
 * OFFLINE-FORWARD (mandate #7). Every write here is local-first inside one
 * transaction with its outbox row. Creating an EWA, linking a price to it, and
 * recording that a reminder fired all work in a basement.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { SupabaseClient } from '@supabase/supabase-js';
import { sha256 } from 'js-sha256';
import { createChangeOrder } from './changeorder';
import {
  ewaDisplayStatus, isProceedTerm, isSettlementHours, reminderDue, rollUp,
  unpricedState, validateEwaTerms,
  type EwaDisplayStatus, type EwaTerms, type ProceedTerm, type RollUp,
  type SettlementHours, type UnpricedState,
} from './ewa';

export const EWA_DDL = [
  // The terms of a step-one authorization. Keyed BY the change order, 1:1, because
  // the EWA is that change order — not a row that points at one.
  `CREATE TABLE IF NOT EXISTS ewa (
      change_order_id   TEXT NOT NULL PRIMARY KEY,
      project_id        TEXT NOT NULL,
      proceed_term      TEXT NOT NULL CHECK (proceed_term IN ('hold','tm_capped')),
      -- T&M only, integer cents. NULL on 'hold', where the frozen text names no
      -- figures at all and storing one would contradict the instrument.
      hourly_rate_cents INTEGER CHECK (hourly_rate_cents IS NULL OR hourly_rate_cents > 0),
      cap_cents         INTEGER CHECK (cap_cents IS NULL OR cap_cents > 0),
      settlement_hours  INTEGER NOT NULL CHECK (settlement_hours IN (24,48)),
      -- When the client approved. Needed for AC4's clock and NOT derivable from
      -- change_order, which records status but not when it changed.
      approved_at_ms    INTEGER,
      -- The last time the CONTRACTOR was nudged about this being unpriced. Never
      -- the client: AC4 is explicit that the reminder goes to the contractor.
      last_reminded_at_ms INTEGER,
      created_at_ms     INTEGER NOT NULL
   ) STRICT`,

  `CREATE INDEX IF NOT EXISTS ewa_by_project ON ewa (project_id)`,

  // One outbox for every R3 mutation, same (kind, row_id) shape as r5c_outbox and
  // for the same reason: a second device has to learn about the authorization, the
  // settlement link, and the approval moment, and three separate queues would be
  // three separate places to forget to drain.
  //
  // 'remind' is deliberately NOT a kind. A reminder is a local nudge to the person
  // holding this phone; syncing it would let one device silence another's.
  `CREATE TABLE IF NOT EXISTS ewa_outbox (
      mutation_id   TEXT NOT NULL PRIMARY KEY,
      kind          TEXT NOT NULL CHECK (kind IN ('create','settle','approved')),
      row_id        TEXT NOT NULL,
      payload_json  TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      queued_at_ms  INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_text TEXT
   ) STRICT`,
];

export async function ensureEwaSchema(db: AbstractPowerSyncDatabase) {
  for (const s of EWA_DDL) await db.execute(s);
  // The step-2 -> step-1 link lives on the CHILD change order, not on the EWA.
  // A parent pointing at its child would need updating when the child arrives,
  // which means mutating a row the frozen-once-sent trigger protects; a child
  // pointing at its parent is written once, at creation, and never changes.
  //
  // Added by ALTER for the reason approvers.ts states for extra_type: CHANGE_ORDER_DDL
  // is a CREATE TABLE list and this has to run against tables that already exist on
  // phones. SQLite has no ADD COLUMN IF NOT EXISTS, so the error is INSPECTED --
  // blanket-swallowing it would hide a real schema failure behind a no-op.
  try {
    await db.execute(`ALTER TABLE change_order ADD COLUMN parent_ewa_id TEXT`);
  } catch (e: any) {
    if (!/duplicate column/i.test(String(e?.message ?? e))) throw e;
  }
}

const newMutationId = () =>
  `ewm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function enqueue(
  tx: any, kind: 'create' | 'settle' | 'approved', rowId: string,
  payload: Record<string, unknown>, whenMs: number
) {
  const json = JSON.stringify(payload);
  await tx.execute(
    `INSERT INTO ewa_outbox (mutation_id, kind, row_id, payload_json, payload_sha256, queued_at_ms)
     VALUES (?,?,?,?,?,?)`,
    [newMutationId(), kind, rowId, json, sha256(json), whenMs]
  );
}

export type CreateEwaResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * Author a step-one authorization. NO NETWORK, and nothing is sent.
 *
 * `numbersConfirmedAt` is still required, and on an EWA it is not ceremony: a
 * T&M-capped term contains two figures the client will be held to — the rate and
 * the cap — and mandate #6 does not care that they are not a total. A `hold` EWA
 * has no figures at all, and the confirm step is what the contractor used to agree
 * that it has none.
 *
 * The terms are validated BEFORE the change order is written, so a malformed
 * authorization never reaches storage at all. Validating after would leave an
 * orphan priced-at-zero change order in the ledger with no terms beside it — a row
 * the contractor would read as an extra worth nothing.
 */
export async function createEwa(
  db: AbstractPowerSyncDatabase,
  o: {
    id: string; decisionId: string; projectId: string; ownerId: string;
    scope: string; whoDirected: string;
    terms: EwaTerms;
    numbersConfirmedAt: Date;
  }
): Promise<CreateEwaResult> {
  const bad = validateEwaTerms(o.terms);
  if (bad) return { ok: false, reason: bad.k };

  const now = Date.now();
  const co = await createChangeOrder(db, {
    id: o.id, decisionId: o.decisionId, projectId: o.projectId, ownerId: o.ownerId,
    scope: o.scope, whoDirected: o.whoDirected,
    // Step one has no price. See the header: zero is the truthful amount and it is
    // what keeps every existing money total right without touching any of them.
    amountCents: 0,
    nteCents: o.terms.proceed === 'tm_capped' ? o.terms.capCents ?? null : null,
    numbersConfirmedAt: o.numbersConfirmedAt,
  });
  if (!co.ok) return co;

  // The terms row is written AFTER the change order and in its own transaction,
  // which is a real ordering risk worth naming: a crash in between leaves a $0
  // change order with no terms. That is the SAFE direction — the row is still
  // draft, nothing has been sent, and `listEwa` simply will not see it as an EWA.
  // The opposite order (terms first) would leave terms pointing at nothing, which
  // `sendEwa` would happily try to send. createChangeOrder does not expose its
  // transaction, and prising it open is an edit to a file another agent owns.
  try {
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO ewa (change_order_id, project_id, proceed_term, hourly_rate_cents,
           cap_cents, settlement_hours, created_at_ms)
         VALUES (?,?,?,?,?,?,?)`,
        [o.id, o.projectId, o.terms.proceed,
         o.terms.proceed === 'tm_capped' ? o.terms.hourlyRateCents ?? null : null,
         o.terms.proceed === 'tm_capped' ? o.terms.capCents ?? null : null,
         o.terms.settlementHours, now]
      );
      await enqueue(tx, 'create', o.id, {
        change_order_id: o.id, project_id: o.projectId,
        proceed_term: o.terms.proceed,
        hourly_rate_cents: o.terms.hourlyRateCents ?? null,
        cap_cents: o.terms.capCents ?? null,
        settlement_hours: o.terms.settlementHours, created_at_ms: now,
      }, now);
    });
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
  return { ok: true, id: o.id };
}

/**
 * Step 2 names its parent. AC3: "a standard fixed or NTE change order that
 * references its parent EWA; approval closes the EWA."
 *
 * Written on the CHILD at creation time, before it is sent. Linking after the
 * child has been sent would mean editing a row the frozen trigger protects on the
 * server, and — worse — the client would have signed a price whose relationship to
 * the authorization was decided afterwards.
 *
 * Refuses to link to something that is not an EWA. A "settlement" pointing at an
 * ordinary change order would make that change order read "Settled" in the ledger
 * while the real authorization stayed open and unpriced forever.
 */
export async function linkPriceToEwa(
  db: AbstractPowerSyncDatabase, childCoId: string, ewaCoId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // getAll, not get: every other read in this repo uses it, and `get` throws on an
  // empty result rather than returning null — "this is not an EWA" is an ordinary
  // answer here, not an exception.
  const parent = await db.getAll<{ id: string }>(
    `SELECT change_order_id AS id FROM ewa WHERE change_order_id = ?`, [ewaCoId]
  );
  if (!parent.length) return { ok: false, reason: 'ewa.err.notAnEwa' };
  if (childCoId === ewaCoId) return { ok: false, reason: 'ewa.err.selfSettle' };

  const now = Date.now();
  let moved = false;
  await db.writeTransaction(async (tx) => {
    // `status = 'draft'` in the WHERE for the same reason markLocalSent uses it:
    // never re-parent something already in a client's hands.
    const r = await tx.execute(
      `UPDATE change_order SET parent_ewa_id = ? WHERE id = ? AND status = 'draft'`,
      [ewaCoId, childCoId]
    );
    moved = !!r.rowsAffected;
    if (moved) {
      await enqueue(tx, 'settle', childCoId,
        { child_change_order_id: childCoId, ewa_change_order_id: ewaCoId, at_ms: now }, now);
    }
  });
  return moved ? { ok: true } : { ok: false, reason: 'ewa.err.alreadySent' };
}

/**
 * Record WHEN the client approved. AC4's 48h clock starts here and nowhere else.
 *
 * Separate from `applyLocalApproval` (changeorder.ts, which another agent owns and
 * which stores status but not the moment). Idempotent and monotonic: the earliest
 * approval timestamp wins, because two devices draining out of order must not be
 * able to restart the clock and un-flag an authorization that is genuinely late.
 */
export async function markEwaApproved(
  db: AbstractPowerSyncDatabase, ewaCoId: string, approvedAtMs: number
): Promise<boolean> {
  let moved = false;
  await db.writeTransaction(async (tx) => {
    const r = await tx.execute(
      `UPDATE ewa SET approved_at_ms = ?
        WHERE change_order_id = ? AND (approved_at_ms IS NULL OR approved_at_ms > ?)`,
      [approvedAtMs, ewaCoId, approvedAtMs]
    );
    moved = !!r.rowsAffected;
    if (moved) {
      await enqueue(tx, 'approved', ewaCoId,
        { change_order_id: ewaCoId, approved_at_ms: approvedAtMs }, Date.now());
    }
  });
  return moved;
}

/** Local only — see the ewa_outbox comment on why a nudge is never synced. */
export async function markReminded(
  db: AbstractPowerSyncDatabase, ewaCoId: string, whenMs = Date.now()
) {
  await db.execute(
    `UPDATE ewa SET last_reminded_at_ms = ? WHERE change_order_id = ?`, [whenMs, ewaCoId]
  );
}

export type EwaRow = {
  id: string;
  projectId: string;
  scope: string;
  proceed: ProceedTerm;
  hourlyRateCents: number | null;
  capCents: number | null;
  settlementHours: SettlementHours;
  /** The raw change_order.status. */
  rawStatus: string;
  /** What the contractor is shown, including the derived 'settled' (AC3). */
  status: EwaDisplayStatus;
  approvedAtMs: number | null;
  lastRemindedAtMs: number | null;
  signedBy: string | null;
  createdAtMs: number;
  /** The step-2 change order that settles this, once one exists. */
  childId: string | null;
  childStatus: string | null;
  childAmountCents: number | null;
  /** AC4. Derived, never stored — the clock moves whether or not anything wrote. */
  unpriced: UnpricedState;
};

/**
 * Every EWA on a job, with its step-2 child and its derived state.
 *
 * READS LOCALLY, for the reason changeorder.ts's ledger() gives: a contractor in a
 * basement must still see what he authorized. Nothing in this function touches the
 * network.
 *
 * The child join takes the MOST RECENT child, not any child. A step-2 price can be
 * superseded and re-sent (that is R3's whole supersede model), so several children
 * can name the same parent; the live one is the newest, and settling on an older
 * superseded child would show "Settled" against a price nobody agreed to.
 */
export async function listEwa(
  db: AbstractPowerSyncDatabase, projectId: string, nowMs = Date.now()
): Promise<EwaRow[]> {
  const rows = await db.getAll<{
    id: string; project_id: string; scope: string; proceed_term: string;
    hourly_rate_cents: number | null; cap_cents: number | null;
    settlement_hours: number; status: string; signed_by: string | null;
    approved_at_ms: number | null; last_reminded_at_ms: number | null;
    created_at_ms: number;
    child_id: string | null; child_status: string | null; child_amount: number | null;
    child_created_at_ms: number | null;
  }>(
    `SELECT e.change_order_id AS id, e.project_id, co.scope, e.proceed_term,
            e.hourly_rate_cents, e.cap_cents, e.settlement_hours,
            co.status, co.signed_by, e.approved_at_ms, e.last_reminded_at_ms,
            co.created_at_ms,
            c.id AS child_id, c.status AS child_status, c.amount_cents AS child_amount,
            c.created_at_ms AS child_created_at_ms
       FROM ewa e
       JOIN change_order co ON co.id = e.change_order_id
       LEFT JOIN change_order c
              ON c.id = (SELECT c2.id FROM change_order c2
                          WHERE c2.parent_ewa_id = e.change_order_id
                          ORDER BY c2.created_at_ms DESC, c2.id DESC LIMIT 1)
      WHERE e.project_id = ?
      ORDER BY co.created_at_ms DESC`,
    [projectId]
  );

  return rows.map((r) => {
    const proceed: ProceedTerm = isProceedTerm(r.proceed_term) ? r.proceed_term : 'hold';
    // A stored value outside the enum means a corrupt or future row. Fall back to
    // the SAFEST reading rather than throwing: 'hold' and 24h authorize the least
    // and chase the soonest, so a bad row can never quietly widen what the client
    // agreed to. Throwing would blank the ledger, which mandate #1 forbids.
    const settlementHours: SettlementHours =
      isSettlementHours(r.settlement_hours) ? r.settlement_hours : 24;
    const status = ewaDisplayStatus({ status: r.status, childStatus: r.child_status });
    // "Sent" is what AC4 measures, and a child that exists has at minimum been
    // authored; created_at is the only sent-ish moment stored locally, so a drafted
    // but unsent child would clear the flag early. Guarded by status: a child still
    // in 'draft' does NOT count, which is the honest reading of "no Step 2 is sent".
    const childSentAtMs =
      r.child_id && r.child_status !== 'draft' ? r.child_created_at_ms : null;
    return {
      id: r.id, projectId: r.project_id, scope: r.scope, proceed,
      hourlyRateCents: r.hourly_rate_cents, capCents: r.cap_cents,
      settlementHours, rawStatus: r.status, status,
      approvedAtMs: r.approved_at_ms, lastRemindedAtMs: r.last_reminded_at_ms,
      signedBy: r.signed_by, createdAtMs: r.created_at_ms,
      childId: r.child_id, childStatus: r.child_status, childAmountCents: r.child_amount,
      unpriced: unpricedState(
        { status: r.status, approvedAtMs: r.approved_at_ms, childSentAtMs, settlementHours },
        nowMs
      ),
    };
  });
}

/**
 * AC4's contractor-side reminder, as data.
 *
 * Returns the EWAs that need a nudge RIGHT NOW. It deliberately does not display,
 * notify or send anything — the caller decides what a nudge looks like, and
 * mandate #2 means the price itself still leaves by hand. Calling this on app open
 * is exactly what AC4 asks for ("when the contractor opens the app").
 */
export async function dueReminders(
  db: AbstractPowerSyncDatabase, projectId: string, nowMs = Date.now()
): Promise<EwaRow[]> {
  const all = await listEwa(db, projectId, nowMs);
  return all.filter((e) => reminderDue(e.unpriced, e.lastRemindedAtMs, nowMs));
}

/**
 * The job's money, with authorizations accounted for (AC3 + AC5).
 *
 * Takes the plain ledger rows the caller already has, so there is ONE list of
 * change orders and no chance of a row appearing in one total and not the other.
 */
export async function ewaRollUp(
  db: AbstractPowerSyncDatabase,
  projectId: string,
  coRows: { id: string; status: string; amount_cents: number; nte_cents: number | null }[],
  nowMs = Date.now()
): Promise<RollUp> {
  const ewas = await listEwa(db, projectId, nowMs);
  const byId = new Map(ewas.map((e) => [e.id, e]));
  return rollUp(coRows.map((c) => {
    const e = byId.get(c.id);
    return e
      ? { status: e.status, amountCents: 0, capCents: e.capCents, isEwa: true }
      : { status: c.status, amountCents: c.amount_cents, isEwa: false };
  }));
}

/**
 * Push queued R3 mutations. Same rules as every other queue here: delete the
 * intent only on success, idempotent by mutation_id, retry with backoff.
 *
 * Nothing is dropped on failure. An authorization that silently failed to upload
 * is one a second device never learns about, and the contractor would price
 * against a cap the other phone does not know exists.
 */
export async function drainEwaOutbox(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, ownerId: string
) {
  const r = { attempted: 0, uploaded: 0, alreadyApplied: 0, retryable: 0 };
  const rows = await db.getAll<{
    mutation_id: string; kind: string; row_id: string;
    payload_json: string; payload_sha256: string; attempt_count: number;
  }>(
    `SELECT mutation_id, kind, row_id, payload_json, payload_sha256, attempt_count
       FROM ewa_outbox WHERE next_attempt_at_ms <= ?
      ORDER BY queued_at_ms LIMIT 20`,
    [Date.now()]
  );
  for (const row of rows) {
    r.attempted++;
    try {
      const p = JSON.parse(row.payload_json);
      const { data, error } = await supabase.rpc('ingest_ewa_v1', {
        p_mutation_id: row.mutation_id, p_kind: row.kind, p_id: row.row_id,
        p_owner_id: ownerId,
        p_project_id: p.project_id ?? null,
        p_proceed_term: p.proceed_term ?? null,
        p_hourly_rate_cents: p.hourly_rate_cents ?? null,
        p_cap_cents: p.cap_cents ?? null,
        p_settlement_hours: p.settlement_hours ?? null,
        p_ewa_change_order_id: p.ewa_change_order_id ?? null,
        p_approved_at_ms: p.approved_at_ms ?? null,
        p_created_at_ms: p.created_at_ms ?? null,
        p_request_sha256: row.payload_sha256,
      });
      if (error) throw error;
      await db.execute(`DELETE FROM ewa_outbox WHERE mutation_id = ?`, [row.mutation_id]);
      if (data?.status === 'already_applied') r.alreadyApplied++; else r.uploaded++;
    } catch (e: any) {
      const n = row.attempt_count + 1;
      await db.execute(
        `UPDATE ewa_outbox SET attempt_count = ?, next_attempt_at_ms = ?,
           last_error_code = ?, last_error_text = ? WHERE mutation_id = ?`,
        [n, Date.now() + Math.min(60_000 * 2 ** Math.min(n, 6), 30 * 60_000),
         String(e?.code ?? 'unknown'), String(e?.message ?? e).slice(0, 500),
         row.mutation_id]
      );
      r.retryable++;
    }
  }
  return r;
}

/** Is this change order an EWA? Used by the ledger to pick the right chip + label. */
export async function ewaIds(
  db: AbstractPowerSyncDatabase, projectId: string
): Promise<Set<string>> {
  const rows = await db.getAll<{ change_order_id: string }>(
    `SELECT change_order_id FROM ewa WHERE project_id = ?`, [projectId]
  );
  return new Set(rows.map((r) => r.change_order_id));
}
