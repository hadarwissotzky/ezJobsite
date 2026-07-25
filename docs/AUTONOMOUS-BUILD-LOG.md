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
