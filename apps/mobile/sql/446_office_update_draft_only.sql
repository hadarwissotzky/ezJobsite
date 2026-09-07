-- 446 — co_office_update may touch DRAFTS only (Codex adversarial review, 2026-09-07,
-- finding 2 on the console staging).
--
-- ─── THE HOLE ───────────────────────────────────────────────────────────────────
-- 427's `co_office_update` granted the office role UPDATE on EVERY company change
-- order, and its header claimed the frozen-record protections still held. They do for
-- sent/approved/declined rows — 383's freeze trigger covers those — but 383
-- DELIBERATELY excludes `superseded` (its own words: a superseded version's price and
-- scope stay writable, because the supersede act itself must annotate the retired
-- row). Put together: any company owner, with the shipped anon key and their own JWT,
-- could PATCH a superseded change order's price or scope over PostgREST — rewriting a
-- version a client may have READ during a negotiation, on the evidence chain of a
-- product whose whole promise is that history does not move. The console UI only
-- edits drafts; RLS, not the UI, is the boundary that counts.
--
-- ─── THE RULE ───────────────────────────────────────────────────────────────────
-- The office edits documents that are still being written: status = 'draft', on both
-- sides of the policy (USING picks which rows may be targeted; WITH CHECK stops an
-- UPDATE that would move a row out of draft — status transitions belong to the
-- lifecycle RPCs, not to a raw table write). The supersede path is unaffected: it
-- runs inside SECURITY DEFINER functions that do not pass through this policy, and
-- the ORIGINAL owner's own policy (co_own) is untouched by this migration — narrowing
-- the office grant restores the pre-427 exposure, it does not add a new restriction
-- anywhere else.

drop policy if exists co_office_update on public.change_order;
create policy co_office_update on public.change_order for update to authenticated
  using (public.is_project_office(project_id) and status = 'draft')
  with check (public.is_project_office(project_id) and status = 'draft');
