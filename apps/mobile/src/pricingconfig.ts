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

export type PackId = 'credits_5' | 'credits_20' | 'credits_50';

export type Pack = {
  id: PackId;
  /** Signed change orders this purchase grants. */
  credits: number;
  /** Cents. The real price — external-link purchases carry no Apple commission today. */
  web: number;
  /** Cents. Higher on purpose: it pays Apple's cut, and a cheaper IAP would make the
   *  rail we do not want the rail everyone uses. */
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
    { id: 'credits_5',  credits:  5, web:  2500, iap:  3299 },
    { id: 'credits_20', credits: 20, web:  7900, iap: 10299 },
    { id: 'credits_50', credits: 50, web: 14900, iap: 19499 },
  ],
  subs: [
    { id: 'core', monthly: 2400, annual: 22900, seats: 3,    creditsPerMonth: null },
    { id: 'crew', monthly: 5900, annual: 58900, seats: null, creditsPerMonth: null },
  ],
  linkoutEnabled: true,
  iapEnabled: true,
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
  const packs: Pack[] = (['credits_5', 'credits_20', 'credits_50'] as PackId[])
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
  if (c.linkoutEnabled && c.iapEnabled) return 'both';
  if (c.linkoutEnabled) return 'web';
  if (c.iapEnabled) return 'iap';
  return 'none';
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
