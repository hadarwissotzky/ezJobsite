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

export async function ensurePartySchema(db: AbstractPowerSyncDatabase) {
  for (const s of PARTY_DDL) await db.execute(s);
}

export type Party = { id: string; name: string; trade: string; scope_of_work: string | null };

export async function addParty(
  db: AbstractPowerSyncDatabase,
  o: { projectId: string; name: string; trade: string; scopeOfWork?: string | null }
) {
  const id = `pty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await db.execute(
    `INSERT INTO project_party (id, project_id, name, trade, scope_of_work, created_at_ms)
     VALUES (?,?,?,?,?,?)`,
    [id, o.projectId, o.name.trim(), o.trade.trim().toLowerCase(),
     o.scopeOfWork?.trim() ?? null, Date.now()]
  );
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
  await db.execute(
    `INSERT INTO scope_boundary (id, project_id, subject, trades_json, created_at_ms)
     VALUES (?,?,?,?,?)`,
    [id, o.projectId, o.subject.trim(), JSON.stringify(o.trades.map((t) => t.toLowerCase())),
     Date.now()]
  );
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

  await db.execute(`UPDATE scope_boundary SET decision_id = ? WHERE id = ?`,
    [decisionId, o.boundaryId]);
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
