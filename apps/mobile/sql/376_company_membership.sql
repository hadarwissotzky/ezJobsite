-- Company / tenant membership — REQ-ORG1, REQ-ROLE1, REQ-AUTH2, REQ-MEMBER-5.
--
-- WHAT THIS ADDS. A first-class COMPANY groups a set of users and their projects.
-- Members hold a ROLE (owner · crew · sub). Chosen scope (hadar 2026-07-25):
-- COMPANY-WIDE visibility — every active member may READ the company's projects and
-- the evidence under them. WRITES stay owner-scoped: "the creator owns their own
-- content" (REQ-ORG1) — a member reads a teammate's extra, never rewrites it. Client
-- (no-login counterparty) never holds a membership row.
--
-- SAFETY. Purely ADDITIVE: new tables, a nullable project.company_id (backfilled to
-- each owner's own company), new SELECT policies that only WIDEN read access, and
-- SECURITY DEFINER RPCs that re-check auth.uid() internally (the server is the
-- authority on tenancy — an offline client cannot escalate its own role, REQ-ORG1).
-- No existing policy is dropped or narrowed; the sync rules still gate what actually
-- downloads until they are updated separately.

-- ── 1. Tables ────────────────────────────────────────────────────────────────
create table if not exists public.company (
  id          text primary key,               -- client-minted 'cmp-...'
  name        text not null,
  owner_id    uuid not null,                   -- auth.uid() of the creator
  created_at  timestamptz not null default now()
);

create table if not exists public.company_member (
  id          text primary key,
  company_id  text not null references public.company(id),
  user_id     uuid not null,
  role        text not null default 'crew' check (role in ('owner','crew','sub')),
  status      text not null default 'active'  check (status in ('active','revoked')),
  invited_by  uuid,
  joined_at   timestamptz not null default now(),
  unique (company_id, user_id)
);
create index if not exists company_member_user on public.company_member (user_id, status);

-- project.company_id defined HERE (before the functions that read it): a `language
-- sql` function is validated at creation, so the column must already exist.
alter table public.project add column if not exists company_id text references public.company(id);

create table if not exists public.company_invite (
  id           text primary key,
  company_id   text not null references public.company(id),
  token        text not null unique,
  role         text not null default 'crew' check (role in ('crew','sub')),  -- never mint an owner
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  accepted_by  uuid,
  accepted_at  timestamptz
);

-- ── 2. Membership predicate — the one rule, stated once ──────────────────────
create or replace function public.is_company_member(p_company_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_member m
     where m.company_id = p_company_id and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

-- Is a PROJECT visible to me — because I am an active member of the company that
-- owns it. Evidence tables (capture, attachment, change_order …) read through this.
create or replace function public.is_project_visible(p_project_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project p
      join public.company_member m on m.company_id = p.company_id
     where p.id = p_project_id and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

-- ── 3. Backfill (project.company_id added above, before the functions) ───────
-- Every existing owner gets a company (named from their profile, else a default),
-- an owner membership, and all their projects stamped with it. Idempotent.
do $$
declare r record; cid text;
begin
  for r in select distinct owner_id from public.project where company_id is null loop
    select id into cid from public.company where owner_id = r.owner_id limit 1;
    if cid is null then
      cid := 'cmp-' || replace(r.owner_id::text, '-', '');
      -- Default name; the owner's client renames it via create_company on next run.
      insert into public.company (id, name, owner_id)
        values (cid, 'My company', r.owner_id)
        on conflict (id) do nothing;
    end if;
    insert into public.company_member (id, company_id, user_id, role, status)
      values ('cm-' || replace(r.owner_id::text,'-','') || '-' || left(md5(cid),8), cid, r.owner_id, 'owner', 'active')
      on conflict (company_id, user_id) do nothing;
    update public.project set company_id = cid where owner_id = r.owner_id and company_id is null;
  end loop;
end $$;

-- ── 4. RLS: additive company-wide READ. Writes stay owner-only. ──────────────
alter table public.company        enable row level security;
alter table public.company_member enable row level security;
alter table public.company_invite enable row level security;

-- company: a member may see their company; the owner may write it.
drop policy if exists company_read on public.company;
create policy company_read on public.company for select to authenticated
  using (is_company_member(id) or owner_id = auth.uid());
drop policy if exists company_owner_write on public.company;
create policy company_owner_write on public.company for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- company_member: a member sees the roster of their own company; no client writes
-- (membership changes go through the RPCs below, which are the only door).
drop policy if exists member_read on public.company_member;
create policy member_read on public.company_member for select to authenticated
  using (is_company_member(company_id) or user_id = auth.uid());
revoke insert, update, delete on public.company_member from authenticated;

-- company_invite: the owner manages invites; no member-facing read (accept is by RPC).
drop policy if exists invite_owner on public.company_invite;
create policy invite_owner on public.company_invite for all to authenticated
  using (exists (select 1 from public.company c where c.id = company_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.company c where c.id = company_id and c.owner_id = auth.uid()));

-- project: KEEP own_project (owner ALL). ADD a company-wide READ.
drop policy if exists project_company_read on public.project;
create policy project_company_read on public.project for select to authenticated
  using (company_id is not null and is_company_member(company_id));

-- Evidence tables: ADD a company-wide READ via the owning project. Existing
-- owner-only policies remain for writes.
drop policy if exists capture_company_read on public.capture;
create policy capture_company_read on public.capture for select to authenticated
  using (is_project_visible(project_id));
drop policy if exists op_state_company_read on public.capture_op_state;
create policy op_state_company_read on public.capture_op_state for select to authenticated
  using (is_project_visible(project_id));
drop policy if exists attachment_company_read on public.attachment;
create policy attachment_company_read on public.attachment for select to authenticated
  using (is_project_visible(project_id));
drop policy if exists co_company_read on public.change_order;
create policy co_company_read on public.change_order for select to authenticated
  using (is_project_visible(project_id));

-- ── 5. RPCs — the only door to membership. SECURITY DEFINER + auth.uid() checks
-- Create the caller's OWN company (owner membership), idempotent per owner.
create or replace function public.create_company(p_id text, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); existing text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select id into existing from public.company where owner_id = uid limit 1;
  if existing is not null then return existing; end if;
  insert into public.company (id, name, owner_id) values (p_id, p_name, uid);
  insert into public.company_member (id, company_id, user_id, role, status)
    values ('cm-'||left(md5(p_id||uid::text),16), p_id, uid, 'owner', 'active')
    on conflict (company_id, user_id) do nothing;
  return p_id;
end $$;

-- Owner mints an invite token for their company.
create or replace function public.create_company_invite(p_company_id text, p_role text, p_days int default 14)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); tok text; iid text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from public.company where id = p_company_id and owner_id = uid) then
    raise exception 'only the owner can invite' using errcode = '42501';
  end if;
  if p_role not in ('crew','sub') then raise exception 'bad role' using errcode = '22023'; end if;
  tok := replace(gen_random_uuid()::text,'-','');
  iid := 'inv-'||left(tok,16);
  insert into public.company_invite (id, company_id, token, role, created_by, expires_at)
    values (iid, p_company_id, tok, p_role, uid, now() + (p_days || ' days')::interval);
  return jsonb_build_object('token', tok, 'role', p_role,
                            'company_name', (select name from public.company where id = p_company_id));
end $$;
revoke all on function public.create_company_invite(text,text,int) from public, anon;
grant execute on function public.create_company_invite(text,text,int) to authenticated;

-- Anyone authenticated accepts an invite by token → becomes a member.
create or replace function public.accept_company_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); inv public.company_invite;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into inv from public.company_invite where token = p_token;
  if not found then raise exception 'invite not found' using errcode = 'P0002'; end if;
  if inv.expires_at < now() then raise exception 'invite expired' using errcode = '22023'; end if;
  insert into public.company_member (id, company_id, user_id, role, status, invited_by)
    values ('cm-'||left(md5(inv.company_id||uid::text),16), inv.company_id, uid, inv.role, 'active', inv.created_by)
    on conflict (company_id, user_id) do update set status = 'active';
  update public.company_invite set accepted_by = uid, accepted_at = now()
    where id = inv.id and accepted_by is null;
  return jsonb_build_object('company_id', inv.company_id, 'role', inv.role,
                            'company_name', (select name from public.company where id = inv.company_id));
end $$;
revoke all on function public.accept_company_invite(text) from public, anon;
grant execute on function public.accept_company_invite(text) to authenticated;

-- Owner revokes a member (REQ-MEMBER-5) — status flips; sync rules then purge scope.
create or replace function public.revoke_company_member(p_company_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if not exists (select 1 from public.company where id = p_company_id and owner_id = uid) then
    raise exception 'only the owner can revoke' using errcode = '42501';
  end if;
  if p_user_id = uid then raise exception 'the owner cannot revoke themselves' using errcode = '22023'; end if;
  update public.company_member set status = 'revoked' where company_id = p_company_id and user_id = p_user_id;
end $$;
revoke all on function public.revoke_company_member(text,uuid) from public, anon;
grant execute on function public.revoke_company_member(text,uuid) to authenticated;

grant execute on function public.create_company(text,text) to authenticated;
grant execute on function public.is_company_member(text) to authenticated;
grant execute on function public.is_project_visible(text) to authenticated;
