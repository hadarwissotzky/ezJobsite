/**
 * R6c — the boring half of the decision summary.
 *
 * Every rule lives in `decisionsummary.ts`, which imports nothing and is unit
 * tested. This file only reads rows and hands them over. Same split as
 * approverrouting.ts / approvers.ts, recordpeople.ts / recordactors.ts,
 * eventtimeline.ts / eventlog.ts. If a decision about what the narrative SAYS
 * starts being made here, it has stopped being testable.
 *
 * ─── MANDATE #7 IS THE SHAPE OF THIS FILE ────────────────────────────────────
 * No network call, at all. Not a degraded path — there is no code here that could
 * reach one. R6c: "If the summary cannot be produced (offline, model unavailable),
 * the record renders complete without it." Generating it from local rows means
 * "offline" never arises as a case, and the only remaining failure is a missing
 * table on a device that has not run the DDL yet.
 *
 * ─── AND WHY IT SWALLOWS ITS OWN ERRORS ──────────────────────────────────────
 * `decisionSummaryFor` returns null on ANY failure and never throws. R6c is
 * explicit that the summary is "additive, never a dependency": a record screen
 * that fails to open because a reading aid could not be assembled would have
 * traded the legal artifact for a convenience. Null means the section is omitted;
 * every other section, including the unabridged history, is untouched.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { money } from './changeorder';
import { threadState } from './discussion';
import { threadFor } from './discussionstore';
import { getProfile } from './profile';
import { recordFacts } from './recordactors';
import { ROLE_KEY, type PersonRow } from './recordpeople';
import { decisionSummary, type ActorFact, type DecisionSummary } from './decisionsummary';

/**
 * Pull the per-act contribution out of the People block rather than re-querying
 * `extra_actor`.
 *
 * WHY REUSE recordFacts INSTEAD OF A SECOND QUERY: `recordpeople.pickPerAct`
 * already decided which row wins when there are several — earliest for
 * captured/priced (a second row is a retry, not a second person), latest for sent
 * (a re-send is a real second event). A query here would be a second answer to
 * that question, and the People block and the summary disagreeing about who priced
 * an extra is precisely the kind of contradiction that destroys a record's
 * credibility in the one conversation it exists for.
 */
function actorFor(people: readonly PersonRow[], roleKey: string): ActorFact | null {
  for (const p of people) {
    // Crew only. The client side of the block can never hold these keys, but
    // saying so costs one comparison and stops a future roleKey collision from
    // reporting the homeowner as having priced their own change order.
    if (p.kind !== 'crew') continue;
    for (const c of p.contributions) {
      if (c.roleKey === roleKey && c.atMs !== null) return { name: p.name, atMs: c.atMs };
    }
  }
  return null;
}

/**
 * Who the client side is — named only when the record leaves no doubt.
 *
 * `thread_message` stores a side and a body, never an author, so nothing on this
 * device says who asked a question. The approver the link was addressed to is the
 * only candidate, and it is a SAFE one exactly when the extra only ever went to one
 * person: a re-send to somebody else would otherwise put the second recipient's
 * name on the first recipient's question. So: distinct approver names, and if
 * there is more than one, nobody is named and the clause says "the client".
 *
 * Deliberately rejected: taking the LATEST approver, which is what the People block
 * does. That is right there — the block answers "who is holding this now" — and
 * wrong here, because a narrative clause is a claim about the past.
 */
async function unambiguousClient(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<string | null> {
  const rows = await db.getAll<{ name: string }>(
    `SELECT DISTINCT trim(name) AS name FROM extra_actor
      WHERE subject_kind = 'change_order' AND subject_id = ? AND act = 'approver'`,
    [changeOrderId]);
  const names = rows.map((r) => r.name).filter((n) => n.length > 0);
  return names.length === 1 ? names[0] : null;
}

/**
 * The R6c summary for one extra, from local rows only.
 *
 * `nowMs` is a parameter so the 48h "awaiting your reply" threshold is testable
 * without faking two days of clock — the same reason discussion.ts takes one.
 */
export async function decisionSummaryFor(
  db: AbstractPowerSyncDatabase, changeOrderId: string, nowMs: number = Date.now()
): Promise<DecisionSummary | null> {
  try {
    const co = (await db.getAll<{
      status: string; amount_cents: number | null; signed_by: string | null;
    }>(
      `SELECT status, amount_cents, signed_by FROM change_order WHERE id = ?`,
      [changeOrderId]))[0];
    if (!co) return null;

    const facts = await recordFacts(db, changeOrderId);
    const people = facts?.people ?? [];

    const messages = await threadFor(db, changeOrderId);
    // R5b owns the definition of "you have left somebody waiting", including its
    // documented deviation from the PRD's literal wording. Asked here, decided
    // there, restated by decisionSummary() — never re-derived.
    const state = threadState({ coStatus: co.status, messages, nowMs });

    return decisionSummary({
      status: co.status,
      captured: actorFor(people, ROLE_KEY.captured),
      priced: actorFor(people, ROLE_KEY.priced),
      sent: actorFor(people, ROLE_KEY.sent),
      clientName: await unambiguousClient(db, changeOrderId),
      signedBy: co.signed_by,
      messages,
      unanswered: state.unansweredSinceMs !== null,
      awaitingReply: state.awaitingReply,
      // Mandate #6: formatted from the record's OWN column by the one formatter
      // postgres is kept in step with (240_shown_content_integrity). Never re-read,
      // never re-derived, and never sourced from a transcript.
      amount: co.amount_cents === null ? null : money(co.amount_cents),
      // Read once here so the summary can address the device holder in second
      // person. It never attributes — see SummaryInput.meName.
      meName: (await getProfile(db))?.name ?? null,
    });
  } catch {
    // A device that has not run ensureExtraActorSchema / ensureDiscussionSchema has
    // no table to read. The record still opens; it just has no summary. See the
    // header: additive, never a dependency.
    return null;
  }
}
