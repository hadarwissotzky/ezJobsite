# Analysis — CompanyCam's AI Checklists & AI Walkthrough Notes

*Teardown of two shipped CompanyCam features (from hadar's screen-recordings + 3 screenshots, 2026-07-15), read through the Hilo lens: what they are, the mechanics worth stealing, and what they do — and crucially don't — do to our wedge. Connects to `companycam-love-and-wedge.md`, `hilo-voice-first-research.md`, `hilo-competitive-analysis.md`.*

---

## 1. The headline

CompanyCam has now shipped **voice → structured document** and **voice → checklist** — the exact capture→structure pipeline our product is built on. The voice-first research **predicted this** ("CompanyCam already ships AI voice-to-report… voice input itself is not a moat"). It's now real and polished. **This moves the AI walkthrough-note and checklist from *differentiator* to *table stakes*.**

**But — and this is the whole game — both features stop at *documentation and organization*. Neither becomes a *transaction*.** There is no price, no binding counterparty approval, no change order, and (confirmed again here) no *capture-in-Spanish → structured-English record* — their translation is an **export-time display** option, not a capture transaction. Our wedge is intact; it's just been made sharper and narrower.

---

## 2. Feature A — AI Checklists (voice → to-do list, voice → complete)

**Create:** open project → To-Dos → + → Checklist → "Talk" → speak the work freely ("sweep the pool area, take out the trash, skim the pool, test the chemical levels"). **Pause/resume** to talk to people or move areas, then keep adding to the *same* checklist. Hit Done → **AI groups items into organized sections**. Review/edit, or **assign to crew members**.

**Complete (the clever part):** the crew completes it **by voice too** — hit the mic, say what's done ("we swept the area and took out the trash, but did *not* skim the pool yet") → **AI matches the voice note to the checklist fields and marks them complete**, including the *negative* ("not yet"). **Photo proof** can be attached during that same voice note (new photo or from the gallery).

**Why it's strong:** it closes the loop both ways in voice — creation *and* completion — and the completion-matching (mapping free speech to specific fields, honoring "did not") is genuinely hard and well done.

---

## 3. Feature B — AI Walkthrough Notes (voice + photos → report)

**Flow:** homepage → sparkle icon → pick project → **Start Walkthrough** → walk the site, **talk + snap photos**; the AI builds a text summary that lives *alongside* the photos. Screenshot 2 shows the capture screen with mode tabs **SCAN · AI NOTE · PHOTO · VIDEO** and the promise "*Talk, snap, get organized… Hit 'Done' to get a document you can edit and share.*"

**The standout mechanic — pause = section break.** Hitting stop pauses audio capture (screenshot 1: *"Listening Stopped — You can still take photos"* + Resume). Two purposes: (1) speak to a client/crew without it entering the report; (2) **pausing then resuming forces a new section header** — the user structures the document by *when they pause*, and the AI sorts notes+photos by type of work / location. Elegant: the structuring gesture is the same one you'd make anyway.

**Output (screenshot 3):** a clean document — title ("Task List: Remove Sound Panel, Turn Off Light, Lock Door"), a **section header** ("Sound panel removal and site security"), bulleted items, and a **strip of the photos** taken during that section. Editable on mobile/web (undo/redo). Three-dot menu: **add cover page, export PDF / web link, translate to other languages, table of contents, save as template, or create a checklist** from the notes.

**Notable:** the sample output is literally a *Task List* generated from a walkthrough — i.e., **one disposition derived into another** (walkthrough note → checklist). And "translate on export" confirms language is a **display** feature for them, not a capture transaction.

---

## 4. Mechanics worth stealing (design patterns)

1. **Pause = section break.** The best idea here. A single natural gesture (pause to talk to someone) doubles as document structure. In our model this is exactly a **timeline marker** (`SPEC §6.2 REQ-TL3`) — adopt pause/resume as the primary structuring gesture over the timeline.
2. **"You can still take photos while paused"** — audio segmented, but photo capture never blocked. Maps to our timeline: photos anchor to the timeline even when the audio track is paused.
3. **Voice-to-complete with negation** ("did *not* skim the pool yet") — completion is a capture that gets *matched* to existing fields, and honoring the negative is the hard, high-trust part.
4. **Auto-section grouping** by work type / location — reduces the raw stream to a readable doc.
5. **Capture-mode tabs (SCAN/AI NOTE/PHOTO/VIDEO)** — one capture surface, multiple modes; validates our "one capture primitive, many modalities."
6. **Disposition-derives-disposition** — a walkthrough note can spawn a checklist. Our handler model should allow one disposition to generate another.
7. **Export/share/translate/ToC/save-as-template** — the "make it professional and reusable" tail.

---

## 5. What it means for Hilo — the wedge, sharpened

**Validates our P1 core.** The walkthrough capture (walk, talk, snap, pause/resume, timeline-placed photos) **is our P1 capture core in continuous mode** — CompanyCam is proof the timeline model and multimodal capture are the right primitive, and their pause=section-break gives us a proven UX for our timeline markers.

**Moves to table stakes (must match, no longer differentiators):** the AI walkthrough report, section auto-grouping, voice-created checklists, voice completion with photo proof, assign-to-crew, export/share.

**Where we still win (the differentiators CompanyCam's two features do *not* touch):**
- **The transaction, not the document.** Their checklist/report *organize*; they never produce a **priced, approvable, binding** object. Our Approval Spectrum (decision-of-record confirmed by the counterparty → signature → **priced change order**) is untouched. Their output is a to-do list; ours is an agreement.
- **Bilingual capture-as-transaction.** Confirmed again: CompanyCam translates on *export* (display). Capturing spoken **Spanish → structured English record** (source retained) is still nobody's.
- **Offline-first / never-lose-it.** Their AI flow reads as online/cloud ("Listening…", instant AI generate). Our offline-forward capture + process-on-reconnect + guaranteed-save is a reliability edge in the exact basements/roofs where they're weakest.
- **Per-crew learning** (accent, Spanglish, jargon, prices) — compounding, and not something a horizontal AI note touches.

**Strategic read:** don't try to out-*document* CompanyCam — match the walkthrough/checklist as table stakes and ride the same reflex one step further, into the **transaction + language + reliability** they've shown no interest in. This is the same wedge as before, now with sharper proof of exactly where their ceiling is.

---

## 6. Model implications (proposed additions)

1. **New handler: Checklist / Tasks.** Our handler set was Evidence / Approval / Change Order / Report. These features argue for a **Checklist/Task** handler: *create by voice* (auto-sectioned), *assign to members* (ties to PM roles/membership), *complete by voice + photo proof* (a new "completion capture" that matches speech→fields, honoring negation). Likely **P1.5**, on the processing + handler layer. `[proposed]`
2. **Enrich the Report handler** (`SPEC §7.3`) with the walkthrough-note flow: **pause=section-break**, auto-section grouping, timeline-placed photos, and the export tail (PDF/link, translate, ToC, **save-as-template**). `[enrich]`
3. **Dispositions can derive from dispositions** — a Report/walkthrough → a Checklist; a Decision → a Change Order. Add this to the handler model as a first-class relation. `[architecture]`
4. **Adopt pause/resume as the timeline structuring gesture** in capture (`REQ-TL3`), not just discrete marks. `[UX pattern → confirm in UX phase]`

---

## 7. Net-new use cases for the master catalog

| ID | Use case | Job | Phase | Note |
|---|---|---|---|---|
| **REP-6** | AI walkthrough note (walk+talk+snap → sectioned report) | R | P1 capture / P1.5 report | Capture is P1 core; report generation P1.5. |
| **REP-7** | Pause = section break (structure by gesture) | R | P1 | Maps to TL-3 markers. |
| **CHK-1** | Voice-create a checklist (auto-sectioned) | R/Task | P1.5 | New Checklist handler. |
| **CHK-2** | Assign checklist items to crew/members | Task | P1.5 | Ties to PM roles. |
| **CHK-3** | Voice-complete a checklist + photo proof (honor "not yet") | Task | P1.5 | Completion-capture matches speech→fields. |
| **CHK-4** | Derive a checklist from a walkthrough note | R→Task | P1.5 | Disposition→disposition. |
| **REP-8** | Export/share/translate/ToC/save-as-template | R | P1.5 | The "professional + reusable" tail. |

---

## 8. Open questions
1. **Add Checklist/Tasks as a first-class handler?** (vs. a Report sub-type, vs. defer to P2.) It also overlaps punch-list (EXP-1) and daily-log tasks.
2. **Priority** — is the walkthrough note + checklist a P1.5 fast-follow (right after the core loop), or later? CompanyCam shipping it is an argument for sooner (table stakes to be taken seriously).
3. **Pause=section-break** — adopt as the core capture-structuring gesture now (bake into the timeline model), or leave to the UX phase?

*Resolution (2026-07-15): Checklist = first-class handler; walkthrough+checklist generation = P1.5 (capture already P1); pause=section-break adopted into the timeline model, interaction finalized in UX phase.*

---

## 9. Addendum — CompanyCam overview video (broad feature tour)

Mostly **confirmatory** of the competitive picture; captured here so it's on record.

**Already covered by our model:** cloud storage + free-of-phone-storage (table stakes), team invite + **permissions** (PM roles), GPS "nearest addresses" project creation (PM-1/REQ-P1), auto-organize by date/time/**person** (authorship REQ-PM-C), voice notes on photos + tags + annotations/drawings (capture), search/filter by tag/user/label/date (retrieval), before/after templates (EVID-3 bundle), checklists + **photo checklist that requires a photo to complete** (CHK-3 — note the "required-to-complete" *rule* variant), signature request/track (Approval), timeline feed / gallery / **PDF photo report** (Report/REP), **Pages** = collaborative notebook + AI overview docs/summaries (our Page + Report).

**Net-new worth noting (not necessarily building):**
- **Pages as a collaborative notebook** — a shared rich doc surface; we adopted "Page" as the pictures+text presentation of a disposition (owner-approval view). CompanyCam uses it more broadly as a team notebook — a possible Report-adjacent surface later.
- **Document storage (scan/upload bills, bids, contracts)** — a "never lose a document" vault. Adjacent; likely integrate/defer, not core.
- **@mention notifications** — folded into the Notification seam (NOTIF-1).
- **Photo-required-to-complete checklist rule** — a completion *gate* on CHK-3.

**Reaffirmed DO-NOT-BUILD (they have it; we integrate, not rebuild):** payments/invoicing, 50+ integrations/Zapier/Chrome extension. Staying deep on capture + decision + transaction + language is the strategy; these are the all-in-one trap.
