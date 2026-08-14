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
  /**
   * R3 AC4: an approved EWA whose priced Step 2 is overdue. It is the contractor's
   * OWN late promise, so it outranks everything except a client's question — the
   * client already signed and is waiting for a number he said he would send.
   */
  | 'unpriced'
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
  /**
   * R3 AC4. Set only for an approved EWA whose priced Step 2 is overdue. Absent for
   * everything else, so a normal extra never produces one of these rows.
   */
  unpricedSince?: number | null;
};

/** Questions first at equal time; otherwise newest first. */
const KIND_RANK: Record<ActivityKind, number> = {
  question: 0, unpriced: 1, declined: 2, approved: 3, sent: 4,
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
    // R3 AC4, surfaced HERE and not only on the job's ledger. The ledger banner is
    // where he fixes it; this is where he FINDS OUT, from any screen. A promise that
    // is only visible on the job you are already looking at is a promise you keep by
    // accident.
    if (s.unpricedSince != null) {
      rows.push({
        id: `unpriced:${s.changeOrderId}`, kind: 'unpriced',
        changeOrderId: s.changeOrderId, scope: s.scope, jobName: s.jobName,
        detail: null, atMs: s.unpricedSince,
        read: readIds.has(`unpriced:${s.changeOrderId}`),
      });
    }
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
 * The bell's number — and, since 2026-08-12, the APP ICON'S number too.
 *
 * WIDENED FROM "questions + overdue prices" TO "everything except your own sends"
 * (hadar: "if there are new notifications a red badge with the number of new
 * notifications … same when the application is closed").
 *
 * THE OLD RULE WAS DEFENSIBLE AND STILL BROKE, for a reason that only appears once the
 * icon badge exists. `runNotifications` presents a push for an APPROVAL as well as a
 * question. Under the old count, that push landed on the phone, the row appeared in the
 * notification list — and the bell said nothing. Three surfaces reporting the same event
 * and one of them silently disagreeing is worse than any of the three being wrong,
 * because the user cannot tell which to believe. A badge is a promise that the list
 * behind it has something new in it; it does not get to be selective about which new
 * things count.
 *
 * 'sent' IS STILL EXCLUDED, and that is the whole of the old rule worth keeping: he sent
 * it himself, seconds ago, from this phone. Badging a man for his own action is how a
 * counter becomes furniture — the "12 on a healthy job" failure the original comment
 * warned about, which came from self-caused rows, not from news. Note that nothing in
 * `buildActivity` emits a 'sent' row TODAY, so the clause is currently a no-op held for
 * the day one appears; activity.test.ts asserts it against a hand-built row rather than
 * pretending the builder can produce one.
 */
export function unreadCount(rows: ActivityRow[]): number {
  return rows.filter((r) => !r.read && r.kind !== 'sent').length;
}

/** Rows whose read-state would change. Used so marking read writes once, not N times. */
export function unreadIds(rows: ActivityRow[]): string[] {
  return rows.filter((r) => !r.read).map((r) => r.id);
}
