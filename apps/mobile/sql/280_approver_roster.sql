-- 280_approver_roster.sql
--
-- R5c — WHO IS ENTITLED TO APPROVE ON THIS JOB, and what kind of extra this is.
--
-- The need (PRD R5c): today the recipient is picked by hand on every send and the
-- only clue the system has is GPS. A jobsite has more than one person who can say
-- yes, and which one depends on what the extra is. Picking wrong is worse than
-- slow -- a priced commitment sent to someone who cannot authorise it is an
-- approval that does not bind.
--
-- WHY A NEW TABLE AND NOT `project_party`:
--   project_party (120_parties.sql) is a per-project list of people, so reuse is the
--   obvious first thought. It is the wrong table, and that file says so itself at
--   line 14: "'trade', NOT 'role' -- Member.role is office/field/sub. The spec
--   renamed this to stop the exact confusion that makes one trade assume the other
--   had it." A party is a company doing work. An approver is a person entitled to
--   authorise money. The homeowner is an approver and never a party; a drywall sub
--   is a party and never an approver. Overloading one row with both would re-create
--   precisely the confusion 120 renamed a column to prevent, and would mean removing
--   a sub from the job silently removes an approver.
--   Some people are genuinely both. That is two facts about one person, not one fact
--   stored twice.
--
-- SCOPE OF WHAT IS BUILT (honest, because R5c is bigger than this file):
--   BUILT: the taxonomy, the roster, and the routing SUGGESTION.
--   NOT BUILT: inferring the type from narration and photos at structuring (R2).
--   R5c's open question (a) says the taxonomy "must be derived from real captures,
--   not invented at a desk", and there are no real captures yet. So v1 is
--   CONTRACTOR-SET -- which R5c's open question (c) explicitly allows, and which
--   mandate #2 requires anyway: the contractor confirms the type regardless, so
--   inference only ever saves a tap. It never earns the right to skip one.

create table if not exists public.project_approver (
  id            text primary key,
  project_id    text not null,
  owner_id      uuid not null,
  name          text not null check (length(btrim(name)) > 0),

  -- The six roles from R5c. Kept short on purpose: a wrong guess has to be obvious
  -- to someone reading it on a phone.
  role          text not null check (role in
                  ('owner','general_contractor','designer',
                   'internal_specialist','property_manager','other')),

  -- Nullable: the roster records WHO may approve even before we know how to reach
  -- them. A half-known person is worth more than an empty roster, and demanding a
  -- phone number up front is how the roster never gets filled in at all.
  phone_e164    text,
  email         text,

  -- Retire, never delete: an extra already sent to this person names them, and that
  -- record has to keep resolving. Same active/removed shape as project_party.
  status        text not null default 'active' check (status in ('active','removed')),

  -- Can this person commit the client's money? NULL = never asked; the role default
  -- applies (owner and general_contractor bind money, nobody else does by default).
  -- NULL is kept distinct from false on purpose: "we did not ask" earns a visible
  -- caveat on the suggestion, "we asked and they cannot" earns a skip. Collapsing
  -- them would silently route a priced commitment to someone who cannot authorise
  -- it, which is an approval that does not bind.
  can_bind_money boolean,

  last_used_ms  bigint not null default 0,
  created_at_ms bigint not null
);

create index if not exists approver_by_project
  on public.project_approver (project_id, status);

alter table public.project_approver enable row level security;
drop policy if exists approver_own on public.project_approver;
create policy approver_own on public.project_approver for select to authenticated
  using (owner_id = auth.uid());

-- Writes go through the device outbox, not straight from the client -- same as
-- project_party (120) and change_order. The client never holds insert/update/delete
-- on the table itself.
revoke insert, update, delete on public.project_approver from authenticated;

-- ── the type on the extra ────────────────────────────────────────────────────
-- Nullable, and that is a FIRST-CLASS state, not a missing value. R5c's last AC:
-- "Given classification is unavailable (offline, model down), when the preview
-- renders, then the extra is untyped, Send-to falls back to recents, and nothing is
-- blocked." An untyped extra is a normal extra. Mandate #7: the network is never a
-- precondition to recording a decision.
alter table public.change_order
  add column if not exists extra_type text;

alter table public.change_order
  drop constraint if exists change_order_extra_type_known;
alter table public.change_order
  add constraint change_order_extra_type_known check (
    extra_type is null or extra_type in
      ('structural','mep','finish','code_permit','site_condition','scope_clarification')
  );
