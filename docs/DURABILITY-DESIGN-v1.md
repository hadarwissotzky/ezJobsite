# EZjobsite — Durability & Sync Design (the pre-code design gate)

> **What this is.** The design pass Codex #6 required before any Spike A code. It answers the 9 artifacts from `SPIKE-A-BUILD-PLAN.md §0.5` at the protocol level, so the build derives from written invariants instead of improvising durability in code. Decisions locked 2026-07-16: **append-only sync (ADR-2)** · **honest save-invariant (CLAUDE #1)** · **immutable media + versioned records + approval-freeze** · **DECISION 4 (~~Option B~~ → **Option A**, re-decided 2026-07-16 — client-side media encryption dropped for v1)** · **DECISION 7 (Supabase Storage)**.
>
> ## 🟢 STATUS 2026-07-16 — ALL THREE PRE-CODE BLOCKERS ARE CLOSED. A0.2 (schema) MAY BEGIN.
>
> The three blockers below were gated behind the ADR-2 / PowerSync-bakeoff decision. **That decision is made (ADR-2 → PowerSync), and it closed two of them outright. The third is closed by Artifact 1 v2 in this document.**
>
> | Blocker | Status | How |
> |---|---|---|
> | **1 — the `seq` pull is not commit-ordered → silent capture loss** *(Codex's pick for the single most likely field failure)* | ✅ **DISSOLVED — transport-owned** | We no longer write a `seq` cursor. PowerSync orders by the **Postgres commit log**, so a late-committing txn lands at a *later* stream position and cannot fall behind the checkpoint. **The fault is not fixed — it is unreachable.** Demonstrated 40/40 under a deliberate stalled-commit inversion (`BAKEOFF-RESULT.md`). |
> | **2 — `MEDIA_COMMITTED` is not atomic** | ✅ **CLOSED — Artifact 1 v2 (§1.1–§1.4 below)** | Root cause was **two authorities for one fact**: the manifest was made to record commitment, which only SQLite can know. v2 splits the questions — manifest answers *"were bytes made"*, SQLite alone answers *"is it committed"*. **One commit point.** The phantom-saved state is now **unrepresentable**, and the recovery truth table is complete (11 rows, incl. the two v1 could not express). |
> | **3 — L5 ("sync is append-only") is false for the data model** | ✅ **RESOLVED via option (a)** | Append-only is scoped to the **evidence ledger** (media, capture receipts, record versions, approvals), enforced by **our** rules (authz + no-update policies), not the transport. **Mutable operational state syncs through PowerSync** — demonstrated in bakeoff Q2 (bidirectional convergence, pending offline edits preserved, server-owned fields refused at the DB boundary with `42501`). |
>
> **Artifact 1 is now a crash-safe specification, not a sketch.** The other artifacts retain their **⚠️ DRAFT** labels honestly — §2 (sync protocol) is now **largely superseded by PowerSync** and should be read as such; 3/5/6/8 still need work but **none of them block A0.2**.
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

> ## ✅ BLOCKER 2 CLOSED 2026-07-16 — Artifact 1 v2: the single ordered commit protocol
>
> `CRITIC-REVIEW-07-CODEX` blocker 2 (*"`MEDIA_COMMITTED` is not atomic"*) is **resolved**, and with it C1. §1.1–§1.4 below are **v2**. The v1 text is preserved in git (`a5a8198^`).
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
> **The two unhandled crash states become unrepresentable:**
> - ~~"SQLite commits, manifest advance fails"~~ → **there is no manifest advance after the SQLite commit.**
> - ~~"Manifest says `MEDIA_COMMITTED`, SQLite rolled back → phantom saved"~~ → **the manifest cannot say committed.**
>
> A verified manifest with no SQLite row is not a contradiction — it is a **well-defined orphan awaiting commit**, and `"saved ✓"` was never shown for it.
>
> **PowerSync (ADR-2) makes step 6 genuinely one transaction, for free.** `ps_crud` is a local table **in the same SQLite database**, so the outbound intent commits in the *same* transaction as the domain rows. There is no separate queue to write, and therefore **no window where a capture is "saved" but has no sync intent** — v1 had to hand-build that property; we now get it from the transport.

### 1.1 Why a state machine + a sidecar manifest (not a boolean) — v2

The four durability events v1 conflated — **journal commit, media-file commit, DB-row commit, outbound-intent commit** — happen on **two storage systems that cannot share a transaction**: the **filesystem** (media) and **SQLite** (rows). No single `COMMIT` makes both atomic. **So we stop trying.** Instead:

1. **One commit point.** The **SQLite transaction is the only commit.** Every filesystem step before it is a *prepare*: durable, idempotent, and safe to re-run. Nothing is written to any other system after it.
2. **Two authorities, two questions, no overlap.** The **manifest** answers *"was media made, and where are its bytes"* — it is the recovery source of truth **independent of SQLite**, so if SQLite is corrupted or its key is lost (H3/H4), manifests + content-addressed media reconstruct the index. **SQLite** answers *"is this capture committed"* — and nothing else may claim to answer it.
3. **`"saved ✓"` is emitted only after the SQLite commit returns.** SQLite's commit is atomic, so there is no instant at which the app has said "saved" and the capture is not committed.

**The invariant this buys:** *a phantom "saved" is not a bug we handle — it is a state the design cannot represent.*

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

1. **RESERVE — actually reserve blocks, not a notional lease.** Create `reserve/<id>.blk`, **write it out to the expected maximum size** (`ftruncate` alone is not enough on APFS/ext4 — it can produce a sparse file that fails later), `fsync` it, then `fsync` the parent dir. Include **headroom for the manifest, the chunk log, and the final rename**. If reservation, permissions, or mic access fail → **refuse loudly and record nothing**. *(Closes v1's "disk-space lease reserves no blocks → ENOSPC can still strike the manifest or the final rename.")*
2. **STARTED — manifest generation 0, before the recorder is armed** (REQ-CAP8). Written **atomically**: `manifest.tmp` → write → `fsync(file)` → `rename()` → `fsync(dir)`.
3. **RECORDING — paired durability, data before log.** Media streams to `tmp/<id>.part`. For each chunk: **`fsync` the chunk DATA first, then append its `(seq, offset, len, crc32)` record to `chunks.log` and `fsync` the log.** *This order is load-bearing:* the log can never reference bytes that are not durable. The reverse order permits a log that claims an absent chunk. Each log record carries its own length + CRC, so a **torn tail record is detected and discarded on read**. *(Closes v1's "no paired durability order between chunk data and chunk-log entries.")*
4. **FINALIZING.** Write the container footer → `fsync(file)` → `fsync(dir)`.
5. **VERIFIED — verify, then install atomically.** Re-open and check: decodable · duration credible · full-file hash matches the chunk log. **Then `rename()` the temp file to its content-addressed permanent path `media/<sha256>.<ext>`** (rename within a filesystem is atomic) → **`fsync(dir)`**. Write manifest **generation N** (same atomic temp→fsync→rename→fsync-dir dance) marking `verified` + the final content hash. **This is the manifest's terminal state.** Delete the reservation file. *(Closes v1's "the finalized temp file is never atomically renamed to its content-addressed permanent path.")*
6. **COMMIT — the single commit point.** One SQLite `writeTransaction`: insert `Capture` + `Attachment` (referencing `media/<sha256>.<ext>`). PowerSync writes the matching `ps_crud` rows **in the same transaction**. **Nothing is written outside SQLite here — the manifest is not touched.**
7. **Emit `"saved ✓"` — only after the transaction returns.**

**Manifest = generational, not appended-in-place.** `manifest.<gen>.json`; each generation is immutable and atomically installed; highest valid generation wins; older generations are deleted only once the newer one is durable. The **constantly-growing** part (the chunk log) is a **separate append-only file** with per-record CRCs. *(Closes v1's "the manifest is described as both content-addressed and continuously appended — incompatible unless explicitly versioned," and "atomic temp-write → fsync → rename → dir-fsync for manifest generations" is now specified.)*

**Idempotency of step 6.** Keyed by capture id; `INSERT … ON CONFLICT DO NOTHING`. Re-running after a crash never duplicates. Object keys are content-addressed (artifact 3), so re-upload is also idempotent.

> #### Why we do NOT use PowerSync's attachment queue (resolves Q4 by not composing)
> The queue's only route to `QUEUED_UPLOAD` is `saveFile({data: ArrayBuffer})`, which **writes the local file itself and takes the whole buffer in memory** — it wants *file-then-row*, while this protocol requires *verify-then-row*, and the whole-file buffer is a real memory risk for multi-minute media. Since PowerSync provides **no resumable upload** and we are therefore building our own uploader regardless (ADR-2), the queue buys us nothing we can use.
>
> **Decision: PowerSync syncs ROWS (its proven strength — Q1/Q2). Media is ours end-to-end: our file, our verify, our atomic install, our uploader, our resume.** `Attachment` is an ordinary synced row, not a PowerSync `AttachmentTable`. This also drops the **alpha** attachments dependency and the `ArrayBuffer` memory risk in one move.

### 1.4 Crash behavior + recovery (what relaunch does per last state)

On every launch, a **recovery sweep** reconciles journal + sidecar manifests against SQLite and the media directory. Rule: **never initialize a fresh database over an existing one whose key is missing** (enter a hard recovery state instead — Codex H3). Per capture, keyed off the manifest's last durable state:

**The truth table is now COMPLETE** — it enumerates every combination of *(manifest state × media on disk × SQLite rows)*, including the two v1 had no row for. The sweep is driven by the **manifest**, then cross-checked against SQLite. **`"saved ✓"` was shown only for rows that exist in SQLite**, so any row below with *no SQLite rows* is by construction a state the user was never promised.

| # | Manifest | Media on disk | SQLite rows | What happened | Recovery action | Was "saved" shown? |
|---|---|---|---|---|---|---|
| 1 | none | none | none | Never started, or died before `STARTED` | Reclaim any reservation. Nothing existed. | no |
| 2 | `STARTED` | absent / partial | none | Died between arming and first chunk | Discard; reclaim reservation. | no |
| 3 | `RECORDING` | partial | none | **Mid-record kill — the ezQuotePro case** | Truncate to the last chunk the log durably records (per-record CRC; torn tail discarded). Offer **keep partial / discard**. | no |
| 4 | `RECORDING` | complete, no footer | none | Died during `FINALIZING` | Re-run finalize from the chunk log → verify → install. | no |
| 5 | `VERIFIED` | at `media/<sha>.ext` | **none** | **Died between install and commit** *(v1 had no row for this)* | **Orphan awaiting commit → re-run step 6** (idempotent by capture id). | **no** — this is why it is safe |
| 6 | `VERIFIED` | at `media/<sha>.ext` | **present** | **Committed. The normal terminal state.** | Nothing. Upload proceeds whenever. | yes — correctly |
| 7 | `VERIFIED` | **missing** | present | Media deleted/lost *after* commit (external deletion, FS damage) | **Do not fail silently.** Mark the capture `media_lost`, keep the row + hash as evidence, surface honestly. **Named residual boundary.** | yes — and we must admit it |
| 8 | `VERIFIED` | at path | rows present, **`ps_crud` missing** | **Unrepresentable** — same transaction | Assert loudly. If ever observed → DB corruption; go to row 9. | — |
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
