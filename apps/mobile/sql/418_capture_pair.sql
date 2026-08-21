-- 418 — capture_pair: the link that ties a walkthrough's photos to what was said
--
-- WHY THIS EXISTS (hadar, 2026-08-21: "most of the photos are missing")
--
-- A fused capture is TWO captures — a photo taken while narrating, and the voice clip
-- of the narration — joined by a `pair_id` minted on the device at capture time. The
-- record screen and the cover-photo query both walk that link to show an extra's
-- photos: `decision_version` reaches the ANCHOR capture, and `capture_pair` reaches its
-- siblings.
--
-- `pair.ts` has always said, in its own header, "Local-only for now (a grouping hint
-- for the grid/viewer)". That sentence was true and the "for now" quietly became
-- load-bearing: the pair table has no server counterpart, no outbox and no pull, so
-- the link exists on exactly ONE handset and dies with it.
--
-- MEASURED, NOT ASSUMED (live database, 2026-08-21): of 102 photos on this account,
-- FOUR are reachable from an extra through `decision_version`. The other 98 hang off
-- `capture_pair` alone. So a second phone, a reinstall, or the device handover leaves
-- 96% of a contractor's photographic evidence unreachable — while every byte of it sits
-- safely in Storage. On a product whose claim is that an approved change order carries
-- the proof of what was agreed, that is the claim failing.
--
-- ─── IT IS A LINK, NOT EVIDENCE, AND THE DISTINCTION SETS THE RULES ──────────────
-- The captures are the evidence and they sync through their own audited path. This
-- table records only WHICH captures were taken in one breath. That is why it is safe
-- to (re)insert idempotently and why losing a row costs a grouping rather than a
-- capture. It is append-only all the same: a pairing is a fact about a moment that
-- already happened, so there is nothing here that should ever be edited.
--
-- ─── NO FOREIGN KEY TO capture, DELIBERATELY ────────────────────────────────────
-- Same reasoning `decision_version.capture_id` records (040): a pairing may reach the
-- server before its photo's bytes finish uploading, and a link must never be blocked
-- waiting on a blob. Integrity is reported, not enforced by an ordering dependency
-- between two independent queues.

create table if not exists public.capture_pair (
  pair_id     text not null,
  capture_id  text not null,
  role        text not null check (role in ('photo','voice')),
  at_ms       bigint not null,
  owner_id    uuid not null,
  project_id  text not null,
  created_at  timestamptz not null default now(),
  primary key (pair_id, capture_id)
);

create index if not exists capture_pair_by_capture on public.capture_pair (capture_id);
create index if not exists capture_pair_by_project on public.capture_pair (project_id);

alter table public.capture_pair enable row level security;

-- READ: own rows, plus the company-wide read every other evidence table grants (376).
-- A crew member who can see the job's captures must be able to see how they group, or
-- the photos are on their screen in an order that means nothing.
drop policy if exists pair_own on public.capture_pair;
create policy pair_own on public.capture_pair for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists pair_company_read on public.capture_pair;
create policy pair_company_read on public.capture_pair for select to authenticated
  using (is_project_visible(project_id));

-- The device never writes this table directly; the RPC below is the only door. Same
-- rule as capture/attachment (010) — a client that can INSERT arbitrary rows can
-- attribute somebody else's photo to its own walkthrough.
revoke insert, update, delete on public.capture_pair from authenticated;

-- APPEND-ONLY. A pairing describes a moment that already happened.
create or replace function public.capture_pair_append_only() returns trigger
  language plpgsql as $$
begin
  raise exception 'capture_pair is append-only (pair % capture %)', old.pair_id, old.capture_id
    using errcode = '42501';
end $$;

drop trigger if exists capture_pair_immutable on public.capture_pair;
create trigger capture_pair_immutable
  before update or delete on public.capture_pair
  for each row execute function public.capture_pair_append_only();

-- ─── THE ONLY DOOR ──────────────────────────────────────────────────────────────
-- Idempotent by primary key: the device re-sends on every retry and a replay must be a
-- no-op, not a duplicate or an error. `auth.uid()` is taken from the session rather
-- than the payload — a client does not get to nominate whose pairing this is.
create or replace function public.ingest_pair_v1(
  p_pair_id    text,
  p_capture_id text,
  p_role       text,
  p_at_ms      bigint,
  p_project_id text
) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_role not in ('photo','voice') then
    raise exception 'role must be photo or voice, got %', p_role using errcode = '23514';
  end if;

  insert into public.capture_pair (pair_id, capture_id, role, at_ms, owner_id, project_id)
  values (p_pair_id, p_capture_id, p_role, p_at_ms, uid, p_project_id)
  on conflict (pair_id, capture_id) do nothing;

  return jsonb_build_object('status','ok','pair_id',p_pair_id,'capture_id',p_capture_id);
end $$;

grant execute on function public.ingest_pair_v1(text, text, text, bigint, text) to authenticated;
