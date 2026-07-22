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
  db: AbstractPowerSyncDatabase, projectId: string, jobName: string
): Promise<ActivityRow[]> {
  const cos = await db.getAll<{
    id: string; scope: string; status: string;
    signed_by: string | null; created_at_ms: number;
  }>(
    `SELECT id, scope, status, signed_by, created_at_ms
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
    changeOrderId: c.id, scope: c.scope, jobName,
    status: c.status, signedBy: c.signed_by, createdAtMs: c.created_at_ms,
    questions: msgs.filter((m) => m.change_order_id === c.id)
      .map((m) => ({ id: m.id, body: m.body, atMs: m.at_ms })),
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
