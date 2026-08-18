/**
 * THE MOMENT EVERYTHING ELSE IS FOR.
 *
 * hadar, 2026-08-18: "the most important event that everything is leading to is approved
 * … we should also celebrate it. When the app is opened after a CO was approved, a popup
 * should show up (like an SMS with an animation, the stars and fireworks) and with a link
 * to the CO that was approved. And description."
 *
 * Every other surface in this app is about work in flight — captured, priced, sent,
 * waiting. Approval is the only event that ENDS a chain: the client signed, the money is
 * committed, the extra is real. A push notification on the lock screen is how he finds out
 * when he is not looking. This is what he sees when he IS.
 *
 * ─── WHY A SECOND STAMP AND NOT `notify_sent` ───────────────────────────────────
 * `notify_sent` records that this handset PUSHED a green light. That push usually fires
 * while the app is backgrounded and the phone is in his pocket — so reusing it would mean
 * the celebration is consumed by a notification he may never have looked at, and the app
 * opens showing nothing. They are two different questions ("did we buzz" / "has he seen
 * the confetti") and they need two different answers.
 *
 * ─── ACROSS EVERY JOB, DELIBERATELY ─────────────────────────────────────────────
 * `pendingApprovals` in notifystore is scoped to the open project, because a push is
 * driven from the job tick. This is NOT: an approval on another job is still the best
 * news he will get today, and making him open that job first to find out defeats the
 * point. The row carries its own `projectId` so the tap can switch jobs before it opens
 * the record — the same thing the company feed already does.
 *
 * ─── THE WATERMARK IS NOT OPTIONAL ──────────────────────────────────────────────
 * Without it the first launch after this ships throws fireworks for every extra ever
 * approved, one after another. Stale confetti is worse than none: it teaches him the
 * popup means nothing. Same seed-on-creation trick as `ensureNotifySchema`, and for the
 * same reason.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

export const CELEBRATE_DDL = [
  `CREATE TABLE IF NOT EXISTS approval_celebrated (
      change_order_id TEXT NOT NULL PRIMARY KEY,
      at_ms           INTEGER NOT NULL
   ) STRICT`,
];

export async function ensureCelebrateSchema(db: AbstractPowerSyncDatabase) {
  const existed = await db.getAll<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='approval_celebrated'`
  );
  for (const s of CELEBRATE_DDL) await db.execute(s);
  // SEED THE WATERMARK on first creation — see the header. Only approvals that land
  // AFTER the feature exists are news.
  if (!existed.length) {
    await db.execute(
      `INSERT OR IGNORE INTO approval_celebrated (change_order_id, at_ms)
         SELECT id, ? FROM change_order WHERE status = 'approved'`,
      [Date.now()]
    );
  }
}

export type Celebration = {
  changeOrderId: string;
  projectId: string;
  /** The job's name, so the popup says WHICH jobsite. Null if the row has not synced. */
  projectName: string | null;
  /** The title. */
  scope: string;
  /** 391's client-facing body — what the client actually read and signed. */
  scopeOfWork: string | null;
  amountCents: number | null;
  signedBy: string | null;
  approvedAtMs: number | null;
};

/**
 * Everything approved that he has not been shown yet, OLDEST FIRST.
 *
 * Oldest first because they are shown one at a time and the queue is walked in order: if
 * three landed while he was off the app, the story reads forward. Newest-first would open
 * on the latest and bury the one that has been waiting longest.
 */
export async function pendingCelebrations(
  db: AbstractPowerSyncDatabase
): Promise<Celebration[]> {
  try {
    const rows = await db.getAll<{
      id: string; project_id: string; project_name: string | null;
      scope: string; scope_of_work: string | null; amount_cents: number | null;
      signed_by: string | null; approved_at_ms: number | null;
    }>(
      // LEFT JOIN on project: a change order whose job row has not synced to this device
      // still gets its celebration, with the job name simply absent. An INNER JOIN would
      // silently swallow the single most important event in the product because a
      // cosmetic label was missing.
      `SELECT co.id, co.project_id, p.name AS project_name,
              co.scope, co.scope_of_work, co.amount_cents, co.signed_by, co.approved_at_ms
         FROM change_order co
         LEFT JOIN project p ON p.id = co.project_id
        WHERE co.status = 'approved'
          AND co.id NOT IN (SELECT change_order_id FROM approval_celebrated)
        ORDER BY COALESCE(co.approved_at_ms, co.created_at_ms) ASC`
    );
    return rows.map((r) => ({
      changeOrderId: r.id,
      projectId: r.project_id,
      projectName: r.project_name,
      scope: r.scope,
      scopeOfWork: r.scope_of_work,
      amountCents: r.amount_cents,
      signedBy: r.signed_by,
      approvedAtMs: r.approved_at_ms,
    }));
  } catch {
    // No table yet, or a schema that predates it. Nothing to celebrate is the right
    // answer; a crash on the way to Home is not.
    return [];
  }
}

/**
 * He has seen it. Called when the popup is DISMISSED or its link is followed — never when
 * it is merely queued, or a celebration that lost a race with a re-render would be
 * consumed without ever having been on screen.
 */
export async function markCelebrated(
  db: AbstractPowerSyncDatabase, changeOrderId: string, atMs = Date.now()
): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO approval_celebrated (change_order_id, at_ms) VALUES (?, ?)`,
    [changeOrderId, atMs]
  );
}

/**
 * WHAT THE POPUP SAYS UNDER THE HEADLINE, as an i18n key + params.
 *
 * A key and not a sentence, for the same reason `credits.ts:balanceLine` returns one: a
 * string built here would be English on a Spanish-speaking contractor's phone (mandate
 * #5). The four shapes exist because both facts are genuinely optional — an extra can be
 * signed by a name we never captured, and `amount_cents` is nullable BY DESIGN (null is
 * "no price was stated", which is not the same fact as zero and must never render as
 * "$0.00" over a signature).
 */
export function celebrationLine(
  c: Pick<Celebration, 'signedBy' | 'amountCents'>, money: (cents: number) => string
): { k: string; p: Record<string, string> } {
  const who = c.signedBy?.trim();
  const amount = c.amountCents !== null && c.amountCents !== undefined
    ? money(c.amountCents) : null;
  if (who && amount) return { k: 'cel.byFor', p: { who, amount } };
  if (who) return { k: 'cel.by', p: { who } };
  if (amount) return { k: 'cel.for', p: { amount } };
  return { k: 'cel.plain', p: {} };
}

/**
 * The description the popup shows — THE TITLE, not the signed body.
 *
 * hadar asked for "a popup … like an SMS" carrying the description, and those two words
 * settle which description. `scope_of_work` (391) is the instrument's body: on a real
 * record on this device it runs to fourteen hundred characters of WHY THIS IS NEEDED /
 * WHAT WILL BE DONE / CONDITIONS. Putting that in a celebration turns a moment into a
 * document — the opposite of an SMS, and the opposite of a celebration.
 *
 * So the popup carries the line he would recognise from Home and the feed, and the full
 * signed text stays one tap away behind "See the change order", which is where a
 * contractor goes when he wants to READ rather than to enjoy it.
 *
 * The body is the floor rather than dead code: `scope` is NOT NULL with a length CHECK in
 * the shipped DDL, but this also runs against rows pulled from the server, and an empty
 * headline over a signature is worse than a long one.
 */
export function celebrationDescription(
  c: Pick<Celebration, 'scope' | 'scopeOfWork'>
): string {
  return c.scope.trim() || (c.scopeOfWork || '').trim();
}
