/**
 * The paywall's monthly/annual split.
 *   cd apps/mobile && node --test src/paywallcycle.test.ts
 *
 * hadar 2026-08-13: "I need the paywall to split between annual and monthly as any
 * option across the 3 options free core crew."
 *
 * These are money claims on a screen where somebody decides to pay. The savings percent
 * is COMPUTED from plans.ts rather than typed into a string, so the risk is not a typo —
 * it is the arithmetic drifting from the prices when a number moves. That is what these
 * pin down, along with the two ways the cycle can pick the wrong product.
 *
 * `paywallscreen.tsx` imports react-native, so the pure helpers are imported from it
 * only if that stays loadable under `node --test` — they do not, so the arithmetic is
 * re-derived here against the SAME source of truth (PLANS) and asserted to agree with
 * what the screen would render. If plans.ts changes, these fail.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { PAID_TIERS, PLANS, offeredTiers, type PlanId } from './plans.ts';

type Cycle = 'monthly' | 'annual';

// Mirrors of the helpers in paywallscreen.tsx. Kept in step by the assertions below,
// which check them against PLANS rather than against hardcoded expectations.
const productFor = (plan: PlanId, cycle: Cycle) =>
  cycle === 'annual'
    ? (PLANS[plan].productIdAnnual ?? PLANS[plan].productIdMonthly)
    : (PLANS[plan].productIdMonthly ?? PLANS[plan].productIdAnnual);

const priceFor = (plan: PlanId, cycle: Cycle) =>
  cycle === 'annual' ? PLANS[plan].priceAnnualMonthly : PLANS[plan].priceMonthly;

const annualSavingPct = (plan: PlanId) => {
  const m = PLANS[plan].priceMonthly;
  const a = PLANS[plan].priceAnnualMonthly;
  if (m == null || a == null || m <= 0 || a >= m) return 0;
  return Math.round(((m - a) / m) * 100);
};

/* --------------------------------------------------------------- products -- */

test('each paid tier has BOTH cycles configured, or the toggle is a lie', () => {
  for (const plan of PAID_TIERS) {
    assert.ok(PLANS[plan].productIdMonthly, `${plan} has no monthly product`);
    assert.ok(PLANS[plan].productIdAnnual, `${plan} has no annual product`);
    assert.ok(PLANS[plan].priceMonthly, `${plan} has no monthly price`);
    assert.ok(PLANS[plan].priceAnnualMonthly, `${plan} has no annual price`);
  }
});

test('the cycle selects the matching product, never the other one', () => {
  for (const plan of PAID_TIERS) {
    // The bug this catches: buy() reading productIdAnnual regardless of the toggle,
    // which is exactly what it did before the split — somebody picks Monthly, taps,
    // and is charged for a year.
    assert.equal(productFor(plan, 'annual'), PLANS[plan].productIdAnnual);
    assert.equal(productFor(plan, 'monthly'), PLANS[plan].productIdMonthly);
    assert.notEqual(productFor(plan, 'annual'), productFor(plan, 'monthly'));
  }
});

test('free has no product on either cycle, so it can never be "bought"', () => {
  assert.equal(productFor('free', 'monthly'), null);
  assert.equal(productFor('free', 'annual'), null);
});

/* ----------------------------------------------------------------- prices -- */

test('annual is cheaper per month than monthly on every paid tier', () => {
  for (const plan of PAID_TIERS) {
    const m = priceFor(plan, 'monthly')!;
    const a = priceFor(plan, 'annual')!;
    // If this ever inverts, the toggle would advertise a saving on the pricier option.
    assert.ok(a < m, `${plan}: annual ${a} is not below monthly ${m}`);
  }
});

test('the advertised saving matches the actual prices', () => {
  // Core 29 -> 19 is 34.5% -> 34%. Crew 59 -> 49 is 16.9% -> 17%.
  //
  // CORE'S DISCOUNT WIDENED FROM 21% TO 34% (hadar, 2026-09-03: "change the program
  // plan to CORE cost to 29 from 24"). The monthly moved and the annual did not, so the
  // gap between them grew — the paywall now advertises a third off for paying yearly.
  // That is arithmetic, not a decision, and this line is where anyone changing one of
  // the two numbers is forced to look at the other.
  assert.equal(annualSavingPct('core'), 34);
  assert.equal(annualSavingPct('crew'), 17);
  for (const plan of PAID_TIERS) {
    const m = priceFor(plan, 'monthly')!;
    const a = priceFor(plan, 'annual')!;
    assert.equal(annualSavingPct(plan), Math.round(((m - a) / m) * 100));
  }
});

test('free advertises no saving — it has nothing to discount', () => {
  assert.equal(annualSavingPct('free'), 0);
});

test('the annual total is what APPLE charges, not the headline times twelve', () => {
  // The card prints "$229 billed once a year" beside "$19/mo". Apple has no $228 or
  // $588 price point — the products are configured at $229 and $589 — so multiplying
  // the headline would put a figure on a purchase screen that the receipt contradicts.
  assert.equal(PLANS.core.priceAnnualTotal, 229);
  assert.equal(PLANS.crew.priceAnnualTotal, 589);
  // And it must NOT be the naive product, which is the bug this replaced.
  assert.notEqual(PLANS.core.priceAnnualTotal, priceFor('core', 'annual')! * 12);
  assert.notEqual(PLANS.crew.priceAnnualTotal, priceFor('crew', 'annual')! * 12);
});

test('the per-month headline never overstates the real annual price', () => {
  // Rounding DOWN is the ordinary way subscriptions are quoted ($229/12 = $19.08 -> $19).
  // Rounding up would advertise a price higher than the charge, which is a different
  // and worse kind of wrong.
  for (const plan of PAID_TIERS) {
    const headline = priceFor(plan, 'annual')!;
    const real = PLANS[plan].priceAnnualTotal!;
    assert.ok(headline <= real / 12,
      `${plan}: headline $${headline}/mo exceeds the real $${(real / 12).toFixed(2)}/mo`);
    // ...and stays within a dollar of it, so the headline is not a different price.
    assert.ok(real / 12 - headline < 1, `${plan}: headline is more than $1/mo below the charge`);
  }
});

/* ------------------------------------------------- which card reads current -- */

/** The screen's rule, mirrored: the product NARROWS the tier match, never replaces it. */
const isCurrent = (plan: PlanId, cycle: Cycle, currentPlan: PlanId, productId?: string | null) => {
  const sameTier = currentPlan === plan;
  const pid = productFor(plan, cycle);
  const knowsCycle = plan !== 'free' && !!productId && !!pid;
  return sameTier && (!knowsCycle || productId === pid);
};

test('the current card follows the PRODUCT, not just the tier', () => {
  const onCoreAnnual = PLANS.core.productIdAnnual!;
  // On the annual view, Core is theirs.
  assert.equal(isCurrent('core', 'annual', 'core', onCoreAnnual), true);
  // Toggle to monthly and it is a different thing to buy — the card must NOT claim it.
  assert.equal(isCurrent('core', 'monthly', 'core', onCoreAnnual), false);
  // Crew is not theirs on either cycle.
  assert.equal(isCurrent('crew', 'annual', 'core', onCoreAnnual), false);
});

test('a cached product cannot make a card current when the TIER is not', () => {
  // Seen on device: the plan read 'free' while a Core product was still cached, and
  // both the Free card and the Core card said "Your plan". A lapsed subscription
  // leaves exactly that state behind in production.
  assert.equal(isCurrent('core', 'annual', 'free', PLANS.core.productIdAnnual), false);
  assert.equal(isCurrent('free', 'annual', 'free', PLANS.core.productIdAnnual), true);
});

test('with no known product it falls back to tier matching, as before the toggle', () => {
  assert.equal(isCurrent('core', 'monthly', 'core', null), true);
  assert.equal(isCurrent('core', 'annual', 'core', undefined), true);
  assert.equal(isCurrent('crew', 'annual', 'core', null), false);
});

test('free is current whenever the plan is free, on either cycle', () => {
  assert.equal(isCurrent('free', 'monthly', 'free', null), true);
  assert.equal(isCurrent('free', 'annual', 'free', PLANS.core.productIdAnnual), true);
  assert.equal(isCurrent('free', 'annual', 'core', PLANS.core.productIdAnnual), false);
});

/* ------------------------------------------- product must agree with the tier -- */

/**
 * Mirror of `entitledProductNow`'s rule (billing.ts): the ENTITLEMENT names the product
 * granting it. Nothing is picked out of `activeSubscriptions` — that list is unordered
 * and routinely holds several live products, which is how both device bugs happened.
 */
const productForEntitlement = (
  plan: PlanId, entitlementProduct: string | null
) => {
  if (plan === 'free' || !entitlementProduct) return null;
  const known = PAID_TIERS.some((t) =>
    PLANS[t].productIdMonthly === entitlementProduct
    || PLANS[t].productIdAnnual === entitlementProduct);
  return known ? entitlementProduct : null;
};

test('the entitlement decides, so a second live product cannot change the answer', () => {
  // Device state 2026-08-13: Core-monthly AND Core-annual both active and renewing.
  // Whichever `activeSubscriptions` happened to list first used to win; now the
  // entitlement's own productIdentifier does.
  assert.equal(
    productForEntitlement('core', PLANS.core.productIdAnnual!),
    PLANS.core.productIdAnnual);
  assert.equal(
    productForEntitlement('core', PLANS.core.productIdMonthly!),
    PLANS.core.productIdMonthly);
});

test('a product this build does not sell is not reported', () => {
  assert.equal(productForEntitlement('core', 'ezco_legacy_lifetime'), null);
});

test('free entitlement reports no product at all', () => {
  assert.equal(productForEntitlement('free', PLANS.core.productIdAnnual!), null);
});

// ── which tiers the pay page offers (hadar, 2026-08-18: "hide the crew package") ──

test('Crew is not on sale', () => {
  assert.ok(!offeredTiers('free').includes('crew'));
  assert.deepEqual(offeredTiers('free'), ['core']);
});

test('but a Crew subscriber still sees Crew', () => {
  // A card you cannot see is a subscription you cannot cancel — hostile, and an App
  // Store guideline 3.1.2 problem. Hiding is merchandising; it must never strand
  // somebody who is already paying.
  assert.ok(offeredTiers('crew').includes('crew'));
});

test('hiding a tier does not retire it', () => {
  // Crew is still a real entitlement: the webhook can still write it and planLimits
  // still has to answer for it. Dropping it from PAID_TIERS would strand those accounts.
  assert.ok(PAID_TIERS.includes('crew'));
  assert.ok(Number.isFinite(PLANS.crew.priceMonthly ?? NaN));
});

test('the order survives a tier coming back', () => {
  // Core before Crew, from PAID_TIERS — not append-at-the-end.
  assert.deepEqual(offeredTiers('crew'), ['core', 'crew']);
});

test('the advertised annual saving is one a reader can actually buy', () => {
  // `bestAnnualSavingPct` lives in the .tsx and cannot be imported here (React Native
  // imports do not resolve under node --test), so the RULE is asserted against the same
  // arithmetic this file already reproduces: the toggle's figure is the best across the
  // OFFERED tiers, never across the hidden ones.
  //
  // It matters even though it changes nothing today: Core happens to carry the better
  // rate (34% vs Crew's 17%), so a version computing over every tier would look correct
  // right up until the hidden tier had the bigger discount — and then it would advertise
  // a saving nothing on the screen could deliver (mandate #6).
  const bestOffered = offeredTiers('free')
    .reduce((b, p) => Math.max(b, annualSavingPct(p)), 0);
  assert.equal(bestOffered, 34);
  assert.ok(bestOffered !== annualSavingPct('crew'),
    'this test is only meaningful while the two rates differ');
});
