/**
 * The placeholder is not a person.
 *   cd apps/mobile && node --test src/clientseed.test.ts
 *
 * hadar, 2026-08-19: he created a change order offline and "it entered the person created
 * it as the client by default".
 *
 * The mechanism, confirmed against the live database rather than guessed: `who_directed`
 * is seeded with the literal role word "Owner" on every extra born from a capture, an
 * older client sheet prefilled that seed into an editable name field, and saving it
 * created roster rows genuinely named "Owner" and "hadar wissotzky". From then on every
 * new extra matched the placeholder against the roster and adopted whoever collided with
 * it — on his phone, himself.
 *
 * `isNamedClient` is the single definition both sides now use: the reader refuses to
 * match on it, the writer refuses to store it. These lock that word down.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isNamedClient } from './startextra.ts';

test('the seed word is not a named client, in any casing', () => {
  // The reader lowercases before comparing, so a row stored "owner" or "OWNER" must be
  // caught too — otherwise the guard passes and the collision comes straight back.
  for (const v of ['Owner', 'owner', 'OWNER', '  Owner  ']) {
    assert.equal(isNamedClient(v), false, `${JSON.stringify(v)} must not read as a name`);
  }
});

test('absent and empty are not named clients either', () => {
  assert.equal(isNamedClient(null), false);
  assert.equal(isNamedClient(undefined), false);
  assert.equal(isNamedClient(''), false);
  assert.equal(isNamedClient('   '), false);
});

test('a real person IS a named client', () => {
  // The guard must not be so broad that it eats real names — including one that merely
  // contains the word.
  for (const v of ['Dana Reyes', 'hadar wissotzky', 'Owner Jones', 'The Owners Trust']) {
    assert.equal(isNamedClient(v), true, `${JSON.stringify(v)} is a real name`);
  }
});
