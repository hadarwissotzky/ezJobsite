-- Change Order + signature-grade Approval — SPEC §7.1 / §7.2.
--
-- A CHANGE ORDER IS A DECISION WITH MONEY. It does not get its own parallel
-- universe: it references decision_id and inherits REQ-VAL5's versioned chain,
-- who-directed, and evidence. What it adds is a price and a HIGHER BAR to
-- accept it.
--
-- The Approval Spectrum (SPEC §1) is one mechanism at escalating formality:
--   confirm -> acknowledge -> SIGNATURE -> priced approval
-- so `approval` below carries a `grade`, rather than there being three tables
-- that drift apart.
--
-- TWO RULES THE SCHEMA ENFORCES, both from hard-won findings:
--
-- 1. mandate #6 -- "numbers/prices are the highest-risk field. NEVER trust them
--    from the transcript. Read-back + tap-to-correct. Always." So `amount_cents`
--    is INTEGER (never float -- money in floats is how you get $0.30000000000004)
--    and `numbers_confirmed_at` is NOT NULL: a CO literally cannot be sent for
--    approval until a human has confirmed the figure on screen.
--
-- 2. mandate #5 / §7.1 -- "the exact rendered text the counterparty saw is frozen
--    into shown_content as an immutable snapshot and is the legally binding
--    instrument for that act". Frozen by trigger, same as confirmations.

create table if not exists public.change_order (
  id             text primary key,
  decision_id    text not null,
  project_id     text not null,
  owner_id       uuid not null,

  scope          text not null check (length(scope) > 0),
  -- line items: [{description, qty, unit_cents, total_cents}]
  line_items     jsonb not null default '[]'::jsonb,
  -- INTEGER cents. Never float. Money in floats is a bug waiting for a lawyer.
  amount_cents   bigint not null check (amount_cents >= 0),
  currency       text not null default 'USD',

  -- CO-3 "proceed, NTE $X": a not-to-exceed cap for T&M work.
  nte_cents      bigint check (nte_cents is null or nte_cents >= 0),
  -- COMM-3 mini change order: one-tap "proceed" to keep the job moving,
  -- escalatable to a full CO later.
  is_mini        integer not null default 0 check (is_mini in (0,1)),

  who_directed   text not null,
  ref_estimate   text,                       -- §7.2 "reference to original estimate"

  -- MANDATE #6. Not nullable: no unconfirmed number may ever be sent.
  numbers_confirmed_at timestamptz not null,

  status         text not null default 'draft'
                   check (status in ('draft','sent','approved','declined','superseded')),
  created_at     timestamptz not null default now()
);

-- Approvals: the whole spectrum in one table, graded.
create table if not exists public.approval (
  id             text primary key,
  change_order_id text references public.change_order(id),
  decision_id    text,
  project_id     text not null,

  grade          text not null check (grade in ('confirm','acknowledge','signature','priced')),

  -- §7.1: the binding instrument. Frozen. Exempt from any later re-render.
  shown_content  text not null check (length(shown_content) > 0),
  shown_sha256   text not null,

  -- Identity binding (§7.1, resolves critic C2): OTP + typed legal name + time.
  signer_label   text not null,
  legal_name     text,                      -- typed by the signer, for signature grade
  phone_e164     text,
  otp_verified_at timestamptz,

  action         text not null check (action in ('approved','declined')),
  signed_at      timestamptz not null default now(),
  user_agent     text
);

-- An approval is evidence. It is never edited or deleted.
create or replace function public.approval_no_change() returns trigger
  language plpgsql as $$ begin
    raise exception 'approvals are immutable evidence: % blocked', tg_op;
  end $$;
drop trigger if exists approval_immutable on public.approval;
create trigger approval_immutable before update or delete on public.approval
  for each row execute function public.approval_no_change();

-- A signature-grade approval is INVALID without its identity binding: enforced in
-- the DB rather than the app, so no client bug can mint a signature that would not
-- stand up. The constraint (`approval_signature_binding`) is NOT defined here. It
-- lives in `230_close_the_loop.sql`, its single owner.
--
-- Why it moved [2026-07-21]: 230 adds the `typed_link` grade -- the no-account link
-- instrument, a typed legal name with no OTP -- and has to widen this constraint to
-- bind it. That left the same constraint defined in two files. Unlike the inline
-- `create table` checks above, which a re-run skips because the table already exists,
-- this was a bare `drop constraint if exists` + `add constraint` that re-runs every
-- time. So running THIS file after 230 restored a version with no typed_link branch,
-- and `grade not in ('signature','priced')` is trivially true for typed_link --
-- silently dropping the requirement that a link approval carry a typed legal name.
--
-- The duplicate checker could not see it: it only matched create function/view/
-- trigger/table and had reasoned itself out of checking `alter` at all. It now
-- matches `add constraint` and `create policy` too. This file owns the TABLES;
-- 230 owns this constraint. One object, one file.

-- The CO's frozen scope/amount must not move after it is sent.
create or replace function public.change_order_guard() returns trigger
  language plpgsql as $$ begin
    if old.status in ('sent','approved','declined')
       and (new.amount_cents is distinct from old.amount_cents
            or new.scope is distinct from old.scope
            or new.nte_cents is distinct from old.nte_cents) then
      raise exception 'a sent change order is frozen: supersede it with a new one';
    end if;
    return new;
  end $$;
drop trigger if exists change_order_frozen on public.change_order;
create trigger change_order_frozen before update on public.change_order
  for each row execute function public.change_order_guard();

alter table public.change_order enable row level security;
alter table public.approval     enable row level security;
drop policy if exists co_own on public.change_order;
create policy co_own on public.change_order for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- `appr_read` is NOT defined here [2026-07-21]. It lives in
-- 260_approval_visibility.sql, its single owner, because it must reference
-- public.project -- created in 100_projects.sql, 70 files after this one.
--
-- It used to be `using (true)`, which let any authenticated user read every approval
-- in the database: the full frozen document, the price, and the client's typed
-- signature, across every tenant. See 260 for why that went from nearly harmless to
-- serious the moment 230 started writing a row per client answer.

-- ---------------------------------------------------------------------------
-- OTP: identity binding for a signature. Deliberately NOT Supabase Auth --
-- auth.signInWithOtp would CREATE AN ACCOUNT, which contradicts REQ-VAL3's
-- no-login promise. The signer is an owner who will never sign up.
-- ---------------------------------------------------------------------------
create table if not exists public.signing_otp (
  token        text primary key,           -- the confirmation token being signed
  phone_e164   text not null,
  code_sha256  text not null,              -- never store the code itself
  attempts     integer not null default 0 check (attempts <= 5),
  expires_at   timestamptz not null default now() + interval '10 minutes',
  verified_at  timestamptz
);

create or replace function public.otp_issue(p_token text, p_phone text, p_code_sha256 text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into public.signing_otp (token, phone_e164, code_sha256)
  values (p_token, p_phone, p_code_sha256)
  on conflict (token) do update
    set code_sha256 = excluded.code_sha256, attempts = 0,
        expires_at = now() + interval '10 minutes', verified_at = null;
  return jsonb_build_object('status','issued');
end $$;

create or replace function public.otp_verify(p_token text, p_code_sha256 text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.signing_otp%rowtype;
begin
  select * into o from public.signing_otp where token = p_token for update;
  if not found then return jsonb_build_object('status','no_otp'); end if;
  if now() > o.expires_at then return jsonb_build_object('status','expired'); end if;
  if o.attempts >= 5 then return jsonb_build_object('status','locked'); end if;

  if o.code_sha256 <> p_code_sha256 then
    update public.signing_otp set attempts = attempts + 1 where token = p_token;
    return jsonb_build_object('status','wrong_code','attempts_left', 5 - (o.attempts + 1));
  end if;

  update public.signing_otp set verified_at = now() where token = p_token;
  return jsonb_build_object('status','verified');
end $$;

revoke all on function public.otp_issue  from public, anon;
revoke all on function public.otp_verify from public;
grant execute on function public.otp_issue  to authenticated;
grant execute on function public.otp_verify to anon, authenticated;

-- §7.3 status ledger: Approved/Pending/Declined + running total.
create or replace view public.co_ledger as
select co.project_id, co.id, co.scope, co.amount_cents, co.currency, co.status,
       co.is_mini, co.nte_cents, co.created_at,
       a.action as approval_action, a.legal_name as signed_by, a.signed_at,
       sum(case when co.status = 'approved' then co.amount_cents else 0 end)
         over (partition by co.project_id order by co.created_at
               rows between unbounded preceding and current row) as approved_running_cents
from public.change_order co
left join public.approval a on a.change_order_id = co.id
order by co.created_at;

-- Money formatting: integer cents -> a string, never a float.
-- `amount_cents/100.0` produced "$450.0000000000000000" in the ledger — harmless
-- looking, but the reason cents are integers is that money must never touch a
-- float. Formatting is presentation and belongs here, once, not in every caller.
create or replace function public.money_str(cents bigint, currency text default 'USD')
returns text language sql immutable as $$
  select case when cents is null then null
              else (case when currency = 'USD' then '$' else currency || ' ' end)
                   || to_char((cents / 100)::numeric, 'FM999,999,999') || '.'
                   || lpad((abs(cents) % 100)::text, 2, '0')
         end $$;

-- drop, not replace: CREATE OR REPLACE VIEW cannot insert a column into the
-- middle of an existing column list.
drop view if exists public.co_ledger;
create view public.co_ledger as
select co.project_id, co.id, co.scope, co.amount_cents, co.currency, co.status,
       co.is_mini, co.nte_cents, co.created_at,
       public.money_str(co.amount_cents, co.currency) as amount,
       public.money_str(co.nte_cents,    co.currency) as nte,
       a.action as approval_action, a.legal_name as signed_by, a.signed_at,
       sum(case when co.status = 'approved' then co.amount_cents else 0 end)
         over (partition by co.project_id order by co.created_at
               rows between unbounded preceding and current row) as approved_running_cents,
       -- NOTE: sum(bigint) returns NUMERIC, not bigint -- hence the cast. money
       -- stays integer cents all the way to the formatter; the cast is back to
       -- the same integer domain, not a float detour.
       public.money_str(
         (sum(case when co.status = 'approved' then co.amount_cents else 0 end)
           over (partition by co.project_id order by co.created_at
                 rows between unbounded preceding and current row))::bigint,
         co.currency) as approved_running
from public.change_order co
left join public.approval a on a.change_order_id = co.id
order by co.created_at;
