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
};

/**
 * Phrases that turn a figure into a CAP rather than a price.
 *
 * Each one is only ever consulted for a clause that already contains a currency
 * figure, which is what makes the weak members safe: "up to" alone is "up to code",
 * "hasta" alone is "hasta el jueves" — neither carries money, so neither is ever
 * looked at. Accents are stripped before matching, so 'maximo' catches "máximo".
 */
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
  reasonKey: 'r2.priceNoneHeard', reasonParams: {},
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
      reasonKey: f.nte ? 'r2.priceHeardNte' : 'r2.priceHeardFixed',
      reasonParams: {},
    };
  }

  if (found.length > 1) {
    /**
     * TWO OR MORE FIGURES: PREFILL NOTHING, AND SAY SO.
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
      reasonKey: 'r2.priceAmbiguous',
      reasonParams: { n: found.length },
    };
  }

  if (softest) {
    return {
      amountCents: null, prefill: false, mode: 'fixed', modeHeard: false,
      heard: softest.clause,
      reasonKey: 'r2.priceUnclear', reasonParams: {},
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
  tasks: { priceWords: string | null; scope: string }[],
  parse: MoneyParser
): VoicePriceReading | null {
  const hits: { cents: number; nte: boolean; heard: string }[] = [];
  for (const t of tasks) {
    if (!t.priceWords) continue;
    // A task's price_words is one price span; still walk it in case the model tagged
    // "$95/hr up to $2,000" — two figures there is genuinely a cap, but two DISTINCT
    // clean figures we cannot safely reduce, so we drop the whole task rather than pick.
    const figs = figuresIn(t.priceWords, parse).filter((f) => f.confidence === 'high' && f.cents !== null);
    if (figs.length !== 1) continue;
    const nte = NTE_CUES.some((cue) => fold(`${t.priceWords} ${t.scope}`).includes(cue));
    hits.push({ cents: figs[0].cents as number, nte, heard: t.priceWords });
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) {
    const h = hits[0];
    return {
      amountCents: h.cents, prefill: true,
      mode: h.nte ? 'nte' : 'fixed', modeHeard: h.nte, heard: h.heard,
      reasonKey: h.nte ? 'r2.priceHeardNte' : 'r2.priceHeardFixed', reasonParams: {},
    };
  }
  return {
    amountCents: null, prefill: false,
    mode: hits.some((h) => h.nte) ? 'nte' : 'fixed', modeHeard: false,
    heard: hits.map((h) => h.heard).join(' · '),
    reasonKey: 'r2.priceAmbiguous', reasonParams: { n: hits.length },
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
