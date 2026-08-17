/**
 * Dictation's one decision: how spoken words join typed ones.
 *   cd apps/mobile && node --test src/livedictation.test.ts
 *
 * The recogniser itself needs a phone and a voice. This does not — and this is the part
 * that can silently destroy work, because a recogniser that REPLACED the field would
 * delete half a typed sentence with no undo behind it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeDictation } from './livedictation.ts';

test('dictating into an empty field is just the words', () => {
  assert.equal(mergeDictation('', 'the joist is soft'), 'the joist is soft');
});

test('dictation APPENDS — what he typed is never replaced', () => {
  assert.equal(
    mergeDictation('About the tub —', 'the joist under it is soft too'),
    'About the tub — the joist under it is soft too');
});

test('exactly one space at the join, whatever the spacing either side', () => {
  assert.equal(mergeDictation('Hello   ', '   there'), 'Hello there');
  assert.equal(mergeDictation('Hello', 'there'), 'Hello there');
});

test('silence changes nothing — an empty result never trims the field', () => {
  // The recogniser emits interim results constantly, including empty ones. If one of
  // those rewrote the draft, a trailing space the user typed would vanish under them.
  assert.equal(mergeDictation('Half a sentence ', ''), 'Half a sentence ');
  assert.equal(mergeDictation('Half a sentence ', '   '), 'Half a sentence ');
});

test('leading whitespace in the base is preserved, trailing is not doubled', () => {
  assert.equal(mergeDictation('  indented', 'words'), '  indented words');
});

test('an empty field and silence stay empty', () => {
  assert.equal(mergeDictation('', ''), '');
});
