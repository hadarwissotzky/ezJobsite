# VERIFICATION_PLAN.md — Hilo v1 (de-risk phase)

*The standing definition of "high quality," how each criterion is checked, and the measurable exit criteria for the de-risk phase. Written before the spec, per the operating contract. Last updated 2026-07-14.*

---

## Part A — The 8 evaluation criteria (spec-level)

Every requirement in the spec must pass all eight. A requirement that can't is either rewritten or dropped.

| # | Criterion | Pass condition | How it's verified |
|---|---|---|---|
| 1 | **Traceable** | Each requirement links to a research finding or a logged human decision. | Grep the spec: every requirement has a `[trace: …]` tag. Zero untraced requirements. |
| 2 | **Testable** | Each requirement has a measurable acceptance criterion. | Every `REQ` has an `Accept:` line stating a pass/fail condition a human or test can check. |
| 3 | **Hands-free budget** | Each capture flow **and the end-to-end capture→confirm→send flow (REQ-X1)** states its max deliberate touches and works gloved / on a ladder / in noise. | Each flow has a `Touch budget:` line; the clean-path end-to-end flow ≤ its stated budget; validated gloved in the field/proxy test. |
| 4 | **Never-lose-it** | Capture is local-first, encrypted, confirmed audibly + visually, recoverable across **specific fault modes** (not just a round-number kill count). | Fault-injection suite: force-kill, OS memory-pressure eviction, **storage-full mid-write**, power loss, filesystem corruption, mid-video-write, mid-sync kill. Report the residual-loss bound honestly (0/N only bounds the true rate at ~3/N). |
| 5 | **Confirm-don't-automate** | Every priced/committed output has a mandatory human confirmation before commit/send. | Trace each output path; no path reaches "sent to client" without an explicit confirm tap. |
| 6 | **Scope discipline** | In-scope vs. explicitly-out-of-scope is stated; v1 is small and shippable by a solo AI-assisted builder. | The spec has an "Out of scope / do not build" section; each milestone is completable in a small, reviewable step. |
| 7 | **Hard-parts honesty** | Spanish/multilingual-in-noise, alphanumeric/price capture, and offline sync each have a defined approach **and** a fallback. | Each hard part has an `Approach:` and a `Fallback:` line — never "the AI handles it." |
| 8 | **Risk ledger** | Knowns / known-unknowns / unknown-unknowns are tracked with mitigations. | `IMPLEMENTATION_NOTES.md` maintains the three-tier ledger; top risks surfaced in the spec. |

---

## Part B — The three-layer verification process (per instruction #2)

1. **Criteria (above)** — applied continuously; a final full pass before delivery.
2. **Second-model critic** — the drafted spec is run past a *different* model (Codex) as an adversarial reviewer; disagreements reconciled and logged. In-session critique by the same model is a labeled stand-in, not the real check. Command is in `CLAUDE.md §4`.
3. **External signal** — risky choices validated against live docs / the Xano workspace / app-store reality, and the hard unknowns validated by a **measured field or proxy test** (Part C), not by argument.

---

## Part C — De-risk exit criteria (the numbers that end this phase)

This phase succeeds when we can answer each unknown with a measured number, not an opinion. These are the **hypotheses we are trying to kill**.

> **Re-sequenced 2026-07-15 (capture-core spec).** P1 leads with capture-reliability unknowns — **U1** (never-lost, incl. video/mid-sync), **U-TL** (timeline model produces compilable reports), **U-RES** (project-resolution accuracy), **U-SYNC** (lossless resumable, correctly consent-gated sync). The AI-accuracy unknowns below (**U3/U4/U5/U6/U8**) now gate **P1.5 entry** (the Change Order / Approval handlers) — run them cheap and app-free before building those handlers, not before the P1 core. Metrics below unchanged; the "numbers 100% after confirmation" tautology stays replaced by *pre-confirmation error rate* + *confirmation-catch rate*.

| Unknown | Metric | Target to proceed | If it fails |
|---|---|---|---|
| **U4 — Voice → structured priced CO** | Per-field accuracy vs. gold: scope by **blind rubric rating**, categoricals by exact match, numbers by **pre-confirmation error rate**; plus **confirmation-catch rate** (inject known-wrong numbers, measure what gloved/tired users actually correct). | Non-price fields ≥ **90%**; catch-rate high enough that residual money error is acceptable (set with data). **Not** a post-confirmation 100% — that's automatic and meaningless. | Tighten read-back UI; domain biasing; guided capture; reduce free-form. |
| **U5 — Net-of-correction time win** | Time to a *confirmed* CO by voice vs. typing the same CO. | Voice **≤ typing** after correction. | Lead value on completeness/getting-paid, not speed. |
| **U3 — Multilingual feasible** | WER + semantic agreement on Spanish & Spanglish incl. numbers; language-detection accuracy. | Usable with human-in-loop; detection ≥ **95%**; numbers gated + caught. | Detect-and-flag on low confidence; narrow target languages. |
| **U6 — Client approval before work** | % of approval requests acted on; "felt real/fair"; **effect of adding an identity step** on the act-rate. | Majority act; feels real/fair; identity step doesn't collapse the rate — **on a stated homeowner sample size** (not n=1). | Adjust approval UX / tune identity friction. |
| **U8 — Scope-translation fidelity** | Back-translation / bilingual rating of translated scope vs. source. | Fidelity high enough to approve on; low-fidelity path forces explicit scope confirm. | Side-by-side source+translation; block approval on low fidelity. |
| **U1 — Capture never lost** | Loss rate under the **fault-injection suite** (criterion #4), incl. video + mid-sync. | No losses across the suite; **residual-rate bound stated honestly** (raise trial count to the confidence you need). | Stop and fix durability before anything else — the trust anchor. |
| **U7 — On-site producibility** | Can the priced CO be produced + sent under weak/no signal? (on-device vs cloud) | Answered with data at M-B; if cloud-only, drop the "instant on-roof approval" claim. | Produce/send on reconnect; or invest in on-device ML. |
| **Resolution** | Project Resolution: **mis-attach rate** + **% auto-resolved without prompting**; unresolved-never-lost. | Mis-attach ≤ **5%**; ≥ **85%** auto-resolved; 0 unresolved captures lost. | Add context signals (geofence, last-job); strengthen the secondary workflow. |

**Phase decision gate:** for each unknown, say **validated / mixed / killed** with the number that says so. "Mixed" is a fine, honest outcome.

**Proxy vs. real:** a controlled **proxy test** (jobsite-noise audio + Spanglish + alphanumeric/price scripts, gloved) runs immediately and **may *kill* an unknown but may not fully *validate* it** — validation requires **real jobsite audio**. Field-test access (a contractor/site) is the open logistical assumption; recruit ≥1 contractor in parallel, and state U6's sample size explicitly rather than implying a handful of taps is validation.
