/**
 * A recording becomes an extra. Immediately, on the device, with no signal.
 *
 * THIS IS THE PRODUCT'S ACTUAL SHAPE, stated by hadar and not previously built:
 * "the user records a change order (a message) and snap some pictures that
 * become a extra (change order) that is assigned to a job site and that he can
 * send to an owner to be approved."
 *
 * What existed instead was capture -> Review screen -> confirm a "decision" ->
 * "Price it (change order)" -> extra. Two concepts the user never asked for and
 * has no words for, and a Price-it button asking him to do the thing R2 promises
 * the app will do. His verdict was unambiguous: "there is no review!"
 *
 * THE DECISION ROW STILL EXISTS, INVISIBLY, and that is deliberate rather than
 * lazy. `decision_version.capture_id` is the ONLY join from an extra back to the
 * media behind it, and four things already stand on it: R6's event timeline,
 * R2's photo-to-narration alignment, `content_resolve`'s project matching, and
 * the send gate's readiness walk. Removing the row would take all four with it.
 * So the row is created here, in the same breath as the extra, and the user
 * never meets it. Plumbing belongs under the floor, not in the hallway.
 *
 * PRICELESS BY DEFAULT (370). The price arrives from what he SAID, once the
 * transcript does. Until then the extra exists, carries its photos, and is
 * simply not sendable yet — which is what the send gate already enforces.
 */
// TYPE-ONLY: used only in signatures. A value import pulls in PowerSync's
// Flow-typed native source, which `node --test` cannot parse — the same rule
// discardstore.ts states, and what lets summary.test.ts exercise this file's SQL.
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { createChangeOrder } from './changeorder.ts';
import { recordDecision } from './decisions.ts';
// The queued-payload refresh rehashes the JSON, same as changeorder.ts does.
import { sha256 } from 'js-sha256';

/**
 * The placeholder title, and why it is a placeholder rather than a guess.
 *
 * `change_order.scope` is NOT NULL with `length(scope) > 0`, so an extra needs
 * words the instant it exists — before any transcript, possibly before any
 * signal. Inventing a description from nothing ("Extra at 14 Elm St") would put
 * a sentence on a binding document that nobody said, and R2's whole rule is that
 * the words come from the contractor. So it says plainly that it has not been
 * written up yet, and processing replaces it with a real title later.
 */
export const UNTITLED = 'Untitled extra — still being written up';

export type StartResult =
  | { ok: true; changeOrderId: string; decisionId: string }
  | { ok: false; reason: string };

/**
 * Create the extra behind a just-saved recording.
 *
 * CALLED AFTER THE CAPTURE IS DURABLE, never before and never inside its
 * transaction. Mandate #1: the recording is the evidence and nothing about
 * creating a container for it may put the bytes at risk. If this fails the
 * capture is still saved, still in the gallery, and still uploads — the
 * contractor has lost a row in the ledger, not his evidence.
 */
export async function startExtraFromCapture(
  db: AbstractPowerSyncDatabase,
  o: { captureId: string; projectId: string; ownerId: string; directedBy?: string }
): Promise<StartResult> {
  try {
    const dec = await recordDecision(db, {
      projectId: o.projectId,
      ownerId: o.ownerId,
      // `subject` is the decision's identity key and recordDecision lowercases
      // and trims it. Per-capture, so two recordings on one job never collapse
      // into versions of a single decision — they are two different extras.
      subject: `extra ${o.captureId}`,
      value: UNTITLED,
      captureId: o.captureId,
      directedBy: o.directedBy ?? 'Owner',
    });

    const id = `co-${o.captureId}`;
    const co = await createChangeOrder(db, {
      id,
      decisionId: dec.decisionId,
      projectId: o.projectId,
      ownerId: o.ownerId,
      scope: UNTITLED,
      // NULL, not 0 (370). He may not have said a price, and zero would say the
      // work is free. The send gate keeps it off a client's screen until the
      // pipeline has read what he actually said.
      amountCents: null,
      nteCents: null,
      isMini: false,
      whoDirected: o.directedBy ?? 'Owner',
      // Mandate #6 asks that no UNCONFIRMED number be stored. There is no number
      // here at all, which is a different thing and the honest one: the moment
      // is real, and it is when the extra came into existence.
      numbersConfirmedAt: new Date(),
      lineItems: [],
    });
    if (!co.ok) return { ok: false, reason: co.reason };
    return { ok: true, changeOrderId: id, decisionId: dec.decisionId };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 200) };
  }
}

/**
 * Replace the placeholder once the pipeline has words for it.
 *
 * ONLY over a placeholder, and only while it is a draft. A title the contractor
 * has edited is his, and a sent extra is frozen — `change_order_frozen` would
 * abort the write anyway, but refusing here means the app never asks for
 * something it should know it cannot have.
 */
export async function titleExtraIfUntitled(
  db: AbstractPowerSyncDatabase, changeOrderId: string, title: string
): Promise<boolean> {
  const t = title.trim();
  if (!t) return false;
  const r = await db.execute(
    `UPDATE change_order SET scope = ?
      WHERE id = ? AND status = 'draft' AND scope = ?`,
    [t.slice(0, 200), changeOrderId, UNTITLED]
  );
  return !!r.rowsAffected;
}

/**
 * The cap on `change_order.scope`, and it is a UI contract as much as a storage one.
 *
 * IT EXISTS BECAUSE THE TWO HALVES DISAGREED AND THE LOSING HALF WAS SILENT.
 * `ScopeOfWorkEditor` accepted 1500 characters and printed a "612/1500" counter,
 * and this function stored `slice(0, 200)` and returned `rowsAffected` — truthy —
 * so `saveScope` reported success. A contractor typed a 612-character scope of
 * work, watched it save, and the 412 characters that would have been frozen into
 * `shown_content` were gone with no message anywhere. That is mandate #1's silent
 * loss landing on the client-facing instrument itself.
 *
 * 1500 rather than 200 because `change_order.scope` is `text not null` on both
 * sides (030:31 — no length bound at all), so 200 was never a storage limit; it was
 * a title-length guard from when scope WAS only a title, and it stopped being one
 * when `renderCard` began sending `scope` as the document's body. Widening loses
 * nothing that used to fit. `App.tsx` passes this same constant to the editor's
 * `maxChars`, so the input stops at the number the counter names and the two cannot
 * drift apart again.
 */
export const SCOPE_MAX_CHARS = 1500;

/**
 * Replace a DRAFT's machine-written title with a better one — the AI's subject
 * over the first-sentence interim titleExtraIfUntitled wrote offline (hadar,
 * 2026-07-23: "when the extra is processed we need to generate a new title").
 *
 * Unlike titleExtraIfUntitled this overwrites ANY draft title, not only the
 * UNTITLED placeholder. That is safe ONLY because the title is not human-editable
 * in the capture → price flow — there is no rename control, so the only thing this
 * can overwrite is a machine string. If a rename path is ever added, this must be
 * gated on a not-human-edited flag before it can run. Draft-only either way: a sent
 * extra is frozen and change_order_frozen would abort the write regardless.
 */
export async function retitleDraft(
  db: AbstractPowerSyncDatabase, changeOrderId: string, title: string
): Promise<boolean> {
  const t = title.trim();
  if (!t) return false;
  const r = await db.execute(
    `UPDATE change_order SET scope = ? WHERE id = ? AND status = 'draft'`,
    [t.slice(0, SCOPE_MAX_CHARS), changeOrderId]
  );
  return !!r.rowsAffected;
}

/**
 * Store the AI's owner-facing SUMMARY of the change on a DRAFT (hadar, 2026-07-27:
 * "summarize the audio and make it clear to the audience"). This is structure.ts's
 * `value` — clear prose, grouped by task, NO prices — which the pipeline already
 * generates but the app never showed; the record displays it beside the raw
 * transcript (which is kept, verbatim, in the voice player).
 *
 * DRAFT-ONLY, for the same reason retitleDraft is: once sent, the extra is frozen
 * and the summary the client saw must not move. It is not in the freeze trigger's
 * column list, so this WHERE clause is the only thing keeping it immutable after
 * send — which is why it is a WHERE and not a caller's promise. A voice added to a
 * SENT extra grows the description through the append-only augment log instead.
 */
/**
 * Write a DRAFT's SCOPE OF WORK — the detailed client-facing text that becomes the
 * body of the frozen instrument (391).
 *
 * SEPARATE FROM `retitleDraft`, which writes `scope`, the title. Before 391 both
 * acts wrote the same column: App.tsx wired the description editor AND the header
 * rename to one `saveScope`, so renaming an extra overwrote the scope of work and
 * editing the scope of work renamed it. One of those silently destroyed the other.
 *
 * SEEDS FROM THE SUMMARY, ONCE. When the field still holds the birth value (a copy
 * of the title) and the pipeline has produced a summary, the summary is the better
 * starting text and there is nothing of the contractor's to lose. After he has
 * touched it, nothing overwrites it — `seedOnly` is how the caller says "only if he
 * has not written his own", and mandate #2 is why: a model may draft, but the text a
 * client signs is only ever there because a human left it there and then confirmed
 * the send.
 *
 * DRAFT-ONLY, same as the title and the summary: once sent, the instrument is frozen
 * and the scope the client read must not move underneath them.
 */
export async function saveScopeOfWork(
  db: AbstractPowerSyncDatabase, changeOrderId: string, text: string,
  opts?: { seedOnly?: boolean }
): Promise<boolean> {
  const t = text.trim();
  if (!t) return false;
  const sql = opts?.seedOnly
    // "Untouched" = still equal to the title it was born as, or empty. Anything else
    // is the contractor's and is not seed material.
    ? `UPDATE change_order SET scope_of_work = ?
        WHERE id = ? AND status = 'draft'
          AND (scope_of_work IS NULL OR trim(scope_of_work) = '' OR scope_of_work = scope)`
    : `UPDATE change_order SET scope_of_work = ? WHERE id = ? AND status = 'draft'`;
  const r = await db.execute(sql, [t.slice(0, SCOPE_OF_WORK_MAX_CHARS), changeOrderId]);
  if (!r.rowsAffected) return false;
  await refreshQueuedScope(db, changeOrderId, t.slice(0, SCOPE_OF_WORK_MAX_CHARS));
  return true;
}

/**
 * Keep the still-queued create payload in step with the edit.
 *
 * The outbox holds ONE insert per extra and the server applies it once, so an edit
 * made before the drain has to land IN that payload or the server's only sight of
 * this extra is the pre-edit text. `priceDraftExtra` already does this for the
 * money; the scope of work needs it for the same reason and more urgently, because
 * this is the string the client signs.
 */
async function refreshQueuedScope(
  db: AbstractPowerSyncDatabase, changeOrderId: string, scopeOfWork: string
): Promise<void> {
  const q = await db.getAll<{ mutation_id: string; payload_json: string }>(
    `SELECT mutation_id, payload_json FROM change_order_outbox WHERE change_order_id = ?`,
    [changeOrderId]);
  if (!q.length) return;                       // already drained; nothing queued to fix
  let p: any = null;
  try { p = JSON.parse(q[0].payload_json); } catch { return; }  // corrupt: the drain parks it
  const json = JSON.stringify({ ...p, scope_of_work: scopeOfWork });
  await db.execute(
    `UPDATE change_order_outbox SET payload_json = ?, payload_sha256 = ? WHERE mutation_id = ?`,
    [json, sha256(json), q[0].mutation_id]);
}

/**
 * The cap on the scope of work. Far larger than SCOPE_MAX_CHARS (the title) because
 * this one IS the document body: the worked fireplace example runs to 2,651
 * characters and is not unusual for a job with steps, assumptions and exclusions.
 * Passed to the editor as `maxChars` so the counter and the storage cannot drift —
 * the exact failure SCOPE_MAX_CHARS was widened to fix.
 */
export const SCOPE_OF_WORK_MAX_CHARS = 8000;

export async function setDraftSummary(
  db: AbstractPowerSyncDatabase, changeOrderId: string, summary: string
): Promise<boolean> {
  const s = summary.trim();
  if (!s) return false;
  const r = await db.execute(
    `UPDATE change_order SET summary = ? WHERE id = ? AND status = 'draft'`,
    [s.slice(0, 4000), changeOrderId]
  );
  return !!r.rowsAffected;
}
