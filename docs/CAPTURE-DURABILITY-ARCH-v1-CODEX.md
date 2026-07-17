# Capture Durability Architecture v1 — AUTHORED BY CODEX (#14)

> **Provenance.** `codex exec`, `gpt-5.6-sol` @ high, read-only. Requested via `docs/CODEX-14-SPEC-REQUEST.txt` under the ownership split agreed in `CODEX-13-ARCHITECTURE-DECISION.md`: **Codex architects, Claude implements.**
>
> **This supersedes DURABILITY-DESIGN-v1 Artifact 1 (v1/v2/v3 — all Claude-authored, all rejected).** Claude does not redefine the safety model here. Deviations must be raised with Codex, not decided unilaterally.
>
> **Commitment authority:** `capture_commit`. One row = committed. No boolean, no mutable state. Media, `capture_outbox`, `ps_crud`, and PowerSync projections mean **nothing** about commitment.
>
> **Scope of the harness Claude is building now: K0–K7 (the capture-boundary suite, networking + outbox drainer disabled).** That is the subset that settles blocker 2 locally. K8/K9, the PowerSync-reversion fault, `disconnectAndClear()`, and the upload-rejection fault require the delivery path (server RPC + uploader) that does not exist yet — **they are NOT built and NOT run.** Recorded so this is not later mistaken for the full 260-trial suite.

---

## 1. `CaptureCommit` + outbox schema

Use a dedicated app-owned SQLite connection to the same database file as PowerSync. Enable foreign keys on every app-owned connection.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE capture_commit (
    capture_id         TEXT    NOT NULL PRIMARY KEY,
    attachment_id      TEXT    NOT NULL UNIQUE,
    mutation_id        TEXT    NOT NULL UNIQUE,
    project_id         TEXT    NOT NULL,
    owner_id           TEXT    NOT NULL,

    media_relpath      TEXT    NOT NULL UNIQUE,
    media_sha256       TEXT    NOT NULL
        CHECK (
            length(media_sha256) = 64
            AND media_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
    media_bytes        INTEGER NOT NULL CHECK (media_bytes > 0),
    media_mime_type    TEXT    NOT NULL CHECK (length(media_mime_type) > 0),

    captured_at_ms     INTEGER NOT NULL CHECK (captured_at_ms > 0),
    committed_at_ms    INTEGER NOT NULL CHECK (committed_at_ms >= captured_at_ms),

    request_sha256     TEXT    NOT NULL
        CHECK (
            length(request_sha256) = 64
            AND request_sha256 NOT GLOB '*[^0-9a-f]*'
        ),

    UNIQUE (mutation_id, capture_id, request_sha256)
) STRICT;

CREATE TRIGGER capture_commit_no_update
BEFORE UPDATE ON capture_commit
BEGIN
    SELECT RAISE(ABORT, 'capture_commit is append-only');
END;

CREATE TRIGGER capture_commit_no_delete
BEFORE DELETE ON capture_commit
BEGIN
    SELECT RAISE(ABORT, 'capture_commit is append-only');
END;

CREATE TABLE capture_outbox (
    mutation_id        TEXT    NOT NULL PRIMARY KEY,
    capture_id         TEXT    NOT NULL UNIQUE,

    operation          TEXT    NOT NULL
        CHECK (operation = 'capture.create.v1'),
    payload_json       TEXT    NOT NULL CHECK (json_valid(payload_json)),
    payload_sha256     TEXT    NOT NULL
        CHECK (
            length(payload_sha256) = 64
            AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
        ),

    queued_at_ms       INTEGER NOT NULL CHECK (queued_at_ms > 0),
    attempt_count      INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_attempt_at_ms INTEGER,
    next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
    last_error_code    TEXT,
    last_error_text    TEXT,

    FOREIGN KEY (mutation_id, capture_id, payload_sha256)
        REFERENCES capture_commit (mutation_id, capture_id, request_sha256)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
) STRICT;

CREATE INDEX capture_outbox_due
    ON capture_outbox (next_attempt_at_ms, queued_at_ms);
```

`payload_json` is the byte-exact UTF-8 request body for schema version 1. Compute both `payload_sha256` and `request_sha256` from those exact stored bytes.

The commitment authority is `capture_commit`.

This predicate alone means “capture X is committed”:

```sql
SELECT 1
FROM capture_commit
WHERE capture_id = ?;
```

One returned row means committed. No row means not committed. There is no commitment boolean or mutable commitment state.

Neither the media file, `capture_outbox`, `ps_crud`, nor any PowerSync-managed `capture`/`attachment` row means committed.

PowerSync must not:

- Declare either local table in `AppSchema`.
- Install managed-table or CRUD triggers on them.
- include them in Sync Streams or sync rules.
- upload, replace, update, delete, truncate, or recreate them.
- remove them during reconnection, projection refresh, or `disconnectAndClear()`.
- delete or replace the shared database file during a PowerSync reset.

If the exact adapter’s reset cannot preserve these tables, use a separate app-owned SQLite ledger.

## 2. Minimal state machine

| State | Durable contents | UI |
|---|---|---|
| `RECORDING` | No durability claim. A capture-specific temp file may contain bytes. No `capture_commit` row. | `Recording…` |
| `PREPARED` | Finalized, validated, SHA-256-hashed media installed under `capture-media/<capture_id>/<attachment_id>.<ext>` with durable no-replace installation. No `capture_commit` row. | `Saving…` |
| `COMMITTED` | Installed media plus exactly one `capture_commit` row. The initial commit also has exactly one matching `capture_outbox` row. | `Saved on this phone` |

Outbox presence is delivery status, not a capture state:

- Outbox present: `Waiting to back up` or `Backup failed — retrying`.
- Outbox absent and a server projection is present: `Backed up`.
- PowerSync projection absent: no change to the local `COMMITTED` state.

The only transition after which `Saved` may be emitted is:

```text
PREPARED
  -- SQLite COMMIT returns successfully under the asserted durability profile -->
COMMITTED
```

## 3. Commit sequence

Required SQLite readbacks on every connection that can write or checkpoint:

```text
PRAGMA journal_mode;             == wal
PRAGMA synchronous;              == 2       -- FULL
PRAGMA fullfsync;                 == 1
PRAGMA checkpoint_fullfsync;      == 1
PRAGMA wal_autocheckpoint;        == 1000
PRAGMA foreign_keys;              == 1
```

If any readback fails, do not arm the recorder.

1. Mint `capture_id`, `attachment_id`, and `mutation_id`. Create the byte-exact `payload_json` and its SHA-256 in memory.

2. Record into a unique temp path under `capture-tmp/`. No durability claim is made while recording.

3. Stop the recorder, write the container footer, and freeze the writer.

4. On the temp media descriptor:

   ```text
   fcntl(fd, F_FULLFSYNC) == 0
   ```

   Then close the writer. This is the finalized-file barrier.

5. Reopen read-only. Stream the entire file once:

   - Validate that it is decodable.
   - Compute `media_bytes`.
   - Compute lowercase SHA-256.
   - Reject zero-length, truncated, or invalid media.

   Close the descriptor.

6. Assert temp and destination are on the same filesystem. Install using no-replace semantics:

   ```text
   renameatx_np(..., RENAME_EXCL)
   ```

   If the destination already exists, require an independently recomputed byte length and SHA-256 match; never overwrite it.

7. Durably install the directory entry:

   ```text
   fsync(source_directory_fd) == 0
   fsync(destination_directory_fd) == 0
   open final media read-only
   fcntl(final_media_fd, F_FULLFSYNC) == 0
   close final media
   ```

   The capture is now `PREPARED`.

8. On the asserted app-owned SQLite connection:

   ```sql
   BEGIN IMMEDIATE;

   INSERT INTO capture_commit (...);

   INSERT INTO capture_outbox (
       mutation_id,
       capture_id,
       operation,
       payload_json,
       payload_sha256,
       queued_at_ms,
       attempt_count,
       next_attempt_at_ms
   ) VALUES (?, ?, 'capture.create.v1', ?, ?, ?, 0, 0);

   COMMIT;
   ```

   The successful return from this `COMMIT` is the single commit point. SQLite supplies the transaction barrier through `synchronous=FULL`, `fullfsync=ON`, and the Apple VFS.

9. Only after step 8 returns, emit the `saved` event and render `Saved on this phone`.

10. Outbox delivery:

    - Upload media to a deterministic, create-only object key.
    - Verify the uploaded bytes’ length and SHA-256.
    - Call one atomic Postgres RPC for the Capture and Attachment rows.
    - Key the RPC by `mutation_id`.
    - Same `mutation_id` plus same payload digest returns the original success.
    - Same `mutation_id` plus a different digest returns conflict.
    - Delete `capture_outbox` in a SQLite transaction only after the atomic RPC succeeds.
    - Any timeout or rejection leaves the outbox row present.

## 4. Recovery rules

| Wake-up contents | Recovery |
|---|---|
| Temp file; no `capture_commit` | Delete the temp file. Show no saved capture. |
| Installed final file; no `capture_commit` references its path | Delete the orphan after checking that no commitment references it. Show no saved capture. |
| Half-executed commitment transaction | SQLite rolls it back. Treat the installed file as an orphan and delete it. |
| `capture_commit` plus matching outbox | Verify media path, byte length, and SHA-256. List as `Saved on this phone`; resume idempotent delivery. |
| `capture_commit` without outbox | Verify media and list as `Saved on this phone`. Treat delivery as completed; do not reconstruct an outbox from a PowerSync projection. |
| `capture_commit` with missing or mismatched media | Keep the commitment visible and show `Saved item unavailable — local media integrity error`. Do not silently hide or delete the commitment. |
| PowerSync projection missing, reverted, or cleared | Ignore for commitment. Rebuild the local saved-capture view from `capture_commit`. |
| PowerSync projection present without `capture_commit` | It is remote/projected data, not a locally committed capture. Do not report it as locally saved. |

## 5. Harness oracle

### Kill boundaries

Run the capture-boundary suite with networking and the outbox drainer disabled through `K7`.

Each failpoint must pause the capture thread, publish `{trialNonce, captureId, boundary}`, and wait. The harness must observe that exact tuple before executing `simctl terminate`.

| Boundary | Pause location | Required assertions after a proven new boot |
|---|---|---|
| `K0_FINAL_BYTES_WRITTEN` | Footer written, before `F_FULLFSYNC` | `capture_commit=0`; `capture_outbox=0`; no pre-kill `saved` event; recovery removes temp/final files; export returns `NOT_COMMITTED`. |
| `K1_FILE_BARRIER_RETURNED` | Media `F_FULLFSYNC` returned, before hash pass | Same assertions as K0. |
| `K2_HASH_VERIFIED` | Full-file validation/hash completed, before install | Same assertions as K0. |
| `K3_MEDIA_INSTALLED` | Rename and directory barriers returned, before `BEGIN IMMEDIATE` | `capture_commit=0`; `capture_outbox=0`; no pre-kill `saved`; orphan final file is removed; export returns `NOT_COMMITTED`. |
| `K4_COMMIT_ROW_INSERTED` | `capture_commit` inserted inside the open transaction | After restart both tables contain zero matching rows; no pre-kill `saved`; orphan media is removed; export returns `NOT_COMMITTED`. |
| `K5_OUTBOX_ROW_INSERTED` | Both rows inserted, before SQLite `COMMIT` | Same assertions as K4. |
| `K6_SQLITE_COMMIT_RETURNED` | SQLite `COMMIT` returned, before emitting `saved` | Exactly one commitment and one outbox row; no pre-kill `saved`; recovery lists the capture as saved; export length and hash match the independent fixture oracle. |
| `K7_SAVED_EMITTED` | Harness has observed the matching `saved` event | Exactly one commitment and one outbox row; `saved` was observed before termination; recovery lists it; export length and hash match. |
| `K8_SERVER_ACCEPTED` | Atomic server RPC succeeded, before local outbox deletion | Immediately after restart with uploader paused: commitment=1, outbox=1, server mutation=1, Capture=1, Attachment=1. After resuming: outbox=0; all server counts remain 1; downloaded server media hash/length and local export hash/length match the fixture. |
| `K9_OUTBOX_DELETE_COMMITTED` | Local outbox deletion transaction returned | Commitment=1; outbox=0; server mutation=1; Capture=1; Attachment=1; local export and downloaded server media match the fixture. |

For K4 and K5, querying both local tables must prove transaction atomicity:

```sql
SELECT
  (SELECT count(*) FROM capture_commit WHERE capture_id = ?) AS commits,
  (SELECT count(*) FROM capture_outbox WHERE capture_id = ?) AS outbox;
```

Only `(0,0)` is acceptable after rollback. For K6 and K7, only `(1,1)` is acceptable while the uploader remains paused.

### Acknowledged-capture acceptance predicate

The acknowledged set is every `capture_id` for which the harness observed a matching, nonce-bound `saved` event.

For every acknowledged ID, after every restart and injected fault:

```sql
SELECT
    capture_id,
    media_relpath,
    media_sha256,
    media_bytes
FROM capture_commit
WHERE capture_id = ?;
```

Must return exactly one row.

Then execute the app’s public operation:

```text
exportCapture(capture_id, destination)
```

That operation must:

1. Resolve the source exclusively through `capture_commit`.
2. Open and stream the source.
3. Recompute its length and SHA-256 before reporting success.
4. Copy it to the harness destination.
5. Return the recomputed length and SHA-256.

The harness independently reads the exported file and requires:

```text
exported_length == fixture_length
exported_sha256 == fixture_sha256
returned_length == fixture_length
returned_sha256 == fixture_sha256
```

The complete acceptance predicate is:

```text
For every observed saved event:
    one CaptureCommit exists
    AND listCommittedCaptures includes its capture_id
    AND exportCapture succeeds
    AND independently hashed exported bytes equal the original fixture
```

### PowerSync reversion fault

For each trial:

1. Commit and acknowledge a capture while keeping `capture_commit` and `capture_outbox` intact.
2. Through a test-only command, insert matching rows into the PowerSync-managed `capture` and `attachment` projections.
3. Confirm matching `ps_crud` entries exist.
4. Use the test connector to call `complete()` without sending those mutations to Postgres. Postgres must contain no matching Capture or Attachment.
5. Reconnect PowerSync and force a checkpoint advancement using a server-side marker mutation in the same bucket.
6. Wait until both managed projection rows disappear locally.

Required assertions:

```text
PowerSync capture projection count == 0
PowerSync attachment projection count == 0
capture_commit count == 1
capture_outbox count == 1
listCommittedCaptures includes capture_id
exportCapture hash and length match the fixture
```

Also run the exact adapter reset used by the application:

```text
await db.disconnectAndClear()
reinitialize the same database
```

After reset, the two PowerSync projections may be absent, but both app-owned table definitions, triggers, commitment row, outbox row, and exportable media must remain. Any removal of an app-owned object is FAIL and requires the separate-ledger fallback.

### Upload rejection fault

Before delivery, insert the trial’s `mutation_id` into a test-only server fault table. The atomic capture RPC must check that table and raise SQLSTATE `23514` before inserting Capture or Attachment rows. This must be a real server rejection returned through Supabase, not a client-side mock.

Required assertions after the matching rejection is observed:

```text
server Capture count == 0
server Attachment count == 0
server mutation-success count == 0
capture_commit count == 1
capture_outbox count == 1
capture_outbox.attempt_count >= 1
capture_outbox.last_error_code == "23514"
listCommittedCaptures includes capture_id
exportCapture hash and length match the fixture
```

Remove the fault and retry. Required final assertions:

```text
capture_outbox count == 0
server mutation count == 1
server Capture count == 1
server Attachment count == 1
local export and downloaded server object match the fixture
```

### VOID versus FAIL

A trial is VOID only when:

- The harness never observed the matching `{trialNonce, captureId, boundary}` and therefore did not inject the declared kill.
- The simulator, Supabase, PowerSync Cloud, or `psql` was unavailable before the product operation began.
- The app installation, database, fixture, credentials, or server schema changed during the trial.
- The upload-rejection rule was not armed for the matching `mutation_id`.
- A new process was not proven because `simctl` failed to terminate or launch it.

A trial is FAIL when:

- The matching boundary was reached and any required assertion is false or times out.
- The app crashes, hangs, refuses the capture, or reaches the wrong state after valid preconditions.
- A transaction exposes `(1,0)` or `(0,1)`.
- An acknowledged capture cannot be listed or exported.
- Exported bytes differ.
- PowerSync modifies or removes an app-owned table or commitment.
- A rejected upload removes the outbox.
- An idempotent retry creates duplicate server rows.

Failed trials remain failures; do not rerun them away. Replace only VOID trials and report every VOID reason.

### Trial count

Predeclare:

- 20 valid trials for each of K0–K9: 200.
- 20 valid PowerSync-reversion trials.
- 20 valid `disconnectAndClear()` trials.
- 20 valid upload-rejection/retry trials.

Total: 260 valid trials, plus separately reported VOID trials.

This count bounds only executions of these named mechanisms against the exact tested app, adapter versions, simulator runtime, schema, and services. It does not establish a loss-rate bound, confidence interval, MTBF, or production failure probability.

## 6. What the harness explicitly does not prove

- Sudden-power-loss durability.
- Real-device storage-cache behavior or that `F_FULLFSYNC` reached physical media.
- APFS behavior on physical iPhone hardware.
- Jetsam, watchdog termination, kernel panic, device reset, or battery removal.
- Device loss, theft, app uninstall, container deletion, or device restore.
- Catastrophic SQLite loss, corruption, WAL corruption, or encryption-key loss.
- Recovery if PowerSync deletes the shared database file; that result forces the separate-ledger fallback.
- Disk-full, quota exhaustion, inode exhaustion, or storage-pressure eviction.
- Permission revocation, locked-device file protection, or inaccessible protected files.
- Bit rot or post-commit external modification/deletion of media.
- Simultaneous recorders, multi-process writers, or high-contention SQLite behavior.
- Real microphone capture, codec behavior across devices, long recordings, or media-memory limits.
- Background recording, suspension, or app-upgrade/migration behavior.
- Encryption, confidentiality, tamper resistance, or authenticated evidence.
- Server, Supabase Storage, PowerSync Cloud, or backup disaster durability.
- Cross-device media download, repair, retention, garbage collection, or offline export on another device.
- Every network/authentication failure class; only the declared rejection and retry paths are covered.
- Concurrent duplicate submissions; K8 proves restart retry idempotency, not simultaneous-request behavior.
- Compatibility with PowerSync, op-sqlite, Expo, SQLite, or iOS versions other than the exact recorded versions.
- Human-visible rendering correctness; the oracle observes the app’s nonce-bound `saved` event, not a screenshot.
- Any statistical production loss-rate claim.

Sudden-power-loss testing requires a physical iPhone, a release build, the production native SQLite/VFS configuration, and a controlled hardware-level abrupt-power test. It cannot be performed on the available simulator.
