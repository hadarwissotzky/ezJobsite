/**
 * R8 / R5b push — the decisions. `notifystore.ts` holds the device I/O.
 *
 * THE PREMISE THIS FILE CORRECTS: the PRD (and my own status table) said push
 * "needs a provider and a scheduler." It does not. Both notifications the PRD
 * names fire on the contractor's OWN handset in response to rows the app just
 * pulled: a client question (R5b AC1) and the green light (R8). A local
 * notification delivers both with no provider, no device token and no server.
 * Measured on device: scheduleNotificationAsync returned an id with the app
 * signed out of everything.
 *
 * What is still genuinely missing is narrower and worth stating precisely:
 *   - app FULLY KILLED, no tick running -> nothing pulls, so nothing fires.
 *     Remote push is the only fix and that does need a provider.
 *   - the 24h reminder CADENCE (R8) -- a local trigger can carry a delay, but
 *     re-arming it after "they replied" needs the app awake to cancel it.
 *
 * Split pure/impure the same way activity.ts and activitystore.ts are: the
 * wording and the never-lose rule below are testable without a simulator.
 */
import { notificationFor, threadLink, truncate,
         type ThreadNotification } from './discussion.ts';

export type PendingQuestion = {
  id: string; changeOrderId: string; scope: string; body: string;
};
export type PendingApproval = {
  id: string; scope: string; amount: string; signedBy: string | null;
};

export type NotifyPlan = {
  /** In presentation order. */
  present: ThreadNotification[];
  /**
   * Stamped ONLY after each item is actually presented. See `blocked`: when we
   * cannot present, these are EMPTY, so the question stays pending and fires
   * once permission is granted rather than being silently consumed.
   */
  ids: { questions: string[]; approvals: string[] };
  blocked: null | 'permission';
};

/**
 * The green light (R8). Unlike the question push, this one DOES carry the
 * figure, because the PRD names it and because the number is no longer loose:
 * a signature just bound it to the frozen snapshot. Mandate #6 guards numbers
 * seen APART from their instrument; this one is reporting that the instrument
 * closed.
 */
export function approvalNotificationFor(o: {
  changeOrderId: string; scope: string; amount: string; signedBy: string | null;
}): ThreadNotification {
  return {
    title: { k: 'r8.pushApproved', p: { scope: truncate(o.scope, 40) } },
    body: o.signedBy ? `${o.amount} — ${o.signedBy}` : o.amount,
    // Same destination as the bell row: R8's AC says the tap lands on the
    // item's record, and that is the screen the thread overlay opens onto.
    link: threadLink(o.changeOrderId, false),
  };
}

/**
 * Decide what to show and what may be marked as shown.
 *
 * Questions first: a question is someone waiting on you, an approval is news.
 * That is the same ranking `activity.ts` applies to the bell, and the two
 * surfaces disagreeing about what is urgent would be its own bug.
 */
export function planNotifications(o: {
  permission: string;
  questions: readonly PendingQuestion[];
  approvals: readonly PendingApproval[];
}): NotifyPlan {
  const empty = { questions: [] as string[], approvals: [] as string[] };
  // iOS accepts a schedule while undetermined and then shows nothing. Treating
  // that as delivered is how a question disappears without anyone reading it.
  if (o.permission !== 'granted') {
    return { present: [], ids: empty, blocked: 'permission' };
  }
  return {
    present: [
      ...o.questions.map((q) => notificationFor({
        changeOrderId: q.changeOrderId, scope: q.scope, question: q.body })),
      ...o.approvals.map((a) => approvalNotificationFor({ ...a, changeOrderId: a.id })),
    ],
    ids: {
      questions: o.questions.map((q) => q.id),
      approvals: o.approvals.map((a) => a.id),
    },
    blocked: null,
  };
}

/**
 * WHICH PUSH LANDS ON THE CONVERSATION, and which lands on the record.
 *
 * hadar, 2026-08-25: "when i click on a notification that is a new message, not only it
 * should take me to the CO but it should open the message tab".
 *
 * Every push carries a `kind`, and 414's own comment calls it "what the tap handler
 * routes on" — but the handler only ever read `changeOrderId`, so all four kinds landed
 * identically on the record and a client's question, the entire reason the phone buzzed,
 * sat one tap away behind a sheet.
 *
 * A LIST, NOT A NEGATION. Written as `kind === 'question'` this would be one string
 * comparison; written as `kind !== 'opened'` it would silently pull in every kind added
 * later. Naming the ones that ARE conversation means a new kind defaults to the record,
 * which is the safe direction: landing on the record when a message was meant costs a
 * tap, landing on a sheet when there is nothing to read is a dead end.
 *
 * The other three are ABOUT the record and belong on it: 'opened' (the client viewed
 * it), 'reminder_failed' (a text did not go), 'review_request'.
 */
const CONVERSATION_KINDS: readonly string[] = ['question'];

export function opensConversation(kind: unknown): boolean {
  return typeof kind === 'string' && CONVERSATION_KINDS.includes(kind);
}
