-- Subscription plan on the company + retire the hard member cap (hadar 2026-07-26,
-- DEC-11). The company row (PowerSync-synced) gains a `plan` the client READS to lift
-- quota caps; only the store webhook (RevenueCat) WRITES it — a client is never the
-- authority on "is paid". Default 'free'.
--
-- CREW IS FREE NOW: PRICING-STRATEGY makes field crew free on every tier (growth loop),
-- so the hard `active_n >= 2` member wall in sql/381 is removed here. The knob is
-- retained in the app model (plans.ts planLimits().members) and could be re-enabled
-- server-side per plan later ("field crew may not be free moving forward" — hadar);
-- the plan-driven place for that is marked below.

alter table public.company add column if not exists plan text not null default 'free';
alter table public.company add column if not exists plan_since timestamptz;
-- Where the entitlement came from (e.g. 'revenuecat', 'manual', 'free'). Audit trail.
alter table public.company add column if not exists plan_source text;

-- Redefine accept_company_invite WITHOUT the member cap (supersedes sql/381's block).
-- Same signature; keeps the idempotent re-accept and the invite validity checks.
create or replace function public.accept_company_invite(p_token text, p_display_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.company_invite;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into inv from public.company_invite where token = p_token;
  if not found then raise exception 'invite not found' using errcode = 'P0002'; end if;
  if inv.expires_at < now() then raise exception 'invite expired' using errcode = '22023'; end if;

  -- NO member cap (crew is free on every tier today). When seats become paid, gate
  -- here on the company's plan: read company.plan, look up its members allowance, lock
  -- the company row (as sql/381 did), count active members, and refuse past the limit.

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
