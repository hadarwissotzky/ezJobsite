/**
 * SPEC-extra-lifecycle-v1 §2 (REQ-LC10..13) — the Stage 1 send gate's CONTENT half.
 *
 * D3, and it is the whole shape of this file: THE SEND GATE HARD-BLOCKS ON
 * DESCRIPTION AND COST ONLY. Photos, payment timing, schedule impact and
 * what's-not-included are RECOMMENDED — they warn, they render as incomplete, and
 * they are sent anyway if the contractor chooses. Nothing else may disable Send.
 *
 * WHY THE SOFT LIST IS SOFT. This app is for someone standing on a jobsite whose
 * only job is to say what happened. A checklist that refuses to send until four
 * optional fields are filled does not produce a better document; it produces a
 * contractor who stops using the app and goes back to a text message, which is
 * the failure the whole product exists to prevent. The two hard blockers survive
 * because without them there is nothing for the owner to approve: a blank
 * description is a document that says nothing, and a missing price is a document
 * that asks someone to agree to an amount that does not exist.
 *
 * PURE. `canSendExtra` (extraprocstate.ts, itself importless but for a type) and a
 * type-only import are all it pulls in, so this still runs under `node --test`.
 * Same rule as `extrastatus.ts` and `ewa.ts`, same three reasons: it decides
 * whether a priced binding document may be sent, it is a function of its inputs,
 * and its test can only run at all if it resolves to nothing at runtime.
 *
 * IT RETURNS CODES AND KEYS, NEVER SENTENCES — i18n.ts's opening argument. The
 * words live in `send.blocked.*` / `send.recommended.*`.
 */

// Explicit .ts extensions: node --test resolves no extensions.
import { canSendExtra } from './extraprocstate.ts';
import type { ProcState } from './status.ts';

/** The hard gate — ALL SIX (hadar 2026-07-28, reversing D3; see `sendReadiness`).
 *  Was `no_description | no_cost` only. Widened to the union of both lists so a
 *  `blockers` array can carry any of the six and the screens type-check against it. */
export type SendBlocker =
  | 'no_description'
  | 'no_photos'
  | SendRecommendation;

/** The four that used to be advisory. They still name themselves separately — the
 *  checklist's completeness fraction and its softer mark are built from this list —
 *  but as of 2026-07-28 they also block Send. */
export type SendRecommendation =
  | 'no_cost'
  | 'no_billing_timing'
  | 'no_schedule_effect'
  | 'no_exclusions';

/** REQ-LC11: `completeness.of` is always 4 — the four recommended items, and
 *  blockers are deliberately not part of the fraction. A blocker is not 25% of
 *  anything; it is a wall. */
/** The completeness fraction's denominator: the four genuinely optional items.
 *  Photos left this list when they became a blocker (2026-08-07); cost took the slot,
 *  so the fraction still counts four and the checklist keeps its shape. */
export const RECOMMENDED: readonly SendRecommendation[] = [
  'no_cost', 'no_billing_timing', 'no_schedule_effect', 'no_exclusions',
];

export type SendReadiness = {
  /** true iff blockers.length === 0. The ONLY value permitted to disable Send. */
  ok: boolean;
  /** Ordered description-then-cost — the order the composer asks in, so the first
   *  refusal the contractor reads is the first field he would fix. */
  blockers: SendBlocker[];
  /** Missing recommended items. Presence here never affects `ok`. */
  recommended: SendRecommendation[];
  /** For the "3 of 4" affordance on the review card. */
  completeness: { have: number; of: 4 };
};

/**
 * THE PLACEHOLDER TITLE IS NOT A DESCRIPTION.
 *
 * `change_order.scope` is NOT NULL with `length(scope) > 0`, so an extra needs
 * words the instant it exists — before any transcript. `startextra.ts` writes this
 * exact string and says out loud that it has not been written up yet. Treating it
 * as a description would let a contractor send an owner a priced document titled
 * "Untitled extra — still being written up", which reads as a bug to the one
 * person whose trust the document is asking for.
 *
 * RESTATED, NOT IMPORTED, and that is a real cost stated rather than hidden:
 * `startextra.ts` value-imports `changeorder.ts` (@supabase, @powersync), so
 * importing `UNTITLED` from it would make this module — and its test — impossible
 * to run under `node --test`, which is the one property that lets the send gate be
 * tested at all. `sendreadiness.test.ts` reads `startextra.ts` off disk and
 * asserts the two literals are identical, so the copy cannot drift silently.
 */
export const UNTITLED_SCOPE = 'Untitled extra — still being written up';

/**
 * REQ-LC10/11/12 — is there enough here for an owner to approve?
 *
 * `kind` is what decides whether money is even a question, and the three answers
 * are different facts, not degrees of the same one (REQ-LC12):
 *
 *   extra    — priced. `amountCents === null` blocks. NULL IS NOT ZERO: "he never
 *              said a price" and "this is free" are different sentences, and
 *              storing 0 for the first tells a homeowner the work costs nothing
 *              (changeorder.ts:50-55). A genuine $0 extra passes the gate.
 *              On 'nte', the cap blocks too — R3's standing rule is that T&M
 *              ALWAYS carries a not-to-exceed figure; a bare range is never
 *              offered, because an open-ended authorization reproduces the dispute
 *              at billing time instead of preventing it.
 *   ewa      — never blocked on price. `amount_cents = 0` is the truthful number
 *              for an authorization that deliberately states no amount (303).
 *              ITS OWN TERM BLOCKERS ARE NOT REIMPLEMENTED HERE: the proceed term,
 *              and the hourly rate + cap that `tm_capped` requires, are owned by
 *              `ewa.ts:validateEwaTerms` (which returns its own i18n keys) and by
 *              303's uncapped-authorization guard. An EWA send path must call
 *              BOTH — this function and that validator. A second copy of the cap
 *              rule here is exactly the drift this repo keeps paying for.
 *   decision — never priced. A Decision carries no price by definition and no
 *              price field is shown (R10), so a missing amount is not a gap.
 *
 * The four recommended checks are applied uniformly across kinds. They are asked
 * of every document an owner reads, and nothing in the spec carves any kind out;
 * a per-kind exemption would need evidence this file does not have.
 */
/**
 * The shortest thing that can honestly be called a scope of work.
 *
 * Calibrated against the real data, not taste: every change order in the system has
 * a scope of 22-39 characters ("Loop check lc-mrwdq1fo", "Firewall salvage: sanding
 * and staining"), and all of them would pass any lower bar. 40 clears the entire
 * observed population of titles-masquerading-as-scopes while still admitting one
 * honest sentence.
 */
export const MIN_SCOPE_OF_WORK_CHARS = 40;

export function sendReadiness(x: {
  kind: 'extra' | 'decision' | 'ewa';
  scope: string;
  amountCents: number | null;
  nteCents: number | null;
  priceMode: 'fixed' | 'nte';
  photoCount: number;
  billingTiming: string | null;
  scheduleEffect: string | null;
  exclusions: string | null;
  /** 391 — the detailed client-facing scope. Optional so a caller that has not been
   *  migrated yet falls back to `scope` and behaves exactly as it did before. */
  scopeOfWork?: string | null;
}): SendReadiness {
  const blockers: SendBlocker[] = [];

  // THE GATE MOVED TO THE SCOPE OF WORK (391). It used to test `scope`, which is the
  // TITLE — so "Firewall salvage: sanding and staining", 38 characters, passed as a
  // description of $1,500 of work. The field that must be sufficient is the one the
  // client signs.
  //
  // A MINIMUM LENGTH, and it is the point of the change rather than a nicety: without
  // it a three-word scope of work satisfies the gate exactly as a three-word title
  // did, and nothing has improved. 40 characters is deliberately low -- it refuses
  // "Fix the wall" and accepts a short but real sentence, because this gate must not
  // become a word-count argument with a contractor on a ladder. The banner names what
  // is missing; it does not grade prose.
  const sow = (x.scopeOfWork ?? x.scope ?? '').trim();
  if (!sow || sow === UNTITLED_SCOPE || sow.length < MIN_SCOPE_OF_WORK_CHARS) {
    blockers.push('no_description');
  }

  // PHOTOS BLOCK (hadar, 2026-08-07: "description and photos are important — the rest
  // are optional"). This product's whole claim is evidence: a change order describing
  // rot under a tub, with no picture of the rot, is the text message it was built to
  // replace. It is also the one gap the contractor can always close standing where he
  // is, which is what makes it fair to block on.
  if (!(x.photoCount > 0)) blockers.push('no_photos');

  const recommended: SendRecommendation[] = [];
  // COST IS RECOMMENDED, NOT REQUIRED (hadar, 2026-08-07). This reverses the rule that
  // has stood since D3, and the trade is real and stated rather than hidden: an extra
  // sent without a price is an ACKNOWLEDGEMENT, not a priced approval. `renderCard`
  // already draws that variant — the frozen instrument simply carries no figure — so
  // the client agrees to the WORK and the money is settled later. That is a legitimate
  // jobsite act ("go ahead, we'll price it") and it is now permitted.
  //
  // WHAT IT MUST NEVER BECOME is a priced document with a blank number. It cannot:
  // `renderCard` branches on the amount being present, so absence produces a document
  // that never mentions cost, rather than one that mentions it emptily. Mandate #6 is
  // untouched — the app still never authors a figure, and any figure that IS present
  // still passed a human read-back.
  if (x.kind === 'extra') {
    // `== null` and not `=== null`: an undefined field from an untyped row is the
    // same fact as a null one — nobody said a price — and reading it as 0 is the
    // most expensive mistake this file could make.
    const noAmount = x.amountCents == null;
    // A CAP IS DIFFERENT AND STILL BLOCKS. `nte` means the contractor has chosen to
    // state a not-to-exceed, and a not-to-exceed clause with no ceiling in it is not a
    // softer promise — it is a promise that says nothing while looking like a limit.
    // Only the case "he named the mode and omitted its number" is caught here.
    const noCap = x.priceMode === 'nte' && x.nteCents == null;
    if (noCap) blockers.push('no_cost');
    else if (noAmount) recommended.push('no_cost');
  }
  if (!(x.billingTiming ?? '').trim()) recommended.push('no_billing_timing');
  // 'not_sure' IS A COMPLETE ANSWER (FLOW decision 3) and therefore never appears
  // here: it renders to the owner as "Schedule impact: to be confirmed", which is
  // honest and revisable. Only a null — nobody was ever asked — is incomplete.
  if (!(x.scheduleEffect ?? '').trim()) recommended.push('no_schedule_effect');
  if (!(x.exclusions ?? '').trim()) recommended.push('no_exclusions');

  // ── DESCRIPTION AND PHOTOS BLOCK; THE REST WARN (hadar, 2026-08-07) ──────────
  // This reverses the 2026-07-28 "all six block" rule, whose own comment (kept below
  // for the history) reversed D3 in the other direction. The line that decides it:
  // "description and photos are important — the rest are optional."
  //
  // Why the reversal is safe where the previous one was contentious: the four now-soft
  // items are TERMS, and a term nobody stated renders as a term nobody stated. Payment
  // timing absent means the instrument says nothing about billing, not that it says
  // something wrong. Description and photos are different in kind — without them the
  // document does not describe the work, and there is nothing for an owner to agree to.
  //
  // The four still WARN, still show as incomplete, and still name themselves in the
  // banner. What changed is only whether they gate `ok`, which is one line.
  //
  // ── previous rule, kept for the record ───────────────────────────────────────
  // ── ALL SIX BLOCK (hadar, 2026-07-28) ────────────────────────────────────────
  // This REVERSES D3, which made only description and cost blocking and left these
  // four as recommendations that warn and send anyway. hadar chose the mockup's
  // literal behaviour instead: "2 things left before you can send / These are
  // required for approval", with the missing items named as pills — where the two
  // named in the design are schedule impact and exclusions, both of which D3 had
  // as advisory. The design and the decision could not both be true; the design won.
  //
  // The two lists SURVIVE as separate fields on purpose. `recommended` still says
  // which four these are, so the checklist keeps its 4-item completeness fraction
  // and its softer ochre mark, and so reversing this back is one line here rather
  // than an unpicking of the screen. What changed is only whether they gate `ok`.
  //
  // SPEC-extra-lifecycle-v1 REQ-LC10/LC11 and the D3 text still describe the old
  // rule and are now WRONG. They are owed an edit; this comment is the record until
  // then, so the next reader does not "fix" this back to match the spec.
  return {
    ok: blockers.length === 0,
    blockers,
    recommended,
    completeness: { have: RECOMMENDED.length - recommended.length, of: 4 },
  };
}

/**
 * The words for each code. Explicit tables rather than a template over the code:
 * the codes are snake_case and the keys are camelCase (i18n.ts's convention), and
 * a computed key that misses returns the key itself to the screen — so the one
 * place this could silently print `send.blocked.no_description` at a contractor is
 * a `${}` nobody checked.
 */
const BLOCKER_KEYS: Record<SendBlocker, string> = {
  no_description: 'send.blocked.noDescription',
  no_cost: 'send.blocked.noCost',
  // The four widened into blockers on 2026-07-28 keep their own wording. Their
  // sentences state a fact and do not scold ("You have not said when you bill
  // this"), which is still the right register now that they gate Send — the
  // contractor is being told what is left, not told off.
  no_photos: 'send.blocked.noPhotos',
  no_billing_timing: 'send.recommended.noBillingTiming',
  no_schedule_effect: 'send.recommended.noScheduleEffect',
  no_exclusions: 'send.recommended.noExclusions',
};

const RECOMMENDATION_KEYS: Record<SendRecommendation, string> = {
  // 2026-08-07: cost is soft now. The wording says what an unpriced send MEANS —
  // "they agree to the work; the money is settled after" — because a contractor
  // skipping this needs to know he is sending an acknowledgement, not a quote.
  no_cost: 'send.recommended.noCost',
  no_billing_timing: 'send.recommended.noBillingTiming',
  no_schedule_effect: 'send.recommended.noScheduleEffect',
  no_exclusions: 'send.recommended.noExclusions',
};

export function blockerKey(b: SendBlocker): string { return BLOCKER_KEYS[b]; }
export function recommendationKey(r: SendRecommendation): string {
  return RECOMMENDATION_KEYS[r];
}

/**
 * REQ-LC13 — the composition, written once so no caller invents it.
 *
 * THE CONTENT GATE AND THE PIPELINE GATE ARE ORTHOGONAL AND BOTH MUST PASS.
 * Neither subsumes the other and neither is being replaced:
 *
 *   content  — "has the contractor said enough?" Answerable entirely on this
 *              device, and FIXABLE BY HIM RIGHT NOW.
 *   pipeline — "has the evidence left the phone and been processed?" NOT fixable
 *              by him, only waitable. It exists because an extra whose audio or
 *              photos are still queued would send a client a link to evidence that
 *              has not left the device and might never (mandate #1).
 *
 * CONTENT IS CHECKED FIRST because it is the refusal he can act on. Showing him
 * "waiting for signal" while the real problem is that he never said a price sends
 * him to stand by a window for a fault that is on the screen in front of him.
 */
export type SendGate =
  | { ok: true }
  | { ok: false; kind: 'content'; readiness: SendReadiness }
  | { ok: false; kind: 'pipeline'; whyKey: string };

export function sendGate(r: SendReadiness, proc: ProcState): SendGate {
  if (!r.ok) return { ok: false, kind: 'content', readiness: r };
  const p = canSendExtra(proc);
  // `whyKey` is present on every refusal from canSendExtra; the `??` is a floor,
  // not an expectation — a disabled Send button with no reason is what makes a man
  // on a ladder tap it eleven times and decide the app lost his extra.
  if (!p.ok) return { ok: false, kind: 'pipeline', whyKey: p.whyKey ?? 'send.notReady.notSentYet' };
  return { ok: true };
}
