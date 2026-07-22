-- 369: discard a never-sent extra server-side — the bytes, not the record.
--
-- WHY IT MIRRORS THE PHONE RATHER THAN HARD-DELETING. The device keeps
-- `capture_commit` (its trigger refuses deletion) and removes the media file.
-- The server is the same shape for the same reasons, and one more: attempting a
-- hard delete here would hit `transcript_append_only`, which blocks DELETE on
-- `capture_transcript` outright, and would orphan `capture_note`,
-- `capture_structured`, `capture_content_signal` and `capture_tag` — none of
-- which carry a cascading FK. A "delete" that half-succeeds against six tables
-- is worse than one that says exactly what it did.
--
-- So: the STORAGE OBJECT goes, because the bytes are the asset — the cost, the
-- privacy exposure, the thing the contractor meant. The row stays as an
-- auditable record that something existed and was deliberately discarded.
--
-- WHAT IT REFUSES, and each of these is somebody else's evidence:
--   * an extra that was ever SENT. A `confirmation_request` on its decision
--     means a link went out and may have been opened, read and answered.
--   * a capture another change order still reaches. `revision.ts` reuses
--     prior.decision_id, so a revised extra SHARES captures with the original,
--     and the original may be sent.
--   * anything the caller does not own.
--
-- OWNERSHIP: every object below is created only here (check-sql-duplicates).

create table if not exists public.capture_discarded (
  capture_id      text primary key,
  change_order_id text not null,
  owner_id        uuid not null,
  discarded_at    timestamptz not null default now()
);

alter table public.capture_discarded enable row level security;
drop policy if exists capture_discarded_own on public.capture_discarded;
create policy capture_discarded_own on public.capture_discarded for select to authenticated
  using (owner_id = auth.uid());
-- Written only by the function below, never by a client directly.
revoke insert, update, delete on public.capture_discarded from authenticated;

-- A discard is an act, and an act that can be un-recorded is not a record.
create or replace function public.capture_discarded_no_change() returns trigger
  language plpgsql as $$ begin
    raise exception 'a discard is a recorded act: % blocked', tg_op;
  end $$;
drop trigger if exists capture_discarded_no_change on public.capture_discarded;
create trigger capture_discarded_no_change before update or delete
  on public.capture_discarded for each row
  execute function public.capture_discarded_no_change();

create or replace function public.discard_extra_own(p_change_order_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner    uuid;
  v_decision text;
  v_sent     int;
  r          record;
  n_bytes    int := 0;
  n_kept     int := 0;
begin
  select co.owner_id, co.decision_id into v_owner, v_decision
    from public.change_order co where co.id = p_change_order_id;
  if v_owner is null then
    raise exception 'no such extra: %', p_change_order_id using errcode = '42704';
  end if;
  if v_owner is distinct from auth.uid() then
    raise exception 'not your extra' using errcode = '42501';
  end if;

  -- EVER SENT is the question, not "is it sent now". A request that was
  -- superseded still went out, and someone still read it.
  select count(*) into v_sent
    from public.confirmation_request cr where cr.decision_id = v_decision;
  if v_sent > 0 then
    raise exception 'this extra was sent; retire it with a revision instead'
      using errcode = '42501';
  end if;

  for r in
    select dv.capture_id,
           (select count(*) from public.change_order c2
             where c2.decision_id = dv.decision_id) as used_by,
           c.payload as object_key
      from public.decision_version dv
      join public.capture c on c.id = dv.capture_id
     where dv.decision_id = v_decision and dv.capture_id is not null
     group by dv.capture_id, dv.decision_id, c.payload
  loop
    if r.used_by > 1 then
      -- Shared with a sibling extra. Not ours to destroy.
      n_kept := n_kept + 1;
      continue;
    end if;

    insert into public.capture_discarded (capture_id, change_order_id, owner_id)
      values (r.capture_id, p_change_order_id, v_owner)
      on conflict (capture_id) do nothing;

    -- The bytes. Guarded by to_regclass because a database without the storage
    -- extension (a test harness, a local instance) must still be able to run
    -- this migration and this function -- silently skipping is correct there,
    -- and the tombstone above still records the intent.
    if to_regclass('storage.objects') is not null then
      execute 'delete from storage.objects where bucket_id = $1 and name = $2'
        using 'captures', r.object_key;
      n_bytes := n_bytes + 1;
    end if;
  end loop;

  -- Last, so a failure above leaves the extra visible rather than leaving
  -- orphaned tombstones pointing at an extra that no longer exists.
  delete from public.change_order where id = p_change_order_id;

  return jsonb_build_object(
    'discarded', n_bytes, 'kept_shared', n_kept, 'change_order', p_change_order_id);
end $$;

revoke all on function public.discard_extra_own from public, anon;
grant execute on function public.discard_extra_own to authenticated;
