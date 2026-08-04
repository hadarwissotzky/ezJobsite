/**
 * The nudge threshold. This is the whole conversion mechanism: too early and the app
 * nags a user who has barely started, too late and the first they hear of a limit is
 * the moment their work is refused.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { severityFor, isMetered } from './usage.ts';

test('unlimited is always silent', () => {
  assert.equal(severityFor(0, Infinity), 'ok');
  assert.equal(severityFor(9_999, Infinity), 'ok');
});

test('a small cap nudges with one left — 2 change orders warns after the FIRST send', () => {
  // The percentage rule alone would put 80% of 2 at 1.6 and only fire at 2, which is
  // already 'reached'. The "one remaining" rule is what makes small caps usable.
  assert.equal(severityFor(0, 2), 'ok');
  assert.equal(severityFor(1, 2), 'nearing');
  assert.equal(severityFor(2, 2), 'reached');
});

test('a large cap nudges on the ratio — 30 photos warns at 24, not at 29', () => {
  assert.equal(severityFor(23, 30), 'ok');
  assert.equal(severityFor(24, 30), 'nearing');   // 80%
  assert.equal(severityFor(29, 30), 'nearing');
  assert.equal(severityFor(30, 30), 'reached');
});

test('past the ceiling still reads as reached, never wraps to ok', () => {
  // Counts can exceed the limit: a second device syncs down rows that were created
  // before this device saw the cap. Reporting that as 'ok' would be the worst answer.
  assert.equal(severityFor(45, 30), 'reached');
});

test('a limit of 1 is reached the moment anything exists — the free seat case', () => {
  // free.members = 1 counts the OWNER, so an existing company is already at the wall.
  assert.equal(severityFor(0, 1), 'nearing');
  assert.equal(severityFor(1, 1), 'reached');
});

test('free is metered; Crew is not; Core still is, because seats are capped', () => {
  assert.equal(isMetered('free'), true);
  assert.equal(isMetered('crew'), false);
  // The one that matters: a PAYING Core owner has 3 seats and must be able to see
  // that, or their fourth hire is a surprise refusal.
  assert.equal(isMetered('core'), true);
});

test('an unknown plan string is treated as free, so it is metered', () => {
  assert.equal(isMetered('enterprise'), true);   // removed tier → asPlanId gives free
  assert.equal(isMetered(null), true);
});
