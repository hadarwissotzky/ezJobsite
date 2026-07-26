/**
 * R4 — which photos go on the homeowner's approval page, and how fast they must load.
 *
 * PURE. No imports, no database, no clock, no I/O — same reason as
 * `approverrouting.ts`: this file decides what evidence a signer does and does not
 * see before they commit money, that is the kind of thing that is wrong for months
 * without anyone noticing, and the repo has no test runner for anything that touches
 * PowerSync or Supabase. Keeping it import-free is what makes
 * `approvalphotos.test.ts` runnable at all (node --test strips the types and needs
 * nothing else to resolve). The Supabase/Storage half lives in
 * `approvalphotopublish.ts`.
 *
 * THE TWO RULES FROM PRD R4:
 *   "0-8 photos per extra"  -> the cap, enforced here rather than trusted to a screen.
 *   "photos load in <=3s on LTE" -> a BYTE BUDGET, computed from stated assumptions
 *                                   below rather than hoped for.
 *
 * WHY A CAP AT ALL, since more evidence sounds strictly better: the cap is not a
 * storage limit, it is a READING limit. Every photo past the first few pushes the
 * Approve button further down a phone screen, and the failure this product exists to
 * prevent is a client who does not answer. The evidence is not lost — every capture
 * stays in `capture_commit`, append-only, and the contractor's record screen shows all
 * of them. The cap governs only what is put in front of the signer.
 */

/** PRD R4, literally: "0-8 photos per extra". */
export const PHOTOS_PER_EXTRA_MAX = 8;

/**
 * Server-side image transform asked of Supabase Storage when it is available.
 *
 * 1200px long edge is roughly 3x a phone's CSS width, so it still looks sharp on a
 * retina screen and still reads when the client pinch-zooms into the crack in the
 * joist — which is the whole reason the photo is there.
 *
 * REJECTED: doing the resize on the device with expo-image-manipulator. It is the
 * better answer (it shrinks the bytes before they ever leave the phone, so it also
 * helps the CONTRACTOR's data bill) but it is a new native dependency and this change
 * may not edit package.json. The transform is requested per-URL and the page carries
 * an untransformed fallback, so if the storage tier cannot transform, the page still
 * renders — slower, never blank. See `not_done`.
 */
export const TRANSFORM = { longEdgePx: 1200, quality: 60 } as const;

// ─── the load budget, from the AC ──────────────────────────────────────────────
// Every number here is an ASSUMPTION, written down so it can be argued with rather
// than discovered later in a bug report. None of them is measured; when someone
// measures the real page on a real LTE phone, these are the constants to move.

/** ~6 Mbit/s sustained. Not peak LTE — the number you get in a driveway. */
export const LTE_BYTES_PER_SEC = 750_000;
/** DNS + TLS + first byte on a cold cellular link, before anything transfers. */
export const LTE_SETUP_MS = 700;
/** The AC: "photos load in <=3s on LTE". */
export const LOAD_BUDGET_MS = 3_000;
/**
 * The page itself: HTML, the supabase-js module from esm.sh, the two web fonts, and
 * the two RPC round trips. Estimated, not measured. It is subtracted because the
 * client's 3 seconds start when they tap the SMS link, not when the images do.
 */
export const PAGE_SHELL_BYTES = 260_000;

/** Bytes available for photos that load WITH the page. */
export const EAGER_BYTE_BUDGET = Math.max(
  0,
  Math.floor(((LOAD_BUDGET_MS - LTE_SETUP_MS) / 1000) * LTE_BYTES_PER_SEC) - PAGE_SHELL_BYTES
);

export type SourcePhoto = {
  captureId: string;
  /** The capture moment, so the strip reads in the order the contractor walked it. */
  capturedAtMs: number;
  /** Size of the ORIGINAL evidence file on the device. */
  bytes: number;
  mime: string;
};

export type PlannedPhoto = SourcePhoto & {
  /** Position on the page. Stable, and the primary key of the frozen row. */
  seq: number;
  /**
   * True -> the page fetches it immediately (`loading="eager"`, high priority).
   * False -> `loading="lazy"`: the browser does not fetch it until the client
   * scrolls it into view, which costs nothing above the fold.
   */
  eager: boolean;
  targetLongEdgePx: number;
  targetQuality: number;
};

export type ApprovalPhotoPlan = {
  photos: PlannedPhoto[];
  /** How many were cut by the 0-8 cap. Shown to the contractor, never hidden. */
  droppedOverCap: number;
  /** Worst-case bytes the page commits to fetching before first paint of the strip. */
  eagerBytes: number;
};

/** How many more photos this extra can take. Never negative. */
export function remainingPhotoSlots(attached: number): number {
  return Math.max(0, PHOTOS_PER_EXTRA_MAX - Math.max(0, attached));
}

/**
 * Only still images go to the client. PRD R4 says "photos", and the AC is a load-
 * time budget that non-image media cannot meet on LTE. This stays an explicit mime
 * allow-list (image/* only) as defence — video capture is removed from the app
 * (hadar 2026-07-25), so this now also rejects any legacy 'video/*' bytes still on
 * an un-wiped device rather than trusting that none exist.
 */
export function isAttachablePhoto(mime: string): boolean {
  return typeof mime === 'string' && mime.toLowerCase().startsWith('image/');
}

/**
 * Narration order: oldest capture first, `captureId` breaking ties.
 *
 * The tiebreak is not decoration. A fused Snap+Talk session stamps several photos with
 * the same millisecond, and without a deterministic second key the strip would reorder
 * itself between the contractor's preview and the client's page depending on SQLite row
 * order — a photo silently moving position on a signed instrument.
 */
function inNarrationOrder(photos: SourcePhoto[]): SourcePhoto[] {
  return [...photos].sort(
    (a, b) => a.capturedAtMs - b.capturedAtMs || a.captureId.localeCompare(b.captureId)
  );
}

/**
 * Apply the 0-8 cap. Keeps the EARLIEST photos, not the largest or the newest.
 *
 * Earliest wins because narration order is evidence order: the first thing the
 * contractor photographed is the thing they opened the conversation with. Dropping the
 * front of the walk to keep the tail would leave the client reading a story that starts
 * in the middle.
 */
export function capPhotos(photos: SourcePhoto[]): {
  kept: SourcePhoto[];
  droppedOverCap: SourcePhoto[];
} {
  const ordered = inNarrationOrder(photos.filter((p) => isAttachablePhoto(p.mime)));
  return {
    kept: ordered.slice(0, PHOTOS_PER_EXTRA_MAX),
    droppedOverCap: ordered.slice(PHOTOS_PER_EXTRA_MAX),
  };
}

/**
 * Decide the strip: order, cap, and which photos the page may fetch up front.
 *
 * THE BUDGET IS COMPUTED ON THE UNTRANSFORMED SIZE, on purpose. The Supabase image
 * transform is requested but not guaranteed (it is a storage-tier feature, and the page
 * falls back to the original URL when it 400s). Budgeting on the transformed size we
 * HOPE to get would mean the AC holds only when the optional feature happens to be on,
 * and fails silently — on the client's phone, at the worst moment — when it is not.
 * Budget on the worst case and the 3 seconds hold either way.
 *
 * The first photo is always eager even when it alone blows the budget. A photo strip
 * whose every tile is empty until you scroll is worse than a slow one: the client does
 * not know there is anything to see, and R4 exists so that they do.
 */
export function planApprovalPhotos(photos: SourcePhoto[]): ApprovalPhotoPlan {
  const { kept, droppedOverCap } = capPhotos(photos);

  // The eager set is a PREFIX, not "whichever ones happen to fit". Once the budget is
  // spent, everything after it is lazy — including a small photo that would still fit.
  // Photos render in narration order, so a cherry-picked eager set would load tile 4
  // before tile 2 and the strip would fill in out of order in front of the client.
  let spent = 0;
  let budgetLeft = true;
  const planned = kept.map((p, i) => {
    const eager = i === 0 || (budgetLeft && spent + p.bytes <= EAGER_BYTE_BUDGET);
    if (eager) spent += p.bytes;
    else budgetLeft = false;
    return {
      ...p,
      seq: i,
      eager,
      targetLongEdgePx: TRANSFORM.longEdgePx,
      targetQuality: TRANSFORM.quality,
    };
  });

  return { photos: planned, droppedOverCap: droppedOverCap.length, eagerBytes: spent };
}
