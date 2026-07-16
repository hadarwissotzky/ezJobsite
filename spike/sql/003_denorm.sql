-- Denormalize project_id onto child tables so every sync-stream query can filter
-- directly on the active_projects CTE. PowerSync CTEs cannot reference other CTEs,
-- and deep nested subqueries in stream queries are fragile. Throwaway spike:
-- denormalization is the right trade here.
alter table public.capture_op_state add column if not exists project_id text
  references public.project(id) on delete cascade;
alter table public.attachment      add column if not exists project_id text
  references public.project(id) on delete cascade;
create index if not exists capture_op_state_project_idx on public.capture_op_state(project_id);
create index if not exists attachment_project_idx        on public.attachment(project_id);
