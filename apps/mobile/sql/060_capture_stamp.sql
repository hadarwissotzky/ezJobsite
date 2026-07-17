-- The GPS + time stamp reaches the cloud — MANDATE #9.
--
-- WHY: the stamp was durable on the device and INVISIBLE in the cloud --
-- ingest_capture_v1 took no GPS parameters, so "every media capture is stamped
-- with GPS + time as tamper-evident evidence" held for exactly as long as the
-- phone did. Evidence that only exists on the device it was captured on is not
-- much of an evidence chain.
--
-- ALSO: public.capture is still the BAKEOFF SPIKE's throwaway table. `seq`,
-- `trial` and `label` are Q1 negative-control columns -- they exist to detect
-- sequence inversion in a sync experiment that is over, and they mean nothing to
-- the product. `payload` holds an object key rather than a payload. The product
-- has been writing real captures into an experiment's schema.
--
-- They are NOT dropped here. Dropping columns out from under live rows and a
-- running RPC, in the same change that adds new ones, is how you turn a tidy-up
-- into an outage. Named so the next person knows they are vestigial rather than
-- load-bearing, and can remove them deliberately.

-- Additive and nullable, for the same reason as on the device: captures taken
-- before the stamp existed have no location and CANNOT be backfilled. Null here
-- means "we never knew", and stamp_status says why.
alter table public.capture add column if not exists modality       text;
alter table public.capture add column if not exists gps_lat        double precision;
alter table public.capture add column if not exists gps_lng        double precision;
alter table public.capture add column if not exists gps_accuracy_m double precision;
alter table public.capture add column if not exists gps_fix_age_ms bigint;
alter table public.capture add column if not exists stamp_status   text;

-- A location is either real or absent. Never 0,0 -- that is a spot in the Gulf of
-- Guinea, and it is how a null becomes a lie that plots on a map.
alter table public.capture drop constraint if exists capture_gps_sane;
alter table public.capture add constraint capture_gps_sane check (
  (gps_lat is null and gps_lng is null)
  or (gps_lat between -90 and 90 and gps_lng between -180 and 180
      and not (gps_lat = 0 and gps_lng = 0))
);

alter table public.capture drop constraint if exists capture_stamp_status_known;
alter table public.capture add constraint capture_stamp_status_known check (
  stamp_status is null or stamp_status in ('ok','denied','unavailable','timeout')
);

-- A stamp that claims 'ok' must actually carry a fix. Otherwise "ok" is a word
-- with nothing behind it, and the one column that says whether the evidence is
-- trustworthy becomes the one column you cannot trust.
alter table public.capture drop constraint if exists capture_stamp_status_honest;
alter table public.capture add constraint capture_stamp_status_honest check (
  stamp_status is distinct from 'ok' or (gps_lat is not null and gps_lng is not null)
);

create index if not exists capture_project_time on public.capture (project_id, client_created_at desc);

-- DROP FIRST, do not rely on `create or replace`. Adding DEFAULTED parameters to
-- an existing function creates an OVERLOAD rather than replacing it: both the
-- 12-arg and 17-arg versions then exist, PostgREST cannot resolve the call
-- unambiguously, and every capture upload breaks. Found the hard way -- the
-- REVOKE two lines below failed with "function name is not unique", which is the
-- only reason the overload was noticed at all.
drop function if exists public.ingest_capture_v1(
  text, text, text, text, uuid, text, text, bigint, text, text, bigint, text);

-- Rebuilt with the stamp. Same contract otherwise: one RPC for capture +
-- attachment, idempotent by mutation_id, null-safe ownership.
create or replace function public.ingest_capture_v1(
  p_mutation_id    text,
  p_capture_id     text,
  p_attachment_id  text,
  p_project_id     text,
  p_owner_id       uuid,
  p_object_key     text,
  p_media_sha256   text,
  p_media_bytes    bigint,
  p_media_mime     text,
  p_modality       text,
  p_captured_at_ms bigint,
  p_request_sha256 text,
  -- Mandate #9. DEFAULTED so an older client that does not send them still
  -- succeeds: a capture must never fail to upload because the app is out of date.
  -- It lands with a null stamp, which is the truth about that capture.
  p_gps_lat        double precision default null,
  p_gps_lng        double precision default null,
  p_gps_accuracy_m double precision default null,
  p_gps_fix_age_ms bigint default null,
  p_stamp_status   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare prior_sha text;
begin
  -- NULL-SAFE. `p_owner_id <> auth.uid()` yields NULL when auth.uid() is NULL, so
  -- the IF never fires and the check SILENTLY PASSES. security definer bypasses
  -- RLS, so this line is the only thing standing there.
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  select request_sha256 into prior_sha from public.capture_mutation
   where mutation_id = p_mutation_id;
  if found then
    if prior_sha is distinct from p_request_sha256 then
      raise exception 'mutation % replayed with a different payload', p_mutation_id
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','capture_id',p_capture_id);
  end if;

  insert into public.capture (id, owner_id, project_id, payload, payload_sha256,
    client_created_at, modality, gps_lat, gps_lng, gps_accuracy_m, gps_fix_age_ms,
    stamp_status)
  values (p_capture_id, p_owner_id, p_project_id, p_object_key, p_media_sha256,
          to_timestamp(p_captured_at_ms / 1000.0), p_modality,
          p_gps_lat, p_gps_lng, p_gps_accuracy_m, p_gps_fix_age_ms, p_stamp_status)
  on conflict (id) do nothing;

  insert into public.capture_op_state (id, capture_id, owner_id, project_id,
                                       processing_state, resolution_status)
  values (p_capture_id, p_capture_id, p_owner_id, p_project_id, 'uploaded', 'unresolved')
  on conflict (id) do nothing;

  -- COLUMN NAMES LIE HERE, and not by my choice: `ciphertext_sha256` and
  -- `ciphertext_len` hold a PLAINTEXT hash and length. They are left over from
  -- Option B (client-side media encryption), which was rejected -- along with
  -- wrapped_dek_device / wrapped_dek_server / aead_nonce / aead_alg, which are
  -- dead columns for a design that does not exist. Renaming them is a separate,
  -- deliberate change; guessing at their names from memory is what broke this
  -- function in the first place. p_media_mime is accepted and NOT stored: there is
  -- no column for it, and inventing one mid-fix is how the last bug happened.
  insert into public.attachment (id, capture_id, owner_id, project_id, object_key,
                                 ciphertext_sha256, ciphertext_len, state)
  values (p_attachment_id, p_capture_id, p_owner_id, p_project_id, p_object_key,
          p_media_sha256, p_media_bytes, 'uploaded')
  on conflict (id) do nothing;

  insert into public.capture_mutation (mutation_id, capture_id, request_sha256)
  values (p_mutation_id, p_capture_id, p_request_sha256);

  return jsonb_build_object('status','applied','capture_id',p_capture_id);
end $$;

revoke all on function public.ingest_capture_v1 from public, anon;
grant execute on function public.ingest_capture_v1 to authenticated;

-- Where the work happened, for §7.3 and for a dispute. Only captures that
-- actually carry a fix: a map of nulls is a map of guesses.
create or replace view public.capture_map as
select id, project_id, owner_id, modality, gps_lat, gps_lng, gps_accuracy_m,
       client_created_at, stamp_status
  from public.capture
 where gps_lat is not null and gps_lng is not null;
