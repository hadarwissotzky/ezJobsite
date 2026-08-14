/**
 * R6b item 3 — WHO DID WHAT, stored at the moment it happened.
 *
 * THE GAP THIS CLOSES. record.ts's header is explicit that no name is stored for
 * who captured or who priced an extra, and that an earlier version filled the hole
 * from the signed-in profile AT RENDER TIME — so editing your profile rewrote who
 * priced a two-week-old record. Deleting that was right. It left R6b's first AC
 * unmeetable: "approver (with role), captured-by, and priced/sent-by are each shown
 * with timestamps" cannot be met by omission.
 *
 * So the fix is not in the reader, it is in the writer: this file records the actor
 * AT THE EVENT, once, append-only, with the event's own clock. Read-time inference
 * stays forbidden. `recordFacts()` below reads columns and nothing else.
 *
 * THE SPLIT: the decision logic lives in `recordpeople.ts`, which has no imports and
 * is unit-tested. This file is the boring half — SQLite, the outbox, and the query
 * that feeds the pure function. Same shape as approverrouting.ts + approvers.ts.
 *
 * WHY APP-OWNED SQLITE AND NOT A POWERSYNC TABLE: identical reasoning to
 * approvers.ts, and for the stronger reason. This is EVIDENCE — mandate #1 says
 * evidence tables are append-only and mandate #7 says the network is never a
 * precondition to storing a decision. A PowerSync table needs the server table and
 * deployed sync rules before it stores anything; app-owned + outbox works in a
 * basement on day one.
 *
 * WHY THE ROLE IS COPIED ONTO THE ROW rather than joined live to the roster: the
 * roster is mutable (retire, re-role) and the record is not. A live join would mean
 * retiring an approver silently changes what an already-signed record says about who
 * was entitled to approve it.
 */
// `import type` + explicit .ts, so `node --test` can load this file for its DDL. Both
// of the first two are TYPES ONLY — imported as values they pulled the whole PowerSync
// and Supabase React Native packages into any test that touched EXTRA_ACTOR_DDL, which
// is why feedauthor.test.ts could not use the shipped schema. Types erase; runtime is
// unchanged. Same fix, same reason, as discussionstore.ts.
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { sha256 } from 'js-sha256';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProfile } from './profile.ts';
import { isApproverRole, isExtraType } from './approverrouting.ts';
import {
  assemblePeople, type ActorAct, type ActorFact, type ItemKind, type PersonRow,
} from './recordpeople.ts';

/** Both things an actor row can be attached to. A capture exists long before the
 *  change order does — often before anyone has decided the item carries a price at
 *  all — so "who captured this" cannot be keyed on the change order. */
export type SubjectKind = 'capture' | 'change_order';

export const EXTRA_ACTOR_DDL = [
  `CREATE TABLE IF NOT EXISTS extra_actor (
      id            TEXT NOT NULL PRIMARY KEY,
      subject_kind  TEXT NOT NULL CHECK (subject_kind IN ('capture','change_order')),
      subject_id    TEXT NOT NULL,
      act           TEXT NOT NULL CHECK (act IN ('captured','priced','sent','approver')),
      -- Never nullable and never blank: a row that cannot name anybody is not an
      -- actor fact, and rendering it would put a nameless person on a legal record.
      name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
      -- act='approver' only: the roster row this was addressed to, and the role
      -- COPIED from it at that moment. See the header on why it is copied.
      approver_id   TEXT,
      role          TEXT,
      -- The event's own clock, not the row's. For a capture this is the shutter
      -- moment, which can be minutes before the row is written.
      at_ms         INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL
   ) STRICT`,

  // Mandate #1: evidence is append-only. Who priced an extra is not a field that
  // gets corrected later -- a different answer is a different event.
  `CREATE TRIGGER IF NOT EXISTS extra_actor_no_update
     BEFORE UPDATE ON extra_actor
     BEGIN SELECT RAISE(ABORT, 'who did what is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS extra_actor_no_delete
     BEFORE DELETE ON extra_actor
     BEGIN SELECT RAISE(ABORT, 'who did what is never destroyed'); END`,

  `CREATE INDEX IF NOT EXISTS extra_actor_by_subject
     ON extra_actor (subject_kind, subject_id)`,

  // Same (kind, row_id) transport shape as r5c_outbox, deliberately: this is the
  // fifth outbox in the app and a fifth retry policy would be a fifth thing to get
  // subtly wrong. It matters that these sync -- an actor fact that only ever lives
  // on the phone that wrote it is lost with that phone, and "who recorded this" is
  // exactly what gets asked when the phone is long gone.
  `CREATE TABLE IF NOT EXISTS extra_actor_outbox (
      mutation_id   TEXT NOT NULL PRIMARY KEY,
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

export async function ensureExtraActorSchema(db: AbstractPowerSyncDatabase) {
  for (const s of EXTRA_ACTOR_DDL) await db.execute(s);
}

/**
 * Deterministic id, so the same event written twice is ONE row.
 *
 * The alternative -- a random id -- would turn every caller retry into a second
 * "priced by" for the same moment. `INSERT OR IGNORE` on this key makes noting an
 * actor safe to call again after a failure, which is what lets every call site
 * below swallow its errors without leaving a half-written record.
 */
const actorId = (kind: SubjectKind, subjectId: string, act: string, atMs: number) =>
  `ea-${kind}-${subjectId}-${act}-${atMs}`;

async function insertActor(
  db: AbstractPowerSyncDatabase,
  row: { kind: SubjectKind; subjectId: string; act: ActorAct | 'approver'; name: string;
         atMs: number; approverId?: string | null; role?: string | null }
): Promise<boolean> {
  const name = row.name.trim();
  if (!name) return false;                       // never a nameless actor
  if (!Number.isFinite(row.atMs)) return false;  // never an actor without a moment
  const id = actorId(row.kind, row.subjectId, row.act, row.atMs);
  const now = Date.now();
  const payload = {
    id, subject_kind: row.kind, subject_id: row.subjectId, act: row.act, name,
    approver_id: row.approverId ?? null, role: row.role ?? null,
    at_ms: row.atMs, created_at_ms: now,
  };
  const json = JSON.stringify(payload);
  let wrote = false;
  await db.writeTransaction(async (tx) => {
    const r = await tx.execute(
      `INSERT OR IGNORE INTO extra_actor
         (id, subject_kind, subject_id, act, name, approver_id, role, at_ms, created_at_ms)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, row.kind, row.subjectId, row.act, name, payload.approver_id, payload.role,
       row.atMs, now]
    );
    wrote = !!r.rowsAffected;
    // Atomic with the row, same reason as every other outbox here: a crash between
    // them leaves a fact only this phone will ever know.
    if (wrote) {
      await tx.execute(
        `INSERT INTO extra_actor_outbox
           (mutation_id, row_id, payload_json, payload_sha256, queued_at_ms)
         VALUES (?,?,?,?,?)`,
        [`m-actor-${id}`, id, json, sha256(json), now]
      );
    }
  });
  return wrote;
}

/**
 * Record that the person using this device did something to this item.
 *
 * NEVER THROWS, and never blocks its caller. Mandate #1: a capture is never lost
 * and never delayed for bookkeeping. If this fails, the People block is missing a
 * row -- which is the honest outcome, and the same one as before this file existed.
 * The alternative, letting a failed actor write abort a capture or a send, would
 * trade the record's most important guarantee for one of its labels.
 *
 * The NAME comes from the device profile READ NOW, at the moment of the event, and
 * is copied into the row. That is the entire difference from the bug record.ts
 * documents: the same read at render time re-attributed old records to whoever the
 * profile currently names.
 */
export async function noteActorNow(
  db: AbstractPowerSyncDatabase,
  o: { subjectKind: SubjectKind; subjectId: string; act: ActorAct; atMs?: number }
): Promise<boolean> {
  try {
    const prof = await getProfile(db);
    const name = (prof?.name ?? '').trim();
    // No profile name means we genuinely do not know who this was. R6b's People
    // block then omits the row, which is this file's rule, not a degradation.
    if (!name) return false;
    return await insertActor(db, {
      kind: o.subjectKind, subjectId: o.subjectId, act: o.act,
      name, atMs: o.atMs ?? Date.now(),
    });
  } catch {
    return false;
  }
}

/**
 * Record who committed a capture. Call it once, immediately after performCapture
 * reports ok, from every producer (voice, fused session, photo/video, note).
 *
 * THE MOMENT IS READ BACK FROM THE COMMITTED ROW, not passed in by the caller. Five
 * call sites each handing over their own idea of "now" is five chances to record the
 * moment the bytes finished arriving instead of the moment the shutter fired — for a
 * 60-second video those differ by a minute, and capture.ts already resolved that
 * question once (`stamp.capturedAtMs ?? Date.now()`). Asking the row is the only way
 * to be sure the People block and the history agree about when the capture happened.
 */
export async function noteCapturedBy(
  db: AbstractPowerSyncDatabase, captureId: string
): Promise<boolean> {
  try {
    const row = (await db.getAll<{ captured_at_ms: number }>(
      `SELECT captured_at_ms FROM capture_commit WHERE capture_id = ?`, [captureId]))[0];
    if (!row) return false;
    return await noteActorNow(db, {
      subjectKind: 'capture', subjectId: captureId, act: 'captured',
      atMs: row.captured_at_ms,
    });
  } catch {
    return false;
  }
}

/**
 * Record WHO THIS WENT TO and what they were entitled to do, at send.
 *
 * Called only after a send actually succeeded -- an attempt that failed is not
 * evidence that anyone was asked, the same rule markApproverUsed follows.
 */
export async function noteApprover(
  db: AbstractPowerSyncDatabase,
  o: { changeOrderId: string; approverId: string | null; name: string;
       role: string | null; atMs?: number }
): Promise<boolean> {
  try {
    return await insertActor(db, {
      kind: 'change_order', subjectId: o.changeOrderId, act: 'approver',
      name: o.name, approverId: o.approverId,
      role: isApproverRole(o.role) ? o.role : null,
      atMs: o.atMs ?? Date.now(),
    });
  } catch {
    return false;
  }
}

/** Everything R6b needs that record.ts does not already read. */
export type RecordFacts = {
  /** Item 1: Extra or Decision. */
  kind: ItemKind;
  /** R5c type slug, validated. Null is first-class: an untyped extra is normal. */
  extraType: string | null;
  people: PersonRow[];
};

/** Same cap as record.ts uses for the same reason: a ten-year job must not be able
 *  to blow SQLite's variable limit (commonly 999). */
const MAX_CAPTURE_IDS = 200;

/**
 * Read the actor facts for one extra. Local only -- no network, ever (mandate #7):
 * the contractor opening a record in a basement gets the same People block as the
 * one opening it in the office.
 */
export async function recordFacts(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<RecordFacts | null> {
  const co = (await db.getAll<{
    decision_id: string; who_directed: string | null; signed_by: string | null;
    extra_type: string | null;
  }>(
    `SELECT decision_id, who_directed, signed_by, extra_type
       FROM change_order WHERE id = ?`, [changeOrderId]))[0];
  if (!co) return null;

  // Which captures produced this item. Narrower than record.ts's evidence walk on
  // purpose: that one follows capture_pair to reach the photos taken during the same
  // session, which is the right question for EVIDENCE. This is a different question
  // -- who committed a capture that became this decision -- and the paired siblings
  // of a capture are the same person's own session anyway.
  const caps = await db.getAll<{ capture_id: string }>(
    `SELECT DISTINCT capture_id FROM decision_version
      WHERE decision_id = ? AND capture_id IS NOT NULL
      ORDER BY created_at_ms LIMIT ?`, [co.decision_id, MAX_CAPTURE_IDS]);

  const ids = caps.map((c) => c.capture_id);
  const marks = ids.map(() => '?').join(',');
  const rows = await db.getAll<{
    act: string; name: string; role: string | null; at_ms: number;
  }>(
    `SELECT act, name, role, at_ms FROM extra_actor
      WHERE (subject_kind = 'change_order' AND subject_id = ?)
      ${ids.length ? `OR (subject_kind = 'capture' AND subject_id IN (${marks}))` : ''}
      ORDER BY at_ms`,
    ids.length ? [changeOrderId, ...ids] : [changeOrderId]
  );

  const actors: ActorFact[] = [];
  let approver: { name: string; role: string | null; atMs: number } | null = null;
  for (const r of rows) {
    if (r.act === 'approver') {
      // Latest wins: a re-send can go to somebody else, and who currently holds it
      // is the question the record is opened to answer. Earlier recipients stay in
      // the history below, unabridged.
      if (!approver || r.at_ms >= approver.atMs) {
        approver = { name: r.name, role: isApproverRole(r.role) ? r.role : null, atMs: r.at_ms };
      }
      continue;
    }
    // An act this build does not know is DROPPED, not coerced. It can only come
    // from a newer build or a hand-edited database, and quietly relabelling what
    // somebody did is worse than not showing it. Mirrors listRoster's rule on roles.
    if (r.act === 'captured' || r.act === 'priced' || r.act === 'sent') {
      actors.push({ act: r.act as ActorAct, name: r.name, atMs: r.at_ms });
    }
  }

  return {
    // DERIVED, not stored, and derivable in exactly one way: reaching this loader
    // means a change_order row exists, and a change order carries a price by
    // construction (amount_cents is NOT NULL). R10's Decision is an item that was
    // never priced -- it has no change_order -- so it cannot arrive here. See the
    // handover notes: nothing yet opens a record for one.
    kind: 'extra',
    extraType: isExtraType(co.extra_type) ? co.extra_type : null,
    people: assemblePeople({
      actors, approver,
      whoDirected: co.who_directed ?? null,
      signedBy: co.signed_by ?? null,
    }),
  };
}

/**
 * Push actor facts to the server. Mirrors drainR5cOutbox down to the backoff.
 *
 * Failures are RECORDED AND RETRIED, never dropped: this is the append-only
 * evidence of who touched a priced commitment, and a queue that silently gives up
 * is how the server's copy of a record ends up with nobody's name on it.
 */
export async function drainExtraActorOutbox(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, ownerId: string
) {
  const r = { attempted: 0, uploaded: 0, alreadyApplied: 0, retryable: 0 };
  const rows = await db.getAll<{
    mutation_id: string; row_id: string; payload_json: string;
    payload_sha256: string; attempt_count: number;
  }>(
    `SELECT mutation_id, row_id, payload_json, payload_sha256, attempt_count
       FROM extra_actor_outbox WHERE next_attempt_at_ms <= ?
      ORDER BY queued_at_ms LIMIT 20`, [Date.now()]
  );
  for (const row of rows) {
    r.attempted++;
    try {
      const p = JSON.parse(row.payload_json);
      const { data, error } = await supabase.rpc('ingest_extra_actor_v1', {
        p_mutation_id: row.mutation_id, p_id: p.id, p_owner_id: ownerId,
        p_subject_kind: p.subject_kind, p_subject_id: p.subject_id,
        p_act: p.act, p_name: p.name,
        p_approver_id: p.approver_id, p_role: p.role,
        p_at_ms: p.at_ms, p_created_at_ms: p.created_at_ms,
        p_request_sha256: row.payload_sha256,
      });
      if (error) throw error;
      await db.execute(`DELETE FROM extra_actor_outbox WHERE mutation_id = ?`, [row.mutation_id]);
      if (data?.status === 'already_applied') r.alreadyApplied++; else r.uploaded++;
    } catch (e: any) {
      const n = row.attempt_count + 1;
      await db.execute(
        `UPDATE extra_actor_outbox SET attempt_count = ?, next_attempt_at_ms = ?,
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
