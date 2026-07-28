/**
 * R5b / REQ-LC22 — "Revise & Resend": what one version replaced, for the screens
 * that have to show it.
 *
 * WHAT USED TO BE HERE, AND WHY IT IS GONE (2026-07-28). This file exported
 * `reviseChangeOrder`, which read the prior row, created a new one at the new
 * price, posted an optional note to the thread, called `supersedeExtra` and wrote
 * the lineage column. It had ZERO CALLERS anywhere in the repo. The revision path
 * the app actually runs is: App.tsx `startRevision` (which prefills the composer
 * from the prior row) → the read-back composer → `confirmPriced` →
 * `createChangeOrder` + `supersedeExtra`. So the "carry the prior version forward"
 * logic existed TWICE, once live in `startRevision` and once dead here, and the
 * dead copy did not know about the four flow terms (375) that the live one carries
 * — a revision routed through it would have silently dropped the payment timing,
 * schedule impact and exclusions out of the new instrument (REQ-LC41).
 *
 * Deleting it rather than wiring it up is the choice that leaves ONE implementation
 * of a live path instead of promoting a stale second one. The one behaviour the
 * live path was genuinely missing — writing `change_order.superseded_by` — moved
 * into `supersedeExtra` (ledgerstatus.ts), where it now commits in the same
 * transaction as the status change instead of in a follow-up statement a crash
 * could land between.
 *
 * NOT FOLDED IN, and named rather than quietly dropped: the optional revision NOTE.
 * It was a parameter no caller ever supplied, and the composer collects no such
 * field, so there is nothing to fold — reinstating R5b's "the record captures why
 * the price moved even when the discussion happened off-app" needs a note field on
 * the revise composer and a `postReply` on the prior version BEFORE the
 * supersession retires its link. That is UI work and it is owed; inventing an
 * auto-authored message to a client in its place would be putting words the
 * contractor never wrote into a live negotiation.
 *
 * REQ-LC22's Accept clause names `reviseChangeOrder` by name. That sentence is now
 * describing a function that does not exist; what it is actually asserting — a
 * revision creates a row and supersedes, and sends nothing — remains true of the
 * live path, which sends nothing either (mandate #2 gets no exception for the
 * second price just because a human confirmed the first).
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';

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
