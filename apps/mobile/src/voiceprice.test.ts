/**
 * Tests for R2's price + price-mode extraction. Run:
 *   cd apps/mobile && node --test src/voiceprice.test.ts
 *
 * The first two tests ARE R2's two acceptance criteria, written as the PRD writes
 * them. They are the reason this file exists: the failing half of R2 was "amount is
 * pre-filled", and a claim that it now is should be checkable by running something.
 *
 * `parse` below is a STUB of changeorder.ts's `parseMoney`, honouring the same
 * contract (explicit currency marker => 'high'; a bare number => 'low'; nothing =>
 * 'none'). It exists because importing the real one pulls in Supabase and PowerSync
 * and node --test would not resolve them. The stub is kept deliberately dumb so that a
 * test passing here cannot be an artefact of clever parsing — the module under test
 * must do the work.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftPrice, extractPrice, priceFromTasks, nteClause, type MoneyReading } from './voiceprice.ts';

const parse = (text: string): MoneyReading => {
  const m = text.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/)
    || text.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)\b/i);
  if (m) {
    return { cents: Math.round(parseFloat(m[1].replace(/,/g, '')) * 100),
             confidence: 'high', matched: m[0] };
  }
  const bare = text.match(/\b(\d{2,6}(?:\.\d{2})?)\b/);
  if (bare) return { cents: Math.round(parseFloat(bare[1]) * 100), confidence: 'low', matched: bare[1] };
  return { cents: null, confidence: 'none' };
};

// ── R2's acceptance criteria, verbatim ────────────────────────────────────────

test('AC: a voice note with scope AND a dollar amount pre-fills the amount', () => {
  const r = extractPrice('Add three outlets in unit 3B for $450.', parse);
  assert.equal(r.amountCents, 45000);
  assert.equal(r.prefill, true);
  assert.equal(r.mode, 'fixed');
  assert.equal(r.reasonKey, 'r2.priceHeardFixed');
});

test('AC: a transcript with no price leaves the amount empty and flagged, never guessed', () => {
  const r = extractPrice('Replace the rotted subfloor under the tub before we tile.', parse);
  assert.equal(r.amountCents, null);
  assert.equal(r.prefill, false);
  assert.equal(r.reasonKey, 'r2.priceNoneHeard');
});

// ── mandate #6: the number is the highest-risk field ──────────────────────────

test('a bare spoken number is never prefilled — "four fifty" stays typed by a human', () => {
  // This is the exact input that made gpt-4o-mini invent $450 at high confidence.
  const r = extractPrice('Add three outlets in unit 3B, four fifty.', parse);
  assert.equal(r.amountCents, null);
  assert.equal(r.prefill, false);
});

test('a bare NUMERIC "450" is surfaced as unclear but still never prefilled', () => {
  const r = extractPrice('Add three outlets, 450.', parse);
  assert.equal(r.prefill, false);
  assert.equal(r.amountCents, null);
  assert.equal(r.reasonKey, 'r2.priceUnclear');
  assert.equal(r.heard, 'Add three outlets, 450');   // he is shown what went by
});

test('two figures prefill NOTHING and say how many were heard', () => {
  const r = extractPrice('$450 for the outlets and $200 for the trim.', parse);
  assert.equal(r.prefill, false);
  assert.equal(r.amountCents, null);
  assert.equal(r.reasonKey, 'r2.priceAmbiguous');
  assert.equal(r.reasonParams.n, 2);
});

test('two figures across separate sentences are also ambiguous', () => {
  const r = extractPrice('Outlets are $450. The trim will run $200.', parse);
  assert.equal(r.prefill, false);
  assert.equal(r.reasonParams.n, 2);
});

// ── R3's price modes, heard rather than typed ─────────────────────────────────

test('"not to exceed" makes it an NTE cap, not a fixed price', () => {
  const r = extractPrice('Time and materials on the drain, not to exceed $800.', parse);
  assert.equal(r.mode, 'nte');
  assert.equal(r.modeHeard, true);
  assert.equal(r.amountCents, 80000);
  assert.equal(r.prefill, true);
  assert.equal(r.reasonKey, 'r2.priceHeardNte');
});

test('Spanish "no más de" is heard as a cap, accents and all', () => {
  const r = extractPrice('Cambiar el tablero, no más de $1,200.', parse);
  assert.equal(r.mode, 'nte');
  assert.equal(r.modeHeard, true);
  assert.equal(r.amountCents, 120000);
});

test('a cue with no money in its clause never turns a fixed price into a cap', () => {
  // "up to code" is the trap: the cue is present, the money is in another sentence.
  const r = extractPrice('Bring the panel up to code. It is $900.', parse);
  assert.equal(r.mode, 'fixed');
  assert.equal(r.modeHeard, false);
  assert.equal(r.amountCents, 90000);
});

test('a fixed price never claims the mode was heard', () => {
  const r = extractPrice('Swap the vanity for $650.', parse);
  assert.equal(r.mode, 'fixed');
  assert.equal(r.modeHeard, false, 'fixed is a default; saying it was heard would be a lie');
});

test('the NTE clause R3 makes mandatory is a key + params, never a baked sentence', () => {
  assert.deepEqual(nteClause('nte', '$800.00'), { k: 'r2.nteClause', p: { amount: '$800.00' } });
  assert.equal(nteClause('fixed', '$800.00'), null);
});

// ── the boring edges that still reach production ──────────────────────────────

test('an empty or whitespace transcript is a clean "nothing heard", not a crash', () => {
  for (const s of ['', '   ', '\n\n']) {
    const r = extractPrice(s, parse);
    assert.equal(r.prefill, false);
    assert.equal(r.reasonKey, 'r2.priceNoneHeard');
  }
});

test('a parser that returns cents with no `matched` cannot spin the scanner', () => {
  // Defends the loop in figuresIn(): without the `matched` guard this hangs the UI
  // thread on a single clause, which on a phone reads as the app being dead.
  const dumb = (): MoneyReading => ({ cents: 100, confidence: 'high' });
  const r = extractPrice('anything at all', dumb);
  assert.equal(r.amountCents, 100);
  assert.equal(r.prefill, true);
});

// ── priceFromTasks: prefill from the AI's ISOLATED price phrase (2026-07-23) ───
// The regression these guard: "ten hours, $1,500" prefilled nothing because the whole
// transcript went through extractPrice. The AI already tagged "$1,500" as the price,
// so parsing THAT span fills the field. Mandate #6 holds — parseMoney still makes the
// number, and it is still a flagged prefill the human reads back.

test('the AI-tagged price phrase prefills the field extractPrice left empty', () => {
  const r = priceFromTasks(
    [{ title: 'Fireplace', priceWords: '$1,500', scope: 'Refinish and stain the fireplace.' }], parse);
  assert.equal(r?.amountCents, 150000);
  assert.equal(r?.prefill, true);
  assert.equal(r?.mode, 'fixed');
  assert.equal(r?.heard, '$1,500');
});

test('a cap cue in the price phrase makes it NTE, not fixed', () => {
  const r = priceFromTasks(
    [{ title: 'Drain', priceWords: 'up to $2,000', scope: 'Time and materials on the drain.' }], parse);
  assert.equal(r?.amountCents, 200000);
  assert.equal(r?.mode, 'nte');
  assert.equal(r?.modeHeard, true);
});

/**
 * BEHAVIOUR CHANGED 2026-08-21, deliberately. This test asserted the opposite —
 * "two tasks that each carry a clean price stay ambiguous — fill neither".
 *
 * That refusal conflated two different situations. TWO FIGURES IN ONE BREATH
 * ("eighteen fifty, call it two grand") is one price said twice, and adding them
 * invents money — `extractPrice` still refuses that, and the test below it still
 * proves so. But two figures the MODEL attributed to two different SEGMENTS are two
 * prices for two pieces of work, and their sum is what the job costs.
 *
 * hadar, 2026-08-21: "it doesn't add cost of multiple projects into a total … the
 * total and the extraction must be a total (combination of all segments)."
 *
 * Mandate #6 is untouched by this: nothing is committed. The figure is offered
 * through the same read-back as every other price, the breakdown is shown so the
 * PARTS are what get confirmed, and `numbers_confirmed_at` still gates the send.
 */
test('segments that each carry a price are SUMMED into the total', () => {
  const r = priceFromTasks([
    { title: 'Outlets', priceWords: '$450', scope: 'Add three outlets.' },
    { title: 'Window trim', priceWords: '$200', scope: 'Trim out the window.' },
  ], parse);
  assert.equal(r?.prefill, true);
  assert.equal(r?.amountCents, 65000, '$450 + $200');
  assert.equal(r?.reasonKey, 'r2.priceSummed');
  assert.equal(r?.reasonParams.n, 2);
});

test('the breakdown keeps the segments in the order the work was described', () => {
  // Not sorted by price. A homeowner reading "kitchen, then hall, then the make-good"
  // is following the job; the same lines sorted by cost are a quote, not a plan.
  const r = priceFromTasks([
    { title: 'Kitchen', priceWords: '$900', scope: 'Kitchen first.' },
    { title: 'Hall', priceWords: '$150', scope: 'Then the hall.' },
    { title: 'Make good', priceWords: '$300', scope: 'Patch and paint after.' },
  ], parse);
  assert.deepEqual(r?.breakdown.map((b) => b.title), ['Kitchen', 'Hall', 'Make good']);
  assert.equal(r?.amountCents, 135000);
  assert.equal(r?.breakdown.reduce((n, b) => n + b.cents, 0), r?.amountCents,
    'the total must equal the sum of the parts shown — always');
});

test('one capped segment makes the whole total a cap, never a firm price', () => {
  // A total combining a firm price and a not-to-exceed is not firm. Calling it firm
  // is the more dangerous of the two errors: it puts a number on an instrument the
  // contractor cannot hold to.
  const r = priceFromTasks([
    { title: 'Rough-in', priceWords: '$800', scope: 'Rough in the circuit.' },
    { title: 'Dig', priceWords: 'up to $1,200', scope: 'Trenching, time and materials.' },
  ], parse);
  assert.equal(r?.mode, 'nte');
  assert.equal(r?.amountCents, 200000);
  assert.equal(r?.reasonKey, 'r2.priceSummedNte');
});

test('no parseable task price returns null — caller falls back to the transcript scan', () => {
  assert.equal(priceFromTasks([{ title: 'Segment', priceWords: null, scope: 'Fix the subfloor.' }], parse), null);
  assert.equal(priceFromTasks([], parse), null);
  // A task whose price_words hold no currency figure is not a price, so: null, not EMPTY.
  assert.equal(priceFromTasks([{ title: 'Segment', priceWords: 'a few hours', scope: 'Sand it.' }], parse), null);
});

test('one clean task among unpriced siblings prefills that one', () => {
  const r = priceFromTasks([
    { title: 'Segment', priceWords: null, scope: 'Haul the debris.' },
    { title: 'Segment', priceWords: '$1,500', scope: 'Refinish the fireplace.' },
  ], parse);
  assert.equal(r?.amountCents, 150000);
  assert.equal(r?.prefill, true);
});

test('a garbled price span is NOT added into a total — the real transcript case', () => {
  // Deepgram wrote "4 teen $100" for a spoken "fourteen hundred" (cap-mt3lcsy5,
  // 2026-08-21). `parseMoney` reads "$100" with HIGH confidence and is not wrong to.
  // Summed blindly, three segments came to $2,050 against a real total of $3,350 —
  // a plausible figure, $1,300 short, on a document a homeowner signs.
  //
  // A misread figure is survivable when the contractor sees it beside his own words.
  // It is not survivable inside a SUM, which hides which part is wrong and reads as
  // arithmetic rather than as a reading.
  const r = priceFromTasks([
    { title: 'Remove and install face', priceWords: 'the installation will be about $850', scope: 'x' },
    { title: 'Finish (sand and stain)', priceWords: 'staining is gonna be 4 teen $100', scope: 'x' },
    { title: 'Tile base and backsplash', priceWords: 'tiles installation will be $1,100', scope: 'x' },
  ], parse);
  assert.equal(r?.prefill, false, 'one unreadable segment must stop the total being offered');
  assert.equal(r?.amountCents, null);
  assert.equal(r?.reasonKey, 'r2.priceSegmentUnclear');
  assert.equal(r?.reasonParams.n, 1, 'one segment could not be read');
  assert.equal(r?.reasonParams.of, 3);
  // The parts that DID read still come back, so the read-back can show his own words.
  assert.deepEqual(r?.breakdown.map((b) => b.cents), [85000, 110000]);
});

test('ordinary wording around a figure is not mistaken for a leftover number', () => {
  // "about", "roughly", "call it" must not trip the detector — only a NUMBER left
  // unaccounted for does. Otherwise the guard would refuse every natural sentence.
  const r = priceFromTasks([
    { title: 'Outlets', priceWords: 'call it about $450 for that', scope: 'x' },
    { title: 'Trim', priceWords: 'roughly $200', scope: 'x' },
  ], parse);
  assert.equal(r?.prefill, true);
  assert.equal(r?.amountCents, 65000);
});

/**
 * THE FIREWALL RECORDING, 2026-08-23. hadar priced three of four segments out loud and
 * the app offered a confident $1,000 — the third, "It will be 750 probably", vanished
 * without a word because he said the number with no currency marker. These are his
 * actual `price_words`, copied from `capture_structured` for
 * cap-mt6hxw50-dqpl67n0.
 */
const FIREWALL = [
  { title: 'Demo existing firewall face', priceWords: '$500 plus all the disposal fees',
    scope: 'Remove the existing firewall face and dispose of the debris.' },
  { title: 'Build and install new firewall face', priceWords: null,
    scope: 'Build a new frame, install the new firewall face.' },
  { title: 'Set homeowner-supplied tiles', priceWords: 'That will be $500',
    scope: 'Cut, set, and grout the tiles supplied by the homeowner.' },
  { title: 'Finish and stain the new facing', priceWords: 'It will be 750 probably',
    scope: 'Sand and stain the new facing three times.' },
];

test('a price he SAID that we could not read refuses the total instead of dropping it', () => {
  const r = priceFromTasks(FIREWALL, parse);
  assert.equal(r?.amountCents, null,
    'a total missing $750 must not be offered — the sum of the parts we can read is not the price of the job');
  assert.equal(r?.prefill, false);
  assert.equal(r?.reasonKey, 'r2.priceSegmentUnclear');
  assert.equal(r?.reasonParams.n, 1, 'exactly one segment was unreadable');
  assert.equal(r?.reasonParams.of, 3, 'out of the three that claimed a price');
  assert.match(r?.heard ?? '', /750/, 'his own words for the dropped price go back to him');
});

test('the two readable segments still come back as a breakdown to check', () => {
  const r = priceFromTasks(FIREWALL, parse);
  assert.deepEqual(r?.breakdown.map((b) => b.cents), [50000, 50000]);
});

test('a segment that claims no money at all stays silent and does not poison the total', () => {
  const r = priceFromTasks([
    { title: 'Demo', priceWords: '$500', scope: 'Demo the face.' },
    { title: 'Haul away', priceWords: 'no charge', scope: 'Take the debris.' },
  ], parse);
  assert.equal(r?.amountCents, 50000, '"no charge" is not an unreadable price, it is no price');
  assert.equal(r?.prefill, true);
});

test('two distinct figures in one span are unreadable, not silently skipped', () => {
  const r = priceFromTasks([
    { title: 'Demo', priceWords: '$500', scope: 'Demo.' },
    { title: 'Labour', priceWords: '$95 an hour, about $2,000 total', scope: 'Crew time.' },
  ], parse);
  assert.equal(r?.amountCents, null);
  assert.equal(r?.reasonKey, 'r2.priceSegmentUnclear');
});

// ── draftPrice: which reading fills the extra, and which may be written ──────────
//
// The bug these pin, in hadar's words on 2026-08-23: a finished recording with a
// price spoken plainly at the end of it produced an extra with no price at all.

/** The four unpriced segments the model returned for the fireplace recording. */
const FIREPLACE_SEGMENTS = [
  { title: 'Demo existing fireplace face', priceWords: null, scope: 'Remove the face and demo the tiles.' },
  { title: 'Frame and install new face', priceWords: null, scope: 'Frame and install the new face.' },
  { title: 'Tile bottom and face', priceWords: null, scope: 'Tile the bottom and the face.' },
  { title: 'Sand and stain', priceWords: null, scope: 'Sand three times and stain three times.' },
];

test('a whole-job total spoken once fills the extra', () => {
  // The real shape: every segment null BY INSTRUCTION, one figure at the end.
  const { reading, writable } = draftPrice(
    FIREPLACE_SEGMENTS,
    'It will not change the schedule, but it will cost, all in all, about $1,200.',
    parse);
  assert.equal(reading?.amountCents, 120000);
  assert.equal(writable, true, 'the price he said out loud was left off the extra');
  assert.deepEqual(reading?.breakdown, [], 'a figure nobody itemised must not grow a breakdown');
});

test('no price anywhere writes nothing', () => {
  const { reading, writable } = draftPrice(
    FIREPLACE_SEGMENTS, 'We will start on Monday and it should take a week.', parse);
  assert.equal(writable, false);
  assert.equal(reading?.amountCents, null);
});

test('a bare number in the transcript is not a price', () => {
  // mandate #6, via extractPrice: "750" with no currency marker never prefills.
  const { writable } = draftPrice(FIREPLACE_SEGMENTS, 'It will be 750 probably.', parse);
  assert.equal(writable, false);
});

test('two figures in the transcript write nothing — we do not pick', () => {
  const { writable } = draftPrice(
    FIREPLACE_SEGMENTS, 'The demo is $400 and then the tile runs $900.', parse);
  assert.equal(writable, false, 'the app chose between two figures the contractor said');
});

test('segment prices outrank the transcript', () => {
  const { reading, writable } = draftPrice(
    [{ title: 'Bath', priceWords: '$1,200', scope: 'The hall bath.' },
     { title: 'Hall', priceWords: '$400', scope: 'The hall.' }],
    'the bathroom is $1,200, the hall another $400', parse);
  assert.equal(reading?.amountCents, 160000, 'it must SUM the parts, not re-read the transcript');
  assert.equal(writable, true);
  assert.equal(reading?.breakdown.length, 2);
});

test('ONE priced segment is his price when he said only one number', () => {
  // REVERSED 2026-08-25, and the evidence was the database rather than an argument.
  // This asserted that one priced segment among several must never be written. Run
  // against the five real change orders, that refused FOUR of them — and in every case
  // the transcript held exactly ONE unambiguous figure equal to the segment reading.
  // Three had a single segment, so "among several" was not even true; the model had
  // attached his one price to the only part there was.
  //
  // The question is not which segment a figure was pinned to. It is whether he said
  // more than one number, and the transcript answers that.
  const { reading, writable } = draftPrice(
    [{ title: 'Demo', priceWords: '$500', scope: 'Demo the face.' },
     { title: 'Tile', priceWords: null, scope: 'Tile the face.' },
     { title: 'Stain', priceWords: null, scope: 'Stain it.' }],
    'demo is $500', parse);
  assert.equal(reading?.amountCents, 50000);
  assert.equal(writable, true, 'refused the only figure he said');
});

test('but TWO figures still refuse, whichever path found them', () => {
  // The line that did not move: choosing between two numbers is authoring.
  const { writable } = draftPrice(
    [{ title: 'Demo', priceWords: '$500', scope: 'Demo.' },
     { title: 'Tile', priceWords: null, scope: 'Tile.' }],
    'demo is $500 and the tile is another $900', parse);
  assert.equal(writable, false);
});

test('an UNREADABLE span still poisons the whole reading', () => {
  // The most important guard in this file, and the one that must survive every
  // relaxation: he priced parts, one span cannot be read, so the sum of what we CAN
  // read is not the price of the job. It must not fall through to the transcript and
  // write the single figure that happened to parse.
  const { reading, writable } = draftPrice(
    [{ title: 'Demo', priceWords: '$400', scope: 'Demo.' },
     { title: 'Tile', priceWords: 'four teen hundred', scope: 'Tile.' }],
    'demo four hundred dollars, tile four teen hundred', parse);
  assert.equal(writable, false, 'an unreadable segment price was papered over');
  assert.equal(reading?.amountCents, null, 'a partial total was offered as the price');
});

// ── Codex, adversarial review 2026-08-24: one figure is not one price ────────────

test('a single figure he said IS the price, whatever words surround it', () => {
  // REVERSED 2026-08-25 by hadar: "we are not writing a price that was not given by the
  // user -- we just extracting it."
  //
  // This test used to assert the opposite. It was written for Codex's counterexample —
  // "$500" on a four-part job — and the gate it protected refused these too, which is
  // why it had to go: a man stating his price plainly, and the field left blank because
  // his wording missed a list. Codex's case is accepted knowingly; see draftPrice.
  for (const line of [
    'It will cost $1,200.',
    'Probably around $1,200.',
    'I would say $1,200.',
    '$1,200.',
    'This one runs $1,200.',
  ]) {
    const { reading, writable } = draftPrice(FIREPLACE_SEGMENTS, line, parse);
    assert.equal(reading?.amountCents, 120000, `did not read ${line}`);
    assert.equal(writable, true, `refused a price he plainly stated: ${line}`);
  }
});

test('a stated whole-job total still writes', () => {
  // The case this fallback exists for must survive the fix.
  for (const line of [
    'It will cost, all in all, about $1,200.',
    'Call it $1,200 for the whole thing.',
    'The total comes to $1,200.',
    'Altogether $1,200.',
  ]) {
    const { writable } = draftPrice(FIREPLACE_SEGMENTS, line, parse);
    assert.equal(writable, true, `"${line}" no longer fills the price`);
  }
});

test('a ONE-SEGMENT job needs no cue — there is nowhere else for the price to belong', () => {
  const { reading, writable } = draftPrice(
    [{ title: 'Replace the face', priceWords: null, scope: 'Replace the fireplace face.' }],
    'Replacing the face runs $1,200.', parse);
  assert.equal(reading?.amountCents, 120000);
  assert.equal(writable, true);
});

test('no segments at all is treated as one job, not as many', () => {
  // An empty task list is what a low-confidence structuring returns. There is no
  // segment for the figure to be a part OF, so the single figure is the job.
  const { writable } = draftPrice([], 'The job is $1,200.', parse);
  assert.equal(writable, true);
});

test('AMBIGUITY still refuses — two figures means the app would be choosing', () => {
  // Unchanged and load-bearing. Reading one number he said is extraction; picking
  // between two is authoring, which is the line mandate #6 actually draws.
  const { writable } = draftPrice(
    FIREPLACE_SEGMENTS, 'The demo is $400 and then the tile runs $900.', parse);
  assert.equal(writable, false);
});

test('a BARE number still refuses — "four fifty" is why', () => {
  const { writable } = draftPrice(FIREPLACE_SEGMENTS, 'It will be 750 probably.', parse);
  assert.equal(writable, false, 'a number with no currency marker was treated as a price');
});
