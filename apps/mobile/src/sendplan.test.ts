/**
 * Who you send to decides the stage.
 *   cd apps/mobile && node --test src/sendplan.test.ts
 *
 * These are lifecycle assertions wearing UI clothes. Getting `review` where `approval`
 * was meant leaves a priced extra sitting in draft while the contractor believes the
 * client has it; getting `approval` where `review` was meant sends a signing link to
 * somebody's foreman. Both are silent — the button says "Sent" either way.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseClient, movesToNegotiation, sendPlan, toggleMember,
         type SendSelection } from './sendplan.ts';

const none: SendSelection = { clientId: null, memberIds: [] };

/* ------------------------------------------------------------------- plan -- */

test('nothing selected is refused, not silently treated as a send', () => {
  assert.deepEqual(sendPlan(none), { kind: 'nothing' });
  assert.equal(movesToNegotiation(none), false);
});

test('teammates only keeps the extra a DRAFT', () => {
  const p = sendPlan({ clientId: null, memberIds: ['m1', 'm2'] });
  assert.equal(p.kind, 'review');
  assert.deepEqual(p.kind === 'review' && p.memberIds, ['m1', 'm2']);
  // The whole point: no client, no negotiation.
  assert.equal(movesToNegotiation({ clientId: null, memberIds: ['m1'] }), false);
});

test('a client moves it to negotiation', () => {
  const p = sendPlan({ clientId: 'c1', memberIds: [] });
  assert.equal(p.kind, 'approval');
  assert.equal(p.kind === 'approval' && p.clientId, 'c1');
  assert.equal(movesToNegotiation({ clientId: 'c1', memberIds: [] }), true);
});

test('a client AND teammates does both — send it, and tell the foreman', () => {
  const p = sendPlan({ clientId: 'c1', memberIds: ['m1'] });
  assert.equal(p.kind, 'approval');
  assert.deepEqual(p.kind === 'approval' && p.memberIds, ['m1']);
});

test('empty member ids are dropped rather than sent to nobody', () => {
  const p = sendPlan({ clientId: null, memberIds: ['', 'm1', ''] });
  assert.deepEqual(p.kind === 'review' && p.memberIds, ['m1']);
  // ...and a list of ONLY blanks is nothing at all, not an empty review.
  assert.deepEqual(sendPlan({ clientId: null, memberIds: ['', ''] }), { kind: 'nothing' });
});

/* --------------------------------------------------------------- toggling -- */

test('tapping a member twice removes them — nobody is notified twice', () => {
  let s: SendSelection = none;
  s = toggleMember(s, 'm1');
  s = toggleMember(s, 'm2');
  assert.deepEqual(s.memberIds, ['m1', 'm2']);
  s = toggleMember(s, 'm1');
  assert.deepEqual(s.memberIds, ['m2']);
});

test('a member cannot end up in the list twice', () => {
  const s = toggleMember(toggleMember(toggleMember(none, 'm1'), 'm1'), 'm1');
  assert.deepEqual(s.memberIds, ['m1']);
});

test('choosing a client replaces the previous one — never two signers', () => {
  // Two "clients" would be two signatures on one instrument, and the record has no way
  // to say which of them agreed to the price (D4).
  let s: SendSelection = chooseClient(none, 'c1');
  s = chooseClient(s, 'c2');
  assert.equal(s.clientId, 'c2');
});

test('tapping the chosen client again clears it', () => {
  const s = chooseClient(chooseClient(none, 'c1'), 'c1');
  assert.equal(s.clientId, null);
  assert.deepEqual(sendPlan(s), { kind: 'nothing' });
});

test('choosing a client leaves the members alone, and vice versa', () => {
  let s: SendSelection = toggleMember(none, 'm1');
  s = chooseClient(s, 'c1');
  assert.deepEqual(s, { clientId: 'c1', memberIds: ['m1'] });
  s = toggleMember(s, 'm2');
  assert.equal(s.clientId, 'c1');
  assert.deepEqual(s.memberIds, ['m1', 'm2']);
});
