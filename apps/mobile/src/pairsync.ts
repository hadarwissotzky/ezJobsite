/**
 * THE PAIR LINK, OFF THIS PHONE — transport for `capture_pair` (sql/418).
 *
 * hadar, 2026-08-21: "most of the photos are missing" on a device that had just
 * pulled his account down.
 *
 * A fused capture is two captures joined by a `pair_id` minted at capture time: the
 * photo and the voice clip of the narration over it. The record screen reaches an
 * extra's ANCHOR capture through `decision_version`, and everything else in the walk
 * through `capture_pair`. `pair.ts` said so in its own header — "Local-only for now (a
 * grouping hint for the grid/viewer)" — and that "for now" became load-bearing without
 * anyone noticing.
 *
 * MEASURED ON THE LIVE DATABASE, not inferred: of 102 photos on hadar's account, FOUR
 * are reachable from an extra through `decision_version`. The other 98 hang off
 * `capture_pair` alone, which exists on one handset and dies with it. So a second
 * phone, a reinstall or a device handover loses 96% of the photographic evidence while
 * every byte of it sits in Storage.
 *
 * ─── WHY AN OWNED OUTBOX AND NOT POWERSYNC ──────────────────────────────────────
 * CLAUDE.md §5's rule, applied without a second thought needed: this is append-only
 * evidence-adjacent data, not a mutable relational row. It gets an owned queue like
 * every other append-only table, and the same shape as `tag_outbox` next to it —
 * derived mutation id (a replay collapses), attempt/backoff columns, and a park for
 * permanent refusals.
 *
 * ─── WHY THE LINK IS SAFE TO RE-SEND AND A CAPTURE IS NOT ───────────────────────
 * The captures are the evidence and travel their own audited path. This records only
 * WHICH captures happened in one breath, so `ingest_pair_v1` is idempotent by primary
 * key and a duplicate costs nothing. Losing a row here costs a grouping, never a
 * capture — which is exactly why it was acceptable to leave local, right up until the
 * grouping was the only thing standing between a contractor and his photographs.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

import { logDiag } from './diaglog.ts';

/** Permanent refusals — a retry in an hour fails identically. Same set the other
 *  drains use; anything else backs off and tries again. */
const PERMANENT = new Set(['42501', '23514', '23503', '22P02', 'PGRST202']);

export const PAIR_OUTBOX_DDL = [
  `CREATE TABLE IF NOT EXISTS pair_outbox (
      mutation_id        TEXT NOT NULL PRIMARY KEY,
      pair_id            TEXT NOT NULL,
      capture_id         TEXT NOT NULL,
      role               TEXT NOT NULL,
      at_ms              INTEGER NOT NULL,
      project_id         TEXT NOT NULL,
      attempt_count      INTEGER NOT NULL DEFAULT 0,
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
      last_error_code    TEXT,
      last_error_text    TEXT
   ) STRICT`,
] as const;

export async function ensurePairSyncSchema(db: AbstractPowerSyncDatabase): Promise<void> {
  for (const s of PAIR_OUTBOX_DDL) await db.execute(s);
}

/**
 * Queue one half of a pairing for upload.
 *
 * DERIVED mutation id, never random: `linkPair` is called again on a retry of the same
 * capture flow, and two rows for one pairing would mean two uploads of a fact that is
 * true once. `INSERT OR IGNORE` plus a derived key collapses the replay here rather
 * than on the server.
 */
export async function enqueuePair(
  db: AbstractPowerSyncDatabase,
  o: { pairId: string; captureId: string; role: 'photo' | 'voice'; atMs: number; projectId: string }
): Promise<void> {
  await db.execute(
    `INSERT OR IGNORE INTO pair_outbox
       (mutation_id, pair_id, capture_id, role, at_ms, project_id)
     VALUES (?,?,?,?,?,?)`,
    [`pm-${o.pairId}-${o.captureId}`, o.pairId, o.captureId, o.role, o.atMs, o.projectId]);
}

export type PairDrainResult = {
  attempted: number; uploaded: number; parked: number; retryable: number;
};

export async function drainPairOutbox(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, limit = 50
): Promise<PairDrainResult> {
  const r: PairDrainResult = { attempted: 0, uploaded: 0, parked: 0, retryable: 0 };
  let rows: Array<{
    mutation_id: string; pair_id: string; capture_id: string;
    role: string; at_ms: number; project_id: string; attempt_count: number;
  }> = [];
  try {
    rows = await db.getAll(
      `SELECT mutation_id, pair_id, capture_id, role, at_ms, project_id, attempt_count
         FROM pair_outbox WHERE next_attempt_at_ms <= ?
        ORDER BY at_ms LIMIT ?`, [Date.now(), limit]);
  } catch {
    return r;   // schema not up yet
  }
  r.attempted = rows.length;

  for (const row of rows) {
    try {
      const { error } = await supabase.rpc('ingest_pair_v1', {
        p_pair_id: row.pair_id, p_capture_id: row.capture_id,
        p_role: row.role, p_at_ms: row.at_ms, p_project_id: row.project_id,
      });
      if (error) throw error;
      await db.execute(`DELETE FROM pair_outbox WHERE mutation_id = ?`, [row.mutation_id]);
      r.uploaded++;
    } catch (e: any) {
      const code = e?.code ?? e?.error_code ?? '';
      if (PERMANENT.has(code)) {
        // Parked LOUDLY. A link that will never upload is not a lost capture, but it
        // is a photo that will never appear on a second device, and silence about that
        // is what let this whole class of bug live for a month.
        void logDiag(db, 'pair.park', `${row.pair_id}/${row.capture_id}: ${code} ${String(e?.message ?? e).slice(0, 90)}`);
        await db.execute(
          `UPDATE pair_outbox SET next_attempt_at_ms = ?, last_error_code = ?, last_error_text = ?
            WHERE mutation_id = ?`,
          [8.64e15, code, String(e?.message ?? e).slice(0, 200), row.mutation_id]);
        r.parked++;
      } else {
        const n = row.attempt_count + 1;
        const delay = Math.min(60_000 * 2 ** Math.min(n, 6), 30 * 60_000);
        await db.execute(
          `UPDATE pair_outbox SET attempt_count = ?, next_attempt_at_ms = ?,
             last_error_code = ?, last_error_text = ?
           WHERE mutation_id = ?`,
          [n, Date.now() + delay, code || 'TRANSIENT',
           String(e?.message ?? e).slice(0, 200), row.mutation_id]);
        r.retryable++;
      }
    }
  }
  return r;
}

/**
 * Pull the account's pairings down. The half that makes a photo appear on a phone
 * that did not take it.
 *
 * `INSERT OR IGNORE` because the local table is append-only too, and a re-pull of a
 * row this device already has must be a no-op at the statement level.
 *
 * NOT chunked by capture id like `hydrateEvidence` is, and that is deliberate: this
 * asks by PROJECT, so the request is one small filter regardless of how many captures
 * the job holds. It is the same query shape that made the id-list version fragile.
 */
export async function hydratePairs(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, projectId: string | null
): Promise<{ pulled: number; ok: boolean }> {
  try {
    const q = supabase.from('capture_pair').select('pair_id, capture_id, role, at_ms');
    const { data, error } = await (projectId ? q.eq('project_id', projectId) : q);
    if (error || !data) {
      void logDiag(db, 'pair.hydrate', String(error?.message ?? 'no data').slice(0, 120));
      return { pulled: 0, ok: false };
    }
    let pulled = 0;
    for (const p of data as any[]) {
      try {
        const res = await db.execute(
          `INSERT OR IGNORE INTO capture_pair (pair_id, capture_id, role, at_ms)
           VALUES (?,?,?,?)`,
          [p.pair_id, p.capture_id, p.role, Number(p.at_ms)]);
        if (res.rowsAffected) pulled++;
      } catch { /* one bad row must not take the pull with it */ }
    }
    return { pulled, ok: true };
  } catch {
    return { pulled: 0, ok: false };   // offline is normal
  }
}

/**
 * Queue every pairing this device already holds but has never sent.
 *
 * EVERY DEVICE ARRIVES AT THIS BUILD WITH A BACKLOG, by definition: `capture_pair` has
 * been written on every fused capture since it shipped and read by nothing but this
 * phone. Without a backfill the fix would only ever cover captures taken from now on,
 * and every photo already on the handset would stay stranded there — which is most of
 * them.
 *
 * Idempotent through `enqueuePair`'s derived mutation id, so running it on every launch
 * costs one query once the queue has drained.
 *
 * The project id comes from `capture_commit`, which is where this device recorded it.
 * A pairing whose capture is not committed locally is skipped rather than guessed at:
 * `project_id` is NOT NULL on the server and inventing one would file somebody's photo
 * against the wrong job.
 */
export async function backfillPairOutbox(
  db: AbstractPowerSyncDatabase
): Promise<{ queued: number }> {
  try {
    const rows = await db.getAll<{
      pair_id: string; capture_id: string; role: string; at_ms: number; project_id: string;
    }>(
      `SELECT p.pair_id, p.capture_id, p.role, p.at_ms, cc.project_id
         FROM capture_pair p
         JOIN capture_commit cc ON cc.capture_id = p.capture_id
        WHERE NOT EXISTS (
          SELECT 1 FROM pair_outbox o WHERE o.mutation_id = 'pm-' || p.pair_id || '-' || p.capture_id
        )`);
    let queued = 0;
    for (const r of rows) {
      await enqueuePair(db, {
        pairId: r.pair_id, captureId: r.capture_id,
        role: r.role === 'voice' ? 'voice' : 'photo',
        atMs: r.at_ms, projectId: r.project_id,
      });
      queued++;
    }
    return { queued };
  } catch {
    return { queued: 0 };
  }
}
