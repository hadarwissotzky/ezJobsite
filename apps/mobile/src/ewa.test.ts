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
// The same hash ewasend.ts feeds to confirmation_create, so the hash assertions
// below are about the real digest and not a stand-in.
import { sha256 } from 'js-sha256';
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

// ── DEF-2: the flow terms are IN the authorization, not beside it ────────────
//
// An EWA is a change_order row and `priceDraftExtra` sets billing_timing /
// schedule_effect / schedule_days / exclusions on any row still in draft, so an
// authorization can carry them. Before DEF-2 renderEwaCard dropped all four: the
// client was shown "adds 3 days" in the app and signed a document that never
// mentioned it. On an EWA that is worse than on a priced card — there is no price
// yet, so the exclusions are the only stated bound on what was authorized.

const FLOW_BASE = {
  terms: TM, money: TM_MONEY, scope: 'Open the wall', directedBy: 'GC',
  projectName: 'Willow St', whenMs: 0, locale: 'en-US',
};

test('DEF-2: each flow term appears in the frozen authorization when it is set', () => {
  const text = renderEwaCard({
    ...FLOW_BASE,
    exclusions: 'Any drywall repair or permit fees.',
    billingTiming: 'when_completed',
    scheduleEffect: 'adds_days', scheduleDays: 3,
  });
  assert.ok(text.includes('Not included: Any drywall repair or permit fees.'));
  assert.ok(text.includes('Payment is due when the work is completed.'));
  assert.ok(text.includes('Schedule: adds 3 days.'));
});

test('DEF-2: the terms sit after the clause block and before who directed it', () => {
  const text = renderEwaCard({ ...FLOW_BASE, scheduleEffect: 'no_change' });
  assert.ok(text.indexOf(settlementClause(TM.settlementHours)) < text.indexOf('Schedule: no change.'));
  assert.ok(text.indexOf('Schedule: no change.') < text.indexOf('Directed by:'));
});

test('DEF-2: a "not sure yet" schedule is put to the client honestly, not hidden', () => {
  const text = renderEwaCard({ ...FLOW_BASE, scheduleEffect: 'not_sure' });
  assert.ok(text.includes('Schedule impact: to be confirmed.'));
});

test('DEF-2: adding terms adds ONLY those lines — the rest is unchanged', () => {
  // The strongest form of "existing authorizations are unaffected": the new text is
  // the old text with the term lines spliced in at one place, character for
  // character. A change to spacing or to the closing paragraph fails this.
  const without = renderEwaCard(FLOW_BASE);
  const with_ = renderEwaCard({ ...FLOW_BASE, exclusions: 'Permit fees', billingTiming: 'next_invoice' });
  assert.equal(
    with_,
    without.replace('\n\nDirected by:',
      '\nNot included: Permit fees\nBilled on the next invoice.\n\nDirected by:')
  );
});

test('DEF-2: an authorization with no flow answers renders the exact prior text', () => {
  // Explicit nulls and absent keys must both produce the pre-DEF-2 instrument.
  const absent = renderEwaCard(FLOW_BASE);
  const nulled = renderEwaCard({
    ...FLOW_BASE,
    billingTiming: null, scheduleEffect: null, scheduleDays: null, exclusions: null,
  });
  assert.equal(nulled, absent);
  // And the join it used to make is still exactly two newlines.
  assert.ok(absent.includes(
    `${settlementClause(TM.settlementHours)}\n\nDirected by: GC`));
});

test('DEF-2: the T&M cap still appears verbatim once terms are added (240)', () => {
  // 240_shown_content_integrity refuses the insert unless nte_cents formatted as
  // "$2,500.00" is found LITERALLY in shown_content. Appending prose must never
  // displace the cap clause, or every EWA send starts failing at the database.
  const text = renderEwaCard({
    ...FLOW_BASE, exclusions: 'Permit fees', scheduleEffect: 'not_sure',
  });
  assert.ok(text.includes('$2,500.00'));
  assert.ok(text.includes('not to exceed $2,500.00'));
});

test('DEF-2: the terms are inside the hashed instrument, not appended after it', () => {
  // ewasend.ts hashes the string renderEwaCard returns and sends that same string,
  // and 240 recomputes the hash server-side. So "the hash matches" reduces to: the
  // renderer is deterministic, and a changed term changes the text being hashed.
  // A term that did not move the hash would be a term outside the signed document.
  const a = renderEwaCard({ ...FLOW_BASE, scheduleEffect: 'adds_days', scheduleDays: 2 });
  const b = renderEwaCard({ ...FLOW_BASE, scheduleEffect: 'adds_days', scheduleDays: 2 });
  assert.equal(sha256(a), sha256(b), 'renderEwaCard must be deterministic');
  const c = renderEwaCard({ ...FLOW_BASE, scheduleEffect: 'adds_days', scheduleDays: 5 });
  assert.notEqual(sha256(a), sha256(c), '"adds 2 days" and "adds 5 days" must not hash alike');
  assert.notEqual(sha256(a), sha256(renderEwaCard(FLOW_BASE)));
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
