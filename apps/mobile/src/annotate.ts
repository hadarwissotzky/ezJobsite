/**
 * Notes on a capture — REQ-CAP3. And the read side of REQ-EVID1.
 *
 * REQ-CAP3: "Text can be added to ANY capture ... a text note can attach to a
 *            voice/photo/video capture and persists with it."
 * REQ-EVID1: "raw capture + stamp is retained and VIEWABLE without any handler
 *             applied ... standing on its own for inspectors/peers."
 *
 * WHY A SEPARATE TABLE AND NOT A COLUMN:
 * capture_commit is append-only and immutable -- mandate #1 says media is never
 * edited, and an approved record is never edited in place. A `note` column would
 * have to be UPDATE-able, which would either break that law or require special-
 * casing it. Worse, it would let a note written in March silently overwrite one
 * written in January with no trace.
 *
 * So notes are APPENDED, and every one of them survives. "He said grey" followed
 * by "actually the owner changed it to white" is the same shape as a decision's
 * version chain, for the same reason: what someone thought at the time is
 * evidence, and evidence is not tidied.
 *
 * THE NOTE IS NOT THE CAPTURE. A photo's bytes are what the camera saw and are
 * hashed; a note is what a person said ABOUT it, later, and is not. The bundle
 * shows them as different things, because conflating "what the camera recorded"
 * with "what someone typed afterwards" is how an evidence bundle stops being
 * evidence.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { SupabaseClient } from '@supabase/supabase-js';
import { sha256 } from 'js-sha256';

export const ANNOTATION_DDL = [
  `CREATE TABLE IF NOT EXISTS capture_note (
      id            TEXT NOT NULL PRIMARY KEY,
      capture_id    TEXT NOT NULL,
      body          TEXT NOT NULL CHECK (length(body) > 0),
      author        TEXT,
      created_at_ms INTEGER NOT NULL
   ) STRICT`,

  // Append-only, same law as everything else that records what a person believed.
  `CREATE TRIGGER IF NOT EXISTS capture_note_no_update
     BEFORE UPDATE ON capture_note
     BEGIN SELECT RAISE(ABORT, 'notes are append-only: add another'); END`,
  `CREATE TRIGGER IF NOT EXISTS capture_note_no_delete
     BEFORE DELETE ON capture_note
     BEGIN SELECT RAISE(ABORT, 'notes are never destroyed'); END`,

  // Transport intent, enqueued INSIDE the note's transaction. capture_note is
  // app-owned (it carries append-only triggers, which a PowerSync-managed view
  // cannot), so it needs an owned queue -- the same reason decisions do, and NOT
  // the reason projects do not.
  `CREATE TABLE IF NOT EXISTS note_outbox (
      mutation_id   TEXT NOT NULL PRIMARY KEY,
      note_id       TEXT NOT NULL,
      payload_json  TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      queued_at_ms  INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_text TEXT
   ) STRICT`,

  `CREATE INDEX IF NOT EXISTS capture_note_by_capture
     ON capture_note (capture_id, created_at_ms DESC)`,
];

export async function ensureAnnotationSchema(db: AbstractPowerSyncDatabase) {
  for (const s of ANNOTATION_DDL) await db.execute(s);
}

export type Note = { id: string; body: string; author: string | null; created_at_ms: number };

/** REQ-CAP3. Works on any modality: performCapture never cared what made the bytes. */
export async function addNote(
  db: AbstractPowerSyncDatabase,
  o: { captureId: string; body: string; author?: string }
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const body = o.body.trim();
  if (!body) return { ok: false, reason: 'empty note' };
  const now = Date.now();
  const id = `nt-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const mutationId = `nm-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const payload = { mutation_id: mutationId, id, capture_id: o.captureId, body,
                    author: o.author ?? null, created_at_ms: now };
  const payloadJson = JSON.stringify(payload);
  try {
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO capture_note (id, capture_id, body, author, created_at_ms) VALUES (?,?,?,?,?)`,
        [id, o.captureId, body, o.author ?? null, now]
      );
      // Atomic with the note. A crash between them would leave a note that exists
      // on one phone and will never reach the bundle -- and the bundle is the only
      // place a note ever has to earn its keep.
      await tx.execute(
        `INSERT INTO note_outbox (mutation_id, note_id, payload_json, payload_sha256, queued_at_ms)
         VALUES (?,?,?,?,?)`,
        [mutationId, id, payloadJson, sha256(payloadJson), now]
      );
    });
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
  return { ok: true, id };
}

export async function notesFor(db: AbstractPowerSyncDatabase, captureId: string): Promise<Note[]> {
  return db.getAll<Note>(
    `SELECT id, body, author, created_at_ms FROM capture_note
      WHERE capture_id = ? ORDER BY created_at_ms DESC`, [captureId]
  );
}

export async function noteCounts(db: AbstractPowerSyncDatabase): Promise<Record<string, number>> {
  const rows = await db.getAll<{ capture_id: string; n: number }>(
    `SELECT capture_id, count(*) AS n FROM capture_note GROUP BY capture_id`
  );
  return Object.fromEntries(rows.map((r) => [r.capture_id, r.n]));
}

/** Push notes. Same rules as every other owned queue here. */
export async function drainNoteOutbox(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, ownerId: string
) {
  const r = { attempted: 0, uploaded: 0, alreadyApplied: 0, retryable: 0 };
  const rows = await db.getAll<{ mutation_id: string; payload_json: string;
                                 payload_sha256: string; attempt_count: number }>(
    `SELECT mutation_id, payload_json, payload_sha256, attempt_count
       FROM note_outbox WHERE next_attempt_at_ms <= ? ORDER BY queued_at_ms LIMIT 20`,
    [Date.now()]
  );
  for (const row of rows) {
    r.attempted++;
    try {
      const p = JSON.parse(row.payload_json);
      const { data, error } = await supabase.rpc('ingest_note_v1', {
        p_mutation_id: p.mutation_id, p_id: p.id, p_capture_id: p.capture_id,
        p_owner_id: ownerId, p_body: p.body, p_author: p.author,
        p_created_at_ms: p.created_at_ms, p_request_sha256: row.payload_sha256,
      });
      if (error) throw error;
      await db.execute(`DELETE FROM note_outbox WHERE mutation_id = ?`, [row.mutation_id]);
      if (data?.status === 'already_applied') r.alreadyApplied++; else r.uploaded++;
    } catch (e: any) {
      const n = row.attempt_count + 1;
      await db.execute(
        `UPDATE note_outbox SET attempt_count = ?, next_attempt_at_ms = ?,
           last_error_code = ?, last_error_text = ? WHERE mutation_id = ?`,
        [n, Date.now() + Math.min(60_000 * 2 ** Math.min(n, 6), 30 * 60_000),
         e?.code ?? 'TRANSIENT', e?.message ?? String(e), row.mutation_id]
      );
      r.retryable++;
    }
  }
  return r;
}

/**
 * Play a capture back — the half of REQ-EVID1 I left undone.
 *
 * "raw capture + stamp is retained and VIEWABLE without any handler applied"
 *
 * For a voice capture, "viewable" means AUDIBLE. I shipped the viewer showing a
 * byte count and the words "playback isn't built yet", which for the product's
 * PRIMARY modality means the evidence screen could not show the evidence. An
 * inspector asking "what did he say?" got a hash.
 *
 * PLAYS FROM DISK, NOT FROM THE CLOUD. The file is already local (mandate #1 —
 * capture is local-first), so this works in a basement with no signal, which is
 * exactly where someone would be standing when they need to check what was said.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

let player: AudioPlayer | null = null;

export type Playback = { ok: true; durationSec: number } | { ok: false; reason: string };

export async function playCapture(uri: string): Promise<Playback> {
  try {
    // Play through the silent switch: this is the user asking "what did he say?",
    // not a notification. Same reasoning as the save confirmation.
    await setAudioModeAsync({ playsInSilentMode: true });
    stopPlayback();
    player = createAudioPlayer({ uri });
    player.play();
    // duration is 0 until the asset loads; the caller polls if it needs it.
    return { ok: true, durationSec: player.duration ?? 0 };
  } catch (e: any) {
    // A capture that will not play is a REAL failure and must be visible: it means
    // the evidence cannot be examined, which is the whole point of keeping it.
    return { ok: false, reason: e?.message ?? String(e) };
  }
}

export function stopPlayback() {
  try { player?.remove(); } catch { /* already gone */ }
  player = null;
}

export function playbackState(): { playing: boolean; positionSec: number; durationSec: number } {
  return {
    playing: !!player?.playing,
    positionSec: player?.currentTime ?? 0,
    durationSec: player?.duration ?? 0,
  };
}
