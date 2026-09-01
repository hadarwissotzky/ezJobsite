-- 432 — Put the Stanyan jobsite back on Stanyan.
--
-- hadar, 2026-08-31: "Fix", on being shown that one jobsite's map was in the wrong
-- part of the city.
--
-- THE ROW SAYS TWO DIFFERENT PLACES. `prj-ms5do1fx-ft284` is named
-- "1155 Stanyan st, San Francisco 94117" and carries the address
-- "1-99 Stockton St · San Francisco, CA" with coordinates 37.7858 / -122.4064 — Union
-- Square, about 4.5 km from Stanyan. The card in the Jobs list therefore draws a map of
-- downtown under a title naming a house in Cole Valley, which is how it was spotted.
--
-- WHY IT MATTERS MORE THAN A WRONG PICTURE. Coordinates on a project are not decoration:
-- REQ project-resolution files a capture to the nearest jobsite by GPS (mandate #8 —
-- GPS suggests, never decides, but it is what it suggests FROM). A jobsite pinned 4.5 km
-- away is never going to be offered to somebody standing at the house, so every capture
-- taken there has to be filed by hand, and the job that this row holds TWO APPROVED
-- change orders for is the one job where that matters most.
--
-- WHY THIS IS NOT EVIDENCE TAMPERING. `project` is a mutable relational row — the
-- PowerSync side of the split in CLAUDE.md §5, explicitly "not evidence". Its address
-- and geofence are expected to be corrected. Nothing here touches a capture, a change
-- order, an approval, or any frozen `shown_content`: the approved instruments keep the
-- address that was rendered into them at signing, which is exactly right, because what
-- the client signed must not change retroactively.
--
-- THE NEW COORDINATES ARE NOT INVENTED. They are the value the geocoder already returned
-- for this same address on the four sibling rows — 37.7632 / -122.4525 on
-- prj-mrzjsak8-pwcpc, prj-mt24rm0g-kai39, prj-mtc9wuk0-mw3ag and prj-mtc8t095-bgb61.
-- Agreement across four independent lookups is better evidence than one more lookup.
--
-- REVERSIBLE. The previous values are recorded here, in this comment, on purpose:
--   address = '1-99 Stockton St · San Francisco, CA'
--   lat     = 37.7858        lng = -122.4064
-- Restoring them is a one-line UPDATE with those literals.
--
-- Apply with:  ./scripts/apply-migration.sh apps/mobile/sql/432_fix_stanyan_geocode.sql

begin;

-- Before, so the log of the run carries what was replaced.
select 'before' as state, id, name, address, lat, lng
from public.project where id = 'prj-ms5do1fx-ft284';

-- GUARDED BY THE OLD VALUE, not just by id. If someone has already corrected this row
-- by hand, this migration must do nothing rather than overwrite their fix with a value
-- that was current on 2026-08-31.
update public.project
   set address = '1155 Stanyan St · San Francisco, CA',
       lat     = 37.7632,
       lng     = -122.4525
 where id      = 'prj-ms5do1fx-ft284'
   and address = '1-99 Stockton St · San Francisco, CA';

select 'after' as state, id, name, address, lat, lng
from public.project where id = 'prj-ms5do1fx-ft284';

-- Proof: this jobsite must now sit within a block of the four that share its address.
select 'distance to siblings (m)' as check,
       round((6371000 * acos(least(1,
         cos(radians(p.lat)) * cos(radians(s.lat)) *
         cos(radians(s.lng) - radians(p.lng)) +
         sin(radians(p.lat)) * sin(radians(s.lat)))))::numeric, 1) as metres,
       left(s.name, 26) as sibling
from public.project p, public.project s
where p.id = 'prj-ms5do1fx-ft284'
  and s.id in ('prj-mrzjsak8-pwcpc','prj-mt24rm0g-kai39','prj-mtc9wuk0-mw3ag','prj-mtc8t095-bgb61')
order by metres;

commit;
