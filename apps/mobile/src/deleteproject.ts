/**
 * DELETE A JOBSITE THAT HOLDS NOTHING.
 *
 * hadar, 2026-08-31: "Need to add the ability to delete a job if it is empty."
 *
 * THE SERVER DECIDES WHAT EMPTY MEANS, and this file does not second-guess it.
 * Fourteen tables carry a `project_id` and only three have a foreign key back, so a
 * client-side count would silently orphan rows in eleven of them — some holding a
 * signed approval or a capture. `delete_empty_project_v1` enumerates every one and
 * re-checks inside the DELETE itself. All this does is call it and report.
 *
 * IT IS NOT ARCHIVE. Archive (REQ-PM4) keeps a job with history and hides it, and is
 * the right answer for anything that happened. This is for the mistyped address and
 * the duplicate — a job with nothing in it has no history to protect, and making
 * somebody archive their typos fills the archive with things that never occurred.
 *
 * ONLINE ONLY, and that is stated rather than queued. Everything else in this app is
 * local-first, so the exception needs a reason: a delete cannot be replayed safely
 * from an outbox. Two devices, one offline, and the queued delete arrives after a
 * capture has been filed to that jobsite — destroying evidence that did not exist
 * when the intent was formed. Mandate #1 outranks the convenience.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

/**
 * How many captures this device knows are on a jobsite.
 *
 * Read from `capture_commit` — the LOCAL commitment ledger, not the server — so the
 * number can be shown with no signal, which is the state a contractor is usually in
 * when he notices he made the jobsite wrong. It is the count the confirmation names,
 * and naming a real number is the whole difference between a chosen deletion and a
 * silent one.
 *
 * It can under-report: a capture filed from another device that has not reached this
 * one is not counted. The server is the authority and reports what it actually
 * destroyed, which is why the acknowledgement uses ITS number rather than this one.
 */
export async function localCaptureCount(
  db: AbstractPowerSyncDatabase, projectId: string,
): Promise<number> {
  try {
    return (await db.getAll<{ n: number }>(
      `SELECT COUNT(*) AS n FROM capture_commit WHERE project_id = ?`, [projectId]))[0]?.n ?? 0;
  } catch { return 0; }
}

export type DeleteWithMediaResult =
  | { ok: true; already?: boolean; captures: number }
  /** A priced commitment stopped it. These are never deletable, by any route. */
  | { ok: false; reason: 'has_commitment'; holds: string }
  | { ok: false; reason: 'not_owner' | 'not_signed_in' | 'offline' | 'failed'; detail?: string };

/**
 * Delete a jobsite AND its captures.
 *
 * SEPARATE FROM `deleteEmptyProject`, deliberately, rather than a flag on it. One of
 * these destroys nothing and the other destroys photographs; a boolean argument would
 * put both behind one call site and make the destructive path reachable by passing the
 * wrong value. Two names cannot be confused at a glance.
 */
export async function deleteProjectWithMedia(
  db: AbstractPowerSyncDatabase,
  supabase: SupabaseClient,
  projectId: string,
): Promise<DeleteWithMediaResult> {
  try {
    const { data, error } = await supabase.rpc('delete_project_with_media_v1', {
      p_project_id: projectId,
    });
    if (error) {
      const msg = String(error.message ?? '');
      if (/network|fetch|timeout|offline/i.test(msg)) return { ok: false, reason: 'offline' };
      return { ok: false, reason: 'failed', detail: msg.slice(0, 160) };
    }
    const r = data as any;
    if (r?.ok) {
      // Local rows too, and the same reasoning as the empty-delete path: waiting for a
      // checkpoint means the contractor is told it worked and watches it sit there.
      try { await db.execute(`DELETE FROM project WHERE id = ?`, [projectId]); } catch { /* sync will */ }
      try { await db.execute(`DELETE FROM capture_commit WHERE project_id = ?`, [projectId]); } catch { /* best effort */ }
      return { ok: true, already: r.already === true, captures: Number(r.captures ?? 0) };
    }
    if (r?.reason === 'has_commitment') {
      return { ok: false, reason: 'has_commitment', holds: String(r.holds ?? 'something') };
    }
    return { ok: false, reason: r?.reason === 'not_owner' ? 'not_owner' : 'not_signed_in' };
  } catch (e: any) {
    return { ok: false, reason: 'failed', detail: String(e?.message ?? e).slice(0, 160) };
  }
}

export type DeleteProjectResult =
  | { ok: true; already?: boolean }
  /** `holds` names the table that stopped it, so the message can be specific. */
  | { ok: false; reason: 'not_empty'; holds: string }
  | { ok: false; reason: 'not_owner' | 'not_signed_in' | 'offline' | 'failed'; detail?: string };

export async function deleteEmptyProject(
  db: AbstractPowerSyncDatabase,
  supabase: SupabaseClient,
  projectId: string,
): Promise<DeleteProjectResult> {
  try {
    const { data, error } = await supabase.rpc('delete_empty_project_v1', {
      p_project_id: projectId,
    });
    if (error) {
      // A network failure is not a refusal, and must not read as one: the jobsite is
      // still there and trying again later is the right advice.
      const msg = String(error.message ?? '');
      if (/network|fetch|timeout|offline/i.test(msg)) return { ok: false, reason: 'offline' };
      return { ok: false, reason: 'failed', detail: msg.slice(0, 160) };
    }
    const r = data as any;
    if (r?.ok) {
      /**
       * REMOVE THE LOCAL ROW TOO, and do not wait for sync to do it.
       *
       * `project` is a PowerSync table, so the row would eventually disappear when
       * the next checkpoint arrives — but "eventually" here means a contractor taps
       * Delete, is told it worked, and watches the jobsite sit on the list. Deleting
       * locally makes the screen agree with the server immediately; PowerSync's own
       * reconcile then agrees with both.
       */
      try { await db.execute(`DELETE FROM project WHERE id = ?`, [projectId]); } catch { /* sync will */ }
      return { ok: true, already: r.already === true };
    }
    if (r?.reason === 'not_empty') {
      return { ok: false, reason: 'not_empty', holds: String(r.holds ?? 'something') };
    }
    return { ok: false, reason: r?.reason === 'not_owner' ? 'not_owner' : 'not_signed_in' };
  } catch (e: any) {
    return { ok: false, reason: 'failed', detail: String(e?.message ?? e).slice(0, 160) };
  }
}

/**
 * WHAT is holding the jobsite, in words, or null when the refusal was not about content.
 *
 * `holds` has carried the blocking table name since this was written, with a comment
 * promising "so the message can be specific" — and nothing ever read it. The refusal
 * said only "this job already has work saved in it", which hadar read, reasonably, as
 * "it thinks they have CO in them that is not the case" (2026-09-01). He was right that
 * they have no change orders. They hold PHOTOS, and the message never said so, so the
 * app looked wrong when it was being careful.
 *
 * Grouped rather than one phrase per table: `capture`, `attachment`, `capture_op_state`
 * and `capture_pair` are four tables describing one thing a person recognises, and
 * naming the table would answer a question nobody asked.
 */
const HOLDS_PHRASE: Record<string, string> = {
  change_order: 'job.holdsCo',
  capture: 'job.holdsMedia', attachment: 'job.holdsMedia',
  capture_op_state: 'job.holdsMedia', capture_pair: 'job.holdsMedia',
  decision: 'job.holdsDecision',
  approval: 'job.holdsApproval', confirmation_request: 'job.holdsApproval',
  extra_work_authorization: 'job.holdsEwa',
  co_comment: 'job.holdsComment',
  scope_boundary: 'job.holdsScope',
  processing_job: 'job.holdsProcessing',
};

export function deleteHoldsKey(r: Extract<DeleteProjectResult, { ok: false }>): string | null {
  if (r.reason !== 'not_empty') return null;
  return HOLDS_PHRASE[r.holds] ?? null;
}

/** Which i18n key explains a refusal. Kept beside the result type so a new reason
 *  cannot be added without a sentence to show for it. */
export function deleteRefusalKey(r: Extract<DeleteProjectResult, { ok: false }>): string {
  switch (r.reason) {
    case 'not_empty': return 'job.delNotEmpty';
    case 'not_owner': return 'job.delNotOwner';
    case 'offline':   return 'job.delOffline';
    default:          return 'job.delFailed';
  }
}
