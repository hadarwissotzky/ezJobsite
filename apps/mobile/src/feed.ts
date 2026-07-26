/**
 * Company feed — REQ-PM9. A reverse-chron stream of the extras happening across ALL
 * of the company's projects (not one job at a time), so an owner sees the whole
 * company at a glance. Reads only synced data (change_order + extra_actor + project),
 * so it needs no new table; its cross-MEMBER value lights up once company membership
 * is deployed (until then it is the current user's own stream).
 *
 * One row per extra at its MOST-RECENT event, attributed to who last acted on it
 * (extra_actor). Superseded versions are folded out (the live one carries the story).
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

export type FeedItem = {
  id: string;
  scope: string;
  amountCents: number | null;
  status: string;
  openQuestions: number;
  projectId: string;
  projectName: string | null;
  atMs: number;
  actor: string | null;
  lastAct: string | null;   // captured · priced · sent · approver
};

export async function companyFeed(
  db: AbstractPowerSyncDatabase, limit = 60,
): Promise<FeedItem[]> {
  // The latest actor for each extra is resolved ONCE (name + act + time from the SAME
  // row) via a window pick, so name and verb can never come from different rows on an
  // at_ms tie (two acts stamped the same Date.now() in one flow), and the sort is
  // deterministic — id breaks the tie (review 2026-07-25).
  const rows = await db.getAll<{
    id: string; scope: string; amount_cents: number | null; status: string;
    open_questions: number; project_id: string; project_name: string | null;
    at_ms: number; actor: string | null; last_act: string | null;
  }>(
    `SELECT co.id, co.scope, co.amount_cents, COALESCE(co.status,'draft') AS status,
            (SELECT COUNT(*) FROM co_question q WHERE q.change_order_id = co.id) AS open_questions,
            co.project_id,
            (SELECT name FROM project WHERE id = co.project_id) AS project_name,
            COALESCE(la.at_ms, co.numbers_confirmed_at_ms, co.created_at_ms, 0) AS at_ms,
            la.name AS actor, la.act AS last_act
       FROM change_order co
       LEFT JOIN (
         SELECT subject_id, name, act, at_ms,
                ROW_NUMBER() OVER (PARTITION BY subject_id ORDER BY at_ms DESC, id DESC) AS rn
           FROM extra_actor WHERE subject_kind = 'change_order'
       ) la ON la.subject_id = co.id AND la.rn = 1
      WHERE COALESCE(co.status,'draft') <> 'superseded'
      ORDER BY at_ms DESC, co.id DESC
      LIMIT ?`, [limit]);
  return rows.map((r) => ({
    id: r.id, scope: r.scope, amountCents: r.amount_cents, status: r.status,
    openQuestions: r.open_questions ?? 0,
    projectId: r.project_id, projectName: r.project_name, atMs: r.at_ms,
    actor: r.actor, lastAct: r.last_act,
  }));
}
