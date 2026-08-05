-- 389 — discard_extra_own stops deleting storage objects in SQL.
--
-- THE SAME PLATFORM LAW 372 ALREADY LEARNED, in the one function that never got
-- the lesson. Supabase refuses SQL deletes on storage tables:
--   "Direct deletion from storage tables is not allowed. Use the Storage API
--    instead."
-- 369's `execute 'delete from storage.objects ...'` raised that on every call
-- with photos attached. Because the raise happened INSIDE the function, the
-- whole transaction rolled back -- so the change_order row and the
-- capture_discarded tombstones did not survive either. From the phone it read
-- as "delete does nothing", forever, with drainDiscardedExtras retrying the
-- same doomed call every tick (hadar, 2026-08-05, flight recorder:
--   ddrain.extra  co-cap-...: Direct deletion from storage tables is not allowed).
--
-- 371 hit this exact wall and 372 answered it: the RPC AUTHORIZES (guards +
-- tombstone) and RETURNS the approved object keys; the CLIENT removes the bytes
-- through the Storage API, fenced by 372's own-folder delete policy. This
-- applies that answer to the extra path. A key the RPC did not return cannot be
-- deleted by the client, and a key it did return is already tombstoned here.
--
-- Every guard from 369 is preserved verbatim -- ownership, ever-sent, shared
-- captures. The ONLY change is that bytes are named instead of destroyed, and
-- `keys` is added to the returned object. `discarded` keeps its meaning: the
-- number of captures whose bytes this call authorized for removal.

create or replace function public.discard_extra_own(p_change_order_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner    uuid;
  v_decision text;
  v_sent     int;
  r          record;
  keys       text[] := '{}';
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

    -- NAMED, NOT DELETED. The tombstone above is the authorization; the client
    -- turns it into absent bytes. A null payload (a capture with no object) is
    -- skipped rather than passed on as a null key the Storage API would reject.
    if r.object_key is not null then
      keys := keys || r.object_key;
    end if;
  end loop;

  -- Last, so a failure above leaves the extra visible rather than leaving
  -- orphaned tombstones pointing at an extra that no longer exists.
  delete from public.change_order where id = p_change_order_id;

  return jsonb_build_object(
    'keys', to_jsonb(keys),
    'discarded', coalesce(array_length(keys, 1), 0),
    'kept_shared', n_kept,
    'change_order', p_change_order_id);
end $$;

revoke all on function public.discard_extra_own from public, anon;
grant execute on function public.discard_extra_own to authenticated;
