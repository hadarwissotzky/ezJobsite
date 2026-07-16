# Critic Review #7 — Codex adversarial pass on the durability & sync DESIGN

> **Provenance.** Cross-model adversarial review run per `docs/CODEX-REVIEW-07-PROMPT.md` and `CLAUDE.md §4` (Layer-2 cross-model critic). This is a **real cross-model check** (not a same-model stand-in).
>
> - **Tool:** OpenAI Codex CLI v0.144.4 (`codex exec`), sandbox `read-only`, approval `never`, workdir `development/`.
> - **Model:** `gpt-5.6-sol` at reasoning effort **high**.
> - **Auth:** API key. *(Ran clean; no token-auth hang this time.)*
> - **Primary artifact:** DURABILITY-DESIGN-v1.md (artifacts 1–9). **Also read:** CRITIC-REVIEW-06-CODEX.md, ARCHITECTURE.md, SPEC-capture-core-v1.md, IMPLEMENTATION_NOTES.md, SPIKE-A-BUILD-PLAN.md.
> - **Tokens used:** 145,922.
> - **Run note:** the command as written in `CODEX-REVIEW-07-PROMPT.md` has a shell bug — in `codex … | tee file <<'PROMPT'` the heredoc binds to `tee`, not `codex`, so the model would receive an empty prompt. This run piped the prompt into `codex` directly and redirected stdout to this file. **Fix the recorded command before reusing it.**
>
> **Verdict:** **NOT buildable yet.** Of Codex #6's findings, only **C2** and **H1** are closed. C1/C3/C4/C5/C6/C7/C8 remain open or partial.
>
> **Next step (the gate):** reconcile each finding — adopt / dispute-with-reason / defer — in `IMPLEMENTATION_NOTES §4`; apply fixes to DURABILITY-DESIGN-v1.md + the contradicting docs; **only then** start Spike A.

---

# Verdict

**Not buildable yet.** The rewrite is materially better, but only **C2 and H1 are actually closed**. Several “✅ COMPLETE” artifacts are protocol sketches, not crash-safe specifications.

The three pre-code blockers are:

1. `MEDIA_COMMITTED` still crosses SQLite and the manifest without a defined commit order.
2. The server-sequence pull can permanently skip committed rows.
3. “Everything is append-only” contradicts the mutable data model and the project-merge procedure.

## Review #6 verification

### Criticals

| Finding | Status | Assessment |
|---|---|---|
| **C1 premature saved** | **OPEN — partial fix** | “Saved” is correctly delayed, but step 6 still pretends SQLite commit and manifest advancement are one operation. Crash reconciliation is undefined when only one commits. |
| **C2 impossible absolute guarantee** | **RESOLVED** | The honest acknowledgement invariant and residual-loss boundaries are explicitly adopted. Stale “unloseable/never lose” wording remains elsewhere but does not change the design. |
| **C3 media encryption/background upload** | **OPEN** | Option B is selected, but the lifecycle is not designed, and Architecture still specifies plaintext upload followed by server-side encryption. |
| **C4 push/object idempotency** | **OPEN — partial fix** | Stable IDs, transactional receipts and immutable keys appear, but receipt scope, request binding, recovery identity and concurrent upload semantics remain unsafe. |
| **C5 pull is not a sync protocol** | **OPEN** | A sequence and cursor were added, but sequence allocation is not commit-ordered, cursor/checkpoint atomicity is absent, and window/revocation handling is unsound. |
| **C6 raw-video recovery contradiction** | **OPEN** | The required encrypted journaled temporary video was not added. SPEC and Architecture still say raw video is never stored. |
| **C7 fictitious common authz predicate** | **OPEN — partial fix** | Postgres functions are named, but service-role enforcement, grants, nested-resource constraints and several transport paths remain bypassable. |
| **C8 Edge→job dual write** | **OPEN — concept mostly fixed** | The outbox pattern is correct if mandatory, but nothing prevents alternate writes from bypassing it, and object-storage finalization remains a cross-system dual write. |

### Highs

| Finding | Status | Assessment |
|---|---|---|
| **H1 PowerSync false dichotomy** | **RESOLVED as a decision** | P1 is restricted to append-only sync. The decision is closed, although the chosen protocol remains defective. |
| **H2 queue concurrency/retry** | **OPEN** | No client worker leases, ownership epochs, retry deadlines, concurrency limits or client dead-letter protocol. |
| **H3 key-loss deletion** | **OPEN — partial fix** | Hard recovery is specified, but restore, migration and interrupt-safe rekey are assertions, not protocols. |
| **H4 DB-corruption recovery** | **OPEN — partial fix** | Sidecars were introduced, but their format, authentication, key material and deterministic rebuild procedure remain undefined. |
| **H5 bounded Edge requests** | **OPEN — partial fix** | ADR-5 says “small and bounded,” but no actual batch limits, response limits or transaction budgets are declared. |
| **H6 Storage/R2 mismatch** | **LOCALLY RESOLVED, DOC SET OPEN** | Durability selects Supabase Storage, while Architecture still centers R2 and Spike A calls the later swap “isolated.” |
| **H7 account changes** | **OPEN** | Revoked mutations are suspended, but immutable account/device binding and export/reassignment policy are absent. A revoked client may be unable to pull its purge tombstone. |
| **H8 semantic dedup** | **OPEN — partial fix** | Human-confirmed project merge is correct, but “transactional child-repointing” mutates immutable children and has no merge-vs-new-child race protocol. |
| **H9 broken gate can pass** | **OPEN — improved** | Release builds and a stronger oracle were added, but failpoints occur only after coarse states, missing the dangerous substeps. |
| **H10 statistical target** | **OPEN — partial fix** | Capture gets a numeric target; sync says only “declared N,” and physical-device/recovery targets remain vague. |
| **H11 missing fault classes** | **OPEN — partial fix** | Many were added, but important crypto, cursor, merge, post-save corruption and purge/GC faults remain absent. |
| **H12 sequencing/contradictions** | **OPEN — partial fix** | Design-first sequencing is corrected. Major contradictions remain across Architecture, SPEC and Spike A. |

## Critical remaining findings

### 1. `MEDIA_COMMITTED` is still not a commit protocol

The design acknowledges that SQLite and the filesystem cannot share a transaction, then combines them again in step 6: “one SQLite transaction … advance manifest to `MEDIA_COMMITTED`.” [DURABILITY §1.3](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/DURABILITY-DESIGN-v1.md:55>)

There are two unhandled crash states:

- SQLite commits, then manifest advancement fails. Recovery sees `VERIFIED` but existing rows and mutation.
- Manifest commits first, then SQLite rolls back. Recovery sees `MEDIA_COMMITTED` with no rows.

The recovery table instead assumes “rows + manifest agree” after `MEDIA_COMMITTED`. [DURABILITY §1.4](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/DURABILITY-DESIGN-v1.md:68>)

Additional holes:

- No atomic temp-write → file `fsync` → rename → directory `fsync` protocol for manifest generations.
- The manifest is described as both content-addressed and continuously appended; those properties are incompatible unless it is explicitly versioned.
- Chunk data and chunk-log entries have no paired durability order. A torn manifest can claim an absent chunk, or durable media can have no logged tail.
- The finalized temp file is never atomically renamed to its content-addressed permanent path after its final hash is known.
- “Disk-space lease” does not reserve blocks; ENOSPC can still strike the manifest or final rename.

This can still produce a phantom saved item or an unrecoverable disagreement.

### 2. The sequence pull can permanently miss a capture

The claim that concurrent inserts always receive a higher sequence than the cursor is false unless sequence assignment is commit-ordered. [DURABILITY §2.3](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/DURABILITY-DESIGN-v1.md:110>)

Normal Postgres failure:

1. Transaction A allocates tenant sequence 10 and stalls.
2. Transaction B allocates 11 and commits.
3. Device pulls 11 and advances its checkpoint.
4. A commits sequence 10.
5. `seq > 11` will never return A.

Other cursor defects:

- The API takes `since=<seq>` while pagination is supposedly by `(seq,id)`. Rows sharing a sequence can be skipped at a page boundary.
- Applying pulled rows and advancing the SQLite checkpoint are not required to occur in one transaction. Checkpoint-first loses rows; row-first merely duplicates safely.
- There is no fixed response high-watermark/snapshot boundary.
- Pull-side parent-before-child ordering and parking are unspecified.
- A revoked user may no longer be authorized to pull the revocation tombstone intended to purge their device.
- Time-based window exits occur without a database mutation, and re-entry will not resend old rows already below the checkpoint.

C5 therefore remains fully open.

### 3. L5 is false for the actual product model

The protocol says every synchronized fact is immutable, yet the surrounding model requires mutations to:

- project status, address and membership;
- grant/revocation state;
- `Capture.remote_uri`, resolution and processing state;
- `Decision.current_value`;
- translation cache and `content_version`;
- notification read state;
- processing jobs and usage counters.

These mutable fields are explicit in the SPEC data model. [SPEC §8](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPEC-capture-core-v1.md:242>)

The merge flow is also self-contradictory: it claims to append an alias “never by editing” while transactionally repointing children. [DURABILITY §2.5](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/DURABILITY-DESIGN-v1.md:126>) Repointing an approved record changes its context and violates L4.

The design must either:

- limit append-only guarantees to an immutable evidence ledger and define a separate versioned change log for mutable operational state; or
- event-source/version every synchronized entity.

Until then, C5 has merely been moved behind an invalid premise.

### 4. Option B is not a key-lifecycle design

DURABILITY says the device creates a DEK and uploads ciphertext unchanged. [DURABILITY §4](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/DURABILITY-DESIGN-v1.md:151>) Architecture says the client uploads plaintext to R2 quarantine, the server encrypts it, and “the client never holds DEKs.” [ARCHITECTURE §3.3](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/ARCHITECTURE.md:80>) Both cannot be implemented.

Still undefined:

- AEAD algorithm, nonce uniqueness, chunk authentication and anti-reordering binding.
- Where device-wrapped and server-wrapped DEKs live so a corrupted SQLite database can be rebuilt from sidecars.
- Server ingest public-key versioning, rotation and old-client compatibility.
- Interrupt-safe device-master-key and SQLCipher rekey procedures.
- File-protection class for the ciphertext itself; `AfterFirstUnlock` on the key does not make an inaccessible media file uploadable.
- Plaintext handling by the native recorder, video extraction, server STT, logs, crash dumps and job scratch space.
- Restore/device-transfer authentication and recovery flow.

Crypto-shred is also not complete. Destroying the media DEK does not erase transcripts, translations, thumbnails, exports, AI-provider copies, device caches, database backups or plaintext job artifacts. Architecture itself admits devices that never reconnect cannot be purged. [ARCHITECTURE §11](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/ARCHITECTURE.md:213>)

### 5. The integrity chain is hashes without a trust anchor

The sidecar’s authentication format is explicitly still an open sub-decision, despite Artifact 3 being marked complete. [DURABILITY §1.6](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/DURABILITY-DESIGN-v1.md:80>)

Plaintext and ciphertext hashes do not, by themselves, bind:

- tenant, project, capture and asset IDs;
- ordered chunk metadata;
- wrapped DEKs and crypto version;
- record/version identity;
- approval identity and scope.

The signature specification hashes `shown_content`, but it does not define one canonical signed payload binding the content to tenant, project, record version, approver, media roots and challenge. A valid approval artifact could therefore be transplanted or detached from the evidence it supposedly freezes.

### 6. Canonical Postgres authz remains optional

“Service-role code must call `can_*` explicitly” is not enforcement; it is another convention that one new path can forget. [DURABILITY §5](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/DURABILITY-DESIGN-v1.md:163>)

Remaining bypasses and holes include:

- raw service-role DML from Edge Functions, jobs, maintenance scripts or webhooks;
- Next.js/server routes not enumerated in Artifact 5;
- callable RPC functions and database roles/grants;
- TUS capabilities continuing after membership revocation;
- a check-then-write race if authorization and mutation are separate calls;
- nested cross-tenant references not prevented by tenant-qualified composite foreign keys;
- caller-supplied `actor` rather than server-derived `auth.uid()`/trusted worker identity;
- UPDATE/DELETE of approved rows by service-role paths.

The root of trust should be canonical mutation functions with raw table DML revoked from application roles, not `can_*` calls that privileged code may omit.

## High findings

- **Identity can still duplicate or suppress mutations.** UUIDv7 is random, not deterministic. The receipt is keyed only by mutation ID, with no tenant/device scope or immutable request digest. Replaying one ID with different content can return the old result and silently suppress the new capture. DB reconstruction can mint a second mutation ID unless the original is in the durable manifest. Concurrent retries can create multiple TUS sessions; re-encrypting the same plaintext creates different ciphertext and therefore different object keys. SHA-256 collision between distinct plaintexts is not the practical threat—the identity lifecycle is.

- **Parent parking is undefined and can poison idempotency.** If the server stores a receipt while “parking” a child whose parent is absent, retries may forever replay the parked result without creating the child. It must either reject without consuming the mutation ID or durably store a pending mutation that is later applied exactly once.

- **Object verification and row linking are not atomic.** An object can disappear after verification but before or after the Postgres transaction. The sweeper proves orphans are possible, contradicting the claim that they are impossible. GC also needs an upload-session ledger and grace period so it does not delete a valid object awaiting delayed finalize.

- **The outbox closes only one dual write.** It needs a mandatory database transition—trigger or sole finalize function—plus lease token/expiry/CAS acknowledgement. `(capture_id, content_version)` is insufficient across different event kinds or pipeline versions, and downstream writes, notifications and metering need their own idempotency constraints.

- **Client queue concurrency remains unspecified.** Artifact 6 covers the server dispatcher, not foreground/background client drainers. Persistent leases, fencing epochs, dependency scheduling, backoff, `Retry-After`, retry ceilings and dead-letter behavior are still absent.

- **Video recovery is still impossible as written.** SPEC requires recoverable mid-video interruption but says raw video is never stored. [REQ-CAP6/TL4](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPEC-capture-core-v1.md:103>) It needs an encrypted journaled temporary raw asset retained until all derivatives are verified and registered, followed by recoverable cleanup.

- **Artifact 8 can certify a broken implementation.** “After every state transition” misses the dangerous boundaries inside transitions: chunk write/log ordering, manifest temp write/rename/fsync, media rename, SQLite commit/manifest promotion, sequence allocation/commit, pull apply/checkpoint, DEK wrap persistence, object verify/link and outbox claim/ack.

- **The targets remain incomplete.** Only core capture has `<10^-4 @ 95%`. Sync has an undeclared `N`; physical-device runs say “hundreds”; recovery has no quantitative criterion. SPEC also requires 100 offline/online cycles, while Spike A still centers one round trip. [REQ-PROC4](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPEC-capture-core-v1.md:129>)

Missing fault classes include sequence commit inversion, same-sequence page boundaries, window exit/re-entry, revocation-before-purge, manifest torn write/tamper, wrong key, interrupted rekey, KMS rotation/outage, media corruption after saved, locked-device reboot, local GC crash, merge racing a new child, changed-payload idempotency replay and approval/outbox duplicate side effects.

## Cross-document contradictions

- **Encryption:** client-side ciphertext upload vs plaintext quarantine/server encryption.
- **Storage:** Supabase Storage locked for P1 vs R2-centric Architecture and an “isolated” later swap.
- **Authz:** canonical Postgres functions vs ADR-5/shared Hono middleware as the predicate.
- **Capture commit:** exact state machine vs Architecture’s old “write Capture immediately; confirm on local write” flow. [ARCHITECTURE §3.1](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/ARCHITECTURE.md:65>)
- **Sync:** append-only inserts vs Spike A “dedups and upserts” and “server truth reconciles local rows.” [Spike A A2.2–A2.3](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPIKE-A-BUILD-PLAN.md:102>)
- **Status:** Spike A says never show fake `ready`, then specifies a no-op processing→ready transition.
- **Outbox gate:** jobs are explicitly out of Spike A, but the exit gate requires no attachment without a job. [Spike A stack/exit](</Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development/docs/SPIKE-A-BUILD-PLAN.md:71>)
- **Authz gate:** full authz is explicitly out of scope, but the same exit gate requires every transport path.
- **Decision state:** Spike A still says ADR-2 is reopened while DURABILITY and Architecture say it is resolved.
- **Journal:** SPEC still says “marked complete,” contradicting the explicit ban on a boolean completion model.
- **Video:** Review #6 reconciliation adopted temporary encrypted raw video, but SPEC and Architecture were never updated.

Do not begin A0.2. The “complete” labels should be removed until the SQLite/manifest truth table, commit-ordered sync cursor, immutable-vs-mutable data boundary, encryption/key protocol and enforceable database API are written.

**Single most likely remaining field failure:** a server transaction obtains a lower `seq`, commits after the device has checkpointed a later `seq`, and that capture silently never appears on the device.
