-- 388_reminder_scheduler.sql
--
-- THE SERVER-SIDE HALF OF AUTOMATED REMINDERS. D5 / REQ-LC25 / R8.
--
-- R8 promises: one automated reminder when an extra has been Sent and unopened for
-- 24h, a maximum of 2 automated per extra, unlimited manual, rate-limited to 1/day
-- per extra, paused while the item is in discussion. Every one of those numbers was
-- unenforceable before this file, because the only record that a reminder had ever
-- been sent lived in `co_live_link.remind_count` -- a LOCAL SQLite table on one
-- phone (`activitystore.ts:118-181`). A second device, a reinstall, or a scheduler
-- running in the worker knew nothing about it, so "max 2" meant "max 2 per phone
-- that happens to remember".
--
-- ── THE LOUD-FAILURE REQUIREMENT IS THE SUBSTANCE OF D5, NOT A FOOTNOTE ─────
-- `send-sms`'s Twilio secrets are NOT set, and that function refuses to send when
-- unconfigured -- deliberately, and it must stay that way. Therefore this schema
-- separates CLAIMING an attempt from RECORDING that it was delivered:
--
--   claimed   the scheduler has taken this extra and is about to try. Consumes the
--             one-attempt-per-day gate immediately, so a broken transport cannot be
--             retried in a loop, and consumes NOTHING else.
--   sent      the transport confirmed. This is the ONLY outcome that spends the
--             max-2 automated budget, and the only one that puts a reminder on the
--             timeline.
--   failed    the attempt reached nobody, with the reason recorded, a notification
--             raised to the contractor, and the budget UNTOUCHED. Burning the budget
--             on a configuration outage would silently convert "we are not
--             configured to text anyone" into "we reminded them twice and they
--             ignored us" -- which is a lie the contractor would then act on.
--   abandoned a claim nobody ever reported on (the worker died mid-attempt). We do
--             not know whether it went out, so it is neither 'sent' nor 'failed'.
--             It does not spend the budget and it does not appear on the timeline.
--
-- The direction of every error here is chosen on purpose: this UNDER-reminds. An
-- abandoned claim still consumed its day, so the worst case of a crashing worker is
-- one silent missed reminder per extra per day -- never a client nagged in a loop,
-- and never a "we reminded them" that did not happen.
--
-- ── WHAT IS STILL OWED, so nobody reads this file as "reminders work now" ───
-- * The WORKER STEP does not exist. Nothing calls `claim_reminders_v1` yet. Until it
--   does, this file enforces the caps and records nothing, because nothing happens.
-- * The MANUAL path still counts locally. `record_manual_reminder_v1` exists for
--   `remindExtra` to call after the share sheet returns (never before -- the same
--   rule `noteReminded` already applies), but the device does not call it yet, so
--   the server's 1/day gate currently sees only automated attempts.
-- * The APP does not render `reminder_failed`. The timeline emits it and
--   `settle_reminder_v1` raises a push notification so a failure is not silent, but
--   REQ-LC25's "visible in the app, on the extra, in the contractor's own words" is
--   only half met until the record screen renders that event kind.
--
-- OWNERSHIP: every object below is created only here (check-sql-duplicates).
-- `change_order_timeline` MOVES HERE from 366 -- see the note above its definition.

-- ── the record of every attempt ─────────────────────────────────────────────
create table if not exists public.change_order_reminder (
  id              bigint generated always as identity primary key,
  change_order_id text not null,
  -- WHICH LINK was reused. R8: a reminder goes "always via the same link", so the
  -- token is part of what happened -- a reminder that pointed at a retired version
  -- is a different act from one that pointed at the live one, and only the recorded
  -- token can tell them apart afterwards.
  token           text not null references public.confirmation_request(token),
  owner_id        uuid not null,
  kind            text not null check (kind in ('automated','manual')),
  outcome         text not null default 'claimed'
                    check (outcome in ('claimed','sent','failed','abandoned')),
  failure_reason  text,
  claimed_at      timestamptz not null default now(),
  settled_at      timestamptz
);

create index if not exists change_order_reminder_co_idx
  on public.change_order_reminder (change_order_id, claimed_at);

-- AT MOST ONE OPEN CLAIM PER EXTRA, enforced by the database rather than by the
-- scheduler being careful. Two workers polling the same second would otherwise both
-- select the same candidate and both text the client; `on conflict do nothing`
-- against this index means the loser gets no row back and sends nothing.
create unique index if not exists change_order_reminder_one_claim
  on public.change_order_reminder (change_order_id) where outcome = 'claimed';

-- A reminder record settles ONCE and is never edited again or deleted. Same posture
-- as every other evidence table here, with the one transition the design needs.
create or replace function public.change_order_reminder_settle_once() returns trigger
  language plpgsql as $$ begin
  if tg_op = 'DELETE' then
    raise exception 'a reminder attempt is a recorded act: DELETE blocked';
  end if;
  if old.outcome <> 'claimed' then
    raise exception 'reminder % is already %, and a settled attempt is evidence',
      old.id, old.outcome using errcode = '23514', hint = 'reminder_settled';
  end if;
  if new.outcome not in ('sent','failed','abandoned') then
    raise exception 'a claim settles to sent, failed or abandoned, not %', new.outcome
      using errcode = '23514', hint = 'reminder_outcome';
  end if;
  -- Everything that describes WHAT was attempted is fixed at claim time. Only the
  -- verdict may be written, or "we reminded Sarah" could later become "we reminded
  -- someone else, on a different link".
  if new.change_order_id is distinct from old.change_order_id
     or new.token      is distinct from old.token
     or new.owner_id   is distinct from old.owner_id
     or new.kind       is distinct from old.kind
     or new.claimed_at is distinct from old.claimed_at then
    raise exception 'only the outcome of a reminder attempt may be written'
      using errcode = '23514', hint = 'reminder_frozen';
  end if;
  return new;
end $$;

drop trigger if exists change_order_reminder_immutable on public.change_order_reminder;
create trigger change_order_reminder_immutable before update or delete
  on public.change_order_reminder for each row
  execute function public.change_order_reminder_settle_once();

alter table public.change_order_reminder enable row level security;
-- Read-only to the contractor it belongs to; every write goes through the functions
-- below, which state their own checks. Same shape as `capture_discarded` (369).
drop policy if exists co_reminder_own on public.change_order_reminder;
create policy co_reminder_own on public.change_order_reminder for select to authenticated
  using (owner_id = auth.uid());

-- ── who is due, and why exactly these ───────────────────────────────────────
--
-- SERVICE ROLE ONLY. This is the scheduler's door; it reads across every tenant by
-- design, so it must never be reachable with a user's JWT.
--
-- Each predicate below is one clause of R8/REQ-LC25 and is written where it can be
-- checked against them, rather than being assembled in TypeScript where the rule
-- would exist in a second place:
--   status = 'sent'          the stored status. Not a derived one -- `discussing`
--                            and `viewed` are sub-states of sent (REQ-LC3).
--   a LIVE link              not superseded, not expired, not answered. Reminding
--                            against a retired token sends the client to "this
--                            version was replaced" BECAUSE they were reminded.
--   sent >= p_after_hours    measured from `confirmation_request.created_at`, the
--                            append-only evidence of when it went out (REQ-LC4).
--   never opened             REQ-LC25's gate, from 387's single definition of
--                            'viewed'. NOTE this is stricter than the brief's
--                            "unopened or unanswered": an extra that was opened and
--                            ignored is NOT reminded automatically. The spec is
--                            explicit ("has never been opened") and the manual
--                            Remind button covers the other case with a human
--                            deciding, which is the right actor for "they read it
--                            and said nothing".
--   no open question         R8: "auto-reminders pause while status = In
--                            Discussion (nagging mid-negotiation damages the
--                            relationship)". Same definition of an open question as
--                            `extra_questions_v1` (307) -- a question whose token
--                            has no answer.
--   < 2 automated 'sent'     R8's max-2. Only confirmed sends count.
--   nothing in 24h           R8's 1/day/extra, counting EVERY attempt including
--                            failures and abandoned claims: a transport that is
--                            down must produce one loud failure a day, not one per
--                            poll.
create or replace function public.claim_reminders_v1(
  p_limit int default 20, p_after_hours int default 24
) returns table (
  reminder_id        bigint,
  change_order_id    text,
  token              text,
  owner_id           uuid,
  project_id         text,
  scope_title        text,
  amount_cents       integer,
  channel            text,
  destination        text,
  counterparty_label text,
  sent_at            timestamptz
) language plpgsql security definer set search_path = public as $$
-- The OUT columns above (`change_order_id`, `token`, `owner_id`, …) are plpgsql
-- variables, and they share their names with the columns of the tables this body
-- reads. Without this directive `on conflict (change_order_id)` raises
-- "column reference is ambiguous" AT RUN TIME, not at create time -- the function
-- creates cleanly and fails the first time the scheduler ever calls it. Found by
-- running it, not by reading it. `use_column` is the correct resolution here rather
-- than renaming the OUT columns: the worker consumes these names, and no statement
-- below ever reads an OUT variable.
#variable_conflict use_column
begin
  -- Reap first. A claim nobody reported on blocks the unique index above forever,
  -- and an extra that can never be reminded again is a worse failure than a
  -- duplicate. One hour is far longer than any send takes; the 24h gate below means
  -- a reaped claim still cannot be retried today.
  update public.change_order_reminder
     set outcome = 'abandoned', settled_at = now(),
         failure_reason = 'claim expired: the worker never reported an outcome'
   where outcome = 'claimed' and claimed_at < now() - interval '1 hour';

  return query
  with live as (
    select r.*, row_number() over (partition by r.change_order_id
                                   order by r.created_at desc) as rn
      from public.confirmation_request r
     where r.change_order_id is not null
       and r.superseded_at is null
       -- …and not WITHDRAWN (421). A cancelled link has `cancelled_at` set and
       -- `superseded_at` null, so without this the scheduler goes on treating it as the
       -- live link and reminds a client about a change order the contractor withdrew —
       -- the exact opposite of what the withdrawal was for.
       and r.cancelled_at is null
       and now() <= r.expires_at
       and not exists (select 1 from public.confirmation_response x where x.token = r.token)
  ),
  due as (
    select co.id, l.token, co.owner_id, co.project_id,
           coalesce(l.scope_title, co.scope) as scope_title,
           l.amount_cents, l.channel, l.destination, l.counterparty_label,
           l.created_at as sent_at
      from public.change_order co
      join live l on l.change_order_id = co.id and l.rn = 1
      cross join lateral public.change_order_open_signal(co.id) s
     where co.status = 'sent'
       and l.created_at <= now() - make_interval(hours => p_after_hours)
       and s.viewed = false
       and not exists (
         select 1 from public.confirmation_question q
           join public.confirmation_request qr on qr.token = q.token
          where qr.change_order_id = co.id
            and not exists (select 1 from public.confirmation_response x where x.token = q.token))
       and (select count(*) from public.change_order_reminder m
             where m.change_order_id = co.id and m.kind = 'automated'
               and m.outcome = 'sent') < 2
       and not exists (
         select 1 from public.change_order_reminder m
          where m.change_order_id = co.id
            and m.claimed_at > now() - interval '24 hours')
     order by l.created_at
     limit p_limit
  ),
  claimed as (
    insert into public.change_order_reminder (change_order_id, token, owner_id, kind)
    select d.id, d.token, d.owner_id, 'automated' from due d
    on conflict (change_order_id) where outcome = 'claimed' do nothing
    returning id, change_order_id
  )
  select c.id, d.id, d.token, d.owner_id, d.project_id, d.scope_title,
         d.amount_cents, d.channel, d.destination, d.counterparty_label, d.sent_at
    from claimed c join due d on d.id = c.change_order_id;
end $$;

revoke all on function public.claim_reminders_v1(int, int) from public, anon, authenticated;
grant execute on function public.claim_reminders_v1(int, int) to service_role;

-- ── the verdict, reported by the transport and never guessed ────────────────
--
-- The scheduler calls this AFTER send-sms answers, never before. That is the same
-- rule the manual path already keeps (`remindExtra` increments only once the share
-- sheet returns) and it is the whole reason claim and settle are two calls.
create or replace function public.settle_reminder_v1(
  p_reminder_id bigint, p_outcome text, p_failure_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.change_order_reminder%rowtype;
        co public.change_order%rowtype;
begin
  if p_outcome not in ('sent','failed') then
    raise exception 'a transport reports sent or failed, not %', p_outcome
      using errcode = '23514';
  end if;
  if p_outcome = 'failed' and coalesce(btrim(p_failure_reason), '') = '' then
    -- D5's substance: a failure with no reason is indistinguishable from a silence,
    -- and a silent reminder failure is the thing this design exists to prevent.
    raise exception 'a failed reminder must record why' using errcode = '23514';
  end if;

  select * into m from public.change_order_reminder where id = p_reminder_id;
  if not found then
    raise exception 'unknown reminder %', p_reminder_id using errcode = '42704';
  end if;
  if m.outcome <> 'claimed' then
    -- Replay-safe: the trigger would refuse this anyway, but a retrying worker needs
    -- an answer it can act on rather than an exception it will retry forever.
    return jsonb_build_object('status','already_settled','outcome',m.outcome);
  end if;

  update public.change_order_reminder
     set outcome = p_outcome, settled_at = now(),
         failure_reason = case when p_outcome = 'failed' then btrim(p_failure_reason) end
   where id = p_reminder_id and outcome = 'claimed';

  if p_outcome = 'failed' then
    -- VISIBLE, not logged. REQ-LC25: "the failure is visible in the app, on the
    -- extra, in the contractor's own words". This rides 379's existing outbox, which
    -- the worker already drains, so a reminder that did not go out reaches the
    -- contractor's phone even though no screen renders the timeline event yet.
    select * into co from public.change_order where id = m.change_order_id;
    insert into public.notification_outbox (user_id, title, body, data)
    values (m.owner_id, 'Reminder not sent',
            'We could not text a reminder about ' ||
              coalesce(co.scope, 'your extra') || '. Nobody was contacted.',
            jsonb_build_object('changeOrderId', m.change_order_id,
                               'kind', 'reminder_failed',
                               'reason', btrim(p_failure_reason)));
  end if;

  return jsonb_build_object('status','settled','outcome',p_outcome,'id',p_reminder_id);
end $$;

revoke all on function public.settle_reminder_v1(bigint, text, text) from public, anon, authenticated;
grant execute on function public.settle_reminder_v1(bigint, text, text) to service_role;

-- ── the manual reminder, recorded where every device can see it ─────────────
--
-- WHY THE DEVICE MUST CALL THIS. R8's cap is "max 2 automated + unlimited manual,
-- rate-limited to 1/day per extra" -- one rate limit over BOTH kinds. The device
-- currently counts its own manual reminders in local SQLite, so the scheduler cannot
-- see them and could text a client hours after the contractor already did. This is
-- the shared counter; `remindExtra` calls it after the share sheet returns.
--
-- IDEMPOTENT ON THE DEVICE'S OWN TIMESTAMP: a replayed call with the same
-- `p_at_ms` lands once. A manual reminder has no mutation ledger because there is
-- nothing to reconcile -- the act either happened at that instant or it did not.
create unique index if not exists change_order_reminder_manual_once
  on public.change_order_reminder (change_order_id, claimed_at) where kind = 'manual';

create or replace function public.record_manual_reminder_v1(
  p_change_order_id text, p_at_ms bigint
) returns jsonb language plpgsql security definer set search_path = public as $$
declare co public.change_order%rowtype;
        tok text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into co from public.change_order where id = p_change_order_id;
  if not found or co.owner_id is distinct from auth.uid() then
    raise exception 'not your extra' using errcode = '42501';
  end if;

  -- The live link, by the same definition claim_reminders_v1 uses. A manual reminder
  -- reuses the live instrument and mints nothing (REQ-LC21); with no live link there
  -- is nothing to remind anyone about, and saying so beats recording an act that
  -- pointed nowhere.
  select r.token into tok
    from public.confirmation_request r
   where r.change_order_id = p_change_order_id
     and r.superseded_at is null
     -- …and not withdrawn (421). See the note on the other live-link filter above.
     and r.cancelled_at is null
     and now() <= r.expires_at
     and not exists (select 1 from public.confirmation_response x where x.token = r.token)
   order by r.created_at desc
   limit 1;
  if tok is null then
    return jsonb_build_object('status','no_live_link','id',p_change_order_id);
  end if;

  insert into public.change_order_reminder
    (change_order_id, token, owner_id, kind, outcome, claimed_at, settled_at)
  values (p_change_order_id, tok, co.owner_id, 'manual', 'sent',
          to_timestamp(p_at_ms / 1000.0), to_timestamp(p_at_ms / 1000.0))
  on conflict do nothing;

  return jsonb_build_object('status','recorded','id',p_change_order_id);
end $$;

revoke all on function public.record_manual_reminder_v1(text, bigint) from public, anon;
grant execute on function public.record_manual_reminder_v1(text, bigint) to authenticated;

-- ── the timeline learns about reminders ─────────────────────────────────────
--
-- OWNERSHIP MOVED HERE FROM 366_event_timeline.sql [2026-07-28]. 366 now carries a
-- pointer comment instead of the body, and its header note "WHAT THIS FILE
-- DELIBERATELY DOES NOT EMIT: `reminder`. No reminder is ever sent by this product
-- yet. An empty branch for a feature that does not exist is a lie waiting to be
-- believed." has been corrected in place, because it is no longer true.
--
-- It could not stay in 366 and gain a branch here: `create or replace function` is a
-- replace, not a merge, so the same function in two files means whichever migration
-- ran last wins, silently. One object, one file (020:60-97).
--
-- THE BRANCH IS GATED ON outcome, not on the row existing. A claim that failed or was
-- abandoned NEVER appears as "reminder sent" -- that would be 366's own rule ("an
-- event on the timeline with an invented position") broken by the very feature its
-- header refused to fake. `reminder_failed` is emitted as its own kind so the record
-- can say what actually happened; a screen that does not know the kind shows nothing,
-- which is why settle_reminder_v1 also raises a notification.
create or replace function public.change_order_timeline(p_change_order_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare evs jsonb; snap jsonb;
begin
  if not exists (
    select 1 from public.change_order co
     where co.id = p_change_order_id and co.owner_id = auth.uid()
  ) then
    raise exception 'not your change order' using errcode = '42501';
  end if;

  with req as (
    select * from public.confirmation_request where change_order_id = p_change_order_id
  ),
  evs_raw as (
    select 'sent'::text as kind, r.created_at as at_ts,
           jsonb_build_object('channel', r.channel, 'who', r.counterparty_label) as detail
      from req r
    union all
    select 'opened', o.opened_at, '{}'::jsonb
      from public.confirmation_open o join req r on r.token = o.token
    union all
    select 'asked', q.asked_at, jsonb_build_object('note', q.note)
      from public.confirmation_question q join req r on r.token = q.token
    union all
    select case when x.action = 'confirmed' then 'approved' else 'declined' end,
           x.responded_at,
           jsonb_build_object('name', x.signed_name, 'note', x.note)
      from public.confirmation_response x join req r on r.token = x.token
    union all
    -- A superseded link IS the revision event R6 asks for: the old instrument was
    -- retired at that instant because a new one was issued (250).
    select 'superseded', r.superseded_at, '{}'::jsonb
      from req r where r.superseded_at is not null
    union all
    -- Only a reminder that a transport confirmed. `settled_at` is when it went out,
    -- so it lands on the timeline at its real position rather than at claim time.
    select 'reminder', m.settled_at, jsonb_build_object('how', m.kind)
      from public.change_order_reminder m
     where m.change_order_id = p_change_order_id and m.outcome = 'sent'
    union all
    select 'reminder_failed', m.settled_at, jsonb_build_object('reason', m.failure_reason)
      from public.change_order_reminder m
     where m.change_order_id = p_change_order_id and m.outcome = 'failed'
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('kind', kind, 'at', at_ts, 'detail', detail)
                     order by at_ts),
           '[]'::jsonb)
    into evs
    from evs_raw;

  -- The binding instrument, for AC2: "either party opens its record later, then they
  -- see the identical immutable snapshot". The contractor's app was rendering
  -- change_order.scope — the MUTABLE local row — which is the one thing that must
  -- never stand in for the signed document.
  --
  -- Which request, when there are several: the ANSWERED one wins, because that is the
  -- one that was signed. Only if none was answered does the newest live one show.
  select jsonb_build_object(
           'token', r.token,
           'shown_content', r.shown_content,
           'shown_sha256', r.shown_sha256,
           'action', x.action,
           'signed_name', x.signed_name,
           'answered_at', x.responded_at,
           'superseded', r.superseded_at is not null)
    into snap
    from public.confirmation_request r
    left join public.confirmation_response x on x.token = r.token
   where r.change_order_id = p_change_order_id
   order by (x.token is not null) desc, r.created_at desc
   limit 1;

  return jsonb_build_object('events', evs, 'snapshot', snap);
end $$;

revoke all on function public.change_order_timeline from public, anon;
grant execute on function public.change_order_timeline to authenticated;
