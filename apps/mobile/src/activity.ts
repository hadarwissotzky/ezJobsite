/**
 * R8 — the in-app notification centre. PURE: no imports, no database, no clock.
 *
 * WHAT THIS IS AND IS NOT. R8 has three parts and they are not equally blocked:
 *   push notifications        -> needs expo-notifications + a device token + a
 *                                server sender. Not built.
 *   auto-reminders at 24h     -> needs a scheduler and an SMS provider (A2P). Not built.
 *   the in-app activity list  -> needs nothing but the rows already on the device.
 * This is the third one. It is what the contractor sees when the app is OPEN, and
 * R8 describes it as "the same activity" the push carries when it is closed. The
 * push half being blocked is exactly why this half matters: without it there is no
 * path at all from "a client asked something" to the contractor noticing.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE (R8's third AC): marking a row read must
 * never alter an item's status, its timeline, or its approval state. Unread is a
 * per-device reading convenience. The item's own state is evidence, and evidence
 * does not change because somebody glanced at a list. So `read` lives in a separate
 * local set keyed by event id, and nothing in this file returns anything an item
 * could be updated from.
 *
 * Ordering is newest-first, and questions outrank everything at equal time: an
 * unanswered question is the only row that represents work the CONTRACTOR owes.
 */

export type ActivityKind =
  /** The client asked something and is waiting. The only row that owes work. */
  | 'question'
  | 'approved'
  | 'declined'
  /** A link went out. Informational -- he did it himself. */
  | 'sent';

export type ActivityRow = {
  /** Stable across rebuilds: read-state is keyed on it, so it must not drift. */
  id: string;
  kind: ActivityKind;
  changeOrderId: string;
  /** What the row names: the item, then its job. */
  scope: string;
  jobName: string;
  /** Free text the row shows under the title (the question, the signer's name). */
  detail: string | null;
  atMs: number;
  read: boolean;
};

export type ActivitySource = {
  changeOrderId: string;
  scope: string;
  jobName: string;
  status: string;
  signedBy: string | null;
  createdAtMs: number;
  /** Client questions on this item, oldest first. */
  questions: { id: string; body: string; atMs: number }[];
};

/** Questions first at equal time; otherwise newest first. */
const KIND_RANK: Record<ActivityKind, number> = {
  question: 0, declined: 1, approved: 2, sent: 3,
};

/**
 * Build the list. Deterministic in its inputs -- no Date.now(), no db -- so the
 * ordering rules can actually be tested rather than eyeballed on a phone.
 */
export function buildActivity(
  sources: ActivitySource[],
  readIds: ReadonlySet<string>
): ActivityRow[] {
  const rows: ActivityRow[] = [];

  for (const s of sources) {
    for (const q of s.questions) {
      rows.push({
        id: `q:${q.id}`, kind: 'question', changeOrderId: s.changeOrderId,
        scope: s.scope, jobName: s.jobName, detail: q.body, atMs: q.atMs,
        read: readIds.has(`q:${q.id}`),
      });
    }
    // Terminal answers. Derived from the item's own status rather than stored as
    // events, because the status IS the record and a second copy could disagree
    // with it. The trade is that we have no timestamp for the answer -- the local
    // row carries none -- so it sorts by creation, which is honest about being
    // approximate rather than inventing a moment.
    if (s.status === 'approved' || s.status === 'declined') {
      rows.push({
        id: `${s.status}:${s.changeOrderId}`,
        kind: s.status as ActivityKind,
        changeOrderId: s.changeOrderId, scope: s.scope, jobName: s.jobName,
        detail: s.signedBy, atMs: s.createdAtMs,
        read: readIds.has(`${s.status}:${s.changeOrderId}`),
      });
    }
  }

  return rows.sort((a, b) =>
    b.atMs - a.atMs || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id.localeCompare(b.id));
}

/**
 * The bell's number.
 *
 * It counts UNREAD QUESTIONS ONLY, not every unread row. A badge that also counts
 * approvals would sit at 12 on a healthy job and stop meaning anything -- and the
 * one thing R8's AC asks the bell to surface is an unanswered client question. A
 * count nobody can clear is a count nobody reads.
 */
export function unreadCount(rows: ActivityRow[]): number {
  return rows.filter((r) => r.kind === 'question' && !r.read).length;
}

/** Rows whose read-state would change. Used so marking read writes once, not N times. */
export function unreadIds(rows: ActivityRow[]): string[] {
  return rows.filter((r) => !r.read).map((r) => r.id);
}
