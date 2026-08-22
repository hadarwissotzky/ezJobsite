/**
 * R1 — the capture session, made durable while it is still happening.
 *
 * THE BUG THIS FILE CLOSES. Until now the entire session lived in React state
 * inside `FusedCapture`: photos in a `shots` array, audio in the recorder's own
 * temp file, and nothing at all touched SQLite until `finish()`. A phone call
 * that ended in the OS reclaiming the app, a battery that died on a cold
 * morning, or an iOS memory kill while the contractor was three rooms away took
 * the whole walk with it. The PRD's acceptance criterion — "given a paused
 * session, when the app is killed or the phone dies, then the partial session is
 * recovered on next open as a draft, nothing recorded is ever lost" — could not
 * be met by any amount of care inside the component, because the bytes were
 * never anywhere a relaunch could find them.
 *
 * THE SHAPE OF THE FIX: every photo is copied to durable storage within a second
 * of the shutter, and every audio segment is banked the moment the recorder
 * stops for any reason (pause, phone call, backgrounding, the 10-minute cap).
 * The draft is an index of those files. `finish()` then reads back from the
 * draft rather than from memory, so the committed capture and the recovered
 * capture are the same code path — a recovery path only executed after a crash
 * is a recovery path nobody has tested.
 *
 * SPLIT, deliberately: all the arithmetic and all the naming live in the pure
 * `capturesession.ts` so they can be unit-tested with `node --test`. This file
 * is only the PowerSync + filesystem half. Same division as
 * `approverrouting.ts` / `approvers.ts`.
 *
 * LOCAL-ONLY, AND NO SERVER MIGRATION. A draft is not a commitment. It is an
 * unreviewed, unpriced, unconfirmed pile of bytes that a human has not yet said
 * anything about, and mandate #2 is precisely that nothing carrying a
 * commitment moves without explicit human confirmation. Syncing drafts would
 * put half-sentences on a server, in an account someone else can read, for
 * captures the contractor may be about to discard. Nothing here is declared in
 * AppSchema and nothing here has a `sql/` migration; the bytes reach the server
 * only through `performCapture`, after the human taps Done.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { sha256 } from 'js-sha256';

import type { Stamp, StampStatus } from './stamp';
import {
  DRAFT_MEDIA_ROOT, draftRelpath, isSafeId, planAdoption,
  draftsToOffer, orderedItems, summarizeDraft,
  type DraftHeader, type DraftItem, type DraftItemKind, type DraftState, type DraftSummary,
} from './capturesession';

// ---------------------------------------------------------------- schema

export const DRAFT_DDL = [
  `CREATE TABLE IF NOT EXISTS capture_draft (
      draft_id       TEXT NOT NULL PRIMARY KEY,
      owner_id       TEXT NOT NULL,
      started_at_ms  INTEGER NOT NULL CHECK (started_at_ms > 0),
      updated_at_ms  INTEGER NOT NULL,
      state          TEXT NOT NULL CHECK (state IN ('open','committed','discarded')),
      -- The stamp, frozen at session start. PRD R1: "location is read once at
      -- capture ... no background tracking of the contractor, ever." Re-reading
      -- it on resume would turn a recovered draft into a second location fix,
      -- which is exactly the tracking that line forbids.
      -- Nullable for the reason capture_commit's are: no fix is an honest answer
      -- and stamp_status records why. Never 0,0.
      gps_lat        REAL,
      gps_lng        REAL,
      gps_accuracy_m REAL,
      gps_fix_age_ms INTEGER,
      stamp_status   TEXT,
      -- What the draft held when it closed. The rows go, this stays, so
      -- "I discarded a two-minute walk" remains answerable afterwards.
      closed_items   INTEGER,
      closed_recorded_ms INTEGER
   ) STRICT`,

  `CREATE TABLE IF NOT EXISTS capture_draft_item (
      item_id      TEXT NOT NULL PRIMARY KEY,
      draft_id     TEXT NOT NULL,
      kind         TEXT NOT NULL CHECK (kind IN ('photo','audio')),
      -- Photo: the shutter. Audio: when the SEGMENT started. This is what ties a
      -- photo to the sentence being spoken over it, so it is the item's own time
      -- and never the session's.
      at_ms        INTEGER NOT NULL CHECK (at_ms > 0),
      seq          INTEGER NOT NULL CHECK (seq >= 0),
      -- Relative to the document directory. iOS hands an app a NEW absolute
      -- sandbox path after some updates; an absolute path stored here would
      -- point at nothing on the very launch recovery exists for.
      relpath      TEXT NOT NULL UNIQUE,
      mime         TEXT NOT NULL CHECK (length(mime) > 0),
      bytes        INTEGER NOT NULL CHECK (bytes > 0),
      -- Audio only. THIS is what the 10-minute cap counts; wall clock is not.
      duration_ms  INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
      from_library INTEGER NOT NULL DEFAULT 0 CHECK (from_library IN (0,1)),
      banked_at_ms INTEGER NOT NULL,
      UNIQUE (draft_id, seq)
   ) STRICT`,

  `CREATE INDEX IF NOT EXISTS capture_draft_item_by_draft
     ON capture_draft_item (draft_id, seq)`,

  // UPDATE is forbidden: a banked item's bytes, time and duration are facts about
  // something that already happened, and nothing later may revise them. Mandate #1
  // in the small.
  //
  // DELETE is NOT forbidden, and that is a considered difference from
  // capture_commit. The only two delete paths are a human tapping Discard, and
  // cleanup after the bytes are already in capture_commit — the commitment
  // authority. Mandate #1 protects against LOSING a capture, not against a person
  // deciding to throw one away; a trigger here would make Discard impossible and
  // leave the phone filling with abandoned walks nobody can clear.
  `CREATE TRIGGER IF NOT EXISTS capture_draft_item_no_update
     BEFORE UPDATE ON capture_draft_item
     BEGIN SELECT RAISE(ABORT, 'capture_draft_item is append-only'); END`,
];

export async function ensureDraftSchema(db: AbstractPowerSyncDatabase): Promise<void> {
  for (const s of DRAFT_DDL) await db.execute(s);
}

// ---------------------------------------------------------------- helpers

const ROOT = FS.documentDirectory + DRAFT_MEDIA_ROOT;
const dirFor = (draftId: string) => `${ROOT}${draftId}/`;
const absFor = (relpath: string) => FS.documentDirectory + relpath;

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * One banking operation per draft at a time.
 *
 * Sequence numbers are allocated by reading MAX(seq)+1 and then used to build a
 * filename BEFORE the row exists — the copy has to happen first so that a kill
 * between the two leaves an adoptable file rather than a row pointing at
 * nothing. That read-then-use window is where two concurrent banks would collide
 * on the same seq, and they genuinely can: the camera's shutter callback and the
 * segment roll after a phone call are independent async chains. Serialising
 * per draft closes it without a transaction that would have to span a file copy.
 */
const laneByDraft = new Map<string, Promise<unknown>>();
function lane<T>(draftId: string, work: () => Promise<T>): Promise<T> {
  const prev = laneByDraft.get(draftId) ?? Promise.resolve();
  const next = prev.then(work, work);
  laneByDraft.set(draftId, next.catch(() => undefined));
  return next;
}

function extFor(mime: string, kind: DraftItemKind): string {
  const m = (mime || '').toLowerCase();
  if (m === 'image/png') return 'png';
  if (m === 'image/heic') return 'heic';
  if (m.startsWith('image/')) return 'jpg';
  if (m === 'audio/wav' || m === 'audio/x-wav') return 'wav';
  if (m.startsWith('audio/')) return 'm4a';
  return kind === 'photo' ? 'jpg' : 'm4a';
}

function rowToItem(r: any): DraftItem {
  return {
    itemId: r.item_id, kind: r.kind as DraftItemKind, atMs: r.at_ms, seq: r.seq,
    relpath: r.relpath, mime: r.mime, durationMs: r.duration_ms,
    fromLibrary: r.from_library === 1,
  };
}

// ---------------------------------------------------------------- the session

/**
 * Start a session. Called the moment `FusedCapture` mounts and arms the mic,
 * NOT on the first photo: an empty draft costs one row and makes every later
 * bank a plain insert, whereas creating it lazily puts a "does the draft exist
 * yet" branch in the shutter path, which is the one path that must never fail.
 * `sweepDrafts` clears drafts that stayed empty.
 */
export async function openDraft(
  db: AbstractPowerSyncDatabase, o: { ownerId: string; stamp: Stamp | null }
): Promise<string> {
  const draftId = newId('d');
  const now = Date.now();
  const s = o.stamp;
  await db.execute(
    `INSERT INTO capture_draft
       (draft_id, owner_id, started_at_ms, updated_at_ms, state,
        gps_lat, gps_lng, gps_accuracy_m, gps_fix_age_ms, stamp_status)
     VALUES (?,?,?,?, 'open', ?,?,?,?,?)`,
    [draftId, o.ownerId, s?.capturedAtMs ?? now, now,
     s?.lat ?? null, s?.lng ?? null, s?.accuracyM ?? null, s?.fixAgeMs ?? null,
     s?.status ?? null]
  );
  await FS.makeDirectoryAsync(dirFor(draftId), { intermediates: true }).catch(() => { /* exists */ });
  return draftId;
}

/**
 * Fill in the stamp for a draft opened before the fix arrived.
 *
 * The draft opens the instant the screen mounts, because a photo snapped in the
 * first two seconds must already have somewhere durable to go — but `stampNow()`
 * races the satellites for up to three. So the header can start stampless and be
 * completed once.
 *
 * ONCE, and only from empty: the WHERE clause refuses to overwrite a status that
 * is already recorded. A second write would let a later, different fix replace
 * the capture's own location, which is both the background tracking PRD R1
 * forbids and a stamp describing somewhere the photo was not taken.
 */
export async function setDraftStamp(
  db: AbstractPowerSyncDatabase, draftId: string, s: Stamp
): Promise<void> {
  await db.execute(
    `UPDATE capture_draft
        SET gps_lat = ?, gps_lng = ?, gps_accuracy_m = ?, gps_fix_age_ms = ?,
            stamp_status = ?, started_at_ms = ?, updated_at_ms = ?
      WHERE draft_id = ? AND stamp_status IS NULL`,
    [s.lat, s.lng, s.accuracyM, s.fixAgeMs, s.status, s.capturedAtMs, Date.now(), draftId]
  );
}

export type BankResult =
  | { ok: true; item: DraftItem }
  /**
   * The bank failed. NOT swallowed: the caller keeps the in-memory copy and must
   * tell the user this one is not yet safe. A silent failure here reproduces the
   * exact lie the whole capture path exists to avoid — "saved" for something we
   * are about to lose.
   */
  | { ok: false; reason: string };

async function bank(
  db: AbstractPowerSyncDatabase,
  draftId: string,
  o: { srcUri: string; kind: DraftItemKind; atMs: number; mime: string;
       durationMs: number; fromLibrary: boolean }
): Promise<BankResult> {
  if (!isSafeId(draftId)) return { ok: false, reason: `unsafe draft id: ${draftId}` };
  return lane(draftId, async () => {
    try {
      const seqRow = (await db.getAll<{ next: number }>(
        `SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM capture_draft_item WHERE draft_id = ?`,
        [draftId]))[0];
      const seq = seqRow?.next ?? 0;
      const ext = extFor(o.mime, o.kind);
      const relpath = draftRelpath(draftId, { seq, kind: o.kind, atMs: o.atMs, ext });
      const dest = absFor(relpath);

      await FS.makeDirectoryAsync(dirFor(draftId), { intermediates: true }).catch(() => { /* exists */ });
      // COPY, never move. The source is the camera's or recorder's own file and
      // something else may still hold it; moving it out from under expo-camera
      // has produced "file not found" on the very next shutter press.
      await FS.copyAsync({ from: o.srcUri, to: dest });

      // Read back before claiming the bytes are safe. A copy that silently
      // produced an empty file is the failure mode that makes a draft look
      // recoverable and play back as silence.
      const info: any = await FS.getInfoAsync(dest);
      const bytes = Number(info?.size ?? 0);
      if (!info?.exists || bytes <= 0) {
        await FS.deleteAsync(dest, { idempotent: true }).catch(() => { /* noop */ });
        return { ok: false, reason: 'copy produced no bytes' };
      }

      const itemId = newId('i');
      const now = Date.now();
      await db.execute(
        `INSERT INTO capture_draft_item
           (item_id, draft_id, kind, at_ms, seq, relpath, mime, bytes,
            duration_ms, from_library, banked_at_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [itemId, draftId, o.kind, o.atMs, seq, relpath, o.mime, bytes,
         Math.max(0, Math.round(o.durationMs)), o.fromLibrary ? 1 : 0, now]
      );
      await db.execute(`UPDATE capture_draft SET updated_at_ms = ? WHERE draft_id = ?`, [now, draftId]);

      return { ok: true, item: { itemId, kind: o.kind, atMs: o.atMs, seq, relpath,
                                 mime: o.mime, durationMs: o.durationMs, fromLibrary: o.fromLibrary } };
    } catch (e: any) {
      return { ok: false, reason: e?.message ?? String(e) };
    }
  });
}

/** Bank a photo. Call from the shutter callback — durability within a second of the tap. */
export function bankPhoto(
  db: AbstractPowerSyncDatabase, draftId: string,
  o: { srcUri: string; atMs: number; mime?: string; fromLibrary?: boolean }
): Promise<BankResult> {
  return bank(db, draftId, {
    srcUri: o.srcUri, kind: 'photo', atMs: o.atMs, mime: o.mime ?? 'image/jpeg',
    durationMs: 0, fromLibrary: o.fromLibrary ?? false,
  });
}

/**
 * Bank an audio segment. Call after EVERY recorder stop — pause, phone call,
 * backgrounding, the cap.
 *
 * This is why Pause now ends a segment instead of holding the file open. A
 * paused `expo-audio` recording is an open, incomplete file on disk: there is
 * nothing readable to recover, so "paused" and "killed while paused" would still
 * lose the walk. Stopping and rolling a fresh segment on Resume costs one extra
 * file per pause and is the only version of Pause that survives a kill. The app
 * already commits multi-segment narrations in order, so nothing downstream
 * changes.
 */
export function bankAudioSegment(
  db: AbstractPowerSyncDatabase, draftId: string,
  o: { srcUri: string; startedAtMs: number; durationMs: number; mime?: string }
): Promise<BankResult> {
  return bank(db, draftId, {
    srcUri: o.srcUri, kind: 'audio', atMs: o.startedAtMs, mime: o.mime ?? 'audio/m4a',
    durationMs: o.durationMs, fromLibrary: false,
  });
}

// ---------------------------------------------------------------- reading back

export async function draftItems(db: AbstractPowerSyncDatabase, draftId: string): Promise<DraftItem[]> {
  const rows = await db.getAll<any>(
    `SELECT item_id, draft_id, kind, at_ms, seq, relpath, mime, duration_ms, from_library
       FROM capture_draft_item WHERE draft_id = ?`, [draftId]);
  return orderedItems(rows.map(rowToItem));
}

async function headers(db: AbstractPowerSyncDatabase, ownerId?: string): Promise<DraftHeader[]> {
  const rows = await db.getAll<any>(
    `SELECT draft_id, started_at_ms, updated_at_ms, state FROM capture_draft
      WHERE (? IS NULL OR owner_id = ?)`, [ownerId ?? null, ownerId ?? null]);
  return rows.map((r) => ({
    draftId: r.draft_id, startedAtMs: r.started_at_ms,
    updatedAtMs: r.updated_at_ms, state: r.state as DraftState,
  }));
}

/**
 * What to put in front of the user on next open — the acceptance criterion this
 * whole file exists for. Newest first, all of them.
 */
export async function recoverableDrafts(
  db: AbstractPowerSyncDatabase, ownerId?: string
): Promise<DraftSummary[]> {
  const hs = await headers(db, ownerId);
  const byDraft: Record<string, DraftItem[]> = {};
  for (const h of hs) if (h.state === 'open') byDraft[h.draftId] = await draftItems(db, h.draftId);
  return draftsToOffer(hs, byDraft);
}

export type DraftArtifacts = {
  photos: Array<{ bytes: Uint8Array; mime: string; atMs: number; fromLibrary: boolean }>;
  audioSegments: Array<{ bytes: Uint8Array; mime: string; startedAtMs: number }>;
  stamp: Stamp;
  previewUris: string[];
  durationSecs: number;
  /**
   * Items whose file has gone. Reported, never hidden: an item we indexed and
   * cannot read is a real loss and the one moment the user needs to know is
   * before they rely on the record.
   */
  missing: string[];
};

/**
 * Read a draft back into the exact shape `onFusedCapture` already takes, so the
 * commit path is identical whether the session just ended or was recovered from
 * a crash three days ago. A recovery path that only runs after a crash is a
 * recovery path nobody has tested.
 */
export async function readDraftArtifacts(
  db: AbstractPowerSyncDatabase, draftId: string
): Promise<DraftArtifacts> {
  const h = (await db.getAll<any>(
    `SELECT started_at_ms, gps_lat, gps_lng, gps_accuracy_m, gps_fix_age_ms, stamp_status
       FROM capture_draft WHERE draft_id = ?`, [draftId]))[0];
  const items = await draftItems(db, draftId);

  const out: DraftArtifacts = {
    photos: [], audioSegments: [], previewUris: [], missing: [],
    durationSecs: 0,
    stamp: {
      capturedAtMs: h?.started_at_ms ?? Date.now(),
      lat: h?.gps_lat ?? null, lng: h?.gps_lng ?? null,
      accuracyM: h?.gps_accuracy_m ?? null, fixAgeMs: h?.gps_fix_age_ms ?? null,
      status: (h?.stamp_status as StampStatus) ?? 'unavailable',
    },
  };

  let recordedMs = 0;
  for (const it of items) {
    const uri = absFor(it.relpath);
    let bytes: Uint8Array;
    try {
      const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
      bytes = new Uint8Array(Buffer.from(b64, 'base64'));
      if (!bytes.length) throw new Error('empty');
    } catch {
      out.missing.push(it.relpath);
      continue;
    }
    if (it.kind === 'photo') {
      out.photos.push({ bytes, mime: it.mime, atMs: it.atMs, fromLibrary: it.fromLibrary });
      out.previewUris.push(uri);
    } else {
      out.audioSegments.push({ bytes, mime: it.mime, startedAtMs: it.atMs });
      recordedMs += it.durationMs;
    }
  }
  out.durationSecs = Math.round(recordedMs / 1000);
  return out;
}

/**
 * HAS THIS DRAFT ALREADY BEEN COMMITTED?
 *
 * hadar, 2026-08-21: the app opened saying a change order had not finished before
 * it closed, he tapped Keep, and ended up with TWO change orders numbered #1.
 *
 * THE WINDOW IS REAL AND NARROW. `onFusedCapture` commits every capture and creates
 * the extra, and only then does `commit()` mark the draft closed. Kill the app in
 * between — which is exactly what "didn't complete before the app closed" describes —
 * and the draft stays `open` with its media intact while its captures are already
 * committed. Recovery then re-commits the same bytes as NEW captures and mints a
 * SECOND extra from one walk.
 *
 * It was unreachable until today only because the recovery prompt itself never fired
 * (it asked for drafts belonging to 'owner-local'). Fixing that exposed this.
 *
 * THE DIGEST IS THE ANSWER, and it is already there: `capture_commit.media_sha256` is
 * the hash of the very bytes this draft holds, written by `performCapture` from the
 * same buffer. Same bytes, same hash — so "have these already been committed" is a
 * lookup, not a guess. No timestamps, no filename matching, no heuristics.
 *
 * Returns the ids of items already committed. A PARTIAL match matters as much as a
 * full one: a crash mid-loop can leave two of three photos committed, and re-running
 * the whole draft would duplicate those two.
 */
export async function alreadyCommittedItems(
  db: AbstractPowerSyncDatabase, draftId: string
): Promise<{ committed: string[]; total: number }> {
  const items = await draftItems(db, draftId);
  const committed: string[] = [];
  for (const it of items) {
    try {
      const b64 = await FS.readAsStringAsync(absFor(it.relpath), { encoding: FS.EncodingType.Base64 });
      const hex = sha256(new Uint8Array(Buffer.from(b64, 'base64')));
      const hit = (await db.getAll<{ n: number }>(
        `SELECT COUNT(*) AS n FROM capture_commit WHERE media_sha256 = ?`, [hex]))[0]?.n ?? 0;
      if (hit > 0) committed.push(it.itemId);
    } catch {
      // Unreadable bytes cannot be matched. Treated as NOT committed, which errs
      // toward offering the recovery — mandate #1's direction: a duplicate is
      // recoverable, a walk nobody was offered is not.
    }
  }
  return { committed, total: items.length };
}

/**
 * CLOSE THE DRAFTS WHOSE WALK ALREADY LANDED, BEFORE ANY OF THEM ARE OFFERED.
 *
 * hadar, 2026-08-21, screenshot: "UNFINISHED CAPTURE — the app closed before this walk
 * was filed" over 4 photos he had already turned into a change order AND then deleted.
 *
 * `alreadyCommittedItems` was wired into the Keep BUTTON, so the duplicate could not be
 * created — but the card was still SHOWN. That is only half a fix: the prompt exists to
 * say "here is work you would otherwise lose", and showing it over work that is not
 * lost teaches exactly the dismissal reflex `DraftSummary.recoverable` is written to
 * avoid ("a recovery prompt for nothing teaches people to dismiss recovery prompts, and
 * the next one will be real").
 *
 * Deleting the extra afterwards does not change the answer, and must not: `capture_commit`
 * is append-only, so the bytes remain committed and a discard is recorded beside them.
 * The draft's walk DID land. What happened to the document afterwards is a separate
 * decision the contractor already made, and re-offering the raw walk is the app asking
 * him to make it twice.
 *
 * Run before `recoverableDrafts`, so the list it returns is already true.
 */
export async function closeLandedDrafts(
  db: AbstractPowerSyncDatabase, ownerId?: string
): Promise<{ closed: number; byDigest: number; byWindow: number }> {
  let closed = 0, byDigest = 0, byWindow = 0;
  for (const h of await headers(db, ownerId)) {
    if (h.state !== 'open') continue;
    const items = await draftItems(db, h.draftId).catch(() => []);
    if (!items.length) continue;   // empty drafts are handled elsewhere

    // ── 1. THE EXACT ANSWER: every item's bytes are already committed. ──────────
    try {
      const seen = await alreadyCommittedItems(db, h.draftId);
      if (seen.total > 0 && seen.committed.length === seen.total) {
        await closeDraft(db, h.draftId, 'committed');
        closed++; byDigest++;
        continue;
      }
    } catch { /* fall through to the window check */ }

    /**
     * ── 2. THE ANSWER THAT SURVIVES WHEN THE BYTES CANNOT BE COMPARED ──────────
     *
     * The digest check needs to READ each draft file and hash it, and it fails
     * silently in two real situations: the committed copy is not byte-identical to
     * the draft copy, and the draft's media is gone from disk. hadar hit one of them
     * on 2026-08-21 — the server showed all five captures of that walk committed and
     * uploaded, and the card still said "unfinished".
     *
     * So: did this device commit at least as many captures during the draft's own
     * window as the draft is holding? A draft that banked four photos between 23:36
     * and 23:38, on a device that committed five captures in that window, has landed.
     *
     * THIS IS INFERENCE AND IT IS SAID SO OUT LOUD, which is why it is second and not
     * first. What it decides is narrow: whether to OFFER A RECOVERY PROMPT. It writes
     * no evidence, touches no capture, and its worst case is a walk that is genuinely
     * unfinished not being offered — recoverable by the contractor simply recording
     * again, and weighed against a prompt that cries wolf every launch until he learns
     * to dismiss it, which is the failure `DraftSummary.recoverable` names.
     *
     * The window is the draft's own, plus a minute: commits happen after the last
     * bank, and a slow write must not fall outside its own session.
     */
    try {
      const n = (await db.getAll<{ n: number }>(
        `SELECT COUNT(*) AS n FROM capture_commit
          WHERE captured_at_ms >= ? AND captured_at_ms <= ?`,
        [h.startedAtMs, h.updatedAtMs + 60_000]))[0]?.n ?? 0;
      if (n >= items.length) {
        await closeDraft(db, h.draftId, 'committed');
        closed++; byWindow++;
      }
    } catch { /* a draft we cannot read about stays open and stays offered */ }
  }
  return { closed, byDigest, byWindow };
}

/** Audio already banked, in ms. What `capState()` is fed; never wall clock. */
export async function bankedRecordedMs(db: AbstractPowerSyncDatabase, draftId: string): Promise<number> {
  const r = (await db.getAll<{ ms: number }>(
    `SELECT COALESCE(SUM(duration_ms), 0) AS ms FROM capture_draft_item
      WHERE draft_id = ? AND kind = 'audio'`, [draftId]))[0];
  return r?.ms ?? 0;
}

// ---------------------------------------------------------------- closing out

/**
 * Close a draft.
 *
 * ORDER IS LOAD-BEARING and it is the opposite of the banking order. Mark the
 * header FIRST, then delete the media, then the rows. A kill part-way leaves a
 * closed header with leftover files, which `sweepDrafts` finishes — whereas
 * deleting the media first and dying before the header was marked would leave an
 * OPEN draft pointing at files that no longer exist, and the user would be
 * offered a recovery that plays back as nothing.
 *
 * `committed` MUST only be passed once `performCapture` has returned ok for
 * every item. capture_commit is the commitment authority; deleting the draft
 * copy before it says so would be destroying the only copy on a promise.
 */
export async function closeDraft(
  db: AbstractPowerSyncDatabase, draftId: string, outcome: 'committed' | 'discarded'
): Promise<void> {
  if (!isSafeId(draftId)) throw new Error(`unsafe draft id: ${draftId}`);
  const items = await draftItems(db, draftId);
  const summary = summarizeDraft(
    { draftId, startedAtMs: 0, updatedAtMs: 0, state: 'open' }, items);

  await db.execute(
    `UPDATE capture_draft
        SET state = ?, updated_at_ms = ?, closed_items = ?, closed_recorded_ms = ?
      WHERE draft_id = ?`,
    [outcome, Date.now(), items.length, summary.recordedMs, draftId]
  );
  await FS.deleteAsync(dirFor(draftId), { idempotent: true }).catch(() => { /* already gone */ });
  await db.execute(`DELETE FROM capture_draft_item WHERE draft_id = ?`, [draftId]);
}

// ---------------------------------------------------------------- relaunch sweep

export type DraftSweep = {
  adoptedFiles: number;
  adoptedDrafts: number;
  emptyDraftsClosed: number;
  dirsCleaned: number;
  /** Files in a draft directory whose name we cannot attribute. Left in place. */
  unknown: string[];
};

/**
 * Run at launch, alongside `recoverySweep`. Deliberately a SEPARATE sweep over a
 * SEPARATE directory: `recoverySweep` empties `capture-tmp/` unconditionally
 * ("temp file, no commitment -> delete"), which is right for that directory and
 * would be fatal here. Teaching that loop a whitelist would couple the most
 * safety-critical code in the app to a subsystem it does not own; a second
 * directory with its own owner cannot regress it at all.
 *
 * Everything this does is in the direction of KEEPING bytes:
 *  - a file with no row is adopted, because banking copies before it inserts;
 *  - a directory with no draft at all is adopted as an open draft, because the
 *    filenames are self-describing and a session we cannot explain is still a
 *    session someone recorded;
 *  - only directories belonging to a CLOSED draft are deleted, and only after
 *    the header already says the bytes were committed or thrown away.
 */
export async function sweepDrafts(
  db: AbstractPowerSyncDatabase, ownerId: string
): Promise<DraftSweep> {
  const out: DraftSweep = { adoptedFiles: 0, adoptedDrafts: 0, emptyDraftsClosed: 0,
                            dirsCleaned: 0, unknown: [] };

  const hs = await headers(db);
  const byId = new Map(hs.map((h) => [h.draftId, h]));
  const dirs = await FS.readDirectoryAsync(ROOT).catch(() => [] as string[]);

  for (const dir of dirs) {
    if (!isSafeId(dir)) { out.unknown.push(dir); continue; }
    const header = byId.get(dir);

    if (header && header.state !== 'open') {
      // closeDraft was interrupted between marking and deleting. Finish it.
      await FS.deleteAsync(dirFor(dir), { idempotent: true }).catch(() => { /* noop */ });
      out.dirsCleaned++;
      continue;
    }

    const files = await FS.readDirectoryAsync(dirFor(dir)).catch(() => [] as string[]);
    if (!header) {
      if (!files.length) { await FS.deleteAsync(dirFor(dir), { idempotent: true }).catch(() => { /* noop */ }); continue; }
      // A directory of real files and no draft row. Give it a home rather than
      // delete it. The stamp is left null: we cannot invent a location for a
      // session we have no header for, and null is the honest answer.
      await db.execute(
        `INSERT INTO capture_draft (draft_id, owner_id, started_at_ms, updated_at_ms, state, stamp_status)
         VALUES (?,?,?,?, 'open', 'unavailable')`,
        [dir, ownerId, Date.now(), Date.now()]
      );
      out.adoptedDrafts++;
    }

    const indexed = (await draftItems(db, dir)).map((i) => i.relpath);
    const plan = planAdoption(dir, files, indexed);
    out.unknown.push(...plan.unknown.map((u) => `${dir}/${u}`));
    for (const a of plan.adopt) {
      const info: any = await FS.getInfoAsync(absFor(a.relpath));
      const bytes = Number(info?.size ?? 0);
      if (!info?.exists || bytes <= 0) continue;
      try {
        await db.execute(
          `INSERT INTO capture_draft_item
             (item_id, draft_id, kind, at_ms, seq, relpath, mime, bytes,
              duration_ms, from_library, banked_at_ms)
           VALUES (?,?,?,?,?,?,?,?,?,0,?)`,
          [newId('i'), dir, a.parsed.kind, a.parsed.atMs, a.parsed.seq, a.relpath,
           a.parsed.kind === 'photo' ? 'image/jpeg' : 'audio/m4a', bytes,
           // An adopted audio segment's duration is UNKNOWN — it was never
           // written down. 0 is recorded rather than a guess: it means the cap
           // under-counts a recovered session, which errs toward letting someone
           // keep recording, not toward cutting them off on invented numbers.
           0, Date.now()]
        );
        out.adoptedFiles++;
      } catch { /* UNIQUE(relpath) — already indexed by a concurrent bank */ }
    }
  }

  // An open draft that never held anything is noise, not a recovery. Closing it
  // as discarded (rather than deleting the row) keeps the sweep's own decisions
  // auditable.
  for (const h of hs) {
    if (h.state !== 'open') continue;
    const n = (await db.getAll<{ n: number }>(
      `SELECT count(*) AS n FROM capture_draft_item WHERE draft_id = ?`, [h.draftId]))[0]?.n ?? 0;
    if (n === 0 && Date.now() - h.updatedAtMs > 60_000) {
      await db.execute(
        `UPDATE capture_draft SET state = 'discarded', updated_at_ms = ?, closed_items = 0,
                closed_recorded_ms = 0 WHERE draft_id = ?`, [Date.now(), h.draftId]);
      out.emptyDraftsClosed++;
    }
  }
  return out;
}
