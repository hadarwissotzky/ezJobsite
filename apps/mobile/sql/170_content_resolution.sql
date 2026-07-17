-- Content-assisted project detection — REQ-P4.
--
--   "combine content signals (a client name, address, or job reference SPOKEN in
--    the recording) with GPS to either (a) confirm/strengthen a match to an
--    existing project, or (b) conclude no existing project fits."
--
-- WHY THIS IS SQL AND NOT AN LLM CALL, which is the whole design decision:
--
-- I have an authorised LLM key and I am deliberately not using it here. Twenty
-- minutes ago the model invented "$450" from "four fifty" at HIGH confidence,
-- while the regex refused it — on the field mandate #6 calls the highest-risk in
-- the product. The lesson generalises: USE THE MODEL FOR WHAT ONLY IT CAN DO
-- (turning rambling prose into a subject and a value), AND A DETERMINISTIC RULE
-- FOR IDENTITY.
--
-- "Did he say '14 Elm Street' or 'the Hendersons'?" is not comprehension. It is a
-- string match against rows we already have. A model asked that question can
-- confidently match a job that was never mentioned — and a capture filed to the
-- wrong job is the failure NOBODY GOES LOOKING FOR, which is strictly worse than
-- an unresolved one sitting in a queue a human checks.
--
-- So: exact, auditable, testable, free, and it cannot hallucinate a jobsite.
--
-- IT IS A SIGNAL, NOT A FILING. It writes a candidate + why. Resolution still
-- routes ambiguity to the Inbox (REQ-P2), and a project is still never
-- auto-created (REQ-P5).

create table if not exists public.capture_content_signal (
  id            text primary key,
  capture_id    text not null,
  owner_id      uuid not null,
  -- The project the WORDS point at. Null = the words point at nothing we know.
  candidate_project_id text,
  -- What was actually matched, quoted. A signal you cannot audit is a guess with
  -- a confidence score: "matched '14 Elm St' in the transcript" is checkable by a
  -- human in one second.
  matched_on    text,
  matched_text  text,
  confidence    text not null check (confidence in ('high','low','none')),
  from_transcript text,
  created_at    timestamptz not null default now()
);

create index if not exists content_signal_by_capture
  on public.capture_content_signal (capture_id, created_at desc);

create or replace function public.content_signal_append_only() returns trigger
  language plpgsql as $$ begin
    raise exception 'content signals are append-only: % blocked', tg_op;
  end $$;
drop trigger if exists content_signal_immutable on public.capture_content_signal;
create trigger content_signal_immutable before update or delete
  on public.capture_content_signal for each row execute function public.content_signal_append_only();

alter table public.capture_content_signal enable row level security;
drop policy if exists signal_own on public.capture_content_signal;
create policy signal_own on public.capture_content_signal for select to authenticated
  using (owner_id = auth.uid());
revoke insert, update, delete on public.capture_content_signal from authenticated;

/**
 * Match a transcript against the owner's projects. Deterministic, and it says WHY.
 *
 * Matches on: project name, address, client_ref. Case-insensitive, whole-token, so
 * "Elm" alone does not match "Elm St" — a two-letter coincidence must not file a
 * capture. A match must be a SPAN A HUMAN WOULD RECOGNISE as naming the job.
 *
 * TWO MATCHES = NONE. If the words point at two jobs, the words did not identify a
 * job; picking one would be inventing certainty (REQ-P2 routes it to the Inbox).
 */
create or replace function public.content_resolve(p_owner uuid, p_transcript text)
returns table (project_id text, matched_on text, matched_text text, confidence text)
language sql stable as $$
  -- COUNT FIRST, THEN DECIDE -- and do it in ONE query.
  --
  -- The first cut returned the matching rows and THEN appended an 'ambiguous'
  -- row, so a caller doing `select * into r` read the FIRST MATCH and never saw
  -- the warning. It would have MIS-FILED a capture that named two jobs -- the
  -- failure nobody goes looking for. The test caught it. The rule was right; the
  -- shape was wrong.
  --
  -- The second cut used a temp table and could not even run: CREATE is not
  -- allowed in a `stable` function, and this MUST stay stable -- a resolver that
  -- writes is a resolver that can have side effects on a read path.
  with m as (
    select p.id,
           case
             when length(coalesce(p.name,'')) > 3
              and lower(p_transcript) ~ ('\y' || regexp_replace(lower(p.name), '([^\w\s])', '\\\1', 'g') || '\y')
               then 'name'
             when length(coalesce(p.address,'')) > 5
              and lower(p_transcript) ~ ('\y' || regexp_replace(lower(p.address), '([^\w\s])', '\\\1', 'g') || '\y')
               then 'address'
             when length(coalesce(p.client_ref,'')) > 3
              and lower(p_transcript) ~ ('\y' || regexp_replace(lower(p.client_ref), '([^\w\s])', '\\\1', 'g') || '\y')
               then 'client'
           end as how,
           -- The string that ACTUALLY MATCHED, not the first non-null field.
           -- The first cut used coalesce(name, address, client_ref), which quoted
           -- the project's NAME while matched_on said 'address' -- a signal whose
           -- own evidence contradicted its own label. The entire reason this is a
           -- deterministic match instead of a model call is that a human can check
           -- it in one second; quoting the wrong string throws that away and is
           -- WORSE than quoting nothing, because it looks checked.
           case
             when length(coalesce(p.name,'')) > 3
              and lower(p_transcript) ~ ('\y' || regexp_replace(lower(p.name), '([^\w\s])', '\\\1', 'g') || '\y')
               then p.name
             when length(coalesce(p.address,'')) > 5
              and lower(p_transcript) ~ ('\y' || regexp_replace(lower(p.address), '([^\w\s])', '\\\1', 'g') || '\y')
               then p.address
             when length(coalesce(p.client_ref,'')) > 3
              and lower(p_transcript) ~ ('\y' || regexp_replace(lower(p.client_ref), '([^\w\s])', '\\\1', 'g') || '\y')
               then p.client_ref
           end as txt
      from public.project p
     where p.owner_id = p_owner
       and coalesce(p.status,'active') = 'active'
  ),
  hits as (select * from m where m.how is not null),
  c as (select count(*)::int as n from hits)
  -- TWO OR MORE MATCHES = NONE. The words did not identify a job; choosing
  -- between them would manufacture the certainty this layer exists to avoid.
  -- REQ-P2 routes it to the Inbox, where a human answers in one tap.
  select null::text, 'ambiguous'::text, null::text, 'none'::text
    from c where c.n > 1
  union all
  -- Exactly one. The words name a job and only that job.
  select h.id, h.how, h.txt, 'high'::text
    from hits h, c where c.n = 1;
  -- n = 0: neither branch fires, so no rows. Silence is the honest answer to
  -- "which job?" when the words name none -- REQ-P2 already holds it durably.
$$;

revoke all on function public.content_resolve from public, anon;
