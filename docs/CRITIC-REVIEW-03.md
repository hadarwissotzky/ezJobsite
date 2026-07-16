# Critic Review #03 — Fable Greenlight Gate (Security · Scalability · UX)

*Run 2026-07-15 on **claude-fable-5** — a different model from the one that authored the suite (claude-opus-4-8) — via three **fresh-context subagents** that read only the documents, never the authoring conversation. This is the closest-to-independent second-model check run so far and discharges the protocol's cross-model requirement in substance; the Codex CLI run remains available for the complex-build stage (`CLAUDE.md §4`). Criteria set and confirmed by hadar before the run: security = SaaS hygiene now + evidence-grade flagged; scale target = ~1k companies / 10k users, solo-operable; UX = heuristic now, human test at UX phase. Purpose: **greenlight gate** for starting the foundation spike.*

---

> **Reconciliation 2026-07-15 — all 7 must-fix items APPLIED; spike greenlit.** hadar's channel/margin/feed calls (made via the recommended options after the question tool errored; override anytime): P1 delivery = **email + SMS, 10DLC starts at kickoff** (SPEC REQ-VAL8) · margin = **accept honest 60–70%, keep $19/$49, enforce Free minute-metering + lazy processing** (PRICING repriced) · feed = **rendered from PowerSync local data** (ARCH §3.2). Document edits verified to exist per the new ☑-only-with-edit rule: MF-1→ARCH §3.3 · MF-2→ARCH §3.2 · MF-3→ARCH §3.2 + SPEC REQ-PM-D · MF-4→ARCH §3.1 · MF-5→SPEC REQ-VAL8 · MF-6→SPEC REQ-VAL6/VAL4/§4 · MF-7→SPEC REQ-X2 + REQ-CON1. Fix-during-build + evidence-grade registers carried in ARCH §12.

## VERDICT: **FIX-FIRST, THEN GO.**

All three axes returned **GREEN-WITH-CONDITIONS**. No axis is RED; nothing requires an architecture rethink — the local-first spine, the disposition seam, and Postgres+PowerSync-over-Firebase were independently endorsed by all three reviewers. But **seven findings must be fixed in design before code is written** (each is a days-not-weeks design decision), and two prior reconciliation claims **failed independent verification** (see Meta-finding). Start the spike after the seven land.

| Axis | Verdict | Biggest risk (reviewer's one-liner) |
|---|---|---|
| Security | GREEN-WITH-CONDITIONS | Erasure is advertised as GDPR-executable but is **unbuildable as specified** — envelope encryption and direct presigned R2 access contradict each other; no key-management design exists. |
| Scalability | GREEN-WITH-CONDITIONS | The Realtime company feed breaks first — at ~100–300 companies, long before anything else feels load. |
| UX simplicity | GREEN-WITH-CONDITIONS | Most likely abandonment: first capture on a new job hits an **English-language legal consent interstitial** instead of recording — for a Spanish-speaking primary persona the P1 spec never requires the app to speak to. |

---

## MUST-FIX-BEFORE-CODE (merged BLOCK-BUILD list — 7 items)

**MF-1 · Resolve the encryption/presign contradiction; design key management.** (Sec B1) Crypto-shred requires envelope encryption; direct presigned R2 GET/PUT requires plaintext-to-client. Both are specified; they cannot coexist. **Fix:** server-side envelope encryption at ingest (wrapped DEKs in a `media_keys` table, master key in a real KMS); all media *reads* via a short-lived authorizing endpoint (R2 behind a Worker) that re-checks the membership predicate — no direct presigned GET. Without this, "erasure" ships as a metadata flag.

**MF-2 · One authorization module for ALL ~6 access paths.** (Sec B2) The single-predicate + parity test covers Sync Rules + RLS only. Edge Functions (which run service-role and **bypass RLS entirely**), presign issuance, the homeowner read model, and Realtime each make independent authz decisions today. **Fix:** every path calls the same authorization module; negative tests per path (collaborator-removed, cross-tenant capture_id, object-key enumeration); CI check that every tenant-bearing table has FORCE RLS.

**MF-3 · Kill the Realtime `postgres_changes` feed. Render the feed from PowerSync-synced local data.** (Scale BLOCK + Sec B3, independently convergent) Under RLS it's single-threaded, O(subscribers × changes) — falls behind at ~100–300 companies — *and* DELETE events leak row identifiers to over-broad subscribers, worst during erasure. **Fix:** the feed data already syncs to entitled devices; render it from local SQLite (office web via PowerSync JS SDK). If server-push is ever needed, authorized Broadcast — never raw postgres_changes.

**MF-4 · Treat PowerSync sync rules as near-immutable; bake windowing into v1.** (Scale BLOCK) Every sync-rule deploy re-replicates the whole DB and forces every device to full re-sync (~$1.5–3k + a fleet-wide "loading" morning at target). **Fix:** parameterize rules by *data* (ProjectParty rows, role flags) so grants change without redeploys; v1 rules sync only **Active projects + last-N-days**, cold history behind an on-demand API (also caps device SQLite growth, currently unbounded). Retrofitting windowing later *is* the cost-bomb deploy.

**MF-5 · Decide the P1 counterparty delivery channel (critic-01 H2, still open).** (UX B1) The P1 validation loop's acceptance requires sending a confirm link to the homeowner — and P1 specifies **no channel** (notifications are P1.5). The differentiator can't occur as written. **Fix:** hadar decision — minimal SMS/email delivery in P1 (start 10DLC registration now) or honestly demote counterparty-confirm to P1.5 and rewrite the M5 gate.

**MF-6 · Close the classification leak for real (H8 was ◐, not ☑).** (UX B2) The spec's own AI-spike fallback ("human-templated form") resurrects the exact scope-level/assignee/who-directed form H8 forbade; REQ-VAL4 stacks per-item confirms against VAL6's "single confirm"; and P1 has no stated inference mechanism at all. **Fix:** if extraction isn't available, the decision card degrades to **unclassified evidence** (office/later classifies — never the gloved user); cap the P1 decision flow at **one confirm surface total**, as a numbered acceptance criterion; reconcile VAL4 with VAL6 (infer-then-confirm inside the one surface).

**MF-7 · P1 UI localization (Spanish minimum) + consent moved off the capture path.** (UX B3 + F1) Nothing requires the P1 app chrome — record button, "saved ✓," pending reasons, consent screens, failure states — to exist in the primary persona's language; content translation (P1.5) is a different thing from static i18n (cheap, no AI gate). And REQ-CON1 as written puts a jurisdiction-aware legal interstitial between the thumb and the record button. **Fix:** ES-minimum static localization of all P1 strings is a P1 requirement; consent state is set **once at job creation** (owner/office/solo setup), never as a capture-time prompt.

---

## FIX-DURING-BUILD (schedule into the build; not gate-blocking)

*Security:* JWT counterparty links get short expiry + one-time/nonce + revoke-on-resend + signing bound to the OTP session · SQLCipher via op-sqlite with key in Keychain/Keystore; Supabase session in expo-secure-store (never AsyncStorage) · hostile-collaborator residual: instant Sync-Rule revocation at grant-end + consider not syncing raw homeowner audio to collaborator devices at all · Twilio Fraud Guard + rate limits + Lookup SIM-swap check before signature OTPs; per-tenant send caps (spam/abuse vector) · AI sub-processor DPAs (zero/short retention), disclose in privacy policy; `capture_id` = global UUID; assert `tenant_id` at every pipeline write.

*Scalability:* **meter transcription minutes, not just decisions** — the cost unit is captures (free-forever crew generate them unbounded); lazy-process on Free (store audio, transcribe on first view/decision) · normalize the translations cache into a child table with per-language buckets (JSONB-on-row amplifies every sync 2–3× for bilingual crews — the core ICP) · parked-jobs must auto-drain: error taxonomy, wired Deepgram failover, bulk re-drive, rate-based alerting (140 parked/day at 0.5%; one 4-hr STT outage = ~4,500) · collapse the 7 pipeline steps to 2–3 durable checkpoints (Inngest ~$385/mo at 6.7M step-executions otherwise) · additive-only migrations + N-versions-back upload tolerance (10k offline devices).

*UX:* first-run gets a **number** (first capture ≤N interactions; permissions lazy; capture legally precedes project via the unresolved queue) · free-cap "locked" = **read-only + export always available** — never sealed evidence ("your stuff is safe" copy specified) · every item shows **one** collapsed primary status (is-it-safe / is-it-done / does-it-need-me), underlying states as detail · send path gets a numbered touch budget in REQ-X1 (≈≤3, voice-confirm read-back) · Free confirm labeled in-product "recorded agreement — not a signature" (paywall sits on legal weight; don't let the upsell read as betrayal) · free-cap counter visible before it's hit, in plain units ("15 recorded agreements per job").

## EVIDENCE-GRADE (before signatures carry legal dispute weight — not before code)
WORM/append-only audit substrate + externally anchored `shown_content` hashes (RFC-3161/transparency log) · independent homeowner identity association (their number/email captured by *them* at project setup, not typed by the contractor at send) + device/IP at signing · offline-stamp divergence flags ("unverified until sync") on evidence bundles.

## UX-PHASE (carried as named constraints)
Pause=section-break must be an enhancer, not a dependency (auto-sectioning without the gesture) · homeowner page language chosen by sender from job context + one-tap switch · collaborator invite: scope-of-work by voice, company auto-derived; a one-man sub shouldn't have to "create a company" · photo co-primary with voice, not nested · hold the U6 identity-friction gate honestly — if OTP+typed-name kills approval rates, the requirement gets re-opened, not silently softened.

---

## META-FINDING — reconciliation-log integrity

Two `CRITIC-REVIEW-02` claims **failed independent verification**: **L2 "☑ repriced"** — the pricing doc was never actually updated (Verify is ~$0.05/verification + SMS ≈ $0.06–0.08 per signature; R2 storage is cumulative ~$180–360/mo by year 2; jobs platform ~$300–500/mo; platform floor ~$1.2–1.8k/mo at target → **blended margin ~60–70%, not 70–80%**). **L3 "◐ note before load-bearing"** — the feed is load-bearing on day one of the Crew tier (now MF-3). **Process fix adopted:** a reconciliation may only be marked ☑ when the referenced document edit exists; verification passes must diff claims against files, as this one did.

## What held (verified by the panel, not re-reported)
CR-01/02 fixes confirmed real: frozen `shown_content` as the binding artifact · Sync-Rules-as-boundary framing · two-class erasure structure (mechanism now MF-1) · pipeline idempotency on `(capture_id, content_version)` · attachment-gated triggering · server-owned tenant-scoped merge (solo-operable at ~dozens/day) · never-reject-synced-data · honest background-upload promise · device-attested/server-corroborated stamps. Postgres write path: trivial at target (~0.3–2 writes/sec). AI rate limits: non-issue at ~2 jobs/sec peak.

*Full per-axis findings with citations retained in the three reviewer outputs; this document is the reconciled gate record.*
