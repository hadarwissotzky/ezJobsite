# Critic Review #8 — Codex narrow TEST-VALIDITY check on the sync bakeoff

> **Provenance.** Cross-model check run per `docs/CODEX-REVIEW-08-PROMPT.md` and `CLAUDE.md §4` (Layer-2 cross-model critic). Real cross-model check (not a same-model stand-in).
>
> - **Tool:** OpenAI Codex CLI v0.144.4 (`codex exec`), sandbox `read-only`, approval `never`, workdir `development/`.
> - **Model:** `gpt-5.6-sol` @ reasoning effort **high**. **Tokens used:** 35,103.
> - **Scope (deliberately narrow):** can `SPIKE-SYNC-BAKEOFF.md`'s tests **false-pass**? Not an architecture review. Codex stayed in scope — it raised no new architecture findings.
> - **Read:** SPIKE-SYNC-BAKEOFF.md (primary), CRITIC-REVIEW-07-CODEX.md, DURABILITY-DESIGN-v1.md.
> - **Run note:** the recorded command in the prompt file correctly passes the prompt as `"$(cat …)"` (the #6/#7 heredoc bug is fixed), but still pipes `2>&1 | tee`, which merges Codex's progress logs into the review file. This run used `2> <logfile> | tee` so the saved review is clean output only. Worth correcting in the prompt file.
>
> **Verdict: every question Q1–Q7 could FALSE-PASS as written.** The bakeoff targets the right faults; its pass criteria are not operationally strict enough. Fixes are tightenings of test steps + assertions — **not** a redesign.
>
> **Next:** fold the Q1/Q3 fixes into `SPIKE-SYNC-BAKEOFF.md`, then build + run the bakeoff. (The non-optional Codex pass on the bakeoff *result* comes later, before flipping ADR-2.)

---

The bakeoff identifies the right faults, but its pass criteria are not operationally strict enough. Both Q1 and Q3 could currently false-pass. See [SPIKE-SYNC-BAKEOFF.md](/Volumes/Operational%20Disk/HiLo%20Venture%20Group/EZJobsite/development/docs/SPIKE-SYNC-BAKEOFF.md:21) and the original sequence failure in [CRITIC-REVIEW-07-CODEX.md](/Volumes/Operational%20Disk/HiLo%20Venture%20Group/EZJobsite/development/docs/CRITIC-REVIEW-07-CODEX.md:83).

## Q1 — Commit ordering

**Verdict: Could FALSE-PASS.** “Two concurrent writes where the lower-numbered transaction commits after the higher one” does not guarantee the device completed a checkpoint containing B before A committed.

Required deterministic procedure:

1. Start with a fully synchronized device and an empty test scope/bucket.
2. A control Postgres session acquires session advisory lock `K`.
3. Session A:

   - `BEGIN`
   - Insert capture A, explicitly obtaining `seq=10`.
   - Issue `pg_advisory_xact_lock(K)` asynchronously. It must block before `COMMIT`, leaving A open and invisible.

4. Assert from `pg_stat_activity` that A is still in its transaction and waiting on the advisory lock.
5. Session B independently inserts capture B with `seq=11` and commits.
6. From a third connection, assert B is visible and A is not.
7. Keep A blocked while the original device synchronizes. Record PowerSync diagnostics/status proving a **completed durable download checkpoint containing B**, not merely that a sync started. Assert locally: B exists, A does not. Restart the app without clearing its database and confirm that state persists.
8. Only then release advisory lock `K` and commit A. Assert A’s commit occurred after the device observation above.
9. On that same already-checkpointed device—without reset, resnapshot, reinstall, or database clearing—wait for synchronization and assert:

   - A appears with the exact ID and payload/hash.
   - A appears exactly once.
   - B remains unchanged.
   - Both rows exist in Postgres.
   - PowerSync returns to an idle/completed checkpoint state.

10. A fresh second client should also receive A, but only as a control proving eligibility/sync-rule inclusion. A fresh client cannot substitute for delivery to the original checkpointed device.
11. Repeat with unique IDs for a predeclared number of trials; every late A must arrive.

PowerSync may instead withhold B/checkpoint advancement while A is open. That is also a legitimate safe result, but it must be reported as **“unsafe checkpoint prevented,” not “late row delivered.”** Prove B was committed and replication was given adequate opportunity; after releasing A, both rows must arrive.

A real Q1 pass is therefore either:

- B is durably checkpointed first and late A subsequently reaches the same device; or
- PowerSync demonstrably refuses to advance that checkpoint until A resolves.

Merely committing B before A and eventually seeing both rows—especially after reset/resync—can false-pass.

## Q3 — Encrypted media

**Verdict: Could FALSE-PASS.** The current prose states the intended round trip but does not prove the production key path, absence of plaintext staging, or actual TUS resume.

A trustworthy oracle must assert all of the following:

- **Known source:** Generate/record the audio without creating a plaintext fixture file. Record its byte length, SHA-256, sample count/duration, and decodability before encryption.
- **Real path:** Device 1 uses the production capture encryption path, PowerSync attachment helper, and real `RemoteStorageAdapter`; no test-only copy or manual upload.
- **Ciphertext identity:** Hash ciphertext before handing it to the helper. The adapter request body, Supabase object, and Device 2 download must all have the identical ciphertext length and hash.
- **End-to-end plaintext identity:** Device 2’s decrypted bytes must exactly equal the original bytes—length, SHA-256, byte-for-byte comparison, and audio decode/sample count.
- **Key unwrap exercised:** Device 2 starts without the plaintext DEK. It receives the intended wrapped-key material and invokes the production unwrap path. Supplying a DEK directly from the harness invalidates the test. Wrong identity/key and modified wrapped-key metadata must fail authentication.
- **Authenticated encryption:** Corrupting ciphertext or authenticated metadata must make decryption fail, not produce unchecked output.
- **No plaintext staging:** After capture, upload, forced kill, relaunch, download, and cleanup, scan all app-controlled files, caches, temp/staging directories, SQLite content, logs, and crash artifacts for distinctive plaintext canaries/chunks. Only explicitly allowed in-memory recording buffers may contain plaintext. The storage object and captured upload body must contain ciphertext only.
- **Offline behavior:** While Device 1 is offline, no remote object/request exists; reconnect triggers the real queued upload.
- **Real resumability:** Use an object large enough to require multiple TUS requests and throttle/barrier the upload. Wait until the server reports `0 < committed offset < total size`, then externally terminate the process (`SIGKILL`/force-stop), not graceful cancellation.
- **Resume evidence:** After a cold production-build relaunch, the same persisted upload/session URL resumes from the prior nonzero server offset. Request logs must show continuation rather than a new upload starting at byte zero.
- **Post-resume outcome:** Exactly one finalized object and attachment linkage exist, with no duplicate finalized objects or orphan sessions, and the complete ciphertext/decryption assertions still pass.
- **Physical coverage:** Run the kill/resume and sandbox-leak checks independently on real iOS and Android devices.

Without those assertions, “decrypt succeeded” could conceal a direct test key, a plaintext staging file, or a complete restart mislabeled as resume.

## Other false-pass risks

- **Q2 — Could FALSE-PASS:** Sequential edits prove only happy-path propagation. Predeclare field ownership/convergence, hold an unsynced offline device edit while committing a conflicting server edit, then assert exact final Postgres and two-device values, preservation of the pending local edit, and no unauthorized client write to server-owned fields.
- **Q4 — Could FALSE-PASS:** “Sits cleanly above” is subjective. Exercise the actual local database integration with kills at verify/write/commit boundaries and assert no row before verified media, no “saved” before the complete local commit, and no saved capture lacking outbound intent.
- **Q5 — Could FALSE-PASS:** One foreground upload is insufficient. Require a release-build matrix on physical iOS/Android covering representative maximum files, background/locked operation, OS termination, retries, URL expiry, and declared acceptable failure/recovery behavior.
- **Q6 — Could FALSE-PASS:** “Fits our scale” has no scale or cost oracle. Fix workload assumptions and required features first, then compare Cloud and self-hosted all-in cost, licensing rights, HA/backup/monitoring, upgrades, and operator time.
- **Q7 — Could FALSE-PASS:** Active-row inclusion alone proves neither windowing nor revocation. Test active→archived/time-window exit→re-entry and revocation while offline; assert removal and later re-delivery where appropriate, local purge after revocation, queued writes remain blocked, and the revoked client cannot regain access.
