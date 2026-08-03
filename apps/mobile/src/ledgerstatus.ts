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
// TYPE-ONLY, both of them, and it must stay that way — the same rule and the same
// reason changeorder.ts states: a value import of @powersync/react-native pulls in
// React Native's Flow-typed source, which Node cannot parse, and the tests that
// exercise this file's SQL (extratransitions.test.ts) stop running. The explicit
// .ts extensions below are the other half of that: node --test resolves none.
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canTransition } from './extralifecycle.ts';
// Safe under `node --test` for the reason above: diaglog.ts's only import is a
// type-only powersync one. A server refusal that repairs a row silently is the
// same class of bug as the one it repairs, so it lands in the flight recorder.
import { logDiag } from './diaglog.ts';

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

/** The sentinel that rolls the supersession transaction back when the guarded
 *  UPDATE matched nothing. A thrown string rather than a flag because the whole
 *  point is that the queue row must not survive the status write failing. */
const RACED = 'change order was answered before the supersession landed';

/**
 * Retire an extra because a revision replaces it. LOCAL AND IMMEDIATE, no network.
 *
 * The legality check is `canTransition(status,'superseded')` — REQ-LC7 T4, the same
 * single edge `canSupersede` expresses from the other end, asked of the one module
 * that owns the transition table. Only a 'sent' extra, never a signed answer. It is
 * re-read from the row rather than trusted from the caller's stale ledger copy —
 * the client may have answered between the render and the tap, and walking an
 * approval to 'superseded' would erase an outcome she committed to.
 *
 * The row and the intent commit together, the same rule every other queue here
 * follows: a crash between them would leave a retired extra the server never hears
 * about, and the next hydrate would quietly bring it back to life as 'sent'.
 *
 * THE LINEAGE IS WRITTEN HERE NOW, in that same transaction. It used to be a
 * separate UPDATE that `reviseChangeOrder` ran AFTER this returned, and that
 * function was dead code (zero callers): the live revise path — App.tsx
 * startRevision → composer → confirmPriced → createChangeOrder + supersedeExtra —
 * never wrote `change_order.superseded_by` at all, so on the phone that authored a
 * revision the thread could only walk the lineage through `co_supersession`, and a
 * crash between the two statements left a retired row with no forward pointer.
 * One writer, one transaction, no window.
 */
export async function supersedeExtra(
  db: AbstractPowerSyncDatabase,
  o: { changeOrderId: string; supersededBy: string }
): Promise<SupersedeResult> {
  const cur = (await db.getAll<{ status: string }>(
    `SELECT status FROM change_order WHERE id = ?`, [o.changeOrderId]))[0];
  if (!cur) return { ok: false, reason: 'not_found' };
  if (cur.status === 'superseded') return { ok: false, reason: 'already_superseded' };
  if (!canTransition(cur.status, 'superseded')) return { ok: false, reason: 'not_sent' };

  // `superseded_by` arrives by ALTER in ensureDiscussionSchema, so a device that
  // has not run that migration yet simply has nowhere to put the forward pointer.
  // Checked BEFORE the transaction rather than caught inside it: a missing column
  // must not roll back the supersession itself. `supersededBy()` already falls back
  // to co_supersession, and pullThreads refills the column from the server's own.
  const hasLineage = (await db.getAll<{ name: string }>(
    `SELECT name FROM pragma_table_info('change_order')`))
    .some((c) => c.name === 'superseded_by');

  const now = Date.now();
  try {
    await db.writeTransaction(async (tx) => {
      // The WHERE repeats the status test so a concurrent write between the read
      // above and this update cannot slip a terminal answer past the guard.
      // REQ-LC4 dates the move in the same statement, write-once.
      const upd = await tx.execute(
        `UPDATE change_order
            SET status = 'superseded', superseded_at_ms = COALESCE(superseded_at_ms, ?)
          WHERE id = ? AND status = 'sent'`,
        [now, o.changeOrderId]
      );
      // REQ-LC8: read it. Zero rows here means the answer landed between the read
      // and the write, and reporting ok:true would tell the contractor his revision
      // retired a version that is in fact signed. The throw rolls the queue row back
      // with it — a supersession the server would refuse must not be queued either.
      if (!upd.rowsAffected) throw new Error(RACED);
      if (hasLineage) {
        await tx.execute(
          `UPDATE change_order SET superseded_by = ? WHERE id = ? AND superseded_by IS NULL`,
          [o.supersededBy, o.changeOrderId]
        );
      }
      await tx.execute(
        `INSERT OR IGNORE INTO co_supersession
           (change_order_id, superseded_by, at_ms) VALUES (?,?,?)`,
        [o.changeOrderId, o.supersededBy, now]
      );
    });
  } catch (e: any) {
    if (String(e?.message ?? e) === RACED) return { ok: false, reason: 'not_sent' };
    throw e;
  }
  return { ok: true };
}

/** What replaced this extra, if anything — the lineage the ledger can show.
 *
 *  TWO SOURCES, deliberately: `co_supersession` exists only on the device that
 *  AUTHORED the revision (it is the upload intent). A second device learns the
 *  lineage through the synced `change_order.superseded_by` column that
 *  pullThreads hydrates — without the fallback, "see the current version" only
 *  ever appeared on the phone that made the revision (Codex review, 2026-07-22). */
/**
 * WHICH VERSION THIS ROW IS — 1 for an original, 2 for its first revision, and so on.
 *
 * DERIVED FROM THE LINEAGE, never stored. `superseded_by` points FORWARD (old → new),
 * so walking it in reverse yields this row's ancestors; the count of {this row + its
 * ancestors} IS the version number. Storing a counter instead would be a second place
 * for the truth, and it would go wrong exactly when it matters — a revision made on
 * another phone.
 *
 * Depth-capped at 50 for the reason `threadFor` states: a hand-edited row could make a
 * cycle, and an uncapped recursive CTE against a cycle does not return.
 *
 * Returns 1 on any failure. A record whose lineage cannot be read is still a record,
 * and "version 1" is the honest floor — never a blank where a number belongs.
 */
export async function versionNumber(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<number> {
  try {
    const r = (await db.getAll<{ n: number }>(
      `WITH RECURSIVE chain(id, depth) AS (
         SELECT ?, 0
         UNION
         SELECT prior.id, c.depth + 1
           FROM change_order prior JOIN chain c ON prior.superseded_by = c.id
          WHERE c.depth < 50
       )
       SELECT COUNT(*) AS n FROM chain`,
      [changeOrderId]))[0];
    return Math.max(1, r?.n ?? 1);
  } catch {
    return 1;
  }
}

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
 * The server refused a supersession on the merits — the client had already answered
 * — so the local write that was its intent is UNDONE.
 *
 * WHY UNDOING IS THE HONEST MOVE AND NOT A SECOND ILLEGAL TRANSITION. `superseded`
 * on this row exists only because `supersedeExtra` wrote it optimistically while
 * offline, and the one authority that could ratify it has now said no. Nothing was
 * retired; there is no retired version to preserve. Leaving the local row where it
 * is preserves a state that never happened anywhere but here, and the pull cannot
 * clean it up: adopting one terminal status over another is exactly what
 * `canAdoptServerStatus` refuses, and refuses correctly.
 *
 * `WHERE status = 'superseded'` is the guard: if anything else has since moved this
 * row, that move stands and this does nothing. The row goes back to `sent` — the
 * status it held before the local write — and the next `hydrateChangeOrders` on the
 * SAME TICK (App.tsx drains supersessions first, deliberately) then adopts the
 * server's real answer, carrying the signer's name with it.
 *
 * The queue row is DELETED rather than marked uploaded: it is an upload intent, not
 * evidence, and leaving it would keep `supersededBy()` reporting a lineage the
 * server never accepted. The REPLACEMENT extra is untouched — it is a real draft the
 * contractor priced, and it is his to send or delete.
 */
async function undoRefusedSupersession(
  db: AbstractPowerSyncDatabase, changeOrderId: string, actual: string
): Promise<void> {
  void logDiag(db, 'supersede.refused',
    `${changeOrderId}: server says ${actual}; local supersession undone`);
  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `UPDATE change_order SET status = 'sent', superseded_at_ms = NULL
        WHERE id = ? AND status = 'superseded'`, [changeOrderId]);
    // The forward pointer arrives by ALTER (ensureDiscussionSchema), so a device
    // that has not run that migration simply has none to clear.
    try {
      await tx.execute(
        `UPDATE change_order SET superseded_by = NULL WHERE id = ?`, [changeOrderId]);
    } catch { /* no such column on this install */ }
    await tx.execute(
      `DELETE FROM co_supersession WHERE change_order_id = ?`, [changeOrderId]);
  });
}

/**
 * Push supersessions the server has not applied yet.
 *
 * Backoff mirrors drainR5cOutbox rather than inventing a fifth retry policy.
 * Failures are recorded and retried, never dropped: a supersession that silently
 * fails to upload leaves the OLD approval link answerable, and a client can then
 * sign yesterday's price. That is the exact hazard 250_one_live_link exists for,
 * and it reopens if this queue is allowed to fail quietly.
 *
 * A REFUSAL IS NOT AN ERROR, AND READING ONLY `error` MADE IT A SILENT ONE.
 * `supersede_change_order_v1` answers `{"status":"not_superseded","actual":"…"}`
 * with NO error when the client answered first (307_extras_ledger.sql:118-122 —
 * deliberately, "so the device can stop asking rather than retry forever"). This
 * function destructured `error` alone, so that answer stamped `uploaded_at_ms` and
 * `uploaded++`: the contractor's phone kept the local-only `superseded` it had
 * written offline, `reassertSupersessions` stopped covering the row, and the pull
 * refused to adopt one terminal status over another. The result was permanent — the
 * owner's signed $1,850 read "Superseded" on the phone forever and the ledger's
 * approved total was short by that amount, with nothing on screen and nothing in a
 * log. So the payload is READ, and a refusal UNDOES the local write it was the
 * upload intent for: the supersession never happened, so the row goes back to
 * `sent` and the next `hydrateChangeOrders` on the same tick adopts the server's
 * real answer (with the signer's name) through the ordinary path.
 */
export async function drainSupersessions(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient
) {
  const r = { attempted: 0, uploaded: 0, refused: 0, retryable: 0 };
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
      const { data, error } = await supabase.rpc('supersede_change_order_v1', {
        p_id: row.change_order_id,
        p_superseded_by: row.superseded_by,
        p_at_ms: row.at_ms,
      });
      if (error) throw error;
      if ((data as any)?.status === 'not_superseded') {
        await undoRefusedSupersession(db, row.change_order_id,
          String((data as any)?.actual ?? 'unknown'));
        r.refused++;
        continue;
      }
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
 *
 * SINCE THAT WAS WRITTEN, hydrate itself learned to refuse a status move REQ-LC7
 * forbids, which covers `superseded → sent` on its own. This is kept anyway and it
 * is not redundant: hydrate's guard stops the row being walked BACK, and this is
 * what walks a row FORWARD when the local copy is still 'sent' because the
 * supersession was written on a tick the pull also ran. Two different moments.
 *
 * `WHERE status = 'sent'` is REQ-LC7 T4 stated literally, which is what the spec
 * requires of a writer: the pure predicate is a belt, a WHERE clause is what
 * actually protects the row from a bulk update reaching a signed one.
 */
export async function reassertSupersessions(db: AbstractPowerSyncDatabase) {
  const r = await db.execute(
    `UPDATE change_order
        SET status = 'superseded',
            superseded_at_ms = COALESCE(superseded_at_ms,
              (SELECT s.at_ms FROM co_supersession s WHERE s.change_order_id = change_order.id))
      WHERE status = 'sent'
        AND id IN (SELECT change_order_id FROM co_supersession WHERE uploaded_at_ms IS NULL)`
  );
  return { reasserted: r.rowsAffected ?? 0 };
}
