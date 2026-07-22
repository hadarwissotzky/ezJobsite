import assert from 'node:assert/strict';
import test from 'node:test';
import { DeepgramShapeError, readDeepgram } from './deepgram.ts';

// FROM THE DOCUMENTED SHAPE, NOT FROM A LIVE CALL. Asserting that this parses is
// close to circular — I wrote both — so it is one test, not the point of the
// file. The tests below it are the point.
const DOCUMENTED = {
  metadata: { duration: 12.5, model_info: { abc: { name: 'nova-2' } } },
  results: {
    channels: [{
      detected_language: 'es',
      alternatives: [{ transcript: 'subfloor rot, eighteen fifty' }],
    }],
  },
};

test('reads the documented shape', () => {
  const t = readDeepgram(DOCUMENTED);
  assert.equal(t.text, 'subfloor rot, eighteen fifty');
  assert.equal(t.language, 'es');
  assert.equal(t.engine, 'deepgram');
  assert.equal(t.durationSec, 12.5);
});

// ── the assertions that hold whether or not my fixture matches reality ───────
//
// capture_transcript.text is `not null` but not non-empty, so a silently
// invented '' inserts cleanly, finishes the job, marks the capture processed,
// and hands the contractor a blank preview with nothing saying why. The audio is
// gone by then. Every shape this parser does not understand must therefore
// THROW, so the worker parks the job with the reason attached.

test('an error envelope never becomes an empty transcript', () => {
  assert.throws(() => readDeepgram({ err_code: 'INVALID_AUTH', err_msg: 'bad key' }),
    DeepgramShapeError);
});

test('a changed or unexpected shape throws instead of guessing', () => {
  for (const body of [
    {},
    null,
    { results: {} },
    { results: { channels: [] } },
    { results: { channels: [{ alternatives: [] }] } },
    { results: { channels: [{ alternatives: [{}] }] } },              // no transcript key
    { results: { channels: [{ alternatives: [{ transcript: null }] }] } },
    { results: { channels: [{ alternatives: [{ transcript: 42 }] }] } },
    { transcript: 'top level, wrong place' },
  ]) {
    assert.throws(() => readDeepgram(body), DeepgramShapeError,
      `should refuse: ${JSON.stringify(body)}`);
  }
});

test('the error carries the body, so the next person is not sent to a dead end', () => {
  try {
    readDeepgram({ err_code: 'INVALID_AUTH' });
    assert.fail('should have thrown');
  } catch (e: any) {
    assert.match(e.message, /INVALID_AUTH/);
  }
});

// Silence IS a real answer, and must be distinguishable from a broken read. This
// is the one case where '' is correct: the field was present and it was empty.
test('genuine silence is preserved, not treated as an error', () => {
  const t = readDeepgram({
    metadata: { duration: 3 },
    results: { channels: [{ alternatives: [{ transcript: '' }] }] },
  });
  assert.equal(t.text, '');
  assert.equal(t.durationSec, 3);
});

// Guessing 'en' would be confidently wrong for a Spanish-speaking crew, which is
// this product's core ICP. Null means "not detected", which is true.
test('language is null when not detected, never assumed', () => {
  const t = readDeepgram({
    results: { channels: [{ alternatives: [{ transcript: 'hola' }] }] },
  });
  assert.equal(t.language, null);
});
