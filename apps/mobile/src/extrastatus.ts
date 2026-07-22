/**
 * PRD R7 — the per-item status the extras ledger shows, derived.
 *
 * PURE. No imports, no database, no clock, no I/O — same rule as
 * `approverrouting.ts`, and for the same reason: this decides what a contractor is
 * told about a priced commitment, it is a pure function of its inputs, and
 * `extrastatus.test.ts` can only run at all (node --test strips the types and
 * resolves nothing else) if this file imports nothing. The PowerSync/Supabase half
 * lives in `ledgerstatus.ts`.
 *
 * WHY A DERIVATION AND NOT A SIXTH STORED STATUS.
 *   `change_order.status` is CHECK-constrained to
 *   ('draft','sent','approved','declined','superseded') on both sides
 *   (030_change_order.sql, CHANGE_ORDER_DDL). "In Discussion" is deliberately NOT
 *   in that list: 220_question_path.sql states the model outright — "a request with
 *   question rows and no response is in discussion", derivable and not a fourth
 *   stored state. Storing it would mean a status that two writers (the client's
 *   question and the client's answer) can move, which is the failure that file was
 *   written to end.
 *
 *   The consequence, and the bug this module closes: the app never read the
 *   questions, so an item a client had asked about rendered as plain "Sent". The
 *   contractor saw "waiting on them" when in fact the client was waiting on HIM.
 *   R7's AC names discussing as one of the five statuses that must be shown.
 */

/** What a ledger row can say. The stored five, plus the derived one. */
export const LEDGER_STATUSES = [
  'draft', 'sent', 'discussing', 'approved', 'declined', 'superseded',
] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

/** The stored vocabulary — what `change_order.status` is allowed to hold. */
export const STORED_STATUSES = [
  'draft', 'sent', 'approved', 'declined', 'superseded',
] as const;
export type StoredStatus = (typeof STORED_STATUSES)[number];

/**
 * Everything outside `change_order.status` that changes what the row means.
 * One field today. It is an object rather than a bare number so adding the next
 * signal (a reply, a view) does not rewrite every call site.
 */
export type StatusSignals = {
  /**
   * Client questions on this extra that have not been closed by an answer.
   * The server already refuses a question once the item is answered
   * (`confirmation_ask`, 220), so this only ever counts live ones.
   */
  openQuestions: number;
};

export function isStoredStatus(v: string): v is StoredStatus {
  return (STORED_STATUSES as readonly string[]).includes(v);
}

/**
 * What the chip should say, given the stored status and the live signals.
 *
 * THE PRECEDENCE RULE, and it is the whole file:
 *
 *   A TERMINAL ANSWER OUTRANKS A QUESTION, ALWAYS.
 *   approved / declined / superseded are settled facts carrying a signature or a
 *   supersession. A client who asked something at 9am and signed at 11am is
 *   approved, full stop. Letting the earlier question win would show "Discussing"
 *   over a signed approval — the app contradicting its own binding instrument,
 *   which is mandate #5 broken on the one screen the contractor reads for money.
 *
 * A question against a NON-terminal row means the ball is in the contractor's
 * court, and that is the fact the chip exists to convey.
 *
 * `draft` + questions is not a contradiction to swallow: a question can only exist
 * if a link went out, so the local row simply has not learned it was sent yet
 * (offline, or a hydrate that has not landed). Rendering "Draft" there would tell
 * the contractor nothing is owed while a client waits on an answer, so the
 * question wins. Mandate #7: being behind on sync must not produce a wrong
 * instruction.
 *
 * An UNKNOWN stored status falls back to 'draft', matching the chip fallback this
 * replaces. Safe because the send affordance is gated on the STORED status
 * ('draft'|'sent') and never on this label, so a status from a newer build cannot
 * be acted on by mistake — only mislabelled, which is why it is a fallback and not
 * an invention.
 */
export function displayStatus(stored: string, signals?: StatusSignals): LedgerStatus {
  if (stored === 'approved' || stored === 'declined' || stored === 'superseded') {
    return stored;
  }
  if ((signals?.openQuestions ?? 0) > 0) return 'discussing';
  if (stored === 'sent') return 'sent';
  return 'draft';
}

/** i18n key for the chip label. Keys, never words — see i18n.ts's header. */
export function chipKey(s: LedgerStatus): string {
  return `co.chip.${s}`;
}

/**
 * Does this row's money still belong in the "awaiting approval" total?
 *
 * Discussing counts as awaiting. It is negotiation, not a decline: the extra is
 * still live and the contractor still stands to be paid for it. Dropping it out of
 * the pending total the moment a client asked a question would make the totals card
 * jump downward for a reason that has nothing to do with money — and R7's totals
 * are "approved extras + pending extras = extras total", with no third bucket.
 */
export function isAwaiting(s: LedgerStatus): boolean {
  return s === 'sent' || s === 'discussing';
}

/**
 * May this extra be superseded by a revision?
 *
 * ONLY from 'sent' (which includes discussing — that is stored 'sent'). Two
 * refusals, both deliberate:
 *
 *   - approved / declined: a terminal answer is signed evidence. Superseding it
 *     would retire an outcome the client committed to. Work that changes after an
 *     approval is a NEW extra with its own price and its own signature, never an
 *     edit of a settled one (PRD: "never edit in place after send").
 *   - draft: a draft is not frozen and nothing has left the phone, so the honest
 *     move is to correct it, not to leave a superseded ghost in the ledger.
 *   - superseded: already retired. Doing it twice would write a second lineage row
 *     claiming a different replacement.
 */
export function canSupersede(stored: string): boolean {
  return stored === 'sent';
}
