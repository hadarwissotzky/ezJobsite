/**
 * WHO YOU SEND TO DECIDES WHAT HAPPENS TO THE EXTRA.
 *
 * hadar, 2026-08-14: "the difference between a client and a member is that if sent just
 * to a member it is kept as a DRAFT and continues to go through the review process,
 * while if the client is involved then it gets into a NEGOTIATION stage."
 *
 * That sentence is the whole rule, and it is a lifecycle rule — which is why it lives
 * here as a pure function with tests rather than as an `if` inside a button handler.
 * `SPEC-extra-lifecycle-v1` owns the status vocabulary; this decides which of its
 * existing transitions a given selection triggers, and it must never be able to invent
 * a third one.
 *
 * The two acts are genuinely different, not two flavours of "send":
 *   · A CLIENT gets a signing instrument. `confirmation_request`, a token, a frozen
 *     `shown_content`, and the draft → sent transition. Irreversible in the sense that
 *     matters: somebody outside the company can now agree to a price.
 *   · A TEAMMATE gets a NOTIFICATION. No token, no instrument, no status change. They
 *     open the same draft and keep working on it. `request_extra_review` (407) is
 *     deliberately incapable of touching `change_order`.
 *
 * Both at once is legal and means both things happen — send it to the client and tell
 * your foreman you did.
 */

export type SendSelection = {
  /** The one person who signs. Null = nobody chosen yet. */
  clientId: string | null;
  /** Company members to notify. Order is the caller's; duplicates are the caller's bug. */
  memberIds: readonly string[];
};

export type SendPlan =
  /** Nothing selected — the send control must be refused, with a reason. */
  | { kind: 'nothing' }
  /** Teammates only. The extra STAYS A DRAFT. */
  | { kind: 'review'; memberIds: readonly string[] }
  /** A client, and possibly teammates told about it. Draft → sent. */
  | { kind: 'approval'; clientId: string; memberIds: readonly string[] };

export function sendPlan(sel: SendSelection): SendPlan {
  const members = sel.memberIds.filter((m) => !!m);
  if (sel.clientId) return { kind: 'approval', clientId: sel.clientId, memberIds: members };
  if (members.length) return { kind: 'review', memberIds: members };
  return { kind: 'nothing' };
}

/** Does this selection move the extra out of draft? The single question the send sheet
 *  asks in order to word its own button honestly. */
export function movesToNegotiation(sel: SendSelection): boolean {
  return sendPlan(sel).kind === 'approval';
}

/**
 * Add or remove a member from the selection.
 *
 * Toggling is separated out because the sheet does it on every tap and a set-like
 * operation written inline three times is three chances to leave a duplicate in — and
 * a duplicated id means one person receiving the same notification twice.
 */
export function toggleMember(sel: SendSelection, id: string): SendSelection {
  const has = sel.memberIds.includes(id);
  return {
    ...sel,
    memberIds: has ? sel.memberIds.filter((m) => m !== id) : [...sel.memberIds, id],
  };
}

/**
 * Choose the client, or clear the choice by tapping the chosen one again.
 *
 * EXACTLY ONE, always. Not because a list could not hold two, but because only one
 * person may sign (D4): a second "client" would be a second signature on one
 * instrument, and the record has no way to say which of them agreed to the price.
 */
export function chooseClient(sel: SendSelection, id: string): SendSelection {
  return { ...sel, clientId: sel.clientId === id ? null : id };
}
