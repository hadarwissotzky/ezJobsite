-- 303_ewa.sql
--
-- R3 STEP ONE ON THE SERVER: the Extra Work Authorization.
--
-- WHAT AN EWA IS (PRD R3): "a signed approval, never an FYI -- the homeowner
-- commits to billability and proceed terms before the price exists." It carries
-- no amount. What it carries is ONE proceed term (hold, or T&M capped at $Y) plus
-- a settlement rule promising a price within 24 or 48h that, once approved,
-- supersedes and settles the authorization.
--
-- THE CENTRAL DECISION: an EWA is a change_order row, not a new record type.
--   Everything a signed instrument needs already hangs off change_order -- the
--   frozen-once-sent guard (030), the confirmation_request foreign key (240),
--   one-live-link retirement (250), the marks-sent trigger (230), the ledger.
--   A parallel table would have had to re-earn every one of them, and the first
--   one it failed to re-earn would be a signed authorization nothing could freeze.
--   So this file adds a SIDE TABLE holding the terms, keyed 1:1 by change_order_id,
--   and one column on change_order pointing a step-2 price at its parent.
--
-- amount_cents = 0 ON AN EWA, enforced below. Zero is the truthful number -- an
-- authorization commits the client to billability and terms, not to an amount --
-- and because it is zero, every money total that already exists (co_ledger, the
-- app's approved/awaiting sums) is correct for AC3 and AC5 without being touched.
-- The T&M cap rides in nte_cents, which is what that column is for.
--
-- ORDERING: runs after 030 (change_order), 020/200 (confirmation_request) and 290
-- (the r5c_mutation idempotency ledger pattern this file copies). It creates
-- nothing those files own.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The terms.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.extra_work_authorization (
  change_order_id   text primary key references public.change_order(id),
  project_id        text not null,
  owner_id          uuid not null,

  -- Exactly R3's two, and deliberately not a third. A bare "range" is refused in
  -- R3 for the reason that applies here too: an open-ended authorization
  -- reproduces the dispute at billing time instead of preventing it.
  proceed_term      text not null check (proceed_term in ('hold','tm_capped')),

  -- T&M only, integer cents. NULL on 'hold', where the frozen text names no
  -- figures at all -- storing one would contradict the instrument (mandate #5).
  hourly_rate_cents bigint check (hourly_rate_cents is null or hourly_rate_cents > 0),
  cap_cents         bigint check (cap_cents is null or cap_cents > 0),

  -- R3: "within [24/48]h". Two choices, not a free number: the settlement promise
  -- is a TERM of a signed document, and "72" typed on a ladder is a different
  -- contract than the one the product describes.
  settlement_hours  integer not null check (settlement_hours in (24,48)),

  -- AC4's clock starts here. Not derivable from change_order.status, which records
  -- the state but not the moment it changed.
  approved_at       timestamptz,

  created_at        timestamptz not null default now(),

  -- THE UNCAPPED-AUTHORIZATION GUARD. The single worst row this table could hold
  -- is a tm_capped term with a null cap: the client's frozen text would read "not
  -- to exceed $" and they would have signed an unbounded authorization to spend
  -- their own money. The device refuses it (validateEwaTerms in ewa.ts) and so
  -- does this, because a rule you can forget to apply on one of two paths is not
  -- a rule.
  constraint ewa_terms_complete check (
    (proceed_term = 'tm_capped'
       and hourly_rate_cents is not null and cap_cents is not null
       and cap_cents >= hourly_rate_cents)
    or
    (proceed_term = 'hold'
       and hourly_rate_cents is null and cap_cents is null)
  )
);

create index if not exists ewa_by_project
  on public.extra_work_authorization (project_id);

alter table public.extra_work_authorization enable row level security;
drop policy if exists ewa_own on public.extra_work_authorization;
create policy ewa_own on public.extra_work_authorization for select to authenticated
  using (owner_id = auth.uid());
-- Writes go through the device outbox, same as project_approver (280), change_order
-- and project_party. The client never holds insert/update/delete on the table.
revoke insert, update, delete on public.extra_work_authorization from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Step two names its parent.
-- ─────────────────────────────────────────────────────────────────────────────
-- ON THE CHILD, not the parent. A parent pointing at its child would have to be
-- UPDATED when the child arrives -- and change_order_guard freezes sent rows, so
-- that update would be refused exactly when it mattered. A child written once at
-- creation never needs to change.
alter table public.change_order
  add column if not exists parent_ewa_id text;
alter table public.change_order
  drop constraint if exists change_order_parent_ewa_fk;
-- NOT VALID: enforced for every new row without re-scanning history. There are no
-- existing rows with this column set, so this is belt-and-braces, matching how 240
-- added confirmation_request_change_order_fk.
alter table public.change_order
  add constraint change_order_parent_ewa_fk
  foreign key (parent_ewa_id) references public.change_order(id) not valid;

-- A change order cannot settle itself. Cheap, and it forecloses the state where a
-- row reads "Settled" against its own price and the real authorization stays open
-- and unpriced forever.
alter table public.change_order
  drop constraint if exists change_order_not_own_parent;
alter table public.change_order
  add constraint change_order_not_own_parent
  check (parent_ewa_id is null or parent_ewa_id <> id) not valid;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. An EWA is priceless, and stays that way.
-- ─────────────────────────────────────────────────────────────────────────────
-- A trigger rather than a CHECK on change_order, because the rule is a JOIN: it is
-- about a change_order that has an extra_work_authorization row. A CHECK cannot
-- see another table.
--
-- The failure this prevents: a step-one authorization edited to carry an amount
-- would appear in the ledger's approved total AND be settled by its step-2 price
-- later -- the client billed twice for one condition, which is the exact dispute
-- the two-step flow exists to prevent (AC3).
create or replace function public.ewa_is_priceless() returns trigger
  language plpgsql as $$ begin
    if exists (select 1 from public.extra_work_authorization
                where change_order_id = new.id)
       and new.amount_cents <> 0 then
      raise exception
        'an Extra Work Authorization carries no price: settle it with a step-2 change order'
        using errcode = '23514', hint = 'ewa_has_price';
    end if;
    return new;
  end $$;

drop trigger if exists change_order_ewa_priceless on public.change_order;
create trigger change_order_ewa_priceless
  before insert or update of amount_cents on public.change_order
  for each row execute function public.ewa_is_priceless();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The terms freeze when the authorization is sent.
-- ─────────────────────────────────────────────────────────────────────────────
-- Mandate #5. Once a client has the link, the proceed term and the settlement
-- window are part of what they are being asked to sign; changing them afterwards
-- would leave the frozen shown_content describing one arrangement and the app
-- describing another.
--
-- A SEPARATE trigger on its OWN table -- not an extension of
-- confirmation_request_guard. 200_priced_approval.sql documents at length what
-- happened when 020 and 200 CO-OWNED that guard: re-running the older file
-- restored the narrower version and quietly unfroze the price. Adding EWA terms to
-- someone else's function would recreate that failure with a third owner.
create or replace function public.ewa_terms_guard() returns trigger
  language plpgsql as $$
declare co_status text;
begin
  select status into co_status from public.change_order where id = old.change_order_id;
  if co_status in ('sent','approved','declined')
     and (new.proceed_term      is distinct from old.proceed_term
       or new.hourly_rate_cents is distinct from old.hourly_rate_cents
       or new.cap_cents         is distinct from old.cap_cents
       or new.settlement_hours  is distinct from old.settlement_hours) then
    raise exception
      'the authorization terms are frozen once sent: supersede it with a new one'
      using errcode = '23514', hint = 'ewa_terms_frozen';
  end if;
  return new;
end $$;

drop trigger if exists ewa_terms_no_tamper on public.extra_work_authorization;
create trigger ewa_terms_no_tamper before update
  on public.extra_work_authorization
  for each row execute function public.ewa_terms_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The approval page has to be able to CALL it an authorization.
-- ─────────────────────────────────────────────────────────────────────────────
-- AC2: "the record is labeled 'Extra Work Authorization,' not 'change order'."
-- confirmation_fetch already returns `kind`, so the page dispatches on it -- the
-- one thing missing was permission for the value to exist.
--
-- The constraint is dropped and re-added by its default name. 020 creates the
-- table only `if not exists`, so re-running 020 cannot silently restore the
-- narrow check; this file owns the kind vocabulary from here.
alter table public.confirmation_request
  drop constraint if exists confirmation_request_kind_check;
alter table public.confirmation_request
  add constraint confirmation_request_kind_check
  check (kind in ('confirm','acknowledge','ewa'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. The no-login page reads the terms.
-- ─────────────────────────────────────────────────────────────────────────────
-- A NEW anon function rather than extending confirmation_fetch. 250_one_live_link
-- set this precedent for the same reason: confirmation_fetch is one of the
-- already-duplicated functions and every extension of it multiplies the number of
-- files that can disagree about its shape.
--
-- It returns TERMS, not text. The binding instrument is still shown_content, which
-- confirmation_fetch already returns and the page still displays verbatim under
-- "See the exact wording". These fields exist so the page can render the clauses
-- LEGIBLY -- big, above the Approve button -- rather than making a homeowner read
-- a wall of monospace to find out whether work is proceeding.
--
-- Nothing here leaks across tokens: the token is the credential (REQ-VAL3) and the
-- lookup is keyed by it. The function returns only the terms of the one
-- authorization that token addresses.
create or replace function public.ewa_terms_fetch(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.confirmation_request%rowtype;
        e public.extra_work_authorization%rowtype;
begin
  select * into r from public.confirmation_request where token = p_token;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if now() > r.expires_at then return jsonb_build_object('status','expired'); end if;
  if r.kind is distinct from 'ewa' then return jsonb_build_object('status','not_an_ewa'); end if;

  select * into e from public.extra_work_authorization
   where change_order_id = r.change_order_id;
  -- FAIL CLOSED. A request marked 'ewa' whose terms did not sync is not something
  -- to render a partial approval page for: the page would show an Approve button
  -- over a document missing its proceed term, which is precisely what AC2 forbids.
  if not found then return jsonb_build_object('status','terms_missing'); end if;

  return jsonb_build_object(
    'status', 'open',
    'proceed_term', e.proceed_term,
    'hourly_rate_cents', e.hourly_rate_cents,
    'cap_cents', e.cap_cents,
    'settlement_hours', e.settlement_hours
  );
end $$;
revoke all on function public.ewa_terms_fetch(text) from public;
grant execute on function public.ewa_terms_fetch(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Transport. One RPC, three kinds -- mirroring ingest_r5c_v1 (290).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ewa_mutation (
  mutation_id    text primary key,
  request_sha256 text not null,
  applied_at     timestamptz not null default now()
);
alter table public.ewa_mutation enable row level security;

create or replace function public.ingest_ewa_v1(
  p_mutation_id text, p_kind text, p_id text, p_owner_id uuid,
  p_project_id text, p_proceed_term text,
  p_hourly_rate_cents bigint, p_cap_cents bigint, p_settlement_hours integer,
  p_ewa_change_order_id text, p_approved_at_ms bigint, p_created_at_ms bigint,
  p_request_sha256 text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare prior text;
begin
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  select request_sha256 into prior from public.ewa_mutation where mutation_id = p_mutation_id;
  if found then
    if prior is distinct from p_request_sha256 then
      raise exception 'mutation % replayed with a different payload', p_mutation_id
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','id',p_id);
  end if;

  if p_kind = 'create' then
    insert into public.extra_work_authorization
      (change_order_id, project_id, owner_id, proceed_term, hourly_rate_cents,
       cap_cents, settlement_hours, created_at)
    values (p_id, p_project_id, p_owner_id, p_proceed_term, p_hourly_rate_cents,
            p_cap_cents, p_settlement_hours, to_timestamp(p_created_at_ms / 1000.0))
    on conflict (change_order_id) do nothing;

  elsif p_kind = 'settle' then
    -- SECURITY DEFINER bypasses RLS, so every write here states its own owner
    -- check rather than inheriting one.
    --
    -- `status = 'draft'` matches the device: never re-parent a change order that is
    -- already in a client's hands. The client signed a price whose relationship to
    -- the authorization was fixed before they saw it, and it stays fixed.
    update public.change_order
       set parent_ewa_id = p_ewa_change_order_id
     where id = p_id and owner_id = p_owner_id and status = 'draft';

  elsif p_kind = 'approved' then
    -- EARLIEST WINS. Two devices drain out of order routinely, and a later
    -- timestamp arriving second must not restart AC4's clock and un-flag an
    -- authorization that is genuinely late.
    update public.extra_work_authorization
       set approved_at = to_timestamp(p_approved_at_ms / 1000.0)
     where change_order_id = p_id and owner_id = p_owner_id
       and (approved_at is null or approved_at > to_timestamp(p_approved_at_ms / 1000.0));

  else
    raise exception 'unknown ewa mutation kind %', p_kind using errcode = '23514';
  end if;

  insert into public.ewa_mutation (mutation_id, request_sha256)
  values (p_mutation_id, p_request_sha256);
  return jsonb_build_object('status','applied','id',p_id);
end $$;
revoke all on function public.ingest_ewa_v1 from public, anon;
grant execute on function public.ingest_ewa_v1 to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Settlement, as a view. AC3.
-- ─────────────────────────────────────────────────────────────────────────────
-- DERIVED, NOT STORED, and this was the main design call. A sixth value in
-- change_order.status ('settled') would need the CHECK widened in three places
-- including a STRICT SQLite table on phones in the field, and -- the deciding
-- reason -- a stored 'settled' can disagree with the child row it claims to
-- summarise. Settlement IS the existence of an approved child. Read from the
-- child, it cannot drift from the child.
--
-- The money column is the point of the view: `settled_amount_cents` is the CHILD's
-- price, never the cap. AC3 -- "the ledger shows only the settled amount in the
-- money total (T&M cap shown as history)".
create or replace view public.ewa_ledger as
select
  e.change_order_id,
  e.project_id,
  e.owner_id,
  co.scope,
  e.proceed_term,
  e.hourly_rate_cents,
  e.cap_cents,
  e.settlement_hours,
  e.approved_at,
  child.id            as settlement_change_order_id,
  child.status        as settlement_status,
  case when child.status = 'approved' then child.amount_cents end as settled_amount_cents,
  case
    when co.status = 'declined'   then 'declined'
    when co.status = 'superseded' then 'superseded'
    when co.status = 'approved' and child.status = 'approved' then 'settled'
    else co.status
  end                 as display_status,
  -- AC4, computed where the clock actually is. The deadline is the PROMISE the
  -- client holds (24h or 48h), never a flat 48: staying silent for a day about a
  -- broken 24h promise would be the app siding with the contractor against the
  -- document he sent.
  (co.status = 'approved'
     and child.id is null
     and e.approved_at is not null
     and now() > e.approved_at + make_interval(hours => e.settlement_hours))
                      as unpriced_overdue
from public.extra_work_authorization e
join public.change_order co on co.id = e.change_order_id
-- The MOST RECENT child, not any child: a step-2 price can be superseded and
-- re-sent, and settling on an older superseded child would show "Settled" against
-- a price nobody agreed to.
left join lateral (
  select c.id, c.status, c.amount_cents
    from public.change_order c
   where c.parent_ewa_id = e.change_order_id
   order by c.created_at desc, c.id desc
   limit 1
) child on true;

alter view public.ewa_ledger set (security_invoker = true);
grant select on public.ewa_ledger to authenticated;
