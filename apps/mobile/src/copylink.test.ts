/**
 * The rules around handing the client's link to the contractor.
 * Run: cd apps/mobile && node --test src/copylink.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { copyLink } from './copylink.ts';

const LIVE = 'https://ez.example.com/confirm.html?t=abc123';

test('a live link lands on the clipboard exactly as stored', async () => {
  let got: string | null = null;
  const r = await copyLink(LIVE, async (s) => { got = s; });
  assert.deepEqual(r, { ok: true });
  assert.equal(got, LIVE, 'the URL was altered on its way to the pasteboard');
});

test('a relative URL is refused, not silently copied', async () => {
  // Without EXPO_PUBLIC_CONFIRM_BASE the stored URL is "/confirm.html?t=...", which
  // pastes into an email as text nobody can open. shareLink refuses the same shape.
  let called = false;
  const r = await copyLink('/confirm.html?t=abc123', async () => { called = true; });
  assert.equal(r.ok, false);
  assert.equal(called, false, 'a broken link reached the clipboard');
});

test('an extra with no link says so instead of copying an empty string', async () => {
  for (const v of [null, undefined, '', '   ']) {
    const r = await copyLink(v, async () => { assert.fail('copied nothing at all'); });
    assert.equal(r.ok, false);
    assert.equal((r as { reason: string }).reason, 'r8.noLink');
  }
});

test('a non-http string is refused', async () => {
  // Defence against a stored value that is not a URL — a token on its own, say.
  for (const v of ['abc123', 'ftp://x/y', 'javascript:alert(1)']) {
    const r = await copyLink(v, async () => { assert.fail(`copied ${v}`); });
    assert.equal(r.ok, false, `${v} was treated as a link`);
  }
});

test('a pasteboard that refuses is REPORTED, never shown as "Copied"', async () => {
  // A locked device or a restricted profile. Showing success over an empty clipboard
  // means he pastes nothing into an email and never learns why.
  const r = await copyLink(LIVE, async () => { throw new Error('pasteboard unavailable'); });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /pasteboard unavailable/);
});

test('surrounding whitespace is trimmed, the link is not otherwise touched', async () => {
  let got = '';
  await copyLink(`  ${LIVE}  `, async (s) => { got = s; });
  assert.equal(got, LIVE);
});
