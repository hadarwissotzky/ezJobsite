-- 385_state_times.sql
--
-- WHEN THE EXTRA CHANGED STATE, ANSWERED FROM THE EVIDENCE THAT ALREADY RECORDS IT.
-- DEF-8, server half. REQ-LC4.
--
-- The defect is real: `change_order` records WHAT state a row is in and never WHEN
-- it got there, which is why `record.ts` renders sent/signed/declined with an
-- explicit "time not recorded" marker. R6 asks for "each event with timestamps in
-- order" and the record screen could not supply three of them.
--
-- ── WHY THIS ADDS NO COLUMNS, against the literal brief ─────────────────────
-- The brief for this migration asked for stored `sent_at_ms` / `approved_at_ms`
-- columns on `change_order`, backfilled from `confirmation_request.created_at` and
-- `approval.signed_at`. REQ-LC4 rules the opposite for the SERVER, in as many words:
-- "On the server: these are derived, not stored -- `confirmation_request.created_at`
-- is when it was sent and `confirmation_response.responded_at` is when it was
-- answered, both already append-only evidence. A stored server copy would be exactly
-- the drift REQ-LC1 forbids. The device stores them because the device holds none of
-- those event rows and must render the record offline (mandate #7)."
--
-- The spec is authoritative for the lifecycle and its reasoning survives inspection,
-- so it wins, and the disagreement is written down here instead of being quietly
-- decided: the backfill the brief describes IS the derivation. Those two tables are
-- the sources the backfill would have copied FROM, which concedes they are the
-- authority. Copying them into a column adds no fact and adds one place for the two
-- to disagree -- and they would, the first time a second `confirmation_request` is
-- issued for one extra and somebody has to decide which one "sent_at" meant.
--
-- The DEVICE half of DEF-8 is not addressed here and is still owed: `change_order`
-- on the phone must gain sent_at_ms / approved_at_ms / declined_at_ms /
-- superseded_at_ms, written write-once by the same guarded UPDATE that moves the
-- status. That is REQ-LC4's first bullet and it lives in `changeorder.ts`.
--
-- ── THE DEFINITIONS, stated once ────────────────────────────────────────────
--   sent       = the FIRST confirmation_request created for this change order. Not
--                the latest: a revision mints a new request (250/307) and the extra
--                was sent when it first left the phone, not when it was resent.
--   approved   = the FIRST approval row carrying action 'approved'.
--   declined   = the FIRST approval row carrying action 'declined'.
--   superseded = change_order.superseded_at, already stored by 307's RPC.
--
-- A ROW CAN CARRY BOTH approved_at AND declined_at, and that is not a bug. 230
-- records the losing answer as evidence when a second link is answered after the
-- first. `status` says which one took effect; these say when each was attempted. A
-- caller reads the one that matches the status and must not infer the status from
-- which timestamp is present.
--
-- Why `approval` rather than `confirmation_response`: the in-person signature path
-- (`signing.ts`) writes an approval with no confirmation_request at all, so
-- confirmation_response would leave those extras with no approval time. Every
-- approval writes an `approval` row; that is the one table both paths share.
--
-- OWNERSHIP: every object below is created only here (check-sql-duplicates).

-- Project-scoped, like `extra_questions_v1` (307), because the app hydrates a
-- project at a time and a per-row RPC would be one round trip per extra on one bar.
--
-- SECURITY DEFINER with an explicit owner check, for the same reason 366 states:
-- `confirmation_request` grants select only to its owner and `approval` is readable
-- through 260's narrow policy; definer without the check would hand every signed-in
-- user every tenant's send and signature times.
create or replace function public.change_order_state_times_v1(p_project_id text)
  returns table (
    change_order_id  text,
    sent_at_ms       bigint,
    approved_at_ms   bigint,
    declined_at_ms   bigint,
    superseded_at_ms bigint
  )
  language sql stable security definer set search_path = public as $$
  select co.id,
         (extract(epoch from (
            select min(r.created_at) from public.confirmation_request r
             where r.change_order_id = co.id)) * 1000)::bigint,
         (extract(epoch from (
            select min(a.signed_at) from public.approval a
             where a.change_order_id = co.id and a.action = 'approved')) * 1000)::bigint,
         (extract(epoch from (
            select min(a.signed_at) from public.approval a
             where a.change_order_id = co.id and a.action = 'declined')) * 1000)::bigint,
         (extract(epoch from co.superseded_at) * 1000)::bigint
    from public.change_order co
   -- NULL-SAFE, stated explicitly. `co.owner_id = auth.uid()` is NULL for an
   -- unauthenticated caller and a NULL predicate drops the row, but saying so is the
   -- habit 100_projects.sql was fixed to keep: the next edit to this predicate might
   -- not be null-safe by accident.
   where auth.uid() is not null
     and co.owner_id = auth.uid()
     and co.project_id = p_project_id
$$;

revoke all on function public.change_order_state_times_v1(text) from public, anon;
grant execute on function public.change_order_state_times_v1(text) to authenticated;
