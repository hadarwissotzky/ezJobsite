/**
 * Tests for R4's photo cap and load budget.
 * Run: cd apps/mobile && node --test src/approvalphotos.test.ts
 *
 * Node strips the TypeScript types natively, so this needs no jest, no vitest and no
 * config — same as `approverrouting.test.ts`, which is why the `.ts` extension on the
 * import is explicit and required.
 *
 * These assert the PRD text directly ("0-8 photos per extra", "load in <=3s on LTE"),
 * because the thing worth protecting is the requirement, not the current arithmetic.
 * The budget constants are expected to move once someone measures a real phone; the
 * INVARIANTS below are what must survive that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHOTOS_PER_EXTRA_MAX,
  EAGER_BYTE_BUDGET,
  LOAD_BUDGET_MS,
  LTE_BYTES_PER_SEC,
  TRANSFORM,
  capPhotos,
  planApprovalPhotos,
  remainingPhotoSlots,
  isAttachablePhoto,
  type SourcePhoto,
} from './approvalphotos.ts';

const photo = (
  captureId: string,
  capturedAtMs: number,
  bytes = 100_000,
  mime = 'image/jpeg'
): SourcePhoto => ({ captureId, capturedAtMs, bytes, mime });

/** n photos, one second apart, each `bytes` big. */
const walk = (n: number, bytes = 100_000): SourcePhoto[] =>
  Array.from({ length: n }, (_, i) => photo(`cap-${i}`, 1_000 + i * 1_000, bytes));

// ── PRD R4: "0-8 photos per extra" ────────────────────────────────────────────

test('AC: the cap is 8 per extra and the overflow is reported, not silently dropped', () => {
  const { kept, droppedOverCap } = capPhotos(walk(11));
  assert.equal(kept.length, PHOTOS_PER_EXTRA_MAX);
  assert.equal(kept.length, 8, 'PRD R4 says 0-8; if this changes the PRD changed');
  assert.equal(droppedOverCap.length, 3);
  // The count has to reach the contractor, so the dropped ones must be returned —
  // not just omitted. A cap you cannot see is indistinguishable from lost evidence.
  assert.deepEqual(
    droppedOverCap.map((p) => p.captureId),
    ['cap-8', 'cap-9', 'cap-10']
  );
});

test('0 photos is a legal extra — the range starts at 0', () => {
  const plan = planApprovalPhotos([]);
  assert.deepEqual(plan.photos, []);
  assert.equal(plan.droppedOverCap, 0);
  assert.equal(plan.eagerBytes, 0);
});

test('the cap keeps the START of the walk, because narration order is evidence order', () => {
  const { kept } = capPhotos(walk(10));
  assert.equal(kept[0].captureId, 'cap-0');
  assert.equal(kept[7].captureId, 'cap-7');
});

test('input order does not decide output order — the capture clock does', () => {
  const shuffled = [photo('c', 3_000), photo('a', 1_000), photo('b', 2_000)];
  const { kept } = capPhotos(shuffled);
  assert.deepEqual(kept.map((p) => p.captureId), ['a', 'b', 'c']);
});

test('photos stamped in the same millisecond order deterministically', () => {
  // A fused Snap+Talk session really does produce these. Without the captureId
  // tiebreak the strip could reorder itself between the preview and the signed page.
  const a = planApprovalPhotos([photo('cap-z', 5_000), photo('cap-a', 5_000)]);
  const b = planApprovalPhotos([photo('cap-a', 5_000), photo('cap-z', 5_000)]);
  assert.deepEqual(
    a.photos.map((p) => p.captureId),
    b.photos.map((p) => p.captureId)
  );
  assert.deepEqual(a.photos.map((p) => p.captureId), ['cap-a', 'cap-z']);
});

test('seq is dense and starts at 0 — it is the frozen row key, not a hint', () => {
  const plan = planApprovalPhotos(walk(5));
  assert.deepEqual(plan.photos.map((p) => p.seq), [0, 1, 2, 3, 4]);
});

test('seq never reaches the DB check bound of 8', () => {
  // 304_approval_photos.sql carries `check (seq >= 0 and seq < 8)`. If the cap here
  // ever grew without that check moving, every extra past the 8th would be rejected
  // by Postgres at send time — after the confirmation row already exists.
  const plan = planApprovalPhotos(walk(20));
  assert.ok(plan.photos.every((p) => p.seq >= 0 && p.seq < 8));
});

test('video and audio never reach the client page', () => {
  assert.equal(isAttachablePhoto('video/mp4'), false);
  assert.equal(isAttachablePhoto('audio/m4a'), false);
  assert.equal(isAttachablePhoto('image/heic'), true);
  assert.equal(isAttachablePhoto('IMAGE/JPEG'), true);
  const { kept } = capPhotos([
    photo('v', 1_000, 40_000_000, 'video/mp4'),
    photo('p', 2_000, 100_000, 'image/jpeg'),
  ]);
  assert.deepEqual(kept.map((p) => p.captureId), ['p']);
});

test('remainingPhotoSlots counts down to 0 and never below', () => {
  assert.equal(remainingPhotoSlots(0), 8);
  assert.equal(remainingPhotoSlots(3), 5);
  assert.equal(remainingPhotoSlots(8), 0);
  assert.equal(remainingPhotoSlots(99), 0);
});

// ── PRD R4 AC: "photos load in <=3s on LTE" ───────────────────────────────────

test('AC: the eager bytes fit inside the 3-second LTE budget', () => {
  // Eight 400 KB photos = 3.2 MB, which is ~4.3s of transfer on its own. The plan must
  // not promise to fetch all of that before the client sees the page.
  const plan = planApprovalPhotos(walk(8, 400_000));
  assert.ok(
    plan.eagerBytes <= EAGER_BYTE_BUDGET,
    `eager ${plan.eagerBytes} exceeds budget ${EAGER_BYTE_BUDGET}`
  );
  // The real invariant, restated against the AC rather than the constant: whatever the
  // page commits to fetching up front must transfer inside the 3 seconds.
  assert.ok((plan.eagerBytes / LTE_BYTES_PER_SEC) * 1000 <= LOAD_BUDGET_MS);
  assert.ok(plan.photos.some((p) => !p.eager), 'something must be deferred here');
});

test('a small walk loads entirely up front — the budget must not defer for nothing', () => {
  const plan = planApprovalPhotos(walk(4, 80_000));
  assert.ok(plan.photos.every((p) => p.eager));
});

test('the first photo is always eager, even when it alone blows the budget', () => {
  // One 9 MB unresized photo. A strip where every tile is blank until you scroll is
  // worse than a slow one: the client cannot tell there is anything to look at.
  const plan = planApprovalPhotos([photo('huge', 1_000, 9_000_000)]);
  assert.equal(plan.photos[0].eager, true);
});

test('the eager set is a contiguous prefix', () => {
  // A big photo followed by a tiny one must not produce lazy-then-eager: the tiles
  // render in narration order and would fill in out of sequence in front of the client.
  const plan = planApprovalPhotos([
    photo('a', 1_000, 100_000),
    photo('b', 2_000, 5_000_000),
    photo('c', 3_000, 10_000),
  ]);
  const flags = plan.photos.map((p) => p.eager);
  const firstLazy = flags.indexOf(false);
  assert.notEqual(firstLazy, -1);
  assert.ok(flags.slice(firstLazy).every((f) => f === false), `not a prefix: ${flags}`);
});

test('every planned photo carries the transform target', () => {
  const plan = planApprovalPhotos(walk(3));
  for (const p of plan.photos) {
    assert.equal(p.targetLongEdgePx, TRANSFORM.longEdgePx);
    assert.equal(p.targetQuality, TRANSFORM.quality);
  }
});

test('the budget leaves room for the page itself', () => {
  // If PAGE_SHELL_BYTES ever grew past the whole transfer window this would go
  // negative and every photo would be deferred, silently gutting the feature.
  assert.ok(EAGER_BYTE_BUDGET > 0);
});
