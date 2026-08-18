/**
 * What happens at the send button when the credits run out.
 *   cd apps/mobile && node --test src/sendgate.test.ts
 *
 * hadar, 2026-08-17: "queue it — but needs to prompt the user letting them know that
 * they cannot send if they don't have credits."
 *
 * Both halves are failures if dropped. Refusing loses the change order the product
 * exists to save; queueing SILENTLY is worse than refusing, because he walks away
 * believing the client has it. These assert that the third state exists, is reachable,
 * and always carries something to say.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { decideSend, queuedSummaryKey } from './sendgate.ts';

/* ------------------------------------------------------------------ sending -- */

test('credits available sends', () => {
  assert.deepEqual(decideSend({ metered: true, available: 3 }), { kind: 'send' });
});

test('an unlimited subscription never consults a balance', () => {
  // Core and Crew are unlimited (hadar, 2026-08-17: keep unlimited, fix the cost).
  // A subscriber whose balance read failed must not be queued behind a number that
  // does not apply to him — so `available: 0` is irrelevant when metered is false.
  assert.deepEqual(decideSend({ metered: false, available: 0 }), { kind: 'send' });
});

/* ------------------------------------------------------------------ queuing -- */

test('zero credits QUEUES — it does not refuse', () => {
  const d = decideSend({ metered: true, available: 0 });
  assert.equal(d.kind, 'queued');
});

test('the queued state always carries the reason AND the fix', () => {
  // A queue with nothing to say is the silent-acknowledgement failure mandate #1 is
  // written against, one step further down the pipe.
  const d = decideSend({ metered: true, available: 0 });
  assert.equal(d.kind, 'queued');
  if (d.kind !== 'queued') return;
  assert.ok(d.reasonKey, 'must say why it did not go');
  assert.ok(d.fixKey, 'must say what would make it go');
});

test('a negative balance queues too, and never sends', () => {
  // R-6.3: a refunded pack can drive the balance negative against already-consumed
  // credits. Signed documents are never clawed back; further sends wait.
  assert.equal(decideSend({ metered: true, available: -4 }).kind, 'queued');
});

/* ----------------------------------------------------------------- refusals -- */

test('a plan-limit refusal beats the credit check', () => {
  // Buying credits does not lift a photo cap. Offering to sell one here would take
  // money for something that will not unblock him.
  const d = decideSend({
    metered: true, available: 0, quotaRefusalKey: 'quota.body.photos',
  });
  assert.equal(d.kind, 'refused');
  assert.equal(d.kind === 'refused' && d.reasonKey, 'quota.body.photos');
});

test('a plan-limit refusal applies even with credits in hand', () => {
  const d = decideSend({
    metered: true, available: 99, quotaRefusalKey: 'quota.body.recordingMinutes',
  });
  assert.equal(d.kind, 'refused');
});

test('a null refusal key is not a refusal', () => {
  // The caller passes through `checkSendQuota`'s result directly; null/undefined is the
  // ok case and must not be truthy-tested into a block.
  assert.equal(decideSend({ metered: true, available: 1, quotaRefusalKey: null }).kind, 'send');
});

/* ------------------------------------------------------------------ summary -- */

test('one waiting reads differently from several', () => {
  assert.equal(queuedSummaryKey(1).k, 'gate.queuedOne');
  assert.equal(queuedSummaryKey(4).k, 'gate.queuedN');
  assert.equal(queuedSummaryKey(4).p.n, '4');
});
