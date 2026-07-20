# PRD — CompanyCam-parity + wedge (EZjobsite)

> **⚠️ DEMOTED 2026-07-20 — NO LONGER A SOURCE OF TRUTH.** The "CompanyCam parity"
> framing was scope creep against `CLAUDE.md §5`. This PRD's REQs have been
> **redistributed** into two focused product PRDs — see **`PRD-RECONCILIATION.md §4`**:
> its **documentation** REQs (grid/viewer/tags/map/share/feed) → **`PRD-jobsite-field-record.md`**;
> its **wedge** REQs (proposal/CO/sign/delivery) → **`PRD-change-approval-loop.md`** (which
> adds the EWA flow + discussion loop it lacked); its broad social/collaborator scope → cut/P2.
> Retained below for history and REQ-ID traceability only. Read the reconciliation first.

*The consolidated, build-ordered product spec for reaching CompanyCam parity on
project management + image display + the social layer, while advancing the
transaction/approval **wedge** end-to-end. Authored 2026-07-17. Layers on top of
the honest v1 de-risk spec — it does not replace it.*

---

## 0. How to read this doc (relationship to the rest of the spec)

This repo has **no single PRD**; requirements live in `MASTER-USE-CASES.md` →
`SPEC-capture-core-v1.md` → layer docs (`PM-LAYER`, `LANGUAGE-LAYER`,
`COMMUNICATION-LAYER`). This PRD is a **fourth layer doc** with a specific job:
take the CompanyCam teardown and make every parity surface **buildable**.

Each requirement is one of:
- **NEW** — a net-new surface with no prior REQ (e.g. the full-screen photo
  viewer). Authored here in full; this doc is authoritative for it.
- **ELEVATE** — an existing REQ that was specced only as a P1.5 "seam." This doc
  adds the buildable detail (UI, `Accept:`, touch budget) and becomes authoritative
  **for build**; a one-line pointer is left at the original so there is a single
  source of truth.
- **REVERSE** — an existing decision this doc overturns with user sign-off (only
  one: the project-status cap). Logged as a reversal per `CLAUDE.md §3`.

Format matches the repo: `**REQ-ID — Title.** <prose>. [trace: <uc>; <decision>]`
then `- Accept: <measurable pass/fail>` (+ `Touch budget:` where it is a gloved
capture flow). Phase = the repo's P1/P1.5/P2; **Wave** = build order (see §4).

**Non-negotiables still apply.** Every REQ here inherits the 10 mandates in
`CLAUDE.md §2` — most sharply: never-lose-a-capture (#1), confirm-don't-automate on
anything priced (#2), offline-forward (#7), append-only immutability (#1),
English-canonical language pivot (#5). Where a surface touches those, the `Accept:`
line says how.

---

## 1. Context (why this exists)

We analyzed CompanyCam's live product and built a first CompanyCam-style shell
(Projects home + project-detail photo grid + camera-first capture, light-themed).
CompanyCam is the gold standard for **documentation + organization** and stops
there — no priced, counterparty-approved transaction, and translation only at
export. EZjobsite's wedge is exactly that transaction/approval layer plus
Spanish-capture→English-record. So the goal is **not** "clone CompanyCam" — it is
"match its capture/project/image UX as table stakes, and keep the transaction
layer as the differentiator." This PRD captures both.

---

## 2. Locked decisions (this PRD's ground truth) `[hadar 2026-07-17]`

1. **Framing** — phased backlog on the v1 de-risk spec; v1 core stays "proven."
2. **Foundation is a prerequisite** — real accounts + company/org + roles are
   specced first; Feed/galleries/collaborators/attribution depend on them.
3. **Maps = static images only** — a map thumbnail per job. No `react-native-maps`,
   no native rebuild, no interactive pins page.
4. **Payments = excluded** (non-goal; integrate QuickBooks/Jobber).
5. **Project status expands** to `lead → in-progress → complete → archived` +
   user color labels. **Reverses** the Active/Archived-only cap (`REQ-PM4`).
6. **Annotations = text notes only** for now (`REQ-CAP3`); on-photo drawing
   deferred.
7. **Navigation = bottom tab bar** (Projects · Feed · Camera · Notifications ·
   Profile), Feed as a primary tab.
8. **Wedge included end-to-end** — proposal-review surface + decision→CO→send→
   confirm→sign loop + a real delivery channel.

---

## 3. Actors (from `PRICING-STRATEGY.md`)

- **Owner/manager** — the only paying seat. Creates the company, projects, sends
  change orders, signs.
- **Field crew** — free seat. Captures.
- **Collaborator (sub/GC)** — free, project-scoped. Captures + comments.
- **Client/homeowner** — free, **no-login**. Confirms/signs via a link.

Every requirement below is scoped to which actor(s) it serves.

---

## 4. Build waves (order of development)

| Wave | Theme | Clusters | Repo phase |
|---|---|---|---|
| **W1** | Foundation | Auth · Company/Org · Roles/Membership | P1-prereq |
| **W2** | Project mgmt + image display | Lifecycle+labels · photo grid · viewer · user tags · static map | P1.5 (mostly) |
| **W3** | Wedge end-to-end | Proposal-review · CO/confirm/sign wired · delivery channel | P1.5 |
| **W4** | Social layer | Bottom-nav+Feed · notifications · comments · collaborators · gallery link · live-timeline link | P1.5 / P2 |

Waves are the build order; a later wave may depend on an earlier one (W4 Feed
needs W1 auth). Order is adjustable, but W1 must lead.

---

## 5. Requirements

### A. Foundation `[Wave 1 — prerequisite]`

- **REQ-AUTH1 — Real accounts (NEW).** A user signs up / logs in with a real
  identity (email or phone), replacing the hardcoded `device1@example.com`. The
  owner seat is the billable identity. `[trace: AUTH-1; hadar 2026-07-17]` *(The
  offline-capture aspect below is what touches mandate #7; account creation itself
  is not a #7 obligation.)*
  - Accept: a new user can create an account and reach first capture; sessions
    persist across app restart. **Offline attribution uses a durable local
    principal**: the last-authenticated user id is persisted on-device and stamped
    onto captures made while offline, so capture never blocks (mandate #7) and
    evidence is never unattributed. **Named unresolved cases (build-spec, §11):**
    first launch offline (no prior principal), user switch/logout with queued
    captures, a user revoked server-side after capture. Fallback: if the session
    can't refresh offline, capture succeeds under the durable local principal and
    the server validates attribution on reconnect (a mismatch is surfaced, never
    silently reassigned — mandate #1).
- **REQ-AUTH2 — Owner-pays identity + free seats (NEW).** Only the owner/manager
  seat is billable; field crew, collaborators, and clients are free. `[trace:
  AUTH-2; PRICING-STRATEGY §4]`
  - Accept: seat type is recorded per user; adding a crew/collaborator never
    prompts payment; the paywall (metering) reads seat type.
- **REQ-ORG1 — Company/organization entity (NEW; builds on `REQ-PM-C` authorship).**
  A first-class **company/tenant** groups a company's users and its projects; every
  item carries `author{user, org, role}`. This is **net-new**, not an elevation:
  `REQ-PM-C` gives authorship, not a tenant boundary. **Ownership is simple
  (`hadar 2026-07-17`): the creator owns their own content** — a collaborator owns
  what they capture, the host doesn't. No capturing-vs-host-vs-controller tangle;
  see §6 "Content ownership & lifecycle." `[trace: ORG-1; PM-7 (search, distinct);
  SPEC §8 Member.org]`
  - Accept: captures/projects created by a member resolve to that member's
    capturing org; authorship is visible on every item; a second device on the same
    account sees the same company data; **an offline client cannot escalate its own
    org/role** (server is the authority on tenancy — negative test).
- **REQ-ROLE1 — Role model + membership (NEW model; supersedes `REQ-PM13`'s
  office/field/sub with sign-off).** Roles: **owner · crew · sub/GC**, plus
  **client** as a **no-login counterparty (NOT a `Member` seat)**. This **changes**
  the prior office/field/sub model, so it is a logged model change, not a label
  elevation. Membership scopes visibility (owner = company-wide; crew = own
  projects). `[trace: PM-8; PM-13 (superseded); hadar 2026-07-17; SPEC §8]`
  - Accept: role is set per member; a crew member sees only their projects; an
    owner sees all; role gates Feed scope (§D) and collaborator permissions; the
    client never holds a Member row (they act only through no-login links).

### B. Project management `[Wave 2]`

- **REQ-PM4 — Project lifecycle (ELEVATE + REVERSE).** Status is
  `lead → in-progress → complete → archived`. **Reverses** the prior
  Active/Archived-only cap. `[trace: PM-2; hadar 2026-07-17 (reversal); companycam
  project statuses]`
  - Accept: status is set + changed + filterable in the Projects list; archived
    projects leave the active list but stay retrievable (warranty/dispute); history
    of status changes is retained (append-only, mandate #1). **The 4-state model is
    the single target schema; the old 2-state is a *collapse* of it** (`lead +
    in_progress + complete` → "active", `archived` → "archived"), **not a competing
    valid schema** — so there is one enum, and any P1 subset renders as the
    collapse, never a second migration. Reversal logged (§10). **Delete rule
    (`hadar 2026-07-17`): a project with anything assigned to it is *archived, not
    deleted*; an empty project can be deleted.**
- **REQ-PM14 — Project labels (NEW).** User-applied color labels on a project;
  filter the list by label. `[trace: PM-labels; companycam tags-labels]`
  - Accept: a label is created + applied + removed; the Projects list filters by
    one or more labels; labels sync across devices (mutable → PowerSync per the
    stack split).
- Reuse the shipped Projects home (`apps/mobile/App.tsx`) + `listProjects`,
  `resolveProject`; add status + label filter chips.

### C. Image display `[Wave 2 — CompanyCam's core surface]`

- **REQ-GAL1 — Project photo grid (NEW UI over `REQ-EVID2` retrieval).** A
  reverse-chron, **date-grouped** grid of a project's captures; photo shows its
  frame, **video shows an extracted still** (raw video is discarded per `REQ-TL4` —
  there is no playable video asset), voice/text a labelled tile; a corner state
  dot; one tap opens the viewer. *(Elevates `REQ-EVID2` "retrieve by project +
  recency" into a grid; it does NOT implement `REQ-EVID3`'s named evidence
  bundles — those stay a separate concern.)* `[trace: VIEW-1; EVID-2; companycam
  galleries-timelines]`
  - Accept: the grid renders the project's resolved captures newest-first, grouped
    under date headers; a filed-out-of-Inbox capture moves to the right project.
    **The grid shows what is synced + what is local on this device; nothing else.**
    On-device-only captures aren't in the global system yet, so a second device
    simply doesn't have them — there is **no obligation to prefetch a project's full
    media** (`hadar 2026-07-17`). A capture whose metadata synced but whose blob
    isn't on this device shows a **"not downloaded" placeholder** (mandate #7 —
    offline never blocks the grid). *(First cut of the flat grid already built; this
    REQ adds date-grouping + the placeholder state.)*
- **REQ-GAL2 — Full-screen capture viewer (NEW).** Tapping a tile opens a
  full-screen viewer: swipe between captures, pinch-zoom on photos, the evidence
  panel (who/when/where + GPS stamp + SHA-256 + intact/tampered), text notes
  (`REQ-CAP3`), and **audio playback for voice** (video plays its extracted
  audio + shows stills — no raw-video playback, per `REQ-TL4`). `[trace: VIEW-2;
  EVID-1; companycam photo viewer]`
  - Accept: swipe moves to the adjacent capture in grid order; the stamp + hash +
    integrity verdict show for every capture; a tampered/unreadable capture is
    shown loudly, never hidden (mandate #1); a not-yet-downloaded blob shows the
    placeholder, not a crash; works offline for local media.
  - Touch budget: **1 to open, swipe to navigate.**
- **REQ-GAL3 — User tags on captures (NEW).** A user applies free-form tags to a
  capture (distinct from the AI-tags-on-decisions of `REQ-VAL5`); the grid filters
  by tag. `[trace: VIEW-3; companycam tags-labels]`
  - Accept: a tag is added + removed on a capture; the grid filters to a tag;
    a tag is an **append-only annotation on immutable media** — tagging never edits
    the capture (mandate #1), and **removal is a retraction/tombstone event, not a
    DELETE** of the owned-outbox row (the add and the retract both survive as
    history). Tags carry the lawful-erasure carve-out (mandate #5: hard-delete of
    personal content on a valid request, retaining a hash/metadata stub). Tags sync.
- **REQ-MAP1 — Static map thumbnail (NEW).** A rendered static map image (pin at
  the job's lat/lng) on the project card + detail header. No interactive map.
  `[trace: MAP-1; hadar 2026-07-17 (static-only)]`
  - Accept: a pinned project shows a static map thumbnail; an unpinned project
    shows a neutral placeholder (never 0,0); the image is **fetched online and
    cached**, and its absence offline degrades to the placeholder — it never blocks
    the card. Fallback: no map key / offline → placeholder, card still renders.
- **Annotations — text only (NON-GOAL restated).** On-photo drawing / arrows /
  measurement markup is explicitly deferred; the text-note model (`REQ-CAP3`)
  stands. `[trace: hadar 2026-07-17]`

### D. Social / sharing layer `[Wave 4]`

- **REQ-NAV1 — Bottom tab bar (NEW).** A persistent bottom nav: **Projects ·
  Feed · Camera · Notifications · Profile**, Camera center + prominent. `[trace:
  NAV-1; companycam nav]`
  - Accept: every tab is reachable in one touch from anywhere; the Camera tab
    opens capture, which **auto-files by GPS OR routes to the Inbox on ambiguity /
    no-fix** (mandate #8 — never silently mis-filed, never lost; the existing
    `REQ-P1/REQ-P2` resolution ladder governs, the tab does not); state persists
    across tab switches.
  - Touch budget: **1 per tab.**
- **REQ-PM9 — Company Feed / Stream (ELEVATE).** A company-wide, reverse-chron
  activity stream across all projects, **scoped by role** (owner = company-wide;
  crew = own projects), rendered from local-synced data (not Supabase
  `postgres_changes`). **Event sources (corrects "dispositions only"):** the Feed
  is a **projection over (a) capture-commit events, (b) dispositions, and (c) a
  light activity-event row for mutable updates** (status/label/membership changes)
  — a raw capture and a status change are not dispositions, so a
  dispositions-only view cannot render them. It is still a **read projection, not a
  second source of truth**. `[trace: PM-6; SPEC §8 Feed; companycam project-feed]`
  - Accept: a new capture, a new disposition, and a status/label change each appear
    in the Feed **within one sync cycle** (define the cycle in the build spec —
    e.g. ≤ the 15s drain tick when online); role scope is enforced (negative test:
    a crew member never sees another project); tapping an item opens it; works from
    local data offline and backfills as sync arrives.
- **REQ-NOTIF1 — Notifications (ELEVATE `§7.1a`).** Push + in-app notifications
  for approval-requested → owner, approval-result → instigator, @mention/assignment
  → member. `[trace: NOTIF-1; SPEC §7.1a]`
  - Accept: each event delivers to the right recipient; the Notifications tab
    lists them with read state; tapping opens the referenced item.
- **REQ-COMMENT1 — Comments (NEW; the comment slice of `REQ-COLLAB3`'s
  "capture/view/comment").** Threaded comments on a capture / decision, attributed
  to the commenter's company; retained if collaboration ends. *(Traces to use-case
  `COLLAB-2` = collaborator contributes/comments — NOT `COLLAB-3`, which is "end
  collaboration"; the earlier `REQ-COLLAB3` label was the wrong ID.)* `[trace:
  COLLAB-2; companycam in-app-communication]`
  - Accept: a comment posts + is attributed + is visible to project members;
    comments are append-only; @mention fires `REQ-NOTIF1`.
- **REQ-PM-E — Collaborators (ELEVATE `REQ-COLLAB1..7`).** Invite a sub/GC to a
  project by link (either direction), free to accept, project-scoped, role + scope
  set on invite; end/reinvite anytime. `[trace: COLLAB-1..5; SPEC §7 / PM-LAYER §5]`
  - Accept: an invite link adds a collaborator to exactly one project; they can
    capture + comment; ending collaboration keeps the host's content; a reverse
    invite (sub → GC) works.
- **REQ-GAL4 — Gallery share link (ELEVATE `EXP-7`).** Hand-pick photos → a
  no-login share link/gallery for a client. Reuses the confirmation-token
  mechanism (`sql/020`). `[trace: VIEW-share; EXP-7; companycam galleries]`
  - Accept: selected photos produce a working no-login link; the link shows only
    the chosen photos; revoking the token kills the link.
- **REQ-GAL5 — Live shared project-timeline link (NEW).** A no-login link to a
  project timeline that **auto-updates** as new captures land. `[trace: SHARE-1;
  companycam project timeline]`
  - Accept: the link renders the project's timeline and **new captures appear on
    reload without re-issuing the link** (this auto-update IS the requirement — a
    static snapshot does NOT satisfy it); the owner can revoke it.
    *A point-in-time snapshot is a **separate, explicitly-labelled mode**, not a
    passing fallback for this REQ.* Access follows the content: an erased capture
    drops out of the shared timeline and revoking kills the link — no expiry/
    rotation machinery (`hadar 2026-07-17`).

### E. The wedge — differentiator end-to-end `[Wave 3]`

- **REQ-PROC8 — Structured-proposal review surface (NEW).** A screen that renders
  the AI pipeline's `capture_structured` proposal (subject/value/scope/who —
  **never a price**) so a human turns it into a **Decision** (`REQ-VAL5`). Closes
  the "pipeline writes into a void" gap. `[trace: DEC-1; mandate #2; mandate #4;
  hadar 2026-07-17]`
  - Accept: a processed capture with a proposal shows a review card; confirming
    creates a Decision from the (human-checked) fields; **low/none-confidence never
    prefills**; the model's proposal is never auto-committed (mandate #2); rejecting
    discards the proposal, not the capture.
  - Touch budget: **1 to confirm a proposal into a decision.**
- **REQ-CO-WIRE — decision→CO→send→confirm→sign, wired (ELEVATE `§7.2` Change
  Order + `§7.1` Approval).** Make the built-but-partial loop end-to-end. Price
  read-back is **mandate #6** (not `REQ-VAL6`, which is scope/who-directed — that
  citation was wrong): the number is read back BIG, tap-to-correct, and the
  contractor performs an **explicit confirm action** before the CO commits and
  again is not required after (single confirmed instrument). `[trace: APPR-1..4;
  CO-1; mandate #6; SPEC §7.1/§7.2]`
  - Accept: a change order **cannot commit or send unless a human performed the
    read-back-confirm action** — `numbers_confirmed_at` is set *by that action's
    handler only*, and a **negative test proves no code path sets it without the
    action** (mandate #2 — a DB flag alone is not evidence a human saw the price);
    the client then confirms or signs via a no-login link; the signature binds the
    **frozen `shown_content`** + OTP identity; status returns to the contractor.
- **REQ-VAL8 — Delivery channel (ELEVATE `REQ-VAL8` = SPEC §6.6 delivery).** A
  **real** send channel replaces the on-screen OTP code and the never-advancing
  `delivery_state`. **Two paths, not one fallback:** (a) the **binding OTP** for a
  signature **requires a real SMS channel — there is NO fallback that preserves the
  binding** (share-sheet cannot deliver an identity-bound code); if no SMS provider
  is configured, the *signature path is unavailable* and says so, while the lighter
  unsigned confirm still works. (b) **Confirmation/gallery links** may fall back to
  the share-sheet (a link the contractor sends themselves — see REQ-VAL8's original
  rationale). `[trace: COMM-3; SPEC §6.6 REQ-VAL8; PRICING-STRATEGY (SMS = the
  metered cost)]`
  - Accept: with SMS configured, the OTP is delivered to the entered number (never
    shown on screen) and `delivery_state` advances (queued → sent → confirmed),
    metered per `PRICING-STRATEGY`; with no SMS, the signature action is disabled
    with a stated reason (never a fake/on-screen code), and links still send via
    share-sheet (never a silent dead link).

---

## 6. Data-model deltas (extends `SPEC §8`)

- **Auth**: real `auth.users` binding per member (replaces the spike login).
- **Company/tenant** *(NEW — net-new ownership boundary, not a `Member.org`
  rename)* — id, name, owner_user, billing_seat; projects/captures reference it,
  but the cross-org controller model (capturing vs host vs controller) is OPEN
  (§11) and RLS depends on it.
- **Project**: `status` enum `lead | in_progress | complete | archived` (single
  target schema; `active | archived` is a render-collapse, not a second enum).
- **Label** *(NEW)* + **ProjectLabel** join *(NEW)* — labels are **their own rows
  with identity + org scope**, applied via a join row per project, **NOT a
  `labels[]` array column** (an array makes concurrent add/remove overwrite each
  other under PowerSync). Rename/delete/uniqueness defined at build.
- **CaptureTag** *(NEW)* — capture_id × tag; add + **retract** are both events
  (no destructive DELETE); carries the mandate #5 erasure carve-out.
- **ShareLink** *(NEW; reuses the confirmation-token plumbing)* — token, scope
  `gallery | timeline`, project_id, capture_ids[] (gallery), revoked_at. **Access
  simply follows the content**: an erased/deleted capture is no longer visible via
  the link (deletion is the revocation), and `revoked_at` kills the link — no
  expiry/rotation scheme needed (`hadar 2026-07-17`).
- **Feed** — a **read projection** over capture-commit events + dispositions + a
  light **activity-event** row for mutable updates (status/label/membership); still
  not a second source of truth.
- **Company** *(NEW tenant)*, **Member**, **Notification**, **Page**,
  **Disposition**, **ProjectParty** — Member/Notification/Page/Disposition/
  ProjectParty already in `SPEC §8`; **Company/tenant boundary is net-new** (RLS +
  cross-org controller model = open, §11).
- **Static map** — no schema; derived from `Project.lat/lng` at render.

**Content ownership & lifecycle — the simple rule (`hadar 2026-07-17`, this is
the decision; do not over-model it):**
- **The creator owns their content and can delete it at any time.** Ownership is
  the creator, not a tangle of capturing-org / host-org / controller — there is
  one owner.
- **Exception — approval freezes.** Once an item was a **request that got
  approved**, it is **muted/frozen and can no longer be removed** (mandate #1: an
  approved record is permanent). Only the approval trigger locks it; nothing else.
- **Projects: archive, don't delete, when non-empty.** A project with anything
  assigned to it is **archived, never deleted**; an **empty** project can be
  deleted.
- **Erasure ends access — no separate link machinery.** When content is
  deleted/erased, anyone who had access (including via a share link) simply can no
  longer see it. **Deletion is the revocation.** No token expiry/rotation scheme is
  required for that.
- The mandate #5 mechanics still hold underneath (hard-delete of personal content
  + retained hash/metadata stub; vendor-retention/backup as residual boundaries) —
  but the *product rule* the user experiences is the four bullets above.

**Stack-split (`CLAUDE.md §5`) — ✅ SIGNED OFF 2026-07-17.** **Append-only evidence
→ owned outbox** (captures, decisions, COs, tags, comments); **mutable rows →
PowerSync** (status, labels, membership, company). The earlier contradiction
(CLAUDE §5 "needs sign-off" vs SPEC §0 "PowerSync deferred") is reconciled: SPEC §0
now states the split. Any new table picks its transport by this one line.

---

## 7. Non-goals (explicit)

- **Payment processing** — integrate QuickBooks/Jobber; do not build.
- **On-photo drawing / markup / measurements** — text notes only for now.
- **Interactive maps / native map SDK** — static images only.
- **Wearables/headsets** as a dependency (mandate #7).
- **Full CRM / scheduling / estimating** — out, per `CLAUDE.md §5`.

---

## 8. Verification — where this PRD stands against the 8 criteria (`VERIFICATION_PLAN.md` Part A)

**This is a status table, not a pass claim.** The 2026-07-17 Codex cross-check
(logged in `IMPLEMENTATION_NOTES.md §4`) showed an earlier version over-certified
itself. Honest state: this PRD is **ready to decompose into per-REQ build specs**,
**not** yet fully criteria-clean — each REQ needs a build spec (with a failure
matrix) before it is "dev-ready."

| Criterion | Status | Gap owed at build-spec time |
|---|---|---|
| 1 Traceable | **Met** | Traces resolved to real UC/REQ IDs (§9); the wrong ones (VAL6, COLLAB3, PM7) fixed. |
| 2 Testable | **Partial** | Some Accept lines still use soft terms ("within a tick", "working link", "reach first capture") — build specs must set thresholds/fixtures. |
| 3 Hands-free | **Partial** | Per-surface touch budgets stated (NAV1/GAL2/PROC8); the **end-to-end capture→proposal-correct→read-back→send budget is NOT yet stated** and must meet `REQ-X1 ≤3`. |
| 4 Never-lose-it | **Partial** | Immutability + erasure carve-out now stated; offline **working-set/prefetch/eviction** for the grid/viewer is undefined (§11). |
| 5 Confirm-don't-automate | **Met (spec-level)** | `REQ-CO-WIRE` requires an explicit human read-back action + a negative test that no code path sets `numbers_confirmed_at` without it. |
| 6 Scope discipline | **Gap** | Waves are themes, not milestones. Each wave still needs decomposition into small, single-provider, individually-reviewable slices with exit gates before it is a solo-build plan. |
| 7 Hard-parts honesty | **Gap** | Failure modes are named for some REQs but **incomplete** (notifications, collaboration, share-links, static-map, auth transitions). Each needs `Approach:`/`Fallback:` at build-spec time. |
| 8 Risk ledger | **Partial** | New risks logged in `IMPLEMENTATION_NOTES §4`; the three-tier ledger must still add multi-tenant RLS, public-link leakage, sync-split consistency, token lifecycle, push delivery, cross-org erasure. |

**Process gates (`VERIFICATION_PLAN.md` Part B/C):** the **Codex cross-model
critic has now been run** (2026-07-17, real CLI) and reconciled in
`IMPLEMENTATION_NOTES.md §4`. Build-time gates per REQ: W3's `REQ-PROC8` inherits
the AI entry gate (U4/U3) — structuring accuracy numbers measured before "done";
capture-touching REQs test with generated media (this dev machine has no
mic/camera) plus a field test.

---

## 9. Traceability index — new use-case IDs (registered in `MASTER-USE-CASES.md`)

New (now present in the MASTER use-case table): `AUTH-1`, `AUTH-2`, `ORG-1`,
`PM-14` (labels), `VIEW-1` (grid), `VIEW-2` (viewer), `VIEW-3` (user tags),
`MAP-1` (static map), `NAV-1` (tab bar), `SHARE-1` (live timeline link).
Reused: `EVID-2` (retrieval — GAL1 builds on it; `EVID-3` named-bundles is **not**
implemented by GAL1), `EXP-7` (gallery, P2→promoted, W4), `PM-2/6/8`,
`COLLAB-1/2/5`, `NOTIF-1`, `DEC-1`, `APPR-1..4`, `CO-1`, `COMM-3`.
Net-new REQs that are **not** clean elevations (per the Codex pass): `REQ-ORG1`
(tenant), `REQ-ROLE1` (role model change), `REQ-COMMENT1` (comments),
`REQ-CO-WIRE`, `REQ-GAL1..5`, `REQ-MAP1`, `REQ-NAV1`, `REQ-AUTH1/2`, `REQ-PROC8`,
`REQ-PM14`.

## 10. Reversal log (`CLAUDE.md §3`)

- **`REQ-PM4`**: Active/Archived-only → `lead → in-progress → complete → archived`
  + user labels. The 4-state enum is the single target; 2-state is a render
  collapse, not a competing schema. Sign-off: hadar 2026-07-17. Logged in
  `IMPLEMENTATION_NOTES.md §2`, noted at `PM-LAYER.md` REQ-PM4 + `SPEC §8`.
- **`REQ-PM13` role model** (office/field/sub) → **owner/crew/sub-GC + no-login
  client** (`REQ-ROLE1`). A model change, not a label. Sign-off: hadar 2026-07-17.

## 11. Design decisions — mostly DECIDED (hadar 2026-07-17); one genuine open item

The Codex pass raised five as "blocking." Four were over-modelled and the user
**decided them simply** (encoded in §6 "Content ownership & lifecycle" and the
relevant REQs):

1. ✅ **Ownership** — the **creator owns their content** and can delete it, except
   an **approved request is frozen** (mandate #1). No capturing/host/controller
   tangle. Projects: archive-not-delete when non-empty, delete when empty.
   *(Resolves `REQ-ORG1`, `REQ-PM4`, erasure.)*
4. ✅ **Share-link security** — **erasure ends access; revoke kills the link.** No
   expiry/rotation machinery. *(Resolves `REQ-GAL4/GAL5`.)*
5. ✅ **Offline media** — **on-device-only content isn't in the global system
   yet**; the grid shows synced + local, no prefetch obligation. *(Resolves
   `REQ-GAL1/GAL2`.)*
3. ◑ **Roles** — model is settled (owner/crew/sub-GC + no-login client); the only
   build-spec detail left is server-as-authority on tenancy (an offline client
   can't self-escalate) — a **build-spec** item, not blocking.

2. ✅ **Outbox-vs-PowerSync split — SIGNED OFF 2026-07-17.** Append-only evidence →
   owned outbox; mutable rows → PowerSync. The doc contradiction (`CLAUDE.md §5` vs
   `SPEC §0`) is reconciled (both now state the split). No longer open.

**All five original "blocking" decisions are now resolved.** Everything else (per-REQ failure matrices, thresholds on soft Accept terms) is a
**build-spec** obligation per REQ, not a blocking decision.
