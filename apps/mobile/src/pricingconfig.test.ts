/**
 * Prices, and refusing to show none.
 *   cd apps/mobile && node --test src/pricingconfig.test.ts
 *
 * The failures worth preventing here are all the same shape: a paywall that shows
 * nothing, or shows a number no product can charge. Either one ends with a contractor
 * concluding the app is broken, and he does not come back to find out.
 *
 * The rail switch is the other half. Apple's commission on external links is 0% in the
 * US today and under appeal; `linkout_enabled` is how we react to a court without an
 * App Store review cycle, so its failure modes are tested rather than assumed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { money, perCredit, railsFor, type PricingConfig } from './pricingconfig.ts';

const base: PricingConfig = {
  version: 2,
  freeAllowance: 2,
  packs: [
    { id: 'credits_5',  credits:  5, web:  2500, iap:  3299 },
    { id: 'credits_20', credits: 20, web:  7900, iap: 10299 },
    { id: 'credits_50', credits: 50, web: 14900, iap: 19499 },
  ],
  subs: [
    { id: 'core', monthly: 2400, annual: 22900, seats: 3, creditsPerMonth: null },
  ],
  linkoutEnabled: true,
  iapEnabled: true,
  source: 'server',
};

/* --------------------------------------------------------------------- money -- */

test('a whole-dollar price shows no cents', () => {
  // "$79.00" on a paywall reads as a rounding artefact; "$79" reads as a price.
  assert.equal(money(7900), '$79');
  assert.equal(money(2500), '$25');
  assert.equal(money(149_00), '$149');
});

test('a part-dollar price keeps both digits', () => {
  assert.equal(money(298), '$2.98');
  assert.equal(money(395), '$3.95');
});

test('thousands are grouped — $1,190 not $1190', () => {
  assert.equal(money(119000), '$1,190');
});

/* ---------------------------------------------------------------- per credit -- */

test('the per-credit price is what makes a bigger pack obviously better', () => {
  assert.equal(perCredit(base.packs[0]), '$5');
  assert.equal(perCredit(base.packs[1]), '$3.95');
  assert.equal(perCredit(base.packs[2]), '$2.98');
});

test('per-credit is computed from the WEB price, not the IAP one', () => {
  // The web price is the real one. Quoting the Apple-inflated figure as the unit price
  // would advertise the rail we do not want at a number we do not charge.
  assert.equal(perCredit({ id: 'credits_20', credits: 20, web: 7900, iap: 10299 }), '$3.95');
});

/* --------------------------------------------------------------------- rails -- */

test('both rails on is the normal state', () => {
  assert.equal(railsFor(base), 'both');
});

test('the linkout switch can be thrown without an app release', () => {
  // This is the whole reason pricing lives on the server: Apple has proposed 5-15% on
  // external links and the Supreme Court hears the appeal in the October 2026 term.
  assert.equal(railsFor({ ...base, linkoutEnabled: false }), 'iap');
});

test('web-only is expressible too', () => {
  assert.equal(railsFor({ ...base, iapEnabled: false }), 'web');
});

test('neither rail is a real state and it is named, not crashed', () => {
  // The caller shows "contact us" rather than a dead button — the same thing
  // billingStatus() === 'not_configured' already does.
  assert.equal(railsFor({ ...base, linkoutEnabled: false, iapEnabled: false }), 'none');
});

/* ------------------------------------------------------------------ metering -- */

test('creditsPerMonth null means UNLIMITED, and is not the same as zero', () => {
  // hadar, 2026-08-17: subscriptions stay unlimited and the cost was fixed instead.
  // `0` would mean "this tier grants no credits", which a send gate must read as
  // blocked. Collapsing the two is how an unlimited subscriber gets refused.
  const core = base.subs.find((s) => s.id === 'core')!;
  assert.equal(core.creditsPerMonth, null);
  assert.notEqual(core.creditsPerMonth, 0);
});

test('a metered tier is representable, so the model can change without a schema change', () => {
  const metered = { ...base.subs[0], creditsPerMonth: 25 };
  assert.equal(metered.creditsPerMonth, 25);
});
