# Spike A — Foundation-Spike Build Plan (EZjobsite P1)

> ⚠️ **REVISED 2026-07-16 after Codex cross-model review #6 (`CRITIC-REVIEW-06-CODEX.md`).** The review found this plan **not ready to build as originally written**: it treated four distinct durability events — journal commit, media-file commit, queue insertion, server receipt — as one atomic "local save," so "saved ✓" could fire before a capture is recoverably committed (the ezQuotePro silent-loss failure behind a fancier queue). **Consequence: Spike A is now DESIGN-FIRST.** Nine design artifacts (§0.5) must be written and reviewed **before A0.2 schema code.** Two decisions are owed from hadar first (§0.4). The task phases below still hold, but each now derives from the §0.5 artifacts rather than being improvised in code. Reconciliation of all 24 findings: `IMPLEMENTATION_NOTES §4` (2026-07-16).

*The first thing to build. Written 2026-07-15, before any code, per the operating contract (`CLAUDE.md §3`: "before any multistep build, write a verification plan"). This is the task-level expansion of `SPEC-capture-core-v1.md` **M0 + the durability front of M1**, on the locked stack. It is the concrete plan a builder (you, or Claude Code) executes first.*

---

## 0. What a "spike" is, and why this one is first

A **spike** is a small, deliberately-scoped build whose only job is to **answer a scary technical question with real evidence** before committing to the full build. It is not a feature; it is a risk-killer. You keep the parts that prove out and throw away the rest.

The **foundation spike** attacks the single unknown that, if it fails, sinks the whole product: **U1 — can a capture survive on a real phone with zero loss, offline, across crashes and pressure?** (`VERIFICATION_PLAN` Part C, U1; criterion #4). Everything else in EZjobsite is disposition on top of capture — so we prove capture is unbreakable *first*, cheaply, before building anything that depends on it.

This is the direct antidote to the ezQuotePro failure (`CRITIC-REVIEW-05`): that app *asserted* "ALL TESTS PASSED" on an offline system that (a) was never wired in and (b) was never actually tested against a kill. Spike A's exit gate is the opposite of an assertion — it is a **measured loss rate under injected faults on a physical device.**

**Spike A is "done" when we can say, with a number: a capture started on this phone is recoverable across every fault in the suite, and one such capture round-trips to Postgres and back without loss or duplication.** Not before.

---

## 0.4 Two decisions owed from hadar (before design starts)

1. **ADR-2 direction (owned-queue vs PowerSync).** Codex H1 showed the owned queue must implement a full two-way sync protocol (server change-sequence, checkpoints, tombstones, base/overlay — C5/H2), which is not "simple." Pick: **(a)** a short **PowerSync bakeoff** then adopt if it wins; **(b)** **restrict P1 sync to append-only immutable capture receipts** (no generic two-way merge — dissolves most of C5, and EZjobsite captures *are* mostly append-only evidence — *recommended lean*); **(c)** keep the owned queue and design the full protocol. This decides how heavy §0.5 artifacts 2 and 9 are.
2. **The "never lose a capture" reframe (C2).** An absolute guarantee is impossible on a single device (DB+key in one failure domain). Adopt the honest invariant — *"never acknowledge a capture unless a verified recoverable copy + durable intent exist; refuse to start loudly when capacity can't be reserved,"* with stated residual-loss boundaries — as the new wording of mandate #1. **Recommended: yes** (it makes the promise true).

## 0.5 Pre-code design gate — the 9 artifacts (write + review BEFORE A0.2 schema)

*Codex #6's required-gate list. Each is a short design doc, adversarially re-checkable. No schema, no app code, until these exist. This is the "design pass" that replaces improvising durability in code.*

1. **Capture-commit state machine** (C1) — the exact ordered states from record-start to "saved ✓": STARTED → encrypted media chunks (seq + hash) → finalize + fsync(file + parent dir) → verify decodable/duration/hash → **one SQLite transaction** creating Capture + Attachment + outbound-mutation and advancing to `MEDIA_COMMITTED` → *only then* emit "saved ✓". Idempotent recovery state machine + durable **sidecar manifest** (never a boolean `complete`), because the filesystem and SQLite cannot share a transaction.
2. **Push/pull sync protocol** (C4/C5) — server-assigned monotonic change sequence, high-watermark checkpoint, keyset pagination, tombstones (delete/merge/revoke/window-exit), base-state vs pending-overlay, per-row versions, stable mutation IDs, single-transaction receipt+domain write. *(Scope depends on decision 0.4.1 — append-only makes this much smaller.)*
3. **Mutation & object identity rules** (C4) — immutable deterministic object keys (tenant/capture/asset); never overwrite media; server finalize verifies size+checksum before linking; stored idempotent responses.
4. **Media-encryption + key-lifecycle decision** (C3/H3/M1) — pick ONE end-to-end scheme (native per-capture-key streaming, ciphertext uploaded unchanged, server unwraps without plaintext staging) *or* explicitly accept OS-file-protection-only and revise REQ-CAP4. Plus key storage (Keychain/Keystore accessibility class), key-loss = hard recovery state (never init over an existing DB), backup/restore/migration/rekey behavior. **This unblocks the op-sqlite vs expo-sqlite library choice.**
5. **Action/resource authorization matrix** (C7) — canonical authz **in Postgres functions** (RLS + service-role call the same functions), every referenced nested resource validated (not just top-level org_id), generated policy matrix + negative contract tests for every transport (PostgREST, Storage/TUS, Edge entrypoints, job callbacks, R2 reads).
6. **Transactional outbox design** (C8) — outbox event in the same txn that finalizes the attachment; durable dispatcher with leases/retries; `(capture_id, content_version)` job idempotency; orphan sweeper (objects-without-rows, rows-without-objects, attachments-without-jobs).
7. **Locked storage provider + resumable protocol** (H6) — **✅ DECISION 7 LOCKED 2026-07-16: Supabase Storage for P1** (R2 = P1.5 egress optimization). TUS vs S3-multipart differ in issuance, expiry, part receipts, checksums, and background support, so the `RemoteStorage` abstraction must cover issuance/resume/part-state/checksum/abort/finalize/orphan-cleanup, **not just `put()`** — and **the full fault suite runs against the P1 provider**, no "swap later, test later." *(The resumable/fault protocol against Supabase Storage is still unwritten — Artifact 7 is a decision, not yet a protocol.)*
8. **Deterministic failpoint matrix + statistical target** (H9/H10/H11) — crash hooks after every state transition + randomized kills; a strict integrity **oracle** (expected audio sample count/duration, decoding, hashes, DB state, queue state, remote object, server receipt); **predeclared max loss probability + confidence per fault per platform** (~30k zero-failure automated-failpoint trials to bound <1e-4 @95% — physical-device tests add platform realism; do not pool heterogeneous faults into one flattering N); the full expanded fault list (H11).
9. **PowerSync-vs-append-only bakeoff / restriction** (H1) — the artifact that records decision 0.4.1 with evidence.

## 1. Scope — what Spike A is and is NOT

**In scope (the load-bearing spine):**
- The capture **write-ahead journal** (REQ-CAP8) + **local-first encrypted durable write** (REQ-CAP4) + **audible/visual save confirm** (REQ-CAP5) + **crash/fault recovery** (REQ-CAP6), for **one modality: voice** (the highest-value, hardest-durability case).
- The **owned sync queue** spine: journal → durable resumable **upload queue** → **push** one capture row + its audio to Postgres/Storage → **pull** it back → per-item **visible status** (REQ-PROC4/6).
- The **fault-injection harness** (VERIFICATION_PLAN criterion #4) run on a **real device**.
- The monorepo skeleton + the **encrypted SQLite** integration (SQLCipher) + the **Edge Function** sync endpoints (Hono) + the **auth predicate as middleware** (thin version, single tenant).

**Explicitly OUT of scope for Spike A (do not build yet):**
- Video, photo, timeline, keyframes (M2). Text/photo/video capture come after voice durability is proven.
- The AI pipeline — transcription, translation, structuring (M4/P1.5). Spike A stores and round-trips the **raw audio + a journal row**; it runs **no LLM/STT**.
- Project resolution / GPS (M3).
- Multi-tenant depth, collaborators, roles beyond a single hard-coded org/user (full authz is M-level work; Spike A proves the *shape*, one predicate in one middleware, not the whole matrix).
- Signatures, approvals, reports, pricing, billing.
- Polished hands-free UX (that's the UX-spec phase; Spike A uses a plain big Record button that meets the touch budget but isn't the final interaction model).

*Scope rule (from the audit): no ezQuotePro code is copied in. Patterns may be read as reference (Deepgram config shape, i18n key structure) but Spike A is written fresh against this plan.*

---

## 2. The locked stack Spike A runs on

| Piece | Choice (ADR) |
|---|---|
| Client | React Native + Expo (ADR-1) |
| Device store | **Encrypted SQLite** — SQLCipher via `op-sqlite` (or expo-sqlite + encryption); key in iOS Keychain / Android Keystore |
| Sync | **Owned queue** for P1 (ADR-2): journal → upload queue → push/pull |
| Cloud | **Supabase (raw Postgres)** — Auth, RLS, Storage (ADR-2) |
| API | **Supabase Edge Functions (Deno) + Hono + zod** (ADR-5); auth predicate = shared middleware |
| Language | **TypeScript**, one monorepo (ADR-5) |
| Object storage | **Supabase Storage** (DECISION 7, LOCKED 2026-07-16) — R2 deferred to P1.5. **The R2 swap is NOT "isolated"** (Codex #6 H6: TUS vs S3-multipart differ in issuance/expiry/part-receipts/checksums/background support); it is bounded only by the `RemoteStorage` abstraction, and the fault suite runs against Supabase Storage. |
| Jobs runtime | **Not exercised in Spike A** (no pipeline yet; ADR-3 lands at M4) |

---

## 3. The build, task by task

*Each task is small and independently reviewable. Order matters: durability primitives before sync, sync before the fault harness. A task is not "done" until its check passes.*

### Phase 0 — Skeleton (matches SPEC M0, first half)
- **A0.1 — Monorepo scaffold.** TS monorepo: `apps/mobile` (Expo), `apps/web` (Next, stub), `packages/shared` (types + zod schemas + the auth predicate), `supabase/` (migrations + functions). Root `CLAUDE.md`.
  - *Check:* `apps/mobile` boots on a real iOS + Android device via Expo; shared package imports resolve from the app.
- **A0.2 — Supabase project + schema v0.** Postgres tables for the spike only: `capture` (id, org_id, author_id, project_id nullable, started_at, modality, state, client_created_at, server_synced_at), `attachment` (id, capture_id, storage_key, bytes, checksum, state). RLS `FORCE` on both, keyed by `org_id`. One hard-coded org + user for the spike.
  - *Check:* a row inserted via the Edge Function is visible in Postgres; a cross-org read is denied (first negative test).
- **A0.3 — Encrypted SQLite on device.** Integrate SQLCipher; create the mirror local schema (`capture`, `attachment`, plus `capture_journal`). Key generated on first launch, stored in **Keychain/Keystore**, never in JS/plaintext.
  - *Check (both platforms, per Codex #6 M1/C3 — a non-SQLite header is NOT sufficient proof):* scan **all** sandbox artifacts (WAL, SHM, temp files, sidecar manifests, backups, **and the media files** — SQLCipher does not encrypt them) for known plaintext; attempt a **wrong-key open** (must fail); corrupt an authenticated page (must be detected); delete the key (data must become unavailable, not silently re-init a new empty DB — H3); confirm on a **release build**, not just dev. **Note:** SQLCipher needs a native prebuild (not available in Expo Go) and `expo-sqlite`'s `PRAGMA key` passes the key through JS — so the media-encryption + key-lifecycle decision (§0.5 #4) must be made before this task, and it also decides op-sqlite vs expo-sqlite.

### Phase 1 — Capture durability primitives (SPEC M1 core; the trust anchor)
- **A1.1 — Write-ahead journal (REQ-CAP8).** On Record **start**, before any audio file is finalized and before any network call, write a durable `capture_journal` row (id, project, author, start time, modality, intent). This is the single most important line of code in the product.
  - *Check:* kill the app in the first 200ms of recording → on relaunch the journal row exists and is flagged incomplete.
- **A1.2 — Local-first encrypted streaming write (REQ-CAP4).** Audio streams to encrypted local storage **as it records**, in resumable chunks, linked to the journal row. No server object, session, or presigned URL exists yet (that's the ezQuotePro defect we are specifically not repeating).
  - *Check:* airplane mode ON, no network reachable → a recording still starts, streams, and saves fully.
- **A1.3 — Save confirmation, audible + visual (REQ-CAP5) — gated on `MEDIA_COMMITTED`, not on "journal complete" (Codex #6 C1).** "saved ✓" fires **only after** the capture-commit state machine (§0.5 #1) reaches `MEDIA_COMMITTED` — i.e. media finalized+fsync'd+verified-decodable AND the single SQLite transaction (Capture + Attachment + outbound-mutation) has committed. Before that the UI shows an in-progress state, never "saved." Failure is loud, never silent. **Status wording (M4):** "Saved on this phone — not backed up yet" → later "Backed up"; never a fake `ready`.
  - *Check:* a kill in the window *after* the old code would have said "saved" but *before* `MEDIA_COMMITTED` must, on relaunch, show the capture as recoverable/in-progress — never as a lost "saved" item pointing at a truncated file.
- **A1.4 — Crash/fault recovery (REQ-CAP6).** On relaunch, scan for incomplete journal rows and surface a **keep / discard** choice, reattaching any streamed audio.
  - *Check:* after a mid-recording kill, relaunch offers the partial capture with its audio intact.

*Touch budget check (criterion #3 / REQ-CAP1): starting a capture = 1 action; stopping = 1 action; gloved-thumb operable. Spike UI must meet this even though final UX is later.*

### Phase 2 — The owned sync spine (SPEC M0 second half + REQ-PROC4/6)
- **A2.1 — Durable resumable upload queue.** A device-side queue that survives app kill and tracks per-file state (`captured → queued → uploading → uploaded`). Uploads audio to Supabase Storage via an **authorized issuance** endpoint (not a raw client presign).
  - *Check:* kill the app mid-upload → on relaunch the upload resumes from where it stopped; no duplicate object, no lost bytes (checksum matches).
- **A2.2 — Push endpoint (Hono Edge Function).** `POST /sync/push` accepts a capture + attachment metadata with an **idempotency key**; server dedups and upserts; **auth predicate middleware** checks org membership before any write.
  - *Check:* replaying the same push twice creates exactly one row (idempotent); a push for another org is rejected by the middleware (negative test).
- **A2.3 — Pull endpoint + status reconciliation.** `GET /sync/pull` returns the server truth for the device's org working set; device reconciles local rows and advances each item to `synced`. Per-item **one collapsed status** surfaced in the UI (REQ-PROC6 / REQ-X3): *saved ✓ → waiting for connection → uploading → processing → ready* (here "processing" is a no-op pass-through since there's no pipeline yet).
  - *Check:* a capture made offline shows "saved — waiting for connection," and after reconnect advances to "ready" with the server-corroborated timestamp; the round-tripped row equals what was captured.
- **A2.4 — Consent-gated upload (REQ-PROC2, thin).** Wi-Fi → upload; strong cell + cellular-consent ON → upload; else hold. (Recording consent is out of scope for the spike; cellular consent is in, because it gates the queue.)
  - *Check:* with cellular-consent OFF and no Wi-Fi, the item stays "saved — needs Wi-Fi / turn on cellular upload" and never uploads; turning Wi-Fi on drains the queue.

### Phase 3 — The fault-injection harness (the exit gate)
- **A3.1 — Build the harness** (VERIFICATION_PLAN criterion #4). A repeatable script/dev-harness that runs, on a **real device**, each fault against the capture+sync spine and records outcome per trial:
  1. force-kill mid-recording
  2. OS memory-pressure eviction during recording
  3. **storage-full mid-write**
  4. power loss (or forced hard-kill proxy) mid-write
  5. filesystem/DB-corruption injection
  6. mid-**upload** kill (resumability)
  7. mid-**sync/push** kill (no loss, no dup)
  - *(Mid-video-write from criterion #4 is deferred with video to M2.)*
- **A3.2 — Run to a PREDECLARED statistical target (Codex #6 H10), on release builds (H9).** Predeclare a maximum acceptable loss probability + confidence **per fault, per platform** *before* running — do not pick N to flatter the result, and do not pool heterogeneous faults into one N. Bounding a loss rate below ~1e-4 at 95% needs ~30,000 zero-failure trials, which is only feasible via **automated failpoint tests** (crash hooks after every state transition); physical-device runs add platform realism on top. Run against **release builds + the production entrypoint** (a test-only queue passing proves nothing — the exact ezQuotePro trap). The **oracle** must verify expected audio sample-count/duration, decodability, hashes, DB state, queue state, remote object, AND server receipt — not just "a row exists." Log every trial.

---

## 4. The exit gate — how we know Spike A succeeded

Spike A **passes** and P1 M2 may begin only when **all** of these hold, each backed by a logged run, not an assertion:

0. **The §0.5 design artifacts exist and were reviewed** — the gate cannot be met by code that improvised durability.
1. **Loss probability meets the predeclared per-fault/per-platform target** (Codex #6 H10) — no absolute "zero"; the honest invariant (§0.4.2): *no capture is acknowledged unless a verified recoverable copy + durable intent exist,* with residual-loss boundaries (total device loss, app-data deletion, key loss, correlated FS destruction) stated. *(U1, criterion #4.)*
2. **The commit state machine holds:** "saved ✓" never precedes `MEDIA_COMMITTED`; a kill anywhere leaves either a recoverable in-progress capture or a fully-committed one — never a "saved" item pointing at a truncated file (C1; REQ-CAP8/CAP6).
3. **Capture is truly network-independent:** a full capture starts, streams, and saves with airplane mode on and no server object pre-created (REQ-CAP4 — the ezQuotePro defect is absent).
4. **Save confirm is local, audible+visual, honest, and never silent on failure** — status reads "Saved on this phone — not backed up yet" until actually backed up (REQ-CAP5; M4).
5. **Round-trip is loss- and duplicate-free** across mid-push/mid-pull kills, using the §0.5 sync protocol (stable mutation IDs, single-txn receipt+domain, immutable object keys, checkpointed pull) — verified by the oracle, not "a row exists" (C4/C5; REQ-PROC4).
6. **Encrypted at rest — full check, both platforms:** DB *and media*, wrong-key-open fails, tamper detected, key-loss → hard recovery (never re-init over data), on a release build (C3/H3/M1).
7. **Authz holds on the real model:** the Postgres-function authz + negative contract tests deny cross-tenant access on every transport path (not just a middleware org_id check) (C7).
8. **No orphans:** the transactional outbox + sweeper leave no attachment without a job, object without a row, or row without an object (C8).
9. **Touch budget + performance met:** start/stop = 1 action each, gloved-operable; start latency, dropped audio frames, and finalize time gated on low-end Android (M2).

**If any of 0–8 fails: stop. Do not proceed to M2.** Durability is the trust anchor; fixing it is the only priority until the gate is green. A "mixed" result (e.g. resumability solid but storage-full loses a tail) is an honest outcome that scopes the fix — log it and fix before moving on.

---

## 5. Verification protocol for Spike A (per the operating contract)

- **Criteria (Part A):** criteria #1–#4 are the live ones for Spike A (traceable, testable, hands-free budget, never-lose-it). Check continuously.
- **Second-model critic (Layer 2):** ✅ **DONE — Codex #6 ran on this plan (`CRITIC-REVIEW-06-CODEX.md`, 2026-07-16)** and drove this revision; a *second* Codex pass should run on the §0.5 design artifacts once written (the state machine + sync protocol are exactly where a second model earns its keep), before any schema.
- **External signal (Layer 3):** validate SQLCipher-on-device behavior and Supabase Edge Function limits against **live docs** (already pulled: CPU 2s excludes I/O; wall-clock 150/400s), and run the fault suite on a **real phone**, not a simulator — simulators do not reproduce OS eviction or storage-full faithfully.
- **Ledger:** every edge case found during the spike → `IMPLEMENTATION_NOTES §1/§3`. Known open items for Spike A: SQLCipher key rotation, Keychain/Keystore behavior after OS restore/migration, chunked-write resumability semantics on each platform.

---

## 6. What Spike A deliberately leaves for later (clean seams)

So the spike stays small without painting P1 into a corner:
- **Modalities** (photo/video/text + timeline) plug into the same journal + queue — M2. The journal schema already carries `modality`.
- **The AI pipeline** attaches at the `pull`/status "processing" state, which is a no-op pass-through now — M4. The `ProcessingJob` entity and durable-jobs runtime (ADR-3) land then.
- **Full multi-tenant authz** expands the one middleware predicate into the full path matrix (§3.2 of the architecture) — the shape is proven in Spike A, the breadth comes with collaborators.
- **PowerSync vs owned-queue vs append-only** is REOPENED (§0.4.1 / ADR-2) — Spike A's sync scope depends on that decision; if append-only P1 sync is chosen, the §0.5 sync-protocol artifact shrinks dramatically.

---

## 7. One-line summary

**Build the smallest thing that can prove a voice capture is unloseable on a real phone and round-trips to the cloud and back — the journal, the encrypted local write, the owned queue, and a fault harness that tries to break them — and don't build anything else until the loss rate is measured at zero with an honest bound.**
