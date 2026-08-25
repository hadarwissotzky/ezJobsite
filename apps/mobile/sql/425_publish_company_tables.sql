-- 425 — put the company tables on the wire.
--
-- hadar's review, 2026-08-25. This is the last of the four things that kept the team
-- layer from working, and the only one that is not a bug in any file — it is a piece of
-- setup that was never done.
--
-- ─── WHAT `powersync validate` SAID ─────────────────────────────────────────────
--   ✗ Validate Sync Config
--     [error] Table "public"."company" is not part of publication 'powersync'.
--     [error] Table "public"."company_member" is not part of publication 'powersync'.
--     [warning] [Line 28, Col 52]: Column not found.
--         SELECT id FROM project WHERE company_id IN my_companies
--
-- The publication holds exactly the four tables the July sync bakeoff needed:
-- attachment, capture, capture_op_state, project. `company` and `company_member` were
-- added to Postgres by sql/376 and never added to the publication, so logical
-- replication has never carried a single row of either. The warning is a consequence,
-- not a third problem: with no replicated schema for `company_member`, the sync rule's
-- `my_companies` resolves to nothing, so every reference to it downstream is unknown.
--
-- ─── THIS EXPLAINS THE WORKAROUNDS, NOT JUST THE FEATURE ────────────────────────
-- Every "the local table is empty while the server holds a real one" note in this
-- codebase traces here, and there are a lot of them:
--   · company.ts `resolveMyCompany` — falls back to an RPC because the tables are empty
--   · company.ts `billingTenantId`/`rememberTenantId` — keeps the tenant id in
--     device_settings so billing survives a bucket that never arrives
--   · App.tsx's drawer invite — reads `billingTenantId` because `myCompany` returns null
--     (hadar 2026-08-14: "invite someone doesn't work")
--   · letterhead.ts — reads over PostgREST because "the local table does not sync"
-- Those are four independent patches for one missing line of setup. They can stay after
-- this (they are all correct offline-first fallbacks) but they stop being load-bearing.
--
-- ─── SAFE, AND REVERSIBLE ───────────────────────────────────────────────────────
-- Both tables are keyed by `id text primary key`, so the default replica identity is
-- already sufficient for UPDATE/DELETE replication — no REPLICA IDENTITY FULL needed.
-- Reversible with `ALTER PUBLICATION powersync DROP TABLE ...`.
--
-- WHAT IT PUTS ON THE WIRE, said plainly: company names, plans and letterhead columns,
-- and the roster — user ids, roles, and members' display names — now replicate to the
-- PowerSync Cloud instance in `powersync/cli.yaml`. That is the same instance already
-- carrying captures, attachments and project addresses, so it widens what is there
-- rather than reaching anywhere new.
--
-- ─── ORDER MATTERS ──────────────────────────────────────────────────────────────
-- Apply this BEFORE deploying the sync rules in powersync/sync-config.yaml. Deploying
-- rules that reference unpublished tables is what the validate error above is; with the
-- publication fixed, re-run `powersync validate` and it should pass clean, then
-- `powersync deploy sync-config`.
--
-- IDEMPOTENT. `ALTER PUBLICATION ... ADD TABLE` errors if the table is already a member,
-- so each add is guarded by a catalogue check and this file can be re-run safely.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'powersync') then
    raise exception 'publication "powersync" does not exist — is this the right database?'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'powersync' and schemaname = 'public' and tablename = 'company'
  ) then
    alter publication powersync add table public.company;
    raise notice '425: added public.company to publication powersync';
  else
    raise notice '425: public.company was already published — nothing to do';
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'powersync' and schemaname = 'public' and tablename = 'company_member'
  ) then
    alter publication powersync add table public.company_member;
    raise notice '425: added public.company_member to publication powersync';
  else
    raise notice '425: public.company_member was already published — nothing to do';
  end if;
end $$;

-- What is on the wire now, printed so the run is self-verifying.
do $$
declare tables text;
begin
  select string_agg(tablename, ', ' order by tablename) into tables
    from pg_publication_tables where pubname = 'powersync' and schemaname = 'public';
  raise notice '425: publication powersync now carries: %', tables;
end $$;

-- NOTE — company_invite is deliberately NOT published. sql/376 and AppSchema.ts both
-- say so: the owner reads an invite over PostgREST and hands the token off immediately,
-- and a live token has no business sitting in a replicated bucket on anybody's phone.
