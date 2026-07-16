# Hilo — Core Concept: Why This Matters & the Capture Model

*The foundation everything else traces back to. Captured from hadar's framing on 2026-07-15. Items marked ✅ are as you described them; items marked ❓ are my interpretation or an open decision to verify. This supersedes the "change-order-first" framing of the earlier spec — the change order is now correctly one of three actions on top of a capture core.*

---

## 1. Why this application matters

Jobsite information is **ephemeral**. Conversations happen and observations are made by team members on the ground — and then they evaporate. Nothing durable is left: no proof for an inspector, nothing to hand the back office or the engineer, no record of what the homeowner agreed to, no substantiation for the money owed, no material for the progress report. The value that was created in that moment leaks away.

*(Naming: the product is **EZjobsite**, a jobsite-focused portfolio company of **Hilo** the venture group. "Hilo" = parent; product = EZjobsite.)*

**EZjobsite exists to capture that jobsite information the instant it happens and route it to where it creates value** — so a spoken decision, an observed condition, or a moment of work becomes evidence, an approval, a change order, or a report, instead of a memory that fades. `[✅ hadar]`

**The goal underneath it all — protection.** At its core the product exists to **protect contractors and subcontractors from the miscommunication and errors that cost them money and jobs**, by keeping every party aligned on what was decided, by whom, and when. And it must deliver that **even to a solo operator with no back office** — you don't need an office to get all the information and communicate it to your workers. The "office" is a role, never a requirement. `[✅ hadar — the core goal]`

**Who it's for — the core design principle.** This is built for people for whom **phones and software are not second nature**: people who collect information in the field, in their cars, in city offices, or while shopping for materials. **They have the information; the system does all the organization and backend work for them, so they don't have to.** The user talks or snaps; everything else — structuring, filing, translating, routing, approving — happens behind the scenes. Every design decision is measured against one test: *would someone who doesn't think in software succeed without being taught?* `[✅ hadar — a core requirement]`

---

## 2. The core: information capture

The atomic act is **a team member capturing information from the jobsite** — a *conversation* (what someone said) or an *observation* (what a team member saw). Everything else in the product is downstream of this one act. Get capture right — reliable, effortless, never-lost — and the rest is disposition. `[✅ hadar]`

---

## 3. The base layer + three actions

**Base layer — Evidence (the paper trail).** Every capture is, by default, durable timestamped evidence. It stands on its own for **future workflows** (e.g., an inspector's paper trail) and for **communicating to peers** (back office, engineers). This is the substrate; it's always on. `[✅ hadar]`

On top of that base, captured information can be put to **three actions**:

| # | Action | What it does | Who it's for | Output |
|---|---|---|---|---|
| 1 | **Approval** | A decision made on the ground becomes a **digital-signature** approval (approval *is* a digital signature — distinct from a lightweight verify/confirm). | Homeowners, project owners | A digitally-signed, timestamped authorization |
| 2 | **Change order** | A conversation with **monetary value** becomes a CO and is sent for approval. | Homeowner / project owner | A priced, approvable change order |
| 3 | **Report** | Captures are compiled into progress reports, daily/weekly logs, or walkthroughs. | The owner (communication) | A generated report/log |

*(So "3 ways" = these three actions; Evidence is the base every capture already is. One capture can feed more than one — e.g., a captured condition is evidence, and also material for the weekly report.)* `[✅ implicitly confirmed — hadar chose "Capture + Evidence first" as a handler distinct from Change Order; correct me if you meant four co-equal handlers]`

**Why this matters for the build:** the "architect for broad" seam in the earlier spec now has concrete names. Capture is the core; **Evidence, Approval, Change Order, Report are pluggable handlers** on top of it. We can prove the core + one handler first and add the others without re-architecting.

> **Named principle — append-only immutability (hadar, 2026-07-16).** **Media (audio/images) is immutable** — never edited or merged; it is the proof, retained so that if anyone tries to change what was said or shown, the original stands. The only thing that ever "merges" is the **derived text/decision record after transcription** (much simpler than merging media). And **once a record is digitally approved/signed, it is frozen and permanent** — it can never be edited in place **nor deleted**; a change is a **new record appended on top**, which carries its own approval. (The one lawful exception is a GDPR/CCPA erasure = **hard-delete** the personal data + media but retain the hash/metadata stub — a controlled destruction-with-tombstone, never a plain edit or delete. *Revised 2026-07-16: this said "crypto-shred", which was the only reason client-side media encryption existed. Dropped for v1 — the plaintext class was always hard-deleted anyway, so crypto-shred only covered the audio blob, and its one edge over deletion was already conceded. See `DURABILITY-DESIGN-v1` DECISION 4.*) This is why P1 sync is **append-only** (new immutable rows, never mutation of an approved record) and why it composes with the "frozen `shown_content` = binding signed artifact" rule. `[✅ hadar; ADR-2]`

**Decisions come in two scope layers.** A decision is either **project-scope** (the overall project) or **party/worker-scope** — the sub-conversations that **delineate who is responsible for what** between trades. Actionable decisions record **who they're assigned to**, and each invited party carries a **role + scope of work**, so the classic trade-boundary gap ("electrician or mechanical on the air handler?") is captured, assigned, and reviewable before it becomes a dispute. This is central to the protection goal — most cross-party disputes trace to a scope that wasn't clearly delineated. `[✅ hadar]`

---

## 4. Capture mechanics (how information gets in)

**Modalities:** audio (voice), video, image, text. `[✅ hadar]`

- **Text can be added to any capture** as annotation. `[✅ hadar]`
- **Image during a continuous recording → timeline-synced.** When a photo is taken *while* an audio recording is running, the image is anchored to the point on the recording's timeline where it was taken, so a later **report can be compiled with the image placed at the right moment**. `[✅ hadar]`
- **Continuous video recording → later extraction.** From a video, the system extracts the **audio** (for transcription) and **key images (keyframes)** at key points on the timeline. Key points are chosen **both** by automatic detection (scene/speech changes) **and** by the user marking a moment during recording — user marks improve report compilation. `[✅ hadar — auto + user-marked]`
- **Audio is transcribed; the original recording is always stored.** The transcript is a derived, editable artifact over an immutable original. `[✅ hadar]`

**Mental model:** a continuous recording is a **timeline**; images, markers, and (from video) keyframes are anchored to timestamps on it; reports and records are compiled by walking that timeline. `[❓ confirm this is the intended model]`

---

## 5. Local-first capture, connection-aware processing

> **Named principle (from the ezQuotePro post-mortem, `CRITIC-REVIEW-05`): capture is a locally-committed transaction that succeeds *before the first network call*.** ezQuotePro's offline workflow failed because "offline" was a mode bolted onto a cloud-first flow that hit the server *before* recording could even start. EZjobsite's atomic field action commits to durable local storage and shows "saved ✓" with **zero network dependency**; connectivity only changes what happens *afterward*. *"Offline reliability is not an upload queue — it's a locally-committed capture transaction that succeeds before the first network call."* This is the **durability-spike exit gate**, not aspirational copy.

- **Everything records locally on the device first**, always — **no server object, session, or presigned URL is required before recording begins** (the specific ezQuotePro defect). `[✅ hadar; CRITIC-05]`
- **Processing** (transcription, audio/keyframe extraction, structuring into a handler) happens **once the user is back online with a strong connection.** Offline or weak signal → the items are held locally and processed when a strong connection returns. `[✅ hadar]`
- **Upload rules:** strong Wi-Fi → files upload to the network. Strong **cell** + the user has **consented to cellular use** → files upload over cell. Otherwise, hold locally until a qualifying connection exists. `[✅ hadar]` `[❓ Wi-Fi upload is automatic; is there ever a "don't upload yet" hold, e.g. for battery or privacy?]`

**Confirmed consequence:** because *processing* is online, the structured outputs (a CO, a ready approval, a compiled report) are produced **when a connection is available**, not on a no-signal roof. Capture is always instant and safe offline; the *structured result* follows on reconnect. **No heavy on-device ML in v1** — this is a deliberate, accepted simplification. The only cost: "price it and get it approved before we leave the ladder" happens on reconnect, not with zero signal. `[✅ hadar — capture offline always; process on reconnect]`

**Two kinds of consent, keep them distinct:** (a) **recording consent** — legal, for recording people's voices (all-party-consent states); (b) **cellular-data consent** — cost/preference, for uploading over cell. Different purposes, both needed. `[R: prior spec REQ-C8 + hadar's cellular rule]`

---

## 6. What this changes in the spec

The earlier `SPEC-v1-change-order-wedge` isn't wrong — it's now correctly **one handler (Change Order) plus the capture core**. Once we lock this core concept and the enriched use cases, I'll re-derive the spec as: **Capture core (multimodal, timeline-synced, local-first, connection-aware) + a pluggable handler model {Evidence, Approval, Change Order, Report}**, and we pick which handler leads the de-risk v1. The change order is still the one with money attached, but it may no longer be the thing we build *first* — that's an open sequencing decision (below).

---

## 7. Decisions & open questions

### Resolved 2026-07-15 `[✅ hadar]`
1. **Base + three actions** — Evidence is the base layer; Approval / Change Order / Report are the three actions (implicitly confirmed).
2. **Lead handler for de-risk v1 = Capture + Evidence first.** Prove reliable multimodal, timeline-synced capture → durable evidence, offline-first — *then* add Change Order. The AI-heavy handlers (CO, language) are fast-follow, not first.
3. **Video key points = both** auto-detect + user-marked.
4. **Approval signature = owner's own device**, via a sent link (remote, no in-person signing on the field device in v1).
5. **Processing = capture offline always, process on reconnect.** No heavy on-device ML in v1.

### Still open (carried into the next enrichment pass)
6. **Who captures** — only the field team (crew/foreman), or can the owner/back-office capture too?
7. **Pricing ownership** (from the use-case catalog) — foreman on site, office after, or both? *Biggest unresolved decision; matters most once we build the Change Order handler.*
8. **Residential only, or sub-to-GC too?** (Approver = homeowner vs. GC.)
9. **First integration target** — QuickBooks / Jobber / CompanyCam / none yet.
10. **Wi-Fi upload** — always auto, or is there ever a "hold" (battery/privacy)?
