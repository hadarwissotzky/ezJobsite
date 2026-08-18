/**
 * IS THE PERSON HOLDING THIS PHONE A DEVELOPER?
 *
 * hadar, 2026-08-18: a flag on the user so hidden tools ("Show intro", "Replay first
 * change order") can be reached on a build where `__DEV__` is false.
 *
 * ─── WHY NOT JUST `__DEV__` ─────────────────────────────────────────────────────
 * `__DEV__` is a build-time constant the bundler strips from any release build. It
 * answers "is this a debug bundle", which is the wrong question: the case that matters is
 * hadar on TestFlight, holding a production build, wanting to replay the intro. No
 * build-time constant can answer "who is holding the phone".
 *
 * The two are ORed at the call sites, never here: a debug build keeps its tools whether
 * or not anyone is signed in, which is what makes the simulator useful before login.
 *
 * ─── CACHED, BECAUSE THE ANSWER IS NEEDED BEFORE THE NETWORK ────────────────────
 * The drawer renders on a jobsite with no signal, and a flag that silently reads false
 * offline would make the tools flicker in and out with connectivity — which reads as a
 * bug in the tools rather than in the flag. So the last known answer is kept in
 * `device_settings` and used until the server contradicts it.
 *
 * NOT STICKY, deliberately, and this is the difference from `credits_ever_purchased`
 * next door: that one records a fact about history ("has paid") which cannot become
 * untrue. This is a REVOCABLE grant. A false from the server overwrites a cached true,
 * so removing the row removes the flag on the next launch — a permission you cannot take
 * back is not a permission, it is a release.
 *
 * ─── IT REVEALS, IT DOES NOT AUTHORISE ──────────────────────────────────────────
 * Same rule the migration states. Everything gated on this must be something the user
 * could already do to his own data. It must never be the check that lets someone read
 * another company's rows or bypass an approval — those belong to the predicates that
 * already own them. A client-cached boolean is trivially editable by anyone with the
 * device, which is fine for revealing a menu row and catastrophic for anything else.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

const KEY = 'is_developer';

/** The cached answer. False when never asked — the safe direction: a hidden tool stays
 *  hidden until the server says otherwise. */
export async function cachedDeveloper(db: AbstractPowerSyncDatabase): Promise<boolean> {
  try {
    const r = (await db.getAll<{ v: string }>(
      `SELECT v FROM device_settings WHERE k = ?`, [KEY]))[0];
    return r?.v === 'yes';
  } catch {
    return false;
  }
}

/**
 * Ask the server and remember the answer. Returns what to use NOW.
 *
 * A failed read keeps the cached value rather than downgrading to false: losing signal
 * must not take the tools away mid-session. Only an actual answer changes the flag, in
 * either direction.
 */
export async function refreshDeveloper(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('developer_user').select('user_id').limit(1).maybeSingle();
    // RLS returns the caller's own row or nothing at all, so "a row came back" IS the
    // answer — there is no id to compare and nothing to spoof by asking differently.
    if (error) {
      // A missing table (417 not applied) reads as an error, not as "no". Same
      // treatment as offline: keep whatever we knew.
      return cachedDeveloper(db);
    }
    const on = !!data;
    await db.execute(
      `INSERT INTO device_settings (k, v) VALUES (?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      [KEY, on ? 'yes' : 'no']).catch(() => {});
    return on;
  } catch {
    return cachedDeveloper(db);
  }
}
