-- 427 — the office may act on the crew's records.
--
-- WHY THIS EXISTS (hadar, 2026-08-26, the web console). 376 chose company-wide READ
-- with owner-scoped WRITES, and said so in its own header: "a member reads a
-- teammate's extra, never rewrites it." That is the right rule between two people
-- holding phones. It is the wrong rule for the desk.
--
-- The console being built is a MANAGER looking at what the crew captured — pricing a
-- draft that came in from a jobsite, fixing the wording a client will read, answering
-- the question the client asked. Under 376 none of that is possible: Ray can see
-- Miguel's change order and cannot touch it, and `ingest_r5b_v1` refuses his reply
-- outright with "not your change order" (308:267). The record sits there, visible and
-- inert, while the client waits on an answer nobody with a desk is allowed to give.
--
-- ─── WHAT THIS WIDENS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────
--
-- WIDENS, for company OWNERS only:
--   · UPDATE on change_order, for change orders under their own company's projects.
--   · the reply arm of ingest_r5b_v1, so an owner can answer the client on any of
--     their company's change orders.
--
-- DOES NOT widen:
--   · CREW and SUBS. Their write scope is untouched — still their own rows only. The
--     hierarchy this adds is one level deep on purpose: `owner` is the role 376 will
--     not mint from an invite (`never mint an owner`, 376:47), so it cannot be
--     acquired by accepting a link.
--   · INSERT on change_order. The desk does not capture. Every record in this product
--     is raised in the field, stamped where and when it happened, and a change order
--     conjured at a keyboard would be the one row in the table with no such origin.
--     The console has no capture control anywhere, by design; this is that design
--     stated where it is actually enforced.
--   · DELETE. 390 already refuses it past draft; nothing here relaxes that.
--   · Anything frozen. 383's trigger still refuses a change to the seven frozen terms
--     once a change order is sent/approved/declined, and 384 still guards the status
--     transitions. So what an owner can actually edit through this policy is a DRAFT —
--     which is exactly the case the console was designed around ("needs a price").
--     Mandate #1's "an approved record is frozen and permanent" is untouched, and this
--     migration would be wrong if it were not.
--
-- ─── THE ESCALATION THIS CLOSES ON ITS WAY PAST ─────────────────────────────────
-- `co_own` is `owner_id = auth.uid()`, so a row that can have its owner_id rewritten
-- can be handed to anybody, and the handing is invisible afterwards. Nothing in the
-- app has ever written that column — the only UPDATEs against change_order in
-- apps/mobile/src touch scope, price, terms, status, numbers and project_id (a draft
-- may legitimately be re-filed to another job, changeorder.ts:1411) — so refusing it
-- costs nothing and removes the one way this widening could be turned into a
-- permanent transfer of a priced commitment.

-- ── 1. Who is the office ────────────────────────────────────────────────────────
-- An ACTIVE member holding the owner role, over the company that owns this project.
-- The evidence-table twin of `is_project_visible` (376), narrowed from member to owner.
--
-- Deliberately reads MEMBERSHIP and not `company.owner_id = auth.uid()`: membership is
-- the thing 376 revokes (`status = 'revoked'`), and a removed person must lose this
-- with everything else. Both facts are true for a real owner anyway; reading the one
-- that can be withdrawn is the safer of the two.
--
-- ONE predicate, not two. A `is_company_office(company_id)` twin was written first and
-- deleted before this shipped: nothing needed it — every caller here starts from a
-- project — and `scripts/verify.mjs`'s rpc-callers check is what found it sitting
-- there granted and unreachable.
create or replace function public.is_project_office(p_project_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project p
      join public.company_member m on m.company_id = p.company_id
     where p.id = p_project_id
       and m.user_id = auth.uid()
       and m.status = 'active'
       and m.role = 'owner'
  );
$$;

revoke all on function public.is_project_office(text) from public, anon;
grant execute on function public.is_project_office(text) to authenticated;

-- ── 2. owner_id is not a field anybody edits ────────────────────────────────────
-- Separate from 383's guard on purpose: that one is about terms going cold after a
-- change order is sent, this one is true at every moment of a row's life, draft
-- included. Written as its own trigger so neither has to grow a second reason.
-- THE ONE LAWFUL EXCEPTION, and it is not optional (review, 2026-09-03).
--
-- Written unconditionally, this trigger makes `429_merge_dev_accounts.sql:63` — which
-- does exactly `update change_order set owner_id = ...` — abort with 42501. On a fresh
-- database replayed in file order (427 before 429) the dev-account merge simply cannot
-- run, and no future ownership repair can either, with nothing written down about how
-- to get past it.
--
-- Same shape as `evidence_purge_authorized()` (437), for the same reason: the ROLE is
-- the fence and the GUC is the opt-in. A PostgREST client is `authenticated` or `anon`
-- and can never be anything else, so it fails the first test no matter what it sets;
-- a migration at psql is the database owner and must still say, on the line, that this
-- transaction is a deliberate repair.
create or replace function public.owner_repair_authorized() returns boolean
  language sql stable
  set search_path = public
as $$
  select current_user not in ('authenticated', 'anon')
     and coalesce(current_setting('app.owner_repair', true), '') = 'on';
$$;

comment on function public.owner_repair_authorized() is
  'True only inside a transaction that is NOT an API client session and has opted in '
  'with app.owner_repair. Ownership is fixed at capture; this is the documented door '
  'for a deliberate account merge or repair, and it is the only one.';

create or replace function public.change_order_owner_fixed() returns trigger
  language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id
     and not public.owner_repair_authorized() then
    raise exception 'a change order does not change hands: owner_id is fixed at capture'
      using errcode = '42501',
            hint = 'a deliberate repair sets app.owner_repair to on for its transaction';
  end if;
  return new;
end $$;

drop trigger if exists change_order_owner_immutable on public.change_order;
create trigger change_order_owner_immutable
  before update on public.change_order
  for each row execute function public.change_order_owner_fixed();

-- ── 3. RLS: the office may UPDATE, and only UPDATE ──────────────────────────────
-- Additive. `co_own` (030) and `co_company_read` (376) both stay exactly as they are;
-- permissive policies OR together, so this only ever grants. UPDATE alone — no `for
-- all` — because `for all` would carry INSERT and DELETE with it, and the two notes
-- above are the reasons neither belongs to the desk.
--
-- The `with check` repeats the `using` so a draft cannot be re-filed OUT of the
-- company: an owner may move it between their own jobs, never onto somebody else's.
drop policy if exists co_office_update on public.change_order;
create policy co_office_update on public.change_order for update to authenticated
  using (public.is_project_office(project_id))
  with check (public.is_project_office(project_id));

-- ── 4. The reply arm of ingest_r5b_v1 ───────────────────────────────────────────
-- 308's function, with ONE condition widened and everything else — the mutation
-- replay check, the server-resolves-the-live-token rule, the no_live_link return that
-- is deliberately not an exception — carried over unchanged. Restated in full rather
-- than patched because `create or replace function` has no other shape.
--
-- `p_owner_id is distinct from auth.uid()` at the top is UNCHANGED: the reply is still
-- written as the person typing it, and this migration does not let anyone post under
-- another name. What changes is only which change orders that person may post ON.
create or replace function public.ingest_r5b_v1(
  p_mutation_id text, p_kind text, p_id text, p_owner_id uuid,
  p_change_order_id text, p_body text,
  p_at_ms bigint, p_request_sha256 text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare prior text;
        live  text;
        co    public.change_order;
begin
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  select request_sha256 into prior from public.r5b_mutation where mutation_id = p_mutation_id;
  if found then
    if prior is distinct from p_request_sha256 then
      raise exception 'mutation % replayed with a different payload', p_mutation_id
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','id',p_id);
  end if;

  if p_kind = 'reply' then
    -- WIDENED (427): the person who raised it, or the office over the job it is on.
    -- Read the row once and decide from it, rather than two exists() probes — this is
    -- SECURITY DEFINER, so every read here runs unfiltered and the fewer of them the
    -- easier this is to be sure about.
    select * into co from public.change_order where id = p_change_order_id;
    if not found then
      raise exception 'not your change order' using errcode = '42501';
    end if;
    if co.owner_id is distinct from p_owner_id
       and not public.is_project_office(co.project_id) then
      raise exception 'not your change order' using errcode = '42501';
    end if;

    -- THE DEVICE DOES NOT CHOOSE THE TOKEN. It names the extra; the server resolves
    -- the one live link. A device holding a stale token (it revised on another
    -- phone, or the pull has not landed) would otherwise reply against a retired
    -- version -- the two-different-numbers failure 270 describes, from the other
    -- side of the conversation.
    select cr.token into live
      from public.confirmation_request cr
     where cr.change_order_id = p_change_order_id
       and cr.superseded_at is null
       and not exists (select 1 from public.confirmation_response x where x.token = cr.token)
     order by cr.created_at desc
     limit 1;

    if live is null then
      -- Not an exception: there is nothing to retry TOWARDS. The reply stays on the
      -- device as part of the record; the caller parks the transport intent with
      -- this reason rather than retrying forever or, worse, dropping the message.
      return jsonb_build_object('status','no_live_link','id',p_id);
    end if;

    insert into public.confirmation_reply (id, token, body, author_id, written_at)
    values (p_id, live, btrim(p_body), p_owner_id, to_timestamp(p_at_ms / 1000.0))
    on conflict (id) do nothing;

  else
    raise exception 'unknown kind %', p_kind using errcode = '23514';
  end if;

  insert into public.r5b_mutation (mutation_id, request_sha256)
  values (p_mutation_id, p_request_sha256);

  return jsonb_build_object('status','applied','id',p_id);
end $$;

revoke all on function public.ingest_r5b_v1 from public, anon;
grant execute on function public.ingest_r5b_v1 to authenticated;
