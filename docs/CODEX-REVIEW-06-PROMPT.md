# Codex Review #6 — Pre-code adversarial pass (DB + runtime + durability)

> **Gate:** hadar decided (2026-07-15) the cross-model Codex pass runs **before any Spike A code**. Spike A coding does not start until this review's findings are reconciled and logged in `IMPLEMENTATION_NOTES §4`. This is the first Codex pass on the **database (ADR-2), API runtime (ADR-5), owned-queue durability design, and the Spike A plan** — none of which existed at Codex reviews #4/#5.

## Why this review, now
Reviews #4/#5 covered the spec and the ezQuotePro *code*. Since then we locked: **Supabase raw Postgres + an owned sync queue for P1 (PowerSync deferred)**, **TypeScript API on Edge Functions/Hono**, and wrote **`SPIKE-A-BUILD-PLAN.md`** (the durability spine + fault harness). These are the decisions the whole build rides on and the ones most expensive to get wrong — so they get a cross-vendor adversarial read before a line of the journal/queue is written.

## How to run (locally — Codex is not in the cloud sandbox)
From the repo root (`development/`), with the docs in `docs/`:

```bash
cd "/Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development"
export OPENAI_API_KEY=sk-...

# 1. Write the prompt to a file. The heredoc binds to `cat` here — which is exactly what we want.
cat > /tmp/codex-06-prompt.txt <<'PROMPT'
You are an adversarial reviewer. This is a PRE-CODE design review — no code exists yet.
Read, in ./docs: SPIKE-A-BUILD-PLAN.md, ARCHITECTURE.md (esp. ADR-2, ADR-5, §3.1 local
store / owned queue, §3.2 authz), IMPLEMENTATION_NOTES.md (the 2026-07-15 DATABASE LOCKED,
API RUNTIME LOCKED, and open-issue-gate entries), SPEC-capture-core-v1.md (REQ-CAP4/5/6/8,
REQ-PROC4/6), CRITIC-REVIEW-05-CODEX-CODE.md (the ezQuotePro failure lessons), and
VERIFICATION_PLAN.md (criterion #4 + U1).

Your job: find every way the LOCKED database + runtime + owned-queue durability design is
wrong, unbuildable by a solo AI-assisted dev, internally inconsistent, or missing a failure
mode. Be specific and rank by severity. Do not be agreeable. Focus on:

1. OWNED QUEUE DURABILITY. Can the design actually deliver "never lose a capture" across:
   kill mid-recording, OS memory eviction, storage-full mid-write, power loss, DB corruption,
   mid-upload kill, mid-push kill? Where exactly could a capture be acknowledged "saved" before
   it is truly durable? Is the write-ahead journal (REQ-CAP8) ordered correctly vs. the media
   stream and the local commit? Attack the idempotency + server dedup/merge on push — what
   duplicates or losses slip through?
2. OWNED QUEUE vs POWERSYNC. Is deferring PowerSync and hand-building the queue the right call
   for a solo dev, or are we re-implementing hard sync machinery we'll get subtly wrong? Name
   the specific correctness traps (ordering, partial failure, clock skew, retry storms).
3. ENCRYPTED SQLITE. SQLCipher on iOS + Android via Expo/op-sqlite: real pitfalls (key in
   Keychain/Keystore, key loss on OS restore/migration, perf, background access). Is A0.3's
   "unreadable-without-key" check sufficient proof?
4. EDGE FUNCTIONS RUNTIME (ADR-5). Does putting the sync push/pull + authz predicate on Deno
   Edge Functions create problems for the queue (cold starts, wall-clock/CPU limits, no
   retry/resume)? Is the "pipeline in durable jobs, not Edge Functions" line drawn correctly?
5. AUTHZ (MF-2). One predicate as shared Hono middleware across pull/push/presign/homeowner —
   where can it be bypassed? Is anything reachable without it?
6. SPIKE A EXIT GATE. Is "zero loss across the fault suite with an honest residual bound" the
   right gate? What fault is missing? What would let a broken design pass this gate falsely
   (the ezQuotePro "ALL TESTS PASSED" trap)?
7. SEQUENCING. Is anything being built before the thing it depends on is proven?

For each finding: severity, the precise failure scenario, and a concrete fix. End with the
single most likely reason this design fails in the field.
PROMPT

# 2. Run codex WITH that prompt. tee now captures only codex's stdout (the review);
#    stderr (progress + tool-call logs) goes to a separate file so it can't pollute the review.
codex exec --model gpt-5.6-sol -c model_reasoning_effort=high --skip-git-repo-check \
  "$(cat /tmp/codex-06-prompt.txt)" \
  2> /tmp/codex-06-run.log | tee docs/CRITIC-REVIEW-06-CODEX.md
```

> **⚠️ Heredoc bug — fixed 2026-07-16.** This block previously read
> `codex exec … 2>&1 | tee docs/CRITIC-REVIEW-06-CODEX.md <<'PROMPT'`.
> In `a | b <<EOF`, **the heredoc binds to `b` (`tee`), not to `a` (`codex`)** — so the prompt
> would have been fed to `tee`'s stdin and **codex would have received no prompt at all**.
> The `2>&1` was a second bug: it merged codex's progress logs into the review file.
> *(Review #6 evidently ran with a corrected/interactive invocation — it produced real,
> doc-specific findings — but the command as recorded here could not have produced them.
> Use the two-step form above.)*

*(Adjust the model name to your installed Codex version, as in `CLAUDE.md §4`. `--skip-git-repo-check` avoids the empty-output failure seen before. Note `gpt-5-codex` is not present in current installs — #6 and #7 both ran on `gpt-5.6-sol`.)*

## After the run
1. Read `docs/CRITIC-REVIEW-06-CODEX.md`.
2. Reconcile each finding — adopt / dispute-with-reason / defer — and **log it in `IMPLEMENTATION_NOTES §4`** (the ☑-only-when-the-edit-exists rule applies).
3. Apply doc fixes to `SPIKE-A-BUILD-PLAN.md` / `ARCHITECTURE.md` where findings land.
4. **Only then** start Spike A M0. That's the gate.
