/**
 * Discarding a never-sent extra. Decisions in `discard.ts`; this does the work.
 *
 * WHAT IT DELETES AND WHAT IT DELIBERATELY DOES NOT.
 *
 * Deleted: the `change_order` row, its outbox entries, and the MEDIA FILES of
 * the captures only this extra reaches. The bytes are what "the attached
 * assets" means — they are the storage, the privacy exposure, and the thing a
 * contractor pictures when he says delete.
 *
 * NOT deleted: the `capture_commit` row. It cannot be — `capture_commit_no_delete`
 * refuses, and that trigger is not something to relax for a convenience feature.
 * Instead a tombstone is written and the gallery stops showing it. That is not a
 * workaround, it is the better shape: what remains is an auditable record that
 * something was captured and then deliberately discarded, at a known time, while
 * the bytes are genuinely gone. A silent vanishing and a recorded discard look
 * identical to a user and completely different to anyone asking later what
 * happened.
 *
 * ONE TRANSACTION for the database rows, and the FILES GO LAST. If the row
 * deletions fail, nothing has been destroyed. If a file deletion fails after the
 * rows are gone, the tombstone still says discarded and `recoverySweep` collects
 * the orphan later. The order that loses least is rows-then-bytes, never the
 * reverse.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import { planDiscard, type CaptureRef, type DiscardPlan } from './discard.ts';

export const DISCARD_DDL = [
  // Append-only itself: discarding is an act, and an act that can be un-recorded
  // is not a record. No update, no delete.
  `CREATE TABLE IF NOT EXISTS capture_discarded (
      capture_id      TEXT NOT NULL PRIMARY KEY,
      change_order_id TEXT NOT NULL,
      at_ms           INTEGER NOT NULL,
      bytes_freed     INTEGER
   ) STRICT`,
  `CREATE TRIGGER IF NOT EXISTS capture_discarded_no_change
     BEFORE UPDATE ON capture_discarded
     BEGIN SELECT RAISE(ABORT, 'a discard is a recorded act, not a draft'); END`,
  `CREATE TRIGGER IF NOT EXISTS capture_discarded_no_delete
     BEFORE DELETE ON capture_discarded
     BEGIN SELECT RAISE(ABORT, 'a discard is a recorded act, not a draft'); END`,
];

export async function ensureDiscardSchema(db: AbstractPowerSyncDatabase) {
  for (const s of DISCARD_DDL) await db.execute(s);
}

/**
 * Gather the facts `planDiscard` needs. Separate from the doing so the
 * confirmation can be shown from exactly the same numbers that will be acted on
 * — a dialog that says "2 photos" and then deletes 3 is worse than no dialog.
 */
export async function previewDiscard(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<DiscardPlan> {
  const co = await db.getAll<{ status: string; decision_id: string }>(
    `SELECT status, decision_id FROM change_order WHERE id = ?`, [changeOrderId]);
  if (!co.length) return planDiscard(null, []);

  const link = await db.getAll<{ n: number }>(
    `SELECT count(*) AS n FROM co_live_link WHERE change_order_id = ?`, [changeOrderId]);

  // Every capture behind this extra's decision, with a count of how many
  // DISTINCT extras reach it. `revision.ts` reuses prior.decision_id, so this
  // count is routinely 2 and the difference matters.
  const caps = await db.getAll<{ capture_id: string; used: number; uploaded: number }>(
    `SELECT dv.capture_id                                        AS capture_id,
            (SELECT count(*) FROM change_order c2
              WHERE c2.decision_id = dv.decision_id)             AS used,
            (SELECT count(*) FROM capture_commit cc
              WHERE cc.capture_id = dv.capture_id
                AND cc.pending_upload = 0)                       AS uploaded
       FROM decision_version dv
      WHERE dv.decision_id = ? AND dv.capture_id IS NOT NULL
      GROUP BY dv.capture_id`,
    [co[0].decision_id]
  );

  const refs: CaptureRef[] = caps.map((c) => ({
    captureId: c.capture_id, usedByExtras: c.used, uploaded: c.uploaded > 0,
  }));
  return planDiscard(
    { status: co[0].status, hasLiveLink: (link[0]?.n ?? 0) > 0 }, refs);
}

/**
 * Do it. Re-plans from scratch rather than trusting the plan it was shown:
 * the extra may have been SENT between the dialog appearing and the thumb
 * landing, and sending is exactly the event that must stop this.
 */
export async function discardExtra(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<{ ok: boolean; reason?: string; deleted: number; freedBytes: number; serverPending: number }> {
  const plan = await previewDiscard(db, changeOrderId);
  if (!plan.allowed) {
    return { ok: false, reason: plan.reason, deleted: 0, freedBytes: 0, serverPending: 0 };
  }

  // Paths read BEFORE the rows go, because capture_commit is where they live.
  const paths = new Map<string, { relpath: string; bytes: number }>();
  for (const id of plan.deleteCaptures) {
    const r = await db.getAll<{ media_relpath: string; media_bytes: number }>(
      `SELECT media_relpath, media_bytes FROM capture_commit WHERE capture_id = ?`, [id]);
    if (r.length) paths.set(id, { relpath: r[0].media_relpath, bytes: r[0].media_bytes });
  }

  const now = Date.now();
  await db.writeTransaction(async (tx) => {
    for (const id of plan.deleteCaptures) {
      await tx.execute(
        `INSERT OR IGNORE INTO capture_discarded
           (capture_id, change_order_id, at_ms, bytes_freed) VALUES (?, ?, ?, ?)`,
        [id, changeOrderId, now, paths.get(id)?.bytes ?? null]);
    }
    // The outbox FIRST: an entry that outlived its change order would try to
    // upload a row that no longer exists and park forever with a reason nobody
    // can act on.
    await tx.execute(`DELETE FROM change_order_outbox WHERE row_id = ?`, [changeOrderId]);
    await tx.execute(`DELETE FROM change_order WHERE id = ?`, [changeOrderId]);
  });

  // Bytes last, and each failure is survivable: the tombstone already says
  // discarded, and recoverySweep collects an orphan whose row is gone.
  let freedBytes = 0;
  for (const [, p] of paths) {
    try {
      await FS.deleteAsync(`${FS.documentDirectory}${p.relpath}`, { idempotent: true });
      freedBytes += p.bytes;
    } catch { /* orphan; the sweep gets it */ }
  }

  return {
    ok: true,
    deleted: plan.deleteCaptures.length,
    freedBytes,
    // Honest, not hidden: these exist on the server and this device cannot
    // reach in and remove them. Until that RPC exists, "deleted" means "deleted
    // from this phone" for these, and the caller says so.
    serverPending: plan.needsServer.length,
  };
}

/** Discarded captures, for the gallery to skip. */
export async function discardedCaptureIds(
  db: AbstractPowerSyncDatabase
): Promise<Set<string>> {
  const rows = await db.getAll<{ capture_id: string }>(
    `SELECT capture_id FROM capture_discarded`);
  return new Set(rows.map((r) => r.capture_id));
}
