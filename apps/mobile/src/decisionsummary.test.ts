/**
 * R6c — the decision summary. `node --test src/decisionsummary.test.ts`
 *
 * The tests that matter here are the FENCE, not the prose: a clause that appears
 * without a stored row behind it is the failure R6c was written to prevent, and it
 * is invisible on screen because a plausible sentence looks exactly like a true
 * one. So most of these assert absence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionSummary, type SummaryInput, type SummaryMessage } from './decisionsummary.ts';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

function base(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    status: 'sent',
    captured: null, priced: null, sent: null,
    clientName: null, signedBy: null,
    messages: [], unanswered: false, awaitingReply: false,
    amount: null, meName: null,
    ...over,
  };
}

const msg = (side: 'client' | 'contractor', atMs: number): SummaryMessage => ({ side, atMs });

/** The PRD's own worked example: crew captures, owner prices and sends, client
 *  asks, owner answers. R6c AC1. */
function fullHouse(over: Partial<SummaryInput> = {}): SummaryInput {
  return base({
    status: 'sent',
    captured: { name: 'Marco Reyes', atMs: T0 },
    priced: { name: 'Dana Poole', atMs: T0 + HOUR },
    sent: { name: 'Dana Poole', atMs: T0 + 2 * HOUR },
    clientName: 'Sarah Kim',
    amount: '$1,850.00',
    meName: 'Dana Poole',
    messages: [msg('client', T0 + 3 * HOUR), msg('contractor', T0 + 4 * HOUR)],
    ...over,
  });
}

// ── AC1: names each participant's contribution, ends on the owed action ────────

test('AC1: capture, price, send, question and reply each produce a clause', () => {
  const s = decisionSummary(fullHouse());
  assert.ok(s);
  assert.deepEqual(s!.clauses.map((c) => c.k), [
    'r6c.cCaptured',      // Marco — not the device holder
    'r6c.cPricedAtYou',   // Dana is meName
    'r6c.cSentToYou',
    'r6c.cAsked',
    'r6c.cReplied',
  ]);
  assert.equal(s!.traced, 5);
});

test('AC1: each named clause carries the STORED name, not a role word', () => {
  const s = decisionSummary(fullHouse())!;
  assert.equal(s.clauses[0].p?.name, 'Marco Reyes');
  assert.equal(s.clauses[1].p?.name, 'Dana Poole');
  assert.equal(s.clauses[2].p?.to, 'Sarah Kim');
  assert.equal(s.clauses[3].p?.name, 'Sarah Kim');
});

test('AC1: the summary ends on what is owed — the question was answered, so the '
   + 'ball is back with the client', () => {
  const s = decisionSummary(fullHouse())!;
  assert.equal(s.owed.k, 'r6c.owedApproval');
  assert.equal(s.owed.p?.name, 'Sarah Kim');
  assert.equal(s.owed.urgent, false);
});

test('an unanswered client question owes an ANSWER, not an approval', () => {
  const s = decisionSummary(fullHouse({
    messages: [msg('client', T0 + 3 * HOUR)], unanswered: true,
  }))!;
  assert.equal(s.owed.k, 'r6c.owedAnswer');
  assert.equal(s.owed.p?.name, 'Sarah Kim');
  assert.equal(s.owed.urgent, false);
});

test("R5b's 48h flag rides through to the owed clause as urgency", () => {
  const s = decisionSummary(fullHouse({
    messages: [msg('client', T0 + 3 * HOUR)], unanswered: true, awaitingReply: true,
  }))!;
  assert.equal(s.owed.urgent, true);
});

test('clauses are chronological, and facts with no recorded time sort last', () => {
  const s = decisionSummary(fullHouse({
    status: 'approved', signedBy: 'Sarah Kim',
    messages: [msg('client', T0 + 3 * HOUR)],
  }))!;
  assert.deepEqual(s.clauses.map((c) => c.atMs),
    [T0, T0 + HOUR, T0 + 2 * HOUR, T0 + 3 * HOUR, null]);
  assert.equal(s.clauses[4].k, 'r6c.cApprovedBy');
});

// ── the fence: no clause without a stored row ─────────────────────────────────

test('AC2: nothing traceable produces NO summary, so the record can omit the '
   + 'section and still render complete', () => {
  assert.equal(decisionSummary(base()), null);
  assert.equal(decisionSummary(base({ status: 'sent', clientName: 'Sarah Kim' })), null);
});

test('a status alone is not a narrative: only a terminal outcome is a clause', () => {
  // 'sent' with no actor rows and no messages has nothing logged behind it.
  assert.equal(decisionSummary(base({ status: 'sent' })), null);
  // 'approved' is itself a logged outcome, so it stands alone.
  const s = decisionSummary(base({ status: 'approved' }))!;
  assert.deepEqual(s.clauses.map((c) => c.k), ['r6c.cApproved']);
});

test('a nameless or blank actor row produces no clause rather than a nameless person', () => {
  const s = decisionSummary(base({
    captured: { name: '   ', atMs: T0 },
    priced: { name: 'Dana', atMs: T0 + HOUR },
  }))!;
  assert.deepEqual(s.clauses.map((c) => c.k), ['r6c.cPriced']);
});

test('mandate #6: the price clause restates the record field verbatim, and appears '
   + 'only when the record has one', () => {
  const withPrice = decisionSummary(base({
    priced: { name: 'Dana', atMs: T0 }, amount: '$1,850.00',
  }))!;
  assert.equal(withPrice.clauses[0].k, 'r6c.cPricedAt');
  assert.equal(withPrice.clauses[0].p?.amount, '$1,850.00');

  // R10's Decision: no price on the record means no price-shaped hole in the text.
  const noPrice = decisionSummary(base({ priced: { name: 'Dana', atMs: T0 } }))!;
  assert.equal(noPrice.clauses[0].k, 'r6c.cPriced');
  assert.equal(noPrice.clauses[0].p?.amount, undefined);
});

test('an ambiguous client is not named: questions attribute to nobody', () => {
  const s = decisionSummary(fullHouse({ clientName: null }))!;
  const asked = s.clauses.find((c) => c.k.startsWith('r6c.cAsked'))!;
  assert.equal(asked.k, 'r6c.cAskedPlain');
  assert.equal(asked.p?.name, undefined);
  assert.equal(s.clauses.find((c) => c.k.startsWith('r6c.cSent'))!.k, 'r6c.cSentYou');
  assert.equal(s.owed.k, 'r6c.owedApprovalPlain');
});

test('a reply is never attributed: thread_message stores a side, not an author', () => {
  const s = decisionSummary(fullHouse())!;
  const reply = s.clauses.find((c) => c.k.startsWith('r6c.cReplied'))!;
  assert.equal(reply.p?.name, undefined);
});

test('repeat messages are counted, not repeated', () => {
  const s = decisionSummary(fullHouse({
    messages: [
      msg('client', T0 + 3 * HOUR),
      msg('client', T0 + 5 * HOUR),
      msg('contractor', T0 + 6 * HOUR),
      msg('contractor', T0 + 7 * HOUR),
    ],
  }))!;
  const asked = s.clauses.find((c) => c.k.startsWith('r6c.cAsked'))!;
  assert.equal(asked.k, 'r6c.cAskedN');
  assert.equal(asked.p?.n, 2);
  // Anchored at the FIRST message of that side, so the narrative order matches
  // when the client first spoke rather than when they last did.
  assert.equal(asked.atMs, T0 + 3 * HOUR);
  const replied = s.clauses.find((c) => c.k.startsWith('r6c.cReplied'))!;
  assert.equal(replied.k, 'r6c.cRepliedN');
  assert.equal(replied.p?.n, 2);
});

test('messages handed over out of order still anchor on the earliest of each side', () => {
  const s = decisionSummary(fullHouse({
    messages: [msg('client', T0 + 9 * HOUR), msg('client', T0 + 3 * HOUR)],
  }))!;
  assert.equal(s.clauses.find((c) => c.k.startsWith('r6c.cAsked'))!.atMs, T0 + 3 * HOUR);
});

// ── "you" is a pronoun choice, never an attribution ───────────────────────────

test('second person is chosen by name match and falls back to the stored name', () => {
  const them = decisionSummary(base({
    priced: { name: 'Dana Poole', atMs: T0 }, meName: null,
  }))!;
  assert.equal(them.clauses[0].k, 'r6c.cPriced');
  assert.equal(them.clauses[0].p?.name, 'Dana Poole');

  const you = decisionSummary(base({
    priced: { name: 'Dana Poole', atMs: T0 }, meName: '  dana   poole ',
  }))!;
  assert.equal(you.clauses[0].k, 'r6c.cPricedYou');
  // The stored name is still carried, so the render layer can never lose it.
  assert.equal(you.clauses[0].p?.name, 'Dana Poole');
});

// ── precedence: a terminal answer outranks an open question ───────────────────

test('a client who asked at 9 and signed at 11 owes nothing (extrastatus rule)', () => {
  const s = decisionSummary(fullHouse({
    status: 'approved', signedBy: 'Sarah Kim',
    messages: [msg('client', T0 + 3 * HOUR)],
    unanswered: true, awaitingReply: true,   // never answered in-thread
  }))!;
  assert.equal(s.owed.k, 'r6c.owedApprovedBy');
  assert.equal(s.owed.urgent, false);
});

test('declined and superseded each end on their own owed line', () => {
  assert.equal(decisionSummary(fullHouse({ status: 'declined' }))!.owed.k, 'r6c.owedDeclined');
  assert.equal(decisionSummary(fullHouse({ status: 'superseded' }))!.owed.k, 'r6c.owedSuperseded');
});

test('mandate #2: a draft owes a HUMAN send, never an automatic one', () => {
  assert.equal(decisionSummary(fullHouse({ status: 'draft' }))!.owed.k, 'r6c.owedSend');
});

test('an unknown status falls back to the sent branch rather than throwing', () => {
  assert.equal(decisionSummary(fullHouse({ status: 'quantum' }))!.owed.k, 'r6c.owedApproval');
});
