/**
 * R8 activity centre — the local half. The decisions live in `activity.ts`, which
 * has no imports so it can be tested; this file only reads rows and remembers what
 * has been looked at.
 *
 * READ-STATE IS PER-DEVICE AND IS NOT EVIDENCE. R8's third AC says marking a
 * notification read must not alter an item's status, timeline, or approval state.
 * So it lives in its own table, it is never uploaded, and there is no outbox for
 * it. A second phone showing a different unread count is CORRECT: "have I looked at
 * this" is a fact about a person holding a handset, not about the change order.
 *
 * That is also why this file has no drain and never will. Everything else the app
 * writes locally is queued for the server precisely because losing it would lose a
 * fact; losing this loses a badge.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { buildActivity, type ActivityRow, type ActivitySource } from './activity';

export const ACTIVITY_DDL = [
  `CREATE TABLE IF NOT EXISTS activity_read (
      event_id   TEXT NOT NULL PRIMARY KEY,
      read_at_ms INTEGER NOT NULL
   ) STRICT`,
];

export async function ensureActivitySchema(db: AbstractPowerSyncDatabase) {
  for (const s of ACTIVITY_DDL) await db.execute(s);
}

/**
 * Assemble the list for one job.
 *
 * Questions come from the LOCAL thread mirror (R5b), not from the network, so the
 * bell works in a basement — which is the only place it matters, because that is
 * where the contractor is standing when a question lands.
 */
export async function activityFor(
  db: AbstractPowerSyncDatabase, projectId: string, jobName: string,
  /**
   * R3 AC4: change-order ids whose priced Step 2 is overdue, mapped to when the
   * promise came due. Passed IN rather than queried here because the caller has
   * already derived it (listEwa runs every refresh and the flag depends on the
   * clock) — deriving it twice is two answers to one question.
   */
  unpricedSince: Record<string, number> = {}
): Promise<ActivityRow[]> {
  const cos = await db.getAll<{
    id: string; scope: string; status: string; amount_cents: number | null;
    signed_by: string | null; created_at_ms: number;
  }>(
    `SELECT id, scope, status, signed_by, created_at_ms, amount_cents
       FROM change_order WHERE project_id = ? ORDER BY created_at_ms DESC LIMIT 200`,
    [projectId]
  );

  // The thread table is created by R5b's schema, which may not have run on an older
  // install. A missing table must not take the whole screen down with it -- the
  // approvals half of the list is still worth showing.
  let msgs: { id: string; change_order_id: string; body: string; at_ms: number }[] = [];
  try {
    msgs = await db.getAll(
      // `side`, not `author` — checked against discussionstore.ts's DDL rather than
      // assumed. Only the CLIENT's messages are activity; the contractor's own
      // replies are not news to him.
      `SELECT id, change_order_id, body, at_ms FROM thread_message
        WHERE side = 'client' ORDER BY at_ms`
    );
  } catch { /* R5b schema not present yet */ }

  const read = new Set(
    (await db.getAll<{ event_id: string }>(`SELECT event_id FROM activity_read`))
      .map((r) => r.event_id)
  );

  const sources: ActivitySource[] = cos.map((c) => ({
    changeOrderId: c.id, scope: c.scope, jobName, amountCents: c.amount_cents,
    status: c.status, signedBy: c.signed_by, createdAtMs: c.created_at_ms,
    questions: msgs.filter((m) => m.change_order_id === c.id)
      .map((m) => ({ id: m.id, body: m.body, atMs: m.at_ms })),
    unpricedSince: unpricedSince[c.id] ?? null,
  }));

  return buildActivity(sources, read);
}

/** Remember that these were seen. Idempotent; never touches an item. */
export async function markRead(
  db: AbstractPowerSyncDatabase, eventIds: string[], atMs = Date.now()
): Promise<number> {
  if (!eventIds.length) return 0;
  let n = 0;
  await db.writeTransaction(async (tx) => {
    for (const id of eventIds) {
      const r = await tx.execute(
        `INSERT OR IGNORE INTO activity_read (event_id, read_at_ms) VALUES (?,?)`,
        [id, atMs]
      );
      n += r.rowsAffected ?? 0;
    }
  });
  return n;
}

// ── R8: the live link, and the reminders sent against it ─────────────────────
//
// WHY THE LINK IS STORED AT ALL. A reminder must go "via the same link" (R8). The
// url is returned by sendForConfirmation and then thrown away — only the server
// knows it afterwards, in confirmation_request. Reminding therefore had to either
// hit the network (so no reminder in a basement, mandate #7) or mint a NEW link,
// which is what "Resend link" did and is actively harmful: it retires the token
// already sitting in the client's messages, so scrolling back to the original text
// gives them "This version was replaced" BECAUSE they were reminded.
//
// So the device keeps its own copy of the last link it issued. Local, never synced:
// the server has the authoritative record in confirmation_request, and this is a
// convenience for the phone that sent it.

export const REMIND_DDL = [
  `CREATE TABLE IF NOT EXISTS co_live_link (
      change_order_id TEXT NOT NULL PRIMARY KEY,
      token           TEXT NOT NULL,
      url             TEXT NOT NULL,
      sent_at_ms      INTEGER NOT NULL,
      -- Reminders sent against THIS link. Reset implicitly by a revision, because a
      -- revision writes a new row for a new token: a fresh instrument has a fresh
      -- reminder budget, which is correct — nobody has been nagged about it yet.
      remind_count    INTEGER NOT NULL DEFAULT 0,
      last_remind_ms  INTEGER
   ) STRICT`,
];

export async function ensureRemindSchema(db: AbstractPowerSyncDatabase) {
  for (const s of REMIND_DDL) await db.execute(s);
}

/**
 * WHETHER THE CLIENT WAS ACTUALLY TOLD — a separate fact from whether the change order
 * was sent (Codex, 2026-09-03). `sendPricedApproval` mints the instrument, marks the
 * extra sent and writes the 'sent' actor, and only THEN tries the SMS. When that last
 * step fails the send is still real, but nobody has been told — and until these columns
 * existed, one dismissible sheet said so and then nothing anywhere remembered.
 *
 * ─── OFF THE LAUNCH PATH, DELIBERATELY (hadar, 2026-09-03: "the app is crashing now") ─
 *
 * These two ALTERs lived in `ensureRemindSchema`, which `ensureLocalSchema` awaits while
 * the app starts. I guarded them by rethrowing anything that was not literally
 * "duplicate column" — copied from `approvers.ts` without asking what it costs when the
 * guess about the message is wrong. It was wrong, and the app died on launch before it
 * drew a pixel, over two bookkeeping columns that record whether a text message landed.
 *
 * So they are not on that path any more. This runs on the FIRST WRITE, which only ever
 * happens after a real send, from a `void`-ed call that already cannot propagate. Two
 * independent reasons it can no longer take the app down, and the launch sequence is
 * byte-for-byte what it was before this feature existed.
 *
 * It also swallows everything now. A device that cannot add these columns should show
 * one fewer line on a waiting card; it should not fail.
 */
let deliveryColumnsTried = false;
async function ensureDeliveryColumns(db: AbstractPowerSyncDatabase): Promise<void> {
  if (deliveryColumnsTried) return;
  deliveryColumnsTried = true;   // set FIRST: one attempt per launch, success or not
  for (const col of ['delivered_at_ms INTEGER', 'deliver_fail_why TEXT', 'lang TEXT']) {
    try { await db.execute(`ALTER TABLE co_live_link ADD COLUMN ${col}`); }
    catch (e: any) {
      // Expected once the column exists. Logged, never raised, whatever it says.
      console.log('[co_live_link] add column skipped:', col, String(e?.message ?? e));
    }
  }
}

/**
 * Record what happened to the NOTIFICATION, after the send itself succeeded.
 *
 * Never called with the send's own outcome: a change order that failed to mint has no
 * link row to annotate. This is only ever the last mile.
 */
export async function noteLinkDelivery(
  db: AbstractPowerSyncDatabase,
  o: { changeOrderId: string; ok: boolean; why?: string | null; atMs?: number }
): Promise<void> {
  const now = o.atMs ?? Date.now();
  await ensureDeliveryColumns(db);
  await db.execute(
    `UPDATE co_live_link
        SET delivered_at_ms  = ?,
            deliver_fail_why = ?
      WHERE change_order_id = ?`,
    [o.ok ? now : null, o.ok ? null : (o.why ?? 'delivery failed').slice(0, 200),
     o.changeOrderId]);
}

/** What the record needs to say about the last mile. Null when there is no link row. */
export async function linkDelivery(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<null | { deliveredAtMs: number | null; failWhy: string | null }> {
  try {
    const r = await db.getAll<{ delivered_at_ms: number | null; deliver_fail_why: string | null }>(
      `SELECT delivered_at_ms, deliver_fail_why FROM co_live_link WHERE change_order_id = ?`,
      [changeOrderId]);
    if (!r.length) return null;
    return { deliveredAtMs: r[0].delivered_at_ms, failWhy: r[0].deliver_fail_why };
  } catch {
    // The columns are optional by construction (see ensureRemindSchema). "I cannot tell"
    // is a valid answer here and reads the same as "it was delivered" — silence — which
    // is the safe direction: never invent a delivery failure that was not recorded.
    return null;
  }
}

/** Remember the link that just went out. Overwrites: one live link per extra (250). */
export async function noteLinkSent(
  db: AbstractPowerSyncDatabase,
  o: { changeOrderId: string; token: string; url: string; atMs?: number;
       /** The language the instrument went out in (slice 4): every LATER text about
        *  this link — reminders, reply notices, a withdrawal — must speak it too.
        *  A client who got a Spanish document and an English reminder was written to
        *  in two voices about one paper. */
       lang?: string | null }
): Promise<void> {
  const now = o.atMs ?? Date.now();
  await ensureDeliveryColumns(db);
  try {
    await db.execute(
      `INSERT INTO co_live_link (change_order_id, token, url, sent_at_ms, remind_count, last_remind_ms, lang)
       VALUES (?,?,?,?,0,NULL,?)
       ON CONFLICT(change_order_id) DO UPDATE SET
         token = excluded.token, url = excluded.url, sent_at_ms = excluded.sent_at_ms,
         remind_count = 0, last_remind_ms = NULL, lang = excluded.lang`,
      [o.changeOrderId, o.token, o.url, now, o.lang ?? null]
    );
    return;
  } catch { /* lang column missing (ALTER failed): fall through to the old shape */ }
  await db.execute(
    `INSERT INTO co_live_link (change_order_id, token, url, sent_at_ms, remind_count, last_remind_ms)
     VALUES (?,?,?,?,0,NULL)
     ON CONFLICT(change_order_id) DO UPDATE SET
       token = excluded.token, url = excluded.url, sent_at_ms = excluded.sent_at_ms,
       remind_count = 0, last_remind_ms = NULL`,
    [o.changeOrderId, o.token, o.url, now]
  );
}

export type LiveLink = {
  url: string; token: string; remindCount: number; lastRemindMs: number | null;
  /** Why the SMS/share did not reach them, when it did not. Null = it did, or we
   *  never recorded either way (rows written before 2026-09-03). */
  deliverFailWhy: string | null;
  /** The language the instrument was sent in; every later text follows it. */
  lang: string | null;
};

export async function liveLinkFor(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<LiveLink | null> {
  /**
   * `deliver_fail_why` IS AN OPTIONAL COLUMN. `ensureRemindSchema` swallows a failed
   * ALTER rather than killing the app, so this read must not assume the column is there
   * — naming it in the SELECT unconditionally would turn a cosmetic gap into "no record
   * opens". The wide read is tried first and the original read is the fallback, so a
   * device without the column behaves exactly as it did before this feature existed.
   */
  type Row = {
    url: string; token: string; remind_count: number; last_remind_ms: number | null;
    deliver_fail_why?: string | null;
  };
  const BASE = `url, token, remind_count, last_remind_ms`;
  const EXTRAS = `deliver_fail_why, lang`;
  let r: Row[];
  try {
    r = await db.getAll<Row>(
      `SELECT ${BASE}, ${EXTRAS} FROM co_live_link WHERE change_order_id = ?`,
      [changeOrderId]);
  } catch {
    r = await db.getAll<Row>(
      `SELECT ${BASE} FROM co_live_link WHERE change_order_id = ?`, [changeOrderId]);
  }
  if (!r.length) return null;
  return { url: r[0].url, token: r[0].token,
           remindCount: r[0].remind_count, lastRemindMs: r[0].last_remind_ms,
           deliverFailWhy: r[0].deliver_fail_why ?? null,
           lang: (r[0] as { lang?: string | null }).lang ?? null };
}

/**
 * Record that a reminder went out. Called AFTER the share sheet returns, never
 * before: a contractor who opens the sheet and backs out has not reminded anyone,
 * and burning his 1-per-day on a cancelled share would be the app lying about what
 * it did.
 */
export async function noteReminded(
  db: AbstractPowerSyncDatabase, changeOrderId: string, atMs = Date.now()
): Promise<void> {
  await db.execute(
    `UPDATE co_live_link
        SET remind_count = remind_count + 1, last_remind_ms = ?
      WHERE change_order_id = ?`, [atMs, changeOrderId]);
}
