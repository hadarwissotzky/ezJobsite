-- 431 — Delete the two jobsites that hold nothing at all.
--
-- hadar, 2026-08-31: "lets start by deleting all the jobsites with no CO" — then, shown
-- what that set actually contained, chose the two truly empty ones only.
--
-- WHY THIS IS NOT "WHERE THERE ARE NO CHANGE ORDERS". Six jobsites had no change order.
-- FOUR OF THEM HELD CAPTURES — 12 uploaded photos/videos, 5.5 MB, on "Test", "SFO",
-- "Hadar's place" and "Wissotzky Lorinczi home". A capture that never became a change
-- order is still a capture, and mandate #1 does not soften because no money was ever
-- attached to it. Those four are deliberately NOT touched here.
--
-- WHY IT IS ALSO NOT JUST "WHERE id IN (...)". The two ids below were empty when this
-- file was written. If a capture lands on one between then and the moment you run it,
-- a plain id list would delete it anyway. So the ids say WHICH rows this migration is
-- allowed to consider, and the emptiness predicate decides whether it may actually go
-- — the same belt-and-braces shape as `delete_empty_project_v1`, which re-checks
-- inside its own DELETE for exactly this reason.
--
-- THE PREDICATE IS THAT FUNCTION'S OWN LIST, all 12 tables carrying `project_id`,
-- copied deliberately rather than referenced: if a table is added later and the RPC is
-- updated, this file is a dated record of what "empty" meant on 2026-08-31, not a
-- moving target. Read 430_delete_empty_project.sql beside it.
--
-- Apply with:  ./scripts/apply-migration.sh apps/mobile/sql/431_drop_empty_test_jobsites.sql
-- That script names the target database out loud, asks first, and runs the whole file
-- in one transaction with ON_ERROR_STOP.

begin;

create temp table doomed on commit drop as
select p.id, p.name
from public.project p
where p.id in ('prj-mtgjufcb-8s8ys',   -- "Test",  created 2026-08-31, 0 of everything
               'prj-mtgpouyh-5fovq')   -- "Tests", created 2026-08-31, 0 of everything
  and not exists (select 1 from public.change_order             x where x.project_id = p.id)
  and not exists (select 1 from public.capture                  x where x.project_id = p.id)
  and not exists (select 1 from public.attachment               x where x.project_id = p.id)
  and not exists (select 1 from public.capture_op_state         x where x.project_id = p.id)
  and not exists (select 1 from public.capture_pair             x where x.project_id = p.id)
  and not exists (select 1 from public.decision                 x where x.project_id = p.id)
  and not exists (select 1 from public.approval                 x where x.project_id = p.id)
  and not exists (select 1 from public.confirmation_request     x where x.project_id = p.id)
  and not exists (select 1 from public.extra_work_authorization x where x.project_id = p.id)
  and not exists (select 1 from public.co_comment               x where x.project_id = p.id)
  and not exists (select 1 from public.scope_boundary           x where x.project_id = p.id)
  and not exists (select 1 from public.processing_job           x where x.project_id = p.id);

-- Say out loud what is about to go. If this prints fewer than two rows, one of them
-- stopped being empty since 2026-08-31 and is being spared on purpose.
select 'deleting' as action, id, name from doomed;

-- The two roster tables are the only rows a jobsite delete may take with it: they
-- record who was attached to the site, they are not evidence that anything happened,
-- and leaving them would orphan rows pointing at a project that no longer exists.
delete from public.project_party    where project_id in (select id from doomed);
delete from public.project_approver where project_id in (select id from doomed);
delete from public.project          where id         in (select id from doomed);

-- Proof rather than assumption: this must return 0 rows.
select 'survived (expected none)' as check, p.id, p.name
from public.project p where p.id in ('prj-mtgjufcb-8s8ys','prj-mtgpouyh-5fovq');

-- And the four that were spared, with what each of them still holds.
select 'kept — holds captures' as check, left(p.name, 24) as name,
       (select count(*) from public.capture c where c.project_id = p.id) as captures
from public.project p
where p.id in ('prj-mtan9m3u-4i5at','prj-mtcc5mtk-g9bod','prj-mtc8t095-bgb61','prj-mtc9wuk0-mw3ag')
order by captures desc;

commit;
