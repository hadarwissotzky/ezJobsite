/**
 * R8 reminder rules. Run: npm test
 *
 * The rule worth testing hardest is the one a contractor will hit while annoyed:
 * he tapped Remind, nothing appeared to happen, so he taps again. Every refusal has
 * to be a REASON he can read, never a silent no-op — and the reasons have to be
 * right, because the cost of a wrong one is a client who feels chased.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRemind, reminderText, ONE_DAY_MS, type RemindState } from './remind.ts';

const st = (o: Partial<RemindState> = {}): RemindState =>
  ({ count: 0, lastAtMs: null, inDiscussion: false, ...o });

const NOW = 1_000_000_000_000;

test('a sent extra, never reminded, can be reminded', () => {
  assert.deepEqual(canRemind('sent', st(), NOW), { ok: true });
});

test('AC: rate-limited to 1/day per extra', () => {
  const justUnder = canRemind('sent', st({ lastAtMs: NOW - ONE_DAY_MS + 1 }), NOW);
  assert.equal(justUnder.ok, false);
  if (!justUnder.ok) assert.equal(justUnder.reasonKey, 'r8.tooSoon');

  // Exactly a day later is allowed — the boundary is inclusive on purpose, so a
  // contractor who reminds at 9am can remind at 9am tomorrow.
  assert.deepEqual(canRemind('sent', st({ lastAtMs: NOW - ONE_DAY_MS }), NOW), { ok: true });
});

test('AC: reminders pause while the client is waiting on an answer', () => {
  const v = canRemind('sent', st({ inDiscussion: true }), NOW);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reasonKey, 'r8.inDiscussion');
});

test('in-discussion outranks the rate limit — the reason must be the useful one', () => {
  // Both rules would block. The contractor needs to know the client is waiting on
  // HIM, not that he reminded recently; one is actionable and the other is noise.
  const v = canRemind('sent', st({ inDiscussion: true, lastAtMs: NOW - 1000 }), NOW);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reasonKey, 'r8.inDiscussion');
});

test('only a SENT extra can be reminded about', () => {
  for (const s of ['draft', 'approved', 'declined', 'superseded']) {
    const v = canRemind(s, st(), NOW);
    assert.equal(v.ok, false, `${s} should not be remindable`);
    if (!v.ok) assert.equal(v.reasonKey, 'r8.notSent');
  }
});

test('every refusal carries a reason — none is a silent no-op', () => {
  const cases = [
    canRemind('draft', st(), NOW),
    canRemind('sent', st({ inDiscussion: true }), NOW),
    canRemind('sent', st({ lastAtMs: NOW - 1 }), NOW),
  ];
  for (const v of cases) {
    assert.equal(v.ok, false);
    if (!v.ok) assert.ok(v.reasonKey && v.reasonKey.startsWith('r8.'));
  }
});

// ── the message ───────────────────────────────────────────────────────────────

test('the copy names who is waiting, what for, and how much', () => {
  const t = reminderText({
    contractorName: 'Dave', scope: 'Subfloor rot repair',
    amount: '$1,850.00', url: 'https://approve.example.com/confirm.html?t=abc',
  });
  assert.ok(t.includes('Dave is waiting on your approval'));
  assert.ok(t.includes('Subfloor rot repair'));
  assert.ok(t.includes('$1,850.00'));
  assert.ok(t.includes('https://approve.example.com/confirm.html?t=abc'));
});

test('the copy says the link is UNCHANGED — that is the whole point of a reminder', () => {
  const t = reminderText({
    contractorName: 'Dave', scope: 'x', amount: '$1.00', url: 'u',
  });
  assert.match(t, /same link/i,
    'a client re-reading an old text must know this is not a new version');
});

test('the amount is passed through verbatim, never re-formatted', () => {
  // One formatter in this app. A second one here is how the reminder ends up saying
  // a different number than the link it points at (mandate #6).
  const t = reminderText({
    contractorName: 'D', scope: 's', amount: '$12,345.67', url: 'u',
  });
  assert.ok(t.includes('$12,345.67'));
  assert.ok(!t.includes('12345.67'), 'must not have been re-derived');
});
