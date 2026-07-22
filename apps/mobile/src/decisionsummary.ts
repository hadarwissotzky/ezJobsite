/**
 * PRD R6c — the decision summary: a derived narrative, never a new fact.
 *
 * WHAT THIS IS FOR: by the time an extra has passed through a crew member, a
 * price, a send, a question and an answer, the R6 timeline is accurate and slow.
 * A contractor asked "where is this?" answers in one sentence. This builds that
 * sentence — and nothing else.
 *
 * PURE. No imports, no database, no clock, no I/O — same rule as
 * approverrouting.ts, extrastatus.ts and recordpeople.ts, and for the same reason:
 * `node --test src/decisionsummary.test.ts` only resolves at all if type-stripping
 * is the whole build. The PowerSync half is `decisionsummarydata.ts`.
 *
 * WHY THE UNANSWERED-QUESTION FLAGS ARE PASSED IN RATHER THAN DERIVED HERE: R5b
 * already decided, and argued at length, when a client message counts as
 * unanswered — including a deliberate deviation from the PRD's literal wording
 * (earliest unanswered, not latest, so asking again cannot un-flag a week of
 * silence). Re-deriving it here would be a second definition of "you owe them an
 * answer" that agrees today and drifts after the first edit to either, on the
 * clause this summary ENDS on. So `discussion.threadState()` stays the only place
 * that rule lives and the data layer hands its answer over as two booleans.
 * extrastatus.ts and discussion.ts already refused to duplicate each other for
 * exactly this reason; this file follows them.
 *
 * ─── THE FENCE (R6c's guardrails, in the order the PRD states them) ───────────
 *
 * 1. DERIVED ONLY FROM LOGGED EVENTS. Every clause below is emitted only when a
 *    stored row exists for it: an `extra_actor` row, a `thread_message` row, or a
 *    column on `change_order`. There is no clause that can be produced by
 *    reasoning. No motive, no prediction, no rounding, no "probably".
 *
 * 2. MANDATE #6 — the dollar figure. `amount` arrives here ALREADY FORMATTED by
 *    changeorder.money() from `change_order.amount_cents`. This module never
 *    parses, re-reads, re-formats or arithmetics a price, and it never sees a
 *    transcript. The number in the summary is the record's own field restated,
 *    which is the only kind of number R6c permits.
 *
 * 3. NEVER THE BINDING INSTRUMENT. Nothing here is signed, hashed or sent. The
 *    output is keys and params; the label naming it as derived is `r6c.derived`
 *    and the render layer is required to show it. `approvalpdf.ts` keeps it
 *    structurally outside the signed block.
 *
 * 4. NEVER BLOCKS THE RECORD. `decisionSummary` returns null rather than throwing
 *    or half-rendering when nothing is traceable, and the caller omits the
 *    section. Mandate #7: this is on-device, synchronous, and needs no network and
 *    no model, so "offline" is not even a failure mode here — see the note on
 *    R6c's open question at the bottom of this header.
 *
 * 5. REGENERATES, NEVER REWRITES. This is a pure function of stored rows called at
 *    render. It cannot write anything, so the append-only chain is untouchable
 *    from here by construction rather than by discipline.
 *
 * ─── R6c's OPEN QUESTION, answered ────────────────────────────────────────────
 * "whether the summary is generated on-device, server-side at event time, or on
 * render — an eng call". ON DEVICE, ON RENDER, and with no model. Server-side at
 * event time would make the summary a stored artifact that can disagree with the
 * events it was derived from, and would make it unavailable in a basement — the
 * two failures R6c's own guardrails forbid. A model would make clause 1
 * unenforceable: a generated sentence cannot be proven to introduce no fact. This
 * is a fixed vocabulary of clauses, each gated on a row, so "traces to a logged
 * event" is checkable by reading the file.
 *
 * ─── WORDS ARE NOT HERE ───────────────────────────────────────────────────────
 * Keys and params only, like eventtimeline.ts and recordpeople.ts. Mandate #5:
 * the record is English-canonical with per-user display language, and a module
 * that returns a sentence has welded one language into the logic.
 */

/** The three contributions the contractor's side logs (`extra_actor.act`). */
export type Act = 'captured' | 'priced' | 'sent';

/**
 * The two fields of R5b's `ThreadMessage` this file needs, redeclared rather than
 * imported — the same move `discussion.ts` makes with i18n's `Msg`, and for the
 * same reason: importing anything is what stops this module being runnable under
 * `node --test`. The compiler still checks the shape at the call site, because a
 * real ThreadMessage is assignable to this.
 *
 * The BODY is deliberately not in the shape. A summary that could read a message
 * could paraphrase it, and a paraphrase of what a client asked is not evidence of
 * what they asked. Not having the text is the cheapest possible enforcement.
 */
export type SummaryMessage = { side: 'client' | 'contractor'; atMs: number };

/** One stored actor row, already reduced to one per act by the caller (which uses
 *  recordpeople's rules: earliest capture/price, latest send). */
export type ActorFact = { name: string; atMs: number };

export type SummaryInput = {
  /** `change_order.status` as stored — never a LedgerStatus. */
  status: string;
  captured: ActorFact | null;
  priced: ActorFact | null;
  sent: ActorFact | null;
  /**
   * Who the client side is, named ONLY when the record leaves no doubt.
   *
   * `thread_message` stores a side, not an author — the client's question rows
   * carry no name at all. Putting the approver's name on a question is therefore
   * an inference, and it is wrong the moment an extra was re-sent to somebody
   * else: the earlier person's question would be attributed to the later person.
   * So the data layer sets this only when every `approver` row on the record names
   * the same person, and passes null otherwise. Null is not a degraded case — the
   * clause simply stops naming anybody, which is what this codebase does with a
   * fact it does not hold.
   */
  clientName: string | null;
  /** `change_order.signed_by` — the typed-name signature (R6). */
  signedBy: string | null;
  /** R5b's thread, both sides. Order does not matter — this file sorts. */
  messages: readonly SummaryMessage[];
  /**
   * `discussion.threadState().unansweredSinceMs !== null` — the client has said
   * something the contractor has not answered. Passed in, never re-derived; see
   * the header.
   */
  unanswered: boolean;
  /** `discussion.threadState().awaitingReply` — that silence has passed R5b's 48h. */
  awaitingReply: boolean;
  /**
   * The record's own amount, ALREADY formatted by changeorder.money(). Null for an
   * item that carries no price (R10's Decision). See guardrail 2 above.
   */
  amount: string | null;
  /**
   * The device profile's name, used for ONE thing: choosing second person for a
   * contribution whose stored name matches it, so the summary reads the way R6c
   * writes it ("Marco captured it · you priced and explained").
   *
   * JUDGEMENT CALL, stated because record.ts documents a bug that looks like this
   * one. That bug was reading the profile to ATTRIBUTE an act, so renaming
   * yourself rewrote who priced a two-week-old record. This never attributes: the
   * name comes from the stored `extra_actor` row either way, and the profile only
   * decides whether that same person is addressed as "you". The residual is that
   * renaming yourself flips "Marco priced it" to "You priced it" — the person
   * named is unchanged, and null here always falls back to the stored name.
   */
  meName: string | null;
};

/** `atMs` null = the event is real but its time is not on this device (record.ts's
 *  KNOWN GAP: send and signature times live server-side). Sorted last, never given
 *  an invented position — the same rule the timeline follows. */
export type Clause = { k: string; p?: Record<string, string | number>; atMs: number | null };

/** The last line, always present: what is owed NOW. R6c: the summary "ends on what
 *  is owed", which is the difference between a status label and an instruction. */
export type Owed = {
  k: string;
  p?: Record<string, string | number>;
  /** R5b's 48h rule fired: the client has been waiting on an answer. Render hot. */
  urgent: boolean;
};

export type DecisionSummary = {
  clauses: Clause[];
  owed: Owed;
  /** How many stored facts the narrative rests on. Shown next to the derived
   *  label so the claim "derived from the timeline" is checkable rather than
   *  asserted — a summary with 5 clauses and a 2-line history is a bug the reader
   *  can see. */
  traced: number;
};

function clean(s: string | null | undefined): string | null {
  const v = (s ?? '').trim().replace(/\s+/g, ' ');
  return v.length ? v : null;
}

/** Whitespace- and case-insensitive, matching recordpeople's merge key so "you"
 *  is decided the same way the People block decides two rows are one person. */
function sameName(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().replace(/\s+/g, ' ').toLowerCase()
       === b.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The narrative.
 *
 * Returns null when NOTHING is traceable — no actor rows, no messages, no
 * signature. That is R6c's second AC made structural: the section is absent, the
 * record renders complete without it, and the timeline underneath is still the
 * source. A summary consisting only of "waiting on approval" would be the status
 * chip wearing a narrative's clothes.
 */
export function decisionSummary(input: SummaryInput): DecisionSummary | null {
  const me = clean(input.meName);
  const client = clean(input.clientName);
  const clauses: Clause[] = [];

  const isMe = (name: string) => sameName(name, me);

  // ── the contractor's side: three logged acts, each with its own clock ────────
  const cap = input.captured;
  if (cap && clean(cap.name)) {
    const name = clean(cap.name)!;
    clauses.push({
      k: isMe(name) ? 'r6c.cCapturedYou' : 'r6c.cCaptured',
      p: { name }, atMs: cap.atMs,
    });
  }

  const pri = input.priced;
  if (pri && clean(pri.name)) {
    const name = clean(pri.name)!;
    const amount = clean(input.amount);
    // The amount is folded in only when the record HAS one. R10's Decision carries
    // no price and must show none anywhere; a clause with an empty {amount} hole
    // would put a price-shaped gap on a price-less item.
    const k = amount
      ? (isMe(name) ? 'r6c.cPricedAtYou' : 'r6c.cPricedAt')
      : (isMe(name) ? 'r6c.cPricedYou' : 'r6c.cPriced');
    clauses.push({ k, p: amount ? { name, amount } : { name }, atMs: pri.atMs });
  }

  const snt = input.sent;
  if (snt && clean(snt.name)) {
    const name = clean(snt.name)!;
    const k = client
      ? (isMe(name) ? 'r6c.cSentToYou' : 'r6c.cSentTo')
      : (isMe(name) ? 'r6c.cSentYou' : 'r6c.cSent');
    clauses.push({ k, p: client ? { name, to: client } : { name }, atMs: snt.atMs });
  }

  // ── the thread: counted, never quoted ───────────────────────────────────────
  //
  // The summary states THAT a question was raised and how many times. It does not
  // reproduce or paraphrase the words: a paraphrase of what a client asked is not
  // evidence of what they asked (eventtimeline.ts makes the same call about the
  // `asked` event, and quotes verbatim there because that IS the timeline). The
  // words are one section down, unabridged, in the history and in the thread.
  const sorted = [...input.messages].sort((a, b) => a.atMs - b.atMs);
  const asked = sorted.filter((m) => m.side === 'client');
  const replied = sorted.filter((m) => m.side === 'contractor');

  if (asked.length) {
    const n = asked.length;
    const k = client
      ? (n === 1 ? 'r6c.cAsked' : 'r6c.cAskedN')
      : (n === 1 ? 'r6c.cAskedPlain' : 'r6c.cAskedNPlain');
    clauses.push({ k, p: client ? { name: client, n } : { n }, atMs: asked[0].atMs });
  }
  if (replied.length) {
    // Deliberately nameless. `thread_message` stores a side and a body and no
    // author, so there is no stored answer to "who replied" — not even for the
    // device holder, since a reply can be posted from a second phone. Naming the
    // sender here would be the one invented fact in the file.
    clauses.push({
      k: replied.length === 1 ? 'r6c.cReplied' : 'r6c.cRepliedN',
      p: { n: replied.length }, atMs: replied[0].atMs,
    });
  }

  // ── the outcome ─────────────────────────────────────────────────────────────
  // atMs null on all three: the answer is authored server-side and its time is not
  // a column on this device (record.ts's KNOWN GAP). They sort last, which is also
  // where they belong.
  const signed = clean(input.signedBy);
  if (input.status === 'approved') {
    clauses.push(signed
      ? { k: 'r6c.cApprovedBy', p: { name: signed }, atMs: null }
      : { k: 'r6c.cApproved', atMs: null });
  } else if (input.status === 'declined') {
    clauses.push(signed
      ? { k: 'r6c.cDeclinedBy', p: { name: signed }, atMs: null }
      : { k: 'r6c.cDeclined', atMs: null });
  } else if (input.status === 'superseded') {
    clauses.push({ k: 'r6c.cSuperseded', atMs: null });
  }

  if (!clauses.length) return null;

  // Stamped ascending, unstamped last. Array#sort is stable, so two facts sharing a
  // millisecond keep the order they were emitted in above.
  const stamped = clauses.filter((c) => c.atMs !== null)
    .sort((a, b) => (a.atMs as number) - (b.atMs as number));
  const unstamped = clauses.filter((c) => c.atMs === null);

  return {
    clauses: [...stamped, ...unstamped],
    owed: owedAction(input, client, signed),
    traced: clauses.length,
  };
}

/**
 * What is owed, and by whom.
 *
 * This is the clause R6c exists for — R6b's AC says the same thing about the state
 * line: "names the next owed action, not just the status word". A terminal status
 * outranks an open question, matching extrastatus.displayStatus's precedence rule:
 * a client who asked at 9am and signed at 11am is approved, and telling the
 * contractor he owes an answer would contradict the signed instrument.
 */
function owedAction(
  input: SummaryInput, client: string | null, signed: string | null
): Owed {
  switch (input.status) {
    case 'approved':
      return signed
        ? { k: 'r6c.owedApprovedBy', p: { name: signed }, urgent: false }
        : { k: 'r6c.owedApproved', urgent: false };
    case 'declined':
      return { k: 'r6c.owedDeclined', urgent: false };
    case 'superseded':
      return { k: 'r6c.owedSuperseded', urgent: false };
    case 'draft':
      // Mandate #2 lives in this string: the owed action on a draft is a HUMAN
      // send. Nothing in this product may put a price in front of a client on its
      // own, so the instruction says to send it, and the summary is the last place
      // that would ever be automated.
      return { k: 'r6c.owedSend', urgent: false };
    default: {
      // 'sent', plus any status a newer build stored that this one does not know.
      // Falling back to the sent branch mirrors record.ts's stateLine, and is safe
      // for the same reason extrastatus gives: no affordance is gated on this
      // label, so an unknown status can be mislabelled here but never acted on.
      if (input.unanswered) {
        return client
          ? { k: 'r6c.owedAnswer', p: { name: client }, urgent: input.awaitingReply }
          : { k: 'r6c.owedAnswerPlain', urgent: input.awaitingReply };
      }
      return client
        ? { k: 'r6c.owedApproval', p: { name: client }, urgent: false }
        : { k: 'r6c.owedApprovalPlain', urgent: false };
    }
  }
}
