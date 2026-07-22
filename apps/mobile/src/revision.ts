/**
 * R5b — "Revise & Resend". Issuing a superseding version of a priced extra.
 *
 * WHAT THIS DOES NOT DO, and it is the whole design: IT DOES NOT SEND ANYTHING.
 * It creates a DRAFT at the new price and retires the old version, and stops. The
 * new figure reaches a client only through the same preview-and-tap path every
 * other priced send uses. Mandate #2 -- "anything carrying a price or commitment
 * needs explicit human confirmation; no silent auto-send" -- does not get an
 * exception for the second price just because a human confirmed the first one.
 *
 * WHAT IT DOES NOT OWN EITHER: the supersession. `supersedeExtra` (ledgerstatus.ts,
 * R7) already writes the status, the queue, the server call and the retirement of
 * the old approval link. This file calls it. An earlier draft wrote its own -- a
 * second local table, a second RPC, a second retry policy -- and two writers for one
 * terminal transition is how a status ends up depending on which drain ran last.
 * What R5b adds on top is the part R7 does not model: the NEW version knows what it
 * replaced, so the thread carries across versions and the price delta can be shown.
 *
 * WHY A NEW ROW AND NOT AN EDIT: a sent change order is frozen, on the device
 * (change_order_frozen) and on the server (change_order_guard), because mandate #5
 * makes the text the client was shown the binding instrument. Editing it would
 * rewrite what somebody was asked to agree to. So a revision is a new instrument
 * and the old one becomes history.
 *
 * THE PRICE IS NOT DERIVED FROM THE CONVERSATION. R5b: "'ok, $1,500' in chat is not
 * an approval and the UI never treats it as one." `newAmountCents` arrives from the
 * same read-back-and-confirm field as any other price (mandate #6), which is why
 * `numbersConfirmedAt` is required here and refused by three separate layers below.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { createChangeOrder, type LineItem } from './changeorder';
import { canSupersede } from './extrastatus';
import { supersedeExtra } from './ledgerstatus';
import { postReply } from './discussionstore';

export type ReviseResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' | 'not_revisable' | 'create_failed'; detail?: string };

const newCoId = () =>
  `co-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Issue a superseding version.
 *
 * `note` exists for R5b's offline case: "after a phone call, the contractor issues
 * a revision reflecting the agreement; the record captures the outcome even when
 * the discussion happened off-app." It is posted as a contractor message on the
 * version being replaced, so the reason a price moved sits in the thread next to
 * the movement instead of nowhere.
 */
export async function reviseChangeOrder(
  db: AbstractPowerSyncDatabase,
  o: {
    priorId: string;
    ownerId: string;
    /** Confirmed by a human on screen. Never parsed out of a message. */
    newAmountCents: number;
    numbersConfirmedAt: Date;
    /** Unchanged unless the revision genuinely changes the work. */
    newScope?: string;
    newNteCents?: number | null;
    lineItems?: LineItem[];
    note?: string;
  }
): Promise<ReviseResult> {
  const prior = (await db.getAll<{
    id: string; decision_id: string; project_id: string; scope: string;
    amount_cents: number; nte_cents: number | null; is_mini: number;
    who_directed: string; ref_estimate: string | null; status: string;
  }>(
    `SELECT id, decision_id, project_id, scope, amount_cents, nte_cents, is_mini,
            who_directed, ref_estimate, status
       FROM change_order WHERE id = ?`, [o.priorId]))[0];
  if (!prior) return { ok: false, reason: 'not_found' };

  // The same gate the UI shows, restated where the write happens, and read from the
  // row rather than trusted from the caller's rendered copy: the client may have
  // answered between the screen rendering and this tap. `canSupersede` is R7's, so
  // the ledger's "may I revise this" and this path cannot drift apart.
  if (!canSupersede(prior.status)) {
    return { ok: false, reason: 'not_revisable', detail: prior.status };
  }

  const id = newCoId();
  const created = await createChangeOrder(db, {
    id, decisionId: prior.decision_id, projectId: prior.project_id, ownerId: o.ownerId,
    // Carried forward, not re-asked: a revision usually moves the price alone, and
    // making the contractor retype the scope is how scope text drifts between two
    // versions of the same extra.
    scope: o.newScope ?? prior.scope,
    amountCents: o.newAmountCents,
    nteCents: o.newNteCents === undefined ? prior.nte_cents : o.newNteCents,
    whoDirected: prior.who_directed,
    refEstimate: prior.ref_estimate,
    isMini: prior.is_mini === 1,
    lineItems: o.lineItems,
    numbersConfirmedAt: o.numbersConfirmedAt,
  });
  if (!created.ok) return { ok: false, reason: 'create_failed', detail: created.reason };

  // The note goes on the PRIOR version while its link is still live, and BEFORE the
  // supersession. Queued after, it would target a link this call is about to retire
  // and park as undeliverable -- the client would never learn why the price moved.
  if (o.note && o.note.trim()) {
    await postReply(db, {
      changeOrderId: o.priorId, body: o.note.trim(), ownerId: o.ownerId,
    });
  }

  const sup = await supersedeExtra(db, { changeOrderId: o.priorId, supersededBy: id });
  if (!sup.ok) {
    // The new draft stays. It is visible, it is priced, nothing was sent, and the
    // contractor can act on it -- which beats deleting a priced row he just built
    // because a status check lost a race (mandate #1).
    return { ok: false, reason: 'not_revisable', detail: sup.reason };
  }

  // The lineage the thread reads. Separate from supersedeExtra's write because that
  // is R7's file and this column is R5b's; if a crash lands between them, pullThreads
  // refills it from the server's own `superseded_by`, so the failure is a thread that
  // is briefly short of its history, never a wrong one.
  await db.execute(
    `UPDATE change_order SET superseded_by = ? WHERE id = ? AND superseded_by IS NULL`,
    [id, o.priorId]
  );

  return { ok: true, id };
}

/**
 * The "Revised: $1,850 → $1,500" marker's raw numbers, or null when this version
 * replaced nothing. Formatting stays with money() in changeorder.ts.
 *
 * The prior figure is READ FROM THE PRIOR ROW rather than copied at revision time.
 * That is safe here and nowhere else: a superseded change order is frozen on both
 * sides (change_order_guard / change_order_frozen), so the number cannot move. One
 * copy of a price is always better than two.
 */
export async function revisionOf(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<{ priorId: string; priorAmountCents: number } | null> {
  const r = (await db.getAll<{ id: string; amount_cents: number }>(
    `SELECT id, amount_cents FROM change_order WHERE superseded_by = ?`,
    [changeOrderId]))[0];
  return r ? { priorId: r.id, priorAmountCents: r.amount_cents } : null;
}
