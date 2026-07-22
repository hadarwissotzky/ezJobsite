/**
 * Tests for R2's "Sounds like 2 extras — split them?" flag.
 *   cd apps/mobile && node --test src/multiextra.test.ts
 *
 * Half of these assert that it does NOT flag. That is the deliberate half: the
 * detector is worthless the moment a contractor learns the banner is usually wrong,
 * so the false-positive cases are as load-bearing as the true ones and are locked in
 * here on purpose.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMultipleExtras } from './multiextra.ts';

// ── the PRD's own example ─────────────────────────────────────────────────────

test('two extras separated by "also" are flagged as 2', () => {
  const r = detectMultipleExtras(
    'Add three outlets in unit 3B. Also we need to replace the rotted subfloor under the tub.');
  assert.equal(r.count, 2);
  assert.equal(r.flagged, true);
  assert.equal(r.reasonKey, 'r2.multiExtra');
  assert.equal(r.reasonParams.n, 2);
  assert.equal(r.starts.length, 2);
});

test('three boundaries count to three', () => {
  const r = detectMultipleExtras(
    'Install the vanity. Another thing, repair the drain. On top of that we add a circuit.');
  assert.equal(r.count, 3);
  assert.equal(r.flagged, true);
});

test('Spanish boundary cues are heard', () => {
  const r = detectMultipleExtras(
    'Hay que instalar los focos nuevos. Aparte, reparar la tubería del baño.');
  assert.equal(r.count, 2);
  assert.equal(r.flagged, true);
});

// ── the false positives it must refuse ────────────────────────────────────────

test('one repair told in two sentences is ONE extra, not two', () => {
  const r = detectMultipleExtras(
    'Tear out the subfloor under the tub. Replace the joist while it is open.');
  assert.equal(r.count, 1);
  assert.equal(r.flagged, false);
  assert.equal(r.reasonKey, 'r2.oneExtra');
});

test('a boundary cue with no work described after it does not invent an extra', () => {
  const r = detectMultipleExtras('Add three outlets in unit 3B. Also, tell Marco I stopped by.');
  assert.equal(r.count, 1);
  assert.equal(r.flagged, false);
});

test('narration with no work verb at all reports zero and flags nothing', () => {
  const r = detectMultipleExtras('The homeowner was here again this morning and she seemed happy.');
  assert.equal(r.count, 0);
  assert.equal(r.flagged, false);
  assert.deepEqual(r.starts, []);
});

test('an empty transcript is a clean zero, not a crash', () => {
  for (const s of ['', '   ', '\n']) {
    const r = detectMultipleExtras(s);
    assert.equal(r.count, 0);
    assert.equal(r.flagged, false);
  }
});

test('a cue in the FIRST clause never opens a second extra', () => {
  // A recording that starts mid-thought ("Also, add three outlets") is one extra.
  const r = detectMultipleExtras('Also add three outlets in unit 3B.');
  assert.equal(r.count, 1);
  assert.equal(r.flagged, false);
});

test('the flag is a key + params and carries the clauses, so it can be argued with', () => {
  const r = detectMultipleExtras('Add outlets. Separately, repair the drain.');
  assert.equal(r.reasonKey, 'r2.multiExtra');
  assert.equal(r.starts[1], 'Separately, repair the drain');
});
