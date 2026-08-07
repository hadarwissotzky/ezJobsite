-- 395_client_portal_loop.sql
--
-- THE CLIENT ACTS IN THE PORTAL AND THE CONTRACTOR IS TOLD. Two triggers, both of
-- them filling a hole that was invisible because the surrounding feature looked
-- finished.
--
-- ── WHAT WAS ACTUALLY MISSING ───────────────────────────────────────────────
-- `notify_on_open` (366) raises a push when a client OPENS an approval link.
-- `notify_on_verdict` (379) raises one when a change order reaches approved or
-- declined. Between those two sits the thing the portal exists for -- the client
-- ASKING SOMETHING -- and nothing anywhere raised a notification for it. Checked,
-- not assumed: before this file, `confirmation_question` carried exactly two
-- triggers, `confirmation_question_live_only` and `confirmation_question_no_update`,
-- and neither writes to `notification_outbox`.
--
-- So the loop that shipped was: the client is told "you can approve once they
-- reply", and the contractor is told nothing at all. The question reaches him only
-- when he happens to open the app on that project and the sync tick calls
-- `pullThreads` -> `runNotifications` (notifystore.ts). A homeowner standing in a
-- doorway who asks "does that price include the permit?" at 4pm on a Friday is
-- waiting on a man whose phone never buzzed. R5b AC5's 48h "Awaiting your reply"
-- flag then fires against him for a message he was never shown.
--
-- The same hole, second shape: a PLAIN DECISION confirmation (`change_order_id`
-- null -- a spec confirmed with no money attached, R10) that is approved or declined
-- notifies nobody either, because `notify_on_verdict` is a trigger on
-- `change_order` and there is no change order to move.
--
-- ── ON DUPLICATION WITH THE LOCAL NOTIFICATION, STATED RATHER THAN HIDDEN ───
-- `notifystore.runNotifications` already raises a LOCAL notification for a pulled
-- question, and this trigger will raise a PUSH for the same question. They can both
-- fire. That is the trade this repo already made for approvals -- `notify_on_verdict`
-- (push) and `pendingApprovals` (local) both announce an approval, and
-- notifystore.ts's own header says announcing twice is the acceptable direction of
-- error: "A notification shown twice is a nuisance; one never shown is mandate #1."
-- The push is the one that works with the app closed, which is every case that
-- matters here. If de-duplication is ever wanted, the honest place for it is the
-- device (it holds `notified_at_ms` already), not a suppressed server row.
--
-- ── WHAT THIS FILE DOES NOT DO ──────────────────────────────────────────────
-- It does not text the CLIENT when the contractor replies. That direction needs a
-- destination on `confirmation_request`, and today every send passes
-- `channel:'link'` with `destination` NULL (verified against the live table), so the
-- server holds no way to reach the counterparty at all. That is a call-site gap in
-- the app, not a schema gap -- `sendForConfirmation` already accepts `destination`
-- and `confirmation_create` already stores it. See docs/CLIENT-PORTAL.md §"Owed".
--
-- OWNERSHIP: both functions and both triggers are created only here
-- (scripts/check-sql-duplicates.mjs).

-- ── the client asked something ──────────────────────────────────────────────
--
-- SECURITY DEFINER for the same reason `notify_on_open` is: the insert arrives from
-- `confirmation_ask`, which anon may call, and `notification_outbox` is not a table
-- anon may write. The trigger runs as the function owner so the notification is
-- raised by the database, not by the caller.
create or replace function public.notify_on_question()
returns trigger language plpgsql security definer set search_path = public as $$
declare cr public.confirmation_request;
begin
  select * into cr from public.confirmation_request where token = new.token;
  if not found or cr.owner_id is null then return new; end if;

  -- EVERY question, not only the first -- deliberately unlike `notify_on_open`,
  -- which fires once per link. An open is a repeatable non-event; a question is an
  -- obligation, and the second one ("and what about the tile?") is a second thing
  -- owed. Suppressing it would recreate the silence this file exists to remove.
  insert into public.notification_outbox (user_id, title, body, data)
  values (
    cr.owner_id,
    'Question',
    -- The client's OWN WORDS in the body, truncated the way discussion.ts truncates
    -- them, because a question rendered as "the client has a question" tells the
    -- contractor nothing he can act on from a lock screen. The PRICE is deliberately
    -- absent (discussion.ts:notificationFor states why: mandate #6 treats a figure
    -- read out of its frozen context as a hazard); the scope names which extra.
    coalesce(cr.counterparty_label, 'The client') || ' asked about '
      || coalesce(cr.scope_title, 'your extra') || ': '
      || case when length(new.note) > 140
              then left(new.note, 139) || '…' else new.note end,
    jsonb_build_object(
      'changeOrderId', cr.change_order_id,
      'token', new.token,
      'kind', 'question')
  );
  return new;
end $$;

drop trigger if exists confirmation_question_notify on public.confirmation_question;
create trigger confirmation_question_notify
  after insert on public.confirmation_question
  for each row execute function public.notify_on_question();

-- ── a decision confirmation was answered, and no change order carries it ────
--
-- GUARDED ON `change_order_id IS NULL` so this never double-announces the priced
-- path. There, `confirmation_response_settles_co` (230) moves the change order and
-- `notify_on_verdict` (379) announces the move -- with the extra's own scope and the
-- right verb. Firing here as well would put two rows in the outbox for one answer,
-- and the contractor would be told twice about a thing that happened once.
--
-- What is left is exactly the uncovered case: a confirm/acknowledge with no money
-- and no change order. Nothing downstream of it moves a status, so without this the
-- client's yes-or-no lands in the database and stops there.
create or replace function public.notify_on_unlinked_answer()
returns trigger language plpgsql security definer set search_path = public as $$
declare cr public.confirmation_request;
begin
  select * into cr from public.confirmation_request where token = new.token;
  if not found or cr.owner_id is null or cr.change_order_id is not null then
    return new;
  end if;

  insert into public.notification_outbox (user_id, title, body, data)
  values (
    cr.owner_id,
    case when new.action = 'confirmed' then 'Confirmed ✓' else 'Not confirmed' end,
    coalesce(cr.counterparty_label, 'The client')
      || case when new.action = 'confirmed' then ' confirmed ' else ' did not confirm ' end
      || coalesce(cr.scope_title, 'what you sent')
      -- The signed name is the identity SIGNAL the portal collected. Named here
      -- rather than implied, because "confirmed" without a who is the claim, and the
      -- typed name is the evidence for it (REQ-LC45: grade 'typed_link').
      || case when new.signed_name is not null then ' — signed ' || new.signed_name
              else '' end
      || '.',
    jsonb_build_object(
      'changeOrderId', null,
      'token', new.token,
      'kind', case when new.action = 'confirmed' then 'confirmed' else 'declined' end)
  );
  return new;
end $$;

drop trigger if exists confirmation_response_notify on public.confirmation_response;
create trigger confirmation_response_notify
  after insert on public.confirmation_response
  for each row execute function public.notify_on_unlinked_answer();
