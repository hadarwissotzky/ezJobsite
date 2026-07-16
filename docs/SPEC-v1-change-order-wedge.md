# Hilo v1 — De-Risk Specification: The Priced Verbal Change-Order Wedge

> ⚠️ **SUPERSEDED (2026-07-15) by `SPEC-capture-core-v1.md`.** This document is now the **P1.5 Change Order handler** within the capture-core structure — its requirements are correct and still apply, but the *lead* is now Capture + Evidence, not the change order. Read `SPEC-capture-core-v1.md` first; keep this for the Change Order handler detail.

*Functional specification + de-risk build plan. Phase goal: prove the hard parts are solvable — cheapest-experiment-first — before committing to a full MVP. Companion files: `CLAUDE.md` (operating contract), `VERIFICATION_PLAN.md` (criteria + exit numbers), `IMPLEMENTATION_NOTES.md` (living risk ledger). **Version 0.3 — 2026-07-14** (revised after an adversarial critic pass, then for the user's offline-forward + multimodal + project-resolution requirements; see `IMPLEMENTATION_NOTES §4`). Author: Claude, with hadar.*

---

## 0. What this document is (and is not)

**Is:** the *what* of v1 and the *plan to de-risk it* — a small, traceable, testable functional spec plus a stepwise experiment-and-build plan that runs the cheapest product-killing experiments first.

**Is not:** the UX specification (the hands-free interaction model — big-button vs. wake-word vs. headset — is deferred), the deep technical/architecture specification, or deployment. Those are the next three phases. **Exception forced by the critic:** the *minimal* framework + backend choice is made inside this phase (as a small foundation spike) because the de-risk slice literally cannot run without it — see §7 Phase 1.

**Reading order for a builder:** `CLAUDE.md` → this file → `VERIFICATION_PLAN.md`, keeping `IMPLEMENTATION_NOTES.md` open the whole time.

---

## 1. The product in one paragraph

A crew member on a jobsite has a decision happen in front of them — the homeowner says "yeah, tile the guest bath to the ceiling, add two coats," or a rotted joist appears that must be replaced. Today that decision is spoken, in whatever language the crew speaks, and then it evaporates: reconstructed weeks later from memory and texts, disputed, or done for free. **Hilo captures the decision moment the instant it happens** — the crew talks (or types; photo/video are post-de-risk) — and turns it into a **structured change order with a scope, a price, and a named person who directed it**, in the language the office and client read, which the client can **approve before the work is done**. The captured raw moment (audio + source-language transcript) is kept as dispute-proof evidence under a defined retention policy. The moat is not "we have voice" — it's the transformation from *spoken moment* to *priced, approvable, routed transaction*, plus per-crew adaptation and modular language, which incumbents don't do.

---

## 2. Users & context of use

| | |
|---|---|
| **Primary user (captures)** | A field crew member / foreman on a residential jobsite — drywall, roofing, painting, remodeling. Often Spanish- or Spanglish-speaking. Hands full, gloved, on a ladder, in equipment noise, weak or no signal. `[trace: voice-first-research Area 5; project-memory ICP]` |
| **Buyer** | The small residential GC / sub owner. Pays. Cares about getting paid and winning disputes. Not the homeowner. `[trace: user-research-plan]` |
| **Counterparty (approves)** | The homeowner/owner. Receives an approval request, approves or declines. Not Hilo's buyer. `[trace: user-research-plan]` |
| **Back office (routes to)** | Whoever bills — often the owner/admin, using QuickBooks/Jobber/CompanyCam. `[trace: project-memory]` |
| **Environmental constraints** | Gloves; one or no free hands; ladder/height; loud; sun glare; dust/water; weak/no connectivity. Hard design constraints, not edge cases. `[trace: user request; app-store-reviews offline pain]` |

---

## 3. Scope

**Paramount principle: offline-forward.** The system assumes weak or no signal by default. **All four capture modalities — text, voice, image, video — must work fully using the device's internal capabilities with no connectivity**, and only reach for the network opportunistically. Reception is never a precondition for capturing or safely storing a decision. `[trace: user requirement — offline-forward first; mandate #1/#7]`

### 3.1 In scope for the de-risk phase
A single path, proven cheapest-first then built thin but complete: **capture a change order (voice/text, with image/video as attached evidence) → resolve it to a project → structure it → confirm the price/fields → send it for client approval before work → produce a defensible record → sync when online.** Multimodal offline capture, GPS/time evidence stamping, the project-resolution layer, and modular auto-detect-language → selected-target translation are all in scope because each is a core requirement or unknown.

### 3.2 Deferred to post-de-risk build (architect the seams, don't build)
The **AI structuring/language pipeline is de-risked on voice + text only** (image/video are captured, stamped, and attached as evidence this phase, but not AI-parsed into CO fields yet). Also deferred: general jobsite-decision capture beyond COs, daily logs, client-update messaging, punch lists/inspections, cross-job voice retrieval, per-crew personalization at scale, and (far later, Phase 2) glove-friendly one-click hardware. The data model must let these drop in without a rewrite. `[trace: user requirement (capture is multimodal now); critic H4 (AI focus stays voice/text); voice-first Area 4; project-memory Phase 2]`

### 3.3 Out of scope / DO NOT BUILD
Full CRM, scheduling, invoicing/payments, a full estimating suite, heavyweight e-signature document flows, wearable/headset dependencies, any general messaging app. All-in-one is a race to the bottom vs. QuoteIQ/Jobber; integrate for billing, don't rebuild it. `[trace: project-memory "do not build"; competitive-analysis]`

---

## 4. The hard unknowns this phase must kill

Each maps to a measured exit criterion in `VERIFICATION_PLAN §C`. Ordered by *cheapest to learn*, not by build order.

| U | Unknown | Cheapest instrument |
|---|---|---|
| **U4** | Can a spoken moment become accurate structured CO fields (scope, price, who-directed, quantities)? | Laptop Wizard-of-Oz on recorded audio — no app. |
| **U5** | Is voice faster than typing *after* correction time? | Same WoZ session, timed. |
| **U3** | Is multilingual (Spanish/Spanglish incl. numbers) capture feasible with a human in the loop? | Run candidate ASR on gathered Spanglish audio — no app. |
| **U6** | Will a client approve before work, and does it feel real/fair? Does adding identity kill the approval rate? | Clickable prototype + tokenized link to real homeowners — no app. |
| **U8** | Does translated *scope* preserve meaning well enough to approve on? | Back-translation / bilingual rating on the gold-set — no app. |
| **U1** | Can we capture and *never lose* a note, offline, across crashes/faults? | Native fault-injection harness — needs app code. |
| **U7** | Can the priced CO be produced & sent **on-site under weak/no signal** (on-device), or only with connectivity? | Native measurement on the slice. |

The plan (§7) runs U4/U5/U3/U6/U8 with **no app code** first; only if they survive do we build native code for U1/U7.

---

## 5. Functional requirements

*Format: `REQ-x##`. `Accept:` measurable pass condition. `[trace: …]`. `Touch budget:` max deliberate physical interactions. "Confirm" = an explicit human action (tap or voice).*

### 5.1 Capture (multimodal, offline-forward, hands-free, never-lose-it)

- **REQ-C1 — One-action start.** From foreground, starting an audio capture takes **one deliberate action** on a large primary control; text is at most one action deeper.
  - Accept: audio capture begins in ≤1 action; operable with a gloved thumb (validated in field/proxy test). Touch budget: **1 to start, 1 to stop.** `[trace: hands-free; app-store "too many clicks"]`
- **REQ-C2 — Four input modalities into one primitive, all offline-internal.** Capture accepts **text, voice, image, and video**, each using the device's internal capabilities and each producing the same Capture object. All four work with no connectivity. (AI structuring in this phase parses voice/text; image/video are stamped evidence — see §3.2.) `[trace: user requirement — 4 modalities, offline-forward]`
  - Accept: in airplane mode, each of the four modalities captures, durably saves, and confirms; each creates a Capture with an identical metadata envelope; video uses chunked durable writes (hardest never-lose-it case, see U1).
- **REQ-C3 — Local-first durable write.** Every capture streams to durable on-device storage **as it is captured**, before any network call. Storage is encrypted at rest. `[trace: mandate #1; critic M5]`
  - Accept: passes the fault-injection suite in `VERIFICATION §C/U1` (memory-pressure, disk-full, power-loss, corruption, force-kill) with the stated residual bound.
- **REQ-C4 — Explicit save confirmation (audible + visual).** On save, success is confirmed **both** on-screen and audibly/haptically; failure is loud, never silent.
  - Accept: every successful save emits a visible "saved locally ✓" + distinct sound/haptic; every failure is surfaced non-silently. `[trace: app-store "confirm it saved"]`
- **REQ-C5 — Recovery of orphaned captures.** After a crash/kill/disk-full, an in-progress capture is detected on relaunch and surfaced to keep or discard.
  - Accept: interrupt mid-capture → relaunch → partial capture listed and playable. `[trace: edge cases §1]`
- **REQ-C6 — Capture works fully offline.** No capture step requires connectivity.
  - Accept: in airplane mode, both modalities capture, save, and confirm; only the sync state differs. `[trace: mandate #7]`
- **REQ-C7 — No manual filing at capture time.** The user never has to pick a project while capturing; assignment is done by the Project Resolution layer (REQ-P1/P2), with a one-action override available.
  - Accept: capture completes with **0 filing actions** in the common case; override is 1 action. `[trace: companycam auto-sort; user requirement; critic M6]`
- **REQ-C8 — Capture-time recording consent.** Before/at first capture on a job, the app records that the required consent for audio recording exists, in a **jurisdiction-aware** way (all-party-consent states differ).
  - Accept: no audio capture proceeds on a job without a consent state recorded; the consent basis is stored on the record. `[trace: critic C4 — two-party consent]`
- **REQ-C9 — GPS + time evidence stamp on media.** Every voice, image, and video capture is stamped with **GPS location and capture time**, bound to the media as tamper-evident evidence metadata (and retained with the record).
  - Accept: each media capture carries GPS + timestamp; the stamp is present on export and survives sync; missing GPS (indoors) is recorded as "unavailable," never silently blank. `[trace: user requirement; companycam/timemark "timestamp+GPS = dispute armor"]`

### 5.2 Project resolution layer (auto-assign each capture to a project)

*A distinct layer between capture and structuring. It takes the input content + context and resolves which project it belongs to, with zero manual filing — and a secondary workflow when it can't.* `[trace: user requirement — "project resolution is a layer"; companycam auto-sort]`

- **REQ-P1 — Automatic resolution.** The layer assigns each capture to a project using **GPS/geofence (primary) + capture time + context** (last-used job, recent captures on that site, address match), without the user choosing.
  - Accept: **mis-attach rate ≤5%** and **≥85% auto-resolved without prompting** on the field/proxy test; both rates recorded. `[trace: critic M6 — measurable, not "common case"]`
- **REQ-P2 — Secondary workflow on ambiguity or no match.** When confidence is low, **multiple** candidate projects match, or **no** project matches, the capture is held in a durable **"unresolved"** state and routed to a secondary resolution workflow (the disambiguation UX itself is specified in the UX phase); it is resolvable in ≤1 action.
  - Accept: ambiguous/no-match captures are **never lost or silently mis-filed** — they persist as "unresolved," appear in a review queue, and resolve in ≤1 action; a capture is never blocked from being *taken* because resolution is uncertain. `[trace: user requirement — secondary workflow; mandate #1 never-lose-it]`

### 5.3 Structuring (voice → structured priced change order)

- **REQ-S1 — Extract CO fields.** From an audio/text capture, produce a draft CO: **scope description, quantities/units, price (or T&M flag), who directed it, job/reference.** `[trace: change-order-synthesis; voice-first Area 3]`
  - Accept: on the gold-set (§7 Gold-set milestone), per-field thresholds in `VERIFICATION §C/U4` — scope by blind rubric rating, categoricals by exact match, numerics by pre-confirmation error rate.
- **REQ-S2 — Numbers are candidate-until-confirmed.** Price, quantities, measurements, model numbers are extracted as **candidates**, shown large, read back, and editable; nothing priced sends without each numeric field confirmed. `[trace: mandate #6]`
  - Accept: no priced CO sends with an unconfirmed numeric field; the phase measures **pre-confirmation numeric error rate** and **confirmation-catch rate** (see U4) — not a tautological post-confirmation 100%. `[trace: critic C3]`
- **REQ-S3 — Draft, not truth.** Structured output is always an **editable draft** over the raw capture, one tap from the source.
  - Accept: every field is tap-editable pre-confirmation; raw capture always reachable. `[trace: mandate #2]`
- **REQ-S4 — "Who directed it" is explicit.** The directing party is a confirmed field, defaulted from context, never silently inferred from audio.
  - Accept: present, defaulted, user-settable on every CO. `[trace: multi-speaker misattribution; substantiation pain #1]`

### 5.4 Language (modular: auto-detect → selected target)

- **REQ-L1 — Auto-detect spoken language, with a threshold and a low-confidence path.** The system detects the spoken language automatically; the user does not pre-declare it.
  - Accept: detection accuracy **≥95%** on the configured languages on the test set; below a confidence threshold, the record is flagged for human confirmation rather than silently translated. `[trace: user requirement; critic M2]`
- **REQ-L2 — User-selected, swappable target.** The translation target is a user/tenant setting; the module can add a target language via config/model change, not a pipeline rewrite.
  - Accept: changing the target changes emitted-record language; adding a target is not a code rewrite. `[trace: user requirement — modular]`
- **REQ-L3 — Keep the source, under a retention policy.** Every record retains **raw source audio + source-language transcript** alongside the translated output, retained **per a defined, legally-bounded retention/erasure policy** (not literally "forever").
  - Accept: source audio + transcript retrievable on every translated record for the policy window; an erasure path exists. `[trace: mandate #5; critic C4 retention]`
- **REQ-L4 — Target meaning; confirm numbers; gate scope fidelity.** Emit fluent target-language output (not verbatim code-switch); numbers pass mandatory confirmation in any language; **translated scope must pass a fidelity check before it becomes approvable.**
  - Accept: numeric confirmation enforced across languages; translated scope passes a back-translation or read-back fidelity check (U8) before send. `[trace: voice-first Area 5; critic H5]`

### 5.5 Confirmation & approval

- **REQ-A1 — Mandatory pre-send confirmation, within the touch budget.** A CO passes one glanceable confirm screen — **scope + price + who directed it** — requiring one explicit confirm before sending.
  - Accept: no send path bypasses it. The **end-to-end capture→confirm→send flow has a stated total touch budget** (see §5.7). `[trace: mandate #2; critic H3]`
- **REQ-A2 — Send for client approval before work, with a defined identity signal.** The confirmed CO is sent as an approval request with the **price visible**, approvable with minimal friction, but backed by a **defined identity signal** (e.g., SMS OTP to the number the contractor entered, or typed-name + timestamp + device), not an anonymous open link.
  - Accept: a client approves/declines with the price shown first; the identity mechanism is recorded; the friction-vs-identity trade-off is measured in U6 (does adding identity reduce the approval rate?). `[trace: companycam wedge; jobber gap; critic H2]`
- **REQ-A3 — Timestamped, defensible approval record.** Approval/decline is recorded with timestamp, the identity signal (REQ-A2), the exact scope+price shown, and the underlying capture — exportable as a single record containing all of these fields.
  - Accept: an approved CO exports to one record containing {scope, price, who-directed, timestamps, identity signal, approval event, links to raw evidence}. `[trace: change-order-synthesis "signature before work"; critic L1 — concrete field list, not the adjective]`
- **REQ-A4 — No silent "at-risk" proceed.** UI state clearly distinguishes draft / sent / approved / declined; the product never implies work may proceed pre-approval.
  - Accept: state is explicit and visible on every CO. `[trace: verbal-CO trap; edge case contract-void]`

### 5.6 Record, routing, sync (thin for de-risk)

- **REQ-R1 — Exportable defensible record.** Any CO exports as a clean, shareable record (PDF/link) containing the REQ-A3 field list; excludes unnecessary client PII by default.
  - Accept: export produces the REQ-A3 artifact; no client PII beyond what's needed appears by default. `[trace: change-order-synthesis PII note; timemark export need]`
- **REQ-R2 — Route to back office.** An approved CO is available to the back office (in-app list + an integration **seam**, stubbed not built in this phase).
  - Accept: back-office view shows approved COs + evidence; QuickBooks/Jobber integration is a stub. `[trace: companycam field→office]`
- **REQ-Y1 — Offline-first, conflict-safe sync with visible state.** Captures/COs sync opportunistically when connected; each shows saved-locally vs. synced; sync is conflict-safe.
  - Accept: create offline → reconnect → syncs and flips to "synced ✓"; **no loss or duplication across 100 offline/online cycles** including a mid-sync kill. `[trace: mandate #7; offline pain]`

### 5.7 Cross-cutting: the end-to-end hands-free budget

- **REQ-X1 — Total flow touch budget.** The complete **capture → structure → confirm → send** flow for a clean CO (no corrections needed) must complete within a **stated maximum number of deliberate touches** (target: **≤3** — start, confirm, send), with numeric read-back offered by **audio + voice-confirm** so the money moment isn't a tap-fest on a ladder; a hard tap is required only on a detected mismatch.
  - Accept: measured in the field/proxy test with gloves; clean-path flow ≤ the stated budget; the criterion in `VERIFICATION §A#3` applies to this flow, not just capture. `[trace: mandate #3; critic H3]`

---

## 6. Data model sketch (architected-for-broad)

Atomic unit = **Capture** (a raw moment); a **ChangeOrder** is one *structured interpretation* of one or more captures. Separating them is what lets daily logs, punch lists, and retrieval slot in later without a rewrite. `[trace: project-memory "the decision moment is the atomic unit"]`

- **Job** — id, name, address/GPS + geofence, client ref, owner/tenant, **consent_state**.
- **Capture** — id, **job_id + resolution_status** (resolved/unresolved/overridden) **+ resolution_confidence**, author, **evidence_stamp {gps, captured_at}**, **modality** (text/voice/image/video), durable_local_uri (encrypted), remote_uri, sync_state, **source_language (detected + confidence)**, source_transcript, retained per retention policy. *(Unresolved captures are valid, durable records — never dropped.)*
- **ChangeOrder** — id, job_id, source_capture_ids[], scope_text (target lang) + **scope_fidelity_check**, line_items[{desc, qty, unit, price, T&M?}], total, **directed_by**, **target_language**, status (draft/confirmed/sent/approved/declined), confirmation events, **approval event {timestamp, identity_signal, shown_scope, shown_price}**, export_uri.
- **Extraction** — Capture → candidate ChangeOrder fields, each with confidence + confirmed flag (numbers gated).
- **Resolution** — the layer's decision record: capture_id → candidate job(s) + scores + chosen job + method (auto/secondary/override). Keeps resolution auditable and improvable.
- Seams for later: `Capture.type` generalizes beyond CO; `DailyLog`/`PunchItem`/`ClientMessage` reuse Capture; image/video already first-class; per-crew adaptation attaches to author/tenant.

---

## 7. The de-risk plan (cheapest experiments first; each with a gate)

**No milestone is done until its gate passes** (`VERIFICATION_PLAN`). Phases 0 runs before any app code.

### Phase 0 — Feasibility spikes (no app code; days each)
| Step | Work | Kills/measures | Gate |
|---|---|---|---|
| **GOLD** | Assemble + annotate the evaluation **gold-set**: representative CO utterances in English + Spanish/Spanglish incl. numbers/units/who-directed; define the labeling rubric; recruit a **bilingual annotator**. | Prereq for U3/U4/U8 | A rubric-labeled set exists; annotator agreement measured. `[trace: critic C5]` |
| **SPIKE-1** | Wizard-of-Oz on a laptop: run off-the-shelf ASR + scripted LLM extraction over recorded English CO audio; time it vs. typing the same CO. | U4, U5 | Pre-confirmation field accuracy + confirmation-catch rate + net-of-correction time recorded vs. targets. |
| **SPIKE-2** | Run candidate ASR/translation over the Spanish/Spanglish gold audio incl. numbers; measure WER, detection, semantic agreement. | U3 | Numbers measured; Spanglish feasibility called validated/mixed/killed. |
| **SPIKE-3** | Clickable prototype (Figma/HTML) of the approval request; send tokenized links to **real homeowners** (scoped sample); A/B a minimal identity step. | U6, U8 (scope reviewed by owners) | Act-rate + "real/fair" + identity-vs-friction effect recorded on a stated sample size. |

**Phase 0 gate:** if U3/U4/U6 come back *killed*, stop or pivot **before** building the app. "Mixed" tells the slice what to fix.

### Phase 1 — Foundation decision spike (small; makes the minimal deferred decisions this phase needs)
Pick **Flutter vs. RN** and **backend** (candidate: **Supabase + PowerSync**; alt **Firebase**) via a throwaway spike that proves durable local audio write + a round-trip sync on the chosen stack. `[trace: critic C1 — M0 can't start without this]`
- Gate: a skeleton records+persists audio locally and syncs one record on the chosen stack.

### Phase 2 — Thin native slice (audio + text only)
| M | Milestone | Kills/measures | Gate |
|---|---|---|---|
| **M-A** | Multimodal offline capture (**text/voice/image/video** via internal device capabilities), GPS/time evidence stamp, audible+visual confirm, crash+fault recovery. Video = hardest durability case. | U1 | Fault-injection suite passes with stated residual bound, incl. mid-video-write kill. |
| **M-A2** | **Project Resolution layer**: auto-assign captures to projects; secondary workflow + durable "unresolved" queue on ambiguity/no-match. | resolution accuracy | Mis-attach ≤5%, ≥85% auto-resolved; unresolved captures never lost. |
| **M-B** | Integrate transcription + structuring (voice/text) → draft CO; numbers gated; measure pre-confirm error + catch rate. Decide+measure **on-device vs cloud** extraction. | U4, U7 | Extraction meets U4 on live path; U7 (on-site/offline producibility) answered. |
| **M-C** | Confirm screen → confirmed CO; enforce the end-to-end touch budget (REQ-X1). | U5, hands-free | Clean-path flow ≤ touch budget with gloves. |
| **M-D** | Client approval with defined identity signal; timestamped record; export. | U6 (live) | 1 external homeowner approves; export contains the REQ-A3 field list. |
| **M-E** | Modular language: detect→selected target; keep source under retention policy; scope-fidelity gate. | U3 (live), U8 | Detection ≥ threshold; scope-fidelity check enforced before send. |
| **M-F** | Offline-first conflict-safe sync (PowerSync/Firebase) with visible state; back-office list; integration seam stub. | U1 (sync) | 100 offline/online cycles incl. mid-sync kill → no loss/dup. |

### Phase 3 — Field test + close-out
Gloved operation in **real jobsite audio** (proxy only as a fallback), fill the `VERIFICATION §C` table with measured numbers, mark each unknown validated/mixed/killed. The **cross-model Codex critic runs on this spec at Phase 0 start** (it's a spec, not code — no reason to wait), not at the end. `[trace: critic M3]`

---

## 8. Hard-parts approach + fallback (criterion #7)

| Hard part | Approach | Fallback |
|---|---|---|
| **Never-lose-it capture** | Stream to encrypted durable storage during capture; recovery journal; visible sync state; fault-injection tested. | Cap capture length; block new capture until prior write confirmed; explicit "re-verify saved". |
| **Transcription in noise** | Push-to-talk close-mic; LLM post-processing over raw ASR; replay + tap/voice-correct. | Prompt quick re-record; audio always retained so nothing is lost even on a bad transcript. |
| **On-site producibility (U7)** | Decide on-device vs cloud extraction explicitly; if on-site offline approval is required, that's an on-device ML requirement. | If cloud-only: keep the capture on-site, produce/send the priced CO on reconnect; don't claim on-roof instant approval. `[trace: critic H1]` |
| **Multilingual + Spanglish + numbers** | Per-utterance detect; translate meaning; domain/number biasing; mandatory numeric confirmation; per-crew adaptation. | Detect-and-flag on low confidence; narrow supported targets; human confirms. |
| **Voice → structured priced CO** | Domain-tuned extraction, confidence per field, numbers gated, who-directed explicit. | Guided capture ("what changed? / how much? / who asked?") that still feels fast. |
| **Scope-translation fidelity** | Back-translation or crew read-back of the *translated* scope before it's approvable. | Show source + translation side by side; require explicit scope confirm on low fidelity. `[trace: critic H5]` |
| **Offline sync** | PowerSync (or Firestore) local-first, conflict-safe; visible state; chunked resumable media later. | Manual "sync now" + explicit conflict surfacing. |
| **Client approval reality + identity** | Minimal-friction approve with a defined identity signal (OTP/typed-name); price-first. | If identity kills approval rate, fall back to typed-name + stronger evidence capture. `[trace: critic H2]` |
| **Recording consent** | Jurisdiction-aware capture-time consent state on the job. | Default to all-party-consent behavior (explicit notice) where jurisdiction unknown. `[trace: critic C4]` |

---

## 9. Top risks (full ledger in `IMPLEMENTATION_NOTES §3`)
- **Biggest untested gap:** no study covers voice capture by trades crews in real jobsite noise — the field test *is* the evidence; all accuracy numbers are deployment-dependent until measured. A **proxy test may *kill* an unknown but not fully *validate* it** — validation needs real jobsite audio. `[trace: critic M4]`
- **Legal:** two-party recording consent and lawful retention/erasure of voice data — a real exposure, now covered by REQ-C8/REQ-L3 and tracked as known-unknowns.
- **Identity vs. friction:** a one-tap link that anyone can tap isn't dispute-proof; the identity signal must be defined and its effect on approval rate measured.
- **Adoption/WTP unproven on the contractor side**; homeowner research validates only the approval half. Recruit ≥1 contractor; U6 sample size stated, not implied.
- **Device loss** is the boundary on "never lose it": an unsynced capture on a lost/dead phone is gone and is a data breach — mitigated by encryption-at-rest + days-unsynced nag, stated honestly.
- **Backend fit:** Supabase+PowerSync (or Firebase) must be validated for media blobs + conflict-safe sync in Phase 1 before locking.
- **Gold-set creation** is a first-class cost (bilingual annotation), not a free input.

---

## 10. Open decisions to confirm
1. **Field-test access** — friendly contractor/jobsite, or proxy-first? (Default: proxy can *kill* early; real audio required to *validate*; recruit ≥1 contractor in parallel.)
2. **Backend** — **Supabase + PowerSync** (recommended) vs. **Firebase** (fast alt); decided in Phase 1 after the media/offline validation. *(Xano dropped as primary per your note — see `IMPLEMENTATION_NOTES §2`.)*
3. **On-device vs cloud extraction (U7)** — determines whether on-site offline approval is real; decided at M-B with data.
4. **Naming/brand** — Hilo vs. Redline/Ticket/JobLog — decide before any client-facing surface (the approval request is client-facing). `[trace: project-memory naming]`
5. **Flutter vs. React Native** — decided in the Phase 1 spike.

---

## Appendix — Traceability note
Every `REQ` carries a `[trace: …]` to a Project research doc (`change-order-painpoints-synthesis`, `hilo-voice-first-research`, `appstore-reviews-analysis`, `companycam-love-and-wedge`, `hilo-competitive-analysis`, `hilo-user-research-plan`, `EZJobsite-project-memory`), a logged decision (`IMPLEMENTATION_NOTES §2`), or a reconciled critic finding (`IMPLEMENTATION_NOTES §4`). No requirement is invented; thin evidence is flagged as a measured unknown, not asserted.
