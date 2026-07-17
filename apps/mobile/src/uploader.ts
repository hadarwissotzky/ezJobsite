/**
 * The outbox drainer — implements CAPTURE-DURABILITY-ARCH-v1-CODEX §3 step 10.
 *
 * This is the ONLY thing that moves a capture to the cloud. It is deliberately
 * boring, and every rule below exists because a specific review found a specific
 * way to lose a capture.
 *
 * THE RULES (do not relax any of them without the architect):
 *
 * 1. `capture_outbox` is TRANSPORT state. It is NOT the record. Deleting a row
 *    here never destroys a capture — `capture_commit` is the authority and is
 *    append-only. (Codex #11 C3: ps_crud/outbox absence must never mean "lost".)
 *
 * 2. ONE RPC for Capture + Attachment. Never two requests. Two requests permit
 *    "Capture accepted, Attachment rejected, queue drained" -> the server
 *    checkpoint then overwrites the local rows and a capture the user was told
 *    was saved is gone. That is the exact bug the spike connector shipped.
 *
 * 3. The outbox row is deleted ONLY after the RPC returns success. A timeout,
 *    a rejection, or a crash leaves it present, so the retry happens. Losing
 *    the upload is fine; losing the intent is not.
 *
 * 4. Retries are idempotent by `mutation_id`, minted at PREPARE and stored in
 *    the commitment record — so a retry after a restart re-sends the SAME id
 *    and the server returns the original success instead of duplicating.
 *
 * 5. A permanent rejection is NOT discarded to unblock the queue. It parks the
 *    row with the error and stops retrying. "Unblocking the queue" is never
 *    worth more than the capture. (Codex #11 C3.)
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import { SupabaseClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';

const BUCKET = 'captures';

/** Postgres codes that will never succeed on retry. Park, don't spin. */
const PERMANENT = new Set([
  '42501', // insufficient_privilege / owner mismatch
  '23505', // mutation replayed with a different digest -> a real conflict
  '23514', // check_violation
  '23503', // foreign_key_violation
]);

export type DrainResult = {
  attempted: number;
  uploaded: number;
  alreadyApplied: number;
  parked: number;
  retryable: number;
};

type OutboxRow = {
  mutation_id: string;
  capture_id: string;
  payload_json: string;
  payload_sha256: string;
  attempt_count: number;
};

/**
 * Content-addressed, create-only, owner-scoped. The key proves the bytes, so an
 * upload can be retried without ever overwriting a different object, and the
 * storage policy can enforce ownership from the path.
 */
export function objectKey(ownerId: string, captureId: string, sha256: string, ext: string) {
  return `${ownerId}/${captureId}/${sha256}.${ext}`;
}

export async function drainOutbox(
  db: AbstractPowerSyncDatabase,
  supabase: SupabaseClient,
  ownerId: string
): Promise<DrainResult> {
  const r: DrainResult = { attempted: 0, uploaded: 0, alreadyApplied: 0, parked: 0, retryable: 0 };
  const now = Date.now();

  const rows = await db.getAll<OutboxRow>(
    `SELECT mutation_id, capture_id, payload_json, payload_sha256, attempt_count
       FROM capture_outbox
      WHERE next_attempt_at_ms <= ?
      ORDER BY queued_at_ms
      LIMIT 10`,
    [now]
  );

  for (const row of rows) {
    r.attempted++;
    let payload: any;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      await park(db, row, 'CORRUPT_PAYLOAD', 'payload_json is not valid JSON');
      r.parked++;
      continue;
    }

    try {
      // --- 1. media -> storage, create-only ---------------------------------
      // Photos and video existed nowhere in this map, so every image would have
      // landed in storage as an extensionless ".bin" -- undownloadable by anything
      // that trusts a file extension, which is most things.
      const mime: string = payload.media_mime_type ?? '';
      const ext = mime.startsWith('text/') ? 'txt'
        : mime.startsWith('audio/') ? 'm4a'
        : mime === 'image/png' ? 'png'
        : mime === 'image/heic' ? 'heic'
        : mime.startsWith('image/') ? 'jpg'
        : mime === 'video/mp4' ? 'mp4'
        : mime.startsWith('video/') ? 'mov'
        : 'bin';
      const key = objectKey(ownerId, payload.capture_id, payload.media_sha256, ext);

      const local = await db.getAll<{ media_relpath: string }>(
        `SELECT media_relpath FROM capture_commit WHERE capture_id = ?`, [payload.capture_id]
      );
      if (local.length !== 1) {
        // No commitment => nothing to upload. The outbox FK should make this
        // impossible; if it happens, the DB is inconsistent and we must not guess.
        await park(db, row, 'NO_COMMITMENT', 'outbox row with no capture_commit');
        r.parked++; continue;
      }
      const b64 = await FS.readAsStringAsync(FS.documentDirectory + local[0].media_relpath,
        { encoding: FS.EncodingType.Base64 });
      const bytes = Buffer.from(b64, 'base64');

      const up = await supabase.storage.from(BUCKET).upload(key, bytes, {
        contentType: payload.media_mime_type,
        upsert: false, // create-only: never overwrite evidence
      });
      // "already exists" is SUCCESS, not failure: the key is the hash, so an
      // existing object at this key IS our bytes. This is what makes retry safe.
      const dup = up.error && /exists|duplicate/i.test(up.error.message);
      if (up.error && !dup) throw up.error;

      // --- 2. ONE atomic RPC for Capture + Attachment ------------------------
      const { data, error } = await supabase.rpc('ingest_capture_v1', {
        p_mutation_id: payload.mutation_id,
        p_capture_id: payload.capture_id,
        p_attachment_id: payload.attachment_id,
        p_project_id: payload.project_id,
        p_owner_id: ownerId,
        p_object_key: key,
        p_media_sha256: payload.media_sha256,
        p_media_bytes: payload.media_bytes,
        p_media_mime: payload.media_mime_type,
        p_modality: payload.modality ?? 'text',
        p_captured_at_ms: payload.captured_at_ms,
        p_request_sha256: row.payload_sha256,
        // MANDATE #9. `?? null` not `?? 0`: a capture queued before the stamp
        // existed has no location, and 0,0 is a spot in the Gulf of Guinea that
        // the server would rightly refuse. Null is the truth about those rows.
        p_gps_lat: payload.gps_lat ?? null,
        p_gps_lng: payload.gps_lng ?? null,
        p_gps_accuracy_m: payload.gps_accuracy_m ?? null,
        p_gps_fix_age_ms: payload.gps_fix_age_ms ?? null,
        p_stamp_status: payload.stamp_status ?? null,
      });
      if (error) throw error;

      // --- 3. ONLY NOW may the intent be removed -----------------------------
      await db.writeTransaction(async (tx) => {
        await tx.execute(`DELETE FROM capture_outbox WHERE mutation_id = ?`, [row.mutation_id]);
      });

      if (data?.status === 'already_applied') r.alreadyApplied++; else r.uploaded++;
    } catch (e: any) {
      const code = e?.code ?? e?.error_code;
      if (PERMANENT.has(code)) {
        // Park it. Do NOT delete: the capture is still committed locally and the
        // user must not be told it is backed up when it is not.
        await park(db, row, code, e?.message ?? String(e));
        r.parked++;
      } else {
        await backoff(db, row, code ?? 'TRANSIENT', e?.message ?? String(e));
        r.retryable++;
      }
    }
  }
  return r;
}

/** Permanent failure: record it, stop retrying, keep the row forever. */
async function park(db: AbstractPowerSyncDatabase, row: OutboxRow, code: string, msg: string) {
  await db.execute(
    `UPDATE capture_outbox
        SET attempt_count = attempt_count + 1, last_attempt_at_ms = ?,
            next_attempt_at_ms = ?, last_error_code = ?, last_error_text = ?
      WHERE mutation_id = ?`,
    // 864e12 ~= year 275760: parked, not scheduled. Surfaced in the UI, never
    // silently dropped.
    [Date.now(), 8640000000000, code, msg, row.mutation_id]
  );
}

/** Transient failure: exponential backoff, capped. Offline is the normal case. */
async function backoff(db: AbstractPowerSyncDatabase, row: OutboxRow, code: string, msg: string) {
  const n = row.attempt_count + 1;
  const delay = Math.min(60_000 * 2 ** Math.min(n, 6), 30 * 60_000); // 1m..30m
  await db.execute(
    `UPDATE capture_outbox
        SET attempt_count = ?, last_attempt_at_ms = ?, next_attempt_at_ms = ?,
            last_error_code = ?, last_error_text = ?
      WHERE mutation_id = ?`,
    [n, Date.now(), Date.now() + delay, code, msg, row.mutation_id]
  );
}

/** Delivery status for the UI. Never conflate with "saved". */
export async function outboxStatus(db: AbstractPowerSyncDatabase) {
  return db.getAll<{ pending: number; parked: number }>(
    `SELECT
       sum(case when next_attempt_at_ms < 8640000000000 then 1 else 0 end) AS pending,
       sum(case when next_attempt_at_ms >= 8640000000000 then 1 else 0 end) AS parked
     FROM capture_outbox`
  );
}
