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
const RAW_KEY = (Platform.OS === 'ios'
  ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
  : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY) ?? '';

/**
 * A RevenueCat TEST STORE key (`test_…`) CRASHES A RELEASE BUILD. Not "fails to
 * configure" — the SDK calls a Swift assertion inside
 * `Configuration.APIKeyValidationResult.checkForSimulatedStoreAPIKey`, which is
 * EXC_BREAKPOINT/SIGTRAP: the process dies on launch, before any JS error handler
 * exists to report it.
 *
 * HOW WE LEARNED THIS (hadar 2026-08-04, from the device crash report). The key had
 * silently been empty in every bundle because Metro cached billing.ts's transform from
 * before the key existed. Fixing that cache made the key REAL for the first time — and
 * the app immediately crashed on launch for every user of that bundle. OTA could not
 * undo it either, since every subsequent publish carried the same key.
 *
 * So the key is filtered HERE rather than trusted from the environment: a test key is
 * accepted only in a debug build, where the Test Store is legitimate and useful for
 * exercising the purchase flow without App Store Connect. In release it is discarded,
 * `billingStatus()` stays 'not_configured', and the paywall keeps its honest
 * "coming soon" state — which is exactly what it should say, because a release build
 * with no real store key genuinely cannot sell anything.
 */
const IS_TEST_KEY = RAW_KEY.startsWith('test_');
const KEY = IS_TEST_KEY && !__DEV__ ? '' : RAW_KEY;

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
  | { ok: false; reason: 'not_configured' | 'no_tenant' | 'cancelled' | 'failed'; detail?: string };

/** True when the id is one this build knows how to sell. */
/** The credit packs sold on the App Store rail. Same identifiers the web/Stripe rail
 *  uses, so one RevenueCat virtual-currency grant serves both. */
const PACK_PRODUCTS = new Set(['credits_3', 'credits_20', 'credits_50']);

function knownProduct(productId: string): boolean {
  if (PACK_PRODUCTS.has(productId)) return true;
  return Object.values(PLANS).some(
    (p) => p.productIdMonthly === productId || p.productIdAnnual === productId);
}

/**
 * Buy an auto-renewable subscription by its store product id.
 *
 * REFUSES WHILE THE CUSTOMER IS ANONYMOUS (2026-08-13). `configureBilling` is called
 * with the tenant id; if the account has none, RevenueCat assigns `$RCAnonymousID:…`
 * and the purchase attaches to a customer the webhook can never map back to a company
 * row. The store completes, money is authorised, and the plan lands nowhere — the
 * failure hadar hit. Selling in that state is the one thing this function must not do,
 * so it fails BEFORE the store sheet rather than after the charge.
 */
export async function purchasePlan(productId: string): Promise<PurchaseResult> {
  if (billingStatus() !== 'ready') return { ok: false, reason: 'not_configured' };
  try {
    const uid = await Purchases.getAppUserID();
    if (__DEV__) (globalThis as any).__rcUser = uid;
    if (!uid || uid.startsWith('$RCAnonymousID')) {
      return { ok: false, reason: 'no_tenant' };
    }
  } catch { /* cannot tell -> fall through; a real purchase still beats a false refusal */ }
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
 * BUY A CREDIT PACK — a consumable, not a subscription.
 *
 * Deliberately a SEPARATE function from `purchasePlan`, though the store call is the
 * same, because the two differ in what success MEANS and a shared return type would
 * hide that:
 *
 *   A subscription grants an ENTITLEMENT, readable straight off `customerInfo`. That
 *   is why `purchasePlan` can say "you are on Core now" the moment the sheet closes.
 *
 *   A pack grants VIRTUAL CURRENCY. The balance lives in RevenueCat and reaches this
 *   app through `credits`, so `customerInfo` says nothing useful about it — there is
 *   no entitlement to check, and checking one would report every successful pack
 *   purchase as a failure.
 *
 * So this returns only whether the STORE completed. The balance is read afterwards
 * from the credits function, which is the one authority on it (see that function's
 * header: RevenueCat owns the balance, Postgres owns reservations). Reporting a
 * granted credit from here would be a second source of truth for a number a
 * contractor may one day dispute.
 */
export async function purchaseCredits(
  productId: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_configured' | 'no_tenant' | 'cancelled' | 'failed'; detail?: string }> {
  if (billingStatus() !== 'ready') return { ok: false, reason: 'not_configured' };
  // THE SAME ANONYMOUS REFUSAL as purchasePlan, and for a sharper reason: a pack bought
  // by `$RCAnonymousID:…` credits a customer the webhook cannot map to a company, so the
  // money is taken and the credits land nowhere anybody can spend them.
  try {
    const uid = await Purchases.getAppUserID();
    if (!uid || uid.startsWith('$RCAnonymousID')) return { ok: false, reason: 'no_tenant' };
  } catch { /* cannot tell -> a real purchase beats a false refusal */ }
  if (!PACK_PRODUCTS.has(productId)) {
    return { ok: false, reason: 'failed', detail: `unknown pack ${productId}` };
  }
  try {
    const products = await Purchases.getProducts([productId]);
    const product = products.find((p) => p.identifier === productId);
    // Not yet "Ready to Submit" in App Store Connect is the usual cause, and it is a
    // config problem the buyer should be told about plainly rather than a dead tap.
    if (!product) return { ok: false, reason: 'failed', detail: 'product_unavailable' };
    await Purchases.purchaseStoreProduct(product);
    return { ok: true };
  } catch (e: any) {
    if (e?.userCancelled) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'failed', detail: String(e?.message ?? e) };
  }
}

/**
 * WHICH PRODUCT is active — not just which tier.
 *
 * The paywall's monthly/annual toggle needs this. Knowing only `plan === 'core'` is not
 * enough to render the Core card: with the toggle on Monthly it would print the monthly
 * price above a button reading "Your plan", to somebody paying annually. That is a
 * wrong statement about money, which is the one class of claim this app is least
 * allowed to get wrong (mandate #6).
 *
 * Returns the first active subscription that this build actually sells, so a stale or
 * unrelated product identifier cannot be mistaken for the current plan. Null when
 * billing is not configured or nothing is active.
 */
export async function entitledProductNow(): Promise<string | null> {
  if (billingStatus() !== 'ready') return null;
  try {
    const info = await Purchases.getCustomerInfo();
    const plan = planFromCustomerInfo(info);
    if (plan === 'free') return null;
    // ASK THE ENTITLEMENT WHICH PRODUCT IS GRANTING IT. Anything derived from
    // `activeSubscriptions` is a guess: that list has no defined order and can hold
    // several live products at once. Two wrong answers came out of it on device —
    // first a Crew product while the tier read Core, then Core-monthly while
    // Core-annual was equally active. Both are real production states (a crossgrade
    // leaves the old subscription live until its period ends), and neither is
    // resolvable by picking from a list. `productIdentifier` is the entitlement's own
    // answer to "what am I on", which is the question being asked.
    const ent = info?.entitlements?.active?.[plan];
    const pid = ent?.productIdentifier ?? null;
    return pid && knownProduct(pid) ? pid : null;
  } catch { return null; }
}


/**
 * RevenueCat's CURRENT verdict for this customer, or null when billing is not
 * configured / the read fails. Used at launch so a subscription bought on another
 * device (or before a reinstall) is reflected without waiting on the webhook round
 * trip. Never throws: a billing read must not delay the app.
 */
export async function entitledPlanNow(): Promise<PlanId | null> {
  if (billingStatus() !== 'ready') return null;
  try {
    return planFromCustomerInfo(await Purchases.getCustomerInfo());
  } catch { return null; }
}

/**
 * WHERE TO CHANGE OR CANCEL A SUBSCRIPTION.
 *
 * hadar, 2026-08-13: "I cannot seem to be able to downgrade if I want to, or cancel."
 *
 * AND NO APP CAN DO IT IN-APP ON iOS. Apple owns the subscription: downgrading,
 * upgrading and cancelling all happen in the App Store's own management screen, and an
 * app that tried to cancel a StoreKit subscription itself would simply have no API to
 * call. What an app MUST do — guideline 3.1.2 — is provide the link. Not providing one
 * is a review rejection, and is also just a trap: money keeps leaving somebody's account
 * with no visible way to stop it.
 *
 * `managementURL` is RevenueCat's per-customer link and is the right one when present
 * (it points at the correct store for the receipt — App Store, Play, or web billing).
 * The generic App Store URL is the fallback, which is correct for every iOS receipt.
 */
export async function manageSubscriptionUrl(): Promise<string> {
  const APPLE = 'https://apps.apple.com/account/subscriptions';
  if (billingStatus() !== 'ready') return APPLE;
  try {
    const info = await Purchases.getCustomerInfo();
    return info?.managementURL ?? APPLE;
  } catch { return APPLE; }
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
