/**
 * Tests for R1's session arithmetic. Run: cd apps/mobile && node --test src/capturesession.test.ts
 *
 * Every test below is an acceptance criterion from PRD R1 or a failure mode the
 * code exists to prevent, not a restatement of the implementation. The one that
 * matters most is `recordedMs` ignoring wall clock: the version that measured
 * `updatedAtMs - startedAtMs` passed a hand-check on a session recorded in one
 * sitting and cut a paused session off after a lunch break.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_CAP_MS, CAP_WARN_MS, capState, segmentBudgetMs,
  summarizeDraft, orderedItems, draftsToOffer,
  draftFilename, parseDraftFilename, draftRelpath, planAdoption, nextSeq, isSafeId,
  type DraftHeader, type DraftItem,
} from './capturesession.ts';

const T0 = 1_700_000_000_000;

const photo = (id: string, seq: number, atMs: number): DraftItem => ({
  itemId: id, kind: 'photo', atMs, seq, relpath: `capture-draft/d1/${id}.jpg`,
  mime: 'image/jpeg', durationMs: 0, fromLibrary: false,
});
const audio = (id: string, seq: number, atMs: number, durationMs: number): DraftItem => ({
  itemId: id, kind: 'audio', atMs, seq, relpath: `capture-draft/d1/${id}.m4a`,
  mime: 'audio/m4a', durationMs, fromLibrary: false,
});
const header = (draftId: string, state: DraftHeader['state'], updatedAtMs: number): DraftHeader =>
  ({ draftId, startedAtMs: T0, updatedAtMs, state });

// ── the 10-minute cap ─────────────────────────────────────────────────────────

test('PRD R1: the cap is 10 minutes of RECORDED audio', () => {
  assert.equal(SESSION_CAP_MS, 600_000);
  assert.equal(capState(0).atCap, false);
  assert.equal(capState(0).remainingMs, 600_000);
  assert.equal(capState(599_999).atCap, false);
  assert.equal(capState(600_000).atCap, true);
  assert.equal(capState(600_000).remainingMs, 0);
  assert.equal(capState(10_000_000).remainingMs, 0);
});

test('the warning fires in the last minute and stops once the cap is hit', () => {
  assert.equal(capState(CAP_WARN_MS - 1).warn, false);
  assert.equal(capState(CAP_WARN_MS).warn, true);
  assert.equal(capState(599_999).warn, true);
  // At the cap the banner is no longer "one minute left" — it is a different,
  // stronger message. Both showing at once is how a screen becomes noise.
  assert.equal(capState(SESSION_CAP_MS).warn, false);
});

test('a garbage duration clamps to zero rather than disabling the cap', () => {
  assert.equal(capState(Number.NaN).remainingMs, SESSION_CAP_MS);
  assert.equal(capState(-5).recordedMs, 0);
  // The bug this guards: NaN propagating into remainingMs makes atCap false forever.
  assert.equal(capState(Number.NaN).atCap, false);
});

test('segmentBudgetMs returns 0 at the cap, so a new segment is never armed', () => {
  assert.equal(segmentBudgetMs(0), SESSION_CAP_MS);
  assert.equal(segmentBudgetMs(590_000), 10_000);
  assert.equal(segmentBudgetMs(600_001), 0);
});

// ── recordedMs is audio, not elapsed time ─────────────────────────────────────

test('a session paused for five hours has recorded only what the mic recorded', () => {
  const h = header('d1', 'open', T0 + 5 * 3600_000);
  const items = [audio('a1', 0, T0, 120_000), audio('a2', 1, T0 + 5 * 3600_000, 60_000)];
  const s = summarizeDraft(h, items);
  assert.equal(s.recordedMs, 180_000);
  assert.equal(capState(s.recordedMs).atCap, false);
});

test('photos do not count toward the audio cap and are counted separately', () => {
  const s = summarizeDraft(header('d1', 'open', T0), [
    photo('p1', 0, T0), photo('p2', 1, T0 + 10), audio('a1', 2, T0 + 20, 30_000),
  ]);
  assert.equal(s.photos, 2);
  assert.equal(s.audioSegments, 1);
  assert.equal(s.recordedMs, 30_000);
});

// ── what gets offered on next open ────────────────────────────────────────────

test('AC: a paused session killed by the phone dying is recoverable on next open', () => {
  const h = header('d1', 'open', T0 + 5000);
  const s = summarizeDraft(h, [photo('p1', 0, T0), audio('a1', 1, T0 + 100, 4000)]);
  assert.equal(s.recoverable, true);
});

test('an empty draft is NOT offered — a recovery prompt for nothing trains dismissal', () => {
  const s = summarizeDraft(header('d1', 'open', T0), []);
  assert.equal(s.recoverable, false);
  assert.deepEqual(draftsToOffer([header('d1', 'open', T0)], { d1: [] }), []);
});

test('committed and discarded drafts are never re-offered', () => {
  const items = { d1: [photo('p1', 0, T0)], d2: [photo('p2', 0, T0)], d3: [photo('p3', 0, T0)] };
  const out = draftsToOffer(
    [header('d1', 'committed', T0), header('d2', 'discarded', T0), header('d3', 'open', T0)],
    items
  );
  assert.deepEqual(out.map((x) => x.draftId), ['d3']);
});

test('TWO crashes surface TWO drafts, newest first — mandate #1', () => {
  const out = draftsToOffer(
    [header('old', 'open', T0 + 1000), header('new', 'open', T0 + 9000)],
    { old: [audio('a1', 0, T0, 1000)], new: [audio('a2', 0, T0, 1000)] }
  );
  assert.deepEqual(out.map((x) => x.draftId), ['new', 'old']);
});

// ── ordering ──────────────────────────────────────────────────────────────────

test('two items in the same millisecond keep a stable, total order', () => {
  const a = photo('zzz', 1, T0);
  const b = audio('aaa', 0, T0, 500);
  assert.deepEqual(orderedItems([a, b]).map((x) => x.itemId), ['aaa', 'zzz']);
  // Same input, opposite array order, same result. An unstable sort here
  // reorders the narration a signer later reads back.
  assert.deepEqual(orderedItems([b, a]).map((x) => x.itemId), ['aaa', 'zzz']);
});

// ── filenames carry their own metadata, so a crash mid-bank is recoverable ────

test('a draft filename round-trips', () => {
  const f = { seq: 7, kind: 'audio' as const, atMs: T0, ext: 'm4a' };
  const name = draftFilename(f);
  assert.equal(name, `0007-audio-${T0}.m4a`);
  assert.deepEqual(parseDraftFilename(name), f);
});

test('sequence is zero-padded so lexical order equals capture order', () => {
  const names = [9, 10, 2].map((seq) => draftFilename({ seq, kind: 'photo', atMs: T0, ext: 'jpg' }));
  assert.deepEqual([...names].sort().map((n) => parseDraftFilename(n)!.seq), [2, 9, 10]);
});

test('a name we cannot attribute parses as null rather than as something plausible', () => {
  assert.equal(parseDraftFilename('../../etc/passwd'), null);
  assert.equal(parseDraftFilename('0001-video-123.mp4'), null);
  assert.equal(parseDraftFilename('1-photo-123.jpg'), null);   // unpadded: not ours
  assert.equal(parseDraftFilename(''), null);
});

test('a path is never built from an id we did not generate', () => {
  assert.equal(isSafeId('d-abc_123'), true);
  assert.equal(isSafeId('../evil'), false);
  assert.equal(isSafeId(''), false);
  assert.throws(() => draftRelpath('../evil', { seq: 0, kind: 'photo', atMs: T0, ext: 'jpg' }));
  assert.equal(
    draftRelpath('d1', { seq: 0, kind: 'photo', atMs: T0, ext: 'jpg' }),
    `capture-draft/d1/0000-photo-${T0}.jpg`
  );
});

test('a file banked but never indexed is ADOPTED, never deleted', () => {
  const onDisk = [`0000-photo-${T0}.jpg`, `0001-audio-${T0 + 5}.m4a`, 'README'];
  const plan = planAdoption('d1', onDisk, [`capture-draft/d1/0000-photo-${T0}.jpg`]);
  assert.deepEqual(plan.adopt.map((a) => a.parsed.seq), [1]);
  assert.equal(plan.adopt[0].parsed.kind, 'audio');
  // Unattributable, so left alone and reported — not swept.
  assert.deepEqual(plan.unknown, ['README']);
});

test('nextSeq uses max+1 so adoption gaps never collide on the UNIQUE relpath', () => {
  assert.equal(nextSeq([]), 0);
  // count would say 2 here, and seq 2 already exists.
  assert.equal(nextSeq([photo('p0', 0, T0), photo('p2', 2, T0)]), 3);
});
