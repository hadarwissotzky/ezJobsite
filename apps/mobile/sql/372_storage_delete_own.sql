-- 372: delete reaches the bucket THE WAY SUPABASE ALLOWS.
--
-- WHY, from the device's own flight recorder, one line, every tick:
--   "Direct deletion from storage tables is not allowed. Use the Storage API
--    instead."
-- 371 did `delete from storage.objects` inside the RPC, and Supabase forbids
-- SQL deletes on storage tables outright — the platform keeps file bytes and
-- metadata in sync through its Storage API and refuses the shortcut. So the
-- drain called, the RPC failed, nothing was ever confirmed, and the same fifty
-- tombstones retried forever. The design was wrong for this host, not the code.
--
-- THE SANCTIONED SHAPE, split across the trust boundary where each side is
-- strong: the RPC keeps every guard (ownership, ever-sent evidence) and the
-- tombstone, and RETURNS THE APPROVED OBJECT KEYS instead of deleting; the
-- CLIENT removes them through the Storage API, held to its own folder by the
-- delete policy below. A client cannot delete what the RPC did not approve
-- (policy scopes it to its own uid folder) and cannot skip the tombstone
-- (the RPC writes it before returning the key).
--
-- OWNERSHIP: the policy is created only here; discard_captures_own is REPLACED
-- here and 371 is superseded (single-ownership: 371 stays in history as the
-- creator, this file is now the definition).

-- The delete half of what 011 started: a user may remove objects in their OWN
-- folder. Same foldername rule as insert/read, so the three policies agree.
drop policy if exists captures_delete_own on storage.objects;
create policy captures_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.discard_captures_own(p_capture_ids text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r         record;
  keys      text[] := '{}';
  n_kept    int := 0;
  n_missing int := 0;
begin
  if p_capture_ids is null or array_length(p_capture_ids, 1) is null then
    return jsonb_build_object('keys', to_jsonb(keys), 'kept', 0, 'missing', 0);
  end if;

  for r in
    select c.id, c.owner_id, c.payload as object_key
      from unnest(p_capture_ids) as want(id)
      left join public.capture c on c.id = want.id
  loop
    if r.owner_id is null then n_missing := n_missing + 1; continue; end if;
    if r.owner_id is distinct from auth.uid() then n_kept := n_kept + 1; continue; end if;
    if exists (
      select 1 from public.decision_version dv
        join public.confirmation_request cr on cr.decision_id = dv.decision_id
       where dv.capture_id = r.id
    ) then n_kept := n_kept + 1; continue; end if;

    insert into public.capture_discarded (capture_id, change_order_id, owner_id)
      values (r.id, 'capture', r.owner_id)
      on conflict (capture_id) do nothing;
    keys := keys || r.object_key;
  end loop;

  return jsonb_build_object('keys', to_jsonb(keys), 'kept', n_kept, 'missing', n_missing);
end $$;

revoke all on function public.discard_captures_own from public, anon;
grant execute on function public.discard_captures_own to authenticated;
