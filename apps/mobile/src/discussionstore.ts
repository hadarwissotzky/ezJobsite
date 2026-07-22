/**
 * R5b storage + transport. The boring half of discussion.ts.
 *
 * Same split as approvers.ts / approverrouting.ts: every rule lives in the pure
 * module and is unit-tested there; this file only moves rows. If a decision starts
 * being made here instead of there, it has stopped being testable.
 *
 * WHY AN APP-OWNED SQLITE TABLE AND NOT A POWERSYNC TABLE:
 *   Identical reasoning to approvers.ts, and it matters more here. A thread must
 *   work with no signal -- mandate #7 -- and a PowerSync table needs the server
 *   table AND deployed sync rules before it does anything at all. App-owned plus an
 *   outbox means a reply typed in a basement is durable the instant it is typed and
 *   uploads when there is signal. It is also the right shape: messages are
 *   append-only evidence, which CLAUDE.md sends to an owned outbox, not to the
 *   mutable-relational side.
 *
 * MANDATE #1 IN THIS FILE: `postReply` writes the message and the transport intent
 * in ONE transaction, and nothing ever deletes a thread_message. Draining deletes
 * the INTENT to upload, never the message. A reply that cannot be delivered is
 * parked with the reason and stays on screen; it is not silently dropped, and the
 * thread never claims to have sent something it did not.
 *
 * MANDATE #2 IN THIS FILE: nothing here sends anything carrying a price. A reply is
 * words. The revision path (revision.ts) creates a DRAFT and stops; putting the new
 * price in front of a client is still an explicit tap through the existing send
 * preview.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { SupabaseClient } from '@supabase/supabase-js';
import { sha256 } from 'js-sha256';
import type { ThreadMessage, ThreadSide } from './discussion';

export const DISCUSSION_DDL = [
  `CREATE TABLE IF NOT EXISTS thread_message (
      -- Server-stable. A question arrives as 'q-<bigint>'; a reply keeps the id the
      -- DEVICE authored, unchanged, on both sides -- so the pull that brings a reply
      -- back cannot duplicate the message the contractor is already looking at.
      id              TEXT NOT NULL PRIMARY KEY,
      change_order_id TEXT NOT NULL,
      side            TEXT NOT NULL CHECK (side IN ('client','contractor')),
      body            TEXT NOT NULL CHECK (length(trim(body)) > 0),
      at_ms           INTEGER NOT NULL,
      -- NULL until a push has been raised for this message. R5b AC1: a question
      -- notifies ONCE. Storing it (rather than tracking "last notified time") means
      -- a message that arrives out of order still gets its notification.
      notified_at_ms  INTEGER
   ) STRICT`,

  `CREATE INDEX IF NOT EXISTS thread_message_by_co
     ON thread_message (change_order_id, at_ms)`,

  // A message is evidence. Nothing in the app edits or deletes one; the trigger is
  // here so nothing ever starts. Mirrors confirmation_question's server trigger so
  // the rule does not depend on which side you are looking from.
  `CREATE TRIGGER IF NOT EXISTS thread_message_append_only
     BEFORE UPDATE OF body, side, at_ms, change_order_id ON thread_message
     BEGIN SELECT RAISE(ABORT, 'thread messages are append-only evidence'); END`,

  `CREATE TRIGGER IF NOT EXISTS thread_message_no_delete
     BEFORE DELETE ON thread_message
     BEGIN SELECT RAISE(ABORT, 'thread messages are append-only evidence'); END`,

  `CREATE TABLE IF NOT EXISTS r5b_outbox (
      mutation_id   TEXT NOT NULL PRIMARY KEY,
      -- One kind today. The column stays because ingest_r5c_v1 grew from one kind
      -- to four and retrofitting the dispatch afterwards meant a second table.
      kind          TEXT NOT NULL CHECK (kind IN ('reply')),
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

/**
 * `superseded_by` is added by ALTER, not by CHANGE_ORDER_DDL, for the same reason
 * approvers.ts adds `extra_type` that way: that array is a CREATE TABLE list and
 * this has to run against tables that already exist on phones in the field. SQLite
 * has no ADD COLUMN IF NOT EXISTS, so the error is inspected -- a duplicate column
 * is the expected no-op, anything else is real and must surface.
 *
 * WHY THIS COLUMN AND NOT A LOCAL LINEAGE TABLE OF ITS OWN: it mirrors the server
 * column 307_extras_ledger.sql adds, and `pullThreads` fills it from there, so a
 * second device gets the lineage for a revision it did not author. R7's
 * `co_supersession` is a transport queue for the device that DID author one and is
 * emptied of meaning once uploaded; the thread needs the fact, not the intent.
 *
 * Idempotent, so calling it after ensureLedgerStatusSchema is safe either way.
 */
export async function ensureDiscussionSchema(db: AbstractPowerSyncDatabase) {
  for (const s of DISCUSSION_DDL) await db.execute(s);
  try { await db.execute(`ALTER TABLE change_order ADD COLUMN superseded_by TEXT`); }
  catch (e: any) { if (!/duplicate column/i.test(String(e?.message ?? e))) throw e; }
}

const newReplyId = () =>
  `r-loc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Queue one R5b change. ALWAYS called inside the caller's write transaction, so the
 *  row and the intent to upload it commit together -- a crash between them leaves a
 *  message only this phone knows about. */
export async function enqueueR5b(
  tx: { execute: (sql: string, args: any[]) => Promise<any> },
  kind: 'reply',
  rowId: string,
  payload: Record<string, unknown>,
  whenMs: number
) {
  const json = JSON.stringify(payload);
  await tx.execute(
    `INSERT INTO r5b_outbox (mutation_id, kind, row_id, payload_json, payload_sha256, queued_at_ms)
     VALUES (?,?,?,?,?,?)`,
    [`m-${kind}-${rowId}`, kind, rowId, json, sha256(json), whenMs]
  );
}

/**
 * The contractor's reply. NO NETWORK -- it is durable before this returns.
 *
 * Returns the message id so the screen can render it immediately rather than
 * waiting for a round trip it may never get.
 */
export async function postReply(
  db: AbstractPowerSyncDatabase,
  o: { changeOrderId: string; body: string; ownerId: string; atMs?: number }
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const body = o.body.trim();
  if (!body) return { ok: false, reason: 'empty' };
  const id = newReplyId();
  const at = o.atMs ?? Date.now();
  try {
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO thread_message (id, change_order_id, side, body, at_ms, notified_at_ms)
         VALUES (?,?,'contractor',?,?,?)`,
        // Own messages are never notified -- notified_at_ms is stamped so the push
        // scan cannot pick one up and tell the contractor about his own reply.
        [id, o.changeOrderId, body, at, at]
      );
      await enqueueR5b(tx, 'reply', id, {
        id, change_order_id: o.changeOrderId, body, at_ms: at, owner_id: o.ownerId,
      }, at);
    });
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
  return { ok: true, id };
}

/**
 * Every message on one extra, including every version it replaced.
 *
 * R5b: "the thread carries across versions". BACKWARD only -- a superseded version
 * shows its own history, never messages written on the version that replaced it.
 * Depth-capped for the same reason the server's lineage function is: a replayed or
 * hand-edited row could make a cycle, and an uncapped recursive CTE against a cycle
 * does not return.
 */
export async function threadFor(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<ThreadMessage[]> {
  const rows = await db.getAll<{ id: string; side: string; body: string; at_ms: number }>(
    `WITH RECURSIVE chain(id, depth) AS (
       SELECT ?, 0
       UNION
       -- superseded_by points FORWARD (old -> new). Walked in reverse it yields the
       -- ancestors: this version, and every version it replaced.
       SELECT prior.id, c.depth + 1
         FROM change_order prior JOIN chain c ON prior.superseded_by = c.id
        WHERE c.depth < 50
     )
     SELECT m.id, m.side, m.body, m.at_ms
       FROM thread_message m
      WHERE m.change_order_id IN (SELECT id FROM chain)
      ORDER BY m.at_ms, m.id`,
    [changeOrderId]
  );
  return rows.map((r) => ({
    id: r.id, side: r.side as ThreadSide, text: r.body, atMs: r.at_ms,
  }));
}

/**
 * Every thread on a job, keyed by change order. One query, because the ledger needs
 * the In Discussion / Awaiting-your-reply state of EVERY row and doing that per row
 * would be N queries on a screen that already renders on scroll.
 *
 * Lineage is deliberately NOT walked here: the ledger asks "what is the state of
 * this version", and inheriting an ancestor's unanswered question would flag a
 * fresh revision as already overdue.
 */
export async function threadsForProject(
  db: AbstractPowerSyncDatabase, projectId: string
): Promise<Map<string, ThreadMessage[]>> {
  const rows = await db.getAll<{
    id: string; change_order_id: string; side: string; body: string; at_ms: number;
  }>(
    `SELECT m.id, m.change_order_id, m.side, m.body, m.at_ms
       FROM thread_message m
       JOIN change_order co ON co.id = m.change_order_id
      WHERE co.project_id = ?
      ORDER BY m.at_ms, m.id`,
    [projectId]
  );
  const out = new Map<string, ThreadMessage[]>();
  for (const r of rows) {
    const list = out.get(r.change_order_id) ?? [];
    list.push({ id: r.id, side: r.side as ThreadSide, text: r.body, atMs: r.at_ms });
    out.set(r.change_order_id, list);
  }
  return out;
}

/**
 * Client messages that have never raised a notification, newest last.
 *
 * The scan is over STORED rows rather than over the pull's response, so a question
 * that arrived while the app was killed still notifies on the next launch -- R5b
 * wants an unanswered question surfaced until it is resolved, not only at the
 * instant it lands.
 */
export async function pendingNotifications(
  db: AbstractPowerSyncDatabase
): Promise<Array<{ id: string; changeOrderId: string; scope: string; body: string }>> {
  return db.getAll(
    `SELECT m.id AS id, m.change_order_id AS changeOrderId, co.scope AS scope, m.body AS body
       FROM thread_message m
       JOIN change_order co ON co.id = m.change_order_id
      WHERE m.side = 'client' AND m.notified_at_ms IS NULL
        AND co.status = 'sent'
      ORDER BY m.at_ms`
  );
}

/** Stamped only AFTER the notification was actually presented. Stamping first would
 *  lose the notification whenever presenting failed. */
export async function markNotified(db: AbstractPowerSyncDatabase, ids: string[]) {
  if (!ids.length) return;
  await db.execute(
    `UPDATE thread_message SET notified_at_ms = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
    [Date.now(), ...ids]
  );
}

/**
 * Pull the threads for a job. THE READ PATH THAT DID NOT EXIST: without it the
 * contractor cannot see that a question was ever asked.
 *
 * INSERT OR IGNORE: a message already here is already correct (it is append-only on
 * both sides), and the local row may carry a notified_at_ms the server has never
 * heard of. Never overwrite it.
 *
 * Lineage is pulled alongside because `threadFor`'s walk reads `superseded_by`.
 * Without it phone B, which did not author the revision, would show the new
 * version's thread with the whole prior conversation missing -- and R5b AC2 is
 * specifically that the full thread is visible on the new version.
 */
export async function pullThreads(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, projectId: string
): Promise<{ pulled: number; revisions: number }> {
  let pulled = 0, revisions = 0;

  const { data, error } = await supabase.rpc('discussion_threads', { p_project_id: projectId });
  if (!error && Array.isArray(data)) {
    for (const m of data as any[]) {
      const atMs = Date.parse(m.at);
      // A row we cannot place in time is not silently given "now": it would sort
      // into the wrong position in a legal record. Skipped and left for a build
      // that understands it.
      if (!Number.isFinite(atMs) || !m.id || !m.change_order_id) continue;
      const r = await db.execute(
        `INSERT OR IGNORE INTO thread_message (id, change_order_id, side, body, at_ms)
         VALUES (?,?,?,?,?)`,
        [m.id, m.change_order_id, m.side === 'contractor' ? 'contractor' : 'client',
         String(m.body ?? ''), atMs]
      );
      if (r.rowsAffected) pulled++;
    }
  }

  // Owner-scoped by change_order's own RLS policy (co_own, 030) -- no function
  // needed for a column the device is already allowed to read.
  const { data: revs } = await supabase
    .from('change_order')
    .select('id, superseded_by')
    .eq('project_id', projectId)
    .not('superseded_by', 'is', null);
  for (const rv of (revs ?? []) as any[]) {
    // Only fills a BLANK. A local row already carrying its successor is either the
    // authored copy or a pending intent R7's reassertSupersessions still owns, and
    // is never rewritten by a copy of itself.
    const r = await db.execute(
      `UPDATE change_order SET superseded_by = ? WHERE id = ? AND superseded_by IS NULL`,
      [rv.superseded_by, rv.id]
    );
    if (r.rowsAffected) revisions++;
  }
  return { pulled, revisions };
}

/**
 * Push queued replies and revisions.
 *
 * Mirrors drainR5cOutbox down to the backoff on purpose: this is the fifth outbox
 * in the app and a fifth retry policy would be a fifth thing to get subtly wrong.
 *
 * 'no_live_link' is PARKED, not retried and not dropped. It means the world moved
 * (the client answered, or another device revised) and no number of retries will
 * change that. The local message stays -- it was really written and the record says
 * so -- and the parked outbox row carries the reason it never left.
 */
const R5B_PERMANENT = new Set(['42501', '23505', '23514']);

export async function drainR5bOutbox(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, ownerId: string
) {
  const r = { attempted: 0, uploaded: 0, alreadyApplied: 0, parked: 0, retryable: 0 };
  const rows = await db.getAll<{
    mutation_id: string; kind: string; row_id: string;
    payload_json: string; payload_sha256: string; attempt_count: number;
  }>(
    `SELECT mutation_id, kind, row_id, payload_json, payload_sha256, attempt_count
       FROM r5b_outbox WHERE next_attempt_at_ms <= ?
      ORDER BY queued_at_ms LIMIT 20`,
    [Date.now()]
  );

  for (const row of rows) {
    r.attempted++;
    let p: any;
    try { p = JSON.parse(row.payload_json); }
    catch { await park(db, row.mutation_id, 'CORRUPT_PAYLOAD', 'not valid JSON'); r.parked++; continue; }

    try {
      const { data, error } = await supabase.rpc('ingest_r5b_v1', {
        p_mutation_id: row.mutation_id, p_kind: row.kind, p_id: row.row_id,
        p_owner_id: ownerId,
        p_change_order_id: p.change_order_id ?? null,
        p_body: p.body ?? null,
        p_at_ms: p.at_ms ?? null,
        p_request_sha256: row.payload_sha256,
      });
      if (error) throw error;
      if (data?.status === 'no_live_link') {
        await park(db, row.mutation_id, String(data.status).toUpperCase(),
                   'the request was answered or replaced before this could be sent');
        r.parked++;
        continue;
      }
      await db.execute(`DELETE FROM r5b_outbox WHERE mutation_id = ?`, [row.mutation_id]);
      if (data?.status === 'already_applied') r.alreadyApplied++; else r.uploaded++;
    } catch (e: any) {
      const code = e?.code ?? e?.error_code;
      if (R5B_PERMANENT.has(code)) {
        await park(db, row.mutation_id, code, e?.message ?? String(e)); r.parked++;
      } else {
        const n = row.attempt_count + 1;
        await db.execute(
          `UPDATE r5b_outbox SET attempt_count = ?, next_attempt_at_ms = ?,
             last_error_code = ?, last_error_text = ? WHERE mutation_id = ?`,
          [n, Date.now() + Math.min(60_000 * 2 ** Math.min(n, 6), 30 * 60_000),
           String(code ?? 'TRANSIENT'), String(e?.message ?? e).slice(0, 500), row.mutation_id]
        );
        r.retryable++;
      }
    }
  }
  return r;
}

async function park(db: AbstractPowerSyncDatabase, mutationId: string, code: string, msg: string) {
  await db.execute(
    `UPDATE r5b_outbox SET attempt_count = attempt_count + 1, next_attempt_at_ms = ?,
       last_error_code = ?, last_error_text = ? WHERE mutation_id = ?`,
    [8640000000000, code, msg, mutationId]
  );
}

/** Replies this device wrote that have not reached the server, so the thread can say
 *  so instead of implying every message was delivered. */
export async function undeliveredReplyIds(
  db: AbstractPowerSyncDatabase
): Promise<Set<string>> {
  const rows = await db.getAll<{ row_id: string }>(
    `SELECT row_id FROM r5b_outbox WHERE kind = 'reply'`);
  return new Set(rows.map((r) => r.row_id));
}
