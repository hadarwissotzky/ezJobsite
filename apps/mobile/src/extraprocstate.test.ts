/**
 * Tests for the extra-level pipeline state and the send gate. Run:
 *   cd apps/mobile && node --test src/extraprocstate.test.ts
 *
 * Why these exist rather than "I read it and it looked right": both failures this
 * module guards are invisible by inspection. A max-instead-of-min in a one-line
 * fold looks identical to the correct version, and a `reduce` seeded with
 * 'processed' — the natural way to write "weakest wins" — silently returns
 * 'processed' for an empty group, which is the send gate swinging open on a group
 * that has had nothing verified at all. Neither shows up by reading; both show up
 * here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraProcState, canSendExtra } from './extraprocstate.ts';
import type { ProcState } from './status.ts';

/** Weakest first. The order under test — declared here so a test can walk it. */
const ORDER: readonly ProcState[] = ['captured', 'queued', 'uploaded', 'processed'];

// ── one capture: the group of one is that capture ────────────────────────────

test('a lone capture sets the extra state, for every state', () => {
  for (const s of ORDER) {
    assert.equal(extraProcState([s]), s, `[${s}] should be ${s}`);
  }
});

test('a uniform group reports that state', () => {
  for (const s of ORDER) {
    assert.equal(extraProcState([s, s, s]), s);
  }
});

// ── the weakest wins ─────────────────────────────────────────────────────────

test('every pair reports the weaker of the two, in both orders', () => {
  for (let i = 0; i < ORDER.length; i++) {
    for (let j = 0; j < ORDER.length; j++) {
      const weaker = ORDER[Math.min(i, j)];
      assert.equal(extraProcState([ORDER[i], ORDER[j]]), weaker);
      // Order of the array must not change the answer: photos come back from the
      // db in whatever order the query gave them.
      assert.equal(extraProcState([ORDER[j], ORDER[i]]), weaker);
    }
  }
});

test('THE BUG: one photo still queued means the whole extra is not processed', () => {
  // The recording is done and three photos are done. The fourth is in the outbox.
  // Believing the recording sends a change order with a photo missing.
  const extra: ProcState[] = ['processed', 'processed', 'processed', 'queued'];
  assert.equal(extraProcState(extra), 'queued');
  assert.notEqual(extraProcState(extra), 'processed');
});

test('the weakest member wins no matter where it sits in the array', () => {
  assert.equal(extraProcState(['captured', 'processed', 'processed']), 'captured');
  assert.equal(extraProcState(['processed', 'captured', 'processed']), 'captured');
  assert.equal(extraProcState(['processed', 'processed', 'captured']), 'captured');
});

test('mixed middle states report the weakest, not the most common', () => {
  // Majority is 'uploaded'. A count-based rule would say uploaded and be wrong.
  assert.equal(extraProcState(['uploaded', 'uploaded', 'uploaded', 'queued']), 'queued');
  assert.equal(extraProcState(['queued', 'uploaded', 'processed']), 'queued');
  assert.equal(extraProcState(['uploaded', 'processed']), 'uploaded');
});

test('a big group is dragged down by its single weakest member', () => {
  const many: ProcState[] = Array(20).fill('processed');
  many[13] = 'captured';
  assert.equal(extraProcState(many), 'captured');
});

// ── the empty case ───────────────────────────────────────────────────────────

test('an empty extra does NOT report processed', () => {
  // Nothing was uploaded and nothing was processed, so 'processed' asserts facts
  // no party ever confirmed. Returning the strongest state for the emptiest input
  // is a check that verified nothing reporting success.
  assert.notEqual(extraProcState([]), 'processed');
});

test('an empty extra reports the weakest state', () => {
  assert.equal(extraProcState([]), 'captured');
});

test('an empty extra cannot be sent', () => {
  // The property that actually matters, stated end to end rather than via the
  // state name: no captures, no send.
  assert.equal(canSendExtra(extraProcState([])).ok, false);
});

// ── the send gate ────────────────────────────────────────────────────────────

test('only processed may be sent', () => {
  assert.equal(canSendExtra('processed').ok, true);
  for (const s of ORDER.filter((s) => s !== 'processed')) {
    assert.equal(canSendExtra(s).ok, false, `${s} must not be sendable`);
  }
});

test('a permitted send carries no reason', () => {
  assert.equal(canSendExtra('processed').whyKey, undefined);
});

test('every refusal names a reason the user can read', () => {
  // A disabled Send button with no reason is what makes a man on a ladder tap it
  // eleven times.
  for (const s of ORDER.filter((s) => s !== 'processed')) {
    const why = canSendExtra(s).whyKey;
    assert.ok(why, `${s} refuses with no reason`);
    assert.match(why, /^send\.notReady\./, `${s} returned a non-key: ${why}`);
  }
});

test('each refusing state gives its own distinct reason', () => {
  // Three states, three reasons. Collapsing them to one generic "not ready" would
  // tell the contractor nothing about whether he must find signal or just wait.
  assert.equal(canSendExtra('captured').whyKey, 'send.notReady.notSentYet');
  assert.equal(canSendExtra('queued').whyKey, 'send.notReady.waitingForSignal');
  assert.equal(canSendExtra('uploaded').whyKey, 'send.notReady.processing');

  const keys = ORDER.filter((s) => s !== 'processed').map((s) => canSendExtra(s).whyKey);
  assert.equal(new Set(keys).size, keys.length, 'two states share a reason');
});

test('the gate agrees with the group state: one queued photo blocks the send', () => {
  const gate = canSendExtra(extraProcState(['processed', 'processed', 'queued']));
  assert.equal(gate.ok, false);
  assert.equal(gate.whyKey, 'send.notReady.waitingForSignal');
});

test('a fully processed extra is sendable', () => {
  assert.equal(canSendExtra(extraProcState(['processed', 'processed', 'processed'])).ok, true);
});
