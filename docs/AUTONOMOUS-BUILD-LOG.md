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

### 2026-07-25 — Account & Settings hub (menu: profile/settings/notifications/subscription/support/version)

hadar asked (with a Timemark drawer screenshot) to make sure the app has a proper
account menu — profile, settings, version, support — and to handle language, accounts,
payments. Restructured the existing Settings screen (`settingsscreen.tsx`) into the
standard field-app settings hub, top→bottom: identity header (avatar+name+company+role)
→ Profile → Team → **Preferences** (notifications, reflects real OS permission) →
**Subscription** (plan status) → **Support** (contact/feedback mailto) → **About**
(version from app.json, terms, privacy, sign out). Entry point stays the ☰ → Settings.

- **DEC-8 (payments):** v1 does NOT process payments (CLAUDE.md §5). The Subscription
  card states the pilot plan plainly and routes "upgrade" to a contact email — no fake
  checkout that cannot charge. Honest over impressive.
- **Language** already lived in Profile; kept there (one save), surfaced role/company in
  the new identity header.
- **Version** single-sourced from `app.json` (expo.version) via JSON import — no manual
  duplication, no new native dep (avoided expo-constants; a rebuild is needed anyway).

Review panel (mobile-ux + correctness + i18n/a11y, each finding adversarially verified)
confirmed 6, all fixed before commit:
- **major:** sign-out fired on one tap → Alert confirm (destructive style).
- **major:** teammate Remove was a sub-floor text target that revoked instantly →
  Alert confirm + 44pt target.
- **major:** trade chips/join below the gloves touch floor → chip minHeight 44, join 48.
- **minor:** identity role re-derived from a possibly-empty members list → use the
  always-present `MyCompany.role`.
- **minor:** company identity line rendered the literal word "Company" → empty-state
  prompt "Add your company name".
- **minor:** notification "Enable" no-op'd when the module was unavailable → 'unknown'/
  'denied' route to Open Settings (OS), only 'undetermined' offers in-app enable.
- Verify gate green: tsc clean, i18n 720/720 (EN=ES), 296 tests pass. No new migration.

### 2026-07-25 — PRD ⇄ implementation gap audit (3 parallel verifiers vs actual code)

Audited the three authoritative PRDs (SPEC-capture-core-v1, PRD-jobsite-field-record,
PRD-change-approval-loop + PM/COMMUNICATION layers) against the real code, not the
status docs. Rough tally (dedup across docs): the P0 money loop is code-complete
end-to-end; most "not-live" is go-live credentials, not missing code.

REAL DEFECTS (not just unfinished):
- **R1 paused-capture-kill loses audio** (violates mandate #1). `togglePause` holds
  the audio file open instead of stop-and-bank; `useLeavingForeground` is coded but
  never called. Fix written, deliberately unwired pending on-device test. HIGH.
- **REQ-TL4 raw video is stored + uploaded** — spec says raw video is NEVER retained/
  uploaded; extract on device. No extraction code exists. Gap + mandate-adjacent.

BUILT, BLOCKED ON SERVER ACTIONS (unlocks a large batch at once):
- Apply migrations 372–380 (esp. 376 company, 378 lifecycle, 379 push, 380 comments).
- PowerSync company-wide sync rule → feed + cross-member visibility (PM9, PM11-13).
- Twilio secrets + A2P → SMS delivery (R5, VAL8).
- Approval-page host/DNS (EXPO_PUBLIC_CONFIRM_BASE blank) → R4/R5/R5b, JOB9, GAL share.
- Deepgram + Anthropic keys + RUN the worker → structuring, transcripts (R2, PROC),
  and TL3/photonarration (empty until STT runs).
- EAS projectId → killed-app remote push (R8).
- EXPO_PUBLIC_STATIC_MAP_URL → static map (JOB10/MAP1).

GENUINELY UNBUILT (net-new):
- Recording-timeline model live-wiring (TL1-3 built in timeline.ts but zero callers;
  superseded by photonarration for TL3).
- JOB1 per-project capture timeline (flat grid removed by hadar 2026-07-23 — likely
  intentional); JOB6/JOB7 in-job capture search + tag-filter are dead state.
- JOB8 progress before/after docs; JOB9 shared auto-updating job-timeline link.
- R9 per-trade template library; R11 office web view + CSV export; R14 walkthrough
  actual auto-split (detection-only today); R15 owner review-before-send queue.
- REQ-COLLAB1-7 project-scoped cross-company collab (only company-wide invite exists).
- REQ-COMMENT1 team comments (schema-only, sql/380 — the paused feature).
- R13 content-translation pipeline (P1.5); R3 investigate-first EWA subtype.
- REQ-X1 touch-budget accounting + spoken number read-back (TTS); CAP7 pre-roll buffer;
  CAP4 at-rest file protection (NSFileProtection); VAL8 email channel; VAL4 default
  directed-by from parties roster; P4 content-signal consumed (write-only today).

Disposition: nothing above blocks the P0 pilot loop, which is code-complete and
deploy-gated. Priorities to raise with hadar: (1) the R1 durability regression,
(2) TL4 raw-video, (3) the go-live credential checklist.

### 2026-07-25 — Free tier (2 members, 2 jobs) + video removal; extras cap DEFERRED

hadar: "start a free version — invite only 2 members, create only 2 jobs, 2 extras per
job — add popups/modals when they run out of quota." Built a quota module + a branded
QuotaModal, gated at the add actions. A specialist review panel (mandate-#1 / quota-
logic / modal-UX, each finding adversarially verified) found 7 real issues; that changed
the shape of what shipped.

- **DEC-9 (extras-per-job DEFERRED):** enforcing it correctly is not possible client-
  side. Extras are auto-created eagerly on a GUESSED project before the job is picked,
  and change_order is re-hydrated from the server, so (a) blocking at file-time dead-
  ends the assign sheet — which is designed to never dead-end (review finding #1), and
  (b) a locally-discarded draft repopulates on next hydrate and pollutes the count
  (#2). Doing it right needs the capture->extra PROMOTION reworked (create the extra at
  file-time against the CHOSEN job) or a server-side gate in the change_order ingest —
  both touch the most sensitive, on-device-tested path (mandate #1). Deferred rather
  than ship the broken gate. quota.ts keeps members+jobs only.
- **DEC-10 (interpretation):** "2 members" read as 2 TOTAL incl. owner (owner + 1). One-
  line change in FREE_LIMITS if hadar meant owner+2.
- **Members enforced server-side (sql/381):** client checkMembers is only the modal —
  it sees one device's active members, not pending invites (company_invite is not
  synced), so it can't stop multi-invite bypass (#5). The real wall is accept_company_
  invite re-counting at accept time and refusing past 2. Re-accept is idempotent.
- **Jobs:** client-gated at both create paths AND un-archive (#4 was a bypass — un-
  archive re-consumes a slot). Client-only; a fresh-device pre-sync race (#7) can
  briefly under-count — acceptable for a pilot, server backstop (project-insert gate
  vs PowerSync revert) is a follow-up.
- **#3 fixed:** quick-add cap returned {ok:false} with no problemKey -> the card showed
  a spurious "bad phone" error; added a quotaBlocked flag so the modal speaks instead.
- Verify gate green: tsc, i18n 724/724 (EN=ES), 296 tests. Migration 381 is UNAPPLIED
  (D1, human-gated) — the member cap is soft until hadar applies it.

### 2026-07-26 — Design system adoption + communication/notification gaps + monetization audit

Design (committed): tokens (a0472c9), palette app-wide (a6a1b11), sentence-case type
(637bafe), status chips colour+icon+label (99240b8), extra cards + react-native-svg
kit icons (a877709). Preview artifact shared for direction sign-off.

Communication gaps (committed a1c9011): celebrate-the-yes overlay + haptic; the
"$X recovered" total (was computed, never rendered); processing-done + sent haptics.
Remaining: declined not yet a distinct local notif (gap #4), opened has no in-app
activity kind (gap #5) — both partly gated on remote push (EAS).

Notifications (committed 8d38dca): expo-notifications plugin, foreground handler,
Android channel, first-send permission prompt + token mint. Remaining = user actions:
eas init + EXPO_PUBLIC_EAS_PROJECT_ID, apply 379, deploy worker, APNs/FCM creds.

Monetization AUDIT (not yet built): zero payment infra today; one hardcoded free tier.
- **DEC-11 (payments now in scope):** hadar 2026-07-26 wants free+paid packages and to
  take money. This REVERSES CLAUDE.md §5 ("do NOT build invoicing/payments"). The
  compliant path is App Store IAP via RevenueCat (Apple forbids Stripe for digital
  subs), which is "integrate a billing SDK", narrower than "build an invoicing suite".
  Recorded as an explicit decision superseding §5 for subscriptions.
- **CONFLICT found:** PRICING-STRATEGY.md says field crew/members are FREE FOREVER on
  every tier (the growth loop) — free is capped by PROJECTS (2) × DECISIONS/project
  (~15), NOT members. But hadar earlier asked to cap free at "2 members". These
  contradict; the member cap (built in ca92d37 + sql/381) undercuts the strategy's
  network-growth loop. Needs hadar's decision before wiring entitlements.
- Build split logged: buildable-now = plans.ts (tiers), company.plan column, entitlement
  seam in quota.ts, paywall UI; needs-user = App Store Connect products, RevenueCat
  account+keys+webhook, EAS build.
