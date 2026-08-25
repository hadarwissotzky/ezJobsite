/**
 * R2 — the price and the price mode, read out of what was actually SAID.
 *
 * THE BUG THIS FILE EXISTS TO FIX. R2's first AC is "given a voice note containing
 * scope and a dollar amount, scope AND amount are pre-filled". Scope was; the amount
 * never was, and could not be: the priced card ran `parseMoney(d.current_value)` —
 * the DECISION text — while the structuring prompt forbids the model from putting any
 * figure into that field ("DO NOT extract prices... Never mention a figure",
 * worker.mjs). So the parser was pointed at a string guaranteed by construction to
 * contain no money, and returned confidence 'none' every single time. The money that
 * WAS heard sat unused in `capture_structured.from_transcript`. This module reads the
 * transcript instead.
 *
 * PURE. No imports, no clock, no I/O — same reason as `approverrouting.ts`: this
 * decides what number appears under a contractor's thumb next to a Send button, it is
 * the part of R2 that can be wrong in a way nobody notices, and `node --test` can only
 * run a file that resolves nothing.
 *
 * THE MONEY PARSER IS INJECTED, NOT REIMPLEMENTED. `parseMoney` lives in
 * changeorder.ts, which imports Supabase and PowerSync and therefore cannot be
 * imported here. The obvious alternative — copy the regex — is exactly the drift the
 * worker's comment warns about ("there is ONE money parser in the product and it
 * cannot drift from itself"): two parsers means a device and a server can disagree
 * about what a man said, and the disagreement surfaces in a dispute. So the caller
 * passes the real `parseMoney` and the tests pass a stub that honours the same
 * contract. Rejected: re-exporting a shared regex constant, which would still be two
 * call sites able to fall out of step on the surrounding logic.
 *
 * MANDATE #6 IS NOT RELAXED BY ANY OF THIS. A figure only ever becomes a PREFILL —
 * a value shown big, on an editable field, that a human must read back and confirm
 * before `createChangeOrder` will accept it. Nothing here sends anything, and a
 * reading that is anything less than unambiguous prefills NOTHING and says why.
 */

// ─── the contract with the one money parser ────────────────────────────────────
// Structurally identical to `ParsedMoney` in changeorder.ts. Restated (not imported)
// because importing it would drag Supabase into a pure module; if that type ever
// changes, `npx tsc --noEmit` fails at the App.tsx call site, which is the point.
export type MoneyReading = {
  cents: number | null;
  confidence: 'high' | 'low' | 'none';
  matched?: string;
};
export type MoneyParser = (text: string) => MoneyReading;

/**
 * R3 names exactly two one-step modes and forbids a third: "a bare range is never
 * offered — range approvals reproduce the dispute at billing time". So this is a
 * closed pair, not an open string. The app previously had no mode at all: NTE was an
 * optional free-text box labelled "Not to exceed (optional)", which meant the mode was
 * whatever the sender happened to type, and R3's mandatory NTE clause had nothing
 * reliable to key off.
 */
export type PriceMode = 'fixed' | 'nte';

export type VoicePriceReading = {
  /** Cents, but ONLY when exactly one unambiguous currency figure was spoken. */
  amountCents: number | null;
  /**
   * May the price field be pre-filled with `amountCents`? True only for a single
   * high-confidence figure. Two figures, a bare spoken number, or silence all leave
   * the field EMPTY — R2's second AC: "empty and flagged, never guessed".
   */
  prefill: boolean;
  /** The suggested mode. A SUGGESTION: the picker is shown and the human owns it. */
  mode: PriceMode;
  /** False means 'fixed' is this module's default, not something anybody said. */
  modeHeard: boolean;
  /** The clause the figure came from, verbatim, for the read-back. */
  heard: string | null;
  /** Always set. The contractor is told what happened, in his language. */
  reasonKey: string;
  reasonParams: Record<string, string | number>;
  /**
   * PER-SEGMENT PRICES, when the work was quoted in parts (hadar, 2026-08-21: "it
   * doesn't add cost of multiple projects into a total … in the scope we can display
   * a breakdown cost by segment, if given, but the total and the extraction must be a
   * total").
   *
   * Present only when more than one segment carried a price. Empty for the ordinary
   * one-figure case, so nothing changes for the common path.
   *
   * The ORDER IS THE ORDER THE WORK WAS DESCRIBED IN — the model returns tasks in the
   * sequence they happen, and this preserves it. A homeowner reading "kitchen, then
   * hall, then the make-good" is following the job; the same three lines sorted by
   * price are a quote, not a plan.
   */
  breakdown: Array<{ title: string; cents: number; heard: string }>;
};

/**
 * Phrases that turn a figure into a CAP rather than a price.
 *
 * Each one is only ever consulted for a clause that already contains a currency
 * figure, which is what makes the weak members safe: "up to" alone is "up to code",
 * "hasta" alone is "hasta el jueves" — neither carries money, so neither is ever
 * looked at. Accents are stripped before matching, so 'maximo' catches "máximo".
 */
/**
 * Spoken number words, for the leftover check above. Not a parser — a DETECTOR: its
 * only job is to notice that a price span still contains a number the money parser did
 * not account for. English and Spanish, because the transcript may be either.
 */
const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|teen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|grand|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|treinta|cuarenta|cincuenta|cien|ciento|mil)\b/;

/**
 * PHRASES THAT REPLACE THE FIGURE BEFORE THEM.
 *
 * hadar, 2026-08-25: "you need to protect from a case where the user change their mind
 * during the transcription -- 'initially the price would be $500', later 'the price
 * will actually be $600' -- we need to identify these changes and extract the correct
 * one."
 *
 * A man talking through a job out loud CORRECTS HIMSELF. That is not ambiguity, it is
 * the most ordinary thing in a recording, and the two-figure refusal treated it as the
 * worst case: he states a price, thinks again, states the real one — and the app,
 * seeing two numbers, hands him an empty box. The one shape most likely to appear in
 * real speech got the least help.
 *
 * A CORRECTION IS DIRECTIONAL, which is what makes it safe to act on where a bare
 * second figure is not. "$400 for the demo and $900 for the tile" is two prices for two
 * things and must still refuse. "$500... actually $600" is one price, said twice, and
 * the second one wins — he said so.
 *
 * Kept deliberately narrow, and matched only in the clause of the LATER figure: a cue
 * that fires loosely turns two legitimate prices into a silent overwrite of the first.
 */
const CORRECTION_CUES = [
  'actually', 'correction', 'i meant', 'i mean', 'make that', 'make it',
  'scratch that', 'strike that', 'let me correct', 'let me redo', 'no wait', 'wait no',
  'on second thought', 'second thought', 'change that to', 'changed my mind',
  'instead of', 'rather than that', 'sorry, ', 'sorry it', 'sorry the',
  "let's say", 'lets say', 'revised to', 'update that to', 'now it is', 'now its',
  // es-419, same register as i18n.ts.
  'en realidad', 'mejor dicho', 'perdon', 'quise decir', 'cambio', 'que sean',
];

/** Does this clause announce that it REPLACES an earlier figure? */
function saysCorrection(clause: string): boolean {
  const f = fold(clause);
  return CORRECTION_CUES.some((c) => f.includes(c));
}

const NTE_CUES = [
  'not to exceed', 'not exceed', 'no more than', 'no higher than', 'not over',
  'up to', 'cap at', 'capped at', 'cap of', 'max of', 'maximum',
  "won't go over", 'wont go over', "won't exceed", 'wont exceed', 'ceiling of',
  // es-419. The register is the same as i18n.ts: plain, present tense, Latin American.
  'no mas de', 'hasta', 'maximo', 'tope de', 'sin pasar de', 'no pasar de',
];

/** Lowercase + de-accent. `normalize` is a language builtin, not an import. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Sentence-ish clauses.
 *
 * Deliberately splits ONLY on hard terminators, never on "and". Splitting on "and"
 * would tear "time and materials, not to exceed $800" apart and orphan the cue from
 * its figure — and the cost of under-splitting is merely that two figures land in one
 * clause, which this module already treats as ambiguous and refuses to prefill. The
 * conservative failure is the one that makes a man type the number.
 */
function clauses(text: string): string[] {
  return text.split(/[.!?;\n]+/).map((c) => c.trim()).filter(Boolean);
}

type Found = { cents: number; matched: string; clause: string; nte: boolean };

/**
 * Every currency figure in a clause, not just the first.
 *
 * `parseMoney` returns one match, so this walks: parse, cut the matched text out,
 * parse the remainder. Two figures in one breath ("$450 for the outlets and $200 for
 * the trim") is the case that MUST be seen — prefilling the first would put the wrong
 * price under the Send button, which is mandate #6's named failure.
 */
function figuresIn(clause: string, parse: MoneyParser): MoneyReading[] {
  const out: MoneyReading[] = [];
  let rest = clause;
  for (let i = 0; i < 8; i++) {         // a clause with 9 prices is not a clause
    const r = parse(rest);
    if (r.cents === null) break;
    out.push(r);
    if (!r.matched) break;              // no way to advance; stop rather than loop
    const at = rest.indexOf(r.matched);
    if (at < 0) break;
    rest = rest.slice(at + r.matched.length);
  }
  return out;
}

const EMPTY: VoicePriceReading = {
  amountCents: null, prefill: false, mode: 'fixed', modeHeard: false, heard: null,
  reasonKey: 'r2.priceNoneHeard', reasonParams: {}, breakdown: [],
};

/**
 * What the recording says the price is — or, far more often, that it doesn't.
 *
 * @param transcript the raw words (`capture_structured.from_transcript`)
 * @param parse      the app's ONE money parser, injected (see file header)
 */
export function extractPrice(transcript: string, parse: MoneyParser): VoicePriceReading {
  if (!transcript || !transcript.trim()) return EMPTY;

  const found: Found[] = [];
  let softest: { reading: MoneyReading; clause: string } | null = null;

  for (const clause of clauses(transcript)) {
    const folded = fold(clause);
    const nte = NTE_CUES.some((cue) => folded.includes(cue));
    for (const r of figuresIn(clause, parse)) {
      if (r.confidence === 'high' && r.cents !== null) {
        found.push({ cents: r.cents, matched: r.matched ?? '', clause, nte });
      } else if (r.confidence === 'low' && !softest) {
        // Remembered only to TELL him a number went by. Never to fill a field:
        // "four fifty" is the input that made gpt-4o-mini invent $450, and the
        // parser refusing it is the reason that class of error is not in the product.
        softest = { reading: r, clause };
      }
    }
  }

  if (found.length === 1) {
    const f = found[0];
    return {
      amountCents: f.cents,
      prefill: true,
      mode: f.nte ? 'nte' : 'fixed',
      modeHeard: f.nte,
      heard: f.clause,
      reasonKey: f.nte ? 'r2.priceHeardNte' : 'r2.priceHeardFixed', breakdown: [],
      reasonParams: {},
    };
  }

  /**
   * HE CHANGED HIS MIND — take the figure he changed it TO [2026-08-25].
   *
   * Only when the LAST figure's own clause announces the correction. Checking the last
   * one specifically is what keeps this narrow: a cue anywhere in a long recording would
   * let "actually, the tiles are his" silently overwrite a legitimate first price twenty
   * seconds earlier.
   *
   * It reports itself as a correction (`reasonKey`) carrying BOTH numbers, so the
   * read-back mandate #6 requires says what was dropped as well as what was kept. A
   * price that quietly replaced another is the one thing worse here than no price.
   */
  if (found.length > 1) {
    const last = found[found.length - 1];
    const prior = found[found.length - 2];
    if (saysCorrection(last.clause)) {
      return {
        amountCents: last.cents,
        prefill: true,
        mode: last.nte ? 'nte' : 'fixed',
        modeHeard: last.nte,
        heard: last.clause,
        reasonKey: 'r2.priceCorrected',
        reasonParams: { from: prior.matched ?? '', to: last.matched ?? '' },
        breakdown: [],
      };
    }
  }

  if (found.length > 1) {
    /**
     * TWO OR MORE FIGURES AND NO CORRECTION: PREFILL NOTHING, AND SAY SO.
     *
     * The tempting rule — "if one of them sits in an NTE clause, that one is the cap
     * and the other is the price" — is rejected on purpose. It resolves the real T&M
     * shape ("$95 an hour, not to exceed $2,000") correctly and resolves a two-item
     * extra ("$450 for outlets, $200 for trim") into a fabricated cap. Getting the
     * rate and the cap the wrong way round is precisely the highest-risk error
     * mandate #6 is written about, and no heuristic here can tell the two apart from
     * the words alone. Handing him both figures and an empty box costs one typed
     * number. Guessing costs an approval for the wrong amount.
     */
    return {
      amountCents: null, prefill: false,
      mode: found.some((f) => f.nte) ? 'nte' : 'fixed',
      modeHeard: false,
      heard: found.map((f) => f.matched).filter(Boolean).join(' · ') || null,
      reasonKey: 'r2.priceAmbiguous', breakdown: [],
      reasonParams: { n: found.length },
    };
  }

  if (softest) {
    return {
      amountCents: null, prefill: false, mode: 'fixed', modeHeard: false,
      heard: softest.clause,
      reasonKey: 'r2.priceUnclear', reasonParams: {}, breakdown: [],
    };
  }

  return EMPTY;
}

/**
 * The price read from the AI's ISOLATED price phrase (structure step's `price_words`),
 * not from the whole transcript.
 *
 * WHY THIS EXISTS. `extractPrice` scans the raw words and cannot tell which figure is
 * the price when more than one number is spoken — "$450 for the outlets and $200 for
 * the trim" is two equal figures to it, and it correctly refuses to guess. The AI
 * already made that judgment per task: `price_words` is the span it tagged as THE
 * price. Feeding that span (not a whole transcript) to the same `parseMoney` turns a
 * refusal into a prefill on the common case the user actually hits — "ten hours,
 * $1,500" prefilling nothing was the bug (hadar, 2026-07-23: "fixed price should have
 * been extracted from the transcription via ai").
 *
 * MANDATE #6 IS NOT RELAXED. The model chose the PHRASE; the app's one `parseMoney`
 * makes the number; it is a flagged prefill a human reads back before anything sends.
 * A phrase `parseMoney` cannot resolve high-confidence prefills NOTHING. Two tasks
 * that each carry a clean price stay ambiguous — a single fixed-price field cannot
 * honestly hold two, so it shows both and fills neither, exactly as `extractPrice` does.
 *
 * Returns `null` (not `EMPTY`) when NO task carried a parseable price, so the caller
 * knows to fall back to the transcript scan rather than treating "AI found no price"
 * as "no price heard".
 */
export function priceFromTasks(
  tasks: { priceWords: string | null; scope: string; title: string }[],
  parse: MoneyParser
): VoicePriceReading | null {
  const hits: { cents: number; nte: boolean; heard: string; title: string }[] = [];
  /** Segments whose price span carries more number than the parser could account for. */
  const unreadable: { title: string; heard: string }[] = [];
  for (const t of tasks) {
    if (!t.priceWords) continue;
    // A task's price_words is one price span; still walk it in case the model tagged
    // "$95/hr up to $2,000" — two figures there is genuinely a cap, but two DISTINCT
    // clean figures we cannot safely reduce, so we drop the whole task rather than pick.
    const figs = figuresIn(t.priceWords, parse).filter((f) => f.confidence === 'high' && f.cents !== null);
    /**
     * A PRICE HE SAID THAT WE COULD NOT READ IS NOT A SEGMENT WITHOUT A PRICE.
     *
     * hadar, 2026-08-23, on a real recording: "extraction was incorrect as well, we
     * cannot miss that". He priced three of four segments out loud — "$500 plus all the
     * disposal fees", "That will be $500", "It will be 750 probably" — and the app
     * offered $1,000. The third vanished with no trace: he said "750" without a
     * currency marker, `parseMoney` correctly refuses that as anything better than LOW
     * confidence (mandate #6 — a bare number might be a price), the high-confidence
     * filter emptied `figs`, and this was a bare `continue`.
     *
     * So the poisoning rule twenty lines below — "the sum of the parts we CAN read is
     * not the price of the job... showing it with one segment silently missing is worse
     * than showing nothing" — never fired, because nothing recorded that a segment had
     * been missed. The total looked complete, arrived with a checkable breakdown, and
     * was $750 short.
     *
     * THE TEST IS WHETHER THE SPAN CARRIES A NUMBER AT ALL. A `price_words` of "no
     * charge" or "included in the base" claims no money and must stay silent — marking
     * that unreadable would poison a total over a segment that is genuinely free. One
     * that holds a digit or a spoken number word is a price claim we failed to reduce,
     * and it belongs in `unreadable` whether that is because the figure was ambiguous
     * (`> 1`) or because it was never confident enough to use (`0`).
     */
    if (figs.length !== 1) {
      if (/\d/.test(t.priceWords) || NUMBER_WORDS.test(fold(t.priceWords))) {
        unreadable.push({ title: t.title, heard: t.priceWords });
      }
      continue;
    }
    /**
     * IS THERE MONEY LEFT OVER IN THE SPAN THE PARSER DID NOT READ?
     *
     * Found on a REAL transcript, 2026-08-21. The contractor said "fourteen hundred";
     * Deepgram wrote "4 teen $100"; `parseMoney` reads "$100" with HIGH confidence and
     * is not wrong to — "$100" is a dollar figure. The segment's true price was $1,400,
     * and summing three segments produced $2,050 against a real total of $3,350.
     *
     * A single figure being confidently misread is survivable when the contractor sees
     * it beside its own words and says "that's not right". It is NOT survivable inside
     * a SUM, because the sum hides which part is wrong and reads as arithmetic rather
     * than as a reading. Adding numbers together raises the bar on each one.
     *
     * So: strip what was matched, and if the remainder still carries a number — a
     * numeral or a spoken number word — this span is not clean enough to add up.
     * "about $850" leaves "about" and is fine. "4 teen $100" leaves "4 teen" and is
     * not. The segment keeps its verbatim words for the read-back; it just stops being
     * arithmetic the app is willing to do on his behalf.
     */
    const leftover = t.priceWords.replace(figs[0].matched ?? '', ' ');
    if (/\d/.test(leftover) || NUMBER_WORDS.test(fold(leftover))) {
      unreadable.push({ title: t.title, heard: t.priceWords });
      continue;
    }
    const nte = NTE_CUES.some((cue) => fold(`${t.priceWords} ${t.scope}`).includes(cue));
    hits.push({ cents: figs[0].cents as number, nte, heard: t.priceWords, title: t.title });
  }
  if (hits.length === 0) return null;
  /**
   * THE POISON CHECK HAS TO COME BEFORE THE SINGLE-HIT SHORTCUT.
   *
   * Found by the firewall test, 2026-08-23, while fixing the bug above it. The
   * shortcut returned one clean segment as a confident `prefill: true` WITHOUT ever
   * looking at `unreadable` — so a walk with one readable price and one the parser
   * could not reduce offered the readable one as if it were the price of the job. That
   * is precisely the failure the comment below this describes and refuses for the
   * multi-segment case: "the sum of the parts we CAN read is not the price of the job —
   * it is the price of some of the job, and it looks exactly like the price of all of
   * it." One part is no different from three.
   *
   * So the check moved up. `hits.length === 1` with nothing unreadable still takes the
   * shortcut and still reads back as a single heard price, unchanged.
   */
  if (!unreadable.length && hits.length === 1) {
    const h = hits[0];
    return {
      amountCents: h.cents, prefill: true,
      mode: h.nte ? 'nte' : 'fixed', modeHeard: h.nte, heard: h.heard,
      reasonKey: h.nte ? 'r2.priceHeardNte' : 'r2.priceHeardFixed', reasonParams: {},
      breakdown: [],
    };
  }
  /**
   * SEVERAL SEGMENTS, EACH WITH ITS OWN PRICE → THE TOTAL IS THEIR SUM.
   *
   * This used to refuse: `amountCents: null, prefill: false, 'r2.priceAmbiguous'`. The
   * reasoning was mandate #6 — never trust a number from a transcript — and for TWO
   * FIGURES IN ONE BREATH that is exactly right, because "eighteen fifty, call it two
   * grand" is one price said twice and adding them invents money.
   *
   * But that is not this case, and conflating them cost hadar a working feature
   * (2026-08-21: "it doesn't add cost of multiple projects into a total"). Here the
   * MODEL has already separated the work into segments and attributed one price span
   * to each. Two figures in two different segments are two different prices for two
   * different pieces of work, and their sum is what the job costs. Adding them is
   * arithmetic on what he said, not a guess about what he meant.
   *
   * MANDATE #6 IS STILL SATISFIED, and by the part that actually matters: nothing is
   * committed. `prefill` offers the figure through the same read-back every other
   * price goes through, the breakdown is shown so he confirms the PARTS rather than a
   * total he has to trust, and `numbers_confirmed_at` still gates the send. What
   * changes is that he now taps once to accept arithmetic he can check, instead of
   * being told the app could not work it out.
   *
   * MIXED FIXED AND CAP READS AS A CAP. A total combining a firm price and a
   * not-to-exceed is not firm, and calling it firm would be the more dangerous of the
   * two errors — it would put a number on an instrument the contractor cannot hold.
   */
  const total = hits.reduce((sum, h) => sum + h.cents, 0);
  const nte = hits.some((h) => h.nte);
  /**
   * ONE UNREADABLE SEGMENT POISONS THE TOTAL, so the total is not offered.
   *
   * The sum of the parts we CAN read is not the price of the job — it is the price of
   * some of the job, and it looks exactly like the price of all of it. Showing it with
   * one segment silently missing is worse than showing nothing, which is the whole
   * reason mandate #6 exists.
   *
   * The breakdown still goes back, including the segments that would not parse, so the
   * read-back can put his own words in front of him and let him type the figure.
   */
  if (unreadable.length) {
    return {
      amountCents: null, prefill: false,
      mode: nte ? 'nte' : 'fixed', modeHeard: false,
      heard: [...hits.map((h) => h.heard), ...unreadable.map((u) => u.heard)].join(' · '),
      reasonKey: 'r2.priceSegmentUnclear',
      reasonParams: { n: unreadable.length, of: hits.length + unreadable.length },
      breakdown: hits.map((h) => ({ title: h.title, cents: h.cents, heard: h.heard })),
    };
  }
  return {
    amountCents: total, prefill: true,
    mode: nte ? 'nte' : 'fixed', modeHeard: nte,
    heard: hits.map((h) => h.heard).join(' · '),
    reasonKey: nte ? 'r2.priceSummedNte' : 'r2.priceSummed',
    reasonParams: { n: hits.length },
    breakdown: hits.map((h) => ({ title: h.title, cents: h.cents, heard: h.heard })),
  };
}

/**
 * The NTE clause R3 makes mandatory: "Work will not exceed $X without a new approval."
 *
 * Lives here, next to the mode, so the mode and the sentence it obliges can never be
 * set independently — an NTE change order that went out without the clause would be a
 * cap the homeowner was never shown, which is the dispute the cap existed to prevent.
 * Returns a key + params, never a sentence: a baked English string cannot be rendered
 * to a Spanish-reading signer (mandate #5).
 */
export function nteClause(
  mode: PriceMode, amountDisplay: string
): { k: string; p: Record<string, string> } | null {
  return mode === 'nte' ? { k: 'r2.nteClause', p: { amount: amountDisplay } } : null;
}

/**
 * THE PRICE TO PREFILL A DRAFT EXTRA WITH — the two readings, and which may be written.
 *
 * hadar, 2026-08-23, fireplace extra: he finished the recording with "all in all,
 * about $1,200" and the extra arrived with no price and no Set-total button. Nothing
 * was broken in the extraction — the model read the job correctly, four segments,
 * high confidence. The gap was between two correct rules with nothing bridging them.
 *
 * `structure.ts` rule 7 tells the model that one figure covering the whole job
 * "belongs to no segment — leave every segment null and let the total stand alone",
 * and it obeyed: every `price_words` null. But `proposed_amount_cents` is fenced off
 * (mandate #6 — a model invented $450 from "four fifty"), so there is no field for
 * that total to stand in. It stands in the transcript, and the screen was only ever
 * asking the segments. Whole-job pricing is how most contractors quote, so the most
 * ordinary recording there is produced no price at all.
 *
 * WHICH READING WINS. Segments first: when the contractor priced the work in parts,
 * those parts ARE the price and the transcript would only re-find the same figures.
 * The transcript is the fallback for the shape that leaves no segment prices behind.
 *
 * WHAT MAY BE WRITTEN WITHOUT ASKING is deliberately narrower than what may be SHOWN,
 * and the two differ per reading:
 *
 *   · A segment reading needs MORE THAN ONE priced segment. One priced segment among
 *     four means he priced one segment, not the job; that sum is short, and a short
 *     total with a tick next to it is worse than no total. (Unchanged rule — this is
 *     the `breakdown.length > 1` guard, moved here rather than rewritten.)
 *   · A transcript reading carries no breakdown at all: one figure, spoken once,
 *     covering everything. There is no arithmetic to check because none was done, and
 *     `extractPrice` already refuses two figures or a bare "750".
 *
 * Everything below prefill stays where it was: the figure is arithmetic over numbers
 * HE said, the extra is a draft, and sending is still a separate human act.
 */
export function draftPrice(
  tasks: { priceWords: string | null; scope: string; title: string }[],
  transcript: string | null,
  parse: MoneyParser,
): { reading: VoicePriceReading | null; writable: boolean } {
  const seg = priceFromTasks(tasks, parse);

  /**
   * A SUMMED reading — two or more segments he priced separately. This is the grid
   * case, and it is the one place a total is ARITHMETIC rather than a figure he said,
   * so it keeps its own rule: more than one priced segment, every span readable.
   */
  if (seg && seg.breakdown.length > 1) {
    return { reading: seg, writable: seg.prefill && seg.amountCents !== null };
  }

  /**
   * A POISONED reading — he priced parts and one span could not be read ("4 teen
   * $100"). `priceFromTasks` returns the reading with NO total for exactly this, and it
   * must NOT fall through to the transcript below: the transcript would find the one
   * figure that did parse and write it as the price of the whole job, which is the
   * under-quote the poisoning rule exists to prevent. Refuse, and show what was read.
   */
  if (seg && seg.amountCents === null) {
    return { reading: seg, writable: false };
  }

  /**
   * ONE PRICED SEGMENT falls through to the transcript on purpose [2026-08-25].
   *
   * It used to be refused here, on the reasoning that "one priced segment among four
   * means he priced a segment, not the job". Run against the five real change orders in
   * the database, that rule refused FOUR of them — and in every case the whole
   * transcript held exactly one unambiguous figure, equal to the segment reading. Three
   * of the four had only ONE segment, so the premise did not even hold; the model had
   * simply attached his single price to the only part there was.
   *
   * So the question is not which segment a figure was pinned to, it is whether he said
   * more than one number. The transcript answers that, and `extractPrice` already
   * refuses when the answer is two. Same rule as the no-segments case below, reached
   * from a different direction — hadar, 2026-08-25: "we just extracting it".
   */
  const whole = transcript ? extractPrice(transcript, parse) : null;

  /**
   * ONE FIGURE HE SAID IS THE FIGURE. [hadar, 2026-08-25 — a logged decision that
   * OVERRIDES an adversarial-review finding, so both sides are recorded here.]
   *
   * Codex, 2026-08-24: "Demo the fireplace for $500, then rebuild and tile the face"
   * holds one figure and four segments, and $500 buys only the first — so writing it as
   * the total under-quotes the contractor. I gated the write on the job having one part
   * OR the transcript carrying a whole-job cue ("all in all", "call it", "in total").
   *
   * THE GATE WAS WORSE THAN THE PROBLEM. Measured against ordinary phrasings it refused
   * "it will cost $1,200", "probably around $1,200", "I would say $1,200", and a bare
   * "$1,200" — a man stating his price plainly, with the field left blank because his
   * words did not match a list I had written. That is not extraction, it is a
   * vocabulary test, and it fails exactly the contractor this product is for: someone
   * for whom software is not second nature and who will not learn the phrase that makes
   * the app cooperate.
   *
   * hadar's rule, and it is the right one: "we are not writing a price that was not
   * given by the user -- we just extracting it." One unambiguous figure in what he said
   * IS his price. Nothing is invented.
   *
   * WHAT STILL REFUSES, because these are about AMBIGUITY rather than authorship:
   *   · a bare number — "it will be 750 probably" stays empty. `parseMoney` will not
   *     call a number without a currency marker a price, and "four fifty" becoming $450
   *     is the failure mandate #6 was written for.
   *   · TWO OR MORE figures — the app would be choosing which one he meant, and
   *     choosing is authoring.
   *
   * THE ACCEPTED COST, stated rather than buried: Codex's case now fills $500 on a
   * four-part job. It is still a number he said, it is shown on a DRAFT beside the
   * scope listing all four parts, it is editable, and sending is a separate deliberate
   * act with the figure on screen — mandate #2's protection, which never moved.
   */
  return {
    reading: whole,
    writable: !!whole && whole.prefill && whole.amountCents !== null
      // extractPrice never populates a breakdown; belt-and-braces against a summed
      // reading arriving down this branch.
      && whole.breakdown.length === 0,
  };
}
