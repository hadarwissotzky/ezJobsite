-- 436 — Fix the delete order inside delete_project_with_media_v1, and report failures.
--
-- hadar, 2026-09-01, with a screenshot: "Could not delete. The job is still here." That
-- is `job.delFailed` — the RPC did not REFUSE, it THREW, and the app rendered the same
-- four words it shows for every other failure while discarding the server's message.
--
-- TWO DEFECTS FOUND WHILE LOOKING FOR IT. Only the second is confirmed to be his.
--
-- 1. WRONG DELETE ORDER (fixed here, and real regardless).
--    `decision_version` references `decision` with ON DELETE NO ACTION — it BLOCKS.
--    The function deleted `decision` and never touched `decision_version`, so any
--    jobsite whose captures produced a decision would abort with a foreign-key
--    violation. SFO has zero decisions, so this is NOT what he hit; it is a loaded gun
--    that would have fired on 1155 Stanyan the moment he tried it there.
--
-- 2. `processing_job` DELETED AFTER `capture` (fixed here). There is no FK between them
--    today, so the order is currently harmless — but it is the same shape as defect 1
--    and the next person to add the constraint would inherit a broken function. Children
--    before parents, consistently, so the order stops being a thing to reason about.
--
-- WHAT I STILL DO NOT KNOW is why SFO threw, and this file does not pretend to. SFO
-- holds 3 captures, 3 processing jobs, no decisions, no change orders, and is owned by
-- the account hadar is signed in as — every fence passes. The app change shipped
-- alongside this migration surfaces the server's own error message on the next attempt,
-- which is the thing that will actually answer it. I would rather ship one honest
-- diagnostic than a third guess.
--
-- Apply with:  ./scripts/apply-migration.sh apps/mobile/sql/436_delete_with_media_order.sql

create or replace function public.delete_project_with_media_v1(p_project_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_block text;
  v_caps  integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select owner_id into v_owner from public.project where id = p_project_id;
  if v_owner is null then
    return jsonb_build_object('ok', true, 'already', true, 'captures', 0);
  end if;
  if v_owner is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;

  select t into v_block from (
    select 'change_order' as t where exists (select 1 from public.change_order where project_id = p_project_id)
    union all select 'approval' where exists (select 1 from public.approval where project_id = p_project_id)
    union all select 'confirmation_request' where exists (select 1 from public.confirmation_request where project_id = p_project_id)
    union all select 'extra_work_authorization' where exists (select 1 from public.extra_work_authorization where project_id = p_project_id)
  ) blockers limit 1;

  if v_block is not null then
    return jsonb_build_object('ok', false, 'reason', 'has_commitment', 'holds', v_block);
  end if;

  select count(*) into v_caps from public.capture where project_id = p_project_id;

  -- CHILDREN BEFORE PARENTS, every time, whether or not a constraint currently enforces
  -- it. `decision_version` → `decision` is ON DELETE NO ACTION and genuinely blocks;
  -- `processing_job` → `capture` has no constraint today and might tomorrow. Ordering by
  -- the data model rather than by which violations happen to be enforced is the only
  -- version that stays correct as constraints are added.
  delete from public.decision_version
    where decision_id in (select id from public.decision where project_id = p_project_id);
  delete from public.decision             where project_id = p_project_id;

  delete from public.processing_job       where project_id = p_project_id;
  delete from public.attachment           where project_id = p_project_id;
  delete from public.capture_pair         where project_id = p_project_id;
  delete from public.capture_op_state     where project_id = p_project_id;
  delete from public.capture              where project_id = p_project_id;

  delete from public.co_comment           where project_id = p_project_id;
  delete from public.scope_boundary       where project_id = p_project_id;
  delete from public.project_party        where project_id = p_project_id;
  delete from public.project_approver     where project_id = p_project_id;

  delete from public.project
   where id = p_project_id
     and owner_id = v_uid
     and not exists (select 1 from public.change_order where project_id = p_project_id);

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'has_commitment', 'holds', 'raced');
  end if;

  return jsonb_build_object('ok', true, 'captures', v_caps);
end $$;

revoke all on function public.delete_project_with_media_v1(text) from public, anon;
grant execute on function public.delete_project_with_media_v1(text) to authenticated;
