-- Internal team comments — REQ-COMMENT1. Threaded, append-only notes on an EXTRA,
-- attributed to the company member who wrote them, visible to the company (project
-- members) and NEVER to the no-login client. Distinct from the client-facing approval
-- discussion (postReply/threadFor) — that reaches the homeowner; these are crew-only.
--
-- Mutable-social, not capture evidence, so it rides PowerSync (the client inserts,
-- RLS gates it) rather than the owned evidence outbox — a lost comment is not a lost
-- capture. Append-only: edits/deletes are refused at the database.

create table if not exists public.co_comment (
  id               text primary key,          -- client-minted
  change_order_id  text not null,
  project_id       text not null,             -- carried so RLS reads it without a join
  author_id        uuid not null,
  author_name      text,
  body             text not null,
  at_ms            bigint not null,
  created_at       timestamptz not null default now()
);
create index if not exists co_comment_by_co on public.co_comment (change_order_id, at_ms);

-- Append-only: a comment is a record, never edited or destroyed.
create or replace function public.co_comment_no_mutate() returns trigger
language plpgsql as $$ begin raise exception 'comments are append-only'; end $$;
drop trigger if exists co_comment_no_update on public.co_comment;
create trigger co_comment_no_update before update or delete on public.co_comment
  for each row execute function public.co_comment_no_mutate();

alter table public.co_comment enable row level security;
-- Read: any active member of the owning project's company (is_project_visible, 376).
drop policy if exists co_comment_read on public.co_comment;
create policy co_comment_read on public.co_comment for select to authenticated
  using (public.is_project_visible(project_id));
-- Insert: you write AS yourself, on a project you can see. No update/delete policy
-- (the trigger refuses them anyway; the missing policy is belt to that suspenders).
drop policy if exists co_comment_insert on public.co_comment;
create policy co_comment_insert on public.co_comment for insert to authenticated
  with check (author_id = auth.uid() and public.is_project_visible(project_id));
