# PRD: EZjobsite v1 — The 60-Second Change Approval Loop
**Owner: Hadar | Status: Draft | July 2026**

*Authored with Fable 5, adopted as the primary v1 spec for the money loop. Companion to
`PRD-jobsite-field-record.md` (the daily-habit half). Both sit on `SPEC-capture-core-v1.md`
(durability foundation) and are governed by `CLAUDE.md`'s mandates. See
`PRD-RECONCILIATION.md` for how this maps onto the older `PRD-companycam-parity.md` REQ IDs.*

***UI source of truth `[hadar 2026-07-21]`:** the interactive prototype (contractor app c1–c6 +
client web link h1–h4) is the design reference this PRD's surfaces are specified against — the
same prototype `apps/mobile/src/ui/theme.ts` lifts its tokens from. Requirements added from it
are marked `[design prototype 2026-07-21]`. The prototype specifies **presentation**; it never
overrides a mandate, and where it appeared to (a generated decision narrative) the guardrail is
written into the requirement itself — see R6c.*

---

## Problem Statement

Small residential remodelers (2–10 employees) routinely perform extra work on verbal
approval and fail to collect on it—industry data shows ~35% of projects hit a major scope
change and most changes are poorly documented, with disputes over change orders the single
largest source of construction litigation. The existing fix (formal written change orders)
fails in practice because it requires stopping work, going to a laptop, and making the
homeowner sign paperwork—so it doesn't happen. The cost of not solving it: thousands of
dollars per year in unpaid extras per contractor, plus rework from unconfirmed decisions.

**Scope note:** EZjobsite is a **contractor-only mobile app**. There is no client app and
never will be—the client (homeowner, GC, or property manager) receives a plain SMS/email
link that opens a mobile web approval page in the browser they already have. Everything in
this PRD builds one native app (contractor) plus one responsive web approval page (client).
"Homeowner-facing" throughout means that web page, not an app.

## The Winning Workflow (the product IS this loop)

**Capture → Structure → Send → Approve → Record. Under 60 seconds for the contractor,
under 3 taps for the homeowner.**

1. **Capture (contractor, on site, ≤30 sec):** Opens app, taps one button, talks: *"Found
   subfloor rot under the tub, needs replacement before tile—about six hours plus materials,
   eighteen fifty."* Optionally snaps 1–3 photos. Done—puts phone away.
2. **Structure (system, ≤15 sec):** Voice → structured change order: scope description,
   price term, project reference, photos attached. Contractor sees a preview card, can edit
   any field, taps Send.
3. **Send (system):** Homeowner receives an SMS (fallback: email) with a link—no app, no
   account, no download. Link opens a mobile page: scope, price, photos, Approve / Ask a
   question.
4. **Approve (homeowner, ≤3 taps):** Taps Approve, types name (typed-name e-signature),
   submits. Timestamp, IP, and exact approved content are recorded immutably.
5. **Record (system):** Both parties get a PDF confirmation. The change joins the project's
   running ledger: original contract + approved changes = current total, visible to both
   parties at all times.

**Why this loop wins:** it removes the two reasons change orders don't get written
(contractor friction, homeowner friction) and produces exactly the artifact that ends
he-said/she-said: a timestamped record of what was described, what was priced, and who
approved it—**before** the work happened.

## Data Model (the hierarchy, unambiguous)

- **Account** (company) → has **Members** (seats: owner, crew) and **Projects**.
- **Project** = client contact (name, phone, role) + job label + learned GPS location.
  Created implicitly at first send. Owns many **Extras**.
- **Item** (the atomic unit) has a **type: Extra or Decision**, belongs to exactly one
  Project, and owns:
  - **Assets:** photos (narration-timestamped), source audio, native + English transcripts
  - **Log history:** append-only event timeline (captured by, sent by, delivered, opens,
    reminders, revisions, approval/decline with signature)
  - **Communication:** the on-record message thread (with translation markers)
  - **State:** Draft → Sent → Viewed → In Discussion → Approved / Declined / Superseded,
    plus version lineage (supersedes → superseded-by)
- **Extra** = the contractual kind: has a price + mode (Fixed / NTE / EWA). Counts in the
  project's money totals. This is a strict agreement between the practitioner and the
  project owner.
- **Decision** = the ambiguity killer: no price. Confirms a selection or spec (color,
  height, layout) before work proceeds; prevents rework. Lives in the project's decision
  log, never in money totals.
- One Item, one approver. Nothing else in the system owns anything.

## Goals

1. **G1 — Speed:** Contractor completes capture→send in ≤60 seconds, measured p75, by end
   of beta.
2. **G2 — Approval velocity:** ≥70% of sent changes approved within 24 hours (leading
   indicator that homeowner flow is frictionless).
3. **G3 — Habit:** ≥60% of active contractors send ≥3 changes/month by month 2 of use.
4. **G4 — Money proof:** Each active contractor can see a "recovered extras" total ≥ their
   annual subscription cost within 90 days (retention driver + marketing engine).
5. **G5 — Zero homeowner drop-off from friction:** ≥90% of homeowners who open the link
   complete approve or question (no account walls, no confusion).

## Non-Goals (v1)

1. **Full project management** (scheduling, tasks, budgets)—Buildertrend's territory;
   entering it kills the wedge.
2. **Estimating/proposals**—EzQuote Pro's domain; integration is a P2, not a v1 feature.
3. **Payments/collection**—approve now, invoice elsewhere. Payment rails add compliance
   scope and delay launch. (P2: "request deposit on approval.")
4. **Multi-party approval chains**—one extra always has exactly one approver. (Single-
   recipient extras from a sub to a GC ARE in scope: the approver is a contact with a role,
   not hardcoded "homeowner.")
5. **Android homeowner app / any homeowner app**—homeowner side is web-link only,
   permanently by design.
6. **Qualified e-signature (KBA, certificate-based)**—typed-name + audit trail (ESIGN/
   UETA-style consent language) is the v1 bar; legal review is an open question, not a
   build item.

## Users

- **Contractor owner (primary):** owner-operator remodeler or trade contractor; buys,
  prices, sends.
- **Crew member (P1):** foreman/lead who captures conditions on site; may or may not have
  send rights (owner setting).
- **Approver (secondary):** any contact who approves—homeowner, GC, or property manager,
  labeled by role; must require zero learning. The approval flow is identical regardless of
  role.
- **Office admin (P1):** views ledger, exports PDFs, chases unapproved items.

## User Stories (priority order)

**Contractor**
- As a remodeler on a jobsite, I want to record a change by talking for 20 seconds so that
  I don't have to stop work to do paperwork.
- As a remodeler, I want the app to turn my words into a clean, priced change order I can
  review before sending so that nothing goes out wrong.
- As a remodeler, I want to choose how the price is expressed—fixed or not-to-exceed—so
  that I can match how confident I am in the scope.
- As a remodeler who can't price a discovery on site, I want the homeowner to sign an Extra
  Work Authorization immediately—confirming the work is billable and whether we hold or
  proceed under a capped hourly rate—so that I'm protected before I price it at the desk
  tonight.
- As a remodeler, I want to attach photos of the condition so that the approval is
  indisputable later.
- As a remodeler, I want a running total per project (contract + approved changes) so that
  the final invoice is never a surprise to anyone.
- As a remodeler, I want to see which changes are still unapproved and nudge with one tap
  so that work never proceeds unapproved by accident.
- As a remodeler in a dead zone, I want my capture saved offline and sent when I get signal
  so that the jobsite basement doesn't break the workflow.
- As a remodeler, I want a library of common extras for my trade (rot, code upgrades, panel
  issues) with prewritten scope language so that structuring is even faster and my wording
  is dispute-proof.

**Homeowner**
- As a homeowner, I want to open a text link and see exactly what's being asked, what it
  costs, and photos of why so that I can decide in one minute without an account.
- As a homeowner, I want to ask a question instead of approving so that I'm not forced into
  yes/no.
- As a homeowner, I want a copy of everything I approved and a running project total so
  that I trust the final bill.

**Edge cases**
- As a contractor, I want to void/supersede a sent change (never edit in place after
  sending) so that the record stays trustworthy.
- As a homeowner, I want to decline with a reason so that the contractor knows not to
  proceed.

## Requirements

### P0 — Must-have (cannot ship without)

**R1. One-tap voice capture (capture before filing)**
- Capture IS the home screen. The trigger moment is "I need to send this extra right now so
  I don't forget"—so recording starts before any client/job is chosen. Assignment ("Send
  to") happens on the preview card afterward, via recents or quick-add (name + phone).
- Capture is a **session**, not a clip: the contractor can pause and resume recording, and
  snap photos mid-session without stopping the audio—walk the site, talk, shoot, keep
  talking. Session cap 10 minutes of recorded audio. Photos taken in-session auto-attach to
  the extra and are timestamped against the narration.
- AC: Given a recording in progress, when the contractor taps Pause, then audio stops, the
  session persists (survives app backgrounding), and Resume continues the same session.
- AC: Given a recording in progress, when the contractor taps the camera, then the photo is
  taken without interrupting audio and appears in the session's photo strip with its
  narration timestamp.
- AC: Given a paused session, when the app is killed or the phone dies, then the partial
  session is recovered on next open as a draft—nothing recorded is ever lost.
- **GPS project matching (suggest, never decide):** location is read once at capture. Each
  project silently learns its location from its first send—no address entry ever. On later
  captures, if one known project is within range, "Send to" is pre-filled with a visible
  "📍 Detected—you're at the [name] job" marker; if two or more are within range, a picker
  is shown; if none, recents. The suggestion is always one tap to override, and Send always
  displays the recipient name.
- Location is captured only at the moment of capture—no background tracking of the
  contractor, ever.
- **Capture stays one tap away everywhere `[design prototype 2026-07-21]`.** Capture is the
  home screen (above), *and* a persistent floating Capture control sits on the secondary
  contractor screens (job ledger, extra record) so starting a new extra never requires
  navigating home first. It is deliberately absent while a capture flow is already in progress
  (recording, review, paywall) — offering "capture" mid-capture is noise — and absent from the
  client-facing web page. Serves mandate #3: the reflex must not depend on where you are.
- AC: Given the contractor is on a job ledger or an extra record, when they tap the floating
  Capture control, then a new capture session starts immediately.
- AC: Given a capture flow is already in progress, when any of its screens render, then the
  floating Capture control is not shown.
- AC: Given one known project within GPS range, when the preview renders, then that project
  pre-fills Send-to with the detected marker and can be changed in one tap.
- AC: Given two projects within range (e.g., duplex), when the preview renders, then a
  two-option picker appears—the system never auto-selects between them.
- AC: Given GPS is unavailable (basement, permission denied), when the preview renders, then
  recents are shown and capture is unaffected.
- AC: Given the app is cold-opened, when the contractor taps Capture and speaks, then
  recording works with zero prior selection; client assignment is requested only at preview.
- AC: Given no connectivity, when a capture is completed, then it is queued locally and
  auto-sent on reconnect, with a visible "queued" state.

**R2. Voice → structured change order**
- System extracts: scope description (plain language, cleaned up), price term, and price
  mode. Contractor sees an editable preview card.
- AC: Given a voice note containing scope and a dollar amount, when structuring completes,
  then scope and amount fields are pre-filled and the contractor can edit every field before
  sending.
- AC: Given the transcript lacks a price, when the preview renders, then the price field is
  empty and flagged—never guessed.
- Photo placement: photos are aligned to the narration segment during which they were taken;
  the structured scope shows each photo beside the text it evidences (fallback: photo strip
  at end if alignment is ambiguous).
- V1 produces one extra per session. If the narration clearly describes multiple distinct
  extras, structuring flags it ("Sounds like 2 extras—split them?"); actual auto-split is P1
  (see R14).
- Technical note: reuse the EzQuote Pro pipeline patterns (Deepgram + tiered Claude routing
  + prompt caching); target ≤15s structure time.

**R3. Price modes and the two-step authorization flow**

*One-step (price known on site):*
- **Fixed:** single amount.
- **Not-to-exceed (NTE):** cap amount + mandatory auto-inserted line: "Work will not exceed
  $X without a new approval." (A bare "range" is never offered—range approvals reproduce the
  dispute at billing time.)
- AC: Given mode = NTE, when the homeowner view renders, then the NTE clause appears above
  the Approve button and in the PDF.

*Two-step (price not knowable on site):* **Extra Work Authorization (EWA) → Price Approval.**
An EWA is a signed approval, never an FYI—the homeowner commits to billability and proceed
terms before the price exists.
- **Step 1 — EWA.** Contains: condition description + photos; the binding statement "This
  work is outside the contracted scope and will be billed as an extra"; ONE proceed term
  selected by the contractor:
  - **Hold:** "Work in this area pauses until the price is approved." (Schedule impact of
    delay sits with the homeowner.)
  - **Proceed, T&M-capped:** "Work proceeds at $X/hr plus materials, not to exceed $Y, until
    a fixed price is issued." (For urgent conditions where stopping isn't viable.)
  - Plus the settlement rule: "The detailed price will follow within [24/48]h and, once
    approved, supersedes and settles this authorization."
  - Homeowner approves with the same mechanics as any change (typed name, timestamp,
    immutable snapshot). Question/Decline available.
- **Step 2 — Price Approval.** A standard fixed or NTE change order that references its
  parent EWA; approval closes the EWA. Ledger shows EWA and its settlement as one linked
  item.
- **Investigate-first is an EWA subtype:** the authorized work is the diagnostic itself, at
  a small fixed price (or $0); the repair follows as its own change (one-step or a new EWA).
- AC: Given an EWA is sent, when the homeowner opens it, then Approve is only possible after
  the proceed term and settlement rule are displayed; the record is labeled "Extra Work
  Authorization," not "change order."
- AC: Given an EWA with proceed = T&M-capped is approved, when the Step 2 fixed price is
  approved, then the EWA status = "Settled" and the ledger shows only the settled amount in
  the money total (T&M cap shown as history).
- AC: Given an EWA is approved and no Step 2 is sent within 48h, when the contractor opens
  the app, then the EWA is flagged "Unpriced—send price" prominently; auto-reminder to the
  contractor (not the homeowner).
- AC: Given an EWA was declined, when the contractor views the project, then the item shows
  "Declined—do not proceed" and is excluded from totals.

**R4. Photo attachment**
- 0–8 photos per extra, captured in-session (see R1), in-app after, or from library;
  compressed for SMS-link load speed.
- AC: Given photos attached, when the homeowner opens the link, then photos load in ≤3s on
  LTE.

**R5. SMS/email delivery + no-account web approval**
- The recipient is a contact with a role label—Homeowner, GC, Property manager, Other—chosen
  at send. Approval page language is role-neutral ("outside the contracted scope" works for
  any client relationship); the role is stored on the record.
- The page always identifies sender as company + person: "Kowalski Remodeling — sent by
  Dave."
- Approval page: project name, sender identity, scope, price + mode, photos, Approve / Ask a
  question / Decline. Mobile-first, loads ≤2s.
- AC: Given a change is sent, when the homeowner taps the SMS link, then the approval page
  opens with no login, no download, no personal data entry beyond typed name at approval.
- AC: Given the homeowner taps Ask a question, when they submit text, then the contractor is
  push-notified, the change status = "In Discussion," and the message joins the on-record
  thread (see R5b).

**R5b. Feedback loop — on-record discussion and revision**
- "In Discussion" is a first-class status between Sent and Approved/Declined—negotiation is
  expected behavior, not an edge case.
- Thread mechanics: homeowner and contractor exchange messages attached to the specific
  change document. Every message is timestamped and becomes part of the immutable record
  (both parties see: "This discussion is part of the project record").
- The Approve button remains pinned and functional for the homeowner at every point in the
  thread—approval is always one tap away and always applies to the current version only.
- Contractor has two moves from a thread: **Reply** (in-thread) or **Revise & Resend**
  (issues a superseding version; the thread carries across versions with a visible "Revised:
  $1,850 → $1,500" marker).
- Price changes resolve only through revision + fresh approval—never through thread
  agreement ("ok, $1,500" in chat is not an approval and the UI never treats it as one).
- Offline negotiation is expected: after a phone call, the contractor issues a revision
  reflecting the agreement; the record captures the outcome even when the discussion
  happened off-app.
- Notifications: a homeowner question triggers an immediate push to the contractor that
  deep-links into the extra's thread with the reply field focused—answering takes two taps
  from the lock screen. An unanswered question is surfaced on the home screen until resolved;
  the extra remains "live" (flagged, top of list) until Approved or Declined.
- AC: Given a homeowner question arrives, when the contractor taps the push notification,
  then they land in that extra's thread ready to reply or revise.
- AC: Given a change is In Discussion, when the contractor sends a revision, then the
  homeowner receives a new SMS, the old version shows "Superseded," and the full thread is
  visible on the new version.
- AC: Given a thread exists, when either party views the approved change's record/PDF, then
  the discussion log appears with timestamps beneath the approved snapshot.
- AC: Given the homeowner approves mid-discussion, when the approval is recorded, then it
  binds the current version's exact snapshot and the thread closes to new messages (record
  preserved).
- AC: Given a change is In Discussion >48h with no contractor response to the latest
  homeowner message, when the contractor opens the app, then the item is flagged "Awaiting
  your reply."

**R6. Approval record + event timeline (the legal artifact)**
- Every extra carries an append-only event timeline: sent (channel), delivered, opened (each
  open logged with timestamp and count), question/reply messages, revisions, reminders,
  approved/declined. Capture events include a one-time location stamp ("captured on site")
  when GPS was available—additional evidence the condition was documented at the job. The
  timeline is a first-class screen on the extra for the contractor—"opened 3 times, no
  response" is actionable signal.
- On approve: typed-name signature, server-side timestamp, the exact content approved
  (immutable snapshot), and the full event timeline bound to the record. PDF generated to
  both parties includes the discussion log beneath the approved snapshot.
- AC: Given an extra was opened twice and questioned once, when the contractor views it,
  then the timeline shows each event with timestamps in order.
- AC: Given a change was approved, when either party opens its record later, then they see
  the identical immutable snapshot; post-send edits are impossible—only void + reissue.
- AC: Given a change is voided, when the homeowner opens the old link, then it clearly shows
  "Superseded" and links to the current version.

**R6b. The extra record screen (one screen answers "what is this and where does it stand")
`[design prototype 2026-07-21]`**
- R6 establishes the timeline as a first-class screen. This specifies what else that screen
  must carry, because "the timeline" alone does not answer the questions a contractor opens
  the record to ask. Ordered top-to-bottom:
  1. **Identity + state:** item title, type (Extra/Decision), status chip, amount + price mode
     (or "No cost change" for a Decision). The amount is labeled as *the contractor's price* —
     the system never authors a price (mandate #6, R2).
  2. **Current state, in plain language:** one line saying what is true now and what is owed
     next ("Discussing — opened 3× today, awaiting her approval"). A status chip alone is a
     label; this is the instruction.
  3. **People on this record:** the **approver** (name + role label — Homeowner/GC/Property
     manager/Other, per R5), **captured by**, and **priced/sent by**, each with its timestamp.
     R15 already records captured-by/sent-by on the internal timeline; this surfaces them as a
     first-class block, because "who recorded this" is the first thing asked when a record is
     questioned. The approver-facing page still shows company + sender only (R15 unchanged).
  4. **Description:** the English canonical scope, with a one-tap toggle to the source-language
     original (mandate #5, R13).
  5. **Photos:** the attached evidence (R4).
  6. **Decision summary:** see R6c.
  7. **Full history:** the append-only event timeline from R6, unabridged, beneath the summary.
- The summary and the history are never alternatives: the summary is the fast read, the history
  is the evidence. Both are always present on the same screen.
- AC: Given an extra with a capturing crew member and a separate sender, when the contractor
  opens its record, then approver (with role), captured-by, and priced/sent-by are each shown
  with timestamps.
- AC: Given an item of type Decision, when its record renders, then no price is shown anywhere
  on the screen and the money block reads "No cost change" (R10).
- AC: Given a record in any state, when it renders, then the plain-language state line names
  the next owed action, not just the status word.

**R6c. Decision summary — a derived narrative, never a new fact
`[design prototype 2026-07-21]`**
- **The need:** when an item passes through several hands (crew captures, owner prices, client
  questions, owner answers, client approves), the raw timeline is accurate but slow to read.
  The summary is a short plain-language account of *how this item reached its current state and
  who did what* — the thing a contractor would say out loud if asked "where is this?".
- It names the participants and their contribution ("Marco captured it · you priced and
  explained · Sarah raised a question"), states the outcome so far, and ends on what is owed.
- **Guardrails (this is a generated narrative, so it is fenced):**
  - **Derived only from logged events.** Every clause must trace to an event already in the R6
    timeline or a field on the record. It may compress and re-word; it may never introduce a
    fact — no inferred motive, no predicted outcome, no invented number. Mandate #6: a dollar
    figure in the summary is a *restatement* of the record's own field, never a fresh reading
    of a transcript.
  - **Never the binding instrument.** The signed snapshot (R6) is the legal artifact. The
    summary is a reading aid and is labeled as derived; it carries no signature and appears
    nowhere in the approver's signed content or the PDF's snapshot section.
  - **Never blocks the record.** If the summary cannot be produced (offline, model
    unavailable), the record renders complete without it — the timeline is the source. The
    summary is additive, never a dependency (mandate #7).
  - **Regenerates, never rewrites.** New events produce a new summary; the underlying events
    are untouched (mandate #1's append-only chain is not in scope for summarization).
- AC: Given an item whose timeline contains capture, price, send, question, and reply events,
  when the record renders, then the summary names each participant's contribution and ends
  with the currently-owed action.
- AC: Given the summary cannot be generated, when the record renders, then every other section
  including the full history is present and the record is fully usable.
- AC: Given an approved item, when its PDF is produced, then the signed snapshot and discussion
  log appear (R6) and the derived summary does not appear inside the signed content.
- **Open:** whether the summary is generated on-device, server-side at event time, or on
  render — an eng call, not a product one. Tracked in §Open Questions.

**R7. Projects and the extras ledger (extras only)**
- Every extra belongs to a project; a project = client + job name (e.g., "Sarah Miller —
  Hall bath") and holds many extras. Projects are created implicitly at first send via
  quick-add (name + phone + job label)—there is no project setup screen. Later extras select
  the project from recents.
- The app never holds the base contract—it has no access to it and doesn't ask. Per project:
  approved extras + pending extras = extras total. Visible to contractor always; to
  homeowner via any approval link ("Extras you've approved on this job").
- **Ledger order = create date, newest first `[design prototype 2026-07-21]`.** The job's
  extras are ordered by when the extra was **created** (the capture moment), most recent at
  top, and **each row shows its create date**. Rationale: the items needing action are almost
  always the newest, and ordering by status would reshuffle the list under the contractor as
  states change — a list that moves is a list you stop trusting. The decision log (R10) uses
  the same order. Create date is the *capture* time, not the send or approval time; those
  remain visible on the row and in the record's history (R6).
- AC: Given a project with extras created on different days, when the ledger renders, then
  rows appear newest-created first and each row displays its create date.
- AC: Given an extra changes status (sent → discussing → approved), when the ledger re-renders,
  then its position in the list does not move.
- AC: Given a quick-add at first send, when the extra is sent, then a project exists and
  appears in recents for the next capture.
- AC: Given 3 approved extras on a project, when the contractor opens it, then approved
  total, pending total, and per-item statuses (approved/pending/discussing/declined/
  superseded) are shown—no contract fields anywhere.

**R8. Pending-approval nudges**
- Statuses: Draft → Sent → Viewed → In Discussion → Approved/Declined/Superseded. One-tap
  reminder resend; auto-reminder at 24h (configurable off). Auto-reminders pause while
  status = In Discussion (nagging mid-negotiation damages the relationship).
- **Green-light push:** the moment an approver signs, the contractor (and the capturing crew
  member) receive an immediate push—"✅ Approved: Subfloor rot repair · $1,850 — Sarah
  Miller"—and the extra moves out of the waiting list. This is the product's payoff moment;
  it is never batched or delayed.
- AC: Given an extra is approved, when the signature is recorded, then the push is delivered
  within seconds, deep-links to the approved record, and the home screen reflects the new
  status on next open.
- **Nudges to the approver:** manual "Remind" anytime (max 2 automated + unlimited manual,
  rate-limited to 1/day per extra); reminder copy points at the action ("Dave is waiting on
  your approval for: Subfloor rot repair — $1,850"), always via the same link.
- AC: Given a change is Sent and unviewed for 24h, when auto-remind is on, then one reminder
  SMS is sent and logged (max 2 total reminders).
- **In-app notification centre `[design prototype 2026-07-21]`.** Push (above) reaches the
  contractor when the app is closed; this is the same activity when it is open. A bell in the
  home top bar carries an **unread count**, and opens a list of recent activity — client
  questions, approvals/declines, reminders sent — newest first, each row naming the item and
  its job. **Every row deep-links to the record it refers to** (R6b), landing on the same
  screen the push would have opened, so an unanswered question is at most two taps from
  anywhere. Rows carry the same colour semantics as the chips (question = accent, approved =
  approve-green, informational = muted). Mark-read is available; unread state is per-device
  and never alters the item's own status or its timeline.
- AC: Given an unanswered client question exists, when the contractor opens the app, then the
  bell shows an unread count and the question is the first row in the notification list.
- AC: Given the contractor taps a notification row, when it opens, then they land on that
  item's record (R6b) — the same destination as the push deep-link.
- AC: Given the contractor marks notifications read, when the item list is re-read, then no
  item's status, timeline, or approval state has changed.

### P1 — Nice-to-have (fast follows)

**R9. Trade extras template library**
- Prewritten common-extras cards per trade (remodeler set first: subfloor rot, drywall
  behind demo, code-required GFCI/venting, plumbing rerout, framing surprises, allowance
  overrun). Each = title + dispute-proof scope language + suggested price mode. Contractor
  picks card, speaks/enters price, sends.
- AC: Given the contractor selects "Subfloor rot" template, when the preview renders, then
  scope language is pre-filled and only price requires input; total capture→send ≤30s.
- AC: Templates are editable and save-as-own; custom templates sync per account.

**R10. Decision approvals (the rework killer)**
- Same capture, same approval mechanics, no price. Structuring infers the type: narration
  containing a price → Extra; confirmation language without money ("confirm the vanity
  height at 34 inches") → Decision. The preview card shows the inferred type with a one-tap
  flip; Decision previews hide the price field entirely.
- Approver page for Decisions is visually distinct: "Confirmation — no cost change," with
  the spec stated plainly and photos beside it. Approve records signature + timestamp like
  any item.
- Decisions appear in the project's decision log, never in money totals; the green-light
  push fires for Decisions too ("✅ Confirmed: vanity height 34" — Sarah Miller").
- AC: Given a capture with confirmation language and no price, when the preview renders,
  then type = Decision is pre-selected, no price field is shown, and the contractor can flip
  to Extra (which reveals the price field).
- AC: Given an approved Decision, when the project is viewed, then it appears in the decision
  log with its signature and is excluded from all money totals.

**R11. Office view (web)** — read-only ledger, PDF export, CSV export for bookkeeping.

**R12. "Recovered extras" counter** — running total of approved change value on the
contractor dashboard; the retention/marketing number.

**R13. Cross-language capture and approval**
- Contractor speaks in their language (Spanish first; architecture language-agnostic); the
  system structures AND translates in the same step. The homeowner-facing page renders in
  English.
- English is canonical for the record: the approved snapshot is the English page the
  homeowner signed. The original audio + native-language transcript are attached to the
  record as source material.
- Verification before send: the preview card shows the contractor the English output with a
  one-tap toggle back to their language—the contractor must be able to confirm what the
  homeowner will read before sending.
- Thread is two-way: homeowner messages auto-translate into the contractor's language and
  vice versa; every translated message carries a visible "translated" marker, with the
  original retrievable on tap by either party.
- App chrome (buttons, labels) localizes to the contractor's language on their side;
  homeowner side stays English (P2: homeowner language preference).
- AC: Given a capture spoken in Spanish, when the preview renders, then scope/price fields
  are filled in English with a toggle showing the Spanish source, and Send is enabled only
  after the preview has been displayed.
- AC: Given a homeowner question in English, when the contractor's push arrives, then the
  notification and thread show the contractor's language with a "translated" marker; tapping
  the marker reveals the English original.
- AC: Given an approved extra with Spanish source audio, when the PDF is generated, then the
  approved English snapshot is the signed content and the record notes "captured in Spanish;
  original transcript attached."

**R14. Walkthrough auto-split**
- When one session's narration describes multiple distinct extras, structuring proposes a
  split: separate preview cards, each with its own scope, price, and the photos taken during
  its narration segment. Contractor confirms/merges before sending; each sends as its own
  approval to the same project.
- AC: Given a session describing two distinct extras, when structuring completes, then two
  preview cards are proposed with photos correctly partitioned by narration timestamp, and
  the contractor can merge them back into one.

**R15. Team seats: capture-only role + review-before-send**
- Accounts support multiple seats. Every extra records *captured by* and *sent by*; the
  internal timeline shows both ("Captured by Marco · sent by Dave"). The approver-facing
  page shows company + sender only.
- Owner setting "Review before send": when on, crew captures land as drafts in the owner's
  queue; the owner prices, edits, and sends. When off, all seats can send.
- AC: Given review-before-send is on, when a crew member completes a capture, then it
  appears in the owner's queue as a draft with the crew member's name and the owner is
  notified; the crew member cannot send it.
- AC: Given a team account, when any extra is viewed internally, then captured-by and
  sent-by are both visible with timestamps; the approver-facing record never exposes the
  internal split.

### P2 — Future considerations (design for, don't build)

- **QuickBooks export** of approved changes as invoice line items (design: stable
  change-order IDs and amounts now).
- **Deposit-on-approval** payment link (design: keep approval and payment as separate events
  in the data model).
- **EzQuote Pro handoff** — proposal → project seed with base contract amount (design:
  shared project schema).
- **GC↔sub mode** — multi-party approval chains (design: approver is an entity, not
  hardcoded "homeowner").
- **Homeowner-side language preference** (approval pages in languages other than English;
  English capture is covered in R13).

## Success Metrics

**Leading (weekly during beta):**
- Time capture→send: p75 ≤60s (measure in-app)
- Structure accuracy: ≤20% of previews require any field edit
- Homeowner completion: ≥90% of link-opens end in approve/question/decline
- Approval <24h: ≥70%
- Activation: first change sent within 24h of install ≥60%

**Lagging (monthly):**
- Changes sent per active contractor: ≥3/mo by month 2
- Logo churn <4%/mo; "recovered extras" ≥ annual sub cost within 90 days for ≥70% of actives
- Referral/organic share of new signups ≥30% by month 6 (footer + word-of-mouth working)

## Open Questions

1. **[Legal — blocking before launch]** Confirm typed-name e-sign + audit trail meets
   ESIGN/UETA enforceability bar for residential change orders; confirm required consent
   language on the approval page. State-level review for launch states.
2. **[Legal — non-blocking]** Some states regulate home-improvement contract amendments
   (e.g., notice/rescission language). Determine if the PDF needs state-specific footers.
3. **[Resolved]** Base contract amount: not collected, ever. The app has no access to the
   contract and the ledger is extras-only. (Was: required vs optional at project creation.)
4. **[Eng — non-blocking]** SMS sender identity and A2P 10DLC registration timeline—affects
   deliverability at launch.
5. **[Product — non-blocking]** Reminder cadence defaults: is 24h auto-remind on-by-default
   acceptable to contractors' client relationships? Test with design partners.
6. **[Design — non-blocking]** Contractor branding on homeowner page (logo/color) in v1 or
   P1? Leans P1 unless design partners flag trust issues.
7. **[Eng — non-blocking]** Where the R6c decision summary is produced: on-device at render,
   server-side at event time (cached on the record), or in the durable-jobs pipeline. Affects
   offline behaviour — the requirement already mandates the record stays usable without it, so
   this is a cost/latency call, not a correctness one. `[hadar 2026-07-21]`
8. **[Product — non-blocking]** Ledger ordering is create-date-newest-first (R7). If design
   partners in the field ask to see a job's extras in the order the job unfolded (oldest
   first), that is a per-user preference, not a default change — revisit after beta.
   `[hadar 2026-07-21]`

## Timeline & Phasing

- **Build order:** R1–R2 (capture+structure) → R5–R6 (delivery+record; the legal artifact is
  the product) → R3–R4 → R7–R8. Beta gate: all P0 complete.
- **Dependencies:** legal e-sign review (Q1 above) before public launch; A2P registration
  started at beta start.
- **Phasing rule:** nothing from P1 starts until G1, G2, G5 are green with design partners.
  The loop must be boringly reliable before templates and decision approvals.
