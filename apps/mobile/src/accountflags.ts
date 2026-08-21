/**
 * "HAVE I SEEN THIS BEFORE?" — asked of the ACCOUNT, not of the handset.
 *
 * hadar, 2026-08-21: *"when I logged in with an existing user after I had to remove the
 * app and reinstall, it took me through the onboarding sequence again (first time CO)
 * although I have many COs. It's a cache issue again — check the local flags, need to
 * set some of them based on user content."*
 *
 * ─── THE DEFECT ─────────────────────────────────────────────────────────────────
 * Three flags decide whether someone is new:
 *
 *   `profile_done`      (device_settings) → the setup flow: language, who you are,
 *                                           what the app does
 *   `first_run_done`    (device_settings) → the same gate's other half
 *   `first_extra_seen`  (device_settings) → the guided first change order
 *
 * All three record what THIS PHONE has shown its holder, which was a defensible
 * reading right up until the phone changes. A reinstall — or the device handover in
 * `deviceowner.ts`, which wipes `device_settings` on purpose — takes them with it, and
 * a contractor with sixty change orders is greeted as somebody who has never made one.
 *
 * The guided start also tests `!homeExtras.length && !projects.length`, so in principle
 * it clears itself once sync lands. In practice sync is exactly what has not happened
 * yet at the moment those screens render, which is why hadar saw it: on a fresh install
 * the local database is genuinely empty for the first seconds of the first session, and
 * "no local rows" is indistinguishable from "new user" unless somebody asks.
 *
 * ─── THE FIX: TWO SOURCES, NEITHER OF WHICH IS THIS DEVICE ──────────────────────
 * 1. **The session's own `user_metadata`** — free, instant, works offline, because the
 *    token is already in hand. `saveProfile` has always mirrored the profile there
 *    precisely so it "follows the account across devices"; nothing ever read it back.
 *    That is the whole bug for the setup flow: the data was there the entire time.
 * 2. **A one-row existence probe against the server** — does this account own any
 *    change order or any real job? Best-effort and opportunistic (mandate #7): with no
 *    signal it simply does not answer, and the content-based gate in App.tsx still
 *    clears the screen once sync arrives. It is the difference between "correct
 *    eventually" and "correct on the first frame", and the first frame is the one that
 *    made hadar think the app had lost his work.
 *
 * ─── WHAT IT WILL NOT DO ────────────────────────────────────────────────────────
 * It never sets a flag from an ABSENCE. "No change orders came back" can mean a new
 * account or a failed query, and marking someone as onboarded on a failed query would
 * skip setup for a genuinely new user — leaving them with no profile and no idea what
 * the app is. Only positive evidence moves anything.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient, User } from '@supabase/supabase-js';

import { INBOX_ID } from './captureddl.ts';
import { markFirstExtraSeen, markFirstRunDone, saveLang } from './firstrun.ts';
import { hasProfile, restoreProfileFromAccount } from './profile.ts';

export type Restored = {
  /** The profile cache was rebuilt from the account, so setup will not be asked for. */
  profile: boolean;
  /** The account demonstrably has content, so the first-run gates were marked seen. */
  content: boolean;
  /** The server could not be asked. The content gate falls back to sync landing. */
  offline: boolean;
};

/**
 * Does this account own anything? ONE ROW IS THE ANSWER — `limit(1)` on each table,
 * not a count, because the question is "any" and a contractor with 4,000 captures
 * should not pay for a count to be told what the first row already says.
 *
 * RLS does the scoping (`owner_id = auth.uid()` plus the company-scoped read policies),
 * so this asks about the caller and cannot be pointed at anyone else.
 *
 * INBOX IS EXCLUDED, and it has to be: `ensureProjectSchema` creates the inbox on every
 * device for every user before anything else happens, so counting it would make every
 * account look established and no one would ever see the guided start.
 */
/**
 * A HARD CEILING ON THE PROBE, because `setSession` is waiting on it.
 *
 * `restoreFlags` is awaited BEFORE `setSession`, so every millisecond here is a
 * millisecond the user stares at the sign-in screen after typing a correct code —
 * "I am entering the code but nothing happens", a sentence this project has already
 * heard once. `localHasContent` keeps a warm device off this path entirely, but the
 * case that DOES reach it is a fresh install, which is also the case most likely to
 * be on a jobsite with one bar.
 *
 * Six seconds, then the answer is "could not ask" — already a first-class outcome
 * here, costing only that the onboarding gates stay unreconciled until the next
 * launch. Being wrong slowly is worse than being unsure quickly.
 */
const PROBE_TIMEOUT_MS = 6_000;

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(null); },
    );
  });
}

async function accountHasContent(
  supabase: SupabaseClient
): Promise<{ any: boolean; asked: boolean }> {
  try {
    // null = timed out, which is "could not ask", NEVER "no content".
    const co = await withTimeout(
      supabase.from('change_order').select('id').limit(1), PROBE_TIMEOUT_MS);
    if (!co || co.error) return { any: false, asked: false };
    if (co.data?.length) return { any: true, asked: true };

    const pj = await withTimeout(
      supabase.from('project').select('id').neq('id', INBOX_ID).limit(1), PROBE_TIMEOUT_MS);
    if (!pj || pj.error) return { any: false, asked: false };
    return { any: !!pj.data?.length, asked: true };
  } catch {
    // Offline is the NORMAL case for this product, not an error.
    return { any: false, asked: false };
  }
}

/**
 * Does the DEVICE already hold content? Asked first, so the server is not.
 *
 * THIS IS THE MANDATE-#7 GUARD, and it is the reason the probe above is not simply
 * run on every sign-in. `setSession` waits on this reconciliation — it has to, or the
 * setup flow paints before the answer arrives — and a network round-trip in front of
 * `setSession` is precisely the invisible HTTP call that turned a cold start into a
 * 30-second splash once already (App.tsx, 2026-08-04).
 *
 * When the local database already has a change order or a real job, every gate in
 * App.tsx is ALREADY correct: they test content, not just flags. There is nothing for
 * the probe to discover, so a warm device never pays for it. It runs on a device that
 * looks empty — a fresh install or a post-handover wipe — which is exactly the case
 * where "no local rows" and "new user" are indistinguishable, and the only case where
 * the wrong answer costs a contractor his onboarding screens back.
 */
async function localHasContent(db: AbstractPowerSyncDatabase): Promise<boolean> {
  const one = async (sql: string, args: unknown[] = []) => {
    try {
      return (await db.getAll<{ id: string }>(sql, args as any[])).length > 0;
    } catch {
      return false;   // table not built yet -> definitionally nothing local
    }
  };
  if (await one(`SELECT id FROM change_order LIMIT 1`)) return true;
  return one(`SELECT id FROM project WHERE id != ? LIMIT 1`, [INBOX_ID]);
}

/**
 * Rebuild this device's "already onboarded" flags from the account behind `user`.
 *
 * Called at sign-in, after the device claim and after `ensureLocalSchema` — it writes
 * to `device_settings`, which does not exist before either.
 *
 * IDEMPOTENT AND CHEAP ON THE COMMON PATH: a device that already has a profile skips
 * step 1 entirely, and the existence probe is two `limit(1)` selects.
 */
export async function restoreAccountFlags(
  db: AbstractPowerSyncDatabase,
  supabase: SupabaseClient,
  user: User,
): Promise<Restored> {
  let profile = false;
  try {
    if (!(await hasProfile(db))) {
      const r = await restoreProfileFromAccount(db, user);
      profile = r.restored;
      // profile.ts hands the language back rather than writing it — its key belongs
      // to firstrun.ts, and that module cannot be imported from profile.ts. See the
      // note at the end of `restoreProfileFromAccount`.
      if (r.lang) await saveLang(db, r.lang);
    }
  } catch { /* a failed restore must not block sign-in; setup simply asks again */ }

  // The device answers first, for free, and usually settles it — see `localHasContent`.
  if (await localHasContent(db)) {
    try {
      await markFirstRunDone(db);
      await markFirstExtraSeen(db);
    } catch { /* the content-based gate in App.tsx still clears on the next refresh */ }
    return { profile, content: true, offline: false };
  }

  const { any, asked } = await accountHasContent(supabase);
  if (any) {
    try {
      // BOTH, together. They are two halves of one fact — "this person has used the
      // app before" — and setting only `first_run_done` would skip the profile step
      // and then still open the guided walkthrough over an account with sixty extras.
      await markFirstRunDone(db);
      await markFirstExtraSeen(db);
    } catch { /* the content-based gate in App.tsx still clears once sync lands */ }
  }
  return { profile, content: any, offline: !asked };
}
