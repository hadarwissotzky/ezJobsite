/**
 * The refusal wording is the point. A jobsite that will not delete has to say WHY, or
 * the contractor taps it three more times and then stops trusting the button.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteRefusalKey, type DeleteProjectResult } from './deleteproject.ts';

const refusal = (r: Extract<DeleteProjectResult, { ok: false }>) => deleteRefusalKey(r);

test('every refusal has its own sentence — none share one', () => {
  const keys = [
    refusal({ ok: false, reason: 'not_empty', holds: 'capture' }),
    refusal({ ok: false, reason: 'not_owner' }),
    refusal({ ok: false, reason: 'offline' }),
    refusal({ ok: false, reason: 'failed' }),
  ];
  assert.equal(new Set(keys).size, keys.length, 'two refusals share a message');
});

test('OFFLINE IS NOT A REFUSAL and must not read as one', () => {
  // The jobsite is still there and trying later is the right advice. Telling somebody
  // "this cannot be deleted" when the truth is "we could not ask" is a different fact.
  assert.notEqual(refusal({ ok: false, reason: 'offline' }),
                  refusal({ ok: false, reason: 'failed' }));
  assert.equal(refusal({ ok: false, reason: 'offline' }), 'job.delOffline');
});

test('not-empty is its own answer, distinct from a failure', () => {
  // It is the expected outcome for most jobsites, not an error — and the only one
  // where the app knows something specific to say.
  assert.equal(refusal({ ok: false, reason: 'not_empty', holds: 'change_order' }),
               'job.delNotEmpty');
});

test('an unrecognised reason still lands on a real message', () => {
  // Never a blank alert: a new server reason arriving before the app knows it should
  // fall to the generic failure, not to undefined.
  assert.equal(refusal({ ok: false, reason: 'failed', detail: 'whatever' }), 'job.delFailed');
});
