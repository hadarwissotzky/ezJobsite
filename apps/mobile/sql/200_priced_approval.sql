-- NOTE (2026-09-03): the LATEST definitions of confirmation_create and
-- confirmation_fetch live in 443_confirmation_lang.sql. Edit there.
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

-- THE COST BROKEN DOWN BY PART, frozen with everything else [2026-08-24].
--
-- hadar: "if there were a separation of cost by part (breakdown) this breakdown needs
-- to be displayed clearly and that is true for the homeowners side (client portal)."
-- The page showed one figure and nothing behind it, so a total assembled from three
-- pieces the contractor quoted out loud looked exactly like a number he typed.
--
-- IT IS PART OF THE INSTRUMENT, NOT A READING AID, which is why it is a frozen column
-- here and not a live read of change_order.line_items. The whole reason the priced
-- fields were frozen (see the header) applies with more force to a breakdown: a
-- signer who approved $400 + $1,250 + $750 must see those three numbers two years
-- later even if the draft they came from was since re-priced. A live join would show
-- today's parts under yesterday's signature. It is added to the guard below.
--
-- NULL on every existing row and on any send that had no breakdown, which is most of
-- them: one price for the whole job has no parts. The page renders nothing then.
alter table public.confirmation_request
  add column if not exists line_items jsonb;

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
       or new.change_order_id     is distinct from old.change_order_id
       or new.line_items          is distinct from old.line_items then
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
  /*
   * A WITHDRAWN CHANGE ORDER IS NOT A DOCUMENT TO SIGN [2026-08-25, hadar: "it should
   * filter change orders that were revoked / canceled by owner"].
   *
   * 421 kills the link when a contractor withdraws a sent extra, and the
   * `confirmation_response_not_cancelled` trigger refuses the signature. But this
   * function never looked at `cancelled_at`, so the page still SERVED the instrument as
   * `open`: a client with the original text message opened it, read a live change
   * order, typed their full name to sign — and hit a raw database error from the
   * trigger. The safety net held (no signature was ever recorded against a withdrawn
   * order) and everything above it was wrong. Being told "no" by a constraint, after
   * signing, is not the same as being told the offer was taken back.
   *
   * Returned as its own status so the page can SAY it, rather than as `not_found`,
   * which would tell the client they mistyped a link they did not mistype.
   */
  -- The change order's own status is checked as well as the link's copy of it: a row
  -- cancelled by any route other than `cancel_change_order_v1` leaves `cancelled_at`
  -- NULL here, and this page would serve a withdrawn instrument as a live one. See the
  -- guard in 421 for the case this was found on.
  if r.cancelled_at is not null
     or exists (select 1 from public.change_order c
                 where c.id = r.change_order_id and c.status = 'cancelled') then
    return jsonb_build_object(
      'status', 'cancelled',
      'kind', r.kind,
      'scope_title', r.scope_title,
      'company_name', r.company_name,
      'job_label', r.job_label);
  end if;

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
    -- The parts behind the figure. Null when the job was quoted as one price.
    'line_items', r.line_items,
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
-- ...and again for the pre-breakdown signature [2026-08-24]. Same reasoning as the
-- line above: p_line_items has a default, so without this drop the old 16-argument
-- function survives beside the new 17-argument one and a positional call is ambiguous.
drop function if exists public.confirmation_create(
  text,text,text,text,text,text,text,text,text,
  integer,integer,text,text,text,integer,text);
create or replace function public.confirmation_create(
  p_token text, p_decision_id text, p_project_id text, p_kind text,
  p_shown_content text, p_shown_sha256 text, p_counterparty text,
  p_channel text, p_destination text,
  p_amount_cents integer default null, p_nte_cents integer default null,
  p_scope_title text default null, p_company_name text default null,
  p_job_label text default null, p_approved_running_cents integer default null,
  p_change_order_id text default null,
  -- The breakdown as sent. A jsonb array of {description, qty, unit_cents,
  -- total_cents}; null when the extra carries no parts.
  p_line_items jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sum bigint;
begin
  /*
   * THE FROZEN BREAKDOWN MUST ADD UP TO THE FROZEN AMOUNT [2026-08-24, Codex review].
   *
   * `p_line_items` arrives as free-form jsonb and nothing here checked its shape or its
   * arithmetic, so this function would happily freeze three $300 rows beside a $1,000
   * signed total. The device runs `validateLines` before it ever gets here, and that is
   * exactly the problem: it is the ONLY check, it lives on the client, and this is a
   * SECURITY DEFINER function that any authenticated caller can invoke directly.
   *
   * A change order is a document two parties are meant to agree about. Freezing one that
   * contradicts itself -- permanently, under a signature, with no path to correct it
   * because the tamper guard refuses UPDATE -- is worse than refusing to send.
   *
   * Refuses rather than repairs. Silently dropping a bad breakdown would send a document
   * the contractor believes is itemised and the client sees as a bare figure.
   */
  if p_line_items is not null then
    if jsonb_typeof(p_line_items) <> 'array' then
      raise exception 'line_items must be a JSON array';
    end if;
    if p_amount_cents is null then
      raise exception 'a breakdown cannot be frozen without an amount to check it against';
    end if;
    select coalesce(sum((v->>'total_cents')::bigint), 0) into v_sum
      from jsonb_array_elements(p_line_items) v;
    if v_sum <> p_amount_cents then
      raise exception 'breakdown adds up to % but the change order says %', v_sum, p_amount_cents;
    end if;
  end if;

  insert into public.confirmation_request (token, decision_id, project_id, owner_id, kind,
    shown_content, shown_sha256, counterparty_label, channel, destination,
    amount_cents, nte_cents, scope_title, company_name, job_label,
    approved_running_cents, change_order_id, line_items)
  values (p_token, p_decision_id, p_project_id, auth.uid(), p_kind,
          p_shown_content, p_shown_sha256, p_counterparty, p_channel, p_destination,
          p_amount_cents, p_nte_cents, p_scope_title, p_company_name, p_job_label,
          p_approved_running_cents, p_change_order_id, p_line_items);
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
