/**
 * Tests for R5c routing. Run: npm run test  (node --test, no dependencies)
 *
 * This is the repo's first JavaScript test file. It exists because
 * `approverrouting.ts` decides who a priced commitment is addressed to, that is a
 * pure function of its inputs, and "I read it and it looked right" is how the
 * ledger ordering bug and the is_mini misreading both got as far as they did.
 *
 * Node 24 strips TypeScript types natively, so this needs no jest, no vitest, no
 * ts-node and no config. The cost of the first test being cheap is the reason
 * there is a first test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestApprover,
  EXTRA_TYPES,
  APPROVER_ROLES,
  isExtraType,
  isApproverRole,
  type Approver,
} from './approverrouting.ts';

const p = (id: string, name: string, role: string, lastUsedMs = 0): Approver =>
  ({ id, name, role, lastUsedMs }) as Approver;

const DANA = p('a1', 'Dana', 'designer', 100);
const GC = p('a2', 'Marco', 'general_contractor', 200);
const SARAH = p('a3', 'Sarah', 'owner', 300);
const SPEC = p('a4', 'Priya', 'internal_specialist', 50);

// ── the acceptance criteria, as written in the PRD ────────────────────────────

test('AC: a finish selection is pre-filled to the designer WHEN she can approve costs', () => {
  const danaSigns = { ...DANA, canBindMoney: true };
  const s = suggestApprover('finish', [danaSigns, GC, SARAH]);
  assert.equal(s.kind, 'suggested');
  if (s.kind !== 'suggested') return;
  assert.equal(s.approver.name, 'Dana');
  assert.equal(s.reasonKey, 'r5c.becauseRole');
  // The reason must carry BOTH halves or the sender cannot check the logic.
  assert.equal(s.reasonParams.role, 'designer');
  assert.equal(s.reasonParams.type, 'finish');
  assert.equal(s.bindsMoney, true);
});

/**
 * This test replaces one that asserted the OPPOSITE and was wrong.
 *
 * The original locked in "finish -> the designer" unconditionally, straight from
 * R5c's wording. Codex caught it (2026-07-21): every extra in this app carries a
 * price, a designer can choose a finish but usually cannot bind the homeowner to
 * $1,850, and an approval from someone without that authority does not bind --
 * the precise failure R5c opens by naming. The test had made the bug permanent.
 */
test('a finish extra does NOT go to the designer over an owner who can approve costs', () => {
  const s = suggestApprover('finish', [DANA, SARAH]); // Dana's authority unconfirmed
  assert.equal(s.kind, 'suggested');
  if (s.kind !== 'suggested') return;
  assert.equal(s.approver.name, 'Sarah', 'money authority outranks subject-matter fit');
  assert.equal(s.reasonKey, 'r5c.becauseFallback');
  assert.equal(s.bindsMoney, true);
});

test('AC still holds when NOBODY can approve costs: designer suggested, flagged unconfirmed', () => {
  // R5c's AC wants the designer pre-filled. It must still happen -- with the caveat,
  // because on plenty of jobs the designer really does hold signing authority and
  // only the contractor knows it. Suggest, never decide; never suggest silently.
  const s = suggestApprover('finish', [DANA, SPEC]);
  assert.equal(s.kind, 'suggested');
  if (s.kind !== 'suggested') return;
  assert.equal(s.approver.name, 'Dana');
  assert.equal(s.reasonKey, 'r5c.becauseRoleUnconfirmed');
  assert.equal(s.bindsMoney, false, 'the caveat must be machine-readable, not just prose');
});

test('an explicit no overrides the role default', () => {
  const gcNoAuthority = { ...GC, canBindMoney: false };
  const s = suggestApprover('structural', [gcNoAuthority, SARAH]);
  assert.equal(s.kind, 'suggested');
  if (s.kind !== 'suggested') return;
  assert.equal(s.approver.name, 'Sarah');
});

test('untyped prefers someone who can approve costs over a more recent one who cannot', () => {
  const recentDesigner = { ...DANA, lastUsedMs: 9999 };
  const s = suggestApprover(null, [recentDesigner, SARAH]);
  assert.equal(s.kind, 'suggested');
  if (s.kind !== 'suggested') return;
  assert.equal(s.approver.name, 'Sarah');
});

test('AC: no roster member for the wanted role -> asks who approves', () => {
  // A job with nobody on it at all.
  const s = suggestApprover('finish', []);
  assert.equal(s.kind, 'needs_approver');
  if (s.kind !== 'needs_approver') return;
  // It must say WHICH role it wanted, or the quick-add cannot pre-select it.
  assert.equal(s.wantedRole, 'designer');
});

test('AC: classification unavailable -> untyped falls back to recents, not blocked', () => {
  const s = suggestApprover(null, [DANA, GC, SARAH]);
  assert.equal(s.kind, 'suggested');
  if (s.kind !== 'suggested') return;
  assert.equal(s.approver.name, 'Sarah', 'most recently used wins');
  assert.equal(s.reasonKey, 'r5c.becauseRecent');
});

// ── the fallback chain ────────────────────────────────────────────────────────

test('wanted role missing -> owner is preferred over anyone else present', () => {
  // No designer on this job. Owner and a specialist are.
  const s = suggestApprover('finish', [SARAH, SPEC]);
  assert.equal(s.kind, 'suggested');
  if (s.kind !== 'suggested') return;
  assert.equal(s.approver.name, 'Sarah');
  assert.equal(s.reasonKey, 'r5c.becauseFallback');
});

test('no owner either -> the GC is next', () => {
  const s = suggestApprover('finish', [SPEC, GC]);
  assert.equal(s.kind, 'suggested');
  if (s.kind !== 'suggested') return;
  assert.equal(s.approver.name, 'Marco');
  assert.equal(s.reasonKey, 'r5c.becauseFallback');
});

test('roster has people but none in the chain -> most recent, honestly labelled', () => {
  // Only a specialist and a property manager. Neither is preferred nor a fallback.
  const pm = p('a5', 'Ann', 'property_manager', 999);
  const s = suggestApprover('finish', [SPEC, pm]);
  assert.equal(s.kind, 'suggested');
  if (s.kind !== 'suggested') return;
  assert.equal(s.approver.name, 'Ann');
  assert.equal(
    s.reasonKey, 'r5c.becauseRecent',
    'must NOT claim a role reason when the role does not match'
  );
});

// ── determinism ───────────────────────────────────────────────────────────────

test('ties break alphabetically, never on row order', () => {
  const zoe = p('z', 'Zoe', 'owner', 500);
  const abe = p('a', 'Abe', 'owner', 500);
  const one = suggestApprover(null, [zoe, abe]);
  const two = suggestApprover(null, [abe, zoe]);
  assert.equal(one.kind, 'suggested');
  assert.equal(two.kind, 'suggested');
  if (one.kind !== 'suggested' || two.kind !== 'suggested') return;
  assert.equal(one.approver.name, 'Abe');
  assert.equal(
    one.approver.name, two.approver.name,
    'the same roster in a different order must suggest the same person'
  );
});

test('suggestApprover never mutates the roster it is given', () => {
  const roster = [DANA, GC, SARAH];
  const before = roster.map((a) => a.id).join(',');
  suggestApprover('finish', roster);
  suggestApprover(null, roster);
  assert.equal(roster.map((a) => a.id).join(','), before);
});

test('a blank-named roster row is ignored, not suggested', () => {
  const ghost = p('g', '   ', 'designer', 9999);
  const s = suggestApprover('finish', [ghost, SARAH]);
  assert.equal(s.kind, 'suggested');
  if (s.kind !== 'suggested') return;
  assert.notEqual(s.approver.name.trim(), '', 'never address a commitment to nobody');
  assert.equal(s.approver.name, 'Sarah');
});

// ── every type resolves; no silent hole in the map ────────────────────────────

test('every declared extra type produces a suggestion against a full roster', () => {
  const full = APPROVER_ROLES.map((r, i) => p(`x${i}`, `P${i}`, r, i));
  for (const t of EXTRA_TYPES) {
    const s = suggestApprover(t, full);
    assert.equal(s.kind, 'suggested', `${t} produced no suggestion`);
  }
});

test('every declared extra type asks for someone when the roster is empty', () => {
  for (const t of EXTRA_TYPES) {
    const s = suggestApprover(t, []);
    assert.equal(s.kind, 'needs_approver', `${t} did not ask for an approver`);
    if (s.kind !== 'needs_approver') continue;
    assert.ok(s.wantedRole, `${t} asked for an approver without naming a role`);
  }
});

test('type and role guards reject anything not declared', () => {
  assert.ok(isExtraType('finish'));
  assert.ok(!isExtraType('Finish'), 'case matters: these are stored values');
  assert.ok(!isExtraType('plumbing'));
  assert.ok(!isExtraType(null));
  assert.ok(isApproverRole('general_contractor'));
  assert.ok(!isApproverRole('gc'));
  assert.ok(!isApproverRole(undefined));
});
