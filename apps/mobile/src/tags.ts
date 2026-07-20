/**
 * User tags on captures — REQ-GAL3 (PRD-companycam-parity §5.C).
 *
 * DISTINCT from the AI-tags-on-decisions of REQ-VAL5: those are model-proposed
 * search tags on a Decision; these are free-form tags a HUMAN puts on a capture to
 * organize the grid ("before", "roof", "unit 3B"). CompanyCam's tags/labels.
 *
 * APPEND-ONLY, RETRACT IS AN EVENT — NOT A DELETE (mandate #1, PRD §5.C).
 * A tag lives on immutable media, so the same law as capture_note applies: we never
 * UPDATE or DELETE. Adding a tag appends an `add` row; removing it appends a
 * `retract` row. The CURRENT tags of a capture are those whose latest event is
 * `add`. Both survive as history — "it was tagged 'approved' then untagged" is
 * itself evidence, and evidence is not tidied. (This is why tags ride the owned
 * outbox, like notes/decisions, not PowerSync — the append-only triggers a
 * PowerSync-managed view cannot carry. Split signed off 2026-07-17, CLAUDE §5.)
 *
 * Erasure carve-out (mandate #5) applies underneath: a lawful erasure hard-deletes
 * the personal content and keeps a hash/metadata stub — that is the ONE exception
 * to "never destroyed", handled by the erasure path, not by tag retraction.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { SupabaseClient } from '@supabase/supabase-js';
import { sha256 } from 'js-sha256';

export const TAG_DDL = [
  `CREATE TABLE IF NOT EXISTS capture_tag (
      id            TEXT NOT NULL PRIMARY KEY,
      capture_id    TEXT NOT NULL,
      tag           TEXT NOT NULL CHECK (length(tag) > 0),
      action        TEXT NOT NULL CHECK (action IN ('add','retract')),
      author        TEXT,
      created_at_ms INTEGER NOT NULL
   ) STRICT`,

  // Same append-only law as capture_note.
  `CREATE TRIGGER IF NOT EXISTS capture_tag_no_update
     BEFORE UPDATE ON capture_tag
     BEGIN SELECT RAISE(ABORT, 'tags are append-only: add or retract, never edit'); END`,
  `CREATE TRIGGER IF NOT EXISTS capture_tag_no_delete
     BEFORE DELETE ON capture_tag
     BEGIN SELECT RAISE(ABORT, 'tag events are never destroyed (retract is an event)'); END`,

  `CREATE TABLE IF NOT EXISTS tag_outbox (
      mutation_id   TEXT NOT NULL PRIMARY KEY,
      tag_id        TEXT NOT NULL,
      payload_json  TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      queued_at_ms  INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_text TEXT
   ) STRICT`,

  `CREATE INDEX IF NOT EXISTS capture_tag_by_capture
     ON capture_tag (capture_id, tag, created_at_ms DESC)`,
];

export async function ensureTagSchema(db: AbstractPowerSyncDatabase) {
  for (const s of TAG_DDL) await db.execute(s);
}

/** Normalize so "Roof", "roof " and "ROOF" are one tag. */
function norm(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function writeEvent(
  db: AbstractPowerSyncDatabase,
  o: { captureId: string; tag: string; action: 'add' | 'retract'; author?: string }
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const tag = norm(o.tag);
  if (!tag) return { ok: false, reason: 'empty tag' };
  const now = Date.now();
  const id = `tg-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const mutationId = `tm-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const payload = { mutation_id: mutationId, id, capture_id: o.captureId, tag,
                    action: o.action, author: o.author ?? null, created_at_ms: now };
  const payloadJson = JSON.stringify(payload);
  try {
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO capture_tag (id, capture_id, tag, action, author, created_at_ms)
         VALUES (?,?,?,?,?,?)`,
        [id, o.captureId, tag, o.action, o.author ?? null, now]
      );
      await tx.execute(
        `INSERT INTO tag_outbox (mutation_id, tag_id, payload_json, payload_sha256, queued_at_ms)
         VALUES (?,?,?,?,?)`,
        [mutationId, id, payloadJson, sha256(payloadJson), now]
      );
    });
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
  return { ok: true, id };
}

export async function addTag(
  db: AbstractPowerSyncDatabase, o: { captureId: string; tag: string; author?: string }
) {
  return writeEvent(db, { ...o, action: 'add' });
}

export async function retractTag(
  db: AbstractPowerSyncDatabase, o: { captureId: string; tag: string; author?: string }
) {
  return writeEvent(db, { ...o, action: 'retract' });
}

/** Current tags of a capture: those whose LATEST event is `add`. */
export async function tagsFor(db: AbstractPowerSyncDatabase, captureId: string): Promise<string[]> {
  const rows = await db.getAll<{ tag: string; action: string }>(
    `SELECT tag, action FROM capture_tag t
      WHERE capture_id = ?
        AND created_at_ms = (SELECT MAX(created_at_ms) FROM capture_tag t2
                              WHERE t2.capture_id = t.capture_id AND t2.tag = t.tag)
      GROUP BY tag`,
    [captureId]
  );
  return rows.filter((r) => r.action === 'add').map((r) => r.tag).sort();
}

/** All distinct current tags in a project's captures, for the filter chips. */
export async function projectTags(
  db: AbstractPowerSyncDatabase, captureIds: string[]
): Promise<string[]> {
  if (!captureIds.length) return [];
  const placeholders = captureIds.map(() => '?').join(',');
  const rows = await db.getAll<{ tag: string; action: string }>(
    `SELECT tag, action FROM capture_tag t
      WHERE capture_id IN (${placeholders})
        AND created_at_ms = (SELECT MAX(created_at_ms) FROM capture_tag t2
                              WHERE t2.capture_id = t.capture_id AND t2.tag = t.tag)
      GROUP BY capture_id, tag`,
    captureIds
  );
  return Array.from(new Set(rows.filter((r) => r.action === 'add').map((r) => r.tag))).sort();
}

/** capture_id → current tags, for filtering the grid client-side. */
export async function tagMap(
  db: AbstractPowerSyncDatabase, captureIds: string[]
): Promise<Record<string, string[]>> {
  if (!captureIds.length) return {};
  const placeholders = captureIds.map(() => '?').join(',');
  const rows = await db.getAll<{ capture_id: string; tag: string; action: string }>(
    `SELECT capture_id, tag, action FROM capture_tag t
      WHERE capture_id IN (${placeholders})
        AND created_at_ms = (SELECT MAX(created_at_ms) FROM capture_tag t2
                              WHERE t2.capture_id = t.capture_id AND t2.tag = t.tag)`,
    captureIds
  );
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    if (r.action !== 'add') continue;
    (out[r.capture_id] ??= []).push(r.tag);
  }
  return out;
}

/** Push tag events. Same owned-queue rules as notes/decisions. */
export async function drainTagOutbox(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, ownerId: string
) {
  const r = { attempted: 0, uploaded: 0, alreadyApplied: 0, retryable: 0 };
  const rows = await db.getAll<{ mutation_id: string; payload_json: string;
                                 payload_sha256: string; attempt_count: number }>(
    `SELECT mutation_id, payload_json, payload_sha256, attempt_count
       FROM tag_outbox WHERE next_attempt_at_ms <= ? ORDER BY queued_at_ms LIMIT 20`,
    [Date.now()]
  );
  for (const row of rows) {
    r.attempted++;
    try {
      const p = JSON.parse(row.payload_json);
      const { data, error } = await supabase.rpc('ingest_tag_v1', {
        p_mutation_id: p.mutation_id, p_id: p.id, p_capture_id: p.capture_id,
        p_owner_id: ownerId, p_tag: p.tag, p_action: p.action, p_author: p.author,
        p_created_at_ms: p.created_at_ms, p_request_sha256: row.payload_sha256,
      });
      if (error) throw error;
      await db.execute(`DELETE FROM tag_outbox WHERE mutation_id = ?`, [row.mutation_id]);
      if (data?.status === 'already_applied') r.alreadyApplied++; else r.uploaded++;
    } catch (e: any) {
      const n = row.attempt_count + 1;
      await db.execute(
        `UPDATE tag_outbox SET attempt_count = ?, next_attempt_at_ms = ?,
           last_error_code = ?, last_error_text = ? WHERE mutation_id = ?`,
        [n, Date.now() + Math.min(60_000 * 2 ** Math.min(n, 6), 30 * 60_000),
         e?.code ?? 'TRANSIENT', e?.message ?? String(e), row.mutation_id]
      );
      r.retryable++;
    }
  }
  return r;
}
