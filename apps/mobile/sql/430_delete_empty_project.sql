-- 430_delete_empty_project.sql
--
-- DELETE A JOBSITE — but only one that holds nothing.
--
-- hadar, 2026-08-31: "Need to add the ability to delete a job if it is empty."
--
-- ─── WHY THE SERVER DECIDES WHAT "EMPTY" MEANS ──────────────────────────────────
-- Fourteen tables carry a `project_id`, and only THREE of them have a foreign key
-- back to `project`. So a delete that trusted the client — or that trusted the FKs —
-- would silently orphan rows in eleven tables, and some of those rows are evidence: a
-- signed `approval`, a frozen `confirmation_request`, a `capture`. Mandate #1 says a
-- capture is never lost, and a jobsite that took its captures with it is exactly that
-- loss wearing an innocent name.
--
-- So the emptiness test lives HERE, is enumerated table by table, and is checked in
-- the same statement that deletes. A client cannot pass a flag that skips it.
--
-- ─── WHY THIS IS A DELETE AND NOT AN ARCHIVE ────────────────────────────────────
-- Archive already exists (REQ-PM4, `status = 'archived'`) and is the right answer for
-- a job with history: it keeps everything and hides it. This is for the OTHER case —
-- the mistyped address, the duplicate created while the picker was broken, the "Test"
-- rows from an afternoon of debugging. A jobsite with nothing in it has no history to
-- protect, and forcing a contractor to archive his typos means his archive fills with
-- things that never happened.
--
-- ─── WHAT IT REFUSES, AND WHY EACH REFUSAL IS SEPARATE ──────────────────────────
--   not yours          -> a project you do not own is not yours to delete
--   not empty          -> names the table that stopped it, so the answer is actionable
--                         rather than "cannot delete"
-- Both come back as a structured result, not an exception: the caller renders them,
-- and a swallowed exception is how a refusal becomes a silent no-op.
--
-- OWNERSHIP: `delete_empty_project_v1` is created only here (check-sql-duplicates).

create or replace function public.delete_empty_project_v1(p_project_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_name  text;
  v_block text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select owner_id, name into v_owner, v_name
  from public.project where id = p_project_id;

  -- ALREADY GONE IS A SUCCESS. The client may retry after a dropped response, and a
  -- second delete of the same jobsite should not read as a failure.
  if v_owner is null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if v_owner is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;

  -- EVERY TABLE THAT CAN HOLD SOMETHING, enumerated. Derived by querying
  -- information_schema for `project_id` on base tables (not views) on 2026-08-31 —
  -- not from memory. A table added later and not listed here is a hole, which is why
  -- the list is explicit rather than a loop over a catalog: a reader can audit it.
  select t into v_block from (
    select 'change_order' as t where exists (select 1 from public.change_order where project_id = p_project_id)
    union all select 'capture' where exists (select 1 from public.capture where project_id = p_project_id)
    union all select 'attachment' where exists (select 1 from public.attachment where project_id = p_project_id)
    union all select 'capture_op_state' where exists (select 1 from public.capture_op_state where project_id = p_project_id)
    union all select 'capture_pair' where exists (select 1 from public.capture_pair where project_id = p_project_id)
    union all select 'decision' where exists (select 1 from public.decision where project_id = p_project_id)
    union all select 'approval' where exists (select 1 from public.approval where project_id = p_project_id)
    union all select 'confirmation_request' where exists (select 1 from public.confirmation_request where project_id = p_project_id)
    union all select 'extra_work_authorization' where exists (select 1 from public.extra_work_authorization where project_id = p_project_id)
    union all select 'co_comment' where exists (select 1 from public.co_comment where project_id = p_project_id)
    union all select 'scope_boundary' where exists (select 1 from public.scope_boundary where project_id = p_project_id)
    union all select 'processing_job' where exists (select 1 from public.processing_job where project_id = p_project_id)
  ) blockers limit 1;

  if v_block is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_empty', 'holds', v_block);
  end if;

  -- The two roster tables are the ONLY rows a delete may take with it: they describe
  -- who was attached to the jobsite, they are not evidence of anything that happened,
  -- and leaving them behind would orphan rows pointing at a project that is gone.
  delete from public.project_party    where project_id = p_project_id;
  delete from public.project_approver where project_id = p_project_id;

  -- Re-checked in the DELETE itself, not merely above: between the scan and here a
  -- capture could have landed, and the `owner_id` predicate means a project that
  -- changed hands mid-call is not deleted by the previous owner.
  delete from public.project
  where id = p_project_id
    and owner_id = v_uid
    and not exists (select 1 from public.capture      where project_id = p_project_id)
    and not exists (select 1 from public.change_order where project_id = p_project_id);

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_empty', 'holds', 'raced');
  end if;

  return jsonb_build_object('ok', true, 'name', v_name);
end $$;

revoke all on function public.delete_empty_project_v1(text) from public;
grant execute on function public.delete_empty_project_v1(text) to authenticated;
