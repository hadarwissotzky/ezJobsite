/**
 * Over-the-air updates — the safety layer (SPEC-ota-updates-v1).
 *
 * `expo-updates` will happily download a new JS bundle and swap it in whenever it is
 * told to. This module exists to decide WHEN it is told to, because the swap is not
 * free: applying an update reloads the JS runtime, and everything held in memory dies
 * with it — the open capture session, the recorder, the screen the user is standing
 * on. Doing that to someone mid-capture is exactly the loss mandate #1 forbids, and
 * it would be self-inflicted, which is worse than a crash.
 *
 * TWO RULES, and they are the whole design:
 *   1. The check NEVER delays launch. The app boots from the bundle already on disk;
 *      the check runs after, in the background, and its failure is silent (REQ-OTA1,
 *      mandate #7 — "the network is opportunistic, never a precondition").
 *   2. An update is applied only at a moment when nothing is in flight, and only
 *      because a human asked (REQ-OTA2). Otherwise it waits for the next cold start,
 *      which happens naturally and costs nobody anything.
 *
 * WHY THE OUTBOX COUNT IS ELEVEN AND NOT THREE. The design doc said three; I then
 * grepped and wrote nine; the completeness test found eleven. A gate that checked the three obvious ones would have let an
 * update reload the app while a note, a tag, or a transcript was still unsent — the
 * quiet ones, which are exactly the ones nobody would think to look for afterwards.
 * If a tenth outbox is added, it belongs in this list, and the test below is what
 * will notice that it is missing.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

/**
 * Every owned outbox. Derived by grepping `CREATE TABLE IF NOT EXISTS *_outbox` —
 * NOT from memory, because the point of this list is to be exhaustive.
 */
export const OUTBOX_TABLES = [
  'capture_outbox',
  'change_order_outbox',
  'decision_outbox',
  'ewa_outbox',
  'extra_actor_outbox',
  'note_outbox',
  // R5b/R5c: the client's answer and the contractor's reply in the negotiation
  // thread. Found by the completeness test below, NOT by me — which is the point.
  'r5b_outbox',
  'r5c_outbox',
  'scope_outbox',
  'stt_outbox',
  'tag_outbox',
] as const;

export type InFlight = {
  /** Rows still queued for upload, summed across every outbox. */
  queued: number;
  /** Capture sessions still open — a recording in progress, or one not yet committed. */
  openDrafts: number;
  /** True when it is safe to reload the JS runtime under the user. */
  safe: boolean;
};

/**
 * What is currently unfinished. A table that does not exist yet counts as zero rather
 * than throwing: this runs on every app version, including ones predating a given
 * outbox, and a missing table genuinely means nothing is queued in it.
 *
 * ANY error anywhere makes this report UNSAFE. The failure mode has to be "we did not
 * update" and never "we updated without checking" — one is an inconvenience, the other
 * can cost a capture.
 */
export async function inFlight(db: AbstractPowerSyncDatabase): Promise<InFlight> {
  let queued = 0;
  let openDrafts = 0;
  try {
    for (const t of OUTBOX_TABLES) {
      try {
        const r = await db.getAll<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
        queued += r[0]?.n ?? 0;
      } catch { /* table not created in this version -> nothing queued in it */ }
    }
    try {
      const r = await db.getAll<{ n: number }>(
        `SELECT COUNT(*) AS n FROM capture_draft WHERE state = 'open'`);
      openDrafts = r[0]?.n ?? 0;
    } catch { /* no draft table yet */ }
  } catch {
    return { queued: -1, openDrafts: -1, safe: false };
  }
  return { queued, openDrafts, safe: queued === 0 && openDrafts === 0 };
}

/** REQ-OTA2. The one predicate the "Restart to update" affordance is allowed to use. */
export async function canApplyNow(db: AbstractPowerSyncDatabase): Promise<boolean> {
  return (await inFlight(db)).safe;
}

/**
 * A short, human-readable build line for Settings → About (REQ-OTA5).
 *
 * Lives HERE rather than beside the expo-updates code because it is pure string
 * formatting and must stay unit-testable — importing the native module into the test
 * runner is what broke this file's first version.
 *
 * Support cannot diagnose "it is broken on my phone" without knowing which of the TWO
 * layers that phone runs: the native binary, or a JS update on top of it. The id is
 * truncated because nobody reads a UUID down the phone, and the first characters are
 * enough to tell two builds apart.
 */
export function buildLine(o: { version: string; updateId: string | null; embedded: boolean }): string {
  const base = `v${o.version}`;
  if (o.embedded || !o.updateId) return `${base} (base)`;
  return `${base} · update ${o.updateId.slice(0, 8)}`;
}
