-- 307_extras_ledger.sql
--
-- PRD R7 — the two per-item statuses the extras ledger could name but never show.
--
-- R7's last AC asks for "per-item statuses (approved/pending/discussing/declined/
-- superseded)". Three of those worked. Two were vocabulary with nothing behind it:
--
--   DISCUSSING was write-only. 220_question_path.sql builds the whole question
--   path and confirm.html writes to it, but `confirmation_question` has RLS on and
--   no policy, and the only readers 220 shipped are `confirmation_questions(token)`
--   -- for the anon page, keyed on a token the contractor's app does not hold. So
--   the contractor could not read his own client's question by any route. The
--   ledger kept saying "Sent" while the client waited on HIM.
--
--   SUPERSEDED had no writer anywhere. It is legal in the CHECK on both sides and
--   the ledger renders it "Revised", but nothing -- device or server -- ever set
--   it. 250_one_live_link supersedes the LINK, which is a different object: the
--   request gets `superseded_at`, the change order keeps saying 'sent'.
--
-- ONE OBJECT, ONE FILE. Nothing here redefines anything owned elsewhere. In
-- particular `confirmation_request_supersedes` (250) and `change_order_guard`
-- (030) are untouched; the function below writes rows those triggers already
-- govern, rather than restating their rules.

-- ── the contractor reads his own client's questions ─────────────────────────
--
-- SECURITY DEFINER because `confirmation_question` deliberately has no read policy
-- (220): the question thread is reachable by token from a no-account page, so a
-- blanket policy for `authenticated` would be the same mistake 260 had to undo on
-- `approval` -- every tenant's client questions readable by every signed-in user.
-- This exposes exactly one path: your own change orders, on one project.
--
-- "OPEN" IS DEFINED HERE AND ONLY HERE. A question is open while its token has no
-- answer -- the same rule `confirmation_ask` enforces when it refuses a question
-- after the item is settled. The device counts what this returns and never
-- re-decides openness, so the two sides cannot drift.
--
-- A question on a SUPERSEDED link still counts. She asked; nobody answered; issuing
-- a new link did not answer her. Filtering those out would make a revision look
-- like a reply.
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
     and co.owner_id = auth.uid()
     and co.project_id = p_project_id
     and not exists (
       select 1 from public.confirmation_response x where x.token = q.token
     )
   order by q.asked_at
$$;

revoke all on function public.extra_questions_v1(text) from public;
grant execute on function public.extra_questions_v1(text) to authenticated;

-- ── a revision retires the version before it ────────────────────────────────
--
-- Idempotent by outcome, not by a mutation id: superseding is terminal and the
-- successor is recorded on the row, so a replay either finds the same successor
-- (already applied) or a different one (a real conflict, and refusing loudly beats
-- rewriting lineage). That is why this queue does not carry a mutation table like
-- ingest_project_v1 does -- there is nothing to de-duplicate that the row itself
-- does not already answer.
--
-- ONLY FROM 'sent'. Same guard as the device's `canSupersede`, and it matters more
-- here: the server is where the client's answer lands, so this is the side that
-- would race a signature. Walking an approved change order to 'superseded' would
-- retire an outcome someone signed.
alter table public.change_order
  add column if not exists superseded_by text;

alter table public.change_order
  add column if not exists superseded_at timestamptz;

create or replace function public.supersede_change_order_v1(
  p_id text, p_superseded_by text, p_at_ms bigint
) returns jsonb language plpgsql security definer set search_path = public as $$
declare co public.change_order%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into co from public.change_order where id = p_id;
  if not found then
    raise exception 'unknown change order %', p_id using errcode = '42501';
  end if;
  if co.owner_id is distinct from auth.uid() then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  if co.status = 'superseded' then
    -- A replay of the same revision is fine. A DIFFERENT successor is not: two
    -- revisions of one version means somebody's lineage is wrong, and silently
    -- keeping the last writer would hide it.
    if co.superseded_by is distinct from p_superseded_by then
      raise exception 'change order % is already superseded by %', p_id, co.superseded_by
        using errcode = '23505';
    end if;
    return jsonb_build_object('status','already_applied','id',p_id);
  end if;

  if co.status <> 'sent' then
    -- Not an error the device can fix by retrying, and not a crash either: the
    -- client answered first, and her answer stands. Reported so the device can stop
    -- asking rather than retry forever.
    return jsonb_build_object('status','not_superseded','id',p_id,'actual',co.status);
  end if;

  update public.change_order
     set status = 'superseded',
         superseded_by = p_superseded_by,
         superseded_at = to_timestamp(p_at_ms / 1000.0)
   where id = p_id
     and status = 'sent';

  -- THE OLD LINK DIES WITH THE OLD VERSION. Without this the retired price stays
  -- answerable and a client can sign yesterday's $1,850 after the contractor
  -- revised it to $1,500 -- the exact hazard 250_one_live_link was written for.
  -- 250 only retires links when a NEW request is inserted, and a revision may sit
  -- as an unsent draft for hours before that happens.
  --
  -- An ANSWERED link is never touched: it is evidence of a completed act, not a
  -- live offer. Same carve-out 250 makes, for the same reason.
  update public.confirmation_request r
     set superseded_at = now()
   where r.change_order_id = p_id
     and r.superseded_at is null
     and not exists (
       select 1 from public.confirmation_response x where x.token = r.token
     );

  return jsonb_build_object('status','superseded','id',p_id);
end $$;

revoke all on function public.supersede_change_order_v1(text, text, bigint) from public;
grant execute on function public.supersede_change_order_v1(text, text, bigint) to authenticated;
