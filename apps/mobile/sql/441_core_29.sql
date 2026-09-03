-- 441 — Core's monthly price moves from $24 to $29.
--
-- hadar, 2026-09-03: "i would like to change the program plan to CORE cost to 29 from
-- 24."
--
-- ─── WHY A MIGRATION AND NOT AN EDIT TO 410 ─────────────────────────────────────
-- `410_pricing_seed.sql` seeded this row and has already been applied. Editing it would
-- change what a FRESH database gets while leaving production on the old number, and the
-- two would disagree silently — the exact drift `check-sql-duplicates.mjs` exists to
-- catch. The seed keeps its history; this file states the change.
--
-- ─── WHAT THIS DOES NOT DO, AND IT IS THE IMPORTANT PART ────────────────────────
-- IT DOES NOT CHANGE WHAT ANYONE IS CHARGED. `pricing_config` is what the app SHOWS.
-- The money is taken by the App Store and by RevenueCat's web billing against product
-- price points that live in App Store Connect and the RevenueCat dashboard. Until those
-- move, this row makes the paywall advertise $29 and the store charge $24.
--
-- A paywall that names a price the checkout does not honour is the highest-risk kind of
-- wrong this product has (mandate #6 is about exactly this class of number). So this
-- migration is deliberately NOT safe to apply on its own — it is the second half of a
-- change whose first half is the store.
--
-- ─── EXISTING SUBSCRIBERS ───────────────────────────────────────────────────────
-- Nobody is grandfathered by this file because nothing here bills. Apple keeps existing
-- subscribers on the price they signed up at unless the increase is explicitly pushed
-- with consent; that is a decision made in App Store Connect, not here.

update public.pricing_config
   set subscription_prices = jsonb_set(
         subscription_prices, '{core,monthly}', '2900'::jsonb, false),
       version = version + 1,
       updated_at = now();

-- Read it back in the same transaction so a wrong path fails loudly rather than
-- silently doing nothing: `jsonb_set` on a missing path returns the object unchanged.
do $$
declare v integer;
begin
  select (subscription_prices #>> '{core,monthly}')::int into v from public.pricing_config limit 1;
  if v is distinct from 2900 then
    raise exception 'core monthly did not take: it reads %', v;
  end if;
  raise notice 'core monthly is now %', v;
end $$;
