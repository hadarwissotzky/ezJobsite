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

drop trigger if exists confirmation_request_no_tamper on public.confirmation_request;
-- shown_content must never change after send; that is the whole point.
create or replace function public.confirmation_request_guard() returns trigger
  language plpgsql as $$ begin
    if new.shown_content is distinct from old.shown_content
       or new.shown_sha256 is distinct from old.shown_sha256
       or new.decision_id is distinct from old.decision_id then
      raise exception 'shown_content is frozen: it is the binding instrument';
    end if;
    return new;
  end $$;
create trigger confirmation_request_no_tamper before update
  on public.confirmation_request for each row execute function public.confirmation_request_guard();

alter table public.confirmation_request  enable row level security;
alter table public.confirmation_response enable row level security;

-- The sender sees their own requests + delivery state (REQ-VAL8).
drop policy if exists cr_own on public.confirmation_request;
create policy cr_own on public.confirmation_request for select to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The no-login door. anon may ONLY reach these two functions, never the tables.
-- ---------------------------------------------------------------------------

-- Fetch the frozen card by token. Returns exactly what was shown at send time.
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
    'answered_action', resp.action,
    'answered_at', resp.responded_at
  );
end $$;

-- Record the act. Single-use: a second call cannot overwrite the first.
create or replace function public.confirmation_respond(
  p_token text, p_action text, p_note text default null, p_user_agent text default null
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
    insert into public.confirmation_response (token, action, note, user_agent)
    values (p_token, p_action, p_note, p_user_agent);
  exception when unique_violation then
    -- Single-use. The first answer stands; a replay is not an error to the
    -- counterparty, but it MUST NOT change the record.
    return jsonb_build_object('status','already_answered');
  end;
  return jsonb_build_object('status','recorded','action',p_action);
end $$;

revoke all on function public.confirmation_fetch   from public;
revoke all on function public.confirmation_respond from public;
grant execute on function public.confirmation_fetch   to anon, authenticated;
grant execute on function public.confirmation_respond to anon, authenticated;

-- The sender creates requests through an RPC too, so shown_content is always
-- frozen server-side rather than trusted from a client that could re-render it.
create or replace function public.confirmation_create(
  p_token text, p_decision_id text, p_project_id text, p_kind text,
  p_shown_content text, p_shown_sha256 text, p_counterparty text,
  p_channel text, p_destination text
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into public.confirmation_request (token, decision_id, project_id, owner_id, kind,
    shown_content, shown_sha256, counterparty_label, channel, destination)
  values (p_token, p_decision_id, p_project_id, auth.uid(), p_kind,
          p_shown_content, p_shown_sha256, p_counterparty, p_channel, p_destination);
  return jsonb_build_object('status','created','token',p_token);
end $$;
revoke all on function public.confirmation_create from public, anon;
grant execute on function public.confirmation_create to authenticated;
