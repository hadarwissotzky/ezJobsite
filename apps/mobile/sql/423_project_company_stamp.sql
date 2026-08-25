-- 423 — every job belongs to a company. The backstop + the backfill.
--
-- hadar's review, 2026-08-25.
--
-- ─── WHAT WAS BROKEN ────────────────────────────────────────────────────────────
-- sql/376 added `project.company_id`, backfilled the rows that existed that day, and
-- built the entire team layer on top of it. Nothing ever wrote the column again. The
-- client's `createProject` (apps/mobile/src/projects.ts) listed eleven columns and not
-- that one, and `ingest_project_v1` (sql/100) does not set it either — so every job
-- created after 2026-07-25 carried NULL.
--
-- NULL is the value all three consumers test against:
--   · RLS `project_company_read` — `company_id is not null and is_company_member(...)`
--   · the PowerSync rule      — `SELECT id FROM project WHERE company_id IN my_companies`
--   · `notif_recipients` (416) — reaches the crew by joining through it
-- So a crew member could accept an invite, land on the roster, and open an app with
-- nothing in it; and the whole-crew notifications added in 416 reached only the owner.
-- Company-wide visibility was chosen in July and has never actually shipped.
--
-- 416's own header calls `company_id IS NULL` a condition of "projects created before
-- company membership existed". That was true when it was written and false by then —
-- exactly the drift CLAUDE.md §3.1 makes BLAST RADIUS mandatory to catch.
--
-- ─── WHY A TRIGGER, WHEN THE CLIENT NOW SETS IT ─────────────────────────────────
-- The client fix is the real one: only the device knows which company the person is
-- ACTIVE in, and `company.ts` keeps that choice per-device on purpose (the office iPad
-- on the company, the personal phone on freelance work). The server cannot read that.
--
-- But the client cannot always answer either — a first job created offline, before the
-- `company` bucket has ever arrived, has no truthful id to write. And older builds are
-- still out there queueing NULL rows that will upload for weeks. This trigger catches
-- both, at the one moment every row must pass through.
--
-- ─── IT REFUSES TO GUESS ────────────────────────────────────────────────────────
-- It fills the column ONLY when the owner has exactly ONE active membership. A person
-- who is crew on one company and a freelancer besides has two, and there is no fact on
-- the server that says which one this job is. Filing it into the wrong company would
-- publish a jobsite — its address, its photos, its prices — to a crew that should not
-- see it, and nobody would ever look for it in the place it went. Rule 2 at the top of
-- projects.ts governs: a wrong auto-file is worse than an unresolved one. Ambiguous
-- rows keep NULL and stay private to their creator, who still reaches them through the
-- existing owner-only policy.
--
-- Purely additive: one BEFORE INSERT trigger that only ever fills a NULL, and one
-- backfill UPDATE with the same rule. No policy, RPC or grant is changed.

-- ── 1. The rule, stated once ────────────────────────────────────────────────────
-- The single company a user unambiguously belongs to, or NULL when it is not single.
-- SECURITY DEFINER + a pinned search_path, like every other function in this schema:
-- it is called from a trigger, where there is no auth context to rely on, so it takes
-- the user as an argument rather than reading auth.uid().
create or replace function public.sole_company_of(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when count(*) = 1 then min(company_id) else null end
    from public.company_member
   where user_id = p_user and status = 'active';
$$;

-- ── 2. The backstop ─────────────────────────────────────────────────────────────
create or replace function public.project_stamp_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Only ever FILLS. A client that sent a company_id has already answered the question
  -- with knowledge this trigger does not have, and must not be second-guessed here.
  if new.company_id is null and new.owner_id is not null then
    new.company_id := public.sole_company_of(new.owner_id);
  end if;
  return new;
end $$;

drop trigger if exists project_stamp_company_ins on public.project;
create trigger project_stamp_company_ins
  before insert on public.project
  for each row execute function public.project_stamp_company();

-- ── 3. The backfill ─────────────────────────────────────────────────────────────
-- Every orphaned job, under the same refuse-to-guess rule. Idempotent: it touches only
-- NULLs, so re-running it is a no-op. Ambiguous owners are reported rather than
-- silently skipped — a backfill that quietly leaves rows behind is how "it's fixed"
-- becomes untrue.
do $$
declare filled int; left_null int; ambiguous int;
begin
  update public.project p
     set company_id = public.sole_company_of(p.owner_id)
   where p.company_id is null
     and public.sole_company_of(p.owner_id) is not null;
  get diagnostics filled = row_count;

  select count(*) into left_null from public.project where company_id is null;
  select count(distinct p.owner_id) into ambiguous
    from public.project p
   where p.company_id is null
     and (select count(*) from public.company_member m
           where m.user_id = p.owner_id and m.status = 'active') > 1;

  raise notice '423 backfill: % projects stamped, % still NULL (% of them owned by users with more than one active membership — these need a human to say which)',
    filled, left_null, ambiguous;
end $$;

revoke all on function public.sole_company_of(uuid) from public, anon;
grant execute on function public.sole_company_of(uuid) to authenticated;
