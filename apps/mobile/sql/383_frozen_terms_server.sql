-- 383_frozen_terms_server.sql
--
-- THE SERVER NOW FREEZES THE SAME SEVEN COLUMNS THE PHONE DOES. DEF-3 / REQ-LC42.
--
-- The device's `change_order_frozen` trigger (`changeorder.ts:148-160`) refuses a
-- post-send change to SEVEN columns: amount_cents, scope, nte_cents, billing_timing,
-- schedule_effect, schedule_days, exclusions. The Postgres trigger of the same name
-- (`030_change_order.sql:106-117`) refused THREE. So a sent extra's payment timing,
-- schedule impact and exclusions were mutable server-side by any path that reaches
-- Postgres -- the owner's `co_own` RLS policy is `for all`, so a plain PostgREST
-- update did it.
--
-- WHY THAT IS NOT A COSMETIC GAP. Since commit `1744c17` those four fields are
-- rendered into `shown_content` as owner-facing sentences ("Schedule: adds 3 days.",
-- "Payment is due when the work is completed.") -- REQ-LC41, verified built. The
-- frozen text is the binding instrument (mandate #5). Leaving the columns mutable
-- means the record the contractor reads can silently stop matching the document the
-- owner signed, and the divergence is invisible on both screens: the instrument
-- still says "adds 3 days" and the app says "no change". Being on one side of the
-- wire must never lower the bar -- 375's own header says the CHECKs mirror the
-- device's "so being offline never lowers the bar", and this is the same claim about
-- the freeze that 375 never actually delivered (its phase 2).
--
-- ── OWNERSHIP: THIS FILE NOW OWNS change_order_guard AND change_order_frozen ──
-- `030_change_order.sql` no longer defines either; it carries a pointer comment
-- explaining the move, exactly as 020 does for `confirmation_request_guard` and as
-- 030 itself does for `approval_signature_binding`. This is not tidiness. A
-- `create or replace function` in two files is a replace, not a merge, so re-running
-- 030 after this file would silently restore the three-column guard and the four
-- terms would become mutable again with nothing failing anywhere -- the exact
-- regression `020_confirmations.sql:60-97` was written to record. One object, one
-- file.
--
-- ── WHAT THIS DELIBERATELY DOES NOT CHANGE, and it is a real gap ─────────────
-- The status list stays `('sent','approved','declined')`, identical to the device's.
-- `superseded` is NOT in it on either side, so a retired version's price and scope
-- are still editable after supersession -- on both sides, equally. That is a genuine
-- defect against REQ-LC2 ("a frozen historical version") and it is left alone here
-- ON PURPOSE: REQ-LC42's requirement is that the two guards are IDENTICAL, and
-- closing the hole on the server only would re-create the asymmetry this file exists
-- to remove. It must be closed on the device and here in one change. Named, not
-- hidden.
--
-- OWNERSHIP: every object below is created only here (check-sql-duplicates).

-- Column list and status list both mirror `changeorder.ts:148-160` exactly. If one
-- side gains a term, both do, in the same change.
create or replace function public.change_order_guard() returns trigger
  language plpgsql as $$ begin
    if old.status in ('sent','approved','declined')
       and (new.amount_cents    is distinct from old.amount_cents
            or new.scope            is distinct from old.scope
            or new.nte_cents        is distinct from old.nte_cents
            -- The four flow fields. Terms of the deal since they entered
            -- shown_content (REQ-LC41), and frozen from the same instant as the
            -- price for the same reason.
            or new.billing_timing   is distinct from old.billing_timing
            or new.schedule_effect  is distinct from old.schedule_effect
            or new.schedule_days    is distinct from old.schedule_days
            or new.exclusions       is distinct from old.exclusions) then
      -- Message and errcode unchanged from 030's version on purpose: this file
      -- widens WHAT is frozen, and nothing else. A caller that recognises the
      -- refusal today still recognises it.
      raise exception 'a sent change order is frozen: supersede it with a new one';
    end if;
    return new;
  end $$;

drop trigger if exists change_order_frozen on public.change_order;
create trigger change_order_frozen before update on public.change_order
  for each row execute function public.change_order_guard();
