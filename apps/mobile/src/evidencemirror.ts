/**
 * EVIDENCE THAT FOLLOWS THE ACCOUNT — the captures behind an extra, on a device that
 * did not take them.
 *
 * hadar, 2026-08-21, on a phone freshly signed in as another user: *"images not
 * displaying in the records"*.
 *
 * ─── WHAT WAS ACTUALLY MISSING ──────────────────────────────────────────────────
 * `hydrateChangeOrders` pulls the change order. Nothing pulls anything BEHIND it.
 * The chain a photo hangs off is four links long and only the first was ever synced
 * down:
 *
 *   change_order ──(decision_id)──▶ decision ──▶ decision_version ──(capture_id)──▶
 *   capture_commit ──(media_relpath)──▶ a FILE in this app's Documents directory
 *
 * `decision`, `decision_version` and `capture_commit` are all written by the device
 * that captured, uploaded through their own outboxes, and **never pulled back**. So a
 * second phone — or a reinstall, or the handover in `deviceowner.ts` — gets the extras
 * and an empty evidence graph: no versions, therefore no capture ids, therefore no
 * photos, therefore the microphone placeholder on every card, and a record screen with
 * nothing under it.
 *
 * That is worse than a cosmetic gap. This product's claim is that an approved change
 * order carries the proof of what was agreed; an approved change order that shows no
 * photos on the phone you happen to be holding does not carry it.
 *
 * ─── WHY A MIRROR TABLE AND NOT `capture_commit` ────────────────────────────────
 * The obvious move is to insert the pulled captures straight into `capture_commit`.
 * It is wrong, and the reason matters more than the convenience:
 *
 * `capture_commit` means "THIS DEVICE durably holds these bytes". It is the table
 * mandate #1 rests on — `MEDIA_COMMITTED` is a statement about local, fsync'd,
 * verified bytes, and `recoverySweep`/`readCapture` treat a row without its file as
 * EVIDENCE THAT HAS BEEN LOST. Writing rows for media this device has never held
 * would make the app say "this photo is gone" about a photo sitting safely in
 * Storage — a false alarm about lost evidence, on the one screen whose job is proving
 * evidence. It would also mean inventing a `mutation_id` and a `request_sha256` for a
 * commitment that never happened on this device.
 *
 * So mirrored captures live in their own table with their own meaning: **this
 * capture belongs to the account and is held in the cloud; the bytes may or may not
 * be on this phone yet.** A cache, freely refillable and freely deletable — the exact
 * opposite of the append-only evidence table next to it.
 *
 * ─── WHAT THIS DOES NOT RESTORE, STATED PLAINLY ─────────────────────────────────
 * `capture_pair` — the link tying walkthrough photos to the sentence spoken over
 * them — is **device-local and has no server table at all**, so paired sibling photos
 * cannot be recovered here. Only captures reachable through `decision_version` come
 * back. That is a real remaining hole and it is named rather than papered over; a
 * `capture_pair` table plus its own outbox is the fix, and it is not this change.
 *
 * Storage's read policy is `(storage.foldername(name))[1] = auth.uid()` — OWNER ONLY
 * (sql/011). So a crew member can read a colleague's capture ROWS (376 grants a
 * company-wide select) but cannot download their MEDIA. Same phone, same account —
 * hadar's case — works. Cross-member photo restore needs a storage policy change and
 * is deliberately not attempted here.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

import { logDiag } from './diaglog.ts';

const BUCKET = 'captures';

/** Where mirrored bytes land. A SEPARATE directory from `capture-media/`, so nothing
 *  can confuse a cached copy of somebody's cloud photo with this device's own durable
 *  original — and so `recoverySweep`, which walks `capture-media/`, never sees these. */
export const MIRROR_MEDIA_ROOT = 'capture-remote/';

export const MIRROR_DDL = [
  `CREATE TABLE IF NOT EXISTS capture_mirror (
      capture_id     TEXT NOT NULL PRIMARY KEY,
      project_id     TEXT NOT NULL,
      owner_id       TEXT NOT NULL,
      /* The Storage key, exactly as the uploading device wrote it:
         <ownerId>/<captureId>/<sha256>.<ext> (uploader.ts objectKey). */
      object_key     TEXT NOT NULL,
      media_sha256   TEXT NOT NULL,
      media_bytes    INTEGER,
      modality       TEXT,
      captured_at_ms INTEGER NOT NULL,
      gps_lat        REAL,
      gps_lng        REAL,
      /* Null until the bytes are on this phone. NOT a claim of durability — see the
         header. Nullable is the whole point: it is the difference between "not
         downloaded yet" and "lost", which capture_commit cannot express. */
      local_relpath  TEXT,
      cached_at_ms   INTEGER
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS capture_mirror_project
     ON capture_mirror (project_id, captured_at_ms)`,
] as const;

export async function ensureMirrorSchema(db: AbstractPowerSyncDatabase): Promise<void> {
  for (const s of MIRROR_DDL) await db.execute(s);
}

/** `<ownerId>/<captureId>/<sha>.<ext>` → `.jpg`. Storage is the only place the mime
 *  survives: the ingest RPC accepts `p_media_mime` and has no column to put it in. */
export function extOf(objectKey: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(objectKey);
  return m ? m[1].toLowerCase() : 'bin';
}

export function mirrorRelpath(captureId: string, objectKey: string, sha: string): string {
  return `${MIRROR_MEDIA_ROOT}${captureId}/${sha}.${extOf(objectKey)}`;
}

/**
 * `.in(...)` GOES INTO A GET QUERY STRING, so the list has a length limit that is not
 * ours to set. A job with a few hundred decisions builds a multi-kilobyte URL,
 * PostgREST or nginx rejects it, the error branch returns zeros — and the record
 * screen shows no photos AT ALL, permanently, on precisely the biggest jobs (review,
 * 2026-08-21). The failure scales with how much evidence there is to lose.
 *
 * 100 per request: comfortably inside every proxy's limit and few enough round trips
 * to be invisible on the 15-second tick.
 */
const IN_CHUNK = 100;

function chunk<T>(xs: readonly T[], n = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export type HydrateEvidenceResult = {
  decisions: number;
  versions: number;
  captures: number;
  /** The pull could not be made at all (offline, refused). Nothing was written. */
  offline: boolean;
};

/**
 * Pull the evidence graph for one project: decisions, their version chain, and the
 * captures those versions point at.
 *
 * INSERT OR IGNORE THROUGHOUT, and it is doing real work rather than being defensive
 * boilerplate: `decision` and `decision_version` are append-only with SQLite triggers
 * that ABORT on UPDATE, so a re-pull of a row this device already has must be a
 * no-op at the statement level. It cannot be an upsert.
 *
 * ORDER IS FORCED BY A FOREIGN KEY: `decision_version.decision_id REFERENCES
 * decision(id)`. Versions before decisions would be rejected row by row.
 *
 * A capture the device ALREADY committed locally is skipped — `capture_commit` is the
 * better record of it (it holds the real bytes), and mirroring it as well would give
 * the photo queries two rows for one photo.
 */
export async function hydrateEvidence(
  db: AbstractPowerSyncDatabase,
  supabase: SupabaseClient,
  projectId: string,
  ownerId: string,
): Promise<HydrateEvidenceResult> {
  const nil: HydrateEvidenceResult =
    { decisions: 0, versions: 0, captures: 0, offline: true };

  // ── decisions ────────────────────────────────────────────────────────────────
  const { data: decs, error: de } = await supabase
    .from('decision')
    .select('id, project_id, subject, scope_level, assignee, created_at_ms')
    .eq('project_id', projectId);
  if (de || !decs) {
    void logDiag(db, 'hydrate.evidence', `decision: ${String(de?.message ?? 'no data').slice(0, 120)}`);
    return nil;
  }

  let decisions = 0;
  for (const d of decs as any[]) {
    try {
      const r = await db.execute(
        `INSERT OR IGNORE INTO decision
           (id, project_id, owner_id, subject, scope_level, assignee, created_at_ms)
         VALUES (?,?,?,?,?,?,?)`,
        [d.id, d.project_id, ownerId, d.subject,
         d.scope_level ?? 'project', d.assignee ?? null, Number(d.created_at_ms)]);
      if (r.rowsAffected) decisions++;
    } catch (e: any) {
      // ONE ROW MUST NOT TAKE THE PULL WITH IT — the same lesson hydrateChangeOrders
      // learned the hard way: a single unacceptable row threw out of the loop and
      // everything after it silently never landed.
      void logDiag(db, 'hydrate.evidence', `decision ${d.id}: ${String(e?.message ?? e).slice(0, 100)}`);
    }
  }

  const ids = (decs as any[]).map((d) => d.id);
  if (!ids.length) return { decisions, versions: 0, captures: 0, offline: false };

  // ── the version chain ────────────────────────────────────────────────────────
  const vers: any[] = [];
  for (const batch of chunk(ids)) {
    const { data, error } = await supabase
      .from('decision_version')
      .select('id, decision_id, value, capture_id, directed_by, created_at_ms')
      .in('decision_id', batch);
    if (error || !data) {
      void logDiag(db, 'hydrate.evidence', `version: ${String(error?.message ?? 'no data').slice(0, 120)}`);
      return { decisions, versions: 0, captures: 0, offline: false };
    }
    vers.push(...data);
  }

  let versions = 0;
  for (const v of vers as any[]) {
    try {
      const r = await db.execute(
        `INSERT OR IGNORE INTO decision_version
           (id, decision_id, value, capture_id, directed_by, created_at_ms)
         VALUES (?,?,?,?,?,?)`,
        [v.id, v.decision_id, v.value, v.capture_id ?? null,
         v.directed_by ?? null, Number(v.created_at_ms)]);
      if (r.rowsAffected) versions++;

      /**
       * MARK IT SYNCED, OR THE APP WILL TRY TO UPLOAD WHAT IT JUST DOWNLOADED.
       *
       * `backfillDecisionOutbox` (decisions.ts) runs on EVERY launch and selects
       * exactly "a decision_version with no outbox row and no decision_synced row" —
       * which is precisely the shape of a row this function writes. Without this line
       * a second phone that pulls forty versions queues forty uploads on its next
       * launch, and then:
       *   · the drawer warns "40 item(s) haven't reached the cloud" about work that
       *     is already in the cloud,
       *   · the OTA gate refuses to apply an update,
       *   · and `claimDevice` REFUSES EVERY HANDOVER — the exact deadlock this build
       *     spent a day chasing, rebuilt one layer up.
       * It would also re-upload a colleague's decision stamped with THIS device's
       * ownerId, which is a provenance lie on evidence rows.
       *
       * `decision_synced` is the right marker rather than a fake outbox row: it means
       * "the server has this version", which for a row we just read off the server is
       * true by construction.
       */
      await db.execute(
        `INSERT OR IGNORE INTO decision_synced (version_id, synced_at_ms) VALUES (?,?)`,
        [v.id, Date.now()]);
    } catch (e: any) {
      void logDiag(db, 'hydrate.evidence', `version ${v.id}: ${String(e?.message ?? e).slice(0, 100)}`);
    }
  }

  // ── the captures those versions point at ─────────────────────────────────────
  const capIds = Array.from(new Set(
    (vers as any[]).map((v) => v.capture_id).filter((x: unknown): x is string => !!x)));
  if (!capIds.length) return { decisions, versions, captures: 0, offline: false };

  // `payload` holds the Storage object key and `payload_sha256` the media digest —
  // the column names are historical (see sql/060) and renaming them is a separate,
  // deliberate change. Reading them under the wrong name is how this file's first
  // draft would have failed silently.
  const caps: any[] = [];
  for (const batch of chunk(capIds)) {
    const { data, error } = await supabase
      .from('capture')
      .select('id, project_id, owner_id, payload, payload_sha256, modality, client_created_at, gps_lat, gps_lng')
      .in('id', batch);
    if (error || !data) {
      void logDiag(db, 'hydrate.evidence', `capture: ${String(error?.message ?? 'no data').slice(0, 120)}`);
      return { decisions, versions, captures: 0, offline: false };
    }
    caps.push(...data);
  }

  // Byte length lives on the attachment, not the capture. Best-effort: a missing
  // attachment row costs a null `media_bytes`, never the capture.
  let bytes = new Map<string, number>();
  {
    for (const batch of chunk(capIds)) {
      const { data: att } = await supabase
        .from('attachment').select('capture_id, ciphertext_len').in('capture_id', batch);
      for (const a of (att ?? []) as any[]) bytes.set(a.capture_id, Number(a.ciphertext_len));
    }
  }

  // Captures this device took itself. `capture_commit` holds the real bytes and is
  // the better record; mirroring them too would double every photo in the queries.
  let own = new Set<string>();
  try {
    own = new Set((await db.getAll<{ capture_id: string }>(
      `SELECT capture_id FROM capture_commit`)).map((r) => r.capture_id));
  } catch { /* table not up yet — nothing is local, so nothing to exclude */ }

  let captures = 0;
  for (const c of caps as any[]) {
    if (own.has(c.id)) continue;
    const key = String(c.payload ?? '');
    const sha = String(c.payload_sha256 ?? '');
    // A capture with no object key is a row we cannot fetch bytes for. Skipping it
    // beats storing a mirror entry that can only ever fail to download.
    if (!key || !sha) continue;
    try {
      const r = await db.execute(
        `INSERT OR IGNORE INTO capture_mirror
           (capture_id, project_id, owner_id, object_key, media_sha256, media_bytes,
            modality, captured_at_ms, gps_lat, gps_lng, local_relpath, cached_at_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL)`,
        [c.id, c.project_id, c.owner_id, key, sha, bytes.get(c.id) ?? null,
         c.modality ?? null, new Date(c.client_created_at).getTime(),
         c.gps_lat ?? null, c.gps_lng ?? null]);
      if (r.rowsAffected) captures++;
    } catch (e: any) {
      void logDiag(db, 'hydrate.evidence', `capture ${c.id}: ${String(e?.message ?? e).slice(0, 100)}`);
    }
  }

  return { decisions, versions, captures, offline: false };
}

export type CacheResult = { downloaded: number; failed: number; remaining: number };

/**
 * Bring mirrored PHOTO bytes onto the phone, a bounded batch at a time.
 *
 * PHOTOS ONLY, and bounded, on purpose. This runs on the same 15-second tick as every
 * drain, and a contractor with four hundred captures on a job must not have his data
 * plan spent silently on audio nobody has asked to hear. Photos are what the card and
 * the record screen draw; a voice note is fetched when somebody presses play, which is
 * a different call site and a different decision.
 *
 * `local_relpath` is written only after the file is on disk with a non-zero length —
 * the same rule `ensureLogoCached` and `mapcache` follow, and for the same reason: an
 * interrupted download leaves a 0-byte file, and a cache that serves an empty image
 * never retries.
 *
 * `expo-file-system` is required INSIDE the function. A module-scope expo import makes
 * this file unloadable under `node --test`, and the decisions above are worth testing.
 */
export async function cacheMirroredPhotos(
  db: AbstractPowerSyncDatabase,
  supabase: SupabaseClient,
  o: { projectId?: string | null; limit?: number } = {},
): Promise<CacheResult> {
  const limit = o.limit ?? 12;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const FS = require('expo-file-system/legacy');

  let rows: Array<{ capture_id: string; object_key: string; media_sha256: string }> = [];
  try {
    rows = await db.getAll(
      `SELECT capture_id, object_key, media_sha256 FROM capture_mirror
        WHERE local_relpath IS NULL AND modality = 'photo'
          ${o.projectId ? 'AND project_id = ?' : ''}
        ORDER BY captured_at_ms DESC LIMIT ?`,
      o.projectId ? [o.projectId, limit + 1] : [limit + 1]);
  } catch {
    return { downloaded: 0, failed: 0, remaining: 0 };
  }
  const remaining = Math.max(0, rows.length - limit);
  rows = rows.slice(0, limit);

  let downloaded = 0, failed = 0;
  for (const r of rows) {
    const rel = mirrorRelpath(r.capture_id, r.object_key, r.media_sha256);
    const abs = FS.documentDirectory + rel;
    try {
      await FS.makeDirectoryAsync(
        FS.documentDirectory + `${MIRROR_MEDIA_ROOT}${r.capture_id}`,
        { intermediates: true }).catch(() => {});
      const signed = await supabase.storage.from(BUCKET).createSignedUrl(r.object_key, 3600);
      const url = signed.data?.signedUrl;
      if (!url) { failed++; continue; }
      const dl = await FS.downloadAsync(url, abs);
      if (dl.status !== 200) {
        await FS.deleteAsync(abs, { idempotent: true }).catch(() => {});
        failed++;
        continue;
      }
      const info = await FS.getInfoAsync(abs);
      if (!info.exists || !((info as any).size > 0)) {
        await FS.deleteAsync(abs, { idempotent: true }).catch(() => {});
        failed++;
        continue;
      }
      await db.execute(
        `UPDATE capture_mirror SET local_relpath = ?, cached_at_ms = ?
          WHERE capture_id = ?`, [rel, Date.now(), r.capture_id]);
      downloaded++;
    } catch {
      // Offline is the NORMAL case (mandate #7). The row keeps its null relpath and
      // the next tick tries again; nothing is lost by not having it.
      failed++;
    }
  }
  return { downloaded, failed, remaining };
}
