# Codex Review #8 — Narrow test-validity check on the sync bakeoff

> **Scope: deliberately narrow.** This is NOT a full architecture review. Its only job is to make sure the bakeoff (`SPIKE-SYNC-BAKEOFF.md`) **cannot false-pass** — i.e., cannot green-light PowerSync without actually proving it solves the faults that killed our hand-built design. The bakeoff is an experiment, so it's mostly self-correcting; the one real risk is a test that "passes" while testing nothing (the ezQuotePro "ALL TESTS PASSED" trap). This check guards that, cheaply. Do not re-litigate the architecture decision here.

## How to run (heredoc-bug-safe — pass the prompt as an argument, not via a pipe)
```bash
cd "/Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development"
export OPENAI_API_KEY=sk-...

cat > /tmp/codex8-prompt.txt <<'PROMPT'
You are reviewing a TEST PLAN, not an architecture. Read ./docs/SPIKE-SYNC-BAKEOFF.md (the
bakeoff), ./docs/CRITIC-REVIEW-07-CODEX.md (the three blockers the bakeoff must actually
reproduce), and ./docs/DURABILITY-DESIGN-v1.md (the hand-built design that failed).

YOUR ONLY JOB: determine whether these tests can FALSE-PASS — green-light PowerSync without
truly proving it fixes the fault. Do NOT redesign the architecture. Do NOT raise new
architecture findings. Focus strictly on test validity.

1. Q1 (commit-ordering). Does the described test actually reproduce the stalled-transaction
   reordering fault — txn A takes seq 10 and stalls, B takes 11 and commits, the device
   checkpoints past 11, then A commits 10? Specify the concrete mechanism required to FORCE
   that interleaving against a real Postgres + PowerSync (how to hold a transaction open past
   another's commit; how to observe whether the late row is or is not delivered to the device).
   If the test as written can't reliably create that race, PowerSync could "pass Q1"
   meaninglessly. Give the exact steps + assertions that make a Q1 pass real.

2. Q3 (encrypted media). Does the test prove end-to-end integrity — client ciphertext →
   upload → second device → decrypt → byte-identical — or could it pass while missing
   something: plaintext leaking to a temp/staging file, the key-unwrap path untested, or
   resumability not actually exercised by a real mid-upload kill? Name the exact assertions
   the oracle must check for a Q3 pass to be trustworthy.

3. Any OTHER question (Q2, Q4–Q7) whose described check could pass without proving what it
   claims — briefly, one line each.

For each: state whether the test as written is VALID, could FALSE-PASS, and the concrete fix
to make a pass meaningful. Be tight. Do not exceed the test-validity scope.
PROMPT

codex exec --model gpt-5.6-sol -c model_reasoning_effort=high --skip-git-repo-check \
  "$(cat /tmp/codex8-prompt.txt)" \
  2> /tmp/codex-08-run.log | tee docs/CRITIC-REVIEW-08-CODEX.md
```
*(Adjust the model name to your installed Codex version, as before. Passing the prompt as the `"$(cat …)"` argument avoids the heredoc-binds-to-tee bug from #6/#7.)*

> **⚠️ `2>&1` bug — fixed 2026-07-16.** This block previously ended `… "$(cat /tmp/codex8-prompt.txt)" 2>&1 | tee docs/CRITIC-REVIEW-08-CODEX.md`. The `2>&1` merges codex's **stderr progress + tool-call logs into the saved review file**, so the artifact is polluted with run noise instead of being clean review output. Send stderr to its own log (`2> /tmp/codex-08-run.log`) and let `tee` capture stdout only. *(The actual #8 run used the corrected form. The same fix was applied to `CODEX-REVIEW-06/07-PROMPT.md`, which additionally had the heredoc-binds-to-`tee` bug.)*

## After the run
1. Read `docs/CRITIC-REVIEW-08-CODEX.md`.
2. Fold any "could false-pass" fixes into `SPIKE-SYNC-BAKEOFF.md` (tighten the Q1/Q3 test steps + assertions) — this is a small edit, not a redesign.
3. Then proceed to build + run the bakeoff. (The non-optional Codex pass is later — on the bakeoff *result*, before flipping ADR-2 to PowerSync.)
