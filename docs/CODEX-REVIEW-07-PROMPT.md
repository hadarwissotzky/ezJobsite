# Codex Review #7 — Design-doc adversarial pass (the durability & sync design)

> **Gate:** this is the second-model check on `DURABILITY-DESIGN-v1.md` — the 9 design artifacts written after Codex #6. Per the protocol, it runs **before any Spike A schema/code**. Codex #6 reviewed the *plan* and found it not ready; this pass reviews the *design that fixes it*, to confirm the fixes actually hold before code is built on them.

## What changed since Codex #6 (so the reviewer has context)
- **Append-only sync LOCKED** (ADR-2): media immutable; only derived text/records version; approved records frozen+permanent (lawful crypto-shred exception); sync = append immutable rows, never mutate.
- **Honest save-invariant** (CLAUDE #1): "saved ✓" only at `MEDIA_COMMITTED`; stated residual-loss boundaries.
- **Decision 4 = Option B** (per-capture-key envelope encryption). **Decision 7 = Supabase Storage** for P1.
- New doc: `DURABILITY-DESIGN-v1.md` (artifacts 1–9).

## How to run (locally; Codex is not in the cloud sandbox)
From the repo root (`development/`). *(Same auth/model notes as run #6: use your installed flagship model, e.g. `gpt-5.6-sol`; force API-key auth if the token-auth path hangs — `preferred_auth_method=apikey` in `~/.codex/config.toml`.)*

```bash
cd "/Volumes/Operational Disk/HiLo Venture Group/EZJobsite/development"
export OPENAI_API_KEY=sk-...

# 1. Write the prompt to a file. The heredoc binds to `cat` here — which is exactly what we want.
cat > /tmp/codex-07-prompt.txt <<'PROMPT'
You are an adversarial reviewer. This is a PRE-CODE design review — no application code exists yet.
Read ./docs/DURABILITY-DESIGN-v1.md as the primary artifact, plus ./docs/CRITIC-REVIEW-06-CODEX.md
(your previous findings), ./docs/ARCHITECTURE.md (ADR-2, ADR-5), ./docs/SPEC-capture-core-v1.md
(REQ-CAP4/5/6/8, REQ-PROC4/6), ./docs/IMPLEMENTATION_NOTES.md, and ./docs/SPIKE-A-BUILD-PLAN.md.

The design was rewritten to fix your Review #6 findings. Your job now:

1. VERIFY THE FIXES. For each of your Review #6 Criticals (C1–C8) and Highs (H1–H12), is it
   ACTUALLY resolved by DURABILITY-DESIGN-v1.md, or only cosmetically? Name any that are still open.
2. ATTACK THE NEW DESIGN. Find every remaining way it loses or duplicates a capture, corrupts
   the integrity chain, or violates the append-only / approval-freeze laws (L1–L5). In particular:
   - Artifact 1 (capture-commit state machine): is the ordering airtight? Any crash point that
     yields a phantom "saved" or an unrecoverable capture? Is the sidecar-manifest recovery sound
     when SQLite and the media disagree?
   - Artifact 2 (append-only sync): can the server-seq keyset pull still miss/dupe under concurrency,
     revocation, or window changes? Are the parent-before-child ordering and idempotency watertight?
   - Artifact 3 (identity): can two different plaintexts collide, or the same capture double-upload?
   - Artifact 4 (Option B envelope encryption): is the key lifecycle sound across backup/restore,
     migration, rekey, locked-device background upload? Where can plaintext leak? Is crypto-shred
     truly complete?
   - Artifact 5 (authz in Postgres functions): any transport path still bypassing the canonical
     functions? Any nested-resource cross-tenant hole?
   - Artifact 6 (transactional outbox): any remaining dual-write or lost-trigger window?
   - Artifact 8 (failpoint matrix + targets): are the predeclared targets and oracle sufficient to
     catch a silently-broken build? Any missing fault class?
3. CHECK CONSISTENCY across the doc set (any contradiction between DURABILITY-DESIGN, ARCHITECTURE,
   SPEC, IMPLEMENTATION_NOTES).

Rank findings by severity. Do not be agreeable. If the design is now buildable, say so explicitly
and list only residual risks to watch during Spike A. End with the single most likely remaining
failure in the field.
PROMPT

# 2. Run codex WITH that prompt. tee now captures only codex's stdout (the review);
#    stderr (progress + tool-call logs) goes to a separate file so it can't pollute the review.
codex exec --model gpt-5.6-sol -c model_reasoning_effort=high --skip-git-repo-check \
  "$(cat /tmp/codex-07-prompt.txt)" \
  2> /tmp/codex-07-run.log | tee docs/CRITIC-REVIEW-07-CODEX.md
```

> **⚠️ Heredoc bug — fixed 2026-07-16.** This block previously read
> `codex exec … 2>&1 | tee docs/CRITIC-REVIEW-07-CODEX.md <<'PROMPT'`.
> In `a | b <<EOF`, **the heredoc binds to `b` (`tee`), not to `a` (`codex`)** — so the prompt
> would have been fed to `tee`'s stdin and **codex would have received no prompt at all**.
> The `2>&1` was a second bug: it merged codex's progress logs into the review file.
> The two-step form above is correct. *(The actual review #7 run used the corrected form.)*

## After the run
1. Come back to the Cowork session and say "done"; Claude reads `docs/CRITIC-REVIEW-07-CODEX.md` from the connected folder and reconciles each finding in `IMPLEMENTATION_NOTES §4`.
2. Apply any design fixes to `DURABILITY-DESIGN-v1.md`.
3. **Only then** does Claude Code start Spike A M0 (A0.1 scaffold → A0.2 schema, derived from the artifacts).
