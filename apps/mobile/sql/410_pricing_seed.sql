-- 410 — seed the pricing config with real values, and correct the free allowance.
--
-- ─── TWO THINGS, AND THE FIRST IS A DEFECT IN 409 ───────────────────────────────
--
-- 409 seeded its config row with `insert … on conflict (id) do nothing`. That is the
-- right shape for "make sure a row exists" and the WRONG shape for "make sure the row
-- says this": once the row exists, every later change to a column DEFAULT is invisible
-- to it, forever.
--
-- It bit immediately. 409 was applied while its default was still `free_allowance = 3`
-- (from the payment spec); the default was corrected to 2 minutes later (hadar: "2
-- credit free"), and the row kept the 3. Re-applying 409 changes nothing, because
-- `do nothing` is doing exactly what it says. Verified against the live database:
-- `pricing_config.free_allowance` read 3 after the apply.
--
-- So config VALUES are set here, by UPDATE, and never by a column default. A default is
-- for a column that has no opinion; these all have one.
--
-- ─── THE PRICES ARE THE ONES THAT SHIP, NOT THE ONES IN THE SPEC ────────────────
-- `ezChangeOrders-Payment-Spec.md` proposes Pro $39 / Crew $119 + $25/seat.
-- `apps/mobile/src/plans.ts` ships Core $24 monthly / $229 annual, Crew $59 / $589, and
-- `docs/PRICING-STRATEGY.md` records $19/$49 signed off on 2026-07-15 with "never charge
-- per field seat".
--
-- Seeded from `plans.ts`, because those are the four product IDs that exist in the App
-- Store and in RevenueCat today — a config row naming prices no product can charge would
-- be a third contradictory pricing source. When hadar settles which document survives,
-- this row is one UPDATE, with no app release: that is what `pricing_config` is for.
--
-- Cents, integers, no floats. A price is money and money is not a float.

update public.pricing_config set
  version = 2,

  -- TWO free signed change orders (hadar, 2026-08-17). Matches `plans.ts:82`
  -- free.changeOrders = 2, which the device has been enforcing all along.
  free_allowance = 2,

  -- Pay-as-you-go. `credits` is what the purchase GRANTS; `web` and `iap` are what it
  -- costs on each rail. The web price is the real one — external-link purchases carry
  -- 0% Apple commission in the US as of April 2025 — and `iap` is web × 1.3, rounded to
  -- a price point Apple actually sells, so the in-app rail exists without being the
  -- cheap way to buy.
  pack_prices = jsonb_build_object(
    'credits_5',  jsonb_build_object('credits',  5, 'web',  2500, 'iap',  3299),
    'credits_20', jsonb_build_object('credits', 20, 'web',  7900, 'iap', 10299),
    'credits_50', jsonb_build_object('credits', 50, 'web', 14900, 'iap', 19499)
  ),

  -- Subscriptions are UNLIMITED signed change orders (hadar, 2026-08-17: keep unlimited,
  -- fix the cost instead — which is what the caching work did, taking a change order
  -- from ~$0.66 to ~$0.22 and moving the break-even on $19 from 28/month to ~80).
  --
  -- `credits_per_month` is therefore null, not 0: null means "this tier does not meter",
  -- 0 would mean "this tier grants nothing", and the send gate has to tell those apart.
  subscription_prices = jsonb_build_object(
    'core', jsonb_build_object(
      'monthly', 2400, 'annual', 22900, 'seats', 3, 'credits_per_month', null),
    'crew', jsonb_build_object(
      'monthly', 5900, 'annual', 58900, 'seats', null, 'credits_per_month', null)
  ),

  -- BOTH RAILS ON. Web is the one we want the money to come through; IAP stays live and
  -- working because a rail that is present but broken is an App Store review rejection,
  -- and because `linkout_enabled` may have to go false at short notice — Apple has
  -- proposed 5–15% on external links and the Supreme Court hears the appeal in the
  -- October 2026 term.
  linkout_enabled = true,
  iap_enabled = true,
  iap_multiplier = 1.30,

  updated_at = now()
where id = 1;

-- If 409's row was somehow never created, create it now with the same values rather
-- than leaving the table empty and every reader falling back to a guess.
insert into public.pricing_config (
  id, version, free_allowance, pack_prices, subscription_prices,
  linkout_enabled, iap_enabled, iap_multiplier)
select 1, 2, 2,
  jsonb_build_object(
    'credits_5',  jsonb_build_object('credits',  5, 'web',  2500, 'iap',  3299),
    'credits_20', jsonb_build_object('credits', 20, 'web',  7900, 'iap', 10299),
    'credits_50', jsonb_build_object('credits', 50, 'web', 14900, 'iap', 19499)),
  jsonb_build_object(
    'core', jsonb_build_object('monthly', 2400, 'annual', 22900, 'seats', 3, 'credits_per_month', null),
    'crew', jsonb_build_object('monthly', 5900, 'annual', 58900, 'seats', null, 'credits_per_month', null)),
  true, true, 1.30
where not exists (select 1 from public.pricing_config where id = 1);
