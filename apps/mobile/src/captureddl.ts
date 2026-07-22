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
