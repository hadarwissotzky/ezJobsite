-- Free-tier member cap, SERVER-SIDE (hadar 2026-07-25).
--
-- WHY THE SERVER. The client (quota.ts checkMembers) shows a friendly modal, but it
-- only sees active members on ONE device and CANNOT stop the real bypass: an owner at
-- the cap mints several outstanding invites, each accepted on a different device where
-- the inviter's client-side count never runs. The only device-independent moment the
-- membership actually changes is ACCEPT — so that is where the wall must be. This
-- re-defines accept_company_invite to re-count and refuse past the cap.
--
-- Mirrors apps/mobile/src/quota.ts FREE_LIMITS.members = 2. Re-accepting (a user who
-- is already an active member) is idempotent and NOT blocked — only a NEW member past
-- the cap is refused. When a paid plan exists, gate the count on company.plan.

create or replace function public.accept_company_invite(p_token text, p_display_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.company_invite;
  active_n int;
  already boolean;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into inv from public.company_invite where token = p_token;
  if not found then raise exception 'invite not found' using errcode = 'P0002'; end if;
  if inv.expires_at < now() then raise exception 'invite expired' using errcode = '22023'; end if;

  -- Serialize concurrent accepts for THIS company: without it, two near-simultaneous
  -- accepts both read count=1 under READ COMMITTED and both insert, landing 3 members
  -- (the exact multi-device bypass this file exists to stop). Locking the company row
  -- makes the count-then-insert atomic per company; a second accept waits here.
  perform 1 from public.company where id = inv.company_id for update;

  -- An existing active member re-accepting does not add a seat — never block that.
  select exists(
    select 1 from public.company_member
     where company_id = inv.company_id and user_id = uid and status = 'active'
  ) into already;

  if not already then
    select count(*) into active_n
      from public.company_member
     where company_id = inv.company_id and status = 'active';
    -- FREE_LIMITS.members = 2. Keep in sync with apps/mobile/src/quota.ts.
    if active_n >= 2 then
      raise exception 'company is at its free-plan member limit' using errcode = 'P0001';
    end if;
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
