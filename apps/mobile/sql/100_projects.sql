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
