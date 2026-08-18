-- 414 — a client asked something. Tell the contractor.
--
-- hadar, 2026-08-18: "when a message is sent from the homeowner web page, if the app is
-- not opened and not active, the recipient should receive an app notification letting
-- them know that a message came in."
--
-- ─── THE ONE MISSING TRIGGER ────────────────────────────────────────────────────
-- 379 built the whole remote-push pipeline — `push_token`, `notification_outbox`,
-- `claim_notifications`, and a worker that posts to Expo — and wired exactly two events
-- to it: a VERDICT (approved/declined) and an OPEN (the client looked at the link). The
-- third thing a client can do is ASK, and nothing enqueued it.
--
-- So the case hadar describes is precisely the one with no coverage: a homeowner types a
-- question at 7pm, and the contractor learns about it whenever he next happens to open
-- the app. `notify.ts` states the boundary in its own header — a local notification needs
-- the app awake to fire — and this is the row that removes it for messages.
--
-- ─── WHY confirmation_question AND NOT confirmation_reply ───────────────────────
-- They are the two halves of one thread and it is easy to reach for the wrong one.
-- `confirmation_reply` (308) is the CONTRACTOR's half, written by the app; notifying him
-- of his own message would be absurd. `confirmation_question` (220) is the CLIENT's half,
-- written by the no-login page. This trigger belongs on the client's.
--
-- ─── THE MESSAGE ITSELF TRAVELS ────────────────────────────────────────────────
-- hadar asked for the notification to carry the message, not merely announce one. A
-- notification that says "you have a message" makes him open the app to learn whether it
-- was "thanks, go ahead" or "stop work" — which on a jobsite is the difference between
-- carrying on and downing tools. So the body IS the question, truncated to something a
-- lock screen will actually show.
--
-- TRUNCATION IS COSMETIC AND MUST STAY THAT WAY: the full text is in
-- `confirmation_question.note`, this is a preview, and the app's own thread is the record.
-- 140 characters because iOS shows roughly two lines on a lock screen and an ellipsis is
-- honest about there being more.
create or replace function public.notify_on_client_question() returns trigger
language plpgsql security definer set search_path = public as $$
declare cr public.confirmation_request;
begin
  select * into cr from public.confirmation_request where token = new.token;
  -- No request behind the token, or no owner to tell. Both are unreachable through the
  -- app's own paths (the token is a FK), and neither is worth failing an insert over: the
  -- client's question is EVIDENCE and must land whatever the notification layer thinks.
  if not found or cr.owner_id is null then
    return new;
  end if;

  insert into public.notification_outbox (user_id, title, body, data)
  values (
    cr.owner_id,
    -- WHO asked, on the title line, because that is what makes it worth unlocking the
    -- phone for. Falls back to a neutral noun rather than inventing a name.
    coalesce(nullif(btrim(cr.counterparty_label), ''), 'Your client') || ' asked',
    left(btrim(new.note), 140)
      || case when length(btrim(new.note)) > 140 then '…' else '' end,
    -- `kind` is what the tap handler routes on, and `changeOrderId` is where it lands.
    -- Same shape as the verdict and open events so the client has one parser, not three.
    jsonb_build_object(
      'changeOrderId', cr.change_order_id,
      'kind', 'question',
      'token', new.token)
  );
  return new;
end $$;

drop trigger if exists confirmation_question_notify on public.confirmation_question;
-- AFTER INSERT: the question is already durable before anything is queued about it. An
-- append-only evidence table must never have its write depend on a notification.
create trigger confirmation_question_notify after insert on public.confirmation_question
  for each row execute function public.notify_on_client_question();
