# Critic Review #6 — Codex adversarial pre-code pass (DB + runtime + owned-queue durability)

> **Provenance.** Cross-model adversarial review run per `docs/CODEX-REVIEW-06-PROMPT.md` and `CLAUDE.md §4` (Layer-2 cross-model critic). This is a **real cross-model check** (not a same-model stand-in).
>
> - **Tool:** OpenAI Codex CLI v0.144.4 (`codex exec`), sandbox `read-only`, approval `never`.
> - **Model:** `gpt-5.6-sol` at reasoning effort **high**. *(The prompt named `gpt-5-codex`; that model is not present in this Codex install — available models are gpt-5.4/5.5 and gpt-5.6-luna/sol/terra — so per the prompt's "adjust the model name to your installed version" instruction, the Codex default flagship `gpt-5.6-sol` was used.)*
> - **Auth:** API key (`preferred_auth_method=apikey`). The initial run hung indefinitely in `chatgpt` token-auth mode; forcing API-key auth resolved it.
> - **Docs reviewed:** SPIKE-A-BUILD-PLAN.md, ARCHITECTURE.md (ADR-2/ADR-5/§3.1/§3.2), IMPLEMENTATION_NOTES.md, SPEC-capture-core-v1.md (REQ-CAP4/5/6/8, REQ-PROC4/6), CRITIC-REVIEW-05-CODEX-CODE.md, VERIFICATION_PLAN.md.
> - **Findings:** 8 Critical (C1–C8), 12 High (H1–H12), 4 Medium (M1–M4).
> - **Tokens used:** 130,852.
>
> **Next step (the gate):** reconcile each finding — adopt / dispute-with-reason / defer — and log in `IMPLEMENTATION_NOTES §4`; apply doc fixes to SPIKE-A-BUILD-PLAN.md / ARCHITECTURE.md; **only then** start Spike A M0.

---

# Adversarial verdict

The locked design is not ready to build. It can produce a convincing demo and a green Spike A report while still losing real captures.

The central defect is that the documents treat four different durability events—journal commit, media-file commit, queue insertion, and server receipt—as though they were one atomic “local save.” They are not. No cross-resource commit protocol is specified.

## Critical findings

### C1 — “Saved ✓” can fire before the capture is recoverably committed

**Scenario:** Recording stops. The recorder callback returns, and A1.3 marks the journal complete and confirms “saved.” But one of these is still true:

- The codec/container footer remains buffered.
- File data has not been `fsync`ed.
- The directory entry has not been persisted.
- The `Capture` or `Attachment` row has not committed.
- The upload-queue entry has not committed.

A kill or power loss then leaves a completed journal pointing at a truncated file, or a valid file with no queue intent. The plan explicitly says to mark the journal complete and confirm in A1.3, while the queue is not built until A2.1. That creates the exact acknowledgement gap the design claims to eliminate. [A1.3](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPIKE-A-BUILD-PLAN.md:71>) [A2.1](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPIKE-A-BUILD-PLAN.md:79>)

**Fix:** Define a real recovery protocol:

1. Reserve storage.
2. Commit `STARTED` journal state before arming the recorder.
3. Write encrypted temporary media chunks with sequence numbers and hashes.
4. Close/finalize the container; flush and `fsync` the file and parent directory.
5. Verify it is decodable and its duration/hash is credible.
6. In one SQLite transaction, create `Capture`, `Attachment`, and outbound mutation records and advance the journal to `MEDIA_COMMITTED`.
7. Only then emit “saved ✓.”

Because the filesystem and SQLite cannot share a transaction, use an idempotent recovery state machine plus a durable sidecar manifest. Never use a boolean `complete`.

### C2 — “Never lose a capture” is impossible under the stated fault model

**Scenario:** The only SQLite database is corrupted, or its SQLCipher key is lost, while the unsynced media and its recovery metadata exist only on that device. The journal is in the same failure domain as the queue. There is nothing from which to recover.

Similarly, if storage is already full, the requirement that capture is “never blocked” cannot coexist with durable recording. [REQ-PROC6](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPEC-capture-core-v1.md:133>) demands that more capture is always allowed, while the gate explicitly injects storage-full failure. [Spike fault suite](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPIKE-A-BUILD-PLAN.md:92>)

**Fix:** Replace the absolute guarantee with a defensible invariant:

> Never acknowledge a capture unless a verified recoverable copy and durable recovery intent exist. Refuse to start loudly when capacity cannot be reserved.

Maintain an emergency disk reserve, enforce offline queue quotas, and preserve rebuildable per-capture manifests outside the database. State explicitly that total device loss, app-data deletion, key loss, and correlated filesystem destruction remain residual loss boundaries.

### C3 — The encrypted-media and background-upload designs contradict each other

**Scenario:** SQLCipher protects SQLite, not the audio/video files referenced by `durable_local_uri`. A0.3 tests only the database file, while REQ-CAP4 requires the capture itself to stream to encrypted storage. [A0.3](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPIKE-A-BUILD-PLAN.md:63>) [REQ-CAP4](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPEC-capture-core-v1.md:99>)

If media is separately encrypted:

- iOS `URLSession`/Android background work needs access to the ciphertext or a plaintext staging file.
- Uploading ciphertext is incompatible with the current server flow, which expects plaintext quarantine input and performs server-side encryption.
- Decrypting to a temporary plaintext file violates encrypted-at-rest.
- Reading the decryption key while the phone is locked may fail. Expo SecureStore defaults to `WHEN_UNLOCKED`; its own documentation warns not to use it as the sole source of truth for irreplaceable data. [Expo SecureStore](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/)

The assertion that the key is “never in JS” is also incompatible with Expo SQLite’s documented `PRAGMA key = 'password'` JavaScript interface. SQLCipher additionally requires a native prebuild and is unavailable in Expo Go. [Expo SQLite SQLCipher documentation](https://docs.expo.dev/versions/latest/sdk/sqlite/)

**Fix:** Choose and spike one explicit end-to-end media-encryption scheme:

- Native streaming encryption with per-capture keys.
- Ciphertext uploaded unchanged.
- Capture keys wrapped for both the device and server ingest identity.
- Server decrypts/re-encrypts without plaintext persistent staging.
- Key accessibility explicitly supports approved locked-device background behavior.

Otherwise admit that media relies only on OS file protection and revise REQ-CAP4.

### C4 — Mid-push idempotency is not specified strongly enough to prevent loss or duplication

**Scenario:** The server commits a capture, but the Edge Function dies before returning. The device retries. “An idempotency key” does not solve this unless:

- The key is stable across retries.
- It is scoped to tenant, device, and immutable mutation.
- The receipt and domain mutation commit in the same Postgres transaction.
- The stored response can be replayed.
- Unique constraints enforce the invariant.

A separate idempotency insert followed by a capture insert can suppress a mutation that never committed. The reverse ordering can duplicate it.

The same ambiguity exists between object upload and attachment-row push. A kill after object completion but before local state update may create an orphan or a second upload. Supabase TUS gives every upload a distinct URL, expires URLs after 24 hours, and returns conflicts for concurrent uploads; `upsert` can instead make last-writer-win overwrite the object. [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)

**Fix:** Use immutable deterministic object keys based on tenant/capture/asset IDs, never overwrite media, and implement:

- Stable mutation IDs generated at local commit.
- One server transaction for idempotency receipt plus domain writes.
- Per-mutation results for partial batches.
- A server finalize operation that verifies object existence, size, and checksum before atomically linking the attachment.
- Explicit crash tests before commit, after commit, and before response delivery.

### C5 — The pull design is not a sync protocol

**Scenario:** `GET /sync/pull` returns an Active-plus-last-N-days working set. While it is paginated, another device edits or archives rows. Pages are now from different snapshots. Records may be missed or duplicated. An archived or deleted row disappearing from the result is indistinguishable from “not included in this window.”

Worse, a pull can overwrite unsynced local mutations with older server state. No base-state/pending-overlay model, server sequence, checkpoint, deletion tombstone, or cursor contract is specified. [Owned pull description](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/ARCHITECTURE.md:67>)

**Fix:** Specify:

- Server-assigned monotonically increasing change sequence.
- Consistent high-watermark checkpoint.
- Stable keyset pagination.
- Tombstones for deletes, merges, revocations, and window exits.
- Separate server base state from pending local mutations.
- Per-row versions and preconditions.
- A protocol for resnapshotting without discarding pending work.

Do not use client timestamps as ordering authority; `client_created_at` is subject to clock skew.

### C6 — “Raw video is never stored” makes video crash recovery impossible

**Scenario:** A video must exist somewhere before audio and still extraction can finish. If the app dies during recording or extraction:

- Discarding the raw temporary file loses the capture.
- Keeping it contradicts “raw video is never stored.”
- Marking save before extraction completes acknowledges evidence that does not yet exist.
- Deleting raw video after audio but before stills commit produces a partial capture.

This directly conflicts with REQ-CAP6’s mid-video recovery promise. [REQ-CAP6](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPEC-capture-core-v1.md:103>) [REQ-TL4](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPEC-capture-core-v1.md:117>)

**Fix:** Permit an encrypted, journaled temporary raw-video asset. Retain it until all derived assets are finalized, verified, and atomically registered. Then delete it using a recoverable cleanup state. The wording should be “never retained or uploaded after successful extraction,” not “never stored.”

### C7 — MF-2’s “one predicate” is fictitious

**Scenario:** Shared Hono middleware cannot literally be the same implementation as Postgres RLS. One is TypeScript; the other is SQL. “Calls or is generated from it” is not a design.

The middleware can also be bypassed through:

- Direct PostgREST access.
- Storage/TUS PUTs after issuance.
- A route mounted before middleware.
- A separate Edge Function entrypoint.
- Next.js endpoints.
- Durable-job callbacks and webhook handlers.
- R2 Worker media reads.
- DB RPC functions.
- Service-role code, which bypasses RLS.
- A presigned capability that remains valid after membership revocation.

Checking top-level `org_id` is insufficient: nested `project_id`, `capture_id`, attachment IDs, and object keys can reference another tenant. [Authorization paths](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/ARCHITECTURE.md:76>)

**Fix:** Build an action/resource authorization model, not a membership boolean. Derive tenant identity server-side and validate every referenced resource. Put the canonical authorization functions in Postgres so RLS and service-role API code call the same database functions. Add a generated policy matrix and negative contract tests for every transport path, including direct PostgREST and Storage access. Middleware remains a convenience layer, not the root of trust.

### C8 — The Edge-to-durable-job handoff has a dual-write loss window

**Scenario:** `/sync/push` commits the capture and attachment row, then the Edge Function is killed before it starts the durable job. The capture remains permanently unprocessed. Reversing the order can start a job before the attachment exists.

“Pipeline in durable jobs” does not make the trigger durable. [ADR-5](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/ARCHITECTURE.md:159>) [Attachment trigger requirement](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/ARCHITECTURE.md:216>)

**Fix:** Insert a transactional outbox event in the same Postgres transaction that finalizes the attachment. A durable dispatcher claims outbox rows with leases and retries delivery. Jobs use `(capture_id, content_version)` idempotency. Add an orphan sweeper for objects-without-rows, rows-without-objects, and finalized attachments without jobs.

## High-severity findings

### H1 — Deferring PowerSync is based on a false dichotomy

The ezQuotePro lesson proves that recording must commit locally before networking. It does **not** prove that a solo developer should hand-build relational synchronization.

PowerSync currently documents:

- Persisted client mutation queues.
- Ordered upload behavior.
- Consistent server checkpoints across tables.
- Causal+ consistency.
- Retry and stalled-queue behavior.
- An attachment queue with an atomic model-update hook and verification/recovery.

It still leaves semantic conflict resolution and backend idempotency to the application, so it is not magic. But those are a much smaller surface than also building oplog ordering, checkpointed pulls, local overlays, tombstones, and queue scheduling. [PowerSync consistency](https://docs.powersync.com/architecture/consistency) [PowerSync attachment queue](https://docs.powersync.com/client-sdks/advanced/attachments)

The current attachment documentation also does not present the feature as experimental, making the locked rationale at least stale.

**Fix:** Use a hybrid:

- Own the native capture journal and media-finalization transaction.
- Evaluate PowerSync for relational synchronization and its current attachment machinery.
- If PowerSync is rejected, limit P1 sync to append-only immutable capture receipts. Do not claim a generic two-way pull/push/merge engine is “simple.”

### H2 — Queue worker concurrency and retry behavior are unspecified

**Scenario:** Foreground reconnect logic, iOS background transfer callbacks, and Android WorkManager all drain the same queue. Two workers upload the same object or push the same batch. A 409 or expired token causes immediate retries. Hundreds of queued items wake simultaneously after reconnect and create a retry storm.

One malformed or schema-incompatible mutation can either block everything forever or be skipped out of order.

**Fix:** Persist worker leases, attempt counts, retry deadlines, and ownership epochs. Use exponential backoff with jitter, `Retry-After`, concurrency limits, dependency-aware scheduling, and a server-visible dead-letter state. Test foreground/background races and connectivity flapping.

### H3 — SQLCipher key loss can silently turn recovery into data deletion

**Scenario:** Android restores the database but not the SecureStore key; Expo explicitly excludes SecureStore data from backup because restored values cannot be decrypted. On iOS, migration depends on the selected Keychain accessibility class. The app sees a missing key and generates a new one, opening a new empty database while the real captures remain inaccessible. [Expo backup behavior](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/)

**Fix:** If a database exists and its key is absent or invalid, enter a hard recovery state—never initialize over it. Decide whether unsynced captures are:

- Deliberately device-bound and unrecoverable after migration, or
- Recoverable through a user/cloud-wrapped recovery key.

Test uninstall/reinstall, device transfer, backup restore, biometric changes, passcode changes, app upgrade, and interrupted key rotation.

### H4 — Database-corruption recovery is not designed

**Scenario:** Corrupting a live SQLCipher page or WAL page containing `capture_journal` makes the journal, capture metadata, and queue inaccessible together. The audio file may still exist, but the app cannot identify its owner, key, project, or upload intent.

**Fix:** Store a minimal authenticated sidecar manifest per capture, use content-addressable asset names, run integrity checks at startup, maintain safe database backups, and implement index reconstruction from manifests. Define exactly what “DB corruption” means; arbitrary corruption of every copy cannot have a zero-loss guarantee.

### H5 — Edge Functions are acceptable only after the sync request is made small and restartable

Cold starts and worker termination are normal. Supabase explicitly advises short-lived idempotent operations and moving heavy work to background workers. Hosted limits include 256 MB memory, 150/400-second worker duration, two seconds CPU per request, and a 150-second request idle timeout. [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits) [Edge Function guidance](https://supabase.com/docs/guides/functions)

**Scenario:** A large pull serializes thousands of rows through zod, exceeds CPU/memory, and restarts from page one. Or a large push partially writes before the HTTP connection disappears.

**Fix:** Enforce small bounded batches, stable cursors, short database transactions, streamed responses where appropriate, and client retries from persisted checkpoints. Prefer Postgres RPC/stored transactions for mutation application. “Hono can move to Node with no rewrite” is not credible once Deno environment APIs, Supabase bindings, deployment configuration, and background semantics are embedded.

### H6 — Supabase Storage and R2 are not an isolated swap

Spike A uses Supabase Storage while production architecture points at R2. Supabase resumability uses TUS; R2 normally implies S3 multipart state. Authorization, URL expiry, part receipts, checksums, background-client support, quarantine ingest, and completion semantics all differ. [Spike storage choice](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPIKE-A-BUILD-PLAN.md:49>)

**Fix:** Lock the P1 storage provider before the durability exit gate, or execute the complete fault suite against both. The abstraction must cover issuance, resume tokens, part state, checksum verification, abort, finalize, and orphan cleanup—not merely `put()`.

### H7 — Account changes can leak or strand queued captures

**Scenario:** Tenant A has unsynced captures. The user logs out and signs into Tenant B, or is removed from A before reconnect. A generic queue drainer might push A’s object under B’s credentials, leak it, purge it on logout, or leave it permanently stuck.

**Fix:** Bind every database, media key, queue entry, and mutation to immutable account and tenant identities. Suspend rather than delete unauthorized pending entries. Specify recovery/export/reassignment policy for revoked users. Test logout, user switch, token refresh, membership removal, and device sharing.

### H8 — Idempotent delivery and semantic deduplication are conflated

Replaying the same mutation must deduplicate by mutation identity. Two separately created projects that look similar are a semantic merge problem. Address/geofence/time clustering can merge two legitimate jobs at the same building. [REQ-PROC7](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPEC-capture-core-v1.md:136>)

**Fix:** Never semantically deduplicate immutable captures. For project merges, use tenant-scoped candidates, explicit confirmation, an alias/tombstone map, transactional child repointing, and losing-device reconciliation. Captures arriving later against the losing project ID must resolve through that alias.

### H9 — The Spike A gate can certify a broken design

The gate has multiple “ALL TESTS PASSED” escape hatches:

- A journal row can exist while audio is zero-byte, undecodable, truncated, or missing its tail.
- A hard kill is allowed as a proxy for power loss even though the OS remains alive and may flush buffers.
- “DB corruption” can target an unused page.
- Storage-full injection can occur after finalize rather than at each write boundary.
- One round-trip is accepted even though REQ-PROC4 requires 100 offline/online cycles. [Spike exit](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPIKE-A-BUILD-PLAN.md:110>) [REQ-PROC4](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPEC-capture-core-v1.md:129>)
- Voice-only success greenlights work toward modalities with different failure behavior.
- A test-only queue can pass without proving the shipping entrypoint actually uses it—the precise ezQuotePro failure. [ezQuotePro lesson](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/CRITIC-REVIEW-05-CODEX-CODE.md:11>)

**Fix:** Use release builds and production entrypoints. Add deterministic crash hooks after every state transition plus randomized kill tests. The oracle must validate expected audio sample count/duration, decoding, hashes, database state, queue state, remote object, and server receipt.

### H10 — The statistical gate has no acceptable target

The plan says to run enough trials for “the confidence you want” and gives `0/50 ≈ <6% at 95%` as an example. A six-percent possible loss rate is catastrophic, not an honest durability gate. [Exit criterion](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPIKE-A-BUILD-PLAN.md:106>)

**Fix:** Predeclare a maximum acceptable loss probability and confidence separately for each fault and platform. Roughly 30,000 independent zero-failure trials are needed to bound a failure probability below `10^-4` at 95% confidence. Automated failpoint tests can provide volume; physical-device tests establish platform realism. Do not pool heterogeneous faults into one flattering N.

### H11 — Important fault classes are absent

Add at least:

- Server commit followed by lost HTTP response.
- Object complete but attachment transaction absent, and vice versa.
- Signed/TUS URL expiry.
- Auth-token expiry during upload and push.
- Wi-Fi-to-cell transition with cellular consent off.
- Captive portal and false-positive reachability.
- 401, 409, 413, 429, 5xx, timeout, malformed partial response.
- Two simultaneous queue drainers.
- App upgrade and kill during SQLite migration.
- Old-client mutation against new schema.
- Key loss, wrong key, interrupted rekey.
- Media corruption after “saved.”
- OS purge of a wrongly placed cache file.
- Queue backlog exhausting storage days later.
- Device clock moving backward/forward.
- User logout, user switch, membership revocation.
- Merge racing a new child mutation.
- Server outage long enough for credentials/resume sessions to expire.
- Microphone interruption, route change, permission revocation, and phone call during recording.

### H12 — The build sequence bakes in unproven assumptions

The plan builds schema before defining the sync protocol, implements confirmation before queue creation, and builds the fault harness after the implementation. Full authorization is deferred even though service-role endpoints become reachable during the spike. [Task order](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPIKE-A-BUILD-PLAN.md:54>) [Auth scope deferral](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPIKE-A-BUILD-PLAN.md:31>)

There are also unresolved contradictions:

- Implementation notes say queue-vs-PowerSync should be settled by spike evidence, but another entry locks the queue before that evidence. [Locked DB](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/IMPLEMENTATION_NOTES.md:51>) [Evidence settlement](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/IMPLEMENTATION_NOTES.md:77>)
- The spec still requires a PowerSync-backed feed despite PowerSync being deferred. [REQ-PM-D](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPEC-capture-core-v1.md:202>)
- `REQ-PROC1` says keyframe extraction happens online, while `REQ-TL4` says it happens on-device. [REQ-PROC1](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPEC-capture-core-v1.md:123>)
- Implementation notes call the runtime decision ADR-4, while Architecture calls it ADR-5.
- `op-sqlite` versus `expo-sqlite` remains undecided despite the database implementation being described as locked.

**Fix:** Before coding, write the capture commit state machine, sync wire protocol, authorization matrix, storage protocol, key-lifecycle policy, and failpoint model. Then derive schema and tests from those invariants. Run a small PowerSync-versus-owned relational-sync bakeoff before locking ADR-2.

## Medium-severity findings

### M1 — A0.3 proves almost nothing about encryption

A non-SQLite-looking header does not prove:

- The correct key is required.
- WAL, SHM, temporary files, sidecars, backups, and media contain no plaintext.
- Page authentication detects tampering.
- Key deletion makes the data unavailable.
- A release build uses SQLCipher on both platforms.
- Upgrade/rekey works.

**Fix:** Scan all sandbox artifacts for known plaintext, attempt wrong-key opens, inspect WAL/temp files, corrupt authenticated pages, test release binaries, and verify key-loss behavior.

### M2 — Performance is part of durability but is not gated

SQLCipher, frequent durable commits, chunk encryption, JS/native bridging, and checksums can cause recorder underruns or make the one-action start exceed one second—especially on low-end Android devices and during WAL checkpoints.

**Fix:** Gate start latency, sustained write throughput, dropped audio frames, battery use, database growth, and long-recording finalize time on representative low-end hardware while background uploads are active.

### M3 — Queue retention and garbage collection have no safety rule

There is no defined point at which local media may be deleted. “Uploaded” might mean the transfer callback fired, not that the object checksum and server attachment receipt are durable. Conversely, never deleting media allows an offline backlog to fill the device.

**Fix:** Delete only after verified immutable object receipt plus server linkage, subject to retention policy. Use two-phase garbage collection, local leases, minimum free-space thresholds, and an audit trail.

### M4 — The status language overstates safety

“Saved locally ✓” is honest only about a single-device copy. It is not safe from theft, device failure, app deletion, key loss, or unrecoverable corruption. The current one-status requirement may hide that distinction.

**Fix:** Use one primary state that remains explicit: “Saved on this phone—not backed up yet,” then “Backed up.” Do not display `ready` in the spike through a no-op processing state; that falsely verifies a production transition that does not exist.

## Required pre-code gate

Do not begin A0.2 schema implementation until these artifacts exist:

1. Capture/file/SQLite commit state machine.
2. Formal push/pull protocol with checkpoints, tombstones, versions, and transaction boundaries.
3. Stable mutation/object identity and server receipt rules.
4. Media encryption and key recovery/background-access decision.
5. Full action/resource authorization matrix.
6. Transactional outbox design.
7. Locked storage provider and resumable protocol.
8. Deterministic failpoint matrix with strict integrity oracles and a predeclared statistical target.
9. PowerSync hybrid bakeoff or an explicit P1 restriction to append-only sync.

**Single most likely reason this fails in the field:** the app will display “saved ✓” after a SQLite state change while the media file or outbound queue intent is still not durably committed, reproducing ezQuotePro’s silent-loss failure behind a newer, more elaborate queue.
