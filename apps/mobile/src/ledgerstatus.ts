/**
 * PRD R7 — the storage/transport half of the ledger's per-item status.
 *
 * The decision logic is NOT here. It is in `extrastatus.ts`, which has no imports
 * so it can be tested (`extrastatus.test.ts`). This file is the boring half:
 * a local mirror of the client's questions, the supersession writer, and the
 * queues that carry both. Same split as approverrouting.ts / approvers.ts.
 *
 * TWO GAPS IN R7, ONE FILE, because they are the same gap wearing two hats: the
 * ledger's status vocabulary had two members no code could ever produce.
 *
 * 1. DISCUSSING WAS WRITE-ONLY. 220_question_path.sql builds the whole question
 *    path — table, RPC, append-only trigger — and the approval page writes to it.
 *    Nothing in apps/mobile ever read it back: grep for `confirmation_question`
 *    across the app returned zero hits. A client's question was stored forever and
 *    shown to nobody, and the extra kept reading "Sent" as though the ball were in
 *    her court. That is the app giving a wrong instruction, not merely an
 *    incomplete one.
 *
 * 2. SUPERSEDED HAD A CHIP AND NO WRITER. 'superseded' is legal in the CHECK on
 *    both sides and the ledger renders it "Revised", but no code path anywhere —
 *    device or server — ever set it. 250_one_live_link.sql supersedes the LINK,
 *    which is a different object.
 *
 * WHY A LOCAL MIRROR OF THE QUESTIONS AND NOT A LIVE READ (mandate #7): the ledger
 * is the screen a contractor opens in a basement. A status that only renders with
 * signal is a status that vanishes exactly when he is standing in front of the
 * client. So the questions land in SQLite and the chip derives from the last known
 * truth, offline, forever.
 *
 * WHY THE QUESTION MIRROR IS APPEND-ONLY: it mirrors an append-only server table
 * (220's `confirmation_question_no_change` trigger) and mandate #1 says evidence
 * tables are append-only. INSERT OR IGNORE on the server's own id makes the pull
 * idempotent without an UPDATE path that could rewrite what a client asked.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { SupabaseClient } from '@supabase/supabase-js';
import { canSupersede } from './extrastatus';

export const LEDGER_STATUS_DDL = [
  // The client's questions, as this device last saw them.
  `CREATE TABLE IF NOT EXISTS co_question (
      -- The SERVER's identity for the question (confirmation_question.id). Using it
      -- as the primary key is what makes the pull idempotent: re-running it inserts
      -- nothing, so a question cannot be double-counted into a false "discussing".
      question_id     INTEGER NOT NULL PRIMARY KEY,
      change_order_id TEXT NOT NULL,
      note            TEXT NOT NULL,
      asked_at_ms     INTEGER NOT NULL,
      -- When this device learned of it. Distinct from asked_at_ms and kept because
      -- they answer different questions: "when did she ask" vs "how stale is my
      -- copy". Conflating them would make an offline week look like silence.
      pulled_at_ms    INTEGER NOT NULL
   ) STRICT`,

  `CREATE INDEX IF NOT EXISTS co_question_by_co ON co_question (change_order_id)`,

  // A revision retiring the version before it. Record AND intent in one row, the
  // way `capture_resolution` is: there is exactly one supersession per change
  // order (it is terminal), so a separate outbox table would only be a second row
  // saying the same thing with its own chance to disagree.
  `CREATE TABLE IF NOT EXISTS co_supersession (
      change_order_id TEXT NOT NULL PRIMARY KEY,
      -- The replacement. NOT NULL: a supersession with no successor is a void, and
      -- voiding is a different act with a different meaning to a client. If void
      -- is ever wanted it gets its own verb rather than a null here.
      superseded_by   TEXT NOT NULL,
      at_ms           INTEGER NOT NULL,
      -- NULL until the server has agreed. This is the pending-intent flag that
      -- reassertSupersessions() reads; see its header for the clobber it prevents.
      uploaded_at_ms  INTEGER,
      attempt_count   INTEGER NOT NULL DEFAULT 0,
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
      last_error_text TEXT
   ) STRICT`,
];

export async function ensureLedgerStatusSchema(db: AbstractPowerSyncDatabase) {
  for (const s of LEDGER_STATUS_DDL) await db.execute(s);
}

// ── questions: the "discussing" signal ────────────────────────────────────────

/**
 * Pull the client questions this device has not seen, for one project.
 *
 * A PULL, NOT A SUBSCRIPTION, and stated rather than hidden — the same limit
 * hydrateChangeOrders carries. It runs on the drain tick, so a question shows up
 * within a tick of connectivity, not instantly. R5b's push notification is what
 * would make it instant, and R5b is not this requirement.
 *
 * Offline is not an error here: the ledger renders from the mirror either way.
 */
export async function hydrateQuestions(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, projectId: string
): Promise<{ pulled: number }> {
  const { data, error } = await supabase.rpc('extra_questions_v1', {
    p_project_id: projectId,
  });
  if (error || !Array.isArray(data)) return { pulled: 0 };

  const now = Date.now();
  let pulled = 0;
  for (const q of data as any[]) {
    // A row missing either identity is dropped, not coerced. It can only come from
    // a newer server shape, and a question filed against the wrong extra is worse
    // than one not shown at all.
    if (q?.question_id == null || !q?.change_order_id) continue;
    const r = await db.execute(
      `INSERT OR IGNORE INTO co_question
         (question_id, change_order_id, note, asked_at_ms, pulled_at_ms)
       VALUES (?,?,?,?,?)`,
      [Number(q.question_id), String(q.change_order_id), String(q.note ?? ''),
       Number(q.asked_at_ms ?? now), now]
    );
    if (r.rowsAffected) pulled++;
  }
  return { pulled };
}

/**
 * Open questions per change order, for this project's ledger.
 *
 * "Open" is decided SERVER-SIDE, in `extra_questions_v1`: it only returns questions
 * whose token has no answer. That is deliberate — the same rule 220 enforces when
 * it refuses a question after an answer — and it keeps one definition of open
 * rather than two that can disagree. The local read is a plain count.
 *
 * Returns a map, not a list, because the caller is inside a render loop over rows.
 */
export async function openQuestions(
  db: AbstractPowerSyncDatabase, projectId: string
): Promise<Record<string, number>> {
  const rows = await db.getAll<{ change_order_id: string; n: number }>(
    `SELECT q.change_order_id, COUNT(*) AS n
       FROM co_question q
       JOIN change_order co ON co.id = q.change_order_id
      WHERE co.project_id = ?
      GROUP BY q.change_order_id`,
    [projectId]
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.change_order_id] = r.n;
  return out;
}

/** The full thread for one extra, oldest first — what she actually asked. */
export async function questionsFor(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<Array<{ note: string; asked_at_ms: number }>> {
  return db.getAll<{ note: string; asked_at_ms: number }>(
    `SELECT note, asked_at_ms FROM co_question
      WHERE change_order_id = ? ORDER BY asked_at_ms`,
    [changeOrderId]
  );
}

// ── supersession: the "revised" writer ────────────────────────────────────────

export type SupersedeResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_sent' | 'already_superseded' };

/**
 * Retire an extra because a revision replaces it. LOCAL AND IMMEDIATE, no network.
 *
 * The legality check is `canSupersede` in the pure module: only a 'sent' extra,
 * never a signed answer. It is re-read from the row inside the transaction rather
 * than trusted from the caller's stale ledger copy — the client may have answered
 * between the render and the tap, and walking an approval to 'superseded' would
 * erase an outcome she committed to.
 *
 * The row and the intent commit together, the same rule every other queue here
 * follows: a crash between them would leave a retired extra the server never hears
 * about, and the next hydrate would quietly bring it back to life as 'sent'.
 */
export async function supersedeExtra(
  db: AbstractPowerSyncDatabase,
  o: { changeOrderId: string; supersededBy: string }
): Promise<SupersedeResult> {
  const cur = (await db.getAll<{ status: string }>(
    `SELECT status FROM change_order WHERE id = ?`, [o.changeOrderId]))[0];
  if (!cur) return { ok: false, reason: 'not_found' };
  if (cur.status === 'superseded') return { ok: false, reason: 'already_superseded' };
  if (!canSupersede(cur.status)) return { ok: false, reason: 'not_sent' };

  const now = Date.now();
  await db.writeTransaction(async (tx) => {
    // The WHERE repeats the status test so a concurrent write between the read
    // above and this update cannot slip a terminal answer past the guard.
    await tx.execute(
      `UPDATE change_order SET status = 'superseded' WHERE id = ? AND status = 'sent'`,
      [o.changeOrderId]
    );
    await tx.execute(
      `INSERT OR IGNORE INTO co_supersession
         (change_order_id, superseded_by, at_ms) VALUES (?,?,?)`,
      [o.changeOrderId, o.supersededBy, now]
    );
  });
  return { ok: true };
}

/** What replaced this extra, if anything — the lineage the ledger can show.
 *
 *  TWO SOURCES, deliberately: `co_supersession` exists only on the device that
 *  AUTHORED the revision (it is the upload intent). A second device learns the
 *  lineage through the synced `change_order.superseded_by` column that
 *  pullThreads hydrates — without the fallback, "see the current version" only
 *  ever appeared on the phone that made the revision (Codex review, 2026-07-22). */
export async function supersededBy(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<string | null> {
  const r = (await db.getAll<{ superseded_by: string }>(
    `SELECT superseded_by FROM co_supersession WHERE change_order_id = ?`,
    [changeOrderId]))[0];
  if (r?.superseded_by) return r.superseded_by;
  try {
    const c = (await db.getAll<{ superseded_by: string | null }>(
      `SELECT superseded_by FROM change_order WHERE id = ?`, [changeOrderId]))[0];
    return c?.superseded_by ?? null;
  } catch {
    // The column arrives with ensureDiscussionSchema; a device that has not run
    // that migration simply has no lineage to show yet.
    return null;
  }
}

/**
 * Push supersessions the server has not applied yet.
 *
 * Backoff mirrors drainR5cOutbox rather than inventing a fifth retry policy.
 * Failures are recorded and retried, never dropped: a supersession that silently
 * fails to upload leaves the OLD approval link answerable, and a client can then
 * sign yesterday's price. That is the exact hazard 250_one_live_link exists for,
 * and it reopens if this queue is allowed to fail quietly.
 */
export async function drainSupersessions(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient
) {
  const r = { attempted: 0, uploaded: 0, retryable: 0 };
  const rows = await db.getAll<{
    change_order_id: string; superseded_by: string; at_ms: number; attempt_count: number;
  }>(
    `SELECT change_order_id, superseded_by, at_ms, attempt_count
       FROM co_supersession
      WHERE uploaded_at_ms IS NULL AND next_attempt_at_ms <= ?
      ORDER BY at_ms LIMIT 20`,
    [Date.now()]
  );
  for (const row of rows) {
    r.attempted++;
    try {
      const { error } = await supabase.rpc('supersede_change_order_v1', {
        p_id: row.change_order_id,
        p_superseded_by: row.superseded_by,
        p_at_ms: row.at_ms,
      });
      if (error) throw error;
      await db.execute(
        `UPDATE co_supersession SET uploaded_at_ms = ? WHERE change_order_id = ?`,
        [Date.now(), row.change_order_id]
      );
      r.uploaded++;
    } catch (e: any) {
      const n = row.attempt_count + 1;
      await db.execute(
        `UPDATE co_supersession SET attempt_count = ?, next_attempt_at_ms = ?,
           last_error_text = ? WHERE change_order_id = ?`,
        [n, Date.now() + Math.min(60_000 * 2 ** Math.min(n, 6), 30 * 60_000),
         String(e?.message ?? e).slice(0, 500), row.change_order_id]
      );
      r.retryable++;
    }
  }
  return r;
}

/**
 * Re-apply supersessions the server has not confirmed yet. CALL AFTER
 * hydrateChangeOrders, on the same tick.
 *
 * THE FAILURE THIS PREVENTS, precisely: hydrateChangeOrders adopts the server's
 * status for any row with no pending `change_order_outbox` entry. A supersession
 * queues in `co_supersession`, which is a different table, so hydrate does not see
 * the pending intent — and if the supersession upload has not landed yet (offline
 * when the contractor revised, online a second later for the pull), the server
 * still says 'sent' and hydrate walks the row back. The contractor watches an extra
 * he retired reappear as live, still offering "Resend link".
 *
 * Editing hydrateChangeOrders' NOT EXISTS clause would have been the tighter fix
 * and is the right one when changeorder.ts is next opened; re-asserting from the
 * pending-intent table is the version that does not require touching a file three
 * other requirements are also editing. Same outcome, one extra call, stated here
 * so it is not mistaken for belt-and-braces.
 */
export async function reassertSupersessions(db: AbstractPowerSyncDatabase) {
  const r = await db.execute(
    `UPDATE change_order SET status = 'superseded'
      WHERE status = 'sent'
        AND id IN (SELECT change_order_id FROM co_supersession WHERE uploaded_at_ms IS NULL)`
  );
  return { reasserted: r.rowsAffected ?? 0 };
}
