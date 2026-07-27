/**
 * Billing seam — the interface the paywall calls, kept SEPARATE from the store SDK so
 * the app compiles and ships whether or not RevenueCat is keyed (hadar 2026-07-26,
 * DEC-11; implemented 2026-07-27).
 *
 * WHO IS THE AUTHORITY ON "IS PAID": not this file. A purchase here is a *request*;
 * the entitlement that counts is written server-side onto `company.plan` by the
 * RevenueCat webhook, and quota.ts reads only that. `purchasePlan` returns a PlanId
 * purely so the UI can stop showing a spinner — never persist it as the truth, or a
 * jailbroken client becomes its own billing authority.
 *
 * IDENTITY: the RevenueCat `appUserID` is the COMPANY id, not the user id. Only the
 * owner pays and the entitlement covers the whole company (plans.ts: crew are free),
 * so the subscription must survive the owner changing device or the crew changing.
 * The webhook maps `app_user_id` straight back to `company.id`.
 *
 * DEGRADES QUIETLY: with no key configured, `billingStatus()` stays 'not_configured'
 * and the paywall keeps its "coming soon / contact us" state rather than showing a
 * buy button that cannot charge.
 */
import { Platform } from 'react-native';
import Purchases, { type CustomerInfo } from 'react-native-purchases';
import { PLANS, type PlanId } from './plans';

export type BillingStatus = 'not_configured' | 'ready';

/** Public SDK keys are publishable by design (they identify the app, not the account). */
const KEY = (Platform.OS === 'ios'
  ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
  : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY) ?? '';

let configured = false;

/**
 * Whether real purchases can be made. False until the SDK is both keyed AND
 * configured, so the paywall never renders a dead buy button.
 */
export function billingStatus(): BillingStatus {
  return configured && KEY ? 'ready' : 'not_configured';
}

/**
 * Start the SDK for a company. Safe to call repeatedly and safe to call with no key
 * (it no-ops, leaving billing 'not_configured'). Call again when the company changes
 * — logIn re-aliases the receipt to the new company.
 */
export async function configureBilling(companyId: string | null): Promise<void> {
  if (!KEY) return;
  try {
    if (!configured) {
      Purchases.configure({ apiKey: KEY, appUserID: companyId ?? undefined });
      configured = true;
    } else if (companyId) {
      await Purchases.logIn(companyId);
    }
  } catch {
    // A billing SDK that fails to start must never block capture (mandate #1).
    configured = false;
  }
}

/** Entitlement id -> PlanId. Entitlements are named for the tier they unlock. */
function planFromCustomerInfo(info: CustomerInfo): PlanId {
  const active = Object.keys(info?.entitlements?.active ?? {});
  // Highest tier wins if both are somehow active.
  if (active.includes('crew')) return 'crew';
  if (active.includes('core')) return 'core';
  return 'free';
}

export type PurchaseResult =
  | { ok: true; plan: PlanId }
  | { ok: false; reason: 'not_configured' | 'cancelled' | 'failed'; detail?: string };

/** True when the id is one this build knows how to sell. */
function knownProduct(productId: string): boolean {
  return Object.values(PLANS).some(
    (p) => p.productIdMonthly === productId || p.productIdAnnual === productId);
}

/** Buy an auto-renewable subscription by its store product id. */
export async function purchasePlan(productId: string): Promise<PurchaseResult> {
  if (billingStatus() !== 'ready') return { ok: false, reason: 'not_configured' };
  if (!knownProduct(productId)) {
    return { ok: false, reason: 'failed', detail: `unknown product ${productId}` };
  }
  try {
    const products = await Purchases.getProducts([productId]);
    const product = products.find((p) => p.identifier === productId);
    // Not a crash: a product missing from the store is a config problem (not yet
    // "Ready to Submit" in App Store Connect), and the user should be told plainly.
    if (!product) return { ok: false, reason: 'failed', detail: 'product_unavailable' };
    const { customerInfo } = await Purchases.purchaseStoreProduct(product);
    return { ok: true, plan: planFromCustomerInfo(customerInfo) };
  } catch (e: any) {
    if (e?.userCancelled) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'failed', detail: String(e?.message ?? e) };
  }
}

/**
 * App Store REQUIREMENT (guideline 3.1.1) — an app selling a subscription must offer
 * a restore path, or it is rejected. Reachable from the paywall regardless of state.
 */
export async function restorePurchases(): Promise<PurchaseResult> {
  if (billingStatus() !== 'ready') return { ok: false, reason: 'not_configured' };
  try {
    const info = await Purchases.restorePurchases();
    return { ok: true, plan: planFromCustomerInfo(info) };
  } catch (e: any) {
    if (e?.userCancelled) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'failed', detail: String(e?.message ?? e) };
  }
}
