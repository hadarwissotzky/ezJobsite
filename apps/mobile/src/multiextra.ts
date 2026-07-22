/**
 * R2 — "Sounds like 2 extras — split them?"
 *
 * R2 is explicit about the shape of this: *"V1 produces one extra per session. If the
 * narration clearly describes multiple distinct extras, structuring FLAGS it; actual
 * auto-split is P1 (see R14)."* So this file detects and reports. It never splits,
 * never edits a capture, and nothing downstream branches on it — the flag is a
 * sentence shown to the contractor while he is already reviewing the card.
 *
 * WHY A FLAG IS WORTH BUILDING WITHOUT THE SPLIT. Two extras that ride out as one
 * change order get ONE price and ONE approval, and the second piece of work is then
 * either unbilled or billed against an approval that never described it. That is the
 * dispute the whole product exists to prevent, and the contractor is the only one who
 * can catch it — but only if somebody points at it while the card is still open.
 *
 * PURE, and for the same reason as voiceprice.ts: no imports, so `node --test` can run
 * it, so the detection rule can be argued with by a test rather than by reading.
 *
 * IT IS TUNED TO UNDER-REPORT. A false flag teaches the contractor that the banner is
 * noise, and a banner he has learned to ignore protects nobody — so a second piece of
 * work only counts as a second EXTRA when the speaker himself marked the boundary
 * ("also", "another thing", "aparte"). Consecutive work described with no boundary is
 * treated as ONE extra: "tear out the subfloor. replace the joist under the tub."
 * is one repair told in two sentences, and flagging it would be the first step to
 * making the flag worthless.
 */

/**
 * The verbs that describe jobsite WORK. Stems, not words, so "installed",
 * "installing" and "instalación" all land. EN and ES together in one list on purpose:
 * a crew switches language mid-sentence and a per-language pass would miss the switch.
 */
const WORK_STEMS = [
  'add', 'install', 'replac', 'remov', 'demo', 'rebuild', 'reroute', 'relocat',
  'repair', 'patch', 'swap', 'upgrad', 'pour', 'frame', 'tear out', 'rip out',
  'run a new', 'put in', 'take out', 'redo', 'move the',
  // es-419
  'agreg', 'instal', 'reemplaz', 'quit', 'repar', 'cambi', 'poner', 'pon ',
  'sacar', 'saca ', 'arregl', 'mover',
];

/**
 * The words a person uses when they are DONE with one thing and starting another.
 *
 * This list is the whole detector. Everything else is scaffolding: without one of
 * these the module says "one extra" no matter how much work was described.
 */
const BOUNDARY_CUES = [
  'also', 'another thing', 'other thing', 'second thing', 'separate', 'separately',
  'on top of that', 'then there', 'one more', 'next thing', 'plus we', 'plus i',
  'and then also', 'as well as that', 'different job', 'unrelated',
  // es-419
  'ademas', 'tambien', 'aparte', 'otra cosa', 'por otro lado', 'lo otro', 'segundo',
];

export type MultiExtraFlag = {
  /** How many distinct extras the narration sounds like. 0 for an empty transcript. */
  count: number;
  /** True at 2+. The ONLY thing the UI should branch on. */
  flagged: boolean;
  /** i18n key + params. Never a sentence — this is read on a Spanish phone too. */
  reasonKey: string;
  reasonParams: Record<string, string | number>;
  /** The clause that opens each detected extra, verbatim, so the flag is checkable. */
  starts: string[];
};

function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Same split as voiceprice.ts: hard terminators only, never "and". */
function clauses(text: string): string[] {
  return text.split(/[.!?;\n]+/).map((c) => c.trim()).filter(Boolean);
}

export function detectMultipleExtras(transcript: string): MultiExtraFlag {
  const none: MultiExtraFlag = {
    count: 0, flagged: false, reasonKey: 'r2.oneExtra', reasonParams: {}, starts: [],
  };
  if (!transcript || !transcript.trim()) return none;

  const starts: string[] = [];
  for (const clause of clauses(transcript)) {
    const folded = fold(clause);
    if (!WORK_STEMS.some((v) => folded.includes(v))) continue;   // no work described
    if (!starts.length) { starts.push(clause); continue; }       // the first is extra #1
    // A boundary cue INSIDE this clause is the speaker saying "new thing". Anything
    // else continues the extra already open.
    if (BOUNDARY_CUES.some((c) => folded.includes(c))) starts.push(clause);
  }

  if (!starts.length) return none;
  return {
    count: starts.length,
    flagged: starts.length >= 2,
    reasonKey: starts.length >= 2 ? 'r2.multiExtra' : 'r2.oneExtra',
    reasonParams: { n: starts.length },
    starts,
  };
}
