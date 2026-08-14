-- 405 — one tenant per PERSON, decided on the server.
--
-- hadar, 2026-08-13: "we cannot use phone number for the company, because a member might
-- use their phone number as a user of an existing company and have their own account as
-- a freelancer."
--
-- ─── THE IDENTITY THIS SETTLES ──────────────────────────────────────────────────
-- One phone number is one auth user. That one user may be BOTH:
--   * crew on somebody else's company, and
--   * a freelancer with work of their own.
-- Those are not two accounts. They are one person with one or more MEMBERSHIPS, and
-- exactly one of those memberships may be an ownership. Nothing about the tenant may be
-- derived from the phone number, because the phone identifies the person, not the firm.
--
-- ─── WHY IT MOVED OUT OF THE CLIENT ─────────────────────────────────────────────
-- The app decided this by reading its LOCAL `company_member` table. That table is
-- PowerSync-synced, and on hadar's device it is empty while the server holds a real
-- membership (2026-08-13: company 0 rows locally, `create_company` returning an existing
-- `cmp-<uuid>` server-side). A client that mints a tenant whenever its local copy looks
-- empty will hand a personal company to a crew member the moment sync lags — and
-- `myCompany()` prefers an OWNED company over a member one, so from then on their
-- captures would file under a tenant they never asked for.
--
-- The client cannot answer "does this person already belong somewhere?" because the
-- client's copy is a cache. The server can, always.
--
-- ─── THE RULE ───────────────────────────────────────────────────────────────────
--   * ANY active membership -> return it. Crew stay crew; a freelancer who later joins
--     a company is not given a second tenant.
--   * none at all -> create one, owned by this user, named by the caller.
-- Idempotent, so it is safe on every launch, which is exactly when it runs.
create or replace function public.ensure_billing_tenant(
  p_name text, p_display_name text default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
        found text;
        new_id text;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- ANY active membership counts, owned or not. This is the clause that keeps a crew
  -- member from being given a company of their own behind their back.
  select cm.company_id into found
    from public.company_member cm
   where cm.user_id = uid and cm.status = 'active'
   -- Prefer an owned one when a person legitimately has both, so the answer is stable.
   order by (select case when c.owner_id = uid then 0 else 1 end
               from public.company c where c.id = cm.company_id), cm.company_id
   limit 1;
  if found is not null then return found; end if;

  -- A NAME IS REQUIRED. This string is printed at the top of documents a client signs;
  -- "Untitled" on a change order is worse than refusing to create the row yet.
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a tenant needs a name' using errcode = '22023';
  end if;

  -- Deterministic from the user id, matching 376's backfill format, so a person who was
  -- backfilled and a person created here can never end up with two ids for one tenant.
  new_id := 'cmp-' || replace(uid::text, '-', '');
  insert into public.company (id, name, owner_id)
    values (new_id, btrim(p_name), uid)
    on conflict (id) do nothing;
  insert into public.company_member (id, company_id, user_id, role, status, display_name)
    values ('cm-' || replace(uid::text,'-','') || '-' || left(md5(new_id),8),
            new_id, uid, 'owner', 'active', nullif(btrim(p_display_name),''))
    on conflict (company_id, user_id) do nothing;
  return new_id;
end $$;

revoke all on function public.ensure_billing_tenant from public, anon;
grant execute on function public.ensure_billing_tenant to authenticated;
