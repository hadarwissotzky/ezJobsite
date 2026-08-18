/**
 * MAY THIS CHANGE ORDER GO OUT, AND IF NOT, WHAT HAPPENS TO IT.
 *
 * hadar, 2026-08-17: "queue it — but needs to prompt the user letting them know that
 * they cannot send if they don't have credits."
 *
 * That sentence has two halves and both are load-bearing:
 *
 *   QUEUE IT.  A contractor at zero balance, standing in a kitchen, must not be told
 *   "no". The work is already captured and the client is already waiting; refusing here
 *   is how the product loses the change order it exists to save. The send is held and
 *   goes on its own the moment a credit exists.
 *
 *   TELL HIM.  A queue nobody is told about is worse than a refusal, because he walks
 *   away believing the client has it. This is mandate #1's rule about capture applied to
 *   sending: never acknowledge something that has not happened. So `queued` is a LOUD
 *   state — it carries the reason and what un-blocks it, and the caller is expected to
 *   put that in front of him rather than in a log.
 *
 * ─── WHY THIS IS NOT IN quota.ts ────────────────────────────────────────────────
 * `quota.ts` answers "is this account over a plan limit", and every answer it gives is
 * ok-or-refused. This adds a third outcome that is neither — held, legal, and going to
 * happen later — and folding a third state into those five `check*` functions would
 * make every existing caller handle a case it has no opinion about.
 *
 * ─── WHAT IT IS NOT ─────────────────────────────────────────────────────────────
 * It does not spend, reserve, or read a balance from the client. The BALANCE IS
 * REVENUECAT'S and the reservation is the server's; this decides only what the UI does
 * at the moment of the tap, from facts the caller already has. A client that could
 * decide it had credits would be a client that could grant itself credits.
 */

export type SendDecision =
  /** Send now. */
  | { kind: 'send' }
  /**
   * Held until a credit exists. Legal, expected, and NOT an error — but it must be said
   * out loud, with the thing that fixes it.
   */
  | { kind: 'queued'; reasonKey: 'gate.queuedNoCredits'; fixKey: 'gate.fixBuyCredits' }
  /**
   * Refused, and no queue would help — the account is over a plan limit that buying
   * credits does not lift. `quota.ts` owns these reasons.
   */
  | { kind: 'refused'; reasonKey: string };

export type SendFacts = {
  /**
   * Does this account's plan meter sends at all? `false` for an unlimited subscription,
   * which is what Core and Crew are (hadar, 2026-08-17: keep unlimited, fix the cost).
   * An unmetered plan never queues and never consults a balance.
   */
  metered: boolean;
  /**
   * Signed change orders still available: free allowance remaining plus purchased
   * credits, minus reservations already open. Server-computed. Ignored when `metered`
   * is false.
   */
  available: number;
  /**
   * A plan-limit refusal from `checkSendQuota`, if one applies. Photos, recording
   * minutes and the free change-order cap all land here. Takes precedence: buying
   * credits does not lift a photo cap, so offering to sell one would be a lie.
   */
  quotaRefusalKey?: string | null;
};

export function decideSend(f: SendFacts): SendDecision {
  // FIRST, because it is the outcome buying cannot fix. Leading with "buy credits" over
  // a photo-cap refusal sells someone a thing that will not unblock them.
  if (f.quotaRefusalKey) return { kind: 'refused', reasonKey: f.quotaRefusalKey };

  // An unlimited plan does not consult a balance. Not an optimisation — a subscriber
  // whose balance read failed must never be queued behind a number that does not apply
  // to him.
  if (!f.metered) return { kind: 'send' };

  if (f.available > 0) return { kind: 'send' };

  return {
    kind: 'queued',
    reasonKey: 'gate.queuedNoCredits',
    fixKey: 'gate.fixBuyCredits',
  };
}

/**
 * How many are waiting on credits, for the line that tells him so.
 *
 * Separate from the decision because it is a DIFFERENT question — "can this one go"
 * versus "how much is stacked up" — and because the second only matters once the first
 * has said no at least once.
 */
export function queuedSummaryKey(n: number): { k: string; p: Record<string, string> } {
  return n === 1
    ? { k: 'gate.queuedOne', p: {} }
    : { k: 'gate.queuedN', p: { n: String(n) } };
}
