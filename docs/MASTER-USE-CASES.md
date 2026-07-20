# Hilo — Master Use-Case Catalog (consolidated)

*The single source of truth for use cases, merging two sources: (A) the research-seeded catalog I generated on the actor × lifecycle grid, and (B) hadar's CompanyCam-analysis catalog (14 use cases with workflows, dated 2026-07-14). Deduplicated, mapped to the locked core concept, and re-sequenced to the Capture+Evidence-first decision. Supersedes both source catalogs as the baseline the re-derived spec will trace to. Consolidated 2026-07-15.*

---

## 1. How the two catalogs reconcile

**Your three "jobs" map onto the locked core concept (`CORE-CONCEPT.md`) almost exactly:**

| Your job | Core-concept element | Note |
|---|---|---|
| **Validation [V]** | **Evidence (base layer)** + a confirmation loop | "Getting it mutually acknowledged" — the paper trail *plus* a lightweight agreement. |
| **Change Orders [CO]** | **Change Order** action | The priced, approvable one. |
| **Reports [R]** | **Report** action | Roll-ups, ledgers, updates. |
| *(implicit in V & CO)* | **Approval** action | Runs *through* the others — see the spectrum below. |

**The unifying insight your catalog surfaced — the Approval Spectrum.** "Approval" isn't one thing; it's a spectrum of *getting agreement*, escalating in formality. This is the through-line that connects Validation and Change Orders:

`lightweight confirm ("is this what we agreed?") → acknowledge ("you directed this") → signature (formal decision) → priced approval (change order)`

All four sit on the same mechanism (a record sent to the counterparty's own device via a no-login link — per the locked approval-signature decision), just with escalating weight. That's one component, reused, not four features.

**The one real conflict — sequencing.** Your catalog (2026-07-14) tiers the **Change Order as P1 (build first)**. Our 2026-07-15 decision was **Capture + Evidence first, CO fast-follow**. I've realigned the tiers to the newer decision (§3) — flagging it here because it's the single place the two sources disagree, and it's your call to confirm or overrule.

**Net-new first-class concepts I'm adopting from your catalog** (they weren't explicit in my seed): **Decision-of-record** (the ephemeral "we agreed to the matte finish" that carries *no* price but must not be lost), the **Sub↔GC directive** (protects the sub — this fills the A5/sub-to-GC gap I'd flagged), the **status ledger** (Approved / Pending / Declined + running total), and the **evidence bundle** (before/after + narration + who-directed bound into one dispute artifact).

---

## 2. Priority snapshot (re-sequenced to Capture+Evidence-first)

Legend — Modes: 🎙️voice 📷photo 🎥video ✍️text · Jobs: V=Validation/Evidence, A=Approval, CO=ChangeOrder, R=Report · Source: **B**=your catalog, **S**=my seed, **B+S**=both.

| ID | Use case | Jobs | Modes | Phase | Source |
|---|---|---|---|---|---|
| **CAP-1** | One-tap "let's go" capture primitive (auto-filed) | — | 🎙️🎥📷✍️ | **P1** | B+S |
| **CAP-2** | Image during a recording → timeline-synced | — | 📷 | **P1** | B(rules)+hadar |
| **CAP-3** | Video → auto + user-marked keyframe/audio extraction | — | 🎥 | **P1** | hadar |
| **CAP-4** | Transcribe audio; retain original + Spanish source | — | 🎙️ | **P1** | B+S |
| **CAP-5** | Offline capture + visible "saved" confirm | — | all | **P1** | B+S |
| **CAP-6** | Project resolution (auto-file + secondary workflow) | — | all | **P1** | S(+hadar) |
| **CAP-7** | Consent: recording (legal) + cellular-upload (cost) | — | — | **P1** | S+hadar |
| **EVID-1** | Decision-of-record (homeowner↔contractor) | V,A | 🎙️📷 | **P1** | B |
| **EVID-2** | Sub↔GC directive / "proceed" capture | V,A | 🎙️📷 | **P1** | B |
| **EVID-3** | Dispute-proof validation bundle | V,R | 📷🎥🎙️ | **P1.5** | B+S |
| **EVID-4** | Retrieve a past job's record (warranty/dispute) | V,R | — | **P1.5** | B+S |
| **APPR-1** | Lightweight confirm on a decision (owner's device) | A | ✍️ | **P1** | B |
| **APPR-2** | Signature approval on a formal decision | A | ✍️ | **P1.5** | B+S |
| **APPR-3** | Decline / counter / question | A | ✍️ | **P1.5** | B+S |
| **APPR-4** | Approve-later reminders | A | — | **P1.5** | S |
| **CO-1** | Verbal change order → priced → approved | CO,V,R | 🎙️📷 | **P1.5** | B+S |
| **CO-2** | Office prices a field-captured change | CO | ✍️ | **P1.5** | S |
| **CO-3** | T&M / CCD "proceed, NTE $X" capture | CO,V | 🎙️ | **P1.5** | B+S |
| **CO-4** | Bundle small items / running "favors log" | CO | 🎙️ | **P2** | S |
| **CO-5** | Cumulative CO ledger vs. original estimate | CO,R | ✍️ | **P1.5** | B+S |
| **REP-1** | Change-order/decision report + status ledger | R,CO | ✍️ | **P1.5** | B+S |
| **REP-2** | Client progress update | R | 🎙️📷 | **P1.5** | B+S |
| **REP-3** | Back-office handoff / daily digest | R | 🎙️ | **P1.5** | B+S |
| **REP-4** | Daily log by voice | R | 🎙️ | **P2** | B+S |
| **REP-5** | Weekly log / walkthrough roll-up | R | 🎙️📷 | **P2** | B+S |
| **EXP-1** | Punch-list walkthrough | V,R | 🎙️📷 | **P2** | B+S |
| **EXP-2** | Inspection / condition report | V,R | 🎙️📷 | **P2** | B |
| **EXP-3** | Safety / incident report | V,R | 🎙️🎥 | **P2** | B |
| **EXP-4** | RFI capture (question up the chain) | V | 🎙️📷 | **P2** | B |
| **EXP-5** | T&M / materials tracking (alphanumeric-heavy) | CO,R | 🎙️✍️ | **P2** | B+S |
| **EXP-6** | Voice retrieval ("pull up the Johnson roof") | R | 🎙️ | **P2** | B+S |
| **EXP-7** | Client-facing gallery / share link | R | 📷 | **P2** | S |
| **SET-1** | Add crew (free field seats) + set languages | — | ✍️ | **P1.5** | S |
| **SET-2** | Create a job (address/geofence/client) | — | ✍️ | **P1** | S |
| **SET-3** | Load the original estimate/scope (for CO reference) | — | ✍️ | **P1.5** | S |
| **SET-4** | Crew first-run + permissions | — | ✍️ | **P1** | S |
| **PM-1** | Create a project (name+address→geofence); field quick-create + office cleanup | — | ✍️ | **P1** | hadar |
| **PM-2** | Edit project + status lifecycle (lead→in-progress→complete→archived) | — | ✍️ | **P1** (2-state) / **P1.5** (4-state, see `PRD-companycam-parity.md`) | hadar |
| **PM-3** | Projects list (filter/sort) | — | ✍️ | **P1** | hadar |
| **PM-4** | Search project (name/address/client) | — | ✍️ | **P1** | hadar |
| **PM-5** | Nearby projects (GPS browse) | — | — | **P1** | hadar |
| **PM-6** | Company feed (role-scoped activity across projects) | R | — | **P1.5** | hadar |
| **PM-7** | Authorship on every item (employee / sub-shared) | — | — | **P1** | hadar |
| **PM-8** | Project membership + roles (office/field/sub) | — | — | **P1.5** | hadar |
| **PM-9** | Subcontractor sharing (labeled now; cross-company later) | — | — | **P1.5/P2** | hadar |
| **PM-10** | Project detection from a recording (match existing OR propose new, confirm-gated) | — | 🎙️🎥 | **P1** (AI pre-fill P1.5) | hadar |
| **REP-6** | AI walkthrough note (walk+talk+snap → sectioned report) | R | 🎙️📷 | **P1** capture / **P1.5** gen | CC-analysis |
| **REP-7** | Pause = section break (structure by gesture) | R | 🎙️ | **P1** | CC-analysis |
| **REP-8** | Export / share / translate / ToC / save-as-template | R | — | **P1.5** | CC-analysis |
| **CHK-1** | Voice-create a checklist (auto-sectioned) | Task | 🎙️ | **P1.5** | CC-analysis |
| **CHK-2** | Assign checklist items to crew/members | Task | ✍️ | **P1.5** | CC-analysis |
| **CHK-3** | Voice-complete a checklist + photo proof (honor "not yet") | Task | 🎙️📷 | **P1.5** | CC-analysis |
| **CHK-4** | Derive a checklist from a walkthrough note | R→Task | — | **P1.5** | CC-analysis |
| **DEC-1** | Decision as versioned aggregation unit (subject/latest-value/history + photos aggregate around it + AI tags) | V | 🎙️📷 | **P1** (AI tags P1.5) | hadar |
| **DEC-2** | Decision requires owner approval → notify owner → digital approve on a Page → verified timestamp → notify instigator | A,V | ✍️ | **P1.5** | hadar |
| **NOTIF-1** | Notifications (approval request/result, @mention/assignment) | — | — | **P1.5** | hadar+CC |
| **LANG-1** | Canonical English record (native → English pivot; original retained) | — | 🎙️✍️ | **P1** store / **P1.5** translate | hadar |
| **LANG-3** | Per-user preferred display language (one record, each in their own language) | — | — | **P1** field / **P1.5** render | hadar |
| **LANG-4** | Translate-once cache (per record × language; invalidate on change) | — | — | **P1.5** | hadar |
| **LANG-5** | Cross-language search via English pivot (query→EN→results→pref lang) | — | 🎙️✍️ | **P1.5** | hadar |
| **LANG-7** | Client/counterparty surfaces render in the recipient's language | A,R | — | **P1.5** | hadar+CC |
| **OFF-1** | Offline projects — create + capture-into + list/search/nearby offline; sync on reconnect | — | all | **P1** | hadar |
| **OFF-2** | Processing status + reason ("saved — needs Wi-Fi/cell to process"); never blocks capture | — | — | **P1** | hadar |
| **COLLAB-1** | Invite a company to a project (link, web/mobile); free for both | — | — | **P1.5** | hadar+CC |
| **COLLAB-2** | Collaborator contributes (capture/comment), attributed to their company; project-scoped | — | 🎙️📷 | **P1.5** | hadar+CC |
| **COLLAB-3** | End collaboration anytime; host keeps their content; reinvite | — | — | **P1.5** | hadar+CC |
| **COLLAB-4** | Cross-company + cross-language collaboration (each in own language, English-canonical) | — | — | **P1.5** | hadar |
| **COLLAB-5** | Reverse invite — a sub invites the GC/owner into the project (bidirectional) | — | — | **P1.5** | hadar |
| **COMM-1** | Route a decision to the right party by type + intent (verify vs. approve) | A,V | — | **P1** verify / **P1.5** route | hadar |
| **COMM-2** | Mini change order — fast one-tap "proceed" to keep the job moving (escalatable) | CO | 🎙️ | **P1.5** | hadar |
| **COMM-3** | Off-site, in-language delivery + live field status (pending/approved/declined) | A,R | — | **P1.5** | hadar |
| **COMM-4** | Report cadence out (daily/weekly/inspector, scheduled or on-demand) | R | 🎙️ | **P2** | hadar |
| **SCOPE-1** | Decision scope level (project vs party) + assignee on actionable decisions | V | 🎙️ | **P1** | hadar |
| **SCOPE-2** | Responsibility delineation across trades (air-handler problem); flag gaps/overlaps | V | 🎙️ | **P1** capture / **P1.5** detect | hadar |
| **SCOPE-3** | Capture party role + scope-of-work on invite; per-party scope review | — | ✍️ | **P1** field / **P1.5** review | hadar |
| **AUTH-1** | Real account (sign-up/login), session persists, capture attributes offline | — | ✍️ | **P1**-prereq | hadar+CC |
| **AUTH-2** | Owner-pays seat + free crew/collaborator/client seats | — | — | **P1**-prereq | hadar |
| **ORG-1** | Company/org owns projects+captures; authorship on every item | — | — | **P1**-prereq | hadar+CC |
| **PM-14** | Project labels (user color tags, filter list by) | — | ✍️ | **P1.5** | hadar+CC |
| **VIEW-1** | Project photo grid (reverse-chron, date-grouped, mixed modality) | R | 📷 | **P1.5** | hadar+CC |
| **VIEW-2** | Full-screen photo viewer (swipe, zoom, evidence panel, notes) | R | 📷🎥🎙️ | **P1.5** | hadar+CC |
| **VIEW-3** | User tags on captures (filter grid by tag) | R | 📷 | **P1.5** | hadar+CC |
| **MAP-1** | Static map thumbnail per job (pin at lat/lng; online-fetch, cached) | — | — | **P1.5** | hadar (static-only) |
| **NAV-1** | Bottom tab bar (Projects · Feed · Camera · Notifications · Profile) | — | — | **P1.5** | hadar+CC |
| **SHARE-1** | Live shared project-timeline link (auto-updates as captures land) | R | 📷 | **P1.5/P2** | hadar+CC |

*83 deduped use cases (14 + ~35 seed + 10 project-management + 7 CompanyCam-AI teardown + 3 decision/notification + 5 language + 2 offline + 4 collaborator + 4 communication + 3 scope/responsibility + 10 CompanyCam-parity: AUTH/ORG/VIEW/MAP/NAV/SHARE + project labels). Layer docs: `LANGUAGE-LAYER.md`, `PM-LAYER.md`, `COMMUNICATION-LAYER.md`, `PRD-companycam-parity.md`; offline in `SPEC §6.3` (REQ-PROC6/7). Checklist/Tasks is now a first-class handler (`SPEC §7.4`); walkthrough-note + pause=section-break detail in `companycam-ai-features-analysis.md` and `SPEC §6.2/§7.3`.*

---

## 3. The re-sequenced phases (the reconciliation, explicit)

**P1 — The core loop (prove this first):** the capture primitive (CAP-1..7) → **Evidence** as durable paper trail → the **lightweight validation loop** (EVID-1 decision-of-record, EVID-2 sub↔GC directive, APPR-1 confirm). This proves *"capture a decision, make it durable, get it lightly acknowledged"* — the always-on core — without the AI-heavy pricing or the legal weight of a signature. Plus the minimal setup to make it real (SET-2 create job, SET-4 first-run).

**P1.5 — The money + formal-agreement + communication loop (fast-follow):** the **Change Order** (CO-1/2/3/5), the **signature-grade Approval** (APPR-2/3/4), and the **Report/ledger** (REP-1/2/3, EVID-3/4). This is where willingness-to-pay and the differentiator live — it comes right after the core is trusted, not first.

**P2 — Expansion (same spine, later):** habit + compliance use cases (daily/weekly logs, punch list, inspection, safety, RFI), T&M (after alphanumeric capture is hardened), voice retrieval, client gallery.

**Why this order and not CO-first:** leading with Capture+Evidence de-risks the thing *everything* depends on (reliable, never-lost, timeline-synced multimodal capture) with the cheapest possible proof, and the validation loop (decision-of-record) is a differentiator CompanyCam lacks that needs *no* pricing accuracy to demonstrate value. The Change Order carries the money — so it's the very next thing — but building it first would mean betting the whole first slice on the hardest AI (voice→priced extraction, Spanish, number confidence) before we've proven we can even hold a capture reliably. *If you'd rather bet CO-first for the money signal, say so — this is the one open sequencing call.*

---

## 4. Coverage & the gaps this merge closes / leaves

**Closed by your catalog:** the sub-to-GC actor (EVID-2), the ephemeral no-price decision (EVID-1), the status-ledger view (REP-1), RFI/inspection/safety expansion. 

**Still open (unchanged — these gate the P1.5 handlers, not P1):**
1. **Pricing ownership** — foreman on site vs. office after vs. both (CO-1/CO-2). *Still the #1 unresolved decision; only bites at P1.5.*
2. **Who captures** — field team only, or owner/back-office too (affects CAP-1, REP-3).
3. **Residential vs. sub-to-GC emphasis** — EVID-2 implies you *do* want the sub↔GC world; confirm it's in v1's ICP, not just later.
4. **First integration target** — QuickBooks / Jobber / CompanyCam / none (CO-5, REP-1 export).
5. **Run alongside CompanyCam/Jobber, or replace?** — your own catalog's open flag; shapes positioning + integration depth.

---

## 5. What I'll do next
On your confirmation of the §3 sequencing (or your override), I'll **re-derive the spec** around: the **Capture core** (multimodal, timeline-synced, offline-first, process-on-reconnect) + the **handler model** (Evidence base → Approval spectrum → Change Order → Report), with P1 = the core loop detailed to buildable requirements and P1.5/P2 as architected seams. This master catalog becomes the requirements baseline the spec traces to, replacing the thin change-order-only framing.
