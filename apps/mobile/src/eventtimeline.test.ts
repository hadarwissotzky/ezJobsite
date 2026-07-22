/**
 * Tests for the R6 timeline logic.
 *
 * Run: cd apps/mobile && node --test src/eventtimeline.test.ts
 *
 * What is worth testing here is not "does it map a string": it is the three places
 * this module can put a FALSEHOOD on a legal record —
 *   1. inventing a timestamp for a row whose time did not parse,
 *   2. printing one real event twice (once stamped, once "time not recorded"),
 *   3. dropping the unstamped events when there is no server data, leaving an
 *      offline contractor looking at a record that says nothing was ever sent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeEvent, mergeTimeline, openCount, openSignal, parseSnapshot, parseTimeline,
  snapshotVerifies, type LocalEvent, type ServerEvent,
} from './eventtimeline.ts';

const iso = (s: string) => s;
const T1 = Date.parse('2026-07-20T14:00:00Z');
const T2 = Date.parse('2026-07-20T15:30:00Z');
const T3 = Date.parse('2026-07-21T09:05:00Z');

// ─── parseTimeline ─────────────────────────────────────────────────────────────

test('parseTimeline reads the rpc shape and sorts chronologically', () => {
  const evs = parseTimeline({
    events: [
      { kind: 'approved', at: iso('2026-07-21T09:05:00Z'), detail: { name: 'Dana Ruiz' } },
      { kind: 'sent', at: iso('2026-07-20T14:00:00Z'), detail: { channel: 'sms', who: 'Owner' } },
      { kind: 'opened', at: iso('2026-07-20T15:30:00Z'), detail: {} },
    ],
  });
  assert.deepEqual(evs.map((e) => e.kind), ['sent', 'opened', 'approved']);
  assert.equal(evs[0].atMs, T1);
  assert.equal(evs[0].channel, 'sms');
  assert.equal(evs[0].who, 'Owner');
  assert.equal(evs[2].name, 'Dana Ruiz');
});

test('parseTimeline drops rows it cannot place in time instead of guessing', () => {
  const evs = parseTimeline({
    events: [
      { kind: 'opened', at: null, detail: {} },
      { kind: 'opened', at: 'not a date', detail: {} },
      { kind: 'opened', at: iso('2026-07-20T15:30:00Z'), detail: {} },
    ],
  });
  assert.equal(evs.length, 1);
  assert.equal(evs[0].atMs, T2);
});

test('parseTimeline drops kinds it does not know', () => {
  // A future migration adding an event kind must not be able to render a blank
  // line, or worse an untranslated key, onto the record.
  const evs = parseTimeline({ events: [{ kind: 'teleported', at: iso('2026-07-20T14:00:00Z') }] });
  assert.deepEqual(evs, []);
});

test('parseTimeline survives junk payloads', () => {
  assert.deepEqual(parseTimeline(null), []);
  assert.deepEqual(parseTimeline({}), []);
  assert.deepEqual(parseTimeline({ events: 'nope' }), []);
  assert.deepEqual(parseTimeline({ events: [null, 7, 'x'] }), []);
});

// ─── parseSnapshot ─────────────────────────────────────────────────────────────

test('parseSnapshot reads the frozen instrument', () => {
  const s = parseSnapshot({
    snapshot: {
      token: 'abc', shown_content: 'Approval requested…', shown_sha256: 'AB12',
      action: 'confirmed', signed_name: 'Dana Ruiz',
      answered_at: iso('2026-07-21T09:05:00Z'), superseded: false,
    },
  });
  assert.ok(s);
  assert.equal(s.content, 'Approval requested…');
  assert.equal(s.action, 'confirmed');
  assert.equal(s.answeredAtMs, T3);
  assert.equal(s.superseded, false);
});

test('parseSnapshot refuses a snapshot with no content', () => {
  // A snapshot card rendered from an empty instrument would imply the client
  // signed a blank page.
  assert.equal(parseSnapshot({ snapshot: { token: 'abc', shown_content: '' } }), null);
  assert.equal(parseSnapshot({ snapshot: null }), null);
  assert.equal(parseSnapshot(undefined), null);
});

test('parseSnapshot keeps an unparseable answered_at null rather than defaulting it', () => {
  const s = parseSnapshot({
    snapshot: { token: 't', shown_content: 'x', shown_sha256: 'y', answered_at: 'garbage' },
  });
  assert.ok(s);
  assert.equal(s.answeredAtMs, null);
});

// ─── describeEvent ─────────────────────────────────────────────────────────────

test('describeEvent folds the channel into the key, never into a parameter', () => {
  assert.equal(describeEvent({ kind: 'sent', atMs: T1, channel: 'sms', who: 'Owner' }).k,
    'erec.evSentSms');
  assert.equal(describeEvent({ kind: 'sent', atMs: T1, channel: 'email', who: 'Owner' }).k,
    'erec.evSentEmail');
  assert.equal(describeEvent({ kind: 'sent', atMs: T1, channel: 'link', who: 'GC' }).k,
    'erec.evSentLink');
});

test('describeEvent falls back to the plain sent line when a piece is missing', () => {
  assert.equal(describeEvent({ kind: 'sent', atMs: T1, channel: 'sms' }).k, 'erec.evSent');
  assert.equal(describeEvent({ kind: 'sent', atMs: T1, channel: 'carrier-pigeon', who: 'Owner' }).k,
    'erec.evSent');
});

test('describeEvent quotes the question verbatim', () => {
  const d = describeEvent({ kind: 'asked', atMs: T2, note: 'Does that include the trim?' });
  assert.equal(d.k, 'erec.evAsked');
  assert.equal(d.p?.note, 'Does that include the trim?');
});

test('describeEvent names the signer on both terminal answers', () => {
  assert.equal(describeEvent({ kind: 'approved', atMs: T3, name: 'Dana Ruiz' }).k, 'erec.evApprovedBy');
  assert.equal(describeEvent({ kind: 'declined', atMs: T3, name: 'Dana Ruiz' }).k, 'erec.evDeclinedBy');
  assert.equal(describeEvent({ kind: 'approved', atMs: T3 }).k, 'erec.evApproved');
  assert.equal(describeEvent({ kind: 'declined', atMs: T3 }).k, 'erec.evDeclined');
});

// ─── mergeTimeline ─────────────────────────────────────────────────────────────

const localStamped: LocalEvent[] = [
  { atMs: T1 - 3600_000, at: 'Jul 20 · 1:00 pm', what: 'Captured on site' },
  { atMs: T1 - 1800_000, at: 'Jul 20 · 1:30 pm', what: 'Extra created' },
];
const localUnstamped: LocalEvent[] = [
  { atMs: null, at: 'time not recorded', what: 'Sent for approval', hot: true },
  { atMs: null, at: 'time not recorded', what: 'Signed by Dana Ruiz', hot: true },
];

test('AC1: two opens and one question appear in order with their timestamps', () => {
  const server: ServerEvent[] = parseTimeline({
    events: [
      { kind: 'sent', at: iso('2026-07-20T14:00:00Z'), detail: { channel: 'sms', who: 'Owner' } },
      { kind: 'opened', at: iso('2026-07-20T15:30:00Z'), detail: {} },
      { kind: 'asked', at: iso('2026-07-20T15:35:00Z'), detail: { note: 'Trim included?' } },
      { kind: 'opened', at: iso('2026-07-21T08:00:00Z'), detail: {} },
    ],
  });
  const merged = mergeTimeline([...localStamped, ...localUnstamped], server);

  assert.deepEqual(
    merged.map((m) => m.text ?? m.k),
    ['Captured on site', 'Extra created', 'erec.evSentSms', 'erec.evOpened',
     'erec.evAsked', 'erec.evOpened'],
  );
  // Every line carries a time.
  assert.ok(merged.every((m) => m.atMs !== null));
  // And they ascend.
  const times = merged.map((m) => m.atMs as number);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('the unstamped local events are dropped once the server can stamp them', () => {
  const server = parseTimeline({
    events: [{ kind: 'sent', at: iso('2026-07-20T14:00:00Z'), detail: { channel: 'sms', who: 'Owner' } }],
  });
  const merged = mergeTimeline([...localStamped, ...localUnstamped], server);
  // "Sent for approval — time not recorded" must not sit under the stamped one.
  assert.equal(merged.filter((m) => m.atMs === null).length, 0);
  assert.equal(merged.filter((m) => m.text === 'Sent for approval').length, 0);
});

test('offline, the unstamped local events survive — the record still tells the truth', () => {
  const merged = mergeTimeline([...localStamped, ...localUnstamped], []);
  assert.equal(merged.length, 4);
  // and they sit last, exactly where record.ts put them.
  assert.deepEqual(merged.slice(2).map((m) => m.text),
    ['Sent for approval', 'Signed by Dana Ruiz']);
});

test('merge is stable for events sharing a millisecond', () => {
  const server: ServerEvent[] = [{ kind: 'opened', atMs: T1 }, { kind: 'asked', atMs: T1, note: 'q' }];
  const merged = mergeTimeline([{ atMs: T1, at: 'x', what: 'local' }], server);
  assert.deepEqual(merged.map((m) => m.text ?? m.k), ['local', 'erec.evOpened', 'erec.evAsked']);
});

// ─── openSignal ────────────────────────────────────────────────────────────────

test('openCount counts only opens', () => {
  const server: ServerEvent[] = [
    { kind: 'sent', atMs: T1 }, { kind: 'opened', atMs: T2 }, { kind: 'opened', atMs: T3 },
  ];
  assert.equal(openCount(server), 2);
});

test('openSignal is the chase-or-not signal, and only while the item is out', () => {
  const sent: ServerEvent[] = [{ kind: 'sent', atMs: T1 }];
  assert.deepEqual(openSignal(sent, 'sent'), { k: 'erec.notOpenedYet' });
  assert.deepEqual(openSignal([...sent, { kind: 'opened', atMs: T2 }], 'sent'),
    { k: 'erec.openedOnce' });
  assert.deepEqual(
    openSignal([...sent, { kind: 'opened', atMs: T2 }, { kind: 'opened', atMs: T3 }], 'sent'),
    { k: 'erec.openedTimes', p: { n: 2 } });
  // Answered: the count stops being a prompt to act on.
  assert.equal(openSignal([...sent, { kind: 'opened', atMs: T2 }], 'approved'), null);
  assert.equal(openSignal([...sent, { kind: 'opened', atMs: T2 }], 'declined'), null);
  // Never sent: nothing to say about opens.
  assert.equal(openSignal([], 'sent'), null);
});

// ─── snapshotVerifies ──────────────────────────────────────────────────────────

test('snapshotVerifies compares the hash, tolerating only hex casing', () => {
  assert.equal(snapshotVerifies('AB12cd', 'ab12CD'), true);
  assert.equal(snapshotVerifies(' ab12cd ', 'ab12cd'), true);
  assert.equal(snapshotVerifies('ab12cd', 'ab12ce'), false);
});

test('snapshotVerifies refuses to pass on a missing hash', () => {
  // "no hash" must never read as "verified" — that is the failure where a tampered
  // copy shows a green tick.
  assert.equal(snapshotVerifies('', ''), false);
  assert.equal(snapshotVerifies('ab12cd', ''), false);
  assert.equal(snapshotVerifies('', 'ab12cd'), false);
});
