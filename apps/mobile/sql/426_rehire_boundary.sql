-- 426 — a re-hire minted at the revocation instant is a re-hire.
--
-- Found by running 424's own paths against the live database inside a rolled-back
-- transaction (2026-08-25), which is the only reason it was found at all: eight of the
-- nine cases passed and this one printed
--     FAIL  re-hire blocked: this invite is no longer valid
--
-- ─── THE OFF-BY-ONE ─────────────────────────────────────────────────────────────
-- sql/424 guards reactivation with
--     inv.created_at <= coalesce(mine.revoked_at, 'epoch')   -> refuse
-- and its own header says the opposite of what that does: "An invite created AFTER the
-- revocation is a deliberate re-hire and works exactly as before." `<=` refuses the
-- boundary — an invite minted at the same instant as the removal — so the code was
-- stricter than the rule it was written to express.
--
-- `<` is the rule as stated: refuse only an invite that predates the revocation. At
-- exact equality the two orderings are indistinguishable, and this is the direction to
-- fail in — the owner minting an invite is a deliberate act of letting somebody in,
-- while the timestamp collision is an artefact. Failing the other way silently ignores
-- an owner's explicit instruction, which is the worse of the two mistakes.
--
-- ─── HOW REAL IS THE BOUNDARY ───────────────────────────────────────────────────
-- Stated honestly rather than overclaimed: in production the revoke and the invite are
-- separate transactions and `now()` is transaction-start, so their timestamps differ by
-- milliseconds and `<=` would almost always have behaved. The test hit equality because
-- both ran inside one transaction. So this is a latent edge, not a live outage — and it
-- is still worth a migration, because the shipped code contradicts its own stated rule
-- and the next person to read it would have to decide which one to believe.
--
-- Nothing else changes. This is 424's function with one character corrected.

create or replace function public.accept_company_invite(p_token text, p_display_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.company_invite;
  mine public.company_member;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into inv from public.company_invite where token = p_token;
  if not found then raise exception 'invite not found' using errcode = 'P0002'; end if;
  if inv.expires_at < now() then raise exception 'invite expired' using errcode = '22023'; end if;

  -- ONE INVITE, ONE PERSON (424). The original accepter may re-accept as often as they
  -- like — the setup flow joins before it saves the profile, so a killed app has to be
  -- able to retype the same code — but nobody else may use their code.
  if inv.accepted_by is not null and inv.accepted_by <> uid then
    raise exception 'invite already used' using errcode = '22023';
  end if;

  -- A REMOVAL STAYS REMOVED unless the owner has invited them SINCE (424, boundary
  -- corrected here in 426: `<`, not `<=`). Read before the upsert, which is what would
  -- otherwise flip them back to active.
  select * into mine from public.company_member
   where company_id = inv.company_id and user_id = uid;
  if found and mine.status = 'revoked'
     and inv.created_at < coalesce(mine.revoked_at, 'epoch'::timestamptz) then
    raise exception 'this invite is no longer valid' using errcode = '42501';
  end if;

  insert into public.company_member (id, company_id, user_id, role, status, invited_by, display_name)
    values ('cm-'||left(md5(inv.company_id||uid::text),16), inv.company_id, uid, inv.role, 'active', inv.created_by, p_display_name)
    on conflict (company_id, user_id) do update set status = 'active',
      display_name = coalesce(excluded.display_name, public.company_member.display_name);
  update public.company_invite set accepted_by = uid, accepted_at = now()
    where id = inv.id and accepted_by is null;
  return jsonb_build_object('company_id', inv.company_id, 'role', inv.role,
                            'company_name', (select name from public.company where id = inv.company_id));
end $$;
revoke all on function public.accept_company_invite(text, text) from public, anon;
grant execute on function public.accept_company_invite(text, text) to authenticated;
