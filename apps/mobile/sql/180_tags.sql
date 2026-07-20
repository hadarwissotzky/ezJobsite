-- User tags on captures reach the cloud — REQ-GAL3 (PRD-companycam-parity §5.C).
--
-- Mirrors capture_note (110_consent_notes.sql): append-only evidence, owned-outbox
-- transport, idempotent ingest keyed by mutation_id. The one shape difference is
-- `action` ('add' | 'retract') instead of a body: a tag is never DELETEd, it is
-- retracted with an appended event, so the whole "it was tagged then untagged"
-- history survives (mandate #1). Current tags = those whose latest event is 'add'.

create table if not exists public.capture_tag (
  id            text primary key,
  capture_id    text not null,
  owner_id      uuid not null,
  tag           text not null check (length(tag) > 0),
  action        text not null check (action in ('add','retract')),
  author        text,
  created_at_ms bigint not null,
  created_at    timestamptz not null default now()
);

create index if not exists capture_tag_by_capture
  on public.capture_tag (capture_id, tag, created_at_ms desc);

create or replace function public.capture_tag_append_only() returns trigger
  language plpgsql as $$ begin
    raise exception 'tag events are append-only: % blocked', tg_op;
  end $$;
drop trigger if exists capture_tag_immutable on public.capture_tag;
create trigger capture_tag_immutable before update or delete
  on public.capture_tag for each row execute function public.capture_tag_append_only();

alter table public.capture_tag enable row level security;
drop policy if exists tag_own on public.capture_tag;
create policy tag_own on public.capture_tag for select to authenticated
  using (owner_id = auth.uid());
revoke insert, update, delete on public.capture_tag from authenticated;

create table if not exists public.tag_mutation (
  mutation_id    text primary key,
  request_sha256 text not null,
  applied_at     timestamptz not null default now()
);
alter table public.tag_mutation enable row level security;

create or replace function public.ingest_tag_v1(
  p_mutation_id text, p_id text, p_capture_id text, p_owner_id uuid,
  p_tag text, p_action text, p_author text, p_created_at_ms bigint, p_request_sha256 text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare prior text;
begin
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  select request_sha256 into prior from public.tag_mutation where mutation_id = p_mutation_id;
  if found then
    if prior is distinct from p_request_sha256 then
      raise exception 'mutation % replayed with a different payload', p_mutation_id
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','id',p_id);
  end if;

  insert into public.capture_tag (id, capture_id, owner_id, tag, action, author, created_at_ms)
  values (p_id, p_capture_id, p_owner_id, p_tag, p_action, p_author, p_created_at_ms)
  on conflict (id) do nothing;

  insert into public.tag_mutation (mutation_id, request_sha256)
  values (p_mutation_id, p_request_sha256);

  return jsonb_build_object('status','applied','id',p_id);
end $$;

revoke all on function public.ingest_tag_v1 from public, anon;
grant execute on function public.ingest_tag_v1 to authenticated;
