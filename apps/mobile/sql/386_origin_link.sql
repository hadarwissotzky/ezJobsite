-- 386_origin_link.sql
--
-- A CHANGE AFTER APPROVAL IS A NEW EXTRA THAT POINTS BACK. D6 / REQ-LC31.
--
-- The rule being built: an approved extra is SEALED -- never reopened, never
-- superseded, never edited, never deleted. When the work changes after the owner
-- signed, the answer is a NEW INDEPENDENT EXTRA carrying its own price and its own
-- signature, linked to the approved one it follows from. The approved record does
-- not move, does not learn anything, and is not written to.
--
-- ── WHY THIS IS NOT SUPERSESSION, AND MUST NOT REUSE IT ─────────────────────
--   change_order.superseded_by       FORWARD pointer, WITHIN one negotiation.
--                                    The predecessor is RETIRED and nobody ever
--                                    approved it. Written only by
--                                    supersede_change_order_v1 (307), which refuses
--                                    anything that is not 'sent' -- and MUST keep
--                                    refusing an approved row. Nothing here changes
--                                    that function or that guard.
--
--   change_order.origin_change_order_id   NEW. BACKWARD pointer, ACROSS the seal.
--                                    Points from a new extra to the APPROVED extra
--                                    it follows. Its referent is untouched.
--
-- Supersession retires; origin follows. Collapsing them would make "superseded"
-- mean "the customer's signature was retired", which is the one thing it must never
-- be able to mean.
--
-- ── THE FOUR RULES, and where each is enforced ──────────────────────────────
-- 1. The referent must be `approved` AT WRITE TIME. Pointing at a `sent` row would
--    be a supersession wearing a different name. Enforced by the trigger below, not
--    only by the RPC -- a CHECK constraint cannot read another row, and a rule that
--    lives only in a function is one a raw PostgREST update forgets (the client's
--    `co_own` policy is `for all`, which is exactly how DEF-1 happened).
-- 2. Writing it touches NO column of the origin row. The RPC updates one column of
--    the CHILD and nothing else; there is no statement here that writes to the
--    origin.
-- 3. Set once, then frozen. A lineage that can be rewritten is not a lineage.
-- 4. Not transitive-collapsing. Nothing here merges A <- B <- C into a "current"
--    row; each keeps its own amount, status and signature. REQ-LC32's ledger shows
--    two amounts, never a sum, and that is presentational -- deliberately no view
--    here that adds them, because such a view is exactly how "$1,850 + $400" turns
--    into a single $2,250 nobody signed.
--
-- ── DELIBERATE DEVIATIONS, each with its reason ─────────────────────────────
-- * NO FOREIGN KEY, matching `superseded_by` (307). Extras drain from devices out of
--   order, and an FK turns "arrived early" into a permanently discarded mutation
--   (23503 is fatal in `connector.ts`). The trigger's existence + status check is
--   strictly stronger than an FK anyway: an FK would happily accept a `draft` row.
-- * A SEPARATE RPC, not a new parameter on `ingest_change_order_v1`. Widening that
--   signature means DROP + CREATE, which would take ownership of it away from 375
--   and put the same function in three files; and PostgREST matches by exact
--   parameter-name set, so a client that disagrees fails with PGRST202 on a real
--   device with real signal. REQ-LC31 says the link is "set once, at creation" -- the
--   set-once trigger delivers that guarantee whether it is written in the same
--   statement or the next one.
-- * THE CHILD'S OWN STATUS IS NOT CONSTRAINED. Requiring the child to still be
--   'draft' would read closer to "at creation", but a retry that arrives after the
--   child was sent would then be refused forever and the lineage would be lost
--   permanently. Losing the record of what a change followed from is worse than
--   recording it late.
--
-- OWNERSHIP: every object below is created only here (check-sql-duplicates).

alter table public.change_order
  add column if not exists origin_change_order_id text;

create index if not exists change_order_origin_idx
  on public.change_order (origin_change_order_id)
  where origin_change_order_id is not null;

-- Rules 1 and 3, at the table, for every write path.
create or replace function public.change_order_origin_guard() returns trigger
  language plpgsql as $$
declare origin_status text;
begin
  if new.origin_change_order_id is not distinct from
     (case when tg_op = 'INSERT' then null else old.origin_change_order_id end) then
    return new;                      -- not touching the lineage
  end if;

  -- Rule 3. Once set it is evidence of what this extra follows from, and evidence
  -- that can be re-pointed is not evidence. Clearing it counts as rewriting it.
  if tg_op = 'UPDATE' and old.origin_change_order_id is not null then
    raise exception 'origin_change_order_id is set once: % already follows %',
      old.id, old.origin_change_order_id
      using errcode = '23514', hint = 'origin_frozen';
  end if;

  if new.origin_change_order_id = new.id then
    raise exception 'a change order cannot follow itself: %', new.id
      using errcode = '23514', hint = 'origin_self';
  end if;

  select status into origin_status
    from public.change_order where id = new.origin_change_order_id;

  if origin_status is null then
    raise exception 'origin change order % does not exist', new.origin_change_order_id
      using errcode = '23503', hint = 'origin_missing';
  end if;

  -- Rule 1. The whole point of D6 is that the seal is what makes a follow-on
  -- necessary. Anything not yet sealed is revised in place by supersession.
  if origin_status <> 'approved' then
    raise exception 'origin change order % is %, not approved: revise it instead of following it',
      new.origin_change_order_id, origin_status
      using errcode = '23514', hint = 'origin_not_approved';
  end if;

  return new;
end $$;

drop trigger if exists change_order_origin on public.change_order;
create trigger change_order_origin
  before insert or update of origin_change_order_id on public.change_order
  for each row execute function public.change_order_origin_guard();

-- ── the write path ──────────────────────────────────────────────────────────
--
-- IDEMPOTENT BY OUTCOME, not by a mutation id -- the same discipline
-- supersede_change_order_v1 (307) settled on, and for the same reason: the link is
-- terminal and it is recorded on the row itself, so a replay either finds the same
-- origin (already applied) or a different one (a real conflict, and refusing loudly
-- beats rewriting lineage). There is nothing left for a mutation ledger to
-- de-duplicate that the row does not already answer.
create or replace function public.link_origin_change_order_v1(
  p_id text, p_origin_change_order_id text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare child  public.change_order%rowtype;
        origin public.change_order%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into child from public.change_order where id = p_id;
  if not found then
    raise exception 'unknown change order %', p_id using errcode = '42501';
  end if;
  if child.owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  if child.origin_change_order_id is not null then
    if child.origin_change_order_id is distinct from p_origin_change_order_id then
      raise exception 'change order % already follows %', p_id, child.origin_change_order_id
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','id',p_id);
  end if;

  select * into origin from public.change_order where id = p_origin_change_order_id;
  if not found then
    raise exception 'unknown origin change order %', p_origin_change_order_id
      using errcode = '42501';
  end if;
  if origin.owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch on origin' using errcode = '42501';
  end if;
  -- A follow-on is by definition more work on the same job. Allowing a cross-project
  -- link would put one job's approved money in another job's lineage, and R7's
  -- per-project totals are the surface that would quietly lie about it.
  if origin.project_id is distinct from child.project_id then
    raise exception 'a follow-on must be on the same project as the extra it follows'
      using errcode = '23514', hint = 'origin_other_project';
  end if;

  -- The status check is NOT repeated here. The trigger owns rule 1 and will refuse
  -- this update; restating it would be the same rule in two places, drifting the
  -- moment one of them is edited. This function's job is ownership, idempotency and
  -- a usable return value.
  update public.change_order
     set origin_change_order_id = p_origin_change_order_id
   where id = p_id
     and origin_change_order_id is null;

  return jsonb_build_object('status','linked','id',p_id,'origin',p_origin_change_order_id);
end $$;

revoke all on function public.link_origin_change_order_v1(text, text) from public, anon;
grant execute on function public.link_origin_change_order_v1(text, text) to authenticated;
