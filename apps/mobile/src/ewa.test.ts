/**
 * R3 two-step authorization — the acceptance criteria, as executable checks.
 * Run: cd apps/mobile && node --test src/ewa.test.ts
 *
 * Same setup as approverrouting.test.ts: Node strips the types, `ewa.ts` imports
 * nothing, so there is no runner, no config and no mocking to maintain.
 *
 * The tests are named after the PRD's ACs where one exists, because the thing that
 * actually rots is the link between a check and the requirement it was written for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLABILITY_CLAUSE,
  ewaClauses,
  ewaDisplayStatus,
  HOUR_MS,
  proceedClause,
  reminderDue,
  reminderDueAt,
  renderEwaCard,
  rollUp,
  settlementClause,
  unpricedState,
  validateEwaTerms,
  isProceedTerm,
  isSettlementHours,
  type EwaTerms,
} from './ewa.ts';

const HOLD: EwaTerms = { proceed: 'hold', settlementHours: 24 };
const TM: EwaTerms = {
  proceed: 'tm_capped', hourlyRateCents: 9_500, capCents: 250_000, settlementHours: 48,
};
const TM_MONEY = { hourlyRate: '$95.00', cap: '$2,500.00' };

// ── AC2: the instrument, and what has to be in it ────────────────────────────

test('AC2: the EWA names itself an Extra Work Authorization, not a change order', () => {
  const text = renderEwaCard({
    terms: HOLD, scope: 'Rotten sill plate found behind the shower wall',
    directedBy: 'Owner', projectName: 'Willow St', whenMs: 0, companyName: 'Kowalski Remodeling',
  });
  assert.ok(text.includes('EXTRA WORK AUTHORIZATION'));
  assert.ok(!/change order/i.test(text), 'must not call itself a change order');
});

test('AC2: billability, proceed term and settlement rule are all in the frozen text', () => {
  const text = renderEwaCard({
    terms: TM, money: TM_MONEY, scope: 'Open the wall', directedBy: 'GC',
    projectName: 'Willow St', whenMs: 0,
  });
  for (const clause of ewaClauses(TM, TM_MONEY)) {
    assert.ok(text.includes(clause), `missing clause: ${clause}`);
  }
  assert.ok(text.includes(BILLABILITY_CLAUSE));
  assert.ok(text.includes('$95.00/hr'));
  assert.ok(text.includes('not to exceed $2,500.00'));
  assert.ok(text.includes('within 48h'));
});

test('AC2: an EWA states no price and does not claim work is on hold when it is not', () => {
  const text = renderEwaCard({
    terms: TM, money: TM_MONEY, scope: 'Open the wall', directedBy: 'GC',
    projectName: 'Willow St', whenMs: 0,
  });
  // The priced card's closing line would be a lie here: T&M work proceeds.
  assert.ok(!text.includes('Nothing proceeds until you approve'));
  assert.ok(!/^Price:/m.test(text), 'step one carries no price');
  assert.ok(text.includes('not an amount'));
});

test('the hold term pauses only the work in that area', () => {
  assert.equal(proceedClause(HOLD), 'Work in this area pauses until the price is approved.');
});

test('the settlement clause says the price supersedes and settles the authorization', () => {
  const s = settlementClause(24);
  assert.ok(s.includes('within 24h'));
  assert.ok(s.includes('supersedes and settles this authorization'));
});

test('the three clauses come back in the order they must appear above Approve', () => {
  const c = ewaClauses(TM, TM_MONEY);
  assert.equal(c.length, 3);
  assert.equal(c[0], BILLABILITY_CLAUSE);
  assert.ok(c[1].startsWith('Work proceeds at'));
  assert.ok(c[2].startsWith('The detailed price will follow'));
});

// ── validation: no uncapped authorization ever gets rendered ─────────────────

test('a T&M term with no cap is refused before anything is signed', () => {
  assert.deepEqual(
    validateEwaTerms({ proceed: 'tm_capped', hourlyRateCents: 9_500, settlementHours: 48 }),
    { k: 'ewa.err.needCap' }
  );
});

test('a T&M term with no hourly rate is refused', () => {
  assert.deepEqual(
    validateEwaTerms({ proceed: 'tm_capped', capCents: 250_000, settlementHours: 48 }),
    { k: 'ewa.err.needRate' }
  );
});

test('a cap below one hour of labour is refused as a typo', () => {
  assert.deepEqual(
    validateEwaTerms({ proceed: 'tm_capped', hourlyRateCents: 25_000, capCents: 8_500, settlementHours: 24 }),
    { k: 'ewa.err.capBelowRate' }
  );
});

test('a hold term carrying numbers the text never mentions is refused', () => {
  assert.deepEqual(
    validateEwaTerms({ proceed: 'hold', capCents: 100_000, settlementHours: 24 }),
    { k: 'ewa.err.holdHasNumbers' }
  );
});

test('valid terms pass', () => {
  assert.equal(validateEwaTerms(HOLD), null);
  assert.equal(validateEwaTerms(TM), null);
});

test('a settlement window the client never agreed to is refused', () => {
  assert.deepEqual(
    validateEwaTerms({ proceed: 'hold', settlementHours: 72 as any }),
    { k: 'ewa.err.badWindow' }
  );
});

test('narrowing helpers reject free strings and stray numbers', () => {
  assert.equal(isProceedTerm('hold'), true);
  assert.equal(isProceedTerm('proceed'), false);
  assert.equal(isSettlementHours(48), true);
  assert.equal(isSettlementHours(72), false);
});

// ── AC3: settlement ──────────────────────────────────────────────────────────

test('AC3: an approved EWA whose step-2 price is approved reads Settled', () => {
  assert.equal(ewaDisplayStatus({ status: 'approved', childStatus: 'approved' }), 'settled');
});

test('an approved EWA whose step 2 is only sent is NOT settled yet', () => {
  assert.equal(ewaDisplayStatus({ status: 'approved', childStatus: 'sent' }), 'approved');
  assert.equal(ewaDisplayStatus({ status: 'approved', childStatus: null }), 'approved');
});

test('a declined EWA stays declined even if a child price was somehow approved', () => {
  assert.equal(ewaDisplayStatus({ status: 'declined', childStatus: 'approved' }), 'declined');
});

test('AC3: the money total shows the settled amount, never the T&M cap', () => {
  const r = rollUp([
    { status: 'settled', amountCents: 0, capCents: 250_000, isEwa: true },
    { status: 'approved', amountCents: 187_500, isEwa: false },   // the step-2 price
  ]);
  assert.equal(r.approvedCents, 187_500, 'only the settled amount');
  assert.equal(r.authorizedCapCents, 0, 'a settled cap is history, not live exposure');
  assert.equal(r.unpricedCount, 0);
});

test('an approved-but-unpriced EWA contributes exposure, not money', () => {
  const r = rollUp([
    { status: 'approved', amountCents: 0, capCents: 250_000, isEwa: true },
  ]);
  assert.equal(r.approvedCents, 0, 'an authorization is not a charge');
  assert.equal(r.awaitingCents, 0);
  assert.equal(r.authorizedCapCents, 250_000);
  assert.equal(r.unpricedCount, 1);
});

test('a sent EWA adds nothing to awaiting-approval money: there is no amount yet', () => {
  const r = rollUp([{ status: 'sent', amountCents: 0, capCents: 250_000, isEwa: true }]);
  assert.equal(r.awaitingCents, 0);
  assert.equal(r.authorizedCapCents, 0);
});

// ── AC5: declined ────────────────────────────────────────────────────────────

test('AC5: a declined EWA is excluded from every total', () => {
  const r = rollUp([
    { status: 'declined', amountCents: 0, capCents: 250_000, isEwa: true },
    { status: 'approved', amountCents: 50_000, isEwa: false },
  ]);
  assert.equal(r.approvedCents, 50_000);
  assert.equal(r.authorizedCapCents, 0);
  assert.equal(r.unpricedCount, 0);
  assert.equal(r.declinedCount, 1);
});

test('a superseded row is excluded too, without being counted as declined', () => {
  const r = rollUp([{ status: 'superseded', amountCents: 90_000, isEwa: false }]);
  assert.equal(r.approvedCents, 0);
  assert.equal(r.declinedCount, 0);
});

// ── AC4: unpriced after the promised window ──────────────────────────────────

const T0 = 1_700_000_000_000;

test('AC4: approved with no step 2 for 48h is flagged Unpriced', () => {
  const u = unpricedState(
    { status: 'approved', approvedAtMs: T0, childSentAtMs: null, settlementHours: 48 },
    T0 + 48 * HOUR_MS + 1
  );
  assert.equal(u.flagged, true);
  assert.equal(u.dueAtMs, T0 + 48 * HOUR_MS);
  assert.equal(u.overdueByMs, 1);
});

test('AC4: not flagged one minute before the promised window closes', () => {
  const u = unpricedState(
    { status: 'approved', approvedAtMs: T0, childSentAtMs: null, settlementHours: 48 },
    T0 + 48 * HOUR_MS - 60_000
  );
  assert.equal(u.flagged, false);
  assert.equal(u.overdueByMs, 0);
});

test('a 24h promise is enforced at 24h, not at AC4s 48h ceiling', () => {
  const u = unpricedState(
    { status: 'approved', approvedAtMs: T0, childSentAtMs: null, settlementHours: 24 },
    T0 + 25 * HOUR_MS
  );
  assert.equal(u.flagged, true, 'the client has a 24h promise in writing');
});

test('sending the step-2 price clears the flag, even before the client answers', () => {
  const u = unpricedState(
    { status: 'approved', approvedAtMs: T0, childSentAtMs: T0 + HOUR_MS, settlementHours: 24 },
    T0 + 100 * HOUR_MS
  );
  assert.equal(u.flagged, false);
});

test('an EWA that was only sent, never approved, is never flagged as unpriced', () => {
  const u = unpricedState(
    { status: 'sent', approvedAtMs: null, childSentAtMs: null, settlementHours: 24 },
    T0 + 1_000 * HOUR_MS
  );
  assert.equal(u.flagged, false);
  assert.equal(u.dueAtMs, null);
});

test('AC4: the first reminder fires at the deadline and then once a day', () => {
  const u = unpricedState(
    { status: 'approved', approvedAtMs: T0, childSentAtMs: null, settlementHours: 48 },
    T0 + 49 * HOUR_MS
  );
  assert.equal(reminderDueAt(u, null), T0 + 48 * HOUR_MS);
  // Reminded at hour 48: nothing again until hour 72.
  assert.equal(reminderDue(u, T0 + 48 * HOUR_MS, T0 + 60 * HOUR_MS), false);
  assert.equal(reminderDue(u, T0 + 48 * HOUR_MS, T0 + 72 * HOUR_MS), true);
});

test('no reminder at all while the EWA is inside its promised window', () => {
  const u = unpricedState(
    { status: 'approved', approvedAtMs: T0, childSentAtMs: null, settlementHours: 48 },
    T0 + HOUR_MS
  );
  assert.equal(reminderDueAt(u, null), null);
  assert.equal(reminderDue(u, null, T0 + HOUR_MS), false);
});
