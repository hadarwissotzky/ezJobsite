import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * PULL THE ROSTER DOWN — the missing half of R5c's transport.
 *
 * WHY THIS EXISTS (Codex cross-model review, 2026-08-22, P0; hadar had been reporting
 * the symptom for weeks as "empty shells ... no clients").
 *
 * `project_approver` had an uplink and no downlink. `drainR5cOutbox` pushes every
 * add/retire/used to Postgres and 30 rows are sitting there right now — and nothing,
 * anywhere in the app, ever read them back. `AppSchema` does not carry this table
 * either, so PowerSync was not quietly covering for it.
 *
 * The consequence is not "a stale roster". It is TOTAL LOSS on any device that did not
 * type the client in, because `purgeLocalData` DROPs app-owned tables on a handover
 * (closeaccount.ts) and there was nothing to rebuild them from. The extra kept the
 * client's NAME — `who_directed` is denormalised onto the change order and hydrates
 * fine — so the screen showed a plausible person with no phone, no type, no consent
 * and no selectable recipient. A missing client that still prints a name is worse than
 * an empty one: it looks like the data survived.
 *
 * ─── WHY INSERT OR IGNORE, AND NOT AN UPSERT ────────────────────────────────────
 * The server CANNOT currently receive a field edit: `ingest_r5c_v1`'s 'add' is
 * `on conflict (id) do nothing` (290_r5c_transport.sql:65), so a corrected phone
 * number never reaches Postgres. If this pull overwrote local columns from the server,
 * it would repeatedly undo edits that have no way to be uploaded — the app would argue
 * with the contractor and lose his correction every 15 seconds. So new rows land, and
 * existing rows keep what this device knows.
 *
 * ─── EXCEPT THE TWO THINGS THE SERVER IS ALLOWED TO CHANGE ──────────────────────
 * `retire` and `used` are real server-side mutations (290:67, 290:74), so ignoring
 * existing rows entirely would strand them:
 *   · status  — adopted ONE WAY, active → removed only. Never the reverse: a local
 *               'removed' whose retire is still queued would otherwise be resurrected
 *               by the very sync meant to carry it.
 *   · last_used_ms — MAX(local, server), the same monotonic rule the RPC enforces, so
 *               out-of-order drains cannot walk recency backwards.
 *
 * ─── WHAT THIS DOES NOT RESTORE, AND THAT IS DELIBERATE ─────────────────────────
 * `chain_side` (client vs supply chain) and `sms_consent_at_ms` do not exist in the
 * Postgres table at all — they are device-only columns added by `ensureApproverSchema`.
 * A pulled row therefore arrives with both NULL, which is the honest value: NULL means
 * "never asked" for both, and for consent NULL BLOCKS A SEND. That is the safe
 * direction and not a bug to paper over — a second device must not text somebody on a
 * permission it has never seen. Carrying consent across devices needs those columns
 * server-side first.
 */
export async function hydrateApprovers(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, projectId: string | null
): Promise<{ pulled: number; updated: number; ok: boolean }> {
  try {
    const q = supabase.from('project_approver')
      .select('id, project_id, name, role, phone_e164, email, status, can_bind_money, last_used_ms, created_at_ms');
    const { data, error } = await (projectId ? q.eq('project_id', projectId) : q);
    if (error || !data) return { pulled: 0, updated: 0, ok: false };
    let pulled = 0, updated = 0;
    for (const a of data as any[]) {
      // One malformed row must not take the whole roster with it — a client that
      // fails to land is exactly the failure this function exists to end.
      try {
        const ins = await db.execute(
          `INSERT OR IGNORE INTO project_approver
             (id, project_id, name, role, phone_e164, email, status,
              can_bind_money, last_used_ms, created_at_ms)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [a.id, a.project_id, a.name, a.role, a.phone_e164 ?? null, a.email ?? null,
           a.status === 'removed' ? 'removed' : 'active',
           a.can_bind_money == null ? null : (a.can_bind_money ? 1 : 0),
           Number(a.last_used_ms ?? 0), Number(a.created_at_ms ?? Date.now())]);
        if (ins.rowsAffected) { pulled++; continue; }
        // Already here. Carry ONLY what the server is allowed to have changed.
        const up = await db.execute(
          `UPDATE project_approver
              SET status = CASE WHEN ? = 'removed' THEN 'removed' ELSE status END,
                  last_used_ms = MAX(last_used_ms, ?)
            WHERE id = ?
              AND (( ? = 'removed' AND status = 'active') OR last_used_ms < ?)`,
          [a.status, Number(a.last_used_ms ?? 0), a.id, a.status, Number(a.last_used_ms ?? 0)]);
        if (up.rowsAffected) updated++;
      } catch { /* next row */ }
    }
    return { pulled, updated, ok: true };
  } catch {
    return { pulled: 0, updated: 0, ok: false };   // offline is normal (mandate #7)
  }
}
