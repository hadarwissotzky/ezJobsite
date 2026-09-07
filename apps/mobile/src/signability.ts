/**
 * SIGNABILITY — the backend determination for the single-line change order.
 *
 * hadar, 2026-09-06 (SPEC-single-line-co-v1 D6): "if enough information was given in
 * the first pass, no need to complicate the process — it's a balance of simple
 * process and successful signage, so during the AI process (backend) evaluate the co
 * and make that determination." This file IS that determination. It looks at what
 * the extraction produced and answers ONE question: does this change order need a
 * gap interview before it goes out, and about what — or is it already complete, in
 * which case the contractor sees NOTHING new.
 *
 * DETERMINISTIC ON PURPOSE. The model classifies the transcript into segments,
 * terms and exclusions (structure.ts); every judgement HERE is plain code over that
 * output, so the same extraction always yields the same questions and a fixture
 * suite can prove it (the generated one-line COs in signability.test.ts). The model
 * never decides what is missing — that is how invented content gets in.
 *
 * NO IMPORTS, like money.ts and for the same reason: this must stay loadable by the
 * React Native bundle and by `node --experimental-strip-types`, and it will be
 * vendored into apps/worker when the pipeline wires it in (Render builds with
 * rootDir: apps/worker, so a cross-app import would break the deploy).
 *
 * CAPPED AT THREE. Mandate #3's spirit: the interview must never become a form. The
 * order below is severity order — a money contradiction outranks an open-ended
 * cost, which outranks a missing term — and anything past three waits for the next
 * version of this design rather than burdening this send.
 */

export type SignabilityGap =
  /** A priced line INSIDE the total is also described as billed IN ADDITION — the
   *  document contradicts itself about money, the one thing a client checks. */
  | { kind: 'fee_conflict'; about: string }
  /** A segment was priced in words that carry no figure ("at cost", "whatever the
   *  material runs") — an unbounded clause nobody signs. Ask for a ballpark. */
  | { kind: 'open_cost'; about: string }
  /** Payment timing was never addressed. */
  | { kind: 'no_billing'; about: null }
  /** The schedule was never addressed (null — distinct from an explicit not_sure,
   *  which IS an answer and raises no gap). */
  | { kind: 'no_schedule'; about: null };

export type Signability = {
  /** True = the simple path: the first pass said enough, show nothing new. */
  complete: boolean;
  /** At most three, severity-ordered. Empty iff complete. */
  gaps: SignabilityGap[];
};

export type SignabilityInput = {
  /** Parsed line items (title + cents), from the same breakdown the total was
   *  summed from. Empty when the job was priced as one figure. */
  lineItems: readonly { title: string; cents: number }[];
  /** Segments whose price WORDS exist but parse to no figure — the caller derives
   *  this with parseMoney over each segment's price span, so the judgement of
   *  "unparseable" lives in the one money parser (mandate #6). */
  openEndedTitles: readonly string[];
  /** The write-up's exclusion sentences (English canonical — the evaluator runs on
   *  the canonical copy, mandate #5). */
  excluded: readonly string[];
  billingTiming: string | null;
  scheduleEffect: string | null;
};

/** Words too common to signal that an exclusion and a line item share a subject. */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'which', 'that', 'this', 'are', 'was', 'will',
  'billed', 'charged', 'addition', 'additional', 'installation', 'work', 'cost',
  'costs', 'fees', 'fee', 'material', 'materials',
]);

function subjectWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w)));
}

/**
 * A line item that is INSIDE the total, whose subject an exclusion sentence claims
 * is billed IN ADDITION. Both halves are required:
 *   · the "in addition" phrasing — a shared subject alone is legitimate (the
 *     baseboard INSTALL can be a line item while the baseboard MATERIAL is
 *     excluded; that pair is the open_cost gap, not a contradiction);
 *   · a shared subject word — an "in addition" sentence about something never
 *     priced is a normal exclusion.
 * This is the exact shape CO #5 shipped with: $600 trash fees summed into $5,600
 * AND "trash and ecology disposal fees ... charged in addition to the installation".
 */
function feeConflicts(
  lineItems: readonly { title: string; cents: number }[],
  excluded: readonly string[],
): string[] {
  const out: string[] = [];
  const inAddition = excluded.filter((e) => /\bin addition\b|\bon top of\b/i.test(e));
  for (const li of lineItems) {
    const subj = subjectWords(li.title);
    if (subj.size === 0) continue;
    for (const ex of inAddition) {
      const exWords = subjectWords(ex);
      let shared = 0;
      for (const w of subj) if (exWords.has(w)) shared++;
      if (shared > 0) { out.push(li.title); break; }
    }
  }
  return out;
}

export function evaluateSignability(x: SignabilityInput): Signability {
  const gaps: SignabilityGap[] = [];

  for (const about of feeConflicts(x.lineItems, x.excluded)) {
    gaps.push({ kind: 'fee_conflict', about });
  }
  for (const about of x.openEndedTitles) {
    gaps.push({ kind: 'open_cost', about });
  }
  if (x.billingTiming === null) gaps.push({ kind: 'no_billing', about: null });
  // `not_sure` and `no_change` are ANSWERS — only silence is a gap.
  if (x.scheduleEffect === null) gaps.push({ kind: 'no_schedule', about: null });

  return { complete: gaps.length === 0, gaps: gaps.slice(0, 3) };
}
