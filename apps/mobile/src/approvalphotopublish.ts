/**
 * R4 — get the extra's photos in front of the person who is signing for it.
 *
 * This is the I/O half of R4. The decisions (cap, order, load budget) are in
 * `approvalphotos.ts`, which has no imports and is unit-tested. This file only moves
 * bytes and rows, so that everything worth testing is testable.
 *
 * WHAT IT DOES, in one sentence: for a confirmation that has just been created, make
 * sure each photo behind the change order exists in Storage, mint a long-lived signed
 * URL for it, and freeze that list against the token so the client's page can render it.
 *
 * ─── the three rules ─────────────────────────────────────────────────────────────
 *
 * 1. IT NEVER SENDS ANYTHING (mandate #2). It is called AFTER the contractor has
 *    already confirmed the send; it attaches evidence to a request that exists. It
 *    mints no token, delivers no link, and cannot cause a price to reach anyone.
 *
 * 2. IT NEVER FAILS THE SEND (mandate #1 in spirit, and plain product sense). The
 *    approval link is already live and its price is already frozen. If Storage is
 *    slow, or the transform tier is off, or one file is missing from this device, the
 *    client must still get a page they can sign. So every failure is COLLECTED into
 *    the returned report and surfaced to the contractor — never thrown, never silent.
 *    "Sent, but two photos did not attach" is a true and actionable sentence.
 *    "Send failed" would not be.
 *
 * 3. IT NEVER MODIFIES EVIDENCE. It uploads the ORIGINAL committed bytes under the
 *    same content-addressed key the outbox drainer uses, create-only. The resize is
 *    asked of Storage at URL-mint time, so the object in the bucket stays the exact
 *    file whose sha256 is in `capture_commit`. A "compressed for the client" copy
 *    written back into the evidence bucket would be an object whose name no longer
 *    proves its bytes, which is the one guarantee 011_storage_policies.sql buys us.
 *
 * ─── why signed URLs and not a public bucket ─────────────────────────────────────
 * The obvious build is a second, world-readable bucket holding client-sized copies.
 * Rejected: it makes jobsite photos — interiors, faces, addresses on paperwork —
 * permanently public to anyone who ever sees the URL, including after the link
 * expires and after the job ends. A signed URL expires. It is bounded in the same way
 * the confirmation itself is bounded, which is the property we actually want.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import { SupabaseClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';
import { extFor } from './capture';
import { objectKey } from './uploader';
import { planApprovalPhotos, type SourcePhoto } from './approvalphotos';

const BUCKET = 'captures';

/**
 * 45 days. The confirmation itself expires at 30 (020_confirmations.sql), and the
 * extra 15 exist so that a client who approved on day 29 can still re-open the link and
 * see what they signed. A photo URL that dies before the record does would make the
 * "already answered" screen show a signed approval next to broken tiles.
 */
export const SIGNED_URL_TTL_SEC = 45 * 24 * 60 * 60;

/** Same shape `capPhotos` wants, plus what we need to find and upload the file. */
type LocalPhoto = SourcePhoto & { relpath: string; sha256: string };

export type PublishReport = {
  /** Rows accepted by the server and now frozen against the token. */
  attached: number;
  /** Cut by PRD R4's 0-8 cap. Not an error — but the contractor is told. */
  droppedOverCap: number;
  /** Photos we could not attach, with the reason. Never hidden, never retried here. */
  failed: Array<{ captureId: string; reason: string }>;
  /**
   * Set when nothing could be attached at all — no network, RPC missing, permission.
   * The send still succeeded; this says the page will have no photos on it.
   */
  blocked: string | null;
};

/**
 * The photos behind an extra.
 *
 * The pair-walk here is the same one `extraRecord()` does in record.ts, and yes, that
 * is duplicated SQL. It is duplicated because record.ts does not export the query and
 * this change may not edit it. The linkage is NOT `decision_version.capture_id` alone:
 * a fused Snap+Talk session writes each photo as its own `capture_commit` row and ties
 * it to the narration through `capture_pair`, so walking the pair is the only way to
 * reach the siblings. Extracting one shared helper is the right follow-up and is listed
 * in `integration_steps`.
 */
export async function extraPhotos(
  db: AbstractPowerSyncDatabase,
  changeOrderId: string
): Promise<LocalPhoto[]> {
  const co = (await db.getAll<{ decision_id: string }>(
    `SELECT decision_id FROM change_order WHERE id = ?`, [changeOrderId]))[0];
  if (!co) return [];

  const versions = await db.getAll<{ capture_id: string | null }>(
    `SELECT capture_id FROM decision_version WHERE decision_id = ? ORDER BY created_at_ms LIMIT 200`,
    [co.decision_id]);
  const captureIds = Array.from(
    new Set(versions.map((v) => v.capture_id).filter((x): x is string => !!x)));
  if (!captureIds.length) return [];

  const marks = captureIds.map(() => '?').join(',');
  const caps = await db.getAll<{
    capture_id: string; modality: string | null; captured_at_ms: number;
    media_relpath: string; media_sha256: string; media_bytes: number; media_mime_type: string;
  }>(
    `SELECT DISTINCT cc.capture_id, cc.modality, cc.captured_at_ms, cc.media_relpath,
            cc.media_sha256, cc.media_bytes, cc.media_mime_type
       FROM capture_commit cc
      WHERE cc.capture_id IN (${marks})
         OR cc.capture_id IN (
              SELECT p2.capture_id FROM capture_pair p2
               WHERE p2.pair_id IN (
                 SELECT p1.pair_id FROM capture_pair p1 WHERE p1.capture_id IN (${marks})
               )
            )
      ORDER BY cc.captured_at_ms`,
    [...captureIds, ...captureIds]);

  return caps
    .filter((c) => c.modality === 'photo')
    .map((c) => ({
      captureId: c.capture_id,
      capturedAtMs: c.captured_at_ms,
      bytes: c.media_bytes,
      mime: c.media_mime_type,
      relpath: c.media_relpath,
      sha256: c.media_sha256,
    }));
}

/**
 * Attach the extra's photos to a confirmation that has just been created.
 *
 * Call it AFTER `sendForConfirmation` returns ok and BEFORE the link is shared, so the
 * photos are on the page the first time anyone opens it. The server refuses to attach
 * once the client has answered (304_approval_photos.sql), which is what keeps mandate
 * #5 honest: nothing can appear beside a signature that was not there when it was given.
 *
 * Idempotent. The Storage key is the content hash so re-uploading is a no-op, and the
 * attach RPC inserts on (token, seq) with `do nothing`, so calling this twice for the
 * same token attaches nothing new rather than duplicating or overwriting.
 */
export async function publishApprovalPhotos(
  db: AbstractPowerSyncDatabase,
  supabase: SupabaseClient,
  o: { token: string; changeOrderId: string; ownerId: string }
): Promise<PublishReport> {
  const report: PublishReport = { attached: 0, droppedOverCap: 0, failed: [], blocked: null };

  let local: LocalPhoto[];
  try {
    local = await extraPhotos(db, o.changeOrderId);
  } catch (e: any) {
    report.blocked = e?.message ?? String(e);
    return report;
  }
  if (!local.length) return report;

  const byId = new Map(local.map((p) => [p.captureId, p]));
  const plan = planApprovalPhotos(local);
  report.droppedOverCap = plan.droppedOverCap;

  const rows: Array<Record<string, unknown>> = [];

  for (const p of plan.photos) {
    const src = byId.get(p.captureId);
    if (!src) continue;
    const key = objectKey(o.ownerId, p.captureId, src.sha256, extFor(src.mime, 'photo'));
    try {
      // 1. Make sure the object is there. The outbox drainer normally puts it there
      //    first, but a send can happen while the queue is still backed up — and a
      //    client page with empty tiles because a background queue had not caught up
      //    is exactly the kind of "it works on my phone" failure this product cannot
      //    afford. Create-only: "already exists" IS success, because the key is the
      //    hash, so an object at this key is byte-for-byte our file.
      const b64 = await FS.readAsStringAsync(FS.documentDirectory + src.relpath,
        { encoding: FS.EncodingType.Base64 });
      const up = await supabase.storage.from(BUCKET).upload(key, Buffer.from(b64, 'base64'), {
        contentType: src.mime, upsert: false,
      });
      if (up.error && !/exists|duplicate/i.test(up.error.message)) throw up.error;

      // 2. Two URLs, both frozen.
      //    `url` asks Storage to resize+recompress on the fly — this is the whole
      //    "compressed for SMS-link load speed" half of R4, done server-side so no
      //    native image library has to be added to the app.
      //    `fallback_url` is the untransformed object. The transform is a storage-tier
      //    feature and can 400; the page falls back on error rather than showing a
      //    broken tile. Both are minted here because a signed URL cannot be minted by
      //    the anon page later — it has no rights to the object.
      const plain = await supabase.storage.from(BUCKET)
        .createSignedUrl(key, SIGNED_URL_TTL_SEC);
      if (plain.error || !plain.data?.signedUrl) throw plain.error ?? new Error('no signed url');

      const small = await supabase.storage.from(BUCKET).createSignedUrl(key, SIGNED_URL_TTL_SEC, {
        transform: {
          width: p.targetLongEdgePx, height: p.targetLongEdgePx,
          resize: 'contain', quality: p.targetQuality,
        },
      });

      rows.push({
        seq: p.seq,
        capture_id: p.captureId,
        // If the transform URL could not be minted, the plain one takes both slots.
        // The page then loads a full-size image: slower, still correct, still visible.
        url: small.data?.signedUrl ?? plain.data.signedUrl,
        fallback_url: plain.data.signedUrl,
        eager: p.eager,
        bytes: src.bytes,
        captured_at_ms: p.capturedAtMs,
      });
    } catch (e: any) {
      // One unreadable file must not cost the client the other seven photos.
      report.failed.push({ captureId: p.captureId, reason: e?.message ?? String(e) });
    }
  }

  if (!rows.length) {
    if (!report.blocked) report.blocked = report.failed[0]?.reason ?? 'no photos could be prepared';
    return report;
  }

  const { data, error } = await supabase.rpc('approval_photos_attach', {
    p_token: o.token, p_photos: rows,
  });
  if (error) {
    report.blocked = error.message;
    return report;
  }
  report.attached = Number((data as any)?.inserted ?? 0);
  return report;
}
