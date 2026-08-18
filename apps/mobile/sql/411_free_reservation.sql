-- 411 — the free allowance goes through a reservation too.
--
-- ─── THE BUG THIS FIXES, FOUND BY EXERCISING IT ─────────────────────────────────
-- 409 gave `credit_reservation` a partial unique index, `one_open_reservation_per_co`,
-- and its comment says what it is for: "revise and resend five times consumes exactly
-- one credit … STRUCTURALLY true rather than true-if-the-app-remembers."
--
-- The free allowance walked straight past it. 409's design — free credits create no
-- reservation and never touch RevenueCat — kept the free tier cleanly out of the money
-- path, and in doing so removed the one structure that made double-counting impossible.
-- Reserving the SAME change order twice took two free credits off the account:
--
--     reserve co-…b5t7  ->  free_allowance, freeLeft 1
--     reserve co-…b5t7  ->  free_allowance, freeLeft 0     <- same extra, twice
--
-- Verified against the live database, not reasoned about. A contractor on the free tier
-- who sent one change order, revised it, and sent it again would have used his whole
-- allowance on one piece of work — and the fix the index already provides was sitting
-- one code path away.
--
-- ─── THE FIX: ONE PATH, NOT TWO ─────────────────────────────────────────────────
-- Every send opens a reservation, free or paid. The index then guarantees uniqueness
-- for both, because there is no longer a "both" — there is one path with a flag on it.
--
-- `is_free` is what keeps 409's actual intent: a free send still never reaches
-- RevenueCat. The settle trigger reads this column and simply does not queue a spend for
-- a free reservation, so the free tier remains outside the money path while sharing the
-- structure that makes it correct.
alter table public.credit_reservation
  add column if not exists is_free boolean not null default false;

-- A free reservation is not a purchased one and the difference has to be legible in a
-- dispute — "you were charged for this" versus "this was one of your two free ones" is
-- exactly the question a billing argument turns on.
comment on column public.credit_reservation.is_free is
  'True when this send came out of the free allowance. Such a reservation never queues '
  'a RevenueCat spend: the free tier has no billing relationship at all.';

create index if not exists credit_reservation_free
  on public.credit_reservation (company_id) where is_free;

-- ── repair the counters the bug left behind ─────────────────────────────────────
--
-- The defect above incremented `free_allowance_used` WITHOUT creating a reservation, so
-- any account it touched now shows credits spent that nothing accounts for. On this
-- database that is one company and two credits, consumed while proving the bug existed.
--
-- The repair is not "reset to zero" — that would hand free credits back to anyone who
-- had legitimately used them. The invariant the fixed code maintains is:
--
--     free_allowance_used == count(reservations where is_free)
--
-- so the counter is set to what the reservations actually justify. An account that
-- genuinely used its free sends keeps them used, because those rows exist. An account
-- charged by the bug gets exactly the untracked difference back.
--
-- Runs once, is idempotent, and after the fix in `credits/index.ts` there is no path
-- that can re-create the discrepancy.
update public.company_billing b
   set free_allowance_used = coalesce((
         select count(*) from public.credit_reservation r
          where r.company_id = b.company_id and r.is_free), 0),
       updated_at = now()
 where b.free_allowance_used <> coalesce((
         select count(*) from public.credit_reservation r
          where r.company_id = b.company_id and r.is_free), 0);
