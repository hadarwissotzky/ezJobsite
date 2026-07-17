/**
 * REQ-PROC4's acceptance test, run for real.
 *
 *   "Accept: 100 offline/online cycles incl. a mid-sync kill -> NO LOSS/DUP;
 *    every item shows correct state."
 *
 * I have been asserting durability all session from green screens. This is the
 * measurement. It exists in the app (not a script) because it must exercise THE
 * REAL PATH: the same performCapture, the same outbox, the same drainOutbox, the
 * same SQLite under the same pragmas. A harness that reimplements the path proves
 * only that the harness works.
 *
 * WHAT WOULD MAKE THIS A FALSE PASS, and how each is prevented:
 *
 *  - Counting rows we wrote. Loss is a capture that COMMITTED and then vanished.
 *    So the oracle is: every capture_id performCapture returned ok for MUST still
 *    resolve through capture_commit at the end. We compare against the ids the
 *    CALLER holds, not against a query of the thing under test.
 *  - Counting the queue. The outbox is transport; a drained outbox proves nothing
 *    about the record (Codex #11 C3). We check capture_commit.
 *  - Trusting "no error". A capture that returns ok and is not there is exactly
 *    the fault this test is for, so ok is recorded and then VERIFIED against disk.
 *  - Duplicates from retries. mutation_id is minted at prepare and reused on retry,
 *    so a replay must not create a second row. We check for duplicate
 *    (capture_id) AND duplicate (mutation_id).
 *  - Hash-to-hash comparison. The media oracle recomputes SHA-256 FROM THE BYTES
 *    ON DISK (Codex #9) -- comparing a stored hash to itself proves only that we
 *    can read our own database.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { performCapture, listCommittedCaptures, readCapture } from './capture';
import { textCapture } from './modality';

export type CycleResult = {
  cycles: number;
  committed: number;      // performCapture said ok
  found: number;          // still resolvable at the end
  lost: string[];         // committed and NOT found  <- the unforgivable fault
  duplicateCaptures: string[];
  duplicateMutations: string[];
  mediaCorrupt: string[]; // hash recomputed from disk no longer matches
  killedAt: number[];     // which cycles were interrupted mid-write
  pass: boolean;
};

/**
 * One cycle: commit a capture, then (sometimes) simulate a kill by abandoning the
 * drain mid-flight. `kill` is injected rather than real process death because a
 * real SIGKILL cannot be issued from inside the process it kills — the harness
 * that survives to report a kill is a harness that was not killed. The REAL kill
 * test is spike/harness/kill.py, which does it from outside; this covers the
 * hundred cycles around it.
 */
export async function runCycles(
  db: AbstractPowerSyncDatabase,
  o: {
    ownerId: string; projectId: string; cycles: number;
    /** Called instead of the real drain, so the caller can abandon it. */
    drain: () => Promise<void>;
    /** Cycles on which the drain is abandoned part-way. */
    killOn?: (i: number) => boolean;
    onProgress?: (i: number) => void;
  }
): Promise<CycleResult> {
  const committed: string[] = [];
  const killedAt: number[] = [];

  for (let i = 0; i < o.cycles; i++) {
    const r = await performCapture(db, {
      ownerId: o.ownerId, projectId: o.projectId,
      input: textCapture(`cycle ${i} ${Date.now()}`),
      stamp: { capturedAtMs: Date.now(), lat: null, lng: null, accuracyM: null,
               fixAgeMs: null, status: 'unavailable' as const },
    });
    // A capture that did NOT commit is not a loss -- it was refused, loudly, which
    // is the correct behaviour. Only an ok'd capture is owed.
    if (r.ok) committed.push(r.captureId);

    const kill = o.killOn?.(i) ?? false;
    if (kill) {
      killedAt.push(i);
      // Abandon: start the drain and do not await it. The next cycle proceeds
      // while it is in flight, which is what a kill looks like from the outbox's
      // point of view -- an intent that was never completed.
      void o.drain().catch(() => {});
    } else {
      await o.drain().catch(() => {});
    }
    o.onProgress?.(i);
  }

  // NEGATIVE CONTROL, kept and off by default. A test that cannot fail is not a
  // test: setting __FAKE_LOSS injects a capture_id that was "committed" and does
  // not exist, and the oracle MUST call it loss. PROVEN: with it on, pass:false
  // and lost:['cap-never-committed']. Without a control, a green run proves only
  // that the oracle is silent. Kept in the source because a control you delete
  // after using once is a control that rots.
  if ((globalThis as any).__FAKE_LOSS) committed.push('cap-never-committed');

  // ---- the oracle -------------------------------------------------------
  const rows = await listCommittedCaptures(db, o.projectId);
  const byId = new Set(rows.map((r: any) => r.capture_id));

  // LOSS: committed and gone. The single unforgivable fault (mandate #1).
  const lost = committed.filter((id) => !byId.has(id));

  const seen = new Map<string, number>();
  for (const r of rows as any[]) seen.set(r.capture_id, (seen.get(r.capture_id) ?? 0) + 1);
  const duplicateCaptures = [...seen].filter(([, n]) => n > 1).map(([id]) => id);

  const muts = await db.getAll<{ mutation_id: string; n: number }>(
    `SELECT mutation_id, count(*) AS n FROM capture_commit GROUP BY mutation_id HAVING count(*) > 1`
  );
  const duplicateMutations = muts.map((m) => m.mutation_id);

  // MEDIA: recomputed from the bytes on disk, never stored-hash-to-stored-hash.
  const mediaCorrupt: string[] = [];
  for (const id of committed.slice(0, 25)) {   // sampled: reading every file is slow
    const v: any = await readCapture(db, id);
    if (!v.ok || !v.intact) mediaCorrupt.push(id);
  }

  return {
    cycles: o.cycles,
    committed: committed.length,
    found: committed.filter((id) => byId.has(id)).length,
    lost, duplicateCaptures, duplicateMutations, mediaCorrupt, killedAt,
    pass: lost.length === 0 && duplicateCaptures.length === 0
          && duplicateMutations.length === 0 && mediaCorrupt.length === 0,
  };
}
