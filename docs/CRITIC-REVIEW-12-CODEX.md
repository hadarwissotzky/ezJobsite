# Critic Review #12 — Codex pass on Artifact 1 v3

> **Provenance.** Cross-model check per `CLAUDE.md §4`. Real cross-model check.
> - **Tool:** OpenAI Codex CLI v0.144.4, sandbox `read-only`, web search enabled. **Model:** `gpt-5.6-sol` @ **high**. Forced `preferred_auth_method=apikey` (`auth_mode=chatgpt` hangs).
> - **Scope:** two separate questions — **(A)** are #11's 12 fixes real in the document, or relabelled? **(B)** what is still or newly wrong?
>
> ## Verdict
> - **Only 2 of 12 findings genuinely fixed: H5 and H8, both narrowly.**
> - **Still open or merely relabelled (10):** H1 · C2 · C3 · C4 · H6 · H7 · H9 · H10 · H11 · H12
> - Crash-safe specification: **NO** · Blocker 2 closed: **NO** · Safe to begin A0.2: **NO**
> - **Author's gate verdict ("blocker 2 OPEN, do not begin A0.2"): CORRECT**
> - **Author's "all 12 addressed" claim: FALSE**
>
> Codex: *"v3 is closer than v2 because it makes two real filesystem corrections and identifies several real gaps. It is nowhere near as close as the reconciliation table claims."*
>
> **The distinction that matters: writing a prose paragraph that restates a finding is not fixing it.** Eight rows did exactly that. The two that count (H5 preallocating the *actual* temp file; H8 the immutable no-replace install) changed the protocol, not the framing.
>
> ## The pattern, caught for the FOURTH consecutive review (#9 → #10 → #11 → #12)
> A claim withdrawn in one place and left standing in another. In v3, all verified by the author against the file:
> - §1.3's header still read **"✅ closes blocker 2"** while the banner above said OPEN.
> - Line 62 still promised recovery from a kill/crash/power-loss at **any** point.
> - Row 8 was corrected in the table, then called **"impossible by construction"** five lines below it.
> - **"The phantom-saved state is unrepresentable" was still standing 170 lines after its own retraction.**
>
> All four removed via an exhaustive grep for closure/unrepresentability claims — **not** by spot-fixing the lines under the cursor, which is what failed the previous three times.
>
> ## New CRITICALs beyond the #11 set
> - **SQLite is not yet a valid DECIDE authority.**
> - **PowerSync-managed rows cannot be the exclusive permanent commitment authority** — the transport that syncs the rows can also revert them, so *"SQLite alone decides"* is not stable while PowerSync owns those tables. **This attacks the load-bearing premise of the PREPARE/DECIDE split itself.**
>
> **Next:** the ledger's reconciliation table is marked false and retained as evidence of the failure mode. **ADR-2 unaffected.**

---

# Verdict

Only **2 of the 12 findings are genuinely fixed in the document: H5 and H8, both narrowly**.

The other ten remain open or are merely relabelled: **H1, C2, C3, C4, H6, H7, H9, H10, H11, H12**.

- Crash-safe specification: **NO**
- Blocker 2 closed: **NO**
- Safe to begin A0.2: **NO**
- Author’s gate verdict: **correct**
- Author’s “all 12 addressed” claim: **false**

v3 is closer than v2 because it makes two real filesystem corrections and identifies several real gaps. It is nowhere near as close as the reconciliation table claims.

## A. Checkbox audit, finding by finding

### 1. H1 — skeleton presented as specification

**HIGH — STILL BROKEN**

The new banner correctly calls Artifact 1 a skeleton at [DURABILITY-DESIGN-v1.md:64](docs/DURABILITY-DESIGN-v1.md:64>). That edit is real.

It is contradicted by active normative text:

- The artifact introduction still promises recovery after any kill/crash/power loss at [line 62](docs/DURABILITY-DESIGN-v1.md:62>).
- §1.3 still says “✅ closes blocker 2” at [line 153](docs/DURABILITY-DESIGN-v1.md:153>).
- Row 8 is declared normal at line 254, then “impossible by construction” at [line 259](docs/DURABILITY-DESIGN-v1.md:259>).
- The general phantom claim is resurrected at [line 261](docs/DURABILITY-DESIGN-v1.md:261>).

The checkbox is therefore a framing edit contradicted by the protocol body.

**Fix:** Remove every closure/unrepresentability statement until the durability configuration, stable local commitment authority, receipt/dead-letter protocol, backend RPC, authenticated manifest, and complete recovery state vector exist.

---

### 2. C2 — returned COMMIT is not durable

**CRITICAL — STILL BROKEN**

The §1.0 edit is substantive, but not a sufficient durability profile.

Defects:

- “`wal_autocheckpoint`: explicit, not default” at [line 104](docs/DURABILITY-DESIGN-v1.md:104>) is not a policy. There is no threshold, checkpoint mode, scheduler, WAL-size bound, or failure behavior. The reconciliation falsely calls this an “explicit checkpoint policy.”
- `F_FULLFSYNC` is named, but the document never requires `PRAGMA fullfsync=ON` on the SQLite writer or verifies it. SQLite uses `F_FULLFSYNC` for its WAL only when that connection flag is active. [SQLite’s official pragma documentation](https://www.sqlite.org/pragma.html#pragma_fullfsync)
- Runtime read-back checks only `journal_mode` and `synchronous`; it omits `fullfsync`, `wal_autocheckpoint`, VFS identity/capability, and the actual writer connection.
- A generic PowerSync query may run on a pooled read connection, so reading a pragma does not necessarily inspect the connection that will commit DECIDE.
- The cross-connection/write-connection problem is explicitly unresolved at [line 108](docs/DURABILITY-DESIGN-v1.md:108>). That voids the practical durability claim.
- The spike opens OP-SQLite with no durability options at [App.tsx:39](spike/app-src/App.tsx:39>).

Conditionally, WAL + `synchronous=FULL` is enough for SQLite’s ACID contract; there is no separate checkpoint-loss window if the WAL sync is genuine. The remaining window is beneath that contract: the VFS/OS/device must honor `xSync`. [SQLite explicitly calls FULL+WAL ACID](https://sqlite.org/pragma.html#pragma_synchronous).

Current PowerSync OP-SQLite source exposes `journalMode` and `synchronous`, defaults the latter to `NORMAL`, and applies it to one write connection. Its other five connections are read-only. So this is resolvable, but v3 has not resolved it. [PowerSync OP-SQLite options](https://raw.githubusercontent.com/powersync-ja/powersync-js/main/packages/powersync-op-sqlite/src/db/SqliteOptions.ts), [connection-pool implementation](https://raw.githubusercontent.com/powersync-ja/powersync-js/main/packages/powersync-op-sqlite/src/db/OPSqliteAdapter.ts)

**Fix:** Pin an exact adapter version; configure its writer with WAL/FULL; execute and read back `fullfsync=ON` on Apple on that same writer; specify the actual checkpoint policy; ban unowned writer connections; verify the VFS/build; fail closed; then run physical hard-power tests on iOS and Android.

---

### 3. C3 — `ps_crud` is transient

**CRITICAL — STILL BROKEN**

§1.3c correctly retracts permanent-`ps_crud` reasoning, but replaces it with three unnamed abstractions:

- No schema or location for the “durable server receipt.”
- No writer or transaction boundary for the receipt.
- No recovery query that finds it.
- No schema/location/ownership/UI state for the dead letter.
- No RPC request, response, idempotency, authorization, digest-conflict, or lost-response contract.

The old false model remains active:

- The recovery row says a receipt is “not yet designed” at [line 254](docs/DURABILITY-DESIGN-v1.md:254>).
- The next paragraph still says row 8 is impossible at [line 259](docs/DURABILITY-DESIGN-v1.md:259>).
- The fault oracle still requires `ps_crud` at [line 269](docs/DURABILITY-DESIGN-v1.md:269>).

One RPC is necessary but not sufficient. If the RPC commits and the client dies before `complete()`, PowerSync will retry the transaction. That is safe only if the RPC atomically persists:

1. Capture,
2. Attachment/RemoteAsset,
3. receipt keyed by tenant + mutation ID,
4. canonical request digest,
5. stored response,

and rejects reuse of the same mutation ID with a different digest. PowerSync explicitly retries when `uploadData()` fails or leaves the transaction incomplete. [PowerSync upload-loop behavior](https://docs.powersync.com/configuration/app-backend/client-side-integration)

**Fix:** Specify the receipt and dead-letter tables, RPC, exact recovery algorithm, digest-mismatch behavior, and lost-response retry. Replace the remaining permanent-`ps_crud` assertions.

---

### 4. C4 — incomplete truth table

**CRITICAL — STILL BROKEN**

Rows 5b/6b are real edits, but they fix only two combinations. The document itself still admits the table is a draft at [lines 233–241](docs/DURABILITY-DESIGN-v1.md:233>).

Still absent:

- `VERIFIED` + media missing + no rows.
- Missing/corrupt manifest + media present + rows present.
- `STARTED`/`RECORDING` manifest + rows present.
- Capture present/Attachment absent and the inverse.
- Row/manifest IDs, hashes, sizes, paths, or mutation digests disagreeing.
- Only one of two CRUD operations pending.
- Receipt present but local queue still pending.
- Dead letter present with rows present/missing.
- Valid N−1 with corrupt N.
- Two valid same-generation manifests.
- Rename/install completed before terminal manifest.
- Permanent media at a different content hash.
- DB unreadable and media missing.
- Reservation/temp/log surviving without a manifest.

The added “forks quarantine” sentence is not a recovery action. It does not define a state, UI behavior, whether DECIDE is prohibited, how bytes are retained, or how the fork is resolved.

**Fix:** Replace the hand-selected table with a state vector covering manifest chain/fork validity, media integrity/location, both domain rows independently, identity agreement, queue state, receipt/dead-letter state, and reservation/temp/log state. Generate cases from that vector and fail closed on every inconsistent state.

---

### 5. H5 — reservation targeted the wrong file

**HIGH — FIXED NARROWLY**

The edit at [lines 159–163](docs/DURABILITY-DESIGN-v1.md:159>) now preallocates `tmp/<id>.part` itself with platform allocation primitives. That is the actual correction review #11 required.

v3 nevertheless creates new unresolved capacity defects:

- `posix_fallocate` may extend logical length; the protocol does not specify offset writes, final truncation, or durable actual-length recording.
- No maximum recording duration/size or behavior at the preallocated boundary exists.
- The metadata “reserve” repeats the decoy-file logic. While retained, its blocks cannot be consumed by the WAL. If it is deleted to fund DECIDE, a race reappears.
- PowerSync/checkpoint WAL growth is not bounded by the reserve calculation.
- Reservation-only recovery remains absent.

**Fix:** Define the maximum allocation, logical-end tracking and final truncation; serialize disk consumers; specify an emergency-reserve release protocol or abandon the reserve-file fiction; add reservation-only recovery.

---

### 6. H6 — generational manifests

**HIGH — STILL BROKEN**

The edit names most required concepts but does not specify them.

- “Canonical encoding” is undefined while the file is called JSON.
- Authentication is delegated to unfinished Artifact 3 at [line 189](docs/DURABILITY-DESIGN-v1.md:189>), so “valid” is not actually defined.
- “Single-writer lease/fencing” has no lock location, acquisition primitive, fencing token, expiry rule, or stale-writer rejection.
- `O_EXCL` is not a no-replace rename operation. It applies to file creation/open, not temp-file promotion.
- “Forks quarantine” is not an operational state.
- “Retain at least two” at line 186 conflicts with “older generations are deleted once newer is durable” at [line 191](docs/DURABILITY-DESIGN-v1.md:191>).
- The same paragraph restores “highest valid generation wins,” which cannot resolve a same-generation fork.

**Fix:** Define canonical bytes and schema version; exact manifest paths; atomic no-replace promotion per platform; fencing-token mechanics; authenticated predecessor chain; deletion floor of two verified generations; descending fallback; and quarantine handling.

---

### 7. H7 — chunk protocol

**HIGH — STILL BROKEN**

The CRC/SHA separation, exact-write loop, reread, and expected sample count are real improvements at [lines 165–167](docs/DURABILITY-DESIGN-v1.md:165>).

Still missing from the original finding:

- Exact record encoding and byte order.
- Maximum record length.
- Exact CRC coverage.
- Scanner behavior after an invalid non-tail record.
- Durable creation/parent-directory barrier for the temp and log files.
- Explicit validation of no gaps, overlap, duplicate offsets, or trailing unlogged bytes.
- Where and when the independent expected count becomes durable.
- How the final full-file digest relates to the list of chunk digests.

A partial container that decodes and happens to produce the expected sample count is not caught by sample count alone. Recovery also needs exact byte length, terminal offset, complete chunk coverage, container finalization, and an authenticated terminal manifest.

**Fix:** Define the binary log format and scanner as an executable grammar, including directory durability and final digest derivation.

---

### 8. H8 — immutable content-addressed install

**HIGH — FIXED NARROWLY**

The prescribed corrections exist at [lines 169–174](docs/DURABILITY-DESIGN-v1.md:169>): frozen writer, rehash, same-filesystem assertion, no-replace install, existing-destination verification, and both directory barriers.

Remaining independent defects:

- The source-directory ordering is ambiguous: the source must be removed and then its directory barriered, not barriered and then removed.
- Destination mismatch behavior is unspecified.
- Recovery after install but before terminal manifest is still absent from §1.4.

**Fix:** State the exact link/rename/unlink/barrier order and add the install-before-manifest recovery case.

---

### 9. H9 — DB-loss reconstruction identity

**HIGH — STILL BROKEN**

The PREPARE-minted IDs at [line 116](docs/DURABILITY-DESIGN-v1.md:116>) are a real edit, but not an executable recovery identity specification.

Problems:

- No canonical payload schema, encoding, version, null representation, Unicode normalization, time/number representation, or field order.
- No schema-evolution decoder/migration rule for recovery years later.
- It never explicitly says the digest binds media hash, size, media type, tenant, actor, Capture ID, Attachment ID, mutation ID, and schema version.
- Artifact 2 still says the ID is minted at local commit at [line 302](docs/DURABILITY-DESIGN-v1.md:302>).
- Artifact 3 repeats the same contradiction at [line 344](docs/DURABILITY-DESIGN-v1.md:344>).
- `INSERT … ON CONFLICT DO NOTHING` at [line 193](docs/DURABILITY-DESIGN-v1.md:193>) silently accepts an existing ID with different content.

**Fix:** Store versioned canonical request bytes—not merely “a canonical payload”—and hash a domain-separated envelope binding all identity and media fields. On conflict, compare the digest and exact row pair; mismatch must quarantine, never no-op.

---

### 10. H10 — attachment download/lifecycle design

**HIGH — STILL BROKEN**

The false “buys us nothing” claim is retracted. The finding itself is explicitly not fixed:

- The document says the replacement is “NOT designed” at [line 214](docs/DURABILITY-DESIGN-v1.md:214>).
- The proposed split is “not yet written” at [line 221](docs/DURABILITY-DESIGN-v1.md:221>).
- There is no download scheduler, integrity transition, atomic install, retry state, retention pin, window re-entry, or GC protocol.

The claim that the spike schema contains a device-local path is also factually false: its attachment has `object_key`, not a local URI, at [AppSchema.ts:37](spike/app-src/AppSchema.ts:37>).

**Fix:** Specify actual `RemoteAsset`, `LocalAsset`, upload/download job, verified-local-install, retention, and GC schemas and transitions before designing A0.2.

---

### 11. H11 — gate/evidence language

**HIGH — STILL BROKEN**

The Durability banner is corrected, but the rejected conclusions remain active elsewhere:

- Architecture still says “40/40 trials across two independent harness revisions” at [ARCHITECTURE.md:8](docs/ARCHITECTURE.md:8>).
- It still says blockers 1 and 3 “dissolved” at [line 17](docs/ARCHITECTURE.md:17>).
- It still says Q2 “demonstrated” the mutable-state result at [line 20](docs/ARCHITECTURE.md:20>).
- ADR-2 repeats the claims at [lines 202–208](docs/ARCHITECTURE.md:202>).
- Implementation Notes does the same in its active decision row at [IMPLEMENTATION_NOTES.md:52](docs/IMPLEMENTATION_NOTES.md:52>).

This is precisely the quieter-restatement pattern review #10 identified.

**Fix:** State only that ADR-2 was adopted by owner judgment despite an uncleared validation gate. Remove “demonstrated,” “40/40” as proof, “independent revisions,” “survived,” and “dissolved” from active architecture conclusions.

---

### 12. H12 — mutually exclusive implementation instructions

**HIGH — STILL BROKEN; CHECKBOX DEMONSTRABLY FALSE**

The SPEC edits to REQ-CAP5 and REQ-CAP8 are acceptable in isolation at [SPEC-capture-core-v1.md:101](docs/SPEC-capture-core-v1.md:101>) and [line 109](docs/SPEC-capture-core-v1.md:109>).

But:

- Durability still says saved fires at `MEDIA_COMMITTED` at [line 151](docs/DURABILITY-DESIGN-v1.md:151>).
- §1.3 still carries a green closure header.
- Architecture §3.1 still instructs `MEDIA_COMMITTED` at [ARCHITECTURE.md:98](docs/ARCHITECTURE.md:98>).
- The v3 edit to Architecture flow A itself retained `MEDIA_COMMITTED`, an owned queue, client-encrypted ciphertext, and TUS at [line 224](docs/ARCHITECTURE.md:224>).
- The active Spike A plan still requires it at [SPIKE-A-BUILD-PLAN.md:30](docs/SPIKE-A-BUILD-PLAN.md:30>), [line 92](docs/SPIKE-A-BUILD-PLAN.md:92>), and [line 129](docs/SPIKE-A-BUILD-PLAN.md:129>).
- Architecture simultaneously says PowerSync is current while its component body and flow describe an owned queue.

**Fix:** Perform a repository-wide removal of obsolete build instructions, then designate one normative state machine and one current architecture. Historical text must be inside visibly superseded blocks.

## B. Independent v3 defects

### 1. SQLite is not yet a valid DECIDE authority

**CRITICAL — STILL BROKEN**

Naming the cross-connection hazard as open is honest, but it means DECIDE is not presently specified. A local transaction cannot be called durable while the actual writer may still use the adapter’s default `NORMAL`.

A pragma read-back is a real configuration check, not a durability proof. It can establish that a connection reports `FULL`; it cannot prove:

- the checked connection is the writer,
- the VFS turns `xSync` into the promised barrier,
- `F_FULLFSYNC` is active,
- the storage device honors the flush,
- no later connection reopened with different settings.

### 2. PowerSync-managed rows cannot be the exclusive permanent commitment authority

**CRITICAL — NEWLY EXPOSED, NOT SOLVED**

Artifact 1 says SQLite rows exclusively answer whether a capture is committed. It also requires those rows to be PowerSync-managed. PowerSync is server-authoritative: once the upload queue empties, rejected or missing server state replaces the local projection. PowerSync documents this explicitly. [PowerSync validation/reversion behavior](https://docs.powersync.com/handling-writes/handling-write-validation-errors)

A dead-letter record does not by itself preserve the committed Capture/Attachment rows. The current design therefore lacks a stable local authority after a legitimate server rejection such as revocation, authorization change, schema mismatch, or malformed attachment.

**Fix:** Introduce an app-owned, local-only durable `CaptureCommit`/recovery-intent record that cannot be overwritten by PowerSync. Treat synced Capture/RemoteAsset rows as projections. A rejected upload must leave the saved local capture discoverable and exportable.

### 3. The backend RPC is part of the safety proof

**CRITICAL — STILL BROKEN**

§1.3’s DECIDE cannot be considered specified while the backend acceptance and receipt protocol are only nouns. The local transaction can prove “bytes and an attempted transport mutation exist”; it cannot prove that the mutation will not later be discarded and reverted.

The RPC must consume one exact domain envelope, not arbitrary unrelated CRUD operations, and atomically validate Capture + Attachment + receipt.

### 4. The manifest cannot yet recover a lost DB

**CRITICAL — STILL BROKEN**

Manifest authentication is not optional to row reconstruction. Without a versioned authenticated envelope, recovery cannot distinguish:

- a valid old manifest,
- random corruption,
- a fork,
- identity transplantation,
- an old-schema payload,
- a payload/digest mismatch.

Artifact 3 therefore contaminates the core row-9 recovery claim, not merely future evidentiary hardening.

### 5. `INSERT ON CONFLICT DO NOTHING` can manufacture false idempotency

**HIGH — NEWLY BROKEN BY v3**

The manifest now preserves IDs and payload, but DECIDE’s idempotency rule ignores payload equality. An existing Capture ID with different bytes causes a no-op, after which Attachment insertion may still proceed. Recovery can produce a mismatched row pair while claiming success.

**Fix:** Conflict means “load and compare exact canonical digest and both rows.” Only an exact match is idempotent.

### 6. Quarantine and corruption states are not modeled

**HIGH — STILL BROKEN**

`media_corrupt`, `media_lost`, manifest fork quarantine, and dead letter are prose labels. There are no tables, state transitions, persistence locations, UI obligations, or rules preventing upload/evidence serving.

### 7. The spike characterization is accurate but understated

**CRITICAL — `connector.ts` IS LIVE-BUGGY**

The stated defects are real:

- Separate requests per CRUD operation at [connector.ts:65](spike/app-src/connector.ts:65>).
- Permanent errors are discarded at [lines 81–103](spike/app-src/connector.ts:81>).
- The entire transaction is completed at [line 108](spike/app-src/connector.ts:108>).

Additional defects:

- `rejected` is in-memory only; it is neither a durable dead letter nor recovery evidence.
- `23503`, `23505`, and `42501` are classified as permanently discardable even though they can represent ordering, stale auth, schema migration, or retry/idempotency conditions.
- `upsert` is incompatible with immutable evidence. A replay can attempt an UPDATE against the immutable Capture trigger.
- A duplicate ID with different payload is neither digest-checked nor quarantined.
- Earlier operations can commit before a later transient failure; retry then replays a partially applied server transaction.
- PATCH and DELETE are accepted generically despite the evidence model requiring append-only/insert-only behavior.

### 8. `AppSchema.ts` and `App.tsx` are unsafe references

**HIGH — UNNOTICED**

- No `mutation_id`, request digest, receipt, dead letter, `RemoteAsset`, `LocalAsset`, or local durable commitment table exists.
- Attachment still contains obsolete Option-B encryption fields at [AppSchema.ts:37](spike/app-src/AppSchema.ts:37>).
- Capture is not marked insert-only locally.
- The OP-SQLite factory supplies no `synchronous=FULL`, no `fullfsync`, no checkpoint policy, and no assertions.
- No SQLCipher encryption key is supplied, despite other active docs still requiring encrypted SQLite. PowerSync’s official OP-SQLite setup requires both the SQLCipher build option and `encryptionKey`. [PowerSync OP-SQLite README](https://github.com/powersync-ja/powersync-js/blob/main/packages/powersync-op-sqlite/README.md)
- `db.connect(connector)` is not awaited or given rejection handling at [App.tsx:65](spike/app-src/App.tsx:65>).
- The command sequence watermark is memory-only, so a stale command is re-executed after every restart.
- A fixed password is embedded in source at [App.tsx:17](spike/app-src/App.tsx:17>).

“Must not be copied” is therefore accurate but understated. The whole spike directory must be stamped throwaway/non-reference, not only the connector.

## Pattern assessment

The pattern repeated.

The status banner is restrained and acceptable. The document then banks credit elsewhere:

- “What survives” is used correctly only for the narrow elimination of the two original manifest/SQLite half-commit states.
- §1.3, row 8, the oracle, and Architecture expand that narrow concession back into stronger safety claims.
- The reconciliation table treats “named as unfinished” as “fixed.”
- Architecture retains rejected bakeoff claims in quieter language.
- H12’s own v3 edit kept the obsolete state it claimed to remove.

“The PREPARE/DECIDE split is correct” means only that commitment no longer requires a post-SQLite manifest advance. It does not establish durable SQLite commit, durable transport evidence, recoverable identity, or protection against PowerSync reversion.

## Minimum work before A0.2

1. Produce one contradiction-free normative document and remove all active `MEDIA_COMMITTED`, owned-queue, Option-B, and rejected bakeoff claims.
2. Lock the exact OP-SQLite/PowerSync version and writer configuration: WAL, FULL, Apple `fullfsync`, actual checkpoint policy, VFS assumptions, same-writer assertions, no alternate writers.
3. Define a durable local commitment authority that PowerSync cannot overwrite.
4. Specify the versioned canonical request envelope and authenticated manifest, including schema evolution and digest-conflict behavior.
5. Specify and build the atomic backend RPC plus durable receipt/dead-letter schemas and lost-response retry.
6. Complete the generated recovery state model, including forks, fallback generations, partial rows, reservation orphans, receipts, and dead letters.
7. Finish the exact chunk-log, manifest fencing, allocation, install, and source-unlink protocols.
8. Design `RemoteAsset`, `LocalAsset`, upload/download, verified install, retention, window re-entry, and GC before freezing the schema.
9. Replace or quarantine the spike connector/schema as non-production reference material.
10. Prove the selected native stack with real hard-power/disk-full tests on physical iOS and Android.

**The single most likely way a capture still gets silently lost under Artifact 1 v3 is: the app commits through OP-SQLite’s still-default `synchronous=NORMAL` writer, shows “saved,” and a power loss rolls back Capture, Attachment, and `ps_crud` before the WAL reaches durable storage.**
