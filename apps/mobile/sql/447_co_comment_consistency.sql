-- 447 — a crew comment's two identifiers must agree (Codex adversarial review,
-- 2026-09-07, finding 4 on the console staging).
--
-- `co_comment` carries BOTH change_order_id and project_id, and nothing verified they
-- belong together: the insert policy (380) checks only that the caller can see
-- project_id, and there is no foreign key on change_order_id. The console's route-key
-- fix closed the accidental path, but a stale or custom client could still insert an
-- append-only row whose comment shows in project B's thread while naming project A's
-- change order — a record that reads as evidence and is internally false.
--
-- A TRIGGER, NOT A FOREIGN KEY, deliberately: the mobile app comments through an
-- outbox and may comment on a change order that is itself still queued (the approval
-- table's FK already demonstrates that refusal loop, signing.ts documents it). An FK
-- would bounce those retries; this trigger enforces the one thing that must never be
-- false — WHEN the change order is known, its project must match — and lets the
-- not-yet-arrived case through, where the eventual change_order insert makes the pair
-- checkable by anyone reading the record.

create or replace function public.co_comment_consistent()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_project text;
begin
  if new.change_order_id is null then return new; end if;
  select project_id into v_project from public.change_order where id = new.change_order_id;
  if v_project is not null and v_project <> new.project_id then
    raise exception 'comment names change order % of project %, not project %',
      new.change_order_id, v_project, new.project_id
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists co_comment_consistent on public.co_comment;
create trigger co_comment_consistent
  before insert on public.co_comment
  for each row execute function public.co_comment_consistent();
