/**
 * Billing seam — the interface the paywall calls, kept SEPARATE from the store SDK so
 * the app compiles and ships before RevenueCat is wired (hadar 2026-07-26, DEC-11).
 *
 * Today every purchase path is a STUB that reports 'not_configured'; the tier data is
 * read from plans.ts so the paywall renders fully. When `react-native-purchases` +
 * App Store Connect products + a RevenueCat key land, implement `purchasePlan` /
 * `restorePurchases` against RevenueCat and flip `billingStatus()` to 'ready' — the
 * paywall UI and the entitlement reads do NOT change, because the actual plan is
 * written server-side onto `company.plan` by the RevenueCat webhook, which quota.ts
 * already reads (a client is never the authority on "is paid").
 */
import type { PlanId } from './plans';

export type BillingStatus = 'not_configured' | 'ready';

/**
 * Whether real purchases can be made. Stays 'not_configured' until the store SDK is
 * installed and keyed; the paywall shows a "coming soon / contact us" state instead of
 * a dead buy button while this is false.
 */
export function billingStatus(): BillingStatus {
  return 'not_configured';
}

export type PurchaseResult =
  | { ok: true; plan: PlanId }
  | { ok: false; reason: 'not_configured' | 'cancelled' | 'failed'; detail?: string };

/** Buy an auto-renewable subscription by its store product id. Stub until RC is wired. */
export async function purchasePlan(productId: string): Promise<PurchaseResult> {
  void productId;
  return { ok: false, reason: 'not_configured' };
}

/** App Store requirement — restore an existing subscription. Stub until RC is wired. */
export async function restorePurchases(): Promise<PurchaseResult> {
  return { ok: false, reason: 'not_configured' };
}
