-- Priced approval — the client-facing report gets a PRICE, and it is frozen too.
--
-- WHY (hadar 2026-07-20): the confirmation page the client opens showed a decision
-- ("confirm this is what we agreed") with NO dollar amount and no branding. For an
-- EXTRA, the money is the whole report. This turns the confirmation into the priced
-- approval the prototype (h2) and the 3-step process describe: company + job, the
-- scope in plain words, a big fixed price, the running total already approved, and a
-- type-your-name-to-sign approval.
--
-- THE BINDING RULE STILL HOLDS (mandate #5). shown_content is the frozen instrument.
-- These new fields are ALSO frozen at send: if the page rendered a live price beside
-- a frozen text, the two could diverge, and in the one moment it matters — a dispute —
-- the page would show a different number than the signed record. So the guard freezes
-- them exactly like shown_content. The price the client SEES is the price they SIGNED.
--
-- All columns are NULLABLE: the older "confirm a decision, no cost change" path and the
-- 'acknowledge' kind still send with these null, and the page renders that case too.

alter table public.confirmation_request
  add column if not exists amount_cents           integer,
  add column if not exists nte_cents              integer,
  add column if not exists scope_title            text,
  add column if not exists company_name           text,
  add column if not exists job_label              text,
  add column if not exists approved_running_cents integer,   -- snapshot at send time
  add column if not exists change_order_id        text;

-- The signature: the full name the client typed to approve. Part of the response
-- evidence, append-only like the rest of it.
alter table public.confirmation_response
  add column if not exists signed_name text;

-- The instrument is now more than shown_content. Freeze every field of it: a sent
-- approval's price, scope, company, running total and CO link never change. Only
-- delivery_state (queued→sent→delivered) stays mutable — it is metadata, not the deal.
create or replace function public.confirmation_request_guard() returns trigger
  language plpgsql as $$ begin
    if new.shown_content          is distinct from old.shown_content
       or new.shown_sha256        is distinct from old.shown_sha256
       or new.decision_id         is distinct from old.decision_id
       or new.amount_cents        is distinct from old.amount_cents
       or new.nte_cents           is distinct from old.nte_cents
       or new.scope_title         is distinct from old.scope_title
       or new.company_name        is distinct from old.company_name
       or new.job_label           is distinct from old.job_label
       or new.approved_running_cents is distinct from old.approved_running_cents
       or new.change_order_id     is distinct from old.change_order_id then
      raise exception 'the approval instrument is frozen: price/scope/text cannot change after send';
    end if;
    return new;
  end $$;
-- The trigger is created HERE now, not in 020 [2026-07-21]. It used to be bound in
-- 020 while this file replaced only the function body -- which works on an existing
-- database but made 020 and 200 CO-OWN the guard, so re-running 020 restored the
-- narrow version and quietly unfroze price/scope/company/job/change-order on sent
-- requests. 020 now owns the tables; this file owns the confirmation functions and
-- the trigger that binds this one. Fresh-install ordering still holds: 020 creates
-- the table, 200 creates the function and its trigger.
drop trigger if exists confirmation_request_no_tamper on public.confirmation_request;
create trigger confirmation_request_no_tamper before update
  on public.confirmation_request for each row execute function public.confirmation_request_guard();

-- Fetch now returns the priced fields + the signature (on an answered request), so the
-- page can render the full report and the confirmed screen can say who signed.
create or replace function public.confirmation_fetch(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.confirmation_request%rowtype; resp public.confirmation_response%rowtype;
begin
  select * into r from public.confirmation_request where token = p_token;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if now() > r.expires_at then return jsonb_build_object('status','expired'); end if;

  select * into resp from public.confirmation_response where token = p_token;
  return jsonb_build_object(
    'status', case when found then 'already_answered' else 'open' end,
    'kind', r.kind,
    'shown_content', r.shown_content,       -- FROZEN. not re-rendered.
    'counterparty', r.counterparty_label,
    -- The priced report, all frozen at send.
    'amount_cents', r.amount_cents,
    'nte_cents', r.nte_cents,
    'scope_title', r.scope_title,
    'company_name', r.company_name,
    'job_label', r.job_label,
    'approved_running_cents', r.approved_running_cents,
    'answered_action', resp.action,
    'answered_at', resp.responded_at,
    'signed_name', resp.signed_name
  );
end $$;

-- The grant is stated HERE now [2026-07-21]. It used to live only in 020, and this
-- file's `create or replace` inherited it -- fine on the existing database, but on a
-- FRESH install (020 no longer defines the function) anon would have had no execute
-- privilege and every approval link would open to a permission error. anon needs it:
-- the whole point is a counterparty with no account reading the link.
revoke all on function public.confirmation_fetch(text) from public;
grant execute on function public.confirmation_fetch(text) to anon, authenticated;

-- Recreate create/respond with the new parameters. DROP first: adding parameters
-- changes the signature, and an overload alongside the old one invites ambiguity.
drop function if exists public.confirmation_create(text,text,text,text,text,text,text,text,text);
create or replace function public.confirmation_create(
  p_token text, p_decision_id text, p_project_id text, p_kind text,
  p_shown_content text, p_shown_sha256 text, p_counterparty text,
  p_channel text, p_destination text,
  p_amount_cents integer default null, p_nte_cents integer default null,
  p_scope_title text default null, p_company_name text default null,
  p_job_label text default null, p_approved_running_cents integer default null,
  p_change_order_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into public.confirmation_request (token, decision_id, project_id, owner_id, kind,
    shown_content, shown_sha256, counterparty_label, channel, destination,
    amount_cents, nte_cents, scope_title, company_name, job_label,
    approved_running_cents, change_order_id)
  values (p_token, p_decision_id, p_project_id, auth.uid(), p_kind,
          p_shown_content, p_shown_sha256, p_counterparty, p_channel, p_destination,
          p_amount_cents, p_nte_cents, p_scope_title, p_company_name, p_job_label,
          p_approved_running_cents, p_change_order_id);
  return jsonb_build_object('status','created','token',p_token);
end $$;
revoke all on function public.confirmation_create from public, anon;
grant execute on function public.confirmation_create to authenticated;

drop function if exists public.confirmation_respond(text,text,text,text);
create or replace function public.confirmation_respond(
  p_token text, p_action text, p_note text default null,
  p_user_agent text default null, p_signed_name text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.confirmation_request%rowtype;
begin
  if p_action not in ('confirmed','declined') then
    raise exception 'invalid action %', p_action using errcode = '23514';
  end if;
  select * into r from public.confirmation_request where token = p_token;
  if not found then raise exception 'unknown token' using errcode = '42501'; end if;
  if now() > r.expires_at then raise exception 'link expired' using errcode = '23514'; end if;

  begin
    insert into public.confirmation_response (token, action, note, user_agent, signed_name)
    values (p_token, p_action, p_note, p_user_agent, p_signed_name);
  exception when unique_violation then
    return jsonb_build_object('status','already_answered');
  end;
  return jsonb_build_object('status','recorded','action',p_action);
end $$;
revoke all on function public.confirmation_respond from public;
grant execute on function public.confirmation_respond to anon, authenticated;
