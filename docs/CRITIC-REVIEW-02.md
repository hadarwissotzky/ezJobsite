# Adversarial Critic Review #02 — Architecture

*Same-model adversarial stand-in (real Codex cross-check still owed). Run 2026-07-15 over `ARCHITECTURE.md`. 3 Critical, 5 High, 6 Medium, 3 Low. Reconciliation status tracked; full resolutions in `ARCHITECTURE.md §11`.*

**Legend:** ☑ fixed in arch · ◐ partial · → hadar decision

## Critical
- **C1 — Video is a cumulative storage cost bomb + collides with never-destroy.** 1080p ≈ 50–130 MB/min, retained immutably; a free user hits ~$0.90–2.70/mo storage by month 4–12, 5×+ over the <$0.50 target. ☑ **RESOLVED (hadar): don't store video** — on-device 2-step extraction → store only audio + key stills, discard the raw video. Storage → near-zero; M3 (server ffmpeg) eliminated; uploads shrink (eases C3). Trade-off: continuous video not kept as evidence.
- **C2 — Isolation is enforced by PowerSync Sync Rules, not RLS.** Two authz systems in two languages must agree or a device syncs data it shouldn't. RLS doesn't run on-device. ☑ (arch: Sync Rules = the boundary; generate both from one predicate; parity test; FORCE RLS on every table as defense-in-depth).
- **C3 — Background upload stops when the app is backgrounded/killed.** The queue persists; the in-flight transfer doesn't (no iOS URLSession / Android WorkManager). "Never-lose-it" secretly needs the user to reopen the app; large videos on weak links restart from 0. ☑ (arch: budget native background-upload + multipart resume; honest client promise until proven).

## High
- **H1 — Crypto-shred doesn't cover indexed plaintext or replicated local copies.** `canonical_en`/transcripts/payloads are FTS-indexed plaintext in Postgres (not shreddable ciphertext); every synced device holds local copies; a removed collaborator never re-syncs the delete. ☑ (arch: two data classes — blob crypto-shred; plaintext hard-delete + device purge command; documented residual for never-reconnecting devices).
- **H2 — Pipeline cross-run idempotency undefined → double-charge + duplicate dispositions.** ☑ (arch: idempotency key on `(capture_id, content_version)`; UPSERT the disposition; platform idempotency key).
- **H3 — "Dedup/merge on sync" is a hard distributed merge; concurrent Decision edits get silent LWW.** ☑ (arch: server-owned merge, tenant-scoped clustering key, child re-point + losing-device reconciliation; Decision merge appends both to `value_history`, never LWW-drops).
- **H4 — Capture row syncs before its media → pipeline fires against media not yet in R2.** ☑ (arch: gate the pipeline on attachment-SYNCED, not row-sync; atomic capture↔object-key linkage; orphan sweep).
- **H5 — Twilio SMS OTP needs A2P 10DLC carrier registration (weeks lead-time), unscheduled.** ☑ (arch: 10DLC on the critical path early; email-OTP / authenticated-link fallback so signatures aren't single-threaded on carrier approval).

## Medium
- **M1 — Free-cap vs offline-create vs never-lose-it three-way tension.** ☑ (arch: always accept synced data; gate *new local creation* pre-emptively when over cap; lock over-cap projects until upgrade — never reject synced captures).
- **M2 — "Trusted timestamp at upload" has no hook in direct-to-R2 presigned upload.** ☑ (arch: stamp via R2 event/Edge Function on object-arrival, or state honestly = row-sync time; document the boundary).
- **M3 — ffmpeg runtime home unresolved; fallbacks (Cloudflare Stream) break the cost story.** → tie to C1 decision; validate Trigger.dev v3 container on a real 3-min clip; cost video processing in.
- **M4 — Parent-before-child ordering not guaranteed on download (2nd device).** ☑ (arch: soft-handle dangling refs / "loading"; avoid hard FK failures on sync apply; test two-device ordering).
- **M5 — No-login homeowner Page is a 5th authz path that can over-fetch.** ☑ (arch: dedicated read model, field whitelist, JWT scoped to one disposition + its media keys; pen-test id-guessing).
- **M6 — Jurisdiction-aware consent can't reverse-geocode offline.** ☑ (arch: bundle on-device state-boundary polygon lookup, or default to strictest two-party when unknown offline).

## Low
- **L1 — Pipeline always translates though translate/cache is P1.5;** FTS-on-canonical_en presented as settled but it's a double-MT-hop, an unmeasured gated unknown. ◐ (note P1 vs P1.5 pipeline scope).
- **L2 — R2 "zero cost" overstated** — storage cumulative + Class A ops; carry a real line. ☑ (repriced with C1).
- **L3 — Realtime feed + RLS scaling caveats** for the company-wide feed. ◐ (note before load-bearing).

**Strengths:** the local-first invariant + single `dispositions` table seam are sound; Postgres+RLS+PowerSync over Firebase is the correct domain call.
