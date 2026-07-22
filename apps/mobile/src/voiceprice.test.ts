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
import { extractPrice, nteClause, type MoneyReading } from './voiceprice.ts';

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
