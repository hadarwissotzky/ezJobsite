# EZjobsite

A voice-first, offline-first, multimodal field-capture app for residential contractors — so jobsite information is never lost. A Hilo Venture Group portfolio company.

## Where to start
- **`CLAUDE.md`** — the operating contract. Read first (Claude Code loads it automatically).
- **`docs/SPIKE-A-BUILD-PLAN.md`** — the foundation-spike build plan. **This is the first thing to build.**
- **`docs/SPEC-capture-core-v1.md`** — the authoritative product spec (source of truth for *what* v1 is).
- **`docs/ARCHITECTURE.md`** — locked stack + ADR-1..5 + data model.
- **`docs/VERIFICATION_PLAN.md`** — the definition of "done" (the exit gates).
- **`docs/IMPLEMENTATION_NOTES.md`** — decision ledger + edge cases + risk ledger.

## Stack (locked)
React Native + Expo · encrypted SQLite + an owned sync queue (P1) · Supabase (raw Postgres) · TypeScript API on Edge Functions (Deno) + Hono · durable-jobs runtime for the processing pipeline.

## First milestone
Spike A (see the build plan): prove a voice capture is unloseable on a real phone and round-trips to the cloud and back — journal + encrypted local write + owned queue + a fault-injection harness — with a measured zero-loss exit gate. Nothing else gets built until that gate is green.
