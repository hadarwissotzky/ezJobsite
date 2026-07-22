import assert from 'node:assert/strict';
import test from 'node:test';
import { isComplete, pendingSteps } from './steps.ts';

// The real list, taken from an actual enqueue rather than from memory.
const ALL = ['transcribe', 'detect_language', 'resolve_project', 'structure'];

test('a fresh job owes every step, in the job\'s own order', () => {
  assert.deepEqual(pendingSteps(ALL, []), ALL);
});

// The expensive one. The SQL comment on completed_steps says it outright: a job
// that died after transcribing must not transcribe again, because that is a paid
// call and a different answer for the same audio.
test('a resumed job never re-runs a completed step', () => {
  assert.deepEqual(pendingSteps(ALL, ['transcribe']),
    ['detect_language', 'resolve_project', 'structure']);
  assert.deepEqual(pendingSteps(ALL, ['transcribe', 'detect_language', 'resolve_project']),
    ['structure']);
});

test('order comes from the job, not from a constant in the worker', () => {
  assert.deepEqual(pendingSteps(['structure', 'transcribe'], []), ['structure', 'transcribe']);
});

// A photo declares no steps. If this were false the photo would never finish,
// which is the exact bug `finish_job`'s `is not false` guard was added for.
test('a job with no declared steps is already complete', () => {
  assert.equal(isComplete([], []), true);
  assert.deepEqual(pendingSteps([], []), []);
});

test('completed steps the job never declared do not confuse it', () => {
  assert.deepEqual(pendingSteps(ALL, ['something_else']), ALL);
  assert.equal(isComplete(ALL, ['something_else']), false);
});

test('all steps done means complete', () => {
  assert.equal(isComplete(ALL, ALL), true);
  assert.equal(isComplete(ALL, ['transcribe', 'structure']), false);
  // A text capture owes three: 140's trigger drops transcribe.
  const TEXT = ['detect_language', 'resolve_project', 'structure'];
  assert.equal(isComplete(TEXT, TEXT), true);
});
