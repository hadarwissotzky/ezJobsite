-- 260_approval_visibility.sql
--
-- AN APPROVAL IS VISIBLE TO THE CONTRACTOR IT BELONGS TO, AND NOBODY ELSE.
--
-- The hole (branch review, 2026-07-21): `appr_read` was
--   create policy appr_read on public.approval for select to authenticated using (true);
-- Verified live before changing it -- pg_policies showed qual = true, not a
-- transcription of the DDL. Every signed-in user could read every row of `approval`:
-- shown_content (the entire frozen document -- scope, price, company, job), legal_name
-- (the client's typed signature), signer_label, signed_at, user_agent. Across every
-- tenant in the database.
--
-- Why it mattered little yesterday and a lot today: until 230_close_the_loop nothing
-- wrote to `approval` from the no-account link flow, so the table was nearly empty.
-- 230's confirmation_response_settles_co now inserts a row for every client answer.
-- The table went from a stub to the ledger of every signature this product exists to
-- collect, while the policy stayed `true`.
--
-- WHY THE POLICY LIVES HERE AND NOT IN 030, WHERE THE TABLE IS:
--   It has to reference `public.project`, which is created in 100_projects.sql -- 70
--   files LATER than 030. A policy in 030 naming a table that does not exist yet fails
--   on a fresh install. So 030 owns the TABLE and this file owns the POLICY, the same
--   split already applied to the confirmation functions and to
--   approval_signature_binding. check-sql-duplicates now matches `create policy`, so a
--   second file defining appr_read is a FATAL rather than a silent last-writer-wins.
--
--   On a fresh install this leaves a window -- files 030 through 250 -- where `approval`
--   has RLS on and no SELECT policy at all. That is DENY, not allow. Failing closed
--   during a migration run is the correct direction, and it is the reason this is safe
--   to split at all.
--
-- TWO BRANCHES, because an approval reaches its owner two different ways:
--   change_order_id -> change_order.owner_id  is the priced path, and is the one that
--     matters: every row 230 writes carries a change_order_id.
--   project_id -> project.owner_id            covers approvals with NO change order --
--     a decision confirmation (R10), which is priceless but still signed -- and acts as
--     the backstop if change_order_id is ever null on a priced row.
--   An approval matching NEITHER is visible to nobody. That is deliberate: an
--   unattributable signature is not something to show a random authenticated user
--   because we could not work out whose it was.
--
-- WHAT THIS DOES NOT DO: it does not add an INSERT policy. `approval` still has none,
-- so a direct client insert (apps/mobile/src/signing.ts:88, the OTP signature path) is
-- refused by RLS. That predates this file and is NOT fixed here -- fixing it means
-- deciding whether a client may mint an approval row at all, which is a real design
-- question and not a policy tweak. 230's trigger is unaffected: it is SECURITY DEFINER
-- and does not go through RLS.

drop policy if exists appr_read on public.approval;
create policy appr_read on public.approval for select to authenticated using (
  exists (
    select 1 from public.change_order co
     where co.id = approval.change_order_id
       and co.owner_id = auth.uid()
  )
  or exists (
    select 1 from public.project p
     where p.id = approval.project_id
       and p.owner_id = auth.uid()
  )
);
