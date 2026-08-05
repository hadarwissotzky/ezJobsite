-- 391 — the change order gets a SCOPE OF WORK, separate from its title.
--
-- hadar, 2026-08-05, after reviewing the detail page at all three stages: "the
-- current detail need to show clear and full (detailed) scope of the change order".
--
-- THE DEFECT, measured rather than asserted. Every change order in this database:
-- 15 rows, average `scope` length 27 characters, longest ever 39, zero approved.
-- Five read "Untitled extra — still being written up" and ten are "Loop check
-- lc-…" test artifacts. Not one has a scope a homeowner could act on.
--
-- That is not a discipline problem, it is a schema problem. `change_order.scope`
-- is doing three incompatible jobs at once:
--   1. the TITLE on every list row and screen header;
--   2. the send-readiness gate (`no_description` is computed from it);
--   3. the SCOPE OF WORK THE CLIENT SIGNS — App.tsx passes it to renderCard as
--      both `subject` and `value`, so it is the body of the frozen instrument.
-- A field short enough for a list row cannot also be a detailed scope of work, so
-- the client signs a title. startextra.ts already recorded the collision from the
-- other side: SCOPE_MAX_CHARS went 200 → 1500 because "it was a title-length guard
-- from when scope WAS only a title, and it stopped being one when renderCard began
-- sending scope as the document's body."
--
-- THE SPLIT: `scope` stays the title. `scope_of_work` holds the detailed
-- client-facing text and becomes what is frozen into the instrument.
--
-- BACKFILLED FROM `scope`, WHICH IS ALL THE SERVER HAS. The AI summary — the longer
-- owner-facing prose the draft screen shows — is a DEVICE-ONLY column
-- (`change_order.summary` exists in the local SQLite schema and not in Postgres;
-- confirmed by the first run of this migration failing on exactly that). So the
-- server-side backfill can only copy `scope`, which is precisely what those rows
-- sign today: no row's meaning changes here. The richer seed from `summary` happens
-- CLIENT-side, where the summary actually lives, and rides up on the next write.
--
-- NOT BACKFILLED ONTO SENT OR APPROVED ROWS' INSTRUMENTS. Their `shown_content` is
-- already frozen and is the binding text; this column is only ever read when
-- COMPOSING a new one. Filling it here changes nothing they signed.

alter table public.change_order
  add column if not exists scope_of_work text;

update public.change_order
   set scope_of_work = scope
 where scope_of_work is null;

comment on column public.change_order.scope_of_work is
  'The detailed client-facing scope of work — the body of the frozen instrument. '
  '`scope` is the short title. Split in 391 because one field could not be both.';

-- ingest_change_order_v1 gains ONE DEFAULTED parameter, same pattern and the same
-- reason as 375: drop-then-create because a changed signature under one name leaves
-- an overload and PostgREST refuses ambiguous rpc names; defaulted so a client that
-- has not shipped yet stays valid and simply sends nothing.
-- BOTH signatures dropped, so this file is RE-RUNNABLE. The first run leaves the
-- 20-argument version in place; a second run would then fail with "already exists
-- with same argument types" while the statements after it — including the freeze
-- guard below — never execute. A migration that only works once is a migration that
-- silently half-applies on the day someone re-runs it.
drop function if exists public.ingest_change_order_v1(
  text, text, text, text, uuid, text, jsonb, bigint, bigint, integer,
  text, text, bigint, bigint, text, text, text, integer, text);
drop function if exists public.ingest_change_order_v1(
  text, text, text, text, uuid, text, jsonb, bigint, bigint, integer,
  text, text, bigint, bigint, text, text, text, integer, text, text);

create function public.ingest_change_order_v1(
  p_mutation_id text, p_id text, p_decision_id text, p_project_id text,
  p_owner_id uuid, p_scope text, p_line_items jsonb, p_amount_cents bigint,
  p_nte_cents bigint, p_is_mini integer, p_who_directed text,
  p_ref_estimate text, p_numbers_confirmed_at_ms bigint, p_created_at_ms bigint,
  p_request_sha256 text,
  p_billing_timing text default null,
  p_schedule_effect text default null,
  p_schedule_days integer default null,
  p_exclusions text default null,
  p_scope_of_work text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare prior text;
begin
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

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

  insert into public.change_order (id, decision_id, project_id, owner_id, scope,
    line_items, amount_cents, nte_cents, is_mini, who_directed, ref_estimate,
    numbers_confirmed_at, status, created_at,
    billing_timing, schedule_effect, schedule_days, exclusions, scope_of_work)
  values (p_id, p_decision_id, p_project_id, p_owner_id, p_scope,
    coalesce(p_line_items, '[]'::jsonb), p_amount_cents, p_nte_cents,
    coalesce(p_is_mini, 0), p_who_directed, p_ref_estimate,
    to_timestamp(p_numbers_confirmed_at_ms / 1000.0),
    'draft', to_timestamp(p_created_at_ms / 1000.0),
    p_billing_timing, p_schedule_effect, p_schedule_days, p_exclusions,
    -- An older client sends nothing; the row then reads as it always did rather
    -- than landing with an empty scope of work.
    coalesce(p_scope_of_work, p_scope))
  on conflict (id) do nothing;

  insert into public.change_order_mutation (mutation_id, request_sha256)
  values (p_mutation_id, p_request_sha256);

  return jsonb_build_object('status','applied','id',p_id);
end $function$;

revoke all on function public.ingest_change_order_v1(
  text, text, text, text, uuid, text, jsonb, bigint, bigint, integer,
  text, text, bigint, bigint, text, text, text, integer, text, text) from public, anon;
grant execute on function public.ingest_change_order_v1(
  text, text, text, text, uuid, text, jsonb, bigint, bigint, integer,
  text, text, bigint, bigint, text, text, text, integer, text, text) to authenticated;

-- The edit path (`update_change_order_scope` / whatever writes a draft's scope
-- later) is NOT touched here. 391 only makes the column exist, backfills it, and
-- lets a create carry it. Editing an existing draft's scope of work rides the same
-- path the title already does and is handled client-side.

-- THE SCOPE OF WORK FREEZES WITH THE PRICE.
--
-- It is now the BODY of the frozen instrument (renderCard takes it as `value`), so
-- leaving it out of change_order_guard would let a sent extra's signed scope be
-- rewritten underneath the person who signed it — the exact failure the guard exists
-- to prevent, on the one field that matters most. extralocked.tsx refuses to render
-- anything outside the frozen set under the heading "what was agreed"; this is what
-- earns scope_of_work its place there.
create or replace function public.change_order_guard()
returns trigger
language plpgsql
as $function$ begin
    if old.status in ('sent','approved','declined')
       and (new.amount_cents    is distinct from old.amount_cents
            or new.scope            is distinct from old.scope
            or new.scope_of_work    is distinct from old.scope_of_work
            or new.nte_cents        is distinct from old.nte_cents
            or new.billing_timing   is distinct from old.billing_timing
            or new.schedule_effect  is distinct from old.schedule_effect
            or new.schedule_days    is distinct from old.schedule_days
            or new.exclusions       is distinct from old.exclusions) then
      raise exception 'a sent change order is frozen: supersede it with a new one';
    end if;
    return new;
  end $function$;
