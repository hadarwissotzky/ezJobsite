/**
 * R3 step one — the Extra Work Authorization (EWA), as pure logic.
 *
 * PURE. No imports, no database, no clock, no I/O — same rule and the same reason
 * as `approverrouting.ts`: this file decides the WORDS of a signed commitment and
 * whether money is owed, it is the part of R3 that can be wrong in a way nobody
 * notices for weeks, and `node --test` can only run a file that resolves to
 * nothing. `ewastore.ts` holds the PowerSync half and `ewasend.ts` the Supabase
 * half; neither is importable by a test.
 *
 * WHAT AN EWA IS, and what it is not (PRD R3): "An EWA is a signed approval, never
 * an FYI — the homeowner commits to billability and proceed terms before the price
 * exists." So it carries no price, and the one thing this file must never do is
 * imply one. The plain priced card ends "Nothing proceeds until you approve."
 * Copying that line onto an EWA would be a lie on a T&M-capped authorization,
 * where work proceeds precisely because it was approved — see renderEwaCard.
 *
 * JUDGEMENT CALL — money arrives here already formatted, as strings.
 *   The obvious shape is `renderEwaCard({ capCents })` calling `money()`. Rejected:
 *   `money()` lives in changeorder.ts, which imports @supabase and @powersync, so
 *   importing it makes this file untestable; and re-implementing it here is the
 *   exact drift confirmations.ts documents at length (a second copy of the
 *   formatter rendered a credit as a charge, and 240_shown_content_integrity.sql
 *   requires the rendered figure to match postgres `to_char` LITERALLY, so two JS
 *   formatters is a coin flip on every send). Passing the caller's already-
 *   formatted string keeps ONE formatter and keeps this file pure. The cost is that
 *   a caller could pass rubbish; `validateEwaTerms` checks the cents it is given,
 *   and the DB trigger checks the string that comes out, so both ends are covered.
 *
 * ENGLISH-CANONICAL (mandate #5). Every string returned by `renderEwaCard` is
 * English and is NOT translated: it is the binding instrument, frozen at send and
 * hashed. Display language is a separate concern handled by t() in the UI. The
 * clause KEYS below (`ewa.term.hold` etc.) are what the contractor's screen shows;
 * the clause TEXT is what the client signs. They are deliberately different things.
 */

// ─── the two proceed terms ─────────────────────────────────────────────────────
// Exactly the two PRD R3 names, and deliberately not a third. A bare "range" is
// refused elsewhere in R3 for the reason that applies here too: an open-ended
// authorization reproduces the dispute at billing time instead of preventing it.
export const PROCEED_TERMS = ['hold', 'tm_capped'] as const;
export type ProceedTerm = (typeof PROCEED_TERMS)[number];

// R3: "The detailed price will follow within [24/48]h". Two choices, not a free
// number: the settlement promise is a term of a signed document, and a contractor
// typing "72" on a ladder has quietly written a different contract.
export const SETTLEMENT_HOURS = [24, 48] as const;
export type SettlementHours = (typeof SETTLEMENT_HOURS)[number];

export const HOUR_MS = 3_600_000;

/**
 * AC4's ceiling: "no Step 2 is sent within 48h → flagged". A contractor who
 * promised 24h is held to 24h, never to 48 — see `unpricedState`.
 */
export const UNPRICED_CEILING_HOURS = 48;

/** Re-nag cadence once the price is late. Daily, not hourly: see `reminderDueAt`. */
export const REMINDER_INTERVAL_MS = 24 * HOUR_MS;

export type EwaTerms = {
  proceed: ProceedTerm;
  /** T&M only. Integer cents per hour. Null/absent for `hold`. */
  hourlyRateCents?: number | null;
  /** T&M only. Integer cents. The "not to exceed $Y" figure. */
  capCents?: number | null;
  settlementHours: SettlementHours;
};

// ─── validation ────────────────────────────────────────────────────────────────

export type TermsProblem = { k: string; p?: Record<string, string | number> };

/**
 * Refuse a malformed authorization BEFORE it is rendered, hashed and signed.
 *
 * The failure this prevents is specific and unrecoverable: a T&M-capped EWA sent
 * with a missing cap reads "Work proceeds at $X/hr plus materials, not to exceed
 * $NaN" — an uncapped authorization to spend the client's money, frozen into the
 * instrument. Every other guard in this repo (numbers_confirmed_at, the shown-
 * content integrity trigger) sits downstream of a number that exists; this is the
 * one that makes sure it exists.
 *
 * Returns a KEY, not a sentence. A module that returns baked English cannot be
 * localized — the point i18n.ts opens with.
 */
export function validateEwaTerms(t: EwaTerms): TermsProblem | null {
  if (!(PROCEED_TERMS as readonly string[]).includes(t.proceed)) {
    return { k: 'ewa.err.noTerm' };
  }
  if (!(SETTLEMENT_HOURS as readonly number[]).includes(t.settlementHours)) {
    return { k: 'ewa.err.badWindow' };
  }
  if (t.proceed === 'tm_capped') {
    if (!isPositiveCents(t.hourlyRateCents)) return { k: 'ewa.err.needRate' };
    if (!isPositiveCents(t.capCents)) return { k: 'ewa.err.needCap' };
    // A cap below one hour of labour is almost certainly a typo (a $250/hr rate
    // typed into the cap field, or $85 meant as the rate). It is refused rather
    // than warned about, because the cap is the only number protecting the client
    // and the only number protecting the contractor's ability to bill.
    if ((t.capCents as number) < (t.hourlyRateCents as number)) {
      return { k: 'ewa.err.capBelowRate' };
    }
  } else {
    // `hold` means no work and therefore no rate and no cap. Carrying them anyway
    // would put figures in the record that the frozen text does not mention —
    // exactly the divergence mandate #5 exists to prevent.
    if (t.hourlyRateCents != null || t.capCents != null) {
      return { k: 'ewa.err.holdHasNumbers' };
    }
  }
  return null;
}

function isPositiveCents(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

// ─── the instrument ────────────────────────────────────────────────────────────

/**
 * The binding statement. R3 quotes it verbatim, so it is a constant, not a
 * template: this sentence is what makes the authorization an authorization.
 */
export const BILLABILITY_CLAUSE =
  'This work is outside the contracted scope and will be billed as an extra.';

export type RenderedMoney = {
  /** Already formatted by `money()` in changeorder.ts. See the header note. */
  hourlyRate: string;
  cap: string;
};

/**
 * The proceed term, in the client's words. One of the two, never both, never
 * neither — R3: "ONE proceed term selected by the contractor".
 */
export function proceedClause(t: EwaTerms, m?: RenderedMoney): string {
  if (t.proceed === 'hold') {
    return 'Work in this area pauses until the price is approved.';
  }
  // The rate AND the cap both appear, because either alone is ambiguous: a rate
  // with no cap is unbounded, a cap with no rate cannot be checked against an
  // invoice.
  return `Work proceeds at ${m!.hourlyRate}/hr plus materials, ` +
    `not to exceed ${m!.cap}, until a fixed price is issued.`;
}

/**
 * The settlement rule. This is the sentence that makes step 2 possible: without
 * it, the step-2 fixed price would be a SECOND charge on top of the T&M already
 * authorized, which is the double-billing dispute this whole flow exists to stop.
 */
export function settlementClause(hours: SettlementHours): string {
  return `The detailed price will follow within ${hours}h and, once approved, ` +
    `supersedes and settles this authorization.`;
}

/**
 * The exact words the client sees and signs. Rendered ONCE, frozen at send.
 *
 * Deliberately parallel in shape to `renderCard` in confirmations.ts but NOT a
 * branch inside it: the two documents disagree on their most important line. A
 * priced approval ends "Nothing proceeds until you approve." An EWA cannot say
 * that — on a T&M-capped term, work proceeds BECAUSE it was approved, and on a
 * hold term the thing that pauses is the work in that area, not the whole job.
 * Folding them together is how a contractor ends up holding a signature for a
 * document that describes the opposite arrangement.
 *
 * NO PRICE APPEARS ANYWHERE. That is the definition of step one and it is also
 * what keeps 240_shown_content_integrity.sql satisfiable: `amount_cents` is sent
 * as NULL for an EWA, so the trigger has no price to look for, while `nte_cents`
 * carries the cap and the trigger DOES check that the cap string below is present.
 */
export function renderEwaCard(o: {
  terms: EwaTerms;
  money?: RenderedMoney;
  /** The condition, in plain language. Photos travel with the request, not here. */
  scope: string;
  directedBy: string;
  projectName: string;
  whenMs: number;
  companyName?: string | null;
  /** Locale for the date. The DOCUMENT is English; the moment is a moment. */
  locale?: string;
}): string {
  const when = new Date(o.whenMs).toLocaleString(o.locale ?? 'en-US');
  const asker = o.companyName ? `${o.companyName}\n` : '';
  return (
    `${asker}EXTRA WORK AUTHORIZATION\n\n` +
    `${o.scope}\n\n` +
    `${BILLABILITY_CLAUSE}\n` +
    `${proceedClause(o.terms, o.money)}\n` +
    `${settlementClause(o.terms.settlementHours)}\n\n` +
    `Directed by: ${o.directedBy}\nJob: ${o.projectName}\nDate: ${when}\n\n` +
    `No price is stated in this authorization. ` +
    `Approving it authorizes the work on the terms above, not an amount.`
  );
}

/**
 * The three clauses in the order they must appear ABOVE the Approve button
 * (AC2: "Approve is only possible after the proceed term and settlement rule are
 * displayed"). Returned as an array so the web page renders exactly what was
 * frozen, in order, and can FAIL CLOSED if any of them is missing rather than
 * quietly showing an Approve button over an incomplete document.
 */
export function ewaClauses(t: EwaTerms, m?: RenderedMoney): string[] {
  return [BILLABILITY_CLAUSE, proceedClause(t, m), settlementClause(t.settlementHours)];
}

// ─── derived state ─────────────────────────────────────────────────────────────

/** The raw change_order.status an EWA row carries, plus the derived 'settled'. */
export type EwaDisplayStatus =
  | 'draft' | 'sent' | 'approved' | 'declined' | 'superseded' | 'settled';

/**
 * AC3: an approved EWA whose step-2 price has been approved reads "Settled".
 *
 * DERIVED, NOT STORED, and that was the main design decision in this requirement.
 * The obvious alternative is a sixth value in change_order.status. Rejected twice
 * over: (1) `status` carries a CHECK constraint in three places — the local STRICT
 * table, 030_change_order.sql, and the frozen-row trigger — and SQLite cannot
 * alter a CHECK, so adding a value means rebuilding a table that holds signed
 * records on phones in the field; (2) a stored 'settled' can disagree with the
 * child row it claims to summarise, and this repo already rejects that class of
 * bug for the ledger running total ("a stored total can disagree with the rows it
 * claims to sum"). Settlement IS the existence of an approved child. Reading it
 * from the child cannot drift from the child.
 *
 * Order matters: declined and superseded win over settlement. A child approval
 * arriving against a declined authorization is a bug to surface, not a state to
 * paper over — the EWA still reads "Declined" and AC5 keeps it out of the totals.
 */
export function ewaDisplayStatus(o: {
  status: string;
  /** change_order.status of the step-2 price that names this EWA as parent. */
  childStatus?: string | null;
}): EwaDisplayStatus {
  if (o.status === 'declined') return 'declined';
  if (o.status === 'superseded') return 'superseded';
  if (o.status === 'approved' && o.childStatus === 'approved') return 'settled';
  if (o.status === 'approved') return 'approved';
  if (o.status === 'sent') return 'sent';
  return 'draft';
}

// ─── AC4: approved, and still unpriced ────────────────────────────────────────

export type UnpricedState = {
  /** Show the "Unpriced — send price" flag prominently. */
  flagged: boolean;
  /** When the promise came due. Null when the EWA is not approved at all. */
  dueAtMs: number | null;
  overdueByMs: number;
};

/**
 * AC4: "Given an EWA is approved and no Step 2 is sent within 48h, when the
 * contractor opens the app, then the EWA is flagged 'Unpriced—send price'".
 *
 * THE DEADLINE IS THE PROMISE, NOT THE CEILING. AC4 says 48h; the settlement
 * clause the client signed may say 24h. Flagging a broken 24h promise only at the
 * 48h mark would mean the app stays silent for a full day about a term the client
 * has in writing. So the deadline is `settlementHours`, which is 48 in AC4's own
 * case and stricter in the other — never later than AC4 requires. Stated here
 * because it is a deliberate reading of the AC, not an oversight.
 *
 * `childSentAtMs` — SENT, not approved. AC4's condition is that no step 2 was
 * *sent*; once the price is out, the ball is with the client and nagging the
 * contractor is noise. A declined or unanswered step 2 still counts as sent.
 *
 * Note the deliberate absence: nothing here sends anything. Mandate #2 — the
 * reminder tells the contractor to price it; the price still leaves by hand.
 */
export function unpricedState(
  o: {
    status: string;
    approvedAtMs: number | null;
    childSentAtMs: number | null;
    settlementHours: SettlementHours;
  },
  nowMs: number
): UnpricedState {
  if (o.status !== 'approved' || o.approvedAtMs == null) {
    return { flagged: false, dueAtMs: null, overdueByMs: 0 };
  }
  if (o.childSentAtMs != null) return { flagged: false, dueAtMs: null, overdueByMs: 0 };
  const hours = Math.min(o.settlementHours, UNPRICED_CEILING_HOURS);
  const dueAtMs = o.approvedAtMs + hours * HOUR_MS;
  const overdueByMs = Math.max(0, nowMs - dueAtMs);
  return { flagged: overdueByMs > 0, dueAtMs, overdueByMs };
}

/**
 * When the contractor should next be reminded, or null for never.
 *
 * Daily, not hourly, and never before the deadline. A reminder that fires every
 * time the app opens is a reminder the contractor learns to swipe away without
 * reading, which is worse than none — by the time it matters (a real unpriced
 * authorization at day four) it has become furniture.
 *
 * AC4 says the reminder goes to the CONTRACTOR, not the homeowner. There is no
 * homeowner-facing output anywhere in this file, on purpose: chasing the client
 * for a price the contractor has not produced would be blaming the wrong party
 * for the contractor's own late promise.
 */
export function reminderDueAt(u: UnpricedState, lastRemindedAtMs: number | null): number | null {
  if (!u.flagged || u.dueAtMs == null) return null;
  if (lastRemindedAtMs == null) return u.dueAtMs;
  return Math.max(u.dueAtMs, lastRemindedAtMs + REMINDER_INTERVAL_MS);
}

/** Convenience for the caller that only wants "does this one need a nudge now?". */
export function reminderDue(
  u: UnpricedState, lastRemindedAtMs: number | null, nowMs: number
): boolean {
  const at = reminderDueAt(u, lastRemindedAtMs);
  return at != null && nowMs >= at;
}

// ─── AC3 + AC5: what the money total is allowed to contain ────────────────────

export type RollUpRow = {
  /** As returned by `ewaDisplayStatus` for an EWA, or the raw status otherwise. */
  status: EwaDisplayStatus | string;
  amountCents: number;
  /** The T&M cap, for an EWA. Null on a plain change order and on `hold`. */
  capCents?: number | null;
  isEwa: boolean;
};

export type RollUp = {
  /** Money actually agreed. AC3: only the settled amount, never the cap. */
  approvedCents: number;
  /** Sent, not yet answered. */
  awaitingCents: number;
  /**
   * Exposure the client has authorized but nobody has priced: the sum of live
   * T&M caps. Shown as history/exposure, NEVER added into a money total (AC3).
   */
  authorizedCapCents: number;
  /** Approved EWAs with no settled price yet — the AC4 flag count. */
  unpricedCount: number;
  declinedCount: number;
};

/**
 * The ledger's arithmetic, in one place.
 *
 * AC3: "the ledger shows only the settled amount in the money total (T&M cap shown
 * as history)". AC5: a declined item "is excluded from totals".
 *
 * The rule that makes both true at once is that AN EWA NEVER CONTRIBUTES MONEY.
 * It carries no price — that is what step two is for — so its amount is zero and
 * its cap is exposure, not a charge. Once settled, the money comes from the child
 * change order, which is an ordinary priced row and counts ordinarily. Nothing
 * needs to be subtracted anywhere, and there is no window in which the cap and the
 * settled price are both in the total, which is the double-count this AC is
 * guarding against.
 *
 * A settled EWA drops out of `authorizedCapCents` too: the cap stops being live
 * exposure the moment a real price is agreed.
 */
export function rollUp(rows: RollUpRow[]): RollUp {
  const r: RollUp = {
    approvedCents: 0, awaitingCents: 0, authorizedCapCents: 0,
    unpricedCount: 0, declinedCount: 0,
  };
  for (const row of rows) {
    if (row.status === 'declined') { r.declinedCount++; continue; }  // AC5
    if (row.status === 'superseded') continue;
    if (row.isEwa) {
      if (row.status === 'approved') {
        r.unpricedCount++;
        r.authorizedCapCents += row.capCents ?? 0;
      } else if (row.status === 'sent') {
        // Not in awaitingCents: there is no amount awaiting approval, only terms.
        r.authorizedCapCents += 0;
      }
      continue;                                    // never money, in any state
    }
    if (row.status === 'approved') r.approvedCents += row.amountCents;
    else if (row.status === 'sent') r.awaitingCents += row.amountCents;
  }
  return r;
}

// ─── narrowing, so callers never compare against a free string ────────────────
export function isProceedTerm(v: unknown): v is ProceedTerm {
  return typeof v === 'string' && (PROCEED_TERMS as readonly string[]).includes(v);
}
export function isSettlementHours(v: unknown): v is SettlementHours {
  return typeof v === 'number' && (SETTLEMENT_HOURS as readonly number[]).includes(v);
}
