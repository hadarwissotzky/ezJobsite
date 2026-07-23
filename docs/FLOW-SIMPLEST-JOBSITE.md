# The Simplest Jobsite Flow — sequence spec `[hadar, 2026-07-23, from design mock]`

The four-step sequence the app follows. Source: hadar's mock ("THE SIMPLEST
JOBSITE FLOW", 2026-07-23) + the workflow bar (Capture 1–2 min → Complete
details 1–2 min → Send 30 sec → Owner approves → Work starts).

## The sequence

1. **Capture scope** — say it, snap it, saved locally. Waveform, photo button,
   add-more; photos stamped with time+location automatically; "Saved locally"
   visible. *(BUILT: fused capture screen.)*
2. **Find or create job** — GPS match against nearby jobs, distances shown;
   create-new-job pre-filled from current location. *(BUILT: assign sheet /
   REQ-P5.)*
3. **Fill what's missing** — exactly four quick questions + one optional:
   1. Who asked for it? *(BUILT: who_directed, REQ-VAL4)*
   2. How are you charging? Fixed / T&M-with-NTE *(BUILT: price modes, R3)*
   3. When do you bill it? Next invoice / When completed / Other *(NEW)*
   4. Will this change the schedule? No change / Adds days / Not sure yet *(NEW)*
   - Optional: What's NOT included? (exclusions) *(NEW)*
   Saved as you go.
4. **Review & send** — one card: project · requested by · extra work ·
   **NOT INCLUDED** · price+mode · payment timing · schedule effect · owner
   approval needed · **contractor's own sign-off** · Send for approval.
   *(PARTIAL: send preview exists; new rows + contractor sign-off NEW.)*

## Decisions (hadar, 2026-07-23 — via the mock's own open questions)

| # | Question | Decision |
|---|---|---|
| 1 | "Who requested it" default from job contact? | **Always ask.** No prefill. |
| 2 | Payment timing default? | **When completed**, pre-selected, confirmed at review. |
| 3 | Schedule effect "Not sure yet"? | **Allowed.** Rendered to the owner as "Schedule impact: to be confirmed" — honest, revisable by revision. |
| 4 | T&M requires NTE? | **Always** (upholds R3's standing rule; no bare T&M). |

## Build plan (order + gates)

1. **Schema**: `billing_timing` (next_invoice | when_completed | other),
   `schedule_effect` (no_change | adds_days | not_sure), `schedule_days`
   (int, only with adds_days), `exclusions` (text) — local DDL + freeze-trigger
   extension + server migration 375 + outbox payload. Gate: tsc + tests +
   migration applied + a draft round-trips the fields.
2. **Frozen instrument**: renderCard adds NOT INCLUDED / PAYMENT TIMING /
   SCHEDULE EFFECT lines. Pure text — 240's integrity trigger (hash recompute +
   money-in-text) is unaffected; the approval page renders shown_content so the
   owner sees the new lines with zero page changes. Gate: send E2E, page shows
   the lines, snapshot verifies.
3. **Fill-what's-missing UI**: the priced composer asks Q3/Q4 + exclusions with
   the decided defaults. Gate: on-device pass.
4. **Review & send**: summary card rows + contractor typed-name sign-off
   recorded into the frozen content. Gate: on-device pass + record shows it.
5. **Record screen**: renders the three new facts.

The structure step's task grouping (374) feeds step 3's prefills later
(exclusions and schedule mentions are extractable) — not wired yet.
