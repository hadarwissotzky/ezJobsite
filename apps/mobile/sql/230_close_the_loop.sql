-- 230_close_the_loop.sql
--
-- A CLIENT'S ANSWER NOW MOVES THE CHANGE ORDER. Closing Codex #1.
--
-- The bug: `confirmation_create` only wrote a confirmation_request, and
-- `confirmation_respond` only wrote a confirmation_response. Neither ever touched
-- `change_order`. So the client saw "The contractor has your answer" while the
-- contractor's ledger said Draft forever, the money totals stayed wrong, and the
-- link stayed resendable. The two halves of the product were never wired together.
--
-- What was NOT broken, contrary to first reading: `hydrateChangeOrders` already
-- pulls `change_order.status` and maps `approval.legal_name` onto `signed_by`. The
-- app was always ready to learn the answer. Nothing was ever setting it.
--
-- ── THE CONTRADICTION THIS FILE HAD TO RESOLVE ──────────────────────────────
-- `030_change_order.sql` constrains grade 'signature'/'priced' to require
-- `otp_verified_at` AND `phone_e164` AND `legal_name`. The no-account approval link
-- has NO OTP and NO phone -- deliberately; that is the entire point of a link the
-- client opens without an account. So a 'priced' approval literally cannot be
-- recorded from the flow that produces priced approvals.
--
-- Two designs in this repo disagree:
--   030 (earlier)  : a priced approval is OTP + phone + typed name.
--   200 + PRD-RECONCILIATION §3.5 (current) : the v1 instrument is typed name +
--                    immutable snapshot + audit trail, and whether that clears
--                    ESIGN/UETA is Fable Q1, a BLOCKING legal question.
--
-- Resolved by NAMING the weaker instrument rather than hiding it. A new grade,
-- `typed_link`, requires the typed legal name and does NOT require OTP/phone. The
-- strong grades keep their full binding, untouched. Nobody is downgraded silently
-- and no fake OTP is written to satisfy a constraint -- a forged identity binding
-- would be far worse than an honestly weaker one.
--
-- WHEN Q1 IS ANSWERED: if typed-name alone does not clear the bar, the fix is to
-- add the OTP step to the link flow and start writing 'priced' -- the grades are
-- already distinguishable, so existing rows stay truthfully labelled as what they
-- were, which is the whole reason for a separate grade.

-- ── 1. name the instrument ──────────────────────────────────────────────────
-- The column's original inline CHECK is named `approval_grade_check` (verified
-- against pg_constraint on the live database, not assumed from the DDL).
alter table public.approval drop constraint if exists approval_grade_check;
alter table public.approval add constraint approval_grade_check check (
  grade in ('confirm','acknowledge','signature','priced','typed_link')
);

-- ── 2. bind each grade to the identity it actually carries ──────────────────
alter table public.approval drop constraint if exists approval_signature_binding;
alter table public.approval add constraint approval_signature_binding check (
  -- Strong grades: unchanged. OTP + phone + name, or it is not that grade.
  (grade not in ('signature','priced')
   or (legal_name is not null and length(legal_name) > 1
       and otp_verified_at is not null and phone_e164 is not null))
  and
  -- The no-account link instrument: a typed legal name is mandatory, OTP is not
  -- available and is therefore not pretended.
  (grade <> 'typed_link'
   or (legal_name is not null and length(btrim(legal_name)) > 1))
);

-- ── 3. sending marks the change order sent ──────────────────────────────────
create or replace function public.confirmation_request_marks_sent() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.change_order_id is null then return new; end if;
  -- Only out of draft. Never walk a terminal state backwards.
  update public.change_order
     set status = 'sent'
   where id = new.change_order_id
     and status = 'draft';
  return new;
end $$;

drop trigger if exists confirmation_request_sent on public.confirmation_request;
create trigger confirmation_request_sent after insert on public.confirmation_request
  for each row execute function public.confirmation_request_marks_sent();

-- ── 4. the answer moves the change order, and leaves evidence ───────────────
create or replace function public.confirmation_response_settles_co() returns trigger
  language plpgsql security definer set search_path = public as $$
declare r public.confirmation_request%rowtype;
        act text;
begin
  select * into r from public.confirmation_request where token = new.token;
  if not found or r.change_order_id is null then
    return new;  -- a decision confirmation with no change order: nothing to settle
  end if;

  act := case when new.action = 'confirmed' then 'approved' else 'declined' end;

  -- The evidence row. grade 'typed_link' because that is the instrument that was
  -- actually used: a typed name over a no-account link, no OTP. See the header.
  insert into public.approval (
    id, change_order_id, decision_id, project_id, grade,
    shown_content, shown_sha256, signer_label, legal_name,
    action, signed_at, user_agent
  ) values (
    gen_random_uuid()::text, r.change_order_id, r.decision_id, r.project_id,
    'typed_link', r.shown_content, r.shown_sha256, r.counterparty_label,
    btrim(new.signed_name), act, new.responded_at, new.user_agent
  );

  -- FIRST terminal answer wins. A change order that is already approved or declined
  -- is NOT walked to a different terminal state by a second, older link.
  --
  -- This is a partial mitigation of Codex #6, not a fix for it: nothing here stops
  -- several live tokens existing for one change order, and the losing answer is
  -- still recorded in confirmation_response and in `approval` as evidence that it
  -- happened. What it prevents is the worst outcome -- a signed approval being
  -- silently overwritten by a later decline, or the reverse. #6 needs token
  -- uniqueness/revocation at send time and is still open.
  update public.change_order
     set status = act
   where id = r.change_order_id
     and status in ('draft','sent');

  return new;
end $$;

drop trigger if exists confirmation_response_settles on public.confirmation_response;
create trigger confirmation_response_settles after insert on public.confirmation_response
  for each row execute function public.confirmation_response_settles_co();
