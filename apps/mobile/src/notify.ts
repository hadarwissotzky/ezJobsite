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
