-- 371: discard CAPTURES server-side — the bytes in the bucket.
--
-- WHY. hadar's delete spec: "once it is deleted all of the items (recordings,
-- and images) are being deleted with it -- it is this simple." 369 covers a
-- deleted EXTRA, but a capture deleted before any extra was sent — his exact
-- case: a walkthrough discarded from the gallery — left its media orphaned in
-- the storage bucket forever. Three of his own deleted files sit there now.
-- Local delete without cloud delete is "deleted from this phone", which is a
-- claim the UI already refuses to make; this makes the honest claim the strong
-- one instead.
--
-- SAME SHAPE AS 369, for the same forced reasons: the capture ROW stays
-- (transcripts are append-only, five side-tables carry no cascade), the STORAGE
-- OBJECT goes, and the act lands in the same capture_discarded ledger 369 owns.
--
-- WHAT IT REFUSES — each one is potentially somebody else's evidence:
--   * a capture the caller does not own;
--   * a capture behind ANY decision that ever had a confirmation_request sent.
--     "Ever sent" again, not "sent now": a superseded request still went out
--     and was still read. Refusal is PER CAPTURE and silent-per-row (skipped,
--     counted) rather than aborting the batch: one protected capture must not
--     keep two hundred deletable ones in the bucket.
--
-- OWNERSHIP: only discard_captures_own is created here (check-sql-duplicates);
-- the capture_discarded table belongs to 369.

create or replace function public.discard_captures_own(p_capture_ids text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r         record;
  n_gone    int := 0;
  n_kept    int := 0;
  n_missing int := 0;
begin
  if p_capture_ids is null or array_length(p_capture_ids, 1) is null then
    return jsonb_build_object('discarded', 0, 'kept', 0, 'missing', 0);
  end if;

  for r in
    select c.id, c.owner_id, c.payload as object_key
      from unnest(p_capture_ids) as want(id)
      left join public.capture c on c.id = want.id
  loop
    if r.owner_id is null then
      -- Never uploaded, or already purged. Not an error: the client drains
      -- every local tombstone and some never reached the server at all.
      n_missing := n_missing + 1;
      continue;
    end if;
    if r.owner_id is distinct from auth.uid() then
      -- Somebody else's capture in the batch is refused quietly but COUNTED,
      -- so a compromised client cannot use the drain as a probe for which ids
      -- exist — and the caller still sees the batch did not fully land.
      n_kept := n_kept + 1;
      continue;
    end if;
    if exists (
      select 1
        from public.decision_version dv
        join public.confirmation_request cr on cr.decision_id = dv.decision_id
       where dv.capture_id = r.id
    ) then
      n_kept := n_kept + 1;
      continue;
    end if;

    insert into public.capture_discarded (capture_id, change_order_id, owner_id)
      values (r.id, 'capture', r.owner_id)
      on conflict (capture_id) do nothing;

    -- The bytes. Guarded like 369: a database without the storage extension (a
    -- test harness) must still run this function; the tombstone above records
    -- the intent either way.
    if to_regclass('storage.objects') is not null then
      execute 'delete from storage.objects where bucket_id = $1 and name = $2'
        using 'captures', r.object_key;
    end if;
    n_gone := n_gone + 1;
  end loop;

  return jsonb_build_object('discarded', n_gone, 'kept', n_kept, 'missing', n_missing);
end $$;

revoke all on function public.discard_captures_own from public, anon;
grant execute on function public.discard_captures_own to authenticated;
