# Handoff — state of the build

*Written 2026-07-17, at the end of a long session, so the next one can start cold.*

This is a status note, not a spec. `SPEC-capture-core-v1.md` is still the source of truth for *what* v1 is; `IMPLEMENTATION_NOTES.md` is still the ledger of *why*.

---

## The one-line state

**42 of 43 v1 requirements trace to code** (`node scripts/trace-requirements.mjs`). The capture core, the durable queue, the evidence chain and the live AI pipeline all run against real Supabase and are tested. The remaining one, **REQ-CAP7, is blocked on hardware, not on code.**

Read that number carefully. The trace script prints its own warning and it is the right one: *"This is a tag count, not a score. REQ-PROC2 sat in this list while being fully built and proven."* A tag proves a requirement was **claimed**, not that it **works**.

---

## What is set up and proven

**Supabase (Postgres) — the record.** 18 SQL files in `apps/mobile/sql/`, applied by hand in number order. `node scripts/check-sql-duplicates.mjs apps/mobile/sql` enforces one-object-one-file (74 objects, 0 collisions) — it exists because two files once owned `bundle_limitations()` and re-running the earlier one silently reverted a limitation the dispute bundle depended on.

The load-bearing pieces:
- **`capture`** — append-only immutable evidence. A trigger blocks UPDATE *and* DELETE. This has caught me four times, most recently while writing a test; when you need a new fact about a capture, **put it in a table beside the capture, never a column on it** (that is why `capture_transcript`, `capture_structured` and `capture_content_signal` exist).
- **`capture_commit`** — the commitment authority. The outbox is transport; a drained queue proves nothing about the record.
- **`processing_job`** (`140`) — the durable queue: `claim_job` (FOR UPDATE SKIP LOCKED + a lease), `complete_step` (per-step, which is what makes a crash resumable), `finish_job`, `block_job`. Worker-only: all four are revoked from `authenticated`.
- **`capture_content_signal` + `content_resolve()`** (`170`) — REQ-P4, new this session.

**Sync.** Per the amended ADR-2 (**still needs human sign-off**): append-only evidence goes through the **owned outbox**; the mutable relational row goes through **PowerSync**. The reason is not taste — *PowerSync can revert its own rows*, so it cannot be the commitment authority. PowerSync replication is live and drained; it was dead for most of one session behind three separate causes (schema drift wedging the queue at 25, a non-UUID owner id, and a revoked table-level UPDATE that PostgREST discarded **silently** as 42501). If PowerSync looks stuck, check those three before anything else.

**The AI pipeline** (`services/worker/worker.mjs`, Node, per ADR-3 — *never* a synchronous Edge Function, which has no retry/resume). Live and working against the real OpenAI key the user explicitly authorised for this purpose. Sending audio out is gated behind `PIPELINE_SEND_AUDIO_TO_OPENAI=yes`, deliberately: **the presence of a key is not permission to upload someone's jobsite recordings.** Run `--stub` to exercise the loop without spending anything.

---

## The one rule this session earned the hard way

**The model for comprehension; a deterministic rule for identity and for numbers.**

It is not a preference. Given *"Add three outlets in unit 3B, four fifty"*, gpt-4o-mini returned `amount_cents: 45000` at `confidence: high` — it invented $450, in direct defiance of a prompt telling it not to. That is mandate #2's ~31% hallucination rate, live, on the field mandate #6 calls the highest-risk in the product. The app's `parseMoney()` regex **refuses that same input**. So:

- **The model never sets an amount.** `const cents = null` in the `structure` step, and the prompt bars it too. Belt and braces, on purpose.
- **REQ-P4 resolves projects in SQL, not with an LLM**, for the same reason. "Did he say a job we have on the books?" is a string match against rows we already hold. A model asked that will confidently match a job never mentioned — and **a capture filed to the wrong job is the failure nobody goes looking for**, which is strictly worse than an unresolved one sitting in a queue a human checks.

---

## Shipped this session

**REQ-P4 — content-assisted project detection.** `content_resolve()` matches a transcript against project name/address/client_ref on whole-token regex, scoped to the owner's own active jobs. 12 behavioural cases pass, including the ones that bite:
- **TWO MATCHES = NONE.** If the words point at two jobs, the words did not identify a job. The first cut returned the matches *then* appended an "ambiguous" row, so a caller reading the first row would have **mis-filed**. The test caught it; the rule was right, the shape was wrong.
- Names nothing → **a recorded row saying so**, not an absence. "The words named no job" is the evidence REQ-P5's *"new project?"* prompt rests on, and an absent row cannot be told apart from "the step never ran".
- Another owner's job is invisible; an archived job does not attract captures; a coincidental word ("the elm tree") does not file anything.
- `matched_text` quotes **the field that actually matched**. It first quoted the project name while `matched_on` said "address" — a signal whose own evidence contradicted its label. The entire point of a deterministic match is that a human can check it in a second; quoting the wrong string is *worse* than quoting nothing, because it looks checked.

**Two real queue bugs, both found by inspection and then proven, not argued:**
1. **Every photo wedged.** A photo was enqueued with `["structure"]`, but `structure` needs a transcript and a photo has no words — so it blocked with `needs_connection: no transcript to structure`, a reason that **was not even true**, while REQ-PROC6 promises the stuck state explains itself in plain language. Photos now declare **no steps**: a photo is complete when it is stored and stamped.
2. **A job with nothing left to do was never finished — silently.** `complete_step` is the only thing that marks a job `done`, and only a step calls it. So a zero-step job (every photo) *and any resumed job whose steps were all already complete* sat in `running` until the lease lapsed, got reclaimed, and died at `attempts >= 5`. `finish_job` fixes both and **re-checks the completion predicate itself**, so it cannot be used to claim work that never happened (proven: it refuses a job with work outstanding and does not mark the capture processed).

---

## The exact next step

**Correct `IMPLEMENTATION_NOTES.md` §5.4.** It still says PROC1/PROC3/PROC5 need an LLM key. That has been **wrong for three commits**, and I have now owed this correction in three consecutive commit messages. The key is authorised, the pipeline is live, and the note contradicts the code. Do this first — it is small, and a stale note is how the next session inherits a false belief.

Then, in order:

1. **Show the structured proposal.** The pipeline writes `capture_structured` and nothing renders it. Mandate #2 requires a human confirmation step before anything priced commits, and mandate #6 requires read-back + tap-to-correct on every number. The proposal exists; the read-back screen does not. **This is the highest-value unbuilt thing in the product.** `parseMoney()` runs on `from_transcript` at read-back time, so there is one money parser and it cannot drift from itself.
2. **REQ-PROC5's P1.5 half** — translate / display / cache / English-pivot search.
3. **Erasure (hard-delete)** is unimplemented — mandate #5's one carve-out to immutability.
4. **Dead `attachment` columns** still unrenamed: `wrapped_dek_device`, `aead_nonce`, and `ciphertext_sha256` — the last of which **holds a plaintext hash**. A column whose name asserts a security property the data does not have is a trap for whoever reads it next.

**Blocked, needs the user:**
- **REQ-CAP7** needs a microphone. This machine is a **Mac mini with no mic and no camera** (confirmed by the user). Test audio/photo/video by **generating a file and feeding it through the real path** — never by opening a camera, and never by inserting a synthetic row and calling the capture path proven. Say which one a test actually covered.
- **`EXPO_PUBLIC_CONFIRM_BASE`** needs a static host chosen (not Supabase Storage).
- **ADR-2's amendment** (evidence → outbox, relational → PowerSync) needs explicit sign-off.
- **Q7's time-window mechanism** carries an authz consequence and is deliberately left for a human.
- **`docs/SECRETS-ROTATION.md`** lists 8 exposed ezQuotePro credentials only the user can rotate.
