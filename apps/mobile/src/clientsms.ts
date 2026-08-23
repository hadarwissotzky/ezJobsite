/**
 * The text message that carries the approval link to the client.
 *
 * PURE, and importless, for the reasons `flowterms.ts` and `sendto.ts` give: this
 * decides the words a homeowner reads before they open a priced commitment, it is a
 * function of its inputs, and its test must run under `node --test`.
 *
 * ── WHAT THIS REPLACES, AND WHY IT IS NOT A COSMETIC CHANGE ─────────────────────
 * The one SMS path in the app sends `${shownContent}\n\n${url}` — the ENTIRE frozen
 * instrument as the message body. The 391 layout opens with an em dash, which does
 * not exist in GSM-7, so the whole message is encoded as UCS-2 at 67 characters per
 * concatenated segment. A one-line-scope instrument plus a Supabase Storage link
 * measures SEVEN chargeable segments (asserted in clientsms.test.ts, not estimated),
 * and it grows with the scope, the not-to-exceed clause and the flow terms — the
 * things that make an extra worth sending in the first place. Seven pieces is seven
 * chances for a handset to reassemble them out of order, or to show only some.
 *
 * The cost is the least of it. What actually arrives is a wall of contract text in a
 * message bubble, with the link — the only actionable thing in it — at the very
 * bottom, below the fold, after a price and a not-to-exceed clause the reader has no
 * way to act on from there. The person this product is built for (CLAUDE.md: "phones
 * and software are not second nature") reads the first line, does not scroll, and the
 * approval never gets opened. The contractor then believes he is being ignored.
 *
 * So the SMS's job is redefined here to the only job it can do well: say WHO is
 * asking, WHAT KIND of thing it is, WHAT IT COSTS, and give the link. The document
 * lives at the link, where it is rendered, where the photos and the discussion are,
 * and where the signature is collected.
 *
 * ── MANDATE #5 / REQ-LC40: EVERY FACT IN THIS MESSAGE IS CHECKED AGAINST THE
 *    FROZEN INSTRUMENT BEFORE IT IS USED ─────────────────────────────────────────
 * REQ-LC40 is the standing rule: if a fact appears to the approver — "on the approval
 * page, IN THE SMS/EMAIL BODY, or in a reminder" — and could bear on the decision to
 * approve, it must appear verbatim inside `shown_content`, which is the binding
 * instrument. An SMS that says "$1,850" for a document that says $1,500 is the
 * failure `240_shown_content_integrity.sql` exists to prevent, one channel further
 * out, where no trigger can see it.
 *
 * This module therefore takes the frozen text and includes a fact ONLY IF that fact's
 * exact rendering is present in it. A company name, a job label or a price that is
 * not literally in the instrument is OMITTED, never guessed at and never sent. A
 * shorter honest message beats a fuller one that can disagree with what is signed.
 *
 * The scope is deliberately NOT summarised into the SMS. Summarising means truncating
 * — "Replace rotted subfloor and rebuild the…" — and a truncated scope is not
 * verbatim, so REQ-LC40 forbids it and mandate #6's reasoning about numbers applies
 * to work descriptions too: a partial scope read out of its document is a different
 * scope. The link is the answer to "what is it", and it is two lines up.
 */

export type ClientSmsKind = 'confirm' | 'acknowledge' | 'ewa';

export type ClientSmsInput = {
  /** `confirmation_request.kind`. Decides which sentence describes the document. */
  kind: ClientSmsKind;
  /** The frozen instrument. Used ONLY to verify facts, never quoted into the body. */
  shownContent: string;
  /** The no-login portal URL, from `sendForConfirmation`. */
  url: string;
  /** As the contractor's profile holds it. Dropped unless it is in the instrument. */
  companyName?: string | null;
  /** The job label. Dropped unless it is in the instrument. */
  jobLabel?: string | null;
  /**
   * The price, ALREADY FORMATTED by `money()` in changeorder.ts.
   *
   * A string and not cents, for the reason `renderEwaCard` states at length: there is
   * ONE money formatter in this app, it lives next to the parser, and postgres
   * `to_char` has to agree with it literally. A second formatter here would be a
   * third thing to keep in step, on the number a client reads first.
   */
  amountText?: string | null;
};

/**
 * Is every character in the GSM-7 alphabet?
 *
 * WHY THIS IS IN A CONTRACT-CRITICAL FILE AND NOT A UTILITY. One character outside
 * this set re-encodes the WHOLE message as UCS-2, which cuts the per-segment budget
 * from 153 characters to 67 — so a single stray em dash more than doubles the number
 * of pieces the message is split into, and every extra piece is another chance for a
 * carrier to drop or reorder one. The wording below is written to stay inside this
 * set (plain hyphens, straight quotes, no middot, no ellipsis character), and the
 * test asserts it, because "we used a hyphen" is the kind of thing a later copy edit
 * silently undoes.
 */
const GSM7_BASE =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** Each of these costs TWO septets, not one — they are escape sequences. */
const GSM7_EXTENDED = '^{}\\[~]|€';

export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (GSM7_BASE.indexOf(ch) === -1 && GSM7_EXTENDED.indexOf(ch) === -1) return false;
  }
  return true;
}

/**
 * How many SMS segments this body costs, by the same arithmetic the carrier uses.
 *
 * Exported so the test can assert a budget rather than eyeball the length, and so a
 * caller can show the contractor the real number if that is ever wanted. The
 * concatenation headers are why the multi-segment sizes are 153 and 67 rather than
 * 160 and 70: the User Data Header eats the difference out of every segment,
 * including the first.
 */
export function smsSegments(text: string): number {
  if (isGsm7(text)) {
    let septets = 0;
    for (const ch of text) septets += GSM7_EXTENDED.indexOf(ch) === -1 ? 1 : 2;
    return septets <= 160 ? 1 : Math.ceil(septets / 153);
  }
  // UCS-2. Surrogate pairs cost two units, which `.length` already counts correctly.
  return text.length <= 70 ? 1 : Math.ceil(text.length / 67);
}

/**
 * Is this fact literally in the frozen instrument?
 *
 * Whitespace-insensitive on purpose, and ONLY on whitespace. `renderCard` joins its
 * lines with '\n' and a job label sitting at a line break would otherwise read as
 * absent; but any other difference — a different figure, a different company, a
 * trailing word — is a real difference and must fail. This is deliberately weaker
 * than `240_shown_content_integrity.sql`'s literal check, which runs in the database
 * against the send itself; this one is a second gate on a second channel, and where
 * they disagree the database's is the one that decides.
 */
function inInstrument(shownContent: string, fact: string | null | undefined): boolean {
  const f = (fact ?? '').trim();
  if (!f) return false;
  const flat = (s: string) => s.replace(/\s+/g, ' ');
  return flat(shownContent).includes(flat(f));
}

/**
 * The message.
 *
 * SHAPE, and every line of it is doing a job:
 *
 *   <who> sent you a change order to approve - $1,850.00.     <- who, what, how much
 *   Job: 1151 Stanyan St                                       <- which house
 *                                                              (blank line)
 *   Open it here. No app or account needed:                    <- what to do
 *   https://.../confirm.html?t=...                             <- the only tappable
 *                                                              (blank line)
 *   Nothing proceeds until you approve.                        <- what is at stake
 *
 * The last line is not reassurance, it is the operative term, and it is copied out of
 * the priced instrument's own closing sentence — so it is verbatim by construction
 * and REQ-LC40 is satisfied without a check. It is omitted for an EWA, where it would
 * be a LIE: on a T&M-capped authorization work proceeds precisely BECAUSE it was
 * approved, which is the whole reason `ewa.ts` refuses to reuse that sentence.
 *
 * There is no greeting and no sign-off. Both cost segments, neither tells the reader
 * anything, and a text from a contractor that opens "Dear valued customer" reads as
 * marketing — which is the one thing that gets a link left untapped.
 */
export function clientSmsBody(o: ClientSmsInput): string {
  const shown = o.shownContent ?? '';
  const who = inInstrument(shown, o.companyName)
    ? (o.companyName as string).trim()
    : 'Your contractor';

  // A price is only named when it is a priced document AND the exact rendering is in
  // the instrument. `240` already refuses to create a send whose displayed figure is
  // absent from the frozen text, so a failure here means the two disagree — and the
  // right response to that is to send the client to the document, not to pick one.
  const priced = o.kind === 'confirm' && inInstrument(shown, o.amountText);
  const amount = priced ? ` - ${(o.amountText as string).trim()}` : '';

  const what =
    o.kind === 'ewa'
      ? `${who} sent you an extra work authorization to review and sign${amount}.`
      : o.kind === 'acknowledge'
      ? `${who} asked you to acknowledge something on your job.`
      : priced
      ? `${who} sent you a change order to approve${amount}.`
      // A confirm with no price is a Decision (R10): a spec to agree, no money.
      : `${who} sent you something to check and confirm.`;

  const job = inInstrument(shown, o.jobLabel) ? `\nJob: ${(o.jobLabel as string).trim()}` : '';

  // "No app or account needed" is REQ-VAL3 said out loud, and it is in the SMS rather
  // than only on the page because it answers the objection that stops the tap. The
  // reader's question at this moment is not "what is this" — it is "is this going to
  // make me sign up for something".
  const cta = `\n\nOpen it here. No app or account needed:\n${o.url}`;

  const closing = o.kind === 'ewa' || !priced
    ? ''
    : '\n\nNothing proceeds until you approve.';

  /**
   * OPT-OUT, ON EVERY MESSAGE (A2P 10DLC, 2026-08-19).
   *
   * The campaign was rejected on 30909 — the reviewer could not verify the Call to
   * Action. Carriers look for opt-out instructions in the message itself, not only in the
   * program description, and a campaign that is registered but rejected sends NOTHING:
   * this app's entire delivery path is dark until it passes.
   *
   * STOP is handled by the carrier and by Twilio automatically; the words are what a
   * reviewer and a recipient can both see. GSM-7 only — no em dash, no curly quote —
   * because a single non-GSM character re-encodes the whole body as UCS-2 and cuts the
   * per-segment budget from 153 to 67 (see the header). Asserted in clientsms.test.ts,
   * not assumed: this line must not push a real message past two segments.
   */
  // STOP and HELP together: carriers check for both, and at 295 characters a real priced
  // message is STILL two segments (measured against the 306 ceiling, not estimated).
  // 11 characters of headroom left — anything further added here costs a third segment.
  const stop = '\nReply STOP to opt out. HELP for help.';

  /**
   * THE BUDGET IS ENFORCED, NOT HOPED FOR.
   *
   * `who` (company name), `jobLabel` (job address) and `amountText` are all
   * caller-supplied and unbounded, while the only guard was a unit test against ONE
   * fixture at 295 of 306 characters. A company name a dozen characters longer than
   * the fixture silently cost a third segment on every client message — 50% more per
   * send, invisibly, and discovered on an invoice (review, 2026-08-21).
   *
   * The JOB LINE is what gives, and that choice is deliberate. Everything else is
   * load-bearing: the sender's name is who the client trusts, the amount is the thing
   * being approved, the URL is the whole point, and the opt-out is what keeps the A2P
   * campaign alive. The job is context the page repeats in full a tap away, so it is
   * the one line that can lose its tail without costing the reader anything.
   */
  const body = `${what}${job}${cta}${closing}${stop}`;
  if (smsSegments(body) <= 2 || !job) return body;

  /**
   * Trim the job line until it fits, with three PERIODS and not an ellipsis character
   * (code review, 2026-08-23).
   *
   * `…` is outside GSM-7 — the very thing the header 150 lines up warns about, and the
   * warning even names "no ellipsis character". One of them re-encodes the whole body
   * as UCS-2 at 67 characters a segment, so every candidate built here came back at 4+
   * segments, the loop could never return, and the fall-through dropped the job line
   * every single time. The feature has never once worked: a client got no job line on
   * exactly the messages where a trimmed one would have fitted.
   *
   * Bounded by construction: `label` only ever shrinks.
   */
  let label = (o.jobLabel as string).trim();
  while (label.length > 8) {
    label = label.slice(0, -6);
    const shorter = `${what}
Job: ${label}...${cta}${closing}${stop}`;
    if (smsSegments(shorter) <= 2) return shorter;
  }
  // Nothing left to give: drop the job line entirely rather than send three segments.
  return `${what}${cta}${closing}${stop}`;
}

/**
 * The message that tells a client the contractor answered their question.
 *
 * The gap it exists for: the client asks something in the portal, the contractor
 * replies from the app, and the client — who has no account, no app and no push — is
 * never told. Their only route back is the original text message, which they have no
 * reason to re-open. The portal now polls while it is on screen, but nobody leaves an
 * approval page open for a day.
 *
 * THE REPLY'S TEXT IS NOT QUOTED. Two reasons, and the second is the binding one:
 * a reply routinely contains the negotiation ("I can do it for 1,500 if we skip the
 * trim"), and a number that reaches a client OUTSIDE the instrument is exactly what
 * mandate #6 and REQ-LC40 forbid — read in a message bubble it looks like an offer,
 * and an offer read as agreed is the dispute this product exists to prevent. R5b says
 * the same thing from the other end: "price changes resolve only through revision +
 * fresh approval, never through thread agreement". So the SMS says a reply exists and
 * sends them to the page, where the reply sits under the document it is about.
 *
 * NOT WIRED YET — see docs/CLIENT-PORTAL.md §"Owed". It is written and tested here
 * because the wording is the part that carries the risk, and because the send site
 * (`drainR5bOutbox`) has no way to reach the client until `destination` is recorded
 * on `confirmation_request`.
 */
export function replyNoticeSmsBody(o: {
  companyName?: string | null;
  url: string;
}): string {
  const who = (o.companyName ?? '').trim() || 'Your contractor';
  return `${who} replied to your question.` +
    `\n\nRead it and approve or decline here:\n${o.url}`;
}
