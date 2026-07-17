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
-- ingest_capture_v1 LIVES IN 060_capture_stamp.sql, NOT HERE.
--
-- It was defined in BOTH. 060 DROPS the 12-arg version and creates a 17-arg one
-- carrying the mandate #9 GPS stamp. Re-running THIS file afterwards would create
-- the 12-arg version AGAIN, alongside it -- and two overloads means PostgREST
-- cannot resolve the call and EVERY CAPTURE UPLOAD BREAKS. That exact failure
-- already happened once tonight; leaving the definition here is a loaded gun
-- pointed at whoever next runs the migrations in order.
--
-- Found by scripts/check-sql-duplicates.mjs, which exists because the same class
-- of bug silently reverted bundle_limitations() and made the dispute bundle
-- overclaim. One object, one file.



-- The device must never write these tables directly; the RPC is the only door.
-- Without this, a client could insert a Capture with no Attachment and
-- reintroduce the partial-accept bug the RPC exists to prevent.
revoke insert on public.capture, public.capture_op_state, public.attachment from authenticated;
