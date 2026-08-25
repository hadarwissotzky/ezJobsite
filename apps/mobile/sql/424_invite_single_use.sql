-- 424 — an invite is for ONE person, and a removal is a removal.
--
-- hadar's review, 2026-08-25. Two holes in the same RPC, both of which let somebody
-- into a company the owner never let in.
--
-- ─── HOLE 1: THE TOKEN WAS UNLIMITED-USE ────────────────────────────────────────
-- `accept_company_invite` checked existence and expiry, and nothing else. It recorded
-- `accepted_by` but never read it — the write is even guarded `where accepted_by is
-- null`, which preserves the FIRST accepter's name and then lets every later one
-- through anyway. So one code, forwarded once in a group chat, admits everybody who
-- has it for the full 14 days. The owner sees the roster grow and cannot tell which
-- invite did it.
--
-- Refused now for a DIFFERENT user. The same user re-accepting is still allowed and
-- still idempotent, and that is load-bearing rather than lenient: the setup flow joins
-- before it saves the profile, so a crew member whose app is killed in between must be
-- able to type the same code again on the next launch. Punishing that would strand
-- exactly the person this is all for.
--
-- ─── HOLE 2: A REMOVED MEMBER COULD LET THEMSELVES BACK IN ──────────────────────
-- The insert ends `on conflict (company_id, user_id) do update set status = 'active'`,
-- so re-accepting REACTIVATES a revoked membership. An owner who removed somebody had
-- until the token expired before that person could undo it with a code they already
-- held — and `revoke_company_member` gave no signal that it had been undone. Removal
-- is the one act in this module that exists to take access away; it cannot be
-- reversible by the person it was used on.
--
-- Fixed by making reactivation depend on WHEN the invite was minted. An invite created
-- AFTER the revocation is a deliberate re-hire and works exactly as before; one minted
-- before it is stale by definition and is refused. That needs a revocation timestamp,
-- which nothing recorded.
--
-- ─── WHY A TRIGGER FOR revoked_at, NOT A NEW revoke_company_member ──────────────
-- `revoke_company_member` is sql/376's, and redefining it here would give one function
-- two owning files — the exact ambiguity scripts/check-sql-duplicates.mjs exists to
-- make loud, and the reason the dispute bundle once silently lost a limitation. A
-- trigger on the column that actually changes is both narrower and wider: it cannot
-- drift from the function, and it also catches any future path that revokes somebody.
--
-- Purely additive: one column, one trigger, one redefined RPC. No policy or grant
-- changes, and no existing membership is altered.

-- ── 1. When did this membership stop ────────────────────────────────────────────
alter table public.company_member add column if not exists revoked_at timestamptz;

create or replace function public.company_member_stamp_revoked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'revoked' and old.status is distinct from 'revoked' then
    new.revoked_at := now();
  elsif new.status = 'active' and old.status is distinct from 'active' then
    -- A genuine re-join clears it, so a second removal later is timed from ITSELF and
    -- not from the first one. Leaving a stale timestamp here would make every future
    -- invite look older than the revocation and lock the person out permanently.
    new.revoked_at := null;
  end if;
  return new;
end $$;

drop trigger if exists company_member_stamp_revoked_upd on public.company_member;
create trigger company_member_stamp_revoked_upd
  before update on public.company_member
  for each row execute function public.company_member_stamp_revoked();

-- Existing revoked rows predate the column. They are stamped with a timestamp in the
-- distant past rather than now(): `now()` would mean "revoked this second", which would
-- invalidate every outstanding invite an owner has legitimately just sent. Backdating
-- fails OPEN for those invites and closed for nothing — the rows are already revoked,
-- and sync has kept them out since the day it happened.
update public.company_member
   set revoked_at = 'epoch'::timestamptz
 where status = 'revoked' and revoked_at is null;

-- ── 2. The door ─────────────────────────────────────────────────────────────────
-- Supersedes sql/382's definition (which itself superseded 381's). Everything 382 did
-- is preserved verbatim: the validity checks, the idempotent re-accept, and NO member
-- cap — seats are still unenforced on the server, deliberately, and 382's note on where
-- a plan-gated cap belongs still stands. This adds only the two refusals above.
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

  -- ONE INVITE, ONE PERSON. The original accepter may re-accept as often as they like
  -- (see the header — the setup flow depends on it); nobody else may use their code.
  if inv.accepted_by is not null and inv.accepted_by <> uid then
    raise exception 'invite already used' using errcode = '22023';
  end if;

  -- A REMOVAL STAYS REMOVED unless the owner has invited them since. Read before the
  -- upsert, because the upsert is what would silently flip them back to active.
  select * into mine from public.company_member
   where company_id = inv.company_id and user_id = uid;
  if found and mine.status = 'revoked'
     and inv.created_at <= coalesce(mine.revoked_at, 'epoch'::timestamptz) then
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
