-- 306_extra_actor.sql
--
-- R6b item 3 — WHO DID WHAT ON THIS RECORD, and when.
--
-- THE GAP. PRD R6b's first AC: "Given an extra with a capturing crew member and a
-- separate sender, when the contractor opens its record, then approver (with role),
-- captured-by, and priced/sent-by are each shown with timestamps." Nothing stored
-- any of those three. change_order.who_directed is who ASKED for the extra (REQ-VAL4)
-- and approval.legal_name is who SIGNED; neither is who captured, who priced, or who
-- the request was addressed to.
--
-- The client-side fix was to delete the invented ones: an earlier record screen read
-- the signed-in profile at RENDER time, so editing your name silently rewrote who
-- priced a two-week-old record. That was right and it left the AC unmeetable, because
-- an actor fact you never wrote down cannot be read back. This table is where it gets
-- written down, once, at the moment it happens.
--
-- APPEND-ONLY, like every other evidence table here (mandate #1). "Who priced this"
-- is not a field that gets corrected later; a different answer is a different event,
-- and the People block picks between them by rule (earliest for capture and price,
-- latest for send) rather than by overwriting history.
--
-- WHY THE ROLE IS COPIED ONTO THE ROW instead of joined to project_approver at read
-- time: the roster is mutable -- 280 models retire and re-role deliberately -- and the
-- record is not. A live join would mean retiring an approver next month silently
-- changes what a signed record says about who was entitled to approve it last month.
--
-- WHAT IS NOT HERE, stated rather than implied: this table records people, not
-- delivery. Sent/delivered/opened timestamps belong to confirmation_request
-- (230_close_the_loop) and stay there.

create table if not exists public.extra_actor (
  id            text primary key,
  owner_id      uuid not null,

  -- A capture exists long before the change order does -- often before anyone has
  -- decided the item carries a price at all -- so "who captured this" cannot be keyed
  -- on the change order.
  subject_kind  text not null check (subject_kind in ('capture','change_order')),
  subject_id    text not null,

  act           text not null check (act in ('captured','priced','sent','approver')),

  -- Never blank. A row that cannot name anybody is not an actor fact, and rendering
  -- it would put a nameless person on a legal record.
  name          text not null check (length(btrim(name)) > 0),

  -- act='approver' only: the roster row it was addressed to, plus the role COPIED
  -- from that row at that moment. Not a foreign key: the roster row may be retired
  -- later, and the record must keep resolving regardless.
  approver_id   text,
  role          text check (role is null or role in
                  ('owner','general_contractor','designer',
                   'internal_specialist','property_manager','other')),

  -- The event's own clock, not the row's. For a capture this is the shutter moment,
  -- which can be minutes before the row is written.
  at_ms         bigint not null,
  created_at_ms bigint not null
);

create index if not exists extra_actor_by_subject
  on public.extra_actor (subject_kind, subject_id);

alter table public.extra_actor enable row level security;
drop policy if exists extra_actor_own on public.extra_actor;
create policy extra_actor_own on public.extra_actor for select to authenticated
  using (owner_id = auth.uid());

-- Writes go through the device outbox, never straight from the client -- same as
-- project_approver (280), project_party (120) and change_order. Update and delete are
-- revoked from everyone, not just narrowed: append-only is the point.
revoke insert, update, delete on public.extra_actor from authenticated;

-- ── transport ────────────────────────────────────────────────────────────────
-- One RPC, idempotent through extra_actor_mutation, mirroring ingest_r5c_v1 (290)
-- rather than inventing another transport shape. A reply lost on the wire replays
-- safely; a replay carrying a DIFFERENT payload is an error rather than a silent
-- overwrite of somebody's name on a priced commitment.

create table if not exists public.extra_actor_mutation (
  mutation_id    text primary key,
  request_sha256 text not null,
  applied_at     timestamptz not null default now()
);
alter table public.extra_actor_mutation enable row level security;

create or replace function public.ingest_extra_actor_v1(
  p_mutation_id text, p_id text, p_owner_id uuid,
  p_subject_kind text, p_subject_id text, p_act text, p_name text,
  p_approver_id text, p_role text,
  p_at_ms bigint, p_created_at_ms bigint,
  p_request_sha256 text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare prior text;
begin
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  select request_sha256 into prior
    from public.extra_actor_mutation where mutation_id = p_mutation_id;
  if found then
    if prior is distinct from p_request_sha256 then
      raise exception 'mutation % replayed with a different payload', p_mutation_id
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','id',p_id);
  end if;

  -- do nothing, never do update: the device mints a deterministic id from
  -- (subject, act, at_ms), so a second arrival is the same event, not a correction.
  insert into public.extra_actor
    (id, owner_id, subject_kind, subject_id, act, name, approver_id, role,
     at_ms, created_at_ms)
  values (p_id, p_owner_id, p_subject_kind, p_subject_id, p_act, p_name,
          p_approver_id, p_role, p_at_ms, p_created_at_ms)
  on conflict (id) do nothing;

  insert into public.extra_actor_mutation (mutation_id, request_sha256)
  values (p_mutation_id, p_request_sha256);

  return jsonb_build_object('status','applied','id',p_id);
end $$;

revoke all on function public.ingest_extra_actor_v1(
  text, text, uuid, text, text, text, text, text, text, bigint, bigint, text
) from public;
grant execute on function public.ingest_extra_actor_v1(
  text, text, uuid, text, text, text, text, text, text, bigint, bigint, text
) to authenticated;
