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
import { logDiag } from './diaglog.ts';

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
  // THE DELETED EXTRA'S OWN ROW. capture_discarded tombstones the CAPTURES; this
  // tombstones the CHANGE ORDER, and its absence was the bug that made delete "not
  // work": hydrateChangeOrders re-pulls every server change_order for the project on
  // the 15s tick with INSERT OR IGNORE, so a synced draft deleted locally reappeared
  // seconds later — the server still had it, and nothing local said "I deleted this"
  // (hadar, 2026-07-28: "the page closes and it doesn't delete the extra"). hydrate now
  // skips any id in here, so the delete survives every tick, offline, and a reinstall.
  //
  // MUTABLE, unlike capture_discarded: `server_done` flips 0→1 once the server's own
  // row is gone, so this is sync bookkeeping (like discard_synced2), not an evidence
  // record — hence no append-only trigger. A row is never removed: forgetting a
  // tombstone is how the ghost comes back.
  `CREATE TABLE IF NOT EXISTS change_order_discarded (
      change_order_id TEXT NOT NULL PRIMARY KEY,
      at_ms           INTEGER NOT NULL,
      server_done     INTEGER NOT NULL DEFAULT 0
   ) STRICT`,
];

export async function ensureDiscardSchema(db: AbstractPowerSyncDatabase) {
  for (const s of DISCARD_DDL) await db.execute(s);
}

/** The extras this device has deleted, for hydrateChangeOrders to skip so the server
 *  copy never resurrects a locally-deleted extra. */
export async function discardedExtraIds(
  db: AbstractPowerSyncDatabase
): Promise<Set<string>> {
  const rows = await db.getAll<{ change_order_id: string }>(
    `SELECT change_order_id FROM change_order_discarded`);
  return new Set(rows.map((r) => r.change_order_id));
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
    // "uploaded" is DERIVED, the same way capture.ts derives it: the outbox
    // still holding the intent IS pending. `pending_upload` is not a stored
    // column — this query referenced one anyway, threw "no such column", and
    // the record screen's Delete died as an unhandled rejection with nothing
    // on screen (hadar, on device 2026-07-23).
    `SELECT dv.capture_id                                        AS capture_id,
            (SELECT count(*) FROM change_order c2
              WHERE c2.decision_id = dv.decision_id)             AS used,
            (SELECT count(*) FROM capture_commit cc
              WHERE cc.capture_id = dv.capture_id
                AND NOT EXISTS (SELECT 1 FROM capture_outbox o
                                 WHERE o.capture_id = cc.capture_id)) AS uploaded
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
    try {
      const { error } = await client.rpc('discard_extra_own', {
        p_change_order_id: changeOrderId,
      });
      if (error) {
        // 42501 is the server saying no on the merits. Anything else -- no signal,
        // a timeout, the RPC not deployed, a local-only draft the server has never
        // seen ("no such extra") -- is this device being unable to ask, which is not
        // a no. Only a genuine refusal stops the local delete.
        const refused = /not your extra|was sent/i.test(error.message ?? '');
        // Logged either way: a delete that "does nothing" left no trace of WHY the
        // server said no, and this path burned a device round. Now the reason is in
        // the flight recorder — refusal vs unreachable vs not-deployed all read
        // differently here (hadar, 2026-07-28).
        void logDiag(db, 'discardExtra.rpc',
          `${refused ? 'refused' : 'proceed'}: ${String(error.message ?? error).slice(0, 160)}`);
        if (refused) {
          return { ok: false, reason: 'already_sent', deleted: 0, freedBytes: 0,
                   serverPending: 0, serverDone: false };
        }
      } else serverDone = true;
    } catch (e: any) {
      // rpc() THREW (a network or auth exception, not a returned error). Before this
      // catch existed, the throw propagated out of discardExtra and the local delete
      // below never ran — the tap "did nothing" on a flaky connection (mandate #7:
      // no signal is the expected condition, never a reason a delete fails to happen).
      // A throw is unreachable-server, not a refusal, so fall through and delete
      // locally; the change_order_discarded tombstone + drainDiscardedExtras reconcile
      // the cloud copy from here, and hydrate never resurrects it in the meantime.
      void logDiag(db, 'discardExtra.rpc', `threw: ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }

  // THE WHOLE PAIR GROUP, not just the voice. An extra's captures are its voice
  // (the one in decision_version) AND the photos snapped with it — a fused capture
  // writes each photo as its own capture_commit and ties them to the narration
  // through capture_pair; the photos are NOT in decision_version. planDiscard only
  // ever sees the decision_version captures, so on its own this tombstoned the voice
  // and left every photo as a LIVE orphan: bytes still on disk, a row still in the
  // gallery, and a capture_outbox entry retrying against an extra that no longer
  // exists (hadar, 2026-07-27: deleting a draft "doesn't remove it"). Walk the pair
  // from each deletable capture and take the group. Expanded from plan.deleteCaptures
  // only, so a capture a sibling extra still uses (kept out of deleteCaptures) is
  // never dragged in through a shared photo.
  const groupIds = new Set(plan.deleteCaptures);
  if (plan.deleteCaptures.length) {
    const marks = plan.deleteCaptures.map(() => '?').join(',');
    const sib = await db.getAll<{ capture_id: string }>(
      `SELECT capture_id FROM capture_pair
        WHERE pair_id IN (SELECT pair_id FROM capture_pair WHERE capture_id IN (${marks}))`,
      plan.deleteCaptures);
    for (const s of sib) groupIds.add(s.capture_id);
  }
  const ids = [...groupIds];

  // Paths read BEFORE the rows go, because capture_commit is where they live.
  const paths = new Map<string, { relpath: string; bytes: number }>();
  for (const id of ids) {
    const r = await db.getAll<{ media_relpath: string; media_bytes: number }>(
      `SELECT media_relpath, media_bytes FROM capture_commit WHERE capture_id = ?`, [id]);
    if (r.length) paths.set(id, { relpath: r[0].media_relpath, bytes: r[0].media_bytes });
  }

  const now = Date.now();
  await db.writeTransaction(async (tx) => {
    for (const id of ids) {
      await tx.execute(
        `INSERT OR IGNORE INTO capture_discarded
           (capture_id, change_order_id, at_ms, bytes_freed) VALUES (?, ?, ?, ?)`,
        [id, changeOrderId, now, paths.get(id)?.bytes ?? null]);
      // A deleted capture must never upload afterwards — resurrection by outbox is
      // worse than a stale card — and its pair rows are grouping metadata with
      // nothing left to group. Same cleanup discardCapture does, for the same bugs.
      await tx.execute(`DELETE FROM capture_outbox WHERE capture_id = ?`, [id]);
      await tx.execute(`DELETE FROM capture_pair WHERE capture_id = ?`, [id]);
    }
    // The outbox FIRST: an entry that outlived its change order would try to
    // upload a row that no longer exists and park forever with a reason nobody
    // can act on.
    await tx.execute(`DELETE FROM change_order_outbox WHERE change_order_id = ?`, [changeOrderId]);
    await tx.execute(`DELETE FROM change_order WHERE id = ?`, [changeOrderId]);
    // THE TOMBSTONE, in the same transaction as the delete so the intent is as
    // durable as the deletion. server_done is 1 only when 369 already dropped the
    // server row this call; otherwise 0, and drainDiscardedExtras retries the RPC on
    // later ticks. Either way hydrateChangeOrders now skips this id, so the extra
    // cannot come back on the 15s tick — which is the bug the user actually saw.
    await tx.execute(
      `INSERT OR IGNORE INTO change_order_discarded (change_order_id, at_ms, server_done)
       VALUES (?, ?, ?)`,
      [changeOrderId, now, serverDone ? 1 : 0]);
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
    deleted: ids.length,
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
 * The cloud half of "delete an extra": drop the server's own change_order row for
 * every extra deleted while the server was unreachable (server_done = 0).
 *
 * WHY IT EXISTS. discardExtra deletes the LOCAL row and tombstones, but 369
 * (`discard_extra_own`) is the only thing that drops the SERVER row — and it was
 * called once, at delete time, with no retry. Offline at that moment (the field's
 * normal state, mandate #7), or a transient error, left the server row alive; hydrate
 * skips it locally now, but on a reinstall or a second phone that tombstone is absent
 * and the ghost returns. This closes that gap the same way drainServerDiscards closes
 * it for capture bytes: idempotent, on the tick, until the server confirms.
 *
 * "no such extra" (42704) is DONE, not an error: the row is already gone, which is the
 * goal. A genuine refusal ("was sent") is the rare offline race — the extra was sent
 * after this device deleted its draft copy; the local delete stands, the server keeps
 * its sent record, and we stop retrying and log it rather than hammer a no forever.
 */
export async function drainDiscardedExtras(
  db: AbstractPowerSyncDatabase, client: SupabaseClient
): Promise<{ attempted: number; done: number; kept: number }> {
  const pending = await db.getAll<{ change_order_id: string }>(
    `SELECT change_order_id FROM change_order_discarded WHERE server_done = 0 LIMIT 50`);
  if (!pending.length) return { attempted: 0, done: 0, kept: 0 };

  let done = 0, kept = 0;
  for (const { change_order_id } of pending) {
    let confirmed = false;
    try {
      const { error } = await client.rpc('discard_extra_own', {
        p_change_order_id: change_order_id,
      });
      if (!error) confirmed = true;
      else if (/no such extra/i.test(error.message ?? '')) confirmed = true;   // already gone = done
      else if (/not your extra|was sent/i.test(error.message ?? '')) {
        // The offline race. Stop retrying — the answer will not change — but record it.
        void logDiag(db, 'ddrain.extra.kept',
          `${change_order_id}: ${String(error.message ?? error).slice(0, 120)}`);
        confirmed = true; kept++;
      } else {
        // Unreachable / not deployed: leave server_done = 0, try again next tick.
        void logDiag(db, 'ddrain.extra',
          `${change_order_id}: ${String(error.message ?? error).slice(0, 120)}`);
        continue;
      }
    } catch (e: any) {
      void logDiag(db, 'ddrain.extra', `${change_order_id}: threw ${String(e?.message ?? e).slice(0, 120)}`);
      continue;   // offline; the tombstone waits, hydrate still skips it locally
    }
    if (confirmed) {
      await db.execute(
        `UPDATE change_order_discarded SET server_done = 1 WHERE change_order_id = ?`,
        [change_order_id]);
      done++;
    }
  }
  return { attempted: pending.length, done, kept };
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
      // A deleted capture must never upload afterwards — resurrection by outbox
      // is worse than a stale card. hadar's phone carried three of these:
      // deleted captures whose upload rows kept retrying against a project the
      // server never had, surfacing as "3 won't back up" forever.
      await tx.execute(`DELETE FROM capture_outbox WHERE capture_id = ?`, [id]);
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


/**
 * Push local discards to the cloud, when there is signal.
 *
 * hadar's rule is "deleted means all of it", and the phone half already holds:
 * bytes gone, lists clean, tombstone written. This is the cloud half — for
 * every locally tombstoned capture the server has not yet confirmed, ask 371 to
 * drop the storage object. Offline is the normal case (mandate #7): the
 * tombstones simply wait, exactly like every other outbox here.
 *
 * `discard_synced` marks confirmation, one row per capture, never uploaded —
 * "has the SERVER dealt with this" is a fact about sync state, not evidence.
 * The server counts a capture it never received as `missing`, and missing is
 * CONFIRMED: there is nothing in the bucket to delete, so asking again forever
 * would be the retry-loop-with-no-exit this repo has already shipped once.
 * `kept` (refused: not ours, or evidence behind a sent request) is confirmed
 * for the same reason — the server said no on the merits, and no is an answer.
 */
export const DISCARD_SYNC_DDL = [
  // GENERATION 2. The first generation was confirmed by an absent error rather
  // than a count, so its rows say "done" about bytes still in the bucket — and
  // my attempt to reset it by timestamp compared against a hand-estimated epoch
  // that was WRONG, matching nothing. Clock arithmetic was the wrong tool; a
  // new generation is the right one: v1 is simply never read again, and every
  // tombstone re-confirms under the count rule.
  `CREATE TABLE IF NOT EXISTS discard_synced2 (
      capture_id TEXT NOT NULL PRIMARY KEY,
      at_ms      INTEGER NOT NULL
   ) STRICT`,
];

export async function ensureDiscardSyncSchema(db: AbstractPowerSyncDatabase) {
  for (const s of DISCARD_SYNC_DDL) await db.execute(s);
}

export async function drainServerDiscards(
  db: AbstractPowerSyncDatabase, client: SupabaseClient
): Promise<{ attempted: number; discarded: number; kept: number; missing: number }> {
  const pending = await db.getAll<{ capture_id: string }>(
    `SELECT d.capture_id FROM capture_discarded d
      WHERE d.capture_id NOT IN (SELECT capture_id FROM discard_synced2)
      LIMIT 50`);
  if (!pending.length) return { attempted: 0, discarded: 0, kept: 0, missing: 0 };

  const ids = pending.map((p) => p.capture_id);
  const { data, error } = await client.rpc('discard_captures_own', { p_capture_ids: ids });
  // Offline, or the migration not applied: not a no. The tombstones wait — and
  // the reason is written down, because "waits forever, silently" and "works"
  // are indistinguishable from outside; that identity burned four diagnosis
  // rounds in one day.
  if (error) {
    void logDiag(db, 'ddrain.rpc', String((error as any)?.message ?? error).slice(0, 200));
    return { attempted: ids.length, discarded: 0, kept: 0, missing: 0 };
  }

  // THE SPLIT THE PLATFORM DEMANDS. Supabase forbids SQL deletes on storage
  // tables — the flight recorder caught 371 failing on exactly that, every
  // tick. So the RPC AUTHORIZES (guards + tombstone) and returns the approved
  // object keys, and this client removes the bytes through the Storage API,
  // fenced to its own folder by 372's delete policy. A key the RPC did not
  // return cannot be deleted here, and a key it did return is already
  // tombstoned server-side.
  const keys: string[] = Array.isArray((data as any)?.keys) ? (data as any).keys : [];
  let removed = 0;
  if (keys.length) {
    const rm = await client.storage.from('captures').remove(keys);
    if (rm.error) {
      // Bytes still there: nothing confirms; the batch retries idempotently.
      void logDiag(db, 'ddrain.storage', String(rm.error.message ?? rm.error).slice(0, 200));
      return { attempted: ids.length, discarded: 0, kept: 0, missing: 0 };
    }
    // THE LIE THAT COST A ROUND: remove() reports success with an EMPTY result
    // when RLS filters every row — no error, nothing deleted. The first version
    // read "no error" as done and confirmed 12 tombstones whose bytes were
    // still sitting in the bucket. Success is a COUNT, not the absence of an
    // error: zero removals with keys outstanding is a failure with extra steps.
    removed = Array.isArray(rm.data) ? rm.data.length : 0;
    if (removed === 0) {
      void logDiag(db, 'ddrain.storage',
        `removed=0 of ${keys.length} — API ok but RLS filtered; first=${keys[0]?.slice(0, 60)}`);
      return { attempted: ids.length, discarded: 0, kept: 0, missing: 0 };
    }
  }
  void logDiag(db, 'ddrain.ok', JSON.stringify({ removed, ...(data as any) }));

  const now = Date.now();
  for (const id of ids) {
    await db.execute(
      `INSERT OR IGNORE INTO discard_synced2 (capture_id, at_ms) VALUES (?, ?)`, [id, now]);
  }
  return {
    attempted: ids.length,
    discarded: keys.length,
    kept: Number((data as any)?.kept ?? 0),
    missing: Number((data as any)?.missing ?? 0),
  };
}
