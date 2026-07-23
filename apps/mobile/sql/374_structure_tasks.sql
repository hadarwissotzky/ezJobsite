-- 374 — the structure proposal learns tasks.
--
-- hadar, 2026-07-23: detect mentions of price, time, materials, potential
-- start; when the narration describes several tasks, group each task's
-- elements together; produce a clean, clear scope of change for the owner.
--
-- One jsonb column, not child rows: capture_structured_current is
-- newest-wins per capture, and a proposal is read as one unit. The shape is
-- an array of { title, scope, materials[], price_words, time_words,
-- start_words } — the *_words fields are VERBATIM SPANS of the transcript,
-- never normalized numbers (mandate #6: the app's own parser + the human
-- read-back remain the only path a figure takes). This is also R14's raw
-- material: auto-splitting one session into several extras starts from
-- exactly this grouping.

alter table public.capture_structured
  add column if not exists proposed_tasks jsonb;

create or replace view public.capture_structured_current as
select distinct on (capture_id) * from public.capture_structured
 order by capture_id, created_at desc;
grant select on public.capture_structured_current to authenticated;
