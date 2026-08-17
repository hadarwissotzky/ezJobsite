/**
 * The R5c roster's SQLite schema, on its own, with NO imports.
 *
 * A leaf for the same reason `personkey.ts` is one: `approvers.ts` imports `./i18n` and
 * `./approverrouting`, and the node test runner cannot resolve that graph — so any test
 * needing `project_approver` could not reach the DDL through it. The alternative was a
 * hand-copied CREATE TABLE inside the test, which is how a query passes its test and
 * then fails on a phone against the real column names.
 *
 * `approvers.ts` re-exports this, so `APPROVER_DDL` still has exactly one definition and
 * every importer keeps its existing path.
 */
export const APPROVER_DDL = [
  `CREATE TABLE IF NOT EXISTS project_approver (
      id            TEXT NOT NULL PRIMARY KEY,
      project_id    TEXT NOT NULL,
      name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
      -- "role", and here it genuinely IS a role: who this person is entitled to
      -- speak for on this job. Distinct from project_party.trade, which is the work
      -- a company does. A drywall sub is a party; the homeowner who authorises the
      -- money is an approver. Some people are both, and that is fine -- they are two
      -- facts about one person, not one fact stored twice.
      role          TEXT NOT NULL CHECK (role IN
                      ('owner','general_contractor','designer',
                       'internal_specialist','property_manager','other')),
      -- How the link reaches them. Nullable: the roster records WHO may approve even
      -- before we know how to contact them, and a half-known person is still worth
      -- more than an empty roster.
      phone_e164    TEXT,
      email         TEXT,
      status        TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','removed')),
      -- NULL = never asked, fall back to the role default (owner + GC bind money).
      -- Not a boolean default, because "we did not ask" and "we asked and they
      -- cannot" must stay distinguishable -- the routing shows a caveat for the
      -- first and simply skips them for the second.
      can_bind_money INTEGER CHECK (can_bind_money IN (0,1)),
      -- Drives the recents fallback in suggestApprover. 0 = never sent to.
      last_used_ms  INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL
   ) STRICT`,

  `CREATE INDEX IF NOT EXISTS approver_by_project
     ON project_approver (project_id, status)`,

  // Carries every R5c mutation, not just roster additions. Same (kind, row_id)
  // shape as scope_outbox, for the same reason: retiring someone, recording that a
  // link actually went to them, and typing an extra are all changes a SECOND DEVICE
  // has to learn about. The first cut enqueued only additions, so phone B kept
  // suggesting someone phone A had retired (codex #5) and the contractor's chosen
  // type never left the phone at all (codex #4).
  //
  // extra_type gets its own mutation rather than riding the change_order creation
  // payload, because the type is chosen AFTER the extra exists -- on the preview
  // card. Folding it into the creation payload would only ever sync a type that
  // happened to be set before the outbox drained, which is a race, not a design.
  //
  // NOTE: an `approver_outbox` table may exist on a dev database from the version
  // committed in ff12cff/e245e0c. Nothing ever shipped it to a device and nothing
  // reads it now; it is inert. Named differently rather than altered so a stale
  // local copy cannot half-match a new INSERT.
  `CREATE TABLE IF NOT EXISTS r5c_outbox (
      mutation_id   TEXT NOT NULL PRIMARY KEY,
      kind          TEXT NOT NULL CHECK (kind IN ('add','retire','used','type')),
      row_id        TEXT NOT NULL,
      payload_json  TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      queued_at_ms  INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_text TEXT
   ) STRICT`,
];
