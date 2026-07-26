-- Remote push notifications — REQ-NOTIF1 (the PUSH half; in-app already exists).
--
-- WHY AN OUTBOX, NOT pg_net. pg_net is not installed on this project, so a trigger
-- cannot call the send-push Edge Function directly. Instead the notifiable events
-- write a row to notification_outbox, and the durable-jobs WORKER (already polling)
-- drains it and sends via Expo's push service. No new infra, one more worker step.
--
-- EVENTS (PRD: approval-result → instigator, approval-requested → owner): a change
-- order moving to approved/declined notifies its owner (the contractor). Opening the
-- link notifies too — the contractor learns the client is looking. The owner is the
-- recipient of every event here; @mention/assignment notifications are a follow-up.

-- Where a device's Expo push token lives. The client upserts its OWN row (RLS); the
-- worker reads all tokens with the service role to send.
create table if not exists public.push_token (
  user_id    uuid not null,
  token      text not null,
  platform   text,
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);
alter table public.push_token enable row level security;
drop policy if exists push_token_own on public.push_token;
create policy push_token_own on public.push_token for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The queue the worker drains. Server-owned: no client policy (the client never reads
-- or writes it; only triggers insert and the worker updates sent_at).
create table if not exists public.notification_outbox (
  id          text primary key default gen_random_uuid()::text,
  user_id     uuid not null,               -- who to notify
  title       text not null,
  body        text not null,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  attempts    integer not null default 0,
  sent_at     timestamptz,
  last_error  text
);
create index if not exists notif_outbox_unsent on public.notification_outbox (created_at)
  where sent_at is null;
alter table public.notification_outbox enable row level security;  -- no policy → clients can't touch it

-- Verdict → contractor. Fires when a change order becomes approved or declined.
create or replace function public.notify_on_verdict() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved','declined') and new.status is distinct from old.status then
    insert into public.notification_outbox (user_id, title, body, data)
    values (new.owner_id,
            case when new.status = 'approved' then 'Approved ✓' else 'Declined' end,
            coalesce(new.scope, 'Your extra') || (case when new.status = 'approved' then ' was approved.' else ' was declined.' end),
            jsonb_build_object('changeOrderId', new.id, 'kind', new.status));
  end if;
  return new;
end $$;
drop trigger if exists change_order_verdict_notify on public.change_order;
create trigger change_order_verdict_notify after update of status on public.change_order
  for each row execute function public.notify_on_verdict();

-- Opened → contractor, ONCE per link. Only the FIRST open of a token notifies — a
-- client reopening across sessions, or link-preview bots hitting it under different
-- user agents, must not spam "opened" every time (review 2026-07-25).
create or replace function public.notify_on_open() returns trigger
language plpgsql security definer set search_path = public as $$
declare cr public.confirmation_request;
begin
  if exists (select 1 from public.confirmation_open o
              where o.token = new.token and o.id <> new.id) then
    return new;  -- not the first open of this link
  end if;
  select * into cr from public.confirmation_request where token = new.token;
  if found and cr.owner_id is not null then
    insert into public.notification_outbox (user_id, title, body, data)
    values (cr.owner_id, 'Opened',
            coalesce(cr.scope_title, 'Your extra') || ' was opened by ' || coalesce(cr.counterparty_label, 'the client') || '.',
            jsonb_build_object('changeOrderId', cr.change_order_id, 'kind', 'opened'));
  end if;
  return new;
end $$;
drop trigger if exists confirmation_open_notify on public.confirmation_open;
create trigger confirmation_open_notify after insert on public.confirmation_open
  for each row execute function public.notify_on_open();

-- Atomic claim for the worker — mirrors claim_job. RESERVES rows (marks sent_at +
-- attempts) under FOR UPDATE SKIP LOCKED so concurrent workers never send the same
-- notification twice (review 2026-07-25). Reserve-BEFORE-send: a failed send is
-- dropped rather than retried, because for a notification a rare miss beats a
-- duplicate. attempts caps the (now single) claim; a stuck row is left, not spun.
create or replace function public.claim_notifications(p_limit int default 20)
returns setof public.notification_outbox
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.notification_outbox n
     set sent_at = now(), attempts = n.attempts + 1
   where n.id in (
     select id from public.notification_outbox
      where sent_at is null and attempts < 5
      order by created_at
      limit p_limit
      for update skip locked)
  returning n.*;
end $$;
revoke all on function public.claim_notifications(int) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;
