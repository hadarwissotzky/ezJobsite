/**
 * R5b thread rules. Run: cd apps/mobile && node --test src/discussion.test.ts
 *
 * The cases that matter are the ones where being wrong costs money or trust:
 * a thread that stays open after a signature, an extra that stops being flagged
 * because the client nudged again, a deep link that opens the wrong extra.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AWAITING_REPLY_MS, clientMessageCount, notificationFor, parseThreadLink,
  renderDiscussionLogHtml, revisionDelta, sortThread, threadLink, threadState,
  truncate, type ThreadMessage,
} from './discussion.ts';
// R7 owns the displayed status vocabulary; R5b must agree with it rather than
// carry its own. Asserted here so a change to either side breaks a test.
import { displayStatus } from './extrastatus.ts';

const H = 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

const client = (id: string, atMs: number, text = 'q'): ThreadMessage =>
  ({ id, side: 'client', text, atMs });
const contractor = (id: string, atMs: number, text = 'a'): ThreadMessage =>
  ({ id, side: 'contractor', text, atMs });

test('sortThread is chronological and breaks ties on id', () => {
  const out = sortThread([client('b', T0), contractor('c', T0 - 1), client('a', T0)]);
  assert.deepEqual(out.map((m) => m.id), ['c', 'a', 'b']);
});

test('an unanswered client question puts the extra In Discussion', () => {
  const s = threadState({ coStatus: 'sent', messages: [client('q1', T0)], nowMs: T0 + H });
  assert.equal(s.inDiscussion, true);
  assert.equal(s.open, true);
  assert.equal(s.canReply, true);
  assert.equal(s.canRevise, true);
  assert.equal(
    displayStatus('sent', { openQuestions: clientMessageCount(s.messages) }), 'discussing');
});

test('a sent extra nobody has asked about is not In Discussion', () => {
  const s = threadState({ coStatus: 'sent', messages: [], nowMs: T0 });
  assert.equal(s.inDiscussion, false);
  assert.equal(displayStatus('sent', { openQuestions: clientMessageCount([]) }), 'sent');
});

test('approval CLOSES the thread — R5b AC4, REQ-LC23, DEF-4', () => {
  // The composer must disappear, and the reason is not tidiness: the server
  // rejects a reply against an answered request (308:94, errcode 23514) and that
  // code is permanent, so a composer here produces a message that is parked
  // forever while the UI calls it sent. The 2026-07-24 "chat channel" reading
  // widened the client without ever widening the server; D1 seals stage 3.
  const s = threadState({
    coStatus: 'approved',
    messages: [client('q1', T0), contractor('r1', T0 + H)],
    nowMs: T0 + 10 * 24 * H,
  });
  assert.equal(s.open, false, 'the signed record itself takes no new VERSIONS');
  assert.equal(s.canReply, false, 'a reply here could never be delivered');
  assert.equal(s.canRevise, false, 'a signed version is never superseded');
  assert.equal(s.awaitingReply, false, 'nobody is waiting once it is signed');
  assert.equal(s.messages.length, 2, 'the record is preserved');
  assert.equal(
    displayStatus('approved', { openQuestions: clientMessageCount(s.messages) }), 'approved');
});

test('a declined extra also closes the thread', () => {
  const s = threadState({ coStatus: 'declined', messages: [client('q1', T0)], nowMs: T0 + 5 * 24 * H });
  assert.equal(s.open, false);
  assert.equal(s.canReply, false, 'the server rejects a reply on a declined request too');
  assert.equal(s.awaitingReply, false);
});

test('>48h with no contractor reply raises Awaiting your reply — R5b AC5', () => {
  const msgs = [client('q1', T0)];
  assert.equal(threadState({ coStatus: 'sent', messages: msgs, nowMs: T0 + 47 * H }).awaitingReply, false);
  assert.equal(threadState({ coStatus: 'sent', messages: msgs, nowMs: T0 + 49 * H }).awaitingReply, true);
  // The boundary itself, so a refactor cannot quietly turn >= into >.
  assert.equal(
    threadState({ coStatus: 'sent', messages: msgs, nowMs: T0 + AWAITING_REPLY_MS }).awaitingReply,
    true
  );
});

test('a contractor reply clears the flag; a later question restarts it', () => {
  const answered = [client('q1', T0), contractor('r1', T0 + H)];
  const s1 = threadState({ coStatus: 'sent', messages: answered, nowMs: T0 + 100 * H });
  assert.equal(s1.awaitingReply, false);
  assert.equal(s1.unansweredSinceMs, null);

  const askedAgain = [...answered, client('q2', T0 + 2 * H)];
  const s2 = threadState({ coStatus: 'sent', messages: askedAgain, nowMs: T0 + 100 * H });
  assert.equal(s2.awaitingReply, true);
  assert.equal(s2.unansweredSinceMs, T0 + 2 * H);
});

test('a client nudge does NOT reset the awaiting clock', () => {
  // Asked on day 0, nudged 1h ago, contractor has never replied. Taking the LATEST
  // message would un-flag this; taking the earliest unanswered one keeps it flagged.
  const msgs = [client('q1', T0), client('q2', T0 + 120 * H)];
  const s = threadState({ coStatus: 'sent', messages: msgs, nowMs: T0 + 121 * H });
  assert.equal(s.unansweredSinceMs, T0);
  assert.equal(s.awaitingReply, true);
});

test('a superseded version stays superseded even with an open-looking thread', () => {
  const s = threadState({ coStatus: 'superseded', messages: [client('q1', T0)], nowMs: T0 + 100 * H });
  assert.equal(s.open, false);
  assert.equal(
    displayStatus('superseded', { openQuestions: clientMessageCount(s.messages) }), 'superseded');
});

test('revisionDelta reports direction without inventing a price', () => {
  assert.deepEqual(revisionDelta(185000, 150000),
    { priorCents: 185000, newCents: 150000, direction: 'down' });
  assert.equal(revisionDelta(150000, 185000).direction, 'up');
  assert.equal(revisionDelta(150000, 150000).direction, 'same');
});

test('thread deep link round-trips', () => {
  const l = threadLink('co-123');
  assert.deepEqual(parseThreadLink(l), { changeOrderId: 'co-123', focusReply: true });
  assert.deepEqual(parseThreadLink(threadLink('co-123', false)),
    { changeOrderId: 'co-123', focusReply: false });
});

test('an id needing escaping survives the round trip', () => {
  const id = 'co/with?weird&chars';
  assert.deepEqual(parseThreadLink(threadLink(id)), { changeOrderId: id, focusReply: true });
});

test('junk links are refused, never guessed at', () => {
  assert.equal(parseThreadLink('https://example.com/extra/co-1/thread'), null);
  assert.equal(parseThreadLink('ezjobsite://extra/co-1'), null);
  assert.equal(parseThreadLink('ezjobsite://extra//thread'), null);
  assert.equal(parseThreadLink('ezjobsite://extra/%E0%A4%A/thread'), null);
  assert.equal(parseThreadLink(''), null);
});

test('truncate keeps whole words and marks the cut', () => {
  assert.equal(truncate('short', 40), 'short');
  const t = truncate('can you do it for less than that please', 20);
  assert.ok(t.endsWith('…'));
  assert.ok(t.length <= 20);
  assert.ok(!t.includes('  '));
});

test('the push carries the scope and the question but no price', () => {
  const n = notificationFor({
    changeOrderId: 'co-9', scope: 'Replace cracked water heater',
    question: 'Can you do it for $1,500?',
  });
  assert.deepEqual(n.title, { k: 'r5b.pushTitle', p: { scope: 'Replace cracked water heater' } });
  assert.equal(n.body, 'Can you do it for $1,500?');
  assert.deepEqual(parseThreadLink(n.link), { changeOrderId: 'co-9', focusReply: true });
});

test('the discussion log escapes what people typed', () => {
  const html = renderDiscussionLogHtml(
    [client('q1', T0, '<script>alert(1)</script>')],
    { clientLabel: 'Client', contractorLabel: 'You', emptyLabel: 'None',
      recordNote: 'note', formatAt: () => 'Jul 20 · 2:14 pm' },
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Jul 20 · 2:14 pm'));
});

test('an empty discussion log says so instead of rendering an empty table', () => {
  const html = renderDiscussionLogHtml([], {
    clientLabel: 'Client', contractorLabel: 'You', emptyLabel: 'No discussion recorded.',
    recordNote: 'note', formatAt: () => '',
  });
  assert.ok(html.includes('No discussion recorded.'));
  assert.ok(!html.includes('<table>'));
});
