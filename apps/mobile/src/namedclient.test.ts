/**
 * Tests for `isNamedClient` — the predicate that decides whether an extra has an
 * owner. Run:
 *   cd apps/mobile && node --test src/namedclient.test.ts
 *
 * THE FAILURE THESE EXIST TO CATCH, which shipped and was found on a device
 * (hadar, 2026-08-08): `change_order.who_directed` is NOT NULL, and every extra
 * born from a capture is seeded with the literal role word "Owner". Every screen
 * asking "is there an owner?" wrote `co.who_directed || null` — which is never
 * null — so an unnamed extra drew a person row for a signer who did not exist,
 * had no roster row, and had no number to send to. The no-owner state was
 * unreachable on every extra the app had ever created.
 *
 * The seed and the predicate must stay one literal apart. If someone changes the
 * seed word without changing the predicate, the bug comes back silently — so the
 * last test asserts they agree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNamedClient, UNNAMED_CLIENT } from './startextra.ts';

test('the unnamed seed is NOT a named client', () => {
  assert.equal(isNamedClient('Owner'), false);
});

test('the seed is rejected however it was cased or padded', () => {
  // The roster lookup that matches `who_directed` trims and lowercases, so this
  // predicate has to agree with it or one says "named" while the other finds nobody.
  for (const v of ['owner', 'OWNER', '  Owner  ', 'oWnEr']) {
    assert.equal(isNamedClient(v), false, v);
  }
});

test('absent, empty and whitespace-only are not named clients', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.equal(isNamedClient(v), false, JSON.stringify(v));
  }
});

test('a real person IS a named client', () => {
  for (const v of ['Dana Whitfield', 'Owner Jr', 'Mrs. Owens', 'Owners Rep']) {
    assert.equal(isNamedClient(v), true, v);
  }
});

test('the predicate is pinned to the literal the writer seeds', () => {
  assert.equal(isNamedClient(UNNAMED_CLIENT), false);
});
