-- 375 — the Simplest Jobsite Flow fields (FLOW-SIMPLEST-JOBSITE.md, phase 1).
--
-- billing_timing, schedule_effect (+days), exclusions: the three answers the
-- flow mock's "fill what's missing" step adds, decisions logged 2026-07-23:
-- billing defaults to when_completed AT THE UI (the column stays honest null
-- for old clients), "not_sure" is a legal schedule answer, exclusions free
-- text. They will join the frozen instrument in phase 2; the CHECKs mirror
-- the device's exactly so being offline never lowers the bar.

alter table public.change_order
  add column if not exists billing_timing text
    check (billing_timing is null or billing_timing in ('next_invoice','when_completed','other')),
  add column if not exists schedule_effect text
    check (schedule_effect is null or schedule_effect in ('no_change','adds_days','not_sure')),
  add column if not exists schedule_days integer
    check (schedule_days is null or schedule_days > 0),
  add column if not exists exclusions text;

-- ingest_change_order_v1 gains four DEFAULTed parameters. DROP then CREATE,
-- not CREATE OR REPLACE: a changed signature under the same name would leave
-- the old function as an overload, and PostgREST refuses ambiguous rpc names.
-- Defaults keep every older client valid (they simply send nulls by absence).
drop function if exists public.ingest_change_order_v1(
  text, text, text, text, uuid, text, jsonb, bigint, bigint, integer,
  text, text, bigint, bigint, text);

create function public.ingest_change_order_v1(
  p_mutation_id text, p_id text, p_decision_id text, p_project_id text,
  p_owner_id uuid, p_scope text, p_line_items jsonb, p_amount_cents bigint,
  p_nte_cents bigint, p_is_mini integer, p_who_directed text,
  p_ref_estimate text, p_numbers_confirmed_at_ms bigint, p_created_at_ms bigint,
  p_request_sha256 text,
  p_billing_timing text default null,
  p_schedule_effect text default null,
  p_schedule_days integer default null,
  p_exclusions text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare prior text;
begin
  -- NULL-SAFE ON PURPOSE. `p_owner_id <> auth.uid()` is a TRAP: when auth.uid()
  -- is NULL the comparison yields NULL, the IF never fires, and the ownership
  -- check SILENTLY PASSES. `is distinct from` is null-safe, and auth.uid() is
  -- checked explicitly so a missing JWT is refused loudly.
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  -- MANDATE #6, enforced at the door rather than hoped for.
  if p_numbers_confirmed_at_ms is null then
    raise exception 'numbers_confirmed_at is required: an unconfirmed price may never be stored'
      using errcode = '23514';
  end if;

  select request_sha256 into prior from public.change_order_mutation where mutation_id = p_mutation_id;
  if found then
    if prior is distinct from p_request_sha256 then
      raise exception 'mutation % replayed with a different payload', p_mutation_id
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','id',p_id);
  end if;

  -- `do nothing`, never `do update`: a change order that already landed is not
  -- re-authored by a retry.
  insert into public.change_order (id, decision_id, project_id, owner_id, scope,
    line_items, amount_cents, nte_cents, is_mini, who_directed, ref_estimate,
    numbers_confirmed_at, status, created_at,
    billing_timing, schedule_effect, schedule_days, exclusions)
  values (p_id, p_decision_id, p_project_id, p_owner_id, p_scope,
    coalesce(p_line_items, '[]'::jsonb), p_amount_cents, p_nte_cents,
    coalesce(p_is_mini, 0), p_who_directed, p_ref_estimate,
    to_timestamp(p_numbers_confirmed_at_ms / 1000.0),
    'draft', to_timestamp(p_created_at_ms / 1000.0),
    p_billing_timing, p_schedule_effect, p_schedule_days, p_exclusions)
  on conflict (id) do nothing;

  insert into public.change_order_mutation (mutation_id, request_sha256)
  values (p_mutation_id, p_request_sha256);

  return jsonb_build_object('status','applied','id',p_id);
end $function$;

revoke all on function public.ingest_change_order_v1(
  text, text, text, text, uuid, text, jsonb, bigint, bigint, integer,
  text, text, bigint, bigint, text, text, text, integer, text) from public, anon;
grant execute on function public.ingest_change_order_v1(
  text, text, text, text, uuid, text, jsonb, bigint, bigint, integer,
  text, text, bigint, bigint, text, text, text, integer, text) to authenticated;
