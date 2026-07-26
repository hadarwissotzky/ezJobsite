# Autonomous build log

*Started 2026-07-25 by Claude (senior-engineer autonomous mandate from hadar: "complete the implementation of all the features in the PRD … make decisions to the best of your ability, keep a log … commit each feature … use best practices … stop only when done").*

This log records the **decisions** made while building out the PRD autonomously, and the running status of each feature. It is the "why" ledger for this build phase (companion to `IMPLEMENTATION_NOTES.md`).

## Standing decisions (apply to everything below)

- **D0 — Verification gate per feature.** Every feature: `npx tsc --noEmit` clean, `npm run check:i18n` even (both langs), `npm test` green, then commit with the WHY/GOALS/COMPLETION/BLAST-RADIUS message. Adversarial self-review (and `/codex` when a change is risky or security-touching) before moving on.
- **D1 — Server DDL is human-gated.** Applying prod migrations is blocked by the safety classifier (CLAUDE.md #2). Migrations are written + ordering-verified and left for `./scripts/apply-migration.sh`; the build proceeds on the client where it can, and flags server steps hadar must run.
- **D2 — Secrets/API keys.** When a feature needs a third-party key (SMS, push), I implement the full integration reading the key from an env var / Edge Function secret, document the exact key name here, and leave it for hadar to supply. No key is ever hardcoded or committed.
- **D3 — ICP first.** Every UX decision is judged against the core design test (CLAUDE.md §1): a contractor for whom software is not second nature must succeed without being taught. Big touch targets, plain words, minimal steps, no jargon.

## Feature status

| PRD REQ | Feature | Status |
|---|---|---|
| REQ-ORG1/ROLE1 | Company tenant + membership (server) | ✅ built (migration 376, needs apply) |
| REQ-ORG1/ROLE1 | Company client schema + logic | ✅ built |
| REQ-ORG1/ROLE1 | Team / Invite / Join **UI** | ⏳ in progress |
| (hadar) | Settings surface + profile editing | ⏳ |
| REQ-AUTH1 | Real accounts (signup/login) | ⬜ |
| REQ-NOTIF1 | Notifications (in-app + push) | ⬜ |
| REQ-VAL8 | SMS delivery (real send) | ⬜ |
| REQ-COMMENT1 | Comments / messaging | ⬜ |
| REQ-PM14 | Project labels | ⬜ |
| REQ-PM4 | Project lifecycle (archive) | ⬜ |
| REQ-GAL1/2/3 | Photo grid · viewer · tags | ⬜ |
| REQ-PM9 | Company Feed | ⬜ |
| REQ-MAP1 | Static map thumbnail | ⬜ |
| REQ-GAL4/5 | Gallery / timeline share links | ⬜ |

## Decisions

*(appended as they are made)*

### 2026-07-25 — decisions

- **DEC-1 (SMS, REQ-VAL8).** Real SMS via a Twilio Edge Function (`supabase/functions/send-sms`), not the client — credentials stay in Edge secrets. The client's automatic "Text it now" is an UPGRADE over the manual OS-share, never a replacement: if the function isn't deployed/configured, the manual "Send by text" is still there, so a link can always reach the client. Default country +1 (US ICP) when a number has no country code. **Needs from hadar:** `supabase functions deploy send-sms` + `supabase secrets set TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… TWILIO_FROM=…` (an E.164 number or an `MG…` Messaging Service SID).
- **DEC-2 (company visibility).** Chose company-wide (every member reads all company projects) over per-project crew scoping for v1 — simplest sync/RLS, matches "owner sees all"; per-project scoping is a later refinement. Writes stay owner-only.
- **DEC-3 (labels).** Will use a SINGLE color label per project (companycam's primary pattern; simplest for the ICP) rather than a many-labels join table; filter by that one label. Multi-label is a follow-up. *(pending build)*

### 2026-07-25 — orchestration model (hadar directive)

Adopted an **orchestrated, review-before-commit** model. I (main loop) act as the
**orchestrator**: decompose each feature, implement it, then run a **specialist review
panel** over the uncommitted diff BEFORE committing — parallel expert lenses:
**mobile-UX/UI · database+sync · backend · infrastructure · security · QA** (the
subset relevant to each change). Blocker/major findings are fixed and re-verified;
the feature is committed only after the panel is clean. Implemented via the Workflow
tool (`review-before-commit`). No feature is committed unreviewed.

### 2026-07-25 — lifecycle (REQ-PM4) review outcome

The first pass shipped a broken migration; the specialist panel caught 3 BLOCKERS
pre-commit (would have halted all sync + stopped project creation in prod). Fixes +
design changes, re-verified clean by the database + backend-security lenses:
- **DEC-4.** Keep `'active'` IN the status enum (verified live default + constraint =
  active/archived). The enum WIDENS to active·lead·in_progress·complete·archived
  rather than replacing 'active' — so the DEFAULT, createProject, and ingest_project_v1
  keep working. Dropped the REAL constraint name `project_status_check`.
- **DEC-5.** DROP project delete entirely for now. `project_id` sits on ~12 evidence
  tables (decision, scope_boundary, project_party, extra_work_authorization, …) with no
  FK on most; a point-in-time "empty" check is a TOCTOU that can orphan append-only
  evidence. Safe delete needs ON DELETE RESTRICT FKs first — a separate change. Archive
  is the retention-safe path.
- **DEC-6.** Sync ALL company projects (drop the status filter in sync-config), filter
  active/archived on the client — so archived rows stay on-device (the Archived tab
  needs them) and no status literal can empty a sync bucket.
- Hardened the connector: a PATCH that is empty after stripping server-owned columns is
  now skipped (the status local-echo can't become a queue-stalling empty update).

### 2026-07-25 — Company Feed (REQ-PM9) review outcome

Panel (database/mobile-UX/QA) found no blockers but several majors; fixed:
- Query: one deterministic windowed actor lookup (name+verb+time from the SAME row;
  id tiebreak) instead of 3 correlated subqueries; added open-question count.
- Render: shows the VERB ("Maria priced it"), a question-aware status chip
  (discussing surfaces), robust meta (no dangling separators), time right-aligned so
  the sort key never truncates.
- Return-to-feed on drill-in (returnToFeedRef → closeRecord reopens the feed fresh);
  reload-on-refresh so an open feed never goes stale.
- Discoverability: promoted from a footer pill to a full-width menu row w/ chevron.
- **DEC-7 (accepted, not fixed):** (a) opening a feed item whose PROJECT is not on the
  device shows the record read-only (a pre-existing record-screen limit, same as the
  push path; only reachable post company-sync-deploy; return-to-feed removes the
  lost-place pain). A cross-project ledger load is a separate record-screen change.
  (b) Bottom-nav promotion deferred — the prominent full-width row is the reviewer's
  stated minimum; a 5th nav slot is a broader nav change.

### 2026-07-25 — Remote push (REQ-NOTIF1) review outcome

Panel found a blocker + 3 majors; fixed:
- **BLOCKER (fixed):** getExpoPushTokenAsync needs an EAS projectId or it throws and
  push ships dark. Now read from EXPO_PUBLIC_EAS_PROJECT_ID and LOG when absent (no
  silent swallow). **Needs from hadar:** run `eas init`, set EXPO_PUBLIC_EAS_PROJECT_ID
  (or app.json extra.eas.projectId).
- Concurrent workers double-sent (no atomic claim) → added claim_notifications RPC
  (reserve-before-send under SKIP LOCKED, mirrors claim_job); at-most-once by design.
- One bad token failed the whole batch + retried forever → the worker now parses Expo
  per-ticket status, prunes DeviceNotRegistered tokens, and the claim caps attempts.
- notify_on_open fired on EVERY open (spam) → now only the FIRST open per link.
- **DEPLOY (logged):** apply 379; the WORKER (already needed for AI) drains the outbox
  and sends via Expo (free, no key). Push is off until EAS is configured; everything
  else works. pg_net is unavailable, which is why this is worker-drained, not a trigger→edge.
