-- 437 — A narrow, role-fenced, audited way to destroy evidence on purpose.
--
-- hadar, 2026-09-01, "build it", after a Codex second opinion adjudicated an hour of
-- failed deletes. He had asked six times to remove four test jobsites holding photos.
--
-- ============================================================================
-- WHY EVERY EARLIER ATTEMPT FAILED, and it was never the reason I kept guessing.
--
--   create function capture_is_immutable() ... begin
--     raise exception 'capture is append-only (immutable evidence): % blocked', tg_op;
--   end
--
-- Unconditional. No role exemption, no GUC, and SECURITY DEFINER does not help because
-- triggers fire regardless of who owns the calling function. `delete_project_with_media_v1`
-- (434/436), migration 433 and migration 435 ALL delete from `capture`, so all three were
-- dead on arrival. I shipped three mechanisms across an hour without once reading
-- pg_trigger on the table I was deleting from.
--
-- NINETEEN delete-blocking triggers exist in `public`. I had found three.
--
-- ============================================================================
-- THE SHAPE, per Codex's adjudication: hard delete, but only through one door.
--
--   1. A dedicated role, `evidence_purger`, NOLOGIN and granted to nobody. It exists to
--      be a function owner and nothing else.
--   2. `purge_project_v1` is SECURITY DEFINER *owned by that role*, so `current_user`
--      inside it is `evidence_purger` and inside nothing else in this database.
--   3. The triggers gain ONE exception: DELETE is allowed when `evidence_purge_authorized()`
--      is true. That predicate requires BOTH the role AND a transaction-local GUC.
--
--      THE GUC ALONE WOULD BE WORTHLESS — any client can `set_config` whatever it likes.
--      Codex's point, and it is the difference between a fence and a sign. The role is
--      the actual fence; the GUC only ensures that a future function owned by this same
--      role cannot delete evidence by accident, without opting in on the line.
--
--   4. UPDATE STAYS BLOCKED EVERYWHERE. Nine of these ten triggers guard UPDATE as well,
--      and the exception is written `if tg_op = 'DELETE' and ...`. Editing evidence in
--      place remains impossible; only destroying it outright becomes possible, which is
--      the honest distinction — a purge admits the record is gone, an edit pretends it
--      was always something else.
--
--   5. AN IMMUTABLE LEDGER SURVIVES THE PURGE. Actor, project, reason, capture ids, byte
--      count and storage keys are written before anything is destroyed, into a table
--      whose own trigger has NO purge exception. Erasure of the content, never of the
--      fact that erasure happened. This is the same shape CLAUDE.md §2 mandate #5
--      already requires for lawful erasure: hard-delete the data, retain the stub.
--
-- WHAT THIS DELIBERATELY DOES NOT ALLOW: a project carrying a change order, approval,
-- confirmation request or EWA is refused outright. A priced commitment is not purgeable
-- by any route in this database, and that fence is checked before the ledger is written.
--
-- STORAGE: the function RETURNS the object keys rather than deleting the bytes, because
-- SQL cannot reach the Storage API. The caller must delete them and is the only thing
-- that can. The ledger records the keys either way, so an orphaned byte is always
-- traceable to the purge that stranded it.
--
-- SUPERSEDES: sql/433 and sql/435 — both delete from `capture` directly and can only
-- ever throw. Do not run them. 435's premise ("nothing references it, so it is
-- disposable") was also judged unsound: unreferenced is not the same as abandoned.
-- ============================================================================
--
-- Apply with:  ./scripts/apply-migration.sh apps/mobile/sql/437_evidence_purge.sql

-- ── 1. the role ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'evidence_purger') then
    create role evidence_purger nologin;
  end if;
end $$;

-- postgres must be a member to hand it ownership of the function below.
grant evidence_purger to postgres;

-- ── 2. the predicate both fences depend on ──────────────────────────────────
create or replace function public.evidence_purge_authorized() returns boolean
  language sql stable
  set search_path = public
as $$
  select current_user = 'evidence_purger'
     and coalesce(current_setting('app.evidence_purge', true), '') = 'on';
$$;

comment on function public.evidence_purge_authorized() is
  'True only inside a purge function owned by evidence_purger that has opted in on the '
  'line. The role is the fence; the GUC is the opt-in. A client can set the GUC and '
  'still fails, because it cannot become the role.';

-- ── 3. the ten triggers gain a DELETE-only exception ────────────────────────
-- Each keeps its own message verbatim, so an ordinary refusal still reads exactly as it
-- did before. Only the guard clause is new.

create or replace function public.capture_is_immutable() returns trigger
  language plpgsql as $function$
begin
  if tg_op = 'DELETE' and public.evidence_purge_authorized() then return old; end if;
  raise exception 'capture is append-only (immutable evidence): % blocked', tg_op;
end $function$;

create or replace function public.capture_pair_append_only() returns trigger
  language plpgsql as $function$
begin
  if tg_op = 'DELETE' and public.evidence_purge_authorized() then return old; end if;
  raise exception 'capture_pair is append-only (pair % capture %)', old.pair_id, old.capture_id
    using errcode = '42501';
end $function$;

create or replace function public.transcript_append_only() returns trigger
  language plpgsql as $function$
begin
  if tg_op = 'DELETE' and public.evidence_purge_authorized() then return old; end if;
  raise exception 'transcripts are append-only: re-transcribe by inserting, % blocked', tg_op;
end $function$;

create or replace function public.structured_append_only() returns trigger
  language plpgsql as $function$
begin
  if tg_op = 'DELETE' and public.evidence_purge_authorized() then return old; end if;
  raise exception 'proposals are append-only: re-structure by inserting, % blocked', tg_op;
end $function$;

create or replace function public.content_signal_append_only() returns trigger
  language plpgsql as $function$
begin
  if tg_op = 'DELETE' and public.evidence_purge_authorized() then return old; end if;
  raise exception 'content signals are append-only: % blocked', tg_op;
end $function$;

create or replace function public.capture_note_append_only() returns trigger
  language plpgsql as $function$
begin
  if tg_op = 'DELETE' and public.evidence_purge_authorized() then return old; end if;
  raise exception 'notes are append-only: % blocked', tg_op;
end $function$;

create or replace function public.capture_tag_append_only() returns trigger
  language plpgsql as $function$
begin
  if tg_op = 'DELETE' and public.evidence_purge_authorized() then return old; end if;
  raise exception 'tag events are append-only: % blocked', tg_op;
end $function$;

create or replace function public.capture_discarded_no_change() returns trigger
  language plpgsql as $function$
begin
  if tg_op = 'DELETE' and public.evidence_purge_authorized() then return old; end if;
  raise exception 'a discard is a recorded act: % blocked', tg_op;
end $function$;

create or replace function public.decision_append_only() returns trigger
  language plpgsql as $function$
begin
  if tg_op = 'DELETE' and public.evidence_purge_authorized() then return old; end if;
  raise exception 'decision history is append-only: % blocked', tg_op;
end $function$;

create or replace function public.co_comment_no_mutate() returns trigger
  language plpgsql as $function$
begin
  if tg_op = 'DELETE' and public.evidence_purge_authorized() then return old; end if;
  raise exception 'comments are append-only';
end $function$;

-- ── 4. the ledger, which the purge cannot touch ─────────────────────────────
create table if not exists public.evidence_purge_log (
  id             uuid primary key default gen_random_uuid(),
  purged_at      timestamptz not null default now(),
  actor_id       uuid        not null,
  project_id     text        not null,
  project_name   text,
  reason         text        not null check (length(btrim(reason)) > 0),
  capture_ids    text[]      not null,
  capture_count  integer     not null,
  bytes          bigint      not null,
  object_keys    text[]      not null
);

comment on table public.evidence_purge_log is
  'One row per purge, written before anything is destroyed. Has NO purge exception on '
  'its own immutability trigger: the content is erasable, the fact of erasure is not.';

create or replace function public.evidence_purge_log_immutable() returns trigger
  language plpgsql as $function$
begin
  -- Deliberately NOT calling evidence_purge_authorized(). The ledger outlives every
  -- purge, including a purge of the project it describes.
  raise exception 'the purge ledger is permanent: % blocked', tg_op;
end $function$;

drop trigger if exists evidence_purge_log_no_change on public.evidence_purge_log;
create trigger evidence_purge_log_no_change
  before update or delete on public.evidence_purge_log
  for each row execute function public.evidence_purge_log_immutable();

alter table public.evidence_purge_log enable row level security;
drop policy if exists evidence_purge_log_own on public.evidence_purge_log;
create policy evidence_purge_log_own on public.evidence_purge_log
  for select to authenticated using (actor_id = auth.uid());

-- ── 5. the one door ─────────────────────────────────────────────────────────
create or replace function public.purge_project_v1(p_project_id text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_owner  uuid;
  v_name   text;
  v_block  text;
  v_ids    text[];
  v_keys   text[];
  v_bytes  bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    -- A purge with no stated reason is not auditable, so it is not allowed.
    return jsonb_build_object('ok', false, 'reason', 'no_reason');
  end if;

  select owner_id, name into v_owner, v_name from public.project where id = p_project_id;
  if v_owner is null then
    return jsonb_build_object('ok', true, 'already', true, 'captures', 0,
                              'bytes', 0, 'object_keys', '[]'::jsonb);
  end if;
  if v_owner is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;

  -- FENCED BEFORE THE LEDGER IS WRITTEN. A priced commitment is not purgeable by any
  -- route, and a refused attempt must not leave a row claiming something was destroyed.
  select t into v_block from (
    select 'change_order' as t where exists (select 1 from public.change_order where project_id = p_project_id)
    union all select 'approval' where exists (select 1 from public.approval where project_id = p_project_id)
    union all select 'confirmation_request' where exists (select 1 from public.confirmation_request where project_id = p_project_id)
    union all select 'extra_work_authorization' where exists (select 1 from public.extra_work_authorization where project_id = p_project_id)
  ) blockers limit 1;
  if v_block is not null then
    return jsonb_build_object('ok', false, 'reason', 'has_commitment', 'holds', v_block);
  end if;

  select coalesce(array_agg(c.id), '{}') into v_ids
    from public.capture c where c.project_id = p_project_id;
  select coalesce(array_agg(a.object_key) filter (where a.object_key is not null), '{}'),
         coalesce(sum(a.ciphertext_len), 0)
    into v_keys, v_bytes
    from public.attachment a where a.project_id = p_project_id;

  -- THE RECORD GOES IN FIRST. Same transaction, so it rolls back with a failure — but
  -- it can never be the case that rows vanished and no row says who did it.
  insert into public.evidence_purge_log
    (actor_id, project_id, project_name, reason, capture_ids, capture_count, bytes, object_keys)
  values (v_uid, p_project_id, v_name, btrim(p_reason), v_ids,
          coalesce(array_length(v_ids, 1), 0), v_bytes, v_keys);

  -- Opt in on the line. Transaction-local: it cannot leak past this call.
  perform set_config('app.evidence_purge', 'on', true);

  -- Children before parents, and derived artefacts before the capture they describe.
  delete from public.decision_version
    where decision_id in (select id from public.decision where project_id = p_project_id);
  delete from public.decision              where project_id = p_project_id;
  delete from public.co_comment            where project_id = p_project_id;
  delete from public.scope_boundary        where project_id = p_project_id;
  delete from public.processing_job        where project_id = p_project_id;

  delete from public.capture_transcript     where capture_id = any(v_ids);
  delete from public.capture_structured     where capture_id = any(v_ids);
  delete from public.capture_content_signal where capture_id = any(v_ids);
  delete from public.capture_note           where capture_id = any(v_ids);
  delete from public.capture_tag            where capture_id = any(v_ids);
  delete from public.capture_discarded      where capture_id = any(v_ids);
  delete from public.capture_mutation       where capture_id = any(v_ids);
  delete from public.capture_pair           where project_id = p_project_id;
  delete from public.capture_op_state       where project_id = p_project_id;
  delete from public.attachment             where project_id = p_project_id;
  delete from public.capture                where project_id = p_project_id;

  delete from public.project_party          where project_id = p_project_id;
  delete from public.project_approver       where project_id = p_project_id;

  delete from public.project
   where id = p_project_id
     and owner_id = v_uid
     and not exists (select 1 from public.change_order where project_id = p_project_id);
  if not found then
    -- A change order raced in from another device between the fence and here.
    raise exception 'purge aborted: a commitment landed mid-call' using errcode = '42501';
  end if;

  perform set_config('app.evidence_purge', 'off', true);

  return jsonb_build_object('ok', true,
                            'captures', coalesce(array_length(v_ids, 1), 0),
                            'bytes', v_bytes,
                            'object_keys', to_jsonb(v_keys));
end $$;

-- ── 5b. everything the role needs, BEFORE it is handed the function ─────────
--
-- ORDER MATTERS AND I HAD IT WRONG. The first run of this file died here with
-- "permission denied for schema public" (hadar, 2026-09-01): `ALTER FUNCTION ... OWNER
-- TO` checks that the NEW OWNER has CREATE on the schema holding the function, and
-- `evidence_purger` had nothing at all — the grants were written after the ALTER, and
-- USAGE would not have been enough even if they had come first.
--
-- CREATE on `public` for a NOLOGIN role granted to nobody but postgres adds no reach:
-- only postgres can SET ROLE to it, and postgres already has CREATE there.
grant usage, create on schema public to evidence_purger;
grant usage on schema auth to evidence_purger;
grant execute on function auth.uid() to evidence_purger;
grant select, delete on
  public.capture, public.attachment, public.capture_op_state, public.capture_pair,
  public.capture_transcript, public.capture_structured, public.capture_content_signal,
  public.capture_note, public.capture_tag, public.capture_discarded,
  public.capture_mutation, public.decision, public.decision_version,
  public.processing_job, public.co_comment, public.scope_boundary,
  public.project_party, public.project_approver, public.project
  to evidence_purger;
grant select on
  public.change_order, public.approval, public.confirmation_request,
  public.extra_work_authorization
  to evidence_purger;
grant insert on public.evidence_purge_log to evidence_purger;

-- OWNED BY THE PURGE ROLE, and this line is the fence: it is what makes `current_user`
-- inside the function `evidence_purger`, and there is no other function in this database
-- for which that is true. It comes AFTER the grants above, because the new owner must
-- already hold CREATE on the schema for this statement to be allowed.
alter function public.purge_project_v1(text, text) owner to evidence_purger;

revoke all on function public.purge_project_v1(text, text) from public, anon;
grant execute on function public.purge_project_v1(text, text) to authenticated;

-- ── 6. remove the function that could never work ────────────────────────────
-- `delete_project_with_media_v1` (434, reordered by 436) deletes from `capture` without
-- the exception above, so every call it ever received raised. Dropping it rather than
-- leaving it in place: a function that cannot succeed is worse than no function, because
-- the next person to find it will assume it does what its name says.
drop function if exists public.delete_project_with_media_v1(text);
