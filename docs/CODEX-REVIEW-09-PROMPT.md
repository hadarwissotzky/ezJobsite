# Codex Review #9 — the mandatory pass on the BAKEOFF CONCLUSION

> **Gate:** `SPIKE-SYNC-BAKEOFF.md:118` — *"Log the result … and run a **Codex pass on the bakeoff conclusion** before flipping ADR-2 — same discipline as every other gate."* This is that pass. **ADR-2 does not move until this is reconciled.**
>
> **Why this pass is different.** Codex #8 tightened the bakeoff's *test design* so it couldn't false-pass. #9 checks whether the **run that actually happened** honoured those bars — i.e. whether the recorded evidence supports the claimed verdicts. `:119` says the quiet part out loud: *"A verdict with no assertion trail is exactly the false-pass Codex #8 exists to prevent, and the conclusion-stage Codex pass will (correctly) reject it."*
>
> **The harness source is in scope and that is the point.** `spike/harness/*.py` and `spike/app-src/*` are readable. Do not take `BAKEOFF-RESULT.md` at its word — read the code that produced the numbers and check the assertions are real.

## How to run (locally; forced apikey auth)

`~/.codex/auth.json` has `auth_mode = chatgpt`, which **ignores `$OPENAI_API_KEY` and hangs indefinitely** (cost us ~37 min on review #6). Force apikey. `gpt-5-codex` does not exist in this install; #6/#7/#8/#9 all run `gpt-5.6-sol`.

```bash
cd "/Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development"
export OPENAI_API_KEY=sk-...

gtimeout 3600 codex exec --skip-git-repo-check \
  -c preferred_auth_method="apikey" -m gpt-5.6-sol \
  -c model_reasoning_effort="high" -s read-only - \
  < docs/CODEX-REVIEW-09-PROMPT.txt \
  > /tmp/codex09-raw.txt 2>/tmp/codex09-err.log
```

Keep stdout and stderr separate — `2>&1 | tee` merges progress logs into the review file (the #8 run note).

## After the run
1. Read `docs/CRITIC-REVIEW-09-CODEX.md`.
2. Reconcile each finding — adopt / dispute-with-reason / defer — and log in `IMPLEMENTATION_NOTES §4` (☑-only-when-the-edit-exists).
3. **Only then** decide ADR-2. If #9 rejects the Q1/Q2 passes, they are **not passes** and the bakeoff is not done.
