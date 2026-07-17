-- Decisions on the server — REQ-VAL5/VAL6.
--
-- WHY THIS EXISTS: change_order.decision_id was pointing at nothing. The cloud
-- had priced, signed change orders whose DECISION -- the record of what was
-- actually decided and why it changed -- existed on exactly one phone. CLAUDE.md
-- names the "jobsite decision moment" as the atomic unit; that unit had no cloud
-- copy, so losing a phone lost the provenance of money that had already been
-- signed for. Mandate #1 permits a stated residual-loss boundary for total device
-- loss, but this was not stated, it was overlooked.
--
-- THE SHAPE MIRRORS THE DEVICE, deliberately: identity + an append-only chain.
--   decision          -- subject never changes; if the subject changes it is a
--                        different decision
--   decision_version  -- append-only; the NEWEST row IS the current value
-- `current_value` is derived, never stored, on both sides. A stored "current" can
-- drift from the chain; the chain cannot disagree with itself.
--
-- ORDER-TOLERANT BY CONSTRUCTION: a version's place in the chain comes from its
-- own created_at_ms, not from when it arrived. Versions may sync out of order,
-- days apart, from a phone that was in a basement -- the chain still reads
-- correctly. This is why there is no sequence number to get wrong.

create table if not exists public.decision (
  id            text primary key,
  project_id    text not null,
  owner_id      uuid not null,
  subject       text not null check (length(subject) > 0),
  -- REQ-VAL6: defaulted, never a form the user fills in.
  scope_level   text not null default 'project' check (scope_level in ('project','party')),
  assignee      text,
  created_at_ms bigint not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.decision_version (
  id            text primary key,
  decision_id   text not null references public.decision(id),
  value         text not null check (length(value) > 0),
  -- the capture that produced this value: the evidence for WHY it changed.
  -- NOT a foreign key to capture: a decision's version may sync before its
  -- capture's media finishes uploading, and a decision must never be blocked
  -- waiting on a blob. Integrity is reported (see decision_orphans), not enforced
  -- by an ordering dependency between two independent queues.
  capture_id    text,
  -- REQ-VAL4: who directed it. Explicit and defaulted, never inferred from audio.
  directed_by   text,
  created_at_ms bigint not null,
  created_at    timestamptz not null default now()
);

create index if not exists decision_version_chain
  on public.decision_version (decision_id, created_at_ms desc);

-- History is the product. It is never rewritten and never destroyed.
create or replace function public.decision_append_only() returns trigger
  language plpgsql as $$ begin
    raise exception 'decision history is append-only: % blocked', tg_op;
  end $$;
drop trigger if exists decision_version_immutable on public.decision_version;
create trigger decision_version_immutable before update or delete
  on public.decision_version for each row execute function public.decision_append_only();

alter table public.decision         enable row level security;
alter table public.decision_version enable row level security;
drop policy if exists dec_own on public.decision;
create policy dec_own on public.decision for select to authenticated
  using (owner_id = auth.uid());
drop policy if exists decv_own on public.decision_version;
create policy decv_own on public.decision_version for select to authenticated
  using (exists (select 1 from public.decision d
                  where d.id = decision_version.decision_id and d.owner_id = auth.uid()));

-- Writes go through the RPC only, so the client cannot bypass the append-only law
-- by inserting a "corrected" version directly.
revoke insert, update, delete on public.decision         from authenticated;
revoke insert, update, delete on public.decision_version from authenticated;

-- The decision idempotency ledger. Separate from capture_mutation on purpose --
-- see ingest_decision_v1 below.
create table if not exists public.decision_mutation (
  mutation_id    text primary key,
  request_sha256 text not null,
  applied_at     timestamptz not null default now()
);
alter table public.decision_mutation enable row level security;

-- ---------------------------------------------------------------------------
-- ONE RPC for decision + version. Same rule as ingest_capture_v1: never two
-- requests. Two requests permit "decision accepted, version rejected", which
-- would put a decision on the server with no value -- a subject with nothing
-- decided about it.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_decision_v1(
  p_mutation_id text,
  p_decision_id text,
  p_version_id  text,
  p_project_id  text,
  p_owner_id    uuid,
  p_subject     text,
  p_scope_level text,
  p_assignee    text,
  p_value       text,
  p_capture_id  text,
  p_directed_by text,
  p_created_at_ms bigint,
  p_request_sha256 text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare prior text;
begin
  if p_owner_id <> auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  -- Idempotency: a retry after a crash re-sends the SAME mutation_id and gets the
  -- original answer back instead of appending the version twice. A DIFFERENT
  -- payload under the same id is a real conflict and must be refused, never
  -- silently accepted.
  --
  -- This has its OWN ledger. The first cut reused capture_mutation and failed on
  -- its NOT NULL capture_id -- correctly: a decision mutation is not a capture
  -- mutation and has no capture. Widening capture_mutation to fit would have
  -- weakened a constraint the capture path depends on, to store a column that is
  -- meaningless here. Two ledgers, each with its own invariant intact.
  select request_sha256 into prior from public.decision_mutation where mutation_id = p_mutation_id;
  if found then
    if prior is distinct from p_request_sha256 then
      raise exception 'mutation % replayed with a different payload', p_mutation_id
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','decision_id',p_decision_id);
  end if;

  -- The decision's identity is created once. Its subject never changes, so a
  -- second arrival is a no-op rather than an update -- there is nothing to move.
  insert into public.decision (id, project_id, owner_id, subject, scope_level, assignee, created_at_ms)
  values (p_decision_id, p_project_id, p_owner_id, p_subject,
          coalesce(p_scope_level,'project'), p_assignee, p_created_at_ms)
  on conflict (id) do nothing;

  insert into public.decision_version (id, decision_id, value, capture_id, directed_by, created_at_ms)
  values (p_version_id, p_decision_id, p_value, p_capture_id, p_directed_by, p_created_at_ms)
  on conflict (id) do nothing;

  insert into public.decision_mutation (mutation_id, request_sha256)
  values (p_mutation_id, p_request_sha256);

  return jsonb_build_object('status','applied','decision_id',p_decision_id);
end $$;

revoke all on function public.ingest_decision_v1 from public, anon;
grant execute on function public.ingest_decision_v1 to authenticated;

-- ---------------------------------------------------------------------------
-- Integrity is REPORTED, not enforced by a foreign key.
--
-- A hard FK on change_order.decision_id would couple two independent queues: a
-- change order whose decision had not synced yet would fail with 23503, which
-- the uploader classifies as PERMANENT and would PARK FOREVER. That turns a
-- normal ordering race -- entirely expected on a phone that syncs from a
-- basement -- into permanent data loss. The queues stay independent; orphans
-- surface here instead of detonating.
-- ---------------------------------------------------------------------------
create or replace view public.decision_orphans as
select co.id as change_order_id, co.decision_id, co.project_id, co.created_at
  from public.change_order co
 where co.decision_id is not null
   and not exists (select 1 from public.decision d where d.id = co.decision_id);

-- Current state, derived. Mirrors listDecisions() on the device.
create or replace view public.decision_current as
select d.id, d.project_id, d.owner_id, d.subject, d.scope_level, d.assignee,
       v.value as current_value, v.directed_by, v.capture_id,
       v.created_at_ms as last_changed_ms,
       (select count(*) from public.decision_version x where x.decision_id = d.id) as version_count
  from public.decision d
  join public.decision_version v on v.decision_id = d.id
 where v.created_at_ms = (select max(created_at_ms) from public.decision_version w
                           where w.decision_id = d.id);
