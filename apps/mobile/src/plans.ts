/**
 * Subscription tiers — the entitlement model (hadar 2026-07-26, DEC-11: payments are
 * now in scope, superseding CLAUDE.md §5 for subscriptions). Values come from
 * docs/PRICING-STRATEGY.md.
 *
 * CREW PRICING (hadar 2026-07-26): field crew + homeowners are free RIGHT NOW (the
 * growth loop — only the owner pays, Free is metered by projects × decisions), which
 * retires the earlier hard 2-member cap. BUT "field crew may not be free moving
 * forward" (hadar) — so `members` stays a per-tier KNOB, set to unlimited today and
 * changeable to a number later WITHOUT rearchitecting: quota.ts reads
 * planLimits(plan).members, so a future paid-seat model is a data + webhook change,
 * not new code.
 *
 * `planLimits(plan)` is the seam quota.ts reads instead of a hardcoded FREE_LIMITS.
 * The actual paid entitlement is written server-side by the store webhook (RevenueCat)
 * onto `company.plan` — the client only READS it (a client can't be the authority on
 * "is paid"). Until billing is wired, everyone reads as 'free'.
 */

export type PlanId = 'free' | 'core' | 'crew' | 'enterprise';

export type PlanLimits = {
  /** Active projects (jobs). Infinity = unlimited. Free horizontal cap. */
  jobs: number;
  /** Extras/decisions per project. Infinity = unlimited. Free vertical cap. */
  decisionsPerJob: number;
  /** Company members (owner + crew). Infinity today (crew free). A per-tier KNOB:
   *  set a number to charge for seats later — the gate code already reads this. */
  members: number;
  /** SMS binding-signature allowance per month. 0 = typed-name confirm only. */
  smsSignatures: number;
};

export type Plan = {
  id: PlanId;
  /** Display name (rendered via i18n key `plan.<id>` at the UI; kept here for logs). */
  name: string;
  /** USD. null = free or custom. */
  priceMonthly: number | null;
  /** USD/mo billed annually (the headline price). null = free or custom. */
  priceAnnualMonthly: number | null;
  /** App Store / RevenueCat product identifiers. null where there is nothing to buy. */
  productIdMonthly: string | null;
  productIdAnnual: string | null;
  limits: PlanLimits;
};

const UNLIMITED = Infinity;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free', name: 'Free', priceMonthly: 0, priceAnnualMonthly: 0,
    productIdMonthly: null, productIdAnnual: null,
    limits: { jobs: 2, decisionsPerJob: 15, members: UNLIMITED, smsSignatures: 0 },
  },
  core: {
    id: 'core', name: 'Core', priceMonthly: 24, priceAnnualMonthly: 19,
    productIdMonthly: 'ezco_core_monthly', productIdAnnual: 'ezco_core_annual',
    limits: { jobs: UNLIMITED, decisionsPerJob: UNLIMITED, members: UNLIMITED, smsSignatures: 50 },
  },
  crew: {
    id: 'crew', name: 'Crew', priceMonthly: 59, priceAnnualMonthly: 49,
    productIdMonthly: 'ezco_crew_monthly', productIdAnnual: 'ezco_crew_annual',
    limits: { jobs: UNLIMITED, decisionsPerJob: UNLIMITED, members: UNLIMITED, smsSignatures: 200 },
  },
  enterprise: {
    id: 'enterprise', name: 'Enterprise', priceMonthly: null, priceAnnualMonthly: null,
    productIdMonthly: null, productIdAnnual: null,
    limits: { jobs: UNLIMITED, decisionsPerJob: UNLIMITED, members: UNLIMITED, smsSignatures: UNLIMITED },
  },
};

/** The tiers shown on the paywall, in order. Enterprise is "contact us", not IAP. */
export const PAID_TIERS: PlanId[] = ['core', 'crew'];

export function asPlanId(plan: string | null | undefined): PlanId {
  return plan === 'core' || plan === 'crew' || plan === 'enterprise' ? plan : 'free';
}

/** The limits for a plan; unknown/null → Free. */
export function planLimits(plan: string | null | undefined): PlanLimits {
  return PLANS[asPlanId(plan)].limits;
}

/** True for any paying tier (caps lift). */
export function isPaid(plan: string | null | undefined): boolean {
  return asPlanId(plan) !== 'free';
}
