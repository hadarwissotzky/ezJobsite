-- 250_one_live_link.sql
--
-- ONE LIVE APPROVAL LINK PER CHANGE ORDER. Closing Codex #6.
--
-- The hole: every tap of Send minted a fresh token with no in-flight guard, no
-- uniqueness on change_order_id, and no way to revoke an earlier one. "Resend link"
-- created ANOTHER live request rather than reusing or retiring the first. So a
-- change order could carry several simultaneously-valid links, each showing whatever
-- price was frozen when it was sent.
--
-- Two ways that hurts, both real:
--   1. Contradiction. One link is approved while another is declined, and both are
--      immutable evidence. 230 already made the FIRST terminal answer win so the
--      change order cannot be walked from approved to declined -- but the losing
--      answer still existed as a signed record disagreeing with the outcome.
--   2. A stale price. R5b's "Revise & Resend" issues a superseding version, but the
--      OLD link kept working, so a client could open yesterday's text and sign
--      $1,850 after the contractor had already revised it to $1,500. The frozen
--      instrument was doing its job; nothing was retiring it.
--
-- The fix is not "block a second send" -- revising and resending is a REQUIRED flow
-- (R5b). It is that issuing a new link RETIRES the previous live one, so exactly one
-- link is answerable at a time, and answering a retired link is refused rather than
-- silently recorded.
--
-- Superseding only ever touches links that are still LIVE (unanswered and not
-- already superseded). An answered link is terminal evidence and is never rewritten.

alter table public.confirmation_request
  add column if not exists superseded_at timestamptz;

create index if not exists confirmation_request_co_live_idx
  on public.confirmation_request (change_order_id)
  where superseded_at is null;

-- ── issuing a link retires the previous live one ────────────────────────────
create or replace function public.confirmation_request_supersedes() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.change_order_id is null then return new; end if;

  update public.confirmation_request r
     set superseded_at = now()
   where r.change_order_id = new.change_order_id
     and r.token <> new.token
     and r.superseded_at is null
     -- an answered link is evidence of a completed act; it is not "live" and is
     -- never retroactively relabelled.
     and not exists (select 1 from public.confirmation_response x where x.token = r.token);

  return new;
end $$;

drop trigger if exists confirmation_request_supersede on public.confirmation_request;
create trigger confirmation_request_supersede after insert on public.confirmation_request
  for each row execute function public.confirmation_request_supersedes();

-- ── a retired link cannot be answered ───────────────────────────────────────
-- At the table, not in confirmation_respond: it then holds for every write path and
-- survives the 020-after-200 migration-order hazard (Codex #5), same as 210 and 240.
create or replace function public.confirmation_response_not_superseded() returns trigger
  language plpgsql as $$
declare sup timestamptz;
begin
  select superseded_at into sup
    from public.confirmation_request where token = new.token;
  if sup is not null then
    raise exception 'this approval link was replaced by a newer one'
      using errcode = '23514', hint = 'link_superseded';
  end if;
  return new;
end $$;

drop trigger if exists confirmation_response_live_only on public.confirmation_response;
create trigger confirmation_response_live_only before insert on public.confirmation_response
  for each row execute function public.confirmation_response_not_superseded();

-- ── let the page say so up front, instead of failing at the last tap ────────
-- A NEW function rather than extending confirmation_fetch, which is one of the four
-- already-duplicated functions (Codex #5). Adding a fifth duplicate to improve a
-- message would be trading a real hazard for a cosmetic gain.
create or replace function public.confirmation_state(p_token text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.confirmation_request%rowtype;
        answered boolean;
begin
  select * into r from public.confirmation_request where token = p_token;
  if not found then return jsonb_build_object('found', false); end if;
  select exists(select 1 from public.confirmation_response where token = p_token)
    into answered;
  return jsonb_build_object(
    'found', true,
    'superseded', r.superseded_at is not null,
    'answered', answered,
    'expired', now() > r.expires_at
  );
end $$;

revoke all on function public.confirmation_state from public;
grant execute on function public.confirmation_state to anon, authenticated;
