-- 412 — a signature consumes the credit, and never waits for a billing call.
--
-- ─── WHERE THIS HOOKS IN ────────────────────────────────────────────────────────
-- `confirmation_response_settles_co()` (230) is the trigger that fires when a client
-- answers: it writes the `approval` evidence row and walks the change order to approved
-- or declined. That is the exact moment a credit is spent — R-5.1: a credit is consumed
-- WHEN THE HOMEOWNER SIGNS, not on capture and not on send.
--
-- ─── WHAT IT MUST NOT DO, AND THIS IS THE WHOLE DESIGN ──────────────────────────
-- IT MUST NOT CALL REVENUECAT. This runs inside the transaction that records a
-- homeowner's signature. A network call there means a slow or failing billing provider
-- can refuse a signature — and R-5.3 is explicit about which way that trade goes:
--
--     Under-billing is recoverable. A failed signature is a lost change order and a
--     lost customer.
--
-- So the trigger does two local writes that cannot fail on a network: it moves the
-- reservation to CONSUMED, and it appends a row to `credit_spend_outbox`. The worker
-- drains that outbox and calls RevenueCat. The intent to charge becomes exactly as
-- durable as the signature itself, because it is written in the same transaction.
--
-- ─── DECLINES RELEASE, AND THAT IS NOT A COURTESY ───────────────────────────────
-- "You only pay for change orders that get authorised" is the entire pitch of the pack
-- model. A declined extra returns its credit here, in the same trigger, so it cannot
-- depend on the app being open or a client remembering to call `release`.
--
-- ─── FREE SENDS NEVER REACH REVENUECAT ──────────────────────────────────────────
-- An `is_free` reservation is still moved to CONSUMED — the free allowance is used up
-- and stays used — but NO outbox row is written. The free tier has no billing
-- relationship at all, which is 409's stated intent and is preserved here rather than
-- re-litigated.

create or replace function public.confirmation_response_settles_co() returns trigger
  language plpgsql security definer set search_path = public as $$
declare r public.confirmation_request%rowtype;
        act text;
        res public.credit_reservation%rowtype;
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

  -- ── the credit ────────────────────────────────────────────────────────────────
  --
  -- Locked so two answers arriving together cannot both consume it. `for update` on the
  -- one open row is the cheapest correct thing here; the partial unique index already
  -- guarantees there is at most one.
  select * into res
    from public.credit_reservation
   where change_order_id = r.change_order_id and state = 'OPEN'
   for update;

  -- No reservation is a NORMAL state, not an error: an unlimited subscription reserves
  -- nothing, and a change order sent before this system existed has none either. Both
  -- settle exactly as they did before — the signature is what matters.
  if found then
    if act = 'approved' then
      update public.credit_reservation
         set state = 'CONSUMED', closed_at = now(), close_reason = 'SIGNED'
       where id = res.id;

      -- ONLY a paid reservation is queued for a spend. A free one is used up above and
      -- stops there; RevenueCat never hears about the free tier.
      if not res.is_free then
        insert into public.credit_spend_outbox (reservation_id, company_id)
        values (res.id, res.company_id);
      end if;
    else
      -- DECLINED gives the credit back. This is the model's promise — you only pay for
      -- change orders that get authorised — and it happens here so it cannot depend on
      -- the app being open.
      update public.credit_reservation
         set state = 'RELEASED', closed_at = now(), close_reason = 'DECLINED'
       where id = res.id;
    end if;
  end if;

  return new;
end $$;

-- The trigger itself is unchanged; recreated so a fresh database gets it from this file
-- too rather than depending on 230 having been applied first.
drop trigger if exists confirmation_response_settles on public.confirmation_response;
create trigger confirmation_response_settles after insert on public.confirmation_response
  for each row execute function public.confirmation_response_settles_co();

-- ── what the worker claims ──────────────────────────────────────────────────────
--
-- One row at a time, oldest first, skipping anything another worker already holds.
-- `for update skip locked` is the same pattern `claim_job` uses for the processing
-- pipeline, for the same reason: two workers must never spend the same credit twice,
-- and a crashed worker must not park a row forever.
create or replace function public.claim_credit_spend()
returns table (outbox_id bigint, reservation_id text, company_id text, idempotency_key text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare row_id bigint;
begin
  select o.id into row_id
    from public.credit_spend_outbox o
   where o.drained_at is null
     -- Backoff: a row that has failed recently is left alone. Without this a permanently
     -- failing spend spins hot and starves every other row behind it.
     and (o.attempts = 0 or o.queued_at < now() - (interval '1 minute' * least(o.attempts, 30)))
   order by o.queued_at
   for update skip locked
   limit 1;

  if row_id is null then return; end if;

  update public.credit_spend_outbox set attempts = attempts + 1 where id = row_id;

  return query
    select o.id, o.reservation_id, o.company_id, r.idempotency_key
      from public.credit_spend_outbox o
      join public.credit_reservation r on r.id = o.reservation_id
     where o.id = row_id;
end $$;

-- Marks a spend done, with the RevenueCat transaction id recorded ON THE RESERVATION —
-- so "what were we charged for" and "what did RevenueCat do about it" are one row apart
-- in a dispute rather than a join away through a log.
create or replace function public.settle_credit_spend(
  p_outbox_id bigint, p_rc_transaction_id text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.credit_spend_outbox
     set drained_at = now(), last_error = null
   where id = p_outbox_id;

  update public.credit_reservation r
     set rc_transaction_id = nullif(btrim(p_rc_transaction_id), '')
    from public.credit_spend_outbox o
   where o.id = p_outbox_id and r.id = o.reservation_id;
end $$;

-- A failure is RECORDED AND LEFT PENDING. It is not drained, so the backoff above picks
-- it up again; the reason is kept so a human can see why a charge is not landing without
-- reading provider logs.
create or replace function public.fail_credit_spend(
  p_outbox_id bigint, p_error text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.credit_spend_outbox
     set last_error = left(coalesce(p_error, ''), 500)
   where id = p_outbox_id;
end $$;

revoke all on function public.claim_credit_spend()          from public, anon, authenticated;
revoke all on function public.settle_credit_spend(bigint, text) from public, anon, authenticated;
revoke all on function public.fail_credit_spend(bigint, text)   from public, anon, authenticated;
-- Service role only. These three move money and are not a client's business.
