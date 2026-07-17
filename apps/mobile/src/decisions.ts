/**
 * Decisions — REQ-VAL5/VAL6. The validation loop's core.
 *
 * THE MODEL, and why it looks like this:
 *
 * REQ-VAL5: "A Decision has a subject, a current (latest) value that supersedes
 * prior ones, a retained history of superseded values, aggregated captures
 * anchored to it. The latest value is authoritative; HISTORY IS NEVER DESTROYED
 * (a decision is a traceable chain, not an overwrite). Decisions -- not photos --
 * are the anchor; photos aggregate AROUND them."
 *
 * So a Decision is NOT a mutable row with a `value` column. It is:
 *   decision          -- identity + subject (never changes)
 *   decision_version  -- APPEND-ONLY chain; the newest row IS the current value
 *
 * "Change the colour to white" does not UPDATE anything. It appends a version.
 * The prior value is still there, timestamped, with the capture that produced
 * it. That is the same append-only law as capture_commit (L3/L4), applied to the
 * thing the product is actually about: what was decided, and when it changed.
 *
 * This is why `superseded` is derived, never stored: a stored flag can disagree
 * with the chain. The chain cannot disagree with itself.
 *
 * REQ-VAL6: scope_level and assignee are DEFAULTED, never asked. The hard
 * acceptance criterion is "the entire P1 decision flow presents exactly ONE
 * confirm surface" -- one card, one action. Anything that would make the user
 * reason about classification belongs inside that card as a tap-to-change
 * default, not as a question.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';

export type ScopeLevel = 'project' | 'party';

export const DECISION_DDL = [
  // Identity. A decision's SUBJECT never changes -- if the subject changes it is
  // a different decision. Only the value moves.
  `CREATE TABLE IF NOT EXISTS decision (
      id           TEXT NOT NULL PRIMARY KEY,
      project_id   TEXT NOT NULL,
      owner_id     TEXT NOT NULL,
      subject      TEXT NOT NULL CHECK (length(subject) > 0),
      -- REQ-VAL6: defaulted, never a form the user fills in.
      scope_level  TEXT NOT NULL DEFAULT 'project'
                     CHECK (scope_level IN ('project','party')),
      assignee     TEXT,
      created_at_ms INTEGER NOT NULL
   ) STRICT`,

  // The chain. Append-only: newest row = current value. Never updated, never
  // deleted -- history is the product.
  `CREATE TABLE IF NOT EXISTS decision_version (
      id            TEXT NOT NULL PRIMARY KEY,
      decision_id   TEXT NOT NULL REFERENCES decision(id),
      value         TEXT NOT NULL CHECK (length(value) > 0),
      -- the capture that produced this value: evidence for WHY it changed
      capture_id    TEXT,
      -- REQ-VAL4: who directed it. Explicit and defaulted, never inferred from audio.
      directed_by   TEXT,
      created_at_ms INTEGER NOT NULL
   ) STRICT`,

  `CREATE TRIGGER IF NOT EXISTS decision_version_no_update
     BEFORE UPDATE ON decision_version
     BEGIN SELECT RAISE(ABORT, 'decision history is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS decision_version_no_delete
     BEFORE DELETE ON decision_version
     BEGIN SELECT RAISE(ABORT, 'decision history is never destroyed'); END`,

  `CREATE INDEX IF NOT EXISTS decision_version_chain
     ON decision_version (decision_id, created_at_ms DESC)`,

  // REQ-VAL5 "aggregated captures anchored to it" / REQ-EVID3 "group related
  // captures". Photos aggregate AROUND the decision, not the other way round.
  `CREATE TABLE IF NOT EXISTS decision_capture (
      decision_id TEXT NOT NULL REFERENCES decision(id),
      capture_id  TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (decision_id, capture_id)
   ) STRICT`,
];

export async function ensureDecisionSchema(db: AbstractPowerSyncDatabase) {
  for (const s of DECISION_DDL) await db.execute(s);
}

export type DecisionRow = {
  id: string;
  subject: string;
  scope_level: ScopeLevel;
  assignee: string | null;
  current_value: string;
  directed_by: string | null;
  version_count: number;
  last_changed_ms: number;
};

/**
 * Current state of every decision. `current_value` is DERIVED from the newest
 * version, never stored -- a stored "current" can drift from the chain.
 */
export async function listDecisions(db: AbstractPowerSyncDatabase, projectId: string) {
  return db.getAll<DecisionRow>(
    `SELECT d.id, d.subject, d.scope_level, d.assignee,
            v.value        AS current_value,
            v.directed_by  AS directed_by,
            v.created_at_ms AS last_changed_ms,
            (SELECT count(*) FROM decision_version x WHERE x.decision_id = d.id) AS version_count
       FROM decision d
       JOIN decision_version v ON v.decision_id = d.id
      WHERE d.project_id = ?
        -- the newest version IS the current value (REQ-VAL5)
        AND v.created_at_ms = (SELECT max(created_at_ms) FROM decision_version w
                                WHERE w.decision_id = d.id)
      ORDER BY v.created_at_ms DESC`,
    [projectId]
  );
}

/** The retained chain. Superseded values are still here, and still true history. */
export async function decisionHistory(db: AbstractPowerSyncDatabase, decisionId: string) {
  return db.getAll<{ value: string; created_at_ms: number; capture_id: string | null; directed_by: string | null }>(
    `SELECT value, created_at_ms, capture_id, directed_by
       FROM decision_version WHERE decision_id = ? ORDER BY created_at_ms DESC`,
    [decisionId]
  );
}

/**
 * Record a decision value. Creates the decision on first use, then APPENDS.
 * Never updates. Calling this with a new value for an existing subject is how a
 * decision changes -- and the old value survives.
 */
export async function recordDecision(
  db: AbstractPowerSyncDatabase,
  opts: {
    projectId: string; ownerId: string; subject: string; value: string;
    captureId?: string; directedBy?: string;
    scopeLevel?: ScopeLevel; assignee?: string;
  }
): Promise<{ decisionId: string; versionId: string; superseded: string | null }> {
  const now = Date.now();
  const subject = opts.subject.trim().toLowerCase();

  const existing = await db.getAll<{ id: string }>(
    `SELECT id FROM decision WHERE project_id = ? AND lower(subject) = ?`,
    [opts.projectId, subject]
  );

  const decisionId = existing[0]?.id
    ?? `dec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const versionId = `dv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const prior = existing[0]
    ? (await db.getAll<{ value: string }>(
        `SELECT value FROM decision_version WHERE decision_id = ?
          ORDER BY created_at_ms DESC LIMIT 1`, [decisionId]))[0]?.value ?? null
    : null;

  await db.writeTransaction(async (tx) => {
    if (!existing[0]) {
      await tx.execute(
        `INSERT INTO decision (id, project_id, owner_id, subject, scope_level, assignee, created_at_ms)
         VALUES (?,?,?,?,?,?,?)`,
        [decisionId, opts.projectId, opts.ownerId, opts.subject.trim(),
         opts.scopeLevel ?? 'project', opts.assignee ?? null, now]
      );
    }
    await tx.execute(
      `INSERT INTO decision_version (id, decision_id, value, capture_id, directed_by, created_at_ms)
       VALUES (?,?,?,?,?,?)`,
      [versionId, decisionId, opts.value.trim(), opts.captureId ?? null,
       opts.directedBy ?? null, now]
    );
    if (opts.captureId) {
      await tx.execute(
        `INSERT OR IGNORE INTO decision_capture (decision_id, capture_id, created_at_ms)
         VALUES (?,?,?)`, [decisionId, opts.captureId, now]
      );
    }
  });

  return { decisionId, versionId, superseded: prior };
}
