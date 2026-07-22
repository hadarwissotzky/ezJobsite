-- 366_event_timeline.sql
--
-- R6 — THE EVENT TIMELINE THE RECORD IS SUPPOSED TO BE. Opens, questions, and the
-- answer, each with a real server timestamp, readable by the contractor who owns it.
--
-- WHAT WAS MISSING, and why it mattered more than it looked:
--   * NOTHING LOGGED AN OPEN. `confirm.html` called fetch/state/ask/respond and
--     never told the server it had been read. R6 names "opened (each open logged
--     with timestamp and count)" and calls "opened 3 times, no response" the
--     actionable signal — it is the difference between "they are ignoring me" and
--     "they never got the text", which are two different next actions for the
--     contractor. Neither could be told apart.
--   * QUESTIONS EXISTED AND WERE INVISIBLE. 220 stores every question as evidence;
--     `confirmation_question` appears in zero lines of app code. A client could ask
--     three times and the contractor's record showed nothing at all.
--   * THE ANSWER HAD NO TIME ON THE DEVICE. record.ts renders sent/signed/declined
--     with an explicit "time not recorded" marker because the local change_order
--     carries no timestamp for them. The times exist — on confirmation_request and
--     confirmation_response — and nothing ever read them back.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT EMIT:
--   * `delivered`. `confirmation_request.delivery_state` exists but nothing in this
--     repo ever advances it past 'queued' (no carrier webhook), and there is no
--     delivered_at column, so there is no time to show. Emitting a delivered event
--     off a state flag would put an event on the timeline with an invented
--     position, which is exactly the rule record.ts exists to hold. When a delivery
--     receipt lands, it needs its own timestamped column and one line here.
--   * `reminder`. No reminder is ever sent by this product yet. An empty branch for
--     a feature that does not exist is a lie waiting to be believed.
--
-- OWNERSHIP: every object below is created only here (check-sql-duplicates).

-- ── each open is evidence ───────────────────────────────────────────────────
create table if not exists public.confirmation_open (
  id         bigint generated always as identity primary key,
  -- NOT unique: opening twice is the fact being recorded.
  token      text not null references public.confirmation_request(token),
  -- identity SIGNAL, not identity PROOF — named the same way as every other
  -- counterparty fact in this schema.
  user_agent text,
  opened_at  timestamptz not null default now()
);

create index if not exists confirmation_open_token_idx
  on public.confirmation_open (token, opened_at);

create or replace function public.confirmation_open_no_change() returns trigger
  language plpgsql as $$ begin
    raise exception 'opens are append-only evidence: % blocked', tg_op;
  end $$;

drop trigger if exists confirmation_open_no_update on public.confirmation_open;
create trigger confirmation_open_no_update before update or delete
  on public.confirmation_open for each row
  execute function public.confirmation_open_no_change();

alter table public.confirmation_open enable row level security;
-- No select policy: RLS on with no policy is DENY. The only reader is
-- change_order_timeline() below, which is security definer and checks ownership
-- itself. anon can write an open and can never read anybody's.

-- ── logging an open, from the no-account page ───────────────────────────────
--
-- COALESCING, and why it is not a betrayal of "append-only evidence":
-- a browser reload, a back-swipe, a return-to-tab and an iOS link preview all fire
-- a page load. Counting each of those as a separate reading would turn the one
-- number the contractor is meant to ACT on ("opened 3 times, no response") into
-- noise, and it hands an unauthenticated caller an unbounded insert. So opens from
-- the same token AND the same user agent inside 60 seconds record once.
--
-- The direction of the error is chosen on purpose: this UNDER-counts and never
-- over-counts. An under-count makes the contractor chase a client who has already
-- read it (harmless); an over-count would tell him he is being ignored when he is
-- not, and that is the reading he acts on. Rejected alternative: dedupe on
-- user_agent alone (a phone that opens once a week would log once, forever).
create or replace function public.confirmation_opened(
  p_token text, p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.confirmation_request%rowtype;
        recent boolean;
begin
  select * into r from public.confirmation_request where token = p_token;
  -- A bad token is not an error worth showing a homeowner. The page has already
  -- told them the link is not valid; failing the open log on top of that would
  -- replace that message with a network error. Silent no-op, deliberately.
  if not found then return jsonb_build_object('status','ignored'); end if;

  select exists (
    select 1 from public.confirmation_open o
     where o.token = p_token
       and o.user_agent is not distinct from p_user_agent
       and o.opened_at > now() - interval '60 seconds'
  ) into recent;
  if recent then return jsonb_build_object('status','coalesced'); end if;

  insert into public.confirmation_open (token, user_agent) values (p_token, p_user_agent);
  return jsonb_build_object('status','logged');
end $$;

revoke all on function public.confirmation_opened from public;
grant execute on function public.confirmation_opened to anon, authenticated;

-- ── the contractor reads the whole timeline back ────────────────────────────
--
-- ONE RPC RETURNING EVENTS + SNAPSHOT TOGETHER, not two. The record screen needs
-- both at once and this is read on a phone with one bar; two round trips is the
-- whole perceived load time, doubled, for data that is always wanted together.
--
-- SECURITY DEFINER WITH AN EXPLICIT OWNER CHECK: it reads confirmation_request,
-- confirmation_open, confirmation_question and confirmation_response, none of which
-- grant select to authenticated (260 is the precedent — an approval is visible to
-- the contractor it belongs to and nobody else). Definer without the check would
-- have handed every signed-in user every client's questions and signatures.
create or replace function public.change_order_timeline(p_change_order_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare evs jsonb; snap jsonb;
begin
  if not exists (
    select 1 from public.change_order co
     where co.id = p_change_order_id and co.owner_id = auth.uid()
  ) then
    raise exception 'not your change order' using errcode = '42501';
  end if;

  with req as (
    select * from public.confirmation_request where change_order_id = p_change_order_id
  ),
  evs_raw as (
    select 'sent'::text as kind, r.created_at as at_ts,
           jsonb_build_object('channel', r.channel, 'who', r.counterparty_label) as detail
      from req r
    union all
    select 'opened', o.opened_at, '{}'::jsonb
      from public.confirmation_open o join req r on r.token = o.token
    union all
    select 'asked', q.asked_at, jsonb_build_object('note', q.note)
      from public.confirmation_question q join req r on r.token = q.token
    union all
    select case when x.action = 'confirmed' then 'approved' else 'declined' end,
           x.responded_at,
           jsonb_build_object('name', x.signed_name, 'note', x.note)
      from public.confirmation_response x join req r on r.token = x.token
    union all
    -- A superseded link IS the revision event R6 asks for: the old instrument was
    -- retired at that instant because a new one was issued (250).
    select 'superseded', r.superseded_at, '{}'::jsonb
      from req r where r.superseded_at is not null
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('kind', kind, 'at', at_ts, 'detail', detail)
                     order by at_ts),
           '[]'::jsonb)
    into evs
    from evs_raw;

  -- The binding instrument, for AC2: "either party opens its record later, then they
  -- see the identical immutable snapshot". The contractor's app was rendering
  -- change_order.scope — the MUTABLE local row — which is the one thing that must
  -- never stand in for the signed document.
  --
  -- Which request, when there are several: the ANSWERED one wins, because that is the
  -- one that was signed. Only if none was answered does the newest live one show.
  select jsonb_build_object(
           'token', r.token,
           'shown_content', r.shown_content,
           'shown_sha256', r.shown_sha256,
           'action', x.action,
           'signed_name', x.signed_name,
           'answered_at', x.responded_at,
           'superseded', r.superseded_at is not null)
    into snap
    from public.confirmation_request r
    left join public.confirmation_response x on x.token = r.token
   where r.change_order_id = p_change_order_id
   order by (x.token is not null) desc, r.created_at desc
   limit 1;

  return jsonb_build_object('events', evs, 'snapshot', snap);
end $$;

revoke all on function public.change_order_timeline from public, anon;
grant execute on function public.change_order_timeline to authenticated;

-- ── a retired link can point at the live one ────────────────────────────────
--
-- R6 AC3's loose end: the superseded page says "open the most recent link they
-- texted you" and then abandons the reader. If the contractor revised while the
-- client had the old text open, the client is now hunting through their messages
-- for a link they may never find — and the change order sits unanswered, which
-- looks from the app like a client who is ignoring it.
--
-- WHY THIS IS NARROWED TO THE SAME DESTINATION: the token is the credential
-- (020's stated trade). Handing the holder of an old token the current one is only
-- safe when both were addressed to the same place. If the contractor reissued to a
-- DIFFERENT approver — a designer instead of the owner — then forwarding would give
-- the first person a live, signable link that was never meant for them. Rejected the
-- simpler "return the newest live token" for exactly that case. Same destination, or
-- nothing.
create or replace function public.confirmation_current_link(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare old public.confirmation_request%rowtype; cur text;
begin
  select * into old from public.confirmation_request where token = p_token;
  if not found or old.superseded_at is null or old.change_order_id is null then
    return jsonb_build_object('found', false);
  end if;
  -- Never forward past an answer: if the old link was itself answered it is
  -- terminal evidence and there is nothing to move on to.
  if exists (select 1 from public.confirmation_response x where x.token = old.token) then
    return jsonb_build_object('found', false);
  end if;

  select r.token into cur
    from public.confirmation_request r
   where r.change_order_id = old.change_order_id
     and r.superseded_at is null
     and now() <= r.expires_at
     and r.destination is not distinct from old.destination
     and not exists (select 1 from public.confirmation_response x where x.token = r.token)
   order by r.created_at desc
   limit 1;

  return jsonb_build_object('found', cur is not null, 'token', cur);
end $$;

revoke all on function public.confirmation_current_link from public;
grant execute on function public.confirmation_current_link to anon, authenticated;
