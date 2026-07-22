-- R2 — "target ≤15s structure time", made measurable.
--
-- R2 states a latency target and nothing in the product could tell you whether it
-- was met. A target nobody measures is a sentence in a document: the pipeline could
-- have drifted to 90s and the only symptom would be contractors quietly not using
-- the review card, which is indistinguishable from them not liking it.
--
-- TWO DIFFERENT NUMBERS, KEPT SEPARATE ON PURPOSE, because conflating them is how a
-- latency regression hides:
--
--   step_ms  — how long the structuring call itself took. This is the number R2's
--              "≤15s structure time" is about, and the only one the worker controls.
--              Written by the worker; null on rows structured before this migration.
--   wait_ms  — enqueue → structured row, wall clock. What the CONTRACTOR experiences,
--              and it includes queue depth, transcription, retries, and every minute
--              the phone had no signal. Derived here from rows that already exist, so
--              it works retroactively and needs no worker change.
--
-- A fast step_ms with a terrible wait_ms is a queueing problem, not a model problem.
-- One column would have made those look the same.
--
-- APPEND-ONLY IS NOT WEAKENED. `structure_ms` is written in the same INSERT as the
-- proposal it describes; `structured_append_only()` (160) still forbids the UPDATE.
-- A duration that could be revised after the fact would be a metric that can be made
-- to look good, which is worth less than no metric.

alter table public.capture_structured
  add column if not exists structure_ms integer
    check (structure_ms is null or structure_ms >= 0);

comment on column public.capture_structured.structure_ms is
  'Wall-clock ms spent in the structuring step that produced this row. NULL for '
  'rows written before 302 or by a worker that does not report it. R2 targets 15000.';

-- Per-capture latency, both numbers side by side.
--
-- LEFT JOIN, and the direction matters: a capture whose job is still queued or
-- blocked has no structured row and MUST still appear, with nulls. An inner join
-- would report the p95 of only the captures that succeeded — the flattering subset,
-- and the one that hides a pipeline that has stopped finishing jobs at all.
create or replace view public.structure_latency as
  select j.capture_id,
         j.owner_id,
         j.state,
         j.attempts,
         j.created_at                                   as enqueued_at,
         s.created_at                                   as structured_at,
         s.structure_ms                                 as step_ms,
         case when s.created_at is null then null
              else (extract(epoch from (s.created_at - j.created_at)) * 1000)::bigint
         end                                            as wait_ms,
         -- The target, evaluated here rather than in five dashboards that can each
         -- be wrong about it. NULL = not finished, which is neither a pass nor a fail.
         case when s.structure_ms is null then null
              else s.structure_ms <= 15000
         end                                            as met_target
    from public.processing_job j
    left join lateral (
      select st.created_at, st.structure_ms
        from public.capture_structured st
       where st.capture_id = j.capture_id
       order by st.created_at desc
       limit 1
    ) s on true
   where j.steps ? 'structure';

comment on view public.structure_latency is
  'R2 latency. step_ms = the structuring call (the ≤15s target). wait_ms = enqueue → '
  'proposal, what the contractor waits. Unfinished jobs appear with nulls on purpose.';

-- RLS: the view inherits `processing_job`'s and `capture_structured`'s policies, so a
-- caller sees only their own rows. Stated rather than assumed, because a latency view
-- is exactly the kind of object someone later marks security_definer "just to get the
-- numbers" and thereby exposes every tenant's capture ids.
