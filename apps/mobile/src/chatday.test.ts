/**
 * Grouping a conversation by day.
 *   cd apps/mobile && node --test src/chatday.test.ts
 *
 * The interesting cases are all boundaries: midnight, a thread that spans a year, and a
 * list handed over out of order. A divider in the wrong place misdates a conversation
 * that ends up attached to a signed record, so these are worth pinning.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { dayKey, dayLabel, groupByDay, messageTime } from './chatday.ts';

const W = { today: 'Today', yesterday: 'Yesterday' };
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

/* --------------------------------------------------------------- grouping -- */

test('consecutive messages on one day form one group', () => {
  const msgs = [
    { atMs: at(2026, 8, 4, 9) }, { atMs: at(2026, 8, 4, 17) }, { atMs: at(2026, 8, 4, 23) },
  ];
  const g = groupByDay(msgs);
  assert.equal(g.length, 1);
  assert.equal(g[0].items.length, 3);
});

test('a minute either side of midnight is TWO days, not one', () => {
  // The case an hours-based diff gets wrong: 23:59 and 00:01 are two minutes apart and
  // belong to different days, and the divider is what says so.
  const g = groupByDay([{ atMs: at(2026, 8, 4, 23, 59) }, { atMs: at(2026, 8, 5, 0, 1) }]);
  assert.equal(g.length, 2);
});

test('an empty thread has no groups and therefore no dividers', () => {
  assert.deepEqual(groupByDay([]), []);
});

test('order is preserved exactly — grouping never re-sorts the thread', () => {
  // Handed an out-of-order list, this must NOT quietly fix it: the order of a
  // conversation is its meaning, and a silently reordered thread is worse than a
  // visible duplicate divider pointing at the real bug.
  const msgs = [{ atMs: at(2026, 8, 5) }, { atMs: at(2026, 8, 4) }, { atMs: at(2026, 8, 5) }];
  const g = groupByDay(msgs);
  assert.equal(g.length, 3, 'three runs, because the input alternates days');
  assert.deepEqual(g.map((x) => x.atMs), msgs.map((m) => m.atMs));
});

test('the day key is LOCAL, so a late-evening message keeps its own evening', () => {
  assert.equal(dayKey(at(2026, 8, 4, 23, 30)), dayKey(at(2026, 8, 4, 0, 5)));
  assert.notEqual(dayKey(at(2026, 8, 4, 23, 30)), dayKey(at(2026, 8, 5, 0, 5)));
});

/* ----------------------------------------------------------------- labels -- */

test('today and yesterday are named, not dated', () => {
  const now = at(2026, 8, 14, 10);
  assert.equal(dayLabel(at(2026, 8, 14, 8), now, 'en-US', W), 'Today');
  assert.equal(dayLabel(at(2026, 8, 13, 23), now, 'en-US', W), 'Yesterday');
});

test('yesterday is a CALENDAR day apart, not 24 hours', () => {
  // 00:30 today and 23:30 yesterday are one hour apart. They are still different days,
  // and calling the older one "Today" would be wrong.
  const now = at(2026, 8, 14, 0, 30);
  assert.equal(dayLabel(at(2026, 8, 13, 23, 30), now, 'en-US', W), 'Yesterday');
});

test('older days get weekday + date, as WhatsApp does', () => {
  const now = at(2026, 8, 14, 10);
  assert.equal(dayLabel(at(2026, 8, 4, 9), now, 'en-US', W), 'Tue, Aug 4');
});

test('a thread that crosses a year carries the year', () => {
  const now = at(2026, 8, 14, 10);
  assert.equal(dayLabel(at(2025, 12, 20, 9), now, 'en-US', W), 'Dec 20, 2025');
});

/* ------------------------------------------------------------------- time -- */

test('the bubble stamp is the time alone — the day is on the divider', () => {
  assert.equal(messageTime(at(2026, 8, 4, 18, 19), 'en-US'), '6:19 PM');
  assert.equal(messageTime(at(2026, 8, 4, 7, 5), 'en-US'), '7:05 AM');
});
