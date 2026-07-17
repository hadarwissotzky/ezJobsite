-- Parties and scope boundaries reach the cloud — REQ-VAL7.
--
-- WHY: the air-handler record was device-local. A boundary is, by definition, a
-- thing TWO PARTIES disagree about — so a record only the person who typed it can
-- see is worth almost nothing. The GC needs to see that nobody owns the whip; the
-- office needs it in the dispute bundle; the sub needs to know what he was
-- assigned. One phone knowing is not a record, it is a note-to-self.

create table if not exists public.project_party (
  id            text primary key,
  project_id    text not null,
  owner_id      uuid not null,
  name          text not null check (length(name) > 0),
  -- "trade", NOT "role" -- Member.role is office/field/sub. The spec renamed this
  -- to stop the exact confusion that makes one trade assume the other had it.
  trade         text not null,
  scope_of_work text,
  status        text not null default 'active' check (status in ('active','removed')),
  created_at_ms bigint not null
);

create table if not exists public.scope_boundary (
  id            text primary key,
  project_id    text not null,
  owner_id      uuid not null,
  subject       text not null check (length(subject) > 0),
  trades        jsonb not null default '[]'::jsonb,
  -- null = NOBODY HAS SAID. That null is the entire point of the table: an
  -- unassigned boundary must be listable, and you cannot list an absence.
  decision_id   text,
  created_at_ms bigint not null
);

create index if not exists party_by_project on public.project_party (project_id);
create index if not exists boundary_by_project on public.scope_boundary (project_id);

alter table public.project_party  enable row level security;
alter table public.scope_boundary enable row level security;
drop policy if exists party_own on public.project_party;
create policy party_own on public.project_party for select to authenticated
  using (owner_id = auth.uid());
drop policy if exists boundary_own on public.scope_boundary;
create policy boundary_own on public.scope_boundary for select to authenticated
  using (owner_id = auth.uid());
revoke insert, update, delete on public.project_party  from authenticated;
revoke insert, update, delete on public.scope_boundary from authenticated;

create table if not exists public.party_mutation (
  mutation_id text primary key, request_sha256 text not null,
  applied_at timestamptz not null default now()
);
alter table public.party_mutation enable row level security;

-- ONE RPC for a party OR a boundary. The assignment is NOT here: it is a decision,
-- and it already syncs through ingest_decision_v1. Duplicating it would create a
-- second copy of the answer that can disagree with the chain -- and the chain is
-- what a dispute turns on.
create or replace function public.ingest_scope_v1(
  p_mutation_id text, p_kind text, p_id text, p_project_id text, p_owner_id uuid,
  p_name text, p_trade text, p_scope_of_work text, p_subject text,
  p_trades jsonb, p_decision_id text, p_created_at_ms bigint, p_request_sha256 text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare prior text;
begin
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  select request_sha256 into prior from public.party_mutation where mutation_id = p_mutation_id;
  if found then
    if prior is distinct from p_request_sha256 then
      raise exception 'mutation % replayed with a different payload', p_mutation_id
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','id',p_id);
  end if;

  if p_kind = 'party' then
    insert into public.project_party (id, project_id, owner_id, name, trade, scope_of_work, created_at_ms)
    values (p_id, p_project_id, p_owner_id, p_name, p_trade, p_scope_of_work, p_created_at_ms)
    on conflict (id) do nothing;
  elsif p_kind = 'boundary' then
    -- A boundary's ASSIGNMENT can change (decision_id appears when someone finally
    -- answers), so this one upserts that column and nothing else. The subject
    -- never changes: a different subject is a different boundary.
    insert into public.scope_boundary (id, project_id, owner_id, subject, trades, decision_id, created_at_ms)
    values (p_id, p_project_id, p_owner_id, p_subject, coalesce(p_trades,'[]'::jsonb),
            p_decision_id, p_created_at_ms)
    on conflict (id) do update set decision_id = excluded.decision_id
      where public.scope_boundary.decision_id is null;
  else
    raise exception 'unknown kind %', p_kind using errcode = '23514';
  end if;

  insert into public.party_mutation (mutation_id, request_sha256)
  values (p_mutation_id, p_request_sha256);
  return jsonb_build_object('status','applied','id',p_id);
end $$;

revoke all on function public.ingest_scope_v1 from public, anon;
grant execute on function public.ingest_scope_v1 to authenticated;

-- The gap list, server-side: what nobody owns. This is the query an office would
-- run on a Monday, and the one the dispute bundle should carry.
create or replace view public.scope_gaps as
select b.project_id, b.id as boundary_id, b.subject, b.trades, b.created_at_ms
  from public.scope_boundary b
 where b.decision_id is null;
