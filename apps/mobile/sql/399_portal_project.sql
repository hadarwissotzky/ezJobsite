-- 399 — the client portal's project view.
--
-- hadar, 2026-08-09, with the desktop portal design: the client's page grows a
-- sidebar listing every change order on the job — two awaiting approval, three
-- approved, with amounts — plus the running contract figures.
--
-- ─── THE SECURITY DECISION, STATED WHERE IT IS ENFORCED ─────────────────────────
--
-- Until now a token bought exactly one thing: the change order it was minted for.
-- That is a small blast radius by construction — a link forwarded to a neighbour, a
-- sub, or a group chat exposes one document.
--
-- The sidebar widens it to the whole project's money. hadar chose "project-wide,
-- LIVE TOKENS ONLY" (2026-08-09) and this function is where that choice lives:
--
--   * The DOCUMENT still opens from any token, forever. A client who approved in
--     July must be able to re-open what they signed — that is REQ-LC30 and it does
--     not change here.
--   * The PROJECT VIEW opens only from a token that is still live: not superseded,
--     and not yet answered. So a retired link from a replaced version, and a link
--     whose approval is already given, keep showing their own document and lose the
--     sidebar. An old link forwarded on does not become a permanent window onto the
--     job's contract total.
--
-- The refusal is an EMPTY RESULT, not an exception: the page renders the document
-- without a sidebar, which is a legitimate state, not an error to show a homeowner.
--
-- ─── what it deliberately does NOT return ───────────────────────────────────────
-- The ORIGINAL CONTRACT AMOUNT, and therefore the "new contract total" that derives
-- from it. The design's summary table opens with $74,000.00 and this product does
-- not know that number — nothing in the schema holds a base contract value. It is
-- not guessed and not summed-into-existence from change orders. The page omits the
-- rows it cannot prove rather than printing a total that would be wrong on a
-- document someone signs (mandate #6, and the reason `amount_cents` is nullable).

-- ── FIRST: the column this file reads does not exist on the server ──────────────
--
-- FOUND BY TESTING, NOT BY READING (2026-08-10). `co_number` is written and
-- backfilled on the DEVICE (changeorder.ts) and was never part of the server's
-- change_order. Both functions below select it, and because plpgsql does not resolve
-- names until first execution, this migration would have APPLIED CLEANLY and then
-- failed at runtime on a homeowner's phone — the portal's sidebar and its identity
-- line dying with an undefined-column error on a page whose whole job is trust.
--
-- Added here as a nullable column so the reads are valid.
--
-- IT WILL BE NULL FOR NOW, AND THAT IS HANDLED, NOT HIDDEN: nothing uploads it yet —
-- `ingest_change_order_v1` has no parameter for it — so every row reads NULL and the
-- page omits the number entirely. That is already the designed behaviour ("a made-up
-- number on an instrument's identity line is worse than a short line"). WIRING THE
-- DEVICE TO SEND IT IS OWED, and until it lands the client's page says "CHANGE ORDER"
-- where the design says "CHANGE ORDER #4".
alter table public.change_order add column if not exists co_number integer;

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
  -- Unknown token, or a decision confirmation with no change order behind it. Both
  -- are "no project view", and neither is an error worth a stack trace on a
  -- homeowner's phone.
  if co_id is null then return '{}'::jsonb; end if;

  -- LIVE = not replaced by a revision, and not already answered. Both halves matter:
  -- the first stops a superseded link, the second stops a link whose job is done.
  select cr.superseded_at is null
         and not exists (select 1 from public.confirmation_response x where x.token = cr.token)
    into live
    from public.confirmation_request cr
   where cr.token = p_token;

  if not coalesce(live, false) then return '{}'::jsonb; end if;

  select c.project_id into proj from public.change_order c where c.id = co_id;
  if proj is null then return '{}'::jsonb; end if;

  select jsonb_build_object(
    'project_id', proj,
    'project_name', p.name,
    'project_address', p.address,
    -- Every change order on the job that has actually LEFT the contractor's phone.
    -- Drafts are excluded: a draft is a private working document and a client must
    -- never learn one exists, let alone what it might cost.
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'co_number', c.co_number,
               'title', c.scope,
               'amount_cents', c.amount_cents,
               'status', c.status,
               'issued_at', c.created_at,
               -- The token for THIS row, when one is live — so the sidebar can link
               -- between change orders without the page ever guessing a URL. Null
               -- when there is no live link (already answered, or superseded), and
               -- the row then renders as text rather than as a dead link.
               'token', (
                 select cr2.token from public.confirmation_request cr2
                  where cr2.change_order_id = c.id
                    and cr2.superseded_at is null
                    and not exists (select 1 from public.confirmation_response x2
                                     where x2.token = cr2.token)
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
         -- A superseded version is not a change order the client has to think about;
         -- its replacement is in the list and carries the same number.
         and c.superseded_by is null
    ), '[]'::jsonb),
    -- The only contract figure this product can prove: what has actually been
    -- approved. Everything else the design's table wants is derived from an original
    -- contract amount we do not hold — see the header.
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

-- ── the document header's missing facts ──────────────────────────────────────────
--
-- `co_number`, the issue date and who requested it are all ON the row already and
-- were simply never returned. The design puts them in the document's identity block
-- ("CHANGE ORDER #4 · Issued: Aug 9, 2026 · Requested by: John Davis"), which is
-- exactly where a paper change order carries them.
--
-- NOTE ON `requested_by`: it reads `change_order.who_directed`, which is seeded with
-- the literal role word "Owner" when an extra is born from a capture and nobody has
-- been named (startextra.ts). The device now treats that seed as "no owner named"
-- and so does this: the field comes back NULL rather than printing "Requested by:
-- Owner" on a document a homeowner is signing.
create or replace function public.confirmation_header_v1(p_token text)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare out jsonb;
begin
  select jsonb_build_object(
    'co_number', c.co_number,
    'issued_at', cr.created_at,
    'requested_by', nullif(btrim(coalesce(c.who_directed, '')), 'Owner'),
    'schedule_effect', c.schedule_effect,
    'schedule_days', c.schedule_days
  ) into out
    from public.confirmation_request cr
    join public.change_order c on c.id = cr.change_order_id
   where cr.token = p_token;
  return coalesce(out, '{}'::jsonb);
end $$;

revoke all on function public.confirmation_header_v1 from public;
grant execute on function public.confirmation_header_v1 to anon, authenticated;
