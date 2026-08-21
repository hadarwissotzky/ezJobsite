/**
 * WHOSE PHONE IS THIS — the device-handoff guard.
 *
 * hadar, 2026-08-21: "I have logged out from one user, and logged in to another user
 * phone number. At first it logged me in to the last known user on the phone content."
 *
 * ─── WHY IT HAPPENED ────────────────────────────────────────────────────────────
 * `signOut()` was one line: `auth.signOut()`. It ended the SESSION and nothing else.
 * Everything this app is — the local-first copy of every capture, decision, extra,
 * note, tag, thread and project — stayed exactly where it was on the device, because
 * that copy is the product and nothing had ever been told to remove it.
 *
 * The second user then signed in and the app showed it to them, because ALMOST NO
 * LOCAL READ IS OWNER-SCOPED. `listCommittedCaptures(db, projectId)`, the Home extras
 * query, `listProjects(db)` — they filter by PROJECT, not by user, and correctly so:
 * on a single-tenant device the owner of a row is not a question worth asking. The
 * device having exactly one user was an assumption the queries were built on and
 * nothing enforced.
 *
 * ─── WHY THE FIX IS A WIPE AND NOT AN owner_id FILTER ───────────────────────────
 * Adding `WHERE owner_id = ?` to ~40 queries would hide user A's rows from user B
 * while leaving them on B's phone: A's photos, A's audio, A's prices, A's clients'
 * phone numbers, sitting in a database B holds in their hand and a media directory
 * any file browser can reach. Hiding is not the requirement. LEAVING is the defect.
 * The device belongs to whoever is signed in to it, and a handover has to be real.
 *
 * ─── WHERE THE WIPE FIRES, AND WHY NOT AT SIGN-OUT ──────────────────────────────
 * At SIGN-IN, and only when the user id differs from the one this device last held.
 * Wiping at sign-out would destroy the data of somebody who signs out and straight
 * back in as themselves — a mis-tap, a token refresh they misread, a support step —
 * and that data includes captures that have not drained yet. Mandate #1 does not
 * permit that trade for convenience.
 *
 * Keying on the user id means: same person back → nothing is touched, offline drafts
 * and queued captures survive; different person → the device is cleared before their
 * first frame.
 *
 * ─── AND WHEN THE PREVIOUS USER STILL HAS UNSENT WORK, THE SWITCH IS REFUSED ────
 * A capture that has not uploaded exists ONLY on this device. Wiping it to protect
 * confidentiality would destroy evidence the app already said was saved — a
 * confidentiality bug traded for a durability one, which mandate #1 forbids. So a
 * handover with a non-empty outbox is REFUSED: nothing is deleted, the incoming user
 * is not signed in, and the way out is the previous user signing back in (a same-user
 * claim, so their data is untouched) and letting the drain finish.
 *
 * This ordering — refuse · purge · bind — is not invented here. It was specified in
 * `docs/IMPLEMENTATION_NOTES.md` §6 on 2026-08-05, when the class of bug was found
 * and written up rather than fixed; this module is that specification built.
 *
 * The complementary warning lives where the person who can still act is standing:
 * the sign-out confirmation counts the unsent rows and says what a handover would
 * mean (App.tsx `unsentWork` → drawer.tsx).
 *
 * ─── WHY AsyncStorage AND NOT device_settings ───────────────────────────────────
 * The identity has to survive the very purge it triggers. `purgeLocalData` DROPs
 * every app-owned SQLite table — `device_settings` included — so a marker stored
 * there would be erased by the wipe and the next launch would believe the device had
 * never had an owner. AsyncStorage is outside that blast radius, which is the whole
 * reason it is used here.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { purgeLocalData, purgeLocalMedia } from './closeaccount.ts';
import { inFlight } from './ota.ts';

/** Device-level, not account-level: it outlives every session on this handset. */
const OWNER_KEY = 'device_last_user_id';

/**
 * Required INSIDE the functions, never at module scope. A top-level React Native
 * import makes this file unloadable under `node --test`, and the decision below —
 * which is the part that can be wrong in a way that leaks one user's jobsite to
 * another — is exactly the part that has to stay testable. Same trap `closeaccount.ts`
 * documents for expo-file-system.
 */
function storage() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@react-native-async-storage/async-storage').default;
}

export async function lastDeviceUser(): Promise<string | null> {
  try {
    return await storage().getItem(OWNER_KEY);
  } catch {
    // Unreadable storage must not be read as "nobody has used this phone" — that
    // answer would skip the wipe, which is the failure this module exists to prevent.
    // Throwing hands the decision to `claimDevice`, which refuses.
    throw new Error('device owner unreadable');
  }
}

export async function rememberDeviceUser(userId: string): Promise<void> {
  await storage().setItem(OWNER_KEY, userId);
}

export type Claim =
  /** Same person as last time, or the first person ever. Nothing was touched. */
  | { wiped: false }
  /** A different person signed in; the previous user's data is gone from this device. */
  | { wiped: true; previousUser: string }
  /**
   * A different person signed in while the previous user still has work that has
   * never reached the cloud. NOTHING WAS DELETED and the new user is not signed in.
   * The only way forward is the previous user signing back in and draining.
   */
  | { refused: true; unsent: number; previousUser: string }
  /** The handover could not be completed. The caller MUST NOT show any local data. */
  | { failed: true; reason: string };

/**
 * Claim this device for `userId`, wiping it first if it belonged to somebody else.
 *
 * THE ORDER IS DELIBERATE AND IT IS THE ONLY ORDER THAT IS SAFE:
 *   1. purge the media files, 2. purge the database, 3. THEN record the new owner.
 *
 * Recording first would mean a purge that dies halfway (a file the OS will not
 * release, a locked database) leaves the device marked as belonging to B while A's
 * rows are still in it — and the next launch, seeing a matching owner, would skip the
 * wipe forever. Recording last means an interrupted handover is simply retried on the
 * next sign-in, which is the failure mode worth having.
 *
 * A FAILURE IS REPORTED, NEVER SWALLOWED. Falling through to "signed in, showing the
 * previous user's jobs" is the exact bug being fixed; the caller signs the new user
 * out instead.
 *
 * `deps` exists so the decision can be tested under `node --test`, where neither
 * expo-file-system nor a PowerSync database exists.
 */
export async function claimDevice(
  db: AbstractPowerSyncDatabase,
  userId: string,
  deps: {
    lastUser?: () => Promise<string | null>;
    remember?: (id: string) => Promise<void>;
    purgeData?: (d: AbstractPowerSyncDatabase) => Promise<void>;
    purgeMedia?: () => Promise<void>;
    /**
     * Fired the instant a wipe is decided on and BEFORE anything is destroyed, so the
     * caller can take the UI off the database first. Not a progress callback: from
     * here until this function returns, the app-owned tables may not exist.
     *
     * The common case — same user signing back in — never reaches it, which is why
     * this is a callback and not a flag the caller sets around the whole call.
     */
    onWipeStart?: () => void;
    /** Rows queued across every owned outbox plus open capture drafts. Defaults to
     *  `inFlight` — the audited list, shared with the OTA gate. */
    pendingWork?: (d: AbstractPowerSyncDatabase) => Promise<number>;
  } = {}
): Promise<Claim> {
  const lastUser = deps.lastUser ?? lastDeviceUser;
  const remember = deps.remember ?? rememberDeviceUser;
  const purgeData = deps.purgeData ?? purgeLocalData;
  const purgeMedia = deps.purgeMedia ?? purgeLocalMedia;
  const pendingWork = deps.pendingWork ?? (async (d: AbstractPowerSyncDatabase) => {
    const f = await inFlight(d);
    // -1 means the count itself failed. Treat "I do not know whether there is unsent
    // evidence" as "there is": the alternative is deleting on a guess.
    if (f.queued < 0) return 1;

    /**
     * DRAFTS THAT HOLD SOMETHING — not merely drafts that are open.
     *
     * `inFlight.openDrafts` counts `capture_draft WHERE state = 'open'`, which is the
     * right question for the OTA gate (reloading the runtime under an armed recorder
     * is disruptive whether or not it has banked a byte yet). It is the WRONG question
     * here, and the difference deadlocked hadar's phone on 2026-08-21:
     *
     * An EMPTY open draft — camera opened, nothing recorded, app backgrounded — never
     * drains, because nothing drains a draft; it is committed or discarded by a human.
     * And it is never offered for recovery either, because `recoverable` deliberately
     * requires real content ("a recovery prompt for nothing teaches people to dismiss
     * recovery prompts"). So it sits there, invisible and unresolvable, refusing every
     * handover for the life of the install. His refusal said "1 item(s)" and no amount
     * of signal could ever clear it.
     *
     * The refusal exists to protect work a human would be upset to lose. An empty
     * draft is not that, and blocking on it protects nothing while costing the device
     * its only route to a second account.
     */
    let drafts = 0;
    try {
      const r = await d.getAll<{ n: number }>(
        `SELECT COUNT(*) AS n FROM capture_draft dr
          WHERE dr.state = 'open'
            AND EXISTS (SELECT 1 FROM capture_draft_item i WHERE i.draft_id = dr.draft_id)`);
      drafts = r[0]?.n ?? 0;
    } catch { /* no draft table yet -> nothing is held in one */ }

    return f.queued + drafts;
  });

  let previous: string | null;
  try {
    previous = await lastUser();
  } catch (e: any) {
    return { failed: true, reason: e?.message ?? 'device owner unreadable' };
  }

  if (previous === userId) return { wiped: false };

  if (previous === null) {
    // A device nobody has claimed. This is the ordinary first sign-in AND the first
    // launch after this code ships to a phone already in use — in which case the data
    // on it belongs to the person signing in right now, so wiping would destroy the
    // user's own work to protect them from themselves. Claim, do not purge.
    try {
      await remember(userId);
      return { wiped: false };
    } catch (e: any) {
      return { failed: true, reason: e?.message ?? 'could not record device owner' };
    }
  }

  /**
   * DURABILITY OUTRANKS THE LEAK — the branch specified in IMPLEMENTATION_NOTES §6(a)
   * on 2026-08-05, before this was ever built.
   *
   * A capture that has not uploaded exists ONLY on this device; the outboxes are the
   * proof. Wiping here would destroy evidence the app has already told somebody was
   * saved, which converts a confidentiality bug into a durability bug — strictly the
   * worse trade, and the one thing mandate #1 does not permit.
   *
   * So the switch is REFUSED and nothing is deleted. The way out is not a button here
   * — it is the previous user signing back in (which is a same-user claim, so their
   * data is untouched) and letting the drain finish.
   *
   * This is the case the §6 verification gate calls "the one that matters": where
   * confidentiality and durability disagree, and durability wins.
   */
  let unsent: number;
  try {
    unsent = await pendingWork(db);
  } catch (e: any) {
    return { failed: true, reason: e?.message ?? 'could not count unsent work' };
  }
  if (unsent > 0) return { refused: true, unsent, previousUser: previous };

  try {
    deps.onWipeStart?.();
    await purgeMedia();
    await purgeData(db);
    await remember(userId);
  } catch (e: any) {
    return { failed: true, reason: e?.message ?? 'handover failed' };
  }
  return { wiped: true, previousUser: previous };
}
