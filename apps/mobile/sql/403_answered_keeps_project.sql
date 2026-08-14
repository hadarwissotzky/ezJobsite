-- 403 — an answered link keeps its project view.
--
-- hadar, 2026-08-10, looking at an approved change order: "an approved change order
-- looks like this -- just read only and with a sign approved -- it is not different."
--
-- 399 gated `confirmation_project_v1` on a LIVE token: not superseded AND not yet
-- answered. That second half was too wide, and this is the correction.
--
-- ─── WHY ANSWERED IS DIFFERENT FROM SUPERSEDED ──────────────────────────────────
--
-- The risk 399 was written against is a RETIRED link — one replaced by a revision,
-- still sitting in someone's messages, quietly becoming a permanent window onto a
-- job's contract total. That risk is real and this change does not touch it:
-- `superseded_at is null` still gates the project view.
--
-- An ANSWERED link is a different object. It is the link the client actually used.
-- They opened it, read it, typed their name onto it and signed. Taking their portal
-- away at the moment they sign punishes the one act the product exists to get, and
-- it makes the record LESS checkable to the person with the most at stake — the
-- opposite of REQ-LC30's "either party opening the record later sees the identical
-- immutable snapshot".
--
-- Nothing about the sidebar is more sensitive after an approval than before it. The
-- same client, holding the same link, sees the same list they were already entitled
-- to see five seconds earlier.
--
-- ─── what this does NOT open up ─────────────────────────────────────────────────
-- Superseded links: still refused. Unknown tokens: still refused. Decision
-- confirmations with no change order: still refused. And the project view remains
-- read-only — it has never carried an action.
create or replace function public.confirmation_project_v1(p_token text)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare co_id  text;
        proj   text;
        live   boolean;
        out    jsonb;
begin
  select cr.change_order_id into co_id
    from public.confirmation_request cr
   where cr.token = p_token;
  if co_id is null then return '{}'::jsonb; end if;

  -- NOT SUPERSEDED. The answered test that used to be here is gone — see the header.
  select cr.superseded_at is null into live
    from public.confirmation_request cr
   where cr.token = p_token;

  if not coalesce(live, false) then return '{}'::jsonb; end if;

  select c.project_id into proj from public.change_order c where c.id = co_id;
  if proj is null then return '{}'::jsonb; end if;

  select jsonb_build_object(
    'project_id', proj,
    'project_name', p.name,
    'project_address', p.address,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'co_number', c.co_number,
               'title', c.scope,
               'amount_cents', c.amount_cents,
               'status', c.status,
               'issued_at', c.created_at,
               'token', (
                 select cr2.token from public.confirmation_request cr2
                  where cr2.change_order_id = c.id
                    and cr2.superseded_at is null
                  order by cr2.created_at desc limit 1
               ),
               'answered_action', (
                 select x3.action from public.confirmation_response x3
                   join public.confirmation_request cr3 on cr3.token = x3.token
                  where cr3.change_order_id = c.id
                  order by x3.responded_at desc limit 1
               ),
               'answered_at', (
                 select x4.responded_at from public.confirmation_response x4
                   join public.confirmation_request cr4 on cr4.token = x4.token
                  where cr4.change_order_id = c.id
                  order by x4.responded_at desc limit 1
               )
             ) order by c.co_number nulls last, c.created_at)
        from public.change_order c
       where c.project_id = proj
         and c.status <> 'draft'
         and c.superseded_by is null
    ), '[]'::jsonb),
    'approved_total_cents', coalesce((
      select sum(c.amount_cents) from public.change_order c
       where c.project_id = proj and c.status = 'approved'
    ), 0)
  ) into out
  from public.project p where p.id = proj;

  return coalesce(out, '{}'::jsonb);
end $$;

revoke all on function public.confirmation_project_v1 from public;
grant execute on function public.confirmation_project_v1 to anon, authenticated;
