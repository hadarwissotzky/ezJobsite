-- 443 — the confirmation carries its language (LANGUAGE-LAYER slice 2)
--
-- hadar, 2026-09-03: "when sent the user is asked what language it should be sent as —
-- if in english, the user receives the web portal scope of work and all messages in
-- english."
--
-- `shown_content` is already in the chosen language by the time it arrives here — the
-- device renders the instrument (renderCard + langpack.ts) and this row freezes it.
-- What the server needs to KEEP is which language that was, because the portal's own
-- chrome (the Approve button, the signature ask) is rendered by confirm.html and must
-- agree with the document it wraps. A Spanish instrument under English buttons is a
-- half-translated page shown to the one reader who never chose this product.
--
-- The column is constrained to the REVIEWED languages, the same rule as langpack.ts and
-- SCOPE_HEADINGS: a language exists here only when a human who speaks it signed off on
-- every sentence a client reads.

alter table public.confirmation_request
  add column if not exists lang text;

alter table public.confirmation_request
  drop constraint if exists confirmation_request_lang_check;
alter table public.confirmation_request
  add constraint confirmation_request_lang_check
  check (lang is null or lang in ('en','es'));

comment on column public.confirmation_request.lang is
  'The language shown_content is written in and the portal renders its chrome in. '
  'NULL on rows sent before 443 — read as English, which is what they were.';

-- ── confirmation_create: the old signature must GO, not be overloaded ────────────
-- `create or replace` with a new parameter makes a SECOND function; a caller that
-- omits p_lang would then match both (the new one has a default) and PostgREST
-- refuses ambiguous overloads outright — every send from every existing build would
-- 300. Drop-then-create keeps exactly one, and old clients hit the default.
drop function if exists public.confirmation_create(
  text,text,text,text,text,text,text,text,text,
  integer,integer,text,text,text,integer,text,jsonb);

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
  p_line_items jsonb default null,
  p_lang text default 'en'
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
    approved_running_cents, change_order_id, line_items, lang)
  values (p_token, p_decision_id, p_project_id, auth.uid(), p_kind,
          p_shown_content, p_shown_sha256, p_counterparty, p_channel, p_destination,
          p_amount_cents, p_nte_cents, p_scope_title, p_company_name, p_job_label,
          p_approved_running_cents, p_change_order_id, p_line_items,
          case when p_lang in ('en','es') then p_lang else 'en' end);
  return jsonb_build_object('status','created','token',p_token);
end $$;

revoke all on function public.confirmation_create from public, anon;
grant execute on function public.confirmation_create to authenticated;

-- ── confirmation_fetch returns it, so the portal can dress the page to match ─────
-- (200's body verbatim plus the two 'lang' lines — same single-owner rule as 442.)
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
      'lang', coalesce(r.lang, 'en'),
      'scope_title', r.scope_title,
      'company_name', r.company_name,
      'job_label', r.job_label);
  end if;

  select * into resp from public.confirmation_response where token = p_token;
  return jsonb_build_object(
    'status', case when found then 'already_answered' else 'open' end,
    'kind', r.kind,
    'lang', coalesce(r.lang, 'en'),
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

revoke all on function public.confirmation_fetch from public;
grant execute on function public.confirmation_fetch to anon, authenticated;
