# EZjobsite — Durability & Sync Design (the pre-code design gate)

> **What this is.** The design pass Codex #6 required before any Spike A code. It answers the 9 artifacts from `SPIKE-A-BUILD-PLAN.md §0.5` at the protocol level, so the build derives from written invariants instead of improvising durability in code. Decisions locked 2026-07-16: **append-only sync (ADR-2)** · **honest save-invariant (CLAUDE #1)** · **immutable media + versioned records + approval-freeze** · **DECISION 4 (~~Option B~~ → **Option A**, re-decided 2026-07-16 — client-side media encryption dropped for v1)** · **DECISION 7 (Supabase Storage)**.
>
> ## ⛔ STATUS 2026-07-16 (corrected) — BLOCKER 2 IS **NOT** CLOSED. **DO NOT BEGIN A0.2.**
>
> **`CRITIC-REVIEW-11-CODEX.md` reviewed Artifact 1 v2 and rejected it: *"Is blocker 2 closed? NO. Is Artifact 1 v2 a crash-safe specification? NO. Is it safe to begin A0.2 schema code? NO."* All findings adopted; none disputed.** An earlier version of this banner claimed all three blockers were closed and A0.2 could begin. **That was wrong and is retracted** — it is the third time this document has labelled a sketch complete, which is why the label now costs a review to earn.
>
> **v2's central claim — *"the phantom-saved state is unrepresentable"* — is WITHDRAWN. Two independent phantoms were constructed:**
>
> 1. **A returned SQLite commit is not durable.** v2 asserted *"SQLite's commit is atomic, so there is no instant at which the app has said 'saved' and the capture is not committed."* **That conflates atomicity with durability.** In WAL mode under `synchronous=NORMAL`, COMMIT returns **without fsyncing the WAL**; power loss rolls it back. §1.3 specifies no `journal_mode`, `synchronous`, `fullfsync`, checkpoint policy, or runtime assertion that the pragma took effect — and on iOS ordinary `fsync` is not the real barrier (`F_FULLFSYNC` is). **Phantom: commit returns → "saved ✓" → power loss → rows gone.**
> 2. **`ps_crud` is a transient queue, not a permanent recovery fact.** `tx.complete()` **removes** entries — our connector does exactly that. So **row 8 is the normal post-upload state, not "unrepresentable"**, and the §1.5 oracle would fire on every successful upload. Worse: PowerSync **reverts local state** once the queue drains if the backend rejected the mutation, and our connector sends Capture and Attachment as **separate Supabase requests** and completes the txn anyway → *Capture accepted + Attachment rejected → the server checkpoint overwrites the local rows.* **Phantom: saved → queue drained → capture gone.**
>
> **What survives:** the **PREPARE/DECIDE split is correct** — Codex confirms it eliminates v1's two half-commit states. *"Splitting authority is the right architecture."* But a correct skeleton is not a protocol. **Artifact 1 v2 is the protocol skeleton, not a specification.**
>
> | Blocker | Real status |
> |---|---|
> | **1 — `seq` pull not commit-ordered** | ⚠️ **Retired as an algorithmic fault, NOT empirically demonstrated.** We no longer write a `seq` cursor, and PowerSync's documented checkpoint model includes only fully-committed transactions — Codex agrees retiring the precise fault is reasonable. **But the "demonstrated 40/40 / the fault is unreachable" wording is WITHDRAWN**: review #10 rejected Q1's VALID PASS. The honest record is **"PowerSync adopted despite an uncleared validation gate"** (ADR-2), which cannot be converted into verified durability by quieter wording. |
> | **2 — `MEDIA_COMMITTED` not atomic** | ⛔ **OPEN.** Diagnosis right, conclusion premature. Needs: a durability profile (pragmas + `F_FULLFSYNC` + runtime assertion), a queue-lifecycle model that does not treat `ps_crud` as permanent, a complete + safe truth table, and real filesystem operations. |
> | **3 — L5 false for the data model** | ⚠️ **Direction resolved (option (a)), not proven.** Evidence-ledger append-only enforced by our rules; mutable state via PowerSync. Rests on bakeoff Q2, whose VALID PASS review #10 also rejected. |
>
> **ADR-2 is unaffected** — it does not depend on Artifact 1, and it was knowingly taken over an uncleared gate (see `ARCHITECTURE.md`).
>
> **Still open and carried into Spike A (named, not hidden):** `REQ-MEMBER-5` revocation is undefined (cited 4×, defined 0×) · *"last-N-days"* windowing is not expressible server-side in Sync Streams · a client write to a server-owned field is applied locally then **silently reverted with no rejection hook** (a UX defect to design around) · **whole-file media memory behaviour on-device is untested**.
>
> <details><summary>The three blockers as originally written (2026-07-16, pre-decision) — retained for provenance</summary>
> 1. **The `seq` pull is not commit-ordered → a capture can be silently lost forever.** §2.3's claim that concurrent inserts always receive a *higher* seq than the cursor is **false**: Postgres sequence allocation is not commit-ordered. Txn A takes seq 10 and stalls; B takes 11 and commits; the device pulls 11 and advances its checkpoint; A then commits 10; `seq > 11` never returns it. *(Codex's pick for the single most likely field failure.)*
> 2. **`MEDIA_COMMITTED` is not atomic.** §1.1 correctly states the filesystem and SQLite cannot share a transaction — then §1.3 step 6 recombines them ("one SQLite transaction … **and** advance manifest"). Two commits, two systems. §1.4's recovery table assumes "rows + manifest agree" and has **no row** for either half-committed state.
> 3. **L5 ("sync is append-only") is false for the actual data model.** Append-only holds for *evidence* (media, capture receipts, record versions, approvals) but **not** for operational state, which SPEC §8 makes mutable: `Capture.processing_state` / `remote_uri` / `resolution_status`, `Decision.current_value`, `Notification.read_state`, `Project.status`, `ProcessingJob.state`, `content_version`. §2.6's "what append-only let us delete from the design" was banked against a premise that does not hold model-wide.
>
> </details>
>
> Full findings + reconciliation: `CRITIC-REVIEW-07-CODEX.md` · `BAKEOFF-RESULT.md` · `IMPLEMENTATION_NOTES.md §4`.

---

## 0. The data-model laws everything obeys

These come from hadar's append-only decision and make the durability problem tractable.

- **L1 — Media is immutable.** An audio file or image, once captured, is **never edited, re-encoded in place, or merged.** It is content-addressed (named by its own hash) and write-once. We never merge an audio file.
- **L2 — The only thing that merges is derived text.** After transcription, the *text/decision record* may be revised or aggregated. That is a small, structured, text-level operation — not a media operation.
- **L3 — Records are versioned; history is retained.** A change to a record creates a **new version row**; prior versions are kept. The original recording + images are retained as **tamper-proof evidence** — if anyone disputes what was said or shown, the original stands.
- **L4 — Approval freezes AND makes permanent.** Once a record is **digitally approved/signed**, that version is **frozen** — never edited in place, **and never deleted.** A later change is a **new appended record/version** carrying its own approval; a "removal" is a new superseding record, never destruction of the approved one. (Composes with "frozen `shown_content` = the binding signed artifact.") **The one lawful exception (REVISED 2026-07-16 with DECISION 4 → Option A):** a valid GDPR/CCPA erasure request **hard-deletes the personal content + media** **but retains the hash + metadata stub** — so the evidence-chain skeleton (that an approved record existed, when, by whom, its hash) survives even though the personal data is destroyed. That is the *only* path by which an approved record's data leaves, and it is a controlled destruction-with-tombstone, not an edit or a delete.

> **Why hard-delete, not crypto-shred.** This carve-out previously specified crypto-shred, which is what forced Option B. But the **plaintext class (transcripts, `canonical_en`, FTS index) was always hard-deleted anyway** (`CRITIC-REVIEW-02` H1), so crypto-shred only ever covered the media blob — and its sole advantage over deletion (reaching unreachable backups) was already conceded (`CRITIC-REVIEW-04-CODEX`: *"document backup expiry rather than claiming immediate complete erasure"*). Hard-delete reaches the live object and every replica we control; **backups expire on a documented schedule.** That is an **honest, named residual boundary**, not a hidden gap — the same discipline mandate #1 applies to capture loss.
>
> **Erasure inventory (unchanged and still required):** deletion must cover Storage object · Postgres row + FTS index · job payloads · caches · **device local copies (purge command)** · logs. Vendor (STT/LLM) retention and expired-backup windows are **stated residual boundaries**. Crypto-shred never fixed these either.
- **L5 — Therefore sync is append-only.** Every sync operation is an **append of a new immutable row** (a capture receipt, or a new version). Nothing already synced-and-approved is ever mutated. This is what lets the sync protocol (artifact 2) avoid a general two-way merge engine.

  > ### ⚠️ L5 IS FALSE AS STATED — OPEN GAP (Codex #7, blocker 3)
  > Append-only is true of the **evidence** (media, capture receipts, record versions, approvals) but **not of the whole model.** SPEC §8 defines genuinely **mutable operational state**: `Capture.processing_state` / `remote_uri` / `resolution_status` · `Decision.current_value` · `Notification.read_state` · `Project.status` (active/archived) · `ProcessingJob.state` · `content_version` · translation cache · grant/revocation state · usage counters. These change in place and must sync.
  > **This matters because L5 is the premise Artifact 2 rests on** — §2.6's "what append-only let us delete from the design" (oplog merge, LWW, vector clocks, base/overlay reconciliation, edit-conflict resolution) was banked against a property the model does not have. Codex: *"C5 has merely been moved behind an invalid premise."*
  > Resolution requires a decision (**not made here** — it is entangled with the pending ADR-2 / PowerSync-bakeoff call): either **(a)** scope append-only to an immutable **evidence ledger** and define a separate versioned change log for mutable operational state, or **(b)** event-source/version **every** synchronized entity so L5 becomes literally true. Until then, treat every "because append-only…" justification in Artifact 2 as **unproven**.

**The honest save-invariant (CLAUDE #1):** *Never acknowledge a capture ("saved ✓") unless a verified recoverable copy + durable recovery intent exist; refuse to start loudly when capacity/permission can't be reserved.* Residual-loss boundaries (named, not hidden): total device loss/destruction, app-data deletion, encryption-key loss, correlated filesystem destruction.

---

## Artifact 1 — The capture-commit state machine  ⚠️ DRAFT — open gaps per Codex #7

*This is the crux — the exact ordered sequence from "user hits record" to a trustworthy "saved ✓," designed so that a kill/crash/power-loss at **any** point leaves either a fully-committed capture or a **recoverable** one, never a phantom "saved" pointing at nothing. It fixes Codex #6 C1 (premature "saved") and is built to survive C2/H3/H4 (single-device fault domain).*

> ## ⛔ BLOCKER 2 IS OPEN — Artifact 1 v3: the single ordered commit protocol (SKELETON, not a specification)
>
> *(This header previously read "✅ BLOCKER 2 CLOSED". **Retracted** — `CRITIC-REVIEW-11-CODEX` rejected that closure with 3 CRITICALs. Leaving a green header above a rejected protocol is exactly the finding-H12 defect this section was corrected for. See the status banner at the top of the file.)*
>
> `CRITIC-REVIEW-07-CODEX` blocker 2 (*"`MEDIA_COMMITTED` is not atomic"*) is **diagnosed and its v1 two-authority error is eliminated** — Codex #11 confirms *"splitting authority is the right architecture."* **It is not resolved.** §1.0–§1.4 below are **v3**, which addresses all 12 of #11's findings but has **not been reviewed**. v1/v2 are preserved in git (`a5a8198^`, `84f4c27`).
>
> **The bug, named precisely.** v1's §1.1 declared the manifest *"the recovery source of truth, independent of SQLite"* — and then §1.2 made `MEDIA_COMMITTED` a **manifest state**. So the manifest was asked to record *"is this capture committed?"*, which is a fact **only SQLite can know**, because SQLite holds the rows. **Two authorities for one fact.** Both unhandled crash states fall directly out of that, and no amount of ordering fixes it — you cannot make two storage systems agree by trying harder.
>
> **The fix is to split the question, not to synchronise the answer:**
>
> | Question | Sole authority |
> |---|---|
> | *"Was media made, and where are its bytes?"* | **the manifest** (survives SQLite loss — H3/H4) |
> | *"Is this capture committed?"* | **SQLite, exclusively** |
>
> **The manifest's terminal state is `VERIFIED`. It has no `MEDIA_COMMITTED` state and never records commitment.** Commitment is derived by looking in SQLite.
>
> **Therefore: the filesystem is PREPARE; SQLite's transaction is DECIDE.** One commit point. Everything before it is idempotent and re-doable; everything after it is derived. This is the standard two-system resolution and v1 missed it by trying to make the manifest a co-committer.
>
> **v1's two *manifest-vs-SQLite* crash states become unrepresentable** — and **only those two.** Codex #11 confirms this much: *"The two v1 half-commit states identified in review #7 really are eliminated."*
> - ~~"SQLite commits, manifest advance fails"~~ → **there is no manifest advance after the SQLite commit.**
> - ~~"Manifest says `MEDIA_COMMITTED`, SQLite rolled back → phantom saved"~~ → **the manifest cannot say committed.**
>
> A verified manifest with no SQLite row is not a contradiction — it is a **well-defined orphan awaiting commit**, and `"saved ✓"` was never shown for it.
>
> > ### ⚠️ SCOPE THIS CLAIM NARROWLY — it does NOT mean "no phantom is possible"
> > Eliminating v1's *two-authority* states is **not** the same as eliminating phantom "saved". **Two other phantoms remain open** and are unaffected by this split: a **non-durable SQLite COMMIT** (`synchronous=NORMAL`) and **`ps_crud` completion/discard reverting the rows**. See the status banner. **The general claim was withdrawn; this narrow one stands.**
>
> **PowerSync (ADR-2) makes step 6 genuinely one transaction, for free.** `ps_crud` is a local table **in the same SQLite database**, so the outbound intent commits in the *same* transaction as the domain rows. There is no separate queue to write, and therefore **no window where a capture is "saved" but has no sync intent** — v1 had to hand-build that property; we now get it from the transport.

### 1.0 The durability profile — v3 (⛔ WITHOUT THIS, NOTHING BELOW IS DURABLE)

*New in v3. Codex #11 CRITICAL 2: v2 assumed a returned COMMIT is durable. It is not. This section is the precondition for every claim in Artifact 1; if any assertion here fails at runtime, **capture must refuse to start** (honest invariant, mandate #1).*

| Setting | Required value | Why |
|---|---|---|
| `journal_mode` | `WAL` | Concurrency; PowerSync expects it. |
| `synchronous` | **`FULL`** | Under `NORMAL`, COMMIT returns **before the WAL is fsynced** — power loss rolls back a transaction the UI already called "saved". `FULL` syncs the WAL at each commit. **This is the setting that makes DECIDE mean anything.** |
| iOS barrier | **`F_FULLFSYNC`** | On Apple platforms ordinary `fsync()` returns before the drive has flushed its cache. `F_FULLFSYNC` is the real barrier — and Apple documents even it as best-effort under sudden power loss (**a named residual boundary**). |
| Android/Linux barrier | `fsync()` + parent-dir `fsync()` | Directory entry durability is separate from file content durability. |
| `wal_autocheckpoint` | explicit, not default | Checkpoint policy must be stated, not inherited. |

**Runtime assertion, not configuration.** On every open, read the pragmas back (`PRAGMA journal_mode; PRAGMA synchronous;`) and assert the values actually took effect. **A pragma that silently failed to apply is indistinguishable from data loss at 3am.** If the assertion fails → hard error, refuse to arm the recorder.

**⚠️ Cross-connection hazard (open).** `synchronous` is **per-connection**. PowerSync and op-sqlite open their own connections and may set their own values. **We do not currently control what they set, and a `NORMAL` connection committing our rows would silently defeat this.** Must be resolved before A0.2: pin it via op-sqlite open options, verify on every PowerSync-owned connection we can reach, and add a startup assertion. **Not yet designed — this is a real open item, not a checkbox.**

**Cost, stated honestly:** `synchronous=FULL` + `F_FULLFSYNC` is measurably slower per commit. That is the price of "saved" meaning saved. **Never trade it for capture latency.** If it proves too slow, the answer is fewer commits, not weaker ones.

### 1.0b Identity is minted at PREPARE, not at COMMIT — v3

*New in v3. Codex #11 HIGH 9: Artifact 3 minted the mutation id at SQLite commit, but nothing is written to the filesystem after that commit — so **a lost DB loses the identity**, and row 9's "rebuild from manifests" would mint a *different* mutation id, duplicating a server mutation or wrongly suppressing a changed-payload replay.*

**Therefore:** `capture_id`, `attachment_id`, `mutation_id` (UUIDv7) **and a canonical request digest** are generated during PREPARE and written into the **terminal manifest**, alongside the **complete canonical Capture/Attachment payload** needed to reconstruct the rows byte-exactly.

**This does NOT make the manifest a commitment authority.** It still cannot say "committed". It preserves **recovery identity** so that a rebuild re-runs DECIDE with *the same* identity — making the retry genuinely idempotent end-to-end, not just locally.

### 1.1 Why a state machine + a sidecar manifest (not a boolean) — v2

The four durability events v1 conflated — **journal commit, media-file commit, DB-row commit, outbound-intent commit** — happen on **two storage systems that cannot share a transaction**: the **filesystem** (media) and **SQLite** (rows). No single `COMMIT` makes both atomic. **So we stop trying.** Instead:

1. **One commit point.** The **SQLite transaction is the only commit.** Every filesystem step before it is a *prepare*: durable, idempotent, and safe to re-run. Nothing is written to any other system after it.
2. **Two authorities, two questions, no overlap.** The **manifest** answers *"was media made, and where are its bytes"* — it is the recovery source of truth **independent of SQLite**, so if SQLite is corrupted or its key is lost (H3/H4), manifests + content-addressed media reconstruct the index. **SQLite** answers *"is this capture committed"* — and nothing else may claim to answer it.
3. **`"saved ✓"` is emitted only after the SQLite commit returns.**
>
> ### ⛔ THE CLAIM THAT WAS HERE IS FALSE — WITHDRAWN (Codex #11 CRITICAL 2)
> This point previously read: *"SQLite's commit is atomic, so there is no instant at which the app has said 'saved' and the capture is not committed."*
>
> **That conflates atomicity with durability. They are different properties.** Atomicity means you never see half a transaction. **Durability means it survives power loss — and a returned COMMIT does not guarantee it.** In WAL mode under `synchronous=NORMAL`, COMMIT returns *before* the WAL is fsynced; a power cut rolls the transaction back after the UI has already said "saved". On iOS, ordinary `fsync` is not the barrier either — `F_FULLFSYNC` is, and even that is best-effort under sudden power loss.
>
> **"Commit returned" ≠ "durable" is now a first-class requirement, not an assumption.** Before this step can be built, §1.3 must specify and *assert at runtime*: `journal_mode` · `synchronous` (**FULL**, not NORMAL, for the capture-commit transaction) · `fullfsync` · checkpoint policy · VFS assumptions · what happens if PowerSync or op-sqlite changes these on another connection. **None of that is written yet.**

**What this buys — stated honestly:** the PREPARE/DECIDE split **eliminates v1's two half-commit states** (Codex #11 confirms: *"Splitting authority is the right architecture… The two v1 half-commit states really are eliminated"*). It does **not** yet make a phantom "saved" unrepresentable — **that claim is withdrawn**, and two independent phantoms remain open (see the status banner). **This is the protocol skeleton, not a specification.**

### 1.2 The states (per capture)

| State | Meaning | Durable artifact written | UI shows |
|---|---|---|---|
| `RESERVED` | Storage quota + permissions reserved. If they can't be → **refuse loudly**, never a silent half-start (honest invariant). | disk-space lease | (arming…) |
| `STARTED` | **Write-ahead journal + sidecar manifest** written *before the recorder is armed and before any network* (REQ-CAP8): capture id, project, author, start time, modality, intent, capture-key id. | journal row + sidecar manifest v0 | "recording" |
| `RECORDING` | Encrypted media streams to a **temp file** in chunks; each chunk's `(seq, length, hash)` is appended to the manifest as it lands. | media temp + manifest chunk log | "recording" |
| `FINALIZING` | Recorder stopped. Container footer written; **`fsync` the file, then `fsync` the parent directory** (so the file's existence itself is durable). | finalized media file | "finishing…" |
| `VERIFIED` | Media re-opened and checked: decodable, duration credible, full-file hash matches the chunk log. A truncated/garbled file is caught **here**, not after "saved." | manifest marked `media-verified` + final content hash | "finishing…" |
| `COMMITTED` **(v2 — was `MEDIA_COMMITTED`)** | **The single commit point.** One SQLite `writeTransaction` inserts the `Capture` row + the `Attachment` row (pointing at the content-addressed media). PowerSync writes the matching `ps_crud` entries **in that same transaction**, so the outbound intent is atomic with the rows. **Nothing is written to the filesystem after this.** The manifest is *not* touched — it stays `VERIFIED`, which is its terminal state. | **SQLite txn only** (rows + `ps_crud`) | **"Saved on this phone ✓ — not backed up yet"** ← *the ONLY place "saved" fires, and only after `COMMIT` returns* |
| `QUEUED` | **Not a separate state — it is the same transaction.** The `ps_crud` rows PowerSync creates alongside the domain rows *are* the queue entries. There is **no window** where a capture is "saved" but has no sync intent, and we did not have to build that property. | (part of the `COMMITTED` txn) | "saved — waiting to back up" |
| `UPLOADED` | Media object uploaded to storage; object existence + checksum verified server-side. | server object + local state | "backing up…" |
| `SYNCED` | Server receipt for the append-mutation received; capture-receipt durably on the server. | server receipt | **"Backed up ✓"** |

**"Saved ✓" fires only at `MEDIA_COMMITTED`.** Everything before it shows an in-progress state. Nothing downstream (upload, server) is required for "saved" — that's the offline guarantee — but everything *local* (verified media + committed rows + committed outbound intent) **is** required.

### 1.3 The single ordered commit protocol — v2 (✅ closes blocker 2)

**One commit point (step 6). Steps 1–5 are PREPARE: durable, idempotent, re-runnable. Step 7 is derived.**

**Precondition: §1.0's durability profile is asserted, or capture refuses to start.**

1. **RESERVE — preallocate the ACTUAL media file, not a decoy.** *(v2 was wrong: Codex #11 HIGH 5. Zero-filling `reserve/<id>.blk` reserves blocks that belong to **that** file, while recording writes into `tmp/<id>.part` — so it needs **~2× max media size**, and deleting the decoy to free space **reintroduces the exact race it was meant to prevent**. v2 also deleted it *before* the SQLite commit, letting another writer take the space before the WAL sync.)*
   - **Preallocate `tmp/<id>.part` itself**: Apple **`F_PREALLOCATE`** (allocate-all semantics), Linux/Android **`posix_fallocate`/`fallocate`**. **Verify allocation, not logical length** — `ftruncate` yields a sparse file that fails later.
   - Keep a **small, separate, non-purgeable reserve for metadata** (manifest + chunk log + **SQLite WAL growth**), in a location the OS will not purge. `reserve/` was unspecified in v2 and could be OS-purgeable.
   - **Release the metadata reserve only after durable DECIDE.** Post-commit cleanup is derived and idempotent.
   - If either allocation cannot be **guaranteed** (or permissions/mic fail) → **refuse loudly and record nothing.**
2. **STARTED — manifest generation 0, before the recorder is armed** (REQ-CAP8). Contains the **PREPARE-minted identity** (§1.0b). Installed atomically: unique temp → write → barrier → **no-replace install** → dir barrier. See §1.3b.
3. **RECORDING — paired durability, data before log.** For each chunk: **exact-write loop** (handle short writes) → **barrier the chunk DATA** → **reread the written bytes** → append a **framed** record to `chunks.log` → barrier the log. **Data-before-log is load-bearing**: the log can never reference bytes that are not durable.
   Each record carries: **framing magic + version + record length + strict monotonic `seq` + `offset` + `len` + a framed-record CRC32 (torn-tail detection) + a SHA-256 digest of the exact chunk bytes (integrity)**. *(v2 said "hash" in the states table but only stored `crc32` in step 3, and never said what the CRC covered — Codex #11 HIGH 7. CRC32 is a tear detector, not an integrity primitive; both are needed and they are not the same job.)* A **partial append is safe only because every prefix is unambiguous** under this framing; the scanner discards the first invalid tail record.
   The recorder's **expected sample/frame count** is recorded independently — *a truncated file can hash self-consistently and pass every internal check.*
4. **FINALIZING.** Footer → barrier(file) → barrier(dir).
5. **VERIFIED — freeze, verify, then install with NO-REPLACE.** *(v2's plain `rename()` was not an immutable install: Codex #11 HIGH 8. `rename()` **replaces** an existing destination, contradicting write-once.)*
   - **Close/freeze the writer first** — a recorder still holding the descriptor can modify bytes after verification.
   - **Recompute the hash through the final descriptor**, over the reconstructed durable byte sequence. Check: decodable · duration credible · **actual sample/frame count == the recorder's expected count** · hash matches the chunk-log digests.
   - **Install with no-replace semantics** (`link()`/`renameatx_np(RENAME_EXCL)`) to `media/<sha256>.<ext>`. **Require source and destination on the same filesystem — assert it.** If the destination already exists (legitimate: content-addressed), **verify it byte-for-byte** rather than replacing or trusting it.
   - Barrier the destination dir; barrier the source dir; durably remove the source entry.
   - Write manifest **generation N** = **terminal `VERIFIED`**, carrying the final hash **and the identity + canonical payload** from §1.0b.
6. **DECIDE — the single commit point.** One SQLite `writeTransaction`: insert `Capture` + `Attachment`. **Both MUST be PowerSync-*managed* tables** (not local-only, not raw) — that is what makes PowerSync's generated triggers append the matching `ps_crud` rows **inside the same transaction**. **Nothing is written outside SQLite here; the manifest is not touched.**
7. **Emit `"saved ✓"` — only after the transaction returns *and* §1.0's durability profile held.**

### 1.3b Manifest specification — v3

*v2's temp→fsync→rename→fsync-dir was the right skeleton and nothing more (Codex #11 HIGH 6).*

- **Canonical per-capture directory**; **collision-safe unique temp filenames**.
- **No-replace installation** (`O_EXCL`) — never silently overwrite a generation.
- **Single-writer lease / fencing.** Without it two writers can both create generation N. *"Highest valid generation wins" cannot resolve a fork* — **forks quarantine, they do not get selected by clock or filename.**
- **"Valid" is defined**: canonical encoding + checksum/authentication + **embedded `capture_id`, `generation`, and predecessor-generation hash**, binding filename to content. A generation that doesn't bind is not valid.
- **Retain at least two verified generations.** v2 deleted generation N-1 once N was durable — removing the only fallback if N later corrupts.
- Clock ordering is **not** required; **monotonic generation order suffices once single-writer fencing exists.**
- Barriers per §1.0 (`F_FULLFSYNC` on Apple — ordinary `fsync` does not meet the claimed power-loss boundary).
- **Manifest authentication still delegates to Artifact 3, which is unfinished.** Named, not hidden.

**Manifest = generational, not appended-in-place.** `manifest.<gen>.json`; each generation is immutable and atomically installed; highest valid generation wins; older generations are deleted only once the newer one is durable. The **constantly-growing** part (the chunk log) is a **separate append-only file** with per-record CRCs. *(Closes v1's "the manifest is described as both content-addressed and continuously appended — incompatible unless explicitly versioned," and "atomic temp-write → fsync → rename → dir-fsync for manifest generations" is now specified.)*

**Idempotency of step 6.** Keyed by capture id; `INSERT … ON CONFLICT DO NOTHING`. Re-running after a crash never duplicates. Object keys are content-addressed (artifact 3), so re-upload is also idempotent.

### 1.3c The queue lifecycle — v3 (⛔ closes Codex #11 CRITICAL 3)

*v2 treated `ps_crud` as a permanent recovery fact. **It is transport state.** `tx.complete()` removes processed entries — our own connector does exactly that — so "rows present, `ps_crud` absent" is **the normal state after every successful upload**, not corruption.*

**Rules:**
1. **`ps_crud` is pending-transport state only.** Never assert its presence. Never treat its absence as corruption.
2. **Durable identity outlives the queue.** The `mutation_id` + canonical request digest (§1.0b) live in the **Capture row and the manifest**, not in `ps_crud`.
3. **Recovery predicate is:** *pending `ps_crud` **OR** a durable server receipt **OR** a durable dead-letter record* — **never** "`ps_crud` is present".
4. **Capture + Attachment go to the backend in ONE transaction (a single Postgres RPC), never two requests.** *This is the live bug in `spike/app-src/connector.ts`:* it sends them as **separate Supabase calls**, continues past permanent errors, and calls `tx.complete()` anyway. **PowerSync's local transaction grouping does NOT make separate server calls atomic.** So *Capture accepted + Attachment rejected + queue completed* → the next downloaded checkpoint **overwrites the local rows** → **a capture the user was told was saved is gone.**
5. **Never discard an evidence mutation to unblock the queue.** A permanent rejection must land in a **durable dead-letter state** that is surfaced, not swallowed. The connector's current `FATAL_PG_CODES` → `continue` → `tx.complete()` path is exactly the "discard to keep moving" behaviour that produces silent loss. **Unblocking the queue is not worth more than the capture.**
6. **Complete the PowerSync CRUD transaction only after the whole domain transaction is durable server-side.**

> **The `ps_crud`-in-one-transaction property is real but CONDITIONAL** (Codex #11 verified it against PowerSync's docs): it holds for **PowerSync-managed** tables, whose generated triggers update `ps_data__<table>` and append `ps_crud` in the current transaction. **Raw tables need application-created triggers; local-only tables queue nothing at all.** So step 6's atomicity depends on Capture and Attachment being declared **managed** — which `spike/app-src/AppSchema.ts` does, but which must be **asserted**, not assumed, once the production schema exists.

> #### Why we do NOT use PowerSync's attachment queue (resolves Q4 by not composing)
> The queue's only route to `QUEUED_UPLOAD` is `saveFile({data: ArrayBuffer})`, which **writes the local file itself and takes the whole buffer in memory** — it wants *file-then-row*, while this protocol requires *verify-then-row*, and the whole-file buffer is a real memory risk for multi-minute media. Since PowerSync provides **no resumable upload** and we are therefore building our own uploader regardless (ADR-2), the queue buys us nothing we can use.
>
> **Decision stands: PowerSync syncs ROWS. Media is ours end-to-end.** `Attachment` is an ordinary synced row, not a PowerSync `AttachmentTable`. This drops the **alpha** dependency and the `ArrayBuffer` memory risk.
>
> ### ⛔ BUT "it buys us nothing" WAS FALSE — and the replacement is NOT designed (Codex #11 HIGH 10)
> The queue also supplied: **detection of remote attachment references · cross-device download scheduling · local file state · retry · repair of missing local files · archive/delete transitions · cleanup coordination.** Dropping it deletes all of that. **Building our own uploader is justified; it does not eliminate the need to rebuild the rest.**
>
> **Artifact 1 currently has NO specification for:** Device 2 discovering and downloading media · resumable/ranged **download** · hash verification before a file is marked locally available · atomic install on Device 2 · per-device local paths · remote-object vs local-cache state · retention pins, archival, GC · window exit/re-entry · **evidence retrieval when media is not resident locally**.
>
> **Also a live modelling bug:** an ordinary **synced** `Attachment` row **must not carry a device-local `media/<sha>` path** — that path is meaningless on Device 2. The spike schema does exactly this.
>
> **Required split (not yet written):**
> - **`RemoteAsset` — synced, immutable identity:** object key · content hash · size · media type. **No local paths.**
> - **`LocalAsset` — local-only, per-device:** local URI · download state · verified state · retry/session state.
> - **Our own upload AND download queues**, both temp → verify → atomic no-replace install.
> - **Reference-aware GC** with grace periods and evidence-retention rules.
>
> **Until that exists, evidence retrieval on a second device is not designed** — and evidence retrieval is the product.

### 1.4 Crash behavior + recovery (what relaunch does per last state)

On every launch, a **recovery sweep** reconciles journal + sidecar manifests against SQLite and the media directory. Rule: **never initialize a fresh database over an existing one whose key is missing** (enter a hard recovery state instead — Codex H3). Per capture, keyed off the manifest's last durable state:

> ### ⛔ "COMPLETE" IS RETRACTED — the table is neither complete nor safe (Codex #11 CRITICAL 4)
> It enumerates *absence* of media but not **corruption** of it. Missing combinations Codex named, each of which this table would mishandle:
> - `VERIFIED` + media present at the expected path but **bytes hash differently** + **rows present** ← *silent corruption; row 6 would call this "committed, nothing to do"*
> - `VERIFIED` + **wrong-hash** media + **no rows** ← row 5 would re-run step 6 and **commit corrupt media**
> - two manifests for the same capture id · manifest gen N newer but **corrupt** while N-1 is valid · reservation file surviving alone
>
> **Row 8 is factually wrong** (see below). **Row 5's action is unsafe as written** — it must re-verify the hash before committing, not assume the install was good. Treat this table as a **draft enumeration**, not the truth table blocker 2 requires.

~~**The truth table is now COMPLETE**~~ — it enumerates *some* combinations of *(manifest state × media on disk × SQLite rows)*, including the two v1 had no row for. The sweep is driven by the **manifest**, then cross-checked against SQLite. **`"saved ✓"` was shown only for rows that exist in SQLite**, so any row below with *no SQLite rows* is by construction a state the user was never promised.

| # | Manifest | Media on disk | SQLite rows | What happened | Recovery action | Was "saved" shown? |
|---|---|---|---|---|---|---|
| 1 | none | none | none | Never started, or died before `STARTED` | Reclaim any reservation. Nothing existed. | no |
| 2 | `STARTED` | absent / partial | none | Died between arming and first chunk | Discard; reclaim reservation. | no |
| 3 | `RECORDING` | partial | none | **Mid-record kill — the ezQuotePro case** | Truncate to the last chunk the log durably records (per-record CRC; torn tail discarded). Offer **keep partial / discard**. | no |
| 4 | `RECORDING` | complete, no footer | none | Died during `FINALIZING` | Re-run finalize from the chunk log → verify → install. | no |
| 5 | `VERIFIED` | at `media/<sha>.ext`, **hash MATCHES** | **none** | **Died between install and commit** *(v1 had no row for this)* | **Orphan awaiting commit → re-run DECIDE with the PREPARE-minted identity** (§1.0b), so the retry is idempotent server-side too. **Re-verify the hash first — never commit on the assumption the install was good.** | **no** — this is why it is safe |
| **5b** | `VERIFIED` | at path, **hash MISMATCH** | **none** | **Silent corruption before commit** *(v3 — v2 would have committed corrupt media here)* | **Do NOT commit.** Quarantine the bytes, mark the capture `media_corrupt`, surface it. Re-deriving from the chunk log is permitted **only** if the log's per-chunk digests still verify. | no |
| 6 | `VERIFIED` | at path, **hash MATCHES** | **present** | **Committed. The normal terminal state.** | Nothing. Upload proceeds whenever. | yes — correctly |
| **6b** | `VERIFIED` | at path, **hash MISMATCH** | **present** | **Silent corruption AFTER commit** *(v3 — v2's row 6 would have called this "committed, nothing to do" and served corrupt evidence forever)* | **Do NOT serve it as evidence.** Mark `media_corrupt`, keep the row + expected hash, surface honestly. If a verified remote copy exists, re-download and re-install. **Otherwise: named residual loss.** | yes — and we must admit it |
| 7 | `VERIFIED` | **missing** | present | Media deleted/lost *after* commit (external deletion, FS damage) | **Do not fail silently.** Mark the capture `media_lost`, keep the row + hash as evidence, surface honestly. **Named residual boundary.** | yes — and we must admit it |
| 8 | `VERIFIED` | at path | rows present, **`ps_crud` missing** | ⛔ **THIS ROW IS WRONG — Codex #11 CRITICAL 3.** It claimed "unrepresentable, same transaction". **It is the NORMAL POST-UPLOAD STATE:** `tx.complete()` *removes* processed entries, and our connector does exactly that. `ps_crud` is **transport state, not a permanent recovery fact**. | **Do not assert.** Recovery must be *"pending `ps_crud` **or** a durable server receipt"* — never "`ps_crud` present". A durable mutation id + receipt (surviving queue completion) is **not yet designed**. | yes |
| 9 | present | present | **DB unreadable / key lost (H3/H4)** | Corruption or restore-without-key | **Hard recovery state — never initialize a fresh DB over the old one.** Rebuild rows from manifests + content-addressed media; re-run step 6 per verified manifest (idempotent). | previously yes → **restored** |
| 10 | **missing** | at `media/<sha>.ext` | none | Manifest lost, orphan bytes | No provenance → quarantine, do not invent a capture. Report. | no |
| 11 | **missing/corrupt** | missing | present | Rows reference media with no manifest and no bytes | Same as row 7: `media_lost`, honest. | yes — and we must admit it |

**Rows 5 and 8 are the two v1 could not express**, and they are exactly where the phantom lived. Row 5 is now a *benign, well-defined orphan* rather than a contradiction. Row 8 is **impossible by construction** because `ps_crud` and the domain rows share one transaction.

**~~"Manifest says `MEDIA_COMMITTED` but SQLite has no rows"~~ has no row in this table because the manifest cannot say committed.** The phantom-saved state is **unrepresentable**, not merely handled.

**Idempotency:** every transition is safe to re-run — step 6 is `INSERT … ON CONFLICT DO NOTHING` by capture id; media is content-addressed so re-install is a no-op; uploads use immutable content-addressed object keys (artifact 3). Re-running never duplicates or corrupts.

**Named residual-loss boundaries (honest invariant, mandate #1):** total device loss/destruction · app-data deletion · correlated filesystem destruction · rows 7/11 (media destroyed after commit — the row and hash survive, the bytes do not). These are **stated, not hidden**.

### 1.5 What the fault-harness oracle checks (ties to artifact 8)

For a capture the app showed `"saved ✓"` for, the oracle verifies **all** of: expected audio sample-count/duration · media decodable · **hash recomputed from the bytes on disk == the hash stored in the row** · `Capture`+`Attachment` rows present and consistent · **`ps_crud` outbound intent present** · manifest state == `VERIFIED` (**not** `COMMITTED` — the manifest has no such state in v2). **"A row exists" is not acceptance.** Any capture the app showed `"saved ✓"` for that fails any check = a **loss** (worst-severity fault), even if a row exists.

> **Two oracle rules learned the hard way in the sync bakeoff** (`CRITIC-REVIEW-09-CODEX`) — apply them here or this harness will false-pass exactly like that one did:
> 1. **Never compare a stored hash to a stored hash.** Recompute from the bytes actually on disk. Comparing the row's `payload_sha256` to the server's `payload_sha256` is circular and passes a transport that corrupted the payload.
> 2. **Every assertion must be able to fail.** The bakeoff's restart check waited for a file that already existed, so it could not fail. Prove liveness with a per-process identity (a fresh boot id), not with the presence of a stale artifact.
>
> **The recovery sweep must additionally be tested for row 5** (verified-but-uncommitted orphan → re-run step 6 → exactly one capture, not two) and **row 9** (rebuild from manifests → never clobber an existing DB).

### 1.6 Open sub-decisions this artifact hands to others

- The **media-encryption scheme** (how chunks are encrypted, where the key lives) = artifact 4 — it determines exactly what "encrypted chunk" means in step 3.
- The **sidecar manifest format** (authenticated how; content-addressing scheme) is finalized with artifact 3 (identity rules).
- The **outbound mutation shape** = artifact 2.

---

## Artifact 2 — The append-only sync protocol  ⚠️ DRAFT — open gaps per Codex #7

*How new immutable rows get from the phone to the server and back. Because of L5 (append-only), this is **not** a two-way merge engine — it is "push new facts, pull new facts since last time." That single property dissolves the hardest findings Codex raised (C5 clobbering, base/overlay reconciliation, oplog merge). Fixes C4 (idempotency) and C5 (real protocol).*

### 2.1 The unit of sync: an immutable append-mutation

Every sync operation moves an **append-mutation** — a self-contained immutable fact:

- a **capture-receipt** (a capture happened: id, project, author, time, media pointer, hash),
- a **new record version** (the versioned text/decision from L3),
- an **approval** (a signature over a specific record version — L4),
- a **tombstone** (windowing/revocation only — see 2.4).

No mutation ever *edits* a prior row. A "change" is a new version-append; a "removal" is a superseding append (approved rows: never destroyed except the lawful hard-delete, L4). This is why the protocol needs no conflict resolution for edits — **there are no edits.**

### 2.2 Push (device → server)

- Each mutation carries a **stable mutation ID** minted at local commit (Artifact 1, step 6) — globally unique, deterministic, unchanged across retries.
- `POST /sync/push` sends a **batch**. The server applies each mutation in **one Postgres transaction**: insert the idempotency receipt (unique on mutation ID) **and** the domain row(s) together (Codex C4/C8). Replaying the same mutation ID → no-op that returns the stored receipt. So a kill after the server commits but before the device hears back is safe: the retry deduplicates.
- **Per-mutation results, not all-or-nothing:** the response reports each mutation's outcome; the device advances each independently (Codex H2). One bad mutation can't block the batch.
- **Dependency order (a partial order, not a merge):** a child references its parent by stable ID (attachment→capture, version→record, approval→version). The device pushes parents before children; if a child arrives first, the server parks it and the client retries — because IDs are stable, the parent always reconciles. No merge, just ordering.
- **Media** is uploaded separately to immutable content-addressed object keys (Artifact 3) and the capture-receipt is only finalized server-side after the object's existence+checksum verify (no orphan rows).

### 2.3 Pull (server → device)

- The server stamps every row with a **monotonic change sequence** (`seq`, a per-tenant bigint). The device keeps a **high-watermark checkpoint** = the last `seq` it has fully consumed.
- `GET /sync/pull?since=<checkpoint>&limit=N` returns rows with `seq > checkpoint`, **keyset-paginated by `(seq, id)`** — stable under concurrent inserts because new rows always get a *higher* seq, never one inserted "behind" the cursor. This is the property append-only buys us: **pagination can't miss or duplicate rows** the way it could over mutable data.

  > ### ⛔ THE CLAIM IN THE BULLET ABOVE IS FALSE — DO NOT BUILD IT (Codex #7, blocker 1)
  > **Postgres sequence allocation is not commit-ordered**, so a row *can* appear "behind" the cursor: txn A takes seq 10 and stalls → txn B takes 11 and commits → the device pulls 11 and advances its checkpoint → A commits 10 → `seq > 11` **never returns A**. That capture is silently lost forever. Codex's pick for the **single most likely remaining field failure.**
  > Also unresolved here: `since=<seq>` vs `(seq,id)` pagination can skip rows sharing a seq at a page boundary; applying pulled rows and advancing the checkpoint are not required to be one transaction (checkpoint-first loses rows); no fixed response high-watermark; pull-side parent-before-child ordering unspecified; a revoked user may be unauthorized to pull the very tombstone meant to purge their device; time-based window exit has no DB mutation, so re-entry never resends rows below the checkpoint.
  > **A commit-ordered cursor must be designed before this is built** (known approaches: commit-timestamp watermark, snapshot-`xmin` boundary, or WAL/logical-replication ordering). **Not designed here** — pending the ADR-2 direction decision. **C5 remains fully open.**
- **A pulled row never overwrites a local pending mutation** (Codex C5's clobber): local pending mutations are *also* new appends with their own IDs — they don't collide with pulled appends. The whole base-state-vs-overlay reconciliation problem disappears.
- The device inserts pulled rows **idempotently** (insert-if-absent by ID) and advances the checkpoint. Client clock is **never** the ordering authority — server `seq` is (Codex C5).

### 2.4 Tombstones — only two non-edit reasons

Because nothing is ever edited or (normally) deleted, tombstones exist for exactly two purposes, and both carry a `seq` so they flow through the same pull:

1. **Windowing** — a row leaves the device's working set (project archived, or older than the last-N-days window). "Stop showing / purge locally," not "this changed."
2. **Revocation** — access removed (member/collaborator offboarded — REQ-MEMBER-5). Purge the revoked scope locally; **suspend, don't push,** any queued outbound mutations for a revoked scope (never push A's data under B's credentials — Codex H7).

*(The lawful hard-delete erasure, L4, also produces a tombstone-with-hash-stub — the evidence skeleton survives.)* *(revised 2026-07-16, DECISION 4 → Option A: hard-delete, not crypto-shred — client-side media encryption dropped for v1; see `DURABILITY-DESIGN-v1` DECISION 4)*

### 2.5 The one real "conflict" — and why it's not a sync problem

The only genuine collision left is **semantic**: two offline devices each create a *project* at the same address. That is **not** a sync-layer merge — it's an explicit, confirmed **project-merge flow** (Codex H8): tenant-scoped candidates → human confirm → an **alias/tombstone map** + transactional child-repointing, with captures that arrive later against the losing project ID resolving through the alias. It, too, works by **appending** (an alias record), never by editing. Immutable *captures* are **never** semantically de-duplicated — only projects merge, and only with confirmation.

### 2.6 What append-only let us delete from the design

Gone, versus a general two-way engine: oplog merge · last-writer-wins · vector clocks · base/overlay reconciliation of mutable rows · edit-conflict resolution · re-snapshot-without-losing-local-edits. What remains is small and boring: append with a stable ID, pull by a server sequence, two kinds of tombstone. That is the whole point of the append-only decision.

---

## Artifact 3 — Mutation & object identity  ⚠️ DRAFT — open gaps per Codex #7

*Permanent, collision-proof names for media files and mutations, so retries/duplicates/orphans are impossible by construction. Fixes C4.*

- **Media object keys are content-addressed + namespaced:** `{tenant_id}/{capture_id}/{asset_type}/{sha256}.{ext}`. The `sha256` is the hash of the **exact bytes uploaded** (ciphertext, per Artifact 4). Consequences: the same bytes always map to the same key (dedup), the key **proves integrity** (server recomputes on finalize), and media is **write-once — never overwritten** (a different byte-stream is a different key). No `upsert`/last-writer-wins on objects (Codex C4).
- **Mutation IDs:** a **UUIDv7** minted **on-device at the local commit** (Artifact 1, step 6). Time-ordered (helps server locality), globally unique across devices, stable across retries, not cross-tenant-guessable. Stored on the mutation row; the server's idempotency receipt is keyed on it.
- **Server finalize is a verify-then-link step:** the attachment row is linked to a capture **only after** the object's existence + byte-size + checksum are confirmed. So there is never a row pointing at a missing/half-uploaded object, nor an object with no row (the sweeper, Artifact 6, catches any straggler from a crash between the two).
- **Stored idempotent responses:** each mutation ID's outcome is persisted; a replay returns the same response rather than re-doing work.
- **Integrity chain:** the on-device **sidecar manifest** (Artifact 1) stores both the **plaintext hash** (to verify the capture decrypts to what was recorded) and the **ciphertext hash** (= the object key), tying the local recovery record, the uploaded object, and the server row into one verifiable chain.

## Artifact 4 — Media encryption + key lifecycle  ⚠️ DRAFT — open gaps per Codex #7 *(DECISION 4 itself is LOCKED; the key LIFECYCLE is not designed)*

*SQLCipher protects the database, not the audio/image files (Codex C3). This artifact decides how the media itself is protected, and how keys live and die — which also unblocks the op-sqlite-vs-expo-sqlite library choice.*

**▶ DECISION 4 — media encryption scheme. 🔄 RE-DECIDED 2026-07-16 (hadar): ~~Option B~~ → **Option A — OS file protection only**.**

> **Why the flip (hadar, 2026-07-16).** Asked plainly: *"why do we need to encrypt the media?"* The honest answer was that Option B never served security or the user — it existed **only** to make the L4 lawful-erasure carve-out (crypto-shred) enforceable. That is the tail wagging the dog:
>
> 1. **Crypto-shred already didn't cover the data that matters.** `CRITIC-REVIEW-02` H1: it *"doesn't cover indexed plaintext or replicated local copies"* — transcripts / `canonical_en` are FTS-indexed **plaintext in Postgres**. The adopted resolution was already **two data classes: blob crypto-shred + plaintext hard-delete + device purge**. So the searchable personal data — the actual subject of an erasure request — was **always** hard-deleted. Crypto-shred only ever covered the audio blob.
> 2. **Its one unique benefit was already conceded.** Crypto-shred's only edge over a plain delete is erasing from backups you can't reach — and `CRITIC-REVIEW-04-CODEX` already required us to *"document backup expiry rather than claiming immediate complete erasure"*, plus flagged vendors/logs/quarantine-plaintext as outside it.
> 3. **The cost was severe and load-bearing.** Option B was the sole reason Q3 was the hardest question in the sync bakeoff (*"there is no production unwrap path to test"* — `CRITIC-REVIEW-09-CODEX`), required a key lifecycle nobody had designed, hard-coupled us to SQLCipher/op-sqlite, and introduced **device-key-loss = permanent loss of unsynced captures** — a new failure mode in a product whose north star is never losing a capture.
> 4. **Market reality (hadar):** *"we are selling to solo owners with 2-10 employees — let's not overdo it."* No data-residency or right-to-erasure contract clauses. Zero users today.
>
> **Threat model after the flip:** media is encrypted at rest by the OS on-device (iOS Data Protection / Android encrypted storage) and by **Supabase Storage at rest** server-side, with RLS + signed URLs gating access. That covers stolen disks, bucket enumeration, and unauthorized reads. What we give up is protection against a **malicious/compromised Supabase**, and enforceable crypto-shred. Both are accepted for v1.
>
> **Revisit trigger (write it down so it isn't forgotten):** the first customer contract with a hard right-to-erasure or data-residency clause, or the first EU customer. At that point re-open DECISION 4 — the `RemoteStorage` abstraction is where it would land.
>
> **Consequences applied:** L4's carve-out becomes **hard-delete media + retain hash/metadata stub** (below) · **REQ-CAP4 reworded** to OS-file-protection at rest · the SQLCipher/op-sqlite coupling below is **no longer forced by this decision** (op-sqlite may still win on merit — decide in A0.3, not here) · **Q3 collapses**: no DEK, no unwrap path, no plaintext-canary scanning.

- **Option A — OS file protection only.** Rely on iOS Data Protection + Android encrypted storage; media is encrypted at rest by the OS. *Simplest*, but: not app-level encrypted, weaker if a device is compromised while unlocked, and it means **crypto-shred (the L4 lawful-erasure carve-out) is not truly enforceable** — you can't destroy one capture's key to make it unreadable everywhere. Would require rewording REQ-CAP4 to "OS-file-protection at rest."
- **Option B — per-capture-key envelope encryption (recommended).** Each capture gets its own **data key (DEK)**; media chunks are encrypted with it; the DEK is **wrapped** (a) by a device master key in Keychain/Keystore **and** (b) for the **server ingest identity**. **Ciphertext is uploaded unchanged** (so background upload never needs the plaintext or even the key — it just ships bytes). *Why recommended:* it makes **crypto-shred real** (destroy the DEK → that capture is unreadable everywhere the key never went), which the immutability/erasure model (L4) depends on; and it gives a **nice durability bonus** — because the DEK is also wrapped for the server, a **synced** capture stays recoverable even if the device's key is lost; only **not-yet-synced** captures are exposed to device key-loss. Cost: more work than Option A.

**Key lifecycle (applies to Option B):**
- Device master key in **Keychain (iOS)** / **Keystore (Android, StrongBox if present)**, with an accessibility class that permits **background access after first unlock** (e.g. `AfterFirstUnlock`) — **not** the `WhenUnlocked` default (Codex flagged Expo SecureStore defaults to `WHEN_UNLOCKED`, which would break locked-device background upload; this needs explicit config or a small native module).
- **Key loss = hard recovery state, never init a new DB over the old one** (Codex H3). On restore-without-key: synced captures recover server-side (their DEK was wrapped for the server); unsynced captures with only local ciphertext become an **honest, named residual-loss boundary**.
- Keys **excluded from cloud backup** (a restored-but-undecryptable key is worse than none). Rekey/rotation is a defined, interrupt-safe operation.
- **This decides the SQLite library:** SQLCipher needs a native prebuild (not in Expo Go) and `expo-sqlite`'s `PRAGMA key` passes the key through JS. With Option B we're already doing native crypto for media, so **`op-sqlite` (with its SQLCipher build)** is the natural fit for the DB too — one native crypto story. *(Provisional: op-sqlite; confirm in the A0.3 spike.)*

## Artifact 5 — Action/resource authorization matrix  ⚠️ DRAFT — open gaps per Codex #7

*Codex C7: a TypeScript middleware "predicate" is not the same thing as Postgres RLS, and a top-level `org_id` check misses nested resources. This makes authorization a real, enforced model.*

- **Canonical authz lives in Postgres functions** — `can_read(actor, resource)`, `can_append(actor, record)`, `can_approve(actor, record)`. **RLS policies call these functions, and service-role code (Edge Functions, jobs) calls the *same* functions explicitly** (service-role bypasses RLS, so it must opt in). One source of truth, two callers.
- **Validate the whole chain, not the top:** actor → tenant membership → project membership/assignment → the specific capture/attachment/record belongs to that project. A nested `capture_id` from another tenant is rejected even if the top-level tenant matches.
- **Every transport path enumerated, each with a negative test:** the sync push/pull Edge Functions; **PostgREST is NOT exposed publicly** (all access via Edge Functions) to shrink the surface; Storage/TUS object issuance **re-checks membership on the specific object every time**; the homeowner **one-record scoped JWT** (a single disposition, nothing else); durable-job callbacks (service-role → must call `can_*`); R2/Storage media reads via an authorizing endpoint. Negative contract tests: collaborator-removed, cross-tenant `capture_id`, object-key enumeration, homeowner over-fetch, **revoked-member pull** (REQ-MEMBER-5).
- **Append-only interaction:** `can_append` enforces L4 — no mutation may target an approved record version except a **new-version append**; `can_approve` restricts approvals to the designated approver.
- **Deliverable:** a generated **policy matrix** (roles × resources × actions) checked in CI, so a new endpoint can't ship without a row + a negative test.

## Artifact 6 — Transactional outbox (server side)  ⚠️ DRAFT — open gaps per Codex #7

*Codex C8: "put the pipeline in durable jobs" doesn't make the trigger durable — if an Edge Function commits a capture then dies before starting the job, it's permanently unprocessed. The outbox makes the trigger a row, not an in-memory call.*

- When a push finalizes a capture/attachment, the **same Postgres transaction** inserts an **outbox event** (`process capture X version Y`). Commit is atomic: either both the capture and its "needs processing" marker exist, or neither does.
- A **durable dispatcher** claims outbox rows with a lease (`SELECT … FOR UPDATE SKIP LOCKED`), delivers to the jobs runtime (Trigger.dev/Inngest — ADR-3), marks delivered on ack, retries with exponential backoff + jitter on failure, and surfaces a **dead-letter** state for anything that keeps failing.
- Jobs are **idempotent on `(capture_id, content_version)`** — redelivery never double-processes.
- An **orphan sweeper** runs periodically and repairs/alerts on: objects-without-rows, rows-without-objects, finalized attachments with no outbox event, and outbox events stuck undelivered.

## Artifact 7 — Storage provider + resumable protocol  ✅ DECISION 7 LOCKED *(the provider choice is settled; the resumable/fault protocol against it is not yet written)*

*Codex H6: Supabase Storage (TUS) and R2 (S3-multipart) are NOT an isolated swap — issuance, resume tokens, part receipts, checksums, and background-client support differ. Lock ONE before the durability gate.*

**▶ DECISION 7 — P1 storage provider. ✅ LOCKED 2026-07-16 (hadar): Supabase Storage for P1; R2 as the P1.5 egress optimization.**

- **Supabase Storage (recommended for P1):** one vendor (Spike A is already all-Supabase → keeps the spike small), **TUS resumable uploads** with good background support, integrated auth. Downside: egress costs on heavy media playback, less battle-tested at large scale.
- **Cloudflare R2 (defer to P1.5):** zero egress (cheap for high-volume media playback), S3-compatible multipart, scales — but a second vendor with separate auth and a different resumable model.
- **Rationale:** P1 is voice-first (small audio), so egress isn't yet the cost driver; start on Supabase Storage, and design the **RemoteStorage abstraction** now to cover issuance / resume-token / part-state / checksum / abort / finalize / orphan-cleanup (not just `put()`), so the R2 swap is bounded when media volume (video, playback) justifies zero-egress. **Whichever is chosen, the full fault suite runs against that one provider** — no "swap later, test later."

## Artifact 8 — Failpoint matrix + statistical target  ⚠️ DRAFT — open gaps per Codex #7

*Codex H9/H10/H11: the old gate could certify a broken design, had no real numeric target, and was missing whole fault classes. This is the pass/fail bar.*

- **Two-tier testing:** (1) an **automated failpoint harness** — deterministic crash injection **after every state transition** (Artifact 1) plus randomized kills — run in CI for **volume**; (2) **physical-device runs** (smaller N) for platform **realism** (real OS eviction, real storage-full, real background scheduler). Release builds + the **production entrypoint** only (a test-only queue proves nothing — the ezQuotePro trap).
- **The oracle** (from §1.5) verifies audio sample-count/duration, decodability, hash match, DB rows, queue state, remote object, and server receipt — never "a row exists."
- **Predeclared targets, per fault class, per platform** (no pooling into one flattering N):
  - Core capture-loss faults (kill mid-record / mid-finalize / mid-commit): **< 1e-4 at 95%** → ~30,000 zero-failure automated-failpoint trials, + hundreds on device.
  - Sync duplication/loss faults (mid-push / mid-pull / lost-response): zero dup/loss across a declared N with the oracle.
  - Recovery faults (DB corruption, key loss): recovers from manifests, or hits a **named** residual-loss boundary — never silent.
- **The expanded fault list (Codex H11)**, by category:
  - *Local:* kill mid-record, OS memory eviction, storage-full at each write boundary, power loss, DB/WAL corruption, mic interruption / route change / permission revocation / phone call mid-record, OS purge of a misplaced cache file, clock moved back/forward.
  - *Storage/upload:* mid-upload kill, TUS/signed-URL expiry, object-complete-but-row-absent (and vice-versa), checksum mismatch.
  - *Sync/server:* server commit then lost HTTP response, auth-token expiry mid-push/upload, two simultaneous queue drainers, 401/409/413/429/5xx/timeout/malformed-partial, old-client mutation vs new schema, app-upgrade/kill during SQLite migration.
  - *Account:* logout, user switch, membership revocation mid-sync, device sharing.
  - *Network:* wifi→cell with cellular-consent off, captive portal, false-positive reachability.
  - *Backlog:* queue backlog exhausting storage days later.

## Artifact 9 — Append-only decision record  ✅ DECISION LOGGED *(Codex #7 confirms H1 closed as a decision — but see the L5 challenge below)*

P1 sync = **append-only** (ADR-2, resolved 2026-07-16). PowerSync stays a **P1.5+** option, and only if genuinely *mutable* multi-device relational sync ever earns it (the append-only model means it may never be needed). Traceable here so the choice isn't silently revisited.

---

## Status

- **Both embedded decisions LOCKED 2026-07-16 (hadar) and unaffected by the #7 findings:** Decision 4 = **Option B** (per-capture-key envelope encryption); Decision 7 = **Supabase Storage** for P1 (R2 = P1.5 egress optimization). op-sqlite is the provisional SQLite library (confirm in A0.3). These two are settled and have now been **propagated into `ARCHITECTURE.md`** (which previously contradicted both).
- **The second Codex pass RAN and FAILED this design** (`CRITIC-REVIEW-07-CODEX.md`, gpt-5.6-sol @ high, 2026-07-16): **2 of 20 findings closed (C2, H1)**; artifacts 1–6 + 8 downgraded **✅ COMPLETE → ⚠️ DRAFT**. See the blockers in the header.
- **Done since:** the **doc-drift cleanup** — the Codex #6 decisions that were logged as ADOPT in `IMPLEMENTATION_NOTES §4` but never propagated (video wording/C6, storage provider, client-side encryption, Postgres-canonical authz, `MEDIA_COMMITTED`-gated save confirm) are now applied across `ARCHITECTURE.md` / `SPEC-capture-core-v1.md` / `SPIKE-A-BUILD-PLAN.md`. This closes the **contradiction** class of #7 findings only.
- **NOT done (deliberately) — genuine protocol design, pending a user decision on the ADR-2 / PowerSync-bakeoff direction:** commit-ordered sync cursor · the SQLite↔manifest commit truth table · the immutable-evidence-vs-mutable-operational-state boundary (L5) · key lifecycle depth · client queue behavior · failpoint granularity · an enforceable database API. **A DURABILITY-DESIGN v2 is required before A0.2.**
- This doc replaced "improvise durability in code" with written, reviewable invariants — and the review then proved several of those invariants wrong on paper, which is exactly what the design-first gate is for. **That is the gate working, not the gate failing.**
