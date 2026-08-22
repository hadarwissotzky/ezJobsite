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
import { extractPrice, priceFromTasks, nteClause, type MoneyReading } from './voiceprice.ts';

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
