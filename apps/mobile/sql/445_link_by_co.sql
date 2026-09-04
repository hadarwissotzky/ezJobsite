-- 445 — read a live client link back by change_order_id (device-local recovery)
--
-- hadar, 2026-09-04: "why there is no link make for this CO?" — a SENT change order,
-- synced and showing "Waiting on Hadar", but "No link yet" under THE LINK YOU SENT.
--
-- ─── THE GAP ────────────────────────────────────────────────────────────────────
-- The link's URL lives ONLY in `co_live_link`, a DEVICE-LOCAL table written by
-- `noteLinkSent` on the phone that did the send. It is not synced (deliberately — it
-- is device bookkeeping, and the confirmation_request row is the server's copy). So a
-- change order's STATUS reaches every device through PowerSync/hydrate, but its URL
-- does not: a second phone, a reinstall, or a device whose local state was reset (the
-- sync wedge this week) shows the CO as sent and the link as absent. The link is live
-- the whole time — the client can open it — the sender just cannot see or copy it.
--
-- ─── THE FIX ────────────────────────────────────────────────────────────────────
-- A read-back keyed on change_order_id, owner-scoped. It returns the token of the ONE
-- live confirmation for that CO — not expired, not cancelled — so the client can
-- reconstruct the URL and backfill its own co_live_link. It reveals nothing new: the
-- caller already owns the change order, and the token only unlocks a page for a
-- document that is theirs.

create or replace function public.confirmation_link_for_co(p_change_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.confirmation_request%rowtype;
begin
  -- OWNER-ONLY. The confirmation carries owner_id (set to auth.uid() at create); a
  -- caller may read back only a link on their own change order. No cross-account read.
  select * into r
    from public.confirmation_request
   where change_order_id = p_change_order_id
     and owner_id = auth.uid()
     and cancelled_at is null
     and now() <= expires_at
   order by created_at desc
   limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'token', r.token,
    'sent_at', r.created_at,
    -- 443's language, so a backfilled link still reminds/withdraws in the right one.
    'lang', coalesce(r.lang, 'en'));
end $$;

revoke all on function public.confirmation_link_for_co(text) from public, anon;
grant execute on function public.confirmation_link_for_co(text) to authenticated;
