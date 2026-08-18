-- 409 — credits: reservations, the spend outbox, the billing event log, pricing config.
--
-- hadar, 2026-08-17: "the goal for this change of model is 2 fold. 1. lower the entry
-- level, less resistance 2. avoid apple tax as much as we can — the packages is like a
-- pay as you go solution. we need to use payment system via the webpage — need to find
-- a solution that will support both subscription and package (capacity) based — the
-- user can buy more credits."
--
-- ─── THE ONE RULE THIS SCHEMA EXISTS TO ENFORCE ─────────────────────────────────
-- REVENUECAT OWNS THE BALANCE. THIS DATABASE OWNS RESERVATIONS. THE BALANCE IS NEVER
-- MIRRORED HERE AS A MUTABLE COUNTER.
--
--     available_to_send = revenuecat_balance − count(reservations where state='OPEN')
--
-- RevenueCat has no concept of "reserved, pending signature" — that is domain state and
-- belongs here. But a second copy of the BALANCE is two sources of truth, and they
-- diverge exactly when a contractor is disputing a charge. `company_billing.rc_balance_cached`
-- below exists only so a screen can render a number offline; it is advisory, it is
-- named so, and no spend decision may read it.
--
-- ─── WHY THE SPEC'S OWN SCHEMA DOES NOT APPLY HERE ──────────────────────────────
-- `ezChangeOrders-Payment-Spec.md` §4 declares `account_id uuid references account(id)`
-- and `change_order_id uuid`. THERE IS NO `account` TABLE, and both keys are TEXT:
-- `company.id` is a client-minted 'cmp-…' (376) and `change_order.id` is text (030).
-- Applying the spec verbatim fails at the first foreign key. Adapted, not copied.
--
-- ─── A SIGNATURE IS NEVER BLOCKED BY BILLING (R-5.3) ────────────────────────────
-- The consume path is split in two on purpose. `confirmation_response_settles_co()`
-- (230) is the trigger that settles a signature; all it does here is append a row to
-- `credit_spend_outbox`, which is a local INSERT that cannot fail on a network. A
-- worker drains that outbox, calls RevenueCat, and only then moves the reservation to
-- CONSUMED with the transaction id.
--
-- Under-billing is recoverable. A failed signature is a lost change order and a lost
-- customer. If those two ever trade against each other, the signature wins.

-- ── reservations ────────────────────────────────────────────────────────────────
create table if not exists public.credit_reservation (
  id              text primary key,
  company_id      text not null references public.company(id),
  change_order_id text not null references public.change_order(id),
  state           text not null check (state in ('OPEN','CONSUMED','RELEASED')),
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  close_reason    text check (close_reason in ('SIGNED','DECLINED','CANCELLED','EXPIRED')),
  -- Set when the RevenueCat spend succeeds. Null on an OPEN or RELEASED row, and null
  -- on a CONSUMED row whose spend has not drained yet — which is a real, temporary and
  -- visible state, not an error.
  rc_transaction_id text,
  -- The spend is idempotent on this. A signature webhook can fire twice; a double
  -- spend is a customer-facing billing error and the hardest kind to explain.
  idempotency_key text not null unique
);

-- ONE OPEN RESERVATION PER CHANGE ORDER, EVER.
--
-- This index is what makes "revise and resend five times consumes exactly one credit"
-- STRUCTURALLY true rather than true-if-the-app-remembers. REQ-LC22 says a revision
-- mints a new instrument and retires the old one; the credit must not follow it. Do not
-- move this rule into application code — it is money, and it will be read in a dispute.
create unique index if not exists one_open_reservation_per_co
  on public.credit_reservation (change_order_id) where state = 'OPEN';

create index if not exists credit_reservation_by_company
  on public.credit_reservation (company_id, state);

-- ── the spend outbox ────────────────────────────────────────────────────────────
--
-- Written by the settle trigger, drained by the worker. Append-only: a spend that
-- happened is a fact, and a retry reads `drained_at` rather than deleting the row, so
-- the history of what was charged survives the charging.
create table if not exists public.credit_spend_outbox (
  id             bigserial primary key,
  reservation_id text not null references public.credit_reservation(id),
  company_id     text not null references public.company(id),
  queued_at      timestamptz not null default now(),
  drained_at     timestamptz,
  attempts       int not null default 0,
  last_error     text
);

create index if not exists credit_spend_outbox_pending
  on public.credit_spend_outbox (queued_at) where drained_at is null;

-- ── billing state per company ───────────────────────────────────────────────────
create table if not exists public.company_billing (
  company_id            text primary key references public.company(id),
  -- What RevenueCat is keyed on. Already `company.id` today (billing.ts:12-15) — the
  -- owner pays and crew inherit — but stored explicitly so a future re-key is a data
  -- migration rather than a guess.
  rc_app_user_id        text not null,
  -- Signed change orders consumed from the free allowance. Checked BEFORE any
  -- reservation: the free allowance creates no reservation and never touches
  -- RevenueCat, so a free user has no billing relationship at all.
  free_allowance_used   int not null default 0,
  -- ADVISORY ONLY. Rendering a number offline. Never a spend decision. See the header.
  rc_balance_cached     int not null default 0,
  rc_balance_cached_at  timestamptz,
  updated_at            timestamptz not null default now()
);

-- ── the billing event log ───────────────────────────────────────────────────────
--
-- Append-only and immutable, for the same reason every evidence table in this schema
-- is: it will be read in a dispute, and the reader must be able to trust that nothing
-- was tidied up afterwards.
--
-- `rc_event_id` unique is not bookkeeping — IT IS THE IDEMPOTENCY MECHANISM. Today
-- `supabase/functions/revenuecat-webhook` has none, so a late-delivered EXPIRATION
-- arriving after a re-subscribe DOWNGRADES A PAYING COMPANY. That is a live bug and
-- this table is half its fix.
create table if not exists public.billing_event_log (
  id              bigserial primary key,
  company_id      text,
  created_at      timestamptz not null default now(),
  source          text not null check (source in ('rc_webhook','edge_fn','worker','admin')),
  event_type      text not null,
  rc_event_id     text unique,
  -- The event's own clock, from the provider. Out-of-order delivery is normal and this
  -- is what lets a handler ignore an event older than the state it already applied.
  event_at        timestamptz,
  payload         jsonb not null
);

create index if not exists billing_event_log_by_company
  on public.billing_event_log (company_id, created_at desc);

-- ── pricing config ──────────────────────────────────────────────────────────────
--
-- REMOTELY MUTABLE, AND THAT IS THE POINT (spec R-3.9).
--
-- Apple's commission on external-link purchases has been ZERO in the US since April
-- 2025. Apple has proposed 5–15%; the Ninth Circuit set a cost-recovery standard, Epic
-- has objected, and the Supreme Court hears the appeal in the October 2026 term. Assume
-- this moves at least once within a year.
--
-- Every price, the rail selection and the IAP differential live here so that a ruling
-- changes a row rather than shipping a build and waiting on App Store review. The
-- client hardcodes nothing.
create table if not exists public.pricing_config (
  id                   int primary key default 1 check (id = 1),
  version              int not null default 1,
  -- {"credits_5":{"credits":5,"web":2500,"iap":3299}, …} — cents, integers only.
  pack_prices          jsonb not null default '{}'::jsonb,
  -- {"core":{"monthly":2400,"annual":22900,"credits_per_month":N}, …}
  subscription_prices  jsonb not null default '{}'::jsonb,
  iap_multiplier       numeric not null default 1.30,
  -- Rails. Both may be on; neither being on is a misconfiguration the client must
  -- survive by showing "contact us" rather than a dead button.
  linkout_enabled      boolean not null default true,
  iap_enabled          boolean not null default true,
  -- TWO, not three (hadar, 2026-08-17). It matches what already ships: `plans.ts`
  -- free.changeOrders is 2, and a free tier that promised 3 here while the client
  -- refused the third would be the app arguing with itself in front of a new user.
  free_allowance       int not null default 2,
  updated_at           timestamptz not null default now()
);

insert into public.pricing_config (id) values (1) on conflict (id) do nothing;

-- ── immutability, enforced at the database and not by discipline ────────────────
--
-- `credit_reservation` is deliberately NOT frozen against UPDATE: its whole life is a
-- state transition, and the transition is guarded by `credit_transition()` below. What
-- IS frozen is the log and the audit trail on the outbox.
create or replace function public.billing_event_log_immutable() returns trigger
  language plpgsql as $$
begin
  raise exception 'billing_event_log is append-only';
end $$;

drop trigger if exists billing_event_log_no_change on public.billing_event_log;
create trigger billing_event_log_no_change before update or delete
  on public.billing_event_log for each row
  execute function public.billing_event_log_immutable();

-- ── the only legal way a reservation moves ──────────────────────────────────────
--
-- OPEN → CONSUMED | RELEASED, once, and never back. A CONSUMED reservation is money
-- that has been charged; a RELEASED one is a credit already returned to the balance.
-- Re-opening either is how a contractor gets billed twice for one change order.
create or replace function public.credit_transition() returns trigger
  language plpgsql as $$
begin
  if old.state <> 'OPEN' and new.state <> old.state then
    raise exception 'reservation % is already %, cannot become %',
      old.id, old.state, new.state using errcode = '23514';
  end if;
  if new.state <> old.state and new.state not in ('CONSUMED','RELEASED') then
    raise exception 'illegal reservation state %', new.state using errcode = '23514';
  end if;
  -- The columns that identify WHAT was reserved are frozen for the row's whole life.
  if new.company_id <> old.company_id or new.change_order_id <> old.change_order_id
     or new.idempotency_key <> old.idempotency_key or new.opened_at <> old.opened_at then
    raise exception 'a reservation cannot be re-pointed' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists credit_reservation_transition on public.credit_reservation;
create trigger credit_reservation_transition before update
  on public.credit_reservation for each row
  execute function public.credit_transition();

-- ── RLS: read your own, write nothing ───────────────────────────────────────────
--
-- Every mutation goes through a SECURITY DEFINER function or an Edge Function holding
-- the service role. The client may READ its billing state so a screen can render
-- without a round trip, and may write none of it — a balance the client can write is
-- not a balance.
alter table public.credit_reservation enable row level security;
alter table public.credit_spend_outbox enable row level security;
alter table public.company_billing     enable row level security;
alter table public.billing_event_log   enable row level security;
alter table public.pricing_config      enable row level security;

drop policy if exists credit_reservation_read_own on public.credit_reservation;
create policy credit_reservation_read_own on public.credit_reservation for select
  to authenticated using (
    exists (select 1 from public.company_member m
             where m.company_id = credit_reservation.company_id
               and m.user_id = auth.uid() and m.status = 'active'));

drop policy if exists company_billing_read_own on public.company_billing;
create policy company_billing_read_own on public.company_billing for select
  to authenticated using (
    exists (select 1 from public.company_member m
             where m.company_id = company_billing.company_id
               and m.user_id = auth.uid() and m.status = 'active'));

-- Prices are public by nature: the paywall renders them before anyone signs in, and
-- the checkout page is anonymous. Nothing here is a secret.
drop policy if exists pricing_config_read_all on public.pricing_config;
create policy pricing_config_read_all on public.pricing_config for select
  to anon, authenticated using (true);

-- `credit_spend_outbox` and `billing_event_log` have RLS on and NO select policy, which
-- denies by default. They are worker/admin surfaces; a contractor's own view of what he
-- was charged comes from `credit_reservation`, which he can read.
