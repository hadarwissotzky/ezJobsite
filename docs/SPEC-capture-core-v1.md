# Hilo v1 — De-Risk Specification: Capture Core + Handler Model

*The authoritative spec, re-derived from the locked core concept and the master use-case catalog. **Supersedes `SPEC-v1-change-order-wedge.md`**, which is now correctly the P1.5 Change Order handler within this structure. Phase goal unchanged: **de-risk** the hard parts via a thin, real slice + a measured test — but the lead is now the **Capture core + Evidence**, not the change order. Companions: `CORE-CONCEPT.md`, `MASTER-USE-CASES.md`, `VERIFICATION_PLAN.md`, `IMPLEMENTATION_NOTES.md`, `CLAUDE.md`. Version 1.0 (capture-core) — 2026-07-15.*

---

> **Naming:** the product is **EZjobsite** (jobsite-focused), a portfolio company of **Hilo** (the venture group). "Hilo" in these docs = the parent; the product is EZjobsite. Filenames keep the `hilo-`/`Hilo` prefix for continuity.

## 0. What this is, and the phase framing

**Is:** the *what* of v1 plus the *plan to de-risk it*, built on the enriched requirements (35 merged use cases), not the thin original set. **P1 (the capture core + evidence + lightweight validation loop) is specified to buildable resolution.** P1.5 (Change Order, signature Approval, Report) and P2 (expansion) are specified as **seams** — enough to architect for, not to build yet.

**Is not:** the UX spec (hands-free interaction model still deferred), the deep technical/architecture spec, or deployment. Those follow. This spec leaves clean seams for them.

**Locked decisions this spec obeys** (`IMPLEMENTATION_NOTES §2`): capture is the core; Evidence is the base layer; Approval/Change Order/Report are the three actions; **Capture + Evidence leads P1**; capture is multimodal (voice/video/photo/text), offline-forward, GPS/time-stamped; a recording is a **timeline** (images synced to it; video → auto + user-marked keyframes); **processing is online — capture offline always, process on reconnect, no heavy on-device ML in v1**; approval signs on the **owner's own device via a sent link**; two consents (recording + cellular); **stack LOCKED (see `ARCHITECTURE.md` ADR-1..5): React Native + Expo · encrypted SQLite + an owned sync queue for P1 (PowerSync deferred to P1.5+) · Supabase raw Postgres · TypeScript API on Edge Functions/Hono · durable-jobs runtime for the pipeline**; solo AI-assisted build. **P1 scope (2026-07-15):** the critic flagged P1 as broad (H1); hadar chose to **keep P1 as is** — a consciously larger first slice, trading a slower first testable milestone for breadth. The "thin slice" language is relaxed accordingly; the durability trust-anchor (U1) still ships first within P1. **Signatures** are identity-bound (SMS OTP + typed legal name); **erasure** uses hard-delete + retained hash/metadata stub (see §8 + CLAUDE #5).

---

## 1. The product model (brief)

The atomic act is **capture** — a team member records a jobsite conversation or observation. Every capture is, by default, **Evidence** (durable, timestamped, GPS-stamped paper trail). On top of that base sit **three actions**, unified by the **Approval Spectrum** — one mechanism at escalating formality:

`lightweight confirm (decision-of-record) → acknowledge (sub↔GC directive) → digital signature (formal approval) → priced approval (change order, digitally signed)` — "approval" always = a **digital signature**; verify/confirm is the lighter, unsigned step.

and the **Report** action rolls captures up into logs/updates/ledgers. Full model in `CORE-CONCEPT.md`; full use-case list in `MASTER-USE-CASES.md`.

> **Core design principle — who this is for (measure every screen against it).** Built for people for whom **phones and software are not second nature**, capturing information **wherever it is** — the jobsite, the truck/car, a city permit office, shopping for materials. Their *only* job is to provide the information (talk or snap); **the system does 100% of the organization, structuring, filing, translation, and routing in the backend, so they never have to.** The test for any flow: *would someone who doesn't think in software succeed here without being taught?* If not, it's wrong — this is a core requirement, not polish. **The goal underneath everything: protect contractors and subcontractors from miscommunication and errors by keeping all parties aligned — and deliver that even to a solo operator with no back office (the "office" is a role, never a requirement).** `[trace: hadar]`

---

## 2. Architecture at a glance — the pipeline

```
   CAPTURE (local, instant, offline)              PROCESS (on reconnect, cloud)          HANDLERS
   ┌─────────────────────────────┐   queue   ┌───────────────────────────────┐   ┌────────────────────┐
   │ voice│video│photo│text      │──────────▶│ upload raw ▸ transcribe ▸       │──▶│ Evidence (base)    │
   │ timeline-synced, GPS/time    │  durable  │ detect lang ▸ translate ▸       │   │ Validation loop    │
   │ stamped, encrypted local     │  resumable│ extract keyframes ▸ structure   │   │ (P1)               │
   │ ▸ confirm saved (audio+vis)  │◀──────────│ ▸ resolve project               │   │ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
   └─────────────────────────────┘  sync back └───────────────────────────────┘   │ Approval▸CO▸Report │
        always works, no signal        upload gated: wifi | cell+consent           │ (P1.5 seams)       │
                                                                                    └────────────────────┘
```

**Invariant:** nothing in the CAPTURE column ever depends on connectivity or on a handler. Capture + durable local save + confirm is complete on its own. Everything to the right happens later, opportunistically.

---

## 3. Scope

### 3.1 P1 — build & de-risk now (detailed in §6)
The **capture core** (multimodal, timeline-synced, offline-first, encrypted, recovery), the **connection-aware processing/upload** pipeline (transcribe + retain source + language detect on reconnect), the **project resolution layer**, **Evidence** (durable stamped retrievable paper trail), and the **lightweight validation loop** (decision-of-record, sub↔GC directive, one-tap confirm to the counterparty's device). Plus minimal setup (create job, first-run/consent).

### 3.2 P1.5 — architect the seams, build next (specified in §7)
The **Change Order** handler (voice → priced → approved), **signature-grade Approval**, and **Report/ledger** (status board, client update, back-office digest, dispute bundle export). These carry the money and the legal weight; they enter right after the core is trusted, and each has an **entry gate** (the AI-accuracy spikes) before build.

### 3.3 P2 — expansion (listed in §7.4)
Daily/weekly logs, punch list, inspection, safety/incident, RFI, T&M, voice retrieval, client gallery.

### 3.4 Out of scope / DO NOT BUILD
Full CRM, scheduling, invoicing/payments, estimating suite, heavyweight e-sign document flows, wearables/headset dependencies, general messaging. Integrate for billing; don't rebuild it.

---

## 4. The de-risk unknowns, re-sequenced

Leading with Capture+Evidence changes *which* unknowns we hit first. P1 unknowns are about reliability and the timeline model; the AI-accuracy unknowns move to the **P1.5 entry gate**.

| U | Unknown | Phase | Instrument |
|---|---|---|---|
| **U1** | Capture never lost across faults, incl. video + mid-sync | **P1** | Fault-injection harness (native). |
| **U-TL** | Does the timeline model (image↔recording sync, video keyframes) actually produce compilable reports? | **P1** | Build + inspect on real captures. |
| **U-RES** | Project resolution accuracy (GPS **+ content detection**) in real indoor/multi-unit sites, incl. correctly proposing a **new** project vs. matching an existing one without spawning duplicates | **P1** | Field/proxy measurement. |
| **U-SYNC** | Offline→online processing/upload is lossless, resumable, correctly consent-gated | **P1** | 100-cycle offline/online + kill test. |
| **U4** | Voice → structured priced CO accuracy (pre-confirm error + catch rate) | **P1.5 gate** | Laptop Wizard-of-Oz (no app). |
| **U3** | Multilingual (Spanish/Spanglish incl. numbers) feasibility | **P1.5 gate** | ASR on gold audio (no app). |
| **U5** | Net-of-correction time win (voice vs typing a CO) | **P1.5 gate** | Timed WoZ. |
| **U6** | Client approval before work + identity-vs-friction | **P1.5 gate** | Prototype link to real homeowners. |
| **U8** | Scope-translation fidelity | **P1.5 gate** | Back-translation on gold-set. |

The AI spikes (U3/U4/U5/U6/U8) still run **cheap and app-free**, and they gate *P1.5 entry* (the CO handler). **Caveat (P1 kept broad by hadar, critic H3):** because P1 now includes AI extraction (decision-card structuring, language-detect ≥95%), **U3/U4-class risk partially lives in P1** — run those spikes *early*. **If extraction fails, the decision card degrades to *unclassified evidence*** — the capture stands as durable evidence and classification is deferred to the office/later — **never to a classification form handed to the gloved field user** (that would resurrect the H8 leak; per greenlight review MF-6). Don't claim "no AI risk in P1."

---

## 5. Requirements format
`REQ-x##` · `Accept:` measurable pass condition · `[trace: …]` to a master use-case ID / core-concept / logged decision · `Touch budget:` where a physical-interaction cap applies. "Confirm" = an explicit human action.

---

## 6. P1 functional requirements (the build target)

### 6.1 Capture primitive
- **REQ-CAP1 — One-action start.** Starting a voice capture takes **one deliberate action** on a large primary control; other modalities are ≤1 action deeper. `[trace: CAP-1; hands-free]`
  - Accept: voice capture begins in ≤1 action, <1s; gloved-thumb operable (field test). Touch budget: **1 start, 1 stop.**
- **REQ-CAP2 — Four modalities, offline, internal.** Capture accepts **voice, video, photo, text** via the device's internal capabilities, all fully offline. `[trace: CAP-1; core-concept §4; offline-forward]`
  - Accept: in airplane mode each modality captures, durably saves, and confirms.
- **REQ-CAP3 — Text annotation on any capture.** Text can be added to any capture. `[trace: CAP-1; hadar]`
  - Accept: a text note can attach to a voice/photo/video capture and persists with it.
- **REQ-CAP4 — Local-first durable write, OS-file-protection at rest.** Every capture streams to **durable local storage as it is captured**, before any network call, protected at rest by **iOS Data Protection / Android encrypted storage** (not app-level per-capture encryption). `[trace: CAP-5; mandate #1; critic M5; reworded 2026-07-16 per DECISION 4 → Option A — client-side media encryption dropped for v1; see DURABILITY-DESIGN-v1 DECISION 4 for the rationale and the revisit trigger]`
  - Accept: passes the fault-injection suite (§9 / VERIFICATION §C U1).
- **REQ-CAP5 — Save confirmation, audible + visual — fires ONLY at `MEDIA_COMMITTED`.** Success is confirmed on-screen **and** audibly/haptically; failure is loud, never silent. The confirmation is gated on the **capture-commit state machine** (`DURABILITY-DESIGN-v1.md` Artifact 1) reaching **`MEDIA_COMMITTED`** — media finalized + `fsync`'d + **verified**, AND the local SQLite transaction (Capture + Attachment + outbound mutation) committed. **Not** on the raw local write, not on a journal boolean, not on upload. `[trace: CAP-5; appstore "confirm it saved"; gated per Codex #6 C1 — a confirm on the local write is the phantom-"saved" bug]`
  - Accept: "saved ✓" + sound/haptic emits **only** for a capture whose manifest state is `MEDIA_COMMITTED` and which passes the full oracle (decodable, duration credible, hash match, rows present, outbound mutation present); every failure surfaces non-silently. A "saved ✓" for a capture failing any oracle check is a **loss** — the worst-severity fault.
- **REQ-CAP6 — Crash/fault recovery.** An interrupted capture is detected on relaunch and surfaced to keep or discard. `[trace: CAP-5; edge cases]`
  - Accept: interrupt mid-capture (incl. mid-video) → relaunch → partial capture recoverable.
- **REQ-CAP7 — Pre-roll buffer.** Voice/video capture retains a short pre-roll so the beginning isn't clipped by reaction time. `[trace: CAP-1 (your UC4 "optional pre-roll")]`
  - Accept: audio from ~1–2s before the tap is present in the saved capture (configurable). *(Note: CRITIC-04 High-8 flags pre-roll vs. consent — pending fix-batch decision; may be cut from P1.)*
- **REQ-CAP8 — Write-ahead capture journal (the ezQuotePro fix).** At record **START** — before any media is finalized and before any network call — a durable **journal entry** is written recording that a capture began (id, project, author, start time, modality, intent). Media then streams into that record (REQ-CAP4). **The journal is a state machine, NOT a boolean `complete` flag** — the entry advances through the Artifact-1 states (`STARTED` → `RECORDING` → `FINALIZING` → `VERIFIED` → `MEDIA_COMMITTED`), each transition durable and idempotent, recorded in a **sidecar manifest** that is the recovery source of truth independent of SQLite. A kill/crash **during** recording leaves a recoverable journal entry + whatever media was streamed (truncatable to the last verified chunk boundary). `[trace: CRITIC-REVIEW-05 — ezQuotePro wrote nothing on start, so a mid-recording kill lost everything; core-concept "commit before first network call"; boolean-complete banned per Codex #6 C1 — "marked complete" was the old wording and is superseded]`
  - Accept: kill the app *while recording* → on relaunch the in-progress capture is present and recoverable (not just captures that finished and reached the queue). This is a named exit gate of the durability spike.

### 6.2 Timeline & media sync
- **REQ-TL1 — A recording is a timeline.** A continuous voice/video recording is a time-indexed track to which markers and media anchor. `[trace: core-concept §4; hadar]`
  - Accept: every recording exposes a timeline with anchorable timestamps.
- **REQ-TL2 — Photo during a recording is timeline-anchored.** A photo taken while a recording runs is bound to the recording's timeline position, for later report compilation. `[trace: hadar; CAP-2]`
  - Accept: a photo taken at t=Xs into a recording stores that offset and reconstructs at the right point.
- **REQ-TL3 — User can mark a moment; pause = section break.** During a recording, one action drops a **timeline marker** ("this matters"); and **pausing then resuming forces a section break** — the leading gesture for structuring a walkthrough into sections (final interaction confirmed in the UX phase). `[trace: hadar; video-keyframes decision; companycam-ai-features-analysis §4 "pause=section break"]`
  - Accept: a mark during recording creates a retrievable marker; a pause/resume creates a section boundary the Report/Checklist handlers consume. Touch budget: **1 per mark/pause.**
- **REQ-TL4 — Video → on-device extract (audio + stills); raw video never RETAINED or UPLOADED after successful extraction.** Video is a transient capture medium. **On the device**, a 2-step extraction yields the **audio** (→ transcription) and **key stills** (user-marked timeline frames + periodic/scene-sampled); only those are retained and synced. The **raw video is held as an encrypted, journaled temporary asset** until the derived audio + stills are **finalized, verified, and registered** — required for REQ-CAP6 mid-video crash recovery — then deleted via a **recoverable cleanup state**. It is never uploaded. `[trace: hadar "don't store video, 2-step on-device extraction"; ARCHITECTURE §3.1; resolves cost/storage; wording fixed per Codex #6 C6 — the old "never stored" made REQ-CAP6 recovery impossible]`
  - Accept: a video capture produces a synced audio asset + still images + transcript; the raw video is never retained or uploaded. *(On-device extraction is cheap deterministic media work — not "on-device ML"; transcription/structuring stay cloud. Trade-off: continuous video isn't kept as evidence — audio + timestamped stills + transcript is.)*
- **REQ-TL5 — GPS + time evidence stamp (device-attested, server-corroborated).** Every voice/photo/video capture is stamped with GPS + capture time; missing GPS is recorded "unavailable," never blank. The stamp is **device-attested** (from the device clock/GPS, which are user-alterable offline) and **corroborated by a trusted server timestamp on sync** — *not* claimed as tamper-proof while offline. `[trace: EVID-4; companycam/timemark dispute armor; fixes critic M5]`
  - Accept: stamp present on capture, survives sync, appears on export; a server-side trusted timestamp is recorded at upload; the offline-trust boundary is stated honestly.

### 6.3 Local-first storage, connection-aware processing & upload
- **REQ-PROC1 — Process on reconnect, not on device.** Transcription, language detection/translation, and handler structuring run **when a qualifying connection exists**; no heavy on-device ML in v1. **Exception (fixes Codex #6 H12 contradiction with REQ-TL4):** video **audio + keyframe extraction is on-device** — it is cheap, deterministic media work (native/ffmpeg-lite), *not* ML, and must run locally because the raw video is not uploaded. So: media *extraction* on-device; *ML processing* (transcribe/translate/structure) on reconnect. `[trace: core-concept §5; REQ-TL4; decision]`
  - Accept: with no signal, captures are complete + queued; on reconnect they process automatically.
- **REQ-PROC2 — Upload gating.** Strong **Wi-Fi** → upload; strong **cell + cellular-consent on** → upload; otherwise hold locally. `[trace: hadar connection rules; CON-2]`
  - Accept: with cellular-consent off and no Wi-Fi, nothing uploads over cell; on Wi-Fi it uploads; state is visible.
- **REQ-PROC3 — Transcribe + retain the original.** Audio is transcribed; the **original recording + source-language transcript** are retained immutably (per retention policy). `[trace: core-concept §4; CAP-4; mandate #5]`
  - Accept: original audio + source transcript retrievable on every processed capture.
- **REQ-PROC4 — Durable, resumable, visible processing queue.** The capture→upload→process pipeline is durable across restarts, resumable after a mid-sync kill, and shows per-item state (captured → queued → uploaded → processed). `[trace: U-SYNC; REQ-Y1 heritage; appstore offline]`
  - Accept: 100 offline/online cycles incl. a mid-sync kill → no loss/dup; every item shows correct state.
- **REQ-PROC5 — Language: English-canonical pipeline.** On processing: **auto-detect** source language, **store the original + source language**, translate to the **canonical English** permanent record; **display** to each user in their **profile preferred language** via a **translate-once cache**; **search** is English-pivot (query → English, match on the English index, results → preferred language). Full detail in `LANGUAGE-LAYER.md`. `[trace: hadar language layer; refines the earlier "modular target" decision]`
  - Accept: detection ≥95%; original always retained; one English-canonical record renders to two users each in their own language; a cached translation isn't recomputed until the record's `content_version` changes. *(Store-original + detect + preferred-language field = **P1**; translate/display/cache/pivot-search = **P1.5**, gate U3/U8.)*
- **REQ-PROC6 — Processing status + reason, surfaced and non-blocking.** Every item shows a clear state — **saved locally ✓ → waiting for connection → uploading → processing → ready** — and when it's stuck it tells the user **why** in plain language ("saved — will process when you have Wi-Fi", or "needs cell data — turn on cellular upload"), via the item's visible state and, if it persists, a notification. **Capture is never blocked** by processing or connectivity; media (photos, recordings) always land on the device first. `[trace: hadar "notify if it can't be processed yet… but always let you capture"; mandate #1/#7]`
  - Accept: an offline item shows "saved ✓ — will process when connected"; connecting Wi-Fi advances it automatically; the pending reason is human-readable; capturing more is always allowed with no wait.
- **REQ-PROC7 — Projects work offline.** A project can be **created and captured-into with no signal**; the projects **list / search / nearby** operate on cached data offline; GPS resolution works offline (content-detection waits for processing); new offline projects + captures **sync on reconnect**. `[trace: hadar "offline projects"; REQ-PM-A/B; offline-forward]`
  - Accept: with no signal, create a project, capture into it, and see it in the list; on reconnect it syncs with **no data lost**. **Duplicates are not promised-away** — two devices creating the same project offline is expected; the server **dedups on sync (address/geofence/time clustering) and surfaces near-duplicates for one-tap merge**, never a silent double. `[fixes critic H5 — concurrent offline create]`

### 6.4 Project resolution layer
- **REQ-P1 — Auto-resolve, no manual filing.** Each capture auto-assigns to a project via GPS/geofence + time + context (last job, recent captures, address). `[trace: CAP-6; companycam #1 love]`
  - Accept: mis-attach ≤5%, ≥85% auto-resolved without prompting (field/proxy).
- **REQ-P2 — Secondary workflow on ambiguity/no-match.** Low confidence / multiple / no match → capture held in a durable **"unresolved"** queue and routed to a resolve step; never lost, never silently mis-filed; resolves in ≤1 action. `[trace: CAP-6; hadar secondary workflow; mandate #1]`
  - Accept: ambiguous/no-match captures persist as unresolved, appear in a queue, resolve in ≤1 action; 0 lost.
- **REQ-P3 — Reassign/override.** A capture can be moved to the right project in one action. `[trace: CAP-6; critic M6]`
  - Accept: override is 1 action; override rate recorded.
- **REQ-P4 — Content-assisted project detection (existing vs. new).** On processing (transcript available, so on reconnect), combine **content signals** (a client name, address, or job reference spoken in the recording) with GPS to either (a) confirm/strengthen a match to an **existing** project, or (b) conclude **no existing project fits** → candidate for a new one. `[trace: hadar "project detection"; extends REQ-P1]`
  - Accept: a recording that names/implies a known project resolves to it; one that fits no project is flagged **"new project?"** rather than mis-filed or lost; detection accuracy folds into the U-RES measurement.
- **REQ-P5 — Propose a new project from a recording (confirmation-gated).** When detection concludes no existing project fits, the system **proposes creating a new project** — pre-filling name / address (GPS) / client / description **extracted from the recording** — for **one-tap confirm**. A project is **never auto-created**; ambiguous "existing vs. new" routes to the secondary/unresolved workflow (REQ-P2). `[trace: hadar "new project that needs to be created from a recording"; confirm-don't-automate; PM-1]`
  - Accept: no project is created without explicit confirm; a proposed new project is acceptable in ≤1 action; low-confidence cases land in the unresolved queue, never a silent create. *(P1 = propose-create with manual fields; P1.5 = AI pre-fill of the fields from the recording — it's extraction, so it rides with the AI gate.)*

### 6.5 Evidence (the base layer)
- **REQ-EVID1 — Every capture is durable evidence.** By default a capture is immutable, timestamped, GPS-stamped evidence, standing on its own for inspectors/peers. `[trace: EVID-1; core-concept §3]`
  - Accept: raw capture + stamp is retained and viewable without any handler applied.
- **REQ-EVID2 — Retrieve by project + recency.** A capture/decision is findable by job and recency. (Cross-job voice retrieval = P2.) `[trace: EVID-4; companycam retrieval]`
  - Accept: a given job's captures found in ≤2 actions.
- **REQ-EVID3 — Group related captures.** Related captures (e.g., before/after + narration) can be grouped so a full **evidence bundle** can later be compiled/exported (export itself = P1.5). `[trace: EVID-3; your UC5]`
  - Accept: captures can be linked into a named group that carries who-directed + stamps.

### 6.6 Validation loop (lightweight Approval — the P1 differentiator)
- **REQ-VAL1 — Decision-of-record.** Capture a jobsite decision (may carry no price), structure a **decision card** (what, where, who said it, when), and send a **"confirm this is what we agreed"** one-action request to the counterparty's own device. `[trace: EVID-1 / your UC2]`
  - Accept: a decision card is produced and a no-login confirm link is sent to the counterparty.
- **REQ-VAL2 — Sub↔GC directive.** Capture a directive with **who-directed + scope + optional NTE**, and send an **"acknowledge you directed this"** request to the GC/PM. `[trace: EVID-2 / your UC3]`
  - Accept: directive-of-record produced with who-directed + NTE; acknowledge/amend link sent.
- **REQ-VAL3 — Counterparty acts on their own device.** Confirm / acknowledge / decline happens on the counterparty's device via a **no-login link**; the action is timestamped and recorded against the project. `[trace: approval-location decision; core-concept §7.4]`
  - Accept: counterparty confirms/declines with no account; result recorded with timestamp + identity signal.
- **REQ-VAL8 — P1 delivery channel (resolves critic H2 / greenlight MF-5).** The confirm/acknowledge link is delivered in P1 via **email + SMS** to the counterparty's contact on the job. Email works from day one; **Twilio A2P 10DLC registration starts at project kickoff** (lead-time, not code) so SMS lands during the build; if 10DLC is still pending at M5, email is the interim channel. `[trace: hadar channel decision; critic-01 H2; arch H5]`
  - Accept: a sent confirm request actually arrives on the counterparty's device via at least one working channel in P1; delivery state (sent/delivered/failed) is visible to the sender.
- **REQ-VAL4 — "Who directed it" is explicit.** The directing party is a confirmed field, defaulted from the job's known parties, never silently inferred from audio. `[trace: substantiation pain; multi-speaker misattribution]`
  - Accept: present, defaulted, user-settable on every decision/directive — **confirmed within the single confirm surface of REQ-VAL6, never as a separate step** (greenlight MF-6 reconciliation of VAL4↔VAL6).
- **REQ-VAL5 — Decision as a versioned aggregation unit.** A Decision has a **subject** (e.g., color, height, placement), a **current (latest) value** that supersedes prior ones, a retained **history** of superseded values, **aggregated captures/photos** anchored to it, and **AI tags** for later search. The latest value is authoritative; **history is never destroyed** (a decision is a traceable chain, not an overwrite). Decisions — not photos — are the anchor; photos aggregate *around* them. `[trace: hadar "stored as the latest decision"; core-concept "the decision is the atomic unit"; inverts companycam photo-centric]`
  - Accept: setting a new value supersedes the prior (both retained + timestamped); captures/photos attach to the decision; the decision is findable by its tags. *(Versioning + aggregation = P1; AI auto-tagging rides the P1.5 AI gate.)*
- **REQ-VAL6 — Decision scope level + assignment.** Every decision has a **scope level** — **project-scope** (affects the overall project) or **party/worker-scope** (delineates responsibility between parties). If a decision is **actionable**, it records **who it's assigned to** (the responsible party/company/worker). `[trace: hadar "2-part decision layer"; research pain #6 communication breakdown]`
  - Accept: a decision is tagged project vs. party scope; an actionable decision carries an assignee; a party can see everything assigned to them. *(Scope-level + assignee = **P1**.)* **These classifications (scope-level, who-directed, intent) are system-inferred with sensible defaults — never a form the user must reason about (critic H8 + greenlight MF-6). Hard acceptance criterion: the entire P1 decision flow presents exactly ONE confirm surface (one glanceable card, one confirming action) — who-directed (REQ-VAL4) is a defaulted, tap-to-change field *inside* that surface, not a separate confirm. If inference is unavailable, degrade to unclassified evidence (see §4), never to a field-user classification form. "Succeeds without training" is a usability gate.**
- **REQ-VAL7 — Responsibility delineation across trade boundaries.** The system captures **who is responsible for what** at scope boundaries (the classic air-handler / compressor "electrician or mechanical?" ambiguity) as an explicit, assigned, on-the-record decision, and can **surface gaps or conflicting/duplicate assignments** so they're resolved before they become rework. `[trace: hadar air-handler example; research "scope gaps" / sticky COs]`
  - Accept: a boundary decision assigns responsibility to a specific party and is retrievable per party; overlapping/unassigned scope can be flagged. *(Capturing the assigned delineation = P1; gap/overlap detection = **P1.5**.)*

### 6.7 Consent
- **REQ-CON1 — Recording consent (legal), set at job creation — never a capture-time interstitial.** A jurisdiction-aware recording-consent state is recorded **once, at project creation/setup** (owner/office/solo-setup responsibility; defaulted per jurisdiction; strictest default when jurisdiction is unknown offline). **The capture path itself never shows a consent prompt** — the first tap on the record button records, always. `[trace: CON; critic C4; greenlight MF-7/F1 — the consent interstitial was the #1 predicted abandonment point]`
  - Accept: no audio capture on a job without a recorded consent state on the *project*; zero consent UI appears between the user's tap and recording starting.
- **REQ-CON2 — Cellular-upload consent (cost).** Uploading over cell requires an explicit cellular-consent setting; distinct from recording consent. `[trace: hadar; CON-2]`
  - Accept: cell upload occurs only with the setting on.

### 6.8 Setup (minimal for P1)
- **REQ-SET1 — Create a job.** A job exists with address/geofence/client so resolution and evidence have a home. `[trace: SET-2]` · Accept: a job can be created in the field or office in ≤ a few actions.
- **REQ-SET2 — First-run + permissions + language target.** Shortest path to mic/camera/location/consent + set target language. `[trace: SET-4; SET-1]` · Accept: a new user can reach first capture quickly with permissions/consent set.

### 6.9 Cross-cutting hands-free budget
- **REQ-X1 — End-to-end capture flow budget.** The clean-path **capture → confirm-saved → (auto-file)** flow completes within a stated max touches (target **≤2**: start, stop). The **clean-path send flow (capture → card → send) is budgeted at ≤3 deliberate touches** with voice-confirm read-back for numbers (closes critic-01 L1). `[trace: mandate #3; critic H3/L1; greenlight F5]`
  - Accept: measured gloved in the field/proxy test; clean capture path ≤2; clean send path ≤3.
- **REQ-X2 — P1 UI localization (greenlight MF-7).** All P1 user-facing strings — record button, save confirmations, pending/status reasons, failure states, consent/setup screens, the unresolved queue — ship **localized, Spanish minimum**, as static i18n. This is app-chrome localization, independent of (and not gated by) the P1.5 content-translation pipeline. `[trace: core design principle — the primary persona must be able to read the product; greenlight B3]`
  - Accept: a Spanish-preference user completes first-run, capture, save-confirm, and reads every status/failure message entirely in Spanish in P1.
- **REQ-X3 — One collapsed status per item (greenlight F4).** Every item surfaces exactly **one primary, plain-language status** (is it safe / is it done / does it need me); sync × resolution × counterparty states are detail beneath it, never three parallel badges. `[trace: REQ-PROC6; core principle]`
  - Accept: no item ever displays more than one primary status; underlying states reachable as detail.

### 6.10 Project management (P1 subset; full detail in `PM-LAYER.md`)
Projects are the container captures file into. P1 needs them to exist, be found, and attribute captures; the company feed, roles-based visibility, and cross-company sub-sharing are P1.5 (they layer on membership/permissions).
- **REQ-PM-A — Create/manage projects (field + office).** A project (name + address → geofence, description, client, status) can be **quick-created in the field** and **edited/merged/archived by the office**. `[trace: PM-1/2; hadar]`
  - Accept: field creates in a few actions, immediately usable; office can edit/archive without losing history; status = **Active | Archived**.
- **REQ-PM-B — Find projects: list, search, nearby.** Projects list (filter Active/Archived, sort by recency); search by name/address/client; **nearby projects** surfaced by GPS as the browse counterpart to auto-resolution. `[trace: PM-3/4/5; hadar]`
  - Accept: at a site, nearby project(s) surface for one-tap pick; search returns matches quickly; list filters/sorts.
- **REQ-PM-C — Authorship on every item.** Every capture/disposition records **who took it** (person + org + role); a subcontractor's contribution is attributed as a **labeled author** (cross-company sharing is a later seam). `[trace: PM-7/12; hadar — Option C]`
  - Accept: author + org shown on every item; data model carries org from day one so real cross-company sharing can drop in.
- **REQ-PM-D — Roles & feed (P1.5 seam).** Role model — **Office/Owner** sees the company-wide **feed** and manages; **Field** sees their own projects. **The feed is rendered from local-synced data** (a local query over dispositions the user is already entitled to; office web renders from its own pulled working set) — **never** from Supabase Realtime `postgres_changes`, which leaks DELETE events and collapses at ~100–300 companies. *(Corrected 2026-07-16 per Codex #6 H12: was "PowerSync-synced local data / PowerSync JS SDK" — PowerSync is deferred/reopened per ADR-2, so the feed is described as local-synced, engine-agnostic; if a PowerSync bakeoff wins, it becomes the local query engine.)* `[trace: PM-6/8/13; hadar; greenlight MF-3 — security+scale convergent finding]`
  - Accept (P1.5): feed shows cross-project activity scoped by role, rendered from local synced data; works offline; no `postgres_changes` subscription exists anywhere in the product.
- **REQ-PM-E — Collaborators / cross-company (P1.5 seam; author+org is P1).** Invite another company to a **project** via a link; they accept by login or **free** sign-up; contribute (capture/comment) attributed to their company; **project-scoped** access; end anytime while the **host keeps their content**; reinvite. Composes with the language layer (each company in its own language, English-canonical). Full detail in `PM-LAYER.md`. `[trace: hadar collaborator; Option-C seam; LANGUAGE-LAYER]`
  - Accept (P1.5): a free new company accepts a project invite, contributes attributed to its org, sees only that project, and its content persists after the collaboration ends. *(The author+org data-model seam ships in P1 so this needs no rewrite.)*

---

## 7. Handler model & seams (P1.5 / P2 — architect, don't build yet)

The handler layer consumes a processed Capture and produces a typed **Disposition**. All handlers share: the confirm-don't-automate rule, the Approval Spectrum mechanism, and the no-login counterparty link. Each P1.5 handler has an **entry gate** (the relevant AI spike must pass first). **A disposition can also derive from another disposition** (a walkthrough Report → a Checklist; a Decision → a Change Order) — a first-class relation, not a copy. `[trace: companycam-ai-features-analysis §6]`

### 7.1 Approval (signature-grade) — P1.5 · gate: U6
Escalates the validation loop to a **digital-signature** approval on the owner's device — **approval = a digital signature** (a binding, verifiable sign-off), distinct from the unsigned verify/confirm step. **Identity binding (resolves critic C2):** a signature requires **SMS OTP to the number the contractor entered + typed legal name + timestamp + a hash of `shown_content`**. The light **confirm/acknowledge (P1, REQ-VAL3) carries no identity**; a **signature (P1.5) requires this identity binding** — the two words are kept distinct. Effect of the identity step on approval rate is measured in U6. Seam: `Disposition{type: approval, digital_signature, identity_signal, shown_content, timestamp}`. Builds on REQ-VAL3.

**The binding artifact = what the signer actually saw (fixes critic C1/M4).** At signing, the **exact rendered text the counterparty saw** (in *their* language) is **frozen into `shown_content` as an immutable snapshot** and is the **legally binding instrument for that act** — it is *exempt from translation-cache invalidation*, so a later content-version bump never mutates a signed record. The **English canonical is an internal working/index copy, not "the legal record"**; the **retained original native + audio corroborates**. One authoritative artifact per signature — no three-way ambiguity. *(A binding signature also requires the identity mechanism — see the confirm-vs-signature split, critic C2, a hadar decision.)*

**Decision-approval sub-flow** (the enriched decision path): a Decision (REQ-VAL5) flagged **requires-owner-approval** → the owner is **notified** → approves digitally on a **Page (pictures + text)** rendering of the decision → a **verified, timestamped record** is stored → the **instigator is notified** of the outcome (approved/declined). Notifications fire to both the owner (request) and the instigator (result). `[trace: hadar decision-approval flow]`

### 7.1a Notifications (seam) — P1.5
A notification layer delivers: **approval requested** (→ owner), **approval result** (→ instigator), and **@mention/assignment** (→ member). Channels (push/SMS/email) settled later. `[trace: hadar "note sent to instigator / notification sent to owner"; UC-P8-5; companycam @mention]`

### 7.2 Change Order — P1.5 · gate: U4, U3, U5, U8
Voice/text → **scope + line items + price + who-directed + reference to original estimate** → confirm numbers (pre-confirm error + catch-rate, not tautological 100%) → priced approval on owner's device → immutable CO record. Includes the **mini change order** (fast-path one-tap "proceed" to keep the job moving — COMM-3, escalatable to full CO), **T&M/CCD "proceed, NTE $X"** (CO-3), and **cumulative ledger vs. original** (CO-5). *This is the entire prior `SPEC-v1-change-order-wedge` — it lives here now, gated.* `[trace: CO-1/2/3/5; prior spec; COMMUNICATION-LAYER §4]`

### 7.3 Report — P1.5 · gate: none hard (reuses processed captures)
Roll captures up: the **AI walkthrough note** (walk+talk+snap → sectioned document, REP-6), **status ledger** (Approved/Pending/Declined + running total, REP-1), **client progress update** (REP-2), **back-office daily digest** (REP-3), **dispute-bundle export** (EVID-3). Compiles along the **timeline** (REQ-TL1/2/4) so images land at the right moment; **pause/resume forces a section break** (REP-7 → timeline markers REQ-TL3). Export tail: PDF / web link, translate, table of contents, **save-as-template** (REP-8). *(Parities CompanyCam AI Walkthrough Notes — now table stakes; see `companycam-ai-features-analysis.md`.)*

### 7.4 Checklist / Tasks — P1.5 · gate: light (voice→field matching)
A first-class handler with its own lifecycle: **create by voice**, auto-sectioned (CHK-1); **assign to members** (CHK-2, ties to PM roles); **complete by voice + photo proof**, honoring negation ("we did *not* skim the pool yet", CHK-3); and **derive a checklist from a walkthrough note** (CHK-4). Overlaps punch-list (EXP-1). *(Parities CompanyCam AI Checklists.)* `[trace: companycam-ai-features-analysis §2]`

### 7.5 P2 expansion (same spine)
Daily/weekly logs (REP-4/5), punch list (EXP-1), inspection (EXP-2), safety/incident (EXP-3), RFI (EXP-4), T&M/materials (EXP-5, after alphanumeric hardening), voice retrieval (EXP-6), client gallery (EXP-7).

### 7.6 Communication & routing (cross-cutting seam — P1.5; full detail in `COMMUNICATION-LAYER.md`)
The layer that **moves decisions between parties so the job keeps moving**: route a disposition to the right party by **type + intent** (verify vs. approve), deliver **off-site, in the recipient's language** (no-login link + notification), show the field **live status** (pending/approved/declined), and record every exchange. The **light verification loop is P1** (validation loop §6.6); routing, the **mini change order**, in-language delivery, and status are **P1.5**; report cadence + RFI routing are **P2**. This is where capture + language + handlers + approval + notifications + collaborators compose into the product's purpose. `[trace: hadar communication layer]`

---

## 8. Data model (updated for capture core + timeline + handlers)

- **Project** *(was "Job")* — id, name, description, address/GPS + geofence, client ref, owner/tenant, **status** (active/archived), recording_consent_state, member_ids[]. *(No `target_language` — killed with the "modular target" model; display language is per-user via `Member.preferred_language`; canonical is always English. — fixes critic M7.)*
- **Member** — id, user, **org** (own-company or sub), **role** (office_owner / field / sub-labeled), **preferred_language** (display language, set at profile setup; default English), project_ids[]. *(Org carried from day one so cross-company sharing is a later seam, not a rewrite.)*
- **Translatable content** (any record: Capture transcript, Disposition payload, Decision value, Report/Page, checklist item) carries: **canonical_en** (English source of truth + the search index), **original_text + source_language** (immutable ground truth), **translations{lang → {text, translated_at, source_version}}** (the cache), and **content_version** (bumped on change → invalidates stale cached translations). See `LANGUAGE-LAYER.md`.
- **Feed** — a query/view over dispositions across projects, **scoped by role** (office = company-wide; field = own projects). Not a new store.
- **Capture** — id, project_id + **resolution_status** (resolved/unresolved/overridden) + confidence, **author{user, org, role}**, **evidence_stamp{gps, captured_at}**, **modality** (voice/video/photo/text), **timeline_id** (if part of a recording), durable_local_uri (encrypted), remote_uri, **processing_state** (captured/queued/uploaded/processed), source_language + confidence, source_transcript. Immutable original; never dropped even when unresolved.
- **Timeline** — id, root_capture_id (the recording), duration.
- **TimelineMarker** — id, timeline_id, offset, type (user_mark / auto_keyframe / photo_anchor), media_ref.
- **MediaAsset** — id, capture_id/timeline_id, kind (**audio / photo / keyframe / raw_video_temp**), uri, stamp. *(`raw_video_temp` is an **encrypted, journaled temporary** asset — never uploaded, and deleted via recoverable cleanup once the derived audio+keyframes are finalized, verified, and registered. It exists so a crash mid-video is recoverable per REQ-CAP6/REQ-TL4 — fixes Codex #6 C6.)*
- **Disposition** (the handler output) — id, capture_ids[], **type** (evidence / validation / approval / change_order / report / **checklist_task**), **author{user, org, role}**, **derived_from** (optional disposition_id — e.g., checklist derived from a report), payload (typed per handler; for checklist_task: sections[], items[{text, assignee, done, proof_capture_ids[]}]), status, counterparty_action{timestamp, identity_signal, shown_content}, export_uri. *Evidence is the implicit default disposition of every capture; the others are added.*
- **Decision** (payload of a validation/decision disposition) — subject, **current_value**, **value_history[{value, at, by}]** (superseded values retained), **scope_level** (project / party), **actionable** (bool) + **assignee** (party/worker responsible), aggregated_capture_ids[] (photos anchor *to the decision*), ai_tags[], requires_approval, approval_disposition_id, instigator. Latest supersedes; history immutable.
- **ProjectParty** — project_id × company/member, **trade** (their trade on this project — e.g. electrical/mechanical; **renamed from `role` to disambiguate** from `Member.role` = office/field/sub, fixes critic M6), **scope_of_work** (their responsibilities on this project, captured on invite), status. Enables per-party scope review + gap/overlap detection (REQ-VAL7).
- **Notification** — to_user, event (approval_requested / approval_result / mention_assignment), ref (disposition/decision id), timestamp, channel, read_state.
- **Page** — a rich **pictures + text** presentation of a disposition (used by Report, Decision, Approval); what the owner sees when approving.
- **Resolution** — capture_id → candidate **existing** projects + scores, and/or a **new-project proposal** (pre-filled fields extracted from the recording), chosen result, method (gps_auto / content_detected / secondary / override / new_created). Signals: GPS/geofence (at capture) + content/transcript (on processing).
- **Consent** — job/user scope, kind (recording / cellular), state, basis.
- **Erasure/tombstone** (resolves critic C3) — a valid erasure request **hard-deletes content + media** and retains `{hash, metadata_stub, erased_at, basis}`; the immutability/never-destroy rules yield to this **one carve-out**. Applies to captures, versioned-decision history, evidence bundles, and third-party audio.
- **ProcessingJob** — capture_id, steps[], state, **blocked_reason** (needs_wifi / needs_cell_consent / needs_connection / none), resumable. The blocked_reason drives the human-readable pending status (REQ-PROC6).

Seam integrity: adding CO/Report/Approval = adding `Disposition.type`s + handler logic; no capture/timeline schema change. `[trace: architected-for-broad]`

---

## 9. The de-risk build plan (P1), revised

Cheapest-foundational-first; each milestone is a thin slice that runs; no milestone done until its gate passes.

| M | Milestone | Kills/measures | Gate |
|---|---|---|---|
| **M0** | Foundation spike (**"Spike A" — full task-level plan in `SPIKE-A-BUILD-PLAN.md`**): locked stack **RN+Expo + encrypted SQLite + owned queue + Supabase raw Postgres + Edge Functions/Hono**; prove durable local voice capture + one sync round-trip under a fault-injection suite on a real device. | stack/backend fit + **U1 durability** | Fault suite (kill/airplane/disk-full/mid-sync) → **zero loss with an honest residual bound**; one capture round-trips offline→online→back, no loss/dup; encrypted at rest on iOS+Android. |
| **M1** | Capture primitive: voice+text+photo+video, offline, encrypted, pre-roll, audible+visual confirm, crash/fault recovery. | U1 | Fault-injection suite (incl. mid-video, disk-full, power-loss, kill) → no loss, honest residual bound. |
| **M2** | Timeline & media sync: recording timeline, photo-anchoring, user marks, video→audio+keyframes. | U-TL | A recorded session reconstructs images/marks at correct offsets; video yields transcript + keyframes. |
| **M3** | Project resolution layer + secondary unresolved queue. | U-RES | Mis-attach ≤5%, ≥85% auto-resolved; 0 unresolved lost. |
| **M4** | Connection-aware pipeline: upload gating (Wi-Fi/cell-consent), process-on-reconnect, transcription + source retention + language detect. | U-SYNC | 100 offline/online cycles + mid-sync kill → no loss/dup; consent gating correct. |
| **M5** | Evidence surfacing + retrieval + the **validation loop** (decision-of-record, sub↔GC directive, no-login confirm to counterparty device). | core-loop value | A captured decision → decision card → counterparty confirms on their device; retrievable by job. |
| **M6** | **Field/proxy test of the P1 core loop**: gloved, offline, real jobsite audio; fill the P1 exit numbers; run the cross-model Codex critic on this spec. | all P1 | Each P1 unknown marked validated/mixed/killed with a number. |

**Then P1.5 begins** (outside this build): run the AI spikes (U4/U3/U5/U6/U8) as the CO/Approval **entry gate**; if they pass, build the handlers per §7.

---

## 10. Verification, hard parts, risks (deltas from companions)

- **Verification** — `VERIFICATION_PLAN.md` governs; the exit table now leads with **U1, U-TL, U-RES, U-SYNC** (P1) and treats **U3/U4/U5/U6/U8** as the **P1.5 entry gate**. Criteria 1–8 apply unchanged. Cross-model Codex critic runs on this spec at M6 start (it's a spec — no reason to wait longer).
- **Hard parts (added)** — *Timeline sync:* anchor media by offset within one recording; fallback = wall-clock timestamps if offset capture fails. *Video durability:* chunked resumable writes; fallback = cap length + verify-saved. *Process-on-reconnect latency:* structure follows on connection; fallback = show "processing when connected" state, never imply instant. Others carry over from the prior spec's §8.
- **Risks** — full ledger in `IMPLEMENTATION_NOTES §3`. Top P1 risks: video durability, resolution accuracy indoors, lossless resumable sync, and the timeline model actually producing compilable reports (U-TL is the newest untested assumption).

---

## 11. Open decisions (gate P1.5, not P1)
1. **Pricing ownership** — foreman on site / office after / both (CO handler). *Still #1.*
2. **Who captures** — field team only, or owner/back-office too.
3. **Residential vs. sub-to-GC emphasis** — EVID-2 implies sub↔GC is in v1; confirm ICP weight.
4. **First integration target** — QuickBooks / Jobber / CompanyCam / none.
5. **Position vs. CompanyCam/Jobber** — alongside (integrate) or replace.

None of these block P1. They're the first things to answer when P1.5 starts.

---

## Appendix — traceability
Every P1 `REQ` traces to a master use-case ID (`MASTER-USE-CASES.md`), the core concept (`CORE-CONCEPT.md`), or a logged decision (`IMPLEMENTATION_NOTES §2`). Nothing invented; thin evidence is a measured unknown, not an assertion.
