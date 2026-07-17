/**
 * Who is responsible for what — REQ-VAL7.
 *
 * THE CASE THIS EXISTS FOR, from the research:
 *   the air handler needs a whip. The electrician assumed mechanical was running
 *   it; mechanical assumed the electrician was. Nobody ran it. It surfaces at
 *   inspection, six weeks later, as a change order somebody has to eat.
 *
 * That is not a communication problem to be solved with a better group chat. It
 * is a MISSING RECORD: at the moment the boundary was discussed, nobody wrote
 * down who owned it. This file is that record.
 *
 * A BOUNDARY DECISION IS A DECISION. It is deliberately NOT a new parallel
 * universe: it is a `decision` (REQ-VAL5's versioned chain, who-directed,
 * evidence) whose VALUE is a party. So "actually, mechanical is taking it" is a
 * new version, the old assignment survives, and the chain shows exactly when the
 * answer changed and who changed it -- which is the whole argument in a dispute.
 *
 * WHAT WE DETECT AND WHAT WE REFUSE TO GUESS:
 *   GAP      -- a boundary with no party. Real, and the expensive one.
 *   OVERLAP  -- two parties both told they own the same thing. Rarer, and it
 *               produces double-billing rather than a missing whip.
 * Both are FLAGGED, never auto-resolved. The system does not know who should own
 * the whip; the people on the job do. Guessing here would manufacture exactly the
 * false certainty this is meant to prevent.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { recordDecision } from './decisions';
import { sha256 } from 'js-sha256';
import { SupabaseClient } from '@supabase/supabase-js';

export const PARTY_DDL = [
  // ProjectParty, per the spec's data model: project × company, their TRADE on
  // this job, and the scope they agreed to at invite.
  `CREATE TABLE IF NOT EXISTS project_party (
      id            TEXT NOT NULL PRIMARY KEY,
      project_id    TEXT NOT NULL,
      name          TEXT NOT NULL CHECK (length(name) > 0),
      -- "trade", NOT "role": Member.role is office/field/sub. Renamed in the spec
      -- to stop exactly the confusion that made someone assume the other guy had it.
      trade         TEXT NOT NULL,
      scope_of_work TEXT,
      status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
      created_at_ms INTEGER NOT NULL
   ) STRICT`,

  // A boundary is a THING TWO TRADES MEET AT. It is named once and then assigned
  // (or not). Keeping the boundary separate from its assignment is what makes an
  // unassigned boundary VISIBLE -- if the assignment were the only row, a gap
  // would be an absence, and you cannot list absences.
  `CREATE TABLE IF NOT EXISTS scope_boundary (
      id            TEXT NOT NULL PRIMARY KEY,
      project_id    TEXT NOT NULL,
      subject       TEXT NOT NULL CHECK (length(subject) > 0),
      -- the trades that meet here, e.g. ['electrical','mechanical']
      trades_json   TEXT NOT NULL DEFAULT '[]',
      -- the decision carrying the assignment; null = NOBODY HAS SAID. That null is
      -- the entire point of this table.
      decision_id   TEXT,
      created_at_ms INTEGER NOT NULL
   ) STRICT`,
];

export const SCOPE_OUTBOX_DDL = [
  // Owned queue, same as decisions and notes: these are app-owned tables (the
  // boundary carries a meaningful NULL that a PowerSync view cannot express as
  // cleanly), so the intent is ours to carry.
  `CREATE TABLE IF NOT EXISTS scope_outbox (
      mutation_id  TEXT NOT NULL PRIMARY KEY,
      kind         TEXT NOT NULL CHECK (kind IN ('party','boundary')),
      row_id       TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      queued_at_ms INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_text TEXT
   ) STRICT`,
];

async function enqueue(db: AbstractPowerSyncDatabase, tx: any, kind: string, rowId: string, payload: any) {
  const mutationId = `sm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const json = JSON.stringify({ ...payload, mutation_id: mutationId, kind });
  await tx.execute(
    `INSERT INTO scope_outbox (mutation_id, kind, row_id, payload_json, payload_sha256, queued_at_ms)
     VALUES (?,?,?,?,?,?)`,
    [mutationId, kind, rowId, json, sha256(json), Date.now()]
  );
}

export async function ensurePartySchema(db: AbstractPowerSyncDatabase) {
  for (const s of SCOPE_OUTBOX_DDL) await db.execute(s);
  for (const s of PARTY_DDL) await db.execute(s);
}

export type Party = { id: string; name: string; trade: string; scope_of_work: string | null };

export async function addParty(
  db: AbstractPowerSyncDatabase,
  o: { projectId: string; name: string; trade: string; scopeOfWork?: string | null }
) {
  const id = `pty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO project_party (id, project_id, name, trade, scope_of_work, created_at_ms)
       VALUES (?,?,?,?,?,?)`,
      [id, o.projectId, o.name.trim(), o.trade.trim().toLowerCase(),
       o.scopeOfWork?.trim() ?? null, now]
    );
    // Atomic with the row. A crash between them leaves a party only this phone
    // knows about — and a party nobody else can see cannot be assigned anything.
    await enqueue(db, tx, 'party', id, { id, project_id: o.projectId,
      name: o.name.trim(), trade: o.trade.trim().toLowerCase(),
      scope_of_work: o.scopeOfWork?.trim() ?? null, created_at_ms: now });
  });
  return id;
}

export async function listParties(db: AbstractPowerSyncDatabase, projectId: string) {
  return db.getAll<Party>(
    `SELECT id, name, trade, scope_of_work FROM project_party
      WHERE project_id = ? AND status = 'active' ORDER BY trade, name`, [projectId]
  );
}

/**
 * Name a boundary WITHOUT assigning it. Deliberately possible, and deliberately
 * the common case: on site, "who's running the whip to the air handler?" is asked
 * long before it is answered. Forcing an answer to record the question would mean
 * the question never gets recorded -- and an unrecorded question is the whole bug.
 */
export async function nameBoundary(
  db: AbstractPowerSyncDatabase,
  o: { projectId: string; subject: string; trades: string[] }
) {
  const id = `bnd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  const trades = o.trades.map((x) => x.toLowerCase());
  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO scope_boundary (id, project_id, subject, trades_json, created_at_ms)
       VALUES (?,?,?,?,?)`,
      [id, o.projectId, o.subject.trim(), JSON.stringify(trades), now]
    );
    await enqueue(db, tx, 'boundary', id, { id, project_id: o.projectId,
      subject: o.subject.trim(), trades, decision_id: null, created_at_ms: now });
  });
  return id;
}

/**
 * Assign it. This APPENDS A DECISION VERSION -- it does not overwrite an earlier
 * answer. "The electrician is taking it" then "no, mechanical is" leaves both on
 * the record with their timestamps and who directed each, which is precisely what
 * the argument turns on six weeks later.
 */
export async function assignBoundary(
  db: AbstractPowerSyncDatabase,
  o: { boundaryId: string; projectId: string; ownerId: string;
       partyName: string; directedBy: string; captureId?: string }
) {
  const b = (await db.getAll<{ subject: string; decision_id: string | null }>(
    `SELECT subject, decision_id FROM scope_boundary WHERE id = ?`, [o.boundaryId]))[0];
  if (!b) return { ok: false as const, reason: 'no such boundary' };

  const { decisionId } = await recordDecision(db, {
    projectId: o.projectId, ownerId: o.ownerId,
    // The subject carries the BOUNDARY ID, not just the text.
    //
    // recordDecision dedupes by subject (REQ-VAL5: "trim colour" is ONE decision
    // whose value changes). That is right for decisions and WRONG here: two
    // boundaries can legitimately share a subject -- "whip to the air handler"
    // named twice, once by the GC and once by the super -- and THAT IS THE
    // OVERLAP WE EXIST TO CATCH. Keying on text collapsed them into one chain, so
    // both reported the same owner and the duplicate assignment became invisible.
    // Proven: the overlap test found nothing until this changed.
    subject: `responsibility [${o.boundaryId}]: ${b.subject}`,
    value: o.partyName,
    directedBy: o.directedBy,
    captureId: o.captureId,
    // REQ-VAL6: scope_level 'party' -- this is a decision ABOUT a party, not about
    // the project's scope. Defaulted here rather than asked; the user is telling us
    // who owns a thing, not classifying a record.
    scopeLevel: 'party',
    assignee: o.partyName,
  });

  await db.writeTransaction(async (tx) => {
    await tx.execute(`UPDATE scope_boundary SET decision_id = ? WHERE id = ?`,
      [decisionId, o.boundaryId]);
    // Re-queue so the server learns the boundary is answered. The ANSWER itself
    // rides the decision chain (ingest_decision_v1) — this only carries the link.
    // Duplicating the answer here would create a second copy that can disagree
    // with the chain, and the chain is what a dispute turns on.
    await enqueue(db, tx, 'boundary', o.boundaryId, { id: o.boundaryId,
      project_id: o.projectId, subject: b.subject, trades: [],
      decision_id: decisionId, created_at_ms: Date.now() });
  });
  return { ok: true as const, decisionId };
}

export type BoundaryRow = {
  id: string; subject: string; trades: string[];
  assignedTo: string | null;
  /** How many times the answer has changed. >1 is itself worth seeing. */
  changes: number;
  status: 'gap' | 'assigned';
};

export async function listBoundaries(
  db: AbstractPowerSyncDatabase, projectId: string
): Promise<BoundaryRow[]> {
  const rows = await db.getAll<{
    id: string; subject: string; trades_json: string; decision_id: string | null;
    assigned: string | null; changes: number;
  }>(
    `SELECT b.id, b.subject, b.trades_json, b.decision_id,
            (SELECT v.value FROM decision_version v WHERE v.decision_id = b.decision_id
              ORDER BY v.created_at_ms DESC LIMIT 1) AS assigned,
            (SELECT count(*) FROM decision_version v WHERE v.decision_id = b.decision_id) AS changes
       FROM scope_boundary b
      WHERE b.project_id = ?
      ORDER BY (b.decision_id IS NULL) DESC, b.created_at_ms DESC`,
    [projectId]
  );
  return rows.map((r) => ({
    id: r.id, subject: r.subject,
    trades: JSON.parse(r.trades_json || '[]'),
    assignedTo: r.assigned,
    changes: r.changes ?? 0,
    // GAPS FIRST in the ORDER BY above: the unassigned boundary is the one that
    // costs money, so it is the one at the top of the list.
    status: r.assigned ? 'assigned' : 'gap',
  }));
}

export type ScopeFinding =
  | { kind: 'gap'; boundaryId: string; subject: string; trades: string[]; why: string }
  | { kind: 'overlap'; subject: string; parties: string[]; why: string }
  | { kind: 'no_party_for_trade'; trade: string; subject: string; why: string };

/**
 * REQ-VAL7's detection half. FLAGS, never fixes.
 *
 * Everything here is a QUESTION FOR A HUMAN, phrased as one. The system knows two
 * trades meet at the air handler; it does not know who should run the whip. That
 * is a commercial question about who bid what, and answering it automatically
 * would produce a confident wrong answer -- the failure this whole product exists
 * to prevent.
 */
export async function scopeFindings(
  db: AbstractPowerSyncDatabase, projectId: string
): Promise<ScopeFinding[]> {
  const boundaries = await listBoundaries(db, projectId);
  const parties = await listParties(db, projectId);
  const trades = new Set(parties.map((p) => p.trade));
  const out: ScopeFinding[] = [];

  for (const b of boundaries) {
    if (b.status === 'gap') {
      out.push({
        kind: 'gap', boundaryId: b.id, subject: b.subject, trades: b.trades,
        // Grammar matters here: this text is read by a person deciding whether to
        // act. "fire_protection both touch it" reads like a bug and gets ignored.
        why: b.trades.length > 1
          ? `Nobody has said who owns this. ${b.trades.join(' and ')} both touch it.`
          : b.trades.length === 1
            ? `Nobody has said who owns this. It sits with ${b.trades[0]}.`
            : `Nobody has said who owns this.`,
      });
    }
    // A boundary naming a trade that is not ON this job. Cheap to spot, and it is
    // the shape of "we never hired anyone to do that".
    for (const tr of b.trades) {
      if (!trades.has(tr)) {
        out.push({
          kind: 'no_party_for_trade', trade: tr, subject: b.subject,
          why: `${b.subject} needs ${tr}, but no ${tr} is on this job.`,
        });
      }
    }
  }

  // OVERLAP: the same subject assigned to two different parties. Not a chain that
  // CHANGED its mind (that is normal and the newest wins) -- two SEPARATE
  // boundaries with the same subject and different owners, which means two people
  // were each told it was theirs.
  const bySubject = new Map<string, Set<string>>();
  for (const b of boundaries) {
    if (!b.assignedTo) continue;
    const k = b.subject.trim().toLowerCase();
    if (!bySubject.has(k)) bySubject.set(k, new Set());
    bySubject.get(k)!.add(b.assignedTo);
  }
  for (const [subject, owners] of bySubject) {
    if (owners.size > 1) {
      out.push({
        kind: 'overlap', subject, parties: [...owners],
        why: `${[...owners].join(' and ')} have both been told they own "${subject}". One of them is going to bill for it twice.`,
      });
    }
  }
  return out;
}

/** REQ-VAL7: "retrievable per party" — what am I on the hook for? */
export async function boundariesForParty(
  db: AbstractPowerSyncDatabase, projectId: string, partyName: string
): Promise<BoundaryRow[]> {
  return (await listBoundaries(db, projectId)).filter((b) => b.assignedTo === partyName);
}

/** Push parties and boundaries. Same rules as every owned queue here. */
export async function drainScopeOutbox(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, ownerId: string
) {
  const r = { attempted: 0, uploaded: 0, alreadyApplied: 0, retryable: 0 };
  const rows = await db.getAll<{ mutation_id: string; payload_json: string;
                                 payload_sha256: string; attempt_count: number }>(
    `SELECT mutation_id, payload_json, payload_sha256, attempt_count
       FROM scope_outbox WHERE next_attempt_at_ms <= ? ORDER BY queued_at_ms LIMIT 20`,
    [Date.now()]
  );
  for (const row of rows) {
    r.attempted++;
    try {
      const p = JSON.parse(row.payload_json);
      const { data, error } = await supabase.rpc('ingest_scope_v1', {
        p_mutation_id: p.mutation_id, p_kind: p.kind, p_id: p.id,
        p_project_id: p.project_id, p_owner_id: ownerId,
        p_name: p.name ?? null, p_trade: p.trade ?? null,
        p_scope_of_work: p.scope_of_work ?? null, p_subject: p.subject ?? null,
        p_trades: p.trades ?? null, p_decision_id: p.decision_id ?? null,
        p_created_at_ms: p.created_at_ms, p_request_sha256: row.payload_sha256,
      });
      if (error) throw error;
      await db.execute(`DELETE FROM scope_outbox WHERE mutation_id = ?`, [row.mutation_id]);
      if (data?.status === 'already_applied') r.alreadyApplied++; else r.uploaded++;
    } catch (e: any) {
      const n = row.attempt_count + 1;
      await db.execute(
        `UPDATE scope_outbox SET attempt_count = ?, next_attempt_at_ms = ?,
           last_error_code = ?, last_error_text = ? WHERE mutation_id = ?`,
        [n, Date.now() + Math.min(60_000 * 2 ** Math.min(n, 6), 30 * 60_000),
         e?.code ?? 'TRANSIENT', e?.message ?? String(e), row.mutation_id]
      );
      r.retryable++;
    }
  }
  return r;
}
