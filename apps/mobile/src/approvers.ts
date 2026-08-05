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
// The cross-job identity rule lives in its own leaf so it can be unit-tested
// (this module imports ./i18n, which the node test runner cannot resolve).
import { personKey } from './personkey.ts';
export { personKey };
import { sha256 } from 'js-sha256';
import { SupabaseClient } from '@supabase/supabase-js';
import { t as t2 } from './i18n';
import {
  suggestApprover, isApproverRole, isChainSide, isExtraType,
  type Approver, type ApproverRole, type ChainSide, type ExtraType, type Suggestion,
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

export async function ensureApproverSchema(db: AbstractPowerSyncDatabase) {
  for (const s of APPROVER_DDL) await db.execute(s);
  // WHERE THIS PERSON SITS RELATIVE TO ME (hadar, 2026-07-31).
  //
  // `role` says what someone IS on the job (designer, GC). It does NOT say which
  // side of me they stand on, and the same word flips meaning with my own position:
  // "general contractor" is who I bill when I am the sub, and who I am when I hire
  // one. An extra has to name who the decision is FOR, so the chain direction is its
  // own fact:
  //   'homeowner'    — the end client. The money starts here.
  //   'supply_chain' — a link between me and that money (GC above me, a sub I direct,
  //                    a designer or inspector whose sign-off gates the work).
  // NULL = never asked. Kept distinguishable from an answer, exactly like
  // `can_bind_money`: "we did not ask" and "we asked and they are a sub" are
  // different facts, and only the first should prompt.
  try {
    await db.execute(`ALTER TABLE project_approver ADD COLUMN chain_side TEXT`);
  } catch (e: any) {
    if (!/duplicate column/i.test(String(e?.message ?? e))) throw e;
  }
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

/**
 * Queue one R5c change for upload. Always called INSIDE the caller's write
 * transaction so the row and the intent to send it commit together -- a crash
 * between them would leave a change only this phone knows about.
 */
async function enqueue(
  tx: { execute: (sql: string, args: any[]) => Promise<any> },
  kind: 'add' | 'retire' | 'used' | 'type',
  rowId: string,
  payload: Record<string, unknown>,
  whenMs: number
) {
  const json = JSON.stringify(payload);
  await tx.execute(
    `INSERT INTO r5c_outbox
       (mutation_id, kind, row_id, payload_json, payload_sha256, queued_at_ms)
     VALUES (?,?,?,?,?,?)`,
    // The mutation id carries the timestamp: retiring and re-adding the same person,
    // or retyping the same extra, must be DIFFERENT mutations. Keying on row id
    // alone would make the second one a replay of the first and it would be dropped
    // as already_applied.
    [`m-${kind}-${rowId}-${whenMs}`, kind, rowId, json, sha256(json), whenMs]
  );
}

/** Roster row as the app uses it. `lastUsedMs` matches the pure module's shape. */
export type RosterMember = Approver & {
  phone: string | null;
  email: string | null;
  /** Which side of me they stand on. null = never asked (a third state). */
  chainSide: ChainSide | null;
};

/**
 * Everyone this account has ever named, MINUS the job already on screen.
 *
 * WHY (hadar, 2026-08-05: "quickly identify and add a source / owner from the
 * contact list or the local company list that is built up"). `listRoster` is
 * scoped `WHERE project_id = ?`, so the picker only ever offered THIS job's
 * people. The same homeowner on last month's job was invisible: the contractor
 * had to go back through the phone's contact picker for somebody the app already
 * knew, and that re-entry wrote a SECOND project_approver row for one human.
 *
 * The list a solo operator actually has is not per-job, it is everyone he works
 * with — the GC he subs for, the inspector, the three homeowners on the street.
 * That list builds itself as a side effect of using the app, and it was being
 * thrown away at the job boundary.
 *
 * DEDUPED, because the same person legitimately has one row per job. `personKey`
 * decides identity and the MOST RECENTLY USED row wins, so the phone number and
 * chain side shown are the freshest facts on record rather than the oldest.
 *
 * This is a CONVENIENCE list, not an authority. Picking someone here copies their
 * name/phone onto this extra exactly as the contact picker would; it does not
 * grant them a role on this job, and `project_approver` is still written per job
 * by whatever the caller does next. Nothing about who may bind money is decided
 * here (bindsMoney/approverrouting still own that).
 */
export async function listKnownPeople(
  db: AbstractPowerSyncDatabase, excludeProjectId: string | null, limit = 60
): Promise<RosterMember[]> {
  const rows = await db.getAll<{
    id: string; name: string; role: string;
    phone_e164: string | null; email: string | null; last_used_ms: number;
    can_bind_money: number | null; chain_side: string | null;
  }>(
    `SELECT id, name, role, phone_e164, email, last_used_ms, can_bind_money, chain_side
       FROM project_approver
      WHERE status = 'active'
        AND (? IS NULL OR project_id <> ?)
        AND length(trim(name)) > 0
      ORDER BY last_used_ms DESC, name`,
    [excludeProjectId, excludeProjectId]
  );
  const seen = new Set<string>();
  const out: RosterMember[] = [];
  for (const r of rows) {
    if (!isApproverRole(r.role)) continue;          // same rule as listRoster
    const key = personKey(r.name, r.phone_e164);
    if (seen.has(key)) continue;                    // rows arrive newest-first
    seen.add(key);
    out.push({
      id: r.id, name: r.name, role: r.role as ApproverRole,
      lastUsedMs: r.last_used_ms, phone: r.phone_e164, email: r.email,
      canBindMoney: r.can_bind_money == null ? undefined : r.can_bind_money === 1,
      chainSide: isChainSide(r.chain_side) ? r.chain_side : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function listRoster(
  db: AbstractPowerSyncDatabase, projectId: string
): Promise<RosterMember[]> {
  const rows = await db.getAll<{
    id: string; name: string; role: string;
    phone_e164: string | null; email: string | null; last_used_ms: number;
    can_bind_money: number | null; chain_side: string | null;
  }>(
    `SELECT id, name, role, phone_e164, email, last_used_ms, can_bind_money, chain_side
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
    // undefined (not false) when unset: bindsMoney() must fall through to the role
    // default, and `0 ?? x` would not.
    canBindMoney: r.can_bind_money == null ? undefined : r.can_bind_money === 1,
    // An unrecognised value is treated as NEVER ASKED rather than coerced: quietly
    // relabelling where someone sits in the chain is the same class of lie as
    // relabelling their authority (see the role filter above).
    chainSide: isChainSide(r.chain_side) ? r.chain_side : null,
  }));
}

export async function addApprover(
  db: AbstractPowerSyncDatabase,
  o: { projectId: string; name: string; role: ApproverRole;
       phone?: string | null; email?: string | null;
       /** Leave undefined when not asked; the role default then applies. */
       canBindMoney?: boolean;
       /** Which side of me they stand on. Omit when not asked — that is a third
        *  state, not a default (see the column comment in ensureApproverSchema). */
       chainSide?: ChainSide | null }
): Promise<string> {
  const name = o.name.trim();
  if (!name) throw new Error('an approver needs a name');
  if (!isApproverRole(o.role)) throw new Error(`unknown approver role: ${o.role}`);

  const id = newId();
  const now = Date.now();
  const payload = {
    id, project_id: o.projectId, name, role: o.role,
    phone_e164: o.phone?.trim() || null, email: o.email?.trim() || null,
    can_bind_money: o.canBindMoney == null ? null : (o.canBindMoney ? 1 : 0),
    chain_side: o.chainSide ?? null,
    created_at_ms: now,
  };
  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO project_approver
         (id, project_id, name, role, phone_e164, email, can_bind_money,
          chain_side, last_used_ms, created_at_ms)
       VALUES (?,?,?,?,?,?,?,?,0,?)`,
      [id, o.projectId, name, o.role, payload.phone_e164, payload.email,
       payload.can_bind_money, payload.chain_side, now]
    );
    // Atomic with the row, same reason as addParty: a crash between them leaves an
    // approver only this phone knows about, and the next device would re-add them.
    await enqueue(tx, 'add', id, payload, now);
  });
  return id;
}

/**
 * THE CLIENT DRAWER'S ONE WRITE (hadar, 2026-07-31: "roster is the source of truth").
 *
 * Name + phone + where-they-sit belong to the PERSON, not to one extra, so they are
 * stored once on the roster and every extra on the job reads the same row. Matching is
 * by name, case- and space-insensitively, for the reason `PeopleSection` already
 * states: these strings are typed by hand in more than one place and will not agree on
 * capitalisation, and two rows for one human is how a job ends up with two answers to
 * "who approves this".
 *
 * An existing row is UPDATED, never duplicated — and a field the caller left blank
 * does not erase what is already known (COALESCE-style at the call site): a contractor
 * who opens the drawer to answer the chain question must not lose the phone number
 * somebody else entered.
 *
 * Returns the roster id so the caller can point the extra at it.
 */
export async function saveClientApprover(
  db: AbstractPowerSyncDatabase,
  o: { projectId: string; name: string; phone?: string | null;
       chainSide?: ChainSide | null; role?: ApproverRole }
): Promise<string> {
  const name = o.name.trim();
  if (!name) throw new Error('a client needs a name');
  const key = name.toLowerCase().replace(/\s+/g, ' ');

  const existing = await db.getAll<{ id: string; name: string }>(
    `SELECT id, name FROM project_approver WHERE project_id = ? AND status = 'active'`,
    [o.projectId]);
  const hit = existing.find(
    (r) => r.name.trim().toLowerCase().replace(/\s+/g, ' ') === key);

  if (!hit) {
    return addApprover(db, {
      projectId: o.projectId, name,
      // The chain answer implies the role we would otherwise have to ask for twice:
      // a homeowner IS the owner role. Anything else stays 'other' until someone
      // says more — a guess about authority is exactly what BINDS_MONEY_BY_DEFAULT
      // refuses to make silently.
      role: o.role ?? (o.chainSide === 'homeowner' ? 'owner' : 'other'),
      phone: o.phone ?? null,
      chainSide: o.chainSide ?? null,
    });
  }

  const now = Date.now();
  const phone = o.phone?.trim() || null;
  await db.writeTransaction(async (tx) => {
    // COALESCE on phone: a blank field means "not answered here", never "erase it".
    // chain_side is passed straight through — the drawer always sends the current
    // answer, including a deliberate null.
    await tx.execute(
      `UPDATE project_approver
          SET name = ?, phone_e164 = COALESCE(?, phone_e164), chain_side = ?
        WHERE id = ?`,
      [name, phone, o.chainSide ?? null, hit.id]);
    await enqueue(tx, 'add', hit.id, {
      id: hit.id, project_id: o.projectId, name,
      phone_e164: phone, chain_side: o.chainSide ?? null, at_ms: now,
    }, now);
  });
  return hit.id;
}

/**
 * Retire someone. NOT a DELETE: an extra already sent to them names them, and the
 * record has to keep resolving. Mirrors project_party's active/removed.
 */
export async function retireApprover(
  db: AbstractPowerSyncDatabase, approverId: string
): Promise<boolean> {
  const now = Date.now();
  let moved = false;
  await db.writeTransaction(async (tx) => {
    const r = await tx.execute(
      `UPDATE project_approver SET status = 'removed' WHERE id = ? AND status = 'active'`,
      [approverId]
    );
    moved = !!r.rowsAffected;
    // Only enqueue when a row actually moved. Queueing a no-op would upload a
    // retirement for somebody who was already retired, and the server would record
    // a second one -- noise that looks like a real event in an audit trail.
    if (moved) await enqueue(tx, 'retire', approverId, { id: approverId, at_ms: now }, now);
  });
  return moved;
}

/**
 * Record that a request actually went to this person. Called AFTER a successful
 * send, never before: `last_used_ms` drives the recents fallback, and an attempt
 * that failed is not evidence of anything.
 */
export async function markApproverUsed(
  db: AbstractPowerSyncDatabase, approverId: string, whenMs = Date.now()
): Promise<boolean> {
  let moved = false;
  await db.writeTransaction(async (tx) => {
    // Never walk recency BACKWARDS. Two devices drain out of order all the time, and
    // an older send arriving second must not make someone look more recent than the
    // newer one did -- last_used_ms drives who gets suggested next.
    const r = await tx.execute(
      `UPDATE project_approver SET last_used_ms = ?
        WHERE id = ? AND last_used_ms < ?`,
      [whenMs, approverId, whenMs]
    );
    moved = !!r.rowsAffected;
    if (moved) await enqueue(tx, 'used', approverId, { id: approverId, at_ms: whenMs }, whenMs);
  });
  return moved;
}

/** Store the contractor's chosen type on the extra. */
export async function setExtraType(
  db: AbstractPowerSyncDatabase, changeOrderId: string, type: ExtraType | null
): Promise<boolean> {
  if (type !== null && !isExtraType(type)) throw new Error(`unknown extra type: ${type}`);
  const now = Date.now();
  let moved = false;
  await db.writeTransaction(async (tx) => {
    const r = await tx.execute(
      `UPDATE change_order SET extra_type = ? WHERE id = ?`, [type, changeOrderId]
    );
    moved = !!r.rowsAffected;
    // The type is NOT part of the frozen instrument -- it is a label for routing and
    // for "what keeps recurring on this job" (R5c). So it stays editable after send,
    // unlike scope and price, and each edit is its own mutation.
    if (moved) {
      await enqueue(tx, 'type', changeOrderId,
        { id: changeOrderId, extra_type: type, at_ms: now }, now);
    }
  });
  return moved;
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

/**
 * Push queued R5c changes to the server.
 *
 * Mirrors drainScopeOutbox (parties.ts) deliberately, down to the backoff: this is
 * the fourth outbox in the app and a fourth retry policy would be a fourth thing to
 * get subtly wrong. Idempotent server-side via r5c_mutation, so a reply lost on the
 * wire replays safely.
 *
 * Failures are RECORDED AND RETRIED, never dropped. A roster that silently fails to
 * upload is how phone B keeps suggesting a retired approver.
 */
export async function drainR5cOutbox(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, ownerId: string
) {
  const r = { attempted: 0, uploaded: 0, alreadyApplied: 0, retryable: 0 };
  const rows = await db.getAll<{
    mutation_id: string; kind: string; row_id: string;
    payload_json: string; payload_sha256: string; attempt_count: number;
  }>(
    `SELECT mutation_id, kind, row_id, payload_json, payload_sha256, attempt_count
       FROM r5c_outbox WHERE next_attempt_at_ms <= ?
      ORDER BY queued_at_ms LIMIT 20`,
    [Date.now()]
  );
  for (const row of rows) {
    r.attempted++;
    try {
      const p = JSON.parse(row.payload_json);
      const { data, error } = await supabase.rpc('ingest_r5c_v1', {
        p_mutation_id: row.mutation_id, p_kind: row.kind, p_id: row.row_id,
        p_owner_id: ownerId,
        p_project_id: p.project_id ?? null,
        p_name: p.name ?? null, p_role: p.role ?? null,
        p_phone_e164: p.phone_e164 ?? null, p_email: p.email ?? null,
        p_can_bind_money: p.can_bind_money == null ? null : p.can_bind_money === 1,
        p_extra_type: p.extra_type ?? null,
        p_at_ms: p.at_ms ?? p.created_at_ms ?? null,
        p_created_at_ms: p.created_at_ms ?? null,
        p_request_sha256: row.payload_sha256,
      });
      if (error) throw error;
      await db.execute(`DELETE FROM r5c_outbox WHERE mutation_id = ?`, [row.mutation_id]);
      if (data?.status === 'already_applied') r.alreadyApplied++; else r.uploaded++;
    } catch (e: any) {
      const n = row.attempt_count + 1;
      await db.execute(
        `UPDATE r5c_outbox SET attempt_count = ?, next_attempt_at_ms = ?,
           last_error_code = ?, last_error_text = ? WHERE mutation_id = ?`,
        [n, Date.now() + Math.min(60_000 * 2 ** Math.min(n, 6), 30 * 60_000),
         String(e?.code ?? 'unknown'), String(e?.message ?? e).slice(0, 500),
         row.mutation_id]
      );
      r.retryable++;
    }
  }
  return r;
}
