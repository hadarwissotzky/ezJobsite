/**
 * SENDS THAT ARE WAITING ON A CREDIT.
 *
 * hadar, 2026-08-17: "queue it — but needs to prompt the user letting them know that
 * they cannot send if they don't have credits."
 *
 * `sendgate.ts` decides that a send must wait. THIS is where the waiting send lives, and
 * the reason it needs a table rather than a flag is the second half of what the app
 * already tells him:
 *
 *     "Add more and it goes out on its own — you don't have to come back."
 *       (i18n `gate.fixBuyCredits`)
 *
 * That sentence is a PROMISE, and mandate #1's rule about never acknowledging what has
 * not happened applies to it exactly as it applies to a capture. Keeping the intent only
 * in React state would break the promise on the walk back to the truck: the app is
 * backgrounded, the state is gone, and the change order he was told would send itself
 * silently never does. So the intent is durable, and it names the person it is owed to.
 *
 * ─── WHY IT STORES THE APPROVER, NOT JUST THE ID ────────────────────────────────
 * The retry must reach the SAME person he confirmed. Re-deriving the recipient later from
 * whatever the roster looks like then is how a held change order goes to the wrong
 * client — mandate #2's confirmation was about a specific name and phone, and a queue
 * that quietly re-resolves it is sending something nobody confirmed.
 *
 * ─── LOCAL, NEVER SYNCED ────────────────────────────────────────────────────────
 * Same rule as `co_live_link` above it: the server's authority is the RESERVATION, and a
 * hold is this phone's note-to-self that it still owes a send. Two devices holding the
 * same extra is harmless — the reservation is idempotent per change order, so the second
 * one to reach the server finds the credit already held and sends without taking another.
 *
 * ─── WHAT IT IS NOT ─────────────────────────────────────────────────────────────
 * It is not a background sender. Nothing here wakes the phone. The drain runs when the
 * app is in front of him — including the moment he returns from paying — which is the
 * flow the promise was written for. A contractor who buys credits on a laptop and never
 * opens the app has nothing sent on his behalf, and that is the honest boundary.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

export const SEND_HOLD_DDL = [
  `CREATE TABLE IF NOT EXISTS send_hold (
      change_order_id TEXT NOT NULL PRIMARY KEY,
      -- The confirmed recipient, copied at the moment of the tap. See above: this is
      -- deliberately a copy and not a join.
      approver_id     TEXT,
      approver_name   TEXT,
      approver_phone  TEXT,
      held_at_ms      INTEGER NOT NULL,
      -- Drain attempts that did NOT send. A hold that keeps failing stops being retried
      -- automatically (see MAX_ATTEMPTS) so a broken one cannot burn a round-trip on
      -- every launch forever while looking like it is still working.
      attempts        INTEGER NOT NULL DEFAULT 0,
      last_error      TEXT
   ) STRICT`,
];

export async function ensureSendHoldSchema(db: AbstractPowerSyncDatabase) {
  for (const s of SEND_HOLD_DDL) await db.execute(s);
}

export type SendHold = {
  changeOrderId: string;
  approverId: string | null;
  approverName: string | null;
  approverPhone: string | null;
  heldAtMs: number;
  attempts: number;
  lastError: string | null;
};

/**
 * After this many failed drains the hold stops being retried on its own.
 *
 * Not a giving-up: the row stays, it still counts in the "waiting to send" line, and a
 * deliberate tap still sends it. What stops is the AUTOMATIC retry, because a hold
 * failing for a reason credits cannot fix (a dead link base, a retired approver) would
 * otherwise re-fail on every foreground and keep telling him it is on its way.
 */
export const MAX_ATTEMPTS = 5;

/**
 * Remember that this change order still owes a send.
 *
 * Keyed by change order, so tapping Send three times leaves ONE hold. `held_at_ms` is
 * preserved on conflict — the queue is ordered oldest-first and a re-tap must not send
 * him to the back of his own line.
 */
export async function holdSend(
  db: AbstractPowerSyncDatabase,
  o: {
    changeOrderId: string;
    approverId?: string | null;
    approverName?: string | null;
    approverPhone?: string | null;
    atMs?: number;
  }
): Promise<void> {
  await db.execute(
    `INSERT INTO send_hold
       (change_order_id, approver_id, approver_name, approver_phone, held_at_ms, attempts, last_error)
     VALUES (?,?,?,?,?,0,NULL)
     ON CONFLICT(change_order_id) DO UPDATE SET
       approver_id    = excluded.approver_id,
       approver_name  = excluded.approver_name,
       approver_phone = excluded.approver_phone,
       -- attempts RESET on a deliberate re-tap: he has asked again, which is a new
       -- intent, not a continuation of a failing one.
       attempts       = 0,
       last_error     = NULL`,
    [o.changeOrderId, o.approverId ?? null, o.approverName ?? null,
     o.approverPhone ?? null, o.atMs ?? Date.now()]
  );
}

/** Everything still waiting, oldest first. */
export async function heldSends(db: AbstractPowerSyncDatabase): Promise<SendHold[]> {
  try {
    const rows = await db.getAll<{
      change_order_id: string; approver_id: string | null; approver_name: string | null;
      approver_phone: string | null; held_at_ms: number; attempts: number;
      last_error: string | null;
    }>(`SELECT change_order_id, approver_id, approver_name, approver_phone,
               held_at_ms, attempts, last_error
          FROM send_hold ORDER BY held_at_ms ASC`);
    return rows.map((r) => ({
      changeOrderId: r.change_order_id,
      approverId: r.approver_id,
      approverName: r.approver_name,
      approverPhone: r.approver_phone,
      heldAtMs: r.held_at_ms,
      attempts: r.attempts,
      lastError: r.last_error,
    }));
  } catch {
    // No table yet -> nothing is waiting. A launch that predates this schema must not
    // crash on the way to a screen.
    return [];
  }
}

/** It went. Called only after the send actually succeeded — see `drainHolds` in App. */
export async function clearHold(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<void> {
  await db.execute(`DELETE FROM send_hold WHERE change_order_id = ?`, [changeOrderId]);
}

/** A drain tried and did not send. Records why, so the fifth failure is explainable. */
export async function noteHoldAttempt(
  db: AbstractPowerSyncDatabase, changeOrderId: string, error: string
): Promise<void> {
  await db.execute(
    `UPDATE send_hold SET attempts = attempts + 1, last_error = ?
      WHERE change_order_id = ?`, [error.slice(0, 300), changeOrderId]);
}

/**
 * WHICH HELD SENDS MAY BE ATTEMPTED RIGHT NOW.
 *
 * Pure, because this is the part that is easy to get wrong and impossible to test through
 * a UI: it decides how many network sends fire the instant the app comes to the
 * foreground.
 *
 * `available` is the server's count, and NULL means it could not be read. Unknown is not
 * zero (`credits.ts` explains why at length) — but it is not "send everything" either, so
 * an unknown balance attempts exactly ONE. That single round-trip is what turns unknown
 * into known: the server either reserves, and the next drain proceeds with a real number,
 * or refuses, and nothing else was wasted. A contractor who queued six extras in a
 * basement does not fire six sends the moment a bar of signal appears.
 */
export function holdsToDrain(
  holds: readonly SendHold[], available: number | null
): SendHold[] {
  const live = holds.filter((h) => h.attempts < MAX_ATTEMPTS);
  if (available === null) return live.slice(0, 1);
  if (available <= 0) return [];
  return live.slice(0, available);
}

/**
 * The count for the line that tells him what is waiting.
 *
 * Counts EVERY hold, including ones past MAX_ATTEMPTS. They are still waiting; they have
 * only stopped retrying themselves. Hiding them would be the app quietly dropping a
 * change order it said it would send.
 */
export function heldCount(holds: readonly SendHold[]): number {
  return holds.length;
}
