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
import { sha256 } from 'js-sha256';
import { SupabaseClient } from '@supabase/supabase-js';

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
  // Transport intent, not the record. Same law as capture_outbox: deleting a row
  // here never destroys a decision -- the append-only chain above is the
  // authority. The row is written INSIDE the same transaction as the version
  // append (see recordDecision), so a crash cannot leave a decision that is
  // durable locally but has no intent to ever reach the cloud.
  `CREATE TABLE IF NOT EXISTS decision_outbox (
      mutation_id   TEXT NOT NULL PRIMARY KEY,
      decision_id   TEXT NOT NULL,
      version_id    TEXT NOT NULL,
      payload_json  TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      queued_at_ms  INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at_ms INTEGER,
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_text TEXT
   ) STRICT`,

  // Which versions the server has confirmed. Written when the outbox drains, and
  // read by the backfill so it never re-enqueues what already landed. This is a
  // sync FACT, not a durability fact -- a decision is durable the moment its
  // version row commits, whether or not this table ever mentions it.
  `CREATE TABLE IF NOT EXISTS decision_synced (
      version_id  TEXT NOT NULL PRIMARY KEY,
      synced_at_ms INTEGER NOT NULL
   ) STRICT`,

  `CREATE TABLE IF NOT EXISTS decision_capture (
      decision_id TEXT NOT NULL REFERENCES decision(id),
      capture_id  TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (decision_id, capture_id)
   ) STRICT`,
];

export async function ensureDecisionSchema(db: AbstractPowerSyncDatabase) {
  for (const s of DECISION_DDL) await db.execute(s);
  await backfillDecisionOutbox(db);
}

/**
 * Every decision_version that predates the outbox has no intent to sync — it was
 * written when the device was the only place a decision lived. Without this, those
 * decisions are stranded forever: durable on one phone, invisible to the cloud,
 * and nothing would ever say so. Silent single-device data is the same sin as
 * silent loss, just slower.
 *
 * Safe to run on every launch:
 *  - it only enqueues versions that have NO outbox row;
 *  - the mutation id is DERIVED from the version id, not random, so a version
 *    enqueued twice across launches reuses one id rather than minting a second;
 *  - the server appends `on conflict (version_id) do nothing`, so an already-
 *    synced version is a no-op rather than a duplicate in a history chain.
 * A version that already synced and was drained gets re-sent exactly once and the
 * server ignores it. Cheap, and it beats leaving a decision behind.
 */
async function backfillDecisionOutbox(db: AbstractPowerSyncDatabase) {
  const stranded = await db.getAll<{
    id: string; decision_id: string; value: string; capture_id: string | null;
    directed_by: string | null; created_at_ms: number;
    project_id: string; subject: string; scope_level: string; assignee: string | null;
  }>(
    `SELECT v.id, v.decision_id, v.value, v.capture_id, v.directed_by, v.created_at_ms,
            d.project_id, d.subject, d.scope_level, d.assignee
       FROM decision_version v
       JOIN decision d ON d.id = v.decision_id
      WHERE NOT EXISTS (SELECT 1 FROM decision_outbox o WHERE o.version_id = v.id)
        AND NOT EXISTS (SELECT 1 FROM decision_synced s WHERE s.version_id = v.id)`
  );
  if (!stranded.length) return;

  for (const v of stranded) {
    const mutationId = `dm-bf-${v.id}`;   // derived, not random: re-runs collapse
    const payload = {
      mutation_id: mutationId, decision_id: v.decision_id, version_id: v.id,
      project_id: v.project_id, subject: v.subject, scope_level: v.scope_level,
      assignee: v.assignee, value: v.value, capture_id: v.capture_id,
      directed_by: v.directed_by, created_at_ms: v.created_at_ms,
    };
    const payloadJson = JSON.stringify(payload);
    await db.execute(
      `INSERT OR IGNORE INTO decision_outbox (mutation_id, decision_id, version_id,
         payload_json, payload_sha256, queued_at_ms)
       VALUES (?,?,?,?,?,?)`,
      [mutationId, v.decision_id, v.id, payloadJson, sha256(payloadJson), Date.now()]
    );
  }
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
  // Minted here, stored with the intent: a retry after a restart re-sends the
  // SAME id, so the server returns the original result instead of appending a
  // duplicate version to a chain that is supposed to be history.
  const mutationId = `dm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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

    // The intent to sync is committed ATOMICALLY WITH THE APPEND, never after it.
    // If this were a separate transaction, a crash in between would leave a
    // decision that is durable on the device but that nothing will ever try to
    // upload -- invisible, permanent, single-device data. That is the capture
    // path's hardest-won rule, and a decision is worth no less than a capture.
    const payload = {
      mutation_id: mutationId, decision_id: decisionId, version_id: versionId,
      project_id: opts.projectId, subject: opts.subject.trim(),
      scope_level: opts.scopeLevel ?? 'project', assignee: opts.assignee ?? null,
      value: opts.value.trim(), capture_id: opts.captureId ?? null,
      directed_by: opts.directedBy ?? null, created_at_ms: now,
    };
    const payloadJson = JSON.stringify(payload);
    await tx.execute(
      `INSERT INTO decision_outbox (mutation_id, decision_id, version_id,
         payload_json, payload_sha256, queued_at_ms)
       VALUES (?,?,?,?,?,?)`,
      [mutationId, decisionId, versionId, payloadJson, sha256(payloadJson), now]
    );
  });

  return { decisionId, versionId, superseded: prior };
}

/**
 * Drain the decision outbox. Deliberately the same shape as drainOutbox() for
 * captures, and the same rules apply: the row is deleted ONLY after the RPC
 * succeeds, retries are idempotent by mutation_id, and a permanent rejection
 * PARKS rather than being discarded to unblock the queue.
 *
 * ONE DIFFERENCE, on purpose: 23503 (foreign_key_violation) is NOT permanent
 * here. A decision_version whose decision has not landed yet is an ordering
 * race, not a corrupt payload — the RPC creates both in one call, so the only
 * way to see 23503 is a race the next attempt will win. Parking it would turn a
 * normal offline reorder into permanent single-device data.
 */
export type DecisionDrainResult = {
  attempted: number; uploaded: number; alreadyApplied: number;
  parked: number; retryable: number;
};

const DECISION_PERMANENT = new Set([
  '42501', // owner mismatch — retrying cannot fix authorization
  '23505', // same mutation_id, different payload — a real conflict, never guess
  '23514', // check_violation — the payload itself is invalid
]);

export async function drainDecisionOutbox(
  db: AbstractPowerSyncDatabase,
  supabase: SupabaseClient,
  ownerId: string
): Promise<DecisionDrainResult> {
  const r: DecisionDrainResult = { attempted: 0, uploaded: 0, alreadyApplied: 0, parked: 0, retryable: 0 };
  const rows = await db.getAll<{
    mutation_id: string; payload_json: string; payload_sha256: string; attempt_count: number;
  }>(
    `SELECT mutation_id, payload_json, payload_sha256, attempt_count
       FROM decision_outbox WHERE next_attempt_at_ms <= ?
      ORDER BY queued_at_ms LIMIT 20`,
    [Date.now()]
  );

  for (const row of rows) {
    r.attempted++;
    let p: any;
    try { p = JSON.parse(row.payload_json); }
    catch { await parkDecision(db, row.mutation_id, 'CORRUPT_PAYLOAD', 'payload_json is not valid JSON'); r.parked++; continue; }

    try {
      const { data, error } = await supabase.rpc('ingest_decision_v1', {
        p_mutation_id: p.mutation_id,
        p_decision_id: p.decision_id,
        p_version_id: p.version_id,
        p_project_id: p.project_id,
        p_owner_id: ownerId,
        p_subject: p.subject,
        p_scope_level: p.scope_level,
        p_assignee: p.assignee,
        p_value: p.value,
        p_capture_id: p.capture_id,
        p_directed_by: p.directed_by,
        p_created_at_ms: p.created_at_ms,
        p_request_sha256: row.payload_sha256,
      });
      if (error) throw error;

      // Only now is the intent spent -- and the fact is recorded first, in the
      // same transaction, so a crash here cannot both drop the intent and forget
      // that it landed.
      await db.writeTransaction(async (tx) => {
        await tx.execute(
          `INSERT OR IGNORE INTO decision_synced (version_id, synced_at_ms) VALUES (?,?)`,
          [p.version_id, Date.now()]
        );
        await tx.execute(`DELETE FROM decision_outbox WHERE mutation_id = ?`, [row.mutation_id]);
      });
      if (data?.status === 'already_applied') r.alreadyApplied++; else r.uploaded++;
    } catch (e: any) {
      const code = e?.code ?? e?.error_code;
      if (DECISION_PERMANENT.has(code)) {
        await parkDecision(db, row.mutation_id, code, e?.message ?? String(e));
        r.parked++;
      } else {
        const n = row.attempt_count + 1;
        const delay = Math.min(60_000 * 2 ** Math.min(n, 6), 30 * 60_000);
        await db.execute(
          `UPDATE decision_outbox SET attempt_count = ?, last_attempt_at_ms = ?,
             next_attempt_at_ms = ?, last_error_code = ?, last_error_text = ?
           WHERE mutation_id = ?`,
          [n, Date.now(), Date.now() + delay, code ?? 'TRANSIENT', e?.message ?? String(e), row.mutation_id]
        );
        r.retryable++;
      }
    }
  }
  return r;
}

/** Parked, not scheduled, never dropped. Surfaced in the UI. */
async function parkDecision(db: AbstractPowerSyncDatabase, mutationId: string, code: string, msg: string) {
  await db.execute(
    `UPDATE decision_outbox SET attempt_count = attempt_count + 1, last_attempt_at_ms = ?,
       next_attempt_at_ms = ?, last_error_code = ?, last_error_text = ?
     WHERE mutation_id = ?`,
    [Date.now(), 8640000000000, code, msg, mutationId]
  );
}

/** Sync state for the UI. "Saved" and "backed up" are different words. */
export async function decisionSyncStatus(db: AbstractPowerSyncDatabase) {
  const r = await db.getAll<{ pending: number; parked: number; synced: number; err: string | null }>(
    `SELECT
       (SELECT count(*) FROM decision_outbox WHERE next_attempt_at_ms <  8640000000000) AS pending,
       (SELECT count(*) FROM decision_outbox WHERE next_attempt_at_ms >= 8640000000000) AS parked,
       (SELECT count(*) FROM decision_synced) AS synced,
       -- The reason a decision has not reached the cloud is the SENDER'S business.
       -- "Still syncing" with no cause is how a stuck queue stays invisible for a week.
       (SELECT last_error_text FROM decision_outbox
         WHERE last_error_text IS NOT NULL ORDER BY last_attempt_at_ms DESC LIMIT 1) AS err`
  );
  return {
    pending: r[0]?.pending ?? 0, parked: r[0]?.parked ?? 0,
    synced: r[0]?.synced ?? 0, lastError: r[0]?.err ?? null,
  };
}
