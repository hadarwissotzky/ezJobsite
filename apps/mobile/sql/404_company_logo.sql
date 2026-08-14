-- 404 — the company's logo, settable from the app.
--
-- hadar, 2026-08-12: "Add logo — add that to the drawer".
--
-- ─── WHY A SECOND FUNCTION AND NOT save_company_identity_v1 ──────────────────────
-- 402 already added `company.logo_key` and a writer for it. That writer sets SIX
-- columns in one UPDATE:
--
--     update public.company set tagline=…, address=…, phone=…, email=…, logo_key=…
--
-- so a caller who only knows the logo — which is exactly the drawer — would have to
-- pass NULL for tagline, address, phone and email, and SILENTLY ERASE THE LETTERHEAD.
-- Not a hypothetical: the app has no editor for those four fields yet, so it has no
-- values to pass back, and the first contractor to tap "Add logo" would have wiped
-- whatever the portal was printing at the top of his change orders.
--
-- The alternative — read the row first and echo the other five back — is a
-- read-modify-write across the network on a field a second device may be editing.
-- A narrow writer that touches ONE column cannot lose a column it never names.
--
-- ─── OWNER ONLY ─────────────────────────────────────────────────────────────────
-- Same bar as 402's letterhead writer, for the same reason: this is the mark that
-- appears on every document the company sends. A crew member changing it changes what
-- every client sees on every future change order.
create or replace function public.set_company_logo_v1(
  p_company_id text, p_logo_key text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- nullif(btrim(...),'') so clearing the logo is the SAME call with an empty string,
  -- not a second function. NULL logo_key is the "no logo" state 402's reader already
  -- handles by omitting the image.
  update public.company
     set logo_key = nullif(btrim(p_logo_key), '')
   where id = p_company_id and owner_id = auth.uid();

  if not found then
    raise exception 'not your company' using errcode = '42501';
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.set_company_logo_v1 from public, anon;
grant execute on function public.set_company_logo_v1 to authenticated;
