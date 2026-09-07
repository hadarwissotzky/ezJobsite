-- 439 — the price row catches up with the packs the app actually sells.
--
-- RENUMBERED FROM 429 (review, 2026-09-03): `429_merge_dev_accounts.sql` already had
-- that number. Two files sharing one number means apply order is decided by how the
-- filename happens to sort, which is exactly what the numbering exists to prevent.
--
-- ─── THE DRIFT ──────────────────────────────────────────────────────────────────
-- 410 seeded `pack_prices` with credits_5 / credits_20 / credits_50, and priced the
-- App Store rail at web × 1.3 so the in-app rail "existed without being the cheap way
-- to buy". Both decisions were retired on the client on 2026-08-26 (hadar: "i wil do
-- 3 20 and 50"; pay-as-you-go IS the adoption bet; the Small Business cut is 15%, so
-- the markup costs conversion and buys nothing):
--
--     apps/mobile/src/pricingconfig.ts   PackId = 'credits_3' | 'credits_20' | 'credits_50'
--     apps/mobile/src/billing.ts         PACK_PRODUCTS = {credits_3, credits_20, credits_50}
--     apps/mobile/src/pricingconfig.test.ts  $18 / $79 / $149, entry rung $6 per credit
--
-- Nothing updated the row. So today, with a live server read, `parseRow()` filters
-- to the ids it knows, finds no `credits_3`, and the paywall shows TWO packs — the
-- $79 and $149 rungs with the $10,299 / $19,499-cent IAP markup still on them. The
-- entry price, which is the whole point of the change, is the one thing missing, and
-- the compiled-in FALLBACK (which does have it) is only reached when the server has
-- never answered. The better the network, the worse the paywall. That is exactly the
-- inversion `pricing_config` exists to prevent, and it is fixed here by one UPDATE.
--
-- ─── WHAT CHANGES ───────────────────────────────────────────────────────────────
-- * credits_3 added at $18; credits_20 and credits_50 keep their web price.
-- * `iap` = `web` on every pack. Round dollars on both rails: App Store Connect
--   offers $18 / $79 / $149 as price points with proceeds identical to the .99
--   variants (checked 2026-08-26, see pricingconfig.ts FALLBACK).
-- * credits_5 leaves THIS ROW only. It is deliberately NOT removed from RevenueCat or
--   the web/Stripe rail — a checkout that works today stays working — it is simply no
--   longer offered in the app, which is what a missing key here means to `parseRow()`.
-- * `iap_multiplier` goes to 1.00 so the column stops describing a policy nobody
--   applies. No reader consumes it; it is kept rather than dropped because 409's
--   comment promises the rail differential lives here, and a court may put it back.
--
-- Same shape as 410: UPDATE, never a column default, because `on conflict do nothing`
-- already bit once. Cents, integers, no floats.

update public.pricing_config set
  version = version + 1,

  pack_prices = jsonb_build_object(
    'credits_3',  jsonb_build_object('credits',  3, 'web',  1800, 'iap',  1800),
    'credits_20', jsonb_build_object('credits', 20, 'web',  7900, 'iap',  7900),
    'credits_50', jsonb_build_object('credits', 50, 'web', 14900, 'iap', 14900)
  ),

  iap_multiplier = 1.00,
  updated_at = now()
where id = 1;

-- Same belt-and-braces as 410: if the row is somehow absent, create it with the
-- current values rather than leave every reader on the compiled-in guess.
insert into public.pricing_config (
  id, version, free_allowance, pack_prices, subscription_prices,
  linkout_enabled, iap_enabled, iap_multiplier, purchase_link_token)
select 1, 4, 2,
  jsonb_build_object(
    'credits_3',  jsonb_build_object('credits',  3, 'web',  1800, 'iap',  1800),
    'credits_20', jsonb_build_object('credits', 20, 'web',  7900, 'iap',  7900),
    'credits_50', jsonb_build_object('credits', 50, 'web', 14900, 'iap', 14900)),
  jsonb_build_object(
    'core', jsonb_build_object('monthly', 2400, 'annual', 22900, 'seats', 3, 'credits_per_month', null),
    'crew', jsonb_build_object('monthly', 5900, 'annual', 58900, 'seats', null, 'credits_per_month', null)),
  true, true, 1.00, 'jzhrqgvkbhkbwqba'
where not exists (select 1 from public.pricing_config where id = 1);

-- Verify after apply:
--   select version, pack_prices, iap_multiplier from public.pricing_config where id = 1;
-- Expect three keys (credits_3/20/50), web = iap on each, multiplier 1.00.
