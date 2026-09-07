# SPEC — The single-line change order (v1)

*Decided 2026-09-06 (hadar, in-session, four AskUserQuestion decisions). Traces to CO
`co-cap-mtlu7nb1-d63uxxbk` ("Second-floor hardwood floor installation"), the first
real specimen of the pattern. Status: designed, build-ordered, unbuilt.*

## The use case

A contractor records ONE breath — the whole job in a single 40-second ramble — and
never opens a detail editor. This will be the COMMON case, not the degenerate one
(the core design test in CLAUDE.md §1: the user's only job is to provide the
information). The goal is a SUCCESSFUL change order — one the client agrees to —
from that single line, **without the app inventing content** (mandate #2/#6; the
structuring layer is the product, §5).

## What the specimen showed

The one-line capture produced a GOOD faithful write-up (why/what/includes/not-
included/conditions) — prose extraction is not the problem. It failed on exactly
the things clients refuse to sign:

| # | Failure | Evidence in CO #5 |
|---|---|---|
| 1 | **Self-contradiction on money.** | Total $5,600 = $5,000 + $600 trash fee, summed by the app; but the write-up's NOT-INCLUDED section says trash fees are "charged in addition to the installation." Both derived from his words; together they are false. |
| 2 | **Breakdown thrown away.** | Three priced segments spoken; `line_items = []` on the sent row (the auto-fill writes drafts only; the instant send raced it). One bare number invites negotiation. |
| 3 | **Open-ended cost, unbounded.** | "Baseboards at whatever material costs" → a clause with no estimate, no cap, no receipts language. A blank check. |
| 4 | **Missing basics, never asked.** | `billing_timing` null; only demo duration spoken ("a week"), no total duration or start. |
| 5 | **Silent boilerplate.** | "Hidden damage to the subfloor not included" — good clause, never said. Added silently = the hallucination line crossed even when the content is wise. |

## The design — faithful extraction + a deterministic gap interview

**Principle: the AI only ever CLASSIFIES and QUOTES; the contractor's taps and words
supply everything else.** No rubric slot is ever filled by generation.

### D1 — The signability rubric (fixed, code-owned, not model-owned)

Slots: total + what it includes · every spoken priced segment kept as a line item ·
each at-cost/open item resolved (estimate or explicitly-open) · duration/start ·
payment timing · chosen protections. The model's job per slot: `filled` (with the
verbatim quote that fills it) | `missing` | `conflicting` (with both quotes).
Classification output is a zod-validated shape in the worker pipeline; a slot the
model cannot quote evidence for is `missing`, never guessed.

### D2 — The gap interview: at review, before first send (decision 1)

The review screen renders at most ~3 questions, generated ONLY from
missing/conflicting slots, each answerable in one tap or one short entry
(mandate #3 budget). For CO #5 it would have asked:
- "Is the $600 trash fee inside the $5,600 or on top?" [inside / on top]
- "Baseboard material — ballpark?" [$ entry / send as open-with-receipts]
- "Paid when?" [when done / next invoice / other]

Answers write the real columns (`billing_timing`, line-item rows, schedule_days,
amended exclusion wording). Send remains available with gaps — the questions sit on
the path, they do not gate it (the send gate's existing blockers are unchanged).

### D3 — Open-ended costs: ask for a ballpark (decision 2)

An at-cost item asks for an estimate → renders as **"estimated $X, billed at actual
cost with receipts."** Declining the estimate is allowed but explicit: the clause
then renders as open WITH the receipts language, chosen, not defaulted.

### D4 — Protective clauses: a company library that LEARNS (decision 3 + hadar's addition)

- `company_clause` rows: text (en+es), kind (exclusion/condition), `times_offered`,
  `times_added`, `times_removed`.
- Review offers the relevant clauses as one-tap adds. Nothing enters the document
  unchosen (kills failure #5).
- **Learning across change orders**: a clause added or kept N times gets pre-checked
  on future reviews (still visible, still removable); one repeatedly stripped stops
  being offered. Seeded with a small standard set (hidden conditions, access,
  material delays). The seed is offered, never auto-added.

### D5 — No signability meter (decision 4)

The questions ARE the interface. No score, no gauge.

### D6 — The balance rule: the backend decides whether the interview exists at all
*(hadar, 2026-09-06: "if enough information was given in the first pass, no need to
complicate the process... during the AI process (backend) evaluate the co and make
that determination.")*

`evaluateSignability` (apps/mobile/src/signability.ts — pure, no imports, vendorable
to the worker like money.ts) is the determination. It runs over the extraction
output after the AI pass, deterministically:

- **complete: true → the simple path.** The review screen shows NOTHING new. A
  contractor who said enough in one breath is never interviewed.
- **complete: false → at most three questions**, severity-ordered: money
  contradiction (a summed-in fee also described as "charged in addition") →
  open-ended cost → missing payment timing → missing schedule. Anything past three
  waits rather than burdening this send.
- `not_sure` and `no_change` are ANSWERS, never gaps — only silence asks.
- The open/priced split uses the one production money parser (mandate #6); price
  words with no readable figure make a segment open-ended, never a guessed number.

## Build order

1. **Slice 0 (bug fixes, immediate):** persist spoken segment prices into
   `line_items` whenever the sum is written, regardless of racing sends; add the
   include/exclude consistency rule — a fee summed INTO the total may not render
   under "not included" (it renders as "included in the total" instead).
2. **Slice 1:** rubric classification in the worker (zod shape, quotes-or-missing),
   stored beside the write-up.
3. **Slice 2:** review-screen gap questions writing real columns.
4. **Slice 3:** clause library + learning counters.

## Verification

**The generated one-line CO suite** (signability.test.ts, PASSING since
2026-09-06): six one-breath fixtures through the real parser — the complete
one-liner (zero questions), CO #5's actual ramble (exactly its three gaps, and the
baseboard install/material pair correctly NOT flagged as a contradiction), a
whole-job single figure (complete), an explicit not-sure (complete), the
three-question cap, and the "on top of" phrasing. New fixture transcripts get added
here as new shapes surface.


Slice 0: unit tests on the consistency rule; re-run the CO #5 transcript through the
pipeline and assert 3 line items + no contradiction. Slice 1: fixture transcripts
(the CO #5 ramble among them) asserting every `filled` slot carries a verbatim
quote present in the source. Slice 2: the three CO #5 questions appear; answers land
in columns; hands-free budget respected. Slice 3: counters move; pre-check threshold
honoured.
