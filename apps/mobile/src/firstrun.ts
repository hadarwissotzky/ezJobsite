/**
 * First run — REQ-SET2. "Shortest path to mic/camera/location/consent + set
 * target language ... a new user can reach first capture QUICKLY."
 *
 * WHO IS ON THIS SCREEN: someone for whom "phones and software are not second
 * nature" (CLAUDE.md's core design test), who was handed this app by their boss
 * and is standing on a job right now. They are not going to read anything. They
 * are going to tap the big thing.
 *
 * SO THE RULE IS: ASK FOR THE MINIMUM THAT MAKES THE FIRST CAPTURE WORK, AND ASK
 * FOR NOTHING ELSE.
 *
 * What that excludes, deliberately:
 *  - No account creation. Not needed to capture; capture is local-first.
 *  - No permission primer carousel. Three screens explaining why we want the
 *    microphone is three screens between a man and the thing he came to do.
 *  - No tour. No sample data. No "you're all set!" celebration screen.
 *
 * ORDER MATTERS, and it is not the order the requirement lists things in:
 *
 *  1. LANGUAGE FIRST. Everything after this is words. Asking someone to read
 *     English in order to choose Spanish is the joke every app makes. This is the
 *     ONE screen that must be readable before a choice is made, so it shows both
 *     languages simultaneously and needs no reading at all.
 *
 *  2. THE JOB. Because consent belongs to a project (REQ-CON1) — there is nothing
 *     to attach a recording decision to until a job exists. A name is enough.
 *
 *  3. CONSENT. One tap, strict default pre-selected (see consent.ts).
 *
 *  4. PERMISSIONS ARE NOT ASKED HERE AT ALL.
 *     This is the part most first-runs get wrong. iOS gives you ONE chance at each
 *     permission: deny it and the user must go to Settings, which they never will.
 *     Asking for the microphone on a setup screen — before they have ever tried to
 *     record — means asking at the moment the request makes the LEAST sense, and a
 *     denial there is permanent. So each permission is requested at the moment it
 *     explains itself: the mic when they hit record, the camera when they hit
 *     photo, location when they first reach for the camera. That is already how
 *     the app behaves; first-run's job is to NOT break it.
 *     REQ-SET2 says "shortest path to permissions". The shortest path is the one
 *     that does not burn them.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { getLang, type Lang } from './i18n';

const DONE_KEY = 'first_run_done';

export async function isFirstRun(db: AbstractPowerSyncDatabase): Promise<boolean> {
  try {
    const r = (await db.getAll<{ v: string }>(
      `SELECT v FROM device_settings WHERE k = ?`, [DONE_KEY]))[0];
    return r?.v !== 'yes';
  } catch {
    // device_settings not created yet -> definitionally a first run.
    return true;
  }
}

export async function markFirstRunDone(db: AbstractPowerSyncDatabase) {
  await db.execute(
    `INSERT INTO device_settings (k, v) VALUES (?, 'yes')
     ON CONFLICT(k) DO UPDATE SET v = 'yes'`, [DONE_KEY]
  );
}

const LANG_KEY = 'preferred_language';

/**
 * The display language, per the spec's Member.preferred_language. Stored on the
 * device: it is a property of the person holding THIS phone, and the office iPad
 * may well be read by someone else.
 */
export async function savedLang(db: AbstractPowerSyncDatabase): Promise<Lang | null> {
  try {
    const r = (await db.getAll<{ v: string }>(
      `SELECT v FROM device_settings WHERE k = ?`, [LANG_KEY]))[0];
    return r?.v === 'es' || r?.v === 'en' ? r.v : null;
  } catch { return null; }
}

export async function saveLang(db: AbstractPowerSyncDatabase, l: Lang) {
  await db.execute(
    `INSERT INTO device_settings (k, v) VALUES (?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`, [LANG_KEY, l]
  );
}

export type Step = 'lang' | 'job' | 'consent' | 'done';

/**
 * Where the user is. Derived from what actually exists, NOT from a stored step
 * counter: a counter and reality drift apart the moment someone kills the app
 * mid-setup, and then a user with a job and consent gets asked to make a job
 * again. The state IS the answer.
 */
export function nextStep(o: {
  langChosen: boolean; hasJob: boolean; hasConsent: boolean;
}): Step {
  if (!o.langChosen) return 'lang';
  if (!o.hasJob) return 'job';
  if (!o.hasConsent) return 'consent';
  return 'done';
}

/** How many taps first-run costs, so the claim can be checked rather than asserted. */
export const FIRST_RUN_TAPS = {
  lang: 1,       // tap your language
  job: 2,        // type a name (1 field) + CREATE
  consent: 1,    // tap the pre-selected answer
  total: 4,
  /**
   * REQ-X1 budgets the CAPTURE path at <=2 touches and the SEND path at <=3.
   * First-run is not in either budget -- it happens once, before any capture --
   * but it is the thing standing between a new user and their first one, so it is
   * counted here rather than left as a feeling.
   */
  thenFirstCaptureIs: 2,
};
