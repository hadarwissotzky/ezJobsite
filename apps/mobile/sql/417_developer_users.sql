-- 417 — a developer flag on a user.
--
-- hadar, 2026-08-18: "I would like to create a flag on users — a developer user, that
-- user can see features that no one else can see, for example show intro (dev) or replay
-- first change order."
--
-- ─── WHAT THIS REPLACES, AND WHY IT IS NOT ENOUGH TODAY ─────────────────────────
-- Those two tools exist and are gated on `__DEV__`, which is a BUILD-TIME constant: the
-- bundler strips them from any release build. That is correct for shipping and useless
-- for the case hadar actually has — wanting to replay the intro on a TestFlight or App
-- Store build, on his own phone, where `__DEV__` is false.
--
-- A build-time gate cannot answer "who is holding the phone". This can.
--
-- ─── NOBODY CAN GRANT THEMSELVES ────────────────────────────────────────────────
-- The point of a flag that reveals hidden surfaces is that it is not self-service. RLS
-- here has exactly ONE policy — SELECT, own row only. There is no INSERT, UPDATE or
-- DELETE policy at all, so an authenticated client can read whether IT is a developer and
-- can do nothing else: not grant, not revoke, not enumerate. Rows are added by whoever
-- holds the service key or a psql session, which is deliberate friction.
--
-- ─── IT IS A VISIBILITY FLAG, NOT A PERMISSION ──────────────────────────────────
-- Stated because the next person to touch this will be tempted. Everything it unlocks
-- must be something the user could already do to HIS OWN data — replay an intro, re-run a
-- walkthrough, see a diagnostic. It must never become the check that lets someone read
-- another company's rows, spend credits, or bypass an approval: those are authorisation
-- decisions and belong to the predicates that already own them (`is_project_visible`,
-- `company_member`, the reservation). A convenience flag that quietly becomes an
-- authorisation flag is how an internal tool turns into a privilege-escalation bug.
create table if not exists public.developer_user (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- Why this person has it. Free text, for the human who finds the row in a year and
  -- wonders whether it is still needed.
  note       text,
  granted_at timestamptz not null default now()
);

alter table public.developer_user enable row level security;

-- READ YOUR OWN ROW. Nothing else. A developer cannot list other developers, and a
-- normal user's read simply returns no rows — which is the answer "no", delivered
-- without telling them the table has anything in it.
drop policy if exists developer_user_read_own on public.developer_user;
create policy developer_user_read_own on public.developer_user
  for select to authenticated using (user_id = auth.uid());

-- ── seed ────────────────────────────────────────────────────────────────────────
-- BY EMAIL, not by a pasted uuid. A hardcoded id is unreadable a month later and wrong
-- in any other environment; the email says who this is and fails silently in an
-- environment where that account does not exist, which is the correct outcome.
--
-- NOT "every company owner" — that would hand the flag to every customer the moment they
-- sign up, which is the opposite of what a hidden surface is for.
insert into public.developer_user (user_id, note)
select id, 'hadar — product owner, 2026-08-18'
  from auth.users where lower(email) = 'hadar@streamlinesocial.com'
on conflict (user_id) do nothing;
