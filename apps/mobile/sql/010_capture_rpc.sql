-- EZjobsite — the capture ingest RPC.
--
-- Implements docs/CAPTURE-DURABILITY-ARCH-v1-CODEX.md §3 step 10.
--
-- WHY THIS IS ONE RPC AND NOT TWO INSERTS (this is the whole point):
-- Codex #11 CRITICAL 3 — the spike connector sent Capture and Attachment as two
-- separate Supabase requests and completed the queue anyway. That permits
-- "Capture accepted + Attachment rejected + queue drained", after which the
-- downloaded checkpoint overwrites the local rows and a capture the user was
-- told was saved is GONE. PowerSync's local transaction grouping does NOT make
-- separate server calls atomic. One RPC, one Postgres transaction, or nothing.
--
-- Idempotency contract (spec §3 step 10):
--   same mutation_id + same payload digest  -> returns the ORIGINAL success
--   same mutation_id + different digest     -> CONFLICT (409-ish), never a
--                                              silent overwrite
-- This is what makes retry-after-restart safe: the device re-sends the same
-- mutation_id minted at PREPARE (§1.0b), so a retry cannot duplicate.

create table if not exists public.capture_mutation (
  mutation_id     text primary key,
  capture_id      text not null unique,
  request_sha256  text not null,
  accepted_at     timestamptz not null default now()
);

comment on table public.capture_mutation is
  'Idempotency ledger. One row per accepted capture mutation. Keyed by the '
  'mutation_id the DEVICE minted at PREPARE, so a retry after restart is a '
  'no-op rather than a duplicate.';

-- One transaction. Either all of it lands or none of it does.
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
  p_request_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.capture_mutation%rowtype;
begin
  -- Callers may only write their own data. security definer bypasses RLS, so
  -- the ownership check must be explicit and must not be removable by accident.
  --
  -- NULL-SAFE ON PURPOSE. This guarded p_owner_id being null but NOT auth.uid()
  -- being null, which is the same trap: `p_owner_id <> NULL` yields NULL, the IF
  -- never fires, and the ownership check SILENTLY PASSES for a caller with no JWT.
  -- Found in the change-order RPC and fixed in all three rather than only where
  -- it was noticed.
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  -- Idempotent replay?
  select * into v_existing from public.capture_mutation where mutation_id = p_mutation_id;
  if found then
    if v_existing.request_sha256 = p_request_sha256 then
      -- Same mutation, same bytes -> return the ORIGINAL success. This is the
      -- retry-after-restart path and it must be boring.
      return jsonb_build_object('status', 'already_applied', 'capture_id', v_existing.capture_id);
    end if;
    -- Same mutation id, DIFFERENT payload. Never overwrite; the first write wins
    -- and the caller must know it disagreed.
    raise exception 'mutation_id % replayed with a different payload digest', p_mutation_id
      using errcode = '23505';
  end if;

  -- The capture row (immutable evidence).
  insert into public.capture (id, owner_id, project_id, payload, payload_sha256, client_created_at)
  values (p_capture_id, p_owner_id, p_project_id, p_object_key, p_media_sha256,
          to_timestamp(p_captured_at_ms / 1000.0));

  insert into public.capture_op_state (id, capture_id, owner_id, project_id,
                                       processing_state, resolution_status)
  values (p_capture_id, p_capture_id, p_owner_id, p_project_id, 'uploaded', 'unresolved');

  insert into public.attachment (id, capture_id, owner_id, project_id, object_key,
                                 ciphertext_sha256, ciphertext_len, state)
  values (p_attachment_id, p_capture_id, p_owner_id, p_project_id, p_object_key,
          p_media_sha256, p_media_bytes, 'uploaded');

  insert into public.capture_mutation (mutation_id, capture_id, request_sha256)
  values (p_mutation_id, p_capture_id, p_request_sha256);

  return jsonb_build_object('status', 'applied', 'capture_id', p_capture_id);
end $$;

revoke all on function public.ingest_capture_v1 from public, anon;
grant execute on function public.ingest_capture_v1 to authenticated;

-- The device must never write these tables directly; the RPC is the only door.
-- Without this, a client could insert a Capture with no Attachment and
-- reintroduce the partial-accept bug the RPC exists to prevent.
revoke insert on public.capture, public.capture_op_state, public.attachment from authenticated;
