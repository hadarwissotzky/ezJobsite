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
  type ActivityRow, type ActivitySource,
} from './activity.ts';

const src = (o: Partial<ActivitySource> & { changeOrderId: string }): ActivitySource => ({
  scope: 'Subfloor rot', jobName: '41 Alder', status: 'sent', signedBy: null,
  amountCents: 120000, createdAtMs: 1000, questions: [], ...o,
});

test('AC: an unanswered question is the FIRST row and the bell counts it', () => {
  const rows = buildActivity([
    src({ changeOrderId: 'co1', status: 'approved', signedBy: 'Sarah', createdAtMs: 5000 }),
    src({ changeOrderId: 'co2', questions: [{ id: 'q1', body: 'Can it wait?', atMs: 9000 }] }),
  ], new Set());
  assert.equal(rows[0].kind, 'question');
  assert.equal(rows[0].detail, 'Can it wait?');
  // BOTH count since 2026-08-12: the approval fires a push of its own, so a bell that
  // ignored it would disagree with the notification the user is looking at.
  assert.equal(unreadCount(rows), 2);
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

/**
 * REVERSED 2026-08-12 (hadar: "a red badge with the number of new notifications").
 * This test used to assert that approvals must NOT inflate the badge. They must: the
 * same approval raises a push and a row in the notification list, and a bell that stayed
 * silent made three surfaces disagree about one event.
 */
test('the badge counts every unread arrival — approvals and declines included', () => {
  const rows = buildActivity([
    src({ changeOrderId: 'a', status: 'approved', signedBy: 'S' }),
    src({ changeOrderId: 'b', status: 'approved', signedBy: 'S' }),
    src({ changeOrderId: 'c', status: 'declined', signedBy: 'S' }),
    src({ changeOrderId: 'd', questions: [{ id: 'q', body: '?', atMs: 1 }] }),
  ], new Set());
  assert.equal(rows.length, 4, 'all four are listed');
  assert.equal(unreadCount(rows), 4, 'and all four are counted');
});

test("a 'sent' row would be listed but never badged — he did it himself", () => {
  // Built by hand, NOT through buildActivity: nothing emits a 'sent' row today (a bare
  // sent extra with no question and no answer produces nothing at all). The kind is
  // declared, the exclusion is written for it, and this is what it will do when
  // something starts producing them — stated rather than left as a silent no-op.
  const rows: ActivityRow[] = [
    { id: 'sent:a', kind: 'sent', changeOrderId: 'a', scope: 'Subfloor rot',
      jobName: '41 Alder', amountCents: 120000, detail: null, atMs: 1000, read: false },
    { id: 'q:1', kind: 'question', changeOrderId: 'b', scope: 'Panel',
      jobName: '41 Alder', amountCents: null, detail: '?', atMs: 2000, read: false },
  ];
  assert.equal(unreadCount(rows), 1, 'badging a man for his own action is furniture');
  // …but "mark all read" must still be able to clear its dot, which is why the
  // notification screen gates that button on unreadIds and not on the badge.
  assert.equal(unreadIds(rows).length, 2);
});

test('reading a row drops it out of the badge', () => {
  const rows = buildActivity([
    src({ changeOrderId: 'a', status: 'approved', signedBy: 'S' }),
    src({ changeOrderId: 'b', questions: [{ id: 'q', body: '?', atMs: 1 }] }),
  ], new Set());
  assert.equal(unreadCount(rows), 2);
  const after = buildActivity([
    src({ changeOrderId: 'a', status: 'approved', signedBy: 'S' }),
    src({ changeOrderId: 'b', questions: [{ id: 'q', body: '?', atMs: 1 }] }),
  ], new Set(unreadIds(rows)));
  assert.equal(unreadCount(after), 0, 'the icon badge clears with the bell');
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

// ── R3 AC4 surfaced in the activity centre ────────────────────────────────────

test('AC4: an overdue unpriced EWA appears, and the badge counts it', () => {
  const rows = buildActivity([
    src({ changeOrderId: 'ewa1', scope: 'Sill plate rot', unpricedSince: 5000 }),
  ], new Set());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'unpriced');
  assert.equal(rows[0].changeOrderId, 'ewa1', 'must deep-link to the EWA');
  assert.equal(unreadCount(rows), 1, 'work he owes is counted');
});

test('an unanswered question still outranks his own late price at the same moment', () => {
  const rows = buildActivity([
    src({ changeOrderId: 'a', unpricedSince: 900,
          questions: [{ id: 'q', body: '?', atMs: 900 }] }),
  ], new Set());
  assert.equal(rows[0].kind, 'question');
  assert.equal(rows[1].kind, 'unpriced');
});

test('a normal extra produces no unpriced row', () => {
  const rows = buildActivity([src({ changeOrderId: 'x', status: 'approved', signedBy: 'S' })], new Set());
  assert.ok(!rows.some((r) => r.kind === 'unpriced'));
});

// ── The unread dot on a card (hadar, 2026-08-25) ─────────────────────────────────

test('a card is marked unread by the SAME rule the header badge counts', async () => {
  const { unreadByChangeOrder, unreadCount } = await import('./activity.ts');
  const rows: any[] = [
    { id: 'a', kind: 'question', changeOrderId: 'co1', scope: '', jobName: '', amountCents: null, detail: null, atMs: 1, read: false },
    { id: 'b', kind: 'approved', changeOrderId: 'co2', scope: '', jobName: '', amountCents: null, detail: null, atMs: 2, read: true },
    { id: 'c', kind: 'question', changeOrderId: 'co3', scope: '', jobName: '', amountCents: null, detail: null, atMs: 3, read: false },
  ];
  const marked = unreadByChangeOrder(rows);
  // The bell and the dots must never disagree — that is the whole point of sharing
  // the rule rather than writing a second one.
  assert.equal(marked.size, unreadCount(rows));
  assert.deepEqual([...marked].sort(), ['co1', 'co3']);
});

test('a SENT row never marks a card — the same exclusion the bell makes', async () => {
  const { unreadByChangeOrder } = await import('./activity.ts');
  // 'sent' is the contractor's own act. Badging a card because HE did something would
  // make the dot mean "you have news" and "you did a thing" at once.
  const rows: any[] = [
    { id: 'a', kind: 'sent', changeOrderId: 'co1', scope: '', jobName: '', amountCents: null, detail: null, atMs: 1, read: false },
  ];
  assert.equal(unreadByChangeOrder(rows).size, 0);
});

test('two unread rows on one record mark it once', async () => {
  const { unreadByChangeOrder } = await import('./activity.ts');
  const rows: any[] = [
    { id: 'a', kind: 'question', changeOrderId: 'co1', scope: '', jobName: '', amountCents: null, detail: null, atMs: 1, read: false },
    { id: 'b', kind: 'question', changeOrderId: 'co1', scope: '', jobName: '', amountCents: null, detail: null, atMs: 2, read: false },
  ];
  assert.deepEqual([...unreadByChangeOrder(rows)], ['co1']);
});

test('nothing unread marks nothing', async () => {
  const { unreadByChangeOrder } = await import('./activity.ts');
  assert.equal(unreadByChangeOrder([]).size, 0);
});

// ── The price on a notification row (hadar, 2026-08-25) ──────────────────────────

test('every row carries what the record is worth', async () => {
  const { buildActivity } = await import('./activity.ts');
  // A question, an approval and a sent row all come off the same source, and the
  // triage list shows all three — so the figure has to ride on each, not just one.
  const rows = buildActivity([src({
    changeOrderId: 'co1', amountCents: 1200000, status: 'approved', signedBy: 'Sarah',
    questions: [{ id: 'q1', body: 'does this include grout?', atMs: 500 }],
  })], new Set());
  assert.ok(rows.length >= 2, 'expected a question row and a verdict row');
  for (const r of rows) {
    assert.equal(r.amountCents, 1200000, `${r.kind} lost the amount`);
  }
});

test('an UNPRICED record carries null, never zero', async () => {
  const { buildActivity } = await import('./activity.ts');
  // A draft the pipeline has not priced yet is a real state. Zero would tell a
  // contractor — and the eye scanning for urgency — that the work is free.
  const rows = buildActivity([src({
    changeOrderId: 'co2', amountCents: null,
    questions: [{ id: 'q2', body: 'when can you start?', atMs: 600 }],
  })], new Set());
  assert.ok(rows.length > 0);
  for (const r of rows) assert.equal(r.amountCents, null, `${r.kind} invented a figure`);
});
