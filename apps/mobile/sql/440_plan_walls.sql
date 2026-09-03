-- 440 — the free plan becomes a WALL on the server, not just a modal on the phone.
--
-- ─── WHY ────────────────────────────────────────────────────────────────────────
-- hadar, 2026-09-03: "it keeps letting me create more jobs ... although i am on the
-- free plan and my quota is done", and when asked whether caps are nudges or walls:
-- "walls toward pushing user into a paid account".
--
-- Every cap in this product has been client-side only. `quota.ts:152` says so in as
-- many words about members — "this is the friendly modal and not the wall. A second
-- device racing the count, or a direct RPC call, still gets through." That was true of
-- every limit, not just members. A reinstall, a second phone, or anyone with the anon
-- key and a REST client walks past all of them.
--
-- ─── WHAT THIS ENFORCES, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────
-- JOBS: enforced here. A refused project INSERT costs nothing — the project simply is
-- not created, and the contractor is told by the modal the client already shows.
--
-- PHOTOS AND RECORDING: NOT enforced here, on purpose, and this is the whole judgement
-- in this file. A photo reaches the server only after it has been captured and
-- committed on the device, where mandate #1 has already promised it is safe. Refusing
-- that INSERT would not stop the photo being taken; it would strand evidence that the
-- app has already told a contractor it is keeping, and park an outbox row that can
-- never drain. A billing rule may not be paid for with somebody's evidence.
--
-- So the photo cap belongs at the SHUTTER, before the capture exists, which is where it
-- now lives (capturescreen.tsx, 2026-09-03). The server's job is to refuse what can be
-- refused cleanly. That is not a weaker wall, it is the wall in the only place it can
-- stand without breaking a stronger promise.
--
-- ─── THE NUMBERS LIVE IN A TABLE ────────────────────────────────────────────────
-- `plan_limit` rather than constants in a function body, because `plans.ts` holds the
-- client's copy and two hard-coded lists WILL drift — that is this project's most
-- reliable defect. A table can at least be read, diffed and corrected in one statement.
-- It is still a second copy: whoever changes `plans.ts` must change this table, and
-- there is no test that will catch them forgetting. Named here so it is a known gap
-- rather than a surprise.

-- ── 1. the numbers ──────────────────────────────────────────────────────────────
create table if not exists public.plan_limit (
  plan  text primary key,
  -- NULL means unlimited. Not a huge sentinel integer: "no limit" and "a very large
  -- limit" are different facts and only one of them is true of a paid plan.
  jobs  integer
);

comment on table public.plan_limit is
  'Server-side plan caps. The peer of planLimits() in apps/mobile/src/plans.ts — '
  'change one and you must change the other; nothing enforces that.';

insert into public.plan_limit (plan, jobs) values
  ('free', 2), ('core', null), ('pro', null), ('business', null)
on conflict (plan) do update set jobs = excluded.jobs;

-- ── 2. which plan an owner is on ────────────────────────────────────────────────
-- Mirrors `currentPlan` on the device: the BEST plan across the owner's companies,
-- defaulting to free. An owner with no company row is free, which is correct — that is
-- exactly what a brand-new account is.
create or replace function public.plan_for_owner(p_owner uuid) returns text
  language sql stable
  set search_path = public
as $$
  select coalesce(
    (select c.plan
       from public.company c
      where c.owner_id = p_owner
        and c.plan is not null
      order by case c.plan when 'business' then 4 when 'pro' then 3
                           when 'core' then 2 else 1 end desc
      limit 1),
    'free');
$$;

-- ── 3. the job wall ─────────────────────────────────────────────────────────────
create or replace function public.project_within_plan() returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  v_limit integer;
  v_count integer;
begin
  select l.jobs into v_limit
    from public.plan_limit l
   where l.plan = public.plan_for_owner(new.owner_id);

  -- Unlimited, or a plan this table has never heard of. An UNKNOWN plan is treated as
  -- unlimited rather than capped: a paid customer wrongly refused is a far worse
  -- outcome than a free one wrongly allowed, and the client modal still holds the
  -- ordinary case.
  if v_limit is null then return new; end if;

  -- ARCHIVED JOBS DO NOT COUNT, matching `jobCount` on the device, which filters to
  -- active. The modal's own words are "archive one you're done with, or upgrade", and
  -- a server that ignored archiving would make that sentence a lie.
  select count(*) into v_count
    from public.project p
   where p.owner_id = new.owner_id
     and coalesce(p.status, 'in_progress') <> 'archived';

  if v_count >= v_limit then
    raise exception
      'plan limit reached: % of % locations on the % plan',
      v_count, v_limit, public.plan_for_owner(new.owner_id)
      using errcode = '53400',
            hint = 'archive a location or upgrade the plan';
  end if;
  return new;
end $$;

drop trigger if exists project_plan_wall on public.project;
create trigger project_plan_wall
  before insert on public.project
  for each row execute function public.project_within_plan();

-- ── 4. who may read the numbers ─────────────────────────────────────────────────
-- The app shows "your free plan includes up to 2 locations", so the limits are not a
-- secret and the client is allowed to read them. Nobody may write them.
alter table public.plan_limit enable row level security;
drop policy if exists plan_limit_read on public.plan_limit;
create policy plan_limit_read on public.plan_limit for select to authenticated using (true);

revoke all on function public.plan_for_owner(uuid) from public, anon;
grant execute on function public.plan_for_owner(uuid) to authenticated;
