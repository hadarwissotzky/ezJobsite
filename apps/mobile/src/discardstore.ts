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
// TYPE-ONLY, and it must stay that way. A value import pulls in React
// Native's Flow-typed source, which Node cannot parse, and the tests that
// exercise this file's SQL stop running.
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { planDiscard, type CaptureRef, type DiscardPlan } from './discard.ts';

/**
 * expo-file-system is loaded ON DEMAND. A static import makes this module
 * unloadable under `node --test` — Node cannot resolve the native package — and
 * a module the tests cannot import is a module the tests do not cover. That is
 * not hypothetical: delete shipped broken twice while every check passed,
 * because nothing executed its SQL.
 */
async function fs(): Promise<any | null> {
  try { return await import('expo-file-system/legacy'); } catch { return null; }
}

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
  db: AbstractPowerSyncDatabase, changeOrderId: string, client?: SupabaseClient
): Promise<{ ok: boolean; reason?: string; deleted: number; freedBytes: number;
             serverPending: number; serverDone: boolean }> {
  const plan = await previewDiscard(db, changeOrderId);
  if (!plan.allowed) {
    return { ok: false, reason: plan.reason, deleted: 0, freedBytes: 0,
             serverPending: 0, serverDone: false };
  }

  // THE SERVER FIRST, and only then the phone. 369 re-checks everything from the
  // server's own data -- ownership, ever-sent, shared captures -- and refuses on
  // its own terms. If it refuses, this device must NOT delete either: the phone
  // agreeing to something the server rejected is how the two stop describing the
  // same world. Offline is different from refused, and only refusal stops us.
  let serverDone = false;
  if (client) {
    const { error } = await client.rpc('discard_extra_own', {
      p_change_order_id: changeOrderId,
    });
    if (error) {
      // 42501 is the server saying no on the merits. Anything else -- no signal,
      // a timeout -- is this device being unable to ask, which is not a no.
      const refused = /not your extra|was sent/i.test(error.message ?? '');
      if (refused) {
        return { ok: false, reason: 'already_sent', deleted: 0, freedBytes: 0,
                 serverPending: 0, serverDone: false };
      }
    } else serverDone = true;
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
    await tx.execute(`DELETE FROM change_order_outbox WHERE change_order_id = ?`, [changeOrderId]);
    await tx.execute(`DELETE FROM change_order WHERE id = ?`, [changeOrderId]);
  });

  // Bytes last, and each failure is survivable: the tombstone already says
  // discarded, and recoverySweep collects an orphan whose row is gone.
  const F = await fs();
  let freedBytes = 0;
  for (const [, p] of paths) {
    if (!F) break;
    try {
      await F.deleteAsync(`${F.documentDirectory}${p.relpath}`, { idempotent: true });
      freedBytes += p.bytes;
    } catch { /* orphan; the sweep gets it */ }
  }

  return {
    ok: true,
    serverDone,
    deleted: plan.deleteCaptures.length,
    freedBytes,
    // Only still pending if the server was never reached. When 369 ran, the
    // objects are gone and there is nothing to warn about.
    serverPending: serverDone ? 0 : plan.needsServer.length,
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


/**
 * Discard a CAPTURE that was never confirmed into anything.
 *
 * A different thing from discarding an extra, and earlier in the life of the
 * evidence: this is the review screen's "I do not want this at all" — the
 * proposal has not become a decision, so no decision, no change order and no
 * counterparty depend on it. It is the cheapest possible moment to change your
 * mind, which is exactly why it must be offered.
 *
 * REFUSES ONCE IT HAS BEEN CONFIRMED. The moment a `decision_version` points at
 * this capture it is the evidence behind a decision, and a decision may already
 * carry an extra that has been sent. From there the path is `discardExtra`,
 * which does the sharing and ever-sent checks this cannot.
 *
 * Same shape as everywhere else here: the BYTES go, `capture_commit` stays
 * (its trigger refuses deletion and that is not negotiable), and a tombstone
 * records the act so a deliberate discard never looks like a silent loss.
 */
export async function discardCapture(
  db: AbstractPowerSyncDatabase, captureId: string
): Promise<{ ok: boolean; reason?: 'confirmed' | 'not_found'; freedBytes: number; deleted: number }> {
  // THE GUARD THAT BROKE ITSELF. It used to refuse whenever a decision_version
  // pointed at the capture, which meant "he confirmed it into a decision". Then
  // startExtraFromCapture began creating that row the instant a recording is
  // saved, so the condition became true for EVERY capture and this refused
  // everything — silently, because the caller only surfaced 'confirmed' as a
  // message and the list simply did not change. hadar: "even after i tap twice
  // the records are kept in the job list".
  //
  // The question was never "does a decision exist". It is the same question
  // discardExtra asks: HAS IT BEEN SENT. Nothing is owed to anyone until a link
  // goes out, and until then this is the contractor's own draft.
  const sent = await db.getAll<{ n: number }>(
    `SELECT count(*) AS n
       FROM change_order co
       JOIN decision_version dv ON dv.decision_id = co.decision_id
      WHERE dv.capture_id = ? AND co.status <> 'draft'`, [captureId]);
  if ((sent[0]?.n ?? 0) > 0) return { ok: false, reason: 'confirmed', freedBytes: 0, deleted: 0 };

  // THE WHOLE GROUP, NOT ONE ROW. What a contractor made is one thing — he
  // talked and took three photos of the same rot — and `capture_pair` is what
  // records that they belong together. Deleting only the row he happened to be
  // looking at would leave the photos behind as orphans he never asked to keep,
  // with no recording to explain them. hadar: "once it is deleted all of the
  // items (recordings, and images) are being deleted with it".
  const group = await db.getAll<{ capture_id: string }>(
    `SELECT capture_id FROM capture_pair
      WHERE pair_id IN (SELECT pair_id FROM capture_pair WHERE capture_id = ?)`,
    [captureId]);
  const ids = group.length ? group.map((g) => g.capture_id) : [captureId];

  // A sibling already confirmed makes the whole group evidence. Refuse rather
  // than delete around it and leave the group half gone.
  const confirmed = await db.getAll<{ n: number }>(
    `SELECT count(*) AS n
       FROM change_order co
       JOIN decision_version dv ON dv.decision_id = co.decision_id
      WHERE dv.capture_id IN (${ids.map(() => '?').join(',')})
        AND co.status <> 'draft'`, ids);
  if ((confirmed[0]?.n ?? 0) > 0) {
    return { ok: false, reason: 'confirmed', freedBytes: 0, deleted: 0 };
  }

  const rows = await db.getAll<{ capture_id: string; media_relpath: string; media_bytes: number }>(
    `SELECT capture_id, media_relpath, media_bytes FROM capture_commit
      WHERE capture_id IN (${ids.map(() => '?').join(',')})`, ids);
  if (!rows.length) return { ok: false, reason: 'not_found', freedBytes: 0, deleted: 0 };

  const now = Date.now();
  await db.writeTransaction(async (tx) => {
    for (const r of rows) {
      await tx.execute(
        `INSERT OR IGNORE INTO capture_discarded
           (capture_id, change_order_id, at_ms, bytes_freed) VALUES (?, ?, ?, ?)`,
        // No change order exists yet; the column records what it was discarded FROM.
        [r.capture_id, 'unsent', now, r.media_bytes]);
    }
  });

  // AND THE EXTRA ITSELF. Every recording now creates one (startextra.ts), so
  // deleting the media while leaving the change order would keep a row in the
  // ledger pointing at evidence that no longer exists — which is what "the
  // records are kept in the job list" looked like from the outside.
  await db.writeTransaction(async (tx) => {
    for (const id of ids) {
      await tx.execute(
        `DELETE FROM change_order_outbox WHERE change_order_id IN
           (SELECT co.id FROM change_order co
              JOIN decision_version dv ON dv.decision_id = co.decision_id
             WHERE dv.capture_id = ? AND co.status = 'draft')`, [id]);
      await tx.execute(
        `DELETE FROM change_order WHERE id IN
           (SELECT co.id FROM change_order co
              JOIN decision_version dv ON dv.decision_id = co.decision_id
             WHERE dv.capture_id = ? AND co.status = 'draft')`, [id]);
      // THE PAIR ROWS GO TOO, and their survival was a live bug: the home
      // screen's "captured walkthroughs" card is built from capture_pair ALONE,
      // so a fully deleted walkthrough — bytes gone, commits tombstoned, extra
      // removed — kept rendering as "walkthrough · 2 photos" forever. hadar
      // deleted one, watched it come back, and was right both times: the delete
      // worked and the card lied. Pair rows are grouping metadata, not
      // evidence; there is no append-only trigger here, and a group whose every
      // member is discarded has nothing left to group.
      await tx.execute(`DELETE FROM capture_pair WHERE capture_id = ?`, [id]);
    }
  });

  const F = await fs();
  let freedBytes = 0;
  for (const r of rows) {
    if (!F) break;
    try {
      await F.deleteAsync(`${F.documentDirectory}${r.media_relpath}`, { idempotent: true });
      freedBytes += r.media_bytes;
    } catch { /* orphan; recoverySweep collects it */ }
  }
  return { ok: true, freedBytes, deleted: rows.length };
}
