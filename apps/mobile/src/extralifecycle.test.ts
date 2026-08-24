/**
 * Tests for the extra's lifecycle authority. Run:
 *   cd apps/mobile && node --test src/extralifecycle.test.ts
 *
 * THESE EXIST BECAUSE DEF-1 WAS INVISIBLE BY INSPECTION. `UPDATE change_order SET
 * status='approved' WHERE id=?` looks exactly like a correct line of code. What is
 * missing from it is not visible in it, and it was missing in two files at once.
 * So the transition table is driven EXHAUSTIVELY below — every ordered pair of the
 * five stored statuses is asserted, not just the ones somebody thought of — and
 * the pairs that must never be legal are named individually so a future edit that
 * opens one has to delete a test with a reason written on it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stageOf, canTransition, canAdoptServerStatus, assertTransition, LEGAL_TRANSITIONS,
  canEdit, canSend, canDelete, canRemind, canRevise, canReply, canApprove,
  canSupersede, canCreateLinkedExtra,
  STORED_STATUSES, displayStatus, isAwaiting,
} from './extralifecycle.ts';

const ALL = [...STORED_STATUSES];

// ── D1's three stages (REQ-LC2) ───────────────────────────────────────────────

test('every stored status maps to exactly one stage', () => {
  assert.equal(stageOf('draft'), 'draft');
  assert.equal(stageOf('sent'), 'negotiation');
  assert.equal(stageOf('approved'), 'locked');
  assert.equal(stageOf('declined'), 'locked');
  assert.equal(stageOf('superseded'), 'locked');
});

test('an unknown status is LOCKED, not draft — it must not inherit draft powers', () => {
  // displayStatus falls back to 'draft' because that is a harmless LABEL. A stage
  // is a permission set, and 'draft' permits editing and deleting.
  assert.equal(stageOf('whatever_v9'), 'locked');
  assert.equal(stageOf(''), 'locked');
  assert.equal(canEdit('whatever_v9'), false);
  assert.equal(canDelete('whatever_v9'), false);
  assert.equal(canApprove('whatever_v9'), false);
});

test("'locked' is the seal, and it is NOT the same claim as 'somebody signed'", () => {
  // The stage says declined and approved are equally sealed; only the STATUS says
  // which of them carries an approval. Nothing may read stage 'locked' as a yes.
  assert.equal(stageOf('declined'), stageOf('approved'));
  assert.notEqual(displayStatus('declined'), displayStatus('approved'));
});

// ── REQ-LC7: the transition table, exhaustively ───────────────────────────────

/** Every edge the spec allows, and nothing else. The test owns this list
 *  independently of the module so a change to the module cannot quietly agree
 *  with itself. */
const LEGAL: ReadonlyArray<readonly [string, string]> = [
  ['draft', 'sent'],
  ['draft', 'approved'],   // the device is behind on sync — mandate #7
  ['draft', 'declined'],
  ['sent', 'approved'],
  ['sent', 'declined'],
  ['sent', 'superseded'],
  // The withdrawal (421, hadar 2026-08-24). It amends REQ-LC20, which had named
  // "cancel" as a move that does not exist. Only from `sent`: a draft has no live
  // instrument and nobody to tell, and an approved record is frozen forever.
  ['sent', 'cancelled'],
];

test('every one of the 36 ordered pairs answers exactly as the spec says', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const want = LEGAL.some(([f, t]) => f === from && t === to);
      assert.equal(canTransition(from, to), want, `${from} → ${to}`);
    }
  }
});

test('DEF-1: a superseded or declined row can NEVER reach approved', () => {
  // This is the defect. Both were reachable through applyLocalApproval and
  // signApproval, which carried no precondition at all.
  assert.equal(canTransition('superseded', 'approved'), false,
    'a retired version must never carry a signature');
  assert.equal(canTransition('declined', 'approved'), false,
    "a client's recorded NO must never become a yes");
  assert.equal(canApprove('superseded'), false);
  assert.equal(canApprove('declined'), false);
  assert.equal(canApprove('approved'), false, 'and it is not approved twice either');
});

test('the four terminal states have no successors at all — that empty list IS the seal', () => {
  for (const s of ['approved', 'declined', 'superseded', 'cancelled'] as const) {
    assert.deepEqual([...LEGAL_TRANSITIONS[s]], [], s);
    for (const to of ALL) assert.equal(canTransition(s, to), false, `${s} → ${to}`);
  }
});

test('a sent extra never goes back to draft', () => {
  assert.equal(canTransition('sent', 'draft'), false);
});

test('a draft is corrected, never superseded — no ghost version in the ledger', () => {
  assert.equal(canTransition('draft', 'superseded'), false);
});

test('a status that does not move is not a transition', () => {
  // A write site guards an UPDATE with this. A no-op that returns true lets a
  // caller report a transition that never happened (REQ-LC8).
  for (const s of ALL) assert.equal(canTransition(s, s), false, `${s} → ${s}`);
});

test('an unknown status is not a licence in either direction', () => {
  assert.equal(canTransition('sent', 'settled'), false, 'settled is derived, never stored');
  assert.equal(canTransition('discussing', 'approved'), false, 'discussing is derived too');
  assert.equal(canTransition('viewed', 'approved'), false);
});

// ── assertTransition: the write-site guard ────────────────────────────────────

test('assertTransition is silent on a legal edge and throws on every illegal one', () => {
  for (const [f, t] of LEGAL) assert.doesNotThrow(() => assertTransition(f, t));
  assert.throws(() => assertTransition('approved', 'declined', 'co-7'),
    /illegal extra transition approved → declined on co-7/);
});

test('the refusal names what WOULD have been legal, so a log line is diagnosable', () => {
  assert.throws(() => assertTransition('superseded', 'approved'), /sealed/);
  assert.throws(() => assertTransition('sent', 'draft'), /approved, declined, superseded/);
  assert.throws(() => assertTransition('nonsense', 'approved'), /not a stored status/);
});

// ── capabilities ──────────────────────────────────────────────────────────────

test('only a draft may be edited or deleted', () => {
  for (const s of ALL) {
    const want = s === 'draft';
    assert.equal(canEdit(s), want, `canEdit(${s})`);
    assert.equal(canDelete(s), want, `canDelete(${s})`);
  }
});

test('only a draft may be sent — the lifecycle half of the gate', () => {
  assert.equal(canSend('draft'), true);
  for (const s of ['sent', 'approved', 'declined', 'superseded'] as const) {
    assert.equal(canSend(s), false, s);
  }
});

test('only a sent extra may be reminded, replied to, or revised', () => {
  for (const s of ALL) {
    const want = s === 'sent';
    assert.equal(canRemind(s), want, `canRemind(${s})`);
    assert.equal(canReply(s), want, `canReply(${s})`);
    assert.equal(canRevise(s), want, `canRevise(${s})`);
  }
});

test('DEF-4: the thread closes on the answer, both ways', () => {
  // The server (308:94) rejects a reply once a response exists, permanently. A
  // composer offered here produces a parked message the UI calls sent.
  assert.equal(canReply('approved'), false);
  assert.equal(canReply('declined'), false);
});

test('canRevise IS canSupersede — one edge, not two rules that can drift', () => {
  for (const s of ALL) assert.equal(canRevise(s), canSupersede(s), s);
});

test('an answer may be recorded against draft or sent, and nothing else', () => {
  assert.equal(canApprove('draft'), true, 'the device may be behind on sync — mandate #7');
  assert.equal(canApprove('sent'), true);
  assert.equal(canApprove('approved'), false);
  assert.equal(canApprove('declined'), false);
  assert.equal(canApprove('superseded'), false);
});

test('D6: a follow-on extra may only be linked to an APPROVED one', () => {
  // superseded_by is a forward pointer WITHIN a negotiation; origin_change_order_id
  // is a backward pointer ACROSS the seal. Pointing origin at a sent row would be
  // supersession wearing a different name (REQ-LC31 rule 1).
  assert.equal(canCreateLinkedExtra('approved'), true);
  for (const s of ['draft', 'sent', 'declined', 'superseded'] as const) {
    assert.equal(canCreateLinkedExtra(s), false, s);
  }
});

// ── ownership: this module must not have grown a second display vocabulary ────

test('display functions are re-exported from extrastatus, not reimplemented', () => {
  assert.equal(displayStatus('sent', { openQuestions: 1 }), 'discussing');
  assert.equal(isAwaiting('discussing'), true);
  assert.deepEqual([...STORED_STATUSES],
    ['draft', 'sent', 'approved', 'declined', 'superseded', 'cancelled']);
});

// ── adoption is not action ────────────────────────────────────────────────────

test('canAdoptServerStatus lets a device LEARN a move it could not have MADE', () => {
  // The pair that broke it. `draft → superseded` is correctly absent from
  // LEGAL_TRANSITIONS (a draft is corrected, not retired), but a second handset that
  // only ever saw the draft must still be able to learn that the server took the row
  // through sent to superseded. Gating the pull on the ACTION table refused this on
  // every tick forever, leaving a retired version rendering as an editable draft.
  assert.equal(canTransition('draft', 'superseded'), false, 'still not an act this device may do');
  assert.equal(canAdoptServerStatus('draft', 'superseded'), true, 'but a fact it may learn');
});

test('adoption is MONOTONIC — DEF-1 cannot walk back in through the pull', () => {
  for (const [from, to] of [
    ['draft', 'sent'], ['draft', 'approved'], ['draft', 'declined'],
    ['sent', 'approved'], ['sent', 'declined'], ['sent', 'superseded'],
  ] as const) {
    assert.equal(canAdoptServerStatus(from, to), true, `${from} → ${to}`);
  }
  for (const [from, to] of [
    // Backwards: a signature is never un-signed by a pull.
    ['approved', 'sent'], ['declined', 'sent'], ['superseded', 'sent'],
    ['sent', 'draft'], ['approved', 'draft'],
    // Terminal to a DIFFERENT terminal: the two sides genuinely disagree, and the
    // repair for the one case that can produce it belongs to drainSupersessions.
    ['superseded', 'approved'], ['declined', 'approved'], ['approved', 'declined'],
  ] as const) {
    assert.equal(canAdoptServerStatus(from, to), false, `${from} → ${to}`);
  }
});

test('an identical status is not an adoption, and an unknown one is never a licence', () => {
  for (const s of STORED_STATUSES) assert.equal(canAdoptServerStatus(s, s), false, s);
  assert.equal(canAdoptServerStatus('draft', 'viewed'), false);
  assert.equal(canAdoptServerStatus('viewed', 'approved'), false);
});

/**
 * A WITHDRAWAL CANNOT UNDO A SIGNATURE (421). The server refuses the cancel outright
 * when a confirmed response exists; these are the local half of the same rule, so a
 * device that is behind on sync cannot reach the state either.
 */
test('cancelled is terminal and can never become approved', () => {
  assert.equal(canTransition('cancelled', 'approved'), false,
    'withdrawing then approving would let a contractor un-sign a signed document');
  assert.equal(canApprove('cancelled'), false);
  assert.equal(canTransition('approved', 'cancelled'), false,
    'an approved record is frozen and permanent — mandate #1');
  assert.equal(canTransition('draft', 'cancelled'), false,
    'a draft has no live instrument and nobody to tell; that act is delete, not withdraw');
});
