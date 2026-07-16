# Spike A — Foundation-Spike Build Plan (EZjobsite P1)

*The first thing to build. Written 2026-07-15, before any code, per the operating contract (`CLAUDE.md §3`: "before any multistep build, write a verification plan"). This is the task-level expansion of `SPEC-capture-core-v1.md` **M0 + the durability front of M1**, on the locked stack. It is the concrete plan a builder (you, or Claude Code) executes first.*

---

## 0. What a "spike" is, and why this one is first

A **spike** is a small, deliberately-scoped build whose only job is to **answer a scary technical question with real evidence** before committing to the full build. It is not a feature; it is a risk-killer. You keep the parts that prove out and throw away the rest.

The **foundation spike** attacks the single unknown that, if it fails, sinks the whole product: **U1 — can a capture survive on a real phone with zero loss, offline, across crashes and pressure?** (`VERIFICATION_PLAN` Part C, U1; criterion #4). Everything else in EZjobsite is disposition on top of capture — so we prove capture is unbreakable *first*, cheaply, before building anything that depends on it.

This is the direct antidote to the ezQuotePro failure (`CRITIC-REVIEW-05`): that app *asserted* "ALL TESTS PASSED" on an offline system that (a) was never wired in and (b) was never actually tested against a kill. Spike A's exit gate is the opposite of an assertion — it is a **measured loss rate under injected faults on a physical device.**

**Spike A is "done" when we can say, with a number: a capture started on this phone is recoverable across every fault in the suite, and one such capture round-trips to Postgres and back without loss or duplication.** Not before.

---

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
| Object storage | Supabase Storage for the spike (R2 swap is a later, isolated decision) |
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
  - *Check (both platforms):* the DB file on disk is unreadable without the key (inspect the file — it must not be plain SQLite); app reads/writes normally with the key. **This closes the open "validate SQLCipher on iOS + Android" question.**

### Phase 1 — Capture durability primitives (SPEC M1 core; the trust anchor)
- **A1.1 — Write-ahead journal (REQ-CAP8).** On Record **start**, before any audio file is finalized and before any network call, write a durable `capture_journal` row (id, project, author, start time, modality, intent). This is the single most important line of code in the product.
  - *Check:* kill the app in the first 200ms of recording → on relaunch the journal row exists and is flagged incomplete.
- **A1.2 — Local-first encrypted streaming write (REQ-CAP4).** Audio streams to encrypted local storage **as it records**, in resumable chunks, linked to the journal row. No server object, session, or presigned URL exists yet (that's the ezQuotePro defect we are specifically not repeating).
  - *Check:* airplane mode ON, no network reachable → a recording still starts, streams, and saves fully.
- **A1.3 — Save confirmation, audible + visual (REQ-CAP5).** On finalize, mark the journal row complete and fire an on-screen **and** audible/haptic "saved ✓". Failure is loud, never silent.
  - *Check:* confirm fires on the **local** write, not on any upload; a simulated write failure produces a loud visible+audible failure.
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
- **A3.2 — Run it at N trials and report honestly.** Run each fault enough times to bound the residual loss rate at the confidence you want (0 losses in N only bounds the true rate at ≈3/N — state it, don't imply zero). Log every trial.

---

## 4. The exit gate — how we know Spike A succeeded

Spike A **passes** and P1 M2 may begin only when **all** of these hold, each backed by a logged run, not an assertion:

1. **Zero capture loss** across every fault in A3.1, at a stated trial count N, with the **residual-rate bound written down** (e.g. "0/50 → true loss rate < ~6% at 95%"; raise N until the bound is acceptable). *(U1, criterion #4.)*
2. **Recovery works:** every mid-recording kill leaves a recoverable journal row + its streamed audio (REQ-CAP8/CAP6).
3. **Capture is truly network-independent:** a full capture starts, streams, and saves with airplane mode on and no server object pre-created (REQ-CAP4 — the ezQuotePro defect is absent).
4. **Save confirm is local, audible+visual, and never silent on failure** (REQ-CAP5).
5. **One capture round-trips** offline→online to Postgres + Storage and back with **no loss and no duplicate** (checksum-verified), across a mid-sync kill (REQ-PROC4).
6. **Encrypted at rest, both platforms:** the on-device DB file is unreadable without the Keychain/Keystore key, on iOS **and** Android.
7. **The authz shape holds:** every write path runs through the one predicate middleware; the cross-org negative tests are denied.
8. **Touch budget met:** start = 1 action, stop = 1 action, gloved-operable.

**If any of 1–6 fails: stop. Do not proceed to M2.** Durability is the trust anchor; fixing it is the only priority until the gate is green. A "mixed" result (e.g. resumability solid but storage-full loses a tail) is an honest outcome that scopes the fix — log it and fix before moving on.

---

## 5. Verification protocol for Spike A (per the operating contract)

- **Criteria (Part A):** criteria #1–#4 are the live ones for Spike A (traceable, testable, hands-free budget, never-lose-it). Check continuously.
- **Second-model critic (Layer 2):** before writing the harness, run the **cross-model Codex pass** on *this plan* and on the capture/sync module design — the durability code is exactly where a second model earns its keep. Log findings in `IMPLEMENTATION_NOTES §4`. (The DB and Edge-Functions decisions have not yet had a Codex pass either — fold them in.)
- **External signal (Layer 3):** validate SQLCipher-on-device behavior and Supabase Edge Function limits against **live docs** (already pulled: CPU 2s excludes I/O; wall-clock 150/400s), and run the fault suite on a **real phone**, not a simulator — simulators do not reproduce OS eviction or storage-full faithfully.
- **Ledger:** every edge case found during the spike → `IMPLEMENTATION_NOTES §1/§3`. Known open items for Spike A: SQLCipher key rotation, Keychain/Keystore behavior after OS restore/migration, chunked-write resumability semantics on each platform.

---

## 6. What Spike A deliberately leaves for later (clean seams)

So the spike stays small without painting P1 into a corner:
- **Modalities** (photo/video/text + timeline) plug into the same journal + queue — M2. The journal schema already carries `modality`.
- **The AI pipeline** attaches at the `pull`/status "processing" state, which is a no-op pass-through now — M4. The `ProcessingJob` entity and durable-jobs runtime (ADR-3) land then.
- **Full multi-tenant authz** expands the one middleware predicate into the full path matrix (§3.2 of the architecture) — the shape is proven in Spike A, the breadth comes with collaborators.
- **PowerSync** remains a P1.5+ option if multi-device relational sync ever earns it; the owned queue is what Spike A proves.

---

## 7. One-line summary

**Build the smallest thing that can prove a voice capture is unloseable on a real phone and round-trips to the cloud and back — the journal, the encrypted local write, the owned queue, and a fault harness that tries to break them — and don't build anything else until the loss rate is measured at zero with an honest bound.**
