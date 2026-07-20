# PRD / doc reconciliation — the v1 source-of-truth map
**Owner: Hadar | 2026-07-20**

*Written because v1 was described across several docs that partly overlapped and partly
contradicted. This names what each doc owns, redistributes the old `PRD-companycam-parity`
into the two new product PRDs, and records the decisions that resolve the conflicts — so
nothing silently disagrees. Governed by `CLAUDE.md`'s mandates, which override everything
below.*

---

## 1. The structure (one picture)

```
            CLAUDE.md  — the 10 non-negotiable mandates (govern all)
                 │
   SPEC-capture-core-v1.md  — durability, commit state machine, evidence chain
   DURABILITY-DESIGN-v1.md     (the FOUNDATION both PRDs stand on)
                 │
        ┌────────┴─────────┐
  PRD-jobsite-field-record   PRD-change-approval-loop   ← the TWO product PRDs
     (the daily habit)          (the money loop, Fable)
        │                          │
        └────────── promote ───────┘   ← the seam: a Capture becomes an Item
        (a jobsite Capture is promoted into an Extra/Decision; both keep it)

   DEMOTED → PRD-companycam-parity.md  (no longer a source of truth; redistributed §4)
   Supporting → CAPTURE-UX-SYNTHESIS · PM/LANGUAGE/COMMUNICATION-LAYER · PRICING-STRATEGY
```

**One product, two PRDs, one capture front door.** The jobsite record is the default
destination for a capture; the wedge is a *promotion* from it. Neither is a second capture
system — they share one Project and one Capture stream.

---

## 2. Source-of-truth table (who owns which question)

| Question | Owning doc |
|---|---|
| Can we lose a capture? / commit state machine / evidence chain | **`SPEC-capture-core-v1` + `DURABILITY-DESIGN-v1`** |
| The 10 mandates (never-lose, confirm-don't-automate, offline, English-canonical, …) | **`CLAUDE.md`** |
| The daily field-record surface (timeline, evidence panel, auto-file, home, share) | **`PRD-jobsite-field-record`** |
| The money loop (structure → send → discuss → approve → record, EWA, ledger, delivery) | **`PRD-change-approval-loop`** |
| The seam (Capture → Item promotion) | **both** — specified in jobsite §6, consumed by wedge R2/R3 |
| Capture UX (fused screen, stamp, authenticity look) | **`CAPTURE-UX-SYNTHESIS`** (design) → shipped as `REQ-CAP-FUSED` |
| Pricing / seats / who pays | **`PRICING-STRATEGY`** |
| Language pivot mechanics | **`LANGUAGE-LAYER`** (mandate #5) |
| CompanyCam parity backlog | **nobody — DEMOTED**, redistributed below |

If two docs seem to answer the same question, this table wins; escalate a genuine
contradiction here rather than editing one doc to match the other silently.

---

## 3. Resolved conflicts (the decisions)

1. **CompanyCam feature-parity scope → CUT.** `[hadar 2026-07-20]` The old parity PRD tried
   to match CompanyCam's whole surface. That is scope creep against `CLAUDE.md §5` ("stay
   deep on capture + approval + language; don't build full PM"). Resolution: the
   documentation spine (capture · auto-file · timeline · evidence · share) is owned by the
   **jobsite PRD**; the rest (broad feed, collaborators-at-scale, full PM) is **non-goal or
   P2**. Not "clone CompanyCam" — build the jobsite record + the wedge.

2. **Project creation → learned-GPS, no address-entry model.** `[hadar 2026-07-20]` Both new
   PRDs agree: a project is created implicitly at first activity and **learns its GPS from
   that first capture/send — no address typed, ever.** Consequence: the **address
   autocomplete built 2026-07-19 is demoted to an optional fallback**, not the model. Keep
   the GPS-learn + suggest-never-decide logic (it matches mandate #8); the address field is
   a convenience for when someone wants to type one, not a required setup step.

3. **Capture entry → capture-FIRST.** `[hadar 2026-07-20]` Fable R1 is explicit: recording
   starts *before* a job is chosen; assignment happens at the preview (jobsite: auto-file by
   GPS; wedge: "Send to" suggestion). The **current build captures *inside* a project** —
   this shifts to capture-first. Logged as a build change, not a contradiction: the capture
   front door is one screen; where the capture lands is decided *after*, by GPS.

4. **The atomic unit → TWO units, one seam.** Reconciles the apparent clash between
   `CLAUDE.md` ("the atomic unit is the jobsite decision moment / the Capture") and Fable
   ("the atomic unit is the Item = Extra/Decision"). Resolution: **both are true at their
   layer.** The **Capture** is the atomic unit of the *jobsite record* (immutable evidence);
   the **Item** is the atomic unit of the *wedge* (priced/committed). A Capture is **promoted**
   into an Item, which references it; both records keep the capture. No rename, no loss of
   the append-only evidence chain.

5. **E-signature → typed-name is the v1 instrument; mandate #2 is satisfied by it, pending
   legal.** Fable's "typed-name + audit trail" is *lighter wording* than mandate #2's
   "digital signature — binding, verifiable." Resolution: mandate #2's "digital signature"
   **is** the typed-name + immutable snapshot + audit trail bound to the record — that IS the
   binding instrument. Whether it clears the ESIGN/UETA enforceability bar is **Fable Q1, a
   BLOCKING legal open question** (§5), not a build contradiction. Do not ship the approval
   as legally binding until Q1 is answered.

6. **Durability → the SPEC remains the authority; the PRDs inherit, never restate.** Fable is
   a *product* PRD and is deliberately thin on durability ("nothing is ever lost", R1). That
   sentence **inherits** the `SPEC`/`DURABILITY-DESIGN` commit state machine (`MEDIA_COMMITTED`,
   fsync+verify, the outbox) — it does not redefine or weaken it. **Watch:** if the Fable PRD
   is ever read as the sole source of truth, this omission would quietly erode mandate #1.
   This reconciliation is the guard: the SPEC owns durability, full stop.

---

## 4. `PRD-companycam-parity` redistribution (the demotion map)

The parity PRD is no longer a source of truth. Every REQ in it lands in exactly one place:

| Old parity REQ | Destination | Notes |
|---|---|---|
| `REQ-AUTH1/2` (accounts, owner-pays) | **Foundation (shared)** | Prereq for both PRDs; built. |
| `REQ-ORG1` (company/tenant), `REQ-ROLE1` (roles) | **Foundation (shared)** | Both consume; tenancy = server authority. |
| `REQ-PM4` (project lifecycle), `REQ-PM14` (labels) | **Jobsite PRD** | The job is the documentation container. |
| `REQ-GAL1` (grid) | **Jobsite `REQ-JOB1`** (timeline) | Reframed as the field record, not a gallery. |
| `REQ-GAL2` (viewer) | **Jobsite `REQ-JOB3`** (evidence panel) | + authenticity surface. |
| `REQ-GAL3` (tags) | **Jobsite `REQ-JOB7`** | Built. |
| `REQ-MAP1` (static map) | **Jobsite `REQ-JOB10`** | |
| `REQ-GAL4/GAL5` (share, live timeline) | **Jobsite `REQ-JOB9`** | Read-only client link. |
| `REQ-NAV1` (bottom nav) | **Jobsite (app shell)** | Serves both; lives with the daily-open home. |
| `REQ-PM9` (company feed) | **Jobsite `REQ-JOB5`, TRIMMED** | A "job list that shows life," NOT a social river. |
| `REQ-NOTIF1` (notifications) | **Wedge R8** (green-light) + jobsite activity | Mostly the wedge's payoff push. |
| `REQ-COMMENT1` (comments) | **Wedge R5b** (on-record discussion) | The negotiation thread supersedes generic comments. |
| `REQ-PM-E` (collaborators at scale) | **P2 / deferred** | Fable: single-approver in v1; sub→GC is one approver, not a chain. |
| `REQ-PROC8` (proposal review) | **Wedge R2** | Structure → editable preview. |
| `REQ-CO-WIRE` (CO/confirm/sign) | **Wedge R3 + R6** | + the EWA two-step (net-new in Fable). |
| `REQ-VAL8` (delivery channel) | **Wedge R5** | SMS/email + no-account web page. |

Net: parity's **documentation REQs → jobsite PRD**; its **wedge REQs → Fable PRD** (which
adds the EWA flow and the discussion loop it lacked); its **broad social/collab → cut/P2**.

---

## 5. Mandate check (do the two new PRDs honor the non-negotiables?)

| Mandate | Verdict |
|---|---|
| #1 Never lose a capture | ✅ via the SPEC foundation; **watch** Fable's thin restatement (§3.6). |
| #2 Confirm, don't automate | ✅ Wedge: human confirms price (R2), signs (R6); model never sets a price. **Legal Q1 blocks binding claim.** |
| #3 Hands-free budget | ✅ capture-first, one-tap (R1); jobsite fused screen shipped. |
| #4 Structuring is the product | ✅ both PRDs center voice→structured; transcription stays a commodity. |
| #5 English-canonical + per-user | ✅ Wedge R13 matches exactly; `LANGUAGE-LAYER` owns mechanics. |
| #6 Numbers are highest-risk | ✅ Wedge: price never guessed (R2), read-back before send. |
| #7 Offline-forward | ✅ both: capture local-first; address/geocode/timeline degrade offline. |
| #8 Project resolution is a layer | ✅ both: learned-GPS, suggest-never-decide (Fable R1 = mandate #8 verbatim). |
| #9 GPS+time stamp | ✅ jobsite `REQ-JOB2/3` (built), Timemark-grade. |
| #10 Human-in-the-loop | ✅ every priced/committed act is human-confirmed; crew review-before-send (R15). |

No new PRD violates a mandate. The two places to watch are logged: Fable's durability
brevity (#1) and the e-sign legal bar (#2).

---

## 6. Open decisions carried forward (not blocking the docs, blocking the build)

1. **[Legal — BLOCKING launch]** Typed-name e-sign enforceability (Fable Q1). Nothing ships
   as legally binding until answered.
2. **[Product]** The **promote UX** (jobsite §6) — one tap from a capture, or from the
   structured proposal card? The seam both PRDs touch; specify once.
3. **[Product]** How much daily-open **home/feed** is P0 vs P1 (jobsite Q2) — keep it a
   job-list-that-shows-life to avoid the CompanyCam bloat we just cut.
4. **[Build]** Migrate capture-inside-project → **capture-first** (§3.3) — a real UI change
   to the shipped app.
5. **[Build]** Demote the **address-entry field** to optional (§3.2).

---

## 7. What changes in the repo

- **`PRD-companycam-parity.md`** — banner added: DEMOTED, see this doc; retained for history.
- **`CLAUDE.md §6` file map** — should gain the two new PRDs + this reconciliation (a small
  edit, do when the structure is confirmed).
- No code changes are forced by this doc; items 4–5 in §6 are the build follow-ups.
