-- 370: an extra may exist without a price.
--
-- WHY. R2's promise is that the price comes out of what the contractor SAID:
-- "we don't price it, the user does". If he never said a number there is no
-- number, and the app has to be able to carry that extra anyway — record it,
-- upload it, show it, and send it — rather than refusing to create it at all.
-- Until now `amount_cents` was NOT NULL on both sides, so a priceless extra was
-- not a state the system could represent.
--
-- NULL IS NOT ZERO, and the distinction is the whole point. Zero says the work
-- costs nothing. Null says nobody has said what it costs yet. Storing zero for
-- "no price given" would print "no cost change" on a document a homeowner signs,
-- which is the most expensive sentence this app could produce. The CHECK below
-- still bars negatives when a price IS present.
--
-- WHAT THIS DOES NOT DO: it does not make the price optional at APPROVAL time.
-- An extra can now exist and travel without a number; whether it may be
-- APPROVED without one is a separate question this migration deliberately does
-- not answer, because R3's EWA path already exists precisely for "authorize the
-- work, price to follow" and that is a different instrument with its own cap and
-- settlement terms.
--
-- OWNERSHIP: every object below is created only here (check-sql-duplicates).

-- The column itself.
alter table public.change_order alter column amount_cents drop not null;

-- The old constraint said `amount_cents >= 0`, which a null satisfies vacuously
-- in Postgres (null >= 0 is null, and CHECK passes on null). Restating it
-- explicitly so the intent is readable rather than relying on that subtlety —
-- the next person should not have to know three-valued logic to see that
-- negatives are still refused.
do $$
begin
  if exists (select 1 from pg_constraint
              where conname = 'change_order_amount_cents_check'
                and conrelid = 'public.change_order'::regclass) then
    alter table public.change_order drop constraint change_order_amount_cents_check;
  end if;
end $$;

alter table public.change_order
  add constraint change_order_amount_cents_check
  check (amount_cents is null or amount_cents >= 0);

-- THE INGEST RPC NEEDS NO CHANGE, and I checked rather than assumed:
-- `050_change_order_ingest.sql:33` declares `p_amount_cents bigint` with no NOT
-- NULL and no default, so it has always accepted a null — the column was the
-- only thing refusing it. Recreating the function to "make it nullable" would
-- have changed a signature the client matches by exact parameter name set, and
-- a signature the client disagrees with is PGRST202 at runtime: a failure that
-- only appears on a real device with real signal.
