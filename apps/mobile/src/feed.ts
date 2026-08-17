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

import { CO_AUTHOR_JOIN, CO_PHOTO_SUBQUERY } from './changeorder.ts';

export type FeedItem = {
  id: string;
  scope: string;
  amountCents: number | null;
  /** The change-order number — the shared row card's kicker (2026-08-13). `nteCents`
   *  was added beside it in the same change, to label the price fixed-vs-cap, and
   *  removed again when that label came off the card; nothing else read it. */
  coNumber: number | null;
  status: string;
  openQuestions: number;
  projectId: string;
  projectName: string | null;
  atMs: number;
  actor: string | null;
  lastAct: string | null;   // captured · priced · sent · approver
  /**
   * WHO RAISED IT, and WHEN they raised it (hadar, 2026-08-12: "the records should
   * note who created it, when, its current state").
   *
   * NOT the same pair as `actor`/`atMs` above, and the difference is the whole point of
   * adding them. Those two answer "what moved last" — they change every time anybody
   * touches the extra, so on a row a client approved yesterday they name the CLIENT.
   * These two are fixed at birth and never move: they answer "whose extra is this",
   * which on a company-wide stream is the question an owner is actually asking when he
   * does not recognise a line. On a solo operator's phone they are the same person, and
   * that is fine — the cost of carrying them is one join.
   *
   * `createdBy` is null when nobody was named at capture (an extra raised before the
   * actor log existed, or a device with no profile name). Null renders as ABSENT, never
   * as "Unknown" — inventing an author on a record that will carry a signature is the
   * one thing this field must not do.
   */
  createdBy: string | null;
  createdAtMs: number;
  /**
   * Relpath of the extra's FIRST photo, for the row's thumbnail. Null when the extra
   * is voice-only — the card then draws the microphone placeholder (hadar, 2026-08-14:
   * "make sure to place the first image if exists").
   *
   * Same rule as the job and Home lists — `CO_PHOTO_SUBQUERY`, imported rather than
   * re-written, so "the first photo" cannot come to mean three different things on
   * three screens showing the same extra.
   *
   * KNOWN AND STATED: `capture_commit` is a DEVICE-LOCAL table. On a company feed
   * spanning other members' work, their media is not on this phone, so those rows
   * legitimately have no thumbnail. That is a missing local file, not a missing photo,
   * and it degrades to the placeholder rather than to a broken image.
   */
  photoRelpath: string | null;
};

export async function companyFeed(
  db: AbstractPowerSyncDatabase, limit = 60,
): Promise<FeedItem[]> {
  // The latest actor for each extra is resolved ONCE (name + act + time from the SAME
  // row) via a window pick, so name and verb can never come from different rows on an
  // at_ms tie (two acts stamped the same Date.now() in one flow), and the sort is
  // deterministic — id breaks the tie (review 2026-07-25).
  const rows = await db.getAll<{
    id: string; scope: string; amount_cents: number | null;
    co_number: number | null; status: string;
    open_questions: number; project_id: string; project_name: string | null;
    at_ms: number; actor: string | null; last_act: string | null;
    created_by: string | null; created_at_ms: number;
    photo_relpath: string | null;
  }>(
    `SELECT co.id, co.scope, co.amount_cents, co.co_number,
            COALESCE(co.status,'draft') AS status,
            (SELECT COUNT(*) FROM co_question q WHERE q.change_order_id = co.id) AS open_questions,
            co.project_id,
            (SELECT name FROM project WHERE id = co.project_id) AS project_name,
            COALESCE(la.at_ms, co.numbers_confirmed_at_ms, co.created_at_ms, 0) AS at_ms,
            la.name AS actor, la.act AS last_act,
            fa.name AS created_by,
            COALESCE(co.created_at_ms, fa.at_ms, 0) AS created_at_ms,
            -- change_order is aliased co above, which is what the subquery assumes.
            ${CO_PHOTO_SUBQUERY} AS photo_relpath
       FROM change_order co
       LEFT JOIN (
         SELECT subject_id, name, act, at_ms,
                ROW_NUMBER() OVER (PARTITION BY subject_id ORDER BY at_ms DESC, id DESC) AS rn
           FROM extra_actor WHERE subject_kind = 'change_order'
       ) la ON la.subject_id = co.id AND la.rn = 1
       -- The AUTHOR: the FIRST act on the extra, ordered the mirror image of la above.
       -- Deliberately not filtered to act='captured'. That act is written by the
       -- capture flow, and an extra typed rather than spoken never gets one — filtering
       -- would leave those rows permanently anonymous. The earliest act of ANY kind is
       -- by definition the person who brought the extra into existence.
       LEFT JOIN ${CO_AUTHOR_JOIN} fa ON fa.subject_id = co.id AND fa.rn = 1
      WHERE COALESCE(co.status,'draft') <> 'superseded'
      ORDER BY at_ms DESC, co.id DESC
      LIMIT ?`, [limit]);
  return rows.map((r) => ({
    id: r.id, scope: r.scope, amountCents: r.amount_cents, status: r.status,
    coNumber: r.co_number,
    openQuestions: r.open_questions ?? 0,
    projectId: r.project_id, projectName: r.project_name, atMs: r.at_ms,
    actor: r.actor, lastAct: r.last_act,
    createdBy: r.created_by, createdAtMs: r.created_at_ms ?? 0,
    photoRelpath: r.photo_relpath,
  }));
}
