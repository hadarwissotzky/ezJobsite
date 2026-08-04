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

export type PlanId = 'free' | 'core' | 'crew';

export type PlanLimits = {
  /** Active projects (jobs). Infinity = unlimited. Free horizontal cap. */
  jobs: number;
  /** Extras/decisions per project. Infinity = unlimited. Free vertical cap. */
  decisionsPerJob: number;
  /** Company members, OWNER INCLUDED. Free is 1 (owner only, no crew); paid tiers are
   *  unlimited. The invite flow reads this via checkMembers — changing the number is
   *  the whole mechanism, there is no separate seat code. */
  members: number;
  /** SMS binding-signature allowance per month. 0 = typed-name confirm only. */
  smsSignatures: number;
  /** Change orders in TOTAL, not per job (hadar 2026-08-04). Infinity = unlimited. */
  changeOrders: number;
  /** Photos in TOTAL across every job. Infinity = unlimited. */
  photos: number;
  /** Minutes of recorded audio in TOTAL. Infinity = unlimited. */
  recordingMinutes: number;
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
    // hadar 2026-08-04: "2 change orders, 30 images (total) and 30 (min) total
    // recording — once you have gone past that limit prompt the user to subscribe".
    limits: {
      jobs: 2, decisionsPerJob: 15, smsSignatures: 0,
      // 1 = the owner and nobody else (hadar 2026-08-04: "limited to only 1 team
      // member per company"). memberCount counts the owner, so this blocks the first
      // invite rather than the second.
      members: 1,
      changeOrders: 2, photos: 30, recordingMinutes: 30,
    },
  },
  core: {
    id: 'core', name: 'Core', priceMonthly: 24, priceAnnualMonthly: 19,
    productIdMonthly: 'ezco_core_monthly', productIdAnnual: 'ezco_core_annual',
    limits: {
      jobs: UNLIMITED, decisionsPerJob: UNLIMITED,
      // Owner + 2 (hadar 2026-08-04: "the first paid is up to a team of 3"). The owner
      // counts, so 3 total seats — the 4th person is refused and prompted to upgrade.
      members: 3,
      smsSignatures: 50,
      // Everything the free tier meters is unmetered here: that IS the upgrade.
      changeOrders: UNLIMITED, photos: UNLIMITED, recordingMinutes: UNLIMITED,
    },
  },
  crew: {
    id: 'crew', name: 'Crew', priceMonthly: 59, priceAnnualMonthly: 49,
    productIdMonthly: 'ezco_crew_monthly', productIdAnnual: 'ezco_crew_annual',
    limits: {
      jobs: UNLIMITED, decisionsPerJob: UNLIMITED, members: UNLIMITED,
      smsSignatures: 200,
      changeOrders: UNLIMITED, photos: UNLIMITED, recordingMinutes: UNLIMITED,
    },
  },
};

/** The tiers shown on the paywall, in order. Enterprise is "contact us", not IAP. */
export const PAID_TIERS: PlanId[] = ['core', 'crew'];

export function asPlanId(plan: string | null | undefined): PlanId {
  return plan === 'core' || plan === 'crew' ? plan : 'free';
}

/** The limits for a plan; unknown/null → Free. */
export function planLimits(plan: string | null | undefined): PlanLimits {
  return PLANS[asPlanId(plan)].limits;
}

/** True for any paying tier (caps lift). */
export function isPaid(plan: string | null | undefined): boolean {
  return asPlanId(plan) !== 'free';
}
