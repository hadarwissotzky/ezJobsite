-- 438 — Read the caller's id without needing the `auth` schema.
--
-- 437 applied, but with two warnings that were not cosmetic (hadar, 2026-09-01):
--
--   WARNING:  no privileges were granted for "auth"
--   WARNING:  no privileges were granted for "uid"
--
-- `auth` is owned by `supabase_auth_admin`, not `postgres`, so `grant usage on schema
-- auth to evidence_purger` silently did nothing. postgres cannot grant what it does not
-- own, and a GRANT that grants nothing is a WARNING, not an ERROR — so the migration
-- reported success while leaving the function unable to run.
--
-- MEASURED AFTERWARDS, which is the only reason this was caught before another failed
-- delete:
--   has_function_privilege('evidence_purger','auth.uid()','EXECUTE') -> true
--   has_schema_privilege  ('evidence_purger','auth','USAGE')         -> FALSE
-- Both are required to call a function. EXECUTE was true only because Supabase grants it
-- to PUBLIC, which made the failure look half-fixed instead of broken.
--
-- THE FIX IS TO STOP DEPENDING ON THE SCHEMA AT ALL. `auth.uid()` is a thin read of the
-- request's JWT claims, and `current_setting` needs no privilege from anyone. Inlining it
-- removes a cross-schema dependency that this role can never be granted, rather than
-- asking for a permission that is not postgres's to give.
--
-- Both claim shapes are read, in Supabase's own order: the flattened
-- `request.jwt.claim.sub` that older PostgREST sets, then the whole `request.jwt.claims`
-- object. Missing or malformed means NULL, which the function already treats as
-- not_signed_in.
--
-- NOTHING ELSE CHANGES. Same fences, same ledger, same delete order, same owner —
-- CREATE OR REPLACE keeps `evidence_purger` as the owner, which is what makes the
-- trigger exception apply to this function and to nothing else.
--
-- Apply with:  ./scripts/apply-migration.sh apps/mobile/sql/438_purge_uid_without_auth_schema.sql

create or replace function public.purge_project_v1(p_project_id text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- NOT auth.uid(): this function runs as `evidence_purger`, which has no USAGE on the
  -- `auth` schema and cannot be granted it by us. This is what auth.uid() reads.
  v_uid    uuid := coalesce(
                     nullif(current_setting('request.jwt.claim.sub', true), ''),
                     nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
                   )::uuid;
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

  insert into public.evidence_purge_log
    (actor_id, project_id, project_name, reason, capture_ids, capture_count, bytes, object_keys)
  values (v_uid, p_project_id, v_name, btrim(p_reason), v_ids,
          coalesce(array_length(v_ids, 1), 0), v_bytes, v_keys);

  perform set_config('app.evidence_purge', 'on', true);

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
    raise exception 'purge aborted: a commitment landed mid-call' using errcode = '42501';
  end if;

  perform set_config('app.evidence_purge', 'off', true);

  return jsonb_build_object('ok', true,
                            'captures', coalesce(array_length(v_ids, 1), 0),
                            'bytes', v_bytes,
                            'object_keys', to_jsonb(v_keys));
end $$;

-- Restated rather than assumed: CREATE OR REPLACE preserves the owner, and the owner is
-- the fence. If this ever prints a different role, the trigger exception no longer
-- applies and the purge is inert.
do $$
declare v_owner text;
begin
  select pg_get_userbyid(proowner) into v_owner from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'purge_project_v1';
  if v_owner is distinct from 'evidence_purger' then
    raise exception 'purge_project_v1 is owned by % — the trigger exception will not apply', v_owner;
  end if;
end $$;

revoke all on function public.purge_project_v1(text, text) from public, anon;
grant execute on function public.purge_project_v1(text, text) to authenticated;
