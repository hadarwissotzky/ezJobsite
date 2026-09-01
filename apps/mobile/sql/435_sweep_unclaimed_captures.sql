-- 435 — Delete captures that nothing in the product points at.
--
-- hadar, 2026-09-01: "photos cannot be assigned to a jobsite -- only to a co -- this
-- means that there are orphand assets that have to be removed when / if a co is
-- canceled or deleted." He is right about the model, and the schema agrees: `capture`
-- carries `project_id` and no `change_order_id`. The only path from a photo to a
-- commitment is capture ← decision_version ← decision ← change_order.decision_id.
--
-- MEASURED 2026-09-01, before writing this: 193 captures exist, 96 MB. Only 21 reach a
-- change order. 139 reach nothing. This deletes the hardest subset of those — the ones
-- that NOTHING references at all.
--
-- ============================================================================
-- WHAT "UNCLAIMED" MEANS, and why the list is longer than the obvious one.
--
-- Eighteen tables carry a `capture_id`. They are not equal:
--   A CLAIM is something a person or a commitment MADE — decision_version,
--   decision_current, approval_photo, capture_note, capture_tag, capture_pair,
--   confirmation_reply_media, processing_job. Any one of these and the capture stays.
--   A DERIVED ARTEFACT is something the pipeline produced ABOUT the capture —
--   capture_transcript, capture_structured, capture_content_signal, structure_latency,
--   capture_mutation. A photo with a transcript and nothing else is still a photo
--   nobody used, so these do NOT protect it.
--
-- I checked this against the data rather than reasoning it out: the obvious predicate
-- (no decision, no processing job, no CO) returned 66 rows, and the full one returns
-- 61. Five captures are held by a note, a tag or a before/after pairing that the short
-- version would have destroyed.
--
-- WHY THIS IS NOT MANDATE #1. That mandate forbids losing a capture the user believes
-- is saved. These are captures the product itself never attached to anything: no
-- decision, no change order, no note, no tag, not even a processing job. The newest is
-- 2026-08-06 — twenty-six days before this file — so nothing is going to claim them.
--
-- THE AGE FLOOR IS THE REAL SAFETY. Fourteen days, and it is not decoration: it means
-- a re-run of this file months from now cannot reach a capture taken this morning that
-- has simply not been structured yet. Without it the predicate is a race against the
-- pipeline. With it, the file stays safe to run twice.
--
-- NOT SWEPT, DELIBERATELY: 73 captures whose `processing_job.state` is 'done' and which
-- produced nothing. They are protected here by the processing_job claim. That pattern
-- looks like a pipeline stage that finished and dropped its result, which is a BUG to
-- find, not data to delete — deleting them would destroy the only evidence of it.
-- hadar's call, 2026-09-01.
--
-- STORAGE OBJECTS ARE NOT REMOVED. The rows go; the bytes stay in the bucket as
-- orphans until something sweeps them. Same gap as 433 and 434, stated not hidden.
-- ============================================================================
--
-- Apply with:  ./scripts/apply-migration.sh apps/mobile/sql/435_sweep_unclaimed_captures.sql

begin;

create temp table unclaimed on commit drop as
select c.id, c.project_id
from public.capture c
where c.inserted_at < now() - interval '14 days'
  and not exists (select 1 from public.decision_version         x where x.capture_id = c.id)
  and not exists (select 1 from public.decision_current         x where x.capture_id = c.id)
  and not exists (select 1 from public.processing_job           x where x.capture_id = c.id)
  and not exists (select 1 from public.approval_photo           x where x.capture_id = c.id)
  and not exists (select 1 from public.capture_note             x where x.capture_id = c.id)
  and not exists (select 1 from public.capture_tag              x where x.capture_id = c.id)
  and not exists (select 1 from public.capture_pair             x where x.capture_id = c.id)
  and not exists (select 1 from public.confirmation_reply_media x where x.capture_id = c.id);

select 'sweeping' as action, count(*) as captures,
       round(sum(coalesce(a.ciphertext_len,0))/1024.0/1024.0, 1) as mb
from unclaimed u left join public.attachment a on a.capture_id = u.id;

-- Per project, so the effect on the jobs list is visible before it happens.
select 'per job' as scope, left(p.name, 26) as name, count(*) as captures
from unclaimed u join public.project p on p.id = u.project_id
group by p.name order by count(*) desc;

-- Derived artefacts first: they reference the capture and are meaningless without it.
delete from public.capture_transcript_current where capture_id in (select id from unclaimed);
delete from public.capture_transcript         where capture_id in (select id from unclaimed);
delete from public.capture_structured_current where capture_id in (select id from unclaimed);
delete from public.capture_structured         where capture_id in (select id from unclaimed);
delete from public.capture_content_signal     where capture_id in (select id from unclaimed);
delete from public.structure_latency          where capture_id in (select id from unclaimed);
delete from public.capture_mutation           where capture_id in (select id from unclaimed);
delete from public.capture_discarded          where capture_id in (select id from unclaimed);
delete from public.capture_op_state           where capture_id in (select id from unclaimed);
delete from public.attachment                 where capture_id in (select id from unclaimed);
delete from public.capture                    where id         in (select id from unclaimed);

-- Proof, not assumption.
select 'unclaimed remaining (expect 0)' as check, count(*)
from public.capture c
where c.inserted_at < now() - interval '14 days'
  and not exists (select 1 from public.decision_version         x where x.capture_id = c.id)
  and not exists (select 1 from public.decision_current         x where x.capture_id = c.id)
  and not exists (select 1 from public.processing_job           x where x.capture_id = c.id)
  and not exists (select 1 from public.approval_photo           x where x.capture_id = c.id)
  and not exists (select 1 from public.capture_note             x where x.capture_id = c.id)
  and not exists (select 1 from public.capture_tag              x where x.capture_id = c.id)
  and not exists (select 1 from public.capture_pair             x where x.capture_id = c.id)
  and not exists (select 1 from public.confirmation_reply_media x where x.capture_id = c.id);

-- Every capture that reaches a change order must be untouched: this must not move.
select 'captures on a change order (expect 21)' as check, count(distinct dv.capture_id)
from public.decision_version dv
join public.decision d      on d.id = dv.decision_id
join public.change_order co on co.decision_id = d.id;

commit;
