-- 421_cancel_sent_extra.sql
--
-- WITHDRAWING A SENT EXTRA — the contractor's fourth Stage 2 move.
--
-- hadar, 2026-08-24: "i need to be able to cancel a none approved but sent co -- when
-- that is done by the contractor -- send a note to all of the recepients".
--
-- THIS OVERRIDES SPEC-extra-lifecycle-v1 REQ-LC20, which said the Stage 2 move set was
-- exactly Reply · Remind · Revise & Resend and named "cancel" as one of the moves that
-- does not exist, on the reasoning that a contractor who wants the work not to happen
-- "issues nothing — the link expires (30 days) or he revises to a version the client
-- declines". Both of those leave a live instrument sitting in a client's messages for up
-- to a month with nothing said, which is the miscommunication the product exists to
-- prevent. Decision recorded and the requirement amended in the same change.
--
-- ─── WHY A SIXTH STATUS AND NOT `superseded` ────────────────────────────────────
-- `superseded` means A NEWER VERSION REPLACED THIS. The client's page says so and links
-- them forward (367). A withdrawal has no successor, and telling somebody "this was
-- replaced" when nothing replaced it is a false statement printed on the instrument they
-- were asked to sign. Different fact, different word.
--
-- ─── APPROVAL WINS, ALWAYS ──────────────────────────────────────────────────────
-- If the client answered a second before he tapped cancel, the cancel is REFUSED rather
-- than raced. An approved record is frozen and permanent (mandate #1, REQ-LC30); a
-- cancellation that could land on top of one would let a contractor un-sign a signed
-- document. The refusal names what happened so the app can say "they already approved
-- it" instead of failing silently.
--
-- ─── THE LINK DIES IN THE SAME TRANSACTION ──────────────────────────────────────
-- Not afterwards, not from the app. An approval already in flight must not be able to
-- land after the status moved — that would produce a signed instrument for work the
-- contractor had withdrawn. `cancelled_at` on the request is what the response trigger
-- and the page both read.

-- ── 1. the status vocabulary ────────────────────────────────────────────────────
alter table public.change_order drop constraint if exists change_order_status_check;
alter table public.change_order
  add constraint change_order_status_check
  check (status in ('draft','sent','approved','declined','superseded','cancelled'));

alter table public.change_order
  add column if not exists cancelled_at timestamptz,
  -- What he told the client, frozen at the moment he withdrew it. Nullable: the reason
  -- is optional, and an absent one is honest rather than a blank quote.
  add column if not exists cancel_reason text;

-- ── 2. a cancelled link is dead, and says why ───────────────────────────────────
alter table public.confirmation_request
  add column if not exists cancelled_at timestamptz;

create or replace function public.confirmation_response_not_cancelled() returns trigger
  language plpgsql as $$
declare c timestamptz;
begin
  select cancelled_at into c
    from public.confirmation_request where token = new.token;
  if c is not null then
    raise exception 'this change order was withdrawn by the contractor'
      using errcode = '23514', hint = 'link_cancelled';
  end if;
  return new;
end $$;

drop trigger if exists confirmation_response_not_cancelled on public.confirmation_response;
create trigger confirmation_response_not_cancelled before insert on public.confirmation_response
  for each row execute function public.confirmation_response_not_cancelled();

-- ── 3. the act ──────────────────────────────────────────────────────────────────
--
-- Returns the recipients so the CALLER can tell them. Deliberately: the SMS goes out
-- from the device through the same path every other message takes, and an RPC that
-- both mutates and sends would have to own a delivery failure it cannot retry.
create or replace function public.cancel_change_order_v1(
  p_change_order_id text,
  p_reason text default null
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare co public.change_order%rowtype;
        rec jsonb;
begin
  select * into co from public.change_order
   where id = p_change_order_id and owner_id = auth.uid()
   for update;
  if not found then
    raise exception 'not your change order' using errcode = '42501';
  end if;

  -- An answered link outranks the cancel, even when the row has not caught up: the
  -- response table is the authority on what the client did.
  if co.status = 'approved'
     or exists (select 1 from public.confirmation_response cr
                  join public.confirmation_request rq on rq.token = cr.token
                 where rq.change_order_id = co.id and cr.action = 'confirmed') then
    raise exception 'they already approved it' using errcode = '23514', hint = 'already_approved';
  end if;

  if co.status <> 'sent' then
    raise exception 'only a sent change order can be withdrawn'
      using errcode = '23514', hint = 'not_sent';
  end if;

  update public.change_order
     set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
   where id = co.id;

  -- Every live link for this extra dies here, in the same transaction as the status.
  update public.confirmation_request
     set cancelled_at = now()
   where change_order_id = co.id
     and cancelled_at is null
     and not exists (select 1 from public.confirmation_response x where x.token = token);

  -- WHO TO TELL. Every destination this extra was ever sent to, deduplicated — a
  -- client who was reminded on two channels is one person and gets one note.
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'channel', channel, 'destination', destination,
           'label', counterparty_label)), '[]'::jsonb)
    into rec
    from public.confirmation_request
   where change_order_id = co.id and destination is not null;

  return jsonb_build_object('ok', true, 'recipients', rec);
end $$;

revoke all on function public.cancel_change_order_v1(text, text) from public;
grant execute on function public.cancel_change_order_v1(text, text) to authenticated;

-- ── 4. the page must say withdrawn, not replaced ────────────────────────────────
--
-- `confirmation_state` is owned by 367. It is NOT redefined here — one object, one file
-- (check-sql-duplicates). 367 gains the `cancelled` field; this file only depends on it.
