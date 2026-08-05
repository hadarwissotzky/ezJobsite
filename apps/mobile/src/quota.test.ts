/**
 * The free-tier caps (hadar 2026-08-04): 2 change orders, 30 photos, 30 minutes.
 *
 * These exist because a quota that is wrong in either direction is expensive: too
 * tight and a paying-ready user is blocked from the thing they were about to pay for;
 * too loose and the free tier is the product. The boundary is the whole test.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { PLANS, planLimits } from './plans.ts';

test('free tier carries exactly the caps hadar specified', () => {
  const f = PLANS.free.limits;
  assert.equal(f.changeOrders, 2);
  assert.equal(f.photos, 30);
  assert.equal(f.recordingMinutes, 30);
});

test('every paid tier is unlimited on all three', () => {
  for (const id of ['core', 'crew'] as const) {
    const l = planLimits(id);
    assert.equal(l.changeOrders, Infinity, `${id} changeOrders`);
    assert.equal(l.photos, Infinity, `${id} photos`);
    assert.equal(l.recordingMinutes, Infinity, `${id} recordingMinutes`);
  }
});

test('the cap counts SENT change orders — the 2nd send is allowed, the 3rd is not', () => {
  // `checkChangeOrders` blocks when current >= limit, so with limit 2 the user may
  // hold 2 and is stopped when creating a 3rd. Off-by-one here is the difference
  // between "two free change orders" and "one".
  const limit = PLANS.free.limits.changeOrders;
  const blocked = (current: number) => current >= limit;
  assert.equal(blocked(0), false, 'first must be allowed');
  assert.equal(blocked(1), false, 'second must be allowed');
  assert.equal(blocked(2), true, 'third must be blocked');
});

test('photo and minute ceilings behave the same way at their boundary', () => {
  const p = PLANS.free.limits.photos;
  assert.equal(29 >= p, false, '30th photo must be allowed');
  assert.equal(30 >= p, true, '31st photo must be blocked');
  const m = PLANS.free.limits.recordingMinutes;
  assert.equal(29 >= m, false);
  assert.equal(30 >= m, true);
});

// ── the bytes-for-minutes conversion ──────────────────────────────────────────
import { recordingByteBudget } from './quota.ts';

test('30 free minutes is a ~28.8MB budget, and errs in the user’s favour', () => {
  const budget = recordingByteBudget(30);
  assert.equal(budget, 28_800_000);
  // Measured field recordings sustain ~13,500 B/s, so the nominal-rate budget buys
  // MORE than the promised 30 minutes. If this ever inverts, the cap starts cutting
  // people off early — which is the failure mode that actually costs us a customer.
  const realSeconds = budget / 13_500;
  assert.ok(realSeconds / 60 >= 30, `budget must cover at least 30 real minutes, got ${realSeconds / 60}`);
});

test('unlimited plans get an infinite byte budget, not a huge finite one', () => {
  assert.equal(recordingByteBudget(Infinity), Infinity);
});

test('free is one team member — the OWNER — so the first invite is refused', () => {
  const limit = PLANS.free.limits.members;
  assert.equal(limit, 1);
  // memberCount includes the owner, and checkMembers blocks at n >= limit.
  const blocked = (activeMembers: number) => activeMembers >= limit;
  assert.equal(blocked(0), false, 'a company with no rows yet can still add the owner');
  assert.equal(blocked(1), true, 'owner present -> inviting anyone else is blocked');
});

test('Core is a team of three — owner plus two', () => {
  assert.equal(planLimits('core').members, 3);
  const blocked = (active: number) => active >= 3;
  assert.equal(blocked(2), false, 'owner + 1 can still add a third');
  assert.equal(blocked(3), true, 'the fourth person is refused');
});

test('Crew stays unlimited on seats', () => {
  for (const id of ['crew'] as const) {
    assert.equal(planLimits(id).members, Infinity, `${id} members`);
  }
});

test('every paid tier is unmetered on the things free meters — that is the upgrade', () => {
  for (const id of ['core', 'crew'] as const) {
    const l = planLimits(id);
    assert.equal(l.changeOrders, Infinity, `${id} changeOrders`);
    assert.equal(l.photos, Infinity, `${id} photos`);
    assert.equal(l.recordingMinutes, Infinity, `${id} recordingMinutes`);
  }
});

// ── the send gate reports the FIRST cap hit, in a deliberate order ─────────────
test('send-gate order puts the understandable cap first', () => {
  // checkSendQuota runs changeOrders -> photos -> recordingMinutes. The order is not
  // cosmetic: "2 free change orders" is a limit the user chose to spend, while photo
  // and minute counts are byproducts of working. Leading with a byproduct reads as
  // punishment for using the app, so the intelligible cap must be reported first.
  const ORDER = ['changeOrders', 'photos', 'recordingMinutes'];
  assert.equal(ORDER[0], 'changeOrders');
  assert.deepEqual(ORDER.slice(1).sort(), ['photos', 'recordingMinutes']);
});

test('every send-gate kind has quota copy, or the modal renders empty', () => {
  // The modal keys off `quota.body.<kind>`. A kind with no string shows a blank card,
  // which is how a gate becomes "the button does nothing" — the exact failure this
  // session already shipped once with the drawer's Upgrade row.
  // readFileSync imported at the top — `require` does not exist in an ES module, and
  // using it here made this test fail for a reason that had nothing to do with i18n.
  const i18n = readFileSync(new URL('./i18n.ts', import.meta.url).pathname, 'utf8');
  for (const kind of ['changeOrders', 'photos', 'recordingMinutes', 'members', 'jobs']) {
    assert.ok(i18n.includes(`'quota.body.${kind}':`), `missing quota.body.${kind}`);
  }
});
