/**
 * WHO A REMINDER GOES TO — the same people the extra was sent to the first time.
 *
 * hadar, 2026-08-14: "a reminder is the act of resending the same CO to the same
 * people again, and send an SMS like the first time to the clients and other people
 * with a message and a link."
 *
 * ─── WHAT THIS FIXES ────────────────────────────────────────────────────────────
 * "Remind" used to open the phone's SHARE SHEET. That is not a resend to the same
 * people; it is a blank envelope. The contractor had to remember who the extra went to,
 * find them again in Messages, and pick them — three chances to nudge the wrong person,
 * on a screen that had already named the right one two inches above the button ("Waiting
 * on Hadar"). The app knew the answer and asked him anyway.
 *
 * ─── WHERE "THE SAME PEOPLE" IS STORED ──────────────────────────────────────────
 * `extra_actor` rows with `act = 'approver'` are written by the send path
 * (`noteApprover`) at the moment the link goes out, and they carry `approver_id`. That
 * is the record of WHO WAS ASKED — deliberately copied at send time rather than joined
 * live, so retiring someone later cannot rewrite who a sent extra went to. Joining
 * `project_approver` on that id gets the number to text.
 *
 * ORDER MATTERS AND IS NOT ALPHABETICAL: the approver — the one person who can actually
 * answer (D4) — comes first, so a truncated list or a partial failure still reaches the
 * one recipient who makes the reminder worth sending.
 *
 * ─── WHAT IS RECORDED TODAY, STATED PLAINLY ─────────────────────────────────────
 * `extra_actor.act` is CHECK-constrained to ('captured','priced','sent','approver').
 * There is no per-extra record of ANYONE ELSE who was told about it: the company members
 * a contractor can tick on the send sheet are notified in-app by `request_extra_review`,
 * which writes to `notification_outbox` and stores nothing on the change order.
 *
 * So a reminder reaches THE CLIENT, and this function returns exactly that. It does not
 * pretend to a wider list. Reaching "and other people" by SMS the way hadar described
 * needs the send path to RECORD its recipients — a new act value on an append-only,
 * CHECK-constrained table, which is a table rebuild and its own change. Until that
 * exists, texting the project's other roster members would mean texting people who never
 * received the original link (an inspector getting a homeowner's price), which is worse
 * than the gap.
 *
 * ─── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────────
 * It never invents a recipient. A person on the record with no number on file is
 * RETURNED WITH `phone: null` rather than dropped, because "nobody to remind" and "three
 * people, none of whom we can text" are different facts and the screen has to be able to
 * say which one it is. Silently returning an empty list would make a missing phone
 * number look like an extra nobody was ever asked about.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

export type RemindTarget = {
  /** `project_approver.id`, or null for someone named on the record with no roster row. */
  approverId: string | null;
  name: string;
  /** E.164 when we hold one. Null means we know who, not how. */
  phone: string | null;
  /** True for the one person who can approve (D4). Always first in the list. */
  isApprover: boolean;
};

/**
 * The people this extra was sent to, approver first.
 *
 * De-duplicated by approver id AND by normalised name. An extra that was revised and
 * resent carries one `approver` row per send, so the same human is genuinely recorded
 * more than once — and texting one person the same reminder twice is the app looking
 * broken to the only audience that matters. Name-matching as well as id-matching because
 * the two sends can name the same person through different roster rows (one per job).
 */
export async function remindTargets(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<RemindTarget[]> {
  const rows = await db.getAll<{
    approver_id: string | null; name: string; phone_e164: string | null; act: string;
    at_ms: number;
  }>(
    `SELECT a.approver_id, a.name, pa.phone_e164, a.act, a.at_ms
       FROM extra_actor a
       -- NO status='active' FILTER, and that is the fix rather than the omission
       -- (hadar, 2026-08-15: the reminder kept opening the share sheet).
       --
       -- Change order #18 was sent to a client whose roster row was later RETIRED, so
       -- the join produced a NULL phone, nobody was reachable, and the reminder fell
       -- back to the phone's share sheet — for a person who is holding a live signing
       -- link right now.
       --
       -- Retiring somebody means "stop suggesting them for NEW extras". It cannot mean
       -- "stop nudging the person this extra was already sent to": the send happened,
       -- the link is live, and they are the only human who can answer it (D4). If the
       -- wrong person holds it, the remedy is Revise & Resend to somebody else — which
       -- retires the old instrument — not a reminder that quietly reaches nobody.
       LEFT JOIN project_approver pa ON pa.id = a.approver_id
      WHERE a.subject_kind = 'change_order'
        AND a.subject_id = ?
        -- 'approver' is who was ASKED — the only recipient this schema records. See
        -- the header: the act column is CHECK-constrained and nothing else is stored.
        AND a.act = 'approver'
      -- Most recent first. The id column breaks an at_ms tie so the order is
      -- deterministic: two acts stamped by one flow share a millisecond.
      ORDER BY a.at_ms DESC, a.id DESC`,
    [changeOrderId]);

  const key = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
  const seenId = new Set<string>();
  const seenName = new Set<string>();
  const out: RemindTarget[] = [];
  for (const r of rows) {
    const name = (r.name ?? '').trim();
    if (!name) continue;
    if (r.approver_id && seenId.has(r.approver_id)) continue;
    if (seenName.has(key(name))) continue;
    if (r.approver_id) seenId.add(r.approver_id);
    seenName.add(key(name));
    out.push({
      approverId: r.approver_id,
      name,
      phone: (r.phone_e164 ?? '').trim() || null,
      isApprover: r.act === 'approver',
    });
  }
  return out;
}

/** The ones a text can actually reach. */
export function reachable(targets: readonly RemindTarget[]): RemindTarget[] {
  return targets.filter((t) => !!t.phone);
}
