# IMPLEMENTATION_NOTES.md — Hilo

*Living ledger. Append as you build. This is the project's memory of edge cases, what we know vs. don't, decisions made, and how problems were overcome. Do not delete history — strike through and date instead. Last updated 2026-07-14.*

---

## How to use this file
- **Hit an edge case?** Log it under §1 with the symptom, the cause, and how you overcame it.
- **Made a decision that shapes the build?** Log it under §2 with the trade-off and who approved.
- **Learned something about an unknown?** Move it between the tiers in §3 and note the evidence.
- **Ran the cross-model critic?** Log findings + reconciliation under §4.

---

## §1 — Edge cases & how we overcame them

*(Seeded from research; extend as real ones surface in the build/test.)*

| Edge case | Why it bites | Handling |
|---|---|---|
| App force-killed mid-recording | OS reclaims memory on a busy phone; naive in-memory buffers lose the note — the unforgivable failure. | Stream audio to durable local storage as it records (not on stop); write a recovery journal entry on start; on relaunch, detect and surface the orphaned capture. *Verify with the 200-trial kill test.* |
| "18 seconds of a 20-minute video" (Timemark real complaint) | Long media + weak write path = silent truncation. | Chunked writes with per-chunk integrity; show real byte/duration progress; confirm final length on save. |
| Weak/no signal on a roof or in a basement | Incumbents (Jobber, CompanyCam low-signal) fail here; data stranded or app won't launch. | Everything works fully offline; queue for sync; show per-item "saved locally ✓ / synced ✓" state so the user *sees* it's safe. |
| Price/measurement mangled by ASR ("thirty-two fifty" → 3250 or 32.50?; "3/4 inch") | Alphanumerics are the ASR weak spot; a wrong price is a financial/legal liability. | Never auto-commit a number. Read it back, show it big, tap-to-correct, require explicit confirm. Domain biasing for units/currency. |
| Code-switching (Spanglish), esp. the number lands on the switch | Off-the-shelf models ~48% WER on intra-sentence switching. | Detect language per-utterance; target *translated output* not verbatim; force number confirmation; per-crew adaptation over time. |
| Multi-speaker misattribution ("who directed it") | LLM ambient notes misattribute across speakers; "who authorized this" is the whole point of a CO. | Capture "who directed it" as an explicit confirmed field, not inferred from audio; default to the capturing user's context, let them set the directing party. |
| Homeowner ignores the approval request mid-workday | Approval is only useful if acted on. | Clear, low-friction approve link (no login); price visible before approval; sensible reminders — validate response rate in the field test. |
| Contract voids even email/e-approvals unless a formal CO is executed | Real losses cited ($39k, $70k+) when at-risk work proceeded on weak authorization. | Product captures a strong, timestamped, signed-before-work record; make the authorization artifact defensible and exportable. (Legal weight itself is a known-unknown — see §3.) |
| "Too much AI over broken basics" backlash | Users punish AI features layered on unreliable core capture. | Make AI invisible (organization, translation, extraction); never let it precede rock-solid capture reliability. |
| Phone lost/stolen/dead before an offline capture syncs | Local-first means an unsynced capture lives only on the device — "never lose it" has a device-loss boundary, and it's a breach of recorded homeowner audio. | Encrypt at rest; "days-unsynced" nag; sync opportunistically the instant signal returns; state the boundary honestly. *(Critic M5.)* |
| Indoor / no-address / multi-unit site defeats GPS auto-resolution | Basements, new construction, two crews at one address → wrong project or none. | Resolution layer uses geofence + last-job + recent-captures + manual pin; low confidence → durable "unresolved" queue, never a silent wrong assignment. *(Critic M6.)* |
| Tired/gloved user rubber-stamps a wrong number on confirm | Read-back UI is useless if users confirm without reading; a mangled price ships. | Measure the confirmation-catch rate with injected wrong values; prefer audio read-back + voice-confirm; make the number big and the mismatch loud. *(Critic C3.)* |
| Pivot double-translation drifts (Spanish→English→Portuguese) | English is the interlingua, so non-English↔non-English display is two hops and fidelity can degrade on the second. | English canonical/legal record is unaffected; retained original is the tiebreaker; direct-pair translation is a later optimization. *(LANGUAGE-LAYER §5.)* |
| Stale cached translation shown after a record changes | Decisions are versioned and records change; a cached translation can go out of date. | Bump `content_version` on every change → invalidate + re-translate lazily; never serve a translation older than the record's current version. *(LANGUAGE-LAYER §5.)* |
| Project detection spawns duplicate/spurious projects | Content-based "new project" detection could create near-duplicates of existing projects or junk projects from stray recordings. | Never auto-create — always confirm (REQ-P5); check new proposals against existing projects (name/address/geofence) and surface "did you mean <existing>?"; ambiguous → unresolved queue, not a create. |

---

## §2 — Decisions log

| Date | Decision | Trade-off / why | Approved by |
|---|---|---|---|
| 2026-07-17 | **CompanyCam-parity + wedge PRD authored (`PRD-companycam-parity.md`).** Phased backlog on v1 (not a rewrite). Foundation (auth/company/roles) specced as prerequisite. Maps = **static images only** (no native map SDK). Payments = **excluded** (non-goal). Nav = bottom tab bar incl. Feed. Annotations = **text-only for now** (drawing deferred). Wedge included end-to-end (proposal-review surface `REQ-PROC8` + CO/confirm/sign wired + real delivery channel). New REQ families: `REQ-AUTH/ORG/ROLE`, `REQ-GAL1..6`, `REQ-MAP1`, `REQ-NAV1`, `REQ-PROC8`, `REQ-PM14`. 10 new use cases registered in MASTER. | Breadth-first parity vs. finishing de-risk numbers; user chose to build the rounded product and keep the transaction layer as differentiator. | hadar |
| 2026-07-17 | **REVERSAL: project status `Active/Archived` → `lead → in-progress → complete → archived` + user color labels** (`REQ-PM4`). | CompanyCam-parity project management; the 2-state cap was too thin for a lead pipeline. 2-state remains the P1 fallback. Reversal noted at `PM-LAYER.md` REQ-PM4 + `SPEC §8` Project + `PRD-companycam-parity.md §10`. | hadar |
| 2026-07-14 | Phase goal = **de-risk hard parts** via thin slice + test, not ship MVP | Cheapest path to kill/validate the scary unknowns before big investment. | hadar |
| 2026-07-14 | v1 scope = **priced verbal change-order wedge**, data model architected for broad capture | Lead with the money use case nobody owns; avoid the all-in-one trap. | hadar |
| 2026-07-14 | Capture is **multimodal**: text, audio, video, image | User requirement — one capture primitive, four input types. | hadar |
| 2026-07-14 | Language is **modular**: auto-detect source → user-selected target; keep source audio+transcript | User requirement — not hardwired Spanish→English; translation target configurable. | hadar |
| 2026-07-14 | Client = **cross-platform (Flutter/RN)**; Flutter-vs-RN deferred to arch phase | One codebase; native audio/offline still needs platform work. | hadar |
| 2026-07-14 | Hands-free *interaction model* deferred to UX phase; **hands-free budget** kept as a hard constraint now | Keep v1 flexible without losing the core constraint. | hadar |
| 2026-07-14 | ~~Xano = candidate backend~~ **Xano dropped**; new candidate **Supabase + PowerSync** (alt Firebase) | User's call; media-heavy offline-first + conflict-safe sync is the demanding part — Supabase(Postgres)+PowerSync fits the relational model and gives real offline sync. Validate in Phase 1. | hadar |
| 2026-07-15 | **OPEN-ISSUE GATE before build phase — 4 decisions (hadar, via question tool).** (1) **Codex adversarial pass runs BEFORE any Spike A code** — scoped to ADR-2 (owned queue) + ADR-5 (Edge Functions runtime) + the durability design + the Spike A plan; prompt + local run command in `SECURITY-AND-CODEX-PROMPT` note / CLAUDE §4. Spike A coding is gated behind reconciling it. (2) **Company member management spec'd NOW** as REQ-MEMBER-1..5 in `PM-LAYER.md` (invite/accept/role-change/deactivate-offboard for one's own crew) — doesn't block Spike A (single hard-coded user/org) but is load-bearing for the authz predicate. (3) **Secrets rotation list requested** → `SECRETS-ROTATION.md` compiled from CRITIC-05 (8 committed secrets + plaintext passwords/tokens). **DEFERRED 2026-07-16 by hadar ("not fixing ezQuote right now")** — noted as open housekeeping; does NOT block EZjobsite (greenfield, no inheritance). Revisit before ezQuotePro sees more users. (4) **UX specification deferred to AFTER Spike A proves durability** (before P1.5 handlers) — the spike uses a plain Record button, needs no polished hands-free UX. **Still-open (non-blocking, P1.5-gating): pricing ownership, residential-only vs sub-to-GC, first integration target — left until the durability spike is done.** | hadar. | hadar |
| 2026-07-15 | **API RUNTIME + LANGUAGE LOCKED (ADR-5).** *(Corrected 2026-07-16: this was mis-titled ADR-4; the runtime ADR is ADR-5 in ARCHITECTURE — ADR-4 is "client stays thin." Fixes Codex #6 H12.)* **TypeScript everywhere**, one shared monorepo (RN/Expo app + Next web + shared packages + `supabase/`). **API runs on Supabase Edge Functions (Deno runtime)** — chosen over running our own Node service because "nothing to host" fits a solo builder and the endpoints sit next to the DB; keys stay server-side (Edge Function secrets — the direct fix to ezQuotePro's client-side Deepgram key). **API framework = Hono + zod** so the API is *manageable*: one router, shared middleware, typed end-to-end; **the one authorization predicate (MF-2) is implemented as shared Hono middleware** every route runs through. **External LLM/STT calls:** short single-shot calls may run in an Edge Function (LLM latency is I/O, not CPU — the 2s CPU limit does not apply to waiting; wall-clock is 150s free / 400s paid); the **multi-step capture-processing pipeline runs in the durable-jobs runtime (Node, ADR-3), not synchronously in an Edge Function** — Edge Functions have no built-in retry/resume. Hono is portable Deno↔Node, so if Edge Function limits ever bite, the same API code moves to a Node service with no rewrite. Trade-off accepted: two runtimes in play (Deno for API, Node for jobs) — both TypeScript, mitigated by Hono's portability. | hadar ("lets start with edge functions"). | hadar |
| 2026-07-16 | **ADR-2 RE-RESOLVED → ADOPT POWERSYNC AS THE SYNC TRANSPORT (hadar). The bakeoff is CLOSED.** The two faults that killed our hand-built design twice were thrown at PowerSync and it survived both: **commit-ordering under a deterministic stalled-commit inversion (40/40 trials across two independent harness revisions)** and **mutable operational state** (pending offline edit preserved across a conflicting server edit; server-owned field refused at the DB boundary with `42501`). **Mechanism — the load-bearing insight:** Postgres logical decoding emits changes in **commit order**, so a late-committing row lands at a **later** stream position and there is no cursor for it to fall behind. **The `seq`-cursor model we kept getting wrong is simply not how the transport works.** **Counterweight, and it did not go our way:** PowerSync has **no resumable upload** (`uploadFile(ArrayBuffer)`, whole buffer, no TUS) — a killed upload restarts at byte zero. **We build and own media durability — but we would own it under either option, so it does not discriminate.** **⚠️ Made OVER a cross-model objection, knowingly:** `CRITIC-REVIEW-10-CODEX` ruled *"Q1 survives: NO · Q2: NO · fit to support ADR-2: NO · a third frozen run is required."* Codex was **right on every point** — but about **assertion rigor in a throwaway harness**, not observed behaviour, which it called *"credible and materially better."* **No review round ever suggested PowerSync got the ordering wrong.** hadar: the remaining rigor gap cannot change the answer; `SPIKE-SYNC-BAKEOFF.md:120` explicitly permits deciding rather than sinking more. **The "VALID PASS" labels are WITHDRAWN — this rests on behaviour + judgment, not a cleared gate.** **Q3 never ran** (no physical device; Option B undesigned) and is largely moot after DECISION 4 → Option A. **Consequences:** DURABILITY-DESIGN **Artifact 2 (sync protocol) is largely REPLACED** — seq-ordering/checkpoint/tombstone/pull becomes PowerSync's problem; **Codex #7 blockers 1 and 3 DISSOLVE (transport-owned)**; **blocker 2 (`MEDIA_COMMITTED` atomicity) REMAINS OURS**, now the top of the Spike A critical path — **one problem instead of three**; Artifacts 1/5/6/8 + semantic conflict resolution + backend idempotency + all media durability stay ours; **append-only still governs EVIDENCE, enforced by our rules not the transport**; **L5's open gap resolves toward option (a)** — evidence ledger append-only, mutable operational state syncs via PowerSync (Q2 demonstrated it). **Accepted known costs:** attachments helper is **alpha** (`@powersync/attachments` deprecated → built-in); a client write to a server-owned field is **applied locally then silently reverted with no rejection hook — a UX defect to design around**; Sync Streams have **no server-side `now()`** so *"Active projects + last-N-days"* is only **half** expressible natively; **REQ-MEMBER-5 revocation untested and still undefined** (cited 4×, defined 0×); **untested residual — whole-file `ArrayBuffer` memory for multi-minute media**. **Cost:** no Supabase IPv4 add-on needed (PowerSync Cloud reaches the IPv6-only direct host; replication streaming, lag 0 bytes). **Edits applied (☑ all exist):** ☑ `ARCHITECTURE.md` top banner (2026-07-15 banner superseded, not deleted); ☑ `ARCHITECTURE.md` ADR-2 body; ☑ open-forks line; ☑ Spike A line; ☑ `BAKEOFF-RESULT.md` decision section. | hadar (decision); Claude (bakeoff + evidence). | hadar |
| 2026-07-16 | **DECISION 4 RE-DECIDED → OPTION A: client-side media encryption DROPPED for v1 (hadar).** Triggered by hadar asking the first-principles question *"why do we need to encrypt the media?"* — for which there turned out to be no good v1 answer. Option B never served security or the user; it existed **solely** to make L4's crypto-shred carve-out enforceable. Three facts killed it: **(1)** crypto-shred never covered the data that matters — `CRITIC-REVIEW-02` H1 established transcripts/`canonical_en` are FTS-indexed **plaintext in Postgres**, and the adopted fix was already *"two data classes: blob crypto-shred; plaintext hard-delete + device purge"*, so the searchable personal data was **always** hard-deleted; crypto-shred only ever covered the audio blob. **(2)** Its one edge over plain deletion (erasing unreachable backups) was already conceded — `CRITIC-REVIEW-04-CODEX` required *"document backup expiry rather than claiming immediate complete erasure"* and flagged vendors/logs/quarantine-plaintext as outside it. **(3)** The cost was load-bearing: Option B was the sole reason sync-bakeoff Q3 was unanswerable (*"there is no production unwrap path to test"* — `CRITIC-REVIEW-09-CODEX`), demanded an undesigned key lifecycle, forced SQLCipher/op-sqlite coupling, and created **device-key-loss = permanent loss of unsynced captures** — a new failure mode in a product whose north star is never losing a capture. Market reality (hadar): *"we are selling to solo owners with 2-10 employees — let's not overdo it."* No erasure/residency clauses; zero users. **Accepted trade:** OS file protection on-device + Supabase Storage at-rest + RLS + signed URLs; we give up protection from a malicious Supabase and enforceable crypto-shred. **Revisit trigger:** first contract with a hard right-to-erasure/data-residency clause, or first EU customer — it lands behind the `RemoteStorage` abstraction. **Edits applied (☑ all exist):** ☑ `DURABILITY-DESIGN-v1` DECISION 4 → Option A + rationale + revisit trigger; ☑ `DURABILITY-DESIGN-v1` L4 carve-out → hard-delete + erasure inventory + named residual boundaries; ☑ `SPEC-capture-core-v1` REQ-CAP4 reworded to OS-file-protection at rest; ☑ `CORE-CONCEPT.md:43` L4 → hard-delete. **Consequence for the bakeoff:** Q3 collapses — no DEK, no unwrap path, no plaintext-canary scan. What remains of Q3 is "does the attachment queue move bytes, and can it resume" — and the resume half is already answered **NO** at the API level (`uploadFile(ArrayBuffer)`, no TUS). The **untested** residual risk is whole-file `ArrayBuffer` memory behaviour for multi-minute media on-device. | hadar (decision); Claude (chain + edits). | hadar |
| 2026-07-16 | **DURABILITY DESIGN DOC DRAFTED (`DURABILITY-DESIGN-v1.md`) — the pre-code design gate (Codex #6 §0.5).** All 9 artifacts drafted: (1) capture-commit state machine — "saved ✓" only at `MEDIA_COMMITTED`, sidecar manifest as recovery source of truth, per-state crash/recovery table; (2) append-only sync protocol — stable mutation IDs + single-txn receipt, server-`seq` keyset pull, tombstones only for windowing/revocation, project-merge as the one confirmed semantic op; (3) content-addressed object keys + UUIDv7 mutation IDs + verify-then-link; (4) media encryption **[DECISION 4 ✅ LOCKED: Option B, per-capture-key envelope encryption — enables real crypto-shred + server-recoverable synced captures; provisionally op-sqlite for the DB too]**; (5) authz in Postgres functions + per-transport negative tests; (6) transactional outbox + dispatcher + orphan sweeper; (7) storage **[DECISION 7 ✅ LOCKED: Supabase Storage for P1 (integrated auth/TUS/one-vendor), R2 as the P1.5 zero-egress optimization behind the RemoteStorage abstraction]**; (8) failpoint matrix + predeclared per-fault/per-platform targets (core loss <1e-4@95% ≈30k trials) + expanded fault list + release-build oracle; (9) append-only decision record. **Pending:** hadar signs off Decisions 4 & 7 → 2nd Codex pass on this doc → then A0.2 schema. | Claude drafted; hadar 2 decisions. | hadar |
| 2026-07-16 | **SYNC DIRECTION → RUN THE POWERSYNC BAKEOFF FIRST (hadar; `SPIKE-SYNC-BAKEOFF.md`).** Codex #7 hard-failed the hand-built design v1 (2/20 closed) on three distributed-systems blockers — seq not commit-ordered (silent capture loss), MEDIA_COMMITTED not atomic, and L5 append-only false for operational state. Two hand-built rounds failed on the exact class of problem PowerSync/ElectricSQL exist to solve, and the L5 finding voids the "append-only makes sync simple" premise that justified rejecting PowerSync in the first place. **Decision: before writing DURABILITY-DESIGN-v2 blind, run a time-boxed (2–4 day) build-vs-buy bakeoff** that throws the three killer faults at PowerSync: (Q1) commit-ordering under a stalled-txn, (Q2) mutable operational-state sync, (Q3) **encrypted-media attachments** (Option B ciphertext — the likeliest misfit; PowerSync's attachment helper is now format-agnostic + RN-supported but **alpha**). ADOPT only if Q1–Q3 pass + no dealbreaker on cost/RN-maturity/consistency; else hand-build v2 knowing the engines don't fit. **Kept either way:** the on-device capture-commit state machine (Artifact 1), append-only for *evidence*, Option B encryption, and our backend (authz/outbox/failpoints). If adopted, Artifact 2 (sync protocol) is largely REPLACED by PowerSync and blockers 1&3 dissolve. **External signal corrected:** the "PowerSync Attachments experimental → reject" rationale in the old ADR-2 was stale. Bakeoff result + a Codex pass on it gate the ADR-2 flip. | hadar chose the bakeoff over blind v2. | hadar |
| 2026-07-16 | **ADR-2 RESOLVED → APPEND-ONLY SYNC (hadar) + honest save-promise (mandate #1 reworded).** After Codex #6 reopened the owned-queue-vs-PowerSync question, hadar picked **append-only sync for P1** with a key refinement that makes it a natural fit: **(1) Media (audio/images) is immutable — never merged, never edited** — so we never merge an audio file; the only thing that ever merges is the **derived text/decision record after transcription**, which is far simpler. **(2) Versioning is required:** keep the **original recordings + images as immutable, tamper-proof evidence** (if someone tries to change what was said/shown, the original stands). **(3) Approval freezes + makes permanent:** once a record is **digitally approved/signed it can never be edited in place NOR deleted** — a change is a **new record appended on top** (which needs its own approval); a removal is a superseding record, never destruction. The **only** lawful exception is GDPR/CCPA **crypto-shred + retained hash/metadata stub** (destroys personal data, keeps the evidence skeleton). This is the append-only law: nothing approved is ever mutated; all change is new immutable rows. Sharpens the existing "frozen `shown_content` = binding artifact" + "decisions are versioned, latest-supersedes, history retained" into one rule. **Consequence:** the §0.5 sync-protocol artifact shrinks — no generic two-way merge engine; P1 sync = append immutable capture-receipts + version rows. Also **adopted the honest save-promise (Codex C2):** mandate #1 reworded from absolute "never lose" to *"never acknowledge a capture unless a verified recoverable copy + durable intent exist; refuse to start loudly when capacity can't be reserved,"* + stated residual-loss boundaries. | hadar (both recs + the media-immutable/version/approval-freeze refinement). | hadar |
| 2026-07-15 | **DATABASE LOCKED (both engines + backend + sync).** Device store = **SQLite (encrypted)**; cloud = **PostgreSQL via Supabase (raw Postgres)** — Auth/RLS/Edge Fns/Storage, relational fit for multi-tenant + collaborators, managed, first-class TS/RN SDKs. Sync = **a simple owned queue for P1** (NOT PowerSync): device-local write-ahead capture journal (REQ-CAP8) + durable resumable upload queue + reconnect processing queue — the three-layer durability we already spec'd, built and owned, not a streaming-sync engine. **PowerSync deferred to P1.5+**, adopted only if/when multi-device conflict-free *relational* sync (the collaborator feed) actually earns it. **Why owned-queue over PowerSync for P1:** the ezQuotePro post-mortem proved the failure mode is a cloud-first capture path, not a weak sync engine; a simple owned queue is fully debuggable by a solo dev, has no experimental-API risk (PowerSync Attachments is marked experimental), and dissolves the PowerSync-specific review findings (Sync-Rules↔RLS parity, sync-rule re-replication cost). **Supersedes the 2026-07-14 "Supabase + PowerSync" line above and the §4.2/§4.3 forks in MVP-RECONCILIATION.** Trade-off accepted: we hand-build queue durability + conflict handling P1 (mitigated — it's a small, well-understood surface and it's the thing we most need to own); if multi-device relational sync gets heavy, revisit PowerSync. | hadar (verified key decision, via question tool) |
| 2026-07-15 | **Offline-forward is paramount; all four modalities (text/voice/image/video) capture offline via internal device capabilities** | User requirement — reception is never a precondition to capture/store. Overrides the critic's "defer video/image" for the *capture* layer; AI structuring de-risk stays voice/text. | hadar |
| 2026-07-15 | **GPS + time evidence stamp** on every voice/image/video capture | User requirement; matches the timestamp+GPS "dispute armor" that trades pay for. | hadar |
| 2026-07-15 | **Project Resolution is its own layer** (auto-assign + secondary workflow on ambiguity/no-match) | User requirement — no manual filing; unresolved captures held durably, never lost. | hadar |
| 2026-07-15 | Recording **consent** + lawful **retention/erasure** are requirements, not "forever" | Critic C4 — two-party-consent states + CCPA/GDPR erasure; "forever" retention was a legal liability. | Claude→hadar to confirm |
| 2026-07-15 | De-risk sequencing = **cheap laptop spikes (U3/U4/U5/U6) before any app code**; gold-set is a first-class milestone; video/image cut from *AI* de-risk | Critic C2/C5/H4 — build the known-solvable thing last; kill product-killers cheaply first. | Claude→hadar to confirm |
| 2026-07-15 | **Reframe: capture is the core; Evidence = base layer; Approval / Change Order / Report = 3 actions.** The CO-first spec becomes one handler on a capture core. | hadar's core-concept framing — see `CORE-CONCEPT.md`. | hadar |
| 2026-07-15 | **De-risk v1 leads with Capture + Evidence**, not Change Order. AI-heavy handlers (CO, language) are fast-follow. | Cheapest proof of the true core; CO carries money but isn't built first. Reshapes the SPEC's Phase 0/2 lead. | hadar |
| 2026-07-15 | **Processing is online: capture offline always, process on reconnect; no heavy on-device ML in v1.** | hadar. Resolves unknown U7 toward cloud-processing-on-reconnect; relaxes on-device requirements. | hadar |
| 2026-07-15 | **Approval signature = owner's own device via sent link** (remote); no in-person field-device signing in v1. | hadar. | hadar |
| 2026-07-15 | **Video key points = auto-detect + user-marked**; images during a recording are timeline-synced for report compilation. | hadar. New capture mechanics — timeline is the organizing structure. | hadar |
| 2026-07-15 | Two distinct consents: **recording consent** (legal) + **cellular-upload consent** (cost). Wi-Fi uploads; cell uploads only with consent. | hadar's connection rules. | hadar |
| 2026-07-15 | **Merged both use-case catalogs** (my seed + hadar's CompanyCam analysis) into `MASTER-USE-CASES.md` (35 deduped). Adopted: Approval Spectrum, decision-of-record, sub↔GC directive, status ledger, evidence bundle. | Enrichment before re-processing, per hadar. | hadar |
| 2026-07-15 | **Sequencing confirmed: Capture+Evidence = P1; Change Order/Approval/Report = P1.5** (overrode hadar's older CO-first catalog). | hadar confirmed. | hadar |
| 2026-07-15 | **Spec re-derived → `SPEC-capture-core-v1.md`** (capture core + handler model). Old `SPEC-v1-change-order-wedge.md` superseded → becomes the P1.5 CO handler. AI unknowns (U3/4/5/6/8) now gate P1.5 entry, not P1. | hadar chose "re-derive now". | hadar |
| 2026-07-15 | **Project Management layer** added (`PM-LAYER.md`): Project is first-class (create/info/list/search/nearby/feed). "Job" renamed **Project**. | hadar's PM use-case list. | hadar |
| 2026-07-15 | **Project creation = field quick-create + office cleanup** (both). | hadar. | hadar |
| 2026-07-15 | **Sub-sharing = Option C** — labeled authors in v1, cross-company sharing architected as a seam. Author+org carried in the data model from day one. | hadar. Keeps de-risk build single-tenant. | hadar |
| 2026-07-15 | **Role model** — Office/Owner sees company-wide feed + manages; Field sees own projects; Sub = labeled author. Feed is a role-scoped query, not a new store. | hadar. | hadar |
| 2026-07-15 | **Project status = Active + Archived** in v1. PM create/list/search/nearby/authorship = P1; feed/roles/sub-sharing = P1.5. | hadar. | hadar |
| 2026-07-15 | **Project detection from a recording** (PM-10): resolution uses **content signals** (spoken client/address/job ref) + GPS to match an existing project OR **propose a new one**, confirm-gated, never auto-created. Detection = P1; AI field pre-fill = P1.5. | hadar use case. Extends REQ-P1 → REQ-P4/P5. | hadar |
| 2026-07-15 | Analyzed **CompanyCam AI Checklists + AI Walkthrough Notes** (`companycam-ai-features-analysis.md`). They shipped voice→document/checklist → now **table stakes**; wedge stays = transaction + language + offline reliability (they stop at documentation). | hadar competitive input. | hadar |
| 2026-07-15 | **Scope & responsibility delineation added** (REQ-VAL6/7, COLLAB7, SCOPE-1/2/3): decisions have **2 scope layers** (project vs party/worker); actionable decisions carry an **assignee**; invited parties carry **role + scope-of-work**; system flags trade-boundary gaps/overlaps (the air-handler problem). Assignment/scope-level/role-field = P1; gap-overlap detection + review = P1.5. | hadar — a major jobsite pain (research pain #6 / scope gaps). | hadar |
| 2026-07-15 | **Clarification: "approval" = digital signature.** The Approval action/spectrum top is a binding **digital signature** (not just a tap); distinct from the unsigned verify/confirm. Updated CLAUDE #2, core-concept, SPEC §1/§7.1. | hadar clarification. | hadar |
| 2026-07-15 | **Clarification: core goal = protect contractors/subs from miscommunication + errors; works with NO office.** Office is a role, never a requirement; a solo operator gets all info + communicates to workers. Pinned in CLAUDE §1, core-concept §1, SPEC §1; roles updated (PM-13). | hadar clarification. | hadar |
| 2026-07-15 | **CODEX CODE AUDIT** (`CRITIC-REVIEW-05-CODEX-CODE.md`; read the real ezQuotePro source). **Verdict: code POOR; greenfield strongly agree; P1 split durability-first strongly agree.** Corrected MY overclaiming scan with file:line evidence: the "production-ready offline system" is **NOT wired into the shipped app** (App.js never inits it; lived only in git `3319ada`); the newer RecordingManager/UploadCoordinator stack is unwired + broken; **shipped RecordBlock is NOT offline-first** (calls Xano + signed-URL BEFORE recording/queueing → airplane mode can't start or save); **"ALL TESTS PASSED" = file-existence checks, no real tests, Jest not even installed**; **≥8 committed secrets + plaintext passwords/tokens**. **LOCKED: greenfield + P1-split(durability-first).** **THE LESSON (→ principle): "offline reliability is not an upload queue — it's a locally-committed capture transaction that succeeds before the first network call."** 🔴 Urgent security list in CRITIC-05 — rotate all keys now. | hadar ran Codex on the code. | hadar |
| 2026-07-15 | **BUILD POSTURE RESOLVED: GREENFIELD, ezQuotePro = lessons donor.** hadar's ground truth: previous mistakes = **UX + adoption/GTM + "offline workflow utilization was not right"** (wedge NOT named as wrong); soft-launched/few users (nothing battle-proven); hadar wants a from-scratch build; shipped offline wiring unknown (trace it). Audit reframed from adopt/adapt/discard → **lessons mine** (edge cases, offline-failure archaeology, and unpacking the offline-workflow mistake as a hard UX-phase input). Backend (Xano-vs-Supabase) reverts to merits, no inheritance bias; simple-queue-vs-PowerSync to be settled by the foundation spike's stress evidence. Rewrite-trap antidote = the spec suite + lessons ledger + old app as reference. | hadar interview. | hadar |
| 2026-07-15 | **hadar challenge: "is what's built even good?" → MVP adoption GATED by quality audit** (`MVP-AUDIT-PLAN.md`). My reconciliation overclaimed ("riskiest assumption solved" → downgraded to "promising, unverified prior attempt"); caveat added to the doc. Warning signs already in hand: the "ALL TESTS PASSED" offline result is **static analysis only** (no runtime/device/kill tests); **two overlapping offline systems** (one 55%/untested on a branch); hardcoded client API key; 18-doc churn = restart fossil record. **Rule: no inheritance — ADOPT/ADAPT/DISCARD per component via audit Q1–Q6.** | hadar — don't repeat previous mistakes. | hadar |
| 2026-07-15 | **Scanned the shipped ezQuotePro MVP** (`MVP-RECONCILIATION.md`) — external signal. **Game-changer: EZjobsite is an *extension*, not greenfield.** Proven in production: RN/Expo SDK52, **Deepgram** STT (diarized), **S3**, **Xano** backend (auth/teams/companies/change-orders), **full offline-first system (~13k lines, AsyncStorage+queues, NO PowerSync)** — the riskiest assumption already solved — **EN/ES/RU/UK/ZH i18n incl. offline keys (REQ-X2 ~done)**, AI voice→JSON analyzer (confidence/gaps pattern), RevenueCat. **Reconciliations:** adopt Deepgram; PowerSync likely unnecessary for P1 (reuse proven AsyncStorage+queue model → dissolves the Sync-Rules/RLS-parity + re-replication findings); decide extend-Xano vs Supabase; P1 = fork proven spine + build decision/approval loop; real new unknown = Spanish/Spanglish *decision* extraction. **URGENT: Deepgram API key hardcoded in client (`deepgram.js`) — rotate + server-proxy.** **Confirm which offline layer is production-wired (services=tested; v2.1 recorder=55%/branch).** | hadar connected the repo. Build-posture + backend forks pending. | hadar |
| 2026-07-15 | **CODEX CROSS-MODEL REVIEW COMPLETED** (`CRITIC-REVIEW-04-CODEX.md`; gpt-5.6-sol, run by hadar locally — the protocol's second-system check is now DONE). **Verdict: DISAGREE with the broad-P1 architectural greenlight; ENDORSES starting the narrow capture-durability spike now.** 6 Critical / 8 High new findings adopted (video-temp-file contradiction, pre-roll-vs-consent, plaintext quarantine hole, authz policy-matrix realization, merge tombstones, billing ledger, doc contradictions). MF spot-check: 4 verified, **3 inadequate (MF-1/2/4 — prose commitments, not protocols)**. **Genuine disagreement → hadar: P1 scope — Codex + the fable review have now independently converged against "keep P1 as is."** | hadar ran the check; reconciliation logged. | hadar to decide P1 scope |
| 2026-07-15 | **Greenlight reconciliation applied — SPIKE IS GREENLIT.** *(Superseded in part by the Codex review above: the narrow spike remains greenlit; the broad-P1 "GO" is re-opened pending hadar's scope decision.)* All 7 MF items edited into the docs (verified per the ☑-only-with-edit rule; map in CRITIC-REVIEW-03 header + ARCH §12). Decisions (recommended options; question tool errored — hadar may override): **P1 delivery = email + SMS, 10DLC at kickoff** · **margin = honest 60–70%, keep $19/$49, Free minute-metering + lazy processing** · **feed = PowerSync-local rendered**. New spec REQs: VAL8 (delivery), X2 (ES localization), X3 (one collapsed status), CON1 revised (consent at job creation), X1 send ≤3. | Claude→hadar to confirm the 3 calls. | Claude→hadar |
| 2026-07-15 | **Fable greenlight review run** (`CRITIC-REVIEW-03.md`): different model (claude-fable-5) + 3 fresh-context agents (security/scalability/UX) reading docs only — the substantive second-model check. **Verdict: FIX-FIRST THEN GO** — all axes GREEN-WITH-CONDITIONS; 7 must-fix-before-code (encryption/KMS design, one authz module for all paths, kill Realtime feed → PowerSync-rendered, near-immutable windowed sync rules, P1 delivery channel decision, real H8 closure, P1 ES localization + consent off the capture path). **Meta-finding: CR-02 L2/L3 "reconciled" claims failed verification** (pricing never repriced → blended margin ~60–70% not 70–80%; feed was load-bearing) — process fix: ☑ only when the document edit exists. | hadar's review protocol. | hadar |
| 2026-07-15 | **Video is never stored (hadar) — resolves critic C1 + M3.** Video = transient capture medium; **on-device 2-step extraction** → store only **audio + key stills**, discard raw video. Storage → near-zero (free-user floor holds, video can be a normal feature); server ffmpeg gone; smaller uploads ease C3. On-device extraction = cheap deterministic media work, NOT on-device ML (transcription stays cloud). Trade-off: continuous video not kept as evidence (audio+stills+transcript is). Threaded into ARCHITECTURE §3.1/§3.4/§11, SPEC REQ-TL4 + MediaAsset, pricing. | hadar. | hadar |
| 2026-07-15 | **ADR-1 resolved: React Native + Expo** (not Flutter) — hadar strongest in TS/React + wants a shared-code web surface (office/feed). Shared TS monorepo (RN mobile + React/Next web). | hadar. | hadar |
| 2026-07-15 | **Architecture critic #02** (`CRITIC-REVIEW-02.md`): 3C/5H/6M/3L. Fixed in arch §11 — C2 (Sync Rules = client boundary, not RLS), C3 (native background upload + honest promise), H1 (erasure two-class + device purge + residual), H2 (idempotency keys), H3 (server merge, decision append-not-LWW), H4 (trigger on attachment-SYNCED), H5 (10DLC critical path + email fallback), M1/M2/M5/M6. **Open: C1 (video retention/cost) → hadar.** | verification protocol. | hadar |
| 2026-07-15 | **Architecture + stack designed** (`ezjobsite-architecture.md`): Flutter client (ADR-1, confirm) + **PowerSync + Supabase** offline-first (ADR-2, validated) + R2 media + durable-jobs pipeline (Trigger.dev/Inngest, ADR-3) + OpenAI STT + Gemini Flash-Lite + Twilio Verify signatures + push. Client thin (no on-device ML). RLS multi-tenant/collaborators. Answers critic C1/C2/C3/H5/M5. External signal pulled; 3 spikes to validate. | hadar architecture ask. Flutter-vs-RN pending confirm; recommend Codex pass on arch. | hadar |
| 2026-07-15 | **Pricing strategy drafted** (`ezjobsite-pricing-strategy.md`): Free/Core/Crew/Enterprise; **crew + homeowners free forever**, pay managers only (TaskTag model); Free capped by **projects × decisions**; meter the AI/SMS not the people. Rec prices Free $0 / Core ~$19 / Crew ~$49 / Ent custom. Cost floor ~cents/user (SMS is the only real cost); ~70–80% margin. Live 2026 competitor + unit-cost research. | hadar pricing ask. **Confirmed: Core $19/mo · Free = 2 projects × 15 decisions · Enterprise stubbed (focus Free→Core→Crew).** Defaults: decisions = metered unit, SMS-OTP starts at Core, annual + price-lock. | hadar |
| 2026-07-15 | **Naming clarified: product = EZjobsite** (jobsite-focused), a **Hilo** (venture group) portfolio company. "Hilo" = parent; product working-name corrected to EZjobsite. Pinned in CLAUDE §0, CORE-CONCEPT §1, SPEC. Filenames keep `hilo-` prefix for continuity. | hadar. | hadar |
| 2026-07-15 | **Core design principle pinned** (CLAUDE §1, CORE-CONCEPT §1, SPEC §1): built for users for whom **software is not second nature**, capturing **anywhere** (jobsite/car/city office/material shopping); **user provides info, system does 100% of organization in the backend**. Test every screen: "would a non-software person succeed without being taught?" | hadar — core requirement, not polish. | hadar |
| 2026-07-15 | **Communication layer specified** (`COMMUNICATION-LAYER.md`): route decisions between parties by type+intent (verify vs approve), off-site in-language delivery, live field status, everything recorded. Net-new: the **mini change order** (fast one-tap "proceed" to keep the job moving — directly answers the verbal-CO trap in the research) and party×intent routing. Light verify = P1; routing/mini-CO/delivery = P1.5; report cadence/RFI = P2. | hadar core-feature. | hadar |
| 2026-07-15 | **Collaborator (cross-company) model specified** (REQ-COLLAB1-6): invite a company to a project via link, **free** for both, contribute attributed to their org, project-scoped, end-anytime + host keeps content, reinvite. This is the concrete "Option B" seam (Option C decided earlier: author+org in P1, this build P1.5). **Composes with language layer** (each company its own language, English-canonical) — an edge over CompanyCam's English-only collaboration. **Free = growth loop + data-completeness**; candidate to prioritize within P1.5. | hadar use case. | hadar |
| 2026-07-15 | **Offline reinforced as core** (REQ-PROC6/7): media always to device first; **processing status shows the reason** ("needs Wi-Fi/cell") and never blocks capture; **projects work offline** (create/capture/list/search/nearby offline; sync on reconnect). | hadar core-feature emphasis; strengthens mandate #1/#7. | hadar |
| 2026-07-15 | **Language layer specified** (`LANGUAGE-LAYER.md`): **English-canonical pivot** (permanent record always English), **original + source language retained**, **per-user preferred display language**, **translate-once cache**, **English-pivot search**. Refines the earlier "modular target" into English-as-interlingua. Store-original+detect+pref-lang = P1; translate/display/cache/search = P1.5 (gate U3/U8). | hadar core-feature spec. | hadar |
| 2026-07-15 | **Decision handler enriched** (DEC-1/2, NOTIF-1): decision is a **versioned aggregation unit** (subject + latest-value-supersedes + retained history; photos aggregate *around* the decision; AI tags). **Decision-approval sub-flow**: requires-approval → notify owner → digital approve on a **Page** → verified timestamp → notify instigator. **Notification** layer added. | hadar use case. Enriches Validation/Approval (REQ-VAL5 + §7.1 sub-flow); new Decision/Notification/Page entities. Versioning=P1, AI-tags/approval/notify=P1.5. | hadar |
| 2026-07-15 | CompanyCam **overview video** reviewed — mostly confirmatory; net-new noted (Pages, doc storage/scan, @mention notifs, photo-required-to-complete checklist). Reaffirmed **do-not-build**: payments/invoicing/50+ integrations (integrate, don't build). | hadar competitive input. | hadar |
| 2026-07-15 | **Checklist/Tasks added as a first-class handler** (create by voice / assign / complete by voice+photo, honor negation; derive from a walkthrough note). **Report enriched** with walkthrough note + **pause=section-break** + export/template tail. Dispositions can **derive from dispositions**. Priority: capture=P1, generation=P1.5. | *AskUserQuestion tool errored mid-call; Claude made the recommended calls aligned with prior decisions — hadar to override if wrong.* | Claude→hadar to confirm |

---

## §3 — The three-tier unknowns ledger

### Knowns (well-supported by research/evidence)
- Voice capture is ~2.5–3x faster than mobile typing (net of correction, ~2.5x) and produces **richer, more complete** records — the completeness win is the real prize.
- **Silent data loss** is the category's #1 trust-killer; offline/weak-signal failure is the #1 shared incumbent weakness.
- No incumbent turns a **spoken decision into a priced, approvable, timestamped CO**; CompanyCam voice only writes documentation. This is the open wedge.
- The workforce in target trades is heavily Spanish-speaking (drywall ~75%, roofing ~64%, painting ~62%); language is a costed, safety-linked problem incumbents treat as *display*, not *transaction*.
- LLM structuring has **quantified dangerous failure modes** (hallucination ~31% in the closest domain) → human confirmation on priced output is mandatory.
- Numbers/prices/measurements/model-numbers are the ASR weak spot and carry the legal/financial weight.

### Known-unknowns (we know we must measure these — the de-risk targets)
- **Spanish/Spanglish WER in real jobsite noise** — no public data exists; must field-benchmark. *(U3)*
- **Net-of-correction capture time** for a confirmed CO vs. typing. *(U5)*
- **Field-extraction accuracy** (voice → structured CO fields) in our exact setting. *(U4)*
- **Whether richer records produce business outcomes** (fewer disputes, faster/more approvals, more captured revenue) — not just more words.
- **Contractor adoption & willingness to pay** — homeowner research validates only the approval side. *(U6 partial)*
- **Legal/contractual weight** of a digital in-app approval vs. a formally executed CO — varies by contract; product must be defensible even where it isn't dispositive.
- **Two-party recording consent** (all-party-consent states) + **lawful retention/erasure** of voice/biometric data — the "dispute-proof" audio can be inadmissible or illegal without consent; "forever" retention collides with CCPA/GDPR. *(Critic C4.)*
- **Identity vs. friction** on the approval link — an anonymous one-tap link isn't dispute-proof; what's the minimum identity signal (SMS OTP / typed name) that doesn't collapse the approval rate? *(Critic H2.)*
- **On-site producibility (U7)** — can the priced CO be produced + sent under weak/no signal (on-device extraction) or only on reconnect? Decides whether "approve before work, on the roof" is real.
- **Scope-translation fidelity (U8)** — does the translated scope the homeowner approves preserve the source meaning? *(Critic H5.)*
- **Project-resolution accuracy** — mis-attach rate and % auto-resolved in real basements/multi-unit/no-address sites (GPS is poor indoors). *(Critic M6.)*
- **Backend fit** — ~~Supabase+PowerSync (or Firebase)~~ **RESOLVED 2026-07-15: Supabase (raw Postgres) + a simple owned queue for P1** (SQLite on device). What remains unproven until the foundation spike: that the owned-queue three-layer durability (journal → upload queue → processing queue) survives kill/airplane/disk-pressure with zero loss on a real device (Spike A exit gate), and that Supabase Storage-or-R2 media round-trips with native background upload. Multi-device relational sync (the PowerSync question) is deferred, not on the P1 critical path.
- **Gold-set cost** — assembling + bilingually annotating ground-truth CO utterances is a real data project, not a free input. *(Critic C5.)*

### Unknown-unknowns (we can't name them yet — how we'll surface them)
- Reserve them, don't pretend they don't exist. Surface via: (a) the **field/proxy test** with real gloved crews in real noise — the setting no study covers; (b) the **cross-model Codex critic** finding failure modes we didn't; (c) a standing "what surprised us this week" note during the build; (d) putting the thinnest possible slice in a real hand early. Every genuine surprise gets logged here and, if it recurs, promoted to a known-unknown with a metric.

---

## §4 — Cross-model review (Codex)

*Log each adversarial cross-model pass here: date, what was reviewed, findings ranked by severity, and how each was reconciled. Until the real Codex CLI has been run locally (see CLAUDE.md §4), entries here from the cloud session are **same-model stand-in** reviews and are labeled as such.*

**2026-07-17 — REAL Codex cross-check (codex-cli 0.144.4, local) of `PRD-companycam-parity.md`.** First genuine cross-model pass (not a stand-in). Full output saved to scratchpad `codex-prd-review.md`. 4 Critical, ~9 High, ~8 Medium, ~3 Low. The PRD was materially over-certified; findings accepted and reconciled as below.

- **CRIT — wrong price-read-back citation + weak confirm gate (accepted, FIXED).** `REQ-VAL6` is scope/assignment, not price read-back; and `numbers_confirmed_at set` is a DB condition, not proof a human read the number back. Fixed §5.E to cite mandate #6 + the read-back flow, and to require an explicit human read-back/correct action before commit AND send, with a negative test that an unconfirmed path is impossible (mandate #2).
- **CRIT — immutability asserted without the erasure carve-out (accepted, FIXED).** Mandate #5 requires the hard-delete + hash/metadata-stub exception stated wherever "immutable" appears. Added the carve-out to §6 and the GAL3/comments/status-history claims.
- **CRIT — video "playback" contradicts REQ-TL4 (accepted, FIXED).** TL4 discards raw video after extracting audio + stills, so no playable video exists. GAL1/GAL2 now show extracted stills for video, not playback.
- **CRIT — reversal not authoritative (accepted, FIXED).** 4-state lifecycle is the target; 2-state is a *collapse* of it (not a competing schema). Clarified in §5.B + PM-LAYER note.
- **CRIT/HIGH — sync-split asserted as settled (accepted, FIXED).** CLAUDE §5 still flags the outbox/PowerSync split as needing sign-off and SPEC still reads "PowerSync deferred." PRD §6 no longer treats the split as ground truth; it inherits the open sign-off as an explicit open decision.
- **HIGH — `REQ-VAL(1–8)` pseudo-ID + `REQ-ORG1`/`REQ-ROLE1`/`REQ-COLLAB3` mis-elevations (accepted, FIXED).** Bundled/incorrect IDs destroy traceability. Split into specific REQs; reframed Company entity + role-model as **NEW** (net-new tenant/authz model, not "elevation"), with client marked no-login (not a Member seat); fixed the comments trace to COLLAB-2.
- **HIGH — §8 falsely claimed the 8 criteria PASS (accepted, FIXED — the important one).** This is the project's recurring defect (claims > evidence). §8 rewritten from "passes" to "must pass — current gaps named," incl. the missing end-to-end capture→confirm→send touch budget (crit 3 / REQ-X1 ≤3), incomplete failure modes (crit 7), and solo-buildability decomposition (crit 6).
- **HIGH/MEDIUM — missing failure modes + offline/prefetch/security contracts (accepted, DEFERRED to build-spec).** Notifications, collaboration, public share-links, static-map, auth-transition, offline gallery working-set, `labels[]` conflict semantics, Feed event sources. Reconciled: these are per-REQ **build-spec** obligations; PRD now states each REQ needs a build spec (with a failure matrix) before it is "dev-ready," and lists them as known gaps rather than claiming coverage.
- **DESIGN DECISIONS — hadar resolved 4 of 5 as over-modelled (2026-07-17), leaving 1 open (PRD §11):** (1✅) **ownership = the creator**, who can always delete their own content, EXCEPT an approved request is frozen (mandate #1); projects archive-not-delete when non-empty, delete when empty — no capturing/host/controller tangle. (4✅) **erasure ends access; revoke kills the link** — no share-link expiry/rotation machinery. (5✅) **offline = not in the global system yet** — grid shows synced+local, no prefetch/working-set obligation. (3◑) role model settled; server-as-tenancy-authority is a build-spec detail. (2⛔ **OPEN**) the outbox-vs-PowerSync split is a real doc contradiction (`CLAUDE.md §5` unsigned vs `SPEC §0/§6.1` "PowerSync deferred") and needs a one-line ruling + a reconciliation edit. Encoded in PRD §6 "Content ownership & lifecycle" + the REQs; §11 tracks the one open item.
- **LOW (accepted, FIXED):** dangling "GAL6" ref in §8; "MASTER §9" nonexistent; mandate #7 mis-cite on AUTH1.

**2026-07-15 — Stand-in adversarial critic (same-model, NOT the real Codex cross-check).** Reviewed CLAUDE.md + SPEC v0.1 + VERIFICATION_PLAN + NOTES. 5 Critical, 8 High, 6 Medium, 3 Low findings. Reconciled into SPEC v0.2/v0.3:

- **C1/C2 (accepted)** — sequencing was inverted; the plan built the known-solvable native capture first and deferred the product-killers. Restructured to **Phase 0 laptop spikes (U4/U5/U3/U6/U8) before any app code**, plus a Phase 1 foundation spike for the minimal stack/backend decision.
- **C3 (accepted)** — "numbers 100% after confirmation" is a tautology. Replaced with pre-confirmation error rate + **confirmation-catch rate**.
- **C4 (accepted)** — added recording-**consent** (REQ-C8) + lawful **retention/erasure** (REQ-L3); dropped "forever".
- **C5 (accepted)** — added an explicit **gold-set** milestone with bilingual annotation.
- **H1 (accepted)** — extraction location (on-device vs cloud) made explicit as U7.
- **H2 (accepted)** — defined an **identity signal** on the approval link; effect on act-rate measured (U6).
- **H3 (accepted)** — added an **end-to-end touch budget** (REQ-X1); extended the hands-free criterion to confirm/approval.
- **H4 (accepted for AI de-risk; overridden for capture by the user)** — AI structuring de-risks on voice/text; the user then required all 4 modalities to capture offline, so **capture is multimodal**, video included (also the hardest durability case).
- **H5 (accepted)** — gated **scope-translation fidelity** (U8).
- **H6 (accepted)** — U1 reframed as **fault-injection** across specific modes + honest residual bound.
- **H7 (accepted)** — defined the scope-text metric (blind rubric).
- **H8 (accepted)** — U6 needs a **stated homeowner sample size**, not n=1.
- **M1–M6, L1–L3 (accepted)** — U5 downgraded from "known"; language-detection threshold added; cross-model critic moved to **before M0**; proxy may kill but not validate; device-loss added; GPS resolution made measurable; "dispute-proof" replaced by a concrete field list.

**Still owed:** the *real* cross-model check — run the Codex command in `CLAUDE.md §4` locally against the current suite and log findings here. Until then these entries are same-model stand-ins.

**2026-07-15 — Adversarial critic #01 (full suite, same-model stand-in).** Ran over the current suite after ~13 layers. 3 Critical, 8 High, 8 Medium, 4 Low → full findings + reconciliation status in **`CRITIC-REVIEW-01.md`**. Applied this turn: C1/M4 (frozen `shown_content` = binding artifact; English demoted to index), H5 (offline-dup → surface-for-merge, not "no dup"), H6 (CLAUDE repointed to `SPEC-capture-core-v1.md`), M5 (tamper-evident → device-attested/server-corroborated), M6 (ProjectParty.role→trade), M7 (deleted `Project.target_language`). **hadar decisions 2026-07-15:** **H1 → keep P1 as is** (broad first slice, conscious tradeoff; "thin slice" relaxed; U1 still ships first; AI risk now partially in P1 per H3 — spike early). **C2 → signature = SMS OTP + typed legal name + timestamp + `shown_content` hash**; the light confirm stays no-identity. **C3 + H4 → crypto-shred + hash/metadata stub** on erasure (the one immutability carve-out); collaborator content **licensed to host**, controller = capturing org. **H8 → applied** (classifications system-inferred + single confirm; "succeeds without training" gate).
**Still open:** H2 (pull a minimal SMS/email delivery channel into P1 for the validation loop, or move counterparty-confirm to P1.5), M8 (mini-CO sender-side number read-back), M2/M3 (add metrics for scope-gap detection + project-detection accuracy), L1/L2/L3 (touch budget, mark provisional decisions, label target-hypotheses).

---

**2026-07-16 — CODEX CROSS-MODEL REVIEW #6 (PRE-CODE, real Codex — `CRITIC-REVIEW-06-CODEX.md`).** gpt-5.6-sol @ high, run by hadar locally; reviewed the LOCKED DB (ADR-2) + runtime (ADR-5) + owned-queue durability design + Spike A plan. **Verdict: the design is NOT ready to build — it can pass a green Spike A while still losing real captures.** 8 Critical, 12 High, 4 Medium. **The central, correct finding:** the plan treats four distinct durability events — journal commit, media-file commit, queue insertion, server receipt — as one atomic "local save"; no cross-resource commit protocol is specified, so "saved ✓" can fire before the capture is recoverably committed (C1) — the exact ezQuotePro silent-loss failure behind a fancier queue. **This is a high-quality review; near-total ADOPT.** Reconciliation:

- **C1 ADOPT (central fix).** "Saved ✓" fires in A1.3 (journal marked complete) before the queue exists (A2.1) and before media fsync/DB-row/queue-row commit. → Define a **capture-commit state machine**: STARTED → media chunks (seq+hash) → finalize+fsync(file+dir) → verify decodable → one SQLite txn creates Capture+Attachment+outbound-mutation and advances to MEDIA_COMMITTED → *only then* "saved ✓". FS and SQLite can't share a txn → idempotent recovery state machine + durable sidecar manifest; no boolean `complete`.
- **C2 ADOPT (reframes a mandate — hadar decision flagged).** An absolute "never lose a capture" is impossible under the stated single-device fault model (DB corruption / key loss = journal+queue in one failure domain; storage-full contradicts "never block"). → Replace the absolute with the **defensible invariant**: *"Never acknowledge a capture unless a verified recoverable copy + durable recovery intent exist; refuse to start loudly when capacity can't be reserved,"* + explicitly stated residual-loss boundaries (total device loss, app-data deletion, key loss, correlated FS destruction). **Changes CLAUDE mandate #1 wording — makes it honest, not weaker.**
- **C3 ADOPT.** SQLCipher protects the DB, not the media files; A0.3 tests only the DB; "key never in JS" is incompatible with expo-sqlite's `PRAGMA key`; SQLCipher needs a prebuild (not in Expo Go); locked-device background reads may fail. → Pick + spike ONE explicit end-to-end media-encryption scheme (native per-capture-key streaming, ciphertext uploaded unchanged, server unwraps without plaintext staging, key usable for approved locked-device background), **or** revise REQ-CAP4 to admit media relies on OS file protection only. Blocks the op-sqlite-vs-expo-sqlite call.
- **C4 ADOPT.** "An idempotency key" is under-specified. → Stable mutation IDs at local commit, scoped to tenant/device/immutable-mutation; receipt + domain write in ONE Postgres txn; immutable deterministic object keys (never overwrite media); server finalize verifies object size/checksum before linking; crash tests before/after commit and before response.
- **C5 ADOPT.** The pull is not a sync protocol (no server sequence, checkpoint, tombstones, base/overlay, cursor; pagination across concurrent edits misses/dupes; can clobber unsynced local writes). → Specify server-assigned monotonic change sequence, high-watermark checkpoint, keyset pagination, tombstones (delete/merge/revoke/window-exit), base-state vs pending-overlay, per-row versions. Never use client time as ordering authority. **This is the strongest evidence the "owned queue is simple" claim was optimistic → see H1 / ADR-2 reopening.**
- **C6 ADOPT (SPEC fix).** "Raw video is never stored" contradicts REQ-CAP6 mid-video recovery + REQ-TL4. → Reword to *"never retained or uploaded after successful extraction"*; allow an encrypted, journaled temp raw-video asset until derived assets are finalized+verified+registered, then recoverable cleanup. (Video is out of Spike A scope, but fix the spec contradiction.)
- **C7 ADOPT (strengthens our own MF-2).** "One predicate" as shared TS middleware is fictitious — TS ≠ RLS; bypassable via direct PostgREST, Storage/TUS PUTs, pre-middleware routes, other Edge entrypoints, Next endpoints, job callbacks, R2 reads, service-role code, post-revocation presigns; top-level org_id check misses nested project/capture/attachment/object-key tenancy. → **Action/resource authz model**, canonical authz **in Postgres functions** (RLS + service-role call the same DB functions), generated policy matrix + negative contract tests per transport. Middleware = convenience layer, not root of trust.
- **C8 ADOPT.** Edge→durable-job handoff is a dual-write loss window (commit then die before job start = permanently unprocessed). → **Transactional outbox** in the same txn that finalizes the attachment + durable dispatcher (leases/retries) + `(capture_id, content_version)` idempotency + orphan sweeper.
- **H1 ADOPT-with-decision (ADR-2 REOPENED — hadar call).** Deferring PowerSync rested on a false dichotomy: the ezQuotePro lesson proves *record-locally-before-network*, NOT that a solo dev should hand-build relational two-way sync (oplog ordering, checkpointed pulls, overlays, tombstones, scheduling — exactly C5/H2). Codex's hybrid: **own the native capture journal + media-finalization txn; then either (a) adopt PowerSync for relational sync, or (b) restrict P1 sync to append-only immutable capture receipts** (no generic two-way merge). *(Also flags the "PowerSync Attachments is experimental" rationale may be stale — VERIFY against current docs.)* **→ hadar decision: the owned-queue lock (ADR-2) is premature; pick a direction.** My lean: EZjobsite captures are largely append-only immutable evidence, so **(b) append-only P1 sync** dissolves most of C5's complexity elegantly — but a short PowerSync bakeoff is the low-regret way to be sure.
- **H2–H11 ADOPT.** H2 queue worker leases/backoff/dead-letter (concurrency+retry-storm). H3 SQLCipher key-loss → hard recovery state, never init over an existing DB (else silent data deletion). H4 DB-corruption recovery via authenticated sidecar manifest + content-addressable asset names + startup integrity checks. H5 Edge Functions OK only with small bounded restartable sync (256MB/2s-CPU/150–400s limits) — **and concede the "Hono → Node with no rewrite" claim is overstated** (routing is portable; Deno/Supabase bindings + deploy + background semantics are not) → soften ADR-5. H6 lock the P1 **storage provider** before the gate (Supabase-TUS vs R2-S3-multipart are not a `put()` swap) or run the suite against both. H7 bind every DB/key/queue-entry/mutation to immutable account+tenant identity (logout/user-switch/revocation can leak or strand queued captures). H8 never semantically dedup immutable captures; project-merge is a separate confirmed/tombstoned flow. H9 the gate can certify a broken design (release builds + production entrypoints + strict oracle + crash hooks — the ezQuotePro trap). H10 **predeclare a real statistical target per fault/platform** (0/50 ≈ <6% is catastrophic; ~30k zero-failure trials for <1e-4 @95% → needs automated failpoint volume, not just physical device). H11 add the missing fault classes (lost-response-after-commit, object/row split, URL/token expiry, wifi→cell w/ consent off, captive portal, HTTP error codes, two drainers, migration kill, old-client/new-schema, key loss/wrong key, clock skew, mic interruption, etc.).
- **H12 ADOPT (sequencing + contradictions).** Write the protocols/state-machines BEFORE schema. Concrete contradictions fixed this turn: **ADR-4-vs-ADR-5 naming** (runtime = ADR-5; the notes entry mis-titled it ADR-4 — corrected), **REQ-PROC1 vs REQ-TL4** (video keyframe extraction is on-device per TL4; PROC1 corrected), **REQ-PM-D PowerSync-backed feed** (→ local-synced feed), **op-sqlite vs expo-sqlite** (engine SQLite locked; library undecided and gated by the C3 encryption decision), **queue-locked vs settle-by-spike** (ADR-2 reopened per H1, resolving the contradiction).
- **M1–M4 ADOPT.** M1 A0.3 must scan WAL/temp/sidecars/backups for plaintext + wrong-key open + tamper + key-delete + release-build both platforms. M2 gate performance (start latency, write throughput, dropped frames, battery, finalize time) on low-end Android. M3 delete local media only after verified immutable object receipt + server linkage (two-phase GC, min-free-space). M4 status honesty: "Saved on this phone — not backed up yet" → "Backed up"; no fake `ready` via a no-op processing state.

**NET:** Spike A becomes **design-first** — the 9 pre-code artifacts (commit state machine · push/pull protocol · mutation/object identity · media-encryption+key-lifecycle · authz matrix · transactional outbox · locked storage provider · failpoint matrix + statistical target · PowerSync-vs-append-only bakeoff) are written and reviewed BEFORE A0.2 schema. **hadar decisions owed:** (1) ADR-2 direction — PowerSync bakeoff vs append-only-P1-sync vs keep-and-build-full-owned-protocol; (2) accept the C2 "never lose" → defensible-invariant reframe (mandate #1). | hadar ran Codex #6; reconciliation by Claude. | hadar (2 decisions) |

---

**2026-07-16 — CODEX CROSS-MODEL REVIEW #7 (PRE-CODE, real Codex — `CRITIC-REVIEW-07-CODEX.md`).** gpt-5.6-sol @ high, reasoning effort high, 145,922 tokens, sandbox read-only. Reviewed **`DURABILITY-DESIGN-v1.md`** (the 9 artifacts written to fix #6) against #6's findings + ARCHITECTURE/SPEC/NOTES/SPIKE-A. This was the design-gate check required before A0.2 schema code.

**VERDICT: NOT BUILDABLE YET — 2 of 20 findings actually closed (C2, H1).** C1/C3/C4/C5/C6/C7/C8 all remain OPEN or partial; H2–H12 mostly partial. Codex: *"Several '✅ COMPLETE' artifacts are protocol sketches, not crash-safe specifications."* **The "✅ COMPLETE" labels were false and have been corrected to "⚠️ DRAFT" (artifacts 1–6, 8); 7 and 9 are decision records and are relabelled as such.**

**The root cause of most #7 findings is a PROCESS failure, not a design failure.** Review #6's reconciliation (the entry above) logged **ADOPT on all of C1–C8 and H1–H12** — but the only artifact produced was `DURABILITY-DESIGN-v1.md`. **`ARCHITECTURE.md` and `SPEC-capture-core-v1.md` were never edited**, so they still asserted the *pre-#6* design. Codex #7 then correctly re-found all of it as "cross-document contradictions." **Adopting in the ledger is not applying to the docs.** The ☑-only-when-the-edit-exists rule existed and was not honoured. *(Confirmed concretely: C6 was logged "ADOPT (SPEC fix)" on 2026-07-15 — the SPEC edit never happened, so #7 re-raised C6 verbatim.)*

**✅ CLOSED BY THE DOC-DRIFT CLEANUP (this pass, 2026-07-16).** These were *already-made decisions* that had never reached the docs. Edits verified present:
- **C6 video wording** — `ARCHITECTURE §3.1`, `SPEC REQ-TL4`, `SPEC MediaAsset` (+ `PRICING-STRATEGY`) now read **"never retained or uploaded after successful extraction"**; the raw video is an **encrypted, journaled temporary asset** (`MediaAsset.kind = raw_video_temp`) retained until the derived audio+stills are finalized/verified/registered, then deleted via recoverable cleanup. The old "never stored" made REQ-CAP6 mid-video recovery impossible.
- **DECISION 7 storage** — `ARCHITECTURE` §2 diagram, §3.3, §3.4, stack table, §11 open-questions (was still "*still open — decide in Spike A*"), and `SPIKE-A` §0.5#7 + stack table now make **Supabase Storage the P1 primary, R2 the P1.5 optimization**. The "isolated swap" claim is corrected per H6.
- **DECISION 4 encryption** — `ARCHITECTURE §3.3` rewritten to **Option B**: client generates the per-capture DEK, encrypts client-side, uploads **ciphertext unchanged**; DEK wrapped for device + server ingest identity; server unwraps with no persistent plaintext staging. Removed *"plaintext quarantine → server encrypts at arrival"* and ***"the client never holds DEKs"*** — both directly contradicted the locked decision. **MF-1 reconciled** (§11).
- **C7 authz** — `ARCHITECTURE §3.2` rewritten: canonical `can_read`/`can_append`/`can_approve` **in Postgres functions**; RLS *and* service-role both call them; **Hono middleware is a convenience layer, not the root of trust**; PostgREST not publicly exposed; whole-chain (not top-level `org_id`) validation; policy matrix + negative tests. **MF-2 reconciled** (§11).
- **Save confirmation** — `ARCHITECTURE §3.1` + §8 walkthrough A + `SPEC REQ-CAP5` now gate "saved ✓" on **`MEDIA_COMMITTED`** (media finalized+fsync'd+**verified** AND the local txn committed), not on the raw local write. **`SPEC REQ-CAP8` boolean `complete` removed** — the journal is a state machine + sidecar manifest (Codex #7 flagged "marked complete" as surviving the #6 ban).
- **Server-side ffmpeg** — `ARCHITECTURE` §1 table + §2 pipeline diagram still showed server-side video extraction, contradicting §3.4 step 6 (on-device per REQ-TL4). Corrected.
- **Heredoc bug** — `CODEX-REVIEW-06/07-PROMPT.md` both had `codex exec … | tee file <<'PROMPT'`, where **the heredoc binds to `tee`, not `codex`** (the model would receive an *empty prompt*), plus `2>&1` polluting the review file with progress logs. Both restructured to write-prompt-to-file → pass to codex → tee only stdout. *(Review #7 was run with the corrected form.)*

**⛔ STILL OPEN — genuine protocol design. NOT attempted in this pass. Gated behind a pending hadar decision on the ADR-2 / PowerSync-bakeoff direction, because the sync direction determines what must be designed.** Flagged inline in `DURABILITY-DESIGN-v1.md` at the exact claims so nobody builds them:
1. **The `seq` pull is NOT commit-ordered → a capture can be silently lost forever.** §2.3 claims concurrent inserts always get a *higher* seq than the cursor. **This is false** — Postgres sequence allocation is not commit-ordered. Txn A takes 10 and stalls; B takes 11 and commits; device pulls 11 and checkpoints; A commits 10; `seq > 11` **never returns it**. **Codex's pick for the single most likely field failure.** Also open: `since=<seq>` vs `(seq,id)` page-boundary skips; apply-rows + advance-checkpoint not one txn; no response high-watermark; pull-side parent ordering; a revoked user may be unauthorized to pull the tombstone meant to purge them; time-based window exit has no DB mutation so re-entry never resends. **C5 fully open.**
2. **`MEDIA_COMMITTED` is not atomic across filesystem + SQLite.** §1.1 says they can't share a txn; §1.3 step 6 recombines them anyway. Two unhandled crash states (SQLite-commits-then-manifest-fails → rows exist but state reads `VERIFIED`; manifest-first-then-SQLite-rolls-back → **phantom "saved" with no rows**), and §1.4's recovery table has **no row for either**. Also: no temp→fsync→rename→dir-fsync protocol for manifest generations; manifest described as both content-addressed *and* append-only (incompatible unless versioned); no paired durability order for chunk data vs chunk log; finalized temp file never atomically renamed to its content-addressed path; "disk-space lease" reserves no blocks (ENOSPC can still hit the manifest/rename). **C1 open (partial).**
3. **L5 "sync is append-only" is FALSE for the actual model.** Append-only holds for **evidence** (media, capture receipts, record versions, approvals) but **not** for operational state, which SPEC §8 makes mutable: `Capture.processing_state`/`remote_uri`/`resolution_status` · `Decision.current_value` · `Notification.read_state` · `Project.status` · `ProcessingJob.state` · `content_version` · translation cache · grant/revocation · usage counters. **L5 is the premise Artifact 2 rests on**, so §2.6's "what append-only let us delete" (oplog merge, LWW, vector clocks, base/overlay, edit-conflict resolution) is **banked against a property the model doesn't have**. Codex: *"C5 has merely been moved behind an invalid premise."* §2.5's project-merge is self-contradictory for the same reason (it "appends an alias, never edits" while *transactionally repointing children* — and repointing an approved record changes its context, violating L4). **Resolution options (a decision, not a fix): (a) scope append-only to an immutable evidence ledger + a separate versioned change log for mutable operational state, or (b) event-source/version every synchronized entity.**
4. **Key lifecycle depth (C3 open).** Option B is *selected*, not *designed*: AEAD algorithm/nonce uniqueness/chunk authentication + anti-reordering binding; where device- and server-wrapped DEKs live so a corrupted SQLite can rebuild from sidecars; ingest-key versioning/rotation/old-client compat; interrupt-safe master-key + SQLCipher rekey; file-protection class for the *ciphertext* (`AfterFirstUnlock` on the key doesn't make the media file readable); plaintext handling by recorder/extraction/STT/logs/crash dumps/job scratch; restore + device-transfer auth. **Crypto-shred is incomplete** — destroying the media DEK does not erase transcripts, translations, thumbnails, exports, AI-provider copies, device caches, or DB backups.
5. **Integrity chain has no trust anchor (C4/identity).** The sidecar's authentication format is still an *open sub-decision* (§1.6) though Artifact 3 was marked complete. Hashes alone bind neither tenant/project/capture/asset IDs, ordered chunk metadata, wrapped DEKs+crypto version, record/version identity, nor approval scope — so an approval artifact could be transplanted off the evidence it freezes. UUIDv7 is **random, not deterministic**; the receipt is keyed only by mutation ID with no tenant/device scope or request digest → replaying one ID with different content can **silently suppress a new capture**; DB rebuild can mint a second mutation ID; re-encrypting the same plaintext yields different ciphertext → a different object key (dedup-by-hash doesn't hold).
6. **Enforceable database API (C7 residual).** "Service-role must call `can_*`" is a **convention**, not enforcement — one new path can forget it. Codex's fix: canonical **mutation functions** as the only write path, with **raw table DML revoked** from application roles; plus tenant-qualified composite FKs, server-derived (never caller-supplied) actor, and closing the check-then-write race.
7. **Outbox + client queue (C8/H2 residual).** The outbox needs a *mandatory* DB transition (trigger or sole finalize function) + lease token/expiry/CAS ack; `(capture_id, content_version)` is insufficient across event kinds/pipeline versions. Object-verify → row-link remains a cross-system dual write (the sweeper's existence proves orphans are possible). **Client-side** drainers are entirely unspecified: leases, fencing epochs, dependency scheduling, backoff, `Retry-After`, retry ceilings, dead-letter.
8. **Failpoint granularity + targets (H9/H10/H11 residual).** "After every state transition" misses the dangerous **intra**-transition boundaries (chunk write/log ordering, manifest temp/rename/fsync, media rename, SQLite-commit↔manifest-promotion, seq allocation↔commit, pull apply↔checkpoint, DEK wrap persistence, object verify↔link, outbox claim↔ack). Only core capture has a number (`<1e-4 @95%`); sync says "declared N"; physical-device says "hundreds"; recovery has no quantitative criterion. SPEC REQ-PROC4 wants 100 offline/online cycles while Spike A centers one round trip.

**Remaining doc contradictions NOT fixed here (they depend on the pending sync decision):** Spike A A2.2–A2.3 "dedups and upserts" / "server truth reconciles local rows" vs append-only inserts · Spike A's "never show fake `ready`" vs its own no-op processing→ready transition · outbox in the exit gate while jobs are out of scope · every-transport-path in the exit gate while full authz is out of scope · Spike A saying ADR-2 is reopened while DURABILITY/ARCHITECTURE say resolved. **Left deliberately** — resolving them presupposes the ADR-2 direction.

**NET:** the doc set now tells one story about the **decisions already made**; it still has **no crash-safe protocol** for the three blockers. **A `DURABILITY-DESIGN-v2` is required before A0.2 — do not start schema code.** **hadar decision owed (blocking v2): the ADR-2 direction** — PowerSync bakeoff vs. append-only-P1-sync (which now needs the L5 evidence-vs-operational split designed) vs. full owned relational protocol. Codex #7's L5 finding materially weakens the "append-only makes it simple" rationale that closed H1, so this is worth re-deciding, not assuming. | Codex #7 run + reconciliation + doc-drift cleanup by Claude. | **hadar (1 decision: ADR-2 direction)** |

> ## ⛔ ARTIFACT 1 v3 — the "all 12 addressed" claim below is **FALSE**. Only **2 of 12** are fixed. (Codex #12)
>
> **`CRITIC-REVIEW-12-CODEX.md`: *"Only 2 of the 12 findings are genuinely fixed in the document: H5 and H8, both narrowly. The other ten remain open or are merely relabelled: H1, C2, C3, C4, H6, H7, H9, H10, H11, H12."*** Crash-safe specification: **NO**. Blocker 2 closed: **NO**. Safe to begin A0.2: **NO**.
>
> **Codex judged the author's *gate verdict* CORRECT and the author's *"all 12 addressed"* claim FALSE.** Both at once. The restraint was real; the accounting was not. **Writing a prose paragraph that restates a finding is not fixing it** — that is what eight of these rows did.
>
> **Genuinely fixed (2):** **H5** — `tmp/<id>.part` is now preallocated with real platform primitives (`F_PREALLOCATE`/`fallocate`), *"the actual correction review #11 required"*. **H8** — immutable content-addressed install (freeze writer, rehash through the final descriptor, no-replace).
>
> **Still broken (10):** H1 · C2 · C3 · C4 · H6 · H7 · H9 · H10 · H11 · **H12 (checkbox demonstrably false)**.
>
> **And v3 repeated the pattern a FOURTH time.** #9, #10, #11 and now #12 each caught a claim withdrawn in one place and left standing in another. In v3: §1.3's header still read *"✅ closes blocker 2"* · line 62 still promised recovery from a kill/crash/power-loss at **any** point · row 8 was corrected in the table and then called *"impossible by construction"* five lines below it · **and the withdrawn "the phantom-saved state is unrepresentable" claim was still standing 170 lines after its own retraction.** All four are now removed — by an exhaustive grep, not by spot-fixing the lines I happened to look at, which is what failed the previous three times.
>
> **New CRITICALs from #12** (beyond the #11 set): **SQLite is not yet a valid DECIDE authority** · **PowerSync-managed rows cannot be the exclusive permanent commitment authority** — the transport that syncs the rows can also revert them, so "SQLite alone decides" is not stable while PowerSync owns those tables.
>
> **The table below is retained as written, with its checkboxes now known to be mostly false.** It is the evidence of the failure mode, not a record of work done.
>
> <details><summary>The "all 12 addressed" reconciliation table (checkboxes false — retained for provenance)</summary>
>
> | #11 finding | v3 |
> |---|---|
> | **C2** returned COMMIT not durable | ☑ **§1.0 durability profile**: `synchronous=FULL` · `F_FULLFSYNC` on Apple · explicit checkpoint policy · **pragmas read back and asserted at runtime** (a pragma that silently failed to apply is indistinguishable from data loss) · refuse to arm the recorder if the assertion fails. **⚠️ Cross-connection hazard left OPEN and named** — `synchronous` is per-connection and PowerSync/op-sqlite open their own; we do not yet control what they set. |
> | **C3** `ps_crud` transient, not permanent | ☑ **§1.3c queue lifecycle**: `ps_crud` = pending-transport state only · recovery predicate = *pending `ps_crud` **or** durable server receipt **or** durable dead-letter* · **Capture+Attachment through ONE Postgres RPC, never two requests** · **never discard an evidence mutation to unblock the queue** · the managed-vs-raw-vs-local-only condition on the atomicity property is stated. |
> | **C4** truth table incomplete/unsafe | ☑ **rows 5b/6b added** for hash-mismatch (v2 enumerated *absence* of media, never *corruption* — row 6 would have served corrupt evidence forever; row 5 would have committed it). Row 5 now **re-verifies before committing**. Row 8 marked **factually wrong**. |
> | **H9** identity lost with the DB | ☑ **§1.0b**: `capture_id`/`attachment_id`/`mutation_id` + canonical request digest + full canonical payload minted at **PREPARE** and stored in the terminal manifest, so a rebuild re-runs DECIDE with **the same** identity. Does **not** make the manifest a commitment authority. |
> | **H5** reservation reserved the wrong file | ☑ **Preallocate `tmp/<id>.part` itself** (`F_PREALLOCATE` / `posix_fallocate`), verify allocation not logical length, small non-purgeable metadata reserve incl. **WAL growth**, released only **after durable DECIDE**. |
> | **H6** manifest partially specified | ☑ **§1.3b**: canonical dir · `O_EXCL` no-replace · **single-writer fencing** (forks **quarantine**, never resolved by clock/filename) · "valid" defined (embedded id/generation/predecessor hash) · **retain ≥2 generations**. |
> | **H7** chunk protocol underspecified | ☑ framing magic+version+length · **CRC32 for torn-tail detection AND SHA-256 per exact chunk for integrity** (they are different jobs) · exact-write loop · reread · strict seq/offset continuity · **independent expected sample/frame count** (a truncated file hashes self-consistently). |
> | **H8** rename ≠ immutable install | ☑ **freeze the writer first** · rehash through the final descriptor · **no-replace install** · verify an existing destination byte-for-byte · assert one filesystem · barrier both dirs. |
> | **H10** dropped queue deleted the download design | ☑ **"buys us nothing" retracted.** `RemoteAsset` (synced identity, **no local paths**) / `LocalAsset` (local-only state) split specified. **⚠️ The download/GC/retention path is NAMED AS NOT DESIGNED** — and evidence retrieval on a second device is the product. |
> | **H11** gate language exceeds evidence | ☑ "demonstrated 40/40 / unreachable / dissolved" withdrawn; recorded as **"PowerSync adopted despite an uncleared validation gate."** |
> | **H12** repo gives mutually exclusive instructions | ☑ **`MEDIA_COMMITTED` removed from every manifest requirement**: `SPEC` REQ-CAP5 + REQ-CAP8 + the M0 accept-criterion, `ARCHITECTURE` flow A. **This was the dangerous one — an implementer following the SPEC would have rebuilt v1's co-committer.** |
> | **H1** skeleton ≠ specification | ☑ Adopted as the framing: Artifact 1 is **the protocol skeleton**. |
>
> **Still owed before A0.2 (real, not cosmetic):** the **cross-connection pragma hazard** · the **`RemoteAsset`/`LocalAsset` model + download/GC path** · **Artifact 3** (manifest authentication) · the **backend RPC** that makes Capture+Attachment one server transaction · **`spike/app-src/connector.ts` is live-buggy** (separate requests + discard-to-unblock) and must not be copied into production.
>
> **No Codex pass has reviewed v3.** Given #11 found 3 CRITICALs in v2 — which *also* looked finished — **v3 should be reviewed before A0.2, and I am not labelling it closed until it is.**
>
> </details>
>
> *(That last line was the one thing v3 got right: the review ran, and it found 10 of 12 rows above are false.)*
>
> ---
>
> ## ⛔ RETRACTED (2026-07-16) — THIS GATE IS **NOT** SATISFIED. DO NOT BEGIN A0.2.
>
> **`CRITIC-REVIEW-11-CODEX.md` rejected the Artifact 1 v2 closure: *"Is blocker 2 closed? NO. Is it safe to begin A0.2 schema code? NO."*** The entry below was written before that review and **claimed a closure it had not earned** — the third time this doc set has labelled a sketch complete. All 12 findings adopted, none disputed. **Two independent phantom-saved paths were constructed against the claim that a phantom is "unrepresentable":** (1) a returned SQLite COMMIT is **not durable** under `synchronous=NORMAL` in WAL mode — atomicity ≠ durability, and no pragma/`F_FULLFSYNC`/checkpoint policy is specified anywhere; (2) **`ps_crud` is a transient queue** — `tx.complete()` removes entries (our connector does exactly that), so "rows without `ps_crud`" is the **normal post-upload state**, not impossible, and PowerSync **reverts local rows** when the queue drains after a backend rejection — which our connector permits by sending Capture and Attachment as separate requests and completing anyway.
>
> **What survives:** the PREPARE/DECIDE split is **correct** and does eliminate v1's two half-commit states (Codex: *"Splitting authority is the right architecture"*). **It is the protocol skeleton, not a specification.**
>
> **Minimum still owed before A0.2:** a **durability profile** (`synchronous=FULL` for the capture commit + `F_FULLFSYNC` + a runtime assertion the pragma took effect + what happens if PowerSync/op-sqlite change it on another connection) · a **queue-lifecycle model** with a durable mutation id + server receipt that survives `ps_crud` completion, and **one backend transaction/RPC for Capture+Attachment** (never partial-accept) · a **complete, corruption-aware truth table** (hash mismatch, not just absence) · **real filesystem specs** (reservation, generational manifests, chunk-log append atomicity, immutable content-addressed install) · the **download/GC/archival path** deleted along with the attachment queue.
>
> **Blocker 1 wording corrected:** *"demonstrated 40/40 / the fault is unreachable"* is **withdrawn** — review #10 rejected Q1's VALID PASS. Retiring the `seq`-cursor fault **as an architectural decision** is reasonable (we no longer write that cursor); the honest record is **"PowerSync adopted despite an uncleared validation gate."** **ADR-2 stands** — it does not depend on Artifact 1.
>
> <details><summary>The premature "gate satisfied" entry, retained for provenance</summary>
>
> The decision this gate was blocked on (**the ADR-2 direction**) is **made: ADR-2 → PowerSync**. It closed two of the three blockers outright, and the third is closed by **Artifact 1 v2** written into `DURABILITY-DESIGN-v1.md` (§1.1–§1.4). **The "v2" that was owed is that rewrite, not a new file** — so the `DURABILITY-DESIGN-v2` requirement is **met in place**; do not go looking for a file by that name.
>
> | Blocker | Closed how |
> |---|---|
> | **1 — `seq` pull not commit-ordered** | **Dissolved, transport-owned.** We no longer write a `seq` cursor; PowerSync orders by the Postgres commit log. **The fault is unreachable, not patched.** 40/40 under a deliberate stalled-commit inversion. |
> | **2 — `MEDIA_COMMITTED` not atomic** | **Artifact 1 v2.** Root cause was **two authorities for one fact** — the manifest was made to record commitment, which only SQLite can know. v2 splits the questions; **one commit point** (the SQLite txn, which PowerSync's `ps_crud` joins atomically). The phantom-saved state is now **unrepresentable**; recovery truth table complete at 11 rows incl. the two v1 could not express. |
> | **3 — L5 false for the data model** | **Option (a).** Append-only scoped to the **evidence ledger**, enforced by our rules; mutable operational state syncs via PowerSync (bakeoff Q2). |
>
> **Also resolved:** Q4's "does our commit machine compose with PowerSync's local write model" → **we do not compose.** PowerSync syncs rows; media is ours end-to-end (its attachment queue's only route to upload takes a whole-file `ArrayBuffer` and wants file-then-row; we need verify-then-row, and we are building our own uploader anyway since PowerSync has no resume). **This also drops the alpha attachments dependency.**
>
> **The §207 doc contradictions above are now resolvable** (they presupposed the ADR-2 direction) — Spike A's A2.2–A2.3 "dedups and upserts" and "ADR-2 is reopened" language should be updated when A0.2 starts. **Not blocking.**
>
> **Carried into Spike A, named not hidden:** `REQ-MEMBER-5` revocation undefined (cited 4×, defined 0×) · *"last-N-days"* not expressible server-side in Sync Streams · server-owned writes silently revert with no rejection hook (UX defect to design around) · **whole-file media memory on-device untested**.
>
> **No Codex pass has reviewed Artifact 1 v2.** Given `CRITIC-REVIEW-09/10` caught real defects in far simpler work, that review is **worth running before the recovery sweep is coded** — but it does not block A0.2 schema.
>
> </details>
>
> *That closing line was wrong on both counts: the review **did** block A0.2, and it found **3 CRITICALs** — including two that killed the "phantom is unrepresentable" claim outright. Running it was the right call; shipping schema on the strength of the unreviewed version would not have been.*

---

**2026-07-16 — CODEX CROSS-MODEL REVIEW #8 (NARROW TEST-VALIDITY CHECK — `CRITIC-REVIEW-08-CODEX.md`).** gpt-5.6-sol @ high, 35,103 tokens, sandbox read-only. **Deliberately narrow scope:** can the sync bakeoff (`SPIKE-SYNC-BAKEOFF.md`) **false-pass** — green-light PowerSync without proving it fixes the faults that killed our hand-built design? Not an architecture review; Codex stayed in scope and raised **no** new architecture findings.

**VERDICT: all seven questions (Q1–Q7) could FALSE-PASS as written.** The bakeoff identifies the **right faults**; its **pass criteria were not operationally strict enough**. Every fix is a tightening of steps + assertions — **no redesign**, and no question's intent changed. **Tightenings APPLIED to `SPIKE-SYNC-BAKEOFF.md` this pass** (inlined per question, plus the header banner, the build list, Go/No-Go, and the verification protocol).

**Q1 (commit-ordering) — the load-bearing one.** "Two concurrent writes where the lower-numbered txn commits after the higher one" **does not guarantee the device completed a durable checkpoint containing B before A committed** — which is the entire fault. Applied:
- **The negative control** (noted as required): the test table keeps a **`seq bigint DEFAULT nextval(…)`** column so the seq-inversion our design died on is **demonstrably reproduced** — otherwise Q1 tests a fault that is structurally absent. **PowerSync orders by commit-log/LSN and has no `nextval()` cursor to invert, so it is expected to pass by construction** — which makes a bare green Q1 nearly information-free. *(Claude's independent read, consistent with Codex's procedure.)*
- **Forcing mechanism:** control session holds advisory lock `K`; txn A inserts (`seq=10`) then blocks on **async** `pg_advisory_xact_lock(K)` before COMMIT; assert via **`pg_stat_activity`** that A is open; B inserts (`seq=11`) and commits; **a third connection asserts** B visible / A not; the device must reach a **completed durable download checkpoint containing B** (*not* "sync started"), surviving an **app restart without clearing its DB**; only then release `K`; assert A's commit came **after** the device observation.
- **The central trap: a fresh second client CANNOT substitute for the original checkpointed device** — a from-scratch resync receives both rows trivially and proves nothing. A fresh client is a **control** for sync-rule eligibility only. No reset/resnapshot/reinstall/DB-clear on the device under test.
- **Two legitimate passes that must NEVER be conflated:** **(a) "late row delivered"** vs **(b) "unsafe checkpoint prevented"** (PowerSync refuses to advance the checkpoint while A is open — also safe, but a different mechanism with different consequences under sustained long transactions: a stalled writer could stall sync). **The result must name which.** Predeclared trial count; every late A must arrive.

**Q3 (encrypted media).** Bare "decrypt succeeded" can conceal **three distinct failures**: a **harness-supplied DEK** (the production unwrap path never ran), a **plaintext staging file**, or a **full restart mislabeled as a resume**. Applied oracle: no plaintext fixture file · production capture-encryption path + real `RemoteStorageAdapter` (no test-only copy) · identical ciphertext hash/length across adapter body → Supabase object → Device 2 download · byte-identical decrypted plaintext + audio decode/sample count · **Device 2 starts WITHOUT the plaintext DEK** and uses the production unwrap path (**a harness-supplied DEK invalidates the test**); wrong key / modified wrapped-key metadata must **fail authentication** · corrupted ciphertext-or-metadata must **fail**, not yield unchecked output · **plaintext-canary scans** across app files/caches/temp/SQLite/logs/crash artifacts (only in-memory recording buffers may hold plaintext) · offline ⇒ **no remote object exists** · **real resume**: multi-request TUS object, **externally `SIGKILL`** at a **server-confirmed `0 < offset < total`** (not graceful cancel), cold **release-build** relaunch resumes **from the prior nonzero offset**, request logs prove **continuation not restart-at-zero** · exactly **one** finalized object + linkage, no orphan sessions · **real iOS + Android**.

**Q2 / Q4–Q7 (all tightened).** Q2: sequential edits prove only happy-path propagation → **predeclare field ownership + convergence rule** *before* running, hold an **unsynced offline edit against a conflicting server edit**, assert exact final values on both devices + Postgres, **pending local edit preserved**, no unauthorized client write to server-owned fields. Q4: *"sits cleanly above" is subjective* → kills at **verify/write/commit** boundaries; no row before verified media; no "saved" before the complete local commit; no saved capture lacking outbound intent. Q5: one foreground upload is insufficient → **release-build matrix on physical iOS+Android** (max file sizes, background/locked, OS termination, retries, URL expiry) with **acceptable failure/recovery declared in advance**. Q6: *"fits our scale" has no oracle* → **fix workload + required features first**, then compare Cloud vs self-host on all-in cost, licensing, HA/backup/monitoring, upgrades, operator time. Q7: active-row inclusion proves neither windowing nor revocation → test **active→archived→window-exit→re-entry** and **revocation while offline**; assert purge, blocked queued writes, no regained access. *(Q7 echoes a #7 finding: a revoked client may be unauthorized to pull the very tombstone meant to purge it.)*

**Also fixed this pass — the `2>&1 | tee` bug in the Codex prompt templates.** `2>&1` merges Codex's stderr progress/tool logs **into the saved review file**, polluting the artifact with run noise. **`CODEX-REVIEW-08-PROMPT.md` corrected** to `2> /tmp/codex-08-run.log | tee …`. **`#6`/`#7` already carried this fix** from the 2026-07-16 doc-drift commit (where they also had the worse heredoc-binds-to-`tee` bug, which would have sent the model an **empty prompt**). All three templates are now correct. *(The #8 run itself used the corrected form.)*

**NET:** the bakeoff is now **falsifiable** — a pass requires named assertions, and a pass recorded without them is **an untested question, not a pass**. **Standing rule added to the bakeoff: record the EVIDENCE, not the verdict** ("Q1 ✅" with no assertion trail is precisely the false-pass this review exists to prevent, and the conclusion-stage Codex pass will correctly reject it). This is the **ezQuotePro "ALL TESTS PASSED" trap one layer up** — a green bakeoff green-lighting a rewrite on evidence that never existed. **No architecture decision was touched; ADR-2 remains open pending the bakeoff result.** | Codex #8 run + tightenings applied by Claude. | — (no decision owed; next gate = run the bakeoff, then a Codex pass on its conclusion before flipping ADR-2) |

---

## §5 — The build session, 2026-07-16/17 (61 commits): what actually bit

*Written because CLAUDE.md §3 says this file is the project's memory of WHY, and I
went 61 commits without touching it. Everything below was found by running the
thing, not by reading it — and every one of them looked like success until it was
measured.*

### §5.1 The silent-failure family (the expensive one)

Every bug that cost real time this session had the same shape: **the app said it
worked, and it had not.** None threw. None appeared in a log. Each was found only
by checking a claim against reality.

| What | How it presented | What it actually was | How it was found |
|---|---|---|---|
| **PowerSync upload dead all session** | `connected: true`, queue clean, "saved ✓" | Client sent `created_at_ms`; Postgres had only `created_at`. PostgREST → PGRST204 → not a SQLSTATE → fell past the connector's fatal-code check → threw → `tx.complete()` never ran → **queue wedged at 25 and climbing**. | I wrote a comment claiming "PowerSync carries it to every device", then checked. **Not one job had ever reached the server.** |
| **Q2's protection vs PowerSync's upload** | 42501, then a **silently discarded row** | The bakeoff enforced "status is server-owned" by REVOKING table UPDATE. PowerSync upserts; PostgREST needs **table-level** UPDATE for an upsert — column grants are not enough. Because 42501 is in the fatal set, the row was **discarded**: job on the phone, "saved ✓", gone. | Reproducing the exact upsert by hand with curl. The hint said it outright. |
| **`owner-local` into a uuid column** | 22P02, queue poisoned | A spike constant that survived into product code. | Fixed at the door: `createProject` now refuses a non-UUID owner. |
| **Every photo/video written as `.bin`** | hash intact, capture fine, **file unopenable** | The local extension came from the MODALITY, not the mime: `text→txt, voice→m4a, else→bin`. | Playing a capture back. The player reported `playing: true` with the position frozen at 0 for 3.2s — **decoding nothing**. |
| **`bundle_limitations()` defined in two files** | nothing failed | 080 created it with 4; 090 rewrote it with 5; **re-running 080 silently reverted it** and the dispute bundle went back to overclaiming. `create or replace` is a replace, not a merge. | Counting array elements by hand. |
| **`ingest_capture_v1` defined in two files** | would have broken every upload | 060 drops the 12-arg and creates a 17-arg. Re-running 010 recreates the 12-arg **alongside** it → PostgREST cannot resolve → uploads break. The overload bug I had already fixed once, loaded and waiting. | The duplicate-check script, on its first run. |
| **"Text strings must be rendered within a `<Text>`"** | dev-only LogBox, no stack | A regex left `</Text>      <ScrollView` on ONE LINE. **In JSX, whitespace between elements on the same line is a text child.** Six invisible spaces. | Reading the file. Two static scans and a bisect all missed it — the offender is whitespace, and bisecting "passed" twice because the broken tree never rendered. |

**The standing lesson:** a test that passes because the code never ran is not a
passing test. I concluded "fixed" twice from exactly that.

### §5.2 Guards built, because each of these bit

Three checks now exist. Each exists because the class it catches actually cost hours:

- **`scripts/check-schema-agreement.mjs`** — diffs AppSchema.ts against
  `information_schema`. A client column the server lacks is FATAL: that is the
  permanent silent stall. **Proven by injecting the real bug**; exits 1.
- **`scripts/check-sql-duplicates.mjs`** — one object, one file. **Found a live
  hazard on its first run** (`ingest_capture_v1` in 010 and 060).
- **`sync_rejected` + a red banner** — a discard was an **in-memory array**: it died
  with the process and no user ever saw it. That is how every job was dropped on
  42501 with a clean queue.

None run in CI, because there is no CI. That is the obvious next thing.

### §5.3 Design decisions worth not re-litigating

- **Projects ride PowerSync; captures/decisions/notes/scope ride owned outboxes.**
  Not taste. Append-only tables carry triggers a PowerSync *view* cannot; a project
  is a mutable row and that is exactly what PowerSync is for. My first cut built an
  outbox for projects — **a second sync engine beside the one we adopted** — and it
  failed loudly (`CREATE TABLE IF NOT EXISTS project` silently did nothing, because
  PowerSync already defines `project`).
- **Server-ownership is enforced by TRIGGER, not by GRANT.** The invariant was never
  "the client cannot run UPDATE", it was "the client cannot change status". A grant
  was the wrong instrument and was incompatible with the tool we adopted.
- **The bundle and the progress update are opposites, deliberately.** The bundle is
  for a fight (complete, hedged, every superseded value, six limitations). The
  update is for a Friday (current value only, no hashes, the ask last and alone).
  Sending the bundle to a homeowner tells her you are preparing to sue her.
- **REQ-X3 was violated by my own "never silent" fixes.** The app grew EIGHT parallel
  status banners, each added honestly for a good reason. Stacked, they are a wall a
  man on a ladder cannot parse — **every fix made the next one quieter.**
- **The state machine says the weaker true thing.** After a drain with no server
  word, an item reports `captured`, not `uploaded`. Inferring success from the
  absence of a queue row is the phantom-"saved" bug wearing a different hat.

### §5.4 Requirements: what is actually blocked, and on what

Not "needs an LLM" as a lump. Each named:

| Requirement | Real blocker |
|---|---|
| CAP7 (pre-roll), REP-7 (pause=section break) | **A microphone.** This Mac mini has none, and **no camera either** — confirmed by the user 2026-07-17 (`system_profiler`: one audio device, output only). Test photo/video/audio by generating a file and feeding it through the real path; never a live device, and never a synthetic DB row passed off as proof of the capture path. |
| ~~PROC1 / PROC3 / PROC5, REP-6, REQ-P1's content signal~~ | ~~**An LLM/STT key.**~~ **NO LONGER TRUE — corrected 2026-07-17.** The user authorised the OpenAI key on 2026-07-16; PROC1/PROC3 and PROC5's *detection* half are **live and proven** against real Supabase via `services/worker/worker.mjs`. This row stayed wrong for three commits after the fact and was owed in three consecutive commit messages. **A stale blocker is worse than no note**: it is how a future session inherits a false belief and declines to build something that already works. What actually remains: **PROC5's P1.5 half** (translate / display-cache / English-pivot search) and **REP-6**. |
| REQ-P4's content signal | **Nothing. Built 2026-07-17, deliberately WITHOUT the model** (`170_content_resolution.sql`). Listed here because the row above once claimed it needed a key. It does not: project identity is a string match against rows we already hold, and the model — asked that question — will confidently match a job that was never mentioned. See §5.5. |
| REP-3 (daily digest) | A scheduler + notification channel. Not a share button. |
| TL4 (video → audio + keyframes) | Native media extraction + a journaled encrypted temp asset. A subsystem. |
| REQ-VAL8 hosting | **A static host for one file**, then `EXPO_PUBLIC_CONFIRM_BASE`. Supabase Storage **refuses to serve renderable HTML** (verified: row says `text/html`, CDN serves `text/plain`, `.json` serves correctly — a deliberate anti-phishing measure). |
| Trade taxonomy | A product decision about which trades/market. |
| REP-4/5 | P2. |

**REQ-PROC2 was already built and untagged** — my own audit counted it missing. The
tag was the gap, not the behaviour. Worth checking the others before building.

### §5.5 Measured, not asserted

- **REQ-PROC4 acceptance: 100 cycles, 14 abandoned drains → 0 lost, 0 dup, 0 corrupt.**
  With a **negative control** that is kept in the source and off by default: with it
  on, `pass:false, lost:['cap-never-committed']`. A test that cannot fail is not a
  test.
- The kill is **simulated** (an abandoned drain), NOT a SIGKILL. A harness cannot
  report on the process that killed it. `spike/harness/kill.py` does it from outside.
- Media integrity sampled at **25 of 100**, not exhaustive.
- **The model invented a price. Measured, 2026-07-16.** Given *"Add three outlets in
  unit 3B, four fifty"*, `gpt-4o-mini` at `temperature: 0` returned
  `amount_cents: 45000` with `confidence: "high"` — inventing **$450** in direct
  defiance of a system prompt that said to use null unless a currency figure was
  actually spoken. The app's `parseMoney()` **refuses that same input**
  (`{cents: null, confidence: 'none'}`) because it only accepts an explicit currency
  marker. **The regex is safer than the model on the highest-risk field in the
  product.** This is mandate #2's ~31% hallucination figure reproduced locally, on
  mandate #6's field, on the first realistic input tried.
  - **The rule it earned: the model for comprehension, a deterministic rule for
    identity and for numbers.** Use the model for what only it can do — turning
    rambling speech into a subject and a value. Never for a number, and never for
    *which job this is*.
  - Enforced in **two places on purpose**: the prompt bars amounts, and
    `worker.mjs` hard-codes `const cents = null`. A prompt is a request; the code is
    the guarantee. This measurement is why the prompt alone is not trusted.
  - **REQ-P4 was then built as SQL, not an LLM call, on the strength of this** — with
    an authorised key sitting right there. `content_resolve()` is exact, auditable,
    testable, free, and **cannot hallucinate a jobsite**. A capture filed to the
    wrong job is the failure **nobody goes looking for**, which is strictly worse
    than an unresolved one sitting in a queue a human checks.
- **REQ-P4: 12 behavioural cases pass**, including the two that would have shipped a
  mis-file: *two matches → none* (the first cut returned the matches and *then*
  appended an "ambiguous" row, so a caller reading the first row got a confident
  wrong answer), and *matched_text quotes the field that actually matched* (it first
  quoted the project **name** while `matched_on` said **address** — evidence
  contradicting its own label, which is worse than no evidence because it looks
  checked).
- **Two queue bugs found by inspection, then PROVEN before being called bugs.**
  Every photo blocked with `needs_connection: no transcript to structure` — a reason
  that was not true, on a capture with nothing wrong with it. And a job with no
  remaining steps was **never marked done by anyone**, because only a step calls
  `complete_step`: it sat in `running` until the lease lapsed, was reclaimed, and
  died at `attempts >= 5`. The second is the dangerous one — **silent**, and it hit
  every photo *and* every resumed job whose work was already complete.

### §5.6 Recording-consent model change — LOGGED DECISION (mandate #2 / REQ-CON1)

**Decision (hadar, 2026-07-17, on-device during the first real-hardware session):** the
product is positioned as **personal-use**, and the recording-consent acceptance is
**carried by the app's Terms & Conditions, accepted ONCE**, rather than a per-job
in-app consent form. This is recorded here because it **changes a non-negotiable
mandate**, which the operating contract (CLAUDE.md §2) permits *only* via an explicit,
logged decision — this is that log.

**What changed in the build:**
- First-run no longer includes a consent step (already deferred earlier the same day);
  the per-job recording-consent form and its "recording isn't set up" banner are
  **removed**.
- A **one-time Terms acceptance** (`getTermsAccepted`/`setTermsAccepted`, `consent.ts`,
  version-keyed in `device_settings`) gates recording. `canRecordAudio` short-circuits
  to `allowed` once accepted. The screen appears at the **first record tap**, once ever.
- The GPS→state resolver built earlier (`jurisdiction.ts`) is **repurposed** from the
  deleted per-job form into a **non-blocking all-party-state reminder** on the Terms
  screen.

**Why this is NOT a silent auto-approve (the line that was held):** mandate #2 forbids
*silently* deciding it is lawful to record a person. A one-time Terms acceptance is
still a **deliberate human act** — the user taps I ACCEPT — so a human remains in the
loop (mandate #10). What was removed is the *per-job repetition*, not the human.

**Stated residual boundary (honest, not hidden):** the user's acceptance binds the
**user**. Other people in a recorded conversation are not party to these Terms; in the
~12 all-party states the user still carries that responsibility. The T&C wording is the
owner's/counsel's to write; the app surfaces the state-aware reminder and never asserts
third-party consent on the user's behalf. The strict per-job basis logic (`ALL_PARTY_STATES`,
`defaultConsentFor`, `setRecordingConsent`) remains in `consent.ts` — unused by the UI
now, retained so this decision is reversible.


### §5.7 The unsigned-approval bypass — FOUND, FIXED, APPLIED (mandate #2)

**Found** by a Codex adversarial review on 2026-07-21 (the cross-model critic §4
mandates), ranked its #2 of 16 and the highest-severity finding in the branch.

**The hole.** `confirmation_respond` is granted to `anon` — correctly; the whole
client-side design is a no-account SMS link — and took `p_signed_name text default
null` with no validation in the function, the table, or anywhere else. The only thing
requiring a signature was two lines of browser JavaScript:
`approveEl.disabled = nameEl.value.trim().length < 2`. Anyone holding a link could call
the RPC directly with `p_action='confirmed'` and no name and mint a binding,
**append-only** "approval" nobody signed. Mandate #2 defines approval as "a digital
signature — a binding, verifiable sign-off"; and because `confirmation_response` carries
the no-update/no-delete trigger, the forged row could never be removed.

**Why it survived review until now:** every existing guard was about *tampering with
what was shown* (`confirmation_request_guard` freezes `shown_content`). Nobody had
asked the opposite question — whether the *answer* was real. Freezing the question is
not the same as authenticating the answer.

**The fix** (`210_approval_signature.sql`): a `BEFORE INSERT` trigger on
`confirmation_response` refusing `action='confirmed'` when the linked request is priced
(`amount_cents IS NOT NULL`) and `signed_name` is absent or under two trimmed chars.

Three choices, each load-bearing:
1. **A trigger, not a CHECK constraint.** The rule depends on the *request* row, and a
   CHECK cannot read another table. This is not pedantry: the legacy no-price decision
   path legitimately answers `confirmed` with **no name**
   (`confirm.html` `renderPlain` → `answer('confirmed',null,null)`), so a blanket
   constraint would have broken every decision confirmation in the product.
2. **At the table, not in the RPC.** It holds for every write path, and it survives the
   migration-order hazard in Codex #5 — re-running `020_confirmations.sql` after `200`
   restores the older function definitions, which would revert a guard living in a
   function. A trigger owned by `210` is not reverted by that.
3. **A new function name**, so the already-red duplicate checker gains nothing.

**Applied to production 2026-07-21** and verified against the live database inside a
transaction that was rolled back (0 rows left behind):

| Test | Expected | Result |
|---|---|---|
| priced + `confirmed` + no name | refused | **REFUSED** ✓ |
| priced + `confirmed` + name | allowed | **ALLOWED** ✓ |
| legacy no-price + `confirmed` + no name | allowed | **ALLOWED** ✓ |

Pre-flight also confirmed **0 existing rows** would have been refused, so no historical
evidence was invalidated by applying it.

**What this does NOT settle.** It raises the floor from "nothing at all" to the v1
instrument (typed name + immutable snapshot + audit trail). Whether that clears the
ESIGN/UETA enforceability bar is still **Fable Q1, BLOCKING before launch**
(`PRD-RECONCILIATION` §5/§6). It also does not verify the typed name belongs to the
person typing it, and it does not close Codex #1 — a correctly signed approval still
does not move the change order out of Draft.

**AMENDED 2026-07-21 — the rule is now unconditional.** The version above scoped the
signature requirement to PRICED requests, to avoid breaking the legacy no-price path.
hadar: *"yes decisions should also be signed."* That was the right call and it closed a
second hole the first fix left open: a **Decision** — "confirm the vanity height at 34
inches", the thing that exists to prevent a rework argument — could still be confirmed
by anyone holding the link, unsigned. It also contradicted the product spec, which was
correct all along: `PRD-change-approval-loop` R10 says a Decision "records signature +
timestamp **like any item**". The spec was right; the implementation was wrong.

The trigger no longer reads the request row at all — every `confirmed` response is
signed. `confirm.html` `renderPlain` gained the matching name field in the same change,
because a server rule with no client field is just a wall. Declines still need no name:
identity is not the price of saying no.

Re-verified against the live database, rolled back, 0 rows left:

| Test | Expected | Result |
|---|---|---|
| priced + `confirmed` + no name | refused | **REFUSED** ✓ |
| **Decision** + `confirmed` + no name | refused | **REFUSED** ✓ |
| Decision + `confirmed` + name | allowed | **ALLOWED** ✓ |
| decline + no name | allowed | **ALLOWED** ✓ |
| name of `"  x  "` (1 char trimmed) | refused | **REFUSED** ✓ |

Pre-flight: **0** existing confirmed rows were unsigned, so no historical evidence sits
on the wrong side of the new rule. Existing rows are never re-validated (BEFORE INSERT)
— they are evidence of what happened, and rewriting them would be its own dishonesty.
