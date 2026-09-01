-- 434 — Delete a jobsite AND the captures on it, when the owner asks for exactly that.
--
-- hadar signed this off 2026-09-01, after trying four times to remove a test jobsite
-- ("i tried to delete SFO and it didn't remove it") and being refused each time,
-- correctly, because it holds three photos.
--
-- ============================================================================
-- WHY THIS IS NOT A VIOLATION OF MANDATE #1, stated in full because it looks like one.
--
-- Mandate #1 is about SILENT loss: "never acknowledge a capture unless a verified,
-- recoverable copy exists", and "silent data loss is the single unforgivable sin".
-- Its target is the capture that disappears without anyone choosing it — a crash, a
-- failed upload, a dishonest "saved ✓".
--
-- THE GAP THAT FORCED THIS. `delete_empty_project_v1` counts a capture as content, so
-- a jobsite acquires ONE photo and becomes permanent. A contractor who mistypes an
-- address, snaps a photo, and notices a minute later has no remedy at all: Archive
-- hides it, nothing removes it, and the mistake is in the account forever. Refusing to
-- ever delete is not the same as never losing, and the first was quietly costing the
-- second nothing.
--
-- WHAT KEEPS IT HONEST — four fences, and all four matter:
--   1. THE OWNER ASKS, for their own jobsite. `auth.uid()` must equal `owner_id`.
--   2. NO PRICED COMMITMENT MAY BE PRESENT. A change order, an approval or a
--      confirmation_request refuses the whole call. Those are frozen instruments
--      (mandates #1 and #5) and no button reaches them, including this one.
--   3. IT REPORTS WHAT IT DESTROYED. The count comes back so the app can confirm
--      afterwards with a real number, not a shrug.
--   4. The caller shows that number BEFORE the deed and takes a second, deliberate
--      tap for it. That is the difference between a chosen deletion and a silent one,
--      and it is the whole basis of this exception.
--
-- WHAT IT STILL DOES NOT DO: it does not remove Storage objects. The rows go; the
-- bytes are orphaned in the bucket until something sweeps them. Named here rather than
-- discovered later.
-- ============================================================================

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
    -- Already gone. Idempotent on purpose: a retry after a dropped response must not
    -- read as a failure and send someone hunting for a jobsite that is not there.
    return jsonb_build_object('ok', true, 'already', true, 'captures', 0);
  end if;
  if v_owner is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;

  -- FENCE 2. Only commitments block; captures do not, which is the entire point of
  -- this function existing beside `delete_empty_project_v1` rather than replacing it.
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

  -- Children before parents: `attachment` references `capture`.
  delete from public.attachment           where project_id = p_project_id;
  delete from public.capture_pair         where project_id = p_project_id;
  delete from public.capture_op_state     where project_id = p_project_id;
  delete from public.capture              where project_id = p_project_id;
  delete from public.decision             where project_id = p_project_id;
  delete from public.co_comment           where project_id = p_project_id;
  delete from public.scope_boundary       where project_id = p_project_id;
  delete from public.processing_job       where project_id = p_project_id;
  delete from public.project_party        where project_id = p_project_id;
  delete from public.project_approver     where project_id = p_project_id;

  -- Re-checked in the DELETE itself: between the scan above and here a change order
  -- could have landed from another device, and it must survive that race rather than
  -- be taken along. `owner_id` likewise, for a project that changed hands mid-call.
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
