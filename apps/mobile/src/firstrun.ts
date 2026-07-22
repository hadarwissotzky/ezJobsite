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
 *  1. ONE SETUP SCREEN: THE PROFILE (revised 2026-07-20, hadar). Language is no
 *     longer a screen of its own — it is a bilingual EN|Español toggle at the top
 *     of the profile form, so it still needs no reading to pick, but it no longer
 *     stands between the user and knowing what the app is. The form collects the
 *     minimum that personalises a proposal: language, name, solo/company (+ name),
 *     and an optional trade.
 *
 *  2. NO JOB STEP. You do not start by filing a job — you start by creating an
 *     EXTRA (the goal is to send one to the customer fast). A job still exists and
 *     an extra still needs one, but it is created/assigned DURING the extra flow
 *     (capture → assign sheet / "new job right here"), never demanded up front.
 *     Recording consent still belongs to a project (REQ-CON1); it is deferred to
 *     the first record tap, by which point the capture has a job to attach to.
 *
 *  3. CONSENT IS NOT ASKED HERE (changed 2026-07-17, hadar). Same reasoning as #4
 *     below: a recording-consent form shown before the user has ever tried to
 *     record is a legal question asked at the moment it makes the LEAST sense, and
 *     it blocked onboarding on a form the user did not come to fill. Consent is
 *     DEFERRED to the first time the record button is actually tapped -- gated by
 *     canRecordAudio, and surfaced by a dismissible banner until then. Photos and
 *     typed notes, which need no consent, work immediately. It is NOT auto-approved:
 *     mandate #2 forbids silently deciding it is lawful to record a person, so
 *     deferral gives a form-free start WITHOUT crossing that line.
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

export type Step = 'profile' | 'done';

/**
 * Where the user is. Derived from what actually exists, NOT from a stored step
 * counter: a counter and reality drift apart the moment someone kills the app
 * mid-setup, and then a user with a profile gets asked to set it up again. The
 * state IS the answer. Consent is deliberately NOT a step here -- it is deferred
 * to the first record tap (see the header comment, point 3).
 *
 * REVISED 2026-07-20 (hadar): setup is now ONE step -- the profile. Two things
 * moved out of it:
 *   - LANGUAGE is no longer its own screen. It folds INTO the profile form (a
 *     bilingual EN|Español toggle at the top, so it still needs no reading to
 *     pick). Choosing a language should not be a gate a user hits before they
 *     even know what the app is.
 *   - THE JOB is gone from onboarding entirely. You do not start by filing a job;
 *     you start by creating an EXTRA. The job still exists and an extra still
 *     needs one -- but it is created/assigned DURING the extra flow (capture ->
 *     assign sheet), not demanded up front. Goal: send an extra to the customer
 *     as fast as possible. Value-first slides + sign-in happen BEFORE this.
 */
export function nextStep(o: { hasProfile: boolean }): Step {
  return o.hasProfile ? 'done' : 'profile';
}

/** How many taps first-run costs, so the claim can be checked rather than asserted. */
export const FIRST_RUN_TAPS = {
  profile: 4,    // language toggle + name (type) + solo/company + trade (or skip)
  total: 4,      // consent is deferred to first record; no job step (2026-07-20)
  /**
   * REQ-X1 budgets the CAPTURE path at <=2 touches and the SEND path at <=3.
   * First-run is not in either budget -- it happens once, before any capture --
   * but it is the thing standing between a new user and their first one, so it is
   * counted here rather than left as a feeling.
   */
  thenFirstCaptureIs: 2,
};
