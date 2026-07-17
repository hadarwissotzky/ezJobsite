-- Projects — REQ-SET1, REQ-PROC7.
--
-- WHY: public.project had id/owner/name/status and nothing else, and the DEVICE
-- had no project model at all -- PROJECT_ID was a hardcoded string in App.tsx.
-- Every capture, decision and change order was filed to 'proj-bakeoff-1' because
-- that constant was typed there. Mandate #8 says "captures auto-assign to the
-- right project with zero manual filing"; there was nothing to assign to.
--
-- REQ-SET1 wants "address/geofence/client so resolution and evidence have a home".

alter table public.project add column if not exists address     text;
alter table public.project add column if not exists lat         double precision;
alter table public.project add column if not exists lng         double precision;
alter table public.project add column if not exists geofence_m  integer default 150;
alter table public.project add column if not exists client_ref  text;
alter table public.project add column if not exists created_at  timestamptz default now();

-- Same honesty rule as the capture stamp: a location is real or absent, never
-- 0,0 -- which is a spot in the Gulf of Guinea, and would put a jobsite there.
alter table public.project drop constraint if exists project_gps_sane;
alter table public.project add constraint project_gps_sane check (
  (lat is null and lng is null)
  or (lat between -90 and 90 and lng between -180 and 180 and not (lat = 0 and lng = 0))
);

create table if not exists public.project_mutation (
  mutation_id    text primary key,
  request_sha256 text not null,
  applied_at     timestamptz not null default now()
);
alter table public.project_mutation enable row level security;

create or replace function public.ingest_project_v1(
  p_mutation_id text, p_id text, p_owner_id uuid, p_name text,
  p_address text, p_lat double precision, p_lng double precision,
  p_client_ref text, p_created_at_ms bigint, p_request_sha256 text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare prior text;
begin
  -- NULL-SAFE. `p_owner_id <> auth.uid()` silently passes when auth.uid() is null.
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  select request_sha256 into prior from public.project_mutation where mutation_id = p_mutation_id;
  if found then
    if prior is distinct from p_request_sha256 then
      raise exception 'mutation % replayed with a different payload', p_mutation_id
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','id',p_id);
  end if;

  insert into public.project (id, owner_id, name, address, lat, lng, client_ref,
                              status, created_at)
  values (p_id, p_owner_id, p_name, p_address, p_lat, p_lng, p_client_ref,
          'active', to_timestamp(p_created_at_ms / 1000.0))
  on conflict (id) do nothing;

  insert into public.project_mutation (mutation_id, request_sha256)
  values (p_mutation_id, p_request_sha256);

  return jsonb_build_object('status','applied','id',p_id);
end $$;

revoke all on function public.ingest_project_v1 from public, anon;
grant execute on function public.ingest_project_v1 to authenticated;

-- THE COLUMNS THE CLIENT ACTUALLY SENDS.
--
-- AppSchema declares created_at_ms and last_used_ms (integers -- the SDK rule is
-- ISO dates as text or epoch ints, and epoch ints are what the device already
-- uses everywhere). I added only `created_at timestamptz` here, so the client sent
-- a column the server did not have. PostgREST answered:
--   "Could not find the 'created_at_ms' column of 'project' in the schema cache"
-- which is PGRST204 -- NOT a Postgres SQLSTATE, so it fell through the connector's
-- fatal-code check, threw, and tx.complete() never ran. THE ENTIRE POWERSYNC
-- UPLOAD QUEUE STALLED at 25 ops while the app cheerfully said "saved ✓".
--
-- The lesson is bigger than two columns: the PowerSync schema and the Postgres
-- schema are ONE contract in two files, and nothing checks that they agree. A
-- column added on one side and forgotten on the other is a SILENT, PERMANENT sync
-- outage -- not an error the user or the developer ever sees.
alter table public.project add column if not exists created_at_ms bigint;
alter table public.project add column if not exists last_used_ms  bigint;

-- Backfill so existing rows are consistent with what the client expects.
update public.project set created_at_ms = (extract(epoch from created_at) * 1000)::bigint
 where created_at_ms is null and created_at is not null;

-- COLUMN-LEVEL UPDATE, and why this exists at all.
--
-- PowerSync's uploadData upserts (Prefer: resolution=merge-duplicates), which needs
-- UPDATE as well as INSERT. `authenticated` had no UPDATE on project because the
-- bakeoff predeclared `status` as SERVER-owned and revoked table-wide UPDATE to
-- prove a client could not touch it (Q2).
--
-- The result was a silent hole: every job created on a device upserted, got
-- 42501 "permission denied for table project", and -- because 42501 IS in the
-- connector's fatal set -- WAS SILENTLY DISCARDED. The job existed on the phone,
-- the app said saved, and it never reached the cloud. Nothing told anyone.
--
-- Table-wide GRANT UPDATE would fix the symptom and throw away the Q2 protection.
-- Column-level grants keep both: the client may update the fields it OWNS, and
-- `status` stays server-owned and still refuses.
grant update (
  name, address, lat, lng, geofence_m, client_ref, created_at_ms, last_used_ms,
  recording_consent, consent_basis, consent_jurisdiction, consent_decided_at_ms,
  consent_decided_by, updated_at
) on public.project to authenticated;

-- `status` and `owner_id` are deliberately NOT in that list. RLS still scopes every
-- row to its owner; this stops a client rewriting who owns a job or archiving one
-- the server considers active.

-- ============================================================================
-- Q2's PROTECTION AND POWERSYNC'S UPLOAD ARE INCOMPATIBLE AS ORIGINALLY BUILT.
--
-- The bakeoff enforced "status is SERVER-owned" by REVOKING table UPDATE from
-- `authenticated`. PowerSync's uploadData upserts (Prefer: resolution=merge-
-- duplicates), and PostgREST requires TABLE-LEVEL UPDATE for an upsert -- column
-- level is not enough. Proven, not guessed: an upsert carrying no `status` at all
-- still returned
--     42501  permission denied for table project
--     hint:  GRANT UPDATE ON public.project TO authenticated
--
-- So EVERY job created on a device was refused and -- because 42501 is in the
-- connector's fatal set -- SILENTLY DISCARDED. Created on the phone, "saved ✓",
-- gone. No error, no backlog, nothing to notice. That is the worst shape a bug
-- takes: it looks like success.
--
-- Two ways out, and only one keeps the guarantee:
--   * grant table UPDATE and give up on server-owned status  -> loses Q2
--   * grant table UPDATE and enforce status with a TRIGGER   -> keeps Q2
-- The trigger is the mechanism that survives contact with the tool we adopted.
-- A GRANT is a coarse instrument; the invariant was never "the client cannot run
-- UPDATE", it was "the client cannot change status".
-- ============================================================================

grant update on public.project to authenticated;

create or replace function public.project_status_is_server_owned() returns trigger
  language plpgsql as $$
begin
  -- current_user is 'authenticated' for a client JWT and 'postgres'/service for
  -- server-side work. The invariant is unchanged; only the enforcement moved.
  if new.status is distinct from old.status and current_user = 'authenticated' then
    raise exception 'project.status is server-owned and cannot be set by a client'
      using errcode = '42501';
  end if;
  -- owner_id likewise: RLS scopes rows to their owner, but nothing stopped a
  -- client REASSIGNING a job to someone else in an upsert.
  if new.owner_id is distinct from old.owner_id and current_user = 'authenticated' then
    raise exception 'project.owner_id cannot be reassigned by a client'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists project_server_owned on public.project;
create trigger project_server_owned before update on public.project
  for each row execute function public.project_status_is_server_owned();
