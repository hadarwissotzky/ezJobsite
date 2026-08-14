/**
 * Get the photos on a MESSAGE in front of the person reading the conversation
 * (hadar, 2026-08-09).
 *
 * This is the transport half of "add the image to the message". The composer commits
 * the bytes through `performCapture` and `postReply` links them; this puts the object
 * in Storage, mints the signed URLs the anon page cannot mint for itself, and tells
 * the server which reply carries them.
 *
 * ─── it is a sibling of approvalphotopublish.ts, on purpose ──────────────────────
 * Same bucket, same content-addressed key, same create-only upload, same 45-day
 * signed URL, same "one bad file must not cost the others" collection of failures.
 * A message photo and an evidence photo are the same bytes with different meaning,
 * and giving the second one its own storage convention would mean two answers to
 * "where is this file" the first time somebody had to debug one.
 *
 * ─── the three rules it inherits ─────────────────────────────────────────────────
 *
 * 1. IT NEVER SENDS A MESSAGE. The reply is already durable and already queued by
 *    the time this runs. This attaches pictures to something that exists; it cannot
 *    cause a word to reach anyone.
 *
 * 2. IT NEVER FAILS THE REPLY. The message is the thing that must arrive. If
 *    Storage is down or the RPC is missing, the photo stays on the phone marked
 *    unpublished, the bubble SAYS it is on this phone only, and the next drain tries
 *    again. A message that failed to send because a photo would not upload is the
 *    worse outcome in every case.
 *
 * 3. IT NEVER MODIFIES EVIDENCE. The original committed bytes go up under the key
 *    their own sha256 names. The resize is asked of Storage at URL-mint time, so the
 *    object in the bucket stays the exact file whose hash is in `capture_commit`.
 *
 * ─── why it is a separate pass and not part of postReply ─────────────────────────
 * `postReply` is offline-first and returns before any network call — that is mandate
 * #7 and it is not negotiable. Uploading inside it would either block the composer
 * on signal or make "sent" mean something different depending on connectivity. So
 * the message commits, and the photos catch up.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import { SupabaseClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';
import { extFor } from './capture';
import { objectKey } from './uploader';
import { SIGNED_URL_TTL_SEC } from './approvalphotopublish';

const BUCKET = 'captures';

/** How wide the client's page draws a message photo. Smaller than an evidence tile:
 *  it sits in a chat bubble, not in a proof grid, and the whole thread has to load
 *  on a phone on a jobsite. */
const MESSAGE_PHOTO_PX = 1080;
const MESSAGE_PHOTO_QUALITY = 72;

/** Never more than this per pass. Not a cap on what he can send — unpublished rows
 *  stay queued and the next drain takes the next batch — but one message with forty
 *  photos must not hold the drain open. */
const PER_PASS = 12;

export type ReplyMediaReport = {
  /** Rows the server accepted and the client can now see. */
  published: number;
  /** Photos that could not be prepared, with the reason. Never hidden. */
  failed: Array<{ captureId: string; reason: string }>;
  /** Set when nothing could be published at all — no network, RPC missing. The
   *  messages still went; this says the pictures have not landed yet. */
  blocked: string | null;
};

type Pending = {
  messageId: string; captureId: string; ord: number;
  relpath: string; sha256: string; mime: string; bytes: number;
};

/**
 * Message photos on this device that the server has not been told about.
 *
 * Only rows whose capture actually has bytes on this phone are returned: a link
 * whose file is gone (a restore, a purge) can never be published, and re-reading it
 * every drain forever would be a permanent retry loop over a permanent failure.
 */
export async function pendingReplyMedia(
  db: AbstractPowerSyncDatabase, limit = PER_PASS
): Promise<Pending[]> {
  return db.getAll<Pending>(
    `SELECT mm.message_id AS messageId, mm.capture_id AS captureId, mm.ord AS ord,
            cc.media_relpath AS relpath, cc.media_sha256 AS sha256,
            cc.media_mime_type AS mime, cc.media_bytes AS bytes
       FROM thread_message_media mm
       JOIN capture_commit cc ON cc.capture_id = mm.capture_id
       JOIN thread_message m ON m.id = mm.message_id
      WHERE mm.published_at_ms IS NULL
        AND m.side = 'contractor'
      ORDER BY mm.message_id, mm.ord
      LIMIT ?`,
    [limit]
  );
}

/**
 * Upload and announce every unpublished message photo.
 *
 * Idempotent on both halves: the Storage key is the content hash so re-uploading is
 * a no-op, and the RPC inserts on (reply_id, capture_id) with `do nothing`.
 */
export async function publishReplyMedia(
  db: AbstractPowerSyncDatabase,
  supabase: SupabaseClient,
  o: { ownerId: string }
): Promise<ReplyMediaReport> {
  const report: ReplyMediaReport = { published: 0, failed: [], blocked: null };

  let pending: Pending[];
  try { pending = await pendingReplyMedia(db); }
  catch (e: any) { report.blocked = e?.message ?? String(e); return report; }
  if (!pending.length) return report;

  const rows: Array<Record<string, unknown>> = [];
  const done: Array<{ messageId: string; captureId: string }> = [];

  for (const p of pending) {
    const key = objectKey(o.ownerId, p.captureId, p.sha256, extFor(p.mime, 'photo'));
    try {
      const b64 = await FS.readAsStringAsync(FS.documentDirectory + p.relpath,
        { encoding: FS.EncodingType.Base64 });
      // Create-only. "Already exists" IS success: the key is the hash, so an object
      // at this key is byte-for-byte our file.
      const up = await supabase.storage.from(BUCKET).upload(key, Buffer.from(b64, 'base64'), {
        contentType: p.mime, upsert: false,
      });
      if (up.error && !/exists|duplicate/i.test(up.error.message)) throw up.error;

      const plain = await supabase.storage.from(BUCKET)
        .createSignedUrl(key, SIGNED_URL_TTL_SEC);
      if (plain.error || !plain.data?.signedUrl) throw plain.error ?? new Error('no signed url');

      const small = await supabase.storage.from(BUCKET).createSignedUrl(key, SIGNED_URL_TTL_SEC, {
        transform: {
          width: MESSAGE_PHOTO_PX, height: MESSAGE_PHOTO_PX,
          resize: 'contain', quality: MESSAGE_PHOTO_QUALITY,
        },
      });

      rows.push({
        reply_id: p.messageId,
        capture_id: p.captureId,
        seq: p.ord,
        // If the transform could not be minted the plain URL takes both slots: a
        // full-size image is slower and still correct, a broken tile is neither.
        url: small.data?.signedUrl ?? plain.data.signedUrl,
        fallback_url: plain.data.signedUrl,
        bytes: p.bytes,
      });
      done.push({ messageId: p.messageId, captureId: p.captureId });
    } catch (e: any) {
      // One unreadable file must not cost the other photos in the same message.
      report.failed.push({ captureId: p.captureId, reason: e?.message ?? String(e) });
    }
  }

  if (!rows.length) {
    report.blocked = report.failed[0]?.reason ?? 'no message photos could be prepared';
    return report;
  }

  const { data, error } = await supabase.rpc('reply_media_attach_v1', { p_media: rows });
  if (error) {
    // NOT marked published. The bytes may well be in Storage — that is harmless and
    // idempotent — but until the server has the row the client cannot see them, and
    // saying otherwise on the bubble would be the lie this whole file exists to
    // avoid.
    report.blocked = error.message;
    return report;
  }

  /**
   * The local stamps, guarded. This loop used to sit outside any try, so a failed write
   * threw out of a function every caller invokes with `void` — an unhandled rejection
   * for a bookkeeping update (found by review, 2026-08-13).
   *
   * Failing here is SAFE and self-healing: the server already holds the rows, and an
   * unstamped local row is simply re-offered on the next drain, where the RPC's
   * `on conflict do nothing` absorbs it. The wrong move would be to report `blocked`
   * and imply the photos had not been published — they have.
   */
  const at = Date.now();
  try {
    for (const d of done) {
      await db.execute(
        `UPDATE thread_message_media SET published_at_ms = ?
          WHERE message_id = ? AND capture_id = ?`,
        [at, d.messageId, d.captureId]
      );
    }
  } catch { /* re-offered next drain; the RPC is idempotent on (reply_id, capture_id) */ }
  report.published = Number((data as any)?.inserted ?? done.length);
  return report;
}
