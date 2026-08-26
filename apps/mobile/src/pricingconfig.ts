/**
 * PRICES COME FROM THE SERVER, NEVER FROM THIS BINARY.
 *
 * hadar, 2026-08-17: the two goals are a lower entry price and avoiding Apple's cut by
 * selling on the web. Both of those depend on a rail choice that is not stable:
 *
 *   Apple's commission on external-link purchases has been ZERO in the US since April
 *   2025. Apple has proposed 5–15%, the Ninth Circuit set a cost-recovery standard,
 *   Epic has objected, and the Supreme Court hears the appeal in the October 2026 term.
 *
 * A build that hardcodes "buy on the web" is a build that needs an App Store review
 * cycle to react to a court. So the rail, the prices and the differential are one row in
 * `pricing_config`, read at launch, and this module is the only thing that reads it.
 *
 * ─── IT ALWAYS RETURNS SOMETHING ────────────────────────────────────────────────
 * A paywall that renders nothing because the network is down is worse than one showing
 * last week's prices: the contractor concludes the app is broken and does not come back
 * to find out. So the read is cached to `device_settings`, and there is a compiled-in
 * fallback of last resort. Both are clearly marked as stale rather than presented as
 * fresh — `PricingConfig.source` says where the numbers came from, and the paywall is
 * expected to say so when it is not 'server'.
 *
 * ─── WHAT IT IS NOT ─────────────────────────────────────────────────────────────
 * NOT an entitlement source, and not a balance. It says what things COST. Whether this
 * account may send is `quota.ts`; how many credits it holds is RevenueCat's answer and
 * nobody else's. A price list that started deciding permissions would be a client-side
 * authority over money, which sql/382 rules out for exactly the reason it sounds like.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * THE THREE PACKS THE APP SELLS (hadar, 2026-08-26: "i wil do 3 20 and 50").
 *
 * `credits_5` is gone from this list and NOT from RevenueCat — the web/Stripe rail
 * still carries it and removing the product there would break a checkout that works
 * today. It is simply no longer offered in the app.
 *
 * THREE RUNGS, NOT FOUR, and the reason is the reader: CLAUDE.md §1 says the user does
 * not think in software, and four rows of prices on a phone is a decision to make
 * rather than a price to accept.
 */
export type PackId = 'credits_3' | 'credits_20' | 'credits_50';

export type Pack = {
  id: PackId;
  /** Signed change orders this purchase grants. */
  credits: number;
  /** Cents. The web/Stripe rail — external-link purchases carry no Apple commission. */
  web: number;
  /**
   * Cents, on the App Store rail. THE PRICE, not a penalty.
   *
   * This used to be ~32% above `web`, sized to pay a 30% Apple cut, on the reasoning
   * that "a cheaper IAP would make the rail we do not want the rail everyone uses".
   * That reasoning is retired (hadar, 2026-08-26): pay-as-you-go IS the adoption bet,
   * and the App Store is where a contractor actually completes a purchase — two taps
   * and Face ID, standing in a client's kitchen, versus a website and a password.
   *
   * The cut is also 15%, not 30%, under the Small Business Program. So the markup now
   * costs conversion on the rail we want and buys nothing. These are near-parity with
   * `web`, and the difference that remains is the .99 price point, not a surcharge.
   */
  iap: number;
};

export type SubTier = {
  id: 'core' | 'crew';
  monthly: number;
  annual: number;
  /** Included seats; null = unlimited. */
  seats: number | null;
  /**
   * Credits granted per month, or NULL FOR UNLIMITED — and the difference is the whole
   * point of this field. `null` means the tier does not meter; `0` would mean it grants
   * nothing. The send gate has to tell those apart, and a boolean could not.
   */
  creditsPerMonth: number | null;
};

export type PricingConfig = {
  version: number;
  /** Signed change orders a brand-new account gets with no card. */
  freeAllowance: number;
  packs: Pack[];
  subs: SubTier[];
  /** Web purchase offered at all. False = IAP only, which is the switch to throw if the
   *  law moves. */
  linkoutEnabled: boolean;
  iapEnabled: boolean;
  /**
   * The RevenueCat Web Purchase Link token, or null when the web rail has no address.
   *
   * Null DISABLES the web rail in the client whatever `linkoutEnabled` says — a rail
   * with no address is not a rail, and a buy button that goes nowhere costs more trust
   * than a missing one.
   */
  purchaseLinkToken: string | null;
  /** Where these numbers came from. The paywall says so unless it is 'server'. */
  source: 'server' | 'cache' | 'fallback';
};

/**
 * LAST RESORT, AND DELIBERATELY CONSERVATIVE.
 *
 * Used only when the server has never been reached on this device and nothing is
 * cached — a first launch in a basement. It offers BOTH rails, because refusing to show
 * a purchase path at all is the one outcome with no recovery, and it carries the prices
 * that ship in `plans.ts` so a stale build cannot advertise a price no product can
 * charge.
 */
const FALLBACK: Omit<PricingConfig, 'source'> = {
  version: 0,
  freeAllowance: 2,
  packs: [
    // ROUND DOLLARS, and it costs nothing: App Store Connect offers $18 / $79 / $149
    // as price points with IDENTICAL proceeds to $17.99 / $78.99 / $148.99 (checked
    // against the live price-point list, 2026-08-26). `money()` renders a whole dollar
    // as "$18" rather than "$18.00", so the paywall reads as a price instead of a
    // rounding artefact — its own stated rule.
    { id: 'credits_3',  credits:  3, web:  1800, iap:  1800 },
    { id: 'credits_20', credits: 20, web:  7900, iap:  7900 },
    { id: 'credits_50', credits: 50, web: 14900, iap: 14900 },
  ],
  subs: [
    { id: 'core', monthly: 2400, annual: 22900, seats: 3,    creditsPerMonth: null },
    { id: 'crew', monthly: 5900, annual: 58900, seats: null, creditsPerMonth: null },
  ],
  linkoutEnabled: true,
  iapEnabled: true,
  // NO TOKEN IN THE FALLBACK, deliberately. A compiled-in checkout URL is the one value
  // here that must never be stale: a regenerated token sends a paying contractor to a
  // 404. Better no web button on a first launch with no network than a broken one.
  purchaseLinkToken: null,
};

const CACHE_KEY = 'pricing_config_json';

/** Read the live config, cache it, and never return nothing. */
export async function loadPricing(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient
): Promise<PricingConfig> {
  try {
    const { data, error } = await supabase
      .from('pricing_config').select('*').eq('id', 1).maybeSingle();
    if (!error && data) {
      const parsed = parseRow(data as Record<string, unknown>);
      // Cached AFTER parsing, so a row this build cannot understand is never stored as
      // if it could be read later.
      await db.execute(
        `INSERT INTO device_settings (k, v) VALUES (?, ?)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
        [CACHE_KEY, JSON.stringify(parsed)]
      ).catch(() => {});
      return { ...parsed, source: 'server' };
    }
  } catch { /* fall through — offline is the normal case, not an error */ }

  try {
    const row = (await db.getAll<{ v: string }>(
      `SELECT v FROM device_settings WHERE k = ?`, [CACHE_KEY]))[0];
    if (row?.v) return { ...JSON.parse(row.v), source: 'cache' };
  } catch { /* a corrupt cache is not worth a crash on a paywall */ }

  return { ...FALLBACK, source: 'fallback' };
}

function parseRow(r: Record<string, unknown>): Omit<PricingConfig, 'source'> {
  const packsRaw = (r.pack_prices ?? {}) as Record<string, any>;
  const subsRaw = (r.subscription_prices ?? {}) as Record<string, any>;
  const int = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;

  // ORDERED BY WHAT THEY GRANT, not by however Postgres returned the JSON keys. A
  // paywall whose packs reshuffle between launches looks broken to the person reading
  // it, and the cheapest-per-credit option has to be the last one for the ladder to
  // read as a ladder.
  const packs: Pack[] = (['credits_3', 'credits_20', 'credits_50'] as PackId[])
    .filter((id) => packsRaw[id])
    .map((id) => ({
      id,
      credits: int(packsRaw[id].credits, 0),
      web: int(packsRaw[id].web, 0),
      iap: int(packsRaw[id].iap, 0),
    }))
    // A pack that grants nothing or costs nothing is a misconfiguration, and showing it
    // is worse than showing one fewer option.
    .filter((p) => p.credits > 0 && p.web > 0);

  const subs: SubTier[] = (['core', 'crew'] as const)
    .filter((id) => subsRaw[id])
    .map((id) => ({
      id,
      monthly: int(subsRaw[id].monthly, 0),
      annual: int(subsRaw[id].annual, 0),
      seats: typeof subsRaw[id].seats === 'number' ? subsRaw[id].seats : null,
      // Explicitly null-preserving: `int(…, 0)` here would silently turn "unlimited"
      // into "grants zero credits", which the gate would read as a blocked account.
      creditsPerMonth: typeof subsRaw[id].credits_per_month === 'number'
        ? subsRaw[id].credits_per_month : null,
    }));

  return {
    version: int(r.version, 0),
    freeAllowance: int(r.free_allowance, FALLBACK.freeAllowance),
    packs: packs.length ? packs : FALLBACK.packs,
    subs: subs.length ? subs : FALLBACK.subs,
    // Default TRUE on a missing/garbled value: the failure that matters is showing no
    // way to pay, not showing one rail too many.
    linkoutEnabled: r.linkout_enabled !== false,
    iapEnabled: r.iap_enabled !== false,
    purchaseLinkToken: typeof r.purchase_link_token === 'string' && r.purchase_link_token.trim()
      ? r.purchase_link_token.trim() : null,
  };
}

/**
 * Which rail to offer, and it is not always a choice.
 *
 * Both on is the normal state and the caller shows web first with IAP demoted. Neither
 * on is a misconfiguration that must still render something a human can act on — the
 * caller shows "contact us" rather than a dead button, which is the same thing
 * `billingStatus() === 'not_configured'` already does today.
 */
export function railsFor(c: PricingConfig): 'both' | 'web' | 'iap' | 'none' {
  // A web rail needs BOTH the switch and an address. `linkoutEnabled` with no token is a
  // configuration half-done, and the client must not render a button for it.
  const web = c.linkoutEnabled && !!c.purchaseLinkToken;
  if (web && c.iapEnabled) return 'both';
  if (web) return 'web';
  if (c.iapEnabled) return 'iap';
  return 'none';
}

/**
 * The URL that sells credits to THIS company.
 *
 * The app user id is appended because RevenueCat REQUIRES it — a link without one shows
 * the customer a 404 — and because it is what makes the purchase land on the account the
 * app reads. `companyId` is the same value `billing.ts` gives the SDK as `appUserID`.
 *
 * Getting this wrong has already cost money once on this project: a purchase attached to
 * `$RCAnonymousID:…`, the webhook matched nothing, and the money bought nothing
 * (`company.ts:billingTenantId`). A 404 is the better failure — it is at least visible.
 *
 * Null rather than a half-built URL when either half is missing.
 */
export function purchaseUrl(c: PricingConfig, companyId: string | null): string | null {
  if (!c.purchaseLinkToken || !companyId) return null;
  return `https://pay.rev.cat/${c.purchaseLinkToken}/${encodeURIComponent(companyId)}`;
}

/** "$79" / "$2.98" — whole dollars stay whole, because a price ending in .00 on a
 *  paywall reads as a rounding artefact rather than a price. */
export function money(cents: number): string {
  return cents % 100 === 0
    ? `$${(cents / 100).toLocaleString('en-US')}`
    : `$${(cents / 100).toFixed(2)}`;
}

/** What one signed change order costs in this pack — the number that makes a bigger
 *  pack obviously better, and the only per-unit figure worth putting on a paywall. */
export function perCredit(p: Pack): string {
  return money(Math.round(p.web / p.credits));
}
