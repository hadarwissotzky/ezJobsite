# Hilo — Use-Case Catalog (seed for you to react to)

> ⚠️ **SUPERSEDED (2026-07-15) by `MASTER-USE-CASES.md`.** This was the initial seed; the consolidated, current baseline is the master catalog. Kept for history only.

*Purpose: enrich the thin requirement set before we re-process the spec. I pre-populated candidate use cases from the seven Project research docs on the **actor × job-lifecycle grid**, and flagged gaps. **This is a draft to react to, not a finished list** — the goal is for you to cut, correct, re-prioritize, and (most importantly) add the ones only you know. Seeded 2026-07-15.*

---

## How to react to this (do this, it's the point)

For each use case, mark one: **KEEP** / **CUT** / **CHANGE** (say what) / **↑↓ priority**. Then the two high-value moves: **add missing use cases** (the ones living in your head that aren't here), and **answer the `Q:` open questions** — those are the decisions I can't make for you. You can scribble inline, talk it out, or just tell me the deltas.

**Legend**
- Priority: 🎯 = v1 wedge · ▷ = fast-follow · ◇ = someday/expansion
- Source: `[R]` = grounded in a research doc (named) · `[?]` = **my inference/assumption — verify me**
- Freq: how often it happens in real life (many/day · daily · weekly · rare)

---

## Actors

| ID | Actor | In one line |
|---|---|---|
| **A1** | Crew member / laborer | Does the work; often Spanish-dominant; hands full. Captures. |
| **A2** | Foreman / lead | Runs the crew on site; captures, decides, sometimes prices. The core field user. |
| **A3** | Office / owner (GC or sub) | The **buyer**. Prices, routes, bills, resolves disputes. Often the same person as A2 in tiny shops. |
| **A4** | Homeowner / client | **Approves and pays.** Not the buyer of Hilo. |
| **A5** | GC-above-a-sub / adjuster / inspector | Third parties in some jobs. Mostly expansion. `[?]` — confirm these matter to you. |

## Job lifecycle (the phases capture flows through)

`P0 Setup → P1 Before work → P2 On-site capture → P3 Resolve & organize → P4 Structure, price & confirm → P5 Client approval → P6 Back-office & billing → P7 Dispute / warranty / retrieval`  · plus **P8 Cross-cutting** (offline, sync, language, notifications).

## Coverage matrix (where seeded use cases land — blanks are candidate gaps)

| Phase ↓ / Actor → | A1 Crew | A2 Foreman | A3 Office | A4 Homeowner | A5 Third-party |
|---|---|---|---|---|---|
| P0 Setup | ✎ | ✎ | ✎✎ | ✎ | — gap? |
| P1 Before work | | ✎ | ✎✎ | | — |
| P2 On-site capture | ✎✎ | ✎✎✎✎ | | | — |
| P3 Resolve/organize | | ✎ | ✎ | | — |
| P4 Price & confirm | | ✎✎ | ✎✎✎ | | — |
| P5 Client approval | | ✎ | ✎ | ✎✎✎ | ◇ gap? |
| P6 Back-office/bill | | | ✎✎✎ | ✎ | — |
| P7 Dispute/retrieval | | ✎ | ✎✎ | | ◇ gap? |
| P8 Cross-cutting | ✎ | ✎✎ | ✎ | ✎ | — |

*Obvious candidate gaps I want your read on: is there a real A5 (GC/adjuster/inspector) flow? Is there a crew-member self-serve angle beyond capture? Anything in P1 "before work" we're under-serving?*

---

## P0 — Setup & onboarding

**UC-P0-1 · Owner sets up shop and adds the crew** ▷ · rare · `[R: appstore-reviews "free/no-per-seat for crew"; project-memory]`
A3. Job story: When I start using Hilo, I want to add my whole crew for free and set our languages, so everyone can capture from day one without a per-seat bill. Inputs: text. Done: crew has access; target language set per tenant/user. Q: is target language a company default, a per-user setting, or per-job?

**UC-P0-2 · Create a job/project** 🎯 · daily · `[R: companycam auto-sort; spec REQ-P1]`
A3/A2. Job story: When a new project starts, I want to create it with its address/client once, so every later capture can auto-file itself to it. Inputs: text. Done: a job exists with address+geofence+client. Q: who creates jobs — office only, or foreman in the field too?

**UC-P0-3 · Crew first-run & permissions** ▷ · rare · `[?assumption]`
A1. Job story: When I open Hilo the first time, I want the shortest possible setup (mic/camera/location/consent) so I can start capturing in under a minute. Inputs: taps. Done: permissions + consent posture set. Edge: low digital literacy; language of the onboarding itself.

**UC-P0-4 · Set recording-consent posture** ▷ · rare · `[R: critic C4 — two-party consent]`
A3. Job story: When I work in a state that requires all-party consent, I want the app to handle the consent step so my recordings stay legal and admissible. Q: do you want this per-job, per-company, or auto by geolocation?

---

## P1 — Before work

**UC-P1-1 · Load the original estimate/scope** ▷ · daily · `[R: change-order-synthesis "tie CO back to the original estimate"]`
A3. Job story: When I set up a job, I want its original scope/estimate in Hilo, so every change order can reference what was already agreed and show the delta. Inputs: text/import. Done: baseline scope on the job. Q: manual entry, or import from QuickBooks/Jobber/a PDF?

**UC-P1-2 · Capture exclusions / billable-change language** ◇ · rare · `[R: change-order-synthesis "exclusions language gives the CO contractual footing"]`
A3. Job story: When I define a job, I want standard "unforeseen conditions / owner-requested = billable" language attached, so a later CO has contractual footing. Q: is this in-scope for you or a template/legal concern to defer?

---

## P2 — On-site capture (the heart)

**UC-P2-1 · Capture a verbal change, hands full** 🎯 · many/day · `[R: change-order-synthesis; voice-first]`
A2/A1, ladder, gloves, noise. Job story: When the client asks for extra work while my hands are full, I want to capture what was said + who said it in one action, so the decision is never lost and I can price it before starting. Inputs: voice (+optional photo). Done: saved, stamped, right job, nothing lost. Edges: offline; Spanish→English; two people talking. **Q: who prices it — foreman on site or office later?** (recurs everywhere)

**UC-P2-2 · Photo/before-after tied to the decision** 🎯 · many/day · `[R: companycam love #3/#2]`
A1/A2. Job story: When something changes, I want to snap before/after photos bound to that decision, so the evidence and the decision live together. Inputs: image. Done: stamped photos on the capture.

**UC-P2-3 · Video a condition as evidence** ▷ · daily · `[R: user requirement — video; appstore video-loss pain]`
A2. Job story: When I find an unforeseen condition (rotted joist, hidden damage), I want a short stamped video, so I can prove it existed and justify the change. Inputs: video. Edge: long video must not truncate (the "18 seconds of 20 minutes" failure).

**UC-P2-4 · Type it when it's too loud to talk** ▷ · daily · `[R: appstore-reviews noise; user requirement text]`
A2. Job story: When it's too loud or I can't speak freely, I want to type a quick note into the same flow, so noise never blocks capture. Inputs: text.

**UC-P2-5 · Capture in Spanish** 🎯 · many/day · `[R: voice-first Area 5]`
A1. Job story: When I speak Spanish on site, I want to capture in my own language and have it become an English record for the office/client, so nothing is lost in translation. Inputs: voice (Spanish). Done: source kept + English CO. Edge: Spanglish; numbers.

**UC-P2-6 · Capture with zero signal** 🎯 · many/day · `[R: appstore-reviews offline; spec REQ-C6]`
A1/A2, basement/roof/rural. Job story: When I have no signal, I want capture to work and *tell me it saved*, so I trust it in the exact places incumbents fail. Inputs: any. Done: local save + audible/visual confirm; syncs later.

**UC-P2-7 · Record who directed it** 🎯 · many/day · `[R: change-order-synthesis substantiation; spec REQ-S4]`
A2. Job story: When a change is requested, I want to note who asked (homeowner / GC / architect), so "who authorized this" is never in doubt. Inputs: voice/tap. Q: pick from a job's known parties, or free entry?

**UC-P2-8 · Capture a small "gimme" fast** ▷ · daily · `[R: change-order-synthesis small-CO / favors log]`
A2. Job story: When a tiny add comes up ($90), I want to log it in seconds even if I won't bill it now, so it's in the "favors log" as leverage later. Inputs: voice. Done: tracked, flagged small/absorbable.

**UC-P2-9 · Capture several changes in one walkthrough** ▷ · daily · `[?assumption]`
A2. Job story: When the client walks the site and rattles off five changes, I want to capture them in one pass and split them after, so I don't miss any. Inputs: voice (long). Q: one capture → many COs, or prompt to segment?

---

## P3 — Resolve & organize

**UC-P3-1 · Auto-file to the right project** 🎯 · many/day · `[R: companycam #1 love; spec REQ-P1]`
System/A2. Job story: When I capture, I want it to land in the right job with no filing, so I never manage folders on site. Done: mis-attach ≤5%, ≥85% auto-resolved.

**UC-P3-2 · Resolve an ambiguous / unmatched capture** 🎯 · daily · `[R: user requirement — secondary workflow; spec REQ-P2]`
A2/A3. Job story: When the app isn't sure which project a capture belongs to, I want it held safely and a quick way to assign it, so nothing is lost or mis-filed. Done: durable "unresolved" queue; 1-action resolve.

**UC-P3-3 · Two jobs at one address / multi-unit** ▷ · weekly · `[R: critic M6]`
A2. Job story: When I run two units at one address, I want to tell them apart, so captures don't cross-contaminate. Q: how common is this for your ICP?

**UC-P3-4 · Reassign a mis-filed capture** ▷ · weekly · `[?assumption]`
A3. Job story: When something landed on the wrong job, I want to move it in one action, so the record stays clean.

---

## P4 — Structure, price & confirm

**UC-P4-1 · Voice → draft change order** 🎯 · many/day · `[R: voice-first Area 3 moat; spec REQ-S1]`
System/A2. Job story: When I've captured a change, I want it turned into a draft CO (scope, qty, price, who-directed), so I'm 90% done without typing. Done: editable draft over the raw capture.

**UC-P4-2 · Confirm & correct the numbers** 🎯 · many/day · `[R: mandate #6; spec REQ-S2]`
A2/A3. Job story: When a price/measurement was spoken, I want to see it big and confirm or fix it, so a mangled number never ships. Edge: gloved rubber-stamping (measure catch-rate).

**UC-P4-3 · Office sets/loads the price** 🎯 · many/day · `[R: user-research-plan pricing open Q; project-memory]`
A3. Job story: When the foreman captures a change but doesn't price it, I want to add the price from the office before it goes to the client, so pricing stays with whoever owns it. **Q: this is the big open pricing question — foreman prices on site, office prices after, or both paths?**

**UC-P4-4 · T&M / no-fixed-price change (CCD)** ▷ · weekly · `[R: change-order-synthesis CCD/T&M]`
A3. Job story: When work must start before a price is settled, I want a "proceed now, price later" directive captured and agreed, so urgent work isn't blocked or done free. Q: in-scope for v1, or fast-follow?

**UC-P4-5 · Bundle small items / running favors log** ▷ · weekly · `[R: change-order-synthesis bundling/gimme log]`
A3. Job story: When I have several small adds, I want to bundle them into one CO or track absorbed ones, so nothing's lost and I have negotiation leverage. 

**UC-P4-6 · Show cumulative CO impact vs. original** ▷ · weekly · `[R: change-order-synthesis "running total of prior COs"]`
A3/A4. Job story: When I send a CO, I want it to show the running total of changes against the original, so the owner sees cumulative impact, not just this line.

**UC-P4-7 · Scope-translation fidelity check** 🎯 · many/day · `[R: critic H5; spec REQ-L4]`
System. Job story: When a Spanish capture becomes an English CO, I want the translated scope checked before the client can approve it, so nobody approves a mistranslation. 

---

## P5 — Client approval

**UC-P5-1 · Send priced CO for approval before work** 🎯 · daily · `[R: companycam wedge; jobber gap; change-order-synthesis]`
A2/A3. Job story: When a change is priced, I want to send it to the client for approval before we start, so we never do at-risk work. Done: sent state; price visible.

**UC-P5-2 · Homeowner approves (one tap + identity)** 🎯 · daily · `[R: user-research-plan; critic H2; spec REQ-A2]`
A4. Job story: When I get a change request, I want to approve it in one tap without downloading anything, but in a way that's actually binding, so it's easy *and* real. Q: SMS OTP vs. typed-name — test which doesn't kill the rate.

**UC-P5-3 · Homeowner declines / asks a question / counters** ▷ · daily · `[R: user-research-plan reaction segment]`
A4. Job story: When I'm not sure about a change, I want to decline or ask a question, so I don't feel railroaded. Q: do we support a back-and-forth thread, or just approve/decline in v1?

**UC-P5-4 · Reminder / approve-later** ▷ · daily · `[R: edge case "homeowner ignores mid-workday"]`
A4. Job story: When I'm busy when it arrives, I want a gentle nudge, so it doesn't get buried. 

**UC-P5-5 · Approval creates the defensible record** 🎯 · daily · `[R: change-order-synthesis "signature before work"; spec REQ-A3]`
System. Job story: When the client approves, I want a timestamped record with the exact scope+price they saw and the underlying capture, so it survives any dispute.

**UC-P5-6 · Approval routes to a GC, not a homeowner** ◇ · rare · `[?assumption — expansion]`
A5. Job story: When I'm a sub, the approver is the GC, not a homeowner. Q: is commercial/sub-to-GC in your v1 world at all, or purely residential?

---

## P6 — Back-office & billing

**UC-P6-1 · Office sees approved COs in real time** ▷ · daily · `[R: companycam "field→office visibility"]`
A3. Job story: When my crew captures and clients approve, I want to see it from the office without a call, so I'm never in the dark. 

**UC-P6-2 · Export a dispute-proof record** 🎯 · weekly · `[R: appstore "the report is the deliverable"; spec REQ-R1]`
A3. Job story: When I need to prove a change, I want a clean PDF/link with scope, price, who-directed, timestamps, approval, and evidence, so one export ends the argument. Edge: exclude unnecessary client PII.

**UC-P6-3 · Push approved CO into QuickBooks/Jobber** ▷ · weekly · `[R: project-memory "companion not replacement"]`
A3. Job story: When a CO is approved, I want it to flow into whatever I bill from, so I don't re-enter it. (v1 = stubbed seam.) Q: which billing tool is #1 for you to integrate first?

**UC-P6-4 · Weekly review of captures** ◇ · weekly · `[R: companycam "org rituals / production meetings"]`
A3. Job story: When we meet weekly, I want to run through the week's captures/COs, so the team's on the same page. 

**UC-P6-5 · Client-facing progress gallery/link** ◇ · weekly · `[R: companycam share link; voice-first Area 4 client updates]`
A4/A3. Job story: When a client wants to see progress, I want to share a link with no login, so they feel informed. (Adjacent expansion.)

---

## P7 — Dispute, warranty & retrieval

**UC-P7-1 · Pull a past job's full record months later** ▷ · weekly · `[R: companycam "retrieval is the retention moment"]`
A3. Job story: When a warranty call comes in six months later, I want every capture/CO for that job in order, so I can answer instantly. 

**UC-P7-2 · Settle a dispute with the exact capture** 🎯 · rare-but-critical · `[R: change-order-synthesis "getting paid"]`
A3. Job story: When a client disputes a change at the end, I want to pull the exact approved CO + who-directed + evidence, so I get paid. 

**UC-P7-3 · Voice retrieval ("pull up the Johnson roof")** ◇ · weekly · `[R: companycam retrieval crack; project-memory]`
A2/A3. Job story: When I need a past job, I want to ask for it by voice, so I find it hands-free. (Later differentiator.)

---

## P8 — Cross-cutting

**UC-P8-1 · Everything syncs when signal returns** 🎯 · many/day · `[R: appstore offline; spec REQ-Y1]`
System. Job story: When I get back in signal, I want my offline captures to sync and *show me* they synced, so I trust it landed. 

**UC-P8-2 · Guaranteed-save confirmation, always** 🎯 · many/day · `[R: appstore "silent data loss"; spec REQ-C4]`
System. Job story: When I capture anything, I want loud proof it saved, so I never wonder. 

**UC-P8-3 · Swap the target language** ▷ · rare · `[R: user requirement — modular language]`
A3. Job story: When my office reads a different language, I want to set the output language, so records arrive in the language we work in. 

**UC-P8-4 · Phone lost/dead before sync** ▷ · rare · `[R: critic M5]`
A3. Job story: When a phone is lost before syncing, I want captures encrypted and a nag to sync, so exposure and loss are minimized. Q: acceptable to accept a small residual loss window, or need near-real-time sync?

**UC-P8-5 · Notifications to office & client** ▷ · daily · `[?assumption]`
A3/A4. Job story: When a CO is sent/approved/declined, I want the right person notified, so things don't stall. Q: push, SMS, email — which matter?

---

## The open questions that most shape everything (please answer these first)

1. **Pricing ownership** — foreman prices on site, office prices after, or both? (Touches UC-P2-1, P4-1/2/3, P5-1.) *This is the single biggest unresolved decision.*
2. **Residential only, or sub-to-GC too?** (Touches actors A5, P5-6, T&M/CCD.)
3. **Who creates jobs and loads the original estimate** — office only, or field too? (P0-2, P1-1.)
4. **v1 approval interaction** — approve/decline only, or a back-and-forth thread? (P5-3.)
5. **First integration target** — QuickBooks, Jobber, CompanyCam, or none yet? (P6-3.)
6. **Anything here that's flat wrong or missing an entire category** — that's the most valuable thing you can tell me.

---

## What I'll do once you react
Fold your keeps/cuts/changes + your added use cases + your answers into a **consolidated, prioritized use-case set**, then re-derive the spec from the enriched requirements (not the thin ones) — re-running the same traceability + verification discipline. This catalog becomes the requirements baseline the spec traces to.
