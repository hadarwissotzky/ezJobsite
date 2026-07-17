/**
 * Change Order client — SPEC §7.2, and the UI half of mandate #6.
 *
 * MANDATE #6 is the whole reason this file has a "read-back" step:
 *   "Numbers/prices/measurements are the highest-risk field. NEVER trust them
 *    from the transcript. Read-back + on-screen tap-to-correct. Always."
 *
 * The DB enforces that `numbers_confirmed_at` is NOT NULL, so an unconfirmed
 * price cannot be stored. This file is what makes that constraint reachable by a
 * human: parse a number OUT of what was said, show it back BIG, and make the
 * contractor look at it and agree before anything is sent.
 *
 * The parser is deliberately conservative. It would rather find nothing and make
 * someone type the figure than confidently find the wrong one — a silently wrong
 * price is the failure mode with a lawyer attached. That is why `confidence` is
 * returned and why 'low' forces the field open.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { sha256 } from 'js-sha256';

/**
 * The device authors change orders. The cloud gets a copy.
 *
 * This was a direct insert to Supabase, which meant PRICING REQUIRED SIGNAL --
 * and the list was read from the server, so with no signal you could not even see
 * the change orders you already had. Mandate #7 calls offline-forward paramount
 * and the money was the one thing that ignored it.
 *
 * Same three-part shape as capture and decisions, for the same reasons:
 *   change_order       -- the record. Local, durable, authored here.
 *   change_order_outbox-- transport intent. Deleting a row never destroys a CO.
 * The outbox row is written INSIDE the insert's transaction; a crash between them
 * would leave a priced CO that nothing will ever try to upload.
 */
export const CHANGE_ORDER_DDL = [
  `CREATE TABLE IF NOT EXISTS change_order (
      id            TEXT NOT NULL PRIMARY KEY,
      decision_id   TEXT NOT NULL,
      project_id    TEXT NOT NULL,
      owner_id      TEXT NOT NULL,
      scope         TEXT NOT NULL CHECK (length(scope) > 0),
      line_items    TEXT NOT NULL DEFAULT '[]',
      -- INTEGER cents. Never float. Money in floats is a bug with a lawyer attached.
      amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
      currency      TEXT NOT NULL DEFAULT 'USD',
      nte_cents     INTEGER,
      is_mini       INTEGER NOT NULL DEFAULT 0 CHECK (is_mini IN (0,1)),
      who_directed  TEXT NOT NULL,
      ref_estimate  TEXT,
      -- MANDATE #6: not nullable here either. The device refuses an unconfirmed
      -- price at the same bar the server does, so being offline never lowers it.
      numbers_confirmed_at_ms INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','sent','approved','declined','superseded')),
      signed_by     TEXT,
      created_at_ms INTEGER NOT NULL
   ) STRICT`,

  // Frozen once it leaves: a sent CO is superseded by a new one, never edited.
  // Mirrors change_order_guard() on the server so the rule does not depend on
  // which side you are looking from.
  `CREATE TRIGGER IF NOT EXISTS change_order_frozen
     BEFORE UPDATE ON change_order
     WHEN old.status IN ('sent','approved','declined')
      AND (new.amount_cents IS NOT old.amount_cents
           OR new.scope IS NOT old.scope
           OR new.nte_cents IS NOT old.nte_cents)
     BEGIN SELECT RAISE(ABORT, 'a sent change order is frozen: supersede it'); END`,

  `CREATE TABLE IF NOT EXISTS change_order_outbox (
      mutation_id   TEXT NOT NULL PRIMARY KEY,
      change_order_id TEXT NOT NULL,
      payload_json  TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      queued_at_ms  INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at_ms INTEGER,
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_text TEXT
   ) STRICT`,
];

export async function ensureChangeOrderSchema(db: AbstractPowerSyncDatabase) {
  for (const s of CHANGE_ORDER_DDL) await db.execute(s);
}

export type ParsedMoney = {
  cents: number | null;
  /** low => do NOT prefill as if it were known. Make them type it. */
  confidence: 'high' | 'low' | 'none';
  matched?: string;
};

/**
 * Pull a dollar figure out of spoken/typed text.
 * "add three outlets, four fifty" is NOT parsed as $450 on purpose: spoken
 * numbers are exactly where transcription hallucinates, and a plausible-but-
 * wrong price is worse than no price.
 */
export function parseMoney(text: string): ParsedMoney {
  // $1,234.56 / $450 / 450 dollars — explicit currency markers only.
  const m = text.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/)
    || text.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)\b/i);
  if (m) {
    const cents = Math.round(parseFloat(m[1].replace(/,/g, '')) * 100);
    if (Number.isFinite(cents) && cents >= 0) {
      return { cents, confidence: 'high', matched: m[0] };
    }
  }
  // A bare number MIGHT be a price. Surface it, but never as high confidence.
  const bare = text.match(/\b(\d{2,6}(?:\.\d{2})?)\b/);
  if (bare) {
    return { cents: Math.round(parseFloat(bare[1]) * 100), confidence: 'low', matched: bare[1] };
  }
  return { cents: null, confidence: 'none' };
}

/** Integer cents -> display. Money never becomes a float. */
export function money(cents: number | null): string {
  if (cents === null) return '—';
  const s = Math.abs(cents).toString().padStart(3, '0');
  const whole = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${whole}.${s.slice(-2)}`;
}

/** Text -> integer cents. Used by the tap-to-correct field. */
export function centsFromInput(s: string): number | null {
  const clean = s.replace(/[^0-9.]/g, '');
  if (!clean) return null;
  const v = parseFloat(clean);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100);
}

export type CreateCOResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * Create the CO. NO NETWORK. It commits locally and queues the copy.
 *
 * `numbersConfirmedAt` is required by this signature, by the local CHECK, and by
 * the server RPC. Three locks on the same door, deliberately: mandate #6 says a
 * price a human has not read back must never exist, and being offline is not a
 * reason to lower that bar.
 */
export async function createChangeOrder(
  db: AbstractPowerSyncDatabase,
  o: {
    id: string; decisionId: string; projectId: string; ownerId: string;
    scope: string; amountCents: number; nteCents?: number | null;
    whoDirected: string; refEstimate?: string | null; isMini?: boolean;
    lineItems?: Array<{ description: string; qty: number; unit_cents: number; total_cents: number }>;
    numbersConfirmedAt: Date;
  }
): Promise<CreateCOResult> {
  const now = Date.now();
  const confirmedMs = o.numbersConfirmedAt.getTime();
  const mutationId = `cm-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const lineItems = o.lineItems ?? [];

  const payload = {
    mutation_id: mutationId, id: o.id, decision_id: o.decisionId,
    project_id: o.projectId, scope: o.scope.trim(), line_items: lineItems,
    amount_cents: o.amountCents, nte_cents: o.nteCents ?? null,
    is_mini: o.isMini ? 1 : 0, who_directed: o.whoDirected,
    ref_estimate: o.refEstimate ?? null,
    numbers_confirmed_at_ms: confirmedMs, created_at_ms: now,
  };
  const payloadJson = JSON.stringify(payload);

  try {
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO change_order (id, decision_id, project_id, owner_id, scope,
           line_items, amount_cents, nte_cents, is_mini, who_directed, ref_estimate,
           numbers_confirmed_at_ms, status, created_at_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'draft',?)`,
        [o.id, o.decisionId, o.projectId, o.ownerId, o.scope.trim(),
         JSON.stringify(lineItems), o.amountCents, o.nteCents ?? null,
         o.isMini ? 1 : 0, o.whoDirected, o.refEstimate ?? null, confirmedMs, now]
      );
      // Atomic with the record. Never after it.
      await tx.execute(
        `INSERT INTO change_order_outbox (mutation_id, change_order_id,
           payload_json, payload_sha256, queued_at_ms)
         VALUES (?,?,?,?,?)`,
        [mutationId, o.id, payloadJson, sha256(payloadJson), now]
      );
    });
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
  return { ok: true, id: o.id };
}

/**
 * Push queued change orders. Same rules as every other queue here: delete the
 * intent only on success, idempotent by mutation_id, park permanent rejections
 * rather than discarding them.
 *
 * 23503 is NOT permanent: a CO whose decision has not synced yet is an ordering
 * race the next attempt wins, not a corrupt payload.
 */
const CO_PERMANENT = new Set(['42501', '23505', '23514']);

export async function drainChangeOrderOutbox(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, ownerId: string
) {
  const r = { attempted: 0, uploaded: 0, alreadyApplied: 0, parked: 0, retryable: 0 };
  const rows = await db.getAll<{
    mutation_id: string; payload_json: string; payload_sha256: string; attempt_count: number;
  }>(
    `SELECT mutation_id, payload_json, payload_sha256, attempt_count
       FROM change_order_outbox WHERE next_attempt_at_ms <= ?
      ORDER BY queued_at_ms LIMIT 20`, [Date.now()]
  );

  for (const row of rows) {
    r.attempted++;
    let p: any;
    try { p = JSON.parse(row.payload_json); }
    catch { await parkCO(db, row.mutation_id, 'CORRUPT_PAYLOAD', 'not valid JSON'); r.parked++; continue; }

    try {
      const { data, error } = await supabase.rpc('ingest_change_order_v1', {
        p_mutation_id: p.mutation_id, p_id: p.id, p_decision_id: p.decision_id,
        p_project_id: p.project_id, p_owner_id: ownerId, p_scope: p.scope,
        p_line_items: p.line_items, p_amount_cents: p.amount_cents,
        p_nte_cents: p.nte_cents, p_is_mini: p.is_mini,
        p_who_directed: p.who_directed, p_ref_estimate: p.ref_estimate,
        p_numbers_confirmed_at_ms: p.numbers_confirmed_at_ms,
        p_created_at_ms: p.created_at_ms, p_request_sha256: row.payload_sha256,
      });
      if (error) throw error;
      await db.execute(`DELETE FROM change_order_outbox WHERE mutation_id = ?`, [row.mutation_id]);
      if (data?.status === 'already_applied') r.alreadyApplied++; else r.uploaded++;
    } catch (e: any) {
      const code = e?.code ?? e?.error_code;
      if (CO_PERMANENT.has(code)) {
        await parkCO(db, row.mutation_id, code, e?.message ?? String(e)); r.parked++;
      } else {
        const n = row.attempt_count + 1;
        const delay = Math.min(60_000 * 2 ** Math.min(n, 6), 30 * 60_000);
        await db.execute(
          `UPDATE change_order_outbox SET attempt_count = ?, last_attempt_at_ms = ?,
             next_attempt_at_ms = ?, last_error_code = ?, last_error_text = ?
           WHERE mutation_id = ?`,
          [n, Date.now(), Date.now() + delay, code ?? 'TRANSIENT',
           e?.message ?? String(e), row.mutation_id]
        );
        r.retryable++;
      }
    }
  }
  return r;
}

async function parkCO(db: AbstractPowerSyncDatabase, mutationId: string, code: string, msg: string) {
  await db.execute(
    `UPDATE change_order_outbox SET attempt_count = attempt_count + 1,
       last_attempt_at_ms = ?, next_attempt_at_ms = ?, last_error_code = ?, last_error_text = ?
     WHERE mutation_id = ?`,
    [Date.now(), 8640000000000, code, msg, mutationId]
  );
}

/**
 * §7.3 status ledger: Approved / Pending / Declined + a running total.
 *
 * Reads LOCALLY. It used to select from the server's co_ledger view, so with no
 * signal the list rendered EMPTY -- a contractor standing in a basement was shown
 * no change orders at all, as if the money did not exist. The running total is
 * computed here for the same reason it is derived on the server: a stored total
 * can disagree with the rows it claims to sum.
 */
export type LedgerRow = {
  id: string; scope: string; amount: string; nte: string | null;
  status: string; is_mini: number; signed_by: string | null;
  approved_running: string; synced: number;
};

export async function ledger(db: AbstractPowerSyncDatabase, projectId: string): Promise<LedgerRow[]> {
  const rows = await db.getAll<{
    id: string; scope: string; amount_cents: number; nte_cents: number | null;
    status: string; is_mini: number; signed_by: string | null;
    created_at_ms: number; pending: number;
  }>(
    `SELECT co.id, co.scope, co.amount_cents, co.nte_cents, co.status, co.is_mini,
            co.signed_by, co.created_at_ms,
            EXISTS (SELECT 1 FROM change_order_outbox o WHERE o.change_order_id = co.id) AS pending
       FROM change_order co
      WHERE co.project_id = ?
      ORDER BY co.created_at_ms`,
    [projectId]
  );

  let running = 0;
  return rows.map((r) => {
    if (r.status === 'approved') running += r.amount_cents;
    return {
      id: r.id, scope: r.scope, amount: money(r.amount_cents),
      nte: r.nte_cents == null ? null : money(r.nte_cents),
      status: r.status, is_mini: r.is_mini, signed_by: r.signed_by,
      approved_running: money(running),
      // "on this phone" and "in the cloud" are different facts and the sender is
      // entitled to know which one they are looking at.
      synced: r.pending ? 0 : 1,
    };
  });
}

/** Mark the outcome of a signature locally. The signing path is online-only. */
export async function applyLocalApproval(
  db: AbstractPowerSyncDatabase, coId: string, action: 'approved' | 'declined', legalName: string
) {
  await db.execute(
    `UPDATE change_order SET status = ?, signed_by = ? WHERE id = ?`,
    [action, action === 'approved' ? legalName : null, coId]
  );
}

/**
 * Pull change orders the device does not have. Needed for three real cases, not
 * just migration: a reinstall, a second device, and change orders authored before
 * the device became the author.
 *
 * INSERT OR IGNORE, never overwrite: a local row may have unsent edits, and the
 * device's own record is never clobbered by a copy of itself.
 *
 * STATUS is the one field allowed to come back down, and only for rows with no
 * pending local intent -- an approval is authored on the server (it needs the OTP
 * check), so without this a CO signed on another device reads "draft" here
 * forever. Scope and amount are NEVER refreshed: they are frozen once sent, so a
 * server copy disagreeing with the local row is a bug to surface, not a value to
 * silently adopt.
 *
 * KNOWN LIMIT, stated rather than hidden: this is a pull, not a subscription. It
 * runs on launch and on drain, so a second device's change shows up within a tick
 * of connectivity, not instantly. Real-time multi-device is what PowerSync would
 * buy, and it is not bought here.
 */
export async function hydrateChangeOrders(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, projectId: string, ownerId: string
) {
  const { data, error } = await supabase
    .from('change_order')
    .select('id, decision_id, project_id, scope, line_items, amount_cents, nte_cents, is_mini, who_directed, ref_estimate, numbers_confirmed_at, status, created_at')
    .eq('project_id', projectId);
  if (error || !data) return { pulled: 0, statusUpdated: 0 };

  // The signer's name lives on the approval, not the CO.
  const { data: appr } = await supabase
    .from('approval').select('change_order_id, legal_name, action');
  const signedBy = new Map((appr ?? [])
    .filter((a: any) => a.action === 'approved')
    .map((a: any) => [a.change_order_id, a.legal_name]));

  let pulled = 0, statusUpdated = 0;
  for (const co of data as any[]) {
    const res = await db.execute(
      `INSERT OR IGNORE INTO change_order (id, decision_id, project_id, owner_id, scope,
         line_items, amount_cents, nte_cents, is_mini, who_directed, ref_estimate,
         numbers_confirmed_at_ms, status, signed_by, created_at_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [co.id, co.decision_id, co.project_id, ownerId, co.scope,
       JSON.stringify(co.line_items ?? []), co.amount_cents, co.nte_cents,
       co.is_mini ?? 0, co.who_directed, co.ref_estimate,
       new Date(co.numbers_confirmed_at).getTime(), co.status,
       signedBy.get(co.id) ?? null, new Date(co.created_at).getTime()]
    );
    if (res.rowsAffected) { pulled++; continue; }

    // Existing row: status only, and only if we are not holding an unsent intent.
    const upd = await db.execute(
      `UPDATE change_order SET status = ?, signed_by = ?
        WHERE id = ? AND status IS NOT ?
          AND NOT EXISTS (SELECT 1 FROM change_order_outbox o WHERE o.change_order_id = change_order.id)`,
      [co.status, signedBy.get(co.id) ?? null, co.id, co.status]
    );
    if (upd.rowsAffected) statusUpdated++;
  }
  return { pulled, statusUpdated };
}
