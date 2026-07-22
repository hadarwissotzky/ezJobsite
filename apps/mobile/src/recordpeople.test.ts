/**
 * Tests for R6b's People block and money block.
 * Run: cd apps/mobile && node --test src/recordpeople.test.ts
 *
 * Node 24 strips TypeScript types natively, so this needs no jest, no vitest and
 * no config — the same reason approverrouting.test.ts exists in this shape.
 *
 * What is being protected: the People block is the answer to "who recorded this",
 * which is the first question asked when a record is challenged. Every assertion
 * below is either an AC from PRD R6b or a rule record.ts's header says was already
 * broken once (an actor invented at render time, a timestamp rendered as a person).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assemblePeople, moneyBlock,
  APPROVER_KEY, SIGNED_KEY, DIRECTED_KEY, ROLE_KEY, KIND_KEY,
  type PeopleInput,
} from './recordpeople.ts';

const T0 = 1_753_000_000_000;   // capture
const T1 = T0 + 3_600_000;      // price
const T2 = T1 + 600_000;        // send

const base: PeopleInput = { actors: [], approver: null, whoDirected: null, signedBy: null };

const roleKeys = (rows: ReturnType<typeof assemblePeople>) =>
  rows.map((r) => [r.name, r.contributions.map((c) => c.roleKey)] as const);

// ── PRD R6b AC1 ────────────────────────────────────────────────────────────────
// "Given an extra with a capturing crew member and a separate sender, when the
//  contractor opens its record, then approver (with role), captured-by, and
//  priced/sent-by are each shown with timestamps."
test('AC1: approver with role, captured-by and priced/sent-by each carry a timestamp', () => {
  const rows = assemblePeople({
    ...base,
    approver: { name: 'Sarah Miller', role: 'owner', atMs: T2 },
    actors: [
      { act: 'captured', name: 'Marco Reyes', atMs: T0 },
      { act: 'priced', name: 'Hadar Levy', atMs: T1 },
      { act: 'sent', name: 'Hadar Levy', atMs: T2 },
    ],
  });

  assert.equal(rows.length, 3);
  // R6b's order: the approver first, then the contractor's side.
  assert.deepEqual(rows.map((r) => r.name), ['Sarah Miller', 'Marco Reyes', 'Hadar Levy']);
  assert.equal(rows[0].roleSlug, 'owner');          // role label is renderable
  assert.equal(rows[0].kind, 'approver');
  assert.deepEqual(rows[0].contributions, [{ roleKey: APPROVER_KEY, atMs: T2 }]);
  assert.deepEqual(rows[1].contributions, [{ roleKey: ROLE_KEY.captured, atMs: T0 }]);
  // The separate sender priced AND sent: one person, both contributions, both times.
  assert.deepEqual(rows[2].contributions, [
    { roleKey: ROLE_KEY.priced, atMs: T1 },
    { roleKey: ROLE_KEY.sent, atMs: T2 },
  ]);
  // Every contractor-side contribution has a real moment. AC1 says "each with its
  // timestamp", and a People block with zero timestamps is what this replaced.
  for (const c of [...rows[1].contributions, ...rows[2].contributions]) {
    assert.equal(typeof c.atMs, 'number');
  }
});

test('the solo case: one person who captured, priced and sent is ONE row', () => {
  const rows = assemblePeople({
    ...base,
    actors: [
      { act: 'captured', name: 'Hadar Levy', atMs: T0 },
      { act: 'priced', name: 'hadar  levy', atMs: T1 },   // same human, typed loosely
      { act: 'sent', name: 'Hadar Levy', atMs: T2 },
    ],
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].contributions.map((c) => c.roleKey),
    [ROLE_KEY.captured, ROLE_KEY.priced, ROLE_KEY.sent]);
});

test('the client side never merges into the contractor side, even on the same name', () => {
  const rows = assemblePeople({
    ...base,
    approver: { name: 'Sam Cross', role: 'general_contractor', atMs: T2 },
    actors: [{ act: 'priced', name: 'Sam Cross', atMs: T1 }],
  });
  // Merging would assert that the client priced their own change order.
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'approver');
  assert.equal(rows[1].kind, 'crew');
});

test('entitled-to-approve and actually-signed are both kept, on one row when it is one person', () => {
  const rows = assemblePeople({
    ...base,
    approver: { name: 'Sarah Miller', role: 'owner', atMs: T2 },
    signedBy: 'Sarah Miller',
    whoDirected: 'Sarah Miller',
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].contributions.map((c) => c.roleKey),
    [APPROVER_KEY, SIGNED_KEY, DIRECTED_KEY]);
  assert.equal(rows[0].roleSlug, 'owner');
  // Neither the signature nor who_directed carries a device-side time. Null, never
  // a substituted one — record.ts's rule.
  assert.equal(rows[0].contributions[1].atMs, null);
  assert.equal(rows[0].contributions[2].atMs, null);
});

test('a signer who is not the roster approver stays a separate person', () => {
  const rows = assemblePeople({
    ...base,
    approver: { name: 'Sarah Miller', role: 'owner', atMs: T2 },
    signedBy: 'Tom Miller',
  });
  assert.deepEqual(roleKeys(rows), [
    ['Sarah Miller', [APPROVER_KEY]],
    ['Tom Miller', [SIGNED_KEY]],
  ]);
});

// ── the honesty rules ─────────────────────────────────────────────────────────
test('a nameless or timeless actor row produces no person at all', () => {
  const rows = assemblePeople({
    ...base,
    actors: [
      { act: 'captured', name: '   ', atMs: T0 },
      { act: 'priced', name: 'Hadar', atMs: Number.NaN },
    ],
    approver: { name: '', role: 'owner', atMs: T2 },
  });
  assert.deepEqual(rows, []);
});

test('a replayed capture/price keeps the earliest; a re-send keeps the latest', () => {
  const rows = assemblePeople({
    ...base,
    actors: [
      { act: 'priced', name: 'Hadar', atMs: T1 + 5_000 },
      { act: 'priced', name: 'Hadar', atMs: T1 },
      { act: 'sent', name: 'Hadar', atMs: T2 },
      { act: 'sent', name: 'Dana', atMs: T2 + 90_000 },
    ],
  });
  const hadar = rows.find((r) => r.name === 'Hadar')!;
  assert.deepEqual(hadar.contributions, [{ roleKey: ROLE_KEY.priced, atMs: T1 }]);
  // The latest send is who is holding it now; the earlier one is still in history.
  const dana = rows.find((r) => r.name === 'Dana')!;
  assert.deepEqual(dana.contributions, [{ roleKey: ROLE_KEY.sent, atMs: T2 + 90_000 }]);
});

test('an approver whose role was never recorded still appears, without a role label', () => {
  const rows = assemblePeople({
    ...base, approver: { name: 'Sarah Miller', role: null, atMs: T2 },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].roleSlug, null);
});

// ── PRD R6b AC2 / R10 ─────────────────────────────────────────────────────────
test('AC2: a Decision has no price block at all; an Extra shows the contractor price', () => {
  assert.deepEqual(moneyBlock({ kind: 'decision' }), { show: 'noCost' });
  assert.deepEqual(
    moneyBlock({ kind: 'extra', amount: '$1,850.00', nte: null, isMini: false }),
    { show: 'price', amount: '$1,850.00', nte: null, isMini: false }
  );
  assert.equal(KIND_KEY.decision, 'erec.kindDecision');
  assert.equal(KIND_KEY.extra, 'erec.kindExtra');
});
