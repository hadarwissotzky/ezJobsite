/**
 * The three bugs this table exists to make impossible, pinned.
 *
 * Each one shipped, reached hadar's phone, and was reported as a separate defect. They
 * were one defect: a chain of `if`s ending in a default that absorbs any status nobody
 * remembered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { extraState, extraBucket, isClosed, ALL_STORED } from './extrabucket.ts';
import { STORED_STATUSES } from './extrastatus.ts';

test('EVERY stored status has an answer — no status falls through to a default', () => {
  // The whole point. If this list and the table ever disagree, TypeScript refuses to
  // compile the table; this asserts the runtime half, that nothing lands on a fallback.
  for (const s of STORED_STATUSES) {
    const st = extraState(s, 0);
    assert.ok(st, `${s} produced nothing`);
    // `sent` is the only status that may present as 'waiting'. Anything ELSE arriving
    // there is the exact bug: an unlisted status taking the old chains' default.
    if (st === 'waiting') {
      assert.equal(s, 'sent',
        `${s} reads as "waiting for a yes" — that is the fall-through bug, again`);
    }
  }
});

test('a WITHDRAWN extra never reads as waiting on the client', () => {
  // hadar, 2026-08-24. He withdrew it; the app said he was waiting on them.
  assert.equal(extraState('cancelled'), 'cancelled');
  assert.equal(extraBucket('cancelled'), 'closed');
});

test('a DECLINED extra is closed, not invisible', () => {
  // It had its own state key and appeared in none of Home's three buckets, so a
  // client's recorded NO was on no screen he would ever open.
  assert.equal(extraBucket('declined'), 'closed');
});

test('a SUPERSEDED version is closed — the one nobody reported', () => {
  // Found by writing the table rather than by using the app: `superseded` matched none
  // of the old chains' cases, took their default, and was counted among the extras a
  // contractor is chasing.
  assert.equal(extraState('superseded'), 'superseded');
  assert.equal(extraBucket('superseded'), 'closed');
  assert.equal(isClosed('superseded'), true);
});

test('a client question outranks the wait', () => {
  assert.equal(extraState('sent', 0), 'waiting');
  assert.equal(extraState('sent', 1), 'needs',
    'he is not waiting on them; they are waiting on him');
});

test('the question count is ignored for every status but sent', () => {
  for (const s of STORED_STATUSES) {
    if (s === 'sent') continue;
    assert.equal(extraState(s, 0), extraState(s, 3),
      `${s} changed its answer because somebody asked a question`);
  }
});

test('an unknown status reads as a draft, never as approved or waiting', () => {
  // An unrecognised string is not a licence. Draft is the safe read: it offers nothing
  // to a client and claims nothing about one.
  assert.equal(extraState('nonsense'), 'draft');
  assert.equal(extraBucket(''), 'draft');
});

test('only the three ended states are closed', () => {
  const closed = ALL_STORED.filter((s) => isClosed(s));
  assert.deepEqual([...closed].sort(), ['cancelled', 'declined', 'superseded']);
});

test('draft and approved keep their own piles', () => {
  assert.equal(extraBucket('draft'), 'draft');
  assert.equal(extraBucket('approved'), 'approved');
});
