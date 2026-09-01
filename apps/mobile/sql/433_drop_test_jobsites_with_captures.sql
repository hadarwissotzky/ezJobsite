-- 433 — Delete four test jobsites AND the captures inside them.
--
-- ⚠️ THIS DESTROYS EVIDENCE ON PURPOSE. Every other delete path in this product refuses
-- to. Read the next thirty lines before running it.
--
-- hadar, 2026-09-01: "i still have job sites in the list with duplicate addresses -- so
-- it doesn't let me delete them because it thinks they have CO in them that is not the
-- case."
--
-- HE IS RIGHT ABOUT THE CHANGE ORDERS AND THE APP WAS RIGHT TO REFUSE. These four hold
-- no change orders. They hold twelve uploaded photos/videos, and `delete_empty_project_v1`
-- counts a capture as content because mandate #1 says a capture is never lost. The app
-- cannot be talked out of that, and should not be: the refusal is the product working.
--
-- WHICH IS WHY THIS IS A MIGRATION AND NOT A FEATURE. There is no "delete anyway" button
-- and this file is not a step toward one. It is a one-off cleanup of DEVELOPMENT data by
-- the person who created it, run by hand, with the loss written down. A contractor must
-- never have this.
--
-- WHAT IS DESTROYED, measured 2026-09-01:
--   prj-mtan9m3u-4i5at  "Test"                     5 captures   3.4 MB
--   prj-mtcc5mtk-g9bod  "SFO"                      3 captures   1.1 MB
--   prj-mtc9wuk0-mw3ag  "Hadar's place"            2 captures   0.6 MB
--   prj-mtc8t095-bgb61  "Wissotzky Lorinczi home"  2 captures   0.4 MB
-- Twelve captures, twelve attachment rows, 5.5 MB. NOT RECOVERABLE. There is no
-- tombstone and no undo.
--
-- WHAT IS DELIBERATELY NOT IN THIS LIST — check this before adding an id:
--   prj-mrtvenfd-1go4h  1151 Stanyan   97 captures, 3 change orders — a DIFFERENT house
--   prj-ms5do1fx-ft284  1155 Stanyan   37 captures, 2 APPROVED change orders
--   prj-mt24rm0g-kai39  1155 Stanyan   38 captures, 2 change orders, owned by the phone
--   prj-mrzjsak8-pwcpc  1155 Stanyan    9 captures, 1 declined change order
-- The approved ones are frozen instruments (mandates #1 and #5) and are not deletable by
-- any route, including this one. Archive is the tool for those.
--
-- GUARDED: the DELETE still refuses any project carrying a change order, so if one of
-- these ids has gained one since 2026-09-01 the whole file leaves it alone rather than
-- taking a change order with it.
--
-- STORAGE OBJECTS ARE NOT REMOVED BY THIS FILE. It deletes rows; the bytes stay in the
-- Storage bucket as orphans until something sweeps them. Stated, not hidden.
--
-- Apply with:  ./scripts/apply-migration.sh apps/mobile/sql/433_drop_test_jobsites_with_captures.sql

begin;

create temp table doomed on commit drop as
select p.id, p.name
from public.project p
where p.id in ('prj-mtan9m3u-4i5at',
               'prj-mtcc5mtk-g9bod',
               'prj-mtc9wuk0-mw3ag',
               'prj-mtc8t095-bgb61')
  -- THE ONE LINE THAT KEEPS THIS SAFE. Captures are being destroyed knowingly; a change
  -- order is a priced commitment and is not on the table under any circumstances.
  and not exists (select 1 from public.change_order x where x.project_id = p.id)
  and not exists (select 1 from public.approval     x where x.project_id = p.id)
  and not exists (select 1 from public.confirmation_request x where x.project_id = p.id);

select 'about to delete' as action, d.id, d.name,
       (select count(*) from public.capture c where c.project_id = d.id) as captures
from doomed d;

-- Children first: attachment references capture, so the order is not cosmetic.
delete from public.attachment           where project_id in (select id from doomed);
delete from public.capture_pair         where project_id in (select id from doomed);
delete from public.capture_op_state     where project_id in (select id from doomed);
delete from public.capture              where project_id in (select id from doomed);
delete from public.decision             where project_id in (select id from doomed);
delete from public.extra_work_authorization where project_id in (select id from doomed);
delete from public.co_comment           where project_id in (select id from doomed);
delete from public.scope_boundary       where project_id in (select id from doomed);
delete from public.processing_job       where project_id in (select id from doomed);
delete from public.project_party        where project_id in (select id from doomed);
delete from public.project_approver     where project_id in (select id from doomed);
delete from public.project              where id         in (select id from doomed);

-- Proof, not assumption: both must return zero rows.
select 'projects surviving (expect 0)' as check, count(*) from public.project
where id in ('prj-mtan9m3u-4i5at','prj-mtcc5mtk-g9bod','prj-mtc9wuk0-mw3ag','prj-mtc8t095-bgb61');

select 'orphan captures (expect 0)' as check, count(*) from public.capture
where project_id in ('prj-mtan9m3u-4i5at','prj-mtcc5mtk-g9bod','prj-mtc9wuk0-mw3ag','prj-mtc8t095-bgb61');

-- What is left at 1155 Stanyan afterwards, so the duplicate picture is honest.
select 'still at 1155 Stanyan' as check, left(p.name, 26) as name,
       (select count(*) from public.capture c where c.project_id = p.id) as captures,
       (select count(*) from public.change_order c where c.project_id = p.id) as cos
from public.project p
where p.id in ('prj-ms5do1fx-ft284','prj-mrzjsak8-pwcpc','prj-mt24rm0g-kai39')
order by captures desc;

commit;
