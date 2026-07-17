-- Change orders arrive from the device's outbox, not from a direct insert.
--
-- WHY: createChangeOrder() called supabase.from('change_order').insert() —
-- a direct write that REQUIRES CONNECTIVITY. Captures and decisions were
-- local-first; the money was not. Mandate #7 calls offline-forward "paramount"
-- and mandate #1 says never lose a capture, yet a contractor in a basement could
-- record the decision and then lose the price on a failed insert. Worse, the CO
-- list was read straight from the server, so offline it rendered EMPTY: you could
-- not even see the change orders you already had.
--
-- The device is now the author. This RPC is how the copy arrives.

create table if not exists public.change_order_mutation (
  mutation_id    text primary key,
  request_sha256 text not null,
  applied_at     timestamptz not null default now()
);
alter table public.change_order_mutation enable row level security;

-- The client may no longer insert change orders directly. The RPC is the only
-- door, so mandate #6 (numbers_confirmed_at) and ownership are enforced in one
-- place instead of trusted from a client that could skip them.
revoke insert on public.change_order from authenticated;

create or replace function public.ingest_change_order_v1(
  p_mutation_id   text,
  p_id            text,
  p_decision_id   text,
  p_project_id    text,
  p_owner_id      uuid,
  p_scope         text,
  p_line_items    jsonb,
  p_amount_cents  bigint,
  p_nte_cents     bigint,
  p_is_mini       integer,
  p_who_directed  text,
  p_ref_estimate  text,
  p_numbers_confirmed_at_ms bigint,
  p_created_at_ms bigint,
  p_request_sha256 text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare prior text;
begin
  -- NULL-SAFE ON PURPOSE. `p_owner_id <> auth.uid()` is a TRAP: when auth.uid()
  -- is NULL the comparison yields NULL, the IF never fires, and the ownership
  -- check SILENTLY PASSES. Proven, not theorised -- a call with a bogus owner and
  -- no JWT sailed straight past this line into the validation below. `is distinct
  -- from` is null-safe, and auth.uid() is checked explicitly so a missing JWT is
  -- refused loudly instead of being treated as "no objection".
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  -- MANDATE #6, enforced at the door rather than hoped for: a change order whose
  -- number no human confirmed cannot exist on the server, whatever the client says.
  if p_numbers_confirmed_at_ms is null then
    raise exception 'numbers_confirmed_at is required: an unconfirmed price may never be stored'
      using errcode = '23514';
  end if;

  select request_sha256 into prior from public.change_order_mutation where mutation_id = p_mutation_id;
  if found then
    if prior is distinct from p_request_sha256 then
      raise exception 'mutation % replayed with a different payload', p_mutation_id
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','id',p_id);
  end if;

  -- `do nothing`, never `do update`: a change order that already landed is not
  -- re-authored by a retry. If it was already sent or signed, the guard trigger
  -- would refuse the update anyway -- and it should.
  insert into public.change_order (id, decision_id, project_id, owner_id, scope,
    line_items, amount_cents, nte_cents, is_mini, who_directed, ref_estimate,
    numbers_confirmed_at, status, created_at)
  values (p_id, p_decision_id, p_project_id, p_owner_id, p_scope,
    coalesce(p_line_items, '[]'::jsonb), p_amount_cents, p_nte_cents,
    coalesce(p_is_mini, 0), p_who_directed, p_ref_estimate,
    to_timestamp(p_numbers_confirmed_at_ms / 1000.0),
    'draft', to_timestamp(p_created_at_ms / 1000.0))
  on conflict (id) do nothing;

  insert into public.change_order_mutation (mutation_id, request_sha256)
  values (p_mutation_id, p_request_sha256);

  return jsonb_build_object('status','applied','id',p_id);
end $$;

revoke all on function public.ingest_change_order_v1 from public, anon;
grant execute on function public.ingest_change_order_v1 to authenticated;
