# Critic Review #10 — Codex pass on BAKEOFF-RESULT revision 2

> **Provenance.** Cross-model check per `docs/CODEX-REVIEW-10-PROMPT.txt`, `SPIKE-SYNC-BAKEOFF.md:118`, `CLAUDE.md §4`. Real cross-model check.
>
> - **Tool:** OpenAI Codex CLI v0.144.4, sandbox `read-only`, workdir `development/`.
> - **Model:** `gpt-5.6-sol` @ reasoning effort **high**. Forced `-c preferred_auth_method="apikey"` (`auth_mode=chatgpt` hangs).
> - **Scope:** #9 rejected revision 1 and ordered "freeze a corrected harness in Git, rerun Q1 and Q2". #10 checks whether revision 2 is a genuine correction **or a more sophisticated false pass**. The harness is now committed, so Codex verified claims **against git chronology**.
>
> ## Verdict: REVISION 2 REJECTED TOO
> - **Q1 "VALID PASS" survives: NO**
> - **Q2 "VALID PASS" survives: NO**
> - **Fit to support ADR-2 after merely running Q3: NO**
> - **A third frozen run is required.**
>
> Codex: *"Revision 2 contains real corrections, but the published 'VALID PASS' labels are still false passes. The raw Q1 behavior is credible and materially better than revision 1."*
>
> ## The CRITICAL finding, independently VERIFIED by the author before publishing this file
>
> **Q2's evidence was produced by a POST-FREEZE harness.** Confirmed against git:
>
> | | Frozen at `aedc79d` (14:00:19)? | Evidence produced | Status |
> |---|---|---|---|
> | **Q1** (`q1.py`, `common.py`, `app-src/`) | **Unchanged** (empty diff `aedc79d..HEAD`) | 14:00:39 — **20s after the freeze** | **freeze HOLDS** |
> | **Q2** (`q2.py`) | **CHANGED +18/−2**, committed 14:09:45 | 14:05–14:06 | **freeze BROKEN** |
>
> The frozen `q2.py` required observing `processing_state == "processed"`. It failed intermittently on a race; the author **downgraded that oracle to best-effort after seeing it fail**, re-ran, and committed afterwards. The artifact contains `transient_local_value_observed`, proving it came from the post-freeze harness. **Disclosing the race is not the same as re-freezing and re-running.** Whether the change was reasonable is irrelevant — an oracle that changes after observing failure must be frozen again and rerun.
>
> **Next:** reconcile in `IMPLEMENTATION_NOTES §4`. **ADR-2 stays where it is.**

---

# Verdict

Revision 2 contains real corrections, but the published “VALID PASS” labels are still false passes.

- **Q1 “VALID PASS” survives: NO.**
- **Q2 “VALID PASS” survives: NO.**
- **Fit to support ADR-2 after merely running Q3: NO.**
- **A third frozen run is required.**

The raw Q1 behavior is credible and materially better than revision 1. The problem is that several mandatory assertions remain non-load-bearing or weaker than claimed. Q2 is worse: the harness that generated the artifact was modified after the freeze, and its two “orderings” still do not constitute a conflict schedule matrix.

## Git chronology

- `aedc79d` was committed at **2026-07-16 14:00:19 -0700**.
- Q1’s first recorded event was **14:00:39**, twenty seconds later. Therefore the freeze predates the recorded Q1 run.
- The predeclaration document is unchanged from `aedc79d` to HEAD.
- But the harness is not unchanged:

  ```text
  spike/harness/q2.py | 20 ++++++++++++++++++--
  ```

- The frozen version required observing `processing_state == "processed"`. After that failed intermittently, the author changed it to best-effort. The final artifact contains the new `transient_local_value_observed` fields, proving it was produced by the post-freeze harness.
- The changed harness was committed at **14:09:45**, after the Q2 evidence timestamps of **14:05–14:06**.

Therefore:

- “The predeclaration was committed before run 2” is temporally true.
- “The frozen harness produced run 2” is false for Q2.
- Git cannot verify “no parameter was changed between runs” because revision 1 was untracked. No declared N/ownership value changed after `aedc79d`, but a load-bearing executable oracle did change after seeing the result.
- The actual executable app is an untracked symlink to `/Users/hadardev/bakeoff-app`; only a source copy is committed, and no `package-lock.json` or `Podfile.lock` is frozen. The copies currently match, but Git cannot prove what executable/dependency tree generated the evidence.

## Findings

### 1. CRITICAL — newly broken: Q2 was produced by a post-freeze harness

The frozen assertion at `aedc79d` was downgraded during the run from mandatory observation to best-effort. See [q2.py](spike/harness/q2.py:173>).

This is exactly what the freeze was meant to prevent. Whether the redesign is reasonable is irrelevant: once an oracle changes after observing failures, it must be frozen again and rerun.

Concrete fix: commit the final harness, actual app source, dependency locks and deployed configuration; embed that commit/tree hash in the artifact; restart both simulators; rerun all Q2 trials.

### 2. HIGH — still broken: Q1’s checkpoint quantity is not bound to B

`last_op_total` sums every matching bucket’s `last_op` [common.py](spike/harness/common.py:150>). That sum can advance because of another project bucket, MOVE/CLEAR, purge history or another writer. It does not prove that B caused the advancement.

The current artifact happens to show exactly one named project bucket and `+1/+1`, which makes the observation plausible. The code remains a false-pass oracle outside that exact fixture.

The harness also obtains `st_b` and `ck_b` through separate status-file reads [q1.py](spike/harness/q1.py:245>), despite claiming a single observation.

Concrete fix: require the exact expected bucket name, record its individual cursor, source commit LSN and SDK checkpoint ID/checksum in one exported snapshot, and fail if any unrelated bucket or operation advanced.

### 3. HIGH — still broken: required Q1 assertions are recorded but not load-bearing

Several required checks can fail without failing the trial:

- The fresh-client control is optional and never added to `checks` [q1.py](spike/harness/q1.py:342>).
- “Exactly once” is inferred from a primary-key materialized view. Duplicate delivery/apply events would collapse to one row.
- B’s checkpoint-time content checks are recorded but not included in the verdict.
- For mechanism (b), `checkpoint_advanced_for_a` is unconditionally set to `True` [q1.py](spike/harness/q1.py:335>).
- `is_idle()` ignores `uploading`, `hasSynced`, checkpoint identity and `lastSyncedAt` [common.py](spike/harness/common.py:174>).

These flaws did not trigger in the twenty observed mechanism-(a) trials, but they contradict “assertions that can now fail” and the rule that every tightened step is mandatory.

Concrete fix: make every control a verdict Boolean, record delivery/apply events rather than only final PK state, and implement a real mechanism-(b) completion assertion.

### 4. MEDIUM — Q1 restart proof is acceptable, with overstated documentation

The restart can fail now. A corrupt SQLite that prevents the read transaction from succeeding will not produce a new valid status snapshot. A sync connection that remains broken will later fail to deliver A.

The new process reads captures and buckets from its own database transaction in [App.tsx](spike/app-src/App.tsx:87>), and `restart_app()` requires a changed `bootId` and `dbInitOk` [common.py](spike/harness/common.py:86>).

But comments and prose claim a reset `statusSeq` and newer timestamp are required; the harness checks neither. That is an accuracy defect, not presently a reason to reject the observed restart.

Concrete fix: assert `statusSeq` belongs to the new boot and the timestamp is later than termination, or remove those claims.

### 5. ACCEPTABLE — the payload correction is real

This is no longer server-hash-to-server-hash comparison. The harness generates the source payload, reads the payload held in device SQLite, compares it exactly, and independently recomputes SHA-256 [q1.py](spike/harness/q1.py:99>). It does this for A and B.

### 6. HIGH — still broken: the Q1 trials are not independent

Purging rows and waiting for an empty materialized set does not reset bucket history, service state, client SQLite, or the cursor lineage. The artifact shows the pre-trial cursor rising by six per trial. The purge/re-add process itself is generating operations.

The trials are unique-ID repetitions in one persistent system lineage, not the “20 independent trials” declared in [BAKEOFF-PREDECLARATION.md](docs/BAKEOFF-PREDECLARATION.md:42>).

Concrete fix: use a fresh simulator database and isolated project/bucket per trial, while preserving the same client only within each trial’s B→restart→A sequence. Separately run a production-shaped populated-bucket and compaction variant.

### 7. MEDIUM — newly broken: the purge can leave immutability disabled

`purge_captures()` runs on an autocommit connection and performs:

1. Disable trigger.
2. Delete.
3. Re-enable trigger.

See [q1.py](spike/harness/q1.py:62>). A process death, connection loss or failure during the sequence can leave `capture_no_delete` disabled. During the disabled interval, any other session can delete supposedly immutable evidence.

This directly undermines the append-only property the spike claims its own rules enforce.

Concrete fix: avoid deleting immutable rows. Otherwise perform cleanup in a dedicated test schema inside one explicit transaction with an exclusive lock, assert trigger state afterward, and abort the entire run if restoration is not verified.

### 8. MEDIUM — the Q1 latency claim is only fixture-local

The 0.13–0.98s measurements legitimately show that these mechanism-(a) observations were not close to the 25-second boundary. They do not show non-marginality under realistic bucket size, compaction, initial snapshot, service load or concurrent writers.

The purge creates the easiest possible bucket: nearly empty, one new row.

Concrete fix: retain the current statement only as “not marginal in this tiny fixture” and run populated-bucket/compaction cases before using latency in an ADR argument.

### 9. HIGH — still broken: Q2 ordering A does not force the claimed conflict schedule

Ordering A records `pg_after_server_edit`, but never makes “server conflict committed while the client edit remained pending” a failing Boolean [q2.py](spike/harness/q2.py:114>).

More importantly, reconnect starts uploads and downloads together. There is no barrier proving the conflicting server value downloaded before the pending local upload. The server value may simply be overwritten before the device ever processes it.

Thus the test proves that the offline CRUD entry later uploaded. It does not prove it survived a conflicting download.

Concrete fix: block `uploadData`, allow download to cross a recorded server version/checkpoint, assert the local client value and current-row CRUD entry remain intact, then release upload.

### 10. HIGH — newly broken: Q2 ordering B can false-pass stale clients

For ordering B:

- PostgreSQL is checked against the expected value.
- Devices are checked only for equality with each other.

The code does not assert that either device equals PostgreSQL or the expected value [q2.py](spike/harness/q2.py:139>). If both devices remained stale at `resolved` while PostgreSQL was `overridden`, every verdict Boolean would still pass.

The earlier `wait_for` does compare against expected, but its timeout is swallowed.

Concrete fix: make timeout failure load-bearing and assert every device value equals `expected`, not merely that the device set has cardinality one.

### 11. HIGH — still broken: the added Q2 ordering is tautological

“Client upload completes, then server writes” establishes a strict serial order. The later server request wins because the declared policy is last-arrival-wins. That tests ordinary propagation, not conflict handling.

Adding this serial tautology does not repair the #9 finding about one favorable ordering.

The informative missing schedule is:

1. Device offline with a correlated pending CRUD operation.
2. Server commits a distinct version.
3. Upload is blocked while download crosses the server version.
4. Assert the pending local value and CRUD entry survive.
5. Release upload and assert its version wins.
6. Reverse the barriers: hold download, upload client version, then release a later server version.
7. Add simultaneous two-device uploads with forced order, app death while queued, and retry after backend commit but before `tx.complete()`.

### 12. HIGH — still broken: rejection correlation is weaker than the checkbox claims

The matcher slices by list position:

```python
rejections(udid1)[len(baseline):]
```

See [q2.py](spike/harness/q2.py:193>). This assumes an append-only, never-reset, never-reordered in-memory list. An app restart resets the list; reordering or deduplication makes prefix baselining invalid.

A timestamp is added to the record, but the matcher never verifies that it is after the command. No transaction/request ID or server audit record is retained.

Unique row IDs make accidental attribution unlikely in this particular run, but the §7 claim “rowId + field + timestamp” is factually false.

Concrete fix: assign a persistent rejection UUID/sequence and CRUD transaction ID; baseline by ID set; require `timestamp >= command_sent_at`; include boot ID; and preserve server request/audit evidence.

### 13. HIGH — newly weakened: “converged back” is no longer fully observed

The frozen harness required observing the local unauthorized value. The replacement observed it in only 2/5 trials. The final-state check can therefore report “converged back” without witnessing the transition.

The unique rejection does show that an operation for that row reached the connector, so the functional refusal is real. It does not support the stronger UX claim that “the user sees the edit land and vanish.”

Concrete fix: add an app-side command acknowledgment containing the post-transaction local value and local transaction sequence, then record the later authoritative checkpoint/reversion. Do not rely on a 500ms status-file poll.

### 14. MEDIUM — the race disclosure is only half correct

Calling the 500ms polling requirement racy is honest. Calling the event “our defect, not a PowerSync finding” is not.

The polling race is theirs. The rapid asynchronous rejection/reversion is actual PowerSync-plus-connector behavior and is decision-relevant. The artifact does not precisely establish “under 500ms,” but it establishes that the state often appeared and reverted between coarse status snapshots.

Concrete fix: report both facts separately:

- Harness defect: coarse polling cannot reliably witness the transient state.
- Product behavior: unauthorized local writes may be reverted too quickly for reliable visible-state handling; measure it using direct app events.

### 15. HIGH — surviving decision language repeats the withdrawn claim

Revision 2 removes “decisively wins” and “two blockers dissolved,” then replaces them with:

> “the two blockers that killed our hand-built design twice … held up under the tightened bars”

and:

> “Q1 and Q2 met their tightened bars”

See [BAKEOFF-RESULT.md](docs/BAKEOFF-RESULT.md:192>).

Given the post-freeze Q2 edit and the remaining false-pass paths, this is the same adoption argument in quieter language.

Concrete fix: replace it with: “The raw runs produced encouraging fixture-local observations; neither Q1 nor Q2 currently satisfies the complete frozen oracle.”

## §7 reconciliation, line by line

| §7 row | Audit result |
|---|---|
| Restart false-pass | **Acceptable**, except `statusSeq`/timestamp claims overstate code |
| Predeclaration tamper evidence | **CRITICAL — checkbox false/incomplete**; Q2 harness changed after freeze |
| Incoherent decision language | **HIGH — cosmetic**; equivalent blocker/adoption language survives |
| Smoke-run evidence mismatch | **Acceptable**; revision-2 examples match tracked artifact |
| Exact payload | **Acceptable** |
| `last_op`, assertion, split reads | **HIGH — partial**; relabeled/asserted, but summed unbound cursor and separate exported reads remain |
| PostgreSQL explanation | **Acceptable**; universal claim withdrawn |
| N=20 shield | **HIGH — partial**; structural wording withdrawn, but “independent” and blocker language remain |
| 42501 attribution | **HIGH — partial**; row/field added, timestamp not checked, prefix baseline fragile |
| Server-owned convergence | **HIGH — partial/newly weakened**; final state asserted, transition no longer mandatory |
| Favorable ordering | **HIGH — checkbox false**; second serial ordering is tautological and no barriers exist |
| “Unmeetable” | **Acceptable**; withdrawn correctly |
| Secondary evidence | **HIGH — incomplete**; Q7 is still called “verified” with no harness/raw artifact |
| Failure envelope | **Acceptable as disclosure only**; tests remain unperformed |
| Scope paragraph | **HIGH — partial**; scope improved, but conclusions still exceed it |
| 25s mechanism window | **MEDIUM — partial**; current mechanism-(a) latency recorded, mechanism-(b) branch still lacks CDC/ingestion evidence |
| Seq control | **Acceptable**; now correctly described as an inversion precondition |
| Same user vs separate actors | **MEDIUM — disclosure exists, required distinct-principal coverage still absent** |
| Five Q2 trials | **Acceptable as repetition count**, not as independent concurrency evidence |
| Wrong prediction investigation | **MEDIUM — partial as labeled**; commit-order prose added, but no PowerSync ingestion/op-assignment investigation occurred |

## Withdrawals and ADR fitness

The Q3 and PostgreSQL withdrawals went far enough in isolation. The decision withdrawal did not.

Q5–Q7 are also not complete:

- Q5’s release/hardware matrix remains unrun.
- Q6’s cost/licensing oracle remains unrun and its “risk eliminated” claim lacks a preserved artifact.
- Q7’s 41→1→41 result remains prose-only; time-windowing and revocation are unrun.

Therefore running Q3 alone cannot make this document ADR-ready.

Required third run:

1. Freeze the exact executable tree, app, locks, harness and config.
2. Repair and rerun Q1 with load-bearing controls, exact checkpoint binding and independent/realistic-bucket variants.
3. Repair and rerun Q2 with deterministic upload/download barriers, expected-value device assertions, durable rejection correlation and distinct principals.
4. Run Q3.
5. Preserve decision-critical Q5–Q7 artifacts, especially revocation, cost/licensing and physical release behavior.

**The single most likely way REVISION 2 still misleads the team is by converting encouraging final-state observations from a post-hoc-edited, serial toy harness into “the two blockers held up,” causing ADR-2 adoption without ever testing the actual contested upload/download schedule or transport failure boundary.**
