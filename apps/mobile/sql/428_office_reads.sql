-- 428 — the DERIVED reads follow the company-wide read rule too.
--
-- WHY THIS EXISTS (found while building the web console, 2026-08-26). 376 made a
-- deliberate, stated choice: "COMPANY-WIDE visibility — every active member may READ
-- the company's projects and the evidence under them." It implemented that on the
-- TABLES, with four new select policies, and it has held ever since.
--
-- It never reached the project-scoped read RPCs. Two of them predate 376 and two were
-- written after it, and all four carry their own copy of the ownership test:
--
--     307 extra_questions_v1           co.owner_id = auth.uid()
--     308 discussion_threads           co.owner_id = auth.uid()
--     385 change_order_state_times_v1  co.owner_id = auth.uid()
--     387 extra_open_signal_v1         co.owner_id = auth.uid()
--
-- They are SECURITY DEFINER, so RLS never gets a say — the predicate in the body IS
-- the access rule, and 376 could not have widened them by adding a policy.
--
-- ─── WHAT THAT ACTUALLY BROKE ───────────────────────────────────────────────────
-- The gap is invisible until somebody reads another person's records, which until now
-- nothing did. A manager opening a crew member's change order gets the ROW (376 lets
-- them) and none of the signals derived from it: no questions, no open events, no sent
-- or signed times, no thread.
--
-- The worst of the four is `extra_questions_v1`, and it is worth naming precisely.
-- 'discussing' is not stored — `extrastatus.ts` derives it from an open question count
-- ("a request with question rows and no response is in discussion", 220). Zero
-- questions is indistinguishable from no permission to see the questions. So a change
-- order with a client waiting two days on an answer renders as a calm "Sent" to the
-- one person whose job is to answer it. The status is not merely missing; it is
-- confidently wrong, in the direction of telling someone nothing is owed.
--
-- ─── WHAT THIS CHANGES ──────────────────────────────────────────────────────────
-- One clause, four times:
--
--     co.owner_id = auth.uid()
--  -> co.owner_id = auth.uid() or public.is_project_visible(co.project_id)
--
-- ADDITIVE, and the `or` is doing real work rather than being tidy. Replacing the
-- clause outright would look equivalent and is not: `is_project_visible` joins through
-- `project.company_id`, and a project whose company_id is null — a row that predates
-- 376's backfill and has not been re-stamped — would return false for its own owner.
-- That is a person losing access to their own evidence to widen someone else's, which
-- is the wrong way to be wrong. Keeping both means nobody can lose anything here.
--
-- MEMBERS, not just owners. 427 widened WRITES to the owner role alone, because
-- rewriting a priced commitment is a different act from reading one. Reads follow 376's
-- rule exactly as 376 wrote it: any active member of the company. Two rules, and they
-- are different on purpose.
--
-- ─── WHY THE WHOLE FUNCTIONS ARE HERE ───────────────────────────────────────────
-- `create or replace function` has no partial form, and this repo's rule is one object,
-- one file (`check-sql-duplicates.mjs` fails the build otherwise, and its message says
-- why: "whichever file runs LAST wins, silently"). So each of the four moves here
-- whole, and 307 / 308 / 385 / 387 keep a note saying where it went — the same thing
-- 383 did when it took `change_order_guard` off 030.
--
-- Everything other than that one clause is carried over verbatim, comments included.

-- ── 307's, widened ──────────────────────────────────────────────────────────────
create or replace function public.extra_questions_v1(p_project_id text)
  returns table (
    change_order_id text,
    question_id     bigint,
    note            text,
    asked_at_ms     bigint
  )
  language sql stable security definer set search_path = public as $$
  select r.change_order_id,
         q.id,
         q.note,
         (extract(epoch from q.asked_at) * 1000)::bigint
    from public.confirmation_question q
    join public.confirmation_request r on r.token = q.token
    join public.change_order co on co.id = r.change_order_id
   -- NULL-SAFE. `co.owner_id = auth.uid()` is NULL, not false, for an unauthenticated
   -- caller, and a NULL where-clause drops the row -- but saying so explicitly is the
   -- habit 100_projects.sql was fixed to keep, because the next edit to this predicate
   -- might not be null-safe by accident.
   where auth.uid() is not null
     and (co.owner_id = auth.uid() or public.is_project_visible(co.project_id))
     and co.project_id = p_project_id
     and not exists (
       select 1 from public.confirmation_response x where x.token = q.token
     )
   order by q.asked_at
$$;

revoke all on function public.extra_questions_v1(text) from public;
grant execute on function public.extra_questions_v1(text) to authenticated;

-- ── 385's, widened ──────────────────────────────────────────────────────────────
create or replace function public.change_order_state_times_v1(p_project_id text)
  returns table (
    change_order_id  text,
    sent_at_ms       bigint,
    approved_at_ms   bigint,
    declined_at_ms   bigint,
    superseded_at_ms bigint
  )
  language sql stable security definer set search_path = public as $$
  select co.id,
         (extract(epoch from (
            select min(r.created_at) from public.confirmation_request r
             where r.change_order_id = co.id)) * 1000)::bigint,
         (extract(epoch from (
            select min(a.signed_at) from public.approval a
             where a.change_order_id = co.id and a.action = 'approved')) * 1000)::bigint,
         (extract(epoch from (
            select min(a.signed_at) from public.approval a
             where a.change_order_id = co.id and a.action = 'declined')) * 1000)::bigint,
         (extract(epoch from co.superseded_at) * 1000)::bigint
    from public.change_order co
   -- NULL-SAFE, stated explicitly. `co.owner_id = auth.uid()` is NULL for an
   -- unauthenticated caller and a NULL predicate drops the row, but saying so is the
   -- habit 100_projects.sql was fixed to keep: the next edit to this predicate might
   -- not be null-safe by accident.
   where auth.uid() is not null
     and (co.owner_id = auth.uid() or public.is_project_visible(co.project_id))
     and co.project_id = p_project_id
$$;

revoke all on function public.change_order_state_times_v1(text) from public, anon;
grant execute on function public.change_order_state_times_v1(text) to authenticated;

-- ── 387's, widened ──────────────────────────────────────────────────────────────
-- `change_order_open_signal` (the per-row helper this calls) is NOT touched: it is
-- granted to service_role only and stays that way. This is the contractor's read.
create or replace function public.extra_open_signal_v1(p_project_id text)
  returns table (
    change_order_id     text,
    open_count          bigint,
    viewed              boolean,
    first_opened_at_ms  bigint,
    last_opened_at_ms   bigint
  )
  language sql stable security definer set search_path = public as $$
  select co.id, s.open_count, s.viewed,
         (extract(epoch from s.first_opened_at) * 1000)::bigint,
         (extract(epoch from s.last_opened_at)  * 1000)::bigint
    from public.change_order co
    cross join lateral public.change_order_open_signal(co.id) s
   -- NULL-SAFE, stated explicitly (100_projects.sql's habit): auth.uid() is checked
   -- on its own line so the ownership predicate can never pass by being NULL.
   where auth.uid() is not null
     and (co.owner_id = auth.uid() or public.is_project_visible(co.project_id))
     and co.project_id = p_project_id
$$;

revoke all on function public.extra_open_signal_v1(text) from public, anon;
grant execute on function public.extra_open_signal_v1(text) to authenticated;

-- ── 308's, widened ──────────────────────────────────────────────────────────────
-- Returned per CHANGE ORDER, not per token, because a revision moves the token and
-- the contractor is looking at an extra, not at a link.
create or replace function public.discussion_threads(p_project_id text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by x->>'at'), '[]'::jsonb) into out from (
    select jsonb_build_object(
             'id', 'q-' || q.id, 'change_order_id', cr.change_order_id,
             'side', 'client', 'body', q.note, 'at', q.asked_at) as x
      from public.confirmation_question q
      join public.confirmation_request cr on cr.token = q.token
      join public.change_order co on co.id = cr.change_order_id
     where co.project_id = p_project_id
       and (co.owner_id = auth.uid() or public.is_project_visible(co.project_id))
    union all
    -- A reply keeps its OWN id, unprefixed. The device authored that id and already
    -- has the message stored under it; prefixing here would hand the pull a
    -- different key for a message the contractor is looking at, and INSERT OR
    -- IGNORE would not ignore it -- his own reply would appear twice. Questions are
    -- prefixed because their id is a bigint from a different sequence entirely.
    select jsonb_build_object(
             'id', r.id, 'change_order_id', cr.change_order_id,
             'side', 'contractor', 'body', r.body, 'at', r.written_at)
      from public.confirmation_reply r
      join public.confirmation_request cr on cr.token = r.token
      join public.change_order co on co.id = cr.change_order_id
     where co.project_id = p_project_id
       and (co.owner_id = auth.uid() or public.is_project_visible(co.project_id))
  ) s;
  return out;
end $$;

revoke all on function public.discussion_threads from public, anon;
grant execute on function public.discussion_threads to authenticated;
