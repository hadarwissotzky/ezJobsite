-- Project lifecycle — REQ-PM4. Status: active · lead · in_progress · complete ·
-- archived. "active" is RETAINED (the legacy default + the collapse's unset state) so
-- every existing writer keeps working — the project.status DEFAULT, createProject, and
-- ingest_project_v1 all write 'active', and breaking that stops project creation. The
-- granular states are a refinement the Job screen offers; the working list is simply
-- everything that is NOT archived.
--
-- BLOCKERS FIXED (specialist review 2026-07-25): (1) the LIVE constraint is
-- project_status_check (active|archived) — dropping it by the right name is what lets
-- a new enum take; a wrong name left it in force. (2) the DEFAULT is 'active' and is
-- kept valid rather than eliminated, so INSERTs (status stripped by the connector →
-- default) do not start failing the CHECK. (3) sync rules are widened to all company
-- projects (see sync-config.yaml) so archived rows still reach the device.
--
-- project.status is SERVER-OWNED (connector strips it on upload; client UPDATE is
-- revoked), so changes go through the RPC — the server stays the authority. Archived
-- projects are retained (warranty/dispute; mandate #1). Deleting a project is NOT part
-- of this migration: with project_id on a dozen evidence tables and no FK on most, a
-- safe "empty" delete needs ON DELETE RESTRICT FKs, a separate deliberate change.

-- Drop the REAL legacy constraint (verified in prod: project_status_check =
-- status in ('active','archived')), then add the widened enum that keeps 'active'.
alter table public.project drop constraint if exists project_status_check;
alter table public.project drop constraint if exists project_status_enum;
alter table public.project add constraint project_status_enum
  check (status is null or status in ('active','lead','in_progress','complete','archived'));

-- Set a project's lifecycle status. Allowed for the project OWNER or an active
-- company member whose role is owner/crew — a `sub` (least-trusted, external) does NOT
-- move company job state (review: backend-security). status is mutable operational
-- state, so this is the one deliberate exception to 376's owner-only-writes for the
-- owner/crew of the SAME company; evidence stays owner-only.
create or replace function public.set_project_status(p_project_id text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('active','lead','in_progress','complete','archived') then
    raise exception 'bad status %', p_status using errcode = '22023';
  end if;
  if not (
    exists (select 1 from public.project where id = p_project_id and owner_id = auth.uid())
    or exists (
      select 1 from public.project p
        join public.company_member m on m.company_id = p.company_id
       where p.id = p_project_id and m.user_id = auth.uid()
         and m.status = 'active' and m.role in ('owner','crew'))
  ) then
    raise exception 'not allowed to change this project' using errcode = '42501';
  end if;
  update public.project set status = p_status, updated_at = now() where id = p_project_id;
end $$;
revoke all on function public.set_project_status(text,text) from public, anon;
grant execute on function public.set_project_status(text,text) to authenticated;
