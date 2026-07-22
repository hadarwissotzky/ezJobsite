-- Confirm / acknowledge on the counterparty's own device — REQ-VAL1/2/3/8.
--
-- THE BINDING RULE (CLAUDE.md mandate #5, and it drives this whole schema):
-- "the frozen rendered text the signer actually saw (`shown_content`) is the
-- binding instrument". So the request FREEZES the card at send time. If the
-- decision later changes -- and REQ-VAL5 says it will, that is the point -- the
-- confirmation still evidences WHAT WAS SHOWN, not what the decision says now.
-- A confirmation that silently re-renders against current state is worthless in
-- a dispute, which is the only moment it matters.
--
-- No-login by design (REQ-VAL3): the counterparty is a GC or an owner who will
-- never make an account. The token IS the credential. That is a deliberate
-- trade: convenience over identity strength, mitigated by single-use, expiry,
-- and recording an identity SIGNAL rather than claiming proof of identity.

create table if not exists public.confirmation_request (
  token           text primary key,      -- the credential; 32+ bytes of entropy
  decision_id     text not null,
  project_id      text not null,
  owner_id        uuid not null,         -- who is asking

  kind            text not null check (kind in ('confirm','acknowledge')),
  -- FROZEN at send. Never regenerated. This is the binding instrument.
  shown_content   text not null check (length(shown_content) > 0),
  shown_sha256    text not null,

  counterparty_label text not null,      -- "Owner", "GC" -- what the sender called them
  channel         text not null check (channel in ('email','sms','link')),
  destination     text,                  -- email/phone; null for a raw link

  -- REQ-VAL8: delivery state must be visible to the SENDER.
  delivery_state  text not null default 'queued'
                    check (delivery_state in ('queued','sent','delivered','failed')),
  delivery_error  text,

  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '30 days'
);

-- The counterparty's act. Append-only: a response is evidence.
create table if not exists public.confirmation_response (
  token        text primary key references public.confirmation_request(token),
  action       text not null check (action in ('confirmed','declined')),
  -- what they typed, if anything (a decline reason)
  note         text,
  -- identity SIGNAL, not identity PROOF. Named honestly.
  user_agent   text,
  responded_at timestamptz not null default now()
);

create or replace function public.confirmation_no_change() returns trigger
  language plpgsql as $$ begin
    raise exception 'confirmations are append-only evidence: % blocked', tg_op;
  end $$;

drop trigger if exists confirmation_response_no_update on public.confirmation_response;
create trigger confirmation_response_no_update before update or delete
  on public.confirmation_response for each row execute function public.confirmation_no_change();

-- The freeze guard (`confirmation_request_guard`) and its trigger are NOT defined
-- here. They live in `200_priced_approval.sql`, which is their single owner.
--
-- Why they moved [2026-07-21]: 200 adds the priced columns (amount_cents, nte_cents,
-- scope_title, company_name, job_label, approved_running_cents, change_order_id) and
-- has to widen the guard to freeze them too. That left the SAME function defined in
-- two files, which `scripts/check-sql-duplicates.mjs` reports as FATAL for a real
-- reason: re-running THIS file after 200 silently restored the narrow guard, and
-- price/scope/company/job/change-order became mutable after send again. The freeze
-- is the whole point of this schema, so a rule that can be undone by running an old
-- file in the wrong order is not a rule.
--
-- This file now owns the TABLES. 200 owns the confirmation FUNCTIONS. One object,
-- one file.

alter table public.confirmation_request  enable row level security;
alter table public.confirmation_response enable row level security;

-- The sender sees their own requests + delivery state (REQ-VAL8).
drop policy if exists cr_own on public.confirmation_request;
create policy cr_own on public.confirmation_request for select to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The no-login door: confirmation_fetch / confirmation_respond / confirmation_create
--
-- NOT DEFINED HERE ANY MORE [2026-07-21]. All three live in
-- `200_priced_approval.sql`, together with their revoke/grant, which is their single
-- owner. 200 had to redefine every one of them to carry the priced columns and the
-- signed_name parameter, so keeping the older bodies here meant the same four
-- objects were defined twice and the checker flagged 4 FATAL duplicates.
--
-- The danger was not tidiness. Re-running this file after 200 would have:
--   * restored the narrow freeze guard (see above),
--   * restored confirmation_respond WITHOUT p_signed_name -- so the web page's RPC
--     call would stop matching the function signature, and
--   * restored confirmation_create without the priced columns, silently dropping
--     the frozen price out of every new request.
-- All three are the kind of failure that looks like the app "just broke" while every
-- file in the repo still reads correct on its own.
--
-- Applied in numeric order (010, 011, 020, ... 200, ...) a fresh database still ends
-- up with exactly these functions; they are simply created later, and nothing
-- between 020 and 200 calls them (verified).
-- ---------------------------------------------------------------------------
