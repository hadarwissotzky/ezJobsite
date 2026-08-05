/**
 * `personKey` — who counts as the SAME person across jobs.
 *
 * This decides what the client picker's second section shows. Get it wrong in one
 * direction and the same homeowner appears four times, once per job, which makes
 * the list useless and sends the contractor back to the phone's contact picker —
 * the exact trip the section exists to remove. Get it wrong in the other and two
 * different people merge into one row, and he picks the wrong client for a priced
 * document.
 *
 * The asymmetry is deliberate and worth stating: over-merging costs a wrong name
 * that a human reads on the next screen and can correct; under-merging costs
 * nothing visible and quietly rots the feature. So the name fallback is loose.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { personKey } from './personkey.ts';

test('a phone number identifies the person, whatever the name is typed as', () => {
  // One human entered on two jobs, typed differently each time. Same key.
  assert.equal(
    personKey('Sarah', '+14155550147'),
    personKey('Sarah M.', '+1 415 555 0147'));
});

test('two different people who share a first name stay separate', () => {
  assert.notEqual(
    personKey('Sarah', '+14155550147'),
    personKey('Sarah', '+14155550188'));
});

test('formatting noise in a number never splits one person', () => {
  const forms = ['+1 (415) 555-0147', '415-555-0147', '4155550147', '+14155550147'];
  const keys = new Set(forms.map((f) => personKey('Sarah', f)));
  assert.equal(keys.size, 1, `expected one identity, got ${[...keys].join(' | ')}`);
});

test('no number falls back to the name, case- and space-insensitively', () => {
  assert.equal(personKey('  Dana   Reyes ', null), personKey('dana reyes', null));
  assert.equal(personKey('Dana Reyes', ''), personKey('DANA REYES', null));
});

test('a named person and a numbered person are never the same key', () => {
  // Someone with a number is identified by it; the name-only row is a weaker
  // record and must not collapse into them on a name coincidence alone... but it
  // also must not be claimed BY them. Both directions checked.
  assert.notEqual(personKey('Dana Reyes', '+14155550147'), personKey('Dana Reyes', null));
});

test('a number too short to be one is treated as no number', () => {
  // Extensions and junk ("x12", "call the office") must not become identities —
  // every such row would otherwise be its own person.
  assert.equal(personKey('Dana Reyes', 'x12'), personKey('Dana Reyes', null));
});

test('numbers matching in the last 10 digits are one person across country prefixes', () => {
  // The same US mobile written with and without +1. Storing E.164 makes this rare,
  // but contact-picker imports are not normalised and this is the common shape.
  assert.equal(personKey('Sarah', '+14155550147'), personKey('Sarah', '14155550147'));
});
