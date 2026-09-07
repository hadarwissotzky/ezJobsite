-- 308_r5b_discussion.sql
--
-- RENUMBERED 305 -> 308 [2026-07-22]. This file walks the revision chain through
-- `change_order.superseded_by`, and that column is created by 307_extras_ledger.sql.
-- Applied in numeric order, 305 ran BEFORE 307 and died with
--   ERROR: column prior.superseded_by does not exist
-- taking every later migration in the same transaction down with it.
--
-- Found by applying all eleven pending migrations in ONE transaction against the
-- live database with ON_ERROR_STOP and rolling back -- not by reading them. Each one
-- had been checked alone, where nothing was wrong; the ORDER was the bug, and order
-- is invisible until you run them in it.
--
-- The header below already said 307 owned the column. Knowing a dependency and
-- being sequenced behind it are different things.
--
-- THE OTHER HALF OF THE THREAD. PRD R5b.
--
-- 220_question_path.sql built one direction and it terminated in the database.
-- A client could ask; `confirmation_question` recorded it, append-only, and
-- `confirmation_questions()` could read it back -- to the CLIENT's own page. There
-- was no reply table, no contractor read path, and no revision. The contractor
-- literally could not see a question that had been asked, so the product's answer
-- to "the homeowner has a question about your price" was silence.
--
-- What this file adds, and only this:
--   confirmation_reply        the contractor's half of the thread, append-only
--   ingest_r5b_v1             the idempotent write RPC, mirroring ingest_r5c_v1
--                             (290) rather than inventing a fresh transport shape
--   confirmation_thread       both directions, for the CLIENT's page (anon, by token)
--   discussion_threads        both directions, for the CONTRACTOR (authenticated)
--   change_order_lineage      what counts as "the same thread" across revisions
--
-- WHAT THIS FILE DELIBERATELY DOES NOT OWN: supersession. R5b's "Revise & Resend"
-- retires the previous version, and an earlier draft of this file wrote that itself
-- -- a `change_order_revision` table plus a 'revise' kind on the RPC below. It was
-- deleted on finding that 307_extras_ledger.sql already owns the whole act
-- (`change_order.superseded_by`, `supersede_change_order_v1`, and the retirement of
-- the old approval link that stops a client signing yesterday's $1,850). Two writers
-- for one terminal transition is how a status ends up depending on which drain ran
-- last. R5b calls 307's writer; the lineage function below reads its column.
--
-- TWO RULES THIS FILE ENFORCES AT THE TABLE, not in the RPC -- same reasoning as
-- 210/240/250/270: a rule stated in one function is a rule some other write path
-- can forget, and re-running an older file can silently undo it.
--
-- 1. A REPLY IS APPEND-ONLY EVIDENCE. Like every other evidence table here.
--
-- 2. AN ANSWERED REQUEST TAKES NO MORE MESSAGES (R5b AC4: "the thread closes to
--    new messages, record preserved"). 220 already refuses a QUESTION after an
--    answer; this refuses a REPLY on the same ground. A contractor message
--    appearing under a signed approval would read as a term of the deal arriving
--    after the signature -- and mandate #5 makes the frozen text the instrument,
--    so nothing may appear to amend it.
--
-- WHAT IS NOT HERE, deliberately: no 'discussion' value is added to
-- change_order.status. 220 settled that -- "In Discussion is derivable and not a
-- fourth stored state" -- and a stored copy would be a second place for the truth
-- to live and the first place for it to drift. The client derives it in
-- extrastatus.ts (displayStatus, R7); this file only supplies the messages that
-- derivation reads.

-- ── the contractor's half of the thread ─────────────────────────────────────
create table if not exists public.confirmation_reply (
  -- AUTHORED BY THE DEVICE, not generated here. A reply is typed offline (mandate
  -- #7) and uploaded later, possibly twice; a device-authored id makes the insert
  -- idempotent on its own, independent of the mutation ledger.
  id           text primary key,
  -- Which SENT VERSION this reply was written against. Kept even after the link is
  -- retired: it is how the record shows which price the conversation was about.
  token        text not null references public.confirmation_request(token),
  body         text not null check (length(btrim(body)) > 0),
  author_id    uuid not null,
  -- The device's clock, preserved: the contractor typed it in a basement at 14:02
  -- and it uploaded at 18:40. The record must say when it was written.
  written_at   timestamptz not null,
  received_at  timestamptz not null default now()
);

create index if not exists confirmation_reply_token_idx
  on public.confirmation_reply (token, written_at);

create or replace function public.confirmation_reply_no_change() returns trigger
  language plpgsql as $$ begin
    raise exception 'replies are append-only evidence: % blocked', tg_op;
  end $$;

drop trigger if exists confirmation_reply_immutable on public.confirmation_reply;
create trigger confirmation_reply_immutable before update or delete
  on public.confirmation_reply for each row
  execute function public.confirmation_reply_no_change();

-- R5b AC4. The mirror of 220's "questions are refused after an answer".
create or replace function public.confirmation_reply_thread_open() returns trigger
  language plpgsql as $$
declare answered boolean;
begin
  select exists(select 1 from public.confirmation_response x where x.token = new.token)
    into answered;
  if answered then
    raise exception 'this request was already answered; the thread is closed'
      using errcode = '23514', hint = 'thread_closed';
  end if;
  return new;
end $$;

drop trigger if exists confirmation_reply_open_only on public.confirmation_reply;
create trigger confirmation_reply_open_only before insert on public.confirmation_reply
  for each row execute function public.confirmation_reply_thread_open();

alter table public.confirmation_reply enable row level security;
-- No policy, on purpose: every read and write goes through the SECURITY DEFINER
-- functions below, which state their own owner/token check. Same posture as
-- confirmation_question (220).

-- ── what counts as "the same thread" ────────────────────────────────────────
--
-- BACKWARD ONLY. From a version you see its own messages and every ancestor's --
-- R5b's "the full thread is visible on the new version". You do NOT see messages
-- written on a LATER version, because a superseded version is a closed historical
-- record and must not grow new content after the fact.
--
-- Depth is capped. A cycle cannot happen through the normal path (a new id is
-- always new), but a hand-edited or replayed row could make one, and an unbounded
-- recursive CTE against a cycle does not return.
create or replace function public.change_order_lineage(p_change_order_id text)
  returns setof text language sql stable as $$
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

-- ── the client's page: both directions of the thread, by token ──────────────
--
-- A SEPARATE function rather than widening confirmation_questions (220), which is
-- that file's object. One object, one owner -- the rule check-sql-duplicates exists
-- to enforce.
--
-- The token is the credential, exactly as it is for confirmation_fetch: 160 bits,
-- and the reader is an owner who will never have an account (REQ-VAL3). What it
-- exposes is scoped to the lineage of the one change order that token addresses.
create or replace function public.confirmation_thread(p_token text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare co text;
        out jsonb;
begin
  select change_order_id into co
    from public.confirmation_request where token = p_token;
  if not found then return '[]'::jsonb; end if;

  -- A plain decision confirmation (no price, no change order) has no lineage to
  -- walk; its thread is just this token's own messages.
  if co is null then
    select coalesce(jsonb_agg(x order by x->>'at'), '[]'::jsonb) into out from (
      select jsonb_build_object('side','client','body',q.note,'at',q.asked_at) as x
        from public.confirmation_question q where q.token = p_token
      union all
      select jsonb_build_object('side','contractor','body',r.body,'at',r.written_at)
        from public.confirmation_reply r where r.token = p_token
    ) s;
    return out;
  end if;

  select coalesce(jsonb_agg(x order by x->>'at'), '[]'::jsonb) into out from (
    select jsonb_build_object('side','client','body',q.note,'at',q.asked_at) as x
      from public.confirmation_question q
      join public.confirmation_request cr on cr.token = q.token
     where cr.change_order_id in (select id from public.change_order_lineage(co))
    union all
    select jsonb_build_object('side','contractor','body',r.body,'at',r.written_at)
      from public.confirmation_reply r
      join public.confirmation_request cr2 on cr2.token = r.token
     where cr2.change_order_id in (select id from public.change_order_lineage(co))
  ) s;
  return out;
end $$;

revoke all on function public.confirmation_thread from public;
grant execute on function public.confirmation_thread to anon, authenticated;

-- ── the contractor's read path ──────────────────────────────────────────────
--
-- THE ONE THAT WAS MISSING. Every message on every extra of one job, both
-- directions, with the stable ids the device uses to de-duplicate on pull. Scoped
-- by change_order.owner_id and NOT by RLS: SECURITY DEFINER bypasses RLS, so the
-- owner check is stated here rather than inherited (the lesson 260 wrote down).
--
-- Returned per CHANGE ORDER, not per token, because a revision moves the token and
-- the contractor is looking at an extra, not at a link.
-- `discussion_threads` is NOT defined here any more [2026-08-26]. It lives in
-- `428_office_reads.sql`, its single owner.
--
-- Why it moved: 428 widens its ownership test from `co.owner_id = auth.uid()` to
-- that OR `is_project_visible(co.project_id)`, so an active member of the company
-- that owns the job can read it — which is the rule 376 already chose for the
-- tables and never applied to the definer functions. Until then the client conversation itself returned nothing on a teammate's change order.
--
-- Nothing else about it changed. `create or replace function` has no partial form,
-- so the widened version is the whole function, and one object defined in two files
-- is decided by whichever ran last.

-- ── transport ───────────────────────────────────────────────────────────────
create table if not exists public.r5b_mutation (
  mutation_id    text primary key,
  request_sha256 text not null,
  applied_at     timestamptz not null default now()
);
alter table public.r5b_mutation enable row level security;

-- `ingest_r5b_v1` is NOT defined here any more [2026-08-26]. It lives in
-- `427_office_writes.sql`, its single owner.
--
-- Why it moved: 427 widens the reply arm's ownership test so a company OWNER can
-- answer the client on a change order one of their crew raised — the check that used
-- to read `co.owner_id = p_owner_id` and refuse everyone else. `create or replace
-- function` has no partial form, so the widened version is the whole function, and two
-- files defining one function means whichever ran last wins silently. Everything else
-- about it — the mutation replay guard, the server-resolves-the-live-token rule, the
-- `no_live_link` return that is deliberately not an exception — is unchanged and is
-- explained in 427 where the code now is.
--
-- ONE KIND TODAY ('reply'), and the kind parameter stays anyway: ingest_r5c_v1 grew
-- from one kind to four, and retrofitting the dispatch afterwards would mean a
-- second RPC and a second mutation ledger for the same feature.
