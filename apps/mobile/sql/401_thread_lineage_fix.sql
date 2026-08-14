-- 401 — confirmation_thread has never returned a message on a priced change order.
--
-- FOUND 2026-08-10, by calling the RPC against production with a real token while
-- trying to hand hadar a link to test. It returns HTTP 404 with
--   42883: operator does not exist: text = bigint
-- and it has done so since 308 landed.
--
-- ─── THE BUG, IN ONE LINE ───────────────────────────────────────────────────────
--
--     where cr.change_order_id in (select id from public.change_order_lineage(co))
--                                        ^^
--
-- `change_order_lineage` is declared `returns setof text`. A set-returning function
-- with a scalar return type exposes ONE column, named after the function — there is
-- no column called `id` in that FROM item. So `id` does not fail to resolve: Postgres
-- looks OUTWARD and binds it to the enclosing query's table. The subquery silently
-- became a correlated reference to the outer row's own primary key.
--
-- Both halves of the union are wrong, and they are wrong in different ways, which is
-- why this survived:
--
--   * The QUESTION branch binds to `confirmation_question.id`, a BIGINT, and the
--     comparison `text = bigint` has no operator. The whole function raises. That is
--     the loud half.
--   * The REPLY branch binds to `confirmation_reply.id`, which is TEXT — so it
--     type-checks and runs, comparing a change order id to a reply id. Always false.
--     Zero rows, no error. That is the silent half, and it is the worse one.
--
-- ─── WHAT IT COST ───────────────────────────────────────────────────────────────
-- The client's page renders the discussion from this function. So on every PRICED
-- change order — the product's main object — a homeowner has never seen a single
-- word the contractor wrote back. Production holds 3 replies right now; a client has
-- seen none of them. `confirm.html` was hardened twice for the thread (the unhandled
-- rejection, the `[sS]` regex) while the data behind it was never arriving.
--
-- The `co is null` branch — a bare decision confirmation with no change order — has
-- no lineage walk and works correctly, which is why the feature ever appeared to work.
--
-- ─── THE FIX ────────────────────────────────────────────────────────────────────
-- Alias the function and select the alias, so the name can only resolve inside the
-- FROM item and an accidental outward binding is impossible. `select l from
-- change_order_lineage(co) l`. Nothing else about the function changes — including
-- 398's `media` key, which is carried forward verbatim so this does not quietly
-- revert message photos.
--
-- ─── THIS FILE REQUIRES 398 ─────────────────────────────────────────────────────
-- APPLY 398 FIRST. It was written to stand alone, guarding the `reply_media_json`
-- call behind a runtime `exists` test on pg_proc — and that DOES NOT WORK: plpgsql
-- resolves function names when the statement is first parsed, so a static reference
-- to a missing function raises 42883 no matter what branch guards it. Proven against
-- production in a rolled-back transaction, 2026-08-10. Dynamic SQL would route around
-- it and is not worth the loss of a parsed, checkable query for a dependency that is
-- landing in the same batch anyway.

create or replace function public.confirmation_thread(p_token text)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare co text;
        out jsonb;
begin
  select change_order_id into co
    from public.confirmation_request where token = p_token;
  if not found then return '[]'::jsonb; end if;

  if co is null then
    select coalesce(jsonb_agg(x order by x->>'at'), '[]'::jsonb) into out from (
      select jsonb_build_object('side','client','body',q.note,'at',q.asked_at,
                                'media','[]'::jsonb) as x
        from public.confirmation_question q where q.token = p_token
      union all
      select jsonb_build_object('side','contractor','body',r.body,'at',r.written_at,
                                'media', public.reply_media_json(r.id))
        from public.confirmation_reply r where r.token = p_token
    ) s;
    return out;
  end if;

  select coalesce(jsonb_agg(x order by x->>'at'), '[]'::jsonb) into out from (
    select jsonb_build_object('side','client','body',q.note,'at',q.asked_at,
                              'media','[]'::jsonb) as x
      from public.confirmation_question q
      join public.confirmation_request cr on cr.token = q.token
     -- ALIASED. `l` can only resolve inside this FROM item; the unaliased `id` bound
     -- outward to the enclosing table and that is the entire defect.
     where cr.change_order_id in (select l from public.change_order_lineage(co) l)
    union all
    select jsonb_build_object('side','contractor','body',r.body,'at',r.written_at,
                              'media', public.reply_media_json(r.id))
      from public.confirmation_reply r
      join public.confirmation_request cr2 on cr2.token = r.token
     where cr2.change_order_id in (select l from public.change_order_lineage(co) l)
  ) s;
  return out;
end $$;

revoke all on function public.confirmation_thread from public;
grant execute on function public.confirmation_thread to anon, authenticated;

-- ── stop the same accident happening again ──────────────────────────────────────
--
-- The root cause is a `setof <scalar>` function whose single column has an unguessable
-- name, so every call site invents one and Postgres resolves the invention outward.
-- Giving it a NAMED output column means `select id from change_order_lineage(x)`
-- resolves inside the FROM item from now on, aliased or not.
--
-- `create or replace` cannot change a function's result type, so the old one is
-- dropped first. Nothing else calls it by the scalar shape — verified against the
-- three call sites, all of which are `select … from change_order_lineage(...)`.
drop function if exists public.change_order_lineage(text);

create function public.change_order_lineage(p_change_order_id text)
  returns table (id text) language sql stable set search_path = public, pg_temp as $$
  with recursive chain(id, depth) as (
    select p_change_order_id, 0
    union
    -- `superseded_by` points FORWARD (old -> new), written by
    -- supersede_change_order_v1 in 307. Walking it in reverse gives the ancestors.
    select prior.id, c.depth + 1
      from public.change_order prior
      join chain c on prior.superseded_by = c.id
     where c.depth < 50
  )
  select id from chain;
$$;
