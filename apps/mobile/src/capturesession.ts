/**
 * R1 — the capture SESSION, expressed as arithmetic over facts.
 *
 * PURE. No imports, no database, no filesystem, no clock. Same reason as
 * `approverrouting.ts`: this file decides whether a half-finished walk is
 * recoverable and which files on disk are still owed to a human. It is the part
 * of R1 that can be wrong in a way nobody notices until the one morning someone
 * reopens the app expecting their walkthrough to still be there. Keeping it free
 * of imports is what makes `capturesession.test.ts` runnable at all (node --test
 * strips the types and needs nothing else to resolve).
 *
 * THE FAILURE THIS FILE EXISTS TO PREVENT, in one sentence: the PRD's
 * "given a paused session, when the app is killed or the phone dies, then the
 * partial session is recovered on next open as a draft — nothing recorded is
 * ever lost." Before this, the whole session lived in React state and nothing
 * touched disk until Done. A phone call that ended in a kill took the walk.
 *
 * Two decisions encoded here that are easy to get subtly wrong:
 *
 *  1. THE CAP COUNTS RECORDED AUDIO, NOT WALL CLOCK. The PRD says "session cap
 *     10 minutes of recorded audio". A session paused at 09:00 and resumed at
 *     14:00 has recorded five minutes, not five hours. Measuring wall clock
 *     would cut a man off mid-sentence because he took a lunch break, and
 *     "the app stopped recording and I don't know why" is indistinguishable
 *     from data loss to the person holding the phone.
 *
 *  2. EVERY RECOVERABLE DRAFT IS OFFERED, NOT JUST THE NEWEST. Crashing twice
 *     is not exotic — a phone that dies once on a cold morning dies twice. If
 *     recovery surfaced only the most recent draft, the older one would sit on
 *     disk forever, invisible, and eventually be swept. That is mandate #1
 *     failing quietly, which is the only way it ever fails.
 */

// ── the cap ────────────────────────────────────────────────────────────────────

/** PRD R1: "Session cap 10 minutes of recorded audio." */
export const SESSION_CAP_MS = 10 * 60 * 1000;

/**
 * Warn a minute out. Chosen so the warning is actionable — long enough to finish
 * the sentence you are in the middle of, short enough that it is not background
 * noise. REJECTED: warning at 50% (nobody acts on it, so it trains people to
 * ignore the banner) and not warning at all (the recorder stopping with no
 * notice reads as a crash).
 */
export const CAP_WARN_MS = 9 * 60 * 1000;

export type CapState = {
  /** Audio actually recorded so far, in ms. Never wall clock. */
  recordedMs: number;
  remainingMs: number;
  /** Show the "one minute left" banner. False once the cap is reached. */
  warn: boolean;
  /**
   * The recorder must stop. It must NOT discard: everything recorded up to here
   * is still a capture and still commits. The cap ends the recording, not the
   * session.
   */
  atCap: boolean;
};

export function capState(recordedMs: number): CapState {
  // A NaN or negative input is a bug upstream, but clamping beats propagating it
  // into `remainingMs` where it would silently disable the cap entirely.
  const r = Number.isFinite(recordedMs) && recordedMs > 0 ? Math.floor(recordedMs) : 0;
  const remainingMs = Math.max(0, SESSION_CAP_MS - r);
  return { recordedMs: r, remainingMs, warn: remainingMs > 0 && r >= CAP_WARN_MS, atCap: remainingMs === 0 };
}

/**
 * How long a NEW segment may run, given what is already banked. Returns 0 at the
 * cap, which callers must read as "do not arm the recorder" rather than
 * "unlimited" — the reason this is a function and not an inline subtraction.
 */
export function segmentBudgetMs(bankedMs: number): number {
  return capState(bankedMs).remainingMs;
}

// ── draft shape ────────────────────────────────────────────────────────────────

export type DraftItemKind = 'photo' | 'audio';
export type DraftState = 'open' | 'committed' | 'discarded';

export type DraftItem = {
  itemId: string;
  kind: DraftItemKind;
  /** Photo: shutter time. Audio: when the SEGMENT started. Ties media to narration. */
  atMs: number;
  /** Monotonic within the draft. Survives two items sharing a millisecond. */
  seq: number;
  /** Relative to the app document directory, so a reinstall's new sandbox path cannot break it. */
  relpath: string;
  mime: string;
  /** Audio only; 0 for a photo. This — not wall clock — is what the cap counts. */
  durationMs: number;
  fromLibrary: boolean;
};

export type DraftHeader = {
  draftId: string;
  startedAtMs: number;
  updatedAtMs: number;
  state: DraftState;
};

export type DraftSummary = {
  draftId: string;
  startedAtMs: number;
  updatedAtMs: number;
  photos: number;
  audioSegments: number;
  recordedMs: number;
  /**
   * There is something a human would be upset to lose. An empty draft (opened the
   * camera, said nothing, killed the app) is NOT recoverable and must not be
   * offered — a recovery prompt for nothing teaches people to dismiss recovery
   * prompts, and the next one will be real.
   */
  recoverable: boolean;
};

/**
 * Total order: capture time, then sequence, then id. All three are needed —
 * `atMs` alone collides when a photo is snapped in the same millisecond a
 * segment rolls, and SQLite's row order is not an order we may rely on. An
 * unstable order here reorders the narration segments, which reorders the
 * sentences a signer later reads back (mandate #5).
 */
export function orderedItems(items: DraftItem[]): DraftItem[] {
  return [...items].sort(
    (a, b) => a.atMs - b.atMs || a.seq - b.seq || a.itemId.localeCompare(b.itemId)
  );
}

export function summarizeDraft(header: DraftHeader, items: DraftItem[]): DraftSummary {
  let photos = 0, audioSegments = 0, recordedMs = 0;
  for (const it of items) {
    if (it.kind === 'photo') { photos++; continue; }
    audioSegments++;
    // Summed from the segments themselves. Deriving it from
    // updatedAtMs - startedAtMs would count the pause, the phone call and the
    // overnight kill as recorded audio — see decision 1 in the header.
    recordedMs += it.durationMs > 0 ? it.durationMs : 0;
  }
  return {
    draftId: header.draftId,
    startedAtMs: header.startedAtMs,
    updatedAtMs: header.updatedAtMs,
    photos, audioSegments, recordedMs,
    recoverable: photos + audioSegments > 0,
  };
}

/**
 * What to put in front of the user on next open. Newest first, ALL of them.
 * See decision 2 in the header for why this is not `draftToOffer` returning one.
 *
 * A committed draft is already in `capture_commit` (the commitment authority) and
 * offering it again would double-file the same walk. A discarded one was thrown
 * away by a human, and re-offering it overrides a decision they already made.
 */
export function draftsToOffer(
  headers: DraftHeader[],
  itemsByDraft: Record<string, DraftItem[]>
): DraftSummary[] {
  return headers
    .filter((h) => h.state === 'open')
    .map((h) => summarizeDraft(h, itemsByDraft[h.draftId] ?? []))
    .filter((s) => s.recoverable)
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.draftId.localeCompare(b.draftId));
}

// ── on-disk naming ─────────────────────────────────────────────────────────────

/**
 * Draft media lives in its OWN directory, deliberately not `capture-tmp/`.
 *
 * `recoverySweep()` in capture.ts empties `capture-tmp/` on every launch —
 * "temp file, no commitment -> delete" — which is correct for that directory and
 * fatal for this one. The alternative considered and REJECTED was teaching the
 * sweep a whitelist of draft paths: that couples the durability sweep, the single
 * most safety-critical loop in the app, to a subsystem it does not own, and one
 * bad join there deletes committed evidence. A separate directory with its own
 * lifecycle owner cannot regress the sweep at all.
 */
export const DRAFT_MEDIA_ROOT = 'capture-draft/';

/** Ids we generate ourselves. The check is a guard against ever building a path
 *  from something we did not, because these strings reach a recursive delete. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export function isSafeId(s: string): boolean { return SAFE_ID.test(s); }

export type DraftFileName = { seq: number; kind: DraftItemKind; atMs: number; ext: string };

/**
 * The filename CARRIES the metadata (sequence, kind, capture time) rather than
 * depending on the row that indexes it.
 *
 * That is the whole trick behind crash-safe banking: the bytes are copied to
 * disk first and the row inserted second, so a kill in between leaves a file
 * with no row. Because the name is self-describing, the next launch can ADOPT
 * that file — reconstruct its row — instead of seeing an unindexed orphan and
 * deleting it. Inserting the row first would trade a lost photo for a row
 * pointing at nothing, which is a lie in the opposite direction.
 *
 * Sequence is zero-padded so lexical order equals capture order; directory
 * listing order is not guaranteed by the OS and sorting by name is the only
 * deterministic fallback adoption has.
 */
export function draftFilename(f: DraftFileName): string {
  const seq = String(Math.max(0, Math.floor(f.seq))).padStart(4, '0');
  return `${seq}-${f.kind}-${Math.floor(f.atMs)}.${f.ext}`;
}

const FILE_RE = /^(\d{4,})-(photo|audio)-(\d+)\.([A-Za-z0-9]{1,8})$/;

export function parseDraftFilename(name: string): DraftFileName | null {
  const m = FILE_RE.exec(name);
  if (!m) return null;
  return { seq: Number(m[1]), kind: m[2] as DraftItemKind, atMs: Number(m[3]), ext: m[4] };
}

/** Throws rather than returns null: a bad id here means a path we are about to
 *  delete or write, and a silent null would be handled by someone as "skip". */
export function draftRelpath(draftId: string, f: DraftFileName): string {
  if (!isSafeId(draftId)) throw new Error(`unsafe draft id: ${draftId}`);
  return `${DRAFT_MEDIA_ROOT}${draftId}/${draftFilename(f)}`;
}

export type AdoptionPlan = {
  /** Files on disk with no row. Rows must be reconstructed; NEVER deleted. */
  adopt: Array<{ relpath: string; parsed: DraftFileName }>;
  /**
   * Files whose names we cannot attribute. Left alone and reported, not deleted:
   * we do not know what they are, and mandate #1's cost of being wrong is
   * asymmetric — a stray kilobyte costs nothing, a deleted photo costs the job.
   */
  unknown: string[];
};

export function planAdoption(
  draftId: string, filenames: string[], indexedRelpaths: string[]
): AdoptionPlan {
  const indexed = new Set(indexedRelpaths);
  const plan: AdoptionPlan = { adopt: [], unknown: [] };
  for (const name of [...filenames].sort()) {
    const parsed = parseDraftFilename(name);
    if (!parsed) { plan.unknown.push(name); continue; }
    const relpath = `${DRAFT_MEDIA_ROOT}${draftId}/${name}`;
    if (!indexed.has(relpath)) plan.adopt.push({ relpath, parsed });
  }
  return plan;
}

/** Next sequence number for a draft. Max+1, not count+1: adoption can leave gaps
 *  and count+1 would then reuse a number and collide on the UNIQUE relpath. */
export function nextSeq(items: DraftItem[]): number {
  let max = -1;
  for (const it of items) if (it.seq > max) max = it.seq;
  return max + 1;
}
