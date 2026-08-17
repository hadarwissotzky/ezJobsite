-- 408 — the company's letterhead, editable from the app.
--
-- hadar, 2026-08-17: "the user needs to be able to add their logo, as part of the
-- company section in the drawer menu where the user can add company name, logo,
-- address, license (optional)."
--
-- ─── THE HALF THAT WAS MISSING ──────────────────────────────────────────────────
-- 402 added `company.tagline/address/phone/email/logo_key` and the reader
-- (`confirmation_company_v1`) that prints them at the top of every change order a
-- client opens. 404 added the logo writer. But 404's own header says the rest out
-- loud: "the app has no editor for those four fields yet". So the columns have been
-- sitting empty, and every document this app has sent carries a letterhead with a
-- company name and nothing else — no address, no licence number.
--
-- That is not cosmetic. A homeowner is being asked to authorise money by a link from
-- a number they may not have saved; the letterhead is one of the two facts that make
-- the request checkable. And in most US states a contractor's licence number is
-- legally required on a written change order.
--
-- ─── WHY A NARROW WRITER, AGAIN ─────────────────────────────────────────────────
-- 402 ships `save_company_identity_v1`, which sets SIX columns in one UPDATE —
-- INCLUDING `logo_key`. An editor for name/address/licence that called it would have
-- to pass the logo key back or silently erase the logo. That is exactly the failure
-- 404 was written to avoid, in the opposite direction: 404 refused to let a
-- logo-setter erase the letterhead, and this refuses to let a letterhead-setter erase
-- the logo.
--
-- So this writer NAMES ONLY WHAT IT EDITS. It cannot lose a column it never mentions.
-- `phone` and `email` are deliberately absent too: no screen collects them yet, and a
-- writer that nulls a field no UI can refill is a data-loss bug waiting for its first
-- user.
--
-- ─── WHY A READER AT ALL ────────────────────────────────────────────────────────
-- `company` is a PowerSync-managed table and IT DOES NOT SYNC TO THE DEVICE (empty on
-- hadar's phone while the server holds a real row — the same gap that made billing
-- hand RevenueCat an anonymous customer, see `company.ts:billingTenantId`). An editor
-- that read the local table would show a contractor blank fields over his own saved
-- letterhead and then save the blanks. Reading through an RPC is not belt-and-braces
-- here; it is the only way this screen sees the truth.

-- ── the licence ─────────────────────────────────────────────────────────────────
-- Free text, not a number: "CSLB 1043210", "TX-1234567", and a two-letter state
-- prefix are all real, and no format this product invents would survive fifty states.
-- Nullable and OPTIONAL (hadar) — an unlicensed handyman doing $800 of work is a real
-- user, and a required field would either stop him or teach him to type junk.
alter table public.company add column if not exists license text;

-- ── which company am I in? ──────────────────────────────────────────────────────
-- WHY THIS HAS TO EXIST, and it is the same bug billing already hit.
--
-- `myCompany()` reads the PowerSync-managed `company` / `company_member` tables. On
-- hadar's phone those hold ZERO ROWS while the server holds a real company — verified
-- 2026-08-17 by querying the device. Everything gated on them silently disappears: the
-- drawer's Company row, the logo control, and now the letterhead. The feature was
-- built, shipped, and invisible, because a sync bucket that has never been deployed
-- is the thing deciding whether the menu has an entry.
--
-- `company.ts:billingTenantId` already works around this for payments by remembering
-- an id the server handed it. That fixes one caller. This fixes the question itself:
-- the server can always answer "which company am I in", and it does not need a sync
-- rule to do it.
--
-- Owned company first so the answer is stable and does not reshuffle between calls —
-- the same ordering `listMyCompanies` uses locally, for the same reason.
create or replace function public.my_company_v1()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  co  record;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select c.id, c.name, m.role, (c.owner_id = uid) as is_owner
    into co
    from public.company_member m
    join public.company c on c.id = m.company_id
   where m.user_id = uid and m.status = 'active'
   order by case when c.owner_id = uid then 0 else 1 end, c.name
   limit 1;

  -- Belonging to nothing is a legitimate answer, not an error: a brand-new account has
  -- no company until one is created for it.
  if co.id is null then
    return jsonb_build_object('ok', true, 'company', null);
  end if;

  return jsonb_build_object('ok', true, 'company', jsonb_build_object(
    'id', co.id, 'name', co.name, 'role', co.role, 'is_owner', co.is_owner));
end $$;

revoke all on function public.my_company_v1() from public, anon;
grant execute on function public.my_company_v1() to authenticated;

-- ── read ────────────────────────────────────────────────────────────────────────
-- Any ACTIVE MEMBER may read it: the letterhead is printed on documents the whole
-- crew sends, so a foreman opening the company screen should see what his clients
-- see. Only the owner may write it (below).
create or replace function public.company_letterhead_v1(p_company_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  co  record;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select c.id, c.name, c.address, c.license, c.logo_key, (c.owner_id = uid) as is_owner
    into co
    from public.company c
   where c.id = p_company_id
     and exists (select 1 from public.company_member m
                  where m.company_id = c.id and m.user_id = uid and m.status = 'active');
  if co.id is null then
    -- Not "empty letterhead": a caller who is not a member must not learn whether the
    -- company exists, and the app must not draw blank fields it would then save over.
    raise exception 'not your company' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ok', true, 'id', co.id, 'name', co.name, 'address', co.address,
    'license', co.license, 'logo_key', co.logo_key, 'is_owner', co.is_owner);
end $$;

-- ── write ───────────────────────────────────────────────────────────────────────
-- OWNER ONLY, the same bar 402 and 404 set for the same reason: this is what every
-- client sees on every document the company sends, and a crew member changing it
-- changes it for everybody.
create or replace function public.save_company_letterhead_v1(
  p_company_id text, p_name text, p_address text, p_license text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := auth.uid();
  n      text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- THE NAME IS THE ONE FIELD THAT MAY NOT GO BLANK. `company.name` is not null on the
  -- server, it is the fallback the client's page prints when there is no logo, and it
  -- is what `renderCard` freezes into the instrument as the asker. An empty submit
  -- must leave it alone rather than fail the whole save — the contractor is usually
  -- there to type an address, and losing his company name to a stray clear would be a
  -- silent edit to every future document.
  update public.company
     set name    = coalesce(n, name),
         address = nullif(btrim(coalesce(p_address, '')), ''),
         license = nullif(btrim(coalesce(p_license, '')), '')
   where id = p_company_id and owner_id = uid;

  if not found then
    raise exception 'not your company' using errcode = '42501';
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.company_letterhead_v1(text) from public, anon;
revoke all on function public.save_company_letterhead_v1(text, text, text, text) from public, anon;
grant execute on function public.company_letterhead_v1(text) to authenticated;
grant execute on function public.save_company_letterhead_v1(text, text, text, text) to authenticated;

-- ── the client's page shows it ──────────────────────────────────────────────────
-- `confirmation_company_v1` (402) is what the no-login approval page reads for the
-- letterhead. It never returned `license`, because the column did not exist. Adding it
-- here rather than in a later migration keeps the column and its one consumer in the
-- same change: a licence number nobody can see is not a feature, and the whole reason
-- hadar asked for the field is that it belongs on the document.
--
-- THIS IS 402'S BODY WITH ONE FIELD ADDED. It is reproduced verbatim rather than
-- rewritten, and that is deliberate — the first draft of this migration re-expressed
-- the function from memory and silently dropped two things a review caught:
--   * the TWO WAYS TO FIND THE COMPANY. `project.company_id` is null on every project
--     created before company membership existed, and the fallback to the sender's own
--     company is the only reason those documents have a letterhead at all.
--   * `avatar_key` on the contact, which the page draws.
-- A `create or replace` is a full replacement; anything not carried forward is deleted.
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
               'phone', co.phone, 'email', co.email, 'logo_key', co.logo_key,
               'license', co.license)
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

revoke all on function public.confirmation_company_v1(text) from public;
grant execute on function public.confirmation_company_v1(text) to anon, authenticated;
