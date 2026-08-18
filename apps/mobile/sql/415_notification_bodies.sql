-- 415 — what the push actually SAYS.
--
-- Context: until 2026-08-18 no device had ever held a push token (no `aps-environment`
-- entitlement), so every notification 379 produced was queued, claimed, marked sent, and
-- delivered to nobody. The bodies had therefore never been read by a human. The moment
-- the first token registered, the backlog became visible and two of them were wrong.
--
-- ─── 1. THE VERDICT DOES NOT CARRY THE MONEY ────────────────────────────────────
-- "Fireplace facing restoration to early 1900s style was approved." — and how much?
--
-- The LOCAL notification for this same event already carries the figure, and `notify.ts`
-- explains why in its own words: mandate #6 guards numbers seen APART from their
-- instrument, and this one is REPORTING THAT THE INSTRUMENT CLOSED — a signature has just
-- bound the number, so it is the safest moment there is to state it.
--
-- So the two paths disagreed about the same event depending only on whether the app
-- happened to be open. The one that reaches a contractor who is NOT looking at his phone
-- was the one missing the fact he most wants.
--
-- NULL STAYS SILENT. `amount_cents` is nullable BY DESIGN — null means "no price was
-- stated", which is a different fact from free, and rendering it as $0.00 on a lock
-- screen would tell a contractor his approved work is worth nothing.
--
-- ─── 2. THE "OPENED" BODY CAN BE THE ENTIRE SCOPE OF WORK ───────────────────────
-- Live row, verbatim:
--
--     Opened | WHY THIS IS NEEDED⏎The owner wants the existing mo…
--
-- `confirmation_request.scope_title` is not always a title. On requests minted before 391
-- split title from body it holds the client-facing scope, which on a real record here
-- runs to fourteen hundred characters with newlines in it. Unbounded, that is a push
-- payload built from a document.
--
-- Truncation is COSMETIC and must stay that way: the record is the record, this is a
-- preview, and 80 characters is what a lock-screen line shows before it elides. 414
-- already does this for the client's question; this brings the other two into line.

-- A shared preview helper, so the three notification bodies cannot drift apart again.
-- IMMUTABLE + STRICT: it is a pure text function and null in means null out, which lets
-- the callers keep using coalesce for the "we do not know" case.
create or replace function public.notif_preview(p_text text, p_max int default 80)
  returns text language sql immutable strict as $$
  -- Newlines collapsed FIRST: a lock screen renders them, so a body with a line break
  -- becomes two short lines and hides the half that matters.
  select case
    when length(btrim(regexp_replace(p_text, '\s+', ' ', 'g'))) > p_max
      then left(btrim(regexp_replace(p_text, '\s+', ' ', 'g')), p_max) || '…'
    else btrim(regexp_replace(p_text, '\s+', ' ', 'g'))
  end
$$;

-- ── the verdict, now with the figure ────────────────────────────────────────────
create or replace function public.notify_on_verdict() returns trigger
language plpgsql security definer set search_path = public as $$
declare amount text;
begin
  if new.status in ('approved','declined') and new.status is distinct from old.status then
    -- Formatted here rather than in the worker: the worker sends whatever it is handed,
    -- and a figure assembled in transport is a figure nobody reviewed. FM strips the
    -- padding to_char would otherwise leave.
    amount := case
      when new.amount_cents is null then null
      else '$' || to_char(new.amount_cents / 100.0, 'FM999,999,990.00')
    end;

    insert into public.notification_outbox (user_id, title, body, data)
    values (
      new.owner_id,
      case when new.status = 'approved' then 'Approved ✓' else 'Declined' end,
      -- MONEY FIRST on an approval: it is the fact he wants, and a lock screen elides
      -- the END of a line. On a decline the amount leads with nothing to celebrate, so
      -- the scope leads instead and the figure is left to the record.
      case
        when new.status = 'approved' and amount is not null
          then amount || ' · ' || notif_preview(coalesce(new.scope, 'Your extra'), 70)
        when new.status = 'approved'
          then notif_preview(coalesce(new.scope, 'Your extra'), 80) || ' was approved.'
        else notif_preview(coalesce(new.scope, 'Your extra'), 80) || ' was declined.'
      end,
      jsonb_build_object('changeOrderId', new.id, 'kind', new.status));
  end if;
  return new;
end $$;

-- ── opened, now bounded ─────────────────────────────────────────────────────────
-- 379'S BODY, unchanged except for the preview call. Reproduced rather than rewritten:
-- the FIRST-OPEN-ONLY guard below is the whole reason this function is not spam (a client
-- reopening a link, or a preview bot fetching it, must not re-notify), and 408's header
-- records what happened the last time a function here was re-expressed from memory.
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
            notif_preview(coalesce(cr.scope_title, 'Your extra'), 70)
              || ' was opened by ' || coalesce(cr.counterparty_label, 'the client') || '.',
            jsonb_build_object('changeOrderId', cr.change_order_id, 'kind', 'opened'));
  end if;
  return new;
end $$;

-- The triggers themselves are unchanged and are NOT redefined here: `create or replace
-- function` swaps the body under the existing trigger, and dropping/recreating a trigger
-- for no reason is a window in which an approval lands unnotified.
