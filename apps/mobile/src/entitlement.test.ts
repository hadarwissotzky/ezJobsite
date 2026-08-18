/**
 * Which meter applies.
 *   cd apps/mobile && node --test src/entitlement.test.ts
 *
 * Every test here is about the same failure: an account that has PAID being refused by a
 * meter meant for one that has not.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { localChangeOrderCapApplies, meterFor, trialCapsApply } from './entitlement.ts';

test('a brand-new account is on the trial meter', () => {
  assert.equal(meterFor({ plan: 'free', purchasedEver: false }), 'free');
  assert.equal(trialCapsApply('free'), true);
});

test('buying credits moves the account off the trial meter — no plan change involved', () => {
  // The whole model in one assertion: `plan` never moved, and the meter did. Pay as you
  // go is not a tier, it is what free becomes once a balance is bought.
  assert.equal(meterFor({ plan: 'free', purchasedEver: true }), 'credits');
  assert.equal(trialCapsApply('credits'), false);
});

test('a subscription never consults a balance', () => {
  assert.equal(meterFor({ plan: 'core', purchasedEver: false }), 'unlimited');
  assert.equal(meterFor({ plan: 'crew', purchasedEver: false }), 'unlimited');
  assert.equal(trialCapsApply('unlimited'), false);
});

test('a subscriber who also bought credits is still unlimited, not metered', () => {
  // The downgrade-by-top-up bug. If this returned 'credits', a Core subscriber who bought
  // a pack would start being counted against a balance he does not need.
  assert.equal(meterFor({ plan: 'core', purchasedEver: true }), 'unlimited');
});

test('an unknown plan string is METERED, never unlimited', () => {
  // A webhook can write a tier this build has never heard of. Falling open would hand out
  // unlimited sends; falling closed consults a balance, which is recoverable.
  assert.equal(meterFor({ plan: 'enterprise-2027', purchasedEver: false }), 'free');
  assert.equal(meterFor({ plan: '', purchasedEver: false }), 'free');
  assert.equal(meterFor({ plan: 'CORE', purchasedEver: false }), 'free');
});

test('the local lifetime change-order cap never applies again', () => {
  // Two meters counting one act is what would have told a contractor who bought twenty
  // credits that his free plan includes two.
  assert.equal(localChangeOrderCapApplies(), false);
});

test('paying anything lifts the photo and recording caps', () => {
  // Not generosity: the free tier allows 30 photos EVER, so a 20-credit pack would be
  // unspendable — a quantity the buyer cannot use.
  for (const plan of ['free', 'core', 'crew']) {
    const m = meterFor({ plan, purchasedEver: true });
    assert.equal(trialCapsApply(m), false, `${plan} + purchased must not keep trial caps`);
  }
});
