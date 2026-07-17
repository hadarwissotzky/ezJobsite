/**
 * EZjobsite — the capture path. THE most important file in the product.
 *
 * Implements docs/CAPTURE-DURABILITY-ARCH-v1-CODEX.md (architecture: Codex).
 * Do not "improve" the safety model here — raise it with the architect.
 *
 * What this is for, in one sentence:
 *   NEVER tell someone "saved" for a capture we are about to lose.
 * That is CLAUDE.md mandate #1, and it is exactly how ezQuotePro died.
 *
 * The one rule everything hangs off:
 *   capture_commit is the commitment authority. ONE ROW = COMMITTED.
 *   The media file, capture_outbox, ps_crud and the PowerSync `capture` row
 *   mean NOTHING about whether we may say "saved".
 *
 * Why capture_commit is separate from the PowerSync table (this is the subtle
 * one): PowerSync can REVERT its own rows if the server later rejects the
 * write. If "saved" lived in a PowerSync table, the cloud could un-save
 * something the user was already told was saved. So the local record is ours,
 * and the PowerSync row is a replaceable projection of it.
 *
 * Local is the real record. The cloud is a copy. Not the other way round.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
// Pure-JS SHA-256. Deliberate: expo-crypto is a NATIVE module and would need a
// full native rebuild to link, which a Metro reload cannot do. For the 4KB
// fixtures this harness uses, pure JS is fine. Revisit for real multi-minute
// media, where a native digest will matter for speed.
import { sha256 } from 'js-sha256';

// ---------------------------------------------------------------- durability profile

/** Spec §3. If any readback fails, DO NOT ARM THE RECORDER. */
export type PragmaReport = { name: string; got: string; want: string; ok: boolean };

const REQUIRED: Array<[string, string]> = [
  ['journal_mode', 'wal'],
  ['synchronous', '2'],           // FULL
  ['fullfsync', '1'],
  ['checkpoint_fullfsync', '1'],
  ['wal_autocheckpoint', '1000'],
  ['foreign_keys', '1'],
];

/**
 * Reads the profile TWICE: once via the pooled read path (db.getAll) and once
 * INSIDE a writeTransaction — i.e. on the connection that actually performs the
 * commit.
 *
 * This matters because op-sqlite runs `PRAGMA query_only = true` on read
 * connections, which proves a POOL. `synchronous` and `foreign_keys` are
 * PER-CONNECTION. So asserting them through the pooled read path proves nothing
 * about the connection that commits — which is exactly the cross-connection
 * hazard Codex flagged as OPEN (#11 C2). If the two reads disagree, the pooled
 * assertion is worthless and only the write-connection read counts.
 */
export async function assertDurabilityProfile(
  db: AbstractPowerSyncDatabase
): Promise<{ ok: boolean; report: PragmaReport[]; writeReport: PragmaReport[]; poolDisagrees: boolean }> {
  const read = async (get: (s: string) => Promise<any[]>) => {
    const out: PragmaReport[] = [];
    for (const [name, want] of REQUIRED) {
      let got = '<error>';
      try {
        const rows = await get(`PRAGMA ${name}`);
        got = String(rows?.[0] ? Object.values(rows[0])[0] : '<empty>').toLowerCase();
      } catch (e: any) {
        got = `<err:${e?.message ?? e}>`;
      }
      out.push({ name, got, want, ok: got === want });
    }
    return out;
  };

  const report = await read((s) => db.getAll(s));

  let writeReport: PragmaReport[] = [];
  try {
    await db.writeTransaction(async (tx) => {
      writeReport = await read((s) => tx.getAll(s) as Promise<any[]>);
    });
  } catch (e: any) {
    writeReport = [{ name: '<writeTransaction>', got: `<err:${e?.message ?? e}>`, want: 'readable', ok: false }];
  }

  const poolDisagrees = writeReport.some((w) => {
    const p = report.find((x) => x.name === w.name);
    return p && p.got !== w.got;
  });

  // The WRITE connection is the only one whose profile can make DECIDE durable.
  const ok = writeReport.length > 0 && writeReport.every((r) => r.ok);
  return { ok, report, writeReport, poolDisagrees };
}

/** Best-effort application of the profile. Readback is what counts, not this. */
export async function applyDurabilityProfile(db: AbstractPowerSyncDatabase): Promise<void> {
  for (const stmt of [
    'PRAGMA journal_mode = WAL',
    'PRAGMA synchronous = FULL',
    'PRAGMA fullfsync = ON',
    'PRAGMA checkpoint_fullfsync = ON',
    'PRAGMA wal_autocheckpoint = 1000',
    'PRAGMA foreign_keys = ON',
  ]) {
    try { await db.execute(stmt); } catch { /* readback is the assertion */ }
  }
}

// ---------------------------------------------------------------- schema (app-owned)

/**
 * Spec §1. These tables are APP-OWNED and LOCAL-ONLY. They are deliberately NOT
 * declared in AppSchema — PowerSync must not install managed-table or CRUD
 * triggers on them, must not sync them, and must not clear them.
 * Created via raw DDL against the same database file.
 */
export const APP_OWNED_DDL = [
  `CREATE TABLE IF NOT EXISTS capture_commit (
      capture_id      TEXT NOT NULL PRIMARY KEY,
      attachment_id   TEXT NOT NULL UNIQUE,
      mutation_id     TEXT NOT NULL UNIQUE,
      project_id      TEXT NOT NULL,
      owner_id        TEXT NOT NULL,
      media_relpath   TEXT NOT NULL UNIQUE,
      media_sha256    TEXT NOT NULL
        CHECK (length(media_sha256) = 64 AND media_sha256 NOT GLOB '*[^0-9a-f]*'),
      media_bytes     INTEGER NOT NULL CHECK (media_bytes > 0),
      media_mime_type TEXT NOT NULL CHECK (length(media_mime_type) > 0),
      -- REQ-CAP2: voice | video | photo | text. Part of the commitment record
      -- because a DB-loss rebuild must know WHAT was captured, not just that
      -- bytes existed.
      modality        TEXT NOT NULL CHECK (modality IN ('voice','video','photo','text')),
      captured_at_ms  INTEGER NOT NULL CHECK (captured_at_ms > 0),
      -- MANDATE #9: where and when. NULLABLE ON PURPOSE -- a fix is not always
      -- available (basement, denied, no signal from a satellite) and mandate #1
      -- says a capture is never blocked. stamp_status records WHY it is missing
      -- so null is an honest answer rather than an unexplained hole.
      gps_lat         REAL,
      gps_lng         REAL,
      gps_accuracy_m  REAL,
      gps_fix_age_ms  INTEGER,
      stamp_status    TEXT,
      committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms >= captured_at_ms),
      request_sha256  TEXT NOT NULL
        CHECK (length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
      UNIQUE (mutation_id, capture_id, request_sha256)
   ) STRICT`,
  `CREATE TRIGGER IF NOT EXISTS capture_commit_no_update
     BEFORE UPDATE ON capture_commit
     BEGIN SELECT RAISE(ABORT, 'capture_commit is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS capture_commit_no_delete
     BEFORE DELETE ON capture_commit
     BEGIN SELECT RAISE(ABORT, 'capture_commit is append-only'); END`,
  `CREATE TABLE IF NOT EXISTS capture_outbox (
      mutation_id        TEXT NOT NULL PRIMARY KEY,
      capture_id         TEXT NOT NULL UNIQUE,
      operation          TEXT NOT NULL CHECK (operation = 'capture.create.v1'),
      payload_json       TEXT NOT NULL CHECK (json_valid(payload_json)),
      payload_sha256     TEXT NOT NULL
        CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
      queued_at_ms       INTEGER NOT NULL CHECK (queued_at_ms > 0),
      attempt_count      INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      last_attempt_at_ms INTEGER,
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
      last_error_code    TEXT,
      last_error_text    TEXT,
      FOREIGN KEY (mutation_id, capture_id, payload_sha256)
        REFERENCES capture_commit (mutation_id, capture_id, request_sha256)
        ON UPDATE RESTRICT ON DELETE RESTRICT
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS capture_outbox_due
     ON capture_outbox (next_attempt_at_ms, queued_at_ms)`,
];

/**
 * Create the app-owned tables, and MIGRATE them forward.
 *
 * `CREATE TABLE IF NOT EXISTS` silently does nothing when the table already
 * exists with an older shape — so adding a column to the DDL above does NOT add
 * it to an existing database. That produced a real bug: "no such column:
 * modality", surfaced only because init now reports failures instead of hanging
 * on "Starting…". A schema that only works on a fresh install is not a schema.
 *
 * capture_commit is append-only by trigger, so migration is ADD COLUMN only —
 * never rewrite, never drop. That constraint is the point, not an obstacle:
 * the commitment record must never be destroyed to change its shape.
 */
export async function ensureAppOwnedSchema(db: AbstractPowerSyncDatabase): Promise<void> {
  for (const stmt of APP_OWNED_DDL) await db.execute(stmt);
  await migrateAppOwnedSchema(db);
}

/**
 * Additive migrations. Idempotent; safe on every launch.
 *
 * DESIGN CONSEQUENCE worth naming: `capture_commit` is append-only by trigger,
 * so UPDATE is blocked and historical rows CANNOT be backfilled. Therefore a
 * field added later MUST be nullable for old rows, and the read path must cope
 * with NULL. This is not a wart -- it is append-only working as designed. The
 * alternative (drop and recreate to change shape) would destroy committed
 * evidence, which is the one thing this table exists to prevent.
 */
async function migrateAppOwnedSchema(db: AbstractPowerSyncDatabase): Promise<void> {
  const rows = await db.getAll<{ name: string }>(`PRAGMA table_info(capture_commit)`);
  const cols = new Set(rows.map((r) => r.name));

  if (rows.length > 0 && !cols.has('modality')) {
    // Nullable by necessity: SQLite cannot add NOT NULL without a default, and
    // we cannot UPDATE the old rows to fill one. New inserts always supply it.
    await db.execute(`ALTER TABLE capture_commit ADD COLUMN modality TEXT`);
  }

  // MANDATE #9: "every media capture is stamped with GPS + time as tamper-evident
  // evidence". Nullable for the same reason modality is, and for a second one that
  // matters more: capture_commit is APPEND-ONLY, so the old rows CANNOT be
  // backfilled -- not "we chose not to", the trigger refuses the UPDATE. A capture
  // taken before the stamp existed has no location and never will. That is a true
  // fact about those rows and the read path must show it as such, not as 0,0 (a
  // spot in the Atlantic) or as a guess.
  for (const [col, type] of [
    ['gps_lat', 'REAL'], ['gps_lng', 'REAL'], ['gps_accuracy_m', 'REAL'],
    ['gps_fix_age_ms', 'INTEGER'], ['stamp_status', 'TEXT'],
  ] as const) {
    if (rows.length > 0 && !cols.has(col)) {
      await db.execute(`ALTER TABLE capture_commit ADD COLUMN ${col} ${type}`);
    }
  }
}

// ---------------------------------------------------------------- helpers

const MEDIA_DIR = FS.documentDirectory + 'capture-media/';
const TMP_DIR = FS.documentDirectory + 'capture-tmp/';

/** SHA-256 over EXACT bytes. Never over a base64 or utf8 re-encoding of them. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return sha256(bytes).toLowerCase();
}

/** SHA-256 over exact bytes, read back from disk (never over an in-memory copy). */
async function hashFileFromDisk(uri: string): Promise<{ hex: string; bytes: number }> {
  const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
  const raw = Buffer.from(b64, 'base64');
  return { hex: await sha256Hex(new Uint8Array(raw)), bytes: raw.length };
}

export type SavedEvent = { captureId: string; atMs: number };
export const savedEvents: SavedEvent[] = [];

// ---------------------------------------------------------------- the commit sequence

export type CaptureResult =
  | { ok: true; captureId: string }
  | { ok: false; reason: string };

/**
 * Spec §3, steps 1-9. Ordered. The SINGLE COMMIT POINT is step 8's COMMIT.
 * `saved` is emitted only after it returns (step 9).
 *
 * NOTE (deviation, flagged not hidden): the spec calls for fcntl(F_FULLFSYNC)
 * on the media descriptor and renameatx_np(RENAME_EXCL) for install. Neither is
 * reachable from JS via expo-file-system. This implementation uses the JS
 * equivalents available (write, read-back-and-verify, moveAsync onto a
 * pre-checked non-existent destination). The SQLite side DOES get the real
 * barrier via synchronous=FULL + fullfsync, which is asserted. The media-side
 * barrier gap is REAL and is recorded in the result doc — it means K0-K2 test
 * ordering, not physical durability.
 */
export async function performCapture(
  db: AbstractPowerSyncDatabase,
  opts: {
    ownerId: string;
    projectId: string;
    /** Bytes + modality + mime. performCapture does not care what produced them. */
    input: import('./modality').CaptureInput;
    /**
     * MANDATE #9 stamp. Optional because a capture is NEVER blocked on a fix
     * (mandate #1): if the producer could not get one, the capture still happens
     * and `stamp_status` says why. Producers should start the fix when the camera
     * OPENS, so it is ready by the shutter and costs the user nothing.
     */
    stamp?: import('./stamp').Stamp;
  }
): Promise<CaptureResult> {
  // Step 0 — durability gate. Spec: if readback fails, DO NOT ARM.
  const prof = await assertDurabilityProfile(db);
  if (!prof.ok) {
    return { ok: false, reason: 'durability profile assertion failed: ' +
      prof.report.filter((r) => !r.ok).map((r) => `${r.name}=${r.got}!=${r.want}`).join(',') };
  }

  await FS.makeDirectoryAsync(MEDIA_DIR, { intermediates: true }).catch(() => {});
  await FS.makeDirectoryAsync(TMP_DIR, { intermediates: true }).catch(() => {});

  // Step 1 — mint identity + the byte-exact request payload, in memory.
  const captureId = `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const attachmentId = `att-${Math.random().toString(36).slice(2, 12)}`;
  const mutationId = `mut-${Math.random().toString(36).slice(2, 14)}`;
  // The stamp's clock wins when there is one: it is the moment the producer began,
  // not the moment the bytes finished arriving. For a 60s video those differ by a
  // minute, and the evidence should say when it was SHOT.
  const capturedAtMs = opts.stamp?.capturedAtMs ?? Date.now();

  const ext = opts.input.modality === 'text' ? 'txt' : opts.input.modality === 'voice' ? 'm4a' : 'bin';
  const mediaRelpath = `capture-media/${captureId}/${attachmentId}.${ext}`;
  const finalDir = MEDIA_DIR + captureId + '/';
  const finalUri = finalDir + attachmentId + '.' + ext;
  const tmpUri = `${TMP_DIR}${captureId}-${Math.random().toString(36).slice(2, 8)}.part`;

  // Steps 2-3 — record to a unique temp path; footer; freeze the writer.
  const b64 = Buffer.from(opts.input.bytes).toString('base64');
  await FS.writeAsStringAsync(tmpUri, b64, { encoding: FS.EncodingType.Base64 });

  // Step 4 — the finalized-file barrier. (See deviation note above.)

  // Step 5 — reopen read-only, stream once, validate, hash from DISK.
  const { hex: mediaSha256, bytes: mediaBytes } = await hashFileFromDisk(tmpUri);
  if (mediaBytes <= 0) {
    await FS.deleteAsync(tmpUri, { idempotent: true });
    return { ok: false, reason: 'zero-length media rejected' };
  }

  // Step 6-7 — no-replace install + durable directory entry.
  await FS.makeDirectoryAsync(finalDir, { intermediates: true }).catch(() => {});
  const existing = await FS.getInfoAsync(finalUri);
  if (existing.exists) {
    // Never overwrite. Verify the incumbent independently instead.
    const inc = await hashFileFromDisk(finalUri);
    if (inc.hex !== mediaSha256 || inc.bytes !== mediaBytes) {
      await FS.deleteAsync(tmpUri, { idempotent: true });
      return { ok: false, reason: 'destination exists with different content; refusing to overwrite' };
    }
    await FS.deleteAsync(tmpUri, { idempotent: true });
  } else {
    await FS.moveAsync({ from: tmpUri, to: finalUri });
  }   // capture is now PREPARED

  // Canonical request payload + digest over the exact stored bytes.
  const payloadJson = JSON.stringify({
    v: 1, capture_id: captureId, attachment_id: attachmentId, mutation_id: mutationId,
    project_id: opts.projectId, owner_id: opts.ownerId,
    media_sha256: mediaSha256, media_bytes: mediaBytes, media_mime_type: opts.input.mimeType,
    modality: opts.input.modality,
    captured_at_ms: capturedAtMs,
    // MANDATE #9 travels with the capture. Part of the payload hash, so a stamp
    // cannot be altered in the outbox without the server refusing the replay.
    gps_lat: opts.stamp?.lat ?? null,
    gps_lng: opts.stamp?.lng ?? null,
    gps_accuracy_m: opts.stamp?.accuracyM ?? null,
    gps_fix_age_ms: opts.stamp?.fixAgeMs ?? null,
    stamp_status: opts.stamp?.status ?? 'unavailable',
  });
  const requestSha256 = await sha256Hex(new Uint8Array(Buffer.from(payloadJson, 'utf8')));

  // Step 8 — THE SINGLE COMMIT POINT.
  try {
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO capture_commit (capture_id, attachment_id, mutation_id, project_id, owner_id,
           media_relpath, media_sha256, media_bytes, media_mime_type, modality,
           captured_at_ms, committed_at_ms, request_sha256,
           gps_lat, gps_lng, gps_accuracy_m, gps_fix_age_ms, stamp_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [captureId, attachmentId, mutationId, opts.projectId, opts.ownerId,
         mediaRelpath, mediaSha256, mediaBytes, opts.input.mimeType, opts.input.modality,
         capturedAtMs, Date.now(), requestSha256,
         opts.stamp?.lat ?? null, opts.stamp?.lng ?? null,
         opts.stamp?.accuracyM ?? null, opts.stamp?.fixAgeMs ?? null,
         opts.stamp?.status ?? 'unavailable']
      );

      await tx.execute(
        `INSERT INTO capture_outbox (mutation_id, capture_id, operation, payload_json,
           payload_sha256, queued_at_ms, attempt_count, next_attempt_at_ms)
         VALUES (?,?,'capture.create.v1',?,?,?,0,0)`,
        [mutationId, captureId, payloadJson, requestSha256, Date.now()]
      );
    });
  } catch (e: any) {
    return { ok: false, reason: `commit failed: ${e?.message ?? e}` };
  }

  // Step 9 — ONLY NOW.
  savedEvents.push({ captureId, atMs: Date.now() });

  return { ok: true, captureId };
}

// ---------------------------------------------------------------- read path

/** Spec §5. Resolves EXCLUSIVELY through capture_commit. */
/**
 * REQ-EVID2: "a capture is findable BY JOB and recency".
 *
 * This listed EVERY capture on the device regardless of job -- fine when there was
 * one hardcoded project, wrong the moment projects became real: a contractor on the
 * Elm St job would see the Oak Ave photos and have no way to tell which was which.
 *
 * Reads through capture_resolution: if a human filed an unresolved capture, that
 * override decides where it shows. The original project_id stays untouched --
 * capture_commit is append-only, and the device's belief at capture time is a fact
 * we keep, not a mistake we erase.
 */
export async function listCommittedCaptures(db: AbstractPowerSyncDatabase, projectId?: string) {
  return db.getAll<{ capture_id: string; media_relpath: string; media_sha256: string;
                     media_bytes: number; modality: string; media_mime_type: string;
                     gps_lat: number | null; gps_lng: number | null; stamp_status: string | null }>(
    `SELECT c.capture_id, c.media_relpath, c.media_sha256, c.media_bytes, c.media_mime_type,
            c.gps_lat, c.gps_lng, c.stamp_status,
            -- pre-migration rows have no modality and CANNOT be backfilled
            -- (append-only). Derive for display; never invent it in the record.
            COALESCE(c.modality,
              CASE WHEN c.media_mime_type LIKE 'text/%'  THEN 'text'
                   WHEN c.media_mime_type LIKE 'audio/%' THEN 'voice'
                   WHEN c.media_mime_type LIKE 'image/%' THEN 'photo'
                   WHEN c.media_mime_type LIKE 'video/%' THEN 'video'
                   ELSE 'unknown' END) AS modality
     FROM capture_commit c
     WHERE ? IS NULL OR COALESCE(
             (SELECT r.project_id FROM capture_resolution r WHERE r.capture_id = c.capture_id),
             c.project_id) = ?
     ORDER BY committed_at_ms DESC`,
    [projectId ?? null, projectId ?? null]
  );
}

export type ExportResult =
  | { ok: true; length: number; sha256: string; destination: string }
  | { ok: false; reason: 'NOT_COMMITTED' | 'MEDIA_UNAVAILABLE' | 'INTEGRITY_ERROR'; detail?: string };

/**
 * Spec §5 acceptance predicate. Resolves via capture_commit ONLY, streams the
 * source, RECOMPUTES length + SHA-256 before reporting success, copies to the
 * destination, returns the recomputed values.
 */
export async function exportCapture(
  db: AbstractPowerSyncDatabase,
  captureId: string,
  destination: string
): Promise<ExportResult> {
  const rows = await db.getAll<{ media_relpath: string; media_sha256: string; media_bytes: number }>(
    `SELECT media_relpath, media_sha256, media_bytes FROM capture_commit WHERE capture_id = ?`,
    [captureId]
  );
  if (rows.length !== 1) return { ok: false, reason: 'NOT_COMMITTED' };

  const src = FS.documentDirectory + rows[0].media_relpath;
  const info = await FS.getInfoAsync(src);
  if (!info.exists) return { ok: false, reason: 'MEDIA_UNAVAILABLE' };

  const { hex, bytes } = await hashFileFromDisk(src);
  if (hex !== rows[0].media_sha256 || bytes !== rows[0].media_bytes) {
    return { ok: false, reason: 'INTEGRITY_ERROR', detail: `disk=${hex}/${bytes} row=${rows[0].media_sha256}/${rows[0].media_bytes}` };
  }
  await FS.copyAsync({ from: src, to: destination });
  return { ok: true, length: bytes, sha256: hex, destination };
}

// ---------------------------------------------------------------- recovery

/** Spec §4. Small, because Codex cut the rest. */
export async function recoverySweep(db: AbstractPowerSyncDatabase): Promise<{
  tmpDeleted: number; orphansDeleted: number; integrityErrors: string[];
}> {
  let tmpDeleted = 0, orphansDeleted = 0;
  const integrityErrors: string[] = [];

  // Temp file, no commitment -> delete.
  for (const f of await FS.readDirectoryAsync(TMP_DIR).catch(() => [] as string[])) {
    await FS.deleteAsync(TMP_DIR + f, { idempotent: true }); tmpDeleted++;
  }

  // Installed final file with no commitment referencing it -> orphan, delete.
  const committed = await db.getAll<{ media_relpath: string }>(`SELECT media_relpath FROM capture_commit`);
  const keep = new Set(committed.map((c) => c.media_relpath));
  for (const dir of await FS.readDirectoryAsync(MEDIA_DIR).catch(() => [] as string[])) {
    for (const f of await FS.readDirectoryAsync(MEDIA_DIR + dir).catch(() => [] as string[])) {
      if (!keep.has(`capture-media/${dir}/${f}`)) {
        await FS.deleteAsync(`${MEDIA_DIR}${dir}/${f}`, { idempotent: true }); orphansDeleted++;
      }
    }
  }

  // Commitment with missing/mismatched media -> stays visible, flagged. Never hidden.
  for (const c of await listCommittedCaptures(db)) {
    const src = FS.documentDirectory + c.media_relpath;
    const info = await FS.getInfoAsync(src);
    if (!info.exists) { integrityErrors.push(c.capture_id); continue; }
    const { hex, bytes } = await hashFileFromDisk(src);
    if (hex !== c.media_sha256 || bytes !== c.media_bytes) integrityErrors.push(c.capture_id);
  }
  return { tmpDeleted, orphansDeleted, integrityErrors };
}


/**
 * Read one capture back for viewing — REQ-EVID1: "raw capture + stamp is retained
 * and VIEWABLE without any handler applied ... standing on its own for
 * inspectors/peers."
 *
 * THE HASH IS RECOMPUTED FROM THE BYTES ON DISK, not compared to a stored copy of
 * itself. A stored-hash-to-stored-hash compare proves only that we can read our own
 * database; recomputing proves the FILE has not rotted or been swapped. Codex #9
 * named the former as a false-pass, and it is exactly the check an inspector's
 * question ("how do you know this is the original photo?") turns on.
 */
export async function readCapture(db: AbstractPowerSyncDatabase, captureId: string): Promise<
  | { ok: true; uri: string; mime: string; modality: string; bytes: number;
      sha256: string; intact: boolean; text?: string;
      capturedAtMs: number; lat: number | null; lng: number | null; stampStatus: string | null }
  | { ok: false; reason: string }
> {
  const r = (await db.getAll<{
    media_relpath: string; media_sha256: string; media_bytes: number; media_mime_type: string;
    modality: string | null; captured_at_ms: number; gps_lat: number | null;
    gps_lng: number | null; stamp_status: string | null;
  }>(
    `SELECT media_relpath, media_sha256, media_bytes, media_mime_type, modality,
            captured_at_ms, gps_lat, gps_lng, stamp_status
       FROM capture_commit WHERE capture_id = ?`, [captureId]))[0];
  if (!r) return { ok: false, reason: 'no such capture' };

  const uri = FS.documentDirectory + r.media_relpath;
  try {
    const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
    const bytes = Buffer.from(b64, 'base64');
    // Recomputed. See the note above.
    const actual = sha256(bytes);
    return {
      ok: true, uri, mime: r.media_mime_type,
      modality: r.modality ?? 'unknown', bytes: r.media_bytes,
      sha256: r.media_sha256, intact: actual === r.media_sha256,
      text: r.media_mime_type.startsWith('text/') ? bytes.toString('utf8') : undefined,
      capturedAtMs: r.captured_at_ms, lat: r.gps_lat, lng: r.gps_lng,
      stampStatus: r.stamp_status,
    };
  } catch (e: any) {
    // The row says it exists and the file does not. That is a REAL failure and it
    // must be shown, not swallowed: it is the loss mandate #1 forbids, and the one
    // moment the user needs to know is before they rely on it in a dispute.
    return { ok: false, reason: `media unreadable: ${e?.message ?? String(e)}` };
  }
}
