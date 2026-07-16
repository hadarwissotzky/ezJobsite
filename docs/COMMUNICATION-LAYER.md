# Hilo — Communication Layer (core feature)

*Streamlining communication of decisions between project parties, beyond the jobsite, so the job keeps moving. Captured from hadar 2026-07-15. Composes the capture core, language, handler, approval, notification, and collaborator layers into one purpose: **get the right decision to the right party fast, in their language, and get it approved so work continues.** ✅ = as specified · ❓ = open.*

---

## 1. Purpose

The job stalls when a decision is stuck — waiting on the owner to say yes, on the engineer to answer, on the inspector to sign off. This layer's job is to **move decisions between parties fast enough that work never has to stop or proceed at-risk**. It's the connective tissue: capture → native language → route beyond the jobsite → verify / approve → recorded → job continues. `[✅ hadar]`

The four steps you named map cleanly:
1. **Collect information** — the capture core (`SPEC §6.1`).
2. **In native languages** — the language layer (`LANGUAGE-LAYER.md`); each party sends and receives in their own tongue, English-canonical.
3. **Communicate beyond the jobsite** — routing a decision to the right off-site party for **verification** or a **mini change order** (so the job continues), or a **daily / weekly / inspector report**.
4. **Get approval** — the closing sign-off (the Approval Spectrum).

---

## 2. The party × intent matrix (who communicates what, to whom)

| From (field) | To (off-site) | Intent | Needs approval? |
|---|---|---|---|
| Foreman/crew | **Owner** (homeowner / project owner) | Decision-of-record → **verify**; **mini change order** / full change order → **approve** | verify: light · CO: yes |
| Foreman/crew | **Back office / engineer** | Decision / **RFI** (question) → answer; info | no (answer) |
| Foreman/crew | **Inspector** | Inspection / condition **report** | sign-off |
| Field | **Sub / collaborator** | Shared decision / directive (collaborator layer) | acknowledge |
| System | Owner / office / inspector | **Daily / weekly reports** on cadence | no |

Recipients derive from the disposition type + the project's known parties (PM layer), and are confirmable before send. `[✅ hadar step 3]`

---

## 3. Communication intents

- **Verification** — FYI / "confirm this is what we agreed" — no money, lightweight (decision-of-record, directive acknowledge). *Approval Spectrum: light.*
- **Mini change order** — a **fast, small "proceed" so the job continues** (see §4). *Approval Spectrum: quick priced approval.*
- **Change order** — the full priced, approvable CO. *Approval Spectrum: priced approval.*
- **Report** — daily / weekly / inspector, communicated out on cadence or on demand.
- **RFI / question** — a question routed up the chain (engineer/architect), answer captured back.

---

## 4. The mini change order (the differentiator)

**The problem (from the research):** crews proceed on *verbal* change orders because getting a signed CO is slow — and it burns them (losses of $39k, $70k, $150k cited; "never proceed on verbal" is the near-unanimous advice, yet they do, because stopping is worse). `[trace: change-order-painpoints-synthesis #2 "verbal CO trap"; CCD; small-CO threshold]`

**The answer:** a **mini change order** — a stripped-down CO with minimal fields (scope + rough price/NTE + who-directed), sent for **one-tap approval so the crew keeps working** — documented approval made **as fast as a verbal "go ahead."** It can **escalate to a full CO** later if needed. This directly maps to the field-tested tools in the research: the **CCD** ("proceed now, settle cost later, NTE $X") and the **small-CO threshold** ("how small is too small"). `[✅ hadar "mini change order so job can continue"]`

*Why it matters: it removes the reason crews go at-risk. If the documented path is as fast as the verbal one, they'll take the documented path — and stop eating undocumented extras.*

---

## 5. Requirements

- **COMM-1 — Route by party + intent.** A disposition (decision / CO / mini-CO / report / RFI) is routed to the right party(ies), derived from its type + the project's parties, and **confirmable before send**. `[✅; P1.5]`
  - Accept: a decision proposes the correct recipient(s); the sender can adjust before sending.
- **COMM-2 — Verification vs. approval intent.** Each communication carries an intent — **verify** (no sign-off) or **approve** (decision / mini-CO / CO / inspector sign-off). `[✅; P1 for light verify · P1.5 for approve]`
  - Accept: a verify item records an acknowledgement; an approve item requires the Approval Spectrum sign-off.
- **COMM-3 — Mini change order (fast-path).** A lightweight CO (scope + rough price/NTE + who-directed) sent for **one-tap approval to keep the job moving**, escalatable to a full CO. `[✅; P1.5 · gate U4/U6]`
  - Accept: a mini-CO is created + sent + approvable in a fraction of the full-CO effort; approval is timestamped; escalation preserves the record.
- **COMM-4 — Report cadence out.** Daily / weekly / inspector reports are generated and communicated to the relevant party on a **schedule or on demand**. `[✅; P1.5/P2]`
  - Accept: a daily/weekly report can be sent to the owner/office; an inspector report to the inspector.
- **COMM-5 — Beyond-the-jobsite delivery, in-language.** Communications reach off-site parties on **their own device** (no-login link + notification), rendered in **their preferred language** (language layer). `[✅; P1.5; ties LANGUAGE-LAYER + REQ-A2]`
  - Accept: an owner gets a notification + no-login link, in their language; canonical stays English.
- **COMM-6 — Keep-the-job-moving latency + status.** The verify / mini-CO path is optimized for **fast turnaround**; the field sees live status (pending / approved / declined) so they know whether to proceed. `[✅ hadar "so job can continue"]`
  - Accept: the field sees the response state on each sent item; the verify/mini-CO path is low-friction end to end.
- **COMM-7 — Everything recorded.** Each communication + its response (verified / approved / declined, timestamp, identity) is an immutable record (evidence). `[✅; ties REQ-A3, EVID]`
  - Accept: every sent item and its outcome is a timestamped, retrievable record.

---

## 6. Phasing
- **P1:** the light **verification** loop already ships in the P1 validation loop (decision-of-record, directive → confirm on counterparty device).
- **P1.5:** routing by party/intent (COMM-1/2), **mini change order** (COMM-3, gate U4/U6), in-language off-site delivery (COMM-5), status/latency (COMM-6), record (COMM-7). Full change order + signature approval are the P1.5 handlers this rides on.
- **P2:** report cadence/scheduling (COMM-4) and RFI routing, per the expansion set.

---

## 7. Open questions
1. **Mini-CO threshold/definition** — what makes a change "mini" (a dollar ceiling, a time-sensitivity flag, user's choice)? Ties to the small-CO threshold research.
2. **Report cadence** — automated schedule (e.g., every evening) vs. on-demand only in v1?
3. **RFI loop** — is the question-up-the-chain (engineer/architect answer) in the near-term set or P2 expansion?
4. **Proceed-at-risk guardrail** — should the app actively discourage proceeding before a mini-CO is approved (a nudge), given the research says at-risk work is where crews lose money?
