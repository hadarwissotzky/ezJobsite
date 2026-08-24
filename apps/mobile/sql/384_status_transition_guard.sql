-- 384_status_transition_guard.sql
--
-- THE DATABASE NOW REFUSES AN ILLEGAL STATUS MOVE. DEF-1, server half. REQ-LC7.
--
-- The hole, verified 2026-07-28 rather than assumed: `signing.ts:104-107` finishes
-- the in-person signature path with
--     supabase.from('change_order').update({ status }).eq('id', o.changeOrderId)
-- -- a bare PostgREST update with NO precondition, running under `co_own` (030),
-- which is `for all` to the owner. So the owner's own device could walk a
-- `superseded` or an already-`declined` change order to `approved`, and the return
-- value was not even read. The only place the rule existed was inside
-- `confirmation_response_settles_co` (`230:112`, `and status in ('draft','sent')`),
-- which is one write path out of several.
--
-- WHY AT THE TABLE AND NOT IN THAT FUNCTION. The same argument
-- `210_approval_signature.sql` makes, and it has already come true once in this
-- schema: (1) it must hold for EVERY write path, not the one that happens to be
-- fashionable -- today that is three RPCs, two triggers and one raw PostgREST call;
-- (2) a rule that lives inside a function can be silently reverted by re-running an
-- older migration, and a rule that depends on migration order is not a rule.
--
-- ── THE TABLE, restated from REQ-LC7 and nowhere else ───────────────────────
--   draft      -> sent | approved | declined
--   sent       -> approved | declined | superseded
--   approved   -> (nothing)
--   declined   -> (nothing)
--   superseded -> (nothing)
--
-- `draft -> approved` is deliberate and is not a hole: a DEVICE row can still read
-- `draft` when the answer lands because the send has not hydrated back, and refusing
-- there would make being behind on sync produce a wrong outcome (mandate #7). The
-- server row is `sent` by then via 230's trigger; this permits the other order too.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
-- It does NOT refuse the `approval` row itself when the change order is terminal.
-- `confirmation_response_settles_co` inserts an approval BEFORE it moves the status
-- and does so ON PURPOSE even when the status will not move -- 230's header: "the
-- losing answer is still recorded in confirmation_response and in `approval` as
-- evidence that it happened". Blocking that insert would destroy evidence of a
-- second answer in order to enforce a rule the status column now enforces by
-- itself. The consequence is stated rather than hidden: after this file, a signature
-- attempt against a sealed extra leaves an `approval` row that did NOT move the
-- status, and any reader that infers status from the presence of an approval row is
-- wrong. `change_order.status` is the answer; the approval row is what was tried.
--
-- It also does not touch rows already in an illegal state. This is BEFORE UPDATE, so
-- history stands as it is -- the same posture 210 takes about pre-existing unsigned
-- confirmations.
--
-- OWNERSHIP: every object below is created only here (check-sql-duplicates).

create or replace function public.change_order_transition_guard() returns trigger
  language plpgsql as $$ begin
  -- A no-op is not a transition (REQ-LC8): an update that leaves the status alone --
  -- setting extra_type, parent_ewa_id, superseded_by -- must pass untouched, or this
  -- guard would break every non-status writer in the schema.
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- `sent -> cancelled` — the withdrawal (421, hadar 2026-08-24). It amends REQ-LC20.
  --
  -- THIS FILE WAS THE FOURTH COPY OF THE TRANSITION TABLE and I missed it: 421 widened
  -- the CHECK constraint and the app's LEGAL_TRANSITIONS, and the RPC's UPDATE then hit
  -- THIS trigger and was refused with "illegal change order transition sent -> cancelled"
  -- in front of the contractor. The guard was right to refuse; the omission was mine.
  --
  -- Deliberately NOT reachable from `draft` (nothing live to withdraw, nobody to tell)
  -- or from any terminal state (an approved record is frozen and permanent, mandate #1).
  -- Nothing may leave `cancelled` either: it is absent from every left-hand side below,
  -- which is what makes it terminal here as well as in the app.
  if not (
       (old.status = 'draft' and new.status in ('sent','approved','declined'))
    or (old.status = 'sent'  and new.status in ('approved','declined','superseded','cancelled'))
  ) then
    -- LOUD, and it names both ends. A refused transition that returns quietly is the
    -- "claims that outrun their evidence" defect: the caller reports a state change
    -- that never happened. errcode 23514 is the check-violation class the client
    -- already treats as permanent (`connector.ts:36`) -- a retry in an hour fails
    -- identically, so it must be discarded with evidence, never spun on.
    raise exception 'illegal change order transition % -> % (%)', old.status, new.status, old.id
      using errcode = '23514', hint = 'co_transition';
  end if;

  return new;
end $$;

drop trigger if exists change_order_transition on public.change_order;
create trigger change_order_transition before update of status on public.change_order
  for each row execute function public.change_order_transition_guard();
