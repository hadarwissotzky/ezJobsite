/**
 * SPEC-extra-lifecycle-v1 §1 — the ONE authority on what stage an extra is in and
 * what may be done to it.
 *
 * WHY THIS FILE EXISTS, and it is not tidiness. `change_order.status` is written
 * in six places and derived in four, and not one of them shared a rule. The cost
 * of that is DEF-1: `applyLocalApproval` (changeorder.ts) and `signApproval`
 * (signing.ts) are bare `UPDATE … SET status='approved' WHERE id=?`, so a
 * `superseded` or `declined` row — a retired version, or a client's recorded NO —
 * walks straight to approved and the app then shows a signature over a document
 * nobody signed. Only the server path (230_close_the_loop.sql:112) ever carried
 * the precondition. A rule enforced in one place is a rule every other write path
 * has already forgotten.
 *
 * THE DIVISION OF OWNERSHIP, stated so the next module does not re-decide it:
 *   extrastatus.ts  owns DISPLAY   — the ledger vocabulary, the chip, the derived
 *                                    'discussing', the awaiting-money bucket.
 *   THIS FILE       owns STAGE + CAPABILITY — which of D1's three stages a row is
 *                                    in, which transitions are legal, and what is
 *                                    permitted there.
 * `displayStatus`, `isAwaiting` and `canSupersede` are RE-EXPORTED below, never
 * reimplemented: a second copy of "may this be revised" is two functions that
 * agree today and disagree after the first edit to either.
 *
 * PURE. Its one import is `extrastatus.ts`, which is itself importless, so this
 * still runs under `node --test` with nothing but the type stripper — the same
 * rule and the same reason as `discussion.ts`. This decides whether a priced,
 * binding commitment may move, it is a pure function of its inputs, and
 * `extralifecycle.test.ts` can only run at all if this file resolves to nothing.
 *
 * THE CAPABILITY PREDICATES ARE FOR BOTH SIDES. The UI calls them to decide what
 * to render, and the WRITE PATH calls them (or states the same `WHERE` literally)
 * to decide what to commit. If only the UI consults them, the rule is a styling
 * choice that any code path reaching the database can ignore — which is exactly
 * how DEF-1 happened. A hidden button is not a guard.
 */

// The explicit .ts extension is load-bearing: node --test resolves no extensions,
// and this module has to keep running there.
import { canSupersede, isStoredStatus, type StoredStatus } from './extrastatus.ts';

/**
 * Re-exported, not redefined. `extrastatus.ts` remains the owner of all three;
 * they are surfaced here so a screen that already imports the lifecycle does not
 * need a second import to label what it just gated.
 */
export {
  displayStatus, isAwaiting, canSupersede, chipKey, isStoredStatus, STORED_STATUSES,
} from './extrastatus.ts';
export type { LedgerStatus, StoredStatus, StatusSignals } from './extrastatus.ts';

/**
 * D1's three stages. REQ-LC2 maps every stored status onto exactly one of them.
 *
 *   draft       Stage 1 — nothing has left the phone. Mutable, deletable.
 *   negotiation Stage 2 — a live link exists. Frozen, answerable, revisable.
 *   locked      SEALED — no edit, no delete, no status movement of any kind.
 *
 * 'locked' IS NOT A SYNONYM FOR "STAGE 3", and the spec is emphatic about why.
 * Stage 3 is defined by the existence of an approval; `declined` and `superseded`
 * carry none. They are sealed by identical rules — that is what this Stage value
 * expresses — but calling them Stage 3 would make "Stage 3 means somebody signed"
 * false, which is the one thing that sentence has to mean. A caller that needs
 * "was this signed?" asks the STATUS (`status === 'approved'`), never the stage.
 */
export type Stage = 'draft' | 'negotiation' | 'locked';

/**
 * REQ-LC2's mapping, and the whole reason no screen may re-decide it locally.
 *
 * AN UNKNOWN STATUS IS 'locked', which is the opposite of `displayStatus`'s
 * fallback and deliberately so. That function picks a LABEL and 'draft' is the
 * harmless label; this function picks a PERMISSION SET, and 'draft' is the set
 * that permits editing a frozen document and deleting a signed one. A status
 * string this build has never heard of comes from a newer build, a corrupted row,
 * or a bug — every one of which is a reason to allow nothing rather than
 * everything. The failure this prevents: a phone one version behind treats an
 * unrecognised terminal status as an editable draft.
 *
 * There is no second parameter. Nothing outside `change_order.status` changes the
 * stage — questions, opens and reminders are all sub-states of `sent`, so an
 * `opts` argument here would be a parameter that is read and ignored, which is
 * worse than none.
 */
export function stageOf(status: string): Stage {
  if (status === 'draft') return 'draft';
  if (status === 'sent') return 'negotiation';
  return 'locked';
}

/**
 * REQ-LC7 — the ONLY legal transitions. Everything absent from this table is
 * refused, loudly.
 *
 * `draft → approved` and `draft → declined` are deliberate and are not a bug.
 * The SERVER row is always `sent` by the time an answer can land (T1's trigger
 * moves it when the link is minted), but a DEVICE row may still read `draft`
 * because the send has not hydrated back yet. Refusing the client's answer there
 * would make being behind on sync produce a wrong outcome — mandate #7.
 *
 * `draft → superseded` is absent on purpose: a draft is corrected, not retired,
 * and superseding one would leave a ghost in the ledger for a version no client
 * ever saw (`canSupersede`, extrastatus.ts).
 *
 * The three terminal states have EMPTY successor lists. That empty array is the
 * seal (REQ-LC30) and it is the direct fix for DEF-1.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<StoredStatus, readonly StoredStatus[]>> = {
  draft: ['sent', 'approved', 'declined'],
  /**
   * `sent → cancelled` — the withdrawal (421, hadar 2026-08-24). It amends REQ-LC20,
   * which named "cancel" as a move that does not exist.
   *
   * NOT reachable from `draft`: a draft has no live instrument and nobody to tell, so
   * withdrawing one is deleting it, which is a different act with its own rules.
   * NOT reachable from `approved`: an approved record is frozen and permanent, and a
   * transition that could land on top of one would let a contractor un-sign a signed
   * document. `cancel_change_order_v1` refuses that server-side too, so the rule holds
   * on both sides rather than resting on this table alone.
   */
  sent: ['approved', 'declined', 'superseded', 'cancelled'],
  approved: [],
  declined: [],
  superseded: [],
  /** Terminal. Nothing follows a withdrawal — see the seal note above. */
  cancelled: [],
};

/**
 * May this row move from `from` to `to`?
 *
 * A STATUS THAT DOES NOT MOVE IS NOT A TRANSITION. `canTransition(x, x)` is false
 * for every x. Write sites use this as the precondition on an UPDATE that claims
 * to change state; letting a no-op through would let a caller report a transition
 * that never happened, which REQ-LC8 names as the defect this project keeps
 * finding.
 *
 * An unknown status on either side is false, for `stageOf`'s reason: an
 * unrecognised string is not a licence.
 */
export function canTransition(from: string, to: string): boolean {
  if (!isStoredStatus(from) || !isStoredStatus(to)) return false;
  return (LEGAL_TRANSITIONS[from] as readonly string[]).includes(to);
}

/**
 * "MAY I DO THIS" AND "DID THIS HAPPEN" ARE DIFFERENT QUESTIONS, and answering the
 * second with `canTransition` is a defect this file shipped with.
 *
 * `hydrateChangeOrders` is not PERFORMING a transition; it is LEARNING one the
 * server already performed. Gating it on `canTransition` refused every pair the
 * local row could not have reached BY ITSELF — and `draft → superseded` is exactly
 * such a pair, because a draft is corrected rather than retired (see
 * LEGAL_TRANSITIONS) but the SERVER may legitimately have taken that row through
 * `sent` to `superseded` while this device only ever saw the draft. The refusal is
 * permanent and re-fires every tick: a second handset then keeps rendering a
 * retired version as an editable Stage-1 draft, with Edit, Send and Delete live.
 *
 * THE RULE IS MONOTONIC PROGRESS, which is what "a status the server produced
 * lawfully" actually means:
 *
 *   draft (0) → sent (1) → approved | declined | superseded (2)
 *
 * A server status of strictly greater rank is adopted; anything else is refused and
 * counted. That still closes DEF-1's back door in full — `approved → sent` (2→1),
 * `declined → approved` and `superseded → approved` (2→2) are all refused — while
 * no longer refusing a fact this device simply had not heard yet.
 *
 * A local TERMINAL status disagreeing with a server TERMINAL status is never
 * adopted, and that is deliberate: the only way that pair can arise is a local
 * write the server rejected, which is the drain's refusal to repair (see
 * `drainSupersessions`), not the pull's to overwrite. Overwriting there would
 * destroy the evidence that the two sides disagree.
 */
const PROGRESS: Readonly<Record<StoredStatus, number>> = {
  // `cancelled` ranks with the other terminals: a device that only saw `sent` adopts
  // it, and nothing — including an approval arriving late — overwrites it locally. The
  // server is the one place that arbitrates cancel-versus-approve, and it refuses the
  // cancel rather than racing (421).
  draft: 0, sent: 1, approved: 2, declined: 2, superseded: 2, cancelled: 2,
};

export function canAdoptServerStatus(local: string, server: string): boolean {
  if (!isStoredStatus(local) || !isStoredStatus(server)) return false;
  return PROGRESS[server] > PROGRESS[local];
}

/**
 * The same rule, for a write site that must not continue.
 *
 * It THROWS rather than returning false because its callers are the ones holding
 * a database handle: a guard whose refusal can be ignored by forgetting an `if`
 * is not a guard. The message names both states and the row, because the log line
 * this produces is the only evidence anyone will have about why a signature was
 * refused at 6pm on a jobsite.
 *
 * This is a BELT, not the braces. The braces are the literal
 * `WHERE status IN ('draft','sent')` on the UPDATE itself (REQ-LC7): a thrown
 * error protects one code path, a `WHERE` clause protects the row.
 */
export function assertTransition(from: string, to: string, id?: string): void {
  if (canTransition(from, to)) return;
  throw new Error(
    `illegal extra transition ${from} → ${to}${id ? ` on ${id}` : ''}: ` +
    `${from} may only become [${
      isStoredStatus(from) ? LEGAL_TRANSITIONS[from].join(', ') || 'nothing — it is sealed'
        : 'nothing — that is not a stored status'
    }]`
  );
}

// ── capabilities ──────────────────────────────────────────────────────────────
//
// Each one is a function of the STORED status, never of the displayed one. A chip
// reading "Discussing" is a `sent` row, and gating an affordance on the label
// would make a client's question silently change what the contractor may do.

/**
 * REQ-LC14 — Stage 1 is the only stage in which an extra may be edited in place.
 * A draft has no counterparty, no frozen instrument and no live link, so
 * correcting it is honest. After send, `change_order_frozen` (device) aborts the
 * write regardless; this predicate exists so the app never offers something it
 * already knows the database will refuse.
 */
export function canEdit(status: string): boolean {
  return stageOf(status) === 'draft';
}

/**
 * The LIFECYCLE half of the send gate, and only that half.
 *
 * REQ-LC13: three orthogonal questions must all pass before a link is minted, and
 * conflating them is named in the spec as the single most likely thing to get
 * wrong. This one is "is this row in a stage where sending is even a legal act?".
 * The other two live elsewhere and neither is subsumed here:
 *   sendreadiness.ts `sendReadiness` — has the contractor said enough? (content)
 *   extraprocstate.ts `canSendExtra` — has the evidence left the phone? (pipeline)
 */
export function canSend(status: string): boolean {
  return canTransition(status, 'sent');
}

/**
 * REQ-LC14 / T5 — the stage half of deletion.
 *
 * `discard.ts:planDiscard` is the ARBITER of an actual delete and this does not
 * replace it: it also refuses a draft that somehow holds a live link, refuses
 * captures a sibling extra still reaches, and refuses a delete that is only half
 * possible because the media is already on the server. This answers the narrower
 * question a button needs — is deletion legal in this stage at all.
 *
 * (Follow-up not made here, to stay inside this change: `planDiscard`'s local
 * `NEVER_SENT` list states the same rule a second time and should delegate to
 * this predicate.)
 */
export function canDelete(status: string): boolean {
  return stageOf(status) === 'draft';
}

/**
 * REQ-LC21 — the stage half of "may this client be reminded".
 *
 * `remind.ts:canRemind` is the arbiter of whether one may go out RIGHT NOW: it
 * adds the 1-per-day rate limit and R8's refusal to nag while the client is
 * waiting on an answer, and it returns a reason key rather than a boolean. The
 * two agree because `sent` is the only status in the negotiation stage — a draft
 * has not been asked for yet and an answered one has nothing owed.
 */
export function canRemind(status: string): boolean {
  return stageOf(status) === 'negotiation';
}

/**
 * REQ-LC22 / D2 — Revise & Resend. The SAME EDGE as `canSupersede`, seen from the
 * other end: revising means minting a new row AND retiring this one, and the
 * retirement is the part with a rule. Delegated rather than restated.
 */
export function canRevise(status: string): boolean {
  return canSupersede(status);
}

/**
 * REQ-LC23 / DEF-4 — the thread closes when the version is answered.
 *
 * `sent`, and nothing else. This is the client-side half of a two-sided contract
 * the server has enforced since `308_r5b_discussion.sql:94`
 * (`confirmation_reply_thread_open` rejects with errcode 23514, and 23514 is in
 * `R5B_PERMANENT`). Offering a composer after the answer does not produce a late
 * message; it produces a reply that is PARKED FOREVER while the UI shows it as
 * sent — a silent delivery failure on the one surface whose whole job is that the
 * record is complete.
 *
 * This overrides the 2026-07-24 "an extra is a chat channel" note in
 * `discussion.ts`, and the reason it was wrong is not that the idea is bad: it
 * widened the CLIENT of a two-sided contract without ever widening the server.
 * Where the conversation goes instead is REQ-LC31 — a change after approval is a
 * new linked extra, which is where a new commitment belongs anyway.
 */
export function canReply(status: string): boolean {
  return status === 'sent';
}

/**
 * REQ-LC7 T2 / DEF-1 — may an answer be recorded against this row at all?
 *
 * THIS IS THE MISSING PRECONDITION. `applyLocalApproval` and `signApproval` must
 * state it literally in their own `WHERE` / `.in()` — `… AND status IN
 * ('draft','sent')` — and return whether a row actually moved, so a caller can
 * never report an approval that did not happen (REQ-LC8).
 *
 * `draft` is included for the offline reason spelled out on LEGAL_TRANSITIONS.
 * `superseded` and `declined` are excluded because that is the whole defect: a
 * retired version and a recorded refusal must never become a signature.
 *
 * IT ANSWERS THE STATUS QUESTION ONLY. D4's single-required-approver rule is a
 * question about WHO is answering, not about what state the row is in, and it is
 * settled by the approver routing, not here. Both must hold. Decline shares this
 * precondition exactly (T3) — a decline site asks `canTransition(status,
 * 'declined')`, which is the same set by construction.
 */
export function canApprove(status: string): boolean {
  return canTransition(status, 'approved');
}

/**
 * REQ-LC31 / D6 — a change after approval is a NEW INDEPENDENT EXTRA, linked to
 * the approved one by `origin_change_order_id`. This is the predicate for the
 * ORIGIN LINK, which is why it is `approved` and not "anything terminal":
 * REQ-LC31 rule 1 says the origin may only reference an approved row, because
 * pointing it at a `sent` one would be a supersession wearing a different name.
 * The origin row itself is never written to, retired, or moved — that is the
 * whole point of D6, and it is the difference from `superseded_by`.
 *
 * KNOWN SPEC CONFLICT, flagged rather than silently resolved: REQ-LC26 says a
 * contractor who wants to try again after a DECLINE "creates a new extra linked
 * by origin", which REQ-LC31 rule 1 forbids. The explicit, migration-backed rule
 * wins here. A declined extra can still seed a new draft by copying it forward —
 * that just carries no origin link until someone adjudicates which rule holds.
 */
export function canCreateLinkedExtra(status: string): boolean {
  return status === 'approved';
}
