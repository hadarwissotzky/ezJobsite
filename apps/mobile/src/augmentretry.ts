/**
 * THE ADDENDUM THAT ARRIVED AFTER THE SCREEN CLOSED.
 *
 * Codex, 2026-08-23, P1: `finishAugmentById` reads the cloud proposal ONCE, falls back
 * to the local transcript cache ONCE, and if both are still empty it appends nothing —
 * and nothing ever tries again. The upload and the server pipeline carry on regardless,
 * so a contractor could be told his edit was processed and land on a record missing the
 * very words he added. I told hadar "the description still grows"; for an augment that
 * was simply false, and this module is what makes it true.
 *
 * ─── WHY IT ONLY MATTERS NOW ────────────────────────────────────────────────────
 * Before the silence work, an augment carrying a voice waited for `analyzedSeen` — the
 * server's structured row — so by the time the finalizer ran the proposal existed by
 * construction. The silence shortcut releases that gate on the DEVICE's verdict, and
 * on-device recognition is weaker than the cloud's. When the two disagree the server
 * still produces a proposal, minutes later, with nobody listening for it.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────
 * It does not re-open the processing screen, re-notify, or re-price. It grows the
 * append-only addendum `finishAugmentById` would have written, using the same rules —
 * high-confidence AI value, otherwise the contractor's own transcribed words — and then
 * forgets the job. `appendAugmentDesc` is append-only, so a duplicate append would be
 * visible and permanent; the marker is deleted before nothing and after success, and the
 * `text` check below means an empty answer is left pending rather than appended blank.
 *
 * ─── THE WINDOW IS BOUNDED AND IT EXPIRES SILENTLY ──────────────────────────────
 * A row nobody can ever satisfy — the recording really was silent — must not be retried
 * forever on every sync tick. After `RETRY_WINDOW_MS` the marker is dropped. That is not
 * a loss: the evidence is committed and uploaded either way, and the silence notice has
 * already told the contractor nothing was heard.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 7 days.
 *
 * It was 24h, which was wrong for the case that turns out to matter most: an edit whose
 * captures are HELD because the parent extra has no jobsite yet uploads nothing until a
 * human files that extra, and "I'll sort the paperwork at the weekend" is a normal thing
 * for a contractor to do. A day would have expired the marker before the words could
 * possibly arrive. Long enough to cover that; short enough that a genuinely silent clip
 * stops costing a query inside a week. The sweep reads at most 20 rows a tick.
 */
export const RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const AUGMENT_PENDING_DDL = `
  CREATE TABLE IF NOT EXISTS augment_pending (
     change_order_id TEXT NOT NULL PRIMARY KEY,
     /* JSON array of the capture ids this edit added. The proposal lookup needs the
        exact set; re-deriving it later would pick up captures from a LATER edit and
        append their words to this one's addendum. */
     capture_ids     TEXT NOT NULL,
     first_at_ms     INTEGER NOT NULL,
     attempts        INTEGER NOT NULL DEFAULT 0
  ) STRICT`;

export async function ensureAugmentRetrySchema(db: AbstractPowerSyncDatabase): Promise<void> {
  await db.execute(AUGMENT_PENDING_DDL);
}

/** Remember that this edit still owes an addendum. Idempotent: a second edit of the
 *  same extra replaces the id set rather than queueing twice, because the newer set is
 *  the one whose words are missing. */
export async function markAugmentPending(
  db: AbstractPowerSyncDatabase, changeOrderId: string, captureIds: readonly string[]
): Promise<void> {
  if (!captureIds.length) return;
  await db.execute(
    `INSERT OR REPLACE INTO augment_pending
       (change_order_id, capture_ids, first_at_ms, attempts) VALUES (?,?,?,0)`,
    [changeOrderId, JSON.stringify([...captureIds]), Date.now()]);
}

export async function clearAugmentPending(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<void> {
  await db.execute(`DELETE FROM augment_pending WHERE change_order_id = ?`, [changeOrderId]);
}

export type PendingAugment = {
  changeOrderId: string;
  captureIds: string[];
  firstAtMs: number;
};

export async function pendingAugments(
  db: AbstractPowerSyncDatabase, nowMs: number
): Promise<PendingAugment[]> {
  const rows = await db.getAll<{ change_order_id: string; capture_ids: string; first_at_ms: number }>(
    `SELECT change_order_id, capture_ids, first_at_ms FROM augment_pending
      ORDER BY first_at_ms LIMIT 20`);
  const out: PendingAugment[] = [];
  for (const r of rows) {
    if (nowMs - r.first_at_ms > RETRY_WINDOW_MS) {
      await db.execute(`DELETE FROM augment_pending WHERE change_order_id = ?`, [r.change_order_id]);
      continue;
    }
    let ids: unknown;
    try { ids = JSON.parse(r.capture_ids); } catch { ids = null; }
    // A row we cannot read is dropped rather than retried forever on a parse error.
    if (!Array.isArray(ids) || !ids.length) {
      await db.execute(`DELETE FROM augment_pending WHERE change_order_id = ?`, [r.change_order_id]);
      continue;
    }
    out.push({
      changeOrderId: r.change_order_id,
      captureIds: ids.filter((x): x is string => typeof x === 'string'),
      firstAtMs: r.first_at_ms,
    });
  }
  return out;
}

/**
 * The addendum text this edit owes, or '' when the answer is still not available.
 *
 * DELIBERATELY THE SAME RULE as `finishAugmentById`, and it is duplicated rather than
 * shared because that function lives inside the App component and closes over `db`,
 * `connector` and `refresh`. Extracting it is the right follow-up; copying the RULE
 * while the copy is two branches long is the smaller risk than reshaping the finalizer
 * in the same change that fixes it.
 *
 * MANDATE #2: the AI's words only at HIGH confidence. Anything less falls back to what
 * the contractor actually said, which is his own words and available offline.
 */
export function addendumTextFrom(
  prop: { confidence?: string; value?: string | null; subject?: string | null } | null,
  saidTexts: readonly (string | null | undefined)[]
): string {
  if (prop && prop.confidence === 'high' && (prop.value || prop.subject)) {
    return (prop.value || prop.subject || '').trim();
  }
  return saidTexts.map((t) => (t ?? '').trim()).filter(Boolean).join('\n\n');
}

/**
 * One sweep. Returns how many addenda were finally written.
 *
 * `fetchProposal` and `append` are injected so this is testable without Supabase or the
 * App component — the pattern `approverhydrate.ts` set for exactly this reason.
 */
export async function retryPendingAugments(
  db: AbstractPowerSyncDatabase,
  deps: {
    nowMs: number;
    fetchProposal: (captureIds: string[]) =>
      Promise<{ confidence?: string; value?: string | null; subject?: string | null } | null>;
    append: (changeOrderId: string, text: string) => Promise<void>;
  }
): Promise<{ appended: number; stillPending: number }> {
  let appended = 0, stillPending = 0;
  for (const p of await pendingAugments(db, deps.nowMs)) {
    try {
      const prop = await deps.fetchProposal(p.captureIds).catch(() => null);
      const marks = p.captureIds.map(() => '?').join(',');
      const said = await db.getAll<{ text: string }>(
        `SELECT text FROM voice_transcript_cache WHERE capture_id IN (${marks})`, p.captureIds);
      const text = addendumTextFrom(prop, said.map((r) => r.text));
      if (!text) { stillPending++; continue; }
      await deps.append(p.changeOrderId, text);
      await clearAugmentPending(db, p.changeOrderId);
      appended++;
    } catch {
      // Left pending. The window above is what stops this being forever.
      stillPending++;
    }
  }
  return { appended, stillPending };
}

/** Unused-but-honest: how many edits are still waiting. For a future drawer line. */
export async function pendingAugmentCount(db: AbstractPowerSyncDatabase): Promise<number> {
  const r = (await db.getAll<{ n: number }>(
    `SELECT count(*) AS n FROM augment_pending`))[0];
  return r?.n ?? 0;
}
