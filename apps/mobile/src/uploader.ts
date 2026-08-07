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
import * as Network from 'expo-network';
import { getCellularConsent, uploadGate, type UploadGate } from './consent';
import { INBOX_ID } from './captureddl.ts';
import { mintUploadForFiledCapture } from './projects';

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
  /** REQ-PROC6: why nothing moved, in words a person can act on. */
  blocked: UploadGate | null;
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
  const r: DrainResult = { attempted: 0, uploaded: 0, alreadyApplied: 0, parked: 0, retryable: 0,
                           blocked: null };
  const now = Date.now();

  // REQ-CON2 + REQ-PROC6. Checked HERE, not at capture: mandate #7 says the
  // network is opportunistic and never a precondition, so by the time we ask this
  // the capture is already durable on the device. This only decides whether the
  // bytes leave now or wait for Wi-Fi.
  //
  // Defaults OFF. A 200 MB walkthrough pushed over a hotspot is a bill the
  // contractor never agreed to and finds out about at the end of the month.
  const state = await Network.getNetworkStateAsync();
  const gate = uploadGate(
    { isConnected: !!state.isConnected,
      isCellular: state.type === Network.NetworkStateType.CELLULAR },
    await getCellularConsent(db)
  );
  if (!gate.upload) {
    // Not an error, and not silence: the reason is returned so the UI can say
    // "waiting for Wi-Fi" instead of showing a queue that never drains.
    r.blocked = gate;
    return r;
  }

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

    // AWAITING A HOME. The server's capture.project_id references project(id) and the
    // Inbox is a sentinel with no row, so sending this is a guaranteed 23503 — which
    // is exactly what it did, on every tick, for two days (2026-07-27). Captures are
    // no longer queued while unresolved; this only catches rows queued BEFORE that
    // fix. It is deliberately parked rather than backed off: backoff implies the next
    // attempt might work, and this one cannot. `fileCapture()` replaces the row with a
    // real destination the moment a human picks one.
    if (payload.project_id === INBOX_ID) {
      // SELF-HEAL BEFORE PARKING (hadar 2026-08-07, twice). A human may already have
      // filed this capture — `fileCapture` writes `capture_resolution` and mints a
      // fresh outbox row — but any queue entry still carrying the Inbox sentinel would
      // sit here parked forever, and the capture screen would report a hold that is no
      // longer true. The resolution IS the human's answer; if it exists, use it rather
      // than making him answer again.
      //
      // Only the destination changes. `capture_commit` is untouched — its original
      // payload and digest stay the true record of what the device believed at capture
      // time — and the mutation_id is left alone because this row was never accepted by
      // the server (the FK refused it before any insert took effect), so there is no
      // prior success to conflict with.
      const filed = (await db.getAll<{ project_id: string }>(
        `SELECT project_id FROM capture_resolution WHERE capture_id = ?`,
        [payload.capture_id]))[0];
      if (filed?.project_id && filed.project_id !== INBOX_ID) {
        // REUSE THE MINT, do not hand-rewrite the row. I wrote the rewrite inline
        // first and it was wrong in the one way that matters here: it changed the
        // payload while keeping the mutation_id AND the stored digest, and the server
        // keys idempotency on (mutation_id, digest) — a changed payload under a reused
        // id is precisely the conflicting replay it refuses with 23505.
        // `mintUploadForFiledCapture` already handles this exact case (its case 2,
        // "STUCK — queued with project_id 'inbox' baked into the payload"), mints a
        // fresh id and digest, and leaves capture_commit untouched. One implementation
        // of a durability rule, not two.
        await mintUploadForFiledCapture(db, payload.capture_id, filed.project_id);
        r.retryable++;
        continue;   // the next pass sends it to the job he picked
      }
      await park(db, row, 'AWAITING_FILING',
        'held: this capture has no job yet — file it and it will upload');
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
        : mime === 'audio/wav' ? 'wav'
        : mime === 'audio/mpeg' ? 'mp3'
        : mime.startsWith('audio/') ? 'm4a'
        : mime === 'image/png' ? 'png'
        : mime === 'image/heic' ? 'heic'
        : mime.startsWith('image/') ? 'jpg'
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
      // THE CAPTURE'S PROJECT HAS NOT REACHED THE SERVER YET. ingest_capture_v1's
      // only foreign key is capture_project_id_fkey, so a 23503 here is always the
      // project: it is a PowerSync-managed row, and if that sync is lagging or has
      // stalled (its queue wedged on one poison row), the capture would park FOREVER
      // — a capture lost to a mutable-row timing problem, which mandate #1 forbids.
      // The project split (CLAUDE.md §5) made captures depend on a project row a
      // different transport delivers; this is where that dependency is repaired.
      // Push the project ourselves from the local table and let the capture retry.
      // Evidence must never be held hostage to the project sync.
      if (code === '23503') {
        const pushed = await pushProjectRow(db, supabase, payload.project_id);
        // On success the FK is now satisfiable, so leave the row schedulable and the
        // next drain lands it. On failure, back off so we do not spin.
        if (!pushed) await backoff(db, row, code, e?.message ?? String(e));
        r.retryable++;
        continue;
      }
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

/**
 * One-time recovery: free captures that PARKED on a now-fixable code (23503 — a
 * project that had not reached the server) so the next drain re-attempts them with
 * the project-push repair above. Without this, captures that parked BEFORE the fix
 * stay parked forever (next_attempt_at_ms is set to the year 275760). Returns how
 * many were freed. Idempotent: once they succeed and leave the outbox, there is
 * nothing left to free.
 */
export async function redriveParkedCaptures(
  db: AbstractPowerSyncDatabase, codes: readonly string[]
): Promise<number> {
  if (!codes.length) return 0;
  const marks = codes.map(() => '?').join(',');
  const r = await db.execute(
    `UPDATE capture_outbox
        SET attempt_count = 0, next_attempt_at_ms = 0,
            last_error_code = NULL, last_error_text = NULL
      WHERE last_error_code IN (${marks})`, [...codes]);
  return r.rowsAffected ?? 0;
}

/**
 * Bring THESE captures forward for an immediate retry — the SOMEONE IS WATCHING case.
 *
 * WHY THIS HAS TO EXIST (hadar 2026-08-06: "it's stuck"). `backoff()` puts a failed
 * row 2 minutes out after ONE transient failure, 4 after two, up to 30 minutes. That
 * is right for a background drain on a tailgate. It is wrong for the capture screen,
 * which polls for 90 SECONDS and calls drainOutbox every ~5s to push the upload along:
 * every one of those calls filters on `next_attempt_at_ms <= now`, so after the first
 * blip the row the user is literally watching is not even SELECTED. The screen then
 * spends 90 seconds re-asking a question it has already excluded itself from, gives up,
 * and tells a contractor with full bars that he is offline.
 *
 * So a foreground retry does not obey a background schedule. `attempt_count` is
 * deliberately NOT reset: the ladder still grows for the background drain, and a row
 * that keeps failing keeps backing off once nobody is watching it any more.
 *
 * PARKED ROWS ARE NOT TOUCHED (`< 8640000000000`). Parked means permanently refused,
 * and impatience is not new evidence — freeing those needs `redriveParkedCaptures`,
 * which names the error codes it believes are now fixable.
 */
export async function redriveNow(
  db: AbstractPowerSyncDatabase, captureIds: readonly string[]
): Promise<number> {
  if (!captureIds.length) return 0;
  const marks = captureIds.map(() => '?').join(',');
  const r = await db.execute(
    `UPDATE capture_outbox SET next_attempt_at_ms = 0
      WHERE capture_id IN (${marks}) AND next_attempt_at_ms < 8640000000000`,
    [...captureIds]
  );
  return r.rowsAffected ?? 0;
}

/**
 * Push a project row straight to the server from the local PowerSync table, the
 * same shape the connector's uploadData sends: every synced column except `status`,
 * which the server owns (its column-level grant refuses a client write, and the
 * connector strips it for exactly this reason). Best-effort — a capture retry is
 * the backstop, so a failed push here just means "try again next drain".
 */
async function pushProjectRow(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, projectId: string | undefined
): Promise<boolean> {
  if (!projectId) return false;
  try {
    const rows = await db.getAll<Record<string, any>>(
      `SELECT * FROM project WHERE id = ?`, [projectId]);
    if (!rows.length) return false;
    const { status, ...data } = rows[0];
    const { error } = await supabase.from('project').upsert(data);
    return !error;
  } catch {
    return false;
  }
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

/**
 * WHY THIS EXTRA HAS NO WRITE-UP — the diagnosis, for THESE captures.
 *
 * hadar 2026-08-06: "if we have files (photos and audio) but no scope it means either
 * 1. files were not uploaded, 2. files were not analyzed and scope was not created —
 * either way that needs to be fixed with a workflow and a user intervention."
 *
 * Both causes look identical on screen today (an extra that never wrote itself up),
 * and they have OPPOSITE remedies: one is a transfer this device can retry or that the
 * user must permit over cellular; the other is a server-side pass no button on this
 * phone can force, where the honest options are wait or write it yourself. Guessing
 * between them is what leaves a contractor tapping a button that cannot help him.
 *
 * READ-ONLY and LOCAL. The queue IS the state (status.ts's rule): a capture in
 * `capture_outbox` has not been accepted by the server, and one that is absent has —
 * `drainOutbox` deletes the row only after the RPC returns success. So this needs no
 * network to answer the upload half, which matters because the case it explains is
 * usually happening offline.
 */
export type CaptureDelivery = {
  /** How many of the asked-about captures exist locally at all. */
  total: number;
  /** Still queued and schedulable — the transfer has not finished. */
  pending: number;
  /** Permanently refused (`park`). These never retry on their own; the error says why. */
  parked: number;
  /** The most recent failure text across the queued rows, for the "and it said…" line. */
  lastError: string | null;
  /** Why nothing is moving right now, when that is a policy/network fact rather than
   *  a per-row one. Null when uploads are permitted. */
  gate: UploadGate | null;
};

export async function captureDelivery(
  db: AbstractPowerSyncDatabase, captureIds: readonly string[]
): Promise<CaptureDelivery> {
  const empty: CaptureDelivery = { total: 0, pending: 0, parked: 0, lastError: null, gate: null };
  if (!captureIds.length) return empty;
  const marks = captureIds.map(() => '?').join(',');
  const rows = await db.getAll<{ n: number; parked: number; err: string | null }>(
    `SELECT count(*) AS n,
            sum(CASE WHEN next_attempt_at_ms >= 8640000000000 THEN 1 ELSE 0 END) AS parked,
            max(last_error_text) AS err
       FROM capture_outbox WHERE capture_id IN (${marks})`,
    [...captureIds]
  );
  const r = rows[0] ?? { n: 0, parked: 0, err: null };
  const parked = r.parked ?? 0;
  const queued = (r.n ?? 0) - parked;

  // Only ask the radio when something is actually waiting: on a fully-delivered extra
  // the answer changes nothing and this runs on every record open.
  let gate: UploadGate | null = null;
  if (queued > 0) {
    try {
      const state = await Network.getNetworkStateAsync();
      const g = uploadGate(
        { isConnected: !!state.isConnected,
          isCellular: state.type === Network.NetworkStateType.CELLULAR },
        await getCellularConsent(db)
      );
      gate = g.upload ? null : g;
    } catch { /* can't tell → say nothing rather than invent a reason */ }
  }
  return { total: captureIds.length, pending: queued, parked, lastError: r.err ?? null, gate };
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
