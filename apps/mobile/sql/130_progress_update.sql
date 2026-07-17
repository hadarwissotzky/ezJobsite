-- Client progress update — REP-2.
--
-- THE DISPUTE BUNDLE'S OPPOSITE, and that is the whole design.
--
-- The bundle is written for a fight: complete, hedged, every superseded value
-- shown, six limitations at the top. Send that to a homeowner on a Friday and you
-- have told her you are preparing to sue her.
--
-- This is for the Friday. Same data, different audience, different job:
--   * what CHANGED on your job this week
--   * what it COST, and what you have approved so far
--   * what is WAITING on you
-- Short, warm, no hedging, no hashes, no history of what it used to be. A client
-- does not want an audit trail; she wants to know if the kitchen is on budget.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--  * no superseded values -- "it was white, then off-white, then grey" is the
--    evidence chain, and showing it here reads as an accusation of indecision.
--  * no unowned-boundary list -- that is an internal question, not a client's.
--  * no content hashes, no GPS, no corroboration. That is armour for a dispute.
-- If it ever comes to that, the bundle exists and says all of it.

create or replace function public.progress_update(p_project_id text, p_since_days int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; owner uuid; since timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select p.owner_id into owner from public.project p where p.id = p_project_id;
  if not found or owner is distinct from auth.uid() then
    raise exception 'not your project' using errcode = '42501';
  end if;
  since := now() - make_interval(days => greatest(p_since_days, 1));

  select jsonb_build_object(
    'project', (select name from public.project where id = p_project_id),
    'since', since,
    'generated_at', now(),

    -- What changed. CURRENT VALUE ONLY -- the chain is evidence, not news.
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject', d.subject,
        'now', (select v.value from public.decision_version v
                 where v.decision_id = d.id order by v.created_at_ms desc limit 1),
        'when', (select to_timestamp(max(v.created_at_ms)/1000.0)
                   from public.decision_version v where v.decision_id = d.id))
        order by d.created_at_ms desc)
      from public.decision d
      where d.project_id = p_project_id
        and exists (select 1 from public.decision_version v
                     where v.decision_id = d.id
                       and to_timestamp(v.created_at_ms/1000.0) >= since)), '[]'::jsonb),

    -- The money, in the only three numbers a client actually asks about.
    'approved_total', public.money_str(coalesce((
      select sum(amount_cents)::bigint from public.change_order
       where project_id = p_project_id and status = 'approved'), 0)),
    'waiting_on_you', coalesce((
      select jsonb_agg(jsonb_build_object(
        'what', co.scope, 'amount', public.money_str(co.amount_cents, co.currency))
        order by co.created_at)
      from public.change_order co
      where co.project_id = p_project_id and co.status in ('draft','sent')), '[]'::jsonb),
    'approved_recently', coalesce((
      select jsonb_agg(jsonb_build_object(
        'what', co.scope, 'amount', public.money_str(co.amount_cents, co.currency),
        'when', co.created_at) order by co.created_at desc)
      from public.change_order co
      where co.project_id = p_project_id and co.status = 'approved'
        and co.created_at >= since), '[]'::jsonb),

    -- Photos. A count, not the files: this is a message, not an album, and a
    -- client on a phone does not want 40 attachments.
    'photos_taken', (select count(*) from public.capture
                      where project_id = p_project_id and modality = 'photo'
                        and client_created_at >= since)
  ) into result;
  return result;
end $$;

revoke all on function public.progress_update from public, anon;
grant execute on function public.progress_update to authenticated;
