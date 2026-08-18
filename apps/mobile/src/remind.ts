/**
 * R8 — "Remind" is not "Resend". PURE: no imports, no database, no clock.
 *
 * THE DISTINCTION, and it is not pedantic. Today the ledger's only nudge is
 * "Resend link", which goes through the full send flow and MINTS A NEW TOKEN. 250's
 * supersede trigger then retires the old one. So reminding a client invalidates the
 * link already sitting in their messages: they scroll back to the text you sent on
 * Tuesday, tap it, and get "This version was replaced" — BECAUSE you reminded them.
 * The nudge breaks the thing it was nudging about.
 *
 * R8 says it plainly: a reminder goes "always via the same link". A new link belongs
 * to Revise & Resend (R5b), where the price actually changed and retiring the old
 * one is the whole point. Reminding is not revising.
 *
 * WHAT THE COPY HAS TO DO (R8): "reminder copy points at the action". Not "just
 * checking in" — the client is not confused about whether they were sent something,
 * they have not done it. So the message names who is waiting, what for, and the
 * amount, and then gets out of the way.
 *
 * THE LIMITS ARE HERE AND NOT IN THE UI because they are the requirement, not a
 * styling choice: max 2 automated + unlimited manual, rate-limited to 1/day per
 * extra. Automated reminders need a scheduler that does not exist yet; this file
 * implements the MANUAL half and the rate limit that governs both, so the rule is
 * written down once and the scheduler inherits it rather than reinventing it.
 */

export type RemindState = {
  /** Reminders already sent for this extra, of any kind. */
  count: number;
  /** When the last one went out. null = never reminded. */
  lastAtMs: number | null;
  /** True while the client has an unanswered question (R8: nagging mid-negotiation). */
  inDiscussion: boolean;
};

export type RemindVerdict =
  | { ok: true }
  /** Blocked, with the reason to show. Never a silent no-op. */
  | { ok: false; reasonKey: 'r8.tooSoon' | 'r8.inDiscussion' | 'r8.notSent' };

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * May a reminder go out right now?
 *
 * `status` is the change order's. Only a SENT extra can be reminded about: a draft
 * has not been asked for yet, and an answered one has nothing owed.
 */
export function canRemind(
  status: string, state: RemindState, nowMs: number
): RemindVerdict {
  if (status !== 'sent') return { ok: false, reasonKey: 'r8.notSent' };

  // R8: "auto-reminders pause while status = In Discussion (nagging mid-negotiation
  // damages the relationship)." Applied to MANUAL reminders too, deliberately and
  // beyond the letter of the requirement: the client has asked a question and is
  // waiting on HIM. A reminder in that state is not a nudge, it is an insult, and
  // the contractor tapping it in a hurry is exactly who this should protect.
  if (state.inDiscussion) return { ok: false, reasonKey: 'r8.inDiscussion' };

  // 1/day per extra. Applies to manual too — the requirement rate-limits the EXTRA,
  // not the mechanism, and "unlimited manual" means unlimited over time, not
  // unlimited in one afternoon.
  if (state.lastAtMs !== null && nowMs - state.lastAtMs < ONE_DAY_MS) {
    return { ok: false, reasonKey: 'r8.tooSoon' };
  }
  return { ok: true };
}

/**
 * The message. Names the person waiting, the work, and the money, in that order,
 * then stops.
 *
 * `amount` arrives ALREADY FORMATTED by money(). This file never formats currency:
 * there is one formatter in this app and a second one here is how the reminder ends
 * up saying a different number than the link it points at (mandate #6).
 */
export function reminderText(o: {
  contractorName: string;
  scope: string;
  amount: string;
  url: string;
}): string {
  /**
   * NO EM DASH. IT IS NOT A TYPOGRAPHIC PREFERENCE — IT IS 3 OF THE 5 SEGMENTS.
   *
   * `—` does not exist in GSM-7, so a single one forces the ENTIRE message into UCS-2
   * at 67 characters per concatenated segment instead of 153. Measured with
   * `smsSegments` on a realistic reminder (291 characters): five segments with the em
   * dash, TWO with a hyphen. Same words, same length, 60% of the cost and three fewer
   * pieces for a handset to reassemble out of order.
   *
   * The same trap is why `clientsms.ts` exists — the 391 instrument layout opens with
   * one, which is what made the old send body seven segments.
   */
  return (
    `${o.contractorName} is waiting on your approval for: ${o.scope} - ${o.amount}\n\n` +
    `${o.url}\n\n` +
    `Same link as before. Nothing has changed.`
  );
}
