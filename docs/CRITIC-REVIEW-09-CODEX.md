# Critic Review #9 — Codex pass on the BAKEOFF CONCLUSION (the mandatory ADR-2 gate)

> **Provenance.** Cross-model check per `docs/CODEX-REVIEW-09-PROMPT.md`, `SPIKE-SYNC-BAKEOFF.md:118`, and `CLAUDE.md §4` (Layer-2 cross-model critic). **Real cross-model check** — not a same-model stand-in.
>
> - **Tool:** OpenAI Codex CLI v0.144.4 (`codex exec`), sandbox `read-only`, approval `never`, workdir `development/`.
> - **Model:** `gpt-5.6-sol` @ reasoning effort **high**. (`gpt-5-codex` does not exist in this install; #6–#9 all ran `gpt-5.6-sol`.)
> - **Auth note:** `~/.codex/auth.json` has `auth_mode = chatgpt`, which ignores `$OPENAI_API_KEY` and hangs indefinitely. Forced `-c preferred_auth_method="apikey"`.
> - **Scope (deliberately different from #8):** #8 audited the bakeoff's *test design*. **#9 audits the run that actually happened** — whether the recorded evidence supports the claimed verdicts. **The harness source was in scope and Codex read it.**
> - **Read:** BAKEOFF-RESULT.md · BAKEOFF-PREDECLARATION.md · SPIKE-SYNC-BAKEOFF.md · CRITIC-REVIEW-08-CODEX.md · spike/harness/{q1,q2,common}.py · spike/sql/*.sql · spike/app-src/* · spike/out/{q1,q2}.json · powersync/*.yaml
> - **Findings:** 3 CRITICAL · 12 HIGH · 5 MEDIUM.
>
> ## Verdict: BOTH CLAIMED PASSES REJECTED
> - **Q1 "VALID PASS" survives: NO**
> - **Q2 "VALID PASS" survives: NO**
> - **Fit to support an ADR-2 decision: NO**
> - **Required action:** freeze a corrected harness in Git, **rerun Q1 and Q2**, then complete Q3 and the decision-critical parts of Q5–Q7.
>
> **Independently verified by the author before publishing this file:** finding "the published assertion trail uses an unlisted smoke run" is **CONFIRMED**. `BAKEOFF-RESULT.md` cites `spike/out/q1.json` but its `last_op 2 → 3 → 4`, PIDs `{34436,34437,34438,34439}`, and `20:13:04 / 20:13:08 / +4.2s` timestamps are all from `q1-smoke.json` (the 1-trial smoke run). The real 20-trial artifact starts at `13 → 14 → 15` with different PIDs and timestamps. **The evidence trail did not come from the run it claims to describe.**
>
> **Next:** reconcile every finding in `IMPLEMENTATION_NOTES §4` (☑-only-when-the-edit-exists). **ADR-2 stays where it is.**

---

# Verdict

This is not fabricated evidence, but it is a false-pass write-up. The observed behavior is encouraging; the labels “VALID PASS,” “structurally impossible,” “blockers dissolved,” and “decisively wins” are not supported by the executable assertions.

- **Q1 “VALID PASS” survives: NO.**
- **Q2 “VALID PASS” survives: NO.**
- **Fit to support ADR-2: NO.**
- **Required action: freeze a corrected harness in Git, rerun Q1 and Q2, then complete Q3 and the decision-critical parts of Q5–Q7.**

## Q1 — mandatory 11-step audit

| Step | Implemented? | Defect |
|---|---:|---|
| 1. Fully synced, empty scope | **No** | Server tables are cleared once, but the harness only tests `connected && !downloading`; it never asserts `hasSynced`, an empty local capture set, or completion of the purge. Trials then accumulate in one device DB and bucket. [q1.py:98](spike/harness/q1.py:98>) |
| 2. Control takes lock K | **Yes** | Implemented directly. |
| 3. A inserts lower seq and blocks | **Yes, narrowly** | It obtains the next sequence value rather than literal 10, but establishes `seq_a < seq_b`. |
| 4. Assert A waiting | **Yes** | `pg_stat_activity` checks advisory-lock wait. |
| 5. B independently commits | **Yes** | Separate autocommit backend, with four distinct PIDs asserted. |
| 6. B visible, A invisible | **Yes** | Correct third-connection visibility check. |
| 7. Durable checkpoint containing B; restart | **No** | B is observed, but checkpoint advancement is only recorded—not asserted. The restart check can consume the old, already-existing `status.json`; it does not require a new boot ID or timestamp. |
| 8. A commits after observation | **Yes** | Advisory-lock causality establishes this without `track_commit_timestamp`. |
| 9. Exact A/B, once, unchanged, idle | **Partial** | It compares the copied `payload_sha256` column but never reads the payload or recomputes its hash. “Exactly once” is inferred from a PK-materialized view, not delivery events. B’s payload is not checked. |
| 10. Fresh-client control | **No** | `q1.py` accepts only one UDID. The claimed second-client result exists only in prose, with no raw artifact. |
| 11. Predeclared independent trials | **Partial/No** | IDs are unique, so an old row cannot directly satisfy a new trial. But the trials share the same app DB, process lineage, service, bucket history, and growing dataset; they are not independent. |

Because the bakeoff says **all steps are required**, Q1 cannot be called a valid pass.

### CRITICAL — Q1’s restart assertion can false-pass

After `simctl terminate` and `launch`, the harness waits merely for `status.json` to exist. It already existed before termination, so this succeeds even if the relaunched app never opens SQLite or immediately crashes. [common.py:86](spike/harness/common.py:86>) [q1.py:189](spike/harness/q1.py:189>)

`simctl terminate` is adequate for the written Q1 requirement of an ordinary app restart; it need not be SIGKILL. The defect is that the harness never proves that the new process produced the post-restart observation.

**Fix:** Generate a random `boot_id` at process start and a monotonic status sequence. After launch, require a different `boot_id`, a newer timestamp, successful DB initialization, and a fresh query returning B but not A. For stronger crash evidence, add an external SIGKILL variant.

### HIGH — `last_op` is mislabeled as a completed checkpoint

`ps_buckets.last_op` is a per-bucket operation cursor, not the global checkpoint-complete message. PowerSync’s protocol separates downloaded data operations from “checkpoint complete,” and its client architecture says `ps_oplog` may be newer than the materialized data table until a full checkpoint is applied. [PowerSync protocol](https://docs.powersync.com/architecture/powersync-protocol) [PowerSync client architecture](https://docs.powersync.com/architecture/client-architecture)

B appearing in the materialized `capture` view is therefore meaningful evidence that a checkpoint was applied. But the harness:

- Reads bucket state and captures in separate queries, not one read transaction.
- Never asserts `last_op > checkpoint_before`.
- Does not bind the observed row to a named checkpoint-complete event/checksum.
- Does not cold-read it successfully after restart.

The 500 ms JSON loop probably cannot read an uncommitted SQLite transaction, but it can publish a stale or cross-checkpoint mixture. It is not a sound durable-checkpoint oracle as written.

**Fix:** Capture the SDK checkpoint-complete event or diagnostics checkpoint ID/checksum; read the relevant bucket and rows in one SQLite transaction; assert advancement; persist the observation; then verify it from a new process boot.

### HIGH — the exact-payload assertion is absent

The app selects `payload_sha256`, not `payload`. The harness checks whether the hash column equals the server-supplied hash column. A transport that corrupted `payload` but preserved `payload_sha256` would pass. [App.tsx:81](spike/app-src/App.tsx:81>) [q1.py:236](spike/harness/q1.py:236>)

**Fix:** Return payload bytes/text from the device, recompute SHA-256 independently, and compare exact content for both A and B.

### HIGH — the published assertion trail uses an unlisted smoke run

`BAKEOFF-RESULT.md` cites `q1.json`, but its `last_op 2 → 3 → 4`, PID mapping, and example timestamps come from `q1-smoke.json`. The actual 20-trial artifact begins at `13 → 14 → 15`. [BAKEOFF-RESULT.md:37](docs/BAKEOFF-RESULT.md:37>)

The smoke file is not named among the result’s raw artifacts.

**Fix:** Report examples from the final run, or explicitly include the smoke file with its purpose, hash, and non-counting status.

## Q1 mechanism claim

### HIGH — the PostgreSQL explanation is half-right and overstated

For ordinary logical decoding, the core statement is correct: concurrent transactions are decoded in commit order, and only safely flushed transactions are decoded. [PostgreSQL logical decoding](https://www.postgresql.org/docs/17/logicaldecoding-output-plugin.html)

But this sentence is not universally true:

> “A transaction’s changes aren’t decoded until it commits.”

It is false under enabled streaming of large in-progress transactions. PostgreSQL can emit transaction blocks before commit, followed later by Stream Commit or Stream Abort. PostgreSQL still promises commit-order application, but that requires the consumer to buffer and publish correctly. [PostgreSQL streaming transactions](https://www.postgresql.org/docs/16/logicaldecoding-streaming.html)

Conditions the bakeoff did not exercise include:

- **In-progress streaming:** A large A can be emitted before it commits. PowerSync must not assign externally visible bucket history incorrectly.
- **Parallel protocol/apply:** Protocol v4 can support parallel handling; PowerSync’s bucket-storage sequencing remains an implementation property.
- **Two-phase decoding:** With two-phase enabled, changes may be decoded at `PREPARE TRANSACTION`, before `COMMIT PREPARED`. [PostgreSQL two-phase decoding](https://www.postgresql.org/docs/17/logicaldecoding-output-plugin.html)
- **PowerSync op assignment:** PostgreSQL commit ordering does not itself prove that PowerSync assigns and durably stores bucket op IDs atomically in that order.
- **Compaction:** PowerSync may add MOVE/CLEAR operations. This preserves intended semantics but makes “one source row got exactly the next op ID” an unsafe general model. [PowerSync compaction](https://docs.powersync.com/maintenance-ops/compacting-buckets)
- **Initial snapshot/CDC transition, service crash, slot restart, and bucket-storage failure:** none were tested.
- **Nontransactional logical messages:** these are not commit ordered, though they do not directly undermine this row-insert case.
- **Subtransactions:** normally folded into the top-level transaction; not a counterexample, but still absent from the test.

Thus the narrow result is: *one-row ordinary transactions were delivered in the observed commit order*. “Structurally impossible” is not established.

**Fix:** Force a transaction above `logical_decoding_work_mem`, verify the slot options, test multirow/subtransaction and supported 2PC paths, inject service/bucket-storage restarts, and inspect PowerSync’s op-assignment transaction boundary.

### MEDIUM — the 25-second window can misclassify mechanism (b)

Once B is observed while A remains locked, mechanism (a) is real; making the window longer would not reverse that observation. But a shorter window could label the same system as mechanism (b). Worse, the `(b)` branch treats “B absent for 25 seconds” as proof that PowerSync withheld the checkpoint, without showing source CDC position, bucket ingestion, or ordinary replication latency. [q1.py:163](spike/harness/q1.py:163>)

`ARRIVAL_TIMEOUT=90` likewise proves only eventual arrival within that limit.

**Fix:** Establish a baseline latency bound, record B’s commit LSN and PowerSync ingestion/checkpoint diagnostics, and classify (b) only when the system demonstrably crossed B’s source position while refusing the client checkpoint.

### MEDIUM — the seq control proves the precondition, not the old fault

`seq_a < seq_b` proves the counter inversion existed. PowerSync ignores `seq`, so it does not prove that the hand-built cursor would actually advance past B and miss A. It is a useful counterfactual marker, not an end-to-end negative control.

**Fix:** Run the old `WHERE seq > cursor` consumer beside PowerSync and assert that it misses A under the identical schedule.

## Q1’s N=20 framing

### HIGH — the disclaimer is mathematically honest but operationally used as a shield

The rule-of-three figure is numerically correct for independent Bernoulli trials. These trials are correlated and share state, so even the `<14%` statement is not justified without an independence assumption.

More importantly, 20 repetitions of the same one-row branch cannot establish a structural property. Either:

- the mechanism follows from a reviewed invariant/contract plus targeted branch tests, or
- it remains an empirical reliability claim requiring varied faults and much larger coverage.

The write-up disclaims a rate claim, then uses “structurally impossible,” “dissolved,” and “decisively wins” to obtain the same decision effect.

**Fix:** Retain N=20 as a narrow regression test, remove statistical language, and support structural claims with implementation/contract analysis plus distinct branch and fault coverage.

## Q2

### HIGH — the 42501 is real evidence, but its attribution is not robust

The connector does not fabricate 42501. It calls Supabase/PostgREST, sees `result.error.code`, records it, and only then discards the CRUD operation by completing the transaction. If the database allowed the update, the current code would update PostgreSQL and would not record 42501. [connector.ts:45](spike/app-src/connector.ts:45>)

So this does prove a database-boundary refusal in the observed run. Catching and discarding the operation does not erase that fact.

But the harness does not baseline or clear `connector.rejected`. Any earlier 42501 in the same app lifetime satisfies the assertion; the record contains no row ID, field, request ID, or timestamp. [q2.py:147](spike/harness/q2.py:147>)

It proves the custom connector’s ACL-and-discard policy, not that PowerSync supplies safe rejection handling. PowerSync explicitly leaves asynchronous validation and discard policy to the application. [PowerSync consistency guidance](https://docs.powersync.com/architecture/consistency)

**Fix:** Record the baseline rejection count, include CRUD transaction ID/row ID/field/timestamp, require a newly added matching rejection, and retain server-side request/audit evidence.

### HIGH — the required server-owned convergence assertion is missing

The predeclaration says the device must converge back to the server value after its unauthorized local edit. The harness checks only:

- PostgreSQL stayed `captured`.
- Some 42501 exists.

It never asserts that Device 1’s local `processing_state` returns from `processed` to `captured`. Yet the result claims a measured “silent revert.” [BAKEOFF-PREDECLARATION.md:65](docs/BAKEOFF-PREDECLARATION.md:65>) [q2.py:139](spike/harness/q2.py:139>)

**Fix:** After the new matching rejection and queue drain, require a later completed checkpoint and assert both devices show the authoritative server value.

### HIGH — the “conflict” test is a single favorable upload ordering

The server commits `overridden`; only afterward is the offline client reconnected and allowed to upload `resolved`. PostgreSQL’s final value being the last request to arrive is expected regardless of sophisticated sync behavior. What the test usefully shows is that the offline CRUD entry survived and was uploaded.

It does not test:

- Download-before-upload versus upload-before-download schedules.
- Simultaneous writes from two devices.
- A server edit after the client upload.
- Delete-versus-update.
- Retry after backend commit but before `tx.complete()`.
- App death while the edit is queued.
- Multi-op transaction atomicity.

The server-conflict value is recorded, but not included as a failing Boolean assertion.

**Fix:** Predeclare and test a schedule matrix with barriers and server versions/commit IDs; repeat each schedule; inject retries and process death.

### MEDIUM — the two devices are separate stores but not separate actors

The two simulator containers are independent SQLite databases, so literal same-user multi-device convergence is valid. But both use the same compiled `EXPO_PUBLIC_DEVICE` and Supabase identity in this run. That does not test two crew members, membership rules, cross-user visibility, or revocation.

**Fix:** Build/run distinct principals, assert their JWT subjects in raw evidence, and use a shared project membership model rather than `owner_id = auth.uid()`.

### MEDIUM — one trial is insufficient for the concurrency claim

The tightened bar omitted an N, but this path contains multiple asynchronous races. One schedule occurrence is a smoke test, not a valid general convergence result.

**Q2 bottom line: NO.** The offline queue behavior and database ACL are useful observations, but the predeclared convergence rule is not fully asserted.

## Predeclaration provenance

### CRITICAL — it was not tamper-evident

Both `docs/BAKEOFF-PREDECLARATION.md` and `docs/BAKEOFF-RESULT.md` are untracked. So are the harnesses and raw artifacts. `git log` contains no predeclaration commit.

Filesystem birth times suggest the predeclaration file existed before the final run, but they do not prove its contents were frozen. More damagingly, `q1-smoke.json` predates the current `q1.py` modification by roughly one minute. The harness was modified after an outcome had already been observed, with no diff showing what changed.

**Fix:** Commit the predeclaration, harness, client, SQL, config, and dependencies before any smoke run. Record the commit hash in immutable run metadata; archive stdout/stderr and SHA-256 hashes of all artifacts.

### MEDIUM — the wrong mechanism prediction was handled correctly, but not investigated adequately

Recording “prediction falsified” is the right handling. A wrong prediction does not automatically invalidate an experiment.

The prediction confused `restart_lsn`—the oldest WAL that may need retention—with `confirmed_flush_lsn`—what the consumer has confirmed receiving. An open transaction may pin retained WAL without preventing later committed transactions from being consumed. [PostgreSQL replication-slot fields](https://www.postgresql.org/docs/17/view-pg-replication-slots.html)

That misunderstanding should have triggered a documented mechanism investigation and expanded tests. Instead, the result jumps to “better outcome” and universal structural immunity.

## Q3

### HIGH — “unmeetable by PowerSync” is false

The stock helper does not provide built-in TUS state or a resume-offset API. That finding is correct.

But `uploadFile(fileData: ArrayBuffer, attachment)` does not prevent a custom adapter from:

1. Looking up a persisted TUS session by attachment ID.
2. Querying its server offset.
3. Uploading `fileData.slice(offset)` in chunks.
4. Persisting the new offset/session externally.
5. Returning immediately if the upload already finalized.

PowerSync explicitly makes `RemoteStorageAdapter` application-defined. [PowerSync attachments](https://docs.powersync.com/client-sdks/advanced/attachments)

Therefore the honest claim is:

> “PowerSync has no built-in resumable uploader; resumability requires custom adapter code and remains untested.”

It is meetable within the PowerSync attachment interface, although PowerSync would not be buying that capability. The whole-file `ArrayBuffer` also creates an untested mobile memory risk.

**Fix:** Run stock behavior, then implement the smallest persisted TUS adapter and execute the mandated kill/resume oracle. Do not label feasibility from API shape alone.

## Q4–Q7 and the decision language

### CRITICAL — “not decidable” and “decisively wins” are not coherent here

“NOT YET DECIDABLE” follows the declared gate. But “PowerSync decisively wins the sync-transport argument,” “two blockers dissolved,” and “structural immunity” perform the adoption decision rhetorically while disclaiming it procedurally. [BAKEOFF-RESULT.md:196](docs/BAKEOFF-RESULT.md:196>)

Given the failed Q1/Q2 assertion trails and untested Q7 revocation, those statements must be removed.

**Fix:** Replace them with: “The simulator smoke tests produced encouraging behavior for one commit-ordering schedule and one offline-upload schedule; no adoption conclusion follows yet.”

### HIGH — secondary evidence is upgraded beyond its artifacts

- **Q4:** “Untestable” is too strong. It is **unimplemented/blocked by an unfinished candidate protocol**, which is exactly the design risk Q4 was meant to expose.
- **Q5:** No release matrix was run. Two findings are documentation review; the auto-detect crash has no preserved runtime log; the only build log preserved is the unrelated path-with-spaces failure.
- **Q6:** There is no preserved `powersync validate`, DNS, slot, pricing, licensing, or cost-model output. Q1 does indirectly prove the configured cloud service could replicate from the source, but not the full Q6 oracle.
- **Q7:** There is no Q7 harness or raw artifact. The 41→1→41 counts exist only in prose. Time-window exit/re-entry and revocation were not run. It is not a “PARTIAL PASS”; it is an unsupported active-filter smoke observation plus an API limitation. PowerSync’s official guidance confirms server-side time functions are unavailable but documents workarounds using maintained flags/ranges. [PowerSync time-based sync](https://docs.powersync.com/sync/advanced/sync-data-by-time)

## Missing decision-critical tests

### HIGH — the bakeoff does not cover the transport’s real failure envelope

At minimum, an ADR-grade build-vs-buy evaluation still needs:

- Replication-slot loss/invalidation, source failover, timeline change, backup restore and resnapshot.
- PowerSync service crash after acknowledging Postgres but before bucket storage is durable, and the reverse.
- Client kill during checkpoint download/apply; disk-full, SQLite corruption, and recovery.
- Initial snapshot concurrent with writes.
- Large transactions, subtransactions, multirow atomicity, long transactions, 2PC if supported, TRUNCATE and replica-identity changes.
- Bucket compaction/defragmentation during active sync.
- Schema and sync-rule migrations with old and new app versions concurrently.
- Upload retry after backend commit but before `tx.complete()`—the classic duplicate/idempotency boundary.
- Permanent-error handling for a mixed multi-op CRUD transaction.
- Delete/update, create/delete, constraint, uniqueness and FK conflicts.
- Two distinct users editing a shared project, membership removal, offline revocation, queued writes after revocation and token expiry.
- Read-path authorization mismatch: PowerSync sync rules versus PostgreSQL RLS.
- Network flapping, long offline periods, expired URLs/tokens, background suspension and OS termination.
- Realistic bucket/row counts, hot mutable rows, initial-sync time, client storage, memory, battery and bandwidth.
- Full-`ArrayBuffer` media memory pressure and large encrypted-file behavior.
- Cloud outage/support/SLA, monitoring, lag alarms, upgrades, licensing, exit plan and self-host restore procedures.

## Scope honesty

### HIGH — the limitation paragraph does not contain the conclusions

The write-up admits one bucket/project/device and low row counts, but then makes claims that travel far beyond that scope:

- “Structurally impossible.”
- “Sync is not held hostage by a stalled writer.”
- “Two blockers … genuinely dissolved.”
- “Decisively wins the sync-transport argument.”
- “PowerSync contributes nothing” to resumability.

The evidence covers one project, one principal, two simulators, one platform, a debug/native build, good connectivity, approximately 40 accumulated rows, and no transport/service faults. The scope statement does not neutralize those universal claims.

## Required rerun

The existing artifacts should be retained as exploratory observations, but the decision run must be repeated:

1. Commit and hash the predeclaration, harness, app, SQL, config and dependency lockfiles.
2. Repair Q1’s checkpoint, restart, payload, fresh-client and trial-isolation assertions.
3. Repair Q2’s rejection correlation, server-owned local convergence, distinct-principal coverage and schedule matrix.
4. Run Q3 on production builds and real iOS/Android hardware, including custom-adapter TUS feasibility.
5. Produce raw assertion artifacts for Q5–Q7, especially revocation, cost/licensing and time-window behavior.
6. Only then write an ADR-facing conclusion.

The single most likely way this bakeoff misleads the team is by turning one narrow simulator delivery schedule into “structural immunity” and “two blockers dissolved,” causing PowerSync adoption before multi-user revocation, failure recovery, upload idempotency, and real mobile media behavior have been tested.
