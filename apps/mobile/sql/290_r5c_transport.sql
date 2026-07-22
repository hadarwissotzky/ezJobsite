-- 290_r5c_transport.sql
--
-- R5c CHANGES REACH THE SERVER. Closing codex #3, #4 and #5, which were one gap.
--
-- 280 created the roster table and the extra_type column. Nothing carried anything
-- into them. The device enqueued roster additions into an outbox with no drain, no
-- RPC and no server ingest, so:
--   #3  a roster added offline stayed on that phone forever. A second device saw an
--       empty roster and suggested nobody.
--   #4  setExtraType wrote local SQLite only. change_order_outbox payloads carry no
--       extra_type and ingest_change_order_v1 takes no such parameter, so the type
--       the contractor picked never left the handset.
--   #5  retireApprover and markApproverUsed were local-only, so phone B kept
--       suggesting someone phone A had retired, and "who you last sent to" differed
--       per device. For a value that decides who a priced commitment is addressed
--       to, device-dependent state is not a cosmetic problem.
--
-- ONE RPC, FOUR KINDS, mirroring ingest_scope_v1 (120_parties.sql) rather than
-- inventing a fifth transport shape. Idempotent through r5c_mutation: a reply lost
-- on the wire replays safely, and a replay carrying a DIFFERENT payload is an error
-- rather than a silent overwrite.
--
-- WHY extra_type IS ITS OWN MUTATION and not a new parameter on
-- ingest_change_order_v1: the type is chosen AFTER the extra exists, on the preview
-- card. Folding it into the creation payload would only ever sync a type that
-- happened to be set before the outbox drained -- a race dressed as a design. It is
-- also not part of the frozen instrument: scope and price are frozen at send
-- (change_order_guard), the type is a routing label and stays editable.

create table if not exists public.r5c_mutation (
  mutation_id    text primary key,
  request_sha256 text not null,
  applied_at     timestamptz not null default now()
);
alter table public.r5c_mutation enable row level security;

create or replace function public.ingest_r5c_v1(
  p_mutation_id text, p_kind text, p_id text, p_owner_id uuid,
  p_project_id text, p_name text, p_role text,
  p_phone_e164 text, p_email text, p_can_bind_money boolean,
  p_extra_type text, p_at_ms bigint, p_created_at_ms bigint,
  p_request_sha256 text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare prior text;
begin
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  select request_sha256 into prior from public.r5c_mutation where mutation_id = p_mutation_id;
  if found then
    if prior is distinct from p_request_sha256 then
      raise exception 'mutation % replayed with a different payload', p_mutation_id
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','id',p_id);
  end if;

  if p_kind = 'add' then
    insert into public.project_approver
      (id, project_id, owner_id, name, role, phone_e164, email, can_bind_money,
       last_used_ms, created_at_ms)
    values (p_id, p_project_id, p_owner_id, p_name, p_role, p_phone_e164, p_email,
            p_can_bind_money, 0, p_created_at_ms)
    on conflict (id) do nothing;

  elsif p_kind = 'retire' then
    -- Scoped to the caller's own rows. SECURITY DEFINER bypasses RLS, so every
    -- write here states the owner check itself rather than inheriting one.
    update public.project_approver
       set status = 'removed'
     where id = p_id and owner_id = p_owner_id and status = 'active';

  elsif p_kind = 'used' then
    -- NEVER WALK RECENCY BACKWARDS. Devices drain out of order routinely; an older
    -- send arriving second must not make someone look more recently used than a
    -- newer one already did. last_used_ms decides who gets suggested next.
    update public.project_approver
       set last_used_ms = p_at_ms
     where id = p_id and owner_id = p_owner_id
       and last_used_ms < p_at_ms;

  elsif p_kind = 'type' then
    -- The CHECK constraint from 280 validates the value; null clears it, which is a
    -- legitimate state (R5c: an untyped extra is a normal extra).
    update public.change_order
       set extra_type = p_extra_type
     where id = p_id and owner_id = p_owner_id;

  else
    raise exception 'unknown kind %', p_kind using errcode = '23514';
  end if;

  insert into public.r5c_mutation (mutation_id, request_sha256)
  values (p_mutation_id, p_request_sha256);

  return jsonb_build_object('status','applied','id',p_id);
end $$;

revoke all on function public.ingest_r5c_v1 from public, anon;
grant execute on function public.ingest_r5c_v1 to authenticated;
