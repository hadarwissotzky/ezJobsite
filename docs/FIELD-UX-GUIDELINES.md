# Field UX Guidelines — phone + iPad, built for gloves and sunlight
**Owner: Hadar | 2026-07-20 | Applies to every screen EZjobsite ships**

*Apple's HIG is written for someone sitting indoors holding a clean phone. Our user is
in direct sun, wearing thick gloves, on a ladder, interrupted, and may not read English.
These guidelines override the platform defaults wherever they conflict. They are the
practical expression of `CLAUDE.md` mandates #3 (hands-free budget), #7 (offline-forward)
and the core design test: "would someone who doesn't think in software succeed here
without being taught?"*

---

## 0. The one finding everything hangs on

**The metric is not features — it's whether a crew opens the app on a live job.**

Crews try software for a week, find it slow or confusing, and fall back to texts and
paper. The failure is the software, not the crew. The sharpest designer's test:

> **If the app needs training sessions before a worker can use it, the design is wrong —
> not the worker.**

The honest adoption measure is *the percentage of work logged in the app versus
worked around via text/paper* — not sign-ups. **Everything below exists to make the app
beat a text message and a paper plan.** The apps crews resist are the ones that lead with
office-grade completeness.

---

## 1. Physical constraints (the non-negotiable numbers)

### Touch targets — glove-sized
| Element | Minimum | Notes |
|---|---|---|
| **Primary action** (capture, save, approve) | **60–72 px** | Platform's 44px causes mis-taps in PPE |
| Any interactive element | **48×48 px** floor | ~7mm; average fingertip is 16–20mm |
| **Spacing between targets** | **8–16 px** | Prevents the fat-finger adjacent hit |
| Destructive actions | 60px **+ separated** | Never adjacent to a frequent action |

Bias toward the **upper end (~2cm)** for anything used with gloves on. Expand the tap
region beyond the visible icon with padding/hitSlop rather than drawing a bigger box.

### Sunlight — light mode, not dark
- **Dark mode fails outdoors.** A dark screen becomes a mirror in direct sun. Ship a
  **high-contrast light theme** as the default; do not offer dark as the field default.
- **Body type: 16–18px minimum** (not the 12–14px desktop habit). Labels ≥ 12.5px only
  when uppercase + letterspaced (recognised as shapes, not read).
- **Contrast ≥ 4.5:1** for body text; ≥ 3:1 for large display type. Test in sun, not
  on a desk.
- You **cannot** control device brightness from inside the app. Contrast and colour are
  the only levers you actually have.
- **Exception:** a live camera viewfinder is necessarily dark — there, guarantee contrast
  with solid scrims behind any overlaid text, never text directly on the video.

### Gestures — single-tap or nothing
- **No multi-finger gestures, no precise pinch, no long-press-only actions.** Gloves and
  dust make them unreliable.
- Zoom via **expanded tap zones / explicit buttons**, not pinch-only.
- Prefer **voice** for anything that would otherwise be typing.

---

## 2. Navigational clarity (zero guesswork)

- **The one-second read.** A superintendent glancing at the screen must know what needs
  attention without reading. Use **consistent, saturated colour coding** app-wide:
  **green = confirmed · amber = needs attention · red = failed/blocked · blue = syncing.**
  A colour must mean exactly one thing everywhere.
- **No icon without a label.** Icons alone fail in the field — pair every icon with
  explicit text ("Home", "Capture", "Photos"). This also carries non-English readers
  further than icons alone.
- **Shallow navigation: 3–5 bottom tabs, maximum.** Core functions stay visible.
  Hamburger menus and deep submenus measurably kill adoption.
- **Role-based simplification.** The office needs the log; the person on scaffolding needs
  today's few tasks and a camera. Do not show one dense screen to both.

---

## 3. Sync trust (offline-first is architecture, not a cache)

**Caching** stores a few records temporarily. **Offline-first** means *the device's local
database is the source of truth and the network is an enhancement.* We already build this
way (mandate #1/#7) — these are the UX obligations that come with it:

- **Every action writes locally, immediately.** Never block on the network.
- **Sync state is always visible.** Ambiguity is dangerous: a worker unsure whether data
  synced will either re-enter it (duplicates) or assume it saved (gaps).
- **Be honest about what's actually on the device.** "Downloaded" that won't open offline
  destroys trust permanently. Prefer *"Last sync 3h ago"* over a green checkmark that
  might be lying.
- **Fail loudly.** Surface genuine conflicts to a human; never silently pick a winner.
- **Proof of delivery.** On submit, confirm explicitly — *"Office received your daily
  log"* — or the worker sends a follow-up text to check, which is the behaviour we're
  trying to replace.
- **Load only what's needed** (today's work, not the month) — it also keeps old phones fast.

**A documented failure to avoid:** a save button with no confirmation and no visual
reaction, leaving the user unsure whether it saved and hunting for the error.
**"Saved / syncing / failed" states are non-negotiable.**

---

## 4. Frictionless data entry (photo-first, typing-last)

- **Photos and voice are the primary inputs.** Typing is the fallback, not the default.
  CompanyCam's whole adoption story is making the timestamped, GPS-tagged, auto-organised
  **photo the atomic unit of work instead of a form**.
- **Voice is a real input, not a gimmick** — hands are full or gloved. Record on site
  offline, structure it when back in range.
- **Pre-fill from the device**: GPS for location, clock for time, profile for name. Never
  ask for what the phone already knows.
- **Right keyboard every time** (number pad for quantities, email keyboard for email).
- **Labels sit ABOVE inputs, never as disappearing placeholders** — the user must always
  see what a field is, mid-entry, distracted.
- **Every removed field raises completion.** Justify each one or delete it.

---

## 5. Phone vs iPad — do NOT force parity

The evidence splits cleanly by task. Design each for what it's good at, syncing to one
source of truth:

| | **Phone** | **iPad / tablet** |
|---|---|---|
| **Role** | Fast capture **in motion** | **Spatial** review surface |
| Jobs | Snap a photo, voice a note, log a task, clock in | Plans/blueprints, markup, punch lists on drawings, review |
| Posture | One-handed, in a pocket, always on the person | Two hands, braced, deliberate |
| Design | Giant primary button, minimal chrome, one action per screen | Screen real estate for zoom, detail-tapping, glove markup |
| Exemplars | Raken, CompanyCam | PlanGrid/Autodesk Build |

**For EZjobsite:** the **phone is the capture device** (talk + snap, walk the site); the
**iPad is the review/approve surface** (read the proposal, check the ledger, sign off).
Don't ship the iPad a scaled-up phone screen, and don't cram plan-markup onto the phone.

---

## 6. What this means for EZjobsite — and where we currently violate it

| Guideline | Our state | Action |
|---|---|---|
| Primary target 60–72px | **58px** in `theme.ts` (`T.btn`) | **Raise to 64px** |
| Body type 16–18px | Body is 16 ✓ but `cardNote` 13, `dmeta` 12.5, `jobItemMeta` 13 | **Raise secondary text to 15–16px** |
| Light mode default | ✓ paper `#FAFAF8` | Keep; never ship dark as field default |
| Icon + label | ✓ media row has both | Keep for any new icon |
| 3–5 bottom tabs | ❌ **no tab bar yet** | `REQ-NAV1` when built — cap at 5 |
| Colour = one meaning | ⚠️ green was primary buttons, now approved-only | ✓ fixed; hold the line |
| Sync state visible | ✓ "saved / not backed up / won't back up" | Strong — this is our best-aligned area |
| Honest offline state | ✓ we surface parked/failed loudly | Keep; never fake a green tick |
| Proof of delivery | ⚠️ "saved ✓" yes; **no send/receipt yet** | Needed when send→approve ships |
| Photo/voice over typing | ✓ fused capture is voice+photo first | Keep |
| Pre-fill from device | ✓ GPS/time stamped; profile saved | Extend to any new form |
| Labels above inputs | ⚠️ **mixed** — some placeholder-only | **Fix: move to labels above** |
| iPad surface | ❌ **phone-only today** | Design review/approve for iPad, not a stretched phone |

---

## 7. Honest caveats about this evidence

Stated plainly, because this project doesn't dress inference as fact:

- Much of the field-UX literature is **vendor-adjacent and circular** — agency blogs and
  construction-software marketing citing each other. The recurring numbers (44/48px,
  16–18px, "35% of time lost", "ROI in 6–18 months") are **widely repeated but thinly
  sourced**. Treat them as reasonable **heuristics, not empirical constants**.
- **The touch-target guidance is the best-grounded**, because it converges with platform
  HIG/Material and general touch research rather than construction sources alone.
- **Rigorous peer-reviewed field ethnography is thin.** The strongest primary evidence is
  **adoption behaviour itself** — which apps crews keep using, per independent roundups
  and G2 usability data — not controlled studies.
- The **demographics are well documented** (≈22.7% of US construction workers are 55+; a
  recognised skills gap; a large Spanish-speaking craft workforce) — but the **design
  responses to them are practitioner inference**, not measured.
- **Highest confidence** sits where competing vendors and neutral roundups agree
  independently: **offline-first as architecture · photo/voice over typing · glove-sized
  targets · sunlight contrast · one-job simplicity · visible sync state.**

---

## 8. The design test (use this on every screen)

1. Could someone in **gloves**, in **direct sun**, **interrupted**, do this in **one tap**?
2. Does the screen say **what happened** — saved, syncing, failed — without being read closely?
3. Did we ask for anything the **device already knows**?
4. Would a **non-English-reading** crew member get through it on **icons + photos + voice**?
5. Does it beat **sending a text message**? If not, they'll send the text.
