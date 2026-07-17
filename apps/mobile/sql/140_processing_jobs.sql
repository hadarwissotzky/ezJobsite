-- The durable processing queue — REQ-PROC1 / REQ-PROC4 / REQ-PROC6's ProcessingJob.
--
-- WHAT THIS IS AND IS NOT.
--
-- Transcription needs an LLM/STT key, which I do not have. But the model call is a
-- `fetch`. THE HARD PART IS THE RUNTIME AROUND IT, and ARCHITECTURE is explicit
-- about why: the multi-step pipeline must live in a durable-jobs runtime and
-- "NEVER a synchronous Edge Function (no retry/resume there)". A capture that
-- half-transcribed and died must resume, not restart and not vanish.
--
-- So this is the queue, the state machine and the resumability — testable, and
-- provably correct — with the model call as a PLUGGABLE STEP that nobody has
-- plugged in yet. When a key arrives, the adapter is small; if the runtime were
-- missing, the key would buy nothing.
--
-- WHAT MAKES IT SAFE TO BUILD NOW:
--  * NOTHING SETS `processed` EXCEPT A WORKER THAT ACTUALLY RAN. No worker exists,
--    so nothing reaches it. A state that claims work which never happened is the
--    exact lie the server-owned rule exists to prevent (capture_op_state.
--    processing_state is already server-owned).
--  * A job is claimed with FOR UPDATE SKIP LOCKED, so two workers cannot both take
--    it. That is the bug you cannot retrofit once there are two workers.
--  * blocked_reason is a FIRST-CLASS COLUMN, not an inference. REQ-PROC6: "when
--    it's stuck it tells the user why in plain language."

create table if not exists public.processing_job (
  id            text primary key,
  capture_id    text not null,
  owner_id      uuid not null,
  project_id    text not null,

  -- The steps this capture needs, in order. Explicit rather than implied by a
  -- state name: a photo needs no transcription, and a job that lists its own steps
  -- can be resumed by reading it rather than by re-deriving what it "should" do.
  steps         jsonb not null default '["transcribe","detect_language","structure"]'::jsonb,
  -- How far it got. RESUME READS THIS: a job that died after transcribing must not
  -- transcribe again -- that is a paid API call and a different answer.
  completed_steps jsonb not null default '[]'::jsonb,

  state         text not null default 'queued'
                  check (state in ('queued','running','blocked','done','failed')),
  -- REQ-PROC6, verbatim: needs_wifi / needs_cell_consent / needs_connection / none.
  blocked_reason text not null default 'none'
                  check (blocked_reason in ('none','needs_wifi','needs_cell_consent',
                                            'needs_connection','needs_api_key')),
  attempts      integer not null default 0,
  last_error    text,
  -- Who holds it, and until when. A lease, not a flag: a worker that dies holding
  -- a boolean holds it forever.
  leased_until  timestamptz,
  leased_by     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists job_ready on public.processing_job (state, leased_until)
  where state in ('queued','blocked');

alter table public.processing_job enable row level security;
drop policy if exists job_own on public.processing_job;
create policy job_own on public.processing_job for select to authenticated
  using (owner_id = auth.uid());
-- The client never writes a job. It is created by the server when a capture lands
-- and advanced only by a worker.
revoke insert, update, delete on public.processing_job from authenticated;

-- A job appears when a capture does. The client cannot ask for one, and cannot
-- skip one: the queue is a consequence of the capture existing, not a request.
create or replace function public.enqueue_processing() returns trigger
  language plpgsql as $$
begin
  insert into public.processing_job (id, capture_id, owner_id, project_id, steps)
  values ('job-' || new.id, new.id, new.owner_id, new.project_id,
          case
            -- A photo has NO WORDS. It was given '["structure"]', which needs a
            -- transcript, so every photo blocked forever with a reason that was
            -- not even true. A photo capture IS complete when it is stored and
            -- stamped: it is evidence, and there is nothing to extract from it
            -- without a vision model nobody has plugged in. Declaring no steps is
            -- the honest description of that.
            when new.modality = 'photo' then '[]'::jsonb
            when new.modality = 'text'  then '["detect_language","resolve_project","structure"]'::jsonb
            else '["transcribe","detect_language","resolve_project","structure"]'::jsonb
          end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists capture_enqueues_job on public.capture;
create trigger capture_enqueues_job after insert on public.capture
  for each row execute function public.enqueue_processing();

/**
 * Claim one job. FOR UPDATE SKIP LOCKED + a lease.
 *
 * The lease is why this is not a boolean: a worker that dies mid-job holds a flag
 * forever, and the capture never processes again. A lease expires and the job
 * returns to the queue by itself. `attempts` rises so a job that kills three
 * workers is visible rather than silently immortal.
 */
create or replace function public.claim_job(p_worker text, p_lease_seconds int default 120)
returns public.processing_job language plpgsql security definer set search_path = public as $$
declare j public.processing_job;
begin
  select * into j from public.processing_job
   where (
     -- Waiting to start, or parked with a reason that may have cleared.
     state in ('queued','blocked')
     -- OR: RUNNING WITH A DEAD LEASE. This was missing, and the test caught it:
     -- a worker that dies mid-job leaves the job in 'running' forever, so it was
     -- NEVER RECLAIMED and the capture NEVER PROCESSED. That is exactly the
     -- failure the lease exists to prevent -- a lease nothing reclaims is just a
     -- boolean with a timestamp on it.
     or state = 'running'
   )
     and (leased_until is null or leased_until < now())
     and attempts < 5
   order by created_at
   for update skip locked
   limit 1;
  if not found then return null; end if;

  update public.processing_job
     set state = 'running', leased_by = p_worker,
         leased_until = now() + make_interval(secs => p_lease_seconds),
         attempts = attempts + 1, updated_at = now()
   where id = j.id
   returning * into j;
  return j;
end $$;

/**
 * Record ONE step. Called after each step, not at the end.
 *
 * That is the whole point of resumability: a job that dies after transcribing must
 * come back knowing it transcribed. Recording only at the end means every crash
 * re-runs a paid API call and may get a different answer for the same audio.
 */
create or replace function public.complete_step(p_job text, p_step text)
returns public.processing_job language plpgsql security definer set search_path = public as $$
declare j public.processing_job;
begin
  update public.processing_job
     set completed_steps = completed_steps || to_jsonb(p_step),
         updated_at = now(),
         -- Done only when every declared step is in completed_steps. Not a count:
         -- a step list that changes must not make an old job look finished.
         state = case
           when (select bool_and(s in (select jsonb_array_elements_text(
                         completed_steps || to_jsonb(p_step))))
                   from jsonb_array_elements_text(steps) s)
           then 'done' else 'running' end,
         leased_until = null
   where id = p_job
   returning * into j;

  -- The capture's own state follows the job, and ONLY the server writes it.
  if j.state = 'done' then
    update public.capture_op_state set processing_state = 'processed', updated_at = now()
     where capture_id = j.capture_id;
  end if;
  return j;
end $$;

/**
 * Finish a job that has NOTHING LEFT TO DO.
 *
 * TWO REAL BUGS, one shape. complete_step is the only thing that can mark a job
 * done, and it is only ever called BY a step. So a job with no remaining steps is
 * never marked done by anyone:
 *
 *  * A PHOTO. It was enqueued with '["structure"]', but structure needs a
 *    transcript and a photo has no words -- so every photo blocked with
 *    "needs_connection: no transcript to structure". PROVEN, not theorised: the
 *    worker printed exactly that. The reason was also a LIE (nothing was wrong
 *    with the connection), and REQ-PROC6 promises the stuck state "tells the user
 *    why in plain language". Photos now declare NO steps, honestly.
 *  * A RESUMED JOB whose steps all completed before it died. remaining = [], no
 *    step runs, nothing calls complete_step, and the job sits in 'running' until
 *    the lease lapses -- then it is reclaimed, and again, until attempts hits 5
 *    and claim_job stops considering it FOREVER. That one is worse than the photo
 *    because it is SILENT: the capture is fully processed and its state says
 *    'running' until it quietly dies.
 *
 * IT CANNOT BE USED TO SKIP WORK. The guard is the same predicate complete_step
 * uses -- done only when every declared step is already in completed_steps. Given
 * a job with work left, this does nothing at all. A "mark it done" that trusts
 * its caller is how work gets claimed that never happened.
 */
create or replace function public.finish_job(p_job text)
returns public.processing_job language plpgsql security definer set search_path = public as $$
declare j public.processing_job;
begin
  update public.processing_job
     set state = 'done', updated_at = now(), leased_until = null
   where id = p_job
     and (select bool_and(s in (select jsonb_array_elements_text(completed_steps)))
            from jsonb_array_elements_text(steps) s)
         -- bool_and over ZERO rows is NULL, not true: a job that declares no steps
         -- (a photo) has nothing outstanding by definition. Without this coalesce
         -- the photo fix does not fix the photo.
         is not false
   returning * into j;
  if j.id is null then return null; end if;   -- work outstanding: refuse, silently.

  update public.capture_op_state set processing_state = 'processed', updated_at = now()
   where capture_id = j.capture_id;
  return j;
end $$;

/** Park it with a REASON a person can act on (REQ-PROC6). */
create or replace function public.block_job(p_job text, p_reason text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.processing_job
     set state = 'blocked', blocked_reason = p_reason, last_error = p_error,
         leased_until = null, updated_at = now()
   where id = p_job;
end $$;

revoke all on function public.claim_job, public.complete_step, public.block_job,
  public.finish_job from public, anon, authenticated;

-- What is waiting, and why. The office's Monday query, and REQ-PROC6's source.
create or replace view public.processing_backlog as
select state, blocked_reason, count(*) as n,
       min(created_at) as oldest
  from public.processing_job
 group by state, blocked_reason;
grant select on public.processing_backlog to authenticated;

-- Transcripts live in 150_transcripts.sql, NOT here.
--
-- This file originally added source_transcript/source_language as COLUMNS ON
-- `capture`. The worker tried to UPDATE them and the append-only trigger refused:
--   "capture is append-only (immutable evidence): UPDATE blocked"
-- It was right. A derivative that arrives later belongs BESIDE the record, in its
-- own append-only table -- the same shape as capture_note and capture_resolution.
