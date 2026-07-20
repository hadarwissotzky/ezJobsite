# PRD: EZjobsite — The Jobsite Field Record (the daily habit)
**Owner: Hadar | Status: Draft | July 2026**

*Companion to the wedge PRD (`PRD: The 60-Second Change Approval Loop`). This one owns
the OTHER half of the product: the daily on-site documentation surface the product is
literally named for. It sits on the durability foundation in `SPEC-capture-core-v1.md`
and reframes the "jobsite documentation" parts of `PRD-companycam-parity.md` from
"match CompanyCam feature-by-feature" into "the jobsite field record as a product."*

---

## 0. Why this exists (and why it's separate from the wedge)

A contractor's day happens **on the jobsite, not at a desk.** The thing that ends
"who said what," rework, and disputes is a **record of what the job actually looked
like, day by day** — timestamped, located, kept. CompanyCam won a category by being
the app a crew opens *every day* to document; that daily habit is what earns the app a
place on the home screen at all.

The wedge PRD covers the **money loop** (capture → price → approve → record). But the
money loop only works if two things are true, and neither is the wedge's job:

1. **The daily habit exists** — someone opens the app on days with *no* change order,
   because documenting the job is itself the reason. (Habit → the wedge's activation.)
2. **The evidence base exists** — a priced change stands on photos + narration of the
   condition *before* the work. Those come from the daily record, not the change order.

So the product has two halves that share **one capture front door**:

| | **Jobsite field record** (this PRD) | **Change-approval wedge** (Fable PRD) |
|---|---|---|
| Loop | capture → **auto-file → keep** | capture → price → send → **approve** |
| Value | habit + evidence (protect from miscommunication) | money (the priced, signed extra) |
| Unit | the **Capture** (a field record moment) | the **Item** — Extra/Decision |
| Frequency | every day | when a capture carries a price/commitment |

**Jobsite documentation FEEDS the wedge:** any capture on site can be *promoted* into an
Extra or Decision. The seam between the two is one action (§6). This PRD is why someone
opens EZjobsite on a Tuesday with nothing to bill.

---

## 1. Locked decisions (this PRD's ground truth) `[hadar 2026-07-20]`

1. **The jobsite record is a product surface, not a byproduct.** It has its own home,
   timeline, and daily-open value — independent of whether a change order ever follows.
2. **One capture front door** — the fused capture screen (talk + snap, multi-snap
   walkthrough) already built. The jobsite record is the *default* destination; the
   wedge is a *promotion* from it.
3. **The client never gets an app.** They see a **read-only shared timeline link** (web),
   consistent with the wedge's "web-link-only" rule.
4. **This is not full CompanyCam.** We build the daily-record spine (capture · auto-file ·
   timeline · evidence · share), not the broad PM surface. `CLAUDE.md §5` governs.
5. **The evidence layer is the moat, not the photo.** Every capture is GPS+time stamped
   (mandate #9), integrity-hashed, and shown with an intact/tampered verdict — the
   Timemark-grade "this is what was there, then" that makes the record worth something in
   the argument it exists to prevent.

---

## 2. Actors

- **Crew / field (primary here):** on site, captures conditions, progress, and decisions.
  Free seat (`PRICING-STRATEGY`). The jobsite record is *their* surface.
- **Owner:** sees the whole job's record across projects; the daily-open dashboard.
- **Client / collaborator:** **read-only via link** — the shared, auto-updating job
  timeline. No login, no app.

---

## 3. The jobsite loop (the daily habit)

**Open → capture → it files itself → it joins the job's record → everyone sees it.**

1. **Open to capture.** The camera/voice capture is the reflex — one tap to the fused
   screen (talk + snap, walk the site). No "which job?" first — capture never waits.
2. **It files itself (mandate #8).** GPS resolves the capture to the right job silently;
   ambiguity → a one-tap picker; no fix / no match → the Inbox, never lost.
3. **It joins the record.** The capture lands in the job's **reverse-chron, date-grouped
   timeline** — photo, voice, text, each stamped and evidence-verified. Zero filing.
4. **Everyone on the job sees it.** Crew and owner locally; the client via the shared
   timeline link. The record *is* the shared source of truth.

Contrast: the wedge loop *stops work to price and get a signature*. The jobsite loop
*never stops* — it's the ambient record. Most captures are just the record; a few carry
a price and get **promoted** to the wedge (§6).

---

## 4. Requirements

### P0 — the daily-record spine

- **REQ-JOB1 — Per-project field record (timeline).** A reverse-chron, **date-grouped**
  record of a job's captures — photo (frame), video (extracted still, per `REQ-TL4`),
  voice/text as labelled tiles; one tap opens the viewer. *(Elevates `REQ-GAL1`; this is
  the jobsite record's home, not a gallery feature.)* `[mandate #8; REQ-EVID2; REQ-GAL1]`
  - AC: the timeline renders the job's resolved captures newest-first under date headers;
    a filed-from-Inbox capture moves to the right job; on-device + synced only, with a
    "not downloaded" placeholder for a synced-but-absent blob (mandate #7). Offline never
    blocks the timeline.

- **REQ-JOB2 — Fused capture as the front door (BUILT).** Talk + snap on one screen,
  multi-snap walkthrough, continuous narration; every capture GPS+time stamped and baked
  Timemark-style. *(This is `REQ-CAP-FUSED` — already shipped; named here as the jobsite
  record's entry.)* `[mandate #3, #7, #9]`

- **REQ-JOB3 — Evidence panel + authenticity (the moat).** The viewer shows who/when/
  where + GPS stamp + SHA-256 + **intact/tampered verdict**, surfaced as a plain
  "Authentic" state (Timemark's photo-code pattern). A tampered/unreadable capture is
  shown loudly, never hidden. `[mandate #1, #9; REQ-GAL2; REQ-CAP-AUTH]`
  - AC: every capture shows its stamp + integrity verdict; a not-downloaded blob shows a
    placeholder, not a crash; works offline for local media.

- **REQ-JOB4 — Auto-file by GPS (BUILT, named).** Captures resolve to the job by location
  with zero manual filing; ambiguity → picker; no-match → Inbox. `[mandate #8; REQ-P1/P2]`

- **REQ-JOB5 — The daily-open home.** A lightweight home: **your jobs** (cover photo,
  last-activity, capture count, static-map thumbnail) + recent activity — enough to make
  opening the app on a quiet day worth it. NOT a full social feed; a *job list that shows
  life*. `[REQ-PM9 (trimmed); companycam home]`
  - AC: the home lists the user's jobs newest-active-first with a cover + count; one tap
    opens the job's timeline; role scope applies (crew = own jobs).

- **REQ-JOB6 — Search & retrieve by job + recency.** Find a job by name/address; find a
  capture within a job by recency/tag. `[REQ-EVID2; PM-7]`

### P1 — the record that wins arguments

- **REQ-JOB7 — Capture tags (BUILT).** Free-form tags on a capture; filter the timeline.
  Append-only, retract-not-delete. `[REQ-GAL3]`
- **REQ-JOB8 — Progress documentation.** Before/after and phase framing so the record
  proves the work was done right (the warranty/dispute artifact), not just that a
  condition existed. `[companycam progress; mandate #1]`
- **REQ-JOB9 — Shared job-timeline link (read-only, auto-updating).** A no-login web link
  to the job's timeline that new captures appear on without re-issuing; owner can revoke;
  erasure ends access. `[REQ-GAL5; SHARE-1]`
- **REQ-JOB10 — Static map per job.** A pinned static map thumbnail on the job card +
  header; unpinned → neutral placeholder; offline → placeholder, never blocks. `[REQ-MAP1]`

---

## 5. Data model (extends `SPEC §8`, shares the wedge's)

- **Project (the job)** — client contact + label + **learned GPS** (consistent with the
  wedge's "project learns location from first activity"). Owns many **Captures**.
- **Capture (the atomic jobsite-record unit)** — append-only, immutable evidence: media
  blob(s) + stamp (GPS/time) + SHA-256 + modality + owner/role. Rides the **owned outbox**
  (append-only evidence → outbox; the stack-split rule). A walkthrough = a `capture_pair`
  group (BUILT).
- **Item (Extra/Decision)** — the **wedge** unit. **A Capture is promoted into an Item;**
  the Item references its source capture(s). The Capture stays the evidence; the Item
  carries the price/commitment. This reference IS the seam (§6).
- **Tag / ShareLink / Static map** — per `REQ-GAL3 / GAL5 / MAP1`.

The jobsite record and the wedge share **one Project and one Capture stream**; they differ
only in whether a capture has been promoted to an Item. No second capture system.

---

## 6. The seam: jobsite record → wedge (the promote action)

The single most important boundary in the whole product. A capture in the jobsite record
becomes money when the contractor **promotes** it:

- From a capture (or the structured proposal the pipeline already writes into
  `capture_structured`), a **"Turn into a change / decision"** action creates an **Item**
  referencing that capture. The pipeline's proposal (subject/scope/who — **never a price**,
  mandate #2/#4) pre-fills; the human sets the price and confirms (mandate #6 read-back);
  the wedge PRD's loop takes over from there (`REQ-PROC8 → REQ-CO-WIRE`).
- The capture **stays in the jobsite record** as evidence even after promotion. Promotion
  is additive, never a move — the field record and the money record both keep it.
- Most captures are **never** promoted, and that's correct: the daily record is the point,
  not a funnel to a change order.

---

## 7. Non-goals (explicit)

- **The change-approval transaction** — that's the wedge PRD. This PRD stops at *promote*.
- **Full PM / scheduling / estimating / invoicing** — `CLAUDE.md §5`; integrate, don't build.
- **A full social feed** — the home shows job life, not a company-wide activity river.
- **On-photo drawing / markup / measurements** — text notes only (deferred).
- **Interactive maps** — static images only.
- **A client app** — read-only web link, permanently.

---

## 8. Success metrics (the habit — distinct from the wedge's money metrics)

**Leading (weekly):**
- **Daily/weekly active capture:** % of active contractors who capture on ≥3 days/week.
- **Captures per active job per week:** the record is *filling* (target set with partners).
- **Time-to-first-capture** after opening a job.
- **Auto-file hit rate:** % of captures GPS-resolved without a manual pick (mandate #8 is working).

**Lagging (monthly):**
- **Jobs with a living record:** % of active jobs with ≥10 captures.
- **Client timeline-link opens:** the record is being *shown*, not just kept (evidence value).
- **Habit → wedge:** % of active contractors who capture daily who also send ≥1 change/mo
  (proves the habit feeds the money loop — the reason this PRD exists).

---

## 9. What's built vs. new (honest state)

**Built and reusable:** the fused capture (`REQ-JOB2`), GPS auto-file (`REQ-JOB4`),
GPS/time stamps + baked overlay, SHA-256 integrity, capture-commit durability (mandate #1),
projects, tags, the flat capture grid, the owned-outbox sync.

**New (this PRD's scope):** the date-grouped **timeline** polish + not-downloaded state,
the **evidence/authenticity panel** surfaced as "Authentic", the **daily-open home**,
**search**, **progress/before-after**, the **shared timeline link**, the **static map**,
and the **promote-to-Item seam** (§6, shared with the wedge).

---

## 10. Open questions

1. **[Product] The promote UX (§6)** — one tap from a capture, or from the structured
   proposal card? This is the seam both PRDs touch; specify it once, here.
2. **[Product] How much "home/feed" is P0** vs P1 — the daily-open surface risks becoming
   the CompanyCam bloat we're avoiding. Keep it a job-list-that-shows-life until partners
   ask for more.
3. **[Legal/privacy] Shared timeline link** — same erasure/revoke model as the wedge's
   links (deletion is revocation); confirm no PII leaks in a job timeline shown to a client.
4. **[Product] Crew vs owner record scope** — crew sees own jobs; does the owner's daily
   home aggregate all jobs' activity, and does that re-introduce feed complexity?
