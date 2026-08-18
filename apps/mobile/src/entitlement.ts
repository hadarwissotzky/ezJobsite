/**
 * WHICH METER APPLIES TO THIS ACCOUNT — and there must be exactly one.
 *
 * hadar, 2026-08-18, looking at the Plans screen: "how are we to distinguish between the
 * subscription and pay as you go — do we just create another plan?"
 *
 * The answer that made the model work is that PAY AS YOU GO IS NOT A PLAN. A subscription
 * is a STATE you enter; credits are a QUANTITY you buy. Free and pay-as-you-go are the
 * same state — metered by a credit balance — and differ only in whether the balance was
 * granted or purchased. That is why buying a pack raises no upgrade event, why a
 * subscriber who tops up is not downgraded, and why nobody's credits are ever orphaned by
 * a tier change. The whole problem §9 of the payment spec called its hardest simply does
 * not arise.
 *
 * ─── THE BUG THIS EXISTS TO KILL ────────────────────────────────────────────────
 * Before this, two meters counted the same act. `plans.ts` gives the free tier
 * `changeOrders: 2` as a LIFETIME cap enforced in `quota.ts`, and `pricing_config`
 * separately grants a `free_allowance` of 2 enforced by the server's reservation. Both
 * gate sending. So a contractor who bought twenty credits would have been stopped by the
 * local cap and told:
 *
 *     "Your free plan includes 2 sent change orders. Upgrade to send as many as you need."
 *
 * He paid, and the app kept refusing. That is the worst moment a payment system has, and
 * it was one purchase away from happening the moment a pack went on sale.
 *
 * ─── WHY PHOTOS AND MINUTES LIFT TOO ────────────────────────────────────────────
 * Not generosity — the pack is unusable otherwise. The free tier allows 30 photos and 30
 * minutes IN TOTAL, ever. Someone who buys twenty change orders cannot attach photographs
 * to more than a couple of them before a cap set for a trial account stops him. Selling a
 * quantity the buyer cannot spend is a broken product, so paying anything at all retires
 * the trial limits and leaves the credit balance as the only meter.
 *
 * PURE, so the rule can be asserted rather than clicked through.
 */

export type Meter =
  /** Trial. The free allowance, plus the photo and recording caps that go with it. */
  | 'free'
  /** Metered by the credit balance ALONE. Nothing else counts. */
  | 'credits'
  /** A subscription. No balance is ever consulted. */
  | 'unlimited';

export type EntitlementFacts = {
  /** `company.plan` as stored. Anything that is not a known paid tier reads as free. */
  plan: string;
  /**
   * Has this account EVER bought credits?
   *
   * Sticky, and it has to be. `purchased` is a live balance: a contractor who buys twenty
   * and spends all twenty reads as zero, and a rule keyed on the current balance would
   * re-impose a 30-photo trial cap on a customer who has paid us. "Has paid" is a fact
   * about the account's history, not about its balance today.
   */
  purchasedEver: boolean;
};

/** Tiers that do not meter. Anything else — including an unknown string from a webhook
 *  this build has never seen — falls through to a metered reading, which is the safe
 *  direction: it consults a balance rather than granting unlimited sends. */
const UNMETERED = new Set(['core', 'crew']);

export function meterFor(f: EntitlementFacts): Meter {
  if (UNMETERED.has(f.plan)) return 'unlimited';
  return f.purchasedEver ? 'credits' : 'free';
}

/**
 * Do the TRIAL caps (photos, recording minutes) still apply?
 *
 * Only on 'free'. Stated as its own function rather than left as a `=== 'free'` at each
 * call site, because there are three of them and the day a fourth meter appears they must
 * all move together.
 */
export function trialCapsApply(m: Meter): boolean {
  return m === 'free';
}

/**
 * Does the LOCAL lifetime change-order cap still apply?
 *
 * Never. It is here as a named `false` rather than a deleted call site so the reason
 * survives: the sent-change-order count is the server's reservation to make, and it makes
 * it against the credit balance — free allowance included. Two places counting one act is
 * how a paying customer gets refused.
 *
 * The device keeps counting for the USAGE line ("1 of 2 used"), which is a different job:
 * telling someone where they stand costs nothing if it is briefly stale, and refusing them
 * on a stale number costs a customer.
 */
export function localChangeOrderCapApplies(): boolean {
  return false;
}
