/**
 * The app-owned capture schema, and NOTHING else.
 *
 * Split out of capture.ts for one reason: capture.ts imports expo-file-system,
 * which Node cannot resolve, so any test that needed the real schema could not
 * load it and had to hand-write a copy instead. A hand-written copy is how my
 * first device test failed — it omitted two NOT NULL columns and reported a
 * delete bug that did not exist.
 *
 * ZERO IMPORTS is the property that matters here. Keep it that way.
 */
/**
 * The unresolved-capture sentinel. Defined HERE, in the zero-import module, because
 * both the commit path (capture.ts) and the filing path (projects.ts) must agree on
 * it and neither may import the other. `projects.ts` re-exports it, so every existing
 * `import { INBOX_ID } from './projects'` keeps working.
 *
 * There is deliberately no `project` row with this id, on device or on the server.
 */
export const INBOX_ID = 'inbox';

/**
 * The canonical upload payload. ONE definition, used by the commit path and by the
 * re-mint that happens when a human files an unresolved capture.
 *
 * It lives here, next to the DDL and with no imports, because the two callers live in
 * modules that cannot import each other — and a payload written twice is a payload
 * that drifts. The server's idempotency digest is taken over this exact string, so
 * key order is part of the contract: do not reorder.
 */
export function buildCapturePayload(f: {
  captureId: string; attachmentId: string; mutationId: string;
  projectId: string; ownerId: string;
  mediaSha256: string; mediaBytes: number; mediaMimeType: string;
  modality: string; capturedAtMs: number;
  gpsLat: number | null; gpsLng: number | null;
  gpsAccuracyM: number | null; gpsFixAgeMs: number | null;
  stampStatus: string;
}): string {
  return JSON.stringify({
    v: 1, capture_id: f.captureId, attachment_id: f.attachmentId, mutation_id: f.mutationId,
    project_id: f.projectId, owner_id: f.ownerId,
    media_sha256: f.mediaSha256, media_bytes: f.mediaBytes, media_mime_type: f.mediaMimeType,
    modality: f.modality,
    captured_at_ms: f.capturedAtMs,
    // MANDATE #9 travels with the capture. Part of the payload hash, so a stamp
    // cannot be altered in the outbox without the server refusing the replay.
    gps_lat: f.gpsLat, gps_lng: f.gpsLng,
    gps_accuracy_m: f.gpsAccuracyM, gps_fix_age_ms: f.gpsFixAgeMs,
    stamp_status: f.stampStatus,
  });
}

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
      -- REQ-CAP2: voice | photo | text (video deferred, hadar 2026-07-25). Part of
      -- the commitment record because a DB-loss rebuild must know WHAT was captured,
      -- not just that bytes existed. Existing installs keep their prior CHECK (this
      -- is CREATE TABLE IF NOT EXISTS); a legacy 'video' row is retained and never
      -- crashes — it still shows in the capture viewer (fallback icon), though it is
      -- no longer surfaced as a photo in an extra's record (record.ts is photo-only).
      modality        TEXT NOT NULL CHECK (modality IN ('voice','photo','text')),
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
  // 397 — THE DELIVERY RECEIPT (Codex review, 2026-08-07, P1).
  //
  // "Has the server got this?" had no durable answer. The absence of an outbox row was
  // used as the signal, disambiguated by `capture_commit.project_id` — but that column
  // is APPEND-ONLY and keeps its birth value forever, so a capture committed to the
  // Inbox reads as 'inbox' for the rest of its life even after it is filed and
  // delivered. Re-filing one therefore minted a second create mutation and parked it on
  // the server's capture-id duplicate constraint: the precise failure the guard existed
  // to prevent, still firing for exactly the captures it was written for.
  //
  // A receipt states the fact directly instead of inferring it from two columns that
  // were never meant to answer it. Written when the RPC succeeds, in the same
  // transaction that removes the intent.
  `CREATE TABLE IF NOT EXISTS capture_delivered (
      capture_id TEXT NOT NULL PRIMARY KEY,
      at_ms      INTEGER NOT NULL
   ) STRICT`,

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
      -- NARROWED 2026-07-27 (hadar). This was
      --   FOREIGN KEY (mutation_id, capture_id, payload_sha256)
      --     REFERENCES capture_commit (mutation_id, capture_id, request_sha256)
      -- which welded TRANSPORT to the COMMITMENT RECORD. capture_commit is append-only
      -- and capture_id is its primary key, so that digest can never be superseded —
      -- and the digest is taken over a payload containing the project_id known at
      -- capture time. A capture committed to the Inbox therefore had its destination
      -- frozen BEFORE the human filed it, could never satisfy the server's
      -- capture_project_id_fkey (there is no 'inbox' project row), and retried until
      -- the end of time. Observed on device 2026-07-27: nothing uploaded for two days.
      --
      -- capture_id alone keeps the property this FK actually exists for — the outbox
      -- can never reference evidence that was not committed — while letting the queue
      -- be re-minted, which is what "the outbox is transport" has always claimed.
      -- The original mutation_id and digest stay in capture_commit as the historical
      -- record of what was promised; they are simply no longer a cage.
      FOREIGN KEY (capture_id) REFERENCES capture_commit (capture_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS capture_outbox_due
     ON capture_outbox (next_attempt_at_ms, queued_at_ms)`,
];

/**
 * Migrate an EXISTING capture_outbox from the composite FK to the narrow one.
 *
 * SQLite cannot ALTER a foreign key, so the table is rebuilt. This is the one place
 * in the app where pending uploads pass through a copy, and losing a row here would
 * be exactly the unforgivable outcome — so it runs inside a single transaction, the
 * copy is verified by COUNT before the old table is dropped, and the whole thing is
 * skipped unless the old FK is actually present.
 *
 * `PRAGMA foreign_keys` must be off around a table rebuild or the child rows are
 * cascaded/rejected mid-swap; SQLite ignores the pragma inside a transaction, so it
 * is set by the caller before BEGIN. See `migrateOutboxFk()` in capture.ts.
 */
export const OUTBOX_FK_MIGRATION = [
  `CREATE TABLE capture_outbox_new (
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
      FOREIGN KEY (capture_id) REFERENCES capture_commit (capture_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
   ) STRICT`,
  `INSERT INTO capture_outbox_new
     SELECT mutation_id, capture_id, operation, payload_json, payload_sha256,
            queued_at_ms, attempt_count, last_attempt_at_ms, next_attempt_at_ms,
            last_error_code, last_error_text
     FROM capture_outbox`,
  `DROP TABLE capture_outbox`,
  `ALTER TABLE capture_outbox_new RENAME TO capture_outbox`,
  `CREATE INDEX IF NOT EXISTS capture_outbox_due
     ON capture_outbox (next_attempt_at_ms, queued_at_ms)`,
];
