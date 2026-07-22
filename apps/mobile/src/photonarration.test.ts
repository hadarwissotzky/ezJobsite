/**
 * Tests for R2's photo placement — "each photo beside the text it evidences".
 *   cd apps/mobile && node --test src/photonarration.test.ts
 *
 * The two rules worth defending here are the ones a reader would not guess: photos
 * attach to the sentence being spoken when the SHUTTER fired (asymmetric window,
 * because the phone comes up after the words), and a photo that fits nowhere goes to
 * the end strip rather than being captioned with an unrelated sentence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignPhotosToNarration, offsetLabel, type Segment } from './photonarration.ts';

const SEGS: Segment[] = [
  { s: 0, e: 5, t: 'Opened the wall behind the tub.' },
  { s: 5, e: 11, t: 'The subfloor is rotted right through.' },
  { s: 11, e: 18, t: 'We need to replace it before any tile goes down.' },
];
const ph = (id: string, offsetSec: number) => ({ captureId: id, offsetSec });

test('a photo lands beside the sentence being spoken when the shutter fired', () => {
  const a = alignPhotosToNarration(SEGS, [ph('p1', 7)]);
  assert.equal(a.fallbackStrip, false);
  assert.equal(a.strip.length, 0);
  assert.equal(a.blocks.length, 2);
  assert.equal(a.blocks[0].photos[0].captureId, 'p1');
  assert.match(a.blocks[0].text, /rotted right through/);
});

test('photo-less narration is merged forward, not rendered as one block per sentence', () => {
  const a = alignPhotosToNarration(SEGS, [ph('p1', 7)]);
  // Segment 0 has no photo, so it rides with segment 1 rather than becoming its own
  // paragraph. Forty one-line blocks is a transcript dump, not evidence.
  assert.match(a.blocks[0].text, /^Opened the wall/);
  assert.equal(a.blocks[0].startSec, 0);
});

test('narration after the last photo is kept, never truncated', () => {
  const a = alignPhotosToNarration(SEGS, [ph('p1', 7)]);
  const last = a.blocks[a.blocks.length - 1];
  assert.equal(last.photos.length, 0);
  assert.match(last.text, /before any tile goes down/);
});

test('the shutter lagging the words into a SILENCE still belongs to those words', () => {
  // He stops talking at 11, raises the phone, shoots at 12.5, resumes at 15. The lag
  // window claims it for the sentence just spoken rather than the one not yet said.
  const gapped: Segment[] = [
    { s: 0, e: 11, t: 'The subfloor is rotted right through.' },
    { s: 15, e: 20, t: 'We need to replace it before any tile goes down.' },
  ];
  const a = alignPhotosToNarration(gapped, [ph('p1', 12.5)]);
  assert.match(a.blocks[0].text, /rotted right through/);
  assert.equal(a.blocks[0].photos[0].captureId, 'p1');
});

test('a shutter exactly midway between two sentences belongs to the EARLIER one', () => {
  // The tie-break, pinned. He says the thing and then raises the phone, so equal
  // distance is not a coin toss — it belongs to the sentence he had just finished.
  const gapped: Segment[] = [
    { s: 0, e: 10, t: 'The joist under the tub is cracked.' },
    { s: 14, e: 20, t: 'Next door the tile is fine.' },
  ];
  const a = alignPhotosToNarration(gapped, [ph('p1', 12)]);
  // Exact equality, not a substring match: photo-less segments merge FORWARD, so
  // "contains the first sentence" is also true when the photo wrongly lands on the
  // second. That weaker assertion passed against a deliberately broken tie-break.
  assert.equal(a.blocks[0].text, 'The joist under the tub is cracked.');
  assert.equal(a.blocks[0].photos[0].captureId, 'p1');
});

test('a photo squarely inside a sentence is never dragged onto the previous one', () => {
  // Contiguous segments: 5..11 ends exactly where 11..18 begins. A lag-first rule
  // put every early-sentence photo one caption too high. This is that regression.
  const a = alignPhotosToNarration(SEGS, [ph('p1', 12)]);
  assert.match(a.blocks[0].text, /before any tile goes down/);
});

test('two photos on the same sentence stay together, in shutter order', () => {
  const a = alignPhotosToNarration(SEGS, [ph('p2', 9), ph('p1', 6)]);
  assert.equal(a.blocks[0].photos.length, 2);
  assert.deepEqual(a.blocks[0].photos.map((p) => p.captureId), ['p1', 'p2']);
});

test('a photo far from any speech goes to the strip, never gets a wrong caption', () => {
  const a = alignPhotosToNarration(SEGS, [ph('p1', 7), ph('far', 400)]);
  assert.deepEqual(a.strip.map((p) => p.captureId), ['far']);
  assert.equal(a.fallbackStrip, false, 'one stray photo is not an ambiguous alignment');
});

test('no transcript yet: every photo still shows, as the fallback strip', () => {
  const a = alignPhotosToNarration([], [ph('p1', 3), ph('p2', 9)]);
  assert.equal(a.fallbackStrip, true);
  assert.equal(a.blocks.length, 0);
  assert.equal(a.strip.length, 2, 'evidence is never dropped for want of a caption');
});

test('when NOT ONE photo could be placed, the whole alignment is declared ambiguous', () => {
  const a = alignPhotosToNarration(SEGS, [ph('p1', 300), ph('p2', 600)]);
  assert.equal(a.fallbackStrip, true);
  assert.equal(a.strip.length, 2);
});

test('a walkthrough with no photos is not "ambiguous" — there was nothing to align', () => {
  const a = alignPhotosToNarration(SEGS, []);
  assert.equal(a.fallbackStrip, false);
  assert.equal(a.blocks.length, 1);
  assert.equal(a.strip.length, 0);
});

test('segments arriving out of order are sorted before alignment', () => {
  const a = alignPhotosToNarration([SEGS[2], SEGS[0], SEGS[1]], [ph('p1', 7)]);
  assert.match(a.blocks[0].text, /^Opened the wall/);
});

test('offsetLabel renders a gutter timestamp', () => {
  assert.equal(offsetLabel(0), '0:00');
  assert.equal(offsetLabel(7.4), '0:07');
  assert.equal(offsetLabel(125), '2:05');
});

test('the caller\'s extra photo fields survive alignment untouched', () => {
  // The screen carries uri/present through this module; losing them would render
  // an aligned photo as a blank tile, which mandate #1 calls silent loss.
  const rich = { captureId: 'p1', offsetSec: 7, uri: 'file://a.jpg', present: true };
  const a = alignPhotosToNarration(SEGS, [rich]);
  assert.equal(a.blocks[0].photos[0].uri, 'file://a.jpg');
  assert.equal(a.blocks[0].photos[0].present, true);
});
