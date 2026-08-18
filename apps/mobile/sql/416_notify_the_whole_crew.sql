-- 416 — notify everyone who can see the job, not only whoever created the extra.
--
-- hadar, 2026-08-18, on being shown that "affiliated" and "notified" were different sets:
-- widen it to everyone on the project.
--
-- ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────────
-- Every trigger from 379 and 414 wrote ONE outbox row, addressed to `owner_id` — the
-- user who created the change order. Meanwhile `co_company_read` lets every active member
-- of the owning company READ that change order:
--
--     using (is_project_visible(project_id))
--       -> active company_member of the company that owns the project
--
-- So a crew of three all saw the extra in the app, and exactly one of them was told when
-- the client approved it, declined it, opened the link, or asked a question. If the field
-- lead captures an extra and the office sends it, only one of them ever hears back — on
-- a product whose stated purpose is "protect contractors and subcontractors from
-- miscommunication by keeping all parties aligned" (CLAUDE.md §1).
--
-- It also removed an inconsistency inside the app: the local notification and the in-app
-- banner are driven by locally SYNCED rows, so a member already saw those. The same event
-- reached a different audience depending only on whether the app happened to be open.
--
-- ─── THE RECIPIENT SET IS DERIVED FROM THE SAME PREDICATE AS VISIBILITY ─────────
-- Deliberately, and it is the one thing that must not drift: notifying someone who cannot
-- open what they were notified about is worse than not notifying them. `is_project_visible`
-- is SQL over `company_member`, but it tests `auth.uid()` and there is no auth context
-- inside a trigger — so this reproduces its BODY over a given user rather than calling it,
-- and the two must be changed together. Any future widening of visibility belongs here in
-- the same commit.
--
-- The OWNER is unioned in unconditionally. Projects created before company membership
-- existed carry `company_id IS NULL`, and their creator reaches them through `co_own`
-- rather than through the company join; dropping him would silently stop notifying the
-- solo operator this product is explicitly built for.
create or replace function public.notif_recipients(p_project_id text, p_owner uuid)
  returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct u from (
    -- The creator. Always, including the solo operator whose project has no company.
    select p_owner as u where p_owner is not null
    union
    -- Everyone who can currently SEE the job. `status = 'active'` matters: a retired
    -- member keeps history but stops receiving, which is the same rule the roster uses.
    select m.user_id
      from public.project p
      join public.company_member m on m.company_id = p.company_id
     where p.id = p_project_id and m.status = 'active'
  ) s where u is not null
$$;

-- ── verdict → the whole crew ────────────────────────────────────────────────────
-- 415's body, fanned out. The `amount` block is unchanged; only the INSERT became a
-- SELECT over the recipient set, one row per person (the worker resolves a person to
-- their devices, so a user with two handsets is still one row here).
create or replace function public.notify_on_verdict() returns trigger
language plpgsql security definer set search_path = public as $$
declare amount text;
begin
  if new.status in ('approved','declined') and new.status is distinct from old.status then
    amount := case
      when new.amount_cents is null then null
      else '$' || to_char(new.amount_cents / 100.0, 'FM999,999,990.00')
    end;

    insert into public.notification_outbox (user_id, title, body, data)
    select r,
      case when new.status = 'approved' then 'Approved ✓' else 'Declined' end,
      case
        when new.status = 'approved' and amount is not null
          then amount || ' · ' || notif_preview(coalesce(new.scope, 'Your extra'), 70)
        when new.status = 'approved'
          then notif_preview(coalesce(new.scope, 'Your extra'), 80) || ' was approved.'
        else notif_preview(coalesce(new.scope, 'Your extra'), 80) || ' was declined.'
      end,
      jsonb_build_object('changeOrderId', new.id, 'kind', new.status)
    from public.notif_recipients(new.project_id, new.owner_id) r;
  end if;
  return new;
end $$;

-- ── opened → the whole crew ─────────────────────────────────────────────────────
create or replace function public.notify_on_open() returns trigger
language plpgsql security definer set search_path = public as $$
declare cr public.confirmation_request;
begin
  -- FIRST OPEN ONLY. Unchanged and load-bearing: a client reopening the link across
  -- sessions, or a link-preview bot fetching it, must not re-notify. Widening the
  -- audience multiplies whatever this guard fails to catch, so it matters more now.
  if exists (select 1 from public.confirmation_open o
              where o.token = new.token and o.id <> new.id) then
    return new;
  end if;
  select * into cr from public.confirmation_request where token = new.token;
  if found and cr.owner_id is not null then
    insert into public.notification_outbox (user_id, title, body, data)
    select r, 'Opened',
           notif_preview(coalesce(cr.scope_title, 'Your extra'), 70)
             || ' was opened by ' || coalesce(cr.counterparty_label, 'the client') || '.',
           jsonb_build_object('changeOrderId', cr.change_order_id, 'kind', 'opened')
    from public.notif_recipients(cr.project_id, cr.owner_id) r;
  end if;
  return new;
end $$;

-- ── the client asked → the whole crew ───────────────────────────────────────────
-- 414's body, fanned out. A question is the case that most needs more than one reader:
-- it is the only one of the three where somebody has to DO something, and routing it to
-- one person is how it waits three days for the one man who is on a roof.
create or replace function public.notify_on_client_question() returns trigger
language plpgsql security definer set search_path = public as $$
declare cr public.confirmation_request;
begin
  select * into cr from public.confirmation_request where token = new.token;
  if not found or cr.owner_id is null then
    return new;
  end if;

  insert into public.notification_outbox (user_id, title, body, data)
  select r,
    coalesce(nullif(btrim(cr.counterparty_label), ''), 'Your client') || ' asked',
    notif_preview(new.note, 140),
    jsonb_build_object(
      'changeOrderId', cr.change_order_id,
      'kind', 'question',
      'token', new.token)
  from public.notif_recipients(cr.project_id, cr.owner_id) r;
  return new;
end $$;

-- The triggers are unchanged and deliberately not re-created: `create or replace
-- function` swaps each body underneath its existing trigger, and dropping a trigger to
-- recreate it opens a window in which a real approval lands unnotified.
