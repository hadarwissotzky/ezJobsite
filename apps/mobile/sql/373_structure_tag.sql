-- 373 — the R5c type tag joins the structure proposal.
--
-- 160 built `capture_structured` before R5c existed, so the proposal had no
-- place for "what KIND of extra is this". The worker's structure step now
-- proposes one; same rules as every other proposed_* column: a guess, gated by
-- confidence, applied only by a human-confirmed flow (the R5c send preview is
-- contractor-set and one-tap-overridable — mandate #8, suggest never decide).
--
-- The CHECK mirrors apps/mobile/src/approverrouting.ts EXTRA_TYPES; a slug
-- outside the taxonomy is refused at the door, not adopted.

alter table public.capture_structured
  add column if not exists proposed_extra_type text
  check (proposed_extra_type is null or proposed_extra_type in
         ('structural','mep','finish','code_permit','site_condition','scope_clarification'));

-- The newest-wins view is recreated so it carries the new column (a view's
-- column list freezes at creation; select * does not track ALTERs).
create or replace view public.capture_structured_current as
select distinct on (capture_id) * from public.capture_structured
 order by capture_id, created_at desc;
grant select on public.capture_structured_current to authenticated;
