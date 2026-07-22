/**
 * R8 activity list. Run: npm test
 *
 * The third AC ("marking read changes no item's status, timeline or approval
 * state") is the one worth a test that can actually fail, because the failure is
 * silent: nothing throws when a reading convenience quietly writes to evidence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActivity, unreadCount, unreadIds,
  type ActivitySource,
} from './activity.ts';

const src = (o: Partial<ActivitySource> & { changeOrderId: string }): ActivitySource => ({
  scope: 'Subfloor rot', jobName: '41 Alder', status: 'sent', signedBy: null,
  createdAtMs: 1000, questions: [], ...o,
});

test('AC: an unanswered question is the FIRST row and the bell counts it', () => {
  const rows = buildActivity([
    src({ changeOrderId: 'co1', status: 'approved', signedBy: 'Sarah', createdAtMs: 5000 }),
    src({ changeOrderId: 'co2', questions: [{ id: 'q1', body: 'Can it wait?', atMs: 9000 }] }),
  ], new Set());
  assert.equal(rows[0].kind, 'question');
  assert.equal(rows[0].detail, 'Can it wait?');
  assert.equal(unreadCount(rows), 1);
});

test('AC: marking read changes ONLY read-state — never an item field', () => {
  const sources = [src({ changeOrderId: 'co1', status: 'approved', signedBy: 'Sarah',
                         questions: [{ id: 'q1', body: 'why?', atMs: 2000 }] })];
  const before = JSON.parse(JSON.stringify(sources));
  const rows = buildActivity(sources, new Set());
  const after = buildActivity(sources, new Set(unreadIds(rows)));

  // The sources object must be untouched — buildActivity may not write to evidence.
  assert.deepEqual(sources, before, 'buildActivity mutated its input');
  // Same rows, same order, same everything except `read`.
  assert.equal(after.length, rows.length);
  for (let i = 0; i < rows.length; i++) {
    const { read: _a, ...restBefore } = rows[i];
    const { read: _b, ...restAfter } = after[i];
    assert.deepEqual(restAfter, restBefore, 'marking read altered a non-read field');
    assert.equal(after[i].read, true);
  }
  assert.equal(unreadCount(after), 0);
});

test('the badge counts questions only — approvals must not inflate it', () => {
  const rows = buildActivity([
    src({ changeOrderId: 'a', status: 'approved', signedBy: 'S' }),
    src({ changeOrderId: 'b', status: 'approved', signedBy: 'S' }),
    src({ changeOrderId: 'c', status: 'declined', signedBy: 'S' }),
    src({ changeOrderId: 'd', questions: [{ id: 'q', body: '?', atMs: 1 }] }),
  ], new Set());
  assert.equal(rows.length, 4, 'all four are listed');
  assert.equal(unreadCount(rows), 1, 'but only the question is counted');
});

test('newest first, and a question outranks an answer at the SAME moment', () => {
  const rows = buildActivity([
    src({ changeOrderId: 'x', status: 'approved', signedBy: 'S', createdAtMs: 500,
          questions: [{ id: 'q', body: '?', atMs: 500 }] }),
  ], new Set());
  assert.equal(rows[0].kind, 'question');
  assert.equal(rows[1].kind, 'approved');
});

test('row ids are stable across rebuilds — read-state is keyed on them', () => {
  const s = [src({ changeOrderId: 'co1', questions: [{ id: 'q1', body: '?', atMs: 3 }] })];
  const a = buildActivity(s, new Set()).map((r) => r.id);
  const b = buildActivity(s, new Set()).map((r) => r.id);
  assert.deepEqual(a, b);
  assert.ok(a[0].includes('q1'), 'id must derive from the question, not its position');
});

test('every row carries the item AND its job — R8 requires both', () => {
  const rows = buildActivity([
    src({ changeOrderId: 'co1', scope: 'Gas line', jobName: '9 Oak',
          questions: [{ id: 'q', body: '?', atMs: 1 }] }),
  ], new Set());
  assert.equal(rows[0].scope, 'Gas line');
  assert.equal(rows[0].jobName, '9 Oak');
  assert.equal(rows[0].changeOrderId, 'co1', 'the row must be able to deep-link');
});

test('a job with nothing to report produces no rows', () => {
  assert.deepEqual(buildActivity([src({ changeOrderId: 'co1' })], new Set()), []);
  assert.equal(unreadCount([]), 0);
});
