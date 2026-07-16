-- ============================================================================
-- SYNC BAKEOFF — THROWAWAY SCHEMA (spike only; NOT production, NOT a migration)
-- Per SPIKE-SYNC-BAKEOFF.md:94 — "A tiny schema: one immutable `capture`
-- (evidence), one mutable `capture_op_state` field, one `attachment`
-- (encrypted media). Include a `seq bigint DEFAULT nextval(…)` column on the
-- capture table ... as the Q1 negative control."
--
-- Field ownership is PREDECLARED in docs/BAKEOFF-PREDECLARATION.md §2.
-- Do not change ownership here without changing it there FIRST.
-- ============================================================================

drop table if exists public.attachment cascade;
drop table if exists public.capture_op_state cascade;
drop table if exists public.capture cascade;
drop table if exists public.project cascade;
drop sequence if exists public.capture_seq cascade;

-- The Q1 negative control. nextval() is NON-transactional: session A can take
-- seq=10 and commit LATER than session B which took seq=11. That inversion is
-- precisely the fault our hand-built seq-cursor design died on (Codex #7
-- blocker #1). PowerSync does not use this column — it exists ONLY to prove the
-- inversion genuinely occurred in each trial.
create sequence public.capture_seq;

-- ---------------------------------------------------------------------------
-- project — carries the SERVER-owned `status` (drives Q7 windowing)
-- ---------------------------------------------------------------------------
create table public.project (
  id          text primary key,
  owner_id    uuid not null,
  name        text not null,
  -- SERVER-owned per predeclaration §2. Client writes must be REJECTED.
  status      text not null default 'active' check (status in ('active','archived')),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- capture — IMMUTABLE evidence. Insert-only; UPDATE/DELETE blocked by trigger.
-- ---------------------------------------------------------------------------
create table public.capture (
  id                text primary key,
  owner_id          uuid not null,
  project_id        text not null references public.project(id) on delete cascade,
  seq               bigint not null default nextval('public.capture_seq'),  -- Q1 negative control
  trial             int,          -- Q1 trial number
  label             text,         -- Q1: 'A' (late committer) or 'B' (early committer)
  payload           text not null,
  payload_sha256    text not null,
  client_created_at timestamptz,  -- NOT an ordering authority (Codex #6 C5)
  inserted_at       timestamptz not null default clock_timestamp()
);
create index on public.capture (project_id);
create index on public.capture (seq);

-- Append-only enforcement (SPIKE-SYNC-BAKEOFF.md:16 — immutability is enforced
-- by OUR rules, not by the transport).
create or replace function public.capture_is_immutable() returns trigger
  language plpgsql as $$
begin
  raise exception 'capture is append-only (immutable evidence): % blocked', tg_op;
end $$;

create trigger capture_no_update before update on public.capture
  for each row execute function public.capture_is_immutable();
create trigger capture_no_delete before delete on public.capture
  for each row execute function public.capture_is_immutable();

-- ---------------------------------------------------------------------------
-- capture_op_state — MUTABLE operational state (the evidence/operational split)
-- ---------------------------------------------------------------------------
create table public.capture_op_state (
  id                text primary key,   -- mirrors capture.id (PowerSync needs a PK named id)
  capture_id        text not null unique references public.capture(id) on delete cascade,
  owner_id          uuid not null,
  -- SERVER-owned per predeclaration §2. Client writes must be REJECTED.
  processing_state  text not null default 'captured'
                      check (processing_state in ('captured','queued','uploaded','processed')),
  -- CLIENT-owned per predeclaration §2. Pending offline edit must WIN (LWW by upload order).
  resolution_status text not null default 'unresolved'
                      check (resolution_status in ('unresolved','resolved','overridden')),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- attachment — encrypted media metadata (Option B). Q3 is DEFERRED; schema
-- present so the shape is settled. Ciphertext lives in Supabase Storage.
-- ---------------------------------------------------------------------------
create table public.attachment (
  id                text primary key,
  capture_id        text not null references public.capture(id) on delete cascade,
  owner_id          uuid not null,
  object_key        text not null unique,   -- immutable deterministic key; never overwritten
  ciphertext_sha256 text,
  ciphertext_len    bigint,
  -- Option B envelope. NOTE: DURABILITY-DESIGN-v1 selects Option B but does NOT
  -- design it — IMPLEMENTATION_NOTES.md:199 confirms "where device- and
  -- server-wrapped DEKs live" is UNSPECIFIED. These columns are a SPIKE-LOCAL
  -- guess so Q3 has somewhere to put the wrapped key. Not a design decision.
  wrapped_dek_device text,
  wrapped_dek_server text,
  aead_nonce         text,
  aead_alg           text,
  state              text not null default 'pending'
);

-- ---------------------------------------------------------------------------
-- RLS + column grants — the Q2 "server-owned field" enforcement must be at the
-- DB boundary, not convention. Column-level UPDATE grants are what make a
-- client write to processing_state actually FAIL.
-- ---------------------------------------------------------------------------
alter table public.project          enable row level security;
alter table public.capture          enable row level security;
alter table public.capture_op_state enable row level security;
alter table public.attachment       enable row level security;

create policy own_project   on public.project          for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy own_capture   on public.capture          for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy own_opstate   on public.capture_op_state for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy own_attach    on public.attachment       for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Column-level grants: authenticated clients may UPDATE ONLY the client-owned
-- column. This is what makes predeclaration §2's "must not reach Postgres" real.
revoke update on public.capture_op_state from authenticated;
grant  update (resolution_status, updated_at) on public.capture_op_state to authenticated;
grant  select, insert on public.capture_op_state to authenticated;

revoke update on public.project from authenticated;   -- status is server-owned
grant  select on public.project to authenticated;

grant select, insert on public.capture to authenticated;   -- immutable: no update grant
grant select, insert, update on public.attachment to authenticated;

-- ---------------------------------------------------------------------------
-- Q1 evidence helper — records the causal ordering the advisory-lock harness
-- creates. track_commit_timestamp is OFF on Supabase and we are not superuser,
-- so commit order is established CAUSALLY (session A is physically blocked from
-- committing until the harness releases the lock) and proven by third-connection
-- visibility checks — which is stronger than an observed timestamp.
-- ---------------------------------------------------------------------------
create table if not exists public.q1_trial_log (
  trial          int primary key,
  seq_a          bigint,
  seq_b          bigint,
  b_committed_at timestamptz,
  a_committed_at timestamptz,
  device_saw_b_at        timestamptz,
  device_saw_b_checkpoint text,
  a_invisible_at_device_observation boolean,
  inversion_observed     boolean generated always as (seq_a < seq_b) stored,
  outcome        text,
  notes          text
);
