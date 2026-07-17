/**
 * Consent — REQ-CON1 (legal) and REQ-CON2 (cost).
 *
 * TWO DIFFERENT CONSENTS THAT ARE ALWAYS CONFLATED, and must not be:
 *   CON1 = may we RECORD a person's voice?      -> a legal question
 *   CON2 = may we SPEND the user's cellular data? -> a money question
 * They have different owners, different defaults and different failure modes. One
 * "allow?" switch covering both is how a contractor ends up either committing a
 * crime or paying for a 400 MB video upload on a hotspot.
 *
 * ============ REQ-CON1 ============
 * "A jurisdiction-aware recording-consent state is recorded ONCE, at project
 *  creation/setup. THE CAPTURE PATH ITSELF NEVER SHOWS A CONSENT PROMPT -- the
 *  first tap on the record button records, always."
 *
 * That second sentence is the whole design and it is not negotiable: research
 * named the capture-time consent interstitial as THE #1 PREDICTED ABANDONMENT
 * POINT. A dialog between a man's thumb and the thing he is trying to record is
 * how this product dies. So consent is a PROPERTY OF THE PROJECT, decided once by
 * whoever set the job up, and the record button never asks.
 *
 * The gate is therefore at ARMING, not at prompting: if a project has no consent
 * state, voice/video is simply not available on that job and says why. Refusing
 * loudly is mandate #1's rule and it applies here too -- what we must never do is
 * record first and ask later, because by then the recording exists.
 *
 * WHY "STRICTEST WHEN UNKNOWN": a wrong guess here is not a bug, it is a
 * potential crime. Eleven US states require ALL parties to consent to recording a
 * conversation. Offline, with no way to resolve jurisdiction, the only safe
 * default is to assume the strictest rule applies. Being conservative costs a
 * contractor one setup tap; being permissive costs him a criminal charge.
 *
 * WE ARE NOT LAWYERS AND THIS IS NOT LEGAL ADVICE. This encodes a conservative
 * default and RECORDS WHAT THE USER CHOSE. It does not certify that any recording
 * is lawful -- that is stated in the UI rather than implied by our silence.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';

/** What was decided about recording people on this job. */
export type RecordingConsent =
  | 'all_party'    // everyone recorded has agreed. Strictest, always lawful-ish.
  | 'one_party'    // the user is party to the conversation and their state allows it
  | 'no_recording' // this job does not permit audio. Text/photo still work.
  | null;          // NOT SET -> voice/video unavailable. Never "probably fine".

export const CONSENT_DDL = [
  // CON2 only. It is a DEVICE setting, not a project one: it is about THIS phone's
  // data plan. The same job on the office iPad has no cellular question at all, so
  // syncing it would push one phone's billing choice onto another.
  `CREATE TABLE IF NOT EXISTS device_settings (
      k TEXT NOT NULL PRIMARY KEY,
      v TEXT NOT NULL
   ) STRICT`,
];

export async function ensureConsentSchema(db: AbstractPowerSyncDatabase) {
  for (const s of CONSENT_DDL) await db.execute(s);
}

/**
 * The strictest rule wins when we do not know where we are.
 *
 * This is a DEFAULT, not a determination -- it pre-selects the safe answer in the
 * setup UI so the common case is one tap. A person still chooses, and what they
 * chose is what gets recorded.
 */
const ALL_PARTY_STATES = new Set([
  'CA', 'DE', 'FL', 'IL', 'MD', 'MA', 'MI', 'MT', 'NV', 'NH', 'PA', 'WA',
]);

export function defaultConsentFor(jurisdiction: string | null): RecordingConsent {
  if (!jurisdiction) return 'all_party';           // unknown -> strictest
  const st = jurisdiction.trim().toUpperCase();
  return ALL_PARTY_STATES.has(st) ? 'all_party' : 'one_party';
}

export function consentBasisText(c: RecordingConsent, jurisdiction: string | null): string {
  switch (c) {
    case 'all_party':
      return `Everyone on this job has been told recordings may be made and has agreed.`
        + (jurisdiction ? ` (${jurisdiction} requires everyone to agree.)` : ` (Strictest rule assumed — location not set.)`);
    case 'one_party':
      return `You are part of the conversations you record, and ${jurisdiction ?? 'your state'} allows that.`;
    case 'no_recording':
      return `No audio or video recording on this job. Photos and typed notes still work.`;
    default:
      return '';
  }
}

export async function setRecordingConsent(
  db: AbstractPowerSyncDatabase,
  o: { projectId: string; consent: Exclude<RecordingConsent, null>; jurisdiction: string | null; decidedBy: string }
) {
  // On the project row -> PowerSync carries it to every device on this job. A
  // recording decision that only one phone knows is worth very little: the whole
  // point is that the crew cannot record where the owner said no.
  await db.execute(
    `UPDATE project SET recording_consent = ?, consent_basis = ?,
       consent_jurisdiction = ?, consent_decided_at_ms = ?, consent_decided_by = ?
     WHERE id = ?`,
    [o.consent, consentBasisText(o.consent, o.jurisdiction), o.jurisdiction,
     Date.now(), o.decidedBy, o.projectId]
  );
}

export async function getRecordingConsent(
  db: AbstractPowerSyncDatabase, projectId: string
): Promise<{ consent: RecordingConsent; basis: string | null; jurisdiction: string | null }> {
  const r = (await db.getAll<{ recording_consent: RecordingConsent; consent_basis: string | null;
                               consent_jurisdiction: string | null }>(
    `SELECT recording_consent, consent_basis, consent_jurisdiction
       FROM project WHERE id = ?`, [projectId]))[0];
  return {
    consent: r?.recording_consent ?? null,
    basis: r?.consent_basis ?? null,
    jurisdiction: r?.consent_jurisdiction ?? null,
  };
}

export type ArmCheck = { allowed: true } | { allowed: false; why: string };

/**
 * May this job record audio/video RIGHT NOW?
 *
 * Called before ARMING, never as a prompt. The answer is already known -- it was
 * decided at setup -- so this is a lookup, not a question. The record button is
 * either live or it is visibly unavailable with a reason; there is no third state
 * where it asks.
 */
export async function canRecordAudio(
  db: AbstractPowerSyncDatabase, projectId: string
): Promise<ArmCheck> {
  const { consent } = await getRecordingConsent(db, projectId);
  if (consent === 'all_party' || consent === 'one_party') return { allowed: true };
  if (consent === 'no_recording') {
    return { allowed: false, why: 'This job is set to no recording. Type it or take a photo instead.' };
  }
  // null. Never "probably fine": a wrong guess here is a potential crime, not a bug.
  return { allowed: false, why: 'Recording isn’t set up for this job yet. Set it in job setup — it takes one tap.' };
}

// ============ REQ-CON2: cellular upload ============
//
// "Uploading over cell requires an explicit cellular-consent setting."
//
// This protects MONEY, and it defaults OFF for the same reason CON1 defaults
// strict: the failure is silent and lands on someone else. A 200 MB walkthrough
// video pushed over a hotspot is a bill the contractor never agreed to, and he
// finds out at the end of the month. Wi-Fi-only by default; he can turn it on.
//
// Capture is NEVER affected by this. Mandate #7: the network is opportunistic,
// never a precondition. This gates the UPLOAD only -- the capture is already
// durable on the device before this is consulted.

const CELL_KEY = 'cellular_upload_consent';

export async function getCellularConsent(db: AbstractPowerSyncDatabase): Promise<boolean> {
  const r = (await db.getAll<{ v: string }>(
    `SELECT v FROM device_settings WHERE k = ?`, [CELL_KEY]))[0];
  return r?.v === 'on';           // absent = off. Never opt-out by default.
}

export async function setCellularConsent(db: AbstractPowerSyncDatabase, on: boolean) {
  await db.execute(
    `INSERT INTO device_settings (k, v) VALUES (?,?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
    [CELL_KEY, on ? 'on' : 'off']
  );
}

export type UploadGate =
  | { upload: true }
  | { upload: false; reason: string; blockedBy: 'no_connection' | 'needs_cell_consent' };

/**
 * REQ-PROC6: "when it's stuck it tells the user why in plain language".
 * The reason is returned, not swallowed, so the UI can say "needs cell data — turn
 * on cellular upload" instead of leaving a queue that mysteriously never drains.
 */
export function uploadGate(
  net: { isConnected: boolean; isCellular: boolean }, cellConsent: boolean
): UploadGate {
  if (!net.isConnected) {
    return { upload: false, blockedBy: 'no_connection',
             reason: 'Saved ✓ — will upload when you have a connection' };
  }
  if (net.isCellular && !cellConsent) {
    return { upload: false, blockedBy: 'needs_cell_consent',
             reason: 'Saved ✓ — waiting for Wi-Fi (turn on cellular upload to send now)' };
  }
  return { upload: true };
}
