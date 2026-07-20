# Capture-experience synthesis — PRD × reference set

*Written 2026-07-17. Combines `PRD-companycam-parity.md` with a reference set the
user supplied (CompanyCam look-and-feel, Timemark stamping/authenticity, and a
simultaneous audio+image capture). This is a design synthesis that extends the PRD;
it does not replace it. Source of truth for *what* v1 is stays `SPEC-capture-core-v1.md`.*

---

## 0. The one-line thesis

The reference set resolves into three layers the PRD already anticipated, plus one
capability it did **not** yet name:

1. **Look & feel** → CompanyCam-style shell (`REQ-NAV1`, Projects home, `REQ-PM9` Feed).
2. **Evidence, made visible** → Timemark-style **baked-on GPS/time stamp** (mandate #9)
   + an **"Authentic" photo-code** (the `REQ-GAL2` SHA-256 / intact-tampered verdict,
   surfaced instead of buried).
3. **The atomic decision moment** → **simultaneous audio + image capture** — snap a
   photo *while narrating*, saved as ONE capture. This is the north star ("the atomic
   unit is the jobsite decision moment, not the photo") and is the genuinely new build.

The app already has the plumbing for all three; what's missing is (a) the fused
capture mode and (b) making the evidence visible on the media.

---

## 1. Reference → requirement map (the "combine" the user asked for)

| Reference | What it shows | Maps to | Built? |
|---|---|---|---|
| Img 1/5 (Home) | Quick-action circles (Create Project · Users · Take Photos · Upload · Scan), Photos rail, Projects cards w/ per-card camera FAB, bottom nav w/ **center camera** | `REQ-NAV1`, Projects home, quick-actions | Home partial; **bottom nav + center-camera NOT built** |
| Img 6 (Feed) | "Stop calling for updates" — Photos/Projects stream, Nearby/Recent/Stored/Company tabs | `REQ-PM9` Company Feed | **Not built** (Feed is a PRD W4 item) |
| Img 2 (Timemark vs native) | Native camera has no stamp; Timemark **bakes Date/Time/Location** onto the frame | **Mandate #9** — but *visible on the pixels*, not just in a DB row | Stamp captured (`stamp.ts`); **not rendered onto media** |
| Img 3 (Accurate) | "CLOCK IN 10:11" + full address on the photo | Mandate #9 + read-back framing | Stamp data yes; overlay no |
| Img 4 (Authentic) | Photo-code `SLW4369S8FH362`, "check result is Authentic": Time&Date ✓ Location ✓ Image Analysis ✓ | `REQ-GAL2` evidence panel (SHA-256 + intact/tampered) | Integrity hash **built** (`capture` SHA-256); **not surfaced as a shareable code/badge** |
| **Img 7 (audio+image)** | Camera capturing **with a live voice waveform + 00:00:58 timer**; Notes/Photos tabs | **NEW** — fused capture; north-star decision moment | **Not built** — modalities are separate today |

**Takeaway:** the PRD's `REQ-NAV1`/`REQ-PM9`/`REQ-GAL2`/mandate-#9 already cover the
look-and-feel and the evidence layers. The reference set adds one net-new capture
requirement (image 7) and one presentation requirement (bake the stamp + authenticity
onto the media, Timemark-style). Both belong in the capture core, not W4.

---

## 2. Proposed net-new / elevated requirements

- **REQ-CAP-FUSED (NEW) — simultaneous audio + image capture.** A single capture that
  records a voice note *while* the camera is live, committed as **one atomic decision
  moment** (photo frame + voice narration + one GPS/time stamp + one integrity hash over
  the pair). Touch budget: **1 to start narrating+framing, 1 to shoot** (≤ `REQ-X1` = 3).
  - Rationale: this is the product's reason to exist. A contractor points at the water
    heater and says "this one's cracked, needs replacing, four-fifty" *while* framing it.
    Splitting that into "photo" then "voice" loses the moment and doubles the touches.
  - Durability: the same commit state machine (mandate #1) — "saved ✓" fires only after
    **both** the image blob and the audio blob are finalized+fsync'd+verified and the
    local transaction commits. A half-pair is never acknowledged.
  - Offline (mandate #7): fully local; camera + mic are on-device; network is opportunistic.
  - The voice rides the existing structuring pipeline (transcribe → detect-lang →
    resolve-project → structure); the photo is evidence beside it. The **model never sets
    a price** (mandate #2/#4) — unchanged.

- **REQ-CAP-STAMP (ELEVATE mandate #9) — visible stamp on the media.** The GPS + time
  (+ address when resolvable offline) is **rendered onto the capture** as a tamper-evident
  overlay, Timemark-style — not only stored in a row. Honest framing: the *baked overlay*
  is a human-readable convenience; the **cryptographic** evidence remains the SHA-256 +
  the stamp row (we do not overclaim the burned-in pixels as un-forgeable — same honesty
  `stamp.ts` already applies to "tamper-evident").

- **REQ-CAP-AUTH (ELEVATE REQ-GAL2) — the "Authentic" surface.** Surface the existing
  integrity verdict as Timemark's does: a short **photo-code** + a check card (Time&Date /
  Location / Image-intact). This is presentation over the SHA-256 we already compute; it
  makes the evidence usable in the argument the product exists to prevent.

---

## 3. The combined capture screen (design)

Camera-first, matching CompanyCam's center-camera nav and Timemark's capture chrome:

```
┌─────────────────────────────┐
│  ← Boland House        ⚡ ⚙  │   project context (auto-resolved by GPS)
│                             │
│      [ LIVE CAMERA ]        │   expo-camera preview
│                             │
│  09:41 · Fri Jul 17         │   ← baked stamp (REQ-CAP-STAMP),
│  841 Hickory Hill Rd        │     live on the preview, burned on capture
│                             │
│  ▁▃▅▇▅▃▁  00:12   ● REC     │   ← live voice waveform + timer (img 7)
│                             │
│   [gallery]   ( ◉ )   [Aa]  │   shutter center; text-note toggle
│   VIDEO   PHOTO+VOICE  NOTE │   mode row (fused is the default middle)
└─────────────────────────────┘
```

- **Default mode = PHOTO+VOICE (fused).** Opening the camera arms the mic; the contractor
  just talks and taps the shutter. Voice-only, photo-only, text, video remain as modes.
- **Live stamp** overlays the preview and is composited onto the saved image.
- **After shutter:** brief confirm (the read-back for any number the voice mentioned —
  mandate #6), then it files by GPS (`REQ-P1/P2`) or to the Inbox on ambiguity (mandate #8).
- **In the viewer** (`REQ-GAL2`): photo + audio playback + the **Authentic** card.

---

## 4. What's already built vs. new (honest gap map)

**Built and reusable:** `performCapture` + commit state machine (mandate #1); `stamp.ts`
(GPS+time, best-effort, honest); SHA-256 integrity; `expo-audio` recorder; `expo-image-picker`
photo/video; the structuring pipeline; project GPS resolution; the viewer's evidence panel.

**Not built (this synthesis's scope):**
1. **Fused audio+image capture** (`REQ-CAP-FUSED`) — the flagship.
2. **Live camera preview + baked stamp** (`REQ-CAP-STAMP`) — needs a live preview surface.
3. **Authentic photo-code surface** (`REQ-CAP-AUTH`).
4. **Bottom tab bar + center camera** (`REQ-NAV1`) and **Feed** (`REQ-PM9`) — the CompanyCam shell.

---

## 5. The one real build decision (needs sign-off)

**True simultaneous capture needs a live camera preview, and the app doesn't have one.**
Today photos come from `expo-image-picker` = the **system camera UI**, which cannot show a
custom stamp overlay, cannot show a waveform, and cannot record audio at the same time. Image
7 is impossible with `expo-image-picker`.

To build the fused capture screen we need **`expo-camera`** (a custom preview we control) +
`expo-audio` running concurrently. Cost: **one new native module → one native rebuild**
(the pipeline is proven; ~a few minutes), plus building the custom capture UI.

- **Option A (recommended):** add `expo-camera`, build the fused capture screen (image 7)
  + baked stamp + authentic surface. This is the product's core; it's worth the native module.
- **Option B:** interim — keep `expo-image-picker` for the photo, then immediately prompt a
  voice note as a *linked pair* (two blobs, one decision record). No live preview, no baked
  overlay, no waveform-during-framing — it approximates the data model but not the *moment*.
  Cheaper, no rebuild, but it is not image 7.

Recommendation: **A.** The fused, in-the-moment capture is the whole thesis; approximating it
(B) rebuilds the exact "photo then voice, moment lost" friction the product exists to remove.

---

## 6. Suggested build order

1. **`REQ-CAP-FUSED` core** — `expo-camera` preview + concurrent `expo-audio`, one commit over
   the pair, files by GPS. (The flagship; proves the hard part.)
2. **`REQ-CAP-STAMP`** — live + baked stamp overlay.
3. **`REQ-CAP-AUTH`** — authentic photo-code in the viewer.
4. **`REQ-NAV1`** — bottom tab bar + center camera (the CompanyCam shell).
5. **`REQ-PM9`** — Feed tab.

Each is a small, individually-verifiable slice (`VERIFICATION_PLAN` scope discipline). 1–3
are the "capturing images + sound" the user asked to combine; 4–5 are the look-and-feel frame.
