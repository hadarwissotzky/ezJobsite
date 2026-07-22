/**
 * R2 — "the structured scope shows each photo BESIDE THE TEXT IT EVIDENCES
 * (fallback: photo strip at end if alignment is ambiguous)."
 *
 * What existed before this file: the alignment was computed, thrown away, and never
 * rendered. `autotag.ts` walks the same two facts (photo shutter times, transcript
 * segment times) and reduces the answer to a 48-character TAG STRING on the photo;
 * the extra record then draws the photos as a bare grid with timestamps. So the
 * product knew which sentence each photo belonged to and showed a wall of
 * thumbnails — which is the artefact a homeowner is asked to approve, and it does
 * not say what any picture is of.
 *
 * This module produces the STRUCTURE for that rendering: narration broken into
 * blocks, each carrying the photos taken while it was being spoken.
 *
 * PURE — no imports, no I/O, no clock (see approverrouting.ts for the pattern and the
 * reason). Generic in the photo type so the caller can carry uri/present/timestamp
 * through untouched; this file only ever reads `captureId` and `offsetSec`.
 *
 * KNOWN DUPLICATION, STATED RATHER THAN HIDDEN: the ±window below intentionally
 * matches `segmentAt()` in autotag.ts (-1s / +2s inside, 20s nearest-fallback). They
 * are two implementations of one rule, so a photo could in principle be tagged with
 * one sentence and displayed beside another. Unifying them means editing autotag.ts,
 * which this change is not allowed to touch; the honest fix is to delete `segmentAt`
 * and have autotag call `alignPhotosToNarration`. Left as a named debt, not a silent one.
 */

/** A transcribed span, as `capture_transcript.segments` stores it (sql/190). */
export type Segment = { s: number; e: number; t: string };

/** The minimum a photo must carry. Callers extend it freely. */
export type PhotoAt = { captureId: string; offsetSec: number };

export type NarrationBlock<P extends PhotoAt> = {
  /** Everything said up to and including the sentence these photos evidence. */
  text: string;
  /** Seconds into the narration this block starts — for a "0:42" gutter label. */
  startSec: number;
  photos: P[];
};

export type Alignment<P extends PhotoAt> = {
  blocks: NarrationBlock<P>[];
  /** Photos with no honest home. Rendered as the fallback strip, at the end. */
  strip: P[];
  /**
   * True when the whole alignment was ambiguous — no segments at all, or not one
   * photo could be placed. R2's named fallback. It is NOT set merely because some
   * photos landed in the strip: a walkthrough where four of five photos sit beside
   * their sentence is a success, and the fifth is honestly at the end.
   */
  fallbackStrip: boolean;
};

/**
 * Beyond this, no sentence is honestly "the text it evidences". A photo 20s from any
 * speech goes to the strip rather than being married to an unrelated sentence — a
 * wrong caption on evidence is worse than no caption, because it will be read as a
 * claim about the picture.
 */
const MAX_NEAREST_SEC = 20;

/** Seconds from a shutter to a spoken span. Zero while the span is being spoken. */
function gapTo(seg: Segment, offsetSec: number): number {
  if (offsetSec < seg.s) return seg.s - offsetSec;
  if (offsetSec > seg.e) return offsetSec - seg.e;
  return 0;
}

/**
 * Which sentence was being spoken when the shutter fired. -1 when none honestly was.
 *
 * Nearest-span, ties to the EARLIER sentence. The tie-break is not arbitrary: a man
 * says the thing and THEN raises the phone, so a photo sitting in the silence between
 * two sentences belongs to the one he had just finished.
 *
 * REJECTED: a separate ±window pass before this one, mirroring `segmentAt()` in
 * autotag.ts. Transcript spans are usually contiguous (one ends exactly where the next
 * begins), so a window pass that checked "within 2s AFTER a span" first matched the
 * PREVIOUS sentence for every photo taken in the opening two seconds of a new one —
 * an off-by-one caption on most of a walkthrough. A test caught it. Nearest-span makes
 * the window redundant, so the window is gone rather than patched.
 */
function indexForPhoto(segs: Segment[], offsetSec: number): number {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < segs.length; i++) {
    const d = gapTo(segs[i], offsetSec);
    if (d < bestD) { bestD = d; best = i; }
  }
  return bestD <= MAX_NEAREST_SEC ? best : -1;
}

/**
 * Join the narration to the photo strip.
 *
 * Blocks are cut at photos, not at sentences: consecutive segments with no photo are
 * merged into the following block's text. One block per segment would render a
 * walkthrough as forty one-line paragraphs, which is not "the text it evidences" —
 * it is a transcript dump with pictures in it.
 */
export function alignPhotosToNarration<P extends PhotoAt>(
  segments: Segment[], photos: P[]
): Alignment<P> {
  const segs = [...segments].sort((a, b) => a.s - b.s);
  const ordered = [...photos].sort((a, b) => a.offsetSec - b.offsetSec);

  if (!segs.length) {
    // Nothing transcribed (yet, or at all). Every photo is still shown — mandate #1
    // says evidence is never dropped for want of a caption.
    return { blocks: [], strip: ordered, fallbackStrip: true };
  }

  const bySeg = new Map<number, P[]>();
  const strip: P[] = [];
  for (const p of ordered) {
    const i = indexForPhoto(segs, p.offsetSec);
    if (i < 0) { strip.push(p); continue; }
    if (!bySeg.has(i)) bySeg.set(i, []);
    bySeg.get(i)!.push(p);
  }

  const blocks: NarrationBlock<P>[] = [];
  let buffer: string[] = [];
  let bufferStart = segs[0].s;
  for (let i = 0; i < segs.length; i++) {
    if (!buffer.length) bufferStart = segs[i].s;
    buffer.push(segs[i].t.trim());
    const here = bySeg.get(i);
    if (here?.length) {
      blocks.push({ text: buffer.join(' ').trim(), startSec: bufferStart, photos: here });
      buffer = [];
    }
  }
  // Trailing narration after the last photo is still part of the scope and is kept as
  // a photo-less block. Dropping it would silently truncate what the man said.
  if (buffer.length) {
    const text = buffer.join(' ').trim();
    if (text) blocks.push({ text, startSec: bufferStart, photos: [] });
  }

  return {
    blocks, strip,
    fallbackStrip: ordered.length > 0 && strip.length === ordered.length,
  };
}

/** "0:42" — the gutter label for a block. Minutes never exceed two digits in a 10-min cap. */
export function offsetLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
