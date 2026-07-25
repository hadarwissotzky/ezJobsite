/**
 * Is this extra ready to send? The database half. Decisions live in
 * `extraprocstate.ts`, the wording in i18n.
 *
 * WHY IT EXISTS. Hadar's workflow, stated plainly: record and snap, it saves
 * offline, it uploads when there is signal, it gets transcribed and analysed and
 * tagged and titled, "only then it can be sent to the owner for approval. until
 * then we keep the raw data on the device and waiting for processing."
 *
 * NOTHING ENFORCED THAT. `openSendPrep` had no check of any kind — not upload,
 * not processing — so an extra whose audio was still sitting on the phone could
 * be sent to a homeowner, who would open a link describing work backed by
 * evidence that had not left the device and might never.
 *
 * AN EXTRA IS ONLY AS READY AS ITS LEAST-READY PART. It is a recording plus its
 * photos, and `procState` in status.ts answers the question per capture. The
 * weakest one wins: a single photo still queued means the whole thing is not
 * ready, because the client would open a record with a hole in it.
 *
 * DERIVED, NEVER STORED — the same rule status.ts states for captures. A
 * readiness column would be a fifth place for the truth to live and the first
 * place for it to drift, and it would go stale exactly when signal returns,
 * which is the moment it most needs to be right.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { procState, type ProcState } from './status.ts';

/**
 * Every capture behind an extra, via its decision — the same walk
 * `captureIdsForDecision` does, but carrying the two facts `procState` needs.
 *
 * LEFT JOIN, not INNER: a capture with no `capture_op_state` row has simply
 * never been heard about by the server, and `procState` already knows what to
 * make of that. Dropping those rows would silently shrink the group and make an
 * extra look readier than it is — inferring success from an absent row is the
 * same mistake status.ts warns about.
 */
export async function captureStatesForExtra(
  db: AbstractPowerSyncDatabase, decisionId: string
): Promise<ProcState[]> {
  const rows = await db.getAll<{ pending: number; server_state: string | null }>(
    `SELECT EXISTS (SELECT 1 FROM capture_outbox o WHERE o.capture_id = dv.capture_id)
              AS pending,
            (SELECT s.processing_state FROM capture_op_state s
              WHERE s.capture_id = dv.capture_id) AS server_state
       FROM decision_version dv
      WHERE dv.decision_id = ? AND dv.capture_id IS NOT NULL
      GROUP BY dv.capture_id`,
    [decisionId]
  );
  const states = rows.map((r) => procState({
    pendingUpload: !!r.pending, serverState: r.server_state,
  }));

  // The rows above only cover the anchor/voice capture. The PHOTOS shot during the
  // walk are paired to it via capture_pair and never appear on decision_version, so
  // an extra whose transcript processed but whose photos are still on the phone used
  // to read as ready — a client would open a link for evidence that had not left the
  // device (hadar, 2026-07-24). Photos have no AI stage, so they can't join the
  // procState fold as 'processed'; instead, ANY capture behind this extra (voice OR
  // paired photo) still queued for upload holds the whole extra at 'queued'.
  const pendingEvidence = (await db.getAll<{ n: number }>(
    `SELECT COUNT(*) AS n FROM capture_outbox o
      WHERE o.capture_id IN (
        SELECT dv.capture_id FROM decision_version dv
         WHERE dv.decision_id = ? AND dv.capture_id IS NOT NULL
        UNION
        SELECT p2.capture_id FROM capture_pair p2
         WHERE p2.pair_id IN (
           SELECT p1.pair_id FROM capture_pair p1
            WHERE p1.capture_id IN (
              SELECT dv.capture_id FROM decision_version dv WHERE dv.decision_id = ?
            )
         )
      )`, [decisionId, decisionId]))[0]?.n ?? 0;
  if (pendingEvidence > 0) states.push('queued');

  return states.length ? states : ['captured'];
}
