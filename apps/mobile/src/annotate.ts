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
  const id = `nt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    await db.execute(
      `INSERT INTO capture_note (id, capture_id, body, author, created_at_ms) VALUES (?,?,?,?,?)`,
      [id, o.captureId, body, o.author ?? null, Date.now()]
    );
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
