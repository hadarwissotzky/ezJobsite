/**
 * R5c — the per-job approver roster, and the type on an extra.
 *
 * The decision logic is NOT here. It is in `approverrouting.ts`, which has no
 * imports so it can be tested (`approverrouting.test.ts`). This file is the
 * boring half: local durable storage, the outbox, and the query that feeds the
 * pure function.
 *
 * WHY APP-OWNED SQLITE AND NOT A POWERSYNC TABLE:
 *   CLAUDE.md's split sends mutable relational rows to PowerSync and append-only
 *   evidence to an owned outbox. A roster looks mutable, so PowerSync looks right.
 *   Two things say otherwise.
 *
 *   1. The precedent in this repo is `project_party` (parties.ts + 120_parties.sql):
 *      a per-project list of people, app-owned local table, own outbox, NOT in
 *      AppSchema. A second per-project list of people syncing a different way would
 *      be two answers to one question.
 *   2. A PowerSync table needs the server table AND deployed sync rules before it
 *      does anything. Both are currently blocked. App-owned means the roster works
 *      offline on day one and the outbox carries it up when the server catches up --
 *      which is mandate #7, and is the whole reason the outbox pattern exists here.
 *
 *   The mutation it actually needs is add + retire, and retire is a status flag,
 *   exactly as project_party models it. That is append-mostly, not free mutation.
 *
 * WHERE THE ROSTER COMES FROM (R5c): it is never a directory the contractor fills
 * in up front. It starts as whoever the first extra was sent to and accumulates,
 * the same principle as R7's implicit project creation.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { sha256 } from 'js-sha256';
import { t as t2 } from './i18n';
import {
  suggestApprover, isApproverRole,
  type Approver, type ApproverRole, type ExtraType, type Suggestion,
} from './approverrouting';

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
      -- Drives the recents fallback in suggestApprover. 0 = never sent to.
      last_used_ms  INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL
   ) STRICT`,

  `CREATE INDEX IF NOT EXISTS approver_by_project
     ON project_approver (project_id, status)`,

  // Same shape as change_order_outbox and scope_outbox. Deleting an outbox row must
  // never be able to destroy the roster entry it was carrying.
  `CREATE TABLE IF NOT EXISTS approver_outbox (
      mutation_id   TEXT NOT NULL PRIMARY KEY,
      approver_id   TEXT NOT NULL,
      payload_json  TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      queued_at_ms  INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_text TEXT
   ) STRICT`,
];

export async function ensureApproverSchema(db: AbstractPowerSyncDatabase) {
  for (const s of APPROVER_DDL) await db.execute(s);
  // extra_type on the change order. Added here rather than in CHANGE_ORDER_DDL
  // because that array is a CREATE TABLE list and this has to run against tables
  // that already exist on phones in the field. SQLite has no ADD COLUMN IF NOT
  // EXISTS, so the error is inspected rather than blanket-swallowed: a duplicate
  // column is the expected no-op, anything else is a real failure and must surface.
  try {
    await db.execute(`ALTER TABLE change_order ADD COLUMN extra_type TEXT`);
  } catch (e: any) {
    if (!/duplicate column/i.test(String(e?.message ?? e))) throw e;
  }
}

const newId = () =>
  `apr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Roster row as the app uses it. `lastUsedMs` matches the pure module's shape. */
export type RosterMember = Approver & {
  phone: string | null;
  email: string | null;
};

export async function listRoster(
  db: AbstractPowerSyncDatabase, projectId: string
): Promise<RosterMember[]> {
  const rows = await db.getAll<{
    id: string; name: string; role: string;
    phone_e164: string | null; email: string | null; last_used_ms: number;
  }>(
    `SELECT id, name, role, phone_e164, email, last_used_ms
       FROM project_approver
      WHERE project_id = ? AND status = 'active'
      ORDER BY last_used_ms DESC, name`,
    [projectId]
  );
  // A row whose role is not one we know is DROPPED, not coerced to 'other'. It can
  // only arrive from a newer build or a hand-edited database, and quietly relabelling
  // someone's authority is worse than not offering them.
  return rows.filter((r) => isApproverRole(r.role)).map((r) => ({
    id: r.id, name: r.name, role: r.role as ApproverRole,
    lastUsedMs: r.last_used_ms, phone: r.phone_e164, email: r.email,
  }));
}

export async function addApprover(
  db: AbstractPowerSyncDatabase,
  o: { projectId: string; name: string; role: ApproverRole;
       phone?: string | null; email?: string | null }
): Promise<string> {
  const name = o.name.trim();
  if (!name) throw new Error('an approver needs a name');
  if (!isApproverRole(o.role)) throw new Error(`unknown approver role: ${o.role}`);

  const id = newId();
  const now = Date.now();
  const payload = {
    id, project_id: o.projectId, name, role: o.role,
    phone_e164: o.phone?.trim() || null, email: o.email?.trim() || null,
    created_at_ms: now,
  };
  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO project_approver
         (id, project_id, name, role, phone_e164, email, last_used_ms, created_at_ms)
       VALUES (?,?,?,?,?,?,0,?)`,
      [id, o.projectId, name, o.role, payload.phone_e164, payload.email, now]
    );
    // Atomic with the row, same reason as addParty: a crash between them leaves an
    // approver only this phone knows about, and the next device would re-add them.
    const json = JSON.stringify(payload);
    await tx.execute(
      `INSERT INTO approver_outbox
         (mutation_id, approver_id, payload_json, payload_sha256, queued_at_ms)
       VALUES (?,?,?,?,?)`,
      [`m-${id}`, id, json, sha256(json), now]
    );
  });
  return id;
}

/**
 * Retire someone. NOT a DELETE: an extra already sent to them names them, and the
 * record has to keep resolving. Mirrors project_party's active/removed.
 */
export async function retireApprover(
  db: AbstractPowerSyncDatabase, approverId: string
): Promise<boolean> {
  const r = await db.execute(
    `UPDATE project_approver SET status = 'removed' WHERE id = ? AND status = 'active'`,
    [approverId]
  );
  return !!r.rowsAffected;
}

/**
 * Record that a request actually went to this person. Called AFTER a successful
 * send, never before: `last_used_ms` drives the recents fallback, and an attempt
 * that failed is not evidence of anything.
 */
export async function markApproverUsed(
  db: AbstractPowerSyncDatabase, approverId: string, whenMs = Date.now()
): Promise<boolean> {
  const r = await db.execute(
    `UPDATE project_approver SET last_used_ms = ? WHERE id = ?`, [whenMs, approverId]
  );
  return !!r.rowsAffected;
}

/** Store the contractor's chosen type on the extra. */
export async function setExtraType(
  db: AbstractPowerSyncDatabase, changeOrderId: string, type: ExtraType | null
): Promise<boolean> {
  const r = await db.execute(
    `UPDATE change_order SET extra_type = ? WHERE id = ?`, [type, changeOrderId]
  );
  return !!r.rowsAffected;
}

/**
 * Who should this go to? Reads the roster and defers to the pure function.
 *
 * Returns a SUGGESTION. It is pre-filled on the preview card with its reason
 * visible, and overriding it is one tap (R5c). Nothing here sends anything, and
 * nothing here should ever be called in a code path that does not show the result
 * to a human first -- mandate #2 forbids a commitment leaving on an inference.
 */
export async function suggestFor(
  db: AbstractPowerSyncDatabase, projectId: string, type: ExtraType | null
): Promise<{ suggestion: Suggestion; roster: RosterMember[] }> {
  const roster = await listRoster(db, projectId);
  return { suggestion: suggestApprover(type, roster), roster };
}

/** Localized label for a stored type slug. */
export const typeLabel = (t: ExtraType) => t2(`xt.${t}`);
/** Localized label for a stored role slug. */
export const roleLabel = (r: ApproverRole) => t2(`role.${r}`);

/**
 * The suggestion's reason, in the reader's language, ready to render.
 *
 * This exists because the pure module returns STORED SLUGS -- 'code_permit',
 * 'general_contractor' -- and the reason strings interpolate them. Handing those
 * straight to t() rendered "code_permit → Dana, your general_contractor" in English
 * and left the slugs untranslated in Spanish, which is mandate #5 broken on the one
 * line whose whole job is to let the sender check the routing before a price goes
 * out. Slugs are for the database; people get words.
 */
export function reasonText(s: Suggestion): string {
  if (s.kind !== 'suggested') return '';
  const p = s.reasonParams;
  return t2({
    k: s.reasonKey,
    p: {
      name: p.name,
      ...(p.type ? { type: typeLabel(p.type as ExtraType) } : {}),
      ...(p.role ? { role: roleLabel(p.role as ApproverRole) } : {}),
    },
  } as any);
}
