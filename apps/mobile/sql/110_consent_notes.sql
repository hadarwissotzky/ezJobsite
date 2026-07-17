-- Consent on the project, and notes that reach the cloud.
--
-- TWO DEVICE-LOCAL SEAMS I NAMED AND LEFT OPEN. Both mattered more than "sync
-- would be nice":
--
-- 1. RECORDING CONSENT was in a device-local table. A second phone on the same job
--    did not know the decision -- so a job where the owner said "no recording"
--    would happily record on the foreman's phone. A legal control that only one
--    device enforces is not a control. It also contradicted the spec's own data
--    model, which puts recording_consent_state on Project.
--
-- 2. NOTES (REQ-CAP3) never left the device, so they never reached the DISPUTE
--    BUNDLE. A note is often the only thing that explains a photo -- "this is the
--    crack he says we caused; it was here before we started" -- and the bundle is
--    the one artefact where that sentence earns its keep.

alter table public.project add column if not exists recording_consent     text;
alter table public.project add column if not exists consent_basis         text;
alter table public.project add column if not exists consent_jurisdiction  text;
alter table public.project add column if not exists consent_decided_at_ms bigint;
alter table public.project add column if not exists consent_decided_by    text;

alter table public.project drop constraint if exists project_consent_known;
alter table public.project add constraint project_consent_known check (
  recording_consent is null
  or recording_consent in ('all_party','one_party','no_recording')
);

-- Notes are append-only evidence of what a person believed, exactly like decision
-- versions. A note written in March must never overwrite one from January.
create table if not exists public.capture_note (
  id            text primary key,
  capture_id    text not null,
  owner_id      uuid not null,
  body          text not null check (length(body) > 0),
  author        text,
  created_at_ms bigint not null,
  created_at    timestamptz not null default now()
);

create index if not exists capture_note_by_capture
  on public.capture_note (capture_id, created_at_ms desc);

create or replace function public.capture_note_append_only() returns trigger
  language plpgsql as $$ begin
    raise exception 'notes are append-only: % blocked', tg_op;
  end $$;
drop trigger if exists capture_note_immutable on public.capture_note;
create trigger capture_note_immutable before update or delete
  on public.capture_note for each row execute function public.capture_note_append_only();

alter table public.capture_note enable row level security;
drop policy if exists note_own on public.capture_note;
create policy note_own on public.capture_note for select to authenticated
  using (owner_id = auth.uid());
revoke insert, update, delete on public.capture_note from authenticated;

create table if not exists public.note_mutation (
  mutation_id    text primary key,
  request_sha256 text not null,
  applied_at     timestamptz not null default now()
);
alter table public.note_mutation enable row level security;

create or replace function public.ingest_note_v1(
  p_mutation_id text, p_id text, p_capture_id text, p_owner_id uuid,
  p_body text, p_author text, p_created_at_ms bigint, p_request_sha256 text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare prior text;
begin
  -- NULL-SAFE: `p_owner_id <> auth.uid()` silently passes when auth.uid() is null.
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  select request_sha256 into prior from public.note_mutation where mutation_id = p_mutation_id;
  if found then
    if prior is distinct from p_request_sha256 then
      raise exception 'mutation % replayed with a different payload', p_mutation_id
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','id',p_id);
  end if;

  insert into public.capture_note (id, capture_id, owner_id, body, author, created_at_ms)
  values (p_id, p_capture_id, p_owner_id, p_body, p_author, p_created_at_ms)
  on conflict (id) do nothing;

  insert into public.note_mutation (mutation_id, request_sha256)
  values (p_mutation_id, p_request_sha256);

  return jsonb_build_object('status','applied','id',p_id);
end $$;

revoke all on function public.ingest_note_v1 from public, anon;
grant execute on function public.ingest_note_v1 to authenticated;
