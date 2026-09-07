-- 387_open_signal.sql
--
-- "VIEWED" IS DERIVED HERE AND ONLY HERE. DEF-7 / REQ-LC3.
--
-- `Viewed` is named as a status in `PRD-change-approval-loop:70` (data model) and
-- `:591` (R8), has no writer anywhere in the system, and R8's 24h auto-reminder AC
-- (`:604`) is gated on it. The raw fact has existed since 366: every open of an
-- approval link writes a `confirmation_open` row, coalesced 60s per user agent, and
-- nothing ever read it back as a signal.
--
-- BOTH HALVES OF REQ-LC3's RULING MATTER:
-- 1. Derived, never stored. `confirmation_opened()` is granted to `anon` -- it has to
--    be, the page has no account -- so storing a status off it would let an
--    anonymous caller move the status of a priced commitment. The token is a
--    credential for reading and answering, not for moving state (020).
-- 2. Not a status. R7's ledger enumerates exactly five per-item statuses; a sixth
--    chip would contradict a shipped requirement in order to express something that
--    is a DEGREE OF `sent`, not an alternative to it.
--
-- ONE DEFINITION, TWO CONSUMERS -- the precedent is `extra_questions_v1` (307), which
-- defines "open question" in exactly one place so the device and the server cannot
-- drift. Here the two consumers are the contractor's app (through the project-scoped
-- wrapper) and the reminder scheduler (388, which calls the core function directly).
-- If they each counted opens themselves, the reminder that fires and the screen that
-- says "not opened yet" would eventually disagree, and the contractor would be told
-- two different things about the same fact on the same day.
--
-- EVERY REQUEST ON THE CHANGE ORDER COUNTS, including retired ones. A revision mints
-- a new link (250/307); the owner who opened yesterday's version DID look at this
-- extra. Counting only the live link would report "never opened" about a client who
-- has read it three times, and that reading is the one the contractor acts on.
--
-- OWNERSHIP: every object below is created only here (check-sql-duplicates).

-- The definition. SECURITY INVOKER on purpose: `confirmation_open` has RLS on with
-- no policy (deny), so this is callable only from inside a SECURITY DEFINER function
-- or by service_role -- which is exactly the two consumers, and makes an accidental
-- direct grant to `authenticated` fail closed rather than leak another tenant's
-- opens.
create or replace function public.change_order_open_signal(p_change_order_id text)
  returns table (
    open_count      bigint,
    viewed          boolean,       -- THE derivation of 'viewed'. Nothing else computes it.
    first_opened_at timestamptz,
    last_opened_at  timestamptz
  )
  language sql stable set search_path = public as $$
  select count(o.id),
         count(o.id) > 0,
         min(o.opened_at),
         max(o.opened_at)
    from public.confirmation_request r
    -- LEFT JOIN, so an extra whose link was never opened returns one row of zeros
    -- rather than no row at all. A caller that has to tell "never opened" from "no
    -- such extra" by an empty result set will get it wrong once.
    left join public.confirmation_open o on o.token = r.token
   where r.change_order_id = p_change_order_id
$$;

revoke all on function public.change_order_open_signal(text) from public, anon, authenticated;
grant execute on function public.change_order_open_signal(text) to service_role;

-- The contractor's read. Project-scoped like `extra_questions_v1` (307) and
-- `change_order_state_times_v1` (385): the app hydrates a project at a time, and one
-- round trip per extra on one bar is the whole perceived load time.
-- `extra_open_signal_v1` is NOT defined here any more [2026-08-26]. It lives in
-- `428_office_reads.sql`, its single owner.
--
-- Why it moved: 428 widens its ownership test from `co.owner_id = auth.uid()` to
-- that OR `is_project_visible(co.project_id)`, so an active member of the company
-- that owns the job can read it — which is the rule 376 already chose for the
-- tables and never applied to the definer functions. Until then "the client opened it and has not answered" is the difference between chasing them
-- and waiting, and it was invisible on a teammate's change order.
--
-- Nothing else about it changed. `create or replace function` has no partial form,
-- so the widened version is the whole function, and one object defined in two files
-- is decided by whichever ran last.
