/**
 * The credit line a contractor reads, and the rules about what NOT to say.
 *   cd apps/mobile && node --test src/credits.test.ts
 *
 * `balanceLine` is the pure part, and the failures worth preventing are all about
 * claiming to know something we do not: rendering an unread balance as zero, or putting
 * a counter in front of an unlimited subscriber who has no limit to count against.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { balanceLine, type CreditBalance } from './credits.ts';

const b = (o: Partial<CreditBalance>): CreditBalance => ({
  metered: true, plan: 'free', freeLeft: 0, purchased: 0, open: 0, available: 0, ...o,
});

test('an unlimited subscription is told nothing', () => {
  // Putting "12 left" in front of a subscriber invents a limit he does not have, and the
  // first thing he does is wonder what happens at zero.
  assert.equal(balanceLine(b({ metered: false, available: null })), null);
  assert.equal(balanceLine(b({ metered: false, available: 5 })), null);
});

test('an UNKNOWN balance says nothing — it never renders as zero', () => {
  // A contractor in a basement who bought 20 credits yesterday must not read "none
  // left" because a fetch failed. Silence is honest; zero is a specific false claim.
  assert.equal(balanceLine(b({ available: null })), null);
});

test('no balance object at all is silence, not zero', () => {
  assert.equal(balanceLine(null), null);
});

test('zero says none left', () => {
  assert.equal(balanceLine(b({ available: 0 }))?.k, 'credits.none');
});

test('a negative balance still reads as none, not as a negative number', () => {
  // R-6.3: a refunded pack can drive the balance below zero against already-consumed
  // credits. "-3 change orders left" is not a sentence anybody should read.
  assert.equal(balanceLine(b({ available: -3 }))?.k, 'credits.none');
});

test('one reads differently from several', () => {
  assert.equal(balanceLine(b({ available: 1 }))?.k, 'credits.one');
  const many = balanceLine(b({ available: 7 }));
  assert.equal(many?.k, 'credits.n');
  assert.equal(many?.p.n, '7');
});

test('it returns a key and params, never a sentence', () => {
  // Mandate #5: a string built here would be English on a Spanish-speaking
  // contractor's phone. The same rule flowterms.ts follows.
  const line = balanceLine(b({ available: 4 }));
  assert.ok(line && typeof line.k === 'string');
  assert.ok(!/left|change order/i.test(line.k), 'the key must not be the copy');
});
