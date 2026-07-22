/**
 * Tests for R7's per-item status derivation. Run:
 *   cd apps/mobile && node --test src/extrastatus.test.ts
 *
 * The reason these exist rather than "I read it and it looked right": the two bugs
 * this module fixes were both invisible-by-inspection. "Discussing" was missing
 * from a switch statement and fell through to `default: 'Draft'`, so an item a
 * client was actively questioning read as one that had never been sent. Nothing
 * about that switch looked wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayStatus, chipKey, isAwaiting, canSupersede, isStoredStatus,
  LEDGER_STATUSES, STORED_STATUSES,
} from './extrastatus.ts';

const quiet = { openQuestions: 0 };
const asked = { openQuestions: 1 };

// ── PRD R7 AC: "per-item statuses (approved/pending/discussing/declined/
//    superseded) are shown" ─────────────────────────────────────────────────────

test('AC: every status R7 names is reachable from displayStatus', () => {
  const reached = new Set([
    displayStatus('draft', quiet),
    displayStatus('sent', quiet),
    displayStatus('sent', asked),
    displayStatus('approved', quiet),
    displayStatus('declined', quiet),
    displayStatus('superseded', quiet),
  ]);
  for (const s of LEDGER_STATUSES) {
    assert.ok(reached.has(s), `${s} is in the vocabulary but nothing produces it`);
  }
});

test('a sent extra with an open client question reads as discussing, not sent', () => {
  assert.equal(displayStatus('sent', asked), 'discussing');
  // The bug this replaces: no discussing case at all, so it fell to 'Draft'.
  assert.notEqual(displayStatus('sent', asked), 'draft');
});

test('a sent extra with no questions is still just sent', () => {
  assert.equal(displayStatus('sent', quiet), 'sent');
});

// ── the precedence rule ───────────────────────────────────────────────────────

test('a terminal answer outranks an earlier question', () => {
  // She asked at 9am and signed at 11am. The row is approved.
  assert.equal(displayStatus('approved', asked), 'approved');
  assert.equal(displayStatus('declined', asked), 'declined');
  assert.equal(displayStatus('superseded', asked), 'superseded');
});

test('a question against a row this device still thinks is a draft wins', () => {
  // A question cannot exist unless a link went out, so the local row is behind on
  // sync. Saying "Draft" would tell the contractor nothing is owed.
  assert.equal(displayStatus('draft', asked), 'discussing');
});

test('an unknown stored status falls back to draft rather than throwing', () => {
  assert.equal(displayStatus('whatever_v9', quiet), 'draft');
  assert.equal(displayStatus('', quiet), 'draft');
});

test('signals are optional — a caller with no question data still gets a status', () => {
  assert.equal(displayStatus('sent'), 'sent');
  assert.equal(displayStatus('approved'), 'approved');
});

// ── totals bucketing ──────────────────────────────────────────────────────────

test('discussing money stays in the awaiting bucket', () => {
  assert.equal(isAwaiting('discussing'), true);
  assert.equal(isAwaiting('sent'), true);
  assert.equal(isAwaiting('approved'), false);
  assert.equal(isAwaiting('declined'), false);
  assert.equal(isAwaiting('superseded'), false);
  assert.equal(isAwaiting('draft'), false);
});

// ── supersession legality ─────────────────────────────────────────────────────

test('only a sent extra may be superseded', () => {
  assert.equal(canSupersede('sent'), true);
  assert.equal(canSupersede('draft'), false);
  assert.equal(canSupersede('approved'), false, 'a signed approval is not retired by a revision');
  assert.equal(canSupersede('declined'), false);
  assert.equal(canSupersede('superseded'), false, 'twice would write a second lineage row');
});

// ── vocabulary hygiene ────────────────────────────────────────────────────────

test('the stored vocabulary matches the databases CHECK constraint exactly', () => {
  // 030_change_order.sql and CHANGE_ORDER_DDL both say:
  //   check (status in ('draft','sent','approved','declined','superseded'))
  assert.deepEqual([...STORED_STATUSES],
    ['draft', 'sent', 'approved', 'declined', 'superseded']);
  assert.equal(isStoredStatus('discussing'), false,
    'discussing is derived; storing it would break the CHECK on both sides');
  assert.equal(isStoredStatus('sent'), true);
});

test('every status has its own chip key — two statuses must never share a label', () => {
  const keys = LEDGER_STATUSES.map(chipKey);
  assert.equal(new Set(keys).size, LEDGER_STATUSES.length);
  assert.equal(chipKey('discussing'), 'co.chip.discussing');
});
