/**
 * The "fill what's missing" answers, as the sentences a client signs.
 * FLOW-SIMPLEST-JOBSITE.md phase 2, over the columns 375_flow_fields.sql added.
 *
 * WHY THIS IS ITS OWN FILE RATHER THAN A HELPER INSIDE ONE OF ITS TWO CALLERS.
 * TWO instruments carry these terms: the priced approval (`renderCard`,
 * confirmations.ts) and the Extra Work Authorization (`renderEwaCard`, ewa.ts).
 * Both are rendered once, hashed and frozen at send, so a second copy of these
 * sentences is a second contract wording — free to drift from the first, silently,
 * and discovered only in the dispute the frozen text exists to settle.
 * confirmations.ts already documents what that costs in this exact file pair: a
 * duplicated money formatter rendered a credit as a charge, into shown_content.
 * One wording, one file, and a change to a signed sentence is one edit.
 *
 * It cannot live in either caller. confirmations.ts imports @supabase; ewa.ts is
 * deliberately import-free so `node --test` can run it with no runner. Whichever
 * imported the other would lose the property it was given on purpose. So this file
 * imports nothing either, and both sides import it.
 *
 * SILENCE IS THE DEFAULT, and it is load-bearing twice over.
 *   1. An extra authored before 375 carries four nulls and must render the EXACT
 *      instrument it always did — a byte-identical string, not a document with
 *      empty headings. That is what makes this safe against records already signed
 *      and already in the field.
 *   2. An unrecognised value renders NOTHING rather than a guessed sentence. A
 *      wrong term in a signed document is worse than an absent one, because the
 *      absent one is visibly absent.
 */

export type FlowTerms = {
  /** 375: next_invoice | when_completed | other. Null until the contractor answers. */
  billingTiming?: string | null;
  /** 375: no_change | adds_days | not_sure. */
  scheduleEffect?: string | null;
  /** Only meaningful with adds_days. */
  scheduleDays?: number | null;
  /** Free text, optional by design — most extras exclude nothing worth stating. */
  exclusions?: string | null;
};

/**
 * The terms block: zero or more complete sentences, each ending in a newline, and
 * the empty string when the contractor answered nothing. The caller decides where
 * it sits in the document; it never decides its own spacing, so an empty block
 * leaves the surrounding text unchanged character for character.
 *
 * These are TERMS worded for the person signing, not labels for a database. They
 * are plain English on purpose (mandate #5 keeps the instrument English-canonical;
 * display language is a separate concern handled by t() in the UI).
 *
 * 240_shown_content_integrity.sql is unaffected by design: it recomputes the hash
 * over whatever text it is given and checks that the money figures appear
 * LITERALLY. These lines are prose and add no figure the trigger looks for, and
 * they are appended beside the price/cap clauses rather than replacing them, so
 * the figures it does look for are still there.
 */
export function flowTermLines(o: FlowTerms): string {
  // Exclusions first: what is NOT covered bounds everything stated after it, and
  // the mock's review card puts NOT INCLUDED above the payment and schedule rows.
  const excluded = o.exclusions?.trim() ? `Not included: ${o.exclusions.trim()}\n` : '';
  const billing = o.billingTiming === 'next_invoice' ? 'Billed on the next invoice.\n'
    : o.billingTiming === 'when_completed' ? 'Payment is due when the work is completed.\n'
    : o.billingTiming === 'other' ? 'Payment timing as discussed.\n' : '';
  // Decision 3 (hadar, 2026-07-23): "not sure yet" is a legal answer and is shown
  // to the client as an open question, not hidden and not dressed up as no impact.
  // Hiding it would let a client read the silence as "this does not delay my job".
  const schedule = o.scheduleEffect === 'no_change' ? 'Schedule: no change.\n'
    : o.scheduleEffect === 'adds_days'
      ? (typeof o.scheduleDays === 'number' && o.scheduleDays > 0
          ? `Schedule: adds ${o.scheduleDays} day${o.scheduleDays === 1 ? '' : 's'}.\n`
          : 'Schedule: adds days.\n')
    : o.scheduleEffect === 'not_sure' ? 'Schedule impact: to be confirmed.\n' : '';
  return excluded + billing + schedule;
}
