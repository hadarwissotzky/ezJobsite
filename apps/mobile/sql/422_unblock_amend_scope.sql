-- 422_unblock_amend_scope.sql
--
-- REPAIR: free the jobs parked on a step that was never deployed.
--
-- hadar, 2026-08-24, on a change order he had just recorded: "1. The price wasn't set
-- automatically 2. There is no button to send the draft even though it is ready".
--
-- Both were one cause. On 2026-08-24 I added `amend_scope` to the step list in `140`
-- while the step's implementation was still on a feature branch. Render deploys the
-- worker from `main`, so the running worker met a step it did not have and PARKED the
-- job — correctly; `worker.ts:238` chooses parking over succeeding precisely so a
-- capture is never marked processed with nothing done.
--
-- The steps before it had already run, so the write-up landed and the extra LOOKED
-- finished. What did not happen was the job reporting complete, and the app reads that
-- to decide whether the pipeline is done: no "processed" state means no Send button and
-- no price auto-fill. An extra that reads as ready and cannot be sent.
--
-- `140` is reverted in the same change so no NEW job carries the step. This file is only
-- for the ones already holding it.
--
-- ─── WHY REWRITE `steps` RATHER THAN JUST CLEARING THE BLOCK ────────────────────
-- Clearing `blocked_reason` alone would hand the job straight back to the same worker,
-- which would meet the same unknown step and park it again — a repair that repairs
-- nothing and burns an attempt each time. The step has to leave the job's own list.
--
-- ─── IT TOUCHES NOTHING THAT SUCCEEDED ──────────────────────────────────────────
-- Only rows that still DECLARE `amend_scope`. `completed_steps` is left exactly as it
-- is: those steps ran, their output is written, and rewriting that record to make a
-- repair tidier would be falsifying what happened. `attempts` is reset because the count
-- measures failures against a step that is no longer asked for.

update public.processing_job
   set steps = (
         select coalesce(jsonb_agg(s), '[]'::jsonb)
           from jsonb_array_elements(steps) s
          where s <> '"amend_scope"'::jsonb
       ),
       blocked_reason = 'none',
       attempts = 0
 where steps @> '["amend_scope"]'::jsonb;

-- A job whose remaining steps are all complete is finished, and must be recorded as
-- finished rather than left looking like work in flight. `is_complete` is the worker's
-- own predicate (`steps.ts`), restated here in SQL for the one-off — the worker will
-- reach the same answer on its next pass either way, and this makes the repair visible
-- in the row instead of only in behaviour.
--
-- NOT AUTOMATED ANYWHERE ELSE: this is a repair statement, not a rule. The rule is that
-- the enqueue and the implementation ship together.
