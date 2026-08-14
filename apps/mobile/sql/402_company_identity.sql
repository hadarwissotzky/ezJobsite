-- 402 — who is asking. The contractor's identity on the client's page.
--
-- hadar, 2026-08-10: "we are missing key elements", pointing at the top of the portal
-- design — the company logo and tagline, the company's address / phone / email inside
-- the document, and the named contact card (John Davis · Project Manager · phone ·
-- email) beside it.
--
-- ─── WHY NONE OF IT RENDERED ────────────────────────────────────────────────────
-- It was never missing from the PAGE. It is missing from the PRODUCT. `company` holds
-- id, name, owner_id, created_at and three plan columns — no address, no phone, no
-- email, no logo, no tagline — and there is no server-side record of a person at all:
-- the contractor's own name lives in `device_settings` on his phone and has never
-- left it. So the portal had a company_name string and nothing else to draw.
--
-- ─── WHY THIS BELONGS ON THE CLIENT'S PAGE AT ALL ───────────────────────────────
-- Not decoration. A homeowner is being asked to authorise money by a link that
-- arrived in a text message, from a number they may not have saved. Every real change
-- order on paper carries the contractor's licence-bearing letterhead and a human being
-- to call. A page that says only "Dealer deale" and shows a price is asking for a
-- signature while withholding the two facts that make it checkable: who this is, and
-- how to reach them.
--
-- ─── THE SHAPE ──────────────────────────────────────────────────────────────────
-- Two objects, because they answer two different questions and change at different
-- rates:
--   * the COMPANY — letterhead. One per company, edited rarely.
--   * the CONTACT — a person. One per user, and the one who SENT this document, which
--     is not always the owner of the company.
-- Every field is nullable and the page omits what is blank. A half-filled business
-- card is normal and must render as a shorter card, never as "Not set" beside a price.

alter table public.company add column if not exists tagline   text;
alter table public.company add column if not exists address   text;
alter table public.company add column if not exists phone     text;
alter table public.company add column if not exists email     text;
-- A Storage object key, not a URL. URLs expire and get regenerated; the key is stable
-- and the signed URL is minted at read time, exactly like the approval photos.
alter table public.company add column if not exists logo_key  text;

-- ── the person ──────────────────────────────────────────────────────────────────
--
-- Keyed by auth user, NOT by company: one human has one card, and it follows them if
-- they are a member of two companies. `title` is free text on purpose — "Project
-- Manager", "Owner", "Foreman" are all correct and none of them is an enum this
-- product gets to define for a two-person outfit.
create table if not exists public.contractor_profile (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  title        text,
  phone        text,
  email        text,
  avatar_key   text,
  updated_at   timestamptz not null default now()
);

alter table public.contractor_profile enable row level security;

-- A member may read their own row and write their own row. Nothing else: the client's
-- page reaches it only through the SECURITY DEFINER function below, scoped by token.
drop policy if exists contractor_profile_own on public.contractor_profile;
create policy contractor_profile_own on public.contractor_profile
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── the read the portal makes ───────────────────────────────────────────────────
--
-- ONE call for both objects. The page already makes six parallel RPCs against a
-- three-second budget on a jobsite phone; a seventh and an eighth for two rows on the
-- same document would be two more round trips for one paragraph of letterhead.
--
-- SCOPED BY TOKEN, and the contact is resolved from the confirmation's OWNER — the
-- user whose device sent it — not from the company owner. On a two-person crew those
-- are the same person; on a larger one, the card must name whoever the client should
-- actually call about THIS change order.
--
-- NO LIVE-TOKEN GATE, unlike 399's project view. Letterhead is not a window onto the
-- job's money: a client re-opening a document they signed in July still needs to know
-- who they signed it with, and hiding it would make an old record less checkable
-- rather than more private.
create or replace function public.confirmation_company_v1(p_token text)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare owner uuid;
        proj  text;
        out   jsonb;
begin
  select cr.owner_id, cr.project_id into owner, proj
    from public.confirmation_request cr where cr.token = p_token;
  if owner is null then return '{}'::jsonb; end if;

  select jsonb_build_object(
    -- TWO WAYS TO FIND THE COMPANY, and the second one is not a nicety.
    -- `project.company_id` is the right link and is NULL on every project created
    -- before company membership existed — including the one this confirmation is on,
    -- which is how this was found. Falling back to the SENDER's own company keeps the
    -- letterhead correct for those, and it is the same company in every case where
    -- both are set: the person who sent the document works there.
    'company', (
      select jsonb_build_object(
               'name', co.name, 'tagline', co.tagline, 'address', co.address,
               'phone', co.phone, 'email', co.email, 'logo_key', co.logo_key)
        from public.company co
       where co.id = (select p.company_id from public.project p where p.id = proj)
          or (
            (select p2.company_id from public.project p2 where p2.id = proj) is null
            and co.owner_id = owner
          )
       order by (co.id = (select p3.company_id from public.project p3 where p3.id = proj)) desc
       limit 1
    ),
    'contact', (
      select jsonb_build_object(
               'name', cp.display_name, 'title', cp.title,
               'phone', cp.phone, 'email', cp.email, 'avatar_key', cp.avatar_key)
        from public.contractor_profile cp where cp.user_id = owner
    )
  ) into out;

  return coalesce(out, '{}'::jsonb);
end $$;

revoke all on function public.confirmation_company_v1 from public;
grant execute on function public.confirmation_company_v1 to anon, authenticated;

-- ── the write the app makes ─────────────────────────────────────────────────────
--
-- Upsert, own-row only. Separate from the company write because a crew member may set
-- their own card without any right to edit the company's letterhead.
create or replace function public.save_contractor_profile_v1(
  p_display_name text, p_title text, p_phone text, p_email text, p_avatar_key text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.contractor_profile
    (user_id, display_name, title, phone, email, avatar_key, updated_at)
  values (auth.uid(), nullif(btrim(p_display_name),''), nullif(btrim(p_title),''),
          nullif(btrim(p_phone),''), nullif(btrim(p_email),''), nullif(btrim(p_avatar_key),''), now())
  on conflict (user_id) do update set
    display_name = excluded.display_name, title = excluded.title,
    phone = excluded.phone, email = excluded.email,
    avatar_key = excluded.avatar_key, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.save_contractor_profile_v1 from public, anon;
grant execute on function public.save_contractor_profile_v1 to authenticated;

-- Company letterhead. OWNER ONLY: this is the name and address that appears on every
-- document the company sends, and a crew member editing it changes what every client
-- sees on every future change order.
create or replace function public.save_company_identity_v1(
  p_company_id text, p_tagline text, p_address text, p_phone text, p_email text, p_logo_key text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update public.company set
    tagline  = nullif(btrim(p_tagline),''),
    address  = nullif(btrim(p_address),''),
    phone    = nullif(btrim(p_phone),''),
    email    = nullif(btrim(p_email),''),
    logo_key = nullif(btrim(p_logo_key),'')
   where id = p_company_id and owner_id = auth.uid();
  if not found then
    raise exception 'not your company' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.save_company_identity_v1 from public, anon;
grant execute on function public.save_company_identity_v1 to authenticated;
