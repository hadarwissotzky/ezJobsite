# Critic Review #11 — Codex pass on Artifact 1 v2 (the blocker-2 closure)

> **Provenance.** Cross-model check per `CLAUDE.md §4`. Real cross-model check.
> - **Tool:** OpenAI Codex CLI v0.144.4, sandbox `read-only`, workdir `development/`, web search enabled.
> - **Model:** `gpt-5.6-sol` @ reasoning effort **high**. Forced `-c preferred_auth_method="apikey"` (`auth_mode=chatgpt` hangs).
> - **Scope:** is Artifact 1 v2 a crash-safe specification, or another protocol sketch wearing a "closed" label? (This document has already been caught once labelling sketches "✅ COMPLETE" — review #7.)
> - **Findings:** 3 CRITICAL · 9 HIGH.
>
> ## Verdict: BLOCKER 2 IS **NOT** CLOSED. A0.2 MUST NOT BEGIN.
> - **Is blocker 2 closed? NO**
> - **Is Artifact 1 v2 a crash-safe specification? NO**
> - **Is it safe to begin A0.2 schema code? NO**
>
> Codex: *"The PREPARE/DECIDE rewrite fixes v1's exact two-authority error, but the document immediately builds new closure claims on unspecified SQLite durability, a false model of `ps_crud`, an incomplete recovery table, and still-sketch-level filesystem operations. **The 'phantom saved is unrepresentable' claim must be withdrawn.**"*
>
> ## The two CRITICALs that kill the central claim — both verified by the author
>
> **1. A returned SQLite commit is NOT durable.** v2 asserted *"SQLite's commit is atomic, so there is no instant at which the app has said 'saved' and the capture is not committed."* **That conflates atomicity with durability — they are different properties.** In WAL mode under `synchronous=NORMAL`, COMMIT returns *without* fsyncing the WAL; power loss rolls the transaction back. v2 specifies **no** `journal_mode`, `synchronous`, `fullfsync`, checkpoint policy, or runtime assertion that the pragma took effect — and the spike client never checks one. On iOS ordinary `fsync` is weaker than assumed (`F_FULLFSYNC` is the real barrier). **Concrete phantom: commit returns → UI shows "saved ✓" → power loss → SQLite rolls back Capture, Attachment and `ps_crud`.**
>
> **2. `ps_crud` is a TRANSIENT queue, not a permanent recovery fact.** `tx.complete()` **removes** processed entries — our connector does exactly that. So v2's row 8 (*"rows present + `ps_crud` missing = unrepresentable"*) **is the normal post-upload state**, and the oracle requiring `ps_crud` for every saved capture would fire on every successful upload. Worse: **PowerSync reverts local state once the queue is empty if the backend rejected the mutation.** Our connector sends Capture and Attachment as **separate Supabase requests**, continues past permanent errors, and calls `tx.complete()` anyway → *Capture accepted + Attachment rejected + queue discarded → the downloaded server checkpoint overwrites the local rows.* **A second, independent phantom.**
>
> **Both paths produce exactly the state v2 declared unrepresentable. The claim is withdrawn.**
>
> **Next:** the closure claims in `DURABILITY-DESIGN-v1.md` and `IMPLEMENTATION_NOTES` are reverted (see the commit that lands alongside this file). **ADR-2 is unaffected** — it does not depend on Artifact 1.

---

# Verdict

- **Is blocker 2 closed? NO.**
- **Is Artifact 1 v2 a crash-safe specification? NO.**
- **Is it safe to begin A0.2 schema code? NO.**

The PREPARE/DECIDE rewrite fixes v1’s exact two-authority error, but the document immediately builds new closure claims on unspecified SQLite durability, a false model of `ps_crud`, an incomplete recovery table, and still-sketch-level filesystem operations. The “phantom saved is unrepresentable” claim must be withdrawn.

## Findings

### 1. HIGH — Still broken: the diagnosis is correct, but the conclusion does not follow

Splitting authority is the right architecture:

- Filesystem: verified prepared media.
- SQLite: committed domain state.
- UI: acknowledgment only after DECIDE is durably complete.

That removes the need to advance a filesystem commitment state after SQLite. The two v1 half-commit states identified in review #7 really are eliminated.

But “SQLite is DECIDE” is sound only if all of these are specified and proven:

1. Prepared media and recovery metadata are power-loss durable.
2. SQLite’s successful return means power-loss durability.
3. The domain rows and outbound intent are atomically generated.
4. That intent cannot later disappear without durable acceptance or durable failure evidence.
5. Recovery can reconstruct exact identities and payloads from the manifest.
6. PowerSync cannot subsequently erase the only committed representation.

Artifact 1 establishes none of those completely. It has removed one co-commit but mistaken the cleaner diagram for a completed protocol.

**Fix:** Retain PREPARE/DECIDE, but call it the protocol skeleton until the durability profile, queue lifecycle, recovery identities, and fault-state matrix below are specified and tested.

---

### 2. CRITICAL — Still broken: a returned SQLite commit is not specified to be durable

The claim at [DURABILITY-DESIGN-v1.md:88](docs/DURABILITY-DESIGN-v1.md:88>) assumes SQLite atomicity and durability are the same property.

They are not.

In WAL mode:

- `synchronous=FULL` syncs the WAL at every transaction commit.
- `synchronous=NORMAL` can return success and later roll back that transaction after power loss or an OS crash.
- Checkpointing does not repair this; under NORMAL, the checkpoint is where synchronization normally occurs. [SQLite’s WAL documentation](https://sqlite.org/wal.html) and [synchronous pragma matrix](https://sqlite.org/pragma.html#pragma_synchronous) say this explicitly.

Artifact 1 specifies no:

- `journal_mode`
- `synchronous`
- `fullfsync`
- checkpoint policy
- VFS assumptions
- runtime assertion that these settings actually took effect
- behavior if PowerSync or op-sqlite changes them on another connection

The spike simply opens OPSQLite at [App.tsx:39](spike/app-src/App.tsx:39>) and never checks any durability pragma. It also does not supply the `encryptionKey` required for SQLCipher; PowerSync’s official OP-SQLite instructions require both a SQLCipher build option and an encryption key. [PowerSync OP-SQLite setup](https://github.com/powersync-ja/powersync-js/blob/main/packages/powersync-op-sqlite/README.md)

On iOS, ordinary `fsync` is also weaker than the document assumes. Apple says `F_FULLFSYNC` is the primitive for a strong expectation of persistence, and even that is best-effort under sudden power loss. [Apple disk-write guidance](https://developer.apple.com/documentation/xcode/reducing-disk-writes)

A concrete phantom is therefore representable:

1. Media/manifest operations return.
2. SQLite WAL commit returns under NORMAL.
3. UI displays saved.
4. Sudden power loss occurs.
5. SQLite rolls back the Capture, Attachment, and `ps_crud`.
6. Recent filesystem metadata may also be lost if ordinary Apple `fsync` was the only barrier.

The capture can come back as “never started,” or as a verified orphan lacking the allegedly committed state.

A crash between commit and rendering saved is **acceptable**: the user never saw saved, so it is merely a conservative false negative. The dangerous boundary is render-after-a-commit-that-was-not actually power-loss durable.

**Fix:** Define and enforce a platform durability profile:

- WAL plus `synchronous=FULL`.
- Apple `fullfsync`/`F_FULLFSYNC` where supported.
- Runtime read-back of every pragma on every database connection.
- Fail closed if the configured mode is not active.
- Non-purgeable app-data locations for media/manifests.
- Physical-device hard-reset/power-loss testing, not only process kills.
- Explicit SQLCipher configuration, wrong-key behavior, migrations, and recovery.

---

### 3. CRITICAL — Newly broken: `ps_crud` is a transient queue, not a permanent recovery fact

The narrow PowerSync assertion is real but conditional. For ordinary PowerSync-managed tables, generated triggers atomically update `ps_data__<table>` and append `ps_crud` within the current SQLite transaction. Raw tables require application-created triggers; local-only tables do not queue changes. [PowerSync client integration](https://docs.powersync.com/configuration/app-backend/client-side-integration)

The current schema declares Capture and Attachment as ordinary managed tables at [AppSchema.ts:13](spike/app-src/AppSchema.ts:13>), so the mechanism can work if both writes use one `writeTransaction`.

But Artifact 1 makes the false additional claim that `ps_crud` must remain present:

- Row 8 calls rows-without-`ps_crud` “unrepresentable.”
- The oracle requires `ps_crud` for every previously saved capture.
- The text treats its absence as database corruption.

Successful upload normally removes processed entries from `ps_crud` when `tx.complete()` is called. The project’s connector does exactly that at [connector.ts:107](spike/app-src/connector.ts:107>). PowerSync also documents manual clearing of `ps_crud` and warns that the application must recreate the queue if it does so. [PowerSync local-only usage](https://docs.powersync.com/client-sdks/advanced/local-only-usage)

Therefore row 8 is not impossible. It is the normal post-upload state.

Worse, PowerSync can later revert local state once the queue is empty if the backend rejected or discarded the mutation. [PowerSync write-validation behavior](https://docs.powersync.com/handling-writes/handling-write-validation-errors) The current connector:

1. Sends Capture and Attachment as separate Supabase requests.
2. Continues after selected permanent errors.
3. Calls `tx.complete()` anyway.

That permits Capture accepted + Attachment rejected + entire local queue transaction discarded. PowerSync’s local SQLite transaction grouping does **not** make those separate server calls atomic.

This moves the phantom:

> saved → `ps_crud` completed/discarded → server state lacks part or all of the capture → downloaded server checkpoint overwrites the local rows.

The media may remain temporarily recoverable, but SQLite no longer says committed—the exact state declared unrepresentable.

**Fix:**

- Treat `ps_crud` only as pending transport state.
- Add an immutable mutation ID and request digest that survive queue completion.
- Add a durable server receipt or durable rejected/dead-letter state.
- Apply Capture + Attachment through one backend transaction/RPC.
- Complete the PowerSync CRUD transaction only after the whole domain transaction is durable.
- Never discard evidence mutations merely to unblock the queue.
- Define recovery as: pending `ps_crud` **or** durable server receipt, not permanent `ps_crud` presence.

---

### 4. CRITICAL — Still broken: the 11-row truth table is neither complete nor safe

The table at [DURABILITY-DESIGN-v1.md:133](docs/DURABILITY-DESIGN-v1.md:133>) does not enumerate every combination. Counterexamples include:

- `VERIFIED` + media present under the expected pathname but bytes hash differently + rows present.
- `VERIFIED` + wrong-hash media + no rows.
- `VERIFIED` + media missing + no rows.
- Missing/corrupt manifest + media present + rows present.
- `RECORDING` or `STARTED` manifest + rows present.
- Capture present + Attachment missing, or vice versa.
- Both rows present but their hashes/paths/capture IDs disagree.
- `ps_crud` present for only one of the two rows.
- `ps_crud` absent because upload completed normally.
- Valid generation N−1 + corrupt N.
- Two valid generation-N manifests for one capture ID.
- Crash after media rename but before the VERIFIED manifest generation.
- Permanent media exists at a different content hash from the manifest/row.
- DB unreadable + missing media, which row 9 incorrectly groups with recoverable cases.

Row 6’s action, “Nothing,” is unsafe because it does not require recomputing the bytes’ hash during recovery. Mere pathname presence is not integrity.

Row 9 claims deterministic rebuild, but the manifest format is explicitly still open at [DURABILITY-DESIGN-v1.md:167](docs/DURABILITY-DESIGN-v1.md:167>).

**Fix:** Replace the prose table with a state vector covering at least:

- manifest validity, generation and fork state
- media location, length, decode result and recomputed hash
- Capture row state
- Attachment row state
- row/manifest identity agreement
- pending CRUD state
- durable server receipt/rejection state
- reservation/temp/log state

Generate recovery cases from that model and fail closed on every inconsistent combination. “Nothing” must still verify the bytes against the row and manifest.

---

### 5. HIGH — Still broken: zero-filling a separate reservation file does not reserve usable capture space

Even if the zero-filled file really receives physical blocks, those blocks belong to `reserve/<id>.blk`, while recording writes into `tmp/<id>.part`.

Holding the reservation while recording requires space for both files—approximately twice the maximum media size. Deleting or truncating it before writing the media releases the blocks and reintroduces the exact race the reservation was supposed to prevent.

The protocol also deletes the reservation before SQLite step 6, allowing PowerSync or another writer to consume the released space before the WAL commit.

Writing zeros is not the contractual preallocation primitive. Linux provides `fallocate`/`posix_fallocate`; Apple exposes `F_PREALLOCATE`, including an allocate-all mode. [Linux `fallocate`](https://www.man7.org/linux/man-pages/man2/fallocate.2.html), [Apple preallocation](https://developer.apple.com/documentation/kernel/vnop_pagein_args)

It also does not reserve directory metadata, and the unspecified `reserve/` location could be OS-purgeable.

**Fix:** Preallocate the actual media temp file:

- Apple: `F_PREALLOCATE` with allocate-all semantics.
- Android/Linux: `posix_fallocate`/`fallocate`.
- Verify allocation, not just logical length.
- Keep a smaller separate non-purgeable reserve for manifest/log/SQLite-WAL metadata.
- Release that reserve only after durable DECIDE; cleanup after commit may be derived and idempotent.
- Refuse capture if either allocation cannot be guaranteed.

---

### 6. HIGH — Still broken: generational manifests are only partially specified

The temp→sync→rename→directory-sync outline is the correct skeleton. The remaining load-bearing gaps are:

- No canonical per-capture directory or collision-safe temp filename.
- No `O_EXCL`/no-replace behavior.
- No single-writer lease or fencing, so two writers can create generation N.
- No definition of “valid.”
- No binding between filename generation, embedded generation, capture ID and predecessor.
- No rule for two manifests with the same capture ID.
- “Highest valid wins” cannot handle forks.
- Older generations are deleted once N is durable, removing the fallback if N later corrupts.
- Ordinary `fsync` is insufficient for the claimed iOS power-loss boundary.
- Manifest authentication is still delegated to unfinished Artifact 3.

**Fix:** Specify canonical encoding, checksum/authentication, embedded capture ID/generation/predecessor hash, unique temp files, single-writer fencing, no-replace installation, and retention of at least two verified generations. Forks must quarantine rather than select by clock or filename.

Clock order itself is not needed; monotonic generation order is acceptable once single-writer enforcement exists.

---

### 7. HIGH — Still broken: paired chunk durability lacks the data-integrity protocol it claims

Data-before-log is the correct order for this two-file design. An append need not be atomic if recovery has unambiguous framing and discards the first invalid tail.

But the text does not define enough to make that true:

- The states table says each chunk has a “hash”; step 3 stores only `crc32`.
- It is unclear whether CRC covers the media bytes, the log record, or both.
- No exact-write loop or short-write handling is specified.
- No reread of the chunk bytes before logging.
- No monotonic sequence/offset/length validation.
- No framing magic/version/maximum record length.
- No durable directory entry for newly created temp and log files before records reference them.
- A truncated but decodable file can be hashed self-consistently and pass unless expected sample/frame count is independently recorded.
- “Full-file hash matches the chunk log” is undefined when the log contains only CRC32 values.

A partial append crossing a page boundary is safe only after the record format and scanner make every prefix unambiguous. That is not currently written.

**Fix:** Store both:

- a framed record checksum for torn-tail detection, and
- a cryptographic digest of each exact media chunk.

Require exact write lengths, sync and reread verification, strict sequence/offset continuity, expected recorder sample/frame count, and final full-file hashing over the reconstructed durable byte sequence.

---

### 8. HIGH — Still broken: atomic rename is not yet an immutable content-addressed install

`rename()` gives atomic namespace replacement on one filesystem. It does not by itself provide:

- enforcement that source and destination are on the same filesystem
- no-overwrite semantics
- protection against replacing an existing content-addressed object
- verification of an already-existing destination
- exclusion of a recorder continuing to modify the file after verification
- durable removal from the source directory
- correct recovery from rename-before-manifest

A normal rename can replace an existing destination. That contradicts “write once” unless the destination is first verified byte-for-byte or installation uses no-replace semantics.

**Fix:** Close/freeze the writer, recompute the hash through the final descriptor, install with no-replace semantics, verify an existing destination, sync the destination directory and—where required—the source directory, and explicitly require one filesystem.

---

### 9. HIGH — Still broken: DB-loss reconstruction cannot preserve identity

Artifact 3 says the mutation ID is minted at SQLite commit. Nothing is written to the filesystem after that commit. Therefore a lost/corrupt database also loses the original mutation ID.

Row 9 nevertheless promises to rebuild from manifests and rerun step 6. That can mint a different mutation ID, duplicate a server mutation, or cause a changed-payload replay to be suppressed incorrectly.

The manifest also does not yet contain the complete canonical Capture/Attachment payload required to reconstruct the rows exactly.

**Fix:** Mint stable Capture, Attachment and mutation IDs during PREPARE and store them—plus a canonical request digest—in the terminal manifest. That does not make the manifest a commitment authority; it merely preserves recovery identity.

---

### 10. HIGH — Newly broken: dropping the attachment queue deletes the download and lifecycle design

The claim that the attachment queue “buys us nothing” is false. PowerSync’s queue also supplies:

- detection of remote attachment references
- cross-device download scheduling
- local file state
- retry
- repair of missing local files
- archive/delete transitions
- cleanup coordination

PowerSync documents that another client receives the reference, creates a `QUEUED_DOWNLOAD`, downloads the file and marks it locally available. [PowerSync attachments lifecycle](https://docs.powersync.com/client-sdks/advanced/attachments)

Building a custom uploader may be justified. It does not eliminate the need to rebuild those other functions.

Artifact 1 now has no specification for:

- Device 2 discovering and downloading media
- resumable/ranged download
- hash verification before local availability
- atomic installation on Device 2
- per-device local paths
- remote object versus local cache state
- retention pins, archival and garbage collection
- window exit/re-entry
- evidence retrieval when media is not resident locally

An ordinary synced Attachment row also must not contain a device-local `media/<sha>` path.

**Fix:** Define separate models:

- Immutable synchronized `RemoteAsset` identity: object key, hash, size, media type.
- Per-device local-only `LocalAsset`: local URI, download state, verified state, retry/session state.
- Custom upload/download queues with temp→verify→atomic-install.
- Reference-aware GC with grace periods and evidence-retention rules.

Until that exists, evidence retrieval on a second device is not designed.

---

### 11. HIGH — Still broken: blocker 1 and gate language exceed the rejected evidence

The exact hand-built `seq > cursor` bug is removed when the application no longer uses that cursor. PowerSync’s documented checkpoint model includes only fully committed transactions, so retiring that precise algorithmic fault as an architectural decision is reasonable. [PowerSync consistency model](https://docs.powersync.com/architecture/consistency)

What is not reasonable is claiming it was “demonstrated 40/40” or that the fault is empirically unreachable. Review #10 explicitly rejected Q1’s VALID PASS and required another run at [CRITIC-REVIEW-10-CODEX.md:9](docs/CRITIC-REVIEW-10-CODEX.md:9>). The banner repeats the rejected conclusion at [DURABILITY-DESIGN-v1.md:11](docs/DURABILITY-DESIGN-v1.md:11>).

The decision can be recorded as “PowerSync adopted despite an uncleared validation gate.” It cannot be converted into verified durability by quieter wording.

**Fix:** Remove “demonstrated,” “40/40,” “fault unreachable” and “dissolved” as evidence claims. Either rerun the corrected frozen oracle or explicitly accept PowerSync’s documented contract as an unverified dependency with a pending fault suite.

---

### 12. HIGH — Still broken: the repository gives mutually exclusive implementation instructions

The closure banner says crash-safe and ready at [DURABILITY-DESIGN-v1.md:5](docs/DURABILITY-DESIGN-v1.md:5>), while the Artifact 1 heading still says DRAFT at [line 53](docs/DURABILITY-DESIGN-v1.md:53>).

Other active contradictions:

- Artifact v2 removes `MEDIA_COMMITTED`, but [line 106](docs/DURABILITY-DESIGN-v1.md:106>) still says saved fires there.
- REQ-CAP5 requires a manifest state of `MEDIA_COMMITTED` at [SPEC-capture-core-v1.md:101](docs/SPEC-capture-core-v1.md:101>).
- REQ-CAP8 still puts `MEDIA_COMMITTED` in the manifest state sequence at [line 107](docs/SPEC-capture-core-v1.md:107>).
- Architecture still says blocker 2 remains open at [ARCHITECTURE.md:18](docs/ARCHITECTURE.md:18>) and describes the obsolete manifest advance at [line 98](docs/ARCHITECTURE.md:98>).
- Implementation Notes marks the gate satisfied despite acknowledging no review of v2 at [IMPLEMENTATION_NOTES.md:211](docs/IMPLEMENTATION_NOTES.md:211>).

These are not cosmetic. An implementer can follow the SPEC and recreate v1’s co-committer.

**Fix:** Withdraw the green banner and gate entry, restore blocker 2 to OPEN, remove `MEDIA_COMMITTED` from every manifest requirement, and use `COMMITTED` solely as a SQLite-derived state.

## Minimum required before A0.2

A0.2 production schema should not begin until:

1. The SQLite/SQLCipher/op-sqlite durability profile is locked and runtime-verifiable.
2. Capture and Attachment are explicitly classified as PowerSync-managed, immutable tables written in one `writeTransaction`.
3. Stable mutation identities and request digests are minted during PREPARE and stored in the manifest.
4. Pending `ps_crud`, durable server receipt and durable rejection/dead-letter are modeled as distinct states.
5. The backend atomically accepts Capture + Attachment and the connector stops discarding partial evidence transactions.
6. Reservation, chunk-log, manifest and media-install protocols are completed with real platform primitives.
7. The recovery matrix covers corruption, wrong hashes, partial rows, queue completion, multiple manifests and DB loss.
8. The custom download/local-cache/GC path is designed.
9. The fault harness proves power-loss durability on physical iOS and Android.
10. The SPEC, Architecture, Durability Design and Implementation Notes agree.

A disposable schema experiment can be run, but it cannot be called A0.2 implementation behind a satisfied durability gate.

**The single most likely way a capture still gets silently lost under Artifact 1 v2:** the SQLite transaction returns under an unspecified WAL durability mode, ordinary iOS `fsync` leaves the media/manifest metadata in volatile storage, the UI shows saved, and a sudden power loss removes both the SQLite commit and the only prepared recovery artifacts—so relaunch classifies the capture as “never started.”
